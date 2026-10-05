# Brownie TODO breakdown ledger

This file records Brownie-managed decomposition decisions for the live queue in
`.brownie/todo.md`. It is shared operational state, not release evidence.

## TODO-decompose-clean-release-workflow-and-doc-sync-ca637ce0

Parent TODO: TODO-decompose-clean-release-workflow-and-doc-sync-ca637ce0

Dependency graph:
- TODO-decompose-clean-release-workflow-and-doc-sync-ca637ce0: <none>
- E-22a-release-workflow-clean-checkout-leaf: <none>
- E-22b-doc-sync-contract-leaf-target-01: <none>
- E-22b-doc-sync-contract-leaf-target-02: E-22b-doc-sync-contract-leaf-target-01
- E-22b-doc-sync-contract-leaf-target-03: E-22b-doc-sync-contract-leaf-target-02
- E-22b-doc-sync-contract-leaf-target-04: E-22b-doc-sync-contract-leaf-target-03

Verification ledger:
- TODO-decompose-clean-release-workflow-and-doc-sync-ca637ce0: `pnpm --workspace-root guard:todo-decomposition`; `pnpm --workspace-root phase-loop:todo-queue-integrity`
- E-22a-release-workflow-clean-checkout-leaf: `pnpm --workspace-root guard:supply-chain-artifact-evidence`; `pnpm --workspace-root release:gate -- --dry-run`
- E-22b-doc-sync-contract-leaf-target-01: `pnpm --workspace-root guard:release-evidence-semantic-consistency`
- E-22b-doc-sync-contract-leaf-target-02: `pnpm --workspace-root guard:phase-value`
- E-22b-doc-sync-contract-leaf-target-03: `pnpm --workspace-root guard:release-contract`
- E-22b-doc-sync-contract-leaf-target-04: `pnpm --workspace-root guard:runtime-release-readiness`

Quality rubric:
- TODO-decompose-clean-release-workflow-and-doc-sync-ca637ce0: decomposition-only task; it may patch only `.brownie/todo.md` and `.brownie/todo-breakdown.md`; it must produce bounded leaf TODOs for clean release workflow and document generation sync while preserving the owner-controlled E-20i Runtime Release Ops blocker.
- E-22a-release-workflow-clean-checkout-leaf: create-only workflow leaf; must not require credentials, publishing, or customer/Enterprise deployment; must express clean checkout, matrix targets, executable evidence, source identity, and provenance as fail-closed Release Ops workflow steps.
- E-22b-doc-sync-contract-leaf-target-01: single-file final judgment sync leaf; must preserve fail-closed Product Ready status and avoid invented evidence.
- E-22b-doc-sync-contract-leaf-target-02: single-file phase manifest sync leaf; must preserve fail-closed Product Ready status and avoid invented evidence.
- E-22b-doc-sync-contract-leaf-target-03: single-file release contract sync leaf; must keep unknown trace bindings null until executable evidence exists.
- E-22b-doc-sync-contract-leaf-target-04: single-file readiness audit sync leaf; must preserve fail-closed Product Ready status and avoid invented evidence.

History:
- 2026-10-04T16:35:00+09:00: Added after processing the PR #502 external review against current main ca637ce0. PR #503 already closed E-20i Runtime-vs-Enterprise separation and supervisor test CI wiring, so this decomposition task is limited to remaining valid release workflow and stale document-generation residuals.
- 2026-10-04T17:35:00+09:00: Repaired Brownie-generated leaf TODOs after TODO guard rejection. Converted the missing workflow path from Patch only to Create only, removed the owner-blocker dependency from the implementable workflow leaf, and replaced hallucinated uppercase documentation paths with existing `docs/architecture/*` files.

## TODO-decompose-blocked-queue-71820ffb9fb9

Parent TODO: TODO-decompose-blocked-queue-71820ffb9fb9: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs.

Dependency graph:

- E-15a-redaction-collector-exact-pattern-line: <none>
- E-15a-redaction-collector-path-helper: E-15a-redaction-collector-exact-pattern-line
- E-15a-redaction-collector-output-fields: E-15a-redaction-collector-path-helper
- E-15a-redaction-collector-output-wire-run-result: E-15a-redaction-collector-path-helper
- E-15a-redaction-guard-path-output-fixtures: E-15a-redaction-collector-output-wire-run-result
- E-15a-redaction-generated-evidence-regression: <none>
- E-15b-provenance-collector-current-commit-field: E-15a-redaction-guard-path-output-fixtures
- E-15b-provenance-collector-clean-tree-field: E-15b-provenance-collector-current-commit-field
- E-15b-release-contract-null-binding-test: E-15b-provenance-collector-clean-tree-field
- E-15b-release-contract-null-binding-guard: E-15b-release-contract-null-binding-test
- E-15c-artifact-smoke-e2e-steps-test: <none>
- E-15c-artifact-smoke-e2e-steps-guard: E-15c-artifact-smoke-e2e-steps-test
- E-15c-artifact-smoke-collector-fail-closed: E-15c-artifact-smoke-e2e-steps-guard
- E-15d-soak-version-only-test: <none>
- E-15d-soak-stateful-steps-guard: E-15d-soak-version-only-test
- E-15d-soak-collector-fail-closed: E-15d-soak-stateful-steps-guard
- E-15d-stateful-soak-runner-fixture: <none>
- E-15d-stateful-soak-runner-real: <none>
- E-15d-soak-section-collector: <none>
- E-21c-replan-stalled-leaf-001: <none>
- E-21c-replan-stalled-leaf-002: E-21c-replan-stalled-leaf-001
- E-15e-todo-queue-decomposition: <none>
- E-15f-todo-breakdown-update: <none>
- E-50a-read-full-todo-queue: <none>
- E-16f-release-contract-owner-governance-evidence-path: none
- E-16e-semantic-consistency-guard-test-verify-step1b: E-16e-semantic-consistency-guard-test-verify-step1a
- E-16e-semantic-consistency-guard-test-verify-step1c: E-16e-semantic-consistency-guard-test-verify-step1b
- E-16e-semantic-consistency-guard-test-verify-step1a: <none>
- E-16e-semantic-consistency-guard-test-verify-step1: <none>
- E-16d-stateful-soak-test-step1b-s1a-5: <none>
- E-16d-stateful-soak-test-step1b-s1a-4: <none>
- E-16d-stateful-soak-test-step1b-s1a-3: <none>
- E-16d-stateful-soak-test-step1b-s1a-2: <none>
- E-16d-stateful-soak-test-step1b-s1a-1: <none>
- E-16d-stateful-soak-test-step1b-s1a: <none>
- E-16d-stateful-soak-test-step1b-s1: <none>
- E-16d-stateful-soak-test-step1b: E-16d-stateful-soak-test-step1a
- E-16d-stateful-soak-test-step1a: <none>
- E-16d-stateful-soak-test-step1: <none>
- E-15e-doc-sync-leaf: <none>
- E-15d-soak-section-guard-fix: E-15d-soak-section-collector
- E-15d-soak-section-collector-step1a-fix-1: <none>
- E-15d-soak-section-collector-step1a-fix-1: <none>
- E-15d-soak-section-collector-step1a-fix-1: <none>
- E-15d-soak-section-collector-step1a-fix: <none>
- E-15d-soak-section-collector-step1a: <none>
- E-15d-soak-section-collector-step1: <none>
- E-15d-soak-section-guard: E-15d-soak-section-collector
- E-15g-pr435-hygiene-inspect: <none>
- E-15a-redaction-collector: <none>
- E-15a-redaction-guard: E-15a-redaction-collector
- E-15b-provenance-collector-a: <none>
- E-15b-release-contract-binding-guard-a: E-15b-provenance-collector-a
- E-15c-artifact-smoke-runner-contract: <none>
- E-15d-stateful-soak-contract: E-15c-artifact-smoke-runner-contract
- E-15e-release-doc-resync-after-evidence: E-15a-redaction-guard, E-15b-release-contract-binding-guard-a, E-15c-artifact-smoke-runner-contract, E-15d-stateful-soak-contract
- E-15f-semantic-consistency-guard: E-15b-release-contract-binding-guard-a, E-15c-artifact-smoke-runner-contract, E-15d-stateful-soak-contract
- E-15g-pr435-hygiene-evidence: <none>

- E-15e-release-contract-audit-phase-resync-doc-sync-leaf: <none>

- E-15f-semantic-consistency-guard-test: <none>

- E-16f-release-contract-owner-governance: E-16e-semantic-consistency-guard-wiring
- E-16f-phase-final-judgment-sync-leaf-1: E-16f-release-contract-audit-sync
- E-16f-phase-final-judgment-sync-leaf-2: E-16f-release-contract-audit-sync
- E-16f-phase-value-gate-contract-sync: <none>
- E-16f-phase-final-judgment-sync-leaf-2-step1: <none>
- E-16f-phase-final-judgment-sync-leaf-2-step1-small: <none>
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2: <none>
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1: <none>
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2: <none>
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2: E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2: E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step: <none>
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1: <none>
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2: E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify: <none>
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf: <none>
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2: <none>
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2-small-step: <none>
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2-small-step-verify: <none>
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2-small-step-verify-small-step: <none>
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2-small-step-verify-small-step-verify: <none>
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2-small-step-verify-small-step-verify-small-step: <none>
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2-small-step-verify-small-step-verify-small-step-repair1: <none>
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2-small-step-verify-small-step-verify-small-step-repair1-leaf2-step3-small-leaf2-patch3-small-step: <none>
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2-small-step-verify-small-step-verify-small-step-repair1-leaf2-step3-small-leaf2-patch3-small-step-verify-title: <none>
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2-small-step-verify-small-step-verify-small-step-repair1-leaf2-step3-small-leaf2-patch3-small-step-verify-title-small-step: <none>
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2-small-step-verify-small-step-verify-small-step-repair1-leaf2-step3-small-leaf2-patch3-small-step-verify-title-small-step-verify: <none>
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2-small-step-verify-small-step-verify-small-step-repair1-leaf2-step3-small-leaf2-patch3-small-step-verify-title-small-step-verify-small-step: <none>
- E-16f-phase-value-gate-contract-sync-leaf-1: <none>
- E-16f-phase-value-gate-contract-sync-leaf-2: <none>
- E-16f-phase-value-gate-contract-sync-leaf-3: <none>
- E-16f-phase-value-gate-contract-sync-leaf-4: <none>
- E-16f-phase-value-gate-contract-sync-leaf-5: <none>
- E-19d-01-read-soak-source: none
- E-19d-02-soak-impl: E-19d-01-read-soak-source
- E-19d-02-soak-read-entry: none
- E-19d-03-soak-scope-extract: E-19d-02-soak-read-entry
- E-19h-1-release-contract-trace-schema: none
- E-19h-2-release-contract-trace-guard: E-19h-1-release-contract-trace-schema
- E-19h-2-audit-schema-trace-binding: none
- E-19h-3-schema-validation-script: E-19h-2-audit-schema-trace-binding
- E-19h-2a-audit-schema-ledger-kind: none
- E-19h-2b-audit-schema-payload-fingerprint: E-19h-2a-audit-schema-ledger-kind
- E-19h-2b-audit-schema-payload-classification: <none>
- E-19h-2b-audit-schema-fingerprint-fields: E-19h-2b-audit-schema-payload-classification
- E-19h-2b-audit-schema-fingerprint-leaf-1: <none>
- E-19h-2b-audit-schema-fingerprint-leaf-2: E-19h-2b-audit-schema-fingerprint-leaf-1
- E-19h-2a-trace-schema-guard: <none>
- E-19h-2b-trace-guard-wiring: E-19h-2a-trace-schema-guard
- E-19h-01: none
- E-19h-02: E-19h-01
- E-19h-02a: <none>
- E-19h-02b: E-19h-02a
Verification ledger:

