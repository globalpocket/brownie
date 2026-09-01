# Brownie Product Charter

Brownie exists to build an independent Rust-owned autonomous development runtime with thin human-facing frontends, including the Code-OSS VSIX and CLI, supporting agent loop execution, external Mode Packs, runtime-enforced permissions, controlled tools, persistent state, and headless long-running workflows.

The CLI uses general objective wording such as `brownie run "<objective>"` so the
interface is future-compatible and not hard-coded to a `develop` command name.
That naming does not expand the Core product mission into a generic personal
assistant platform; actual executable capabilities remain bounded by the Rust
runtime, active Mode Packs, runtime permissions, controlled tools, and the
Product DoD accepted for Brownie.

Brownie Runtime release readiness is not the same as commercial solution
readiness. The runtime owns task/run/journey state, the agent loop, Mode Pack
policy materialization, permissions, controlled tools, workspace proposal/apply,
approval semantics, checkpoints, replay/stale/conflict protection, bounded
completion decisions, and generic control-plane/adapter protocol contracts.
Schedulers, queues, workers, leases, hosted isolation, Secret Provider
implementations, tenants, metrics, alerts, SLA, billing, forge apps,
notifications, customer admin UI, and language-specific adapter breadth are
external control-plane, external adapter, or commercial readiness work.

The authoritative split is
`docs/specifications/runtime-boundary-and-release-dod-spec-v0.md`. Product DoD
and release debt evidence must not classify external control-plane, adapter, or
commercial solution gaps as Brownie Runtime `required_before_release` blockers.

This repository copy mirrors the automation-owned charter used by the phase loop. The external automation state remains the scheduled task source of truth, but project planning and review artifacts in this repository must stay consistent with this charter.

## Non-Goals

- Do not replicate Zoo Code source code.
- Do not optimize for adding endpoints.
- Do not create observability wrappers without new user capability.
- Do not treat CI success as sufficient evidence of product progress.
- Do not make a scheduler, daemon, job queue, hosted tenant system, GitHub App,
  monitoring/SLA stack, billing system, or customer admin UI a prerequisite for
  Brownie Runtime release.

## Strategic Capabilities

- agent_loop
- mode_pack_runtime
- runtime_permission_enforcement
- controlled_workspace_tools
- context_management
- llm_provider_execution
- codebase_indexing
- subtask_orchestration
- progress_visualization
- headless_autonomous_development

## Milestone Roadmap

1. R1 Architecture Recovery
2. M1 Agent Loop Integration
3. M2 Mode Pack Runtime
4. M3 Controlled Apply Readiness
5. M4 Context Management
6. M5 Subtask Orchestration
7. M6 Controlled Apply Execution
8. M7 Controlled Verification Execution
9. M8 Verification Failure Recovery
10. R3 Verifier Integrity And Recovery Hardening
11. M9 Runtime Codebase Indexing
12. M10 Runtime Progress Visualization

The phase loop may refine implementation order, split milestones, or insert safety work, but it may not replace this roadmap with observability-only, reporting-only, or wrapper-only work. Every accepted phase must advance at least one strategic capability or remove a documented blocker to one.
