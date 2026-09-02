import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultAuditPath = 'docs/architecture/runtime-release-readiness-audit.json';
const defaultBoundaryContractPath = 'docs/architecture/runtime-boundary-canonical-contract.json';
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
  ['runtime-boundary-protocol-contracts', { priority: 'P0' }],
  ['explicit-cancel-command', { priority: 'P0' }],
  ['real-process-loss-recovery-e2e', { priority: 'P0' }],
  ['durable-schema-version-and-migration', { priority: 'P0' }],
  ['runtime-release-guard-ci', { priority: 'P0' }],
  ['protocol-event-canonization', { priority: 'P1' }],
  ['runtime-module-decomposition-reevaluation', { priority: 'P1' }],
  ['platform-deadline-durability-hardening', { priority: 'P1' }]
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

const requiredBoundarySurfaceIds = [
  'run-request',
  'runtime-event',
  'control-command',
  'run-result-attestation',
  'run-inspection',
  'task-runtime',
  'cli-external-loop',
  'vsix-validation'
];

const requiredBoundaryMethodSubset = [
  'runtime.status',
  'task.start',
  'task.cancel',
  'task.run',
  'task.inspect',
  'task.list',
  'headless.continue_once',
  'run.events',
  'run.inspect',
  'tool.execute',
  'proposal.inspect'
];

