import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { appendTaskTransition, readTaskLedger, recordTerminalFailureRecovery, recordTerminalReplanWithChildren, recordTrajectory, replanTaskWithChildren, resolveClaimLedgerAttempt, reviewReworkLedgerAttemptId, taskAttemptId, taskIsExecutable, taskProjection, validateTaskLedger } from './phase-loop-task-ledger.mjs';

function terminalEvidence(selectedTodo, claimId) {
  return {
    kind: 'phase_loop_terminal_failure_execution_evidence',
    task_execution_confirmed: true,
    claim_id: claimId,
    selected_todo_sha256: crypto.createHash('sha256').update(selectedTodo).digest('hex')
  };
}

function reviewReworkClaimForTerminalAttempt({ repo, claimId, selectedTodo, terminalEvent }) {
  const sourceTodoId = selectedTodo.match(/^(?:[-*]|\d+[.)])\s+\[\s\]\s+([^:\s]+)/u)?.[1];
  assert.ok(sourceTodoId, 'selected TODO must provide an id');
  const sourceTaskId = taskAttemptId(sourceTodoId, claimId);
  const selectedTodoSha256 = crypto.createHash('sha256').update(selectedTodo).digest('hex');
  const recoveryId = 'review-rework-recovery';
  const sourceTerminalEventSha256 = crypto.createHash('sha256').update(JSON.stringify(terminalEvent)).digest('hex');
  const ledgerAttemptId = reviewReworkLedgerAttemptId({
    sourceTaskId,
    recoveryId,
    sourceTerminalEventId: terminalEvent.event_id,
    selectedTodoSha256
  });
  const audit = {
    schema_version: 1,
    record_type: 'review_rework_terminal_attempt_isolation',
    recovery_id: recoveryId,
    root_claim_id: claimId,
    selected_todo_sha256: selectedTodoSha256,
    source_task_id: sourceTaskId,
    source_terminal_event_id: terminalEvent.event_id,
    source_terminal_event_sha256: sourceTerminalEventSha256,
    source_terminal_state: 'completed',
    source_task_spec_sha256: selectedTodoSha256,
    ledger_attempt_id: ledgerAttemptId
  };
  const auditPath = path.join(repo, '.brownie/private/phase-loop/review-rework-ledger-attempts/recovery.json');
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  fs.writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
  return {
    claim_id: claimId,
    root_claim_id: claimId,
    status: 'in_progress',
    selected_todo: selectedTodo,
    legacy_completion_recovery: {
      recovery_id: recoveryId,
      invalidated_completion_claim_id: claimId
    },
    review_rework: { required: true, state: 'CHANGES_REQUESTED', root_claim_id: claimId },
    review_rework_ledger_attempt: {
      schema_version: 1,
      kind: 'review_rework_terminal_attempt_isolation',
      recovery_id: recoveryId,
      root_claim_id: claimId,
      selected_todo_sha256: selectedTodoSha256,
      source_task_id: sourceTaskId,
      source_terminal_event_id: terminalEvent.event_id,
      source_terminal_event_sha256: sourceTerminalEventSha256,
      source_task_spec_sha256: selectedTodoSha256,
      ledger_attempt_id: ledgerAttemptId,
      audit_path: path.relative(repo, auditPath),
      audit_sha256: crypto.createHash('sha256').update(fs.readFileSync(auditPath, 'utf8')).digest('hex')
    }
  };
}

test('task ledger enforces a terminal state machine', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  assert.equal(appendTaskTransition(repo, { task_id: 'T-1', to_state: 'queued' }).ok, true);
  assert.equal(appendTaskTransition(repo, { task_id: 'T-1', to_state: 'claimed' }).ok, true);
  assert.equal(appendTaskTransition(repo, { task_id: 'T-1', to_state: 'running' }).ok, true);
  assert.equal(appendTaskTransition(repo, { task_id: 'T-1', to_state: 'blocked', reason: 'runtime_terminal_failure' }).ok, true);
  assert.equal(appendTaskTransition(repo, { task_id: 'T-1', to_state: 'running' }).code, 'terminal_task_cannot_transition');
  assert.equal(taskProjection(readTaskLedger(repo)).get('T-1').to_state, 'blocked');
});

test('replans require a cause and replacement children', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  appendTaskTransition(repo, { task_id: 'T-2', to_state: 'queued' });
  assert.equal(appendTaskTransition(repo, { task_id: 'T-2', to_state: 'replanned', reason: 'over_broad', replaces: [] }).code, 'replan_requires_reason_and_children');
  assert.equal(appendTaskTransition(repo, { task_id: 'T-2', to_state: 'replanned', reason: 'over_broad', replaces: ['T-2a'] }).ok, true);
});

test('execution gate rejects underspecified and blocker tasks', () => {
  assert.deepEqual(taskIsExecutable({ task_id: 'T-3', route: 'implementation', patch_targets: ['x'], verification_commands: ['node --test'] }), { ok: true, missing: [] });
  assert.equal(taskIsExecutable({ task_id: 'T-4', route: 'blocker', patch_targets: [], verification_commands: [] }).ok, false);
});

test('replan atomically records a terminal parent and executable queued children', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  appendTaskTransition(repo, { task_id: 'T-5', to_state: 'queued' });
  const result = replanTaskWithChildren(repo, {
    task_id: 'T-5', reason: 'over_broad',
    children: [
      { task_id: 'T-5a', route: 'implementation', patch_targets: ['a.rs'], verification_commands: ['cargo test'] },
      { task_id: 'T-5b', route: 'documentation', patch_targets: ['docs/a.md'], verification_commands: ['pnpm check'] }
    ]
  });
  assert.equal(result.ok, true);
  const events = readTaskLedger(repo);
  assert.equal(validateTaskLedger(events).ok, true);
  const projection = taskProjection(events);
  assert.equal(projection.get('T-5').to_state, 'replanned');
  assert.equal(projection.get('T-5a').to_state, 'queued');
  assert.equal(projection.get('T-5b').parent_task_id, 'T-5');
});

