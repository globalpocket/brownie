import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPhaseLoopActorDeployment } from './phase-loop-actor-deployment.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultContractPath = 'docs/architecture/runtime-release-contract.json';
const defaultEvidencePath = '.brownie/release-evidence/supply-chain-artifact-evidence.json';

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

const hashPattern = /^sha256:[a-f0-9]{64}$/;
const sourceCommitHashPattern = /^sha256:[a-f0-9]{40}$/;
const gitCommitPattern = /^[a-f0-9]{40}$/;
const workflowRunPattern = /^[1-9][0-9]*$/u;
const requiredArtifactSmokeE2eStepIds = [
  'base_mode_pack_load',
  'minimal_task_run',
  'ledger_generation',
  'forced_stop_resume',
  'stale_replay_rejection'
];
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

function isArtifactSmokeStepId(stepId) {
  return requiredArtifactSmokeE2eStepIds.includes(stepId);
}

function sha256Text(text) {
  return `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`;
}

function validateArtifactProvenanceBinding(artifact, errors, pathLabel) {
  const binding = artifact?.provenance_binding;
  requireValue(binding && typeof binding === 'object', errors, `${pathLabel}.provenance_binding must be present.`);
  if (!binding || typeof binding !== 'object') {
    return;
  }
  requireValue(gitCommitPattern.test(binding.implementationCommit), errors, `${pathLabel}.provenance_binding.implementationCommit must be a 40-character git SHA.`);
  requireValue(gitCommitPattern.test(binding.testedCommit), errors, `${pathLabel}.provenance_binding.testedCommit must be a 40-character git SHA.`);
  requireValue(typeof binding.workflowRunId === 'string' && workflowRunPattern.test(binding.workflowRunId), errors, `${pathLabel}.provenance_binding.workflowRunId must be a canonical positive integer string.`);
  requireValue(binding.artifactSha256 === artifact.sha256, errors, `${pathLabel}.provenance_binding.artifactSha256 must match artifact sha256.`);
  requireValue(isNonEmptyString(binding.platform), errors, `${pathLabel}.provenance_binding.platform must be present.`);
  requireValue(isNonEmptyString(binding.architecture), errors, `${pathLabel}.provenance_binding.architecture must be present.`);
  requireValue(binding.sourceCheckoutState === 'clean', errors, `${pathLabel}.provenance_binding.sourceCheckoutState must be clean.`);
  requireValue(binding.buildSourceCommit === artifact.source_commit, errors, `${pathLabel}.provenance_binding.buildSourceCommit must match artifact source_commit.`);
  requireValue(binding.buildSourceCleanTree === artifact.source_clean_tree, errors, `${pathLabel}.provenance_binding.buildSourceCleanTree must match artifact source_clean_tree.`);
  requireValue(binding.buildSourceIdentity === artifact.source_identity, errors, `${pathLabel}.provenance_binding.buildSourceIdentity must match artifact source_identity.`);
  const artifactSourceSha = sourceCommitHashPattern.test(artifact.source_commit)
    ? artifact.source_commit.slice('sha256:'.length)
    : null;
  requireValue(
    artifactSourceSha !== null && binding.implementationCommit === artifactSourceSha,
    errors,
    `${pathLabel}.provenance_binding.implementationCommit must match artifact source_commit.`
  );
  requireValue(
    artifactSourceSha !== null && binding.testedCommit === artifactSourceSha,
    errors,
    `${pathLabel}.provenance_binding.testedCommit must match artifact source_commit.`
  );

  const validation = binding.validation;
  requireValue(validation?.valid === true, errors, `${pathLabel}.provenance_binding.validation.valid must be true.`);
  const buildValidation = binding.buildSourceMetadataValidation;
  requireValue(buildValidation?.valid === true, errors, `${pathLabel}.provenance_binding.buildSourceMetadataValidation.valid must be true.`);

  const expectedSourceIdentity = sha256Text(`${artifact.source_commit}:${artifact.source_clean_tree}`);
  requireValue(artifact.source_identity === expectedSourceIdentity, errors, `${pathLabel}.source_identity must match source commit/tree metadata.`);

  const expectedProvenanceIdentity = sha256Text(
    [
      binding.implementationCommit,
      binding.testedCommit,
      binding.workflowRunId,
      artifact.path,
      binding.artifactSha256,
      binding.platform,
      binding.architecture
    ].join('\n')
  );
  requireValue(artifact.provenance_identity === expectedProvenanceIdentity, errors, `${pathLabel}.provenance_identity must match provenance binding.`);
}
const allowedIncompleteStatuses = new Set([
  'blocked_external',
  'failed',
  'missing_lockfile',
  'not_executed',
  'not_executed_missing_artifacts',
  'partial_cross_platform_missing',
  'partial_source_identity_missing',
  'not_generated',
  'partial_no_release_artifacts',
  'partial_tooling_missing'
]);

