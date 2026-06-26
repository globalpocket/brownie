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

The first supported request is runtime status.

Expected response shape:

```json
{
  "name": "brownie-runtime",
  "version": "0.1.0",
  "status": "Ready"
}
```

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
