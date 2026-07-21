# Brownie Phase Value Gate

Every planned phase must pass this value gate before implementation or review. The gate exists to keep the phase loop aligned with the Brownie Product Charter instead of optimizing for endpoint count, CI success, or wrapper-only observability work.

## Required Planning Questions

Before generating or implementing a phase, answer all of these questions:

1. Which `strategic_capabilities` from the product charter does this phase advance?
2. What concrete user-visible, operator-visible, or runtime capability does this phase add?
3. Why can existing runtime methods, documents, or VSIX behavior not substitute for this work?
4. What specific product gap or blocker remains if this phase is not implemented?
5. How does this phase move Brownie closer to the product objective?
6. Is this phase semantically distinct from the previous three phases?

If any answer is missing, weak, or shows the proposed work is only a wrapper around existing output, the phase must be rejected or revised before implementation.

## Hard Planning Rules

- The phase loop is not authorized to redefine Brownie's product purpose.
- The phase loop may refine implementation order, split milestones, or insert safety work.
- The phase loop may not replace the strategic capability roadmap with observability-only, reporting-only, or wrapper-only work.
- Every accepted phase must advance at least one strategic capability or remove a documented blocker to one.
- CI success is necessary engineering hygiene, not proof of product progress.

## Review-Side Rejection Rules

Review must reject or block a PR when any of these are true:

- The PR adds no strategic capability.
- The PR only wraps existing output.
- The PR does not remove a documented blocker.
- The PR cannot state a concrete user-visible, operator-visible, or runtime capability gain.
- The PR treats passing checks as sufficient evidence of product value.
- The PR adds another reconstructable diagnostics wrapper endpoint, protocol type, VSIX validator, or RuntimeClient method.

## Diagnostics Wrapper Freeze

R1 freezes the Phase 3 diagnostics wrapper chain. New work must not add another `proposal.reviewQueueDiagnostics...Digest...Report...History` endpoint or matching Rust/TypeScript type. Future diagnostics changes must consolidate, deprecate, or replace redundant surfaces rather than extending the chain.

## Current Manifest Selection

`docs/architecture/phase-value-manifest.json` is the deterministic current phase manifest. Versioned files named `docs/architecture/phase-value-manifest.<phase>.json` are historical records for completed or reviewed phases. CI and local guard execution must validate the current manifest unless an explicit test fixture overrides the path.

## Existing CI Guard Path

GitHub Actions already runs `pnpm --filter brownie-vsix check`. The VSIX `check` script runs `pnpm --workspace-root guard:diagnostics` and `pnpm --workspace-root guard:phase-value` before TypeScript checking. A phase must not change `.github/workflows/**` solely to duplicate those guard commands when the existing CI path already enforces them.

## Guard Engine Change Review

Changes to `.github/workflows/ci.yml`, `package.json`, `scripts/guard-diagnostics-api.mjs`, `scripts/guard-phase-value.mjs`, phase-value guard tests, this policy document, or the current phase-value manifest are guard engine changes. A phase that changes those files must include `guard_engine_change_review` metadata in the current manifest with strict review intent, changed file inventory, and a no-self-approval statement. This keeps the automation controller from silently weakening the gate it relies on.

## Next Milestone Selection

After R1, the normal next milestone is `agent_loop_integration`. Selecting `mode_pack_runtime` or `controlled_apply_readiness` first requires a documented blocker or dependency reason. New observability-only milestones are not valid roadmap replacements.
