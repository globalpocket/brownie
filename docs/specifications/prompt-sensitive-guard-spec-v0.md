# Prompt Sensitive Guard Spec v0

Brownie no longer classifies LLM prompt message text as secret-like content or blocks provider calls because a prompt contains serial-key/API-key-looking strings. Secret and key hygiene is owned by the caller's environment and configuration layer outside Brownie's prompt admission path.

This does not remove non-prompt content safety checks used by workspace patch validation or codebase indexing. Those paths may still reject or skip file content that looks sensitive because they control persisted workspace/index artifacts rather than LLM prompt admission.

## Configuration

Profiles may still set `sensitive_guard` to `off`, `warn`, or `fail` for compatibility with older configs. `BROWNIE_LLM_SENSITIVE_GUARD` overrides the active profile. If neither is set, providers default to `off`.

## Categories

The prompt scanner emits no findings. Previous categories are retained only as historical ledger vocabulary for older runs.

## Behavior

`off`, `warn`, and `fail` all allow provider calls because prompt text classification is not a Runtime safety boundary.

Runtime status, diagnostics, ledger, and inspection surfaces must still not expose API key values, Authorization/Bearer header values, or full provider responses. That redaction is separate from prompt-text admission.
