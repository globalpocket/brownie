# Brownie

Brownie is a new Code-OSS extension and Rust runtime for running AgentModes-compatible autonomous agent workflows.

Brownie is not a fork of Zoo Code or ZooCodeCustom. It is an independent implementation that references selected observable behavior and selected wrapper functionality from those projects.

Brownie Runtime owns durable execution, AgentModes Mode Pack policy
materialization, permission enforcement, controlled tools, workspace mutation
boundaries, replay/stale/conflict protection, and completion machinery. External
schedulers, workers, tenant operations, hosted monitoring, forge integrations,
notifications, and commercial administration are external control-plane or
adapter responsibilities, not Runtime release blockers. See
`docs/specifications/runtime-boundary-and-release-dod-spec-v0.md`.

## Initial scope

- Code-OSS VSIX using Custom Agent UI
- Rust runtime as the primary execution engine
- AgentModes compatibility through external Mode Packs
- Agent loop state machine
- Context management and sliding window truncation
- Codebase indexing
- llama-server wrapper
- Qdrant wrapper

See `docs/specifications/brownie-scope-v0.md` for the current specification baseline.

## Brownie CLI

The CLI entrypoint is `brownie run "<objective>"`. The command is intentionally
general-purpose; the Rust runtime, active Mode Pack, and runtime permissions own
what the objective may actually do.

Build and install the CLI from this repository into a caller-owned local prefix:

```sh
pnpm install:cli -- --prefix "$HOME/.local"
```

This installs the existing `brownie` binary to `$HOME/.local/bin/brownie`.
Use `--dry-run` to validate the selected prefix and build plan without writing:

```sh
pnpm install:cli -- --prefix "$HOME/.local" --dry-run
```

After installation, verify the binary without the VSIX:

```sh
brownie --version
brownie help run
brownie run "summarize this repository"
```

For an explicitly configured strict OpenAI-compatible local or LAN LLM endpoint,
request the built-in network-capable provider-runner mode before using the same
`brownie run` entrypoint:

```sh
export BROWNIE_CLI_RUN_MODE_ID=provider-runner
export BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK=true
brownie run "Hello"
```

Command-specific help is available with:

```sh
brownie help run
brownie help resume
brownie help status
brownie help inspect
brownie help list
brownie help mode
```
