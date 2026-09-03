import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultMapPath = 'docs/architecture/runtime-protocol-event-canonical-map.json';
const defaultSemanticContractPath = 'docs/architecture/runtime-semantic-protocol-contract.json';

const requiredSourcePaths = [
  'crates/brownie-runtime/src/lib.rs',
  'crates/brownie-protocol/src/lib.rs',
  'crates/brownie-protocol/src/semantic_contract.rs',
  'crates/brownie-protocol/src/bin/brownie-protocol-semantic-contract.rs',
  'crates/brownie-store/src/lib.rs',
  'crates/brownie-events/src/lib.rs',
  'crates/brownie-cli/src/runtime_client.rs',
  'extensions/brownie-vsix/src/runtime/protocol.ts',
  'extensions/brownie-vsix/src/runtime/runtimeClient.ts',
  'extensions/brownie-vsix/src/test/semanticProtocolContract.test.ts',
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

function extractPublicParamStructs(text) {
  const params = new Set();
  const re = /pub\s+struct\s+([A-Za-z0-9]+Params)\b/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    params.add(match[1]);
  }
  return params;
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

function hasIdentifier(text, token) {
  return isNonEmptyString(token) && new RegExp(`\\b${token}\\b`).test(text);
}

function hasDenyUnknownForStruct(text, structName) {
  return new RegExp(`#\\[serde\\(deny_unknown_fields\\)\\]\\s*pub\\s+struct\\s+${structName}\\b`).test(text);
}

function runRustSemanticContractCheck(repoRoot, contractPath, errors) {
  const result = spawnSync(
    'cargo',
    [
      'run',
      '-p',
      'brownie-protocol',
      '--bin',
      'brownie-protocol-semantic-contract',
      '--',
      '--check',
      contractPath,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, CARGO_TERM_COLOR: 'never' },
    }
  );

  if (result.status !== 0) {
    const output = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim();
    errors.push(`${contractPath} must match the Rust semantic contract generator.${output ? ` ${output}` : ''}`);
  }
}