- E-15a-redaction-collector-exact-pattern-line: `pnpm --workspace-root guard:runtime-operational-evidence:test`
- E-15a-redaction-collector-path-helper: `pnpm --workspace-root guard:runtime-operational-evidence:test`
- E-15a-redaction-collector-output-fields: `pnpm --workspace-root guard:runtime-operational-evidence:test`
- E-15a-redaction-collector-output-wire-run-result: `pnpm --workspace-root guard:runtime-operational-evidence:test`
- E-15a-redaction-guard-path-output-fixtures: `pnpm --workspace-root guard:runtime-operational-evidence:test`; `pnpm --workspace-root guard:runtime-operational-evidence`
- E-15a-redaction-generated-evidence-regression: `pnpm --workspace-root guard:runtime-operational-evidence:test`; `pnpm --workspace-root guard:runtime-operational-evidence`
- E-15b-provenance-collector-current-commit-field: `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`
- E-15b-provenance-collector-clean-tree-field: `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`; `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-15b-release-contract-null-binding-test: `pnpm --workspace-root guard:release-contract:test`
- E-15b-release-contract-null-binding-guard: `pnpm --workspace-root guard:release-contract:test`; `pnpm --workspace-root guard:release-contract`
- E-15c-artifact-smoke-e2e-steps-test: `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`
- E-15c-artifact-smoke-e2e-steps-guard: `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`; `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-15c-artifact-smoke-collector-fail-closed: `pnpm --workspace-root release:supply-chain-artifact-evidence`; `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`; `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-15d-soak-version-only-test: `pnpm --workspace-root guard:runtime-operational-evidence:test`
- E-15d-soak-stateful-steps-guard: `pnpm --workspace-root guard:runtime-operational-evidence:test`; `pnpm --workspace-root guard:runtime-operational-evidence`
- E-15d-soak-collector-fail-closed: `pnpm --workspace-root release:runtime-operational-evidence`; `pnpm --workspace-root guard:runtime-operational-evidence:test`; `pnpm --workspace-root guard:runtime-operational-evidence`
- E-15d-stateful-soak-runner-fixture: `pnpm --workspace-root guard:runtime-operational-evidence:test`; `pnpm --workspace-root guard:runtime-operational-evidence`
- E-15d-stateful-soak-runner-real: `pnpm --workspace-root guard:runtime-operational-evidence:test`; `pnpm --workspace-root guard:runtime-operational-evidence`
- E-15d-soak-section-collector: `pnpm --workspace-root guard:runtime-operational-evidence:test`
- E-15e-todo-queue-decomposition: run `pnpm --workspace-root guard:todo-decomposition` and `pnpm --workspace-root phase-loop:todo-queue-integrity`.
- E-15f-todo-breakdown-update: run `pnpm --workspace-root guard:todo-decomposition` and inspect `.brownie/todo-breakdown.md` for the new entries.
- E-50a-read-full-todo-queue: inspect `.brownie/todo.md` and confirm release-ops blocker TODOs are visible in the queue.
- E-16f-release-contract-owner-governance-evidence-path: run `pnpm --workspace-root guard:release-contract` and inspect the owner_governance_evidence.default_path field in the contract JSON.
- E-16e-semantic-consistency-guard-test-verify-step1b: `node --test scripts/guard-release-evidence-semantic-consistency.test.mjs`
- E-16e-semantic-consistency-guard-test-verify-step1c: `node --test scripts/guard-release-evidence-semantic-consistency.test.mjs`
- E-15d-soak-section-guard: `pnpm --workspace-root guard:runtime-operational-evidence:test`; `pnpm --workspace-root guard:runtime-operational-evidence`
- E-15g-pr435-hygiene-inspect: inspect PR #435 state and record a bounded release-ops conclusion or fail-closed follow-up TODO.
- E-15a-redaction-collector: `pnpm --workspace-root guard:runtime-operational-evidence:test`
- E-15a-redaction-guard: `pnpm --workspace-root guard:runtime-operational-evidence:test`; `pnpm --workspace-root guard:runtime-operational-evidence`
- E-15b-provenance-collector-a: `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`; `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-15b-release-contract-binding-guard-a: `pnpm --workspace-root guard:release-contract:test`; `pnpm --workspace-root guard:release-contract`
- E-15c-artifact-smoke-runner-contract: artifact smoke guard tests; `pnpm --workspace-root guard:runtime-operational-evidence`
- E-15d-stateful-soak-contract: soak guard tests; `pnpm --workspace-root check`
- E-15e-release-doc-resync-after-evidence: `pnpm --workspace-root guard:runtime-release-readiness`; `pnpm --workspace-root guard:release-contract`; `pnpm --workspace-root guard:phase-value`; `pnpm --workspace-root check`
- E-15f-semantic-consistency-guard: new guard tests; `pnpm --workspace-root guard:phase-value`; `pnpm --workspace-root check`
- E-15g-pr435-hygiene-evidence: inspect PR #435 state and record a bounded release-ops conclusion or fail-closed TODO.

- E-15e-release-contract-audit-phase-resync-doc-sync-leaf: `pnpm --workspace-root guard:release-contract`

- E-15f-semantic-consistency-guard-test: `node --test scripts/guard-release-evidence-semantic-consistency.test.mjs`

- E-16f-release-contract-owner-governance: `pnpm --workspace-root guard:release-contract`
- E-16f-phase-final-judgment-sync-leaf-1: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-value-gate-contract-sync: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1-small: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2-small-step: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2-small-step-verify: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2-small-step-verify-small-step: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2-small-step-verify-small-step-verify: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2-small-step-verify-small-step-verify-small-step: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2-small-step-verify-small-step-verify-small-step-repair1: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2-small-step-verify-small-step-verify-small-step-repair1-leaf2-step3-small-leaf2-patch3-small-step: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2-small-step-verify-small-step-verify-small-step-repair1-leaf2-step3-small-leaf2-patch3-small-step-verify-title: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2-small-step-verify-small-step-verify-small-step-repair1-leaf2-step3-small-leaf2-patch3-small-step-verify-title-small-step: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2-small-step-verify-small-step-verify-small-step-repair1-leaf2-step3-small-leaf2-patch3-small-step-verify-title-small-step-verify: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-final-judgment-sync-leaf-2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-leaf2-step3-small-leaf2-patch3-leaf2-small-step-leaf2-step1-small-leaf2-patch1-leaf2-step2-small-leaf2-patch2-small-verify-leaf-2-small-step-verify-small-step-verify-small-step-repair1-leaf2-step3-small-leaf2-patch3-small-step-verify-title-small-step-verify-small-step: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-value-gate-contract-sync-leaf-1: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-value-gate-contract-sync-leaf-2: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-value-gate-contract-sync-leaf-3: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-value-gate-contract-sync-leaf-4: `pnpm --workspace-root guard:phase-value`
- E-16f-phase-value-gate-contract-sync-leaf-5: `pnpm --workspace-root guard:phase-value`
- E-19d-01-read-soak-source: `.brownie/todo.md`; `E-19d-stateful-soak-required-steps`
- E-19d-02-soak-impl: `cargo test --package brownie-soak --test soak_stateful -- --test-threads=1`
- E-19d-02-soak-read-entry: `.brownie/todo.md`; `E-19d-stateful-soak-required-steps`
- E-19d-03-soak-scope-extract: inspect extracted scope for concrete file paths and bounded verification commands
- E-19h-1-release-contract-trace-schema: `node scripts/validate-audit-schema.mjs docs/architecture/runtime-release-readiness-audit.json`
- E-19h-2-release-contract-trace-guard: `node scripts/release-gate.mjs --validate-trace-binding`
- E-19h-2-audit-schema-trace-binding: `node scripts/validate-audit-schema.mjs docs/architecture/runtime-release-readiness-audit.json`
- E-19h-3-schema-validation-script: `node scripts/validate-audit-schema.mjs docs/architecture/runtime-release-readiness-audit.json`
- E-19h-2a-audit-schema-ledger-kind: `node scripts/validate-audit-schema.mjs docs/architecture/runtime-release-readiness-audit.json`
- E-19h-2b-audit-schema-payload-fingerprint: `node scripts/validate-audit-schema.mjs docs/architecture/runtime-release-readiness-audit.json`
- E-19h-2b-audit-schema-payload-classification: `node scripts/validate-audit-schema.mjs docs/architecture/runtime-release-readiness-audit.json`
- E-19h-2b-audit-schema-fingerprint-fields: `node scripts/validate-audit-schema.mjs docs/architecture/runtime-release-readiness-audit.json`
- E-19h-2b-audit-schema-fingerprint-leaf-1: `node scripts/validate-audit-schema.mjs docs/architecture/runtime-release-readiness-audit.json`
- E-19h-2b-audit-schema-fingerprint-leaf-2: `node scripts/validate-audit-schema.mjs docs/architecture/runtime-release-readiness-audit.json`
- E-19h-2a-trace-schema-guard: `node scripts/release-gate.mjs --validate-trace-binding --test-schema`
- E-19h-2b-trace-guard-wiring: `node scripts/release-gate.mjs --validate-trace-binding`
- E-19h-01: `node scripts/validate-json.js docs/architecture/runtime-release-readiness-audit.json`
- E-19h-02: `cargo check --package brownie-protocol`
- E-19h-02a: `cargo check --package brownie-protocol`
- E-19h-02b: `cargo check --package brownie-protocol`; `cargo test --package brownie-protocol`
Quality rubric:

- Each leaf must be small enough for one bounded implementation pass.
- Each leaf must name at most two concrete `Patch only` or `Create only` targets unless it is an explicit blocker.
- `Completion condition` must describe a concrete observable outcome, not a broad Product Ready claim.
- `Verification` must match the route: implementation leaves need executable local checks; release-ops leaves use bounded inspection or fail-closed evidence.
- `Depends on` controls execution order; Brownie must not claim a leaf whose dependency remains pending.

History:

- 2026-09-13: Split broad E-15c cross-platform artifact smoke work into supply-chain evidence test, guard, and collector fail-closed leaves after Runtime repeated workspace.read without producing a patch.
- 2026-09-13: Split broad E-15d soak evidence work into version-only rejection test, stateful-step guard, and collector fail-closed leaves after Runtime read release contract/audit files and failed to produce a workspace.write.
- 2026-09-13: Added E-15d-stateful-soak-runner-fixture after the fail-closed work proved version-only soak is rejected but did not yet generate real stateful soak evidence.
- 2026-09-13: Restored a real E-15d stateful soak runner TODO after a verification-only false-positive completed the fixture leaf while evidence still reported `soak_test:not_executed`.
- 2026-09-13: Added second-level E-15a/E-15b/E-15g leaves after the first leaf set reached blocked history, so Brownie can resume with smaller bounded tasks instead of reselecting blocked work.
- 2026-09-13: Reopened a bounded E-15a generated-evidence regression leaf for real-operation testing after the redaction guard and current evidence had already passed, so Brownie can prove the closure path rather than relying on manual validation.
- 2026-09-13: Split E-15d-stateful-soak-runner-real into collector and guard leaves after repair-feedback testing proved Brownie needed a smaller bounded follow-up instead of repeated workspace.read attempts.
- 2026-09-13: Created after repeated no-progress decomposition loops to make parent/child/dependency/verification state explicit and guardable.

## TODO-decompose-broad-todo-fbbca34905ac

Parent TODO: E-15e-release-contract-audit-phase-resync: Resynchronize Release Contract, Release Readiness Audit, Phase Manifest, and final judgment after E-15a through E-15d.

Dependency graph:

- E-15e-release-contract-doc-sync-leaf: E-15d-soak-section-guard
- E-15e-release-audit-phase-sync-leaf: E-15e-release-contract-doc-sync-leaf

Verification ledger:

- E-15e-release-contract-doc-sync-leaf: `pnpm --workspace-root guard:release-contract`
- E-15e-release-audit-phase-sync-leaf: `pnpm --workspace-root guard:runtime-release-readiness`; `pnpm --workspace-root guard:phase-value`

History:

- 2026-09-14T05:53:41Z: Applied deterministic fallback after repeated no-progress TODO decomposition for E-15e-release-contract-audit-phase-resync; the fallback replaced the broad parent and decomposition request with two bounded documentation leaves.

## E-15e-release-audit-phase-sync-leaf split

Parent TODO: E-15e-release-audit-phase-sync-leaf: split after repeated read/write no-progress on a two-file documentation leaf.

Dependency graph:

- E-15e-release-readiness-audit-sync-leaf: E-15e-release-contract-doc-sync-leaf
- E-15e-phase-value-manifest-sync-leaf: E-15e-release-readiness-audit-sync-leaf

Verification ledger:

