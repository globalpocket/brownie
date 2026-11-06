#!/usr/bin/env node
/**
 * Turn GitHub review facts into an append-only claim update.  This is kept
 * separate from process execution so an open PR can never be mistaken for a
 * finished TODO.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  createCompletionCertificate,
  validateSemanticCompletionEvidence
} from './phase-loop-delivery-integrity.mjs';

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function login(value) {
  return typeof object(value).login === 'string' ? object(value).login : '';
}

function allChecksPassed(pullRequest) {
  const checks = list(object(pullRequest).statusCheckRollup);
  return checks.length > 0 && checks.every((check) => (
    object(check).status === 'COMPLETED' && object(check).conclusion === 'SUCCESS'
  ));
}

function reviewAtHead(review, headOid) {
  const commitOid = object(object(review).commit).oid;
  return !headOid || !commitOid || commitOid === headOid;
}

function reviewTimestamp(review) {
  const submittedAt = object(review).submittedAt;
  return typeof submittedAt === 'string' ? submittedAt : '';
}

function latestEffectiveReview(reviews) {
  return [...reviews].sort((left, right) => reviewTimestamp(left).localeCompare(reviewTimestamp(right))).at(-1) ?? null;
}

export function reconcileReviewSnapshot({ claim, pullRequest, reviewer, implementation }) {
  const before = object(claim);
  const pr = object(pullRequest);
  const rootClaimId = before.root_claim_id ?? before.claim_id ?? null;
  const headOid = typeof pr.headRefOid === 'string' ? pr.headRefOid : '';
  const reviews = list(pr.reviews);
  const reviewActor = String(reviewer ?? '');
  const implementationActor = String(implementation ?? '');
  const errors = [];
  if (!rootClaimId || !before.selected_todo) errors.push('claim_identity_missing');
  if (!reviewActor || !implementationActor) errors.push('configured_actor_missing');
  if (login(pr.author) !== implementationActor) errors.push('implementation_author_mismatch');
  const expectedHeadOid = typeof object(before.delivery_review).head_oid === 'string'
    ? object(before.delivery_review).head_oid
    : '';
  if (expectedHeadOid && expectedHeadOid !== headOid) errors.push('implementation_head_mismatch');
  if (reviewActor === implementationActor) errors.push('reviewer_not_independent');
  const semanticCompletionEvidence = object(before.delivery_review).semantic_completion_evidence;
  const semanticEvidence = validateSemanticCompletionEvidence({ claim: before, evidence: semanticCompletionEvidence });
  if (!semanticEvidence.valid) errors.push(...semanticEvidence.errors.map((error) => `semantic_completion_${error}`));
  const ownReviews = reviews.filter((review) => login(review.author) === reviewActor && reviewAtHead(review, headOid));
  // GitHub retains every review. Only the reviewer's latest decision at this
  // head is effective; an old request must not override a later approval.
  const effectiveReview = latestEffectiveReview(ownReviews);
  const effectiveDecision = object(effectiveReview).state ?? null;
  const requested = effectiveDecision === 'CHANGES_REQUESTED';
  const approved = effectiveDecision === 'APPROVED';
  const ciPassed = allChecksPassed(pr);
  const merged = pr.state === 'MERGED' && typeof pr.mergedAt === 'string';
  const mergeActor = login(pr.mergedBy);
  if (merged && !mergeActor) errors.push('merge_actor_missing');
  if (merged && mergeActor !== reviewActor) errors.push('merge_actor_not_independent_reviewer');
  let status = 'pr_pending_review';
  if (requested) status = 'changes_requested';
  else if (merged && approved && ciPassed && errors.length === 0) status = 'completed';
  else if (pr.state === 'CLOSED') status = 'integrity_blocked';
  const feedback = ownReviews
    .filter((review) => object(review).state === 'CHANGES_REQUESTED')
    .map((review) => ({ submitted_at: object(review).submittedAt ?? null, body: object(review).body ?? '' }));
  return {
    valid: errors.length === 0,
    errors,
    status,
    delivery_review: {
      pr_url: typeof pr.url === 'string' ? pr.url : null,
      pr_number: Number.isInteger(pr.number) ? pr.number : null,
      author: login(pr.author) || null,
      reviewer: reviewActor || null,
      merge_actor: mergeActor || null,
      head_oid: headOid || null,
      merged_at: typeof pr.mergedAt === 'string' ? pr.mergedAt : null,
      merged,
      approved,
      ci_passed: ciPassed,
      semantic_completion_evidence: semanticCompletionEvidence ?? null,
      review_decision: pr.reviewDecision ?? null,
      effective_reviewer_decision: effectiveDecision,
      observed_at: new Date().toISOString()
    },
    feedback
  };
}

export function applyReviewReconciliation({ claim, reconciliation, at = new Date().toISOString(), runStamp = '' }) {
  const before = object(claim);
  const result = object(reconciliation);
  const next = structuredClone(before);
  // An invalid observation must not overwrite the admitted receipt.  In
  // particular, a head mismatch is a fail-closed boundary, not a mechanism
  // for teaching the claim to accept the newly observed (unadmitted) head on
  // the next poll.
  if (!result.valid) return next;
  next.root_claim_id ??= next.claim_id;
  next.delivery_review = result.delivery_review;
  next.status = result.status;
  next.updated_at = at;
  next.run_stamp = runStamp;
  next.status_history = list(next.status_history);
  next.status_history.push({
    status: result.status,
    run_stamp: runStamp,
    updated_at: at,
    note: 'github_review_reconciled'
  });
  if (result.status === 'changes_requested') {
    // A request for changes invalidates every prior terminal receipt for this
    // claim.  Preserve the history, but never let a certificate from a
    // rejected head survive into the rework cycle.
    delete next.completion_certificate;
    next.failure_history = list(next.failure_history);
    next.failure_history.push({
      at,
      run_stamp: runStamp,
      status: 'changes_requested',
      root_claim_id: next.root_claim_id,
      reason: 'independent_review_requested_changes',
      feedback: result.feedback
    });
    next.review_rework = {
      required: true,
      state: 'CHANGES_REQUESTED',
      root_claim_id: next.root_claim_id,
      pr_url: result.delivery_review?.pr_url ?? null,
      head_oid: result.delivery_review?.head_oid ?? null,
      reviewer: result.delivery_review?.reviewer ?? null,
      feedback: result.feedback,
      observed_at: at
    };
  } else if (result.status === 'completed') {
    const issuance = createCompletionCertificate({
      claim: next,
      review: next.delivery_review,
      issuedAt: at
    });
    if (!issuance.valid) {
      next.status = 'integrity_blocked';
      next.status_history.push({
        status: 'integrity_blocked',
        run_stamp: runStamp,
        updated_at: at,
        note: 'completion_certificate_issuance_refused',
        errors: issuance.errors
      });
      next.failure_history = list(next.failure_history);
      next.failure_history.push({
        at,
        run_stamp: runStamp,
        status: 'integrity_blocked',
        root_claim_id: next.root_claim_id,
        reason: 'completion_certificate_issuance_refused',
        errors: issuance.errors
      });
      delete next.completion_certificate;
    } else {
      next.completion_certificate = issuance.certificate;
      next.review_rework = {
        required: false,
        state: 'RESOLVED',
        root_claim_id: next.root_claim_id,
        resolved_at: at
      };
    }
  } else {
    // A PR can receive a new head or lose approval after a prior observation.
    // Do not retain a terminal receipt outside the exact completed state.
    delete next.completion_certificate;
  }
  return next;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith('--')) values.set(argv[index], argv[index + 1]);
  }
  return values;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command] = process.argv.slice(2);
  const args = parseArgs(process.argv.slice(3));
  if (command !== 'reconcile' || !args.get('--claim') || !args.get('--review') || !args.get('--reviewer') || !args.get('--implementation')) {
    process.stderr.write('usage: phase-loop-review-reconcile.mjs reconcile --claim <claim.json> --review <pr.json> --reviewer <login> --implementation <login> [--write] [--run <stamp>]\n');
    process.exit(64);
  }
  try {
    const claimPath = args.get('--claim');
    const reconciliation = reconcileReviewSnapshot({
      claim: readJson(claimPath),
      pullRequest: readJson(args.get('--review')),
      reviewer: args.get('--reviewer'),
      implementation: args.get('--implementation')
    });
    const next = applyReviewReconciliation({
      claim: readJson(claimPath),
      reconciliation,
      runStamp: args.get('--run') ?? ''
    });
    // Never persist an invalid reconciliation: keeping the prior claim is the
    // durable proof that the observed PR head was not admitted for delivery.
    if (args.has('--write') && reconciliation.valid) {
      const target = path.resolve(claimPath);
      const temporary = `${target}.${process.pid}.review-reconcile.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temporary, target);
      fs.chmodSync(target, 0o600);
    }
    process.stdout.write(`${JSON.stringify({ reconciliation, claim: next })}\n`);
    process.exit(reconciliation.valid ? 0 : 76);
  } catch (error) {
    process.stderr.write(`review_reconciliation_failed: ${error.message}\n`);
    process.exit(70);
  }
}
