import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { repairValidatorSchemaAssumptions } from './repair-validator-schema-assumptions.mjs';

function tempRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-validator-repair-'));
  fs.mkdirSync(path.join(repoRoot, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'docs/architecture'), { recursive: true });
  return repoRoot;
}

test('generates exact function replacement from target JSON shape', () => {
  const repoRoot = tempRepo();
  try {
    fs.writeFileSync(
      path.join(repoRoot, 'docs/architecture/runtime-release-readiness-audit.json'),
      JSON.stringify({
        schema_version: 1,
        phase: 'RRP-test',
        repository: 'globalpocket/brownie',
        runtime_release_ready: false,
        release_ready_blocked_by: ['evidence'],
        ledger_event_kind: { values: ['RuntimeStarted', 'RuntimeStopped'] },
        classifications: [{ kind: 'strict_typed' }],
        blockers: [],
        release_blockers: []
      }, null, 2)
    );
    const oldFunction = `function validateAuditDocument(doc) {
  const errors = [];
  if (!Array.isArray(doc.events)) errors.push('events');
  if (!doc.fingerprint) errors.push('fingerprint');
  return errors;
}`;
    fs.writeFileSync(
      path.join(repoRoot, 'scripts/validate-audit-schema.mjs'),
      `${oldFunction}\n\nmain();\n`
    );

    const repair = repairValidatorSchemaAssumptions({ repoRoot });
    assert.equal(repair.repairable, true);
    assert.equal(repair.path, 'scripts/validate-audit-schema.mjs');
    assert.equal(repair.old_text, oldFunction);
    assert(repair.new_text.includes('ledger_event_kind.values'), repair.new_text);
    assert(repair.new_text.includes('classifications'), repair.new_text);
    assert(!repair.new_text.includes('doc.events'), repair.new_text);
    assert(!repair.new_text.includes('doc.fingerprint'), repair.new_text);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('reports unrepairable when validateAuditDocument is absent', () => {
  const repoRoot = tempRepo();
  try {
    fs.writeFileSync(
      path.join(repoRoot, 'docs/architecture/runtime-release-readiness-audit.json'),
      JSON.stringify({ schema_version: 1 }, null, 2)
    );
    fs.writeFileSync(path.join(repoRoot, 'scripts/validate-audit-schema.mjs'), 'main();\n');
    const repair = repairValidatorSchemaAssumptions({ repoRoot });
    assert.equal(repair.repairable, false);
    assert.equal(repair.reason, 'validateAuditDocument_not_found');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('generates exact removal for unreferenced helpers that require missing target fields', () => {
  const repoRoot = tempRepo();
  try {
    fs.writeFileSync(
      path.join(repoRoot, 'docs/architecture/runtime-release-readiness-audit.json'),
      JSON.stringify({ schema_version: 1, classifications: [] }, null, 2)
    );
    const staleHelper = `function validateFingerprint(doc) {
  return typeof doc.schema_fingerprint === 'string';
}`;
    fs.writeFileSync(
      path.join(repoRoot, 'scripts/validate-audit-schema.mjs'),
      `${staleHelper}\n\nfunction validateAuditDocument(doc) {\n  return doc.schema_version === 1 ? [] : ['bad'];\n}\n\nmain();\n`
    );
    const repair = repairValidatorSchemaAssumptions({ repoRoot });
    assert.equal(repair.repairable, true);
    assert.equal(repair.reason, 'validator_stale_schema_helper_mismatch');
    assert.equal(repair.old_text, `${staleHelper}\n\n`);
    assert.equal(repair.new_text, '');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
