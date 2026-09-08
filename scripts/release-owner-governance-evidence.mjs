import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultOutPath = '.brownie/release-evidence/owner-governance-evidence.json';
const defaultIndependentReviewPath = 'docs/architecture/owner-independent-review-evidence.json';
const defaultOssDecisionPath = 'docs/architecture/owner-oss-publication-decision.json';
const defaultIntegrityDecisionPath = 'docs/architecture/owner-integrity-authority-decision.json';

const requiredSections = [
  'branch_protection',
  'required_status_checks',
  'protected_tag_policy',
  'remote_ci_workflow_provenance',
  'signature_or_integrity_authority',
  'independent_reviews',
  'oss_license_publish_posture'
];

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function parseArgs(argv) {
  const options = {
    repoRoot: defaultRepoRoot,
    outPath: defaultOutPath
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--repo-root') {
      options.repoRoot = path.resolve(argv[++index] ?? '');
    } else if (arg === '--out') {
      options.outPath = argv[++index] ?? '';
    } else {
      throw new Error(`Unknown owner governance evidence argument: ${arg}`);
    }
  }
  return options;
}

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join('/').replace(/^\.\//, '');
}

function resolveRepoRelative(repoRoot, relativePath) {
  const resolved = path.resolve(repoRoot, relativePath);
  const relative = path.relative(repoRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes repository root: ${relativePath}`);
  }
  return resolved;
}

function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function run(repoRoot, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 30_000,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    passed: result.status === 0
  };
}

function gitValue(repoRoot, args) {
  const result = run(repoRoot, 'git', args);
  return result.passed ? result.stdout.trim() : null;
}

function commandAvailable(command) {
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  return result.status === 0;
}

function parseRemoteRepository(remoteUrl) {
  if (!remoteUrl) {
    return null;
  }
  const sshMatch = remoteUrl.match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }
  try {
    const url = new URL(remoteUrl);
    if (url.hostname !== 'github.com') {
      return null;
    }
    const parts = url.pathname.replace(/^\/|\.git$/g, '').split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  } catch {
    return null;
  }
}

function readJsonIfExists(repoRoot, relativePath) {
  const fullPath = resolveRepoRelative(repoRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch {
    return { malformed: true };
  }
}

function ownerFileEvidence(repoRoot, relativePath) {
  const fullPath = resolveRepoRelative(repoRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    return { path: relativePath, exists: false, sha256: null };
  }
  return { path: relativePath, exists: true, sha256: sha256File(fullPath) };
}

function ghApiJson(repoRoot, repository, endpoint) {
  if (!commandAvailable('gh')) {
    return { available: false, authorized: false, status: 'gh_unavailable', json: null };
  }
  const auth = run(repoRoot, 'gh', ['auth', 'status', '-h', 'github.com']);
  if (!auth.passed) {
    return { available: true, authorized: false, status: 'gh_auth_unavailable', json: null };
  }
  const response = run(repoRoot, 'gh', ['api', endpoint], { timeoutMs: 30_000 });
  if (!response.passed) {
    return { available: true, authorized: true, status: 'github_api_unavailable', json: null };
  }
  try {
    return { available: true, authorized: true, status: 'satisfied', json: JSON.parse(response.stdout) };
  } catch {
    return { available: true, authorized: true, status: 'github_api_malformed_json', json: null };
  }
}

function buildBranchProtectionSection(repoRoot, repository) {
  const api = repository ? ghApiJson(repoRoot, repository, `repos/${repository}/branches/main/protection`) : null;
  if (!repository) {
    return { status: 'repository_unknown', release_blocking: true, checked_via: 'git remote origin' };
  }
  if (!api || api.status !== 'satisfied') {
    return {
      status: api?.status ?? 'github_api_unavailable',
      release_blocking: true,
      checked_via: 'gh api branches/main/protection',
      github_cli_available: api?.available ?? false,
      github_cli_authorized: api?.authorized ?? false
    };
  }
  const protection = api.json;
  const requiresReviews = Boolean(protection.required_pull_request_reviews);
  const enforceAdmins = protection.enforce_admins?.enabled === true;
  return {
    status: requiresReviews ? 'satisfied' : 'missing_required_pull_request_reviews',
    release_blocking: true,
    checked_via: 'gh api branches/main/protection',
    required_pull_request_reviews_present: requiresReviews,
    enforce_admins_enabled: enforceAdmins
  };
}

function buildRequiredStatusChecksSection(repoRoot, repository) {
  const api = repository ? ghApiJson(repoRoot, repository, `repos/${repository}/branches/main/protection`) : null;
  if (!repository) {
    return { status: 'repository_unknown', release_blocking: true, checked_via: 'git remote origin' };
  }
  if (!api || api.status !== 'satisfied') {
    return {
      status: api?.status ?? 'github_api_unavailable',
      release_blocking: true,
      checked_via: 'gh api branches/main/protection',
      github_cli_available: api?.available ?? false,
      github_cli_authorized: api?.authorized ?? false
    };
  }
  const checks = api.json.required_status_checks;
  const contexts = Array.isArray(checks?.contexts) ? checks.contexts : [];
  const appChecks = Array.isArray(checks?.checks) ? checks.checks : [];
  return {
    status: contexts.length + appChecks.length > 0 ? 'satisfied' : 'missing_required_status_checks',
    release_blocking: true,
    checked_via: 'gh api branches/main/protection',
    strict: checks?.strict === true,
    required_context_count: contexts.length,
    required_app_check_count: appChecks.length
  };
}

function rulesetTargetsTags(ruleset) {
  if (ruleset?.target === 'tag') {
    return true;
  }
  const includes = ruleset?.conditions?.ref_name?.include;
  return Array.isArray(includes) && includes.some((entry) => typeof entry === 'string' && entry.includes('refs/tags/'));
}

function buildProtectedTagPolicySection(repoRoot, repository) {
  const api = repository ? ghApiJson(repoRoot, repository, `repos/${repository}/rulesets`) : null;
  if (!repository) {
    return { status: 'repository_unknown', release_blocking: true, checked_via: 'git remote origin' };
  }
  if (!api || api.status !== 'satisfied') {
    return {
      status: api?.status ?? 'github_api_unavailable',
      release_blocking: true,
      checked_via: 'gh api repos/rulesets',
      github_cli_available: api?.available ?? false,
      github_cli_authorized: api?.authorized ?? false
    };
  }
  const rulesets = Array.isArray(api.json) ? api.json : [];
  const tagRulesetCount = rulesets.filter(rulesetTargetsTags).length;
  return {
    status: tagRulesetCount > 0 ? 'satisfied' : 'not_detected',
    release_blocking: true,
    checked_via: 'gh api repos/rulesets',
    protected_tag_ruleset_count: tagRulesetCount
  };
}

function buildRemoteCiWorkflowProvenanceSection(repoRoot, repository, env = process.env) {
  const hasCi = env.GITHUB_ACTIONS === 'true' && Boolean(env.GITHUB_RUN_ID) && Boolean(env.GITHUB_SHA) && Boolean(env.GITHUB_REPOSITORY);
  if (!hasCi && repository) {
    const workflowRuns = ghApiJson(repoRoot, repository, `repos/${repository}/actions/workflows/ci.yml/runs?branch=main&per_page=1`);
    if (workflowRuns.status !== 'satisfied') {
      return {
        status: workflowRuns.status,
        release_blocking: true,
        provider: 'github_actions',
        checked_via: 'gh api actions/workflows/ci.yml/runs',
        workflow_run_id_present: false,
        workflow_sha_present: false,
        workflow_repository_present: true,
        github_cli_available: workflowRuns.available,
        github_cli_authorized: workflowRuns.authorized
      };
    }
    const latestRun = Array.isArray(workflowRuns.json?.workflow_runs) ? workflowRuns.json.workflow_runs[0] : null;
    if (!latestRun?.id || !latestRun?.head_sha) {
      return {
        status: 'remote_ci_run_not_found',
        release_blocking: true,
        provider: 'github_actions',
        checked_via: 'gh api actions/workflows/ci.yml/runs',
        workflow_run_id_present: false,
        workflow_sha_present: false,
        workflow_repository_present: true
      };
    }
    const checkRuns = ghApiJson(repoRoot, repository, `repos/${repository}/commits/${latestRun.head_sha}/check-runs`);
    if (checkRuns.status !== 'satisfied') {
      return {
        status: checkRuns.status,
        release_blocking: true,
        provider: 'github_actions',
        checked_via: 'gh api commits/{head_sha}/check-runs',
        workflow_run_id_present: true,
        workflow_sha_present: true,
        workflow_repository_present: true,
        workflow_run_id: String(latestRun.id),
        workflow_head_sha: latestRun.head_sha
      };
    }
    const requiredCheckNames = ['check', 'index-platform'];
    const successfulChecks = new Set(
      (Array.isArray(checkRuns.json?.check_runs) ? checkRuns.json.check_runs : [])
        .filter((entry) => entry?.status === 'completed' && entry?.conclusion === 'success')
        .map((entry) => entry.name)
    );
    const missing = requiredCheckNames.filter((name) => !successfulChecks.has(name));
    return {
      status: latestRun.conclusion === 'success' && missing.length === 0 ? 'satisfied' : 'remote_ci_checks_missing_or_failed',
      release_blocking: true,
      provider: 'github_actions',
      checked_via: 'gh api actions/workflows/ci.yml/runs + commits/{head_sha}/check-runs',
      workflow_run_id_present: true,
      workflow_sha_present: true,
      workflow_repository_present: true,
      workflow_run_id: String(latestRun.id),
      workflow_head_sha: latestRun.head_sha,
      workflow_conclusion: latestRun.conclusion ?? null,
      required_check_names: requiredCheckNames,
      successful_required_check_count: requiredCheckNames.length - missing.length,
      missing_or_failed_required_check_names: missing
    };
  }
  return {
    status: hasCi ? 'satisfied' : 'local_missing_remote_ci_provenance',
    release_blocking: true,
    provider: hasCi ? 'github_actions' : null,
    workflow_run_id_present: Boolean(env.GITHUB_RUN_ID),
    workflow_sha_present: Boolean(env.GITHUB_SHA),
    workflow_repository_present: Boolean(env.GITHUB_REPOSITORY)
  };
}

function buildIntegrityAuthoritySection(repoRoot) {
  const ownerDecision = readJsonIfExists(repoRoot, defaultIntegrityDecisionPath);
  const ownerEvidence = ownerFileEvidence(repoRoot, defaultIntegrityDecisionPath);
  const localVerification = ownerFileEvidence(repoRoot, '.brownie/release-evidence/integrity-verification.json');
  const approved = ownerDecision?.decision_status === 'approved' && ownerDecision?.owner_approved === true;
  return {
    status: approved ? 'satisfied' : 'owner_decision_waiting',
    release_blocking: true,
    owner_decision: ownerEvidence,
    local_integrity_verification: localVerification,
    local_checksum_verification_available: localVerification.exists,
    note: 'Runtime can verify checksum integrity locally, but owner must approve the release signing or formal integrity authority before Release Ready.'
  };
}

function buildIndependentReviewsSection(repoRoot) {
  const review = readJsonIfExists(repoRoot, defaultIndependentReviewPath);
  const evidence = ownerFileEvidence(repoRoot, defaultIndependentReviewPath);
  const requiredReviewIds = [
    'release_workflow',
    'permission_model',
    'ledger_contract',
    'mode_pack_trust_boundary',
    'signing_provenance',
    'release_ready_judgment'
  ];
  const reviews = Array.isArray(review?.reviews) ? review.reviews : [];
  const approvedIds = new Set(
    reviews
      .filter((entry) => entry?.status === 'approved' && entry?.self_approval !== true && typeof entry?.reviewer === 'string' && entry.reviewer.trim())
      .map((entry) => entry.id)
  );
  const missing = requiredReviewIds.filter((id) => !approvedIds.has(id));
  return {
    status: evidence.exists && missing.length === 0 ? 'satisfied' : 'not_completed',
    release_blocking: true,
    owner_evidence: evidence,
    required_review_ids: requiredReviewIds,
    approved_review_count: approvedIds.size,
    missing_review_ids: missing
  };
}

function buildOssLicensePublishPostureSection(repoRoot) {
  const decision = readJsonIfExists(repoRoot, defaultOssDecisionPath);
  const ownerEvidence = ownerFileEvidence(repoRoot, defaultOssDecisionPath);
  const licenseExists = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'].some((relativePath) =>
    fs.existsSync(resolveRepoRelative(repoRoot, relativePath))
  );
  const approved = decision?.decision_status === 'approved' && decision?.owner_approved === true;
  return {
    status: approved && licenseExists ? 'satisfied' : 'owner_decision_waiting',
    release_blocking: true,
    owner_decision: ownerEvidence,
    license_file_present: licenseExists,
    note: 'License and publish posture are owner decisions; Runtime automation only records whether the decision evidence exists.'
  };
}

function writeJson(repoRoot, relativePath, value) {
  const fullPath = resolveRepoRelative(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`);
}

