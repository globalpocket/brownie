import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  runtimeOperationalEvidenceRequiredSections,
  runRuntimeOperationalEvidenceGuard,
  validateRuntimeOperationalEvidence
} from './guard-runtime-operational-evidence.mjs';
import {
  buildReleaseEvidenceRoundtripBinding,
  buildRuntimeOperationalEvidence,
  redactDelegatedResult,
  summarizeReleaseEvidenceRoundtripBinding
} from './release-runtime-operational-evidence.mjs';

const requiredSections = runtimeOperationalEvidenceRequiredSections;

const forbiddenGeneratedEvidencePatterns = [
  /\/Users\//,
  /\/home\//,
  /[A-Za-z]:\/Users\//,
  /brownie-linux/i,
  /EncodedCommand/i,
  /worktree/i,
  /"command"\s*:/,
  /"stdout"\s*:/,
  /"stderr"\s*:/
];

const blockerPlaceholderPatterns = [
  /blocker/i,
  /placeholder/i,
  /TODO.*evidence/i,
  /not.*implemented/i,
  /stub/i,
  /mock.*evidence/i
];

function generatedEvidenceForbiddenMatches(evidence) {
  const serialized = JSON.stringify(evidence);
  return forbiddenGeneratedEvidencePatterns
    .filter((pattern) => pattern.test(serialized))
    .map((pattern) => String(pattern));
}

const requiredStatefulSoakStepIds = [
  'task_state_transition',
  'ledger_workspace_consistency',
  'resume_replay_handling',
  'duplicate_side_effect_rejection',
  'process_loss_recovery',
  'finite_convergence',
  'evidence_chain_integrity',
  'artifact_lifecycle',
  'golden_journey_fixture',
  'soak_test',
  'executable_evidence_validation',
  'roundtrip_journey_binding',
  'soak_results_binding',
  'implementation_commit',
  'tested_commit',
  'workflow_run_id',
  'artifact_sha256',
  'binary_sha256',
  'platform',
  'architecture',
  'roundtrip_journey',
  'soak_results',
  'downloaded_roundtrip_binding',
  'runtime_journey_binding',
  'supply_chain_guard_binding'
];

test('evidence_chain_integrity step is required for fail-closed evidence', () => {
  const evidence = validEvidence();
  evidence.sections.soak_test = { step_ids: requiredStatefulSoakStepIds.filter(id => id !== 'evidence_chain_integrity') };
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('evidence_chain_integrity')),
    'evidence_chain_integrity step must be present for fail-closed evidence');
});

test('release roundtrip binding steps are required for fail-closed evidence', () => {
  const evidence = validEvidence();
  evidence.sections.soak_test.stateful_steps = statefulSoakSteps();
  evidence.sections.soak_test.stateful_steps = evidence.sections.soak_test.stateful_steps.filter(
    (step) => step.id !== 'roundtrip_journey_binding'
  );
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('roundtrip_journey_binding')),
    'roundtrip_journey_binding must be present for satisfied soak evidence');
});

test('release roundtrip binding receipt is deterministic and fail-closed without artifacts', () => {
  const binding = buildReleaseEvidenceRoundtripBinding({ artifacts: [] });
  const receipt = summarizeReleaseEvidenceRoundtripBinding(binding);
  assert.equal(binding.evidence_id, 'brownie-release-evidence-roundtrip-binding-v1');
  assert.equal(binding.status, 'not_executed');
  assert.equal(binding.target_count, 0);
  assert.match(binding.binding_digest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(receipt, {
    schema_version: 1,
    evidence_id: 'brownie-release-evidence-roundtrip-binding-v1',
    status: 'not_executed',
    release_blocking: true,
    target_count: 0,
    satisfied_target_count: 0,
    binding_digest: binding.binding_digest
  });
});

test('release roundtrip binding accepts complete, mutually bound artifact evidence', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-roundtrip-binding-test-'));
  const target = 'linux-x64';
  const evidenceDir = `.brownie/release-evidence/artifacts/${target}`;
  const physicalContents = { archive: 'downloaded archive bytes', binary: 'downloaded CLI bytes', runtime: 'downloaded Runtime bytes' };
  const hash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
  const archiveSha256 = hash(physicalContents.archive);
  const binarySha256 = hash(physicalContents.binary);
  const runtimeSha256 = hash(physicalContents.runtime);
  const commit = 'd'.repeat(40);
  const workflowRunId = '123456';
  const journeyChecks = Object.fromEntries([
    'mode_pack_load', 'workspace_mutation', 'ledger_generation', 'forced_interruption', 'resume', 'stale_replay_rejection'
  ].map((id) => [id, { passed: true }]));
  const soakChecks = Object.fromEntries([
    'artifact_execution_boundary', 'process_loss_recovery', 'duplicate_side_effect_rejection', 'ledger_workspace_consistency',
    'resume_replay_behavior', 'finite_convergence', 'evidence_chain_integrity'
  ].map((id) => [id, { passed: true }]));
  const artifactEvidence = {
    target,
    platform: 'linux',
    arch: 'x64',
    archive: { path: `${evidenceDir}/brownie-linux-x64.tar.gz`, sha256: archiveSha256 },
    artifact: {
      path: `${evidenceDir}/brownie`,
      source_commit: `sha256:${commit}`,
      source_clean_tree: 'clean',
      source_identity: `sha256:${'e'.repeat(64)}`,
      sha256: binarySha256
    },
    runtime_companion: { path: `${evidenceDir}/brownie-runtime`, sha256: runtimeSha256 }
  };
  const artifactDirectory = path.join(repoRoot, evidenceDir);
  fs.mkdirSync(artifactDirectory, { recursive: true });
  fs.writeFileSync(path.join(artifactDirectory, 'brownie-linux-x64.tar.gz'), physicalContents.archive);
  fs.writeFileSync(path.join(artifactDirectory, 'brownie'), physicalContents.binary);
  fs.writeFileSync(path.join(artifactDirectory, 'brownie-runtime'), physicalContents.runtime);
  fs.writeFileSync(path.join(artifactDirectory, 'runtime-journey-evidence.json'), JSON.stringify({
    evidence_id: 'brownie-release-artifact-runtime-journey-v1', target, workflow_run_id: workflowRunId,
    artifact: { archive_sha256: archiveSha256, artifact_sha256: binarySha256, runtime_sha256: runtimeSha256 }, checks: journeyChecks
  }));
  fs.writeFileSync(path.join(artifactDirectory, 'runtime-stateful-soak-evidence.json'), JSON.stringify({
    evidence_id: 'brownie-release-artifact-stateful-soak-v1', target, workflow_run_id: workflowRunId,
    artifact: { archive_sha256: archiveSha256, artifact_sha256: binarySha256, runtime_sha256: runtimeSha256 }, checks: soakChecks
  }));
  const binding = buildReleaseEvidenceRoundtripBinding({
    repoRoot,
    workflowRunId,
    testedCommit: commit,
    artifacts: [{ target, artifact_evidence: artifactEvidence, evidence_dir: evidenceDir }]
  });
  assert.equal(binding.status, 'satisfied');
  assert.equal(binding.satisfied_target_count, 1);
  assert.deepEqual(binding.missing, []);

  // The release artifact writer stores its portable archive beside the
  // evidence instead of duplicating archive metadata into artifact-evidence.
  // The workflow binds that complete directory after download, so exercise
  // the same convention rather than only the declared-archive shortcut.
  const conventionArchiveContents = 'downloaded archive';
  const conventionArchiveSha256 = `sha256:${crypto.createHash('sha256').update(conventionArchiveContents).digest('hex')}`;
  fs.writeFileSync(path.join(artifactDirectory, 'brownie-linux-x64.tar.gz'), conventionArchiveContents);
  for (const name of ['runtime-journey-evidence.json', 'runtime-stateful-soak-evidence.json']) {
    const receiptPath = path.join(artifactDirectory, name);
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    receipt.artifact.archive_sha256 = conventionArchiveSha256;
    fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  }
  const conventionOnlyEvidence = { ...artifactEvidence };
  delete conventionOnlyEvidence.archive;
  const conventionOnlyBinding = buildReleaseEvidenceRoundtripBinding({
    repoRoot,
    workflowRunId,
    testedCommit: commit,
    artifacts: [{ target, artifact_evidence: conventionOnlyEvidence, evidence_dir: evidenceDir }]
  });
  assert.equal(conventionOnlyBinding.status, 'satisfied');

  delete soakChecks.process_loss_recovery;
  fs.writeFileSync(path.join(artifactDirectory, 'runtime-stateful-soak-evidence.json'), JSON.stringify({
    evidence_id: 'brownie-release-artifact-stateful-soak-v1', target, workflow_run_id: workflowRunId,
    artifact: { archive_sha256: archiveSha256, artifact_sha256: binarySha256, runtime_sha256: runtimeSha256 }, checks: soakChecks
  }));
  const missingBaseSoakCheck = buildReleaseEvidenceRoundtripBinding({
    repoRoot,
    workflowRunId,
    testedCommit: commit,
    artifacts: [{ target, artifact_evidence: artifactEvidence, evidence_dir: evidenceDir }]
  });
  assert.equal(missingBaseSoakCheck.status, 'not_executed');
  assert.match(missingBaseSoakCheck.bindings[0].errors.join(','), /stateful_soak_checks_incomplete/);
});

