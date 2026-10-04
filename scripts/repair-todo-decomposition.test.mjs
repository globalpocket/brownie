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
