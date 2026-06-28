# LLM Request Budget Spec v0

Brownie enforces an LLM request budget at runtime before provider calls.

## Schema

Profiles may include `budget` with these optional fields:

- `max_prompt_chars` (default `120000`, hard bounds `1000..=1000000`)
- `max_messages` (default `64`, hard bounds `1..=256`)
- `request_timeout_ms` (default `30000`, hard bounds `1000..=300000`)
- `response_preview_chars` (default `2000`, hard bounds `100..=20000`)

Unspecified profile fields use defaults.

## Environment overrides

Environment variables override profile and default values:

- `BROWNIE_LLM_MAX_PROMPT_CHARS`
- `BROWNIE_LLM_MAX_MESSAGES`
- `BROWNIE_LLM_REQUEST_TIMEOUT_MS`
- `BROWNIE_LLM_RESPONSE_PREVIEW_CHARS`

Priority is env override, then active profile budget, then default budget.

## Runtime behavior

Before an LLM provider call, Brownie checks message count and total prompt characters. Budget failures do not call the provider. The task fails with `LlmRequestFailed` and `TaskFailed` ledger events and a high-level redacted JSON-RPC error.

Prompt and response ledger payloads store previews only. Full prompt text and full provider responses are not persisted. Response preview length is controlled by `response_preview_chars`; prompt preview payloads include `max_prompt_chars`.

`llm.status`, `runtime.config.get`, and diagnostics expose budget summaries. `llm.health` uses `request_timeout_ms` unless an explicit bounded `timeout_ms` is supplied.

## Phase 2.8 prompt sensitive guard

Runtime LLM configuration includes `sensitive_guard` (`off`, `warn`, `fail`) with `BROWNIE_LLM_SENSITIVE_GUARD` as the highest-priority override. Fake defaults to `warn`; OpenAI-compatible defaults to `fail`. Provider calls are preceded by budget validation and prompt sensitive-content scanning. In fail mode, findings block the provider call and task failure metadata records only categories, counts, message indexes, and guard mode. Matched secret text, full prompt text, and full provider responses must not be persisted or exposed through status, diagnostics, ledger, or inspection APIs.
