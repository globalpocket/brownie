# Brownie Control-plane Authority

Brownie's scheduled CLI autonomous development controller is driven by the external automation root:

```text
~/.codex/automations/brownie-cli-phase-loop/
```

The external CLI root owns live phase-loop state, active prompts, review memory, stop reasons, lock ownership, and controller instructions. Repository files under `.brownie-control/` and `.codex/tasks/` are compatibility pointers only. They must not claim to be the sole source of truth, must not point the CLI campaign back to the completed Core Runtime campaign, and must not contain live phase state such as `current_phase`, `status`, `latest_pr`, `work_branch`, or `last_reviewed_pr` for the scheduled controller.

## Required External Files

- `phase-state.json`
- `prompts/<phase-id>.md`
- `latest-review.md`
- `review-memory.md`
- `stop-reason.md`
- `automation.toml`
- `run.lock`

## Repository Contract

Repository control-plane files may describe where the external authority lives, how to identify the current prompt from external state, and which CI guards protect the contract. They may not encode a current scheduled phase, a current PR, an implementation branch, a human-blocked status, or a hard stop rule that contradicts the external controller.

The executable contract is `scripts/guard-control-plane-authority.mjs`. CI runs this guard so stale repo-local state cannot silently regain control of the scheduled loop.

## Safety Boundary

The guard reads bounded repository text and JSON only. It does not read the external automation root, expose secrets, evaluate raw prompts, inspect provider responses, mutate files, run product runtime code, or decide PR mergeability.
