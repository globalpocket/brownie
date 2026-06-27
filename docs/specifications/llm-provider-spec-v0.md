# Brownie LLM Provider Spec v0

Phase 2.0 introduces a configurable LLM provider boundary for connecting real LLM adapters safely while preserving the deterministic Fake provider as the default.

## Provider selection

- `BROWNIE_LLM_PROVIDER` unset or `fake` selects the Fake provider.
- `BROWNIE_LLM_PROVIDER=openai-compatible` opts in to the OpenAI-compatible provider.
- OpenAI-compatible configuration is read from environment variables only:
  - `BROWNIE_LLM_BASE_URL`
  - `BROWNIE_LLM_MODEL`
  - `BROWNIE_LLM_API_KEY_ENV` (defaults to `BROWNIE_LLM_API_KEY`)
  - the API key variable named by `BROWNIE_LLM_API_KEY_ENV`
- If required OpenAI-compatible configuration is missing, `llm.status` reports `enabled=false` with a missing-config reason, and `task.run` falls back to Fake for Phase 2.0 stability.

## Safety rules

- No real LLM API is contacted without explicit OpenAI-compatible configuration.
- API keys and Authorization/Bearer values are never returned by `llm.status`, ledger inspection, or error messages.
- Phase 2.0 supports non-streaming chat completions only.
- Phase 2.0 does not add tool execution capability.

## Ledger metadata

LLM request events store only safe metadata: `provider`, `model`, and `message_count`.
LLM response events store only `provider` and `content_preview`.
Full prompts, full responses, API keys, and Authorization headers are not persisted for inspection.

## Phase 2.1 strict OpenAI-compatible smoke path

Phase 2.1 keeps Fake as the default provider. The runtime does not make an external LLM call unless `BROWNIE_LLM_PROVIDER=openai-compatible` is explicitly selected and the required OpenAI-compatible configuration is present. Streaming remains out of scope.

`BROWNIE_LLM_STRICT` defaults to `false`. When OpenAI-compatible is requested with incomplete configuration, `strict=false` makes `task.run` fall back to Fake and `llm.status` reports `will_fallback_to_fake=true`; `strict=true` makes `task.run` fail without an external call. Runtime permissions continue to override LLM instructions.

`llm.status` includes `strict` and `will_fallback_to_fake`. Status, ledger, inspection, and error messages must not expose API keys, Authorization headers, Bearer tokens, or query-string secrets. Redaction covers Authorization, Bearer tokens, `api_key`, API key text, `access_token`, `token=`, and `key=` patterns.

OpenAI-compatible failures report only provider type, redacted base URL, model, and high-level failure reason for timeout/connection failure, non-2xx status, invalid JSON, missing choices, or missing message content.

## Phase 2.2 runtime config profiles

Provider selection now follows explicit environment override, then `.brownie/config.json` `active_profile`, then the default Fake provider. The default remains Fake and Brownie does not contact a real LLM API unless explicitly configured. OpenAI-compatible workspace profiles use `api_key_env`; direct `api_key` fields are rejected.

`llm.status` includes `config_source` and `active_profile` so callers can distinguish `Env`, `WorkspaceConfig`, and `Default` selection.