- E-15e-release-readiness-audit-sync-leaf: `pnpm --workspace-root guard:runtime-release-readiness`
- E-15e-phase-value-manifest-sync-leaf: `pnpm --workspace-root guard:phase-value`

History:

- 2026-09-14T06:04:47Z: Applied deterministic fallback after Brownie repeatedly failed to turn the two-file documentation leaf into a workspace.write.

## E-16 release executable evidence split

Parent TODO: E-16a/E-16b/E-16c/E-16d release executable evidence blockers reopened after owner-controlled review evidence was closed.

Dependency graph:

- E-16a-artifact-source-local-producer: <none>
- E-16a-artifact-source-local-producer-esm-helper-fix: E-16a-artifact-source-local-producer
- E-16a-artifact-source-linux-producer-helper: E-16a-artifact-source-local-producer
- E-16a-artifact-source-linux-producer-fields: E-16a-artifact-source-linux-producer-helper
- E-16a-clean-source-collector: E-16a-artifact-source-linux-producer-fields
- E-16a-clean-source-guard: E-16a-clean-source-collector
- E-16a-clean-source-test: E-16a-clean-source-guard
- E-16b-artifact-smoke-steps-guard: E-16a-clean-source-test
- E-16b-artifact-smoke-collector: E-16b-artifact-smoke-steps-guard
- E-16b-artifact-smoke-test: E-16b-artifact-smoke-collector
- E-16c-artifact-lifecycle-collector: E-16b-artifact-smoke-test
- E-16c-artifact-lifecycle-guard: E-16c-artifact-lifecycle-collector
- E-16c-artifact-lifecycle-test: E-16c-artifact-lifecycle-guard
- E-16d-stateful-soak-collector: E-16c-artifact-lifecycle-test
- E-16d-soak-build-transition-step: <none>
- E-16d-soak-build-transition-step-leaf-1: <none>
- E-16d-soak-build-transition-step-leaf-1: <none>
- E-16d-stateful-soak-guard: E-16d-soak-build-transition-step
- E-16d-stateful-soak-test: E-16d-stateful-soak-guard
- E-16e-semantic-consistency-guard-impl: E-16d-stateful-soak-test
- E-16e-guard-core-01: E-16d-stateful-soak-test
- E-16e-semantic-consistency-guard-test: E-16e-semantic-consistency-guard-impl
- E-16e-semantic-consistency-guard-test-verify: E-16e-semantic-consistency-guard-impl
- E-16e-semantic-consistency-guard-wiring: E-16e-semantic-consistency-guard-test
- E-16f-release-contract-audit-sync: E-16e-semantic-consistency-guard-wiring
- E-16f-phase-final-judgment-sync: E-16f-release-contract-audit-sync
- E-16g-pr435-hygiene-closeout: E-16f-phase-final-judgment-sync
- BDK-01-agent-skills-adapter-architecture: <none>
- BDK-02-agent-skills-lock-schema: BDK-01-agent-skills-adapter-architecture
- BDK-03-agent-skills-guard-plan: BDK-02-agent-skills-lock-schema

Verification ledger:

- E-16a-artifact-source-local-producer: `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`; `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-16a-artifact-source-local-producer-esm-helper-fix: `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`; `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-16a-artifact-source-linux-producer-helper: `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`; `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-16a-artifact-source-linux-producer-fields: `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`; `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-16a-clean-source-collector: `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`; `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-16a-clean-source-guard: `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`; `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-16a-clean-source-test: `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`; `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-16b-artifact-smoke-steps-guard: `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`; `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-16b-artifact-smoke-collector: `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`; `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-16b-artifact-smoke-test: `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`; `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-16c-artifact-lifecycle-collector: `pnpm --workspace-root guard:runtime-operational-evidence:test`; `pnpm --workspace-root guard:runtime-operational-evidence`
- E-16c-artifact-lifecycle-guard: `pnpm --workspace-root guard:runtime-operational-evidence:test`; `pnpm --workspace-root guard:runtime-operational-evidence`
- E-16c-artifact-lifecycle-test: `pnpm --workspace-root guard:runtime-operational-evidence:test`; `pnpm --workspace-root guard:runtime-operational-evidence`
- E-16d-stateful-soak-collector: `pnpm --workspace-root guard:runtime-operational-evidence:test`; `pnpm --workspace-root guard:runtime-operational-evidence`
- E-16d-soak-build-transition-step: `pnpm --workspace-root guard:runtime-operational-evidence:test`
- E-16d-stateful-soak-guard: `pnpm --workspace-root guard:runtime-operational-evidence:test`; `pnpm --workspace-root guard:runtime-operational-evidence`
- E-16d-stateful-soak-test: `pnpm --workspace-root guard:runtime-operational-evidence:test`; `pnpm --workspace-root guard:runtime-operational-evidence`
- E-16e-semantic-consistency-guard-impl: `node --test scripts/guard-release-evidence-semantic-consistency.test.mjs`
- E-16e-guard-core-01: `node --test scripts/guard-release-evidence-semantic-consistency.test.mjs`
- E-16e-semantic-consistency-guard-test: `node --test scripts/guard-release-evidence-semantic-consistency.test.mjs`
- E-16e-semantic-consistency-guard-test-verify: `node --test scripts/guard-release-evidence-semantic-consistency.test.mjs`
- E-16e-semantic-consistency-guard-wiring: `node --test scripts/guard-release-evidence-semantic-consistency.test.mjs`; `node scripts/guard-release-evidence-semantic-consistency.mjs`; `pnpm --workspace-root release:gate -- --dry-run`
- E-16f-release-contract-audit-sync: `pnpm --workspace-root guard:release-contract`; `pnpm --workspace-root guard:runtime-release-readiness`
- E-16f-phase-final-judgment-sync: `pnpm --workspace-root guard:phase-value`; `pnpm --workspace-root guard:runtime-release-readiness`; `pnpm --workspace-root check`
- E-16g-pr435-hygiene-closeout: inspect `.brownie/release-evidence/pr435-hygiene-evidence.json` and confirm it names PR #435 state, conclusion, and any exact residue.
- BDK-01-agent-skills-adapter-architecture: `pnpm --workspace-root guard:todo-decomposition`
- BDK-02-agent-skills-lock-schema: `pnpm --workspace-root guard:todo-decomposition`
- BDK-03-agent-skills-guard-plan: `pnpm --workspace-root guard:todo-decomposition`

Quality rubric:

- Each leaf names exactly one concrete Patch only target so current phase-loop read/write routing can inspect the intended file.
- Artifact producer leaves record source identity at build time before collectors bind artifacts to tested source commits.
- Collector leaves update evidence generation with bounded sanitized fields.
- Guard leaves add or tighten executable validation without claiming Runtime Release Ready.
- Test leaves add focused regression coverage only after the corresponding production path exists.
- Dependency order prevents smoke, lifecycle, and soak work from running before source binding is clean.

History:

- 2026-09-15: Split broad E-16 executable release evidence blockers after live phase-loop returned `no_actionable_runtime_task`; the split makes the next schedulable item a bounded implementation leaf instead of an ambiguous parent TODO.
- 2026-09-15: Refined PR #460 after review showed multi-file `Patch only` leaves exceed current phase-loop read routing and artifact provenance needs producer-side source identity before collector-side binding.
- 2026-09-15: Added E-16e/E-16f/E-16g after external review found the production semantic consistency guard, release document resync, and PR #435 hygiene closeout were still missing from the executable queue.
- 2026-09-15: Added E-16a-artifact-source-local-producer-esm-helper-fix after real-operation testing found the completed local producer leaf had introduced `require` calls inside an ESM `.mjs` module.
- 2026-09-19: Added BDK Agent Skills compatibility leaves after live phase-loop testing showed ad-hoc workflow branches were too narrow and should move toward public Agent Skills-compatible workflows wrapped by Brownie policy and guards.

## E-17 executable release evidence queue

Parent TODO: External d5478db Product Ready audit found `.brownie/todo.md` empty while executable Runtime Release evidence remained incomplete.

Derived leaves:

- E-17a-clean-source-state-helper
- E-17a-source-state-helper-exit-code-fix
- E-17a-dirty-source-refusal
- E-17a-artifact-runner-source-state-result
- E-17a-clean-artifact-source-binding
- E-17b-e2e-artifact-smoke-runner
- E-17c-artifact-lifecycle-runner
- E-17d-stateful-soak-runner
- E-17e-dependency-scan-failure-closure
- E-17f-vsix-semantic-consistency-ci-binding
- E-17g-release-contract-sync
- E-17g-readiness-audit-sync
- E-17g-phase-final-judgment-sync
- E-17h-stale-pr-435-blocker

Dependency graph:

- E-17a-clean-source-state-helper: <none>
- E-17a-source-state-helper-exit-code-fix: <none>
- E-17a-dirty-source-refusal: E-17a-source-state-helper-exit-code-fix
- E-17a-artifact-runner-source-state-result: E-17a-dirty-source-refusal
- E-17a-clean-artifact-source-binding: E-17a-artifact-runner-source-state-result
- E-17b-e2e-artifact-smoke-runner: E-17a-clean-artifact-source-binding
- E-17c-artifact-lifecycle-runner: E-17b-e2e-artifact-smoke-runner
- E-17d-stateful-soak-runner: E-17c-artifact-lifecycle-runner
- E-17e-dependency-scan-failure-closure: E-17d-stateful-soak-runner
- E-17f-vsix-semantic-consistency-ci-binding: E-17e-dependency-scan-failure-closure
- E-17g-release-contract-sync: E-17f-vsix-semantic-consistency-ci-binding
- E-17g-readiness-audit-sync: E-17g-release-contract-sync
- E-17g-phase-final-judgment-sync: E-17g-readiness-audit-sync
- E-17h-stale-pr-435-blocker: E-17g-phase-final-judgment-sync

Verification ledger:

- E-17a-clean-source-state-helper: `pnpm --workspace-root guard:local-release-targets`; `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`
- E-17a-source-state-helper-exit-code-fix: `pnpm --workspace-root guard:local-release-targets`; `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`
- E-17a-dirty-source-refusal: `pnpm --workspace-root guard:local-release-targets`; `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`
- E-17a-artifact-runner-source-state-result: `pnpm --workspace-root guard:local-release-targets`; `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`
- E-17a-clean-artifact-source-binding: `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`; `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-17b-e2e-artifact-smoke-runner: `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`; `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-17c-artifact-lifecycle-runner: `pnpm --workspace-root guard:runtime-operational-evidence:test`; `pnpm --workspace-root guard:runtime-operational-evidence`
- E-17d-stateful-soak-runner: `pnpm --workspace-root guard:runtime-operational-evidence:test`; `pnpm --workspace-root guard:runtime-operational-evidence`
- E-17e-dependency-scan-failure-closure: `pnpm --workspace-root release:dependency-security-license-audit:test`; `pnpm --workspace-root guard:dependency-security-license-audit`
- E-17f-vsix-semantic-consistency-ci-binding: `pnpm --workspace-root guard:release-contract:test`; `pnpm --workspace-root guard:release-evidence-semantic-consistency:test`
- E-17g-release-contract-sync: `pnpm --workspace-root guard:release-contract`
- E-17g-readiness-audit-sync: `pnpm --workspace-root guard:runtime-release-readiness`
- E-17g-phase-final-judgment-sync: `pnpm --workspace-root guard:phase-value`
- E-17h-stale-pr-435-blocker: inspect GitHub PR #435 state and fail closed until globalpocket performs the closeout.

Quality rubric:

- E-17 leaves must repair executable evidence before extending BDK-only features.
- Each implementation leaf must preserve sanitized evidence and fail-closed blockers rather than writing raw local paths or process output.
- Documentation leaves may only sync the contract, audit, manifest, and final judgment after executable guard coverage exists.
- PR #435 hygiene remains a release-ops blocker because the implementation actor must not review, close, approve, or merge pull requests.

History:

- 2026-09-21: Reopened the Product Ready Blocking Queue after the d5478db audit showed Runtime evidence incomplete but the queue empty, which would otherwise let the phase-loop stop prematurely.
- 2026-09-21: Added E-17a-source-state-helper-exit-code-fix after live loop execution completed the helper leaf but used the nonexistent `exitCode` field instead of the existing `exit_code` result field.

## E-18 release evidence follow-up queue

