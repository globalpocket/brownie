#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { diagnosePhaseLoop } from './phase-loop-supervisor-diagnose.mjs';
import { dispatchSelfUpdate } from './phase-loop-self-update.mjs';
import { loadTodoState } from './phase-loop-todo-state.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {
    repo: defaultRepoRoot,
    write: true,
    repair: true,
    start: false,
    selfUpdateRequest: null,
    workerLaunchReceiptPath: null
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--repo') {
      args.repo = path.resolve(argv[++index]);
    } else if (arg === '--write') {
      args.write = true;
    } else if (arg === '--no-write') {
      args.write = false;
    } else if (arg === '--repair') {
      args.repair = true;
    } else if (arg === '--no-repair') {
      args.repair = false;
    } else if (arg === '--start') {
      args.start = true;
    } else if (arg === '--no-start') {
      args.start = false;
    } else if (arg === '--self-update-request') {
      args.selfUpdateRequest = argv[++index];
    } else if (arg === '--worker-launch-receipt') {
      args.workerLaunchReceiptPath = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function issueCodes(diagnostic) {
  return new Set((diagnostic.issues ?? []).map((issue) => issue.code));
}

function runJsonCommand(repoRoot, command, args, env = {}) {
  const stdout = execFileSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    return JSON.parse(stdout);
  } catch {
    return { raw_stdout: stdout };
  }
}

function runTextCommand(repoRoot, command, args) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function runTodoQueueIntegrity(repoRoot) {
  return runJsonCommand(repoRoot, process.execPath, [
    'scripts/phase-loop-todo-queue-integrity.mjs',
    '--repo',
    repoRoot,
    '--todo',
    '.brownie/todo.md'
  ]);
}

