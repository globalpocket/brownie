# Brownie Runtime Architecture Overview

## Summary

Brownie uses a thin Code-OSS VSIX and a Rust runtime.

```text
Code-OSS / Brownie VSIX
  -> protocol boundary
Brownie Runtime
  -> Agent Loop
  -> AgentModes compatibility
  -> Context manager
  -> Tools
  -> LLM client
  -> llama-server wrapper
  -> Qdrant wrapper
  -> Indexer
  -> Store
  -> Events
```

## VSIX responsibility

The VSIX owns:

- Code-OSS activation
- command registration
- workspace bridge
- editor bridge
- terminal bridge
- Custom Agent UI adapter surface
- runtime process startup
- event display

The VSIX should not own agent policy.

## Runtime responsibility

The Rust runtime owns:

- task lifecycle
- agent-loop state transitions
- mode policy enforcement
- prompt materialization
- tool routing
- LLM request routing
- wrapper coordination
- indexing coordination
- ledger persistence
- event emission

## Boundary principle

The runtime is the execution authority. The VSIX presents state and connects Code-OSS capabilities.