Parent TODO: External 9e2239b Product Ready audit found the queue empty while release evidence blockers remained, VSIX package metadata contained duplicate top-level `scripts`, and executable release evidence remained stale or disconnected.

Derived leaves:

- E-18a-vsix-package-scripts-dedupe
- E-18b-semantic-guard-ci-direct-step
- E-18c-release-blocker-nonempty-todo-guard
- E-18d-connect-artifact-source-identity-flow
- E-18e-connect-artifact-lifecycle-flow
- E-18f-connect-stateful-soak-flow
- E-18g-regenerate-integrated-release-evidence
- E-18h-bind-release-contract-to-current-evidence
- E-18i-release-doc-authority-sync

Dependency graph:

- E-18a-vsix-package-scripts-dedupe: <none>
- E-18b-semantic-guard-ci-direct-step: E-18a-vsix-package-scripts-dedupe
- E-18c-release-blocker-nonempty-todo-guard: E-18b-semantic-guard-ci-direct-step
- E-18d-connect-artifact-source-identity-flow: E-18c-release-blocker-nonempty-todo-guard
- E-18e-connect-artifact-lifecycle-flow: E-18d-connect-artifact-source-identity-flow
- E-18f-connect-stateful-soak-flow: E-18e-connect-artifact-lifecycle-flow
- E-18g-regenerate-integrated-release-evidence: E-18f-connect-stateful-soak-flow
- E-18h-bind-release-contract-to-current-evidence: E-18g-regenerate-integrated-release-evidence
- E-18i-release-doc-authority-sync: E-18h-bind-release-contract-to-current-evidence

Verification ledger:

- E-18a-vsix-package-scripts-dedupe: `pnpm --workspace-root check`
- E-18b-semantic-guard-ci-direct-step: `pnpm --workspace-root guard:release-evidence-semantic-consistency:test`; `pnpm --workspace-root guard:phase-value`
- E-18c-release-blocker-nonempty-todo-guard: `pnpm --workspace-root guard:todo-decomposition:test`; `pnpm --workspace-root guard:todo-decomposition`
- E-18d-connect-artifact-source-identity-flow: `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`; `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-18e-connect-artifact-lifecycle-flow: `pnpm --workspace-root guard:runtime-operational-evidence:test`; `pnpm --workspace-root guard:runtime-operational-evidence`
- E-18f-connect-stateful-soak-flow: `pnpm --workspace-root guard:runtime-operational-evidence:test`; `pnpm --workspace-root guard:runtime-operational-evidence`
- E-18g-regenerate-integrated-release-evidence: `pnpm --workspace-root release:supply-chain-artifact-evidence`; `pnpm --workspace-root release:runtime-operational-evidence:failclosed-ok`; `pnpm --workspace-root guard:supply-chain-artifact-evidence`; `pnpm --workspace-root guard:runtime-operational-evidence`
- E-18h-bind-release-contract-to-current-evidence: `pnpm --workspace-root guard:release-contract`; `pnpm --workspace-root guard:runtime-release-readiness`
- E-18i-release-doc-authority-sync: `pnpm --workspace-root guard:phase-value`; `pnpm --workspace-root check`

Quality rubric:

- E-18 leaves must keep Product Ready and Runtime Release Ready false until executable evidence is complete.
- Guard and CI wiring leaves must prove commands are reachable, not just present in a shadowed JSON object.
- Evidence producer leaves must connect existing helpers to generated evidence instead of adding unused helper code.
- Evidence regeneration leaves must use collectors and preserve sanitized fail-closed evidence.
- Documentation leaves may only sync release authority after generated evidence and guards are connected.

History:

- 2026-09-21: Reopened Product Ready Blocking Queue after review of 9e2239b found `.brownie/todo.md` empty while Product Ready was false and release evidence blockers remained.

## E-19 empty queue completion guard follow-up

Parent TODO: Empty queue regression follow-up after live phase-loop completed E-18h/E-18i, removed the last queue entries, and stopped while Runtime Product Ready was still false and release blockers remained.

Derived leaves:

- E-19a-prevent-empty-queue-completion
- E-19b-refresh-owner-governance-evidence-after-stable-ci

Dependency graph:

- E-19a-prevent-empty-queue-completion: E-18i-release-doc-authority-sync
- E-19b-refresh-owner-governance-evidence-after-stable-ci: E-19a-prevent-empty-queue-completion

Verification ledger:

- E-19a-prevent-empty-queue-completion: `pnpm --workspace-root phase-loop:claim-smoke`; `pnpm --workspace-root guard:todo-decomposition:test`; `pnpm --workspace-root guard:todo-decomposition`
- E-19b-refresh-owner-governance-evidence-after-stable-ci: inspect latest main CI completion and fail-closed owner governance evidence; keep the blocker when GitHub checks are pending or unavailable.

Quality rubric:

- E-19a must prevent completion cleanup from producing a guard-invalid TODO queue instead of weakening the TODO guard.
- E-19b must remain release-ops and must not use local implementation commands as its verification contract.
- Both leaves must keep Runtime Product Ready and Runtime Release Ready false until executable release evidence is complete.

History:

- 2026-09-22: Added after the live loop stopped on an empty queue while Product Ready was still false, proving E-18c needed an enforcement point in completion cleanup as well as standalone guard coverage.

## TODO-decompose-broad-todo-59d4c4e4b228 deterministic scope split

Parent TODO: E-19d-stateful-soak-required-steps

Dependency graph:

- E-19d-stateful-soak-required-steps-scope-1-release-runtime-operational-: <none>
- E-19d-stateful-soak-required-steps-scope-2-guard-runtime-operational-ev: E-19d-stateful-soak-required-steps-scope-1-release-runtime-operational-
- E-19d-stateful-soak-required-steps-scope-3-guard-runtime-operational-ev: E-19d-stateful-soak-required-steps-scope-2-guard-runtime-operational-ev

Verification ledger:

- E-19d-stateful-soak-required-steps-scope-1-release-runtime-operational-: run `pnpm --workspace-root guard:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`
- E-19d-stateful-soak-required-steps-scope-2-guard-runtime-operational-ev: run `pnpm --workspace-root guard:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`
- E-19d-stateful-soak-required-steps-scope-3-guard-runtime-operational-ev: run `pnpm --workspace-root guard:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`

Quality rubric:

- Derived leaves must be executable implementation/documentation leaves, not read-only planning leaves.
- Each leaf owns one bounded target path from the parent TODO.

History:

- 2026-09-22T14:02:01Z: Applied deterministic broad TODO scope split after repeated no-progress decomposition for E-19d-stateful-soak-required-steps; removed the active decomposition request and parent broad TODO.

## TODO-decompose-broad-todo-bb7a21bfd030 deterministic scope split

Parent TODO: E-19e-dependency-audit-supply-chain-sync

Dependency graph:

- E-19e-dependency-audit-supply-chain-sync-scope-1-release-supply-chain-artifac: <none>
- E-19e-dependency-audit-supply-chain-sync-scope-2-guard-supply-chain-artifact-: E-19e-dependency-audit-supply-chain-sync-scope-1-release-supply-chain-artifac
- E-19e-dependency-audit-supply-chain-sync-scope-3-supply-chain-artifact-eviden: E-19e-dependency-audit-supply-chain-sync-scope-2-guard-supply-chain-artifact-

Verification ledger:

- E-19e-dependency-audit-supply-chain-sync-scope-1-release-supply-chain-artifac: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`, `pnpm --workspace-root guard:dependency-security-license-audit`, and `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-19e-dependency-audit-supply-chain-sync-scope-2-guard-supply-chain-artifact-: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`, `pnpm --workspace-root guard:dependency-security-license-audit`, and `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-19e-dependency-audit-supply-chain-sync-scope-3-supply-chain-artifact-eviden: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`, `pnpm --workspace-root guard:dependency-security-license-audit`, and `pnpm --workspace-root guard:supply-chain-artifact-evidence`

Quality rubric:

- Derived leaves must be executable implementation/documentation leaves, not read-only planning leaves.
- Each leaf owns one bounded target path from the parent TODO.

History:

- 2026-09-22T14:42:45Z: Applied deterministic broad TODO scope split after repeated no-progress decomposition for E-19e-dependency-audit-supply-chain-sync; removed the active decomposition request and parent broad TODO.

## test leaf production guard synthesis 20260922T161524Z

Parent TODO: E-19e-dependency-audit-supply-chain-sync

Dependency graph:

- E-19e-dependency-audit-supply-chain-sync-production-guard: E-19e-dependency-audit-supply-chain-sync-scope-1-release-supply-chain-artifac
- E-19e-dependency-audit-supply-chain-sync-scope-2-guard-supply-chain-artifact-: E-19e-dependency-audit-supply-chain-sync-production-guard

Verification ledger:

- E-19e-dependency-audit-supply-chain-sync-production-guard: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`, `pnpm --workspace-root guard:dependency-security-license-audit`, and `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-19e-dependency-audit-supply-chain-sync-scope-2-guard-supply-chain-artifact-: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`, `pnpm --workspace-root guard:dependency-security-license-audit`, and `pnpm --workspace-root guard:supply-chain-artifact-evidence`

Quality rubric:

- Test-only leaves that fail because production validation is missing must synthesize a production guard leaf instead of retrying the same test patch.
- The original test leaf remains pending and depends on the synthesized production guard leaf.

History:

- 2026-09-22T16:15:25Z: Inserted production guard leaf `E-19e-dependency-audit-supply-chain-sync-production-guard` for `scripts/guard-supply-chain-artifact-evidence.mjs` after repeated no-progress on test-only leaf `E-19e-dependency-audit-supply-chain-sync-scope-2-guard-supply-chain-artifact-`.

## TODO-decompose-broad-todo-ff9ccb880617 deterministic scope split

Parent TODO: E-19f-artifact-source-identity-binding

Dependency graph:

- E-19f-artifact-source-identity-binding-scope-1-release-supply-chain-artifac: <none>
- E-19f-artifact-source-identity-binding-scope-2-guard-supply-chain-artifact-: E-19f-artifact-source-identity-binding-scope-1-release-supply-chain-artifac
- E-19f-artifact-source-identity-binding-scope-3-guard-supply-chain-artifact-: E-19f-artifact-source-identity-binding-scope-2-guard-supply-chain-artifact-

Verification ledger:

- E-19f-artifact-source-identity-binding-scope-1-release-supply-chain-artifac: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test` and `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-19f-artifact-source-identity-binding-scope-2-guard-supply-chain-artifact-: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test` and `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-19f-artifact-source-identity-binding-scope-3-guard-supply-chain-artifact-: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test` and `pnpm --workspace-root guard:supply-chain-artifact-evidence`

Quality rubric:

- Derived leaves must be executable implementation/documentation leaves, not read-only planning leaves.
- Each leaf owns one bounded target path from the parent TODO.

History:

- 2026-09-22T18:31:54Z: Applied deterministic broad TODO scope split after repeated no-progress decomposition for E-19f-artifact-source-identity-binding; removed the active decomposition request and parent broad TODO.

## TODO-decompose-broad-todo-3a23680b1d3f deterministic scope split

Parent TODO: E-19g-artifact-e2e-smoke-contract

Dependency graph:

- E-19g-artifact-e2e-smoke-contract-scope-1-release-supply-chain-artifac: <none>
- E-19g-artifact-e2e-smoke-contract-scope-2-guard-supply-chain-artifact-: E-19g-artifact-e2e-smoke-contract-scope-1-release-supply-chain-artifac
- E-19g-artifact-e2e-smoke-contract-scope-3-guard-supply-chain-artifact-: E-19g-artifact-e2e-smoke-contract-scope-2-guard-supply-chain-artifact-

Verification ledger:

- E-19g-artifact-e2e-smoke-contract-scope-1-release-supply-chain-artifac: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test` and `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-19g-artifact-e2e-smoke-contract-scope-2-guard-supply-chain-artifact-: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test` and `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-19g-artifact-e2e-smoke-contract-scope-3-guard-supply-chain-artifact-: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test` and `pnpm --workspace-root guard:supply-chain-artifact-evidence`

Quality rubric:

- Derived leaves must be executable implementation/documentation leaves, not read-only planning leaves.
- Each leaf owns one bounded target path from the parent TODO.

History:

- 2026-09-22T18:58:49Z: Applied deterministic broad TODO scope split after repeated no-progress decomposition for E-19g-artifact-e2e-smoke-contract; removed the active decomposition request and parent broad TODO.

## TODO-decompose-broad-todo-9430463ff3c2

Parent TODO: E-19h-release-contract-trace-binding

Dependency graph:
- E-19h-release-contract-trace-test: <none>
- E-19h-release-contract-trace-fields: E-19h-release-contract-trace-test

Verification ledger:
- E-19h-release-contract-trace-test: run `pnpm --workspace-root guard:release-contract:test`.
- E-19h-release-contract-trace-fields: run `pnpm --workspace-root guard:release-contract` and `pnpm --workspace-root guard:runtime-release-readiness`.

Quality rubric:
- E-19h-release-contract-trace-test: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.
- E-19h-release-contract-trace-fields: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.

History:

- 2026-09-28T12:36:15Z: Deterministically decomposed E-19h-release-contract-trace-binding during manual-20260928T123615Z; avoided LLM old_text patch anchors and resolved verification commands from existing package scripts.

## TODO-decompose-broad-todo-8c2d1506b8da

Parent TODO: E-19i-generation-sync-semantic-guard

Dependency graph:
- E-19i-generation-sync-semantic-guard-leaf-a: <none>
- E-19i-generation-sync-semantic-guard-leaf-b: E-19i-generation-sync-semantic-guard-leaf-a
- E-19i-generation-sync-semantic-guard-leaf-c: E-19i-generation-sync-semantic-guard-leaf-b

Verification ledger:
- E-19i-generation-sync-semantic-guard-leaf-a: run `pnpm --workspace-root guard:release-evidence-semantic-consistency:test` and `pnpm --workspace-root guard:release-evidence-semantic-consistency`.
- E-19i-generation-sync-semantic-guard-leaf-b: run `pnpm --workspace-root guard:phase-value`.
- E-19i-generation-sync-semantic-guard-leaf-c: run `pnpm --workspace-root guard:release-contract` and `pnpm --workspace-root guard:runtime-release-readiness`.

Quality rubric:
- E-19i-generation-sync-semantic-guard-leaf-a: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.
- E-19i-generation-sync-semantic-guard-leaf-b: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.
- E-19i-generation-sync-semantic-guard-leaf-c: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.

History:

- 2026-09-28T20:29:56Z: Deterministically decomposed E-19i-generation-sync-semantic-guard during 20260928T202954Z; avoided LLM old_text patch anchors and resolved verification commands from existing package scripts.

## TODO-decompose-broad-todo-0a6c3f9f95eb

Parent TODO: E-19j-branch-protection-verification-plan

Dependency graph:
- E-19j-branch-protection-verification-plan-leaf-a: <none>
- E-19j-branch-protection-verification-plan-leaf-b: E-19j-branch-protection-verification-plan-leaf-a

Verification ledger:
- E-19j-branch-protection-verification-plan-leaf-a: run `pnpm --workspace-root guard:release-contract` and `pnpm --workspace-root guard:runtime-release-readiness`.
- E-19j-branch-protection-verification-plan-leaf-b: run `pnpm --workspace-root guard:todo-decomposition`.

Quality rubric:
- E-19j-branch-protection-verification-plan-leaf-a: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.
- E-19j-branch-protection-verification-plan-leaf-b: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.

History:

- 2026-09-28T21:12:46Z: Deterministically decomposed E-19j-branch-protection-verification-plan during 20260928T211244Z; avoided LLM old_text patch anchors and resolved verification commands from existing package scripts.

## E-20g-final-judgment-sync no-eligible multi-target split

Parent TODO: E-20g-final-judgment-sync: - [ ] E-20g-final-judgment-sync: Patch only `docs/architecture/final-product-ready-judgment.md` and `scripts/guard-release-evidence-semantic-consistency.test.mjs`: require Final Judgment generation/status to match the live TODO/phase/audit blocker generation and reject stale E-17/E-18 Product Ready narratives.
Parent source: E-20g-final-judgment-sync

Targets:

- E-20g-final-judgment-sync-target-01: `docs/architecture/final-product-ready-judgment.md`
- E-20g-final-judgment-sync-target-02: `scripts/guard-release-evidence-semantic-consistency.test.mjs`

Dependency graph:

- E-20g-final-judgment-sync-target-01: <none>
- E-20g-final-judgment-sync-target-02: E-20g-final-judgment-sync-target-01

Verification ledger:

- E-20g-final-judgment-sync-target-01: `run `pnpm --workspace-root guard:release-evidence-semantic-consistency:test` and `pnpm --workspace-root guard:release-evidence-semantic-consistency``
- E-20g-final-judgment-sync-target-02: `run `pnpm --workspace-root guard:release-evidence-semantic-consistency:test` and `pnpm --workspace-root guard:release-evidence-semantic-consistency``

History:

- 2026-09-30T06:47:43Z: Applied deterministic no_eligible_task fallback during run 20260930T064742Z; the checked parent remains in the queue so existing downstream dependencies still have a durable dependency anchor, and the implementation work moves to ordered single-target leaves.

## E-20h-release-guard-ci-direct-wiring no-eligible multi-target split

Parent TODO: E-20h-release-guard-ci-direct-wiring: - [ ] E-20h-release-guard-ci-direct-wiring: Patch only `package.json` and `extensions/brownie-vsix/package.json`: wire Release-critical guard commands directly into CI-reached check paths instead of relying only on `release:gate --dry-run` enumeration.
Parent source: E-20h-release-guard-ci-direct-wiring

Targets:

- E-20h-release-guard-ci-direct-wiring-target-01: `package.json`
- E-20h-release-guard-ci-direct-wiring-target-02: `extensions/brownie-vsix/package.json`

Dependency graph:

- E-20h-release-guard-ci-direct-wiring-target-01: E-20g-final-judgment-sync
- E-20h-release-guard-ci-direct-wiring-target-02: <none>

Verification ledger:

- E-20h-release-guard-ci-direct-wiring-target-01: `run `pnpm --workspace-root guard:release-contract` and `pnpm --workspace-root guard:trace-binding``
- E-20h-release-guard-ci-direct-wiring-target-02: `run `pnpm --workspace-root guard:release-contract` and `pnpm --workspace-root guard:trace-binding``

History:

- 2026-10-01T06:34:24Z: Applied deterministic no_eligible_task fallback during run 20261001T063422Z; the checked parent remains in the queue so existing downstream dependencies still have a durable dependency anchor, and the implementation work moves to ordered single-target leaves.

## TODO-decompose-broad-todo-84ad36d83e8d

Parent TODO: E-21a-clean-release-workspace-contract

Dependency graph:
- E-21a-clean-release-workspace-contract-leaf-a: <none>
- E-21a-clean-release-workspace-contract-leaf-b: E-21a-clean-release-workspace-contract-leaf-a
- E-21a-clean-release-workspace-contract-leaf-c: E-21a-clean-release-workspace-contract-leaf-b

Verification ledger:
- E-21a-clean-release-workspace-contract-leaf-a: run `pnpm --workspace-root guard:release-contract` and `pnpm --workspace-root guard:runtime-release-readiness`.
- E-21a-clean-release-workspace-contract-leaf-b: run `pnpm --workspace-root guard:runtime-release-readiness`.
- E-21a-clean-release-workspace-contract-leaf-c: run `pnpm --workspace-root guard:todo-decomposition`.

Quality rubric:
- E-21a-clean-release-workspace-contract-leaf-a: bounded single target scope, valid Source TODO, existing verification command, and no Product Ready declaration.
- E-21a-clean-release-workspace-contract-leaf-b: bounded single target scope, valid Source TODO, existing verification command, and no Product Ready declaration.
- E-21a-clean-release-workspace-contract-leaf-c: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.

History:

- 2026-10-01T11:25:51Z: Deterministically decomposed E-21a-clean-release-workspace-contract during 20261001T112550Z; avoided LLM old_text patch anchors and resolved verification commands from existing package scripts.
- 2026-10-01T12:07:34Z: Keeper repaired the decomposition after completion integrity correctly rejected leaf-a because it bundled two documentation targets but Brownie changed only runtime-release-contract.json; split the remaining audit and scripts work into follow-up single-scope leaves so the loop can resume without weakening completion integrity.

## TODO-repair-E-21a-clean-release-workspace-contract-leaf-c-decompose-targets

Parent TODO: E-21a-clean-release-workspace-contract

Dependency graph:
- E-21a-clean-release-workspace-contract-leaf-c-decompose-targets: <none>

Verification ledger:
- E-21a-clean-release-workspace-contract-leaf-c-decompose-targets: run `pnpm --workspace-root guard:todo-decomposition`

Quality rubric:
- E-21a-clean-release-workspace-contract-leaf-c-decompose-targets: bounded TODO repair scope, valid Source TODO, existing verification command, and no Product Ready declaration.

History:

- 2026-10-01T13:59:34Z: Converted directory-scoped leaf E-21a-clean-release-workspace-contract-leaf-c into a Brownie-owned decomposition TODO because concrete Patch only/Create only file targets are required.

## TODO-repair-E-21b-release-workspace-guard-decompose-targets

Parent TODO: E-21b-release-workspace-guard

Dependency graph:
- E-21b-release-workspace-guard-decompose-targets: <none>

Verification ledger:
- E-21b-release-workspace-guard-decompose-targets: run `pnpm --workspace-root guard:todo-decomposition`

Quality rubric:
- E-21b-release-workspace-guard-decompose-targets: bounded TODO repair scope, valid Source TODO, existing verification command, and no Product Ready declaration.

History:

- 2026-10-01T14:01:10Z: Converted directory-scoped leaf E-21b-release-workspace-guard into a Brownie-owned decomposition TODO because concrete Patch only/Create only file targets are required.

## TODO-repair-E-21d-generation-consistency-guard-decompose-targets

Parent TODO: E-21d-generation-consistency-guard

Dependency graph:
- E-21d-generation-consistency-guard-decompose-targets: <none>

Verification ledger:
- E-21d-generation-consistency-guard-decompose-targets: run `pnpm --workspace-root guard:todo-decomposition`

Quality rubric:
- E-21d-generation-consistency-guard-decompose-targets: bounded TODO repair scope, valid Source TODO, existing verification command, and no Product Ready declaration.

History:

- 2026-10-01T14:01:41Z: Converted directory-scoped leaf E-21d-generation-consistency-guard into a Brownie-owned decomposition TODO because concrete Patch only/Create only file targets are required.

## TODO-repair-E-21c-release-ops-todo-split-decompose-targets

Parent TODO: E-21c-release-ops-todo-split

Dependency graph:
- E-21c-release-ops-todo-split-decompose-targets: E-21b-release-workspace-guard-decompose-targets

Verification ledger:
- E-21c-release-ops-todo-split-decompose-targets: run `pnpm --workspace-root guard:todo-decomposition`

Quality rubric:
- E-21c-release-ops-todo-split-decompose-targets: bounded TODO repair scope, valid Source TODO, existing verification command, and no Product Ready declaration.

History:

- 2026-10-01T14:07:35Z: Reopened E-21c as a Brownie-owned decomposition TODO after dirty-baseline verified-noop consumed the live TODO before improved Brownie could split the remaining Release Ops blocker into executable leaves.

## TODO-repair-E-21c-replan-stalled-leaf-6705771c47f0

Parent TODO: E-21c-runtime-operational-evidence-impl-2-target-02

Dependency graph:
- E-21c-replan-stalled-leaf-6705771c47f0: <none>

Verification ledger:
- E-21c-replan-stalled-leaf-6705771c47f0: run `pnpm --workspace-root guard:todo-decomposition` and `pnpm --workspace-root phase-loop:todo-queue-integrity`.

Quality rubric:
- E-21c-replan-stalled-leaf-6705771c47f0: replace the stalled leaf with implementable child TODOs while preserving parent intent, exact patch targets, existing verification commands, and fail-closed release evidence semantics.

History:

- 2026-10-03T19:39:55Z: Supervisor detected repeated invalid_patch/no_progress on E-21c-runtime-operational-evidence-impl-2-target-02 and promoted Brownie-owned TODO replan instead of retrying the same single-target leaf.

## TODO-repair-E-21e-owner-governance-reproducibility-decompose-targets

Parent TODO: E-21e-owner-governance-reproducibility

Dependency graph:
- E-21e-owner-governance-reproducibility-decompose-targets: <none>

Verification ledger:
- E-21e-owner-governance-reproducibility-decompose-targets: run `pnpm --workspace-root guard:todo-decomposition`

Quality rubric:
- E-21e-owner-governance-reproducibility-decompose-targets: bounded TODO repair scope, valid Source TODO, existing verification command, and no Product Ready declaration.

History:

- 2026-10-01T14:01:56Z: Converted directory-scoped leaf E-21e-owner-governance-reproducibility into a Brownie-owned decomposition TODO because concrete Patch only/Create only file targets are required.

## TODO-decompose-E-21a-clean-release-workspace-contract-leaf-c-decompose-targets

Parent TODO: E-21a-clean-release-workspace-contract

Dependency graph:
- E-21a-clean-release-workspace-contract-scripts-leaf-a: <none>

Verification ledger:
- E-21a-clean-release-workspace-contract-scripts-leaf-a: run `pnpm --workspace-root guard:release-contract:test` and `pnpm --workspace-root guard:release-contract`.

Quality rubric:
- E-21a-clean-release-workspace-contract-scripts-leaf-a: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.

History:

- 2026-10-01T18:13:00Z: Deterministically decomposed E-21a-clean-release-workspace-contract during 20261001T181300Z; avoided LLM old_text patch anchors and resolved verification commands from existing package scripts.

## E-21a-clean-release-workspace-contract-scripts-leaf-a no-eligible multi-target split

Parent TODO: E-21a-clean-release-workspace-contract-scripts-leaf-a: - [ ] E-21a-clean-release-workspace-contract-scripts-leaf-a: Patch only `scripts/guard-release-contract.mjs` and `scripts/guard-release-contract.test.mjs` to implement the script-specific slice requested by E-21a-clean-release-workspace-contract-leaf-c-decompose-targets:
Parent source: E-21a-clean-release-workspace-contract

Targets:

- E-21a-clean-release-workspace-contract-scripts-leaf-a-target-01: `scripts/guard-release-contract.mjs`
- E-21a-clean-release-workspace-contract-scripts-leaf-a-target-02: `scripts/guard-release-contract.test.mjs`

Dependency graph:

- E-21a-clean-release-workspace-contract-scripts-leaf-a-target-01: <none>
- E-21a-clean-release-workspace-contract-scripts-leaf-a-target-02: E-21a-clean-release-workspace-contract-scripts-leaf-a-target-01

Verification ledger:

- E-21a-clean-release-workspace-contract-scripts-leaf-a-target-01: `run `pnpm --workspace-root guard:release-contract:test` and `pnpm --workspace-root guard:release-contract``
- E-21a-clean-release-workspace-contract-scripts-leaf-a-target-02: `run `pnpm --workspace-root guard:release-contract:test` and `pnpm --workspace-root guard:release-contract``

History:

- 2026-10-01T18:22:06Z: Applied deterministic no_eligible_task fallback during run 20261001T182204Z; the checked parent remains in the queue so existing downstream dependencies still have a durable dependency anchor, and the implementation work moves to ordered single-target leaves.

## TODO-decompose-E-21b-release-workspace-guard-decompose-targets

Parent TODO: E-21b-release-workspace-guard

Dependency graph:
- E-21b-release-workspace-guard-scripts-leaf-a: <none>

Verification ledger:
- E-21b-release-workspace-guard-scripts-leaf-a: run `pnpm --workspace-root guard:release-contract:test` and `pnpm --workspace-root guard:release-contract`.

Quality rubric:
- E-21b-release-workspace-guard-scripts-leaf-a: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.

History:

- 2026-10-01T18:49:13Z: Deterministically decomposed E-21b-release-workspace-guard during 20261001T184913Z; avoided LLM old_text patch anchors and resolved verification commands from existing package scripts.

## TODO-decompose-E-21c-release-ops-todo-split-decompose-targets

Parent TODO: E-21c-release-ops-todo-split

Dependency graph:
- E-21c-release-ops-todo-split-clean-release-workspace: <none>
- E-21c-release-ops-todo-split-artifact-e2e-smoke: E-21c-release-ops-todo-split-clean-release-workspace
- E-21c-release-ops-todo-split-artifact-lifecycle: E-21c-release-ops-todo-split-artifact-e2e-smoke
- E-21c-release-ops-todo-split-golden-journey: E-21c-release-ops-todo-split-artifact-lifecycle
- E-21c-release-ops-todo-split-stateful-soak: E-21c-release-ops-todo-split-golden-journey
- E-21c-release-ops-todo-split-provenance-binding: E-21c-release-ops-todo-split-stateful-soak
- E-21c-release-ops-todo-split-owner-governance-reproducibility: E-21c-release-ops-todo-split-provenance-binding
- E-21c-release-ops-todo-split-document-generation-sync: E-21c-release-ops-todo-split-owner-governance-reproducibility

Verification ledger:
- E-21c-release-ops-todo-split-clean-release-workspace: blocker: Release Ops evidence remains fail-closed until this item is replaced by generated evidence or by a bounded implementation TODO with existing verification.
- E-21c-release-ops-todo-split-artifact-e2e-smoke: blocker: Release Ops evidence remains fail-closed until this item is replaced by generated evidence or by a bounded implementation TODO with existing verification.
- E-21c-release-ops-todo-split-artifact-lifecycle: blocker: Release Ops evidence remains fail-closed until this item is replaced by generated evidence or by a bounded implementation TODO with existing verification.
- E-21c-release-ops-todo-split-golden-journey: blocker: Release Ops evidence remains fail-closed until this item is replaced by generated evidence or by a bounded implementation TODO with existing verification.
- E-21c-release-ops-todo-split-stateful-soak: blocker: Release Ops evidence remains fail-closed until this item is replaced by generated evidence or by a bounded implementation TODO with existing verification.
- E-21c-release-ops-todo-split-provenance-binding: blocker: Release Ops evidence remains fail-closed until this item is replaced by generated evidence or by a bounded implementation TODO with existing verification.
- E-21c-release-ops-todo-split-owner-governance-reproducibility: blocker: Release Ops evidence remains fail-closed until this item is replaced by generated evidence or by a bounded implementation TODO with existing verification.
- E-21c-release-ops-todo-split-document-generation-sync: blocker: Release Ops evidence remains fail-closed until this item is replaced by generated evidence or by a bounded implementation TODO with existing verification.

Quality rubric:
- E-21c-release-ops-todo-split-clean-release-workspace: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.
- E-21c-release-ops-todo-split-artifact-e2e-smoke: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.
- E-21c-release-ops-todo-split-artifact-lifecycle: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.
- E-21c-release-ops-todo-split-golden-journey: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.
- E-21c-release-ops-todo-split-stateful-soak: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.
- E-21c-release-ops-todo-split-provenance-binding: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.
- E-21c-release-ops-todo-split-owner-governance-reproducibility: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.
- E-21c-release-ops-todo-split-document-generation-sync: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.

History:

- 2026-10-01T19:46:12Z: Deterministically decomposed E-21c-release-ops-todo-split during 20261001T194612Z; avoided LLM old_text patch anchors and resolved verification commands from existing package scripts.

## TODO-decompose-E-21d-generation-consistency-guard-decompose-targets

Parent TODO: E-21d-generation-consistency-guard

Dependency graph:
- E-21d-generation-consistency-guard-scripts-leaf-a: <none>

Verification ledger:
- E-21d-generation-consistency-guard-scripts-leaf-a: run `pnpm --workspace-root guard:release-evidence-semantic-consistency:test` and `pnpm --workspace-root guard:release-evidence-semantic-consistency`.

Quality rubric:
- E-21d-generation-consistency-guard-scripts-leaf-a: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.

History:

- 2026-10-01T20:11:34Z: Deterministically decomposed E-21d-generation-consistency-guard during 20261001T201134Z; avoided LLM old_text patch anchors and resolved verification commands from existing package scripts.

## E-21d-generation-consistency-guard-scripts-leaf-a no-eligible multi-target split

Parent TODO: E-21d-generation-consistency-guard-scripts-leaf-a: - [ ] E-21d-generation-consistency-guard-scripts-leaf-a: Patch only `scripts/guard-release-evidence-semantic-consistency.mjs` and `scripts/guard-release-evidence-semantic-consistency.test.mjs` to implement the script-specific slice requested by E-21d-generation-consistency-guard-decompose-targets:
Parent source: E-21d-generation-consistency-guard

Targets:

- E-21d-generation-consistency-guard-scripts-leaf-a-target-01: `scripts/guard-release-evidence-semantic-consistency.mjs`
- E-21d-generation-consistency-guard-scripts-leaf-a-target-02: `scripts/guard-release-evidence-semantic-consistency.test.mjs`

Dependency graph:

- E-21d-generation-consistency-guard-scripts-leaf-a-target-01: <none>
- E-21d-generation-consistency-guard-scripts-leaf-a-target-02: E-21d-generation-consistency-guard-scripts-leaf-a-target-01

Verification ledger:

- E-21d-generation-consistency-guard-scripts-leaf-a-target-01: `run `pnpm --workspace-root guard:release-evidence-semantic-consistency:test` and `pnpm --workspace-root guard:release-evidence-semantic-consistency``
- E-21d-generation-consistency-guard-scripts-leaf-a-target-02: `run `pnpm --workspace-root guard:release-evidence-semantic-consistency:test` and `pnpm --workspace-root guard:release-evidence-semantic-consistency``

History:

- 2026-10-01T20:19:24Z: Applied deterministic no_eligible_task fallback during run 20261001T201922Z; the checked parent remains in the queue so existing downstream dependencies still have a durable dependency anchor, and the implementation work moves to ordered single-target leaves.

## TODO-decompose-E-21e-owner-governance-reproducibility-decompose-targets

Parent TODO: E-21e-owner-governance-reproducibility

Dependency graph:
- E-21e-owner-governance-reproducibility-scripts-leaf-a: <none>

Verification ledger:
- E-21e-owner-governance-reproducibility-scripts-leaf-a: run `pnpm --workspace-root guard:owner-governance-evidence:test` and `pnpm --workspace-root guard:owner-governance-evidence`.

Quality rubric:
- E-21e-owner-governance-reproducibility-scripts-leaf-a: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.

History:

- 2026-10-01T22:55:21Z: Deterministically decomposed E-21e-owner-governance-reproducibility during 20261001T225521Z; avoided LLM old_text patch anchors and resolved verification commands from existing package scripts.

## E-21e-owner-governance-reproducibility-scripts-leaf-a no-eligible multi-target split

Parent TODO: E-21e-owner-governance-reproducibility-scripts-leaf-a: - [ ] E-21e-owner-governance-reproducibility-scripts-leaf-a: Patch only `scripts/guard-owner-governance-evidence.mjs` and `scripts/guard-owner-governance-evidence.test.mjs` to implement the script-specific slice requested by E-21e-owner-governance-reproducibility-decompose-targets:
Parent source: E-21e-owner-governance-reproducibility

Targets:

- E-21e-owner-governance-reproducibility-scripts-leaf-a-target-01: `scripts/guard-owner-governance-evidence.mjs`
- E-21e-owner-governance-reproducibility-scripts-leaf-a-target-02: `scripts/guard-owner-governance-evidence.test.mjs`

Dependency graph:

- E-21e-owner-governance-reproducibility-scripts-leaf-a-target-01: <none>
- E-21e-owner-governance-reproducibility-scripts-leaf-a-target-02: E-21e-owner-governance-reproducibility-scripts-leaf-a-target-01

Verification ledger:

- E-21e-owner-governance-reproducibility-scripts-leaf-a-target-01: `run `pnpm --workspace-root guard:owner-governance-evidence:test` and `pnpm --workspace-root guard:owner-governance-evidence``
- E-21e-owner-governance-reproducibility-scripts-leaf-a-target-02: `run `pnpm --workspace-root guard:owner-governance-evidence:test` and `pnpm --workspace-root guard:owner-governance-evidence``

History:

- 2026-10-01T23:00:26Z: Applied deterministic no_eligible_task fallback during run 20261001T230024Z; the checked parent remains in the queue so existing downstream dependencies still have a durable dependency anchor, and the implementation work moves to ordered single-target leaves.
## E-20i-release-ops-blockers-6ffca1beb681

Parent TODO: E-20i-release-ops-blockers-6ffca1beb681

Dependency graph:
- E-20h-release-evidence-script: <none>
- E-20i-runtime-release-ops-blocker: <none>

Verification ledger:
- E-20h-release-evidence-script: `pnpm --workspace-root guard:release-gate`
- E-20i-runtime-release-ops-blocker: inspect/blocker/fail-closed owner-provided Runtime Release Ops environment configuration.

Quality rubric:
- E-20h-release-evidence-script: bounded implementation leaf with existing package-script verification.
- E-20i-runtime-release-ops-blocker: explicit Runtime Release Ops blocker, not an implementation route; customer/Enterprise production deployment credentials are out of Runtime Product Ready scope.

History:
- 2026-10-02T10:16:40Z: Recorded Brownie-generated release-ops decomposition leaves after repairing route and verification contract drift.

## E-20i-release-ops-blockers-6ffca1beb681 follow-up leaves

Parent TODO: E-20i-release-ops-blockers-6ffca1beb681

Dependency graph:
- E-20h-release-evidence-doc: <none>
- E-20i-release-gate-script: E-20h-release-evidence-doc

Verification ledger:
- E-20h-release-evidence-doc: `pnpm --workspace-root guard:todo-decomposition`; `pnpm --workspace-root guard:release-gate`
- E-20i-release-gate-script: `pnpm --workspace-root guard:todo-decomposition`; `pnpm --workspace-root guard:release-gate`

Quality rubric:
- E-20h-release-evidence-doc: bounded documentation leaf with existing target path and explicit fail-closed release evidence scope.
- E-20i-release-gate-script: bounded implementation leaf with existing target path and dependency on the documentation contract leaf.

History:
- 2026-10-02T13:55:00Z: Supervisor diagnosis found Brownie-generated follow-up leaf IDs missing from the breakdown ledger; recorded the dependency graph so TODO guard can validate the live queue.

## TODO-repair-E-15f-todo-breakdown-update

Parent TODO: E-20i-release-ops-blockers-1c5120ce46c2-r2

Dependency graph:
- E-15f-todo-breakdown-update: <none>

Verification ledger:
- E-15f-todo-breakdown-update: run `pnpm --workspace-root guard:todo-decomposition` and inspect `.brownie/todo-breakdown.md` for the new entries.

Quality rubric:
- E-15f-todo-breakdown-update: bounded TODO decomposition/breakdown maintenance leaf with existing verification and no Product Ready declaration.

History:

- 2026-10-02T16:21:25Z: Deterministically added missing breakdown section for E-20i-release-ops-blockers-1c5120ce46c2-r2 after Brownie reached no_eligible_task on E-15f-todo-breakdown-update.

## TODO-refine-brownie-owned-blockers-59fb1bfdd8bc

Parent TODO: brownie-owned-blocker-refinement

Dependency graph:
- E-21c-clean-release-workspace-impl-1: <none>
- E-21c-runtime-operational-evidence-impl-2: E-21c-clean-release-workspace-impl-1
- E-21c-runtime-operational-evidence-impl-3: E-21c-runtime-operational-evidence-impl-2
- E-21c-runtime-operational-evidence-impl-4: E-21c-runtime-operational-evidence-impl-3
- E-21c-runtime-operational-evidence-impl-5: E-21c-runtime-operational-evidence-impl-4
- E-21c-provenance-binding-impl-6: E-21c-runtime-operational-evidence-impl-5
- E-21c-owner-governance-reproducibility-impl-7: E-21c-provenance-binding-impl-6
- E-21c-document-generation-sync-impl-8: E-21c-owner-governance-reproducibility-impl-7
- E-20i-runtime-release-ops-blocker: <none>

Verification ledger:
- E-21c-clean-release-workspace-impl-1: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test` and `pnpm --workspace-root guard:supply-chain-artifact-evidence`.
- E-21c-runtime-operational-evidence-impl-2: run `pnpm --workspace-root release:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`.
- E-21c-runtime-operational-evidence-impl-3: run `pnpm --workspace-root release:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`.
- E-21c-runtime-operational-evidence-impl-4: run `pnpm --workspace-root release:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`.
- E-21c-runtime-operational-evidence-impl-5: run `pnpm --workspace-root release:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`.
- E-21c-provenance-binding-impl-6: run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test` and `pnpm --workspace-root guard:supply-chain-artifact-evidence`.
- E-21c-owner-governance-reproducibility-impl-7: run `pnpm --workspace-root release:owner-governance-evidence:test` and `pnpm --workspace-root guard:owner-governance-evidence`.
- E-21c-document-generation-sync-impl-8: run `pnpm --workspace-root guard:release-evidence-semantic-consistency:test` and `pnpm --workspace-root guard:release-evidence-semantic-consistency`.
- E-20i-runtime-release-ops-blocker: inspect/blocker/fail-closed until Release Ops owner provides evidence of clean CI build, artifact upload/provenance binding, and GitHub Release publication authority.

Quality rubric:
- E-21c-clean-release-workspace-impl-1: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.
- E-21c-runtime-operational-evidence-impl-2: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.
- E-21c-runtime-operational-evidence-impl-3: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.
- E-21c-runtime-operational-evidence-impl-4: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.
- E-21c-runtime-operational-evidence-impl-5: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.
- E-21c-provenance-binding-impl-6: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.
- E-21c-owner-governance-reproducibility-impl-7: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.
- E-21c-document-generation-sync-impl-8: bounded target scope, valid Source TODO, existing verification command, and no Product Ready declaration.
- E-20i-runtime-release-ops-blocker: explicit Runtime Release Ops blocker; Enterprise/customer deployment credentials are non-Runtime and must not be required for OSS Runtime release readiness.

History:

- 2026-10-02T17:20:50Z: Deterministically decomposed brownie-owned-blocker-refinement during 20261002T172050Z; avoided LLM old_text patch anchors and resolved verification commands from existing package scripts.

## E-21c-clean-release-workspace-impl-1 no-eligible multi-target split

Parent TODO: E-21c-clean-release-workspace-impl-1: - [ ] E-21c-clean-release-workspace-impl-1: Patch only `scripts/release-supply-chain-artifact-evidence.mjs` and `scripts/guard-supply-chain-artifact-evidence.test.mjs` to replace Brownie-owned blocker E-21c-release-ops-todo-split-clean-release-workspace with executable Release evidence handling:
Parent source: TODO-refine-brownie-owned-blockers-59fb1bfdd8bc

Targets:

- E-21c-clean-release-workspace-impl-1-target-01: `scripts/release-supply-chain-artifact-evidence.mjs`
- E-21c-clean-release-workspace-impl-1-target-02: `scripts/guard-supply-chain-artifact-evidence.test.mjs`

Dependency graph:

- E-21c-clean-release-workspace-impl-1-target-01: <none>
- E-21c-clean-release-workspace-impl-1-target-02: E-21c-clean-release-workspace-impl-1-target-01

Verification ledger:

- E-21c-clean-release-workspace-impl-1-target-01: `run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test` and `pnpm --workspace-root guard:supply-chain-artifact-evidence``
- E-21c-clean-release-workspace-impl-1-target-02: `run `pnpm --workspace-root guard:supply-chain-artifact-evidence:test` and `pnpm --workspace-root guard:supply-chain-artifact-evidence``

