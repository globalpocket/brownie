import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
const allowedIncompleteStatuses = new Set([
  'blocked_external',
  'failed',
  'missing_lockfile',
  'not_executed',
  'not_executed_missing_artifacts',
  'not_generated',
  'partial_no_release_artifacts',
  'partial_tooling_missing'
]);

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
  requireValue(isSafeRelativePath(entry.path), errors, `${owner}.path must be repository-relative and bounded.`);
  requireValue(hashPattern.test(entry.sha256), errors, `${owner}.sha256 must be sha256:<64 lowercase hex>.`);
  if (!isSafeRelativePath(entry.path)) {
    return;
  }
  const fullPath = path.join(repoRoot, entry.path);
  requireValue(fs.existsSync(fullPath), errors, `${owner}.path must exist: ${entry.path}.`);
  if (fs.existsSync(fullPath) && hashPattern.test(entry.sha256)) {
    requireValue(sha256File(fullPath) === entry.sha256, errors, `${owner}.sha256 must match ${entry.path}.`);
  }
}

function validateEvidence(evidence, options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const errors = [];

  requireValue(evidence.schema_version === 1, errors, 'supply-chain evidence schema_version must be 1.');
  requireValue(evidence.evidence_id === 'brownie-supply-chain-artifact-evidence-v1', errors, 'supply-chain evidence_id must match.');
  requireValue(evidence.phase === 'RRP-8.4', errors, 'supply-chain evidence phase must be RRP-8.4.');
  requireValue(evidence.repository === 'globalpocket/brownie', errors, 'supply-chain evidence repository must be globalpocket/brownie.');
  requireValue(evidence.release_ready === false, errors, 'supply-chain evidence must not declare release_ready true.');
  requireValue(evidence.runtime_release_ready === false, errors, 'supply-chain evidence must not declare runtime_release_ready true.');
  requireValue(Array.isArray(evidence.fail_closed_reasons), errors, 'supply-chain evidence must include fail_closed_reasons.');

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
        evidence.fail_closed_reasons.some((reason) => reason.startsWith(`${sectionId}:`)),
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
    requireValue(Array.isArray(artifacts.artifacts) && artifacts.artifacts.length > 0, errors, 'satisfied artifacts section must include artifacts.');
    for (const [index, artifact] of artifacts.artifacts.entries()) {
      validateReferencedFile(repoRoot, artifact, errors, `sections.artifacts.artifacts[${index}]`);
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
  requireValue(contract.phase === 'RRP-8.4', errors, `${contractPath} phase must be RRP-8.4.`);
  requireValue(contract.release_engineering_maturity?.current_percent < contract.release_engineering_maturity?.target_percent, errors, `${contractPath} must not claim target release maturity before full evidence exists.`);

  const localGateCommands = new Set(
    (Array.isArray(contract.local_release_gate?.commands) ? contract.local_release_gate.commands : []).map((entry) => entry?.command)
  );
  for (const command of [
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
    errors.push(...validateEvidence(evidence, { repoRoot }));
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
