import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateLocalReleaseTargetsManifest } from './guard-local-release-targets.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultManifestPath = '.brownie/local-release-targets.json';

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join('/').replace(/^\.\//, '');
}

function resolveRepoRelative(repoRoot, relativePath) {
  const resolved = path.resolve(repoRoot, relativePath);
  const relative = path.relative(repoRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes repository root: ${relativePath}`);
  }
  return resolved;
}

function parseArgs(argv) {
  const options = {
    repoRoot: defaultRepoRoot,
    manifestPath: process.env.BROWNIE_LOCAL_RELEASE_TARGETS ?? defaultManifestPath
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--repo-root') {
      options.repoRoot = path.resolve(argv[++index] ?? '');
    } else if (arg === '--manifest') {
      options.manifestPath = argv[++index] ?? '';
    } else {
      throw new Error(`Unknown local artifact orchestration argument: ${arg}`);
    }
  }
  return options;
}

function readManifest(repoRoot, manifestPath) {
  const fullPath = resolveRepoRelative(repoRoot, manifestPath);
  if (!fs.existsSync(fullPath)) {
    return {
      schema_version: 1,
      targets: [
        {
          id: `${process.platform}-${process.arch}`,
          kind: 'local',
          required: true
        }
      ]
    };
  }
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 600_000,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return {
    command: [command, ...args].join(' '),
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exit_code: result.status,
    passed: result.status === 0
  };
}

function posixQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function powershellQuote(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function powershellEncodedCommand(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function remoteCommand(target) {
  const outDir = `.brownie/release-evidence/artifacts/${target.id}`;
  if (target.shell === 'powershell') {
    const script = `Set-Location ${powershellQuote(target.workspace)}; pnpm.cmd --workspace-root run release:local-artifact -- --target ${powershellQuote(target.id)} --out-dir ${powershellQuote(outDir)}`;
    return `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${powershellEncodedCommand(script)}`;
  }
  if (target.container_platform) {
    return `export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"; cd ${posixQuote(target.workspace)} && pnpm --workspace-root run release:linux-x64-docker-artifact -- --platform ${posixQuote(target.container_platform)} --target ${posixQuote(target.id)} --out-dir ${posixQuote(outDir)}`;
  }
  return `export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"; cd ${posixQuote(target.workspace)} && pnpm --workspace-root run release:local-artifact -- --target ${posixQuote(target.id)} --out-dir ${posixQuote(outDir)}`;
}

function runTarget(repoRoot, target) {
  const outDir = `.brownie/release-evidence/artifacts/${target.id}`;
  if (target.kind === 'local') {
    return run('pnpm', ['--workspace-root', 'run', 'release:local-artifact', '--', '--target', target.id, '--out-dir', outDir], {
      cwd: repoRoot
    });
  }

  const execute = run('ssh', [target.host, remoteCommand(target)], { cwd: repoRoot });
  if (!execute.passed) {
    return execute;
  }
  const localOutDir = resolveRepoRelative(repoRoot, outDir);
  fs.rmSync(localOutDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(localOutDir), { recursive: true });
  const remoteOutDir = `${target.workspace.replace(/\\/g, '/')}/${outDir}`;
  return run('scp', ['-r', `${target.host}:${remoteOutDir}`, path.dirname(localOutDir)], { cwd: repoRoot });
}

export function runLocalReleaseArtifactsAll(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const manifestPath = normalizeRelativePath(options.manifestPath ?? process.env.BROWNIE_LOCAL_RELEASE_TARGETS ?? defaultManifestPath);
  const manifest = readManifest(repoRoot, manifestPath);
  const errors = validateLocalReleaseTargetsManifest(manifest, { owner: manifestPath });
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  const results = manifest.targets.map((target) => ({
    target: target.id,
    kind: target.kind,
    required: target.required,
    ...runTarget(repoRoot, target)
  }));
  const failedRequired = results.filter((result) => result.required && !result.passed);
  return {
    manifest: fs.existsSync(resolveRepoRelative(repoRoot, manifestPath)) ? manifestPath : null,
    targets: results,
    passed: failedRequired.length === 0
  };
}

if (isMainModule()) {
  try {
    const result = runLocalReleaseArtifactsAll(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.passed) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`Local release artifact orchestration failed: ${error.message}`);
    process.exit(1);
  }
}
