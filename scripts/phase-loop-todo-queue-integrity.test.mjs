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

test('allows a TODO checked in the live queue to serve as durable completion evidence', () => {
  const result = validateTodoQueueIntegrity({
    todoBefore: queue(e20a, e20b),
    todoAfter: queue(e20a.replace('- [ ]', '- [x]'), e20b),
    completedTodoIds: []
  });

  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert(result.completed_todo_ids.includes('E-20a-golden-journey-workspace-mutation'));
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
  assert(result.errors.some((error) => error.code === 'todo_removed_without_completion_or_replan_record' && error.todo_id === 'E-20a-golden-journey-workspace-mutation'));
});

test('allows replacing a parent TODO with live child leaves when durable replan evidence exists', () => {
  const childA = `- [ ] E-20a-golden-journey-workspace-mutation-target-01: Patch only \`scripts/release-runtime-operational-evidence.mjs\`:
  Route: implementation.
  Source TODO: E-20a-golden-journey-workspace-mutation.
  Depends on: <none>.
  Completion condition: first split child updates runtime operational evidence collector.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root check\`.`;
  const childB = `- [ ] E-20a-golden-journey-workspace-mutation-target-02: Patch only \`scripts/guard-runtime-operational-evidence.test.mjs\`:
  Route: implementation.
  Source TODO: E-20a-golden-journey-workspace-mutation.
  Depends on: E-20a-golden-journey-workspace-mutation-target-01.
  Completion condition: second split child updates runtime operational evidence tests.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root check\`.`;
  const result = validateTodoQueueIntegrity({
    todoBefore: queue(e20a, e20b),
    todoAfter: queue(childA, childB, e20b),
    completedTodoIds: [],
    todoReplanRecords: [{
      record_type: 'todo_replan',
      operation: 'split_parent_into_children',
      parent_status: 'superseded_by_children',
      parent_todo_id: 'E-20a-golden-journey-workspace-mutation',
      generated_child_ids: [
        'E-20a-golden-journey-workspace-mutation-target-01',
        'E-20a-golden-journey-workspace-mutation-target-02'
      ]
    }]
  });

  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.replanned_todo_ids, ['E-20a-golden-journey-workspace-mutation']);
});

test('allows replacing a residual blocker with children from an explicit replacement source TODO', () => {
  const residual = `- [ ] E-19k-remaining-release-evidence-blocker: Blocker: release evidence remains incomplete.
  Route: release-ops.
  Depends on: <none>.
  Completion condition: remaining release blocker evidence stays fail-closed until concrete evidence leaves exist.
  Forbidden changes: do not patch workspace files for this blocker.
  Verification: blocker: release evidence remains fail-closed.`;
  const childA = `- [ ] E-21c-release-ops-todo-split-clean-release-workspace: Blocker: clean Release workspace evidence exists:
  Route: release-ops.
  Source TODO: E-21c-release-ops-todo-split.
  Depends on: <none>.
  Completion condition: Release Ops has a fail-closed evidence item for clean workspace source identity.
  Forbidden changes: do not patch implementation files for this Release Ops blocker.
  Verification: blocker: Release Ops evidence remains fail-closed.`;
  const childB = `- [ ] E-21c-release-ops-todo-split-document-generation-sync: Blocker: Release documents are synchronized:
  Route: release-ops.
  Source TODO: E-21c-release-ops-todo-split.
  Depends on: E-21c-release-ops-todo-split-clean-release-workspace.
  Completion condition: Release Ops has a fail-closed evidence item for document generation synchronization.
  Forbidden changes: do not patch implementation files for this Release Ops blocker.
  Verification: blocker: Release Ops evidence remains fail-closed.`;
  const result = validateTodoQueueIntegrity({
    todoBefore: queue(residual),
    todoAfter: queue(childA, childB),
    completedTodoIds: [],
    todoReplanRecords: [{
      record_type: 'todo_replan',
      operation: 'split_parent_into_children',
      parent_status: 'superseded_by_children',
      parent_todo_id: 'E-19k-remaining-release-evidence-blocker',
      replacement_source_todo_id: 'E-21c-release-ops-todo-split',
      generated_child_ids: [
        'E-21c-release-ops-todo-split-clean-release-workspace',
        'E-21c-release-ops-todo-split-document-generation-sync'
      ]
    }]
  });

  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.replanned_todo_ids, ['E-19k-remaining-release-evidence-blocker']);
});

