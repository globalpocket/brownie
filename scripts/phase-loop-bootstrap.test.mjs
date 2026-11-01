import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const controllerPath = path.join(repoRoot, 'phase-loop.sh');

function executableFixture(directory, name) {
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.chmodSync(filePath, 0o755);
  return filePath;
}

function workspaceBuildFingerprint(workspace) {
  const listed = spawnSync('git', ['ls-files', '-z'], { cwd: workspace, encoding: 'buffer' });
  assert.equal(listed.status, 0, listed.stderr?.toString());
  const files = listed.stdout.toString('utf8').split('\0').filter(Boolean).filter((relative) => (
    relative === 'Cargo.lock'
    || relative === 'Cargo.toml'
    || relative === 'build-provenance.rs'
    || (relative.startsWith('crates/') && (relative.endsWith('.rs') || relative.endsWith('/Cargo.toml')))
  )).sort();
  const digest = crypto.createHash('sha256');
  digest.update('brownie-build-provenance-v1\0');
  for (const relative of files) {
    digest.update(relative);
    digest.update('\0');
    digest.update(fs.readFileSync(path.join(workspace, relative)));
    digest.update('\0');
  }
  return `sha256:${digest.digest('hex')}`;
}

function provenanceExecutableFixture(directory, name, component, sourceFingerprint) {
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, [
    '#!/usr/bin/env node',
    "if (!(process.argv[2] === '--build-provenance' || process.argv.includes('build-provenance'))) process.exit(64);",
    `process.stdout.write(${JSON.stringify(`${JSON.stringify({ schema_version: 1, component, source_fingerprint: sourceFingerprint })}\n`)});`
  ].join('\n'), { mode: 0o755 });
  fs.chmodSync(filePath, 0o755);
  return filePath;
}

function runtimeStatusFixture(directory, name, status) {
  const filePath = path.join(directory, name);
  const response = `${JSON.stringify({ jsonrpc: '2.0', id: 1, result: status })}\n`;
  fs.writeFileSync(filePath, [
    '#!/usr/bin/env node',
    'process.stdin.resume();',
    "process.stdin.on('end', () => {",
    `  process.stdout.write(${JSON.stringify(response)});`,
    '});'
  ].join('\n'), { mode: 0o755 });
  fs.chmodSync(filePath, 0o755);
  return filePath;
}

const readyProviderStatus = {
  provider: 'OpenAICompatible',
  enabled: true,
  strict: true,
  will_fallback_to_fake: false,
  llm_provider_access_allowed: true,
  task_run_network_allowed: true
};

function workspaceAwareRuntimeStatusFixture(directory, name, workspace) {
  const filePath = path.join(directory, name);
  const expectedWorkspace = fs.realpathSync(workspace);
  const unavailableStatus = {
    ...readyProviderStatus,
    provider: 'Fake',
    strict: false,
    llm_provider_access_allowed: false,
    task_run_network_allowed: false
  };
  fs.writeFileSync(filePath, [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    `const expectedWorkspace = ${JSON.stringify(expectedWorkspace)};`,
    `const expectedWorkspaceEnvironment = ${JSON.stringify(workspace)};`,
    `const readyStatus = ${JSON.stringify(readyProviderStatus)};`,
    `const unavailableStatus = ${JSON.stringify(unavailableStatus)};`,
    'process.stdin.resume();',
    "process.stdin.on('end', () => {",
    '  const status = fs.realpathSync(process.cwd()) === expectedWorkspace && process.env.BROWNIE_WORKSPACE_ROOT === expectedWorkspaceEnvironment',
    '    ? readyStatus',
    '    : unavailableStatus;',
    '  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: status }) + "\\n");',
    '});'
  ].join('\n'), { mode: 0o755 });
  fs.chmodSync(filePath, 0o755);
  return filePath;
}

function baseEnvironment() {
  const environment = { ...process.env };
  for (const name of [
    'BROWNIE_BIN',
    'BROWNIE_RUNTIME_PATH',
    'BROWNIE_WORKSPACE_ROOT',
    'PHASE_LOOP_ENV_FILE',
    'PHASE_LOOP_WORKSPACE_ROOT',
    'PHASE_LOOP_STATE_DIR',
    'PHASE_LOOP_PREFLIGHT_PROFILE',
    'PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY'
  ]) delete environment[name];
  return environment;
}

