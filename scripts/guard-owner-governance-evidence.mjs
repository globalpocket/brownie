import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultContractPath = 'docs/architecture/runtime-release-contract.json';
const defaultEvidencePath = '.brownie/release-evidence/owner-governance-evidence.json';

const requiredSections = [
  'branch_protection',
  'required_status_checks',
  'protected_tag_policy',
  'remote_ci_workflow_provenance',
  'signature_or_integrity_authority',
  'independent_reviews',
  'oss_license_publish_posture'
];

const canonicalRequiredReviewIds = [
  'release_workflow',
  'permission_model',
  'ledger_contract',
  'mode_pack_trust_boundary',
  'signing_provenance',
  'release_ready_judgment'
];

const allowedIncompleteStatuses = new Set([
  'gh_auth_unavailable',
  'gh_unavailable',
  'github_api_malformed_json',
  'github_api_unavailable',
  'local_missing_remote_ci_provenance',
  'missing_required_pull_request_reviews',
  'missing_required_status_checks',
  'not_completed',
  'not_detected',
  'owner_decision_waiting',
  'remote_ci_checks_missing_or_failed',
  'remote_ci_run_not_found',
  'repository_unknown'
]);

const hashPattern = /^sha256:[a-f0-9]{64}$/;
const gitCommitPattern = /^[a-f0-9]{40}$/;

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

function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function currentGitHead(repoRoot) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 30_000
  });
  return result.status === 0 ? result.stdout.trim() : null;
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

function validateOwnerFile(repoRoot, fileEvidence, errors, owner) {
  requireValue(fileEvidence && typeof fileEvidence === 'object', errors, `${owner} must be an object.`);
  if (!fileEvidence || typeof fileEvidence !== 'object') {
    return;
  }
  requireValue(isSafeRelativePath(fileEvidence.path), errors, `${owner}.path must be repository-relative.`);
  requireValue(typeof fileEvidence.exists === 'boolean', errors, `${owner}.exists must be boolean.`);
  requireValue(fileEvidence.sha256 === null || hashPattern.test(fileEvidence.sha256), errors, `${owner}.sha256 must be null or sha256:<64 lowercase hex>.`);
  if (fileEvidence.exists === true && isSafeRelativePath(fileEvidence.path)) {
    const fullPath = path.join(repoRoot, fileEvidence.path);
    requireValue(fs.existsSync(fullPath), errors, `${owner}.path must exist when exists=true.`);
    if (fs.existsSync(fullPath) && hashPattern.test(fileEvidence.sha256)) {
      requireValue(sha256File(fullPath) === fileEvidence.sha256, errors, `${owner}.sha256 must match ${fileEvidence.path}.`);
    }
  }
}

function validateGithubReviewProvenance(entry, errors, owner) {
  requireValue(entry && typeof entry === 'object' && !Array.isArray(entry), errors, `${owner} must be an object.`);
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return;
  }
  requireValue(isNonEmptyString(entry.required_review_id), errors, `${owner}.required_review_id must be non-empty.`);
  requireValue(Number.isInteger(entry.pull_request_number) && entry.pull_request_number > 0, errors, `${owner}.pull_request_number must be a positive integer.`);
  requireValue(isNonEmptyString(entry.review_id), errors, `${owner}.review_id must be non-empty.`);
  requireValue(entry.state === 'APPROVED', errors, `${owner}.state must be APPROVED.`);
  requireValue(entry.reviewer === 'globalpocket', errors, `${owner}.reviewer must be globalpocket.`);
  requireValue(entry.pull_request_author === 'brownie-agent', errors, `${owner}.pull_request_author must be brownie-agent.`);
  requireValue(entry.reviewer !== entry.pull_request_author, errors, `${owner}.reviewer must differ from pull_request_author.`);
  requireValue(gitCommitPattern.test(entry.commit_sha), errors, `${owner}.commit_sha must be a 40-character lowercase git commit SHA.`);
  requireValue(isNonEmptyString(entry.submitted_at), errors, `${owner}.submitted_at must be non-empty.`);
}

