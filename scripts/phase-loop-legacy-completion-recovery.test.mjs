import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  detectLegacyCompletionRecovery,
  attestLegacyMergedCompletion,
  recoverLegacyRejectedCompletion,
  reconcilePersistedReviewRework
} from './phase-loop-legacy-completion-recovery.mjs';
import { produceSemanticCompletionEvidence } from './phase-loop-delivery-integrity.mjs';
import { appendTaskTransition, taskAttemptId } from './phase-loop-task-ledger.mjs';
import { evaluateTodoQueue } from './phase-loop-todo-evaluator.mjs';
import { validateHistoricalDerivedDeliveryReceipt } from './phase-loop-historical-derived-delivery-integrity.mjs';

const target = `- [ ] E-target: Patch only \`scripts/target.mjs\`.
  Route: implementation.
  Source TODO: E-parent.
  Depends on: <none>.
  Completion condition: target behavior is implemented and verified.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`node --test scripts/target.test.mjs\`.`;

const parent = `- [x] E-parent: historical parent.
  Route: implementation.
  Depends on: <none>.`;

const dependent = `- [ ] E-dependent: must wait for target.
  Route: implementation.
  Depends on: E-target.
  Completion condition: dependent behavior is implemented.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`node --test scripts/dependent.test.mjs\`.`;

const unrelatedNext = `- [ ] E-unrelated-next: Patch only \`scripts/unrelated-next.mjs\`.
  Route: implementation.
  Depends on: <none>.
  Completion condition: unrelated next behavior is implemented and verified.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`node --test scripts/unrelated-next.test.mjs\`.`;

const actorDeployment = {
  schema_version: 1,
  repository: 'example-org/example-repo',
  roles: {
    implementation: { github_login: 'implementation-worker', branch_prefixes: ['implementation/'] },
    review: { github_login: 'reviewer-worker' },
    merge: { github_login: 'reviewer-worker' }
  },
  constraints: { require_independent_review: true }
};

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
}

function derivedHistoricalCompletion({ targetId = 'E-target', rootClaimId = 'legacy-claim', claimId = 'derived-historical-journey' } = {}) {
  const selectedTodo = targetId === 'E-target' ? target : unrelatedNext;
  const artifactTarget = `${targetId}-journey`;
  const evidence = {
    schema_version: 1,
    evidence_id: 'brownie-release-artifact-runtime-journey-v1',
    target: artifactTarget,
    artifact: {
      archive_sha256: `sha256:${'a'.repeat(64)}`,
      artifact_sha256: `sha256:${'b'.repeat(64)}`,
      runtime_sha256: `sha256:${'c'.repeat(64)}`
    },
    checks: {
      mode_pack_load: { passed: true },
      workspace_mutation: { passed: true },
      ledger_generation: { passed: true },
      forced_interruption: { passed: true, controller_action: 'resume', stop_reason: 'fixture_interruption' },
      resume: { passed: true, status: 'no_eligible_task', controller_action: 'stop' },
      stale_replay_rejection: { passed: true, status: 'no_eligible_task', controller_action: 'stop', workspace_unchanged: true }
    }
  };
  const selectedTodoSha256 = sha256(selectedTodo);
  return {
    schema_version: 2,
    record_type: 'derived_historical_delivery_attestation',
    claim_id: claimId,
    root_claim_id: rootClaimId,
    selected_todo_id: targetId,
    selected_todo_sha256: selectedTodoSha256,
    delivery_receipt: {
      schema_version: 1,
      claim_id: claimId,
      root_claim_id: rootClaimId,
      selected_todo_sha256: selectedTodoSha256,
      approved: true,
      ci_passed: true,
      merged: true,
      author: 'implementation-worker',
      reviewer: 'reviewer-worker',
      merge_actor: 'reviewer-worker',
      historical_delivery_evidence: {
        schema_version: 1,
        kind: 'release_artifact_runtime_journey',
        parent_claim_id: rootClaimId,
        parent_selected_todo_sha256: 'd'.repeat(64),
        child_selected_todo_sha256: selectedTodoSha256,
        child_completion_condition_sha256: 'e'.repeat(64),
        replan_record_sha256: 'f'.repeat(64),
        dossier_sha256: '0'.repeat(64),
        pr_url: 'https://github.com/globalpocket/brownie/pull/800',
        pr_head_sha: '1'.repeat(40),
        merge_commit: '2'.repeat(40),
        release_workflow_runs: [{ id: 1, conclusion: 'success', head_sha: '1'.repeat(40), workflow_name: 'Release Workflow' }],
        journey_artifacts: [{
          target: artifactTarget,
          evidence_sha256: sha256(JSON.stringify(canonicalJson(evidence))),
          evidence
        }]
      }
    }
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-legacy-completion-recovery-'));
  fs.mkdirSync(path.join(root, '.brownie'), { recursive: true });
  fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Queue\n\n${parent}\n\n${dependent}\n`);
  fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), '# Breakdown\n');
  const state = '.brownie/private/phase-loop';
  const completion = `${state}/todo-completions/legacy-claim.json`;
  const snapshot = `${state}/runs/legacy.claim.before-runtime.json`;
  const review = `${state}/legacy-review.json`;
  const mergeReceipt = `${state}/legacy-merge.json`;
  writeJson(path.join(root, completion), {
    schema_version: 1,
    claim_id: 'legacy-claim',
    selected_todo_id: 'E-target',
    selected_todo_first_line: target.split('\n')[0]
  });
  writeJson(path.join(root, snapshot), {
    claim_id: 'legacy-claim',
    selected_todo: target,
    baseline_todo_text: `# Queue\n\n${parent.replace('[x]', '[ ]')}\n\n${target}\n\n${dependent}\n`
  });
  writeJson(path.join(root, review), {
    schema_version: 1,
    pr_url: 'https://github.com/globalpocket/brownie/pull/793',
    state: 'OPEN',
    author: 'implementation-worker',
    head_sha: 'a'.repeat(40),
    latest_review: {
      author: 'reviewer-worker',
      state: 'CHANGES_REQUESTED',
      commit_id: 'a'.repeat(40),
      body: 'Implement the actual journey and record its output before requesting review again.'
    }
  });
  const semanticCompletionEvidence = produceSemanticCompletionEvidence({
    claim: { claim_id: 'legacy-claim', root_claim_id: 'legacy-claim', selected_todo: target },
    stdoutPayload: {
      ok: true,
      run: {
        completed: true,
        terminal_completion_evidence: { final_state: 'succeeded' },
        automation: { continuation_required: false }
      }
    },
    verification: {
      completed: true,
      results: [{ command: 'node --test scripts/target.test.mjs', exit_code: 0 }]
    }
  });
  if (!semanticCompletionEvidence) throw new Error('fixture_semantic_completion_evidence_missing');
  writeJson(path.join(root, mergeReceipt), {
    schema_version: 1,
    pr_url: 'https://github.com/globalpocket/brownie/pull/790',
    state: 'MERGED',
    author: 'implementation-worker',
    head_sha: 'b'.repeat(40),
    merge_commit: 'c'.repeat(40),
    merged_at: '2026-10-31T00:00:00.000Z',
    merged_by: 'reviewer-worker',
    latest_approval: {
      author: 'reviewer-worker',
      state: 'APPROVED',
      commit_id: 'b'.repeat(40)
    },
    ci: {
      passed: true,
      checks: [{ name: 'check', status: 'COMPLETED', conclusion: 'SUCCESS' }]
    },
    semantic_completion_evidence: semanticCompletionEvidence
  });
  writeJson(path.join(root, `${state}/todo-claims/current.json`), {
    claim_id: 'unrelated-e23d',
    root_claim_id: 'unrelated-e23d',
    status: 'failed',
    selected_todo: dependent,
    failure_evidence: { reason: 'terminal_completion_evidence_missing' }
  });
  return { root, state, completion, snapshot, review, mergeReceipt, semanticCompletionEvidence, actorDeployment };
}

