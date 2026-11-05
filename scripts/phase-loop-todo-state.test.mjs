import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  durableCompletionRecordReceipt,
  readTodoCompletionRecords,
  readTrackedBreakdownReplanRecords,
  resolveTodoState
} from './phase-loop-todo-state.mjs';

const parent = `- [x] E-parent: Parent split anchor:
  Route: implementation.
  Source TODO: review.
  Depends on: <none>.`;
const childOne = `- [ ] E-child-1: Patch only \`scripts/a.mjs\`:
  Route: implementation.
  Source TODO: E-parent.
  Depends on: <none>.`;
const childTwo = `- [ ] E-child-2: Patch only \`scripts/b.mjs\`:
  Route: implementation.
  Source TODO: E-parent.
  Depends on: E-child-1.`;
const replan = {
  record_type: 'todo_replan',
  operation: 'split_parent_into_children',
  parent_status: 'superseded_by_children',
  parent_todo_id: 'E-parent',
  generated_child_ids: ['E-child-1', 'E-child-2']
};

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function orphanedParentResolutionFixture({ invalidBinding = false, unsafeChild = false, invalidProof = false } = {}) {
  const parentBlock = `- [ ] E-orphaned-parent: Patch only \`scripts/orphaned.mjs\`:
  Route: implementation.
  Depends on: <none>.
  Completion condition: exact merged delivery is reverified before resolution.
  Forbidden changes: do not treat a split as completion.
  Verification: run \`node --check scripts/orphaned.mjs\`.`;
  const parentId = 'E-orphaned-parent';
  const claimId = 'claim-orphaned-parent';
  const selectedHash = sha256(parentBlock);
  const conditionHash = sha256('exact merged delivery is reverified before resolution.');
  const proof = {
    schema_version: 1,
    kind: 'phase_loop_merged_delivery_reverification',
    claim_id: claimId,
    root_claim_id: claimId,
    selected_todo_id: parentId,
    selected_todo_sha256: selectedHash,
    completion_condition_sha256: conditionHash,
    queue_fingerprint: 'd'.repeat(64),
    queue_generation: 23,
    runtime: { claim_id: claimId, status: invalidProof ? 'failed' : 'task_executed', executed_count: 1 },
    git: { merge_commit_oid: 'a'.repeat(40), first_parent_oid: 'b'.repeat(40), head_oid: 'c'.repeat(40), targets: [{ path: 'scripts/orphaned.mjs', sha256: 'd'.repeat(64) }] },
    task_spec_binding: { kind: 'commit_trailer', todo_id: parentId, selected_todo_sha256: selectedHash, head_oid: 'c'.repeat(40) },
    review: { state: 'MERGED', pr_url: 'https://example.invalid/pull/23', merge_commit_oid: 'a'.repeat(40), head_oid: 'c'.repeat(40), author: 'implementation', reviewer: 'review', merge_actor: 'review', merged_at: '2026-11-05T00:00:00Z', observed_at: '2026-11-05T00:01:00Z', approved: true, ci_passed: true, latest_reviewer_review_state: 'APPROVED', latest_reviewer_review_commit_oid: 'c'.repeat(40) },
    verification_results: [{ command: 'node --check scripts/orphaned.mjs', exit_code: 0 }]
  };
  const completion = {
    schema_version: 3,
    claim_id: claimId,
    root_claim_id: claimId,
    selected_todo_id: parentId,
    selected_todo: parentBlock,
    selected_todo_sha256: selectedHash,
    queue_fingerprint: 'd'.repeat(64),
    queue_generation: 23,
    delivery_receipt: {
      schema_version: 1,
      claim_id: claimId,
      root_claim_id: claimId,
      selected_todo_sha256: selectedHash,
      author: 'implementation', reviewer: 'review', merge_actor: 'review', approved: true, ci_passed: true, merged: true,
      merged_delivery_reverification: proof
    }
  };
  const children = ['E-orphaned-parent-target-01', 'E-orphaned-parent-target-02'];
  const resolution = {
    schema_version: 1,
    record_type: 'superseded_parent_clean_merged_delivery_resolution',
    reason: 'orphaned_superseded_parent_clean_merged_delivery_reverified',
    parent_todo_id: parentId,
    parent_todo_sha256: selectedHash,
    generated_child_ids: children,
    claim_id: claimId,
    root_claim_id: claimId,
    completion_record_sha256: sha256(JSON.stringify(completion)),
    candidate: {
      selected_todo_id: invalidBinding ? 'E-other' : parentId,
      selected_todo_sha256: selectedHash,
      merge_commit_oid: 'a'.repeat(40), first_parent_oid: 'b'.repeat(40), head_oid: 'c'.repeat(40),
      task_spec_binding: { kind: 'commit_trailer', todo_id: parentId, selected_todo_sha256: selectedHash, head_oid: 'c'.repeat(40) }
    }
  };
  const replanRecord = { ...replan, parent_todo_id: parentId, generated_child_ids: children };
  const child = unsafeChild ? `\n\n- [ ] ${children[0]}: retained child blocks recovery.` : '';
  const dependent = `\n\n- [ ] E-orphaned-dependent: Patch only \`scripts/dependent.mjs\`:\n  Route: implementation.\n  Depends on: ${parentId}.`;
  return { todoText: `${parentBlock}${child}${dependent}`, completion, resolution, replanRecord, parentId };
}

