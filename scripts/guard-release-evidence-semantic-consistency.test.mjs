import test from 'node:test';
import assert from 'node:assert/strict';

const contradictoryEvidenceFixtures = [
  {
    name: 'implemented evidence with null commits',
    contract: { status: 'implemented_sufficient', implementation_commit: null, tested_commit: null },
    evidence: { source_commit: null, source_tree_dirty: false },
    expectedReason: 'missing_commit_binding',
  },
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

test('each semantic consistency fixture has contract and evidence payloads', () => {
  for (const fixture of contradictoryEvidenceFixtures) {
    assert.equal(typeof fixture.name, 'string');
    assert.equal(typeof fixture.expectedReason, 'string');
    assert.equal(typeof fixture.contract, 'object');
    assert.equal(typeof fixture.evidence, 'object');
  }
});
