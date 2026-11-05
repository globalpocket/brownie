#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  scoreTodoDecompositionText,
  uncheckedTodoBlocks
} from './guard-todo-decomposition.mjs';
import {
  loadTodoState,
  resolveTodoState,
  todoStateSummary
} from './phase-loop-todo-state.mjs';
import { boundedScopes as boundedScopesFromFirstLine } from './phase-loop-bounded-scope.mjs';
import { findCleanMergedDeliveryCandidate } from './phase-loop-delivery-integrity.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(process.env.PHASE_LOOP_WORKSPACE_ROOT || path.join(__dirname, '..'));

function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

function todoId(block) {
  const firstLine = block.split('\n')[0]?.trim() ?? '';
  const title = firstLine.replace(/^(?:[-*]|\d+[.)])\s+\[\s\]\s+/, '');
  return title.split(':')[0]?.trim() ?? '';
}

function productPrefix(id) {
  return id.match(/^([A-Z]+-\d+[a-z]?)/)?.[1] ?? null;
}

function isDerivedLeaf(block) {
  return block.split('\n').some((line) => line.trim().startsWith('Source TODO:'));
}

function sourceTodoId(block) {
  const line = block
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('Source TODO:'));
  if (!line) {
    return '';
  }
  return line.slice('Source TODO:'.length).trim().split(':')[0]?.trim().replace(/[.,;]+$/u, '') ?? '';
}

function dependsOn(block) {
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('Depends on:')) {
      const raw = trimmed.slice('Depends on:'.length).trim().replace(/[.]$/, '');
      if (!raw || raw === '<none>') {
        return [];
      }
      return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
    }
  }
  return [];
}

function routeValue(block) {
  const line = block
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('Route:'));
  return line?.slice('Route:'.length).trim().replace(/[.]$/, '').toLowerCase() ?? '';
}

// A stalled leaf is not retryable merely because a controller generated a new
// run.  The replan leaf is the durable recovery work: select it before the
// source leaf it replaces, regardless of which historical naming convention
// created it.  Keep the matcher narrow so ordinary later decomposition work
// cannot preempt an unrelated ready TODO.
function stalledReplanSourceId(block) {
  if (routeValue(block) !== 'todo-decomposition') return '';
  const id = todoId(block);
  const lower = block.toLowerCase();
  const isExplicitStalledReplan = id.startsWith('TODO-decompose-blocked-queue-stalled-')
    || id.includes('-replan-stalled-leaf-')
    || (lower.includes('stalled todo') && (lower.includes('replaced') || lower.includes('superseded')));
  return isExplicitStalledReplan ? sourceTodoId(block) : '';
}

function boundedScopes(block) {
  const firstLine = block.split('\n')[0]?.trim() ?? '';
  return boundedScopesFromFirstLine(firstLine);
}

function targetScopeKey(block) {
  return boundedScopes(block).map((scope) => scope.trim()).filter(Boolean).sort().join('|');
}

function verificationCommand(block) {
  const line = block.split('\n').map((entry) => entry.trim()).find((entry) => entry.startsWith('Verification:'));
  return line?.slice('Verification:'.length).trim() ?? '';
}

function selectedTodoIdFromFirstLine(firstLine) {
  return String(firstLine ?? '')
    .trim()
    .replace(/^(?:[-*]|\d+[.)])\s+\[[ xX]\]\s+/u, '')
    .split(':')[0]
    ?.trim() ?? '';
}

function selectedTodoIdFromRecord(record) {
  if (typeof record?.selected_todo_id === 'string' && record.selected_todo_id.trim()) {
    return record.selected_todo_id.trim();
  }
  if (typeof record?.selected_todo === 'string' && record.selected_todo.trim()) {
    return todoId(record.selected_todo);
  }
  return selectedTodoIdFromFirstLine(record?.selected_todo_first_line);
}

function recordIsTerminal(record) {
  const reason = String(record?.block_reason ?? record?.archive_reason ?? '').toLowerCase();
  const status = String(record?.status ?? '').toLowerCase();
  return reason.includes('terminal') || status === 'failed' || status === 'terminal_failure';
}