test('detect blocks a descendant whose absent prerequisite has only a legacy completion record', () => {
  const value = fixture();
  const result = detectLegacyCompletionRecovery({ repoRoot: value.root });
  assert.equal(result.blocked, true);
  assert.deepEqual(result.blockers[0]?.dependency_todo_ids, ['E-target']);
});

test('merged independent delivery can attest a legacy prerequisite without rewriting its historical record', () => {
  const value = fixture();
  const result = attestLegacyMergedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    mergeReceiptPath: value.mergeReceipt,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:00:00.000Z'
  });
  assert.equal(result.attested, true, JSON.stringify(result));
  const durable = JSON.parse(fs.readFileSync(path.join(value.root, result.durable_record_path), 'utf8'));
  assert.equal(durable.schema_version, 2);
  assert.equal(durable.delivery_receipt.merged, true);
  assert.equal(detectLegacyCompletionRecovery({ repoRoot: value.root }).blocked, false);
  const retry = attestLegacyMergedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    mergeReceiptPath: value.mergeReceipt,
    actorDeployment: value.actorDeployment
  });
  assert.equal(retry.idempotent_attestation, true);
});

test('legacy attestation fails closed when merged delivery does not cover every required verification command', () => {
  const value = fixture();
  const receipt = JSON.parse(fs.readFileSync(path.join(value.root, value.mergeReceipt), 'utf8'));
  receipt.semantic_completion_evidence.verification_results = [];
  writeJson(path.join(value.root, value.mergeReceipt), receipt);
  assert.throws(() => attestLegacyMergedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    mergeReceiptPath: value.mergeReceipt,
    actorDeployment: value.actorDeployment
  }), /merged_delivery_receipt_invalid/);
  assert.equal(detectLegacyCompletionRecovery({ repoRoot: value.root }).blocked, true);
});

test('attesting a merged prerequisite allows a separately rejected dependent claim to be restored', () => {
  const value = fixture();
  const rejected = `- [ ] E-rejected: Patch only \`scripts/rejected.mjs\`.
  Route: implementation.
  Source TODO: E-parent.
  Depends on: E-target.
  Completion condition: rejected behavior is implemented and verified.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`node --test scripts/rejected.test.mjs\`.`;
  const completion = `${value.state}/todo-completions/rejected-claim.json`;
  const snapshot = `${value.state}/runs/rejected.claim.before-runtime.json`;
  writeJson(path.join(value.root, completion), {
    schema_version: 1,
    claim_id: 'rejected-claim',
    selected_todo_id: 'E-rejected',
    selected_todo_first_line: rejected.split('\n')[0]
  });
  writeJson(path.join(value.root, snapshot), {
    claim_id: 'rejected-claim',
    selected_todo: rejected,
    baseline_todo_text: `# Queue\n\n${parent.replace('[x]', '[ ]')}\n\n${target}\n\n${rejected}\n\n${dependent}\n`
  });
  assert.equal(detectLegacyCompletionRecovery({ repoRoot: value.root }).blocked, true);
  attestLegacyMergedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    mergeReceiptPath: value.mergeReceipt,
    actorDeployment: value.actorDeployment
  });
  const recovered = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: completion,
    snapshotPath: snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment
  });
  assert.equal(recovered.recovered, true, JSON.stringify(recovered));
  assert.equal(detectLegacyCompletionRecovery({ repoRoot: value.root }).blocked, false);
});

