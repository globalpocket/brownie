#!/usr/bin/env node
/**
 * Recover the one historical shape that predates durable delivery receipts:
 * a completion record erased a leaf although its PR was later rejected.
 *
 * This is deliberately an explicit, audited transaction.  It never guesses a
 * PR from a TODO; the caller supplies the exact completion record, immutable
 * pre-run snapshot, and independently observed review receipt.  Normal queue
 * selection is separately blocked while this shape exists.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  readAllTodoReplanRecords,
  readTodoCompletionInvalidationRecords,
  readTodoCompletionRecords,
  resolveTodoState,
  durableCompletionRecordReceipt
} from './phase-loop-todo-state.mjs';
import { loadPhaseLoopActorDeployment, roleActor } from './phase-loop-actor-deployment.mjs';
import { completionConditionSha256, validateTerminalDeliveryReceipt } from './phase-loop-delivery-integrity.mjs';
import {
  isTerminalTaskState,
  readTaskLedger,
  reviewReworkLedgerAttemptId,
  taskAttemptId,
  taskProjection
} from './phase-loop-task-ledger.mjs';
import { validateTodoQueueIntegrity } from './phase-loop-todo-queue-integrity.mjs';

const defaultTodo = '.brownie/todo.md';
const defaultBreakdown = '.brownie/todo-breakdown.md';
const defaultState = '.brownie/private/phase-loop';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function atomicWrite(filePath, contents, mode = 0o600) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, contents, { mode });
  fs.renameSync(temporary, filePath);
}

function atomicJson(filePath, value, mode = 0o600) {
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`, mode);
}

// Bindings and audit records are JSON values, not byte-for-byte serialized
// payloads.  Older controller versions may have written the same attested
// fields in a different key order.  Comparing JSON.stringify output would
// reject that valid historical evidence and make an otherwise resumable
// CHANGES_REQUESTED claim permanently unstartable.  Arrays remain ordered;
// object keys do not.
function canonicalJson(value) {
  if (Array.isArray(value)) return value.map((entry) => canonicalJson(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])])
    );
  }
  return value;
}

function jsonStructurallyEqual(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function todoBlocks(text) {
  const source = String(text ?? '');
  const starts = [...source.matchAll(/^(?:[-*]|\d+[.)])\s+\[[ xX]\]\s+/gmu)].map((match) => match.index);
  return starts.map((start, index) => source.slice(start, starts[index + 1] ?? source.length).trimEnd());
}

function todoId(block) {
  const firstLine = String(block ?? '').split('\n')[0]?.trim() ?? '';
  return firstLine.replace(/^(?:[-*]|\d+[.)])\s+\[[ xX]\]\s+/u, '').split(':')[0]?.trim() ?? '';
}

function lineValue(block, label) {
  const line = String(block ?? '').split('\n').map((value) => value.trim())
    .find((value) => value.startsWith(`${label}:`));
  return line ? line.slice(label.length + 1).trim().replace(/[.]$/u, '') : '';
}

function sourceTodoId(block) {
  return lineValue(block, 'Source TODO').split(':')[0]?.trim().replace(/[.,;]+$/u, '') ?? '';
}

function findBlock(text, id) {
  const matches = todoBlocks(text).filter((block) => todoId(block) === id);
  if (matches.length > 1) {
    throw new Error(`ambiguous_todo_id:${id}`);
  }
  return matches[0] ?? null;
}

function replaceCheckbox(block, checked) {
  return String(block).replace(/^(\s*(?:[-*]|\d+[.)])\s+)\[[ xX]\]/u, `$1[${checked ? 'x' : ' '}]`);
}

function insertAfterBlock(text, block, addition) {
  const index = text.indexOf(block);
  if (index < 0 || text.indexOf(block, index + block.length) >= 0) {
    throw new Error('recovery_parent_block_not_unique');
  }
  const end = index + block.length;
  return `${text.slice(0, end).replace(/\n*$/u, '')}\n\n${addition.trimEnd()}${text.slice(end)}`
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/\s*$/u, '\n');
}

function removeExactBlock(text, block) {
  const index = text.indexOf(block);
  if (index < 0 || text.indexOf(block, index + block.length) >= 0) {
    throw new Error('review_rework_independent_completion_target_not_unique');
  }
  const end = index + block.length;
  return `${text.slice(0, index).replace(/\n*$/u, '')}\n\n${text.slice(end).replace(/^\n*/u, '')}`
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/\s*$/u, '\n');
}

function reviewRejectionValid(review, expectedAuthor, expectedReviewer) {
  const latest = review?.latest_review;
  const valid = (
    review?.schema_version === 1
    && typeof review?.pr_url === 'string' && review.pr_url
    && review?.state === 'OPEN'
    && review?.author === expectedAuthor
    && typeof review?.head_sha === 'string' && /^[a-f0-9]{40}$/u.test(review.head_sha)
    && latest && latest.author === expectedReviewer
    && latest.state === 'CHANGES_REQUESTED'
    && latest.commit_id === review.head_sha
    && typeof latest.body === 'string' && latest.body.trim()
  );
  return { valid, reason: valid ? null : 'review_rejection_receipt_invalid' };
}

function verificationCommands(block) {
  return [...lineValue(block, 'Verification').matchAll(/`([^`]+)`/gu)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

// A v1 completion may be retained as historical evidence only.  This is the
// deliberately narrow upgrade path for a separate, independently reviewed
// and merged delivery: it requires the immutable claim snapshot, the active
// deployment roles, same-head approval, a reviewer merge, complete CI, and
// evidence for every concrete command in the original TODO verification line.
// It appends a v2 record instead of rewriting history.
function mergedDeliveryReceiptValid(receipt, { claimId, selected, expectedAuthor, expectedReviewer }) {
  const approval = receipt?.latest_approval;
  const semantic = receipt?.semantic_completion_evidence;
  const selectedHash = sha256(selected);
  const completionConditionHash = completionConditionSha256({ selected_todo: selected });
  const verification = Array.isArray(semantic?.verification_results)
    ? semantic.verification_results
    : [];
  const observables = Array.isArray(semantic?.observables) ? semantic.observables : [];
  const requiredCommands = verificationCommands(selected);
  const commandsCovered = requiredCommands.every((command) => verification.some((result) => (
    result?.command === command && result?.exit_code === 0
  )));
  const valid = (
    receipt?.schema_version === 1
    && typeof receipt?.pr_url === 'string' && receipt.pr_url
    && receipt?.state === 'MERGED'
    && receipt?.author === expectedAuthor
    && typeof receipt?.head_sha === 'string' && /^[a-f0-9]{40}$/u.test(receipt.head_sha)
    && typeof receipt?.merge_commit === 'string' && /^[a-f0-9]{40}$/u.test(receipt.merge_commit)
    && typeof receipt?.merged_at === 'string' && receipt.merged_at
    && receipt?.merged_by === expectedReviewer
    && approval?.author === expectedReviewer
    && approval?.state === 'APPROVED'
    && approval?.commit_id === receipt.head_sha
    && receipt?.ci?.passed === true
    && Array.isArray(receipt.ci.checks) && receipt.ci.checks.length > 0
    && receipt.ci.checks.every((check) => check?.status === 'COMPLETED' && check?.conclusion === 'SUCCESS')
    && semantic?.schema_version === 1
    && semantic.root_claim_id === claimId
    && semantic.selected_todo_sha256 === selectedHash
    && semantic.completion_condition_sha256 === completionConditionHash
    && verification.length > 0
    && verification.every((result) => result && typeof result.command === 'string' && result.command && result.exit_code === 0)
    && commandsCovered
    && observables.length > 0
    && observables.every((observable) => observable && observable.kind && typeof observable.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(observable.sha256))
  );
  return { valid, reason: valid ? null : 'merged_delivery_receipt_invalid' };
}

function legacyDependencyBlocks(repoRoot, todoText, breakdownPath) {
  const state = resolveTodoState({
    todoText,
    replanRecords: readAllTodoReplanRecords(repoRoot, { breakdownPath }),
    completionRecords: readTodoCompletionRecords(repoRoot),
    completionInvalidationRecords: readTodoCompletionInvalidationRecords(repoRoot)
  });
  const blocked = [];
  for (const block of todoBlocks(todoText)) {
    if (!/^\s*(?:[-*]|\d+[.)])\s+\[\s\]/u.test(block)) continue;
    const dependencies = lineValue(block, 'Depends on').split(',').map((value) => value.trim()).filter((value) => value && value !== '<none>');
    const unsafe = dependencies.filter((dependency) => state.unverifiedArchivedCompletionIds.has(dependency));
    if (unsafe.length > 0) {
      blocked.push({
        todo_id: todoId(block),
        dependency_todo_ids: unsafe,
        completion_records: state.unverifiedCompletionRecords.filter((record) => unsafe.includes(record.selected_todo_id))
      });
    }
  }
  return { state, blocked };
}

export function detectLegacyCompletionRecovery({ repoRoot, todoPath = defaultTodo, breakdownPath = defaultBreakdown }) {
  const root = path.resolve(repoRoot);
  const todo = readText(path.resolve(root, todoPath));
  const result = legacyDependencyBlocks(root, todo, path.resolve(root, breakdownPath));
  return {
    schema_version: 1,
    blocked: result.blocked.length > 0,
    blockers: result.blocked,
    unverified_archived_completion_ids: [...result.state.unverifiedArchivedCompletionIds].sort()
  };
}

function parseArgs(argv) {
  const args = {
    mode: argv[2] ?? 'detect',
    repo: process.cwd(),
    todo: defaultTodo,
    breakdown: defaultBreakdown,
    state: defaultState,
    actorDeployment: null
  };
  for (let index = 3; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--repo') { args.repo = value; index += 1; }
    else if (key === '--todo') { args.todo = value; index += 1; }
    else if (key === '--breakdown') { args.breakdown = value; index += 1; }
    else if (key === '--state') { args.state = value; index += 1; }
    else if (key === '--completion') { args.completion = value; index += 1; }
    else if (key === '--snapshot') { args.snapshot = value; index += 1; }
    else if (key === '--review-receipt') { args.reviewReceipt = value; index += 1; }
    else if (key === '--merge-receipt') { args.mergeReceipt = value; index += 1; }
    else if (key === '--actor-deployment') { args.actorDeployment = value; index += 1; }
    else throw new Error(`unknown_argument:${key}`);
  }
  return args;
}

function recoveryActors({ repoRoot, actorDeploymentPath, actorDeployment }) {
  const loaded = loadPhaseLoopActorDeployment({
    repoRoot,
    deploymentPath: actorDeploymentPath,
    deployment: actorDeployment
  });
  if (!loaded.ok) {
    throw new Error(`actor_deployment_invalid:${loaded.errors.join(';')}`);
  }
  const implementation = roleActor(loaded.deployment, 'implementation');
  const review = roleActor(loaded.deployment, 'review');
  if (!implementation || !review) {
    throw new Error('actor_deployment_missing_recovery_roles');
  }
  return { implementation, review, deploymentPath: loaded.deploymentPath };
}

function assertRecoveryInputs({ completion, snapshot, review, todoText, expectedAuthor, expectedReviewer, allowLiveTarget = false }) {
  const claimId = typeof completion?.claim_id === 'string' ? completion.claim_id : '';
  const targetId = typeof completion?.selected_todo_id === 'string' ? completion.selected_todo_id : '';
  if (!claimId || !targetId || completion?.schema_version >= 2) {
    throw new Error('legacy_completion_record_required');
  }
  const selected = typeof snapshot?.selected_todo === 'string' ? snapshot.selected_todo.trimEnd() : '';
  const baseline = typeof snapshot?.baseline_todo_text === 'string' ? snapshot.baseline_todo_text : '';
  if (!selected || todoId(selected) !== targetId || !baseline.includes(selected)) {
    throw new Error('immutable_snapshot_does_not_match_legacy_completion');
  }
  if (snapshot?.claim_id !== claimId) {
    throw new Error('immutable_snapshot_claim_does_not_match_legacy_completion');
  }
  const selectedFirstLine = selected.split('\n')[0] ?? '';
  if (
    (snapshot?.selected_todo_id && snapshot.selected_todo_id !== targetId)
    || (snapshot?.selected_todo_first_line && snapshot.selected_todo_first_line !== selectedFirstLine)
    || (snapshot?.selected_todo_sha256 && snapshot.selected_todo_sha256 !== sha256(selected))
    || (completion?.selected_todo_first_line && completion.selected_todo_first_line !== selectedFirstLine)
  ) {
    throw new Error('immutable_snapshot_selected_todo_does_not_match_legacy_completion');
  }
  const liveTarget = findBlock(todoText, targetId);
  if (liveTarget && (!allowLiveTarget || sha256(liveTarget) !== sha256(selected))) {
    throw new Error('legacy_target_is_already_live');
  }
  const parentId = sourceTodoId(selected);
  if (!parentId) throw new Error('legacy_target_source_parent_missing');
  const parent = findBlock(todoText, parentId);
  if (!parent) throw new Error('legacy_source_parent_not_live');
  const reviewValidation = reviewRejectionValid(review, expectedAuthor, expectedReviewer);
  if (!reviewValidation.valid) throw new Error(reviewValidation.reason);
  return { claimId, targetId, selected, parentId, parent };
}

