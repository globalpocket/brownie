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

function fetchBaseRefIfNeeded(repoRoot, baseName) {
  if (!baseName) {
    return false;
  }
  const result = runGit(repoRoot, [
    'fetch',
    '--no-tags',
    '--depth=100',
    'origin',
    `+refs/heads/${baseName}:refs/remotes/origin/${baseName}`
  ]);
  return result.status === 0;
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
  if (process.env.GITHUB_BASE_REF) {
    fetchBaseRefIfNeeded(repoRoot, process.env.GITHUB_BASE_REF);
    const githubBaseRef = `origin/${process.env.GITHUB_BASE_REF}`;
    const githubBaseSha = gitStdout(repoRoot, ['rev-parse', '--verify', githubBaseRef]);
    if (githubBaseSha) {
      return githubBaseRef;
    }
    const githubMergeBase = gitStdout(repoRoot, ['merge-base', 'HEAD', `origin/${process.env.GITHUB_BASE_REF}`]);
    if (githubMergeBase) {
      return githubMergeBase;
    }
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

function functionHasReachableReference(repoRoot, sourceFiles, declaration) {
  const sameFilePath = path.join(repoRoot, declaration.relativePath);
  const sameFile = fs.existsSync(sameFilePath) ? fs.readFileSync(sameFilePath, 'utf8') : '';
  const escaped = declaration.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declarationPattern = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${escaped}\\s*\\(`, 'g');
  const sameFileWithoutDeclaration = sameFile.replace(declarationPattern, '');
  const sameFileCallPattern = new RegExp(`\\b${escaped}\\s*\\(`);
  if (sameFileCallPattern.test(sameFileWithoutDeclaration)) {
    return true;
  }
  const namedImportPattern = new RegExp(`import\\s*\\{[^}]*\\b${escaped}\\b[^}]*\\}\\s*from\\s*['"][^'"]+['"]`, 'g');
  for (const relativePath of sourceFiles) {
    if (relativePath === declaration.relativePath) {
      continue;
    }
    const text = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    if (namedImportPattern.test(text)) {
      return true;
    }
  }
  return false;
}

export function validateAddedFunctionReachability(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const baseRef = Object.hasOwn(options, 'baseRef') ? options.baseRef : resolveDiffBase(repoRoot);
  const errors = [];
  if (!baseRef) {
    if (process.env.GITHUB_BASE_REF || process.env.GITHUB_EVENT_NAME === 'pull_request') {
      return {
        valid: false,
        skipped: false,
        reason: 'diff_base_unavailable',
        errors: [
          {
            code: 'diff_base_unavailable',
            message: 'JS added function reachability guard could not resolve a diff base in CI.'
          }
        ]
      };
    }
    return {
      valid: true,
      skipped: true,
      reason: 'diff_base_unavailable',
      errors
    };
  }
  const head = gitStdout(repoRoot, ['rev-parse', 'HEAD']);
  if (head && baseRef === head && (process.env.GITHUB_BASE_REF || process.env.GITHUB_EVENT_NAME === 'pull_request')) {
    return {
      valid: false,
      skipped: false,
      reason: 'diff_base_matches_head',
      errors: [
        {
          code: 'diff_base_matches_head',
          message: 'JS added function reachability guard resolved a pull-request diff base equal to HEAD.'
        }
      ]
    };
  }

  const changedFiles = addedJavaScriptFiles(repoRoot, baseRef);
  const sourceFiles = trackedSourceFiles(repoRoot);
  const addedFunctions = changedFiles.flatMap((relativePath) =>
    addedFunctionDeclarations(repoRoot, baseRef, relativePath)
  );

  for (const declaration of addedFunctions) {
    if (!functionHasReachableReference(repoRoot, sourceFiles, declaration)) {
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
