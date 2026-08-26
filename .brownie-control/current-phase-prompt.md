# Brownie Current Phase Prompt Pointer

This repository file is not the live current phase prompt.

Scheduled Brownie CLI phase-loop runs use the external automation root:

```text
~/.codex/automations/brownie-cli-phase-loop/
```

Read the active prompt path from the external `phase-state.json` and then read that prompt from the external `prompts/` directory. This in-repository file exists only to prevent older controller tasks from treating stale Phase 3 prompts as current work.
