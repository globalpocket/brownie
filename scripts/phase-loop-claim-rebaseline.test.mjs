import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { rebaselineStaleClaim, restoreAdmissionBackedStaleClaim, writeTerminalExecutionEvidence } from './phase-loop-claim-rebaseline.mjs';
import { recordTerminalFailureRecovery } from './phase-loop-task-ledger.mjs';

const repositoryRoot = path.resolve(new URL('..', import.meta.url).pathname);

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-claim-rebaseline-'));
  const stateDir = path.join(root, 'state');
  const claims = path.join(stateDir, 'todo-claims');
  const runs = path.join(stateDir, 'runs');
  fs.mkdirSync(claims, { recursive: true });
  fs.mkdirSync(runs, { recursive: true });
  const selected = '- [ ] E-23b-roundtrip-target-02: Create only `scripts/roundtrip.test.mjs`:\n  Route: implementation.\n  Source TODO: E-23b-roundtrip.\n  Depends on: <none>.\n  Completion condition: verify the downloaded package.\n  Verification: run `node --test scripts/roundtrip.test.mjs`.';
  const claimPath = path.join(claims, 'current.json');
  writeJson(claimPath, {
    schema_version: 1,
    claim_id: 'todo-g541-roundtrip-r3',
    status: 'in_progress',
    selected_todo: selected,
    queue_generation: 541,
    queue_fingerprint: 'old-queue',
    run_stamp: '20261019T071825Z',
    retry_cap: 0,
  });
  fs.writeFileSync(path.join(root, 'todo.md'), `${selected}\n`);
  writeJson(path.join(stateDir, 'status.json'), { status: 'no_progress', run_id: 'old-run', supervisor_pid: 86793 });
  writeJson(path.join(stateDir, 'progress-state.json'), {
    classification: 'terminal_failure',
    run_stamp: '20261019T071825Z',
    progress_projection: {
      claim_id: 'todo-g541-roundtrip-r3',
      selected_todo: selected,
      stop_class: 'terminal_failure',
      stop_reason: 'terminal_task_failed',
      cli_status: 'no_eligible_task',
    },
  });
  writeJson(path.join(claims, 'todo-queue-state.json'), { generation: 541, fingerprint: 'new-queue' });
  return { root, stateDir, claims, runs, selected, claimPath };
}

function writeResumeAdmission(f, runStamp, overrides = {}) {
  const claim = JSON.parse(fs.readFileSync(f.claimPath, 'utf8'));
  const target = 'scripts/roundtrip.test.mjs';
  const receipt = {
    schema_version: 1,
    kind: 'phase_loop_active_claim_resume_admission_receipt',
    issued_from_stage: 'pre-claim-boundary',
    run_stamp: runStamp,
    claim_id: claim.claim_id,
    claim_run_stamp: claim.run_stamp,
    selected_todo_id: 'E-23b-roundtrip-target-02',
    selected_todo_sha256: crypto.createHash('sha256').update(f.selected).digest('hex'),
    queue_generation: claim.queue_generation,
    queue_fingerprint: claim.queue_fingerprint,
    admitted_targets: [{
      target,
      sha256: `sha256:${'a'.repeat(64)}`,
      materialization_run_stamp: claim.run_stamp,
    }],
    materializations: [{
      materialization_run_stamp: claim.run_stamp,
      materialized_target: target,
    }],
    ...overrides,
  };
  const receiptPath = path.join(f.runs, `${runStamp}.active-claim-resume-admission.json`);
  writeJson(receiptPath, receipt);
  return receiptPath;
}

function writeBoundaryOnlyTerminalProjection(f) {
  writeJson(path.join(f.stateDir, 'status.json'), {
    status: 'blocked',
    detail: 'Phase-loop preflight failed before continuing; code=contract_unsatisfiable_dirty_scope.',
  });
  writeJson(path.join(f.stateDir, 'progress-state.json'), {
    classification: 'terminal_failure',
    progress_projection: {
      claim_id: 'todo-g541-roundtrip-r3',
      controller_action: 'stop',
      stop_class: 'no_actionable_work',
      stop_reason: 'no_actionable_work',
      cli_status: 'no_eligible_task',
      terminal_final_state: '',
      terminal_task_status: '',
      blocked_by_terminal_task_failure: false,
      objective_apply_terminal_failure: false,
    },
  });
  writeJson(path.join(f.claims, 'todo-queue-state.json'), { generation: 541, fingerprint: 'old-queue' });
}

