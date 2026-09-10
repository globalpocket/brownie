# BDK / Prompt / LLM autonomous development architecture

This document describes Brownie's autonomous-development control architecture.
It is an implementation guide for Brownie maintainers, not an end-user product
manual.

## Principle

Brownie autonomous development is a coordinated control system:

- BDK owns state, scheduling, TODO decomposition, context planning, verification,
  and PR orchestration.
- Prompt owns the current bounded output contract for the selected state.
- LLM owns only the bounded judgment or patch generation requested by that
  state.

The LLM must not be treated as the scheduler. Runtime and BDK decide what state
the loop is in, which tools are available, which evidence is already known, and
when read-only discovery has stopped making progress.

## Control states

The Runtime prompt exposes a `BDK Control Packet` with a compact state:

- `context_plan`: select the smallest exact file or git inspection set.
- `implement_patch`: use completed read evidence and propose one bounded patch
  or concrete blocker.
- `repair_patch`: repair from verifier or tool failure evidence.
- `decompose_todo`: replace broad work with implementable leaf TODOs.
- `blocker_or_write`: stop read-only discovery after duplicate read denial.
- `direct_answer`: answer without tool intent.

The packet is prompt guidance only. It does not grant permissions.

## Context policy

Ledger remains the durable audit log. The LLM receives a smaller working
context:

- selected TODO claim and bounded queue snapshot,
- inferred context hints,
- latest tool and verifier evidence,
- bounded read previews,
- prompt and request timing telemetry.

Large file reads must not be carried forward unbounded. The context prompt uses
short previews and content hashes so the LLM can rely on evidence without
turning every follow-up into a large prompt-eval job.

## Model routing

The phase-loop wrapper may map each claimed TODO to an LLM route:

- `fast`: decomposition, documentation, lightweight planning.
- `code`: implementation, release engineering, verification repair.
- `deep`: explicitly deep architecture or design work.

Route-specific model variables are optional. If unset, the wrapper preserves the
current `BROWNIE_LLM_MODEL`.

## Feedback loop

Runtime records `prompt_build_duration_ms`, `llm_request_duration_ms`, and
`llm_request_prompt_chars` on prompt/response ledger events. BDK should use
these values to detect slow or wasteful runs:

- high prompt chars: reduce context or decompose TODO,
- high LLM request time: use a faster route or smaller context profile,
- duplicate reads: stop follow-up LLM calls and force write/blocker handling,
- repeated read-only progress: classify as no progress.

## Next evolution

Future work should move more responsibility from prompt prose into BDK-owned
structured state:

1. a first-class context planner that selects exact files before LLM calls,
2. state-specific prompt templates,
3. model-route health and latency accounting,
4. automatic TODO decomposition based on failed or oversized states,
5. end-to-end PR orchestration through MCP/BDK adapters.
