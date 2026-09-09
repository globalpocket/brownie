#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { requiredReleaseGateCommands } from './release-gate.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

const DEFAULT_CONTRACT_PATH = 'docs/architecture/runtime-semantic-protocol-contract.json';
const DEFAULT_STORE_PATH = 'crates/brownie-store/src/lib.rs';
const DEFAULT_SEMANTIC_SOURCE_PATH = 'crates/brownie-protocol/src/semantic_contract.rs';
const DEFAULT_PACKAGE_PATH = 'package.json';
const DEFAULT_VSIX_PACKAGE_PATH = 'extensions/brownie-vsix/package.json';
const DEFAULT_CI_PATH = '.github/workflows/ci.yml';

const GUARD_COMMAND = 'pnpm --workspace-root guard:ledger-contract-single-source';
const TEST_COMMAND = 'pnpm --workspace-root guard:ledger-contract-single-source:test';

const allowedClassifications = new Set([
  'payload_absent',
  'strict_typed',
  'typed_known_fields_open',
  'versioned_open',
  'legacy_compatibility_only'
]);

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

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function extractEnumVariants(text, enumName) {
  const match = text.match(new RegExp(`pub\\s+enum\\s+${enumName}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`));
  if (!match) {
    return [];
  }
  return match[1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim().replace(/,$/, ''))
    .filter((line) => /^[A-Z][A-Za-z0-9_]*$/.test(line));
}

function extractFunctionBody(text, functionName) {
  const start = text.indexOf(`fn ${functionName}`);
  if (start === -1) {
    return '';
  }
  const bodyStart = text.indexOf('{', start);
  if (bodyStart === -1) {
    return '';
  }
  let depth = 0;
  for (let index = bodyStart; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(bodyStart + 1, index);
      }
    }
  }
  return '';
}

function extractLedgerEventKindReferences(text) {
  return new Set([...text.matchAll(/\bLedgerEventKind::([A-Z][A-Za-z0-9_]*)\b/g)].map((match) => match[1]));
}

function commandString(entry) {
  return [entry.command, ...(entry.args ?? [])].join(' ');
}

function splitScriptCommands(script) {
  return String(script ?? '')
    .split('&&')
    .map((part) => part.trim())
    .filter(Boolean);
}

function hasExactScriptCommand(script, command) {
  return splitScriptCommands(script).includes(command);
}

function validateWiring({ packageJson, vsixPackageJson, ciText, releaseGateCommands }, errors) {
  requireValue(
    packageJson.scripts?.['guard:ledger-contract-single-source'] ===
      'node scripts/guard-ledger-contract-single-source.mjs',
    errors,
    `${DEFAULT_PACKAGE_PATH} must define guard:ledger-contract-single-source.`
  );
  requireValue(
    packageJson.scripts?.['guard:ledger-contract-single-source:test'] ===
      'node --test scripts/guard-ledger-contract-single-source.test.mjs',
    errors,
    `${DEFAULT_PACKAGE_PATH} must define guard:ledger-contract-single-source:test.`
  );
  requireValue(
    hasExactScriptCommand(vsixPackageJson.scripts?.check, GUARD_COMMAND),
    errors,
    `${DEFAULT_VSIX_PACKAGE_PATH} check must invoke ${GUARD_COMMAND}.`
  );
  requireValue(
    hasExactScriptCommand(vsixPackageJson.scripts?.check, TEST_COMMAND),
    errors,
    `${DEFAULT_VSIX_PACKAGE_PATH} check must invoke ${TEST_COMMAND}.`
  );
  const releaseGateCommandSet = new Set((releaseGateCommands ?? []).map(commandString));
  requireValue(
    releaseGateCommandSet.has(GUARD_COMMAND),
    errors,
    `release:gate required commands must include ${GUARD_COMMAND}.`
  );
  requireValue(
    releaseGateCommandSet.has(TEST_COMMAND),
    errors,
    `release:gate required commands must include ${TEST_COMMAND}.`
  );
  requireValue(
    String(ciText ?? '').includes('pnpm --filter brownie-vsix check'),
    errors,
    `${DEFAULT_CI_PATH} must keep the VSIX check path that gates Ledger Contract single-source validation.`
  );
}

