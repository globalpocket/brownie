import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { appendTaskTransition, readTaskLedger, recordTerminalFailureRecovery, recordTrajectory, replanTaskWithChildren, taskAttemptId, taskIsExecutable, taskProjection, validateTaskLedger } from './phase-loop-task-ledger.mjs';

function terminalEvidence(selectedTodo, claimId) {
  return {
    kind: 'phase_loop_terminal_failure_execution_evidence',
    task_execution_confirmed: true,
    claim_id: claimId,
    selected_todo_sha256: crypto.createHash('sha256').update(selectedTodo).digest('hex')
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
