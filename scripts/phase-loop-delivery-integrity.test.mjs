import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completionConditionSha256,
  createCompletionCertificate,
  evaluateDeliveryHandoff,
  produceSemanticCompletionEvidence,
  selectedTodoSha256,
  terminalCompletionEvidenceSha256,
  validateCompletionCertificate,
  validateTerminalDeliveryReceipt,
  validateClaimLifecycleTransition
} from './phase-loop-delivery-integrity.mjs';

const selectedTodo = `- [ ] target-02: Patch only \`runtime.rs\`.
  Completion condition: the artifact journey persists a ledger and rejects stale replay.
  Verification: run \`node --test scripts/artifact-journey.test.mjs\`.`;
const claim = { claim_id: 'claim-02', root_claim_id: 'claim-02', selected_todo: selectedTodo };

function completedRun(evidence) {
  return {
    ok: true,
    run: {
      completed: true,
      terminal_completion_evidence: { final_state: 'Succeeded', completion_result_fingerprint: 'sha256:terminal-fixture' },
      automation: { continuation_required: false },
      semantic_completion_evidence: evidence
    }
  };
}

function validEvidence() {
  const terminalCompletionEvidence = { final_state: 'Succeeded', completion_result_fingerprint: 'sha256:terminal-fixture' };
  return {
    schema_version: 1,
    root_claim_id: 'claim-02',
    selected_todo_sha256: selectedTodoSha256(claim),
    completion_condition_sha256: completionConditionSha256(claim),
    verification_results: [{ command: 'node --test scripts/artifact-journey.test.mjs', exit_code: 0 }],
    terminal: {
      completed: true,
      continuation_required: false,
      trajectory_failed: false,
      terminal_completion_evidence: terminalCompletionEvidence,
      terminal_completion_evidence_sha256: terminalCompletionEvidenceSha256(terminalCompletionEvidence)
    },
    observables: [{ kind: 'artifact_journey', sha256: 'a'.repeat(64) }]
  };
}

test('a process-success envelope cannot promote continuation_required to delivery success', () => {
  const result = evaluateDeliveryHandoff({
    claim,
    stdoutPayload: {
      ok: true,
      run: {
        completed: false,
        terminal_completion_evidence_missing: true,
        automation: { continuation_required: true }
      }
    }
  });
  assert.equal(result.process_ok, true);
  assert.equal(result.delivery_state, 'nonterminal');
  assert.equal(result.pr_handoff_allowed, false);
  assert.equal(result.completion_allowed, false);
  assert.deepEqual(result.reasons.sort(), [
    'continuation_required',
    'run_not_completed',
    'terminal_completion_evidence_missing'
  ]);
});

test('a completed run without claim-bound semantic evidence is integrity blocked', () => {
  const result = evaluateDeliveryHandoff({ claim, stdoutPayload: completedRun(null) });
  assert.equal(result.delivery_state, 'integrity_blocked');
  assert.equal(result.pr_handoff_allowed, false);
  assert(result.reasons.includes('semantic_evidence_schema_invalid'));
});

test('claim-bound semantic evidence permits review handoff but never declares delivery complete', () => {
  const result = evaluateDeliveryHandoff({ claim, stdoutPayload: completedRun(validEvidence()) });
  assert.equal(result.delivery_state, 'verification_passed');
  assert.equal(result.pr_handoff_allowed, true);
  assert.equal(result.completion_allowed, false);
});

