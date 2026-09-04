import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildDependencySecurityLicenseAudit,
  writeDependencySecurityLicenseAudit
} from './release-dependency-security-license-audit.mjs';

function tempRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-dependency-audit-'));
  fs.writeFileSync(path.join(repoRoot, 'Cargo.lock'), 'lock\n');
  fs.writeFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'lock\n');
  fs.writeFileSync(path.join(repoRoot, 'deny.toml'), '[licenses]\n');
  return repoRoot;
}

function mockRunner(statusByCommand) {
  return (_repoRoot, command, args) => {
    const key = [command, ...args].join(' ');
    return {
      status: statusByCommand[key] ?? 0,
      signal: null,
      stdout: key === 'git rev-parse HEAD' ? 'abc123\n' : '',
      stderr: ''
    };
  };
}

test('passes only when every mandatory dependency audit check passes', () => {
  const audit = buildDependencySecurityLicenseAudit({
    repoRoot: tempRepo(),
    generatedAt: '2026-09-04T00:00:00.000Z',
    runner: mockRunner({})
  });
  assert.equal(audit.mandatory_gate_passed, true);
  assert.deepEqual(audit.fail_closed_reasons, []);
  assert.equal(audit.checks.length, 3);
});

test('fails closed when a required audit tool is unavailable', () => {
  const audit = buildDependencySecurityLicenseAudit({
    repoRoot: tempRepo(),
    runner: mockRunner({
      'cargo-deny --version': 1
    })
  });
  assert.equal(audit.mandatory_gate_passed, false);
  assert(audit.fail_closed_reasons.includes('cargo_deny_policy:tool_unavailable'));
});

test('fails closed when a required audit command times out', () => {
  const audit = buildDependencySecurityLicenseAudit({
    repoRoot: tempRepo(),
    runner: (_repoRoot, command, args) => {
      const key = [command, ...args].join(' ');
      return {
        status: key === 'cargo audit --locked' ? null : 0,
        signal: null,
        error: key === 'cargo audit --locked' ? { code: 'ETIMEDOUT' } : null,
        stdout: key === 'git rev-parse HEAD' ? 'abc123\n' : '',
        stderr: ''
      };
    }
  });
  assert.equal(audit.mandatory_gate_passed, false);
  assert(audit.fail_closed_reasons.includes('cargo_audit_locked:timed_out'));
});

test('fails closed when a required audit command fails', () => {
  const audit = buildDependencySecurityLicenseAudit({
    repoRoot: tempRepo(),
    runner: mockRunner({
      'pnpm audit --prod --audit-level moderate --json': 1
    })
  });
  assert.equal(audit.mandatory_gate_passed, false);
  assert(audit.fail_closed_reasons.includes('pnpm_audit_prod:failed'));
});

test('writes bounded dependency audit evidence', () => {
  const repoRoot = tempRepo();
  const result = writeDependencySecurityLicenseAudit({
    repoRoot,
    outPath: '.brownie/release-evidence/dependency-security-license-audit.json',
    runner: mockRunner({})
  });
  const written = JSON.parse(fs.readFileSync(path.join(repoRoot, result.outPath), 'utf8'));
  assert.equal(written.evidence_id, 'brownie-dependency-security-license-audit-v1');
  assert.equal(written.privacy_policy.includes('No raw process output'), true);
});