function archiveAdmissionBackedBoundaryClaim(f, rebaselineRunStamp, receiptOverrides = {}) {
  writeBoundaryOnlyTerminalProjection(f);
  const receiptPath = writeResumeAdmission(f, rebaselineRunStamp, receiptOverrides);
  const claim = JSON.parse(fs.readFileSync(f.claimPath, 'utf8'));
  const rebaselineId = `rebaseline-${rebaselineRunStamp}-${crypto.createHash('sha256').update(claim.claim_id).digest('hex').slice(0, 12)}`;
  const auditName = `${rebaselineId}.json`;
  const archiveName = `stale-rebaseline-${rebaselineRunStamp}.json`;
  const audit = {
    schema_version: 1,
    kind: 'phase_loop_claim_rebaseline',
    rebaseline_id: rebaselineId,
    run_stamp: rebaselineRunStamp,
    source_claim: {
      claim_id: claim.claim_id,
      run_stamp: claim.run_stamp,
      queue_generation: claim.queue_generation,
      queue_fingerprint: claim.queue_fingerprint,
    },
    selected_todo_id: 'E-23b-roundtrip-target-02',
    selected_todo_sha256: crypto.createHash('sha256').update(f.selected).digest('hex'),
    reasons: {
      stale_materialized_scope_boundary: true,
      terminal_projection: true,
      ledger_terminal_events: [],
      prior_terminal_runs: [],
      resume_admission: { valid: true, path: receiptPath },
    },
  };
  const archived = {
    ...claim,
    status: 'stale_snapshot_rejected',
    archive_reason: 'stale_claim_rebaseline',
    recovery_state: 'redelegatable',
    retry_eligible: true,
    rebaseline_id: rebaselineId,
    rebaseline_audit: path.join('todo-claims', auditName),
    rebaselined_at: '2026-10-20T09:00:00.000Z',
  };
  const auditPath = path.join(f.claims, auditName);
  const archivePath = path.join(f.claims, archiveName);
  writeJson(auditPath, audit);
  writeJson(archivePath, archived);
  fs.unlinkSync(f.claimPath);
  return { archivePath, auditPath, receiptPath, rebaselineId };
}

test('isolates stale running r3 claim and records source/queue rebaseline before fresh delegation', () => {
  const f = fixture();
  const result = rebaselineStaleClaim({
    repo: repositoryRoot,
    stateDir: f.stateDir,
    claimPath: f.claimPath,
    statusPath: path.join(f.stateDir, 'status.json'),
    progressPath: path.join(f.stateDir, 'progress-state.json'),
    queuePath: path.join(f.claims, 'todo-queue-state.json'),
    ledgerPath: path.join(f.stateDir, 'task-ledger.jsonl'),
    runsDir: f.runs,
    todoPath: path.join(f.root, 'todo.md'),
    runStamp: '20261020T090000Z',
    baselineRef: 'origin/main',
  });
  assert.equal(result.rebaselined, true, JSON.stringify(result));
  assert.equal(fs.existsSync(f.claimPath), false);
  const audit = JSON.parse(fs.readFileSync(result.audit_path, 'utf8'));
  const archived = JSON.parse(fs.readFileSync(result.stale_claim_path, 'utf8'));
  assert.equal(audit.source.baseline_ref, 'origin/main');
  assert.match(audit.source.baseline_commit, /^[0-9a-f]{40}$/u);
  assert.equal(audit.queue.fingerprint, 'new-queue');
  assert.equal(audit.source_claim.claim_id, 'todo-g541-roundtrip-r3');
  assert.equal(audit.recovery_state, 'redelegatable');
  assert.equal(audit.retry_policy, 'do_not_inherit_source_claim_retry_cap_or_terminal_state');
  assert.equal(archived.retry_eligible, true);
  assert.equal(archived.recovery_state, 'redelegatable');
  assert.equal(fs.readFileSync(path.join(f.root, 'todo.md'), 'utf8'), `${f.selected}\n`);
});

test('preserves an ownerless same-queue continuation claim for resume despite historical terminal ledger evidence', () => {
  const f = fixture();
  writeJson(path.join(f.stateDir, 'status.json'), {
    status: 'recovered_stale_running',
    continuation_required: true,
    controller_action: 'resume',
  });
  writeJson(path.join(f.stateDir, 'progress-state.json'), {
    classification: 'continuation_required',
    continuation_required: true,
    progress_projection: {
      claim_id: 'todo-g541-roundtrip-r3',
      controller_action: 'resume',
      stop_class: 'continuation_required',
    },
  });
  writeJson(path.join(f.claims, 'todo-queue-state.json'), { generation: 541, fingerprint: 'old-queue' });
  fs.writeFileSync(path.join(f.stateDir, 'task-ledger.jsonl'), `${JSON.stringify({
    claim_id: 'todo-g541-roundtrip-r3', to_state: 'completed',
  })}\n`);
  const result = rebaselineStaleClaim({
    repo: repositoryRoot,
    stateDir: f.stateDir,
    claimPath: f.claimPath,
    statusPath: path.join(f.stateDir, 'status.json'),
    progressPath: path.join(f.stateDir, 'progress-state.json'),
    queuePath: path.join(f.claims, 'todo-queue-state.json'),
    ledgerPath: path.join(f.stateDir, 'task-ledger.jsonl'),
    runsDir: f.runs,
    todoPath: path.join(f.root, 'todo.md'),
    runStamp: '20261020T090000Z',
    baselineRef: 'origin/main',
  });
  assert.equal(result.rebaselined, false, JSON.stringify(result));
  assert.equal(result.reason, 'continuation_claim_preserved_for_resume');
  assert.equal(fs.existsSync(f.claimPath), true);
});

