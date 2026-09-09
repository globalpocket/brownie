import assert from 'node:assert/strict';
import test from 'node:test';

import { validateModePackDistributionTrustContract } from './guard-modepack-distribution-trust.mjs';

function validContract(overrides = {}) {
  return {
    schema_version: 1,
    contract_id: 'brownie-modepack-distribution-trust-contract-v1',
    owner: 'runtime',
    phase: 'R-18',
    trusted_signed_active_modepack_requires: [
      'pinned_commit',
      'mode_pack_fingerprint',
      'artifact_sha256',
      'verified_signature',
      'trusted_trust_root',
      'revocation_evidence'
    ],
    fail_closed_rules: [
      { id: 'untrusted_repository_local_is_default' },
      { id: 'trusted_signed_requires_complete_distribution_evidence' },
      { id: 'untrusted_sources_cannot_self_authorize_external_provider_calls' },
      { id: 'generic_network_remains_reserved' },
      { id: 'revoked_evidence_is_never_trusted' }
    ],
    distribution_evidence_schema: {
      pinned_commit: { type: 'string', required: true },
      mode_pack_fingerprint: { type: 'string', required: true, prefix: 'sha256:' },
      artifact_sha256: { type: 'string', required: true, prefix: 'sha256:' },
      signature: {
        type: 'object',
        required: true,
        required_fields: ['algorithm', 'signer_identity', 'signature_fingerprint', 'verified']
      },
      trust_root: {
        type: 'object',
        required: true,
        required_fields: ['root_id', 'root_fingerprint', 'trusted_by_owner']
      },
      revocation_evidence: {
        type: 'object',
        required: true,
        required_fields: ['checked_at', 'status', 'source_fingerprint'],
        allowed_statuses: ['not_revoked']
      }
    },
    runtime_permission_expectations: {
      UntrustedRepositoryLocal: {
        workspace_write: false,
        process_exec: false,
        git_inspect: false,
        git_commit: false,
        network_access: false,
        llm_provider_access: false,
        service_control: false,
        destructive: false,
        can_spawn_subtasks: false,
        mcp_tool_access: false
      },
      TrustedSignedActiveModePack: {
        bounded_by_declared_policy_and_capability_ceiling: true,
        network_access: false,
        service_control: false,
        destructive: false
      }
    },
    ...overrides
  };
}

const validModepackSource = `
let llm_provider_access = declared.llm_provider_access
    && trusted_side_effect_source
    && options.capability_ceiling.llm_provider_access;
assert!(!RuntimePermissionGate::check(networker, RuntimeAction::AccessLlmProvider).allowed);
`;

const validModepackSpec = `
MP-3.2H distribution-time trust validation requires a pinned commit, signature, trust root, and revocation evidence.
UntrustedRepositoryLocal cannot self-authorize llm_provider_access.
`;

const validRuntimeModepackSource = `
let expected_pinned_commit = params.expected_pinned_commit.clone();
let expected_approved_candidate_pinned_commit = params.expected_approved_candidate_pinned_commit.clone();
return Err("modepack candidate provenance verification failed: statement pinned commit mismatch".to_string());
return Err("approved candidate identity binding requires pinned commit".to_string());
`;

const validPackageJson = {
  scripts: {
    'guard:modepack-distribution-trust': 'node scripts/guard-modepack-distribution-trust.mjs',
    'guard:modepack-distribution-trust:test': 'node --test scripts/guard-modepack-distribution-trust.test.mjs'
  }
};

const validVsixPackageJson = {
  scripts: {
    check: 'pnpm --workspace-root guard:modepack-distribution-trust && pnpm --workspace-root guard:modepack-distribution-trust:test'
  }
};

const validReleaseGateText = `
{
  id: 'modepack_distribution_trust_guard',
  args: ['--workspace-root', 'guard:modepack-distribution-trust']
},
{
  id: 'modepack_distribution_trust_guard_test',
  args: ['--workspace-root', 'guard:modepack-distribution-trust:test']
}
`;