function recordHasCompletionEvidence(record) {
  return [
    'completed_at',
    'verified_at',
    'completion_certificate',
    'completion_evidence',
    'verified_completion'
  ].some((key) => record?.[key] !== undefined && record[key] !== null && record[key] !== false);
}

function recordHasExactDerivedParent(record, parentId, childId) {
  if (selectedTodoIdFromRecord(record) !== childId || typeof record?.selected_todo !== 'string') return false;
  if (sourceTodoId(record.selected_todo) !== parentId) return false;
  if (typeof record.selected_todo_sha256 !== 'string' || record.selected_todo_sha256 !== sha256Text(record.selected_todo)) {
    return false;
  }
  const admission = record.claim_admission;
  return typeof admission === 'object'
    && admission !== null
    && admission.claim_id === record.claim_id
    && admission.selected_todo_id === childId
    && admission.selected_todo_sha256 === record.selected_todo_sha256;
}

function recordIsArchivedTerminalChildFailure(record, parentId, childId) {
  if (!recordHasExactDerivedParent(record, parentId, childId) || recordHasCompletionEvidence(record)) return false;
  const status = String(record?.status ?? '').toLowerCase();
  const statusHistory = Array.isArray(record?.status_history) ? record.status_history : [];
  const failureHistory = Array.isArray(record?.failure_history) ? record.failure_history : [];
  const allowedTransitionStatuses = new Set(['claimed', 'in_progress', 'failed', 'stale_snapshot_rejected']);
  if (!['failed', 'stale_snapshot_rejected'].includes(status)
    || statusHistory.length === 0
    || failureHistory.length === 0
    || statusHistory.some((entry) => !allowedTransitionStatuses.has(String(entry?.status ?? '').toLowerCase()))
    || failureHistory.some((entry) => String(entry?.status ?? '').toLowerCase() !== 'failed'
      || entry?.selected_todo_sha256 !== record.selected_todo_sha256)
    || String(statusHistory.at(-1)?.status ?? '').toLowerCase() !== status) {
    return false;
  }
  if (status === 'failed') {
    return String(record?.archive_reason ?? '').toLowerCase().includes('terminal_failure');
  }
  return statusHistory.some((entry) => String(entry?.status ?? '').toLowerCase() === 'failed');
}

function recordIsTerminalChildBlockedLedger(record, parentId, childId) {
  if (typeof record?.selected_todo !== 'string'
    || selectedTodoIdFromRecord(record) !== childId
    || sourceTodoId(record.selected_todo) !== parentId
    || record.selected_todo_sha256 !== sha256Text(record.selected_todo)
    || record.terminal_failure !== true) {
    return false;
  }
  return String(record?.block_reason ?? '').toLowerCase().includes('terminal');
}

function isApprovedParentContractRebaseline(record, parentId) {
  return record?.schema_version === 1
    && record?.record_type === 'todo_contract_rebaseline'
    && record?.status === 'approved'
    && Array.isArray(record?.parent_todo_ids)
    && record.parent_todo_ids.includes(parentId)
    && Array.isArray(record?.target_todo_ids)
    && record.target_todo_ids.includes(parentId)
    && Array.isArray(record?.contract_changes)
    && record.contract_changes.some((change) => change?.todo_id === parentId);
}

function jsonRecordsInside(root) {
  const records = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('symlinked claim history is not accepted');
      if (entry.isDirectory()) {
        visit(candidate);
        continue;
      }
      if (!entry.isFile() || (!entry.name.endsWith('.json') && !entry.name.endsWith('.jsonl'))) continue;
      const source = fs.readFileSync(candidate, 'utf8');
      const values = entry.name.endsWith('.jsonl')
        ? source.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line))
        : [JSON.parse(source)];
      for (const value of values) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('claim history record is not an object');
        records.push({ relativePath: path.relative(root, candidate), record: value });
      }
    }
  };
  visit(root);
  return records;
}

