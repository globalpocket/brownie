import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultManifestPath = 'docs/architecture/phase-value-manifest.json';

const strategicCapabilities = new Set([
  'agent_loop',
  'mode_pack_runtime',
  'runtime_permission_enforcement',
  'controlled_workspace_tools',
  'context_management',
  'llm_provider_execution',
  'codebase_indexing',
  'subtask_orchestration',
  'progress_visualization',
  'headless_autonomous_development'
]);

const weakCompletionPatterns = [
  /ci\s+(success|passed|green)/i,
  /checks?\s+(success|passed|green)/i,
  /pr\s+(merged|merge|exists?)/i,
  /pull request\s+(merged|exists?)/i,
  /manifest\s+(exists?|presence)/i,
  /source[-\s]?token/i,
  /string\s+presence/i,
  /endpoint\s+count/i
];

const wrapperPatterns = [
  /wrapper[-\s]?only/i,
  /report[-\s]?only/i,
  /readiness[-\s]?only/i,
  /digest[-\s]?only/i,
  /history[-\s]?only/i,
  /verdict[-\s]?only/i,
  /inspection[-\s]?only/i,
  /preview[-\s]?only/i,
  /summary[-\s]?only/i
];

const requiredGateArrays = [
  'accepted_capability',
  'behavior_evidence',
  'safety_boundary',
  'non_goals',
  'rejected_alternatives',
  'technical_debt',
  'next_capability_rationale'
];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join('/').replace(/^\.\//, '');
}

function readJson(repoRoot, relativePath, errors) {
  const normalized = normalizeRelativePath(relativePath);
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, normalized), 'utf8'));
  } catch (error) {
    errors.push(`${normalized} must be readable JSON: ${error.message}`);
    return {};
  }
}

function requireValue(condition, errors, message) {
  if (!condition) {
    errors.push(message);
  }
}

function textOf(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(textOf).join(' ');
  }
  if (value && typeof value === 'object') {
    return Object.values(value).map(textOf).join(' ');
  }
  return '';
}

function hasWeakCompletionOnly(text) {
  const compact = text.trim();
  return compact.length > 0 && weakCompletionPatterns.some((pattern) => pattern.test(compact));
}

function validateStringArray(value, fieldPath, errors) {
  requireValue(Array.isArray(value) && value.length > 0, errors, `${fieldPath} must be a non-empty array.`);
  if (!Array.isArray(value)) {
    return;
  }
  for (const [index, entry] of value.entries()) {
    requireValue(isNonEmptyString(entry), errors, `${fieldPath}[${index}] must be a non-empty string.`);
  }
}

function validateCapabilityMapping(manifest, manifestPath, errors) {
  const mappings = Array.isArray(manifest.strategic_capability_mapping) ? manifest.strategic_capability_mapping : [];
  requireValue(mappings.length > 0, errors, `${manifestPath} strategic_capability_mapping must be non-empty for completion evidence.`);
  for (const [index, mapping] of mappings.entries()) {
    requireValue(
      strategicCapabilities.has(mapping.capability),
      errors,
      `${manifestPath} strategic_capability_mapping[${index}].capability must be a Product Charter strategic capability.`
    );
    requireValue(
      isNonEmptyString(mapping.relationship),
      errors,
      `${manifestPath} strategic_capability_mapping[${index}].relationship must be non-empty.`
    );
  }
}

function validateBehaviorEvidence(manifest, gate, manifestPath, errors) {
  const evidence = [
    ...(Array.isArray(manifest.behavior_evidence) ? manifest.behavior_evidence : []),
    ...(Array.isArray(gate.behavior_evidence) ? gate.behavior_evidence : [])
  ];
  requireValue(evidence.length > 0, errors, `${manifestPath} behavior evidence must be non-empty.`);
  requireValue(
    evidence.some((entry) => /\b(test|guard|behavior|fixture|validation)\b/i.test(entry)),
    errors,
    `${manifestPath} behavior evidence must reference tests, fixtures, guards, behavior, or validation.`
  );
  for (const [index, entry] of evidence.entries()) {
    requireValue(isNonEmptyString(entry), errors, `${manifestPath} behavior evidence[${index}] must be non-empty.`);
    requireValue(!hasWeakCompletionOnly(entry), errors, `${manifestPath} behavior evidence[${index}] must not be CI/PR/manifest-only evidence.`);
  }
}

function validateWrapperClaim(gate, manifestPath, errors) {
  const claimedCapability = textOf(gate.accepted_capability);
  const wrapperLike = wrapperPatterns.some((pattern) => pattern.test(claimedCapability));
  if (!wrapperLike) {
    return;
  }
  const blockerRemoval = gate.blocker_removal ?? {};
  requireValue(
    blockerRemoval.allowed === true && isNonEmptyString(blockerRemoval.blocker) && gate.product_completion_claim !== true,
    errors,
    `${manifestPath} wrapper/report-style completion claims require blocker_removal.allowed=true, a named blocker, and no product_completion_claim.`
  );
}

export function validateProductCompletionManifest(manifest, options = {}) {
  const manifestPath = options.manifestPath ?? defaultManifestPath;
  const errors = [];
  const gate = manifest.product_completion_gate ?? {};

  requireValue(gate.required === true, errors, `${manifestPath} product_completion_gate.required must be true.`);
  requireValue(isNonEmptyString(manifest.phase), errors, `${manifestPath} phase must be non-empty.`);
  requireValue(isNonEmptyString(manifest.target_capability), errors, `${manifestPath} target_capability must be non-empty.`);
  requireValue(
    strategicCapabilities.has(manifest.target_capability),
    errors,
    `${manifestPath} target_capability must be a Product Charter strategic capability.`
  );
  requireValue(isNonEmptyString(manifest.concrete_capability_transition), errors, `${manifestPath} concrete_capability_transition must be non-empty.`);
  requireValue(
    !hasWeakCompletionOnly(manifest.concrete_capability_transition),
    errors,
    `${manifestPath} concrete_capability_transition must not be CI/PR/manifest/token/endpoint-only evidence.`
  );

  validateCapabilityMapping(manifest, manifestPath, errors);

  for (const field of requiredGateArrays) {
    validateStringArray(gate[field], `${manifestPath} product_completion_gate.${field}`, errors);
  }

  validateBehaviorEvidence(manifest, gate, manifestPath, errors);
  validateWrapperClaim(gate, manifestPath, errors);

  const allEvidenceText = textOf({
    transition: manifest.concrete_capability_transition,
    exit_criteria: manifest.exit_criteria,
    behavior_evidence: manifest.behavior_evidence,
    gate
  });
  requireValue(
    !/^\\s*(?:ci|checks?|pr|pull request|manifest|source[-\\s]?token|string|endpoint)/i.test(allEvidenceText),
    errors,
    `${manifestPath} completion evidence must not start from CI/PR/manifest/token/endpoint-only claims.`
  );

  return errors;
}

export function runProductCompletionGuard(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const manifestPath = options.manifestPath ?? process.env.BROWNIE_PRODUCT_COMPLETION_MANIFEST ?? defaultManifestPath;
  const readErrors = [];
  const manifest = options.manifest ?? readJson(repoRoot, manifestPath, readErrors);
  const errors = [...readErrors, ...validateProductCompletionManifest(manifest, { manifestPath })];
  return { errors, manifestPath };
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const result = runProductCompletionGuard();
  if (result.errors.length > 0) {
    console.error('Product completion guard failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`Product completion guard passed for ${result.manifestPath}.`);
}
