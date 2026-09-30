import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { validateTodoQueueIntegrity } from './phase-loop-todo-queue-integrity.mjs';

const e20a = `- [ ] E-20a-golden-journey-workspace-mutation: Patch only \`scripts/release-runtime-operational-evidence.mjs\` and \`scripts/guard-runtime-operational-evidence.test.mjs\`: make Golden Journey require mutation.
  Route: implementation.
  Depends on: <none>.
  Completion condition: generated runtime operational evidence records satisfied Golden Journey only when the fixture mutates the workspace.
  Forbidden changes: do not edit unrelated evidence files by hand, do not mark Runtime/Product Ready, and do not weaken Golden Journey required steps.
  Verification: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`.`;

const e20b = `- [ ] E-20b-stateful-soak-real-workload: Patch only \`scripts/release-runtime-operational-evidence.mjs\` and \`scripts/guard-runtime-operational-evidence.test.mjs\`: replace version-only soak.
  Route: implementation.
  Depends on: E-20a-golden-journey-workspace-mutation.
  Completion condition: generated runtime operational evidence records satisfied soak only when stateful durability steps pass.
  Forbidden changes: do not reduce iteration requirements by assertion only, do not mark Runtime/Product Ready, and do not bypass required durability checks.
  Verification: run \`pnpm --workspace-root release:runtime-operational-evidence:test\`.`;

const e20c = `- [ ] E-20c-release-contract-binding: Patch only \`docs/architecture/runtime-release-contract.json\` and \`scripts/guard-release-contract.test.mjs\`: bind tested commit to artifacts.
  Route: documentation.
  Depends on: E-20b-stateful-soak-real-workload.
  Completion condition: Release Contract refuses null tested commit when artifacts are declared sufficient.
  Forbidden changes: do not mark Product Ready and do not remove artifact smoke requirements.
  Verification: run \`pnpm --workspace-root guard:release-contract:test\`.`;

function queue(...blocks) {
  return `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n${blocks.join('\n\n')}\n`;
}

test('allows removing a completed TODO while preserving dependent TODO contract', () => {
  const result = validateTodoQueueIntegrity({
    todoBefore: queue(e20a, e20b),
    todoAfter: queue(e20b),
    completedTodoIds: ['E-20a-golden-journey-workspace-mutation']
  });

  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test('rejects dependent TODO dependency rewrite even when prerequisite is completed', () => {
  const result = validateTodoQueueIntegrity({
    todoBefore: queue(e20a, e20b),
    todoAfter: queue(e20b.replace('Depends on: E-20a-golden-journey-workspace-mutation.', 'Depends on: <none>.')),
    completedTodoIds: ['E-20a-golden-journey-workspace-mutation']
  });

  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.code === 'todo_contract_drift' && error.todo_id === 'E-20b-stateful-soak-real-workload'));
});

test('rejects removing a TODO without completion evidence', () => {
  const result = validateTodoQueueIntegrity({
    todoBefore: queue(e20a, e20b),
    todoAfter: queue(e20b),
    completedTodoIds: []
  });

  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.code === 'todo_removed_without_completion_record' && error.todo_id === 'E-20a-golden-journey-workspace-mutation'));
});

test('rejects changing verification and completion contract on a surviving TODO', () => {
  const result = validateTodoQueueIntegrity({
    todoBefore: queue(e20b),
    todoAfter: queue(
      e20b
        .replace('Completion condition: generated runtime operational evidence records satisfied soak only when stateful durability steps pass.', 'Completion condition: version command succeeds.')
        .replace('Verification: run `pnpm --workspace-root release:runtime-operational-evidence:test`.', 'Verification: run `node scripts/missing-validator.js`.')
    ),
    completedTodoIds: []
  });

  assert.equal(result.valid, false);
  const drift = result.errors.find((error) => error.code === 'todo_contract_drift');
  assert.deepEqual(drift.drift.sort(), ['completion_condition', 'verification'].sort());
});

test('allows adding a new TODO without changing existing TODO contracts', () => {
  const result = validateTodoQueueIntegrity({
    todoBefore: queue(e20a),
    todoAfter: queue(e20a, e20b),
    completedTodoIds: []
  });

  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.added_todo_ids, ['E-20b-stateful-soak-real-workload']);
});

test('rejects dependency pruning across a three-item queue', () => {
  const result = validateTodoQueueIntegrity({
    todoBefore: queue(e20a, e20b, e20c),
    todoAfter: queue(
      e20b.replace('Depends on: E-20a-golden-journey-workspace-mutation.', 'Depends on: <none>.'),
      e20c
    ),
    completedTodoIds: ['E-20a-golden-journey-workspace-mutation']
  });

  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.code === 'todo_contract_drift' && error.drift.includes('depends_on')));
});

test('CLI rejects dirty queue contract drift against HEAD', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-todo-queue-integrity-'));
  fs.mkdirSync(path.join(tmp, '.brownie/private/phase-loop/todo-completions'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.brownie/todo.md'), queue(e20a, e20b));
  execFileSync('git', ['init', '-b', 'main'], { cwd: tmp, stdio: 'ignore' });
  execFileSync('git', ['add', '.brownie/todo.md'], { cwd: tmp, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=Brownie', '-c', 'user.email=brownie@example.invalid', 'commit', '-m', 'todo baseline'], { cwd: tmp, stdio: 'ignore' });
  fs.writeFileSync(
    path.join(tmp, '.brownie/private/phase-loop/todo-completions/claim.json'),
    `${JSON.stringify({ selected_todo_id: 'E-20a-golden-journey-workspace-mutation' })}\n`
  );
  fs.writeFileSync(
    path.join(tmp, '.brownie/todo.md'),
    queue(e20b.replace('Depends on: E-20a-golden-journey-workspace-mutation.', 'Depends on: <none>.'))
  );

  assert.throws(() => {
    execFileSync('node', [path.resolve('scripts/phase-loop-todo-queue-integrity.mjs'), '--repo', tmp, '--todo', '.brownie/todo.md'], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  }, /todo_contract_drift/);
});
