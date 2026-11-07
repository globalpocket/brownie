import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import {
  completionConditionSha256,
  createCompletionCertificate,
  evaluateDeliveryHandoff,
  produceSemanticCompletionEvidence,
  selectedTodoSha256,
  terminalCompletionEvidenceSha256,
  validateCompletionCertificate,
  validateMergedDeliveryReverification,
  validateTerminalDeliveryReceipt,
  validateClaimLifecycleTransition,
  verifyMergedDeliveryReverification,
  applyMergedDeliveryReverification,
  findCleanMergedDeliveryCandidate
} from './phase-loop-delivery-integrity.mjs';

const selectedTodo = `- [ ] target-02: Patch only \`runtime.rs\`.
  Completion condition: the artifact journey persists a ledger and rejects stale replay.
  Verification: run \`node --test scripts/artifact-journey.test.mjs\`.`;
const claim = { claim_id: 'claim-02', root_claim_id: 'claim-02', selected_todo: selectedTodo };

function completedRun(evidence) {
  return {
    ok: true,
    run: {
      completed: true,
      terminal_completion_evidence: { final_state: 'Succeeded', completion_result_fingerprint: 'sha256:terminal-fixture' },
      automation: { continuation_required: false },
      semantic_completion_evidence: evidence
    }
  };
}

function terminalObjectiveApplyRun() {
  const fingerprint = 'sha256:terminal-objective-fixture';
  return {
    ok: true,
    run: {
      completed: false,
      blocked: false,
      continuation_required: true,
      terminal_failure: false,
      task_execution_confirmed: true,
      objective_apply_applied: true,
      completion_closure_terminal_task_count: 1,
      completion_closure_runnable_task_count: 0,
      completion_closure_blocked_task_count: 0,
      completion_result_fingerprint: fingerprint,
      terminal_completion_completion_result_fingerprint: fingerprint,
      terminal_completion_final_state: 'Completed',
      terminal_completion_task_status: 'Completed',
      task_id: 'task-terminal-objective-fixture',
      objective_apply_path: 'runtime.rs',
      automation: {
        completed: false,
        blocked: false,
        continuation_required: true,
        terminal_failure: false
      }
    }
  };
}

function validEvidence() {
  const terminalCompletionEvidence = { final_state: 'Succeeded', completion_result_fingerprint: 'sha256:terminal-fixture' };
  return {
    schema_version: 1,
    root_claim_id: 'claim-02',
    selected_todo_sha256: selectedTodoSha256(claim),
    completion_condition_sha256: completionConditionSha256(claim),
    verification_results: [{ command: 'node --test scripts/artifact-journey.test.mjs', exit_code: 0 }],
    terminal: {
      completed: true,
      continuation_required: false,
      trajectory_failed: false,
      terminal_completion_evidence: terminalCompletionEvidence,
      terminal_completion_evidence_sha256: terminalCompletionEvidenceSha256(terminalCompletionEvidence)
    },
    observables: [{ kind: 'artifact_journey', sha256: 'a'.repeat(64) }]
  };
}

