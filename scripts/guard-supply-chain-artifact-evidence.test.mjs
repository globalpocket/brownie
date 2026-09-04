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

function tempRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-supply-chain-guard-'));
  fs.mkdirSync(path.join(repoRoot, '.brownie/release-evidence'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'Cargo.lock'), 'lock');
  fs.writeFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'lock');
  fs.writeFileSync(path.join(repoRoot, '.brownie/release-evidence/brownie-runtime-sbom.json'), '{}\n');
  fs.writeFileSync(path.join(repoRoot, '.brownie/release-evidence/brownie-runtime-provenance.json'), '{}\n');
  fs.writeFileSync(path.join(repoRoot, '.brownie/release-evidence/SHA256SUMS'), '0'.repeat(64) + '  file\n');
  return repoRoot;
}

function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function validContract(overrides = {}) {
  return {
    phase: 'RRP-8.5',
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

function validEvidence(repoRoot = tempRepo()) {
  return {
    schema_version: 1,
    evidence_id: 'brownie-supply-chain-artifact-evidence-v1',
    phase: 'RRP-8.4',
    repository: 'globalpocket/brownie',
    release_ready: false,
    runtime_release_ready: false,
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
