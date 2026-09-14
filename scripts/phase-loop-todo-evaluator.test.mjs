import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  evaluateTodoQueue,
  isExplicitBlockerTodo,
  needsTodoDecomposition,
  selectFirstSchedulableTodo
} from './phase-loop-todo-evaluator.mjs';

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

test('ignores blocked first lines from stale queue fingerprints', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-todo-evaluator-'));
  const blocked = path.join(dir, 'blocked.jsonl');
  const parentBlock = selectFirstSchedulableTodo(childFirstQueue);
  const staleQueueHash = createHash('sha256').update(`${childFirstQueue}\nchanged`).digest('hex');
  fs.writeFileSync(blocked, `${JSON.stringify({
    queue_fingerprint: staleQueueHash,
    selected_todo_sha256: createHash('sha256').update(parentBlock).digest('hex'),
    selected_todo_first_line: parentBlock.split('\n')[0]
  })}\n`);

  const selected = selectFirstSchedulableTodo(childFirstQueue, { blockedPath: blocked });

  assert(selected.startsWith('- [ ] E-15-parent:'), selected);
});

test('skips previously blocked generated leaf ids across queue fingerprints', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-todo-evaluator-'));
  const blocked = path.join(dir, 'blocked.jsonl');
  const queue = `- [ ] E-15e-release-contract-audit-phase-resync-doc-sync-leaf: Patch only \`docs/architecture/runtime-release-contract.json\` to resynchronize one release contract field:
  Route: documentation.
  Source TODO: TODO-decompose-broad-todo-fbbca34905ac.
  Depends on: <none>.
  Completion condition: one release contract field is synchronized while release readiness remains fail-closed.
  Forbidden changes: do not mark runtime_release_ready true.
  Verification: run \`pnpm --workspace-root guard:release-contract\`.
- [ ] E-15f-next: Patch only \`scripts/guard-release-contract.mjs\`:
  Route: implementation.
  Source TODO: E-15f.
  Depends on: <none>.
  Completion condition: the next implementation leaf is selected after blocked generated leaf ids.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root guard:release-contract:test\`.`;
  fs.writeFileSync(blocked, `${JSON.stringify({
    queue_fingerprint: createHash('sha256').update(`${queue}\nchanged`).digest('hex'),
    selected_todo_sha256: createHash('sha256').update('historical-version').digest('hex'),
    selected_todo_first_line: '- [ ] E-15e-release-contract-audit-phase-resync-doc-sync-leaf: Patch only `docs/architecture/runtime-release-contract.json` to resynchronize one release contract field:'
  })}\n`);

  const selected = selectFirstSchedulableTodo(queue, { blockedPath: blocked });

  assert(selected.startsWith('- [ ] E-15f-next:'), selected);
});

test('skips broad parent after a generated leaf for the same product prefix was blocked', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-todo-evaluator-'));
  const blocked = path.join(dir, 'blocked.jsonl');
  const queue = `- [ ] E-15e-release-contract-audit-phase-resync: Resynchronize Release Contract and Audit.
  Route: documentation.
  Depends on: <none>.
  Completion condition: release documents are synchronized while release readiness remains fail-closed.
  Forbidden changes: do not mark release ready.
  Verification: run \`pnpm --workspace-root guard:release-contract\`.
- [ ] E-15f-next: Patch only \`scripts/guard-release-contract.mjs\`:
  Route: implementation.
  Source TODO: E-15f.
  Depends on: <none>.
  Completion condition: the next implementation leaf is selected after blocked parent prefix.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root guard:release-contract:test\`.`;
  fs.writeFileSync(blocked, `${JSON.stringify({
    queue_fingerprint: createHash('sha256').update(`${queue}\nchanged`).digest('hex'),
    selected_todo_sha256: createHash('sha256').update('historical-version').digest('hex'),
    selected_todo_first_line: '- [ ] E-15e-release-contract-audit-phase-resync-doc-sync-leaf: Patch only `docs/architecture/runtime-release-contract.json` to resynchronize one release contract field:'
  })}\n`);

  const selected = selectFirstSchedulableTodo(queue, { blockedPath: blocked });

  assert(selected.startsWith('- [ ] E-15f-next:'), selected);
});