test('allows transitive replan chains when intermediate children were split again', () => {
  const residual = `- [ ] E-19k-remaining-release-evidence-blocker: Blocker: release evidence remains incomplete.
  Route: release-ops.
  Depends on: <none>.
  Completion condition: remaining release blocker evidence stays fail-closed until concrete evidence leaves exist.
  Forbidden changes: do not patch workspace files for this blocker.
  Verification: blocker: release evidence remains fail-closed.`;
  const targetA = `- [ ] E-21c-clean-release-workspace-impl-1-target-01: Patch only \`scripts/release-supply-chain-artifact-evidence.mjs\` to complete one bounded slice:
  Route: implementation.
  Source TODO: E-21c-clean-release-workspace-impl-1.
  Depends on: <none>.
  Completion condition: first split child updates supply-chain evidence collector.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root guard:supply-chain-artifact-evidence:test\`.`;
  const targetB = `- [ ] E-21c-clean-release-workspace-impl-1-target-02: Patch only \`scripts/guard-supply-chain-artifact-evidence.test.mjs\` to complete one bounded slice:
  Route: implementation.
  Source TODO: E-21c-clean-release-workspace-impl-1.
  Depends on: E-21c-clean-release-workspace-impl-1-target-01.
  Completion condition: second split child updates supply-chain evidence tests.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root guard:supply-chain-artifact-evidence:test\`.`;
  const sibling = `- [ ] E-21c-runtime-operational-evidence-impl-2: Patch only \`scripts/release-runtime-operational-evidence.mjs\`:
  Route: implementation.
  Source TODO: TODO-refine-brownie-owned-blockers-abc123.
  Depends on: E-21c-clean-release-workspace-impl-1.
  Completion condition: runtime operational evidence is fail-closed.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root guard:runtime-operational-evidence:test\`.`;
  const result = validateTodoQueueIntegrity({
    todoBefore: queue(residual),
    todoAfter: queue(targetA, targetB, sibling),
    completedTodoIds: [],
    todoReplanRecords: [
      {
        record_type: 'todo_replan',
        operation: 'split_parent_into_children',
        parent_status: 'superseded_by_children',
        parent_todo_id: 'E-19k-remaining-release-evidence-blocker',
        replacement_source_todo_id: 'TODO-refine-brownie-owned-blockers-abc123',
        generated_child_ids: [
          'E-21c-clean-release-workspace-impl-1',
          'E-21c-runtime-operational-evidence-impl-2'
        ]
      },
      {
        record_type: 'todo_replan',
        operation: 'split_parent_into_children',
        parent_status: 'superseded_by_children',
        parent_todo_id: 'E-21c-clean-release-workspace-impl-1',
        generated_child_ids: [
          'E-21c-clean-release-workspace-impl-1-target-01',
          'E-21c-clean-release-workspace-impl-1-target-02'
        ]
      }
    ]
  });

  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.replanned_todo_ids, ['E-19k-remaining-release-evidence-blocker']);
});

