import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { duplicateJsonKeys, validatePhaseLoopPreflight } from './phase-loop-preflight.mjs';

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-phase-loop-preflight-'));
  fs.mkdirSync(path.join(repo, 'docs/architecture'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.brownie'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), '- [ ] E-1: Patch only `README.md`:\n  Route: documentation.\n  Verification: run `pnpm --workspace-root guard:release-contract`.\n');
  fs.writeFileSync(path.join(repo, 'docs/architecture/phase-value-manifest.json'), '{ "phase": "E-1" }\n');
  fs.writeFileSync(path.join(repo, 'docs/architecture/runtime-release-readiness-audit.json'), '{ "audited_main_commit": "1111111111111111111111111111111111111111", "runtime_release_ready": false }\n');
  const auditText = fs.readFileSync(path.join(repo, 'docs/architecture/runtime-release-readiness-audit.json'), 'utf8');
  const auditHash = `sha256:${createHash('sha256').update(auditText).digest('hex')}`;
  fs.writeFileSync(path.join(repo, 'docs/architecture/runtime-release-contract.json'), JSON.stringify({
    phase: 'RRP-8.7',
    commit_trace: {
      readiness_audit_content_sha256: auditHash
    }
  }, null, 2) + '\n');
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo });
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' });
  return repo;
}

test('detects duplicate JSON keys outside JSON.parse visibility', () => {
  const duplicates = duplicateJsonKeys('{ "a": 1, "nested": { "b": 1, "b": 2 }, "a": 3 }', 'fixture.json');
  assert.equal(duplicates.length, 2);
  assert(duplicates.some((entry) => entry.key === 'a' && entry.object_path === '<root>'));
  assert(duplicates.some((entry) => entry.key === 'b' && entry.object_path === 'nested'));
});

test('rejects release contract readiness audit hash drift', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, 'docs/architecture/runtime-release-readiness-audit.json'), '{ "audited_main_commit": "1111111111111111111111111111111111111111", "runtime_release_ready": false, "runtime_release_ready": false }\n');
  const result = validatePhaseLoopPreflight({ repo, skipCommands: true });
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.code === 'json_duplicate_key'), JSON.stringify(result.errors));
  assert(result.errors.some((error) => error.code === 'readiness_audit_hash_mismatch'), JSON.stringify(result.errors));
});

test('rejects dirty delivery when only owner blocker remains', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, '.brownie/todo.md'), '- [ ] E-owner: Owner must provide release credentials:\n  Route: owner.\n  Verification: external owner handoff.\n');
  fs.writeFileSync(path.join(repo, 'README.md'), 'dirty\n');
  const result = validatePhaseLoopPreflight({ repo, skipCommands: true });
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.code === 'dirty_delivery_required'), JSON.stringify(result.errors));
});
