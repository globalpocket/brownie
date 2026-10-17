import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateTodoDecompositionText } from './guard-todo-decomposition.mjs';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function makeTempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-repair-todo-decomposition-'));
  fs.mkdirSync(path.join(root, '.brownie/private/phase-loop/todo-claims'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs/architecture'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    scripts: {
      'guard:release-contract': 'node scripts/guard-release-contract.mjs',
      'guard:release-contract:test': 'node --test scripts/guard-release-contract.test.mjs',
      'guard:runtime-release-readiness': 'node scripts/guard-runtime-release-readiness.mjs',
      'guard:phase-value': 'node scripts/guard-phase-value.mjs',
      'guard:release-evidence-semantic-consistency': 'node scripts/guard-release-evidence-semantic-consistency.mjs',
      'guard:release-evidence-semantic-consistency:test': 'node --test scripts/guard-release-evidence-semantic-consistency.test.mjs',
      'guard:runtime-operational-evidence': 'node scripts/guard-runtime-operational-evidence.mjs',
      'guard:runtime-operational-evidence:test': 'node --test scripts/guard-runtime-operational-evidence.test.mjs',
      'guard:supply-chain-artifact-evidence': 'node scripts/guard-supply-chain-artifact-evidence.mjs',
      'guard:supply-chain-artifact-evidence:test': 'node --test scripts/guard-supply-chain-artifact-evidence.test.mjs',
      'guard:owner-governance-evidence': 'node scripts/guard-owner-governance-evidence.mjs',
      'guard:owner-governance-evidence:test': 'node --test scripts/guard-owner-governance-evidence.test.mjs',
      'release:runtime-operational-evidence:test': 'node --test scripts/guard-runtime-operational-evidence.test.mjs',
      'release:owner-governance-evidence:test': 'node --test scripts/release-owner-governance-evidence.test.mjs',
      'guard:todo-decomposition': 'node scripts/guard-todo-decomposition.mjs'
    }
  }, null, 2));
  for (const file of [
    'docs/architecture/runtime-release-contract.json',
    'docs/architecture/runtime-release-readiness-audit.json',
    'docs/architecture/phase-value-manifest.json',
    'docs/architecture/final-product-ready-judgment.md',
    'scripts/guard-release-contract.test.mjs',
    'scripts/guard-release-contract.mjs',
    'scripts/guard-release-evidence-semantic-consistency.mjs',
    'scripts/guard-release-evidence-semantic-consistency.test.mjs',
    'scripts/release-runtime-operational-evidence.mjs',
    'scripts/guard-runtime-operational-evidence.mjs',
    'scripts/guard-runtime-operational-evidence.test.mjs',
    'scripts/release-supply-chain-artifact-evidence.mjs',
    'scripts/guard-supply-chain-artifact-evidence.mjs',
    'scripts/guard-supply-chain-artifact-evidence.test.mjs',
    'scripts/release-owner-governance-evidence.mjs',
    'scripts/release-owner-governance-evidence.test.mjs',
    'scripts/guard-owner-governance-evidence.mjs',
    'scripts/guard-owner-governance-evidence.test.mjs',
    'scripts/guard-runtime-release-readiness.mjs',
    'scripts/guard-phase-value.mjs'
  ]) {
    fs.writeFileSync(path.join(root, file), file.endsWith('.json') ? '{}\n' : '// fixture\n');
  }
  fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
    '# TODO breakdown',
    '',
    'Dependency graph:',
    '',
    'Verification ledger:',
    '',
    'Quality rubric:',
    '',
    'History:',
    ''
  ].join('\n'));
  return root;
}

function runRepair(root) {
  return spawnSync(process.execPath, [
    'scripts/repair-todo-decomposition.mjs',
    '--claim',
    path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'),
    '--todo',
    '.brownie/todo.md',
    '--breakdown',
    '.brownie/todo-breakdown.md',
    '--run-stamp',
    'test-run'
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      BROWNIE_REPAIR_TODO_REPO_ROOT: root
    },
    encoding: 'utf8'
  });
}

