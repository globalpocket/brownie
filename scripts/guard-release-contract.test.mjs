import assert from 'node:assert/strict';
import test from 'node:test';

import { requiredReleaseGateCommands } from './release-gate.mjs';
import { runReleaseContractGuard } from './guard-release-contract.mjs';

const requiredConditionIds = [
  'required_before_release_closed',
  'product_completion_guard',
  'mandatory_ci_success',
  'os_artifacts_generated',
  'artifact_smoke_tests',
  'security_dependency_secret_scans',
  'sbom_generated',
  'checksums_generated',
  'signature_or_integrity_proof',
  'provenance_generated',
  'tested_commit_matches_artifact_commit',
  'audit_trace_matches_tested_commit',
  'no_unresolved_release_blockers',
  'owner_controlled_settings_complete',
  'required_independent_reviews_complete'
];

function condition(id, status = 'missing_evidence') {
  return {
    id,
    status,
    release_blocking: true,
    required_evidence: [`${id} evidence`]
  };
}

function validContract(overrides = {}) {
  return {
    schema_version: 1,
    contract_id: 'runtime-release-engineering-contract-v1',
    phase: 'RRP-8.5',
    owner: 'runtime',
    runtime_release_ready: false,
    release_engineering_maturity: {
      baseline_percent: 58,
      target_percent: 90,
      current_percent: 58,
      scoring_basis: 'No maturity increase is claimed until executable release-gate evidence exists.'
    },
    commit_trace: {
      audited_base_commit: '8016b67262f6e951fd834589637df475e03adb2b',
      implementation_commit: null,
      tested_commit: null,
      release_tag: null,
      workflow_run_id: null,
      artifact_sha256: null,
      contract_registry_fingerprint: 'sha256:contract',
      mode_pack_fingerprint: null,
      product_dod_fingerprint: null
    },
    release_ready_conditions: requiredConditionIds.map((id) =>
      condition(id, id === 'product_completion_guard' ? 'scripted_gate_available' : 'missing_evidence')
    ),
    finite_phase_plan: [
      'phase-a-release-contract',
      'phase-b-mandatory-ci-quality-gate',
      'phase-c-ledger-contract-release-integrity',
      'phase-d-supply-chain-security',
      'phase-e-cross-platform-distribution',
      'phase-f-flaky-recovery-soak',
      'phase-g-release-governance'
    ].map((id) => ({ id, status: 'planned', verification: [`${id} verification`] })),
    local_release_gate: {
      package_script: 'pnpm release:gate',
      commands: requiredReleaseGateCommands.map((entry) => ({
        id: entry.id,
        command: [entry.command, ...entry.args].join(' ')
      }))
    },
    external_blockers: [
      {
        id: 'github_workflow_scope',
        status: 'blocked_external'
      }
    ],
    release_artifact_evidence: {
      artifacts: { status: 'not_generated', path: null },
      sha256sums: { status: 'not_generated', path: null },
      signature: { status: 'blocked_external', path: null },
      sbom: { status: 'not_generated', path: null },
      provenance: { status: 'not_generated', path: null }
    },
    supply_chain_artifact_evidence: {
      contract_id: 'brownie-supply-chain-artifact-evidence-v1',
      default_path: '.brownie/release-evidence/supply-chain-artifact-evidence.json',
      required_sections: [
        'lockfile_fixed',
        'dependency_security_license_scan',
        'secret_scan',
        'sbom',
        'artifacts',
        'artifact_smoke',
        'checksums',
        'signature_or_integrity_proof',
        'provenance'
      ]
    },
    dependency_security_license_audit: {
      contract_id: 'brownie-dependency-security-license-audit-v1',
      default_path: '.brownie/release-evidence/dependency-security-license-audit.json',
      required_checks: ['cargo_audit_locked', 'cargo_deny_policy', 'pnpm_audit_prod']
    },
    ...overrides
  };
}

function validAudit(overrides = {}) {
  return {
    runtime_release_ready: false,
    release_engineering_contract: {
      contract_path: 'docs/architecture/runtime-release-contract.json',
      status: 'partial'
    },
    ...overrides
  };
}

const validPackageJson = {
  scripts: {
    'release:gate': 'node scripts/release-gate.mjs',
    'release:dependency-security-license-audit': 'node scripts/release-dependency-security-license-audit.mjs',
    'release:dependency-security-license-audit:test':
      'node --test scripts/release-dependency-security-license-audit.test.mjs',
    'release:supply-chain-artifact-evidence': 'node scripts/release-supply-chain-artifact-evidence.mjs',
    'guard:release-contract': 'node scripts/guard-release-contract.mjs',
    'guard:release-contract:test': 'node --test scripts/guard-release-contract.test.mjs',
    'guard:dependency-security-license-audit': 'node scripts/guard-dependency-security-license-audit.mjs',
    'guard:dependency-security-license-audit:test':
      'node --test scripts/guard-dependency-security-license-audit.test.mjs',
    'guard:supply-chain-artifact-evidence': 'node scripts/guard-supply-chain-artifact-evidence.mjs',
    'guard:supply-chain-artifact-evidence:test': 'node --test scripts/guard-supply-chain-artifact-evidence.test.mjs'
  }
};