test('a clean exact merged task is a pre-claim candidate but an uncommitted target remains fail closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-merged-delivery-candidate-'));
  const target = path.join(root, 'scripts', 'soak.mjs');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'export const soak = "before";\n');
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '-m', 'baseline'], { cwd: root });

  const selected = `- [ ] E-merged-candidate: Patch only \`scripts/soak.mjs\`:
  Route: implementation.
  Completion condition: the reviewed artifact soak is reverified before queue consumption.
  Verification: run \`node --check scripts/soak.mjs\`.`;
  execFileSync('git', ['switch', '--quiet', '-c', 'implementation'], { cwd: root });
  fs.writeFileSync(target, 'export const soak = "merged";\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '-m', `implement soak\n\nBrownie-Task-Todo: E-merged-candidate\nBrownie-Task-Spec-SHA256: ${selectedTodoSha256({ selected_todo: selected })}`], { cwd: root });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  execFileSync('git', ['switch', '--quiet', 'main'], { cwd: root });
  execFileSync('git', ['merge', '--no-ff', '--no-edit', 'implementation'], { cwd: root, stdio: 'ignore' });
  const mergedRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  // The controller may still be on the implementation branch when GitHub has
  // already merged the delivery. It must verify the observed base revision,
  // while proving every bounded target matches that revision exactly.
  execFileSync('git', ['switch', '--quiet', 'implementation'], { cwd: root });

  const admitted = findCleanMergedDeliveryCandidate({ repoRoot: root, selectedTodo: selected, revision: mergedRevision });
  assert.equal(admitted.valid, true, JSON.stringify(admitted));
  assert.equal(admitted.candidate.head_oid, head);
  assert.equal(admitted.candidate.selected_todo_id, 'E-merged-candidate');
  assert.equal(admitted.candidate.targets[0].path, 'scripts/soak.mjs');

  fs.writeFileSync(target, 'export const soak = "manual-dirty";\n');
  const rejected = findCleanMergedDeliveryCandidate({ repoRoot: root, selectedTodo: selected, revision: mergedRevision });
  assert.deepEqual(rejected, { valid: false, reason: 'merged_delivery_candidate_target_not_clean' });
});

test('a merge-time TODO snapshot cannot admit an implementation merge with an out-of-scope path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-merged-delivery-scope-'));
  const selected = `- [ ] E-42b-snapshot-scope: Patch only \`scripts/soak.mjs\`:
  Route: implementation.
  Completion condition: bounded delivery remains reviewable.
  Verification: run \`node --check scripts/soak.mjs\`.`;
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, '.brownie'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'soak.mjs'), 'export const soak = "before";\n');
  fs.writeFileSync(path.join(root, 'scripts', 'outside.mjs'), 'export const outside = "before";\n');
  fs.writeFileSync(path.join(root, '.brownie', 'todo.md'), `${selected}\n`);
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '-m', 'baseline'], { cwd: root });
  execFileSync('git', ['switch', '--quiet', '-c', 'implementation'], { cwd: root });
  fs.writeFileSync(path.join(root, 'scripts', 'soak.mjs'), 'export const soak = "merged";\n');
  fs.writeFileSync(path.join(root, 'scripts', 'outside.mjs'), 'export const outside = "unexpected";\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '-m', 'implement plus unrelated change'], { cwd: root });
  execFileSync('git', ['switch', '--quiet', 'main'], { cwd: root });
  execFileSync('git', ['merge', '--no-ff', '--no-edit', 'implementation'], { cwd: root, stdio: 'ignore' });

  assert.deepEqual(
    findCleanMergedDeliveryCandidate({ repoRoot: root, selectedTodo: selected }),
    { valid: false, reason: 'merged_delivery_candidate_scope_mismatch' }
  );
});

test('an explicit mismatched trailer cannot fall back to a matching merge-time TODO snapshot', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-merged-delivery-trailer-mismatch-'));
  const selected = `- [ ] E-v2-selected: Patch only \`scripts/soak.mjs\`:
  Route: implementation.
  Completion condition: v2 semantics must not inherit v1 delivery.
  Verification: run \`node --check scripts/soak.mjs\`.`;
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, '.brownie'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'soak.mjs'), 'export const soak = "before";\n');
  fs.writeFileSync(path.join(root, '.brownie', 'todo.md'), `${selected}\n`);
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '-m', 'v2 queue snapshot'], { cwd: root });
  execFileSync('git', ['switch', '--quiet', '-c', 'implementation'], { cwd: root });
  fs.writeFileSync(path.join(root, 'scripts', 'soak.mjs'), 'export const soak = "implementation";\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '-m', `v1 implementation\n\nBrownie-Task-Todo: E-v1-selected\nBrownie-Task-Spec-SHA256: ${'a'.repeat(64)}`], { cwd: root });
  execFileSync('git', ['switch', '--quiet', 'main'], { cwd: root });
  execFileSync('git', ['merge', '--no-ff', '--no-edit', 'implementation'], { cwd: root, stdio: 'ignore' });
  assert.deepEqual(
    findCleanMergedDeliveryCandidate({ repoRoot: root, selectedTodo: selected }),
    { valid: false, reason: 'merged_delivery_candidate_task_spec_binding_mismatch' }
  );
});

