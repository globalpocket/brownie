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
