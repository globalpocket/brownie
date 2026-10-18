import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  controlPhaseLoop,
  inspectDelegationFeedback,
  inspectWorkerLaunchReceipt,
  registerWorkerLaunchReceipt
} from './phase-loop-supervisor-control.mjs';
import { readTrackedBreakdownReplanRecords } from './phase-loop-todo-state.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const runtimeEvidenceTodo = `- [ ] E-21c-runtime-operational-evidence-impl-2-target-02: Patch only \`scripts/guard-runtime-operational-evidence.test.mjs\` to require runtime operational evidence to model release operation as executable fail-closed evidence:
  Route: implementation.
  Source TODO: E-21c-runtime-operational-evidence.
  Depends on: <none>.
  Completion condition: the runtime operational evidence guard test rejects non-executable evidence and accepts valid executable evidence without weakening the release evidence contract.
  Forbidden changes: do not remove assertions or weaken the guard/test contract.
  Verification: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`.`;

const ownerBlockerTodo = `- [ ] E-20i-runtime-release-ops-blocker: Blocker: Owner-controlled Runtime Release Ops authority is required for clean CI build, artifact upload/provenance, and GitHub Release publication.
  Route: blocker.
  Source TODO: E-20i-runtime-release-ops-blockers.
  Depends on: <none>.
  Completion condition: release engineering owner provides or documents the Runtime Release Ops authority needed for clean CI builds, artifact upload/provenance binding, and GitHub Release publication. Customer or Enterprise production deployment credentials are explicitly out of Runtime Product Ready scope and must not block the OSS Runtime release.
  Forbidden changes: do not attempt to configure external CI/CD, create credentials, publish a GitHub Release, or request customer/Enterprise production deployment credentials.
  Verification: inspect/blocker/fail-closed.`;

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-supervisor-control-'));
  fs.mkdirSync(path.join(repo, '.brownie/private/phase-loop/todo-claims'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({
    scripts: {
      'release:runtime-operational-evidence:test': 'node --test scripts/guard-runtime-operational-evidence.test.mjs',
      'guard:todo-decomposition': 'node scripts/guard-todo-decomposition.mjs',
      'phase-loop:todo-queue-integrity': 'node scripts/phase-loop-todo-queue-integrity.mjs'
    }
  }, null, 2));
  fs.writeFileSync(path.join(repo, 'scripts/guard-runtime-operational-evidence.test.mjs'), 'export const ok = true;\n');
  fs.copyFileSync(
    path.join(__dirname, 'phase-loop-todo-queue-integrity.mjs'),
    path.join(repo, 'scripts/phase-loop-todo-queue-integrity.mjs')
  );
  fs.copyFileSync(
    path.join(__dirname, 'phase-loop-todo-state.mjs'),
    path.join(repo, 'scripts/phase-loop-todo-state.mjs')
  );
  fs.copyFileSync(
    path.join(__dirname, 'guard-todo-decomposition.mjs'),
    path.join(repo, 'scripts/guard-todo-decomposition.mjs')
  );
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  execFileSync('git', ['add', 'package.json', 'scripts/guard-runtime-operational-evidence.test.mjs', 'scripts/phase-loop-todo-queue-integrity.mjs', 'scripts/phase-loop-todo-state.mjs', 'scripts/guard-todo-decomposition.mjs'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' });
  return repo;
}

function writeJson(repo, relativePath, value) {
  const file = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

test('delegation feedback parsing preserves acknowledgements and fails closed on malformed state', () => {
  const repo = makeRepo();
  const feedbackPath = path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json');
  fs.writeFileSync(feedbackPath, '{not-json');
  assert.equal(inspectDelegationFeedback(feedbackPath).state, 'unreadable');

  writeJson(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json', {
    kind: 'phase_loop_delegation_pending',
    completed: false,
    delegation: { status: 'acknowledged', required_actor: 'brownie-agent' }
  });
  assert.equal(inspectDelegationFeedback(feedbackPath).state, 'acknowledged');
});

function workerReceipt(overrides = {}) {
  return {
    schema_version: 1,
    kind: 'phase_loop_worker_launch_receipt',
    status: 'active',
    launch_id: 'launch-01',
    actor: 'brownie-agent',
    claim_id: 'claim-worker',
    target_pr_url: 'https://github.com/globalpocket/brownie/pull/643',
    started_at: '2026-10-18T00:00:00.000Z',
    expires_at: '2026-10-18T01:00:00.000Z',
    last_heartbeat_at: '2026-10-18T00:20:00.000Z',
    heartbeat_interval_seconds: 30,
    idempotency_key: 'instruction-fingerprint-01',
    ...overrides
  };
}

test('requires a live worker-launch receipt and rejects missing, expired, mismatched, and duplicate launches', () => {
  const repo = makeRepo();
  const now = new Date('2026-10-18T00:20:10.000Z');
  assert.equal(inspectWorkerLaunchReceipt(repo, { now }).reason, 'dispatch_not_started');

  const receipt = workerReceipt();
  assert.equal(registerWorkerLaunchReceipt(repo, receipt).ok, true);
  assert.equal(inspectWorkerLaunchReceipt(repo, { now }).ok, true);
  assert.equal(registerWorkerLaunchReceipt(repo, receipt).replayed, true);

  writeJson(repo, '.brownie/private/phase-loop/worker-launch-receipt.json', workerReceipt({
    launch_id: 'launch-expired',
    expires_at: '2026-10-18T00:20:00.000Z'
  }));
  assert.equal(inspectWorkerLaunchReceipt(repo, { now }).reason, 'worker_liveness_missing');

  writeJson(repo, '.brownie/private/phase-loop/worker-launch-receipt.json', workerReceipt({
    launch_id: 'launch-actor-mismatch',
    actor: 'globalpocket'
  }));
  assert.equal(inspectWorkerLaunchReceipt(repo, { now }).reason, 'dispatch_not_started');

  const duplicate = workerReceipt({
    launch_id: 'launch-duplicate',
    idempotency_key: 'instruction-fingerprint-01'
  });
  assert.equal(registerWorkerLaunchReceipt(repo, duplicate).reason, 'duplicate_worker_launch');
});

test('controller refuses normal loop start when worker launch evidence is absent', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const result = controlPhaseLoop({
    repoRoot: repo,
    write: false,
    repair: false,
    start: true
  });
  assert.equal(result.start.attempted, false, JSON.stringify(result, null, 2));
  assert.equal(result.start.reason, 'dispatch_not_started', JSON.stringify(result, null, 2));
  assert.equal(result.start.worker_launch_receipt.reason, 'dispatch_not_started');
});

function writeTodo(repo) {
  fs.mkdirSync(path.join(repo, '.brownie'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), `${runtimeEvidenceTodo}\n`);
  fs.writeFileSync(path.join(repo, '.brownie/todo-breakdown.md'), `# breakdown

Parent TODO: E-21c-runtime-operational-evidence

Dependency graph:
- E-21c-runtime-operational-evidence-impl-2-target-02: <none>

Verification ledger:
- E-21c-runtime-operational-evidence-impl-2-target-02: pnpm --workspace-root release:runtime-operational-evidence:test

Quality rubric:
- E-21c-runtime-operational-evidence-impl-2-target-02: bounded leaf
`);
  execFileSync('git', ['add', '.brownie/todo.md', '.brownie/todo-breakdown.md'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'todo fixture'], { cwd: repo, stdio: 'ignore' });
}

test('reconciles an acknowledged reviewed merged delegation into a durable completion receipt', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const mergedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json', {
    schema_version: 1,
    kind: 'phase_loop_delegation_pending',
    completed: false,
    selected_todo: runtimeEvidenceTodo,
    delegation: {
      required_actor: 'brownie-agent',
      status: 'acknowledged',
      issue_or_pr_url: 'https://github.com/globalpocket/brownie/pull/999',
      acknowledged_at: '2026-10-15T00:00:00Z',
      implementation_commit_or_blocker: mergedCommit
    },
    verification: {
      reviewed_by: 'globalpocket',
      all_ci_checks_passed: true
    }
  });

  const result = controlPhaseLoop({
    repoRoot: repo,
    write: false,
    repair: true,
    start: false,
    delegationProvenanceVerifier(_repoRoot, pullRequestUrl, commit) {
      assert.equal(pullRequestUrl, 'https://github.com/globalpocket/brownie/pull/999');
      assert.equal(commit, mergedCommit);
      return { ok: true };
    }
  });
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');
  const feedback = JSON.parse(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json'), 'utf8'));
  const completion = JSON.parse(fs.readFileSync(path.join(repo, result.repair.acknowledged_delegation_reconciliation.completion_path), 'utf8'));

  assert.equal(result.repair.acknowledged_delegation_reconciliation.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.non_live_todo_residue.ok, true, JSON.stringify(result, null, 2));
  assert.doesNotMatch(todo, /E-21c-runtime-operational-evidence-impl-2-target-02/u);
  assert.equal(feedback.completed, true);
  assert.equal(completion.selected_todo_id, 'E-21c-runtime-operational-evidence-impl-2-target-02');
  assert.equal(completion.implementation_commit, mergedCommit);

});

test('fails closed when acknowledged delegation lacks independently reviewable merge evidence', () => {
  const repo = makeRepo();
  writeTodo(repo);
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json', {
    schema_version: 1,
    kind: 'phase_loop_delegation_pending',
    completed: false,
    selected_todo: runtimeEvidenceTodo,
    delegation: {
      required_actor: 'brownie-agent',
      status: 'acknowledged',
      issue_or_pr_url: 'https://github.com/globalpocket/brownie/pull/999',
      acknowledged_at: '2026-10-15T00:00:00Z',
      implementation_commit_or_blocker: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
    },
    verification: {
      reviewed_by: 'globalpocket',
      all_ci_checks_passed: true
    }
  });

  const result = controlPhaseLoop({
    repoRoot: repo,
    write: false,
    repair: true,
    start: false,
    delegationProvenanceVerifier() {
      return { ok: false, reason: 'delegation_pull_request_provenance_mismatch' };
    }
  });
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');

  assert.equal(
    result.repair.acknowledged_delegation_reconciliation.reason,
    'delegation_pull_request_provenance_mismatch'
  );
  assert.match(todo, /E-21c-runtime-operational-evidence-impl-2-target-02/u);
});

test('dispatches a requested self-update instead of restarting the stale supervisor', () => {
  const repo = makeRepo();
  writeTodo(repo);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-self-update',
    consecutive_failures: 0
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 1,
    progress_projection: { selected_todo: runtimeEvidenceTodo }
  });
  let dispatchedRequest = null;
  const result = controlPhaseLoop({
    repoRoot: repo,
    write: false,
    repair: false,
    start: true,
    selfUpdateRequest: 'Repair the controller contradiction without touching TODO state.',
    selfUpdateDispatcher({ request }) {
      dispatchedRequest = request;
      return { dispatched: true, ok: true, objective_path: '.brownie/private/phase-loop/self-update/request.md' };
    }
  });
  assert.equal(dispatchedRequest, 'Repair the controller contradiction without touching TODO state.');
  assert.equal(result.self_update.dispatched, true);
  assert.equal(result.start.attempted, false);
  assert.equal(result.start.reason, 'self_update_dispatched_requires_review_and_delivery');
});

test('does not restart the normal loop when a requested self-update is rejected', () => {
  const repo = makeRepo();
  writeTodo(repo);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-self-update-rejected',
    consecutive_failures: 0
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 1,
    progress_projection: { selected_todo: runtimeEvidenceTodo }
  });
  const result = controlPhaseLoop({
    repoRoot: repo,
    write: false,
    repair: false,
    start: true,
    selfUpdateRequest: 'Repair the controller contradiction without touching TODO state.',
    selfUpdateDispatcher() {
      return {
        dispatched: false,
        eligibility: { eligible: false, reason: 'implementation_provider_unavailable' }
      };
    }
  });
  assert.equal(result.self_update.dispatched, false);
  assert.equal(result.start.attempted, false);
  assert.equal(result.start.reason, 'self_update_request_not_dispatched_not_starting');
});

