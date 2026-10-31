import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  isolateReviewReworkFreshDispatchRuntimeStore,
  prepareReviewReworkStaleReplayStoreIsolationRepair,
} from './phase-loop-review-rework-dispatch-isolation.mjs';

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-review-rework-isolation-'));
  const storeRoot = path.join(root, 'runtime-store');
  const stateDir = path.join(root, 'state');
  const claimPath = path.join(stateDir, 'todo-claims', 'current.json');
  const claimId = 'claim-review-rework';
  const digest = crypto.createHash('sha256').update(claimId).digest('hex');
  const activeStore = path.join(storeRoot, 'phase-loop-claims', digest);
  fs.mkdirSync(activeStore, { recursive: true });
  fs.writeFileSync(path.join(activeStore, 'stale-continuation.json'), '{"continuation":"rejected"}\n');
  writeJson(claimPath, {
    claim_id: claimId,
    status: 'in_progress',
    review_rework: { required: true, state: 'CHANGES_REQUESTED' },
    review_rework_fresh_dispatch_pending: true,
    review_rework_fresh_dispatch_recovery_id: 'recovery-123',
    review_rework_fresh_dispatch_attempt: 2,
  });
  return { root, storeRoot, stateDir, claimPath, claimId, activeStore };
}

test('archives the prior same-claim Runtime store once before a review-rework fresh dispatch', () => {
  const f = fixture();
  const result = isolateReviewReworkFreshDispatchRuntimeStore({
    ...f,
    now: '2026-10-31T00:00:00.000Z',
  });
  assert.equal(result.isolated, true, JSON.stringify(result));
  assert.equal(fs.existsSync(f.activeStore), false);
  assert.equal(fs.readFileSync(path.join(result.archived_store, 'stale-continuation.json'), 'utf8'), '{"continuation":"rejected"}\n');
  const claim = JSON.parse(fs.readFileSync(f.claimPath, 'utf8'));
  assert.equal(claim.review_rework_fresh_dispatch_store_isolation.dispatch_attempt, 2);
  assert.equal(claim.review_rework_fresh_dispatch_store_isolation.recovery_id, 'recovery-123');
  const audit = JSON.parse(fs.readFileSync(result.audit_path, 'utf8'));
  assert.equal(audit.kind, 'phase_loop_review_rework_fresh_dispatch_runtime_store_isolation');
  assert.equal(audit.recovery_policy, 'archive_prior_claim_runtime_store_then_require_same-claim-fresh-run');
});

test('is idempotent after an interruption once the audit and claim isolation marker exist', () => {
  const f = fixture();
  const first = isolateReviewReworkFreshDispatchRuntimeStore({ ...f, now: '2026-10-31T00:00:00.000Z' });
  const second = isolateReviewReworkFreshDispatchRuntimeStore({ ...f, now: '2026-10-31T00:00:01.000Z' });
  assert.equal(second.isolated, false, JSON.stringify(second));
  assert.equal(second.reason, 'review_rework_runtime_store_already_isolated');
  assert.equal(second.archived_store, first.archived_store);
  assert.equal(fs.existsSync(f.activeStore), false);
});

test('recovers an evidenced interrupted post-isolation store without discarding either Runtime store', () => {
  const f = fixture();
  const first = isolateReviewReworkFreshDispatchRuntimeStore({ ...f, now: '2026-10-31T00:00:00.000Z' });
  // Simulate a legacy reconciliation that restored the same claim without its
  // isolation marker after a new Runtime store had already been initialized.
  const claim = JSON.parse(fs.readFileSync(f.claimPath, 'utf8'));
  delete claim.review_rework_fresh_dispatch_store_isolation;
  writeJson(f.claimPath, claim);
  fs.mkdirSync(f.activeStore, { recursive: true });
  fs.writeFileSync(path.join(f.activeStore, 'interrupted-fresh-dispatch.json'), '{"continuation":"fresh-but-interrupted"}\n');

  const result = isolateReviewReworkFreshDispatchRuntimeStore({ ...f, now: '2026-10-31T00:01:00.000Z' });
  assert.equal(result.isolated, true, JSON.stringify(result));
  assert.equal(result.recovered_after_interruption, true, JSON.stringify(result));
  assert.equal(fs.existsSync(f.activeStore), false);
  assert.equal(fs.readFileSync(path.join(first.archived_store, 'stale-continuation.json'), 'utf8'), '{"continuation":"rejected"}\n');
  assert.equal(
    fs.readFileSync(path.join(result.interrupted_active_store_archive, 'interrupted-fresh-dispatch.json'), 'utf8'),
    '{"continuation":"fresh-but-interrupted"}\n'
  );
  const recoveredClaim = JSON.parse(fs.readFileSync(f.claimPath, 'utf8'));
  assert.equal(recoveredClaim.review_rework_fresh_dispatch_store_isolation.archived_store, first.archived_store);
  assert.equal(
    recoveredClaim.review_rework_fresh_dispatch_store_isolation.interrupted_active_store_archive,
    result.interrupted_active_store_archive
  );
  assert.equal(fs.existsSync(result.interrupted_active_store_audit_path), true);
});

