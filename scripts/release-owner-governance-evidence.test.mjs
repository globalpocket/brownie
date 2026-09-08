import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildIndependentReviewsSection
} from './release-owner-governance-evidence.mjs';

const requiredReviewIds = [
  'release_workflow',
  'permission_model',
  'ledger_contract',
  'mode_pack_trust_boundary',
  'signing_provenance',
  'release_ready_judgment'
];

function tempRepoRoot() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-owner-governance-release-'));
  fs.mkdirSync(path.join(repoRoot, 'docs/architecture'), { recursive: true });
  return repoRoot;
}

function writeIndependentReviewEvidence(repoRoot, githubReviewProvenance) {
  fs.writeFileSync(
    path.join(repoRoot, 'docs/architecture/owner-independent-review-evidence.json'),
    `${JSON.stringify(
      {
        schema_version: 1,
        evidence_id: 'brownie-owner-independent-review-evidence-v1',
        review_authority: 'globalpocket',
        reviews: requiredReviewIds.map((reviewId) => ({
          id: reviewId,
          status: 'approved',
          reviewer: 'globalpocket',
          self_approval: false
        })),
        github_review_provenance: githubReviewProvenance
      },
      null,
      2
    )}\n`
  );
}

function provenance(requiredReviewId) {
  return {
    required_review_id: requiredReviewId,
    pull_request_number: 414,
    pull_request_author: 'brownie-agent',
    review_id: `review-${requiredReviewId}`,
    reviewer: 'globalpocket',
    state: 'APPROVED',
    commit_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    submitted_at: '2026-09-08T17:30:42Z'
  };
}

test('owner governance release collector does not trust static GitHub review provenance without verification', () => {
  const repoRoot = tempRepoRoot();
  writeIndependentReviewEvidence(repoRoot, requiredReviewIds.map((reviewId) => provenance(reviewId)));

  const section = buildIndependentReviewsSection(repoRoot, {
    repository: 'globalpocket/brownie',
    verifyReviewProvenance: () => ({ verified: false, status: 'github_review_not_verified' })
  });

  assert.equal(section.status, 'not_completed');
  assert.equal(section.approved_review_count, 0);
  assert.deepEqual(section.missing_review_ids, requiredReviewIds);
  assert.equal(section.github_review_provenance.length, 0);
  assert.equal(section.github_review_verification_failures.length, requiredReviewIds.length);
});

test('owner governance release collector accepts only verified GitHub review provenance', () => {
  const repoRoot = tempRepoRoot();
  writeIndependentReviewEvidence(repoRoot, requiredReviewIds.map((reviewId) => provenance(reviewId)));

  const section = buildIndependentReviewsSection(repoRoot, {
    repository: 'globalpocket/brownie',
    verifyReviewProvenance: () => ({ verified: true, status: 'satisfied' })
  });

  assert.equal(section.status, 'satisfied');
  assert.equal(section.approved_review_count, requiredReviewIds.length);
  assert.deepEqual(section.missing_review_ids, []);
  assert.equal(section.github_review_provenance.length, requiredReviewIds.length);
  assert.equal(section.github_review_verification_failures.length, 0);
});
