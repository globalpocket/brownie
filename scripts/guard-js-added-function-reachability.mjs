import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');

function runGit(repoRoot, args) {
  return spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function gitStdout(repoRoot, args) {
  const result = runGit(repoRoot, args);
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim();
}

function resolveDiffBase(repoRoot) {
  const explicitBase = process.env.BROWNIE_JS_REACHABILITY_BASE;
  if (explicitBase) {
    return explicitBase;
  }
  const mainMergeBase = gitStdout(repoRoot, ['merge-base', 'HEAD', 'origin/main']);
  if (mainMergeBase) {
    return mainMergeBase;
  }
  const firstParent = gitStdout(repoRoot, ['rev-parse', '--verify', 'HEAD^1']);
  if (firstParent) {
    return firstParent;
  }
  return null;
}

function trackedSourceFiles(repoRoot) {
  const result = runGit(repoRoot, ['ls-files']);
  if (result.status !== 0) {
    return [];
  }
  return result.stdout
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => /\.(?:mjs|cjs|js|ts|tsx)$/.test(entry))
    .filter((entry) => !entry.includes('/node_modules/'))
    .filter((entry) => !entry.startsWith('node_modules/'))
    .filter((entry) => fs.existsSync(path.join(repoRoot, entry)));
}

function addedJavaScriptFiles(repoRoot, baseRef) {
  const result = runGit(repoRoot, ['diff', '--name-only', '--diff-filter=AM', baseRef, '--']);
  if (result.status !== 0) {
    return [];
  }
  return result.stdout
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => /\.(?:mjs|cjs|js|ts|tsx)$/.test(entry))
    .filter((entry) => fs.existsSync(path.join(repoRoot, entry)));
}

function addedFunctionDeclarations(repoRoot, baseRef, relativePath) {
  const result = runGit(repoRoot, ['diff', '--unified=0', baseRef, '--', relativePath]);
  if (result.status !== 0) {
    return [];
  }
  const declarations = [];
  const declarationPattern = /^\+(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
  for (const line of result.stdout.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) {
      continue;
    }
    const match = line.match(declarationPattern);
    if (match) {
      declarations.push({
        name: match[1],
        relativePath
      });
    }
  }
  return declarations;
}

function countIdentifierReferences(repoRoot, sourceFiles, identifier) {
  const pattern = new RegExp(`\\b${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  let count = 0;
  for (const relativePath of sourceFiles) {
    const fullPath = path.join(repoRoot, relativePath);
    let text;
    try {
      text = fs.readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }
    count += [...text.matchAll(pattern)].length;
  }
  return count;
}

export function validateAddedFunctionReachability(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const baseRef = options.baseRef ?? resolveDiffBase(repoRoot);
  const errors = [];
  if (!baseRef) {
    return {
      valid: true,
      skipped: true,
      reason: 'diff_base_unavailable',
      errors
    };
  }

  const changedFiles = addedJavaScriptFiles(repoRoot, baseRef);
  const sourceFiles = trackedSourceFiles(repoRoot);
  const addedFunctions = changedFiles.flatMap((relativePath) =>
    addedFunctionDeclarations(repoRoot, baseRef, relativePath)
  );

  for (const declaration of addedFunctions) {
    const referenceCount = countIdentifierReferences(repoRoot, sourceFiles, declaration.name);
    if (referenceCount <= 1) {
      errors.push({
        code: 'added_function_unreachable',
        function_name: declaration.name,
        path: declaration.relativePath,
        message:
          `Added function ${declaration.name} in ${declaration.relativePath} has no observable references. ` +
          'Connect it to a production/test execution path or remove it.'
      });
    }
  }

  return {
    valid: errors.length === 0,
    skipped: false,
    baseRef,
    changedFiles,
    addedFunctions,
    errors
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = validateAddedFunctionReachability();
  if (result.skipped) {
    process.stdout.write(`JS added function reachability guard skipped: ${result.reason}.\n`);
    process.exit(0);
  }
  if (!result.valid) {
    console.error('JS added function reachability guard failed:');
    for (const error of result.errors) {
      console.error(`- ${error.message}`);
    }
    process.exit(1);
  }
  process.stdout.write(
    `JS added function reachability guard passed for ${result.addedFunctions.length} added function declaration(s).\n`
  );
}