function assertLegacyAttestationInputs({ completion, snapshot, mergeReceipt, todoText, expectedAuthor, expectedReviewer }) {
  const claimId = typeof completion?.claim_id === 'string' ? completion.claim_id : '';
  const targetId = typeof completion?.selected_todo_id === 'string' ? completion.selected_todo_id : '';
  if (!claimId || !targetId || completion?.schema_version >= 2) {
    throw new Error('legacy_completion_record_required');
  }
  const selected = typeof snapshot?.selected_todo === 'string' ? snapshot.selected_todo.trimEnd() : '';
  const baseline = typeof snapshot?.baseline_todo_text === 'string' ? snapshot.baseline_todo_text : '';
  if (!selected || todoId(selected) !== targetId || !baseline.includes(selected)) {
    throw new Error('immutable_snapshot_does_not_match_legacy_completion');
  }
  if (snapshot?.claim_id !== claimId) {
    throw new Error('immutable_snapshot_claim_does_not_match_legacy_completion');
  }
  const selectedFirstLine = selected.split('\n')[0] ?? '';
  if (
    (snapshot?.selected_todo_id && snapshot.selected_todo_id !== targetId)
    || (snapshot?.selected_todo_first_line && snapshot.selected_todo_first_line !== selectedFirstLine)
    || (snapshot?.selected_todo_sha256 && snapshot.selected_todo_sha256 !== sha256(selected))
    || (completion?.selected_todo_first_line && completion.selected_todo_first_line !== selectedFirstLine)
  ) {
    throw new Error('immutable_snapshot_selected_todo_does_not_match_legacy_completion');
  }
  if (findBlock(todoText, targetId)) {
    throw new Error('legacy_target_is_already_live');
  }
  const receiptValidation = mergedDeliveryReceiptValid(mergeReceipt, {
    claimId,
    selected,
    expectedAuthor,
    expectedReviewer
  });
  if (!receiptValidation.valid) throw new Error(receiptValidation.reason);
  return { claimId, targetId, selected };
}

export function attestLegacyMergedCompletion({
  repoRoot,
  todoPath = defaultTodo,
  statePath = defaultState,
  completionPath,
  snapshotPath,
  mergeReceiptPath,
  actorDeploymentPath,
  actorDeployment,
  now = new Date().toISOString()
}) {
  const root = path.resolve(repoRoot);
  const actors = recoveryActors({ repoRoot: root, actorDeploymentPath, actorDeployment });
  const todoFile = path.resolve(root, todoPath);
  const stateRoot = path.resolve(root, statePath);
  const completionFile = path.resolve(root, completionPath);
  const snapshotFile = path.resolve(root, snapshotPath);
  const receiptFile = path.resolve(root, mergeReceiptPath);
  const completion = readJson(completionFile);
  const snapshot = readJson(snapshotFile);
  const mergeReceipt = readJson(receiptFile);
  const todoText = readText(todoFile);
  const input = assertLegacyAttestationInputs({
    completion,
    snapshot,
    mergeReceipt,
    todoText,
    expectedAuthor: actors.implementation,
    expectedReviewer: actors.review
  });
  const receiptId = sha256(`${input.claimId}\n${sha256(input.selected)}\n${mergeReceipt.pr_url}\n${mergeReceipt.merge_commit}`).slice(0, 24);
  const completionDir = path.join(stateRoot, 'todo-completions');
  const recordPath = path.join(completionDir, `durable-legacy-${input.claimId}-${receiptId}.json`);
  if (fs.existsSync(recordPath)) {
    return {
      schema_version: 1,
      attested: false,
      idempotent_attestation: true,
      claim_id: input.claimId,
      selected_todo_id: input.targetId,
      durable_record_path: path.relative(root, recordPath)
    };
  }
  const deliveryReceipt = {
    schema_version: 1,
    claim_id: input.claimId,
    root_claim_id: input.claimId,
    selected_todo_sha256: sha256(input.selected),
    approved: true,
    ci_passed: true,
    merged: true,
    author: actors.implementation,
    reviewer: actors.review,
    merge_actor: actors.review,
    pr_url: mergeReceipt.pr_url,
    pr_head_sha: mergeReceipt.head_sha,
    merge_commit: mergeReceipt.merge_commit,
    merged_at: mergeReceipt.merged_at,
    semantic_completion_evidence: mergeReceipt.semantic_completion_evidence
  };
  const record = {
    schema_version: 2,
    record_type: 'legacy_completion_delivery_attestation',
    claim_id: input.claimId,
    root_claim_id: input.claimId,
    selected_todo_id: input.targetId,
    selected_todo_first_line: input.selected.split('\n')[0],
    selected_todo_sha256: sha256(input.selected),
    reason: 'historical_completion_attested_by_independent_merged_delivery',
    delivery_receipt: deliveryReceipt,
    attestation: {
      receipt_id: receiptId,
      legacy_completion_path: path.relative(root, completionFile),
      immutable_snapshot_path: path.relative(root, snapshotFile),
      merge_receipt_path: path.relative(root, receiptFile),
      completion_record_sha256: sha256(readText(completionFile)),
      snapshot_sha256: sha256(readText(snapshotFile)),
      merge_receipt_sha256: sha256(readText(receiptFile)),
      attested_at: now
    }
  };
  const auditPath = path.join(stateRoot, 'legacy-completion-attestations', `${receiptId}.json`);
  const audit = {
    schema_version: 1,
    record_type: 'legacy_completion_delivery_attestation',
    receipt_id: receiptId,
    claim_id: input.claimId,
    selected_todo_id: input.targetId,
    durable_record_path: path.relative(root, recordPath),
    pr_url: mergeReceipt.pr_url,
    merge_commit: mergeReceipt.merge_commit,
    reviewer: actors.review,
    attested_at: now
  };
  atomicJson(recordPath, record);
  atomicJson(auditPath, audit);
  return {
    schema_version: 1,
    attested: true,
    claim_id: input.claimId,
    selected_todo_id: input.targetId,
    durable_record_path: path.relative(root, recordPath),
    audit_path: path.relative(root, auditPath),
    actor_deployment_path: actors.deploymentPath ? path.relative(root, actors.deploymentPath) : null
  };
}

function reviewReworkRearmEvidence({ root, stateRoot, currentClaim }) {
  if (currentClaim?.delivery_review?.merged === true || currentClaim?.completion_certificate != null) return null;
  const terminalTransition = Array.isArray(currentClaim?.status_history)
    ? currentClaim.status_history.at(-1)
    : null;
  if (
    currentClaim?.status === 'integrity_blocked'
    && terminalTransition?.status === 'integrity_blocked'
    && terminalTransition?.requested_status === 'completed'
  ) {
    const refusals = Array.isArray(currentClaim?.completion_promotion_rejections)
      ? currentClaim.completion_promotion_rejections
      : [];
    if (refusals.some((refusal) => (
      refusal?.requested_status === 'completed'
      && typeof refusal?.reason === 'string'
      && refusal.reason.startsWith('completed_requires_claim_bound_')
    ))) {
      return {
        reason: 'completion_promotion_refused_for_changes_requested_root_claim',
        audit: { terminal_status: 'integrity_blocked', requested_status: 'completed' }
      };
    }
  }

  // Older controllers could terminalize a directly executed, authorized
  // objective preflight before they reached the apply route, solely because a
  // stale replay budget was carried into the fresh dispatch. Rearm only this
  // auditable, unapplied shape once; every other failure remains fail-closed.
  if (
    currentClaim?.status !== 'failed'
    || currentClaim?.review_rework_fresh_dispatch_pending !== false
    || typeof currentClaim?.review_rework_fresh_dispatch_activated_run_stamp !== 'string'
    || !/^[0-9]{8}T[0-9]{6}Z$/u.test(currentClaim.review_rework_fresh_dispatch_activated_run_stamp)
    || typeof currentClaim?.terminal_failure_execution_evidence_path !== 'string'
  ) return null;
  const activatedRunStamp = currentClaim.review_rework_fresh_dispatch_activated_run_stamp;
  const failedTransition = [...(Array.isArray(currentClaim.status_history) ? currentClaim.status_history : [])]
    .reverse()
    .find((entry) => entry?.requested_status === 'failed' && entry?.status === 'failed');
  if (failedTransition?.run_stamp !== activatedRunStamp) return null;
  try {
    const executionRelative = existingPathInsideRoot(
      root,
      currentClaim.terminal_failure_execution_evidence_path,
      'review_rework_unapplied_objective_apply_execution_evidence'
    );
    const execution = readJson(path.resolve(root, executionRelative));
    const stdoutPath = path.join(stateRoot, 'runs', `${activatedRunStamp}.stdout.log`);
    const stdoutRelative = existingPathInsideRoot(
      root,
      path.relative(root, stdoutPath),
      'review_rework_unapplied_objective_apply_stdout'
    );
    const stdout = readJson(path.resolve(root, stdoutRelative));
    const payload = stdout?.run;
    const unconsumed = (value) => value == null || value === false || value === '';
    const selectedTodoSha256 = sha256(currentClaim.selected_todo);
    if (
      execution?.claim_id !== currentClaim.claim_id
      || execution?.runtime_claim_id !== currentClaim.claim_id
      || execution?.selected_todo_sha256 !== selectedTodoSha256
      || execution?.task_execution_confirmed !== true
      || execution?.signals?.payload_status !== 'task_executed'
      || execution?.signals?.task_execution_confirmed !== true
      || !Number.isSafeInteger(execution?.signals?.reported_executed_count)
      || execution.signals.reported_executed_count < 1
      || execution?.signals?.stop_class !== 'continuation_required'
      || execution?.signals?.stop_reason !== 'objective_proposal_candidate_ready'
      || stdout?.command !== 'run'
      || stdout?.ok !== true
      || stdout?.exit_code !== 0
      || payload?.status !== 'task_executed'
      || payload?.task_execution_confirmed !== true
      || !Number.isSafeInteger(payload?.executed_count)
      || payload.executed_count < 1
      || payload?.next_action !== 'apply_authorized_objective_proposal'
      || payload?.objective_proposal_preflight_status !== 'authorized_preflight_ready'
      || payload?.completed !== false
      || payload?.blocked !== false
      || payload?.terminal_failure !== false
      || !unconsumed(payload?.objective_apply_authorization_consumed)
      || !unconsumed(payload?.objective_apply_applied)
      || !unconsumed(payload?.objective_apply_path)
      || !unconsumed(payload?.objective_apply_verification_status)
    ) return null;
    return {
      reason: 'unapplied_authorized_objective_preflight_failed_before_apply',
      audit: {
        run_stamp: activatedRunStamp,
        execution_evidence_path: executionRelative,
        stdout_path: stdoutRelative,
        task_id: payload.task_id ?? null,
        runtime_run_id: payload.run_id ?? null
      }
    };
  } catch {
    return null;
  }
}

function isRearmableReviewReworkCompletionRefusal({ root, stateRoot, currentClaim }) {
  return reviewReworkRearmEvidence({ root, stateRoot, currentClaim }) != null;
}

function isLiveMatchingReviewReworkClaim({ root, stateRoot, currentClaim, claimId, selected, recoveryId }) {
  return Boolean(
    currentClaim
    && currentClaim.claim_id === claimId
    && currentClaim.root_claim_id === claimId
    && currentClaim.legacy_completion_recovery?.recovery_id === recoveryId
    && currentClaim.review_rework?.required === true
    && currentClaim.review_rework?.state === 'CHANGES_REQUESTED'
    && sha256(currentClaim.selected_todo) === sha256(selected)
    && (
      ['claimed', 'in_progress'].includes(currentClaim.status)
      || isRearmableReviewReworkCompletionRefusal({ root, stateRoot, currentClaim })
    )
  );
}

function isProvenTerminalDisplacement({ currentClaim, claimId, selected, invalidation }) {
  const terminalTransition = Array.isArray(currentClaim?.status_history)
    ? currentClaim.status_history.at(-1)
    : null;
  const invalidatedAt = Date.parse(invalidation?.invalidated_at ?? '');
  const terminalAt = Date.parse(terminalTransition?.updated_at ?? '');
  return Boolean(
    currentClaim
    && currentClaim.claim_id !== claimId
    && currentClaim.root_claim_id !== claimId
    && currentClaim.status === 'integrity_blocked'
    && currentClaim.delivery_review == null
    && sha256(currentClaim.selected_todo) === sha256(selected)
    && terminalTransition?.status === 'integrity_blocked'
    && Number.isFinite(invalidatedAt)
    && Number.isFinite(terminalAt)
    && terminalAt >= invalidatedAt
  );
}

function exactSelectedTodoFirstLine(selected) {
  return typeof selected === 'string' && selected.trim()
    ? selected.trim().split('\n')[0]
    : '';
}

function existingRepositoryRelativePath(root, value, label) {
  if (typeof value !== 'string' || !value.trim() || path.isAbsolute(value)) {
    throw new Error(`review_rework_lineage_${label}_path_invalid`);
  }
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !fs.existsSync(resolved)) {
    throw new Error(`review_rework_lineage_${label}_path_invalid`);
  }
  return relative;
}

function existingPathInsideRoot(root, value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`review_rework_lineage_${label}_path_invalid`);
  }
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !fs.existsSync(resolved)) {
    throw new Error(`review_rework_lineage_${label}_path_invalid`);
  }
  return relative;
}