test('terminal replan preserves the failed source attempt and atomically records a derived recovery', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const selectedTodo = [
    '- [ ] T-terminal: multi-target implementation leaf',
    '  Route: implementation.',
    '  Patch only `scripts/a.mjs` and `scripts/b.mjs`.',
    '  Verification: run `node --test scripts/a.test.mjs`.'
  ].join('\n');
  const claimId = 'claim-terminal';
  const sourceTaskId = taskAttemptId('T-terminal', claimId);
  const specHash = crypto.createHash('sha256').update(selectedTodo).digest('hex');
  for (const to_state of ['queued', 'claimed', 'running', 'failed']) {
    assert.equal(appendTaskTransition(repo, {
      task_id: sourceTaskId,
      to_state,
      claim_id: claimId,
      run_id: 'run-terminal',
      task_spec_sha256: specHash,
      reason: to_state === 'failed' ? 'trajectory_failed' : undefined
    }).ok, true);
  }
  const children = [
    { task_id: 'T-terminal-target-01', route: 'implementation', patch_targets: ['scripts/a.mjs'], verification_commands: ['node --test scripts/a.test.mjs'] },
    { task_id: 'T-terminal-target-02', route: 'implementation', patch_targets: ['scripts/b.mjs'], verification_commands: ['node --test scripts/a.test.mjs'] }
  ];
  const input = {
    selected_todo: selectedTodo,
    claim_id: claimId,
    run_id: 'run-terminal-replan',
    reason: 'terminal_multitarget_leaf_split',
    evidence_source: 'prior_terminal_unproposed_workspace_write_ledger',
    children
  };
  const result = recordTerminalReplanWithChildren(repo, input);
  assert.equal(result.ok, true);
  assert.equal(result.code, 'terminal_replan_recorded');
  const events = readTaskLedger(repo);
  const projection = taskProjection(events);
  assert.equal(projection.get(sourceTaskId).to_state, 'failed');
  assert.equal(projection.get(result.task_id).to_state, 'replanned');
  assert.equal(projection.get('T-terminal-target-01').parent_task_id, result.task_id);
  assert.equal(projection.get('T-terminal-target-02').to_state, 'queued');
  assert.equal(validateTaskLedger(events).ok, true);

  const ledger = path.join(repo, '.brownie/private/phase-loop/task-ledger.jsonl');
  const before = fs.readFileSync(ledger, 'utf8');
  const duplicate = recordTerminalReplanWithChildren(repo, input);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.code, 'duplicate_terminal_replan');
  assert.equal(fs.readFileSync(ledger, 'utf8'), before);
});

test('terminal replan accepts a blocked execution source without reopening it', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const selectedTodo = '- [ ] T-terminal-blocked: bounded task\n  Route: implementation.\n  Patch only `scripts/a.mjs`, `scripts/b.mjs`.\n  Verification: run `node --test scripts/a.test.mjs`.';
  const claimId = 'claim-terminal-blocked';
  const sourceTaskId = taskAttemptId('T-terminal-blocked', claimId);
  const specHash = crypto.createHash('sha256').update(selectedTodo).digest('hex');
  for (const to_state of ['queued', 'claimed', 'blocked']) {
    assert.equal(appendTaskTransition(repo, {
      task_id: sourceTaskId,
      to_state,
      claim_id: claimId,
      run_id: 'run-terminal-blocked',
      task_spec_sha256: specHash,
      reason: to_state === 'blocked' ? 'trajectory_blocked' : undefined
    }).ok, true);
  }
  const result = recordTerminalReplanWithChildren(repo, {
    selected_todo: selectedTodo,
    claim_id: claimId,
    run_id: 'run-terminal-blocked-replan',
    reason: 'terminal_multitarget_leaf_split',
    evidence_source: 'prior_terminal_unproposed_workspace_write_ledger',
    children: [
      { task_id: 'T-terminal-blocked-target-01', route: 'implementation', patch_targets: ['scripts/a.mjs'], verification_commands: ['node --test scripts/a.test.mjs'] },
      { task_id: 'T-terminal-blocked-target-02', route: 'implementation', patch_targets: ['scripts/b.mjs'], verification_commands: ['node --test scripts/a.test.mjs'] }
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(taskProjection(readTaskLedger(repo)).get(sourceTaskId).to_state, 'blocked');
  assert.equal(result.events.find((event) => event.to_state === 'replanned').terminal_source_state, 'blocked');
});

test('terminal replan trajectory validates the prior atomic recovery rather than reopening the failed source', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const todo = path.join(repo, '.brownie', 'todo.md');
  const selectedTodo = [
    '- [ ] T-terminal-trajectory: multi-target implementation leaf',
    '  Route: implementation.',
    '  Patch only `scripts/a.mjs` and `scripts/b.mjs`.',
    '  Verification: run `node --test scripts/a.test.mjs`.'
  ].join('\n');
  fs.mkdirSync(path.dirname(todo), { recursive: true });
  fs.writeFileSync(todo, [
    '- [ ] T-terminal-trajectory-target-01: first replacement',
    '  Route: implementation.',
    '  Source TODO: T-terminal-trajectory.',
    '  Patch only `scripts/a.mjs`.',
    '  Verification: run `node --test scripts/a.test.mjs`.',
    '',
    '- [ ] T-terminal-trajectory-target-02: second replacement',
    '  Route: implementation.',
    '  Source TODO: T-terminal-trajectory.',
    '  Patch only `scripts/b.mjs`.',
    '  Verification: run `node --test scripts/a.test.mjs`.',
    ''
  ].join('\n'));
  const claim = path.join(repo, 'claim.json');
  const claimId = 'claim-terminal-trajectory';
  fs.writeFileSync(claim, JSON.stringify({ claim_id: claimId, selected_todo: selectedTodo }));
  const sourceTaskId = taskAttemptId('T-terminal-trajectory', claimId);
  const specHash = crypto.createHash('sha256').update(selectedTodo).digest('hex');
  for (const to_state of ['queued', 'claimed', 'running', 'failed']) {
    appendTaskTransition(repo, {
      task_id: sourceTaskId,
      to_state,
      claim_id: claimId,
      run_id: 'run-terminal-trajectory',
      task_spec_sha256: specHash,
      reason: to_state === 'failed' ? 'trajectory_failed' : undefined
    });
  }
  const result = recordTerminalReplanWithChildren(repo, {
    selected_todo: selectedTodo,
    claim_id: claimId,
    run_id: 'run-terminal-trajectory-replan',
    reason: 'terminal_multitarget_leaf_split',
    evidence_source: 'prior_terminal_unproposed_workspace_write_ledger',
    children: [
      { task_id: 'T-terminal-trajectory-target-01', route: 'implementation', patch_targets: ['scripts/a.mjs', 'node --test scripts/a.test.mjs'], verification_commands: ['node --test scripts/a.test.mjs'] },
      { task_id: 'T-terminal-trajectory-target-02', route: 'implementation', patch_targets: ['scripts/b.mjs', 'node --test scripts/a.test.mjs'], verification_commands: ['node --test scripts/a.test.mjs'] }
    ]
  });
  assert.equal(result.ok, true);
  const trajectory = recordTrajectory(repo, {
    claimPath: claim,
    todoPath: todo,
    type: 'todo.terminal_replanned',
    runId: 'run-terminal-trajectory-replan',
    payloadRaw: JSON.stringify({
      reason: 'terminal_multitarget_leaf_split',
      evidence_source: 'prior_terminal_unproposed_workspace_write_ledger',
      terminal_replan_task_id: result.task_id,
      terminal_replan_fingerprint: result.terminal_replan_fingerprint
    })
  });
  assert.equal(trajectory.ok, true, JSON.stringify(trajectory));
  assert.equal(trajectory.code, 'terminal_replan_trajectory_recorded');
  assert.equal(taskProjection(readTaskLedger(repo)).get(sourceTaskId).to_state, 'failed');
});

test('accepts only an exact duplicate replan transaction', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  appendTaskTransition(repo, { task_id: 'T-5x', to_state: 'queued' });
  const children = [
    { task_id: 'T-5xa', route: 'implementation', patch_targets: ['a.rs'], verification_commands: ['cargo test'], task_spec_sha256: 'child-a' },
    { task_id: 'T-5xb', route: 'documentation', patch_targets: ['docs/a.md'], verification_commands: ['pnpm check'], task_spec_sha256: 'child-b' }
  ];
  const input = { task_id: 'T-5x', reason: 'over_broad', children, run_id: 'run-replan', claim_id: 'claim-replan', task_spec_sha256: 'parent-spec' };
  assert.equal(replanTaskWithChildren(repo, input).ok, true);
  const ledger = path.join(repo, '.brownie/private/phase-loop/task-ledger.jsonl');
  const before = fs.readFileSync(ledger, 'utf8');
  const duplicate = replanTaskWithChildren(repo, { ...input, at: 'later' });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.code, 'duplicate_replan');
  assert.equal(duplicate.events.length, 3);
  assert.equal(fs.readFileSync(ledger, 'utf8'), before);

  const changedChild = replanTaskWithChildren(repo, {
    ...input,
    children: [{ ...children[0], patch_targets: ['different.rs'] }, children[1]]
  });
  assert.equal(changedChild.ok, false);
  assert.equal(changedChild.code, 'replan_duplicate_mismatch');

  for (const changed of [
    { ...children[0], verification_commands: ['cargo test --locked'] },
    { ...children[0], route: 'documentation' },
    { ...children[0], task_spec_sha256: 'child-a-changed' }
  ]) {
    const mismatch = replanTaskWithChildren(repo, {
      ...input,
      children: [changed, children[1]]
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.code, 'replan_duplicate_mismatch');
  }

  const changedSet = replanTaskWithChildren(repo, {
    ...input,
    children: [children[0], { ...children[1], task_id: 'T-5xc' }]
  });
  assert.equal(changedSet.ok, false);
  assert.equal(changedSet.code, 'replan_duplicate_mismatch');
  assert.equal(fs.readFileSync(ledger, 'utf8'), before);
});