test('allows transitive replan chains when a grandchild is already completed', () => {
  const residual = `- [ ] E-19k-remaining-release-evidence-blocker: Blocker: release evidence remains incomplete.
  Route: release-ops.
  Depends on: <none>.
  Completion condition: remaining release blocker evidence stays fail-closed until concrete evidence leaves exist.
  Forbidden changes: do not patch workspace files for this blocker.
  Verification: blocker: release evidence remains fail-closed.`;
  const targetB = `- [ ] E-21c-clean-release-workspace-impl-1-target-02: Patch only \`scripts/guard-supply-chain-artifact-evidence.test.mjs\` to complete one bounded slice:
  Route: implementation.
  Source TODO: E-21c-clean-release-workspace-impl-1.
  Depends on: <none>.
  Completion condition: second split child updates supply-chain evidence tests.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root guard:supply-chain-artifact-evidence:test\`.`;
  const sibling = `- [ ] E-21c-runtime-operational-evidence-impl-2: Patch only \`scripts/release-runtime-operational-evidence.mjs\`:
  Route: implementation.
  Source TODO: TODO-refine-brownie-owned-blockers-abc123.
  Depends on: E-21c-clean-release-workspace-impl-1.
  Completion condition: runtime operational evidence is fail-closed.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root guard:runtime-operational-evidence:test\`.`;
  const result = validateTodoQueueIntegrity({
    todoBefore: queue(residual),
    todoAfter: queue(targetB, sibling),
    completedTodoIds: ['E-21c-clean-release-workspace-impl-1-target-01'],
    todoReplanRecords: [
      {
        record_type: 'todo_replan',
        operation: 'split_parent_into_children',
        parent_status: 'superseded_by_children',
        parent_todo_id: 'E-19k-remaining-release-evidence-blocker',
        replacement_source_todo_id: 'TODO-refine-brownie-owned-blockers-abc123',
        generated_child_ids: [
          'E-21c-clean-release-workspace-impl-1',
          'E-21c-runtime-operational-evidence-impl-2'
        ]
      },
      {
        record_type: 'todo_replan',
        operation: 'split_parent_into_children',
        parent_status: 'superseded_by_children',
        parent_todo_id: 'E-21c-clean-release-workspace-impl-1',
        generated_child_ids: [
          'E-21c-clean-release-workspace-impl-1-target-01',
          'E-21c-clean-release-workspace-impl-1-target-02'
        ]
      }
    ]
  });

  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.replanned_todo_ids, ['E-19k-remaining-release-evidence-blocker']);
});

