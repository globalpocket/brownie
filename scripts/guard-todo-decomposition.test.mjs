import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextSchedulableTodoId, validateTodoDecompositionText } from './guard-todo-decomposition.mjs';

const validLeaf = `- [ ] E-15b-child: Patch only \`scripts/example.mjs\`:
  Route: implementation.
  Source TODO: E-15b: Decompose release evidence work.
  Depends on: <none>.
  Completion condition: the bounded patch is implemented and verified.
  Forbidden changes: do not edit unrelated release evidence files.
  Verification: run \`pnpm --workspace-root guard:release-contract:test\`.`;

test('accepts structured decomposition leaf TODO', () => {
  assert.deepEqual(validateTodoDecompositionText(validLeaf, {
    packageScripts: new Set(['guard:release-contract:test'])
  }), []);
});

test('unchecked TODO parsing stops at checked items before the next pending leaf', () => {
  const queue = `${validLeaf}

- [x] E-15b-done: Patch only \`scripts/done.mjs\`:
  Route: implementation.
  Source TODO: E-15b.
  Depends on: <none>.
  Completion condition: completed sibling remains historical context only.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root guard:release-contract:test\`.

- [ ] E-15b-next: Patch only \`scripts/next.mjs\`:
  Route: implementation.
  Source TODO: E-15b.
  Depends on: <none>.
  Completion condition: next pending leaf remains a separate unchecked block.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root guard:release-contract:test\`.`;

  assert.deepEqual(validateTodoDecompositionText(queue, {
    packageScripts: new Set(['guard:release-contract:test'])
  }), []);
});

test('scope parsing ignores descriptive backticks after the bounded path', () => {
  const descriptiveLeaf = `- [ ] E-15d-child: Patch only \`scripts/guard-todo-decomposition.mjs\` to ensure \`soakEvidenceFixture\` includes \`name\`, \`version\`, \`description\`, and \`fixture\`.
  Route: implementation.
  Source TODO: E-15d: Decompose release evidence work.
  Depends on: <none>.
  Completion condition: the bounded patch is implemented and verified.
  Forbidden changes: do not edit unrelated release evidence files.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition:test\`.`;

  assert.deepEqual(validateTodoDecompositionText(descriptiveLeaf, {
    repoRoot: process.cwd(),
    packageScripts: new Set(['guard:todo-decomposition:test'])
  }), []);
});

test('rejects decomposition leaf without required schema fields', () => {
  const errors = validateTodoDecompositionText(`- [ ] E-15b-child: Patch only \`scripts/example.mjs\`:
  Source TODO: E-15b: Decompose release evidence work.
  Verification: run \`pnpm --workspace-root check\`.`);

  assert(errors.some((error) => error.includes('missing Route:')), errors.join('\n'));
  assert(errors.some((error) => error.includes('missing Depends on:')), errors.join('\n'));
  assert(errors.some((error) => error.includes('missing Completion condition:')), errors.join('\n'));
  assert(errors.some((error) => error.includes('missing Forbidden changes:')), errors.join('\n'));
});

test('rejects child id that loses parent prefix', () => {
  const errors = validateTodoDecompositionText(validLeaf.replace('E-15b-child', 'E-16a-child'));

  assert(errors.some((error) => error.includes('must preserve parent prefix E-15b-')), errors.join('\n'));
});

test('rejects duplicate unchecked leaf ids', () => {
  const duplicate = `${validLeaf}
${validLeaf.replace('scripts/example.mjs', 'scripts/other-example.mjs')}`;
  const errors = validateTodoDecompositionText(duplicate, {
    packageScripts: new Set(['guard:release-contract:test'])
  });

  assert(errors.some((error) => error.includes('duplicate unchecked TODO id appears 2 times')), errors.join('\n'));
});

test('rejects leaf Source TODO that points at itself', () => {
  const selfSource = validLeaf.replace(
    'Source TODO: E-15b: Decompose release evidence work.',
    'Source TODO: E-15b-child: Patch only `scripts/example.mjs`.'
  );
  const errors = validateTodoDecompositionText(selfSource, {
    packageScripts: new Set(['guard:release-contract:test'])
  });

  assert(errors.some((error) => error.includes('Source TODO must reference the parent TODO')), errors.join('\n'));
});

