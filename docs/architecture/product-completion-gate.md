# Product Completion Gate

Brownie phase and milestone completion must be supported by bounded, machine-checkable product evidence. CI success, PR merge status, source-token presence, endpoint count, or manifest existence are not sufficient completion evidence.

The executable gate is `scripts/guard-product-completion.mjs`. It validates the current phase-value manifest and rejects completion claims that do not map to the Product Charter, do not name a concrete capability transition, do not include behavior evidence, omit safety/debt review, or try to close product work with wrapper-only/report-only output.

## Required Evidence

A completion claim must include:

- Product Charter strategic capability mapping.
- Concrete capability transition.
- User, runtime, or development-control capability gain.
- Behavior evidence from tests or executable guards.
- Safety boundary and non-goals.
- Rejected alternatives.
- Unresolved technical debt classification.
- Next capability rationale or milestone exit rationale.

## Wrapper Boundary

Wrapper-only, report-only, readiness-only, digest-only, history-only, verdict-only, inspection-only, preview-only, and summary-only phases cannot be accepted as product completion. A bounded blocker-removal phase may pass only when it explicitly names the blocker removed and does not claim product runtime completion.

## Safety Boundary

The guard reads bounded repository JSON/text only. It does not read external automation state, raw prompts, provider responses, workspace file content, stdout, stderr, environment values, absolute paths, canonical paths, secrets, or credentials. It does not mutate repository files, Git state, runtime state, ledger files, provider state, or workspace files.