function reviewReworkFeedbackIdentity(feedback) {
  const claimId = typeof feedback?.claim_id === 'string' ? feedback.claim_id : '';
  const recoveryId = typeof feedback?.recovery_id === 'string' ? feedback.recovery_id : '';
  const selectedFirstLine = typeof feedback?.selected_todo_first_line === 'string'
    ? feedback.selected_todo_first_line
    : '';
  if (
    feedback?.kind !== 'phase_loop_review_rework_required'
    || (feedback?.completed !== false && feedback?.completed !== true)
    || !claimId
    || feedback?.root_claim_id !== claimId
    || !recoveryId
    || !selectedFirstLine
    || feedback?.review_state !== 'CHANGES_REQUESTED'
  ) {
    throw new Error('review_rework_lineage_feedback_invalid');
  }
  return {
    claimId,
    recoveryId,
    selectedFirstLine,
    selectedTodoSha256: typeof feedback?.recovery_inputs?.selected_todo_sha256 === 'string'
      ? feedback.recovery_inputs.selected_todo_sha256
      : null,
    prUrl: typeof feedback?.pr_url === 'string' ? feedback.pr_url : '',
    reviewer: typeof feedback?.reviewer === 'string' ? feedback.reviewer : ''
  };
}

function currentClaimMatchesReviewReworkFeedback({ currentClaim, identity }) {
  return Boolean(
    currentClaim
    && currentClaim.claim_id === identity.claimId
    && currentClaim.root_claim_id === identity.claimId
    && currentClaim.legacy_completion_recovery?.recovery_id === identity.recoveryId
    && exactSelectedTodoFirstLine(currentClaim.selected_todo) === identity.selectedFirstLine
    && (!identity.selectedTodoSha256 || sha256(currentClaim.selected_todo) === identity.selectedTodoSha256)
  );
}

function resolvedReviewReworkDelivery({ currentClaim, identity, todoText }) {
  if (!currentClaimMatchesReviewReworkFeedback({ currentClaim, identity })) {
    return { valid: false, reason: 'review_rework_delivery_claim_identity_mismatch' };
  }
  if (currentClaim.review_rework?.required !== false) {
    return { valid: false, reason: 'review_rework_delivery_still_requires_rework' };
  }
  if (currentClaim.delivery_review?.reviewer !== identity.reviewer) {
    return { valid: false, reason: 'review_rework_delivery_reviewer_mismatch' };
  }
  const targetId = todoId(identity.selectedFirstLine);
  if (!targetId || findBlock(todoText, targetId)) {
    return { valid: false, reason: 'review_rework_delivery_todo_not_durably_removed' };
  }
  const terminal = validateTerminalDeliveryReceipt({ claim: currentClaim });
  if (!terminal.valid) {
    return { valid: false, reason: 'review_rework_delivery_receipt_invalid', errors: terminal.errors };
  }
  return { valid: true, targetId };
}

function resolvePersistedReviewReworkFeedback({ root, stateRoot, feedbackPath, feedback, identity, currentClaim, now }) {
  const archivePath = path.join(
    stateRoot,
    'todo-repair-feedback-archive',
    `review-rework-${identity.recoveryId}-delivery-resolved.json`
  );
  if (!fs.existsSync(archivePath)) atomicJson(archivePath, feedback);
  const completedFeedback = {
    ...feedback,
    completed: true,
    resolved_at: now,
    resolution: 'independent_review_ci_merge_and_semantic_delivery_verified',
    resolution_delivery: {
      claim_id: currentClaim.claim_id,
      root_claim_id: currentClaim.root_claim_id,
      pr_url: currentClaim.delivery_review.pr_url,
      reviewer: currentClaim.delivery_review.reviewer,
      merge_actor: currentClaim.delivery_review.merge_actor,
      semantic_completion_evidence: true
    },
    archived_path: path.relative(root, archivePath)
  };
  atomicJson(feedbackPath, completedFeedback);
  return {
    schema_version: 1,
    applicable: false,
    resolved: true,
    reason: 'review_rework_feedback_resolved_by_independent_delivery',
    feedback_path: path.relative(root, feedbackPath),
    archive_path: path.relative(root, archivePath)
  };
}

function completedReviewReworkFeedbackValid({ root, feedback, identity }) {
  if (feedback?.resolution === 'review_rework_obviated_by_independent_durable_completion') {
    const delivery = feedback?.resolution_delivery;
    if (
      feedback?.completed !== true
      || typeof feedback?.resolved_at !== 'string' || !feedback.resolved_at
      || delivery?.stale_claim_id !== identity.claimId
      || typeof delivery?.independent_completion_claim_id !== 'string' || !delivery.independent_completion_claim_id
      || typeof delivery?.independent_root_claim_id !== 'string' || !delivery.independent_root_claim_id
      || delivery.independent_root_claim_id === identity.claimId
      || delivery.selected_todo_sha256 !== identity.selectedTodoSha256
      || typeof feedback?.independent_completion_reconciliation?.audit_path !== 'string'
      || typeof feedback?.independent_completion_reconciliation?.audit_sha256 !== 'string'
    ) {
      throw new Error('review_rework_lineage_completed_feedback_invalid');
    }
    const archivePath = existingRepositoryRelativePath(root, feedback.archived_path, 'completed_feedback_archive');
    const archived = readJson(path.resolve(root, archivePath));
    let archivedIdentity;
    try {
      archivedIdentity = reviewReworkFeedbackIdentity(archived);
    } catch {
      throw new Error('review_rework_lineage_completed_feedback_archive_invalid');
    }
    if (archived?.completed !== false || archivedIdentity.claimId !== identity.claimId
      || archivedIdentity.recoveryId !== identity.recoveryId
      || archivedIdentity.selectedFirstLine !== identity.selectedFirstLine) {
      throw new Error('review_rework_lineage_completed_feedback_archive_invalid');
    }
    const auditPath = existingRepositoryRelativePath(
      root,
      feedback.independent_completion_reconciliation.audit_path,
      'independent_completion_reconciliation'
    );
    if (sha256(readText(path.resolve(root, auditPath))) !== feedback.independent_completion_reconciliation.audit_sha256) {
      throw new Error('review_rework_independent_completion_audit_digest_mismatch');
    }
    const audit = readJson(path.resolve(root, auditPath));
    if (audit?.record_type !== 'review_rework_independent_completion_reconciliation'
      || audit?.stale_claim_id !== identity.claimId
      || audit?.independent_completion?.claim_id !== delivery.independent_completion_claim_id
      || audit?.independent_completion?.root_claim_id !== delivery.independent_root_claim_id
      || audit?.selected_todo_sha256 !== identity.selectedTodoSha256) {
      throw new Error('review_rework_independent_completion_audit_invalid');
    }
    return;
  }
  if (
    feedback?.completed !== true
    || feedback?.resolution !== 'independent_review_ci_merge_and_semantic_delivery_verified'
    || typeof feedback?.resolved_at !== 'string'
    || !feedback.resolved_at
    || feedback?.resolution_delivery?.claim_id !== identity.claimId
    || feedback?.resolution_delivery?.root_claim_id !== identity.claimId
    || typeof feedback?.resolution_delivery?.pr_url !== 'string'
    || !feedback.resolution_delivery.pr_url
    || feedback?.resolution_delivery?.semantic_completion_evidence !== true
  ) {
    throw new Error('review_rework_lineage_completed_feedback_invalid');
  }
  const archivePath = existingRepositoryRelativePath(root, feedback.archived_path, 'completed_feedback_archive');
  const archived = readJson(path.resolve(root, archivePath));
  let archivedIdentity;
  try {
    archivedIdentity = reviewReworkFeedbackIdentity(archived);
  } catch {
    throw new Error('review_rework_lineage_completed_feedback_archive_invalid');
  }
  if (
    archived?.completed !== false
    || archivedIdentity.claimId !== identity.claimId
    || archivedIdentity.recoveryId !== identity.recoveryId
    || archivedIdentity.selectedFirstLine !== identity.selectedFirstLine
    || archivedIdentity.prUrl !== identity.prUrl
  ) {
    throw new Error('review_rework_lineage_completed_feedback_archive_invalid');
  }
}

// A matching TODO id is not causality.  An independently delivered historical
// child may legitimately share the same id as a rejected stale root.  Only a
// verified receipt whose claim lineage and exact selected-TODO digest differ
// from the rejected root can obviate that root's review-rework obligation.
function independentDurableCompletion({ root, stateRoot, identity, source }) {
  const targetId = todoId(source.selected_todo);
  const selectedTodoSha256 = sha256(source.selected_todo);
  if (!targetId || selectedTodoSha256 !== identity.selectedTodoSha256) {
    throw new Error('review_rework_independent_completion_source_invalid');
  }
  const invalidated = new Set(readTodoCompletionInvalidationRecords(root).map((record) => (
    `${record.selected_todo_id}\u0000${record.invalidated_completion_claim_id}`
  )));
  const matches = readTodoCompletionRecords(root).filter((record) => {
    const receipt = durableCompletionRecordReceipt(record);
    const receiptRoot = record?.delivery_receipt?.root_claim_id;
    const historicalParent = record?.delivery_receipt?.historical_delivery_evidence?.parent_claim_id;
    const rootClaimId = typeof record?.root_claim_id === 'string' ? record.root_claim_id : record?.claim_id;
    return (
      receipt.valid
      && record?.selected_todo_id === targetId
      && record?.selected_todo_sha256 === selectedTodoSha256
      && record?.delivery_receipt?.selected_todo_sha256 === selectedTodoSha256
      && typeof record?.claim_id === 'string' && record.claim_id
      && typeof rootClaimId === 'string' && rootClaimId
      && rootClaimId !== identity.claimId
      && receiptRoot === rootClaimId
      && !invalidated.has(`${targetId}\u0000${record.claim_id}`)
      // Derived historical attestations have a second causal pointer.  It
      // must agree with the receipt root; otherwise this is not admissible.
      && (record.record_type !== 'derived_historical_delivery_attestation'
        || historicalParent === rootClaimId)
    );
  });
  if (matches.length > 1) throw new Error('review_rework_independent_completion_ambiguous');
  if (matches.length === 0) return null;
  const record = matches[0];
  return {
    record,
    target_id: targetId,
    selected_todo_sha256: selectedTodoSha256,
    receipt_sha256: sha256(JSON.stringify(record)),
    root_claim_id: record.root_claim_id ?? record.claim_id,
    historical_parent_claim_id: record.delivery_receipt?.historical_delivery_evidence?.parent_claim_id ?? null,
    replan_record_sha256: record.delivery_receipt?.historical_delivery_evidence?.replan_record_sha256 ?? null
  };
}

