#!/usr/bin/env node
/**
 * Delivery integrity is intentionally stricter than process success.
 *
 * A runtime may return a syntactically valid response (and the wrapper may
 * therefore exit 0) while explicitly asking the controller to continue.
 * That is not a completed TODO, and it is not eligible for PR publication.
 */
import crypto from 'node:crypto';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { boundedScopes } from './phase-loop-bounded-scope.mjs';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function lineValue(todo, label) {
  const match = String(todo ?? '').match(new RegExp(`^\\s*${label}:\\s*(.+?)\\s*$`, 'mi'));
  return match?.[1]?.trim() ?? '';
}

export function selectedTodoSha256(claim) {
  return sha256(asObject(claim).selected_todo ?? '');
}

export function completionConditionSha256(claim) {
  return sha256(lineValue(asObject(claim).selected_todo, 'Completion condition'));
}

export function rootClaimId(claim) {
  const input = asObject(claim);
  return input.root_claim_id ?? input.claim_id ?? null;
}

export function runDeliveryView(stdoutPayload) {
  const root = asObject(stdoutPayload);
  const run = Object.keys(asObject(root.run)).length > 0
    ? asObject(root.run)
    : Object.keys(asObject(root.resume)).length > 0
      ? asObject(root.resume)
      : root;
  const automation = { ...asObject(root.automation), ...asObject(run.automation) };
  const completed = run.completed === true || (run === root && root.completed === true);
  const continuationRequired = run.continuation_required === true
    || root.continuation_required === true
    || automation.continuation_required === true;
  const terminalEvidenceMissing = run.terminal_completion_evidence_missing === true
    || root.terminal_completion_evidence_missing === true
    || automation.terminal_completion_evidence_missing === true;
  const failure = run.trajectory_failed === true
    || root.trajectory_failed === true
    || automation.trajectory_failed === true;
  return {
    process_ok: root.ok === true,
    completed,
    continuation_required: continuationRequired,
    terminal_completion_evidence_missing: terminalEvidenceMissing,
    trajectory_failed: failure,
    semantic_completion_evidence: run.semantic_completion_evidence
      ?? root.semantic_completion_evidence
      ?? automation.semantic_completion_evidence
      ?? null
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function semanticCompletionEvidenceSha256(evidence) {
  return sha256(canonicalJson(asObject(evidence)));
}

export function terminalCompletionEvidenceSha256(evidence) {
  return sha256(canonicalJson(evidence));
}

function hasTerminalCompletionEvidence(evidence) {
  if (typeof evidence === 'string') return evidence.trim().length > 0;
  return Boolean(evidence && typeof evidence === 'object' && !Array.isArray(evidence) && Object.keys(evidence).length > 0);
}

function git(repoRoot, args) {
  return childProcess.execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function firstTodoLine(claim) {
  return String(asObject(claim).selected_todo ?? '').split('\n')[0] ?? '';
}

function mergedDeliveryScope(claim) {
  return boundedScopes(firstTodoLine(claim));
}

function selectedTodoId(claim) {
  return firstTodoLine(claim)
    .trim()
    .replace(/^(?:[-*]|\d+[.)])\s+\[[ xX]\]\s+/u, '')
    .split(':')[0]
    ?.trim() ?? '';
}

function todoBlocks(text) {
  const source = String(text ?? '');
  const starts = [...source.matchAll(/^(?:[-*]|\d+[.)])\s+\[[ xX]\]\s+/gmu)].map((match) => match.index);
  return starts.map((start, index) => source.slice(start, starts[index + 1] ?? source.length).trimEnd());
}

function taskFamilyKey(todoId) {
  return String(todoId ?? '').match(/^([A-Za-z]+-\d+[A-Za-z]+)/u)?.[1] ?? '';
}

function isSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40,64}$/i.test(value);
}

function runtimeTaskExecution(claim, stdoutPayload) {
  const root = asObject(stdoutPayload);
  const run = Object.keys(asObject(root.run)).length > 0
    ? asObject(root.run)
    : Object.keys(asObject(root.resume)).length > 0
      ? asObject(root.resume)
      : root;
  const runtimeClaimId = run.runtime_claim_id ?? run.phase_loop_claim_id ?? root.runtime_claim_id ?? root.phase_loop_claim_id;
  const executed = run.reported_executed_count ?? run.executed_count ?? root.reported_executed_count ?? root.executed_count;
  return {
    claim_id: runtimeClaimId,
    status: run.payload_status ?? run.status ?? root.payload_status ?? root.status,
    executed_count: executed,
    exact: runtimeClaimId === asObject(claim).claim_id
      && (run.payload_status ?? run.status ?? root.payload_status ?? root.status) === 'task_executed'
      && Number.isInteger(executed)
      && executed >= 1
  };
}

function gitTaskSpecBinding(repoRoot, headOid) {
  if (!isSha(headOid)) return null;
  let message;
  try {
    message = git(repoRoot, ['show', '-s', '--format=%B', headOid]);
  } catch {
    return null;
  }
  const todo = message.match(/^Brownie-Task-Todo:\s*([^\s]+)\s*$/mi)?.[1] ?? '';
  const selectedTodoSha256 = message.match(/^Brownie-Task-Spec-SHA256:\s*([a-f0-9]{64})\s*$/mi)?.[1] ?? '';
  if (!todo || !/^[a-f0-9]{64}$/i.test(selectedTodoSha256)) return null;
  return {
    kind: 'commit_trailer',
    todo_id: todo,
    selected_todo_sha256: selectedTodoSha256.toLowerCase(),
    head_oid: headOid
  };
}

