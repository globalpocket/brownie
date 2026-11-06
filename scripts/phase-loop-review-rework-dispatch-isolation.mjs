#!/usr/bin/env node
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCleanMergedDeliveryCandidate } from './phase-loop-delivery-integrity.mjs';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonAtomically(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
    fs.chmodSync(file, 0o600);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function dispatchIdentity(claim) {
  const claimId = typeof claim?.claim_id === 'string' ? claim.claim_id : '';
  const review = claim?.review_rework;
  const recoveryId = typeof claim?.review_rework_fresh_dispatch_recovery_id === 'string'
    ? claim.review_rework_fresh_dispatch_recovery_id : '';
  const dispatchAttempt = claim?.review_rework_fresh_dispatch_attempt;
  if (!claimId) throw new Error('claim_identity_missing');
  if (!review || review.required !== true || review.state !== 'CHANGES_REQUESTED') {
    return null;
  }
  if (claim.review_rework_fresh_dispatch_pending !== true) return null;
  if (!recoveryId || !Number.isSafeInteger(dispatchAttempt) || dispatchAttempt < 1) {
    throw new Error('review_rework_fresh_dispatch_identity_invalid');
  }
  return { claimId, recoveryId, dispatchAttempt };
}

function matchingIsolation(value, identity) {
  return value
    && typeof value === 'object'
    && value.recovery_id === identity.recoveryId
    && value.dispatch_attempt === identity.dispatchAttempt;
}

function activeStorePaths(storeRoot, identity) {
  const claimDigest = sha256(identity.claimId);
  const recoveryDigest = sha256(identity.recoveryId).slice(0, 16);
  const activeStore = path.join(storeRoot, 'phase-loop-claims', claimDigest);
  const archiveDir = path.join(storeRoot, 'phase-loop-claim-archives', claimDigest);
  const archiveStore = path.join(archiveDir, `review-rework-${recoveryDigest}-dispatch-${identity.dispatchAttempt}`);
  return { claimDigest, recoveryDigest, activeStore, archiveDir, archiveStore };
}

function directoryFingerprint(root) {
  const hash = crypto.createHash('sha256');
  const visit = (directory, relative) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const child = path.join(directory, entry.name);
      const childRelative = relative ? path.join(relative, entry.name) : entry.name;
      const stat = fs.lstatSync(child);
      if (stat.isDirectory()) {
        hash.update(`directory\0${childRelative}\0`);
        visit(child, childRelative);
      } else if (stat.isFile()) {
        hash.update(`file\0${childRelative}\0`);
        hash.update(sha256(fs.readFileSync(child)));
        hash.update('\0');
      } else {
        throw new Error('review_rework_runtime_store_contains_unsupported_entry');
      }
    }
  };
  hash.update('brownie-review-rework-runtime-store-v1\0');
  visit(root, '');
  return hash.digest('hex');
}

function matchesPrimaryIsolationAudit({ auditPath, identity, claimDigest, activeStore, archiveStore }) {
  let audit;
  try {
    audit = readJson(auditPath);
  } catch {
    return false;
  }
  return audit?.schema_version === 1
    && audit.kind === 'phase_loop_review_rework_fresh_dispatch_runtime_store_isolation'
    && audit.claim_id === identity.claimId
    && audit.claim_sha256 === `sha256:${claimDigest}`
    && audit.recovery_id === identity.recoveryId
    && audit.dispatch_attempt === identity.dispatchAttempt
    && path.resolve(audit.active_store || '') === path.resolve(activeStore)
    && path.resolve(audit.archived_store || '') === path.resolve(archiveStore)
    && audit.recovery_policy === 'archive_prior_claim_runtime_store_then_require_same-claim-fresh-run';
}

function recoverInterruptedPostIsolationStore({ claim, claimPath, stateDir, identity, paths, now }) {
  const { claimDigest, recoveryDigest, activeStore, archiveStore } = paths;
  const primaryAuditPath = path.join(
    stateDir,
    'recovery-audits',
    `${recoveryDigest}-review-rework-dispatch-${identity.dispatchAttempt}-runtime-store-isolation.json`
  );
  // A pair of stores is recoverable only when the primary archive is already
  // proven to be this claim's prior state. Otherwise it could be an unrelated
  // or partially copied Runtime store and must remain fail-closed.
  if (!matchesPrimaryIsolationAudit({
    auditPath: primaryAuditPath,
    identity,
    claimDigest,
    activeStore,
    archiveStore,
  })) {
    return null;
  }

  const activeDigest = directoryFingerprint(activeStore);
  const interruptedStore = `${archiveStore}.interrupted-${activeDigest.slice(0, 16)}`;
  const interruptedAuditPath = path.join(
    stateDir,
    'recovery-audits',
    `${recoveryDigest}-review-rework-dispatch-${identity.dispatchAttempt}-interrupted-store-${activeDigest.slice(0, 16)}.json`
  );
  if (fs.existsSync(interruptedStore) || fs.existsSync(interruptedAuditPath)) {
    throw new Error('review_rework_runtime_store_interrupted_archive_collision');
  }

  const interruptedAudit = {
    schema_version: 1,
    kind: 'phase_loop_review_rework_interrupted_post_isolation_runtime_store_archive',
    recorded_at: now,
    claim_id: identity.claimId,
    claim_sha256: `sha256:${claimDigest}`,
    recovery_id: identity.recoveryId,
    dispatch_attempt: identity.dispatchAttempt,
    primary_isolation_audit_path: primaryAuditPath,
    source_store: activeStore,
    archived_store: interruptedStore,
    store_sha256: `sha256:${activeDigest}`,
    recovery_policy: 'preserve_interrupted_post_isolation_store_then_require_same-claim-fresh-run',
  };
  fs.renameSync(activeStore, interruptedStore);
  try {
    writeJsonAtomically(interruptedAuditPath, interruptedAudit);
    writeJsonAtomically(claimPath, {
      ...claim,
      review_rework_fresh_dispatch_store_isolation: {
        schema_version: 2,
        recovery_id: identity.recoveryId,
        dispatch_attempt: identity.dispatchAttempt,
        audit_path: primaryAuditPath,
        archived_store: archiveStore,
        interrupted_active_store_archive: interruptedStore,
        interrupted_active_store_audit_path: interruptedAuditPath,
        interrupted_active_store_sha256: `sha256:${activeDigest}`,
        isolated_at: now,
        recovered_after_interruption: true,
      },
    });
  } catch (error) {
    // `writeJsonAtomically` can fail while committing the claim after the
    // interrupted-store audit has already been persisted.  Restore the exact
    // pre-transaction layout in that case; otherwise the retained audit would
    // collide with the deterministic archive name and turn a transient I/O
    // failure into a permanent blocked claim.  If the claim was actually
    // committed before a post-rename failure (for example chmod), preserve
    // the completed transaction and let the normal idempotency branch verify
    // it on the next invocation.
    let claimCommitted = false;
    try {
      const persistedClaim = readJson(claimPath);
      const persistedIsolation = persistedClaim?.review_rework_fresh_dispatch_store_isolation;
      claimCommitted = matchingIsolation(persistedIsolation, identity)
        && persistedIsolation?.interrupted_active_store_archive === interruptedStore
        && persistedIsolation?.interrupted_active_store_audit_path === interruptedAuditPath
        && persistedIsolation?.interrupted_active_store_sha256 === `sha256:${activeDigest}`;
    } catch {
      claimCommitted = false;
    }
    if (!claimCommitted) {
      if (fs.existsSync(interruptedAuditPath)) fs.rmSync(interruptedAuditPath, { force: true });
      if (!fs.existsSync(activeStore) && fs.existsSync(interruptedStore)) {
        fs.renameSync(interruptedStore, activeStore);
      }
    }
    throw error;
  }
  return {
    ok: true,
    isolated: true,
    claim_id: identity.claimId,
    dispatch_attempt: identity.dispatchAttempt,
    audit_path: primaryAuditPath,
    archived_store: archiveStore,
    interrupted_active_store_archive: interruptedStore,
    interrupted_active_store_audit_path: interruptedAuditPath,
    recovered_after_interruption: true,
  };
}