function runBootstrapCheck(environment) {
  return runController('check-runtime-bootstrap', environment);
}

function runController(command, environment) {
  return spawnSync('bash', [controllerPath, command], {
    cwd: repoRoot,
    env: { ...baseEnvironment(), ...environment },
    encoding: 'utf8'
  });
}

test('does not probe repository-local environment files', () => {
  const source = fs.readFileSync(controllerPath, 'utf8');
  assert.match(source, /PHASE_LOOP_ENV_FILE/u);
  assert.doesNotMatch(source, /\$ROOT_DIR\/phase-loop\.env/u);
  assert.doesNotMatch(source, /\.test\/brownie-loop\.env/u);
  assert.doesNotMatch(source, /\.brownie\/private\/llm\.env/u);
});

test('requires both explicitly injected runtime binaries', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-bootstrap-missing-'));
  try {
    const result = runBootstrapCheck({ PHASE_LOOP_STATE_DIR: path.join(fixture, 'state') });
    assert.equal(result.status, 78, result.stderr);
    const diagnostic = JSON.parse(result.stdout);
    assert.equal(diagnostic.code, 'phase_loop_bootstrap_unavailable');
    assert.deepEqual(diagnostic.missing_binaries.map((entry) => [entry.name, entry.reason]), [
      ['BROWNIE_BIN', 'missing_configuration'],
      ['BROWNIE_RUNTIME_PATH', 'missing_configuration']
    ]);
    assert.match(diagnostic.repair, /never searches a workspace, controller, adjacent directory, or PATH/u);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('accepts explicit CLI and Runtime paths without a workspace default', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-bootstrap-explicit-'));
  try {
    const cli = executableFixture(fixture, 'custom-cli');
    const runtime = runtimeStatusFixture(fixture, 'custom-runtime', readyProviderStatus);
    const result = runBootstrapCheck({
      BROWNIE_BIN: cli,
      BROWNIE_RUNTIME_PATH: runtime,
      PHASE_LOOP_STATE_DIR: path.join(fixture, 'state')
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { ok: true, code: 'phase_loop_bootstrap_ready' });
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('probes the provider from the implementation workspace context', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-bootstrap-workspace-context-'));
  try {
    const workspace = path.join(fixture, 'implementation-workspace');
    fs.mkdirSync(workspace);
    const cli = executableFixture(fixture, 'cli');
    const runtime = workspaceAwareRuntimeStatusFixture(fixture, 'runtime', workspace);
    const result = runBootstrapCheck({
      BROWNIE_BIN: cli,
      BROWNIE_RUNTIME_PATH: runtime,
      PHASE_LOOP_WORKSPACE_ROOT: workspace,
      PHASE_LOOP_STATE_DIR: path.join(fixture, 'state')
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { ok: true, code: 'phase_loop_bootstrap_ready' });
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('loads only an explicitly selected environment file', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-bootstrap-env-file-'));
  try {
    const cli = executableFixture(fixture, 'cli');
    const runtime = runtimeStatusFixture(fixture, 'runtime', readyProviderStatus);
    const environmentFile = path.join(fixture, 'deployment.env');
    fs.writeFileSync(environmentFile, [
      `BROWNIE_BIN=${JSON.stringify(cli)}`,
      `BROWNIE_RUNTIME_PATH=${JSON.stringify(runtime)}`,
      `PHASE_LOOP_STATE_DIR=${JSON.stringify(path.join(fixture, 'state'))}`
    ].join('\n'));
    const result = runBootstrapCheck({ PHASE_LOOP_ENV_FILE: environmentFile });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { ok: true, code: 'phase_loop_bootstrap_ready' });
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('status reads the explicitly selected environment-file state root', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-status-env-file-'));
  try {
    const state = path.join(fixture, 'state');
    fs.mkdirSync(state, { recursive: true });
    const status = { status: 'integrity_blocked', detail: 'fixture status' };
    fs.writeFileSync(path.join(state, 'status.json'), `${JSON.stringify(status)}\n`);
    const environmentFile = path.join(fixture, 'deployment.env');
    fs.writeFileSync(environmentFile, `PHASE_LOOP_STATE_DIR=${JSON.stringify(state)}\n`);
    const result = runController('status', { PHASE_LOOP_ENV_FILE: environmentFile });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /phase-loop not running/u);
    assert.match(result.stdout, /fixture status/u);
    assert.doesNotMatch(result.stdout, /no status file:/u);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('rejects a Fake implementation provider before a phase claim can start', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-bootstrap-fake-provider-'));
  try {
    const cli = executableFixture(fixture, 'cli');
    const runtime = runtimeStatusFixture(fixture, 'runtime', {
      ...readyProviderStatus,
      provider: 'Fake',
      strict: false,
      llm_provider_access_allowed: false,
      task_run_network_allowed: false
    });
    const result = runBootstrapCheck({
      BROWNIE_BIN: cli,
      BROWNIE_RUNTIME_PATH: runtime,
      PHASE_LOOP_STATE_DIR: path.join(fixture, 'state')
    });
    assert.equal(result.status, 78, result.stderr);
    const diagnostic = JSON.parse(result.stdout);
    assert.equal(diagnostic.code, 'phase_loop_implementation_provider_unavailable');
    assert.equal(diagnostic.provider_reason, 'fake_provider_forbidden');
    assert.equal(diagnostic.provider_status.provider, 'Fake');
    assert.match(diagnostic.repair, /never searches for, enables, or invents a provider endpoint/u);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('requires both claim-smoke fixture markers before allowing its Fake runtime', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-bootstrap-fixture-marker-'));
  try {
    const cli = executableFixture(fixture, 'cli');
    const runtime = runtimeStatusFixture(fixture, 'runtime', {
      ...readyProviderStatus,
      provider: 'Fake',
      strict: false,
      llm_provider_access_allowed: false,
      task_run_network_allowed: false
    });
    for (const testOnlyEnvironment of [
      { PHASE_LOOP_PREFLIGHT_PROFILE: 'claim-smoke-fixture' },
      { PHASE_LOOP_CLAIM_SMOKE_TEST_ONLY: '1' }
    ]) {
      const result = runBootstrapCheck({
        BROWNIE_BIN: cli,
        BROWNIE_RUNTIME_PATH: runtime,
        PHASE_LOOP_STATE_DIR: path.join(fixture, `state-${Object.keys(testOnlyEnvironment)[0]}`),
        ...testOnlyEnvironment
      });
      assert.equal(result.status, 78, result.stderr);
      const diagnostic = JSON.parse(result.stdout);
      assert.equal(diagnostic.code, 'phase_loop_implementation_provider_unavailable');
      assert.equal(diagnostic.provider_reason, 'fake_provider_forbidden');
    }
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('rejects a provider that lacks strict network authority', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-bootstrap-provider-permission-'));
  try {
    const cli = executableFixture(fixture, 'cli');
    const runtime = runtimeStatusFixture(fixture, 'runtime', {
      ...readyProviderStatus,
      llm_provider_access_allowed: false,
      task_run_network_allowed: false
    });
    const result = runBootstrapCheck({
      BROWNIE_BIN: cli,
      BROWNIE_RUNTIME_PATH: runtime,
      PHASE_LOOP_STATE_DIR: path.join(fixture, 'state')
    });
    assert.equal(result.status, 78, result.stderr);
    const diagnostic = JSON.parse(result.stdout);
    assert.equal(diagnostic.code, 'phase_loop_implementation_provider_unavailable');
    assert.equal(diagnostic.provider_reason, 'provider_not_permitted_for_implementation');
    assert.equal(diagnostic.provider_status.provider, 'OpenAICompatible');
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('does not use a colocated phase-loop.env as a fallback', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-bootstrap-no-fallback-'));
  try {
    fs.copyFileSync(controllerPath, path.join(fixture, 'phase-loop.sh'));
    fs.chmodSync(path.join(fixture, 'phase-loop.sh'), 0o755);
    const cli = executableFixture(fixture, 'cli');
    const runtime = executableFixture(fixture, 'runtime');
    fs.writeFileSync(path.join(fixture, 'phase-loop.env'), `BROWNIE_BIN=${cli}\nBROWNIE_RUNTIME_PATH=${runtime}\n`);
    const result = spawnSync('bash', [path.join(fixture, 'phase-loop.sh'), 'check-runtime-bootstrap'], {
      cwd: fixture,
      env: { ...baseEnvironment(), PHASE_LOOP_STATE_DIR: path.join(fixture, 'state') },
      encoding: 'utf8'
    });
    assert.equal(result.status, 78, result.stderr);
    assert.equal(JSON.parse(result.stdout).missing_binaries[0].reason, 'missing_configuration');
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('checks explicit binaries against an explicitly selected workspace', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-bootstrap-freshness-'));
  try {
    fs.mkdirSync(path.join(fixture, 'crates', 'fixture', 'src'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'Cargo.toml'), '[workspace]\nmembers = []\n');
    fs.writeFileSync(path.join(fixture, 'Cargo.lock'), '# fixture\n');
    fs.writeFileSync(path.join(fixture, 'build-provenance.rs'), 'fn main() {}\n');
    fs.writeFileSync(path.join(fixture, 'crates', 'fixture', 'Cargo.toml'), '[package]\nname = "fixture"\nversion = "0.0.0"\n');
    fs.writeFileSync(path.join(fixture, 'crates', 'fixture', 'src', 'lib.rs'), 'pub fn fixture() {}\n');
    spawnSync('git', ['init'], { cwd: fixture, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.name', 'test'], { cwd: fixture, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: fixture, stdio: 'ignore' });
    spawnSync('git', ['add', '.'], { cwd: fixture, stdio: 'ignore' });
    spawnSync('git', ['commit', '-m', 'fixture'], { cwd: fixture, stdio: 'ignore' });
    const binDir = path.join(fixture, 'bin');
    fs.mkdirSync(binDir);
    const missingProvenance = executableFixture(binDir, 'missing-provenance');
    const sourceFingerprint = workspaceBuildFingerprint(fixture);
    const cli = provenanceExecutableFixture(binDir, 'cli', 'brownie-cli', sourceFingerprint);
    const runtime = provenanceExecutableFixture(binDir, 'runtime', 'brownie-runtime', sourceFingerprint);
    const missingResult = spawnSync('bash', [controllerPath, 'check-binary-freshness'], {
      cwd: repoRoot,
      env: {
        ...baseEnvironment(),
        PHASE_LOOP_WORKSPACE_ROOT: fixture,
        PHASE_LOOP_STATE_DIR: path.join(fixture, 'state-missing-provenance'),
        BROWNIE_BIN: missingProvenance,
        BROWNIE_RUNTIME_PATH: runtime,
        PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK: '0'
      },
      encoding: 'utf8'
    });
    assert.equal(missingResult.status, 1, missingResult.stderr);
    assert.match(missingResult.stdout, /brownie CLI build provenance is unavailable/u);
    const result = spawnSync('bash', [controllerPath, 'check-binary-freshness'], {
      cwd: repoRoot,
      env: {
        ...baseEnvironment(),
        PHASE_LOOP_WORKSPACE_ROOT: fixture,
        PHASE_LOOP_STATE_DIR: path.join(fixture, 'state'),
        BROWNIE_BIN: cli,
        BROWNIE_RUNTIME_PATH: runtime,
        PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK: '0'
      },
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);

    fs.writeFileSync(path.join(fixture, 'build-provenance.rs'), 'fn main() { println!("changed"); }\n');
    const changedGeneratorResult = spawnSync('bash', [controllerPath, 'check-binary-freshness'], {
      cwd: repoRoot,
      env: {
        ...baseEnvironment(),
        PHASE_LOOP_WORKSPACE_ROOT: fixture,
        PHASE_LOOP_STATE_DIR: path.join(fixture, 'state-changed-generator'),
        BROWNIE_BIN: cli,
        BROWNIE_RUNTIME_PATH: runtime,
        PHASE_LOOP_SKIP_BINARY_FRESHNESS_CHECK: '0'
      },
      encoding: 'utf8'
    });
    assert.equal(changedGeneratorResult.status, 1, `${changedGeneratorResult.stderr}\n${changedGeneratorResult.stdout}`);
    assert.match(changedGeneratorResult.stdout, /build provenance does not match the selected source/u);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
