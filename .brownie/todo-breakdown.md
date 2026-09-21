# Brownie TODO breakdown ledger

This file records Brownie-managed decomposition decisions for the live queue in
`.brownie/todo.md`. It is shared operational state, not release evidence.

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
