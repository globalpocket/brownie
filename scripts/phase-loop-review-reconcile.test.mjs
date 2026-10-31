import assert from 'node:assert/strict';
import test from 'node:test';
import { applyReviewReconciliation, reconcileReviewSnapshot } from './phase-loop-review-reconcile.mjs';
import {
  completionConditionSha256,
  selectedTodoSha256,
  terminalCompletionEvidenceSha256,
  validateCompletionCertificate
} from './phase-loop-delivery-integrity.mjs';

const selectedTodo = '- [ ] T-1: implementation\n  Completion condition: the bounded implementation is independently delivered.';
const terminalCompletionEvidence = { final_state: 'Succeeded', completion_result_fingerprint: 'sha256:review-reconcile-fixture' };
const claim = {
  claim_id: 'claim-1',
  root_claim_id: 'claim-1',
  selected_todo: selectedTodo,
  delivery_review: {
    semantic_completion_evidence: {
      schema_version: 1,
      root_claim_id: 'claim-1',
      selected_todo_sha256: selectedTodoSha256({ selected_todo: selectedTodo }),
      completion_condition_sha256: completionConditionSha256({ selected_todo: selectedTodo }),
      verification_results: [{ command: 'node --test scripts/bounded-journey.test.mjs', exit_code: 0 }],
      terminal: {
        completed: true,
        continuation_required: false,
        trajectory_failed: false,
        terminal_completion_evidence: terminalCompletionEvidence,
        terminal_completion_evidence_sha256: terminalCompletionEvidenceSha256(terminalCompletionEvidence)
      },
      observables: [{ kind: 'bounded_journey', sha256: 'a'.repeat(64) }]
    }
  }
};

function pr(overrides = {}) {
  return {
    number: 1,
    url: 'https://github.com/globalpocket/brownie/pull/1',
    author: { login: 'brownie-agent' },
    state: 'OPEN',
    mergedAt: null,
    headRefOid: 'a'.repeat(40),
    reviewDecision: 'REVIEW_REQUIRED',
    reviews: [],
    statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
    ...overrides
  };
}

test('changes requested returns the same immutable claim to rework', () => {
  const reconciliation = reconcileReviewSnapshot({
    claim,
    pullRequest: pr({ reviews: [{ state: 'CHANGES_REQUESTED', author: { login: 'globalpocket' }, commit: { oid: 'a'.repeat(40) }, body: 'add journey evidence' }] }),
    reviewer: 'globalpocket',
    implementation: 'brownie-agent'
  });
  assert.equal(reconciliation.valid, true);
  assert.equal(reconciliation.status, 'changes_requested');
  const next = applyReviewReconciliation({ claim, reconciliation, runStamp: 'run-1' });
  assert.equal(next.claim_id, 'claim-1');
  assert.equal(next.root_claim_id, 'claim-1');
  assert.equal(next.review_rework.required, true);
  assert.equal(next.review_rework.state, 'CHANGES_REQUESTED');
  assert.equal(next.review_rework.head_oid, 'a'.repeat(40));
  assert.equal(next.failure_history.at(-1).reason, 'independent_review_requested_changes');
  assert.deepEqual(next.delivery_review.semantic_completion_evidence, claim.delivery_review.semantic_completion_evidence);
});

test('passing CI and a PR do not complete without merge and independent approval', () => {
  const reconciliation = reconcileReviewSnapshot({ claim, pullRequest: pr(), reviewer: 'globalpocket', implementation: 'brownie-agent' });
  assert.equal(reconciliation.status, 'pr_pending_review');
  assert.equal(reconciliation.delivery_review.ci_passed, true);
});

test('only a merged approved CI-passing PR completes the claim', () => {
  const reconciliation = reconcileReviewSnapshot({
    claim,
    pullRequest: pr({
      state: 'MERGED',
      mergedAt: '2026-10-30T12:00:00Z',
      mergedBy: { login: 'globalpocket' },
      reviewDecision: 'APPROVED',
      reviews: [{ state: 'APPROVED', author: { login: 'globalpocket' }, commit: { oid: 'a'.repeat(40) }, submittedAt: '2026-10-30T11:59:00Z' }]
    }),
    reviewer: 'globalpocket',
    implementation: 'brownie-agent'
  });
  assert.equal(reconciliation.status, 'completed');
  assert.equal(reconciliation.delivery_review.merged, true);
  assert.equal(reconciliation.delivery_review.approved, true);
  assert.equal(reconciliation.delivery_review.merge_actor, 'globalpocket');
  assert.equal(reconciliation.delivery_review.merged_at, '2026-10-30T12:00:00Z');
  const next = applyReviewReconciliation({ claim, reconciliation, at: '2026-10-30T12:01:00Z', runStamp: 'run-merged' });
  assert.equal(next.status, 'completed');
  assert.ok(next.completion_certificate);
  assert.equal(validateCompletionCertificate({ claim: next }).valid, true);
});

