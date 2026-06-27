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