test('retains TODO-contract replan feedback until the replan has explicit completion evidence', () => {
  const repo = makeRepo();
  writeTodo(repo);
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json', {
    schema_version: 1,
    kind: 'phase_loop_todo_contract_replan_feedback',
    completed: false,
    reason: 'supervisor_repeated_leaf_failure_requires_todo_contract_replan',
    verification: { completed: false, reason: 'todo_decomposition_guard_failed_after_todo_apply' }
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const feedback = JSON.parse(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json'), 'utf8'));

  assert.equal(result.repair.resolved_repair_feedback_archive.attempted, false, JSON.stringify(result, null, 2));
  assert.equal(result.repair.resolved_repair_feedback_archive.reason, 'feedback_kind_requires_its_own_verification');
  assert.equal(feedback.completed, false);
  assert.equal(feedback.verification.completed, false);
  assert.equal(fs.existsSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback-archive')), false);
});

test('archives a semantic feedback record only when its recorded failure is the current TODO guard', () => {
  const repo = makeRepo();
  writeTodo(repo);
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json', {
    schema_version: 1,
    kind: 'phase_loop_semantic_verification_repair_feedback',
    completed: false,
    reason: 'supervisor_semantic_verification_failure',
    verification_failure: { detected: true, reason: 'todo_decomposition_guard_failed_after_todo_apply' }
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const feedback = JSON.parse(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json'), 'utf8'));

  assert.equal(result.repair.resolved_repair_feedback_archive.ok, true, JSON.stringify(result, null, 2));
  assert.equal(feedback.completed, true);
});

test('retains semantic and invalid-patch feedback until their own verification succeeds', () => {
  for (const kind of ['phase_loop_semantic_verification_repair_feedback', 'phase_loop_invalid_patch_repair_feedback']) {
    const repo = makeRepo();
    writeTodo(repo);
    writeJson(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json', {
      schema_version: 1,
      kind,
      completed: false,
      reason: 'supervisor_failure',
      verification: { completed: false, reason: 'verification_failed', failed_commands: ['pnpm --workspace-root release:runtime-operational-evidence:test'] }
    });

    const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
    const feedback = JSON.parse(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json'), 'utf8'));

    assert.equal(result.repair.resolved_repair_feedback_archive.attempted, false, JSON.stringify(result, null, 2));
    assert.equal(result.repair.resolved_repair_feedback_archive.reason, 'feedback_kind_requires_its_own_verification');
    assert.equal(feedback.completed, false);
    assert.equal(fs.existsSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback-archive')), false);
  }
});

test('escalates repeated no-progress on the same bounded leaf to TODO contract replan feedback', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-no-progress',
    consecutive_failures: 2,
    detail: 'Brownie run exited successfully but repeated the same non-progress fingerprint'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 3,
    run_stamp: '20261003T170000Z',
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      claim_id: 'claim-repeated-no-progress',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-repeated-no-progress',
    status: 'claimed',
    selected_todo: runtimeEvidenceTodo
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const feedback = JSON.parse(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json'), 'utf8'));
  const ledger = fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const blocked = fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/blocked.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');

  assert.equal(result.repair.todo_contract_replan.attempted, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.todo_contract_replan.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_blocked.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_decomposition.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.post_replan_stale_active_claim.ok, true, JSON.stringify(result, null, 2));
  assert.equal(fs.existsSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/current.json')), false);
  assert.equal(result.repair.post_repair_validation.ok, true, JSON.stringify(result, null, 2));
  assert.deepEqual(result.repair.post_repair_validation.failed_steps, []);
  assert.match(todo, /E-21c-replan-stalled-leaf-/u);
  assert.match(todo, /Route: todo-decomposition/u);
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].todo_id, 'E-21c-runtime-operational-evidence-impl-2-target-02');
  assert.match(blocked[0].controller_fingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(feedback.kind, 'phase_loop_todo_contract_replan_feedback');
  assert.equal(feedback.semantic_repair_policy.mode, 'stalled_leaf_contract_replan');
  assert.equal(feedback.failure_ledger_summary.should_replan, true);
  assert.equal(feedback.failure_ledger_summary.replan_reason, 'same_todo_no_progress_threshold');
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].kind, 'no_progress');
  assert.equal(ledger[0].todo_id, 'E-21c-runtime-operational-evidence-impl-2-target-02');
});

test('preserves repeated no-progress across claim migrations in the failure ledger', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress', run_id: 'run-ledger-threshold', consecutive_failures: 0
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress', same_progress_count: 1, run_stamp: '20261008T000000Z',
    last_progress_fingerprint: 'sha256:unchanged-fixture',
    progress_projection: {
      cli_status: 'no_eligible_task', closure: 'no_eligible_task',
      claim_id: 'claim-ledger-threshold', selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-ledger-threshold', status: 'claimed', selected_todo: runtimeEvidenceTodo
  });
  const ledgerPath = path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl');
  const priorEvents = ['prior-a', 'prior-b'].map((event_id, index) => JSON.stringify({
    schema_version: 1, record_type: 'phase_loop_failure_event', event_id,
    observed_at: `2026-10-08T00:0${index}:00Z`,
    todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02',
    selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0], kind: 'no_progress',
    status_run_id: `prior-run-${index}`, progress_run_stamp: `prior-stamp-${index}`,
    progress_fingerprint: 'sha256:unchanged-fixture', same_progress_count: 1
  })).join('\n');
  fs.writeFileSync(ledgerPath, `${priorEvents}\n`);

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });

  assert.equal(result.repair.todo_contract_replan.ok, true, JSON.stringify(result, null, 2));
  assert.equal(
    result.repair.failure_ledger_summary.replan_reason,
    'same_todo_no_progress_ledger_threshold'
  );
});

test('escalates repeated target-and-verification contracts across replan leaf ids', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const firstLine = runtimeEvidenceTodo.split('\n')[0];
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress', run_id: 'run-scope-threshold', consecutive_failures: 1
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress', same_progress_count: 1, run_stamp: '20261008T010000Z',
    progress_projection: { cli_status: 'no_eligible_task', claim_id: 'claim-scope', selected_todo: runtimeEvidenceTodo }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-scope', status: 'claimed', selected_todo: runtimeEvidenceTodo
  });
  const ledgerPath = path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl');
  const targetScope = 'scripts/guard-runtime-operational-evidence.test.mjs';
  const verification = 'run `pnpm --workspace-root release:runtime-operational-evidence:test`.';
  fs.writeFileSync(ledgerPath, [
    'E-21c-runtime-operational-evidence-impl-2-target-01',
    'E-21c-runtime-operational-evidence-impl-2-target-02-prior'
  ].map((todo_id, index) => JSON.stringify({
    schema_version: 1, record_type: 'phase_loop_failure_event', event_id: `scope-${index}`,
    observed_at: `2026-10-08T00:1${index}:00Z`, todo_id,
    selected_todo_first_line: firstLine, target_scope_key: targetScope, verification_command: verification,
    kind: 'invalid_patch', status_run_id: `prior-scope-${index}`, progress_run_stamp: `prior-scope-${index}`
  })).join('\n') + '\n');

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const feedback = JSON.parse(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json'), 'utf8'));

  assert.equal(result.repair.failure_ledger_summary.replan_reason, 'same_target_scope_replan_leaf_threshold');
  assert.equal(result.repair.failure_ledger_summary.target_scope_distinct_todo_count, 3);
  assert.equal(result.repair.delegation_pending.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.todo_contract_replan.reason, 'delegation_pending_blocks_same_scope_replan');
  assert.equal(feedback.kind, 'phase_loop_delegation_pending');
  assert.equal(feedback.delegation.required_actor, 'brownie-agent');

  feedback.delegation.status = 'acknowledged';
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json', feedback);
  const acknowledged = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const preserved = JSON.parse(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json'), 'utf8'));

  assert.equal(acknowledged.repair.delegation_pending.reason, 'delegation_acknowledgement_preserved');
  assert.equal(acknowledged.repair.semantic_verification.reason, 'delegation_pending_takes_precedence');
  assert.equal(acknowledged.repair.invalid_patch.reason, 'delegation_pending_takes_precedence');
  assert.equal(preserved.delegation.status, 'acknowledged');

  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json'), '{truncated');
  const malformed = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });

  assert.equal(malformed.repair.delegation_pending.reason, 'delegation_feedback_unreadable_fail_closed');
  assert.equal(malformed.repair.semantic_verification.reason, 'delegation_pending_takes_precedence');
  assert.equal(malformed.repair.invalid_patch.reason, 'delegation_pending_takes_precedence');
});

test('delegates repeated terminal runtime failure for one target instead of restarting it', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const firstLine = runtimeEvidenceTodo.split('\n')[0];
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress', run_id: 'run-terminal-threshold', consecutive_failures: 1
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress', same_progress_count: 1, run_stamp: '20261008T015000Z',
    last_progress_fingerprint: 'terminal-epoch',
    progress_projection: {
      cli_status: 'no_eligible_task', stop_class: 'terminal_failure',
      claim_id: 'claim-terminal', selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-terminal', status: 'claimed', selected_todo: runtimeEvidenceTodo
  });
  const ledgerPath = path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl');
  const targetScope = 'scripts/guard-runtime-operational-evidence.test.mjs';
  const verification = 'run `pnpm --workspace-root release:runtime-operational-evidence:test`.';
  fs.writeFileSync(ledgerPath, [0, 1].map((index) => JSON.stringify({
    schema_version: 1, record_type: 'phase_loop_failure_event', event_id: `terminal-${index}`,
    observed_at: `2026-10-08T00:3${index}:00Z`, todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02',
    selected_todo_first_line: firstLine, target_scope_key: targetScope, verification_command: verification,
    kind: 'no_progress', status_run_id: `terminal-run-${index}`, progress_run_stamp: `terminal-run-${index}`,
    progress_fingerprint: 'terminal-epoch', projection_stop_class: 'terminal_failure'
  })).join('\n') + '\n');

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const feedback = JSON.parse(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json'), 'utf8'));

  assert.equal(result.repair.failure_ledger_summary.replan_reason, 'same_target_scope_terminal_failure_threshold');
  assert.equal(result.repair.failure_ledger_summary.repeated_terminal_failure_on_single_target, true);
  assert.equal(result.repair.failure_ledger_summary.terminal_target_scope_event_count, 3);
  assert.equal(result.repair.delegation_pending.ok, true, JSON.stringify(result, null, 2));
  assert.equal(feedback.kind, 'phase_loop_delegation_pending');
});

test('does not delegate a terminal failure from mixed no-progress history', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const firstLine = runtimeEvidenceTodo.split('\n')[0];
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress', run_id: 'run-mixed-terminal-history', consecutive_failures: 1
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress', same_progress_count: 1, last_progress_fingerprint: 'terminal-epoch',
    progress_projection: {
      cli_status: 'no_eligible_task', stop_class: 'terminal_failure',
      claim_id: 'claim-mixed-terminal', selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-mixed-terminal', status: 'claimed', selected_todo: runtimeEvidenceTodo
  });
  const ledgerPath = path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl');
  const targetScope = 'scripts/guard-runtime-operational-evidence.test.mjs';
  const verification = 'run `pnpm --workspace-root release:runtime-operational-evidence:test`.';
  fs.writeFileSync(ledgerPath, [0, 1].map((index) => JSON.stringify({
    schema_version: 1, record_type: 'phase_loop_failure_event', event_id: `mixed-${index}`,
    observed_at: `2026-10-08T01:0${index}:00Z`, todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02',
    selected_todo_first_line: firstLine, target_scope_key: targetScope, verification_command: verification,
    kind: 'no_progress', status_run_id: `mixed-run-${index}`, progress_run_stamp: `mixed-run-${index}`,
    progress_fingerprint: 'terminal-epoch', projection_stop_class: 'no_progress'
  })).join('\n') + '\n');

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });

  assert.equal(result.repair.failure_ledger_summary.repeated_terminal_failure_on_single_target, false);
  assert.equal(result.repair.failure_ledger_summary.terminal_target_scope_event_count, 1);
  assert.notEqual(result.repair.failure_ledger_summary.replan_reason, 'same_target_scope_terminal_failure_threshold');
  assert.notEqual(result.repair.delegation_pending.ok, true, JSON.stringify(result, null, 2));
});

test('rebaselines legacy terminal failures only from matching run stdout evidence', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const firstLine = runtimeEvidenceTodo.split('\n')[0];
  const targetScope = 'scripts/guard-runtime-operational-evidence.test.mjs';
  const verification = 'run `pnpm --workspace-root release:runtime-operational-evidence:test`.';
  writeJson(repo, '.brownie/private/phase-loop/status.json', { status: 'stopped', run_id: 'run-terminal-2' });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress', same_progress_count: 1,
    progress_projection: { stop_class: 'terminal_failure', selected_todo: runtimeEvidenceTodo }
  });
  const rows = [0, 1, 2].map((index) => ({
    schema_version: 1, record_type: 'phase_loop_failure_event', event_id: `legacy-terminal-${index}`,
    todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02', selected_todo_first_line: firstLine,
    target_scope_key: targetScope, verification_command: verification, kind: 'no_progress',
    status_run_id: `run_a${index}b${index}`, progress_run_stamp: `20261008T01010${index}Z`, progress_fingerprint: null
  }));
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl'), `${rows.map(JSON.stringify).join('\n')}\n`);
  for (const row of rows) {
    fs.mkdirSync(path.join(repo, '.brownie/private/phase-loop/runs'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/runs', `${row.progress_run_stamp}.stdout.log`), JSON.stringify({ automation: { run_id: row.status_run_id, stop_class: 'terminal_failure' } }));
  }
  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  assert.equal(result.repair.failure_ledger_summary.terminal_target_scope_event_count, 4);
  assert.equal(result.repair.failure_ledger_summary.replan_reason, 'same_target_scope_terminal_failure_threshold');
  assert.equal(result.repair.delegation_pending.ok, true, JSON.stringify(result, null, 2));
});

