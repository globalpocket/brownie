#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { uncheckedTodoBlocks as claimSelectorTodoBlocks } from './guard-todo-decomposition.mjs';

function argsFrom(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith('--')) args.set(argv[index].slice(2), argv[index + 1]);
  }
  return args;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function git(repo, args) {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

function gitShow(repo, ref, relativePath) {
  try {
    return execFileSync('git', ['-C', repo, 'show', '--format=', `${ref}:${relativePath}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
}

function controllerSourceSnapshot(repo, baselineRef) {
  const manifest = readJson(path.join(repo, 'scripts/phase-loop-controller-source-manifest.json')) ?? {};
  const sourcePaths = Array.isArray(manifest.controller_source_paths) ? manifest.controller_source_paths : [];
  const files = [
    'scripts/phase-loop-controller-source-manifest.json',
    ...sourcePaths
  ].map((relativePath) => {
    let current = null;
    try { current = fs.readFileSync(path.join(repo, relativePath)); } catch { /* evidence records the absence */ }
    const baseline = gitShow(repo, baselineRef, relativePath);
    return {
      relative_path: relativePath,
      current_sha256: current ? sha256(current) : null,
      baseline_sha256: baseline ? sha256(Buffer.from(baseline, 'utf8')) : null,
      matches: Boolean(current && baseline && sha256(current) === sha256(Buffer.from(baseline, 'utf8'))),
    };
  });
  return {
    baseline_ref: baselineRef,
    baseline_commit: git(repo, ['rev-parse', '--verify', `${baselineRef}^{commit}`]) || null,
    current_head: git(repo, ['rev-parse', 'HEAD']) || null,
    source_fingerprint: `sha256:${sha256(JSON.stringify(files.map((file) => [file.relative_path, file.current_sha256])))}`,
    files,
  };
}

function selectedTodoId(selectedTodo) {
  return String(selectedTodo ?? '').split('\n')[0].match(/^\s*(?:[-*]|\d+[.)])\s+\[[ xX]\]\s+([^:\s]+)/u)?.[1] ?? '';
}

function hasExactPendingTodo(todoText, selectedTodo) {
  const selected = String(selectedTodo ?? '');
  return Boolean(selected) && claimSelectorTodoBlocks(todoText).includes(selected);
}

function selectedContract(selectedTodo) {
  const text = String(selectedTodo ?? '');
  const targetText = text.match(/\b(?:Patch|Create) only\s+([^\n]*)/u)?.[1] ?? '';
  return {
    target_files: [...targetText.matchAll(/`([^`]+)`/gu)].map((match) => match[1]).filter((value) => /[/.]/u.test(value)),
    verification_commands: [...text.matchAll(/^\s*Verification:\s*run\s+`([^`]+)`/gmu)].map((match) => match[1]),
  };
}

function flattenLedger(value) {
  if (value?.kind === 'terminal_failure_transaction' || value?.kind === 'replan_transaction' || value?.kind === 'terminal_replan_transaction') {
    return Array.isArray(value.events) ? value.events : [];
  }
  return value ? [value] : [];
}

function readLedger(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
      try { return flattenLedger(JSON.parse(line)); } catch { return []; }
    });
  } catch { return []; }
}

function priorTerminalEvidence(runsDir, claimId) {
  if (!runsDir || !fs.existsSync(runsDir)) return [];
  const matches = [];
  for (const name of fs.readdirSync(runsDir)) {
    if (!name.endsWith('.stdout.log')) continue;
    const file = path.join(runsDir, name);
    const payload = readJson(file);
    const root = payload?.run ?? payload?.resume ?? payload;
    const automation = root?.automation ?? {};
    if ((root?.phase_loop_claim_id ?? '') !== claimId) continue;
    if (root?.terminal_failure === true || automation.terminal_failure === true || root?.stop_class === 'terminal_failure' || automation.stop_class === 'terminal_failure') {
      matches.push(file);
    }
  }
  return matches.sort();
}

function archivePath(claimDir, runStamp) {
  let candidate = path.join(claimDir, `stale-rebaseline-${runStamp}.json`);
  let suffix = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(claimDir, `stale-rebaseline-${runStamp}-${suffix}.json`);
    suffix += 1;
  }
  return candidate;
}

function validClaimTarget(target) {
  if (typeof target !== 'string' || target.length === 0 || target.includes('\u0000') || target.includes('\\')) return false;
  if (path.isAbsolute(target)) return false;
  const normalized = path.posix.normalize(target);
  return normalized === target && normalized !== '.' && normalized !== '..' && !normalized.startsWith('../');
}

function validRunStamp(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value);
}

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function progressProjection(progress) {
  return progress?.progress_projection && typeof progress.progress_projection === 'object'
    ? progress.progress_projection : {};
}

// A no-candidate response is intentionally routed through the terminal
// recovery path so it cannot be silently retried forever.  That controller
// classification is not, by itself, evidence that Runtime reported a
// terminal task failure.  Keep the distinction explicit: a fresh,
// hash-bound admission may repair a stale materialized-scope boundary only
// when the projection still says that Runtime stopped without an actionable
// task and contains no terminal task evidence.
function isBoundaryOnlyNoActionableTerminalProjection(progress, claimId) {
  const projection = progressProjection(progress);
  return projection.claim_id === claimId
    && progress?.classification === 'terminal_failure'
    && projection.stop_class === 'no_actionable_work'
    && projection.stop_reason === 'no_actionable_work'
    && String(projection.terminal_final_state ?? '') === ''
    && String(projection.terminal_task_status ?? '') === ''
    && projection.blocked_by_terminal_task_failure !== true
    && projection.objective_apply_terminal_failure !== true;
}

function queueMatchesClaim(claim, queue) {
  return claim?.queue_generation != null
    && queue?.generation != null
    && String(claim.queue_generation) === String(queue.generation)
    && typeof claim.queue_fingerprint === 'string'
    && claim.queue_fingerprint.length > 0
    && typeof queue.fingerprint === 'string'
    && queue.fingerprint.length > 0
    && claim.queue_fingerprint === queue.fingerprint;
}

function isMaterializedScopeBoundary(status, claimMatchesProjection) {
  const blockedDetail = String(status?.detail ?? '');
  return claimMatchesProjection
    && status?.status === 'blocked'
    && /contract_unsatisfiable_dirty_scope|materialized[_ -]scope|pre-claim-boundary/iu.test(blockedDetail);
}

function validateActiveClaimResumeAdmission({
  resumeAdmissionPath,
  stateDir,
  runsDir,
  claim,
  queue,
  runStamp,
  selectedTodo,
}) {
  if (!resumeAdmissionPath) return { valid: false, reason: 'not_supplied', path: null };
  const resolvedRuns = path.resolve(runsDir);
  const expectedPath = path.join(resolvedRuns, `${runStamp}.active-claim-resume-admission.json`);
  const resolvedPath = path.resolve(resumeAdmissionPath);
  const relativeToState = path.relative(path.resolve(stateDir), resolvedPath);
  if (resolvedPath !== expectedPath
    || relativeToState === ''
    || relativeToState === '..'
    || relativeToState.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeToState)) {
    return { valid: false, reason: 'path_not_current_run_receipt', path: resolvedPath };
  }

  const receipt = readJson(resolvedPath);
  if (!receipt
    || receipt.schema_version !== 1
    || receipt.kind !== 'phase_loop_active_claim_resume_admission_receipt'
    || receipt.issued_from_stage !== 'pre-claim-boundary'
    || receipt.run_stamp !== runStamp
    || receipt.claim_id !== claim.claim_id
    || receipt.claim_run_stamp !== claim.run_stamp
    || receipt.selected_todo_id !== selectedTodoId(selectedTodo)
    || receipt.selected_todo_sha256 !== sha256(selectedTodo)
    || receipt.queue_generation == null
    || !receipt.queue_fingerprint
    || String(receipt.queue_generation) !== String(claim.queue_generation ?? '')
    || receipt.queue_fingerprint !== String(claim.queue_fingerprint ?? '')
    || String(receipt.queue_generation) !== String(queue.generation ?? '')
    || receipt.queue_fingerprint !== String(queue.fingerprint ?? '')) {
    return { valid: false, reason: 'identity_or_queue_mismatch', path: resolvedPath };
  }

  const selectedTargets = new Set(selectedContract(selectedTodo).target_files);
  if (selectedTargets.size === 0
    || !Array.isArray(receipt.admitted_targets)
    || receipt.admitted_targets.length === 0
    || !Array.isArray(receipt.materializations)
    || receipt.materializations.length === 0) {
    return { valid: false, reason: 'missing_target_attestation', path: resolvedPath };
  }

  const admittedTargets = new Set();
  for (const target of receipt.admitted_targets) {
    if (!target
      || !validClaimTarget(target.target)
      || !selectedTargets.has(target.target)
      || !/^sha256:[a-f0-9]{64}$/u.test(String(target.sha256 ?? ''))
      || !validRunStamp(target.materialization_run_stamp)) {
      return { valid: false, reason: 'invalid_admitted_target', path: resolvedPath };
    }
    admittedTargets.add(target.target);
  }

  const materializedTargets = new Set();
  for (const materialization of receipt.materializations) {
    if (!materialization
      || !validClaimTarget(materialization.materialized_target)
      || !selectedTargets.has(materialization.materialized_target)
      || !validRunStamp(materialization.materialization_run_stamp)) {
      return { valid: false, reason: 'invalid_materialization', path: resolvedPath };
    }
    materializedTargets.add(materialization.materialized_target);
  }
  if ([...admittedTargets].some((target) => !materializedTargets.has(target))) {
    return { valid: false, reason: 'admitted_target_not_materialized', path: resolvedPath };
  }

  return {
    valid: true,
    reason: 'current_boundary_admission_verified',
    path: resolvedPath,
    admitted_targets: [...admittedTargets].sort(),
  };
}

export function rebaselineStaleClaim({
  repo,
  stateDir,
  claimPath,
  statusPath,
  progressPath,
  queuePath,
  ledgerPath,
  runsDir,
  todoPath,
  runStamp,
  baselineRef = 'origin/main',
  resumeAdmissionPath = '',
}) {
  const claim = readJson(claimPath);
  const status = readJson(statusPath) ?? {};
  const progress = readJson(progressPath) ?? {};
  const queue = readJson(queuePath) ?? {};
  if (!claim || !['claimed', 'in_progress', 'running'].includes(claim.status)) {
    return { ok: true, rebaselined: false, reason: 'no_active_claim' };
  }
  if (claim.terminal_failure_recovery_pending === true || claim.terminal_failure_source_transition_pending === true) {
    return { ok: true, rebaselined: false, reason: 'durable_recovery_pending', claim_id: claim.claim_id };
  }
  const projection = progressProjection(progress);
  const claimMatchesProjection = projection.claim_id === claim.claim_id;
  let selectedTodoStillPending = false;
  try {
    const selectedTodo = String(claim.selected_todo ?? '');
    selectedTodoStillPending = hasExactPendingTodo(fs.readFileSync(todoPath, 'utf8'), selectedTodo);
  } catch {
    // An unreadable queue is not evidence that a continuation remains valid.
    selectedTodoStillPending = false;
  }
  // A changes-requested completion recovery deliberately reuses the exact
  // rejected claim root.  Its fresh-dispatch marker invalidates the old
  // Runtime session, but does not invalidate the claim contract itself.  A
  // controller-only queue-generation bump must therefore not send that
  // review-directed rework through the generic stale-claim path: doing so
  // creates a replacement root before the required fresh Runtime admission
  // and breaks the review-to-rework lineage.
  //
  // This is intentionally narrower than a general queue-drift exemption. It
  // requires the recovery's durable identity, a same-root claim, an exact
  // still-pending TODO, and an unchanged non-empty queue fingerprint. A TODO
  // contract/fingerprint change, a non-CHANGES_REQUESTED review state, or an
  // unrecognized recovery record remains subject to normal fail-closed
  // rebaseline.
  const reviewRework = claim.review_rework && typeof claim.review_rework === 'object'
    ? claim.review_rework
    : {};
  const legacyCompletionRecovery = claim.legacy_completion_recovery
    && typeof claim.legacy_completion_recovery === 'object'
    ? claim.legacy_completion_recovery
    : {};
  const reviewReworkFreshDispatchClaim = claim.review_rework_fresh_dispatch_pending === true
    && typeof claim.claim_id === 'string'
    && claim.claim_id.length > 0
    && claim.root_claim_id === claim.claim_id
    && reviewRework.required === true
    && reviewRework.state === 'CHANGES_REQUESTED'
    && typeof claim.review_rework_fresh_dispatch_recovery_id === 'string'
    && claim.review_rework_fresh_dispatch_recovery_id.length > 0
    && legacyCompletionRecovery.recovery_id === claim.review_rework_fresh_dispatch_recovery_id
    && selectedTodoStillPending
    && typeof claim.queue_fingerprint === 'string'
    && claim.queue_fingerprint.length > 0
    && claim.queue_fingerprint === queue.fingerprint;
  if (reviewReworkFreshDispatchClaim) {
    return {
      ok: true,
      rebaselined: false,
      reason: 'review_rework_fresh_dispatch_claim_preserved_for_same_root_admission',
      claim_id: claim.claim_id,
      root_claim_id: claim.root_claim_id,
      recovery_id: claim.review_rework_fresh_dispatch_recovery_id,
      queue_generation_drift: claim.queue_generation != null
        && queue.generation != null
        && String(claim.queue_generation) !== String(queue.generation),
    };
  }
  // A contract-boundary rejection happens before Runtime can produce a
  // terminal task event.  Leaving its old in-progress claim resumable makes
  // every later run replay an authorization whose target snapshot is already
  // known invalid.  Treat only the explicit materialized-scope boundary and
  // an applied projection whose selected TODO was removed as durable stale
  // evidence; ordinary preflight failures remain fail-closed for repair.
  const staleMaterializedScopeBoundary = isMaterializedScopeBoundary(status, claimMatchesProjection);
  const staleAppliedProjection = claimMatchesProjection
    && String(projection.applied ?? '').toLowerCase() === 'true'
    && projection.selected_todo_first_line_still_pending_after_todo_md_apply === false
    && !selectedTodoStillPending;
  const staleClaimSnapshot = staleMaterializedScopeBoundary || staleAppliedProjection;
  // A run-once process is expected to exit after it records a durable
  // continuation.  The next invocation first normalizes that ownerless
  // "running" status, so do not mistake its historical terminal ledger
  // entries for a reason to discard the exact claim that Runtime asked us to
  // resume.  Queue drift remains a hard boundary: only the same admitted
  // claim and queue may take this path.
  const resumableContinuation = claimMatchesProjection
    && status.continuation_required === true
    && status.controller_action === 'resume'
    && (progress.continuation_required === true || projection.stop_class === 'continuation_required')
    && projection.controller_action === 'resume';
  const terminalProjection = claimMatchesProjection && (
    progress.classification === 'terminal_failure'
    || projection.stop_class === 'terminal_failure'
    || projection.stop_reason === 'terminal_task_failed'
  );
  const boundaryOnlyNoActionableTerminalProjection = terminalProjection
    && isBoundaryOnlyNoActionableTerminalProjection(progress, claim.claim_id);
  const queueMismatch = (
    claim.queue_generation != null && queue.generation != null && String(claim.queue_generation) !== String(queue.generation)
  ) || (
    claim.queue_fingerprint && queue.fingerprint && claim.queue_fingerprint !== queue.fingerprint
  );
  const ledgerEvidence = readLedger(ledgerPath).filter((event) => event.claim_id === claim.claim_id && ['failed', 'blocked', 'replanned', 'completed'].includes(event.to_state));
  const priorRuns = priorTerminalEvidence(runsDir, claim.claim_id);
  const resumeAdmission = validateActiveClaimResumeAdmission({
    resumeAdmissionPath,
    stateDir,
    runsDir,
    claim,
    queue,
    runStamp,
    selectedTodo: String(claim.selected_todo ?? ''),
  });
  // A stale status can describe the boundary failure that was just repaired
  // by this run's preflight.  Preserve only a receipt issued by that exact
  // preflight, for this exact claim and queue, and only absent a Runtime
  // terminal projection or terminal evidence. A `terminal_failure`
  // classification synthesized solely for a no-actionable-work response is
  // controller routing, not Runtime terminal evidence, and is safe to repair
  // only through this current-run receipt. A missing, stale, or malformed
  // receipt remains fail-closed and follows the ordinary stale-claim
  // isolation path.
  const boundaryAdmittedResume = resumeAdmission.valid
    && staleMaterializedScopeBoundary
    && !queueMismatch
    && selectedTodoStillPending
    && (!terminalProjection || boundaryOnlyNoActionableTerminalProjection)
    && ledgerEvidence.length === 0
    && priorRuns.length === 0;
  if (boundaryAdmittedResume) {
    return {
      ok: true,
      rebaselined: false,
      reason: 'boundary_admitted_materialized_claim_preserved_for_resume',
      claim_id: claim.claim_id,
      resume_admission_path: resumeAdmission.path,
      admitted_targets: resumeAdmission.admitted_targets,
      boundary_only_no_actionable_terminal_projection: boundaryOnlyNoActionableTerminalProjection,
    };
  }
  if (resumableContinuation && !queueMismatch && !staleClaimSnapshot) {
    return {
      ok: true,
      rebaselined: false,
      reason: 'continuation_claim_preserved_for_resume',
      claim_id: claim.claim_id,
    };
  }
  const staleRun = claim.run_stamp && claim.run_stamp !== runStamp;
  // A non-running persisted status is the controller's durable indication
  // that the previous owner is no longer active.  Do not trust a stale PID
  // left in the status file: the run-once entrypoint has already performed
  // the live-owner check before reaching this recovery guard.
  const ownerStopped = status.status !== 'running';
  const shouldRebaseline = staleRun && ownerStopped && (
    queueMismatch
    || terminalProjection
    || ledgerEvidence.length > 0
    || priorRuns.length > 0
    || staleClaimSnapshot
  );
  if (!shouldRebaseline) {
    return {
      ok: true,
      rebaselined: false,
      reason: 'claim_is_current_or_no_terminal_staleness',
      claim_id: claim.claim_id,
      queue_mismatch: queueMismatch,
      selected_todo_still_pending: selectedTodoStillPending,
      terminal_projection: terminalProjection,
      boundary_only_no_actionable_terminal_projection: boundaryOnlyNoActionableTerminalProjection,
      ledger_terminal_events: ledgerEvidence.length,
      prior_terminal_runs: priorRuns.length,
    };
  }

  const selected = String(claim.selected_todo ?? '');
  const contract = selectedContract(selected);
  const source = controllerSourceSnapshot(repo, baselineRef);
  const audit = {
    schema_version: 1,
    kind: 'phase_loop_claim_rebaseline',
    rebaseline_id: `rebaseline-${runStamp}-${sha256(String(claim.claim_id)).slice(0, 12)}`,
    run_stamp: runStamp,
    recorded_at: new Date().toISOString(),
    source,
    queue: {
      path: queuePath,
      generation: queue.generation ?? null,
      fingerprint: queue.fingerprint ?? null,
    },
    selected_todo_id: selectedTodoId(selected),
    selected_todo_sha256: sha256(selected),
    target_files: contract.target_files,
    verification_commands: contract.verification_commands,
    source_claim: {
      claim_id: claim.claim_id ?? null,
      status: claim.status,
      run_stamp: claim.run_stamp ?? null,
      queue_generation: claim.queue_generation ?? null,
      queue_fingerprint: claim.queue_fingerprint ?? null,
      retry_cap: claim.retry_cap ?? null,
    },
    reasons: {
      stale_run: staleRun,
      owner_stopped: ownerStopped,
      queue_mismatch: queueMismatch,
      terminal_projection: terminalProjection,
      boundary_only_no_actionable_terminal_projection: boundaryOnlyNoActionableTerminalProjection,
      stale_materialized_scope_boundary: staleMaterializedScopeBoundary,
      stale_applied_projection: staleAppliedProjection,
      selected_todo_still_pending: selectedTodoStillPending,
      ledger_terminal_events: ledgerEvidence,
      prior_terminal_runs: priorRuns,
      resume_admission: {
        supplied: Boolean(resumeAdmissionPath),
        valid: resumeAdmission.valid,
        reason: resumeAdmission.reason,
        path: resumeAdmission.path,
      },
    },
    recovery_state: 'redelegatable',
    retry_policy: 'do_not_inherit_source_claim_retry_cap_or_terminal_state',
  };
  const claimDir = path.dirname(claimPath);
  const auditPath = path.join(claimDir, `${audit.rebaseline_id}.json`);
  const stalePath = archivePath(claimDir, runStamp);
  const archived = {
    ...claim,
    status: 'stale_snapshot_rejected',
    archive_reason: 'stale_claim_rebaseline',
    recovery_state: 'redelegatable',
    retry_eligible: true,
    rebaseline_id: audit.rebaseline_id,
    rebaseline_audit: path.relative(stateDir, auditPath),
    rebaselined_at: audit.recorded_at,
    status_history: [...(Array.isArray(claim.status_history) ? claim.status_history : []), {
      status: 'stale_snapshot_rejected',
      run_stamp: runStamp,
      updated_at: audit.recorded_at,
      note: 'stale_claim_isolated_before_new_run',
    }],
  };
  writeJson(auditPath, audit);
  writeJson(stalePath, archived);
  fs.unlinkSync(claimPath);
  return {
    ok: true,
    rebaselined: true,
    reason: 'stale_claim_isolated_before_new_run',
    rebaseline_id: audit.rebaseline_id,
    audit_path: auditPath,
    stale_claim_path: stalePath,
    source_claim_id: claim.claim_id,
    selected_todo_id: selectedTodoId(selected),
    queue_generation: queue.generation ?? null,
    queue_fingerprint: queue.fingerprint ?? null,
    recovery_state: audit.recovery_state,
  };
}

// A controller bug can isolate an otherwise valid claim before the repaired
// boundary admission is allowed to resume it.  Recover only the very narrow
// archival shape created by that bug.  This is deliberately not a generic
// stale-claim restore: every identity, queue, target attestation, and the
// non-Runtime terminal classification must still match before current.json is
// recreated.
export function restoreAdmissionBackedStaleClaim({
  stateDir,
  claimPath,
  statusPath,
  progressPath,
  queuePath,
  runsDir,
  todoPath,
  runStamp,
}) {
  if (!validRunStamp(runStamp)) {
    return { ok: false, restored: false, reason: 'invalid_run_stamp' };
  }
  if (fs.existsSync(claimPath)) {
    return { ok: true, restored: false, reason: 'active_claim_present' };
  }
  const status = readJson(statusPath) ?? {};
  const progress = readJson(progressPath) ?? {};
  const queue = readJson(queuePath) ?? {};
  const claimDir = path.dirname(claimPath);
  let todoText = '';
  try { todoText = fs.readFileSync(todoPath, 'utf8'); } catch {
    return { ok: false, restored: false, reason: 'todo_unreadable' };
  }

  let candidateNames = [];
  try {
    candidateNames = fs.readdirSync(claimDir)
      .filter((name) => /^stale-rebaseline-[A-Za-z0-9._-]+\.json$/u.test(name))
      .sort()
      .reverse();
  } catch {
    return { ok: true, restored: false, reason: 'no_admission_backed_stale_claim' };
  }

  for (const name of candidateNames) {
    const archivePath = path.join(claimDir, name);
    let archiveStat;
    try { archiveStat = fs.lstatSync(archivePath); } catch { continue; }
    if (!archiveStat.isFile()) continue;
    const archived = readJson(archivePath);
    if (!archived
      || archived.status !== 'stale_snapshot_rejected'
      || archived.archive_reason !== 'stale_claim_rebaseline'
      || !archivePath.endsWith('.json')
      || !queueMatchesClaim(archived, queue)
      || !hasExactPendingTodo(todoText, String(archived.selected_todo ?? ''))) {
      continue;
    }

    const auditRelativePath = archived.rebaseline_audit;
    if (typeof auditRelativePath !== 'string' || path.isAbsolute(auditRelativePath)) continue;
    const auditPath = path.resolve(stateDir, auditRelativePath);
    if (!isPathInside(stateDir, auditPath)) continue;
    const audit = readJson(auditPath);
    const reasons = audit?.reasons && typeof audit.reasons === 'object' ? audit.reasons : {};
    if (!audit
      || audit.kind !== 'phase_loop_claim_rebaseline'
      || audit.rebaseline_id !== archived.rebaseline_id
      || !validRunStamp(audit.run_stamp)
      || audit.source_claim?.claim_id !== archived.claim_id
      || audit.source_claim?.run_stamp !== archived.run_stamp
      || !queueMatchesClaim(audit.source_claim, queue)
      || audit.selected_todo_id !== selectedTodoId(archived.selected_todo)
      || audit.selected_todo_sha256 !== sha256(String(archived.selected_todo ?? ''))
      || reasons.stale_materialized_scope_boundary !== true
      || reasons.terminal_projection !== true
      || !Array.isArray(reasons.ledger_terminal_events)
      || reasons.ledger_terminal_events.length !== 0
      || !Array.isArray(reasons.prior_terminal_runs)
      || reasons.prior_terminal_runs.length !== 0
      || reasons.resume_admission?.valid !== true
      || typeof reasons.resume_admission?.path !== 'string') {
      continue;
    }

    const projection = progressProjection(progress);
    if (!isMaterializedScopeBoundary(status, projection.claim_id === archived.claim_id)
      || !isBoundaryOnlyNoActionableTerminalProjection(progress, archived.claim_id)) {
      continue;
    }

    const historicalAdmission = validateActiveClaimResumeAdmission({
      resumeAdmissionPath: reasons.resume_admission.path,
      stateDir,
      runsDir,
      claim: archived,
      queue,
      runStamp: audit.run_stamp,
      selectedTodo: String(archived.selected_todo ?? ''),
    });
    if (!historicalAdmission.valid) continue;

    const restoredAt = new Date().toISOString();
    const restoreId = `active-claim-restore-${runStamp}-${sha256(`${archived.claim_id}\u0000${archived.rebaseline_id}`).slice(0, 12)}`;
    const restoreAuditPath = path.join(claimDir, `${restoreId}.json`);
    const restored = { ...archived };
    for (const key of ['archive_reason', 'recovery_state', 'retry_eligible', 'rebaseline_id', 'rebaseline_audit', 'rebaselined_at']) {
      delete restored[key];
    }
    restored.status = 'in_progress';
    // Keep the original claim run stamp until pre-claim-boundary has issued
    // a fresh receipt for this invocation.  Treating the restored claim as
    // current before that proof exists would let it bypass stale isolation
    // when the boundary has nothing to admit.
    restored.updated_at = restoredAt;
    restored.admission_backed_restore_id = restoreId;
    restored.status_history = [...(Array.isArray(archived.status_history) ? archived.status_history : []), {
      status: 'in_progress',
      run_stamp: runStamp,
      updated_at: restoredAt,
      note: `admission_backed_stale_claim_restored:${restoreId}`,
    }];
    const restoreAudit = {
      schema_version: 1,
      kind: 'phase_loop_admission_backed_claim_restore',
      restore_id: restoreId,
      run_stamp: runStamp,
      recorded_at: restoredAt,
      source_archive: path.relative(stateDir, archivePath),
      source_rebaseline_audit: auditRelativePath,
      source_claim_id: archived.claim_id,
      selected_todo_id: selectedTodoId(archived.selected_todo),
      selected_todo_sha256: sha256(String(archived.selected_todo ?? '')),
      queue_generation: queue.generation,
      queue_fingerprint: queue.fingerprint,
      historical_resume_admission: {
        path: historicalAdmission.path,
        admitted_targets: historicalAdmission.admitted_targets,
      },
      guard: 'boundary_only_no_actionable_terminal_projection',
    };
    try {
      if (fs.existsSync(claimPath)) return { ok: true, restored: false, reason: 'active_claim_present' };
      writeJson(restoreAuditPath, restoreAudit);
      writeJson(claimPath, restored);
    } catch {
      return { ok: false, restored: false, reason: 'restore_write_failed' };
    }
    return {
      ok: true,
      restored: true,
      reason: 'admission_backed_stale_claim_restored',
      restore_id: restoreId,
      restore_audit_path: restoreAuditPath,
      archive_path: archivePath,
      claim_id: archived.claim_id,
      admitted_targets: historicalAdmission.admitted_targets,
    };
  }
  return { ok: true, restored: false, reason: 'no_admission_backed_stale_claim' };
}

function payloadFromFile(file) {
  const root = readJson(file);
  const payload = root?.run ?? root?.resume ?? root;
  return { root, payload: payload && typeof payload === 'object' ? payload : {} };
}

export function writeTerminalExecutionEvidence({
  stdoutPath,
  claimSnapshotPath,
  outputPath,
  runStamp,
  workspaceBefore = '',
  workspaceAfter = '',
}) {
  const snapshot = readJson(claimSnapshotPath) ?? {};
  const claim = snapshot.claim ?? snapshot;
  const { root, payload } = payloadFromFile(stdoutPath);
  const automation = payload.automation && typeof payload.automation === 'object' ? payload.automation : {};
  const contract = selectedContract(claim.selected_todo);
  const execution = payload.task_execution && typeof payload.task_execution === 'object' ? payload.task_execution : {};
  const runtimeStatus = payload.status ?? automation.status ?? null;
  const terminalCompletionEvidence = payload.terminal_completion_evidence && typeof payload.terminal_completion_evidence === 'object'
    ? payload.terminal_completion_evidence : {};
  const terminalCompletionFailure = [
    payload.terminal_completion_final_state,
    payload.terminal_completion_task_status,
    terminalCompletionEvidence.final_state,
    terminalCompletionEvidence.task_status,
  ].some((value) => String(value ?? '').toLowerCase() === 'failed');
  const terminalTaskCount = Number(
    payload.completion_closure_terminal_task_count
      ?? payload.completion_closure?.terminal_task_count
      ?? 0
  );
  // Runtime can report a real task execution whose terminal completion
  // evidence is failed without emitting the generic task_execution envelope.
  // This is the production shape for workspace-write failures and must count
  // as current-run execution evidence, while a bare no_eligible_task result
  // must remain recoverable rather than being inferred from an old claim.
  const taskExecutedTerminalFailure = runtimeStatus === 'task_executed' && (
    terminalCompletionFailure
    || payload.terminal_failure === true
    || payload.stop_class === 'terminal_failure'
    || payload.stop_reason === 'terminal_task_failed'
    || terminalTaskCount > 0
  );
  const reportedExecutedCount = Number(payload.executed_count ?? execution.executed_count ?? NaN);
  const noEligibleStatus = ['no_eligible_task', 'no_actionable_work'].includes(String(runtimeStatus ?? ''));
  // A Runtime admission flag alone is not task evidence for a no-eligible
  // closure: stale headless sessions can retain it while reporting that zero
  // tasks executed.  Require an explicit positive count in that shape, while retaining the
  // existing evidence paths for an actual task execution.
  const runtimeAdmissionConfirmed = payload.task_execution_confirmed === true
    && (!noEligibleStatus || (Number.isFinite(reportedExecutedCount) && reportedExecutedCount > 0));
  const executionStarted = execution.started === true
    && (!noEligibleStatus || (Number.isFinite(reportedExecutedCount) && reportedExecutedCount > 0));
  const explicitSignals = [
    // Runtime admission is task evidence except for a no-eligible closure
    // that explicitly reports zero executed tasks.
    runtimeAdmissionConfirmed,
    executionStarted,
    taskExecutedTerminalFailure,
    payload.objective_apply_applied === true,
    ['applied', 'started', 'attempted'].includes(String(payload.objective_apply_status ?? '').toLowerCase()),
    payload.workspace_write_applied === true,
    payload.verification && typeof payload.verification === 'object',
    Array.isArray(payload.verification_results),
    typeof payload.verification_output === 'string' && payload.verification_output.trim().length > 0,
    workspaceBefore !== workspaceAfter && workspaceBefore !== '' && workspaceAfter !== '',
  ];
  const runtimeClaimId = payload.phase_loop_claim_id ?? automation.phase_loop_claim_id ?? null;
  const claimMatches = !runtimeClaimId || runtimeClaimId === claim.claim_id;
  const evidence = {
    schema_version: 1,
    kind: 'phase_loop_terminal_failure_execution_evidence',
    run_stamp: runStamp,
    runtime_run_id: payload.run_id ?? automation.run_id ?? payload.session_id ?? automation.session_id ?? null,
    claim_id: claim.claim_id ?? null,
    runtime_claim_id: runtimeClaimId,
    claim_matches: claimMatches,
    task_id: payload.task_id ?? automation.task_id ?? null,
    selected_todo_id: selectedTodoId(claim.selected_todo),
    selected_todo_sha256: sha256(String(claim.selected_todo ?? '')),
    target_files: contract.target_files,
    verification_commands: contract.verification_commands,
    signals: {
      explicit: explicitSignals,
      task_execution: execution,
      payload_status: runtimeStatus,
      terminal_completion_final_state: payload.terminal_completion_final_state ?? terminalCompletionEvidence.final_state ?? null,
      terminal_completion_task_status: payload.terminal_completion_task_status ?? terminalCompletionEvidence.task_status ?? null,
      task_execution_confirmed: payload.task_execution_confirmed === true,
      reported_executed_count: Number.isFinite(reportedExecutedCount) ? reportedExecutedCount : null,
      stop_class: payload.stop_class ?? automation.stop_class ?? null,
      stop_reason: payload.stop_reason ?? automation.stop_reason ?? null,
    },
    task_execution_confirmed: claimMatches && explicitSignals.some(Boolean),
    source: 'current_run_stdout_and_claim_snapshot',
    stdout_path: stdoutPath,
  };
  writeJson(outputPath, evidence);
  return evidence;
}

function main() {
  const command = process.argv[2];
  const args = argsFrom(process.argv.slice(3));
  if (command === 'rebaseline') {
    const result = rebaselineStaleClaim({
      repo: path.resolve(args.get('repo')),
      stateDir: path.resolve(args.get('state-dir')),
      claimPath: path.resolve(args.get('claim')),
      statusPath: path.resolve(args.get('status')),
      progressPath: path.resolve(args.get('progress')),
      queuePath: path.resolve(args.get('queue')),
      ledgerPath: path.resolve(args.get('ledger')),
      runsDir: path.resolve(args.get('runs')),
      todoPath: path.resolve(args.get('todo')),
      runStamp: args.get('run-stamp'),
      baselineRef: args.get('baseline-ref') ?? 'origin/main',
      resumeAdmissionPath: args.get('resume-admission') ?? '',
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(result.ok ? 0 : 78);
  }
  if (command === 'restore-admitted-stale-claim') {
    const result = restoreAdmissionBackedStaleClaim({
      stateDir: path.resolve(args.get('state-dir')),
      claimPath: path.resolve(args.get('claim')),
      statusPath: path.resolve(args.get('status')),
      progressPath: path.resolve(args.get('progress')),
      queuePath: path.resolve(args.get('queue')),
      runsDir: path.resolve(args.get('runs')),
      todoPath: path.resolve(args.get('todo')),
      runStamp: args.get('run-stamp'),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(result.ok ? 0 : 78);
  }
  if (command === 'terminal-evidence') {
    const result = writeTerminalExecutionEvidence({
      stdoutPath: path.resolve(args.get('stdout')),
      claimSnapshotPath: path.resolve(args.get('claim-snapshot')),
      outputPath: path.resolve(args.get('output')),
      runStamp: args.get('run-stamp'),
      workspaceBefore: args.get('workspace-before') ?? '',
      workspaceAfter: args.get('workspace-after') ?? '',
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(result.task_execution_confirmed ? 0 : 1);
  }
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
