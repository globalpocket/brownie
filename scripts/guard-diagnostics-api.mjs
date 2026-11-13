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
  if (!isNonEmptyString(manifest.phase)) {
    errors.push('phase-value-manifest.json must describe a non-empty phase.');
  }
  if (!isNonEmptyString(manifest.target_capability)) {
    errors.push('phase-value-manifest.json must include target_capability.');
  }
  if (!isNonEmptyString(manifest.concrete_capability_transition)) {
    errors.push('phase-value-manifest.json must include concrete_capability_transition.');
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

function maskRustNonCode(source) {
  const code = source.split('');
  function hide(start, end) {
    for (let i = start; i < end; i++) if (code[i] !== '\n' && code[i] !== '\r') code[i] = ' ';
    return end;
  }
  for (let i = 0; i < source.length;) {
    if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i + 2);
      i = hide(i, end < 0 ? source.length : end);
    } else if (source.startsWith('/*', i)) {
      let depth = 1, end = i + 2;
      while (end < source.length && depth > 0) {
        if (source.startsWith('/*', end)) { depth++; end += 2; }
        else if (source.startsWith('*/', end)) { depth--; end += 2; }
        else end++;
      }
      i = hide(i, end);
    } else if (source[i] === 'r' && /^r#{0,255}"/.test(source.slice(i, i + 258))) {
      const prefix = source.slice(i, i + 258).match(/^r(#{0,255})"/);
      const end = source.indexOf('"' + prefix[1], i + prefix[0].length);
      i = hide(i, end < 0 ? source.length : end + prefix[1].length + 1);
    } else if (source[i] === '"') {
      let end = i + 1;
      while (end < source.length && source[end] !== '"') end += source[end] === '\\' ? 2 : 1;
      i = hide(i, Math.min(source.length, end + 1));
    } else if (source[i] === "'") {
      const character = source.slice(i, i + 258).match(/^'(?:\\(?:u\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{2}|.)|[^'\\\r\n])'/u);
      i = character ? hide(i, i + character[0].length) : i + 1;
    } else i++;
  }
  return code.join('');
}

function bracedRustBody(code, start) {
  let depth = 1, end = start + 1;
  if (start >= 0) {
    for (; end < code.length && depth > 0; end++) {
      if (code[end] === '{') depth++;
      else if (code[end] === '}') depth--;
    }
  }
  if (start < 0 || depth !== 0) {
    errors.push('Exact diagnostics inventory: actual Runtime dispatch body is incomplete.');
    return '';
  }
  return code.slice(start + 1, end - 1);
}

