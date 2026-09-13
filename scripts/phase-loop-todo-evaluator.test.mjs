import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { evaluateTodoQueue, selectFirstSchedulableTodo } from './phase-loop-todo-evaluator.mjs';

const childFirstQueue = `- [ ] E-15-child: Patch only \`scripts/child.mjs\`:
  Route: implementation.
  Source TODO: E-15.
  Depends on: E-15-parent.
  Completion condition: the child change is implemented after the parent is complete.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root check\`.
- [ ] E-15-parent: Patch only \`scripts/parent.mjs\`:
  Route: implementation.
  Source TODO: E-15.
  Depends on: <none>.
  Completion condition: the parent change is implemented before child work starts.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root check\`.`;

test('selects dependency-ready parent before pending child', () => {
  const selected = selectFirstSchedulableTodo(childFirstQueue);

  assert(selected.startsWith('- [ ] E-15-parent:'), selected);
});

test('evaluation includes selected id and score', () => {
  const result = evaluateTodoQueue(childFirstQueue);

  assert.equal(result.selected_todo_id, 'E-15-parent');
  assert(result.decomposition_score.score_percent > 0, result);
});

test('does not select a child whose dependency is blocked', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-todo-evaluator-'));
  const blocked = path.join(dir, 'blocked.jsonl');
  const parentBlock = selectFirstSchedulableTodo(childFirstQueue);
  const hash = createHash('sha256').update(parentBlock).digest('hex');
  const queueHash = createHash('sha256').update(childFirstQueue).digest('hex');
  fs.writeFileSync(blocked, `${JSON.stringify({
    queue_fingerprint: queueHash,
    selected_todo_sha256: hash,
    selected_todo_first_line: parentBlock.split('\n')[0]
  })}\n`);

  const selected = selectFirstSchedulableTodo(childFirstQueue, { blockedPath: blocked });

  assert.equal(selected, '');
});

test('skips superseded broad parent when derived leaves exist for the same prefix', () => {
  const text = `- [ ] E-15a-runtime-operational-evidence-redaction: Fix all runtime evidence redaction work.
- [ ] E-15a-redaction-collector: Patch only \`scripts/release-runtime-operational-evidence.mjs\`:
  Route: implementation.
  Source TODO: TODO-decompose-blocked-queue-abc.
  Depends on: <none>.
  Completion condition: runtime operational evidence stores only bounded non-sensitive summaries.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root guard:runtime-operational-evidence:test\`.`;

  const selected = selectFirstSchedulableTodo(text);

  assert(selected.startsWith('- [ ] E-15a-redaction-collector:'), selected);
});
