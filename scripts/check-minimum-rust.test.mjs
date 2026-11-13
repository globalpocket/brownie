import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { declaredMinimum, checkMinimumRust } from './check-minimum-rust.mjs';

function metadata(minimum = '1.88', dependency = '1.88.0') {
  return { workspace_members: ['runtime', 'store'], packages: [
    { id: 'runtime', name: 'runtime', version: '0.1.0', rust_version: minimum },
    { id: 'store', name: 'store', version: '0.1.0', rust_version: minimum },
    { id: 'time', name: 'time', version: '0.3.51', rust_version: dependency },
  ] };
}

test('rejects the actual declared1.82 versus locked1.88 conflict before compiler execution', () => {
  const calls = [];
  assert.throws(() => checkMinimumRust({ run(command, args) {
    calls.push({ command, args });
    return { status: 0, stdout: JSON.stringify(metadata('1.82')) };
  } }), /Declared Rust 1.82.0 is below locked package time 0.3.51 requirement 1.88.0/);
  assert.equal(calls.length, 1);
});

test('normalizes equivalent stable versions and compares numerically', () => {
  assert.equal(declaredMinimum(metadata()), '1.88.0');
  assert.equal(declaredMinimum(metadata('1.100', '1.99')), '1.100.0');
  assert.equal(declaredMinimum(metadata('1.88.1', '1.88.0')), '1.88.1');
  assert.throws(() => declaredMinimum(metadata('1.88.0', '1.88.1')), /below locked package/);
});

test('rejects missing, mixed, duplicated or unsupported workspace contracts', () => {
  for (const edit of [
    m => { m.workspace_members = []; },
    m => { m.workspace_members.push('absent'); },
    m => { m.workspace_members.push('store'); },
    m => { m.packages.push(m.packages[0]); },
    m => { m.packages[0].rust_version = null; },
    m => { m.packages[0].rust_version = 'stable'; },
    m => { m.packages[0].rust_version = '1.88.0-beta'; },
    m => { m.packages[1].rust_version = '1.89'; },
  ]) {
    const m = metadata(); edit(m);
    assert.throws(() => declaredMinimum(m));
  }
});

test('print-version only resolves locked metadata and never installs a compiler', () => {
  const calls = [];
  const result = checkMinimumRust({ printVersion: true, run(command, args) {
    calls.push([command, ...args]); return { status: 0, stdout: JSON.stringify(metadata()) };
  } });
  assert.deepEqual(result, { version: '1.88.0' });
  assert.deepEqual(calls, [['cargo', 'metadata', '--format-version', '1', '--all-features', '--locked']]);
});

function runner({ failure = null, compiler = 'rustc 1.88.0 (test)' } = {}) {
  const calls = [];
  return { calls, run(command, args, options) {
    calls.push({ command, args, options });
    if (command === 'cargo') return { status: 0, stdout: JSON.stringify(metadata()) };
    if (command === 'rustup') return { status: 0, stdout: `/fixture/toolchain/bin/${args.at(-1)}\n` };
    if (command.endsWith('/rustc')) return { status: 0, stdout: compiler };
    return failure ?? { status: 0 };
  } };
}

test('executes all locked workspace targets/features with the exact compiler and leaves input environment intact', () => {
  const fixture = runner();
  const env = { RUSTC: '/wrong/rustc', RUSTC_WRAPPER: '/wrong/wrapper', RUSTC_WORKSPACE_WRAPPER: '/wrong/workspace-wrapper', RUSTUP_TOOLCHAIN: 'stable', CARGO_TARGET_DIR: '/fixture/target' };
  const before = { ...env };
  const result = checkMinimumRust({ cwd: '/fixture/source', env, run: fixture.run });
  assert.equal(result.locked_workspace_check_passed, true);
  const last = fixture.calls.at(-1);
  assert.equal(last.command, '/fixture/toolchain/bin/cargo');
  assert.deepEqual(last.args, ['check', '--workspace', '--all-targets', '--all-features', '--locked']);
  assert.equal(last.options.env.RUSTC, '/fixture/toolchain/bin/rustc');
  assert.equal(last.options.env.RUSTUP_TOOLCHAIN, '1.88.0');
  assert.equal(last.options.env.RUSTUP_AUTO_INSTALL, '0');
  assert.equal(last.options.env.CARGO_TARGET_DIR, path.resolve('/fixture/target', 'minimum-rust-1.88.0'));
  assert.equal(last.options.env.RUSTC_WRAPPER, undefined);
  assert.equal(last.options.env.RUSTC_WORKSPACE_WRAPPER, undefined);
  assert.deepEqual(env, before);
  assert.equal(fixture.calls.some(c => c.args.includes('install') || c.args.includes('default')), false);
});

test('fails closed on a wrong resolved compiler without attempting a build', () => {
  const fixture = runner({ compiler: 'rustc 1.95.0 (wrong)' });
  assert.throws(() => checkMinimumRust({ run: fixture.run }), /differs from the declared minimum/);
  assert.equal(fixture.calls.some(c => c.args[0] === 'check'), false);
});

test('resolves an installed manager outside PATH without changing the selected PATH or compiler default', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-minimum-rust-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const manager = path.join(directory, 'bin', process.platform === 'win32' ? 'rustup.exe' : 'rustup');
  fs.mkdirSync(path.dirname(manager)); fs.writeFileSync(manager, '', { mode: 0o755 });
  const fixture = runner(); const calls = [];
  const env = { CARGO_HOME: directory, PATH: '/fixture/selected-path' };
  const before = { ...env };
  const result = checkMinimumRust({ env, run(command, args, options) {
    calls.push([command, ...args]);
    if (command === 'rustup') return { status: null, error: Object.assign(new Error('not on PATH'), { code: 'ENOENT' }) };
    return fixture.run(command === manager ? 'rustup' : command, args, options);
  } });
  assert.equal(result.locked_workspace_check_passed, true);
  assert.equal(calls.filter(c => c[0] === 'rustup').length, 1);
  assert.equal(calls.filter(c => c[0] === manager).length, 2);
  assert.deepEqual(env, before);
});

test('does not issue a successful result after a failed, signalled or unspawned actual check', () => {
  for (const failure of [{ status: 101 }, { status: null, signal: 'SIGTERM' }, { status: null, error: new Error('spawn failed') }]) {
    const fixture = runner({ failure });
    assert.throws(() => checkMinimumRust({ run: fixture.run }), /failed/);
  }
});

test('the same mandatory guard is wired into local root checks and CI installs its derived version without changing defaults', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['guard:minimum-rust'], 'node scripts/check-minimum-rust.mjs');
  assert.equal(pkg.scripts['guard:minimum-rust:test'], 'node --test scripts/check-minimum-rust.test.mjs');
  assert.ok(pkg.scripts.check.includes('pnpm guard:minimum-rust && pnpm guard:minimum-rust:test'));
  const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.ok(ci.includes('version="$(node scripts/check-minimum-rust.mjs --print-version)"'));
  assert.ok(ci.includes('rustup toolchain install "$version" --profile minimal --no-self-update'));
  assert.ok(ci.indexOf('Install declared minimum Rust') < ci.indexOf('Root workspace check'));
});

test('executes the actual locked workspace check with its declared compiler', () => {
  const result = checkMinimumRust({ env: { ...process.env, CARGO_BUILD_JOBS: '2' } });
  assert.equal(result.locked_workspace_check_passed, true);
  assert.ok(result.compiler.startsWith(`rustc ${result.version} `));
  console.log(JSON.stringify({ actual_minimum_compiler_check: result }));
});