test('recovery restores the exact target, invalidates only the false receipt, archives the displaced claim, and preserves the same root claim', () => {
  const value = fixture();
  const result = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:00:00.000Z'
  });
  assert.equal(result.recovered, true, JSON.stringify(result));
  const todo = fs.readFileSync(path.join(value.root, '.brownie/todo.md'), 'utf8');
  assert(todo.includes(target));
  assert(todo.includes(parent.replace('[x]', '[ ]')));
  const invalidation = JSON.parse(fs.readFileSync(path.join(value.root, result.invalidation_path), 'utf8'));
  assert.equal(invalidation.invalidated_completion_claim_id, 'legacy-claim');
  const current = JSON.parse(fs.readFileSync(path.join(value.root, result.current_claim_path), 'utf8'));
  assert.equal(current.claim_id, 'legacy-claim');
  assert.equal(current.root_claim_id, 'legacy-claim');
  assert.equal(current.status, 'in_progress');
  assert.equal(current.review_rework.state, 'CHANGES_REQUESTED');
  assert.equal(current.review_rework_fresh_dispatch_pending, true);
  assert.equal(current.review_rework_fresh_dispatch_recovery_id, result.recovery_id);
  assert.equal(current.review_rework_fresh_dispatch_attempt, 1);
  const archive = JSON.parse(fs.readFileSync(path.join(value.root, current.legacy_completion_recovery.archived_current_claim_path), 'utf8'));
  assert.equal(archive.claim_id, 'unrelated-e23d');
  assert.equal(archive.failure_evidence.reason, 'terminal_completion_evidence_missing');
  assert.equal(detectLegacyCompletionRecovery({ repoRoot: value.root }).blocked, false);

  const retry = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment
  });
  assert.equal(retry.idempotent_recovery, true);
  assert.equal(retry.fresh_runtime_dispatch_required, true);
  assert.equal(retry.fresh_runtime_dispatch_marker_restored, false);

  // A v1 marker without a generation identity is not safe for a claim-local
  // Runtime-store archive. Repair its identity before any fresh dispatch.
  const missingAttempt = { ...current };
  delete missingAttempt.review_rework_fresh_dispatch_attempt;
  writeJson(path.join(value.root, result.current_claim_path), missingAttempt);
  const generationRepaired = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:00:30.000Z'
  });
  assert.equal(generationRepaired.fresh_runtime_dispatch_required, true);
  assert.equal(generationRepaired.fresh_runtime_dispatch_attempt, 1);
  assert.ok(generationRepaired.fresh_runtime_dispatch_attempt_repair_audit_path);
  const generationRepairedClaim = JSON.parse(fs.readFileSync(path.join(value.root, result.current_claim_path), 'utf8'));
  assert.equal(generationRepairedClaim.review_rework_fresh_dispatch_attempt, 1);

  // Older recovery records may predate the marker.  The idempotent path may
  // repair only the same live root claim and records that repair separately.
  delete generationRepairedClaim.review_rework_fresh_dispatch_pending;
  delete generationRepairedClaim.review_rework_fresh_dispatch_recovery_id;
  delete generationRepairedClaim.review_rework_fresh_dispatch_reason;
  delete generationRepairedClaim.review_rework_fresh_dispatch_requested_at;
  delete generationRepairedClaim.review_rework_fresh_dispatch_attempt;
  writeJson(path.join(value.root, result.current_claim_path), generationRepairedClaim);
  const repaired = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:01:00.000Z'
  });
  assert.equal(repaired.fresh_runtime_dispatch_required, true);
  assert.equal(repaired.fresh_runtime_dispatch_marker_restored, true);
  assert.ok(repaired.fresh_runtime_dispatch_repair_audit_path);
  const repairedClaim = JSON.parse(fs.readFileSync(path.join(value.root, result.current_claim_path), 'utf8'));
  assert.equal(repairedClaim.review_rework_fresh_dispatch_pending, true);
  assert.equal(repairedClaim.review_rework_fresh_dispatch_recovery_id, result.recovery_id);
  assert.equal(repairedClaim.review_rework_fresh_dispatch_attempt, 1);
  const repairAudit = JSON.parse(fs.readFileSync(path.join(value.root, repaired.fresh_runtime_dispatch_repair_audit_path), 'utf8'));
  assert.equal(repairAudit.recovery_id, result.recovery_id);
  assert.equal(repairAudit.reason, 'legacy_review_rework_claim_had_no_fresh_dispatch_marker');
});

test('review-rework recovery retracts only the valid derived completion caused by the rejected root and leaves an unrelated next TODO schedulable', () => {
  const value = fixture();
  const todoPath = path.join(value.root, '.brownie/todo.md');
  fs.writeFileSync(todoPath, `${fs.readFileSync(todoPath, 'utf8').trimEnd()}\n\n${unrelatedNext}\n`);
  const first = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:00:00.000Z'
  });
  const currentPath = path.join(value.root, first.current_claim_path);
  writeJson(currentPath, {
    claim_id: 'fresh-looking-terminal-claim',
    root_claim_id: 'fresh-looking-terminal-claim',
    status: 'integrity_blocked',
    selected_todo: target,
    failure_evidence: { reason: 'terminal_completion_evidence_missing' },
    status_history: [{
      requested_status: 'completed',
      status: 'integrity_blocked',
      updated_at: '2026-10-31T00:00:30.000Z'
    }]
  });
  const derived = derivedHistoricalCompletion();
  assert.equal(validateHistoricalDerivedDeliveryReceipt(derived).valid, true, JSON.stringify(validateHistoricalDerivedDeliveryReceipt(derived)));
  writeJson(path.join(value.root, value.state, 'todo-completions', 'derived-historical-journey.json'), derived);

  const recovered = reconcilePersistedReviewRework({
    repoRoot: value.root,
    statePath: value.state,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:01:00.000Z'
  });

  assert.equal(recovered.recovered, true, JSON.stringify(recovered));
  assert.equal(recovered.queue_validation.valid, true, JSON.stringify(recovered.queue_validation));
  const restoredClaim = JSON.parse(fs.readFileSync(path.join(value.root, recovered.current_claim_path), 'utf8'));
  assert.equal(restoredClaim.claim_id, 'legacy-claim');
  assert.equal(restoredClaim.selected_todo, target);
  assert.equal(recovered.causally_dependent_derived_completion_invalidation_paths.length, 1);
  const invalidation = JSON.parse(fs.readFileSync(
    path.join(value.root, recovered.causally_dependent_derived_completion_invalidation_paths[0]),
    'utf8'
  ));
  assert.equal(invalidation.selected_todo_id, 'E-target');
  assert.equal(invalidation.invalidated_completion_claim_id, derived.claim_id);
  assert.equal(invalidation.rejected_root_completion_claim_id, 'legacy-claim');
  assert.equal(invalidation.reason, 'derived_historical_delivery_depends_on_rejected_legacy_completion');

  const recoveredTodo = fs.readFileSync(todoPath, 'utf8');
  const selection = evaluateTodoQueue(recoveredTodo, {
    repoRoot: value.root,
    // The restored parent and target are held by the preserved review-rework
    // claim. A normal selector must still be able to advance an independent
    // next TODO instead of treating the derived receipt as global completion.
    excludedTodoHashes: [sha256(parent.replace('[x]', '[ ]')), sha256(target)]
  });
  assert.equal(selection.selected_todo_id, 'E-unrelated-next', JSON.stringify(selection));
});

test('review-rework recovery does not invalidate a same-target derived completion with a different root claim', () => {
  const value = fixture();
  const unrelatedRoot = derivedHistoricalCompletion({ rootClaimId: 'other-root-claim', claimId: 'derived-historical-other-root' });
  writeJson(path.join(value.root, value.state, 'todo-completions', 'derived-historical-other-root.json'), unrelatedRoot);

  assert.throws(() => recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:00:00.000Z'
  }), /recovery_queue_validation_failed:completed_todo_reappeared_in_live_queue/);
  assert.equal(fs.existsSync(path.join(value.root, value.state, 'todo-completion-invalidations')), false);
});