test('a selected TODO may be recovered from split reviewed merges with only bounded targets and regression companions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-merged-delivery-split-'));
  const selected = `- [ ] E-42b-split-candidate: Patch only \`scripts/runtime.mjs\`, \`scripts/supply.mjs\`:
  Route: implementation.
  Completion condition: reviewed runtime and supply evidence remain mutually bound.
  Verification: run \`node --check scripts/runtime.mjs\`.`;
  const run = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, '.brownie'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'runtime.mjs'), 'export const runtime = "before";\n');
  fs.writeFileSync(path.join(root, 'scripts', 'supply.mjs'), 'export const supply = "before";\n');
  fs.writeFileSync(path.join(root, '.brownie', 'todo.md'), `${selected}\n`);
  run(['init', '--quiet', '-b', 'main']);
  run(['config', 'user.name', 'fixture']);
  run(['config', 'user.email', 'fixture@example.invalid']);
  run(['add', '.']);
  run(['commit', '--quiet', '-m', 'baseline']);

  run(['switch', '--quiet', '-c', 'supply']);
  fs.writeFileSync(path.join(root, 'scripts', 'supply.mjs'), 'export const supply = "merged";\n');
  fs.writeFileSync(path.join(root, 'scripts', 'guard-runtime-evidence.mjs'), 'export const guarded = true;\n');
  run(['add', '.']);
  run(['commit', '--quiet', '-m', 'supply evidence']);
  run(['switch', '--quiet', 'main']);
  run(['merge', '--no-ff', '--no-edit', 'supply']);

  run(['switch', '--quiet', '-c', 'runtime']);
  fs.writeFileSync(path.join(root, 'scripts', 'runtime.mjs'), 'export const runtime = "merged";\n');
  fs.writeFileSync(path.join(root, 'scripts', 'runtime-evidence.test.mjs'), 'export {};\n');
  run(['add', '.']);
  run(['commit', '--quiet', '-m', 'runtime evidence']);
  run(['switch', '--quiet', 'main']);
  run(['merge', '--no-ff', '--no-edit', 'runtime']);

  const admitted = findCleanMergedDeliveryCandidate({ repoRoot: root, selectedTodo: selected });
  assert.equal(admitted.valid, true, JSON.stringify(admitted));
  assert.equal(admitted.candidate.merge_lineage.length, 2);
  assert.deepEqual(admitted.candidate.targets.map((entry) => entry.path).sort(), ['scripts/runtime.mjs', 'scripts/supply.mjs']);

  const fixtureClaim = {
    claim_id: 'claim-split', root_claim_id: 'claim-split', selected_todo: selected,
    selected_todo_id: 'E-42b-split-candidate', selected_todo_sha256: selectedTodoSha256({ selected_todo: selected }),
    queue_fingerprint: 'f'.repeat(64), queue_generation: 42,
  };
  const reviews = admitted.candidate.merge_lineage.map((entry, index) => ({
    pr_url: `https://example.invalid/pull/${index + 1}`,
    pr_number: index + 1,
    state: 'MERGED',
    merge_commit_oid: entry.merge_commit_oid,
    head_oid: entry.head_oid,
    author: 'implementation-agent', reviewer: 'review-agent', merge_actor: 'review-agent',
    merged_at: '2026-11-06T04:00:00Z', observed_at: '2026-11-06T04:01:00Z',
    approved: true, ci_passed: true,
    latest_reviewer_review_state: 'APPROVED', latest_reviewer_review_commit_oid: entry.head_oid,
    title: 'E-42b-split-candidate reviewed delivery', body: 'Bounded split delivery for E-42b.',
  }));
  const reverified = verifyMergedDeliveryReverification({
    repoRoot: root,
    claim: fixtureClaim,
    stdoutPayload: { run: { runtime_claim_id: fixtureClaim.claim_id, payload_status: 'task_executed', reported_executed_count: 1 } },
    review: reviews,
    reviewer: 'review-agent', implementation: 'implementation-agent',
  });
  assert.equal(reverified.valid, true, JSON.stringify(reverified));
  assert.equal(validateMergedDeliveryReverification({ claim: fixtureClaim, evidence: reverified.evidence }).valid, true);
});

