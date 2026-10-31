#!/usr/bin/env node
/**
 * Delivery integrity is intentionally stricter than process success.
 *
 * A runtime may return a syntactically valid response (and the wrapper may
 * therefore exit 0) while explicitly asking the controller to continue.
 * That is not a completed TODO, and it is not eligible for PR publication.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function lineValue(todo, label) {
  const match = String(todo ?? '').match(new RegExp(`^\\s*${label}:\\s*(.+?)\\s*$`, 'mi'));
  return match?.[1]?.trim() ?? '';
}

export function selectedTodoSha256(claim) {
  return sha256(asObject(claim).selected_todo ?? '');
}

export function completionConditionSha256(claim) {
  return sha256(lineValue(asObject(claim).selected_todo, 'Completion condition'));
}

export function rootClaimId(claim) {
  const input = asObject(claim);
  return input.root_claim_id ?? input.claim_id ?? null;
}

export function runDeliveryView(stdoutPayload) {
  const root = asObject(stdoutPayload);
  const run = asObject(root.run);
  const automation = { ...asObject(root.automation), ...asObject(run.automation) };
  const completed = run.completed === true || (Object.keys(run).length === 0 && root.completed === true);
  const continuationRequired = run.continuation_required === true
    || root.continuation_required === true
    || automation.continuation_required === true;
  const terminalEvidenceMissing = run.terminal_completion_evidence_missing === true
    || root.terminal_completion_evidence_missing === true
    || automation.terminal_completion_evidence_missing === true;
  const failure = run.trajectory_failed === true
    || root.trajectory_failed === true
    || automation.trajectory_failed === true;
  return {
    process_ok: root.ok === true,
    completed,
    continuation_required: continuationRequired,
    terminal_completion_evidence_missing: terminalEvidenceMissing,
    trajectory_failed: failure,
    semantic_completion_evidence: run.semantic_completion_evidence
      ?? root.semantic_completion_evidence
      ?? automation.semantic_completion_evidence
      ?? null
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function semanticCompletionEvidenceSha256(evidence) {
  return sha256(canonicalJson(asObject(evidence)));
}

export function terminalCompletionEvidenceSha256(evidence) {
  return sha256(canonicalJson(evidence));
}

function hasTerminalCompletionEvidence(evidence) {
  if (typeof evidence === 'string') return evidence.trim().length > 0;
  return Boolean(evidence && typeof evidence === 'object' && !Array.isArray(evidence) && Object.keys(evidence).length > 0);
}

/**
 * The runtime deliberately does not know an owner's controller claim.  The
 * controller therefore binds the already-executed, selected-TODO verification
 * result to the runtime's terminal payload before publishing a review handoff.
 * This is a producer, not a synthetic success: it refuses anything that did
 * not report `completed:true` and at least one successful executed command.
 */
export function produceSemanticCompletionEvidence({ claim, stdoutPayload, verification }) {
  const verificationPayload = asObject(verification);
  if (verificationPayload.completed !== true) return null;
  const verificationResults = asArray(verificationPayload.results)
    .map((result) => asObject(result))
    .filter((result) => typeof result.command === 'string' && result.command && result.exit_code === 0)
    .map((result) => ({ command: result.command, exit_code: result.exit_code }));
  if (verificationResults.length === 0) return null;

  const runtime = runDeliveryView(stdoutPayload);
  const payload = asObject(stdoutPayload);
  const run = asObject(payload.run);
  const terminalCompletionEvidence = run.terminal_completion_evidence
    ?? payload.terminal_completion_evidence
    ?? null;
  // A successful process envelope is intentionally insufficient.  Preserve
  // the concrete terminal fact in the receipt so a later review reconcile
  // cannot turn a patch/CI result into a synthetic completed run.
  if (
    runtime.completed !== true
    || runtime.continuation_required === true
    || runtime.terminal_completion_evidence_missing === true
    || runtime.trajectory_failed === true
    || !hasTerminalCompletionEvidence(terminalCompletionEvidence)
  ) {
    return null;
  }
  const terminalPayload = {
    completed: runtime.completed,
    continuation_required: runtime.continuation_required,
    terminal_completion_evidence: terminalCompletionEvidence,
    stop_reason: run.stop_reason ?? payload.stop_reason ?? null,
    execution_outcome: run.execution_outcome ?? payload.execution_outcome ?? null
  };
  return {
    schema_version: 1,
    root_claim_id: rootClaimId(claim),
    selected_todo_sha256: selectedTodoSha256(claim),
    completion_condition_sha256: completionConditionSha256(claim),
    verification_results: verificationResults,
    terminal: {
      completed: true,
      continuation_required: false,
      trajectory_failed: false,
      terminal_completion_evidence: terminalCompletionEvidence,
      terminal_completion_evidence_sha256: terminalCompletionEvidenceSha256(terminalCompletionEvidence)
    },
    observables: [
      { kind: 'controller_verification_result', sha256: sha256(canonicalJson(verificationPayload)) },
      { kind: 'runtime_terminal_payload', sha256: sha256(canonicalJson(terminalPayload)) }
    ]
  };
}

