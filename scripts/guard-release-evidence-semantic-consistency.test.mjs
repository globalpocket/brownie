import test from 'node:test';
import assert from 'node:assert/strict';

import { validateReleaseEvidenceSemanticConsistency } from './guard-release-evidence-semantic-consistency.mjs';

const nullSourceCommitFixture = {
  name: 'implemented evidence with null commits',
  contract: { status: 'implemented_sufficient', implementation_commit: null, tested_commit: null },
  evidence: { source_commit: null, source_tree_dirty: false },
  expectedReason: 'missing_commit_binding',
};

const blockerGenerationMismatchFixture = {
  name: 'blocker generation mismatch',
  contract: { status: 'implemented_sufficient', blocker_generation: 2 },
  evidence: { final_judgment_blocker_generation: 1, todo_blocker_generation: 2 },
  expectedReason: 'blocker_generation_mismatch',
};

const contradictoryEvidenceFixtures = [
  blockerGenerationMismatchFixture,
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

test('blocker generation mismatch rejects with blocker_generation_mismatch', () => {
  const result = validateReleaseEvidenceSemanticConsistency({
    contract: { status: 'implemented_sufficient', blocker_generation: 'E-20g' },
    evidence: { final_judgment_blocker_generation: 'E-19k', todo_blocker_generation: 'E-20g' },
  });
  assert.equal(result.ok, false);
  assert(result.reasons.includes('blocker_generation_mismatch'));
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
      'blocker_generation_mismatch',
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

test('semantic consistency allows summarized process output evidence', () => {
  const result = validateReleaseEvidenceSemanticConsistency({
    contract: {},
    evidence: {
      runtime_operational: {
        sections: {
          artifact_lifecycle: {
            commands: [
              {
                stdout_summary: { kind: 'process_output_summary', byte_length: 12, line_count: 1, sha256: 'a'.repeat(64) },
                stderr_summary: { kind: 'process_output_summary', byte_length: 0, line_count: 0, sha256: 'b'.repeat(64) }
              }
            ]
          }
        }
      }
    }
  });

  assert(!result.reasons.includes('forbidden_confidential_evidence'), result.reasons.join('\n'));
});