const requiredBoundaryAnchorPaths = [
  'crates/brownie-runtime/src/lib.rs',
  'crates/brownie-protocol/src/lib.rs',
  'docs/specifications/runtime-protocol-spec-v0.md',
  'docs/specifications/runtime-boundary-and-release-dod-spec-v0.md',
  'docs/specifications/cli-external-loop-spec-v0.md',
  'docs/specifications/run-inspection-spec-v0.md',
  'docs/specifications/task-runtime-spec-v0.md',
  'extensions/brownie-vsix/src/runtime/protocol.ts',
  'extensions/brownie-vsix/src/runtime/runtimeClient.ts',
  'crates/brownie-cli/src/runtime_client.rs'
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

function isOpenRuntimeReleaseBlocker(item) {
  return (
    item.responsibility_domain === 'runtime' &&
    ['P0', 'P1'].includes(item.priority) &&
    item.status !== 'implemented_sufficient' &&
    item.debt_classification === 'required_before_release'
  );
}

function allStrings(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function collectBoundaryAnchors(contract) {
  const anchors = new Set();
  for (const key of ['implementation_anchors', 'documentation_anchors', 'validator_anchors', 'anchors']) {
    if (Array.isArray(contract?.transport?.[key])) {
      for (const anchor of contract.transport[key]) {
        anchors.add(anchor);
      }
    }
  }
  for (const entry of Array.isArray(contract?.compatibility_matrix) ? contract.compatibility_matrix : []) {
    for (const anchor of Array.isArray(entry?.anchors) ? entry.anchors : []) {
      anchors.add(anchor);
    }
  }
  for (const surface of Array.isArray(contract?.boundary_surfaces) ? contract.boundary_surfaces : []) {
    for (const key of ['implementation_anchors', 'documentation_anchors', 'validator_anchors']) {
      for (const anchor of Array.isArray(surface?.[key]) ? surface[key] : []) {
        anchors.add(anchor);
      }
    }
  }
  return anchors;
}

export function validateRuntimeBoundaryContract(contract, options = {}) {
  const contractPath = options.contractPath ?? defaultBoundaryContractPath;
  const errors = [];

  requireValue(Number.isInteger(contract.schema_version) && contract.schema_version > 0, errors, `${contractPath} schema_version must be a positive integer.`);
  requireValue(contract.contract_id === 'runtime-boundary-canonical-contract-v0', errors, `${contractPath} contract_id must identify the canonical Runtime boundary contract.`);
  requireValue(contract.campaign === 'runtime-release-readiness-p0-p1-finite-closure', errors, `${contractPath} campaign must match Runtime release readiness.`);
  requireValue(contract.owner === 'runtime', errors, `${contractPath} owner must be runtime.`);
  requireValue(contract.runtime_release_debt_id === 'runtime-boundary-protocol-contracts', errors, `${contractPath} must bind to runtime-boundary-protocol-contracts.`);
  requireValue(contract.transport?.kind === 'stdio_ndjson_jsonrpc_2_0', errors, `${contractPath} transport.kind must be stdio_ndjson_jsonrpc_2_0.`);
  requireValue(contract.transport?.owner === 'runtime', errors, `${contractPath} transport owner must be runtime.`);
  requireValue(isNonEmptyString(contract.transport?.compatibility_expectation), errors, `${contractPath} transport must include a compatibility expectation.`);
  requireValue(isNonEmptyString(contract.transport?.schema_version), errors, `${contractPath} transport must include schema_version.`);

  const surfaces = Array.isArray(contract.boundary_surfaces) ? contract.boundary_surfaces : [];
  requireValue(surfaces.length > 0, errors, `${contractPath} boundary_surfaces must be non-empty.`);
  const bySurfaceId = new Map();
  for (const [index, surface] of surfaces.entries()) {
    requireValue(isNonEmptyString(surface.id), errors, `${contractPath} boundary_surfaces[${index}].id must be non-empty.`);
    requireValue(isNonEmptyString(surface.title), errors, `${contractPath} ${surface.id ?? index} title must be non-empty.`);
    requireValue(surface.owner === 'runtime', errors, `${contractPath} ${surface.id ?? index} owner must be runtime.`);
    requireValue(isNonEmptyString(surface.stability_class), errors, `${contractPath} ${surface.id ?? index} stability_class must be non-empty.`);
    requireValue(isNonEmptyString(surface.schema_version), errors, `${contractPath} ${surface.id ?? index} schema_version must be non-empty.`);
    requireValue(isNonEmptyString(surface.compatibility_expectation), errors, `${contractPath} ${surface.id ?? index} compatibility_expectation must be non-empty.`);
    requireValue(allStrings(surface.implementation_anchors), errors, `${contractPath} ${surface.id ?? index} implementation_anchors must be non-empty strings.`);
    requireValue(allStrings(surface.documentation_anchors), errors, `${contractPath} ${surface.id ?? index} documentation_anchors must be non-empty strings.`);
    requireValue(allStrings(surface.validator_anchors), errors, `${contractPath} ${surface.id ?? index} validator_anchors must be non-empty strings.`);
    if (isNonEmptyString(surface.id)) {
      requireValue(!bySurfaceId.has(surface.id), errors, `${contractPath} duplicate boundary surface ${surface.id}.`);
      bySurfaceId.set(surface.id, surface);
    }
  }
  for (const id of requiredBoundarySurfaceIds) {
    requireValue(bySurfaceId.has(id), errors, `${contractPath} must include boundary surface ${id}.`);
  }

  const methods = new Set(Array.isArray(contract.required_runtime_methods) ? contract.required_runtime_methods : []);
  for (const method of requiredBoundaryMethodSubset) {
    requireValue(methods.has(method), errors, `${contractPath} required_runtime_methods must include ${method}.`);
  }

  const compatibilityMatrix = Array.isArray(contract.compatibility_matrix) ? contract.compatibility_matrix : [];
  for (const client of ['brownie-cli', 'brownie-vsix', 'external-control-plane']) {
    const entry = compatibilityMatrix.find((item) => item?.client === client);
    requireValue(Boolean(entry), errors, `${contractPath} compatibility_matrix must include ${client}.`);
    if (entry) {
      requireValue(isNonEmptyString(entry.boundary_role), errors, `${contractPath} ${client} boundary_role must be non-empty.`);
      requireValue(isNonEmptyString(entry.compatibility_expectation), errors, `${contractPath} ${client} compatibility_expectation must be non-empty.`);
      requireValue(allStrings(entry.anchors), errors, `${contractPath} ${client} anchors must be non-empty strings.`);
    }
  }

  const anchors = collectBoundaryAnchors(contract);
  for (const anchor of requiredBoundaryAnchorPaths) {
    requireValue(anchors.has(anchor), errors, `${contractPath} must anchor ${anchor}.`);
  }

  const nonAuthority = Array.isArray(contract.non_authority) ? contract.non_authority.join('\n') : '';
  for (const term of ['CLI', 'VSIX', 'cannot grant', 'MCP', 'Raw prompt']) {
    requireValue(nonAuthority.includes(term), errors, `${contractPath} non_authority must preserve ${term} boundary language.`);
  }

  return errors;
}

export function validateRuntimeReleaseReadinessAudit(audit, options = {}) {
  const auditPath = options.auditPath ?? defaultAuditPath;
  const ciText = options.ciText ?? '';
  const cargoText = options.cargoText ?? '';
  const vsixPackageText = options.vsixPackageText ?? '';
  const errors = [];

  requireValue(Number.isInteger(audit.schema_version) && audit.schema_version > 0, errors, `${auditPath} schema_version must be a positive integer.`);
  requireValue(audit.campaign === 'runtime-release-readiness-p0-p1-finite-closure', errors, `${auditPath} campaign must identify the finite P0/P1 closure campaign.`);
  requireValue(typeof audit.runtime_release_ready === 'boolean', errors, `${auditPath} runtime_release_ready must be a boolean.`);

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
    if (expected.status) {
      requireValue(item.status === expected.status, errors, `${auditPath} ${id} must have status ${expected.status}.`);
      requireValue(item.debt_classification === expected.debt, errors, `${auditPath} ${id} must be classified ${expected.debt}.`);
    } else if (item.status === 'implemented_sufficient') {
      requireValue(item.debt_classification === 'closed', errors, `${auditPath} ${id} must be classified closed after implemented_sufficient.`);
    } else {
      requireValue(item.debt_classification === 'required_before_release', errors, `${auditPath} ${id} must remain required_before_release until implemented_sufficient.`);
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
    if (item.responsibility_domain === 'runtime' && ['P0', 'P1'].includes(item.priority) && item.status === 'implemented_sufficient') {
      requireValue(
        item.debt_classification === 'closed',
        errors,
        `${auditPath} implemented Runtime ${item.priority} item ${item.id} must be closed.`
      );
    }
  }

  const blockedBy = new Set(Array.isArray(audit.release_ready_blocked_by) ? audit.release_ready_blocked_by : []);
  const openRuntimeBlockers = classifications.filter(isOpenRuntimeReleaseBlocker);
  for (const item of classifications) {
    if (isOpenRuntimeReleaseBlocker(item)) {
      requireValue(blockedBy.has(item.id), errors, `${auditPath} release_ready_blocked_by must include ${item.id}.`);
    }
  }
  for (const id of blockedBy) {
    const item = byId.get(id);
    requireValue(Boolean(item), errors, `${auditPath} release_ready_blocked_by contains unknown id ${id}.`);
    if (!item) {
      continue;
    }
    requireValue(
      isOpenRuntimeReleaseBlocker(item),
      errors,
      `${auditPath} release_ready_blocked_by must not include closed or non-runtime item ${id}.`
    );
  }
  if (openRuntimeBlockers.length > 0) {
    requireValue(
      audit.runtime_release_ready === false,
      errors,
      `${auditPath} runtime_release_ready must remain false while required Runtime P0/P1 debt is open.`
    );
  } else {
    requireValue(audit.runtime_release_ready === true, errors, `${auditPath} runtime_release_ready must be true after all Runtime P0/P1 release blockers are closed.`);
    requireValue(blockedBy.size === 0, errors, `${auditPath} release_ready_blocked_by must be empty when Runtime release is ready.`);
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
  const boundaryContractPath = options.boundaryContractPath ?? process.env.BROWNIE_RUNTIME_BOUNDARY_CONTRACT ?? defaultBoundaryContractPath;
  const readErrors = [];
  const audit = options.audit ?? readJson(repoRoot, auditPath, readErrors);
  const boundaryContract = options.boundaryContract ?? readJson(repoRoot, boundaryContractPath, readErrors);
  const ciText = options.ciText ?? readText(repoRoot, defaultCiPath, readErrors);
  const cargoText = options.cargoText ?? readText(repoRoot, defaultCargoPath, readErrors);
  const vsixPackageText = options.vsixPackageText ?? readText(repoRoot, defaultVsixPackagePath, readErrors);
  const errors = [
    ...readErrors,
    ...validateRuntimeReleaseReadinessAudit(audit, { auditPath, ciText, cargoText, vsixPackageText }),
    ...validateRuntimeBoundaryContract(boundaryContract, { contractPath: boundaryContractPath })
  ];
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