test('changes requested removes a stale certificate and records a durable rework boundary', () => {
  const completed = applyReviewReconciliation({
    claim,
    reconciliation: reconcileReviewSnapshot({
      claim,
      pullRequest: pr({
        state: 'MERGED',
        mergedAt: '2026-10-30T12:00:00Z',
        mergedBy: { login: 'globalpocket' },
        reviewDecision: 'APPROVED',
        reviews: [{ state: 'APPROVED', author: { login: 'globalpocket' }, commit: { oid: 'a'.repeat(40) }, submittedAt: '2026-10-30T11:59:00Z' }]
      }),
      reviewer: 'globalpocket',
      implementation: 'brownie-agent'
    }),
    at: '2026-10-30T12:01:00Z',
    runStamp: 'run-completed'
  });
  assert.ok(completed.completion_certificate);

  const reconciliation = reconcileReviewSnapshot({
    claim: completed,
    pullRequest: pr({
      headRefOid: 'b'.repeat(40),
      reviews: [{ state: 'CHANGES_REQUESTED', author: { login: 'globalpocket' }, commit: { oid: 'b'.repeat(40) }, body: 'new work required', submittedAt: '2026-10-30T12:02:00Z' }]
    }),
    reviewer: 'globalpocket',
    implementation: 'brownie-agent'
  });
  const next = applyReviewReconciliation({ claim: completed, reconciliation, at: '2026-10-30T12:03:00Z', runStamp: 'run-rework' });
  assert.equal(next.status, 'changes_requested');
  assert.equal(next.completion_certificate, undefined);
  assert.equal(next.review_rework.state, 'CHANGES_REQUESTED');
  assert.equal(next.review_rework.root_claim_id, 'claim-1');
});

test('the reviewer latest decision at the current head overrides historical requests', () => {
  const reconciliation = reconcileReviewSnapshot({
    claim,
    pullRequest: pr({
      state: 'MERGED',
      mergedAt: '2026-10-30T12:00:00Z',
      mergedBy: { login: 'globalpocket' },
      reviews: [
        { state: 'CHANGES_REQUESTED', author: { login: 'globalpocket' }, commit: { oid: 'a'.repeat(40) }, body: 'old feedback', submittedAt: '2026-10-30T10:00:00Z' },
        { state: 'APPROVED', author: { login: 'globalpocket' }, commit: { oid: 'a'.repeat(40) }, body: 'resolved', submittedAt: '2026-10-30T11:00:00Z' }
      ]
    }),
    reviewer: 'globalpocket',
    implementation: 'brownie-agent'
  });
  assert.equal(reconciliation.status, 'completed');
});

test('merged completion refuses a missing or mismatched merge actor', () => {
  const missing = reconcileReviewSnapshot({
    claim,
    pullRequest: pr({
      state: 'MERGED',
      mergedAt: '2026-10-30T12:00:00Z',
      reviews: [{ state: 'APPROVED', author: { login: 'globalpocket' }, commit: { oid: 'a'.repeat(40) }, submittedAt: '2026-10-30T11:00:00Z' }]
    }),
    reviewer: 'globalpocket',
    implementation: 'brownie-agent'
  });
  assert.equal(missing.status, 'pr_pending_review');
  assert(missing.errors.includes('merge_actor_missing'));

  const mismatched = reconcileReviewSnapshot({
    claim,
    pullRequest: pr({
      state: 'MERGED',
      mergedAt: '2026-10-30T12:00:00Z',
      mergedBy: { login: 'other-maintainer' },
      reviews: [{ state: 'APPROVED', author: { login: 'globalpocket' }, commit: { oid: 'a'.repeat(40) }, submittedAt: '2026-10-30T11:00:00Z' }]
    }),
    reviewer: 'globalpocket',
    implementation: 'brownie-agent'
  });
  assert.equal(mismatched.status, 'pr_pending_review');
  assert(mismatched.errors.includes('merge_actor_not_independent_reviewer'));
});

test('merged completion refuses absent claim-bound semantic evidence', () => {
  const withoutEvidence = { ...claim, delivery_review: {} };
  const reconciliation = reconcileReviewSnapshot({
    claim: withoutEvidence,
    pullRequest: pr({
      state: 'MERGED',
      mergedAt: '2026-10-30T12:00:00Z',
      mergedBy: { login: 'globalpocket' },
      reviews: [{ state: 'APPROVED', author: { login: 'globalpocket' }, commit: { oid: 'a'.repeat(40) }, submittedAt: '2026-10-30T11:00:00Z' }]
    }),
    reviewer: 'globalpocket',
    implementation: 'brownie-agent'
  });
  assert.equal(reconciliation.status, 'pr_pending_review');
  assert(reconciliation.errors.some((error) => error.startsWith('semantic_completion_')));
});

test('the author cannot satisfy the independent review role', () => {
  const reconciliation = reconcileReviewSnapshot({ claim, pullRequest: pr(), reviewer: 'brownie-agent', implementation: 'brownie-agent' });
  assert.equal(reconciliation.valid, false);
  assert(reconciliation.errors.includes('reviewer_not_independent'));
});