function gitTodoSnapshotBinding(repoRoot, mergeCommitOid, selectedTodo, todoId, todoSha, headOid) {
  try {
    const snapshot = git(repoRoot, ['show', `${mergeCommitOid}:.brownie/todo.md`]);
    if (!todoBlocks(snapshot).some((block) => block === String(selectedTodo).trimEnd())) return null;
    return {
      kind: 'merge_todo_snapshot',
      todo_id: todoId,
      selected_todo_sha256: todoSha,
      head_oid: headOid,
      todo_snapshot_commit_oid: mergeCommitOid,
      todo_snapshot_path: '.brownie/todo.md'
    };
  } catch {
    return null;
  }
}

function scopeMatchesCandidate({ mergePaths, scopes, binding }) {
  const expectedPaths = scopes.slice().sort();
  if (binding.kind === 'commit_trailer') {
    return mergePaths.length === expectedPaths.length && mergePaths.every((entry, index) => entry === expectedPaths[index]);
  }
  // A task snapshot fallback proves the exact pending contract at the merge,
  // while allowing an implementation PR to change a non-empty subset of its
  // explicitly permitted paths. It must never introduce an out-of-scope path.
  return mergePaths.length > 0 && mergePaths.every((entry) => expectedPaths.includes(entry));
}

/**
 * Find a reviewed-delivery *candidate* for a pending TODO without treating it
 * as delivery evidence. This narrow pre-claim check only permits a fresh
 * attempt past a stale terminal retry record when Git proves that the exact
 * selected task was merged, its merge changed exactly the bounded scope, and
 * those targets are still clean at HEAD. Runtime execution, independent
 * review/CI evidence, verification, and queue consumption remain mandatory.
 */
export function findCleanMergedDeliveryCandidate({ repoRoot, selectedTodo }) {
  const candidateClaim = { selected_todo: String(selectedTodo ?? '') };
  const todoId = selectedTodoId(candidateClaim);
  const todoSha = selectedTodoSha256(candidateClaim);
  const scopes = mergedDeliveryScope(candidateClaim);
  if (!todoId || scopes.length === 0) {
    return { valid: false, reason: 'merged_delivery_candidate_contract_invalid' };
  }

  let merges;
  try {
    merges = git(repoRoot, ['rev-list', '--merges', 'HEAD']).split('\n').filter(Boolean);
  } catch {
    return { valid: false, reason: 'merged_delivery_candidate_history_unavailable' };
  }
  if (merges.length === 0) return { valid: false, reason: 'merged_delivery_candidate_not_found' };

  let matchedTaskSpec = false;
  let rejectedReason = null;
  for (const mergeCommitOid of merges) {
    let parents;
    try {
      parents = git(repoRoot, ['rev-list', '--parents', '-n', '1', mergeCommitOid]).split(/\s+/).filter(Boolean);
    } catch {
      return { valid: false, reason: 'merged_delivery_candidate_history_unavailable' };
    }
    if (parents.length !== 3) continue;
    const [, firstParentOid, headOid] = parents;
    const directBinding = gitTaskSpecBinding(repoRoot, headOid);
    const taskSpecBinding = directBinding
      && directBinding.todo_id === todoId
      && directBinding.selected_todo_sha256 === todoSha
      ? directBinding
      : gitTodoSnapshotBinding(repoRoot, mergeCommitOid, selectedTodo, todoId, todoSha, headOid);
    if (!taskSpecBinding) continue;
    matchedTaskSpec = true;

    let mergePaths;
    try {
      mergePaths = git(repoRoot, ['diff', '--name-only', firstParentOid, mergeCommitOid, '--'])
        .split('\n').filter(Boolean).sort();
    } catch {
      return { valid: false, reason: 'merged_delivery_candidate_history_unavailable' };
    }
    if (!scopeMatchesCandidate({ mergePaths, scopes, binding: taskSpecBinding })) {
      rejectedReason = 'merged_delivery_candidate_scope_mismatch';
      continue;
    }

    const targets = [];
    try {
      for (const scope of scopes) {
        const mergeBlob = git(repoRoot, ['rev-parse', `${mergeCommitOid}:${scope}`]);
        const headBlob = git(repoRoot, ['rev-parse', `HEAD:${scope}`]);
        childProcess.execFileSync('git', ['diff', '--quiet', 'HEAD', '--', scope], { cwd: repoRoot });
        const untracked = git(repoRoot, ['ls-files', '--others', '--exclude-standard', '--', scope]);
        if (mergeBlob !== headBlob || untracked) throw new Error('target differs from merged clean state');
        targets.push({ path: scope, sha256: sha256(fs.readFileSync(path.join(repoRoot, scope))) });
      }
    } catch {
      rejectedReason = 'merged_delivery_candidate_target_not_clean';
      continue;
    }
    return {
      valid: true,
      candidate: {
        merge_commit_oid: mergeCommitOid,
        first_parent_oid: firstParentOid,
        head_oid: headOid,
        selected_todo_id: todoId,
        selected_todo_sha256: todoSha,
        task_spec_binding: taskSpecBinding,
        targets
      }
    };
  }
  return { valid: false, reason: rejectedReason ?? (matchedTaskSpec ? 'merged_delivery_candidate_target_not_clean' : 'merged_delivery_candidate_not_found') };
}

function verificationCommands(claim) {
  const line = lineValue(asObject(claim).selected_todo, 'Verification');
  return [...line.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]).filter(Boolean);
}