test('delegates cross-epoch terminal failures only with uninterrupted terminal run evidence', () => {
  const repo = makeRepo(); writeTodo(repo);
  const firstLine = runtimeEvidenceTodo.split('\n')[0];
  const targetScope = 'scripts/guard-runtime-operational-evidence.test.mjs';
  const verification = 'run `pnpm --workspace-root release:runtime-operational-evidence:test`.';
  writeJson(repo, '.brownie/private/phase-loop/status.json', { status: 'stopped', run_id: 'run_ab2' });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', { classification: 'no_progress', same_progress_count: 1, last_progress_fingerprint: 'epoch-2', progress_projection: { stop_class: 'terminal_failure', selected_todo: runtimeEvidenceTodo } });
  const rows = [0, 1, 2].map((index) => ({ schema_version: 1, record_type: 'phase_loop_failure_event', event_id: `epoch-terminal-${index}`, todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02', selected_todo_first_line: firstLine, target_scope_key: targetScope, verification_command: verification, kind: 'no_progress', status_run_id: `run_ab${index}`, progress_run_stamp: `20261008T02010${index}Z`, progress_fingerprint: `epoch-${index}` }));
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl'), `${rows.map(JSON.stringify).join('\n')}\n`);
  fs.mkdirSync(path.join(repo, '.brownie/private/phase-loop/runs'), { recursive: true });
  for (const row of rows) fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/runs', `${row.progress_run_stamp}.stdout.log`), JSON.stringify({ automation: { run_id: row.status_run_id, stop_class: 'terminal_failure' } }));
  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  assert.equal(result.repair.failure_ledger_summary.contiguous_terminal_run_evidence, true);
  assert.equal(result.repair.delegation_pending.ok, true, JSON.stringify(result, null, 2));
});

test('does not use unrelated terminal logs for a missing ledger run artifact', () => {
  const repo = makeRepo(); writeTodo(repo);
  const firstLine = runtimeEvidenceTodo.split('\n')[0];
  const targetScope = 'scripts/guard-runtime-operational-evidence.test.mjs';
  const verification = 'run `pnpm --workspace-root release:runtime-operational-evidence:test`.';
  writeJson(repo, '.brownie/private/phase-loop/status.json', { status: 'stopped', run_id: 'run_ac2' });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', { classification: 'no_progress', same_progress_count: 1, last_progress_fingerprint: 'epoch-2', progress_projection: { stop_class: 'terminal_failure', selected_todo: runtimeEvidenceTodo } });
  const rows = [0, 1, 2].map((index) => ({ schema_version: 1, record_type: 'phase_loop_failure_event', event_id: `missing-terminal-${index}`, todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02', selected_todo_first_line: firstLine, target_scope_key: targetScope, verification_command: verification, kind: 'no_progress', status_run_id: `run_ac${index}`, progress_run_stamp: `20261008T03010${index}Z`, progress_fingerprint: `epoch-${index}` }));
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl'), `${rows.map(JSON.stringify).join('\n')}\n`);
  fs.mkdirSync(path.join(repo, '.brownie/private/phase-loop/runs'), { recursive: true });
  for (const row of rows.slice(0, 2)) fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/runs', `${row.progress_run_stamp}.stdout.log`), JSON.stringify({ automation: { run_id: row.status_run_id, stop_class: 'terminal_failure' } }));
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/runs', '20261008T030102Z.stdout.log'), JSON.stringify({ automation: { run_id: 'run_unrelated', stop_class: 'terminal_failure' } }));
  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  assert.equal(result.repair.failure_ledger_summary.contiguous_terminal_run_evidence, false);
  assert.notEqual(result.repair.delegation_pending.ok, true, JSON.stringify(result, null, 2));
});

test('does not aggregate a replacement leaf with a different verification contract', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const firstLine = runtimeEvidenceTodo.split('\n')[0];
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress', run_id: 'run-different-verification', consecutive_failures: 1
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress', same_progress_count: 1, run_stamp: '20261008T020000Z',
    progress_projection: { cli_status: 'no_eligible_task', claim_id: 'claim-different-verification', selected_todo: runtimeEvidenceTodo }
  });
  const ledgerPath = path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl');
  fs.writeFileSync(ledgerPath, [0, 1].map((index) => JSON.stringify({
    schema_version: 1, record_type: 'phase_loop_failure_event', event_id: `different-verification-${index}`,
    observed_at: `2026-10-08T00:2${index}:00Z`, todo_id: `E-21c-prior-leaf-${index}`,
    selected_todo_first_line: firstLine,
    target_scope_key: 'scripts/guard-runtime-operational-evidence.test.mjs',
    verification_command: 'run `pnpm --workspace-root release:runtime-operational-evidence:integration:test`.',
    kind: 'invalid_patch', status_run_id: `prior-different-${index}`, progress_run_stamp: `prior-different-${index}`
  })).join('\n') + '\n');

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });

  assert.equal(result.repair.failure_ledger_summary.should_replan, false, JSON.stringify(result, null, 2));
  assert.equal(result.repair.failure_ledger_summary.target_scope_event_count, 1);
});

test('rebaselines repeated legacy target failures without inferring their verification command', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const firstLine = runtimeEvidenceTodo.split('\n')[0];
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress', run_id: 'run-legacy-scope', consecutive_failures: 1
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress', same_progress_count: 1, run_stamp: '20261008T030000Z', last_progress_fingerprint: 'sha256:legacy-scope-fingerprint',
    progress_projection: { cli_status: 'no_eligible_task', claim_id: 'claim-legacy-scope', selected_todo: runtimeEvidenceTodo }
  });
  const ledgerPath = path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl');
  fs.writeFileSync(ledgerPath, [0, 1].map((index) => JSON.stringify({
    schema_version: 1, record_type: 'phase_loop_failure_event', event_id: `legacy-scope-${index}`,
    observed_at: `2026-10-08T00:3${index}:00Z`, todo_id: `E-21c-legacy-leaf-${index}`,
    selected_todo_first_line: firstLine, kind: 'no_progress', progress_fingerprint: 'sha256:legacy-scope-fingerprint',
    status_run_id: `legacy-scope-${index}`, progress_run_stamp: `legacy-scope-${index}`
  })).join('\n') + '\n');

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });

  assert.equal(result.repair.failure_ledger_summary.replan_reason, 'legacy_target_scope_rebaseline_required');
  assert.equal(result.repair.failure_ledger_summary.legacy_target_scope_event_count, 2);
  assert.equal(result.repair.todo_contract_replan.ok, true, JSON.stringify(result, null, 2));
});

test('does not rebaseline legacy scope history when the latest run succeeded', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const firstLine = runtimeEvidenceTodo.split('\n')[0];
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'last_run_succeeded', run_id: 'run-success', consecutive_failures: 0
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress', same_progress_count: 1, run_stamp: '20261008T040000Z', last_progress_fingerprint: 'sha256:success-preserves-todo',
    progress_projection: { cli_status: 'no_eligible_task', claim_id: 'claim-success', selected_todo: runtimeEvidenceTodo }
  });
  const ledgerPath = path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl');
  fs.writeFileSync(ledgerPath, [
    { event_id: 'legacy-success', todo_id: 'E-21c-legacy-success', verification_command: null },
    { event_id: 'modern-success', todo_id: 'E-21c-modern-success', verification_command: 'run `pnpm --workspace-root release:runtime-operational-evidence:test`.' }
  ].map((entry) => JSON.stringify({
    schema_version: 1, record_type: 'phase_loop_failure_event', observed_at: '2026-10-08T00:40:00Z',
    ...entry, selected_todo_first_line: firstLine, target_scope_key: 'scripts/guard-runtime-operational-evidence.test.mjs',
    kind: 'no_progress', status_run_id: entry.event_id, progress_run_stamp: entry.event_id,
    progress_fingerprint: 'sha256:success-preserves-todo'
  })).join('\n') + '\n');

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });

  assert.equal(result.repair.failure_ledger.attempted, false);
  assert.equal(result.repair.failure_ledger_summary.should_replan, false, JSON.stringify(result, null, 2));
  assert.equal(result.repair.todo_contract_replan.attempted, false);
  assert.equal(fs.existsSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json')), false);
});

test('does not start when post-replan stale claim archival fails', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress', run_id: 'run-replan-archive-failure', consecutive_failures: 0
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress', same_progress_count: 3, run_stamp: '20261008T000200Z',
    progress_projection: {
      cli_status: 'no_eligible_task', closure: 'no_eligible_task',
      claim_id: 'claim-replan-archive-failure', selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-replan-archive-failure', status: 'claimed', selected_todo: runtimeEvidenceTodo
  });
  const originalWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = function guardedWrite(file, ...args) {
    if (String(file).includes('stale-current-')) {
      throw new Error('simulated stale claim archive write failure');
    }
    return originalWriteFileSync.call(this, file, ...args);
  };
  try {
    const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: true });
    assert.equal(result.repair.post_replan_stale_active_claim.ok, false, JSON.stringify(result, null, 2));
    assert.equal(result.start.attempted, false, JSON.stringify(result, null, 2));
    assert.equal(result.start.reason, 'post_replan_stale_claim_archive_failed');
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }
});

test('does not carry a no-progress ledger streak across a changed progress fingerprint', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress', run_id: 'run-fingerprint-reset', consecutive_failures: 0
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress', same_progress_count: 1, run_stamp: '20261008T000100Z',
    last_progress_fingerprint: 'sha256:after-real-progress',
    progress_projection: {
      cli_status: 'no_eligible_task', closure: 'no_eligible_task',
      claim_id: 'claim-fingerprint-reset', selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-fingerprint-reset', status: 'claimed', selected_todo: runtimeEvidenceTodo
  });
  const ledgerPath = path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl');
  const priorEvents = ['before-a', 'before-b'].map((event_id, index) => JSON.stringify({
    schema_version: 1, record_type: 'phase_loop_failure_event', event_id,
    observed_at: `2026-10-08T00:1${index}:00Z`,
    todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02',
    selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0], kind: 'no_progress',
    status_run_id: `before-run-${index}`, progress_run_stamp: `before-stamp-${index}`,
    progress_fingerprint: 'sha256:before-real-progress', same_progress_count: 1
  })).join('\n');
  fs.writeFileSync(ledgerPath, `${priorEvents}\n`);

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });

  assert.equal(result.repair.failure_ledger_summary.same_fingerprint_no_progress_count, 1);
  assert.equal(result.repair.failure_ledger_summary.should_replan, false, JSON.stringify(result, null, 2));
});

test('does not pair an invalid patch with no-progress from a prior fingerprint epoch', () => {
  const repo = makeRepo();
  writeTodo(repo);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'stopped', run_id: 'run-fingerprint-epoch-reset', consecutive_failures: 0
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'continuation_required', same_progress_count: 0, run_stamp: '20261008T000200Z',
    last_progress_fingerprint: 'sha256:current-repair-epoch',
    progress_projection: {
      cli_status: 'routed_explicit_action', closure: 'routed_explicit_action',
      claim_id: 'claim-fingerprint-epoch-reset', selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-fingerprint-epoch-reset', status: 'claimed', selected_todo: runtimeEvidenceTodo
  });
  const ledgerPath = path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl');
  const events = [
    { event_id: 'prior-no-progress', kind: 'no_progress', progress_fingerprint: 'sha256:before-repair-epoch' },
    { event_id: 'current-invalid-patch', kind: 'invalid_patch', progress_fingerprint: 'sha256:current-repair-epoch' }
  ].map((event, index) => JSON.stringify({
    schema_version: 1, record_type: 'phase_loop_failure_event', observed_at: `2026-10-08T00:2${index}:00Z`,
    todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02',
    selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0], status_run_id: `epoch-run-${index}`,
    progress_run_stamp: `epoch-stamp-${index}`, same_progress_count: 1, ...event
  })).join('\n');
  fs.writeFileSync(ledgerPath, `${events}\n`);

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });

  assert.equal(result.repair.failure_ledger_summary.same_fingerprint_no_progress_count, 0);
  assert.equal(result.repair.failure_ledger_summary.same_fingerprint_invalid_patch_count, 1);
  assert.equal(result.repair.failure_ledger_summary.should_replan, false, JSON.stringify(result, null, 2));
});

test('anchors bounded-leaf rejection feedback to the active claim identity', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const apply = {
    kind: 'todo_apply_rejected',
    reason: 'selected_todo_is_already_a_bounded_leaf',
    repair_hint: 'Do not refine a bounded leaf TODO into another child TODO.',
    selected_patch_targets: ['scripts/guard-runtime-operational-evidence.test.mjs'],
    selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0],
    semantic_repair_policy: { mode: 'bounded_leaf_target_repair' },
    source_run_id: 'run-bounded-feedback'
  };
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-bounded-feedback',
    consecutive_failures: 1,
    detail: `Rejected Brownie TODO refinement proposal before applying it because TODO guard preflight failed; apply=${JSON.stringify(apply)}`
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'continuation_required',
    same_progress_count: 1,
    run_stamp: '20261009T020000Z',
    progress_projection: {
      cli_status: 'routed_explicit_action',
      closure: 'routed_explicit_action',
      claim_id: 'claim-bounded-feedback',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-bounded-feedback',
    status: 'in_progress',
    queue_generation: 17,
    queue_fingerprint: 'queue-bounded-feedback',
    selected_todo: runtimeEvidenceTodo
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const feedback = JSON.parse(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json'), 'utf8'));

  assert.equal(result.repair.bounded_leaf_apply_rejection.ok, true, JSON.stringify(result, null, 2));
  assert.equal(feedback.kind, 'phase_loop_bounded_leaf_apply_rejection_repair_feedback');
  assert.equal(feedback.claim_id, 'claim-bounded-feedback');
  assert.equal(feedback.queue_generation, 17);
  assert.equal(feedback.queue_fingerprint, 'queue-bounded-feedback');
});

