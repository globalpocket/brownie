#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  readTodoCompletionInvalidationRecords,
  readTodoCompletionRecords,
  resolveTodoState,
  todoIdFromBlock
} from './phase-loop-todo-state.mjs';

function sha256(value) { return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex'); }
function stamp() { return new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z'); }

function parseArgs(argv) {
  const args = { repo: process.cwd(), todo: '.brownie/todo.md' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--repo' || argument === '--todo' || argument === '--run-stamp' || argument === '--event-key') {
      args[argument.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return args;
}

function uncheckedBlocks(text) {
  const source = String(text ?? '');
  const starts = [...source.matchAll(/^(?:[-*]|\d+[.)])\s+\[ \]\s+/gmu)].map((match) => match.index);
  return starts.map((start, index) => source.slice(start, starts[index + 1] ?? source.length).trimEnd());
}

function atomicWrite(filePath, content) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

// A completion receipt is authoritative only after resolveTodoState has applied
// its exact invalidation rules. This repair changes no task contract: it
// archives the matching completed block out of the live queue and records both
// snapshots.  (A checked block would still be an obsolete live queue entry.)
export function reconcileCompletedTodoProjection({ repoRoot, todoPath = '.brownie/todo.md', runStamp = stamp(), eventKey = null }) {
  const todoFile = path.resolve(repoRoot, todoPath);
  const beforeTodo = fs.readFileSync(todoFile, 'utf8');
  const state = resolveTodoState({
    todoText: beforeTodo,
    completionRecords: readTodoCompletionRecords(repoRoot),
    completionInvalidationRecords: readTodoCompletionInvalidationRecords(repoRoot)
  });
  if (state.errors.length > 0) return { applied: false, reason: 'todo_state_invalid', errors: state.errors };
  const completedLiveIds = uncheckedBlocks(beforeTodo)
    .map(todoIdFromBlock)
    // A checked queue entry or an unverified historical record must not erase
    // a live TODO.  This projection is destructive, so require the narrower
    // independently verified completion set even if another caller later
    // broadens the scheduler's completedIds view.
    .filter((id) => state.durableCompletionIds.has(id));
  if (completedLiveIds.length === 0) return { applied: false, reason: 'no_completed_todo_projection_drift' };

  let afterTodo = beforeTodo;
  for (const id of completedLiveIds) {
    const block = uncheckedBlocks(afterTodo).find((candidate) => todoIdFromBlock(candidate) === id);
    if (!block) throw new Error(`live completed TODO disappeared during reconciliation: ${id}`);
    afterTodo = afterTodo.replace(`${block}\n`, '').replace(block, '');
  }
  const key = eventKey ?? sha256(`${sha256(beforeTodo)}\n${completedLiveIds.join('\n')}`);
  const recoveryDir = path.join(repoRoot, '.brownie/private/phase-loop/todo-claims/completion-projections', key);
  fs.mkdirSync(recoveryDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(recoveryDir, 'todo.before.md'), beforeTodo, { encoding: 'utf8', mode: 0o600 });
  atomicWrite(todoFile, afterTodo);
  const record = {
    schema_version: 1,
    record_type: 'todo_completion_projection_reconciliation',
    status: 'applied',
    run_stamp: String(runStamp),
    event_key: key,
    completed_todo_ids: completedLiveIds,
    before_todo_sha256: sha256(beforeTodo),
    after_todo_sha256: sha256(afterTodo),
    rollback_snapshot: { todo: path.join(recoveryDir, 'todo.before.md') },
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')
  };
  fs.writeFileSync(path.join(recoveryDir, 'record.json'), `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return { applied: true, completed_todo_ids: completedLiveIds, recovery_path: path.relative(repoRoot, recoveryDir) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = reconcileCompletedTodoProjection({ repoRoot: path.resolve(args.repo), todoPath: args.todo, runStamp: args.runStamp, eventKey: args.eventKey });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.applied ? 0 : 1);
  } catch (error) {
    console.error(JSON.stringify({ applied: false, error: error?.message ?? String(error) }));
    process.exit(1);
  }
}