function safeVerificationArgs(command) {
  const args = String(command).trim().split(/\s+/).filter(Boolean);
  if (
    args.length >= 3
    && args[0] === 'node'
    && (args[1] === '--test' || args[1] === '--check')
    && args.slice(2).every((entry) => /^[A-Za-z0-9_./:-]+$/.test(entry))
  ) return args;
  if (
    args.length === 3
    && args[0] === 'pnpm'
    && args[1] === '--workspace-root'
    && /^[A-Za-z0-9:_-]+$/.test(args[2])
  ) return args;
  return null;
}

function normalizeReview(value) {
  const review = asObject(value);
  return {
    pr_url: review.pr_url ?? review.url ?? null,
    pr_number: review.pr_number ?? review.number ?? null,
    state: review.state ?? null,
    merge_commit_oid: review.merge_commit_oid ?? review.mergeCommit?.oid ?? null,
    head_oid: review.head_oid ?? review.headRefOid ?? null,
    author: review.author?.login ?? review.author ?? null,
    reviewer: review.reviewer ?? null,
    merge_actor: review.merge_actor ?? review.mergedBy?.login ?? null,
    merged_at: review.merged_at ?? review.mergedAt ?? null,
    observed_at: review.observed_at ?? null,
    approved: review.approved === true,
    ci_passed: review.ci_passed === true,
    latest_reviewer_review_state: review.latest_reviewer_review_state ?? null,
    latest_reviewer_review_commit_oid: review.latest_reviewer_review_commit_oid ?? null,
    title: typeof review.title === 'string' ? review.title : '',
    body: typeof review.body === 'string' ? review.body : ''
  };
}

function reviewDeclaresTask(review, todoId) {
  const key = taskFamilyKey(todoId);
  if (!key) return null;
  const [, number, suffix] = key.match(/^[A-Za-z]+-(\d+)([A-Za-z]+)/u) ?? [];
  if (!number || !suffix) return null;
  const prefix = key.slice(0, key.indexOf('-'));
  const matcher = new RegExp(`\\b${prefix}[-_ ]?${number}${suffix}\\b`, 'iu');
  return matcher.test(`${review.title}\n${review.body}`) ? key : null;
}

/**
 * Reverify an already-merged implementation without treating a runtime
 * `task_executed` envelope, a run id, or a green PR as completion.  This is
 * intentionally a second, narrow terminal receipt: it proves that the exact
 * selected target is clean at HEAD and came from the reviewed merge, then
 * reruns the selected TODO's bounded verification commands.
 */
