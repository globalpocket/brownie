import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { requiredReleaseGateCommands } from './release-gate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultContractPath = 'docs/architecture/runtime-release-contract.json';
const defaultAuditPath = 'docs/architecture/runtime-release-readiness-audit.json';
const defaultPackagePath = 'package.json';
const defaultVsixPackagePath = 'extensions/brownie-vsix/package.json';

export const requiredConditionIds = [
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
  'required_independent_reviews_complete',
  'implementation_commit_bound',
  'tested_commit_bound',
  'workflow_run_id_bound',
  'artifact_sha256_bound',
  'clean_source_identity_verified'
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

function isVerifiedTraceValue(value) {
  if (!isNonEmptyString(value)) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return !(
    normalized === 'pending-evidence-binding' ||
    normalized === 'pending' ||
    normalized === 'not_generated' ||
    normalized === 'not-generated' ||
    normalized === 'unknown' ||
    normalized.startsWith('blocker:')
  );
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

export function computeReadinessAuditContentSha256(auditText) {
  return 'sha256:' + crypto.createHash('sha256').update(auditText).digest('hex');
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
    'readiness_audit_content_sha256',
    'mode_pack_fingerprint',
    'product_dod_fingerprint'
  ]) {
    requireValue(Object.prototype.hasOwnProperty.call(trace, field), errors, `${contractPath} commit_trace must include ${field}.`);
  }
  requireValue(isNonEmptyString(trace.audited_base_commit), errors, `${contractPath} commit_trace.audited_base_commit must be the latest audited base commit.`);
  requireValue(isNonEmptyString(trace.readiness_audit_content_sha256), errors, `${contractPath} commit_trace.readiness_audit_content_sha256 must be a non-empty string.`);
  for (const field of ['implementation_commit', 'tested_commit', 'release_tag', 'workflow_run_id', 'artifact_sha256']) {
    requireValue(trace[field] === null || isNonEmptyString(trace[field]), errors, `${contractPath} commit_trace.${field} must be null or a non-empty string.`);
  }
}

function requireArtifactBindingTrace(trace, errors, contractPath, evidenceField) {
  const shapes = {
    implementation_commit: /^[a-f0-9]{40}$/,
    tested_commit: /^[a-f0-9]{40}$/,
    workflow_run_id: /^[1-9][0-9]*$/,
    artifact_sha256: /^sha256:[a-f0-9]{64}$/
  };
  for (const field of ['implementation_commit', 'tested_commit', 'workflow_run_id', 'artifact_sha256']) {
    requireValue(
      isVerifiedTraceValue(trace?.[field]),
      errors,
      `${contractPath} commit_trace.${field} must be a verified evidence value, not a pending/blocker placeholder, when release_artifact_evidence.${evidenceField} claims implemented artifact evidence.`
    );
    requireValue(typeof trace?.[field] === 'string' && shapes[field].test(trace[field]), errors,
      `${contractPath} commit_trace.${field} must have its exact evidence identifier shape when artifact evidence is implemented.`);
  }
}

