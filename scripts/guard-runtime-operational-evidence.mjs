import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPhaseLoopActorDeployment } from './phase-loop-actor-deployment.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultContractPath = 'docs/architecture/runtime-release-contract.json';
const defaultEvidencePath = '.brownie/release-evidence/runtime-operational-evidence.json';

export const runtimeOperationalEvidenceRequiredSections = Object.freeze([
  'artifact_lifecycle',
  'golden_journey_fixture',
  'soak_test',
  'executable_evidence_validation'
]);
const requiredSections = runtimeOperationalEvidenceRequiredSections;
const requiredStatefulSoakStepIds = [
  'task_state_transition',
  'ledger_workspace_consistency',
  'resume_replay_handling',
  'duplicate_side_effect_rejection',
  'process_loss_recovery',
  'finite_convergence',
  'evidence_chain_integrity',
  'artifact_lifecycle',
  'golden_journey_fixture',
  'soak_test',
  'executable_evidence_validation',
  'roundtrip_journey_binding',
  'soak_results_binding',
  'implementation_commit',
  'tested_commit',
  'workflow_run_id',
  'artifact_sha256',
  'binary_sha256',
  'platform',
  'architecture',
  'roundtrip_journey',
  'soak_results',
  'downloaded_roundtrip_binding',
  'runtime_journey_binding',
  'supply_chain_guard_binding'
];
const sha256Pattern = /^sha256:[a-f0-9]{64}$/u;
const sourceCommitSha256Pattern = /^sha256:[a-f0-9]{40}$/u;
const gitCommitPattern = /^[a-f0-9]{40}$/u;
const requiredDownloadedJourneyChecks = [
  'mode_pack_load',
  'workspace_mutation',
  'ledger_generation',
  'forced_interruption',
  'resume',
  'stale_replay_rejection'
];
const requiredDownloadedSoakChecks = [
  'artifact_execution_boundary',
  'process_loss_recovery',
  'duplicate_side_effect_rejection',
  'ledger_workspace_consistency',
  'resume_replay_behavior',
  'finite_convergence',
  'evidence_chain_integrity'
];
const allowedIncompleteStatuses = new Set([
  'failed',
  'not_executed',
  'not_executed_missing_artifacts',
  'not_executed_incompatible_host',
  'missing_config',
  'invalid_config',
  'blocked_external'
]);
const forbiddenEvidenceStringPattern = /(?:\/Users\/|\/home\/|[A-Za-z]:\/Users\/|EncodedCommand|brownie-linux|worktree)/u;
const forbiddenRawProcessFieldNames = new Set(['command', 'stdout', 'stderr']);
const downloadedArtifactBindingSource = 'downloaded_artifact_binding';

function collectStatefulSoakStepIds(stepsOrIds) {
  if (!Array.isArray(stepsOrIds)) {
    return new Set();
  }
  return new Set(
    stepsOrIds
      .map((step) => (typeof step === 'string' ? step : step?.id))
      .filter(Boolean)
  );
}

