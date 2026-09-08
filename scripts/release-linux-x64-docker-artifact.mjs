import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const rustTargetTriple = 'x86_64-unknown-linux-musl';

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function parseArgs(argv) {
  const options = {
    repoRoot: defaultRepoRoot,
    platform: 'linux/amd64',
    smokeImage: 'alpine:3.20',
    target: 'linux-x64',
    outDir: '.brownie/release-evidence/artifacts/linux-x64'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--repo-root') {
      options.repoRoot = path.resolve(argv[++index] ?? '');
    } else if (arg === '--platform') {
      options.platform = argv[++index] ?? '';
    } else if (arg === '--smoke-image') {
      options.smokeImage = argv[++index] ?? '';
    } else if (arg === '--target') {
      options.target = argv[++index] ?? '';
    } else if (arg === '--out-dir') {
      options.outDir = argv[++index] ?? '';
    } else {
      throw new Error(`Unknown linux-x64 Docker artifact argument: ${arg}`);
    }
  }
  if (options.platform !== 'linux/amd64') {
    throw new Error('--platform must be linux/amd64.');
  }
  if (options.target !== 'linux-x64') {
    throw new Error('--target must be linux-x64.');
  }
  return options;
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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 1_800_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...(options.env ?? {}),
      CARGO_TERM_COLOR: 'never'
    }
  });
  return {
    command: [command, ...args].join(' '),
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exit_code: result.status,
    passed: result.status === 0
  };
}

function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function dockerCommand() {
  const direct = run('docker', ['version']);
  if (direct.passed) {
    return ['docker'];
  }
  const sudo = run('sudo', ['docker', 'version']);
  if (sudo.passed) {
    return ['sudo', 'docker'];
  }
  throw new Error('Docker is not available. Run release:vm-bootstrap for the linux-x64 target first.');
}

function smoke(repoRoot, docker, platform, image, artifactRelativePath, args) {
  const result = run(docker[0], [
    ...docker.slice(1),
    'run',
    '--rm',
    '--platform',
    platform,
    '-v',
    `${repoRoot}:/workspace:ro`,
    '-w',
    '/workspace',
    image,
    `/workspace/${artifactRelativePath}`,
    ...args
  ], {
    cwd: repoRoot,
    timeoutMs: 120_000
  });
  return {
    args,
    exit_code: result.exit_code,
    passed: result.passed
  };
}

export function buildLinuxX64DockerArtifact(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const platform = options.platform ?? 'linux/amd64';
  const smokeImage = options.smokeImage ?? 'alpine:3.20';
  const target = options.target ?? 'linux-x64';
  const outDir = normalizeRelativePath(options.outDir ?? '.brownie/release-evidence/artifacts/linux-x64');
  const outFull = resolveRepoRelative(repoRoot, outDir);
  fs.mkdirSync(outFull, { recursive: true });

  const rustup = run('rustup', ['target', 'add', rustTargetTriple], { cwd: repoRoot });
  if (!rustup.passed) {
    throw new Error(`rustup target add failed for ${rustTargetTriple}`);
  }
  const build = run('cargo', ['build', '--release', '-p', 'brownie-cli', '--target', rustTargetTriple], {
    cwd: repoRoot,
    env: {
      CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER: 'rust-lld'
    }
  });
  if (!build.passed) {
    throw new Error(`cargo cross release build failed for ${target}`);
  }

  const sourceArtifact = resolveRepoRelative(repoRoot, `target/${rustTargetTriple}/release/brownie`);
  if (!fs.existsSync(sourceArtifact)) {
    throw new Error(`Expected release artifact is missing: target/${rustTargetTriple}/release/brownie`);
  }
  const artifactRelativePath = normalizeRelativePath(path.join(outDir, 'brownie'));
  const artifactPath = resolveRepoRelative(repoRoot, artifactRelativePath);
  fs.copyFileSync(sourceArtifact, artifactPath);
  fs.chmodSync(artifactPath, 0o755);

  const docker = dockerCommand();
  const smokeResults = [
    smoke(repoRoot, docker, platform, smokeImage, artifactRelativePath, ['--version']),
    smoke(repoRoot, docker, platform, smokeImage, artifactRelativePath, ['help', 'run'])
  ];
  const smokePassed = smokeResults.every((entry) => entry.passed);
  const artifactEvidence = {
    schema_version: 1,
    evidence_id: 'brownie-linux-x64-docker-release-artifact-v1',
    generated_at: new Date().toISOString(),
    target,
    platform: 'linux',
    arch: 'x64',
    build_host_platform: process.platform,
    build_host_arch: process.arch,
    container_platform: platform,
    smoke_image: smokeImage,
    hostname_hash: `sha256:${crypto.createHash('sha256').update(os.hostname()).digest('hex')}`,
    artifact: {
      path: artifactRelativePath,
      sha256: sha256File(artifactPath),
      bytes: fs.statSync(artifactPath).size,
      target
    },
    build: {
      rust_target: rustTargetTriple,
      linker: 'rust-lld',
      command: build.command,
      exit_code: build.exit_code,
      passed: build.passed
    },
    release_ready: false
  };
  const smokeEvidence = {
    schema_version: 1,
    evidence_id: 'brownie-linux-x64-docker-release-smoke-v1',
    generated_at: new Date().toISOString(),
    target,
    artifact_path: artifactRelativePath,
    artifact_sha256: artifactEvidence.artifact.sha256,
    container_platform: platform,
    smoke_image: smokeImage,
    status: smokePassed ? 'satisfied' : 'failed',
    commands: smokeResults,
    release_ready: false
  };
  const checksumPath = resolveRepoRelative(repoRoot, normalizeRelativePath(path.join(outDir, 'SHA256SUMS')));
  fs.writeFileSync(checksumPath, `${artifactEvidence.artifact.sha256.replace(/^sha256:/, '')}  ${artifactRelativePath}\n`);
  writeJson(resolveRepoRelative(repoRoot, normalizeRelativePath(path.join(outDir, 'artifact-evidence.json'))), artifactEvidence);
  writeJson(resolveRepoRelative(repoRoot, normalizeRelativePath(path.join(outDir, 'smoke-evidence.json'))), smokeEvidence);

  const result = {
    target,
    platform,
    outDir,
    artifact: artifactEvidence.artifact,
    smoke_status: smokeEvidence.status
  };
  if (!smokePassed) {
    throw new Error(`linux-x64 Docker smoke failed for ${target}`);
  }
  return result;
}

if (isMainModule()) {
  try {
    const result = buildLinuxX64DockerArtifact(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(`Linux x64 Docker artifact failed: ${error.message}`);
    process.exit(1);
  }
}