function isArtifactSourceIdentityBound(evidence) {
  if (!evidence || typeof evidence !== 'object') return false;
  const { provenance, source_identity, artifacts, e2e_steps } = evidence;
  if (!provenance || !source_identity || !artifacts) return false;
  if (provenance.source === 'repository_local') return false;
  if (source_identity.dirty_tree === true) return false;
  if (source_identity.provenance_chain === undefined) return false;
  if (!Array.isArray(artifacts) || artifacts.length === 0) return false;
  if (!Array.isArray(e2e_steps)) return false;
  if (!e2e_steps.includes('artifact_integrity_verification')) return false;
  return artifacts.every((a) => {
    if (!hashPattern.test(a.source_commit)) return false;
    if (a.source_clean_tree !== 'clean') return false;
    if (!hashPattern.test(a.source_identity)) return false;
    return true;
  });
  return artifacts.every((artifact) => artifact.checksum && artifact.provenance_ref !== undefined);
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
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

function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function validateReferencedFile(repoRoot, entry, errors, owner) {
  requireValue(isSafeRelativePath(entry?.path), errors, `${owner}.path must be repository-relative and bounded.`);
  requireValue(hashPattern.test(entry?.sha256), errors, `${owner}.sha256 must be sha256:<64 lowercase hex>.`);
  if (!isSafeRelativePath(entry?.path)) {
    return;
  }
  const fullPath = path.join(repoRoot, entry.path);
  const regular = isBoundedRegularFile(repoRoot, entry.path);
  requireValue(regular, errors, `${owner}.path must exist as a regular file within the repository: ${entry.path}.`);
  if (regular && hashPattern.test(entry.sha256)) {
    requireValue(sha256File(fullPath) === entry.sha256, errors, `${owner}.sha256 must match ${entry.path}.`);
  }
}

function isBoundedRegularFile(repoRoot, relativePath) {
  if (!isSafeRelativePath(relativePath)) return false;
  try {
    const file = path.join(repoRoot, relativePath);
    const relative = path.relative(fs.realpathSync(repoRoot), fs.realpathSync(file));
    return fs.lstatSync(file).isFile() && relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  } catch { return false; }
}

function validateOptionalPath(repoRoot, value, errors, owner) {
  if (value === null || value === undefined) {
    return;
  }
  requireValue(isSafeRelativePath(value), errors, `${owner} must be repository-relative and bounded.`);
  if (isSafeRelativePath(value)) {
    requireValue(fs.existsSync(path.join(repoRoot, value)), errors, `${owner} must exist: ${value}.`);
  }
}

function readBoundEvidence(repoRoot, relativePath, errors, owner) {
  requireValue(isSafeRelativePath(relativePath), errors, `${owner} must be repository-relative and bounded.`);
  if (!isSafeRelativePath(relativePath)) {
    return null;
  }
  const fullPath = path.join(repoRoot, relativePath);
  requireValue(isBoundedRegularFile(repoRoot, relativePath), errors, `${owner} must exist as a regular file within the repository: ${relativePath}.`);
  if (!isBoundedRegularFile(repoRoot, relativePath)) {
    return null;
  }
  try {
    const evidence = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    requireValue(
      evidence !== null && typeof evidence === 'object' && !Array.isArray(evidence),
      errors,
      `${owner} must contain a JSON object.`
    );
    return evidence !== null && typeof evidence === 'object' && !Array.isArray(evidence) ? evidence : null;
  } catch (error) {
    errors.push(`${owner} must be readable JSON: ${error.message}`);
    return null;
  }
}

function validateDownloadedPhysicalEvidence(repoRoot, artifact, binding, errors, owner) {
  const coordinates = {
    'darwin-arm64': ['darwin', 'arm64'], 'linux-x64': ['linux', 'x64'],
    'linux-arm64': ['linux', 'arm64'], 'win32-x64': ['win32', 'x64']
  }[binding.target];
  requireValue(coordinates && binding.platform === coordinates[0] && binding.architecture === coordinates[1],
    errors, `${owner}.platform and architecture must match the supported target.`);
  const directory = `.brownie/release-evidence/artifacts/${binding.target}`;
  requireValue(artifact.artifact_evidence_path === `${directory}/artifact-evidence.json`, errors,
    `${owner}.artifact_evidence_path must identify downloaded target metadata.`);
  const metadata = readBoundEvidence(repoRoot, artifact.artifact_evidence_path, errors, `${owner}.artifact_evidence_path`);
  if (!metadata) return;
  requireValue(metadata.target === binding.target && metadata.platform === binding.platform && metadata.arch === binding.architecture,
    errors, `${owner}.artifact metadata target/platform/architecture must match the binding.`);
  const binary = metadata.artifact;
  requireValue(typeof artifact.path === 'string' && binary?.path === artifact.path && artifact.path.startsWith(`${directory}/`) &&
    binary?.sha256 === binding.binary_sha256 && binary?.source_commit === binding.implementation_commit &&
    binary?.source_clean_tree === artifact.source_clean_tree && binary?.source_identity === artifact.source_identity,
  errors, `${owner}.binary metadata must match downloaded artifact identity and source.`);
  validateReferencedFile(repoRoot, binary, errors, `${owner}.binary`);
  const archive = metadata.archive ?? {
    path: `${directory}/brownie-${binding.target}.${binding.target === 'win32-x64' ? 'zip' : 'tar.gz'}`,
    sha256: binding.package_sha256
  };
  requireValue(typeof archive?.path === 'string' && archive.path.startsWith(`${directory}/`), errors,
    `${owner}.package path must remain in the downloaded target directory.`);
  requireValue(archive?.sha256 === binding.package_sha256, errors, `${owner}.package sha256 must match declared archive metadata.`);
  validateReferencedFile(repoRoot, archive, errors, `${owner}.package`);
  requireValue(metadata.runtime_companion?.sha256 === binding.runtime_sha256, errors,
    `${owner}.runtime_companion sha256 must match downloaded binding.`);
  requireValue(typeof metadata.runtime_companion?.path === 'string' && metadata.runtime_companion.path.startsWith(`${directory}/`), errors,
    `${owner}.runtime_companion path must remain in the downloaded target directory.`);
  validateReferencedFile(repoRoot, metadata.runtime_companion, errors, `${owner}.runtime_companion`);
}

function requirePassedChecks(evidence, checkIds, errors, owner) {
  for (const checkId of checkIds) {
    requireValue(evidence?.checks?.[checkId]?.passed === true, errors, `${owner}.checks.${checkId}.passed must be true.`);
  }
}

function validateDownloadedRoundtripEvidence(repoRoot, binding, errors, owner) {
  const journey = readBoundEvidence(repoRoot, binding.journey_evidence_path, errors, `${owner}.journey_evidence_path`);
  const soak = readBoundEvidence(repoRoot, binding.soak_evidence_path, errors, `${owner}.soak_evidence_path`);
  const expectedArtifact = {
    archive_sha256: binding.package_sha256,
    artifact_sha256: binding.binary_sha256,
    runtime_sha256: binding.runtime_sha256
  };

  for (const [kind, evidence, evidenceId, checks] of [
    ['journey', journey, 'brownie-release-artifact-runtime-journey-v1', requiredDownloadedJourneyChecks],
    ['soak', soak, 'brownie-release-artifact-stateful-soak-v1', requiredDownloadedSoakChecks]
  ]) {
    if (!evidence) continue;
    const evidenceOwner = `${owner}.${kind}`;
    requireValue(evidence.evidence_id === evidenceId, errors, `${evidenceOwner}.evidence_id must identify downloaded artifact evidence.`);
    requireValue(evidence.target === binding.target, errors, `${evidenceOwner}.target must match downloaded_roundtrip_binding target.`);
    requireValue(evidence.workflow_run_id === binding.workflow_run_id, errors, `${evidenceOwner}.workflow_run_id must match downloaded_roundtrip_binding.`);
    for (const [field, expected] of Object.entries(expectedArtifact)) {
      const bindingField = field === 'archive_sha256' ? 'package_sha256' : field;
      requireValue(evidence.artifact?.[field] === expected, errors, `${evidenceOwner}.artifact.${field} must match downloaded_roundtrip_binding.${bindingField}.`);
    }
    requirePassedChecks(evidence, checks, errors, evidenceOwner);
  }

  requireValue(
    soak?.checks?.artifact_execution_boundary?.packaged_cli_only === true &&
      soak?.checks?.artifact_execution_boundary?.isolated_workspace_cwd === true &&
      soak?.checks?.artifact_execution_boundary?.runtime_path_override_removed === true,
    errors,
    `${owner}.soak must prove downloaded packaged execution, not build-tree execution.`
  );
}

function validateReleaseEvidenceRoundtripBinding(repoRoot, artifacts, errors, expected) {
  const owner = 'sections.artifacts.release_evidence_binding';
  const binding = artifacts.release_evidence_binding;
  requireValue(binding && typeof binding === 'object', errors, `${owner} must be present when artifacts are satisfied.`);
  if (!binding || typeof binding !== 'object') return;

  requireValue(binding.schema_version === 1, errors, `${owner}.schema_version must be 1.`);
  requireValue(binding.evidence_id === 'brownie-release-evidence-roundtrip-binding-v1', errors, `${owner}.evidence_id must match.`);
  requireValue(binding.status === 'satisfied', errors, `${owner}.status must be satisfied.`);
  requireValue(binding.release_blocking === true, errors, `${owner}.release_blocking must be true.`);
  const bindings = Array.isArray(binding.bindings) ? binding.bindings : [];
  requireValue(bindings.length === artifacts.artifacts.length, errors, `${owner}.bindings must cover every artifact exactly once.`);
  requireValue(binding.target_count === bindings.length, errors, `${owner}.target_count must match bindings.`);
  requireValue(binding.satisfied_target_count === bindings.length, errors, `${owner}.satisfied_target_count must match bindings.`);
  requireValue(Array.isArray(binding.missing) && binding.missing.length === 0, errors, `${owner}.missing must be empty.`);

  const artifactsByTarget = new Map();
  for (const artifact of artifacts.artifacts) {
    if (isNonEmptyString(artifact?.target)) artifactsByTarget.set(artifact.target, artifact);
  }
  const seenTargets = new Set();
  for (const [index, entry] of bindings.entries()) {
    const entryOwner = `${owner}.bindings[${index}]`;
    const artifact = artifactsByTarget.get(entry?.target);
    requireValue(isNonEmptyString(entry?.target) && artifact !== undefined && !seenTargets.has(entry.target), errors, `${entryOwner}.target must identify one artifact.`);
    if (!artifact || seenTargets.has(entry?.target)) continue;
    seenTargets.add(entry.target);
    const sourceCommit = typeof artifact.source_commit === 'string' ? artifact.source_commit.slice('sha256:'.length) : null;
    requireValue(entry.status === 'satisfied', errors, `${entryOwner}.status must be satisfied.`);
    requireValue(entry.implementation_commit === artifact.source_commit, errors, `${entryOwner}.implementation_commit must match artifact source_commit.`);
    requireValue(entry.tested_commit === sourceCommit, errors, `${entryOwner}.tested_commit must match artifact source_commit.`);
    requireValue(entry.workflow_run_id === artifact.provenance_binding?.workflowRunId, errors, `${entryOwner}.workflow_run_id must match artifact provenance.`);
    requireValue(typeof entry.workflow_run_id === 'string' && workflowRunPattern.test(entry.workflow_run_id), errors,
      `${entryOwner}.workflow_run_id must be a canonical positive integer string.`);
    requireValue(entry.workflow_run_id === expected.workflowRunId, errors,
      `${entryOwner}.workflow_run_id must match the current verification workflow.`);
    requireValue(entry.tested_commit === expected.testedCommit, errors,
      `${entryOwner}.tested_commit must match the current verification commit.`);
    requireValue(entry.platform === artifact.provenance_binding?.platform, errors, `${entryOwner}.platform must match artifact provenance.`);
    requireValue(entry.architecture === artifact.provenance_binding?.architecture, errors, `${entryOwner}.architecture must match artifact provenance.`);
    requireValue(hashPattern.test(entry.package_sha256), errors, `${entryOwner}.package_sha256 must be sha256:<64 lowercase hex>.`);
    requireValue(entry.binary_sha256 === artifact.sha256, errors, `${entryOwner}.binary_sha256 must match artifact sha256.`);
    requireValue(hashPattern.test(entry.runtime_sha256), errors, `${entryOwner}.runtime_sha256 must be sha256:<64 lowercase hex>.`);
    requireValue(Array.isArray(entry.errors) && entry.errors.length === 0, errors, `${entryOwner}.errors must be empty.`);
    validateDownloadedPhysicalEvidence(repoRoot, artifact, entry, errors, entryOwner);
    validateDownloadedRoundtripEvidence(repoRoot, entry, errors, entryOwner);
  }
  requireValue(seenTargets.size === artifactsByTarget.size, errors, `${owner}.bindings must cover every artifact target.`);
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
}

function validateEvidence(evidence, options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const errors = [];
  const deploymentResult = options.deploymentResult ?? loadPhaseLoopActorDeployment({ repoRoot });
  const expectedRepository = options.repository ?? deploymentResult.deployment?.repository ?? evidence.repository;

  requireValue(evidence.schema_version === 1, errors, 'supply-chain evidence schema_version must be 1.');
  requireValue(evidence.evidence_id === 'brownie-supply-chain-artifact-evidence-v1', errors, 'supply-chain evidence_id must match.');
  requireValue(evidence.phase === 'RRP-8.4', errors, 'supply-chain evidence phase must be RRP-8.4.');
  requireValue(evidence.repository === expectedRepository, errors, 'supply-chain evidence repository must match the configured deployment repository.');
  requireValue(evidence.release_ready === false, errors, 'supply-chain evidence must not declare release_ready true.');
  requireValue(evidence.runtime_release_ready === false, errors, 'supply-chain evidence must not declare runtime_release_ready true.');
  requireValue(Array.isArray(evidence.fail_closed_reasons), errors, 'supply-chain evidence must include fail_closed_reasons.');
  const failClosedReasons = Array.isArray(evidence.fail_closed_reasons) ? evidence.fail_closed_reasons : [];
  requireValue(
    ['clean', 'dirty', 'unknown'].includes(evidence.sourceCheckoutState),
    errors,
    'supply-chain evidence sourceCheckoutState must be clean, dirty, or unknown.'
  );
  if (evidence.sourceCheckoutState !== 'clean') {
    requireValue(
      failClosedReasons.some((reason) => reason === `source_checkout_state:${evidence.sourceCheckoutState}` || reason === 'source_tree_dirty:true'),
      errors,
      'supply-chain evidence fail_closed_reasons must include source checkout state when checkout is not clean.'
    );
  }

  const sectionIds = new Set(Array.isArray(evidence.required_sections) ? evidence.required_sections : []);
  for (const sectionId of requiredSections) {
    requireValue(sectionIds.has(sectionId), errors, `supply-chain evidence required_sections must include ${sectionId}.`);
    const section = evidence.sections?.[sectionId];
    requireValue(section && typeof section === 'object', errors, `supply-chain evidence sections.${sectionId} must be present.`);
    if (!section || typeof section !== 'object') {
      continue;
    }
    requireValue(isNonEmptyString(section.status), errors, `supply-chain evidence sections.${sectionId}.status must be non-empty.`);
    requireValue(section.release_blocking === true, errors, `supply-chain evidence sections.${sectionId} must be release_blocking.`);
    if (section.status !== 'satisfied') {
      requireValue(
        allowedIncompleteStatuses.has(section.status),
        errors,
        `supply-chain evidence sections.${sectionId}.status ${section.status} is not an allowed fail-closed status.`
      );
      requireValue(
        failClosedReasons.some((reason) => reason.startsWith(`${sectionId}:`)),
        errors,
        `supply-chain evidence fail_closed_reasons must include ${sectionId}.`
      );
    }
  }

  for (const sectionId of ['sbom', 'checksums', 'provenance']) {
    const section = evidence.sections?.[sectionId];
    if (section?.status === 'satisfied') {
      validateReferencedFile(repoRoot, section, errors, `sections.${sectionId}`);
    }
  }

  const checksumEntries = evidence.sections?.checksums?.entries;
  if (Array.isArray(checksumEntries)) {
    for (const [index, checksumEntry] of checksumEntries.entries()) {
      validateReferencedFile(repoRoot, checksumEntry, errors, `sections.checksums.entries[${index}]`);
    }
  }

  const artifacts = evidence.sections?.artifacts;
  if (artifacts?.status === 'satisfied') {
    const expected = {
      workflowRunId: options.workflowRunId ?? process.env.GITHUB_RUN_ID,
      testedCommit: options.testedCommit ?? process.env.GITHUB_SHA
    };
    requireValue(typeof expected.workflowRunId === 'string' && workflowRunPattern.test(expected.workflowRunId), errors,
      'satisfied artifacts require the current verification workflowRunId.');
    requireValue(typeof expected.testedCommit === 'string' && gitCommitPattern.test(expected.testedCommit), errors,
      'satisfied artifacts require the current verification testedCommit.');
    requireValue(Array.isArray(artifacts.artifacts) && artifacts.artifacts.length > 0, errors, 'satisfied artifacts section must include artifacts.');
    for (const [index, artifact] of artifacts.artifacts.entries()) {
      validateReferencedFile(repoRoot, artifact, errors, `sections.artifacts.artifacts[${index}]`);
      validateOptionalPath(repoRoot, artifact.artifact_evidence_path, errors, `sections.artifacts.artifacts[${index}].artifact_evidence_path`);
      validateOptionalPath(repoRoot, artifact.smoke_evidence_path, errors, `sections.artifacts.artifacts[${index}].smoke_evidence_path`);
      requireValue(sourceCommitHashPattern.test(artifact.source_commit), errors, `sections.artifacts.artifacts[${index}].source_commit must be sha256:<40 lowercase git commit hex>.`);
      requireValue(artifact.source_clean_tree === 'clean', errors, `sections.artifacts.artifacts[${index}].source_clean_tree must be clean.`);
      requireValue(hashPattern.test(artifact.source_identity), errors, `sections.artifacts.artifacts[${index}].source_identity must be sha256:<64 lowercase hex>.`);
      validateArtifactProvenanceBinding(artifact, errors, `sections.artifacts.artifacts[${index}]`);
    }
    validateReleaseEvidenceRoundtripBinding(repoRoot, artifacts, errors, expected);
  }

  const artifactSmoke = evidence.sections?.artifact_smoke;
  if (artifactSmoke?.status === 'satisfied') {
    const smokeResults = Array.isArray(artifactSmoke.smoke_results) ? artifactSmoke.smoke_results : [];
    requireValue(
      smokeResults.length > 0,
      errors,
      'sections.artifact_smoke.smoke_results must be a non-empty array.'
    );
    for (const [index, smokeResult] of smokeResults.entries()) {
      if (!smokeResult.e2e_steps || !Array.isArray(smokeResult.e2e_steps)) {
        errors.push(`sections.artifact_smoke.smoke_results[${index}] missing required e2e_steps array.`);
        continue;
      }
      for (const requiredStepId of requiredArtifactSmokeE2eStepIds) {
        if (!smokeResult.e2e_steps.includes(requiredStepId)) {
          errors.push(`sections.artifact_smoke.smoke_results[${index}] missing required E2E step ${requiredStepId}.`);
        }
      }
    }
    requireValue(
      smokeResults.length > 0,
      errors,
      'satisfied artifact_smoke must include smoke_results.'
    );
    for (const [index, smokeResult] of smokeResults.entries()) {
      requireValue(smokeResult?.passed === true, errors, `sections.artifact_smoke.smoke_results[${index}] must pass.`);
      requireValue(Array.isArray(smokeResult?.commands) && smokeResult.commands.length > 0, errors, `sections.artifact_smoke.smoke_results[${index}] must include commands.`);
      const e2eSteps = new Set(Array.isArray(smokeResult?.e2e_steps) ? smokeResult.e2e_steps : []);
      for (const stepId of requiredArtifactSmokeE2eStepIds) {
        requireValue(
          e2eSteps.has(stepId),
          errors,
          `sections.artifact_smoke.smoke_results[${index}] missing required E2E step ${stepId}.`
        );
      }
      for (const [commandIndex, command] of (Array.isArray(smokeResult?.commands) ? smokeResult.commands : []).entries()) {
        requireValue(command?.passed === true, errors, `sections.artifact_smoke.smoke_results[${index}].commands[${commandIndex}] must pass.`);
        requireValue(Number.isInteger(command?.exit_code), errors, `sections.artifact_smoke.smoke_results[${index}].commands[${commandIndex}].exit_code must be an integer.`);
      }
    }
  }

  const dependencySecurityLicenseScan = evidence.sections?.dependency_security_license_scan;
  if (dependencySecurityLicenseScan?.status === 'satisfied') {
    requireValue(
      Array.isArray(dependencySecurityLicenseScan.tools) && dependencySecurityLicenseScan.tools.length > 0,
      errors,
      'satisfied dependency_security_license_scan.tools must be a non-empty array.'
    );
    for (const [index, tool] of (Array.isArray(dependencySecurityLicenseScan.tools) ? dependencySecurityLicenseScan.tools : []).entries()) {
      requireValue(
        isNonEmptyString(tool?.id) || isNonEmptyString(tool?.name),
        errors,
        `sections.dependency_security_license_scan.tools[${index}] must include a non-empty id or name.`
      );
      requireValue(tool?.available === true, errors, `sections.dependency_security_license_scan.tools[${index}].available must be true.`);
      requireValue(tool?.passed === true, errors, `sections.dependency_security_license_scan.tools[${index}].passed must be true.`);
      if (tool?.exit_code !== null && tool?.exit_code !== undefined) {
        requireValue(Number.isInteger(tool.exit_code), errors, `sections.dependency_security_license_scan.tools[${index}].exit_code must be an integer when present.`);
        requireValue(tool.exit_code === 0, errors, `sections.dependency_security_license_scan.tools[${index}].exit_code must be 0.`);
      }
    }
  }

  const lockfiles = evidence.sections?.lockfile_fixed?.lockfiles;
  requireValue(Array.isArray(lockfiles) && lockfiles.length > 0, errors, 'lockfile_fixed must list lockfiles.');
  for (const [index, lockfile] of (Array.isArray(lockfiles) ? lockfiles : []).entries()) {
    validateReferencedFile(repoRoot, lockfile, errors, `sections.lockfile_fixed.lockfiles[${index}]`);
  }

  requireValue(evidence.sections?.secret_scan?.findings_count === 0, errors, 'secret_scan must have zero findings before release evidence can pass.');

  return errors;
}

export function validateSupplyChainArtifactContract(contract, options = {}) {
  const contractPath = options.contractPath ?? defaultContractPath;
  const errors = [];

  requireValue(contract.runtime_release_ready === false, errors, `${contractPath} must keep runtime_release_ready false.`);
  requireValue(contract.phase === 'RRP-8.7', errors, `${contractPath} phase must be RRP-8.7.`);
  requireValue(contract.release_engineering_maturity?.current_percent < contract.release_engineering_maturity?.target_percent, errors, `${contractPath} must not claim target release maturity before full evidence exists.`);

  const localGateCommands = new Set(
    (Array.isArray(contract.local_release_gate?.commands) ? contract.local_release_gate.commands : []).map((entry) => entry?.command)
  );
  for (const command of [
    'pnpm --workspace-root release:dependency-security-license-audit',
    'pnpm --workspace-root guard:dependency-security-license-audit',
    'pnpm --workspace-root guard:dependency-security-license-audit:test',
    'pnpm --workspace-root release:supply-chain-artifact-evidence',
    'pnpm --workspace-root guard:supply-chain-artifact-evidence',
    'pnpm --workspace-root guard:supply-chain-artifact-evidence:test'
  ]) {
    requireValue(localGateCommands.has(command), errors, `${contractPath} local_release_gate.commands must include ${command}.`);
  }

  const evidence = contract.supply_chain_artifact_evidence ?? {};
  requireValue(evidence.contract_id === 'brownie-supply-chain-artifact-evidence-v1', errors, `${contractPath} supply_chain_artifact_evidence.contract_id must match.`);
  requireValue(evidence.default_path === defaultEvidencePath, errors, `${contractPath} supply_chain_artifact_evidence.default_path must be ${defaultEvidencePath}.`);
  for (const sectionId of requiredSections) {
    requireValue(
      Array.isArray(evidence.required_sections) && evidence.required_sections.includes(sectionId),
      errors,
      `${contractPath} supply_chain_artifact_evidence.required_sections must include ${sectionId}.`
    );
  }

  return errors;
}

export function runSupplyChainArtifactEvidenceGuard(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    options = {};
  }
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const contractPath = options.contractPath ?? defaultContractPath;
  const evidencePath =
    options.evidencePath ??
    process.env.BROWNIE_SUPPLY_CHAIN_ARTIFACT_EVIDENCE ??
    defaultEvidencePath;
  const errors = [];
  const contract = options.contract ?? readJson(repoRoot, contractPath, errors);
  errors.push(...validateSupplyChainArtifactContract(contract, { contractPath }));

  const resolvedEvidencePath = normalizeRelativePath(evidencePath);
  const shouldValidateEvidence =
    options.evidence !== undefined || process.env.BROWNIE_SUPPLY_CHAIN_ARTIFACT_EVIDENCE || fs.existsSync(path.join(repoRoot, resolvedEvidencePath));
  if (shouldValidateEvidence) {
    const evidence = options.evidence ?? readJson(repoRoot, resolvedEvidencePath, errors);
    errors.push(...validateEvidence(evidence, {
      repoRoot,
      repository: options.repository,
      deploymentResult: options.deploymentResult,
      workflowRunId: options.workflowRunId,
      testedCommit: options.testedCommit
    }));
  }

  return { errors, contractPath, evidencePath: resolvedEvidencePath, validatedEvidence: shouldValidateEvidence };
}

if (isMainModule()) {
  const result = runSupplyChainArtifactEvidenceGuard();
  if (result.errors.length > 0) {
    console.error('Supply-chain/artifact evidence guard failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log(
    `Supply-chain/artifact evidence guard passed for ${result.contractPath}` +
      (result.validatedEvidence ? ` and ${result.evidencePath}.` : ' in contract-only mode.')
  );
}