test('reuses only an equivalent queued replacement child for a retry of the same logical TODO', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const child = { task_id: 'C-reuse', route: 'implementation', patch_targets: ['scripts/child.mjs'], verification_commands: ['node --test scripts/child.test.mjs'] };
  const firstParent = 'P-reuse@claim-one';
  appendTaskTransition(repo, { task_id: firstParent, to_state: 'queued' });
  appendTaskTransition(repo, { task_id: firstParent, to_state: 'claimed', claim_id: 'claim-one' });
  appendTaskTransition(repo, { task_id: firstParent, to_state: 'running', claim_id: 'claim-one' });
  assert.equal(replanTaskWithChildren(repo, {
    task_id: firstParent, reason: 'runtime_claim_snapshot_mismatch', children: [child], run_id: 'run-one', claim_id: 'claim-one'
  }).ok, true);

  const retryParent = 'P-reuse@claim-two';
  appendTaskTransition(repo, { task_id: retryParent, to_state: 'queued' });
  appendTaskTransition(repo, { task_id: retryParent, to_state: 'claimed', claim_id: 'claim-two' });
  appendTaskTransition(repo, { task_id: retryParent, to_state: 'running', claim_id: 'claim-two' });
  const before = fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/task-ledger.jsonl'), 'utf8');
  const reused = replanTaskWithChildren(repo, {
    task_id: retryParent, reason: 'runtime_claim_snapshot_mismatch', children: [child], run_id: 'run-two', claim_id: 'claim-two'
  });
  assert.equal(reused.ok, true);
  assert.equal(reused.code, 'replan_reused_children');
  const after = fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/task-ledger.jsonl'), 'utf8');
  assert.equal(after.slice(0, before.length), before);
  const projection = taskProjection(readTaskLedger(repo));
  assert.equal(projection.get(retryParent).to_state, 'replanned');
  assert.equal(projection.get('C-reuse').to_state, 'queued');
  assert.equal(validateTaskLedger(readTaskLedger(repo)).ok, true);
});

test('rejects stale, mismatched, and mixed replacement-child collisions without writing', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const child = { task_id: 'C-collision', route: 'implementation', patch_targets: ['scripts/child.mjs'], verification_commands: ['node --test scripts/child.test.mjs'] };
  const firstParent = 'P-collision@claim-one';
  for (const state of ['queued', 'claimed', 'running']) appendTaskTransition(repo, { task_id: firstParent, to_state: state, claim_id: 'claim-one' });
  replanTaskWithChildren(repo, { task_id: firstParent, reason: 'split', children: [child], run_id: 'run-one', claim_id: 'claim-one' });
  const retryParent = 'P-collision@claim-two';
  for (const state of ['queued', 'claimed', 'running']) appendTaskTransition(repo, { task_id: retryParent, to_state: state, claim_id: 'claim-two' });
  const ledger = path.join(repo, '.brownie/private/phase-loop/task-ledger.jsonl');
  const before = fs.readFileSync(ledger, 'utf8');
  assert.equal(replanTaskWithChildren(repo, {
    task_id: retryParent, reason: 'split', children: [{ ...child, patch_targets: ['scripts/other.mjs'] }], run_id: 'run-two', claim_id: 'claim-two'
  }).code, 'replan_child_collision_not_reusable');
  assert.equal(replanTaskWithChildren(repo, {
    task_id: retryParent, reason: 'split', children: [child, { ...child, task_id: 'C-new' }], run_id: 'run-two', claim_id: 'claim-two'
  }).code, 'replan_child_collision_mixed_set');
  assert.equal(fs.readFileSync(ledger, 'utf8'), before);
  appendTaskTransition(repo, { task_id: 'C-collision', to_state: 'claimed', claim_id: 'child-claim' });
  const beforeStaleCheck = fs.readFileSync(ledger, 'utf8');
  assert.equal(replanTaskWithChildren(repo, {
    task_id: retryParent, reason: 'split', children: [child], run_id: 'run-two', claim_id: 'claim-two'
  }).code, 'replan_child_collision_not_reusable');
  assert.equal(fs.readFileSync(ledger, 'utf8'), beforeStaleCheck);
});

