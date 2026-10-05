import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runSupplyChainArtifactEvidenceGuard } from './guard-supply-chain-artifact-evidence.mjs';

const requiredSections = [
  'lockfile_fixed',
  'dependency_security_license_scan',
  'secret_scan',
  'sbom',
  'artifacts',
  'artifact_smoke',
  'checksums',
  'signature_or_integrity_proof',
  'provenance'
];

test('requiredSections array is complete and non-empty', async (t) => {
  assert.ok(requiredSections.length > 0, 'requiredSections must not be empty');
  assert.ok(requiredSections.length === 9, 'expected exactly 9 required sections');
  for (const section of requiredSections) {
    assert.ok(typeof section === 'string' && section.length > 0, 'each section must be a non-empty string');
  }
});

test('runSupplyChainArtifactEvidenceGuard handles null/undefined input', async (t) => {
  const nullResult = await runSupplyChainArtifactEvidenceGuard(null);
  assert.ok(nullResult !== undefined, 'guard should handle null input');
  assert.ok(Array.isArray(nullResult.errors), 'guard should return structured errors for null input');
  const undefinedResult = await runSupplyChainArtifactEvidenceGuard(undefined);
  assert.ok(undefinedResult !== undefined, 'guard should handle undefined input');
});

test('runSupplyChainArtifactEvidenceGuard validates clean source checkout identity', async (t) => {
  const evidenceWithDirtyCheckout = {
    lockfile_fixed: true,
    dependency_security_license_scan: { status: 'pass' },
    secret_scan: { status: 'pass' },
    sbom: { format: 'spdx', items: [] },
    artifacts: [{ name: 'test', hash: 'abc123' }],
    artifact_smoke: { status: 'pass' },
    checksums: { verified: true },
    signature_or_integrity_proof: { valid: true },
    provenance: { valid: true },
    source_checkout_clean: false
  };
  const result = await runSupplyChainArtifactEvidenceGuard(evidenceWithDirtyCheckout);
  assert.ok(result !== undefined, 'guard should return result for dirty checkout');
  assert.ok(Array.isArray(result.errors), 'guard should return errors for dirty checkout');
});

test('runSupplyChainArtifactEvidenceGuard handles valid artifact evidence', async (t) => {
  const validEvidence = {
    lockfile_fixed: true,
    dependency_security_license_scan: { status: 'pass' },
    secret_scan: { status: 'pass' },
    sbom: { format: 'spdx', items: [] },
    artifacts: [{ name: 'test', hash: 'abc123' }],
    artifact_smoke: { status: 'pass' },
    checksums: { verified: true },
    signature_or_integrity_proof: { valid: true },
    provenance: { verified: true }
  };
  const result = await runSupplyChainArtifactEvidenceGuard(validEvidence);
  assert.ok(result !== undefined, 'guard should return result for valid input');
  assert.ok(Array.isArray(result.errors), 'result should have errors array');
});

function tempRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-supply-chain-guard-'));
  fs.mkdirSync(path.join(repoRoot, '.brownie/release-evidence'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'Cargo.lock'), 'lock');
  fs.writeFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'lock');
  fs.writeFileSync(path.join(repoRoot, '.brownie/release-evidence/brownie-runtime-sbom.json'), '{}\n');
  fs.writeFileSync(path.join(repoRoot, '.brownie/release-evidence/brownie-runtime-provenance.json'), '{}\n');
  fs.writeFileSync(path.join(repoRoot, '.brownie/release-evidence/SHA256SUMS'), '0'.repeat(64) + '  file\n');
  fs.writeFileSync(path.join(repoRoot, '.brownie/release-evidence/lockfile_fixed.json'), '{}\n');
  fs.writeFileSync(path.join(repoRoot, '.brownie/release-evidence/dependency_security_license_scan.json'), '{}\n');
  fs.writeFileSync(path.join(repoRoot, '.brownie/release-evidence/secret_scan.json'), '{}\n');
  fs.writeFileSync(path.join(repoRoot, '.brownie/release-evidence/artifacts.json'), '{}\n');
  fs.writeFileSync(path.join(repoRoot, '.brownie/release-evidence/artifact_smoke.json'), '{}\n');
  fs.writeFileSync(path.join(repoRoot, '.brownie/release-evidence/checksums.json'), '{}\n');
  fs.writeFileSync(path.join(repoRoot, '.brownie/release-evidence/signature_or_integrity_proof.json'), '{}\n');
  return repoRoot;
}