test('archives a stale claim and keeps a rejected bounded leaf out of the generic replan path', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const apply = {
    kind: 'todo_apply_rejected',
    reason: 'selected_todo_is_already_a_bounded_leaf',
    repair_hint: 'Do not refine a bounded leaf TODO into another child TODO.',
    selected_patch_targets: ['scripts/guard-runtime-operational-evidence.test.mjs'],
    selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0],
    semantic_repair_policy: { mode: 'bounded_leaf_target_repair' },
    source_run_id: 'run-stale-claim-bounded-leaf'
  };
  const rejectedReplanId = 'E-21c-replan-stalled-leaf-0123456789ab';
  fs.appendFileSync(path.join(repo, '.brownie/todo.md'), `\n- [ ] ${rejectedReplanId}: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to replan stalled Brownie TODO leaf into implementable child TODOs:
  Route: todo-decomposition.
  Source TODO: E-21c-runtime-operational-evidence-impl-2-target-02.
  Depends on: <none>.
  Completion condition: replace the source with child leaves.
  Failure evidence: same_todo_apply_rejection_threshold; same_progress_count=1.
  Forbidden changes: do not weaken guards/tests.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\` and \`pnpm --workspace-root phase-loop:todo-queue-integrity\`.
`);
  fs.appendFileSync(path.join(repo, '.brownie/todo-breakdown.md'), `\n## TODO-repair-${rejectedReplanId}

Parent TODO: E-21c-runtime-operational-evidence-impl-2-target-02

Dependency graph:
- ${rejectedReplanId}: <none>

Verification ledger:
- ${rejectedReplanId}: run \`pnpm --workspace-root guard:todo-decomposition\` and \`pnpm --workspace-root phase-loop:todo-queue-integrity\`.
`);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-stale-claim-bounded-leaf',
    consecutive_failures: 1,
    detail: `Rejected Brownie TODO refinement proposal before applying it because TODO guard preflight failed; recorded repair feedback. apply=${JSON.stringify(apply)}`
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 3,
    run_stamp: '20261007T080000Z',
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      claim_id: 'claim-stale-bounded-leaf',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-stale-bounded-leaf',
    status: 'in_progress',
    selected_todo: '- [ ] E-99-stale-claim: Patch only `scripts/obsolete.mjs`.'
  });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/blocked.jsonl'), `${JSON.stringify({
    schema_version: 1,
    block_reason: 'stalled_leaf_contract_replan',
    todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02',
    selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0]
  })}\n`);
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json', {
    schema_version: 1,
    kind: 'phase_loop_invalid_patch_repair_feedback',
    reason: 'supervisor_invalid_workspace_write_patch',
    invalid_patch: {
      detected: true,
      claim_id: 'claim-stale-bounded-leaf',
      selected_todo: {
        first_line: runtimeEvidenceTodo.split('\n')[0],
        route: 'implementation',
        patch_targets: ['scripts/guard-runtime-operational-evidence.test.mjs']
      },
      invalid_patch_proposals: [{
        path: 'scripts/guard-runtime-operational-evidence.test.mjs',
        operation: 'patch_file',
        validation_reason: 'old_text_not_found'
      }]
    }
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const claimsDir = path.join(repo, '.brownie/private/phase-loop/todo-claims');
  const feedback = JSON.parse(fs.readFileSync(path.join(claimsDir, 'repair-feedback.json'), 'utf8'));
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');
  const archivedClaims = fs.readdirSync(claimsDir).filter((name) => name.startsWith('stale-current-'));

  assert.equal(result.initial_summary.next_action, 'cause_analysis_then_guard_or_queue_repair_before_worker_retry');
  assert.equal(result.repair.stale_active_claim.ok, true, JSON.stringify(result, null, 2));
  assert.equal(fs.existsSync(path.join(claimsDir, 'current.json')), false);
  assert.equal(archivedClaims.length, 1);
  assert.equal(result.repair.bounded_leaf_apply_rejection.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.rejected_bounded_leaf_replan_residue.ok, true, JSON.stringify(result, null, 2));
  assert.deepEqual(result.repair.rejected_bounded_leaf_replan_residue.removed_todo_ids, [rejectedReplanId]);
  assert.equal(result.repair.rejected_bounded_leaf_replan_residue.removed_blocked_record_count, 1);
  assert.equal(fs.readFileSync(path.join(claimsDir, 'blocked.jsonl'), 'utf8'), '');
  assert.equal(result.repair.todo_contract_replan.reason, 'bounded_leaf_target_patch_takes_precedence');
  assert.equal(result.repair.invalid_patch.reason, 'bounded_leaf_target_patch_takes_precedence');
  assert.equal(result.repair.stalled_todo_blocked.reason, 'todo_contract_replan_not_active');
  assert.equal(result.repair.stalled_todo_decomposition.reason, 'todo_contract_replan_not_active');
  assert.equal(feedback.kind, 'phase_loop_bounded_leaf_apply_rejection_repair_feedback');
  assert.equal(feedback.semantic_repair_policy.mode, 'force_bounded_leaf_target_patch');
  assert.equal(feedback.selected_todo_first_line, runtimeEvidenceTodo.split('\n')[0]);
  assert.doesNotMatch(todo, new RegExp(rejectedReplanId, 'u'));
});

test('ensures stalled TODO decomposition request even when blocked record already exists', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-no-progress-existing-blocked',
    consecutive_failures: 1,
    detail: 'Brownie run exited successfully but repeated the same non-progress fingerprint'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 1,
    run_stamp: '20261003T171000Z',
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      claim_id: 'claim-existing-blocked',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-existing-blocked',
    status: 'claimed',
    selected_todo: runtimeEvidenceTodo
  });
  fs.writeFileSync(
    path.join(repo, '.brownie/private/phase-loop/todo-claims/blocked.jsonl'),
    `${JSON.stringify({
      schema_version: 1,
      record_type: 'todo_blocked',
      todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02',
      selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0],
      reason: 'previous_replan_feedback'
    })}\n`
  );
  fs.writeFileSync(
    path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl'),
    `${JSON.stringify({
      schema_version: 1,
      record_type: 'phase_loop_failure_event',
      event_id: 'event-invalid-before-existing-blocked',
      observed_at: '2026-10-03T17:00:00Z',
      todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02',
      selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0],
      kind: 'invalid_patch',
      status: 'no_progress',
      progress_run_stamp: '20261003T170000Z',
      same_progress_count: 2
    })}\n`
  );

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');

  assert.equal(result.repair.todo_contract_replan.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_blocked.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_blocked.changed, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_decomposition.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_decomposition.changed, true, JSON.stringify(result, null, 2));
  assert.match(todo, /E-21c-replan-stalled-leaf-/u);
  assert.match(todo, /Route: todo-decomposition/u);
});

test('adds rich stalled replan block record when legacy block lacks reason', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-legacy-block-record',
    consecutive_failures: 1,
    detail: 'Brownie run exited successfully but repeated the same non-progress fingerprint'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 1,
    run_stamp: '20261005T040000Z',
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      claim_id: 'claim-legacy-block-record',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-legacy-block-record',
    status: 'claimed',
    selected_todo: runtimeEvidenceTodo
  });
  const legacyBlocked = {
    schema_version: 1,
    blocked_at: '2026-10-05T03:00:00Z',
    selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0],
    selected_todo_sha256: crypto.createHash('sha256').update(runtimeEvidenceTodo).digest('hex')
  };
  fs.writeFileSync(
    path.join(repo, '.brownie/private/phase-loop/todo-claims/blocked.jsonl'),
    `${JSON.stringify(legacyBlocked)}\n`
  );
  fs.writeFileSync(
    path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl'),
    `${JSON.stringify({
      schema_version: 1,
      record_type: 'phase_loop_failure_event',
      event_id: 'event-invalid-patch-before-legacy-block',
      observed_at: '2026-10-05T03:30:00Z',
      todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02',
      selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0],
      kind: 'invalid_patch',
      status: 'no_progress',
      progress_run_stamp: '20261005T033000Z',
      same_progress_count: 2
    })}\n`
  );

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const blockedRecords = fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/blocked.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

  assert.equal(result.repair.stalled_todo_blocked.changed, true, JSON.stringify(result, null, 2));
  assert.ok(
    blockedRecords.some((record) => record.block_reason === 'stalled_leaf_contract_replan'),
    JSON.stringify(blockedRecords, null, 2)
  );
  assert.equal(result.repair.stalled_todo_decomposition.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.post_repair_validation.ok, true, JSON.stringify(result, null, 2));
});

test('does not treat stale same-id blocked record as current stalled TODO incarnation', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-no-progress-stale-blocked',
    consecutive_failures: 1,
    detail: 'Brownie run exited successfully but repeated the same non-progress fingerprint'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 1,
    run_stamp: '20261003T171500Z',
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      claim_id: 'claim-stale-blocked',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-stale-blocked',
    status: 'claimed',
    selected_todo: runtimeEvidenceTodo
  });
  fs.writeFileSync(
    path.join(repo, '.brownie/private/phase-loop/todo-claims/blocked.jsonl'),
    `${JSON.stringify({
      schema_version: 1,
      record_type: 'todo_blocked',
      todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02',
      selected_todo_first_line: '- [ ] E-21c-runtime-operational-evidence-impl-2-target-02: Patch only `old-target.mjs` from a stale incarnation:',
      selected_todo_sha256: 'stale-sha',
      reason: 'previous_replan_feedback'
    })}\n`
  );
  fs.writeFileSync(
    path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl'),
    `${JSON.stringify({
      schema_version: 1,
      record_type: 'phase_loop_failure_event',
      event_id: 'event-invalid-before-stale-blocked',
      observed_at: '2026-10-03T17:05:00Z',
      todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02',
      selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0],
      kind: 'invalid_patch',
      status: 'no_progress',
      progress_run_stamp: '20261003T170500Z',
      same_progress_count: 2
    })}\n`
  );

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const blocked = fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/blocked.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

  assert.equal(result.repair.todo_contract_replan.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_blocked.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_blocked.changed, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_decomposition.ok, true, JSON.stringify(result, null, 2));
  assert.equal(blocked.length, 2);
  assert.equal(blocked[1].selected_todo_first_line, runtimeEvidenceTodo.split('\n')[0]);
});

test('removes completed TODO residue and stale stalled-leaf replan before restart', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const replanTodo = `- [ ] E-21c-replan-stalled-leaf-${'a'.repeat(12)}: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to replan stalled Brownie TODO leaf into implementable child TODOs:
  Route: todo-decomposition.
  Source TODO: E-21c-runtime-operational-evidence-impl-2-target-02.
  Depends on: <none>.
  Completion condition: Patch \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` so stalled TODO is replaced by implementable child leaves.
  Forbidden changes: do not weaken guards/tests.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\` and \`pnpm --workspace-root phase-loop:todo-queue-integrity\`.`;
  const dependentTodo = `- [ ] E-21c-runtime-operational-evidence-impl-2-target-03: Patch only \`scripts/guard-runtime-operational-evidence.test.mjs\` to complete the dependent slice:
  Route: implementation.
  Source TODO: E-21c-runtime-operational-evidence.
  Depends on: E-21c-runtime-operational-evidence-impl-2-target-02.
  Completion condition: dependent slice remains live after completed prerequisite is pruned.
  Forbidden changes: do not weaken guards/tests.
  Verification: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`.`;
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), `${replanTodo}\n\n${runtimeEvidenceTodo}\n\n${dependentTodo}\n`);
  fs.writeFileSync(path.join(repo, '.brownie/todo-breakdown.md'), `# breakdown

Parent TODO: E-21c-runtime-operational-evidence-impl-2

Dependency graph:
- E-21c-runtime-operational-evidence-impl-2-target-03: E-21c-runtime-operational-evidence-impl-2-target-02

Verification ledger:
- E-21c-runtime-operational-evidence-impl-2-target-03: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`

Quality rubric:
- E-21c-runtime-operational-evidence-impl-2-target-03: bounded dependent leaf remains valid after completed prerequisite pruning.

## TODO-repair-E-21c-replan-stalled-leaf-${'a'.repeat(12)}

Parent TODO: E-21c-runtime-operational-evidence-impl-2-target-02
`);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  fs.mkdirSync(path.join(repo, '.brownie/private/phase-loop/todo-completions'), { recursive: true });
  writeJson(repo, '.brownie/private/phase-loop/todo-completions/completed-target.json', {
    selected_todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02',
    selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0]
  });
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'blocked_todo_recorded',
    run_id: 'stable-blocked-run',
    consecutive_failures: 0,
    detail: 'Selected generated/blocker TODO id was already recorded as blocked in a previous queue generation; removed it from the live queue and will continue with the next unblocked TODO.'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'progress',
    same_progress_count: 0,
    progress_projection: {
      cli_status: 'blocked_todo_recorded',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-completed-residue',
    status: 'claimed',
    selected_todo: runtimeEvidenceTodo
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');
  const breakdown = fs.readFileSync(path.join(repo, '.brownie/todo-breakdown.md'), 'utf8');

  assert.equal(result.repair.non_live_todo_residue.attempted, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.non_live_todo_residue.ok, true, JSON.stringify(result, null, 2));
  assert.deepEqual(
    result.repair.non_live_todo_residue.removed_todo_ids.sort(),
    [`E-21c-replan-stalled-leaf-${'a'.repeat(12)}`, 'E-21c-runtime-operational-evidence-impl-2-target-02'].sort()
  );
  assert.doesNotMatch(todo, /E-21c-replan-stalled-leaf-/u);
  assert.doesNotMatch(todo, /E-21c-runtime-operational-evidence-impl-2-target-02: Patch only/u);
  assert.match(todo, /Depends on: <none>/u);
  assert.match(todo, /E-21c-runtime-operational-evidence-impl-2-target-03/u);
  assert.doesNotMatch(breakdown, /TODO-repair-E-21c-replan-stalled-leaf-/u);
  assert.ok(result.repair.non_live_todo_residue.dependency_rebaseline_receipt, JSON.stringify(result, null, 2));
  const receipt = JSON.parse(fs.readFileSync(path.join(repo, result.repair.non_live_todo_residue.dependency_rebaseline_receipt), 'utf8'));
  assert.equal(receipt.record_type, 'completed_dependency_pruned_rebaseline');
  assert.deepEqual(receipt.pruned_dependency_lines[0].pruned_dependency_ids, ['E-21c-runtime-operational-evidence-impl-2-target-02']);
  assert.equal(result.repair.post_repair_validation.ok, true, JSON.stringify(result, null, 2));
});