test('recovery isolates an already-terminal same-root task attempt without reopening its history', () => {
  const value = fixture();
  const sourceTaskId = taskAttemptId('E-target', 'legacy-claim');
  const specHash = crypto.createHash('sha256').update(target).digest('hex');
  let terminalEvent;
  for (const to_state of ['queued', 'claimed', 'running', 'completed']) {
    const transition = appendTaskTransition(value.root, {
      task_id: sourceTaskId,
      to_state,
      claim_id: 'legacy-claim',
      task_spec_sha256: specHash,
      run_id: 'historical-run'
    });
    assert.equal(transition.ok, true);
    if (to_state === 'completed') terminalEvent = transition.event;
  }
  const recovered = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:00:00.000Z'
  });
  assert.equal(recovered.recovered, true, JSON.stringify(recovered));
  assert.equal(recovered.review_rework_ledger_attempt_isolated, true);
  const current = JSON.parse(fs.readFileSync(path.join(value.root, recovered.current_claim_path), 'utf8'));
  const binding = current.review_rework_ledger_attempt;
  assert.equal(binding.source_task_id, sourceTaskId);
  assert.equal(binding.source_terminal_event_id, terminalEvent.event_id);
  assert.notEqual(binding.ledger_attempt_id, sourceTaskId);
  assert.ok(fs.existsSync(path.join(value.root, binding.audit_path)));

  const reconciled = reconcilePersistedReviewRework({
    repoRoot: value.root,
    statePath: value.state,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:01:00.000Z'
  });
  assert.equal(reconciled.reason, 'review_rework_live_root_preserved');
  assert.equal(reconciled.review_rework_ledger_attempt_id, binding.ledger_attempt_id);
  const unchanged = JSON.parse(fs.readFileSync(path.join(value.root, recovered.current_claim_path), 'utf8'));
  assert.deepEqual(unchanged.review_rework_ledger_attempt, binding);
});

test('review-rework reconciliation accepts an equivalent persisted ledger binding with legacy key ordering', () => {
  const value = fixture();
  const sourceTaskId = taskAttemptId('E-target', 'legacy-claim');
  const specHash = crypto.createHash('sha256').update(target).digest('hex');
  for (const to_state of ['queued', 'claimed', 'running', 'completed']) {
    assert.equal(appendTaskTransition(value.root, {
      task_id: sourceTaskId,
      to_state,
      claim_id: 'legacy-claim',
      task_spec_sha256: specHash,
      run_id: 'historical-run'
    }).ok, true);
  }
  const recovered = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:00:00.000Z'
  });
  const currentPath = path.join(value.root, recovered.current_claim_path);
  const current = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  const binding = current.review_rework_ledger_attempt;
  // This is the historical serialization shape that triggered a false
  // conflict in production: all attested values are equal, only key order
  // differs from the current writer.
  current.review_rework_ledger_attempt = {
    audit_path: binding.audit_path,
    audit_sha256: binding.audit_sha256,
    kind: binding.kind,
    ledger_attempt_id: binding.ledger_attempt_id,
    recovery_id: binding.recovery_id,
    root_claim_id: binding.root_claim_id,
    schema_version: binding.schema_version,
    selected_todo_sha256: binding.selected_todo_sha256,
    source_task_id: binding.source_task_id,
    source_task_spec_sha256: binding.source_task_spec_sha256,
    source_terminal_event_id: binding.source_terminal_event_id,
    source_terminal_event_sha256: binding.source_terminal_event_sha256
  };
  writeJson(currentPath, current);

  const reconciled = reconcilePersistedReviewRework({
    repoRoot: value.root,
    statePath: value.state,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:01:00.000Z'
  });
  assert.equal(reconciled.reason, 'review_rework_live_root_preserved');
  assert.equal(reconciled.review_rework_ledger_attempt_id, binding.ledger_attempt_id);
});

test('idempotent recovery reclaims a terminal claim that displaced its review-rework root without duplicating the target', () => {
  const value = fixture();
  const first = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:00:00.000Z'
  });
  const currentPath = path.join(value.root, first.current_claim_path);
  writeJson(currentPath, {
    claim_id: 'later-terminal-claim',
    root_claim_id: 'later-terminal-claim',
    status: 'integrity_blocked',
    selected_todo: target,
    queue_generation: 2,
    failure_evidence: { reason: 'terminal_completion_evidence_missing' },
    status_history: [{
      status: 'integrity_blocked',
      updated_at: '2026-10-31T00:00:30.000Z'
    }]
  });

  const restored = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:01:00.000Z'
  });
  assert.equal(restored.recovered, true, JSON.stringify(restored));
  assert.equal(restored.idempotent_recovery, true);
  assert.equal(restored.idempotent_displacement, true);
  const archived = JSON.parse(fs.readFileSync(path.join(value.root, restored.displaced_claim_archive_path), 'utf8'));
  assert.equal(archived.claim_id, 'later-terminal-claim');
  assert.equal(archived.status, 'integrity_blocked');
  const current = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  assert.equal(current.claim_id, 'legacy-claim');
  assert.equal(current.root_claim_id, 'legacy-claim');
  assert.equal(current.review_rework_fresh_dispatch_pending, true);
  const todo = fs.readFileSync(path.join(value.root, '.brownie/todo.md'), 'utf8');
  assert.equal((todo.match(/E-target:/gu) ?? []).length, 1);
});

test('reconciles persisted review feedback before a displaced terminal claim can become a fresh-looking TODO', () => {
  const value = fixture();
  const first = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:00:00.000Z'
  });
  const currentPath = path.join(value.root, first.current_claim_path);
  const reviewedRoot = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  assert.equal(reviewedRoot.review_rework_fresh_dispatch_pending, true);
  const feedback = JSON.parse(fs.readFileSync(path.join(value.root, value.state, 'todo-repair-feedback.json'), 'utf8'));
  assert.equal(feedback.recovery_inputs.completion_record_path, value.completion);
  assert.equal(feedback.recovery_inputs.immutable_snapshot_path, value.snapshot);
  assert.equal(feedback.recovery_inputs.review_receipt_path, value.review);

  writeJson(path.join(value.root, value.state, 'todo-claims', 'stale-rebaseline-20261031T000010Z.json'), reviewedRoot);
  writeJson(currentPath, {
    claim_id: 'fresh-looking-terminal-claim',
    root_claim_id: 'fresh-looking-terminal-claim',
    status: 'integrity_blocked',
    selected_todo: target,
    status_history: [{
      requested_status: 'completed',
      status: 'integrity_blocked',
      updated_at: '2026-10-31T00:00:30.000Z'
    }]
  });

  const reconciled = reconcilePersistedReviewRework({
    repoRoot: value.root,
    statePath: value.state,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:01:00.000Z'
  });
  assert.equal(reconciled.applicable, true, JSON.stringify(reconciled));
  assert.equal(reconciled.recovered, true, JSON.stringify(reconciled));
  assert.equal(reconciled.idempotent_displacement, true, JSON.stringify(reconciled));
  const restored = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  assert.equal(restored.claim_id, 'legacy-claim');
  assert.equal(restored.root_claim_id, 'legacy-claim');
  assert.equal(restored.review_rework.state, 'CHANGES_REQUESTED');
  assert.equal(restored.review_rework_fresh_dispatch_pending, true);
  const displaced = JSON.parse(fs.readFileSync(path.join(value.root, reconciled.displaced_claim_archive_path), 'utf8'));
  assert.equal(displaced.claim_id, 'fresh-looking-terminal-claim');
  assert.equal(displaced.status, 'integrity_blocked');
});