History:

- 2026-10-02T17:27:16Z: Applied deterministic no_eligible_task fallback during run 20261002T172715Z; the checked parent remains in the queue so existing downstream dependencies still have a durable dependency anchor, and the implementation work moves to ordered single-target leaves.

## E-21c-runtime-operational-evidence-impl-2 no-eligible multi-target split

Parent TODO: E-21c-runtime-operational-evidence-impl-2: - [ ] E-21c-runtime-operational-evidence-impl-2: Patch only `scripts/release-runtime-operational-evidence.mjs` and `scripts/guard-runtime-operational-evidence.test.mjs` to replace Brownie-owned blocker E-21c-release-ops-todo-split-artifact-e2e-smoke with executable Release evidence handling:
Parent source: TODO-refine-brownie-owned-blockers-59fb1bfdd8bc

Targets:

- E-21c-runtime-operational-evidence-impl-2-target-01: `scripts/release-runtime-operational-evidence.mjs`
- E-21c-runtime-operational-evidence-impl-2-target-02: `scripts/guard-runtime-operational-evidence.test.mjs`

Dependency graph:

- E-21c-runtime-operational-evidence-impl-2-target-01: E-21c-clean-release-workspace-impl-1
- E-21c-runtime-operational-evidence-impl-2-target-02: E-21c-runtime-operational-evidence-impl-2-target-01