// A missing replan child is normally an integrity warning, not authority to
// resume its superseded parent. A child archive can be tolerated only when it
// proves the exact child was terminally rejected under this parent's split;
// current, completed, successful, malformed, or unbound child state remains
// a hard stop. All archive and contract-rebaseline records are read so a
// partial/corrupt history cannot create an exception.
function readClaimHistory(claimDir, parentId, childIds) {
  if (!claimDir || !fs.existsSync(claimDir)) return { readable: false };
  const childSet = new Set(childIds);
  const childHistory = new Map(childIds.map((id) => [id, { archives: 0, ledgers: 0, unsafe: false }]));
  try {
    const records = jsonRecordsInside(claimDir);
    const terminalIds = new Set();
    let hasApprovedParentContractRebaseline = false;
    for (const { relativePath, record } of records) {
      const id = selectedTodoIdFromRecord(record);
      if (id === parentId && recordIsTerminal(record)) terminalIds.add(id);
      if (relativePath.startsWith(`contract-rebaselines${path.sep}`) && isApprovedParentContractRebaseline(record, parentId)) {
        hasApprovedParentContractRebaseline = true;
      }
      if (!childSet.has(id)) continue;
      const state = childHistory.get(id);
      if (relativePath === 'blocked.jsonl') {
        if (recordIsTerminalChildBlockedLedger(record, parentId, id)) state.ledgers += 1;
        else state.unsafe = true;
      } else if (path.basename(relativePath) === 'current.json') {
        state.unsafe = true;
      } else if (recordIsArchivedTerminalChildFailure(record, parentId, id)) {
        state.archives += 1;
      } else {
        state.unsafe = true;
      }
    }

    const completionRoot = path.join(path.dirname(claimDir), 'todo-completions');
    if (fs.existsSync(completionRoot)) {
      for (const { record } of jsonRecordsInside(completionRoot)) {
        const id = selectedTodoIdFromRecord(record) || String(record?.todo_id ?? '');
        if (childSet.has(id)) childHistory.get(id).unsafe = true;
      }
    }
    const hasChildHistory = [...childHistory.values()].some((state) => state.archives > 0 || state.ledgers > 0);
    if (hasChildHistory && !hasApprovedParentContractRebaseline) return { readable: false };
    if ([...childHistory.values()].some((state) => state.unsafe || (state.ledgers > 0 && state.archives === 0))) {
      return { readable: false };
    }
    return { readable: true, terminalIds, childHistory };
  } catch {
    return { readable: false };
  }
}

function candidateMatchesSupersededParent(candidate, block) {
  const id = todoId(block);
  const sha256 = sha256Text(block);
  const value = candidate?.candidate;
  if (!candidate?.valid || !value || value.selected_todo_id !== id || value.selected_todo_sha256 !== sha256) {
    return false;
  }
  if (!/^[a-f0-9]{40}$/iu.test(value.merge_commit_oid ?? '')
    || !/^[a-f0-9]{40}$/iu.test(value.first_parent_oid ?? '')
    || !/^[a-f0-9]{40}$/iu.test(value.head_oid ?? '')) {
    return false;
  }
  const binding = value.task_spec_binding;
  if (!binding || binding.todo_id !== id || binding.selected_todo_sha256 !== sha256) {
    return false;
  }
  const expectedScopes = boundedScopes(block).slice().sort();
  const targetScopes = Array.isArray(value.targets)
    ? value.targets.map((target) => target?.path).filter((target) => typeof target === 'string').sort()
    : [];
  return expectedScopes.length > 0
    && targetScopes.length === expectedScopes.length
    && targetScopes.every((scope, index) => scope === expectedScopes[index]);
}

