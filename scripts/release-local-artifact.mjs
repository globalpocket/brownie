import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');

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
  const platform = process.platform === 'win32' ? 'win32' : process.platform;
  const arch = process.arch === 'x64' ? 'x64' : process.arch;
  const options = {
    repoRoot: defaultRepoRoot,
    target: `${platform}-${arch}`,
    outDir: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--repo-root') {
      options.repoRoot = path.resolve(argv[++index] ?? '');
    } else if (arg === '--target') {
      options.target = argv[++index] ?? '';
    } else if (arg === '--out-dir') {
      options.outDir = argv[++index] ?? '';
    } else {
      throw new Error(`Unknown local artifact argument: ${arg}`);
    }
  }
  if (!/^(?:darwin-arm64|linux-arm64|linux-x64|win32-x64)$/.test(options.target)) {
    throw new Error(`Unsupported release target: ${options.target}`);
  }
  options.outDir = normalizeRelativePath(options.outDir ?? `.brownie/release-evidence/artifacts/${options.target}`);
  return options;
}

function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function run(repoRoot, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...(options.env ?? {}), CARGO_TERM_COLOR: 'never' }
  });
  return {
    command: [command, ...args].join(' '),
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exit_code: result.status,
    passed: result.status === 0
  };
}

function tailText(value, maxLength = 4000) {
  return value.length > maxLength ? value.slice(-maxLength) : value;
}

function smoke(repoRoot, artifactPath, args) {
  const result = spawnSync(artifactPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 15_000,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return {
    args,
    exit_code: result.status,
    passed: result.status === 0
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function assertNativeTargetMatchesRuntime(target) {
  const expected = {
    'darwin-arm64': ['darwin', 'arm64'],
    'linux-arm64': ['linux', 'arm64'],
    'linux-x64': ['linux', 'x64'],
    'win32-x64': ['win32', 'x64']
  }[target];
  if (!expected) {
    throw new Error(`Unsupported release target: ${target}`);
  }
  const [platform, arch] = expected;
  if (process.platform !== platform || process.arch !== arch) {
    throw new Error(
      `Target ${target} requires ${platform}/${arch}, but this runtime is ${process.platform}/${process.arch}. Use release:linux-x64-docker-artifact for linux-x64 on Apple Silicon.`
    );
  }
}

function buildPlanForTarget(target) {
  if (target === 'win32-x64' && process.platform === 'win32' && process.arch === 'arm64') {
    const vsDevCmd = 'C:\\BuildTools\\Common7\\Tools\\VsDevCmd.bat';
    if (!fs.existsSync(vsDevCmd)) {
      throw new Error(
        `Target ${target} on win32/arm64 requires Visual Studio Build Tools at ${vsDevCmd}. Run release:vm-bootstrap with system package installation enabled.`
      );
    }
    return {
      cargoTarget: 'x86_64-pc-windows-msvc',
      buildCommand: 'cmd.exe',
      buildArgs: [
        '/d',
        '/c',
        `call ${vsDevCmd} -arch=x64 -host_arch=arm64 && cargo build --release -p brownie-cli --target x86_64-pc-windows-msvc`
      ],
      sourceArtifact: 'target/x86_64-pc-windows-msvc/release/brownie.exe',
      binaryName: 'brownie.exe',
      setup: {
        command: 'rustup',
        args: ['target', 'add', 'x86_64-pc-windows-msvc']
      }
    };
  }

  assertNativeTargetMatchesRuntime(target);
  const binaryName = target.startsWith('win32-') ? 'brownie.exe' : 'brownie';
  return {
    cargoTarget: null,
    buildCommand: 'cargo',
    buildArgs: ['build', '--release', '-p', 'brownie-cli'],
    sourceArtifact: `target/release/${binaryName}`,
    binaryName,
    setup: null
  };
}

export function buildLocalArtifact(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const target = options.target ?? `${process.platform}-${process.arch}`;
  const outDir = normalizeRelativePath(options.outDir ?? `.brownie/release-evidence/artifacts/${target}`);
  const outFull = resolveRepoRelative(repoRoot, outDir);
  fs.mkdirSync(outFull, { recursive: true });
  const buildPlan = buildPlanForTarget(target);

  const setup = buildPlan.setup ? run(repoRoot, buildPlan.setup.command, buildPlan.setup.args) : null;
  if (setup && !setup.passed) {
    throw new Error(`cargo target setup failed for ${target}\n${tailText(setup.stderr || setup.stdout)}`);
  }

  const build = run(repoRoot, buildPlan.buildCommand, buildPlan.buildArgs);
  if (!build.passed) {
    throw new Error(`cargo release build failed for ${target}\n${tailText(build.stderr || build.stdout)}`);
  }

  const binaryName = buildPlan.binaryName;
  const sourceArtifact = resolveRepoRelative(repoRoot, buildPlan.sourceArtifact);
  if (!fs.existsSync(sourceArtifact)) {
    throw new Error(`Expected release artifact is missing: ${buildPlan.sourceArtifact}`);
  }
  const artifactRelativePath = normalizeRelativePath(path.join(outDir, binaryName));
  const artifactPath = resolveRepoRelative(repoRoot, artifactRelativePath);
  fs.copyFileSync(sourceArtifact, artifactPath);
  if (!target.startsWith('win32-')) {
    fs.chmodSync(artifactPath, 0o755);
  }

  const smokeResults = [
    smoke(repoRoot, artifactPath, ['--version']),
    smoke(repoRoot, artifactPath, ['help', 'run'])
  ];
  const artifactEvidence = {
    schema_version: 1,
    evidence_id: 'brownie-local-release-artifact-v1',
    generated_at: new Date().toISOString(),
    target,
    platform: process.platform,
    arch: process.arch,
    hostname_hash: `sha256:${crypto.createHash('sha256').update(os.hostname()).digest('hex')}`,
    artifact: {
      path: artifactRelativePath,
      sha256: sha256File(artifactPath),
      bytes: fs.statSync(artifactPath).size,
      target
    },
    build: {
      setup: setup
        ? {
          command: setup.command,
          exit_code: setup.exit_code,
          passed: setup.passed
        }
        : null,
      command: build.command,
      exit_code: build.exit_code,
      passed: build.passed,
      cargo_target: buildPlan.cargoTarget
    },
    release_ready: false
  };
  const smokeEvidence = {
    schema_version: 1,
    evidence_id: 'brownie-local-release-smoke-v1',
    generated_at: new Date().toISOString(),
    target,
    artifact_path: artifactRelativePath,
    artifact_sha256: artifactEvidence.artifact.sha256,
    status: smokeResults.every((entry) => entry.passed) ? 'satisfied' : 'failed',
    commands: smokeResults,
    release_ready: false
  };
  const checksumPath = resolveRepoRelative(repoRoot, normalizeRelativePath(path.join(outDir, 'SHA256SUMS')));
  fs.writeFileSync(checksumPath, `${artifactEvidence.artifact.sha256.replace(/^sha256:/, '')}  ${artifactRelativePath}\n`);
  writeJson(resolveRepoRelative(repoRoot, normalizeRelativePath(path.join(outDir, 'artifact-evidence.json'))), artifactEvidence);
  writeJson(resolveRepoRelative(repoRoot, normalizeRelativePath(path.join(outDir, 'smoke-evidence.json'))), smokeEvidence);

  return {
    target,
    outDir,
    artifact: artifactEvidence.artifact,
    smoke_status: smokeEvidence.status
  };
}

if (isMainModule()) {
  try {
    const result = buildLocalArtifact(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(`Local release artifact failed: ${error.message}`);
    process.exit(1);
  }
}