test('rejects parent replacement when replan children are missing or not linked to the parent', () => {
  const child = `- [ ] E-20a-golden-journey-workspace-mutation-target-01: Patch only \`scripts/release-runtime-operational-evidence.mjs\`:
  Route: implementation.
  Source TODO: E-20-not-the-parent.
  Depends on: <none>.
  Completion condition: first split child updates runtime operational evidence collector.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root check\`.`;
  const result = validateTodoQueueIntegrity({
    todoBefore: queue(e20a, e20b),
    todoAfter: queue(child, e20b),
    completedTodoIds: [],
    todoReplanRecords: [{
      record_type: 'todo_replan',
      operation: 'split_parent_into_children',
      parent_status: 'superseded_by_children',
      parent_todo_id: 'E-20a-golden-journey-workspace-mutation',
      generated_child_ids: [
        'E-20a-golden-journey-workspace-mutation-target-01',
        'E-20a-golden-journey-workspace-mutation-target-02'
      ]
    }]
  });

  assert.equal(result.valid, false);
  const error = result.errors.find((item) => item.todo_id === 'E-20a-golden-journey-workspace-mutation');
  assert.equal(error.code, 'todo_removed_without_completion_or_replan_record');
  assert.equal(error.replan_rejection.reason, 'generated_children_not_live_or_not_linked_to_parent');
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

test('rejects completed TODO reappearing as an unchecked live queue item', () => {
  const result = validateTodoQueueIntegrity({
    todoBefore: queue(e20a),
    todoAfter: queue(e20a, e20b),
    completedTodoIds: ['E-20a-golden-journey-workspace-mutation']
  });

  assert.equal(result.valid, false);
  assert(result.errors.some((error) => (
    error.code === 'completed_todo_reappeared_in_live_queue' &&
    error.todo_id === 'E-20a-golden-journey-workspace-mutation'
  )), JSON.stringify(result.errors));
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

test('CLI accepts parent TODO superseded by children when durable replan record exists', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-todo-replan-integrity-'));
  fs.mkdirSync(path.join(tmp, '.brownie/private/phase-loop/todo-replans'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.brownie/todo.md'), queue(e20a, e20b));
  execFileSync('git', ['init', '-b', 'main'], { cwd: tmp, stdio: 'ignore' });
  execFileSync('git', ['add', '.brownie/todo.md'], { cwd: tmp, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=Brownie', '-c', 'user.email=brownie@example.invalid', 'commit', '-m', 'todo baseline'], { cwd: tmp, stdio: 'ignore' });
  const childA = `- [ ] E-20a-golden-journey-workspace-mutation-target-01: Patch only \`scripts/release-runtime-operational-evidence.mjs\`:
  Route: implementation.
  Source TODO: E-20a-golden-journey-workspace-mutation.
  Depends on: <none>.
  Completion condition: first split child updates runtime operational evidence collector.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root check\`.`;
  const childB = `- [ ] E-20a-golden-journey-workspace-mutation-target-02: Patch only \`scripts/guard-runtime-operational-evidence.test.mjs\`:
  Route: implementation.
  Source TODO: E-20a-golden-journey-workspace-mutation.
  Depends on: E-20a-golden-journey-workspace-mutation-target-01.
  Completion condition: second split child updates runtime operational evidence tests.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root check\`.`;
  fs.writeFileSync(path.join(tmp, '.brownie/todo.md'), queue(childA, childB, e20b));
  fs.writeFileSync(
    path.join(tmp, '.brownie/private/phase-loop/todo-replans/e20a.json'),
    `${JSON.stringify({
      schema_version: 1,
      record_type: 'todo_replan',
      operation: 'split_parent_into_children',
      parent_status: 'superseded_by_children',
      parent_todo_id: 'E-20a-golden-journey-workspace-mutation',
      generated_child_ids: [
        'E-20a-golden-journey-workspace-mutation-target-01',
        'E-20a-golden-journey-workspace-mutation-target-02'
      ]
    }, null, 2)}\n`
  );

  const output = execFileSync('node', [path.resolve('scripts/phase-loop-todo-queue-integrity.mjs'), '--repo', tmp, '--todo', '.brownie/todo.md'], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const result = JSON.parse(output);
  assert.equal(result.valid, true, output);
  assert.deepEqual(result.replanned_todo_ids, ['E-20a-golden-journey-workspace-mutation']);
});

test('CLI accepts parent TODO superseded by children from tracked breakdown repair ledger', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-todo-breakdown-replan-integrity-'));
  fs.mkdirSync(path.join(tmp, '.brownie'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.brownie/todo.md'), queue(e20a, e20b));
  fs.writeFileSync(path.join(tmp, '.brownie/todo-breakdown.md'), '# Brownie TODO breakdown\n');
  execFileSync('git', ['init', '-b', 'main'], { cwd: tmp, stdio: 'ignore' });
  execFileSync('git', ['add', '.brownie/todo.md', '.brownie/todo-breakdown.md'], { cwd: tmp, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=Brownie', '-c', 'user.email=brownie@example.invalid', 'commit', '-m', 'todo baseline'], { cwd: tmp, stdio: 'ignore' });
  const childA = `- [ ] E-20a-golden-journey-workspace-mutation-target-01: Patch only \`scripts/release-runtime-operational-evidence.mjs\`:
  Route: implementation.
  Source TODO: E-20a-golden-journey-workspace-mutation.
  Depends on: <none>.
  Completion condition: first split child updates runtime operational evidence collector.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root check\`.`;
  const childB = `- [ ] E-20a-golden-journey-workspace-mutation-target-02: Patch only \`scripts/guard-runtime-operational-evidence.test.mjs\`:
  Route: implementation.
  Source TODO: E-20a-golden-journey-workspace-mutation.
  Depends on: E-20a-golden-journey-workspace-mutation-target-01.
  Completion condition: second split child updates runtime operational evidence tests.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root check\`.`;
  fs.writeFileSync(path.join(tmp, '.brownie/todo.md'), queue(childA, childB, e20b));
  fs.writeFileSync(path.join(tmp, '.brownie/todo-breakdown.md'), `# Brownie TODO breakdown

## TODO-repair-E-20a-golden-journey-workspace-mutation

Parent TODO: E-20a-golden-journey-workspace-mutation

Dependency graph:
- E-20a-golden-journey-workspace-mutation: <none>
- E-20a-golden-journey-workspace-mutation-target-01: <none>
- E-20a-golden-journey-workspace-mutation-target-02: E-20a-golden-journey-workspace-mutation-target-01
`);

  const output = execFileSync('node', [path.resolve('scripts/phase-loop-todo-queue-integrity.mjs'), '--repo', tmp, '--todo', '.brownie/todo.md'], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const result = JSON.parse(output);
  assert.equal(result.valid, true, output);
  assert.deepEqual(result.replanned_todo_ids, ['E-20a-golden-journey-workspace-mutation']);
});
