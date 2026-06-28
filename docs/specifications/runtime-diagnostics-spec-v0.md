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