function replayRepairIdentity(claim) {
  const review = claim?.review_rework;
  const claimId = typeof claim?.claim_id === 'string' ? claim.claim_id : '';
  const recoveryId = typeof claim?.review_rework_fresh_dispatch_recovery_id === 'string'
    ? claim.review_rework_fresh_dispatch_recovery_id : '';
  const dispatchAttempt = claim?.review_rework_fresh_dispatch_attempt;
  const rearmHistory = Array.isArray(claim?.review_rework_fresh_dispatch_rearm_history)
    ? claim.review_rework_fresh_dispatch_rearm_history : [];
  if (!claimId || !review || review.required !== true || review.state !== 'CHANGES_REQUESTED') return null;
  if (!recoveryId || !Number.isSafeInteger(dispatchAttempt) || dispatchAttempt < 2) return null;
  if (claim.review_rework_fresh_dispatch_pending === true) return null;
  if (claim.review_rework_fresh_dispatch_store_isolation) return null;
  if (rearmHistory.length !== 1 || rearmHistory[0]?.dispatch_attempt !== dispatchAttempt) return null;
  if (typeof claim.review_rework_fresh_dispatch_activated_run_stamp !== 'string'
      || !claim.review_rework_fresh_dispatch_activated_run_stamp) return null;
  return { claimId, recoveryId, dispatchAttempt };
}

function runtimeReplayWithoutExecution({ stateDir, claim, progressPath }) {
  let progress;
  try {
    progress = readJson(progressPath);
  } catch {
    return null;
  }
  const projection = progress?.progress_projection;
  const runStamp = typeof progress?.run_stamp === 'string' ? progress.run_stamp : '';
  if (!projection || !runStamp
      || progress.classification !== 'terminal_failure'
      || progress.meaningful_progress !== false
      || progress.workspace_changed !== false
      || !Number.isSafeInteger(progress.same_progress_count)
      || !Number.isSafeInteger(progress.stagnation_threshold)
      || progress.same_progress_count < progress.stagnation_threshold
      || projection.claim_id !== claim.claim_id
      || projection.objective_apply_pending !== true
      || projection.objective_apply_target_replay_exhausted !== true
      || projection.objective_apply_terminal_failure !== true
      || projection.controller_action !== 'resume'
      || projection.next_action !== 'apply_authorized_objective_proposal') {
    return null;
  }
  const evidencePath = path.join(stateDir, 'runs', `${runStamp}.execution-evidence.json`);
  let evidence;
  try {
    evidence = readJson(evidencePath);
  } catch {
    return null;
  }
  if (evidence.claim_id !== claim.claim_id
      || evidence.claim_matches !== true
      || evidence.task_execution_confirmed !== false
      || evidence.task_id !== null
      || evidence.runtime_run_id !== null) {
    return null;
  }
  const stdoutPath = typeof progress.stdout_log === 'string' ? progress.stdout_log : '';
  let stdout;
  try {
    stdout = readJson(stdoutPath);
  } catch {
    return null;
  }
  const payload = stdout?.resume;
  if (stdout?.command !== 'resume'
      || !payload
      || payload.replayed !== true
      || payload.status !== 'task_executed'
      || !Number.isSafeInteger(payload.candidate_count)
      || payload.candidate_count < 1
      || payload.task_id !== null
      || payload.run_id !== null
      || payload.next_action !== 'apply_authorized_objective_proposal') {
    return null;
  }
  return { runStamp, evidencePath, stdoutPath };
}

/**
 * Repair exactly one historical gap in the original re-arm implementation:
 * a same-claim fresh dispatch that was admitted before its Runtime store was
 * isolated.  The proof deliberately requires a terminalized sequence of
 * replay-only resume results with no task execution.  Anything less remains
 * blocked for ordinary diagnosis rather than becoming an implicit retry.
 */