test('preserves the same rejected-review root for a fresh admission despite queue-generation drift', () => {
  const f = fixture();
  const claim = JSON.parse(fs.readFileSync(f.claimPath, 'utf8'));
  Object.assign(claim, {
    root_claim_id: claim.claim_id,
    review_rework: { required: true, state: 'CHANGES_REQUESTED' },
    review_rework_fresh_dispatch_pending: true,
    review_rework_fresh_dispatch_recovery_id: 'review-rework-recovery',
    legacy_completion_recovery: { recovery_id: 'review-rework-recovery' },
  });
  writeJson(f.claimPath, claim);
  writeJson(path.join(f.stateDir, 'status.json'), {
    status: 'integrity_blocked',
    run_id: 'old-run',
  });
  writeJson(path.join(f.stateDir, 'progress-state.json'), {
    classification: 'terminal_failure',
    progress_projection: {
      claim_id: claim.claim_id,
      stop_class: 'terminal_failure',
      stop_reason: 'terminal_task_failed',
    },
  });
  // The TODO contract/fingerprint is unchanged; only controller bookkeeping
  // advanced its generation.  Historical completion evidence is exactly what
  // the review-rework recovery invalidated, so it must not replace this root.
  writeJson(path.join(f.claims, 'todo-queue-state.json'), { generation: 542, fingerprint: 'old-queue' });
  fs.writeFileSync(path.join(f.stateDir, 'task-ledger.jsonl'), `${JSON.stringify({
    claim_id: claim.claim_id, to_state: 'completed',
  })}\n`);

  const result = rebaselineStaleClaim({
    repo: repositoryRoot,
    stateDir: f.stateDir,
    claimPath: f.claimPath,
    statusPath: path.join(f.stateDir, 'status.json'),
    progressPath: path.join(f.stateDir, 'progress-state.json'),
    queuePath: path.join(f.claims, 'todo-queue-state.json'),
    ledgerPath: path.join(f.stateDir, 'task-ledger.jsonl'),
    runsDir: f.runs,
    todoPath: path.join(f.root, 'todo.md'),
    runStamp: '20261020T090000Z',
    baselineRef: 'origin/main',
  });

  assert.equal(result.rebaselined, false, JSON.stringify(result));
  assert.equal(result.reason, 'review_rework_fresh_dispatch_claim_preserved_for_same_root_admission');
  assert.equal(result.root_claim_id, claim.claim_id);
  assert.equal(result.queue_generation_drift, true);
  const preserved = JSON.parse(fs.readFileSync(f.claimPath, 'utf8'));
  assert.equal(preserved.claim_id, claim.claim_id);
  assert.equal(preserved.root_claim_id, claim.claim_id);
  assert.equal(preserved.review_rework_fresh_dispatch_pending, true);
});

test('does not exempt a non-changes-requested review claim from stale rebaseline', () => {
  const f = fixture();
  const claim = JSON.parse(fs.readFileSync(f.claimPath, 'utf8'));
  Object.assign(claim, {
    root_claim_id: claim.claim_id,
    review_rework: { required: true, state: 'APPROVED' },
    review_rework_fresh_dispatch_pending: true,
    review_rework_fresh_dispatch_recovery_id: 'review-rework-recovery',
    legacy_completion_recovery: { recovery_id: 'review-rework-recovery' },
  });
  writeJson(f.claimPath, claim);
  writeJson(path.join(f.stateDir, 'status.json'), { status: 'integrity_blocked' });
  writeJson(path.join(f.claims, 'todo-queue-state.json'), { generation: 542, fingerprint: 'old-queue' });

  const result = rebaselineStaleClaim({
    repo: repositoryRoot,
    stateDir: f.stateDir,
    claimPath: f.claimPath,
    statusPath: path.join(f.stateDir, 'status.json'),
    progressPath: path.join(f.stateDir, 'progress-state.json'),
    queuePath: path.join(f.claims, 'todo-queue-state.json'),
    ledgerPath: path.join(f.stateDir, 'task-ledger.jsonl'),
    runsDir: f.runs,
    todoPath: path.join(f.root, 'todo.md'),
    runStamp: '20261020T090000Z',
    baselineRef: 'origin/main',
  });

  assert.equal(result.rebaselined, true, JSON.stringify(result));
  assert.equal(fs.existsSync(f.claimPath), false);
});

test('isolates a stale pre-claim materialized-scope boundary claim even when its queue is unchanged', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.root, 'todo.md'), '- [ ] E-replacement: Patch only `scripts/replacement.mjs`:\n  Route: implementation.\n');
  writeJson(path.join(f.stateDir, 'status.json'), {
    status: 'blocked',
    detail: 'Phase-loop preflight failed before continuing; code=contract_unsatisfiable_dirty_scope.',
  });
  writeJson(path.join(f.stateDir, 'progress-state.json'), {
    classification: 'progress',
    progress_projection: {
      claim_id: 'todo-g541-roundtrip-r3',
      applied: 'True',
      controller_action: 'resume',
      stop_class: 'continuation_required',
      selected_todo_first_line_still_pending_after_todo_md_apply: false,
    },
  });
  writeJson(path.join(f.claims, 'todo-queue-state.json'), { generation: 541, fingerprint: 'old-queue' });
  const result = rebaselineStaleClaim({
    repo: repositoryRoot,
    stateDir: f.stateDir,
    claimPath: f.claimPath,
    statusPath: path.join(f.stateDir, 'status.json'),
    progressPath: path.join(f.stateDir, 'progress-state.json'),
    queuePath: path.join(f.claims, 'todo-queue-state.json'),
    ledgerPath: path.join(f.stateDir, 'task-ledger.jsonl'),
    runsDir: f.runs,
    todoPath: path.join(f.root, 'todo.md'),
    runStamp: '20261020T090000Z',
    baselineRef: 'origin/main',
  });
  assert.equal(result.rebaselined, true, JSON.stringify(result));
  const audit = JSON.parse(fs.readFileSync(result.audit_path, 'utf8'));
  assert.equal(audit.reasons.queue_mismatch, false);
  assert.equal(audit.reasons.stale_materialized_scope_boundary, true);
  assert.equal(audit.reasons.stale_applied_projection, true);
  assert.equal(audit.reasons.selected_todo_still_pending, false);
  assert.equal(fs.existsSync(f.claimPath), false);
});

