import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultContractPath = 'docs/architecture/modepack-distribution-trust-contract.json';

const requiredEvidence = [
  'pinned_commit',
  'mode_pack_fingerprint',
  'artifact_sha256',
  'verified_signature',
  'trusted_trust_root',
  'revocation_evidence'
];

const requiredFailClosedRules = [
  'untrusted_repository_local_is_default',
  'trusted_signed_requires_complete_distribution_evidence',
  'untrusted_sources_cannot_self_authorize_external_provider_calls',
  'generic_network_remains_reserved',
  'revoked_evidence_is_never_trusted'
];

function readText(repoRoot, relativePath, errors) {
  try {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
  } catch (error) {
    errors.push(`${relativePath} must be readable: ${error.message}`);
    return '';
  }
}

function readJson(repoRoot, relativePath, errors) {
  const text = readText(repoRoot, relativePath, errors);
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    errors.push(`${relativePath} must be valid JSON: ${error.message}`);
    return {};
  }
}

function requireValue(condition, errors, message) {
  if (!condition) {
    errors.push(message);
  }
}

function hasAll(list, expected) {
  return Array.isArray(list) && expected.every((entry) => list.includes(entry));
}

function sameStringSet(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((entry) => actual.includes(entry))
  );
}

function requireEvidenceSchemaField(schema, field, expectation, errors, contractPath) {
  const actual = schema[field] ?? {};
  requireValue(actual.required === true, errors, `${contractPath} distribution_evidence_schema.${field} must be required.`);
  if (expectation.type) {
    requireValue(
      actual.type === expectation.type,
      errors,
      `${contractPath} distribution_evidence_schema.${field}.type must be ${expectation.type}.`
    );
  }
  if (expectation.prefix) {
    requireValue(
      actual.prefix === expectation.prefix,
      errors,
      `${contractPath} distribution_evidence_schema.${field}.prefix must be ${expectation.prefix}.`
    );
  }
  if (expectation.requiredFields) {
    requireValue(
      sameStringSet(actual.required_fields, expectation.requiredFields),
      errors,
      `${contractPath} distribution_evidence_schema.${field}.required_fields must exactly include ${expectation.requiredFields.join(', ')}.`
    );
  }
  if (expectation.allowedStatuses) {
    requireValue(
      sameStringSet(actual.allowed_statuses, expectation.allowedStatuses),
      errors,
      `${contractPath} distribution_evidence_schema.${field}.allowed_statuses must exactly include ${expectation.allowedStatuses.join(', ')}.`
    );
  }
}

function scriptCommandIncludes(script, expected) {
  if (typeof script !== 'string') {
    return false;
  }
  return script
    .split('&&')
    .map((command) => command.trim())
    .includes(expected);
}

