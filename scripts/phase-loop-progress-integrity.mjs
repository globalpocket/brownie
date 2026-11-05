#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadTodoState } from './phase-loop-todo-state.mjs';
import { boundedScopes } from './phase-loop-bounded-scope.mjs';
import {
  rootClaimId,
  selectedTodoSha256,
  validateMergedDeliveryReverification,
  validateTerminalDeliveryReceipt
} from './phase-loop-delivery-integrity.mjs';
import { supersededParentCleanMergedDeliveryRecovery } from './phase-loop-todo-evaluator.mjs';

const defaultTodoPath = '.brownie/todo.md';

function parseArgs(argv) {
  const args = {
    repo: process.cwd(),
    claim: '.brownie/private/phase-loop/todo-claims/current.json',
    todo: defaultTodoPath,
    runStamp: '',
    claimDir: '',
    writeRecord: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo') {
      args.repo = argv[++index];
    } else if (arg === '--claim') {
      args.claim = argv[++index];
    } else if (arg === '--todo') {
      args.todo = argv[++index];
    } else if (arg === '--run-stamp') {
      args.runStamp = argv[++index];
    } else if (arg === '--claim-dir') {
      args.claimDir = argv[++index];
    } else if (arg === '--write-record') {
      args.writeRecord = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function withoutWrittenAt(record) {
  const copy = { ...record };
  delete copy.written_at;
  return copy;
}

function maybeReadText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function git(repoRoot, args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function gitDiffFiles(repoRoot) {
  const changed = git(repoRoot, ['diff', '--name-only', 'HEAD', '--'])
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const untracked = git(repoRoot, ['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return normalizeFileList([...changed, ...untracked])
    .filter((entry) => !entry.startsWith('.brownie/private/'));
}

function normalizeFileList(files) {
  return [...new Set((Array.isArray(files) ? files : [])
    .map((entry) => String(entry).trim())
    .filter(Boolean))].sort();
}

function subtractFileList(files, baselineFiles) {
  const baseline = new Set(normalizeFileList(baselineFiles));
  return normalizeFileList(files).filter((file) => !baseline.has(file));
}

function gitHeadText(repoRoot, relativePath) {
  try {
    return git(repoRoot, ['show', `HEAD:${relativePath}`]);
  } catch {
    return null;
  }
}

export function uncheckedTodoBlocks(text) {
  const starts = [];
  const pattern = /^(?:[-*]|\d+[.)])\s+\[\s\]\s+/gm;
  let match;
  while ((match = pattern.exec(text ?? '')) !== null) {
    starts.push(match.index);
  }
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : text.length;
    return text.slice(start, end).trimEnd();
  });
}

function todoId(block) {
  const firstLine = block.split('\n')[0]?.trim() ?? '';
  const title = firstLine.replace(/^(?:[-*]|\d+[.)])\s+\[\s\]\s+/, '');
  return title.split(':')[0]?.trim() ?? '';
}

function blockMap(text) {
  const map = new Map();
  for (const block of uncheckedTodoBlocks(text ?? '')) {
    const id = todoId(block);
    if (id) {
      map.set(id, block);
    }
  }
  return map;
}

function firstLine(block) {
  return block.split('\n')[0]?.trim() ?? '';
}

function lineValue(block, label) {
  const prefix = `${label}:`;
  const line = block
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));
  return line ? line.slice(prefix.length).trim().replace(/[.]$/, '') : '';
}

function routeValue(block) {
  return lineValue(block, 'Route').toLowerCase();
}

function dependsValue(block) {
  return lineValue(block, 'Depends on');
}

function completionValue(block) {
  return lineValue(block, 'Completion condition');
}

function forbiddenValue(block) {
  return lineValue(block, 'Forbidden changes');
}

function verificationValue(block) {
  return lineValue(block, 'Verification');
}

