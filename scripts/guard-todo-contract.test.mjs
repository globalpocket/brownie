import test from 'node:test';
import assert from 'node:assert/strict';

import { todoContractForBlock, validateTodoContracts } from './guard-todo-contract.mjs';

const phaseValueContradiction = `- [ ] E-16f-phase-final-judgment-sync-leaf-2-step1: Patch only \`docs/architecture/phase-value-manifest.json\` to update one owner review field.
  Route: documentation.
  Source TODO: E-16f-phase-final-judgment-sync-leaf-2.
  Depends on: <none>.
  Completion condition: one owner review field updated with current state.
  Forbidden changes: do not modify phase_value_gate or guard_engine_change_review sections.
  Verification: run \`pnpm --workspace-root guard:phase-value\`.`;

test('projects TODO block into a contract', () => {
  const contract = todoContractForBlock(phaseValueContradiction);

  assert.equal(contract.id, 'E-16f-phase-final-judgment-sync-leaf-2-step1');
  assert.deepEqual(contract.target_paths, ['docs/architecture/phase-value-manifest.json']);
  assert.deepEqual(contract.verification_commands, ['pnpm --workspace-root guard:phase-value']);
  assert(contract.required_sections.includes('phase_value_gate'));
  assert(contract.required_sections.includes('guard_engine_change_review'));
  assert(contract.forbidden_sections.includes('phase_value_gate'));
  assert(contract.forbidden_sections.includes('guard_engine_change_review'));
});

test('rejects verification and forbidden section contradictions before Brownie execution', () => {
  const { errors } = validateTodoContracts(phaseValueContradiction);

  assert(errors.some((error) => error.includes('requires section phase_value_gate')), errors.join('\n'));
  assert(errors.some((error) => error.includes('requires section guard_engine_change_review')), errors.join('\n'));
});

test('accepts phase-value TODO when forbidden sections do not conflict with required sections', () => {
  const valid = phaseValueContradiction.replace(
    'Forbidden changes: do not modify phase_value_gate or guard_engine_change_review sections.',
    'Forbidden changes: do not claim public Release Ready or edit unrelated runtime evidence files.'
  );
  const { errors } = validateTodoContracts(valid);

  assert.deepEqual(errors, []);
});

test('does not reject unrelated guards without known section requirements', () => {
  const unrelated = `- [ ] E-16x-example: Patch only \`scripts/example.mjs\`.
  Route: implementation.
  Source TODO: E-16x.
  Depends on: <none>.
  Completion condition: bounded script update is complete.
  Forbidden changes: do not modify phase_value_gate.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
  const { errors } = validateTodoContracts(unrelated);

  assert.deepEqual(errors, []);
});

test('treats any-other-fields as conflicting with broad guard requirements', () => {
  const titleOnly = phaseValueContradiction.replace(
    'Forbidden changes: do not modify phase_value_gate or guard_engine_change_review sections.',
    'Forbidden changes: do not modify any other fields.'
  );
  const { errors } = validateTodoContracts(titleOnly);

  assert(errors.some((error) => error.includes('requires section phase_value_gate')), errors.join('\n'));
  assert(errors.some((error) => error.includes('requires section guard_engine_change_review')), errors.join('\n'));
});
