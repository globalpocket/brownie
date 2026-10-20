import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { inspectControlPlaneSource } from './phase-loop-control-plane-guard.mjs';
import { approvedControllerSourcePaths, controllerSourceManifestPath } from './phase-loop-source-baseline-guard.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function makeRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-control-plane-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'Brownie control-plane test']);
  git(root, ['config', 'user.email', 'brownie@example.invalid']);
  for (const relativePath of approvedControllerSourcePaths) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `baseline source: ${relativePath}\n`);
  }
  fs.copyFileSync(path.join(repositoryRoot, controllerSourceManifestPath), path.join(root, controllerSourceManifestPath));
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'approved controller baseline']);
  git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  return root;
}

test('accepts every manifest-listed control-plane script at the approved baseline', () => {
  const repo = makeRepository();
  const result = inspectControlPlaneSource({ repoRoot: repo, baselineRef: 'origin/main' });
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.match(result.source_fingerprint, /^sha256:[0-9a-f]{64}$/u);
  assert(result.files.length > 0);
});

test('fails closed when a manifest-listed control-plane script diverges', () => {
  const repo = makeRepository();
  const target = path.join(repo, 'scripts/phase-loop-preflight.mjs');
  fs.appendFileSync(target, 'workspace fallback must never be trusted\n');
  const result = inspectControlPlaneSource({ repoRoot: repo, baselineRef: 'origin/main' });
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('scripts/phase-loop-preflight.mjs control-plane source diverges')), JSON.stringify(result));
  const cli = spawnSync(process.execPath, [
    path.join(repositoryRoot, 'scripts/phase-loop-control-plane-guard.mjs'),
    '--repo', repo,
    '--baseline-ref', 'origin/main'
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 78, cli.stderr);
});

test('fails closed when a control-plane path is absent from the approved baseline', () => {
  const repo = makeRepository();
  const manifestPath = path.join(repo, controllerSourceManifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.control_plane_paths = [...manifest.control_plane_paths, 'scripts/missing-control-plane.mjs'].sort();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const result = inspectControlPlaneSource({ repoRoot: repo, baselineRef: 'origin/main' });
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('missing-control-plane.mjs')), JSON.stringify(result));
});

test('controller routes control-plane execution through ROOT_DIR and never workspace scripts', () => {
  const controller = fs.readFileSync(path.join(repositoryRoot, 'phase-loop.sh'), 'utf8');
  const preflight = controller.indexOf('run_phase_loop_preflight()');
  const rebaseline = controller.indexOf('phase_loop_rebaseline_stale_claim "$run_stamp"');
  const boundary = controller.indexOf('run_phase_loop_preflight "$run_stamp" "pre-claim-boundary"');
  assert.match(controller, /node "\$ROOT_DIR\/scripts\/phase-loop-preflight\.mjs"/u);
  assert.doesNotMatch(controller.slice(preflight, rebaseline), /node scripts\/phase-loop-preflight\.mjs/u);
  assert.doesNotMatch(controller.slice(preflight, rebaseline), /PHASE_LOOP_WORKSPACE_ROOT\/scripts\/phase-loop-preflight\.mjs/u);
  assert.doesNotMatch(controller, /node\s+[^\n]*PHASE_LOOP_WORKSPACE_ROOT\/scripts\/(?:phase-loop|guard-|repair-)/u);
  assert.match(controller, /node "\$control_plane_guard" --repo "\$ROOT_DIR" --baseline-ref/u);
  assert.ok(boundary > preflight);
});
