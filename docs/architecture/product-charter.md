# Brownie Product Charter

Brownie exists to build an independent Rust-owned autonomous development runtime with a thin Code-OSS VSIX, supporting agent loop execution, external Mode Packs, runtime-enforced permissions, controlled tools, persistent state, and headless long-running development workflows.

This repository copy mirrors the automation-owned charter used by the phase loop. The external automation state remains the scheduled task source of truth, but project planning and review artifacts in this repository must stay consistent with this charter.

## Non-Goals

- Do not replicate Zoo Code source code.
- Do not optimize for adding endpoints.
- Do not create observability wrappers without new user capability.
- Do not treat CI success as sufficient evidence of product progress.

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

The phase loop may refine implementation order, split milestones, or insert safety work, but it may not replace this roadmap with observability-only, reporting-only, or wrapper-only work. Every accepted phase must advance at least one strategic capability or remove a documented blocker to one.
