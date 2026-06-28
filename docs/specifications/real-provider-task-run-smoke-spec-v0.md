# Real-provider task.run smoke spec v0

Phase 2.6 adds a guarded `task.run` smoke path for the OpenAI-compatible provider. The runtime never contacts a real provider during `task.run` unless the selected provider is OpenAI-compatible, the provider is enabled, `strict=true`, and `BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK=true` is explicitly set. The default value is false.

The explicit guard exists because `task.run` can send task context and tool feedback prompts to an LLM endpoint. `llm.health` already has a per-request `allow_network` flag; `task.run` is guarded by environment opt-in so automated tests, editor commands, and local runs cannot accidentally contact a real endpoint.

Without the guard, strict OpenAI-compatible `task.run` fails before the first LLM request with `real-provider task.run requires BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK=true`; non-strict OpenAI-compatible configurations fall back to Fake. Fake remains the default provider.

Mock smoke coverage uses a local OpenAI-compatible server implementing `/v1/chat/completions` and `/v1/models`. The chat endpoint verifies an Authorization header is present without logging its value, returns a first-pass `workspace.read` intent, and returns a second-pass final response after tool feedback.

Optional local endpoint smoke:

1. Configure `.brownie/config.json` with an OpenAI-compatible strict profile.
2. Export `BROWNIE_LLM_API_KEY` and `BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK=true`.
3. Run `llm.health` with `allow_network=true` to probe `/models`.
4. Run `task.start`, `task.run`, and `run.inspect` to verify provider metadata.

Phase 2.6 does not add streaming, workspace.write, file write, patch apply, process execution, network tools, service control, destructive operations, subtask spawning, AgentModes YAML parsing, ModePack activation, Qdrant, llama-server lifecycle control, or indexing. Ledgers, inspection, diagnostics, status, health, and errors must not expose API keys, Authorization headers, Bearer tokens, query-string secrets, full prompts, full provider responses, or full README content.

## Phase 2.7 LLM request budget note

See [LLM Request Budget Spec v0](llm-request-budget-spec-v0.md). Runtime provider requests are bounded by the resolved budget, status/config responses include the budget summary, diagnostics report default/profile/env/invalid budget sources, and ledger/inspection payloads keep prompt and response previews only.