test('falls back to blocked-prefix parent for redecomposition when no other work is schedulable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-todo-evaluator-'));
  const blocked = path.join(dir, 'blocked.jsonl');
  const queue = `- [ ] E-15e-release-contract-audit-phase-resync: Resynchronize Release
  Contract, Release Readiness Audit, Phase Manifest, and final judgment after
  E-15a through E-15d:
  Route: release-judgment/resync. Source concern: release documents must accurately reflect current evidence.
  Depends on: E-15d-soak-section-guard.
  Completion condition: release contract, audit, phase manifest, and final judgment agree with current evidence.
  Forbidden changes: do not mark runtime_release_ready true.
  Verification: run \`pnpm --workspace-root guard:release-contract\`.`;
  fs.writeFileSync(blocked, `${JSON.stringify({
    queue_fingerprint: createHash('sha256').update(`${queue}\nchanged`).digest('hex'),
    selected_todo_sha256: createHash('sha256').update('historical-version').digest('hex'),
    selected_todo_first_line: '- [ ] E-15e-release-contract-audit-phase-resync-doc-sync-leaf: Patch only `docs/architecture/runtime-release-contract.json` to resynchronize one release contract field:'
  })}\n`);

  const selected = selectFirstSchedulableTodo(queue, { blockedPath: blocked });

  assert(selected.startsWith('- [ ] E-15e-release-contract-audit-phase-resync:'), selected);
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

test('marks broad unbounded TODO for Brownie-owned decomposition', () => {
  const broad = `- [ ] E-15d-runtime-soak-evidence-stateful: Replace version-only soak with stateful Runtime soak evidence:
  Route: implementation.
  Source concern: repeating brownie --version does not prove durability.
  Define evidence for task transitions, Ledger/workspace consistency, resume/replay,
  duplicate side effects, process loss, Mode Pack/LLM/MCP paths, and convergence.
  Verification: run \`pnpm --workspace-root check\`.`;

  const result = needsTodoDecomposition(broad);

  assert.equal(result.needs_decomposition, true, result);
});

test('does not mark bounded derived leaf for decomposition', () => {
  const result = needsTodoDecomposition(childFirstQueue.split('\n- [ ] E-15-parent:')[0]);

  assert.equal(result.needs_decomposition, false, result);
});

test('recognizes explicit owner-controlled blocker TODOs without decomposition', () => {
  const blocker = `- [ ] E-15e-doc-sync-blocker: Blocker: missing owner-controlled independent review evidence for Release workflow, permission model, Ledger Contract, Mode Pack trust boundary, signing/provenance, and Release Ready判定ロジック.
  Route: documentation.
  Depends on: E-15e-release-contract-audit-phase-resync-doc-sync-leaf.
  Completion condition: all six independent human reviews are completed and recorded.
  Forbidden changes: do not patch runtime-release-contract.json until all reviews are complete.
  Verification: blocker: exact missing evidence or field is named, and no workspace file is patched until that evidence is available.`;

  assert.equal(isExplicitBlockerTodo(blocker), true);
  assert.deepEqual(needsTodoDecomposition(blocker), {
    needs_decomposition: false,
    reason: 'explicit_blocker_todo'
  });
});