function validateEvidence(evidence, options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const expectedSourceCommit = options.expectedSourceCommit;
  const errors = [];
  requireValue(evidence.schema_version === 1, errors, 'owner governance evidence schema_version must be 1.');
  requireValue(evidence.evidence_id === 'brownie-owner-governance-evidence-v1', errors, 'owner governance evidence_id must match.');
  requireValue(evidence.repository === 'globalpocket/brownie', errors, 'owner governance evidence repository must be globalpocket/brownie.');
  requireValue(gitCommitPattern.test(evidence.source_commit), errors, 'owner governance evidence source_commit must be a 40-character lowercase git commit SHA.');
  if (expectedSourceCommit) {
    requireValue(evidence.source_commit === expectedSourceCommit, errors, `owner governance evidence source_commit must match current HEAD ${expectedSourceCommit}.`);
  }
  requireValue(evidence.release_ready === false, errors, 'owner governance evidence must not declare release_ready true.');
  requireValue(evidence.runtime_release_ready === false, errors, 'owner governance evidence must not declare runtime_release_ready true.');
  requireValue(Array.isArray(evidence.fail_closed_reasons), errors, 'owner governance evidence must include fail_closed_reasons.');

  const required = new Set(Array.isArray(evidence.required_sections) ? evidence.required_sections : []);
  for (const sectionId of requiredSections) {
    requireValue(required.has(sectionId), errors, `owner governance evidence required_sections must include ${sectionId}.`);
    const section = evidence.sections?.[sectionId];
    requireValue(section && typeof section === 'object', errors, `owner governance evidence sections.${sectionId} must be present.`);
    if (!section || typeof section !== 'object') {
      continue;
    }
    requireValue(isNonEmptyString(section.status), errors, `owner governance evidence sections.${sectionId}.status must be non-empty.`);
    requireValue(section.release_blocking === true, errors, `owner governance evidence sections.${sectionId} must be release_blocking.`);
    if (section.status !== 'satisfied') {
      requireValue(
        allowedIncompleteStatuses.has(section.status),
        errors,
        `owner governance evidence sections.${sectionId}.status ${section.status} is not an allowed fail-closed status.`
      );
      requireValue(
        evidence.fail_closed_reasons.some((reason) => reason.startsWith(`${sectionId}:`)),
        errors,
        `owner governance evidence fail_closed_reasons must include ${sectionId}.`
      );
    }
  }

  const integrity = evidence.sections?.signature_or_integrity_authority;
  if (integrity) {
    validateOwnerFile(repoRoot, integrity.owner_decision, errors, 'sections.signature_or_integrity_authority.owner_decision');
    validateOwnerFile(repoRoot, integrity.local_integrity_verification, errors, 'sections.signature_or_integrity_authority.local_integrity_verification');
    if (integrity.status === 'satisfied') {
      requireValue(
        integrity.owner_decision?.exists === true,
        errors,
        'satisfied signature_or_integrity_authority must have an existing owner_decision.'
      );
      requireValue(
        integrity.local_integrity_verification?.exists === true,
        errors,
        'satisfied signature_or_integrity_authority must have existing local_integrity_verification.'
      );
      requireValue(
        integrity.local_checksum_verification_available === true,
        errors,
        'satisfied signature_or_integrity_authority must have local_checksum_verification_available=true.'
      );
    }
  }

  const protectedTags = evidence.sections?.protected_tag_policy;
  if (protectedTags?.status === 'satisfied') {
    requireValue(
      Number.isInteger(protectedTags.protected_tag_ruleset_count) && protectedTags.protected_tag_ruleset_count > 0,
      errors,
      'satisfied protected_tag_policy must have protected_tag_ruleset_count > 0.'
    );
  }

  const reviews = evidence.sections?.independent_reviews;
  if (reviews) {
    validateOwnerFile(repoRoot, reviews.owner_evidence, errors, 'sections.independent_reviews.owner_evidence');
    requireValue(Array.isArray(reviews.required_review_ids) && reviews.required_review_ids.length > 0, errors, 'independent_reviews.required_review_ids must be non-empty.');
    requireValue(
      JSON.stringify(reviews.required_review_ids) === JSON.stringify(canonicalRequiredReviewIds),
      errors,
      `independent_reviews.required_review_ids must exactly match the canonical owner review IDs: ${canonicalRequiredReviewIds.join(', ')}.`
    );
    requireValue(Array.isArray(reviews.missing_review_ids), errors, 'independent_reviews.missing_review_ids must be an array.');
    requireValue(Array.isArray(reviews.github_review_provenance), errors, 'independent_reviews.github_review_provenance must be an array.');
    const provenanceIds = new Set();
    for (const [index, entry] of (Array.isArray(reviews.github_review_provenance) ? reviews.github_review_provenance : []).entries()) {
      validateGithubReviewProvenance(entry, errors, `independent_reviews.github_review_provenance[${index}]`);
      requireValue(
        canonicalRequiredReviewIds.includes(entry?.required_review_id),
        errors,
        `independent_reviews.github_review_provenance[${index}].required_review_id must be one of the canonical owner review IDs.`
      );
      if (isNonEmptyString(entry?.required_review_id)) {
        provenanceIds.add(entry.required_review_id);
      }
    }
    if (reviews.status === 'satisfied') {
      requireValue(reviews.missing_review_ids.length === 0, errors, 'satisfied independent_reviews must have no missing_review_ids.');
      for (const reviewId of reviews.required_review_ids) {
        requireValue(provenanceIds.has(reviewId), errors, `satisfied independent_reviews must include GitHub review provenance for ${reviewId}.`);
      }
      requireValue(reviews.approved_review_count === reviews.required_review_ids.length, errors, 'satisfied independent_reviews approved_review_count must equal required_review_ids length.');
    }
  }

  const oss = evidence.sections?.oss_license_publish_posture;
  if (oss) {
    validateOwnerFile(repoRoot, oss.owner_decision, errors, 'sections.oss_license_publish_posture.owner_decision');
    requireValue(typeof oss.license_file_present === 'boolean', errors, 'oss_license_publish_posture.license_file_present must be boolean.');
  }

  return errors;
}