test('migrates one canonical immutable lineage pointer from repeated rebaseline archives without choosing by filename', () => {
  const value = fixture();
  const first = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:00:00.000Z'
  });
  const currentPath = path.join(value.root, first.current_claim_path);
  const recoveredRoot = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  const feedbackPath = path.join(value.root, value.state, 'todo-repair-feedback.json');
  const legacyFeedback = JSON.parse(fs.readFileSync(feedbackPath, 'utf8'));
  delete legacyFeedback.lineage_source;
  writeJson(feedbackPath, legacyFeedback);

  const earliest = structuredClone(recoveredRoot);
  earliest.legacy_completion_recovery.recovered_at = '2026-10-31T00:00:00.000Z';
  const later = structuredClone(recoveredRoot);
  later.legacy_completion_recovery.recovered_at = '2026-10-31T00:01:00.000Z';
  writeJson(path.join(value.root, value.state, 'todo-claims', 'stale-rebaseline-20261031T000010Z.json'), later);
  writeJson(path.join(value.root, value.state, 'todo-claims', 'stale-rebaseline-20261031T000009Z.json'), earliest);
  writeJson(currentPath, {
    claim_id: 'fresh-looking-terminal-claim',
    root_claim_id: 'fresh-looking-terminal-claim',
    status: 'integrity_blocked',
    selected_todo: target,
    status_history: [{ requested_status: 'completed', status: 'integrity_blocked', updated_at: '2026-10-31T00:02:00.000Z' }]
  });

  const reconciled = reconcilePersistedReviewRework({
    repoRoot: value.root,
    statePath: value.state,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:03:00.000Z'
  });
  assert.equal(reconciled.recovered, true, JSON.stringify(reconciled));
  assert.equal(reconciled.lineage_source_migrated, true);
  const feedback = JSON.parse(fs.readFileSync(feedbackPath, 'utf8'));
  assert.equal(feedback.lineage_source.established_by, 'legacy_stale_rebaseline_lineage_migration');
  assert.match(feedback.lineage_source.source_claim_path, /20261031T000009Z/);
  assert.ok(feedback.lineage_source_migration.audit_path);
  assert.ok(fs.existsSync(path.join(value.root, feedback.lineage_source_migration.audit_path)));
});

test('fails closed when repeated rebaseline archives have no unique earliest recovery provenance', () => {
  const value = fixture();
  const first = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:00:00.000Z'
  });
  const currentPath = path.join(value.root, first.current_claim_path);
  const recoveredRoot = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  const feedbackPath = path.join(value.root, value.state, 'todo-repair-feedback.json');
  const legacyFeedback = JSON.parse(fs.readFileSync(feedbackPath, 'utf8'));
  delete legacyFeedback.lineage_source;
  writeJson(feedbackPath, legacyFeedback);
  recoveredRoot.legacy_completion_recovery.recovered_at = '2026-10-31T00:00:00.000Z';
  writeJson(path.join(value.root, value.state, 'todo-claims', 'stale-rebaseline-20261031T000010Z.json'), recoveredRoot);
  writeJson(path.join(value.root, value.state, 'todo-claims', 'stale-rebaseline-20261031T000011Z.json'), recoveredRoot);
  writeJson(currentPath, {
    claim_id: 'fresh-looking-terminal-claim',
    root_claim_id: 'fresh-looking-terminal-claim',
    status: 'integrity_blocked',
    selected_todo: target,
    status_history: [{ requested_status: 'completed', status: 'integrity_blocked', updated_at: '2026-10-31T00:02:00.000Z' }]
  });
  assert.throws(() => reconcilePersistedReviewRework({
    repoRoot: value.root,
    statePath: value.state,
    actorDeployment: value.actorDeployment
  }), /review_rework_lineage_source_ambiguous/);
});

test('audits and preempts only an unapplied exact todo-decomposition derivative before restoring the changes-requested root', () => {
  const value = fixture();
  const first = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:00:00.000Z'
  });
  const derivative = `- [ ] E-target-replan: Replan the rejected target only.\n  Route: todo-decomposition.\n  Source TODO: E-target.\n  Depends on: <none>.\n  Completion condition: a bounded replacement is proposed.\n  Forbidden changes: do not apply a workspace patch.\n  Verification: run \`node --test scripts/target.test.mjs\`.`;
  const todoPath = path.join(value.root, '.brownie/todo.md');
  fs.appendFileSync(todoPath, `\n${derivative}\n`);
  const currentPath = path.join(value.root, first.current_claim_path);
  const runStamp = '20261031T000100Z';
  const evidencePath = path.join(value.root, value.state, 'runs', `${runStamp}.execution-evidence.json`);
  writeJson(evidencePath, {
    claim_id: 'unapplied-derivative',
    runtime_claim_id: 'unapplied-derivative',
    selected_todo_sha256: crypto.createHash('sha256').update(derivative).digest('hex'),
    task_execution_confirmed: true,
    signals: { stop_class: 'continuation_required', stop_reason: 'objective_proposal_candidate_ready' }
  });
  writeJson(currentPath, {
    claim_id: 'unapplied-derivative',
    root_claim_id: 'unapplied-derivative',
    status: 'in_progress',
    selected_todo: derivative,
    run_stamp: runStamp,
    terminal_failure_execution_evidence_path: path.relative(value.root, evidencePath)
  });
  writeJson(path.join(value.root, value.state, 'progress-state.json'), {
    workspace_changed: false,
    claim_lifecycle: { claim_id: 'unapplied-derivative' },
    progress_projection: {
      claim_id: 'unapplied-derivative',
      selected_todo: derivative,
      objective_apply_pending: true,
      objective_apply_authorization_consumed: false,
      applied: '',
      selected_todo_still_pending_in_queue: true
    }
  });

  const reconciled = reconcilePersistedReviewRework({
    repoRoot: value.root,
    statePath: value.state,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:02:00.000Z'
  });
  assert.equal(reconciled.recovered, true, JSON.stringify(reconciled));
  assert.ok(reconciled.derivative_preemption_audit_path);
  const restored = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  assert.equal(restored.claim_id, 'legacy-claim');
  const audit = JSON.parse(fs.readFileSync(path.join(value.root, reconciled.derivative_preemption_audit_path), 'utf8'));
  assert.equal(audit.state, 'preempted');
  const archived = JSON.parse(fs.readFileSync(path.join(value.root, reconciled.derivative_archive_path), 'utf8'));
  assert.equal(archived.status, 'review_rework_derivative_preempted');
});

