import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateJsonParse } from './guard-json-parse.mjs';

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-json-parse-'));
}

test('accepts valid JSON', () => {
  const repoRoot = tempRepo();
  try {
    fs.writeFileSync(path.join(repoRoot, 'ok.json'), JSON.stringify({ ok: true }, null, 2));
    assert.deepEqual(validateJsonParse({ repoRoot, filePath: 'ok.json' }), []);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('reports line and column for malformed JSON', () => {
  const repoRoot = tempRepo();
  try {
    fs.writeFileSync(path.join(repoRoot, 'bad.json'), '{\n  "ok": true\n}\n{"extra": true}\n');
    const errors = validateJsonParse({ repoRoot, filePath: 'bad.json' });
    assert(errors.length > 0);
    assert.equal(errors[0].line, 4);
    assert.equal(errors[0].column, 1);
    assert.match(errors[0].message, /line 4, column 1/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