test('preserves a stale boundary claim only when this run attests its exact materialized placeholder', () => {
  const f = fixture();
  const runStamp = '20261020T090000Z';
  writeJson(path.join(f.stateDir, 'status.json'), {
    status: 'blocked',
    detail: 'Phase-loop preflight failed before continuing; code=contract_unsatisfiable_dirty_scope.',
  });
  writeJson(path.join(f.stateDir, 'progress-state.json'), {
    classification: 'progress',
    progress_projection: {
      claim_id: 'todo-g541-roundtrip-r3',
      applied: 'True',
      controller_action: 'resume',
      stop_class: 'continuation_required',
    },
  });
  writeJson(path.join(f.claims, 'todo-queue-state.json'), { generation: 541, fingerprint: 'old-queue' });
  const receiptPath = writeResumeAdmission(f, runStamp);
  const result = rebaselineStaleClaim({
    repo: repositoryRoot,
    stateDir: f.stateDir,
    claimPath: f.claimPath,
    statusPath: path.join(f.stateDir, 'status.json'),
    progressPath: path.join(f.stateDir, 'progress-state.json'),
    queuePath: path.join(f.claims, 'todo-queue-state.json'),
    ledgerPath: path.join(f.stateDir, 'task-ledger.jsonl'),
    runsDir: f.runs,
    todoPath: path.join(f.root, 'todo.md'),
    runStamp,
    baselineRef: 'origin/main',
    resumeAdmissionPath: receiptPath,
  });
  assert.equal(result.rebaselined, false, JSON.stringify(result));
  assert.equal(result.reason, 'boundary_admitted_materialized_claim_preserved_for_resume');
  assert.deepEqual(result.admitted_targets, ['scripts/roundtrip.test.mjs']);
  assert.equal(fs.existsSync(f.claimPath), true);
});

test('preserves a receipt-admitted boundary claim when only controller routing classified a zero-candidate result as terminal', () => {
  const f = fixture();
  const runStamp = '20261020T090000Z';
  writeBoundaryOnlyTerminalProjection(f);
  const receiptPath = writeResumeAdmission(f, runStamp);
  const result = rebaselineStaleClaim({
    repo: repositoryRoot,
    stateDir: f.stateDir,
    claimPath: f.claimPath,
    statusPath: path.join(f.stateDir, 'status.json'),
    progressPath: path.join(f.stateDir, 'progress-state.json'),
    queuePath: path.join(f.claims, 'todo-queue-state.json'),
    ledgerPath: path.join(f.stateDir, 'task-ledger.jsonl'),
    runsDir: f.runs,
    todoPath: path.join(f.root, 'todo.md'),
    runStamp,
    baselineRef: 'origin/main',
    resumeAdmissionPath: receiptPath,
  });
  assert.equal(result.rebaselined, false, JSON.stringify(result));
  assert.equal(result.reason, 'boundary_admitted_materialized_claim_preserved_for_resume');
  assert.equal(result.boundary_only_no_actionable_terminal_projection, true);
  assert.equal(fs.existsSync(f.claimPath), true);
});

test('does not preserve a receipt-admitted boundary claim when Runtime terminal fields are present', () => {
  const f = fixture();
  const runStamp = '20261020T090000Z';
  writeJson(path.join(f.stateDir, 'status.json'), {
    status: 'blocked',
    detail: 'Phase-loop preflight failed before continuing; code=contract_unsatisfiable_dirty_scope.',
  });
  writeJson(path.join(f.stateDir, 'progress-state.json'), {
    classification: 'terminal_failure',
    progress_projection: {
      claim_id: 'todo-g541-roundtrip-r3',
      stop_class: 'terminal_failure',
      stop_reason: 'terminal_task_failed',
      terminal_final_state: 'Failed',
      terminal_task_status: 'Failed',
      blocked_by_terminal_task_failure: true,
    },
  });
  writeJson(path.join(f.claims, 'todo-queue-state.json'), { generation: 541, fingerprint: 'old-queue' });
  const receiptPath = writeResumeAdmission(f, runStamp);
  const result = rebaselineStaleClaim({
    repo: repositoryRoot,
    stateDir: f.stateDir,
    claimPath: f.claimPath,
    statusPath: path.join(f.stateDir, 'status.json'),
    progressPath: path.join(f.stateDir, 'progress-state.json'),
    queuePath: path.join(f.claims, 'todo-queue-state.json'),
    ledgerPath: path.join(f.stateDir, 'task-ledger.jsonl'),
    runsDir: f.runs,
    todoPath: path.join(f.root, 'todo.md'),
    runStamp,
    baselineRef: 'origin/main',
    resumeAdmissionPath: receiptPath,
  });
  assert.equal(result.rebaselined, true, JSON.stringify(result));
  const audit = JSON.parse(fs.readFileSync(result.audit_path, 'utf8'));
  assert.equal(audit.reasons.boundary_only_no_actionable_terminal_projection, false);
  assert.equal(fs.existsSync(f.claimPath), false);
});

