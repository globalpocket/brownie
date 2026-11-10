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
  const target = options.target ?? 'linux-x64';
  const packageRoot = path.join(root, 'package');
  fs.mkdirSync(packageRoot, { recursive: true });
  const runtimePath = path.join(packageRoot, 'brownie-runtime');
  const cliPath = path.join(packageRoot, 'brownie');
  writeExecutable(runtimePath, String.raw`#!/usr/bin/env node
const fs = require('node:fs');
for (const line of fs.readFileSync(0, 'utf8').trim().split('\n')) {
  const request = JSON.parse(line);
  const result = request.method === 'llm.status'
    ? {provider:${options.fakeProvider === true ? "'Fake'" : "'OpenAiCompatible'"},enabled:${options.disabledProvider !== true},strict:${options.nonStrictProvider !== true},will_fallback_to_fake:false,llm_provider_access_allowed:${options.deniedProvider !== true}}
    : request.method === 'mode.list' ? {modes:[{mode_id:'implementer'}]}
    : {attempted:true,healthy:${options.unhealthyProvider !== true}};
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n');
}
`);
  writeExecutable(cliPath, String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.BROWNIE_WORKSPACE_ROOT;
const args = process.argv.slice(2).filter((value) => value !== '--json');
const write = (value) => process.stdout.write(JSON.stringify(value));
fs.appendFileSync(${JSON.stringify(path.join(root, 'cli-invocations.jsonl'))},JSON.stringify(args)+'\n');
if (${options.requireWorkspaceCwd === true} && fs.realpathSync(process.cwd()) !== fs.realpathSync(root)) process.exit(91);
if (${options.rejectRuntimePathOverride === true} && process.env.BROWNIE_RUNTIME_PATH) process.exit(92);
const runId='run-fixture',taskId='task-fixture';
const ledgerPath=path.join(root,'.brownie','runs',runId,'ledger.jsonl');
if(args[0]==='mode') {write({mode_list:{modes:[{mode_id:'implementer'}]}});process.exit(0);}
if(args[0]==='run') {
 if(${options.requireProcessLossSignal !== false} && process.env.BROWNIE_RELEASE_ARTIFACT_SOAK_PROCESS_LOSS_AFTER_JOURNEY_STARTED!=='1')process.exit(93);
 fs.mkdirSync(path.dirname(ledgerPath),{recursive:true});
 fs.writeFileSync(ledgerPath,JSON.stringify({kind:${options.missingDurableBoundary === true ? "'Other'" : "'HeadlessJourneyStarted'"},run_id:runId,task_id:taskId})+'\n');
 fs.writeFileSync(path.join(root,'user-source.txt'),'durable user workspace input\n');
 process.exit(${options.processLossExitCode ?? 75});
}
if(args[0]==='resume') {
 const resumedOnce=fs.readFileSync(ledgerPath,'utf8').includes('recovery_continuation');
 if(!resumedOnce) {
  if(${options.truncateLedgerOnResume === true})fs.writeFileSync(ledgerPath,'{"kind":"recovered"}\n');
  fs.appendFileSync(ledgerPath,JSON.stringify({kind:'recovery_continuation',run_id:runId,task_id:taskId})+'\n');
  if(${options.terminalFailure === true}) {
   fs.appendFileSync(ledgerPath,JSON.stringify({kind:'TaskFailed',run_id:runId,task_id:taskId})+'\n');
   write({resume:{status:'no_eligible_task',controller_action:'resume',continuation_required:true,terminal_failure:true}});process.exit(0);
  }
  if(!${options.missingTaskOutput === true})fs.writeFileSync(path.join(root,'journey-output.md'),'Brownie completed the artifact Runtime journey.\n');
  const ledgerTask=${options.mismatchedTaskLedger === true ? "'another-task'" : 'taskId'};
  fs.appendFileSync(ledgerPath,JSON.stringify({kind:'TaskCompleted',run_id:runId,task_id:ledgerTask})+'\n');
  if(!${options.missingLedgerApply === true})fs.appendFileSync(ledgerPath,JSON.stringify({kind:'WorkspacePatchApplyResultRecorded',run_id:runId,task_id:ledgerTask,payload:{applied:true,apply_status:'Applied'}})+'\n');
  write({resume:{status:'objective_proposal_applied',controller_action:'resume',continuation_required:true,terminal_failure:false,
   run_id:runId,task_id:taskId,session_id:'session-fixture',journey_id:'journey-fixture',objective_apply_applied:true,objective_apply_apply_status:'Applied',terminal_completion_final_state:'Completed',terminal_completion_task_status:'Completed'}});process.exit(0);
 }
 if(${options.replayMutation === true})fs.appendFileSync(ledgerPath,'{"kind":"duplicate"}\n');
 if(${options.userWorkspaceReplayMutation === true || options.symlinkTargetReplayMutation === true})fs.appendFileSync(path.join(root,'user-source.txt'),'duplicate user workspace side effect\n');
 if(${options.createUserDirectory === true})fs.mkdirSync(path.join(root,'replayed-directory'));
 if(${options.changeUserMode === true})fs.chmodSync(path.join(root,'user-source.txt'),0o600);
 write({resume:{status:'no_eligible_task',controller_action:'stop',continuation_required:false}});process.exit(0);
}
process.exit(64);
`);
  const artifact = { schema_version: 1, target, artifact: { path: 'brownie', sha256: sha256File(cliPath) }, runtime_companion: { path: 'brownie-runtime', sha256: sha256File(runtimePath) } };
  fs.writeFileSync(path.join(packageRoot, 'artifact-evidence.json'), `${JSON.stringify(artifact)}\n`);
  fs.writeFileSync(path.join(packageRoot, 'SHA256SUMS'), `${artifact.artifact.sha256.slice(7)}  brownie\n${artifact.runtime_companion.sha256.slice(7)}  brownie-runtime\n`);
  const archivePath = path.join(root, `brownie-${target}.tar.gz`);
  const archive = spawnSync('tar', ['-czf', archivePath, '-C', packageRoot, 'brownie', 'brownie-runtime', 'artifact-evidence.json', 'SHA256SUMS'], { encoding: 'utf8' });
  assert.equal(archive.status, 0, archive.stderr);
  return archivePath;
}

test('stateful soak uses only the packaged artifact and records bounded recovery, replay, and evidence-chain checks', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-artifact-soak-fixture-'));
  const evidencePath = path.join(root, 'evidence.json');
  const evidence = await runReleaseArtifactStatefulSoak({
    targetId: 'linux-x64',
    archivePath: createFixtureArchive(root),
    workspaceRoot: path.join(root, 'workspace'),
    evidencePath,
    workflowRunId: 'workflow-fixture-123'
  });
  assert.equal(evidence.workflow_run_id, 'workflow-fixture-123');
  assert.equal(evidence.bounds.commands_executed, 3);
  assert.equal(evidence.bounds.bootstrap_runtime_calls, 1);
  assert.equal(evidence.bounds.total_runtime_processes, 4);
  const invocations = fs.readFileSync(path.join(root, 'cli-invocations.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(invocations.length, 3);
  assert.deepEqual(invocations.map((args) => args[0]), ['run', 'resume', 'resume']);
  assert.ok(invocations[2].includes('--run-id'));
  assert.equal(evidence.checks.task_execution.applied, true);
  assert.equal(evidence.checks.provider_bootstrap.strict, true);
  assert.equal(evidence.checks.process_loss_recovery.fresh_process_resume, true);
  assert.equal(evidence.checks.artifact_execution_boundary.packaged_cli_only, true);
  assert.equal(evidence.checks.artifact_execution_boundary.isolated_workspace_cwd, true);
  assert.equal(evidence.checks.artifact_execution_boundary.runtime_path_override_removed, true);
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

test('stateful soak rejects a non-process-loss run failure even after a durable journey boundary', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-artifact-soak-wrong-exit-'));
  await assert.rejects(
    () => runReleaseArtifactStatefulSoak({
      targetId: 'linux-x64',
      archivePath: createFixtureArchive(root, { processLossExitCode: 74 }),
      workspaceRoot: path.join(root, 'workspace')
    }),
    /required process-loss status 75/u
  );
});

test('stateful soak treats a blank workflow run identifier as absent evidence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-artifact-soak-blank-workflow-run-'));
  const evidence = await runReleaseArtifactStatefulSoak({
    targetId: 'linux-x64',
    archivePath: createFixtureArchive(root),
    workspaceRoot: path.join(root, 'workspace'),
    workflowRunId: '   '
  });
  assert.equal(evidence.workflow_run_id, null);
});

test('stateful soak runs a packaged artifact from an isolated workspace without a source runtime override', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-artifact-soak-isolated-workspace-'));
  const evidence = await runReleaseArtifactStatefulSoak({
    targetId: 'linux-x64',
    archivePath: createFixtureArchive(root, {
      target: 'linux-x64',
      requireWorkspaceCwd: true,
      rejectRuntimePathOverride: true
    }),
    workspaceRoot: path.join(root, 'workspace'),
    env: { BROWNIE_RUNTIME_PATH: path.join(root, 'must-not-be-used-runtime') }
  });
  assert.equal(evidence.target, 'linux-x64');
  assert.equal(evidence.checks.artifact_execution_boundary.passed, true);
  assert.equal(evidence.checks.finite_convergence.commands_executed, 3);
});

test('stateful soak rejects replay mutations to files outside the Brownie state directory', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-artifact-soak-user-workspace-'));
  await assert.rejects(
    () => runReleaseArtifactStatefulSoak({
      targetId: 'linux-x64',
      archivePath: createFixtureArchive(root, { userWorkspaceReplayMutation: true }),
      workspaceRoot: path.join(root, 'workspace')
    }),
    /duplicate side effect/u
  );
});

test('stateful soak rejects replay mutations through an external symlink target', async () => {
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
  await assert.rejects(
    () => runReleaseArtifactStatefulSoak({
      targetId: 'linux-x64',
      archivePath: createFixtureArchive(root, { symlinkTargetReplayMutation: true }),
      workspaceRoot
    }),
    /duplicate side effect/u
  );
});

test('stateful soak rejects recovery that truncates the durable ledger', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-artifact-soak-ledger-truncation-'));
  await assert.rejects(
    () => runReleaseArtifactStatefulSoak({
      targetId: 'linux-x64',
      archivePath: createFixtureArchive(root, { truncateLedgerOnResume: true }),
      workspaceRoot: path.join(root, 'workspace')
    }),
    /preserve the durable ledger prefix/u
  );
});

test('stateful soak rejects a terminal replay that appends a duplicate ledger side effect', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-artifact-soak-duplicate-'));
  await assert.rejects(
    () => runReleaseArtifactStatefulSoak({
      targetId: 'linux-x64',
      archivePath: createFixtureArchive(root, { replayMutation: true }),
      workspaceRoot: path.join(root, 'workspace')
    }),
    /duplicate side effect/u
  );
});

test('stateful soak rejects a package whose recorded CLI binding was tampered', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-artifact-soak-tamper-'));
  const archivePath = createFixtureArchive(root);
  const unpacked = path.join(root, 'unpacked');
  fs.mkdirSync(unpacked);
  assert.equal(spawnSync('tar', ['-xzf', archivePath, '-C', unpacked], { encoding: 'utf8' }).status, 0);
  fs.appendFileSync(path.join(unpacked, 'brownie'), 'tamper\n');
  assert.equal(spawnSync('tar', ['-czf', archivePath, '-C', unpacked, 'brownie', 'brownie-runtime', 'artifact-evidence.json', 'SHA256SUMS'], { encoding: 'utf8' }).status, 0);
  await assert.rejects(
    () => runReleaseArtifactStatefulSoak({ targetId: 'linux-x64', archivePath, workspaceRoot: path.join(root, 'workspace') }),
    /package integrity mismatch/u
  );
});

test('stateful soak rejects a package whose recorded executable is a symbolic link', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-artifact-soak-symlink-package-'));
  const archivePath = createFixtureArchive(root);
  const unpacked = path.join(root, 'unpacked');
  fs.mkdirSync(unpacked);
  assert.equal(spawnSync('tar', ['-xzf', archivePath, '-C', unpacked], { encoding: 'utf8' }).status, 0);
  fs.unlinkSync(path.join(unpacked, 'brownie'));
  try {
    fs.symlinkSync('brownie-runtime', path.join(unpacked, 'brownie'));
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') return;
    throw error;
  }
  const evidence = JSON.parse(fs.readFileSync(path.join(unpacked, 'artifact-evidence.json'), 'utf8'));
  evidence.artifact.sha256 = sha256File(path.join(unpacked, 'brownie-runtime'));
  fs.writeFileSync(path.join(unpacked, 'artifact-evidence.json'), `${JSON.stringify(evidence)}\n`);
  fs.writeFileSync(path.join(unpacked, 'SHA256SUMS'), `${evidence.artifact.sha256.slice(7)}  brownie\n${evidence.runtime_companion.sha256.slice(7)}  brownie-runtime\n`);
  assert.equal(spawnSync('tar', ['-czf', archivePath, '-C', unpacked, 'brownie', 'brownie-runtime', 'artifact-evidence.json', 'SHA256SUMS'], { encoding: 'utf8' }).status, 0);
  await assert.rejects(
    () => runReleaseArtifactStatefulSoak({ targetId: 'linux-x64', archivePath, workspaceRoot: path.join(root, 'workspace') }),
    /rejects symbolic link/u
  );
});

test('stateful soak fails closed if the configured finite command bound differs from the contract', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-artifact-soak-command-bound-'));
  await assert.rejects(
    () => runReleaseArtifactStatefulSoak({ targetId: 'linux-x64', archivePath: createFixtureArchive(root), workspaceRoot: path.join(root, 'workspace'), maximumCommands: 4 }),
    /maximum command bound must be exactly 3/u
  );
});

test('stateful soak rejects a workspace whose entry count exceeds the bounded snapshot budget', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-artifact-soak-entry-budget-'));
  const workspaceRoot = path.join(root, 'workspace');
  fs.mkdirSync(workspaceRoot);
  for (let index = 0; index < 4097; index += 1) {
    fs.writeFileSync(path.join(workspaceRoot, `entry-${index}`), '');
  }
  await assert.rejects(
    () => runReleaseArtifactStatefulSoak({ targetId: 'linux-x64', archivePath: createFixtureArchive(root), workspaceRoot }),
    /workspace snapshot entry budget exceeded/u
  );
});

test('stateful soak rejects a workspace whose nesting exceeds the bounded snapshot depth', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-artifact-soak-depth-budget-'));
  const workspaceRoot = path.join(root, 'workspace');
  fs.mkdirSync(workspaceRoot);
  let current = workspaceRoot;
  for (let index = 0; index < 65; index += 1) {
    current = path.join(current, 'nested');
    fs.mkdirSync(current);
  }
  await assert.rejects(
    () => runReleaseArtifactStatefulSoak({ targetId: 'linux-x64', archivePath: createFixtureArchive(root), workspaceRoot }),
    /workspace snapshot depth budget exceeded/u
  );
});

test('stateful soak rejects oversized content reached through an external symlink', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-artifact-soak-byte-budget-'));
  const workspaceRoot = path.join(root, 'workspace');
  fs.mkdirSync(workspaceRoot);
  const target = path.join(root, 'large-external-file');
  fs.writeFileSync(target, '');
  fs.truncateSync(target, 64 * 1024 * 1024 + 1);
  try {
    fs.symlinkSync(target, path.join(workspaceRoot, 'external-content'), 'file');
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') return t.skip('external symlink privilege unavailable');
    throw error;
  }
  await assert.rejects(
    () => runReleaseArtifactStatefulSoak({ targetId: 'linux-x64', archivePath: createFixtureArchive(root), workspaceRoot }),
    /workspace snapshot byte budget exceeded/u
  );
});

for (const [name, options, reason] of [
  ['terminal task failure', { terminalFailure: true }, /task failed during process-loss recovery/u],
  ['apply label without its task output', { missingTaskOutput: true }, /materialize the minimal task output/u],
  ['apply label without its ledger record', { missingLedgerApply: true }, /ledger did not record the completed task application/u],
  ['a completion from another task', { mismatchedTaskLedger: true }, /ledger did not record the completed task application/u],
  ['process loss before the durable boundary', { missingDurableBoundary: true }, /durable HeadlessJourneyStarted/u],
  ['a Fake provider', { fakeProvider: true }, /non-Fake strict soak provider/u],
  ['a disabled provider', { disabledProvider: true }, /non-Fake strict soak provider/u],
  ['non-strict configuration', { nonStrictProvider: true }, /non-Fake strict soak provider/u],
  ['denied provider access', { deniedProvider: true }, /non-Fake strict soak provider/u],
  ['unhealthy provider bootstrap', { unhealthyProvider: true }, /non-Fake strict soak provider/u],
  ['an empty replay directory', { createUserDirectory: true }, /duplicate side effect/u]
]) {
  test(`stateful soak rejects ${name}`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-soak-proof-rejection-'));
    const evidencePath = path.join(root, 'evidence.json');
    await assert.rejects(() => runReleaseArtifactStatefulSoak({ targetId: 'linux-x64', archivePath: createFixtureArchive(root, options), workspaceRoot: path.join(root, 'workspace'), evidencePath }), reason);
    assert.equal(fs.existsSync(evidencePath), false, 'failed checks must not publish success evidence');
  });
}

test('stateful soak rejects replay that changes user file permissions', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX permission semantics unavailable');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-soak-permission-replay-'));
  await assert.rejects(() => runReleaseArtifactStatefulSoak({ targetId: 'linux-x64', archivePath: createFixtureArchive(root, { changeUserMode: true }), workspaceRoot: path.join(root, 'workspace') }), /duplicate side effect/u);
});
