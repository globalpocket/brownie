import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultContractPath = 'docs/architecture/runtime-release-contract.json';
const defaultEvidencePath = '.brownie/release-evidence/runtime-operational-evidence.json';

const requiredSections = ['artifact_lifecycle', 'golden_journey_fixture', 'soak_test'];
const allowedIncompleteStatuses = new Set([
  'failed',
  'not_executed',
  'not_executed_missing_artifacts',
  'not_executed_incompatible_host',
  'blocked_external'
]);

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join('/').replace(/^\.\//, '');
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireValue(condition, errors, message) {
  if (!condition) {
    errors.push(message);
  }
}

function readJson(repoRoot, relativePath, errors) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
  } catch (error) {
    errors.push(`${relativePath} must be readable JSON: ${error.message}`);
    return {};
  }
}

function validateCommand(command, errors, owner) {
  requireValue(Number.isInteger(command?.exit_code), errors, `${owner}.exit_code must be an integer.`);
  requireValue(typeof command?.passed === 'boolean', errors, `${owner}.passed must be boolean.`);
}

function validateSatisfiedCommands(commands, errors, owner) {
  requireValue(Array.isArray(commands) && commands.length > 0, errors, `${owner} must include commands.`);
  for (const [index, command] of (Array.isArray(commands) ? commands : []).entries()) {
    validateCommand(command, errors, `${owner}[${index}]`);
    requireValue(command?.passed === true, errors, `${owner}[${index}] must pass.`);
    requireValue(command?.exit_code === 0, errors, `${owner}[${index}].exit_code must be 0.`);
  }
}

export function validateRuntimeOperationalEvidence(evidence) {
  const errors = [];
  requireValue(evidence.schema_version === 1, errors, 'runtime operational evidence schema_version must be 1.');
  requireValue(evidence.evidence_id === 'brownie-runtime-operational-evidence-v1', errors, 'runtime operational evidence_id must match.');
  requireValue(evidence.repository === 'globalpocket/brownie', errors, 'runtime operational evidence repository must be globalpocket/brownie.');
  requireValue(evidence.release_ready === false, errors, 'runtime operational evidence must not declare release_ready true.');
  requireValue(evidence.runtime_release_ready === false, errors, 'runtime operational evidence must not declare runtime_release_ready true.');
  requireValue(Array.isArray(evidence.fail_closed_reasons), errors, 'runtime operational evidence must include fail_closed_reasons.');

  const required = new Set(Array.isArray(evidence.required_sections) ? evidence.required_sections : []);
  for (const sectionId of requiredSections) {
    requireValue(required.has(sectionId), errors, `runtime operational evidence required_sections must include ${sectionId}.`);
    const section = evidence.sections?.[sectionId];
    requireValue(section && typeof section === 'object', errors, `runtime operational evidence sections.${sectionId} must be present.`);
    if (!section || typeof section !== 'object') {
      continue;
    }
    requireValue(isNonEmptyString(section.status), errors, `sections.${sectionId}.status must be non-empty.`);
    requireValue(section.release_blocking === true, errors, `sections.${sectionId} must be release_blocking.`);
    if (section.status !== 'satisfied') {
      requireValue(allowedIncompleteStatuses.has(section.status), errors, `sections.${sectionId}.status ${section.status} is not allowed.`);
      requireValue(
        evidence.fail_closed_reasons.some((reason) => reason.startsWith(`${sectionId}:`)),
        errors,
        `runtime operational evidence fail_closed_reasons must include ${sectionId}.`
      );
    }
  }

  for (const [index, result] of (Array.isArray(evidence.sections?.artifact_lifecycle?.lifecycle_results) ? evidence.sections.artifact_lifecycle.lifecycle_results : []).entries()) {
    requireValue(isNonEmptyString(result.path), errors, `sections.artifact_lifecycle.lifecycle_results[${index}].path must be non-empty.`);
    for (const [commandIndex, command] of (Array.isArray(result.commands) ? result.commands : []).entries()) {
      validateCommand(command, errors, `sections.artifact_lifecycle.lifecycle_results[${index}].commands[${commandIndex}]`);
    }
    if (evidence.sections?.artifact_lifecycle?.status === 'satisfied') {
      requireValue(result.passed === true, errors, `sections.artifact_lifecycle.lifecycle_results[${index}] must pass when artifact_lifecycle is satisfied.`);
      requireValue(result.status === 'satisfied', errors, `sections.artifact_lifecycle.lifecycle_results[${index}].status must be satisfied.`);
      requireValue(result.uninstalled === true, errors, `sections.artifact_lifecycle.lifecycle_results[${index}].uninstalled must be true.`);
      requireValue(result.checksum_verified === true, errors, `sections.artifact_lifecycle.lifecycle_results[${index}].checksum_verified must be true.`);
      validateSatisfiedCommands(result.commands, errors, `sections.artifact_lifecycle.lifecycle_results[${index}].commands`);
    }
  }

  for (const [index, command] of (Array.isArray(evidence.sections?.golden_journey_fixture?.commands) ? evidence.sections.golden_journey_fixture.commands : []).entries()) {
    validateCommand(command, errors, `sections.golden_journey_fixture.commands[${index}]`);
  }
  if (evidence.sections?.golden_journey_fixture?.status === 'satisfied') {
    validateSatisfiedCommands(
      evidence.sections.golden_journey_fixture.commands,
      errors,
      'sections.golden_journey_fixture.commands'
    );
    const lifecycleEvidence = evidence.sections.golden_journey_fixture.lifecycle_evidence;
    requireValue(
      lifecycleEvidence && typeof lifecycleEvidence === 'object',
      errors,
      'sections.golden_journey_fixture.lifecycle_evidence must be present when satisfied.'
    );
    for (const field of [
      'json_present',
      'proposal_preflight_observed',
      'apply_observed',
      'post_apply_verification_observed',
      'workspace_mutation_observed',
      'completion_observed'
    ]) {
      requireValue(
        lifecycleEvidence?.[field] === true,
        errors,
        `sections.golden_journey_fixture.lifecycle_evidence.${field} must be true when satisfied.`
      );
    }
  }

  const soak = evidence.sections?.soak_test;
  if (soak && typeof soak === 'object') {
    requireValue(Number.isInteger(soak.iterations_requested), errors, 'sections.soak_test.iterations_requested must be an integer.');
    requireValue(Number.isInteger(soak.iterations_completed), errors, 'sections.soak_test.iterations_completed must be an integer.');
    requireValue(Number.isInteger(soak.failure_count), errors, 'sections.soak_test.failure_count must be an integer.');
    requireValue(typeof soak.failure_rate === 'number', errors, 'sections.soak_test.failure_rate must be a number.');
    if (soak.status === 'satisfied') {
      requireValue(soak.iterations_completed === soak.iterations_requested, errors, 'satisfied soak_test must complete all requested iterations.');
      requireValue(soak.failure_count === 0, errors, 'satisfied soak_test must have zero failures.');
      requireValue(soak.failure_rate === 0, errors, 'satisfied soak_test must have a zero failure rate.');
      requireValue(soak.duplicate_side_effects_observed === false, errors, 'satisfied soak_test must not observe duplicate side effects.');
      requireValue(soak.unrecoverable_run_count === 0, errors, 'satisfied soak_test must have zero unrecoverable runs.');
      validateSatisfiedCommands(soak.commands, errors, 'sections.soak_test.commands');
    }
  }
  return errors;
}