test('collector consumes complete downloaded artifact receipts without requiring target/debug', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-bound-runtime-collector-test-'));
  const target = 'linux-x64';
  const evidenceDir = `.brownie/release-evidence/artifacts/${target}`;
  const artifactDirectory = path.join(repoRoot, evidenceDir);
  fs.mkdirSync(artifactDirectory, { recursive: true });
  const write = (name, contents) => {
    const filePath = path.join(artifactDirectory, name);
    fs.writeFileSync(filePath, contents);
    return `sha256:${crypto.createHash('sha256').update(contents).digest('hex')}`;
  };
  const binarySha256 = write('brownie', 'downloaded packaged cli');
  const runtimeSha256 = write('brownie-runtime', 'downloaded runtime companion');
  const archiveSha256 = write('brownie-linux-x64.tar.gz', 'downloaded archive');
  const commit = 'd'.repeat(40);
  const workflowRunId = '123456';
  const artifact = {
    archive_sha256: archiveSha256,
    artifact_sha256: binarySha256,
    runtime_sha256: runtimeSha256
  };
  fs.writeFileSync(path.join(artifactDirectory, 'artifact-evidence.json'), JSON.stringify({
    target,
    platform: 'linux',
    arch: 'x64',
    archive: { path: `${evidenceDir}/brownie-linux-x64.tar.gz`, sha256: archiveSha256 },
    artifact: {
      path: `${evidenceDir}/brownie`,
      target,
      sha256: binarySha256,
      source_commit: `sha256:${commit}`,
      source_clean_tree: 'clean',
      source_identity: `sha256:${'e'.repeat(64)}`
    },
    runtime_companion: { path: `${evidenceDir}/brownie-runtime`, sha256: runtimeSha256 }
  }));
  const journeyChecks = Object.fromEntries([
    'mode_pack_load', 'workspace_mutation', 'ledger_generation', 'forced_interruption', 'resume', 'stale_replay_rejection'
  ].map((id) => [id, { passed: true }]));
  const soakChecks = Object.fromEntries([
    'artifact_execution_boundary', 'process_loss_recovery', 'duplicate_side_effect_rejection', 'ledger_workspace_consistency',
    'resume_replay_behavior', 'finite_convergence', 'evidence_chain_integrity'
  ].map((id) => [id, { passed: true }]));
  soakChecks.artifact_execution_boundary = {
    passed: true,
    packaged_cli_only: true,
    isolated_workspace_cwd: true,
    runtime_path_override_removed: true
  };
  soakChecks.finite_convergence = { passed: true, commands_executed: 3, maximum_commands: 3 };
  fs.writeFileSync(path.join(artifactDirectory, 'runtime-journey-evidence.json'), JSON.stringify({
    evidence_id: 'brownie-release-artifact-runtime-journey-v1', target, workflow_run_id: workflowRunId, artifact, checks: journeyChecks
  }));
  fs.writeFileSync(path.join(artifactDirectory, 'runtime-stateful-soak-evidence.json'), JSON.stringify({
    evidence_id: 'brownie-release-artifact-stateful-soak-v1', target, workflow_run_id: workflowRunId, artifact, checks: soakChecks
  }));
  const staleTarget = 'darwin-arm64';
  const staleDirectory = path.join(repoRoot, '.brownie', 'release-evidence', 'artifacts', staleTarget);
  fs.mkdirSync(staleDirectory, { recursive: true });
  fs.writeFileSync(path.join(staleDirectory, 'brownie'), 'stale artifact');
  fs.writeFileSync(path.join(staleDirectory, 'artifact-evidence.json'), JSON.stringify({
    target: staleTarget,
    platform: 'darwin',
    arch: 'arm64',
    artifact: { path: `.brownie/release-evidence/artifacts/${staleTarget}/brownie`, sha256: `sha256:${'0'.repeat(64)}` }
  }));
  const previousRunId = process.env.GITHUB_RUN_ID;
  const previousSha = process.env.GITHUB_SHA;
  process.env.GITHUB_RUN_ID = workflowRunId;
  process.env.GITHUB_SHA = commit;
  try {
    const evidence = buildRuntimeOperationalEvidence({ repoRoot, iterations: 100, roundtripTarget: target });
    for (const sectionId of requiredSections) assert.equal(evidence.sections[sectionId].status, 'satisfied');
    assert.equal(evidence.sections.artifact_lifecycle.evidence_source, 'downloaded_artifact_binding');
    assert.equal(evidence.sections.golden_journey_fixture.evidence_source, 'downloaded_artifact_binding');
    assert.equal(evidence.sections.soak_test.evidence_source, 'downloaded_artifact_binding');
    assert.equal(evidence.release_evidence_binding.target_count, 1);
    assert.equal(evidence.release_evidence_binding.bindings[0].target, target);
    assert.equal(fs.existsSync(path.join(repoRoot, 'target/debug/brownie')), false);
    assert.deepEqual(validateRuntimeOperationalEvidence(evidence, { repoRoot, validateBoundEvidence: true }), []);
  } finally {
    if (previousRunId === undefined) delete process.env.GITHUB_RUN_ID;
    else process.env.GITHUB_RUN_ID = previousRunId;
    if (previousSha === undefined) delete process.env.GITHUB_SHA;
    else process.env.GITHUB_SHA = previousSha;
  }
});