function validateExecutableTraceBinding(repoRoot, contract, errors, contractPath) {
  const claimed = Object.entries(contract.release_artifact_evidence ?? {}).filter(([, value]) =>
    ['implemented_sufficient', 'satisfied'].includes(value?.status));
  if (claimed.length === 0) return;
  const trace = contract.commit_trace ?? {};
  const readEvidence = (relativePath, maximumBytes = 16 * 1024 * 1024) => {
    if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
      errors.push(`${contractPath} executable evidence requires a repository-relative path.`);
      return null;
    }
    const absolute = path.resolve(repoRoot, relativePath);
    const prefix = path.resolve(repoRoot) + path.sep;
    try {
      if (!absolute.startsWith(prefix) || !fs.realpathSync(absolute).startsWith(fs.realpathSync(repoRoot) + path.sep)
        || fs.lstatSync(absolute).isSymbolicLink() || !fs.statSync(absolute).isFile() || fs.statSync(absolute).size > maximumBytes) {
        throw new Error('not a bounded ordinary repository file');
      }
      return { absolute, bytes: fs.readFileSync(absolute) };
    } catch {
      errors.push(`${contractPath} executable evidence ${relativePath} must be a bounded ordinary repository file.`);
      return null;
    }
  };
  const readObject = (relativePath) => {
    const file = readEvidence(relativePath);
    try {
      const value = file && JSON.parse(file.bytes.toString('utf8'));
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch { /* Invalid evidence remains a structured rejection below. */ }
    errors.push(`${contractPath} executable evidence ${relativePath} must contain a JSON object.`);
    return null;
  };
  const supply = readObject(contract.supply_chain_artifact_evidence?.default_path);
  if (!supply) return;
  requireValue(supply.schema_version === 1 && supply.evidence_id === 'brownie-supply-chain-artifact-evidence-v1',
    errors, `${contractPath} executable supply-chain evidence must identify its supported schema.`);
  requireValue(supply.source_tree_dirty === false && supply.sourceCheckoutState === 'clean'
    && supply.source_checkout?.state === 'clean' && supply.source_checkout?.validation?.valid === true,
  errors, `${contractPath} executable evidence must prove clean source identity.`);
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
    return result.status === 0 ? result.stdout.trim() : null;
  };
  const testedTree = /^[a-f0-9]{40}$/.test(trace.tested_commit ?? '') ? git('rev-parse', '--verify', `${trace.tested_commit}^{tree}`) : null;
  const currentTree = git('rev-parse', '--verify', 'HEAD^{tree}');
  requireValue(testedTree !== null && testedTree === currentTree, errors,
    `${contractPath} tested_commit must identify the current audited source tree; stale evidence cannot satisfy the contract.`);
  if (/^[a-f0-9]{40}$/.test(trace.implementation_commit ?? '') && /^[a-f0-9]{40}$/.test(trace.tested_commit ?? '')) {
    requireValue(git('merge-base', '--is-ancestor', trace.implementation_commit, trace.tested_commit) !== null,
      errors, `${contractPath} implementation_commit must belong to the independently identified tested commit.`);
  }
  requireValue(git('diff', '--quiet', 'HEAD', '--', '.', ':(exclude).brownie/release-evidence/') !== null, errors,
    `${contractPath} implemented evidence cannot describe a dirty tracked source checkout.`);
  const artifacts = supply.sections?.artifacts?.artifacts;
  requireValue(supply.sections?.artifacts?.status === 'satisfied', errors,
    `${contractPath} implemented artifact evidence requires a validated satisfied artifact section.`);
  const matching = Array.isArray(artifacts) ? artifacts.filter((artifact) =>
    artifact?.provenance_binding?.implementationCommit === trace.implementation_commit
    && artifact?.provenance_binding?.testedCommit === trace.tested_commit
    && artifact?.provenance_binding?.workflowRunId === trace.workflow_run_id
    && artifact?.sha256 === trace.artifact_sha256) : [];
  requireValue(matching.length === 1, errors, `${contractPath} commit_trace must identify exactly one validated executable artifact, including its workflow and both commit identities.`);
  for (const artifact of matching) {
    const provenance = artifact.provenance_binding;
    const sourceCommit = 'sha256:' + trace.tested_commit;
    const sourceIdentity = 'sha256:' + crypto.createHash('sha256').update(sourceCommit + ':clean').digest('hex');
    requireValue(artifact.source_commit === sourceCommit && artifact.source_clean_tree === 'clean'
      && artifact.source_identity === sourceIdentity && provenance.buildSourceCommit === sourceCommit
      && provenance.buildSourceCleanTree === 'clean' && provenance.buildSourceIdentity === sourceIdentity
      && provenance.sourceCheckoutState === 'clean', errors,
    `${contractPath} artifact source identity must bind the actual tested commit and clean source tree.`);
    requireValue(typeof provenance.platform === 'string' && typeof provenance.architecture === 'string'
      && artifact.target === provenance.platform + '-' + provenance.architecture, errors,
    `${contractPath} executable artifact target must match its platform and architecture.`);
    const provenanceIdentity = 'sha256:' + crypto.createHash('sha256').update([
      trace.implementation_commit, trace.tested_commit, trace.workflow_run_id, artifact.path,
      trace.artifact_sha256, provenance.platform, provenance.architecture
    ].join('\n')).digest('hex');
    requireValue(artifact.provenance_identity === provenanceIdentity, errors,
      `${contractPath} artifact provenance identity must bind the exact trace and target.`);
    const actual = readEvidence(artifact.path, 128 * 1024 * 1024);
    requireValue(actual && 'sha256:' + crypto.createHash('sha256').update(actual.bytes).digest('hex') === trace.artifact_sha256,
      errors, `${contractPath} commit_trace.artifact_sha256 must match the actual referenced artifact bytes.`);
    const roundtrip = supply.sections?.artifacts?.release_evidence_binding;
    const bindings = Array.isArray(roundtrip?.bindings) ? roundtrip.bindings : [];
    const bound = bindings.filter((item) => item?.target === artifact.target);
    requireValue(roundtrip?.evidence_id === 'brownie-release-evidence-roundtrip-binding-v1'
      && roundtrip.status === 'satisfied' && bound.length === 1, errors,
    `${contractPath} trace-bound artifact requires one executable roundtrip binding.`);
    for (const item of bound) {
      requireValue(item.implementation_commit === 'sha256:' + trace.implementation_commit
        && item.tested_commit === trace.tested_commit && item.workflow_run_id === trace.workflow_run_id
        && item.binary_sha256 === trace.artifact_sha256 && item.platform === provenance.platform
        && item.architecture === provenance.architecture && item.status === 'satisfied'
        && /^sha256:[a-f0-9]{64}$/.test(item.package_sha256 ?? '')
        && /^sha256:[a-f0-9]{64}$/.test(item.runtime_sha256 ?? ''), errors,
      `${contractPath} executable roundtrip binding must match the exact commit, workflow, digest and target.`);
      for (const [kind, evidenceId, checkIds] of [
        ['journey', 'brownie-release-artifact-runtime-journey-v1', ['mode_pack_load', 'workspace_mutation', 'ledger_generation', 'forced_interruption', 'resume', 'stale_replay_rejection']],
        ['soak', 'brownie-release-artifact-stateful-soak-v1', ['artifact_execution_boundary', 'process_loss_recovery', 'duplicate_side_effect_rejection', 'ledger_workspace_consistency', 'resume_replay_behavior', 'finite_convergence', 'evidence_chain_integrity']]
      ]) {
        const observed = readObject(item[kind + '_evidence_path']);
        requireValue(observed?.evidence_id === evidenceId && observed.target === artifact.target
          && observed.workflow_run_id === trace.workflow_run_id && observed.artifact?.artifact_sha256 === trace.artifact_sha256
          && observed.artifact?.archive_sha256 === item.package_sha256 && observed.artifact?.runtime_sha256 === item.runtime_sha256
          && checkIds.every((id) => observed.checks?.[id]?.passed === true), errors,
        `${contractPath} executable ${kind} reference must match the actual artifact trace and passed checks.`);
      }
    }
  }
  for (const [field, entry] of claimed) {
    const actual = readEvidence(entry.path, field === 'artifacts' ? 128 * 1024 * 1024 : 16 * 1024 * 1024);
    if (actual && field === 'artifacts') {
      requireValue(matching.some((artifact) => typeof artifact.path === 'string' && path.resolve(repoRoot, artifact.path) === actual.absolute), errors,
        `${contractPath} implemented artifact path must identify the trace-bound executable artifact.`);
    } else if (actual) {
      const section = supply.sections?.[{ sha256sums: 'checksums', signature: 'signature_or_integrity_proof', sbom: 'sbom', provenance: 'provenance' }[field]];
      requireValue(section?.status === 'satisfied' && typeof section.path === 'string'
        && path.resolve(repoRoot, section.path) === actual.absolute
        && section.sha256 === 'sha256:' + crypto.createHash('sha256').update(actual.bytes).digest('hex'), errors,
      `${contractPath} implemented ${field} reference must match its executable evidence path and physical digest.`);
    }
  }
  const runtimeClaims = (Array.isArray(contract.release_ready_conditions) ? contract.release_ready_conditions : []).some((entry) =>
    ['artifact_smoke_tests', 'tested_commit_matches_artifact_commit', 'audit_trace_matches_tested_commit'].includes(entry?.id)
    && ['implemented_sufficient', 'satisfied'].includes(entry?.status));
  if (runtimeClaims) {
    const runtime = readObject(contract.runtime_operational_evidence?.default_path);
    const binding = supply.sections?.artifacts?.release_evidence_binding;
    requireValue(runtime?.evidence_id === 'brownie-runtime-operational-evidence-v1'
      && runtime.release_evidence_binding?.binding_digest === binding?.binding_digest
      && typeof binding?.binding_digest === 'string'
      && JSON.stringify(runtime.release_evidence_binding?.bindings) === JSON.stringify(binding.bindings), errors,
    `${contractPath} Runtime and supply-chain executable evidence must share the same exact roundtrip binding.`);
  }
}

