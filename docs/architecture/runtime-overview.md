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

Phase 3.5 exposes `proposal.applyCapability` as a read-only design contract for future patch application. Phase 3.6 adds operator-controlled `proposal.applyDryRun` inspection, which reports dry-run gate metadata and explicitly records that no patch was applied and no workspace file changed. Phase 3.7 adds `proposal.applyDryRunHistory`, a summary-only audit view reconstructed from sanitized dry-run ledger events; it returns the latest dry run, the full dry-run count, and the 10 newest entries without appending a new event. Phase 3.8 adds `proposal.auditTrail`, a summary-only lifecycle view reconstructed from sanitized proposal, approval, preflight, readiness, capability, and dry-run ledger events; it returns the latest lifecycle entry, the total lifecycle event count, and up to 50 ordered entries without appending a new event. Phase 3.9 adds `proposal.reviewBundle`, a summary-only final review view that aggregates the latest readiness, apply capability, apply dry-run, and audit position without appending a new event. Phase 3.10 adds `proposal.reviewVerdict`, a compact summary-only final review verdict reconstructed from the same sanitized evidence; it reports `ReadyForHumanReview`, `NeedsSignals`, or `BlockedForReview` and always keeps `apply_authorized=false`. The runtime may inspect existing proposal metadata and append summary-only ledger events only for explicit checks, but it still must not apply patches, write workspace files, execute shell or git commands, use network access, or return raw file content, raw diffs, raw input JSON, canonical paths, or absolute paths.