test('Source TODO is lineage and never inherits completion', () => {
  const state = resolveTodoState({ todoText: `${parent}\n\n${childOne}\n` });

  assert(state.completedIds.has('E-parent'));
  assert(!state.completedIds.has('E-child-1'));
});

test('superseded parent is not completed or dependency-resolved while children remain pending', () => {
  const state = resolveTodoState({
    todoText: `${parent}\n\n${childOne}\n\n${childTwo}\n`,
    replanRecords: [replan],
    completionRecords: [{
      selected_todo_id: 'E-child-1',
      reason: 'source_parent_completed',
      source_todo_id: 'E-parent'
    }]
  });

  assert(state.supersededIds.has('E-parent'));
  assert(!state.completedIds.has('E-parent'));
  assert(!state.resolvedIds.has('E-parent'));
  assert(!state.completedIds.has('E-child-1'));
  assert.equal(state.invalidatedCompletionRecords.length, 1);
});

test('superseded parent resolves only after every generated child completes', () => {
  const state = resolveTodoState({
    todoText: parent,
    replanRecords: [replan],
    completionRecords: [
      { selected_todo_id: 'E-child-1', reason: 'verified_completion' },
      { selected_todo_id: 'E-child-2', reason: 'verified_completion' }
    ]
  });

  assert(state.supersededIds.has('E-parent'));
  assert(!state.completedIds.has('E-parent'));
  assert(state.resolvedIds.has('E-parent'));
});

test('an exact durable merged-delivery supersession resolution consumes only its orphaned parent and unblocks its dependent', () => {
  const fixture = orphanedParentResolutionFixture();
  const state = resolveTodoState({
    todoText: fixture.todoText,
    replanRecords: [fixture.replanRecord],
    completionRecords: [fixture.completion],
    supersessionResolutionRecords: [fixture.resolution]
  });

  assert(state.completedIds.has(fixture.parentId));
  assert(state.resolvedIds.has(fixture.parentId));
  assert(state.supersessionResolvedIds.has(fixture.parentId));
  assert.equal(state.invalidatedCompletionRecords.length, 0);
});

test('a missing exact binding, invalid runtime proof, or live child cannot resolve an orphaned superseded parent', () => {
  for (const options of [{ invalidBinding: true }, { invalidProof: true }, { unsafeChild: true }]) {
    const fixture = orphanedParentResolutionFixture(options);
    const state = resolveTodoState({
      todoText: fixture.todoText,
      replanRecords: [fixture.replanRecord],
      completionRecords: [fixture.completion],
      supersessionResolutionRecords: [fixture.resolution]
    });
    assert(!state.resolvedIds.has(fixture.parentId), JSON.stringify({ options, summary: [...state.completedIds] }));
    assert(!state.supersessionResolvedIds.has(fixture.parentId));
  }
});

