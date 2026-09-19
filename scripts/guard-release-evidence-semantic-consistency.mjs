#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function addReason(reasons, reason) {
  if (!reasons.includes(reason)) {
    reasons.push(reason);
  }
}

function hasForbiddenLocalEvidence(value) {
  if (typeof value === 'string') {
    return /\/Users\/|\/home\/|C:\/Users\/|EncodedCommand|raw stdout|raw stderr/i.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(hasForbiddenLocalEvidence);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, child]) => {
      if (/stdout|stderr/i.test(key)) {
        return true;
      }
      return hasForbiddenLocalEvidence(child);
    });
  }
  return false;
}

export function validateReleaseEvidenceSemanticConsistency({ contract = {}, evidence = {} } = {}) {
  const reasons = [];
  const implemented =
    contract.status === 'implemented_sufficient' ||
    contract.artifact_smoke_tests === 'implemented_sufficient' ||
    contract.tested_commit_matches_artifact_commit === 'implemented_sufficient' ||
    contract.audit_trace_matches_tested_commit === 'implemented_sufficient';

  if (implemented) {
    if (!contract.implementation_commit || !contract.tested_commit || !evidence.source_commit) {
      addReason(reasons, 'missing_commit_binding');
    }
    if (evidence.source_tree_dirty === true) {
      addReason(reasons, 'dirty_source_tree');
    }
  }

  if (implemented && evidence.source_commit === null) {
    addReason(reasons, 'null_source_commit');
  }

  if (implemented && evidence.source_commit === undefined) {
    addReason(reasons, 'undefined_source_commit');
  }

  const smokeSteps = evidence.smoke_steps ?? evidence.artifact_smoke?.steps;
  if (implemented && Array.isArray(smokeSteps)) {
    const normalized = smokeSteps.map((step) => {
      if (typeof step === 'string') {
        return step.toLowerCase();
      }
      if (step && typeof step === 'object') {
        return String(step.command ?? step.step ?? step.name ?? '').toLowerCase();
      }
      return String(step).toLowerCase();
    });
    const shallowOnly =
      normalized.length > 0 &&
      normalized.every((step) => step.includes('--version') || step.includes('help run'));
    if (shallowOnly) {
      addReason(reasons, 'shallow_smoke');
    }
  }

  if (
    implemented &&
    (String(evidence.soak_command ?? '').includes('brownie --version') ||
      evidence.soak_test?.kind === 'version_only')
  ) {
    addReason(reasons, 'version_only_soak');
  }

  if (hasForbiddenLocalEvidence(evidence)) {
    addReason(reasons, 'forbidden_confidential_evidence');
  }

  return {
    ok: reasons.length === 0,
    reasons
  };
}

function currentRepositoryInputs() {
  const contract = readJson('docs/architecture/runtime-release-contract.json');
  let supplyChain = {};
  let runtimeOperational = {};
  try {
    supplyChain = readJson('.brownie/release-evidence/supply-chain-artifact-evidence.json');
  } catch {}
  try {
    runtimeOperational = readJson('.brownie/release-evidence/runtime-operational-evidence.json');
  } catch {}
  return {
    contract,
    evidence: {
      ...supplyChain,
      runtime_operational: runtimeOperational,
      source_commit: supplyChain.source_commit,
      source_tree_dirty: supplyChain.source_tree_dirty
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = validateReleaseEvidenceSemanticConsistency(currentRepositoryInputs());
  if (!result.ok) {
    console.error('Release evidence semantic consistency guard failed:');
    for (const reason of result.reasons) {
      console.error(`- ${reason}`);
    }
    process.exit(1);
  }
  console.log('Release evidence semantic consistency guard passed.');
}
