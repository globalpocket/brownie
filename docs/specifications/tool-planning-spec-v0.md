# Tool Planning Spec v0

Phase 1.5 introduces a dry-run tool planning layer before any future tool execution.

## Scope

- `brownie-tools` owns tool schema models, the built-in tool registry, deterministic planning, and permission evaluation helpers.
- Built-in tool definitions describe `workspace.read`, `workspace.write`, `process.exec`, `subtask.spawn`, `network.access`, `service.control`, and `destructive.operation`.
- Tool definitions are declarative only. Phase 1.5 does not execute file reads, file writes, process commands, subtask spawns, network access, service control, or destructive operations.

## Planning

`ToolPlanner` deterministically produces a `ToolPlan` from task id, goal, and mode id:

- all tasks include `workspace.read`;
- implementation or edit language includes `workspace.write`;
- test, check, verify, or run language includes `process.exec`;
- `orchestrator` mode includes `subtask.spawn`.

## Permission evaluation

`ToolPlanEvaluator` evaluates each planned item with `RuntimePermissionGate`. Runtime permissions override the dry-run plan and any future LLM instruction.

## JSON-RPC

- `tool.list` returns declarative built-in tool summaries.
- `tool.plan` reads an existing task and returns dry-run permission decisions. It is a read-only planning check.

## Ledger lifecycle

`task.run` records the dry-run lifecycle:

1. `ToolPlanned`
2. `ToolPermissionChecked`
3. `ToolPlanApproved` or `ToolPlanDenied`

A denied dry-run tool plan does not fail `task.run` in Phase 1.5 because no actual tool request is executed.

## Phase 1.6 assistant tool intent dry-run

Phase 1.6 adds assistant tool intent parsing from fenced `brownie-tool-intent` JSON blocks. The runtime validates all requested tool IDs against `BuiltinToolRegistry` and evaluates valid requests with `RuntimePermissionGate`. Denied or rejected assistant tool intent is recorded for inspection, but no tool is executed and `task.run` remains allowed to complete in this phase.

## Phase 1.7 read-only tool execution note

Phase 1.7 adds standalone `tool.execute` for permission-gated `workspace.read` execution only. All writes, process execution, subtasks, network access, service control, and destructive operations remain non-executable. `task.run` does not automatically execute tools in Phase 1.7. See `docs/specifications/tool-execution-spec-v0.md` for workspace boundary, protected path, truncation, UTF-8, and ledger behavior.