function terminalizeReviewReworkObviatedByIndependentCompletion({
  root, stateRoot, feedbackPath, feedback, identity, source, currentClaim, todoText, independent,
  todoPath = defaultTodo, breakdownPath = defaultBreakdown, now
}) {
  const snapshotPath = path.join(stateRoot, 'legacy-completion-recoveries', `${identity.recoveryId}.todo-before.md`);
  if (!fs.existsSync(snapshotPath)) throw new Error('review_rework_independent_completion_pre_recovery_snapshot_missing');
  const todoBefore = readText(snapshotPath);
  const targetId = independent.target_id;
  const restoredTarget = findBlock(todoText, targetId);
  const priorTarget = findBlock(todoBefore, targetId);
  const parentId = sourceTodoId(source.selected_todo);
  const currentParent = findBlock(todoText, parentId);
  const priorParent = findBlock(todoBefore, parentId);
  const reconciliationId = sha256(`${identity.recoveryId}\n${independent.record.claim_id}\n${independent.receipt_sha256}`).slice(0, 24);
  const archivePath = path.join(stateRoot, 'todo-claims', `review-rework-independent-completion-${reconciliationId}.json`);
  const auditPath = path.join(stateRoot, 'review-rework-independent-completion-reconciliations', `${reconciliationId}.json`);
  const feedbackArchivePath = path.join(stateRoot, 'todo-repair-feedback-archive', `review-rework-${identity.recoveryId}-independent-completion-obviated.json`);
  const completeFeedback = (validation) => {
    const completedFeedback = {
      ...feedback,
      completed: true,
      resolved_at: now,
      resolution: 'review_rework_obviated_by_independent_durable_completion',
      resolution_delivery: {
        stale_claim_id: identity.claimId,
        independent_completion_claim_id: independent.record.claim_id,
        independent_root_claim_id: independent.root_claim_id,
        selected_todo_sha256: independent.selected_todo_sha256
      },
      independent_completion_reconciliation: {
        audit_path: path.relative(root, auditPath),
        audit_sha256: sha256(readText(auditPath))
      },
      archived_path: path.relative(root, feedbackArchivePath)
    };
    atomicJson(feedbackPath, completedFeedback);
    return {
      schema_version: 1,
      applicable: false,
      resolved: true,
      reason: 'review_rework_obviated_by_independent_durable_completion',
      audit_path: path.relative(root, auditPath),
      stale_claim_archive_path: path.relative(root, archivePath),
      feedback_path: path.relative(root, feedbackPath),
      queue_validation: validation
    };
  };
  // An interruption after queue restoration and stale-claim removal must not
  // resurrect the root.  Resume only from the deterministic audit/artifacts
  // and only if the queue already equals the pre-recovery form.
  if (!currentClaim) {
    if (!fs.existsSync(auditPath) || !fs.existsSync(archivePath) || !fs.existsSync(feedbackArchivePath)
      || restoredTarget || !currentParent || !priorParent || currentParent.trimEnd() !== priorParent.trimEnd()) {
      throw new Error('review_rework_independent_completion_current_claim_identity_mismatch');
    }
    const audit = readJson(auditPath);
    if (audit?.record_type !== 'review_rework_independent_completion_reconciliation'
      || audit?.stale_claim_id !== identity.claimId
      || audit?.independent_completion?.claim_id !== independent.record.claim_id
      || audit?.independent_completion?.root_claim_id !== independent.root_claim_id
      || audit?.selected_todo_sha256 !== independent.selected_todo_sha256) {
      throw new Error('review_rework_independent_completion_audit_invalid');
    }
    return completeFeedback({ valid: true, idempotent_terminalization: true });
  }
  if (!currentClaimMatchesReviewReworkFeedback({ currentClaim, identity })
    || currentClaim?.review_rework?.required !== true
    || currentClaim?.review_rework?.state !== 'CHANGES_REQUESTED') {
    throw new Error('review_rework_independent_completion_current_claim_identity_mismatch');
  }
  if (priorTarget || restoredTarget?.trimEnd() !== source.selected_todo.trimEnd()
    || !currentParent || !priorParent
    || currentParent.trimEnd() !== replaceCheckbox(priorParent, false).trimEnd()) {
    throw new Error('review_rework_independent_completion_queue_lineage_mismatch');
  }
  const restoredQueue = removeExactBlock(todoText, restoredTarget)
    .replace(currentParent, priorParent)
    .replace(/\n{3,}/gu, '\n\n');
  const todoFile = path.resolve(root, todoPath);
  const breakdownFile = path.resolve(root, breakdownPath);
  const replanRecords = readAllTodoReplanRecords(root, { breakdownPath: breakdownFile });
  const stateAfter = resolveTodoState({
    todoText: restoredQueue,
    replanRecords,
    completionRecords: readTodoCompletionRecords(root),
    completionInvalidationRecords: readTodoCompletionInvalidationRecords(root)
  });
  const validation = validateTodoQueueIntegrity({
    todoBefore: todoText,
    todoAfter: restoredQueue,
    afterBreakdownText: fs.existsSync(breakdownFile) ? readText(breakdownFile) : null,
    completedTodoIds: [...stateAfter.completedIds],
    unverifiedArchivedCompletionRecords: stateAfter.unverifiedCompletionRecords
      .filter((record) => stateAfter.unverifiedArchivedCompletionIds.has(record.selected_todo_id)),
    todoReplanRecords: replanRecords
  });
  if (!validation.valid) {
    throw new Error(`review_rework_independent_completion_queue_validation_failed:${validation.errors.map((error) => error.code).join(',')}`);
  }
  const archivedClaim = {
    ...currentClaim,
    status: 'review_rework_obviated_by_independent_completion',
    archive_reason: 'changes_requested_stale_root_obviated_by_independent_durable_completion',
    independent_completion: {
      claim_id: independent.record.claim_id,
      root_claim_id: independent.root_claim_id,
      selected_todo_sha256: independent.selected_todo_sha256,
      receipt_sha256: independent.receipt_sha256
    },
    terminalized_at: now
  };
  const audit = {
    schema_version: 1,
    record_type: 'review_rework_independent_completion_reconciliation',
    reconciliation_id: reconciliationId,
    stale_claim_id: identity.claimId,
    recovery_id: identity.recoveryId,
    selected_todo_id: targetId,
    selected_todo_sha256: independent.selected_todo_sha256,
    stale_claim_archive_path: path.relative(root, archivePath),
    stale_claim_archive_sha256: sha256(JSON.stringify(archivedClaim)),
    pre_recovery_todo_snapshot_path: path.relative(root, snapshotPath),
    pre_recovery_todo_snapshot_sha256: sha256(todoBefore),
    independent_completion: {
      claim_id: independent.record.claim_id,
      root_claim_id: independent.root_claim_id,
      historical_parent_claim_id: independent.historical_parent_claim_id,
      replan_record_sha256: independent.replan_record_sha256,
      record_sha256: independent.receipt_sha256
    },
    reconciled_at: now
  };
  if (!fs.existsSync(archivePath)) atomicJson(archivePath, archivedClaim);
  if (!fs.existsSync(auditPath)) atomicJson(auditPath, audit);
  if (!fs.existsSync(feedbackArchivePath)) atomicJson(feedbackArchivePath, feedback);
  atomicWrite(todoFile, restoredQueue, 0o600);
  fs.unlinkSync(path.join(stateRoot, 'todo-claims', 'current.json'));
  return completeFeedback(validation);
}

function reviewReworkImmutableInputs({ root, feedback, identity }) {
  const inputs = feedback?.recovery_inputs;
  if (!inputs || typeof inputs !== 'object' || !identity.selectedTodoSha256
    || !/^[a-f0-9]{64}$/u.test(identity.selectedTodoSha256)) {
    throw new Error('review_rework_lineage_recovery_inputs_invalid');
  }
  return {
    completion_path: existingRepositoryRelativePath(root, inputs.completion_record_path, 'completion'),
    snapshot_path: existingRepositoryRelativePath(root, inputs.immutable_snapshot_path, 'snapshot'),
    review_receipt_path: existingRepositoryRelativePath(root, inputs.review_receipt_path, 'review_receipt'),
    selected_todo_sha256: identity.selectedTodoSha256
  };
}

function immutableLineageSource({ root, identity, inputs, sourceClaimPath = null, sourceClaimSha256 = null, establishedAt, establishedBy }) {
  const selected = readJson(path.resolve(root, inputs.snapshot_path))?.selected_todo;
  if (typeof selected !== 'string' || sha256(selected.trimEnd()) !== inputs.selected_todo_sha256) {
    throw new Error('review_rework_lineage_snapshot_selected_todo_mismatch');
  }
  return {
    schema_version: 1,
    kind: 'review_rework_immutable_recovery_inputs',
    claim_id: identity.claimId,
    root_claim_id: identity.claimId,
    recovery_id: identity.recoveryId,
    selected_todo_sha256: inputs.selected_todo_sha256,
    completion_record_path: inputs.completion_path,
    completion_record_sha256: sha256(readText(path.resolve(root, inputs.completion_path))),
    immutable_snapshot_path: inputs.snapshot_path,
    immutable_snapshot_sha256: sha256(readText(path.resolve(root, inputs.snapshot_path))),
    review_receipt_path: inputs.review_receipt_path,
    review_receipt_sha256: sha256(readText(path.resolve(root, inputs.review_receipt_path))),
    source_claim_path: sourceClaimPath,
    source_claim_sha256: sourceClaimSha256,
    established_by: establishedBy,
    established_at: establishedAt
  };
}

function verifiedImmutableLineageSource({ root, feedback, identity }) {
  const source = feedback?.lineage_source;
  if (source == null) return null;
  const inputs = reviewReworkImmutableInputs({ root, feedback, identity });
  if (
    source?.schema_version !== 1
    || source?.kind !== 'review_rework_immutable_recovery_inputs'
    || source?.claim_id !== identity.claimId
    || source?.root_claim_id !== identity.claimId
    || source?.recovery_id !== identity.recoveryId
    || source?.selected_todo_sha256 !== inputs.selected_todo_sha256
    || source?.completion_record_path !== inputs.completion_path
    || source?.immutable_snapshot_path !== inputs.snapshot_path
    || source?.review_receipt_path !== inputs.review_receipt_path
    || typeof source?.established_at !== 'string'
    || !source.established_at
    || typeof source?.established_by !== 'string'
    || !source.established_by
  ) {
    throw new Error('review_rework_lineage_source_pointer_invalid');
  }
  for (const [field, relativePath] of [
    ['completion_record_sha256', inputs.completion_path],
    ['immutable_snapshot_sha256', inputs.snapshot_path],
    ['review_receipt_sha256', inputs.review_receipt_path]
  ]) {
    if (typeof source[field] !== 'string' || !/^[a-f0-9]{64}$/u.test(source[field])
      || source[field] !== sha256(readText(path.resolve(root, relativePath)))) {
      throw new Error('review_rework_lineage_source_pointer_digest_mismatch');
    }
  }
  if ((source.source_claim_path == null) !== (source.source_claim_sha256 == null)) {
    throw new Error('review_rework_lineage_source_pointer_provenance_invalid');
  }
  if (source.source_claim_path != null) {
    const sourcePath = existingRepositoryRelativePath(root, source.source_claim_path, 'source_claim');
    if (sourcePath !== source.source_claim_path
      || typeof source.source_claim_sha256 !== 'string'
      || !/^[a-f0-9]{64}$/u.test(source.source_claim_sha256)
      || source.source_claim_sha256 !== sha256(readText(path.resolve(root, sourcePath)))) {
      throw new Error('review_rework_lineage_source_pointer_provenance_invalid');
    }
  }
  const selected = readJson(path.resolve(root, inputs.snapshot_path))?.selected_todo;
  if (typeof selected !== 'string' || sha256(selected.trimEnd()) !== inputs.selected_todo_sha256) {
    throw new Error('review_rework_lineage_snapshot_selected_todo_mismatch');
  }
  return {
    source_claim_path: source.source_claim_path,
    selected_todo: selected.trimEnd(),
    completion_path: inputs.completion_path,
    snapshot_path: inputs.snapshot_path,
    review_receipt_path: inputs.review_receipt_path,
    lineage_source: source,
    migrated: false
  };
}

function matchingArchivedReviewReworkSources({ root, stateRoot, feedback, identity }) {
  const claimsDir = path.join(stateRoot, 'todo-claims');
  if (!fs.existsSync(claimsDir)) return [];
  const inputs = reviewReworkImmutableInputs({ root, feedback, identity });
  const identityCandidates = fs.readdirSync(claimsDir)
    .filter((entry) => /^stale-rebaseline-[A-Za-z0-9TZ_.-]+\.json$/u.test(entry))
    .sort()
    .map((entry) => ({ path: path.join(claimsDir, entry), value: readJson(path.join(claimsDir, entry)) }))
    .filter(({ value }) => (
      value?.claim_id === identity.claimId
      && value?.root_claim_id === identity.claimId
      && value?.legacy_completion_recovery?.recovery_id === identity.recoveryId
      && value?.review_rework?.required === true
      && value?.review_rework?.state === 'CHANGES_REQUESTED'
      && exactSelectedTodoFirstLine(value?.selected_todo) === identity.selectedFirstLine
    ));
  const candidates = identityCandidates
    .filter(({ value }) => (
      sha256(value?.selected_todo?.trimEnd()) === inputs.selected_todo_sha256
      && value.legacy_completion_recovery?.completion_record_path === inputs.completion_path
      && value.legacy_completion_recovery?.immutable_snapshot_path === inputs.snapshot_path
      && value.legacy_completion_recovery?.review_receipt_path === inputs.review_receipt_path
    ));
  if (candidates.length !== identityCandidates.length) {
    throw new Error('review_rework_lineage_source_provenance_mismatch');
  }
  return candidates
    .map(({ path: candidatePath, value }) => ({
      path: candidatePath,
      value,
      recovered_at: value.legacy_completion_recovery?.recovered_at,
      recovered_at_ms: Date.parse(value.legacy_completion_recovery?.recovered_at ?? '')
    }));
}

function persistedReviewReworkSource({ root, stateRoot, feedbackPath, feedback, identity, now }) {
  const direct = verifiedImmutableLineageSource({ root, feedback, identity });
  if (direct) return direct;

  // Legacy feedback predates the immutable source pointer.  It may have been
  // archived repeatedly by the stale-claim controller.  Migrate only when all
  // candidates attest the same immutable inputs and exactly one earliest
  // recovery timestamp exists; otherwise retain the executable fail-closed
  // ambiguity rather than selecting by filename or most-recent controller run.
  const candidates = matchingArchivedReviewReworkSources({ root, stateRoot, feedback, identity });
  if (candidates.length === 0) throw new Error('review_rework_lineage_source_missing');
  if (candidates.some((candidate) => !Number.isFinite(candidate.recovered_at_ms))) {
    throw new Error('review_rework_lineage_source_recovery_time_invalid');
  }
  const earliest = Math.min(...candidates.map((candidate) => candidate.recovered_at_ms));
  const canonical = candidates.filter((candidate) => candidate.recovered_at_ms === earliest);
  if (canonical.length !== 1) throw new Error('review_rework_lineage_source_ambiguous');
  const sourceCandidate = canonical[0];
  const sourcePath = path.relative(root, sourceCandidate.path);
  const sourceDigest = sha256(readText(sourceCandidate.path));
  const inputs = reviewReworkImmutableInputs({ root, feedback, identity });
  const lineageSource = immutableLineageSource({
    root,
    identity,
    inputs,
    sourceClaimPath: sourcePath,
    sourceClaimSha256: sourceDigest,
    establishedAt: now,
    establishedBy: 'legacy_stale_rebaseline_lineage_migration'
  });
  const migrationId = sha256(`${identity.recoveryId}\n${sourcePath}\n${sourceDigest}`).slice(0, 24);
  const migrationPath = path.join(stateRoot, 'review-rework-lineage-migrations', `${migrationId}.json`);
  const migration = {
    schema_version: 1,
    record_type: 'review_rework_immutable_lineage_source_migration',
    migration_id: migrationId,
    recovery_id: identity.recoveryId,
    claim_id: identity.claimId,
    source_claim_path: sourcePath,
    source_claim_sha256: sourceDigest,
    source_recovered_at: sourceCandidate.recovered_at,
    candidate_count: candidates.length,
    candidate_paths: candidates.map((candidate) => path.relative(root, candidate.path)),
    selected_todo_sha256: inputs.selected_todo_sha256,
    migrated_at: now
  };
  if (!fs.existsSync(migrationPath)) atomicJson(migrationPath, migration);
  const migratedFeedback = {
    ...feedback,
    lineage_source: lineageSource,
    lineage_source_migration: {
      migration_id: migrationId,
      audit_path: path.relative(root, migrationPath),
      migrated_at: now
    },
    updated_at: now
  };
  atomicJson(feedbackPath, migratedFeedback);
  return {
    source_claim_path: sourcePath,
    selected_todo: sourceCandidate.value.selected_todo.trimEnd(),
    completion_path: inputs.completion_path,
    snapshot_path: inputs.snapshot_path,
    review_receipt_path: inputs.review_receipt_path,
    lineage_source: lineageSource,
    lineage_migration_audit_path: path.relative(root, migrationPath),
    migrated: true
  };
}