test('an exact durable invalidation retracts only its matching completion receipt', () => {
  const state = resolveTodoState({
    todoText: childOne,
    completionRecords: [
      { claim_id: 'claim-invalidated', selected_todo_id: 'E-child-1', reason: 'verified_completion' },
      { claim_id: 'claim-retained', selected_todo_id: 'E-child-1', reason: 'verified_completion' }
    ],
    completionInvalidationRecords: [{
      record_type: 'todo_completion_invalidation',
      selected_todo_id: 'E-child-1',
      invalidated_completion_claim_id: 'claim-invalidated',
      reason: 'dirty_target_automatic_apply_reverted'
    }]
  });

  assert(state.completedIds.has('E-child-1'));
  assert.equal(state.invalidatedCompletionRecords.length, 1);
});

test('an invalidation retracts a false completion when it is the only receipt', () => {
  const state = resolveTodoState({
    todoText: childOne,
    completionRecords: [{ claim_id: 'claim-false', selected_todo_id: 'E-child-1', reason: 'verified_completion' }],
    completionInvalidationRecords: [{
      record_type: 'todo_completion_invalidation',
      selected_todo_id: 'E-child-1',
      invalidated_completion_claim_id: 'claim-false',
      reason: 'dirty_target_automatic_apply_reverted'
    }]
  });

  assert(!state.completedIds.has('E-child-1'));
  assert.equal(state.invalidatedCompletionRecords.length, 1);
});

test('an absent dependency backed only by a legacy completion record remains identifiable for recovery', () => {
  const state = resolveTodoState({
    todoText: `- [ ] E-dependent: blocked by historical prerequisite.
  Depends on: E-erased.
`,
    completionRecords: [{
      schema_version: 1,
      claim_id: 'legacy-claim',
      selected_todo_id: 'E-erased'
    }]
  });

  assert(state.completedIds.has('E-erased'));
  assert(state.unverifiedArchivedCompletionIds.has('E-erased'));
  assert.equal(state.unverifiedCompletionRecords[0]?.reason, 'legacy_completion_record_without_delivery_receipt');
});

test('a schema-v2 completion requires an internally consistent durable review receipt', () => {
  const record = {
    schema_version: 2,
    claim_id: 'claim-verified',
    root_claim_id: 'claim-verified',
    selected_todo_id: 'E-verified',
    selected_todo_sha256: 'a'.repeat(64),
    delivery_receipt: {
      schema_version: 1,
      claim_id: 'claim-verified',
      root_claim_id: 'claim-verified',
      selected_todo_sha256: 'a'.repeat(64),
      author: 'brownie-agent',
      reviewer: 'globalpocket',
      merge_actor: 'globalpocket',
      approved: true,
      ci_passed: true,
      merged: true,
      semantic_completion_evidence: {
        schema_version: 1,
        root_claim_id: 'claim-verified',
        selected_todo_sha256: 'a'.repeat(64),
        completion_condition_sha256: 'b'.repeat(64),
        verification_results: [{ command: 'node --test fixture.mjs', exit_code: 0 }],
        observables: [{ kind: 'fixture', sha256: 'c'.repeat(64) }]
      }
    }
  };
  assert.equal(durableCompletionRecordReceipt(record).valid, true);
  assert.equal(durableCompletionRecordReceipt({ ...record, delivery_receipt: { ...record.delivery_receipt, merged: false } }).valid, false);
});

