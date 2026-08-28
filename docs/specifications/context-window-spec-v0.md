# Context Window Specification v0

## Purpose

Brownie must control LLM prompt size while preserving durable task history.

The `brownie-context` crate owns prompt materialization, token budgeting, and sliding window truncation.

## Core rule

Sliding window truncation applies only to the prompt view. It must not delete the persisted run ledger.

```text
RunLedger
  -> ContextMaterializer
  -> SlidingWindowTruncator
  -> PromptBuilder
  -> LLM request
```

## Protected content

The prompt view should preserve:

- active mode instruction
- current task goal
- current compiled mode policy summary
- latest explicit user instruction
- unresolved tool calls and results
- active file diff state
- active verification state
- compact subtask results

## Truncatable content

The prompt view should prefer trimming:

- old assistant messages
- old tool output bodies
- completed subtask detailed logs
- duplicate ledger materialization
- stale retrieval snippets
- old diffs superseded by newer diffs

## Tool result compaction

Large tool output can be represented compactly in the prompt while the ledger keeps the durable record.

A compact tool result should preserve tool name, status, relevant summary, affected paths, exit code, and error class when available.

## Non-goals for v0

- Semantic memory compression.
- Learned summarization.
- Exact tokenizer parity for every model.

## Phase 1.2 prompt materialization

Phase 1.2 introduces the first minimal `ContextMaterializer` and `PromptBuilder` implementation in `brownie-context`.

The materializer reads the persisted `TaskRecord` and the append-only ledger events for the run, then produces a `PromptBuildInput` containing the task goal, task/run identifiers, optional mode id, and a simple deterministic ledger summary. This is intentionally not semantic summarization.

The prompt builder emits a fixed two-message prompt:

- a protected system message identifying Brownie Runtime and stating that real LLM/tool execution is disabled in this phase
- a user message containing task metadata, the current goal, and ledger summary lines

Sliding window truncation remains a placeholder. Phase 1.2 may use a character-budget stub, but truncation applies only to the prompt view and must preserve protected content such as the system message and current task goal. It must not delete or rewrite the persisted ledger.

## MP-3 protected Mode Pack instructions

AgentModes `customInstructions` and related workflow prose enter the prompt only
after compiling into task-pinned Mode Pack policy and being recorded in
`ModeResolved`. `ContextMaterializer` turns that snapshot into bounded
`mode_instruction_material`, and `PromptBuilder` places it in the protected
system message with runtime safety invariants and the compiled permission policy
summary.

Sliding window truncation must preserve that system-policy region. Old ledger
summaries, duplicated history, stale retrieval snippets, and other user-message
material may be trimmed before dropping the compiled mode instructions selected
for the active task. The protected region is still subject to upstream compiled
field bounds and fingerprints; it must not persist raw provider responses,
secrets, raw file content, command output, or unbounded AgentModes source files.

MP-3.1 makes budget fitting explicit for materialized ledger context. When a
requested prompt budget cannot fit the protected runtime policy, compiled
Mode Pack policy, and task objective plus the requested recent ledger window,
`ContextMaterializer` trims oldest materialized ledger summary entries until the
prompt fits or no ledger entries remain. The persisted ledger is unchanged, and
the context-window summary records the effective included and omitted counts.
If protected policy and task context still exceed the requested budget after
trimming truncatable context, `task.run` fails closed with context-budget
evidence instead of dropping protected policy.
