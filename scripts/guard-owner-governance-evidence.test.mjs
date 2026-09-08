import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  runOwnerGovernanceEvidenceGuard
} from './guard-owner-governance-evidence.mjs';

const requiredSections = [
  'branch_protection',
  'required_status_checks',
  'protected_tag_policy',
  'remote_ci_workflow_provenance',
  'signature_or_integrity_authority',
  'independent_reviews',
  'oss_license_publish_posture'
];

function section(status = 'owner_decision_waiting', extra = {}) {
  return {
    status,
    release_blocking: true,
    ...extra
  };
}

function validContract(overrides = {}) {
  return {
    phase: 'RRP-8.7',
    runtime_release_ready: false,
    local_release_gate: {
      commands: [
        'pnpm --workspace-root release:integrity-verify',
        'pnpm --workspace-root release:owner-governance-evidence',
        'pnpm --workspace-root guard:owner-governance-evidence',
        'pnpm --workspace-root guard:owner-governance-evidence:test'
      ].map((command) => ({ command }))
    },
    owner_governance_evidence: {
      contract_id: 'brownie-owner-governance-evidence-v1',
      default_path: '.brownie/release-evidence/owner-governance-evidence.json',
      required_sections: requiredSections
    },
    ...overrides
  };
}

function validEvidence(overrides = {}) {
  const sections = {
    branch_protection: section('satisfied'),
    required_status_checks: section('satisfied'),
    protected_tag_policy: section('satisfied', {
      protected_tag_ruleset_count: 1
    }),
    remote_ci_workflow_provenance: section('local_missing_remote_ci_provenance'),
    signature_or_integrity_authority: section('owner_decision_waiting', {
      owner_decision: {
        path: 'docs/architecture/owner-integrity-authority-decision.json',
        exists: false,
        sha256: null
      },
      local_integrity_verification: {
        path: '.brownie/release-evidence/integrity-verification.json',
        exists: false,
        sha256: null
      }
    }),
    independent_reviews: section('not_completed', {
      owner_evidence: {
        path: 'docs/architecture/owner-independent-review-evidence.json',
        exists: false,
        sha256: null
      },
      required_review_ids: [
        'release_workflow',
        'permission_model',
        'ledger_contract',
        'mode_pack_trust_boundary',
        'signing_provenance',
        'release_ready_judgment'
      ],
      approved_review_count: 0,
      missing_review_ids: [
        'release_workflow',
        'permission_model',
        'ledger_contract',
        'mode_pack_trust_boundary',
        'signing_provenance',
        'release_ready_judgment'
      ]
    }),
    oss_license_publish_posture: section('owner_decision_waiting', {
      owner_decision: {
        path: 'docs/architecture/owner-oss-publication-decision.json',
        exists: false,
        sha256: null
      },
      license_file_present: false
    })
  };
  return {
    schema_version: 1,
    evidence_id: 'brownie-owner-governance-evidence-v1',
    repository: 'globalpocket/brownie',
    release_ready: false,
    runtime_release_ready: false,
    required_sections: requiredSections,
    sections,
    fail_closed_reasons: [
      'remote_ci_workflow_provenance:local_missing_remote_ci_provenance',
      'signature_or_integrity_authority:owner_decision_waiting',
      'independent_reviews:not_completed',
      'oss_license_publish_posture:owner_decision_waiting'
    ],
    ...overrides
  };
}

function validate(evidence = validEvidence(), contract = validContract()) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-owner-governance-'));
  return runOwnerGovernanceEvidenceGuard({ repoRoot, contract, evidence }).errors;
}

test('accepts fail-closed owner governance evidence', () => {
  assert.deepEqual(validate(), []);
});

test('rejects release ready claims from owner governance evidence', () => {
  const errors = validate(validEvidence({ release_ready: true }));
  assert(errors.some((error) => error.includes('must not declare release_ready true')));
});

test('rejects missing fail-closed reasons for incomplete sections', () => {
  const evidence = validEvidence({ fail_closed_reasons: [] });
  const errors = validate(evidence);
  assert(errors.some((error) => error.includes('fail_closed_reasons must include independent_reviews')));
});

test('rejects contract without owner-governance release gate commands', () => {
  const errors = validate(validEvidence(), validContract({ local_release_gate: { commands: [] } }));
  assert(errors.some((error) => error.includes('release:owner-governance-evidence')));
});

test('rejects satisfied independent review evidence with missing review ids', () => {
  const evidence = validEvidence({
    sections: {
      ...validEvidence().sections,
      independent_reviews: section('satisfied', {
        owner_evidence: {
          path: 'docs/architecture/owner-independent-review-evidence.json',
          exists: false,
          sha256: null
        },
        required_review_ids: ['release_workflow'],
        approved_review_count: 0,
        missing_review_ids: ['release_workflow']
      })
    }
  });
  const errors = validate(evidence);
  assert(errors.some((error) => error.includes('satisfied independent_reviews must have no missing_review_ids')));
});

test('rejects satisfied protected tag evidence without a ruleset count', () => {
  const evidence = validEvidence({
    sections: {
      ...validEvidence().sections,
      protected_tag_policy: section('satisfied', {
        protected_tag_ruleset_count: 0
      })
    }
  });
  const errors = validate(evidence);
  assert(errors.some((error) => error.includes('satisfied protected_tag_policy must have protected_tag_ruleset_count > 0')));
});

test('rejects satisfied integrity authority without owner-approved evidence files', () => {
  const evidence = validEvidence({
    sections: {
      ...validEvidence().sections,
      signature_or_integrity_authority: section('satisfied', {
        owner_decision: {
          path: 'docs/architecture/owner-integrity-authority-decision.json',
          exists: false,
          sha256: null
        },
        local_integrity_verification: {
          path: '.brownie/release-evidence/integrity-verification.json',
          exists: false,
          sha256: null
        },
        local_checksum_verification_available: false
      })
    },
    fail_closed_reasons: [
      'remote_ci_workflow_provenance:local_missing_remote_ci_provenance',
      'independent_reviews:not_completed',
      'oss_license_publish_posture:owner_decision_waiting'
    ]
  });
  const errors = validate(evidence);
  assert(errors.some((error) => error.includes('satisfied signature_or_integrity_authority must have an existing owner_decision')));
});
