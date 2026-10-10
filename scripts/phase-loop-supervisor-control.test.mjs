import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { controlPhaseLoop } from './phase-loop-supervisor-control.mjs';

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

test('archives only resolved TODO-contract replan feedback after both current queue validations pass', () => {
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

  assert.equal(result.repair.resolved_repair_feedback_archive.ok, true, JSON.stringify(result, null, 2));
  assert.equal(feedback.completed, true);
  assert.equal(feedback.verification.completed, true);
  assert.equal(fs.readdirSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback-archive')).length, 1);
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

test('recovers a terminal generated replan to its bounded implementation source', () => {
  const repo = makeRepo();
  const sourceTodo = `- [ ] E-23a-release-artifact-portable-archive-leaf-01: Patch only \`scripts/release-local-artifact.mjs\` and \`scripts/release-local-artifact.test.mjs\` to create a portable archive:\n  Route: implementation.\n  Source TODO: E-23a-release-artifact-portable-archive.\n  Depends on: <none>.\n  Completion condition: the archive is deterministic.\n  Forbidden changes: do not publish a release.\n  Verification: run \`pnpm --workspace-root release:local-artifact:test\`.`;
  const replanId = `E-23a-replan-stalled-leaf-${'c'.repeat(12)}`;
  const replanTodo = `- [ ] ${replanId}: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to replan stalled Brownie TODO leaf into implementable child TODOs:\n  Route: todo-decomposition.\n  Source TODO: E-23a-release-artifact-portable-archive-leaf-01.\n  Depends on: <none>.\n  Completion condition: stalled TODO is superseded.\n  Forbidden changes: do not weaken guards/tests.\n  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
  fs.mkdirSync(path.join(repo, '.brownie'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), `${sourceTodo}\n\n${replanTodo}\n`);
  fs.writeFileSync(path.join(repo, '.brownie/todo-breakdown.md'), `# breakdown\n\n## TODO-repair-${replanId}\n\nParent TODO: E-23a-release-artifact-portable-archive-leaf-01\n`);
  writeJson(repo, '.brownie/private/phase-loop/status.json', {
    status: 'no_progress',
    run_id: 'terminal-replan',
    consecutive_failures: 0,
    detail: 'recovery=objective_apply_stalled:apply_authorized_objective_proposal_or_emit_apply_blocker'
  });
  writeJson(repo, '.brownie/private/phase-loop/progress-state.json', {
    classification: 'no_progress',
    same_progress_count: 1,
    selected_todo: { id: replanId, first_line: replanTodo.split('\n')[0], route: 'todo-decomposition' },
    progress_projection: { cli_status: 'terminal_task_failed', selected_todo: replanTodo }
  });
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/blocked.jsonl'), `${JSON.stringify({
    block_reason: 'stalled_leaf_contract_replan',
    todo_id: 'E-23a-release-artifact-portable-archive-leaf-01',
    selected_todo_first_line: sourceTodo.split('\n')[0]
  })}\n`);

  const result = controlPhaseLoop({ repoRoot: repo, write: false, repair: true, start: false });
  const todo = fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8');
  const feedback = JSON.parse(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/repair-feedback.json'), 'utf8'));

  assert.equal(result.repair.terminal_stalled_replan_recovery.ok, true, JSON.stringify(result, null, 2));
  assert.match(todo, /E-23a-release-artifact-portable-archive-leaf-01/u);
  assert.doesNotMatch(todo, new RegExp(replanId, 'u'));
  assert.equal(feedback.semantic_repair_policy.mode, 'force_bounded_leaf_target_patch');
  assert.deepEqual(feedback.semantic_repair_policy.selected_patch_targets, [
    'scripts/release-local-artifact.mjs',
    'scripts/release-local-artifact.test.mjs'
  ]);
  assert.equal(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/blocked.jsonl'), 'utf8'), '');
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
