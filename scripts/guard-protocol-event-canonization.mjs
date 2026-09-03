import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultMapPath = 'docs/architecture/runtime-protocol-event-canonical-map.json';

const requiredSourcePaths = [
  'crates/brownie-runtime/src/lib.rs',
  'crates/brownie-protocol/src/lib.rs',
  'crates/brownie-store/src/lib.rs',
  'crates/brownie-events/src/lib.rs',
  'crates/brownie-cli/src/runtime_client.rs',
  'extensions/brownie-vsix/src/runtime/protocol.ts',
  'extensions/brownie-vsix/src/runtime/runtimeClient.ts',
  'docs/specifications/runtime-protocol-spec-v0.md'
];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function readText(repoRoot, relativePath, errors) {
  try {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
  } catch (error) {
    errors.push(`${relativePath} must be readable: ${error.message}`);
    return '';
  }
}

function readJson(repoRoot, relativePath, errors) {
  try {
    return JSON.parse(readText(repoRoot, relativePath, errors));
  } catch (error) {
    errors.push(`${relativePath} must be readable JSON: ${error.message}`);
    return {};
  }
}

function requireValue(condition, errors, message) {
  if (!condition) {
    errors.push(message);
  }
}

function extractRuntimeMethods(runtimeText) {
  const methods = new Map();
  const re = /const\s+(METHOD_[A-Z0-9_]+):\s*&str\s*=\s*(?:\n\s*)?"([^"]+)"/g;
  let match;
  while ((match = re.exec(runtimeText)) !== null) {
    methods.set(match[2], match[1]);
  }
  return methods;
}

