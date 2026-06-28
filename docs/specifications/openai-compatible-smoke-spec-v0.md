# OpenAI-compatible smoke specification v0

Brownie Phase 2.3 verifies the OpenAI-compatible provider through deterministic mock-server smoke tests. CI must not require an external hosted API or a real local LLM endpoint.

## Mock server smoke path

Automated Rust tests start a loopback mock server that serves:

```text
POST /v1/chat/completions
```

The runtime must only reach this server when a workspace config profile explicitly selects `provider: "openai-compatible"`. The default provider remains Fake.

Expected request shape:

```json
{
  "model": "mock-model",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ]
}
```

The request must include an `Authorization` header, but tests must not print the header value.

Expected successful response shape:

```json
{
  "choices": [
    { "message": { "content": "Mock OpenAI-compatible final response." } }
  ]
}
```

Strict-mode regressions cover non-2xx responses, malformed JSON, and responses with missing choices. These failures must record LLM failure events and fail the task without leaking API keys, `Authorization`, or bearer-token values.

## Optional live local endpoint smoke

This smoke is manual and optional. It is only for developers who already have a local OpenAI-compatible endpoint running. CI must not run it.

```bash
export BROWNIE_WORKSPACE_ROOT="$(mktemp -d)"
mkdir -p "$BROWNIE_WORKSPACE_ROOT/.brownie"
cat > "$BROWNIE_WORKSPACE_ROOT/.brownie/config.json" <<'JSON'
{
  "version": 1,
  "active_profile": "local-qwen",
  "llm": {
    "profiles": {
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
JSON

export BROWNIE_LLM_API_KEY="<local-api-key>"
printf '# Brownie\n' > "$BROWNIE_WORKSPACE_ROOT/README.md"

printf '{"jsonrpc":"2.0","id":1,"method":"llm.status"}\n' | cargo run -q -p brownie-runtime
printf '{"jsonrpc":"2.0","id":2,"method":"runtime.config.get"}\n' | cargo run -q -p brownie-runtime
```

Expected status/config output includes `provider=OpenAiCompatible`, `config_source=WorkspaceConfig`, `active_profile=local-qwen`, `enabled=true`, and `strict=true`. It must not include the API key value.

A live `task.run` smoke is optional and must only be run when the local endpoint is available.

## Redaction and inspection expectations

Run inspection and event APIs may expose sanitized provider metadata needed for debugging: provider, model, redacted base URL, and strict mode. They must not expose API key values, `Authorization`, or `Bearer` token values.

## Unknown provider handling

If `BROWNIE_LLM_PROVIDER` contains an unknown value, Brownie must not silently report Fake as the selected provider. `llm.status` reports an explanatory disabled status with `provider=Unknown`, `enabled=false`, and `reason="unknown provider: <value>"`. In strict mode, `task.run` fails rather than falling back silently.

## Phase 2.4 diagnostics smoke checks

Use `runtime.diagnostics.get` to inspect OpenAI-compatible configuration completeness without contacting the endpoint. Missing API key environment variables produce `API_KEY_ENV_MISSING` and either fallback or strict-failure diagnostics. Direct `api_key` fields produce `CONFIG_DIRECT_API_KEY_REJECTED` without leaking the value.
