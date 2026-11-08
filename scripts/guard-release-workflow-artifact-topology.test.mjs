import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateRuntimeOperationalEvidence } from './guard-runtime-operational-evidence.mjs';
import { runReleaseWorkflowArtifactTopologyGuard } from './guard-release-workflow-artifact-topology.mjs';
import { buildRuntimeOperationalEvidence } from './release-runtime-operational-evidence.mjs';

const workflowPath = path.join(process.cwd(), '.github/workflows/release.yml');

function sha256(contents) {
  return `sha256:${crypto.createHash('sha256').update(contents).digest('hex')}`;
}

function writeDownloadedArtifactFixture(repoRoot, target) {
  const downloadRoot = path.join(repoRoot, 'roundtrip-download');
  const uploadedEvidence = path.join(downloadRoot, '.brownie', 'release-evidence', 'artifacts', target);
  fs.mkdirSync(uploadedEvidence, { recursive: true });
  const write = (name, contents) => {
    fs.writeFileSync(path.join(uploadedEvidence, name), contents);
    return sha256(contents);
  };
  const binarySha256 = write('brownie', 'uploaded packaged cli');
  const runtimeSha256 = write('brownie-runtime', 'uploaded runtime companion');
  const archiveSha256 = write('brownie-linux-x64.tar.gz', 'uploaded archive');
  const commit = 'd'.repeat(40);
  const workflowRunId = 'workflow-artifact-topology-123';
  const artifact = { archive_sha256: archiveSha256, artifact_sha256: binarySha256, runtime_sha256: runtimeSha256 };
  const evidenceDirectory = `.brownie/release-evidence/artifacts/${target}`;
  fs.writeFileSync(path.join(uploadedEvidence, 'artifact-evidence.json'), JSON.stringify({
    target,
    platform: 'linux',
    arch: 'x64',
    archive: { path: `${evidenceDirectory}/brownie-linux-x64.tar.gz`, sha256: archiveSha256 },
    artifact: {
      path: `${evidenceDirectory}/brownie`, target, sha256: binarySha256,
      source_commit: `sha256:${commit}`, source_clean_tree: 'clean', source_identity: `sha256:${'e'.repeat(64)}`
    },
    runtime_companion: { path: `${evidenceDirectory}/brownie-runtime`, sha256: runtimeSha256 }
  }));
  const journeyChecks = Object.fromEntries(['mode_pack_load', 'workspace_mutation', 'ledger_generation', 'forced_interruption', 'resume', 'stale_replay_rejection'].map((id) => [id, { passed: true }]));
  const soakChecks = Object.fromEntries(['artifact_execution_boundary', 'process_loss_recovery', 'duplicate_side_effect_rejection', 'ledger_workspace_consistency', 'resume_replay_behavior', 'finite_convergence', 'evidence_chain_integrity'].map((id) => [id, { passed: true }]));
  soakChecks.artifact_execution_boundary = { passed: true, packaged_cli_only: true, isolated_workspace_cwd: true, runtime_path_override_removed: true };
  soakChecks.finite_convergence = { passed: true, commands_executed: 3, maximum_commands: 3 };
  fs.writeFileSync(path.join(downloadRoot, 'runtime-journey-evidence.json'), JSON.stringify({ evidence_id: 'brownie-release-artifact-runtime-journey-v1', target, workflow_run_id: workflowRunId, artifact, checks: journeyChecks }));
  fs.writeFileSync(path.join(downloadRoot, 'runtime-stateful-soak-evidence.json'), JSON.stringify({ evidence_id: 'brownie-release-artifact-stateful-soak-v1', target, workflow_run_id: workflowRunId, artifact, checks: soakChecks }));
  return { downloadRoot, uploadedEvidence, commit, workflowRunId };
}

test('release workflow artifact topology guard accepts the checked-in workflow', () => {
  assert.deepEqual(runReleaseWorkflowArtifactTopologyGuard().targetSet, ['darwin-arm64', 'linux-x64', 'win32-x64']);
});

test('release workflow artifact topology guard rejects an unscoped collector job before CI', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const invalidWorkflow = `${workflow}\n  release-evidence-collectors:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Collect every target\n        run: pnpm --workspace-root release:runtime-operational-evidence\n`;
  assert.throws(
    () => runReleaseWorkflowArtifactTopologyGuard({ workflow: invalidWorkflow }),
    /must not run outside the target-scoped artifact-roundtrip job/u
  );
});

test('release workflow artifact topology guard rejects release CI that omits its pre-build gate', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const invalidWorkflow = workflow.replace(
    '      - name: Verify release workflow artifact topology\n        run: pnpm --workspace-root guard:release-workflow-artifact-topology\n\n',
    ''
  );
  assert.throws(
    () => runReleaseWorkflowArtifactTopologyGuard({ workflow: invalidWorkflow }),
    /must run the artifact topology guard before building release artifacts/u
  );
});

test('downloaded upload-artifact topology is rebound and consumed by the collector', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-release-artifact-topology-'));
  const target = 'linux-x64';
  const fixture = writeDownloadedArtifactFixture(repoRoot, target);
  const boundEvidence = path.join(repoRoot, '.brownie', 'release-evidence', 'artifacts', target);
  fs.mkdirSync(boundEvidence, { recursive: true });
  fs.cpSync(fixture.uploadedEvidence, boundEvidence, { recursive: true });
  fs.copyFileSync(path.join(fixture.downloadRoot, 'runtime-journey-evidence.json'), path.join(boundEvidence, 'runtime-journey-evidence.json'));
  fs.copyFileSync(path.join(fixture.downloadRoot, 'runtime-stateful-soak-evidence.json'), path.join(boundEvidence, 'runtime-stateful-soak-evidence.json'));
  fs.rmSync(fixture.downloadRoot, { recursive: true, force: true });
  const previousRunId = process.env.GITHUB_RUN_ID;
  const previousSha = process.env.GITHUB_SHA;
  process.env.GITHUB_RUN_ID = fixture.workflowRunId;
  process.env.GITHUB_SHA = fixture.commit;
  try {
    const evidence = buildRuntimeOperationalEvidence({ repoRoot, iterations: 100, roundtripTarget: target });
    assert.deepEqual(validateRuntimeOperationalEvidence(evidence, { repoRoot, validateBoundEvidence: true }), []);
    assert.equal(evidence.release_evidence_binding.bindings[0].target, target);
    assert.equal(fs.existsSync(path.join(repoRoot, 'roundtrip-download')), false);
  } finally {
    if (previousRunId === undefined) delete process.env.GITHUB_RUN_ID;
    else process.env.GITHUB_RUN_ID = previousRunId;
    if (previousSha === undefined) delete process.env.GITHUB_SHA;
    else process.env.GITHUB_SHA = previousSha;
  }
});
