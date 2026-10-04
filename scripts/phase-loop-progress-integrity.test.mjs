import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { validatePhaseLoopProgressIntegrity } from './phase-loop-progress-integrity.mjs';

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

const e20g = `- [ ] E-20g-final-judgment-sync: Patch only \`docs/architecture/final-product-ready-judgment.json\` and \`scripts/guard-release-evidence-semantic-consistency.test.mjs\`: require Final Judgment generation/status to match.
  Route: documentation.
  Depends on: E-20f-release-generation-sync.
  Completion condition: semantic consistency tests fail when Final Judgment names an obsolete blocker generation.
  Forbidden changes: do not mark Product Ready, do not remove owner-review history, and do not weaken semantic consistency failures.
  Verification: run \`pnpm --workspace-root guard:release-evidence-semantic-consistency:test\`.`;

const e20gLeaf = `- [ ] E-20g-final-judgment-sync-target-01: Patch only \`docs/architecture/final-product-ready-judgment.md\` to complete one bounded slice of E-20g-final-judgment-sync.
  Route: documentation.
  Source TODO: E-20g-final-judgment-sync.
  Depends on: <none>.
  Completion condition: Final Judgment names the current Release blocker generation.
  Forbidden changes: do not mark Product Ready, do not remove owner-review history, and do not weaken semantic consistency failures.
  Verification: run \`pnpm --workspace-root guard:release-evidence-semantic-consistency:test\`.`;

function queue(...blocks) {
  return `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n${blocks.join('\n\n')}\n`;
}

test('rejects removing selected TODO without completion record', () => {
  const result = validatePhaseLoopProgressIntegrity({
    claim: { claim_id: 'claim-1', selected_todo: e20a },
    todoBefore: queue(e20a, e20b),
    todoAfter: queue(e20b.replace('Depends on: E-20a-golden-journey-workspace-mutation.', 'Depends on: <none>.')),
    diffFiles: [
      '.brownie/todo.md',
      'scripts/release-runtime-operational-evidence.mjs'
    ],
    completionRecordExists: false
  });

  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.code === 'selected_todo_removed_without_completion_record'));
});

test('allows selected removal after completion record without rewriting dependent TODO contract', () => {
  const result = validatePhaseLoopProgressIntegrity({
    claim: { claim_id: 'claim-1', selected_todo: e20a },
    todoBefore: queue(e20a, e20b),
    todoAfter: queue(e20b),
    diffFiles: [
      '.brownie/todo.md',
      'scripts/release-runtime-operational-evidence.mjs'
    ],
    completionRecordExists: true
  });

  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test('rejects dependent TODO dependency rewrite even after selected TODO completion record', () => {
  const result = validatePhaseLoopProgressIntegrity({
    claim: { claim_id: 'claim-1', selected_todo: e20a },
    todoBefore: queue(e20a, e20b),
    todoAfter: queue(e20b.replace('Depends on: E-20a-golden-journey-workspace-mutation.', 'Depends on: <none>.')),
    diffFiles: [
      '.brownie/todo.md',
      'scripts/release-runtime-operational-evidence.mjs'
    ],
    completionRecordExists: true
  });

  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.code === 'unselected_todo_contract_drift'));
});