function validate(contract, overrides = {}) {
  return validateModePackDistributionTrustContract(contract, {
    modepackSource: overrides.modepackSource ?? validModepackSource,
    runtimeModepackSource: overrides.runtimeModepackSource ?? validRuntimeModepackSource,
    modepackSpec: overrides.modepackSpec ?? validModepackSpec,
    packageJson: overrides.packageJson ?? validPackageJson,
    vsixPackageJson: overrides.vsixPackageJson ?? validVsixPackageJson,
    releaseGateText: overrides.releaseGateText ?? validReleaseGateText
  });
}

test('accepts complete fail-closed Mode Pack distribution trust contract', () => {
  assert.deepEqual(validate(validContract()), []);
});

test('rejects missing pinned commit distribution evidence', () => {
  const contract = validContract({
    trusted_signed_active_modepack_requires: [
      'mode_pack_fingerprint',
      'artifact_sha256',
      'verified_signature',
      'trusted_trust_root',
      'revocation_evidence'
    ]
  });
  assert(validate(contract).some((error) => error.includes('pinned commit')));
});

test('rejects revocation statuses other than not_revoked', () => {
  const contract = validContract({
    distribution_evidence_schema: {
      ...validContract().distribution_evidence_schema,
      revocation_evidence: { required: true, allowed_statuses: ['not_revoked', 'unknown'] }
    }
  });
  assert(validate(contract).some((error) => error.includes('revocation_evidence')));
});

test('rejects weakened distribution evidence schema', () => {
  const contract = validContract({
    distribution_evidence_schema: {
      ...validContract().distribution_evidence_schema,
      signature: {
        type: 'object',
        required: true,
        required_fields: ['algorithm', 'signer_identity', 'signature_fingerprint']
      }
    }
  });
  assert(validate(contract).some((error) => error.includes('signature.required_fields')));
});

test('rejects hash evidence schema without sha256 prefix', () => {
  const contract = validContract({
    distribution_evidence_schema: {
      ...validContract().distribution_evidence_schema,
      artifact_sha256: { type: 'string', required: true }
    }
  });
  assert(validate(contract).some((error) => error.includes('artifact_sha256.prefix')));
});

test('rejects untrusted provider access self-authorization', () => {
  const contract = validContract({
    runtime_permission_expectations: {
      ...validContract().runtime_permission_expectations,
      UntrustedRepositoryLocal: {
        ...validContract().runtime_permission_expectations.UntrustedRepositoryLocal,
        llm_provider_access: true
      }
    }
  });
  assert(validate(contract).some((error) => error.includes('llm_provider_access')));
});

test('rejects implementation that omits source-trust provider gate', () => {
  const errors = validate(validContract(), {
    modepackSource: 'let llm_provider_access = declared.llm_provider_access && options.capability_ceiling.llm_provider_access;'
  });
  assert(errors.some((error) => error.includes('source trust')));
});

test('rejects runtime implementation that omits pinned commit activation enforcement', () => {
  const errors = validate(validContract(), {
    runtimeModepackSource: 'fn build_active_modepack_snapshot_from_approved_candidate() {}'
  });
  assert(errors.some((error) => error.includes('pinned commit evidence')));
});

test('rejects missing CI-path guard wiring', () => {
  const errors = validate(validContract(), {
    vsixPackageJson: { scripts: { check: 'pnpm --workspace-root guard:release-contract' } }
  });
  assert(errors.some((error) => error.includes('guard:modepack-distribution-trust')));
});

test('rejects VSIX check that only invokes the test guard variant', () => {
  const errors = validate(validContract(), {
    vsixPackageJson: { scripts: { check: 'pnpm --workspace-root guard:modepack-distribution-trust:test' } }
  });
  assert(errors.some((error) => error.includes('check must invoke guard:modepack-distribution-trust.')));
});

test('rejects missing release gate test wiring', () => {
  const errors = validate(validContract(), {
    releaseGateText: `
    {
      id: 'modepack_distribution_trust_guard',
      args: ['--workspace-root', 'guard:modepack-distribution-trust']
    }
    `
  });
  assert(errors.some((error) => error.includes('modepack_distribution_trust_guard_test')));
});
