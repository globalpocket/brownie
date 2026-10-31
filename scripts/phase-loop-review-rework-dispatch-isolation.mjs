#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function readOption(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const [command, ...args] = process.argv.slice(2);
  if (command !== 'isolate' && command !== 'repair-stale-replay') {
    process.stderr.write('usage: phase-loop-review-rework-dispatch-isolation.mjs <isolate|repair-stale-replay> --state-dir <path> --claim <path> [--store-root <path>] [--progress <path>]\n');
    process.exit(64);
  }
  try {
    const result = command === 'isolate'
      ? isolateReviewReworkFreshDispatchRuntimeStore({
          storeRoot: readOption(args, '--store-root'),
          stateDir: readOption(args, '--state-dir'),
          claimPath: readOption(args, '--claim'),
        })
      : prepareReviewReworkStaleReplayStoreIsolationRepair({
          stateDir: readOption(args, '--state-dir'),
          claimPath: readOption(args, '--claim'),
          progressPath: readOption(args, '--progress'),
        });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, code: error instanceof Error ? error.message : 'review_rework_runtime_store_isolation_failed' })}\n`);
    process.exit(78);
  }
}
