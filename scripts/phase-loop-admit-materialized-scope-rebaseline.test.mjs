import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { admitMaterializedScopeRebaseline, readGitMaterializedScopeRebaselineRecords, validateMaterializedScopeRebaseline } from './phase-loop-admit-materialized-scope-rebaseline.mjs';
import { validateTodoDecompositionText } from './guard-todo-decomposition.mjs';

function contract(firstLine) {
  return { id: 'E-fixture', first_line: firstLine, route: 'implementation', depends_on: '<none>', completion_condition: 'complete', forbidden_changes: 'none', verification: 'run `node --test`' };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-materialized-scope-'));
  const target = 'scripts/journey.mjs';
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.writeFileSync(path.join(root, target), '// placeholder\n');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, target), 'utf8').trim(), 'utf8').digest('hex');
  const records = [{ target_todo_ids: ['E-fixture'], target_capture: { mode: 'legacy_pre_capture_materialization' }, target_snapshots: [{ operation: 'Create', path: target, exists_after: true, sha256_after: sha256 }] }];
  return { root, target, records };
}

test('admits only a captured Create-to-Patch materialization without target expansion', () => {
  const { root, target, records } = fixture();
  const snapshots = validateMaterializedScopeRebaseline({
    beforeContract: contract(`- [ ] E-fixture: Create only \`${target}\`, then patch only \`package.json\`:`),
    afterContract: contract(`- [ ] E-fixture: Patch only \`${target}\`, then patch only \`package.json\`:`),
    repoRoot: root,
    records
  });
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].path, target);
});

test('rejects added scope and uncaptured content', () => {
  const { root, target, records } = fixture();
  assert.throws(() => validateMaterializedScopeRebaseline({
    beforeContract: contract(`- [ ] E-fixture: Create only \`${target}\`:`),
    afterContract: contract(`- [ ] E-fixture: Patch only \`${target}\` and \`package.json\`:`),
    repoRoot: root,
    records
  }), /add, remove, or replace/u);
  fs.writeFileSync(path.join(root, target), '// changed\n');
  assert.throws(() => validateMaterializedScopeRebaseline({
    beforeContract: contract(`- [ ] E-fixture: Create only \`${target}\`:`),
    afterContract: contract(`- [ ] E-fixture: Patch only \`${target}\`:`),
    repoRoot: root,
    records
  }), /not bound/u);
});

test('writes an exact receipt for a captured Create-to-Patch contract drift', () => {
  const { root, target, records } = fixture();
  const before = `- [ ] E-fixture: Create only \`${target}\`, then patch only \`package.json\`:\n  Route: implementation.\n  Depends on: <none>.\n  Completion condition: complete.\n  Forbidden changes: none.\n  Verification: run \`node --test\`.\n`;
  const after = before.replace(`Create only \`${target}\`, then patch only \`package.json\``, `Patch only \`package.json\`, then patch only \`${target}\``);
  fs.mkdirSync(path.join(root, '.brownie'), { recursive: true });
  fs.mkdirSync(path.join(root, '.brownie/private/phase-loop/todo-claims/contract-rebaselines'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, '.brownie/todo.md'), before);
  fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'Dependency graph:\n');
  fs.writeFileSync(path.join(root, 'scripts/guard-todo-decomposition.mjs'), 'process.exit(0);\n');
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['add', '.brownie/todo.md', '.brownie/todo-breakdown.md'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=Brownie', '-c', 'user.email=brownie@example.invalid', 'commit', '-m', 'baseline'], { cwd: root, stdio: 'ignore' });
  fs.writeFileSync(path.join(root, '.brownie/todo.md'), after);
  fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/contract-rebaselines/capture.json'), `${JSON.stringify(records[0])}\n`);
  const result = admitMaterializedScopeRebaseline({
    repoRoot: root,
    baselineRef: 'HEAD',
    todoId: 'E-fixture',
    runStamp: 'fixture-run',
    eventKey: 'fixture-event',
    diagnostic: 'fixture recovery'
  });
  assert.equal(result.applied, true);
  assert.equal(result.target_snapshots[0].path, target);
  assert.equal(fs.existsSync(path.join(root, result.receipt_path)), true);
});

function gitMergedMaterializationFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-git-materialization-'));
  const id = 'E-fixture';
  const target = 'scripts/journey.mjs';
  const baseTodo = `- [ ] ${id}: Create only \`${target}\`:\n  Route: implementation.\n  Source TODO: E-parent.\n  Depends on: <none>.\n  Completion condition: the bounded implementation is complete and independently verified.\n  Forbidden changes: do not edit unrelated release evidence files.\n  Verification: run \`pnpm --workspace-root guard:release-contract:test\`.\n`;
  fs.mkdirSync(path.join(root, '.brownie'), { recursive: true });
  fs.writeFileSync(path.join(root, '.brownie/todo.md'), baseTodo);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Brownie'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'brownie@example.invalid'], { cwd: root });
  execFileSync('git', ['add', '.brownie/todo.md'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: root });
  execFileSync('git', ['checkout', '-qb', 'implementation'], { cwd: root });
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.writeFileSync(path.join(root, target), 'export const journey = true;\n');
  execFileSync('git', ['add', target], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'implement fixture TODO E-fixture'], { cwd: root });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  execFileSync('git', ['checkout', '-q', 'main'], { cwd: root });
  execFileSync('git', ['merge', '--no-ff', '-qm', 'merge implementation', 'implementation'], { cwd: root });
  const merge = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const blob = execFileSync('git', ['rev-parse', `HEAD:${target}`], { cwd: root, encoding: 'utf8' }).trim();
  const receipt = `  Materialization receipt: Git merged Create-to-Patch v1; TODO ${id}; PR #123; merge commit ${merge}; PR head ${head}; targets \`${target}@${blob}\`.\n`;
  fs.writeFileSync(path.join(root, '.brownie/todo.md'), baseTodo.replace(`Create only \`${target}\``, `Patch only \`${target}\``) + receipt);
  execFileSync('git', ['checkout', '-qb', 'followup'], { cwd: root });
  fs.writeFileSync(path.join(root, 'followup.txt'), 'followup\n');
  execFileSync('git', ['add', 'followup.txt'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'followup'], { cwd: root });
  const followupHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  execFileSync('git', ['checkout', '-q', 'main'], { cwd: root });
  fs.writeFileSync(path.join(root, 'main.txt'), 'main advance\n');
  execFileSync('git', ['add', 'main.txt'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'advance main'], { cwd: root });
  execFileSync('git', ['merge', '--no-ff', '-qm', 'merge followup', 'followup'], { cwd: root });
  const laterMerge = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  return { root, id, target, merge, head, blob, laterMerge, followupHead };
}

test('admits a public Git-merged Create-to-Patch receipt only for the exact target and TODO', () => {
  const { root, id, target } = gitMergedMaterializationFixture();
  const records = readGitMaterializedScopeRebaselineRecords(root);
  assert.equal(records.length, 1);
  assert.equal(records[0].target_todo_ids[0], id);
  assert.equal(records[0].contract_changes[0].before_contract.first_line.includes(`Create only \`${target}\``), true);
  const text = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
  assert.deepEqual(validateTodoDecompositionText(text, {
    repoRoot: root,
    packageScripts: new Set(['guard:release-contract:test'])
  }), []);
});

test('rejects a Git materialization receipt when parent presence, digest, or TODO binding is wrong', () => {
  const { root, target, merge, head, blob, laterMerge, followupHead } = gitMergedMaterializationFixture();
  const todoPath = path.join(root, '.brownie/todo.md');
  const original = fs.readFileSync(todoPath, 'utf8');
  fs.writeFileSync(todoPath, original.replace(`merge commit ${merge}; PR head ${head}`, `merge commit ${laterMerge}; PR head ${followupHead}`));
  assert.throws(() => readGitMaterializedScopeRebaselineRecords(root), /exists in merge first parent/u);
  fs.writeFileSync(todoPath, original.replace(`PR head ${head}`, `PR head ${merge}`));
  assert.throws(() => readGitMaterializedScopeRebaselineRecords(root), /not the merged implementation parent/u);
  fs.writeFileSync(todoPath, original.replace(blob, '0000000000000000000000000000000000000000'));
  assert.throws(() => readGitMaterializedScopeRebaselineRecords(root), /digest mismatch/u);
  fs.writeFileSync(todoPath, original.replace('TODO E-fixture', 'TODO E-other'));
  assert.throws(() => readGitMaterializedScopeRebaselineRecords(root), /TODO binding mismatch/u);
  // Keep the fixture target referenced above so a future parser cannot ignore
  // an otherwise valid target list while accepting a mismatched binding.
  assert.equal(fs.existsSync(path.join(root, target)), true);
});
