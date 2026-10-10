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

function boundedScopes(block) {
  const firstLine = block.split('\n')[0]?.trim() ?? '';
  const match = firstLine.match(/(?:Patch only|Create only)\s+(.+?)(?::|$)/);
  if (!match) {
    return [];
  }
  return [...match[1].matchAll(/`([^`\n]+)`/g)].map((entry) => entry[1]);
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
  if (!blockedPath || !fs.existsSync(blockedPath)) {
    return {
      hashes: new Set(),
      firstLines: new Set(),
      currentControllerHashes: new Set(),
      currentControllerFirstLines: new Set(),
      stableIds: new Set(),
      stablePrefixes: new Set()
    };
  }
  const hashes = new Set();
  const firstLines = new Set();
  const currentControllerHashes = new Set();
  const currentControllerFirstLines = new Set();
  const stableIds = new Set();
  const stablePrefixes = new Set();
  for (const line of fs.readFileSync(blockedPath, 'utf8').split('\n')) {
    if (!line.trim()) {
      continue;
    }
    try {
      const record = JSON.parse(line);
      if (record.queue_fingerprint === queueFingerprint && typeof record.selected_todo_sha256 === 'string') {
        hashes.add(record.selected_todo_sha256);
        if (controllerFingerprint && record.controller_fingerprint === controllerFingerprint) {
          currentControllerHashes.add(record.selected_todo_sha256);
        }
      }
      if (record.queue_fingerprint === queueFingerprint && typeof record.selected_todo_first_line === 'string' && record.selected_todo_first_line) {
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
  return { hashes, firstLines, currentControllerHashes, currentControllerFirstLines, stableIds, stablePrefixes };
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
  let fallbackParentForRedecomposition = '';
  const derivedPrefixes = new Set(
    blocks
      .filter(isDerivedLeaf)
      .map((block) => productPrefix(todoId(block)))
      .filter(Boolean)
  );
  const dependencyBlockedIds = new Set();
  for (const block of blocks) {
    const id = todoId(block);
    if (!id) {
      continue;
    }
    if (todoState.completedIds.has(id) || todoState.supersededIds.has(id)) {
      continue;
    }
    if (blockedQueueDecompositionQueued && !id.startsWith('TODO-decompose-blocked-queue-')) {
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
    const blockHash = sha256Text(block);
    if (blocked.stableIds.has(id)) {
      // A blocked record is not completion evidence. Dependents remain blocked
      // until the shared TODO state marks this id completed or resolves a
      // superseded parent through all of its generated children.
      dependencyBlockedIds.add(id);
      continue;
    }
    const blockedInCurrentQueue = blocked.hashes.has(blockHash) || blocked.firstLines.has(firstLine);
    const blockedByCurrentController = blocked.currentControllerHashes.has(blockHash) || blocked.currentControllerFirstLines.has(firstLine);
    const sourceId = sourceTodoId(block);
    const sourceIsGeneratedParent = Boolean(productPrefix(sourceId));
    const canRetryAfterControllerRepair = blockedInCurrentQueue && !blockedByCurrentController && !isExplicitBlockerTodo(block) && !sourceIsGeneratedParent && !id.includes('-leaf');
    if (!blockedInCurrentQueue || canRetryAfterControllerRepair) {
      return block;
    }
    dependencyBlockedIds.add(id);
  }
  return fallbackParentForRedecomposition;
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
  const args = { mode: argv[2] ?? 'select' };
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
    } else if (key === '--controller-fingerprint') {
      args.controllerFingerprint = value;
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
    controllerFingerprint: args.controllerFingerprint
  });
  if (args.mode === 'score' || args.mode === 'needs-decomposition' || args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    process.stdout.write(result.selected_todo ?? '');
  }
}