export function validateOwnerGovernanceContract(contract, options = {}) {
  const contractPath = options.contractPath ?? defaultContractPath;
  const errors = [];
  requireValue(contract.runtime_release_ready === false, errors, `${contractPath} must keep runtime_release_ready false.`);
  requireValue(contract.phase === 'RRP-8.7', errors, `${contractPath} phase must be RRP-8.7.`);

  const localGateCommands = new Set(
    (Array.isArray(contract.local_release_gate?.commands) ? contract.local_release_gate.commands : []).map((entry) => entry?.command)
  );
  for (const command of [
    'pnpm --workspace-root release:integrity-verify',
    'pnpm --workspace-root release:owner-governance-evidence',
    'pnpm --workspace-root guard:owner-governance-evidence',
    'pnpm --workspace-root guard:owner-governance-evidence:test'
  ]) {
    requireValue(localGateCommands.has(command), errors, `${contractPath} local_release_gate.commands must include ${command}.`);
  }

  const evidenceContract = contract.owner_governance_evidence ?? {};
  requireValue(evidenceContract.contract_id === 'brownie-owner-governance-evidence-v1', errors, `${contractPath} owner_governance_evidence.contract_id must match.`);
  requireValue(evidenceContract.default_path === defaultEvidencePath, errors, `${contractPath} owner_governance_evidence.default_path must be ${defaultEvidencePath}.`);
  for (const sectionId of requiredSections) {
    requireValue(
      Array.isArray(evidenceContract.required_sections) && evidenceContract.required_sections.includes(sectionId),
      errors,
      `${contractPath} owner_governance_evidence.required_sections must include ${sectionId}.`
    );
  }
  return errors;
}

export function runOwnerGovernanceEvidenceGuard(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const contractPath = options.contractPath ?? defaultContractPath;
  const evidencePath =
    options.evidencePath ??
    process.env.BROWNIE_OWNER_GOVERNANCE_EVIDENCE ??
    defaultEvidencePath;
  const errors = [];
  const contract = options.contract ?? readJson(repoRoot, contractPath, errors);
  errors.push(...validateOwnerGovernanceContract(contract, { contractPath }));

  const resolvedEvidencePath = normalizeRelativePath(evidencePath);
  const shouldValidateEvidence =
    options.evidence !== undefined || process.env.BROWNIE_OWNER_GOVERNANCE_EVIDENCE || fs.existsSync(path.join(repoRoot, resolvedEvidencePath));
  if (shouldValidateEvidence) {
    const evidence = options.evidence ?? readJson(repoRoot, resolvedEvidencePath, errors);
    const expectedSourceCommit = options.expectedSourceCommit ?? (options.evidence === undefined ? currentGitHead(repoRoot) : undefined);
    errors.push(...validateEvidence(evidence, { repoRoot, expectedSourceCommit }));
  }
  return { errors, contractPath, evidencePath: resolvedEvidencePath, validatedEvidence: shouldValidateEvidence };
}

if (isMainModule()) {
  const result = runOwnerGovernanceEvidenceGuard();
  if (result.errors.length > 0) {
    console.error('Owner governance evidence guard failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  process.stdout.write(
    `${JSON.stringify({ contract: result.contractPath, evidence: result.evidencePath, validated_evidence: result.validatedEvidence, status: 'passed' }, null, 2)}\n`
  );
}