export function validateModePackDistributionTrustContract(contract, options = {}) {
  const contractPath = options.contractPath ?? defaultContractPath;
  const modepackSource = options.modepackSource ?? '';
  const runtimeModepackSource = options.runtimeModepackSource ?? '';
  const modepackSpec = options.modepackSpec ?? '';
  const packageJson = options.packageJson ?? {};
  const vsixPackageJson = options.vsixPackageJson ?? {};
  const releaseGateText = options.releaseGateText ?? '';
  const errors = [];

  requireValue(contract.schema_version === 1, errors, `${contractPath} schema_version must be 1.`);
  requireValue(
    contract.contract_id === 'brownie-modepack-distribution-trust-contract-v1',
    errors,
    `${contractPath} contract_id must identify the Mode Pack distribution trust contract.`
  );
  requireValue(contract.owner === 'runtime', errors, `${contractPath} owner must be runtime.`);
  requireValue(contract.phase === 'R-18', errors, `${contractPath} phase must be R-18.`);
  requireValue(
    hasAll(contract.trusted_signed_active_modepack_requires, requiredEvidence),
    errors,
    `${contractPath} trusted_signed_active_modepack_requires must include pinned commit, fingerprint, artifact hash, signature, trust root, and revocation evidence.`
  );

  const failClosedRules = Array.isArray(contract.fail_closed_rules) ? contract.fail_closed_rules : [];
  const failClosedRuleIds = failClosedRules.map((rule) => rule?.id);
  for (const id of requiredFailClosedRules) {
    requireValue(failClosedRuleIds.includes(id), errors, `${contractPath} fail_closed_rules must include ${id}.`);
  }

  const schema = contract.distribution_evidence_schema ?? {};
  requireEvidenceSchemaField(schema, 'pinned_commit', { type: 'string' }, errors, contractPath);
  requireEvidenceSchemaField(schema, 'mode_pack_fingerprint', { type: 'string', prefix: 'sha256:' }, errors, contractPath);
  requireEvidenceSchemaField(schema, 'artifact_sha256', { type: 'string', prefix: 'sha256:' }, errors, contractPath);
  requireEvidenceSchemaField(
    schema,
    'signature',
    { type: 'object', requiredFields: ['algorithm', 'signer_identity', 'signature_fingerprint', 'verified'] },
    errors,
    contractPath
  );
  requireEvidenceSchemaField(
    schema,
    'trust_root',
    { type: 'object', requiredFields: ['root_id', 'root_fingerprint', 'trusted_by_owner'] },
    errors,
    contractPath
  );
  requireEvidenceSchemaField(
    schema,
    'revocation_evidence',
    { type: 'object', requiredFields: ['checked_at', 'status', 'source_fingerprint'], allowedStatuses: ['not_revoked'] },
    errors,
    contractPath
  );

  const untrusted = contract.runtime_permission_expectations?.UntrustedRepositoryLocal ?? {};
  for (const permission of [
    'workspace_write',
    'process_exec',
    'git_inspect',
    'git_commit',
    'network_access',
    'llm_provider_access',
    'service_control',
    'destructive',
    'can_spawn_subtasks',
    'mcp_tool_access'
  ]) {
    requireValue(untrusted[permission] === false, errors, `${contractPath} UntrustedRepositoryLocal.${permission} must be false.`);
  }
  const trusted = contract.runtime_permission_expectations?.TrustedSignedActiveModePack ?? {};
  requireValue(trusted.network_access === false, errors, `${contractPath} TrustedSignedActiveModePack.network_access must remain false in v0.`);
  requireValue(trusted.service_control === false, errors, `${contractPath} TrustedSignedActiveModePack.service_control must remain false in v0.`);
  requireValue(trusted.destructive === false, errors, `${contractPath} TrustedSignedActiveModePack.destructive must remain false in v0.`);

  requireValue(
    /let\s+llm_provider_access\s*=\s*declared\.llm_provider_access\s*&&\s*trusted_side_effect_source\s*&&\s*options\.capability_ceiling\.llm_provider_access\s*;/s.test(
      modepackSource
    ),
    errors,
    'crates/brownie-modepack/src/lib.rs must gate llm_provider_access by source trust and capability ceiling.'
  );
  requireValue(
    modepackSource.includes('RuntimeAction::AccessLlmProvider') &&
      modepackSource.includes('!RuntimePermissionGate::check(networker, RuntimeAction::AccessLlmProvider).allowed'),
    errors,
    'crates/brownie-modepack/src/lib.rs must test fail-closed LLM provider access for UntrustedRepositoryLocal Mode Packs.'
  );
  requireValue(
    modepackSpec.includes('MP-3.2H distribution-time trust validation') &&
      modepackSpec.includes('pinned commit') &&
      modepackSpec.includes('revocation evidence') &&
      modepackSpec.includes('llm_provider_access'),
    errors,
    'docs/specifications/modepack-spec-v0.md must document R-18 distribution-time trust validation and provider-access narrowing.'
  );
  requireValue(
    runtimeModepackSource.includes('expected_pinned_commit') &&
      runtimeModepackSource.includes('expected_approved_candidate_pinned_commit') &&
      runtimeModepackSource.includes('statement pinned commit mismatch') &&
      runtimeModepackSource.includes('approved candidate identity binding requires pinned commit'),
    errors,
    'crates/brownie-runtime/src/modepack.rs must enforce pinned commit evidence before TrustedSignedActiveModePack activation.'
  );
  requireValue(
    packageJson.scripts?.['guard:modepack-distribution-trust'] === 'node scripts/guard-modepack-distribution-trust.mjs',
    errors,
    'package.json must define guard:modepack-distribution-trust.'
  );
  requireValue(
    packageJson.scripts?.['guard:modepack-distribution-trust:test'] === 'node --test scripts/guard-modepack-distribution-trust.test.mjs',
    errors,
    'package.json must define guard:modepack-distribution-trust:test.'
  );
  requireValue(
    scriptCommandIncludes(vsixPackageJson.scripts?.check, 'pnpm --workspace-root guard:modepack-distribution-trust'),
    errors,
    'extensions/brownie-vsix/package.json check must invoke guard:modepack-distribution-trust.'
  );
  requireValue(
    scriptCommandIncludes(vsixPackageJson.scripts?.check, 'pnpm --workspace-root guard:modepack-distribution-trust:test'),
    errors,
    'extensions/brownie-vsix/package.json check must invoke guard:modepack-distribution-trust:test.'
  );
  requireValue(
    releaseGateText.includes("id: 'modepack_distribution_trust_guard'") &&
      releaseGateText.includes("args: ['--workspace-root', 'guard:modepack-distribution-trust']"),
    errors,
    'scripts/release-gate.mjs must include modepack_distribution_trust_guard.'
  );
  requireValue(
    releaseGateText.includes("id: 'modepack_distribution_trust_guard_test'") &&
      releaseGateText.includes("args: ['--workspace-root', 'guard:modepack-distribution-trust:test']"),
    errors,
    'scripts/release-gate.mjs must include modepack_distribution_trust_guard_test.'
  );

  return errors;
}

export function runModePackDistributionTrustGuard(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const contractPath = options.contractPath ?? defaultContractPath;
  const readErrors = [];
  const contract = options.contract ?? readJson(repoRoot, contractPath, readErrors);
  const modepackSource = options.modepackSource ?? readText(repoRoot, 'crates/brownie-modepack/src/lib.rs', readErrors);
  const runtimeModepackSource = options.runtimeModepackSource ?? readText(repoRoot, 'crates/brownie-runtime/src/modepack.rs', readErrors);
  const modepackSpec = options.modepackSpec ?? readText(repoRoot, 'docs/specifications/modepack-spec-v0.md', readErrors);
  const packageJson = options.packageJson ?? readJson(repoRoot, 'package.json', readErrors);
  const vsixPackageJson = options.vsixPackageJson ?? readJson(repoRoot, 'extensions/brownie-vsix/package.json', readErrors);
  const releaseGateText = options.releaseGateText ?? readText(repoRoot, 'scripts/release-gate.mjs', readErrors);
  return {
    errors: [
      ...readErrors,
      ...validateModePackDistributionTrustContract(contract, {
        contractPath,
        modepackSource,
        runtimeModepackSource,
        modepackSpec,
        packageJson,
        vsixPackageJson,
        releaseGateText
      })
    ],
    contractPath
  };
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const result = runModePackDistributionTrustGuard();
  if (result.errors.length > 0) {
    console.error('Mode Pack distribution trust guard failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log(`Mode Pack distribution trust guard passed for ${result.contractPath}.`);
}
