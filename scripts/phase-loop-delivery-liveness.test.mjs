import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  applyMergedDeliveryReverification,
  evaluateDeliveryHandoff,
  produceSemanticCompletionEvidence,
  selectedTodoSha256,
  validateCompletionCertificate,
  verifyMergedDeliveryReverification
} from './phase-loop-delivery-integrity.mjs';
import { validatePhaseLoopProgressIntegrity } from './phase-loop-progress-integrity.mjs';
import { applyReviewReconciliation, reconcileReviewSnapshot } from './phase-loop-review-reconcile.mjs';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function pullRequest({ state = 'OPEN', head = 'a'.repeat(40), reviews = [], mergedAt = null, mergedBy = null } = {}) {
  return {
    number: 999,
    url: 'https://github.com/globalpocket/brownie/pull/999',
    author: { login: 'brownie-agent' },
    state,
    mergedAt,
    mergedBy,
    headRefOid: head,
    reviewDecision: reviews.at(-1)?.state ?? 'REVIEW_REQUIRED',
    reviews,
    statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }]
  };
}

test('clean fixture reaches an applied bounded change, review rework, and merged completion without changing the root claim', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-delivery-liveness-'));
  const artifact = path.join(root, 'artifacts', 'journey-ledger.json');
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  fs.writeFileSync(artifact, '{"journey":"before"}\n');
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'fixture']);
  git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['add', 'artifacts/journey-ledger.json']);
  git(root, ['commit', '--quiet', '-m', 'baseline']);

  const selectedTodo = `- [ ] E-liveness-artifact-journey: Patch only \`artifacts/journey-ledger.json\`.
  Route: implementation.
  Depends on: <none>.
  Completion condition: the artifact journey records workspace mutation, a durable ledger entry, and stale replay rejection evidence.
  Forbidden changes: do not treat a process exit, PR creation, or CI success as completion.
  Verification: run \`node --test scripts/artifact-journey.test.mjs\`.`;
  const claim = {
    claim_id: 'liveness-claim-1',
    root_claim_id: 'liveness-claim-1',
    status: 'in_progress',
    selected_todo: selectedTodo
  };

  fs.writeFileSync(artifact, '{"journey":"applied","ledger":"durable","stale_replay":"rejected"}\n');
  assert.deepEqual(git(root, ['diff', '--name-only']).trim().split('\n'), ['artifacts/journey-ledger.json']);

  const stdoutPayload = {
    ok: true,
    run: {
      completed: true,
      terminal_completion_evidence: {
        final_state: 'Succeeded',
        applied_diff_paths: ['artifacts/journey-ledger.json'],
        stale_replay: 'rejected'
      },
      automation: { continuation_required: false }
    }
  };
  const verification = {
    completed: true,
    results: [{ command: 'node --test scripts/artifact-journey.test.mjs', exit_code: 0 }]
  };
  const semanticCompletionEvidence = produceSemanticCompletionEvidence({ claim, stdoutPayload, verification });
  assert.ok(semanticCompletionEvidence);
  const handoff = evaluateDeliveryHandoff({ claim, stdoutPayload, semanticCompletionEvidence });
  assert.equal(handoff.pr_handoff_allowed, true);
  assert.equal(handoff.completion_allowed, false);

  const pendingClaim = {
    ...claim,
    status: 'pr_pending_review',
    delivery_review: { semantic_completion_evidence: semanticCompletionEvidence }
  };
  const requested = reconcileReviewSnapshot({
    claim: pendingClaim,
    pullRequest: pullRequest({
      reviews: [{ state: 'CHANGES_REQUESTED', author: { login: 'globalpocket' }, commit: { oid: 'a'.repeat(40) }, submittedAt: '2026-10-31T12:00:00Z', body: 'record the replay evidence explicitly' }]
    }),
    reviewer: 'globalpocket',
    implementation: 'brownie-agent'
  });
  const reworkClaim = applyReviewReconciliation({ claim: pendingClaim, reconciliation: requested, at: '2026-10-31T12:01:00Z', runStamp: 'liveness-review-rework' });
  assert.equal(reworkClaim.status, 'changes_requested');
  assert.equal(reworkClaim.root_claim_id, claim.root_claim_id);
  assert.equal(reworkClaim.completion_certificate, undefined);

  fs.writeFileSync(artifact, '{"journey":"applied","ledger":"durable","stale_replay":"rejected","review_rework":"addressed"}\n');
  assert.deepEqual(git(root, ['diff', '--name-only']).trim().split('\n'), ['artifacts/journey-ledger.json']);
  const resubmittedClaim = { ...reworkClaim, status: 'pr_pending_review' };
  const completed = reconcileReviewSnapshot({
    claim: resubmittedClaim,
    pullRequest: pullRequest({
      state: 'MERGED',
      head: 'b'.repeat(40),
      mergedAt: '2026-10-31T12:02:00Z',
      mergedBy: { login: 'globalpocket' },
      reviews: [{ state: 'APPROVED', author: { login: 'globalpocket' }, commit: { oid: 'b'.repeat(40) }, submittedAt: '2026-10-31T12:01:30Z' }]
    }),
    reviewer: 'globalpocket',
    implementation: 'brownie-agent'
  });
  const delivered = applyReviewReconciliation({ claim: resubmittedClaim, reconciliation: completed, at: '2026-10-31T12:03:00Z', runStamp: 'liveness-merged' });
  assert.equal(delivered.status, 'completed');
  assert.equal(delivered.root_claim_id, claim.root_claim_id);
  assert.equal(validateCompletionCertificate({ claim: delivered }).valid, true);
});

