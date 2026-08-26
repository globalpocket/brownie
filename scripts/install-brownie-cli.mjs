#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

const systemPrefixes = new Set([
  '/bin',
  '/sbin',
  '/usr',
  '/usr/bin',
  '/usr/local',
  '/usr/local/bin',
  '/opt',
  '/opt/homebrew',
  '/System',
  '/Library',
  '/Applications'
]);

function usage() {
  return [
    'Usage:',
    '  node scripts/install-brownie-cli.mjs --prefix <absolute-prefix> [--profile debug|release] [--dry-run] [--skip-build]',
    '',
    'Installs the existing brownie CLI and brownie-runtime binaries into <prefix>/bin.',
    'Use --dry-run to validate paths and show the bounded build/install plan without writing.',
    ''
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    profile: 'release',
    skipBuild: false,
    prefix: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--skip-build') {
      options.skipBuild = true;
    } else if (arg === '--prefix') {
      options.prefix = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === '--profile') {
      options.profile = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (options.help) {
    return options;
  }
  if (typeof options.prefix !== 'string' || options.prefix.trim().length === 0) {
    throw new Error('missing --prefix');
  }
  if (!['debug', 'release'].includes(options.profile)) {
    throw new Error('profile must be debug or release');
  }
  return options;
}

function validatePrefix(prefix) {
  if (!path.isAbsolute(prefix)) {
    throw new Error('--prefix must be an absolute path');
  }

  const normalized = path.normalize(prefix);
  if (normalized !== prefix || normalized === path.parse(prefix).root) {
    throw new Error('--prefix must be a normalized non-root path');
  }

  const parts = normalized.split(path.sep).filter(Boolean);
  if (parts.includes('..')) {
    throw new Error('--prefix must not contain parent traversal');
  }

  if (systemPrefixes.has(normalized)) {
    throw new Error('--prefix must point to a caller-owned local directory, not a system prefix');
  }

  return normalized;
}

function executableName(name) {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function binaryPathForProfile(profile, name) {
  return path.join(repoRoot, 'target', profile, executableName(name));
}

function buildBinaries(profile) {
  const args = [
    'build',
    '-p',
    'brownie-cli',
    '--bin',
    'brownie',
    '-p',
    'brownie-runtime',
    '--bin',
    'brownie-runtime'
  ];
  if (profile === 'release') {
    args.push('--release');
  }
  execFileSync('cargo', args, { cwd: repoRoot, stdio: 'inherit' });
}

function ensureInstallableBinary(binaryPath) {
  const stats = fs.statSync(binaryPath);
  if (!stats.isFile()) {
    throw new Error('built brownie binary is not a regular file');
  }
}

function copyAtomically(binaryPath, destinationPath) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  const tempPath = path.join(
    path.dirname(destinationPath),
    `.brownie-install-${process.pid}-${Date.now()}.tmp`
  );
  try {
    fs.copyFileSync(binaryPath, tempPath);
    fs.chmodSync(tempPath, 0o755);
    fs.renameSync(tempPath, destinationPath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Best effort cleanup only.
    }
    throw error;
  }
}

export function planInstall(options) {
  const prefix = validatePrefix(options.prefix);
  const binDir = path.join(prefix, 'bin');
  return {
    profile: options.profile,
    prefix,
    binDir,
    binaryPath: binaryPathForProfile(options.profile, 'brownie'),
    runtimeBinaryPath: binaryPathForProfile(options.profile, 'brownie-runtime'),
    destinationPath: path.join(binDir, executableName('brownie')),
    runtimeDestinationPath: path.join(binDir, executableName('brownie-runtime')),
    cargoArgs:
      options.profile === 'release'
        ? ['build', '-p', 'brownie-cli', '--bin', 'brownie', '-p', 'brownie-runtime', '--bin', 'brownie-runtime', '--release']
        : ['build', '-p', 'brownie-cli', '--bin', 'brownie', '-p', 'brownie-runtime', '--bin', 'brownie-runtime']
  };
}

export function runInstall(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    return { exitCode: 0, stdout: usage(), stderr: '' };
  }

  const plan = planInstall(options);
  const summary = {
    ok: true,
    dry_run: options.dryRun,
    profile: plan.profile,
    prefix: plan.prefix,
    bin_dir: plan.binDir,
    destination: plan.destinationPath,
    runtime_destination: plan.runtimeDestinationPath,
    build: options.skipBuild
      ? 'skipped'
      : 'cargo build -p brownie-cli --bin brownie -p brownie-runtime --bin brownie-runtime'
  };

  if (options.dryRun) {
    return { exitCode: 0, stdout: `${JSON.stringify(summary)}\n`, stderr: '' };
  }

  if (!options.skipBuild) {
    buildBinaries(options.profile);
  }
  ensureInstallableBinary(plan.binaryPath);
  ensureInstallableBinary(plan.runtimeBinaryPath);
  copyAtomically(plan.binaryPath, plan.destinationPath);
  copyAtomically(plan.runtimeBinaryPath, plan.runtimeDestinationPath);
  return { exitCode: 0, stdout: `${JSON.stringify(summary)}\n`, stderr: '' };
}

if (process.argv[1] === __filename) {
  try {
    const result = runInstall();
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`brownie install: ${error.message}\n`);
    process.exitCode = 64;
  }
}
