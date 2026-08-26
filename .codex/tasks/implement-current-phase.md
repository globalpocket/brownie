# Implement Current Brownie Phase

This repository task file is a compatibility pointer for older Codex task setups. It is not the scheduled controller authority.

## Source Of Truth

The scheduled Brownie CLI phase loop uses the external automation root:

```text
~/.codex/automations/brownie-cli-phase-loop/
```

Before implementing, read the external `phase-state.json`, the `active_prompt` path named there, `latest-review.md`, `review-memory.md`, `stop-reason.md`, `automation.toml`, and the active `run.lock`.

## Current Controller Rule

Implementation may start only when the external authoritative state has `status = ready_to_implement`. The implementation run must then create or reuse a dedicated `codex/phase-...` branch, move the external state to `implementing`, implement the accepted bounded phase, validate, open a PR, and move external state to `awaiting_review`.

Do not use repo-local `.brownie-control/phase-state.json` as live state. It is a pointer file only.
