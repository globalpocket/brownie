# Real-provider task.run smoke spec v0

Phase 2.6 adds a guarded `task.run` smoke path for the OpenAI-compatible provider. The runtime never contacts a real provider during `task.run` unless the selected provider is OpenAI-compatible, the provider is enabled, `strict=true`, and `BROWNIE_LLM_ALLOW_PROVIDER_ACCESS=true` is explicitly set. The default value is false.

The explicit guard exists because `task.run` can send task context and tool feedback prompts to an LLM endpoint. `llm.health` already has a per-request `allow_network` flag; `task.run` is guarded by environment opt-in so automated tests, editor commands, and local runs cannot accidentally contact a real endpoint.

Without the guard, strict OpenAI-compatible `task.run` fails before the first LLM request with `real-provider task.run requires BROWNIE_LLM_ALLOW_PROVIDER_ACCESS=true`; non-strict OpenAI-compatible configurations fall back to Fake. Fake remains the default provider.

For migration compatibility, `BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK=true` is still accepted when `BROWNIE_LLM_ALLOW_PROVIDER_ACCESS` is unset. If both guards are set and disagree, Runtime fails closed before any provider request with bounded conflict evidence and diagnostics report `TASK_RUN_NETWORK_GUARD_CONFLICT`.

Mock smoke coverage uses a local OpenAI-compatible server implementing `/v1/chat/completions` and `/v1/models`. The chat endpoint verifies an Authorization header is present without logging its value, returns a first-pass `workspace.read` intent, and returns a second-pass final response after tool feedback.

Optional local endpoint smoke:

1. Configure `.brownie/config.json` with an OpenAI-compatible strict profile.
2. Export `BROWNIE_LLM_API_KEY`, `BROWNIE_LLM_ALLOW_PROVIDER_ACCESS=true`, and `BROWNIE_CLI_RUN_MODE_ID=provider-runner`.
3. Run `llm.health` with `allow_network=true` to probe `/models`.
4. Run `brownie run "Hello"` or the equivalent `task.start`, `task.run`, and `run.inspect` sequence to verify provider metadata.

`BROWNIE_CLI_RUN_MODE_ID` is a CLI transport hint only. It requests the task
mode in the runtime-owned `task.start` admission payload and does not grant
provider access by itself. The runtime still resolves the mode, checks
`AccessLlmProvider`, requires `BROWNIE_LLM_ALLOW_PROVIDER_ACCESS=true`, applies
provider budget and sensitive-content guards, and denies the task before any
provider request when those checks fail.

Phase 2.6 does not add streaming, workspace.write, file write, patch apply, process execution, network tools, service control, destructive operations, subtask spawning, AgentModes YAML parsing, ModePack activation, Qdrant, llama-server lifecycle control, or indexing. Ledgers, inspection, diagnostics, status, health, and errors must not expose API keys, Authorization headers, Bearer tokens, query-string secrets, full prompts, full provider responses, or full README content.

## Phase 2.7 LLM request budget note

See [LLM Request Budget Spec v0](llm-request-budget-spec-v0.md). Runtime provider requests are bounded by the resolved budget, status/config responses include the budget summary, diagnostics report default/profile/env/invalid budget sources, and ledger/inspection payloads keep prompt and response previews only.

## Phase 2.8 prompt sensitive guard

Runtime LLM configuration keeps the `sensitive_guard` knob (`off`, `warn`, `fail`) with `BROWNIE_LLM_SENSITIVE_GUARD` as the highest-priority override. Prompt text is scanned with low-false-positive sensitive-content detection before provider calls, and scan evidence records only categories and message indexes. Runtime status, diagnostics, ledger, and inspection APIs still must not expose API key values, Authorization/Bearer header values, matched secret values, or full provider responses.
