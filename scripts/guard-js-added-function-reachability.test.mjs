import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
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

test('accepts a newly added function passed to a collection callback execution path', () => {
  const { repoRoot, baseRef } = tempRepo();
  fs.appendFileSync(
    path.join(repoRoot, 'scripts/example.mjs'),
    '\nfunction validateCallback(value) { return Boolean(value); }\n[true].filter(validateCallback);\n'
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
  const previousGithubEventName = process.env.GITHUB_EVENT_NAME;
  try {
    process.env.CI = 'true';
    process.env.GITHUB_EVENT_NAME = 'pull_request';
    const result = validateAddedFunctionReachability({ repoRoot, baseRef: null });
    assert.equal(result.valid, false);
    assert(result.errors.some((error) => error.code === 'diff_base_unavailable'));
  } finally {
    if (previousCi === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = previousCi;
    }
    if (previousGithubEventName === undefined) {
      delete process.env.GITHUB_EVENT_NAME;
    } else {
      process.env.GITHUB_EVENT_NAME = previousGithubEventName;
    }
  }
});

test('skips outside pull request CI when diff base is unavailable', () => {
  const { repoRoot } = tempRepo();
  const previousCi = process.env.CI;
  const previousGithubEventName = process.env.GITHUB_EVENT_NAME;
  const previousGithubBaseRef = process.env.GITHUB_BASE_REF;
  try {
    process.env.CI = 'true';
    delete process.env.GITHUB_EVENT_NAME;
    delete process.env.GITHUB_BASE_REF;
    const result = validateAddedFunctionReachability({ repoRoot, baseRef: null });
    assert.equal(result.valid, true);
    assert.equal(result.skipped, true);
  } finally {
    if (previousCi === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = previousCi;
    }
    if (previousGithubEventName === undefined) {
      delete process.env.GITHUB_EVENT_NAME;
    } else {
      process.env.GITHUB_EVENT_NAME = previousGithubEventName;
    }
    if (previousGithubBaseRef === undefined) {
      delete process.env.GITHUB_BASE_REF;
    } else {
      process.env.GITHUB_BASE_REF = previousGithubBaseRef;
    }
  }
});


test('PR base refresh preserves complete history needed by later ancestry guards', () => {
  const { repoRoot, baseRef } = tempRepo();
  const tree = run(repoRoot, ['rev-parse', 'HEAD^{tree}']);
  let parent = baseRef;
  for (let index = 0; index < 120; index += 1) {
    parent = run(repoRoot, ['commit-tree', tree, '-p', parent, '-m', `history ${index}`]);
  }
  run(repoRoot, ['update-ref', 'refs/heads/main', parent]);
  const feature = run(repoRoot, ['commit-tree', tree, '-p', parent, '-m', 'implementation']);
  run(repoRoot, ['update-ref', 'refs/heads/implementation', feature]);
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-reachability-origin-'));
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-reachability-checkout-'));
  run(repoRoot, ['clone', '--bare', repoRoot, remote]);
  run(repoRoot, ['clone', pathToFileURL(remote).href, checkout]);
  run(checkout, ['checkout', '--detach', feature]);
  const names = ['GITHUB_BASE_REF', 'GITHUB_EVENT_NAME', 'BROWNIE_JS_REACHABILITY_BASE'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.GITHUB_BASE_REF = 'main';
    process.env.GITHUB_EVENT_NAME = 'pull_request';
    delete process.env.BROWNIE_JS_REACHABILITY_BASE;
    assert.equal(run(checkout, ['rev-parse', '--is-shallow-repository']), 'false');
    assert.equal(run(checkout, ['merge-base', baseRef, 'HEAD']), baseRef);
    const result = validateAddedFunctionReachability({ repoRoot: checkout });
    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.equal(result.skipped, false);
    assert.equal(run(checkout, ['rev-parse', '--is-shallow-repository']), 'false');
    assert.equal(run(checkout, ['merge-base', baseRef, 'HEAD']), baseRef);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
    fs.rmSync(checkout, { recursive: true, force: true });
  }
});
