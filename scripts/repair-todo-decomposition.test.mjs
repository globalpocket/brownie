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
