import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

import {
  buildPlanForTarget,
  createPortableArchive,
  sourceCleanTreeState,
  releaseArtifactBuildTimeoutMs,
  releaseArtifactSetupTimeoutMs,
  releaseArtifactSmokeTimeoutMs,
  releaseArtifactSmokeArgs
} from './release-local-artifact.mjs';

test('source provenance uses literal clean and dirty checkout states', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-source-provenance-test-'));
  const git = (args) => assert.equal(spawnSync('git', args, { cwd: repoRoot }).status, 0);
  fs.writeFileSync(path.join(repoRoot, 'tracked.txt'), 'before\n');
  git(['init', '--quiet']);
  git(['add', 'tracked.txt']);
  git(['-c', 'user.name=Brownie Test', '-c', 'user.email=brownie-test@example.invalid', 'commit', '--quiet', '-m', 'fixture']);
  assert.equal(sourceCleanTreeState(repoRoot), 'clean');
  fs.writeFileSync(path.join(repoRoot, 'tracked.txt'), 'after\n');
  assert.equal(sourceCleanTreeState(repoRoot), 'dirty');
});

test('portable archive contains relocatable evidence and executable payloads', () => {
  const outFull = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-release-archive-test-'));
  const entries = ['brownie', 'brownie-runtime', 'SHA256SUMS', 'artifact-evidence.json', 'smoke-evidence.json'];
  fs.writeFileSync(path.join(outFull, 'brownie'), 'cli');
  fs.writeFileSync(path.join(outFull, 'brownie-runtime'), 'runtime');
  fs.chmodSync(path.join(outFull, 'brownie'), 0o755);
  fs.chmodSync(path.join(outFull, 'brownie-runtime'), 0o755);
  const digest = (name) => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(path.join(outFull, name))).digest('hex')}`;
  fs.writeFileSync(path.join(outFull, 'SHA256SUMS'), 'stale  .brownie/release-evidence/artifacts/darwin-arm64/brownie\n');
  fs.writeFileSync(path.join(outFull, 'artifact-evidence.json'), JSON.stringify({ artifact: { path: 'old', sha256: digest('brownie') }, runtime_companion: { path: 'old-runtime', sha256: digest('brownie-runtime') } }));
  fs.writeFileSync(path.join(outFull, 'smoke-evidence.json'), JSON.stringify({ artifact_path: 'old' }));
  const archive = createPortableArchive({ outFull, target: 'darwin-arm64', entries });
  assert.ok(fs.existsSync(archive.path));
  const extracted = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-release-extract-test-'));
  if (process.platform === 'win32') {
    assert.equal(spawnSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archive.path.replace(/'/g, "''")}' -DestinationPath '${extracted.replace(/'/g, "''")}' -Force`]).status, 0);
  } else {
    assert.equal(spawnSync('tar', ['-xzf', archive.path, '-C', extracted]).status, 0);
  }
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(extracted, 'brownie')).mode & 0o111, 0o111);
    assert.equal(fs.statSync(path.join(extracted, 'brownie-runtime')).mode & 0o111, 0o111);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(extracted, 'artifact-evidence.json'))).artifact.path, 'brownie');
  assert.equal(JSON.parse(fs.readFileSync(path.join(extracted, 'smoke-evidence.json'))).artifact_path, 'brownie');
  const sums = Object.fromEntries(fs.readFileSync(path.join(extracted, 'SHA256SUMS'), 'utf8').trim().split('\n').map((line) => line.split(/  /u).reverse()));
  assert.equal(sums.brownie, digest('brownie').replace('sha256:', ''));
  assert.equal(sums['brownie-runtime'], digest('brownie-runtime').replace('sha256:', ''));
});

test('release build and toolchain setup have CI-safe time budgets', () => {
  assert(releaseArtifactBuildTimeoutMs >= 10 * 60_000);
  assert(releaseArtifactSetupTimeoutMs >= 5 * 60_000);
  assert(releaseArtifactSmokeTimeoutMs >= 60_000);
});

test('release artifact build contains the CLI and its Runtime companion', () => {
  const platform = process.platform === 'win32' ? 'win32' : process.platform;
  const arch = process.arch === 'x64' ? 'x64' : process.arch;
  const plan = buildPlanForTarget(`${platform}-${arch}`);
  assert.match(plan.sourceArtifact, /brownie(?:\.exe)?$/u);
  assert.match(plan.sourceRuntime, /brownie-runtime(?:\.exe)?$/u);
  assert(plan.buildArgs.includes('brownie-cli'));
  assert(plan.buildArgs.includes('brownie-runtime'));
});

test('release artifact smoke invokes only current CLI surfaces', () => {
  assert.deepEqual(releaseArtifactSmokeArgs, [
    ['--version'],
    ['help', 'run'],
    ['--json', 'status'],
    ['--json', 'mode', 'list'],
    ['help', 'resume']
  ]);
  const serialized = JSON.stringify(releaseArtifactSmokeArgs);
  assert.doesNotMatch(serialized, /task.*run|ledger.*generate|stop/u);
});

test('release artifact smoke commands are independently safe to probe', () => {
  for (const args of releaseArtifactSmokeArgs) {
    if (args.includes('run') || args.includes('resume')) {
      assert.equal(args[0], 'help');
    }
  }
});