test('release workflow binds downloaded evidence before staging cleanup', () => {
  const workflow = fs.readFileSync(path.join(process.cwd(), '.github/workflows/release.yml'), 'utf8');
  assert.match(
    workflow,
    /cp -R "\$source_evidence_dir"\/\. "\$bound_evidence_dir"\/\n\s+cp roundtrip-download\/runtime-journey-evidence\.json "\$bound_evidence_dir\/runtime-journey-evidence\.json"\n\s+cp roundtrip-download\/runtime-stateful-soak-evidence\.json "\$bound_evidence_dir\/runtime-stateful-soak-evidence\.json"\n\s+rm -rf roundtrip-download\n\n\s+- name: Generate and validate bound release evidence/u
  );
  assert.match(workflow, /BROWNIE_RELEASE_EVIDENCE_TARGET: \$\{\{ matrix\.target \}\}/u);
  assert.doesNotMatch(workflow, /path: roundtrip-download\/runtime-(?:journey|stateful-soak)-evidence\.json/u);
});

test('collector CLI emits only target-scoped binding diagnostics', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts/release-runtime-operational-evidence.mjs'), 'utf8');
  assert.match(source, /release_evidence_binding: \{[\s\S]*bindings: Array\.isArray\(binding\?\.bindings\)/u);
  assert.match(source, /\.map\(\(\{ target, status, errors \}\) => \(\{ target, status, errors \}\)\)/u);
});

test('evidence must not contain blocker placeholders', () => {
  const evidence = validEvidence();
  evidence.sections.artifact_lifecycle = { status: 'placeholder', blocker: 'TODO: implement evidence' };
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('blocker') || error.includes('placeholder')),
    'evidence must not contain blocker placeholders');
});

test('rejects required_sections drift outside the runtime operational evidence contract', () => {
  const evidence = validEvidence({
    required_sections: [...requiredSections, 'runtime_operational_evidence'],
    fail_closed_reasons: ['runtime_operational_evidence:missing']
  });
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(
    errors.some((error) => error.includes('unknown section runtime_operational_evidence')),
    'runtime operational evidence guard must reject unconnected required_sections entries'
  );
});

test('generated runtime operational evidence uses the guard-required section set', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-runtime-evidence-'));
  const evidence = await buildRuntimeOperationalEvidence({ repoRoot });
  assert.deepEqual(evidence.required_sections, requiredSections);
  assert.deepEqual(
    Object.keys(evidence.sections).filter((sectionId) => requiredSections.includes(sectionId)).sort(),
    [...requiredSections].sort()
  );
});

test('runtime operational evidence models release operation as executable fail-closed evidence', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-runtime-direct-valid-'));
  try {
    const evidence = validEvidence();
    writeDownloadedRuntimeEvidence(repoRoot, evidence.release_evidence_binding);
    const guardResult = runRuntimeOperationalEvidenceGuard({ ...evidence, ...boundRuntimeOptions(repoRoot) });
    assert.ok(guardResult.valid, 'guard should pass for valid executable evidence');
    assert.ok(guardResult.fail_closed === true, 'executable evidence must be fail-closed');
    const redacted = redactDelegatedResult(evidence);
    assert.ok(!generatedEvidenceForbiddenMatches(redacted).length, 'no forbidden patterns in redacted evidence');
  } finally { fs.rmSync(repoRoot, { recursive: true, force: true }); }
});

test('fail-closed evidence requires explicit fail_closed_reasons when artifact lifecycle is not executable', () => {
  const evidence = validEvidence({
    artifact_lifecycle: { status: 'blocked', fail_closed: true },
    fail_closed_reasons: ['artifact_lifecycle:blocked']
  });
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert.deepEqual(errors, [], 'fail-closed evidence with explicit reasons should pass validation');
});

test('rejects non-fail-closed executable evidence', async (t) => {
  assert.throws(() => buildRuntimeOperationalEvidence({
    artifact_lifecycle: { status: 'executable', fail_closed: false },
    golden_journey_fixture: { executed: true },
    soak_test: { step_ids: requiredStatefulSoakStepIds }
  }), /Synthetic operational evidence/u);
});

function validateStatefulSoakSteps(evidence) {
  if (!evidence || typeof evidence !== 'object') {
    return { valid: false, missing: requiredStatefulSoakStepIds, reason: 'evidence is not an object' };
  }
  const soakSection = evidence.soak_test;
  if (!soakSection || typeof soakSection !== 'object') {
    return { valid: false, missing: requiredStatefulSoakStepIds, reason: 'soak_test section missing' };
  }
  const stepIds = soakSection.step_ids || [];
  const missing = requiredStatefulSoakStepIds.filter((id) => !stepIds.includes(id));
  if (missing.length > 0) {
    return { valid: false, missing, reason: 'required stateful soak steps incomplete' };
  }
  return { valid: true, missing: [], reason: 'all stateful soak steps present' };
}

function validContract(overrides = {}) {
  return {
    local_release_gate: {
      commands: [
        { command: 'pnpm --workspace-root release:runtime-operational-evidence' },
        { command: 'pnpm --workspace-root guard:runtime-operational-evidence' },
        { command: 'pnpm --workspace-root guard:runtime-operational-evidence:test' }
      ]
    },
    runtime_operational_evidence: {
      contract_id: 'brownie-runtime-operational-evidence-v1',
      default_path: '.brownie/release-evidence/runtime-operational-evidence.json',
      required_sections: requiredSections
    },
    ...overrides
  };
}

function section(status = 'satisfied', extra = {}) {
  return {
    status,
    release_blocking: true,
    ...extra
  };
}

function commandSummary(overrides = {}) {
  return {
    command_summary: { kind: 'command_summary', word_count: 2, sha256: 'a'.repeat(64) },
    exit_code: 0,
    signal: null,
    passed: true,
    stdout_summary: { kind: 'process_output_summary', byte_length: 0, line_count: 0, sha256: 'b'.repeat(64) },
    stderr_summary: { kind: 'process_output_summary', byte_length: 0, line_count: 0, sha256: 'c'.repeat(64) },
    ...overrides
  };
}

function statefulSoakSteps(overrides = {}) {
  return requiredStatefulSoakStepIds.map((id) => ({
    id,
    status: 'satisfied',
    passed: true,
    evidence_summary: { kind: 'stateful_soak_step_summary', sha256: id.padEnd(64, id.at(0) ?? 'a').slice(0, 64) },
    ...overrides[id]
  }));
}

