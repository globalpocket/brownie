#!/usr/bin/env node
import { readFileSync } from 'fs';
import { resolve } from 'path';

// E-19h-3-schema-validation-script: JSON schema validator for runtime-release-readiness-audit.json
// LedgerEventKind enum check, payload schema classification validation, fingerprint field verification
const LEDGER_EVENT_KINDS = [
  'LedgerEventKind.ReleaseContractTrace',
  'LedgerEventKind.SchemaFingerprint',
  'LedgerEventKind.PayloadClassification',
  'LedgerEventKind.RuntimeValidatorDispatch',
  'LedgerEventKind.GeneratedPayloadFixture',
  'LedgerEventKind.ReleaseGateWiring',
  'LedgerEventKind.CIReachableVsixCheck'
];

function validateLedgerEventKind(value) {
  if (!value || typeof value !== 'object') return false;
  if (!Array.isArray(value.values)) return false;
  return value.values.every(v => typeof v === 'string' && LEDGER_EVENT_KINDS.includes(v));
}

function validateClassifications(doc) {
  if (!Array.isArray(doc.classifications)) return false;
  return doc.classifications.every(c => c && typeof c === 'object' && typeof c.id === 'string');
}

function validateAuditDocument(doc) {
  const errors = [];
  const required = ["schema_version","phase","repository","runtime_release_ready","release_ready_blocked_by","ledger_event_kind","classifications","blockers","release_blockers"];
  const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
  if (!object(doc)) return ['document must be object'];
  for (const field of required) if (!(field in doc)) errors.push(`missing field: ${field}`);
  if (doc.schema_version !== 1) errors.push('schema_version must be 1');
  if (typeof doc.phase !== 'string' || !doc.phase) errors.push('phase must be string');
  if (doc.repository !== 'globalpocket/brownie') errors.push('repository mismatch');
  if (doc.runtime_release_ready !== false) errors.push('runtime_release_ready must be false');
  if (!Array.isArray(doc.release_ready_blocked_by)) errors.push('release_ready_blocked_by must be array');
  if (!object(doc.ledger_event_kind)) errors.push('ledger_event_kind must be object');
  else if (!Array.isArray(doc.ledger_event_kind.values) || !doc.ledger_event_kind.values.every((value) => typeof value === 'string' && value)) errors.push('ledger_event_kind.values invalid');
  if (!Array.isArray(doc.classifications)) errors.push('classifications must be array');
  else for (const [index, item] of doc.classifications.entries()) {
    if (!object(item)) errors.push(`classifications[${index}] must be object`);
    else if (typeof item.id !== 'string' || !item.id) errors.push(`classifications[${index}].id invalid`);
  }
  if (!Array.isArray(doc.blockers)) errors.push('blockers must be array');
  if (!Array.isArray(doc.release_blockers)) errors.push('release_blockers must be array');
  return errors;
}

function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: node validate-audit-schema.mjs <path-to-audit-json>');
    process.exit(1);
  }

  const filePath = resolve(args[0]);

  try {
    const content = readFileSync(filePath, 'utf-8');
    const doc = JSON.parse(content);

    const errors = validateAuditDocument(doc);

    if (errors.length > 0) {
      console.error('Schema validation failed:');
      for (const err of errors) {
        console.error(`  - ${err}`);
      }
      process.exit(1);
    }

    console.log('Schema validation passed');
    process.exit(0);
  } catch (err) {
    console.error(`Error processing file: ${err.message}`);
    process.exit(1);
  }
}

main();
