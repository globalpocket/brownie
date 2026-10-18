import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  buildRuntimeReleaseReadinessAudit,
  syncRuntimeReleaseReadinessAudit
} from './update-runtime-release-readiness-audit.mjs';
import { computeReadinessAuditContentSha256 } from './guard-release-contract.mjs';

test('synchronizes the safety readiness fingerprint through the canonical generator and check', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-readiness-audit-'));
  const sourcePath = path.join(repoRoot, 'crates/brownie-runtime/src/lib.rs');
  const auditPath = path.join(repoRoot, 'docs/architecture/runtime-release-readiness-audit.json');
  const contractPath = path.join(repoRoot, 'docs/architecture/runtime-release-contract.json');
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  fs.writeFileSync(sourcePath, 'safety-critical fixture\n');
  fs.writeFileSync(auditPath, JSON.stringify({
    safety_readiness_evidence_invalidation: {
      status: 'implemented_sufficient',
      tracked_fingerprint: 'sha256:stale'
    }
  }, null, 2) + '\n');
  fs.writeFileSync(contractPath, JSON.stringify({
    commit_trace: { readiness_audit_content_sha256: 'sha256:stale' }
  }, null, 2) + '\n');
  const git = spawnSync('git', ['init', '-q', repoRoot], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  const add = spawnSync('git', ['-C', repoRoot, 'add', 'crates/brownie-runtime/src/lib.rs'], { encoding: 'utf8' });
  assert.equal(add.status, 0, add.stderr);

  assert.throws(
    () => syncRuntimeReleaseReadinessAudit(repoRoot, { check: true }),
    /runtime-release-readiness-audit\.json and docs\/architecture\/runtime-release-contract\.json commit_trace\.readiness_audit_content_sha256 is stale/
  );
  const updated = syncRuntimeReleaseReadinessAudit(repoRoot);
  assert.equal(updated.changed, true);
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  assert.deepEqual(audit, buildRuntimeReleaseReadinessAudit(repoRoot));
  const expectedAuditText = fs.readFileSync(auditPath, 'utf8');
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  assert.equal(
    contract.commit_trace.readiness_audit_content_sha256,
    computeReadinessAuditContentSha256(expectedAuditText)
  );
  assert.equal(syncRuntimeReleaseReadinessAudit(repoRoot, { check: true }).changed, false);
});

test('fails freshness when only the dependent release contract hash is stale', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-readiness-contract-'));
  const auditPath = path.join(repoRoot, 'docs/architecture/runtime-release-readiness-audit.json');
  const contractPath = path.join(repoRoot, 'docs/architecture/runtime-release-contract.json');
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  fs.writeFileSync(auditPath, JSON.stringify({
    safety_readiness_evidence_invalidation: { status: 'implemented_sufficient' }
  }, null, 2) + '\n');
  fs.writeFileSync(contractPath, JSON.stringify({
    commit_trace: { readiness_audit_content_sha256: 'sha256:stale' }
  }, null, 2) + '\n');
  assert.throws(
    () => syncRuntimeReleaseReadinessAudit(repoRoot, { check: true }),
    /runtime-release-contract\.json commit_trace\.readiness_audit_content_sha256 is stale/
  );
});

test('CI checks readiness freshness before Rust setup in every cargo job', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const jobs = [
    ['check', 'runtime-platform'],
    ['runtime-platform', 'index-platform'],
    ['index-platform', null]
  ];
  for (const [job, nextJob] of jobs) {
    const start = workflow.indexOf(`  ${job}:`);
    const end = nextJob ? workflow.indexOf(`\n  ${nextJob}:`, start) : workflow.length;
    assert(start >= 0 && end > start, `missing CI job ${job}`);
    const section = workflow.slice(start, end);
    const freshness = section.indexOf('node scripts/update-runtime-release-readiness-audit.mjs --check');
    const rustSetup = section.indexOf('name: Setup Rust');
    assert(freshness >= 0 && freshness < rustSetup, `${job} must fail fast before Rust setup`);
  }
});