const validVsixPackageJson = {
  scripts: {
    check: 'pnpm --workspace-root guard:release-contract && pnpm --workspace-root guard:release-contract:test && pnpm --workspace-root release:dependency-security-license-audit:test && pnpm --workspace-root guard:dependency-security-license-audit && pnpm --workspace-root guard:dependency-security-license-audit:test && pnpm --workspace-root guard:supply-chain-artifact-evidence && pnpm --workspace-root guard:supply-chain-artifact-evidence:test'
  }
};

function validate(contract, overrides = {}) {
  return runReleaseContractGuard({
    contract,
    audit: overrides.audit ?? validAudit(),
    packageJson: overrides.packageJson ?? validPackageJson,
    vsixPackageJson: overrides.vsixPackageJson ?? validVsixPackageJson,
    releaseGateText: overrides.releaseGateText ?? 'cargo pnpm'
  }).errors;
}

test('accepts fail-closed Runtime release contract', () => {
  assert.deepEqual(validate(validContract()), []);
});

test('rejects missing release-ready condition', () => {
  const contract = validContract({
    release_ready_conditions: validContract().release_ready_conditions.filter(
      (entry) => entry.id !== 'sbom_generated'
    )
  });
  const errors = validate(contract);
  assert(errors.some((error) => error.includes('sbom_generated')));
});

test('rejects runtime release ready without complete evidence', () => {
  const errors = validate(validContract({ runtime_release_ready: true }));
  assert(errors.some((error) => error.includes('runtime_release_ready false')));
});

test('rejects fake satisfied artifact evidence', () => {
  const contract = validContract({
    release_artifact_evidence: {
      ...validContract().release_artifact_evidence,
      sbom: { status: 'satisfied', path: 'dist/sbom.spdx.json' }
    }
  });
  const errors = validate(contract);
  assert(errors.some((error) => error.includes('release_artifact_evidence.sbom')));
});

test('rejects missing release gate package scripts', () => {
  const errors = validate(validContract(), { packageJson: { scripts: {} } });
  assert(errors.some((error) => error.includes('release:gate')));
  assert(errors.some((error) => error.includes('release:dependency-security-license-audit')));
  assert(errors.some((error) => error.includes('release:dependency-security-license-audit:test')));
  assert(errors.some((error) => error.includes('release:supply-chain-artifact-evidence')));
  assert(errors.some((error) => error.includes('guard:release-contract')));
  assert(errors.some((error) => error.includes('guard:release-contract:test')));
  assert(errors.some((error) => error.includes('guard:dependency-security-license-audit')));
  assert(errors.some((error) => error.includes('guard:dependency-security-license-audit:test')));
  assert(errors.some((error) => error.includes('guard:supply-chain-artifact-evidence')));
  assert(errors.some((error) => error.includes('guard:supply-chain-artifact-evidence:test')));
});

test('rejects VSIX check path that omits release contract guard', () => {
  const errors = validate(validContract(), {
    vsixPackageJson: { scripts: { check: 'pnpm --workspace-root guard:runtime-release-readiness' } }
  });
  assert(errors.some((error) => error.includes('guard:release-contract')));
});

test('rejects VSIX check path that omits release contract guard tests', () => {
  const errors = validate(validContract(), {
    vsixPackageJson: { scripts: { check: 'pnpm --workspace-root guard:release-contract' } }
  });
  assert(errors.some((error) => error.includes('guard:release-contract:test')));
});

test('rejects VSIX check path that omits supply-chain evidence guard', () => {
  const errors = validate(validContract(), {
    vsixPackageJson: { scripts: { check: 'pnpm --workspace-root guard:release-contract && pnpm --workspace-root guard:release-contract:test' } }
  });
  assert(errors.some((error) => error.includes('guard:supply-chain-artifact-evidence')));
});

test('rejects missing supply-chain evidence contract section', () => {
  const errors = validate(validContract({ supply_chain_artifact_evidence: undefined }));
  assert(errors.some((error) => error.includes('supply_chain_artifact_evidence.contract_id')));
});

test('rejects missing dependency audit contract section', () => {
  const errors = validate(validContract({ dependency_security_license_audit: undefined }));
  assert(errors.some((error) => error.includes('dependency_security_license_audit.contract_id')));
});

test('rejects missing workflow-scope blocker while workflow edit remains unavailable', () => {
  const errors = validate(validContract({ external_blockers: [] }));
  assert(errors.some((error) => error.includes('github_workflow_scope')));
});
