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
const defaultVmName = 'brownie-linux';
const defaultWorkspace = '/home/ubuntu/brownie';
const defaultTargetId = 'linux-arm64';

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
    manifestPath: process.env.BROWNIE_LOCAL_RELEASE_TARGETS ?? defaultManifestPath,
    name: defaultVmName,
    image: '24.04',
    cpus: '4',
    memory: '6G',
    disk: '30G',
    workspace: defaultWorkspace,
    sshUser: 'ubuntu',
    sshKey: path.join(os.homedir(), '.ssh', 'brownie_release_runner.pub'),
    dryRun: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--repo-root') {
      options.repoRoot = path.resolve(argv[++index] ?? '');
    } else if (arg === '--manifest') {
      options.manifestPath = argv[++index] ?? '';
    } else if (arg === '--name') {
      options.name = argv[++index] ?? '';
    } else if (arg === '--image') {
      options.image = argv[++index] ?? '';
    } else if (arg === '--cpus') {
      options.cpus = argv[++index] ?? '';
    } else if (arg === '--memory') {
      options.memory = argv[++index] ?? '';
    } else if (arg === '--disk') {
      options.disk = argv[++index] ?? '';
    } else if (arg === '--workspace') {
      options.workspace = argv[++index] ?? '';
    } else if (arg === '--ssh-user') {
      options.sshUser = argv[++index] ?? '';
    } else if (arg === '--ssh-key') {
      options.sshKey = path.resolve(argv[++index] ?? '');
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else {
      throw new Error(`Unknown Linux VM create argument: ${arg}`);
    }
  }
  if (!/^[A-Za-z0-9._-]+$/.test(options.name)) {
    throw new Error('--name must be a bounded Multipass instance name.');
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(options.workspace) || !options.workspace.startsWith('/')) {
    throw new Error('--workspace must be an absolute Linux path without shell metacharacters or spaces.');
  }
  if (!/^[A-Za-z0-9._-]+$/.test(options.sshUser)) {
    throw new Error('--ssh-user must be a bounded username.');
  }
  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeoutMs ?? 600_000,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  return {
    command: [command, ...args].join(' '),
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exit_code: result.status,
    passed: result.status === 0
  };
}

function instanceExists(name, repoRoot) {
  const result = run('multipass', ['info', name], { cwd: repoRoot });
  return result.passed;
}

function withTempCloudInit(publicKey, callback) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-linux-cloud-init-'));
  const cloudInitPath = path.join(tempDir, 'cloud-init.yaml');
  try {
    fs.writeFileSync(cloudInitPath, `${cloudInit(publicKey)}\n`, { mode: 0o600 });
    return callback(cloudInitPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function readManifest(repoRoot, manifestPath) {
  const fullPath = resolveRepoRelative(repoRoot, manifestPath);
  if (!fs.existsSync(fullPath)) {
    return {
      schema_version: 1,
      targets: [
        {
          id: 'darwin-arm64',
          kind: 'local',
          required: true
        }
      ]
    };
  }
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function writeManifest(repoRoot, manifestPath, manifest) {
  const fullPath = resolveRepoRelative(repoRoot, manifestPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function upsertTarget(manifest, target) {
  const targets = Array.isArray(manifest.targets) ? manifest.targets.filter((entry) => entry.id !== target.id) : [];
  targets.push(target);
  const order = new Map([
    ['darwin-arm64', 0],
    ['linux-arm64', 1],
    ['linux-x64', 2],
    ['win32-x64', 3]
  ]);
  return {
    schema_version: 1,
    targets: targets.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99))
  };
}

function cloudInit(publicKey) {
  return `#cloud-config
ssh_authorized_keys:
  - ${publicKey}
runcmd:
  - [ bash, -lc, "mkdir -p /home/ubuntu/.ssh && chown -R ubuntu:ubuntu /home/ubuntu/.ssh" ]
`;
}

export function createLinuxReleaseVm(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const manifestPath = normalizeRelativePath(options.manifestPath ?? defaultManifestPath);
  const publicKey = fs.existsSync(options.sshKey) ? fs.readFileSync(options.sshKey, 'utf8').trim() : null;
  if (!publicKey && !options.dryRun) {
    throw new Error(`SSH public key is missing: ${options.sshKey}`);
  }
  const manifest = readManifest(repoRoot, manifestPath);
  const updatedManifest = upsertTarget(manifest, {
    id: defaultTargetId,
    kind: 'ssh',
    host: options.name,
    workspace: options.workspace,
    shell: 'posix',
    required: true
  });
  const errors = validateLocalReleaseTargetsManifest(updatedManifest, { owner: manifestPath });
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  const commands = [
    ['multipass', ['launch', options.image, '--name', options.name, '--cpus', options.cpus, '--memory', options.memory, '--disk', options.disk, '--cloud-init', '<temp-cloud-init.yaml>']],
    ['multipass', ['exec', options.name, '--', 'bash', '-lc', `mkdir -p ${options.workspace} && sudo chown -R ${options.sshUser}:${options.sshUser} ${options.workspace}`]]
  ];
  if (options.dryRun) {
    return {
      dry_run: true,
      manifest: manifestPath,
      target: updatedManifest.targets.find((target) => target.id === defaultTargetId),
      commands: commands.map(([command, args]) => [command, ...args].join(' '))
    };
  }

  const preExisting = instanceExists(options.name, repoRoot);
  const launch = preExisting
    ? {
        command: `multipass info ${options.name}`,
        stdout: '',
        stderr: '',
        exit_code: 0,
        passed: true,
        skipped: true,
        reason: 'instance_already_exists'
      }
    : withTempCloudInit(publicKey, (cloudInitPath) => run(
      commands[0][0],
      commands[0][1].map((arg) => arg === '<temp-cloud-init.yaml>' ? cloudInitPath : arg),
      { cwd: repoRoot }
    ));
  const launchOutput = `${launch.stdout}\n${launch.stderr}`;
  const alreadyExists = launch.exit_code !== 0 && /already exists|exists/i.test(launchOutput);
  if (!launch.passed && !alreadyExists) {
    return { dry_run: false, manifest: manifestPath, target: defaultTargetId, launch, passed: false };
  }
  const workspace = run(commands[1][0], commands[1][1], { cwd: repoRoot });
  if (!workspace.passed) {
    return { dry_run: false, manifest: manifestPath, target: defaultTargetId, launch, workspace, passed: false };
  }
  writeManifest(repoRoot, manifestPath, updatedManifest);
  return {
    dry_run: false,
    manifest: manifestPath,
    target: updatedManifest.targets.find((target) => target.id === defaultTargetId),
    launch: { exit_code: launch.exit_code, passed: launch.passed || alreadyExists, skipped: launch.skipped === true },
    workspace,
    passed: true
  };
}

if (isMainModule()) {
  try {
    const result = createLinuxReleaseVm(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.passed && !result.dry_run) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`Linux release VM create failed: ${error.message}`);
    process.exit(1);
  }
}
