# Brownie TODO breakdown ledger

This file records Brownie-managed decomposition decisions for the live queue in
`.brownie/todo.md`. It is shared operational state, not release evidence.

## TODO-decompose-blocked-queue-71820ffb9fb9

Parent TODO: TODO-decompose-blocked-queue-71820ffb9fb9: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs.

Dependency graph:

- E-15a-redaction-collector: <none>
- E-15a-redaction-guard: E-15a-redaction-collector
- E-15b-provenance-collector-a: <none>
- E-15b-release-contract-binding-guard-a: E-15b-provenance-collector-a
- E-15c-artifact-smoke-runner-contract: <none>
- E-15d-stateful-soak-contract: E-15c-artifact-smoke-runner-contract
- E-15e-release-doc-resync-after-evidence: E-15a-redaction-guard, E-15b-release-contract-binding-guard-a, E-15c-artifact-smoke-runner-contract, E-15d-stateful-soak-contract
- E-15f-semantic-consistency-guard: E-15b-release-contract-binding-guard-a, E-15c-artifact-smoke-runner-contract, E-15d-stateful-soak-contract
- E-15g-pr435-hygiene-evidence: <none>

Verification ledger:

- E-15a-redaction-collector: `pnpm --workspace-root guard:runtime-operational-evidence:test`
- E-15a-redaction-guard: `pnpm --workspace-root guard:runtime-operational-evidence:test`; `pnpm --workspace-root guard:runtime-operational-evidence`
- E-15b-provenance-collector-a: `pnpm --workspace-root guard:supply-chain-artifact-evidence:test`; `pnpm --workspace-root guard:supply-chain-artifact-evidence`
- E-15b-release-contract-binding-guard-a: `pnpm --workspace-root guard:release-contract:test`; `pnpm --workspace-root guard:release-contract`
- E-15c-artifact-smoke-runner-contract: artifact smoke guard tests; `pnpm --workspace-root guard:runtime-operational-evidence`
- E-15d-stateful-soak-contract: soak guard tests; `pnpm --workspace-root check`
- E-15e-release-doc-resync-after-evidence: `pnpm --workspace-root guard:runtime-release-readiness`; `pnpm --workspace-root guard:release-contract`; `pnpm --workspace-root guard:phase-value`; `pnpm --workspace-root check`
- E-15f-semantic-consistency-guard: new guard tests; `pnpm --workspace-root guard:phase-value`; `pnpm --workspace-root check`
- E-15g-pr435-hygiene-evidence: inspect PR #435 state and record a bounded release-ops conclusion or fail-closed TODO.

Quality rubric:

- Each leaf must be small enough for one bounded implementation pass.
- Each leaf must name at most two concrete `Patch only` or `Create only` targets unless it is an explicit blocker.
- `Completion condition` must describe a concrete observable outcome, not a broad Product Ready claim.
- `Verification` must match the route: implementation leaves need executable local checks; release-ops leaves use bounded inspection or fail-closed evidence.
- `Depends on` controls execution order; Brownie must not claim a leaf whose dependency remains pending.

History:

- 2026-09-13: Created after repeated no-progress decomposition loops to make parent/child/dependency/verification state explicit and guardable.