test('does not preempt a review-rework derivative after workspace mutation evidence exists', () => {
  const value = fixture();
  const first = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:00:00.000Z'
  });
  const derivative = `- [ ] E-target-replan: Replan the rejected target only.\n  Route: todo-decomposition.\n  Source TODO: E-target.\n  Depends on: <none>.\n  Completion condition: a bounded replacement is proposed.\n  Forbidden changes: do not apply a workspace patch.\n  Verification: run \`node --test scripts/target.test.mjs\`.`;
  const todoPath = path.join(value.root, '.brownie/todo.md');
  fs.appendFileSync(todoPath, `\n${derivative}\n`);
  const currentPath = path.join(value.root, first.current_claim_path);
  writeJson(currentPath, {
    claim_id: 'applied-derivative',
    root_claim_id: 'applied-derivative',
    status: 'in_progress',
    selected_todo: derivative,
    run_stamp: '20261031T000100Z',
    terminal_failure_execution_evidence_path: path.join(value.state, 'runs', '20261031T000100Z.execution-evidence.json')
  });
  writeJson(path.join(value.root, value.state, 'runs', '20261031T000100Z.execution-evidence.json'), {
    claim_id: 'applied-derivative', runtime_claim_id: 'applied-derivative', selected_todo_sha256: '0'.repeat(64), task_execution_confirmed: true,
    signals: { stop_class: 'continuation_required', stop_reason: 'objective_proposal_candidate_ready' }
  });
  writeJson(path.join(value.root, value.state, 'progress-state.json'), {
    workspace_changed: true,
    claim_lifecycle: { claim_id: 'applied-derivative' },
    progress_projection: { claim_id: 'applied-derivative', selected_todo: derivative, objective_apply_pending: false, applied: 'true' }
  });
  assert.throws(() => reconcilePersistedReviewRework({
    repoRoot: value.root,
    statePath: value.state,
    actorDeployment: value.actorDeployment
  }), /review_rework_lineage_active_derivative_not_safely_preemptible/);
  assert.equal(JSON.parse(fs.readFileSync(currentPath, 'utf8')).claim_id, 'applied-derivative');
});

test('reconciliation preserves a live review-rework root without requiring a stale archive', () => {
  const value = fixture();
  const first = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:00:00.000Z'
  });
  const currentPath = path.join(value.root, first.current_claim_path);
  const reconciled = reconcilePersistedReviewRework({
    repoRoot: value.root,
    statePath: value.state,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:01:00.000Z'
  });
  assert.equal(reconciled.applicable, false, JSON.stringify(reconciled));
  assert.equal(reconciled.reason, 'review_rework_live_root_preserved');
  assert.equal(reconciled.fresh_runtime_dispatch_required, true);
  assert.equal(fs.existsSync(path.join(value.root, value.state, 'todo-claims', 'stale-rebaseline-20261031T000010Z.json')), false);
  const current = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  assert.equal(current.claim_id, 'legacy-claim');
  assert.equal(current.review_rework_fresh_dispatch_pending, true);
});

test('reconciliation rearms exactly one fresh dispatch when a changes-requested root is blocked by its own completion gate', () => {
  const value = fixture();
  const first = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:00:00.000Z'
  });
  const currentPath = path.join(value.root, first.current_claim_path);
  const blockedClaim = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  blockedClaim.status = 'integrity_blocked';
  blockedClaim.review_rework_fresh_dispatch_pending = false;
  blockedClaim.review_rework_fresh_dispatch_activated_run_stamp = '20261031T000010Z';
  blockedClaim.status_history.push({
    requested_status: 'completed',
    status: 'integrity_blocked',
    updated_at: '2026-10-31T00:00:10.000Z'
  });
  blockedClaim.completion_promotion_rejections = [{
    requested_status: 'completed',
    reason: 'completed_requires_claim_bound_completion_certificate_and_independent_review_ci_merge_receipt'
  }];
  writeJson(currentPath, blockedClaim);

  const rearmed = reconcilePersistedReviewRework({
    repoRoot: value.root,
    statePath: value.state,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:01:00.000Z'
  });
  assert.equal(rearmed.applicable, false, JSON.stringify(rearmed));
  assert.equal(rearmed.reason, 'review_rework_live_root_preserved');
  assert.equal(rearmed.fresh_runtime_dispatch_rearmed, true);
  assert.equal(rearmed.fresh_runtime_dispatch_attempt, 2);
  const current = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  assert.equal(current.claim_id, 'legacy-claim');
  assert.equal(current.root_claim_id, 'legacy-claim');
  assert.equal(current.status, 'in_progress');
  assert.equal(current.review_rework_fresh_dispatch_pending, true);
  assert.equal(current.review_rework_fresh_dispatch_attempt, 2);
  assert.equal(current.review_rework_fresh_dispatch_rearm_history.length, 1);
  assert.ok(fs.existsSync(path.join(value.root, rearmed.fresh_runtime_dispatch_rearm_audit_path)));

  current.status = 'integrity_blocked';
  current.review_rework_fresh_dispatch_pending = false;
  current.review_rework_fresh_dispatch_activated_run_stamp = '20261031T000110Z';
  current.status_history.push({
    requested_status: 'completed',
    status: 'integrity_blocked',
    updated_at: '2026-10-31T00:01:10.000Z'
  });
  writeJson(currentPath, current);
  assert.throws(() => reconcilePersistedReviewRework({
    repoRoot: value.root,
    statePath: value.state,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:02:00.000Z'
  }), /review_rework_fresh_dispatch_rearm_limit_exceeded/);
});