export function prepareReviewReworkStaleReplayStoreIsolationRepair({ stateDir, claimPath, progressPath, now = new Date().toISOString() }) {
  const claim = readJson(claimPath);
  const priorRepair = claim.review_rework_fresh_dispatch_store_isolation_repair;
  if (priorRepair) {
    const recoveryId = typeof claim.review_rework_fresh_dispatch_recovery_id === 'string'
      ? claim.review_rework_fresh_dispatch_recovery_id : '';
    const dispatchAttempt = claim.review_rework_fresh_dispatch_attempt;
    const recoveryDigest = recoveryId ? sha256(recoveryId).slice(0, 16) : '';
    const auditPath = recoveryDigest && Number.isSafeInteger(dispatchAttempt)
      ? path.join(
          stateDir,
          'recovery-audits',
          `${recoveryDigest}-review-rework-dispatch-${dispatchAttempt}-stale-replay-store-isolation-repair.json`
        )
      : '';
    if (claim?.review_rework?.required === true
        && claim.review_rework.state === 'CHANGES_REQUESTED'
        && matchingIsolation(priorRepair, { recoveryId, dispatchAttempt })
        && auditPath
        && fs.existsSync(auditPath)) {
      return {
        ok: true,
        prepared: false,
        reason: 'review_rework_stale_replay_store_isolation_repair_already_prepared',
        claim_id: claim.claim_id,
        dispatch_attempt: dispatchAttempt,
        audit_path: auditPath,
      };
    }
    throw new Error('review_rework_stale_replay_store_isolation_repair_evidence_invalid');
  }
  const identity = replayRepairIdentity(claim);
  if (!identity) return { ok: true, prepared: false, reason: 'review_rework_stale_replay_repair_not_applicable' };
  const proof = runtimeReplayWithoutExecution({ stateDir, claim, progressPath });
  if (!proof) return { ok: true, prepared: false, reason: 'review_rework_stale_replay_proof_not_satisfied' };

  const recoveryDigest = sha256(identity.recoveryId).slice(0, 16);
  const auditPath = path.join(
    stateDir,
    'recovery-audits',
    `${recoveryDigest}-review-rework-dispatch-${identity.dispatchAttempt}-stale-replay-store-isolation-repair.json`
  );
  const audit = {
    schema_version: 1,
    kind: 'phase_loop_review_rework_stale_replay_runtime_store_isolation_repair',
    recorded_at: now,
    claim_id: identity.claimId,
    recovery_id: identity.recoveryId,
    dispatch_attempt: identity.dispatchAttempt,
    proof: {
      run_stamp: proof.runStamp,
      execution_evidence_path: proof.evidencePath,
      stdout_path: proof.stdoutPath,
      required: 'same_claim_review_rework_replay_without_current_task_or_run_execution',
    },
    recovery_policy: 'one_time_same_claim_store_isolation_then_require_fresh_run',
  };
  if (!fs.existsSync(auditPath)) writeJsonAtomically(auditPath, audit);
  const repairedClaim = {
    ...claim,
    status: 'in_progress',
    review_rework_fresh_dispatch_pending: true,
    review_rework_fresh_dispatch_reason: 'same_claim_review_rework_replay_without_current_task_or_run_execution',
    review_rework_fresh_dispatch_requested_at: now,
    review_rework_fresh_dispatch_store_isolation_repair: {
      schema_version: 1,
      recovery_id: identity.recoveryId,
      dispatch_attempt: identity.dispatchAttempt,
      audit_path: auditPath,
      prepared_at: now,
    },
    status_history: [
      ...(Array.isArray(claim.status_history) ? claim.status_history : []),
      {
        status: 'fresh_runtime_dispatch_required',
        updated_at: now,
        note: 'one-time stale same-claim Runtime replay repair requires store isolation before a fresh run',
      },
    ],
    updated_at: now,
  };
  writeJsonAtomically(claimPath, repairedClaim);
  return {
    ok: true,
    prepared: true,
    claim_id: identity.claimId,
    dispatch_attempt: identity.dispatchAttempt,
    audit_path: auditPath,
  };
}

/**
 * A review-rework re-arm keeps the claim identity deliberately stable. Runtime
 * state must not therefore remain stable: an old continuation can otherwise
 * replay a rejected proposal while appearing to be a fresh dispatch. Archive
 * the claim-local store once for the durable re-arm generation, then let the
 * normal dispatch create an empty store at the same claim path.
 */
export function isolateReviewReworkFreshDispatchRuntimeStore({ storeRoot, stateDir, claimPath, now = new Date().toISOString() }) {
  const claim = readJson(claimPath);
  const identity = dispatchIdentity(claim);
  if (!identity) return { ok: true, isolated: false, reason: 'review_rework_fresh_dispatch_not_pending' };

  const paths = activeStorePaths(storeRoot, identity);
  const { claimDigest, recoveryDigest, activeStore, archiveDir, archiveStore } = paths;
  const auditPath = path.join(
    stateDir,
    'recovery-audits',
    `${recoveryDigest}-review-rework-dispatch-${identity.dispatchAttempt}-runtime-store-isolation.json`
  );
  const existingIsolation = claim.review_rework_fresh_dispatch_store_isolation;

  if (matchingIsolation(existingIsolation, identity)) {
    const priorStoreAbsent = existingIsolation.prior_store_absent === true;
    if (!fs.existsSync(auditPath)
        || (!priorStoreAbsent && !fs.statSync(archiveStore, { throwIfNoEntry: false })?.isDirectory())) {
      throw new Error('review_rework_runtime_store_isolation_evidence_missing');
    }
    return {
      ok: true,
      isolated: false,
      reason: priorStoreAbsent
        ? 'review_rework_runtime_store_already_verified_absent'
        : 'review_rework_runtime_store_already_isolated',
      claim_id: identity.claimId,
      dispatch_attempt: identity.dispatchAttempt,
      audit_path: auditPath,
      archived_store: priorStoreAbsent ? null : archiveStore,
    };
  }

  const activeExists = fs.statSync(activeStore, { throwIfNoEntry: false })?.isDirectory() === true;
  const archiveExists = fs.statSync(archiveStore, { throwIfNoEntry: false })?.isDirectory() === true;
  if (activeExists && archiveExists) {
    const recovered = recoverInterruptedPostIsolationStore({
      claim,
      claimPath,
      stateDir,
      identity,
      paths,
      now,
    });
    if (recovered) return recovered;
    throw new Error('review_rework_runtime_store_isolation_ambiguous');
  }
  // An unstarted fresh dispatch has no store to inherit, which is already the
  // safe empty-store state.  Record that fact on the claim so a later resume
  // cannot reinterpret it as an unfinished archive transaction.
  if (!activeExists && !archiveExists) {
    const audit = {
      schema_version: 1,
      kind: 'phase_loop_review_rework_fresh_dispatch_runtime_store_isolation',
      recorded_at: now,
      claim_id: identity.claimId,
      claim_sha256: `sha256:${claimDigest}`,
      recovery_id: identity.recoveryId,
      dispatch_attempt: identity.dispatchAttempt,
      active_store: activeStore,
      archived_store: null,
      recovery_policy: 'no_prior_claim_runtime_store_require_same-claim-fresh-run',
      recovered_after_interruption: false,
    };
    if (!fs.existsSync(auditPath)) writeJsonAtomically(auditPath, audit);
    writeJsonAtomically(claimPath, {
      ...claim,
      review_rework_fresh_dispatch_store_isolation: {
        schema_version: 1,
        recovery_id: identity.recoveryId,
        dispatch_attempt: identity.dispatchAttempt,
        audit_path: auditPath,
        archived_store: null,
        isolated_at: now,
        prior_store_absent: true,
      },
    });
    return {
      ok: true,
      isolated: true,
      prior_store_absent: true,
      claim_id: identity.claimId,
      dispatch_attempt: identity.dispatchAttempt,
      audit_path: auditPath,
      archived_store: null,
    };
  }

  const recoveredAfterInterruption = !activeExists && archiveExists;
  const audit = {
    schema_version: 1,
    kind: 'phase_loop_review_rework_fresh_dispatch_runtime_store_isolation',
    recorded_at: now,
    claim_id: identity.claimId,
    claim_sha256: `sha256:${claimDigest}`,
    recovery_id: identity.recoveryId,
    dispatch_attempt: identity.dispatchAttempt,
    active_store: activeStore,
    archived_store: archiveStore,
    recovery_policy: 'archive_prior_claim_runtime_store_then_require_same-claim-fresh-run',
    recovered_after_interruption: recoveredAfterInterruption,
  };

  if (!recoveredAfterInterruption) {
    fs.mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
    fs.renameSync(activeStore, archiveStore);
  }
  try {
    if (!fs.existsSync(auditPath)) writeJsonAtomically(auditPath, audit);
    const updatedClaim = {
      ...claim,
      review_rework_fresh_dispatch_store_isolation: {
        schema_version: 1,
        recovery_id: identity.recoveryId,
        dispatch_attempt: identity.dispatchAttempt,
        audit_path: auditPath,
        archived_store: archiveStore,
        isolated_at: now,
      },
    };
    writeJsonAtomically(claimPath, updatedClaim);
    return {
      ok: true,
      isolated: true,
      claim_id: identity.claimId,
      dispatch_attempt: identity.dispatchAttempt,
      audit_path: auditPath,
      archived_store: archiveStore,
      recovered_after_interruption: recoveredAfterInterruption,
    };
  } catch (error) {
    if (!recoveredAfterInterruption && !fs.existsSync(activeStore) && fs.existsSync(archiveStore)) {
      fs.renameSync(archiveStore, activeStore);
    }
    throw error;
  }
}