export function validateRuntimeSemanticProtocolContract(contract, map, options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const contractPath = options.contractPath ?? defaultSemanticContractPath;
  const mapPath = options.mapPath ?? defaultMapPath;
  const readErrors = [];
  const textByPath = new Map();
  const errors = [];

  for (const sourcePath of requiredSourcePaths) {
    textByPath.set(sourcePath, options.textByPath?.[sourcePath] ?? readText(repoRoot, sourcePath, readErrors));
  }

  errors.push(...readErrors);
  requireValue(Number.isInteger(contract.schema_version) && contract.schema_version > 0, errors, `${contractPath} schema_version must be a positive integer.`);
  requireValue(contract.contract_id === 'runtime-semantic-protocol-contract-v1', errors, `${contractPath} contract_id must identify the Runtime semantic protocol contract.`);
  requireValue(contract.campaign === 'runtime-release-readiness-p0-p1-finite-closure', errors, `${contractPath} campaign must match Runtime release readiness.`);
  requireValue(contract.phase === 'RRP-5.6', errors, `${contractPath} phase must be RRP-5.6.`);
  requireValue(contract.owner === 'runtime', errors, `${contractPath} owner must be runtime.`);
  requireValue(contract.runtime_release_debt_id === 'protocol-event-canonization', errors, `${contractPath} must bind to protocol-event-canonization.`);
  requireValue(contract.runtime_release_ready === false, errors, `${contractPath} must not declare Runtime Release Ready.`);

  const generatedBy = contract.generated_by ?? {};
  requireValue(generatedBy.crate === 'brownie-protocol', errors, `${contractPath} generated_by.crate must be brownie-protocol.`);
  requireValue(generatedBy.module === 'brownie_protocol::semantic_contract', errors, `${contractPath} generated_by.module must be Runtime-owned.`);
  requireValue(generatedBy.binary === 'brownie-protocol-semantic-contract', errors, `${contractPath} generated_by.binary must name the Rust generator.`);
  requireValue(
    typeof generatedBy.command === 'string' && generatedBy.command.includes('--write docs/architecture/runtime-semantic-protocol-contract.json'),
    errors,
    `${contractPath} generated_by.command must include the regeneration command.`
  );

  const sources = new Set((Array.isArray(contract.sources) ? contract.sources : []).map((source) => source?.path));
  for (const sourcePath of [
    'crates/brownie-protocol/src/lib.rs',
    'crates/brownie-protocol/src/semantic_contract.rs',
    'extensions/brownie-vsix/src/runtime/protocol.ts',
    'extensions/brownie-vsix/src/runtime/runtimeClient.ts',
    'extensions/brownie-vsix/src/test/semanticProtocolContract.test.ts',
    'crates/brownie-store/src/lib.rs',
  ]) {
    requireValue(sources.has(sourcePath), errors, `${contractPath} sources must include ${sourcePath}.`);
  }

  const { methods: mappedMethods, prefixes: mappedPrefixes } = collectMappedMethods(map);
  const contractMethods = new Map((Array.isArray(contract.method_contracts) ? contract.method_contracts : []).map((method) => [method?.method, method]));
  const typeSchemas = contract.type_schemas && typeof contract.type_schemas === 'object' ? contract.type_schemas : {};
  requireValue(contractMethods.size === mappedMethods.size, errors, `${contractPath} method_contracts must cover exactly ${mappedMethods.size} explicit Runtime methods from ${mapPath}.`);
  for (const method of mappedMethods) {
    requireValue(contractMethods.has(method), errors, `${contractPath} method_contracts must include ${method}.`);
    requireValue(isMethodCovered(method, mappedMethods, mappedPrefixes), errors, `${contractPath} method ${method} must also be covered by ${mapPath}.`);
  }
  for (const method of contractMethods.keys()) {
    requireValue(mappedMethods.has(method), errors, `${contractPath} method_contracts must not include non-explicit Runtime method ${method}.`);
  }

  for (const [method, contractMethod] of contractMethods.entries()) {
    const paramType = contractMethod?.param_type;
    requireValue(paramType === null || isNonEmptyString(paramType), errors, `${contractPath} ${method} param_type must be a non-empty string or null.`);
    if (paramType === null) {
      requireValue(contractMethod?.unknown_field_policy === 'no_params', errors, `${contractPath} ${method} no-param methods must declare no_params unknown-field policy.`);
    } else {
      requireValue(contractMethod?.unknown_field_policy === 'rust_deny_unknown_fields', errors, `${contractPath} ${method} params must declare rust_deny_unknown_fields.`);
    }
    requireValue(Array.isArray(contractMethod?.required_fields), errors, `${contractPath} ${method} required_fields must be an array.`);
    requireValue(isNonEmptyString(contractMethod?.unknown_field_policy), errors, `${contractPath} ${method} unknown_field_policy must be explicit.`);
    requireValue(contractMethod?.request_schema && typeof contractMethod.request_schema === 'object', errors, `${contractPath} ${method} request_schema must be present.`);
    requireValue(contractMethod?.result_schema && typeof contractMethod.result_schema === 'object', errors, `${contractPath} ${method} result_schema must be present.`);
    requireValue(isNonEmptyString(contractMethod?.schema_fingerprint), errors, `${contractPath} ${method} schema_fingerprint must be present.`);
    if (paramType !== null) {
      requireValue(contractMethod?.request_schema_ref === `#/type_schemas/${paramType}`, errors, `${contractPath} ${method} must reference its recursive request type schema.`);
      requireValue(Boolean(typeSchemas[paramType]), errors, `${contractPath} type_schemas must include request type ${paramType}.`);
      requireValue(isNonEmptyString(contractMethod?.request_recursive_schema_fingerprint), errors, `${contractPath} ${method} must fingerprint its recursive request schema.`);
    }
    requireValue(contractMethod?.result_schema_ref === `#/type_schemas/${contractMethod?.result_type}`, errors, `${contractPath} ${method} must reference its recursive result type schema.`);
    requireValue(Boolean(typeSchemas[contractMethod?.result_type]), errors, `${contractPath} type_schemas must include result type ${contractMethod?.result_type}.`);
    requireValue(isNonEmptyString(contractMethod?.result_recursive_schema_fingerprint), errors, `${contractPath} ${method} must fingerprint its recursive result schema.`);
    if (paramType !== null) {
      requireValue(isNonEmptyString(contractMethod?.request_schema?.field_shape_fingerprint), errors, `${contractPath} ${method} request_schema must include field_shape_fingerprint.`);
    }
    requireValue(isNonEmptyString(contractMethod?.result_schema?.field_shape_fingerprint), errors, `${contractPath} ${method} result_schema must include field_shape_fingerprint.`);
  }

  const recursiveCoverage = contract.recursive_json_schema_coverage ?? {};
  requireValue(recursiveCoverage.generator === 'schemars', errors, `${contractPath} recursive_json_schema_coverage.generator must be schemars.`);
  requireValue(recursiveCoverage.definition_keyword === '$defs', errors, `${contractPath} recursive schema definitions must use $defs.`);
  requireValue(Object.keys(typeSchemas).length >= contractMethods.size, errors, `${contractPath} type_schemas must cover method param/result types.`);
  const replaceActiveSchema = typeSchemas.ModePackReplaceActiveResult ?? {};
  requireValue(Boolean(replaceActiveSchema.$defs?.ModePackActiveSnapshotSummary), errors, `${contractPath} must recursively define nested ModePackActiveSnapshotSummary.`);
  requireValue(
    replaceActiveSchema.properties?.previous_snapshot?.$ref === '#/$defs/ModePackActiveSnapshotSummary',
    errors,
    `${contractPath} ModePackReplaceActiveResult.previous_snapshot must reference its nested schema definition.`
  );

  const protocolText = textByPath.get('crates/brownie-protocol/src/lib.rs') ?? '';
  requireValue(protocolText.includes('pub mod semantic_contract;'), errors, 'brownie-protocol must expose the semantic_contract module.');
  const publicParams = extractPublicParamStructs(protocolText);
  for (const structName of publicParams) {
    requireValue(hasDenyUnknownForStruct(protocolText, structName), errors, `brownie-protocol ${structName} must deny unknown fields.`);
  }

  const semanticText = textByPath.get('crates/brownie-protocol/src/semantic_contract.rs') ?? '';
  requireValue(semanticText.includes('runtime_semantic_protocol_contract'), errors, 'semantic_contract.rs must retain the Rust generator entrypoint.');
  requireValue(semanticText.includes('runtime-semantic-protocol-contract-v1'), errors, 'semantic_contract.rs must retain the contract id.');

  const binText = textByPath.get('crates/brownie-protocol/src/bin/brownie-protocol-semantic-contract.rs') ?? '';
  requireValue(binText.includes('--check') && binText.includes('--write'), errors, 'brownie-protocol semantic contract binary must support --check and --write.');

  const vsixProtocolText = textByPath.get('extensions/brownie-vsix/src/runtime/protocol.ts') ?? '';
  for (const token of ['isTaskStartParams', 'isTaskCancelParams', 'isTaskRunParams', 'isHeadlessRunDriveParams', 'hasOnlyFields']) {
    requireValue(vsixProtocolText.includes(token), errors, `VSIX protocol validators must retain ${token}.`);
  }

  const vsixTestText = textByPath.get('extensions/brownie-vsix/src/test/semanticProtocolContract.test.ts') ?? '';
  for (const token of [
    'runtime-semantic-protocol-contract.json',
    'validates Rust semantic contract fixtures at the VSIX boundary',
    'rejects unknown fields from semantic contract fixtures',
    'projects VSIX camelCase task.start input to the Rust wire shape',
  ]) {
    requireValue(vsixTestText.includes(token), errors, `VSIX semantic protocol test must retain ${token}.`);
  }

  const unknownPolicy = contract.unknown_field_policy ?? {};
  const contractPublicParams = new Map(
    (Array.isArray(unknownPolicy.rust_public_params) ? unknownPolicy.rust_public_params : []).map((entry) => [entry?.type, entry])
  );
  requireValue(contractPublicParams.size === publicParams.size, errors, `${contractPath} unknown_field_policy.rust_public_params must cover every public Runtime *Params type.`);
  for (const structName of publicParams) {
    requireValue(
      contractPublicParams.get(structName)?.deny_unknown_fields === true,
      errors,
      `${contractPath} unknown_field_policy.rust_public_params must include deny_unknown_fields evidence for ${structName}.`
    );
  }
  for (const testName of ['semantic_contract_artifact_matches_rust_generator', 'public_runtime_params_reject_unknown_fields', 'rejects unknown fields from semantic contract fixtures']) {
    requireValue(
      Array.isArray(unknownPolicy.tests) && unknownPolicy.tests.includes(testName),
      errors,
      `${contractPath} unknown_field_policy.tests must include ${testName}.`
    );
  }

  const fixtures = contract.golden_fixtures ?? {};
  for (const fixtureName of [
    'task_start_vsix_client_input',
    'task_start_wire_params',
    'task_start_result',
    'task_cancel_params',
    'task_cancel_result',
    'task_run_minimal_params',
    'task_run_explicit_null_params',
    'ledger_event_summary',
    'ledger_event_with_payload_envelope',
    'task_status_values',
  ]) {
    requireValue(fixtures[fixtureName] !== undefined, errors, `${contractPath} golden_fixtures must include ${fixtureName}.`);
  }
  requireValue(fixtures.task_start_wire_params?.mode_id === 'orchestrator', errors, `${contractPath} task_start wire fixture must use mode_id.`);
  requireValue(fixtures.task_start_vsix_client_input?.modeId === 'orchestrator', errors, `${contractPath} task_start VSIX fixture must use modeId.`);
  requireValue(Array.isArray(fixtures.task_status_values) && fixtures.task_status_values.includes('Cancelled'), errors, `${contractPath} must cover TaskStatus values.`);

  const durableCoupling = contract.durable_event_migration_coupling ?? {};
  const storeText = textByPath.get('crates/brownie-store/src/lib.rs') ?? '';
  const ledgerVariants = extractEnumVariants(storeText, 'LedgerEventKind');
  requireValue(durableCoupling.store_schema_version === 2, errors, `${contractPath} durable_event_migration_coupling.store_schema_version must be 2.`);
  requireValue(durableCoupling.ledger_event_kind_source === 'crates/brownie-store/src/lib.rs', errors, `${contractPath} must bind durable event kinds to brownie-store.`);
  requireValue(durableCoupling.ledger_payload_envelope_type === 'LedgerPayloadEnvelope', errors, `${contractPath} must bind durable event payloads to LedgerPayloadEnvelope.`);
  requireValue(durableCoupling.ledger_payload_envelope_field === 'payload_envelope', errors, `${contractPath} must bind durable event payloads to payload_envelope.`);
  requireValue(durableCoupling.ledger_payload_schema_version_source === 'LEDGER_PAYLOAD_SCHEMA_VERSION', errors, `${contractPath} must bind durable event payload schema versions to LEDGER_PAYLOAD_SCHEMA_VERSION.`);
  requireValue(durableCoupling.ledger_payload_shape_version_source === 'LEDGER_PAYLOAD_SHAPE_VERSION', errors, `${contractPath} must bind durable event payload shape versions to LEDGER_PAYLOAD_SHAPE_VERSION.`);
  for (const token of ['LedgerPayloadEnvelope', 'payload_envelope', 'LEDGER_PAYLOAD_SCHEMA_VERSION', 'schema_fingerprint', 'instance_shape_fingerprint', 'LedgerPayloadSchemaClassification', 'ledger_payload_schema_classification', 'validate_task_completed_payload_schema', 'ledger_payload_schema_fingerprint', 'ledger_payload_instance_shape_fingerprint_for_value', 'validate_ledger_payload_envelope']) {
    requireValue(hasIdentifier(storeText, token), errors, `brownie-store durable ledger payload shape evidence must retain ${token}.`);
  }
  requireValue(typeof durableCoupling.policy === 'string' && durableCoupling.policy.includes('schema migration'), errors, `${contractPath} durable event changes must require migration policy.`);
  requireValue(
    typeof durableCoupling.ledger_payload_schema_fingerprint_basis === 'string' &&
      durableCoupling.ledger_payload_schema_fingerprint_basis.includes('fixed Runtime-owned payload schema descriptor'),
    errors,
    `${contractPath} durable coupling must state that schema fingerprints are fixed contract evidence.`
  );
  requireValue(
    typeof durableCoupling.ledger_payload_instance_shape_fingerprint_basis === 'string' &&
      durableCoupling.ledger_payload_instance_shape_fingerprint_basis.includes('actual persisted payload value'),
    errors,
    `${contractPath} durable coupling must state that instance fingerprints are diagnostic payload evidence.`
  );
  const contractScope = durableCoupling.ledger_payload_contract_scope ?? {};
  requireValue(contractScope.jsonrpc_request_result_contract === 'closed', errors, `${contractPath} must keep JSON-RPC request/result contract closed.`);
  requireValue(contractScope.schema_and_instance_fingerprint_split === 'closed', errors, `${contractPath} must keep ledger schema/instance fingerprint split closed.`);
  requireValue(contractScope.ledger_event_payload_inventory === 'closed', errors, `${contractPath} must close ledger event payload inventory.`);
  requireValue(contractScope.ledger_event_payload_typed_schema_coverage === 'partial', errors, `${contractPath} must keep full ledger payload typed schema coverage partial until all open payload contracts close.`);
  requireValue(
    typeof durableCoupling.ledger_payload_schema_classification_policy === 'string' &&
      durableCoupling.ledger_payload_schema_classification_policy.includes('Every LedgerEventKind'),
    errors,
    `${contractPath} durable coupling must require explicit LedgerEventKind payload schema classifications.`
  );
  requireValue(
    Number.isInteger(durableCoupling.release_blocking_open_payload_count) &&
      durableCoupling.release_blocking_open_payload_count > 0,
    errors,
    `${contractPath} must retain release_blocking_open_payload_count while ledger payload schemas remain partial.`
  );
  requireValue(
    durableCoupling.event_payload_schema_classification_count === ledgerVariants.length,
    errors,
    `${contractPath} durable event schema classification count must match LedgerEventKind variants.`
  );
  const classificationByKind = new Map(
    (Array.isArray(durableCoupling.event_payload_schema_classifications) ? durableCoupling.event_payload_schema_classifications : []).map((entry) => [entry?.ledger_event_kind, entry])
  );
  for (const variant of ledgerVariants) {
    const entry = classificationByKind.get(variant);
    requireValue(Boolean(entry), errors, `${contractPath} durable_event_migration_coupling.event_payload_schema_classifications must include ${variant}.`);
    requireValue(
      ['payload_absent', 'strict_typed', 'typed_known_fields_open', 'versioned_open', 'legacy_compatibility_only'].includes(entry?.payload_schema_classification),
      errors,
      `${contractPath} ${variant} payload_schema_classification must be explicit.`
    );
    requireValue(
      ['closed', 'partial', 'legacy_only'].includes(entry?.payload_schema_contract_status),
      errors,
      `${contractPath} ${variant} payload_schema_contract_status must be explicit.`
    );
  }
  requireValue(durableCoupling.event_payload_schema_fingerprint_count === ledgerVariants.length, errors, `${contractPath} durable event schema fingerprint count must match LedgerEventKind variants.`);
  const fingerprintByKind = new Map(
    (Array.isArray(durableCoupling.event_payload_schema_fingerprints) ? durableCoupling.event_payload_schema_fingerprints : []).map((entry) => [entry?.ledger_event_kind, entry])
  );
  for (const variant of ledgerVariants) {
    const entry = fingerprintByKind.get(variant);
    requireValue(Boolean(entry), errors, `${contractPath} durable_event_migration_coupling.event_payload_schema_fingerprints must include ${variant}.`);
    requireValue(entry?.payload_schema_version === 2, errors, `${contractPath} ${variant} payload_schema_version must be 2.`);
    requireValue(entry?.store_schema_version === durableCoupling.store_schema_version, errors, `${contractPath} ${variant} store_schema_version must match durable coupling schema version.`);
    requireValue(isNonEmptyString(entry?.payload_schema_id), errors, `${contractPath} ${variant} payload_schema_id must be present.`);
    requireValue(isNonEmptyString(entry?.payload_schema_fingerprint), errors, `${contractPath} ${variant} payload_schema_fingerprint must be present.`);
    requireValue(isNonEmptyString(entry?.payload_schema_descriptor), errors, `${contractPath} ${variant} payload_schema_descriptor must be present.`);
    requireValue(!entry?.payload_schema_descriptor?.startsWith('any{'), errors, `${contractPath} ${variant} payload schema descriptor must not use any fallback.`);
    requireValue(
      entry?.payload_schema_classification === classificationByKind.get(variant)?.payload_schema_classification,
      errors,
      `${contractPath} ${variant} fingerprint entry classification must match inventory.`
    );
    if (['typed_known_fields_open', 'versioned_open'].includes(entry?.payload_schema_classification)) {
      requireValue(entry?.release_blocking_until_typed === true, errors, `${contractPath} ${variant} open payload schema must remain release-blocking.`);
      requireValue(entry?.payload_schema_contract_status === 'partial', errors, `${contractPath} ${variant} open payload schema must be partial.`);
    }
  }
  requireValue(
    fingerprintByKind.get('TaskCompleted')?.payload_schema_classification === 'typed_known_fields_open',
    errors,
    `${contractPath} TaskCompleted must be classified as typed_known_fields_open until it rejects unknown fields.`
  );
  requireValue(
    fingerprintByKind.get('TaskCompleted')?.payload_schema_descriptor?.includes('known_field_required:true'),
    errors,
    `${contractPath} TaskCompleted payload schema descriptor must require at least one known bounded terminal evidence field.`
  );
  const schemaFixtures = Array.isArray(durableCoupling.payload_schema_fixtures) ? durableCoupling.payload_schema_fixtures : [];
  const taskCompletedFixtures = schemaFixtures.filter((fixture) => fixture?.ledger_event_kind === 'TaskCompleted');
  requireValue(taskCompletedFixtures.length >= 2, errors, `${contractPath} must include TaskCompleted payload schema/instance split fixtures.`);
  requireValue(
    new Set(taskCompletedFixtures.map((fixture) => fixture?.payload_schema_fingerprint)).size === 1,
    errors,
    `${contractPath} payload schema fixtures must keep one fixed contract schema fingerprint across allowed instance variation.`
  );
  requireValue(
    new Set(taskCompletedFixtures.map((fixture) => fixture?.payload_instance_shape_fingerprint)).size >= 2,
    errors,
    `${contractPath} payload schema fixtures must keep diagnostic instance shape fingerprints separate from schema fingerprints.`
  );

  if (options.skipRustGeneratedContractCheck !== true) {
    runRustSemanticContractCheck(repoRoot, contractPath, errors);
  }

  return errors;
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
  const semanticContractPath = options.semanticContractPath ?? process.env.BROWNIE_SEMANTIC_PROTOCOL_CONTRACT ?? defaultSemanticContractPath;
  const readErrors = [];
  const map = options.map ?? readJson(repoRoot, mapPath, readErrors);
  const semanticContract = options.semanticContract ?? readJson(repoRoot, semanticContractPath, readErrors);
  const errors = [
    ...readErrors,
    ...validateRuntimeProtocolEventCanonicalMap(map, { repoRoot, mapPath, textByPath: options.textByPath }),
    ...validateRuntimeSemanticProtocolContract(semanticContract, map, {
      repoRoot,
      contractPath: semanticContractPath,
      mapPath,
      textByPath: options.textByPath,
      skipRustGeneratedContractCheck: options.skipRustGeneratedContractCheck,
    })
  ];
  return { errors, mapPath, semanticContractPath };
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

  console.log(`Protocol/event canonization guard passed for ${result.mapPath} and ${result.semanticContractPath}.`);
}
