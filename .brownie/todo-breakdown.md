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