test('fails closed for coexisting stores when the primary isolation audit does not prove their lineage', () => {
  const f = fixture();
  const first = isolateReviewReworkFreshDispatchRuntimeStore({ ...f, now: '2026-10-31T00:00:00.000Z' });
  const claim = JSON.parse(fs.readFileSync(f.claimPath, 'utf8'));
  delete claim.review_rework_fresh_dispatch_store_isolation;
  writeJson(f.claimPath, claim);
  fs.mkdirSync(f.activeStore, { recursive: true });
  fs.writeFileSync(path.join(f.activeStore, 'unproven.json'), '{}\n');
  writeJson(first.audit_path, { kind: 'untrusted' });

  assert.throws(
    () => isolateReviewReworkFreshDispatchRuntimeStore(f),
    /review_rework_runtime_store_isolation_ambiguous/
  );
  assert.equal(fs.existsSync(f.activeStore), true);
});

test('rolls back its new interrupted-store audit when claim persistence fails before commit', () => {
  const f = fixture();
  const first = isolateReviewReworkFreshDispatchRuntimeStore({ ...f, now: '2026-10-31T00:00:00.000Z' });
  const claim = JSON.parse(fs.readFileSync(f.claimPath, 'utf8'));
  delete claim.review_rework_fresh_dispatch_store_isolation;
  writeJson(f.claimPath, claim);
  fs.mkdirSync(f.activeStore, { recursive: true });
  fs.writeFileSync(path.join(f.activeStore, 'interrupted-fresh-dispatch.json'), '{"continuation":"fresh-but-interrupted"}\n');

  const originalRenameSync = fs.renameSync;
  let failClaimCommit = true;
  fs.renameSync = (source, destination) => {
    if (failClaimCommit && path.resolve(destination) === path.resolve(f.claimPath)) {
      failClaimCommit = false;
      throw new Error('injected_claim_commit_failure');
    }
    return originalRenameSync(source, destination);
  };
  try {
    assert.throws(
      () => isolateReviewReworkFreshDispatchRuntimeStore({ ...f, now: '2026-10-31T00:01:00.000Z' }),
      /injected_claim_commit_failure/
    );
  } finally {
    fs.renameSync = originalRenameSync;
  }

  const recoveryDigest = crypto.createHash('sha256').update('recovery-123').digest('hex').slice(0, 16);
  const interruptedAudit = path.join(
    f.stateDir,
    'recovery-audits',
    `${recoveryDigest}-review-rework-dispatch-2-interrupted-store-`
  );
  assert.equal(fs.existsSync(f.activeStore), true);
  assert.equal(fs.readdirSync(path.dirname(interruptedAudit)).some((name) => name.startsWith(path.basename(interruptedAudit))), false);
  const recoveredClaim = JSON.parse(fs.readFileSync(f.claimPath, 'utf8'));
  assert.equal(recoveredClaim.review_rework_fresh_dispatch_store_isolation, undefined);

  const recovered = isolateReviewReworkFreshDispatchRuntimeStore({ ...f, now: '2026-10-31T00:02:00.000Z' });
  assert.equal(recovered.recovered_after_interruption, true, JSON.stringify(recovered));
});

test('does not isolate a runtime store without a pending CHANGES_REQUESTED fresh dispatch', () => {
  const f = fixture();
  const claim = JSON.parse(fs.readFileSync(f.claimPath, 'utf8'));
  claim.review_rework_fresh_dispatch_pending = false;
  writeJson(f.claimPath, claim);
  const result = isolateReviewReworkFreshDispatchRuntimeStore(f);
  assert.equal(result.isolated, false);
  assert.equal(result.reason, 'review_rework_fresh_dispatch_not_pending');
  assert.equal(fs.existsSync(f.activeStore), true);
});