test('controller binds executed verification and the CLI terminal payload into durable handoff evidence', () => {
  const stdoutPayload = {
    ok: true,
    run: {
      completed: true,
      stop_reason: 'completion finalized',
      terminal_completion_evidence: { final_state: 'Succeeded', completion_result_fingerprint: 'sha256:terminal' },
      automation: { continuation_required: false }
    }
  };
  const evidence = produceSemanticCompletionEvidence({
    claim,
    stdoutPayload,
    verification: {
      completed: true,
      reason: 'selected_todo_verification_passed',
      results: [{ command: 'node --test scripts/artifact-journey.test.mjs', exit_code: 0, stdout_tail: 'passed' }]
    }
  });
  assert.ok(evidence);
  assert.equal(evidence.root_claim_id, 'claim-02');
  assert.equal(evidence.observables.length, 2);
  const result = evaluateDeliveryHandoff({ claim, stdoutPayload, semanticCompletionEvidence: evidence });
  assert.equal(result.pr_handoff_allowed, true);
  assert.deepEqual(result.semantic_completion_evidence, evidence);
});

test('the producer cannot manufacture evidence without a successful executed verification', () => {
  const evidence = produceSemanticCompletionEvidence({
    claim,
    stdoutPayload: completedRun(null),
    verification: { completed: true, results: [] }
  });
  assert.equal(evidence, null);
});

test('the producer rejects a successful process envelope that still requires continuation', () => {
  const evidence = produceSemanticCompletionEvidence({
    claim,
    stdoutPayload: {
      ok: true,
      run: {
        completed: false,
        terminal_completion_evidence_missing: true,
        automation: { continuation_required: true }
      }
    },
    verification: { completed: true, results: [{ command: 'node --test scripts/artifact-journey.test.mjs', exit_code: 0 }] }
  });
  assert.equal(evidence, null);
});

test('a receipt with terminal facts that do not bind its embedded evidence is rejected', () => {
  const evidence = validEvidence();
  evidence.terminal.terminal_completion_evidence.final_state = 'Forged';
  const result = evaluateDeliveryHandoff({ claim, stdoutPayload: completedRun(evidence) });
  assert.equal(result.pr_handoff_allowed, false);
  assert(result.reasons.includes('semantic_evidence_terminal_evidence_hash_mismatch'));
});

test('irrelevant or stale proof cannot be reused for another TODO fingerprint', () => {
  const evidence = validEvidence();
  evidence.selected_todo_sha256 = 'b'.repeat(64);
  const result = evaluateDeliveryHandoff({ claim, stdoutPayload: completedRun(evidence) });
  assert.equal(result.pr_handoff_allowed, false);
  assert(result.reasons.includes('semantic_evidence_todo_mismatch'));
});

test('a completed claim requires approved CI-passing merged review', () => {
  const pending = validateClaimLifecycleTransition({
    previous: claim,
    next: { ...claim, status: 'completed' },
    review: { merged: false, approved: true, ci_passed: true }
  });
  assert.equal(pending.valid, false);
  assert(pending.errors.includes('completed_requires_merged_pr'));

  const review = {
    pr_url: 'https://github.com/globalpocket/brownie/pull/42',
    pr_number: 42,
    head_oid: 'a'.repeat(40),
    merged_at: '2026-10-31T07:00:00Z',
    observed_at: '2026-10-31T07:01:00Z',
    merged: true,
    approved: true,
    ci_passed: true,
    author: 'brownie-agent',
    reviewer: 'globalpocket',
    merge_actor: 'globalpocket',
    semantic_completion_evidence: validEvidence()
  };
  const issuance = createCompletionCertificate({ claim, review, issuedAt: '2026-10-31T07:02:00Z' });
  assert.equal(issuance.valid, true, JSON.stringify(issuance.errors));
  const merged = validateClaimLifecycleTransition({
    previous: claim,
    next: { ...claim, status: 'completed', delivery_review: review, completion_certificate: issuance.certificate },
    review
  });
  assert.equal(merged.valid, true, JSON.stringify(merged.errors));
});