export function verifyMergedDeliveryReverification({ repoRoot, claim, stdoutPayload, review, reviewer, implementation }) {
  const deliveryClaim = asObject(claim);
  const normalizedReview = normalizeReview(review);
  const scopes = mergedDeliveryScope(deliveryClaim);
  const errors = [];
  const runtime = runtimeTaskExecution(deliveryClaim, stdoutPayload);
  if (!deliveryClaim.claim_id || !rootClaimId(deliveryClaim)) errors.push('merged_delivery_claim_identity_missing');
  if (!deliveryClaim.selected_todo_id || deliveryClaim.selected_todo_sha256 !== selectedTodoSha256(deliveryClaim)) {
    errors.push('merged_delivery_selected_todo_identity_mismatch');
  }
  if (!deliveryClaim.queue_fingerprint || !Number.isInteger(deliveryClaim.queue_generation)) {
    errors.push('merged_delivery_queue_identity_missing');
  }
  if (scopes.length === 0) errors.push('merged_delivery_bounded_scope_missing');
  if (!runtime.exact) errors.push('merged_delivery_runtime_execution_binding_missing');
  if (normalizedReview.state !== 'MERGED') errors.push('merged_delivery_pr_not_merged');
  if (!isSha(normalizedReview.merge_commit_oid) || !isSha(normalizedReview.head_oid)) errors.push('merged_delivery_git_identity_missing');
  if (normalizedReview.author !== implementation) errors.push('merged_delivery_implementation_author_mismatch');
  if (normalizedReview.reviewer !== reviewer || normalizedReview.merge_actor !== reviewer || reviewer === implementation) {
    errors.push('merged_delivery_independent_review_missing');
  }
  if (!normalizedReview.approved || !normalizedReview.ci_passed || !normalizedReview.pr_url || !normalizedReview.merged_at || !normalizedReview.observed_at) {
    errors.push('merged_delivery_review_or_ci_evidence_missing');
  }
  if (
    normalizedReview.latest_reviewer_review_state !== 'APPROVED'
    || normalizedReview.latest_reviewer_review_commit_oid !== normalizedReview.head_oid
  ) {
    errors.push('merged_delivery_latest_reviewer_approval_missing');
  }
  const commands = verificationCommands(deliveryClaim);
  if (commands.length === 0 || commands.some((command) => !safeVerificationArgs(command))) {
    errors.push('merged_delivery_verification_contract_invalid');
  }
  if (errors.length > 0) return { valid: false, reason: 'merged_delivery_reverification_refused', errors };

  let parents;
  try {
    parents = git(repoRoot, ['rev-list', '--parents', '-n', '1', normalizedReview.merge_commit_oid]).split(/\s+/).filter(Boolean);
  } catch {
    return { valid: false, reason: 'merged_delivery_reverification_refused', errors: ['merged_delivery_merge_history_unavailable'] };
  }
  if (parents.length !== 3 || parents[2] !== normalizedReview.head_oid) {
    return { valid: false, reason: 'merged_delivery_reverification_refused', errors: ['merged_delivery_merge_parent_binding_mismatch'] };
  }
  const directBinding = gitTaskSpecBinding(repoRoot, normalizedReview.head_oid);
  const taskSpecBinding = directBinding
    && directBinding.todo_id === deliveryClaim.selected_todo_id
    && directBinding.selected_todo_sha256 === selectedTodoSha256(deliveryClaim)
    ? directBinding
    : gitTodoSnapshotBinding(
      repoRoot,
      normalizedReview.merge_commit_oid,
      deliveryClaim.selected_todo,
      deliveryClaim.selected_todo_id,
      selectedTodoSha256(deliveryClaim),
      normalizedReview.head_oid
    );
  if (
    !taskSpecBinding
    || taskSpecBinding.todo_id !== deliveryClaim.selected_todo_id
    || taskSpecBinding.selected_todo_sha256 !== selectedTodoSha256(deliveryClaim)
  ) {
    return { valid: false, reason: 'merged_delivery_reverification_refused', errors: ['merged_delivery_task_spec_binding_missing_or_mismatch'] };
  }
  const firstParent = parents[1];
  const mergePaths = git(repoRoot, ['diff', '--name-only', firstParent, normalizedReview.merge_commit_oid, '--']).split('\n').filter(Boolean).sort();
  if (!scopeMatchesCandidate({ mergePaths, scopes, binding: taskSpecBinding })) {
    return { valid: false, reason: 'merged_delivery_reverification_refused', errors: ['merged_delivery_merge_scope_mismatch'] };
  }
  const reviewTaskDeclaration = taskSpecBinding.kind === 'merge_todo_snapshot'
    ? reviewDeclaresTask(normalizedReview, deliveryClaim.selected_todo_id)
    : null;
  if (taskSpecBinding.kind === 'merge_todo_snapshot' && !reviewTaskDeclaration) {
    return { valid: false, reason: 'merged_delivery_reverification_refused', errors: ['merged_delivery_review_task_binding_missing'] };
  }

  const targets = [];
  for (const scope of scopes) {
    try {
      const mergeBlob = git(repoRoot, ['rev-parse', `${normalizedReview.merge_commit_oid}:${scope}`]);
      const headBlob = git(repoRoot, ['rev-parse', `HEAD:${scope}`]);
      childProcess.execFileSync('git', ['diff', '--quiet', 'HEAD', '--', scope], { cwd: repoRoot });
      const untracked = git(repoRoot, ['ls-files', '--others', '--exclude-standard', '--', scope]);
      if (mergeBlob !== headBlob || untracked) throw new Error('target differs from merged clean state');
      targets.push({ path: scope, sha256: sha256(fs.readFileSync(path.join(repoRoot, scope))) });
    } catch {
      return { valid: false, reason: 'merged_delivery_reverification_refused', errors: ['merged_delivery_target_not_clean_at_reviewed_merge'] };
    }
  }

  const verification_results = [];
  for (const command of commands) {
    const args = safeVerificationArgs(command);
    try {
      childProcess.execFileSync(args[0], args.slice(1), { cwd: repoRoot, stdio: 'pipe', timeout: 180000 });
      verification_results.push({ command, exit_code: 0 });
    } catch (error) {
      verification_results.push({ command, exit_code: Number.isInteger(error.status) ? error.status : 1 });
      return { valid: false, reason: 'merged_delivery_reverification_refused', errors: ['merged_delivery_verification_failed'], verification_results };
    }
  }
  const evidenceReview = {
    ...normalizedReview,
    title: undefined,
    body: undefined,
    task_declaration_key: reviewTaskDeclaration,
    task_declaration_sha256: reviewTaskDeclaration ? sha256(`${normalizedReview.title}\n${normalizedReview.body}`) : null
  };
  const evidence = {
    schema_version: 1,
    kind: 'phase_loop_merged_delivery_reverification',
    claim_id: deliveryClaim.claim_id,
    root_claim_id: rootClaimId(deliveryClaim),
    selected_todo_id: deliveryClaim.selected_todo_id,
    selected_todo_sha256: selectedTodoSha256(deliveryClaim),
    completion_condition_sha256: completionConditionSha256(deliveryClaim),
    queue_fingerprint: deliveryClaim.queue_fingerprint,
    queue_generation: deliveryClaim.queue_generation,
    runtime: runtime,
    git: { merge_commit_oid: normalizedReview.merge_commit_oid, first_parent_oid: firstParent, head_oid: normalizedReview.head_oid, targets },
    task_spec_binding: taskSpecBinding,
    review: evidenceReview,
    verification_results
  };
  return { valid: true, evidence };
}