test('rejects self Source TODO even with trailing punctuation', () => {
  const selfSource = validLeaf.replace(
    'Source TODO: E-15b: Decompose release evidence work.',
    'Source TODO: E-15b-child.'
  );
  const errors = validateTodoDecompositionText(selfSource, {
    packageScripts: new Set(['guard:release-contract:test'])
  });

  assert(errors.some((error) => error.includes('Source TODO must reference the parent TODO')), errors.join('\n'));
});

test('rejects broad decomposition item kept as leaf', () => {
  const errors = validateTodoDecompositionText(`- [ ] TODO-decompose-blocked-queue-abc: Decompose work:
  Route: todo-decomposition.
  Source TODO: TODO-decompose-blocked-queue-abc: Decompose work.
  Completion condition: split work.
  Forbidden changes: do not edit implementation files.
  Verification: run \`pnpm --workspace-root check\`.`);

  assert(errors.some((error) => error.includes('broad decomposition TODO must not remain')), errors.join('\n'));
});

test('rejects unallowlisted verification commands', () => {
  const errors = validateTodoDecompositionText(validLeaf.replace('pnpm --workspace-root guard:release-contract:test', 'curl https://example.invalid'));

  assert(errors.some((error) => error.includes('Verification must use bounded allowlisted commands')), errors.join('\n'));
});

test('rejects missing package scripts referenced by verification', () => {
  const errors = validateTodoDecompositionText(validLeaf, {
    packageScripts: new Set(['check'])
  });

  assert(errors.some((error) => error.includes('missing package script: guard:release-contract:test')), errors.join('\n'));
});

