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
const defaultVmDir = '.brownie/vms/brownie-windows';
const defaultArm64VmDir = '.brownie/vms/brownie-windows-arm64';
const defaultDiskSize = '80G';
const defaultMemory = '8G';
const defaultCpus = '4';
const defaultSshPort = '2222';
const defaultHostAlias = 'brownie-windows';
const defaultWorkspace = 'C:/Users/brownie/brownie';
const defaultDisplay = 'cocoa';
const defaultVncDisplay = '127.0.0.1:1';
const defaultVncPassword = 'brownie';
const defaultMonitorSocket = 'qemu-monitor.sock';
const defaultArm64StartupDir = 'uefi-startup';
const defaultArm64StartupImage = 'uefi-startup.dmg';

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
    vmDir: defaultVmDir,
    vmArch: 'x64',
    iso: null,
    diskSize: defaultDiskSize,
    memory: defaultMemory,
    cpus: defaultCpus,
    sshPort: defaultSshPort,
    hostAlias: defaultHostAlias,
    workspace: defaultWorkspace,
    display: defaultDisplay,
    vncDisplay: defaultVncDisplay,
    vncPassword: defaultVncPassword,
    monitorSocket: defaultMonitorSocket,
    noReboot: false,
    createDisk: true,
    registerTarget: true,
    launch: false,
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
    } else if (arg === '--vm-dir') {
      options.vmDir = argv[++index] ?? '';
    } else if (arg === '--vm-arch') {
      options.vmArch = argv[++index] ?? '';
    } else if (arg === '--iso') {
      options.iso = path.resolve(argv[++index] ?? '');
    } else if (arg === '--disk-size') {
      options.diskSize = argv[++index] ?? '';
    } else if (arg === '--memory') {
      options.memory = argv[++index] ?? '';
    } else if (arg === '--cpus') {
      options.cpus = argv[++index] ?? '';
    } else if (arg === '--ssh-port') {
      options.sshPort = argv[++index] ?? '';
    } else if (arg === '--host-alias') {
      options.hostAlias = argv[++index] ?? '';
    } else if (arg === '--workspace') {
      options.workspace = argv[++index] ?? '';
    } else if (arg === '--display') {
      options.display = argv[++index] ?? '';
    } else if (arg === '--vnc-display') {
      options.vncDisplay = argv[++index] ?? '';
    } else if (arg === '--vnc-password') {
      options.vncPassword = argv[++index] ?? '';
    } else if (arg === '--monitor-socket') {
      options.monitorSocket = argv[++index] ?? '';
    } else if (arg === '--no-reboot') {
      options.noReboot = true;
    } else if (arg === '--no-create-disk') {
      options.createDisk = false;
    } else if (arg === '--no-register-target') {
      options.registerTarget = false;
    } else if (arg === '--launch') {
      options.launch = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else {
      throw new Error(`Unknown Windows VM create argument: ${arg}`);
    }
  }
  if (!/^[A-Za-z0-9._-]+$/.test(options.hostAlias)) {
    throw new Error('--host-alias must be a bounded SSH host alias.');
  }
  if (!['x64', 'arm64'].includes(options.vmArch)) {
    throw new Error('--vm-arch must be x64 or arm64.');
  }
  if (!/^[0-9]{2,5}$/.test(options.sshPort)) {
    throw new Error('--ssh-port must be a TCP port number.');
  }
  if (!/^[0-9]+[GM]$/.test(options.diskSize)) {
    throw new Error('--disk-size must look like 80G.');
  }
  if (!/^[0-9]+[GM]$/.test(options.memory)) {
    throw new Error('--memory must look like 8G.');
  }
  if (!/^[0-9]+$/.test(options.cpus)) {
    throw new Error('--cpus must be an integer.');
  }
  if (!['cocoa', 'vnc'].includes(options.display)) {
    throw new Error('--display must be cocoa or vnc.');
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(options.vncDisplay)) {
    throw new Error('--vnc-display must be a bounded QEMU VNC display value.');
  }
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(options.vncPassword)) {
    throw new Error('--vnc-password must be 1-64 bounded characters.');
  }
  if (
    !/^[A-Za-z0-9._/-]+$/.test(options.monitorSocket) ||
    path.isAbsolute(options.monitorSocket) ||
    options.monitorSocket.split('/').includes('..')
  ) {
    throw new Error('--monitor-socket must be a bounded relative socket path.');
  }
  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 120_000,
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe']
  });
  return {
    command: [command, ...args].join(' '),
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exit_code: result.status,
    passed: result.status === 0
  };
}

