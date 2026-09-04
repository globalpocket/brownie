import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { requiredReleaseGateCommands } from './release-gate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultContractPath = 'docs/architecture/runtime-release-contract.json';
const defaultAuditPath = 'docs/architecture/runtime-release-readiness-audit.json';
const defaultPackagePath = 'package.json';
const defaultVsixPackagePath = 'extensions/brownie-vsix/package.json';

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

const requiredPhaseIds = [
  'phase-a-release-contract',
  'phase-b-mandatory-ci-quality-gate',
  'phase-c-ledger-contract-release-integrity',
  'phase-d-supply-chain-security',
  'phase-e-cross-platform-distribution',
  'phase-f-flaky-recovery-soak',
  'phase-g-release-governance'
];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function readJson(repoRoot, relativePath, errors) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
  } catch (error) {
    errors.push(`${relativePath} must be readable JSON: ${error.message}`);
    return {};
  }
}

function readText(repoRoot, relativePath, errors) {
  try {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
  } catch (error) {
    errors.push(`${relativePath} must be readable: ${error.message}`);
    return '';
  }
}

function requireValue(condition, errors, message) {
  if (!condition) {
    errors.push(message);
  }
}

function commandString(entry) {
  return [entry.command, ...entry.args].join(' ');
}

function validateCommitTrace(trace, errors, contractPath) {
  requireValue(trace && typeof trace === 'object', errors, `${contractPath} commit_trace must be an object.`);
  if (!trace || typeof trace !== 'object') {
    return;
  }
  for (const field of [
    'audited_base_commit',
    'implementation_commit',
    'tested_commit',
    'release_tag',
    'workflow_run_id',
    'artifact_sha256',
    'contract_registry_fingerprint',
    'mode_pack_fingerprint',
    'product_dod_fingerprint'
  ]) {
    requireValue(Object.prototype.hasOwnProperty.call(trace, field), errors, `${contractPath} commit_trace must include ${field}.`);
  }
  requireValue(isNonEmptyString(trace.audited_base_commit), errors, `${contractPath} commit_trace.audited_base_commit must be the latest audited base commit.`);
  for (const field of ['implementation_commit', 'tested_commit', 'release_tag', 'workflow_run_id', 'artifact_sha256']) {
    requireValue(trace[field] === null || isNonEmptyString(trace[field]), errors, `${contractPath} commit_trace.${field} must be null or a non-empty string.`);
  }
}

