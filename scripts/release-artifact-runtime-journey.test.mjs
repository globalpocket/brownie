import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { runReleaseArtifactRuntimeJourney } from './release-artifact-runtime-journey.mjs';

function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function writeExecutable(filePath, source) {
  fs.writeFileSync(filePath, source);
  fs.chmodSync(filePath, 0o755);
}

function createFixtureArchive(root) {
  const packageRoot = path.join(root, 'package');
  fs.mkdirSync(packageRoot, { recursive: true });
  const runtimePath = path.join(packageRoot, 'brownie-runtime');
  const cliPath = path.join(packageRoot, 'brownie');
  writeExecutable(runtimePath, '#!/usr/bin/env node\nprocess.exit(0);\n');
  writeExecutable(cliPath, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.BROWNIE_WORKSPACE_ROOT;
const args = process.argv.slice(2).filter((value) => value !== '--json');
const write = (value) => process.stdout.write(JSON.stringify(value));
if (args[0] === 'mode' && args[1] === 'list') {
  write({ ok: true, mode_list: { modes: [{ mode_id: 'fixture', display_name: 'Fixture' }] } });
  process.exit(0);
}
if (args[0] === 'run') {
  const runId = 'run-fixture';
  fs.mkdirSync(path.join(root, '.brownie', 'runs', runId), { recursive: true });
  fs.writeFileSync(path.join(root, '.brownie', 'runs', runId, 'ledger.jsonl'), '{"event":"fixture"}\\n');
  fs.writeFileSync(path.join(root, '.brownie', 'journey-marker.json'), '{"state":"interrupted"}\\n');
  write({ ok: true, run: { session_id: 'session-fixture', journey_id: 'journey-fixture', task_id: 'task-fixture', run_id: runId, automation: { controller_action: 'resume', continuation_required: true, stop_reason: 'fixture_interruption' } } });
  process.exit(0);
}
if (args[0] === 'resume') {
  write({ ok: true, resume: { status: 'no_eligible_task', controller_action: 'stop' } });
  process.exit(0);
}
process.exit(64);
`);
  const artifact = { schema_version: 1, target: 'linux-x64', artifact: { path: 'brownie', sha256: sha256File(cliPath) }, runtime_companion: { path: 'brownie-runtime', sha256: sha256File(runtimePath) } };
  fs.writeFileSync(path.join(packageRoot, 'artifact-evidence.json'), `${JSON.stringify(artifact)}\n`);
  fs.writeFileSync(path.join(packageRoot, 'SHA256SUMS'), `${artifact.artifact.sha256.slice(7)}  brownie\n${artifact.runtime_companion.sha256.slice(7)}  brownie-runtime\n`);
  const archivePath = path.join(root, 'brownie-linux-x64.tar.gz');
  const archive = spawnSync('tar', ['-czf', archivePath, '-C', packageRoot, 'brownie', 'brownie-runtime', 'artifact-evidence.json', 'SHA256SUMS'], { encoding: 'utf8' });
  assert.equal(archive.status, 0, archive.stderr);
  return archivePath;
}

test('journey executes only the packaged fixture and records durable interruption, resume, and replay evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-runtime-journey-fixture-'));
  const evidencePath = path.join(root, 'evidence.json');
  const evidence = runReleaseArtifactRuntimeJourney({
    targetId: 'linux-x64',
    archivePath: createFixtureArchive(root),
    workspaceRoot: path.join(root, 'workspace'),
    evidencePath
  });
  assert.equal(evidence.checks.mode_pack_load.passed, true);
  assert.equal(evidence.checks.workspace_mutation.passed, true);
  assert.equal(evidence.checks.ledger_generation.passed, true);
  assert.equal(evidence.checks.forced_interruption.stop_reason, 'fixture_interruption');
  assert.equal(evidence.checks.resume.status, 'no_eligible_task');
  assert.equal(evidence.checks.stale_replay_rejection.workspace_unchanged, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(evidencePath, 'utf8')), evidence);
});

test('journey rejects a package whose signed runtime binding was tampered', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-runtime-journey-tamper-'));
  const archivePath = createFixtureArchive(root);
  const unpacked = path.join(root, 'unpacked');
  fs.mkdirSync(unpacked);
  assert.equal(spawnSync('tar', ['-xzf', archivePath, '-C', unpacked], { encoding: 'utf8' }).status, 0);
  fs.appendFileSync(path.join(unpacked, 'brownie-runtime'), 'tamper\n');
  assert.equal(spawnSync('tar', ['-czf', archivePath, '-C', unpacked, 'brownie', 'brownie-runtime', 'artifact-evidence.json', 'SHA256SUMS'], { encoding: 'utf8' }).status, 0);
  assert.throws(
    () => runReleaseArtifactRuntimeJourney({ targetId: 'linux-x64', archivePath, workspaceRoot: path.join(root, 'workspace') }),
    /package integrity mismatch/u
  );
});

test('journey rejects a package whose signed CLI binding was tampered', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-runtime-journey-tamper-'));
  const archivePath = createFixtureArchive(root);
  const unpacked = path.join(root, 'unpacked');
  fs.mkdirSync(unpacked);
  assert.equal(spawnSync('tar', ['-xzf', archivePath, '-C', unpacked], { encoding: 'utf8' }).status, 0);
  fs.appendFileSync(path.join(unpacked, 'brownie'), 'tamper\n');
  assert.equal(spawnSync('tar', ['-czf', archivePath, '-C', unpacked, 'brownie', 'brownie-runtime', 'artifact-evidence.json', 'SHA256SUMS'], { encoding: 'utf8' }).status, 0);
  assert.throws(
    () => runReleaseArtifactRuntimeJourney({ targetId: 'linux-x64', archivePath, workspaceRoot: path.join(root, 'workspace') }),
    /package integrity mismatch/u
  );
});
