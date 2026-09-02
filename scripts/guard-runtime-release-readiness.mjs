import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultAuditPath = 'docs/architecture/runtime-release-readiness-audit.json';
const defaultCiPath = '.github/workflows/ci.yml';
const defaultCargoPath = 'Cargo.toml';
const defaultVsixPackagePath = 'extensions/brownie-vsix/package.json';

const allowedStatuses = new Set([
  'implemented_sufficient',
  'implemented_contract_gap',
  'partial',
  'unimplemented',
  'runtime_outside',
  'owner_decision_waiting'
]);

const allowedDomains = new Set([
  'runtime',
  'external_control_plane',
  'external_adapter',
  'commercial_solution',
  'owner'
]);

const allowedDebtClassifications = new Set([
  'closed',
  'required_before_release',
  'post_v0',
  'owner_decision'
]);

const requiredRuntimeItems = new Map([
  ['runtime-release-debt-reaudit', { priority: 'P0', status: 'implemented_sufficient', debt: 'closed' }],
  ['runtime-boundary-protocol-contracts', { priority: 'P0', debt: 'required_before_release' }],
  ['explicit-cancel-command', { priority: 'P0', debt: 'required_before_release' }],
  ['real-process-loss-recovery-e2e', { priority: 'P0', debt: 'required_before_release' }],
  ['durable-schema-version-and-migration', { priority: 'P0', debt: 'required_before_release' }],
  ['runtime-release-guard-ci', { priority: 'P0', debt: 'required_before_release' }],
  ['protocol-event-canonization', { priority: 'P1', debt: 'required_before_release' }],
  ['runtime-module-decomposition-reevaluation', { priority: 'P1', debt: 'required_before_release' }],
  ['platform-deadline-durability-hardening', { priority: 'P1', debt: 'required_before_release' }]
]);

const requiredOutsideItems = new Map([
  ['hosted-scheduler-daemon-worker-fleet', 'external_control_plane'],
  ['forge-notification-adapters', 'external_adapter'],
  ['enterprise-commercial-readiness', 'commercial_solution']
]);

const requiredCiCommands = [
  'pnpm guard:phase-value',
  'pnpm guard:phase-value:test',
  'pnpm --filter brownie-vsix check'
];

