# Diagnostics Wrapper History Archive

This archive records the Phase 3 diagnostics wrapper chain that R1 froze and R1.1 made enforceable.

The authoritative machine-readable legacy marker is `docs/architecture/diagnostics-legacy-api-metadata.json`. The detailed endpoint and type inventory is `docs/architecture/diagnostics-api-consolidation.md`.

## Archived Phase Chain

Phases 3.5 through 3.12 built the read-only proposal inspection chain: apply capability, dry-run inspection, dry-run history, audit trail, review bundle, review verdict, review report, and review queue. These surfaces preserved the no-write/no-apply boundary.

Phase 3.13 introduced `proposal.reviewQueueDiagnostics` as the direct queue diagnostics surface. Phases 3.14 through 3.51 then repeatedly wrapped that diagnostics result into history, report, digest, verdict, report-history, and digest-history projections. Those wrappers remained summary-only and preserved `apply_authorized=false`, but they did not add independent runtime capability.

R1 freezes that wrapper pattern. R1.1 adds CI/review enforcement so new work cannot extend the `proposal.reviewQueueDiagnostics...Digest...Report...History` family outside the legacy allowlist.

The next milestone after R1.1 is M1 Agent Loop Integration, represented by `agent_loop_integration`.
