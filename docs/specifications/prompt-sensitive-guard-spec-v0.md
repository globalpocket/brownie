# Prompt Sensitive Guard Spec v0

Brownie classifies LLM prompt message text with a low-false-positive sensitive-content scanner before provider calls. The scanner records only bounded metadata: finding categories and message indexes. It must not persist, return, or serialize matched secret values.

This does not remove non-prompt content safety checks used by workspace patch validation or codebase indexing. Those paths may still reject or skip file content that looks sensitive because they control persisted workspace/index artifacts rather than LLM prompt admission.

## Configuration

Profiles may set `sensitive_guard` to `off`, `warn`, or `fail`. `BROWNIE_LLM_SENSITIVE_GUARD` overrides the active profile. If neither is set, providers default to `off`.

## Categories

The prompt scanner detects high-confidence sensitive-like categories such as Authorization bearer headers, token-bearing `api_key` / `access_token` assignments, private-key blocks, GitHub token-like values, and sufficiently long OpenAI-key-like `sk-` values. Short ordinary words containing `sk-`, such as prose around disk checks, must not be classified as OpenAI keys.

## Behavior

`off` and `warn` allow provider calls while keeping scan evidence bounded. `fail` is reserved for fail-closed provider admission before transmission when findings are present.

Runtime status, diagnostics, ledger, and inspection surfaces must still not expose API key values, Authorization/Bearer header values, or full provider responses. That redaction is separate from prompt-text admission.