const requiredVsixCheckCommands = [
  'pnpm --workspace-root guard:runtime-release-readiness'
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

function hasEvidence(item) {
  return Array.isArray(item.evidence) && item.evidence.some(isNonEmptyString);
}

function findOwnerDecision(audit, id) {
  const decisions = Array.isArray(audit.owner_decisions) ? audit.owner_decisions : [];
  return decisions.find((decision) => decision && decision.id === id && decision.status === 'required');
}

export function validateRuntimeReleaseReadinessAudit(audit, options = {}) {
  const auditPath = options.auditPath ?? defaultAuditPath;
  const ciText = options.ciText ?? '';
  const cargoText = options.cargoText ?? '';
  const vsixPackageText = options.vsixPackageText ?? '';
  const errors = [];

  requireValue(Number.isInteger(audit.schema_version) && audit.schema_version > 0, errors, `${auditPath} schema_version must be a positive integer.`);
  requireValue(audit.campaign === 'runtime-release-readiness-p0-p1-finite-closure', errors, `${auditPath} campaign must identify the finite P0/P1 closure campaign.`);
  requireValue(audit.runtime_release_ready === false, errors, `${auditPath} runtime_release_ready must remain false while required Runtime P0/P1 debt is open.`);

  const classifications = Array.isArray(audit.classifications) ? audit.classifications : [];
  requireValue(classifications.length > 0, errors, `${auditPath} classifications must be non-empty.`);
  const byId = new Map();
  for (const [index, item] of classifications.entries()) {
    requireValue(isNonEmptyString(item.id), errors, `${auditPath} classifications[${index}].id must be non-empty.`);
    requireValue(isNonEmptyString(item.title), errors, `${auditPath} classifications[${index}].title must be non-empty.`);
    requireValue(['P0', 'P1', 'P2'].includes(item.priority), errors, `${auditPath} ${item.id ?? index} priority must be P0, P1, or P2.`);
    requireValue(allowedStatuses.has(item.status), errors, `${auditPath} ${item.id ?? index} status is not allowed.`);
    requireValue(allowedDomains.has(item.responsibility_domain), errors, `${auditPath} ${item.id ?? index} responsibility_domain is not allowed.`);
    requireValue(allowedDebtClassifications.has(item.debt_classification), errors, `${auditPath} ${item.id ?? index} debt_classification is not allowed.`);
    requireValue(hasEvidence(item), errors, `${auditPath} ${item.id ?? index} must include bounded evidence.`);
    if (isNonEmptyString(item.id)) {
      requireValue(!byId.has(item.id), errors, `${auditPath} duplicate classification id ${item.id}.`);
      byId.set(item.id, item);
    }
  }

  for (const [id, expected] of requiredRuntimeItems.entries()) {
    const item = byId.get(id);
    requireValue(Boolean(item), errors, `${auditPath} must include Runtime release item ${id}.`);
    if (!item) {
      continue;
    }
    requireValue(item.priority === expected.priority, errors, `${auditPath} ${id} must remain ${expected.priority}.`);
    requireValue(item.responsibility_domain === 'runtime', errors, `${auditPath} ${id} must be Runtime-owned.`);
    requireValue(item.debt_classification === expected.debt, errors, `${auditPath} ${id} must be classified ${expected.debt}.`);
    if (expected.status) {
      requireValue(item.status === expected.status, errors, `${auditPath} ${id} must have status ${expected.status}.`);
    } else {
      requireValue(
        ['implemented_contract_gap', 'partial', 'unimplemented'].includes(item.status),
        errors,
        `${auditPath} ${id} must stay open until a later closure phase proves it implemented_sufficient.`
      );
    }
  }

  for (const [id, domain] of requiredOutsideItems.entries()) {
    const item = byId.get(id);
    requireValue(Boolean(item), errors, `${auditPath} must include out-of-runtime item ${id}.`);
    if (!item) {
      continue;
    }
    requireValue(item.status === 'runtime_outside', errors, `${auditPath} ${id} must be runtime_outside.`);
    requireValue(item.responsibility_domain === domain, errors, `${auditPath} ${id} must remain in ${domain}.`);
    requireValue(item.debt_classification === 'post_v0', errors, `${auditPath} ${id} must remain post_v0.`);
  }

  for (const item of classifications) {
    const openRuntimeP0P1 =
      item.responsibility_domain === 'runtime' &&
      ['P0', 'P1'].includes(item.priority) &&
      item.status !== 'implemented_sufficient';
    requireValue(
      !openRuntimeP0P1 || item.debt_classification === 'required_before_release',
      errors,
      `${auditPath} open Runtime ${item.priority} item ${item.id} must be required_before_release.`
    );
    requireValue(
      item.responsibility_domain === 'runtime' ||
        item.responsibility_domain === 'owner' ||
        item.debt_classification === 'post_v0',
      errors,
      `${auditPath} non-runtime item ${item.id} must not block Runtime release.`
    );
  }

  const blockedBy = new Set(Array.isArray(audit.release_ready_blocked_by) ? audit.release_ready_blocked_by : []);
  for (const item of classifications) {
    if (
      item.responsibility_domain === 'runtime' &&
      ['P0', 'P1'].includes(item.priority) &&
      item.debt_classification === 'required_before_release'
    ) {
      requireValue(blockedBy.has(item.id), errors, `${auditPath} release_ready_blocked_by must include ${item.id}.`);
    }
  }

  if (/license\s*=\s*"UNLICENSED"/.test(cargoText) || /publish\s*=\s*false/.test(cargoText)) {
    const ossItem = byId.get('oss-release-technical-basis');
    requireValue(Boolean(findOwnerDecision(audit, 'oss_license')), errors, `${auditPath} must record required owner decision oss_license.`);
    requireValue(Boolean(ossItem), errors, `${auditPath} must include oss-release-technical-basis.`);
    if (ossItem) {
      requireValue(ossItem.status === 'owner_decision_waiting', errors, `${auditPath} oss-release-technical-basis must wait for owner decision.`);
      requireValue(ossItem.owner_decision_required === 'oss_license', errors, `${auditPath} oss-release-technical-basis must reference oss_license.`);
    }
  }

  for (const command of requiredCiCommands) {
    requireValue(ciText.includes(command), errors, `${defaultCiPath} must run ${command}.`);
  }
  for (const command of requiredVsixCheckCommands) {
    requireValue(vsixPackageText.includes(command), errors, `${defaultVsixPackagePath} check script must run ${command}.`);
  }

  return errors;
}

export function runRuntimeReleaseReadinessGuard(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const auditPath = options.auditPath ?? process.env.BROWNIE_RUNTIME_RELEASE_READINESS_AUDIT ?? defaultAuditPath;
  const readErrors = [];
  const audit = options.audit ?? readJson(repoRoot, auditPath, readErrors);
  const ciText = options.ciText ?? readText(repoRoot, defaultCiPath, readErrors);
  const cargoText = options.cargoText ?? readText(repoRoot, defaultCargoPath, readErrors);
  const vsixPackageText = options.vsixPackageText ?? readText(repoRoot, defaultVsixPackagePath, readErrors);
  const errors = [...readErrors, ...validateRuntimeReleaseReadinessAudit(audit, { auditPath, ciText, cargoText, vsixPackageText })];
  return { errors, auditPath };
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const result = runRuntimeReleaseReadinessGuard();
  if (result.errors.length > 0) {
    console.error('Runtime release readiness guard failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`Runtime release readiness guard passed for ${result.auditPath}.`);
}