Verification ledger:

- E-21c-runtime-operational-evidence-impl-2-target-01: `run `pnpm --workspace-root release:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence``
- E-21c-runtime-operational-evidence-impl-2-target-02: `run `pnpm --workspace-root release:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence``

History:

- 2026-10-02T19:05:13Z: Applied deterministic no_eligible_task fallback during run 20261002T190511Z; the checked parent remains in the queue so existing downstream dependencies still have a durable dependency anchor, and the implementation work moves to ordered single-target leaves.

## TODO-repair-E-21c-replan-stalled-leaf-c0830caaef87

Parent TODO: E-21c-replan-stalled-leaf-6705771c47f0

Dependency graph:
- E-21c-replan-stalled-leaf-c0830caaef87: <none>

Verification ledger:
- E-21c-replan-stalled-leaf-c0830caaef87: run `pnpm --workspace-root guard:todo-decomposition` and `pnpm --workspace-root phase-loop:todo-queue-integrity`.

Quality rubric:
- E-21c-replan-stalled-leaf-c0830caaef87: replace the stalled leaf with implementable child TODOs while preserving parent intent, exact patch targets, existing verification commands, and fail-closed release evidence semantics.

History:

- 2026-10-03T20:09:58Z: Supervisor detected repeated invalid_patch_with_repeated_no_progress on E-21c-replan-stalled-leaf-6705771c47f0 and promoted Brownie-owned TODO replan instead of retrying the same single-target leaf.

## TODO-repair-E-21c-replan-stalled-leaf-1a95acd61134

Parent TODO: E-21c-replan-stalled-leaf-001

Dependency graph:
- E-21c-replan-stalled-leaf-1a95acd61134: <none>

Verification ledger:
- E-21c-replan-stalled-leaf-1a95acd61134: run `pnpm --workspace-root guard:todo-decomposition` and `pnpm --workspace-root phase-loop:todo-queue-integrity`.

Quality rubric:
- E-21c-replan-stalled-leaf-1a95acd61134: replace the stalled leaf with implementable child TODOs while preserving parent intent, exact patch targets, existing verification commands, and fail-closed release evidence semantics.

History:

- 2026-10-03T20:45:41Z: Supervisor detected repeated invalid_patch_with_repeated_no_progress on E-21c-replan-stalled-leaf-001 and promoted Brownie-owned TODO replan instead of retrying the same single-target leaf.

## TODO-repair-E-21c-todo-decomp-leaf-001

Parent TODO: E-21c-replan-stalled-leaf-c0830caaef87.

Dependency graph:
- E-21c-todo-decomp-leaf-001: <none>

Verification ledger:
- E-21c-todo-decomp-leaf-001: run `pnpm --workspace-root guard:todo-decomposition` and `pnpm --workspace-root phase-loop:todo-queue-integrity`.

Quality rubric:
- E-21c-todo-decomp-leaf-001: derived TODO id preserves parent prefix, has bounded patch scope, and keeps the TODO queue/breakdown ledger consistent.

History:

- 2026-10-03T21:10:59Z: Supervisor repaired generated TODO id prefix from E-15e-todo-decomp-leaf-001 to E-21c-todo-decomp-leaf-001 after TODO decomposition guard rejected the live queue.

## TODO-repair-E-21c-todo-decomp-leaf-002

Parent TODO: E-21c-replan-stalled-leaf-c0830caaef87.

Dependency graph:
- E-21c-todo-decomp-leaf-002: <none>

Verification ledger:
- E-21c-todo-decomp-leaf-002: run `pnpm --workspace-root guard:todo-decomposition` and `pnpm --workspace-root phase-loop:todo-queue-integrity`.