test('continues a replacement child claim on the queued child task id', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const todo = path.join(repo, '.brownie', 'todo.md');
  fs.mkdirSync(path.dirname(todo), { recursive: true });
  fs.writeFileSync(todo, [
    '- [ ] P-1: broad parent task',
    '  Route: todo-decomposition.',
    '  Verification: run `pnpm check`.',
    '',
    '- [ ] C-1: replacement child task',
    '  Route: implementation.',
    '  Source TODO: P-1.',
    '  Patch only `scripts/child.mjs`.',
    '  Verification: run `node --check scripts/child.mjs`.',
    ''
  ].join('\n'));
  const parentClaim = path.join(repo, 'parent-claim.json');
  fs.writeFileSync(parentClaim, JSON.stringify({
    claim_id: 'claim-parent',
    selected_todo: '- [ ] P-1: broad parent task\n  Route: todo-decomposition.\n  Verification: run `pnpm check`.'
  }));
  assert.equal(recordTrajectory(repo, { claimPath: parentClaim, todoPath: todo, type: 'todo.claimed', runId: 'run-parent' }).ok, true);
  assert.equal(recordTrajectory(repo, { claimPath: parentClaim, todoPath: todo, type: 'workflow.routed', runId: 'run-parent' }).ok, true);
  assert.equal(recordTrajectory(repo, {
    claimPath: parentClaim,
    todoPath: todo,
    type: 'todo.replanned',
    runId: 'run-parent',
    payloadRaw: '{"reason":"split_parent"}'
  }).ok, true);

  const childClaim = path.join(repo, 'child-claim.json');
  fs.writeFileSync(childClaim, JSON.stringify({
    claim_id: 'claim-child',
    selected_todo: '- [ ] C-1: replacement child task\n  Route: implementation.\n  Source TODO: P-1.\n  Patch only `scripts/child.mjs`.\n  Verification: run `node --check scripts/child.mjs`.'
  }));
  assert.equal(recordTrajectory(repo, { claimPath: childClaim, todoPath: todo, type: 'todo.claimed', runId: 'run-child' }).ok, true);
  assert.equal(recordTrajectory(repo, { claimPath: childClaim, todoPath: todo, type: 'workflow.routed', runId: 'run-child' }).ok, true);
  assert.equal(recordTrajectory(repo, { claimPath: childClaim, todoPath: todo, type: 'todo.completed', runId: 'run-child' }).ok, true);

  const events = readTaskLedger(repo);
  const childEvents = events.filter((event) => event.task_id === 'C-1');
  assert.deepEqual(childEvents.map((event) => event.to_state), ['queued', 'claimed', 'running', 'completed']);
  assert.equal(events.some((event) => event.task_id === 'C-1@claim-child'), false);
  for (const event of childEvents.slice(1)) {
    assert.equal(event.parent_task_id, 'P-1@claim-parent');
    assert.equal(event.claim_id, 'claim-child');
    assert.equal(event.run_id, 'run-child');
  }
  assert.equal(validateTaskLedger(events).ok, true);
});

test('starts a fresh attempt when a replacement child claim is stale', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const todo = path.join(repo, '.brownie', 'todo.md');
  fs.mkdirSync(path.dirname(todo), { recursive: true });
  fs.writeFileSync(todo, [
    '- [ ] P-stale: broad parent task',
    '  Route: todo-decomposition.',
    '  Verification: run `pnpm check`.',
    '',
    '- [ ] C-stale: replacement child task',
    '  Route: implementation.',
    '  Source TODO: P-stale.',
    '  Patch only `scripts/child.mjs`.',
    '  Verification: run `node --check scripts/child.mjs`.',
    ''
  ].join('\n'));
  const parentClaim = path.join(repo, 'parent-claim.json');
  fs.writeFileSync(parentClaim, JSON.stringify({
    claim_id: 'claim-parent-stale',
    selected_todo: '- [ ] P-stale: broad parent task\n  Route: todo-decomposition.\n  Verification: run `pnpm check`.'
  }));
  recordTrajectory(repo, { claimPath: parentClaim, todoPath: todo, type: 'todo.claimed', runId: 'run-parent-stale' });
  recordTrajectory(repo, { claimPath: parentClaim, todoPath: todo, type: 'workflow.routed', runId: 'run-parent-stale' });
  recordTrajectory(repo, {
    claimPath: parentClaim,
    todoPath: todo,
    type: 'todo.replanned',
    runId: 'run-parent-stale',
    payloadRaw: '{"reason":"split_parent"}'
  });

  const staleClaim = path.join(repo, 'stale-child-claim.json');
  fs.writeFileSync(staleClaim, JSON.stringify({
    claim_id: 'claim-child-stale',
    selected_todo: '- [ ] C-stale: replacement child task\n  Route: implementation.\n  Source TODO: P-stale.\n  Patch only `scripts/child.mjs`.\n  Verification: run `node --check scripts/child.mjs`.'
  }));
  recordTrajectory(repo, { claimPath: staleClaim, todoPath: todo, type: 'todo.claimed', runId: 'run-child-stale' });
  recordTrajectory(repo, { claimPath: staleClaim, todoPath: todo, type: 'workflow.routed', runId: 'run-child-stale' });

  const freshClaim = path.join(repo, 'fresh-child-claim.json');
  fs.writeFileSync(freshClaim, JSON.stringify({
    claim_id: 'claim-child-fresh',
    selected_todo: '- [ ] C-stale: replacement child task\n  Route: implementation.\n  Source TODO: P-stale.\n  Patch only `scripts/child.mjs`.\n  Verification: run `node --check scripts/child.mjs`.'
  }));
  assert.equal(recordTrajectory(repo, { claimPath: freshClaim, todoPath: todo, type: 'todo.claimed', runId: 'run-child-fresh' }).ok, true);
  assert.equal(recordTrajectory(repo, { claimPath: freshClaim, todoPath: todo, type: 'workflow.routed', runId: 'run-child-fresh' }).ok, true);
  assert.equal(recordTrajectory(repo, { claimPath: freshClaim, todoPath: todo, type: 'todo.completed', runId: 'run-child-fresh' }).ok, true);

  const events = readTaskLedger(repo);
  const rawChild = events.filter((event) => event.task_id === 'C-stale');
  const freshChild = events.filter((event) => event.task_id === 'C-stale@claim-child-fresh');
  assert.equal(rawChild.at(-1).to_state, 'failed');
  assert.deepEqual(freshChild.map((event) => event.to_state), ['queued', 'claimed', 'running', 'completed']);
  assert.equal(freshChild.at(-1).parent_task_id, 'P-stale@claim-parent-stale');
  assert.equal(validateTaskLedger(events).ok, true);
});

test('replan leaves the ledger unchanged when a child fails the execution gate', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  appendTaskTransition(repo, { task_id: 'T-6', to_state: 'queued' });
  const before = readTaskLedger(repo);
  const result = replanTaskWithChildren(repo, {
    task_id: 'T-6', reason: 'over_broad', children: [{ task_id: 'T-6a', route: 'blocker', patch_targets: [], verification_commands: [] }]
  });
  assert.equal(result.code, 'replan_child_not_executable');
  assert.deepEqual(readTaskLedger(repo), before);
});