function findQemuFirmware(vmArch) {
  const prefixes = [
    '/opt/homebrew/share/qemu',
    '/opt/homebrew/Cellar/qemu'
  ];
  const codeNames =
    vmArch === 'arm64'
      ? ['edk2-aarch64-code.fd']
      : ['edk2-x86_64-code.fd', 'edk2-x86_64-secure-code.fd'];
  const varsNames = vmArch === 'arm64' ? ['edk2-arm-vars.fd'] : [];
  let code = null;
  let vars = null;
  for (const prefix of prefixes) {
    if (!fs.existsSync(prefix)) {
      continue;
    }
    const stack = [prefix];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (!code && codeNames.includes(entry.name)) {
          code = full;
        } else if (!vars && varsNames.includes(entry.name)) {
          vars = full;
        }
      }
    }
  }
  return code ? { code, vars } : null;
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

function sshConfigSnippet(options) {
  return [
    `Host ${options.hostAlias}`,
    '  HostName 127.0.0.1',
    `  Port ${options.sshPort}`,
    '  User brownie',
    `  IdentityFile ${path.join(os.homedir(), '.ssh', 'brownie_release_runner')}`,
    '  IdentitiesOnly yes',
    '  StrictHostKeyChecking accept-new'
  ].join('\n');
}

function qemuBinary(options) {
  return options.vmArch === 'arm64' ? 'qemu-system-aarch64' : 'qemu-system-x86_64';
}

function qemuDisplayArgs(options) {
  if (options.display === 'vnc') {
    return [
      '-object',
      `secret,id=brownie-vnc-password,data=${options.vncPassword}`,
      '-display',
      `vnc=${options.vncDisplay},password-secret=brownie-vnc-password`
    ];
  }
  return ['-display', 'cocoa'];
}

function qemuX64Args(options, diskPath, firmware, monitorSocketPath) {
  const args = [
    '-machine',
    'q35',
    '-accel',
    'tcg',
    '-cpu',
    'max',
    '-smp',
    options.cpus,
    '-m',
    options.memory,
    '-drive',
    `if=pflash,format=raw,readonly=on,file=${firmware.code}`,
    '-device',
    'ich9-ahci,id=sata',
    '-drive',
    `if=none,id=systemdisk,file=${diskPath},format=qcow2,discard=unmap`,
    '-device',
    'ide-hd,drive=systemdisk,bus=sata.0',
    '-device',
    'e1000,netdev=net0',
    '-netdev',
    `user,id=net0,hostfwd=tcp:127.0.0.1:${options.sshPort}-:22`,
    '-usb',
    '-device',
    'usb-tablet',
    '-monitor',
    `unix:${monitorSocketPath},server,nowait`
  ];
  if (options.noReboot) {
    args.push('-no-reboot');
  }
  args.push(...qemuDisplayArgs(options));
  if (options.iso) {
    args.push('-cdrom', options.iso, '-boot', 'd');
  }
  return args;
}

