import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { reconcileCompletedTodoProjection } from './phase-loop-todo-completion-reconcile.mjs';

const todoId = 'E-completed-projection';
const todo = `- [ ] ${todoId}: preserve the contract\n  - Route: implement\n  - Depends on: <none>.\n`;

function durableCompletion(claimId = 'claim-1') {
  const selectedHash = 'a'.repeat(64);
  return {
    schema_version: 2,
    claim_id: claimId,
    root_claim_id: claimId,
    selected_todo_id: todoId,
    selected_todo_sha256: selectedHash,
    delivery_receipt: {
      schema_version: 1,
      claim_id: claimId,
      root_claim_id: claimId,
      selected_todo_sha256: selectedHash,
      author: 'implementation',
      reviewer: 'review',
      merge_actor: 'review',
      approved: true,
      ci_passed: true,
      merged: true,
      semantic_completion_evidence: {
        schema_version: 1,
        root_claim_id: claimId,
        selected_todo_sha256: selectedHash,
        completion_condition_sha256: 'b'.repeat(64),
        verification_results: [{ command: 'node --test fixture.mjs', exit_code: 0 }],
        observables: [{ kind: 'fixture', sha256: 'c'.repeat(64) }]
      }
    }
  };
}

test('archives only a non-invalidated durable completion from the live queue with rollback evidence', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-completion-projection-'));
  fs.mkdirSync(path.join(repo, '.brownie/private/phase-loop/todo-completions'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), todo);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/todo-completions/receipt.json'), JSON.stringify(durableCompletion()));
  const result = reconcileCompletedTodoProjection({ repoRoot: repo, runStamp: 'run-fixture' });
  assert.equal(result.applied, true, JSON.stringify(result));
  assert.deepEqual(result.completed_todo_ids, [todoId]);
  assert.doesNotMatch(fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8'), /E-completed-projection/);
  assert.equal(fs.existsSync(path.join(repo, result.recovery_path, 'todo.before.md')), true);
});

test('does not project a completion that has an exact durable invalidation', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-completion-projection-invalidated-'));
  fs.mkdirSync(path.join(repo, '.brownie/private/phase-loop/todo-completions'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.brownie/private/phase-loop/todo-completion-invalidations'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), todo);
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/todo-completions/receipt.json'), JSON.stringify(durableCompletion()));
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/todo-completion-invalidations/invalidation.json'), JSON.stringify({ record_type: 'todo_completion_invalidation', selected_todo_id: todoId, invalidated_completion_claim_id: 'claim-1', reason: 'fixture' }));
  const result = reconcileCompletedTodoProjection({ repoRoot: repo });
  assert.equal(result.applied, false);
  assert.equal(result.reason, 'no_completed_todo_projection_drift');
  assert.match(fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8'), /- \[ \] E-completed-projection/);
});

test('does not project a live TODO from an invalid completion receipt', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-completion-projection-unverified-'));
  fs.mkdirSync(path.join(repo, '.brownie/private/phase-loop/todo-completions'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), todo);
  const invalid = durableCompletion();
  invalid.delivery_receipt.reviewer = invalid.delivery_receipt.author;
  invalid.delivery_receipt.merge_actor = invalid.delivery_receipt.author;
  fs.writeFileSync(path.join(repo, '.brownie/private/phase-loop/todo-completions/receipt.json'), JSON.stringify(invalid));

  const result = reconcileCompletedTodoProjection({ repoRoot: repo });

  assert.equal(result.applied, false);
  assert.equal(result.reason, 'no_completed_todo_projection_drift');
  assert.match(fs.readFileSync(path.join(repo, '.brownie/todo.md'), 'utf8'), /- \[ \] E-completed-projection/);
});