function validateRuntimeReleaseContract(contract, options = {}) {
  const contractPath = options.contractPath ?? defaultContractPath;
  const packageJson = options.packageJson ?? {};
  const vsixPackageJson = options.vsixPackageJson ?? {};
  const audit = options.audit ?? {};
  const readinessAuditContentSha256 = options.readinessAuditContentSha256 ?? null;
  const errors = [];

  requireValue(Number.isInteger(contract.schema_version) && contract.schema_version > 0, errors, `${contractPath} schema_version must be a positive integer.`);
  requireValue(contract.contract_id === 'runtime-release-engineering-contract-v1', errors, `${contractPath} contract_id must identify the Runtime release engineering contract.`);
  requireValue(contract.owner === 'runtime', errors, `${contractPath} owner must be runtime.`);
  requireValue(contract.phase === 'RRP-8.7', errors, `${contractPath} phase must be RRP-8.7.`);
  requireValue(contract.runtime_release_ready === false, errors, `${contractPath} must keep runtime_release_ready false until all release evidence exists.`);

  validateCommitTrace(contract.commit_trace, errors, contractPath);
  requireValue(
    contract.commit_trace?.readiness_audit_content_sha256 === readinessAuditContentSha256,
    errors,
    `${contractPath} commit_trace.readiness_audit_content_sha256 must match the current readiness audit content SHA-256.`
  );

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
  const readinessReleaseBlockers = Array.isArray(audit.release_blockers) ? audit.release_blockers : [];
  const unresolvedBlockerCondition = conditionById.get('no_unresolved_release_blockers');
  if (readinessReleaseBlockers.length > 0 && unresolvedBlockerCondition) {
    requireValue(
      !['implemented_sufficient', 'satisfied'].includes(unresolvedBlockerCondition.status),
      errors,
      `${contractPath} no_unresolved_release_blockers must remain blocked while ${defaultAuditPath} release_blockers is non-empty.`
    );
  }

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
  requireValue(packageJson.scripts?.['release:dependency-security-license-audit'] === 'node scripts/release-dependency-security-license-audit.mjs', errors, `${defaultPackagePath} must define release:dependency-security-license-audit.`);
  requireValue(packageJson.scripts?.['release:dependency-security-license-audit:test'] === 'node --test scripts/release-dependency-security-license-audit.test.mjs', errors, `${defaultPackagePath} must define release:dependency-security-license-audit:test.`);
  requireValue(packageJson.scripts?.['release:local-artifact'] === 'node scripts/release-local-artifact.mjs', errors, `${defaultPackagePath} must define release:local-artifact.`);
  requireValue(packageJson.scripts?.['release:local-artifacts:all'] === 'node scripts/release-local-artifacts-all.mjs', errors, `${defaultPackagePath} must define release:local-artifacts:all.`);
  requireValue(packageJson.scripts?.['release:linux-vm-create'] === 'node scripts/create-linux-release-vm.mjs', errors, `${defaultPackagePath} must define release:linux-vm-create.`);
  requireValue(packageJson.scripts?.['release:windows-vm-create'] === 'node scripts/create-windows-release-vm.mjs', errors, `${defaultPackagePath} must define release:windows-vm-create.`);
  requireValue(packageJson.scripts?.['release:vm-bootstrap'] === 'node scripts/bootstrap-release-vms.mjs', errors, `${defaultPackagePath} must define release:vm-bootstrap.`);
  requireValue(packageJson.scripts?.['release:vm-image'] === 'node scripts/manage-release-vm-images.mjs', errors, `${defaultPackagePath} must define release:vm-image.`);
  requireValue(packageJson.scripts?.['release:supply-chain-artifact-evidence'] === 'node scripts/release-supply-chain-artifact-evidence.mjs', errors, `${defaultPackagePath} must define release:supply-chain-artifact-evidence.`);
  requireValue(packageJson.scripts?.['release:runtime-operational-evidence'] === 'node scripts/release-runtime-operational-evidence.mjs', errors, `${defaultPackagePath} must define release:runtime-operational-evidence.`);
  requireValue(packageJson.scripts?.['release:integrity-verify'] === 'node scripts/release-integrity-verify.mjs', errors, `${defaultPackagePath} must define release:integrity-verify.`);
  requireValue(packageJson.scripts?.['release:owner-governance-evidence'] === 'node scripts/release-owner-governance-evidence.mjs', errors, `${defaultPackagePath} must define release:owner-governance-evidence.`);
  requireValue(packageJson.scripts?.['release:owner-governance-evidence:test'] === 'node --test scripts/release-owner-governance-evidence.test.mjs', errors, `${defaultPackagePath} must define release:owner-governance-evidence:test.`);
  requireValue(packageJson.scripts?.['phase-loop:todo-state:test'] === 'node --test scripts/phase-loop-todo-state.test.mjs', errors, `${defaultPackagePath} must define phase-loop:todo-state:test.`);
  requireValue(packageJson.scripts?.['phase-loop:supervisor-diagnose:test'] === 'node --test scripts/phase-loop-supervisor-diagnose.test.mjs', errors, `${defaultPackagePath} must define phase-loop:supervisor-diagnose:test.`);
  requireValue(packageJson.scripts?.['phase-loop:supervisor-control:test'] === 'node --test scripts/phase-loop-supervisor-control.test.mjs', errors, `${defaultPackagePath} must define phase-loop:supervisor-control:test.`);
  requireValue(packageJson.scripts?.['guard:local-release-targets'] === 'node scripts/guard-local-release-targets.mjs', errors, `${defaultPackagePath} must define guard:local-release-targets.`);
  requireValue(packageJson.scripts?.['guard:release-contract'] === 'node scripts/guard-release-contract.mjs', errors, `${defaultPackagePath} must define guard:release-contract.`);
  requireValue(packageJson.scripts?.['guard:release-contract:test'] === 'node --test scripts/guard-release-contract.test.mjs', errors, `${defaultPackagePath} must define guard:release-contract:test.`);
  requireValue(packageJson.scripts?.['guard:trace-binding'] === 'node scripts/release-gate.mjs --validate-trace-binding --test-schema', errors, `${defaultPackagePath} must define guard:trace-binding.`);
  requireValue(packageJson.scripts?.['guard:trace-binding:test'] === 'node scripts/release-gate.mjs --validate-trace-binding --test-schema', errors, `${defaultPackagePath} must define guard:trace-binding:test.`);
  requireValue(packageJson.scripts?.['guard:dependency-security-license-audit'] === 'node scripts/guard-dependency-security-license-audit.mjs', errors, `${defaultPackagePath} must define guard:dependency-security-license-audit.`);
  requireValue(packageJson.scripts?.['guard:dependency-security-license-audit:test'] === 'node --test scripts/guard-dependency-security-license-audit.test.mjs', errors, `${defaultPackagePath} must define guard:dependency-security-license-audit:test.`);
  requireValue(packageJson.scripts?.['guard:supply-chain-artifact-evidence'] === 'node scripts/guard-supply-chain-artifact-evidence.mjs', errors, `${defaultPackagePath} must define guard:supply-chain-artifact-evidence.`);
  requireValue(packageJson.scripts?.['guard:supply-chain-artifact-evidence:test'] === 'node --test scripts/guard-supply-chain-artifact-evidence.test.mjs', errors, `${defaultPackagePath} must define guard:supply-chain-artifact-evidence:test.`);
  requireValue(packageJson.scripts?.['guard:runtime-operational-evidence'] === 'node scripts/guard-runtime-operational-evidence.mjs', errors, `${defaultPackagePath} must define guard:runtime-operational-evidence.`);
  requireValue(packageJson.scripts?.['guard:runtime-operational-evidence:test'] === 'node --test scripts/guard-runtime-operational-evidence.test.mjs', errors, `${defaultPackagePath} must define guard:runtime-operational-evidence:test.`);
  requireValue(packageJson.scripts?.['guard:modepack-distribution-trust'] === 'node scripts/guard-modepack-distribution-trust.mjs', errors, `${defaultPackagePath} must define guard:modepack-distribution-trust.`);
  requireValue(packageJson.scripts?.['guard:modepack-distribution-trust:test'] === 'node --test scripts/guard-modepack-distribution-trust.test.mjs', errors, `${defaultPackagePath} must define guard:modepack-distribution-trust:test.`);
  requireValue(packageJson.scripts?.['guard:ledger-contract-single-source'] === 'node scripts/guard-ledger-contract-single-source.mjs', errors, `${defaultPackagePath} must define guard:ledger-contract-single-source.`);
  requireValue(packageJson.scripts?.['guard:ledger-contract-single-source:test'] === 'node --test scripts/guard-ledger-contract-single-source.test.mjs', errors, `${defaultPackagePath} must define guard:ledger-contract-single-source:test.`);
  requireValue(packageJson.scripts?.['guard:historical-ledger-fixtures'] === 'node scripts/guard-historical-ledger-fixtures.mjs', errors, `${defaultPackagePath} must define guard:historical-ledger-fixtures.`);
  requireValue(packageJson.scripts?.['guard:historical-ledger-fixtures:test'] === 'node --test scripts/guard-historical-ledger-fixtures.test.mjs', errors, `${defaultPackagePath} must define guard:historical-ledger-fixtures:test.`);
  requireValue(packageJson.scripts?.['guard:owner-governance-evidence'] === 'node scripts/guard-owner-governance-evidence.mjs', errors, `${defaultPackagePath} must define guard:owner-governance-evidence.`);
  requireValue(packageJson.scripts?.['guard:owner-governance-evidence:test'] === 'node --test scripts/guard-owner-governance-evidence.test.mjs', errors, `${defaultPackagePath} must define guard:owner-governance-evidence:test.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root guard:release-contract'), errors, `${defaultVsixPackagePath} check must invoke guard:release-contract.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root guard:release-contract:test'), errors, `${defaultVsixPackagePath} check must invoke guard:release-contract:test.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root release:gate -- --dry-run'), errors, `${defaultVsixPackagePath} check must invoke release:gate dry-run through the existing CI path.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root guard:supply-chain-artifact-evidence'), errors, `${defaultVsixPackagePath} check must invoke guard:supply-chain-artifact-evidence.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root guard:supply-chain-artifact-evidence:test'), errors, `${defaultVsixPackagePath} check must invoke guard:supply-chain-artifact-evidence:test.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root guard:runtime-operational-evidence'), errors, `${defaultVsixPackagePath} check must invoke guard:runtime-operational-evidence.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root guard:runtime-operational-evidence:test'), errors, `${defaultVsixPackagePath} check must invoke guard:runtime-operational-evidence:test.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root guard:modepack-distribution-trust'), errors, `${defaultVsixPackagePath} check must invoke guard:modepack-distribution-trust.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root guard:modepack-distribution-trust:test'), errors, `${defaultVsixPackagePath} check must invoke guard:modepack-distribution-trust:test.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root guard:ledger-contract-single-source'), errors, `${defaultVsixPackagePath} check must invoke guard:ledger-contract-single-source.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root guard:ledger-contract-single-source:test'), errors, `${defaultVsixPackagePath} check must invoke guard:ledger-contract-single-source:test.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root guard:historical-ledger-fixtures'), errors, `${defaultVsixPackagePath} check must invoke guard:historical-ledger-fixtures.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root guard:historical-ledger-fixtures:test'), errors, `${defaultVsixPackagePath} check must invoke guard:historical-ledger-fixtures:test.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root guard:owner-governance-evidence'), errors, `${defaultVsixPackagePath} check must invoke guard:owner-governance-evidence.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root guard:owner-governance-evidence:test'), errors, `${defaultVsixPackagePath} check must invoke guard:owner-governance-evidence:test.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root release:owner-governance-evidence:test'), errors, `${defaultVsixPackagePath} check must invoke release:owner-governance-evidence:test.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root phase-loop:todo-state:test'), errors, `${defaultVsixPackagePath} check must invoke phase-loop:todo-state:test.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root phase-loop:supervisor-diagnose:test'), errors, `${defaultVsixPackagePath} check must invoke phase-loop:supervisor-diagnose:test.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root phase-loop:supervisor-control:test'), errors, `${defaultVsixPackagePath} check must invoke phase-loop:supervisor-control:test.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root release:dependency-security-license-audit:test'), errors, `${defaultVsixPackagePath} check must invoke release:dependency-security-license-audit:test.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root guard:dependency-security-license-audit'), errors, `${defaultVsixPackagePath} check must invoke guard:dependency-security-license-audit.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root guard:dependency-security-license-audit:test'), errors, `${defaultVsixPackagePath} check must invoke guard:dependency-security-license-audit:test.`);
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root guard:local-release-targets'), errors, `${defaultVsixPackagePath} check must invoke guard:local-release-targets.`);

  const external = Array.isArray(contract.external_blockers) ? contract.external_blockers : [];
  requireValue(
    external.some((entry) => entry?.id === 'github_workflow_scope' && entry?.status === 'blocked_external'),
    errors,
    `${contractPath} must record github_workflow_scope as blocked_external while workflow scope is absent.`
  );

  const artifactEvidence = contract.release_artifact_evidence ?? {};
  const implementedArtifactEvidenceStatuses = new Set(['implemented_sufficient', 'satisfied']);
  for (const field of ['artifacts', 'sha256sums', 'signature', 'sbom', 'provenance']) {
    const entry = artifactEvidence[field];
    requireValue(entry && typeof entry === 'object', errors, `${contractPath} release_artifact_evidence.${field} must be an object.`);
    if (entry && typeof entry === 'object') {
      requireValue(entry.status !== 'satisfied', errors, `${contractPath} release_artifact_evidence.${field} must not be satisfied before real artifacts exist.`);
      requireValue(entry.path === null || isNonEmptyString(entry.path), errors, `${contractPath} release_artifact_evidence.${field}.path must be null or non-empty.`);
      if (implementedArtifactEvidenceStatuses.has(entry.status)) {
        requireArtifactBindingTrace(contract.commit_trace, errors, contractPath, field);
      }
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

  const runtimeOperationalEvidence = contract.runtime_operational_evidence ?? {};
  requireValue(
    runtimeOperationalEvidence.contract_id === 'brownie-runtime-operational-evidence-v1',
    errors,
    `${contractPath} runtime_operational_evidence.contract_id must match the repo-local runtime operational evidence contract.`
  );
  requireValue(
    runtimeOperationalEvidence.default_path === '.brownie/release-evidence/runtime-operational-evidence.json',
    errors,
    `${contractPath} runtime_operational_evidence.default_path must point to the ignored local evidence path.`
  );
  for (const section of ['artifact_lifecycle', 'golden_journey_fixture', 'soak_test']) {
    requireValue(
      Array.isArray(runtimeOperationalEvidence.required_sections) && runtimeOperationalEvidence.required_sections.includes(section),
      errors,
      `${contractPath} runtime_operational_evidence.required_sections must include ${section}.`
    );
  }

  const dependencyAudit = contract.dependency_security_license_audit ?? {};
  requireValue(
    dependencyAudit.contract_id === 'brownie-dependency-security-license-audit-v1',
    errors,
    `${contractPath} dependency_security_license_audit.contract_id must match.`
  );
  requireValue(
    dependencyAudit.default_path === '.brownie/release-evidence/dependency-security-license-audit.json',
    errors,
    `${contractPath} dependency_security_license_audit.default_path must point to the ignored local dependency audit evidence path.`
  );
  for (const check of ['cargo_audit_locked', 'cargo_deny_policy', 'pnpm_audit_prod']) {
    requireValue(
      Array.isArray(dependencyAudit.required_checks) && dependencyAudit.required_checks.includes(check),
      errors,
      `${contractPath} dependency_security_license_audit.required_checks must include ${check}.`
    );
  }

  const ownerGovernanceEvidence = contract.owner_governance_evidence ?? {};
  requireValue(
    ownerGovernanceEvidence.contract_id === 'brownie-owner-governance-evidence-v1',
    errors,
    `${contractPath} owner_governance_evidence.contract_id must match the repo-local owner governance evidence contract.`
  );
  requireValue(
    ownerGovernanceEvidence.default_path === '.brownie/release-evidence/owner-governance-evidence.json',
    errors,
    `${contractPath} owner_governance_evidence.default_path must point to the ignored local owner governance evidence path.`
  );
  for (const section of [
    'branch_protection',
    'required_status_checks',
    'protected_tag_policy',
    'remote_ci_workflow_provenance',
    'signature_or_integrity_authority',
    'independent_reviews',
    'oss_license_publish_posture'
  ]) {
    requireValue(
      Array.isArray(ownerGovernanceEvidence.required_sections) && ownerGovernanceEvidence.required_sections.includes(section),
      errors,
      `${contractPath} owner_governance_evidence.required_sections must include ${section}.`
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
  const auditText = options.auditText ?? readText(repoRoot, auditPath, errors);
  const readinessAuditContentSha256 = computeReadinessAuditContentSha256(auditText);
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
    audit,
    readinessAuditContentSha256
  }));
  validateExecutableTraceBinding(repoRoot, contract, errors, contractPath);
  return { errors, contractPath };
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const argv = process.argv.slice(2);
  const repoIndex = argv.indexOf('--repo');
  const result = runReleaseContractGuard({
    repoRoot: repoIndex >= 0 ? argv[repoIndex + 1] : undefined
  });
  if (result.errors.length > 0) {
    console.error('Runtime release contract guard failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log(`Runtime release contract guard passed for ${result.contractPath}.`);
}