function validReleaseEvidenceBinding(overrides = {}) {
  const commit = 'd'.repeat(40);
  const binding = {
    schema_version: 1,
    evidence_id: 'brownie-release-evidence-roundtrip-binding-v1',
    status: 'satisfied',
    release_blocking: true,
    target_count: 1,
    satisfied_target_count: 1,
    binding_digest: null,
    bindings: [{
      target: 'darwin-arm64',
      status: 'satisfied',
      implementation_commit: `sha256:${commit}`,
      tested_commit: commit,
      workflow_run_id: '123456',
      platform: 'darwin',
      architecture: 'arm64',
      package_sha256: `sha256:${'a'.repeat(64)}`,
      binary_sha256: `sha256:${'b'.repeat(64)}`,
      runtime_sha256: `sha256:${'c'.repeat(64)}`,
      journey_evidence_path: '.brownie/release-evidence/artifacts/darwin-arm64/runtime-journey-evidence.json',
      soak_evidence_path: '.brownie/release-evidence/artifacts/darwin-arm64/runtime-stateful-soak-evidence.json',
      errors: []
    }],
    missing: []
  };
  const witnesses = binding.bindings
    .map((entry) => ({
      target: entry.target,
      status: entry.status,
      implementation_commit: entry.implementation_commit,
      tested_commit: entry.tested_commit,
      workflow_run_id: entry.workflow_run_id,
      platform: entry.platform,
      architecture: entry.architecture,
      package_sha256: entry.package_sha256,
      binary_sha256: entry.binary_sha256,
      runtime_sha256: entry.runtime_sha256,
      errors: entry.errors
    }))
    .sort((left, right) => left.target.localeCompare(right.target));
  binding.binding_digest = `sha256:${crypto.createHash('sha256').update(JSON.stringify(witnesses)).digest('hex')}`;
  return { ...binding, ...overrides };
}

function releaseEvidenceBindingSummary(binding) {
  return Object.fromEntries([
    'schema_version',
    'evidence_id',
    'status',
    'release_blocking',
    'target_count',
    'satisfied_target_count',
    'binding_digest'
  ].map((field) => [field, binding[field]]));
}

function validEvidence(overrides = {}) {
  const releaseEvidenceBinding = validReleaseEvidenceBinding();
  return {
    schema_version: 1,
    evidence_id: 'brownie-runtime-operational-evidence-v1',
    repository: 'example-org/evidence-fixture',
    release_ready: false,
    runtime_release_ready: false,
    required_sections: requiredSections,
    fail_closed_reasons: [],
    sections: {
      artifact_lifecycle: section('satisfied', {
        lifecycle_results: [
          {
            target: 'darwin-arm64',
            path: '.brownie/release-evidence/artifacts/darwin-arm64/brownie',
            status: 'satisfied',
            passed: true,
            checksum_verified: true,
            uninstalled: true,
            commands: [commandSummary()]
          }
        ]
      }),
      golden_journey_fixture: section('satisfied', {
        commands: [commandSummary()],
        lifecycle_evidence: {
          json_present: true,
          proposal_preflight_observed: true,
          apply_observed: true,
          post_apply_verification_observed: true,
          workspace_mutation_observed: true,
          completion_observed: true
        }
      }),
      soak_test: section('satisfied', {
        iterations_requested: 100,
        iterations_completed: 100,
        failure_count: 0,
        failure_rate: 0,
        duplicate_side_effects_observed: false,
        unrecoverable_run_count: 0,
        commands: [commandSummary()],
        stateful_steps: statefulSoakSteps()
      }),
      executable_evidence_validation: section('satisfied', {
        fail_closed: true,
        validated_sections: [
          { id: 'artifact_lifecycle', status: 'satisfied', satisfied: true },
          { id: 'golden_journey_fixture', status: 'satisfied', satisfied: true },
          { id: 'soak_test', status: 'satisfied', satisfied: true }
        ],
        missing_executable_evidence: [],
        release_evidence_binding: releaseEvidenceBindingSummary(releaseEvidenceBinding)
      })
    },
    release_evidence_binding: releaseEvidenceBinding,
    ...overrides
  };
}

function writeDownloadedRuntimeEvidence(repoRoot, binding, overrides = {}) {
  const entry = binding.bindings[0];
  const journeyPath = path.join(repoRoot, entry.journey_evidence_path);
  const soakPath = path.join(repoRoot, entry.soak_evidence_path);
  fs.mkdirSync(path.dirname(journeyPath), { recursive: true });
  fs.mkdirSync(path.dirname(soakPath), { recursive: true });
  const journeyChecks = Object.fromEntries([
    'mode_pack_load', 'workspace_mutation', 'ledger_generation', 'forced_interruption', 'resume', 'stale_replay_rejection'
  ].map((id) => [id, { passed: true }]));
  const soakChecks = Object.fromEntries([
    'artifact_execution_boundary', 'process_loss_recovery', 'duplicate_side_effect_rejection', 'ledger_workspace_consistency',
    'resume_replay_behavior', 'finite_convergence', 'evidence_chain_integrity'
  ].map((id) => [id, { passed: true }]));
  soakChecks.artifact_execution_boundary = {
    passed: true,
    packaged_cli_only: true,
    isolated_workspace_cwd: true,
    runtime_path_override_removed: true
  };
  soakChecks.finite_convergence = {
    passed: true,
    commands_executed: 3,
    maximum_commands: 3
  };
  const artifact = {
    archive_sha256: entry.package_sha256,
    artifact_sha256: entry.binary_sha256,
    runtime_sha256: entry.runtime_sha256
  };
  fs.writeFileSync(journeyPath, JSON.stringify({
    evidence_id: 'brownie-release-artifact-runtime-journey-v1',
    target: entry.target,
    workflow_run_id: entry.workflow_run_id,
    artifact,
    checks: { ...journeyChecks, ...(overrides.journey_checks ?? {}) }
  }));
  fs.writeFileSync(soakPath, JSON.stringify({
    evidence_id: 'brownie-release-artifact-stateful-soak-v1',
    target: entry.target,
    workflow_run_id: entry.workflow_run_id,
    artifact,
    checks: { ...soakChecks, ...(overrides.soak_checks ?? {}) }
  }));
}

function refreshBindingWitness(evidence) {
  const binding = evidence.release_evidence_binding;
  const fields = ['target', 'status', 'implementation_commit', 'tested_commit', 'workflow_run_id',
    'platform', 'architecture', 'package_sha256', 'binary_sha256', 'runtime_sha256', 'errors'];
  const witnesses = binding.bindings.map(entry => Object.fromEntries(fields.map(field => [field, entry[field]])))
    .sort((left, right) => left.target.localeCompare(right.target));
  binding.binding_digest = `sha256:${crypto.createHash('sha256').update(JSON.stringify(witnesses)).digest('hex')}`;
  evidence.sections.executable_evidence_validation.release_evidence_binding = releaseEvidenceBindingSummary(binding);
}

function boundRuntimeOptions(repoRoot) {
  return { repoRoot, validateBoundEvidence: true, workflowRunId: '123456', testedCommit: 'd'.repeat(40) };
}

