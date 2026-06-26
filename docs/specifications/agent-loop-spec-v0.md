# Agent Loop Specification v0

## Purpose

The Brownie agent loop is the runtime authority that advances a task from creation to completion. It must be implemented as an explicit Rust state machine, not as implicit prompt-only behavior.

## Scope

This specification covers the observable task execution behavior Brownie intends to reimplement from Zoo Code-style agent workflows.

## State model

The initial state set is:

```text
TaskCreated
LoadMode
BuildContext
BuildPrompt
CallLlm
ParseAssistantOutput
DecideAction
ExecuteTool
ApplyPatch
SpawnSubtask
Wait
AskUser
Retry
Complete
Failed
Cancelled
```

The Rust crate `brownie-agent-loop` owns this state model.

## Runtime authority

The runtime, not the LLM, decides whether an action is allowed.

The invariant is:

```text
LLM instruction < Runtime permission
```

Examples:

- If a mode has no workspace write permission, `apply_patch` is rejected even if the LLM asks to edit.
- If a mode cannot spawn subtasks, subtask creation is rejected even if the LLM asks for delegation.
- If required verification has not run, a completion claim is not accepted.

## Completion gates

A task can enter `Complete` only when all configured completion gates pass.

Initial gates:

- Required artifacts exist or are explicitly marked not applicable.
- Required tool calls have completed.
- Required verification has completed.
- No unresolved tool call remains.
- No unresolved subtask remains.
- File edits, if any, have associated diff records.
- A completion report has been recorded.

## Tool execution

Tool execution is mediated by `brownie-tools` and policy compiled from AgentModes.

Tool results must be recorded into the run ledger. Large tool output can be compacted for prompt materialization, but the ledger remains the source of truth.

## Subtasks

Subtasks must not dump full transcript history back to a parent task.

A parent receives a compact result:

```text
- task id
- assigned mode
- goal
- result summary
- changed files
- tests run
- verification evidence
- unresolved issues
```

## Non-goals for v0

- Production implementation of all Zoo Code loop behaviors.
- Parallel subtask scheduling.
- Distributed task execution.
- Full UI timeline implementation.
