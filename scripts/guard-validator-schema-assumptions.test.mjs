import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateValidatorSchemaAssumptions } from './guard-validator-schema-assumptions.mjs';

function tempRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-validator-schema-'));
  fs.mkdirSync(path.join(repoRoot, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'docs/architecture'), { recursive: true });
  return repoRoot;
}

test('rejects validator assumptions that require missing target top-level fields', () => {
  const repoRoot = tempRepo();
  try {
    fs.writeFileSync(
      path.join(repoRoot, 'docs/architecture/runtime-release-readiness-audit.json'),
      JSON.stringify({ schema_version: 1, ledger_event_kind: { values: [] } }, null, 2)
    );
    fs.writeFileSync(
      path.join(repoRoot, 'scripts/validate-audit-schema.mjs'),
      'export function validateAuditDocument(doc) { return Array.isArray(doc.events) && doc.fingerprint; }\n'
    );
    const errors = validateValidatorSchemaAssumptions({ repoRoot });
    assert(errors.some((error) => error.includes('"events"')), errors.join('\n'));
    assert(errors.some((error) => error.includes('"fingerprint"')), errors.join('\n'));
    assert(errors.some((error) => error.includes('invented schema')), errors.join('\n'));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('accepts validator assumptions that match the target shape', () => {
  const repoRoot = tempRepo();
  try {
    fs.writeFileSync(
      path.join(repoRoot, 'docs/architecture/runtime-release-readiness-audit.json'),
      JSON.stringify({ schema_version: 1, ledger_event_kind: { values: [] } }, null, 2)
    );
    fs.writeFileSync(
      path.join(repoRoot, 'scripts/validate-audit-schema.mjs'),
      'export function validateAuditDocument(doc) { return doc.schema_version === 1 && doc.ledger_event_kind; }\n'
    );
    assert.deepEqual(validateValidatorSchemaAssumptions({ repoRoot }), []);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