for (const satisfiedSection of ['artifact_lifecycle', 'golden_journey_fixture', 'soak_test']) {
  for (const corruption of ['missing binding', 'missing journey', 'failed journey']) {
    test(`Runtime guard rejects ${corruption} when only ${satisfiedSection} claims satisfaction`, () => {
      const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-partial-runtime-'));
      try {
        const evidence = validEvidence();
        writeDownloadedRuntimeEvidence(repoRoot, evidence.release_evidence_binding);
        for (const id of requiredSections.filter(id => id !== satisfiedSection)) {
          evidence.sections[id].status = 'not_executed';
          evidence.fail_closed_reasons.push(`${id}:not_executed`);
        }
        const entry = evidence.release_evidence_binding.bindings[0];
        if (corruption === 'missing binding') delete evidence.release_evidence_binding;
        else if (corruption === 'missing journey') fs.unlinkSync(path.join(repoRoot, entry.journey_evidence_path));
        else writeDownloadedRuntimeEvidence(repoRoot, evidence.release_evidence_binding,
          { journey_checks: { workspace_mutation: { passed: false } } });
        assert(validateRuntimeOperationalEvidence(evidence, boundRuntimeOptions(repoRoot)).length > 0);
      } finally { fs.rmSync(repoRoot, { recursive: true, force: true }); }
    });
  }
}

for (const id of ['artifact_lifecycle', 'golden_journey_fixture', 'soak_test']) {
  test(`Runtime guard rejects a stale downloaded binding summary for ${id}`, () => {
    const evidence = validEvidence();
    evidence.sections[id].evidence_source = 'downloaded_artifact_binding';
    evidence.sections[id].evidence_binding = { ...releaseEvidenceBindingSummary(evidence.release_evidence_binding),
      binding_digest: `sha256:${'f'.repeat(64)}` };
    assert(validateRuntimeOperationalEvidence(evidence).some(error => error.includes('evidence_binding.binding_digest')));
  });
}

for (const [label, mutate, expected] of [
  ['duplicate lifecycle target', e => e.sections.artifact_lifecycle.lifecycle_results.push(
    { ...e.sections.artifact_lifecycle.lifecycle_results[0] }), 'unique'],
  ['zero soak iterations', e => { e.sections.soak_test.iterations_requested = 0; e.sections.soak_test.iterations_completed = 0; }, 'positive'],
  ['noncanonical run identity', e => { e.release_evidence_binding.bindings[0].workflow_run_id = '00123456'; refreshBindingWitness(e); }, 'workflow_run_id']
]) test(`Runtime guard rejects ${label}`, () => {
  const errors = validateRuntimeOperationalEvidence((() => { const e = validEvidence(); mutate(e); return e; })());
  assert(errors.some(error => error.includes(expected)), errors.join('\n'));
});

for (const [label, overrides, options, expected] of [
  ['zero executed commands', { soak_checks: { finite_convergence: { passed: true, commands_executed: 0, maximum_commands: 3 } } }, {}, 'positive'],
  ['unsafe command limit', { soak_checks: { finite_convergence: { passed: true, commands_executed: 3, maximum_commands: 1e20 } } }, {}, 'safe integer'],
  ['stale workflow run', {}, { workflowRunId: '654321' }, 'workflow_run_id'],
  ['stale tested commit', {}, { testedCommit: 'e'.repeat(40) }, 'tested_commit']
]) test(`Runtime guard rejects ${label} in bound downloaded evidence`, () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-runtime-bound-'));
  try {
    const evidence = validEvidence();
    writeDownloadedRuntimeEvidence(repoRoot, evidence.release_evidence_binding, overrides);
    const errors = validateRuntimeOperationalEvidence(evidence, { ...boundRuntimeOptions(repoRoot), ...options });
    assert(errors.some(error => error.includes(expected)), errors.join('\n'));
  } finally { fs.rmSync(repoRoot, { recursive: true, force: true }); }
});

test('Runtime guard rejects a linked evidence directory even when the referenced JSON matches', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-runtime-linked-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-runtime-outside-'));
  try {
    const evidence = validEvidence();
    writeDownloadedRuntimeEvidence(repoRoot, evidence.release_evidence_binding);
    const directory = path.dirname(path.join(repoRoot, evidence.release_evidence_binding.bindings[0].journey_evidence_path));
    fs.cpSync(directory, outside, { recursive: true });
    fs.rmSync(directory, { recursive: true });
    fs.symlinkSync(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
    const errors = validateRuntimeOperationalEvidence(evidence, boundRuntimeOptions(repoRoot));
    assert(errors.some(error => error.includes('regular file within the repository')), errors.join('\n'));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('Runtime guard rejects JSON redirected to a build directory despite matching hashes', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-runtime-build-tree-'));
  try {
    const evidence = validEvidence();
    evidence.release_evidence_binding.bindings[0].journey_evidence_path = 'target/debug/runtime-journey-evidence.json';
    writeDownloadedRuntimeEvidence(repoRoot, evidence.release_evidence_binding);
    const errors = validateRuntimeOperationalEvidence(evidence, boundRuntimeOptions(repoRoot));
    assert(errors.some(error => error.includes('downloaded target directory')), errors.join('\n'));
  } finally { fs.rmSync(repoRoot, { recursive: true, force: true }); }
});

test('Runtime guard direct entry point cannot bypass referenced receipt checks', () => {
  const result = runRuntimeOperationalEvidenceGuard({ ...validEvidence(), validateBoundEvidence: false });
  assert.equal(result.valid, false);
  assert(result.errors.some(error => error.includes('regular file within the repository')));
});

test('accepts satisfied runtime operational evidence', () => {
  const evidence = validEvidence();
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert.deepEqual(errors, []);
});

test('rejects satisfied runtime evidence without the downloaded-artifact binding', () => {
  const evidence = validEvidence();
  delete evidence.release_evidence_binding;
  delete evidence.sections.executable_evidence_validation.release_evidence_binding;
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('release_evidence_binding must be present')), errors.join('\n'));
});

test('rejects partial platform coverage in a satisfied runtime evidence binding', () => {
  const evidence = validEvidence();
  evidence.sections.artifact_lifecycle.lifecycle_results.push({
    ...evidence.sections.artifact_lifecycle.lifecycle_results[0],
    target: 'linux-x64'
  });
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('cover artifact lifecycle target linux-x64')), errors.join('\n'));
});

test('rejects missing, inconsistent, and unbounded downloaded-artifact results', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-runtime-guard-binding-'));
  const evidence = validEvidence();
  writeDownloadedRuntimeEvidence(repoRoot, evidence.release_evidence_binding);
  assert.deepEqual(
    validateRuntimeOperationalEvidence(evidence, boundRuntimeOptions(repoRoot)),
    [],
    'complete downloaded journey and soak evidence should validate'
  );

  const entry = evidence.release_evidence_binding.bindings[0];
  const journeyPath = path.join(repoRoot, entry.journey_evidence_path);
  const journey = JSON.parse(fs.readFileSync(journeyPath, 'utf8'));
  journey.artifact.artifact_sha256 = `sha256:${'f'.repeat(64)}`;
  fs.writeFileSync(journeyPath, JSON.stringify(journey));
  let errors = validateRuntimeOperationalEvidence(evidence, boundRuntimeOptions(repoRoot));
  assert(errors.some((error) => error.includes('journey.artifact.artifact_sha256 must match')), errors.join('\n'));

  writeDownloadedRuntimeEvidence(repoRoot, evidence.release_evidence_binding, {
    soak_checks: { finite_convergence: { passed: true, commands_executed: 4, maximum_commands: 3 } }
  });
  errors = validateRuntimeOperationalEvidence(evidence, boundRuntimeOptions(repoRoot));
  assert(errors.some((error) => error.includes('must remain within maximum_commands')), errors.join('\n'));

  writeDownloadedRuntimeEvidence(repoRoot, evidence.release_evidence_binding);
  fs.writeFileSync(journeyPath, 'null');
  errors = validateRuntimeOperationalEvidence(evidence, boundRuntimeOptions(repoRoot));
  assert(errors.some((error) => error.includes('journey_evidence_path must contain a JSON object')), errors.join('\n'));

  fs.rmSync(path.join(repoRoot, entry.soak_evidence_path));
  errors = validateRuntimeOperationalEvidence(evidence, boundRuntimeOptions(repoRoot));
  assert(errors.some((error) => error.includes('regular file within the repository')), errors.join('\n'));
});

