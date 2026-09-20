import test from 'node:test';
import assert from 'node:assert/strict';

import { validateReleaseEvidenceSemanticConsistency } from './guard-release-evidence-semantic-consistency.mjs';

const nullSourceCommitFixture = {
  name: 'implemented evidence with null commits',
  contract: { status: 'implemented_sufficient', implementation_commit: null, tested_commit: null },
  evidence: { source_commit: null, source_tree_dirty: false },
  expectedReason: 'missing_commit_binding',
};

const contradictoryEvidenceFixtures = [
  nullSourceCommitFixture,
  {
    name: 'artifact evidence from dirty source tree',
    contract: { status: 'implemented_sufficient', artifact_sha256: 'sha256:abc' },
    evidence: { source_commit: 'abc123', source_tree_dirty: true },
    expectedReason: 'dirty_source_tree',
  },
  {
    name: 'shallow artifact smoke evidence',
    contract: { status: 'implemented_sufficient' },
    evidence: { smoke_steps: ['brownie --version', 'brownie help run'] },
    expectedReason: 'shallow_smoke',
  },
  {
    name: 'version-only soak evidence',
    contract: { status: 'implemented_sufficient' },
    evidence: { soak_command: 'brownie --version', iterations: 100 },
    expectedReason: 'version_only_soak',
  },
  {
    name: 'forbidden confidential runtime evidence field',
    contract: { status: 'implemented_sufficient' },
    evidence: { stdout: '/Users/example/worktree raw output' },
    expectedReason: 'forbidden_confidential_evidence',
  },
];

test('dirty source tree evidence rejects with dirty_source_tree', () => {
  const result = validateReleaseEvidenceSemanticConsistency({
    contract: { status: 'implemented_sufficient' },
    evidence: { source_commit: 'abc123', source_tree_dirty: true },
  });
  assert.equal(result.ok, false);
  assert(result.reasons.includes('dirty_source_tree'));
});

test('null source_commit rejects with missing_commit_binding', () => {
  const result = validateReleaseEvidenceSemanticConsistency(nullSourceCommitFixture);
  assert.equal(result.ok, false);
  assert(result.reasons.includes('missing_commit_binding'));
});

test('semantic consistency fixtures cover release evidence contradictions', () => {
  assert.equal(contradictoryEvidenceFixtures.length, 5);
  assert.deepEqual(
    contradictoryEvidenceFixtures.map((fixture) => fixture.expectedReason),
    [
      'missing_commit_binding',
      'dirty_source_tree',
      'shallow_smoke',
      'version_only_soak',
      'forbidden_confidential_evidence',
    ],
  );
});

test('production validator rejects each semantic consistency fixture', () => {
  for (const fixture of contradictoryEvidenceFixtures) {
    const result = validateReleaseEvidenceSemanticConsistency({
      contract: fixture.contract,
      evidence: fixture.evidence,
    });
    assert.equal(result.ok, false, fixture.name);
    assert(result.reasons.includes(fixture.expectedReason), fixture.name);
  }
});
