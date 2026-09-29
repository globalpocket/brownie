import assert from 'node:assert/strict';
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

test('allows selected removal and dependent TODO dependency rewrite after completion record', () => {
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

  assert.equal(result.valid, true, JSON.stringify(result.errors));
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