function mergedDeliveryFreshDispatchIdentity(claim) {
  const recovery = claim?.merged_delivery_fresh_dispatch_recovery;
  if (claim?.merged_delivery_fresh_dispatch_pending !== true || !recovery || typeof recovery !== 'object') return null;
  const claimId = typeof claim.claim_id === 'string' ? claim.claim_id : '';
  const recoveryId = typeof recovery.recovery_id === 'string' ? recovery.recovery_id : '';
  const dispatchAttempt = recovery.dispatch_attempt;
  if (!claimId || !recoveryId || !Number.isSafeInteger(dispatchAttempt) || dispatchAttempt < 1) {
    throw new Error('merged_delivery_fresh_dispatch_identity_invalid');
  }
  return { claimId, recoveryId, dispatchAttempt };
}

function noEligibleResumeProof({ claim, progressPath }) {
  let progress;
  try {
    progress = readJson(progressPath);
  } catch {
    return null;
  }
  const projection = progress?.progress_projection;
  const stdoutPath = typeof progress?.stdout_log === 'string' ? progress.stdout_log : '';
  if (!projection || progress.classification !== 'terminal_failure'
      || progress.meaningful_progress !== false || progress.workspace_changed !== false
      || projection.claim_id !== claim.claim_id || !stdoutPath) return null;
  let stdout;
  try {
    stdout = readJson(stdoutPath);
  } catch {
    return null;
  }
  const resume = stdout?.resume;
  if (stdout?.command !== 'resume' || !resume || resume.status !== 'no_eligible_task'
      || resume.candidate_count !== 0 || resume.controller_action !== 'stop') return null;
  const previousEvidencePath = typeof claim.terminal_failure_execution_evidence_path === 'string'
    ? claim.terminal_failure_execution_evidence_path : '';
  let previousEvidence;
  try {
    previousEvidence = readJson(previousEvidencePath);
  } catch {
    return null;
  }
  if (previousEvidence.claim_id !== claim.claim_id || previousEvidence.claim_matches !== true
      || previousEvidence.task_execution_confirmed !== true) return null;
  return { stdoutPath, previousEvidencePath, runStamp: progress.run_stamp };
}

/**
 * A reviewed product delivery can land while the original Runtime claim is
 * still holding a continuation store. When the continuation subsequently
 * reports `no_eligible_task`, preserve both receipts and require one new
 * same-claim `run`; a resume would only replay the exhausted session. This is
 * deliberately narrower than retry: it requires an earlier executed task,
 * the exact no-eligible terminal shape, and a clean bounded merged lineage.
 */
