import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { appendTaskTransition, readTaskLedger, replanTaskWithChildren, taskAttemptId, taskIsExecutable, taskProjection, validateTaskLedger } from './phase-loop-task-ledger.mjs';

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