test('reconciliation rearms exactly one un-applied direct objective preflight failed by a prior controller replay budget', () => {
  const value = fixture();
  const first = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:00:00.000Z'
  });
  const currentPath = path.join(value.root, first.current_claim_path);
  const failedClaim = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  const runStamp = '20261031T000010Z';
  const evidencePath = path.join(value.root, value.state, 'runs', `${runStamp}.execution-evidence.json`);
  const stdoutPath = path.join(value.root, value.state, 'runs', `${runStamp}.stdout.log`);
  const selectedTodoSha256 = crypto.createHash('sha256').update(target).digest('hex');
  writeJson(evidencePath, {
    claim_id: 'legacy-claim',
    runtime_claim_id: 'legacy-claim',
    selected_todo_sha256: selectedTodoSha256,
    task_execution_confirmed: true,
    signals: {
      payload_status: 'task_executed',
      task_execution_confirmed: true,
      reported_executed_count: 1,
      stop_class: 'continuation_required',
      stop_reason: 'objective_proposal_candidate_ready'
    }
  });
  writeJson(stdoutPath, {
    command: 'run',
    ok: true,
    exit_code: 0,
    run: {
      status: 'task_executed',
      task_execution_confirmed: true,
      executed_count: 1,
      task_id: 'task-fresh-preflight',
      run_id: 'runtime-run-fresh-preflight',
      next_action: 'apply_authorized_objective_proposal',
      objective_proposal_preflight_status: 'authorized_preflight_ready',
      completed: false,
      blocked: false,
      terminal_failure: false
    }
  });
  failedClaim.status = 'failed';
  failedClaim.review_rework_fresh_dispatch_pending = false;
  failedClaim.review_rework_fresh_dispatch_activated_run_stamp = runStamp;
  failedClaim.terminal_failure_execution_evidence_path = evidencePath;
  failedClaim.status_history.push({
    requested_status: 'failed',
    status: 'failed',
    run_stamp: runStamp,
    updated_at: '2026-10-31T00:00:10.000Z'
  });
  writeJson(currentPath, failedClaim);

  const rearmed = reconcilePersistedReviewRework({
    repoRoot: value.root,
    statePath: value.state,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:01:00.000Z'
  });
  assert.equal(rearmed.applicable, false, JSON.stringify(rearmed));
  assert.equal(rearmed.reason, 'review_rework_live_root_preserved');
  assert.equal(rearmed.fresh_runtime_dispatch_rearmed, true);
  assert.equal(rearmed.fresh_runtime_dispatch_rearm_reason, 'unapplied_authorized_objective_preflight_failed_before_apply');
  const current = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  assert.equal(current.status, 'in_progress');
  assert.equal(current.review_rework_fresh_dispatch_pending, true);
  assert.equal(current.review_rework_fresh_dispatch_attempt, 2);
  assert.equal(current.review_rework_fresh_dispatch_rearm_history.length, 1);
  const audit = JSON.parse(fs.readFileSync(path.join(value.root, rearmed.fresh_runtime_dispatch_rearm_audit_path), 'utf8'));
  assert.equal(audit.reason, 'unapplied_authorized_objective_preflight_failed_before_apply');
  assert.equal(audit.evidence.run_stamp, runStamp);

  current.status = 'failed';
  current.review_rework_fresh_dispatch_pending = false;
  current.review_rework_fresh_dispatch_activated_run_stamp = runStamp;
  current.status_history.push({
    requested_status: 'failed',
    status: 'failed',
    run_stamp: runStamp,
    updated_at: '2026-10-31T00:01:10.000Z'
  });
  writeJson(currentPath, current);
  assert.throws(() => reconcilePersistedReviewRework({
    repoRoot: value.root,
    statePath: value.state,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:02:00.000Z'
  }), /review_rework_fresh_dispatch_rearm_limit_exceeded/);
});

test('reconciliation refuses an unproven failed review-rework root instead of rearming it', () => {
  const value = fixture();
  const first = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:00:00.000Z'
  });
  const currentPath = path.join(value.root, first.current_claim_path);
  const failedClaim = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  const runStamp = '20261031T000010Z';
  failedClaim.status = 'failed';
  failedClaim.review_rework_fresh_dispatch_pending = false;
  failedClaim.review_rework_fresh_dispatch_activated_run_stamp = runStamp;
  failedClaim.terminal_failure_execution_evidence_path = path.join(value.root, value.state, 'runs', `${runStamp}.execution-evidence.json`);
  failedClaim.status_history.push({
    requested_status: 'failed',
    status: 'failed',
    run_stamp: runStamp,
    updated_at: '2026-10-31T00:00:10.000Z'
  });
  writeJson(currentPath, failedClaim);

  assert.throws(() => reconcilePersistedReviewRework({
    repoRoot: value.root,
    statePath: value.state,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:01:00.000Z'
  }), /idempotent_recovery_requires_proven_terminal_displacement/);
});

test('reconciliation resolves review feedback only after same-root merged semantic delivery and durable TODO removal', () => {
  const value = fixture();
  const first = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:00:00.000Z'
  });
  const currentPath = path.join(value.root, first.current_claim_path);
  const completedClaim = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  completedClaim.status = 'completed';
  completedClaim.review_rework = { required: false, resolved_at: '2026-10-31T00:01:00.000Z' };
  completedClaim.delivery_review = {
    pr_url: 'https://github.com/globalpocket/brownie/pull/806',
    author: 'implementation-worker',
    reviewer: 'reviewer-worker',
    merge_actor: 'reviewer-worker',
    merged: true,
    approved: true,
    ci_passed: true,
    semantic_completion_evidence: value.semanticCompletionEvidence
  };
  writeJson(currentPath, completedClaim);
  fs.writeFileSync(path.join(value.root, '.brownie/todo.md'), `# Queue\n\n${parent}\n\n${dependent}\n`);

  const reconciled = reconcilePersistedReviewRework({
    repoRoot: value.root,
    statePath: value.state,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:02:00.000Z'
  });
  assert.equal(reconciled.applicable, false, JSON.stringify(reconciled));
  assert.equal(reconciled.resolved, true, JSON.stringify(reconciled));
  const feedback = JSON.parse(fs.readFileSync(path.join(value.root, value.state, 'todo-repair-feedback.json'), 'utf8'));
  assert.equal(feedback.completed, true);
  assert.equal(feedback.resolution, 'independent_review_ci_merge_and_semantic_delivery_verified');
  assert.equal(feedback.resolution_delivery.pr_url, completedClaim.delivery_review.pr_url);
  assert.ok(fs.existsSync(path.join(value.root, feedback.archived_path)));

  const retry = reconcilePersistedReviewRework({
    repoRoot: value.root,
    statePath: value.state,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:03:00.000Z'
  });
  assert.equal(retry.applicable, false, JSON.stringify(retry));
  assert.equal(retry.reason, 'review_rework_feedback_already_resolved');

  const archived = JSON.parse(fs.readFileSync(path.join(value.root, feedback.archived_path), 'utf8'));
  archived.claim_id = 'forged-root-claim';
  writeJson(path.join(value.root, feedback.archived_path), archived);
  assert.throws(() => reconcilePersistedReviewRework({
    repoRoot: value.root,
    statePath: value.state,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:04:00.000Z'
  }), /review_rework_lineage_completed_feedback_archive_invalid/);
});

