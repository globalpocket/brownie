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

function readBlockedClaims(blockedPath, queueFingerprint) {
  if (!blockedPath || !fs.existsSync(blockedPath)) {
    return { hashes: new Set(), firstLines: new Set() };
  }
  const hashes = new Set();
  const firstLines = new Set();
  for (const line of fs.readFileSync(blockedPath, 'utf8').split('\n')) {
    if (!line.trim()) {
      continue;
    }
    try {
      const record = JSON.parse(line);
      if (typeof record.selected_todo_first_line === 'string' && record.selected_todo_first_line) {
        firstLines.add(record.selected_todo_first_line);
      }
      if (record.queue_fingerprint === queueFingerprint && typeof record.selected_todo_sha256 === 'string') {
        hashes.add(record.selected_todo_sha256);
      }
    } catch {
      // Ignore corrupt historical blocked entries; the phase-loop guard remains fail-closed elsewhere.
    }
  }
  return { hashes, firstLines };
}

export function selectFirstSchedulableTodo(text, options = {}) {
  const blocks = uncheckedTodoBlocks(text);
  const queueFingerprint = sha256Text(text);
  const blocked = readBlockedClaims(options.blockedPath, queueFingerprint);
  const uncheckedIds = new Set(blocks.map(todoId).filter(Boolean));
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
    const prefix = productPrefix(id);
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
    if (!blocked.hashes.has(blockHash) && !blocked.firstLines.has(firstLine)) {
      return block;
    }
    dependencyBlockedIds.add(id);
  }
  return '';
}

export function evaluateTodoQueue(text, options = {}) {
  const selected = selectFirstSchedulableTodo(text, options);
  return {
    schema_version: 1,
    selected_todo_id: selected ? todoId(selected) : null,
    selected_todo: selected,
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
  if (args.mode === 'score' || args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    process.stdout.write(result.selected_todo ?? '');
  }
}
