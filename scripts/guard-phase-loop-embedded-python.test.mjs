import assert from 'node:assert/strict';
import test from 'node:test';

import { extractPythonHeredocs, validateEmbeddedPythonText } from './guard-phase-loop-embedded-python.mjs';

test('extracts Python heredocs from phase-loop shell text', () => {
  const text = `#!/usr/bin/env bash
python3 - <<'PY'
print("one")
PY
node - <<'JS'
console.log("ignored")
JS
python - <<PY
print("two")
PY
`;

  const blocks = extractPythonHeredocs(text);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].code, 'print("one")');
  assert.equal(blocks[1].code, 'print("two")');
});

test('rejects embedded Python that uses re without importing it', () => {
  const text = `python3 - <<'PY'
import json
print(re.findall(r"a", "a"))
PY
`;

  const errors = validateEmbeddedPythonText(text, { sourcePath: 'fixture.sh' });
  assert(errors.some((error) => error.includes("uses 're.' but does not import re")), errors);
});

test('accepts embedded Python that imports re before using it', () => {
  const text = `python3 - <<'PY'
import json
import re
print(re.findall(r"a", "a"))
PY
`;

  assert.deepEqual(validateEmbeddedPythonText(text, { sourcePath: 'fixture.sh' }), []);
});

test('rejects embedded Python syntax errors before runtime', () => {
  const text = `python3 - <<'PY'
def broken(
PY
`;

  const errors = validateEmbeddedPythonText(text, { sourcePath: 'fixture.sh' });
  assert(errors.some((error) => error.includes('Python syntax check failed')), errors);
});