test('preserves todo preamble and checked items when pruning generated TODO residue', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const removableTodo = `- [ ] E-21c-replan-stalled-leaf-${'b'.repeat(12)}: Patch only \`.brownie/todo.md\` to remove stale generated residue:
  Route: todo-decomposition.
  Source TODO: E-21c-runtime-operational-evidence-impl-2-target-02.
  Depends on: <none>.
  Completion condition: stale generated residue is removed.
  Forbidden changes: do not weaken guards/tests.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
  const checkedTodo = `- [x] E-21c-completed-context: Completed context must remain in the file:
  Route: implementation.
  Source TODO: E-21c.
  Depends on: <none>.
  Completion condition: already completed.
  Forbidden changes: do not remove this historical record.
  Verification: already complete.`;
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), `# Brownie TODO Queue

Operator note that must be preserved.

${checkedTodo}

${removableTodo}

${ownerBlockerTodo}
`);
  fs.writeFileSync(path.join(repo, '.brownie/todo-breakdown.md'), `# breakdown

Dependency graph:
- E-20i-runtime-release-ops-blocker: <none>

Verification ledger:
- E-20i-runtime-release-ops-blocker: inspect/blocker/fail-closed

Quality rubric:
- E-20i-runtime-release-ops-blocker: explicit owner blocker
`);
  execFileSync('git', ['add', '.brownie/todo.md', '.brownie/todo-breakdown.md'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'todo preamble fixture'], { cwd: repo, stdio: 'ignore' });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'blocked',
    run_id: 'claim-failed',
    consecutive_failures: 5,
    detail: 'Failed to claim first pending TODO from queue: .brownie/todo.md'
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');

  assert.equal(result.repair.non_live_todo_residue.attempted, true, JSON.stringify(result, null, 2));
  assert.doesNotMatch(todo, /E-21c-replan-stalled-leaf-/u);
  assert.match(todo, /# Brownie TODO Queue/u);
  assert.match(todo, /Operator note that must be preserved/u);
  assert.match(todo, /E-21c-completed-context/u);
  assert.match(todo, /E-20i-runtime-release-ops-blocker/u);
});

test('preserves stalled replan TODO when source TODO is blocked', () => {
  const repo = makeRepo();
  const sourceTodo = `- [ ] E-22e-release-contract-trace-binding-guard: Patch only \`scripts/guard-release-contract.mjs\` and \`scripts/guard-release-contract.test.mjs\`:
  Route: implementation.
  Source TODO: E-22e.
  Depends on: <none>.
  Completion condition: source is blocked after repeated invalid patch.
  Forbidden changes: do not weaken guards/tests.
  Verification: run \`pnpm --workspace-root guard:release-contract:test\`.`;
  const replanTodo = `- [ ] E-22e-replan-stalled-leaf-16e2c69e67bb: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to replan stalled Brownie TODO leaf into implementable child TODOs:
  Route: todo-decomposition.
  Source TODO: E-22e-release-contract-trace-binding-guard.
  Depends on: <none>.
  Completion condition: stalled source is superseded by implementable leaves.
  Failure evidence: invalid_patch_followed_by_no_progress; same_progress_count=1.
  Forbidden changes: do not implement the release-evidence fix here.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), `${sourceTodo}\n\n${replanTodo}\n`);
  fs.writeFileSync(path.join(repo, '.brownie/todo-breakdown.md'), `# breakdown

## TODO-repair-E-22e-replan-stalled-leaf-16e2c69e67bb

Parent TODO: E-22e-release-contract-trace-binding-guard
`);
  execFileSync('git', ['add', '.brownie/todo.md', '.brownie/todo-breakdown.md'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'blocked source replan fixture'], { cwd: repo, stdio: 'ignore' });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'blocked-source-replan',
    consecutive_failures: 0,
    detail: 'Brownie run exited successfully but repeated the same non-progress fingerprint.'
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/blocked.jsonl', {
    selected_todo_id: 'E-22e-release-contract-trace-binding-guard',
    reason: 'invalid_patch_followed_by_no_progress'
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');
  const breakdown = fs.readFileSync(path.join(repo, '.brownie/todo-breakdown.md'), 'utf8');

  assert.notEqual(
    result.repair.non_live_todo_residue.reason,
    'stalled_replan_source_blocked',
    JSON.stringify(result, null, 2)
  );
  assert.match(todo, /E-22e-replan-stalled-leaf-16e2c69e67bb/u);
  assert.match(breakdown, /TODO-repair-E-22e-replan-stalled-leaf-16e2c69e67bb/u);
});

test('recovers a terminal no-eligible generated replan projected onto its bounded implementation source', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const sourceTodo = runtimeEvidenceTodo;
  const sourceId = 'E-21c-runtime-operational-evidence-impl-2-target-02';
  const replanId = `E-21c-replan-stalled-leaf-${'c'.repeat(12)}`;
  const replanTodo = `- [ ] ${replanId}: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to replan stalled Brownie TODO leaf into implementable child TODOs:\n  Route: todo-decomposition.\n  Source TODO: ${sourceId}.\n  Depends on: <none>.\n  Completion condition: stalled TODO is superseded.\n  Forbidden changes: do not weaken guards/tests.\n  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
  fs.appendFileSync(path.join(repo, '.brownie/todo.md'), `\n${replanTodo}\n`);
  fs.appendFileSync(path.join(repo, '.brownie/todo-breakdown.md'), `\n## TODO-repair-${replanId}\n\nParent TODO: ${sourceId}\n\nDependency graph:\n- ${replanId}: <none>\n\nVerification ledger:\n- ${replanId}: run \`pnpm --workspace-root guard:todo-decomposition\`\n\nQuality rubric:\n- ${replanId}: bounded recovery replan\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'terminal-replan',
    consecutive_failures: 0,
    detail: 'runtime terminal task failed without a workspace.write proposal'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 1,
    selected_todo: { id: sourceId, first_line: sourceTodo.split('\n')[0], route: 'implementation' },
    progress_projection: { cli_status: 'no_eligible_task', stop_class: 'terminal_failure', selected_todo: sourceTodo }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json', {
    kind: 'phase_loop_todo_contract_replan_feedback',
    selected_todo_first_line: sourceTodo.split('\n')[0]
  });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/blocked.jsonl'), `${JSON.stringify({
    block_reason: 'stalled_leaf_contract_replan',
    todo_id: sourceId,
    selected_todo_first_line: sourceTodo.split('\n')[0]
  })}\n`);
  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');
  const feedback = JSON.parse(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json'), 'utf8'));

  assert.equal(result.repair.terminal_stalled_replan_recovery.ok, true, JSON.stringify(result, null, 2));
  assert.match(todo, new RegExp(sourceId, 'u'));
  assert.doesNotMatch(todo, new RegExp(replanId, 'u'));
  assert.equal(feedback.semantic_repair_policy.mode, 'force_bounded_leaf_target_patch');
  assert.equal(feedback.archived_claim_path, null);
  assert.deepEqual(feedback.semantic_repair_policy.selected_patch_targets, [
    'scripts/guard-runtime-operational-evidence.test.mjs'
  ]);
  assert.equal(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/blocked.jsonl'), 'utf8'), '');
});

test('recovers a live generated replan after semantic verification feedback replaces its replan feedback', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const sourceTodo = runtimeEvidenceTodo;
  const sourceId = 'E-21c-runtime-operational-evidence-impl-2-target-02';
  const replanId = `E-21c-replan-stalled-leaf-${'e'.repeat(12)}`;
  const replanTodo = `- [ ] ${replanId}: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to replan stalled Brownie TODO leaf into implementable child TODOs:\n  Route: todo-decomposition.\n  Source TODO: ${sourceId}.\n  Depends on: <none>.\n  Completion condition: stalled TODO is superseded.\n  Forbidden changes: do not weaken guards/tests.\n  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
  fs.appendFileSync(path.join(repo, '.brownie/todo.md'), `\n${replanTodo}\n`);
  fs.appendFileSync(path.join(repo, '.brownie/todo-breakdown.md'), `\n## TODO-repair-${replanId}\n\nParent TODO: ${sourceId}\n\nDependency graph:\n- ${replanId}: <none>\n\nVerification ledger:\n- ${replanId}: run \`pnpm --workspace-root guard:todo-decomposition\`\n\nQuality rubric:\n- ${replanId}: bounded recovery replan\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress', run_id: 'semantic-feedback-replan', consecutive_failures: 1,
    detail: 'runtime terminal task failed without a workspace.write proposal'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress', same_progress_count: 2,
    selected_todo: { id: sourceId, first_line: sourceTodo.split('\n')[0], route: 'implementation' },
    progress_projection: { cli_status: 'no_eligible_task', stop_class: 'terminal_failure', selected_todo: sourceTodo }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json', {
    kind: 'phase_loop_semantic_verification_repair_feedback',
    selected_todo_first_line: sourceTodo.split('\n')[0],
    reason: 'dirty_baseline_verification_failed'
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');
  const feedback = JSON.parse(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json'), 'utf8'));

  assert.equal(result.repair.terminal_stalled_replan_recovery.ok, true, JSON.stringify(result, null, 2));
  assert.doesNotMatch(todo, new RegExp(replanId, 'u'));
  assert.equal(feedback.semantic_repair_policy.mode, 'force_bounded_leaf_target_patch');
  assert.deepEqual(feedback.semantic_repair_policy.selected_patch_targets, [
    'scripts/guard-runtime-operational-evidence.test.mjs'
  ]);
});

test('does not recover a replan when terminal projection and durable feedback select different source leaves', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const sourceTodo = runtimeEvidenceTodo;
  const sourceId = 'E-21c-runtime-operational-evidence-impl-2-target-02';
  const projectedSourceId = 'E-21c-different-terminal-leaf-target-01';
  const projectedTodo = `- [ ] ${projectedSourceId}: Patch only \`scripts/guard-runtime-operational-evidence.test.mjs\`:\n  Route: implementation.`;
  const replanId = `E-21c-replan-stalled-leaf-${'d'.repeat(12)}`;
  const projectedReplanId = `E-21c-replan-stalled-leaf-${'f'.repeat(12)}`;
  const replanTodo = `- [ ] ${replanId}: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to replan stalled Brownie TODO leaf into implementable child TODOs:\n  Route: todo-decomposition.\n  Source TODO: ${sourceId}.\n  Depends on: <none>.\n  Completion condition: stalled TODO is superseded.\n  Forbidden changes: do not weaken guards/tests.\n  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
  const projectedReplanTodo = `- [ ] ${projectedReplanId}: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to replan stalled Brownie TODO leaf into implementable child TODOs:\n  Route: todo-decomposition.\n  Source TODO: ${projectedSourceId}.\n  Depends on: <none>.\n  Completion condition: stalled TODO is superseded.\n  Forbidden changes: do not weaken guards/tests.\n  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
  fs.appendFileSync(path.join(repo, '.brownie/todo.md'), `\n${projectedTodo}\n\n${replanTodo}\n\n${projectedReplanTodo}\n`);
  fs.appendFileSync(path.join(repo, '.brownie/todo-breakdown.md'), `\n## TODO-repair-${replanId}\n\nParent TODO: ${sourceId}\n\nDependency graph:\n- ${replanId}: <none>\n\nVerification ledger:\n- ${replanId}: run \`pnpm --workspace-root guard:todo-decomposition\`\n\nQuality rubric:\n- ${replanId}: bounded recovery replan\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress', run_id: 'mismatched-terminal-replan', consecutive_failures: 0,
    detail: 'runtime terminal task failed without a workspace.write proposal'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress', same_progress_count: 1,
    selected_todo: { id: projectedSourceId, first_line: projectedTodo.split('\n')[0], route: 'implementation' },
    progress_projection: { cli_status: 'no_eligible_task', stop_class: 'terminal_failure', selected_todo: projectedTodo }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json', {
    kind: 'phase_loop_todo_contract_replan_feedback', selected_todo_first_line: sourceTodo.split('\n')[0]
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');

  assert.equal(result.repair.terminal_stalled_replan_recovery.attempted, false, JSON.stringify(result, null, 2));
  assert.match(todo, new RegExp(replanId, 'u'));
  assert.match(todo, new RegExp(projectedReplanId, 'u'));
});

test('does not inherit completion from Source TODO lineage', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const parentTodo = `- [x] E-21c-owner-governance-reproducibility-impl-7: Patch only \`scripts/release-owner-governance-evidence.mjs\` and \`scripts/guard-owner-governance-evidence.test.mjs\`:
  Route: implementation.
  Source TODO: TODO-refine-brownie-owned-blockers.
  Depends on: <none>.
  Completion condition: parent is complete.
  Forbidden changes: do not weaken guards/tests.
  Verification: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`.`;
  const childOne = `- [ ] E-21c-owner-governance-reproducibility-impl-7-target-01: Patch only \`scripts/release-owner-governance-evidence.mjs\` to complete one bounded slice:
  Route: implementation.
  Source TODO: E-21c-owner-governance-reproducibility-impl-7.
  Depends on: <none>.
  Completion condition: child should not remain live after parent completion.
  Forbidden changes: do not weaken guards/tests.
  Verification: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`.`;
  const childTwo = `- [ ] E-21c-owner-governance-reproducibility-impl-7-target-02: Patch only \`scripts/guard-owner-governance-evidence.test.mjs\` to complete one bounded slice:
  Route: implementation.
  Source TODO: E-21c-owner-governance-reproducibility-impl-7.
  Depends on: E-21c-owner-governance-reproducibility-impl-7-target-01.
  Completion condition: dependent child should not remain live after parent completion.
  Forbidden changes: do not weaken guards/tests.
  Verification: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`.`;
  const ownerBlocker = `- [ ] E-20i-runtime-release-ops-blocker: Blocker: External release engineering ownership required.
  Route: blocker.
  Source TODO: E-20i-runtime-release-ops-blockers.
  Depends on: <none>.
  Completion condition: owner provides evidence.
  Forbidden changes: do not invent credentials.
  Verification: inspect/blocker/fail-closed.`;
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), `${ownerBlocker}\n\n${parentTodo}\n\n${childOne}\n\n${childTwo}\n`);
  fs.writeFileSync(path.join(repo, '.brownie/todo-breakdown.md'), `# breakdown

Parent TODO: E-21c-owner-governance-reproducibility-impl-7

Dependency graph:
- E-20i-runtime-release-ops-blocker: <none>
- E-21c-owner-governance-reproducibility-impl-7-target-01: <none>
- E-21c-owner-governance-reproducibility-impl-7-target-02: E-21c-owner-governance-reproducibility-impl-7-target-01

Verification ledger:
- E-20i-runtime-release-ops-blocker: inspect/blocker/fail-closed
- E-21c-owner-governance-reproducibility-impl-7-target-01: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`
- E-21c-owner-governance-reproducibility-impl-7-target-02: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`

Quality rubric:
- E-20i-runtime-release-ops-blocker: explicit owner blocker
- E-21c-owner-governance-reproducibility-impl-7-target-01: bounded child
- E-21c-owner-governance-reproducibility-impl-7-target-02: bounded child
`);
  execFileSync('git', ['add', '.brownie/todo.md', '.brownie/todo-breakdown.md'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'parent-child todo fixture'], { cwd: repo, stdio: 'ignore' });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'blocked',
    run_id: 'claim-failed',
    consecutive_failures: 5,
    detail: 'Failed to claim first pending TODO from queue: .brownie/todo.md'
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');

  assert.equal(
    result.repair.non_live_todo_residue.reason,
    'no_non_live_todo_residue_detected',
    JSON.stringify(result, null, 2)
  );
  assert.match(todo, /E-21c-owner-governance-reproducibility-impl-7-target-01/u);
  assert.match(todo, /E-21c-owner-governance-reproducibility-impl-7-target-02/u);
  assert.match(todo, /E-20i-runtime-release-ops-blocker/u);
});

test('preserves superseded split children when the checked parent is only a dependency anchor', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const parentId = 'E-23a-release-artifact-portable-archive';
  const childOneId = `${parentId}-target-01`;
  const childTwoId = `${parentId}-target-02`;
  const parentTodo = `- [x] ${parentId}: Patch only \`scripts/release-local-artifact.mjs\` and \`scripts/release-local-artifact.test.mjs\`:
  Route: implementation.
  Source TODO: external review.
  Depends on: <none>.
  Completion condition: parent is superseded by bounded children.
  Forbidden changes: do not weaken checks.
  Verification: run \`pnpm --workspace-root phase-loop:supervisor-control:test\`.`;
  const childOne = `- [ ] ${childOneId}: Patch only \`scripts/release-local-artifact.mjs\`:
  Route: implementation.
  Source TODO: ${parentId}.
  Depends on: <none>.
  Completion condition: implement the first bounded slice.
  Forbidden changes: do not edit sibling targets.
  Verification: run \`pnpm --workspace-root phase-loop:supervisor-control:test\`.`;
  const childTwo = `- [ ] ${childTwoId}: Patch only \`scripts/release-local-artifact.test.mjs\`:
  Route: implementation.
  Source TODO: ${parentId}.
  Depends on: ${childOneId}.
  Completion condition: verify the bounded implementation slice.
  Forbidden changes: do not edit sibling targets.
  Verification: run \`pnpm --workspace-root phase-loop:supervisor-control:test\`.`;
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), `${parentTodo}\n\n${childOne}\n\n${childTwo}\n`);
  fs.writeFileSync(path.join(repo, '.brownie/todo-breakdown.md'), '# breakdown\n');
  execFileSync('git', ['add', '.brownie/todo.md', '.brownie/todo-breakdown.md'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'superseded split fixture'], { cwd: repo, stdio: 'ignore' });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'superseded-split-residue',
    consecutive_failures: 1,
    detail: 'Supervisor is evaluating generated child residue.'
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-replans/split.json', {
    record_type: 'todo_replan',
    operation: 'split_parent_into_children',
    parent_todo_id: parentId,
    parent_status: 'superseded_by_children',
    generated_child_ids: [childOneId, childTwoId]
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-completions/incorrect-child-one.json', {
    selected_todo_id: childOneId,
    reason: 'source_parent_completed',
    source_todo_id: parentId
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');

  assert.match(todo, new RegExp(`${childOneId}:`, 'u'));
  assert.match(todo, new RegExp(`${childTwoId}:`, 'u'));
  assert.equal(
    result.repair.non_live_todo_residue.reason,
    'no_non_live_todo_residue_detected',
    JSON.stringify(result, null, 2)
  );
});