function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function sha256Text(text) {
  return `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`;
}

function artifactWithProvenance(repoRoot, artifactPath, overrides = {}) {
  const sha256 = sha256File(path.join(repoRoot, artifactPath));
  const sourceCommit = `sha256:${'a'.repeat(64)}`;
  const sourceCleanTree = 'clean';
  const sourceIdentity = sha256Text(`${sourceCommit}:${sourceCleanTree}`);
  const binding = {
    implementationCommit: '1'.repeat(40),
    testedCommit: '2'.repeat(40),
    workflowRunId: '123456',
    artifactSha256: sha256,
    platform: 'darwin',
    architecture: 'arm64',
    sourceCheckoutState: 'clean',
    buildSourceCommit: sourceCommit,
    buildSourceCleanTree: sourceCleanTree,
    buildSourceIdentity: sourceIdentity,
    validation: { valid: true },
    buildSourceMetadataValidation: { valid: true }
  };
  return {
    path: artifactPath,
    sha256,
    bytes: fs.statSync(path.join(repoRoot, artifactPath)).size,
    target: 'darwin-arm64',
    source_commit: sourceCommit,
    source_clean_tree: sourceCleanTree,
    source_identity: sourceIdentity,
    provenance_identity: sha256Text(
      [
        binding.implementationCommit,
        binding.testedCommit,
        binding.workflowRunId,
        artifactPath,
        binding.artifactSha256,
        binding.platform,
        binding.architecture
      ].join('\n')
    ),
    provenance_binding: binding,
    ...overrides
  };
}

