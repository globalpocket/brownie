import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runBrowniePrivateStateGuard } from './guard-brownie-private-state.mjs';

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-private-state-'));
}

test('allows shared Brownie release evidence and local release target manifest', () => {
  const repoRoot = tempRepo();
  fs.mkdirSync(path.join(repoRoot, '.brownie/release-evidence'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, '.brownie/local-release-targets.json'), '{}\n');
  fs.writeFileSync(path.join(repoRoot, '.brownie/release-evidence/owner-governance-evidence.json'), '{}\n');

  const result = runBrowniePrivateStateGuard({ repoRoot });

  assert.deepEqual(result.errors, []);
});

test('rejects local Runtime durable state outside .brownie/private', () => {
  const repoRoot = tempRepo();
  fs.mkdirSync(path.join(repoRoot, '.brownie/headless-continuations'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, '.brownie/store-schema.json'), '{}\n');

  const result = runBrowniePrivateStateGuard({ repoRoot });

  assert.equal(result.errors.length, 2);
  assert.match(result.errors.join('\n'), /\.brownie\/headless-continuations/);
  assert.match(result.errors.join('\n'), /\.brownie\/store-schema\.json/);
});

test('allows local Runtime durable state under .brownie/private', () => {
  const repoRoot = tempRepo();
  fs.mkdirSync(path.join(repoRoot, '.brownie/private/runtime-store/headless-continuations'), {
    recursive: true
  });
  fs.writeFileSync(path.join(repoRoot, '.brownie/private/runtime-store/store-schema.json'), '{}\n');

  const result = runBrowniePrivateStateGuard({ repoRoot });

  assert.deepEqual(result.errors, []);
});
