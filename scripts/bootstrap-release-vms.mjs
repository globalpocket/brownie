import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateLocalReleaseTargetsManifest } from './guard-local-release-targets.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultManifestPath = '.brownie/local-release-targets.json';
const defaultPnpmVersion = '9.0.0';

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

function gitValue(repoRoot, args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function parseArgs(argv) {
  const options = {
    repoRoot: defaultRepoRoot,
    manifestPath: process.env.BROWNIE_LOCAL_RELEASE_TARGETS ?? defaultManifestPath,
    target: null,
    repoUrl: null,
    ref: null,
    source: 'git',
    dryRun: false,
    installSystemPackages: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--repo-root') {
      options.repoRoot = path.resolve(argv[++index] ?? '');
    } else if (arg === '--manifest') {
      options.manifestPath = argv[++index] ?? '';
    } else if (arg === '--target') {
      options.target = argv[++index] ?? '';
    } else if (arg === '--repo-url') {
      options.repoUrl = argv[++index] ?? '';
    } else if (arg === '--ref') {
      options.ref = argv[++index] ?? '';
    } else if (arg === '--source') {
      options.source = argv[++index] ?? '';
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--skip-system-packages') {
      options.installSystemPackages = false;
    } else {
      throw new Error(`Unknown VM bootstrap argument: ${arg}`);
    }
  }
  if (!['git', 'local-copy'].includes(options.source)) {
    throw new Error('--source must be git or local-copy.');
  }
  return options;
}

