import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { diagnoseDeliveryReconciliation, reconcileDelivery } from './phase-loop-delivery-reconcile.mjs';

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fixture() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-delivery-reconcile-'));
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.name', 'brownie-agent']);
  git(repo, ['config', 'user.email', 'brownie-agent@local']);
  fs.writeFileSync(path.join(repo, '.gitignore'), '.brownie/private/\n');
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'base\n');
  fs.writeFileSync(path.join(repo, 'clean-target-change.txt'), 'base\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'base']);
  const base = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['switch', '-c', 'delivery']);
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'delivery-v1\n');
  fs.writeFileSync(path.join(repo, 'created.txt'), 'created-v1\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'delivery v1']);
  const v1 = git(repo, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'delivery-v2\n');
  fs.writeFileSync(path.join(repo, 'created.txt'), 'created-v2\n');
  fs.writeFileSync(path.join(repo, 'clean-target-change.txt'), 'target\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'delivery v2']);
  const target = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['branch', 'target', target]);
  git(repo, ['switch', '-C', 'workspace', base]);
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'delivery-v1\n');
  fs.writeFileSync(path.join(repo, 'created.txt'), 'created-v1\n');
  return { repo, base, v1, target };
}

test('reconciles only local blobs already present in target delivery history', () => {
  const { repo, target } = fixture();
  const diagnosis = diagnoseDeliveryReconciliation({ repoRoot: repo, target: 'target' });
  assert.equal(diagnosis.safe_to_reconcile, true, JSON.stringify(diagnosis, null, 2));
  assert(diagnosis.files.every((file) => file.classification === 'known_delivery_history'));
  const result = reconcileDelivery({ repoRoot: repo, target: 'target', write: true });
  assert.equal(result.applied, true);
  assert.equal(result.clean, true);
  assert.equal(git(repo, ['rev-parse', 'HEAD']), target);
  assert.equal(fs.readFileSync(path.join(repo, 'tracked.txt'), 'utf8'), 'delivery-v2\n');
  assert.equal(fs.readFileSync(path.join(repo, 'created.txt'), 'utf8'), 'created-v2\n');
  assert(fs.existsSync(path.join(repo, result.receipt_path)));
});

test('refuses unrelated local content without changing HEAD or files', () => {
  const { repo, base } = fixture();
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'user-owned\n');
  const result = reconcileDelivery({ repoRoot: repo, target: 'target', write: true });
  assert.equal(result.applied, false);
  assert.equal(result.safe_to_reconcile, false);
  assert(result.blockers.some((blocker) => blocker.code === 'unrelated_local_change'));
  assert.equal(git(repo, ['rev-parse', 'HEAD']), base);
  assert.equal(fs.readFileSync(path.join(repo, 'tracked.txt'), 'utf8'), 'user-owned\n');
});

test('recognizes working files already identical to the merge tree', () => {
  const { repo } = fixture();
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'delivery-v2\n');
  fs.writeFileSync(path.join(repo, 'created.txt'), 'created-v2\n');
  const diagnosis = diagnoseDeliveryReconciliation({ repoRoot: repo, target: 'target' });
  assert.equal(diagnosis.safe_to_reconcile, true);
  assert(diagnosis.files.every((file) => ['merged_identical', 'known_delivery_history'].includes(file.classification)));
});

test('refuses staged content even when the worktree happens to match the target', () => {
  const { repo, base } = fixture();
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'user-staged\n');
  git(repo, ['add', 'tracked.txt']);
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'delivery-v2\n');
  const result = reconcileDelivery({ repoRoot: repo, target: 'target', write: true });
  assert.equal(result.safe_to_reconcile, false);
  assert.equal(git(repo, ['rev-parse', 'HEAD']), base);
  assert.equal(git(repo, ['show', ':tracked.txt']), 'user-staged');
});

test('updates clean paths changed by the target during reconciliation', () => {
  const { repo, target } = fixture();
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'delivery-v1\n');
  fs.writeFileSync(path.join(repo, 'created.txt'), 'created-v1\n');
  const result = reconcileDelivery({ repoRoot: repo, target: 'target', write: true });
  assert.equal(result.applied, true);
  assert.equal(git(repo, ['rev-parse', 'HEAD']), target);
  assert.equal(fs.readFileSync(path.join(repo, 'clean-target-change.txt'), 'utf8'), 'target\n');
});

test('does not accept a blob that existed only before the delivered range', () => {
  const { repo, base } = fixture();
  fs.writeFileSync(path.join(repo, 'created.txt'), 'base\n');
  const result = reconcileDelivery({ repoRoot: repo, target: 'target', write: true });
  assert.equal(result.safe_to_reconcile, false);
  assert.equal(git(repo, ['rev-parse', 'HEAD']), base);
  assert.equal(fs.readFileSync(path.join(repo, 'created.txt'), 'utf8'), 'base\n');
});

test('receives a clean squash-equivalent delivery without overwriting the worktree', () => {
  const { repo, base, target } = fixture();
  git(repo, ['branch', 'delivery-tip', target]);
  git(repo, ['switch', '-C', 'squash-target', base]);
  git(repo, ['checkout', 'delivery-tip', '--', '.']);
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'squash delivery']);
  const squashTarget = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['switch', 'delivery-tip']);
  const diagnosis = diagnoseDeliveryReconciliation({ repoRoot: repo, target: squashTarget });
  assert.equal(diagnosis.head_is_ancestor, false);
  assert.equal(diagnosis.head_tree_matches_target, true);
  assert.equal(diagnosis.safe_to_reconcile, true);
  const result = reconcileDelivery({ repoRoot: repo, target: squashTarget, write: true });
  assert.equal(result.applied, true);
  assert.equal(result.reconciliation_mode, 'squash_equivalent');
  assert.equal(git(repo, ['rev-parse', 'HEAD']), squashTarget);
  assert.equal(git(repo, ['status', '--porcelain']), '');
});

test('refuses a squash-equivalent delivery when the workspace is not clean', () => {
  const { repo, base, target } = fixture();
  git(repo, ['branch', 'delivery-tip', target]);
  git(repo, ['switch', '-C', 'squash-target', base]);
  git(repo, ['checkout', 'delivery-tip', '--', '.']);
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'squash delivery']);
  const squashTarget = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['switch', 'delivery-tip']);
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'user-owned\n');
  const result = reconcileDelivery({ repoRoot: repo, target: squashTarget, write: true });
  assert.equal(result.safe_to_reconcile, false);
  assert(result.blockers.some((blocker) => blocker.code === 'squash_target_requires_clean_workspace'));
  assert.equal(fs.readFileSync(path.join(repo, 'tracked.txt'), 'utf8'), 'user-owned\n');
});