test('ignores an incomplete replan journal instead of exposing a parent-only replacement', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const ledger = path.join(repo, '.brownie/private/phase-loop/task-ledger.jsonl');
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  fs.writeFileSync(ledger, '{"kind":"replan_transaction","events":[{"task_id":"T-7","to_state":"replanned"}]}\n');
  assert.deepEqual(readTaskLedger(repo), []);
});

test('binds terminal failure recovery identity to controller and execution attempt', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const selectedTodo = '- [ ] E-retry: Patch only `scripts/retry.mjs`:\n  Route: implementation.\n  Verification: run `node --check scripts/retry.mjs`.';
  const base = {
    selected_todo: selectedTodo,
    claim_id: 'claim-retry',
    run_id: 'run-retry-1',
    queue_generation: 4,
    queue_fingerprint: 'queue-retry',
    provider_failure_fingerprint: 'provider-retry',
    retry_cap: 1,
    controller_fingerprint: 'controller-old',
    at: '2026-10-19T08:00:00Z',
    execution_evidence: terminalEvidence(selectedTodo, 'claim-retry')
  };

  const first = recordTerminalFailureRecovery(repo, base);
  assert.equal(first.ok, true);
  const duplicate = recordTerminalFailureRecovery(repo, base);
  assert.equal(duplicate.code, 'duplicate_terminal_failure_recovery');

  const rebased = recordTerminalFailureRecovery(repo, {
    ...base,
    controller_fingerprint: 'controller-new',
    at: '2026-10-19T08:01:00Z'
  });
  assert.equal(rebased.ok, true);
  assert.notEqual(rebased.recovery_id, first.recovery_id);

  const events = readTaskLedger(repo).filter((event) => event.to_state === 'failed');
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.controller_fingerprint), ['controller-old', 'controller-new']);
  assert.equal(validateTaskLedger(readTaskLedger(repo)).ok, true);
});

test('re-records an explicitly replayed terminal block after controller rebaseline', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const selectedTodo = '- [ ] E-rebaseline-explicit: Patch only `scripts/rebaseline.mjs`:\n  Route: implementation.\n  Verification: run `node --check scripts/rebaseline.mjs`.';
  const first = recordTerminalFailureRecovery(repo, {
    selected_todo: selectedTodo,
    claim_id: 'claim-rebaseline',
    run_id: 'run-old',
    retry_cap: 1,
    controller_fingerprint: 'controller-old',
    recovery_id: 'persisted-recovery-id',
    execution_evidence: terminalEvidence(selectedTodo, 'claim-rebaseline')
  });
  const rebased = recordTerminalFailureRecovery(repo, {
    selected_todo: selectedTodo,
    claim_id: 'claim-rebaseline',
    run_id: 'run-new',
    retry_cap: 1,
    controller_fingerprint: 'controller-new',
    recovery_id: 'persisted-recovery-id',
    execution_evidence: terminalEvidence(selectedTodo, 'claim-rebaseline')
  });
  assert.equal(first.ok, true);
  assert.equal(rebased.ok, true);
  assert.notEqual(rebased.recovery_id, first.recovery_id);
  const failed = readTaskLedger(repo).filter((event) => event.to_state === 'failed');
  assert.deepEqual(failed.map((event) => event.controller_fingerprint), ['controller-old', 'controller-new']);
  assert.equal(validateTaskLedger(readTaskLedger(repo)).ok, true);
});

test('records repeated claims as separate immutable task attempts', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const todo = path.join(repo, '.brownie', 'todo.md');
  fs.mkdirSync(path.dirname(todo), { recursive: true });
  fs.writeFileSync(todo, '- [ ] T-8: retryable bounded task\n');
  const script = path.join(process.cwd(), 'scripts', 'phase-loop-task-ledger.mjs');
  for (const claimId of ['claim-one', 'claim-two']) {
    const claim = path.join(repo, `${claimId}.json`);
    fs.writeFileSync(claim, JSON.stringify({ claim_id: claimId, selected_todo: '- [ ] T-8: retryable bounded task' }));
    execFileSync(process.execPath, [script, 'record-trajectory', '--repo', repo, '--claim', claim, '--todo', todo, '--type', 'todo.claimed', '--run', claimId], { stdio: 'pipe' });
  }
  const projection = taskProjection(readTaskLedger(repo));
  assert.equal(projection.get(taskAttemptId('T-8', 'claim-one')).to_state, 'claimed');
  assert.equal(projection.get(taskAttemptId('T-8', 'claim-two')).to_state, 'claimed');
});

test('isolates a review-rework execution from an erroneous terminal attempt of the same claim', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const todo = path.join(repo, '.brownie', 'todo.md');
  const selectedTodo = [
    '- [ ] T-review-rework: rejected implementation root',
    '  Route: implementation.',
    '  Patch only `scripts/root.mjs`.',
    '  Verification: run `node --test scripts/root.test.mjs`.'
  ].join('\n');
  fs.mkdirSync(path.dirname(todo), { recursive: true });
  fs.writeFileSync(todo, [
    '- [ ] T-review-rework-followup: review-directed replacement',
    '  Route: implementation.',
    '  Source TODO: T-review-rework.',
    '  Patch only `scripts/followup.mjs`.',
    '  Verification: run `node --test scripts/followup.test.mjs`.',
    ''
  ].join('\n'));
  const claimId = 'claim-review-rework';
  const sourceTaskId = taskAttemptId('T-review-rework', claimId);
  const specHash = crypto.createHash('sha256').update(selectedTodo).digest('hex');
  let terminalEvent;
  for (const to_state of ['queued', 'claimed', 'running', 'completed']) {
    const result = appendTaskTransition(repo, {
      task_id: sourceTaskId,
      to_state,
      claim_id: claimId,
      run_id: 'historical-run',
      task_spec_sha256: specHash
    });
    assert.equal(result.ok, true);
    if (to_state === 'completed') terminalEvent = result.event;
  }
  const claim = path.join(repo, 'claim.json');
  const reviewReworkClaim = reviewReworkClaimForTerminalAttempt({ repo, claimId, selectedTodo, terminalEvent });
  fs.writeFileSync(claim, JSON.stringify(reviewReworkClaim));

  assert.equal(recordTrajectory(repo, { claimPath: claim, todoPath: todo, type: 'todo.claimed', runId: 'fresh-run' }).ok, true);
  assert.equal(recordTrajectory(repo, { claimPath: claim, todoPath: todo, type: 'workflow.routed', runId: 'fresh-run' }).ok, true);
  // Review feedback can be replayed while the same reimplementation is
  // continuing. It is observability for an existing attempt, never a request
  // to replace or terminalize that attempt.
  for (const runId of ['fresh-run', 'continuation-run']) {
    const feedback = recordTrajectory(repo, {
      claimPath: claim,
      todoPath: todo,
      type: 'todo.repair_feedback',
      payloadRaw: JSON.stringify({ reason: 'review_rework_reimplementation_required' }),
      runId
    });
    assert.equal(feedback.ok, true, JSON.stringify(feedback));
  }
  const isolatedTaskId = reviewReworkClaim.review_rework_ledger_attempt.ledger_attempt_id;
  assert.equal(taskProjection(readTaskLedger(repo)).get(isolatedTaskId).to_state, 'running');
  const replanned = recordTrajectory(repo, {
    claimPath: claim,
    todoPath: todo,
    type: 'todo.replanned',
    payloadRaw: JSON.stringify({ reason: 'review_directed_reimplementation' }),
    runId: 'fresh-run'
  });
  assert.equal(replanned.ok, true, JSON.stringify(replanned));
  const projection = taskProjection(readTaskLedger(repo));
  assert.equal(projection.get(sourceTaskId).to_state, 'completed');
  assert.equal(projection.get(isolatedTaskId).to_state, 'replanned');
  assert.equal(projection.get('T-review-rework-followup').parent_task_id, isolatedTaskId);

  const continued = recordTrajectory(repo, { claimPath: claim, todoPath: todo, type: 'workflow.routed', runId: 'continuation-run' });
  assert.equal(continued.ok, true);
  assert.equal(continued.code, 'duplicate_trajectory');
  assert.equal(taskProjection(readTaskLedger(repo)).get(isolatedTaskId).to_state, 'replanned');
  assert.equal(taskProjection(readTaskLedger(repo)).get(sourceTaskId).to_state, 'completed');
});