Quality rubric:
- E-21c-todo-decomp-leaf-002: derived TODO id preserves parent prefix, has bounded patch scope, and keeps the TODO queue/breakdown ledger consistent.

History:

- 2026-10-03T21:10:59Z: Supervisor repaired generated TODO id prefix from E-15e-todo-decomp-leaf-002 to E-21c-todo-decomp-leaf-002 after TODO decomposition guard rejected the live queue.

## TODO-repair-E-21c-replan-stalled-leaf-16dd69c42044

Parent TODO: E-21c-todo-decomp-leaf-001

Dependency graph:
- E-21c-replan-stalled-leaf-16dd69c42044: <none>

Verification ledger:
- E-21c-replan-stalled-leaf-16dd69c42044: run `pnpm --workspace-root guard:todo-decomposition` and `pnpm --workspace-root phase-loop:todo-queue-integrity`.

Quality rubric:
- E-21c-replan-stalled-leaf-16dd69c42044: replace the stalled leaf with implementable child TODOs while preserving parent intent, exact patch targets, existing verification commands, and fail-closed release evidence semantics.

History:

- 2026-10-03T21:17:15Z: Supervisor detected repeated invalid_patch_with_repeated_no_progress on E-21c-todo-decomp-leaf-001 and promoted Brownie-owned TODO replan instead of retrying the same single-target leaf.

## TODO-repair-E-21c-runtime-readiness-audit-evidence-leaf-001

Parent TODO: E-21c-replan-stalled-leaf-c0830caaef87

Dependency graph:
- E-21c-runtime-readiness-audit-evidence-leaf-001: <none>
- E-21c-release-gate-readiness-audit-leaf-002: E-21c-runtime-readiness-audit-evidence-leaf-001

Verification ledger:
- E-21c-runtime-readiness-audit-evidence-leaf-001: run `pnpm --workspace-root guard:runtime-release-readiness`.
- E-21c-release-gate-readiness-audit-leaf-002: run `pnpm --workspace-root release:gate -- --dry-run`.

Quality rubric:
- E-21c-runtime-readiness-audit-evidence-leaf-001: bounded documentation leaf that updates Runtime readiness audit evidence without claiming Product Ready.
- E-21c-release-gate-readiness-audit-leaf-002: bounded implementation leaf that keeps Release gate fail-closed on missing or inconsistent Runtime readiness audit evidence.

History:

- 2026-10-03T21:32:54Z: Replaced recursive stalled-leaf replan TODO with concrete implementation/documentation leaves to avoid decomposition recursion.

## E-21c-runtime-operational-evidence-impl-3 no-eligible multi-target split

Parent TODO: E-21c-runtime-operational-evidence-impl-3: - [ ] E-21c-runtime-operational-evidence-impl-3: Patch only `scripts/release-runtime-operational-evidence.mjs` and `scripts/guard-runtime-operational-evidence.test.mjs` to replace Brownie-owned blocker E-21c-release-ops-todo-split-artifact-lifecycle with executable Release evidence handling:
Parent source: TODO-refine-brownie-owned-blockers-59fb1bfdd8bc

Targets:

- E-21c-runtime-operational-evidence-impl-3-target-01: `scripts/release-runtime-operational-evidence.mjs`
- E-21c-runtime-operational-evidence-impl-3-target-02: `scripts/guard-runtime-operational-evidence.test.mjs`

Dependency graph:

- E-21c-runtime-operational-evidence-impl-3-target-01: E-21c-runtime-operational-evidence-impl-2
- E-21c-runtime-operational-evidence-impl-3-target-02: E-21c-runtime-operational-evidence-impl-3-target-01

Verification ledger:

- E-21c-runtime-operational-evidence-impl-3-target-01: `run `pnpm --workspace-root release:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence``
- E-21c-runtime-operational-evidence-impl-3-target-02: `run `pnpm --workspace-root release:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence``

History:

- 2026-10-03T22:02:59Z: Applied deterministic no_eligible_task fallback during run 20261003T220257Z; the checked parent remains in the queue so existing downstream dependencies still have a durable dependency anchor, and the implementation work moves to ordered single-target leaves.

## E-21c-runtime-operational-evidence-impl-4 no-eligible multi-target split

Parent TODO: E-21c-runtime-operational-evidence-impl-4: - [ ] E-21c-runtime-operational-evidence-impl-4: Patch only `scripts/release-runtime-operational-evidence.mjs` and `scripts/guard-runtime-operational-evidence.test.mjs` to replace Brownie-owned blocker E-21c-release-ops-todo-split-golden-journey with executable Release evidence handling:
Parent source: TODO-refine-brownie-owned-blockers-59fb1bfdd8bc

Targets:

- E-21c-runtime-operational-evidence-impl-4-target-01: `scripts/release-runtime-operational-evidence.mjs`
- E-21c-runtime-operational-evidence-impl-4-target-02: `scripts/guard-runtime-operational-evidence.test.mjs`

Dependency graph:

- E-21c-runtime-operational-evidence-impl-4-target-01: E-21c-runtime-operational-evidence-impl-3
- E-21c-runtime-operational-evidence-impl-4-target-02: E-21c-runtime-operational-evidence-impl-4-target-01

Verification ledger:

- E-21c-runtime-operational-evidence-impl-4-target-01: `run `pnpm --workspace-root release:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence``
- E-21c-runtime-operational-evidence-impl-4-target-02: `run `pnpm --workspace-root release:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence``

History:

- 2026-10-03T23:09:29Z: Applied deterministic no_eligible_task fallback during run 20261003T230927Z; the checked parent remains in the queue so existing downstream dependencies still have a durable dependency anchor, and the implementation work moves to ordered single-target leaves.

## E-21c-runtime-operational-evidence-impl-5 no-eligible multi-target split

Parent TODO: E-21c-runtime-operational-evidence-impl-5: - [ ] E-21c-runtime-operational-evidence-impl-5: Patch only `scripts/release-runtime-operational-evidence.mjs` and `scripts/guard-runtime-operational-evidence.test.mjs` to replace Brownie-owned blocker E-21c-release-ops-todo-split-stateful-soak with executable Release evidence handling:
Parent source: TODO-refine-brownie-owned-blockers-59fb1bfdd8bc

Targets:

- E-21c-runtime-operational-evidence-impl-5-target-01: `scripts/release-runtime-operational-evidence.mjs`
- E-21c-runtime-operational-evidence-impl-5-target-02: `scripts/guard-runtime-operational-evidence.test.mjs`

Dependency graph:

- E-21c-runtime-operational-evidence-impl-5-target-01: E-21c-runtime-operational-evidence-impl-4
- E-21c-runtime-operational-evidence-impl-5-target-02: E-21c-runtime-operational-evidence-impl-5-target-01

Verification ledger:

- E-21c-runtime-operational-evidence-impl-5-target-01: `run `pnpm --workspace-root release:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence``
- E-21c-runtime-operational-evidence-impl-5-target-02: `run `pnpm --workspace-root release:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence``

History:

- 2026-10-04T00:25:44Z: Applied deterministic no_eligible_task fallback during run 20261004T002542Z; the checked parent remains in the queue so existing downstream dependencies still have a durable dependency anchor, and the implementation work moves to ordered single-target leaves.

## E-21c-owner-governance-reproducibility-impl-7 no-eligible multi-target split

Parent TODO: E-21c-owner-governance-reproducibility-impl-7: - [ ] E-21c-owner-governance-reproducibility-impl-7: Patch only `scripts/release-owner-governance-evidence.mjs` and `scripts/guard-owner-governance-evidence.test.mjs` to replace Brownie-owned blocker E-21c-release-ops-todo-split-owner-governance-reproducibility with executable Release evidence handling:
Parent source: TODO-refine-brownie-owned-blockers-59fb1bfdd8bc

Targets:

- E-21c-owner-governance-reproducibility-impl-7-target-01: `scripts/release-owner-governance-evidence.mjs`
- E-21c-owner-governance-reproducibility-impl-7-target-02: `scripts/guard-owner-governance-evidence.test.mjs`

Dependency graph:

- E-21c-owner-governance-reproducibility-impl-7-target-01: <none>
- E-21c-owner-governance-reproducibility-impl-7-target-02: E-21c-owner-governance-reproducibility-impl-7-target-01

Verification ledger:

- E-21c-owner-governance-reproducibility-impl-7-target-01: `run `pnpm --workspace-root release:owner-governance-evidence:test` and `pnpm --workspace-root guard:owner-governance-evidence``
- E-21c-owner-governance-reproducibility-impl-7-target-02: `run `pnpm --workspace-root release:owner-governance-evidence:test` and `pnpm --workspace-root guard:owner-governance-evidence``

History:

- 2026-10-04T01:01:18Z: Applied deterministic no_eligible_task fallback during run 20261004T010116Z; the checked parent remains in the queue so existing downstream dependencies still have a durable dependency anchor, and the implementation work moves to ordered single-target leaves.

## E-22 Runtime release artifact evidence binding

Parent TODO: 2026-10-04 review: Release Workflow success must be tied to Runtime artifacts, executable evidence, and Release Contract trace binding.

Dependency graph:

- E-22a-runtime-release-workflow-artifacts: <none>
- E-22b-release-artifact-provenance-binding: E-22a-runtime-release-workflow-artifacts
- E-22c-runtime-artifact-e2e-evidence: E-22b-release-artifact-provenance-binding
- E-22d-runtime-stateful-soak-evidence: E-22c-runtime-artifact-e2e-evidence
- E-22e-release-contract-trace-binding-guard: E-22d-runtime-stateful-soak-evidence
- E-22f-release-contract-audit-doc-sync: E-22e-release-contract-trace-binding-guard
- E-22g-final-judgment-manifest-doc-sync: E-22f-release-contract-audit-doc-sync

Verification ledger:

- E-22a-runtime-release-workflow-artifacts: `pnpm --workspace-root check`
- E-22b-release-artifact-provenance-binding: `pnpm --workspace-root guard:supply-chain-artifact-evidence:test` and `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-22c-runtime-artifact-e2e-evidence: `pnpm --workspace-root release:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`
- E-22d-runtime-stateful-soak-evidence: `pnpm --workspace-root release:runtime-operational-evidence:test` and `pnpm --workspace-root guard:runtime-operational-evidence`
- E-22e-release-contract-trace-binding-guard: `pnpm --workspace-root guard:release-contract:test` and `pnpm --workspace-root guard:release-contract`
- E-22f-release-contract-audit-doc-sync: `pnpm --workspace-root guard:release-contract` and `pnpm --workspace-root guard:runtime-release-readiness`
- E-22g-final-judgment-manifest-doc-sync: `pnpm --workspace-root guard:phase-value`, `pnpm --workspace-root guard:release-contract`, and `pnpm --workspace-root guard:runtime-release-readiness`

Quality rubric:

- E-22 leaves must keep Runtime Product Ready false until executable evidence passes.
- E-22 leaves must not require Enterprise/customer production deployment credentials.
- E-22 leaves must bind workflow success to actual Runtime artifacts, artifact hashes, clean source identity, and evidence trace fields instead of documenting success by assertion.

History:

- 2026-10-04T13:40:00Z: Added from external review of main 3c5e622; existing owner-only E-20i blocker was not sufficient because Brownie-owned executable Release evidence work remains.

## TODO-repair-E-22b-replan-stalled-leaf-4030af97e57f

Parent TODO: E-22b-release-artifact-provenance-binding

Dependency graph:
- E-22b-replan-stalled-leaf-4030af97e57f: <none>

Verification ledger:
- E-22b-replan-stalled-leaf-4030af97e57f: run `pnpm --workspace-root guard:todo-decomposition` and `pnpm --workspace-root phase-loop:todo-queue-integrity`.

Quality rubric:
- E-22b-replan-stalled-leaf-4030af97e57f: replace the stalled leaf with implementable child TODOs while preserving parent intent, exact patch targets, existing verification commands, and fail-closed release evidence semantics.

History:

- 2026-10-05T06:42:56Z: Supervisor detected repeated invalid_patch_followed_by_no_progress on E-22b-release-artifact-provenance-binding and promoted Brownie-owned TODO replan instead of retrying the same single-target leaf.
