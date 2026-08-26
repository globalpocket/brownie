# Brownie

Brownie is a new Code-OSS extension and Rust runtime for running AgentModes-compatible autonomous agent workflows.

Brownie is not a fork of Zoo Code or ZooCodeCustom. It is an independent implementation that references selected observable behavior and selected wrapper functionality from those projects.

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

Command-specific help is available with:

```sh
brownie help run
brownie help resume
brownie help status
brownie help inspect
brownie help list
brownie help mode
```
