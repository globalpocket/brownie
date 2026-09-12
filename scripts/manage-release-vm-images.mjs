import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultImageRoot = '.brownie/private/vm-images';
const defaultLinuxInstance = 'brownie-linux';
const defaultLinuxSnapshot = 'brownie-golden';
const defaultWindowsHost = 'brownie-windows';
const defaultWindowsVmDir = '.brownie/private/vms/brownie-windows-arm64';
const defaultWindowsSnapshot = 'brownie-windows-arm64-golden';

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

function shortWindowsRuntimeDir(vmFullDir) {
  const fingerprint = crypto.createHash('sha256').update(vmFullDir).digest('hex').slice(0, 12);
  return path.join('/tmp', `brownie-win-${fingerprint}`);
}

function parseArgs(argv) {
  const options = {
    repoRoot: defaultRepoRoot,
    action: 'status',
    target: 'all',
    imageRoot: defaultImageRoot,
    linuxInstance: defaultLinuxInstance,
    linuxSnapshot: defaultLinuxSnapshot,
    windowsHost: defaultWindowsHost,
    windowsVmDir: defaultWindowsVmDir,
    windowsSnapshot: defaultWindowsSnapshot,
    windowsVmArch: 'arm64',
    windowsDisplay: 'vnc',
    windowsVncDisplay: '127.0.0.1:1',
    dryRun: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--repo-root') {
      options.repoRoot = path.resolve(argv[++index] ?? '');
    } else if (arg === '--action') {
      options.action = argv[++index] ?? '';
    } else if (arg === '--target') {
      options.target = argv[++index] ?? '';
    } else if (arg === '--image-root') {
      options.imageRoot = argv[++index] ?? '';
    } else if (arg === '--linux-instance') {
      options.linuxInstance = argv[++index] ?? '';
    } else if (arg === '--linux-snapshot') {
      options.linuxSnapshot = argv[++index] ?? '';
    } else if (arg === '--windows-host') {
      options.windowsHost = argv[++index] ?? '';
    } else if (arg === '--windows-vm-dir') {
      options.windowsVmDir = argv[++index] ?? '';
    } else if (arg === '--windows-snapshot') {
      options.windowsSnapshot = argv[++index] ?? '';
    } else if (arg === '--windows-vm-arch') {
      options.windowsVmArch = argv[++index] ?? '';
    } else if (arg === '--windows-display') {
      options.windowsDisplay = argv[++index] ?? '';
    } else if (arg === '--windows-vnc-display') {
      options.windowsVncDisplay = argv[++index] ?? '';
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else {
      throw new Error(`Unknown VM image argument: ${arg}`);
    }
  }
  if (!['status', 'shutdown', 'snapshot', 'start'].includes(options.action)) {
    throw new Error('--action must be status, shutdown, snapshot, or start.');
  }
  if (!['all', 'linux', 'windows'].includes(options.target)) {
    throw new Error('--target must be all, linux, or windows.');
  }
  for (const [name, value] of [
    ['--linux-instance', options.linuxInstance],
    ['--linux-snapshot', options.linuxSnapshot],
    ['--windows-host', options.windowsHost],
    ['--windows-snapshot', options.windowsSnapshot]
  ]) {
    if (!/^[A-Za-z0-9._-]+$/.test(value)) {
      throw new Error(`${name} must be a bounded name.`);
    }
  }
  if (!['arm64', 'x64'].includes(options.windowsVmArch)) {
    throw new Error('--windows-vm-arch must be arm64 or x64.');
  }
  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 120_000,
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

function sha256File(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size <= 1_500_000_000) {
    return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
  }
  if (process.platform === 'win32') {
    const result = run('certutil', ['-hashfile', filePath, 'SHA256'], { timeoutMs: 1_800_000 });
    const match = /^[A-Fa-f0-9]{64}$/m.exec(result.stdout);
    if (!result.passed || !match) {
      throw new Error(`Failed to hash ${filePath}: ${result.stderr || result.stdout}`);
    }
    return `sha256:${match[0].toLowerCase()}`;
  }
  const result = run('shasum', ['-a', '256', filePath], { timeoutMs: 1_800_000 });
  const hash = result.stdout.trim().split(/\s+/)[0];
  if (!result.passed || !/^[A-Fa-f0-9]{64}$/.test(hash)) {
    throw new Error(`Failed to hash ${filePath}: ${result.stderr || result.stdout}`);
  }
  return `sha256:${hash.toLowerCase()}`;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function linuxInfo(repoRoot, instance) {
  const info = run('multipass', ['info', instance], { cwd: repoRoot });
  const state = /State:\s+([^\n]+)/.exec(info.stdout)?.[1]?.trim() ?? null;
  return {
    instance,
    exists: info.passed,
    state,
    command: info.command,
    exit_code: info.exit_code
  };
}

function linuxStop(repoRoot, instance) {
  const info = linuxInfo(repoRoot, instance);
  if (!info.exists || info.state === 'Stopped') {
    return { ...info, changed: false };
  }
  const stop = run('multipass', ['stop', instance], { cwd: repoRoot, timeoutMs: 600_000 });
  return { ...linuxInfo(repoRoot, instance), changed: stop.passed, stop };
}

function linuxStart(repoRoot, instance) {
  const info = linuxInfo(repoRoot, instance);
  if (!info.exists || info.state === 'Running') {
    return { ...info, changed: false };
  }
  const start = run('multipass', ['start', instance], { cwd: repoRoot, timeoutMs: 600_000 });
  return { ...linuxInfo(repoRoot, instance), changed: start.passed, start };
}

function linuxSnapshot(repoRoot, instance, snapshotName) {
  const stopped = linuxStop(repoRoot, instance);
  if (!stopped.exists) {
    return { target: 'linux', instance, passed: false, error: `Multipass instance not found: ${instance}`, stopped };
  }
  const existing = run('multipass', ['info', `${instance}.${snapshotName}`], { cwd: repoRoot });
  if (existing.passed) {
    return {
      target: 'linux',
      instance,
      snapshot: `${instance}.${snapshotName}`,
      stopped,
      skipped: true,
      reason: 'snapshot_already_exists',
      passed: true
    };
  }
  const snapshot = run('multipass', [
    'snapshot',
    instance,
    '--name',
    snapshotName,
    '--comment',
    'Brownie local release golden image'
  ], { cwd: repoRoot, timeoutMs: 600_000 });
  return {
    target: 'linux',
    instance,
    snapshot: `${instance}.${snapshotName}`,
    stopped,
    command: snapshot.command,
    exit_code: snapshot.exit_code,
    passed: snapshot.passed,
    stderr: snapshot.stderr
  };
}

function windowsPaths(repoRoot, vmDir, vmArch) {
  const fullDir = resolveRepoRelative(repoRoot, vmDir);
  const disk = path.join(fullDir, `brownie-windows-${vmArch}.qcow2`);
  const runtimeDir = vmArch === 'arm64' ? shortWindowsRuntimeDir(fullDir) : fullDir;
  return {
    fullDir,
    disk,
    vars: path.join(fullDir, 'edk2-vars.fd'),
    tpmStateDir: path.join(fullDir, 'swtpm-state'),
    runtimeDir,
    monitorSocket: path.join(runtimeDir, 'qemu-monitor.sock')
  };
}

function windowsProcessStatus(repoRoot, vmDir, vmArch) {
  const paths = windowsPaths(repoRoot, vmDir, vmArch);
  const pgrep = run('pgrep', ['-fl', paths.disk], { cwd: repoRoot });
  return {
    vm_dir: normalizeRelativePath(path.relative(repoRoot, paths.fullDir)),
    disk: normalizeRelativePath(path.relative(repoRoot, paths.disk)),
    disk_exists: fs.existsSync(paths.disk),
    runtime_dir: paths.runtimeDir,
    monitor_socket_exists: fs.existsSync(paths.monitorSocket),
    monitor_socket: paths.monitorSocket,
    running: pgrep.passed && pgrep.stdout.trim().length > 0,
    process: pgrep.stdout.trim()
  };
}

function windowsSshReachable(repoRoot, host) {
  const result = run('ssh', [
    host,
    'powershell',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    'hostname'
  ], { cwd: repoRoot, timeoutMs: 15_000 });
  return {
    host,
    reachable: result.passed,
    hostname: result.stdout.trim() || null,
    exit_code: result.exit_code
  };
}

function waitUntilWindowsStopped(repoRoot, vmDir, vmArch, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = windowsProcessStatus(repoRoot, vmDir, vmArch);
    if (!status.running) {
      return { stopped: true, status };
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
  }
  return { stopped: false, status: windowsProcessStatus(repoRoot, vmDir, vmArch) };
}

function windowsStop(repoRoot, host, vmDir, vmArch) {
  const before = windowsProcessStatus(repoRoot, vmDir, vmArch);
  if (!before.running) {
    return { target: 'windows', before, changed: false, passed: true };
  }
  const shutdown = run('ssh', [
    host,
    'powershell',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    'Stop-Computer -Force'
  ], { cwd: repoRoot, timeoutMs: 30_000 });
  const wait = waitUntilWindowsStopped(repoRoot, vmDir, vmArch);
  return {
    target: 'windows',
    before,
    shutdown: {
      command: shutdown.command,
      exit_code: shutdown.exit_code,
      passed: shutdown.passed
    },
    wait,
    changed: wait.stopped,
    passed: wait.stopped
  };
}

function copyIfExists(source, destination) {
  if (!fs.existsSync(source)) {
    return null;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
  return {
    path: destination,
    bytes: fs.statSync(destination).isFile() ? fs.statSync(destination).size : null,
    sha256: fs.statSync(destination).isFile() ? sha256File(destination) : null
  };
}

function windowsSnapshot(repoRoot, options) {
  const status = windowsProcessStatus(repoRoot, options.windowsVmDir, options.windowsVmArch);
  if (status.running) {
    return {
      target: 'windows',
      passed: false,
      error: 'Windows VM is still running; shut it down before snapshotting the qcow2 image.',
      status
    };
  }
  const paths = windowsPaths(repoRoot, options.windowsVmDir, options.windowsVmArch);
  if (!fs.existsSync(paths.disk)) {
    return { target: 'windows', passed: false, error: `Windows disk not found: ${status.disk}`, status };
  }
  const snapshotDir = resolveRepoRelative(
    repoRoot,
    normalizeRelativePath(path.join(options.imageRoot, 'windows', options.windowsSnapshot))
  );
  const diskCopy = path.join(snapshotDir, path.basename(paths.disk));
  const varsCopy = path.join(snapshotDir, path.basename(paths.vars));
  const tpmCopy = path.join(snapshotDir, 'swtpm-state');
  fs.mkdirSync(snapshotDir, { recursive: true });
  const convert = run('qemu-img', ['convert', '-O', 'qcow2', paths.disk, diskCopy], {
    cwd: repoRoot,
    timeoutMs: 1_800_000
  });
  if (!convert.passed) {
    return { target: 'windows', passed: false, command: convert.command, stderr: convert.stderr, status };
  }
  const vars = copyIfExists(paths.vars, varsCopy);
  const tpm = copyIfExists(paths.tpmStateDir, tpmCopy);
  const manifest = {
    schema_version: 1,
    image_id: 'brownie-windows-release-golden-image-v1',
    generated_at: new Date().toISOString(),
    vm_arch: options.windowsVmArch,
    source_vm_dir: status.vm_dir,
    disk: {
      path: normalizeRelativePath(path.relative(repoRoot, diskCopy)),
      sha256: sha256File(diskCopy),
      bytes: fs.statSync(diskCopy).size
    },
    edk2_vars: vars
      ? {
          path: normalizeRelativePath(path.relative(repoRoot, vars.path)),
          sha256: vars.sha256,
          bytes: vars.bytes
        }
      : null,
    swtpm_state: tpm
      ? {
          path: normalizeRelativePath(path.relative(repoRoot, tpm.path))
        }
      : null,
    restore_note: `Restore by copying this directory contents back to ${status.vm_dir} while the VM is stopped.`
  };
  const manifestPath = path.join(snapshotDir, 'image-manifest.json');
  writeJson(manifestPath, manifest);
  return {
    target: 'windows',
    snapshot_dir: normalizeRelativePath(path.relative(repoRoot, snapshotDir)),
    manifest: normalizeRelativePath(path.relative(repoRoot, manifestPath)),
    disk: manifest.disk,
    passed: true
  };
}

function windowsStart(repoRoot, options) {
  const status = windowsProcessStatus(repoRoot, options.windowsVmDir, options.windowsVmArch);
  if (status.running) {
    return { target: 'windows', changed: false, passed: true, status };
  }
  const args = [
    'scripts/create-windows-release-vm.mjs',
    '--vm-dir',
    options.windowsVmDir,
    '--vm-arch',
    options.windowsVmArch,
    '--display',
    options.windowsDisplay,
    '--vnc-display',
    options.windowsVncDisplay,
    '--no-create-disk',
    '--no-register-target',
    '--launch'
  ];
  if (options.dryRun) {
    return { target: 'windows', dry_run: true, command: ['node', ...args].join(' '), passed: true };
  }
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  const after = windowsProcessStatus(repoRoot, options.windowsVmDir, options.windowsVmArch);
  if (!after.running) {
    return {
      target: 'windows',
      changed: false,
      command: ['node', ...args].join(' '),
      pid: child.pid,
      status: after,
      passed: false,
      error: 'Windows VM launch process exited before QEMU stayed running.'
    };
  }
  return {
    target: 'windows',
    changed: true,
    command: ['node', ...args].join(' '),
    pid: child.pid,
    status: after,
    passed: true
  };
}

function selectedTargets(target) {
  return target === 'all' ? ['linux', 'windows'] : [target];
}

export function manageReleaseVmImages(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const results = [];
  for (const target of selectedTargets(options.target)) {
    if (target === 'linux') {
      if (options.action === 'status') {
        results.push({ target, ...linuxInfo(repoRoot, options.linuxInstance) });
      } else if (options.action === 'shutdown') {
        results.push({ target, ...linuxStop(repoRoot, options.linuxInstance) });
      } else if (options.action === 'snapshot') {
        results.push(linuxSnapshot(repoRoot, options.linuxInstance, options.linuxSnapshot));
      } else if (options.action === 'start') {
        results.push({ target, ...linuxStart(repoRoot, options.linuxInstance) });
      }
    } else if (target === 'windows') {
      if (options.action === 'status') {
        results.push({ target, ...windowsProcessStatus(repoRoot, options.windowsVmDir, options.windowsVmArch), ssh: windowsSshReachable(repoRoot, options.windowsHost) });
      } else if (options.action === 'shutdown') {
        results.push(windowsStop(repoRoot, options.windowsHost, options.windowsVmDir, options.windowsVmArch));
      } else if (options.action === 'snapshot') {
        results.push(windowsSnapshot(repoRoot, options));
      } else if (options.action === 'start') {
        results.push(windowsStart(repoRoot, options));
      }
    }
  }
  return {
    action: options.action,
    target: options.target,
    results,
    passed: results.every((result) => result.passed !== false)
  };
}

if (isMainModule()) {
  try {
    const result = manageReleaseVmImages(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.passed) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`Release VM image management failed: ${error.message}`);
    process.exit(1);
  }
}