// Recover exactly one historical split only when its parent is still pending,
// every generated child vanished from the live queue/state and any retained
// child archive is an exact terminal failure from this same split, the parent
// itself has a terminal record, and Git independently proves the exact parent
// contract was cleanly merged. This creates no completion state; it merely
// makes the original parent claimable for Runtime re-verification.  Keep the
// candidate details private to this exact admission path so a later durable
// resolution can bind its completion evidence to the same split.
export function supersededParentCleanMergedDeliveryRecovery(text, options = {}) {
  if (!options.repoRoot || !options.claimDir) return '';
  const todoState = options.todoState ?? loadTodoState(options.repoRoot, text, {
    additionalReplanRecords: options.todoReplanRecords,
    breakdownPath: options.breakdownPath
  });
  if (todoState.errors.length > 0) return null;

  for (const block of uncheckedTodoBlocks(text)) {
    const id = todoId(block);
    if (!id || !todoState.supersededIds.has(id) || todoState.completedIds.has(id)) continue;
    // This fallback has exactly the same dependency authority as the normal
    // selector. A historical clean merge is proof about this TODO only; it is
    // never proof that one of its prerequisites completed.
    if (dependsOn(block).some((dependency) => (
      todoState.knownIds.has(dependency) && !todoState.resolvedIds.has(dependency)
    ))) continue;
    const replans = todoState.replanRecords.filter((record) => record.parent_todo_id === id);
    const childSets = new Set(replans.map((record) => [...record.generated_child_ids].sort().join('\u0000')));
    if (childSets.size !== 1) continue;
    const childIds = [...childSets][0].split('\u0000').filter(Boolean);
    if (childIds.length === 0) continue;
    const history = readClaimHistory(options.claimDir, id, childIds);
    if (!history.readable || !history.terminalIds.has(id)) continue;
    if (childIds.some((childId) => (
      todoState.liveIds.has(childId)
      || todoState.completedIds.has(childId)
      || todoState.supersededIds.has(childId)
    ))) continue;
    const candidate = findCleanMergedDeliveryCandidate({ repoRoot: options.repoRoot, selectedTodo: block });
    if (candidateMatchesSupersededParent(candidate, block)) {
      return {
        block,
        parent_todo_id: id,
        parent_todo_sha256: sha256Text(block),
        generated_child_ids: childIds,
        candidate: candidate.candidate,
        replan_records: replans
      };
    }
  }
  return null;
}

export function selectSupersededParentWithMissingChildrenForCleanMergedDelivery(text, options = {}) {
  return supersededParentCleanMergedDeliveryRecovery(text, options)?.block ?? '';
}

export function isExplicitBlockerTodo(block) {
  if (!block || typeof block !== 'string') {
    return false;
  }
  const firstLine = block.split('\n')[0]?.trim() ?? '';
  const route = routeValue(block);
  const lower = block.toLowerCase();
  const scopes = boundedScopes(block);
  if (scopes.length > 0) {
    return false;
  }
  const namesBlocker =
    firstLine.toLowerCase().includes('blocker:') ||
    lower.includes('verification: blocker:') ||
    lower.includes('completion condition: all six independent human reviews are completed') ||
    lower.includes('owner-controlled independent review evidence');
  const forbidsImplementation =
    lower.includes('forbidden changes: do not patch') ||
    lower.includes('no workspace file is patched') ||
    lower.includes('verification: blocker:') ||
    lower.includes('do not implement') ||
    lower.includes('owner-controlled') ||
    (
      lower.includes('forbidden changes:') &&
      lower.includes('do not invent evidence values') &&
      (
        lower.includes('do not declare product ready') ||
        lower.includes('do not declare runtime product ready') ||
        lower.includes('or declare product ready') ||
        lower.includes('or declare runtime product ready')
      )
    );
  return namesBlocker && forbidsImplementation && ['documentation', 'release-ops', 'release-judgment/resync', 'blocker', ''].includes(route);
}

export function isBrownieOwnedBlockerTodo(block) {
  if (!isExplicitBlockerTodo(block)) {
    return false;
  }
  const route = routeValue(block);
  if (route !== 'release-ops') {
    return false;
  }
  const lower = block.toLowerCase();
  const externalAuthoritySignals = [
    'external release engineering ownership',
    'owner-controlled runtime release ops',
    'runtime release ops authority',
    'github release publication',
    'artifact upload/provenance',
    'release ops owner',
    'deployment credentials',
    'production deployment credentials',
    'provided by repository owner',
    'owner provides',
    'human review',
    'independent human review',
    'purchase',
    'license key',
    'password',
    'token'
  ];
  if (externalAuthoritySignals.some((signal) => lower.includes(signal))) {
    return false;
  }
  const brownieOwnedSignals = [
    'evidence',
    'collector',
    'guard',
    'harness',
    'workspace setup',
    'source checkout',
    'artifact',
    'golden journey',
    'stateful soak',
    'provenance',
    'document generation',
    'reproducible',
    'release contract',
    'readiness audit'
  ];
  return brownieOwnedSignals.some((signal) => lower.includes(signal));
}