function qemuArm64Args(options, diskPath, firmware, varsPath, monitorSocketPath, startupImagePath) {
  const tpmSocketPath = path.join(path.dirname(monitorSocketPath), 'swtpm.sock');
  const args = [
    '-machine',
    'virt,highmem=on',
    '-accel',
    'hvf',
    '-cpu',
    'host',
    '-smp',
    options.cpus,
    '-m',
    options.memory,
    '-drive',
    `if=pflash,format=raw,readonly=on,file=${firmware.code}`,
    '-drive',
    `if=pflash,format=raw,file=${varsPath}`,
    '-drive',
    `if=none,id=systemdisk,file=${diskPath},format=qcow2,discard=unmap`,
    '-device',
    'nvme,drive=systemdisk,serial=brownie-windows-arm64,bootindex=3',
    '-netdev',
    `user,id=net0,hostfwd=tcp:127.0.0.1:${options.sshPort}-:22`,
    '-device',
    'ramfb',
    '-device',
    'qemu-xhci',
    '-device',
    'usb-kbd',
    '-device',
    'usb-tablet',
    '-device',
    'virtio-net-pci,netdev=net0',
    '-chardev',
    `socket,id=chrtpm,path=${tpmSocketPath}`,
    '-tpmdev',
    'emulator,id=tpm0,chardev=chrtpm',
    '-device',
    'tpm-tis-device,tpmdev=tpm0',
    '-monitor',
    `unix:${monitorSocketPath},server,nowait`
  ];
  if (options.noReboot) {
    args.push('-no-reboot');
  }
  args.push(...qemuDisplayArgs(options));
  if (options.iso) {
    args.push(
      '-drive',
      `if=none,format=raw,media=disk,id=startup,file=${startupImagePath}`,
      '-device',
      'usb-storage,drive=startup,bootindex=1'
    );
    args.push(
      '-drive',
      `if=none,media=cdrom,id=cdrom,file=${options.iso},readonly=on`,
      '-device',
      'usb-storage,drive=cdrom,bootindex=2'
    );
  }
  return args;
}

function qemuArgs(options, diskPath, firmware, varsPath, monitorSocketPath, startupImagePath) {
  if (options.vmArch === 'arm64') {
    return qemuArm64Args(options, diskPath, firmware, varsPath, monitorSocketPath, startupImagePath);
  }
  return qemuX64Args(options, diskPath, firmware, monitorSocketPath);
}

function arm64StartupNsh() {
  return [
    'fs1:',
    '\\efi\\microsoft\\boot\\cdboot_noprompt.efi',
    '\\efi\\boot\\bootaa64.efi',
    'fs0:',
    '\\efi\\microsoft\\boot\\cdboot_noprompt.efi',
    '\\efi\\boot\\bootaa64.efi',
    ''
  ].join('\r\n');
}

function arm64AutounattendXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
  <settings pass="windowsPE">
    <component name="Microsoft-Windows-International-Core-WinPE" processorArchitecture="arm64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <SetupUILanguage>
        <UILanguage>ja-JP</UILanguage>
      </SetupUILanguage>
      <InputLocale>ja-JP</InputLocale>
      <SystemLocale>ja-JP</SystemLocale>
      <UILanguage>ja-JP</UILanguage>
      <UserLocale>ja-JP</UserLocale>
    </component>
    <component name="Microsoft-Windows-Setup" processorArchitecture="arm64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <RunSynchronous>
        <RunSynchronousCommand wcm:action="add">
          <Order>1</Order>
          <Description>Allow local QEMU release VM installation without hardware TPM</Description>
          <Path>reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassTPMCheck /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
        <RunSynchronousCommand wcm:action="add">
          <Order>2</Order>
          <Description>Allow local QEMU release VM installation without Secure Boot</Description>
          <Path>reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassSecureBootCheck /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
        <RunSynchronousCommand wcm:action="add">
          <Order>3</Order>
          <Description>Allow local QEMU release VM installation CPU compatibility</Description>
          <Path>reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassCPUCheck /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
      </RunSynchronous>
      <UserData>
        <AcceptEula>true</AcceptEula>
      </UserData>
    </component>
  </settings>