function derivativePreemptionEligibility({ root, stateRoot, currentClaim, source, todoText }) {
  const sourceTodo = todoId(source.selected_todo);
  const derivativeTodo = todoId(currentClaim?.selected_todo);
  const status = currentClaim?.status;
  if (!['claimed', 'in_progress'].includes(status)) return { eligible: false, reason: 'active_derivative_status_not_preemptible' };
  if (!sourceTodo || !derivativeTodo || currentClaim.claim_id !== currentClaim.root_claim_id
    || currentClaim.claim_id === source.lineage_source?.claim_id
    || lineValue(currentClaim.selected_todo, 'Route') !== 'todo-decomposition'
    || sourceTodoId(currentClaim.selected_todo) !== sourceTodo) {
    return { eligible: false, reason: 'active_claim_is_not_exact_review_rework_derivative' };
  }
  if (findBlock(todoText, sourceTodo)?.trimEnd() !== source.selected_todo
    || findBlock(todoText, derivativeTodo)?.trimEnd() !== currentClaim.selected_todo.trimEnd()) {
    return { eligible: false, reason: 'active_derivative_queue_identity_mismatch' };
  }
  if (!/^[0-9]{8}T[0-9]{6}Z$/u.test(String(currentClaim.run_stamp ?? ''))) {
    return { eligible: false, reason: 'active_derivative_run_stamp_invalid' };
  }
  const executionRelative = typeof currentClaim.terminal_failure_execution_evidence_path === 'string'
    ? existingPathInsideRoot(root, currentClaim.terminal_failure_execution_evidence_path, 'derivative_execution_evidence')
    : path.relative(root, path.join(stateRoot, 'runs', `${currentClaim.run_stamp}.execution-evidence.json`));
  const executionPath = path.resolve(root, executionRelative);
  if (!fs.existsSync(executionPath)) return { eligible: false, reason: 'active_derivative_execution_evidence_missing' };
  const execution = readJson(executionPath);
  const progressPath = path.join(stateRoot, 'progress-state.json');
  if (!fs.existsSync(progressPath)) return { eligible: false, reason: 'active_derivative_progress_state_missing' };
  const progress = readJson(progressPath);
  const projection = progress?.progress_projection ?? {};
  const unapplied = progress?.workspace_changed === false
    && progress?.claim_lifecycle?.claim_id === currentClaim.claim_id
    && projection?.claim_id === currentClaim.claim_id
    && projection?.selected_todo === currentClaim.selected_todo
    && projection?.objective_apply_pending === true
    && !String(projection?.applied ?? '').trim()
    && projection?.objective_apply_authorization_consumed !== true
    && projection?.selected_todo_still_pending_in_queue === true;
  const executionMatches = execution?.claim_id === currentClaim.claim_id
    && execution?.runtime_claim_id === currentClaim.claim_id
    && execution?.selected_todo_sha256 === sha256(currentClaim.selected_todo.trimEnd())
    && execution?.task_execution_confirmed === true
    && execution?.signals?.stop_class === 'continuation_required'
    && execution?.signals?.stop_reason === 'objective_proposal_candidate_ready';
  if (!unapplied || !executionMatches) {
    return { eligible: false, reason: 'active_derivative_has_applied_or_unverifiable_execution' };
  }
  return {
    eligible: true,
    source_todo_id: sourceTodo,
    derivative_todo_id: derivativeTodo,
    execution_path: path.relative(root, executionPath),
    execution_sha256: sha256(readText(executionPath)),
    progress_path: path.relative(root, progressPath),
    progress_sha256: sha256(readText(progressPath)),
    execution_attestation: {
      task_execution_confirmed: execution.task_execution_confirmed,
      stop_class: execution.signals.stop_class,
      stop_reason: execution.signals.stop_reason
    },
    progress_attestation: {
      workspace_changed: progress.workspace_changed,
      claim_id: progress.claim_lifecycle.claim_id,
      projection_claim_id: projection.claim_id,
      objective_apply_pending: projection.objective_apply_pending,
      objective_apply_authorization_consumed: projection.objective_apply_authorization_consumed ?? false,
      applied: projection.applied ?? '',
      selected_todo_still_pending_in_queue: projection.selected_todo_still_pending_in_queue
    }
  };
}

function preemptUnappliedReviewReworkDerivative({ root, stateRoot, currentClaimPath, currentClaim, source, todoText, now }) {
  const eligibility = derivativePreemptionEligibility({ root, stateRoot, currentClaim, source, todoText });
  if (!eligibility.eligible) return eligibility;
  const claimDir = path.dirname(currentClaimPath);
  const currentClaimText = readText(currentClaimPath);
  const sourceDigest = sha256(currentClaimText);
  const preemptionId = sha256(`${source.lineage_source.recovery_id}\n${currentClaim.claim_id}\n${sourceDigest}`).slice(0, 24);
  const archivePath = path.join(claimDir, `review-rework-derivative-preempted-${preemptionId}.json`);
  const auditPath = path.join(stateRoot, 'review-rework-derivative-preemptions', `${preemptionId}.json`);
  const archived = {
    ...currentClaim,
    status: 'review_rework_derivative_preempted',
    archive_reason: 'unapplied_todo_decomposition_derivative_preempted_by_changes_requested_root',
    review_rework_preemption_id: preemptionId,
    preempted_source_claim_sha256: sourceDigest,
    preempted_at: now,
    status_history: [...(Array.isArray(currentClaim.status_history) ? currentClaim.status_history : []), {
      status: 'review_rework_derivative_preempted',
      updated_at: now,
      note: 'unapplied todo-decomposition derivative was archived so the exact changes-requested root could resume'
    }]
  };
  if (!fs.existsSync(archivePath)) atomicJson(archivePath, archived);
  const archiveDigest = sha256(readText(archivePath));
  const audit = {
    schema_version: 1,
    record_type: 'review_rework_unapplied_derivative_preemption',
    preemption_id: preemptionId,
    state: 'preempted',
    recovery_id: source.lineage_source.recovery_id,
    root_claim_id: source.lineage_source.claim_id,
    root_selected_todo_sha256: source.lineage_source.selected_todo_sha256,
    derivative_claim_id: currentClaim.claim_id,
    derivative_root_claim_id: currentClaim.root_claim_id,
    derivative_selected_todo_sha256: sha256(currentClaim.selected_todo.trimEnd()),
    derivative_source_todo_id: eligibility.source_todo_id,
    derivative_todo_id: eligibility.derivative_todo_id,
    source_claim_sha256: sourceDigest,
    archive_path: path.relative(root, archivePath),
    archive_sha256: archiveDigest,
    execution_evidence_path: eligibility.execution_path,
    execution_evidence_sha256: eligibility.execution_sha256,
    progress_state_path: eligibility.progress_path,
    progress_state_sha256: eligibility.progress_sha256,
    execution_attestation: eligibility.execution_attestation,
    progress_attestation: eligibility.progress_attestation,
    preempted_at: now
  };
  if (!fs.existsSync(auditPath)) atomicJson(auditPath, audit);
  const stillCurrent = fs.existsSync(currentClaimPath) ? readText(currentClaimPath) : null;
  if (stillCurrent != null && sha256(stillCurrent) === sourceDigest) {
    fs.unlinkSync(currentClaimPath);
  } else if (stillCurrent != null) {
    throw new Error('review_rework_derivative_preemption_current_claim_changed');
  }
  return {
    eligible: true,
    preempted: true,
    preemption_id: preemptionId,
    preemption_audit_path: path.relative(root, auditPath),
    derivative_archive_path: path.relative(root, archivePath)
  };
}

function auditedDerivativePreemption({ root, stateRoot, identity, input }) {
  const directory = path.join(stateRoot, 'review-rework-derivative-preemptions');
  if (!fs.existsSync(directory)) return null;
  const matches = fs.readdirSync(directory)
    .filter((entry) => /^[a-f0-9]{24}\.json$/u.test(entry))
    .sort()
    .map((entry) => ({ path: path.join(directory, entry), value: readJson(path.join(directory, entry)) }))
    .filter(({ value }) => (
      value?.schema_version === 1
      && value?.record_type === 'review_rework_unapplied_derivative_preemption'
      && value?.state === 'preempted'
      && value?.recovery_id === identity.recoveryId
      && value?.root_claim_id === input.claimId
      && value?.root_selected_todo_sha256 === sha256(input.selected)
    ));
  if (matches.length > 1) throw new Error('review_rework_derivative_preemption_ambiguous');
  if (matches.length === 0) return null;
  const match = matches[0];
  const archivePath = existingRepositoryRelativePath(root, match.value.archive_path, 'derivative_preemption_archive');
  if (typeof match.value.archive_sha256 !== 'string'
    || match.value.archive_sha256 !== sha256(readText(path.resolve(root, archivePath)))) {
    throw new Error('review_rework_derivative_preemption_archive_digest_mismatch');
  }
  const archived = readJson(path.resolve(root, archivePath));
  if (archived?.status !== 'review_rework_derivative_preempted'
    || archived?.claim_id !== match.value.derivative_claim_id
    || archived?.root_claim_id !== match.value.derivative_root_claim_id
    || sha256(archived?.selected_todo?.trimEnd()) !== match.value.derivative_selected_todo_sha256
    || archived?.preempted_source_claim_sha256 !== match.value.source_claim_sha256
    || archived?.archive_reason !== 'unapplied_todo_decomposition_derivative_preempted_by_changes_requested_root'
    || lineValue(archived?.selected_todo, 'Route') !== 'todo-decomposition'
    || sourceTodoId(archived?.selected_todo) !== todoId(input.selected)) {
    throw new Error('review_rework_derivative_preemption_archive_invalid');
  }
  if (
    match.value.execution_attestation?.task_execution_confirmed !== true
    || match.value.execution_attestation?.stop_class !== 'continuation_required'
    || match.value.execution_attestation?.stop_reason !== 'objective_proposal_candidate_ready'
    || match.value.progress_attestation?.workspace_changed !== false
    || match.value.progress_attestation?.claim_id !== match.value.derivative_claim_id
    || match.value.progress_attestation?.projection_claim_id !== match.value.derivative_claim_id
    || match.value.progress_attestation?.objective_apply_pending !== true
    || match.value.progress_attestation?.objective_apply_authorization_consumed !== false
    || String(match.value.progress_attestation?.applied ?? '').trim()
    || match.value.progress_attestation?.selected_todo_still_pending_in_queue !== true
  ) {
    throw new Error('review_rework_derivative_preemption_execution_attestation_invalid');
  }
  return {
    preemption_id: match.value.preemption_id,
    audit_path: path.relative(root, match.path),
    archive_path: archivePath,
    archived_claim: archived
  };
}