export function prepareMergedDeliveryFreshDispatchRecovery({ repoRoot, stateDir, claimPath, progressPath, now = new Date().toISOString() }) {
  const claim = readJson(claimPath);
  const existing = claim.merged_delivery_fresh_dispatch_recovery;
  if (existing) {
    // The marker is cleared atomically immediately before the replacement
    // Runtime `run`. Keep its immutable audit on the claim afterwards, but
    // never try to prepare or isolate that completed dispatch a second time.
    if (claim.merged_delivery_fresh_dispatch_pending !== true
        && typeof claim.merged_delivery_fresh_dispatch_activated_run_stamp === 'string'
        && claim.merged_delivery_fresh_dispatch_activated_run_stamp) {
      return { ok: true, prepared: false, reason: 'merged_delivery_fresh_dispatch_already_activated', claim_id: claim.claim_id };
    }
    const identity = mergedDeliveryFreshDispatchIdentity(claim);
    const auditPath = identity && path.join(stateDir, 'recovery-audits', `${sha256(identity.recoveryId).slice(0, 16)}-merged-delivery-dispatch-${identity.dispatchAttempt}.json`);
    if (identity && auditPath && fs.existsSync(auditPath)) {
      return { ok: true, prepared: false, reason: 'merged_delivery_fresh_dispatch_already_prepared', claim_id: identity.claimId, audit_path: auditPath };
    }
    throw new Error('merged_delivery_fresh_dispatch_recovery_evidence_invalid');
  }
  // Never overlap the pre-existing review-rework recovery grammar.
  if (claim.review_rework_fresh_dispatch_pending === true) {
    return { ok: true, prepared: false, reason: 'merged_delivery_fresh_dispatch_review_rework_owned' };
  }
  const noEligible = noEligibleResumeProof({ claim, progressPath });
  if (!noEligible) return { ok: true, prepared: false, reason: 'merged_delivery_fresh_dispatch_no_eligible_proof_not_satisfied' };
  const candidate = findCleanMergedDeliveryCandidate({ repoRoot, selectedTodo: claim.selected_todo });
  if (!candidate.valid) return { ok: true, prepared: false, reason: candidate.reason };
  const recoveryId = `sha256:${sha256(JSON.stringify({
    claim_id: claim.claim_id,
    selected_todo_sha256: candidate.candidate.selected_todo_sha256,
    merge_lineage: candidate.candidate.merge_lineage.map((entry) => entry.merge_commit_oid),
    no_eligible_stdout: noEligible.stdoutPath,
    prior_execution_evidence: noEligible.previousEvidencePath,
  }))}`;
  const identity = { claimId: claim.claim_id, recoveryId, dispatchAttempt: 1 };
  const recoveryDigest = sha256(recoveryId).slice(0, 16);
  const auditPath = path.join(stateDir, 'recovery-audits', `${recoveryDigest}-merged-delivery-dispatch-1.json`);
  const audit = {
    schema_version: 1,
    kind: 'phase_loop_merged_delivery_no_eligible_fresh_dispatch_recovery',
    recorded_at: now,
    claim_id: claim.claim_id,
    recovery_id: recoveryId,
    dispatch_attempt: 1,
    no_eligible_resume: noEligible,
    candidate: candidate.candidate,
    recovery_policy: 'archive_same_claim_runtime_store_then_require_one_fresh_run',
  };
  if (!fs.existsSync(auditPath)) writeJsonAtomically(auditPath, audit);
  writeJsonAtomically(claimPath, {
    ...claim,
    status: 'in_progress',
    merged_delivery_fresh_dispatch_pending: true,
    merged_delivery_fresh_dispatch_recovery: {
      schema_version: 1,
      recovery_id: recoveryId,
      dispatch_attempt: 1,
      audit_path: auditPath,
      candidate: candidate.candidate,
      prepared_at: now,
    },
    status_history: [...(Array.isArray(claim.status_history) ? claim.status_history : []), {
      status: 'fresh_runtime_dispatch_required',
      updated_at: now,
      note: 'executed claim later reached no_eligible_task after bounded merged delivery; stale store must be isolated before one fresh run',
    }],
    updated_at: now,
  });
  return { ok: true, prepared: true, claim_id: identity.claimId, audit_path: auditPath, recovery_id: recoveryId };
}

export function isolateMergedDeliveryFreshDispatchRuntimeStore({ storeRoot, stateDir, claimPath, now = new Date().toISOString() }) {
  const claim = readJson(claimPath);
  const identity = mergedDeliveryFreshDispatchIdentity(claim);
  if (!identity) return { ok: true, isolated: false, reason: 'merged_delivery_fresh_dispatch_not_pending' };
  const claimDigest = sha256(identity.claimId);
  const recoveryDigest = sha256(identity.recoveryId).slice(0, 16);
  const activeStore = path.join(storeRoot, 'phase-loop-claims', claimDigest);
  const archiveStore = path.join(storeRoot, 'phase-loop-claim-archives', claimDigest, `merged-delivery-${recoveryDigest}-dispatch-${identity.dispatchAttempt}`);
  const auditPath = path.join(stateDir, 'recovery-audits', `${recoveryDigest}-merged-delivery-dispatch-${identity.dispatchAttempt}-runtime-store-isolation.json`);
  const previous = claim.merged_delivery_fresh_dispatch_store_isolation;
  if (matchingIsolation(previous, identity)) {
    if (!fs.existsSync(auditPath)) throw new Error('merged_delivery_runtime_store_isolation_evidence_missing');
    return { ok: true, isolated: false, reason: 'merged_delivery_runtime_store_already_isolated', claim_id: identity.claimId, audit_path: auditPath, archived_store: previous.archived_store ?? null };
  }
  const activeExists = fs.statSync(activeStore, { throwIfNoEntry: false })?.isDirectory() === true;
  const archiveExists = fs.statSync(archiveStore, { throwIfNoEntry: false })?.isDirectory() === true;
  if (activeExists && archiveExists) throw new Error('merged_delivery_runtime_store_isolation_ambiguous');
  if (activeExists) {
    fs.mkdirSync(path.dirname(archiveStore), { recursive: true, mode: 0o700 });
    fs.renameSync(activeStore, archiveStore);
  }
  const audit = {
    schema_version: 1,
    kind: 'phase_loop_merged_delivery_fresh_dispatch_runtime_store_isolation',
    recorded_at: now,
    claim_id: identity.claimId,
    recovery_id: identity.recoveryId,
    dispatch_attempt: identity.dispatchAttempt,
    active_store: activeStore,
    archived_store: activeExists || archiveExists ? archiveStore : null,
    recovery_policy: activeExists || archiveExists
      ? 'archive_prior_claim_runtime_store_then_require_same-claim-fresh-run'
      : 'no_prior_claim_runtime_store_require_same-claim-fresh-run',
  };
  try {
    if (!fs.existsSync(auditPath)) writeJsonAtomically(auditPath, audit);
    writeJsonAtomically(claimPath, {
      ...claim,
      merged_delivery_fresh_dispatch_store_isolation: {
        schema_version: 1,
        recovery_id: identity.recoveryId,
        dispatch_attempt: identity.dispatchAttempt,
        audit_path: auditPath,
        archived_store: audit.archived_store,
        isolated_at: now,
      },
    });
  } catch (error) {
    if (activeExists && !fs.existsSync(activeStore) && fs.existsSync(archiveStore)) fs.renameSync(archiveStore, activeStore);
    throw error;
  }
  return { ok: true, isolated: true, claim_id: identity.claimId, audit_path: auditPath, archived_store: audit.archived_store };
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || value.includes('\\') || /[\r\n\0]/.test(value)) return null;
  const parsed = path.posix.normalize(value);
  if (parsed === '.' || parsed.startsWith('../') || path.posix.isAbsolute(parsed)) return null;
  return parsed;
}

