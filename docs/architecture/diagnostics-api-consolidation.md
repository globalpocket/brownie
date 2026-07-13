# R1 Diagnostics API Consolidation

R1 is an architecture recovery milestone. It stops the diagnostics wrapper chain that grew from Phase 3.14 through Phase 3.51 and redirects Brownie back toward the product charter roadmap.

## Execution Gate Evidence

- `product-charter.md` was read before implementation.
- `current_phase=R1` was confirmed from the external automation state.
- `current_milestone=architecture_recovery` was confirmed from the external automation state.
- `target_capability=diagnostics_api_consolidation` was confirmed from the external automation state.
- `phase_value_gate` was evaluated before implementation.
- This R1 change does not add a diagnostics wrapper RPC, protocol type, VSIX validator, or RuntimeClient method.

## Product Value Gate Result

R1 advances `runtime_permission_enforcement`, `controlled_workspace_tools`, and `headless_autonomous_development` indirectly by removing diagnostics API planning debt that blocks the roadmap. It adds no new runtime endpoint by design. Its concrete operator value is a documented consolidation plan and hard review gate that prevents future wrapper-only phases from consuming the autonomous development loop.

Existing runtime APIs could not substitute for R1 because the problem is architectural governance: the code already exposes many reconstructable summary endpoints, but the repository did not identify them as deprecated candidates or require value justification before adding more.

## Current Diagnostics API Inventory

The current `proposal.reviewQueue*` family has three useful source surfaces and a long sequence of reconstructable wrappers. The source of truth for all entries is sanitized proposal/run ledger state; none of these endpoints authorizes apply.

| API family | Input shape | Output shape | Source of truth | Added information | R1 classification |
| --- | --- | --- | --- | --- | --- |
| `proposal.reviewQueue` | run/proposal review scope | queue items, report status, counts | proposal metadata and sanitized ledger summaries | useful queue status per proposal | Keep |
| `proposal.reviewQueueDiagnostics` | queue diagnostics scope | consistency checks and readiness status | `proposal.reviewQueue` plus runtime invariants | useful direct diagnostics | Keep and consolidate |
| `proposal.reviewQueueDiagnosticsHistory` | diagnostics scope | bounded history around latest diagnostics | reconstructs diagnostics on demand | no durable independent history | Deprecate candidate |
| `proposal.reviewQueueDiagnosticsReport` | diagnostics scope | report over diagnostics/history | diagnostics plus counts/actions | mostly report formatting | Deprecate candidate |
| `proposal.reviewQueueDiagnosticsDigest` | diagnostics report scope | compact digest | diagnostics report | compact projection only | Deprecate candidate |
| `proposal.reviewQueueDiagnosticsDigestHistory` | digest scope | one-entry bounded history | digest | reconstructable wrapper | Deprecate candidate |
| `proposal.reviewQueueDiagnosticsDigestReport` | digest history scope | report over digest history | digest history | report formatting only | Deprecate candidate |
| `proposal.reviewQueueDiagnosticsDigestReportHistory` | digest report scope | one-entry bounded history | digest report | reconstructable wrapper | Deprecate candidate |
| `proposal.reviewQueueDiagnosticsDigestReportVerdict` | digest report history scope | verdict summary | digest report history | compact projection only | Deprecate candidate |
| `proposal.reviewQueueDiagnosticsDigestReportVerdictHistory` | verdict scope | one-entry bounded history | verdict | reconstructable wrapper | Deprecate candidate |
| `proposal.reviewQueueDiagnosticsDigestReportVerdictReport` | verdict history scope | report over verdict history | verdict history | report formatting only | Deprecate candidate |
| `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistory` | verdict report scope | one-entry bounded history | verdict report | reconstructable wrapper | Deprecate candidate |
| Phase 3.24-3.51 long-chain `Digest/History/Report` repetitions | previous wrapper output | alternating digest, report, or one-entry history | immediately preceding wrapper | no independent evidence | Deprecate and do not extend |

The long-chain endpoints include the progressively longer `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigest...` names through the Phase 3.51 `...ReportHistory` endpoint. They should be treated as compatibility aliases during migration, not as a pattern for new work.

## Consolidation Target

Future diagnostics should converge to no more than three practical API families:

1. `proposal.reviewQueue`
   - Source-of-truth queue summary for proposal review status.
   - Keeps queue item status, count, and required action metadata.
2. `proposal.reviewQueueDiagnostics`
   - Direct diagnostics over queue consistency and operator readiness.
   - Should include enough bounded details to replace report/digest/verdict wrappers.
3. `proposal.reviewQueueHistory`
   - Future bounded history/report surface, if needed.
   - Must store or expose genuinely historical state that cannot be fully reconstructed from a single current diagnostics response.

If a future candidate endpoint can be rebuilt from one of these three families without reading new source evidence, it should be rejected as wrapper-only work.

## Deprecation And Migration Plan

1. Freeze the existing wrapper chain immediately. No new diagnostics wrapper endpoints, long wrapper types, VSIX validators, or RuntimeClient methods may be added.
2. Mark `DiagnosticsHistory`, `DiagnosticsReport`, `DiagnosticsDigest`, `DigestHistory`, `DigestReport`, `Verdict`, `VerdictHistory`, `VerdictReport`, `VerdictReportHistory`, and all Phase 3.24-3.51 long-chain endpoints as deprecated candidates.
3. Keep existing endpoints temporarily as compatibility aliases. Do not remove them until callers have a documented replacement and a compatibility window.
4. Add replacement fields to `proposal.reviewQueueDiagnostics` or a future `proposal.reviewQueueHistory` only when they expose non-reconstructable evidence or materially improve operator decisions.
5. Update VSIX callers to prefer the consolidation target before deleting legacy aliases.
6. Add tests for replacement behavior before removing any compatibility endpoint.
7. Remove deprecated aliases in small batches after replacement usage is documented.

## Review And Auto-Merge Guard

Future PRs must be blocked when the primary change is another reconstructable diagnostics wrapper. A PR may proceed only when it either advances a product-charter strategic capability or removes a documented blocker to one.

Review must require an explicit answer to:

- What new user, operator, or runtime capability is gained?
- Which strategic capability is advanced?
- Why can the response not be reconstructed from an existing endpoint?
- Which existing endpoint would become deprecated or simpler because of this change?

Passing CI, preserving `apply_authorized=false`, and avoiding workspace writes are required safety properties, but they are not sufficient product justification.

## R1 Exit Criteria Progress

- No new diagnostics wrapper RPC is added.
- No new long wrapper type name is added.
- A diagnostics RPC/type inventory exists in this document.
- Duplicate and fully reconstructable endpoints are classified.
- A consolidation target with three diagnostics API families is documented.
- A deprecation and migration plan exists.
- A value guard exists in `docs/architecture/phase-value-gate.md`.
- A review/auto-merge guard exists in `docs/architecture/phase-value-gate.md` and this document.
- The next milestone is explicitly redirected to `agent_loop_integration` unless a documented blocker requires `mode_pack_runtime` or `controlled_apply_readiness` first.