export function needsTodoDecomposition(block) {
  if (!block || typeof block !== 'string') {
    return { needs_decomposition: false, reason: 'empty' };
  }
  const firstLine = block.split('\n')[0]?.trim() ?? '';
  const route = routeValue(block);
  const lower = block.toLowerCase();
  if (route === 'todo-decomposition' || firstLine.includes('TODO-decompose-')) {
    return { needs_decomposition: false, reason: 'already_decomposition_task' };
  }
  if (isExplicitBlockerTodo(block)) {
    return { needs_decomposition: false, reason: 'explicit_blocker_todo' };
  }
  if (isDerivedLeaf(block)) {
    return { needs_decomposition: false, reason: 'already_leaf' };
  }
  const scopes = boundedScopes(block);
  if (scopes.length > 0 && scopes.length <= 2) {
    return { needs_decomposition: false, reason: 'bounded_scope_present' };
  }
  if (route === 'release-ops' && (lower.includes('blocker') || lower.includes('fail-closed') || lower.includes('inspect'))) {
    return { needs_decomposition: false, reason: 'explicit_release_ops_blocker' };
  }
  if (!route && block.split('\n').length <= 4 && block.length <= 500) {
    return { needs_decomposition: false, reason: 'small_legacy_todo_without_route' };
  }
  if (block.length > 900 || block.split('\n').length > 7) {
    return { needs_decomposition: true, reason: 'broad_unbounded_todo' };
  }
  if (route === 'implementation' && scopes.length === 0) {
    return { needs_decomposition: true, reason: 'implementation_without_bounded_scope' };
  }
  if (route === 'documentation' && scopes.length === 0) {
    return { needs_decomposition: true, reason: 'documentation_without_bounded_scope' };
  }
  return { needs_decomposition: false, reason: 'small_unscoped_todo' };
}