function maybeArchiveResolvedRepairFeedback(repoRoot) {
  const feedbackPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/repair-feedback.json');
  const feedback = readJsonOrNull(feedbackPath);
  if (!feedback || feedback.completed === true) return { attempted: false, reason: 'no_active_repair_feedback' };
  const verification = feedback.verification && typeof feedback.verification === 'object' ? feedback.verification : {};
  const verificationFailure = feedback.verification_failure && typeof feedback.verification_failure === 'object'
    ? feedback.verification_failure
    : {};
  const feedbackReason = typeof verification.reason === 'string'
    ? verification.reason
    : typeof verificationFailure.reason === 'string'
      ? verificationFailure.reason
      : feedback.reason;
  // A valid queue only proves that the current TODO documents are internally
  // consistent.  It does not prove that a contract-replan request has been
  // applied.  Treating the latter as resolved here drops the only instruction
  // that can make the worker replace the repeated-failure leaf, which causes
  // the supervisor to restart the same terminal path indefinitely.
  const validatesCurrentTodoQueue = feedback.kind !== 'phase_loop_todo_contract_replan_feedback'
    && feedbackReason === 'todo_decomposition_guard_failed_after_todo_apply';
  if (!validatesCurrentTodoQueue) {
    return { attempted: false, reason: 'feedback_kind_requires_its_own_verification', kind: feedback.kind ?? null };
  }
  try {
    runTextCommand(repoRoot, process.execPath, ['scripts/guard-todo-decomposition.mjs']);
    const integrity = runTodoQueueIntegrity(repoRoot);
    if (integrity.valid !== true) return { attempted: false, reason: 'todo_queue_integrity_still_invalid', integrity };
    const archiveDir = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/repair-feedback-archive');
    fs.mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[-:.]/gu, '').replace(/Z$/u, 'Z');
    const archivePath = path.join(archiveDir, `${stamp}.json`);
    fs.writeFileSync(archivePath, `${JSON.stringify(feedback, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    const resolvedAt = new Date().toISOString();
    const completedFeedback = {
      ...feedback,
      completed: true,
      resolved_at: resolvedAt,
      resolution: 'current_todo_guard_and_queue_integrity_passed',
      archived_path: path.relative(repoRoot, archivePath),
      ...(feedback.verification && typeof feedback.verification === 'object'
        ? { verification: { ...feedback.verification, completed: true, resolved_at: resolvedAt } }
        : {})
    };
    fs.writeFileSync(feedbackPath, `${JSON.stringify(completedFeedback, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fsyncFileAndParent(archivePath); fsyncFileAndParent(feedbackPath);
    return { attempted: true, ok: true, archive_path: path.relative(repoRoot, archivePath) };
  } catch (error) {
    return { attempted: false, reason: 'current_todo_validation_still_failing', error: error?.stderr?.toString?.() ?? error?.message ?? String(error) };
  }
}

// A checked queue entry alone is not proof that a failed leaf completed: it
// can be an accidental edit.  Suppress retained diagnostics only when the
// leaf is absent from the live queue *and* a parsed completion receipt names
// it.  This predicate is evaluated before every feedback writer.
function completedLeafRecoveryState(repoRoot, diagnostic) {
  const selectedId = todoIdFromFirstLine(todoFirstLine(selectedTodoBlock(diagnostic)));
  if (!selectedId) return { completed: false, reason: 'selected_todo_id_missing' };
  const todoPath = path.join(repoRoot, '.brownie/todo.md');
  let todoText = '';
  try {
    todoText = fs.readFileSync(todoPath, 'utf8');
  } catch {
    return { completed: false, reason: 'todo_missing', todo_id: selectedId };
  }
  const todoState = loadTodoState(repoRoot, todoText);
  const liveIds = liveUncheckedTodoIds(todoText);
  const hasCompletionReceipt = todoState.completionRecords.some((record) => (
    record?.selected_todo_id === selectedId && record?.reason !== 'source_parent_completed'
  ));
  return {
    completed: !liveIds.has(selectedId) && hasCompletionReceipt,
    todo_id: selectedId,
    live: liveIds.has(selectedId),
    has_completion_receipt: hasCompletionReceipt
  };
}

function maybeResolveCompletedLeafRepairFeedback(repoRoot, completion) {
  if (!completion?.completed) return { attempted: false, reason: 'selected_leaf_not_durably_completed' };
  const feedbackPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/repair-feedback.json');
  const feedback = readJsonOrNull(feedbackPath);
  if (!feedback || feedback.completed === true) return { attempted: false, reason: 'no_active_repair_feedback' };
  const feedbackId = todoIdFromFirstLine(feedback.selected_todo_first_line ?? todoFirstLine(feedback.selected_todo));
  if (feedbackId !== completion.todo_id) {
    return { attempted: false, reason: 'active_feedback_targets_different_todo', feedback_todo_id: feedbackId ?? null };
  }
  try {
    const archiveDir = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/repair-feedback-archive');
    fs.mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[-:.]/gu, '').replace(/Z$/u, 'Z');
    const archivePath = path.join(archiveDir, `${stamp}-durable-completion.json`);
    fs.writeFileSync(archivePath, `${JSON.stringify(feedback, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    const resolvedAt = new Date().toISOString();
    fs.writeFileSync(feedbackPath, `${JSON.stringify({
      ...feedback,
      completed: true,
      resolved_at: resolvedAt,
      resolution: 'selected_leaf_durably_completed',
      completion_todo_id: completion.todo_id,
      archived_path: path.relative(repoRoot, archivePath)
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fsyncFileAndParent(archivePath); fsyncFileAndParent(feedbackPath);
    return { attempted: true, ok: true, archive_path: path.relative(repoRoot, archivePath) };
  } catch (error) {
    return { attempted: true, ok: false, error: error?.message ?? String(error) };
  }
}

function maybeRepairTodoContract(repoRoot, diagnostic) {
  const codes = issueCodes(diagnostic);
  if (!codes.has('todo_contract_invalid')) {
    return { attempted: false, reason: 'todo_contract_valid_or_not_reported' };
  }
  try {
    const result = runJsonCommand(repoRoot, process.execPath, [
      'scripts/repair-todo-decomposition.mjs',
      '--claim',
      path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/current.json'),
      '--todo',
      '.brownie/todo.md',
      '--breakdown',
      '.brownie/todo-breakdown.md',
      '--run-stamp',
      new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
    ], {
      BROWNIE_REPAIR_TODO_REPO_ROOT: repoRoot
    });
    return { attempted: true, ok: Boolean(result.applied), result };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error?.message ?? String(error),
      stdout: error?.stdout?.toString?.() ?? undefined,
      stderr: error?.stderr?.toString?.() ?? undefined
    };
  }
}

function maybeRepairTodoQueueIntegrity(repoRoot, diagnostic) {
  const codes = issueCodes(diagnostic);
  const detail = String(diagnostic.phase_loop?.detail ?? '');
  if (!codes.has('todo_queue_integrity_invalid') && !detail.includes('TODO queue integrity failed before claim')) {
    return { attempted: false, reason: 'todo_queue_integrity_valid_or_not_reported' };
  }

  const steps = [];
  try {
    steps.push({
      step: 'initial_queue_integrity_check',
      ok: true,
      result: runTodoQueueIntegrity(repoRoot)
    });
    return { attempted: true, ok: true, reason: 'queue_integrity_already_valid', steps };
  } catch (initialError) {
    steps.push({
      step: 'initial_queue_integrity_check',
      ok: false,
      error: initialError?.message ?? String(initialError),
      stdout: initialError?.stdout?.toString?.() ?? undefined,
      stderr: initialError?.stderr?.toString?.() ?? undefined
    });
  }

  const claimPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/current.json');
  try {
    const repairResult = runJsonCommand(repoRoot, process.execPath, [
      'scripts/repair-todo-decomposition.mjs',
      '--claim',
      claimPath,
      '--todo',
      '.brownie/todo.md',
      '--breakdown',
      '.brownie/todo-breakdown.md',
      '--run-stamp',
      new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
    ], {
      BROWNIE_REPAIR_TODO_REPO_ROOT: repoRoot
    });
    steps.push({ step: 'deterministic_todo_repair', ok: Boolean(repairResult.applied), result: repairResult });
  } catch (repairError) {
    steps.push({
      step: 'deterministic_todo_repair',
      ok: false,
      error: repairError?.message ?? String(repairError),
      stdout: repairError?.stdout?.toString?.() ?? undefined,
      stderr: repairError?.stderr?.toString?.() ?? undefined
    });
  }

  try {
    steps.push({
      step: 'queue_integrity_recheck',
      ok: true,
      result: runTodoQueueIntegrity(repoRoot)
    });
    return { attempted: true, ok: true, steps };
  } catch (recheckError) {
    steps.push({
      step: 'queue_integrity_recheck',
      ok: false,
      error: recheckError?.message ?? String(recheckError),
      stdout: recheckError?.stdout?.toString?.() ?? undefined,
      stderr: recheckError?.stderr?.toString?.() ?? undefined
    });
    return { attempted: true, ok: false, steps };
  }
}

function readJsonOrNull(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function removeActiveClaimForArchive(claimPath) {
  try {
    fs.rmSync(claimPath);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error?.code === 'ENOENT'
        ? 'active_claim_disappeared_during_cleanup'
        : 'active_claim_cleanup_failed',
      error: error?.message ?? String(error)
    };
  }
}

// A handoff record is control-plane state, not optional diagnostic output.
// Do not treat a truncated record as absent: doing so would silently resume a
// repeatedly failing claim without knowing whether an implementer accepted it.
export function inspectDelegationFeedback(filePath) {
  if (!fs.existsSync(filePath)) return { state: 'missing', feedback: null };
  try {
    const feedback = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!feedback || typeof feedback !== 'object' || Array.isArray(feedback)) {
      return { state: 'unreadable', feedback: null };
    }
    if (feedback.kind !== 'phase_loop_delegation_pending') {
      return { state: 'other', feedback };
    }
    const delegation = feedback.delegation && typeof feedback.delegation === 'object'
      ? feedback.delegation
      : {};
    if (feedback.completed === true) {
      return { state: 'resolved', feedback };
    }
    if (['acknowledged', 'completed'].includes(delegation.status)) {
      return { state: 'acknowledged', feedback };
    }
    if (delegation.status === 'pending') return { state: 'pending', feedback };
    return { state: 'unreadable', feedback: null };
  } catch {
    return { state: 'unreadable', feedback: null };
  }
}

function hasMergedCommit(repoRoot, commit) {
  if (!/^[0-9a-f]{40}$/iu.test(commit)) {
    return false;
  }
  try {
    runTextCommand(repoRoot, 'git', ['merge-base', '--is-ancestor', commit, 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

function verifyDelegationPullRequestProvenance(repoRoot, pullRequestUrl, implementationCommit) {
  const match = /^https:\/\/github\.com\/globalpocket\/brownie\/pull\/(\d+)$/u.exec(pullRequestUrl);
  if (!match) {
    return { ok: false, reason: 'delegation_pull_request_url_not_trusted' };
  }
  try {
    const pullRequest = runJsonCommand(repoRoot, 'gh', [
      'pr', 'view', match[1],
      '--repo', 'globalpocket/brownie',
      '--json', 'author,state,mergedAt,mergeCommit,commits,reviews,statusCheckRollup'
    ]);
    const commitIds = new Set([
      pullRequest?.mergeCommit?.oid,
      ...(Array.isArray(pullRequest?.commits) ? pullRequest.commits.map((commit) => commit?.oid) : [])
    ].filter((oid) => typeof oid === 'string'));
    const hasIndependentApproval = (pullRequest?.reviews ?? []).some((review) => (
      review?.state === 'APPROVED'
      && review?.author?.login === 'globalpocket'
      && commitIds.has(review?.commit?.oid)
    ));
    const checks = Array.isArray(pullRequest?.statusCheckRollup) ? pullRequest.statusCheckRollup : [];
    const checksPassed = checks.length > 0 && checks.every((check) => (
      check?.status === 'COMPLETED' && check?.conclusion === 'SUCCESS'
    ));
    const valid = (
      pullRequest?.author?.login === 'brownie-agent'
      && pullRequest?.state === 'MERGED'
      && typeof pullRequest?.mergedAt === 'string'
      && commitIds.has(implementationCommit)
      && hasIndependentApproval
      && checksPassed
    );
    return valid
      ? { ok: true, pull_request_number: Number(match[1]) }
      : { ok: false, reason: 'delegation_pull_request_provenance_mismatch' };
  } catch (error) {
    return { ok: false, reason: 'delegation_pull_request_provenance_unavailable', error: error?.message ?? String(error) };
  }
}

// An acknowledged handoff is not itself a completion: it must name a merged
// brownie-agent delivery and globalpocket review. Once those durable facts are
// present, materialize a completion receipt before pruning the matching queue
// item. This prevents a merged fix from being selected again merely because a
// stale controller claim still refers to the old TODO.
function maybeReconcileAcknowledgedDelegation(repoRoot, provenanceVerifier) {
  const feedbackPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/repair-feedback.json');
  const inspected = inspectDelegationFeedback(feedbackPath);
  if (inspected.state === 'missing') return { attempted: false, reason: 'delegation_feedback_missing' };
  if (inspected.state === 'resolved') return { attempted: false, reason: 'delegation_already_resolved' };
  if (inspected.state === 'pending') return { attempted: false, reason: 'delegation_acknowledgement_pending' };
  if (inspected.state !== 'acknowledged') return { attempted: false, reason: 'delegation_feedback_not_reconcilable_fail_closed' };

  const feedback = inspected.feedback;
  const delegation = feedback.delegation && typeof feedback.delegation === 'object' ? feedback.delegation : {};
  const verification = feedback.verification && typeof feedback.verification === 'object' ? feedback.verification : {};
  const selectedTodo = typeof feedback.selected_todo === 'string' ? feedback.selected_todo : '';
  const selectedTodoId = todoIdFromFirstLine(selectedTodo);
  const pullRequestUrl = typeof delegation.issue_or_pr_url === 'string' ? delegation.issue_or_pr_url.trim() : '';
  const acknowledgedAt = typeof delegation.acknowledged_at === 'string' ? delegation.acknowledged_at.trim() : '';
  const implementationCommit = typeof delegation.implementation_commit_or_blocker === 'string'
    ? delegation.implementation_commit_or_blocker.trim()
    : '';
  const evidenceValid = (
    delegation.required_actor === 'brownie-agent'
    && /^https:\/\/github\.com\/globalpocket\/brownie\/pull\/\d+$/u.test(pullRequestUrl)
    && !Number.isNaN(Date.parse(acknowledgedAt))
    && verification.reviewed_by === 'globalpocket'
    && verification.all_ci_checks_passed === true
    && selectedTodoId
    && hasMergedCommit(repoRoot, implementationCommit)
  );
  if (!evidenceValid) {
    return { attempted: true, ok: false, reason: 'delegation_acknowledgement_evidence_invalid_fail_closed' };
  }
  const provenance = provenanceVerifier(repoRoot, pullRequestUrl, implementationCommit);
  if (provenance?.ok !== true) {
    return {
      attempted: true,
      ok: false,
      reason: provenance?.reason ?? 'delegation_pull_request_provenance_invalid_fail_closed'
    };
  }

  const todoPath = path.join(repoRoot, '.brownie/todo.md');
  const todoText = fs.existsSync(todoPath) ? fs.readFileSync(todoPath, 'utf8') : '';
  if (!liveUncheckedTodoIds(todoText).has(selectedTodoId)) {
    return { attempted: true, ok: false, reason: 'delegated_todo_not_live_fail_closed', todo_id: selectedTodoId };
  }

  const completionDirectory = path.join(repoRoot, '.brownie/private/phase-loop/todo-completions');
  const completionPath = path.join(
    completionDirectory,
    `delegation-${selectedTodoId.replace(/[^A-Za-z0-9_.-]+/gu, '-')}-${implementationCommit}.json`
  );
  const receipt = {
    schema_version: 1,
    kind: 'phase_loop_delegation_completion',
    selected_todo_id: selectedTodoId,
    selected_todo_first_line: todoFirstLine(selectedTodo),
    reason: 'acknowledged_delegation_merged_and_reviewed',
    pull_request_url: pullRequestUrl,
    implementation_commit: implementationCommit,
    acknowledged_at: acknowledgedAt,
    reviewed_by: verification.reviewed_by,
    all_ci_checks_passed: true,
    reconciled_at: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    generated_by: 'phase-loop-supervisor-control'
  };
  try {
    fs.mkdirSync(completionDirectory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(completionPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    const completedFeedback = {
      ...feedback,
      completed: true,
      resolved_at: receipt.reconciled_at,
      resolution: 'merged_delegation_receipt_materialized',
      completion_receipt_path: path.relative(repoRoot, completionPath)
    };
    fs.writeFileSync(feedbackPath, `${JSON.stringify(completedFeedback, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fsyncFileAndParent(completionPath);
    fsyncFileAndParent(feedbackPath);
    return { attempted: true, ok: true, todo_id: selectedTodoId, completion_path: path.relative(repoRoot, completionPath) };
  } catch (error) {
    return { attempted: true, ok: false, reason: 'delegation_reconciliation_write_failed', error: error?.message ?? String(error) };
  }
}

function baselineDirtyWorkspace(repoRoot) {
  const files = new Set();
  for (const args of [
    ['diff', '--name-only', 'HEAD', '--'],
    ['ls-files', '--others', '--exclude-standard']
  ]) {
    for (const line of runTextCommand(repoRoot, 'git', args).split('\n')) {
      if (line.trim()) files.add(line.trim());
    }
  }
  const fingerprints = {};
  for (const file of [...files].sort()) {
    const absolute = path.resolve(repoRoot, file);
    if (absolute !== repoRoot && !absolute.startsWith(`${repoRoot}${path.sep}`)) continue;
    try {
      fingerprints[file] = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
    } catch {
      fingerprints[file] = null;
    }
  }
  return { files: Object.keys(fingerprints), fingerprints };
}

function todoFirstLine(block) {
  return typeof block === 'string' ? block.split('\n')[0]?.trim() ?? null : null;
}

function todoIdFromFirstLine(firstLine) {
  if (typeof firstLine !== 'string') {
    return null;
  }
  return firstLine
    .replace(/^(?:[-*]|\d+[.)])\s+\[[ xX]\]\s+/u, '')
    .split(':')[0]
    ?.trim() || null;
}

function targetScopeKey(todoText) {
  const firstLine = todoFirstLine(todoText);
  if (!firstLine) {
    return '';
  }
  const match = firstLine.match(/(?:Patch only|Create only)\s+(.+?)(?::|$)/u);
  if (!match) {
    return '';
  }
  const targets = [...match[1].matchAll(/`([^`\n]+)`/gu)]
    .map((entry) => entry[1].trim())
    .filter(Boolean)
    .sort();
  return targets.join('|');
}

function verificationCommand(todoText) {
  if (typeof todoText !== 'string') {
    return '';
  }
  const line = todoText.split('\n').map((entry) => entry.trim()).find((entry) => entry.startsWith('Verification:'));
  return line?.slice('Verification:'.length).trim() ?? '';
}

function liveUncheckedTodoIds(todoText) {
  const ids = new Set();
  const pattern = /^(?:[-*]|\d+[.)])\s+\[\s\]\s+([^:\n]+):/gm;
  let match;
  while ((match = pattern.exec(todoText)) !== null) {
    const id = match[1]?.trim();
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

function completedTodoIds(todoText) {
  const ids = new Set();
  const pattern = /^(?:[-*]|\d+[.)])\s+\[[xX]\]\s+([^:\n]+):/gm;
  let match;
  while ((match = pattern.exec(todoText)) !== null) {
    const id = match[1]?.trim();
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

function durableBlockedTodoIds(repoRoot) {
  const ids = new Set();
  const blockedPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/blocked.jsonl');
  for (const record of readJsonl(blockedPath)) {
    const explicitId = typeof record.todo_id === 'string' ? record.todo_id.trim() : '';
    if (explicitId) {
      ids.add(explicitId);
      continue;
    }
    const firstLineId = todoIdFromFirstLine(record?.selected_todo_first_line);
    if (firstLineId) {
      ids.add(firstLineId);
    }
  }
  return ids;
}

function selectedTodoBlock(diagnostic) {
  return diagnostic.verification_failure?.selected_todo?.first_line
    ?? diagnostic.invalid_patch?.selected_todo?.first_line
    ?? diagnostic.apply_rejection?.selected_todo?.first_line
    ?? diagnostic.progress?.selected_todo?.first_line
    ?? null;
}

function diagnosticFailureKind(diagnostic) {
  const codes = issueCodes(diagnostic);
  if (codes.has('invalid_workspace_write_patch_repeated')) {
    return 'invalid_patch';
  }
  if (codes.has('semantic_verification_repair_stalled')) {
    return 'semantic_verification_stalled';
  }
  if (codes.has('verification_failure_requires_semantic_repair')) {
    return 'semantic_verification_failure';
  }
  if (codes.has('bounded_leaf_refinement_rejected')) {
    return 'bounded_leaf_apply_rejection';
  }
  if (codes.has('stale_no_progress_projection_during_running_loop')) {
    return 'stale_no_progress_projection';
  }
  if (codes.has('no_progress_observed') || diagnostic.phase_loop?.status === 'no_progress') {
    return 'no_progress';
  }
  return null;
}

function stableEventId(event) {
  const key = JSON.stringify({
    todo_id: event.todo_id,
    kind: event.kind,
    status_run_id: event.status_run_id,
    progress_run_stamp: event.progress_run_stamp,
    claim_id: event.claim_id
  });
  return `sha256:${crypto.createHash('sha256').update(key).digest('hex')}`;
}

function readJsonl(filePath) {
  let text = '';
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  return text
    .split(/\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function appendFailureLedgerEvent(repoRoot, diagnostic) {
  const kind = diagnosticFailureKind(diagnostic);
  const firstLine = selectedTodoBlock(diagnostic);
  const todoId = todoIdFromFirstLine(firstLine);
  if (!kind || !todoId) {
    return {
      attempted: false,
      reason: 'no_actionable_failure_event'
    };
  }
  const ledgerPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl');
  const todoPath = path.join(repoRoot, '.brownie/todo.md');
  const selectedBlock = fs.existsSync(todoPath)
    ? todoBlocks(fs.readFileSync(todoPath, 'utf8')).find((candidate) => candidate.first_line === firstLine)?.block ?? firstLine
    : firstLine;
  const claimId = diagnostic.verification_failure?.claim_id
    ?? diagnostic.invalid_patch?.claim_id
    ?? diagnostic.apply_rejection?.claim_id
    ?? diagnostic.progress?.progress_projection?.claim_id
    ?? null;
  const event = {
    schema_version: 1,
    record_type: 'phase_loop_failure_event',
    observed_at: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    todo_id: todoId,
    selected_todo_first_line: firstLine,
    target_scope_key: targetScopeKey(selectedBlock),
    verification_command: verificationCommand(selectedBlock),
    kind,
    status: diagnostic.phase_loop?.status ?? null,
    status_run_id: diagnostic.phase_loop?.run_id ?? null,
    progress_classification: diagnostic.progress?.classification ?? null,
    progress_run_stamp: diagnostic.progress?.run_stamp ?? null,
    progress_fingerprint: diagnostic.progress?.last_progress_fingerprint ?? null,
    // Persist the projection's stop class so terminal failures can be counted
    // independently from ordinary no-progress observations after claim
    // migrations or controller restarts.
    projection_stop_class: diagnostic.progress?.projection_stop_class
      ?? diagnostic.progress?.progress_projection?.stop_class
      ?? null,
    same_progress_count: Number(diagnostic.progress?.same_progress_count ?? 0),
    claim_id: claimId,
    issue_codes: [...issueCodes(diagnostic)].sort()
  };
  event.event_id = stableEventId(event);
  const existing = readJsonl(ledgerPath);
  if (existing.some((entry) => entry?.event_id === event.event_id)) {
    return {
      attempted: true,
      ok: true,
      appended: false,
      reason: 'duplicate_failure_event',
      path: path.relative(repoRoot, ledgerPath),
      event
    };
  }
  try {
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true, mode: 0o700 });
    fs.appendFileSync(ledgerPath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    fsyncFileAndParent(ledgerPath);
    return {
      attempted: true,
      ok: true,
      appended: true,
      path: path.relative(repoRoot, ledgerPath),
      event
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error?.message ?? String(error),
      event
    };
  }
}

function terminalStopClassFromRunEvidence(repoRoot, entry) {
  const stamp = entry?.progress_run_stamp;
  const runId = entry?.status_run_id;
  if (!/^\d{8}T\d{6}Z$/u.test(stamp ?? '') || !/^run_[0-9a-f-]+$/u.test(runId ?? '')) {
    return null;
  }
  const evidencePath = path.join(repoRoot, '.brownie/private/phase-loop/runs', `${stamp}.stdout.log`);
  try {
    const payload = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    const automation = payload?.automation ?? payload?.run?.automation ?? {};
    const observedRunId = automation.run_id ?? payload?.run?.run_id ?? null;
    const stopClass = automation.stop_class ?? payload?.run?.stop_class ?? null;
    if (observedRunId !== runId || stopClass !== 'terminal_failure') {
      return null;
    }
    return { projection_stop_class: 'terminal_failure', evidence_path: path.relative(repoRoot, evidencePath) };
  } catch {
    return null;
  }
}

function hasContiguousTerminalRunEvidence(repoRoot, terminalEvents) {
  const evidencedEvents = terminalEvents.filter((entry) => (
    /^\d{8}T\d{6}Z$/u.test(entry?.progress_run_stamp ?? '')
    && /^run_[0-9a-f-]+$/u.test(entry?.status_run_id ?? '')
  ));
  const stamps = evidencedEvents.map((entry) => entry.progress_run_stamp);
  if (stamps.length < 3) return false;
  // Each ledger event must be bound to its own immutable stdout artifact.
  // Interval logs alone are not evidence for a missing or mismatched run.
  if (!evidencedEvents.every((entry) => terminalStopClassFromRunEvidence(repoRoot, entry)?.projection_stop_class === 'terminal_failure')) {
    return false;
  }
  const earliest = [...stamps].sort()[0];
  const latest = [...stamps].sort().at(-1);
  const runsDir = path.join(repoRoot, '.brownie/private/phase-loop/runs');
  try {
    const logs = fs.readdirSync(runsDir)
      .filter((name) => /^\d{8}T\d{6}Z\.stdout\.log$/u.test(name))
      .filter((name) => name.slice(0, 16) >= earliest && name.slice(0, 16) <= latest);
    if (logs.length < 3) return false;
    return logs.every((name) => {
      const payload = JSON.parse(fs.readFileSync(path.join(runsDir, name), 'utf8'));
      const automation = payload?.automation ?? payload?.run?.automation ?? {};
      return (automation.stop_class ?? payload?.run?.stop_class) === 'terminal_failure';
    });
  } catch {
    return false;
  }
}

function failureLedgerSummary(repoRoot, diagnostic, currentEventResult) {
  const firstLine = selectedTodoBlock(diagnostic);
  const todoId = todoIdFromFirstLine(firstLine);
  if (!todoId) {
    return {
      todo_id: null,
      recent_events: [],
      counts: {},
      should_replan: false,
      replan_reason: 'no_selected_todo'
    };
  }
  const ledgerPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl');
  const ledger = readJsonl(ledgerPath);
  // A controller upgrade can add audit fields to an event whose stable ID was
  // already recorded.  Overlay the freshly observed event in memory instead
  // of appending a duplicate failure or mutating the historical JSONL row.
  const currentEvent = currentEventResult?.event ?? null;
  const events = [
    ...ledger.map((entry) => entry?.event_id === currentEvent?.event_id ? { ...entry, ...currentEvent } : entry),
    currentEvent && !ledger.some((entry) => entry?.event_id === currentEvent.event_id)
      ? currentEvent
      : null
  ].filter(Boolean).map((entry) => {
    if (entry?.projection_stop_class) return entry;
    const evidence = terminalStopClassFromRunEvidence(repoRoot, entry);
    return evidence ? { ...entry, ...evidence, stop_class_source: 'phase_loop_stdout_rebaseline' } : entry;
  });
  const sameTodoEvents = events
    .filter((entry) => entry?.todo_id === todoId)
    .slice(-12);
  const progressFingerprint = diagnostic.progress?.last_progress_fingerprint ?? null;
  const currentTargetScope = targetScopeKey(firstLine);
  const observedCurrentEvent = currentEvent
    ?? [...events].reverse().find((entry) => entry?.todo_id === todoId && entry?.selected_todo_first_line === firstLine);
  const currentVerification = observedCurrentEvent?.verification_command ?? '';
  const sameScopeEvents = currentTargetScope && currentVerification
    ? events.filter((entry) => (
      (entry?.target_scope_key || targetScopeKey(entry?.selected_todo_first_line)) === currentTargetScope
      && entry?.verification_command === currentVerification
    )).slice(-24)
    : [];
  const sameScopeTodoIds = new Set(sameScopeEvents.map((entry) => entry?.todo_id).filter(Boolean));
  const legacyScopeEvents = currentTargetScope && currentVerification
    ? events.filter((entry) => (
      (entry?.target_scope_key || targetScopeKey(entry?.selected_todo_first_line)) === currentTargetScope
      && !entry?.verification_command
      && entry?.progress_fingerprint === progressFingerprint
    )).slice(-24)
    : [];
  const counts = sameTodoEvents.reduce((acc, entry) => {
    acc[entry.kind] = (acc[entry.kind] ?? 0) + 1;
    return acc;
  }, {});
  const progressSameCount = Number(diagnostic.progress?.same_progress_count ?? 0);
  // A durable ledger spans claim migrations, but prior failures must only
  // contribute to the current streak when they describe the same unchanged
  // progress projection.  A changed fingerprint is evidence of progress and
  // begins a fresh failure epoch.
  const sameFingerprintEvents = typeof progressFingerprint === 'string' && progressFingerprint.length > 0
    ? sameTodoEvents.filter((entry) => entry?.progress_fingerprint === progressFingerprint)
    : [];
  const sameFingerprintNoProgressCount = sameFingerprintEvents
    .filter((entry) => entry?.kind === 'no_progress')
    .length;
  // Invalid patch events are only evidence of an exhausted repair path when
  // they belong to the current progress projection.  A durable ledger also
  // contains superseded attempts; using those alone would turn a newly
  // instructed repair into an unrelated TODO-contract replan.
  const sameFingerprintInvalidPatchCount = sameFingerprintEvents
    .filter((entry) => entry?.kind === 'invalid_patch')
    .length;
  const noProgressCountForEpoch = progressFingerprint
    ? sameFingerprintNoProgressCount
    : (counts.no_progress ?? 0);
  const invalidPatchCountForEpoch = progressFingerprint
    ? sameFingerprintInvalidPatchCount
    : (counts.invalid_patch ?? 0);
  const codes = issueCodes(diagnostic);
  const repairableInvalidPatch = invalidPatchNeedsExactContextRepair(diagnostic.invalid_patch);
  const invalidPatchWithRepeatedNoProgress = codes.has('invalid_workspace_write_patch_repeated') && progressSameCount >= 2 && !repairableInvalidPatch;
  const semanticFailureWithRepeatedNoProgress = codes.has('verification_failure_requires_semantic_repair') && progressSameCount >= 2;
  const invalidPatchThenNoProgress = invalidPatchCountForEpoch >= 1 && noProgressCountForEpoch >= 1 && !repairableInvalidPatch;
  // Claim migration/rebaseline can legitimately reset progress-state's local
  // counter.  Preserve convergence across those boundaries by counting
  // no-progress events for the same TODO in the durable failure ledger.
  const repeatedNoProgressInLedger = sameFingerprintNoProgressCount >= 3;
  // Replans must not evade the durable repair boundary merely by minting a
  // new leaf id for the same patch target.  Require multiple leaf identities
  // and failure observations so unrelated one-off work remains schedulable.
  const repeatedTargetScopeFailure = sameScopeTodoIds.size >= 2 && sameScopeEvents.length >= 3;
  // A terminal runtime failure with several durable observations for exactly
  // one target is not a replan problem: restarting the same leaf would feed
  // the same malformed or non-actionable tool response back into the runner.
  // Count only terminal observations; generic no-progress history must not
  // create a false implementation handoff.  Fingerprinted records stay in
  // their progress epoch; only genuine legacy rows without a fingerprint may
  // be reclassified from immutable run evidence across that boundary.
  const currentProjectionStopClass = diagnostic.progress?.projection_stop_class
    ?? diagnostic.progress?.progress_projection?.stop_class
    ?? null;
  const terminalScopeEvents = sameScopeEvents.filter((entry) => (
    entry?.projection_stop_class === 'terminal_failure'
    && (!entry?.progress_fingerprint || !progressFingerprint || entry.progress_fingerprint === progressFingerprint)
  ));
  const allTerminalScopeEvents = sameScopeEvents.filter((entry) => entry?.projection_stop_class === 'terminal_failure');
  const contiguousTerminalEvidence = hasContiguousTerminalRunEvidence(repoRoot, allTerminalScopeEvents);
  const repeatedTerminalFailureOnSingleTarget = currentProjectionStopClass === 'terminal_failure'
    && sameScopeTodoIds.size === 1
    && (terminalScopeEvents.length >= 3 || (allTerminalScopeEvents.length >= 3 && contiguousTerminalEvidence));
  // Do not infer a verification command for old ledger rows.  Instead, make
  // the rebaseline explicit: repeated legacy failures on the same target
  // require a decomposition before another leaf can claim that contract.
  const legacyTargetScopeRebaselineRequired = Boolean(currentEvent)
    && legacyScopeEvents.length >= 1
    && sameScopeEvents.length >= 1;
  const shouldReplan = (
    progressSameCount >= 3 ||
    repeatedNoProgressInLedger ||
    repeatedTargetScopeFailure ||
    repeatedTerminalFailureOnSingleTarget ||
    legacyTargetScopeRebaselineRequired ||
    invalidPatchWithRepeatedNoProgress ||
    semanticFailureWithRepeatedNoProgress ||
    invalidPatchThenNoProgress ||
    (invalidPatchCountForEpoch >= 2 && !repairableInvalidPatch) ||
    (counts.semantic_verification_failure ?? 0) >= 2 ||
    (counts.semantic_verification_stalled ?? 0) >= 1 ||
    codes.has('semantic_verification_repair_stalled')
  );
  let replanReason = 'threshold_not_met';
  if (shouldReplan) {
    if (repeatedTerminalFailureOnSingleTarget) {
      // This must take precedence over generic no-progress thresholds: a
      // reproduced terminal failure needs an implementer handoff, not another
      // generated replan of the same leaf.
      replanReason = 'same_target_scope_terminal_failure_threshold';
    } else if (progressSameCount >= 3) {
      replanReason = 'same_todo_no_progress_threshold';
    } else if (repeatedNoProgressInLedger) {
      replanReason = 'same_todo_no_progress_ledger_threshold';
    } else if (repeatedTargetScopeFailure) {
      replanReason = 'same_target_scope_replan_leaf_threshold';
    } else if (legacyTargetScopeRebaselineRequired) {
      replanReason = 'legacy_target_scope_rebaseline_required';
    } else if (invalidPatchWithRepeatedNoProgress) {
      replanReason = 'invalid_patch_with_repeated_no_progress';
    } else if (semanticFailureWithRepeatedNoProgress) {
      replanReason = 'semantic_failure_with_repeated_no_progress';
    } else if (invalidPatchThenNoProgress) {
      replanReason = 'invalid_patch_followed_by_no_progress';
    } else if (invalidPatchCountForEpoch >= 2) {
      replanReason = 'same_todo_invalid_patch_threshold';
    } else if ((counts.semantic_verification_failure ?? 0) >= 2 || (counts.semantic_verification_stalled ?? 0) >= 1) {
      replanReason = 'same_todo_semantic_verification_threshold';
    } else {
      replanReason = 'same_todo_apply_rejection_threshold';
    }
  }
  return {
    todo_id: todoId,
    selected_todo_first_line: firstLine,
    recent_events: sameTodoEvents.map((entry) => ({
      event_id: entry.event_id,
      kind: entry.kind,
      status_run_id: entry.status_run_id,
      progress_run_stamp: entry.progress_run_stamp,
      progress_fingerprint: entry.progress_fingerprint ?? null,
      same_progress_count: entry.same_progress_count,
      observed_at: entry.observed_at
    })),
    counts,
    target_scope_key: currentTargetScope || null,
    verification_command: currentVerification || null,
    target_scope_event_count: sameScopeEvents.length,
    target_scope_distinct_todo_count: sameScopeTodoIds.size,
    terminal_target_scope_event_count: terminalScopeEvents.length,
    terminal_target_scope_all_epoch_event_count: allTerminalScopeEvents.length,
    contiguous_terminal_run_evidence: contiguousTerminalEvidence,
    repeated_terminal_failure_on_single_target: repeatedTerminalFailureOnSingleTarget,
    legacy_target_scope_event_count: legacyScopeEvents.length,
    current_progress_fingerprint: progressFingerprint,
    same_fingerprint_no_progress_count: sameFingerprintNoProgressCount,
    same_fingerprint_invalid_patch_count: sameFingerprintInvalidPatchCount,
    repairable_invalid_patch: repairableInvalidPatch,
    should_replan: shouldReplan,
    replan_reason: replanReason,
    ledger_path: path.relative(repoRoot, ledgerPath)
  };
}

function invalidPatchNeedsExactContextRepair(invalidPatch) {
  const proposals = Array.isArray(invalidPatch?.invalid_patch_proposals)
    ? invalidPatch.invalid_patch_proposals
    : [];
  if (proposals.length === 0) {
    return false;
  }
  const finalProposal = proposals[proposals.length - 1];
  const reason = String(finalProposal?.validation_reason ?? '').toLowerCase();
  return (
    reason.includes('old_text was not found') ||
    reason.includes('old_text matches inside a word') ||
    reason.includes('include the full line') ||
    reason.includes('surrounding context')
  );
}

function fsyncFileAndParent(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Best-effort durability only; the diagnostic file itself is recoverable.
  }
  try {
    const fd = fs.openSync(path.dirname(filePath), 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Some platforms do not allow directory fsync.
  }
}

function todoBlocks(todoText) {
  const pattern = /^[ \t]*(?:[-*]|\d+[.)])[ \t]+\[[ \t]\][ \t]+/gmu;
  const matches = [...todoText.matchAll(pattern)];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? todoText.length : todoText.length;
    const block = todoText.slice(start, end).trimEnd();
    return {
      block,
      start,
      end,
      first_line: todoFirstLine(block),
      sha256: crypto.createHash('sha256').update(block).digest('hex')
    };
  });
}

function phaseLoopControllerFingerprint(repoRoot) {
  const files = ['phase-loop.sh', 'scripts/phase-loop-todo-evaluator.mjs'];
  // Diagnostic tests use an isolated state fixture rather than a controller
  // checkout. In that case, fingerprint the executing controller itself.
  const controllerRoot = files.every((file) => fs.existsSync(path.join(repoRoot, file)))
    ? repoRoot
    : defaultRepoRoot;
  const manifest = files.map((file) => {
    const content = fs.readFileSync(path.join(controllerRoot, file));
    return `${crypto.createHash('sha256').update(content).digest('hex')}  ${file}\n`;
  }).join('');
  return crypto.createHash('sha256').update(manifest).digest('hex');
}

function appendStalledTodoBlockedRecord(repoRoot, diagnostic, ledgerSummary) {
  if (!ledgerSummary?.should_replan) {
    return { attempted: false, reason: 'failure_ledger_threshold_not_met' };
  }
  const todoPath = path.join(repoRoot, '.brownie/todo.md');
  const blockedPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/blocked.jsonl');
  const claimPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/current.json');
  const claim = readJsonOrNull(claimPath);
  const selectedTodo = claim?.selected_todo ?? selectedTodoBlock(diagnostic);
  const firstLine = todoFirstLine(selectedTodo) ?? ledgerSummary.selected_todo_first_line;
  if (!firstLine || !fs.existsSync(todoPath)) {
    return { attempted: true, ok: false, reason: 'selected_todo_or_todo_missing' };
  }
  const todoText = fs.readFileSync(todoPath, 'utf8');
  const block = todoBlocks(todoText).find((candidate) => candidate.first_line === firstLine);
  const selectedBlock = block?.block ?? selectedTodo ?? firstLine;
  const queueMaterial = todoBlocks(todoText)
    .filter((candidate) => !candidate.first_line?.includes('TODO-decompose-blocked-queue-'))
    .map((candidate) => candidate.block)
    .join('\n\n');
  const queueFingerprint = crypto.createHash('sha256').update(queueMaterial).digest('hex');
  const selectedHash = crypto.createHash('sha256').update(selectedBlock).digest('hex');
  const selectedTargetScope = targetScopeKey(selectedBlock);
  const selectedVerification = verificationCommand(selectedBlock);
  const controllerFingerprint = phaseLoopControllerFingerprint(repoRoot);
  const existing = fs.existsSync(blockedPath) ? readJsonl(blockedPath) : [];
  const alreadyRecorded = existing.some((record) => (
    record?.block_reason === 'stalled_leaf_contract_replan' &&
    record?.controller_fingerprint === controllerFingerprint &&
    (
      record?.selected_todo_first_line === firstLine ||
      record?.selected_todo_sha256 === selectedHash
    )
  ));
  if (alreadyRecorded) {
    return { attempted: true, ok: true, changed: false, reason: 'stalled_todo_already_blocked' };
  }
  const record = {
    schema_version: 1,
    blocked_at: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    blocked_by: 'phase-loop-supervisor-control',
    block_reason: 'stalled_leaf_contract_replan',
    run_stamp: diagnostic.progress?.run_stamp ?? diagnostic.phase_loop?.run_id ?? '',
    status_run_id: diagnostic.phase_loop?.run_id ?? '',
    claim_id: claim?.claim_id ?? diagnostic.verification_failure?.claim_id ?? diagnostic.invalid_patch?.claim_id ?? '',
    queue_generation: claim?.queue_generation ?? null,
    queue_fingerprint: queueFingerprint,
    controller_fingerprint: controllerFingerprint,
    todo_id: ledgerSummary.todo_id,
    selected_todo_sha256: selectedHash,
    selected_todo_first_line: firstLine,
    target_scope_key: selectedTargetScope || null,
    verification_command: selectedVerification || null
  };
  fs.mkdirSync(path.dirname(blockedPath), { recursive: true, mode: 0o700 });
  fs.appendFileSync(blockedPath, `${JSON.stringify(record, Object.keys(record).sort())}\n`, { encoding: 'utf8', mode: 0o600 });
  fsyncFileAndParent(blockedPath);
  return {
    attempted: true,
    ok: true,
    changed: true,
    path: path.relative(repoRoot, blockedPath),
    todo_id: ledgerSummary.todo_id
  };
}

function ensureStalledTodoDecompositionRequest(repoRoot, diagnostic, ledgerSummary) {
  if (!ledgerSummary?.should_replan) {
    return { attempted: false, reason: 'failure_ledger_threshold_not_met' };
  }
  const todoPath = path.join(repoRoot, '.brownie/todo.md');
  const breakdownPath = path.join(repoRoot, '.brownie/todo-breakdown.md');
  if (!fs.existsSync(todoPath)) {
    return { attempted: true, ok: false, reason: 'todo_missing' };
  }
  const todoText = fs.readFileSync(todoPath, 'utf8');
  const selectedFirstLine = ledgerSummary.selected_todo_first_line ?? todoFirstLine(selectedTodoBlock(diagnostic));
  const selectedId = ledgerSummary.todo_id;
  if (!selectedFirstLine || !selectedId) {
    return { attempted: true, ok: false, reason: 'selected_todo_missing' };
  }
  const uncheckedIds = liveUncheckedTodoIds(todoText);
  const checkedIds = completedTodoIds(todoText);
  if (checkedIds.has(selectedId)) {
    return {
      attempted: false,
      reason: 'selected_todo_already_completed',
      todo_id: selectedId
    };
  }
  if (!uncheckedIds.has(selectedId)) {
    return {
      attempted: false,
      reason: 'selected_todo_not_live_in_queue',
      todo_id: selectedId
    };
  }
  const requestPrefix = selectedId.split('-').slice(0, 2).join('-') || 'TODO';
  const requestId = `${requestPrefix}-replan-stalled-leaf-${crypto.createHash('sha256').update(selectedFirstLine).digest('hex').slice(0, 12)}`;
  if (todoText.includes(requestId)) {
    return { attempted: true, ok: true, changed: false, reason: 'decomposition_request_already_present', todo_id: requestId };
  }
  const relativeBreakdown = path.relative(repoRoot, breakdownPath);
  const item = `- [ ] ${requestId}: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to replan stalled Brownie TODO leaf into implementable child TODOs:
  Route: todo-decomposition.
  Source TODO: ${selectedId}.
  Depends on: <none>.
  Completion condition: Patch \`.brownie/todo.md\` and \`${relativeBreakdown}\` so stalled TODO \`${selectedId}\` is replaced or superseded by implementable child leaves that preserve the parent intent, exact patch targets, existing verification commands, and ledger coverage.
  Failure evidence: ${ledgerSummary.replan_reason}; same_progress_count=${diagnostic.progress?.same_progress_count ?? 0}.
  Forbidden changes: do not implement the release-evidence fix here, do not weaken guards/tests, do not invent evidence values, and do not declare Runtime Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\` and \`pnpm --workspace-root phase-loop:todo-queue-integrity\`.

`;
  const queueHeading = '### P0/P1: Release engineering and evidence';
  const insertIndex = todoText.indexOf(queueHeading);
  const nextTodoText = insertIndex >= 0
    ? `${todoText.slice(0, insertIndex + queueHeading.length)}\n\n${item}${todoText.slice(insertIndex + queueHeading.length).replace(/^\n+/u, '\n')}`
    : `${todoText.trimEnd()}\n\n${item}`;
  fs.writeFileSync(todoPath, nextTodoText, { encoding: 'utf8', mode: 0o600 });
  fsyncFileAndParent(todoPath);
  if (fs.existsSync(breakdownPath)) {
    const breakdownText = fs.readFileSync(breakdownPath, 'utf8');
    if (!breakdownText.includes(requestId)) {
      const section = `
## TODO-repair-${requestId}

Parent TODO: ${selectedId}

Dependency graph:
- ${requestId}: <none>

Verification ledger:
- ${requestId}: run \`pnpm --workspace-root guard:todo-decomposition\` and \`pnpm --workspace-root phase-loop:todo-queue-integrity\`.

Quality rubric:
- ${requestId}: replace the stalled leaf with implementable child TODOs while preserving parent intent, exact patch targets, existing verification commands, and fail-closed release evidence semantics.

History:

- ${new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')}: Supervisor detected repeated ${ledgerSummary.replan_reason} on ${selectedId} and promoted Brownie-owned TODO replan instead of retrying the same single-target leaf.
`;
      fs.writeFileSync(breakdownPath, `${breakdownText.trimEnd()}\n\n${section.trimStart()}`, { encoding: 'utf8', mode: 0o600 });
      fsyncFileAndParent(breakdownPath);
    }
  }
  return {
    attempted: true,
    ok: true,
    changed: true,
    path: path.relative(repoRoot, todoPath),
    todo_id: requestId,
    supersedes_todo_id: selectedId
  };
}

function validateJsonFile(repoRoot, relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function validateJsonlFile(repoRoot, relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const lines = fs.readFileSync(absolutePath, 'utf8').split('\n').filter((line) => line.trim());
  for (const line of lines) {
    JSON.parse(line);
  }
}

function runValidationStep(repoRoot, step) {
  try {
    if (step.kind === 'json') {
      validateJsonFile(repoRoot, step.path);
      return { ...step, ok: true };
    }
    if (step.kind === 'jsonl') {
      validateJsonlFile(repoRoot, step.path);
      return { ...step, ok: true };
    }
    const stdout = execFileSync(step.command, step.args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { ...step, ok: true, stdout_tail: stdout.slice(-4000) };
  } catch (error) {
    return {
      ...step,
      ok: false,
      error: error?.message ?? String(error),
      stdout_tail: error?.stdout?.toString?.().slice(-4000) ?? '',
      stderr_tail: error?.stderr?.toString?.().slice(-4000) ?? ''
    };
  }
}

function postRepairValidation(repoRoot, repairs, diagnostic) {
  const repairValues = Object.values(repairs).filter((repair) => repair && typeof repair === 'object');
  const changedPaths = new Set(
    repairValues
      .filter((repair) => repair.ok && (repair.changed || repair.path))
      .flatMap((repair) => [
        repair.path,
        ...(Array.isArray(repair.paths) ? repair.paths : [])
      ])
      .filter(Boolean)
  );
  const steps = [];
  const codes = issueCodes(diagnostic);
  const mustValidateTodo = (
    changedPaths.has('.brownie/todo.md') ||
    changedPaths.has('.brownie/todo-breakdown.md') ||
    codes.has('todo_contract_invalid')
  );
  if (mustValidateTodo) {
    steps.push({
      kind: 'command',
      name: 'guard-todo-decomposition',
      command: process.execPath,
      args: ['scripts/guard-todo-decomposition.mjs']
    });
    steps.push({
      kind: 'command',
      name: 'phase-loop-todo-queue-integrity',
      command: process.execPath,
      args: ['scripts/phase-loop-todo-queue-integrity.mjs']
    });
  }
  if (changedPaths.has('.brownie/private/phase-loop/todo-claims/repair-feedback.json')) {
    steps.push({
      kind: 'json',
      name: 'repair-feedback-json-parse',
      path: '.brownie/private/phase-loop/todo-claims/repair-feedback.json'
    });
  }
  if (changedPaths.has('.brownie/private/phase-loop/todo-claims/blocked.jsonl')) {
    steps.push({
      kind: 'jsonl',
      name: 'blocked-jsonl-parse',
      path: '.brownie/private/phase-loop/todo-claims/blocked.jsonl'
    });
  }
  if (changedPaths.has('.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl')) {
    steps.push({
      kind: 'jsonl',
      name: 'failure-ledger-jsonl-parse',
      path: '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl'
    });
  }
  if (steps.length === 0) {
    return { attempted: false, reason: 'no_generated_repair_artifacts' };
  }
  const results = steps.map((step) => runValidationStep(repoRoot, step));
  const ok = results.every((result) => result.ok);
  return {
    attempted: true,
    ok,
    steps: results,
    failed_steps: results.filter((result) => !result.ok).map((result) => result.name)
  };
}

function todoIdFromBlock(block) {
  return todoIdFromFirstLine(todoFirstLine(block));
}

function sourceTodoFromBlock(block) {
  const match = String(block ?? '').match(/^\s*Source TODO:\s*(.+?)\s*$/mu);
  return match?.[1]?.trim()?.replace(/[.:;,]+$/u, '') ?? null;
}

function isStalledLeafReplanId(todoId) {
  return typeof todoId === 'string' && /-replan-stalled-leaf-[a-f0-9]{12}$/u.test(todoId);
}

function removeTodoBlocksById(todoText, idsToRemove) {
  const blocks = todoBlocks(todoText);
  if (blocks.length === 0 || idsToRemove.size === 0) {
    return { text: todoText, removed: [] };
  }
  const removed = [];
  const ranges = [];
  for (const block of blocks) {
    const id = todoIdFromBlock(block.block);
    if (id && idsToRemove.has(id)) {
      removed.push(id);
      ranges.push([block.start, block.end]);
      continue;
    }
  }
  if (ranges.length === 0) {
    return { text: todoText, removed };
  }
  let text = todoText;
  for (const [start, end] of ranges.sort((left, right) => right[0] - left[0])) {
    text = `${text.slice(0, start)}${text.slice(end)}`;
  }
  text = text.replace(/\n{3,}/gu, '\n\n');
  if (text.trim().length > 0 && !text.endsWith('\n')) {
    text = `${text}\n`;
  }
  return { text, removed };
}

function pruneDependsOn(todoText, idsToRemove) {
  if (idsToRemove.size === 0) {
    return { text: todoText, changed: false, pruned: [] };
  }
  const pruned = [];
  const text = todoText.replace(
    /^(?<prefix>\s*Depends on:\s*)(?<value>[^\n.]*?)(?<trailing>\.?)$/gmu,
    (line, prefix, value, trailing = '') => {
      const raw = String(value ?? '').trim();
      if (!raw || raw === '<none>') {
        return line;
      }
      const dependencies = raw.split(/\s*,\s*/u).map((entry) => entry.trim()).filter(Boolean);
      const remaining = dependencies.filter((dependency) => !idsToRemove.has(dependency));
      if (remaining.length === dependencies.length) {
        return line;
      }
      const nextValue = remaining.length > 0 ? remaining.join(', ') : '<none>';
      pruned.push({
        from: raw,
        to: nextValue,
        pruned_dependency_ids: dependencies.filter((dependency) => idsToRemove.has(dependency))
      });
      return `${prefix}${nextValue}${trailing}`;
    }
  );
  return { text, changed: pruned.length > 0, pruned };
}

function writeCompletedDependencyRebaselineReceipt(repoRoot, { beforeTodoText, afterTodoText, prunedDependencyLines, completedIds }) {
  const completedPrunes = (prunedDependencyLines ?? []).filter((entry) => (
    Array.isArray(entry.pruned_dependency_ids) &&
    entry.pruned_dependency_ids.length > 0 &&
    entry.pruned_dependency_ids.every((dependency) => completedIds.has(dependency))
  ));
  if (completedPrunes.length === 0) {
    return null;
  }
  const directory = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/dependency-rebaselines');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString();
  const receipt = {
    schema_version: 1,
    record_type: 'completed_dependency_pruned_rebaseline',
    generated_at: timestamp,
    controller: 'phase-loop-supervisor-control',
    todo_path: '.brownie/todo.md',
    before_todo_sha256: crypto.createHash('sha256').update(beforeTodoText).digest('hex'),
    after_todo_sha256: crypto.createHash('sha256').update(afterTodoText).digest('hex'),
    pruned_dependency_lines: completedPrunes
  };
  const stamp = timestamp.replace(/[-:.]/gu, '').replace(/Z$/u, 'Z');
  const receiptPath = path.join(directory, `${stamp}-${crypto.createHash('sha256').update(JSON.stringify(receipt)).digest('hex').slice(0, 12)}.json`);
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fsyncFileAndParent(receiptPath);
  return path.relative(repoRoot, receiptPath);
}

function removeBreakdownRepairSections(breakdownText, idsToRemove) {
  let text = breakdownText;
  const removed = [];
  for (const id of idsToRemove) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const pattern = new RegExp(`\\n*## TODO-repair-${escaped}\\n[\\s\\S]*?(?=\\n## |\\n?$)`, 'u');
    if (pattern.test(text)) {
      text = text.replace(pattern, '\n');
      removed.push(id);
    }
  }
  return {
    text: `${text.trimEnd()}\n`,
    removed
  };
}

function maybeRepairNonLiveTodoResidue(repoRoot, diagnostic) {
  const todoPath = path.join(repoRoot, '.brownie/todo.md');
  const breakdownPath = path.join(repoRoot, '.brownie/todo-breakdown.md');
  if (!fs.existsSync(todoPath)) {
    return { attempted: false, reason: 'todo_missing' };
  }
  const todoText = fs.readFileSync(todoPath, 'utf8');
  const todoState = loadTodoState(repoRoot, todoText);
  const completedIds = todoState.completedIds;
  const blockedIds = durableBlockedTodoIds(repoRoot);
  const uncheckedIds = liveUncheckedTodoIds(todoText);
  const idsToRemove = new Set();
  const reasons = [];

  for (const id of uncheckedIds) {
    if (completedIds.has(id)) {
      idsToRemove.add(id);
      reasons.push({ todo_id: id, reason: 'durable_completion_reappeared_in_live_queue' });
    }
  }

  for (const block of todoBlocks(todoText)) {
    const id = todoIdFromBlock(block.block);
    if (!isStalledLeafReplanId(id)) {
      continue;
    }
    const sourceId = sourceTodoFromBlock(block.block);
    const sourceIsLive = sourceId ? uncheckedIds.has(sourceId) : false;
    const sourceIsCompleted = sourceId ? completedIds.has(sourceId) : false;
    const sourceIsBlocked = sourceId ? blockedIds.has(sourceId) : false;
    if (!sourceId || (!sourceIsLive && !sourceIsBlocked) || sourceIsCompleted) {
      idsToRemove.add(id);
      reasons.push({
        todo_id: id,
        source_todo_id: sourceId,
        reason: sourceIsCompleted
          ? 'stalled_replan_source_completed'
          : 'stalled_replan_source_not_live'
      });
    }
  }

  if (idsToRemove.size === 0) {
    return { attempted: false, reason: 'no_non_live_todo_residue_detected' };
  }

  const removedBlocks = removeTodoBlocksById(todoText, idsToRemove);
  const prunedDepends = pruneDependsOn(removedBlocks.text, idsToRemove);
  fs.writeFileSync(todoPath, prunedDepends.text, { encoding: 'utf8', mode: 0o600 });
  fsyncFileAndParent(todoPath);
  const dependencyRebaselineReceipt = writeCompletedDependencyRebaselineReceipt(repoRoot, {
    beforeTodoText: todoText,
    afterTodoText: prunedDepends.text,
    prunedDependencyLines: prunedDepends.pruned,
    completedIds
  });

  let breakdownRemoved = [];
  if (fs.existsSync(breakdownPath)) {
    const breakdownText = fs.readFileSync(breakdownPath, 'utf8');
    const nextBreakdown = removeBreakdownRepairSections(breakdownText, idsToRemove);
    if (nextBreakdown.removed.length > 0) {
      fs.writeFileSync(breakdownPath, nextBreakdown.text, { encoding: 'utf8', mode: 0o600 });
      fsyncFileAndParent(breakdownPath);
      breakdownRemoved = nextBreakdown.removed;
    }
  }

  return {
    attempted: true,
    ok: true,
    changed: true,
    paths: ['.brownie/todo.md', ...(breakdownRemoved.length > 0 ? ['.brownie/todo-breakdown.md'] : []), ...(dependencyRebaselineReceipt ? [dependencyRebaselineReceipt] : [])],
    removed_todo_ids: removedBlocks.removed,
    invalidated_completion_record_count: todoState.invalidatedCompletionRecords.length,
    pruned_dependency_lines: prunedDepends.pruned,
    dependency_rebaseline_receipt: dependencyRebaselineReceipt,
    removed_breakdown_sections: breakdownRemoved,
    reasons
  };
}

// A generated stalled-leaf replan is a controller recovery mechanism, not a
// product task in its own right.  If the worker returns terminal_failure
// without proposing a write for that replan, enqueueing another replan would
// only form a recursive TODO chain.  Restore the original bounded leaf and
// attach a target-patch recovery packet instead.  This is deliberately
// limited to a live implementation leaf with an explicit Patch only target.
function maybeRecoverTerminalStalledReplan(repoRoot, diagnostic) {
  const selected = diagnostic.progress?.selected_todo ?? {};
  let selectedId = selected.id ?? todoIdFromFirstLine(selected.first_line);
  const projection = diagnostic.progress?.progress_projection ?? {};
  const projectionStatus = projection.cli_status ?? diagnostic.progress?.projection_status;
  const projectionStopClass = projection.stop_class
    ?? projection.stop_reason
    ?? diagnostic.progress?.projection_stop_class;
  const terminalNoProposal = diagnostic.phase_loop?.status === 'no_progress'
    && (
      String(diagnostic.phase_loop?.detail ?? '').includes('objective_apply_stalled')
      || projectionStopClass === 'terminal_failure'
      || projectionStatus === 'no_eligible_task'
    );

  const todoPath = path.join(repoRoot, '.brownie/todo.md');
  const breakdownPath = path.join(repoRoot, '.brownie/todo-breakdown.md');
  const blockedPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/blocked.jsonl');
  const feedbackPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/repair-feedback.json');
  const claimPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/current.json');
  if (!fs.existsSync(todoPath)) {
    return { attempted: true, ok: false, reason: 'todo_missing' };
  }
  const todoText = fs.readFileSync(todoPath, 'utf8');
  const replanFeedback = readJsonOrNull(feedbackPath);
  // A terminal no_eligible_task projection selects the source leaf after the
  // worker has already exhausted its generated replan.  A later semantic
  // verification packet can legitimately replace the original replan packet,
  // so derive the association from the live queue as well as from durable
  // feedback.  Require exactly one matching live replan to avoid recovering
  // an unrelated source leaf.
  if (!isStalledLeafReplanId(selectedId)) {
    const feedbackSourceId = replanFeedback?.kind === 'phase_loop_todo_contract_replan_feedback'
      ? todoIdFromFirstLine(replanFeedback.selected_todo_first_line)
      : null;
    // A durable replan packet is an exact source binding.  If it disagrees
    // with the terminal projection, leave both records untouched rather than
    // inferring a different replan from the queue.
    const sourceId = feedbackSourceId ?? selectedId;
    const matchingReplans = todoBlocks(todoText).filter((block) => {
      const candidateId = todoIdFromBlock(block.block);
      return isStalledLeafReplanId(candidateId)
        && sourceTodoFromBlock(block.block) === sourceId;
    });
    if ((feedbackSourceId === null || feedbackSourceId === selectedId) && matchingReplans.length === 1) {
      selectedId = todoIdFromBlock(matchingReplans[0].block) ?? selectedId;
    }
  }
  if (!terminalNoProposal || !isStalledLeafReplanId(selectedId)) {
    return { attempted: false, reason: 'terminal_stalled_replan_not_reported' };
  }

  const replanBlock = todoBlocks(todoText).find((block) => todoIdFromBlock(block.block) === selectedId);
  const sourceId = sourceTodoFromBlock(replanBlock?.block);
  const sourceBlock = todoBlocks(todoText).find((block) => todoIdFromBlock(block.block) === sourceId);
  if (!sourceId || !sourceBlock || !/Route:\s*implementation\./u.test(sourceBlock.block) || !/Patch only\s+`[^`]+`/u.test(sourceBlock.block)) {
    return { attempted: true, ok: false, reason: 'replan_source_is_not_a_bounded_implementation_leaf', todo_id: selectedId, source_todo_id: sourceId };
  }

  const removed = removeTodoBlocksById(todoText, new Set([selectedId]));
  fs.writeFileSync(todoPath, removed.text, { encoding: 'utf8', mode: 0o600 });
  fsyncFileAndParent(todoPath);
  let breakdownRemoved = [];
  if (fs.existsSync(breakdownPath)) {
    const nextBreakdown = removeBreakdownRepairSections(fs.readFileSync(breakdownPath, 'utf8'), new Set([selectedId]));
    if (nextBreakdown.removed.length > 0) {
      fs.writeFileSync(breakdownPath, nextBreakdown.text, { encoding: 'utf8', mode: 0o600 });
      fsyncFileAndParent(breakdownPath);
      breakdownRemoved = nextBreakdown.removed;
    }
  }
  const retainedBlocked = readJsonl(blockedPath).filter((record) => !(
    record?.block_reason === 'stalled_leaf_contract_replan' &&
    (record?.todo_id === sourceId || todoIdFromFirstLine(record?.selected_todo_first_line) === sourceId)
  ));
  fs.writeFileSync(blockedPath, retainedBlocked.map((record) => `${JSON.stringify(record, Object.keys(record).sort())}\n`).join(''), { encoding: 'utf8', mode: 0o600 });
  fsyncFileAndParent(blockedPath);
  // The selected replan is being removed from the queue.  Retain its claim as
  // an audit record, but never let it survive as current: a later claim pass
  // otherwise refreshes the old snapshot and resurrects the removed replan.
  let archivedClaimPath = null;
  const activeClaim = readJsonOrNull(claimPath);
  if (activeClaim?.claim_id && todoIdFromFirstLine(activeClaim.selected_todo) === selectedId) {
    const stamp = new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
    const archivePath = path.join(
      repoRoot,
      '.brownie/private/phase-loop/todo-claims',
      `terminal-stalled-replan-${stamp}.json`
    );
    const archivedClaim = {
      ...activeClaim,
      archived_at: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
      archived_by: 'phase-loop-supervisor-control',
      archive_reason: 'terminal_stalled_replan_recovery',
      superseded_replan_todo_id: selectedId,
      restored_source_todo_id: sourceId
    };
    fs.writeFileSync(archivePath, `${JSON.stringify(archivedClaim, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.unlinkSync(claimPath);
    fsyncFileAndParent(archivePath);
    archivedClaimPath = path.relative(repoRoot, archivePath);
  }
  const patchScope = sourceBlock.first_line ?? sourceBlock.block.split('\n')[0] ?? '';
  const patchTargets = [...patchScope.matchAll(/`([^`]+)`/gu)].map((match) => match[1]);
  const feedback = {
    schema_version: 1,
    kind: 'phase_loop_terminal_stalled_replan_recovery',
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    completed: false,
    reason: 'generated_todo_decomposition_terminal_without_proposal',
    selected_todo: sourceBlock.block,
    selected_todo_first_line: sourceBlock.first_line,
    superseded_replan_todo_id: selectedId,
    archived_claim_path: archivedClaimPath,
    repair_hint: 'The generated TODO replan ended without a workspace.write proposal. Do not recreate or edit the TODO queue. Emit exactly one compact workspace.write patch_file for a selected target, or report one concrete blocker.',
    semantic_repair_policy: {
      mode: 'force_bounded_leaf_target_patch',
      selected_patch_targets: patchTargets,
      must_preserve_selected_todo_intent: true,
      must_not_refine_bounded_leaf_todo: true,
      forbidden_next_actions: ['rewrite .brownie/todo.md', 'create another stalled-leaf replan', 'modify unrelated files']
    },
    generated_by: 'phase-loop-supervisor-control'
  };
  fs.writeFileSync(feedbackPath, `${JSON.stringify(feedback, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fsyncFileAndParent(feedbackPath);
  return {
    attempted: true,
    ok: true,
    changed: true,
    source_todo_id: sourceId,
    removed_replan_todo_id: selectedId,
    paths: ['.brownie/todo.md', ...(breakdownRemoved.length > 0 ? ['.brownie/todo-breakdown.md'] : []), '.brownie/private/phase-loop/todo-claims/blocked.jsonl', ...(archivedClaimPath ? [archivedClaimPath, '.brownie/private/phase-loop/todo-claims/current.json'] : []), '.brownie/private/phase-loop/todo-claims/repair-feedback.json']
  };
}

function maybeRepairRejectedBoundedLeafReplanResidue(repoRoot, diagnostic) {
  const todoPath = path.join(repoRoot, '.brownie/todo.md');
  const breakdownPath = path.join(repoRoot, '.brownie/todo-breakdown.md');
  const ledgerPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/failure-ledger.jsonl');
  if (!fs.existsSync(todoPath)) {
    return { attempted: true, ok: false, reason: 'todo_missing' };
  }
  const sourceIds = new Set(
    readJsonl(ledgerPath)
      .filter((entry) => entry?.kind === 'bounded_leaf_apply_rejection')
      .map((entry) => entry?.todo_id ?? todoIdFromFirstLine(entry?.selected_todo_first_line))
      .filter(Boolean)
  );
  const currentSourceId = diagnostic.apply_rejection?.selected_todo?.id
    ?? todoIdFromFirstLine(diagnostic.apply_rejection?.selected_todo?.first_line);
  if (currentSourceId && (
    issueCodes(diagnostic).has('bounded_leaf_refinement_rejected') ||
    diagnostic.apply_rejection?.bounded_leaf_refinement === true
  )) {
    sourceIds.add(currentSourceId);
  }
  if (sourceIds.size === 0) {
    return { attempted: false, reason: 'no_bounded_leaf_rejection_history' };
  }
  const todoText = fs.readFileSync(todoPath, 'utf8');
  const matchingReplans =
    todoBlocks(todoText)
      .filter((block) => {
        const id = todoIdFromBlock(block.block);
        return isStalledLeafReplanId(id) &&
          sourceIds.has(sourceTodoFromBlock(block.block)) &&
          /Failure evidence:\s*same_todo_apply_rejection_threshold\b/u.test(block.block);
      });
  const idsToRemove = new Set(matchingReplans.map((block) => todoIdFromBlock(block.block)).filter(Boolean));
  const affectedSourceIds = new Set(matchingReplans.map((block) => sourceTodoFromBlock(block.block)).filter(Boolean));
  if (idsToRemove.size === 0) {
    return { attempted: false, reason: 'no_rejected_bounded_leaf_replan_residue_detected', source_todo_ids: [...sourceIds].sort() };
  }
  const removedBlocks = removeTodoBlocksById(todoText, idsToRemove);
  const prunedDepends = pruneDependsOn(removedBlocks.text, idsToRemove);
  fs.writeFileSync(todoPath, prunedDepends.text, { encoding: 'utf8', mode: 0o600 });
  fsyncFileAndParent(todoPath);

  let breakdownRemoved = [];
  if (fs.existsSync(breakdownPath)) {
    const breakdownText = fs.readFileSync(breakdownPath, 'utf8');
    const nextBreakdown = removeBreakdownRepairSections(breakdownText, idsToRemove);
    if (nextBreakdown.removed.length > 0) {
      fs.writeFileSync(breakdownPath, nextBreakdown.text, { encoding: 'utf8', mode: 0o600 });
      fsyncFileAndParent(breakdownPath);
      breakdownRemoved = nextBreakdown.removed;
    }
  }
  const blockedPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/blocked.jsonl');
  const blockedRecords = readJsonl(blockedPath);
  const retainedBlockedRecords = blockedRecords.filter((record) => !(
    record?.block_reason === 'stalled_leaf_contract_replan' &&
    (affectedSourceIds.has(record?.todo_id) || affectedSourceIds.has(todoIdFromFirstLine(record?.selected_todo_first_line)))
  ));
  const removedBlockedRecordCount = blockedRecords.length - retainedBlockedRecords.length;
  if (removedBlockedRecordCount > 0) {
    fs.writeFileSync(
      blockedPath,
      retainedBlockedRecords.map((record) => `${JSON.stringify(record, Object.keys(record).sort())}\n`).join(''),
      { encoding: 'utf8', mode: 0o600 }
    );
    fsyncFileAndParent(blockedPath);
  }
  return {
    attempted: true,
    ok: true,
    changed: true,
    paths: [
      '.brownie/todo.md',
      ...(breakdownRemoved.length > 0 ? ['.brownie/todo-breakdown.md'] : []),
      ...(removedBlockedRecordCount > 0 ? ['.brownie/private/phase-loop/todo-claims/blocked.jsonl'] : [])
    ],
    removed_todo_ids: removedBlocks.removed,
    source_todo_ids: [...affectedSourceIds].sort(),
    pruned_dependency_lines: prunedDepends.pruned,
    removed_breakdown_sections: breakdownRemoved,
    removed_blocked_record_count: removedBlockedRecordCount,
    reason: 'bounded_leaf_refinement_rejected_replan_residue_removed'
  };
}

function maybeArchiveStaleActiveClaim(repoRoot, diagnostic) {
  const codes = issueCodes(diagnostic);
  if (!codes.has('active_claim_not_selected_by_live_queue')) {
    return { attempted: false, reason: 'active_claim_matches_live_queue_or_not_reported' };
  }
  const claimPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/current.json');
  const claim = readJsonOrNull(claimPath);
  if (!claim) {
    return { attempted: true, ok: false, reason: 'claim_missing_or_invalid' };
  }
  const stamp = new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
  const archivePath = path.join(
    repoRoot,
    '.brownie/private/phase-loop/todo-claims',
    `stale-current-${stamp}.json`
  );
  const archived = {
    ...claim,
    archived_at: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    archived_by: 'phase-loop-supervisor-control',
    archive_reason: 'active_claim_not_selected_by_live_queue',
    evaluator_selected_todo_id: diagnostic.todo?.evaluator?.selected_todo_id ?? null
  };
  try {
    fs.writeFileSync(archivePath, `${JSON.stringify(archived, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    const removal = removeActiveClaimForArchive(claimPath);
    if (!removal.ok) {
      return { attempted: true, ok: false, ...removal, path: path.relative(repoRoot, archivePath) };
    }
    fsyncFileAndParent(archivePath);
    return {
      attempted: true,
      ok: true,
      changed: true,
      path: path.relative(repoRoot, archivePath),
      removed_path: path.relative(repoRoot, claimPath),
      archived_claim_id: claim.claim_id ?? null
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error?.message ?? String(error)
    };
  }
}

function maybeArchiveTerminalNoEligibleActiveClaim(repoRoot, diagnostic, ledgerSummary) {
  const claimPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/current.json');
  const claim = readJsonOrNull(claimPath);
  // A malformed active claim is a hard safety boundary.  Check it before the
  // generic replan precedence so repeated no-progress cannot mutate the TODO
  // contract or reach a start decision while the active claim is unreadable.
  if (!claim && fs.existsSync(claimPath)) {
    return { attempted: false, reason: 'active_claim_unreadable_or_invalid' };
  }
  if (ledgerSummary?.should_replan) {
    return { attempted: false, reason: 'todo_contract_replan_takes_precedence' };
  }
  const projection = diagnostic.progress?.progress_projection ?? {};
  const projectionStatus = projection.cli_status ?? diagnostic.progress?.projection_status ?? null;
  const projectionClosure = projection.closure ?? diagnostic.progress?.projection_closure ?? null;
  const noEligible = (
    projectionStatus === 'no_eligible_task' ||
    projectionClosure === 'no_eligible_task' ||
    projectionStatus === 'no_actionable_work' ||
    projectionClosure === 'no_actionable_work'
  );
  const terminalTaskFailed = (
    projection.stop_reason === 'terminal_task_failed' ||
    projection.blocked_by_terminal_task_failure === true ||
    diagnostic.progress?.classification === 'no_progress'
  );
  // An archived or otherwise absent claim cannot be the cause of a terminal
  // claim-recovery block.  Check this before examining a dirty workspace: the
  // latter may legitimately contain historical Brownie evidence which must
  // remain untouched, but it has no claim to archive or rebaseline here.
  if (!claim && !fs.existsSync(claimPath)) {
    return { attempted: false, reason: 'no_active_claim' };
  }
  const workspaceChanged = diagnostic.progress?.workspace_changed === true;
  const baselineFingerprints = claim?.baseline_dirty_file_sha256;
  const legacyBaselineFiles = Array.isArray(claim?.baseline_diff_files)
    ? claim.baseline_diff_files.map((file) => String(file)).sort()
    : [];
  const legacyTodoPath = path.join(repoRoot, '.brownie/todo.md');
  let legacyTodoMatches = false;
  try {
    legacyTodoMatches = typeof claim?.baseline_todo_text === 'string'
      && fs.readFileSync(legacyTodoPath, 'utf8') === claim.baseline_todo_text;
  } catch {
    legacyTodoMatches = false;
  }
  let dirtyFiles = [];
  let baselineVerified = false;
  try {
    const current = baselineDirtyWorkspace(repoRoot);
    dirtyFiles = current.files.filter((file) => !file.startsWith('.brownie/private/'));
    const expectedFiles = Object.keys(baselineFingerprints ?? {}).sort();
    baselineVerified = expectedFiles.length > 0
      && JSON.stringify(current.files) === JSON.stringify(expectedFiles)
      && expectedFiles.every((file) => current.fingerprints[file] === baselineFingerprints[file]);
  } catch {
    dirtyFiles = Array.isArray(diagnostic.git?.dirty_files) ? diagnostic.git.dirty_files : [];
  }
  const dirty = dirtyFiles.length > 0 && !baselineVerified;
  const legacyManagedBaseline = !baselineFingerprints
    && legacyBaselineFiles.length === 1
    && legacyBaselineFiles[0] === '.brownie/todo.md'
    && JSON.stringify(dirtyFiles) === JSON.stringify(legacyBaselineFiles)
    && legacyTodoMatches;
  let auditableLegacyBaseline = !baselineFingerprints
    && legacyBaselineFiles.length === 2
    && legacyBaselineFiles.includes('.brownie/todo.md')
    && legacyBaselineFiles.includes('.brownie/todo-breakdown.md')
    && JSON.stringify(dirtyFiles) === JSON.stringify(legacyBaselineFiles)
    && legacyBaselineFiles.every((file) => file === '.brownie/todo.md' || file === '.brownie/todo-breakdown.md')
    && legacyTodoMatches;
  let legacyRebaselineSnapshot = null;
  if (auditableLegacyBaseline) {
    try {
      const current = baselineDirtyWorkspace(repoRoot);
      const managedFiles = current.files.filter((file) => !file.startsWith('.brownie/private/'));
      const todoText = fs.readFileSync(path.join(repoRoot, '.brownie/todo.md'), 'utf8');
      const breakdownText = fs.readFileSync(path.join(repoRoot, '.brownie/todo-breakdown.md'), 'utf8');
      if (JSON.stringify(managedFiles) !== JSON.stringify(legacyBaselineFiles)) {
        auditableLegacyBaseline = false;
      } else {
        legacyRebaselineSnapshot = {
          dirty_files: managedFiles,
          dirty_file_sha256: Object.fromEntries(
            managedFiles.map((file) => [file, current.fingerprints[file]])
          ),
          todo_text: todoText,
          breakdown_text: breakdownText
        };
      }
    } catch {
      // A legacy migration is safe only when every managed baseline input can be preserved.
      auditableLegacyBaseline = false;
    }
  }
  if (!noEligible || !terminalTaskFailed) {
    return { attempted: false, reason: 'terminal_no_eligible_not_reported' };
  }
  if (workspaceChanged || (dirty && !legacyManagedBaseline && !auditableLegacyBaseline)) {
    return {
      attempted: false,
      reason: 'workspace_changed_or_dirty_not_archiving_claim',
      workspace_changed: workspaceChanged,
      dirty_files: dirtyFiles,
      baseline_verified: baselineVerified
    };
  }

  const claimStatus = String(claim.status ?? '');
  if (!['claimed', 'in_progress'].includes(claimStatus)) {
    return { attempted: false, reason: 'claim_not_active', claim_status: claimStatus };
  }
  const selectedTodo = claim.selected_todo ?? selectedTodoBlock(diagnostic);
  const selectedFirstLine = todoFirstLine(selectedTodo);
  const selectedId = todoIdFromFirstLine(selectedFirstLine);
  const liveSelectedId = diagnostic.todo?.evaluator?.selected_todo_id ?? null;
  if (!selectedId || (liveSelectedId && liveSelectedId !== selectedId)) {
    return {
      attempted: false,
      reason: 'claim_selected_todo_not_current_live_selection',
      claim_todo_id: selectedId,
      live_selected_todo_id: liveSelectedId
    };
  }

  const stamp = new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
  const archivePath = path.join(
    repoRoot,
    '.brownie/private/phase-loop/todo-claims',
    `terminal-no-eligible-current-${stamp}.json`
  );
  const archived = {
    ...claim,
    archived_at: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    archived_by: 'phase-loop-supervisor-control',
    archive_reason: 'terminal_no_eligible_active_claim_reset',
    legacy_baseline_rebased: legacyManagedBaseline,
    legacy_baseline_audited_rebaseline: auditableLegacyBaseline,
    legacy_rebaseline_snapshot: legacyRebaselineSnapshot,
    evaluator_selected_todo_id: liveSelectedId,
    progress_run_stamp: diagnostic.progress?.run_stamp ?? null,
    status_run_id: diagnostic.phase_loop?.run_id ?? null,
    same_progress_count: diagnostic.progress?.same_progress_count ?? null,
    terminal_status: projectionStatus,
    terminal_closure: projectionClosure,
    terminal_stop_reason: projection.stop_reason ?? null
  };
  try {
    fs.writeFileSync(archivePath, `${JSON.stringify(archived, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    const removal = removeActiveClaimForArchive(claimPath);
    if (!removal.ok) {
      return { attempted: true, ok: false, ...removal, path: path.relative(repoRoot, archivePath) };
    }
    fsyncFileAndParent(archivePath);
    return {
      attempted: true,
      ok: true,
      changed: true,
      path: path.relative(repoRoot, archivePath),
      removed_path: path.relative(repoRoot, claimPath),
      archived_claim_id: claim.claim_id ?? null,
      todo_id: selectedId,
      legacy_baseline_rebased: legacyManagedBaseline,
      legacy_baseline_audited_rebaseline: auditableLegacyBaseline
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error?.message ?? String(error)
    };
  }
}

function parentPrefixFromTodoId(parentId) {
  if (typeof parentId !== 'string' || !/^E-\d+/u.test(parentId) || !parentId.includes('-')) {
    return null;
  }
  return parentId.split('-').slice(0, 2).join('-');
}

function replaceAllLiteral(text, from, to) {
  return text.split(from).join(to);
}

function maybeRepairDerivedTodoPrefixAndLedger(repoRoot, diagnostic) {
  const codes = issueCodes(diagnostic);
  const errorText = (diagnostic.issues ?? [])
    .flatMap((issue) => Array.isArray(issue.errors) ? issue.errors : [])
    .join('\n');
  if (!codes.has('todo_contract_invalid') || !errorText.includes('TODO id must preserve parent prefix')) {
    return { attempted: false, reason: 'no_derived_todo_prefix_violation' };
  }
  const todoPath = path.join(repoRoot, '.brownie/todo.md');
  const breakdownPath = path.join(repoRoot, '.brownie/todo-breakdown.md');
  if (!fs.existsSync(todoPath)) {
    return { attempted: true, ok: false, reason: 'todo_missing' };
  }
  let todoText = fs.readFileSync(todoPath, 'utf8');
  let breakdownText = fs.existsSync(breakdownPath) ? fs.readFileSync(breakdownPath, 'utf8') : '';
  const mappings = [];
  for (const candidate of todoBlocks(todoText)) {
    const id = todoIdFromBlock(candidate.block);
    const parent = sourceTodoFromBlock(candidate.block);
    const prefix = parentPrefixFromTodoId(parent);
    if (!id || !parent || !prefix || id.startsWith(`${prefix}-`)) {
      continue;
    }
    const suffix = id.replace(/^[A-Za-z0-9]+-[A-Za-z0-9]+-/u, '');
    const nextId = `${prefix}-${suffix}`;
    if (nextId === id) {
      continue;
    }
    mappings.push({ from: id, to: nextId, parent });
  }
  if (mappings.length === 0) {
    return { attempted: true, ok: false, reason: 'no_repairable_prefix_mapping' };
  }
  for (const mapping of mappings) {
    todoText = replaceAllLiteral(todoText, mapping.from, mapping.to);
    breakdownText = replaceAllLiteral(breakdownText, mapping.from, mapping.to);
  }
  for (const mapping of mappings) {
    if (!breakdownText.includes(mapping.to)) {
      const section = `
## TODO-repair-${mapping.to}

Parent TODO: ${mapping.parent}

Dependency graph:
- ${mapping.to}: <none>

Verification ledger:
- ${mapping.to}: run \`pnpm --workspace-root guard:todo-decomposition\` and \`pnpm --workspace-root phase-loop:todo-queue-integrity\`.

Quality rubric:
- ${mapping.to}: derived TODO id preserves parent prefix, has bounded patch scope, and keeps the TODO queue/breakdown ledger consistent.

History:

- ${new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')}: Supervisor repaired generated TODO id prefix from ${mapping.from} to ${mapping.to} after TODO decomposition guard rejected the live queue.
`;
      breakdownText = `${breakdownText.trimEnd()}\n\n${section.trimStart()}`;
    }
  }
  fs.writeFileSync(todoPath, todoText, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(breakdownPath, `${breakdownText.trimEnd()}\n`, { encoding: 'utf8', mode: 0o600 });
  fsyncFileAndParent(todoPath);
  fsyncFileAndParent(breakdownPath);
  return {
    attempted: true,
    ok: true,
    changed: true,
    paths: ['.brownie/todo.md', '.brownie/todo-breakdown.md'],
    mappings
  };
}

// A TODO decomposition apply may create bounded child leaves before its
// matching breakdown ledger is written.  Repair only the exact leaf ids the
// guard reports, and only when they remain children of an already-recorded
// stalled replan.  This keeps the recovery scoped and auditable.
function maybeRepairMissingDerivedBreakdownLedger(repoRoot, diagnostic) {
  const errorText = (diagnostic.issues ?? [])
    .flatMap((issue) => Array.isArray(issue.errors) ? issue.errors : [])
    .join('\n');
  const missingIds = [...errorText.matchAll(/todo-breakdown\.md: missing derived leaf TODO id ([A-Za-z0-9_-]+)/gu)]
    .map((match) => match[1]);
  if (missingIds.length === 0) return { attempted: false, reason: 'no_missing_derived_breakdown_ledger' };
  const todoPath = path.join(repoRoot, '.brownie/todo.md');
  const breakdownPath = path.join(repoRoot, '.brownie/todo-breakdown.md');
  if (!fs.existsSync(todoPath) || !fs.existsSync(breakdownPath)) {
    return { attempted: true, ok: false, reason: 'todo_or_breakdown_missing' };
  }
  const todoText = fs.readFileSync(todoPath, 'utf8');
  let breakdownText = fs.readFileSync(breakdownPath, 'utf8');
  const repaired = [];
  for (const id of missingIds) {
    const block = todoBlocks(todoText).find((candidate) => todoIdFromBlock(candidate.block) === id);
    const parentId = sourceTodoFromBlock(block?.block);
    if (!block || !isStalledLeafReplanId(parentId) || !breakdownText.includes(`## TODO-repair-${parentId}`)) {
      return { attempted: true, ok: false, reason: 'missing_leaf_is_not_bound_to_recorded_replan', todo_id: id, parent_todo_id: parentId };
    }
    const dependencies = block.block.match(/^\s*Depends on:\s*(.+?)\.?\s*$/mu)?.[1] ?? '<none>';
    const verification = block.block.match(/^\s*Verification:\s*(.+?)\s*$/mu)?.[1] ?? 'run `pnpm --workspace-root guard:todo-decomposition`';
    const heading = `## TODO-repair-${parentId}`;
    const sectionStart = breakdownText.indexOf(heading);
    const nextSection = breakdownText.indexOf('\n## ', sectionStart + heading.length);
    const sectionEnd = nextSection < 0 ? breakdownText.length : nextSection;
    let parentSection = breakdownText.slice(sectionStart, sectionEnd);
    const appendLedgerLine = (label, line) => {
      const listStart = parentSection.indexOf(`${label}\n`);
      if (listStart < 0) return false;
      const nextBlankLine = parentSection.indexOf('\n\n', listStart + label.length + 1);
      const listEnd = nextBlankLine < 0 ? parentSection.trimEnd().length : nextBlankLine;
      if (parentSection.includes(`\n${line}\n`)) return false;
      parentSection = `${parentSection.slice(0, listEnd)}\n${line}${parentSection.slice(listEnd)}`;
      return true;
    };
    const tracked = appendLedgerLine('Dependency graph:', `- ${id}: ${dependencies}`)
      && appendLedgerLine('Verification ledger:', `- ${id}: ${verification}`)
      && appendLedgerLine('Quality rubric:', `- ${id}: bounded derived leaf remains traceable to its recorded stalled replan.`);
    if (!tracked) {
      return { attempted: true, ok: false, reason: 'recorded_replan_section_not_appendable', todo_id: id, parent_todo_id: parentId };
    }
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z');
    parentSection = `${parentSection.trimEnd()}\n\n- ${timestamp}: Supervisor restored the missing derived-leaf ledger entry after TODO decomposition guard rejection.\n`;
    breakdownText = `${breakdownText.slice(0, sectionStart)}${parentSection}${breakdownText.slice(sectionEnd)}`;
    repaired.push(id);
  }
  fs.writeFileSync(breakdownPath, `${breakdownText.trimEnd()}\n`, { encoding: 'utf8', mode: 0o600 });
  fsyncFileAndParent(breakdownPath);
  return { attempted: true, ok: true, changed: true, paths: ['.brownie/todo-breakdown.md'], repaired_todo_ids: repaired };
}

// Normalize the short-lived ledger layout emitted by the first recovery
// implementation. A child-specific repair section satisfies the decomposition
// guard but is not a parent-to-child replan record, so queue integrity cannot
// reconstruct the supersession relationship. Preserve its source in an
// archive, then move only live stalled-replan children into their parent.
function maybeMigrateLegacyDerivedBreakdownLedger(repoRoot) {
  const todoPath = path.join(repoRoot, '.brownie/todo.md');
  const breakdownPath = path.join(repoRoot, '.brownie/todo-breakdown.md');
  if (!fs.existsSync(todoPath) || !fs.existsSync(breakdownPath)) {
    return { attempted: false, reason: 'todo_or_breakdown_missing' };
  }
  const todoText = fs.readFileSync(todoPath, 'utf8');
  const originalBreakdown = fs.readFileSync(breakdownPath, 'utf8');
  let breakdownText = originalBreakdown;
  const migrations = [];
  for (const candidate of todoBlocks(todoText)) {
    const id = todoIdFromBlock(candidate.block);
    const parentId = sourceTodoFromBlock(candidate.block);
    if (!id || !isStalledLeafReplanId(parentId)) continue;
    const parentHeading = `## TODO-repair-${parentId}`;
    const childHeading = `## TODO-repair-${id}`;
    const parentStart = breakdownText.indexOf(parentHeading);
    const childStart = breakdownText.indexOf(childHeading);
    if (parentStart < 0 || childStart < 0) continue;
    const childEndNext = breakdownText.indexOf('\n## ', childStart + childHeading.length);
    const childEnd = childEndNext < 0 ? breakdownText.length : childEndNext;
    const childSection = breakdownText.slice(childStart, childEnd);
    const dependencies = childSection.match(new RegExp(`^- ${id}: (.+?)\\s*$`, 'mu'))?.[1];
    const verification = childSection.match(new RegExp(`^Verification ledger:\\n- ${id}: (.+?)\\s*$`, 'mu'))?.[1];
    const quality = childSection.match(new RegExp(`^Quality rubric:\\n- ${id}: (.+?)\\s*$`, 'mu'))?.[1];
    if (!dependencies || !verification || !quality) {
      return { attempted: true, ok: false, reason: 'legacy_derived_ledger_not_migratable', todo_id: id, parent_todo_id: parentId };
    }
    const parentEndNext = breakdownText.indexOf('\n## ', parentStart + parentHeading.length);
    const parentEnd = parentEndNext < 0 ? breakdownText.length : parentEndNext;
    let parentSection = breakdownText.slice(parentStart, parentEnd);
    const appendLedgerLine = (label, line) => {
      const listStart = parentSection.indexOf(`${label}\n`);
      if (listStart < 0) return false;
      const nextBlankLine = parentSection.indexOf('\n\n', listStart + label.length + 1);
      const listEnd = nextBlankLine < 0 ? parentSection.trimEnd().length : nextBlankLine;
      if (parentSection.includes(`\n${line}\n`)) return false;
      parentSection = `${parentSection.slice(0, listEnd)}\n${line}${parentSection.slice(listEnd)}`;
      return true;
    };
    const moved = appendLedgerLine('Dependency graph:', `- ${id}: ${dependencies}`)
      && appendLedgerLine('Verification ledger:', `- ${id}: ${verification}`)
      && appendLedgerLine('Quality rubric:', `- ${id}: ${quality}`);
    if (!moved) {
      return { attempted: true, ok: false, reason: 'legacy_derived_ledger_not_migratable', todo_id: id, parent_todo_id: parentId };
    }
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z');
    parentSection = `${parentSection.trimEnd()}\n\n- ${timestamp}: Supervisor migrated the legacy child-only ledger entry into this parent replan record.\n`;
    breakdownText = `${breakdownText.slice(0, parentStart)}${parentSection}${breakdownText.slice(parentEnd)}`;
    const refreshedChildStart = breakdownText.indexOf(childHeading);
    const refreshedChildEndNext = breakdownText.indexOf('\n## ', refreshedChildStart + childHeading.length);
    const refreshedChildEnd = refreshedChildEndNext < 0 ? breakdownText.length : refreshedChildEndNext;
    breakdownText = `${breakdownText.slice(0, refreshedChildStart)}${breakdownText.slice(refreshedChildEnd).replace(/^\n/, '')}`;
    migrations.push({ todo_id: id, parent_todo_id: parentId });
  }
  if (migrations.length === 0) return { attempted: false, reason: 'no_legacy_derived_ledger_sections' };
  const archiveDir = path.join(repoRoot, '.brownie/private/phase-loop/recovery-archives');
  fs.mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
  const archivePath = path.join(archiveDir, `legacy-derived-breakdown-ledger-${new Date().toISOString().replace(/[:.]/gu, '-')}.md`);
  fs.writeFileSync(archivePath, originalBreakdown, { encoding: 'utf8', mode: 0o600 });
  fsyncFileAndParent(archivePath);
  fs.writeFileSync(breakdownPath, `${breakdownText.trimEnd()}\n`, { encoding: 'utf8', mode: 0o600 });
  fsyncFileAndParent(breakdownPath);
  return { attempted: true, ok: true, changed: true, paths: ['.brownie/todo-breakdown.md'], archive_path: path.relative(repoRoot, archivePath), migrations };
}

function maybeWriteTodoContractReplanFeedback(repoRoot, diagnostic, ledgerSummary) {
  if (!ledgerSummary?.should_replan) {
    return {
      attempted: false,
      reason: ledgerSummary?.replan_reason ?? 'failure_ledger_threshold_not_met',
      ledger_summary: ledgerSummary
    };
  }
  const claimPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/current.json');
  const feedbackPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/repair-feedback.json');
  const claim = readJsonOrNull(claimPath);
  const selectedTodo = claim?.selected_todo ?? selectedTodoBlock(diagnostic);
  const selectedRoute = diagnostic.progress?.selected_todo?.route ?? null;
  const selectedId = ledgerSummary.todo_id ?? todoIdFromFirstLine(todoFirstLine(selectedTodo));
  const todoText = fs.existsSync(path.join(repoRoot, '.brownie/todo.md'))
    ? fs.readFileSync(path.join(repoRoot, '.brownie/todo.md'), 'utf8')
    : '';
  const todoState = loadTodoState(repoRoot, todoText);
  const liveTodoIds = liveUncheckedTodoIds(todoText);
  // A durable delegation receipt may have removed this leaf after its last
  // failure. Historical ledger events must not resurrect a completed target
  // as a new replan request on a later supervisor pass.
  if (!selectedId || !liveTodoIds.has(selectedId)) {
    const hasCompletionReceipt = todoState.completionRecords.some((record) => (
      record?.selected_todo_id === selectedId && record?.reason !== 'source_parent_completed'
    ));
    if (!selectedId || !hasCompletionReceipt) {
      return {
        attempted: true,
        ok: false,
        reason: 'selected_todo_not_live_without_durable_completion',
        todo_id: selectedId ?? null,
        ledger_summary: ledgerSummary
      };
    }
    return {
      attempted: false,
      reason: 'selected_todo_not_live_after_durable_completion',
      todo_id: selectedId ?? null,
      ledger_summary: ledgerSummary
    };
  }
  if (selectedRoute === 'todo-decomposition' && String(selectedId ?? '').includes('replan-stalled-leaf')) {
    return {
      attempted: false,
      reason: 'recursive_todo_decomposition_replan_suppressed',
      ledger_summary: ledgerSummary
    };
  }
  const claimId = claim?.claim_id
    ?? diagnostic.verification_failure?.claim_id
    ?? diagnostic.invalid_patch?.claim_id
    ?? diagnostic.apply_rejection?.claim_id
    ?? diagnostic.progress?.progress_projection?.claim_id
    ?? null;
  const feedback = {
    schema_version: 1,
    kind: 'phase_loop_todo_contract_replan_feedback',
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    completed: false,
    reason: 'supervisor_repeated_leaf_failure_requires_todo_contract_replan',
    claim_id: claimId,
    selected_todo: selectedTodo,
    selected_todo_first_line: todoFirstLine(selectedTodo) ?? ledgerSummary.selected_todo_first_line ?? null,
    failure_ledger_summary: ledgerSummary,
    repair_hint: [
      'The same selected leaf has repeatedly failed without meaningful progress.',
      'Do not repeat the same workspace.write patch and do not keep trying to satisfy an impossible single-target contract.',
      'First decide whether the selected TODO is too narrow for its verification and completion condition.',
      'If the allowed patch target cannot satisfy the failed verification semantically, patch .brownie/todo.md and .brownie/todo-breakdown.md to replace this leaf with implementable child leaves that preserve the parent intent.',
      'A replacement leaf must materially differ in its patch target scope or verification command; do not mint a new leaf id for the same target-and-verification contract.',
      'Use separate implementation and test/evidence leaves when production code and tests must both change.',
      'Do not weaken guards/tests, do not invent release evidence values, and do not declare Runtime Product Ready.'
    ].join(' '),
    semantic_repair_policy: {
      mode: 'stalled_leaf_contract_replan',
      must_preserve_parent_intent: true,
      must_not_only_make_checks_green: true,
      must_not_weaken_guards_or_tests: true,
      must_not_repeat_failed_patch_or_same_leaf_attempt: true,
      must_materially_change_target_scope_or_verification: true,
      allowed_next_actions: [
        'inspect selected TODO contract and failed verification',
        'patch .brownie/todo.md and .brownie/todo-breakdown.md to replace the selected leaf when its target scope is insufficient',
        'create implementable child leaves with explicit patch targets, dependencies, and existing verification commands',
        'emit one concrete fail-closed blocker only if the parent work is genuinely blocked by external state'
      ],
      forbidden_next_actions: [
        'repeat the same invalid patch old_text',
        'retry the same single-target leaf without changing target scope',
        'delete the selected TODO without a replacement or passing verification',
        'weaken the failing verification',
        'modify unrelated files to create apparent progress'
      ]
    },
    generated_by: 'phase-loop-supervisor-control'
  };
  try {
    fs.mkdirSync(path.dirname(feedbackPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(feedbackPath, `${JSON.stringify(feedback, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fsyncFileAndParent(feedbackPath);
    return {
      attempted: true,
      ok: true,
      path: path.relative(repoRoot, feedbackPath),
      ledger_summary: ledgerSummary
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error?.message ?? String(error),
      ledger_summary: ledgerSummary
    };
  }
}

function maybeWriteDelegationPendingFeedback(repoRoot, diagnostic, ledgerSummary) {
  // Replan churn across leaf identities and terminal failure of one leaf both
  // require an auditable implementation handoff, not another generated retry.
  const delegationReasons = new Set([
    'same_target_scope_replan_leaf_threshold',
    'same_target_scope_terminal_failure_threshold'
  ]);
  if (!delegationReasons.has(ledgerSummary?.replan_reason)) {
    return { attempted: false, reason: ledgerSummary?.replan_reason ?? 'failure_ledger_threshold_not_met' };
  }
  const feedbackPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/repair-feedback.json');
  const existing = inspectDelegationFeedback(feedbackPath);
  if (existing.state === 'unreadable') {
    return { attempted: true, ok: false, reason: 'delegation_feedback_unreadable_fail_closed' };
  }
  if (existing.state === 'pending' || existing.state === 'acknowledged' || existing.state === 'resolved') {
    return {
      attempted: true,
      ok: true,
      preserved: true,
      reason: existing.state === 'pending'
        ? 'delegation_pending_already_recorded'
        : existing.state === 'acknowledged'
          ? 'delegation_acknowledgement_preserved'
          : 'delegation_completion_preserved'
    };
  }
  const claim = readJsonOrNull(path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/current.json'));
  const selectedTodo = claim?.selected_todo ?? selectedTodoBlock(diagnostic);
  const feedback = {
    schema_version: 1,
    kind: 'phase_loop_delegation_pending',
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    completed: false,
    reason: 'same_target_scope_failed_across_replan_leaves',
    claim_id: claim?.claim_id ?? diagnostic.progress?.progress_projection?.claim_id ?? null,
    selected_todo: selectedTodo,
    selected_todo_first_line: todoFirstLine(selectedTodo),
    failure_ledger_summary: ledgerSummary,
    delegation: {
      required_actor: 'brownie-agent',
      acknowledgement_required: true,
      required_evidence: ['issue_or_pr_url', 'acknowledged_at', 'implementation_commit_or_blocker'],
      status: 'pending'
    },
    repair_hint: 'Do not create another TODO leaf with the same target scope and verification command. Record brownie-agent acknowledgement and implementation evidence before clearing this state.',
    generated_by: 'phase-loop-supervisor-control'
  };
  try {
    fs.mkdirSync(path.dirname(feedbackPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(feedbackPath, `${JSON.stringify(feedback, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fsyncFileAndParent(feedbackPath);
    return { attempted: true, ok: true, path: path.relative(repoRoot, feedbackPath) };
  } catch (error) {
    return { attempted: true, ok: false, error: error?.message ?? String(error) };
  }
}

function maybeWriteSemanticVerificationRepairFeedback(repoRoot, diagnostic) {
  const codes = issueCodes(diagnostic);
  if (!codes.has('verification_failure_requires_semantic_repair')) {
    return { attempted: false, reason: 'semantic_verification_failure_not_reported' };
  }
  const stalled = codes.has('semantic_verification_repair_stalled') || codes.has('stale_no_progress_projection_during_running_loop');
  const claimPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/current.json');
  const feedbackPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/repair-feedback.json');
  const claim = readJsonOrNull(claimPath);
  const selectedTodo = claim?.selected_todo ?? diagnostic.verification_failure?.selected_todo?.first_line ?? null;
  const feedback = {
    schema_version: 1,
    kind: 'phase_loop_semantic_verification_repair_feedback',
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    completed: false,
    reason: 'supervisor_semantic_verification_failure',
    selected_todo: selectedTodo,
    selected_todo_first_line: todoFirstLine(selectedTodo) ?? diagnostic.verification_failure?.selected_todo?.first_line ?? null,
    verification_failure: diagnostic.verification_failure,
    repair_hint: [
      'The selected TODO reached verification but the verification command failed.',
      'Repair the selected target semantically: keep the TODO intent, keep the guard/test strength, and rerun the exact failed command.',
      stalled
        ? 'This semantic repair is now stalled; if the selected single-target TODO cannot satisfy the verification without forbidden files, patch .brownie/todo.md to replace it with a corrected implementable leaf or a concrete fail-closed blocker.'
        : 'Do not mark the TODO complete by deleting or weakening checks; make the implementation/evidence match the contract.'
    ].join(' '),
    semantic_repair_policy: {
      mode: stalled ? 'stalled_semantic_verification_replan_or_repair' : 'bounded_selected_target_semantic_repair',
      must_preserve_selected_todo_intent: true,
      must_not_only_make_checks_green: true,
      must_not_weaken_guards_or_tests: true,
      must_rerun_failed_command: true,
      allowed_next_actions: [
        'inspect_selected_todo',
        'inspect_failed_command_stdout_stderr',
        'inspect_patch_targets',
        'repair_selected_patch_targets',
        'rerun_exact_failed_command',
        ...(stalled ? [
          'patch .brownie/todo.md to replace the selected leaf when its target scope is insufficient',
          'emit a concrete fail-closed blocker when the selected TODO is impossible'
        ] : [])
      ],
      forbidden_next_actions: [
        'delete_or_skip_failed_test',
        'weaken_guard_contract',
        'remove_selected_todo_without_passing_verification',
        'modify_unrelated_files_to_create_progress',
        ...(stalled ? [
          'repeat the same semantic repair without changing target scope or TODO contract'
        ] : [])
      ],
      stalled
    },
    generated_by: 'phase-loop-supervisor-control'
  };
  try {
    fs.mkdirSync(path.dirname(feedbackPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(feedbackPath, `${JSON.stringify(feedback, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fsyncFileAndParent(feedbackPath);
    return {
      attempted: true,
      ok: true,
      path: path.relative(repoRoot, feedbackPath)
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error?.message ?? String(error)
    };
  }
}

function maybeWriteBoundedLeafApplyRejectionFeedback(repoRoot, diagnostic) {
  const codes = issueCodes(diagnostic);
  if (!codes.has('bounded_leaf_refinement_rejected')) {
    return { attempted: false, reason: 'bounded_leaf_refinement_rejection_not_reported' };
  }
  const claimPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/current.json');
  const feedbackPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/repair-feedback.json');
  const claim = readJsonOrNull(claimPath);
  const applyRejection = diagnostic.apply_rejection ?? {};
  const selectedTodo = claim?.selected_todo ?? applyRejection?.selected_todo?.first_line ?? null;
  const patchTargets = Array.isArray(applyRejection?.selected_todo?.patch_targets)
    ? applyRejection.selected_todo.patch_targets
    : [];
  const feedback = {
    schema_version: 1,
    kind: 'phase_loop_bounded_leaf_apply_rejection_repair_feedback',
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    completed: false,
    reason: 'supervisor_bounded_leaf_refinement_rejected',
    selected_todo: selectedTodo,
    selected_todo_first_line: todoFirstLine(selectedTodo) ?? applyRejection?.selected_todo?.first_line ?? null,
    claim_id: claim?.claim_id ?? null,
    queue_generation: claim?.queue_generation ?? null,
    queue_fingerprint: claim?.queue_fingerprint ?? null,
    apply_rejection: applyRejection,
    repair_hint: [
      'The selected TODO is already a bounded leaf.',
      'Do not rewrite .brownie/todo.md, do not split the TODO again, and do not restate the same TODO.',
      'Emit one compact workspace.write patch_file for the selected target, or report one concrete blocker if the target cannot satisfy the completion condition.'
    ].join(' '),
    semantic_repair_policy: {
      mode: 'force_bounded_leaf_target_patch',
      selected_patch_targets: patchTargets,
      must_preserve_selected_todo_intent: true,
      must_not_refine_bounded_leaf_todo: true,
      must_not_only_make_checks_green: true,
      allowed_next_actions: [
        'emit exactly one compact workspace.write patch_file for one selected target',
        'report one concrete blocker if the selected target cannot satisfy the completion condition'
      ],
      forbidden_next_actions: [
        'rewrite .brownie/todo.md',
        'split bounded leaf again',
        'remove selected TODO without passing verification',
        'repeat the rejected TODO refinement proposal',
        'modify unrelated files'
      ]
    },
    generated_by: 'phase-loop-supervisor-control'
  };
  try {
    fs.mkdirSync(path.dirname(feedbackPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(feedbackPath, `${JSON.stringify(feedback, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fsyncFileAndParent(feedbackPath);
    return {
      attempted: true,
      ok: true,
      path: path.relative(repoRoot, feedbackPath)
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error?.message ?? String(error)
    };
  }
}

// Progress-integrity deliberately rejects operational-only changes: they must
// not satisfy a claimed implementation leaf.  Preserve that fail-closed
// verdict, but make the next worker turn actionable rather than leaving a
// terminal no-progress state with no target-specific instruction.
function maybeWriteSelectedTargetRedelegationFeedback(repoRoot, diagnostic) {
  const integrity = (diagnostic.issues ?? []).find((issue) => issue.code === 'progress_integrity_invalid');
  const claimPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/current.json');
  const feedbackPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/repair-feedback.json');
  const claim = readJsonOrNull(claimPath);
  const feedback = readJsonOrNull(feedbackPath);
  const violation = (integrity?.errors ?? []).find((error) => error?.code === 'selected_target_not_changed');
  const retainedIntegrityFailure = feedback?.reason === 'verification_output_unparseable'
    && String(feedback?.verification?.raw_tail ?? '').includes('selected_target_not_changed');
  const selectedTodo = claim?.selected_todo ?? selectedTodoBlock(diagnostic) ?? feedback?.selected_todo_first_line ?? null;
  const selectedFirstLine = todoFirstLine(selectedTodo);
  const retainedFeedbackMatchesSelection = retainedIntegrityFailure && (
    (claim?.claim_id && feedback?.claim_id === claim.claim_id)
    || (selectedFirstLine && feedback?.selected_todo_first_line === selectedFirstLine)
  );
  if (!violation && !retainedFeedbackMatchesSelection) return { attempted: false, reason: 'selected_target_not_changed_not_reported' };
  const selectedId = violation?.selected_todo_id ?? diagnostic.verification_failure?.selected_todo?.id ?? todoIdFromFirstLine(todoFirstLine(selectedTodo));
  const inlineTargets = typeof selectedTodo === 'string'
    ? [...selectedTodo.matchAll(/`([^`]+)`/gu)].map((match) => match[1]).filter((value) => value.includes('/'))
    : [];
  const targets = Array.isArray(violation?.selected_scopes)
    ? violation.selected_scopes
    : Array.isArray(diagnostic.verification_failure?.selected_todo?.patch_targets)
      ? diagnostic.verification_failure.selected_todo.patch_targets
      : inlineTargets;
  if (!selectedId || targets.length === 0) {
    return { attempted: true, ok: false, reason: 'selected_target_redelegation_missing_contract', todo_id: selectedId ?? null };
  }
  const redelegationFeedback = {
    schema_version: 1,
    kind: 'phase_loop_selected_target_redelegation_feedback',
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    completed: false,
    reason: 'selected_target_not_changed',
    selected_todo: selectedTodo,
    selected_todo_first_line: selectedFirstLine,
    selected_todo_id: selectedId,
    claim_id: claim?.claim_id ?? null,
    selected_patch_targets: targets,
    observed_changed_files: Array.isArray(violation?.changed_files) ? violation.changed_files : [],
    repair_hint: 'Operational artifacts do not complete this TODO. Preserve the TODO and user changes; emit a compact patch to one selected target, then run its declared verification.',
    semantic_repair_policy: {
      mode: 'force_selected_target_patch',
      allowed_next_actions: ['patch one selected target', 'report one concrete external blocker'],
      forbidden_next_actions: ['rewrite TODO queue', 'treat .brownie operational artifacts as progress', 'modify unrelated files']
    },
    generated_by: 'phase-loop-supervisor-control'
  };
  try {
    fs.mkdirSync(path.dirname(feedbackPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(feedbackPath, `${JSON.stringify(redelegationFeedback, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fsyncFileAndParent(feedbackPath);
    return { attempted: true, ok: true, path: path.relative(repoRoot, feedbackPath), todo_id: selectedId };
  } catch (error) {
    return { attempted: true, ok: false, error: error?.message ?? String(error) };
  }
}

function maybeWriteInvalidPatchRepairFeedback(repoRoot, diagnostic) {
  const codes = issueCodes(diagnostic);
  if (!codes.has('invalid_workspace_write_patch_repeated')) {
    return { attempted: false, reason: 'invalid_patch_not_reported' };
  }
  const claimPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/current.json');
  const feedbackPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/repair-feedback.json');
  const claim = readJsonOrNull(claimPath);
  const invalidPatch = diagnostic.invalid_patch ?? {};
  const selectedTodo = claim?.selected_todo ?? invalidPatch?.selected_todo?.first_line ?? null;
  const patchTargets = Array.isArray(invalidPatch?.selected_todo?.patch_targets)
    ? invalidPatch.selected_todo.patch_targets
    : [];
  const feedback = {
    schema_version: 1,
    kind: 'phase_loop_invalid_patch_repair_feedback',
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    completed: false,
    reason: 'supervisor_invalid_workspace_write_patch',
    selected_todo: selectedTodo,
    selected_todo_first_line: todoFirstLine(selectedTodo) ?? invalidPatch?.selected_todo?.first_line ?? null,
    invalid_patch: invalidPatch,
    repair_hint: [
      'The previous workspace.write patch_file did not apply because old_text was not found in the current target.',
      'Do not repeat the same old_text and do not copy stale previews.',
      'If validation says old_text matches inside a word, the next old_text must include the complete current line or a syntactic block with surrounding context; never use an identifier fragment, suffix, prefix, or other sub-token match.',
      'If exact current context is missing, request exactly one bounded workspace.read for the selected target; otherwise emit one smaller workspace.write patch_file hunk whose old_text exists now.',
      'Patch .brownie/todo.md only if the selected TODO contract is impossible.'
    ].join(' '),
    semantic_repair_policy: {
      mode: 'invalid_patch_exact_context_repair',
      selected_patch_targets: patchTargets,
      must_preserve_selected_todo_intent: true,
      must_not_repeat_invalid_patch: true,
      must_not_use_subtoken_old_text: true,
      must_not_only_make_checks_green: true,
      allowed_next_actions: [
        'request exactly one bounded workspace.read for the selected target if exact current context is missing',
        'emit exactly one smaller workspace.write patch_file hunk whose old_text exists in the current target and spans a complete line or syntactic block',
        'patch .brownie/todo.md only if the selected TODO contract is impossible',
        'report one concrete blocker if the selected target cannot satisfy the completion condition'
      ],
      forbidden_next_actions: [
        'repeat the same invalid old_text',
        'use old_text that matches inside a word or identifier',
        'copy old_text from stale llm_response_previews',
        'write .brownie/todo.md to avoid a repairable target patch',
        'modify unrelated files',
        'remove selected TODO without passing verification'
      ]
    },
    generated_by: 'phase-loop-supervisor-control'
  };
  try {
    fs.mkdirSync(path.dirname(feedbackPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(feedbackPath, `${JSON.stringify(feedback, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fsyncFileAndParent(feedbackPath);
    return {
      attempted: true,
      ok: true,
      path: path.relative(repoRoot, feedbackPath)
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error?.message ?? String(error)
    };
  }
}

const defaultWorkerLaunchReceiptPath = '.brownie/private/phase-loop/worker-launch-receipt.json';
const defaultWorkerLaunchReceiptDirectory = '.brownie/private/phase-loop/worker-launch-receipts';

function parseIsoTimestamp(value) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return null;
  return new Date(value);
}

function workerLaunchReceiptPath(repoRoot, receiptPath = defaultWorkerLaunchReceiptPath) {
  const absolute = path.resolve(repoRoot, receiptPath);
  if (absolute !== repoRoot && !absolute.startsWith(repoRoot + path.sep)) {
    throw new Error('worker launch receipt path must remain inside the repository');
  }
  return absolute;
}

export function inspectWorkerLaunchReceipt(repoRoot, options = {}) {
  const receiptPath = workerLaunchReceiptPath(repoRoot, options.receiptPath);
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const claim = readJsonOrNull(path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/current.json')) ?? {};
  const feedback = readJsonOrNull(path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/repair-feedback.json')) ?? {};
  const delegation = feedback.delegation && typeof feedback.delegation === 'object' ? feedback.delegation : {};
  if (!fs.existsSync(receiptPath)) {
    return { ok: false, reason: 'dispatch_not_started', receipt_path: path.relative(repoRoot, receiptPath) };
  }
  const receipt = readJsonOrNull(receiptPath);
  if (!receipt || receipt.kind !== 'phase_loop_worker_launch_receipt') {
    return { ok: false, reason: 'dispatch_not_started', receipt_path: path.relative(repoRoot, receiptPath) };
  }
  const required = ['launch_id', 'actor', 'started_at', 'expires_at', 'last_heartbeat_at', 'heartbeat_interval_seconds', 'idempotency_key'];
  if (required.some((key) => !receipt[key])) {
    return { ok: false, reason: 'dispatch_not_started', detail: 'worker_launch_receipt_missing_required_field', receipt_path: path.relative(repoRoot, receiptPath) };
  }
  if (receipt.actor !== 'brownie-agent') {
    return { ok: false, reason: 'dispatch_not_started', detail: 'worker_launch_actor_mismatch', actor: receipt.actor };
  }
  if (receipt.status && receipt.status !== 'active') {
    return { ok: false, reason: 'dispatch_not_started', detail: 'worker_launch_receipt_not_active', status: receipt.status };
  }
  const startedAt = parseIsoTimestamp(receipt.started_at);
  const expiresAt = parseIsoTimestamp(receipt.expires_at);
  const heartbeatAt = parseIsoTimestamp(receipt.last_heartbeat_at);
  const heartbeatInterval = Number(receipt.heartbeat_interval_seconds);
  if (!startedAt || !expiresAt || !heartbeatAt || !Number.isFinite(heartbeatInterval) || heartbeatInterval <= 0) {
    return { ok: false, reason: 'dispatch_not_started', detail: 'worker_launch_receipt_invalid_time_contract' };
  }
  if (startedAt > now || expiresAt <= now || heartbeatAt > now) {
    return { ok: false, reason: 'worker_liveness_missing', detail: 'worker_launch_receipt_expired_or_future' };
  }
  if (now.getTime() - heartbeatAt.getTime() > heartbeatInterval * 2000) {
    return { ok: false, reason: 'worker_liveness_missing', detail: 'worker_heartbeat_expired' };
  }
  const receiptClaimId = typeof receipt.claim_id === 'string' ? receipt.claim_id.trim() : '';
  const currentClaimId = typeof claim.claim_id === 'string' ? claim.claim_id.trim() : '';
  if (currentClaimId && receiptClaimId !== currentClaimId) {
    return { ok: false, reason: 'dispatch_not_started', detail: 'worker_launch_claim_mismatch', claim_id: receiptClaimId };
  }
  const targetPr = typeof receipt.target_pr_url === 'string' ? receipt.target_pr_url.trim() : '';
  const delegatedPr = typeof delegation.issue_or_pr_url === 'string' ? delegation.issue_or_pr_url.trim() : '';
  if (!receiptClaimId && !targetPr) {
    return { ok: false, reason: 'dispatch_not_started', detail: 'worker_launch_target_missing' };
  }
  if (delegatedPr && targetPr !== delegatedPr) {
    return { ok: false, reason: 'dispatch_not_started', detail: 'worker_launch_pr_mismatch', target_pr_url: targetPr };
  }
  const receiptDirectory = path.join(repoRoot, defaultWorkerLaunchReceiptDirectory);
  let historical = [];
  try {
    historical = fs.readdirSync(receiptDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => readJsonOrNull(path.join(receiptDirectory, entry.name)))
      .filter(Boolean);
  } catch {
    historical = [];
  }
  const duplicate = historical.find((candidate) => (
    candidate.idempotency_key === receipt.idempotency_key && candidate.launch_id !== receipt.launch_id
  ));
  if (duplicate) {
    return { ok: false, reason: 'duplicate_worker_launch', idempotency_key: receipt.idempotency_key, existing_launch_id: duplicate.launch_id, launch_id: receipt.launch_id };
  }
  return {
    ok: true,
    reason: 'worker_liveness_verified',
    receipt_path: path.relative(repoRoot, receiptPath),
    launch_id: receipt.launch_id,
    actor: receipt.actor,
    claim_id: receiptClaimId || null,
    target_pr_url: targetPr || null,
    idempotency_key: receipt.idempotency_key
  };
}

export function registerWorkerLaunchReceipt(repoRoot, receipt, options = {}) {
  const receiptPath = workerLaunchReceiptPath(repoRoot, options.receiptPath);
  const receiptDirectory = path.join(repoRoot, defaultWorkerLaunchReceiptDirectory);
  if (!receipt || typeof receipt !== 'object' || receipt.kind !== 'phase_loop_worker_launch_receipt') {
    return { ok: false, reason: 'dispatch_not_started', detail: 'worker_launch_receipt_invalid' };
  }
  fs.mkdirSync(receiptDirectory, { recursive: true, mode: 0o700 });
  const historical = fs.readdirSync(receiptDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => readJsonOrNull(path.join(receiptDirectory, entry.name)))
    .filter(Boolean);
  const duplicate = historical.find((candidate) => (
    candidate.idempotency_key === receipt.idempotency_key && candidate.launch_id !== receipt.launch_id
  ));
  if (duplicate) {
    return { ok: false, reason: 'duplicate_worker_launch', existing_launch_id: duplicate.launch_id, idempotency_key: receipt.idempotency_key };
  }
  const current = readJsonOrNull(receiptPath);
  if (current?.idempotency_key === receipt.idempotency_key && current?.launch_id === receipt.launch_id) {
    return { ok: true, replayed: true, receipt_path: path.relative(repoRoot, receiptPath) };
  }
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  const archivePath = path.join(receiptDirectory, String(receipt.launch_id).replace(/[^A-Za-z0-9_.-]+/gu, '-') + '.json');
  fs.writeFileSync(archivePath, JSON.stringify(receipt, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  fsyncFileAndParent(receiptPath);
  fsyncFileAndParent(archivePath);
  return { ok: true, replayed: false, receipt_path: path.relative(repoRoot, receiptPath), archive_path: path.relative(repoRoot, archivePath) };
}

function maybeStartPhaseLoop(repoRoot, enabled, diagnostic, options = {}) {
  if (!enabled) {
    return { attempted: false, reason: 'start_not_requested' };
  }
  if (issueCodes(diagnostic).has('delivery_required')) {
    return {
      attempted: false,
      reason: 'delivery_required_not_starting',
      next_action: 'verify_commit_push_pr_review_merge'
    };
  }
  if (issueCodes(diagnostic).has('merged_delivery_pending_reconciliation') || issueCodes(diagnostic).has('delivery_reconciliation_blocked')) {
    return {
      attempted: false,
      reason: 'delivery_reconciliation_required_not_starting',
      next_action: 'reconcile_merged_delivery_then_run_preflight'
    };
  }
  const status = diagnostic.phase_loop?.status;
  if (diagnostic.summary?.healthy && (status === 'running' || status === 'last_run_succeeded')) {
    return { attempted: false, reason: 'phase_loop_already_healthy' };
  }
  const workerLaunch = inspectWorkerLaunchReceipt(repoRoot, {
    receiptPath: options.workerLaunchReceiptPath,
    now: options.now
  });
  if (!workerLaunch.ok) {
    return {
      attempted: false,
      reason: workerLaunch.reason,
      worker_launch_receipt: workerLaunch
    };
  }
  try {
    const stdout = runTextCommand(repoRoot, './phase-loop.sh', ['start']);
    return { attempted: true, ok: true, stdout };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error?.message ?? String(error),
      stdout: error?.stdout?.toString?.() ?? undefined,
      stderr: error?.stderr?.toString?.() ?? undefined
    };
  }
}

export function controlPhaseLoop(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const delegationProvenanceVerifier = options.delegationProvenanceVerifier
    ?? ((_, pullRequestUrl, implementationCommit) => verifyDelegationPullRequestProvenance(
      repoRoot,
      pullRequestUrl,
      implementationCommit
    ));
  const initial = diagnosePhaseLoop({ repoRoot, write: options.write !== false });
  const failureLedger = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : appendFailureLedgerEvent(repoRoot, initial);
  const ledgerSummary = failureLedgerSummary(repoRoot, initial, failureLedger);
  const queueIntegrityRepair = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : maybeRepairTodoQueueIntegrity(repoRoot, initial);
  const afterQueueIntegrityRepair = queueIntegrityRepair.attempted && queueIntegrityRepair.ok
    ? diagnosePhaseLoop({ repoRoot, write: options.write !== false })
    : initial;
  const todoContractRepair = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : maybeRepairTodoContract(repoRoot, afterQueueIntegrityRepair);
  const afterTodoContractRepair = todoContractRepair.attempted && todoContractRepair.ok
    ? diagnosePhaseLoop({ repoRoot, write: options.write !== false })
    : afterQueueIntegrityRepair;
  const derivedTodoPrefixRepair = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : maybeRepairDerivedTodoPrefixAndLedger(repoRoot, afterTodoContractRepair);
  const afterDerivedTodoPrefixRepair = derivedTodoPrefixRepair.attempted && derivedTodoPrefixRepair.ok
    ? diagnosePhaseLoop({ repoRoot, write: options.write !== false })
    : afterTodoContractRepair;
  const missingDerivedBreakdownLedgerRepair = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : maybeRepairMissingDerivedBreakdownLedger(repoRoot, afterDerivedTodoPrefixRepair);
  const afterMissingDerivedBreakdownLedgerRepair = missingDerivedBreakdownLedgerRepair.attempted && missingDerivedBreakdownLedgerRepair.ok
    ? diagnosePhaseLoop({ repoRoot, write: options.write !== false })
    : afterDerivedTodoPrefixRepair;
  const legacyDerivedBreakdownLedgerMigration = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : maybeMigrateLegacyDerivedBreakdownLedger(repoRoot);
  const afterRepair = legacyDerivedBreakdownLedgerMigration.attempted && legacyDerivedBreakdownLedgerMigration.ok
    ? diagnosePhaseLoop({ repoRoot, write: options.write !== false })
    : afterMissingDerivedBreakdownLedgerRepair;
  const acknowledgedDelegationReconciliation = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : maybeReconcileAcknowledgedDelegation(repoRoot, delegationProvenanceVerifier);
  const afterAcknowledgedDelegationReconciliation = acknowledgedDelegationReconciliation.attempted
    && acknowledgedDelegationReconciliation.ok
    ? diagnosePhaseLoop({ repoRoot, write: options.write !== false })
    : afterRepair;
  const nonLiveTodoResidueRepair = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : maybeRepairNonLiveTodoResidue(repoRoot, afterAcknowledgedDelegationReconciliation);
  const afterResidueRepair = nonLiveTodoResidueRepair.attempted && nonLiveTodoResidueRepair.ok
    ? diagnosePhaseLoop({ repoRoot, write: options.write !== false })
    : afterAcknowledgedDelegationReconciliation;
  const staleActiveClaimRepair = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : maybeArchiveStaleActiveClaim(repoRoot, afterResidueRepair);
  const afterClaimRepair = staleActiveClaimRepair.attempted && staleActiveClaimRepair.ok
    ? diagnosePhaseLoop({ repoRoot, write: options.write !== false })
    : afterResidueRepair;
  const rejectedBoundedLeafReplanResidueRepair = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : maybeRepairRejectedBoundedLeafReplanResidue(repoRoot, afterClaimRepair);
  const afterRejectedBoundedLeafReplanResidueRepair = rejectedBoundedLeafReplanResidueRepair.attempted && rejectedBoundedLeafReplanResidueRepair.ok
    ? diagnosePhaseLoop({ repoRoot, write: options.write !== false })
    : afterClaimRepair;
  const terminalNoEligibleClaimRepair = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : maybeArchiveTerminalNoEligibleActiveClaim(repoRoot, afterRejectedBoundedLeafReplanResidueRepair, ledgerSummary);
  const afterTerminalNoEligibleClaimRepair = terminalNoEligibleClaimRepair.attempted && terminalNoEligibleClaimRepair.ok
    ? diagnosePhaseLoop({ repoRoot, write: options.write !== false })
    : afterRejectedBoundedLeafReplanResidueRepair;
  const completedLeafRecovery = completedLeafRecoveryState(repoRoot, afterTerminalNoEligibleClaimRepair);
  const completedLeafFeedbackResolution = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : maybeResolveCompletedLeafRepairFeedback(repoRoot, completedLeafRecovery);
  const afterCompletedLeafFeedbackResolution = completedLeafFeedbackResolution.attempted
    && completedLeafFeedbackResolution.ok
    ? diagnosePhaseLoop({ repoRoot, write: options.write !== false })
    : afterTerminalNoEligibleClaimRepair;
  const selectedTargetRedelegation = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : completedLeafRecovery.completed
      ? { attempted: false, reason: 'completed_leaf_failure_suppressed' }
      : maybeWriteSelectedTargetRedelegationFeedback(repoRoot, afterCompletedLeafFeedbackResolution);
  // A rejected refinement of an already bounded leaf is not evidence that the
  // leaf needs another decomposition.  It is a targeted execution failure:
  // retain the leaf contract and force the next worker turn onto its declared
  // patch target.  This must win over the generic no-progress ledger, which
  // can otherwise turn one rejected refinement into an endless replan chain.
  const boundedLeafApplyRejectionRepair = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : completedLeafRecovery.completed
      ? { attempted: false, reason: 'completed_leaf_failure_suppressed' }
      : selectedTargetRedelegation.attempted && selectedTargetRedelegation.ok
        ? { attempted: false, reason: 'selected_target_redelegation_takes_precedence' }
      : maybeWriteBoundedLeafApplyRejectionFeedback(repoRoot, afterCompletedLeafFeedbackResolution);
  const terminalStalledReplanRecovery = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : completedLeafRecovery.completed
      ? { attempted: false, reason: 'completed_leaf_failure_suppressed' }
      : selectedTargetRedelegation.attempted && selectedTargetRedelegation.ok
        ? { attempted: false, reason: 'selected_target_redelegation_takes_precedence' }
      : maybeRecoverTerminalStalledReplan(repoRoot, afterCompletedLeafFeedbackResolution);
  const delegationPendingRepair = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : completedLeafRecovery.completed
      ? { attempted: false, reason: 'completed_leaf_failure_suppressed' }
      : selectedTargetRedelegation.attempted && selectedTargetRedelegation.ok
        ? { attempted: false, reason: 'selected_target_redelegation_takes_precedence' }
      : maybeWriteDelegationPendingFeedback(repoRoot, afterCompletedLeafFeedbackResolution, ledgerSummary);
  const todoContractReplanRepair = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : completedLeafRecovery.completed
      ? { attempted: false, reason: 'selected_todo_not_live_after_durable_completion', todo_id: completedLeafRecovery.todo_id }
    : selectedTargetRedelegation.attempted && selectedTargetRedelegation.ok
      ? { attempted: false, reason: 'selected_target_redelegation_takes_precedence' }
    : boundedLeafApplyRejectionRepair.attempted && boundedLeafApplyRejectionRepair.ok
      ? { attempted: false, reason: 'bounded_leaf_target_patch_takes_precedence' }
      : delegationPendingRepair.attempted && delegationPendingRepair.ok
        ? { attempted: false, reason: 'delegation_pending_blocks_same_scope_replan' }
      : terminalStalledReplanRecovery.attempted && terminalStalledReplanRecovery.ok
        ? { attempted: false, reason: 'terminal_stalled_replan_recovered_to_bounded_leaf' }
      : maybeWriteTodoContractReplanFeedback(repoRoot, afterCompletedLeafFeedbackResolution, ledgerSummary);
  // A retained diagnostic can outlive the leaf it describes.  Once the
  // failure-ledger path has verified a durable completion receipt, no later
  // repair writer may recreate feedback for that completed leaf.
  const completedLeafFailureSuppressed = completedLeafRecovery.completed;
  const stalledTodoBlocked = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : todoContractReplanRepair.attempted && todoContractReplanRepair.ok
      ? appendStalledTodoBlockedRecord(repoRoot, afterTerminalNoEligibleClaimRepair, ledgerSummary)
      : { attempted: false, reason: 'todo_contract_replan_not_active' };
  const stalledTodoDecomposition = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : todoContractReplanRepair.attempted && todoContractReplanRepair.ok && stalledTodoBlocked.ok === true
      ? ensureStalledTodoDecompositionRequest(repoRoot, afterTerminalNoEligibleClaimRepair, ledgerSummary)
      : {
          attempted: false,
          reason: todoContractReplanRepair.attempted && todoContractReplanRepair.ok
            ? 'stalled_todo_block_record_not_ready'
            : 'todo_contract_replan_not_active'
        };
  // Replanning can replace the selected live TODO.  Re-diagnose after the
  // queue mutation and archive the old claim before any subsequent start, so
  // the worker cannot immediately re-claim the superseded contract.
  const afterTodoContractReplan = (
    stalledTodoDecomposition.attempted && stalledTodoDecomposition.ok
  ) || (
    terminalStalledReplanRecovery.attempted && terminalStalledReplanRecovery.ok
  )
    ? diagnosePhaseLoop({ repoRoot, write: options.write !== false })
    : afterCompletedLeafFeedbackResolution;
  const postReplanStaleActiveClaimRepair = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : (
      stalledTodoDecomposition.attempted && stalledTodoDecomposition.ok
    ) || (
      terminalStalledReplanRecovery.attempted && terminalStalledReplanRecovery.ok
    )
      ? maybeArchiveStaleActiveClaim(repoRoot, afterTodoContractReplan)
      : { attempted: false, reason: 'todo_contract_replan_not_applied' };
  const afterPostReplanClaimRepair = postReplanStaleActiveClaimRepair.attempted && postReplanStaleActiveClaimRepair.ok
    ? diagnosePhaseLoop({ repoRoot, write: options.write !== false })
    : afterTodoContractReplan;
  const resolvedRepairFeedbackArchive = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : completedLeafRecovery.completed
      ? { attempted: false, reason: 'completed_leaf_feedback_already_resolved' }
    : maybeArchiveResolvedRepairFeedback(repoRoot);
  const afterResolvedRepairFeedback = resolvedRepairFeedbackArchive.attempted && resolvedRepairFeedbackArchive.ok
    ? diagnosePhaseLoop({ repoRoot, write: options.write !== false })
    : afterPostReplanClaimRepair;
  const semanticVerificationRepair = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : completedLeafFailureSuppressed
      ? { attempted: false, reason: 'completed_leaf_failure_suppressed' }
    : selectedTargetRedelegation.attempted && selectedTargetRedelegation.ok
      ? { attempted: false, reason: 'selected_target_redelegation_takes_precedence' }
    : boundedLeafApplyRejectionRepair.attempted && boundedLeafApplyRejectionRepair.ok
      ? { attempted: false, reason: 'bounded_leaf_target_patch_takes_precedence' }
      : delegationPendingRepair.attempted
      ? { attempted: false, reason: 'delegation_pending_takes_precedence' }
      : todoContractReplanRepair.attempted && todoContractReplanRepair.ok
      ? { attempted: false, reason: 'todo_contract_replan_feedback_takes_precedence' }
      : maybeWriteSemanticVerificationRepairFeedback(repoRoot, afterResolvedRepairFeedback);
  const invalidPatchRepair = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : completedLeafFailureSuppressed
      ? { attempted: false, reason: 'completed_leaf_failure_suppressed' }
    : selectedTargetRedelegation.attempted && selectedTargetRedelegation.ok
      ? { attempted: false, reason: 'selected_target_redelegation_takes_precedence' }
    : boundedLeafApplyRejectionRepair.attempted && boundedLeafApplyRejectionRepair.ok
      ? { attempted: false, reason: 'bounded_leaf_target_patch_takes_precedence' }
      : delegationPendingRepair.attempted
      ? { attempted: false, reason: 'delegation_pending_takes_precedence' }
      : todoContractReplanRepair.attempted && todoContractReplanRepair.ok
      ? { attempted: false, reason: 'todo_contract_replan_feedback_takes_precedence' }
      : maybeWriteInvalidPatchRepairFeedback(repoRoot, afterResolvedRepairFeedback);
  const repairResults = {
    failure_ledger: failureLedger,
    todo_queue_integrity: queueIntegrityRepair,
    todo_contract: todoContractRepair,
    derived_todo_prefix_ledger: derivedTodoPrefixRepair,
    missing_derived_breakdown_ledger: missingDerivedBreakdownLedgerRepair,
    legacy_derived_breakdown_ledger_migration: legacyDerivedBreakdownLedgerMigration,
    todo_contract_replan: todoContractReplanRepair,
    stalled_todo_blocked: stalledTodoBlocked,
    stalled_todo_decomposition: stalledTodoDecomposition,
    post_replan_stale_active_claim: postReplanStaleActiveClaimRepair,
    non_live_todo_residue: nonLiveTodoResidueRepair,
    rejected_bounded_leaf_replan_residue: rejectedBoundedLeafReplanResidueRepair,
    stale_active_claim: staleActiveClaimRepair,
    terminal_no_eligible_claim: terminalNoEligibleClaimRepair,
    completed_leaf_recovery: completedLeafRecovery,
    completed_leaf_feedback_resolution: completedLeafFeedbackResolution,
    selected_target_redelegation: selectedTargetRedelegation,
    acknowledged_delegation_reconciliation: acknowledgedDelegationReconciliation,
    delegation_pending: delegationPendingRepair,
    semantic_verification: semanticVerificationRepair,
    invalid_patch: invalidPatchRepair,
    bounded_leaf_apply_rejection: boundedLeafApplyRejectionRepair,
    terminal_stalled_replan_recovery: terminalStalledReplanRecovery,
    resolved_repair_feedback_archive: resolvedRepairFeedbackArchive
  };
  const postRepair = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : postRepairValidation(repoRoot, repairResults, afterPostReplanClaimRepair);
  const terminalClaimRecoveryBlocked = (
    terminalNoEligibleClaimRepair.reason === 'workspace_changed_or_dirty_not_archiving_claim'
    || terminalNoEligibleClaimRepair.reason === 'active_claim_unreadable_or_invalid'
  );
  const postReplanClaimArchivalFailed = postReplanStaleActiveClaimRepair.attempted
    && postReplanStaleActiveClaimRepair.ok === false;
  const todoContractReplanFailed = todoContractReplanRepair.attempted
    && todoContractReplanRepair.ok === false;
  const completedLeafFeedbackResolutionFailed = completedLeafFeedbackResolution.attempted
    && completedLeafFeedbackResolution.ok === false;
  // A controller self-update is a distinct Brownie run.  It is intentionally
  // dispatched before, and instead of, restarting the normal supervisor: the
  // worker may change the controller/runtime that selected the stopped state.
  // Starting the old controller in parallel would reintroduce the same loop.
  const selfUpdateDispatcher = options.selfUpdateDispatcher ?? dispatchSelfUpdate;
  const selfUpdateRequested = typeof options.selfUpdateRequest === 'string';
  const selfUpdate = selfUpdateRequested
    ? selfUpdateDispatcher({ repoRoot, request: options.selfUpdateRequest })
    : { dispatched: false, reason: 'self_update_not_requested' };
  const start = selfUpdateRequested && !selfUpdate.dispatched
    ? {
        attempted: false,
        reason: 'self_update_request_not_dispatched_not_starting',
        self_update: selfUpdate
      }
    : selfUpdate.dispatched
    ? {
        attempted: false,
        reason: selfUpdate.ok
          ? 'self_update_dispatched_requires_review_and_delivery'
          : 'self_update_failed_not_starting',
        self_update: selfUpdate
      }
    : selfUpdate.retry?.reason === 'self_update_retry_backoff_active'
      ? { attempted: false, reason: 'self_update_retry_backoff_active_not_starting', self_update: selfUpdate }
      : selfUpdate.retry?.reason === 'self_update_retry_budget_exhausted'
        ? { attempted: false, reason: 'self_update_retry_budget_exhausted_not_starting', self_update: selfUpdate }
    : postRepair.attempted && !postRepair.ok
    ? { attempted: false, reason: 'post_repair_validation_failed', validation: postRepair }
    : completedLeafFeedbackResolutionFailed
    ? {
        attempted: false,
        reason: 'completed_leaf_feedback_resolution_failed_not_starting',
        completed_leaf_feedback_resolution: completedLeafFeedbackResolution
      }
    : todoContractReplanFailed
    ? {
        attempted: false,
        reason: 'todo_contract_replan_failed_not_starting',
        todo_contract_replan: todoContractReplanRepair
      }
    : postReplanClaimArchivalFailed
      ? {
          attempted: false,
          reason: 'post_replan_stale_claim_archive_failed',
          post_replan_stale_active_claim: postReplanStaleActiveClaimRepair
        }
    : terminalClaimRecoveryBlocked
      ? {
          attempted: false,
          reason: 'terminal_no_eligible_claim_requires_verified_baseline',
          terminal_claim_repair: terminalNoEligibleClaimRepair
        }
    : maybeStartPhaseLoop(repoRoot, Boolean(options.start), afterResolvedRepairFeedback, {
      workerLaunchReceiptPath: options.workerLaunchReceiptPath,
      now: options.now
    });
  const final = start.attempted && start.ok
    ? diagnosePhaseLoop({ repoRoot, write: options.write !== false })
    : afterResolvedRepairFeedback;
  return {
    schema_version: 1,
    control_kind: 'brownie_phase_loop_supervisor_control',
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    repo_root: repoRoot,
    initial_summary: initial.summary,
    repair: {
      failure_ledger: failureLedger,
      failure_ledger_summary: ledgerSummary,
      todo_queue_integrity: queueIntegrityRepair,
      todo_contract: todoContractRepair,
      derived_todo_prefix_ledger: derivedTodoPrefixRepair,
      missing_derived_breakdown_ledger: missingDerivedBreakdownLedgerRepair,
      legacy_derived_breakdown_ledger_migration: legacyDerivedBreakdownLedgerMigration,
      todo_contract_replan: todoContractReplanRepair,
      stalled_todo_blocked: stalledTodoBlocked,
      stalled_todo_decomposition: stalledTodoDecomposition,
      post_replan_stale_active_claim: postReplanStaleActiveClaimRepair,
      non_live_todo_residue: nonLiveTodoResidueRepair,
      rejected_bounded_leaf_replan_residue: rejectedBoundedLeafReplanResidueRepair,
      stale_active_claim: staleActiveClaimRepair,
      terminal_no_eligible_claim: terminalNoEligibleClaimRepair,
      completed_leaf_recovery: completedLeafRecovery,
      completed_leaf_feedback_resolution: completedLeafFeedbackResolution,
      selected_target_redelegation: selectedTargetRedelegation,
      acknowledged_delegation_reconciliation: acknowledgedDelegationReconciliation,
      delegation_pending: delegationPendingRepair,
      semantic_verification: semanticVerificationRepair,
      invalid_patch: invalidPatchRepair,
      bounded_leaf_apply_rejection: boundedLeafApplyRejectionRepair,
      terminal_stalled_replan_recovery: terminalStalledReplanRecovery,
      resolved_repair_feedback_archive: resolvedRepairFeedbackArchive,
      post_repair_validation: postRepair
    },
    self_update: selfUpdate,
    start,
    final_summary: final.summary,
    final_phase_loop: final.phase_loop,
    final_issues: final.issues
  };
}

if (process.argv[1] === __filename) {
  const args = parseArgs(process.argv);
  const result = controlPhaseLoop({
    repoRoot: args.repo,
    write: args.write,
    repair: args.repair,
    start: args.start,
    selfUpdateRequest: args.selfUpdateRequest,
    workerLaunchReceiptPath: args.workerLaunchReceiptPath
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.final_summary.healthy ? 0 : 1);
}