export function buildOwnerGovernanceEvidence(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const remoteUrl = gitValue(repoRoot, ['config', '--get', 'remote.origin.url']);
  const repository = parseRemoteRepository(remoteUrl) ?? 'globalpocket/brownie';
  const sections = {
    branch_protection: buildBranchProtectionSection(repoRoot, repository),
    required_status_checks: buildRequiredStatusChecksSection(repoRoot, repository),
    protected_tag_policy: buildProtectedTagPolicySection(repoRoot, repository),
    remote_ci_workflow_provenance: buildRemoteCiWorkflowProvenanceSection(repoRoot, repository, options.env ?? process.env),
    signature_or_integrity_authority: buildIntegrityAuthoritySection(repoRoot),
    independent_reviews: buildIndependentReviewsSection(repoRoot),
    oss_license_publish_posture: buildOssLicensePublishPostureSection(repoRoot)
  };
  const failClosedReasons = requiredSections
    .filter((sectionId) => sections[sectionId]?.status !== 'satisfied')
    .map((sectionId) => `${sectionId}:${sections[sectionId]?.status ?? 'missing'}`);

  return {
    schema_version: 1,
    evidence_id: 'brownie-owner-governance-evidence-v1',
    generated_at: generatedAt,
    repository,
    source_commit: gitValue(repoRoot, ['rev-parse', 'HEAD']),
    release_ready: false,
    runtime_release_ready: false,
    required_sections: requiredSections,
    sections,
    fail_closed_reasons: failClosedReasons
  };
}

export function writeOwnerGovernanceEvidence(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const outPath = normalizeRelativePath(options.outPath ?? defaultOutPath);
  const evidence = buildOwnerGovernanceEvidence({ ...options, repoRoot });
  writeJson(repoRoot, outPath, evidence);
  return { evidence, outPath };
}

if (isMainModule()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = writeOwnerGovernanceEvidence(options);
    process.stdout.write(`${JSON.stringify({ path: result.outPath, release_ready: result.evidence.release_ready, fail_closed_reasons: result.evidence.fail_closed_reasons }, null, 2)}\n`);
  } catch (error) {
    console.error(`Owner governance evidence generation failed: ${error.message}`);
    process.exit(1);
  }
}