function validateRuntimeReleaseContract(contract, options = {}) {
  const contractPath = options.contractPath ?? defaultContractPath;
  const packageJson = options.packageJson ?? {};
  const vsixPackageJson = options.vsixPackageJson ?? {};
  const audit = options.audit ?? {};
  const errors = [];

  requireValue(Number.isInteger(contract.schema_version) && contract.schema_version > 0, errors, `${contractPath} schema_version must be a positive integer.`);
  requireValue(contract.contract_id === 'runtime-release-engineering-contract-v1', errors, `${contractPath} contract_id must identify the Runtime release engineering contract.`);
  requireValue(contract.owner === 'runtime', errors, `${contractPath} owner must be runtime.`);
  requireValue(contract.phase === 'RRP-8.4', errors, `${contractPath} phase must be RRP-8.4.`);
  requireValue(contract.runtime_release_ready === false, errors, `${contractPath} must keep runtime_release_ready false until all release evidence exists.`);

  validateCommitTrace(contract.commit_trace, errors, contractPath);

  const conditions = Array.isArray(contract.release_ready_conditions) ? contract.release_ready_conditions : [];
  const conditionById = new Map(conditions.map((condition) => [condition?.id, condition]));
  for (const id of requiredConditionIds) {
    const condition = conditionById.get(id);
    requireValue(Boolean(condition), errors, `${contractPath} release_ready_conditions must include ${id}.`);
    if (condition) {
      requireValue(condition.release_blocking === true, errors, `${contractPath} ${id} must be release_blocking.`);
      requireValue(isNonEmptyString(condition.status), errors, `${contractPath} ${id} status must be non-empty.`);
      requireValue(Array.isArray(condition.required_evidence) && condition.required_evidence.length > 0, errors, `${contractPath} ${id} required_evidence must be non-empty.`);
    }
  }
  requireValue(
    conditions.some((condition) => condition.status !== 'satisfied'),
    errors,
    `${contractPath} must not mark every release condition satisfied while runtime_release_ready is false.`
  );

  const phasePlan = Array.isArray(contract.finite_phase_plan) ? contract.finite_phase_plan : [];
  const phaseById = new Map(phasePlan.map((phase) => [phase?.id, phase]));
  for (const id of requiredPhaseIds) {
    requireValue(phaseById.has(id), errors, `${contractPath} finite_phase_plan must include ${id}.`);
  }

  const localGate = contract.local_release_gate ?? {};
  requireValue(localGate.package_script === 'pnpm release:gate', errors, `${contractPath} local_release_gate.package_script must be pnpm release:gate.`);
  const contractCommands = new Set((Array.isArray(localGate.commands) ? localGate.commands : []).map((entry) => entry?.command));
  for (const command of requiredReleaseGateCommands.map(commandString)) {
    requireValue(contractCommands.has(command), errors, `${contractPath} local_release_gate.commands must include ${command}.`);
  }
  requireValue(packageJson.scripts?.['release:gate'] === 'node scripts/release-gate.mjs', errors, `${defaultPackagePath} must define release:gate.`);
  requireValue(packageJson.scripts?.['release:supply-chain-artifact-evidence'] === 'node scripts/release-supply-chain-artifact-evidence.mjs', errors, `${defaultPackagePath} must define release:supply-chain-artifact-evidence.`);
  requireValue(packageJson.scripts?.['guard:release-contract'] === 'node scripts/guard-release-contract.mjs', errors, `${defaultPackagePath} must define guard:release-contract.`);
  requireValue(packageJson.scripts?.['guard:release-contract:test'] === 'node --test scripts/guard-release-contract.test.mjs', errors, `${defaultPackagePath} must define guard:release-contract:test.`);
  requireValue(packageJson.scripts?.['guard:supply-chain-artifact-evidence'] === 'node scripts/guard-supply-chain-artifact-evidence.mjs', errors, `${defaultPackagePath} must define guard:supply-chain-artifact-evidence.`);
  requireValue(packageJson.scripts?.['guard:supply-chain-artifact-evidence:test'] === 'node --test scripts/guard-supply-chain-artifact-evidence.test.mjs', errors, `${defaultPackagePath} must define guard:supply-chain-artifact-evidence:test.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root guard:release-contract'), errors, `${defaultVsixPackagePath} check must invoke guard:release-contract.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root guard:release-contract:test'), errors, `${defaultVsixPackagePath} check must invoke guard:release-contract:test.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root guard:supply-chain-artifact-evidence'), errors, `${defaultVsixPackagePath} check must invoke guard:supply-chain-artifact-evidence.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root guard:supply-chain-artifact-evidence:test'), errors, `${defaultVsixPackagePath} check must invoke guard:supply-chain-artifact-evidence:test.`);

  const external = Array.isArray(contract.external_blockers) ? contract.external_blockers : [];
  requireValue(
    external.some((entry) => entry?.id === 'github_workflow_scope' && entry?.status === 'blocked_external'),
    errors,
    `${contractPath} must record github_workflow_scope as blocked_external while workflow scope is absent.`
  );

  const artifactEvidence = contract.release_artifact_evidence ?? {};
  for (const field of ['artifacts', 'sha256sums', 'signature', 'sbom', 'provenance']) {
    const entry = artifactEvidence[field];
    requireValue(entry && typeof entry === 'object', errors, `${contractPath} release_artifact_evidence.${field} must be an object.`);
    if (entry && typeof entry === 'object') {
      requireValue(entry.status !== 'satisfied', errors, `${contractPath} release_artifact_evidence.${field} must not be satisfied before real artifacts exist.`);
      requireValue(entry.path === null || isNonEmptyString(entry.path), errors, `${contractPath} release_artifact_evidence.${field}.path must be null or non-empty.`);
    }
  }

  const supplyChainEvidence = contract.supply_chain_artifact_evidence ?? {};
  requireValue(
    supplyChainEvidence.contract_id === 'brownie-supply-chain-artifact-evidence-v1',
    errors,
    `${contractPath} supply_chain_artifact_evidence.contract_id must match the repo-local supply-chain evidence contract.`
  );
  requireValue(
    supplyChainEvidence.default_path === '.brownie/release-evidence/supply-chain-artifact-evidence.json',
    errors,
    `${contractPath} supply_chain_artifact_evidence.default_path must point to the ignored local evidence path.`
  );
  for (const section of [
    'lockfile_fixed',
    'dependency_security_license_scan',
    'secret_scan',
    'sbom',
    'artifacts',
    'artifact_smoke',
    'checksums',
    'signature_or_integrity_proof',
    'provenance'
  ]) {
    requireValue(
      Array.isArray(supplyChainEvidence.required_sections) && supplyChainEvidence.required_sections.includes(section),
      errors,
      `${contractPath} supply_chain_artifact_evidence.required_sections must include ${section}.`
    );
  }

  requireValue(audit.release_engineering_contract?.contract_path === defaultContractPath, errors, `${defaultAuditPath} must reference ${defaultContractPath}.`);
  requireValue(audit.release_engineering_contract?.status === 'partial', errors, `${defaultAuditPath} release_engineering_contract.status must remain partial.`);
  requireValue(audit.runtime_release_ready === false, errors, `${defaultAuditPath} must keep runtime_release_ready false.`);

  return errors;
}

export function runReleaseContractGuard(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const contractPath = options.contractPath ?? process.env.BROWNIE_RUNTIME_RELEASE_CONTRACT ?? defaultContractPath;
  const auditPath = options.auditPath ?? defaultAuditPath;
  const errors = [];
  const contract = options.contract ?? readJson(repoRoot, contractPath, errors);
  const audit = options.audit ?? readJson(repoRoot, auditPath, errors);
  const packageJson = options.packageJson ?? readJson(repoRoot, defaultPackagePath, errors);
  const vsixPackageJson = options.vsixPackageJson ?? readJson(repoRoot, defaultVsixPackagePath, errors);
  const releaseGateText = options.releaseGateText ?? readText(repoRoot, 'scripts/release-gate.mjs', errors);

  for (const command of requiredReleaseGateCommands.map(commandString)) {
    requireValue(releaseGateText.includes(command.split(' ')[0]) || releaseGateText.includes(command), errors, `scripts/release-gate.mjs must define ${command}.`);
  }

  errors.push(...validateRuntimeReleaseContract(contract, {
    contractPath,
    packageJson,
    vsixPackageJson,
    audit
  }));
  return { errors, contractPath };
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const result = runReleaseContractGuard();
  if (result.errors.length > 0) {
    console.error('Runtime release contract guard failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log(`Runtime release contract guard passed for ${result.contractPath}.`);
}
