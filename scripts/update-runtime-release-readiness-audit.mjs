import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSafetyReadinessEvidenceSnapshot } from './guard-runtime-release-readiness.mjs';
import { computeReadinessAuditContentSha256 } from './guard-release-contract.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditRelativePath = 'docs/architecture/runtime-release-readiness-audit.json';
const contractRelativePath = 'docs/architecture/runtime-release-contract.json';

export function buildRuntimeReleaseReadinessAudit(repoRoot = repositoryRoot) {
  const auditPath = path.join(repoRoot, auditRelativePath);
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  const previous = audit.safety_readiness_evidence_invalidation || {};
  return {
    ...audit,
    safety_readiness_evidence_invalidation: {
      ...previous,
      ...buildSafetyReadinessEvidenceSnapshot(repoRoot),
      status: previous.status || 'implemented_sufficient'
    }
  };
}

export function syncRuntimeReleaseReadinessAudit(repoRoot = repositoryRoot, { check = false } = {}) {
  const auditPath = path.join(repoRoot, auditRelativePath);
  const contractPath = path.join(repoRoot, contractRelativePath);
  const currentText = fs.readFileSync(auditPath, 'utf8');
  const expectedText = `${JSON.stringify(buildRuntimeReleaseReadinessAudit(repoRoot), null, 2)}\n`;
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  const expectedAuditHash = computeReadinessAuditContentSha256(expectedText);
  const currentContractHash = contract.commit_trace?.readiness_audit_content_sha256;
  const contractChanged = currentContractHash !== expectedAuditHash;
  if (currentText === expectedText && !contractChanged) {
    return { changed: false, auditPath, contractPath };
  }
  if (check) {
    const stalePaths = [];
    if (currentText !== expectedText) stalePaths.push(auditRelativePath);
    if (contractChanged) stalePaths.push(`${contractRelativePath} commit_trace.readiness_audit_content_sha256`);
    throw new Error(`${stalePaths.join(' and ')} is stale; run pnpm --workspace-root generate:runtime-release-readiness-audit`);
  }
  if (currentText !== expectedText) {
    fs.writeFileSync(auditPath, expectedText, 'utf8');
  }
  if (contractChanged) {
    contract.commit_trace = contract.commit_trace && typeof contract.commit_trace === 'object'
      ? contract.commit_trace
      : {};
    contract.commit_trace.readiness_audit_content_sha256 = expectedAuditHash;
    fs.writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  }
  return { changed: true, auditPath, contractPath };
}

function parseArgs(argv) {
  return { check: argv.includes('--check') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const result = syncRuntimeReleaseReadinessAudit(repositoryRoot, parseArgs(process.argv.slice(2)));
    console.log(result.changed ? `updated ${auditRelativePath}` : `current ${auditRelativePath}`);
  } catch (error) {
    console.error(error?.message ?? error);
    process.exit(1);
  }
}