function declaredPatchTargets(selectedTodo) {
  const firstLine = typeof selectedTodo === 'string' ? (selectedTodo.split(/\r?\n/, 1)[0] || '') : '';
  const markers = [...firstLine.matchAll(/\b(Patch|Create)\s+only\b/gi)];
  const targets = [];
  for (let index = 0; index < markers.length; index += 1) {
    const start = markers[index].index + markers[index][0].length;
    const end = index + 1 < markers.length ? markers[index + 1].index : firstLine.length;
    for (const match of firstLine.slice(start, end).matchAll(/`([^`\r\n]+)`/g)) {
      const target = safeRelativePath(match[1].trim());
      if (target && !targets.includes(target)) targets.push(target);
    }
  }
  return targets;
}

function objectiveApplyNoEligibleIdentity(claim) {
  const recovery = claim?.objective_apply_no_eligible_fresh_dispatch_recovery;
  if (claim?.objective_apply_no_eligible_fresh_dispatch_pending !== true || !recovery || typeof recovery !== 'object') return null;
  const claimId = typeof claim.claim_id === 'string' ? claim.claim_id : '';
  const recoveryId = typeof recovery.recovery_id === 'string' ? recovery.recovery_id : '';
  const dispatchAttempt = recovery.dispatch_attempt;
  if (!claimId || !recoveryId || !Number.isSafeInteger(dispatchAttempt) || dispatchAttempt !== 1) {
    throw new Error('objective_apply_no_eligible_fresh_dispatch_identity_invalid');
  }
  return { claimId, recoveryId, dispatchAttempt };
}

function noEligibleObjectiveApplyProof({ repoRoot, stateDir, claim, progressPath }) {
  let progress;
  try {
    progress = readJson(progressPath);
  } catch {
    return null;
  }
  const projection = progress?.progress_projection;
  const runStamp = typeof progress?.run_stamp === 'string' ? progress.run_stamp : '';
  const stdoutPath = typeof progress?.stdout_log === 'string' ? progress.stdout_log : '';
  if (!projection || !runStamp || !stdoutPath
      || progress.classification !== 'terminal_failure'
      || progress.meaningful_progress !== false
      || progress.workspace_changed !== false
      || projection.claim_id !== claim.claim_id) return null;
  let stdout;
  let noExecutionEvidence;
  try {
    stdout = readJson(stdoutPath);
    noExecutionEvidence = readJson(path.join(stateDir, 'runs', `${runStamp}.execution-evidence.json`));
  } catch {
    return null;
  }
  const resume = stdout?.resume;
  if (stdout?.command !== 'resume'
      || resume?.status !== 'no_eligible_task'
      || resume?.candidate_count !== 0
      || resume?.controller_action !== 'stop'
      || resume?.task_id !== null
      || resume?.run_id !== null
      || resume?.phase_loop_claim_id !== claim.claim_id
      || noExecutionEvidence?.claim_id !== claim.claim_id
      || noExecutionEvidence?.claim_matches !== true
      || noExecutionEvidence?.task_execution_confirmed !== false
      || noExecutionEvidence?.task_id !== null
      || noExecutionEvidence?.runtime_run_id !== null) return null;

  const priorEvidencePath = typeof claim.terminal_failure_execution_evidence_path === 'string'
    ? claim.terminal_failure_execution_evidence_path : '';
  let priorEvidence;
  try {
    priorEvidence = readJson(priorEvidencePath);
  } catch {
    return null;
  }
  const durable = priorEvidence?.durable_apply_evidence;
  const declaredTargets = declaredPatchTargets(claim.selected_todo);
  const appliedTarget = safeRelativePath(durable?.target_path);
  if (priorEvidence?.claim_id !== claim.claim_id
      || priorEvidence?.claim_matches !== true
      || priorEvidence?.task_execution_confirmed !== true
      || !durable || durable.claim_id !== claim.claim_id
      || durable.selected_todo_sha256 !== claim.selected_todo_sha256
      || !appliedTarget || !declaredTargets.includes(appliedTarget)
      || typeof durable.post_write_target_sha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(durable.post_write_target_sha256)
      || declaredTargets.length !== 2) return null;
  const continuationTargets = declaredTargets.filter((target) => target !== appliedTarget);
  if (continuationTargets.length !== 1) return null;
  const continuationTarget = continuationTargets[0];
  const appliedAbsolute = path.join(repoRoot, appliedTarget);
  if (!fs.statSync(appliedAbsolute, { throwIfNoEntry: false })?.isFile()
      || sha256(fs.readFileSync(appliedAbsolute)) !== durable.post_write_target_sha256) return null;
  try {
    // The remaining target must still be the untouched half of this exact
    // two-target contract. A fresh dispatch may never absorb a user edit.
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--', continuationTarget], { cwd: repoRoot });
  } catch (error) {
    if (error?.status === 1) return null;
    throw error;
  }
  return {
    runStamp,
    stdoutPath,
    noExecutionEvidencePath: path.join(stateDir, 'runs', `${runStamp}.execution-evidence.json`),
    priorEvidencePath,
    appliedTarget,
    appliedTargetSha256: durable.post_write_target_sha256,
    continuationTarget,
  };
}

/**
 * Runtime may successfully apply the first half of an explicit two-target
 * TODO, then lose every eligible continuation on its bound `resume`. This is
 * not a license to replay the first mutation or to split/rewrite the TODO.
 * Preserve the proven first write, prove the second target is untouched, and
 * admit exactly one fresh same-claim dispatch whose prompt is constrained to
 * that remaining target.
 */
export function prepareObjectiveApplyNoEligibleFreshDispatchRecovery({ repoRoot, stateDir, claimPath, progressPath, now = new Date().toISOString() }) {
  const claim = readJson(claimPath);
  const existing = claim.objective_apply_no_eligible_fresh_dispatch_recovery;
  if (existing) {
    if (claim.objective_apply_no_eligible_fresh_dispatch_pending !== true
        && typeof claim.objective_apply_no_eligible_fresh_dispatch_activated_run_stamp === 'string'
        && claim.objective_apply_no_eligible_fresh_dispatch_activated_run_stamp) {
      return { ok: true, prepared: false, reason: 'objective_apply_no_eligible_fresh_dispatch_already_activated', claim_id: claim.claim_id };
    }
    const identity = objectiveApplyNoEligibleIdentity(claim);
    const auditPath = identity && path.join(stateDir, 'recovery-audits', `${sha256(identity.recoveryId).slice(0, 16)}-objective-apply-no-eligible-dispatch-${identity.dispatchAttempt}.json`);
    if (identity && auditPath && fs.existsSync(auditPath)) {
      return { ok: true, prepared: false, reason: 'objective_apply_no_eligible_fresh_dispatch_already_prepared', claim_id: identity.claimId, audit_path: auditPath };
    }
    throw new Error('objective_apply_no_eligible_fresh_dispatch_recovery_evidence_invalid');
  }
  if (claim.review_rework_fresh_dispatch_pending === true || claim.merged_delivery_fresh_dispatch_pending === true) {
    return { ok: true, prepared: false, reason: 'objective_apply_no_eligible_fresh_dispatch_owned_by_other_recovery' };
  }
  const proof = noEligibleObjectiveApplyProof({ repoRoot, stateDir, claim, progressPath });
  if (!proof) return { ok: true, prepared: false, reason: 'objective_apply_no_eligible_fresh_dispatch_proof_not_satisfied' };
  const recoveryId = `sha256:${sha256(JSON.stringify({
    claim_id: claim.claim_id,
    selected_todo_sha256: claim.selected_todo_sha256,
    applied_target: proof.appliedTarget,
    applied_target_sha256: proof.appliedTargetSha256,
    continuation_target: proof.continuationTarget,
    prior_execution_evidence: proof.priorEvidencePath,
    no_eligible_stdout: proof.stdoutPath,
  }))}`;
  const identity = { claimId: claim.claim_id, recoveryId, dispatchAttempt: 1 };
  const recoveryDigest = sha256(recoveryId).slice(0, 16);
  const auditPath = path.join(stateDir, 'recovery-audits', `${recoveryDigest}-objective-apply-no-eligible-dispatch-1.json`);
  const audit = {
    schema_version: 1,
    kind: 'phase_loop_objective_apply_no_eligible_fresh_dispatch_recovery',
    recorded_at: now,
    claim_id: claim.claim_id,
    recovery_id: recoveryId,
    dispatch_attempt: 1,
    proof,
    recovery_policy: 'preserve_verified_first_target_archive_same_claim_runtime_store_require_one_fresh_dispatch_for_untouched_remaining_target',
  };
  if (!fs.existsSync(auditPath)) writeJsonAtomically(auditPath, audit);
  const scope = claim.objective_apply_resume_scope;
  const scopeHistory = Array.isArray(claim.objective_apply_resume_scope_history)
    ? [...claim.objective_apply_resume_scope_history] : [];
  if (scope && typeof scope === 'object') {
    scopeHistory.push({
      at: now,
      event: 'invalidated_after_no_eligible_verification_resume',
      source_run_stamp: scope.source_run_stamp,
      recovery_id: recoveryId,
    });
  }
  writeJsonAtomically(claimPath, {
    ...claim,
    status: 'in_progress',
    ...(scope && typeof scope === 'object' ? { objective_apply_resume_scope: { ...scope, state: 'invalidated' } } : {}),
    ...(scopeHistory.length ? { objective_apply_resume_scope_history: scopeHistory.slice(-12) } : {}),
    objective_apply_no_eligible_fresh_dispatch_pending: true,
    objective_apply_no_eligible_fresh_dispatch_recovery: {
      schema_version: 1,
      recovery_id: recoveryId,
      dispatch_attempt: 1,
      audit_path: auditPath,
      applied_target_path: proof.appliedTarget,
      applied_target_sha256: proof.appliedTargetSha256,
      continuation_target_path: proof.continuationTarget,
      prepared_at: now,
    },
    status_history: [...(Array.isArray(claim.status_history) ? claim.status_history : []), {
      status: 'fresh_runtime_dispatch_required',
      updated_at: now,
      note: 'verified first target then no-eligible verification resume; archive the stale store and dispatch only the untouched remaining target once',
    }],
    updated_at: now,
  });
  return {
    ok: true,
    prepared: true,
    claim_id: identity.claimId,
    audit_path: auditPath,
    recovery_id: recoveryId,
    continuation_target_path: proof.continuationTarget,
  };
}

export function isolateObjectiveApplyNoEligibleFreshDispatchRuntimeStore({ storeRoot, stateDir, claimPath, now = new Date().toISOString() }) {
  const claim = readJson(claimPath);
  const identity = objectiveApplyNoEligibleIdentity(claim);
  if (!identity) return { ok: true, isolated: false, reason: 'objective_apply_no_eligible_fresh_dispatch_not_pending' };
  const claimDigest = sha256(identity.claimId);
  const recoveryDigest = sha256(identity.recoveryId).slice(0, 16);
  const activeStore = path.join(storeRoot, 'phase-loop-claims', claimDigest);
  const archiveStore = path.join(storeRoot, 'phase-loop-claim-archives', claimDigest, `objective-apply-no-eligible-${recoveryDigest}-dispatch-${identity.dispatchAttempt}`);
  const auditPath = path.join(stateDir, 'recovery-audits', `${recoveryDigest}-objective-apply-no-eligible-dispatch-${identity.dispatchAttempt}-runtime-store-isolation.json`);
  const previous = claim.objective_apply_no_eligible_fresh_dispatch_store_isolation;
  if (matchingIsolation(previous, identity)) {
    if (!fs.existsSync(auditPath)) throw new Error('objective_apply_no_eligible_runtime_store_isolation_evidence_missing');
    return { ok: true, isolated: false, reason: 'objective_apply_no_eligible_runtime_store_already_isolated', claim_id: identity.claimId, audit_path: auditPath, archived_store: previous.archived_store ?? null };
  }
  const activeExists = fs.statSync(activeStore, { throwIfNoEntry: false })?.isDirectory() === true;
  const archiveExists = fs.statSync(archiveStore, { throwIfNoEntry: false })?.isDirectory() === true;
  if (activeExists && archiveExists) throw new Error('objective_apply_no_eligible_runtime_store_isolation_ambiguous');
  if (activeExists) {
    fs.mkdirSync(path.dirname(archiveStore), { recursive: true, mode: 0o700 });
    fs.renameSync(activeStore, archiveStore);
  }
  const audit = {
    schema_version: 1,
    kind: 'phase_loop_objective_apply_no_eligible_fresh_dispatch_runtime_store_isolation',
    recorded_at: now,
    claim_id: identity.claimId,
    recovery_id: identity.recoveryId,
    dispatch_attempt: identity.dispatchAttempt,
    active_store: activeStore,
    archived_store: activeExists || archiveExists ? archiveStore : null,
    recovery_policy: activeExists || archiveExists
      ? 'archive_prior_claim_runtime_store_then_require_same-claim-fresh-run-for_remaining_target'
      : 'no_prior_claim_runtime_store_require_same-claim-fresh-run-for_remaining_target',
  };
  try {
    if (!fs.existsSync(auditPath)) writeJsonAtomically(auditPath, audit);
    writeJsonAtomically(claimPath, {
      ...claim,
      objective_apply_no_eligible_fresh_dispatch_store_isolation: {
        schema_version: 1,
        recovery_id: identity.recoveryId,
        dispatch_attempt: identity.dispatchAttempt,
        audit_path: auditPath,
        archived_store: audit.archived_store,
        isolated_at: now,
      },
    });
  } catch (error) {
    if (activeExists && !fs.existsSync(activeStore) && fs.existsSync(archiveStore)) fs.renameSync(archiveStore, activeStore);
    throw error;
  }
  return { ok: true, isolated: true, claim_id: identity.claimId, audit_path: auditPath, archived_store: audit.archived_store };
}

export function verifyObjectiveApplyNoEligibleContinuationTarget({ repoRoot, claimPath, runStamp }) {
  // A normal successful Runtime terminalization removes current.json before
  // post-dispatch checks run. That path has no recovery marker to protect, so
  // it must remain outside this narrowly scoped first-target immutability
  // guard rather than being converted into a false recovery failure.
  if (!fs.existsSync(claimPath)) return { ok: true, applicable: false, reason: 'claim_absent_after_runtime_terminalization' };
  const claim = readJson(claimPath);
  const recovery = claim.objective_apply_no_eligible_fresh_dispatch_recovery;
  if (!recovery || typeof recovery !== 'object') return { ok: true, applicable: false };
  if (claim.objective_apply_no_eligible_fresh_dispatch_activated_run_stamp !== runStamp) return { ok: true, applicable: false };
  const appliedTarget = safeRelativePath(recovery.applied_target_path);
  const continuationTarget = safeRelativePath(recovery.continuation_target_path);
  if (!appliedTarget || !continuationTarget || appliedTarget === continuationTarget
      || typeof recovery.applied_target_sha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(recovery.applied_target_sha256)) {
    throw new Error('objective_apply_no_eligible_recovery_target_binding_invalid');
  }
  const currentTarget = path.join(repoRoot, appliedTarget);
  if (!fs.statSync(currentTarget, { throwIfNoEntry: false })?.isFile()
      || sha256(fs.readFileSync(currentTarget)) !== recovery.applied_target_sha256) {
    throw new Error('objective_apply_no_eligible_recovery_replayed_or_tampered_first_target');
  }
  return { ok: true, applicable: true, applied_target_path: appliedTarget, continuation_target_path: continuationTarget };
}

function readOption(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const [command, ...args] = process.argv.slice(2);
  if (!['isolate', 'repair-stale-replay', 'prepare-merged-delivery', 'isolate-merged-delivery', 'prepare-objective-apply-no-eligible', 'isolate-objective-apply-no-eligible', 'verify-objective-apply-continuation-target'].includes(command)) {
    process.stderr.write('usage: phase-loop-review-rework-dispatch-isolation.mjs <isolate|repair-stale-replay|prepare-merged-delivery|isolate-merged-delivery|prepare-objective-apply-no-eligible|isolate-objective-apply-no-eligible|verify-objective-apply-continuation-target> --state-dir <path> --claim <path> [--store-root <path>] [--progress <path>] [--repo <path>] [--run-stamp <stamp>]\n');
    process.exit(64);
  }
  try {
    const result = command === 'isolate'
      ? isolateReviewReworkFreshDispatchRuntimeStore({
          storeRoot: readOption(args, '--store-root'),
          stateDir: readOption(args, '--state-dir'),
          claimPath: readOption(args, '--claim'),
        })
      : command === 'repair-stale-replay'
        ? prepareReviewReworkStaleReplayStoreIsolationRepair({
          stateDir: readOption(args, '--state-dir'),
          claimPath: readOption(args, '--claim'),
          progressPath: readOption(args, '--progress'),
        })
        : command === 'prepare-merged-delivery'
          ? prepareMergedDeliveryFreshDispatchRecovery({
              repoRoot: readOption(args, '--repo'),
              stateDir: readOption(args, '--state-dir'),
              claimPath: readOption(args, '--claim'),
              progressPath: readOption(args, '--progress'),
            })
          : command === 'isolate-merged-delivery'
            ? isolateMergedDeliveryFreshDispatchRuntimeStore({
              storeRoot: readOption(args, '--store-root'),
              stateDir: readOption(args, '--state-dir'),
              claimPath: readOption(args, '--claim'),
              })
            : command === 'prepare-objective-apply-no-eligible'
              ? prepareObjectiveApplyNoEligibleFreshDispatchRecovery({
                  repoRoot: readOption(args, '--repo'),
                  stateDir: readOption(args, '--state-dir'),
                  claimPath: readOption(args, '--claim'),
                  progressPath: readOption(args, '--progress'),
                })
              : command === 'isolate-objective-apply-no-eligible'
                ? isolateObjectiveApplyNoEligibleFreshDispatchRuntimeStore({
                    storeRoot: readOption(args, '--store-root'),
                    stateDir: readOption(args, '--state-dir'),
                    claimPath: readOption(args, '--claim'),
                  })
                : verifyObjectiveApplyNoEligibleContinuationTarget({
                    repoRoot: readOption(args, '--repo'),
                    claimPath: readOption(args, '--claim'),
                    runStamp: readOption(args, '--run-stamp'),
                  });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, code: error instanceof Error ? error.message : 'review_rework_runtime_store_isolation_failed' })}\n`);
    process.exit(78);
  }
}