function validContract(overrides = {}) {
  return {
    phase: 'RRP-8.7',
    runtime_release_ready: false,
    release_engineering_maturity: {
      current_percent: 70,
      target_percent: 90
    },
    local_release_gate: {
      commands: [
        { command: 'pnpm --workspace-root release:dependency-security-license-audit' },
        { command: 'pnpm --workspace-root guard:dependency-security-license-audit' },
        { command: 'pnpm --workspace-root guard:dependency-security-license-audit:test' },
        { command: 'pnpm --workspace-root release:supply-chain-artifact-evidence' },
        { command: 'pnpm --workspace-root guard:supply-chain-artifact-evidence' },
        { command: 'pnpm --workspace-root guard:supply-chain-artifact-evidence:test' }
      ]
    },
    supply_chain_artifact_evidence: {
      contract_id: 'brownie-supply-chain-artifact-evidence-v1',
      default_path: '.brownie/release-evidence/supply-chain-artifact-evidence.json',
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

function validArtifactSmokeResult(overrides = {}) {
  return {
    target: 'darwin-arm64',
    passed: true,
    e2e_steps: [
      'base_mode_pack_load',
      'minimal_task_run',
      'ledger_generation',
      'forced_stop_resume',
      'stale_replay_rejection'
    ],
    commands: [
      { args: ['run', '--mode-pack', 'base'], exit_code: 0, passed: true },
      { args: ['run', '--task', 'minimal'], exit_code: 0, passed: true }
    ],
    ...overrides
  };
}

function validEvidence(repoRoot = tempRepo()) {
  return {
    schema_version: 1,
    evidence_id: 'brownie-supply-chain-artifact-evidence-v1',
    phase: 'RRP-8.4',
    repository: 'globalpocket/brownie',
    release_ready: false,
    runtime_release_ready: false,
    sourceCheckoutState: 'clean',
    required_sections: requiredSections,
    fail_closed_reasons: [
      'dependency_security_license_scan:partial_tooling_missing',
      'artifacts:not_generated',
      'artifact_smoke:not_executed_missing_artifacts',
      'checksums:partial_no_release_artifacts',
      'signature_or_integrity_proof:blocked_external'
    ],
    sections: {
      lockfile_fixed: section('satisfied', {
        lockfiles: [
          { path: 'Cargo.lock', sha256: sha256File(path.join(repoRoot, 'Cargo.lock')) },
          { path: 'pnpm-lock.yaml', sha256: sha256File(path.join(repoRoot, 'pnpm-lock.yaml')) }
        ]
      }),
      dependency_security_license_scan: section('partial_tooling_missing'),
      secret_scan: section('satisfied', { findings_count: 0 }),
      sbom: section('satisfied', {
        path: '.brownie/release-evidence/brownie-runtime-sbom.json',
        sha256: sha256File(path.join(repoRoot, '.brownie/release-evidence/brownie-runtime-sbom.json'))
      }),
      artifacts: section('not_generated', { artifacts: [] }),
      artifact_smoke: section('not_executed_missing_artifacts'),
      checksums: section('partial_no_release_artifacts', {
        path: '.brownie/release-evidence/SHA256SUMS',
        sha256: sha256File(path.join(repoRoot, '.brownie/release-evidence/SHA256SUMS'))
      }),
      signature_or_integrity_proof: section('blocked_external'),
      provenance: section('satisfied', {
        path: '.brownie/release-evidence/brownie-runtime-provenance.json',
        sha256: sha256File(path.join(repoRoot, '.brownie/release-evidence/brownie-runtime-provenance.json'))
      })
    }
  };
}

function validate({ contract = validContract(), evidence, repoRoot = tempRepo(), evidencePath = 'evidence.json' } = {}) {
  return runSupplyChainArtifactEvidenceGuard({
    repoRoot,
    contract,
    evidence: evidence ?? validEvidence(repoRoot),
    evidencePath
  }).errors;
}

test('accepts fail-closed supply-chain evidence with explicit missing artifact reasons', () => {
  assert.deepEqual(validate(), []);
});

test('accepts contract-only mode when generated evidence has not been produced yet', () => {
  const result = runSupplyChainArtifactEvidenceGuard({
    repoRoot: tempRepo(),
    contract: validContract(),
    evidencePath: '.brownie/release-evidence/not-yet-generated.json'
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.validatedEvidence, false);
});

test('rejects missing evidence section', () => {
  const evidence = validEvidence();
  delete evidence.sections.sbom;
  const errors = validate({ evidence });
  assert(errors.some((error) => error.includes('sections.sbom')));
});

test('rejects release-ready claim from supply-chain evidence', () => {
  const errors = validate({ evidence: { ...validEvidence(), release_ready: true } });
  assert(errors.some((error) => error.includes('release_ready true')));
});

test('rejects missing source checkout state', () => {
  const evidence = validEvidence();
  delete evidence.sourceCheckoutState;
  const errors = validate({ evidence });
  assert(errors.some((error) => error.includes('sourceCheckoutState')));
});

test('accepts dirty source checkout only when fail-closed reason records it', () => {
  const evidence = validEvidence();
  evidence.sourceCheckoutState = 'dirty';
  let errors = validate({ evidence });
  assert(errors.some((error) => error.includes('source checkout state')));
  evidence.fail_closed_reasons.push('source_checkout_state:dirty');
  errors = validate({ evidence });
  assert.deepEqual(errors, []);
});

test('rejects incomplete status without fail-closed reason', () => {
  const evidence = validEvidence();
  evidence.fail_closed_reasons = [];
  const errors = validate({ evidence });
  assert(errors.some((error) => error.includes('fail_closed_reasons must include artifacts')));
});

test('rejects absolute artifact evidence paths', () => {
  const evidence = validEvidence();
  evidence.sections.sbom.path = '/tmp/sbom.json';
  const errors = validate({ evidence });
  assert(errors.some((error) => error.includes('repository-relative')));
});

test('rejects contract that omits repository-local supply-chain gate commands', () => {
  const contract = validContract({
    local_release_gate: {
      commands: []
    }
  });
  const errors = validate({ contract });
  assert(errors.some((error) => error.includes('release:supply-chain-artifact-evidence')));
});

test('smoke: guard-supply-chain-artifact-evidence requires all requiredSections', () => {
  const evidence = validEvidence();
  for (const section of requiredSections) {
    delete evidence.sections[section];
    const errors = validate({ evidence });
    assert(errors.some((error) => error.includes(section)), `should reject missing ${section}`);
    evidence.sections[section] = validEvidence().sections[section];
  }
});

test('smoke: guard rejects evidence missing required sections', () => {
  const evidence = validEvidence();
  for (const section of requiredSections) {
    const incompleteEvidence = { ...evidence };
    delete incompleteEvidence.sections[section];
    const errors = validate({ evidence: incompleteEvidence });
    assert.ok(errors.some((error) => error.includes(section)), `should reject missing ${section}`);
  }
});

test('smoke: guard rejects evidence with invalid section paths', () => {
  const evidence = validEvidence();
  evidence.sections.sbom.path = '/absolute/path/sbom.json';
  const errors = validate({ evidence });
  assert.ok(errors.some((error) => error.includes('repository-relative')), 'should reject absolute paths');
});

test('smoke: guard rejects evidence missing fail_closed_reasons', () => {
  const evidence = validEvidence();
  evidence.fail_closed_reasons = undefined;
  const errors = validate({ evidence });
  assert.ok(errors.some((error) => error.includes('fail_closed_reasons')), 'should require fail_closed_reasons');
});

test('smoke: guard rejects evidence with empty fail_closed_reasons when sections invalid', () => {
  const evidence = validEvidence();
  evidence.fail_closed_reasons = [];
  delete evidence.sections.sbom;
  const errors = validate({ evidence });
  assert.ok(errors.some((error) => error.includes('fail_closed_reasons must include')), 'should require fail_closed_reasons to include missing sections');
});

test('smoke: guard rejects evidence missing required sections', () => {
  const evidence = validEvidence();
  evidence.sections.sbom = null;
  const errors = validate({ evidence });
  assert(errors.some((error) => error.includes('sbom')));
});

test('smoke: guard rejects evidence with empty fail_closed_reasons when sections are satisfied', () => {
  const evidence = validEvidence();
  evidence.fail_closed_reasons = [];
  const errors = validate({ evidence });
  assert(errors.some((error) => error.includes('fail_closed_reasons')));
});

test('rejects satisfied dependency scan with failed tool result', () => {
  const evidence = validEvidence();
  evidence.fail_closed_reasons = evidence.fail_closed_reasons.filter(
    (reason) => !reason.startsWith('dependency_security_license_scan:')
  );
  evidence.sections.dependency_security_license_scan = section('satisfied', {
    tools: [
      {
        id: 'cargo_audit',
        available: true,
        passed: false,
        exit_code: 1
      }
    ]
  });
  const errors = validate({ evidence });
  assert(errors.some((error) => error.includes('dependency_security_license_scan.tools[0].passed must be true')));
});

test('accepts failed dependency scan only when it is fail-closed', () => {
  const evidence = validEvidence();
  evidence.sections.dependency_security_license_scan = section('failed', {
    tools: [
      {
        id: 'cargo_audit',
        available: true,
        passed: false,
        exit_code: 1
      }
    ]
  });
  assert.deepEqual(validate({ evidence }), []);
});

test('rejects artifact smoke evidence when artifact_smoke section is missing', () => {
  const evidence = validEvidence();
  delete evidence.sections.artifact_smoke;
  const errors = validate({ evidence });
  assert(errors.some((error) => error.includes('artifact_smoke')));
});

test('accepts artifact smoke evidence when artifact_smoke section is satisfied', () => {
  const evidence = validEvidence();
  evidence.fail_closed_reasons = evidence.fail_closed_reasons.filter(
    (reason) => !reason.startsWith('artifact_smoke:')
  );
  evidence.sections.artifact_smoke = section('satisfied', {
    smoke_results: [
      validArtifactSmokeResult()
    ]
  });
  assert.deepEqual(validate({ evidence }), []);
});

test('rejects missing dependency_security_license_scan section', () => {
  const evidence = validEvidence();
  delete evidence.sections.dependency_security_license_scan;
  const errors = validate({ evidence });
  assert(errors.some((error) => error.includes('dependency_security_license_scan')));
});

test('rejects dependency scan without required tools array', () => {
  const evidence = validEvidence();
  evidence.sections.dependency_security_license_scan = section('satisfied', {});
  const errors = validate({ evidence });
  assert(errors.some((error) => error.includes('dependency_security_license_scan.tools')));
});

test('accepts failed artifact smoke only when fail-closed', () => {
  const evidence = validEvidence();
  evidence.sections.artifact_smoke = section('failed', {
    artifacts: [
      { name: 'brownie-runtime', path: 'target/release/brownie', verified: false }
    ]
  });
  assert.deepEqual(validate({ evidence }), []);
});

test('rejects missing artifact_smoke section', () => {
  const evidence = validEvidence();
  delete evidence.sections.artifact_smoke;
  const errors = validate({ evidence });
  assert(errors.some((error) => error.includes('artifact_smoke')));
});

test('validates dependency audit sync with required tool presence', () => {
  const evidence = validEvidence();
  evidence.sections.dependency_security_license_scan = section('satisfied', {
    tools: [
      {
        id: 'cargo_audit',
        available: true,
        passed: true,
        exit_code: 0
      }
    ]
  });
  assert.deepEqual(validate({ evidence }), []);
});

test('validates each dependency scan tool has required fields', () => {
  const evidence = validEvidence();
  evidence.sections.dependency_security_license_scan = section('satisfied', {
    tools: [
      {
        id: 'cargo_audit',
        available: true
      }
    ]
  });
  const errors = validate({ evidence });
  assert(errors.some((error) => error.includes('tools[0].passed')));
});

test('validates each dependency scan tool has required passed field', () => {
  const evidence = validEvidence();
  evidence.sections.dependency_security_license_scan = section('satisfied', {
    tools: [
      {
        id: 'cargo_audit',
        available: true
      }
    ]
  });
  const errors = validate({ evidence });
  assert(errors.some((error) => error.includes('tools[0].passed')));
});

test('rejects satisfied artifact smoke with failed command result', () => {
  const evidence = validEvidence();
  evidence.fail_closed_reasons = evidence.fail_closed_reasons.filter(
    (reason) => !reason.startsWith('artifact_smoke:')
  );
  evidence.sections.artifact_smoke = section('satisfied', {
    smoke_results: [
      {
        target: 'darwin-arm64',
        passed: true,
        commands: [
          {
            command: 'brownie --version',
            exit_code: 1,
            passed: false
          }
        ]
      }
    ]
  });
  const errors = validate({ evidence });
  assert(errors.some((error) => error.includes('artifact_smoke.smoke_results[0].commands[0] must pass')));
});

test('rejects satisfied artifact smoke without required E2E step evidence', () => {
  const evidence = validEvidence();
  evidence.fail_closed_reasons = evidence.fail_closed_reasons.filter(
    (reason) => !reason.startsWith('artifact_smoke:')
  );
  evidence.sections.artifact_smoke = section('satisfied', {
    smoke_results: [
      {
        target: 'darwin-arm64',
        passed: true,
        commands: [
          { args: ['--version'], exit_code: 0, passed: true },
          { args: ['help', 'run'], exit_code: 0, passed: true }
        ]
      }
    ]
  });
  const errors = validate({ evidence });
  assert(errors.some((error) => error.includes('missing required E2E step base_mode_pack_load')));
  assert(errors.some((error) => error.includes('missing required E2E step minimal_task_run')));
  assert(errors.some((error) => error.includes('missing required E2E step ledger_generation')));
  assert(errors.some((error) => error.includes('missing required E2E step forced_stop_resume')));
  assert(errors.some((error) => error.includes('missing required E2E step stale_replay_rejection')));
});

test('accepts satisfied artifact smoke with required E2E step evidence', () => {
  const evidence = validEvidence();
  evidence.fail_closed_reasons = evidence.fail_closed_reasons.filter(
    (reason) => !reason.startsWith('artifact_smoke:')
  );
  evidence.sections.artifact_smoke = section('satisfied', {
    smoke_results: [
      {
        target: 'darwin-arm64',
        passed: true,
        e2e_steps: [
          'base_mode_pack_load',
          'minimal_task_run',
          'ledger_generation',
          'forced_stop_resume',
          'stale_replay_rejection'
        ],
        commands: [
          { args: ['run', '--mode-pack', 'base'], exit_code: 0, passed: true },
          { args: ['run', '--task', 'minimal'], exit_code: 0, passed: true }
        ]
      }
    ]
  });
  assert.deepEqual(validate({ evidence }), []);
});

test('accepts fail-closed artifacts when source identity is missing', () => {
  const repoRoot = tempRepo();
  const artifactPath = 'target/release/brownie';
  fs.mkdirSync(path.join(repoRoot, 'target/release'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, artifactPath), 'artifact');
  const evidence = validEvidence(repoRoot);
  evidence.fail_closed_reasons = evidence.fail_closed_reasons.filter(
    (reason) => !reason.startsWith('artifacts:')
  );
  evidence.fail_closed_reasons.push('artifacts:partial_source_identity_missing');
  evidence.sections.artifacts = section('partial_source_identity_missing', {
    required_platforms: ['darwin-arm64'],
    present_platforms: ['darwin-arm64'],
    missing_platforms: [],
    missing_source_identity_targets: ['darwin-arm64'],
    artifacts: [
      {
        path: artifactPath,
        sha256: sha256File(path.join(repoRoot, artifactPath)),
        bytes: fs.statSync(path.join(repoRoot, artifactPath)).size,
        target: 'darwin-arm64'
      }
    ]
  });
  assert.deepEqual(validate({ evidence, repoRoot }), []);
});

test('rejects satisfied artifacts without source identity binding', () => {
  const repoRoot = tempRepo();
  const artifactPath = 'target/release/brownie';
  fs.mkdirSync(path.join(repoRoot, 'target/release'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, artifactPath), 'artifact');
  const evidence = validEvidence(repoRoot);
  evidence.fail_closed_reasons = evidence.fail_closed_reasons.filter(
    (reason) => !reason.startsWith('artifacts:')
  );
  evidence.sections.artifacts = section('satisfied', {
    artifacts: [
      {
        path: artifactPath,
        sha256: sha256File(path.join(repoRoot, artifactPath)),
        bytes: fs.statSync(path.join(repoRoot, artifactPath)).size,
        target: 'darwin-arm64'
      }
    ]
  });
  const errors = validate({ evidence, repoRoot });
  assert(errors.some((error) => error.includes('source_commit must be sha256')));
  assert(errors.some((error) => error.includes('source_clean_tree must be clean')));
  assert(errors.some((error) => error.includes('source_identity must be sha256')));
});

test('accepts satisfied artifacts with clean source identity binding', () => {
  const repoRoot = tempRepo();
  const artifactPath = 'target/release/brownie';
  fs.mkdirSync(path.join(repoRoot, 'target/release'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, artifactPath), 'artifact');
  const evidence = validEvidence(repoRoot);
  evidence.fail_closed_reasons = evidence.fail_closed_reasons.filter(
    (reason) => !reason.startsWith('artifacts:')
  );
  evidence.sections.artifacts = section('satisfied', {
    artifacts: [artifactWithProvenance(repoRoot, artifactPath)]
  });
  assert.deepEqual(validate({ evidence, repoRoot }), []);
});

test('rejects satisfied artifacts without provenance binding', () => {
  const repoRoot = tempRepo();
  const artifactPath = 'target/release/brownie';
  fs.mkdirSync(path.join(repoRoot, 'target/release'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, artifactPath), 'artifact');
  const artifact = artifactWithProvenance(repoRoot, artifactPath);
  delete artifact.provenance_binding;
  const evidence = validEvidence(repoRoot);
  evidence.fail_closed_reasons = evidence.fail_closed_reasons.filter(
    (reason) => !reason.startsWith('artifacts:')
  );
  evidence.sections.artifacts = section('satisfied', { artifacts: [artifact] });
  const errors = validate({ evidence, repoRoot });
  assert(errors.some((error) => error.includes('provenance_binding must be present')));
});

test('rejects satisfied artifacts with tampered provenance binding', () => {
  const repoRoot = tempRepo();
  const artifactPath = 'target/release/brownie';
  fs.mkdirSync(path.join(repoRoot, 'target/release'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, artifactPath), 'artifact');
  const artifact = artifactWithProvenance(repoRoot, artifactPath);
  artifact.provenance_binding.workflowRunId = 'different-run';
  const evidence = validEvidence(repoRoot);
  evidence.fail_closed_reasons = evidence.fail_closed_reasons.filter(
    (reason) => !reason.startsWith('artifacts:')
  );
  evidence.sections.artifacts = section('satisfied', { artifacts: [artifact] });
  const errors = validate({ evidence, repoRoot });
  assert(errors.some((error) => error.includes('provenance_identity must match provenance binding')));
});