test('a process-success envelope cannot promote continuation_required to delivery success', () => {
  const result = evaluateDeliveryHandoff({
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
  assert.equal(result.process_ok, true);
  assert.equal(result.delivery_state, 'nonterminal');
  assert.equal(result.pr_handoff_allowed, false);
  assert.equal(result.completion_allowed, false);
  assert.deepEqual(result.reasons.sort(), [
    'continuation_required',
    'run_not_completed',
    'terminal_completion_evidence_missing'
  ]);
});

test('a completed run without claim-bound semantic evidence is integrity blocked', () => {
  const result = evaluateDeliveryHandoff({ claim, stdoutPayload: completedRun(null) });
  assert.equal(result.delivery_state, 'integrity_blocked');
  assert.equal(result.pr_handoff_allowed, false);
  assert(result.reasons.includes('semantic_evidence_schema_invalid'));
});

test('claim-bound semantic evidence permits review handoff but never declares delivery complete', () => {
  const result = evaluateDeliveryHandoff({ claim, stdoutPayload: completedRun(validEvidence()) });
  assert.equal(result.delivery_state, 'verification_passed');
  assert.equal(result.pr_handoff_allowed, true);
  assert.equal(result.completion_allowed, false);
});

test('controller binds executed verification and the CLI terminal payload into durable handoff evidence', () => {
  const stdoutPayload = {
    ok: true,
    run: {
      completed: true,
      stop_reason: 'completion finalized',
      terminal_completion_evidence: { final_state: 'Succeeded', completion_result_fingerprint: 'sha256:terminal' },
      automation: { continuation_required: false }
    }
  };
  const evidence = produceSemanticCompletionEvidence({
    claim,
    stdoutPayload,
    verification: {
      completed: true,
      reason: 'selected_todo_verification_passed',
      results: [{ command: 'node --test scripts/artifact-journey.test.mjs', exit_code: 0, stdout_tail: 'passed' }]
    }
  });
  assert.ok(evidence);
  assert.equal(evidence.root_claim_id, 'claim-02');
  assert.equal(evidence.observables.length, 2);
  const result = evaluateDeliveryHandoff({ claim, stdoutPayload, semanticCompletionEvidence: evidence });
  assert.equal(result.pr_handoff_allowed, true);
  assert.deepEqual(result.semantic_completion_evidence, evidence);
});

test('a verified terminal objective apply is eligible for handoff despite its legacy resume envelope', () => {
  const stdoutPayload = terminalObjectiveApplyRun();
  const evidence = produceSemanticCompletionEvidence({
    claim,
    stdoutPayload,
    verification: {
      completed: true,
      results: [{ command: 'node --test scripts/artifact-journey.test.mjs', exit_code: 0 }]
    }
  });
  assert.ok(evidence);
  assert.equal(evidence.terminal.terminal_completion_evidence.final_state, 'Completed');
  assert.equal(evidence.terminal.terminal_completion_evidence.task_status, 'Completed');
  const result = evaluateDeliveryHandoff({ claim, stdoutPayload, semanticCompletionEvidence: evidence });
  assert.equal(result.delivery_state, 'verification_passed');
  assert.equal(result.pr_handoff_allowed, true);
});

test('a terminal-looking objective apply without matching completion fingerprints remains nonterminal', () => {
  const stdoutPayload = terminalObjectiveApplyRun();
  stdoutPayload.run.terminal_completion_completion_result_fingerprint = 'sha256:different';
  const result = evaluateDeliveryHandoff({ claim, stdoutPayload });
  assert.equal(result.pr_handoff_allowed, false);
  assert(result.reasons.includes('continuation_required'));
  assert(result.reasons.includes('run_not_completed'));
});

test('the producer cannot manufacture evidence without a successful executed verification', () => {
  const evidence = produceSemanticCompletionEvidence({
    claim,
    stdoutPayload: completedRun(null),
    verification: { completed: true, results: [] }
  });
  assert.equal(evidence, null);
});

test('the producer rejects a successful process envelope that still requires continuation', () => {
  const evidence = produceSemanticCompletionEvidence({
    claim,
    stdoutPayload: {
      ok: true,
      run: {
        completed: false,
        terminal_completion_evidence_missing: true,
        automation: { continuation_required: true }
      }
    },
    verification: { completed: true, results: [{ command: 'node --test scripts/artifact-journey.test.mjs', exit_code: 0 }] }
  });
  assert.equal(evidence, null);
});

test('a receipt with terminal facts that do not bind its embedded evidence is rejected', () => {
  const evidence = validEvidence();
  evidence.terminal.terminal_completion_evidence.final_state = 'Forged';
  const result = evaluateDeliveryHandoff({ claim, stdoutPayload: completedRun(evidence) });
  assert.equal(result.pr_handoff_allowed, false);
  assert(result.reasons.includes('semantic_evidence_terminal_evidence_hash_mismatch'));
});

test('irrelevant or stale proof cannot be reused for another TODO fingerprint', () => {
  const evidence = validEvidence();
  evidence.selected_todo_sha256 = 'b'.repeat(64);
  const result = evaluateDeliveryHandoff({ claim, stdoutPayload: completedRun(evidence) });
  assert.equal(result.pr_handoff_allowed, false);
  assert(result.reasons.includes('semantic_evidence_todo_mismatch'));
});

test('a completed claim requires approved CI-passing merged review', () => {
  const pending = validateClaimLifecycleTransition({
    previous: claim,
    next: { ...claim, status: 'completed' },
    review: { merged: false, approved: true, ci_passed: true }
  });
  assert.equal(pending.valid, false);
  assert(pending.errors.includes('completed_requires_merged_pr'));

  const review = {
    pr_url: 'https://github.com/globalpocket/brownie/pull/42',
    pr_number: 42,
    head_oid: 'a'.repeat(40),
    merged_at: '2026-10-31T07:00:00Z',
    observed_at: '2026-10-31T07:01:00Z',
    merged: true,
    approved: true,
    ci_passed: true,
    author: 'brownie-agent',
    reviewer: 'globalpocket',
    merge_actor: 'globalpocket',
    semantic_completion_evidence: validEvidence()
  };
  const issuance = createCompletionCertificate({ claim, review, issuedAt: '2026-10-31T07:02:00Z' });
  assert.equal(issuance.valid, true, JSON.stringify(issuance.errors));
  const merged = validateClaimLifecycleTransition({
    previous: claim,
    next: { ...claim, status: 'completed', delivery_review: review, completion_certificate: issuance.certificate },
    review
  });
  assert.equal(merged.valid, true, JSON.stringify(merged.errors));
});

test('a merged review without a durable completion certificate cannot complete a claim', () => {
  const review = {
    pr_url: 'https://github.com/globalpocket/brownie/pull/42',
    pr_number: 42,
    head_oid: 'a'.repeat(40),
    merged_at: '2026-10-31T07:00:00Z',
    observed_at: '2026-10-31T07:01:00Z',
    merged: true,
    approved: true,
    ci_passed: true,
    author: 'brownie-agent',
    reviewer: 'globalpocket',
    merge_actor: 'globalpocket',
    semantic_completion_evidence: validEvidence()
  };
  const result = validateClaimLifecycleTransition({
    previous: claim,
    next: { ...claim, status: 'completed', delivery_review: review },
    review
  });
  assert.equal(result.valid, false);
  assert(result.errors.includes('completion_certificate_schema_invalid'));
});

test('a completion certificate is invalidated by a changed PR head or review rework', () => {
  const review = {
    pr_url: 'https://github.com/globalpocket/brownie/pull/42',
    pr_number: 42,
    head_oid: 'a'.repeat(40),
    merged_at: '2026-10-31T07:00:00Z',
    observed_at: '2026-10-31T07:01:00Z',
    merged: true,
    approved: true,
    ci_passed: true,
    author: 'brownie-agent',
    reviewer: 'globalpocket',
    merge_actor: 'globalpocket',
    semantic_completion_evidence: validEvidence()
  };
  const { certificate } = createCompletionCertificate({ claim, review, issuedAt: '2026-10-31T07:02:00Z' });
  const changedHead = validateCompletionCertificate({
    claim: { ...claim, delivery_review: { ...review, head_oid: 'b'.repeat(40) }, completion_certificate: certificate }
  });
  assert.equal(changedHead.valid, false);
  assert(changedHead.errors.includes('completion_certificate_review_head_oid_mismatch'));

  const rework = validateCompletionCertificate({
    claim: {
      ...claim,
      delivery_review: review,
      completion_certificate: certificate,
      review_rework: { required: true, state: 'CHANGES_REQUESTED' }
    }
  });
  assert.equal(rework.valid, false);
  assert(rework.errors.includes('completion_certificate_invalidated_by_changes_requested'));
});

test('a merged review still cannot complete without an observed independent merge actor', () => {
  const result = validateClaimLifecycleTransition({
    previous: claim,
    next: { ...claim, status: 'completed' },
    review: {
      merged: true,
      approved: true,
      ci_passed: true,
      author: 'brownie-agent',
      reviewer: 'globalpocket',
      semantic_completion_evidence: validEvidence()
    }
  });
  assert.equal(result.valid, false);
  assert(result.errors.includes('completed_requires_observed_reviewer_merge_actor'));
});

test('a durable completion receipt requires the same independent review boundary as a completed claim', () => {
  const valid = validateTerminalDeliveryReceipt({
    claim: {
      ...claim,
      status: 'completed',
      delivery_review: {
        merged: true,
        approved: true,
        ci_passed: true,
        author: 'brownie-agent',
        reviewer: 'globalpocket',
        merge_actor: 'globalpocket',
        semantic_completion_evidence: validEvidence()
      }
    }
  });
  assert.equal(valid.valid, true, JSON.stringify(valid.errors));

  const rejected = validateTerminalDeliveryReceipt({
    claim: { ...claim, status: 'completed', delivery_review: { merged: true, approved: true, ci_passed: true } }
  });
  assert.equal(rejected.valid, false);
  assert(rejected.errors.includes('completed_requires_independent_reviewer'));
});

test('review-requested changes preserve the immutable root claim and fingerprint', () => {
  const rework = validateClaimLifecycleTransition({
    previous: { ...claim, status: 'pr_pending_review' },
    next: { ...claim, status: 'changes_requested' }
  });
  assert.equal(rework.valid, true, JSON.stringify(rework.errors));

  const replacement = validateClaimLifecycleTransition({
    previous: claim,
    next: { ...claim, claim_id: 'replacement-claim', root_claim_id: 'replacement-claim', status: 'changes_requested' }
  });
  assert.equal(replacement.valid, false);
  assert(replacement.errors.includes('root_claim_id_changed'));
});

test('merged delivery re-verification requires exact task execution, reviewed merge scope, clean targets, and rerun verification', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-merged-delivery-'));
  const run = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'scripts', 'target.mjs'), 'export const release = "before";\n');
  fs.writeFileSync(path.join(repo, 'scripts', 'verification.mjs'), 'import "./target.mjs";\n');
  run(['init', '-b', 'main']);
  run(['config', 'user.name', 'fixture']);
  run(['config', 'user.email', 'fixture@example.invalid']);
  run(['add', '.']);
  run(['commit', '-m', 'base']);
  const selected = `- [ ] E-merged-fixture: Patch only \`scripts/target.mjs\`.
  Route: implementation.
  Completion condition: target is verified from its reviewed merge.
  Verification: run \`node --check scripts/verification.mjs\`.`;
  run(['switch', '-c', 'implementation']);
  fs.writeFileSync(path.join(repo, 'scripts', 'target.mjs'), 'export const release = "merged";\n');
  run(['add', '.']);
  run(['commit', '-m', `implement selected target\n\nBrownie-Task-Todo: E-merged-fixture\nBrownie-Task-Spec-SHA256: ${selectedTodoSha256({ selected_todo: selected })}`]);
  const headOid = run(['rev-parse', 'HEAD']);
  run(['switch', 'main']);
  run(['merge', '--no-ff', 'implementation', '-m', 'merge selected target']);
  const mergeOid = run(['rev-parse', 'HEAD']);
  const fixtureClaim = {
    claim_id: 'todo-g999-merged-r1',
    root_claim_id: 'todo-g999-merged-r1',
    selected_todo: selected,
    selected_todo_id: 'E-merged-fixture',
    selected_todo_sha256: selectedTodoSha256({ selected_todo: selected }),
    queue_fingerprint: 'f'.repeat(64),
    queue_generation: 999
  };
  const review = {
    pr_url: 'https://example.invalid/pull/99',
    pr_number: 99,
    state: 'MERGED',
    merge_commit_oid: mergeOid,
    head_oid: headOid,
    author: 'implementation-agent',
    reviewer: 'review-agent',
    merge_actor: 'review-agent',
    merged_at: '2026-11-04T09:38:12Z',
    observed_at: '2026-11-04T11:39:21Z',
    approved: true,
    ci_passed: true,
    latest_reviewer_review_state: 'APPROVED',
    latest_reviewer_review_commit_oid: headOid
  };
  const stdoutPayload = { run: { runtime_claim_id: fixtureClaim.claim_id, payload_status: 'task_executed', reported_executed_count: 1 } };
  const result = verifyMergedDeliveryReverification({
    repoRoot: repo,
    claim: fixtureClaim,
    stdoutPayload,
    review,
    reviewer: 'review-agent',
    implementation: 'implementation-agent'
  });
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.equal(validateMergedDeliveryReverification({ claim: fixtureClaim, evidence: result.evidence }).valid, true);
  const terminalObjectiveApplied = verifyMergedDeliveryReverification({
    repoRoot: repo,
    claim: fixtureClaim,
    stdoutPayload: {
      run: {
        automation: {
          blocked: false,
          terminal_failure: false
        },
        runtime_claim_id: fixtureClaim.claim_id,
        payload_status: 'objective_proposal_applied',
        executed_count: 1,
        task_execution_confirmed: true,
        objective_apply_applied: true,
        blocked: false,
        terminal_failure: false,
        continuation_required: true,
        completion_closure_terminal_task_count: 1,
        completion_closure_runnable_task_count: 0,
        completion_closure_blocked_task_count: 0,
        completion_result_fingerprint: 'sha256:terminal-objective',
        terminal_completion_completion_result_fingerprint: 'sha256:terminal-objective',
        terminal_completion_final_state: 'Completed',
        terminal_completion_task_status: 'Completed'
      }
    },
    review,
    reviewer: 'review-agent',
    implementation: 'implementation-agent'
  });
  assert.equal(terminalObjectiveApplied.valid, true, JSON.stringify(terminalObjectiveApplied));
  assert.equal(validateMergedDeliveryReverification({ claim: fixtureClaim, evidence: terminalObjectiveApplied.evidence }).valid, true);
  const terminalObjectiveAppliedDelivery = applyMergedDeliveryReverification({
    claim: fixtureClaim,
    evidence: terminalObjectiveApplied.evidence,
    issuedAt: '2026-11-04T11:40:01Z'
  });
  assert.equal(terminalObjectiveAppliedDelivery.valid, true, JSON.stringify(terminalObjectiveAppliedDelivery.errors));
  assert.equal(validateTerminalDeliveryReceipt({ claim: terminalObjectiveAppliedDelivery.claim }).valid, true);
  const schemaV1WithoutBinding = structuredClone(result.evidence);
  delete schemaV1WithoutBinding.task_spec_binding;
  assert.equal(validateMergedDeliveryReverification({ claim: fixtureClaim, evidence: schemaV1WithoutBinding }).valid, true);
  const applied = applyMergedDeliveryReverification({ claim: fixtureClaim, evidence: result.evidence, issuedAt: '2026-11-04T11:40:00Z' });
  assert.equal(applied.valid, true, JSON.stringify(applied.errors));
  assert.equal(validateTerminalDeliveryReceipt({ claim: applied.claim }).valid, true);

  const resumed = verifyMergedDeliveryReverification({
    repoRoot: repo,
    claim: fixtureClaim,
    stdoutPayload: { resume: { runtime_claim_id: fixtureClaim.claim_id, payload_status: 'task_executed', reported_executed_count: 1 } },
    review,
    reviewer: 'review-agent',
    implementation: 'implementation-agent'
  });
  assert.equal(resumed.valid, true, JSON.stringify(resumed));

  const changesRequestedAfterApproval = verifyMergedDeliveryReverification({
    repoRoot: repo,
    claim: fixtureClaim,
    stdoutPayload,
    review: {
      ...review,
      latest_reviewer_review_state: 'CHANGES_REQUESTED',
      latest_reviewer_review_commit_oid: headOid,
      approved: false
    },
    reviewer: 'review-agent',
    implementation: 'implementation-agent'
  });
  assert.equal(changesRequestedAfterApproval.valid, false);
  assert(changesRequestedAfterApproval.errors.includes('merged_delivery_latest_reviewer_approval_missing'));

  const versionThree = {
    ...fixtureClaim,
    selected_todo: selected.replace('target is verified from its reviewed merge.', 'target is verified against version three semantics.'),
    selected_todo_sha256: selectedTodoSha256({ selected_todo: selected.replace('target is verified from its reviewed merge.', 'target is verified against version three semantics.') })
  };
  const differentVersion = verifyMergedDeliveryReverification({
    repoRoot: repo,
    claim: versionThree,
    stdoutPayload,
    review,
    reviewer: 'review-agent',
    implementation: 'implementation-agent'
  });
  assert.equal(differentVersion.valid, false);
  assert.deepEqual(differentVersion.errors, ['merged_delivery_task_spec_binding_missing_or_mismatch']);

  const taskOnly = verifyMergedDeliveryReverification({
    repoRoot: repo,
    claim: fixtureClaim,
    stdoutPayload: { run: { runtime_claim_id: fixtureClaim.claim_id, payload_status: 'task_executed', reported_executed_count: 1 } },
    review: { ...review, approved: false },
    reviewer: 'review-agent',
    implementation: 'implementation-agent'
  });
  assert.equal(taskOnly.valid, false);
  assert.equal(taskOnly.reason, 'merged_delivery_reverification_refused');

  fs.appendFileSync(path.join(repo, 'scripts', 'target.mjs'), '// dirty\n');
  const dirty = verifyMergedDeliveryReverification({ repoRoot: repo, claim: fixtureClaim, stdoutPayload, review, reviewer: 'review-agent', implementation: 'implementation-agent' });
  assert.equal(dirty.valid, false);
  assert.deepEqual(dirty.errors, ['merged_delivery_target_not_clean_at_reviewed_merge']);
});
