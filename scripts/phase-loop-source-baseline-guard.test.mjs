import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  approvedControllerSourcePaths,
  controllerSourceReadMaxBufferBytes,
  controllerSourceManifestPath,
  guardPhaseLoopSourceBaseline
} from './phase-loop-source-baseline-guard.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function makeRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-source-baseline-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'Brownie test']);
  git(root, ['config', 'user.email', 'brownie@example.invalid']);
  for (const relativePath of approvedControllerSourcePaths) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `baseline source: ${relativePath}\n`);
  }
  fs.copyFileSync(
    path.join(repositoryRoot, controllerSourceManifestPath),
    path.join(root, controllerSourceManifestPath)
  );
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'approved controller baseline']);
  git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  return root;
}

test('accepts controller source matching approved origin/main baseline', () => {
  const root = makeRepository();
  const result = guardPhaseLoopSourceBaseline({ repoRoot: root, refreshBaseline: false });
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.files.every((file) => file.matches), true);
  assert.match(result.source_fingerprint, /^sha256:[0-9a-f]{64}$/u);
});

test('accepts an approved controller source larger than Node child-process default output buffer', () => {
  const root = makeRepository();
  // Node's default maxBuffer is 1 MiB.  The real controller can legitimately
  // exceed it, while the guard must still compare the exact baseline bytes.
  const controller = path.join(root, 'phase-loop.sh');
  fs.writeFileSync(controller, 'controller source\n'.repeat(70_000));
  assert(fs.statSync(controller).size > 1024 * 1024);
  assert(fs.statSync(controller).size < controllerSourceReadMaxBufferBytes);
  git(root, ['add', 'phase-loop.sh']);
  git(root, ['commit', '-qm', 'large approved controller baseline']);
  git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);

  const result = guardPhaseLoopSourceBaseline({ repoRoot: root, refreshBaseline: false });
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.files.find((file) => file.relative_path === 'phase-loop.sh')?.matches, true);
});

test('fails closed when a controller source diverges from approved origin/main', () => {
  const root = makeRepository();
  fs.appendFileSync(path.join(root, 'phase-loop.sh'), 'stale controller change\n');
  const result = guardPhaseLoopSourceBaseline({ repoRoot: root, refreshBaseline: false });
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('phase-loop.sh diverges from approved controller baseline origin/main')));
});

test('fails closed when approved origin/main baseline is unavailable', () => {
  const root = makeRepository();
  git(root, ['update-ref', '-d', 'refs/remotes/origin/main']);
  const result = guardPhaseLoopSourceBaseline({ repoRoot: root, refreshBaseline: false });
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('approved controller baseline origin/main could not be resolved')));
});

test('refreshes a stale origin/main ref before comparing controller sources', () => {
  const root = makeRepository();
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-source-baseline-remote-'));
  const remoteWorking = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-source-baseline-remote-work-'));
  git(remote, ['init', '--bare', '-q']);
  git(remoteWorking, ['init', '-q']);
  git(remoteWorking, ['config', 'user.name', 'Brownie remote test']);
  git(remoteWorking, ['config', 'user.email', 'brownie-remote@example.invalid']);
  for (const relativePath of approvedControllerSourcePaths) {
    const target = path.join(remoteWorking, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `remote baseline: ${relativePath}\n`);
  }
  fs.copyFileSync(
    path.join(repositoryRoot, controllerSourceManifestPath),
    path.join(remoteWorking, controllerSourceManifestPath)
  );
  git(remoteWorking, ['add', '.']);
  git(remoteWorking, ['commit', '-qm', 'new approved controller baseline']);
  const remoteCommit = git(remoteWorking, ['rev-parse', 'HEAD']);
  git(remoteWorking, ['remote', 'add', 'origin', remote]);
  git(remoteWorking, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);
  git(root, ['remote', 'add', 'origin', remote]);

  const result = guardPhaseLoopSourceBaseline({ repoRoot: root });
  assert.equal(result.baseline_refresh.refreshed, true, JSON.stringify(result, null, 2));
  assert.equal(result.baseline_commit, remoteCommit);
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('phase-loop.sh diverges from approved controller baseline origin/main')));
});

test('manifest coverage detects an executed preflight module divergence', () => {
  const root = makeRepository();
  fs.appendFileSync(path.join(root, 'scripts/phase-loop-preflight.mjs'), 'stale preflight controller change\n');
  const result = guardPhaseLoopSourceBaseline({ repoRoot: root, refreshBaseline: false });
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('scripts/phase-loop-preflight.mjs diverges from approved controller baseline origin/main')));
});

test('phase-loop refuses to enter a Brownie run before the source baseline guard passes', () => {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const controller = fs.readFileSync(path.join(repositoryRoot, 'phase-loop.sh'), 'utf8');
  const guardIndex = controller.indexOf('phase_loop_require_approved_controller_baseline');
  const runIndex = controller.indexOf('write_status "running" "Brownie run started');
  assert(guardIndex >= 0);
  assert(runIndex > guardIndex);
  assert.match(controller, /local guard_script="\$ROOT_DIR\/scripts\/phase-loop-source-baseline-guard\.mjs"/u);
  assert.match(controller, /node "\$guard_script" --repo "\$ROOT_DIR"/u);
  assert.doesNotMatch(controller, /local guard_script="\$PHASE_LOOP_WORKSPACE_ROOT\/scripts\/phase-loop-source-baseline-guard/u);
  assert.match(controller, /phase-loop-workspace-control-parity-guard\.mjs/u);
  assert.match(controller, /--control-root "\$ROOT_DIR" --workspace-root "\$PHASE_LOOP_WORKSPACE_ROOT"/u);
  assert.match(controller, /phase-loop-workspace-baseline-guard\.mjs/u);
  assert.match(controller, /--workspace-root "\$PHASE_LOOP_WORKSPACE_ROOT" --baseline-ref "\$PHASE_LOOP_APPROVED_CONTROLLER_BASELINE"/u);
});

test('phase-loop stages the materialized-scope publication contract before committing a PR', () => {
  const controller = fs.readFileSync(path.join(repositoryRoot, 'phase-loop.sh'), 'utf8');
  const stageIndex = controller.indexOf('stage_runtime_applied_paths "$stdout_log"');
  const publicationGuardIndex = controller.indexOf('if ! phase_loop_require_materialized_scope_publication');
  const commitIndex = controller.indexOf('git commit -m "$title"');
  assert(stageIndex >= 0);
  assert(publicationGuardIndex > stageIndex);
  assert(commitIndex > publicationGuardIndex);
  assert.match(controller, /staged_workspace_diff_exists\(\)/u);
  assert.match(controller, /\[ "\$workspace_before" = "\$workspace_after" \] && ! staged_workspace_diff_exists/u);
  assert.match(controller, /scripts\/phase-loop-materialized-scope-publication-guard\.mjs/u);
  assert.match(controller, /pr_create_skipped reason=materialized_scope_publication_guard_failed/u);
});
