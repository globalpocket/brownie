import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { migrateTodoTransaction } from './phase-loop-todo-transactional-migrate.mjs';

function interruptedWriteFixture() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-two-file-recovery-'));
  const directory = path.join(repo, '.brownie');
  fs.mkdirSync(directory);
  const before = ['before TODO\n', 'before breakdown\n'];
  const live = [path.join(directory, 'todo.md'), path.join(directory, 'todo-breakdown.md')];
  live.forEach((file, index) => fs.writeFileSync(file, before[index]));
  const planPath = path.join(repo, 'plan.json');
  const afterTodoPath = path.join(repo, 'after-todo.md');
  const afterBreakdownPath = path.join(repo, 'after-breakdown.md');
  const hash = text => crypto.createHash('sha256').update(text).digest('hex');
  fs.writeFileSync(planPath, JSON.stringify({ schema_version: 1,
    before: { todo_sha256: hash(before[0]), breakdown_sha256: hash(before[1]) },
    todo_ids: ['fixture'], diagnostic: 'Actual second-file publication fault' }));
  fs.writeFileSync(afterTodoPath, 'after TODO\n');
  fs.writeFileSync(afterBreakdownPath, 'after breakdown\n');
  return { repo, live, before, input: { repoRoot: repo, planPath, afterTodoPath, afterBreakdownPath } };
}

for (const persistent of [false, true]) {
  test(`second live rename failure preserves both preimages; persistent=${persistent}`, () => {
    const fixture = interruptedWriteFixture();
    const original = fs.renameSync;
    let failures = 0;
    try {
      fs.renameSync = (from, to) => {
        if (to === fixture.live[1] && (persistent || failures === 0)) {
          failures += 1;
          throw Object.assign(new Error('injected second live rename EIO'), { code: 'EIO' });
        }
        return original(from, to);
      };
      if (persistent) assert.throws(() => migrateTodoTransaction(fixture.input), /injected second live rename/);
      else assert.equal(migrateTodoTransaction(fixture.input).reason, 'validation_failed_reverted');
    } finally {
      fs.renameSync = original;
    }
    try {
      assert.deepEqual(fixture.live.map(file => fs.readFileSync(file, 'utf8')), fixture.before);
      if (persistent) assert.equal(migrateTodoTransaction(fixture.input).reason, 'interrupted_migration_reverted');
      assert.deepEqual(fixture.live.map(file => fs.readFileSync(file, 'utf8')), fixture.before);
    } finally {
      fs.rmSync(fixture.repo, { recursive: true, force: true });
    }
  });
}

test('an actual process exit between the two renames is recovered from the retained snapshots', () => {
  const fixture = interruptedWriteFixture();
  const moduleUrl = pathToFileURL(path.resolve('scripts/phase-loop-todo-transactional-migrate.mjs')).href;
  const child = `import fs from 'node:fs'; import {migrateTodoTransaction} from ${JSON.stringify(moduleUrl)};
    const rename = fs.renameSync; fs.renameSync = (from, to) => {
      if (to === ${JSON.stringify(fixture.live[1])}) process.exit(87);
      return rename(from, to);
    }; migrateTodoTransaction(${JSON.stringify(fixture.input)});`;
  try {
    assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', child]), error => error.status === 87);
    assert.equal(fs.readFileSync(fixture.live[0], 'utf8'), 'after TODO\n');
    assert.equal(fs.readFileSync(fixture.live[1], 'utf8'), fixture.before[1]);
    assert.equal(migrateTodoTransaction(fixture.input).reason, 'interrupted_migration_reverted');
    assert.deepEqual(fixture.live.map(file => fs.readFileSync(file, 'utf8')), fixture.before);
  } finally {
    fs.rmSync(fixture.repo, { recursive: true, force: true });
  }
});

test('transactional migration refuses a stale two-file baseline without writes', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-transactional-migration-'));
  fs.mkdirSync(path.join(repo, '.brownie'), { recursive: true });
  const todo = path.join(repo, '.brownie/todo.md');
  const breakdown = path.join(repo, '.brownie/todo-breakdown.md');
  fs.writeFileSync(todo, '- [ ] T-1: Patch only `README.md`:\n  Route: implementation.\n  Depends on: <none>.\n  Completion condition: update README.\n  Forbidden changes: none.\n  Verification: run `node --version`.\n');
  fs.writeFileSync(breakdown, '# Brownie TODO breakdown\n');
  const plan = path.join(repo, 'plan.json');
  const afterTodo = path.join(repo, 'after-todo.md');
  const afterBreakdown = path.join(repo, 'after-breakdown.md');
  fs.writeFileSync(plan, JSON.stringify({ schema_version: 1, before: { todo_sha256: 'stale', breakdown_sha256: 'stale' }, todo_ids: ['T-1'], diagnostic: 'fixture' }));
  fs.writeFileSync(afterTodo, 'changed\n'); fs.writeFileSync(afterBreakdown, 'changed\n');
  const script = path.resolve('scripts/phase-loop-todo-transactional-migrate.mjs');
  assert.throws(() => execFileSync('node', [script, '--repo', repo, '--plan', plan, '--after-todo', afterTodo, '--after-breakdown', afterBreakdown], { encoding: 'utf8' }));
  assert.match(fs.readFileSync(todo, 'utf8'), /T-1/);
  assert.equal(fs.readFileSync(breakdown, 'utf8'), '# Brownie TODO breakdown\n');
});
