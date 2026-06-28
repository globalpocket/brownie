# Prompt Sensitive Guard Spec v0

Brownie scans LLM prompt messages immediately before provider calls to reduce accidental transmission of secret-like content.

## Configuration

Profiles may set `sensitive_guard` to `off`, `warn`, or `fail`. `BROWNIE_LLM_SENSITIVE_GUARD` overrides the active profile. If neither is set, Fake defaults to `warn` and OpenAI-compatible defaults to `fail`.

## Categories

The scanner reports categories only: `authorization_header`, `bearer_token`, `api_key_assignment`, `access_token_assignment`, `private_key_block`, `ssh_private_key_block`, `env_file_secret`, `github_token_like`, and `openai_key_like`.

## Behavior

`off` scans without blocking. `warn` allows the provider call and records warning metadata when findings exist. `fail` blocks before provider calls and fails the task.

Ledger and inspection surfaces persist only category, count, message index, and mode metadata. Matched secret text, full prompts, and full provider responses are never persisted.
