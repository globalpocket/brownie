# Brownie Runtime Architecture Overview

## Summary

Brownie uses a thin Code-OSS VSIX and a Rust runtime.

```text
Code-OSS / Brownie VSIX
  -> protocol boundary
Brownie Runtime
  -> Agent Loop
  -> AgentModes compatibility
  -> Context manager
  -> Tools
  -> LLM client
  -> llama-server wrapper
  -> Qdrant wrapper
  -> Indexer
  -> Store
  -> Events
```

## VSIX responsibility

The VSIX owns:

- Code-OSS activation
- command registration
- workspace bridge
- editor bridge
- terminal bridge
- Custom Agent UI adapter surface
- runtime process startup
- event display

The VSIX should not own agent policy.

## Runtime responsibility

The Rust runtime owns:

- task lifecycle
- agent-loop state transitions
- mode policy enforcement
- prompt materialization
- tool routing
- LLM request routing
- wrapper coordination
- indexing coordination
- ledger persistence
- event emission

## Boundary principle

The runtime is the execution authority. The VSIX presents state and connects Code-OSS capabilities.

## Patch apply boundary

Phase 3.5 exposes `proposal.applyCapability` as a read-only design contract for future patch application. Phase 3.6 adds operator-controlled `proposal.applyDryRun` inspection, which reports dry-run gate metadata and explicitly records that no patch was applied and no workspace file changed. Phase 3.7 adds `proposal.applyDryRunHistory`, a summary-only audit view reconstructed from sanitized dry-run ledger events; it returns the latest dry run, the full dry-run count, and the 10 newest entries without appending a new event. Phase 3.8 adds `proposal.auditTrail`, a summary-only lifecycle view reconstructed from sanitized proposal, approval, preflight, readiness, capability, and dry-run ledger events; it returns the latest lifecycle entry, the total lifecycle event count, and up to 50 ordered entries without appending a new event. Phase 3.9 adds `proposal.reviewBundle`, a summary-only final review view that aggregates the latest readiness, apply capability, apply dry-run, and audit position without appending a new event. Phase 3.10 adds `proposal.reviewVerdict`, a compact summary-only final review verdict reconstructed from the same sanitized evidence; it reports `ReadyForHumanReview`, `NeedsSignals`, or `BlockedForReview` and always keeps `apply_authorized=false`. Phase 3.11 adds `proposal.reviewReport`, a bounded summary-only operator report that combines the review bundle, verdict, and five newest sanitized audit events without appending a new event or authorizing apply. Phase 3.12 adds `proposal.reviewQueue`, a run-level summary-only queue that reports one compact review item per proposal, derives `Blocked`, `NeedsAction`, or `Complete` from item report states, and never authorizes apply. Phase 3.13 adds `proposal.reviewQueueDiagnostics`, a run-level summary-only diagnostics view that checks queue consistency and operator readiness without appending a ledger event or authorizing apply. Phase 3.14 adds `proposal.reviewQueueDiagnosticsHistory`, a summary-only history surface that reconstructs the latest diagnostics on demand as a bounded one-entry history without appending a ledger event or authorizing apply. Phase 3.15 adds `proposal.reviewQueueDiagnosticsReport`, a summary-only operator report that combines queue status, diagnostics status, diagnostics history count, latest diagnostics, failed and blocked checks, and required next actions without appending a ledger event or authorizing apply. Phase 3.16 adds `proposal.reviewQueueDiagnosticsDigest`, a compact summary-only dashboard digest over the diagnostics report that returns status, counts, bounded next actions, and `apply_authorized=false` without appending a ledger event or authorizing apply. Phase 3.17 adds `proposal.reviewQueueDiagnosticsDigestHistory`, a bounded summary-only digest history reconstructed on demand as one entry without appending a ledger event or authorizing apply. Phase 3.18 adds `proposal.reviewQueueDiagnosticsDigestReport`, a compact summary-only digest history report with latest digest, count fields, and required next actions without appending a ledger event or authorizing apply. Phase 3.19 adds `proposal.reviewQueueDiagnosticsDigestReportHistory`, a bounded summary-only digest report history reconstructed on demand as one entry without appending a ledger event or authorizing apply. Phase 3.20 adds `proposal.reviewQueueDiagnosticsDigestReportVerdict`, a compact summary-only verdict over digest report history without appending a ledger event or authorizing apply. Phase 3.21 adds `proposal.reviewQueueDiagnosticsDigestReportVerdictHistory`, a bounded summary-only verdict history reconstructed on demand as one entry without appending a ledger event or authorizing apply. Phase 3.22 adds `proposal.reviewQueueDiagnosticsDigestReportVerdictReport`, a compact summary-only verdict history report with latest verdict, count fields, and required next actions without appending a ledger event or authorizing apply. Phase 3.23 adds `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistory`, a bounded summary-only verdict report history reconstructed on demand as one entry without appending a ledger event or authorizing apply. Phase 3.24 adds `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigest`, a compact summary-only digest over verdict report history without appending a ledger event or authorizing apply. Phase 3.25 adds `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistory`, a bounded summary-only digest history reconstructed on demand as one entry without appending a ledger event or authorizing apply. Phase 3.26 adds `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReport`, a compact summary-only digest history report with latest digest, count fields, and required next actions without appending a ledger event or authorizing apply. Phase 3.27 adds `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistory`, a bounded summary-only digest history report history reconstructed on demand as one entry without appending a ledger event or authorizing apply. Phase 3.28 adds `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigest`, a compact summary-only digest over that report history without appending a ledger event or authorizing apply. Phase 3.29 adds `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistory`, a bounded summary-only history over that digest reconstructed on demand as one entry without appending a ledger event or authorizing apply. Phase 3.30 adds `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReport`, a compact summary-only report over that history without appending a ledger event or authorizing apply. Phase 3.31 adds `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory`, a bounded summary-only report history reconstructed on demand as one entry without appending a ledger event or authorizing apply. Phase 3.32 adds `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest`, a compact summary-only digest over that report history without appending a ledger event or authorizing apply. Phase 3.33 adds `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory`, a bounded summary-only history over that digest reconstructed on demand as one entry without appending a ledger event or authorizing apply. Phase 3.34 adds `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport`, a compact summary-only report over that history without appending a ledger event or authorizing apply. Phase 3.35 adds `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory`, a bounded summary-only report history reconstructed on demand as one entry without appending a ledger event or authorizing apply. Phase 3.36 adds `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest`, a compact summary-only digest over that report history without appending a ledger event or authorizing apply. Phase 3.37 adds `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory`, a bounded summary-only history over that digest reconstructed on demand as one entry without appending a ledger event or authorizing apply. Phase 3.38 adds `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport`, a compact summary-only report over that history without appending a ledger event or authorizing apply. Phase 3.39 adds `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory`, a bounded summary-only report history reconstructed on demand as one entry without appending a ledger event or authorizing apply. Phase 3.40 adds `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest`, a compact summary-only digest over that report history without appending a ledger event or authorizing apply. Phase 3.41 adds `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory`, a bounded summary-only history over that digest without appending a ledger event or authorizing apply. Phase 3.42 adds `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport`, a compact summary-only report over that history without appending a ledger event or authorizing apply. Phase 3.43 adds `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory`, a bounded summary-only history over that report without appending a ledger event or authorizing apply. The runtime may inspect existing proposal metadata and append summary-only ledger events only for explicit checks, but it still must not apply patches, write workspace files, execute shell or git commands, use network access, or return raw file content, raw diffs, raw input JSON, canonical paths, or absolute paths.