test('an isolated review-rework attempt can complete after independent review resolves', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const selectedTodo = [
    '- [ ] T-review-rework-complete: rejected implementation root',
    '  Route: implementation.',
    '  Patch only `scripts/root.mjs`.',
    '  Verification: run `node --test scripts/root.test.mjs`.'
  ].join('\n');
  const claimId = 'claim-review-rework-complete';
  const sourceTaskId = taskAttemptId('T-review-rework-complete', claimId);
  const specHash = crypto.createHash('sha256').update(selectedTodo).digest('hex');
  let terminalEvent;
  for (const to_state of ['queued', 'claimed', 'running', 'completed']) {
    const result = appendTaskTransition(repo, {
      task_id: sourceTaskId,
      to_state,
      claim_id: claimId,
      run_id: 'historical-run',
      task_spec_sha256: specHash
    });
    assert.equal(result.ok, true);
    if (to_state === 'completed') terminalEvent = result.event;
  }
  const claimPath = path.join(repo, 'claim.json');
  const claim = reviewReworkClaimForTerminalAttempt({ repo, claimId, selectedTodo, terminalEvent });
  fs.writeFileSync(claimPath, JSON.stringify(claim));

  assert.equal(recordTrajectory(repo, { claimPath, type: 'todo.claimed', runId: 'rework-run' }).ok, true);
  assert.equal(recordTrajectory(repo, { claimPath, type: 'workflow.routed', runId: 'rework-run' }).ok, true);
  claim.status = 'completed';
  claim.review_rework = {
    required: false,
    state: 'RESOLVED',
    root_claim_id: claimId,
    resolved_at: '2026-10-31T10:00:00Z'
  };
  fs.writeFileSync(claimPath, JSON.stringify(claim));

  const completion = recordTrajectory(repo, { claimPath, type: 'todo.completed', runId: 'rework-merged-run' });
  assert.equal(completion.ok, true, JSON.stringify(completion));
  const isolatedTaskId = claim.review_rework_ledger_attempt.ledger_attempt_id;
  const projection = taskProjection(readTaskLedger(repo));
  assert.equal(projection.get(sourceTaskId).to_state, 'completed');
  assert.equal(projection.get(isolatedTaskId).to_state, 'completed');
});

test('terminal replan binds a review-rework failure to its isolated attempt', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const todo = path.join(repo, '.brownie', 'todo.md');
  const selectedTodo = [
    '- [ ] T-review-rework-replan: rejected multi-target root',
    '  Route: implementation.',
    '  Patch only `scripts/a.mjs` and `scripts/b.mjs`.',
    '  Verification: run `node --test scripts/root.test.mjs`.'
  ].join('\n');
  fs.mkdirSync(path.dirname(todo), { recursive: true });
  fs.writeFileSync(todo, [
    '- [ ] T-review-rework-replan-followup: review-directed replacement',
    '  Route: implementation.',
    '  Source TODO: T-review-rework-replan.',
    '  Patch only `scripts/a.mjs`.',
    '  Verification: run `node --test scripts/root.test.mjs`.',
    ''
  ].join('\n'));
  const claimId = 'claim-review-rework-replan';
  const sourceTaskId = taskAttemptId('T-review-rework-replan', claimId);
  const specHash = crypto.createHash('sha256').update(selectedTodo).digest('hex');
  let terminalEvent;
  for (const to_state of ['queued', 'claimed', 'running', 'completed']) {
    const result = appendTaskTransition(repo, {
      task_id: sourceTaskId,
      to_state,
      claim_id: claimId,
      run_id: 'historical-run',
      task_spec_sha256: specHash
    });
    assert.equal(result.ok, true);
    if (to_state === 'completed') terminalEvent = result.event;
  }
  const claimPath = path.join(repo, 'claim.json');
  const claim = reviewReworkClaimForTerminalAttempt({ repo, claimId, selectedTodo, terminalEvent });
  fs.writeFileSync(claimPath, JSON.stringify(claim));

  assert.equal(recordTrajectory(repo, { claimPath, todoPath: todo, type: 'todo.claimed', runId: 'rework-run' }).ok, true);
  assert.equal(recordTrajectory(repo, { claimPath, todoPath: todo, type: 'workflow.routed', runId: 'rework-run' }).ok, true);
  assert.equal(recordTrajectory(repo, { claimPath, todoPath: todo, type: 'todo.failed', runId: 'rework-run' }).ok, true);
  const resolved = resolveClaimLedgerAttempt(repo, { claim });
  assert.equal(resolved.ok, true, JSON.stringify(resolved));
  const isolatedTaskId = claim.review_rework_ledger_attempt.ledger_attempt_id;
  assert.equal(resolved.task_id, isolatedTaskId);
  assert.equal(resolved.task_state, 'failed');
  const cliResolved = JSON.parse(execFileSync(process.execPath, [
    path.join(process.cwd(), 'scripts', 'phase-loop-task-ledger.mjs'),
    'resolve-claim-attempt', '--repo', repo, '--claim', claimPath
  ], { encoding: 'utf8' }));
  assert.equal(cliResolved.ok, true, JSON.stringify(cliResolved));
  assert.equal(cliResolved.task_id, isolatedTaskId);
  assert.equal(cliResolved.task_state, 'failed');

  const replan = recordTerminalReplanWithChildren(repo, {
    selected_todo: selectedTodo,
    claim_id: claimId,
    claim,
    run_id: 'rework-replan-run',
    reason: 'terminal_multitarget_leaf_split',
    evidence_source: 'prior_terminal_unproposed_workspace_write_ledger',
    children: [
      { task_id: 'T-review-rework-replan-followup', route: 'implementation', patch_targets: ['scripts/a.mjs'], verification_commands: ['node --test scripts/root.test.mjs'] }
    ]
  });
  assert.equal(replan.ok, true, JSON.stringify(replan));
  assert.equal(replan.source_task_id, isolatedTaskId);
  const projection = taskProjection(readTaskLedger(repo));
  assert.equal(projection.get(sourceTaskId).to_state, 'completed');
  assert.equal(projection.get(isolatedTaskId).to_state, 'failed');
  assert.equal(projection.get(replan.task_id).parent_task_id, isolatedTaskId);
  assert.equal(projection.get('T-review-rework-replan-followup').parent_task_id, replan.task_id);
});

