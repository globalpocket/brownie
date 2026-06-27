# Brownie Runtime Config Spec v0

Brownie Phase 2.2 supports an optional workspace-local runtime configuration file at `.brownie/config.json`.

## Schema

The Phase 2.2 schema uses `version: 1`, an `active_profile`, and LLM provider profiles:

```json
{
  "version": 1,
  "active_profile": "fake",
  "llm": {
    "profiles": {
      "fake": { "provider": "fake", "model": "brownie-fake-llm" },
      "local-qwen": {
        "provider": "openai-compatible",
        "base_url": "http://127.0.0.1:4141/v1",
        "model": "qwen35",
        "api_key_env": "BROWNIE_LLM_API_KEY",
        "strict": true
      }
    }
  }
}
```

## Provider selection priority

1. Explicit environment override when `BROWNIE_LLM_PROVIDER` is set.
2. Workspace config `.brownie/config.json` `active_profile`.
3. Default Fake provider.

Supported environment variables remain `BROWNIE_LLM_PROVIDER`, `BROWNIE_LLM_BASE_URL`, `BROWNIE_LLM_MODEL`, `BROWNIE_LLM_API_KEY_ENV`, `BROWNIE_LLM_API_KEY`, and `BROWNIE_LLM_STRICT`.

## Secret handling

Config files must not store direct API key values. A direct `api_key` field anywhere in the JSON document is a validation error. Config profiles may only name the environment variable containing the secret via `api_key_env`. Runtime status, inspection, ledger events, and errors must not expose API keys, Authorization headers, or bearer tokens.

## Protocol

`llm.status` returns `config_source` (`Env`, `WorkspaceConfig`, or `Default`) and `active_profile`.

`runtime.config.get` returns the sanitized runtime config view:

```json
{
  "config_source": "WorkspaceConfig",
  "config_path": ".brownie/config.json",
  "active_profile": "fake",
  "llm_status": { "provider": "Fake", "config_source": "WorkspaceConfig" }
}
```

## Phase 2.3 OpenAI-compatible smoke and redaction clarification

Phase 2.3 requires deterministic mock-server coverage for config-profile opt-in to the OpenAI-compatible provider. The mock path validates `POST /v1/chat/completions`, the `model` field, system/user messages, presence of an `Authorization` header without logging its value, successful response parsing, and strict failures for non-2xx, malformed JSON, and missing choices.

CI must not require a live local or external LLM endpoint. Optional live local endpoint smoke steps are documented in `docs/specifications/openai-compatible-smoke-spec-v0.md`.

Run inspection/event metadata may include provider, model, redacted base URL, and strict mode. It must not include API key values, `Authorization`, or `Bearer` token values.

Unknown `BROWNIE_LLM_PROVIDER` values must not silently become Fake. Status reports `provider=Unknown`, `enabled=false`, and a safe explanatory reason; strict task runs fail.