export function validateMergedDeliveryReverification({ claim, evidence }) {
  const proof = asObject(evidence);
  const expected = asObject(claim);
  const errors = [];
  if (proof.schema_version !== 1 || proof.kind !== 'phase_loop_merged_delivery_reverification') errors.push('merged_delivery_evidence_schema_invalid');
  for (const [key, value] of Object.entries({
    claim_id: expected.claim_id,
    root_claim_id: rootClaimId(expected),
    selected_todo_id: expected.selected_todo_id,
    selected_todo_sha256: selectedTodoSha256(expected),
    completion_condition_sha256: completionConditionSha256(expected),
    queue_fingerprint: expected.queue_fingerprint,
    queue_generation: expected.queue_generation
  })) {
    if (proof[key] !== value) errors.push(`merged_delivery_evidence_${key}_mismatch`);
  }
  const runtime = asObject(proof.runtime);
  if (runtime.claim_id !== expected.claim_id || runtime.status !== 'task_executed' || !Number.isInteger(runtime.executed_count) || runtime.executed_count < 1) {
    errors.push('merged_delivery_evidence_runtime_binding_invalid');
  }
  const scopes = mergedDeliveryScope(expected);
  const targets = asArray(asObject(proof.git).targets);
  const gitProof = asObject(proof.git);
  if (!isSha(gitProof.merge_commit_oid) || !isSha(gitProof.first_parent_oid) || !isSha(gitProof.head_oid)) {
    errors.push('merged_delivery_evidence_git_identity_invalid');
  }
  if (scopes.length === 0 || targets.length !== scopes.length || targets.some((target, index) => asObject(target).path !== scopes[index] || !/^[a-f0-9]{64}$/.test(asObject(target).sha256 ?? ''))) {
    errors.push('merged_delivery_evidence_target_binding_invalid');
  }
  const review = asObject(proof.review);
  if (gitProof.merge_commit_oid !== review.merge_commit_oid || gitProof.head_oid !== review.head_oid) {
    errors.push('merged_delivery_evidence_review_git_mismatch');
  }
  if (review.state !== 'MERGED' || !review.approved || !review.ci_passed || !review.pr_url || !review.author || !review.reviewer || !review.merged_at || !review.observed_at || review.author === review.reviewer || review.merge_actor !== review.reviewer) {
    errors.push('merged_delivery_evidence_review_binding_invalid');
  }
  if (review.latest_reviewer_review_state !== 'APPROVED' || review.latest_reviewer_review_commit_oid !== gitProof.head_oid) {
    errors.push('merged_delivery_evidence_latest_reviewer_approval_invalid');
  }
  const taskSpecBinding = asObject(proof.task_spec_binding);
  if (
    !['commit_trailer', 'merge_todo_snapshot'].includes(taskSpecBinding.kind)
    || taskSpecBinding.todo_id !== expected.selected_todo_id
    || taskSpecBinding.selected_todo_sha256 !== selectedTodoSha256(expected)
    || taskSpecBinding.head_oid !== gitProof.head_oid
  ) {
    errors.push('merged_delivery_evidence_task_spec_binding_invalid');
  }
  if (taskSpecBinding.kind === 'merge_todo_snapshot') {
    if (taskSpecBinding.todo_snapshot_commit_oid !== gitProof.merge_commit_oid || taskSpecBinding.todo_snapshot_path !== '.brownie/todo.md') {
      errors.push('merged_delivery_evidence_task_snapshot_binding_invalid');
    }
    if (review.task_declaration_key !== taskFamilyKey(expected.selected_todo_id) || !/^[a-f0-9]{64}$/.test(review.task_declaration_sha256 ?? '')) {
      errors.push('merged_delivery_evidence_review_task_binding_invalid');
    }
  }
  const results = asArray(proof.verification_results);
  if (results.length === 0 || results.some((result) => !asObject(result).command || asObject(result).exit_code !== 0)) {
    errors.push('merged_delivery_evidence_verification_missing_or_failed');
  }
  return { valid: errors.length === 0, errors };
}

export function applyMergedDeliveryReverification({ claim, evidence, issuedAt = new Date().toISOString() }) {
  const validated = validateMergedDeliveryReverification({ claim, evidence });
  if (!validated.valid) return { valid: false, claim: null, errors: validated.errors };
  const proof = asObject(evidence);
  const review = asObject(proof.review);
  const next = {
    ...asObject(claim),
    status: 'completed',
    delivery_review: {
      pr_url: review.pr_url,
      pr_number: review.pr_number,
      head_oid: review.head_oid,
      merged_at: review.merged_at,
      observed_at: review.observed_at,
      merged: true,
      approved: true,
      ci_passed: true,
      author: review.author,
      reviewer: review.reviewer,
      merge_actor: review.merge_actor,
      merged_delivery_reverification: proof
    },
    merged_delivery_reverification: proof,
    updated_at: issuedAt
  };
  const certificate = createCompletionCertificate({ claim: next, review: next.delivery_review, issuedAt });
  if (!certificate.valid) return { valid: false, claim: null, errors: certificate.errors };
  next.completion_certificate = certificate.certificate;
  next.status_history = [...asArray(next.status_history), {
    status: 'completed',
    updated_at: issuedAt,
    note: 'merged_delivery_reverified_before_queue_consumption'
  }];
  return { valid: true, claim: next, errors: [] };
}

/**
 * The runtime deliberately does not know an owner's controller claim.  The
 * controller therefore binds the already-executed, selected-TODO verification
 * result to the runtime's terminal payload before publishing a review handoff.
 * This is a producer, not a synthetic success: it refuses anything that did
 * not report `completed:true` and at least one successful executed command.
 */
export function produceSemanticCompletionEvidence({ claim, stdoutPayload, verification }) {
  const verificationPayload = asObject(verification);
  if (verificationPayload.completed !== true) return null;
  const verificationResults = asArray(verificationPayload.results)
    .map((result) => asObject(result))
    .filter((result) => typeof result.command === 'string' && result.command && result.exit_code === 0)
    .map((result) => ({ command: result.command, exit_code: result.exit_code }));
  if (verificationResults.length === 0) return null;

  const runtime = runDeliveryView(stdoutPayload);
  const payload = asObject(stdoutPayload);
  const run = asObject(payload.run);
  const terminalCompletionEvidence = run.terminal_completion_evidence
    ?? payload.terminal_completion_evidence
    ?? null;
  // A successful process envelope is intentionally insufficient.  Preserve
  // the concrete terminal fact in the receipt so a later review reconcile
  // cannot turn a patch/CI result into a synthetic completed run.
  if (
    runtime.completed !== true
    || runtime.continuation_required === true
    || runtime.terminal_completion_evidence_missing === true
    || runtime.trajectory_failed === true
    || !hasTerminalCompletionEvidence(terminalCompletionEvidence)
  ) {
    return null;
  }
  const terminalPayload = {
    completed: runtime.completed,
    continuation_required: runtime.continuation_required,
    terminal_completion_evidence: terminalCompletionEvidence,
    stop_reason: run.stop_reason ?? payload.stop_reason ?? null,
    execution_outcome: run.execution_outcome ?? payload.execution_outcome ?? null
  };
  return {
    schema_version: 1,
    root_claim_id: rootClaimId(claim),
    selected_todo_sha256: selectedTodoSha256(claim),
    completion_condition_sha256: completionConditionSha256(claim),
    verification_results: verificationResults,
    terminal: {
      completed: true,
      continuation_required: false,
      trajectory_failed: false,
      terminal_completion_evidence: terminalCompletionEvidence,
      terminal_completion_evidence_sha256: terminalCompletionEvidenceSha256(terminalCompletionEvidence)
    },
    observables: [
      { kind: 'controller_verification_result', sha256: sha256(canonicalJson(verificationPayload)) },
      { kind: 'runtime_terminal_payload', sha256: sha256(canonicalJson(terminalPayload)) }
    ]
  };
}

