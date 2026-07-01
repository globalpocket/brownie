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

## Phase 3.1 validation and diff preview

Phase 3.1 keeps the Phase 3.0 dry-run contract: `workspace.write` proposals never write workspace files and never apply patches. A proposal is inspected against the current workspace and receives `validation_status` (`Valid`, `Invalid`, or `Blocked`) plus optional `validation_reason`.

For `replace_file`, validation requires a safe workspace-relative path, no protected path components, an existing target file, a regular file target, UTF-8 target content, UTF-8 proposed content, configured content size compliance, and no sensitive-like findings in proposed or existing content. Missing targets are `Invalid` with `target file does not exist`. Sensitive-like proposed content is `Blocked`, stores `content_preview` as `[redacted]`, suppresses diff preview, and records no matched secret values. Sensitive-like existing file content also blocks diff preview.

Valid replacements get a deterministic synthetic unified diff preview generated from existing file text and proposed text. The preview is capped by the runtime diff preview cap; only the capped preview may be stored in the ledger or returned by inspection. `diff_truncated` reports cap truncation and `diff_redacted` reports sensitive-content suppression. Full proposed content and raw full diffs are never persisted.

`WorkspacePatchProposed` payloads include validation and diff-preview metadata: `validation_status`, `validation_reason`, `diff_preview`, `diff_truncated`, and `diff_redacted`. Forbidden fields remain `content`, `raw_content`, `full_content`, `patch`, and `raw_input`.

`proposal.list` returns the extended proposal summary. `proposal.inspect` accepts `{ "run_id": string, "proposal_id": string }` and returns `{ "proposal": WorkspacePatchProposalSummary }`; unknown runs or proposals return `-32602`.

## Phase 3.2 approval gate

Patch proposals have an approval lifecycle reconstructed from the ledger event stream. Summaries include `approval_status`, `approval_reason`, `approved_at`, `rejected_at`, and optional summary-only `latest_apply_plan`. Allowed approval statuses are `Pending`, `Approved`, `Rejected`, and reserved `Superseded`; newly proposed patches start as `Pending`.

`proposal.approve` records human approval for a `Valid` and `Pending` proposal only. It appends `WorkspacePatchApproved` and then creates a summary-only apply plan via `WorkspacePatchApplyPlanCreated`. Approval is not an apply trigger: Phase 3.2 never writes workspace files and never applies patches.

`proposal.reject` records human rejection for a `Pending` proposal and appends `WorkspacePatchRejected`. Rejected proposals cannot later be approved.

Apply plans contain bounded checklist summaries: `proposal_exists`, `proposal_is_valid`, `proposal_is_approved`, `target_path_safe`, `target_file_exists`, `target_file_utf8`, `diff_preview_available`, `sensitive_content_not_detected`, and `apply_not_enabled`. In Phase 3.2, `apply_not_enabled` is always non-passing with reason `Patch apply is not implemented in Phase 3.2.`.

## Phase 3.3 preflight snapshots

`proposal.preflight` accepts `{ "run_id": string, "proposal_id": string }` for an existing `Approved` and `Valid` proposal. It captures target-file metadata only and appends `WorkspacePatchPreflightSnapshotCreated` plus a blocked `WorkspacePatchApplyPlanCreated` event. The method is not an apply trigger: Phase 3.3 does not write workspace files and does not apply patches.

A preflight snapshot includes `proposal_id`, `snapshot_id`, workspace-relative `path`, `canonical_path_hash`, `file_exists`, `file_kind`, `file_size_bytes`, `file_modified_unix_ms`, `file_sha256`, `captured_at`, `stale`, and `stale_reason`. `canonical_path_hash` is a SHA-256 hash of the canonical target path; the canonical absolute path itself is never returned. File contents, full proposed content, raw input JSON, patches, and full diffs are never persisted in snapshots or RPC responses.

Repeated preflight creates a new snapshot each time. The first snapshot is not stale. Later snapshots are stale when `file_sha256`, `file_size_bytes`, or `file_modified_unix_ms` differs from the previous latest snapshot. `proposal.list` and `proposal.inspect` return the latest snapshot in `latest_snapshot`.

Approval and rejection reasons are bounded to 1000 characters. Secret-like reasons are stored and returned as `[redacted]` with `approval_reason_redacted = true`; matched secret values are not stored in the ledger.