// A CHANGES_REQUESTED receipt is a durable causal obligation. If a later
// terminal claim has replaced its root, reattach the exact audited root before
// any normal claim selection or no-op completion fallback can run. Missing or
// ambiguous lineage is intentionally an executable error: continuing would
// turn a rejected implementation into a fresh-looking claim.
export function reconcilePersistedReviewRework({
  repoRoot,
  todoPath = defaultTodo,
  breakdownPath = defaultBreakdown,
  statePath = defaultState,
  actorDeploymentPath,
  actorDeployment,
  now = new Date().toISOString()
}) {
  const root = path.resolve(repoRoot);
  const stateRoot = path.resolve(root, statePath);
  const feedbackPath = path.join(stateRoot, 'todo-repair-feedback.json');
  if (!fs.existsSync(feedbackPath)) {
    return { schema_version: 1, applicable: false, reason: 'review_rework_feedback_absent' };
  }
  const feedback = readJson(feedbackPath);
  const identity = reviewReworkFeedbackIdentity(feedback);
  if (feedback.completed === true) {
    completedReviewReworkFeedbackValid({ root, feedback, identity });
    return { schema_version: 1, applicable: false, reason: 'review_rework_feedback_already_resolved' };
  }
  const currentClaimPath = path.join(stateRoot, 'todo-claims', 'current.json');
  let currentClaim = fs.existsSync(currentClaimPath) ? readJson(currentClaimPath) : null;
  const todoText = readText(path.resolve(root, todoPath));
  const resolvedDelivery = currentClaim
    ? resolvedReviewReworkDelivery({ currentClaim, identity, todoText })
    : { valid: false };
  if (resolvedDelivery.valid) {
    return resolvePersistedReviewReworkFeedback({
      root,
      stateRoot,
      feedbackPath,
      feedback,
      identity,
      currentClaim,
      now
    });
  }
  const source = persistedReviewReworkSource({
    root,
    stateRoot,
    feedbackPath,
    feedback,
    identity,
    now
  });
  const independent = independentDurableCompletion({ root, stateRoot, identity, source });
  if (independent) {
    return terminalizeReviewReworkObviatedByIndependentCompletion({
      root,
      stateRoot,
      feedbackPath,
      feedback,
      identity,
      source,
      currentClaim,
      todoText,
      independent,
      todoPath,
      breakdownPath,
      now
    });
  }
  if (currentClaim && isLiveMatchingReviewReworkClaim({
    root,
    stateRoot,
    currentClaim,
    claimId: identity.claimId,
    selected: currentClaim.selected_todo,
    recoveryId: identity.recoveryId
  }) && currentClaimMatchesReviewReworkFeedback({ currentClaim, identity })) {
    const freshDispatch = ensureReviewReworkFreshDispatch({
      root,
      stateRoot,
      currentClaimPath,
      currentClaim,
      claimId: identity.claimId,
      selected: currentClaim.selected_todo,
      recoveryId: identity.recoveryId,
      prUrl: identity.prUrl,
      reviewer: identity.reviewer,
      now
    });
    return {
      schema_version: 1,
      applicable: false,
      reason: 'review_rework_live_root_preserved',
      feedback_path: path.relative(root, feedbackPath),
      ...freshDispatch
    };
  }
  let derivativePreemption = null;
  if (currentClaim && sha256(currentClaim.selected_todo) !== sha256(source.selected_todo)) {
    derivativePreemption = preemptUnappliedReviewReworkDerivative({
      root,
      stateRoot,
      currentClaimPath,
      currentClaim,
      source,
      todoText,
      now
    });
    if (!derivativePreemption.preempted) {
      throw new Error(derivativePreemption.reason === 'active_derivative_has_applied_or_unverifiable_execution'
        ? 'review_rework_lineage_active_derivative_not_safely_preemptible'
        : 'review_rework_lineage_selected_todo_mismatch');
    }
    currentClaim = null;
  }
  if (!currentClaim) {
    const audited = auditedDerivativePreemption({
      root,
      stateRoot,
      identity,
      input: {
        claimId: identity.claimId,
        selected: source.selected_todo
      }
    });
    if (!audited) throw new Error('review_rework_lineage_current_claim_missing');
  }
  const recovered = recoverLegacyRejectedCompletion({
    repoRoot: root,
    todoPath,
    breakdownPath,
    statePath,
    completionPath: source.completion_path,
    snapshotPath: source.snapshot_path,
    reviewReceiptPath: source.review_receipt_path,
    actorDeploymentPath,
    actorDeployment,
    now
  });
  return {
    schema_version: 1,
    applicable: true,
    lineage_source_claim_path: source.source_claim_path,
    lineage_source_migrated: source.migrated,
    lineage_source_migration_audit_path: source.lineage_migration_audit_path ?? null,
    feedback_path: path.relative(root, feedbackPath),
    ...(derivativePreemption?.preempted ? {
      derivative_preemption_id: derivativePreemption.preemption_id,
      derivative_preemption_audit_path: derivativePreemption.preemption_audit_path,
      derivative_archive_path: derivativePreemption.derivative_archive_path
    } : {}),
    ...recovered
  };
}

function isAuditedPartialInitialRecovery({ stateRoot, todoText, input, review, currentClaim, invalidation, recoveryId }) {
  if (findBlock(todoText, input.targetId)) return false;
  const recoverableCurrentStatus = currentClaim == null
    || ['failed', 'integrity_blocked', 'stale_snapshot_rejected'].includes(currentClaim.status);
  if (!recoverableCurrentStatus || currentClaim?.delivery_review != null) return false;
  const todoSnapshotPath = path.join(stateRoot, 'legacy-completion-recoveries', `${recoveryId}.todo-before.md`);
  if (!fs.existsSync(todoSnapshotPath)) return false;
  let snapshotMatches;
  try {
    snapshotMatches = sha256(readText(todoSnapshotPath)) === sha256(todoText);
  } catch {
    return false;
  }
  return Boolean(
    snapshotMatches
    && invalidation?.schema_version === 1
    && invalidation.record_type === 'todo_completion_invalidation'
    && invalidation.selected_todo_id === input.targetId
    && invalidation.invalidated_completion_claim_id === input.claimId
    && invalidation.reason === 'legacy_completion_rejected_by_independent_review'
    && invalidation.recovery_id === recoveryId
    && invalidation.pr_url === review.pr_url
    && invalidation.review_state === review.latest_review.state
    && invalidation.review_head_sha === review.head_sha
  );
}

// A rejected implementation retains its root claim id by design.  If an older
// controller nevertheless terminalized that root's ledger attempt, the next
// dispatch needs a distinct immutable task identity.  This creates it only
// from the exact terminal event already in the append-only ledger and records
// the relationship before publishing it in the claim.  It never rewrites the
// historical attempt and it never mints an identity for a non-terminal or
// mismatched source.
function establishReviewReworkLedgerAttempt({ root, stateRoot, currentClaim, claimId, selected, recoveryId }) {
  const sourceTodoId = todoId(selected);
  const selectedTodoSha256 = sha256(selected);
  if (!sourceTodoId || sha256(currentClaim?.selected_todo) !== selectedTodoSha256) {
    throw new Error('review_rework_ledger_attempt_selected_todo_invalid');
  }
  const sourceTaskId = taskAttemptId(sourceTodoId, claimId);
  const existing = currentClaim?.review_rework_ledger_attempt;
  let events;
  try {
    events = readTaskLedger(root);
  } catch (error) {
    throw new Error(`review_rework_ledger_attempt_ledger_unreadable:${error.message}`);
  }
  const terminal = taskProjection(events).get(sourceTaskId);
  if (!terminal) {
    if (existing != null) throw new Error('review_rework_ledger_attempt_source_missing');
    return { claim: currentClaim, required: false, established: false };
  }
  if (!isTerminalTaskState(terminal.to_state)) {
    if (existing != null) throw new Error('review_rework_ledger_attempt_source_not_terminal');
    return { claim: currentClaim, required: false, established: false };
  }
  const sourceEvent = events.find((event) => (
    event?.task_id === sourceTaskId && event?.event_id === terminal.event_id
  ));
  if (!sourceEvent
    || terminal.claim_id !== claimId
    || terminal.task_spec_sha256 !== selectedTodoSha256
    || !terminal.event_id) {
    throw new Error('review_rework_ledger_attempt_source_provenance_invalid');
  }
  const sourceTerminalEventSha256 = sha256(JSON.stringify(sourceEvent));
  const ledgerAttemptId = reviewReworkLedgerAttemptId({
    sourceTaskId,
    recoveryId,
    sourceTerminalEventId: terminal.event_id,
    selectedTodoSha256
  });
  const audit = {
    schema_version: 1,
    record_type: 'review_rework_terminal_attempt_isolation',
    recovery_id: recoveryId,
    root_claim_id: claimId,
    selected_todo_sha256: selectedTodoSha256,
    source_task_id: sourceTaskId,
    source_terminal_event_id: terminal.event_id,
    source_terminal_event_sha256: sourceTerminalEventSha256,
    source_terminal_state: terminal.to_state,
    source_task_spec_sha256: selectedTodoSha256,
    ledger_attempt_id: ledgerAttemptId
  };
  const auditId = sha256(JSON.stringify(audit)).slice(0, 24);
  const auditPath = path.join(stateRoot, 'review-rework-ledger-attempts', `${auditId}.json`);
  if (fs.existsSync(auditPath)) {
    const persisted = readJson(auditPath);
    if (!jsonStructurallyEqual(persisted, audit)) {
      throw new Error('review_rework_ledger_attempt_audit_conflict');
    }
  } else {
    atomicJson(auditPath, audit);
  }
  const auditRelativePath = path.relative(root, auditPath);
  const binding = {
    schema_version: 1,
    kind: 'review_rework_terminal_attempt_isolation',
    recovery_id: recoveryId,
    root_claim_id: claimId,
    selected_todo_sha256: selectedTodoSha256,
    source_task_id: sourceTaskId,
    source_terminal_event_id: terminal.event_id,
    source_terminal_event_sha256: sourceTerminalEventSha256,
    source_task_spec_sha256: selectedTodoSha256,
    ledger_attempt_id: ledgerAttemptId,
    audit_path: auditRelativePath,
    audit_sha256: sha256(readText(auditPath))
  };
  if (existing != null && !jsonStructurallyEqual(existing, binding)) {
    throw new Error('review_rework_ledger_attempt_binding_conflict');
  }
  return {
    claim: existing == null ? { ...currentClaim, review_rework_ledger_attempt: binding } : currentClaim,
    required: true,
    established: existing == null,
    ledger_attempt_id: ledgerAttemptId,
    source_task_id: sourceTaskId,
    audit_path: auditRelativePath
  };
}

function ensureReviewReworkFreshDispatch({
  root,
  stateRoot,
  currentClaimPath,
  currentClaim,
  claimId,
  selected,
  recoveryId,
  prUrl,
  reviewer,
  now
}) {
  const sameRecoveredClaim = isLiveMatchingReviewReworkClaim({ root, stateRoot, currentClaim, claimId, selected, recoveryId });
  if (!sameRecoveredClaim) {
    throw new Error('idempotent_recovery_requires_live_matching_review_rework_claim');
  }
  const ledgerAttempt = establishReviewReworkLedgerAttempt({
    root,
    stateRoot,
    currentClaim,
    claimId,
    selected,
    recoveryId
  });
  currentClaim = ledgerAttempt.claim;
  if (ledgerAttempt.established) atomicJson(currentClaimPath, currentClaim);
  const ledgerAttemptEvidence = ledgerAttempt.required ? {
    review_rework_ledger_attempt_isolated: true,
    review_rework_ledger_attempt_id: ledgerAttempt.ledger_attempt_id,
    review_rework_ledger_attempt_audit_path: ledgerAttempt.audit_path
  } : { review_rework_ledger_attempt_isolated: false };
  const rearmEvidence = reviewReworkRearmEvidence({ root, stateRoot, currentClaim });
  if (rearmEvidence) {
    const rearmHistory = Array.isArray(currentClaim.review_rework_fresh_dispatch_rearm_history)
      ? currentClaim.review_rework_fresh_dispatch_rearm_history
      : [];
    // One re-arm repairs the controller's own premature completion attempt.
    // A second rejection of the replacement run is no longer safe to replay:
    // preserve the claim and make the failure executable instead of creating an
    // unbounded recovery loop.
    if (rearmHistory.length >= 1) {
      throw new Error('review_rework_fresh_dispatch_rearm_limit_exceeded');
    }
    const priorAttempt = Number.isInteger(currentClaim.review_rework_fresh_dispatch_attempt)
      ? currentClaim.review_rework_fresh_dispatch_attempt
      : 1;
    const dispatchAttempt = priorAttempt + 1;
    const auditPath = path.join(
      stateRoot,
      'legacy-completion-fresh-dispatch-repairs',
      `${recoveryId}-rearm-${dispatchAttempt}.json`
    );
    const audit = {
      schema_version: 1,
      record_type: 'legacy_completion_review_rework_completion_refusal_rearm',
      recovery_id: recoveryId,
      claim_id: claimId,
      pr_url: prUrl,
      reviewer,
      dispatch_attempt: dispatchAttempt,
      prior_activated_run_stamp: currentClaim.review_rework_fresh_dispatch_activated_run_stamp ?? null,
      reason: rearmEvidence.reason,
      evidence: rearmEvidence.audit,
      rearmed_at: now
    };
    if (!fs.existsSync(auditPath)) atomicJson(auditPath, audit);
    const { completion_certificate: _discardedCertificate, ...withoutCertificate } = currentClaim;
    const rearmedClaim = {
      ...withoutCertificate,
      status: 'in_progress',
      review_rework_fresh_dispatch_pending: true,
      review_rework_fresh_dispatch_recovery_id: recoveryId,
      review_rework_fresh_dispatch_reason: rearmEvidence.reason,
      review_rework_fresh_dispatch_requested_at: now,
      review_rework_fresh_dispatch_attempt: dispatchAttempt,
      review_rework_fresh_dispatch_rearm_history: [...rearmHistory, {
        rearmed_at: now,
        dispatch_attempt: dispatchAttempt,
        prior_activated_run_stamp: currentClaim.review_rework_fresh_dispatch_activated_run_stamp ?? null,
        audit_path: path.relative(root, auditPath),
        reason: rearmEvidence.reason,
        evidence: rearmEvidence.audit
      }],
      status_history: [
        ...(Array.isArray(currentClaim.status_history) ? currentClaim.status_history : []),
        {
          status: 'in_progress',
          updated_at: now,
          note: `review-rework ${rearmEvidence.reason} rearmed one fresh Runtime dispatch`
        }
      ],
      updated_at: now
    };
    atomicJson(currentClaimPath, rearmedClaim);
    return {
      fresh_runtime_dispatch_required: true,
      fresh_runtime_dispatch_marker_restored: true,
      fresh_runtime_dispatch_rearmed: true,
      fresh_runtime_dispatch_rearm_reason: rearmEvidence.reason,
      fresh_runtime_dispatch_attempt: dispatchAttempt,
      fresh_runtime_dispatch_rearm_audit_path: path.relative(root, auditPath),
      ...ledgerAttemptEvidence
    };
  }
  if (typeof currentClaim.review_rework_fresh_dispatch_activated_run_stamp === 'string'
    && currentClaim.review_rework_fresh_dispatch_activated_run_stamp) {
    return {
      fresh_runtime_dispatch_required: false,
      fresh_runtime_dispatch_marker_restored: false,
      fresh_runtime_dispatch_activated_run_stamp: currentClaim.review_rework_fresh_dispatch_activated_run_stamp,
      ...ledgerAttemptEvidence
    };
  }
  if (currentClaim.review_rework_fresh_dispatch_pending === true) {
    const dispatchAttempt = Number.isSafeInteger(currentClaim.review_rework_fresh_dispatch_attempt)
      && currentClaim.review_rework_fresh_dispatch_attempt >= 1
      ? currentClaim.review_rework_fresh_dispatch_attempt
      : 1;
    if (currentClaim.review_rework_fresh_dispatch_attempt !== dispatchAttempt) {
      const auditPath = path.join(
        stateRoot,
        'legacy-completion-fresh-dispatch-repairs',
        `${recoveryId}-dispatch-attempt-${dispatchAttempt}.json`
      );
      const audit = {
        schema_version: 1,
        record_type: 'legacy_completion_review_rework_fresh_dispatch_attempt_repair',
        recovery_id: recoveryId,
        claim_id: claimId,
        dispatch_attempt: dispatchAttempt,
        reason: 'legacy_fresh_dispatch_marker_missing_generation_identity',
        repaired_at: now,
      };
      if (!fs.existsSync(auditPath)) atomicJson(auditPath, audit);
      atomicJson(currentClaimPath, {
        ...currentClaim,
        review_rework_fresh_dispatch_attempt: dispatchAttempt,
        review_rework_fresh_dispatch_attempt_repair: {
          schema_version: 1,
          dispatch_attempt: dispatchAttempt,
          audit_path: path.relative(root, auditPath),
          repaired_at: now,
        },
        updated_at: now,
      });
      return {
        fresh_runtime_dispatch_required: true,
        fresh_runtime_dispatch_marker_restored: true,
        fresh_runtime_dispatch_attempt: dispatchAttempt,
        fresh_runtime_dispatch_attempt_repair_audit_path: path.relative(root, auditPath),
        ...ledgerAttemptEvidence
      };
    }
    return {
      fresh_runtime_dispatch_required: true,
      fresh_runtime_dispatch_marker_restored: false,
      fresh_runtime_dispatch_attempt: dispatchAttempt,
      ...ledgerAttemptEvidence
    };
  }

  // v1 recovery records created before this marker existed can be repaired
  // only while their exact root claim remains live.  Record the repair before
  // publishing it, so a crash is auditable and rerunning is deterministic.
  const auditPath = path.join(stateRoot, 'legacy-completion-fresh-dispatch-repairs', `${recoveryId}.json`);
  const audit = {
    schema_version: 1,
    record_type: 'legacy_completion_review_rework_fresh_dispatch_repair',
    recovery_id: recoveryId,
    claim_id: claimId,
    pr_url: prUrl,
    reviewer,
    reason: 'legacy_review_rework_claim_had_no_fresh_dispatch_marker',
    repaired_at: now
  };
  if (!fs.existsSync(auditPath)) atomicJson(auditPath, audit);
  const repairedClaim = {
    ...currentClaim,
    review_rework_fresh_dispatch_pending: true,
    review_rework_fresh_dispatch_recovery_id: recoveryId,
    review_rework_fresh_dispatch_reason: 'legacy_completion_rejected_by_independent_review',
    review_rework_fresh_dispatch_requested_at: now,
    review_rework_fresh_dispatch_attempt: 1,
    status_history: [
      ...(Array.isArray(currentClaim.status_history) ? currentClaim.status_history : []),
      {
        status: 'fresh_runtime_dispatch_required',
        updated_at: now,
        note: 'review-rework recovery invalidated a stale Runtime continuation and requires an admitted fresh run'
      }
    ],
    updated_at: now
  };
  atomicJson(currentClaimPath, repairedClaim);
  return {
    fresh_runtime_dispatch_required: true,
    fresh_runtime_dispatch_marker_restored: true,
    fresh_runtime_dispatch_repair_audit_path: path.relative(root, auditPath),
    ...ledgerAttemptEvidence
  };
}