test('accepts contract-only mode when generated runtime operational evidence is absent', () => {
  const result = runRuntimeOperationalEvidenceGuard({
    repoRoot: process.cwd(),
    contract: validContract(),
    evidencePath: '.brownie/release-evidence/not-yet-generated-runtime-operational-evidence.json'
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.validatedEvidence, false);
});

test('rejects incomplete golden journey fixture evidence', () => {
  const evidence = validEvidence();
  evidence.sections.golden_journey_fixture = section('not_executed_missing_artifacts', { commands: [] });
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('fail_closed_reasons must include golden_journey_fixture')));
});

test('accepts fail-closed golden journey with explicit reason', () => {
  const evidence = validEvidence({
    fail_closed_reasons: ['golden_journey_fixture:not_executed_missing_artifacts']
  });
  evidence.sections.golden_journey_fixture = section('not_executed_missing_artifacts', { commands: [] });
  assert.deepEqual(validateRuntimeOperationalEvidence(evidence), []);
});

test('rejects satisfied golden journey without complete lifecycle evidence', () => {
  const evidence = validEvidence();
  evidence.sections.golden_journey_fixture.lifecycle_evidence.workspace_mutation_observed = false;
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('workspace_mutation_observed must be true')));
});

test('rejects release-ready claims', () => {
  const errors = validateRuntimeOperationalEvidence(validEvidence({ runtime_release_ready: true }));
  assert(errors.some((error) => error.includes('runtime_release_ready true')));
});

test('validates fail-closed evidence with golden journey artifacts', () => {
  const evidence = validEvidence({
    fail_closed_reasons: ['golden_journey_fixture:not_executed_missing_artifacts']
  });
  evidence.sections.golden_journey_fixture = section('not_executed_missing_artifacts', { commands: [] });
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert.equal(errors.length, 0, 'fail-closed evidence with explicit reason should be valid');
});

test('rejects executable shortcut without satisfied operational evidence', () => {
  const evidence = validEvidence({
    fail_closed_reasons: ['artifact_lifecycle:executable']
  });
  evidence.sections.artifact_lifecycle = { status: 'executable', release_blocking: true, fail_closed: true };
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('sections.artifact_lifecycle.status executable is not allowed')));
});

test('requires fail-closed reasons for incomplete artifact lifecycle evidence', () => {
  const evidence = validEvidence();
  evidence.sections.artifact_lifecycle = section('failed', {
    lifecycle_results: [
      {
        target: 'darwin-arm64',
        path: '.brownie/release-evidence/artifacts/darwin-arm64/brownie',
        status: 'failed',
        passed: false,
        commands: [commandSummary({ exit_code: 1, passed: false })]
      }
    ]
  });
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('fail_closed_reasons must include artifact_lifecycle')));
});

test('accepts fail-closed incomplete sections with explicit reasons', () => {
  const evidence = validEvidence({
    fail_closed_reasons: [
      'artifact_lifecycle:not_executed_missing_artifacts',
      'golden_journey_fixture:not_executed_missing_artifacts',
      'soak_test:not_executed_missing_artifacts'
    ]
  });
  evidence.sections.artifact_lifecycle = section('not_executed_missing_artifacts', { lifecycle_results: [] });
  evidence.sections.golden_journey_fixture = section('not_executed_missing_artifacts', { commands: [] });
  evidence.sections.soak_test = section('not_executed_missing_artifacts', {
    iterations_requested: 100,
    iterations_completed: 0,
    failure_count: 0,
    failure_rate: 1
  });
  assert.deepEqual(validateRuntimeOperationalEvidence(evidence), []);
});

test('accepts fail-closed artifact lifecycle when cross-platform artifacts are host-incompatible', () => {
  const evidence = validEvidence({
    fail_closed_reasons: ['artifact_lifecycle:failed']
  });
  evidence.sections.artifact_lifecycle = section('failed', {
    lifecycle_results: [
      {
        target: 'linux-x64',
        path: '.brownie/release-evidence/artifacts/linux-x64/brownie',
        status: 'not_executed_incompatible_host',
        passed: false,
        checksum_verified: true,
        host_target: 'darwin-arm64',
        commands: []
      }
    ]
  });
  assert.deepEqual(validateRuntimeOperationalEvidence(evidence), []);
});

test('accepts fail-closed artifact lifecycle when local release target manifest is missing', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-runtime-operational-evidence-test-'));
  const evidence = buildRuntimeOperationalEvidence({
    repoRoot,
    iterations: 1,
    generatedAt: '2026-09-12T00:00:00.000Z'
  });
  evidence.sections.golden_journey_fixture = section('not_executed_missing_artifacts', { commands: [] });
  evidence.sections.soak_test = section('not_executed_missing_artifacts', {
    iterations_requested: 1,
    iterations_completed: 0,
    failure_count: 0,
    failure_rate: 1
  });
  evidence.fail_closed_reasons = [
    `artifact_lifecycle:${evidence.sections.artifact_lifecycle.status}`,
    'golden_journey_fixture:not_executed_missing_artifacts',
    'soak_test:not_executed_missing_artifacts',
    'executable_evidence_validation:not_executed'
  ];
  assert.equal(evidence.sections.artifact_lifecycle.local_release_targets_path, '.brownie/local-release-targets.json');
  assert.deepEqual(validateRuntimeOperationalEvidence(evidence), []);
});

test('collector keeps version-only soak fail-closed', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-runtime-operational-evidence-test-'));
  const cliPath = path.join(repoRoot, 'target/debug/brownie');
  fs.mkdirSync(path.dirname(cliPath), { recursive: true });
  fs.writeFileSync(cliPath, '#!/bin/sh\necho brownie 0.0.0\n');
  fs.chmodSync(cliPath, 0o755);
  const evidence = buildRuntimeOperationalEvidence({
    repoRoot,
    iterations: 2,
    generatedAt: '2026-09-12T00:00:00.000Z'
  });
  assert.equal(evidence.sections.soak_test.status, 'not_executed');
  const bindingSteps = Object.fromEntries(
    evidence.sections.soak_test.stateful_steps.map((step) => [step.id, step])
  );
  for (const stepId of ['roundtrip_journey_binding', 'soak_results_binding']) {
    assert.equal(bindingSteps[stepId].status, 'not_executed');
    assert.equal(bindingSteps[stepId].passed, false);
    assert.equal(bindingSteps[stepId].binding.evidence_id, 'brownie-release-evidence-roundtrip-binding-v1');
    assert.match(bindingSteps[stepId].binding.binding_digest, /^sha256:[a-f0-9]{64}$/);
  }
  assert.deepEqual(
    evidence.sections.soak_test.missing_stateful_steps,
    requiredStatefulSoakStepIds.filter((stepId) => stepId !== 'task_state_transition')
  );
  assert(evidence.fail_closed_reasons.includes('soak_test:not_executed'));
  assert.deepEqual(validateRuntimeOperationalEvidence(evidence), []);
});

