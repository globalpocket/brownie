# Owner Governance Evidence Template

RRP-8.7 makes owner-controlled release residuals machine-checkable without
self-approving them. Runtime automation may generate local evidence with:

```sh
pnpm --workspace-root release:owner-governance-evidence
pnpm --workspace-root guard:owner-governance-evidence
```

The generated evidence is written to ignored local release evidence under
`.brownie/release-evidence/owner-governance-evidence.json`.

## Owner decision files

These files are intentionally absent until the repository owner decides to add
real approvals. Do not create them as placeholders and do not treat templates as
approval.

### `docs/architecture/owner-integrity-authority-decision.json`

```json
{
  "schema_version": 1,
  "decision_id": "brownie-owner-integrity-authority-decision-v1",
  "decision_status": "approved",
  "owner_approved": true,
  "approved_mechanism": "artifact-signature-or-formal-integrity-mechanism",
  "verification_instructions": "Owner-provided verification procedure.",
  "approved_by": "owner-or-release-authority",
  "approved_at": "YYYY-MM-DDTHH:mm:ssZ"
}
```

### `docs/architecture/owner-independent-review-evidence.json`

```json
{
  "schema_version": 1,
  "evidence_id": "brownie-owner-independent-review-evidence-v1",
  "reviews": [
    {
      "id": "release_workflow",
      "status": "approved",
      "reviewer": "independent-reviewer",
      "self_approval": false,
      "reviewed_at": "YYYY-MM-DDTHH:mm:ssZ"
    },
    {
      "id": "permission_model",
      "status": "approved",
      "reviewer": "independent-reviewer",
      "self_approval": false,
      "reviewed_at": "YYYY-MM-DDTHH:mm:ssZ"
    },
    {
      "id": "ledger_contract",
      "status": "approved",
      "reviewer": "independent-reviewer",
      "self_approval": false,
      "reviewed_at": "YYYY-MM-DDTHH:mm:ssZ"
    },
    {
      "id": "mode_pack_trust_boundary",
      "status": "approved",
      "reviewer": "independent-reviewer",
      "self_approval": false,
      "reviewed_at": "YYYY-MM-DDTHH:mm:ssZ"
    },
    {
      "id": "signing_provenance",
      "status": "approved",
      "reviewer": "independent-reviewer",
      "self_approval": false,
      "reviewed_at": "YYYY-MM-DDTHH:mm:ssZ"
    },
    {
      "id": "release_ready_judgment",
      "status": "approved",
      "reviewer": "independent-reviewer",
      "self_approval": false,
      "reviewed_at": "YYYY-MM-DDTHH:mm:ssZ"
    }
  ]
}
```

### `docs/architecture/owner-oss-publication-decision.json`

```json
{
  "schema_version": 1,
  "decision_id": "brownie-owner-oss-publication-decision-v1",
  "decision_status": "approved",
  "owner_approved": true,
  "license": "OWNER_SELECTED_LICENSE",
  "publish_posture": "OWNER_SELECTED_PUBLISH_POSTURE",
  "approved_by": "owner-or-release-authority",
  "approved_at": "YYYY-MM-DDTHH:mm:ssZ"
}
```

## Release Ready boundary

The owner-governance guard may pass while Release Ready remains false. Passing
means the evidence is well-formed and fail-closed, not that owner-controlled
actions have been completed.
