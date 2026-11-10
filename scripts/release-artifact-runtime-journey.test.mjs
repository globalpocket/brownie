import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { runReleaseArtifactRuntimeJourney } from './release-artifact-runtime-journey.mjs';

function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function writeExecutable(filePath, source) {
  fs.writeFileSync(filePath, source);
  fs.chmodSync(filePath, 0o755);
}

function createFixtureArchive(root, options = {}) {
  const packageRoot = path.join(root, 'package');
  fs.mkdirSync(packageRoot, { recursive: true });
  const runtimePath = path.join(packageRoot, 'brownie-runtime');
  const cliPath = path.join(packageRoot, 'brownie');
  writeExecutable(runtimePath, '#!/usr/bin/env node\nprocess.exit(0);\n');
  writeExecutable(cliPath, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.BROWNIE_WORKSPACE_ROOT;
const args = process.argv.slice(2).filter((value) => value !== '--json');
const write = (value) => process.stdout.write(JSON.stringify(value));
if (args[0] === 'mode' && args[1] === 'list') {
  write({ ok: true, mode_list: { modes: [{ mode_id: 'fixture', display_name: 'Fixture' }] } });
  process.exit(0);
}
if (args[0] === 'run') {
  const runId = 'run-fixture';
  fs.mkdirSync(path.join(root, '.brownie', 'runs', runId), { recursive: true });
  fs.writeFileSync(path.join(root, '.brownie', 'runs', runId, 'ledger.jsonl'), '{"event":"fixture"}\\n');
  fs.writeFileSync(path.join(root, '.brownie', 'journey-marker.json'), '{"state":"interrupted"}\\n');
  write({ ok: true, run: { session_id: 'session-fixture', journey_id: 'journey-fixture', task_id: 'task-fixture', run_id: runId, automation: { controller_action: 'resume', continuation_required: true, stop_reason: 'fixture_interruption' } } });
  process.exit(0);
}
if (args[0] === 'resume') {
  if (${options.mutateUserFile === true}) fs.appendFileSync(path.join(root, 'user-source.txt'), 'duplicate-write\\n');
  if (${options.createUserDirectory === true}) {
    const index = fs.readdirSync(root).filter((name) => name.startsWith('replayed-output-')).length;
    fs.mkdirSync(path.join(root, 'replayed-output-' + index));
  }
  if (${options.changeUserMode === true}) {
    const target = path.join(root, 'user-source.txt');
    fs.chmodSync(target, (fs.statSync(target).mode & 0o777) === 0o600 ? 0o640 : 0o600);
  }
  write({ ok: true, resume: { status: 'no_eligible_task', controller_action: 'stop' } });
  process.exit(0);
}
process.exit(64);
`);
  const artifact = { schema_version: 1, target: 'linux-x64', artifact: { path: 'brownie', sha256: sha256File(cliPath) }, runtime_companion: { path: 'brownie-runtime', sha256: sha256File(runtimePath) } };
  fs.writeFileSync(path.join(packageRoot, 'artifact-evidence.json'), `${JSON.stringify(artifact)}\n`);
  fs.writeFileSync(path.join(packageRoot, 'SHA256SUMS'), `${artifact.artifact.sha256.slice(7)}  brownie\n${artifact.runtime_companion.sha256.slice(7)}  brownie-runtime\n`);
  const archivePath = path.join(root, 'brownie-linux-x64.tar.gz');
  const archive = spawnSync('tar', ['-czf', archivePath, '-C', packageRoot, 'brownie', 'brownie-runtime', 'artifact-evidence.json', 'SHA256SUMS'], { encoding: 'utf8' });
  assert.equal(archive.status, 0, archive.stderr);
  return archivePath;
}

test('journey executes only the packaged fixture and records durable interruption, resume, and replay evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-runtime-journey-fixture-'));
  const evidencePath = path.join(root, 'evidence.json');
  const evidence = runReleaseArtifactRuntimeJourney({
    targetId: 'linux-x64',
    archivePath: createFixtureArchive(root),
    workspaceRoot: path.join(root, 'workspace'),
    evidencePath,
    workflowRunId: 'workflow-fixture-123'
  });
  assert.equal(evidence.workflow_run_id, 'workflow-fixture-123');
  assert.equal(evidence.checks.mode_pack_load.passed, true);
  assert.equal(evidence.checks.workspace_mutation.passed, true);
  assert.equal(evidence.checks.ledger_generation.passed, true);
  assert.equal(evidence.checks.forced_interruption.stop_reason, 'fixture_interruption');
  assert.equal(evidence.checks.resume.status, 'no_eligible_task');
  assert.equal(evidence.checks.stale_replay_rejection.workspace_unchanged, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(evidencePath, 'utf8')), evidence);
});

test('journey rejects a package whose signed runtime binding was tampered', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-runtime-journey-tamper-'));
  const archivePath = createFixtureArchive(root);
  const unpacked = path.join(root, 'unpacked');
  fs.mkdirSync(unpacked);
  assert.equal(spawnSync('tar', ['-xzf', archivePath, '-C', unpacked], { encoding: 'utf8' }).status, 0);
  fs.appendFileSync(path.join(unpacked, 'brownie-runtime'), 'tamper\n');
  assert.equal(spawnSync('tar', ['-czf', archivePath, '-C', unpacked, 'brownie', 'brownie-runtime', 'artifact-evidence.json', 'SHA256SUMS'], { encoding: 'utf8' }).status, 0);
  assert.throws(
    () => runReleaseArtifactRuntimeJourney({ targetId: 'linux-x64', archivePath, workspaceRoot: path.join(root, 'workspace') }),
    /package integrity mismatch/u
  );
});

test('journey rejects a package whose signed CLI binding was tampered', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-runtime-journey-tamper-'));
  const archivePath = createFixtureArchive(root);
  const unpacked = path.join(root, 'unpacked');
  fs.mkdirSync(unpacked);
  assert.equal(spawnSync('tar', ['-xzf', archivePath, '-C', unpacked], { encoding: 'utf8' }).status, 0);
  fs.appendFileSync(path.join(unpacked, 'brownie'), 'tamper\n');
  assert.equal(spawnSync('tar', ['-czf', archivePath, '-C', unpacked, 'brownie', 'brownie-runtime', 'artifact-evidence.json', 'SHA256SUMS'], { encoding: 'utf8' }).status, 0);
  assert.throws(
    () => runReleaseArtifactRuntimeJourney({ targetId: 'linux-x64', archivePath, workspaceRoot: path.join(root, 'workspace') }),
    /package integrity mismatch/u
  );
});

test('journey rejects replay that changes an ordinary user task output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-journey-user-replay-'));
  const workspaceRoot = path.join(root, 'workspace');
  fs.mkdirSync(workspaceRoot);
  fs.writeFileSync(path.join(workspaceRoot, 'user-source.txt'), 'initial\n');
  assert.throws(
    () => runReleaseArtifactRuntimeJourney({ targetId: 'linux-x64', archivePath: createFixtureArchive(root, { mutateUserFile: true }), workspaceRoot }),
    /runtime did not reject replay without a side effect/u
  );
});

test('journey rejects replay that changes a user task output through an external symlink', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-journey-linked-replay-'));
  const workspaceRoot = path.join(root, 'workspace');
  fs.mkdirSync(workspaceRoot);
  const target = path.join(root, 'external-user-source.txt');
  fs.writeFileSync(target, 'initial\n');
  try {
    fs.symlinkSync(target, path.join(workspaceRoot, 'user-source.txt'), 'file');
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') return t.skip('external symlink privilege unavailable');
    throw error;
  }
  assert.throws(
    () => runReleaseArtifactRuntimeJourney({ targetId: 'linux-x64', archivePath: createFixtureArchive(root, { mutateUserFile: true }), workspaceRoot }),
    /runtime did not reject replay without a side effect/u
  );
});

test('journey rejects replay that creates an empty user output directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-journey-directory-replay-'));
  const workspaceRoot = path.join(root, 'workspace');
  fs.mkdirSync(workspaceRoot);
  assert.throws(
    () => runReleaseArtifactRuntimeJourney({ targetId: 'linux-x64', archivePath: createFixtureArchive(root, { createUserDirectory: true }), workspaceRoot }),
    /runtime did not reject replay without a side effect/u
  );
});

test('journey rejects replay that changes user output permissions', (t) => {
  if (process.platform === 'win32') return t.skip('POSIX permission semantics unavailable');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-journey-mode-replay-'));
  const workspaceRoot = path.join(root, 'workspace');
  fs.mkdirSync(workspaceRoot);
  fs.writeFileSync(path.join(workspaceRoot, 'user-source.txt'), 'initial\n', { mode: 0o600 });
  assert.throws(
    () => runReleaseArtifactRuntimeJourney({ targetId: 'linux-x64', archivePath: createFixtureArchive(root, { changeUserMode: true }), workspaceRoot }),
    /runtime did not reject replay without a side effect/u
  );
});

test('journey bounds full-workspace snapshot entry enumeration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-journey-entry-budget-'));
  const workspaceRoot = path.join(root, 'workspace');
  fs.mkdirSync(workspaceRoot);
  for (let index = 0; index < 4097; index += 1) fs.writeFileSync(path.join(workspaceRoot, `entry-${index}`), '');
  assert.throws(
    () => runReleaseArtifactRuntimeJourney({ targetId: 'linux-x64', archivePath: createFixtureArchive(root), workspaceRoot }),
    /workspace snapshot entry budget exceeded/u
  );
});

test('journey bounds full-workspace snapshot directory depth', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-journey-depth-budget-'));
  const workspaceRoot = path.join(root, 'workspace');
  fs.mkdirSync(workspaceRoot);
  let current = workspaceRoot;
  for (let index = 0; index < 65; index += 1) {
    current = path.join(current, 'n');
    fs.mkdirSync(current);
  }
  assert.throws(
    () => runReleaseArtifactRuntimeJourney({ targetId: 'linux-x64', archivePath: createFixtureArchive(root), workspaceRoot }),
    /workspace snapshot depth budget exceeded/u
  );
});

test('journey bounds bytes read from externally linked task output', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-journey-byte-budget-'));
  const workspaceRoot = path.join(root, 'workspace');
  fs.mkdirSync(workspaceRoot);
  const target = path.join(root, 'external-output');
  fs.writeFileSync(target, '');
  fs.truncateSync(target, 64 * 1024 * 1024 + 1);
  try {
    fs.symlinkSync(target, path.join(workspaceRoot, 'user-source.txt'), 'file');
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') return t.skip('external symlink privilege unavailable');
    throw error;
  }
  assert.throws(
    () => runReleaseArtifactRuntimeJourney({ targetId: 'linux-x64', archivePath: createFixtureArchive(root), workspaceRoot }),
    /workspace snapshot byte budget exceeded/u
  );
});

test('journey permits an unchanged directory symlink cycle without recursive traversal', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-journey-cycle-'));
  const workspaceRoot = path.join(root, 'workspace');
  fs.mkdirSync(workspaceRoot);
  try {
    fs.symlinkSync(workspaceRoot, path.join(workspaceRoot, 'cycle'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') return t.skip('directory symlink privilege unavailable');
    throw error;
  }
  const evidence = runReleaseArtifactRuntimeJourney({ targetId: 'linux-x64', archivePath: createFixtureArchive(root), workspaceRoot });
  assert.equal(evidence.checks.stale_replay_rejection.workspace_unchanged, true);
});