function protectedContract(block) {
  return {
    id: todoId(block),
    first_line: firstLine(block),
    route: routeValue(block),
    depends_on: dependsValue(block),
    completion_condition: completionValue(block),
    forbidden_changes: forbiddenValue(block),
    verification: verificationValue(block),
    bounded_scopes: boundedScopes(firstLine(block))
  };
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function contractDrift(before, after) {
  const beforeContract = protectedContract(before);
  const afterContract = protectedContract(after);
  const drifts = [];
  for (const key of ['id', 'first_line', 'route', 'completion_condition', 'forbidden_changes', 'verification']) {
    if (beforeContract[key] !== afterContract[key]) {
      drifts.push(key);
    }
  }
  if (!sameArray(beforeContract.bounded_scopes, afterContract.bounded_scopes)) {
    drifts.push('bounded_scopes');
  }
  if (beforeContract.depends_on !== afterContract.depends_on) {
    drifts.push('depends_on');
  }
  return drifts;
}

function isTodoPath(file) {
  return file === 'todo.md' || file === '.brownie/todo.md';
}

function completionRecordPaths(repoRoot, claimId, runStamp) {
  const dir = path.join(repoRoot, '.brownie/private/phase-loop/todo-completions');
  return [
    claimId ? path.join(dir, `${claimId}.json`) : '',
    runStamp ? path.join(dir, `${runStamp}.json`) : ''
  ].filter(Boolean);
}

function completionRecordExists(repoRoot, claimId, runStamp) {
  return completionRecordPaths(repoRoot, claimId, runStamp).some((recordPath) => fs.existsSync(recordPath));
}

function isExplicitBlocker(block) {
  const lower = block.toLowerCase();
  return (
    lower.includes('blocker:') &&
    (
      lower.includes('forbidden changes: do not patch') ||
      lower.includes('no workspace file is patched') ||
      lower.includes('owner-controlled')
    )
  );
}

export function validatePhaseLoopProgressIntegrity(input) {
  const errors = [];
  const warnings = [];
  const claim = input.claim ?? {};
  const selected = typeof claim.selected_todo === 'string' ? claim.selected_todo : '';
  const selectedId = todoId(selected);
  const selectedRoute = routeValue(selected);
  const selectedScopes = boundedScopes(firstLine(selected));
  const diffFiles = normalizeFileList(input.diffFiles);
  const baselineDiffFiles = normalizeFileList(input.baselineDiffFiles ?? claim.baseline_diff_files);
  const claimChangedFiles = baselineDiffFiles.length > 0 ? subtractFileList(diffFiles, baselineDiffFiles) : diffFiles;
  const changedTodo = claimChangedFiles.some(isTodoPath) || Boolean((input.todoBefore ?? '') !== (input.todoAfter ?? ''));
  const nonTodoClaimChangedFiles = claimChangedFiles.filter((file) => !isTodoPath(file));
  const changedSelectedScopes = selectedScopes.filter((scope) => claimChangedFiles.includes(scope));
  const missingSelectedScopes = selectedScopes.filter((scope) => !claimChangedFiles.includes(scope));
  const baselineDirtySelectedScopes = selectedScopes.filter((scope) => baselineDiffFiles.includes(scope) && diffFiles.includes(scope));
  const allowedTargetChanged = changedSelectedScopes.length > 0;
  const selectedTargetDirtyAtBaseline = baselineDirtySelectedScopes.length > 0;
  const allSelectedTargetsChanged = selectedScopes.length === 0 || missingSelectedScopes.length === 0;
  const allSelectedTargetsDirtyAtBaseline = selectedScopes.length > 0 && baselineDirtySelectedScopes.length === selectedScopes.length;
  const beforeText = input.todoBefore ?? '';
  const afterText = input.todoAfter ?? '';
  const before = blockMap(beforeText);
  const after = blockMap(afterText);
  const beforeSelectedBlock = before.get(selectedId) ?? selected;
  const afterSelectedBlock = after.get(selectedId) ?? '';
  const selectedRemoved = Boolean(selectedId) && !after.has(selectedId);
  const selectedStillPending = Boolean(selectedId) && after.has(selectedId);
  const recordExists = Boolean(input.completionRecordExists);
  const completedIds = new Set(input.completedTodoIds ?? []);
  const routeCanEditTodoFreely = selectedRoute === 'todo-decomposition' || selectedId.startsWith('TODO-decompose-');
  const explicitBlocker = isExplicitBlocker(selected);
  const mergedDeliveryReverified = validateMergedDeliveryReverification({
    claim,
    evidence: claim.merged_delivery_reverification
  }).valid;

  if (!selectedId) {
    errors.push({
      code: 'missing_selected_todo',
      message: 'Active claim does not contain a selected TODO id.'
    });
  }

  if (
    selectedRoute &&
    ['implementation', 'documentation'].includes(selectedRoute) &&
    nonTodoClaimChangedFiles.length > 0 &&
    selectedScopes.length > 0 &&
    !allowedTargetChanged
  ) {
    errors.push({
      code: 'selected_target_not_changed',
      message: 'Workspace changed, but none of the selected TODO Patch only/Create only targets changed.',
      selected_todo_id: selectedId,
      selected_scopes: selectedScopes,
      changed_files: diffFiles,
      claim_changed_files: claimChangedFiles,
      baseline_diff_files: baselineDiffFiles
    });
  }

  if (changedTodo && !routeCanEditTodoFreely) {
    if (selectedRemoved && !recordExists && !explicitBlocker) {
      errors.push({
        code: 'selected_todo_removed_without_completion_record',
        message: 'Selected TODO was removed from the queue before a completion record was written.',
        selected_todo_id: selectedId
      });
    }
    if (selectedRemoved && selectedScopes.length > 0 && !allowedTargetChanged && !explicitBlocker && !mergedDeliveryReverified) {
      errors.push({
        code: 'selected_todo_removed_without_target_change',
        message: 'Selected TODO was removed, but none of its bounded target files changed.',
        selected_todo_id: selectedId,
        selected_scopes: selectedScopes,
        changed_files: diffFiles,
        claim_changed_files: claimChangedFiles,
        baseline_diff_files: baselineDiffFiles
      });
    }

    for (const [id] of before.entries()) {
      if (id !== selectedId && !after.has(id)) {
        if (completedIds.has(id)) {
          continue;
        }
        errors.push({
          code: 'unselected_todo_removed',
          message: 'A TODO other than the active claim was removed from the live queue.',
          selected_todo_id: selectedId,
          removed_todo_id: id
        });
      }
    }

    if (selectedStillPending && beforeSelectedBlock && afterSelectedBlock) {
      const drift = contractDrift(beforeSelectedBlock, afterSelectedBlock);
      if (drift.length > 0) {
        errors.push({
          code: 'selected_todo_contract_drift',
          message: 'Selected TODO contract fields changed before completion.',
          selected_todo_id: selectedId,
          drift
        });
      }
    }

    for (const [id, beforeBlock] of before.entries()) {
      if (id === selectedId || !after.has(id)) {
        continue;
      }
      const afterBlock = after.get(id);
      const drift = contractDrift(beforeBlock, afterBlock);
      if (drift.length > 0) {
        errors.push({
          code: 'unselected_todo_contract_drift',
          message: 'A TODO other than the active claim had protected contract fields changed.',
          selected_todo_id: selectedId,
          changed_todo_id: id,
          drift
        });
      }
    }
  }

  if (!changedTodo && selectedRemoved) {
    warnings.push({
      code: 'selected_removed_but_todo_not_in_git_diff',
      message: 'Selected TODO appears absent, but git diff does not report the TODO file; check claim freshness.'
    });
  }

  return {
    schema_version: 1,
    valid: errors.length === 0,
    errors,
    warnings,
    selected_todo_id: selectedId,
    selected_route: selectedRoute,
    selected_scopes: selectedScopes,
    changed_files: diffFiles,
    baseline_diff_files: baselineDiffFiles,
    claim_changed_files: claimChangedFiles,
    selected_target_changed: allowedTargetChanged,
    selected_target_dirty_at_baseline: selectedTargetDirtyAtBaseline,
    selected_targets_dirty_at_baseline: baselineDirtySelectedScopes,
    selected_targets_changed: changedSelectedScopes,
    selected_all_targets_changed: allSelectedTargetsChanged,
    selected_all_targets_dirty_at_baseline: allSelectedTargetsDirtyAtBaseline,
    missing_selected_scopes: missingSelectedScopes,
    selected_todo_removed: selectedRemoved,
    completion_record_present: recordExists,
    merged_delivery_reverified: mergedDeliveryReverified
  };
}

export function durableDeliveryReceiptForClaim(claim) {
  const receipt = validateTerminalDeliveryReceipt({ claim });
  if (!receipt.valid) {
    return { valid: false, errors: receipt.errors };
  }
  const review = claim.delivery_review;
  const mergedDeliveryReverification = review?.merged_delivery_reverification ?? claim.merged_delivery_reverification;
  return {
    valid: true,
    receipt: {
      schema_version: 1,
      claim_id: String(claim.claim_id ?? ''),
      root_claim_id: rootClaimId(claim),
      selected_todo_sha256: selectedTodoSha256(claim),
      author: review.author,
      reviewer: review.reviewer,
      merge_actor: review.merge_actor,
      approved: true,
      ci_passed: true,
      merged: true,
      ...(typeof review.pr_url === 'string' && review.pr_url ? { pr_url: review.pr_url } : {}),
      ...(mergedDeliveryReverification
        ? { merged_delivery_reverification: mergedDeliveryReverification }
        : { semantic_completion_evidence: review.semantic_completion_evidence })
    }
  };
}

function writeCompletionRecord(repoRoot, claim, runStamp, validation, deliveryReceipt) {
  const claimId = claim.claim_id || `run-${runStamp || Date.now()}`;
  const dir = path.join(repoRoot, '.brownie/private/phase-loop/todo-completions');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const record = {
    schema_version: 3,
    claim_id: claimId,
    root_claim_id: rootClaimId(claim),
    run_stamp: runStamp,
    selected_todo_id: validation.selected_todo_id,
    selected_todo: String(claim.selected_todo ?? ''),
    selected_todo_first_line: String(claim.selected_todo ?? '').split('\n')[0] ?? '',
    selected_todo_sha256: selectedTodoSha256(claim),
    queue_fingerprint: claim.queue_fingerprint ?? null,
    queue_generation: claim.queue_generation ?? null,
    delivery_receipt: deliveryReceipt,
    changed_files: validation.claim_changed_files,
    workspace_changed_files: validation.changed_files,
    baseline_diff_files: validation.baseline_diff_files,
    selected_scopes: validation.selected_scopes,
    selected_target_changed: validation.selected_target_changed,
    selected_target_dirty_at_baseline: validation.selected_target_dirty_at_baseline,
    selected_targets_dirty_at_baseline: validation.selected_targets_dirty_at_baseline,
    selected_targets_changed: validation.selected_targets_changed,
    selected_all_targets_changed: validation.selected_all_targets_changed,
    selected_all_targets_dirty_at_baseline: validation.selected_all_targets_dirty_at_baseline,
    missing_selected_scopes: validation.missing_selected_scopes,
    completion_record_reason: validation.merged_delivery_reverified
      ? 'merged_delivery_reverified_before_todo_removal'
      : validation.selected_route === 'todo-decomposition' ? 'todo_decomposition' : 'verified_before_todo_removal',
    written_at: new Date().toISOString()
  };
  const existingPath = completionRecordPaths(repoRoot, claimId, runStamp).find((recordPath) => fs.existsSync(recordPath));
  if (existingPath) {
    const existing = readJson(existingPath);
    if (sha256Json(withoutWrittenAt(existing)) === sha256Json(withoutWrittenAt(record))) {
      return existing;
    }
    // A verified clean-merge parent can be retried during post-completion
    // cleanup with a different run stamp. Its supersession-resolution receipt
    // hashes the whole completion record, so rewriting only run metadata would
    // orphan that receipt and make the resolved parent appear blocked again.
    // Reuse only a record that an existing resolution already binds to this
    // exact claim and selected TODO; other changed completion evidence remains
    // fail-closed and reaches the conflict guard below.
    const resolutionPath = path.join(
      repoRoot,
      '.brownie/private/phase-loop/todo-supersession-resolutions',
      `${claimId}.json`
    );
    const resolutionText = maybeReadText(resolutionPath);
    if (resolutionText !== null) {
      const resolution = JSON.parse(resolutionText);
      const boundToExistingCompletion = (
        validation.merged_delivery_reverified === true
        && resolution?.record_type === 'superseded_parent_clean_merged_delivery_resolution'
        && resolution?.claim_id === claimId
        && resolution?.root_claim_id === rootClaimId(claim)
        && resolution?.parent_todo_id === validation.selected_todo_id
        && resolution?.parent_todo_sha256 === selectedTodoSha256(claim)
        && resolution?.completion_record_sha256 === sha256Json(existing)
        && existing?.claim_id === claimId
        && existing?.root_claim_id === rootClaimId(claim)
        && existing?.selected_todo_id === validation.selected_todo_id
        && existing?.selected_todo_sha256 === selectedTodoSha256(claim)
      );
      if (boundToExistingCompletion) return existing;
    }
  }
  for (const recordPath of completionRecordPaths(repoRoot, claimId, runStamp)) {
    fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  }
  return record;
}

function writeSupersessionResolutionRecord({ repoRoot, claim, completionRecord, recovery }) {
  const proof = claim.merged_delivery_reverification;
  const candidate = recovery?.candidate;
  if (!proof || !candidate
    || candidate.selected_todo_id !== claim.selected_todo_id
    || candidate.selected_todo_sha256 !== selectedTodoSha256(claim)
    || candidate.merge_commit_oid !== proof?.git?.merge_commit_oid
    || candidate.first_parent_oid !== proof?.git?.first_parent_oid
    || candidate.head_oid !== proof?.git?.head_oid
    || candidate.task_spec_binding?.todo_id !== claim.selected_todo_id
    || candidate.task_spec_binding?.selected_todo_sha256 !== selectedTodoSha256(claim)
    || candidate.task_spec_binding?.head_oid !== proof?.git?.head_oid) {
    return null;
  }
  const dir = path.join(repoRoot, '.brownie/private/phase-loop/todo-supersession-resolutions');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const record = {
    schema_version: 1,
    record_type: 'superseded_parent_clean_merged_delivery_resolution',
    reason: 'orphaned_superseded_parent_clean_merged_delivery_reverified',
    parent_todo_id: claim.selected_todo_id,
    parent_todo_sha256: selectedTodoSha256(claim),
    generated_child_ids: [...recovery.generated_child_ids].sort(),
    claim_id: claim.claim_id,
    root_claim_id: rootClaimId(claim),
    completion_record_sha256: sha256Json(completionRecord),
    candidate: {
      selected_todo_id: candidate.selected_todo_id,
      selected_todo_sha256: candidate.selected_todo_sha256,
      merge_commit_oid: candidate.merge_commit_oid,
      first_parent_oid: candidate.first_parent_oid,
      head_oid: candidate.head_oid,
      task_spec_binding: candidate.task_spec_binding
    },
    written_at: new Date().toISOString()
  };
  const recordPath = path.join(dir, `${claim.claim_id}.json`);
  const existing = maybeReadText(recordPath);
  if (existing !== null) {
    const prior = JSON.parse(existing);
    if (sha256Json(withoutWrittenAt(prior)) !== sha256Json(withoutWrittenAt(record))) {
      throw new Error('supersession_resolution_conflicts_with_existing_record');
    }
    return prior;
  }
  const temporary = path.join(dir, `.${claim.claim_id}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, recordPath);
  return record;
}

export function loadCliInput(args) {
  const repoRoot = path.resolve(args.repo);
  const todoRelative = path.relative(repoRoot, path.resolve(repoRoot, args.todo)).split(path.sep).join('/');
  const claimPath = path.resolve(repoRoot, args.claim);
  const todoPath = path.resolve(repoRoot, args.todo);
  const claim = readJson(claimPath);
  const diffFiles = gitDiffFiles(repoRoot);
  const todoAfter = maybeReadText(todoPath) ?? '';
  const todoBefore = typeof claim.baseline_todo_text === 'string'
    ? claim.baseline_todo_text
    : gitHeadText(repoRoot, todoRelative) ?? todoAfter;
  const todoState = loadTodoState(repoRoot, todoAfter);
  return {
    repoRoot,
    claim,
    diffFiles,
    baselineDiffFiles: normalizeFileList(claim.baseline_diff_files),
    todoBefore,
    todoAfter,
    runStamp: args.runStamp,
    claimDir: args.claimDir ? path.resolve(repoRoot, args.claimDir) : '',
    completionRecordExists: completionRecordExists(repoRoot, claim.claim_id, args.runStamp),
    completedTodoIds: todoState.completedIds
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const input = loadCliInput(args);
    let validation = validatePhaseLoopProgressIntegrity(input);
    let record = null;
    if (args.writeRecord) {
      const durableReceipt = durableDeliveryReceiptForClaim(input.claim);
      if (!durableReceipt.valid) {
        validation = {
          ...validation,
          valid: false,
          errors: [
            ...validation.errors,
            {
              code: 'completion_record_delivery_receipt_invalid',
              message: 'Refusing to write a TODO completion record without independent review approval, passing CI, merged delivery, and claim-bound semantic evidence.',
              receipt_errors: durableReceipt.errors
            }
          ]
        };
      }
      if (
        ['implementation', 'documentation'].includes(validation.selected_route) &&
        validation.selected_scopes.length > 0 &&
        !validation.selected_target_changed &&
        !validation.selected_target_dirty_at_baseline &&
        !validation.merged_delivery_reverified
      ) {
        validation = {
          ...validation,
          valid: false,
          errors: [
            ...validation.errors,
            {
              code: 'completion_record_target_not_changed',
              message: 'Refusing to write a TODO completion record because none of the selected bounded target files changed.'
            }
          ]
        };
      }
      if (
        ['implementation', 'documentation'].includes(validation.selected_route) &&
        validation.selected_scopes.length > 1 &&
        !validation.selected_all_targets_changed &&
        !validation.selected_all_targets_dirty_at_baseline &&
        !validation.merged_delivery_reverified
      ) {
        validation = {
          ...validation,
          valid: false,
          errors: [
            ...validation.errors,
            {
              code: 'completion_record_missing_selected_targets',
              message: 'Refusing to write a TODO completion record because not all selected Patch only/Create only target files changed during this claim.',
              selected_scopes: validation.selected_scopes,
              missing_selected_scopes: validation.missing_selected_scopes,
              claim_changed_files: validation.claim_changed_files
            }
          ]
        };
      }
      if (!validation.valid) {
        console.error(JSON.stringify(validation, null, 2));
        process.exit(1);
      }
      record = writeCompletionRecord(input.repoRoot, input.claim, args.runStamp, validation, durableReceipt.receipt);
      const recovery = validation.merged_delivery_reverified && input.claimDir
        ? supersededParentCleanMergedDeliveryRecovery(input.todoAfter, {
            repoRoot: input.repoRoot,
            claimDir: input.claimDir,
            todoState: loadTodoState(input.repoRoot, input.todoAfter)
          })
        : null;
      const supersessionResolution = recovery?.parent_todo_id === input.claim.selected_todo_id
        && recovery?.parent_todo_sha256 === selectedTodoSha256(input.claim)
        ? writeSupersessionResolutionRecord({
            repoRoot: input.repoRoot,
            claim: input.claim,
            completionRecord: record,
            recovery
          })
        : null;
      validation = {
        ...validation,
        completion_record_present: true,
        completion_record: record,
        ...(supersessionResolution ? { supersession_resolution_record: supersessionResolution } : {})
      };
    }
    const output = JSON.stringify(validation, null, 2);
    if (validation.valid) {
      console.log(output);
      process.exit(0);
    }
    console.error(output);
    process.exit(1);
  } catch (error) {
    console.error(JSON.stringify({
      schema_version: 1,
      valid: false,
      errors: [{
        code: 'phase_loop_progress_integrity_exception',
        message: error?.message ?? String(error)
      }]
    }, null, 2));
    process.exit(1);
  }
}
