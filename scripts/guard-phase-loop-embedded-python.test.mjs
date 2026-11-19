import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { extractPythonHeredocs, validateEmbeddedPythonText } from './guard-phase-loop-embedded-python.mjs';

test('compiler timeout rejects a stalled child and closes its regular-file input', () => {
  let descriptor;
  let result;
  const errors = validateEmbeddedPythonText("python3 - <<'PY'\nprint('safe')\nPY\n", {
    compileTimeoutMs: 100,
    spawnSync(command, args, options) {
      assert.equal(command, 'python3');
      descriptor = options.stdio[0];
      assert.ok(fs.fstatSync(descriptor).isFile());
      assert.equal(fs.readFileSync(descriptor, 'utf8'), "print('safe')");
      result = spawnSync(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options);
      return result;
    }
  });
  assert.equal(result.error?.code, 'ETIMEDOUT');
  assert.ok(errors.some(error => error.includes('ETIMEDOUT')), errors);
  assert.throws(() => fs.fstatSync(descriptor), { code: 'EBADF' });
});

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