test('allows removing an unselected TODO only when prior completion evidence exists', () => {
  const result = validatePhaseLoopProgressIntegrity({
    claim: { claim_id: 'claim-2', selected_todo: e20b },
    todoBefore: queue(e20a, e20b),
    todoAfter: queue(e20b),
    diffFiles: [
      '.brownie/todo.md',
      'scripts/release-runtime-operational-evidence.mjs'
    ],
    completionRecordExists: false,
    completedTodoIds: ['E-20a-golden-journey-workspace-mutation']
  });

  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test('rejects selected TODO dependency rewrite even when prior dependency completed', () => {
  const result = validatePhaseLoopProgressIntegrity({
    claim: { claim_id: 'claim-2', selected_todo: e20b },
    todoBefore: queue(e20a, e20b),
    todoAfter: queue(e20b.replace('Depends on: E-20a-golden-journey-workspace-mutation.', 'Depends on: <none>.')),
    diffFiles: [
      '.brownie/todo.md',
      'scripts/release-runtime-operational-evidence.mjs'
    ],
    completionRecordExists: false,
    completedTodoIds: ['E-20a-golden-journey-workspace-mutation']
  });

  assert.equal(result.valid, false);
  assert(!result.errors.some((error) => error.code === 'unselected_todo_removed'));
  assert(result.errors.some((error) => error.code === 'selected_todo_contract_drift'));
});

test('rejects removing a TODO that is not the active claim', () => {
  const result = validatePhaseLoopProgressIntegrity({
    claim: { claim_id: 'claim-1', selected_todo: e20g },
    todoBefore: queue(e20a, e20g),
    todoAfter: queue(e20g.replace('Depends on: E-20f-release-generation-sync.', 'Depends on: <none>.')),
    diffFiles: [
      '.brownie/todo.md',
      'scripts/release-runtime-operational-evidence.mjs'
    ],
    completionRecordExists: false
  });

  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.code === 'unselected_todo_removed'));
  assert(result.errors.some((error) => error.code === 'selected_target_not_changed'));
});

test('rejects protected contract drift on selected TODO before completion', () => {
  const result = validatePhaseLoopProgressIntegrity({
    claim: { claim_id: 'claim-1', selected_todo: e20g },
    todoBefore: queue(e20g),
    todoAfter: queue(e20g.replace('Depends on: E-20f-release-generation-sync.', 'Depends on: <none>.')),
    diffFiles: [
      '.brownie/todo.md',
      'docs/architecture/final-product-ready-judgment.json'
    ],
    completionRecordExists: false
  });

  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.code === 'selected_todo_contract_drift'));
});

test('rejects workspace changes that do not touch selected bounded targets', () => {
  const result = validatePhaseLoopProgressIntegrity({
    claim: { claim_id: 'claim-1', selected_todo: e20g },
    todoBefore: queue(e20g),
    todoAfter: queue(e20g),
    diffFiles: [
      'scripts/release-runtime-operational-evidence.mjs',
      'scripts/release-supply-chain-artifact-evidence.mjs'
    ],
    completionRecordExists: false
  });

  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.code === 'selected_target_not_changed'));
});

test('uses claim delta so prior dirty files do not count as selected TODO progress', () => {
  const priorDirtyFiles = [
    '.brownie/release-evidence/runtime-operational-evidence.json',
    'scripts/release-runtime-operational-evidence.mjs'
  ];
  const result = validatePhaseLoopProgressIntegrity({
    claim: {
      claim_id: 'claim-1',
      selected_todo: e20g,
      baseline_diff_files: priorDirtyFiles
    },
    todoBefore: queue(e20g),
    todoAfter: queue(e20g),
    diffFiles: [
      ...priorDirtyFiles,
      'scripts/release-supply-chain-artifact-evidence.mjs'
    ],
    completionRecordExists: false
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.claim_changed_files, ['scripts/release-supply-chain-artifact-evidence.mjs']);
  assert(result.errors.some((error) => error.code === 'selected_target_not_changed'));
});

test('does not treat pre-existing dirty files as selected_target_not_changed for a no-change retry', () => {
  const priorDirtyFiles = [
    '.brownie/release-evidence/runtime-operational-evidence.json',
    'scripts/release-runtime-operational-evidence.mjs'
  ];
  const result = validatePhaseLoopProgressIntegrity({
    claim: {
      claim_id: 'claim-1',
      selected_todo: e20g,
      baseline_diff_files: priorDirtyFiles
    },
    todoBefore: queue(e20g),
    todoAfter: queue(e20g),
    diffFiles: priorDirtyFiles,
    completionRecordExists: false
  });

  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.claim_changed_files, []);
});

