import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { validateAddedFunctionReachability } from './guard-js-added-function-reachability.mjs';

function run(repoRoot, args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function tempRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-js-reachability-'));
  run(repoRoot, ['init']);
  run(repoRoot, ['config', 'user.name', 'Test']);
  run(repoRoot, ['config', 'user.email', 'test@example.com']);
  fs.mkdirSync(path.join(repoRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'scripts/example.mjs'), 'function existing() { return true; }\nexisting();\n');
  run(repoRoot, ['add', '.']);
  run(repoRoot, ['commit', '-m', 'base']);
  const baseRef = run(repoRoot, ['rev-parse', 'HEAD']);
  return { repoRoot, baseRef };
}

test('rejects a newly added function that is never called', () => {
  const { repoRoot, baseRef } = tempRepo();
  fs.appendFileSync(path.join(repoRoot, 'scripts/example.mjs'), '\nfunction validateNeverConnected(value) { return Boolean(value); }\n');
  const result = validateAddedFunctionReachability({ repoRoot, baseRef });
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.function_name === 'validateNeverConnected'));
});

test('accepts a newly added function that is connected to an execution path', () => {
  const { repoRoot, baseRef } = tempRepo();
  fs.appendFileSync(
    path.join(repoRoot, 'scripts/example.mjs'),
    '\nfunction validateConnected(value) { return Boolean(value); }\nvalidateConnected(true);\n'
  );
  const result = validateAddedFunctionReachability({ repoRoot, baseRef });
  assert.equal(result.valid, true);
});

test('accepts a newly added exported function covered by a test import', () => {
  const { repoRoot, baseRef } = tempRepo();
  fs.writeFileSync(
    path.join(repoRoot, 'scripts/exported.mjs'),
    'export function validateExported(value) { return Boolean(value); }\n'
  );
  fs.writeFileSync(
    path.join(repoRoot, 'scripts/exported.test.mjs'),
    "import { validateExported } from './exported.mjs';\nvalidateExported(true);\n"
  );
  run(repoRoot, ['add', '.']);
  const result = validateAddedFunctionReachability({ repoRoot, baseRef });
  assert.equal(result.valid, true);
});

test('does not count unrelated same-name functions as reachability', () => {
  const { repoRoot, baseRef } = tempRepo();
  fs.writeFileSync(path.join(repoRoot, 'scripts/other.mjs'), 'function validate(value) { return value; }\nvalidate(true);\n');
  fs.appendFileSync(path.join(repoRoot, 'scripts/example.mjs'), '\nfunction validate(value) { return Boolean(value); }\n');
  const result = validateAddedFunctionReachability({ repoRoot, baseRef });
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.function_name === 'validate'));
});

test('fails closed in CI when diff base is unavailable', () => {
  const { repoRoot } = tempRepo();
  const previousCi = process.env.CI;
  try {
    process.env.CI = 'true';
    const result = validateAddedFunctionReachability({ repoRoot, baseRef: null });
    assert.equal(result.valid, false);
    assert(result.errors.some((error) => error.code === 'diff_base_unavailable'));
  } finally {
    if (previousCi === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = previousCi;
    }
  }
});
