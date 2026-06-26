# Runtime Protocol Specification v0

## Purpose

Brownie VSIX and Brownie Runtime communicate through a stable protocol boundary.

Phase 0.2 uses newline-delimited JSON (NDJSON) JSON-RPC 2.0 messages over stdio as the initial process boundary.

```text
Code-OSS / Brownie VSIX
  -> stdio NDJSON JSON-RPC
Brownie Runtime
```

## Phase 0.2 framing

The runtime reads stdin one line at a time. Each non-empty line is one complete JSON-RPC request. For every request line, the runtime writes exactly one JSON-RPC response line to stdout and flushes stdout before reading the next request.

```text
stdin line 1  -> stdout response line 1
stdin line 2  -> stdout response line 2
stdin line 3  -> stdout response line 3
```

Empty input lines are ignored. Invalid JSON produces a JSON-RPC parse error response with code `-32700` and a `null` id.

For direct smoke testing without a JSON-RPC request, the runtime binary may still emit the bare status object when stdin is attached to a terminal.

## Phase 0.2 request

The first supported request is `runtime.status` over JSON-RPC 2.0.

Request line:

```json
{"jsonrpc":"2.0","id":1,"method":"runtime.status"}
```

Expected response line:

```json
{"jsonrpc":"2.0","id":1,"result":{"name":"brownie-runtime","version":"0.1.0","status":"Ready"}}
```

Field order is not significant.

## Errors

The Phase 0.2 runtime returns JSON-RPC errors for protocol failures that it can report:

- `-32700` for parse errors.
- `-32600` for invalid JSON-RPC versions.
- `-32601` for unknown methods.

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
