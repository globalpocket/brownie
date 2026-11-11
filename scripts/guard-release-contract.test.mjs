import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildReleaseGateCommandEnvironment,
  isExcludedFromHermeticRustTestCopy,
  prepareHermeticRustTestWorkspace,
  releaseGateCommandEnvironmentProfile,
  requiredReleaseGateCommands
} from './release-gate.mjs';
import { requiredConditionIds, runReleaseContractGuard } from './guard-release-contract.mjs';

function pendingTraceContract(overrides = {}) {
  return {
    schema_version: 1,
    contract_id: 'runtime-release-engineering-contract-v1',
    phase: 'RRP-8.7',
    owner: 'runtime',
    runtime_release_ready: false,
    commit_trace: {
      audited_base_commit: '8016b67262f6e951fd834589637df475e03adb2b',
      implementation_commit: null,
      tested_commit: null,
      release_tag: null,
      workflow_run_id: null,
      artifact_sha256: null,
      contract_registry_fingerprint: 'sha256:contract',
      readiness_audit_content_sha256: validAuditContentSha256,
      mode_pack_fingerprint: null,
      product_dod_fingerprint: null,
      ...overrides.commit_trace
    },
    release_ready_conditions: requiredConditionIds.map((id) =>
      condition(id, overrides.status || 'missing_evidence')
    ),
    ...overrides
  };
}

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
    phase: 'RRP-8.7',
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
      readiness_audit_content_sha256: validAuditContentSha256,
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
    runtime_operational_evidence: {
      contract_id: 'brownie-runtime-operational-evidence-v1',
      default_path: '.brownie/release-evidence/runtime-operational-evidence.json',
      required_sections: ['artifact_lifecycle', 'golden_journey_fixture', 'soak_test']
    },
    dependency_security_license_audit: {
      contract_id: 'brownie-dependency-security-license-audit-v1',
      default_path: '.brownie/release-evidence/dependency-security-license-audit.json',
      required_checks: ['cargo_audit_locked', 'cargo_deny_policy', 'pnpm_audit_prod']
    },
    owner_governance_evidence: {
      contract_id: 'brownie-owner-governance-evidence-v1',
      default_path: '.brownie/release-evidence/owner-governance-evidence.json',
      required_sections: [
        'branch_protection',
        'required_status_checks',
        'protected_tag_policy',
        'remote_ci_workflow_provenance',
        'signature_or_integrity_authority',
        'independent_reviews',
        'oss_license_publish_posture'
      ]
    },
    ...overrides
  };
}

test('release gate removes every inherited Brownie setting from the Rust test process and isolates Cargo output', () => {
  const rustTest = requiredReleaseGateCommands.find((entry) => entry.id === 'rust_test');
  const nodeCheck = requiredReleaseGateCommands.find((entry) => entry.id === 'node_check');
  const sourceEnvironment = {
    PATH: '/test/bin',
    BROWNIE_RUNTIME_PATH: '/configured/runtime',
    BROWNIE_CLI_RUN_MODE_ID: 'configured-mode',
    BROWNIE_LLM_API_KEY: 'fixture-key',
    BROWNIE_UNEXPECTED_INHERITED_SETTING: 'fixture-value'
  };

  const rustTestEnvironment = buildReleaseGateCommandEnvironment(rustTest, sourceEnvironment, {
    cargoTargetDir: '/tmp/brownie-release-gate-rust-target-fixture'
  });
  assert.equal(releaseGateCommandEnvironmentProfile(rustTest), 'hermetic_rust_test_workspace_copy');
  assert.equal(rustTestEnvironment.PATH, '/test/bin');
  assert.equal(rustTestEnvironment.CARGO_INCREMENTAL, '0');
  assert.deepEqual(
    Object.keys(rustTestEnvironment).filter((name) => name.startsWith('BROWNIE_')),
    []
  );
  assert.equal(rustTestEnvironment.CARGO_TARGET_DIR, '/tmp/brownie-release-gate-rust-target-fixture');

  const nodeCheckEnvironment = buildReleaseGateCommandEnvironment(nodeCheck, sourceEnvironment);
  assert.equal(releaseGateCommandEnvironmentProfile(nodeCheck), 'selected_deployment');
  assert.equal(nodeCheckEnvironment.BROWNIE_RUNTIME_PATH, '/configured/runtime');
  assert.equal(nodeCheckEnvironment.BROWNIE_CLI_RUN_MODE_ID, 'configured-mode');
});