test('claim-id and run-stamp aliases do not duplicate one logical completion receipt', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-todo-completion-alias-'));
  const directory = path.join(repoRoot, '.brownie/private/phase-loop/todo-completions');
  fs.mkdirSync(directory, { recursive: true });
  const record = { schema_version: 1, claim_id: 'claim-alias', selected_todo_id: 'E-alias' };
  fs.writeFileSync(path.join(directory, 'claim-alias.json'), JSON.stringify(record));
  fs.writeFileSync(path.join(directory, 'run-stamp.json'), JSON.stringify(record));
  assert.equal(readTodoCompletionRecords(repoRoot).length, 1);
});

test('a generated child cannot belong to multiple superseded parents', () => {
  const state = resolveTodoState({
    todoText: `${parent}\n\n${childOne}\n`,
    replanRecords: [
      replan,
      { ...replan, parent_todo_id: 'E-other-parent', generated_child_ids: ['E-child-1'] }
    ]
  });

  assert(state.errors.some((error) => error.code === 'todo_child_has_multiple_parents'));
});

test('an orphaned historical child warns without resolving its parent or stopping unrelated work', () => {
  const state = resolveTodoState({
    todoText: '- [ ] E-24-unrelated: independent work',
    replanRecords: [{
      ...replan,
      parent_todo_id: 'E-23-parent',
      generated_child_ids: ['E-23-missing-child']
    }]
  });

  assert.deepEqual(state.errors, []);
  assert.equal(state.warnings[0]?.code, 'superseded_parent_child_has_no_live_or_terminal_state');
  assert.equal(state.resolvedIds.has('E-23-parent'), false);
});

test('tracked no-eligible split keeps its checked parent unresolved until every target completes', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-todo-state-'));
  fs.mkdirSync(path.join(repoRoot, '.brownie'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, '.brownie/todo-breakdown.md'), `# Breakdown

## E-23a-release-artifact-portable-archive no-eligible multi-target split

Parent TODO: E-23a-release-artifact-portable-archive: - [ ] parent

Targets:

- E-23a-release-artifact-portable-archive-target-01: \`scripts/a.mjs\`
- E-23a-release-artifact-portable-archive-target-02: \`scripts/b.mjs\`
- E-23a-release-artifact-portable-archive-target-03: \`.github/workflows/release.yml\`

Dependency graph:

- E-23a-release-artifact-portable-archive-target-01: <none>
`);

  const [trackedReplan] = readTrackedBreakdownReplanRecords(repoRoot);
  assert.equal(trackedReplan.parent_todo_id, 'E-23a-release-artifact-portable-archive');
  assert.deepEqual(trackedReplan.generated_child_ids, [
    'E-23a-release-artifact-portable-archive-target-01',
    'E-23a-release-artifact-portable-archive-target-02',
    'E-23a-release-artifact-portable-archive-target-03'
  ]);

  const state = resolveTodoState({
    todoText: '- [x] E-23a-release-artifact-portable-archive: checked dependency anchor',
    replanRecords: [trackedReplan],
    completionRecords: [{
      selected_todo_id: 'E-23a-release-artifact-portable-archive-target-01',
      reason: 'verified_completion'
    }]
  });

  assert(state.supersededIds.has('E-23a-release-artifact-portable-archive'));
  assert(!state.completedIds.has('E-23a-release-artifact-portable-archive'));
  assert(!state.resolvedIds.has('E-23a-release-artifact-portable-archive'));
});

test('tracked replans are read from the queue-specific breakdown path', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-todo-state-root-'));
  const queueRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-todo-state-queue-'));
  fs.mkdirSync(path.join(repoRoot, '.brownie'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, '.brownie/todo-breakdown.md'), `# Breakdown

## E-collision no-eligible multi-target split

Targets:
- E-collision-target-01: \`wrong.mjs\`
`);
  const queueBreakdownPath = path.join(queueRoot, 'todo-breakdown.md');
  fs.writeFileSync(queueBreakdownPath, '# Queue-specific breakdown\n');

  assert.deepEqual(readTrackedBreakdownReplanRecords(repoRoot, queueBreakdownPath), []);
});