/**
 * The evidence contract binds a semantic verification result to the immutable
 * claim.  Passing CI or changing a listed target alone is deliberately not
 * evidence: both can be unrelated to the requested completion condition.
 */
export function validateSemanticCompletionEvidence({ claim, evidence }) {
  const proof = asObject(evidence);
  const expectedClaimId = rootClaimId(claim);
  const expectedTodoHash = selectedTodoSha256(claim);
  const expectedConditionHash = completionConditionSha256(claim);
  const errors = [];
  if (proof.schema_version !== 1) errors.push('semantic_evidence_schema_invalid');
  if (!expectedClaimId || proof.root_claim_id !== expectedClaimId) errors.push('semantic_evidence_root_claim_mismatch');
  if (proof.selected_todo_sha256 !== expectedTodoHash) errors.push('semantic_evidence_todo_mismatch');
  if (proof.completion_condition_sha256 !== expectedConditionHash) errors.push('semantic_evidence_completion_condition_mismatch');
  const verifications = asArray(proof.verification_results);
  if (verifications.length === 0 || verifications.some((result) => asObject(result).exit_code !== 0 || !asObject(result).command)) {
    errors.push('semantic_evidence_verification_missing_or_failed');
  }
  const observables = asArray(proof.observables);
  if (observables.length === 0 || observables.some((observable) => !asObject(observable).kind || !asObject(observable).sha256)) {
    errors.push('semantic_evidence_observable_missing');
  }
  const terminal = asObject(proof.terminal);
  if (!hasTerminalCompletionEvidence(terminal.terminal_completion_evidence)) {
    errors.push('semantic_evidence_terminal_missing');
  } else {
    if (terminal.completed !== true) errors.push('semantic_evidence_terminal_not_completed');
    if (terminal.continuation_required !== false) errors.push('semantic_evidence_terminal_continuation_required');
    if (terminal.trajectory_failed !== false) errors.push('semantic_evidence_terminal_trajectory_failed');
    if (terminal.terminal_completion_evidence_sha256 !== terminalCompletionEvidenceSha256(terminal.terminal_completion_evidence)) {
      errors.push('semantic_evidence_terminal_evidence_hash_mismatch');
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Completion is a durable delivery assertion, not a shorthand for a green
 * process, a pushed patch, or a CI result.  Keep the review/merge receipt in
 * one reusable validator so the current claim and the durable completion
 * record cannot drift into different definitions of "done".
 */
export function validateTerminalDeliveryReceipt({ claim, review = undefined }) {
  const deliveryClaim = asObject(claim);
  const reviewState = asObject(review === undefined ? deliveryClaim.delivery_review : review);
  const errors = [];
  if (deliveryClaim.status !== 'completed') errors.push('completion_claim_not_completed');
  if (reviewState.merged !== true) errors.push('completed_requires_merged_pr');
  if (reviewState.approved !== true) errors.push('completed_requires_independent_approval');
  if (reviewState.ci_passed !== true) errors.push('completed_requires_passing_ci');
  if (typeof reviewState.author !== 'string' || !reviewState.author) errors.push('completed_requires_implementation_author');
  if (typeof reviewState.reviewer !== 'string' || !reviewState.reviewer) errors.push('completed_requires_independent_reviewer');
  if (reviewState.author === reviewState.reviewer) errors.push('completed_requires_distinct_reviewer');
  if (typeof reviewState.merge_actor !== 'string' || reviewState.merge_actor !== reviewState.reviewer) {
    errors.push('completed_requires_observed_reviewer_merge_actor');
  }
  const semanticEvidence = validateSemanticCompletionEvidence({
    claim: deliveryClaim,
    evidence: reviewState.semantic_completion_evidence
  });
  if (!semanticEvidence.valid) {
    errors.push(...semanticEvidence.errors.map((error) => `completed_requires_${error}`));
  }
  return { valid: errors.length === 0, errors };
}

/**
 * A completion certificate is the controller's immutable, claim-bound record
 * of a terminal delivery receipt.  It deliberately contains only observed
 * facts: a process exit, patch, PR creation, or green CI cannot mint one.
 *
 * Keeping this separate from `delivery_review` lets a later PR head or a
 * CHANGES_REQUESTED review invalidate an old receipt without erasing the
 * causal history that explains why the claim returned to rework.
 */
export function createCompletionCertificate({ claim, review = undefined, issuedAt = new Date().toISOString() }) {
  const deliveryClaim = asObject(claim);
  const reviewState = asObject(review === undefined ? deliveryClaim.delivery_review : review);
  const receipt = validateTerminalDeliveryReceipt({
    claim: { ...deliveryClaim, status: 'completed', delivery_review: reviewState },
    review: reviewState
  });
  if (!receipt.valid) return { valid: false, certificate: null, errors: receipt.errors };

  return {
    valid: true,
    errors: [],
    certificate: {
      schema_version: 1,
      root_claim_id: rootClaimId(deliveryClaim),
      selected_todo_sha256: selectedTodoSha256(deliveryClaim),
      completion_condition_sha256: completionConditionSha256(deliveryClaim),
      semantic_completion_evidence_sha256: semanticCompletionEvidenceSha256(reviewState.semantic_completion_evidence),
      review: {
        pr_url: reviewState.pr_url ?? null,
        pr_number: reviewState.pr_number ?? null,
        head_oid: reviewState.head_oid ?? null,
        author: reviewState.author ?? null,
        reviewer: reviewState.reviewer ?? null,
        merge_actor: reviewState.merge_actor ?? null,
        merged_at: reviewState.merged_at ?? null,
        observed_at: reviewState.observed_at ?? null
      },
      issued_at: issuedAt
    }
  };
}

/**
 * Validate the immutable completion certificate against the live claim.  A
 * certificate must bind exactly the same PR head, review actors, semantic
 * proof, and claim identity.  This prevents a later patch/review cycle from
 * inheriting a receipt that was valid only for an earlier head.
 */
export function validateCompletionCertificate({ claim, certificate = undefined, review = undefined }) {
  const deliveryClaim = asObject(claim);
  const proof = asObject(certificate === undefined ? deliveryClaim.completion_certificate : certificate);
  const reviewState = asObject(review === undefined ? deliveryClaim.delivery_review : review);
  const errors = [];
  if (proof.schema_version !== 1) errors.push('completion_certificate_schema_invalid');
  if (!rootClaimId(deliveryClaim) || proof.root_claim_id !== rootClaimId(deliveryClaim)) {
    errors.push('completion_certificate_root_claim_mismatch');
  }
  if (proof.selected_todo_sha256 !== selectedTodoSha256(deliveryClaim)) {
    errors.push('completion_certificate_todo_mismatch');
  }
  if (proof.completion_condition_sha256 !== completionConditionSha256(deliveryClaim)) {
    errors.push('completion_certificate_completion_condition_mismatch');
  }
  if (proof.semantic_completion_evidence_sha256 !== semanticCompletionEvidenceSha256(reviewState.semantic_completion_evidence)) {
    errors.push('completion_certificate_semantic_evidence_mismatch');
  }
  const certificateReview = asObject(proof.review);
  for (const field of ['pr_url', 'pr_number', 'head_oid', 'author', 'reviewer', 'merge_actor', 'merged_at', 'observed_at']) {
    if (certificateReview[field] !== (reviewState[field] ?? null)) {
      errors.push(`completion_certificate_review_${field}_mismatch`);
    }
  }
  if (typeof proof.issued_at !== 'string' || !proof.issued_at) errors.push('completion_certificate_issued_at_missing');
  const reviewRework = asObject(deliveryClaim.review_rework);
  if (reviewRework.required === true && reviewRework.state === 'CHANGES_REQUESTED') {
    errors.push('completion_certificate_invalidated_by_changes_requested');
  }
  const receipt = validateTerminalDeliveryReceipt({
    claim: { ...deliveryClaim, status: 'completed', delivery_review: reviewState },
    review: reviewState
  });
  if (!receipt.valid) errors.push(...receipt.errors.map((error) => `completion_certificate_requires_${error}`));
  return { valid: errors.length === 0, errors };
}

/**
 * Evaluate only what can be safely inferred from a run.  "allowed" here
 * means an implementation can be handed to review, never that the TODO is
 * done.  Final completion needs a merged, independently approved PR.
 */
export function evaluateDeliveryHandoff({ claim, stdoutPayload, semanticCompletionEvidence = null }) {
  const run = runDeliveryView(stdoutPayload);
  const reasons = [];
  if (run.trajectory_failed) reasons.push('trajectory_failed');
  if (run.continuation_required) reasons.push('continuation_required');
  if (run.terminal_completion_evidence_missing) reasons.push('terminal_completion_evidence_missing');
  if (!run.completed) reasons.push('run_not_completed');

  if (reasons.length > 0) {
    return {
      schema_version: 1,
      process_ok: run.process_ok,
      delivery_state: run.trajectory_failed ? 'failed' : 'nonterminal',
      terminal: false,
      pr_handoff_allowed: false,
      completion_allowed: false,
      root_claim_id: rootClaimId(claim),
      selected_todo_sha256: selectedTodoSha256(claim),
      reasons
    };
  }

  const suppliedEvidence = semanticCompletionEvidence ?? run.semantic_completion_evidence;
  const evidence = validateSemanticCompletionEvidence({ claim, evidence: suppliedEvidence });
  if (!evidence.valid) {
    return {
      schema_version: 1,
      process_ok: run.process_ok,
      delivery_state: 'integrity_blocked',
      terminal: false,
      pr_handoff_allowed: false,
      completion_allowed: false,
      root_claim_id: rootClaimId(claim),
      selected_todo_sha256: selectedTodoSha256(claim),
      reasons: evidence.errors
    };
  }
  return {
    schema_version: 1,
    process_ok: run.process_ok,
    delivery_state: 'verification_passed',
    terminal: false,
    pr_handoff_allowed: true,
    completion_allowed: false,
    root_claim_id: rootClaimId(claim),
    selected_todo_sha256: selectedTodoSha256(claim),
    semantic_completion_evidence: suppliedEvidence,
    reasons: []
  };
}

/**
 * Claims are append-only causally.  Retry/review transitions must retain the
 * same root claim and immutable TODO fingerprint; only a merged review can
 * enter completed.
 */
export function validateClaimLifecycleTransition({ previous, next, review = {} }) {
  const before = asObject(previous);
  const after = asObject(next);
  const errors = [];
  if (rootClaimId(before) && rootClaimId(after) && rootClaimId(before) !== rootClaimId(after)) errors.push('root_claim_id_changed');
  if (before.selected_todo && after.selected_todo && selectedTodoSha256(before) !== selectedTodoSha256(after)) errors.push('selected_todo_fingerprint_changed');
  if (after.status === 'completed') {
    const terminalReceipt = validateTerminalDeliveryReceipt({ claim: after, review });
    errors.push(...terminalReceipt.errors.filter((error) => error !== 'completion_claim_not_completed'));
    const certificate = validateCompletionCertificate({ claim: after, review });
    errors.push(...certificate.errors);
  }
  if (after.status === 'pr_pending_review' && asObject(review).handoff_allowed !== true) {
    errors.push('pr_pending_review_requires_delivery_handoff');
  }
  return { valid: errors.length === 0, errors };
}

function usage() {
  process.stderr.write('usage: phase-loop-delivery-integrity.mjs evaluate --claim <claim.json> --stdout <run.stdout.json> [--verification <verification.json>]\n');
  process.stderr.write('   or: phase-loop-delivery-integrity.mjs validate-certificate --claim <claim.json> [--require-completed]\n');
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith('--')) args.set(argv[index], argv[index + 1]);
  }
  return args;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command] = process.argv.slice(2);
  const args = parseArgs(process.argv.slice(3));
  if (!args.get('--claim') || (command !== 'evaluate' && command !== 'validate-certificate') || (command === 'evaluate' && !args.get('--stdout'))) {
    usage();
    process.exit(64);
  }
  try {
    const claim = readJson(args.get('--claim'));
    if (command === 'validate-certificate') {
      const result = validateCompletionCertificate({ claim });
      if (args.has('--require-completed') && asObject(claim).status !== 'completed') {
        result.valid = false;
        result.errors.push('completion_certificate_claim_not_completed');
      }
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exit(result.valid ? 0 : 76);
    }
    const stdoutPayload = readJson(args.get('--stdout'));
    let verification = null;
    if (args.get('--verification')) verification = JSON.parse(args.get('--verification'));
    const semanticCompletionEvidence = produceSemanticCompletionEvidence({ claim, stdoutPayload, verification });
    const result = evaluateDeliveryHandoff({ claim, stdoutPayload, semanticCompletionEvidence });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(result.pr_handoff_allowed ? 0 : 76);
  } catch (error) {
    process.stderr.write(`delivery_integrity_evaluation_failed: ${error.message}\n`);
    process.exit(70);
  }
}
