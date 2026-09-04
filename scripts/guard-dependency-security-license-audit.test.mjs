import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { requiredReleaseGateCommands } from './release-gate.mjs';
import { runDependencySecurityLicenseAuditGuard } from './guard-dependency-security-license-audit.mjs';

const requiredChecks = ['cargo_audit_locked', 'cargo_deny_policy', 'pnpm_audit_prod'];

function tempRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-dependency-audit-guard-'));
  fs.writeFileSync(path.join(repoRoot, 'Cargo.lock'), 'lock\n');
  fs.writeFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'lock\n');
  fs.writeFileSync(path.join(repoRoot, 'deny.toml'), '[licenses]\n');
  return repoRoot;
}

function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function validContract(overrides = {}) {
  return {
    local_release_gate: {
      commands: requiredReleaseGateCommands.map((entry) => ({
        command: [entry.command, ...entry.args].join(' ')
      }))
    },
    dependency_security_license_audit: {
      contract_id: 'brownie-dependency-security-license-audit-v1',
      default_path: '.brownie/release-evidence/dependency-security-license-audit.json',
      required_checks: requiredChecks
    },
    ...overrides
  };
}

const validPackageJson = {
  scripts: {
    'release:dependency-security-license-audit': 'node scripts/release-dependency-security-license-audit.mjs',
    'guard:dependency-security-license-audit': 'node scripts/guard-dependency-security-license-audit.mjs',
    'guard:dependency-security-license-audit:test':
      'node --test scripts/guard-dependency-security-license-audit.test.mjs'
  }
};

function validEvidence(repoRoot = tempRepo(), overrides = {}) {
  return {
    schema_version: 1,
    evidence_id: 'brownie-dependency-security-license-audit-v1',
    phase: 'RRP-8.5',
    repository: 'globalpocket/brownie',
    release_ready: false,
    runtime_release_ready: false,
    mandatory_gate_passed: false,
    required_checks: requiredChecks,
    fail_closed_reasons: ['cargo_deny_policy:tool_unavailable'],
    lockfiles: [
      { path: 'Cargo.lock', present: true, sha256: sha256File(path.join(repoRoot, 'Cargo.lock')) },
      { path: 'pnpm-lock.yaml', present: true, sha256: sha256File(path.join(repoRoot, 'pnpm-lock.yaml')) }
    ],
    policy: {
      cargo_deny_config: {
        path: 'deny.toml',
        present: true,
        sha256: sha256File(path.join(repoRoot, 'deny.toml'))
      }
    },
    checks: [
      {
        id: 'cargo_audit_locked',
        category: 'rust_vulnerability_audit',
        command: 'cargo audit --locked',
        available: true,
        passed: true,
        status: 'satisfied',
        release_blocking: true
      },
      {
        id: 'cargo_deny_policy',
        category: 'rust_license_advisory_policy',
        command: 'cargo deny check',
        available: false,
        passed: false,
        status: 'tool_unavailable',
        release_blocking: true
      },
      {
        id: 'pnpm_audit_prod',
        category: 'node_vulnerability_audit',
        command: 'pnpm audit --prod --audit-level moderate --json',
        available: true,
        passed: true,
        status: 'satisfied',
        release_blocking: true
      }
    ],
    ...overrides
  };
}

function validate({ contract = validContract(), packageJson = validPackageJson, repoRoot = tempRepo(), evidence } = {}) {
  return runDependencySecurityLicenseAuditGuard({
    repoRoot,
    contract,
    packageJson,
    evidence: evidence ?? validEvidence(repoRoot)
  }).errors;
}

test('accepts fail-closed dependency audit evidence with mandatory checks', () => {
  assert.deepEqual(validate(), []);
});

test('accepts contract-only mode before local evidence is generated', () => {
  const result = runDependencySecurityLicenseAuditGuard({
    repoRoot: tempRepo(),
    contract: validContract(),
    packageJson: validPackageJson,
    evidencePath: '.brownie/release-evidence/not-generated.json'
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.validatedEvidence, false);
});

test('rejects missing dependency audit release gate command', () => {
  const contract = validContract({
    local_release_gate: {
      commands: []
    }
  });
  const errors = validate({ contract });
  assert(errors.some((error) => error.includes('release:dependency-security-license-audit')));
});

test('rejects missing package scripts', () => {
  const errors = validate({ packageJson: { scripts: {} } });
  assert(errors.some((error) => error.includes('release:dependency-security-license-audit')));
  assert(errors.some((error) => error.includes('guard:dependency-security-license-audit')));
  assert(errors.some((error) => error.includes('guard:dependency-security-license-audit:test')));
});

test('rejects runtime release ready claim from dependency audit evidence', () => {
  const errors = validate({ evidence: validEvidence(tempRepo(), { runtime_release_ready: true }) });
  assert(errors.some((error) => error.includes('runtime_release_ready true')));
});

test('rejects incomplete audit check without fail-closed reason', () => {
  const evidence = validEvidence();
  evidence.fail_closed_reasons = [];
  const errors = validate({ evidence });
  assert(errors.some((error) => error.includes('fail_closed_reasons must include cargo_deny_policy')));
});
