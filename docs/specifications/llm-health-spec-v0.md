# LLM health spec v0

Phase 2.5 adds `llm.health`, an explicit JSON-RPC readiness probe for the selected LLM provider.

## Request

`llm.health` requires params with `allow_network` and accepts optional `timeout_ms`.

```json
{"allow_network": true, "timeout_ms": 5000}
```

`allow_network` is mandatory. `timeout_ms` defaults to 5000 and must be between 1000 and 30000 inclusive; values outside that range return JSON-RPC `-32602`.

## No-network behavior

The default Fake provider never performs network access. It returns `attempted=false`, `healthy=true`, `enabled=true`, and a `PROVIDER_FAKE_HEALTHY` diagnostic.

For OpenAI-compatible providers, `allow_network=false` never contacts the endpoint. The result returns `attempted=false`, `healthy=false`, and a `HEALTH_NETWORK_NOT_ALLOWED` warning.

Disabled or incomplete OpenAI-compatible configuration also returns `attempted=false` and `healthy=false`.

## OpenAI-compatible probe

When the selected provider is OpenAI-compatible, enabled, and `allow_network=true`, the runtime sends `GET {base_url}/models` using bearer authorization and the validated timeout. A 2xx HTTP status is healthy. Response bodies are not persisted or returned, and JSON parsing is not required for Phase 2.5.

## Redaction and persistence

`llm.health` is a global inspection API, not a task run event. It does not write to the run ledger. Health results, reasons, diagnostics, errors, status, and inspection data must not expose API keys, Authorization headers, Bearer tokens, or URL query-string secrets. Health responses contain only high-level metadata such as provider, model, redacted base URL, status code, latency, and redacted reason.

## Phase 2.6 real-provider task.run guard

`BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK=true` is required before strict enabled OpenAI-compatible `task.run` may make network LLM calls. The default is false. `llm.status` and `runtime.config.get` expose `task_run_network_allowed`; `runtime.diagnostics.get` reports `TASK_RUN_NETWORK_ALLOWED` or `TASK_RUN_NETWORK_NOT_ALLOWED` for strict enabled OpenAI-compatible profiles. Missing guard is a warning in diagnostics and a pre-network `task.run` error. Non-strict OpenAI-compatible `task.run` falls back to Fake. See `docs/specifications/real-provider-task-run-smoke-spec-v0.md`.