test('collector generated evidence contains no forbidden local or raw process details', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-runtime-operational-evidence-test-'));
  const cliPath = path.join(repoRoot, 'target/debug/brownie');
  fs.mkdirSync(path.dirname(cliPath), { recursive: true });
  fs.writeFileSync(cliPath, '#!/bin/sh\necho brownie 0.0.0\n');
  fs.chmodSync(cliPath, 0o755);
  const evidence = buildRuntimeOperationalEvidence({
    repoRoot,
    iterations: 1,
    generatedAt: '2026-09-12T00:00:00.000Z'
  });
  assert.deepEqual(generatedEvidenceForbiddenMatches(evidence), []);
  assert.deepEqual(validateRuntimeOperationalEvidence(evidence), []);
});

test('collector source does not contain raw fixture output payloads', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts/release-runtime-operational-evidence.mjs'), 'utf8');
  assert(!source.includes('const artifactLifecycleEvidence = {'));
  assert(!source.includes('const soakEvidenceFixture = {'));
  assert(!source.includes('actual_output:'));
  assert(!source.includes("stdout: 'Runtime"));
  assert(!source.includes("stderr: ''"));
});

test('accepts fail-closed delegated target command failures', () => {
  const evidence = validEvidence({
    fail_closed_reasons: ['artifact_lifecycle:failed']
  });
  evidence.sections.artifact_lifecycle = section('failed', {
    local_release_targets_status: 'loaded',
    local_release_targets_path: '.brownie/local-release-targets.json',
    local_release_targets_errors: [],
    lifecycle_results: [],
    target_results: [
      {
        target: 'linux-x64',
        kind: 'ssh',
        host: '[redacted-host]',
        workspace: '[redacted-local-evidence]',
        shell: 'posix',
        status: 'blocked_external',
        passed: false,
        commands: [
          {
            exit_code: 255,
            passed: false,
            command_summary: { kind: 'command_summary', word_count: 8, sha256: 'd'.repeat(64) },
            stdout_summary: { kind: 'process_output_summary', byte_length: 0, line_count: 0, sha256: 'e'.repeat(64) },
            stderr_summary: { kind: 'process_output_summary', byte_length: 90, line_count: 1, sha256: 'f'.repeat(64) }
          }
        ]
      }
    ]
  });
  assert.deepEqual(validateRuntimeOperationalEvidence(evidence), []);
});

test('redacts successful delegated target JSON before evidence persistence', () => {
  const delegated = redactDelegatedResult({
    build: {
      command: 'pnpm --workspace-root release:local-artifacts:all',
      stdout: 'artifact written to /Users/example/brownie/dist/brownie',
      stderr: '',
      artifact_path: '/Users/example/brownie/dist/brownie'
    },
    host: 'brownie-linux',
    workspace: '/home/ubuntu/brownie-worktree'
  });
  const evidence = validEvidence({
    fail_closed_reasons: ['artifact_lifecycle:failed']
  });
  evidence.sections.artifact_lifecycle = section('failed', {
    local_release_targets_status: 'loaded',
    local_release_targets_path: '.brownie/local-release-targets.json',
    local_release_targets_errors: [],
    lifecycle_results: [],
    target_results: [
      {
        target: 'linux-x64',
        kind: 'ssh',
        host: '[redacted-host]',
        workspace: '[redacted-local-evidence]',
        shell: 'posix',
        status: 'delegated_artifact_build_completed',
        passed: true,
        delegated_result: delegated,
        commands: [commandSummary()]
      }
    ]
  });
  assert.deepEqual(generatedEvidenceForbiddenMatches(evidence), []);
  assert.deepEqual(validateRuntimeOperationalEvidence(evidence), []);
});

test('rejects satisfied soak evidence with failures', () => {
  const evidence = validEvidence();
  evidence.sections.soak_test.failure_count = 1;
  evidence.sections.soak_test.failure_rate = 0.01;
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('zero failures')));
});

test('rejects satisfied soak evidence without stateful steps', () => {
  const evidence = validEvidence();
  delete evidence.sections.soak_test.stateful_steps;
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('must include stateful_steps')), errors);
});

test('rejects satisfied soak evidence with missing stateful step', () => {
  const evidence = validEvidence();
  evidence.sections.soak_test.stateful_steps = evidence.sections.soak_test.stateful_steps.filter(
    (step) => step.id !== 'process_loss_recovery'
  );
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('process_loss_recovery')), errors);
});

test('rejects satisfied artifact lifecycle with failed command', () => {
  const evidence = validEvidence();
  evidence.sections.artifact_lifecycle.lifecycle_results[0].commands[0] = {
    exit_code: 1,
    passed: false,
    command_summary: { kind: 'command_summary', word_count: 2, sha256: 'a'.repeat(64) }
  };
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('must pass')));
});

test('rejects satisfied golden journey with failed command', () => {
  const evidence = validEvidence();
  evidence.sections.golden_journey_fixture.commands[0] = {
    exit_code: 1,
    passed: false,
    command_summary: { kind: 'command_summary', word_count: 3, sha256: 'a'.repeat(64) }
  };
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('must pass')));
});

test('rejects forbidden local and raw process evidence', () => {
  const evidence = validEvidence();
  evidence.sections.golden_journey_fixture.commands[0] = {
    command: '/Users/example/brownie --version',
    exit_code: 0,
    passed: true,
    stdout: 'raw output',
    stderr: 'raw error'
  };
  evidence.sections.artifact_lifecycle.target_results = [
    {
      target: 'linux-x64',
      kind: 'ssh',
      host: 'brownie-linux',
      workspace: '/home/ubuntu/brownie',
      status: 'blocked_external',
      passed: false,
      commands: []
    }
  ];
  const errors = validateRuntimeOperationalEvidence(evidence);
  assert(errors.some((error) => error.includes('must not store raw process evidence')), errors);
  assert(errors.some((error) => error.includes('must not contain forbidden local evidence')), errors);
});