test('preserves implementable child TODOs whose completed source is a stalled replan', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const replanTodo = `- [x] E-22e-replan-stalled-leaf-16e2c69e67bb: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to replan stalled Brownie TODO leaf into implementable child TODOs:
  Route: todo-decomposition.
  Source TODO: E-22e-release-contract-trace-binding-guard.
  Depends on: <none>.
  Completion condition: stalled source is superseded by implementable leaves.
  Forbidden changes: do not implement the release-evidence fix here.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
  const childOne = `- [ ] E-22e-guard-release-contract-impl-1: Patch only \`scripts/guard-release-contract.mjs\`:
  Route: implementation.
  Source TODO: E-22e-replan-stalled-leaf-16e2c69e67bb.
  Depends on: <none>.
  Completion condition: guard validates release evidence binding.
  Forbidden changes: do not weaken guards/tests.
  Verification: run \`pnpm --workspace-root guard:release-contract:test\`.`;
  const childTwo = `- [ ] E-22e-guard-release-contract-impl-2: Patch only \`scripts/guard-release-contract.test.mjs\`:
  Route: implementation.
  Source TODO: E-22e-replan-stalled-leaf-16e2c69e67bb.
  Depends on: E-22e-guard-release-contract-impl-1.
  Completion condition: tests cover release evidence binding rejection.
  Forbidden changes: do not weaken guards/tests.
  Verification: run \`pnpm --workspace-root guard:release-contract:test\`.`;
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), `${replanTodo}\n\n${childOne}\n\n${childTwo}\n`);
  fs.writeFileSync(path.join(repo, '.brownie/todo-breakdown.md'), `# breakdown

## TODO-repair-E-22e-replan-stalled-leaf-16e2c69e67bb

Parent TODO: E-22e-release-contract-trace-binding-guard

Dependency graph:
- E-22e-replan-stalled-leaf-16e2c69e67bb: <none>
- E-22e-guard-release-contract-impl-1: <none>
- E-22e-guard-release-contract-impl-2: E-22e-guard-release-contract-impl-1

Verification ledger:
- E-22e-replan-stalled-leaf-16e2c69e67bb: run \`pnpm --workspace-root guard:todo-decomposition\`
- E-22e-guard-release-contract-impl-1: run \`pnpm --workspace-root guard:release-contract:test\`
- E-22e-guard-release-contract-impl-2: run \`pnpm --workspace-root guard:release-contract:test\`

Quality rubric:
- E-22e-replan-stalled-leaf-16e2c69e67bb: replan broad leaf into bounded children.
- E-22e-guard-release-contract-impl-1: bounded implementation child.
- E-22e-guard-release-contract-impl-2: bounded test child.
`);
  execFileSync('git', ['add', '.brownie/todo.md', '.brownie/todo-breakdown.md'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'completed replan children fixture'], { cwd: repo, stdio: 'ignore' });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'blocked',
    run_id: 'claim-failed',
    consecutive_failures: 5,
    detail: 'Failed to claim first pending TODO from queue: .brownie/todo.md'
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');

  assert.match(todo, /E-22e-guard-release-contract-impl-1/u);
  assert.match(todo, /E-22e-guard-release-contract-impl-2/u);
  assert.equal(
    result.repair.non_live_todo_residue.reason,
    'no_non_live_todo_residue_detected',
    JSON.stringify(result, null, 2)
  );
});

test('archives terminal no_eligible active claim so the same live TODO can be claimed fresh', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-terminal-no-eligible',
    consecutive_failures: 0,
    detail: 'Brownie run exited successfully but repeated the same non-progress fingerprint'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 1,
    run_stamp: '20261005T180844Z',
    workspace_changed: false,
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      stop_reason: 'terminal_task_failed',
      claim_id: 'claim-terminal-no-eligible',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-terminal-no-eligible',
    status: 'in_progress',
    selected_todo: runtimeEvidenceTodo
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const claimPath = path.join(repo, '.brownie/private/phase-loop/todo-claims/current.json');
  const archivedClaims = fs.readdirSync(path.join(repo, '.brownie/private/phase-loop/todo-claims'))
    .filter((name) => name.startsWith('terminal-no-eligible-current-'));

  assert.equal(result.repair.terminal_no_eligible_claim.attempted, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.terminal_no_eligible_claim.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.terminal_no_eligible_claim.archived_claim_id, 'claim-terminal-no-eligible');
  assert.equal(fs.existsSync(claimPath), false);
  assert.equal(archivedClaims.length, 1);
  assert.equal(result.repair.todo_contract_replan.attempted, false, JSON.stringify(result, null, 2));
});

test('fails closed when active claim disappears during terminal cleanup', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress', run_id: 'run-terminal-no-eligible-enoent'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress', same_progress_count: 1, workspace_changed: false,
    progress_projection: {
      cli_status: 'no_eligible_task', closure: 'no_eligible_task',
      stop_reason: 'terminal_task_failed', selected_todo: runtimeEvidenceTodo
    }
  });
  const claimRelativePath = '.brownie/private/phase-loop/todo-claims/current.json';
  const claimPath = path.join(repo, claimRelativePath);
  writeJson(repo, claimRelativePath, {
    claim_id: 'claim-terminal-no-eligible-enoent', status: 'in_progress', selected_todo: runtimeEvidenceTodo
  });
  const originalRmSync = fs.rmSync;
  fs.rmSync = function guardedRemove(file, ...args) {
    if (String(file) === claimPath) {
      const error = new Error('simulated claim cleanup race');
      error.code = 'ENOENT';
      throw error;
    }
    return originalRmSync.call(this, file, ...args);
  };
  try {
    const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: true });
    assert.equal(result.repair.terminal_no_eligible_claim.ok, false, JSON.stringify(result, null, 2));
    assert.equal(result.repair.terminal_no_eligible_claim.reason, 'active_claim_disappeared_during_cleanup');
    assert.equal(result.start.attempted, false, JSON.stringify(result, null, 2));
    assert.equal(fs.existsSync(claimPath), true);
  } finally {
    fs.rmSync = originalRmSync;
  }
});

test('does not restart a terminal no_eligible claim when the workspace is dirty', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, 'unexpected-user-edit.txt'), 'preserve me\n');
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-terminal-no-eligible-dirty',
    consecutive_failures: 0
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 1,
    workspace_changed: false,
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      stop_reason: 'terminal_task_failed',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-terminal-no-eligible-dirty',
    status: 'in_progress',
    selected_todo: runtimeEvidenceTodo,
    baseline_diff_files: ['.brownie/todo.md']
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: true });

  assert.equal(result.repair.terminal_no_eligible_claim.attempted, false, JSON.stringify(result, null, 2));
  assert.equal(result.repair.terminal_no_eligible_claim.reason, 'workspace_changed_or_dirty_not_archiving_claim');
  assert.match(result.repair.terminal_no_eligible_claim.dirty_files.join('\n'), /unexpected-user-edit\.txt/u);
  assert.equal(fs.existsSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/current.json')), true);
  assert.equal(result.start.attempted, false, JSON.stringify(result, null, 2));
  assert.equal(result.start.reason, 'terminal_no_eligible_claim_requires_verified_baseline');
});

test('does not let historical Brownie artifacts block recovery when no active claim remains', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, '.brownie', 'historical-run.json'), '{"preserve":true}\n');
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-terminal-no-eligible-no-claim',
    consecutive_failures: 0
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 1,
    workspace_changed: false,
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      stop_reason: 'terminal_task_failed',
      selected_todo: runtimeEvidenceTodo
    }
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });

  assert.equal(result.repair.terminal_no_eligible_claim.attempted, false, JSON.stringify(result, null, 2));
  assert.equal(result.repair.terminal_no_eligible_claim.reason, 'no_active_claim');
  assert.notEqual(result.start.reason, 'terminal_no_eligible_claim_requires_verified_baseline');
  assert.equal(fs.existsSync(path.join(repo, '.brownie', 'historical-run.json')), true);
});

test('fails closed when an active terminal claim is unreadable', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/current.json'), '{not-json\n');
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress', run_id: 'run-terminal-no-eligible-invalid-claim'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress', workspace_changed: false,
    progress_projection: {
      cli_status: 'no_eligible_task', closure: 'no_eligible_task',
      stop_reason: 'terminal_task_failed', selected_todo: runtimeEvidenceTodo
    }
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: true });

  assert.equal(result.repair.terminal_no_eligible_claim.reason, 'active_claim_unreadable_or_invalid');
  assert.equal(result.start.reason, 'terminal_no_eligible_claim_requires_verified_baseline');
  assert.equal(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/current.json'), 'utf8'), '{not-json\n');
});

test('does not let repeated no-progress replan around an unreadable active claim', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const todoPath = path.join(repo, '.brownie/todo.md');
  const todoBefore = fs.readFileSync(todoPath, 'utf8');
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/current.json'), '{not-json\n');
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress', run_id: 'run-terminal-replan-invalid-claim'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress', workspace_changed: false,
    progress_projection: {
      cli_status: 'no_eligible_task', closure: 'no_eligible_task',
      stop_reason: 'terminal_task_failed', selected_todo: runtimeEvidenceTodo
    }
  });

  let result;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    result = controlPhaseLoop({ repoRoot: repo, write: true, repair: true, start: true });
  }

  assert.equal(result.repair.terminal_no_eligible_claim.reason, 'active_claim_unreadable_or_invalid');
  assert.notEqual(result.repair.todo_contract_replan.reason, 'todo_contract_replan_takes_precedence');
  assert.equal(result.start.reason, 'terminal_no_eligible_claim_requires_verified_baseline');
  assert.equal(fs.readFileSync(todoPath, 'utf8'), todoBefore);
  assert.equal(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/current.json'), 'utf8'), '{not-json\n');
});

test('archives a legacy terminal claim only when its saved TODO snapshot matches', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.appendFileSync(path.join(repo, '.brownie/todo.md'), '\nlegacy managed state\n');
  const baselineTodoText = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', { status: 'no_progress', run_id: 'legacy-run' });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress', workspace_changed: false,
    progress_projection: { cli_status: 'no_eligible_task', closure: 'no_eligible_task', stop_reason: 'terminal_task_failed', selected_todo: runtimeEvidenceTodo }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'legacy-claim', status: 'in_progress', selected_todo: runtimeEvidenceTodo,
    baseline_diff_files: ['.brownie/todo.md'], baseline_todo_text: baselineTodoText
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  assert.equal(result.repair.terminal_no_eligible_claim.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.terminal_no_eligible_claim.legacy_baseline_rebased, true);
  assert.equal(fs.existsSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/current.json')), false);
});

test('does not rebaseline a legacy terminal claim when its TODO snapshot changed', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const baselineTodoText = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');
  fs.appendFileSync(path.join(repo, '.brownie/todo.md'), '\nchanged after legacy claim\n');
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', { status: 'no_progress', run_id: 'legacy-changed-run' });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress', workspace_changed: false,
    progress_projection: { cli_status: 'no_eligible_task', closure: 'no_eligible_task', stop_reason: 'terminal_task_failed', selected_todo: runtimeEvidenceTodo }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'legacy-changed-claim', status: 'in_progress', selected_todo: runtimeEvidenceTodo,
    baseline_diff_files: ['.brownie/todo.md'], baseline_todo_text: baselineTodoText
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: true });
  assert.equal(result.repair.terminal_no_eligible_claim.attempted, false, JSON.stringify(result, null, 2));
  assert.equal(result.start.reason, 'terminal_no_eligible_claim_requires_verified_baseline');
});

test('archives an auditable two-file legacy baseline only when the TODO snapshot matches', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.appendFileSync(path.join(repo, '.brownie/todo.md'), '\nlegacy managed todo state\n');
  fs.appendFileSync(path.join(repo, '.brownie/todo-breakdown.md'), '\nlegacy managed breakdown state\n');
  const baselineTodoText = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', { status: 'no_progress', run_id: 'legacy-two-file-run' });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress', workspace_changed: false,
    progress_projection: { cli_status: 'no_eligible_task', closure: 'no_eligible_task', stop_reason: 'terminal_task_failed', selected_todo: runtimeEvidenceTodo }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'legacy-two-file-claim', status: 'in_progress', selected_todo: runtimeEvidenceTodo,
    baseline_diff_files: ['.brownie/todo.md', '.brownie/todo-breakdown.md'], baseline_todo_text: baselineTodoText
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const archiveName = fs.readdirSync(path.join(repo, '.brownie/private/phase-loop/todo-claims'))
    .find((name) => name.startsWith('terminal-no-eligible-current-'));
  assert.equal(result.repair.terminal_no_eligible_claim.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.terminal_no_eligible_claim.legacy_baseline_audited_rebaseline, true);
  const archived = JSON.parse(fs.readFileSync(
    path.join(repo, '.brownie/private/phase-loop/todo-claims', archiveName),
    'utf8'
  ));

  assert.equal(archived.legacy_rebaseline_snapshot.todo_text, baselineTodoText);
  assert.match(archived.legacy_rebaseline_snapshot.breakdown_text, /legacy managed breakdown state/u);
});