function runtimeDispatchArms(code) {
  const functions = [...code.matchAll(/\bpub\s+fn\s+handle_jsonrpc_request\s*\(/g)];
  if (functions.length !== 1) {
    errors.push('Exact diagnostics inventory requires one actual Runtime dispatch function.');
    return new Set();
  }
  const body = bracedRustBody(code, code.indexOf('{', functions[0].index + functions[0][0].length));
  const matches = [...body.matchAll(/\bmatch\s+request\s*\.\s*method\s*\.\s*as_str\s*\(\s*\)\s*\{/g)];
  if (matches.length !== 1) {
    errors.push('Exact diagnostics inventory requires one canonical request.method.as_str dispatch match.');
    return new Set();
  }
  const prelude = body.slice(0, matches[0].index);
  const nesting = [...prelude.matchAll(/[{}()[\]]/g)].reduce((depth, [token]) =>
    depth + ('{(['.includes(token) ? 1 : -1), 0);
  if (nesting !== 0) {
    errors.push('Exact diagnostics inventory requires a direct top-level Runtime dispatch match.');
    return new Set();
  }
  const arms = bracedRustBody(body, matches[0].index + matches[0][0].length - 1);
  const registered = new Set();
  const stack = [];
  const closing = { ')': '(', ']': '[', '}': '{' };
  let boundary = 0, inBody = false, blockBody = false;
  for (const match of arms.matchAll(/=>|[{}()[\],]/g)) {
    const [token] = match;
    if (token === '=>' && stack.length === 0) {
      if (inBody) errors.push('Unsupported actual Runtime dispatch pattern: missing arm separator.');
      const pattern = arms.slice(boundary, match.index).trim();
      const symbol = pattern.match(/^(?:r#)?(METHOD_[\p{ID_Continue}]+)$/u);
      // Every complete arm must use the current canonical style. Unknown
      // syntax is a failure, never a silently omitted registration.
      if (symbol) registered.add(symbol[1]);
      else if (pattern !== '_') errors.push(`Unsupported actual Runtime dispatch pattern: ${pattern}`);
      inBody = true;
      blockBody = arms.slice(match.index + 2).trimStart().startsWith('{');
    } else if ('{(['.includes(token)) stack.push(token);
    else if (closing[token]) {
      if (stack.pop() !== closing[token]) errors.push('Exact diagnostics inventory: unbalanced dispatch delimiters.');
      if (inBody && blockBody && stack.length === 0) {
        inBody = false;
        boundary = match.index + 1;
      }
    } else if (token === ',' && stack.length === 0) {
      if (!inBody && arms.slice(boundary, match.index).trim()) {
        errors.push('Unsupported actual Runtime dispatch pattern: unexpected arm fragment.');
      }
      boundary = match.index + 1;
      inBody = false;
    }
  }
  if (stack.length || (!inBody && arms.slice(boundary).trim())) {
    errors.push('Unsupported actual Runtime dispatch pattern: incomplete arm.');
  }
  return registered;
}

function validateExactInventory() {
  const runtime = fs.readFileSync(path.join(repoRoot, 'crates/brownie-runtime/src/lib.rs'), 'utf8');
  const protocol = fs.readFileSync(path.join(repoRoot, 'crates/brownie-protocol/src/lib.rs'), 'utf8');
  const document = fs.readFileSync(path.join(repoRoot, 'docs/architecture/diagnostics-api-consolidation.md'), 'utf8');
  const runtimeCode = maskRustNonCode(runtime);
  const protocolCode = maskRustNonCode(protocol);
  const dispatch = runtimeDispatchArms(runtimeCode);
  const registered = new Set();
  const declared = new Map();
  const declarations = /\bconst\s+(?:r#)?(METHOD_[\p{ID_Continue}]+)\s*:[^=;]+\s*=\s*"([^"\\\r\n]*)"\s*;/gu;
  for (const match of runtime.matchAll(declarations)) {
    const [, symbol, method] = match;
    if (runtimeCode.slice(match.index, match.index + 5) !== 'const') continue;
    if (declared.has(symbol)) errors.push(`Ambiguous actual Runtime dispatch method constant: ${symbol}`);
    declared.set(symbol, method);
  }
  for (const symbol of dispatch) {
    const method = declared.get(symbol);
    if (method === undefined) {
      errors.push(`Unresolved actual Runtime dispatch method constant: ${symbol}`);
      continue;
    }
    if (method.startsWith('proposal.reviewQueue')) registered.add(method);
  }
  if (registered.size === 0) errors.push('Exact diagnostics inventory: no registered Runtime methods found.');
  const heading = '\n## Exact Current Method And Type Inventory\n';
  const sections = document.split(heading);
  if (sections.length !== 2) {
    errors.push('Exact diagnostics inventory section must occur exactly once.');
    return;
  }
  const section = sections[1].split('\n## ', 1)[0];
  const documented = new Set();
  for (const line of section.split('\n')) {
    if (!/^\|\s*`proposal\./.test(line)) continue;
    const tokens = [...line.matchAll(/`([^`]+)`/g)].map(match => match[1]);
    if (tokens.length !== 3) {
      errors.push('Exact diagnostics inventory contains a malformed method/type row.');
      continue;
    }
    const [method, params, result] = tokens;
    if (documented.has(method)) errors.push(`Duplicate exact diagnostics inventory method: ${method}`);
    documented.add(method);
    if (!registered.has(method)) errors.push(`Unregistered exact diagnostics inventory method: ${method}`);
    const suffix = method.slice('proposal.'.length);
    const stem = 'Proposal' + suffix[0].toUpperCase() + suffix.slice(1);
    if (params !== stem + 'Params' || result !== stem + 'Result') {
      errors.push(`Mismatched exact diagnostics inventory type pair: ${method}`);
    }
    for (const type of [params, result]) {
      const escaped = type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`\\bpub\\s+struct\\s+${escaped}\\b`).test(protocolCode)) {
        errors.push(`Exact diagnostics inventory type is absent from Rust protocol: ${type}`);
      }
    }
  }
  for (const method of registered) {
    if (!documented.has(method)) errors.push(`Missing exact diagnostics inventory method: ${method}`);
  }
}

const manifest = readJson(manifestPath);
const metadata = readJson(metadataPath);

validateManifest(manifest);
validateMetadata(metadata);
validateDiagnosticsApi(metadata);
validateExactInventory();

if (errors.length > 0) {
  console.error('Diagnostics API guard failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Diagnostics API guard passed.');