test('clean fixture never creates a review handoff from a nonterminal process-success envelope', () => {
  const claim = { claim_id: 'liveness-nonterminal', root_claim_id: 'liveness-nonterminal', selected_todo: '- [ ] E-liveness: bounded work\n  Completion condition: verified.' };
  const handoff = evaluateDeliveryHandoff({
    claim,
    stdoutPayload: {
      ok: true,
      run: {
        completed: false,
        terminal_completion_evidence_missing: true,
        automation: { continuation_required: true }
      }
    }
  });
  assert.equal(handoff.pr_handoff_allowed, false);
  assert.deepEqual(handoff.reasons.sort(), ['continuation_required', 'run_not_completed', 'terminal_completion_evidence_missing']);
});

test('clean liveness quarantines an incomplete predecessor, binds a fresh claim to a reviewed clean merge, and authorizes only then queue consumption', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-merged-consumption-liveness-'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'soak.mjs'), 'export const soak = "before";\n');
  fs.writeFileSync(path.join(root, 'scripts', 'verify.mjs'), 'import "./soak.mjs";\n');
  git(root, ['init', '--quiet', '-b', 'main']);
  git(root, ['config', 'user.name', 'fixture']);
  git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['add', '.']);
  git(root, ['commit', '--quiet', '-m', 'base']);
  git(root, ['switch', '--quiet', '-c', 'implementation']);
  fs.writeFileSync(path.join(root, 'scripts', 'soak.mjs'), 'export const soak = "merged-and-verified";\n');
  git(root, ['add', '.']);
  git(root, ['commit', '--quiet', '-m', 'implement soak']);
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  git(root, ['switch', '--quiet', 'main']);
  git(root, ['merge', '--no-ff', '--no-edit', 'implementation']);
  const merge = git(root, ['rev-parse', 'HEAD']).trim();
  const selected = `- [ ] E-clean-merged-soak: Patch only \`scripts/soak.mjs\`.
  Route: implementation.
  Completion condition: reviewed artifact soak is reverified before queue consumption.
  Verification: run \`node --check scripts/verify.mjs\`.`;
  const freshClaim = {
    claim_id: 'todo-g630-clean-r1',
    root_claim_id: 'todo-g630-clean-r1',
    status: 'in_progress',
    selected_todo: selected,
    selected_todo_id: 'E-clean-merged-soak',
    selected_todo_sha256: selectedTodoSha256({ selected_todo: selected }),
    queue_fingerprint: 'd'.repeat(64),
    queue_generation: 630,
    claim_admission: { kind: 'phase_loop_fresh_claim_admission', claim_id: 'todo-g630-clean-r1' }
  };
  // This record models only preservation of the old partial claim.  It is
  // intentionally not evidence for the new delivery and never enters the
  // re-verification receipt.
  const quarantinedLegacy = { claim_id: 'todo-g630', state: 'quarantined', missing_required_admission_fields: ['selected_todo_sha256'] };
  assert.equal(quarantinedLegacy.state, 'quarantined');
  const result = verifyMergedDeliveryReverification({
    repoRoot: root,
    claim: freshClaim,
    stdoutPayload: { run: { runtime_claim_id: freshClaim.claim_id, payload_status: 'task_executed', reported_executed_count: 1 } },
    review: {
      pr_url: 'https://example.invalid/pull/630', pr_number: 630, state: 'MERGED', merge_commit_oid: merge, head_oid: head,
      author: 'implementation', reviewer: 'review', merge_actor: 'review', merged_at: '2026-11-04T09:38:12Z', observed_at: '2026-11-04T11:39:21Z', approved: true, ci_passed: true
    },
    reviewer: 'review',
    implementation: 'implementation'
  });
  assert.equal(result.valid, true, JSON.stringify(result));
  const completed = applyMergedDeliveryReverification({ claim: freshClaim, evidence: result.evidence });
  assert.equal(completed.valid, true, JSON.stringify(completed.errors));
  const todoBefore = `# Queue\n\n${selected}\n\n- [ ] E-next: next pending TODO\n`;
  const todoAfter = '# Queue\n\n- [ ] E-next: next pending TODO\n';
  const consumption = validatePhaseLoopProgressIntegrity({
    claim: completed.claim,
    todoBefore,
    todoAfter,
    diffFiles: ['.brownie/todo.md'],
    completionRecordExists: true
  });
  assert.equal(consumption.valid, true, JSON.stringify(consumption.errors));
  assert.equal(consumption.merged_delivery_reverified, true);
});
