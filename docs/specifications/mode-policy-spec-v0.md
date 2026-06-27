# Mode Policy Spec v0

## Phase 1.3 scope

Phase 1.3 introduces the runtime-side foundation for mode policies without implementing the full AgentModes parser or Mode Pack lifecycle.

In scope:

- `CompiledModePolicy` in `brownie-agentmodes`.
- A static built-in stub registry containing `orchestrator`, `implementer`, and `verifier`.
- Resolution of `mode_id` to a compiled policy during `task.start`.
- Ledger recording of compact `ModeResolved` summaries.
- Prompt materialization of the resolved mode policy summary.
- JSON-RPC `mode.list` and `mode.get` methods.

Out of scope:

- AgentModes YAML parsing.
- Mode Pack fetch, validation, activation, or hot updates.
- Tool execution and runtime permission enforcement.
- Real LLM API calls.

## Policy precedence

Runtime permission policy is authoritative and is designed to override any LLM instruction. Phase 1.3 only resolves, stores, and exposes policy summaries; later phases will enforce permissions at runtime boundaries.
