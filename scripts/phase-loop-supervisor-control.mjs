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
    selfUpdateRequest: null
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
  const validatesCurrentTodoQueue = feedback.kind === 'phase_loop_todo_contract_replan_feedback'
    || feedbackReason === 'todo_decomposition_guard_failed_after_todo_apply';
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
    kind,
    status: diagnostic.phase_loop?.status ?? null,
    status_run_id: diagnostic.phase_loop?.run_id ?? null,
    progress_classification: diagnostic.progress?.classification ?? null,
    progress_run_stamp: diagnostic.progress?.run_stamp ?? null,
    progress_fingerprint: diagnostic.progress?.last_progress_fingerprint ?? null,
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
  const events = [
    ...ledger,
    currentEventResult?.event && !ledger.some((entry) => entry?.event_id === currentEventResult.event.event_id)
      ? currentEventResult.event
      : null
  ].filter(Boolean);
  const sameTodoEvents = events
    .filter((entry) => entry?.todo_id === todoId)
    .slice(-12);
  const counts = sameTodoEvents.reduce((acc, entry) => {
    acc[entry.kind] = (acc[entry.kind] ?? 0) + 1;
    return acc;
  }, {});
  const progressSameCount = Number(diagnostic.progress?.same_progress_count ?? 0);
  const progressFingerprint = diagnostic.progress?.last_progress_fingerprint ?? null;
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
  const codes = issueCodes(diagnostic);
  const repairableInvalidPatch = invalidPatchNeedsExactContextRepair(diagnostic.invalid_patch);
  const invalidPatchWithRepeatedNoProgress = codes.has('invalid_workspace_write_patch_repeated') && progressSameCount >= 2 && !repairableInvalidPatch;
  const semanticFailureWithRepeatedNoProgress = codes.has('verification_failure_requires_semantic_repair') && progressSameCount >= 2;
  const invalidPatchThenNoProgress = (counts.invalid_patch ?? 0) >= 1 && (counts.no_progress ?? 0) >= 1 && !repairableInvalidPatch;
  // Claim migration/rebaseline can legitimately reset progress-state's local
  // counter.  Preserve convergence across those boundaries by counting
  // no-progress events for the same TODO in the durable failure ledger.
  const repeatedNoProgressInLedger = sameFingerprintNoProgressCount >= 3;
  const shouldReplan = (
    progressSameCount >= 3 ||
    repeatedNoProgressInLedger ||
    invalidPatchWithRepeatedNoProgress ||
    semanticFailureWithRepeatedNoProgress ||
    invalidPatchThenNoProgress ||
    ((counts.invalid_patch ?? 0) >= 2 && !repairableInvalidPatch) ||
    (counts.semantic_verification_failure ?? 0) >= 2 ||
    (counts.semantic_verification_stalled ?? 0) >= 1 ||
    codes.has('semantic_verification_repair_stalled')
  );
  let replanReason = 'threshold_not_met';
  if (shouldReplan) {
    if (progressSameCount >= 3) {
      replanReason = 'same_todo_no_progress_threshold';
    } else if (repeatedNoProgressInLedger) {
      replanReason = 'same_todo_no_progress_ledger_threshold';
    } else if (invalidPatchWithRepeatedNoProgress) {
      replanReason = 'invalid_patch_with_repeated_no_progress';
    } else if (semanticFailureWithRepeatedNoProgress) {
      replanReason = 'semantic_failure_with_repeated_no_progress';
    } else if (invalidPatchThenNoProgress) {
      replanReason = 'invalid_patch_followed_by_no_progress';
    } else if ((counts.invalid_patch ?? 0) >= 2) {
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
    current_progress_fingerprint: progressFingerprint,
    same_fingerprint_no_progress_count: sameFingerprintNoProgressCount,
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
  const existing = fs.existsSync(blockedPath) ? readJsonl(blockedPath) : [];
  const alreadyRecorded = existing.some((record) => (
    record?.block_reason === 'stalled_leaf_contract_replan' &&
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
    controller_fingerprint: phaseLoopControllerFingerprint(repoRoot),
    todo_id: ledgerSummary.todo_id,
    selected_todo_sha256: selectedHash,
    selected_todo_first_line: firstLine
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
      pruned.push({ from: raw, to: nextValue });
      return `${prefix}${nextValue}${trailing}`;
    }
  );
  return { text, changed: pruned.length > 0, pruned };
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
    paths: ['.brownie/todo.md', ...(breakdownRemoved.length > 0 ? ['.brownie/todo-breakdown.md'] : [])],
    removed_todo_ids: removedBlocks.removed,
    invalidated_completion_record_count: todoState.invalidatedCompletionRecords.length,
    pruned_dependency_lines: prunedDepends.pruned,
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
  const selectedId = selected.id ?? todoIdFromFirstLine(selected.first_line);
  const terminalNoProposal = diagnostic.phase_loop?.status === 'no_progress'
    && String(diagnostic.phase_loop?.detail ?? '').includes('objective_apply_stalled');
  if (!terminalNoProposal || !isStalledLeafReplanId(selectedId)) {
    return { attempted: false, reason: 'terminal_stalled_replan_not_reported' };
  }

  const todoPath = path.join(repoRoot, '.brownie/todo.md');
  const breakdownPath = path.join(repoRoot, '.brownie/todo-breakdown.md');
  const blockedPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/blocked.jsonl');
  const feedbackPath = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/repair-feedback.json');
  if (!fs.existsSync(todoPath)) {
    return { attempted: true, ok: false, reason: 'todo_missing' };
  }
  const todoText = fs.readFileSync(todoPath, 'utf8');
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
    paths: ['.brownie/todo.md', ...(breakdownRemoved.length > 0 ? ['.brownie/todo-breakdown.md'] : []), '.brownie/private/phase-loop/todo-claims/blocked.jsonl', '.brownie/private/phase-loop/todo-claims/repair-feedback.json']
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
    fs.rmSync(claimPath, { force: true });
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
    fs.rmSync(claimPath, { force: true });
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
      'Use separate implementation and test/evidence leaves when production code and tests must both change.',
      'Do not weaken guards/tests, do not invent release evidence values, and do not declare Runtime Product Ready.'
    ].join(' '),
    semantic_repair_policy: {
      mode: 'stalled_leaf_contract_replan',
      must_preserve_parent_intent: true,
      must_not_only_make_checks_green: true,
      must_not_weaken_guards_or_tests: true,
      must_not_repeat_failed_patch_or_same_leaf_attempt: true,
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

function maybeStartPhaseLoop(repoRoot, enabled, diagnostic) {
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
  const afterRepair = derivedTodoPrefixRepair.attempted && derivedTodoPrefixRepair.ok
    ? diagnosePhaseLoop({ repoRoot, write: options.write !== false })
    : afterTodoContractRepair;
  const nonLiveTodoResidueRepair = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : maybeRepairNonLiveTodoResidue(repoRoot, afterRepair);
  const afterResidueRepair = nonLiveTodoResidueRepair.attempted && nonLiveTodoResidueRepair.ok
    ? diagnosePhaseLoop({ repoRoot, write: options.write !== false })
    : afterRepair;
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
  // A rejected refinement of an already bounded leaf is not evidence that the
  // leaf needs another decomposition.  It is a targeted execution failure:
  // retain the leaf contract and force the next worker turn onto its declared
  // patch target.  This must win over the generic no-progress ledger, which
  // can otherwise turn one rejected refinement into an endless replan chain.
  const boundedLeafApplyRejectionRepair = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : maybeWriteBoundedLeafApplyRejectionFeedback(repoRoot, afterTerminalNoEligibleClaimRepair);
  const terminalStalledReplanRecovery = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : maybeRecoverTerminalStalledReplan(repoRoot, afterTerminalNoEligibleClaimRepair);
  const todoContractReplanRepair = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : boundedLeafApplyRejectionRepair.attempted && boundedLeafApplyRejectionRepair.ok
      ? { attempted: false, reason: 'bounded_leaf_target_patch_takes_precedence' }
      : terminalStalledReplanRecovery.attempted && terminalStalledReplanRecovery.ok
        ? { attempted: false, reason: 'terminal_stalled_replan_recovered_to_bounded_leaf' }
      : maybeWriteTodoContractReplanFeedback(repoRoot, afterTerminalNoEligibleClaimRepair, ledgerSummary);
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
    : afterTerminalNoEligibleClaimRepair;
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
    : maybeArchiveResolvedRepairFeedback(repoRoot);
  const afterResolvedRepairFeedback = resolvedRepairFeedbackArchive.attempted && resolvedRepairFeedbackArchive.ok
    ? diagnosePhaseLoop({ repoRoot, write: options.write !== false })
    : afterPostReplanClaimRepair;
  const semanticVerificationRepair = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : boundedLeafApplyRejectionRepair.attempted && boundedLeafApplyRejectionRepair.ok
      ? { attempted: false, reason: 'bounded_leaf_target_patch_takes_precedence' }
      : todoContractReplanRepair.attempted && todoContractReplanRepair.ok
      ? { attempted: false, reason: 'todo_contract_replan_feedback_takes_precedence' }
      : maybeWriteSemanticVerificationRepairFeedback(repoRoot, afterResolvedRepairFeedback);
  const invalidPatchRepair = options.repair === false
    ? { attempted: false, reason: 'repair_disabled' }
    : boundedLeafApplyRejectionRepair.attempted && boundedLeafApplyRejectionRepair.ok
      ? { attempted: false, reason: 'bounded_leaf_target_patch_takes_precedence' }
      : todoContractReplanRepair.attempted && todoContractReplanRepair.ok
      ? { attempted: false, reason: 'todo_contract_replan_feedback_takes_precedence' }
      : maybeWriteInvalidPatchRepairFeedback(repoRoot, afterResolvedRepairFeedback);
  const repairResults = {
    failure_ledger: failureLedger,
    todo_queue_integrity: queueIntegrityRepair,
    todo_contract: todoContractRepair,
    derived_todo_prefix_ledger: derivedTodoPrefixRepair,
    todo_contract_replan: todoContractReplanRepair,
    stalled_todo_blocked: stalledTodoBlocked,
    stalled_todo_decomposition: stalledTodoDecomposition,
    post_replan_stale_active_claim: postReplanStaleActiveClaimRepair,
    non_live_todo_residue: nonLiveTodoResidueRepair,
    rejected_bounded_leaf_replan_residue: rejectedBoundedLeafReplanResidueRepair,
    stale_active_claim: staleActiveClaimRepair,
    terminal_no_eligible_claim: terminalNoEligibleClaimRepair,
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
    : maybeStartPhaseLoop(repoRoot, Boolean(options.start), afterResolvedRepairFeedback);
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
      todo_contract_replan: todoContractReplanRepair,
      stalled_todo_blocked: stalledTodoBlocked,
      stalled_todo_decomposition: stalledTodoDecomposition,
      post_replan_stale_active_claim: postReplanStaleActiveClaimRepair,
      non_live_todo_residue: nonLiveTodoResidueRepair,
      rejected_bounded_leaf_replan_residue: rejectedBoundedLeafReplanResidueRepair,
      stale_active_claim: staleActiveClaimRepair,
      terminal_no_eligible_claim: terminalNoEligibleClaimRepair,
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
    selfUpdateRequest: args.selfUpdateRequest
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.final_summary.healthy ? 0 : 1);
}
