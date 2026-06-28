# Tool Intent Parser Hardening Spec v0

## Trust boundary

Provider responses are untrusted input. The runtime must parse `brownie-tool-intent` fenced blocks defensively, validate schema and size limits before policy evaluation, and never treat assistant-provided JSON as authoritative instructions.

## RPC response shape

`tool.intent.parse` returns parser metadata plus evaluated or rejected summaries only:

- `parser`: block/request counts and configured parser limits.
- `items[].input_summary`: typed summary metadata with `has_path` and `field_count`.
- `rejected[]`: rejected request summaries with stable rejection `code` values.

Raw provider responses and raw `brownie-tool-intent` JSON are never returned by `tool.intent.parse`. Raw request `input` JSON is also never returned by `tool.intent.parse`; callers only receive `input_summary`.

## Rejection codes

The parser uses stable rejection codes for malformed or unsafe requests, including:

- `missing_block`
- `too_many_blocks`
- `block_too_large`
- `malformed_json`
- `invalid_schema`
- `too_many_requests`
- `input_too_large`
- `reason_too_long`
- `unknown_tool`
- `invalid_input`

## `workspace.read` path preflight

`workspace.read` requests must include `input.path` as a workspace-relative string. The parser rejects empty paths, absolute paths, path traversal, and protected workspace components before the request can be evaluated or executed. Invalid `workspace.read` paths are rejected with `invalid_input` and are not echoed in RPC responses, ledger inspection, diagnostics, or parser summaries.

## Ledger and inspection

Ledger and inspection views store parser metadata and input summaries only for tool-intent permission events such as `ToolIntentPermissionChecked`, `ToolIntentApproved`, and `ToolIntentDenied`. They must not persist or expose raw provider responses or raw `brownie-tool-intent` JSON. Inspection sanitization must not expose raw execution input.