function physicalRoundtripFixture() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-physical-roundtrip-'));
  const target = 'linux-x64';
  const evidenceDir = `.brownie/release-evidence/artifacts/${target}`;
  const directory = path.join(repoRoot, evidenceDir);
  fs.mkdirSync(directory, { recursive: true });
  const names = { package: 'brownie-linux-x64.tar.gz', binary: 'brownie', runtime: 'brownie-runtime' };
  const hashes = {};
  for (const [kind, name] of Object.entries(names)) {
    const bytes = Buffer.from(`downloaded ${kind} fixture`);
    fs.writeFileSync(path.join(directory, name), bytes);
    hashes[kind] = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
  }
  const commit = 'd'.repeat(40);
  const workflowRunId = '123456';
  const artifact = { archive_sha256: hashes.package, artifact_sha256: hashes.binary, runtime_sha256: hashes.runtime };
  const artifactEvidence = {
    target, platform: 'linux', arch: 'x64',
    archive: { path: `${evidenceDir}/${names.package}`, sha256: hashes.package },
    artifact: { path: `${evidenceDir}/${names.binary}`, target, sha256: hashes.binary,
      source_commit: `sha256:${commit}`, source_clean_tree: 'clean', source_identity: `sha256:${'e'.repeat(64)}` },
    runtime_companion: { path: `${evidenceDir}/${names.runtime}`, sha256: hashes.runtime }
  };
  const writeJson = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value));
  writeJson('artifact-evidence.json', artifactEvidence);
  const journeyChecks = Object.fromEntries(['mode_pack_load', 'workspace_mutation', 'ledger_generation', 'forced_interruption', 'resume', 'stale_replay_rejection'].map(id => [id, { passed: true }]));
  const soakChecks = Object.fromEntries(['artifact_execution_boundary', 'process_loss_recovery', 'duplicate_side_effect_rejection', 'ledger_workspace_consistency', 'resume_replay_behavior', 'finite_convergence', 'evidence_chain_integrity'].map(id => [id, { passed: true }]));
  soakChecks.artifact_execution_boundary = { passed: true, packaged_cli_only: true, isolated_workspace_cwd: true, runtime_path_override_removed: true };
  soakChecks.finite_convergence = { passed: true, commands_executed: 3, maximum_commands: 3 };
  writeJson('runtime-journey-evidence.json', { evidence_id: 'brownie-release-artifact-runtime-journey-v1', target, workflow_run_id: workflowRunId, artifact, checks: journeyChecks });
  writeJson('runtime-stateful-soak-evidence.json', { evidence_id: 'brownie-release-artifact-stateful-soak-v1', target, workflow_run_id: workflowRunId, artifact, checks: soakChecks });
  return { repoRoot, target, evidenceDir, directory, names, artifactEvidence, writeJson, commit, workflowRunId };
}

for (const kind of ['package', 'binary', 'runtime']) {
  for (const operation of ['delete', 'modify']) {
    test(`full Runtime collector rejects ${operation} of the physical ${kind} despite matching receipts`, () => {
      const fixture = physicalRoundtripFixture();
      const previousRun = process.env.GITHUB_RUN_ID;
      const previousSha = process.env.GITHUB_SHA;
      try {
        const file = path.join(fixture.directory, fixture.names[kind]);
        if (operation === 'delete') fs.unlinkSync(file);
        else fs.writeFileSync(file, 'changed physical bytes');
        process.env.GITHUB_RUN_ID = fixture.workflowRunId;
        process.env.GITHUB_SHA = fixture.commit;
        const evidence = buildRuntimeOperationalEvidence({ repoRoot: fixture.repoRoot, iterations: 1, roundtripTarget: fixture.target });
        assert.equal(evidence.release_evidence_binding.status, 'not_executed');
        assert(evidence.fail_closed_reasons.length > 0);
        // A blocked evidence document is valid; its status must not become satisfied.
        assert.deepEqual(validateRuntimeOperationalEvidence(evidence, { repoRoot: fixture.repoRoot, validateBoundEvidence: true }), []);
        const command = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts/release-runtime-operational-evidence.mjs'), '--repo-root', fixture.repoRoot, '--iterations', '1'], { encoding: 'utf8', timeout: 10000 });
        assert.equal(command.status, 1, command.stderr);
        const generated = JSON.parse(command.stdout);
        assert.equal(generated.status, 'failed');
        assert(generated.fail_closed_reasons.length > 0);
        assert.equal(evidence.release_ready, false);
        assert.equal(evidence.runtime_release_ready, false);
      } finally {
        if (previousRun === undefined) delete process.env.GITHUB_RUN_ID; else process.env.GITHUB_RUN_ID = previousRun;
        if (previousSha === undefined) delete process.env.GITHUB_SHA; else process.env.GITHUB_SHA = previousSha;
        fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
      }
    });
  }
}

test('physical binding rejects a declared file outside the repository even when bytes match', () => {
  const fixture = physicalRoundtripFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-physical-outside-'));
  try {
    const source = path.join(fixture.directory, fixture.names.runtime);
    const destination = path.join(outside, fixture.names.runtime);
    fs.copyFileSync(source, destination);
    fixture.artifactEvidence.runtime_companion.path = path.relative(fixture.repoRoot, destination);
    const binding = buildReleaseEvidenceRoundtripBinding({ repoRoot: fixture.repoRoot, testedCommit: fixture.commit,
      workflowRunId: fixture.workflowRunId, artifacts: [{ target: fixture.target, evidence_dir: fixture.evidenceDir, artifact_evidence: fixture.artifactEvidence }] });
    assert.equal(binding.status, 'not_executed');
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('physical binding rejects malformed declared archive metadata instead of falling back to a valid convention file', () => {
  const fixture = physicalRoundtripFixture();
  try {
    fixture.artifactEvidence.archive.sha256 = 'malformed-declared-digest';
    const binding = buildReleaseEvidenceRoundtripBinding({ repoRoot: fixture.repoRoot, testedCommit: fixture.commit,
      workflowRunId: fixture.workflowRunId, artifacts: [{ target: fixture.target, evidence_dir: fixture.evidenceDir, artifact_evidence: fixture.artifactEvidence }] });
    assert.equal(binding.status, 'not_executed');
    assert(binding.bindings[0].errors.includes('package_sha256_missing'));
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});


for (const [name, input] of [
  ['artifact lifecycle', { artifact_lifecycle: { status: 'executable', fail_closed: true } }],
  ['Golden Journey', { golden_journey_fixture: { executed: true } }],
  ['100-iteration stateful soak', { soak_test: { step_ids: requiredStatefulSoakStepIds } }]
]) test(`public collector rejects unobserved synthetic ${name}`, () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-unobserved-operational-'));
  try {
    assert.throws(() => buildRuntimeOperationalEvidence({ repoRoot, ...input }), /Synthetic operational evidence/u);
    assert.deepEqual(fs.readdirSync(repoRoot), []);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

for (const workflowRunId of ['workflow-123', '0', '-1', '1.5', '00123456', 123456]) {
  test(`collector rejects noncanonical workflow identity ${typeof workflowRunId}:${workflowRunId}`, () => {
    const fixture = physicalRoundtripFixture();
    try {
      for (const name of ['runtime-journey-evidence.json', 'runtime-stateful-soak-evidence.json']) {
        const value = JSON.parse(fs.readFileSync(path.join(fixture.directory, name), 'utf8'));
        value.workflow_run_id = workflowRunId;
        fixture.writeJson(name, value);
      }
      const binding = buildReleaseEvidenceRoundtripBinding({
        repoRoot: fixture.repoRoot,
        testedCommit: fixture.commit,
        workflowRunId,
        artifacts: [{target:fixture.target,evidence_dir:fixture.evidenceDir,artifact_evidence:fixture.artifactEvidence}]
      });
      assert.equal(binding.status, 'not_executed');
      const code = typeof workflowRunId === 'string' ? 'workflow_run_id_invalid' : 'workflow_run_id_missing';
      assert(binding.bindings[0].errors.includes(code), JSON.stringify(binding));
    } finally { fs.rmSync(fixture.repoRoot, {recursive:true,force:true}); }
  });
}