test('fails closed when a review-rework isolation binding no longer matches its terminal source', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const selectedTodo = '- [ ] T-review-rework: rejected implementation root';
  const claimId = 'claim-review-rework-invalid';
  const sourceTaskId = taskAttemptId('T-review-rework', claimId);
  const specHash = crypto.createHash('sha256').update(selectedTodo).digest('hex');
  let terminalEvent;
  for (const to_state of ['queued', 'claimed', 'running', 'completed']) {
    const result = appendTaskTransition(repo, { task_id: sourceTaskId, to_state, claim_id: claimId, task_spec_sha256: specHash });
    if (to_state === 'completed') terminalEvent = result.event;
  }
  const claim = path.join(repo, 'claim.json');
  const value = reviewReworkClaimForTerminalAttempt({ repo, claimId, selectedTodo, terminalEvent });
  value.review_rework_ledger_attempt.source_terminal_event_id = 'not-the-terminal-event';
  fs.writeFileSync(claim, JSON.stringify(value));
  const before = fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/task-ledger.jsonl'), 'utf8');
  const result = recordTrajectory(repo, { claimPath: claim, type: 'todo.claimed', runId: 'fresh-run' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'review_rework_ledger_attempt_invalid');
  assert.equal(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/task-ledger.jsonl'), 'utf8'), before);
});

test('records a failed retry and its later completion as unique task attempts', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const todo = path.join(repo, '.brownie', 'todo.md');
  fs.mkdirSync(path.dirname(todo), { recursive: true });
  fs.writeFileSync(todo, '- [ ] T-8-success: retryable bounded task\n');
  const script = path.join(process.cwd(), 'scripts', 'phase-loop-task-ledger.mjs');
  const record = (claimId, terminalType, runId) => {
    const claim = path.join(repo, `${claimId}.json`);
    fs.writeFileSync(claim, JSON.stringify({ claim_id: claimId, selected_todo: '- [ ] T-8-success: retryable bounded task' }));
    for (const type of ['todo.claimed', 'workflow.routed', terminalType]) {
      execFileSync(process.execPath, [script, 'record-trajectory', '--repo', repo, '--claim', claim, '--todo', todo, '--type', type, '--run', runId], { stdio: 'pipe' });
    }
  };
  record('claim-failed', 'todo.failed', 'run-failed');
  record('claim-completed', 'todo.completed', 'run-completed');

  const events = readTaskLedger(repo);
  const failed = taskProjection(events).get(taskAttemptId('T-8-success', 'claim-failed'));
  const completed = taskProjection(events).get(taskAttemptId('T-8-success', 'claim-completed'));
  assert.equal(failed.to_state, 'failed');
  assert.equal(completed.to_state, 'completed');
  assert.notEqual(failed.task_id, completed.task_id);
  assert.equal(validateTaskLedger(events).ok, true);
});

test('keeps duplicate routed trajectory events nonfatal while preserving the valid task state', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const claim = path.join(repo, 'claim.json');
  fs.writeFileSync(claim, JSON.stringify({ claim_id: 'claim-duplicate-route', selected_todo: '- [ ] T-duplicate-route: bounded task' }));
  assert.equal(recordTrajectory(repo, { claimPath: claim, type: 'todo.claimed', runId: 'run-duplicate' }).ok, true);
  assert.equal(recordTrajectory(repo, { claimPath: claim, type: 'workflow.routed', runId: 'run-duplicate' }).ok, true);
  const duplicate = recordTrajectory(repo, { claimPath: claim, type: 'workflow.routed', runId: 'run-duplicate' });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.code, 'duplicate_trajectory');
  assert.equal(taskProjection(readTaskLedger(repo)).get(taskAttemptId('T-duplicate-route', 'claim-duplicate-route')).to_state, 'running');
});

test('treats a same-claim continuation route as a duplicate across run ids', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const claim = path.join(repo, 'claim.json');
  fs.writeFileSync(claim, JSON.stringify({ claim_id: 'claim-continuation', selected_todo: '- [ ] T-continuation: bounded task' }));
  assert.equal(recordTrajectory(repo, { claimPath: claim, type: 'todo.claimed', runId: 'run-first' }).ok, true);
  assert.equal(recordTrajectory(repo, { claimPath: claim, type: 'workflow.routed', runId: 'run-first' }).ok, true);
  const duplicate = recordTrajectory(repo, { claimPath: claim, type: 'workflow.routed', runId: 'run-continuation' });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.code, 'duplicate_trajectory');
  assert.equal(taskProjection(readTaskLedger(repo)).get(taskAttemptId('T-continuation', 'claim-continuation')).to_state, 'running');
});