test('rejects TODO whose verification references a missing script created by a later TODO without dependency', () => {
  const text = `- [ ] E-19h-2a-audit-schema-ledger-kind: Patch only \`docs/architecture/runtime-release-readiness-audit.json\` to add LedgerEventKind enum section with all event type values:
  Route: todo-decomposition
  Source TODO: E-19h-2-audit-schema-trace-binding
  Depends on: <none>
  Completion condition: LedgerEventKind enum is present in the audit schema and can be validated by the bounded schema validator.
  Forbidden changes: do not modify implementation files, tests, or other schema sections.
  Verification: run \`node scripts/validate-audit-schema.mjs docs/architecture/runtime-release-readiness-audit.json\`.

- [ ] E-19h-3-schema-validation-script: Create only \`scripts/validate-audit-schema.mjs\` to implement JSON schema validator for runtime-release-readiness-audit.json:
  Route: todo-decomposition
  Source TODO: E-19h-1-release-contract-trace-schema
  Depends on: <none>
  Completion condition: validation script exists and validates LedgerEventKind enum, payload schema classification, and fingerprint fields.
  Forbidden changes: do not modify existing scripts or implementation files.
  Verification: run \`node scripts/validate-audit-schema.mjs docs/architecture/runtime-release-readiness-audit.json\`.`;

  const repoRoot = fs.mkdtempSync('brownie-todo-prereq-');
  try {
    fs.mkdirSync(`${repoRoot}/docs/architecture`, { recursive: true });
    fs.writeFileSync(`${repoRoot}/docs/architecture/runtime-release-readiness-audit.json`, '{}\n');
    const errors = validateTodoDecompositionText(text, {
      repoRoot,
      packageScripts: new Set()
    });
    assert(errors.some((error) => error.includes('references missing prerequisite scripts/validate-audit-schema.mjs')), errors.join('\n'));
    assert(errors.some((error) => error.includes('must depend on E-19h-3-schema-validation-script')), errors.join('\n'));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('rejects TODO whose verification references an invented node script with no creator', () => {
  const text = `- [ ] E-19h-01: Patch only \`docs/architecture/runtime-release-readiness-audit.json\` to add release contract trace binding schema:
  Route: todo-decomposition
  Source TODO: TODO-decompose-broad-todo-9430463ff3c2
  Depends on: <none>
  Completion condition: JSON schema for trace binding added with fingerprint field.
  Forbidden changes: do not modify existing evidence entries or historical fixtures.
  Verification: run \`node scripts/validate-json.js docs/architecture/runtime-release-readiness-audit.json\`.`;

  const repoRoot = fs.mkdtempSync('brownie-todo-invented-verifier-');
  try {
    fs.mkdirSync(`${repoRoot}/docs/architecture`, { recursive: true });
    fs.writeFileSync(`${repoRoot}/docs/architecture/runtime-release-readiness-audit.json`, '{}\n');
    const errors = validateTodoDecompositionText(text, {
      repoRoot,
      packageScripts: new Set()
    });
    assert(errors.some((error) => error.includes('references missing script scripts/validate-json.js')), errors.join('\n'));
    assert(errors.some((error) => error.includes('do not invent generic validators')), errors.join('\n'));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('accepts missing verification script when the TODO creates that script itself', () => {
  const text = `- [ ] E-19h-3-schema-validation-script: Create only \`scripts/validate-audit-schema.mjs\` to implement JSON schema validator for runtime-release-readiness-audit.json:
  Route: todo-decomposition
  Source TODO: E-19h-1-release-contract-trace-schema
  Depends on: <none>
  Completion condition: validation script exists and validates LedgerEventKind enum, payload schema classification, and fingerprint fields.
  Forbidden changes: do not modify existing scripts or implementation files.
  Verification: run \`node scripts/validate-audit-schema.mjs docs/architecture/runtime-release-readiness-audit.json\`.`;

  const repoRoot = fs.mkdtempSync('brownie-todo-prereq-');
  try {
    const errors = validateTodoDecompositionText(text, {
      repoRoot,
      packageScripts: new Set()
    });
    assert(!errors.some((error) => error.includes('references missing prerequisite scripts/validate-audit-schema.mjs')), errors.join('\n'));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('rejects oversized leaf blocks', () => {
  const largeLeaf = validLeaf.replace(
    'Completion condition: the bounded patch is implemented and verified.',
    `Completion condition: ${'bounded '.repeat(260)}`
  );
  const errors = validateTodoDecompositionText(largeLeaf);

  assert(errors.some((error) => error.includes('leaf block is too large')), errors.join('\n'));
});

test('rejects patch targets that do not exist when repo root is provided', () => {
  const errors = validateTodoDecompositionText(validLeaf, {
    repoRoot: process.cwd()
  });

  assert(errors.some((error) => error.includes('Patch only target does not exist: scripts/example.mjs')), errors.join('\n'));
});

test('accepts create-only targets that do not exist', () => {
  const createLeaf = validLeaf.replace('Patch only `scripts/example.mjs`', 'Create only `scripts/example.mjs`');

  assert.deepEqual(validateTodoDecompositionText(createLeaf, {
    repoRoot: process.cwd(),
    packageScripts: new Set(['guard:release-contract:test'])
  }), []);
});

test('requires decomposition ledger when validating repo text with breakdown text option', () => {
  const errors = validateTodoDecompositionText(validLeaf, {
    breakdownText: null
  });

  assert(errors.some((error) => error.includes('missing TODO decomposition ledger')), errors.join('\n'));
});

test('requires all derived leaf ids in decomposition ledger', () => {
  const errors = validateTodoDecompositionText(validLeaf, {
    breakdownText: `# TODO breakdown\n\nParent TODO: E-15b\n\nDependency graph:\n- E-15b-other: <none>\n\nVerification ledger:\n- E-15b-other: pending\n`
  });

  assert(errors.some((error) => error.includes('missing derived leaf TODO id E-15b-child')), errors.join('\n'));
});

test('rejects dependency cycles among derived leaves', () => {
  const cyclic = `${validLeaf.replace('E-15b-child', 'E-15b-a').replace('Depends on: <none>.', 'Depends on: E-15b-b.')}
- [ ] E-15b-b: Patch only \`scripts/release-gate.mjs\`:
  Route: implementation.
  Source TODO: E-15b: Decompose release evidence work.
  Depends on: E-15b-a.
  Completion condition: the bounded release-gate patch is implemented and verified.
  Forbidden changes: do not edit unrelated release evidence files.
  Verification: run \`pnpm --workspace-root guard:release-contract:test\`.`;

  const errors = validateTodoDecompositionText(cyclic, {
    packageScripts: new Set(['guard:release-contract:test'])
  });

  assert(errors.some((error) => error.includes('dependencies must not contain cycles')), errors.join('\n'));
});

test('rejects dependencies that exist only as abstract breakdown ledger IDs', () => {
  const abstractDependency = validLeaf.replace('Depends on: <none>.', 'Depends on: E-15b-abstract-parent.');
  const errors = validateTodoDecompositionText(abstractDependency, {
    breakdownText: `# TODO breakdown\n\nParent TODO: E-15b\n\nDependency graph:\n- E-15b-abstract-parent: none\n- E-15b-child: E-15b-abstract-parent\n\nVerification ledger:\n- E-15b-child: pending\n`,
    packageScripts: new Set(['guard:release-contract:test'])
  });

  assert(errors.some((error) => error.includes('present only in the breakdown ledger')), errors.join('\n'));
  assert(errors.some((error) => error.includes('abstract/decomposed parent IDs')), errors.join('\n'));
});

test('requires validate-audit-schema leaves to verify actual target shape', () => {
  const validatorLeaf = `- [ ] E-19h-3-schema-validation-script: Patch only \`scripts/validate-audit-schema.mjs\` to implement JSON schema validator for runtime-release-readiness-audit.json:
  Route: todo-decomposition
  Source TODO: E-19h-1-release-contract-trace-schema
  Depends on: <none>.
  Completion condition: validation script created with LedgerEventKind enum check, payload schema classification validation, and fingerprint field verification.
  Forbidden changes: do not modify existing scripts or implementation files.
  Verification: run \`node scripts/validate-audit-schema.mjs docs/architecture/runtime-release-readiness-audit.json\`.`;
  const errors = validateTodoDecompositionText(validatorLeaf, {
    repoRoot: process.cwd(),
    packageScripts: new Set(['guard:validator-schema-assumptions'])
  });

  assert(errors.some((error) => error.includes('guard:validator-schema-assumptions')), errors.join('\n'));
  assert(errors.some((error) => error.includes('actual target schema/shape')), errors.join('\n'));
});

test('accepts validate-audit-schema leaves with actual-shape guard verification', () => {
  const validatorLeaf = `- [ ] E-19h-3-schema-validation-script: Patch only \`scripts/validate-audit-schema.mjs\` to implement JSON schema validator for runtime-release-readiness-audit.json:
  Route: todo-decomposition
  Source TODO: E-19h-1-release-contract-trace-schema
  Depends on: <none>.
  Completion condition: validation script reflects the actual target shape with LedgerEventKind enum check, payload schema classification validation, and fingerprint field verification.
  Forbidden changes: do not modify existing scripts or implementation files.
  Verification: run \`node scripts/validate-audit-schema.mjs docs/architecture/runtime-release-readiness-audit.json\` and \`pnpm --workspace-root guard:validator-schema-assumptions\`.`;
  assert.deepEqual(validateTodoDecompositionText(validatorLeaf, {
    repoRoot: process.cwd(),
    packageScripts: new Set(['guard:validator-schema-assumptions'])
  }), []);
});

test('rejects broad leaf completion conditions', () => {
  const broad = validLeaf.replace(
    'Completion condition: the bounded patch is implemented and verified.',
    'Completion condition: fix every problem and make the release ready immediately.'
  );
  const errors = validateTodoDecompositionText(broad, {
    packageScripts: new Set(['guard:release-contract:test'])
  });

  assert(errors.some((error) => error.includes('Completion condition is too broad')), errors.join('\n'));
});

test('rejects TODO contract contradictions between verification and forbidden sections', () => {
  const contradictory = `- [ ] E-16f-phase-final-judgment-sync-leaf-2-step1: Patch only \`docs/architecture/phase-value-manifest.json\` to update one owner review field.
  Route: documentation.
  Source TODO: E-16f-phase-final-judgment-sync-leaf-2.
  Depends on: <none>.
  Completion condition: one owner review field is updated with the current Product Ready blocker state.
  Forbidden changes: do not modify phase_value_gate or guard_engine_change_review sections.
  Verification: run \`pnpm --workspace-root guard:phase-value\`.`;
  const errors = validateTodoDecompositionText(contradictory, {
    packageScripts: new Set(['guard:phase-value'])
  });

  assert(errors.some((error) => error.includes('TODO contract contradiction')), errors.join('\n'));
  assert(errors.some((error) => error.includes('phase_value_gate')), errors.join('\n'));
  assert(errors.some((error) => error.includes('guard_engine_change_review')), errors.join('\n'));
});

test('rejects broad guard verification when leaf forbids all other fields', () => {
  const contradictory = `- [ ] E-16f-phase-final-judgment-sync-title-only: Patch only \`docs/architecture/phase-value-manifest.json\` to confirm title field value.
  Route: documentation.
  Source TODO: E-16f-phase-final-judgment-sync.
  Depends on: <none>.
  Completion condition: title field equals the current phase title.
  Forbidden changes: do not modify any other fields.
  Verification: run \`pnpm --workspace-root guard:phase-value\`.`;
  const errors = validateTodoDecompositionText(contradictory, {
    packageScripts: new Set(['guard:phase-value'])
  });

  assert(errors.some((error) => error.includes('TODO contract contradiction')), errors.join('\n'));
});

test('rejects generated leaf id chains that keep appending suffixes', () => {
  const chained = `- [ ] E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1: Patch only \`docs/architecture/phase-value-manifest.json\` to update one release judgment field.
  Route: documentation.
  Source TODO: E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2.
  Depends on: <none>.
  Completion condition: exactly one release judgment field is updated with the current fail-closed Product Ready blocker state.
  Forbidden changes: do not claim public Release Ready and do not edit unrelated files.
  Verification: run \`pnpm --workspace-root guard:phase-value\`.`;
  const errors = validateTodoDecompositionText(chained, {
    packageScripts: new Set(['guard:phase-value'])
  });

  assert(errors.some((error) => error.includes('generated leaf id chain is too long')), errors.join('\n'));
  assert(errors.some((error) => error.includes('Source TODO must reference the stable parent/root TODO')), errors.join('\n'));
});

test('rejects recursive stalled-leaf replanning for decomposition leaves', () => {
  const recursive = `- [ ] E-21c-replan-stalled-leaf-16dd69c42044: Patch only \`.brownie/todo.md\` to replace stalled TODO \`E-21c-todo-decomp-leaf-001\`.
  Route: todo-decomposition.
  Source TODO: E-21c-todo-decomp-leaf-001.
  Depends on: <none>.
  Completion condition: replace the generated TODO with another smaller generated TODO.
  Forbidden changes: do not implement release evidence.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
  const errors = validateTodoDecompositionText(recursive, {
    packageScripts: new Set(['guard:todo-decomposition'])
  });

  assert(errors.some((error) => error.includes('recursive stalled-leaf replanning is not allowed')), errors.join('\n'));
});

test('rejects stalled-leaf replan whose source TODO is already completed', () => {
  const text = `- [ ] E-21c-replan-stalled-leaf-475e76fa14b0: Patch only \`.brownie/todo.md\` to replan stalled Brownie TODO leaf into implementable child TODOs:
  Route: todo-decomposition.
  Source TODO: E-21c-runtime-operational-evidence-impl-3-target-01.
  Depends on: <none>.
  Completion condition: replace the stalled TODO with implementable child leaves.
  Forbidden changes: do not implement release evidence.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.

- [x] E-21c-runtime-operational-evidence-impl-3-target-01: Patch only \`scripts/release-runtime-operational-evidence.mjs\`.
  Route: implementation.
  Source TODO: E-21c-runtime-operational-evidence-impl-3.
  Depends on: <none>.
  Completion condition: completed.
  Forbidden changes: do not weaken guards.
  Verification: run \`pnpm --workspace-root guard:runtime-operational-evidence\`.

- [ ] E-21c-runtime-operational-evidence-impl-3-target-02: Patch only \`scripts/guard-runtime-operational-evidence.test.mjs\`.
  Route: implementation.
  Source TODO: E-21c-runtime-operational-evidence-impl-3.
  Depends on: <none>.
  Completion condition: continue implementation.
  Forbidden changes: do not weaken guards.
  Verification: run \`pnpm --workspace-root guard:runtime-operational-evidence\`.`;
  const errors = validateTodoDecompositionText(text, {
    packageScripts: new Set(['guard:todo-decomposition', 'guard:runtime-operational-evidence'])
  });

  assert(errors.some((error) => error.includes('stale stalled-leaf replan targets completed TODO')), errors.join('\n'));
});

test('rejects stalled-leaf replan whose source TODO is not live', () => {
  const text = `- [ ] E-21c-replan-stalled-leaf-475e76fa14b0: Patch only \`.brownie/todo.md\` to replan stalled Brownie TODO leaf into implementable child TODOs:
  Route: todo-decomposition.
  Source TODO: E-21c-runtime-operational-evidence-impl-3-target-01.
  Depends on: <none>.
  Completion condition: replace the stalled TODO with implementable child leaves.
  Forbidden changes: do not implement release evidence.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.

- [ ] E-21c-runtime-operational-evidence-impl-3-target-02: Patch only \`scripts/guard-runtime-operational-evidence.test.mjs\`.
  Route: implementation.
  Source TODO: E-21c-runtime-operational-evidence-impl-3.
  Depends on: <none>.
  Completion condition: continue implementation.
  Forbidden changes: do not weaken guards.
  Verification: run \`pnpm --workspace-root guard:runtime-operational-evidence\`.`;
  const errors = validateTodoDecompositionText(text, {
    packageScripts: new Set(['guard:todo-decomposition', 'guard:runtime-operational-evidence'])
  });

  assert(errors.some((error) => error.includes('stale stalled-leaf replan targets non-live TODO')), errors.join('\n'));
});

test('rejects duplicate sibling leaves after normalizing generated suffixes', () => {
  const duplicated = `- [ ] E-16f-phase-value-gate-contract-sync-leaf-2: Patch only \`docs/architecture/phase-value-manifest.json\` to add the \`phase_value_gate\` field.
  Route: documentation.
  Source TODO: E-16f-phase-value-gate-contract-sync.
  Depends on: <none>.
  Completion condition: phase_value_gate field is present and describes the current fail-closed Runtime evidence state.
  Forbidden changes: do not claim public Release Ready and do not edit unrelated files.
  Verification: run \`pnpm --workspace-root guard:phase-value\`.

- [ ] E-16f-phase-value-gate-contract-sync-leaf-3: Patch only \`docs/architecture/phase-value-manifest.json\` to add the \`phase_value_gate\` field.
  Route: documentation.
  Source TODO: E-16f-phase-value-gate-contract-sync-leaf-2.
  Depends on: <none>.
  Completion condition: phase_value_gate field is present and describes the current fail-closed Runtime evidence state.
  Forbidden changes: do not claim public Release Ready and do not edit unrelated files.
  Verification: run \`pnpm --workspace-root guard:phase-value\`.`;
  const errors = validateTodoDecompositionText(duplicated, {
    packageScripts: new Set(['guard:phase-value'])
  });

  assert(errors.some((error) => error.includes('duplicate sibling leaf')), errors.join('\n'));
  assert(errors.some((error) => error.includes('stable parent/root TODO')), errors.join('\n'));
});

test('rejects inspect-only verification for implementation leaves', () => {
  const inspectOnly = validLeaf.replace('Verification: run `pnpm --workspace-root guard:release-contract:test`.', 'Verification: inspect release evidence manually.');
  const errors = validateTodoDecompositionText(inspectOnly);

  assert(errors.some((error) => error.includes('implementation leaves need executable verification')), errors.join('\n'));
});

test('rejects analysis-only derived decomposition leaves', () => {
  const analysisOnly = `- [ ] E-19d-02-soak-read-entry: Blocker: Read \`.brownie/todo.md\` for \`E-19d-stateful-soak-required-steps\` entry.
  Route: todo-decomposition.
  Source TODO: E-19d-01-read-soak-source.
  Depends on: <none>.
  Completion condition: Entry text extracted with file path, symbols, and verification requirements.
  Forbidden changes: No implementation files, no queue edits beyond this leaf.
  Verification: inspect \`.brownie/todo.md\` for \`E-19d-stateful-soak-required-steps\`.`;
  const errors = validateTodoDecompositionText(analysisOnly);

  assert(errors.some((error) => error.includes('analysis-only derived leaves are not executable TODOs')), errors.join('\n'));
  assert(errors.some((error) => error.includes('read-only decomposition leaves cause no-progress loops')), errors.join('\n'));
});

test('rejects empty TODO when Product Ready is false and release blockers remain', () => {
  const errors = validateTodoDecompositionText('', {
    productReady: false,
    releaseBlockersRemaining: true
  });

  assert(errors.some((error) => error.includes('Empty or non-executable TODO queue')), errors.join('\n'));
});

test('rejects checked-only TODO when Product Ready is false and release blockers remain', () => {
  const errors = validateTodoDecompositionText('- [x] E-18a: already done.\n', {
    productReady: false,
    releaseBlockersRemaining: true
  });

  assert(errors.some((error) => error.includes('Empty or non-executable TODO queue')), errors.join('\n'));
});

test('accepts implementation TODO when Product Ready is false and release blockers remain', () => {
  const errors = validateTodoDecompositionText(validLeaf, {
    productReady: false,
    releaseBlockersRemaining: true,
    packageScripts: new Set(['guard:release-contract:test'])
  });

  assert.deepEqual(errors, []);
});

test('rejects directory Patch only targets because Brownie cannot implement a concrete file leaf', () => {
  const errors = validateTodoDecompositionText(`- [ ] E-21a-dir-leaf: Patch only \`scripts/\` to close a broad scripts slice:
  Route: implementation.
  Source TODO: E-21a-clean-release-workspace-contract.
  Depends on: <none>.
  Completion condition: the bounded scripts slice is implemented and verified.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`, {
    repoRoot: process.cwd(),
    packageScripts: new Set(['guard:todo-decomposition'])
  });

  assert(errors.some((error) => error.includes('must be a concrete file, not a directory: scripts/')), errors.join('\n'));
});

test('selects first schedulable TODO after dependency blockers', () => {
  const text = `- [ ] E-15b-child: Patch only \`scripts/example.mjs\`:
  Route: implementation.
  Source TODO: E-15b: Decompose release evidence work.
  Depends on: E-15b-parent.
  Completion condition: the bounded patch is implemented and verified.
  Forbidden changes: do not edit unrelated release evidence files.
  Verification: run \`pnpm --workspace-root guard:release-contract:test\`.
- [ ] E-15b-parent: Patch only \`scripts/release-gate.mjs\`:
  Route: implementation.
  Source TODO: E-15b: Decompose release evidence work.
  Depends on: <none>.
  Completion condition: the bounded release-gate patch is implemented and verified.
  Forbidden changes: do not edit unrelated release evidence files.
  Verification: run \`pnpm --workspace-root guard:release-contract:test\`.`;

  assert.equal(nextSchedulableTodoId(text), 'E-15b-parent');
});

test('accepts explicit blocker route and skips it for schedulable implementation work', () => {
  const text = `- [ ] E-20i-release-ops-blocker: Blocker: External release engineering ownership required for CI/CD pipeline configuration and production deployment credentials.
  Route: blocker.
  Source TODO: TODO-decompose-release-ops-blockers.
  Depends on: <none>.
  Completion condition: Release engineering team provides CI/CD pipeline access and deployment credentials or documents owner-controlled requirements.
  Forbidden changes: do not attempt to configure external CI/CD or create deployment credentials.
  Verification: inspect/blocker/fail-closed until release engineering team provides evidence of pipeline access or documented requirements.
- [ ] E-20h-release-evidence-script: Patch only \`scripts/release-gate.mjs\` to add deterministic release evidence checks:
  Route: implementation.
  Source TODO: TODO-decompose-release-ops-blockers.
  Depends on: <none>.
  Completion condition: release-gate.mjs validates release evidence state with deterministic fail-closed behavior.
  Forbidden changes: do not modify phase-loop.sh or external controller files.
  Verification: run \`pnpm --workspace-root guard:release-gate\`.`;

  assert.deepEqual(validateTodoDecompositionText(text, {
    packageScripts: new Set(['guard:release-gate']),
    breakdownText: `Parent TODO: TODO-decompose-release-ops-blockers
Dependency graph:
- E-20i-release-ops-blocker: <none>
- E-20h-release-evidence-script: <none>
Verification ledger:
- E-20i-release-ops-blocker: inspect/blocker/fail-closed
- E-20h-release-evidence-script: \`pnpm --workspace-root guard:release-gate\`
Quality rubric:
- E-20i-release-ops-blocker: explicit external blocker not runnable by the worker.
- E-20h-release-evidence-script: bounded implementation leaf.`
  }), []);
  assert.equal(nextSchedulableTodoId(text), 'E-20h-release-evidence-script');
});

test('adversarial decomposition fixtures fail for the expected reason', () => {
  const fixture = JSON.parse(fs.readFileSync('scripts/fixtures/todo-decomposition-adversarial.json', 'utf8'));
  for (const entry of fixture.cases) {
    const errors = validateTodoDecompositionText(entry.todo, {
      packageScripts: new Set(['guard:release-contract:test'])
    });
    assert(
      errors.some((error) => error.includes(entry.should_fail_with)),
      `${entry.id} expected ${entry.should_fail_with}\n${errors.join('\n')}`
    );
  }
});