function readBlockedClaims(blockedPath, queueFingerprint, controllerFingerprint = '') {
  if (!blockedPath || !fs.existsSync(blockedPath) || !fs.statSync(blockedPath).isFile()) {
    return {
      hashes: new Set(),
      firstLines: new Set(),
      currentControllerHashes: new Set(),
      currentControllerFirstLines: new Set(),
      stableIds: new Set(),
      stablePrefixes: new Set(),
      stableScopeContracts: new Set(),
      terminalFailureAttempts: new Map()
    };
  }
  const hashes = new Set();
  const firstLines = new Set();
  const currentControllerHashes = new Set();
  const currentControllerFirstLines = new Set();
  const stableIds = new Set();
  const stablePrefixes = new Set();
  const stableScopeContracts = new Set();
  const terminalFailureAttempts = new Map();
  for (const line of fs.readFileSync(blockedPath, 'utf8').split('\n')) {
    if (!line.trim()) {
      continue;
    }
    try {
      const record = JSON.parse(line);
      const recordHasController = typeof record.controller_fingerprint === 'string' && record.controller_fingerprint;
      const recordMatchesController = !controllerFingerprint || !recordHasController || record.controller_fingerprint === controllerFingerprint;
      const terminalRuntimeFailure = record.block_reason === 'terminal_runtime_failure';
      // Hash/first-line suppression predates controller-bound blocked records.
      // Once a controller identity is present, stale generic suppression must
      // not survive a controller rebaseline, especially for generated leaves.
      // Terminal failures are governed only by their retry budget below; do
      // not let a missing/legacy hash field turn a retryable terminal record
      // into generic stable suppression.
      if (!terminalRuntimeFailure && recordMatchesController && record.queue_fingerprint === queueFingerprint && typeof record.selected_todo_sha256 === 'string') {
        hashes.add(record.selected_todo_sha256);
        if (controllerFingerprint && record.controller_fingerprint === controllerFingerprint) {
          currentControllerHashes.add(record.selected_todo_sha256);
        }
      }
      if (!terminalRuntimeFailure && recordMatchesController && record.queue_fingerprint === queueFingerprint && typeof record.selected_todo_first_line === 'string' && record.selected_todo_first_line) {
        firstLines.add(record.selected_todo_first_line);
        if (controllerFingerprint && record.controller_fingerprint === controllerFingerprint) {
          currentControllerFirstLines.add(record.selected_todo_first_line);
        }
      }
      if (typeof record.selected_todo_first_line === 'string' && record.selected_todo_first_line) {
        const blockedId = todoId(record.selected_todo_first_line);
        const explicitOwnerBlocker = record.selected_todo_first_line.includes('Blocker:');
        const stalledLeafContractReplan = record.block_reason === 'stalled_leaf_contract_replan';
        // A stable block suppresses retries only for the controller that
        // observed it. A controller update is the explicit rebaseline point
        // for legacy state, including records created before fingerprints.
        const matchesController = !controllerFingerprint || record.controller_fingerprint === controllerFingerprint;
        if (blockedId && stalledLeafContractReplan && matchesController) {
          stableIds.add(blockedId);
          if (typeof record.target_scope_key === 'string' && record.target_scope_key && typeof record.verification_command === 'string' && record.verification_command) {
            stableScopeContracts.add(`${record.target_scope_key}\u0000${record.verification_command}`);
          }
          continue;
        }
        if (blockedId && terminalRuntimeFailure && matchesController) {
          // Terminal retry suppression is keyed by the complete TODO
          // specification hash and controller. Do not add the ID to
          // stableIds: a materially changed task with the same ID must get a
          // fresh retry budget instead of inheriting the old suppression.
          const todoHash = typeof record.selected_todo_sha256 === 'string' && record.selected_todo_sha256
            ? record.selected_todo_sha256
            : sha256Text(record.selected_todo_first_line);
          const recordController = String(record.controller_fingerprint || controllerFingerprint || '');
          const retryCapValue = Number(record.retry_cap);
          const retryCap = Number.isFinite(retryCapValue) && retryCapValue >= 0
            ? Math.floor(retryCapValue)
            : 0;
          const providerFailureFingerprint = String(record.provider_failure_fingerprint || '');
          const key = `${todoHash}\u0000${recordController}\u0000${providerFailureFingerprint}`;
          const previous = terminalFailureAttempts.get(key) ?? {
            count: 0,
            retry_cap: retryCap,
            todo_hash: todoHash,
            todo_first_line: record.selected_todo_first_line,
            provider_failure_fingerprint: providerFailureFingerprint,
            controller_fingerprint: recordController,
            blocked_id: blockedId
          };
          previous.count += 1;
          previous.retry_cap = retryCap;
          previous.blocked_id = blockedId;
          previous.todo_first_line = record.selected_todo_first_line;
          previous.provider_failure_fingerprint = providerFailureFingerprint;
          terminalFailureAttempts.set(key, previous);
          continue;
        }
        if (
          blockedId &&
          (
            blockedId.includes('-leaf') ||
            blockedId.includes('-doc-sync-leaf') ||
            blockedId.startsWith('TODO-decompose-broad-todo-') ||
            explicitOwnerBlocker
          ) && matchesController
        ) {
          stableIds.add(blockedId);
          const prefix = productPrefix(blockedId);
          if (prefix && !explicitOwnerBlocker) {
            stablePrefixes.add(prefix);
          }
        }
      }
    } catch {
      // Ignore corrupt historical blocked entries; the phase-loop guard remains fail-closed elsewhere.
    }
  }
  return { hashes, firstLines, currentControllerHashes, currentControllerFirstLines, stableIds, stablePrefixes, stableScopeContracts, terminalFailureAttempts };
}