function validateRequiredStatefulSoakStepIds(stepsOrIds, errors, owner) {
  const stepIds = collectStatefulSoakStepIds(stepsOrIds);
  for (const requiredId of requiredStatefulSoakStepIds) {
    if (!stepIds.has(requiredId)) {
      errors.push(`${owner} must include ${requiredId}.`);
    }
  }
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join('/').replace(/^\.\//, '');
}

function isSafeRelativePath(value) {
  return (
    isNonEmptyString(value) &&
    !path.isAbsolute(value) &&
    !value.split(/[\\/]/).includes('..') &&
    !/[\0\r\n]/.test(value)
  );
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

function validateNoForbiddenLocalEvidence(value, errors, owner = 'runtime operational evidence') {
  if (typeof value === 'string') {
    requireValue(!forbiddenEvidenceStringPattern.test(value), errors, `${owner} must not contain forbidden local evidence.`);
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateNoForbiddenLocalEvidence(entry, errors, `${owner}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    requireValue(!forbiddenRawProcessFieldNames.has(key), errors, `${owner}.${key} must not store raw process evidence.`);
    validateNoForbiddenLocalEvidence(entry, errors, `${owner}.${key}`);
  }
}

function validateSatisfiedCommands(commands, errors, owner) {
  requireValue(Array.isArray(commands) && commands.length > 0, errors, `${owner} must include commands.`);
  for (const [index, command] of (Array.isArray(commands) ? commands : []).entries()) {
    validateCommand(command, errors, `${owner}[${index}]`);
    requireValue(command?.passed === true, errors, `${owner}[${index}] must pass.`);
    requireValue(command?.exit_code === 0, errors, `${owner}[${index}].exit_code must be 0.`);
  }
}

function usesDownloadedArtifactBinding(section) {
  return section?.evidence_source === downloadedArtifactBindingSource;
}

function validateDownloadedArtifactBindingSummary(section, errors, owner) {
  const binding = section?.evidence_binding;
  requireValue(binding && typeof binding === 'object', errors, `${owner}.evidence_binding must be present for downloaded-artifact evidence.`);
  requireValue(binding?.evidence_id === 'brownie-release-evidence-roundtrip-binding-v1', errors, `${owner}.evidence_binding.evidence_id must identify the roundtrip binding.`);
  requireValue(binding?.status === 'satisfied', errors, `${owner}.evidence_binding.status must be satisfied.`);
}

function validateSatisfiedStatefulSoakSteps(steps, errors) {
  requireValue(
    Array.isArray(steps) && steps.length > 0,
    errors,
    'satisfied soak_test must include stateful_steps.'
  );
  validateRequiredStatefulSoakStepIds(steps, errors, 'satisfied soak_test.stateful_steps');
  const byId = new Map((Array.isArray(steps) ? steps : []).map((step) => [step?.id, step]));
  for (const stepId of requiredStatefulSoakStepIds) {
    const step = byId.get(stepId);
    requireValue(
      step && typeof step === 'object',
      errors,
      `satisfied soak_test.stateful_steps must include ${stepId}.`
    );
    requireValue(
      step?.passed === true,
      errors,
      `satisfied soak_test.stateful_steps.${stepId}.passed must be true.`
    );
    requireValue(
      step?.status === 'satisfied',
      errors,
      `satisfied soak_test.stateful_steps.${stepId}.status must be satisfied.`
    );
  }
}

function targetCoordinates(target) {
  return {
    'darwin-arm64': { platform: 'darwin', architecture: 'arm64' },
    'linux-arm64': { platform: 'linux', architecture: 'arm64' },
    'linux-x64': { platform: 'linux', architecture: 'x64' },
    'win32-x64': { platform: 'win32', architecture: 'x64' }
  }[target] ?? null;
}

function requirePassedChecks(evidence, checkIds, errors, owner) {
  for (const checkId of checkIds) {
    requireValue(evidence?.checks?.[checkId]?.passed === true, errors, `${owner}.checks.${checkId}.passed must be true.`);
  }
}

function sha256Text(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function readBoundEvidence(repoRoot, relativePath, errors, owner) {
  requireValue(isSafeRelativePath(relativePath), errors, `${owner} must be repository-relative and bounded.`);
  if (!isSafeRelativePath(relativePath)) {
    return null;
  }
  let bounded = false;
  try {
    const root = fs.realpathSync(repoRoot);
    const file = path.resolve(repoRoot, relativePath);
    const resolved = path.relative(root, fs.realpathSync(file));
    let component = path.resolve(repoRoot);
    bounded = fs.lstatSync(file).isFile() && resolved !== '..' &&
      !resolved.startsWith(`..${path.sep}`) && !path.isAbsolute(resolved);
    for (const part of path.relative(component, file).split(path.sep)) {
      component = path.join(component, part);
      if (fs.lstatSync(component).isSymbolicLink()) bounded = false;
    }
  } catch { /* Missing or linked evidence cannot prove downloaded execution. */ }
  requireValue(bounded, errors, `${owner} must exist as a regular file within the repository.`);
  if (!bounded) return null;
  const evidence = readJson(repoRoot, relativePath, errors);
  requireValue(
    evidence !== null && typeof evidence === 'object' && !Array.isArray(evidence),
    errors,
    `${owner} must contain a JSON object.`
  );
  return evidence !== null && typeof evidence === 'object' && !Array.isArray(evidence) ? evidence : null;
}

function validateFiniteConvergence(soak, errors, owner) {
  const convergence = soak?.checks?.finite_convergence;
  requireValue(convergence?.passed === true, errors, `${owner}.checks.finite_convergence.passed must be true.`);
  requireValue(
    Number.isSafeInteger(convergence?.commands_executed) && convergence.commands_executed > 0,
    errors,
    `${owner}.checks.finite_convergence.commands_executed must be a positive safe integer.`
  );
  requireValue(
    Number.isSafeInteger(convergence?.maximum_commands) && convergence.maximum_commands > 0,
    errors,
    `${owner}.checks.finite_convergence.maximum_commands must be a positive safe integer.`
  );
  if (Number.isInteger(convergence?.commands_executed) && Number.isInteger(convergence?.maximum_commands)) {
    requireValue(
      convergence.commands_executed <= convergence.maximum_commands,
      errors,
      `${owner}.checks.finite_convergence must remain within maximum_commands.`
    );
  }
}

function validateDownloadedRuntimeEvidence(repoRoot, binding, errors, owner) {
  const journey = readBoundEvidence(repoRoot, binding.journey_evidence_path, errors, `${owner}.journey_evidence_path`);
  const soak = readBoundEvidence(repoRoot, binding.soak_evidence_path, errors, `${owner}.soak_evidence_path`);
  const expectedArtifact = {
    archive_sha256: binding.package_sha256,
    artifact_sha256: binding.binary_sha256,
    runtime_sha256: binding.runtime_sha256
  };
  for (const [kind, evidence, evidenceId, checkIds] of [
    ['journey', journey, 'brownie-release-artifact-runtime-journey-v1', requiredDownloadedJourneyChecks],
    ['soak', soak, 'brownie-release-artifact-stateful-soak-v1', requiredDownloadedSoakChecks]
  ]) {
    if (!evidence || typeof evidence !== 'object') {
      continue;
    }
    const evidenceOwner = `${owner}.${kind}`;
    requireValue(evidence.evidence_id === evidenceId, errors, `${evidenceOwner}.evidence_id must identify downloaded artifact evidence.`);
    requireValue(evidence.target === binding.target, errors, `${evidenceOwner}.target must match the binding target.`);
    requireValue(evidence.workflow_run_id === binding.workflow_run_id, errors, `${evidenceOwner}.workflow_run_id must match the binding.`);
    for (const [field, expected] of Object.entries(expectedArtifact)) {
      requireValue(evidence.artifact?.[field] === expected, errors, `${evidenceOwner}.artifact.${field} must match the binding.`);
    }
    requirePassedChecks(evidence, checkIds, errors, evidenceOwner);
  }
  requireValue(
    soak?.checks?.artifact_execution_boundary?.packaged_cli_only === true &&
      soak?.checks?.artifact_execution_boundary?.isolated_workspace_cwd === true &&
      soak?.checks?.artifact_execution_boundary?.runtime_path_override_removed === true,
    errors,
    `${owner}.soak must prove downloaded packaged execution, not build-tree execution.`
  );
  validateFiniteConvergence(soak, errors, `${owner}.soak`);
}

function validateReleaseEvidenceBinding(evidence, errors, options) {
  const owner = 'release_evidence_binding';
  const binding = evidence.release_evidence_binding;
  requireValue(binding && typeof binding === 'object', errors, `${owner} must be present when runtime evidence is satisfied.`);
  if (!binding || typeof binding !== 'object') {
    return;
  }
  requireValue(binding.schema_version === 1, errors, `${owner}.schema_version must be 1.`);
  requireValue(binding.evidence_id === 'brownie-release-evidence-roundtrip-binding-v1', errors, `${owner}.evidence_id must match.`);
  requireValue(binding.status === 'satisfied', errors, `${owner}.status must be satisfied.`);
  requireValue(binding.release_blocking === true, errors, `${owner}.release_blocking must be true.`);
  const bindings = Array.isArray(binding.bindings) ? binding.bindings : [];
  requireValue(bindings.length > 0, errors, `${owner}.bindings must contain downloaded-artifact evidence.`);
  requireValue(binding.target_count === bindings.length, errors, `${owner}.target_count must match bindings.`);
  requireValue(binding.satisfied_target_count === bindings.length, errors, `${owner}.satisfied_target_count must match bindings.`);
  requireValue(Array.isArray(binding.missing) && binding.missing.length === 0, errors, `${owner}.missing must be empty.`);

  const lifecycle = evidence.sections?.artifact_lifecycle;
  const lifecycleEntries = Array.isArray(lifecycle?.lifecycle_results) ? lifecycle.lifecycle_results : [];
  const lifecycleTargets = new Set(lifecycleEntries.map(result => result?.target).filter(isNonEmptyString));
  if (lifecycle?.status === 'satisfied') {
    requireValue(lifecycleEntries.length > 0 && lifecycleTargets.size === lifecycleEntries.length,
      errors, 'satisfied artifact lifecycle targets must be non-empty and unique.');
  }
  const expectedWorkflow = options.workflowRunId ?? (options.validateBoundEvidence === true ? process.env.GITHUB_RUN_ID : undefined);
  const expectedCommit = options.testedCommit ?? (options.validateBoundEvidence === true ? process.env.GITHUB_SHA : undefined);
  const seenTargets = new Set();
  for (const [index, entry] of bindings.entries()) {
    const entryOwner = `${owner}.bindings[${index}]`;
    requireValue(isNonEmptyString(entry?.target) && !seenTargets.has(entry.target), errors, `${entryOwner}.target must be unique and non-empty.`);
    if (!isNonEmptyString(entry?.target) || seenTargets.has(entry.target)) {
      continue;
    }
    seenTargets.add(entry.target);
    requireValue(entry.status === 'satisfied', errors, `${entryOwner}.status must be satisfied.`);
    requireValue(Array.isArray(entry.errors) && entry.errors.length === 0, errors, `${entryOwner}.errors must be empty.`);
    requireValue(sourceCommitSha256Pattern.test(entry.implementation_commit), errors, `${entryOwner}.implementation_commit must be a sha256 git commit.`);
    requireValue(gitCommitPattern.test(entry.tested_commit), errors, `${entryOwner}.tested_commit must be a git commit.`);
    requireValue(
      sourceCommitSha256Pattern.test(entry.implementation_commit) && entry.implementation_commit.slice('sha256:'.length) === entry.tested_commit,
      errors,
      `${entryOwner}.implementation_commit must match tested_commit.`
    );
    requireValue(typeof entry.workflow_run_id === 'string' && /^[1-9][0-9]*$/u.test(entry.workflow_run_id),
      errors, `${entryOwner}.workflow_run_id must be a canonical positive decimal string.`);
    if (expectedWorkflow !== undefined) {
      requireValue(entry.workflow_run_id === expectedWorkflow, errors, `${entryOwner}.workflow_run_id must match the current workflow.`);
    }
    if (expectedCommit !== undefined) {
      requireValue(entry.tested_commit === expectedCommit, errors, `${entryOwner}.tested_commit must match the current workflow.`);
    }
    requireValue(sha256Pattern.test(entry.package_sha256), errors, `${entryOwner}.package_sha256 must be sha256:<64 lowercase hex>.`);
    requireValue(sha256Pattern.test(entry.binary_sha256), errors, `${entryOwner}.binary_sha256 must be sha256:<64 lowercase hex>.`);
    requireValue(sha256Pattern.test(entry.runtime_sha256), errors, `${entryOwner}.runtime_sha256 must be sha256:<64 lowercase hex>.`);
    const expectedCoordinates = targetCoordinates(entry.target);
    requireValue(expectedCoordinates !== null, errors, `${entryOwner}.target must be a supported release target.`);
    if (expectedCoordinates) {
      requireValue(entry.platform === expectedCoordinates.platform, errors, `${entryOwner}.platform must match target.`);
      requireValue(entry.architecture === expectedCoordinates.architecture, errors, `${entryOwner}.architecture must match target.`);
    }
    requireValue(isSafeRelativePath(entry.journey_evidence_path), errors, `${entryOwner}.journey_evidence_path must be repository-relative and bounded.`);
    requireValue(isSafeRelativePath(entry.soak_evidence_path), errors, `${entryOwner}.soak_evidence_path must be repository-relative and bounded.`);
    const directory = `.brownie/release-evidence/artifacts/${entry.target}`;
    requireValue(entry.journey_evidence_path === `${directory}/runtime-journey-evidence.json` &&
      entry.soak_evidence_path === `${directory}/runtime-stateful-soak-evidence.json`,
    errors, `${entryOwner} receipt paths must identify the downloaded target directory.`);
    if (options.validateBoundEvidence === true) {
      validateDownloadedRuntimeEvidence(options.repoRoot, entry, errors, entryOwner);
    }
  }
  if (lifecycle?.status === 'satisfied') {
    for (const target of lifecycleTargets) {
      requireValue(seenTargets.has(target), errors, `${owner}.bindings must cover artifact lifecycle target ${target}.`);
    }
    requireValue(seenTargets.size === lifecycleTargets.size, errors, `${owner}.bindings must not claim partial or extra platform coverage.`);
  }
  const witnesses = bindings
    .map((entry) => ({
      target: entry.target,
      status: entry.status,
      implementation_commit: entry.implementation_commit,
      tested_commit: entry.tested_commit,
      workflow_run_id: entry.workflow_run_id,
      platform: entry.platform,
      architecture: entry.architecture,
      package_sha256: entry.package_sha256,
      binary_sha256: entry.binary_sha256,
      runtime_sha256: entry.runtime_sha256,
      errors: entry.errors
    }))
    .sort((left, right) => String(left.target).localeCompare(String(right.target)));
  requireValue(binding.binding_digest === sha256Text(JSON.stringify(witnesses)), errors, `${owner}.binding_digest must match bindings.`);

  for (const sectionId of ['artifact_lifecycle', 'golden_journey_fixture', 'soak_test']) {
    const section = evidence.sections?.[sectionId];
    if (section?.status === 'satisfied' && usesDownloadedArtifactBinding(section)) {
      for (const field of ['schema_version', 'evidence_id', 'status', 'release_blocking', 'target_count', 'satisfied_target_count', 'binding_digest']) {
        requireValue(section.evidence_binding?.[field] === binding[field], errors,
          `sections.${sectionId}.evidence_binding.${field} must match ${owner}.`);
      }
    }
  }

  const summary = evidence.sections?.executable_evidence_validation?.release_evidence_binding;
  requireValue(summary && typeof summary === 'object', errors, 'sections.executable_evidence_validation.release_evidence_binding must be present when runtime evidence is satisfied.');
  if (summary && typeof summary === 'object') {
    for (const field of ['schema_version', 'evidence_id', 'status', 'release_blocking', 'target_count', 'satisfied_target_count', 'binding_digest']) {
      requireValue(summary[field] === binding[field], errors, `sections.executable_evidence_validation.release_evidence_binding.${field} must match ${owner}.`);
    }
  }
}

export function validateRuntimeOperationalEvidence(evidence, options = {}) {
  const errors = [];
  // Keep the pure validator portable: a caller validating an isolated fixture
  // must not inherit this checkout's deployment identity. Repository binding is
  // applied by the repository-aware guard below.
  const expectedRepository = options.repository ?? options.deploymentResult?.deployment?.repository ?? evidence.repository;
  validateNoForbiddenLocalEvidence(evidence, errors);
  requireValue(evidence.schema_version === 1, errors, 'runtime operational evidence schema_version must be 1.');
  requireValue(evidence.evidence_id === 'brownie-runtime-operational-evidence-v1', errors, 'runtime operational evidence_id must match.');
  requireValue(evidence.repository === expectedRepository, errors, 'runtime operational evidence repository must match the configured deployment repository.');
  requireValue(evidence.release_ready === false, errors, 'runtime operational evidence must not declare release_ready true.');
  requireValue(evidence.runtime_release_ready === false, errors, 'runtime operational evidence must not declare runtime_release_ready true.');
  requireValue(Array.isArray(evidence.fail_closed_reasons), errors, 'runtime operational evidence must include fail_closed_reasons.');
  if (Object.hasOwn(evidence, 'fail_closed')) {
    requireValue(evidence.fail_closed === true, errors, 'runtime operational evidence fail_closed must be true.');
  }

  requireValue(Array.isArray(evidence.required_sections), errors, 'runtime operational evidence required_sections must be an array.');
  const requiredSectionEntries = Array.isArray(evidence.required_sections) ? evidence.required_sections : [];
  const required = new Set(requiredSectionEntries);
  const knownRequired = new Set(requiredSections);
  for (const sectionId of requiredSectionEntries) {
    requireValue(knownRequired.has(sectionId), errors, `runtime operational evidence required_sections contains unknown section ${sectionId}.`);
  }
  for (const sectionId of requiredSections) {
    requireValue(required.has(sectionId), errors, `runtime operational evidence required_sections must include ${sectionId}.`);
    const section = evidence.sections?.[sectionId];
    requireValue(section && typeof section === 'object', errors, `runtime operational evidence sections.${sectionId} must be present.`);
    if (!section || typeof section !== 'object') {
      continue;
    }
    requireValue(isNonEmptyString(section.status), errors, `sections.${sectionId}.status must be non-empty.`);
    requireValue(
      section.release_blocking === true,
      errors,
      `sections.${sectionId} must be release_blocking.`
    );
    if (Object.hasOwn(section, 'fail_closed')) {
      requireValue(section.fail_closed === true, errors, `sections.${sectionId}.fail_closed must be true.`);
    }
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
      if (usesDownloadedArtifactBinding(evidence.sections.artifact_lifecycle)) {
        requireValue(result.evidence_source === downloadedArtifactBindingSource, errors, `sections.artifact_lifecycle.lifecycle_results[${index}] must identify downloaded-artifact evidence.`);
        requireValue(isSafeRelativePath(result.journey_evidence_path), errors, `sections.artifact_lifecycle.lifecycle_results[${index}].journey_evidence_path must be repository-relative and bounded.`);
        requireValue(isSafeRelativePath(result.soak_evidence_path), errors, `sections.artifact_lifecycle.lifecycle_results[${index}].soak_evidence_path must be repository-relative and bounded.`);
        continue;
      }
      requireValue(result.passed === true, errors, `sections.artifact_lifecycle.lifecycle_results[${index}] must pass when artifact_lifecycle is satisfied.`);
      requireValue(result.status === 'satisfied', errors, `sections.artifact_lifecycle.lifecycle_results[${index}].status must be satisfied.`);
      requireValue(result.uninstalled === true, errors, `sections.artifact_lifecycle.lifecycle_results[${index}].uninstalled must be true.`);
      requireValue(result.checksum_verified === true, errors, `sections.artifact_lifecycle.lifecycle_results[${index}].checksum_verified must be true.`);
      validateSatisfiedCommands(result.commands, errors, `sections.artifact_lifecycle.lifecycle_results[${index}].commands`);
    }
  }
  if (evidence.sections?.artifact_lifecycle?.status === 'satisfied' && usesDownloadedArtifactBinding(evidence.sections.artifact_lifecycle)) {
    validateDownloadedArtifactBindingSummary(evidence.sections.artifact_lifecycle, errors, 'sections.artifact_lifecycle');
  }

  for (const [index, command] of (Array.isArray(evidence.sections?.golden_journey_fixture?.commands) ? evidence.sections.golden_journey_fixture.commands : []).entries()) {
    validateCommand(command, errors, `sections.golden_journey_fixture.commands[${index}]`);
  }
  if (evidence.sections?.golden_journey_fixture?.status === 'satisfied') {
    if (usesDownloadedArtifactBinding(evidence.sections.golden_journey_fixture)) {
      validateDownloadedArtifactBindingSummary(evidence.sections.golden_journey_fixture, errors, 'sections.golden_journey_fixture');
    } else {
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
  }

  const soak = evidence.sections?.soak_test;
  if (soak && typeof soak === 'object') {
    if (Array.isArray(soak.step_ids)) {
      validateRequiredStatefulSoakStepIds(soak.step_ids, errors, 'sections.soak_test.step_ids');
    }
    requireValue(Number.isInteger(soak.iterations_requested), errors, 'sections.soak_test.iterations_requested must be an integer.');
    requireValue(Number.isInteger(soak.iterations_completed), errors, 'sections.soak_test.iterations_completed must be an integer.');
    requireValue(Number.isInteger(soak.failure_count), errors, 'sections.soak_test.failure_count must be an integer.');
    requireValue(typeof soak.failure_rate === 'number', errors, 'sections.soak_test.failure_rate must be a number.');
    if (soak.status === 'satisfied') {
      requireValue(Number.isSafeInteger(soak.iterations_requested) && soak.iterations_requested > 0,
        errors, 'satisfied soak_test must request a positive safe integer of iterations.');
      requireValue(soak.iterations_completed === soak.iterations_requested, errors, 'satisfied soak_test must complete all requested iterations.');
      requireValue(soak.failure_count === 0, errors, 'satisfied soak_test must have zero failures.');
      requireValue(soak.failure_rate === 0, errors, 'satisfied soak_test must have a zero failure rate.');
      requireValue(soak.duplicate_side_effects_observed === false, errors, 'satisfied soak_test must not observe duplicate side effects.');
      requireValue(soak.unrecoverable_run_count === 0, errors, 'satisfied soak_test must have zero unrecoverable runs.');
      if (usesDownloadedArtifactBinding(soak)) {
        validateDownloadedArtifactBindingSummary(soak, errors, 'sections.soak_test');
      } else {
        validateSatisfiedCommands(soak.commands, errors, 'sections.soak_test.commands');
      }
      validateSatisfiedStatefulSoakSteps(soak.stateful_steps, errors);
    }
  }
  if (requiredSections.some((sectionId) => evidence.sections?.[sectionId]?.status === 'satisfied')) {
    validateReleaseEvidenceBinding(evidence, errors, options);
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
  if (options?.schema_version === 1 && options?.evidence_id === 'brownie-runtime-operational-evidence-v1') {
    const { repoRoot, validateBoundEvidence: _ignored, workflowRunId, testedCommit, ...evidence } = options;
    const errors = validateRuntimeOperationalEvidence(evidence, {
      repoRoot: repoRoot ?? defaultRepoRoot,
      validateBoundEvidence: true,
      workflowRunId,
      testedCommit
    });
    return {
      errors,
      valid: errors.length === 0,
      fail_closed: options.fail_closed === true || Array.isArray(options.fail_closed_reasons),
      contractPath: null,
      evidencePath: '<direct>',
      validatedEvidence: true
    };
  }
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
    const deploymentResult = loadPhaseLoopActorDeployment({ repoRoot });
    errors.push(...validateRuntimeOperationalEvidence(evidence, {
      repoRoot,
      deploymentResult,
      validateBoundEvidence: true
    }));
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
