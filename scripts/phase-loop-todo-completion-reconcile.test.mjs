import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { reconcileCompletedTodoProjection } from './phase-loop-todo-completion-reconcile.mjs';

const todoId = 'E-completed-projection';
const todo = `- [ ] ${todoId}: preserve the contract\n  - Route: implement\n  - Depends on: <none>.\n`;

function durableCompletion(claimId = 'claim-1', selectedTodo = todo) {
  const selectedHash = createHash('sha256').update(selectedTodo.trimEnd()).digest('hex');
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

for (const [completedMarker, checkedMarker] of [
  ['- [ ]', '- [x]'], ['- [ ]', '- [X]'], ['- [ ]', '* [x]'],
  ['- [ ]', '* [X]'], ['- [ ]', '1. [x]'], ['- [ ]', '2) [X]'],
  ['* [ ]', '- [x]'], ['1. [ ]', '- [x]']
]) {
  test(`completion projection preserves an adjacent checked block: ${completedMarker}, ${checkedMarker}`, (t) => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-completion-boundary-'));
    t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
    const receipts = path.join(repo, '.brownie/private/phase-loop/todo-completions');
    fs.mkdirSync(receipts, { recursive: true });
    const completed = todo.replace('- [ ]', completedMarker);
    const checked = `${checkedMarker} E-preserve-B: retain this complete contract\n  - Depends on: <none>.\n  Retained evidence: original bytes.\n`;
    const pending = '- [ ] E-preserve-C: retain this active contract\n  - Depends on: <none>.\n';
    const before = `${completed}\n${checked}\n${pending}`;
    const todoFile = path.join(repo, '.brownie/todo.md');
    fs.writeFileSync(todoFile, before);
    fs.writeFileSync(path.join(receipts, 'receipt.json'), JSON.stringify(durableCompletion('claim-1', completed)));

    const result = reconcileCompletedTodoProjection({ repoRoot: repo, runStamp: 'boundary-fixture' });

    assert.equal(result.applied, true, JSON.stringify(result));
    assert.deepEqual(result.completed_todo_ids, [todoId]);
    assert.equal(fs.readFileSync(todoFile, 'utf8'), `\n${checked}\n${pending}`);
    assert.equal(fs.readFileSync(path.join(repo, result.recovery_path, 'todo.before.md'), 'utf8'), before);
    const replay = reconcileCompletedTodoProjection({ repoRoot: repo });
    assert.equal(replay.applied, false);
    assert.equal(fs.readFileSync(todoFile, 'utf8'), `\n${checked}\n${pending}`);
  });
}

test('completion projection removes the selected span without replacing an earlier text occurrence', (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-completion-span-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const receipts = path.join(repo, '.brownie/private/phase-loop/todo-completions');
  fs.mkdirSync(receipts, { recursive: true });
  const retained = `- [x] E-preserve-history: retain the original text\n  Original first line was indented:\n    ${todo}\n`;
  const todoFile = path.join(repo, '.brownie/todo.md');
  fs.writeFileSync(todoFile, retained + todo);
  fs.writeFileSync(path.join(receipts, 'receipt.json'), JSON.stringify(durableCompletion()));

  const result = reconcileCompletedTodoProjection({ repoRoot: repo });

  assert.equal(result.applied, true, JSON.stringify(result));
  assert.deepEqual(result.completed_todo_ids, [todoId]);
  assert.equal(fs.readFileSync(todoFile, 'utf8'), retained);
});

for (const eol of ['\n', '\r\n']) {
  test(`an exact same-ID completion consumes only its matching physical contract with ${JSON.stringify(eol)}`, (t) => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-exact-specification-'));
    t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
    const directory = path.join(repo, '.brownie/private/phase-loop/todo-completions');
    fs.mkdirSync(directory, { recursive: true });
    const selected = todo.replaceAll('\n', eol);
    const receipt = path.join(directory, 'receipt.json');
    const originalReceipt = JSON.stringify(durableCompletion('claim-exact-eol', selected));
    fs.writeFileSync(receipt, originalReceipt);
    const retained = `- [ ] E-dependent: remains in the queue${eol}  Depends on: ${todoId}.${eol}`;
    const queue = path.join(repo, '.brownie/todo.md');
    fs.writeFileSync(queue, selected + retained);
    const result = reconcileCompletedTodoProjection({ repoRoot: repo });
    assert.equal(result.applied, true);
    assert.deepEqual(result.completed_todo_ids, [todoId]);
    assert.equal(fs.readFileSync(queue, 'utf8'), retained);
    assert.equal(fs.readFileSync(receipt, 'utf8'), originalReceipt);
  });

  test(`stale same-ID completion preserves the changed physical queue and receipt with ${JSON.stringify(eol)}`, (t) => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-stale-specification-'));
    t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
    const directory = path.join(repo, '.brownie/private/phase-loop/todo-completions');
    fs.mkdirSync(directory, { recursive: true });
    const receipt = path.join(directory, 'receipt.json');
    const record = durableCompletion();
    const rawReceipt = JSON.stringify(record);
    fs.writeFileSync(receipt, rawReceipt);
    const replacement = todo.replace('preserve the contract', 'implement different behavior').replaceAll('\n', eol);
    const queue = path.join(repo, '.brownie/todo.md');
    const before = `${replacement}${eol}- [ ] E-dependent: must stay pending${eol}  Depends on: ${todoId}.${eol}`;
    fs.writeFileSync(queue, before);
    const result = reconcileCompletedTodoProjection({ repoRoot: repo });
    assert.equal(result.applied, false);
    assert.equal(fs.readFileSync(queue, 'utf8'), before);
    assert.equal(fs.readFileSync(receipt, 'utf8'), rawReceipt);
    assert.equal(fs.existsSync(path.join(repo, '.brownie/private/phase-loop/todo-claims/completion-projections')), false);
  });
}