export function recoverLegacyRejectedCompletion({
  repoRoot,
  todoPath = defaultTodo,
  breakdownPath = defaultBreakdown,
  statePath = defaultState,
  completionPath,
  snapshotPath,
  reviewReceiptPath,
  actorDeploymentPath,
  actorDeployment,
  now = new Date().toISOString()
}) {
  const root = path.resolve(repoRoot);
  const actors = recoveryActors({ repoRoot: root, actorDeploymentPath, actorDeployment });
  const expectedAuthor = actors.implementation;
  const expectedReviewer = actors.review;
  const todoFile = path.resolve(root, todoPath);
  const breakdownFile = path.resolve(root, breakdownPath);
  const stateRoot = path.resolve(root, statePath);
  const completionFile = path.resolve(root, completionPath);
  const snapshotFile = path.resolve(root, snapshotPath);
  const reviewFile = path.resolve(root, reviewReceiptPath);
  const completion = readJson(completionFile);
  const snapshot = readJson(snapshotFile);
  const review = readJson(reviewFile);
  const todoText = readText(todoFile);
  const currentClaimPath = path.join(stateRoot, 'todo-claims', 'current.json');
  const preliminaryClaimId = typeof completion?.claim_id === 'string' ? completion.claim_id : '';
  const preliminaryTargetId = typeof completion?.selected_todo_id === 'string' ? completion.selected_todo_id : '';
  const preliminarySelected = typeof snapshot?.selected_todo === 'string' ? snapshot.selected_todo.trimEnd() : '';
  const preliminaryReview = reviewRejectionValid(review, expectedAuthor, expectedReviewer);
  const preliminaryRecoveryId = preliminaryClaimId && preliminarySelected && preliminaryReview.valid
    ? sha256(`${preliminaryClaimId}\n${sha256(preliminarySelected)}\n${review.pr_url}\n${review.head_sha}`).slice(0, 24)
    : '';
  const existingInvalidations = readTodoCompletionInvalidationRecords(root);
  if (preliminaryTargetId && findBlock(todoText, preliminaryTargetId)) {
    const alreadyRecovered = existingInvalidations.some((record) => (
      record.selected_todo_id === preliminaryTargetId
      && record.invalidated_completion_claim_id === preliminaryClaimId
    ));
    if (alreadyRecovered) {
      const currentClaim = fs.existsSync(currentClaimPath) ? readJson(currentClaimPath) : null;
      if (!isLiveMatchingReviewReworkClaim({
        root,
        stateRoot,
        currentClaim,
        claimId: preliminaryClaimId,
        selected: preliminarySelected,
        recoveryId: preliminaryRecoveryId
      })) {
        // A prior recovery may itself have been displaced by a stale
        // rebaseline.  Fall through to the audited restoration path below;
        // it refuses an active foreign claim and archives any terminal one.
      } else {
      const freshDispatch = ensureReviewReworkFreshDispatch({
        root,
        stateRoot,
        currentClaimPath,
        currentClaim,
        claimId: preliminaryClaimId,
        selected: preliminarySelected,
        recoveryId: preliminaryRecoveryId,
        prUrl: review.pr_url,
        reviewer: expectedReviewer,
        now
      });
      return {
        schema_version: 1,
        recovered: false,
        idempotent_recovery: true,
        recovery_id: preliminaryRecoveryId,
        claim_id: preliminaryClaimId,
        selected_todo_id: preliminaryTargetId,
        pr_url: review.pr_url,
        ...freshDispatch
      };
      }
    }
  }
  const alreadyInvalidatedPrecheck = existingInvalidations.some((record) => (
    record.selected_todo_id === preliminaryTargetId
    && record.invalidated_completion_claim_id === preliminaryClaimId
  ));
  const input = assertRecoveryInputs({
    completion,
    snapshot,
    review,
    todoText,
    expectedAuthor,
    expectedReviewer,
    allowLiveTarget: alreadyInvalidatedPrecheck
  });
  const invalidations = existingInvalidations;
  const alreadyInvalidated = invalidations.some((record) => (
    record.selected_todo_id === input.targetId && record.invalidated_completion_claim_id === input.claimId
  ));
  const invalidation = invalidations.find((record) => (
    record.selected_todo_id === input.targetId && record.invalidated_completion_claim_id === input.claimId
  ));
  const recoveryId = sha256(`${input.claimId}\n${sha256(input.selected)}\n${review.pr_url}\n${review.head_sha}`).slice(0, 24);
  const currentClaim = fs.existsSync(currentClaimPath) ? readJson(currentClaimPath) : null;
  const derivativePreemption = alreadyInvalidated && currentClaim == null
    ? auditedDerivativePreemption({
      root,
      stateRoot,
      identity: { recoveryId },
      input
    })
    : null;
  const currentStatus = currentClaim?.status;
  // A claim awaiting review, or carrying newly requested changes, has a
  // durable PR handoff that phase-loop.sh must reconcile.  It is neither a
  // terminal displacement nor a recoverable copy of an earlier rejection;
  // replacing it would discard the current delivery evidence and restart
  // implementation before that review is resolved.
  if (['pr_pending_review', 'changes_requested'].includes(currentStatus)) {
    throw new Error('review_pending_claim_must_be_preserved_before_legacy_recovery');
  }
  if (['claimed', 'in_progress', 'running'].includes(currentStatus)) {
    if (!(currentClaim?.claim_id === input.claimId && currentClaim?.legacy_completion_recovery?.recovery_id === recoveryId)) {
      throw new Error('active_claim_must_be_preserved_before_legacy_recovery');
    }
  }
  const partialInitialRecovery = alreadyInvalidated && isAuditedPartialInitialRecovery({
    stateRoot,
    todoText,
    input,
    review,
    currentClaim,
    invalidation,
    recoveryId
  });
  if (alreadyInvalidated && !isLiveMatchingReviewReworkClaim({
    root,
    stateRoot,
    currentClaim,
    claimId: input.claimId,
    selected: input.selected,
    recoveryId
  }) && !isProvenTerminalDisplacement({
    currentClaim,
    claimId: input.claimId,
    selected: input.selected,
    invalidation
  }) && !partialInitialRecovery && !derivativePreemption) {
    throw new Error('idempotent_recovery_requires_proven_terminal_displacement');
  }

  const restoredParent = replaceCheckbox(input.parent, false);
  let restoredTodo = todoText;
  const existingTarget = findBlock(restoredTodo, input.targetId);
  if (existingTarget) {
    if (sha256(existingTarget) !== sha256(input.selected)) {
      throw new Error('recovery_existing_target_does_not_match_immutable_snapshot');
    }
    const existingParent = findBlock(restoredTodo, input.parentId);
    if (!existingParent || !/^(?:[-*]|\d+[.)])\s+\[ \]\s+/mu.test(existingParent)) {
      throw new Error('recovery_existing_target_requires_unchecked_source_parent');
    }
  } else {
    if (restoredParent !== input.parent) {
      const parentIndex = restoredTodo.indexOf(input.parent);
      if (parentIndex < 0) throw new Error('legacy_source_parent_not_unique');
      restoredTodo = `${restoredTodo.slice(0, parentIndex)}${restoredParent}${restoredTodo.slice(parentIndex + input.parent.length)}`;
    }
    restoredTodo = insertAfterBlock(restoredTodo, restoredParent, input.selected);
  }

  const proposedInvalidation = {
    schema_version: 1,
    record_type: 'todo_completion_invalidation',
    selected_todo_id: input.targetId,
    invalidated_completion_claim_id: input.claimId,
    reason: 'legacy_completion_rejected_by_independent_review',
    recovery_id: recoveryId,
    pr_url: review.pr_url,
    review_state: review.latest_review.state,
    review_head_sha: review.head_sha,
    invalidated_at: now
  };
  const completionRecords = readTodoCompletionRecords(root);
  // The original schema-v1 completion and a derived historical receipt are
  // different append-only records.  Retract the latter only when its durable
  // receipt explicitly names this rejected root as its historical parent;
  // matching a TODO id alone is never sufficient.
  const dependentDerivedInvalidations = completionRecords
    .filter((record) => (
      record?.record_type === 'derived_historical_delivery_attestation'
      && record?.selected_todo_id === input.targetId
      && record?.root_claim_id === input.claimId
      && record?.delivery_receipt?.historical_delivery_evidence?.parent_claim_id === input.claimId
      && durableCompletionRecordReceipt(record).valid
    ))
    .map((record) => ({
      schema_version: 1,
      record_type: 'todo_completion_invalidation',
      selected_todo_id: input.targetId,
      invalidated_completion_claim_id: record.claim_id,
      reason: 'legacy_completion_rejected_causally_dependent_derived_receipt',
      recovery_id: recoveryId,
      root_completion_claim_id: input.claimId,
      pr_url: review.pr_url,
      review_state: review.latest_review.state,
      review_head_sha: review.head_sha,
      invalidated_at: now
    }));
  const proposedInvalidations = [proposedInvalidation, ...dependentDerivedInvalidations];
  const newInvalidations = proposedInvalidations.filter((proposal) => !invalidations.some((record) => (
    record.selected_todo_id === proposal.selected_todo_id
    && record.invalidated_completion_claim_id === proposal.invalidated_completion_claim_id
  )));
  const replanRecords = readAllTodoReplanRecords(root, { breakdownPath: breakdownFile });
  const stateAfter = resolveTodoState({
    todoText: restoredTodo,
    replanRecords,
    completionRecords,
    completionInvalidationRecords: [...invalidations, ...newInvalidations]
  });
  const queueValidation = validateTodoQueueIntegrity({
    todoBefore: todoText,
    todoAfter: restoredTodo,
    afterBreakdownText: fs.existsSync(breakdownFile) ? readText(breakdownFile) : null,
    completedTodoIds: [...stateAfter.completedIds],
    unverifiedArchivedCompletionRecords: stateAfter.unverifiedCompletionRecords
      .filter((record) => stateAfter.unverifiedArchivedCompletionIds.has(record.selected_todo_id)),
    todoReplanRecords: replanRecords
  });
  if (!queueValidation.valid) {
    throw new Error(`recovery_queue_validation_failed:${queueValidation.errors.map((error) => error.code).join(',')}`);
  }

  const recoveryDir = path.join(stateRoot, 'legacy-completion-recoveries');
  const invalidationPath = path.join(stateRoot, 'todo-completion-invalidations', `${input.claimId}-${recoveryId}.json`);
  const dependentInvalidationPaths = dependentDerivedInvalidations.map((proposal) => path.join(
    stateRoot,
    'todo-completion-invalidations',
    `${proposal.invalidated_completion_claim_id}-${recoveryId}.json`
  ));
  const displacedClaimDigest = currentClaim ? sha256(JSON.stringify(currentClaim)).slice(0, 16) : null;
  const idempotentDisplacement = alreadyInvalidated && currentClaim != null && !partialInitialRecovery && !isLiveMatchingReviewReworkClaim({
    root,
    stateRoot,
    currentClaim,
    claimId: input.claimId,
    selected: input.selected,
    recoveryId
  });
  const archiveSuffix = idempotentDisplacement
    ? `displaced-after-idempotent-${displacedClaimDigest}`
    : 'current-before';
  const currentArchivePath = path.join(stateRoot, 'todo-claims', `legacy-completion-recovery-${recoveryId}-${archiveSuffix}.json`);
  const auditPath = path.join(recoveryDir, idempotentDisplacement
    ? `${recoveryId}-idempotent-displacement-${displacedClaimDigest}.json`
    : `${recoveryId}.json`);
  const todoSnapshotPath = path.join(recoveryDir, `${recoveryId}.todo-before.md`);
  const feedbackPath = path.join(stateRoot, 'todo-repair-feedback.json');
  const feedbackIdentity = {
    claimId: input.claimId,
    recoveryId,
    selectedTodoSha256: sha256(input.selected)
  };
  const feedbackInputs = {
    completion_path: path.relative(root, completionFile),
    snapshot_path: path.relative(root, snapshotFile),
    review_receipt_path: path.relative(root, reviewFile),
    selected_todo_sha256: sha256(input.selected)
  };
  const existingFeedback = fs.existsSync(feedbackPath) ? readJson(feedbackPath) : null;
  let lineageSource = immutableLineageSource({
    root,
    identity: feedbackIdentity,
    inputs: feedbackInputs,
    establishedAt: now,
    establishedBy: 'legacy_completion_recovery'
  });
  let lineageSourceMigration = null;
  if (existingFeedback != null) {
    const existingIdentity = reviewReworkFeedbackIdentity(existingFeedback);
    if (existingIdentity.claimId !== input.claimId
      || existingIdentity.recoveryId !== recoveryId
      || existingIdentity.selectedTodoSha256 !== feedbackIdentity.selectedTodoSha256) {
      throw new Error('review_rework_lineage_existing_feedback_identity_mismatch');
    }
    const existingLineage = verifiedImmutableLineageSource({
      root,
      feedback: existingFeedback,
      identity: existingIdentity
    });
    if (existingLineage) {
      lineageSource = existingLineage.lineage_source;
      lineageSourceMigration = existingFeedback.lineage_source_migration ?? null;
    }
  }
  let restoredClaim = {
    schema_version: 1,
    claim_id: input.claimId,
    root_claim_id: input.claimId,
    status: 'in_progress',
    selected_todo: input.selected,
    selected_todo_sha256: sha256(input.selected),
    queue_fingerprint: sha256(restoredTodo),
    queue_generation: currentClaim?.queue_generation ?? derivativePreemption?.archived_claim?.queue_generation ?? null,
    baseline_todo_text: restoredTodo,
    baseline_diff_files: Array.isArray(currentClaim?.baseline_diff_files)
      ? currentClaim.baseline_diff_files
      : (Array.isArray(derivativePreemption?.archived_claim?.baseline_diff_files)
        ? derivativePreemption.archived_claim.baseline_diff_files
        : []),
    // Review rejection invalidates the prior Runtime continuation, not merely
    // its completion claim.  The controller must issue a fresh `run` and may
    // clear this marker only after that new session is admitted.
    review_rework_fresh_dispatch_pending: true,
    review_rework_fresh_dispatch_recovery_id: recoveryId,
    review_rework_fresh_dispatch_reason: 'legacy_completion_rejected_by_independent_review',
    review_rework_fresh_dispatch_requested_at: now,
    review_rework_fresh_dispatch_attempt: 1,
    legacy_completion_recovery: {
      recovery_id: recoveryId,
      invalidated_completion_claim_id: input.claimId,
      completion_record_path: path.relative(root, completionFile),
      immutable_snapshot_path: path.relative(root, snapshotFile),
      review_receipt_path: path.relative(root, reviewFile),
      pr_url: review.pr_url,
      pr_head_sha: review.head_sha,
      reviewer: expectedReviewer,
      review_state: review.latest_review.state,
      archived_current_claim_path: currentClaim ? path.relative(root, currentArchivePath) : null,
      recovered_at: now
    },
    review_rework: {
      required: true,
      reviewer: expectedReviewer,
      state: review.latest_review.state,
      feedback: review.latest_review.body,
      pr_url: review.pr_url,
      head_sha: review.head_sha
    },
    status_history: [
      {
        status: 'legacy_completion_invalidated',
        updated_at: now,
        note: 'historical completion record lacked a durable delivery receipt and its independently reviewed PR was changes-requested'
      },
      {
        status: 'in_progress',
        updated_at: now,
        note: 'same root claim restored for review-directed reimplementation'
      },
      ...(idempotentDisplacement ? [{
        status: 'legacy_completion_recovery_reasserted',
        updated_at: now,
        note: 'terminal claim that displaced the review-rework root was archived before restoring the same root claim'
      }] : []),
      ...(derivativePreemption ? [{
        status: 'legacy_completion_recovery_reasserted',
        updated_at: now,
        note: 'unapplied todo-decomposition derivative was audit-archived before restoring the changes-requested root claim'
      }] : [])
    ],
    updated_at: now
  };
  const ledgerAttempt = establishReviewReworkLedgerAttempt({
    root,
    stateRoot,
    currentClaim: restoredClaim,
    claimId: input.claimId,
    selected: input.selected,
    recoveryId
  });
  restoredClaim = ledgerAttempt.claim;
  const feedback = {
    schema_version: 1,
    kind: 'phase_loop_review_rework_required',
    completed: false,
    claim_id: input.claimId,
    root_claim_id: input.claimId,
    selected_todo_first_line: input.selected.split('\n')[0],
    reason: 'legacy_completion_rejected_by_independent_review',
    pr_url: review.pr_url,
    reviewer: expectedReviewer,
    review_state: review.latest_review.state,
    review_head_sha: review.head_sha,
    feedback: review.latest_review.body,
    recovery_id: recoveryId,
    recovery_inputs: {
      completion_record_path: feedbackInputs.completion_path,
      immutable_snapshot_path: feedbackInputs.snapshot_path,
      review_receipt_path: feedbackInputs.review_receipt_path,
      selected_todo_sha256: sha256(input.selected)
    },
    lineage_source: lineageSource,
    ...(lineageSourceMigration ? { lineage_source_migration: lineageSourceMigration } : {}),
    fresh_runtime_dispatch_required: true,
    updated_at: now
  };
  const audit = {
    schema_version: 1,
    record_type: 'legacy_completion_recovery',
    recovery_id: recoveryId,
    claim_id: input.claimId,
    selected_todo_id: input.targetId,
    source_parent_todo_id: input.parentId,
    pr_url: review.pr_url,
    review_state: review.latest_review.state,
    reviewer: expectedReviewer,
    completion_record_sha256: sha256(readText(completionFile)),
    snapshot_sha256: sha256(readText(snapshotFile)),
    review_receipt_sha256: sha256(readText(reviewFile)),
    todo_before_sha256: sha256(todoText),
    todo_after_sha256: sha256(restoredTodo),
    archived_current_claim_path: currentClaim ? path.relative(root, currentArchivePath) : null,
    invalidation_path: path.relative(root, invalidationPath),
    fresh_runtime_dispatch_required: true,
    review_rework_ledger_attempt_isolated: ledgerAttempt.required,
    review_rework_ledger_attempt_id: ledgerAttempt.ledger_attempt_id ?? null,
    review_rework_ledger_attempt_audit_path: ledgerAttempt.audit_path ?? null,
    idempotent_displacement: idempotentDisplacement,
    idempotent_partial_initial_recovery: partialInitialRecovery,
    audited_derivative_preemption: derivativePreemption ? {
      preemption_id: derivativePreemption.preemption_id,
      audit_path: derivativePreemption.audit_path,
      archive_path: derivativePreemption.archive_path
    } : null,
    recovered_at: now
  };

  // Write evidence before changing the queue.  A crash leaves the original
  // state plus an immutable audit trail; rerunning with the same inputs is
  // deterministic and never fabricates a different claim.
  if (!fs.existsSync(todoSnapshotPath)) atomicWrite(todoSnapshotPath, todoText, 0o600);
  if (currentClaim && !fs.existsSync(currentArchivePath)) atomicJson(currentArchivePath, currentClaim);
  if (!alreadyInvalidated) atomicJson(invalidationPath, proposedInvalidation);
  for (let index = 0; index < dependentDerivedInvalidations.length; index += 1) {
    const proposal = dependentDerivedInvalidations[index];
    const proposalPath = dependentInvalidationPaths[index];
    if (!fs.existsSync(proposalPath)) atomicJson(proposalPath, proposal);
  }
  atomicJson(auditPath, audit);
  atomicJson(currentClaimPath, restoredClaim);
  atomicJson(feedbackPath, feedback);
  atomicWrite(todoFile, restoredTodo, 0o600);

  return {
    schema_version: 1,
    recovered: true,
    idempotent_recovery: alreadyInvalidated,
    idempotent_partial_initial_recovery: partialInitialRecovery,
    audited_derivative_preemption: Boolean(derivativePreemption),
    recovery_id: recoveryId,
    claim_id: input.claimId,
    selected_todo_id: input.targetId,
    pr_url: review.pr_url,
    fresh_runtime_dispatch_required: true,
    review_rework_ledger_attempt_isolated: ledgerAttempt.required,
    review_rework_ledger_attempt_id: ledgerAttempt.ledger_attempt_id ?? null,
    review_rework_ledger_attempt_audit_path: ledgerAttempt.audit_path ?? null,
    actor_deployment_path: actors.deploymentPath ? path.relative(root, actors.deploymentPath) : null,
    audit_path: path.relative(root, auditPath),
    invalidation_path: path.relative(root, invalidationPath),
    dependent_derived_invalidation_paths: dependentInvalidationPaths.map((entry) => path.relative(root, entry)),
    current_claim_path: path.relative(root, currentClaimPath),
    displaced_claim_archive_path: currentClaim ? path.relative(root, currentArchivePath) : null,
    idempotent_displacement: idempotentDisplacement,
    audited_derivative_preemption: Boolean(derivativePreemption),
    derivative_preemption_audit_path: derivativePreemption?.audit_path ?? null,
    queue_validation: queueValidation
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    const args = parseArgs(process.argv);
    const root = path.resolve(args.repo);
    const result = args.mode === 'detect'
      ? detectLegacyCompletionRecovery({ repoRoot: root, todoPath: args.todo, breakdownPath: args.breakdown })
      : args.mode === 'recover'
        ? recoverLegacyRejectedCompletion({
            repoRoot: root,
            todoPath: args.todo,
            breakdownPath: args.breakdown,
            statePath: args.state,
            completionPath: args.completion,
            snapshotPath: args.snapshot,
            reviewReceiptPath: args.reviewReceipt,
            actorDeploymentPath: args.actorDeployment
          })
        : args.mode === 'reconcile-review-rework'
          ? reconcilePersistedReviewRework({
              repoRoot: root,
              todoPath: args.todo,
              breakdownPath: args.breakdown,
              statePath: args.state,
              actorDeploymentPath: args.actorDeployment
            })
        : args.mode === 'attest'
          ? attestLegacyMergedCompletion({
              repoRoot: root,
              todoPath: args.todo,
              statePath: args.state,
              completionPath: args.completion,
              snapshotPath: args.snapshot,
              mergeReceiptPath: args.mergeReceipt,
              actorDeploymentPath: args.actorDeployment
            })
        : (() => { throw new Error(`unknown_mode:${args.mode}`); })();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      schema_version: 1,
      recovered: false,
      error: error?.message ?? String(error)
    }, null, 2));
    process.exit(76);
  }
}
