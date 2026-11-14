import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkArgs = ['check', '--workspace', '--all-targets', '--all-features', '--locked'];

function versionParts(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(value)) {
    throw new Error('Cargo metadata must declare an ordinary stable Rust version');
  }
  return value.split('.').map(Number).concat([0]).slice(0, 3);
}

function compare(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  }
  return 0;
}

export function declaredMinimum(metadata) {
  if (!Array.isArray(metadata?.packages) || !Array.isArray(metadata?.workspace_members)
      || metadata.workspace_members.length === 0) {
    throw new Error('Complete Cargo workspace metadata is required');
  }
  const packages = new Map(metadata.packages.map(p => [p.id, p]));
  if (packages.size !== metadata.packages.length
      || new Set(metadata.workspace_members).size !== metadata.workspace_members.length) {
    throw new Error('Duplicate Cargo package or workspace identity');
  }
  const versions = metadata.workspace_members.map(id => {
    const member = packages.get(id);
    if (!member) throw new Error('Cargo metadata omitted a workspace member');
    return versionParts(member.rust_version).join('.');
  });
  if (new Set(versions).size !== 1) {
    throw new Error('Workspace members must share the declared minimum Rust version');
  }
  const minimum = versions[0];
  for (const dependency of metadata.packages) {
    if (dependency.rust_version != null && compare(dependency.rust_version, minimum) > 0) {
      throw new Error(`Declared Rust ${minimum} is below locked package ${dependency.name} ${dependency.version} requirement ${dependency.rust_version}`);
    }
  }
  return minimum;
}

export function checkMinimumRust({ cwd = root, env = process.env, run = spawnSync, printVersion = false } = {}) {
  let manager = 'rustup';
  const read = (command, args, options = {}) => {
    const settings = { cwd, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options };
    let result = run(command, args, settings);
    if (command === 'rustup' && result.error?.code === 'ENOENT') {
      const candidate = path.join(env.CARGO_HOME || path.join(os.homedir(), '.cargo'), 'bin', process.platform === 'win32' ? 'rustup.exe' : 'rustup');
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        manager = candidate;
        result = run(candidate, args, settings);
      }
    }
    if (result.error || result.status !== 0) {
      throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message ?? result.stderr ?? result.signal ?? result.status}`);
    }
    return (result.stdout ?? '').trim();
  };
  const metadata = JSON.parse(read('cargo', ['metadata', '--format-version', '1', '--all-features', '--locked']));
  const version = declaredMinimum(metadata);
  if (printVersion) return { version };
  const cargo = read(manager, ['which', '--toolchain', version, 'cargo']);
  const rustc = read(manager, ['which', '--toolchain', version, 'rustc']);
  if (!path.isAbsolute(cargo) || !path.isAbsolute(rustc)) throw new Error('Actual minimum compiler paths must be absolute');
  const compiler = read(rustc, ['--version']);
  if (!compiler.startsWith(`rustc ${version} `)) throw new Error('Resolved compiler differs from the declared minimum');
  const childEnv = { ...env, RUSTC: rustc, RUSTUP_TOOLCHAIN: version, RUSTUP_AUTO_INSTALL: '0',
    CARGO_TARGET_DIR: path.resolve(cwd, env.CARGO_TARGET_DIR || 'target', `minimum-rust-${version}`) };
  delete childEnv.RUSTC_WRAPPER;
  delete childEnv.RUSTC_WORKSPACE_WRAPPER;
  read(cargo, checkArgs, { env: childEnv, stdio: 'inherit' });
  return { version, compiler, argv: [cargo, ...checkArgs], locked_workspace_check_passed: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--print-version')) throw new Error('Usage: node scripts/check-minimum-rust.mjs [--print-version]');
    const result = checkMinimumRust({ printVersion: args[0] === '--print-version' });
    console.log(args[0] === '--print-version' ? result.version : JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
