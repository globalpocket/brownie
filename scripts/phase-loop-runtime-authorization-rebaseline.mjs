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

function runtimeErrorCode(root) {
  return typeof root?.status === 'string'
    ? root.status
    : (typeof root?.error?.code === 'string' ? root.error.code : '');
}

function parsePositiveInteger(raw) {
  if (!/^[0-9]+$/u.test(String(raw))) throw new Error('invalid_rebaseline_cap');
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error('invalid_rebaseline_cap');
  return value;
}

function retireObjectiveApplyScopeForExpiredAuthorization(claim, { timestamp, runStamp }) {
  const scope = claim?.objective_apply_resume_scope;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    return { claimPatch: {}, audit: { retired: false } };
  }

  // Preserve the old binding in both the claim history and recovery audit.  A
  // proposal approval is only valid in its original Runtime session, so an
  // archived expired session must never leave a `pending` scope that can
  // conflict with the replacement session's direct preflight.
  const prior = {
    state: typeof scope.state === 'string' ? scope.state : '',
    claim_id: typeof scope.claim_id === 'string' ? scope.claim_id : '',
    selected_todo_sha256: typeof scope.selected_todo_sha256 === 'string' ? scope.selected_todo_sha256 : '',
    queue_fingerprint: typeof scope.queue_fingerprint === 'string' ? scope.queue_fingerprint : '',
    queue_generation: scope.queue_generation ?? null,
    session_id: typeof scope.session_id === 'string' ? scope.session_id : '',
    journey_id: typeof scope.journey_id === 'string' ? scope.journey_id : '',
    task_id: typeof scope.task_id === 'string' ? scope.task_id : '',
    run_id: typeof scope.run_id === 'string' ? scope.run_id : '',
    source_run_stamp: typeof scope.source_run_stamp === 'string' ? scope.source_run_stamp : '',
    source_stdout_sha256: typeof scope.source_stdout_sha256 === 'string' ? scope.source_stdout_sha256 : '',
  };
  const invalidatedScope = {
    ...scope,
    state: 'invalidated',
    invalidated_at: timestamp,
    invalidated_run_stamp: String(runStamp),
    invalidated_reason: 'runtime_proposal_apply_approval_expired',
  };
  const history = Array.isArray(claim.objective_apply_resume_scope_history)
    ? [...claim.objective_apply_resume_scope_history]
    : [];
  history.push({
    at: timestamp,
    event: 'invalidated_by_runtime_authorization_rebaseline',
    run_stamp: String(runStamp),
    reason: 'runtime_proposal_apply_approval_expired',
    prior_state: prior.state,
    prior_source_run_stamp: prior.source_run_stamp,
    prior_session_id: prior.session_id,
    prior_journey_id: prior.journey_id,
    prior_task_id: prior.task_id,
    prior_run_id: prior.run_id,
  });
  return {
    claimPatch: {
      objective_apply_resume_scope: invalidatedScope,
      objective_apply_resume_scope_history: history.slice(-12),
    },
    audit: {
      retired: true,
      reason: 'runtime_proposal_apply_approval_expired',
      prior_scope: prior,
    },
  };
}

export function rebaselineExpiredRuntimeAuthorization({ storeRoot, stateDir, claimPath, stdoutPath, runStamp, cap }) {
  const normalizedCap = parsePositiveInteger(cap);
  const claim = readJson(claimPath);
  const root = readJson(stdoutPath);
  const claimId = typeof claim?.claim_id === 'string' ? claim.claim_id : '';
  if (!claimId) throw new Error('claim_identity_missing');
  if (runtimeErrorCode(root) !== 'runtime_proposal_apply_approval_expired') {
    return { ok: true, rebaselined: false, reason: 'unrecognized_runtime_error' };
  }
  const priorCount = Number.isSafeInteger(claim.runtime_authorization_rebaseline_count)
    && claim.runtime_authorization_rebaseline_count >= 0
    ? claim.runtime_authorization_rebaseline_count : 0;
  if (priorCount >= normalizedCap) {
    return {
      ok: true,
      rebaselined: false,
      reason: 'runtime_authorization_rebaseline_cap_exhausted',
      claim_id: claimId,
      rebaseline_count: priorCount,
      rebaseline_cap: normalizedCap,
    };
  }
  const claimDigest = sha256(claimId);
  const activeStore = path.join(storeRoot, 'phase-loop-claims', claimDigest);
  if (!fs.statSync(activeStore, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error('runtime_claim_store_missing');
  }
  const archiveDir = path.join(storeRoot, 'phase-loop-claim-archives', claimDigest);
  const archiveStore = path.join(archiveDir, `${runStamp}-authorization-expired`);
  if (fs.existsSync(archiveStore)) throw new Error('runtime_authorization_archive_collision');
  const auditPath = path.join(stateDir, 'recovery-audits', `${runStamp}-runtime-authorization-rebaseline.json`);
  const timestamp = new Date().toISOString();
  const retiredObjectiveApplyScope = retireObjectiveApplyScopeForExpiredAuthorization(claim, { timestamp, runStamp });
  const audit = {
    schema_version: 1,
    kind: 'phase_loop_runtime_authorization_rebaseline',
    recorded_at: timestamp,
    run_stamp: String(runStamp),
    cause: 'runtime_proposal_apply_approval_expired',
    claim_id: claimId,
    claim_sha256: `sha256:${claimDigest}`,
    rebaseline_count_before: priorCount,
    rebaseline_count_after: priorCount + 1,
    rebaseline_cap: normalizedCap,
    active_store: activeStore,
    archived_store: archiveStore,
    recovery_policy: 'archive_expired_runtime_session_then_require_fresh_run',
    objective_apply_scope_retirement: retiredObjectiveApplyScope.audit,
  };
  fs.mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
  fs.renameSync(activeStore, archiveStore);
  try {
    const updatedClaim = {
      ...claim,
      runtime_authorization_rebaseline_count: priorCount + 1,
      runtime_authorization_rebaseline_pending: true,
      runtime_authorization_rebaseline_audit_path: auditPath,
      runtime_authorization_rebaseline_reason: 'proposal_apply_approval_expired',
      runtime_authorization_rebaseline_updated_at: timestamp,
      ...retiredObjectiveApplyScope.claimPatch,
    };
    writeJsonAtomically(auditPath, audit);
    writeJsonAtomically(claimPath, updatedClaim);
    return {
      ok: true,
      rebaselined: true,
      claim_id: claimId,
      rebaseline_count: priorCount + 1,
      rebaseline_cap: normalizedCap,
      audit_path: auditPath,
      archived_store: archiveStore,
    };
  } catch (error) {
    if (!fs.existsSync(activeStore) && fs.existsSync(archiveStore)) fs.renameSync(archiveStore, activeStore);
    throw error;
  }
}

function readOption(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const [command, ...args] = process.argv.slice(2);
  if (command !== 'rebaseline') {
    process.stderr.write('usage: phase-loop-runtime-authorization-rebaseline.mjs rebaseline --store-root <path> --state-dir <path> --claim <path> --stdout <path> --run-stamp <value> --cap <integer>\n');
    process.exit(64);
  }
  try {
    const result = rebaselineExpiredRuntimeAuthorization({
      storeRoot: readOption(args, '--store-root'),
      stateDir: readOption(args, '--state-dir'),
      claimPath: readOption(args, '--claim'),
      stdoutPath: readOption(args, '--stdout'),
      runStamp: readOption(args, '--run-stamp'),
      cap: readOption(args, '--cap'),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, code: error instanceof Error ? error.message : 'runtime_authorization_rebaseline_failed' })}\n`);
    process.exit(78);
  }
}
