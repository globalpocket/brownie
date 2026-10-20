import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { rebaselineStaleClaim, writeTerminalExecutionEvidence } from './phase-loop-claim-rebaseline.mjs';
import { recordTerminalFailureRecovery } from './phase-loop-task-ledger.mjs';

const repositoryRoot = path.resolve(new URL('..', import.meta.url).pathname);

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-claim-rebaseline-'));
  const stateDir = path.join(root, 'state');
  const claims = path.join(stateDir, 'todo-claims');
  const runs = path.join(stateDir, 'runs');
  fs.mkdirSync(claims, { recursive: true });
  fs.mkdirSync(runs, { recursive: true });
  const selected = '- [ ] E-23b-roundtrip-target-02: Create only `scripts/roundtrip.test.mjs`:\n  Route: implementation.\n  Source TODO: E-23b-roundtrip.\n  Depends on: <none>.\n  Completion condition: verify the downloaded package.\n  Verification: run `node --test scripts/roundtrip.test.mjs`.';
  const claimPath = path.join(claims, 'current.json');
  writeJson(claimPath, {
    schema_version: 1,
    claim_id: 'todo-g541-roundtrip-r3',
    status: 'in_progress',
    selected_todo: selected,
    queue_generation: 541,
    queue_fingerprint: 'old-queue',
    run_stamp: '20261019T071825Z',
    retry_cap: 0,
  });
  fs.writeFileSync(path.join(root, 'todo.md'), `${selected}\n`);
  writeJson(path.join(stateDir, 'status.json'), { status: 'no_progress', run_id: 'old-run', supervisor_pid: 86793 });
  writeJson(path.join(stateDir, 'progress-state.json'), {
    classification: 'terminal_failure',
    run_stamp: '20261019T071825Z',
    progress_projection: {
      claim_id: 'todo-g541-roundtrip-r3',
      selected_todo: selected,
      stop_class: 'terminal_failure',
      stop_reason: 'terminal_task_failed',
      cli_status: 'no_eligible_task',
    },
  });
  writeJson(path.join(claims, 'todo-queue-state.json'), { generation: 541, fingerprint: 'new-queue' });
  return { root, stateDir, claims, runs, selected, claimPath };
}

test('isolates stale running r3 claim and records source/queue rebaseline before fresh delegation', () => {
  const f = fixture();
  const result = rebaselineStaleClaim({
    repo: repositoryRoot,
    stateDir: f.stateDir,
    claimPath: f.claimPath,
    statusPath: path.join(f.stateDir, 'status.json'),
    progressPath: path.join(f.stateDir, 'progress-state.json'),
    queuePath: path.join(f.claims, 'todo-queue-state.json'),
    ledgerPath: path.join(f.stateDir, 'task-ledger.jsonl'),
    runsDir: f.runs,
    todoPath: path.join(f.root, 'todo.md'),
    runStamp: '20261020T090000Z',
    baselineRef: 'origin/main',
  });
  assert.equal(result.rebaselined, true, JSON.stringify(result));
  assert.equal(fs.existsSync(f.claimPath), false);
  const audit = JSON.parse(fs.readFileSync(result.audit_path, 'utf8'));
  const archived = JSON.parse(fs.readFileSync(result.stale_claim_path, 'utf8'));
  assert.equal(audit.source.baseline_ref, 'origin/main');
  assert.match(audit.source.baseline_commit, /^[0-9a-f]{40}$/u);
  assert.equal(audit.queue.fingerprint, 'new-queue');
  assert.equal(audit.source_claim.claim_id, 'todo-g541-roundtrip-r3');
  assert.equal(audit.recovery_state, 'redelegatable');
  assert.equal(audit.retry_policy, 'do_not_inherit_source_claim_retry_cap_or_terminal_state');
  assert.equal(archived.retry_eligible, true);
  assert.equal(archived.recovery_state, 'redelegatable');
  assert.equal(fs.readFileSync(path.join(f.root, 'todo.md'), 'utf8'), `${f.selected}\n`);
});

test('requires current-run task execution evidence before terminal failure recording', () => {
  const f = fixture();
  const snapshot = path.join(f.runs, 'claim.before-runtime.json');
  const evidence = path.join(f.runs, 'run.execution-evidence.json');
  writeJson(snapshot, { ok: true, claim: { claim_id: 'claim-current', selected_todo: f.selected } });
  const stdout = path.join(f.runs, 'run.stdout.log');
  writeJson(stdout, {
    run: {
      run_id: 'runtime-current',
      phase_loop_claim_id: 'claim-current',
      status: 'no_eligible_task',
      stop_class: 'terminal_failure',
      stop_reason: 'terminal_task_failed',
      automation: { terminal_failure: true },
    },
  });
  const missing = writeTerminalExecutionEvidence({ stdoutPath: stdout, claimSnapshotPath: snapshot, outputPath: evidence, runStamp: 'run-current' });
  assert.equal(missing.task_execution_confirmed, false);
  writeJson(stdout, {
    run: {
      run_id: 'runtime-current',
      phase_loop_claim_id: 'claim-current',
      status: 'no_eligible_task',
      stop_class: 'terminal_failure',
      stop_reason: 'terminal_task_failed',
      task_execution: { started: true, target_files: ['scripts/roundtrip.test.mjs'], verification_commands: ['node --test scripts/roundtrip.test.mjs'] },
      automation: { terminal_failure: true },
    },
  });
  const confirmed = writeTerminalExecutionEvidence({ stdoutPath: stdout, claimSnapshotPath: snapshot, outputPath: evidence, runStamp: 'run-current' });
  assert.equal(confirmed.task_execution_confirmed, true);
  const selectedHash = crypto.createHash('sha256').update(f.selected).digest('hex');
  const rejected = recordTerminalFailureRecovery(f.root, {
    selected_todo: f.selected,
    claim_id: 'claim-current',
    run_id: 'runtime-current',
    retry_cap: 0,
    controller_fingerprint: 'controller-current',
    execution_evidence: { ...confirmed, selected_todo_sha256: selectedHash },
  });
  assert.equal(rejected.code, 'terminal_failure_retry_cap_zero_requires_redelegation');
});