export function validateRuntimeOperationalEvidenceContract(contract, options = {}) {
  const contractPath = options.contractPath ?? defaultContractPath;
  const errors = [];
  const localGateCommands = new Set(
    (Array.isArray(contract.local_release_gate?.commands) ? contract.local_release_gate.commands : []).map((entry) => entry?.command)
  );
  for (const command of [
    'pnpm --workspace-root release:runtime-operational-evidence',
    'pnpm --workspace-root guard:runtime-operational-evidence',
    'pnpm --workspace-root guard:runtime-operational-evidence:test'
  ]) {
    requireValue(localGateCommands.has(command), errors, `${contractPath} local_release_gate.commands must include ${command}.`);
  }

  const evidence = contract.runtime_operational_evidence ?? {};
  requireValue(evidence.contract_id === 'brownie-runtime-operational-evidence-v1', errors, `${contractPath} runtime_operational_evidence.contract_id must match.`);
  requireValue(evidence.default_path === defaultEvidencePath, errors, `${contractPath} runtime_operational_evidence.default_path must be ${defaultEvidencePath}.`);
  for (const sectionId of requiredSections) {
    requireValue(
      Array.isArray(evidence.required_sections) && evidence.required_sections.includes(sectionId),
      errors,
      `${contractPath} runtime_operational_evidence.required_sections must include ${sectionId}.`
    );
  }
  return errors;
}

export function runRuntimeOperationalEvidenceGuard(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const contractPath = options.contractPath ?? defaultContractPath;
  const evidencePath = normalizeRelativePath(options.evidencePath ?? process.env.BROWNIE_RUNTIME_OPERATIONAL_EVIDENCE ?? defaultEvidencePath);
  const errors = [];
  const contract = options.contract ?? readJson(repoRoot, contractPath, errors);
  errors.push(...validateRuntimeOperationalEvidenceContract(contract, { contractPath }));
  const shouldValidateEvidence =
    options.evidence !== undefined || process.env.BROWNIE_RUNTIME_OPERATIONAL_EVIDENCE || fs.existsSync(path.join(repoRoot, evidencePath));
  if (shouldValidateEvidence) {
    const evidence = options.evidence ?? readJson(repoRoot, evidencePath, errors);
    errors.push(...validateRuntimeOperationalEvidence(evidence));
  }
  return { errors, contractPath, evidencePath, validatedEvidence: shouldValidateEvidence };
}

if (isMainModule()) {
  const result = runRuntimeOperationalEvidenceGuard();
  if (result.errors.length > 0) {
    console.error('Runtime operational evidence guard failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log(
    `Runtime operational evidence guard passed for ${result.contractPath}` +
      (result.validatedEvidence ? ` and ${result.evidencePath}.` : ' in contract-only mode.')
  );
}
