import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const manifestPath = path.join(repoRoot, 'docs/architecture/phase-value-manifest.json');
const metadataPath = path.join(repoRoot, 'docs/architecture/diagnostics-legacy-api-metadata.json');

const errors = [];

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    errors.push(`Failed to read JSON ${path.relative(repoRoot, filePath)}: ${error.message}`);
    return {};
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateManifest(manifest) {
  if (manifest.phase !== 'R1.1') {
    errors.push('phase-value-manifest.json must describe phase R1.1.');
  }
  if (manifest.next_milestone_after_r1_1 !== 'agent_loop_integration') {
    errors.push('phase-value-manifest.json must set next_milestone_after_r1_1 to agent_loop_integration.');
  }
  if (!isNonEmptyString(manifest.project_objective) && !isNonEmptyString(manifest.project_objective_ref)) {
    errors.push('phase-value-manifest.json must include a project objective or charter reference.');
  }
  if (!Array.isArray(manifest.strategic_capability_mapping) || manifest.strategic_capability_mapping.length === 0) {
    errors.push('phase-value-manifest.json must include a non-empty strategic_capability_mapping.');
  } else {
    for (const [index, mapping] of manifest.strategic_capability_mapping.entries()) {
      if (!isNonEmptyString(mapping.capability) || !isNonEmptyString(mapping.relationship)) {
        errors.push(`strategic_capability_mapping[${index}] must include capability and relationship.`);
      }
    }
  }

  const valueGate = manifest.phase_value_gate ?? {};
  const questions = Array.isArray(valueGate.questions) ? valueGate.questions : [];
  const answers = valueGate.answers ?? {};
  if (questions.length === 0) {
    errors.push('phase_value_gate.questions must be non-empty.');
  }
  for (const question of questions) {
    if (!isNonEmptyString(question.id)) {
      errors.push('Every phase_value_gate question must have an id.');
      continue;
    }
    if (!isNonEmptyString(answers[question.id])) {
      errors.push(`phase_value_gate.answers.${question.id} must be non-empty.`);
    }
  }

  const reviewGate = manifest.review_value_gate ?? {};
  if (!Array.isArray(reviewGate.reject_when) || reviewGate.reject_when.length === 0) {
    errors.push('review_value_gate.reject_when must be non-empty.');
  }
}

function validateMetadata(metadata) {
  if (!Number.isInteger(metadata.long_name_threshold) || metadata.long_name_threshold <= 0) {
    errors.push('diagnostics-legacy-api-metadata.json must include a positive long_name_threshold.');
  }
  if (!isNonEmptyString(metadata.method_prefix)) {
    errors.push('diagnostics-legacy-api-metadata.json must include method_prefix.');
  }
  if (!isNonEmptyString(metadata.protocol_type_prefix)) {
    errors.push('diagnostics-legacy-api-metadata.json must include protocol_type_prefix.');
  }
  if (!Array.isArray(metadata.legacy_methods) || metadata.legacy_methods.length === 0) {
    errors.push('diagnostics-legacy-api-metadata.json must include a non-empty legacy_methods allowlist.');
  }
  for (const [index, method] of (metadata.legacy_methods ?? []).entries()) {
    if (!isNonEmptyString(method.name) || !isNonEmptyString(method.status)) {
      errors.push(`legacy_methods[${index}] must include name and status.`);
    }
  }
}

function walkFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const skippedDirs = new Set(['.git', 'target', 'node_modules', 'dist', 'out', 'coverage']);
  const allowedExtensions = new Set(['.rs', '.ts', '.tsx', '.js', '.mjs']);
  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!skippedDirs.has(entry.name)) {
          stack.push(absolute);
        }
        continue;
      }
      if (entry.isFile() && allowedExtensions.has(path.extname(entry.name))) {
        files.push(absolute);
      }
    }
  }

  return files;
}

function collectMatches(text, regex) {
  return [...text.matchAll(regex)].map((match) => match[0]);
}

function validateDiagnosticsApi(metadata) {
  const methodPrefix = metadata.method_prefix ?? 'proposal.reviewQueueDiagnostics';
  const typePrefix = metadata.protocol_type_prefix ?? 'ProposalReviewQueueDiagnostics';
  const clientPrefix = metadata.runtime_client_method_prefix ?? 'reviewQueueDiagnostics';
  const threshold = metadata.long_name_threshold ?? 80;
  const legacyMethods = new Set((metadata.legacy_methods ?? []).map((method) => method.name));
  const typeSuffixes = metadata.derived_legacy_type_suffixes ?? ['Params', 'Result'];
  const allowedTypes = new Set();
  const allowedClientMethods = new Set();

  for (const method of legacyMethods) {
    const suffix = method.slice(methodPrefix.length);
    allowedClientMethods.add(`${clientPrefix}${suffix}`);
    for (const typeSuffix of typeSuffixes) {
      allowedTypes.add(`${typePrefix}${suffix}${typeSuffix}`);
    }
  }

  const scanRoots = [
    path.join(repoRoot, 'crates'),
    path.join(repoRoot, 'extensions/brownie-vsix/src')
  ];
  const files = scanRoots.flatMap(walkFiles);
  const seenErrors = new Set();

  function addLocatedError(message, filePath, token) {
    const relative = path.relative(repoRoot, filePath);
    const key = `${relative}:${token}:${message}`;
    if (!seenErrors.has(key)) {
      seenErrors.add(key);
      errors.push(`${message} (${relative}: ${token})`);
    }
  }

  const methodRegex = /proposal\.reviewQueueDiagnostics[A-Za-z0-9]*/g;
  const typeRegex = /ProposalReviewQueueDiagnostics[A-Za-z0-9]*/g;
  const clientRegex = /\breviewQueueDiagnostics[A-Za-z0-9]*(?=\s*\()/g;

  for (const filePath of files) {
    const text = fs.readFileSync(filePath, 'utf8');

    for (const token of collectMatches(text, methodRegex)) {
      if (!legacyMethods.has(token)) {
        addLocatedError('New diagnostics wrapper RPC is not in the legacy allowlist', filePath, token);
      }
      if (token.length > threshold && !legacyMethods.has(token)) {
        addLocatedError('Long diagnostics RPC must be explicitly marked legacy/deprecated', filePath, token);
      }
    }

    for (const token of collectMatches(text, typeRegex)) {
      if (!allowedTypes.has(token)) {
        addLocatedError('New diagnostics protocol type is not derived from a legacy allowlisted RPC', filePath, token);
      }
      if (token.length > threshold && !allowedTypes.has(token)) {
        addLocatedError('Long diagnostics protocol type must be explicitly marked legacy/deprecated', filePath, token);
      }
    }

    for (const token of collectMatches(text, clientRegex)) {
      if (!allowedClientMethods.has(token)) {
        addLocatedError('New RuntimeClient diagnostics wrapper method is not derived from a legacy allowlisted RPC', filePath, token);
      }
      if (token.length > threshold && !allowedClientMethods.has(token)) {
        addLocatedError('Long RuntimeClient diagnostics method must be explicitly marked legacy/deprecated', filePath, token);
      }
    }
  }
}

const manifest = readJson(manifestPath);
const metadata = readJson(metadataPath);

validateManifest(manifest);
validateMetadata(metadata);
validateDiagnosticsApi(metadata);

if (errors.length > 0) {
  console.error('Diagnostics API guard failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Diagnostics API guard passed.');