test('hermetic Rust test workspace copies source while excluding local state and build products', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-release-gate-copy-'));
  const repoRoot = path.join(fixture, 'repo');
  const ephemeralRoot = path.join(fixture, 'ephemeral');
  const sourceFile = path.join(repoRoot, 'crates', 'brownie-cli', 'src', 'lib.rs');
  const privateState = path.join(repoRoot, '.brownie', 'private', 'phase-loop.env');
  const historicalFixture = path.join(
    repoRoot,
    'crates',
    'brownie-store',
    'tests',
    'fixtures',
    'historical-ledger',
    'v1-running-task',
    '.brownie',
    'runs',
    'state.json'
  );
  const buildArtifact = path.join(repoRoot, 'target', 'debug', 'brownie');
  const dependencyArtifact = path.join(repoRoot, 'node_modules', 'fixture-package', 'index.js');

  try {
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.mkdirSync(path.dirname(privateState), { recursive: true });
    fs.mkdirSync(path.dirname(historicalFixture), { recursive: true });
    fs.mkdirSync(path.dirname(buildArtifact), { recursive: true });
    fs.mkdirSync(path.dirname(dependencyArtifact), { recursive: true });
    fs.writeFileSync(sourceFile, 'pub fn copied() {}\n');
    fs.writeFileSync(privateState, 'private=true\n');
    fs.writeFileSync(historicalFixture, 'historical fixture\n');
    fs.writeFileSync(buildArtifact, 'generated\n');
    fs.writeFileSync(dependencyArtifact, 'dependency\n');

    const workspaceRoot = prepareHermeticRustTestWorkspace(repoRoot, ephemeralRoot);

    assert.equal(fs.readFileSync(path.join(workspaceRoot, 'crates', 'brownie-cli', 'src', 'lib.rs'), 'utf8'), 'pub fn copied() {}\n');
    assert.equal(fs.existsSync(path.join(workspaceRoot, '.brownie')), false);
    assert.equal(
      fs.readFileSync(
        path.join(
          workspaceRoot,
          'crates',
          'brownie-store',
          'tests',
          'fixtures',
          'historical-ledger',
          'v1-running-task',
          '.brownie',
          'runs',
          'state.json'
        ),
        'utf8'
      ),
      'historical fixture\n'
    );
    assert.equal(fs.existsSync(path.join(workspaceRoot, 'target')), false);
    assert.equal(fs.existsSync(path.join(workspaceRoot, 'node_modules')), false);
    const tracked = spawnSync('git', ['ls-files', '--', 'crates/brownie-cli/src/lib.rs'], {
      cwd: workspaceRoot,
      encoding: 'utf8'
    });
    assert.equal(tracked.status, 0);
    assert.equal(tracked.stdout.trim(), 'crates/brownie-cli/src/lib.rs');
    assert.equal(isExcludedFromHermeticRustTestCopy(repoRoot, privateState), true);
    assert.equal(isExcludedFromHermeticRustTestCopy(repoRoot, buildArtifact), true);
    assert.equal(isExcludedFromHermeticRustTestCopy(repoRoot, dependencyArtifact), true);
    assert.equal(isExcludedFromHermeticRustTestCopy(repoRoot, sourceFile), false);
    assert.equal(isExcludedFromHermeticRustTestCopy(repoRoot, historicalFixture), false);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

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

const validAuditText = JSON.stringify(validAudit(), null, 2);
const validAuditContentSha256 = 'sha256:' + crypto.createHash('sha256').update(validAuditText).digest('hex');

const validPackageJson = {
  scripts: {
    'release:gate': 'node scripts/release-gate.mjs',
    'release:dependency-security-license-audit': 'node scripts/release-dependency-security-license-audit.mjs',
    'release:dependency-security-license-audit:test':
      'node --test scripts/release-dependency-security-license-audit.test.mjs',
    'release:local-artifact': 'node scripts/release-local-artifact.mjs',
    'release:local-artifacts:all': 'node scripts/release-local-artifacts-all.mjs',
    'release:linux-vm-create': 'node scripts/create-linux-release-vm.mjs',
    'release:windows-vm-create': 'node scripts/create-windows-release-vm.mjs',
    'release:vm-bootstrap': 'node scripts/bootstrap-release-vms.mjs',
    'release:vm-image': 'node scripts/manage-release-vm-images.mjs',
    'release:supply-chain-artifact-evidence': 'node scripts/release-supply-chain-artifact-evidence.mjs',
    'release:runtime-operational-evidence': 'node scripts/release-runtime-operational-evidence.mjs',
    'release:integrity-verify': 'node scripts/release-integrity-verify.mjs',
    'release:owner-governance-evidence': 'node scripts/release-owner-governance-evidence.mjs',
    'release:owner-governance-evidence:test': 'node --test scripts/release-owner-governance-evidence.test.mjs',
    'phase-loop:todo-state:test': 'node --test scripts/phase-loop-todo-state.test.mjs',
    'phase-loop:supervisor-diagnose:test': 'node --test scripts/phase-loop-supervisor-diagnose.test.mjs',
    'phase-loop:supervisor-control:test': 'node --test scripts/phase-loop-supervisor-control.test.mjs',
    'guard:local-release-targets': 'node scripts/guard-local-release-targets.mjs',
    'guard:release-contract': 'node scripts/guard-release-contract.mjs',
    'guard:release-contract:test': 'node --test scripts/guard-release-contract.test.mjs',
    'guard:trace-binding': 'node scripts/release-gate.mjs --validate-trace-binding --test-schema',
    'guard:trace-binding:test': 'node scripts/release-gate.mjs --validate-trace-binding --test-schema',
    'guard:dependency-security-license-audit': 'node scripts/guard-dependency-security-license-audit.mjs',
    'guard:dependency-security-license-audit:test':
      'node --test scripts/guard-dependency-security-license-audit.test.mjs',
    'guard:supply-chain-artifact-evidence': 'node scripts/guard-supply-chain-artifact-evidence.mjs',
    'guard:supply-chain-artifact-evidence:test': 'node --test scripts/guard-supply-chain-artifact-evidence.test.mjs',
    'guard:runtime-operational-evidence': 'node scripts/guard-runtime-operational-evidence.mjs',
    'guard:runtime-operational-evidence:test': 'node --test scripts/guard-runtime-operational-evidence.test.mjs',
    'guard:modepack-distribution-trust': 'node scripts/guard-modepack-distribution-trust.mjs',
    'guard:modepack-distribution-trust:test': 'node --test scripts/guard-modepack-distribution-trust.test.mjs',
    'guard:ledger-contract-single-source': 'node scripts/guard-ledger-contract-single-source.mjs',
    'guard:ledger-contract-single-source:test': 'node --test scripts/guard-ledger-contract-single-source.test.mjs',
    'guard:historical-ledger-fixtures': 'node scripts/guard-historical-ledger-fixtures.mjs',
    'guard:historical-ledger-fixtures:test': 'node --test scripts/guard-historical-ledger-fixtures.test.mjs',
    'guard:owner-governance-evidence': 'node scripts/guard-owner-governance-evidence.mjs',
    'guard:owner-governance-evidence:test': 'node --test scripts/guard-owner-governance-evidence.test.mjs'
  }
};

const validVsixPackageJson = {
  scripts: {
    check: 'pnpm --workspace-root guard:release-contract && pnpm --workspace-root guard:release-contract:test && pnpm --workspace-root release:gate -- --dry-run && pnpm --workspace-root release:dependency-security-license-audit:test && pnpm --workspace-root guard:dependency-security-license-audit && pnpm --workspace-root guard:dependency-security-license-audit:test && pnpm --workspace-root guard:local-release-targets && pnpm --workspace-root guard:supply-chain-artifact-evidence && pnpm --workspace-root guard:supply-chain-artifact-evidence:test && pnpm --workspace-root guard:runtime-operational-evidence && pnpm --workspace-root guard:runtime-operational-evidence:test && pnpm --workspace-root guard:modepack-distribution-trust && pnpm --workspace-root guard:modepack-distribution-trust:test && pnpm --workspace-root guard:ledger-contract-single-source && pnpm --workspace-root guard:ledger-contract-single-source:test && pnpm --workspace-root guard:historical-ledger-fixtures && pnpm --workspace-root guard:historical-ledger-fixtures:test && pnpm --workspace-root guard:owner-governance-evidence && pnpm --workspace-root guard:owner-governance-evidence:test && pnpm --workspace-root release:owner-governance-evidence:test && pnpm --workspace-root phase-loop:todo-state:test && pnpm --workspace-root phase-loop:supervisor-diagnose:test && pnpm --workspace-root phase-loop:supervisor-control:test'
  }
};

function validate(contract, overrides = {}) {
  return runReleaseContractGuard({
    contract,
    audit: overrides.audit ?? validAudit(),
    auditText: overrides.auditText ?? validAuditText,
    packageJson: overrides.packageJson ?? validPackageJson,
    vsixPackageJson: overrides.vsixPackageJson ?? validVsixPackageJson,
    releaseGateText: overrides.releaseGateText ?? 'cargo pnpm'
  }).errors;
}

test('accepts fail-closed Runtime release contract', () => {
  assert.deepEqual(validate(validContract()), []);
});

test('rejects stale readiness audit content hash when audit text changes', () => {
  const errors = validate(validContract(), { auditText: validAuditText + '\nchanged' });
  assert(errors.some((error) => error.includes('commit_trace.readiness_audit_content_sha256 must match')));
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

test('rejects implemented artifact provenance evidence with null commit bindings', () => {
  const contract = validContract({
    release_artifact_evidence: {
      ...validContract().release_artifact_evidence,
      artifacts: { status: 'implemented_sufficient', path: '.brownie/release-evidence/artifacts.json' },
      sha256sums: { status: 'implemented_sufficient', path: '.brownie/release-evidence/SHA256SUMS' },
      sbom: { status: 'implemented_sufficient', path: '.brownie/release-evidence/brownie-runtime-sbom.json' },
      provenance: { status: 'implemented_sufficient', path: '.brownie/release-evidence/brownie-runtime-provenance.json' }
    }
  });
  const errors = validate(contract);
  assert(errors.some((error) => error.includes('commit_trace.implementation_commit')));
  assert(errors.some((error) => error.includes('commit_trace.tested_commit')));
  assert(errors.some((error) => error.includes('commit_trace.workflow_run_id')));
  assert(errors.some((error) => error.includes('commit_trace.artifact_sha256')));
});

test('rejects missing release gate package scripts', () => {
  const errors = validate(validContract(), { packageJson: { scripts: {} } });
  assert(errors.some((error) => error.includes('release:gate')));
  assert(errors.some((error) => error.includes('release:dependency-security-license-audit')));
  assert(errors.some((error) => error.includes('release:dependency-security-license-audit:test')));
  assert(errors.some((error) => error.includes('release:local-artifact')));
  assert(errors.some((error) => error.includes('release:local-artifacts:all')));
  assert(errors.some((error) => error.includes('release:linux-vm-create')));
  assert(errors.some((error) => error.includes('release:windows-vm-create')));
  assert(errors.some((error) => error.includes('release:vm-bootstrap')));
  assert(errors.some((error) => error.includes('release:vm-image')));
  assert(errors.some((error) => error.includes('release:supply-chain-artifact-evidence')));
  assert(errors.some((error) => error.includes('release:runtime-operational-evidence')));
  assert(errors.some((error) => error.includes('phase-loop:todo-state:test')));
  assert(errors.some((error) => error.includes('phase-loop:supervisor-diagnose:test')));
  assert(errors.some((error) => error.includes('phase-loop:supervisor-control:test')));
  assert(errors.some((error) => error.includes('guard:local-release-targets')));
  assert(errors.some((error) => error.includes('guard:release-contract')));
  assert(errors.some((error) => error.includes('guard:release-contract:test')));
  assert(errors.some((error) => error.includes('guard:trace-binding')));
  assert(errors.some((error) => error.includes('guard:trace-binding:test')));
  assert(errors.some((error) => error.includes('guard:dependency-security-license-audit')));
  assert(errors.some((error) => error.includes('guard:dependency-security-license-audit:test')));
  assert(errors.some((error) => error.includes('guard:supply-chain-artifact-evidence')));
  assert(errors.some((error) => error.includes('guard:supply-chain-artifact-evidence:test')));
  assert(errors.some((error) => error.includes('guard:runtime-operational-evidence')));
  assert(errors.some((error) => error.includes('guard:runtime-operational-evidence:test')));
  assert(errors.some((error) => error.includes('guard:modepack-distribution-trust')));
  assert(errors.some((error) => error.includes('guard:modepack-distribution-trust:test')));
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

test('rejects VSIX check path that omits release gate dry run', () => {
  const errors = validate(validContract(), {
    vsixPackageJson: {
      scripts: {
        check: 'pnpm --workspace-root guard:release-contract && pnpm --workspace-root guard:release-contract:test && pnpm --workspace-root release:dependency-security-license-audit:test && pnpm --workspace-root guard:dependency-security-license-audit && pnpm --workspace-root guard:dependency-security-license-audit:test && pnpm --workspace-root guard:supply-chain-artifact-evidence && pnpm --workspace-root guard:supply-chain-artifact-evidence:test'
      }
    }
  });
  assert(errors.some((error) => error.includes('release:gate dry-run')));
});

test('rejects VSIX check path that omits supply-chain evidence guard', () => {
  const errors = validate(validContract(), {
    vsixPackageJson: { scripts: { check: 'pnpm --workspace-root guard:release-contract && pnpm --workspace-root guard:release-contract:test' } }
  });
  assert(errors.some((error) => error.includes('guard:supply-chain-artifact-evidence')));
});

test('rejects VSIX check path that omits Mode Pack distribution trust guard', () => {
  const errors = validate(validContract(), {
    vsixPackageJson: {
      scripts: {
        check: 'pnpm --workspace-root guard:release-contract && pnpm --workspace-root guard:release-contract:test && pnpm --workspace-root guard:supply-chain-artifact-evidence && pnpm --workspace-root guard:supply-chain-artifact-evidence:test'
      }
    }
  });
  assert(errors.some((error) => error.includes('guard:modepack-distribution-trust')));
});

test('rejects VSIX check path that omits phase-loop supervisor tests', () => {
  const errors = validate(validContract(), {
    vsixPackageJson: {
      scripts: {
        check: validVsixPackageJson.scripts.check.replace(' && pnpm --workspace-root phase-loop:supervisor-diagnose:test && pnpm --workspace-root phase-loop:supervisor-control:test', '')
      }
    }
  });
  assert(errors.some((error) => error.includes('phase-loop:supervisor-diagnose:test')));
  assert(errors.some((error) => error.includes('phase-loop:supervisor-control:test')));
});

test('rejects VSIX check path that omits the shared TODO state model tests', () => {
  const errors = validate(validContract(), {
    vsixPackageJson: {
      scripts: {
        check: validVsixPackageJson.scripts.check.replace(' && pnpm --workspace-root phase-loop:todo-state:test', '')
      }
    }
  });
  assert(errors.some((error) => error.includes('phase-loop:todo-state:test')));
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

// Isolated on-disk evidence with an actual Git history. Fixture records never
// establish Runtime readiness or real release execution.
function executableTraceFixture(t) {
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'brownie-contract-trace-'));
 t.after(()=>fs.rmSync(scratch,{recursive:true,force:true}));
 const contract=validContract();
 const digest=bytes=>'sha256:'+crypto.createHash('sha256').update(bytes).digest('hex');
 const run=(cwd,command,args)=>{
  const result=spawnSync(command,args,{cwd,encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
  assert.equal(result.status,0,result.stderr);return result.stdout.trim();
 };
 run(scratch,'git',['init','-q']);run(scratch,'git',['config','user.name','Guard fixture']);run(scratch,'git',['config','user.email','guard-fixture@example.invalid']);
 fs.writeFileSync(path.join(scratch,'source.txt'),'fixture source one\n');fs.writeFileSync(path.join(scratch,'Cargo.lock'),'fixture lock\n');fs.mkdirSync(path.join(scratch,'.brownie/release-evidence'),{recursive:true});fs.writeFileSync(path.join(scratch,'.brownie/release-evidence/tracked-fixture.txt'),'old generated evidence\n');
 const contractFile='docs/architecture/runtime-release-contract.json',decisionFile='docs/architecture/owner-integrity-authority-decision.json';
 const decision={schema_version:1,decision_id:'brownie-owner-integrity-authority-decision-v1',decision_status:'approved',owner_approved:true,approved_mechanism:'protected-git-ref-ci-provenance-sha256sums-integrity-verification'};
 fs.mkdirSync(path.join(scratch,'docs/architecture'),{recursive:true});fs.writeFileSync(path.join(scratch,contractFile),JSON.stringify(contract));fs.writeFileSync(path.join(scratch,decisionFile),JSON.stringify(decision));
 run(scratch,'git',['add','source.txt','Cargo.lock','.brownie/release-evidence/tracked-fixture.txt',contractFile,decisionFile]);run(scratch,'git',['commit','-qm','fixture source']);
 const head=run(scratch,'git',['rev-parse','HEAD']);
 const write=(relative,bytes)=>{const file=path.join(scratch,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);return file;};
 const writeJson=(relative,value)=>write(relative,JSON.stringify(value,null,2)+'\n');
 const binary='.brownie/release-evidence/fixture-artifact';const bytes=Buffer.from('isolated guard input, not a Runtime artifact\n');write(binary,bytes);
 const sha=digest(bytes),sourceCommit='sha256:'+head,identity=digest(sourceCommit+':clean');
 const provenance={implementationCommit:head,testedCommit:head,workflowRunId:'123456',artifactSha256:sha,platform:'darwin',architecture:'arm64',
  sourceCheckoutState:'clean',buildSourceCommit:sourceCommit,buildSourceCleanTree:'clean',buildSourceIdentity:identity,validation:{valid:true},buildSourceMetadataValidation:{valid:true}};
 const artifact={path:binary,sha256:sha,bytes:bytes.length,target:'darwin-arm64',source_commit:sourceCommit,source_clean_tree:'clean',source_identity:identity,
  provenance_identity:digest([head,head,'123456',binary,sha,'darwin','arm64'].join('\n')),provenance_binding:provenance};
 const binding={target:'darwin-arm64',status:'satisfied',implementation_commit:sourceCommit,tested_commit:head,workflow_run_id:'123456',platform:'darwin',architecture:'arm64',
  package_sha256:digest('fixture package'),binary_sha256:sha,runtime_sha256:digest('fixture companion'),errors:[]};
 const witness={...binding};binding.journey_evidence_path='.brownie/release-evidence/fixture-journey.json';binding.soak_evidence_path='.brownie/release-evidence/fixture-soak.json';
 const roundtrip={schema_version:1,evidence_id:'brownie-release-evidence-roundtrip-binding-v1',status:'satisfied',release_blocking:true,target_count:1,satisfied_target_count:1,
  binding_digest:digest(JSON.stringify([witness])),bindings:[binding],missing:[]};
 const checks=ids=>Object.fromEntries(ids.map(id=>[id,{passed:true}]));
 const artifactIdentity={archive_sha256:binding.package_sha256,artifact_sha256:sha,runtime_sha256:binding.runtime_sha256};
 writeJson(binding.journey_evidence_path,{evidence_id:'brownie-release-artifact-runtime-journey-v1',target:binding.target,workflow_run_id:binding.workflow_run_id,artifact:artifactIdentity,
  checks:checks(['mode_pack_load','workspace_mutation','ledger_generation','forced_interruption','resume','stale_replay_rejection'])});
 const soakChecks=checks(['artifact_execution_boundary','process_loss_recovery','duplicate_side_effect_rejection','ledger_workspace_consistency','resume_replay_behavior','finite_convergence','evidence_chain_integrity']);
 Object.assign(soakChecks.artifact_execution_boundary,{packaged_cli_only:true,isolated_workspace_cwd:true,runtime_path_override_removed:true});
 writeJson(binding.soak_evidence_path,{evidence_id:'brownie-release-artifact-stateful-soak-v1',target:binding.target,workflow_run_id:binding.workflow_run_id,artifact:artifactIdentity,checks:soakChecks});
 const section=(status,extra={})=>({status,release_blocking:true,...extra});
 const reasons=[];const partial=(id,status)=>{reasons.push(id+':'+status);return section(status);};
 const lock=path.join(scratch,'Cargo.lock');
 const supply={schema_version:1,evidence_id:'brownie-supply-chain-artifact-evidence-v1',phase:'RRP-8.4',repository:'fixture/identity-guard',release_ready:false,runtime_release_ready:false,
  source_tree_dirty:false,sourceCheckoutState:'clean',source_checkout:{state:'clean',validation:{valid:true}},
  required_sections:['lockfile_fixed','dependency_security_license_scan','secret_scan','sbom','artifacts','artifact_smoke','checksums','signature_or_integrity_proof','provenance'],
  fail_closed_reasons:reasons,sections:{lockfile_fixed:section('satisfied',{lockfiles:[{path:'Cargo.lock',sha256:digest(fs.readFileSync(lock))}]}),
   dependency_security_license_scan:partial('dependency_security_license_scan','partial_tooling_missing'),secret_scan:section('satisfied',{findings_count:0}),
   sbom:partial('sbom','not_generated'),artifacts:section('satisfied',{artifacts:[artifact],release_evidence_binding:roundtrip}),
   artifact_smoke:partial('artifact_smoke','not_executed_missing_artifacts'),checksums:partial('checksums','partial_no_release_artifacts'),
   signature_or_integrity_proof:partial('signature_or_integrity_proof','blocked_external'),provenance:partial('provenance','not_generated')}};
 const evidencePath=contract.supply_chain_artifact_evidence.default_path;writeJson(evidencePath,supply);
 const good=structuredClone(contract);good.commit_trace.implementation_commit=head;good.commit_trace.tested_commit=head;good.commit_trace.workflow_run_id='123456';good.commit_trace.artifact_sha256=sha;
 good.release_artifact_evidence.artifacts={status:'implemented_sufficient',path:binary};
 // This matrix tests the trace guard only; do not manufacture Runtime evidence.
 good.release_ready_conditions=good.release_ready_conditions.map(item=>['artifact_smoke_tests','tested_commit_matches_artifact_commit','audit_trace_matches_tested_commit'].includes(item.id)?{...item,status:'missing_evidence'}:item);
 const validate=input=>runReleaseContractGuard({repoRoot:scratch,contract:input??good,
  audit:validAudit(),auditText:validAuditText,packageJson:validPackageJson,
  vsixPackageJson:validVsixPackageJson,releaseGateText:'cargo pnpm'}).errors;
 return {scratch,contract:good,supply,binding,binary,bytes,head,evidencePath,digest,run,write,writeJson,validate,contractFile,decisionFile,decision,roundtrip};
}

test('trace binding accepts matching physical evidence without declaring Runtime ready',t=>{
 const f=executableTraceFixture(t);assert.deepEqual(f.validate(),[]);assert.equal(f.contract.runtime_release_ready,false);
});

for(const [field,value] of [
 ['implementation_commit',null],['tested_commit',null],['workflow_run_id',null],['artifact_sha256',null],
 ['implementation_commit','not-a-commit'],['tested_commit','not-a-commit'],
 ['workflow_run_id','not-a-workflow'],['workflow_run_id','0'],['artifact_sha256','not-a-sha256']
])test(`trace binding rejects invalid ${field}: ${String(value)}`,t=>{
 const f=executableTraceFixture(t);f.contract.commit_trace[field]=value;
 assert(f.validate().some(error=>error.includes('commit_trace.'+field)));
});

for(const [name,mutate] of [
 ['workflow mismatch',f=>{f.contract.commit_trace.workflow_run_id='999999';}],
 ['artifact digest mismatch',f=>{f.contract.commit_trace.artifact_sha256='sha256:'+'f'.repeat(64);}],
 ['dirty source metadata',f=>{f.supply.source_tree_dirty=true;f.writeJson(f.evidencePath,f.supply);}],
 ['target platform mismatch',f=>{f.supply.sections.artifacts.artifacts[0].provenance_binding.platform='linux';f.writeJson(f.evidencePath,f.supply);}],
 ['source identity mismatch',f=>{f.supply.sections.artifacts.artifacts[0].source_identity='sha256:'+'f'.repeat(64);f.writeJson(f.evidencePath,f.supply);}],
 ['missing roundtrip reference',f=>{delete f.supply.sections.artifacts.release_evidence_binding;f.writeJson(f.evidencePath,f.supply);}],
 ['changed physical artifact',f=>{f.write(f.binary,'tampered artifact');}],
 ['absent artifact reference',f=>{f.contract.release_artifact_evidence.artifacts.path='.brownie/release-evidence/absent';}],
 ['inconsistent journey workflow',f=>{const p=f.binding.journey_evidence_path;const value=JSON.parse(fs.readFileSync(path.join(f.scratch,p),'utf8'));value.workflow_run_id='999999';f.writeJson(p,value);}],
 ['missing soak check',f=>{const p=f.binding.soak_evidence_path;const value=JSON.parse(fs.readFileSync(path.join(f.scratch,p),'utf8'));delete value.checks.finite_convergence;f.writeJson(p,value);}]
])test('trace binding rejects '+name,t=>{
 const f=executableTraceFixture(t);assert.deepEqual(f.validate(),[]);mutate(f);assert(f.validate().length>0);
});

test('trace binding rejects an actually changed tested source tree',t=>{
 const f=executableTraceFixture(t);f.write('source.txt','changed source\n');
 f.run(f.scratch,'git',['add','source.txt']);f.run(f.scratch,'git',['commit','-qm','changed fixture source']);
 assert(f.validate().some(error=>error.includes('current audited source tree')));
});

test('trace binding rejects uncommitted tracked source changes',t=>{
 const f=executableTraceFixture(t);f.write('source.txt','dirty source\n');
 assert(f.validate().some(error=>error.includes('dirty source checkout')));
});

test('trace binding accepts a refresh of tracked generated evidence',t=>{
 const f=executableTraceFixture(t);f.write('.brownie/release-evidence/tracked-fixture.txt','refreshed generated evidence\n');
 assert.deepEqual(f.validate(),[]);
});

test('trace binding accepts a distinct implementation and actual two-parent tested merge candidate',t=>{
 const f=executableTraceFixture(t);
 f.run(f.scratch,'git',['commit','--allow-empty','-qm','alternate fixture parent']);
 const other=f.run(f.scratch,'git',['rev-parse','HEAD']);const tree=f.run(f.scratch,'git',['rev-parse','HEAD^{tree}']);
 const candidate=f.run(f.scratch,'git',['commit-tree',tree,'-p',f.head,'-p',other,'-m','tested fixture merge']);
 f.run(f.scratch,'git',['reset','--hard',candidate]);const source='sha256:'+candidate,identity=f.digest(source+':clean');
 const a=f.supply.sections.artifacts.artifacts[0];a.source_commit=source;a.source_identity=identity;
 Object.assign(a.provenance_binding,{testedCommit:candidate,buildSourceCommit:source,buildSourceIdentity:identity});
 a.provenance_identity=f.digest([f.head,candidate,'123456',f.binary,a.sha256,'darwin','arm64'].join('\n'));
 f.supply.sections.artifacts.release_evidence_binding.bindings[0].tested_commit=candidate;
 f.contract.commit_trace.tested_commit=candidate;f.writeJson(f.evidencePath,f.supply);
 assert.notEqual(f.head,candidate);assert.deepEqual(f.validate(),[]);
});

for(const committed of [false,true])test(`persisted tracked trace remains valid with metadata committed=${committed}`,t=>{
 const f=executableTraceFixture(t);f.writeJson(f.contractFile,f.contract);
 if(committed){f.run(f.scratch,'git',['add',f.contractFile]);f.run(f.scratch,'git',['commit','-qm','persist fixture trace']);}
 const result=runReleaseContractGuard({repoRoot:f.scratch,audit:validAudit(),auditText:validAuditText,
  packageJson:validPackageJson,vsixPackageJson:validVsixPackageJson,releaseGateText:'cargo pnpm'});
 assert.deepEqual(result.errors,[]);assert.equal(f.contract.runtime_release_ready,false);
});

function ownerIntegrityFixture(t){
 const f=executableTraceFixture(t),checksum='.brownie/release-evidence/fixture-SHA256SUMS';
 const text=f.supply.sections.artifacts.artifacts[0].sha256.slice(7)+'  '+f.binary+'\n';f.write(checksum,text);
 f.supply.sections.checksums={status:'satisfied',path:checksum,sha256:f.digest(text)};
 f.supply.sections.signature_or_integrity_proof={status:'satisfied',path:f.decisionFile,proof_kind:'owner_approved_integrity_authority_with_sha256sums'};
 f.contract.release_artifact_evidence.signature={status:'implemented_sufficient',path:f.decisionFile};f.writeJson(f.evidencePath,f.supply);
 return {...f,checksum};
}

test('owner integrity proof uses the supported decision and physical SHA256SUMS schema',t=>{
 const f=ownerIntegrityFixture(t);assert.equal(f.supply.sections.signature_or_integrity_proof.sha256,undefined);assert.deepEqual(f.validate(),[]);
});

for(const [name,change] of [
 ['unapproved decision',f=>f.writeJson(f.decisionFile,{...f.decision,owner_approved:false})],
 ['altered checksum bytes',f=>f.write(f.checksum,'f'.repeat(64)+'  '+f.binary+'\n')],
 ['absent checksum file',f=>fs.unlinkSync(path.join(f.scratch,f.checksum))]
])test('owner integrity proof rejects '+name,t=>{
 const f=ownerIntegrityFixture(t);assert.deepEqual(f.validate(),[]);change(f);
 assert(f.validate().some(error=>error.includes('integrity proof must use')));
});

function runtimeTraceFixture(t){
 const f=executableTraceFixture(t);f.contract.release_ready_conditions=f.contract.release_ready_conditions.map(entry=>entry.id==='artifact_smoke_tests'?{...entry,status:'implemented_sufficient'}:entry);
 const runtime={evidence_id:'brownie-runtime-operational-evidence-v1',release_evidence_binding:f.roundtrip};
 f.writeJson(f.contract.runtime_operational_evidence.default_path,runtime);return {...f,runtime};
}

test('Runtime and supply chain references accept the same actual roundtrip binding',t=>{
 const f=runtimeTraceFixture(t);assert.deepEqual(f.validate(),[]);
});

test('Runtime and supply chain references reject inconsistent binding digest',t=>{
 const f=runtimeTraceFixture(t);f.runtime.release_evidence_binding={...f.roundtrip,binding_digest:f.digest('wrong')};
 f.writeJson(f.contract.runtime_operational_evidence.default_path,f.runtime);
 assert(f.validate().some(error=>error.includes('same exact roundtrip binding')));
});

test('artifact provenance must match the actual artifact digest',t=>{
 const f=executableTraceFixture(t);f.supply.sections.artifacts.artifacts[0].provenance_binding.artifactSha256=f.digest('wrong');f.writeJson(f.evidencePath,f.supply);
 assert(f.validate().some(error=>error.includes('artifact provenance digest')));
});

for(const field of ['platform','architecture'])for(const value of ['',' ','invalid token'])test(`trace binding rejects malformed ${field} ${JSON.stringify(value)} even when metadata agrees`,t=>{
 const f=executableTraceFixture(t);assert.deepEqual(f.validate(),[]);
 const artifact=f.supply.sections.artifacts.artifacts[0];artifact.provenance_binding[field]=value;
 const platform=artifact.provenance_binding.platform,architecture=artifact.provenance_binding.architecture,target=platform+'-'+architecture;
 artifact.target=target;artifact.provenance_identity=f.digest([f.head,f.head,'123456',f.binary,artifact.sha256,platform,architecture].join('\n'));
 Object.assign(f.supply.sections.artifacts.release_evidence_binding.bindings[0],{platform,architecture,target});f.writeJson(f.evidencePath,f.supply);
 for(const file of [f.binding.journey_evidence_path,f.binding.soak_evidence_path]){const data=JSON.parse(fs.readFileSync(path.join(f.scratch,file),'utf8'));data.target=target;f.writeJson(file,data);}
 assert(f.validate().some(error=>error.includes('executable artifact target must match')));
});

test('trace binding rejects an actual untracked build input despite clean declarations',t=>{
 const f=executableTraceFixture(t);assert.deepEqual(f.validate(),[]);
 f.write('untracked-build-input.rs','fn untracked_build_input() {}\n');
 assert(f.validate().some(error=>error.includes('untracked build inputs')));
});


function runtimeOnlyTraceFixture(t){
 const f=runtimeTraceFixture(t);f.contract.release_ready_conditions=f.contract.release_ready_conditions.map(entry=>entry.id==='artifact_smoke_tests'?{...entry,status:'satisfied'}:entry);
 f.contract.release_artifact_evidence=Object.fromEntries(Object.entries(f.contract.release_artifact_evidence).map(([key,value])=>[key,{...value,status:'not_generated',path:null}]));
 return f;
}

test('Runtime-only sufficient evidence accepts an actual matching trace and physical references',t=>{
 const f=runtimeOnlyTraceFixture(t);assert.deepEqual(f.validate(),[]);
});

test('Runtime-only sufficient evidence cannot omit its physical Runtime reference',t=>{
 const f=runtimeOnlyTraceFixture(t);fs.unlinkSync(path.join(f.scratch,f.contract.runtime_operational_evidence.default_path));
 assert(f.validate().some(error=>error.includes('must contain a JSON object')));
});

test('every Runtime condition binds trace evidence for artifact claims and independent satisfied claims',t=>{
 const ids=['artifact_smoke_tests','tested_commit_matches_artifact_commit','audit_trace_matches_tested_commit'];
 for(const id of ids)for(const status of ['implemented_sufficient','satisfied']){
  const f=status==='satisfied'?runtimeOnlyTraceFixture(t):runtimeTraceFixture(t);
  f.contract.release_ready_conditions=f.contract.release_ready_conditions.map(entry=>ids.includes(entry.id)?{...entry,status:entry.id===id?status:'missing_evidence'}:entry);
  for(const key of ['implementation_commit','tested_commit','workflow_run_id','artifact_sha256'])f.contract.commit_trace[key]=null;
  const errors=f.validate();
  for(const key of ['implementation_commit','tested_commit','workflow_run_id','artifact_sha256'])assert(errors.some(error=>error.includes('commit_trace.'+key)),id+' '+status+' '+key);
 }
});
