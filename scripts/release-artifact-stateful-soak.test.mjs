import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { runReleaseArtifactStatefulSoak } from './release-artifact-stateful-soak.mjs';

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
  const replayMutation = options.replayMutation === true;
  const userWorkspaceReplayMutation = options.userWorkspaceReplayMutation === true;
  const symlinkTargetReplayMutation = options.symlinkTargetReplayMutation === true;
  const truncateLedgerOnResume = options.truncateLedgerOnResume === true;
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
  const runRoot = path.join(root, '.brownie', 'runs', runId);
  fs.mkdirSync(runRoot, { recursive: true });
  fs.writeFileSync(path.join(runRoot, 'ledger.jsonl'), '{"kind":"headless_journey_started"}\\n');
  fs.writeFileSync(path.join(root, '.brownie', 'soak-marker.json'), '{"state":"interrupted"}\\n');
  fs.writeFileSync(path.join(root, 'user-source.txt'), 'durable user workspace input\\n');
  process.exit(75);
}
if (args[0] === 'resume') {
  const ledgerPath = path.join(root, '.brownie', 'runs', 'run-fixture', 'ledger.jsonl');
  const resumedOnce = fs.readFileSync(ledgerPath, 'utf8').includes('recovery_continuation');
  if (!resumedOnce) {
    if (${truncateLedgerOnResume}) fs.writeFileSync(ledgerPath, '{"kind":"recovered"}\\n');
    else fs.appendFileSync(ledgerPath, '{"kind":"recovery_continuation"}\\n');
    write({ ok: true, resume: { status: 'no_eligible_task', controller_action: 'resume', continuation_required: true } });
    process.exit(0);
  }
  if (${replayMutation}) fs.appendFileSync(ledgerPath, '{"event":"unexpected_resume_side_effect"}\\n');
  if (${userWorkspaceReplayMutation}) fs.appendFileSync(path.join(root, 'user-source.txt'), 'duplicate user workspace side effect\\n');
  if (${symlinkTargetReplayMutation}) fs.appendFileSync(path.join(root, 'user-source.txt'), 'duplicate symlink target side effect\\n');
  write({ ok: true, resume: { status: 'no_eligible_task', controller_action: 'stop', continuation_required: false } });
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

test('stateful soak uses only the packaged artifact and records bounded recovery, replay, and evidence-chain checks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-artifact-soak-fixture-'));
  const evidencePath = path.join(root, 'evidence.json');
  const evidence = runReleaseArtifactStatefulSoak({
    targetId: 'linux-x64',
    archivePath: createFixtureArchive(root),
    workspaceRoot: path.join(root, 'workspace'),
    evidencePath
  });
  assert.equal(evidence.bounds.commands_executed, 3);
  assert.equal(evidence.checks.process_loss_recovery.fresh_process_resume, true);
  assert.equal(evidence.checks.process_loss_recovery.initial_command_exit_code, 75);
  assert.equal(evidence.checks.duplicate_side_effect_rejection.ledger_unchanged, true);
  assert.equal(evidence.checks.ledger_workspace_consistency.full_workspace_snapshot, true);
  assert.equal(evidence.checks.ledger_workspace_consistency.ledger_prefix_preserved, true);
  assert.equal(evidence.checks.ledger_workspace_consistency.passed, true);
  assert.equal(evidence.checks.resume_replay_behavior.resume_controller_action, 'resume');
  assert.equal(evidence.checks.finite_convergence.terminal_status, 'no_eligible_task');
  assert.equal(evidence.checks.evidence_chain_integrity.passed, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(evidencePath, 'utf8')), evidence);
});

test('stateful soak rejects replay mutations to files outside the Brownie state directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-artifact-soak-user-workspace-'));
  assert.throws(
    () => runReleaseArtifactStatefulSoak({
      targetId: 'linux-x64',
      archivePath: createFixtureArchive(root, { userWorkspaceReplayMutation: true }),
      workspaceRoot: path.join(root, 'workspace')
    }),
    /duplicate side effect/u
  );
});

test('stateful soak rejects replay mutations through an external symlink target', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-artifact-soak-symlink-workspace-'));
  const workspaceRoot = path.join(root, 'workspace');
  const externalTarget = path.join(root, 'external-user-source.txt');
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(externalTarget, 'external durable user workspace input\\n');
  try {
    fs.symlinkSync(externalTarget, path.join(workspaceRoot, 'user-source.txt'), 'file');
  } catch (error) {
    // Windows installations without symlink privilege must fail closed in the
    // product path; this fixture cannot construct the required topology.
    if (process.platform === 'win32' && error.code === 'EPERM') return;
    throw error;
  }
  assert.throws(
    () => runReleaseArtifactStatefulSoak({
      targetId: 'linux-x64',
      archivePath: createFixtureArchive(root, { symlinkTargetReplayMutation: true }),
      workspaceRoot
    }),
    /duplicate side effect/u
  );
});

test('stateful soak rejects recovery that truncates the durable ledger', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-artifact-soak-ledger-truncation-'));
  assert.throws(
    () => runReleaseArtifactStatefulSoak({
      targetId: 'linux-x64',
      archivePath: createFixtureArchive(root, { truncateLedgerOnResume: true }),
      workspaceRoot: path.join(root, 'workspace')
    }),
    /preserve the durable ledger prefix/u
  );
});

test('stateful soak rejects a terminal replay that appends a duplicate ledger side effect', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-artifact-soak-duplicate-'));
  assert.throws(
    () => runReleaseArtifactStatefulSoak({
      targetId: 'linux-x64',
      archivePath: createFixtureArchive(root, { replayMutation: true }),
      workspaceRoot: path.join(root, 'workspace')
    }),
    /duplicate side effect/u
  );
});

test('stateful soak rejects a package whose signed CLI binding was tampered', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-artifact-soak-tamper-'));
  const archivePath = createFixtureArchive(root);
  const unpacked = path.join(root, 'unpacked');
  fs.mkdirSync(unpacked);
  assert.equal(spawnSync('tar', ['-xzf', archivePath, '-C', unpacked], { encoding: 'utf8' }).status, 0);
  fs.appendFileSync(path.join(unpacked, 'brownie'), 'tamper\n');
  assert.equal(spawnSync('tar', ['-czf', archivePath, '-C', unpacked, 'brownie', 'brownie-runtime', 'artifact-evidence.json', 'SHA256SUMS'], { encoding: 'utf8' }).status, 0);
  assert.throws(
    () => runReleaseArtifactStatefulSoak({ targetId: 'linux-x64', archivePath, workspaceRoot: path.join(root, 'workspace') }),
    /package integrity mismatch/u
  );
});
