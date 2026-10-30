import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { inspectWorkspaceBaseline } from './phase-loop-workspace-baseline-guard.mjs';

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function makeRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-workspace-baseline-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'Brownie test']);
  git(root, ['config', 'user.email', 'brownie@example.invalid']);
  fs.writeFileSync(path.join(root, 'README.md'), 'baseline\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'baseline']);
  git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  return root;
}

function createTreeEquivalentDivergence(root) {
  const baseHead = git(root, ['rev-parse', 'HEAD']);
  git(root, ['checkout', '-qb', 'tree-equivalent-worker']);
  fs.writeFileSync(path.join(root, 'tree-equivalent.txt'), 'identical tracked content\n');
  git(root, ['add', 'tree-equivalent.txt']);
  git(root, ['commit', '-qm', 'worker content commit']);

  git(root, ['checkout', '-qB', 'approved', baseHead]);
  fs.writeFileSync(path.join(root, 'tree-equivalent.txt'), 'identical tracked content\n');
  git(root, ['add', 'tree-equivalent.txt']);
  git(root, ['commit', '-qm', 'approved squash-equivalent commit']);
  const approvedHead = git(root, ['rev-parse', 'HEAD']);
  git(root, ['update-ref', 'refs/remotes/origin/main', approvedHead]);
  git(root, ['checkout', '-q', 'tree-equivalent-worker']);
  return approvedHead;
}

test('accepts a workspace whose HEAD contains approved origin/main', () => {
  const root = makeRepository();
  fs.writeFileSync(path.join(root, 'README.md'), 'baseline\nnew work\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'new work']);
  const result = inspectWorkspaceBaseline({ workspaceRoot: root, refreshBaseline: false });
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.baseline_is_ancestor, true);
});

test('fails closed when workspace HEAD predates approved origin/main', () => {
  const root = makeRepository();
  const oldHead = git(root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(root, 'README.md'), 'baseline\nmain advance\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'main advance']);
  git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  git(root, ['checkout', '-q', '--detach', oldHead]);
  const result = inspectWorkspaceBaseline({ workspaceRoot: root, refreshBaseline: false });
  assert.equal(result.ok, false);
  assert.equal(result.baseline_is_ancestor, false);
  assert(result.errors.some((error) => error.includes('snapshot and explicitly rebaseline the workspace before claim')));
});

test('accepts a divergent squash-equivalent workspace tree while reporting the non-ancestor relationship', () => {
  const root = makeRepository();
  const approvedHead = createTreeEquivalentDivergence(root);
  const result = inspectWorkspaceBaseline({ workspaceRoot: root, refreshBaseline: false });
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.baseline_is_ancestor, false);
  assert.equal(result.baseline_tree_equivalent, true);
  assert.equal(result.baseline_commit, approvedHead);
  assert.equal(result.workspace_tree, result.baseline_tree);
});

test('fails closed when the workspace baseline cannot be resolved', () => {
  const root = makeRepository();
  git(root, ['update-ref', '-d', 'refs/remotes/origin/main']);
  const result = inspectWorkspaceBaseline({ workspaceRoot: root, refreshBaseline: false });
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('workspace baseline origin/main could not be resolved')));
});