test('idempotent recovery refuses to replace a running foreign claim', () => {
  const value = fixture();
  const first = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment
  });
  const currentPath = path.join(value.root, first.current_claim_path);
  writeJson(currentPath, {
    claim_id: 'active-foreign-claim',
    root_claim_id: 'active-foreign-claim',
    status: 'running',
    selected_todo: target
  });
  assert.throws(() => recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment
  }), /active_claim_must_be_preserved_before_legacy_recovery/);
  assert.equal(JSON.parse(fs.readFileSync(currentPath, 'utf8')).claim_id, 'active-foreign-claim');
});

test('idempotent recovery preserves claims awaiting review reconciliation', () => {
  for (const status of ['pr_pending_review', 'changes_requested']) {
    const value = fixture();
    const first = recoverLegacyRejectedCompletion({
      repoRoot: value.root,
      statePath: value.state,
      completionPath: value.completion,
      snapshotPath: value.snapshot,
      reviewReceiptPath: value.review,
      actorDeployment: value.actorDeployment
    });
    const currentPath = path.join(value.root, first.current_claim_path);
    const reviewClaim = {
      claim_id: 'review-pending-claim',
      root_claim_id: 'review-pending-claim',
      status,
      selected_todo: target,
      delivery_review: {
        pr_url: 'https://github.com/globalpocket/brownie/pull/999',
        semantic_completion_evidence: { claim_id: 'review-pending-claim' }
      }
    };
    writeJson(currentPath, reviewClaim);
    assert.throws(() => recoverLegacyRejectedCompletion({
      repoRoot: value.root,
      statePath: value.state,
      completionPath: value.completion,
      snapshotPath: value.snapshot,
      reviewReceiptPath: value.review,
      actorDeployment: value.actorDeployment
    }), /review_pending_claim_must_be_preserved_before_legacy_recovery/);
    assert.deepEqual(JSON.parse(fs.readFileSync(currentPath, 'utf8')), reviewClaim, status);
  }
});

test('idempotent recovery refuses an unproven terminal claim with merged delivery evidence', () => {
  const value = fixture();
  const first = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment
  });
  const currentPath = path.join(value.root, first.current_claim_path);
  const completedClaim = {
    claim_id: 'completed-delivery-claim',
    root_claim_id: 'completed-delivery-claim',
    status: 'completed',
    selected_todo: target,
    delivery_review: {
      pr_url: 'https://github.com/globalpocket/brownie/pull/1000',
      approved: true,
      ci_passed: true,
      merged: true
    },
    status_history: [{
      status: 'completed',
      updated_at: '2026-10-31T00:01:00.000Z'
    }]
  };
  writeJson(currentPath, completedClaim);
  assert.throws(() => recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment
  }), /idempotent_recovery_requires_proven_terminal_displacement/);
  assert.deepEqual(JSON.parse(fs.readFileSync(currentPath, 'utf8')), completedClaim);
});

test('idempotent recovery completes an audited initial recovery interrupted after invalidation', () => {
  const value = fixture();
  const todoPath = path.join(value.root, '.brownie/todo.md');
  const currentPath = path.join(value.root, `${value.state}/todo-claims/current.json`);
  const todoBefore = fs.readFileSync(todoPath, 'utf8');
  const claimBefore = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  const first = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:00:00.000Z'
  });
  fs.rmSync(path.join(value.root, first.audit_path));
  writeJson(currentPath, claimBefore);
  fs.writeFileSync(todoPath, todoBefore);

  const retry = recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment,
    now: '2026-10-31T00:01:00.000Z'
  });
  assert.equal(retry.recovered, true, JSON.stringify(retry));
  assert.equal(retry.idempotent_recovery, true);
  assert.equal(retry.idempotent_partial_initial_recovery, true);
  assert.equal(JSON.parse(fs.readFileSync(currentPath, 'utf8')).claim_id, 'legacy-claim');
});

test('recovery fails closed when the review receipt is not a same-head changes-requested decision', () => {
  const value = fixture();
  const receipt = JSON.parse(fs.readFileSync(path.join(value.root, value.review), 'utf8'));
  receipt.latest_review.state = 'APPROVED';
  writeJson(path.join(value.root, value.review), receipt);
  assert.throws(() => recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment
  }), /review_rejection_receipt_invalid/);
  const todo = fs.readFileSync(path.join(value.root, '.brownie/todo.md'), 'utf8');
  assert(!todo.includes(target));
  assert(todo.includes(parent));
});

test('recovery refuses a snapshot from another claim before any state mutation', () => {
  const value = fixture();
  const snapshot = JSON.parse(fs.readFileSync(path.join(value.root, value.snapshot), 'utf8'));
  snapshot.claim_id = 'other-claim';
  writeJson(path.join(value.root, value.snapshot), snapshot);
  assert.throws(() => recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review,
    actorDeployment: value.actorDeployment
  }), /immutable_snapshot_claim_does_not_match_legacy_completion/);
  const todo = fs.readFileSync(path.join(value.root, '.brownie/todo.md'), 'utf8');
  assert(!todo.includes(target));
  assert(todo.includes(parent));
});

test('recovery fails closed when the active deployment is unavailable', () => {
  const value = fixture();
  assert.throws(() => recoverLegacyRejectedCompletion({
    repoRoot: value.root,
    statePath: value.state,
    completionPath: value.completion,
    snapshotPath: value.snapshot,
    reviewReceiptPath: value.review
  }), /actor_deployment_invalid/);
});