test('fails closed without throwing when an auditable legacy baseline file is unreadable', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.appendFileSync(path.join(repo, '.brownie/todo.md'), '\nlegacy managed todo state\n');
  const baselineTodoText = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');
  fs.rmSync(path.join(repo, '.brownie/todo-breakdown.md'));
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', { status: 'no_progress', run_id: 'legacy-missing-breakdown-run' });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress', workspace_changed: false,
    progress_projection: { cli_status: 'no_eligible_task', closure: 'no_eligible_task', stop_reason: 'terminal_task_failed', selected_todo: runtimeEvidenceTodo }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'legacy-missing-breakdown-claim', status: 'in_progress', selected_todo: runtimeEvidenceTodo,
    baseline_diff_files: ['.brownie/todo.md', '.brownie/todo-breakdown.md'], baseline_todo_text: baselineTodoText
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  assert.equal(result.repair.terminal_no_eligible_claim.attempted, false, JSON.stringify(result, null, 2));
  assert.equal(result.repair.terminal_no_eligible_claim.reason, 'workspace_changed_or_dirty_not_archiving_claim');
  assert.equal(fs.existsSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/current.json')), true);
});

test('does not restart phase-loop when only owner blockers remain but dirty delivery is required', () => {
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo, '.brownie'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), `${ownerBlockerTodo}\n`);
  fs.writeFileSync(path.join(repo, '.brownie/todo-breakdown.md'), `# breakdown

Parent TODO: E-20i-runtime-release-ops-blocker

Dependency graph:
- E-20i-runtime-release-ops-blocker: <none>

Verification ledger:
- E-20i-runtime-release-ops-blocker: inspect/blocker/fail-closed

Quality rubric:
- E-20i-runtime-release-ops-blocker: explicit owner blocker
`);
  execFileSync('git', ['add', '.brownie/todo.md', '.brownie/todo-breakdown.md'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'owner blocker fixture'], { cwd: repo, stdio: 'ignore' });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'blocked',
    run_id: 'owner-blockers-only-test',
    consecutive_failures: 0,
    detail: 'No implementable TODO remains; pending queue contains only explicit owner-controlled blocker TODOs. Phase-loop is stopped until owner/review evidence changes.'
  });
  fs.writeFileSync(path.join(repo, 'README.md'), 'dirty delivery work\n');

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: true });

  assert.equal(result.initial_summary.next_action, 'prepare_delivery_commit_pr', JSON.stringify(result, null, 2));
  assert.equal(result.start.attempted, false, JSON.stringify(result, null, 2));
  assert.equal(result.start.reason, 'delivery_required_not_starting', JSON.stringify(result, null, 2));
  assert(result.final_issues.some((issue) => issue.code === 'delivery_required'), JSON.stringify(result, null, 2));
});

test('escalates invalid patch with repeated no-progress to TODO contract replan feedback without historical ledger', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-invalid-patch',
    consecutive_failures: 1,
    detail: 'Brownie run exited successfully but repeated the same non-progress fingerprint'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 2,
    run_stamp: '20261003T171000Z',
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      claim_id: 'claim-invalid-patch',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-invalid-patch',
    status: 'claimed',
    selected_todo: runtimeEvidenceTodo
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json', {
    schema_version: 1,
    kind: 'phase_loop_invalid_patch_repair_feedback',
    reason: 'supervisor_invalid_workspace_write_patch',
    invalid_patch: {
      detected: true,
      claim_id: 'claim-invalid-patch',
      reason: 'runtime_terminal_failure',
      selected_todo: {
        first_line: runtimeEvidenceTodo.split('\n')[0],
        route: 'implementation',
        patch_targets: ['scripts/guard-runtime-operational-evidence.test.mjs'],
        verification_commands: ['pnpm --workspace-root release:runtime-operational-evidence:test']
      },
      invalid_patch_proposals: [
        {
          path: 'scripts/guard-runtime-operational-evidence.test.mjs',
          operation: 'patch_file',
          validation_reason: 'Patch target is outside the selected bounded target.',
          content_preview: '[patch_file single_hunk old_chars=478 new_chars=1406]',
          hunk_count: 1
        }
      ]
    }
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const feedback = JSON.parse(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json'), 'utf8'));
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');

  assert.equal(result.repair.todo_contract_replan.attempted, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.todo_contract_replan.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_blocked.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_decomposition.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.post_repair_validation.ok, true, JSON.stringify(result, null, 2));
  assert.deepEqual(result.repair.post_repair_validation.failed_steps, []);
  assert.match(todo, /E-21c-replan-stalled-leaf-/u);
  assert.equal(feedback.kind, 'phase_loop_todo_contract_replan_feedback');
  assert.equal(feedback.failure_ledger_summary.replan_reason, 'invalid_patch_with_repeated_no_progress');
  assert.equal(result.repair.invalid_patch.reason, 'todo_contract_replan_feedback_takes_precedence');
});

test('does not replan repairable subtoken old_text invalid patches before exact-context repair', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-subtoken-invalid-patch',
    consecutive_failures: 1,
    detail: 'Brownie run exited successfully but repeated the same non-progress fingerprint'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 2,
    run_stamp: '20261005T105314Z',
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      claim_id: 'claim-subtoken-invalid-patch',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-subtoken-invalid-patch',
    status: 'claimed',
    selected_todo: runtimeEvidenceTodo
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json', {
    schema_version: 1,
    kind: 'phase_loop_invalid_patch_repair_feedback',
    reason: 'supervisor_invalid_workspace_write_patch',
    invalid_patch: {
      detected: true,
      claim_id: 'claim-subtoken-invalid-patch',
      reason: 'runtime_terminal_failure',
      selected_todo: {
        first_line: runtimeEvidenceTodo.split('\n')[0],
        route: 'implementation',
        patch_targets: ['scripts/guard-runtime-operational-evidence.test.mjs'],
        verification_commands: ['pnpm --workspace-root release:runtime-operational-evidence:test']
      },
      invalid_patch_proposals: [
        {
          path: 'scripts/guard-runtime-operational-evidence.test.mjs',
          operation: 'patch_file',
          validation_reason: 'Patch old_text matches inside a word; include the full line or surrounding context.',
          content_preview: '[patch_file single_hunk old_chars=24 new_chars=80]',
          hunk_count: 1
        }
      ]
    }
  });
  fs.writeFileSync(
    path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl'),
    `${JSON.stringify({
      schema_version: 1,
      record_type: 'phase_loop_failure_event',
      event_id: 'event-invalid-patch-subtoken',
      observed_at: '2026-10-05T10:36:48Z',
      todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02',
      selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0],
      kind: 'invalid_patch',
      status: 'no_progress',
      progress_run_stamp: '20261005T103238Z',
      same_progress_count: 1
    })}\n`
  );

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const feedback = JSON.parse(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json'), 'utf8'));
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');

  assert.equal(result.repair.todo_contract_replan.attempted, false, JSON.stringify(result, null, 2));
  assert.equal(result.repair.todo_contract_replan.reason, 'threshold_not_met', JSON.stringify(result, null, 2));
  assert.equal(result.repair.invalid_patch.attempted, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.invalid_patch.ok, true, JSON.stringify(result, null, 2));
  assert.equal(feedback.kind, 'phase_loop_invalid_patch_repair_feedback');
  assert.equal(feedback.semantic_repair_policy.must_not_use_subtoken_old_text, true);
  assert.match(feedback.repair_hint, /complete current line or a syntactic block/u);
  assert.doesNotMatch(todo, /replan-stalled-leaf/u);
});

test('classifies the final invalid patch proposal when deciding exact-context repairability', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-mixed-invalid-patch',
    consecutive_failures: 1,
    detail: 'Brownie run exited successfully but repeated the same non-progress fingerprint'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 2,
    run_stamp: '20261005T111500Z',
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      claim_id: 'claim-mixed-invalid-patch',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-mixed-invalid-patch',
    status: 'claimed',
    selected_todo: runtimeEvidenceTodo
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json', {
    schema_version: 1,
    kind: 'phase_loop_invalid_patch_repair_feedback',
    reason: 'supervisor_invalid_workspace_write_patch',
    invalid_patch: {
      detected: true,
      claim_id: 'claim-mixed-invalid-patch',
      reason: 'runtime_terminal_failure',
      selected_todo: {
        first_line: runtimeEvidenceTodo.split('\n')[0],
        route: 'implementation',
        patch_targets: ['scripts/guard-runtime-operational-evidence.test.mjs'],
        verification_commands: ['pnpm --workspace-root release:runtime-operational-evidence:test']
      },
      invalid_patch_proposals: [
        {
          path: 'scripts/guard-runtime-operational-evidence.test.mjs',
          operation: 'patch_file',
          validation_reason: 'Patch old_text matches inside a word; include the full line or surrounding context.',
          content_preview: '[patch_file single_hunk old_chars=24 new_chars=80]',
          hunk_count: 1
        },
        {
          path: 'scripts/guard-runtime-operational-evidence.test.mjs',
          operation: 'patch_file',
          validation_reason: 'Patch target is outside the selected bounded target.',
          content_preview: '[patch_file single_hunk old_chars=478 new_chars=1406]',
          hunk_count: 1
        }
      ]
    }
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const feedback = JSON.parse(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json'), 'utf8'));

  assert.equal(result.repair.todo_contract_replan.attempted, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.todo_contract_replan.ok, true, JSON.stringify(result, null, 2));
  assert.equal(feedback.kind, 'phase_loop_todo_contract_replan_feedback');
  assert.equal(feedback.failure_ledger_summary.repairable_invalid_patch, false);
  assert.equal(feedback.failure_ledger_summary.replan_reason, 'invalid_patch_with_repeated_no_progress');
});

test('escalates invalid patch followed by no-progress on the same leaf to TODO contract replan feedback', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-after-invalid-patch',
    consecutive_failures: 1,
    detail: 'Brownie run exited successfully but repeated the same non-progress fingerprint'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 1,
    run_stamp: '20261003T171500Z',
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      claim_id: 'claim-after-invalid-patch',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-after-invalid-patch',
    status: 'claimed',
    selected_todo: runtimeEvidenceTodo
  });
  fs.writeFileSync(
    path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl'),
    `${JSON.stringify({
      schema_version: 1,
      record_type: 'phase_loop_failure_event',
      event_id: 'event-invalid-patch-prior',
      observed_at: '2026-10-03T17:10:00Z',
      todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02',
      selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0],
      kind: 'invalid_patch',
      status: 'no_progress',
      progress_run_stamp: '20261003T171000Z',
      same_progress_count: 2
    })}\n`
  );

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const feedback = JSON.parse(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json'), 'utf8'));
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');

  assert.equal(result.repair.todo_contract_replan.attempted, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.todo_contract_replan.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_blocked.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.stalled_todo_decomposition.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.post_repair_validation.ok, true, JSON.stringify(result, null, 2));
  assert.deepEqual(result.repair.post_repair_validation.failed_steps, []);
  assert.match(todo, /E-21c-replan-stalled-leaf-/u);
  assert.equal(feedback.kind, 'phase_loop_todo_contract_replan_feedback');
  assert.equal(feedback.failure_ledger_summary.replan_reason, 'invalid_patch_followed_by_no_progress');
});

test('does not recreate a replan for a completed leaf retained only in failure history', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const todoPath = path.join(repo, '.brownie/todo.md');
  fs.writeFileSync(todoPath, fs.readFileSync(todoPath, 'utf8').replace('- [ ] E-21c-runtime-operational-evidence-impl-2-target-02:', '- [x] E-21c-runtime-operational-evidence-impl-2-target-02:'));
  fs.mkdirSync(path.join(repo, '.brownie/private/phase-loop/todo-completions'), { recursive: true });
  writeJson(repo, '.brownie/private/phase-loop/todo-completions/completed-target.json', {
    selected_todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02'
  });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-completed-leaf-history',
    consecutive_failures: 1,
    detail: 'Brownie run exited successfully but repeated the same non-progress fingerprint'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 1,
    run_stamp: '20261003T171500Z',
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      claim_id: 'claim-completed-leaf-history',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-completed-leaf-history',
    status: 'claimed',
    selected_todo: runtimeEvidenceTodo
  });
  fs.writeFileSync(
    path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl'),
    `${JSON.stringify({
      schema_version: 1,
      record_type: 'phase_loop_failure_event',
      event_id: 'event-completed-leaf-invalid-patch',
      observed_at: '2026-10-03T17:10:00Z',
      todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02',
      selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0],
      kind: 'invalid_patch',
      status: 'no_progress',
      progress_run_stamp: '20261003T171000Z',
      same_progress_count: 2
    })}\n`
  );
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json', {
    kind: 'phase_loop_semantic_verification_repair_feedback',
    completed: false,
    selected_todo: runtimeEvidenceTodo,
    selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0],
    verification_failure: {
      selected_todo: { first_line: runtimeEvidenceTodo.split('\n')[0] },
      failed_commands: ['pnpm --workspace-root release:runtime-operational-evidence:test']
    }
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });

  assert.equal(result.repair.todo_contract_replan.attempted, false, JSON.stringify(result, null, 2));
  assert.equal(result.repair.todo_contract_replan.reason, 'selected_todo_not_live_after_durable_completion');
  assert.equal(result.repair.semantic_verification.reason, 'completed_leaf_failure_suppressed');
  assert.equal(result.repair.invalid_patch.reason, 'completed_leaf_failure_suppressed');
  assert.equal(result.repair.completed_leaf_recovery.completed, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.completed_leaf_feedback_resolution.ok, true, JSON.stringify(result, null, 2));
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json'), 'utf8')).completed,
    true
  );
  assert.equal(fs.existsSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/blocked.jsonl')), false);
});

