import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { appendTaskTransition, readTaskLedger, taskIsExecutable, taskProjection } from './phase-loop-task-ledger.mjs';

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