test('blocked owner-controlled blocker does not suppress sibling implementation parent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-todo-evaluator-'));
  const blocked = path.join(dir, 'blocked.jsonl');
  const queue = `- [ ] E-15e-doc-sync-blocker: Blocker: missing owner-controlled independent review evidence for Release workflow, permission model, Ledger Contract, Mode Pack trust boundary, signing/provenance, and Release Ready判定ロジック.
  Route: documentation.
  Depends on: E-15e-release-contract-audit-phase-resync-doc-sync-leaf.
  Completion condition: all six independent human reviews are completed and recorded.
  Forbidden changes: do not patch runtime-release-contract.json until all reviews are complete.
  Verification: blocker: exact missing evidence or field is named, and no workspace file is patched until that evidence is available.

- [ ] E-15e-release-contract-audit-phase-resync: Resynchronize Release Contract, Release Readiness Audit, Phase Manifest, and final judgment after E-15a through E-15d:
  Route: release-judgment/resync.
  Depends on: E-15d-soak-section-guard.
  Completion condition: release documents agree with current evidence while release readiness remains fail-closed.
  Forbidden changes: do not mark runtime_release_ready true.
  Verification: run \`pnpm --workspace-root guard:release-contract\`.`;
  fs.writeFileSync(blocked, `${JSON.stringify({
    queue_fingerprint: createHash('sha256').update(`${queue}\nchanged`).digest('hex'),
    selected_todo_sha256: createHash('sha256').update('historical-blocker').digest('hex'),
    selected_todo_first_line: '- [ ] E-15e-doc-sync-blocker: Blocker: missing owner-controlled independent review evidence for Release workflow, permission model, Ledger Contract, Mode Pack trust boundary, signing/provenance, and Release Ready判定ロジック.'
  })}\n`);

  const selected = selectFirstSchedulableTodo(queue, { blockedPath: blocked });

  assert(selected.startsWith('- [ ] E-15e-release-contract-audit-phase-resync:'), selected);
});

test('does not classify bounded implementation TODOs mentioning blockers as explicit blockers', () => {
  const implementation = `- [ ] E-15f-semantic-consistency-guard: Patch only \`scripts/guard-release-contract.mjs\`:
  Route: implementation.
  Source TODO: E-15f.
  Depends on: <none>.
  Completion condition: the guard fails when blocker evidence contradicts the release contract.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root guard:release-contract:test\`.`;

  assert.equal(isExplicitBlockerTodo(implementation), false);
});

test('evaluation exposes selected TODO decomposition decision', () => {
  const broadQueue = `- [ ] E-15d-runtime-soak-evidence-stateful: Replace version-only soak with stateful Runtime soak evidence:
  Route: implementation.
  Source concern: this is intentionally broad and has no Patch only scope.
  Define task transitions, ledger consistency, resume/replay, duplicate side effects, process loss, and finite convergence evidence.
  Verification: run \`pnpm --workspace-root check\`.`;
  const result = evaluateTodoQueue(broadQueue);

  assert.equal(result.selected_todo_id, 'E-15d-runtime-soak-evidence-stateful');
  assert.equal(result.selected_todo_needs_decomposition, true, result);
});

test('selects queued decomposition request when it is first in queue order', () => {
  const text = `- [ ] TODO-decompose-broad-todo-abc123: Decompose broad TODO \`E-99-broad\` into implementable leaf TODOs:
  Route: todo-decomposition. Source: selected TODO hash \`abc123\` needs Brownie-owned decomposition.`;

  const selected = selectFirstSchedulableTodo(text);

  assert(selected.startsWith('- [ ] TODO-decompose-broad-todo-abc123:'), selected);
});

test('selects queued blocked-queue decomposition before the blocked parent that produced it', () => {
  const text = `- [ ] R-09: blocked boundary task

- [ ] TODO-decompose-blocked-queue-abc123: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs:
  Route: todo-decomposition. Source: every unchecked item in \`.brownie/todo.md\`
  for queue fingerprint \`abc123\` is recorded as blocked.`;

  const selected = selectFirstSchedulableTodo(text);

  assert(selected.startsWith('- [ ] TODO-decompose-blocked-queue-abc123:'), selected);
});

test('does not let later decomposition requests jump ahead of ready leaf TODOs', () => {
  const text = `- [ ] E-15d-soak-section-collector: Patch only \`scripts/release-runtime-operational-evidence.mjs\`:
  Route: implementation.
  Source TODO: E-15d-runtime-soak-evidence-stateful.
  Depends on: <none>.
  Completion condition: generated runtime operational evidence has a satisfied soak_test section.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root guard:runtime-operational-evidence:test\`.
- [ ] TODO-decompose-broad-todo-abc123: Decompose broad TODO \`E-15g-pr435-stale-phase-loop-pr-hygiene\` into implementable leaf TODOs:
  Route: todo-decomposition. Source: selected TODO hash \`abc123\` needs Brownie-owned decomposition.`;

  const selected = selectFirstSchedulableTodo(text);

  assert(selected.startsWith('- [ ] E-15d-soak-section-collector:'), selected);
});
