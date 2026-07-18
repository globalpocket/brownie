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

## R1 architecture recovery

R1 freezes the Phase 3 diagnostics wrapper chain and redirects follow-up work to diagnostics API consolidation. New phases must not extend the `proposal.reviewQueueDiagnostics...Digest...Report...History` pattern.

See `docs/architecture/diagnostics-api-consolidation.md`, `docs/architecture/phase-value-gate.md`, `docs/architecture/phase-value-manifest.json`, and `docs/architecture/diagnostics-legacy-api-metadata.json` for the inventory, deprecation plan, value/review guard, and R1.1 enforcement metadata.

## Patch apply boundary

Patch application remains a read-only design and inspection boundary. Brownie may report proposal readiness, review evidence, dry-run metadata, and diagnostics state, but it must not apply patches, write workspace files, execute shell or git commands, use network access, or return raw file content, raw diffs, raw input JSON, canonical paths, or absolute paths.

The Phase 3.5-3.51 wrapper-chain history is archived in `docs/architecture/diagnostics-wrapper-history.md`, with the endpoint inventory and deprecation plan in `docs/architecture/diagnostics-api-consolidation.md`. After R1.1, the next milestone is M1 Agent Loop Integration (`agent_loop_integration`).

## Subtask Recovery Outcomes

Recovery-cycle budget exhaustion is surfaced through the existing parent task.run response and parent inspection path as `recovery_cycle_budget_outcome`. The outcome is derived from bounded runtime ledger evidence and reports only budget status, exceeded depth, max depth, parent join admission id, blocked candidate count, disabled child materialization/running signals, and next action. Repeated parent task.run for an already-budget-exhausted parent replays the existing outcome without adding parent TaskRunning, ParentJoinContinuationFingerprintConsumed, SubtaskDispatchHandoffEnvelopeRecorded, child TaskRecord, or child TaskRunning evidence.

When an existing parent task.run materializes newly controlled queued children, the response can include `child_orchestration_outcome`. The outcome exposes only bounded child-orchestration handles: parent run id, newly materialized controlled queued children by task id/count, queued child task id/count, `child_running_enabled=false`, and `next_action=run_child_task_explicitly`. It does not expose raw child prompts, provider output, tool input, stdout, stderr, scheduler handoff, or any child auto-run behavior; callers use existing parent inspection output and explicit child task.run to continue.

If the initial parent task.run response is lost or retried while those children are still queued and before any parent-join continuation has been consumed, the same `child_orchestration_outcome` contract can be replayed from existing queued controlled child TaskRecords before parent admission. The replay path returns `run_child_task_explicitly` handles without adding parent TaskRunning, parent join consumption, handoff envelope, child TaskRecord, child TaskRunning, scheduler handoff, or raw child data.

If a parent-join continuation task.run response is lost or retried after the consumed parent-join continuation has already materialized queued continuation children, the same bounded `child_orchestration_outcome` contract can also be replayed from existing queued continuation child TaskRecords tied to that parent join admission id. This replay is scoped to the latest consumed parent-join continuation and accepted continuation handoff fingerprints, so it returns stable `run_child_task_explicitly` child handles without duplicating materialization, adding TaskRunning evidence, requiring raw ledger scraping, exposing raw child data, or introducing scheduler handoff.

When an explicit controlled child task.run reaches `Completed` or `Failed` with complete runtime-owned parent provenance, the child response can include `parent_join_readiness_outcome`. The outcome exposes only bounded parent task/run ids, child task/run ids, child terminal status, `parent_join_ready=true`, `parent_running_enabled=false`, and `next_action=run_parent_task_explicitly`; it does not expose raw child goals, parent prompts, provider output, file content, commands, stdout/stderr, env, tool input, serialized request bodies, raw failure payloads, scheduler handoff, or parent auto-run behavior. The response path derives the signal from the child TaskRecord and terminal status, appends no parent TaskRunning event, consumes no parent join state, records no parent handoff envelope, and leaves explicit parent task.run as the only continuation step.