</unattend>
`;
}

function buildArm64StartupImage(paths) {
  const create = !fs.existsSync(paths.startupImagePath)
    ? run('hdiutil', [
      'create',
      '-size',
      '64m',
      '-fs',
      'MS-DOS',
      '-volname',
      'BROWNIEBOOT',
      '-ov',
      paths.startupImagePath
    ])
    : { passed: true, skipped: true };
  if (!create.passed) {
    return { create, passed: false };
  }
  fs.mkdirSync(paths.startupMountPath, { recursive: true });
  const attach = run('hdiutil', ['attach', paths.startupImagePath, '-mountpoint', paths.startupMountPath, '-nobrowse']);
  if (!attach.passed) {
    return { create, attach, passed: false };
  }
  try {
    fs.copyFileSync(paths.startupNshPath, path.join(paths.startupMountPath, 'startup.nsh'));
    fs.copyFileSync(paths.autounattendPath, path.join(paths.startupMountPath, 'autounattend.xml'));
    fs.copyFileSync(paths.bypassBatPath, path.join(paths.startupMountPath, 'a.bat'));
  } finally {
    run('hdiutil', ['detach', paths.startupMountPath]);
  }
  return { create, attach, passed: true };
}

function arm64BypassBat() {
  return [
    '@echo off',
    'reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassTPMCheck /t REG_DWORD /d 1 /f',
    'reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassSecureBootCheck /t REG_DWORD /d 1 /f',
    'reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassCPUCheck /t REG_DWORD /d 1 /f',
    'reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassRAMCheck /t REG_DWORD /d 1 /f',
    'reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassStorageCheck /t REG_DWORD /d 1 /f',
    'exit',
    ''
  ].join('\r\n');
}

export function createWindowsReleaseVm(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const manifestPath = normalizeRelativePath(options.manifestPath ?? defaultManifestPath);
  const configuredVmDir = options.vmDir === defaultVmDir && options.vmArch === 'arm64' ? defaultArm64VmDir : options.vmDir;
  const vmDir = normalizeRelativePath(configuredVmDir ?? defaultVmDir);
  const vmFullDir = resolveRepoRelative(repoRoot, vmDir);
  const diskPath = path.join(vmFullDir, `brownie-windows-${options.vmArch}.qcow2`);
  const monitorSocketPath = path.resolve(vmFullDir, options.monitorSocket);
  const monitorSocketRelativePath = normalizeRelativePath(path.relative(repoRoot, monitorSocketPath));
  const varsPath = path.join(vmFullDir, 'edk2-vars.fd');
  const varsRelativePath = normalizeRelativePath(path.relative(repoRoot, varsPath));
  const startupDirPath = path.join(vmFullDir, defaultArm64StartupDir);
  const startupNshPath = path.join(startupDirPath, 'startup.nsh');
  const startupNshRelativePath = normalizeRelativePath(path.relative(repoRoot, startupNshPath));
  const autounattendPath = path.join(startupDirPath, 'autounattend.xml');
  const autounattendRelativePath = normalizeRelativePath(path.relative(repoRoot, autounattendPath));
  const bypassBatPath = path.join(startupDirPath, 'a.bat');
  const bypassBatRelativePath = normalizeRelativePath(path.relative(repoRoot, bypassBatPath));
  const startupImagePath = path.join(vmFullDir, defaultArm64StartupImage);
  const startupImageRelativePath = normalizeRelativePath(path.relative(repoRoot, startupImagePath));
  const startupMountPath = path.join(vmFullDir, 'uefi-startup-mount');
  const tpmStateDir = path.join(vmFullDir, 'swtpm-state');
  const tpmSocketPath = path.join(vmFullDir, 'swtpm.sock');
  const tpmPidPath = path.join(vmFullDir, 'swtpm.pid');
  const firmware = findQemuFirmware(options.vmArch);
  if (!firmware) {
    throw new Error(`QEMU ${options.vmArch} EDK2 firmware was not found.`);
  }
  if (options.vmArch === 'arm64' && !firmware.vars) {
    throw new Error('QEMU arm64 EDK2 vars firmware was not found.');
  }
  if (options.iso && !options.dryRun && !fs.existsSync(options.iso)) {
    throw new Error(`Windows ISO was not found: ${options.iso}`);
  }

  const target = {
    id: 'win32-x64',
    kind: 'ssh',
    host: options.hostAlias,
    workspace: options.workspace,
    shell: 'powershell',
    runner_arch: options.vmArch,
    required: true
  };
  const manifest = upsertTarget(readManifest(repoRoot, manifestPath), target);
  const errors = validateLocalReleaseTargetsManifest(manifest, { owner: manifestPath });
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
  const launchCommand = [
    qemuBinary(options),
    ...qemuArgs(options, diskPath, firmware, varsPath, monitorSocketPath, startupImagePath)
  ].join(' ');
  const result = {
    dry_run: options.dryRun,
    vm_arch: options.vmArch,
    vm_dir: vmDir,
    disk: normalizeRelativePath(path.relative(repoRoot, diskPath)),
    monitor_socket: monitorSocketRelativePath,
    firmware: firmware.code,
    vars: options.vmArch === 'arm64' ? varsRelativePath : null,
    startup_nsh: options.vmArch === 'arm64' && options.iso ? startupNshRelativePath : null,
    autounattend: options.vmArch === 'arm64' && options.iso ? autounattendRelativePath : null,
    bypass_bat: options.vmArch === 'arm64' && options.iso ? bypassBatRelativePath : null,
    startup_image: options.vmArch === 'arm64' && options.iso ? startupImageRelativePath : null,
    tpm_state_dir: options.vmArch === 'arm64' ? normalizeRelativePath(path.relative(repoRoot, tpmStateDir)) : null,
    target,
    ssh_config: sshConfigSnippet(options),
    launch_command: launchCommand,
    display: options.display,
    vnc_url: options.display === 'vnc' ? `vnc://${options.vncDisplay.replace(/:(\d+)$/, (_, display) => `:${5900 + Number(display)}`)}` : null,
    vnc_password: options.display === 'vnc' ? options.vncPassword : null,
    next_manual_step: 'Install Windows in the QEMU window, create the brownie user, enable OpenSSH Server, authorize the Mac SSH public key, then verify ssh brownie-windows.'
  };
  if (options.dryRun) {
    return result;
  }
  fs.mkdirSync(vmFullDir, { recursive: true });
  if (options.vmArch === 'arm64' && !fs.existsSync(varsPath)) {
    fs.copyFileSync(firmware.vars, varsPath);
    result.vars_create = { path: varsRelativePath, source: firmware.vars, passed: true };
  }
  if (options.vmArch === 'arm64' && options.iso) {
    fs.mkdirSync(startupDirPath, { recursive: true });
    fs.writeFileSync(startupNshPath, arm64StartupNsh());
    fs.writeFileSync(autounattendPath, arm64AutounattendXml());
    fs.writeFileSync(bypassBatPath, arm64BypassBat());
    result.startup_nsh_create = { path: startupNshRelativePath, passed: true };
    result.autounattend_create = { path: autounattendRelativePath, passed: true };
    result.bypass_bat_create = { path: bypassBatRelativePath, passed: true };
    const startupImage = buildArm64StartupImage({
      startupImagePath,
      startupMountPath,
      startupNshPath,
      autounattendPath,
      bypassBatPath
    });
    result.startup_image_create = { path: startupImageRelativePath, ...startupImage };
    if (!startupImage.passed) {
      result.passed = false;
      return result;
    }
  }
  if (options.createDisk && !fs.existsSync(diskPath)) {
    const disk = run('qemu-img', ['create', '-f', 'qcow2', diskPath, options.diskSize], { cwd: repoRoot });
    if (!disk.passed) {
      return { ...result, disk_create: disk, passed: false };
    }
    result.disk_create = disk;
  }
  if (options.registerTarget) {
    writeManifest(repoRoot, manifestPath, manifest);
    result.manifest = manifestPath;
  }
  if (options.launch) {
    fs.rmSync(monitorSocketPath, { force: true });
    if (options.vmArch === 'arm64') {
      fs.mkdirSync(tpmStateDir, { recursive: true });
      fs.rmSync(tpmSocketPath, { force: true });
      fs.rmSync(tpmPidPath, { force: true });
      const swtpm = run('swtpm', [
        'socket',
        '--tpm2',
        '--tpmstate',
        `dir=${tpmStateDir}`,
        '--ctrl',
        `type=unixio,path=${tpmSocketPath},mode=0600`,
        '--pid',
        `file=${tpmPidPath}`,
        '--daemon'
      ], { cwd: repoRoot });
      result.swtpm = swtpm;
      if (!swtpm.passed) {
        result.passed = false;
        return result;
      }
    }
    const launch = run(
      qemuBinary(options),
      qemuArgs(options, diskPath, firmware, varsPath, monitorSocketPath, startupImagePath),
      { cwd: repoRoot, inherit: true, timeoutMs: 86_400_000 }
    );
    result.launch = launch;
    result.passed = launch.passed;
    return result;
  }
  result.passed = true;
  return result;
}

if (isMainModule()) {
  try {
    const result = createWindowsReleaseVm(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.passed === false) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`Windows release VM create failed: ${error.message}`);
    process.exit(1);
  }
}
