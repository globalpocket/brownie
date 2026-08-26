# Review Current Brownie Phase And Plan Next Phase

This repository task file is a compatibility pointer for older Codex task setups. It is not the scheduled controller authority.

## Source Of Truth

The scheduled Brownie CLI phase loop uses the external automation root:

```text
~/.codex/automations/brownie-cli-phase-loop/
```

Before reviewing or planning, read the external `phase-state.json`, the active prompt path named there, `latest-review.md`, `review-memory.md`, `stop-reason.md`, `automation.toml`, and the active `run.lock`.

## Current Controller Rule

Review may start when the external authoritative state has `status = awaiting_review`. Planning may start when the external authoritative state has `status = planning_required`. The controller must complete at least one durable external state transition unless it is waiting on an allowed external blocker.

Do not use repo-local `.brownie-control/phase-state.json` as live state. It is a pointer file only.