test('fails closed on an out-of-order completion after the ledger was truncated', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const claim = path.join(repo, 'claim.json');
  const ledger = path.join(repo, '.brownie/private/phase-loop/task-ledger.jsonl');
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  fs.writeFileSync(claim, JSON.stringify({ claim_id: 'claim-truncated', selected_todo: '- [ ] T-truncated: bounded task' }));
  const result = recordTrajectory(repo, { claimPath: claim, type: 'todo.completed', runId: 'run-truncated' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ledger_transition_rejected');
  assert.equal(result.rejected.code, 'task_must_start_queued');
  assert.equal(fs.existsSync(ledger), false);
});

test('fails closed on a non-duplicate out-of-order routed transition', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const claim = path.join(repo, 'claim.json');
  fs.writeFileSync(claim, JSON.stringify({ claim_id: 'claim-out-of-order', selected_todo: '- [ ] T-out-of-order: bounded task' }));
  assert.equal(appendTaskTransition(repo, { task_id: taskAttemptId('T-out-of-order', 'claim-out-of-order'), to_state: 'queued' }).ok, true);
  const result = recordTrajectory(repo, { claimPath: claim, type: 'workflow.routed', runId: 'run-out-of-order' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ledger_transition_rejected');
  assert.equal(result.rejected.code, 'invalid_task_transition');
  assert.equal(taskProjection(readTaskLedger(repo)).get(taskAttemptId('T-out-of-order', 'claim-out-of-order')).to_state, 'queued');
});

test('records an absent claim as an explicit empty task-ledger trajectory without recreating a claim', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const result = recordTrajectory(repo, {
    claimPath: path.join(repo, 'missing-claim.json'),
    todoPath: path.join(repo, '.brownie/todo.md'),
    type: 'todo.blocked',
    runId: 'run-absent',
    at: '2026-10-18T00:00:00.000Z'
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'unclaimed_empty');
  assert.equal(fs.existsSync(path.join(repo, 'missing-claim.json')), false);
  const raw = fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/task-ledger.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(raw[0], {
    schema_version: 1,
    kind: 'unclaimed_trajectory',
    event_id: raw[0].event_id,
    task_id: null,
    claim_id: null,
    trajectory_type: 'todo.blocked',
    run_id: 'run-absent',
    claim_path: path.join(repo, 'missing-claim.json'),
    claim_state: 'absent',
    error_code: 'claim_absent',
    error_message: raw[0].error_message,
    at: '2026-10-18T00:00:00.000Z'
  });
  assert.deepEqual(readTaskLedger(repo), []);
  assert.equal(appendTaskTransition(repo, { task_id: 'T-after-absent', to_state: 'queued' }).ok, true);
});

test('fails malformed claims without mutating TODO state or inventing a task attempt', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const claim = path.join(repo, 'claim.json');
  fs.writeFileSync(claim, '{not-json');
  const result = recordTrajectory(repo, {
    claimPath: claim,
    type: 'todo.claimed',
    runId: 'run-malformed'
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'claim_malformed');
  assert.deepEqual(readTaskLedger(repo), []);
  assert.match(fs.readFileSync(path.join(repo, '.brownie/private/phase-loop/task-ledger.jsonl'), 'utf8'), /"claim_state":"malformed"/u);
});

test('treats claim deletion during the read as an unclaimed race, not as a recreated claim', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const result = recordTrajectory(repo, {
    claimPath: path.join(repo, 'claim.json'),
    type: 'todo.completed',
    runId: 'run-race',
    readClaim: () => { const error = new Error('claim deleted during read'); error.code = 'ENOENT'; throw error; }
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'unclaimed_empty');
  assert.equal(fs.existsSync(path.join(repo, 'claim.json')), false);
  assert.deepEqual(readTaskLedger(repo), []);
});

test('surfaces downstream task-ledger append failures to the controller', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const ledger = path.join(repo, '.brownie/private/phase-loop/task-ledger.jsonl');
  fs.mkdirSync(ledger, { recursive: true });
  const claim = path.join(repo, 'claim.json');
  fs.writeFileSync(claim, JSON.stringify({ claim_id: 'claim-ledger-error', selected_todo: '- [ ] T-ledger-error: bounded task' }));
  const result = recordTrajectory(repo, {
    claimPath: claim,
    type: 'todo.claimed',
    runId: 'run-ledger-error'
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ledger_append_failed');
  assert.match(result.error, /directory|EISDIR|is a directory/iu);
});

test('keeps a repair-only replan nonterminal when replacement children are absent', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const todo = path.join(repo, '.brownie', 'todo.md');
  fs.mkdirSync(path.dirname(todo), { recursive: true });
  fs.writeFileSync(todo, '- [ ] T-9: bounded leaf\n');
  const claim = path.join(repo, 'claim.json');
  fs.writeFileSync(claim, JSON.stringify({ claim_id: 'claim-leaf', selected_todo: '- [ ] T-9: bounded leaf' }));
  const script = path.join(process.cwd(), 'scripts', 'phase-loop-task-ledger.mjs');
  execFileSync(process.execPath, [script, 'record-trajectory', '--repo', repo, '--claim', claim, '--todo', todo, '--type', 'todo.claimed', '--run', 'run-1'], { stdio: 'pipe' });
  execFileSync(process.execPath, [script, 'record-trajectory', '--repo', repo, '--claim', claim, '--todo', todo, '--type', 'workflow.routed', '--run', 'run-1'], { stdio: 'pipe' });
  execFileSync(process.execPath, [script, 'record-trajectory', '--repo', repo, '--claim', claim, '--todo', todo, '--type', 'todo.replanned', '--payload', '{"reason":"no_progress"}', '--run', 'run-1'], { stdio: 'pipe' });
  const attempt = taskProjection(readTaskLedger(repo)).get(taskAttemptId('T-9', 'claim-leaf'));
  assert.equal(attempt.to_state, 'running');
  execFileSync(process.execPath, [script, 'record-trajectory', '--repo', repo, '--claim', claim, '--todo', todo, '--type', 'todo.completed', '--run', 'run-1'], { stdio: 'pipe' });
  assert.equal(taskProjection(readTaskLedger(repo)).get(taskAttemptId('T-9', 'claim-leaf')).to_state, 'completed');
});

test('records restored invalid mutations as terminal failed attempts', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-task-ledger-'));
  const todo = path.join(repo, '.brownie', 'todo.md');
  fs.mkdirSync(path.dirname(todo), { recursive: true });
  fs.writeFileSync(todo, '- [ ] T-10: bounded leaf\n');
  const claim = path.join(repo, 'claim.json');
  fs.writeFileSync(claim, JSON.stringify({ claim_id: 'claim-restored-mutation', selected_todo: '- [ ] T-10: bounded leaf' }));
  const script = path.join(process.cwd(), 'scripts', 'phase-loop-task-ledger.mjs');
  for (const type of ['todo.claimed', 'workflow.routed', 'todo.failed']) {
    execFileSync(process.execPath, [script, 'record-trajectory', '--repo', repo, '--claim', claim, '--todo', todo, '--type', type, '--run', 'run-1'], { stdio: 'pipe' });
  }
  const attempt = taskProjection(readTaskLedger(repo)).get(taskAttemptId('T-10', 'claim-restored-mutation'));
  assert.equal(attempt.to_state, 'failed');
  assert.equal(attempt.reason, 'trajectory_failed');

  const retryClaim = path.join(repo, 'retry-claim.json');
  fs.writeFileSync(retryClaim, JSON.stringify({ claim_id: 'claim-restored-mutation-r1', selected_todo: '- [ ] T-10: bounded leaf' }));
  for (const type of ['todo.claimed', 'workflow.routed', 'todo.completed']) {
    execFileSync(process.execPath, [script, 'record-trajectory', '--repo', repo, '--claim', retryClaim, '--todo', todo, '--type', type, '--run', 'run-2'], { stdio: 'pipe' });
  }
  assert.equal(taskProjection(readTaskLedger(repo)).get(taskAttemptId('T-10', 'claim-restored-mutation-r1')).to_state, 'completed');
});