export function validateLedgerContractSingleSource(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const errors = [];
  const contract =
    options.contract ?? readJson(repoRoot, options.contractPath ?? DEFAULT_CONTRACT_PATH, errors);
  const storeText =
    options.storeText ?? readText(repoRoot, options.storePath ?? DEFAULT_STORE_PATH, errors);
  const semanticSourceText =
    options.semanticSourceText ??
    readText(repoRoot, options.semanticSourcePath ?? DEFAULT_SEMANTIC_SOURCE_PATH, errors);
  const packageJson =
    options.packageJson ?? readJson(repoRoot, options.packagePath ?? DEFAULT_PACKAGE_PATH, errors);
  const vsixPackageJson =
    options.vsixPackageJson ??
    readJson(repoRoot, options.vsixPackagePath ?? DEFAULT_VSIX_PACKAGE_PATH, errors);
  const ciText = options.ciText ?? readText(repoRoot, options.ciPath ?? DEFAULT_CI_PATH, errors);
  const releaseGateCommands = options.releaseGateCommands ?? requiredReleaseGateCommands;

  const coupling = contract.durable_event_migration_coupling ?? {};
  requireValue(
    contract.generated_by?.module === 'brownie_protocol::semantic_contract',
    errors,
    `${DEFAULT_CONTRACT_PATH} must be generated by brownie_protocol::semantic_contract.`
  );
  requireValue(
    coupling.ledger_event_kind_source === DEFAULT_STORE_PATH,
    errors,
    `${DEFAULT_CONTRACT_PATH} must bind ledger event kinds to ${DEFAULT_STORE_PATH}.`
  );
  requireValue(
    coupling.ledger_payload_schema_version_source ===
      'brownie_protocol::semantic_contract::ledger_payload_schema_version(kind)',
    errors,
    `${DEFAULT_CONTRACT_PATH} must bind schema versions to brownie_protocol::semantic_contract.`
  );
  requireValue(
    coupling.ledger_payload_contract_scope?.ledger_event_payload_typed_schema_coverage === 'closed',
    errors,
    `${DEFAULT_CONTRACT_PATH} must keep ledger_event_payload_typed_schema_coverage closed.`
  );

  const variants = extractEnumVariants(storeText, 'LedgerEventKind');
  requireValue(variants.length > 0, errors, `${DEFAULT_STORE_PATH} must define LedgerEventKind variants.`);
  const variantSet = new Set(variants);
  const strictValidatorVariants = extractLedgerEventKindReferences(
    extractFunctionBody(storeText, 'validate_strict_ledger_payload_schema')
  );
  const classificationByKind = new Map(
    (Array.isArray(coupling.event_payload_schema_classifications)
      ? coupling.event_payload_schema_classifications
      : []
    ).map((entry) => [entry?.ledger_event_kind, entry])
  );
  const fingerprintByKind = new Map(
    (Array.isArray(coupling.event_payload_schema_fingerprints)
      ? coupling.event_payload_schema_fingerprints
      : []
    ).map((entry) => [entry?.ledger_event_kind, entry])
  );
  const fixturesByKind = new Map();
  for (const fixture of Array.isArray(coupling.payload_schema_fixtures)
    ? coupling.payload_schema_fixtures
    : []) {
    const kind = fixture?.ledger_event_kind;
    if (!fixturesByKind.has(kind)) {
      fixturesByKind.set(kind, []);
    }
    fixturesByKind.get(kind).push(fixture);
  }

  requireValue(
    coupling.event_payload_schema_classification_count === variants.length,
    errors,
    `${DEFAULT_CONTRACT_PATH} classification count must match LedgerEventKind variant count.`
  );
  requireValue(
    coupling.event_payload_schema_fingerprint_count === variants.length,
    errors,
    `${DEFAULT_CONTRACT_PATH} fingerprint count must match LedgerEventKind variant count.`
  );
  requireValue(
    coupling.release_blocking_open_payload_count === 0,
    errors,
    `${DEFAULT_CONTRACT_PATH} must not leave any release-blocking open ledger payload schema.`
  );

  for (const kind of classificationByKind.keys()) {
    requireValue(variantSet.has(kind), errors, `${DEFAULT_CONTRACT_PATH} classifies unknown ledger event kind ${kind}.`);
  }
  for (const kind of fingerprintByKind.keys()) {
    requireValue(variantSet.has(kind), errors, `${DEFAULT_CONTRACT_PATH} fingerprints unknown ledger event kind ${kind}.`);
  }
  for (const kind of fixturesByKind.keys()) {
    requireValue(variantSet.has(kind), errors, `${DEFAULT_CONTRACT_PATH} fixtures unknown ledger event kind ${kind}.`);
  }

  for (const kind of variants) {
    const classification = classificationByKind.get(kind);
    const fingerprint = fingerprintByKind.get(kind);
    requireValue(Boolean(classification), errors, `${kind} must have a payload schema classification.`);
    requireValue(Boolean(fingerprint), errors, `${kind} must have a payload schema fingerprint entry.`);
    const className = classification?.payload_schema_classification;
    requireValue(allowedClassifications.has(className), errors, `${kind} classification must be explicit.`);
    requireValue(classification?.release_blocking_until_typed === false, errors, `${kind} must not be release-blocking after typed closure.`);
    requireValue(
      fingerprint?.payload_schema_classification === className,
      errors,
      `${kind} fingerprint classification must match the classification inventory.`
    );
    requireValue(
      fingerprint?.payload_schema_contract_status === classification?.payload_schema_contract_status,
      errors,
      `${kind} fingerprint contract status must match the classification inventory.`
    );
    requireValue(
      fingerprint?.payload_schema_id === `ledger_payload.${kind}.v${fingerprint?.payload_schema_version}`,
      errors,
      `${kind} payload schema id must be derived from event kind and schema version.`
    );
    requireValue(
      isNonEmptyString(fingerprint?.payload_schema_descriptor) &&
        !fingerprint.payload_schema_descriptor.startsWith('any{'),
      errors,
      `${kind} payload schema descriptor must be explicit and not fallback-any.`
    );
    requireValue(
      isNonEmptyString(fingerprint?.payload_schema_fingerprint) &&
        fingerprint.payload_schema_fingerprint.startsWith('shape-fnv1a64:'),
      errors,
      `${kind} payload schema fingerprint must be present.`
    );
    requireValue(
      semanticSourceText.includes(`"${kind}"`),
      errors,
      `${DEFAULT_SEMANTIC_SOURCE_PATH} must name ${kind} in the canonical schema registry.`
    );
    if (className === 'strict_typed') {
      requireValue(strictValidatorVariants.has(kind), errors, `${kind} strict_typed payload must be wired into validate_strict_ledger_payload_schema.`);
      requireValue(
        fingerprint?.payload_schema_descriptor?.includes('additional_fields:false'),
        errors,
        `${kind} strict_typed descriptor must reject additional fields.`
      );
      requireValue(
        (fixturesByKind.get(kind) ?? []).length > 0,
        errors,
        `${kind} strict_typed payload must have at least one generated schema fixture.`
      );
    }
    if (className === 'payload_absent') {
      requireValue(!strictValidatorVariants.has(kind), errors, `${kind} payload_absent event must not be wired as strict payload validator.`);
    }
  }

  for (const kind of strictValidatorVariants) {
    requireValue(variantSet.has(kind), errors, `validate_strict_ledger_payload_schema references unknown ${kind}.`);
    requireValue(
      classificationByKind.get(kind)?.payload_schema_classification === 'strict_typed',
      errors,
      `validate_strict_ledger_payload_schema must only dispatch strict_typed payloads; ${kind} is not strict_typed.`
    );
  }

  for (const [kind, fixtures] of fixturesByKind) {
    const fingerprint = fingerprintByKind.get(kind);
    for (const fixture of fixtures) {
      requireValue(
        fixture?.payload_schema_classification === fingerprint?.payload_schema_classification,
        errors,
        `${kind} fixture classification must match fingerprint entry.`
      );
      requireValue(fixture?.payload_schema_id === fingerprint?.payload_schema_id, errors, `${kind} fixture schema id must match fingerprint entry.`);
      requireValue(
        fixture?.payload_schema_fingerprint === fingerprint?.payload_schema_fingerprint,
        errors,
        `${kind} fixture schema fingerprint must match fingerprint entry.`
      );
      requireValue(
        isNonEmptyString(fixture?.payload_instance_shape_fingerprint) &&
          fixture.payload_instance_shape_fingerprint.startsWith('shape-fnv1a64:'),
        errors,
        `${kind} fixture must carry a diagnostic instance-shape fingerprint.`
      );
      if (fingerprint?.payload_schema_classification === 'strict_typed') {
        requireValue(
          fixture?.payload && typeof fixture.payload === 'object' && !Array.isArray(fixture.payload),
          errors,
          `${kind} strict_typed fixture payload must be an object.`
        );
      }
    }
  }

  validateWiring({ packageJson, vsixPackageJson, ciText, releaseGateCommands }, errors);
  return errors;
}

export function runLedgerContractSingleSourceGuard() {
  const errors = validateLedgerContractSingleSource();
  if (errors.length > 0) {
    throw new Error(`Ledger Contract single-source guard failed:\n- ${errors.join('\n- ')}`);
  }
  console.log('Ledger Contract single-source guard passed.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runLedgerContractSingleSourceGuard();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