test('restores only an audited admission-backed claim that was archived by the boundary-only terminal classification', () => {
  const f = fixture();
  const archive = archiveAdmissionBackedBoundaryClaim(f, '20261020T090000Z');
  const result = restoreAdmissionBackedStaleClaim({
    stateDir: f.stateDir,
    claimPath: f.claimPath,
    statusPath: path.join(f.stateDir, 'status.json'),
    progressPath: path.join(f.stateDir, 'progress-state.json'),
    queuePath: path.join(f.claims, 'todo-queue-state.json'),
    runsDir: f.runs,
    todoPath: path.join(f.root, 'todo.md'),
    runStamp: '20261020T091500Z',
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.restored, true, JSON.stringify(result));
  assert.equal(result.reason, 'admission_backed_stale_claim_restored');
  assert.equal(result.archive_path, archive.archivePath);
  assert.equal(fs.existsSync(archive.archivePath), true);
  const restored = JSON.parse(fs.readFileSync(f.claimPath, 'utf8'));
  assert.equal(restored.status, 'in_progress');
  assert.equal(restored.run_stamp, '20261019T071825Z');
  assert.equal(restored.admission_backed_restore_id, result.restore_id);
  const restoreAudit = JSON.parse(fs.readFileSync(result.restore_audit_path, 'utf8'));
  assert.equal(restoreAudit.source_rebaseline_audit, path.relative(f.stateDir, archive.auditPath));
  assert.deepEqual(restoreAudit.historical_resume_admission.admitted_targets, ['scripts/roundtrip.test.mjs']);
});

test('re-isolates a restored admission-backed claim when this invocation has no fresh boundary receipt', () => {
  const f = fixture();
  archiveAdmissionBackedBoundaryClaim(f, '20261020T090000Z');
  const runStamp = '20261020T091500Z';
  const restored = restoreAdmissionBackedStaleClaim({
    stateDir: f.stateDir,
    claimPath: f.claimPath,
    statusPath: path.join(f.stateDir, 'status.json'),
    progressPath: path.join(f.stateDir, 'progress-state.json'),
    queuePath: path.join(f.claims, 'todo-queue-state.json'),
    runsDir: f.runs,
    todoPath: path.join(f.root, 'todo.md'),
    runStamp,
  });
  assert.equal(restored.restored, true, JSON.stringify(restored));
  const result = rebaselineStaleClaim({
    repo: repositoryRoot,
    stateDir: f.stateDir,
    claimPath: f.claimPath,
    statusPath: path.join(f.stateDir, 'status.json'),
    progressPath: path.join(f.stateDir, 'progress-state.json'),
    queuePath: path.join(f.claims, 'todo-queue-state.json'),
    ledgerPath: path.join(f.stateDir, 'task-ledger.jsonl'),
    runsDir: f.runs,
    todoPath: path.join(f.root, 'todo.md'),
    runStamp,
    baselineRef: 'origin/main',
  });
  assert.equal(result.rebaselined, true, JSON.stringify(result));
  assert.equal(result.reason, 'stale_claim_isolated_before_new_run');
  assert.equal(fs.existsSync(f.claimPath), false);
  const audit = JSON.parse(fs.readFileSync(result.audit_path, 'utf8'));
  assert.equal(audit.reasons.resume_admission.valid, false);
  assert.equal(audit.reasons.resume_admission.reason, 'not_supplied');
});

test('restored admission-backed claim survives the next exact boundary receipt through the rebaseline gate', () => {
  const f = fixture();
  archiveAdmissionBackedBoundaryClaim(f, '20261020T090000Z');
  const restoreRunStamp = '20261020T091500Z';
  const restored = restoreAdmissionBackedStaleClaim({
    stateDir: f.stateDir,
    claimPath: f.claimPath,
    statusPath: path.join(f.stateDir, 'status.json'),
    progressPath: path.join(f.stateDir, 'progress-state.json'),
    queuePath: path.join(f.claims, 'todo-queue-state.json'),
    runsDir: f.runs,
    todoPath: path.join(f.root, 'todo.md'),
    runStamp: restoreRunStamp,
  });
  assert.equal(restored.restored, true, JSON.stringify(restored));
  const freshRunStamp = '20261020T092000Z';
  const freshReceiptPath = writeResumeAdmission(f, freshRunStamp);
  const result = rebaselineStaleClaim({
    repo: repositoryRoot,
    stateDir: f.stateDir,
    claimPath: f.claimPath,
    statusPath: path.join(f.stateDir, 'status.json'),
    progressPath: path.join(f.stateDir, 'progress-state.json'),
    queuePath: path.join(f.claims, 'todo-queue-state.json'),
    ledgerPath: path.join(f.stateDir, 'task-ledger.jsonl'),
    runsDir: f.runs,
    todoPath: path.join(f.root, 'todo.md'),
    runStamp: freshRunStamp,
    baselineRef: 'origin/main',
    resumeAdmissionPath: freshReceiptPath,
  });
  assert.equal(result.rebaselined, false, JSON.stringify(result));
  assert.equal(result.reason, 'boundary_admitted_materialized_claim_preserved_for_resume');
  assert.equal(fs.existsSync(f.claimPath), true);
});

test('does not restore an archived claim when its historical admission receipt cannot be revalidated', () => {
  const f = fixture();
  archiveAdmissionBackedBoundaryClaim(f, '20261020T090000Z', { run_stamp: '20261019T071825Z' });
  const result = restoreAdmissionBackedStaleClaim({
    stateDir: f.stateDir,
    claimPath: f.claimPath,
    statusPath: path.join(f.stateDir, 'status.json'),
    progressPath: path.join(f.stateDir, 'progress-state.json'),
    queuePath: path.join(f.claims, 'todo-queue-state.json'),
    runsDir: f.runs,
    todoPath: path.join(f.root, 'todo.md'),
    runStamp: '20261020T091500Z',
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.restored, false, JSON.stringify(result));
  assert.equal(result.reason, 'no_admission_backed_stale_claim');
  assert.equal(fs.existsSync(f.claimPath), false);
});

test('isolates a stale boundary claim when the purported current-run admission is stale or malformed', () => {
  const f = fixture();
  const runStamp = '20261020T090000Z';
  writeJson(path.join(f.stateDir, 'status.json'), {
    status: 'blocked',
    detail: 'Phase-loop preflight failed before continuing; code=contract_unsatisfiable_dirty_scope.',
  });
  writeJson(path.join(f.stateDir, 'progress-state.json'), {
    classification: 'progress',
    progress_projection: {
      claim_id: 'todo-g541-roundtrip-r3',
      controller_action: 'resume',
      stop_class: 'continuation_required',
    },
  });
  writeJson(path.join(f.claims, 'todo-queue-state.json'), { generation: 541, fingerprint: 'old-queue' });
  const receiptPath = writeResumeAdmission(f, runStamp, { run_stamp: '20261019T071825Z' });
  const result = rebaselineStaleClaim({
    repo: repositoryRoot,
    stateDir: f.stateDir,
    claimPath: f.claimPath,
    statusPath: path.join(f.stateDir, 'status.json'),
    progressPath: path.join(f.stateDir, 'progress-state.json'),
    queuePath: path.join(f.claims, 'todo-queue-state.json'),
    ledgerPath: path.join(f.stateDir, 'task-ledger.jsonl'),
    runsDir: f.runs,
    todoPath: path.join(f.root, 'todo.md'),
    runStamp,
    baselineRef: 'origin/main',
    resumeAdmissionPath: receiptPath,
  });
  assert.equal(result.rebaselined, true, JSON.stringify(result));
  const audit = JSON.parse(fs.readFileSync(result.audit_path, 'utf8'));
  assert.equal(audit.reasons.resume_admission.valid, false);
  assert.equal(audit.reasons.resume_admission.reason, 'identity_or_queue_mismatch');
  assert.equal(fs.existsSync(f.claimPath), false);
});

test('does not preserve a boundary-admitted claim when terminal ledger evidence exists', () => {
  const f = fixture();
  const runStamp = '20261020T090000Z';
  writeJson(path.join(f.stateDir, 'status.json'), {
    status: 'blocked',
    detail: 'Phase-loop preflight failed before continuing; code=contract_unsatisfiable_dirty_scope.',
  });
  writeJson(path.join(f.stateDir, 'progress-state.json'), {
    classification: 'progress',
    progress_projection: {
      claim_id: 'todo-g541-roundtrip-r3',
      controller_action: 'resume',
      stop_class: 'continuation_required',
    },
  });
  writeJson(path.join(f.claims, 'todo-queue-state.json'), { generation: 541, fingerprint: 'old-queue' });
  fs.writeFileSync(path.join(f.stateDir, 'task-ledger.jsonl'), `${JSON.stringify({
    claim_id: 'todo-g541-roundtrip-r3', to_state: 'failed',
  })}\n`);
  const receiptPath = writeResumeAdmission(f, runStamp);
  const result = rebaselineStaleClaim({
    repo: repositoryRoot,
    stateDir: f.stateDir,
    claimPath: f.claimPath,
    statusPath: path.join(f.stateDir, 'status.json'),
    progressPath: path.join(f.stateDir, 'progress-state.json'),
    queuePath: path.join(f.claims, 'todo-queue-state.json'),
    ledgerPath: path.join(f.stateDir, 'task-ledger.jsonl'),
    runsDir: f.runs,
    todoPath: path.join(f.root, 'todo.md'),
    runStamp,
    baselineRef: 'origin/main',
    resumeAdmissionPath: receiptPath,
  });
  assert.equal(result.rebaselined, true, JSON.stringify(result));
  const audit = JSON.parse(fs.readFileSync(result.audit_path, 'utf8'));
  assert.equal(audit.reasons.resume_admission.valid, true);
  assert.equal(audit.reasons.ledger_terminal_events.length, 1);
});

test('preserves an applied continuation when a completed TODO immediately follows its exact selected TODO', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.root, 'todo.md'), `${f.selected}\n- [x] E-completed-after-selection: Completed sibling.\n- [ ] E-later-pending: Later pending work.\n`);
  writeJson(path.join(f.stateDir, 'status.json'), { status: 'stopped' });
  writeJson(path.join(f.stateDir, 'progress-state.json'), {
    classification: 'progress',
    continuation_required: true,
    progress_projection: {
      claim_id: 'todo-g541-roundtrip-r3',
      applied: 'True',
      controller_action: 'resume',
      stop_class: 'continuation_required',
      selected_todo_first_line_still_pending_after_todo_md_apply: false,
    },
  });
  writeJson(path.join(f.claims, 'todo-queue-state.json'), { generation: 541, fingerprint: 'old-queue' });
  const result = rebaselineStaleClaim({
    repo: repositoryRoot,
    stateDir: f.stateDir,
    claimPath: f.claimPath,
    statusPath: path.join(f.stateDir, 'status.json'),
    progressPath: path.join(f.stateDir, 'progress-state.json'),
    queuePath: path.join(f.claims, 'todo-queue-state.json'),
    ledgerPath: path.join(f.stateDir, 'task-ledger.jsonl'),
    runsDir: f.runs,
    todoPath: path.join(f.root, 'todo.md'),
    runStamp: '20261020T090000Z',
    baselineRef: 'origin/main',
  });
  assert.equal(result.rebaselined, false, JSON.stringify(result));
  assert.equal(result.selected_todo_still_pending, true);
  assert.equal(fs.existsSync(f.claimPath), true);
});

