# Brownie Scope v0

## Positioning

Brownie is a new repository and a new implementation.

Brownie is not a fork of Zoo Code or ZooCodeCustom. Zoo Code OSS, ZooCodeCustom, and AgentModes are reference inputs and compatibility targets, not parent repositories.

Brownie is defined as:

```text
A Code-OSS Custom Agent UI extension backed by an AgentModes-compatible Rust Agent Runtime.
```

## Related repositories

- `globalpocket/Zoo-Code-Custom`: reference source for selected custom wrapper behavior and selected agent-loop control behavior.
- `globalpocket/AgentModes`: external Mode Pack and compatibility target.
- Zoo Code OSS: reference source for selected observable behavior.

## Zoo Code OSS derived scope

Brownie reimplements or migrates the following behavior from Zoo Code OSS:

1. Observable agent-loop behavior.
2. Codebase indexing behavior.
3. Sliding window truncation behavior.

This does not imply source-level porting. Brownie should reimplement behavior in Rust according to Brownie's own architecture.

## ZooCodeCustom derived scope

Brownie migrates or reimplements the following from ZooCodeCustom:

1. llama-server wrapper behavior.
2. Qdrant wrapper behavior.
3. Custom control logic that directly affects the agent loop.

ZooCodeCustom UI, WebView implementation, login/account functionality, and unrelated customizations are out of scope.

## AgentModes scope

AgentModes is not vendored into Brownie.

Brownie treats AgentModes as an external Mode Pack:

- fetchable at an explicit time,
- validated before activation,
- compiled into runtime policies,
- locked to an active commit snapshot,
- not automatically applied to already-running tasks.

## In scope for v0

- Code-OSS VSIX skeleton.
- Custom Agent UI adapter surface.
- Rust runtime skeleton.
- Agent loop state-machine design.
- AgentModes compatibility layer.
- Mode Pack management design.
- Context management and sliding window truncation design.
- llama-server wrapper design.
- Qdrant wrapper design.
- Codebase indexing design.
- stdio JSON-RPC boundary between VSIX and runtime.

## Out of scope for v0

- Full Zoo Code UI reproduction.
- Full ZooCodeCustom migration.
- Zoo Code or ZooCodeCustom fork structure.
- Login/account systems.
- Full production agent-loop implementation.
- Production-grade indexer implementation.
- Production-grade llama-server and Qdrant lifecycle management.

## Design principles

1. VSIX is thin; Rust runtime is the execution authority.
2. Agent loop is an explicit state machine.
3. AgentModes is an external Mode Pack.
4. Runtime permissions override LLM output.
5. Sliding window truncation affects prompt materialization, not persisted history.
6. Run history is stored as a structured ledger.
7. llama-server wrapper is separate from the generic LLM client.
8. Qdrant wrapper is separate from the indexer.
9. Retrieval is hybrid, not vector-only.
10. Long-running operations emit observable events.