/**
 * The evidence contract binds a semantic verification result to the immutable
 * claim.  Passing CI or changing a listed target alone is deliberately not
 * evidence: both can be unrelated to the requested completion condition.
 */
export function validateSemanticCompletionEvidence({ claim, evidence }) {
  const proof = asObject(evidence);
  const expectedClaimId = rootClaimId(claim);
  const expectedTodoHash = selectedTodoSha256(claim);
  const expectedConditionHash = completionConditionSha256(claim);
  const errors = [];
  if (proof.schema_version !== 1) errors.push('semantic_evidence_schema_invalid');
  if (!expectedClaimId || proof.root_claim_id !== expectedClaimId) errors.push('semantic_evidence_root_claim_mismatch');
  if (proof.selected_todo_sha256 !== expectedTodoHash) errors.push('semantic_evidence_todo_mismatch');
  if (proof.completion_condition_sha256 !== expectedConditionHash) errors.push('semantic_evidence_completion_condition_mismatch');
  const verifications = asArray(proof.verification_results);
  if (verifications.length === 0 || verifications.some((result) => asObject(result).exit_code !== 0 || !asObject(result).command)) {
    errors.push('semantic_evidence_verification_missing_or_failed');
  }
  const observables = asArray(proof.observables);
  if (observables.length === 0 || observables.some((observable) => !asObject(observable).kind || !asObject(observable).sha256)) {
    errors.push('semantic_evidence_observable_missing');
  }
  const terminal = asObject(proof.terminal);
  if (!hasTerminalCompletionEvidence(terminal.terminal_completion_evidence)) {
    errors.push('semantic_evidence_terminal_missing');
  } else {
    if (terminal.completed !== true) errors.push('semantic_evidence_terminal_not_completed');
    if (terminal.continuation_required !== false) errors.push('semantic_evidence_terminal_continuation_required');
    if (terminal.trajectory_failed !== false) errors.push('semantic_evidence_terminal_trajectory_failed');
    if (terminal.terminal_completion_evidence_sha256 !== terminalCompletionEvidenceSha256(terminal.terminal_completion_evidence)) {
      errors.push('semantic_evidence_terminal_evidence_hash_mismatch');
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Completion is a durable delivery assertion, not a shorthand for a green
 * process, a pushed patch, or a CI result.  Keep the review/merge receipt in
 * one reusable validator so the current claim and the durable completion
 * record cannot drift into different definitions of "done".
 */
export function validateTerminalDeliveryReceipt({ claim, review = undefined }) {
  const deliveryClaim = asObject(claim);
  const reviewState = asObject(review === undefined ? deliveryClaim.delivery_review : review);
  const errors = [];
  if (deliveryClaim.status !== 'completed') errors.push('completion_claim_not_completed');
  if (reviewState.merged !== true) errors.push('completed_requires_merged_pr');
  if (reviewState.approved !== true) errors.push('completed_requires_independent_approval');
  if (reviewState.ci_passed !== true) errors.push('completed_requires_passing_ci');
  if (typeof reviewState.author !== 'string' || !reviewState.author) errors.push('completed_requires_implementation_author');
  if (typeof reviewState.reviewer !== 'string' || !reviewState.reviewer) errors.push('completed_requires_independent_reviewer');
  if (reviewState.author === reviewState.reviewer) errors.push('completed_requires_distinct_reviewer');
  if (typeof reviewState.merge_actor !== 'string' || reviewState.merge_actor !== reviewState.reviewer) {
    errors.push('completed_requires_observed_reviewer_merge_actor');
  }
  const mergedDelivery = asObject(reviewState.merged_delivery_reverification);
  if (Object.keys(mergedDelivery).length > 0) {
    const evidence = validateMergedDeliveryReverification({ claim: deliveryClaim, evidence: mergedDelivery });
    if (!evidence.valid) errors.push(...evidence.errors.map((error) => `completed_requires_${error}`));
  } else {
    const semanticEvidence = validateSemanticCompletionEvidence({
      claim: deliveryClaim,
      evidence: reviewState.semantic_completion_evidence
    });
    if (!semanticEvidence.valid) {
      errors.push(...semanticEvidence.errors.map((error) => `completed_requires_${error}`));
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * A completion certificate is the controller's immutable, claim-bound record
 * of a terminal delivery receipt.  It deliberately contains only observed
 * facts: a process exit, patch, PR creation, or green CI cannot mint one.
 *
 * Keeping this separate from `delivery_review` lets a later PR head or a
 * CHANGES_REQUESTED review invalidate an old receipt without erasing the
 * causal history that explains why the claim returned to rework.
 */
export function createCompletionCertificate({ claim, review = undefined, issuedAt = new Date().toISOString() }) {
  const deliveryClaim = asObject(claim);
  const reviewState = asObject(review === undefined ? deliveryClaim.delivery_review : review);
  const receipt = validateTerminalDeliveryReceipt({
    claim: { ...deliveryClaim, status: 'completed', delivery_review: reviewState },
    review: reviewState
  });
  if (!receipt.valid) return { valid: false, certificate: null, errors: receipt.errors };

  return {
    valid: true,
    errors: [],
    certificate: {
      schema_version: 1,
      root_claim_id: rootClaimId(deliveryClaim),
      selected_todo_sha256: selectedTodoSha256(deliveryClaim),
      completion_condition_sha256: completionConditionSha256(deliveryClaim),
      semantic_completion_evidence_sha256: semanticCompletionEvidenceSha256(
        reviewState.merged_delivery_reverification ?? reviewState.semantic_completion_evidence
      ),
      review: {
        pr_url: reviewState.pr_url ?? null,
        pr_number: reviewState.pr_number ?? null,
        head_oid: reviewState.head_oid ?? null,
        author: reviewState.author ?? null,
        reviewer: reviewState.reviewer ?? null,
        merge_actor: reviewState.merge_actor ?? null,
        merged_at: reviewState.merged_at ?? null,
        observed_at: reviewState.observed_at ?? null
      },
      issued_at: issuedAt
    }
  };
}

/**
 * Validate the immutable completion certificate against the live claim.  A
 * certificate must bind exactly the same PR head, review actors, semantic
 * proof, and claim identity.  This prevents a later patch/review cycle from
 * inheriting a receipt that was valid only for an earlier head.
 */
export function validateCompletionCertificate({ claim, certificate = undefined, review = undefined }) {
  const deliveryClaim = asObject(claim);
  const proof = asObject(certificate === undefined ? deliveryClaim.completion_certificate : certificate);
  const reviewState = asObject(review === undefined ? deliveryClaim.delivery_review : review);
  const errors = [];
  if (proof.schema_version !== 1) errors.push('completion_certificate_schema_invalid');
  if (!rootClaimId(deliveryClaim) || proof.root_claim_id !== rootClaimId(deliveryClaim)) {
    errors.push('completion_certificate_root_claim_mismatch');
  }
  if (proof.selected_todo_sha256 !== selectedTodoSha256(deliveryClaim)) {
    errors.push('completion_certificate_todo_mismatch');
  }
  if (proof.completion_condition_sha256 !== completionConditionSha256(deliveryClaim)) {
    errors.push('completion_certificate_completion_condition_mismatch');
  }
  if (proof.semantic_completion_evidence_sha256 !== semanticCompletionEvidenceSha256(
    reviewState.merged_delivery_reverification ?? reviewState.semantic_completion_evidence
  )) {
    errors.push('completion_certificate_semantic_evidence_mismatch');
  }
  const certificateReview = asObject(proof.review);
  for (const field of ['pr_url', 'pr_number', 'head_oid', 'author', 'reviewer', 'merge_actor', 'merged_at', 'observed_at']) {
    if (certificateReview[field] !== (reviewState[field] ?? null)) {
      errors.push(`completion_certificate_review_${field}_mismatch`);
    }
  }
  if (typeof proof.issued_at !== 'string' || !proof.issued_at) errors.push('completion_certificate_issued_at_missing');
  const reviewRework = asObject(deliveryClaim.review_rework);
  if (reviewRework.required === true && reviewRework.state === 'CHANGES_REQUESTED') {
    errors.push('completion_certificate_invalidated_by_changes_requested');
  }
  const receipt = validateTerminalDeliveryReceipt({
    claim: { ...deliveryClaim, status: 'completed', delivery_review: reviewState },
    review: reviewState
  });
  if (!receipt.valid) errors.push(...receipt.errors.map((error) => `completion_certificate_requires_${error}`));
  return { valid: errors.length === 0, errors };
}

/**
 * Evaluate only what can be safely inferred from a run.  "allowed" here
 * means an implementation can be handed to review, never that the TODO is
 * done.  Final completion needs a merged, independently approved PR.
 */
export function evaluateDeliveryHandoff({ claim, stdoutPayload, semanticCompletionEvidence = null }) {
  const run = runDeliveryView(stdoutPayload);
  const reasons = [];
  if (run.trajectory_failed) reasons.push('trajectory_failed');
  if (run.continuation_required) reasons.push('continuation_required');
  if (run.terminal_completion_evidence_missing) reasons.push('terminal_completion_evidence_missing');
  if (!run.completed) reasons.push('run_not_completed');

  if (reasons.length > 0) {
    return {
      schema_version: 1,
      process_ok: run.process_ok,
      delivery_state: run.trajectory_failed ? 'failed' : 'nonterminal',
      terminal: false,
      pr_handoff_allowed: false,
      completion_allowed: false,
      root_claim_id: rootClaimId(claim),
      selected_todo_sha256: selectedTodoSha256(claim),
      reasons
    };
  }

  const suppliedEvidence = semanticCompletionEvidence ?? run.semantic_completion_evidence;
  const evidence = validateSemanticCompletionEvidence({ claim, evidence: suppliedEvidence });
  if (!evidence.valid) {
    return {
      schema_version: 1,
      process_ok: run.process_ok,
      delivery_state: 'integrity_blocked',
      terminal: false,
      pr_handoff_allowed: false,
      completion_allowed: false,
      root_claim_id: rootClaimId(claim),
      selected_todo_sha256: selectedTodoSha256(claim),
      reasons: evidence.errors
    };
  }
  return {
    schema_version: 1,
    process_ok: run.process_ok,
    delivery_state: 'verification_passed',
    terminal: false,
    pr_handoff_allowed: true,
    completion_allowed: false,
    root_claim_id: rootClaimId(claim),
    selected_todo_sha256: selectedTodoSha256(claim),
    semantic_completion_evidence: suppliedEvidence,
    reasons: []
  };
}

/**
 * Claims are append-only causally.  Retry/review transitions must retain the
 * same root claim and immutable TODO fingerprint; only a merged review can
 * enter completed.
 */
export function validateClaimLifecycleTransition({ previous, next, review = {} }) {
  const before = asObject(previous);
  const after = asObject(next);
  const errors = [];
  if (rootClaimId(before) && rootClaimId(after) && rootClaimId(before) !== rootClaimId(after)) errors.push('root_claim_id_changed');
  if (before.selected_todo && after.selected_todo && selectedTodoSha256(before) !== selectedTodoSha256(after)) errors.push('selected_todo_fingerprint_changed');
  if (after.status === 'completed') {
    const terminalReceipt = validateTerminalDeliveryReceipt({ claim: after, review });
    errors.push(...terminalReceipt.errors.filter((error) => error !== 'completion_claim_not_completed'));
    const certificate = validateCompletionCertificate({ claim: after, review });
    errors.push(...certificate.errors);
  }
  if (after.status === 'pr_pending_review' && asObject(review).handoff_allowed !== true) {
    errors.push('pr_pending_review_requires_delivery_handoff');
  }
  return { valid: errors.length === 0, errors };
}

function usage() {
  process.stderr.write('usage: phase-loop-delivery-integrity.mjs evaluate --claim <claim.json> --stdout <run.stdout.json> [--verification <verification.json>]\n');
  process.stderr.write('   or: phase-loop-delivery-integrity.mjs validate-certificate --claim <claim.json> [--require-completed]\n');
  process.stderr.write('   or: phase-loop-delivery-integrity.mjs verify-merged-delivery --repo <repo> --claim <claim.json> --stdout <run.stdout.json> --review <review.json> --reviewer <login> --implementation <login> [--write]\n');
  process.stderr.write('   or: printf %s <selected-todo> | phase-loop-delivery-integrity.mjs find-clean-merged-delivery --repo <repo>\n');
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    if (argv[index] === '--require-completed' || argv[index] === '--write') {
      args.set(argv[index], true);
    } else {
      args.set(argv[index], argv[++index]);
    }
  }
  return args;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command] = process.argv.slice(2);
  const args = parseArgs(process.argv.slice(3));
  if (
    !['evaluate', 'validate-certificate', 'verify-merged-delivery', 'find-clean-merged-delivery'].includes(command)
    || (command !== 'find-clean-merged-delivery' && !args.get('--claim'))
    || (command === 'evaluate' && !args.get('--stdout'))
    || (command === 'verify-merged-delivery' && (!args.get('--stdout') || !args.get('--repo') || !args.get('--review') || !args.get('--reviewer') || !args.get('--implementation')))
    || (command === 'find-clean-merged-delivery' && !args.get('--repo'))
  ) {
    usage();
    process.exit(64);
  }
  try {
    if (command === 'find-clean-merged-delivery') {
      const result = findCleanMergedDeliveryCandidate({
        repoRoot: path.resolve(args.get('--repo')),
        selectedTodo: fs.readFileSync(0, 'utf8')
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exit(result.valid ? 0 : 76);
    }
    const claim = readJson(args.get('--claim'));
    if (command === 'validate-certificate') {
      const result = validateCompletionCertificate({ claim });
      if (args.has('--require-completed') && asObject(claim).status !== 'completed') {
        result.valid = false;
        result.errors.push('completion_certificate_claim_not_completed');
      }
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exit(result.valid ? 0 : 76);
    }
    if (command === 'verify-merged-delivery') {
      const stdoutPayload = readJson(args.get('--stdout'));
      const review = readJson(args.get('--review'));
      const result = verifyMergedDeliveryReverification({
        repoRoot: path.resolve(args.get('--repo')),
        claim,
        stdoutPayload,
        review,
        reviewer: args.get('--reviewer'),
        implementation: args.get('--implementation')
      });
      if (!result.valid) {
        process.stdout.write(`${JSON.stringify(result)}\n`);
        process.exit(76);
      }
      const applied = applyMergedDeliveryReverification({ claim, evidence: result.evidence });
      if (!applied.valid) {
        process.stdout.write(`${JSON.stringify({ valid: false, reason: 'merged_delivery_reverification_refused', errors: applied.errors })}\n`);
        process.exit(76);
      }
      if (args.has('--write')) {
        const destination = args.get('--claim');
        const temporary = `${destination}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, `${JSON.stringify(applied.claim, null, 2)}\n`, { mode: 0o600 });
        fs.renameSync(temporary, destination);
      }
      process.stdout.write(`${JSON.stringify({ valid: true, evidence: result.evidence })}\n`);
      process.exit(0);
    }
    const stdoutPayload = readJson(args.get('--stdout'));
    let verification = null;
    if (args.get('--verification')) verification = JSON.parse(args.get('--verification'));
    const semanticCompletionEvidence = produceSemanticCompletionEvidence({ claim, stdoutPayload, verification });
    const result = evaluateDeliveryHandoff({ claim, stdoutPayload, semanticCompletionEvidence });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(result.pr_handoff_allowed ? 0 : 76);
  } catch (error) {
    process.stderr.write(`delivery_integrity_evaluation_failed: ${error.message}\n`);
    process.exit(70);
  }
}
