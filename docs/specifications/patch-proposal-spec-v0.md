# Patch Proposal Spec v0

Brownie Phase 3.0 treats `workspace.write` as a dry-run proposal source only.
The runtime must not modify workspace files, apply patches, invoke git, or execute shell commands for a write intent.

## Accepted intent shape

Only `workspace.write` requests with `operation: "replace_file"` are accepted. The input must include a workspace-relative `path` and string `content`.

Rejected paths include empty paths, absolute paths, parent traversal, and protected components: `.git`, `.brownie`, `node_modules`, and `target`.

## Permission gate

Proposal generation is gated by `WriteWorkspace`. If the active runtime policy denies `WriteWorkspace`, the runtime records the normal denied tool-intent event and does not create a proposal.

## Ledger event

Approved write intents append `WorkspacePatchProposed` with metadata only:

```json
{
  "proposal_id": "proposal_...",
  "tool_id": "workspace.write",
  "path": "README.md",
  "operation": "replace_file",
  "content_preview": "bounded preview",
  "content_chars": 123,
  "truncated": false
}
```

The ledger event must not include `content`, `raw_content`, `full_content`, `patch`, `diff`, or `raw_input`.

## Inspection

`proposal.list` returns summaries reconstructed from sanitized ledger events for a run. It returns `-32602` when the run does not exist. Responses contain preview/count/truncation metadata only and never full proposed content.