export function selectFirstSchedulableTodo(text, options = {}) {
  const blocks = uncheckedTodoBlocks(text);
  const todoState = options.todoState ?? (
    options.repoRoot
      ? loadTodoState(options.repoRoot, text, {
          additionalReplanRecords: options.todoReplanRecords,
          breakdownPath: options.breakdownPath
        })
      : resolveTodoState({
          todoText: text,
          replanRecords: options.todoReplanRecords,
          completionRecords: options.todoCompletionRecords
        })
  );
  if (todoState.errors.length > 0) {
    return '';
  }
  const queueFingerprint = sha256Text(text);
  const blocked = readBlockedClaims(options.blockedPath, queueFingerprint, options.controllerFingerprint ?? '');
  const blockedQueueDecompositionQueued = blocks.some((block) => todoId(block).startsWith('TODO-decompose-blocked-queue-'));
  const stalledReplanSourceIds = new Set(blocks.map(stalledReplanSourceId).filter(Boolean));
  let fallbackParentForRedecomposition = '';
  const derivedPrefixes = new Set(
    blocks
      .filter(isDerivedLeaf)
      .map((block) => productPrefix(todoId(block)))
      .filter(Boolean)
  );
  const dependencyBlockedIds = new Set();
  const excludedTodoHashes = options.excludedTodoHashes instanceof Set
    ? options.excludedTodoHashes
    : new Set(Array.isArray(options.excludedTodoHashes) ? options.excludedTodoHashes : []);
  for (const block of blocks) {
    const id = todoId(block);
    if (!id) {
      continue;
    }
    if (todoState.completedIds.has(id) || todoState.supersededIds.has(id)) {
      continue;
    }
    const blockHash = sha256Text(block);
    if (excludedTodoHashes.has(blockHash)) {
      // Excluded terminal attempts are not completion evidence. Keep their
      // TODO unresolved so dependents remain blocked while independent
      // siblings can still be selected.
      dependencyBlockedIds.add(id);
      continue;
    }
    if (blockedQueueDecompositionQueued && !id.startsWith('TODO-decompose-blocked-queue-')) {
      continue;
    }
    if (stalledReplanSourceIds.has(id)) {
      // The selected source has a pending recovery contract.  Mark it as a
      // dependency barrier rather than returning it, so descendants stay
      // blocked and the later replan leaf is selected in this same pass.
      dependencyBlockedIds.add(id);
      continue;
    }
    const prefix = productPrefix(id);
    if (!isDerivedLeaf(block) && prefix && blocked.stablePrefixes.has(prefix)) {
      if (!fallbackParentForRedecomposition && needsTodoDecomposition(block).needs_decomposition) {
        fallbackParentForRedecomposition = block;
      }
      dependencyBlockedIds.add(id);
      continue;
    }
    if (!isDerivedLeaf(block) && prefix && derivedPrefixes.has(prefix)) {
      continue;
    }
    if (isExplicitBlockerTodo(block)) {
      dependencyBlockedIds.add(id);
      continue;
    }
    const deps = dependsOn(block);
    if (deps.some((dep) => (
      (
        todoState.knownIds.has(dep)
        && !todoState.resolvedIds.has(dep)
      )
      || dependencyBlockedIds.has(dep)
    ))) {
      dependencyBlockedIds.add(id);
      continue;
    }
    const firstLine = block.split('\n')[0]?.trim() ?? '';
    const terminalFailureAttempts = [...blocked.terminalFailureAttempts.values()].filter((entry) => (
      (entry.todo_hash === blockHash || entry.todo_first_line === firstLine)
      && (!options.controllerFingerprint || entry.controller_fingerprint === options.controllerFingerprint)
    ));
    const terminalFailureRetryAvailable = terminalFailureAttempts.some((entry) => entry.count <= entry.retry_cap);
    const terminalFailureRetryExhausted = terminalFailureAttempts.length > 0 && !terminalFailureRetryAvailable;
    if (terminalFailureRetryExhausted) {
      dependencyBlockedIds.add(id);
      continue;
    }
    if (blocked.stableIds.has(id)) {
      // A blocked record is not completion evidence. Dependents remain blocked
      // until the shared TODO state marks this id completed or resolves a
      // superseded parent through all of its generated children. A terminal
      // failure with retry budget is the explicit exception: it must be
      // retried even if an older legacy stable-block record has the same leaf
      // id.
      if (terminalFailureRetryAvailable) {
        return block;
      }
      dependencyBlockedIds.add(id);
      continue;
    }
    const scopeContract = `${targetScopeKey(block)}\u0000${verificationCommand(block)}`;
    if (isDerivedLeaf(block) && blocked.stableScopeContracts.has(scopeContract) && !terminalFailureRetryAvailable) {
      // A replan may change IDs, but it must change the actual work contract.
      // Otherwise the scheduler would repeatedly retry the same target and
      // verification path while presenting it as new work.
      dependencyBlockedIds.add(id);
      continue;
    }
    const blockedInCurrentQueue = blocked.hashes.has(blockHash)
      || blocked.firstLines.has(firstLine)
      || terminalFailureAttempts.length > 0;
    const blockedByCurrentController = blocked.currentControllerHashes.has(blockHash)
      || blocked.currentControllerFirstLines.has(firstLine)
      || terminalFailureAttempts.length > 0;
    const sourceId = sourceTodoId(block);
    const sourceIsGeneratedParent = Boolean(productPrefix(sourceId));
    const canRetryAfterControllerRepair = blockedInCurrentQueue && !blockedByCurrentController && !isExplicitBlockerTodo(block) && !sourceIsGeneratedParent;
    if (!blockedInCurrentQueue || canRetryAfterControllerRepair || terminalFailureRetryAvailable) {
      return block;
    }
    dependencyBlockedIds.add(id);
  }
  if (fallbackParentForRedecomposition) return fallbackParentForRedecomposition;
  return selectSupersededParentWithMissingChildrenForCleanMergedDelivery(text, { ...options, todoState });
}