test('records a safe empty-store isolation when the review rework has never initialized Runtime state', () => {
  const f = fixture();
  fs.rmSync(f.activeStore, { recursive: true, force: true });
  const result = isolateReviewReworkFreshDispatchRuntimeStore({ ...f, now: '2026-10-31T00:00:00.000Z' });
  assert.equal(result.isolated, true, JSON.stringify(result));
  assert.equal(result.prior_store_absent, true, JSON.stringify(result));
  const claim = JSON.parse(fs.readFileSync(f.claimPath, 'utf8'));
  assert.equal(claim.review_rework_fresh_dispatch_store_isolation.prior_store_absent, true);
  const repeated = isolateReviewReworkFreshDispatchRuntimeStore(f);
  assert.equal(repeated.reason, 'review_rework_runtime_store_already_verified_absent');
});

function staleReplayFixture() {
  const f = fixture();
  const claim = JSON.parse(fs.readFileSync(f.claimPath, 'utf8'));
  claim.review_rework_fresh_dispatch_pending = false;
  claim.review_rework_fresh_dispatch_activated_run_stamp = '20261031T082134Z';
  claim.review_rework_fresh_dispatch_rearm_history = [{ dispatch_attempt: 2, rearmed_at: '2026-10-31T08:19:47.658Z' }];
  writeJson(f.claimPath, claim);
  const runStamp = '20261031T082134Z';
  const stdoutPath = path.join(f.stateDir, 'runs', `${runStamp}.stdout.log`);
  writeJson(stdoutPath, {
    command: 'resume',
    resume: {
      replayed: true,
      status: 'task_executed',
      candidate_count: 1,
      task_id: null,
      run_id: null,
      next_action: 'apply_authorized_objective_proposal',
    },
  });
  writeJson(path.join(f.stateDir, 'runs', `${runStamp}.execution-evidence.json`), {
    claim_id: f.claimId,
    claim_matches: true,
    task_execution_confirmed: false,
    task_id: null,
    runtime_run_id: null,
  });
  const progressPath = path.join(f.stateDir, 'progress-state.json');
  writeJson(progressPath, {
    run_stamp: runStamp,
    classification: 'terminal_failure',
    meaningful_progress: false,
    workspace_changed: false,
    same_progress_count: 3,
    stagnation_threshold: 3,
    stdout_log: stdoutPath,
    progress_projection: {
      claim_id: f.claimId,
      objective_apply_pending: true,
      objective_apply_target_replay_exhausted: true,
      objective_apply_terminal_failure: true,
      controller_action: 'resume',
      next_action: 'apply_authorized_objective_proposal',
    },
  });
  return { ...f, progressPath, runStamp };
}

test('repairs exactly one evidenced same-claim replay sequence by requiring store isolation and a fresh run', () => {
  const f = staleReplayFixture();
  const first = prepareReviewReworkStaleReplayStoreIsolationRepair({
    ...f,
    now: '2026-10-31T08:30:00.000Z',
  });
  assert.equal(first.prepared, true, JSON.stringify(first));
  const claim = JSON.parse(fs.readFileSync(f.claimPath, 'utf8'));
  assert.equal(claim.review_rework_fresh_dispatch_pending, true);
  assert.equal(claim.review_rework_fresh_dispatch_store_isolation_repair.dispatch_attempt, 2);
  assert.equal(fs.existsSync(first.audit_path), true);
  const repeated = prepareReviewReworkStaleReplayStoreIsolationRepair(f);
  assert.equal(repeated.prepared, false);
  assert.equal(repeated.reason, 'review_rework_stale_replay_store_isolation_repair_already_prepared');
});

test('does not repair a review rework that lacks the replay-only no-execution proof', () => {
  const f = staleReplayFixture();
  const progress = JSON.parse(fs.readFileSync(f.progressPath, 'utf8'));
  progress.workspace_changed = true;
  writeJson(f.progressPath, progress);
  const result = prepareReviewReworkStaleReplayStoreIsolationRepair(f);
  assert.equal(result.prepared, false);
  assert.equal(result.reason, 'review_rework_stale_replay_proof_not_satisfied');
  const claim = JSON.parse(fs.readFileSync(f.claimPath, 'utf8'));
  assert.equal(claim.review_rework_fresh_dispatch_pending, false);
});
