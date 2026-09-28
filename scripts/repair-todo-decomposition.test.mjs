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
      'guard:todo-decomposition': 'node scripts/guard-todo-decomposition.mjs'
    }
  }, null, 2));
  for (const file of [
    'docs/architecture/runtime-release-contract.json',
    'docs/architecture/runtime-release-readiness-audit.json',
    'docs/architecture/phase-value-manifest.json',
    'scripts/guard-release-contract.test.mjs',
    'scripts/guard-release-contract.mjs',
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