test('fails closed when a selected leaf disappears without durable completion evidence', () => {
  const repo = makeRepo();
  writeTodo(repo);
  const todoPath = path.join(repo, '.brownie/todo.md');
  fs.writeFileSync(todoPath, fs.readFileSync(todoPath, 'utf8').replace('- [ ] E-21c-runtime-operational-evidence-impl-2-target-02:', '- [x] E-21c-runtime-operational-evidence-impl-2-target-02:'));
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress', run_id: 'run-missing-leaf-without-receipt', consecutive_failures: 1
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress', same_progress_count: 1,
    progress_projection: { cli_status: 'no_eligible_task', closure: 'no_eligible_task', selected_todo: runtimeEvidenceTodo }
  });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl'), `${JSON.stringify({
    schema_version: 1, record_type: 'phase_loop_failure_event', event_id: 'missing-leaf-history',
    observed_at: '2026-10-03T17:10:00Z', todo_id: 'E-21c-runtime-operational-evidence-impl-2-target-02',
    selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0], kind: 'invalid_patch', status: 'no_progress',
    progress_run_stamp: '20261003T171000Z', same_progress_count: 2
  })}\n`);

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: true });

  assert.equal(result.repair.todo_contract_replan.ok, false, JSON.stringify(result, null, 2));
  assert.equal(result.repair.todo_contract_replan.reason, 'selected_todo_not_live_without_durable_completion');
  assert.equal(result.start.attempted, false, JSON.stringify(result, null, 2));
  assert.equal(result.start.reason, 'todo_contract_replan_failed_not_starting');
});

test('re-delegates retained selected-target integrity failures without accepting operational artifacts as progress', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/phase-loop.pid'), `${process.pid}\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', { status: 'no_progress', run_id: 'selected-target-only-artifacts' });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress', workspace_changed: true,
    progress_projection: { selected_todo: runtimeEvidenceTodo }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'selected-target-only-artifacts', status: 'in_progress', selected_todo: runtimeEvidenceTodo
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json', {
    claim_id: 'selected-target-only-artifacts', completed: false, reason: 'verification_output_unparseable', selected_todo_first_line: runtimeEvidenceTodo.split('\n')[0],
    verification: { completed: false, raw_tail: 'selected_target_not_changed' }
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const feedback = JSON.parse(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json'), 'utf8'));

  assert.equal(result.repair.selected_target_redelegation.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.todo_contract_replan.reason, 'selected_target_redelegation_takes_precedence');
  assert.equal(result.repair.semantic_verification.reason, 'selected_target_redelegation_takes_precedence');
  assert.equal(feedback.kind, 'phase_loop_selected_target_redelegation_feedback');
  assert.match(feedback.repair_hint, /Operational artifacts/u);
});

test('does not reuse retained selected-target evidence from a different active claim', () => {
  const repo = makeRepo();
  writeTodo(repo);
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-b', status: 'in_progress', selected_todo: runtimeEvidenceTodo
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json', {
    claim_id: 'claim-a', completed: false, reason: 'verification_output_unparseable',
    selected_todo_first_line: '- [ ] unrelated: Patch only `scripts/unrelated.mjs`.',
    verification: { completed: false, raw_tail: 'selected_target_not_changed' }
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });

  assert.equal(result.repair.selected_target_redelegation.attempted, false, JSON.stringify(result, null, 2));
  assert.equal(result.repair.selected_target_redelegation.reason, 'selected_target_not_changed_not_reported');
});

test('runs TODO guard after repair when diagnostic reports an existing TODO contract violation', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.appendFileSync(path.join(repo, '.brownie/todo.md'), `

- [ ] E-21c-replan-stalled-leaf-001: Patch \`.brownie/todo.md\` to replan a stalled leaf:
  Route: todo-decomposition.
  Source TODO: E-21c-replan-stalled-leaf-parent.
  Depends on: <none>.
  Completion condition: Patch \`.brownie/todo.md\` only.
  Forbidden changes: do not implement release evidence.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.
`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-contract-invalid',
    consecutive_failures: 3,
    detail: 'Brownie run exited successfully but repeated the same non-progress fingerprint'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 2,
    run_stamp: '20261003T204237Z',
    progress_projection: {
      cli_status: 'no_eligible_task',
      closure: 'no_eligible_task',
      claim_id: 'claim-contract-invalid',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-contract-invalid',
    status: 'claimed',
    selected_todo: runtimeEvidenceTodo
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: true });

  assert.equal(result.repair.post_repair_validation.attempted, true, JSON.stringify(result, null, 2));
  assert.equal(result.repair.post_repair_validation.ok, false, JSON.stringify(result, null, 2));
  assert.match(result.repair.post_repair_validation.failed_steps.join(','), /guard-todo-decomposition/u);
  assert.equal(result.start.attempted, false, JSON.stringify(result, null, 2));
  assert.equal(result.start.reason, 'post_repair_validation_failed');
});

test('workspace supervisor-control script restarts after safe repair by default', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

  assert.equal(
    packageJson.scripts['phase-loop:supervisor-control'],
    'node scripts/phase-loop-supervisor-control.mjs --repair --start'
  );
});

test('repairs only guard-reported derived child ledger entries for a recorded stalled replan', () => {
  const repo = makeRepo();
  const parentId = `E-21c-replan-stalled-leaf-${'e'.repeat(12)}`;
  const childId = `${parentId}-leaf-01`;
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), `- [ ] ${childId}: Patch only \`scripts/guard-runtime-operational-evidence.test.mjs\`:\n  Route: implementation.\n  Source TODO: ${parentId}.\n  Depends on: <none>.\n  Completion condition: child ledger entry is restored with executable verification and dependency metadata.\n  Forbidden changes: do not weaken guards/tests.\n  Verification: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`.\n`);
  fs.writeFileSync(path.join(repo, '.brownie/todo-breakdown.md'), `# Breakdown\n\n## TODO-repair-${parentId}\n\nParent TODO: E-21c-runtime-operational-evidence-impl-2-target-02\n\nDependency graph:\n- ${parentId}: <none>\n\nVerification ledger:\n- ${parentId}: run \`pnpm --workspace-root guard:todo-decomposition\`\n\nQuality rubric:\n- ${parentId}: recorded replan\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', { status: 'no_progress', run_id: 'missing-ledger', consecutive_failures: 0, detail: 'guard failed' });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', { classification: 'no_progress', same_progress_count: 1, progress_projection: { selected_todo: runtimeEvidenceTodo } });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const breakdown = fs.readFileSync(path.join(repo, '.brownie/todo-breakdown.md'), 'utf8');
  const records = readTrackedBreakdownReplanRecords(repo);

  assert.equal(result.repair.missing_derived_breakdown_ledger.ok, true, JSON.stringify(result, null, 2));
  assert.match(breakdown, new RegExp(`TODO-repair-${parentId}[\\s\\S]*- ${childId}:`, 'u'));
  assert.doesNotMatch(breakdown, new RegExp(`TODO-repair-${childId}`, 'u'));
  assert.deepEqual(records.find((record) => record.parent_todo_id === parentId)?.generated_child_ids, [childId]);
  assert.equal(result.repair.post_repair_validation.ok, true, JSON.stringify(result, null, 2));
});

test('migrates legacy child-only derived ledgers into the recorded parent replan', () => {
  const repo = makeRepo();
  const parentId = `E-21c-replan-stalled-leaf-${'f'.repeat(12)}`;
  const childId = `${parentId}-leaf-01`;
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), `- [ ] ${childId}: Patch only \`scripts/guard-runtime-operational-evidence.test.mjs\`:\n  Route: implementation.\n  Source TODO: ${parentId}.\n  Depends on: <none>.\n  Completion condition: child ledger migration preserves executable verification and dependency metadata.\n  Forbidden changes: do not weaken guards/tests.\n  Verification: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`.\n`);
  fs.writeFileSync(path.join(repo, '.brownie/todo-breakdown.md'), `# Breakdown\n\n## TODO-repair-${parentId}\n\nParent TODO: E-21c-runtime-operational-evidence-impl-2-target-02\n\nDependency graph:\n- ${parentId}: <none>\n\nVerification ledger:\n- ${parentId}: run \`pnpm --workspace-root guard:todo-decomposition\`\n\nQuality rubric:\n- ${parentId}: recorded replan\n\n## TODO-repair-${childId}\n\nParent TODO: ${parentId}\n\nDependency graph:\n- ${childId}: <none>\n\nVerification ledger:\n- ${childId}: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`\n\nQuality rubric:\n- ${childId}: bounded derived leaf remains traceable to its recorded stalled replan.\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', { status: 'no_progress', run_id: 'legacy-ledger', consecutive_failures: 0, detail: 'recovery required' });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', { classification: 'no_progress', same_progress_count: 1, progress_projection: { selected_todo: runtimeEvidenceTodo } });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const breakdown = fs.readFileSync(path.join(repo, '.brownie/todo-breakdown.md'), 'utf8');
  const records = readTrackedBreakdownReplanRecords(repo);

  assert.equal(result.repair.legacy_derived_breakdown_ledger_migration.ok, true, JSON.stringify(result, null, 2));
  assert.match(breakdown, new RegExp(`TODO-repair-${parentId}[\\s\\S]*- ${childId}:`, 'u'));
  assert.doesNotMatch(breakdown, new RegExp(`TODO-repair-${childId}`, 'u'));
  assert.deepEqual(records.find((record) => record.parent_todo_id === parentId)?.generated_child_ids, [childId]);
  assert.match(result.repair.legacy_derived_breakdown_ledger_migration.archive_path, /recovery-archives\//u);
  assert.equal(result.repair.post_repair_validation.ok, true, JSON.stringify(result, null, 2));
});

test('fails closed when a legacy child-only ledger lacks a required tracked field', () => {
  const repo = makeRepo();
  const parentId = `E-21c-replan-stalled-leaf-${'a'.repeat(12)}`;
  const childId = `${parentId}-leaf-01`;
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), `- [ ] ${childId}: Patch only \`scripts/guard-runtime-operational-evidence.test.mjs\`:\n  Route: implementation.\n  Source TODO: ${parentId}.\n  Depends on: <none>.\n  Completion condition: child ledger migration preserves executable verification and dependency metadata.\n  Forbidden changes: do not weaken guards/tests.\n  Verification: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`.\n`);
  fs.writeFileSync(path.join(repo, '.brownie/todo-breakdown.md'), `# Breakdown\n\n## TODO-repair-${parentId}\n\nParent TODO: E-21c-runtime-operational-evidence-impl-2-target-02\n\nDependency graph:\n- ${parentId}: <none>\n\nVerification ledger:\n- ${parentId}: run \`pnpm --workspace-root guard:todo-decomposition\`\n\nQuality rubric:\n- ${parentId}: recorded replan\n\n## TODO-repair-${childId}\n\nParent TODO: ${parentId}\n\nDependency graph:\n- ${childId}: <none>\n\nVerification ledger:\n- ${childId}: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`\n\nQuality rubric:\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', { status: 'no_progress', run_id: 'malformed-legacy-ledger', consecutive_failures: 0, detail: 'recovery required' });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', { classification: 'no_progress', same_progress_count: 1, progress_projection: { selected_todo: runtimeEvidenceTodo } });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const breakdown = fs.readFileSync(path.join(repo, '.brownie/todo-breakdown.md'), 'utf8');

  assert.equal(result.repair.legacy_derived_breakdown_ledger_migration.ok, false, JSON.stringify(result, null, 2));
  assert.equal(result.repair.legacy_derived_breakdown_ledger_migration.reason, 'legacy_derived_ledger_not_migratable');
  assert.match(breakdown, new RegExp(`TODO-repair-${childId}`, 'u'));
  assert.doesNotMatch(breakdown, /undefined/u);
});

test('repairs generated TODO leaf prefix and breakdown ledger after decomposition guard rejection', () => {
  const repo = makeRepo();
  writeTodo(repo);
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), `# Brownie TODO Queue

## Product Ready Blocking Queue

### P0/P1: Release engineering and evidence

- [ ] E-15e-todo-decomp-leaf-001: Patch only \`.brownie/todo.md\` to add release-evidence TODO for runtime-release-readiness-audit.json:
  Route: todo-decomposition.
  Source TODO: E-21c-replan-stalled-leaf-c0830caaef87.
  Depends on: <none>.
  Completion condition: Add unchecked TODO item for creating or updating \`docs/architecture/runtime-release-readiness-audit.json\` with concrete evidence entries.
  Forbidden changes: do not invent evidence values, do not declare Runtime Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.
- [ ] E-15e-todo-decomp-leaf-002: Patch only \`.brownie/todo.md\` to add release-evidence TODO for release-gate.mjs verification:
  Route: todo-decomposition.
  Source TODO: E-21c-replan-stalled-leaf-c0830caaef87.
  Depends on: E-15e-todo-decomp-leaf-001.
  Completion condition: Add unchecked TODO item for updating \`scripts/release-gate.mjs\` to validate runtime-release-readiness-audit.json.
  Forbidden changes: do not weaken guards/tests, do not invent evidence values.
  Verification: run \`pnpm --workspace-root phase-loop:todo-queue-integrity\`.
`);
  fs.writeFileSync(path.join(repo, '.brownie/todo-breakdown.md'), '# Breakdown\n');
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'run-prefix-repair',
    consecutive_failures: 3,
    detail: 'TODO decomposition guard failed after TODO apply'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'progress',
    same_progress_count: 1,
    run_stamp: '20261003T210259Z',
    progress_projection: {
      cli_status: 'objective_proposal_applied',
      closure: 'routed_explicit_action',
      claim_id: 'claim-prefix-repair',
      selected_todo: runtimeEvidenceTodo
    }
  });
  writeJson(repo, '.brownie/private/phase-loop/todo-claims/current.json', {
    claim_id: 'claim-prefix-repair',
    status: 'claimed',
    selected_todo: runtimeEvidenceTodo
  });

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');
  const breakdown = fs.readFileSync(path.join(repo, '.brownie/todo-breakdown.md'), 'utf8');

  assert.equal(result.repair.derived_todo_prefix_ledger.ok, true, JSON.stringify(result, null, 2));
  assert.match(todo, /E-21c-todo-decomp-leaf-001/u);
  assert.match(todo, /Depends on: E-21c-todo-decomp-leaf-001/u);
  assert.doesNotMatch(todo, /E-15e-todo-decomp-leaf/u);
  assert.match(breakdown, /E-21c-todo-decomp-leaf-001/u);
  assert.match(result.repair.post_repair_validation.failed_steps.join(','), /phase-loop-todo-queue-integrity/u);
});
