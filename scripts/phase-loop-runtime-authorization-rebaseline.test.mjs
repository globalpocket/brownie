import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { rebaselineExpiredRuntimeAuthorization } from './phase-loop-runtime-authorization-rebaseline.mjs';

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-runtime-authorization-'));
  const storeRoot = path.join(root, 'runtime-store');
  const stateDir = path.join(root, 'state');
  const claimPath = path.join(stateDir, 'todo-claims', 'current.json');
  const stdoutPath = path.join(stateDir, 'runs', 'run.stdout.log');
  const claimId = 'claim-runtime-authorization';
  const digest = crypto.createHash('sha256').update(claimId).digest('hex');
  const activeStore = path.join(storeRoot, 'phase-loop-claims', digest);
  fs.mkdirSync(activeStore, { recursive: true });
  fs.writeFileSync(path.join(activeStore, 'ledger.json'), '{"session":"old"}\n');
  writeJson(claimPath, { claim_id: claimId, status: 'in_progress' });
  writeJson(stdoutPath, { status: 'runtime_proposal_apply_approval_expired' });
  return { root, storeRoot, stateDir, claimPath, stdoutPath, activeStore, claimId };
}

test('archives an expired runtime session and makes the next attempt require a fresh run', () => {
  const f = fixture();
  const result = rebaselineExpiredRuntimeAuthorization({ ...f, runStamp: '20261028T090000Z', cap: 1 });
  assert.equal(result.rebaselined, true, JSON.stringify(result));
  assert.equal(fs.existsSync(f.activeStore), false);
  assert.equal(fs.readFileSync(path.join(result.archived_store, 'ledger.json'), 'utf8'), '{"session":"old"}\n');
  const claim = JSON.parse(fs.readFileSync(f.claimPath, 'utf8'));
  assert.equal(claim.runtime_authorization_rebaseline_count, 1);
  assert.equal(claim.runtime_authorization_rebaseline_pending, true);
  const audit = JSON.parse(fs.readFileSync(result.audit_path, 'utf8'));
  assert.equal(audit.cause, 'runtime_proposal_apply_approval_expired');
  assert.equal(audit.rebaseline_cap, 1);
});

test('retires a pending objective-apply scope so a replacement preflight can bind a fresh session', () => {
  const f = fixture();
  writeJson(f.claimPath, {
    claim_id: f.claimId,
    status: 'in_progress',
    objective_apply_resume_scope: {
      state: 'pending',
      claim_id: f.claimId,
      selected_todo_sha256: 'a'.repeat(64),
      queue_fingerprint: 'queue-before-expiry',
      queue_generation: 7,
      session_id: 'session-expired',
      journey_id: 'journey-expired',
      task_id: 'task-expired',
      run_id: 'run-expired',
      source_run_stamp: '20261028T085959Z',
      source_stdout_sha256: 'b'.repeat(64),
    },
  });

  const result = rebaselineExpiredRuntimeAuthorization({ ...f, runStamp: '20261028T090000Z', cap: 1 });
  assert.equal(result.rebaselined, true, JSON.stringify(result));
  const claim = JSON.parse(fs.readFileSync(f.claimPath, 'utf8'));
  assert.equal(claim.objective_apply_resume_scope.state, 'invalidated');
  assert.equal(claim.objective_apply_resume_scope.invalidated_reason, 'runtime_proposal_apply_approval_expired');
  assert.equal(claim.objective_apply_resume_scope.invalidated_run_stamp, '20261028T090000Z');
  assert.equal(claim.objective_apply_resume_scope_history.at(-1).event, 'invalidated_by_runtime_authorization_rebaseline');
  const audit = JSON.parse(fs.readFileSync(result.audit_path, 'utf8'));
  assert.equal(audit.objective_apply_scope_retirement.retired, true);
  assert.equal(audit.objective_apply_scope_retirement.prior_scope.session_id, 'session-expired');
  assert.equal(audit.objective_apply_scope_retirement.prior_scope.state, 'pending');
});

test('refuses a second archive when the externally supplied cap is exhausted', () => {
  const f = fixture();
  writeJson(f.claimPath, { claim_id: f.claimId, runtime_authorization_rebaseline_count: 1 });
  const result = rebaselineExpiredRuntimeAuthorization({ ...f, runStamp: '20261028T090000Z', cap: 1 });
  assert.equal(result.rebaselined, false);
  assert.equal(result.reason, 'runtime_authorization_rebaseline_cap_exhausted');
  assert.equal(fs.existsSync(f.activeStore), true);
});

test('does not archive a runtime store for an unrelated error', () => {
  const f = fixture();
  writeJson(f.stdoutPath, { status: 'runtime_invalid_response' });
  const result = rebaselineExpiredRuntimeAuthorization({ ...f, runStamp: '20261028T090000Z', cap: 1 });
  assert.equal(result.rebaselined, false);
  assert.equal(result.reason, 'unrecognized_runtime_error');
  assert.equal(fs.existsSync(f.activeStore), true);
});