test('does not preserve an applied continuation when the selected TODO survives only as prose', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.root, 'todo.md'), `Archived selection: ${f.selected}\n`);
  writeJson(path.join(f.stateDir, 'status.json'), { status: 'stopped' });
  writeJson(path.join(f.stateDir, 'progress-state.json'), {
    classification: 'progress',
    continuation_required: true,
    progress_projection: {
      claim_id: 'todo-g541-roundtrip-r3',
      applied: 'True',
      controller_action: 'resume',
      stop_class: 'continuation_required',
      selected_todo_first_line_still_pending_after_todo_md_apply: false,
    },
  });
  writeJson(path.join(f.claims, 'todo-queue-state.json'), { generation: 541, fingerprint: 'old-queue' });
  const result = rebaselineStaleClaim({
    repo: repositoryRoot,
    stateDir: f.stateDir,
    claimPath: f.claimPath,
    statusPath: path.join(f.stateDir, 'status.json'),
    progressPath: path.join(f.stateDir, 'progress-state.json'),
    queuePath: path.join(f.claims, 'todo-queue-state.json'),
    ledgerPath: path.join(f.stateDir, 'task-ledger.jsonl'),
    runsDir: f.runs,
    todoPath: path.join(f.root, 'todo.md'),
    runStamp: '20261020T090000Z',
    baselineRef: 'origin/main',
  });
  assert.equal(result.rebaselined, true, JSON.stringify(result));
  const audit = JSON.parse(fs.readFileSync(result.audit_path, 'utf8'));
  assert.equal(audit.reasons.selected_todo_still_pending, false);
  assert.equal(audit.reasons.stale_applied_projection, true);
});

