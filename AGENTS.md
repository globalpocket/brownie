# Brownie Agent Instructions

## Project identity

Brownie is a new repository and an independent implementation.

Brownie is not a fork of Zoo Code or ZooCodeCustom. Do not copy source code from those repositories. Treat them as reference sources for observable behavior and selected wrapper functionality only.

Brownie targets Code-OSS as a VSIX extension surface and uses Custom Agent UI. The primary execution engine is a Rust runtime.

## Brownie v0 baseline

Brownie v0 is defined by `docs/specifications/brownie-scope-v0.md`.

Core rules:

1. Keep the VSIX thin. Runtime behavior belongs in Rust.
2. Implement the agent loop as an explicit state machine.
3. Treat AgentModes as an external Mode Pack, not as vendored source.
4. Compile AgentModes into runtime-enforced policies.
5. Runtime permissions override LLM instructions.
6. Apply sliding window truncation to the prompt view, not to the persisted ledger.
7. Separate llama-server wrapper from the generic LLM client.
8. Separate Qdrant wrapper from the codebase indexer.
9. Retrieval must not be vector-only.
10. Do not automatically apply Mode Pack updates to running tasks.

## Current phase authority

Phase 0 is complete. Current implementation authority comes from the external
Brownie phase-loop controller state, `docs/architecture/product-charter.md`, and
`docs/architecture/phase-value-manifest.json`.

The Phase 0 constraints below are historical bootstrap constraints. Do not apply
them as current blockers to accepted M/R phases such as M9 runtime codebase
indexing work.

## Historical Phase 0 constraints

Phase 0 is limited to repository bootstrap:

- Rust workspace skeleton
- VSIX workspace skeleton
- specification and architecture documents
- stdio JSON-RPC boundary design
- minimal `runtime.status` target

Do not implement the full agent loop in Phase 0.