test('a merged review without a durable completion certificate cannot complete a claim', () => {
  const review = {
    pr_url: 'https://github.com/globalpocket/brownie/pull/42',
    pr_number: 42,
    head_oid: 'a'.repeat(40),
    merged_at: '2026-10-31T07:00:00Z',
    observed_at: '2026-10-31T07:01:00Z',
    merged: true,
    approved: true,
    ci_passed: true,
    author: 'brownie-agent',
    reviewer: 'globalpocket',
    merge_actor: 'globalpocket',
    semantic_completion_evidence: validEvidence()
  };
  const result = validateClaimLifecycleTransition({
    previous: claim,
    next: { ...claim, status: 'completed', delivery_review: review },
    review
  });
  assert.equal(result.valid, false);
  assert(result.errors.includes('completion_certificate_schema_invalid'));
});

test('a completion certificate is invalidated by a changed PR head or review rework', () => {
  const review = {
    pr_url: 'https://github.com/globalpocket/brownie/pull/42',
    pr_number: 42,
    head_oid: 'a'.repeat(40),
    merged_at: '2026-10-31T07:00:00Z',
    observed_at: '2026-10-31T07:01:00Z',
    merged: true,
    approved: true,
    ci_passed: true,
    author: 'brownie-agent',
    reviewer: 'globalpocket',
    merge_actor: 'globalpocket',
    semantic_completion_evidence: validEvidence()
  };
  const { certificate } = createCompletionCertificate({ claim, review, issuedAt: '2026-10-31T07:02:00Z' });
  const changedHead = validateCompletionCertificate({
    claim: { ...claim, delivery_review: { ...review, head_oid: 'b'.repeat(40) }, completion_certificate: certificate }
  });
  assert.equal(changedHead.valid, false);
  assert(changedHead.errors.includes('completion_certificate_review_head_oid_mismatch'));

  const rework = validateCompletionCertificate({
    claim: {
      ...claim,
      delivery_review: review,
      completion_certificate: certificate,
      review_rework: { required: true, state: 'CHANGES_REQUESTED' }
    }
  });
  assert.equal(rework.valid, false);
  assert(rework.errors.includes('completion_certificate_invalidated_by_changes_requested'));
});

test('a merged review still cannot complete without an observed independent merge actor', () => {
  const result = validateClaimLifecycleTransition({
    previous: claim,
    next: { ...claim, status: 'completed' },
    review: {
      merged: true,
      approved: true,
      ci_passed: true,
      author: 'brownie-agent',
      reviewer: 'globalpocket',
      semantic_completion_evidence: validEvidence()
    }
  });
  assert.equal(result.valid, false);
  assert(result.errors.includes('completed_requires_observed_reviewer_merge_actor'));
});

test('a durable completion receipt requires the same independent review boundary as a completed claim', () => {
  const valid = validateTerminalDeliveryReceipt({
    claim: {
      ...claim,
      status: 'completed',
      delivery_review: {
        merged: true,
        approved: true,
        ci_passed: true,
        author: 'brownie-agent',
        reviewer: 'globalpocket',
        merge_actor: 'globalpocket',
        semantic_completion_evidence: validEvidence()
      }
    }
  });
  assert.equal(valid.valid, true, JSON.stringify(valid.errors));

  const rejected = validateTerminalDeliveryReceipt({
    claim: { ...claim, status: 'completed', delivery_review: { merged: true, approved: true, ci_passed: true } }
  });
  assert.equal(rejected.valid, false);
  assert(rejected.errors.includes('completed_requires_independent_reviewer'));
});

test('review-requested changes preserve the immutable root claim and fingerprint', () => {
  const rework = validateClaimLifecycleTransition({
    previous: { ...claim, status: 'pr_pending_review' },
    next: { ...claim, status: 'changes_requested' }
  });
  assert.equal(rework.valid, true, JSON.stringify(rework.errors));

  const replacement = validateClaimLifecycleTransition({
    previous: claim,
    next: { ...claim, claim_id: 'replacement-claim', root_claim_id: 'replacement-claim', status: 'changes_requested' }
  });
  assert.equal(replacement.valid, false);
  assert(replacement.errors.includes('root_claim_id_changed'));
});