export function evaluateTodoQueue(text, options = {}) {
  const todoState = options.todoState ?? (
    options.repoRoot
      ? loadTodoState(options.repoRoot, text, {
          additionalReplanRecords: options.todoReplanRecords,
          breakdownPath: options.breakdownPath
        })
      : resolveTodoState({
          todoText: text,
          replanRecords: options.todoReplanRecords,
          completionRecords: options.todoCompletionRecords
        })
  );
  const selected = selectFirstSchedulableTodo(text, { ...options, todoState });
  const decomposition = needsTodoDecomposition(selected);
  return {
    schema_version: 1,
    selected_todo_id: selected ? todoId(selected) : null,
    selected_todo: selected,
    selected_todo_needs_decomposition: decomposition.needs_decomposition,
    selected_todo_decomposition_reason: decomposition.reason,
    decomposition_score: scoreTodoDecompositionText(text),
    todo_state: todoStateSummary(todoState)
  };
}

function parseArgs(argv) {
  const args = { mode: argv[2] ?? 'select', excludedTodoHashes: [] };
  for (let index = 3; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--todo') {
      args.todo = value;
      index += 1;
    } else if (key === '--breakdown') {
      args.breakdown = value;
      index += 1;
    } else if (key === '--blocked') {
      args.blocked = value;
      index += 1;
    } else if (key === '--claim-dir') {
      args.claimDir = value;
      index += 1;
    } else if (key === '--controller-fingerprint') {
      args.controllerFingerprint = value;
      index += 1;
    } else if (key === '--exclude-todo-sha256') {
      args.excludedTodoHashes.push(value);
      index += 1;
    } else if (key === '--json') {
      args.json = true;
    }
  }
  return args;
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const args = parseArgs(process.argv);
  const todoPath = args.todo ? path.resolve(defaultRepoRoot, args.todo) : path.join(defaultRepoRoot, '.brownie/todo.md');
  // Lineage belongs to the active queue; never pair an overridden TODO with
  // the controller repository's unrelated default breakdown ledger.
  const breakdownPath = args.breakdown
    ? path.resolve(defaultRepoRoot, args.breakdown)
    : path.join(path.dirname(todoPath), 'todo-breakdown.md');
  const text = fs.readFileSync(todoPath, 'utf8');
  const result = evaluateTodoQueue(text, {
    repoRoot: defaultRepoRoot,
    breakdownPath,
    blockedPath: args.blocked,
    claimDir: args.claimDir,
    controllerFingerprint: args.controllerFingerprint,
    excludedTodoHashes: args.excludedTodoHashes
  });
  if (args.mode === 'score' || args.mode === 'needs-decomposition' || args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    process.stdout.write(result.selected_todo ?? '');
  }
}