test('requires current-run task execution evidence before terminal failure recording', () => {
  const f = fixture();
  const snapshot = path.join(f.runs, 'claim.before-runtime.json');
  const evidence = path.join(f.runs, 'run.execution-evidence.json');
  writeJson(snapshot, { ok: true, claim: { claim_id: 'claim-current', selected_todo: f.selected } });
  const stdout = path.join(f.runs, 'run.stdout.log');
  writeJson(stdout, {
    run: {
      run_id: 'runtime-current',
      phase_loop_claim_id: 'claim-current',
      status: 'no_eligible_task',
      stop_class: 'terminal_failure',
      stop_reason: 'terminal_task_failed',
      automation: { terminal_failure: true },
    },
  });
  const missing = writeTerminalExecutionEvidence({ stdoutPath: stdout, claimSnapshotPath: snapshot, outputPath: evidence, runStamp: 'run-current' });
  assert.equal(missing.task_execution_confirmed, false);
  writeJson(stdout, {
    run: {
      run_id: 'runtime-current',
      phase_loop_claim_id: 'claim-current',
      status: 'task_executed',
      stop_class: 'terminal_failure',
      stop_reason: 'terminal_task_failed',
      terminal_completion_final_state: 'Failed',
      terminal_completion_task_status: 'Failed',
      completion_closure_terminal_task_count: 1,
      automation: { terminal_failure: true },
    },
  });
  const confirmed = writeTerminalExecutionEvidence({ stdoutPath: stdout, claimSnapshotPath: snapshot, outputPath: evidence, runStamp: 'run-current' });
  assert.equal(confirmed.task_execution_confirmed, true);
  const selectedHash = crypto.createHash('sha256').update(f.selected).digest('hex');
  const durable = recordTerminalFailureRecovery(f.root, {
    selected_todo: f.selected,
    claim_id: 'claim-current',
    run_id: 'runtime-current',
    retry_cap: 1,
    controller_fingerprint: 'controller-current',
    execution_evidence: { ...confirmed, selected_todo_sha256: selectedHash },
  });
  assert.equal(durable.ok, true, durable);
  const ledger = fs.readFileSync(path.join(f.root, '.brownie/private/phase-loop/task-ledger.jsonl'), 'utf8');
  assert.match(ledger, /phase_loop_terminal_failure_execution_evidence/u);
  const rejected = recordTerminalFailureRecovery(f.root, {
    selected_todo: f.selected,
    claim_id: 'claim-current',
    run_id: 'runtime-current',
    retry_cap: 0,
    controller_fingerprint: 'controller-current',
    execution_evidence: { ...confirmed, selected_todo_sha256: selectedHash },
  });
  assert.equal(rejected.code, 'terminal_failure_retry_cap_zero_requires_redelegation');
});