function extractEnumVariants(text, enumName) {
  const match = text.match(new RegExp(`pub\\s+enum\\s+${enumName}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) {
    return [];
  }
  return match[1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim().replace(/,$/, ''))
    .filter((line) => /^[A-Z][A-Za-z0-9_]*$/.test(line));
}

function collectMappedMethods(map) {
  const methods = new Set();
  const prefixes = [];
  for (const group of Array.isArray(map.protocol_method_groups) ? map.protocol_method_groups : []) {
    for (const method of Array.isArray(group.methods) ? group.methods : []) {
      methods.add(method);
    }
    for (const prefix of Array.isArray(group.covered_method_prefixes) ? group.covered_method_prefixes : []) {
      prefixes.push({ group: group.id, prefix });
    }
  }
  return { methods, prefixes };
}

function isMethodCovered(method, mappedMethods, prefixes) {
  if (mappedMethods.has(method)) {
    return true;
  }
  return prefixes.some(({ prefix }) => method.startsWith(prefix));
}

function isVariantCovered(variant, groups) {
  for (const group of groups) {
    if (Array.isArray(group.event_kind_variants) && group.event_kind_variants.includes(variant)) {
      return true;
    }
    if (Array.isArray(group.ledger_variants) && group.ledger_variants.includes(variant)) {
      return true;
    }
    if (
      Array.isArray(group.ledger_variant_prefixes) &&
      group.ledger_variant_prefixes.some((prefix) => variant.startsWith(prefix))
    ) {
      return true;
    }
  }
  return false;
}

function hasToken(text, token) {
  return isNonEmptyString(token) && text.includes(token);
}

export function validateRuntimeProtocolEventCanonicalMap(map, options = {}) {
  const mapPath = options.mapPath ?? defaultMapPath;
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const readErrors = [];
  const textByPath = new Map();
  const errors = [];

  for (const sourcePath of requiredSourcePaths) {
    textByPath.set(sourcePath, options.textByPath?.[sourcePath] ?? readText(repoRoot, sourcePath, readErrors));
  }

  errors.push(...readErrors);
  requireValue(Number.isInteger(map.schema_version) && map.schema_version > 0, errors, `${mapPath} schema_version must be a positive integer.`);
  requireValue(map.map_id === 'runtime-protocol-event-canonical-map-v0', errors, `${mapPath} map_id must identify the canonical protocol/event map.`);
  requireValue(map.campaign === 'runtime-release-readiness-p0-p1-finite-closure', errors, `${mapPath} campaign must match Runtime release readiness.`);
  requireValue(map.phase === 'RRP-5', errors, `${mapPath} phase must be RRP-5.`);
  requireValue(map.owner === 'runtime', errors, `${mapPath} owner must be runtime.`);
  requireValue(map.runtime_release_debt_id === 'protocol-event-canonization', errors, `${mapPath} must bind to protocol-event-canonization.`);
  requireValue(map.runtime_release_ready === false, errors, `${mapPath} must not declare Runtime Release Ready.`);

  const sources = new Set((Array.isArray(map.sources) ? map.sources : []).map((source) => source?.path));
  for (const sourcePath of requiredSourcePaths) {
    requireValue(sources.has(sourcePath), errors, `${mapPath} sources must include ${sourcePath}.`);
  }

  const runtimeText = textByPath.get('crates/brownie-runtime/src/lib.rs') ?? '';
  const protocolText = textByPath.get('crates/brownie-protocol/src/lib.rs') ?? '';
  const storeText = textByPath.get('crates/brownie-store/src/lib.rs') ?? '';
  const eventsText = textByPath.get('crates/brownie-events/src/lib.rs') ?? '';
  const docsText = textByPath.get('docs/specifications/runtime-protocol-spec-v0.md') ?? '';
  const runtimeMethods = extractRuntimeMethods(runtimeText);
  const { methods: mappedMethods, prefixes: mappedPrefixes } = collectMappedMethods(map);

  requireValue(mappedMethods.size > 0, errors, `${mapPath} protocol_method_groups must cover explicit methods.`);
  for (const [method, constant] of runtimeMethods.entries()) {
    requireValue(
      isMethodCovered(method, mappedMethods, mappedPrefixes),
      errors,
      `${mapPath} does not cover Runtime JSON-RPC method ${method} (${constant}).`
    );
  }

  const protocolGroups = Array.isArray(map.protocol_method_groups) ? map.protocol_method_groups : [];
  for (const [index, group] of protocolGroups.entries()) {
    requireValue(isNonEmptyString(group.id), errors, `${mapPath} protocol_method_groups[${index}].id must be non-empty.`);
    requireValue(group.owner === 'runtime', errors, `${mapPath} ${group.id ?? index} owner must be runtime.`);
    requireValue(isNonEmptyString(group.stability_class), errors, `${mapPath} ${group.id ?? index} stability_class must be non-empty.`);
    requireValue(Array.isArray(group.methods) && group.methods.length > 0, errors, `${mapPath} ${group.id ?? index} methods must be non-empty.`);

    for (const method of Array.isArray(group.methods) ? group.methods : []) {
      const constant = runtimeMethods.get(method);
      requireValue(Boolean(constant), errors, `${mapPath} ${group.id ?? index} references missing Runtime method ${method}.`);
      if (constant) {
        requireValue(runtimeText.includes(constant), errors, `${mapPath} ${method} must retain Runtime constant ${constant}.`);
        requireValue(runtimeText.includes(`${constant} =>`), errors, `${mapPath} ${method} must be covered by Runtime dispatch.`);
      }
      requireValue(docsText.includes(method), errors, `${mapPath} docs must mention canonical method ${method}.`);
      if (group.vsix_client_methods === true) {
        const vsixClientText = textByPath.get('extensions/brownie-vsix/src/runtime/runtimeClient.ts') ?? '';
        requireValue(vsixClientText.includes(`'${method}'`), errors, `${mapPath} VSIX client must project ${method}.`);
      }
      if (Array.isArray(group.cli_methods) && group.cli_methods.includes(method)) {
        const cliText = textByPath.get('crates/brownie-cli/src/runtime_client.rs') ?? '';
        requireValue(cliText.includes(`"${method}"`), errors, `${mapPath} CLI transport must reference ${method}.`);
      }
    }

    for (const anchor of Array.isArray(group.anchors) ? group.anchors : []) {
      const anchorText = textByPath.get(anchor.path) ?? '';
      requireValue(isNonEmptyString(anchor.path), errors, `${mapPath} ${group.id ?? index} anchor path must be non-empty.`);
      for (const token of Array.isArray(anchor.tokens) ? anchor.tokens : []) {
        requireValue(hasToken(anchorText, token), errors, `${mapPath} ${group.id ?? index} anchor ${anchor.path} must contain ${token}.`);
      }
    }
  }

  const eventGroups = Array.isArray(map.event_groups) ? map.event_groups : [];
  requireValue(eventGroups.length > 0, errors, `${mapPath} event_groups must be non-empty.`);

  const eventKindVariants = extractEnumVariants(eventsText, 'EventKind');
  const ledgerVariants = extractEnumVariants(storeText, 'LedgerEventKind');
  for (const variant of eventKindVariants) {
    requireValue(isVariantCovered(variant, eventGroups), errors, `${mapPath} does not cover EventKind variant ${variant}.`);
  }
  for (const variant of ledgerVariants) {
    requireValue(isVariantCovered(variant, eventGroups), errors, `${mapPath} does not cover LedgerEventKind variant ${variant}.`);
  }

  for (const [index, group] of eventGroups.entries()) {
    requireValue(isNonEmptyString(group.id), errors, `${mapPath} event_groups[${index}].id must be non-empty.`);
    requireValue(group.owner === 'runtime', errors, `${mapPath} ${group.id ?? index} owner must be runtime.`);
    for (const variant of Array.isArray(group.event_kind_variants) ? group.event_kind_variants : []) {
      requireValue(eventKindVariants.includes(variant), errors, `${mapPath} EventKind must define ${variant}.`);
    }
    for (const variant of Array.isArray(group.ledger_variants) ? group.ledger_variants : []) {
      requireValue(ledgerVariants.includes(variant), errors, `${mapPath} LedgerEventKind must define ${variant}.`);
    }
    for (const anchor of Array.isArray(group.anchors) ? group.anchors : []) {
      const anchorText = textByPath.get(anchor.path) ?? '';
      for (const token of Array.isArray(anchor.tokens) ? anchor.tokens : []) {
        requireValue(hasToken(anchorText, token), errors, `${mapPath} ${group.id ?? index} anchor ${anchor.path} must contain ${token}.`);
      }
    }
  }

  const nonAuthority = Array.isArray(map.non_authority) ? map.non_authority.join('\n') : '';
  for (const token of ['Runtime', 'CLI', 'VSIX', 'MCP', 'prose', 'raw prompt']) {
    requireValue(nonAuthority.includes(token), errors, `${mapPath} non_authority must preserve ${token} boundary language.`);
  }

  return errors;
}

export function runProtocolEventCanonizationGuard(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const mapPath = options.mapPath ?? process.env.BROWNIE_PROTOCOL_EVENT_CANONICAL_MAP ?? defaultMapPath;
  const readErrors = [];
  const map = options.map ?? readJson(repoRoot, mapPath, readErrors);
  const errors = [
    ...readErrors,
    ...validateRuntimeProtocolEventCanonicalMap(map, { repoRoot, mapPath, textByPath: options.textByPath })
  ];
  return { errors, mapPath };
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const result = runProtocolEventCanonizationGuard();
  if (result.errors.length > 0) {
    console.error('Protocol/event canonization guard failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`Protocol/event canonization guard passed for ${result.mapPath}.`);
}
