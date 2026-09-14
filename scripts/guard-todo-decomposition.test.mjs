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

test('rejects inspect-only verification for implementation leaves', () => {
  const inspectOnly = validLeaf.replace('Verification: run `pnpm --workspace-root guard:release-contract:test`.', 'Verification: inspect release evidence manually.');
  const errors = validateTodoDecompositionText(inspectOnly);

  assert(errors.some((error) => error.includes('implementation leaves need executable verification')), errors.join('\n'));
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