test('rebaselines sibling leaves when verification dependencies form a cycle and Create-only targets already exist', () => {
  const root = makeTempRepo();
  try {
    fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
    fs.mkdirSync(path.join(root, '.brownie/private/phase-loop/todo-completions'), { recursive: true });
    fs.writeFileSync(path.join(root, '.github/workflows/release.yml'), 'name: fixture\n');
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-completions/e23a.json'), JSON.stringify({
      selected_todo_id: 'E-23a-release-artifact-portable-archive'
    }));
    const sourceId = 'E-23b-release-artifact-download-roundtrip';
    const leaf = (suffix, target, dependencies, verificationTarget = 'scripts/release-artifact-roundtrip-e2e.test.mjs') => `- [ ] ${sourceId}-target-${suffix}: Create only \`${target}\` for the downloaded release-artifact roundtrip:
  Route: implementation.
  Source TODO: ${sourceId}.
  Depends on: ${dependencies.length > 0 ? dependencies.join(', ') : '<none>'}.
  Completion condition: Create only \`${target}\` with a bounded downloaded-artifact verification path.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`node --test ${verificationTarget}\`.`;
    const target01 = `${sourceId}-target-01`;
    const target02 = `${sourceId}-target-02`;
    const target03 = `${sourceId}-target-03`;
    const target04 = `${sourceId}-target-04`;
    const target05 = `${sourceId}-target-05`;
    const target06 = `${sourceId}-target-06`;
    const target07 = `${sourceId}-target-07`;
    const todoText = [
      '# Brownie TODO Queue',
      '',
      `- [x] ${sourceId}: Parent release artifact roundtrip.`,
      '',
      leaf('01', 'scripts/release-artifact-roundtrip-e2e.mjs', ['E-23a-release-artifact-portable-archive', target02]),
      '',
      leaf('02', 'scripts/release-artifact-roundtrip-e2e.test.mjs', [target01]),
      '',
      leaf('03', 'package.json', [target02]),
      '',
      leaf('04', '.github/workflows/release.yml', [target03, target02]),
      '',
      leaf('05', 'scripts/release-artifact-support.test.mjs', [target02]),
      '',
      leaf('06', 'scripts/release-artifact-support.mjs', [target05], 'scripts/release-artifact-support.test.mjs'),
      '',
      `- [ ] ${target07}: Create only \`scripts/release-artifact-extra.mjs\` and \`package.json\` for a mixed-scope fixture:
  Route: implementation.
  Source TODO: ${sourceId}.
  Depends on: ${target02}.
  Completion condition: keep each target classified by whether it already exists.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`node --test scripts/release-artifact-roundtrip-e2e.test.mjs\`.`,
      ''
    ].join('\n');
    const breakdownText = [
      '# TODO breakdown',
      '',
      `## ${sourceId} split`,
      '',
      `Parent TODO: ${sourceId}: Parent release artifact roundtrip.`,
      'Dependency graph:',
      `- ${target01}: E-23a-release-artifact-portable-archive, ${target02}`,
      `- ${target02}: ${target01}`,
      `- ${target03}: ${target02}`,
      `- ${target04}: ${target03}, ${target02}`,
      `- ${target05}: ${target02}`,
      `- ${target06}: ${target05}`,
      `- ${target07}: ${target02}`,
      '',
      'Verification ledger:',
      `- ${target01}: \`node --test scripts/release-artifact-roundtrip-e2e.test.mjs\``,
      `- ${target02}: \`node --test scripts/release-artifact-roundtrip-e2e.test.mjs\``,
      `- ${target03}: \`node --test scripts/release-artifact-roundtrip-e2e.test.mjs\``,
      `- ${target04}: \`node --test scripts/release-artifact-roundtrip-e2e.test.mjs\``,
      `- ${target05}: \`node --test scripts/release-artifact-roundtrip-e2e.test.mjs\``,
      `- ${target06}: \`node --test scripts/release-artifact-support.test.mjs\``,
      `- ${target07}: \`node --test scripts/release-artifact-roundtrip-e2e.test.mjs\``,
      '',
      'Quality rubric:',
      '- Each leaf has one concrete target and an executable verification command.',
      '',
      'History:',
      '- fixture',
      ''
    ].join('\n');
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), todoText);
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), breakdownText);
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-e23b-cycle',
      selected_todo: leaf('01', 'scripts/release-artifact-roundtrip-e2e.mjs', ['E-23a-release-artifact-portable-archive', target02])
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const repairedTodo = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const repairedBreakdown = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    assert.match(repairedTodo, new RegExp(`${target01}[\\s\\S]*?Depends on: E-23a-release-artifact-portable-archive, ${target02}\\.`));
    assert.match(repairedTodo, new RegExp(`${target02}[\\s\\S]*?Depends on: <none>\\.`));
    assert.match(repairedTodo, new RegExp(target03 + ': Patch only `package\\.json`'));
    assert.match(repairedTodo, new RegExp(target04 + ': Patch only `\\.github/workflows/release\\.yml`'));
    assert.match(repairedTodo, new RegExp(`${target05}[\\s\\S]*?Depends on: ${target02}\\.`));
    assert.match(repairedTodo, new RegExp(target07 + ': Patch only `package\\.json` and Create only `scripts/release-artifact-extra\\.mjs`'));
    assert.match(repairedBreakdown, new RegExp(`- ${target02}: <none>`));

    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'scripts/release-artifact-extra.mjs'), '// fixture\n');
    const repeated = runRepair(root);
    assert.equal(repeated.status, 0, `${repeated.stdout}\n${repeated.stderr}`);
    const rerunTodo = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    assert.match(rerunTodo, new RegExp(target07 + ': Patch only `package\\.json` and `scripts/release-artifact-extra\\.mjs`'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('normalizes an existing Create-only target when it is the final unchecked source leaf', () => {
  const root = makeTempRepo();
  try {
    const sourceId = 'E-23z-single-existing-target';
    const leafId = `${sourceId}-target-01`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), [
      '# Brownie TODO Queue',
      '',
      `- [x] ${sourceId}: Parent fixture.`,
      '',
      `- [ ] ${leafId}: Create only \`package.json\` for the final unchecked source leaf:`,
      '  Route: implementation.',
      `  Source TODO: ${sourceId}.`,
      '  Depends on: <none>.',
      '  Completion condition: classify the existing target correctly.',
      '  Forbidden changes: do not edit unrelated files.',
      '  Verification: run `pnpm --workspace-root guard:todo-decomposition`.',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      `## ${sourceId} split`,
      '',
      `Parent TODO: ${sourceId}: Parent fixture.`,
      'Dependency graph:',
      `- ${leafId}: <none>`,
      '',
      'Verification ledger:',
      `- ${leafId}: \`pnpm --workspace-root guard:todo-decomposition\``,
      '',
      'Quality rubric:',
      '- The final leaf has a concrete target.',
      '',
      'History:',
      '- fixture',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-single-existing-target',
      selected_todo: `- [ ] ${leafId}: Create only \`package.json\` for the final unchecked source leaf:`
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8'), new RegExp(leafId + ': Patch only `package\\.json`'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('does not accept a sibling dependency backed only by an invalidated completion receipt', () => {
  const root = makeTempRepo();
  try {
    const sourceId = 'E-23z-invalidated-completion';
    const leafId = `${sourceId}-target-01`;
    const removedId = 'E-23z-superseded-parent';
    fs.mkdirSync(path.join(root, '.brownie/private/phase-loop/todo-completions'), { recursive: true });
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-completions/invalid.json'), JSON.stringify({
      selected_todo_id: removedId,
      reason: 'source_parent_completed'
    }));
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), [
      '# Brownie TODO Queue',
      '',
      `- [x] ${sourceId}: Parent fixture.`,
      '',
      `- [ ] ${leafId}: Create only \`package.json\` for an invalidated completion fixture:`,
      '  Route: implementation.',
      `  Source TODO: ${sourceId}.`,
      `  Depends on: ${removedId}.`,
      '  Completion condition: require a canonically valid dependency.',
      '  Forbidden changes: do not edit unrelated files.',
      '  Verification: run `pnpm --workspace-root guard:todo-decomposition`.',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      `## ${sourceId} split`,
      '',
      `Parent TODO: ${sourceId}: Parent fixture.`,
      'Dependency graph:',
      `- ${leafId}: ${removedId}`,
      '',
      'Verification ledger:',
      `- ${leafId}: \`pnpm --workspace-root guard:todo-decomposition\``,
      '',
      'Quality rubric:',
      '- The final leaf has a concrete target.',
      '',
      'History:',
      '- fixture',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-invalidated-completion',
      selected_todo: `- [ ] ${leafId}: Create only \`package.json\` for an invalidated completion fixture:`
    }, null, 2));

    const result = runRepair(root);
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /source_sibling_contract_repair_failed_guard/);
    assert.ok(fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8').includes(`${leafId}: Create only \`package.json\``));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('retains descriptive scope words while normalizing an existing Create-only target', () => {
  const root = makeTempRepo();
  try {
    const sourceId = 'E-23z-descriptive-scope-word';
    const leafId = `${sourceId}-target-01`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), [
      '# Brownie TODO Queue',
      '',
      `- [x] ${sourceId}: Parent fixture.`,
      '',
      `- [ ] ${leafId}: Create only \`package.json\` to preserve Patch only behavior:`,
      '  Route: implementation.',
      `  Source TODO: ${sourceId}.`,
      '  Depends on: <none>.',
      '  Completion condition: retain descriptive wording outside scopes.',
      '  Forbidden changes: do not edit unrelated files.',
      '  Verification: run `pnpm --workspace-root guard:todo-decomposition`.',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown', '', `## ${sourceId} split`, '', `Parent TODO: ${sourceId}: Parent fixture.`,
      'Dependency graph:', `- ${leafId}: <none>`, '', 'Verification ledger:',
      `- ${leafId}: \`pnpm --workspace-root guard:todo-decomposition\``, '', 'Quality rubric:',
      '- The final leaf has a concrete target.', '', 'History:', '- fixture', ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-descriptive-scope-word',
      selected_todo: `- [ ] ${leafId}: Create only \`package.json\` to preserve Patch only behavior:`
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8').includes(`${leafId}: Patch only \`package.json\` to preserve Patch only behavior:`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('does not treat a verification path prefix as an exact sibling output', () => {
  const root = makeTempRepo();
  try {
    const sourceId = 'E-23z-verification-prefix';
    const firstId = `${sourceId}-target-01`;
    const secondId = `${sourceId}-target-02`;
    const leaf = (id, target, dependency, verification) => `- [ ] ${id}: Create only \`${target}\` for an exact verification-path fixture:
  Route: implementation.
  Source TODO: ${sourceId}.
  Depends on: ${dependency}.
  Completion condition: retain only dependencies justified by exact verification paths.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`node --test ${verification}\`.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), [
      '# Brownie TODO Queue',
      '',
      `- [x] ${sourceId}: Parent fixture.`,
      '',
      leaf(firstId, 'scripts/prefix-tool.mjs', secondId, 'scripts/prefix-tool.mjs'),
      '',
      leaf(secondId, 'scripts/prefix-tool.mjs.map', firstId, 'scripts/prefix-tool.mjs.map'),
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      `## ${sourceId} split`,
      '',
      `Parent TODO: ${sourceId}: Parent fixture.`,
      'Dependency graph:',
      `- ${firstId}: ${secondId}`,
      `- ${secondId}: ${firstId}`,
      '',
      'Verification ledger:',
      `- ${firstId}: \`node --test scripts/prefix-tool.mjs\``,
      `- ${secondId}: \`node --test scripts/prefix-tool.mjs.map\``,
      '',
      'Quality rubric:',
      '- Each leaf has a concrete target.',
      '',
      'History:',
      '- fixture',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-verification-prefix',
      selected_todo: leaf(firstId, 'scripts/prefix-tool.mjs', secondId, 'scripts/prefix-tool.mjs')
    }, null, 2));

    const result = runRepair(root);
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /unrepairable_source_sibling_cycle/);
    const todo = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    assert.match(todo, new RegExp(`${firstId}[\\s\\S]*?Depends on: ${secondId}\\.`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('does not treat descriptive backticks as Create-only scopes when breaking a cycle', () => {
  const root = makeTempRepo();
  try {
    const sourceId = 'E-23z-descriptive-scope';
    const firstId = `${sourceId}-target-01`;
    const secondId = `${sourceId}-target-02`;
    const first = `- [ ] ${firstId}: Create only \`scripts/declared-output.mjs\` with verification described by \`scripts/descriptive-output.mjs\`:
  Route: implementation.
  Source TODO: ${sourceId}.
  Depends on: ${secondId}.
  Completion condition: preserve only the leading Create-only target as scope.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`node --test scripts/declared-output.mjs\`.`;
    const second = `- [ ] ${secondId}: Create only \`scripts/descriptive-output.mjs\` for the companion leaf:
  Route: implementation.
  Source TODO: ${sourceId}.
  Depends on: ${firstId}.
  Completion condition: retain the cycle when no exact declared creator justifies removal.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`node --test scripts/descriptive-output.mjs\`.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), [
      '# Brownie TODO Queue',
      '',
      `- [x] ${sourceId}: Parent fixture.`,
      '',
      first,
      '',
      second,
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      `## ${sourceId} split`,
      '',
      `Parent TODO: ${sourceId}: Parent fixture.`,
      'Dependency graph:',
      `- ${firstId}: ${secondId}`,
      `- ${secondId}: ${firstId}`,
      '',
      'Verification ledger:',
      `- ${firstId}: \`node --test scripts/declared-output.mjs\``,
      `- ${secondId}: \`node --test scripts/descriptive-output.mjs\``,
      '',
      'Quality rubric:',
      '- Each leaf has a concrete target.',
      '',
      'History:',
      '- fixture',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-descriptive-scope',
      selected_todo: first
    }, null, 2));

    const result = runRepair(root);
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /unrepairable_source_sibling_cycle/);
    assert.match(fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8'), new RegExp(`${firstId}[\\s\\S]*?Depends on: ${secondId}\\.`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('does not remove a cycle edge when its output verifier is only downstream of the cycle', () => {
  const root = makeTempRepo();
  try {
    const sourceId = 'E-23z-downstream-verifier';
    const firstId = `${sourceId}-target-01`;
    const secondId = `${sourceId}-target-02`;
    const downstreamId = `${sourceId}-target-03`;
    const leaf = (id, target, dependency, verification) => `- [ ] ${id}: Create only \`${target}\` for a cycle-path verifier fixture:
  Route: implementation.
  Source TODO: ${sourceId}.
  Depends on: ${dependency}.
  Completion condition: retain a cycle unless the verifier proves the particular removed edge is a prerequisite.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`node --test ${verification}\`.`;
    const first = leaf(firstId, 'scripts/first.mjs', secondId, 'scripts/first.mjs');
    const second = leaf(secondId, 'scripts/second.mjs', firstId, 'scripts/second.mjs');
    const downstream = leaf(downstreamId, 'scripts/downstream.mjs', firstId, 'scripts/first.mjs');
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), [
      '# Brownie TODO Queue',
      '',
      `- [x] ${sourceId}: Parent fixture.`,
      '',
      first,
      '',
      second,
      '',
      downstream,
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      `## ${sourceId} split`,
      '',
      `Parent TODO: ${sourceId}: Parent fixture.`,
      'Dependency graph:',
      `- ${firstId}: ${secondId}`,
      `- ${secondId}: ${firstId}`,
      `- ${downstreamId}: ${firstId}`,
      '',
      'Verification ledger:',
      `- ${firstId}: \`node --test scripts/first.mjs\``,
      `- ${secondId}: \`node --test scripts/second.mjs\``,
      `- ${downstreamId}: \`node --test scripts/first.mjs\``,
      '',
      'Quality rubric:',
      '- Each leaf has a concrete target.',
      '',
      'History:',
      '- fixture',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-downstream-verifier',
      selected_todo: first
    }, null, 2));

    const result = runRepair(root);
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /unrepairable_source_sibling_cycle/);
    const todo = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    assert.match(todo, new RegExp(`${firstId}[\\s\\S]*?Depends on: ${secondId}\\.`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('does not use the target leaf to reach a verifier while deciding which cycle edge to remove', () => {
  const root = makeTempRepo();
  try {
    const sourceId = 'E-23z-shared-cycle-verifier';
    const targetId = `${sourceId}-target-01`;
    const prerequisiteId = `${sourceId}-target-02`;
    const verifierId = `${sourceId}-target-03`;
    const leaf = (id, target, dependencies, verification) => `- [ ] ${id}: Create only \`${target}\` for a target-excluding cycle-path fixture:
  Route: implementation.
  Source TODO: ${sourceId}.
  Depends on: ${dependencies}.
  Completion condition: retain each prerequisite unless its verifier is reachable without traversing the target leaf.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`node --test ${verification}\`.`;
    const target = leaf(targetId, 'scripts/target.mjs', `${prerequisiteId}, ${verifierId}`, 'scripts/target.mjs');
    const prerequisite = leaf(prerequisiteId, 'scripts/prerequisite.mjs', targetId, 'scripts/prerequisite.mjs');
    const verifier = leaf(verifierId, 'scripts/verifier.mjs', targetId, 'scripts/target.mjs');
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), [
      '# Brownie TODO Queue',
      '',
      `- [x] ${sourceId}: Parent fixture.`,
      '',
      target,
      '',
      prerequisite,
      '',
      verifier,
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      `## ${sourceId} split`,
      '',
      `Parent TODO: ${sourceId}: Parent fixture.`,
      'Dependency graph:',
      `- ${targetId}: ${prerequisiteId}, ${verifierId}`,
      `- ${prerequisiteId}: ${targetId}`,
      `- ${verifierId}: ${targetId}`,
      '',
      'Verification ledger:',
      `- ${targetId}: \`node --test scripts/target.mjs\``,
      `- ${prerequisiteId}: \`node --test scripts/prerequisite.mjs\``,
      `- ${verifierId}: \`node --test scripts/target.mjs\``,
      '',
      'Quality rubric:',
      '- Each leaf has a concrete target.',
      '',
      'History:',
      '- fixture',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-shared-cycle-verifier',
      selected_todo: target
    }, null, 2));

    const result = runRepair(root);
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /source_sibling_contract_repair_failed_guard/);
    const todo = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    assert.match(todo, new RegExp(`${targetId}[\\s\\S]*?Depends on: ${prerequisiteId}, ${verifierId}\\.`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deterministically decomposes E-19h release contract trace binding with allowlisted verification', () => {
  const root = makeTempRepo();
  try {
    const selected = `- [ ] TODO-decompose-broad-todo-9430463ff3c2: Decompose broad TODO \`E-19h-release-contract-trace-binding\` into implementable leaf TODOs:
  Route: todo-decomposition. Source: selected TODO hash \`9430463ff3c2e340974866ff0574dea52903644e5f289db085bce6cb4865f68e\` needs Brownie-owned decomposition because \`broad_unbounded_todo\`. Brownie must patch \`.brownie/todo.md\` so the broad selected TODO and this decomposition request are replaced by smaller unchecked leaf TODOs. Each generated leaf must include \`Route:\`, \`Source TODO:\`, \`Depends on:\`, \`Completion condition:\`, \`Forbidden changes:\`, and \`Verification:\`. Implementation leaves must name at most two concrete \`Patch only\` or \`Create only\` paths. Also update \`.brownie/todo-breakdown.md\` with the dependency graph, verification ledger, and a short history note. Do not implement the underlying task in this decomposition pass. Generated at \`2026-09-28T00:05:26Z\`.`;
    const source = `- [ ] E-19h-release-contract-trace-binding: Patch only \`docs/architecture/runtime-release-contract.json\`, \`docs/architecture/runtime-release-readiness-audit.json\`, and \`scripts/guard-release-contract.test.mjs\` so implementation commit, tested commit, workflow run id, and artifact SHA cannot remain \`pending-evidence-binding\` when the contract claims a corresponding release evidence section is implemented.
  Route: implementation.
  Depends on: <none>.
  Completion condition: Release Contract and readiness audit fail closed with explicit blockers until current tested commit, workflow run, and artifact SHA bindings are real values or the section is marked not satisfied.
  Forbidden changes: do not fill trace fields with placeholders, do not mark evidence implemented without matching generated evidence, and do not declare Runtime Product Ready.
  Verification: run \`pnpm --workspace-root guard:release-contract:test\`, \`pnpm --workspace-root guard:release-contract\`, and \`pnpm --workspace-root guard:runtime-release-readiness\`.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n${selected}\n\n${source}\n`);
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-test',
      selected_todo: selected
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const breakdownText = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    assert(!todoText.includes('TODO-decompose-broad-todo-9430463ff3c2'), todoText);
    assert(!todoText.includes('- [ ] E-19h-release-contract-trace-binding:'), todoText);
    assert(todoText.includes('E-19h-release-contract-trace-test'), todoText);
    assert(todoText.includes('E-19h-release-contract-trace-fields'), todoText);
    assert(todoText.includes('pnpm --workspace-root guard:release-contract:test'), todoText);
    assert(todoText.includes('pnpm --workspace-root guard:runtime-release-readiness'), todoText);
    assert(breakdownText.includes('E-19h-release-contract-trace-test'), breakdownText);
    assert.deepEqual(validateTodoDecompositionText(todoText, {
      path: '.brownie/todo.md',
      repoRoot: root,
      packageScripts: new Set([
        'guard:release-contract',
        'guard:release-contract:test',
        'guard:runtime-release-readiness',
        'guard:phase-value',
        'guard:todo-decomposition'
      ]),
      breakdownPath: '.brownie/todo-breakdown.md',
      breakdownText,
      productReady: false,
      releaseBlockersRemaining: true
    }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('falls back to explicit blocker leaf when broad TODO has no bounded target paths', () => {
  const root = makeTempRepo();
  try {
    const selected = `- [ ] TODO-decompose-broad-todo-nopath: Decompose broad TODO \`E-22a-no-target\` into implementable leaf TODOs:
  Route: todo-decomposition. Source: selected TODO hash \`abc\` needs Brownie-owned decomposition because \`broad_unbounded_todo\`. Brownie must patch \`.brownie/todo.md\`.`;
    const source = `- [ ] E-22a-no-target: Resolve the remaining release blocker without target scope.
  Route: implementation.
  Depends on: <none>.
  Completion condition: a concrete scope is identified.
  Forbidden changes: do not edit unrelated files.
  Verification: blocker: target scope is unknown.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n${selected}\n\n${source}\n`);
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-test',
      selected_todo: selected
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    assert(todoText.includes('E-22a-no-target-blocker'), todoText);
    assert(todoText.includes('Route: release-ops.'), todoText);
    assert(todoText.includes('Verification: blocker:'), todoText);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('repairs selected leaf with missing Patch only peer target and breakdown-only dependency', () => {
  const root = makeTempRepo();
  try {
    const selected = `- [ ] E-20g-final-judgment-sync-target-01: Patch only \`docs/architecture/final-product-ready-judgment.json\` to complete one bounded slice of E-20g-final-judgment-sync:
  Route: documentation.
  Source TODO: E-20g-final-judgment-sync.
  Depends on: E-20f-release-generation-sync.
  Completion condition: Patch only \`docs/architecture/final-product-ready-judgment.json\` so this slice satisfies the parent TODO intent: semantic consistency tests fail when Final Judgment names an obsolete blocker generation while TODO, Phase manifest, or Readiness Audit name a newer Release blocker.
  Forbidden changes: do not mark Product Ready, do not remove owner-review history, and do not weaken semantic consistency failures; do not edit unrelated files or sibling split targets \`scripts/guard-release-evidence-semantic-consistency.test.mjs\`.
  Verification: run \`pnpm --workspace-root guard:release-evidence-semantic-consistency:test\` and \`pnpm --workspace-root guard:release-evidence-semantic-consistency\`.`;
    const sibling = `- [ ] E-20g-final-judgment-sync-target-02: Patch only \`scripts/guard-release-evidence-semantic-consistency.test.mjs\` to complete one bounded slice of E-20g-final-judgment-sync:
  Route: implementation.
  Source TODO: E-20g-final-judgment-sync.
  Depends on: E-20g-final-judgment-sync-target-01.
  Completion condition: Patch only \`scripts/guard-release-evidence-semantic-consistency.test.mjs\` so this slice satisfies the parent TODO intent.
  Forbidden changes: do not mark Product Ready, do not remove owner-review history, and do not edit unrelated files or sibling split targets \`docs/architecture/final-product-ready-judgment.json\`.
  Verification: run \`pnpm --workspace-root guard:release-evidence-semantic-consistency:test\`.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n- [x] E-20g-final-judgment-sync: Patch only \`docs/architecture/final-product-ready-judgment.json\` and \`scripts/guard-release-evidence-semantic-consistency.test.mjs\`: require Final Judgment generation/status to match the live TODO/phase/audit blocker generation.\n\n${selected}\n\n${sibling}\n`);
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      '## TODO-decompose-e20g',
      '',
      'Parent TODO: E-20g-final-judgment-sync',
      '',
      'Dependency graph:',
      '- E-20g-final-judgment-sync-target-01: E-20f-release-generation-sync',
      '- E-20g-final-judgment-sync-target-02: E-20g-final-judgment-sync-target-01',
      '',
      'Verification ledger:',
      '- E-20g-final-judgment-sync-target-01: run `pnpm --workspace-root guard:release-evidence-semantic-consistency:test` and `pnpm --workspace-root guard:release-evidence-semantic-consistency`',
      '- E-20g-final-judgment-sync-target-02: run `pnpm --workspace-root guard:release-evidence-semantic-consistency:test`',
      '',
      'Quality rubric:',
      '- E-20g-final-judgment-sync-target-01: bounded target scope.',
      '- E-20g-final-judgment-sync-target-02: bounded target scope.',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-test',
      selected_todo: selected
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const breakdownText = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    const repairedSelected = todoText.slice(
      todoText.indexOf('- [ ] E-20g-final-judgment-sync-target-01:'),
      todoText.indexOf('- [ ] E-20g-final-judgment-sync-target-02:')
    );
    assert(!repairedSelected.includes('docs/architecture/final-product-ready-judgment.json'), repairedSelected);
    assert(repairedSelected.includes('docs/architecture/final-product-ready-judgment.md'), repairedSelected);
    assert(repairedSelected.includes('Depends on: <none>.'), repairedSelected);
    assert(breakdownText.includes('- E-20g-final-judgment-sync-target-01: <none>'), breakdownText);
    assert.deepEqual(validateTodoDecompositionText(todoText, {
      path: '.brownie/todo.md',
      repoRoot: root,
      packageScripts: new Set([
        'guard:release-contract',
        'guard:release-contract:test',
        'guard:runtime-release-readiness',
        'guard:phase-value',
        'guard:release-evidence-semantic-consistency',
        'guard:release-evidence-semantic-consistency:test',
        'guard:todo-decomposition'
      ]),
      breakdownPath: '.brownie/todo-breakdown.md',
      breakdownText,
      productReady: false,
      releaseBlockersRemaining: true
    }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('repairs dangling dependency when active claim was already removed from live queue', () => {
  const root = makeTempRepo();
  try {
    const selected = `- [ ] E-15e-todo-queue-decomposition: Patch only \`.brownie/todo.md\` to replace the selected decomposition TODO with bounded leaves.
  Route: todo-decomposition.
  Source TODO: TODO-decompose-release-ops-blockers-1c5120ce46c2-r2.
  Depends on: <none>.
  Completion condition: leaf TODOs are generated.
  Forbidden changes: do not patch implementation files.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    const remainingLeaf = `- [ ] E-15f-todo-breakdown-update: Patch only \`.brownie/todo-breakdown.md\` to add the parent TODO, dependency graph, and verification ledger for the generated leaf TODOs.
  Route: todo-decomposition.
  Source TODO: TODO-decompose-release-ops-blockers-1c5120ce46c2-r2.
  Depends on: E-15e-todo-queue-decomposition.
  Completion condition: The breakdown ledger contains the parent ID, leaf IDs, dependency edges, and a short history note.
  Forbidden changes: do not modify implementation files or declare Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n${remainingLeaf}\n`);
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      'Parent TODO: TODO-decompose-release-ops-blockers-1c5120ce46c2-r2',
      '',
      'Dependency graph:',
      '- E-15e-todo-queue-decomposition: <none>',
      '- E-15f-todo-breakdown-update: E-15e-todo-queue-decomposition',
      '',
      'Verification ledger:',
      '- E-15e-todo-queue-decomposition: run `pnpm --workspace-root guard:todo-decomposition`',
      '- E-15f-todo-breakdown-update: run `pnpm --workspace-root guard:todo-decomposition`',
      '',
      'Quality rubric:',
      '- E-15f-todo-breakdown-update: bounded breakdown update leaf.',
      '',
      'History:',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-test',
      selected_todo: selected
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.operation, 'deterministic_dangling_dependency_repair');
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const breakdownText = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    assert(todoText.includes('Depends on: <none>.'), todoText);
    assert(breakdownText.includes('- E-15f-todo-breakdown-update: <none>'), breakdownText);
    assert.deepEqual(validateTodoDecompositionText(todoText, {
      path: '.brownie/todo.md',
      repoRoot: root,
      packageScripts: new Set([
        'guard:release-contract',
        'guard:release-contract:test',
        'guard:runtime-release-readiness',
        'guard:phase-value',
        'guard:todo-decomposition'
      ]),
      breakdownPath: '.brownie/todo-breakdown.md',
      breakdownText,
      productReady: false,
      releaseBlockersRemaining: true
    }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('atomically repairs a derived leaf dependency and missing breakdown entries after a stale claim', () => {
  const root = makeTempRepo();
  try {
    const staleSelected = `- [ ] E-23a-stale-decomposition: Patch only \`.brownie/todo.md\` to repair an earlier decomposition.
  Route: todo-decomposition.
  Source TODO: E-23a-parent.
  Depends on: <none>.
  Completion condition: the queue is valid.
  Forbidden changes: do not edit implementation files.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    const decomposition = `- [ ] E-23a-breakdown-sync: Patch only \`.brownie/todo-breakdown.md\` to record child leaves for E-23a-parent:
  Route: todo-decomposition.
  Source TODO: E-23a-parent.
  Depends on: <none>.
  Completion condition: the breakdown ledger records each derived leaf.
  Forbidden changes: do not edit implementation files.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    const implementation = `- [ ] E-23a-child-impl: Patch only \`scripts/release-local-artifact.mjs\` to implement the bounded child:
  Route: implementation.
  Source TODO: E-23a-parent.
  Depends on: <none>.
  Completion condition: the child implementation is complete.
  Forbidden changes: do not declare Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    const dependent = `- [ ] E-23a-child-test: Patch only \`scripts/release-local-artifact.test.mjs\` to test the bounded child:
  Route: implementation.
  Source TODO: E-23a-parent.
  Depends on: E-23a-child-impl, E-23a-stale-decomposition.
  Completion condition: the child test is complete.
  Forbidden changes: do not declare Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    fs.writeFileSync(path.join(root, 'scripts/release-local-artifact.mjs'), '// fixture\n');
    fs.writeFileSync(path.join(root, 'scripts/release-local-artifact.test.mjs'), '// fixture\n');
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n${decomposition}\n\n${implementation}\n\n${dependent}\n`);
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      'Dependency graph:',
      '- E-23a-stale-decomposition: <none>',
      '- E-23a-child-test: E-23a-child-impl, E-23a-stale-decomposition',
      '',
      'Verification ledger:',
      '- E-23a-stale-decomposition: run `pnpm --workspace-root guard:todo-decomposition`',
      '',
      'Quality rubric:',
      '',
      'History:',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-test',
      selected_todo: staleSelected
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const breakdownText = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    assert(todoText.includes('Depends on: E-23a-child-impl.'), todoText);
    assert(breakdownText.includes('## TODO-repair-derived-E-23a-parent'), breakdownText);
    assert(breakdownText.includes('- E-23a-child-test: E-23a-child-impl'), breakdownText);
    assert.deepEqual(validateTodoDecompositionText(todoText, {
      path: '.brownie/todo.md',
      repoRoot: root,
      packageScripts: new Set(['guard:todo-decomposition']),
      breakdownPath: '.brownie/todo-breakdown.md',
      breakdownText,
      productReady: false,
      releaseBlockersRemaining: true
    }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('adds missing breakdown section for breakdown-only decomposition leaf', () => {
  const root = makeTempRepo();
  try {
    const selected = `- [ ] E-15f-todo-breakdown-update: Patch only \`.brownie/todo-breakdown.md\` to add the parent TODO, dependency graph, and verification ledger for the generated leaf TODOs.
  Route: todo-decomposition.
  Source TODO: TODO-decompose-release-ops-blockers-1c5120ce46c2-r2.
  Depends on: <none>.
  Completion condition: The breakdown ledger contains the parent ID, leaf IDs, dependency edges, and a short history note.
  Forbidden changes: do not modify implementation files or declare Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    const blocker = `- [ ] E-99-release-blocker: Blocker: external release evidence remains pending.
  Route: blocker.
  Depends on: <none>.
  Completion condition: external evidence is supplied.
  Forbidden changes: do not invent evidence values or declare Product Ready.
  Verification: blocker: exact missing evidence or field is named, and no workspace file is patched until that evidence is available.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n${selected}\n\n${blocker}\n`);
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      'Parent TODO: some-other-parent',
      '',
      'Dependency graph:',
      '- E-15f-todo-breakdown-update: <none>',
      '',
      'Verification ledger:',
      '- E-15f-todo-breakdown-update: run `pnpm --workspace-root guard:todo-decomposition`',
      '',
      'Quality rubric:',
      '- E-15f-todo-breakdown-update: bounded breakdown update leaf.',
      '',
      'History:',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-test',
      selected_todo: selected
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.operation, 'deterministic_breakdown_update_leaf_repair');
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const breakdownText = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    assert(breakdownText.includes('Parent TODO: TODO-decompose-release-ops-blockers-1c5120ce46c2-r2'), breakdownText);
    assert(breakdownText.includes('## TODO-repair-E-15f-todo-breakdown-update'), breakdownText);
    assert(!todoText.includes('- [ ] E-15f-todo-breakdown-update:'), todoText);
    assert.deepEqual(validateTodoDecompositionText(todoText, {
      path: '.brownie/todo.md',
      repoRoot: root,
      packageScripts: new Set([
        'guard:release-contract',
        'guard:release-contract:test',
        'guard:runtime-release-readiness',
        'guard:phase-value',
        'guard:todo-decomposition'
      ]),
      breakdownPath: '.brownie/todo-breakdown.md',
      breakdownText,
      productReady: false,
      releaseBlockersRemaining: true
    }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('removes release-ops decomposition request when leaf outputs already exist', () => {
  const root = makeTempRepo();
  try {
    const selected = `- [ ] TODO-decompose-release-ops-blockers-abc123: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to convert release-ops blocker TODOs into implementable Brownie-owned leaf TODOs:
  Route: todo-decomposition.
  Queue hash: \`abc123\`.
  Depends on: <none>.
  Completion condition: The release-ops blocker TODOs are replaced by bounded implementation/documentation/release-ops leaves that name exact target files and existing verification commands, while truly owner-controlled or external-environment requirements remain explicit blockers.
  Forbidden changes: do not patch implementation files in this decomposition pass, do not invent evidence values, and do not declare Runtime Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    const releaseOpsLeaf = `- [ ] E-21c-release-ops-todo-split-clean-release-workspace: Blocker: clean Release workspace setup remains pending:
  Route: release-ops.
  Source TODO: E-21c-release-ops-todo-split.
  Depends on: <none>.
  Completion condition: Release Ops has a concrete fail-closed evidence item and Product Ready remains false until that evidence is produced.
  Forbidden changes: do not patch implementation files, do not invent evidence values, and do not declare Runtime Product Ready.
  Verification: blocker: Release Ops evidence remains fail-closed until this item is replaced by generated evidence or by a bounded implementation TODO with existing verification.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n${selected}\n\n${releaseOpsLeaf}\n`);
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      'Parent TODO: E-21c-release-ops-todo-split',
      '',
      'Dependency graph:',
      '- E-21c-release-ops-todo-split-clean-release-workspace: <none>',
      '',
      'Verification ledger:',
      '- E-21c-release-ops-todo-split-clean-release-workspace: blocker: Release Ops evidence remains fail-closed',
      '',
      'Quality rubric:',
      '- E-21c-release-ops-todo-split-clean-release-workspace: bounded release-ops blocker.',
      '',
      'History:',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-test',
      selected_todo: selected
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.operation, 'deterministic_release_ops_decomposition_request_repair');
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const breakdownText = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    assert(!todoText.includes('- [ ] TODO-decompose-release-ops-blockers-abc123:'), todoText);
    assert(todoText.includes('- [ ] E-21c-release-ops-todo-split-clean-release-workspace:'), todoText);
    assert(breakdownText.includes('Parent TODO: TODO-decompose-release-ops-blockers-abc123'), breakdownText);
    assert.deepEqual(validateTodoDecompositionText(todoText, {
      path: '.brownie/todo.md',
      repoRoot: root,
      packageScripts: new Set([
        'guard:release-contract',
        'guard:release-contract:test',
        'guard:runtime-release-readiness',
        'guard:phase-value',
        'guard:todo-decomposition'
      ]),
      breakdownPath: '.brownie/todo-breakdown.md',
      breakdownText,
      productReady: false,
      releaseBlockersRemaining: true
    }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('refines Brownie-owned release-ops blockers into executable implementation leaves', () => {
  const root = makeTempRepo();
  try {
    const selected = `- [ ] TODO-refine-brownie-owned-blockers-feedface1234: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to refine Brownie-owned blocker TODOs into executable implementation/documentation leaves:
  Route: todo-decomposition.
  Queue hash: \`feedface1234\`.
  Depends on: <none>.
  Completion condition: Brownie-owned blockers are replaced by bounded implementation or documentation TODOs with exact target files and existing verification commands, while true external authority blockers remain explicit blockers.
  Forbidden changes: do not patch implementation files in this refinement pass, do not invent evidence values, do not weaken fail-closed release gates, and do not declare Runtime Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\` and \`pnpm --workspace-root phase-loop:todo-queue-integrity\`.`;
    const ownedA = `- [ ] E-21c-release-ops-todo-split-golden-journey: Blocker: Golden Journey evidence is generated from a temporary workspace with observable workspace mutation instead of reusing the dirty development workspace:
  Route: release-ops.
  Source TODO: E-21c-release-ops-todo-split.
  Depends on: <none>.
  Completion condition: Release Ops has a concrete fail-closed evidence item for Golden Journey evidence, and Product Ready remains false until that evidence is produced and bound to the current release commit.
  Forbidden changes: do not patch implementation files for this Release Ops blocker, do not invent evidence values, and do not declare Runtime Product Ready.
  Verification: blocker: Release Ops evidence remains fail-closed until this item is replaced by generated evidence or by a bounded implementation TODO with existing verification.`;
    const ownedB = `- [ ] E-21c-release-ops-todo-split-provenance-binding: Blocker: artifact SHA, source commit, workflow/run identity, and clean tree status are bound together before Release Contract trace fields can be populated:
  Route: release-ops.
  Source TODO: E-21c-release-ops-todo-split.
  Depends on: E-21c-release-ops-todo-split-golden-journey.
  Completion condition: Release Ops has a concrete fail-closed evidence item for provenance binding, and Product Ready remains false until that evidence is produced and bound to the current release commit.
  Forbidden changes: do not patch implementation files for this Release Ops blocker, do not invent evidence values, and do not declare Runtime Product Ready.
  Verification: blocker: Release Ops evidence remains fail-closed until this item is replaced by generated evidence or by a bounded implementation TODO with existing verification.`;
    const external = `- [ ] E-20i-runtime-release-ops-blocker: Blocker: Owner-controlled Runtime Release Ops authority is required for clean CI build, artifact upload/provenance, and GitHub Release publication.
  Route: blocker.
  Source TODO: TODO-decompose-release-ops-blockers.
  Depends on: <none>.
  Completion condition: Release engineering owner provides or documents the Runtime Release Ops authority needed for clean CI builds, artifact upload/provenance binding, and GitHub Release publication. Customer or Enterprise production deployment credentials are explicitly out of Runtime Product Ready scope and must not block the OSS Runtime release.
  Forbidden changes: do not attempt to configure external CI/CD, create credentials, publish a GitHub Release, or request customer/Enterprise production deployment credentials.
  Verification: inspect/blocker/fail-closed until Release Ops owner provides evidence of clean CI/artifact/provenance/publication authority or documents the remaining owner-controlled Runtime Release requirement.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n${selected}\n\n${ownedA}\n\n${ownedB}\n\n${external}\n`);
    fs.mkdirSync(path.join(root, '.brownie/private/phase-loop/todo-replans'), { recursive: true });
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-replans/E-19k.json'), JSON.stringify({
      schema_version: 1,
      record_type: 'todo_replan',
      operation: 'split_parent_into_children',
      parent_todo_id: 'E-19k-remaining-release-evidence-blocker',
      parent_status: 'superseded_by_children',
      replacement_source_todo_id: 'E-21c-release-ops-todo-split',
      generated_child_ids: [
        'E-21c-release-ops-todo-split-golden-journey',
        'E-21c-release-ops-todo-split-provenance-binding'
      ]
    }, null, 2));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-owned-refinement',
      selected_todo: selected
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.operation, 'deterministic_brownie_owned_blocker_refinement_repair');
    assert(parsed.replanRecordPaths.some((entry) => entry.includes('E-19k-remaining-release-evidence-blocker')), parsed);
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const breakdownText = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    assert(!todoText.includes('- [ ] TODO-refine-brownie-owned-blockers-feedface1234:'), todoText);
    assert(!todoText.includes('- [ ] E-21c-release-ops-todo-split-golden-journey: Blocker:'), todoText);
    assert(todoText.includes('E-21c-runtime-operational-evidence-impl-1'), todoText);
    assert(todoText.includes('Route: implementation.'), todoText);
    assert(todoText.includes('scripts/release-runtime-operational-evidence.mjs'), todoText);
    assert(todoText.includes('scripts/release-supply-chain-artifact-evidence.mjs'), todoText);
    assert(todoText.includes('Depends on: E-21c-runtime-operational-evidence-impl-1.'), todoText);
    assert(todoText.includes('- [ ] E-20i-runtime-release-ops-blocker:'), todoText);
    assert(breakdownText.includes('Parent TODO: brownie-owned-blocker-refinement'), breakdownText);
    assert.deepEqual(validateTodoDecompositionText(todoText, {
      path: '.brownie/todo.md',
      repoRoot: root,
      packageScripts: new Set([
        'guard:release-contract',
        'guard:release-contract:test',
        'guard:runtime-release-readiness',
        'guard:phase-value',
        'guard:release-evidence-semantic-consistency',
        'guard:release-evidence-semantic-consistency:test',
        'guard:runtime-operational-evidence',
        'guard:runtime-operational-evidence:test',
        'guard:supply-chain-artifact-evidence',
        'guard:supply-chain-artifact-evidence:test',
        'release:runtime-operational-evidence:test',
        'guard:todo-decomposition'
      ]),
      breakdownPath: '.brownie/todo-breakdown.md',
      breakdownText,
      productReady: false,
      releaseBlockersRemaining: true
    }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('converts directory-scoped implementation leaf into Brownie-owned decomposition TODO', () => {
  const root = makeTempRepo();
  try {
    const selected = `- [ ] E-21a-clean-release-workspace-contract-leaf-c: Patch only \`scripts/\` to close one bounded slice of E-21a-clean-release-workspace-contract:
  Route: implementation.
  Source TODO: E-21a-clean-release-workspace-contract.
  Depends on: <none>.
  Completion condition: The bounded E-21a-clean-release-workspace-contract slice for scripts/ is implemented and verified without changing unrelated release readiness state.
  Forbidden changes: do not edit unrelated files, do not invent release evidence values, and do not declare Runtime Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n${selected}\n`);
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-directory',
      selected_todo: selected
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const breakdownText = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    assert(todoText.includes('E-21a-clean-release-workspace-contract-leaf-c-decompose-targets'), todoText);
    assert(todoText.includes('Route: todo-decomposition.'), todoText);
    assert(todoText.includes('Patch only `.brownie/todo.md` and `.brownie/todo-breakdown.md`'), todoText);
    assert(!todoText.includes('Patch only `scripts/`'), todoText);
    assert(breakdownText.includes('TODO-repair-E-21a-clean-release-workspace-contract-leaf-c-decompose-targets'), breakdownText);
    assert.deepEqual(validateTodoDecompositionText(todoText, {
      path: '.brownie/todo.md',
      repoRoot: root,
      packageScripts: new Set(['guard:todo-decomposition']),
      breakdownPath: '.brownie/todo-breakdown.md',
      breakdownText,
      productReady: false,
      releaseBlockersRemaining: true
    }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('expands Brownie-owned directory decomposition TODO into concrete script leaves', () => {
  const root = makeTempRepo();
  try {
    const selected = `- [ ] E-21a-clean-release-workspace-contract-leaf-c-decompose-targets: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to decompose directory-scoped TODO E-21a-clean-release-workspace-contract-leaf-c into concrete file-specific leaves:
  Route: todo-decomposition.
  Source TODO: E-21a-clean-release-workspace-contract.
  Depends on: <none>.
  Completion condition: Brownie replaces the directory target \`scripts/\` with executable single-file Patch only/Create only leaves, each with existing verification commands and without implementing the underlying Release work in this decomposition pass.
  Forbidden changes: do not edit implementation, documentation, or Release evidence files outside \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\`; do not declare Runtime Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    const dependent = `- [ ] E-21b-release-workspace-guard-decompose-targets: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to decompose directory-scoped TODO E-21b-release-workspace-guard into concrete file-specific leaves:
  Route: todo-decomposition.
  Source TODO: E-21b-release-workspace-guard.
  Depends on: E-21a-clean-release-workspace-contract-leaf-c-decompose-targets.
  Completion condition: Brownie replaces the directory target \`scripts/\` with executable single-file Patch only/Create only leaves.
  Forbidden changes: do not edit implementation, documentation, or Release evidence files outside \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\`; do not declare Runtime Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n${selected}\n\n${dependent}\n`);
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      '## TODO-repair-E-21b-release-workspace-guard-decompose-targets',
      '',
      'Parent TODO: E-21b-release-workspace-guard',
      '',
      'Dependency graph:',
      '- E-21b-release-workspace-guard-decompose-targets: E-21a-clean-release-workspace-contract-leaf-c-decompose-targets',
      '',
      'Verification ledger:',
      '- E-21b-release-workspace-guard-decompose-targets: run `pnpm --workspace-root guard:todo-decomposition`',
      '',
      'Quality rubric:',
      '- E-21b-release-workspace-guard-decompose-targets: bounded TODO repair scope.',
      '',
      'History:',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-decompose-targets',
      selected_todo: selected
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const breakdownText = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    assert(!todoText.includes('- [ ] E-21a-clean-release-workspace-contract-leaf-c-decompose-targets:'), todoText);
    assert(todoText.includes('E-21a-clean-release-workspace-contract-scripts-leaf-a'), todoText);
    assert(todoText.includes('Patch only `scripts/guard-release-contract.mjs` and `scripts/guard-release-contract.test.mjs`'), todoText);
    assert(todoText.includes('Depends on: E-21a-clean-release-workspace-contract-scripts-leaf-a.'), todoText);
    assert(breakdownText.includes('TODO-decompose-E-21a-clean-release-workspace-contract-leaf-c-decompose-targets'), breakdownText);
    assert.deepEqual(validateTodoDecompositionText(todoText, {
      path: '.brownie/todo.md',
      repoRoot: root,
      packageScripts: new Set([
        'guard:release-contract',
        'guard:release-contract:test',
        'guard:todo-decomposition'
      ]),
      breakdownPath: '.brownie/todo-breakdown.md',
      breakdownText,
      productReady: false,
      releaseBlockersRemaining: true
    }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('expands residual Release Ops blocker decomposition into fail-closed evidence leaves', () => {
  const root = makeTempRepo();
  try {
    const selected = `- [ ] E-21c-release-ops-todo-split-decompose-targets: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to replace the residual E-19k blocker with concrete Release Ops leaves:
  Route: todo-decomposition.
  Source TODO: E-21c-release-ops-todo-split.
  Depends on: <none>.
  Completion condition: Brownie creates executable Release Ops leaves for clean artifact generation, artifact E2E smoke, lifecycle, Golden Journey, stateful soak, provenance binding, owner governance reproducibility, and document generation sync, while keeping Product Ready false.
  Forbidden changes: do not edit implementation, documentation, or Release evidence files outside \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\`; do not declare Runtime Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    const residual = `- [ ] E-19k-remaining-release-evidence-blocker: Blocker: release evidence remains incomplete after E-19 TODO injection, and Product Ready must remain false until Golden Journey, artifact E2E, lifecycle, stateful soak, provenance binding, dependency audit sync, and owner-verifiable branch protection are closed.
  Route: release-ops.
  Depends on: <none>.
  Completion condition: remaining release blocker evidence is explicitly identified and Product Ready is not inferred from a queue that only contains blockers.
  Forbidden changes: do not patch workspace files for this blocker; do not declare Runtime Product Ready, Runtime Release Ready, or public Release Ready.
  Verification: blocker: release evidence remains fail-closed and no workspace file is patched until the next concrete executable evidence TODO is available.`;
    const dependent = `- [ ] E-21d-generation-consistency-guard-decompose-targets: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to decompose directory-scoped TODO E-21d-generation-consistency-guard into concrete file-specific leaves:
  Route: todo-decomposition.
  Source TODO: E-21d-generation-consistency-guard.
  Depends on: E-21c-release-ops-todo-split-decompose-targets.
  Completion condition: Brownie replaces the directory target \`scripts/\` with executable single-file Patch only/Create only leaves.
  Forbidden changes: do not edit implementation, documentation, or Release evidence files outside \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\`; do not declare Runtime Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n${selected}\n\n${dependent}\n\n${residual}\n`);
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      '## TODO-repair-E-21d-generation-consistency-guard-decompose-targets',
      '',
      'Parent TODO: E-21d-generation-consistency-guard',
      '',
      'Dependency graph:',
      '- E-21d-generation-consistency-guard-decompose-targets: E-21c-release-ops-todo-split-decompose-targets',
      '',
      'Verification ledger:',
      '- E-21d-generation-consistency-guard-decompose-targets: run `pnpm --workspace-root guard:todo-decomposition`',
      '',
      'Quality rubric:',
      '- E-21d-generation-consistency-guard-decompose-targets: bounded TODO repair scope.',
      '',
      'History:',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-release-ops-split',
      selected_todo: selected
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const breakdownText = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    assert(!todoText.includes('- [ ] E-21c-release-ops-todo-split-decompose-targets:'), todoText);
    assert(!todoText.includes('- [ ] E-19k-remaining-release-evidence-blocker:'), todoText);
    assert(todoText.includes('E-21c-release-ops-todo-split-clean-release-workspace'), todoText);
    assert(todoText.includes('E-21c-release-ops-todo-split-stateful-soak'), todoText);
    assert(todoText.includes('E-21c-release-ops-todo-split-document-generation-sync'), todoText);
    assert(todoText.includes('E-21d-generation-consistency-guard-decompose-targets'), todoText);
    assert(todoText.includes('Depends on: <none>.'), todoText);
    assert(breakdownText.includes('TODO-decompose-E-21c-release-ops-todo-split-decompose-targets'), breakdownText);
    assert.deepEqual(validateTodoDecompositionText(todoText, {
      path: '.brownie/todo.md',
      repoRoot: root,
      packageScripts: new Set(['guard:todo-decomposition']),
      breakdownPath: '.brownie/todo-breakdown.md',
      breakdownText,
      productReady: false,
      releaseBlockersRemaining: true
    }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('does not prune completion-backed dependency while repairing another dangling dependency', () => {
  const root = makeTempRepo();
  try {
    const selected = `- [ ] E-22d-runtime-stateful-soak-evidence: Patch only \`scripts/release-runtime-operational-evidence.mjs\` and \`scripts/guard-runtime-operational-evidence.test.mjs\`:
  Route: implementation.
  Source TODO: E-22d.
  Depends on: E-22c-runtime-artifact-e2e-evidence, E-22-old-breakdown-only.
  Completion condition: Runtime operational evidence fails closed unless stateful soak evidence covers process-loss recovery and finite convergence.
  Forbidden changes: do not weaken Golden Journey evidence and do not declare Runtime Product Ready.
  Verification: run \`pnpm --workspace-root release:runtime-operational-evidence:test\` and \`pnpm --workspace-root guard:runtime-operational-evidence\`.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `${selected}\n`);
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      'Parent TODO: E-22d-runtime-stateful-soak-evidence',
      '',
      'Dependency graph:',
      '- E-22d-runtime-stateful-soak-evidence: E-22c-runtime-artifact-e2e-evidence, E-22-old-breakdown-only',
      '- E-22-old-breakdown-only: <none>',
      '',
      'Verification ledger:',
      '',
      'Quality rubric:',
      '',
      'History:',
      ''
    ].join('\n'));
    fs.mkdirSync(path.join(root, '.brownie/private/phase-loop/todo-completions'), { recursive: true });
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-completions/e22c.json'), JSON.stringify({
      selected_todo_id: 'E-22c-runtime-artifact-e2e-evidence'
    }, null, 2));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-completed-dependency',
      selected_todo: selected
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const breakdownText = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    assert.match(todoText, /Depends on: E-22c-runtime-artifact-e2e-evidence\./u);
    assert.doesNotMatch(todoText, /E-22-old-breakdown-only/u);
    assert.match(breakdownText, /E-22d-runtime-stateful-soak-evidence: E-22c-runtime-artifact-e2e-evidence/u);
    assert.doesNotMatch(breakdownText, /E-22d-runtime-stateful-soak-evidence: .*E-22-old-breakdown-only/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
