#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const defaultTodoPath = '.brownie/todo.md';

function parseArgs(argv) {
  const args = {
    repo: process.cwd(),
    todo: defaultTodoPath
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo') {
      args.repo = argv[++index];
    } else if (arg === '--todo') {
      args.todo = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function git(repoRoot, args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function gitHeadText(repoRoot, relativePath) {
  try {
    return git(repoRoot, ['show', `HEAD:${relativePath}`]);
  } catch {
    return null;
  }
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

function boundedScopeValues(first, keyword) {
  const start = first.indexOf(keyword);
  if (start < 0) {
    return [];
  }
  let rest = first.slice(start + keyword.length).trimStart();
  const scopes = [];
  while (rest.startsWith('`')) {
    const end = rest.indexOf('`', 1);
    if (end < 0) {
      break;
    }
    scopes.push(rest.slice(1, end));
    rest = rest.slice(end + 1).trimStart();
    const separator = rest.match(/^(?:,|and\b|&)\s*/u);
    if (!separator) {
      break;
    }
    rest = rest.slice(separator[0].length).trimStart();
  }
  return scopes;
}

function boundedScopes(block) {
  const first = firstLine(block);
  return [
    ...boundedScopeValues(first, 'Patch only'),
    ...boundedScopeValues(first, 'Create only')
  ];
}

function protectedContract(block) {
  return {
    id: todoId(block),
    first_line: firstLine(block),
    route: lineValue(block, 'Route').toLowerCase(),
    depends_on: lineValue(block, 'Depends on'),
    completion_condition: lineValue(block, 'Completion condition'),
    forbidden_changes: lineValue(block, 'Forbidden changes'),
    verification: lineValue(block, 'Verification'),
    bounded_scopes: boundedScopes(block)
  };
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function contractDrift(before, after) {
  const beforeContract = protectedContract(before);
  const afterContract = protectedContract(after);
  const drifts = [];
  for (const key of ['id', 'first_line', 'route', 'depends_on', 'completion_condition', 'forbidden_changes', 'verification']) {
    if (beforeContract[key] !== afterContract[key]) {
      drifts.push(key);
    }
  }
  if (!sameArray(beforeContract.bounded_scopes, afterContract.bounded_scopes)) {
    drifts.push('bounded_scopes');
  }
  return drifts;
}

function completedTodoIds(repoRoot) {
  const dir = path.join(repoRoot, '.brownie/private/phase-loop/todo-completions');
  const ids = new Set();
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return ids;
    }
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }
    try {
      const record = JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8'));
      const id = typeof record.selected_todo_id === 'string' ? record.selected_todo_id.trim() : '';
      if (id) {
        ids.add(id);
      }
    } catch {
      // Ignore malformed completion evidence. It must not grant completion
      // credit to a missing TODO.
    }
  }
  return ids;
}

export function validateTodoQueueIntegrity({ todoBefore, todoAfter, completedTodoIds: completedIdsInput = [] }) {
  const errors = [];
  const warnings = [];
  const before = blockMap(todoBefore ?? '');
  const after = blockMap(todoAfter ?? '');
  const completedIds = new Set(completedIdsInput);
  const removedTodoIds = [];
  const changedTodoIds = [];
  const addedTodoIds = [];

  for (const [id, beforeBlock] of before.entries()) {
    const afterBlock = after.get(id);
    if (!afterBlock) {
      removedTodoIds.push(id);
      if (!completedIds.has(id)) {
        errors.push({
          code: 'todo_removed_without_completion_record',
          message: 'A TODO was removed from the queue without durable completion evidence.',
          todo_id: id
        });
      }
      continue;
    }
    const drift = contractDrift(beforeBlock, afterBlock);
    if (drift.length > 0) {
      changedTodoIds.push(id);
      errors.push({
        code: 'todo_contract_drift',
        message: 'A surviving TODO changed protected contract fields before claim selection.',
        todo_id: id,
        drift
      });
    }
  }

  for (const id of after.keys()) {
    if (!before.has(id)) {
      addedTodoIds.push(id);
    }
  }

  if (addedTodoIds.length > 0) {
    warnings.push({
      code: 'todo_queue_added_items',
      message: 'New TODOs were added to the queue; existing TODO contracts remain protected.',
      todo_ids: addedTodoIds
    });
  }

  return {
    schema_version: 1,
    valid: errors.length === 0,
    errors,
    warnings,
    removed_todo_ids: removedTodoIds,
    changed_todo_ids: changedTodoIds,
    added_todo_ids: addedTodoIds,
    completed_todo_ids: [...completedIds].sort()
  };
}

export function loadCliInput(args) {
  const repoRoot = path.resolve(args.repo);
  const todoPath = path.resolve(repoRoot, args.todo);
  const todoRelative = path.relative(repoRoot, todoPath).split(path.sep).join('/');
  const todoBefore = gitHeadText(repoRoot, todoRelative);
  const todoAfter = maybeReadText(todoPath);
  return {
    repoRoot,
    todoRelative,
    todoBefore,
    todoAfter,
    completedTodoIds: [...completedTodoIds(repoRoot)]
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const input = loadCliInput(args);
    if (input.todoBefore === null || input.todoAfter === null) {
      const output = {
        schema_version: 1,
        valid: true,
        errors: [],
        warnings: [{
          code: 'todo_queue_integrity_baseline_unavailable',
          message: 'TODO queue integrity baseline is unavailable; skipping protected-contract comparison.',
          todo_path: input.todoRelative
        }]
      };
      console.log(JSON.stringify(output, null, 2));
      process.exit(0);
    }
    const validation = validateTodoQueueIntegrity(input);
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
        code: 'todo_queue_integrity_exception',
        message: error?.message ?? String(error)
      }]
    }, null, 2));
    process.exit(1);
  }
}
