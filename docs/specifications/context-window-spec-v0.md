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