test('preserves admitted execution for terminal no-eligible closure without workspace change', () => {
  const f = fixture();
  const snapshot = path.join(f.runs, 'claim.before-runtime.json');
  const evidence = path.join(f.runs, 'run.execution-evidence.json');
  writeJson(snapshot, { ok: true, claim: { claim_id: 'claim-current', selected_todo: f.selected } });
  const stdout = path.join(f.runs, 'run.stdout.log');
  writeJson(stdout, {
    run: {
      run_id: 'runtime-current',
      phase_loop_claim_id: 'claim-current',
      status: 'no_eligible_task',
      stop_class: 'terminal_failure',
      stop_reason: 'terminal_task_failed',
      executed_count: 1,
      task_execution_confirmed: true,
    },
  });
  const result = writeTerminalExecutionEvidence({
    stdoutPath: stdout,
    claimSnapshotPath: snapshot,
    outputPath: evidence,
    runStamp: 'run-current',
    workspaceBefore: 'unchanged-workspace',
    workspaceAfter: 'unchanged-workspace',
  });
  assert.equal(result.task_execution_confirmed, true);
  assert.equal(result.signals.task_execution_confirmed, true);
  assert.equal(result.signals.payload_status, 'no_eligible_task');
  const durable = recordTerminalFailureRecovery(f.root, {
    selected_todo: f.selected,
    claim_id: 'claim-current',
    run_id: 'runtime-current',
    retry_cap: 1,
    controller_fingerprint: 'controller-current',
    execution_evidence: {
      ...result,
      selected_todo_sha256: crypto.createHash('sha256').update(f.selected).digest('hex'),
    },
  });
  assert.equal(durable.ok, true, durable);
});

test('rejects a no-eligible admission flag when the runtime reports zero executed tasks', () => {
  const f = fixture();
  const snapshot = path.join(f.runs, 'claim-snapshot.json');
  const evidence = path.join(f.runs, 'execution-evidence.json');
  writeJson(snapshot, { claim: JSON.parse(fs.readFileSync(f.claimPath, 'utf8')) });
  const stdout = path.join(f.runs, 'run.stdout.log');
  writeJson(stdout, {
    run: {
      run_id: 'runtime-current', phase_loop_claim_id: 'claim-current',
      status: 'no_eligible_task', stop_class: 'terminal_failure',
      stop_reason: 'terminal_task_failed', executed_count: 0,
      task_execution_confirmed: true,
    },
  });
  const result = writeTerminalExecutionEvidence({ stdoutPath: stdout, claimSnapshotPath: snapshot, outputPath: evidence, runStamp: 'run-current' });
  assert.equal(result.task_execution_confirmed, false);
  assert.equal(result.signals.reported_executed_count, 0);
});

test('rejects a no-eligible admission flag when the runtime omits executed task count', () => {
  const f = fixture();
  const snapshot = path.join(f.runs, 'claim-snapshot.json');
  const evidence = path.join(f.runs, 'execution-evidence.json');
  writeJson(snapshot, { claim: JSON.parse(fs.readFileSync(f.claimPath, 'utf8')) });
  const stdout = path.join(f.runs, 'run.stdout.log');
  writeJson(stdout, {
    run: {
      run_id: 'runtime-current', phase_loop_claim_id: 'claim-current',
      status: 'no_eligible_task', stop_class: 'terminal_failure',
      stop_reason: 'terminal_task_failed', task_execution_confirmed: true,
      task_execution: { started: true },
    },
  });
  const result = writeTerminalExecutionEvidence({ stdoutPath: stdout, claimSnapshotPath: snapshot, outputPath: evidence, runStamp: 'run-current' });
  assert.equal(result.task_execution_confirmed, false);
  assert.equal(result.signals.reported_executed_count, null);
});

test('keeps genuine unexecuted terminal no-eligible results fail-closed', () => {
  const f = fixture();
  const snapshot = path.join(f.runs, 'claim.before-runtime.json');
  const evidence = path.join(f.runs, 'run.execution-evidence.json');
  writeJson(snapshot, { ok: true, claim: { claim_id: 'claim-current', selected_todo: f.selected } });
  const stdout = path.join(f.runs, 'run.stdout.log');
  writeJson(stdout, {
    run: {
      run_id: 'runtime-current',
      phase_loop_claim_id: 'claim-current',
      status: 'no_eligible_task',
      stop_class: 'terminal_failure',
      stop_reason: 'terminal_task_failed',
      executed_count: 0,
    },
  });
  const result = writeTerminalExecutionEvidence({ stdoutPath: stdout, claimSnapshotPath: snapshot, outputPath: evidence, runStamp: 'run-current' });
  assert.equal(result.task_execution_confirmed, false);
});