function readManifest(repoRoot, manifestPath) {
  const fullPath = resolveRepoRelative(repoRoot, manifestPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`${manifestPath} does not exist. Copy docs/architecture/local-release-targets.example.json to ${manifestPath} and set VM hosts first.`);
  }
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function runSsh(host, shell, script) {
  const args =
    shell === 'powershell'
      ? [host, 'powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]
      : [host, 'bash', '-s'];
  const result = spawnSync('ssh', args, {
    encoding: 'utf8',
    input: shell === 'powershell' ? null : script,
    timeout: 1_800_000,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  return {
    command: `ssh ${host} ${shell === 'powershell' ? 'powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand <script>' : 'bash -s'}`,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exit_code: result.status,
    passed: result.status === 0
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 1_800_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...(options.env ?? {}) }
  });
  return {
    command: [command, ...args].join(' '),
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exit_code: result.status,
    passed: result.status === 0
  };
}

function posixSingleQuoted(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function powershellSingleQuoted(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function linuxBootstrapScript(target, options) {
  return `#!/usr/bin/env bash
set -euo pipefail

BROWNIE_WORKSPACE=${posixSingleQuoted(target.workspace)}
BROWNIE_REPO_URL=${posixSingleQuoted(options.repoUrl)}
BROWNIE_REF=${posixSingleQuoted(options.ref)}
BROWNIE_TARGET=${posixSingleQuoted(target.id)}
BROWNIE_CONTAINER_PLATFORM=${posixSingleQuoted(target.container_platform ?? '')}
BROWNIE_INSTALL_SYSTEM_PACKAGES=${posixSingleQuoted(String(options.installSystemPackages))}
BROWNIE_SOURCE=${posixSingleQuoted(options.source)}
BROWNIE_PNPM_VERSION=${posixSingleQuoted(defaultPnpmVersion)}

export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"

if [ "$BROWNIE_INSTALL_SYSTEM_PACKAGES" = "true" ]; then
  if command -v apt-get >/dev/null 2>&1; then
    if command -v sudo >/dev/null 2>&1; then BROWNIE_SUDO=sudo; else BROWNIE_SUDO=; fi
    $BROWNIE_SUDO rm -rf /var/lib/apt/lists/*
    $BROWNIE_SUDO apt-get update
    $BROWNIE_SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y git curl ca-certificates build-essential pkg-config libssl-dev nodejs npm
    if [ -n "$BROWNIE_CONTAINER_PLATFORM" ]; then
      $BROWNIE_SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io qemu-user-static binfmt-support
      $BROWNIE_SUDO systemctl enable --now docker >/dev/null 2>&1 || true
    fi
  fi
fi

if ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  export PATH="$HOME/.cargo/bin:$PATH"
fi

if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    corepack enable
    corepack prepare "pnpm@$BROWNIE_PNPM_VERSION" --activate
  else
    mkdir -p "$HOME/.local"
    npm config set prefix "$HOME/.local"
    npm install -g "pnpm@$BROWNIE_PNPM_VERSION"
  fi
fi

if [ "$BROWNIE_SOURCE" = "git" ]; then
  mkdir -p "$(dirname "$BROWNIE_WORKSPACE")"
  if [ -d "$BROWNIE_WORKSPACE/.git" ]; then
    git -C "$BROWNIE_WORKSPACE" fetch --all --prune
  else
    git clone "$BROWNIE_REPO_URL" "$BROWNIE_WORKSPACE"
  fi

  git -C "$BROWNIE_WORKSPACE" fetch origin
  git -C "$BROWNIE_WORKSPACE" checkout "$BROWNIE_REF"
fi

pnpm --dir "$BROWNIE_WORKSPACE" install --frozen-lockfile
if [ -n "$BROWNIE_CONTAINER_PLATFORM" ]; then
  pnpm --dir "$BROWNIE_WORKSPACE" --workspace-root run release:linux-x64-docker-artifact -- --platform "$BROWNIE_CONTAINER_PLATFORM" --target "$BROWNIE_TARGET"
else
  pnpm --dir "$BROWNIE_WORKSPACE" --workspace-root run release:local-artifact -- --target "$BROWNIE_TARGET"
fi
`;
}

function windowsBootstrapScript(target, options) {
  return `$ErrorActionPreference = 'Stop'

$BrownieWorkspace = ${powershellSingleQuoted(target.workspace)}
$BrownieRepoUrl = ${powershellSingleQuoted(options.repoUrl)}
$BrownieRef = ${powershellSingleQuoted(options.ref)}
$BrownieTarget = ${powershellSingleQuoted(target.id)}
$BrownieContainerPlatform = ${powershellSingleQuoted(target.container_platform ?? '')}
$BrownieInstallSystemPackages = ${powershellSingleQuoted(String(options.installSystemPackages))}
$BrownieSource = ${powershellSingleQuoted(options.source)}
$BrowniePnpmVersion = ${powershellSingleQuoted(defaultPnpmVersion)}

function Test-Command($Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

if ($BrownieInstallSystemPackages -eq 'true' -and (Test-Command winget)) {
  if (-not (Test-Command git)) {
    winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
  }
  if (-not (Test-Command node)) {
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  }
  if (-not (Test-Command cargo)) {
    winget install --id Rustlang.Rustup -e --accept-source-agreements --accept-package-agreements
  }
  if ($BrownieTarget -eq 'win32-x64' -and $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -and -not (Test-Path 'C:\\BuildTools\\Common7\\Tools\\VsDevCmd.bat')) {
    winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-source-agreements --accept-package-agreements --override "--quiet --wait --norestart --nocache --installPath C:\\BuildTools --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.ARM64 --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.26100 --includeRecommended"
  }
}

$env:Path = "$env:USERPROFILE\\.cargo\\bin;$env:ProgramFiles\\Git\\cmd;$env:ProgramFiles\\nodejs;$env:Path"

if (-not (Test-Command pnpm)) {
  if (Test-Command corepack) {
    corepack enable
    corepack prepare "pnpm@$BrowniePnpmVersion" --activate
  } else {
    npm install -g "pnpm@$BrowniePnpmVersion"
  }
}

$Parent = Split-Path -Parent $BrownieWorkspace
if ($Parent) {
  New-Item -ItemType Directory -Force -Path $Parent | Out-Null
}

if ($BrownieSource -eq 'git') {
  if (Test-Path (Join-Path $BrownieWorkspace '.git')) {
    git -C $BrownieWorkspace fetch --all --prune
  } else {
    git clone $BrownieRepoUrl $BrownieWorkspace
  }

  git -C $BrownieWorkspace fetch origin
  git -C $BrownieWorkspace checkout $BrownieRef
}

pnpm.cmd --dir $BrownieWorkspace install --frozen-lockfile
if ($BrownieContainerPlatform) {
  throw 'container_platform is only supported for POSIX SSH targets.'
} else {
  pnpm.cmd --dir $BrownieWorkspace --workspace-root run release:local-artifact -- --target $BrownieTarget
}
`;
}

function combineSteps(command, steps) {
  const last = steps.at(-1);
  return {
    command,
    stdout: steps.map((step) => step.stdout).filter(Boolean).join('\n'),
    stderr: steps.map((step) => step.stderr).filter(Boolean).join('\n'),
    exit_code: last?.exit_code ?? 1,
    passed: steps.every((step) => step.passed),
    steps
  };
}

function createLocalCopyArchive(repoRoot) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-local-copy-'));
  const archive = path.join(tmpDir, 'workspace.tar.gz');
  const create = run('tar', [
    '--exclude', './.git',
    '--exclude', './target',
    '--exclude', './node_modules',
    '--exclude', './.brownie/release-evidence',
    '--exclude', './.brownie/vms',
    '-czf',
    archive,
    '-C',
    repoRoot,
    '.'
  ], {
    cwd: repoRoot,
    env: { COPYFILE_DISABLE: '1' }
  });
  return { tmpDir, archive, create };
}

function syncPosixLocalCopy(repoRoot, target) {
  const repoRootString = String(repoRoot);
  const targetWorkspace = String(target.workspace);
  const mkdir = run('ssh', [target.host, `mkdir -p ${posixSingleQuoted(target.workspace)}`], {
    cwd: repoRoot
  });
  if (!mkdir.passed) {
    return mkdir;
  }
  return run('rsync', [
    '-az',
    '--delete',
    '--exclude', '.git/',
    '--exclude', 'target/',
    '--exclude', 'node_modules/',
    '--exclude', '.brownie/release-evidence/',
    '--exclude', '.brownie/vms/',
    `${repoRootString.replace(/\/$/, '')}/`,
    `${target.host}:${targetWorkspace.replace(/\/$/, '')}/`
  ], {
    cwd: repoRoot
  });
}

function syncWindowsLocalCopy(repoRoot, target) {
  const { tmpDir, archive, create } = createLocalCopyArchive(repoRoot);
  const remoteArchiveName = `brownie-local-copy-${process.pid}.tar.gz`;
  try {
    if (!create.passed) {
      return combineSteps('local-copy windows archive', [create]);
    }
    const upload = run('scp', [archive, `${target.host}:${remoteArchiveName}`], {
      cwd: repoRoot
    });
    if (!upload.passed) {
      return combineSteps('local-copy windows upload', [create, upload]);
    }
    const extractScript = `$ErrorActionPreference = 'Stop'
$BrownieWorkspace = ${powershellSingleQuoted(target.workspace)}
$Archive = Join-Path $env:USERPROFILE ${powershellSingleQuoted(remoteArchiveName)}
if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
  throw 'tar.exe is required for local-copy bootstrap on Windows.'
}
New-Item -ItemType Directory -Force -Path $BrownieWorkspace | Out-Null
Get-ChildItem -LiteralPath $BrownieWorkspace -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
tar -xzf $Archive -C $BrownieWorkspace
Remove-Item -LiteralPath $Archive -Force
`;
    const extract = runSsh(target.host, 'powershell', extractScript);
    return combineSteps('local-copy windows tar+scp', [create, upload, extract]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function syncLocalCopy(repoRoot, target) {
  if (target.shell === 'posix') {
    return syncPosixLocalCopy(repoRoot, target);
  }
  if (target.shell === 'powershell') {
    return syncWindowsLocalCopy(repoRoot, target);
  }
  throw new Error(`Unsupported local-copy shell: ${target.shell}`);
}

function buildScript(target, options) {
  if (target.shell === 'powershell') {
    return windowsBootstrapScript(target, options);
  }
  return linuxBootstrapScript(target, options);
}

export function bootstrapReleaseVms(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const manifestPath = normalizeRelativePath(options.manifestPath ?? process.env.BROWNIE_LOCAL_RELEASE_TARGETS ?? defaultManifestPath);
  const manifest = readManifest(repoRoot, manifestPath);
  const errors = validateLocalReleaseTargetsManifest(manifest, { owner: manifestPath });
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
  const repoUrl = options.repoUrl ?? gitValue(repoRoot, ['config', '--get', 'remote.origin.url']) ?? 'https://github.com/globalpocket/brownie.git';
  const ref = options.ref ?? gitValue(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'main';
  const selectedTargets = manifest.targets.filter((target) => target.kind === 'ssh' && (!options.target || target.id === options.target));
  if (selectedTargets.length === 0) {
    throw new Error(options.target ? `No SSH target found for ${options.target}.` : 'No SSH release targets are configured.');
  }

  const results = selectedTargets.map((target) => {
    const script = buildScript(target, {
      repoUrl,
      ref,
      source: options.source,
      installSystemPackages: options.installSystemPackages ?? true
    });
    if (options.dryRun) {
      return {
        target: target.id,
        host: target.host,
        shell: target.shell,
        dry_run: true,
        source: options.source,
        script
      };
    }
    const sync = options.source === 'local-copy' ? syncLocalCopy(repoRoot, target) : null;
    if (sync && !sync.passed) {
      return {
        target: target.id,
        host: target.host,
        shell: target.shell,
        dry_run: false,
        source: options.source,
        sync,
        passed: false
      };
    }
    return {
      target: target.id,
      host: target.host,
      shell: target.shell,
      dry_run: false,
      source: options.source,
      ...(sync ? { sync } : {}),
      ...runSsh(target.host, target.shell, script)
    };
  });
  return {
    manifest: manifestPath,
    repo_url: repoUrl,
    ref,
    source: options.source,
    targets: results,
    passed: results.every((result) => result.dry_run || result.passed)
  };
}

if (isMainModule()) {
  try {
    const result = bootstrapReleaseVms(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.passed) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`Release VM bootstrap failed: ${error.message}`);
    process.exit(1);
  }
}
