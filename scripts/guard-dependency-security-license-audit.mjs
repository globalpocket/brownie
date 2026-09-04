import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { requiredReleaseGateCommands } from './release-gate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultContractPath = 'docs/architecture/runtime-release-contract.json';
const defaultPackagePath = 'package.json';
const defaultEvidencePath = '.brownie/release-evidence/dependency-security-license-audit.json';

const requiredCheckIds = ['cargo_audit_locked', 'cargo_deny_policy', 'pnpm_audit_prod'];
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const allowedIncompleteStatuses = new Set(['tool_unavailable', 'failed', 'timed_out']);

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function readJson(repoRoot, relativePath, errors) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
  } catch (error) {
    errors.push(`${relativePath} must be readable JSON: ${error.message}`);
    return {};
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireValue(condition, errors, message) {
  if (!condition) {
    errors.push(message);
  }
}

function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function validateRelativeFile(repoRoot, entry, errors, owner) {
  requireValue(isNonEmptyString(entry?.path), errors, `${owner}.path must be non-empty.`);
  requireValue(!path.isAbsolute(entry?.path ?? ''), errors, `${owner}.path must be repository-relative.`);
  requireValue(!String(entry?.path ?? '').split(/[\\/]/).includes('..'), errors, `${owner}.path must not escape the repository.`);
  requireValue(hashPattern.test(entry?.sha256 ?? ''), errors, `${owner}.sha256 must be sha256:<64 lowercase hex>.`);
  if (isNonEmptyString(entry?.path) && !path.isAbsolute(entry.path) && hashPattern.test(entry?.sha256 ?? '')) {
    const fullPath = path.join(repoRoot, entry.path);
    requireValue(fs.existsSync(fullPath), errors, `${owner}.path must exist: ${entry.path}.`);
    if (fs.existsSync(fullPath)) {
      requireValue(sha256File(fullPath) === entry.sha256, errors, `${owner}.sha256 must match ${entry.path}.`);
    }
  }
}

export function validateDependencySecurityLicenseAuditContract(contract, packageJson, options = {}) {
  const contractPath = options.contractPath ?? defaultContractPath;
  const errors = [];
  const gateCommands = new Set(
    (Array.isArray(contract.local_release_gate?.commands) ? contract.local_release_gate.commands : []).map((entry) => entry?.command)
  );
  const releaseGateCommandStrings = new Set(
    requiredReleaseGateCommands.map((entry) => [entry.command, ...entry.args].join(' '))
  );

  for (const command of [
    'pnpm --workspace-root release:dependency-security-license-audit',
    'pnpm --workspace-root guard:dependency-security-license-audit',
    'pnpm --workspace-root guard:dependency-security-license-audit:test'
  ]) {
    requireValue(gateCommands.has(command), errors, `${contractPath} local_release_gate.commands must include ${command}.`);
    requireValue(releaseGateCommandStrings.has(command), errors, `scripts/release-gate.mjs must include ${command}.`);
  }

  requireValue(
    packageJson.scripts?.['release:dependency-security-license-audit'] ===
      'node scripts/release-dependency-security-license-audit.mjs',
    errors,
    `${defaultPackagePath} must define release:dependency-security-license-audit.`
  );
  requireValue(
    packageJson.scripts?.['guard:dependency-security-license-audit'] ===
      'node scripts/guard-dependency-security-license-audit.mjs',
    errors,
    `${defaultPackagePath} must define guard:dependency-security-license-audit.`
  );
  requireValue(
    packageJson.scripts?.['guard:dependency-security-license-audit:test'] ===
      'node --test scripts/guard-dependency-security-license-audit.test.mjs',
    errors,
    `${defaultPackagePath} must define guard:dependency-security-license-audit:test.`
  );

  const contractBlock = contract.dependency_security_license_audit ?? {};
  requireValue(
    contractBlock.contract_id === 'brownie-dependency-security-license-audit-v1',
    errors,
    `${contractPath} dependency_security_license_audit.contract_id must match.`
  );
  requireValue(
    contractBlock.default_path === defaultEvidencePath,
    errors,
    `${contractPath} dependency_security_license_audit.default_path must be ${defaultEvidencePath}.`
  );
  requireValue(
    Array.isArray(contractBlock.required_checks) &&
      requiredCheckIds.every((id) => contractBlock.required_checks.includes(id)),
    errors,
    `${contractPath} dependency_security_license_audit.required_checks must include every mandatory audit.`
  );

  return errors;
}

export function validateDependencySecurityLicenseAuditEvidence(evidence, options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const errors = [];
  requireValue(evidence.schema_version === 1, errors, 'dependency audit evidence schema_version must be 1.');
  requireValue(evidence.evidence_id === 'brownie-dependency-security-license-audit-v1', errors, 'dependency audit evidence_id must match.');
  requireValue(evidence.phase === 'RRP-8.5', errors, 'dependency audit evidence phase must be RRP-8.5.');
  requireValue(evidence.repository === 'globalpocket/brownie', errors, 'dependency audit evidence repository must be globalpocket/brownie.');
  requireValue(evidence.release_ready === false, errors, 'dependency audit evidence must not declare release_ready true.');
  requireValue(evidence.runtime_release_ready === false, errors, 'dependency audit evidence must not declare runtime_release_ready true.');
  requireValue(Array.isArray(evidence.fail_closed_reasons), errors, 'dependency audit evidence must include fail_closed_reasons.');
  requireValue(
    Array.isArray(evidence.required_checks) && requiredCheckIds.every((id) => evidence.required_checks.includes(id)),
    errors,
    'dependency audit evidence required_checks must include every mandatory audit.'
  );

  const checks = new Map((Array.isArray(evidence.checks) ? evidence.checks : []).map((entry) => [entry?.id, entry]));
  for (const id of requiredCheckIds) {
    const check = checks.get(id);
    requireValue(Boolean(check), errors, `dependency audit evidence checks must include ${id}.`);
    if (!check) {
      continue;
    }
    requireValue(check.release_blocking === true, errors, `${id} must be release_blocking.`);
    requireValue(isNonEmptyString(check.command), errors, `${id}.command must be non-empty.`);
    requireValue(
      check.status === 'satisfied' || allowedIncompleteStatuses.has(check.status),
      errors,
      `${id}.status ${check.status} is not an allowed status.`
    );
    if (check.status !== 'satisfied') {
      requireValue(
        evidence.fail_closed_reasons.some((reason) => reason.startsWith(`${id}:`)),
        errors,
        `fail_closed_reasons must include ${id}.`
      );
    }
  }

  for (const [index, lockfile] of (Array.isArray(evidence.lockfiles) ? evidence.lockfiles : []).entries()) {
    if (lockfile.present) {
      validateRelativeFile(repoRoot, lockfile, errors, `lockfiles[${index}]`);
    }
  }
  if (evidence.policy?.cargo_deny_config?.present) {
    validateRelativeFile(repoRoot, evidence.policy.cargo_deny_config, errors, 'policy.cargo_deny_config');
  }

  return errors;
}

export function runDependencySecurityLicenseAuditGuard(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const contractPath = options.contractPath ?? defaultContractPath;
  const evidencePath =
    options.evidencePath ??
    process.env.BROWNIE_DEPENDENCY_SECURITY_LICENSE_AUDIT ??
    defaultEvidencePath;
  const errors = [];
  const contract = options.contract ?? readJson(repoRoot, contractPath, errors);
  const packageJson = options.packageJson ?? readJson(repoRoot, defaultPackagePath, errors);
  errors.push(...validateDependencySecurityLicenseAuditContract(contract, packageJson, { contractPath }));

  const shouldValidateEvidence =
    options.evidence !== undefined ||
    process.env.BROWNIE_DEPENDENCY_SECURITY_LICENSE_AUDIT ||
    fs.existsSync(path.join(repoRoot, evidencePath));
  if (shouldValidateEvidence) {
    const evidence = options.evidence ?? readJson(repoRoot, evidencePath, errors);
    errors.push(...validateDependencySecurityLicenseAuditEvidence(evidence, { repoRoot }));
  }

  return { errors, contractPath, evidencePath, validatedEvidence: shouldValidateEvidence };
}

if (isMainModule()) {
  const result = runDependencySecurityLicenseAuditGuard();
  if (result.errors.length > 0) {
    console.error('Dependency/security/license audit guard failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log(
    `Dependency/security/license audit guard passed for ${result.contractPath}` +
      (result.validatedEvidence ? ` and ${result.evidencePath}.` : ' in contract-only mode.')
  );
}