test('CLI write-record allows selected targets that were already dirty at claim baseline', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-progress-integrity-baseline-dirty-'));
  fs.mkdirSync(path.join(tmp, '.brownie/private/phase-loop/todo-claims'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'docs/architecture'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.brownie/todo.md'), queue(e20gLeaf));
  fs.writeFileSync(path.join(tmp, 'docs/architecture/final-product-ready-judgment.md'), 'blocker: old\n');
  execFileSync('git', ['init', '-b', 'main'], { cwd: tmp, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: tmp, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=Brownie', '-c', 'user.email=brownie@example.invalid', 'commit', '-m', 'baseline'], { cwd: tmp, stdio: 'ignore' });
  fs.writeFileSync(path.join(tmp, 'docs/architecture/final-product-ready-judgment.md'), 'blocker: E-20\n');
  fs.writeFileSync(
    path.join(tmp, '.brownie/private/phase-loop/todo-claims/current.json'),
    `${JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-baseline-dirty',
      selected_todo: e20gLeaf,
      baseline_diff_files: ['docs/architecture/final-product-ready-judgment.md'],
      baseline_todo_text: queue(e20gLeaf)
    }, null, 2)}\n`
  );

  const output = execFileSync('node', [
    path.resolve('scripts/phase-loop-progress-integrity.mjs'),
    '--repo', tmp,
    '--claim', '.brownie/private/phase-loop/todo-claims/current.json',
    '--todo', '.brownie/todo.md',
    '--run-stamp', 'test-run',
    '--write-record'
  ], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const result = JSON.parse(output);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.selected_target_changed, false);
  assert.equal(result.selected_target_dirty_at_baseline, true);
  assert.deepEqual(result.selected_targets_dirty_at_baseline, ['docs/architecture/final-product-ready-judgment.md']);
  assert.equal(result.completion_record_present, true);
});

test('CLI write-record counts untracked Create only target as selected progress', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-progress-integrity-untracked-create-'));
  const createOnlyTodo = `- [ ] E-test-create-workflow: Create only \`.github/workflows/release.yml\` to add a release workflow.
  Route: implementation.
  Depends on: <none>.
  Completion condition: workflow exists.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root guard:supply-chain-artifact-evidence\`.`;
  fs.mkdirSync(path.join(tmp, '.brownie/private/phase-loop/todo-claims'), { recursive: true });
  fs.mkdirSync(path.join(tmp, '.brownie/private/phase-loop/todo-completions'), { recursive: true });
  fs.mkdirSync(path.join(tmp, '.brownie'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.brownie/todo.md'), queue(createOnlyTodo));
  execFileSync('git', ['init', '-b', 'main'], { cwd: tmp, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: tmp, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=Brownie', '-c', 'user.email=brownie@example.invalid', 'commit', '-m', 'baseline'], { cwd: tmp, stdio: 'ignore' });
  fs.mkdirSync(path.join(tmp, '.github/workflows'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.github/workflows/release.yml'), 'name: Release\n');
  fs.writeFileSync(
    path.join(tmp, '.brownie/private/phase-loop/todo-claims/current.json'),
    `${JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-create-only',
      selected_todo: createOnlyTodo,
      baseline_diff_files: [],
      baseline_todo_text: queue(createOnlyTodo)
    }, null, 2)}\n`
  );

  const output = execFileSync('node', [
    path.resolve('scripts/phase-loop-progress-integrity.mjs'),
    '--repo', tmp,
    '--claim', '.brownie/private/phase-loop/todo-claims/current.json',
    '--todo', '.brownie/todo.md',
    '--run-stamp', 'test-run',
    '--write-record'
  ], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const result = JSON.parse(output);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.selected_target_changed, true);
  assert.deepEqual(result.selected_targets_changed, ['.github/workflows/release.yml']);
  assert.equal(result.completion_record_present, true);
});

test('CLI write-record does not count pre-existing untracked Create only target as selected progress', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-progress-integrity-untracked-create-baseline-'));
  const createOnlyTodo = `- [ ] E-test-create-workflow: Create only \`.github/workflows/release.yml\` to add a release workflow.
  Route: implementation.
  Depends on: <none>.
  Completion condition: workflow exists.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root guard:supply-chain-artifact-evidence\`.`;
  fs.mkdirSync(path.join(tmp, '.brownie/private/phase-loop/todo-claims'), { recursive: true });
  fs.mkdirSync(path.join(tmp, '.brownie/private/phase-loop/todo-completions'), { recursive: true });
  fs.mkdirSync(path.join(tmp, '.brownie'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.brownie/todo.md'), queue(createOnlyTodo));
  execFileSync('git', ['init', '-b', 'main'], { cwd: tmp, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: tmp, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=Brownie', '-c', 'user.email=brownie@example.invalid', 'commit', '-m', 'baseline'], { cwd: tmp, stdio: 'ignore' });
  fs.mkdirSync(path.join(tmp, '.github/workflows'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.github/workflows/release.yml'), 'name: Release\n');
  fs.writeFileSync(
    path.join(tmp, '.brownie/private/phase-loop/todo-claims/current.json'),
    `${JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-create-only',
      selected_todo: createOnlyTodo,
      baseline_diff_files: ['.github/workflows/release.yml'],
      baseline_todo_text: queue(createOnlyTodo)
    }, null, 2)}\n`
  );

  const output = execFileSync('node', [
    path.resolve('scripts/phase-loop-progress-integrity.mjs'),
    '--repo', tmp,
    '--claim', '.brownie/private/phase-loop/todo-claims/current.json',
    '--todo', '.brownie/todo.md',
    '--run-stamp', 'test-run',
    '--write-record'
  ], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const result = JSON.parse(output);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.selected_target_changed, false);
  assert.equal(result.selected_target_dirty_at_baseline, true);
  assert.deepEqual(result.selected_targets_dirty_at_baseline, ['.github/workflows/release.yml']);
  assert.equal(result.completion_record_present, true);
});

test('reports missing selected target files for multi-target TODOs', () => {
  const result = validatePhaseLoopProgressIntegrity({
    claim: { claim_id: 'claim-1', selected_todo: e20a },
    todoBefore: queue(e20a),
    todoAfter: queue(e20a),
    diffFiles: [
      'scripts/release-runtime-operational-evidence.mjs'
    ],
    completionRecordExists: false
  });

  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.selected_target_changed, true);
  assert.equal(result.selected_all_targets_changed, false);
  assert.deepEqual(result.missing_selected_scopes, ['scripts/guard-runtime-operational-evidence.test.mjs']);
});

test('CLI write-record refuses completion when not all selected target files changed', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-progress-integrity-'));
  fs.mkdirSync(path.join(tmp, '.brownie/private/phase-loop/todo-claims'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.brownie/todo.md'), queue(e20a));
  fs.writeFileSync(path.join(tmp, 'scripts/release-runtime-operational-evidence.mjs'), 'export const before = true;\n');
  fs.writeFileSync(path.join(tmp, 'scripts/guard-runtime-operational-evidence.test.mjs'), 'import test from "node:test";\n');
  execFileSync('git', ['init', '-b', 'main'], { cwd: tmp, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: tmp, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=Brownie', '-c', 'user.email=brownie@example.invalid', 'commit', '-m', 'baseline'], { cwd: tmp, stdio: 'ignore' });
  fs.writeFileSync(
    path.join(tmp, '.brownie/private/phase-loop/todo-claims/current.json'),
    `${JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-1',
      selected_todo: e20a,
      baseline_diff_files: [],
      baseline_todo_text: queue(e20a)
    }, null, 2)}\n`
  );
  fs.writeFileSync(path.join(tmp, 'scripts/release-runtime-operational-evidence.mjs'), 'export const after = true;\n');

  assert.throws(() => {
    execFileSync('node', [
      path.resolve('scripts/phase-loop-progress-integrity.mjs'),
      '--repo', tmp,
      '--claim', '.brownie/private/phase-loop/todo-claims/current.json',
      '--todo', '.brownie/todo.md',
      '--run-stamp', 'test-run',
      '--write-record'
    ], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  }, /completion_record_missing_selected_targets/);
});
