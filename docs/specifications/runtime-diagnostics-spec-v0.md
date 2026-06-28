# Runtime diagnostics spec v0

Phase 2.4 adds `runtime.diagnostics.get`, a read-only JSON-RPC method for structured inspection of Brownie's effective runtime and LLM provider configuration.

## Method

```json
{"jsonrpc":"2.0","id":1,"method":"runtime.diagnostics.get"}
```

The method returns `config_source`, `active_profile`, sanitized `llm_status`, and a `diagnostics` array. It does not contact external LLM endpoints.

Each diagnostic has:

- `severity`: `Info`, `Warning`, or `Error`.
- `code`: a stable machine-readable string.
- `message`: a human-readable, redacted explanation.
- `subject`: an optional config field, profile name, file path, or environment variable.

## Diagnostic codes

Phase 2.4 codes include `CONFIG_NOT_FOUND`, `CONFIG_MALFORMED`, `CONFIG_UNSUPPORTED_VERSION`, `CONFIG_DIRECT_API_KEY_REJECTED`, `ACTIVE_PROFILE_MISSING`, `ACTIVE_PROFILE_UNKNOWN`, `PROVIDER_DEFAULT_FAKE`, `PROVIDER_WORKSPACE_PROFILE`, `PROVIDER_ENV_OVERRIDE`, `PROVIDER_UNKNOWN`, `PROVIDER_FALLBACK_TO_FAKE`, `PROVIDER_STRICT_FAILURE`, and `API_KEY_ENV_MISSING`.

## Secret handling

Diagnostics must never return API key values, Authorization headers, Bearer tokens, or raw malformed config content. Direct `api_key` fields in `.brownie/config.json` are reported with `CONFIG_DIRECT_API_KEY_REJECTED`; callers must use `api_key_env` instead.

## Endpoint health

`runtime.diagnostics.get` performs no network calls. Any future endpoint health probe must be exposed as an explicit method such as `llm.health` and must continue to redact secrets.

## Phase 2.5 LLM health

Phase 2.5 adds the explicit `llm.health` JSON-RPC method, specified in `docs/specifications/llm-health-spec-v0.md`. `runtime.diagnostics.get` remains read-only and no-network. Endpoint readiness checks are only performed by `llm.health` when `allow_network=true`; Fake health remains no-network. OpenAI-compatible health uses `GET {base_url}/models`, does not persist response bodies, does not write run ledgers, and redacts API keys, Authorization/Bearer values, and query-string secrets.

## Phase 2.6 real-provider task.run guard

`BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK=true` is required before strict enabled OpenAI-compatible `task.run` may make network LLM calls. The default is false. `llm.status` and `runtime.config.get` expose `task_run_network_allowed`; `runtime.diagnostics.get` reports `TASK_RUN_NETWORK_ALLOWED` or `TASK_RUN_NETWORK_NOT_ALLOWED` for strict enabled OpenAI-compatible profiles. Missing guard is a warning in diagnostics and a pre-network `task.run` error. Non-strict OpenAI-compatible `task.run` falls back to Fake. See `docs/specifications/real-provider-task-run-smoke-spec-v0.md`.

## Phase 2.7 LLM request budget note

See [LLM Request Budget Spec v0](llm-request-budget-spec-v0.md). Runtime provider requests are bounded by the resolved budget, status/config responses include the budget summary, diagnostics report default/profile/env/invalid budget sources, and ledger/inspection payloads keep prompt and response previews only.
