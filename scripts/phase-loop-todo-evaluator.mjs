#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  scoreTodoDecompositionText,
  uncheckedTodoBlocks
} from './guard-todo-decomposition.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');

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
    lower.includes('owner-controlled');
  return namesBlocker && forbidsImplementation && ['documentation', 'release-ops', 'release-judgment/resync', ''].includes(route);
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

function readBlockedClaims(blockedPath, queueFingerprint) {
  if (!blockedPath || !fs.existsSync(blockedPath)) {
    return { hashes: new Set(), firstLines: new Set(), stableIds: new Set(), stablePrefixes: new Set() };
  }
  const hashes = new Set();
  const firstLines = new Set();
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
      }
      if (record.queue_fingerprint === queueFingerprint && typeof record.selected_todo_first_line === 'string' && record.selected_todo_first_line) {
        firstLines.add(record.selected_todo_first_line);
      }
      if (typeof record.selected_todo_first_line === 'string' && record.selected_todo_first_line) {
        const blockedId = todoId(record.selected_todo_first_line);
        const explicitOwnerBlocker = record.selected_todo_first_line.includes('Blocker:');
        if (
          blockedId &&
          (
            blockedId.includes('-leaf') ||
            blockedId.includes('-doc-sync-leaf') ||
            blockedId.startsWith('TODO-decompose-broad-todo-') ||
            explicitOwnerBlocker
          )
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
  return { hashes, firstLines, stableIds, stablePrefixes };
}

export function selectFirstSchedulableTodo(text, options = {}) {
  const blocks = uncheckedTodoBlocks(text);
  const queueFingerprint = sha256Text(text);
  const blocked = readBlockedClaims(options.blockedPath, queueFingerprint);
  const uncheckedIds = new Set(blocks.map(todoId).filter(Boolean));
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
    const deps = dependsOn(block);
    if (deps.some((dep) => uncheckedIds.has(dep) || dependencyBlockedIds.has(dep))) {
      dependencyBlockedIds.add(id);
      continue;
    }
    const firstLine = block.split('\n')[0]?.trim() ?? '';
    const blockHash = sha256Text(block);
    if (blocked.stableIds.has(id) && (isDerivedLeaf(block) || isExplicitBlockerTodo(block) || id.includes('-leaf'))) {
      dependencyBlockedIds.add(id);
      continue;
    }
    if (!blocked.hashes.has(blockHash) && !blocked.firstLines.has(firstLine)) {
      return block;
    }
    dependencyBlockedIds.add(id);
  }
  return fallbackParentForRedecomposition;
}

export function evaluateTodoQueue(text, options = {}) {
  const selected = selectFirstSchedulableTodo(text, options);
  const decomposition = needsTodoDecomposition(selected);
  return {
    schema_version: 1,
    selected_todo_id: selected ? todoId(selected) : null,
    selected_todo: selected,
    selected_todo_needs_decomposition: decomposition.needs_decomposition,
    selected_todo_decomposition_reason: decomposition.reason,
    decomposition_score: scoreTodoDecompositionText(text)
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
    } else if (key === '--blocked') {
      args.blocked = value;
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
  const text = fs.readFileSync(todoPath, 'utf8');
  const result = evaluateTodoQueue(text, { blockedPath: args.blocked });
  if (args.mode === 'score' || args.mode === 'needs-decomposition' || args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    process.stdout.write(result.selected_todo ?? '');
  }
}
