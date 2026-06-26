# Runtime Protocol Specification v0

## Purpose

Brownie VSIX and Brownie Runtime communicate through a stable protocol boundary.

Phase 0 uses stdio JSON messages as the initial process boundary.

```text
Code-OSS / Brownie VSIX
  -> stdio protocol
Brownie Runtime
```

## Phase 0 request

The first supported request is `runtime.status` over JSON-RPC 2.0.

Request shape:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "runtime.status"
}
```

Expected response shape:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "name": "brownie-runtime",
    "version": "0.1.0",
    "status": "Ready"
  }
}
```

For direct smoke testing without a JSON-RPC request, the runtime binary may still emit the bare status object when stdin is attached to a terminal.

## Future categories

Later protocol versions should cover:

- runtime lifecycle
- task lifecycle
- mode listing and validation
- Mode Pack operations
- indexing operations
- LLM endpoint status
- Qdrant status
- event streaming

## Rule

The VSIX is a presentation and workspace bridge. Runtime policy and task execution remain in Rust.
