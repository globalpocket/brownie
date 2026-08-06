# Runtime Protocol Specification v0

## Purpose

Brownie VSIX and Brownie Runtime communicate through a stable protocol boundary.

The runtime uses newline-delimited JSON (NDJSON) JSON-RPC 2.0 messages over stdio as the initial process boundary.

```text
Code-OSS / Brownie VSIX
  -> stdio NDJSON JSON-RPC
Brownie Runtime
```

## Framing

The runtime reads stdin one line at a time. Each non-empty line is one complete JSON-RPC request. For every request line, the runtime writes exactly one JSON-RPC response line to stdout and flushes stdout before reading the next request.

Empty input lines are ignored. Invalid JSON produces a JSON-RPC parse error response with code `-32700` and a `null` id.

For direct smoke testing without a JSON-RPC request, the runtime binary may still emit the bare status object when stdin is attached to a terminal.

## Workspace root and store path

The runtime resolves its workspace root in this order:

1. `BROWNIE_WORKSPACE_ROOT`
2. current working directory

Task run data is stored under:

```text
.brownie/
└─ runs/
   └─ <run_id>/
      ├─ state.json
      └─ ledger.jsonl
```

`state.json` contains the persisted `TaskRecord`. `ledger.jsonl` contains append-only RunLedger events, one JSON object per line.

Codebase index snapshots are stored separately from task runs:

```text
.brownie/
└─ codebase-index/
   ├─ current.json
   ├─ ledger.jsonl
   └─ snapshots/
      └─ <index_id>.json
```

`current.json` and `snapshots/<index_id>.json` contain metadata-only
`CodebaseIndexSnapshotManifest` documents. `ledger.jsonl` contains
append-only `CodebaseIndexSnapshotBuilt` evidence events without task/run IDs.

## `runtime.status`

Request line:

```json
{"jsonrpc":"2.0","id":1,"method":"runtime.status"}
```

Expected response line:

```json
{"jsonrpc":"2.0","id":1,"result":{"name":"brownie-runtime","version":"0.1.0","status":"Ready"}}
```

## `task.start`

Creates a persisted task record and appends a `TaskStarted` ledger event. Runtime is the authority for task IDs, run IDs, status, and persistence.

Request line:

```json
{"jsonrpc":"2.0","id":1,"method":"task.start","params":{"goal":"Implement something","mode_id":"orchestrator"}}
```

Expected response line:

```json
{"jsonrpc":"2.0","id":1,"result":{"task_id":"task_<uuid>","run_id":"run_<uuid>","status":"Created"}}
```

`goal` must be non-empty after trimming whitespace. Empty goals return `-32602`.

M8.1 extends `task.start` with optional verification recovery admission:

```json
{"jsonrpc":"2.0","id":1,"method":"task.start","params":{"goal":"Recover verifier failure","mode_id":"implementer","verification_recovery_source":{"source_task_id":"task_<uuid>","source_run_id":"run_<uuid>","expected_failure_fingerprint":"sha256:<64 lowercase hex>","authorize_recovery":true}}}
```

The runtime admits this request only when the source task exists, its run ID matches, its status is terminal `Failed`, the source run ledger currently derives a failed `verification_completion_gate`, the terminal task event records failed verifier-gate metadata, `authorize_recovery` is `true`, and the expected fingerprint matches the runtime-derived fingerprint. Missing authorization, stale fingerprint, completed/running/cancelled sources, missing source evidence, and non-verification failures return `-32602` before a recovery task is created.

Successful admission creates or replays exactly one recovery task/run for the source failure fingerprint. The response includes `verification_recovery_admission` with source IDs, recovery IDs, `failure_fingerprint`, `recovery_running_enabled: false`, `next_action: "run_recovery_task_explicitly"`, and `replayed`. Admission does not run the recovery task, invoke an LLM, execute a verifier, mutate the workspace, or enable generic `process.exec`.

M18.1 also allows `headless.continue_once` to perform that same recovery admission after fresh progress validation. The request may include `verification_recovery_source`, optional `verification_recovery_goal`, and optional `verification_recovery_mode_id`; it must not combine recovery admission with `max_steps > 1` or verification retry fields. A valid call creates or replays one `Created` recovery task/run, returns `status:"task_in_progress"`, selected recovery handles, `task_run_result:null`, and `next_route.kind:"run_recovery_task_explicitly"`. Invalid or stale evidence fails before task creation. The response remains bounded and does not expose raw prompts, provider output, raw verifier output, file content, environment values, commands, or raw request bodies.

M18.2 also allows `headless.continue_once` to run a targeted admitted recovery task after fresh progress validation. The request may include `verification_recovery_run_target` with `recovery_task_id`, `recovery_run_id`, `source_task_id`, `source_run_id`, `expected_failure_fingerprint`, and `authorize_recovery_run:true`; it must not combine that target with recovery admission, verification retry fields, or `max_steps > 1`. A valid call revalidates the targeted recovery task provenance, delegates to the existing M8.2 recovery `task.run` path, returns `status:"task_executed"`, selected recovery handles, bounded `task_run_result.verification_recovery_repair`, and `next_route.kind:"review_and_authorize_recovery_proposal"` when the repair gate passes. Invalid authorization, malformed target, stale progress, stale source evidence, mismatched provenance, or terminal recovery task state fails before `TaskRunning`. Replay with the same `continuation_id` returns the same task result without duplicate `TaskRunning`, `WorkspacePatchProposed`, `HeadlessContinuationDecisionRecorded`, or terminal task evidence. The response remains bounded and does not apply proposals, retry verifiers, execute providers, shell, git, network, or services, schedule background work, or expose raw prompts, provider output, raw verifier output, file content, environment values, commands, paths, or raw request bodies.

M8.2/R3.2 extends `task.run` responses for admitted verification recovery tasks with bounded repair proposal gate metadata:

```json
{"verification_recovery_repair":{"gate_status":"Passed","source_task_id":"task_<uuid>","source_run_id":"run_<uuid>","recovery_task_id":"task_<uuid>","recovery_run_id":"run_<uuid>","failure_fingerprint":"sha256:<64 lowercase hex>","failed_verifier_tool_ids":["verification.cargo_fmt_check"],"proposal_id":"proposal_<uuid>","proposal_count":1,"replayed":false,"apply_enabled":false,"next_action":"review_and_authorize_recovery_proposal"}}
```

The runtime returns this field after revalidating the recovery task's stored provenance against the latest source verifier-gate failure. Exactly one valid recovery-scoped `WorkspacePatchProposed` event through the existing `workspace.write` proposal path passes the gate. Missing, ambiguous, invalid-provenance, or not-applicable recovery repair proposals return `gate_status:"Failed"` with bounded `failure_reason` and force terminal `TaskFailed`; a failed repair-gate attempt may be followed by a fresh recovery task for the same failure fingerprint instead of replaying the unusable attempt forever. This is not an apply result and does not mutate files, retry verification, expose raw verifier output, or add a new RPC.

R3.3 adds optional `bounded_cargo_diagnostics` to failed `verification.cargo_check` terminal tool evidence, failed `verification_completion_gate` payloads, and `verification_recovery_provenance`. Each array is capped at five entries:

```json
{"bounded_cargo_diagnostics":[{"tool_id":"verification.cargo_check","check_id":"cargo_check","diagnostic_kind":"compile_error","severity":"error","code":"E0412","workspace_relative_path":"src/lib.rs","line":7,"column":12,"truncated":false}]}
```

M30.1 permits the same capped array for failed `verification.cargo_test` evidence. Cargo-test entries use hashed test identity and optional sanitized panic location:

```json
{"bounded_cargo_diagnostics":[{"tool_id":"verification.cargo_test","check_id":"cargo_test","diagnostic_kind":"panic_location","severity":"error","test_name_hash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","workspace_relative_path":"src/lib.rs","line":7,"column":9,"truncated":false}]}
```

Protocol consumers must reject diagnostic entries containing raw test names, stdout, stderr, rendered messages, source text, command data, environment values, absolute paths, canonical paths, file content, unknown fields, invalid hashes, invalid paths, invalid positive positions, or arrays over five items.

The runtime and VSIX validators must reject raw nested stdout/stderr/rendered messages/source snippets, absolute paths, parent traversal, protected path components, non-positive line or column values, and arrays above the bound. This extends existing results only; it does not add a new RPC, report, digest, history, readiness wrapper, or inspection surface.

## `codebase.index.build`

M9.1 adds the first runtime-owned codebase indexing execution method. M9.2
hardens that method with explicit mode permission, canonical containment,
bounded traversal, no-follow file reads, and locked persistence. M9.2.1 makes
unsupported platforms fail closed when safe no-follow reads are unavailable,
revalidates queued directory containment before reading, uses deterministic
bounded directory selection, and reclaims only safely stale index build locks. The
method builds or refreshes a bounded metadata-only workspace file inventory
snapshot and persists it under `.brownie/codebase-index`.

Request line with default workspace root:

```json
{"jsonrpc":"2.0","id":10,"method":"codebase.index.build","params":{"mode_id":"orchestrator"}}
```

Optional params:

```json
{"mode_id":"orchestrator","root":"crates","force_refresh":true,"max_files":2000,"max_directories":500,"max_path_chars":512,"max_file_bytes":1048576,"max_visited_entries":50000,"max_directory_entries":5000}
```

The runtime rejects missing or unknown `mode_id`, modes without
`IndexCodebase`, unknown fields, absolute roots, parent traversal, protected
root components, non-directory roots, intermediate symlink roots, final symlink
roots, and canonical roots outside the workspace with `-32602`. Unsupported
platforms that cannot provide safe no-follow file reads return a bounded
unsupported-platform error and do not commit a successful snapshot. Caller limits
are clamped to runtime maxima.

Successful response:

```json
{
  "snapshot": {
    "index_id": "idx_<16 lowercase hex>",
    "root": ".",
    "workspace_fingerprint": "sha256:<64 lowercase hex>",
    "snapshot_fingerprint": "sha256:<64 lowercase hex>",
    "built_at": "2026-07-24T00:00:00Z",
    "counts": {
      "indexed_files": 123,
      "walked_directories": 20,
      "skipped_protected": 4,
      "skipped_ignored": 8,
      "skipped_sensitive": 2,
      "skipped_symlink": 0,
      "skipped_too_large": 1,
      "skipped_binary_like": 0,
      "skipped_unreadable": 0,
      "skipped_unsafe_path": 0,
      "skipped_other": 0,
      "truncated_entries": 0,
      "visited_entries": 130,
      "truncated_directories": 0,
      "ignore_rule_files_loaded": 3,
      "ignore_rule_count": 5,
      "sensitive_finding_count": 1
    },
    "limits": {
      "max_files": 10000,
      "max_directories": 2000,
      "max_path_chars": 512,
      "max_file_bytes": 1048576,
      "max_visited_entries": 100000,
      "max_directory_entries": 10000
    },
    "truncated": false
  },
  "persisted": true,
  "ledger_event_id": "event_<uuid>",
  "ledger_event_kind": "CodebaseIndexSnapshotBuilt",
  "next_action": "build_bounded_index_query_file_selection"
}
```

The RPC result is compact; full metadata entries are persisted in the snapshot
manifest. Snapshot entries contain workspace-relative path, file kind,
byte-length, optional line count, and optional content SHA-256. They must not
contain raw file content, snippets, diffs, absolute paths, canonical paths,
raw ignore patterns, sensitive matched values,
prompts, provider responses, stdout/stderr, environment values, commands, or
secrets.

`force_refresh` is requested-only until cache reuse exists. Successful ledger
payloads record `requested_force_refresh`; denied permission decisions use the
bounded `CodebaseIndexPermissionChecked` event and do not create successful
build evidence.

## `codebase.index.query`

M9.4 adds bounded metadata-only consumption of the latest persisted codebase
index. The runtime requires `mode_id`, checks `RuntimeAction::IndexCodebase`,
and only then reads `.brownie/codebase-index/current.json` through the
runtime-owned store abstraction.

Request line:

```json
{"jsonrpc":"2.0","id":11,"method":"codebase.index.query","params":{"mode_id":"orchestrator","query":"runtime rs","max_results":5,"file_kind":"Rust"}}
```

Parameters:

- `mode_id` is required.
- `query` is required, non-empty after whitespace normalization, and capped at
  256 characters.
- `max_results` defaults to 10 and is capped at 50.
- `file_kind` is optional and must be one of the snapshot file-kind names.

The runtime rejects missing or unknown modes, modes without `IndexCodebase`,
unknown fields, empty or unsearchable queries, unbounded `max_results`, and
unsupported file kinds with `-32602`. Missing current snapshots return a bounded
missing-snapshot error. Malformed or unreadable current snapshots return a
bounded malformed-snapshot error. These failure paths do not append
`CodebaseIndexQueryCompleted`.

Successful response:

```json
{
  "query_id": "query_<16 lowercase hex>",
  "selection_id": "selection_<16 lowercase hex>",
  "query_fingerprint": "sha256:<64 lowercase hex>",
  "snapshot": {
    "index_id": "idx_<16 lowercase hex>",
    "root": ".",
    "workspace_fingerprint": "sha256:<64 lowercase hex>",
    "snapshot_fingerprint": "sha256:<64 lowercase hex>",
    "built_at": "2026-07-24T00:00:00Z",
    "truncated": false
  },
  "matched_entry_count": 2,
  "returned_entry_count": 2,
  "max_results": 5,
  "entries": [
    {
      "path": "src/runtime/query.rs",
      "file_kind": "Rust",
      "byte_length": 120,
      "line_count": 8,
      "content_sha256": "sha256:<64 lowercase hex>",
      "score": 175,
      "match_reasons": ["path_token", "extension"]
    }
  ],
  "ledger_event_id": "event_<uuid>",
  "ledger_event_kind": "CodebaseIndexQueryCompleted",
  "next_action": "read_selected_files_with_controlled_workspace_read"
}
```

The result is a file-selection handle, not a file read. It must not contain raw
file content, snippets, diffs, chunks, embeddings, absolute paths, canonical
paths, raw query text, prompts, provider responses, stdout/stderr, environment
values, commands, or secrets. Successful ledger payloads are even narrower:
they store query/selection ids and fingerprints, snapshot fingerprints, bounded
counts, match-reason counts, optional file-kind filter, and `next_action`; they
do not store raw query text or selected paths.

## `tool.execute` with `codebase.index.selection.read`

M9.5 turns a bounded M9.4 file-selection handle into one controlled workspace
read without adding a new JSON-RPC method. Callers use the existing
`tool.execute` method with `tool_id = "codebase.index.selection.read"`.

Example request:

```json
{
  "jsonrpc": "2.0",
  "id": 12,
  "method": "tool.execute",
  "params": {
    "mode_id": "orchestrator",
    "tool_id": "codebase.index.selection.read",
    "input": {
      "query_id": "query_<16 lowercase hex>",
      "selection_id": "selection_<16 lowercase hex>",
      "query_fingerprint": "sha256:<64 lowercase hex>",
      "snapshot": {
        "index_id": "idx_<16 lowercase hex>",
        "root": ".",
        "workspace_fingerprint": "sha256:<64 lowercase hex>",
        "snapshot_fingerprint": "sha256:<64 lowercase hex>",
        "built_at": "2026-07-24T00:00:00Z",
        "truncated": false
      },
      "max_results": 5,
      "file_kind_filter": "Rust",
      "entries": [
        {
          "path": "src/runtime/query.rs",
          "file_kind": "Rust",
          "byte_length": 120,
          "line_count": 8,
          "content_sha256": "sha256:<64 lowercase hex>",
          "score": 175,
          "match_reasons": ["path_token", "extension"]
        }
      ],
      "read_path": "src/runtime/query.rs"
    }
  }
}
```

The built-in tool registry requires `ReadWorkspace`; after that primary tool
permission passes, the runtime checks `RuntimeAction::IndexCodebase` before it
reads `.brownie/codebase-index/current.json`, query ledger evidence, or file
content. Denied secondary index permission returns a `Denied` tool result and
does not read current snapshot or file content.

Successful output:

```json
{
  "tool_id": "codebase.index.selection.read",
  "status": "Completed",
  "output": {
    "query_id": "query_<16 lowercase hex>",
    "selection_id": "selection_<16 lowercase hex>",
    "query_fingerprint": "sha256:<64 lowercase hex>",
    "selection_fingerprint": "sha256:<64 lowercase hex>",
    "snapshot": {
      "index_id": "idx_<16 lowercase hex>",
      "root": ".",
      "workspace_fingerprint": "sha256:<64 lowercase hex>",
      "snapshot_fingerprint": "sha256:<64 lowercase hex>",
      "built_at": "2026-07-24T00:00:00Z",
      "truncated": false
    },
    "path": "src/runtime/query.rs",
    "file_kind": "Rust",
    "content": "...bounded UTF-8 file content...",
    "truncated": false,
    "bytes_read": 120,
    "content_sha256": "sha256:<64 lowercase hex>",
    "content_hash_verified": true,
    "ledger_event_id": "event_<uuid>",
    "ledger_event_kind": "CodebaseIndexSelectionReadCompleted",
    "next_action": "use_selected_file_context_for_prompt_materialization"
  }
}
```

Failures return `status = "Failed"` with a bounded reason and do not append
`CodebaseIndexSelectionReadCompleted`. Failure conditions include malformed
input, unknown fields, unsafe/protected paths, parent traversal, absolute paths,
unsupported file kinds, missing content hashes, stale current snapshots, missing
`CodebaseIndexQueryCompleted` evidence, selected entry metadata mismatch,
directories, symlinks, invalid UTF-8, truncation, and post-read SHA-256
mismatch.

The explicit tool result may return bounded UTF-8 content. The codebase-index
ledger event remains summary-only and stores path fingerprints rather than raw
selected paths; it never stores raw query text, raw file content, snippets,
diffs, chunks, embeddings, stdout/stderr, environment values, commands, prompts,
provider responses, absolute paths, canonical paths, or secrets.

## `task.run` with selected index context

M9.6 extends the existing `task.run` request with one optional
`selected_index_context` field. The field uses the successful
`CodebaseIndexSelectionReadResult` shape from
`tool.execute(codebase.index.selection.read)`.

```json
{
  "jsonrpc": "2.0",
  "id": 13,
  "method": "task.run",
  "params": {
    "task_id": "task_<uuid>",
    "selected_index_context": {
      "query_id": "query_<16 lowercase hex>",
      "selection_id": "selection_<16 lowercase hex>",
      "query_fingerprint": "sha256:<64 lowercase hex>",
      "selection_fingerprint": "sha256:<64 lowercase hex>",
      "snapshot": {
        "index_id": "idx_<16 lowercase hex>",
        "root": ".",
        "workspace_fingerprint": "sha256:<64 lowercase hex>",
        "snapshot_fingerprint": "sha256:<64 lowercase hex>",
        "built_at": "2026-07-24T00:00:00Z",
        "truncated": false
      },
      "path": "src/runtime/query.rs",
      "file_kind": "Rust",
      "content": "...bounded UTF-8 file content...",
      "truncated": false,
      "bytes_read": 120,
      "content_sha256": "sha256:<64 lowercase hex>",
      "content_hash_verified": true,
      "ledger_event_id": "event_<uuid>",
      "ledger_event_kind": "CodebaseIndexSelectionReadCompleted",
      "next_action": "use_selected_file_context_for_prompt_materialization"
    }
  }
}
```

Validation happens before `TaskRunning`, `AgentLoopStarted`, `PromptBuilt`, or
`CodebaseIndexPromptContextMaterialized` can be appended. The runtime requires a
matching `CodebaseIndexSelectionReadCompleted` codebase-index ledger event and
checks ids, fingerprints, snapshot identity, snapshot truncation, read-path
fingerprint, file kind, byte count, truncation state, content SHA-256,
`content_hash_verified`, source event kind, and `next_action`. The stored task
mode must allow both `ReadWorkspace` and `IndexCodebase`.

Successful materialization appends a task ledger event
`CodebaseIndexPromptContextMaterialized` with summary-only payload. The raw
selected content is used only inside the in-memory `Selected Index Context`
prompt section. `PromptBuilt` and `SecondPassPromptBuilt` redact prompt previews
when selected context is present.

Successful `task.run` responses may include:

```json
{
  "selected_index_prompt_context": {
    "prompt_context_id": "ctx_<16 lowercase hex>",
    "source_event_id": "event_<uuid>",
    "source_event_kind": "CodebaseIndexSelectionReadCompleted",
    "query_id": "query_<16 lowercase hex>",
    "selection_id": "selection_<16 lowercase hex>",
    "query_fingerprint": "sha256:<64 lowercase hex>",
    "selection_fingerprint": "sha256:<64 lowercase hex>",
    "index_id": "idx_<16 lowercase hex>",
    "workspace_fingerprint": "sha256:<64 lowercase hex>",
    "snapshot_fingerprint": "sha256:<64 lowercase hex>",
    "read_path_fingerprint": "sha256:<64 lowercase hex>",
    "file_kind": "Rust",
    "bytes_read": 120,
    "content_char_count": 120,
    "content_sha256": "sha256:<64 lowercase hex>",
    "prompt_preview_redacted": true,
    "next_action": "continue_task_execution_with_materialized_context"
  }
}
```

The task ledger event and result summary never include raw selected paths, raw
file content, snippets, diffs, chunks, embeddings, stdout/stderr, environment
values, commands, prompts, provider responses, absolute paths, canonical paths,
or secrets.

## `task.run` with verification recovery context read

M31.1 extends the existing `task.run` request with one optional
`verification_recovery_context_read` field for current verification recovery
tasks only. It is not a generic workspace read endpoint.

```json
{
  "jsonrpc": "2.0",
  "id": 31,
  "method": "task.run",
  "params": {
    "task_id": "task_<uuid>",
    "verification_recovery_context_read": {
      "authorize": true,
      "source_task_id": "task_<uuid>",
      "source_run_id": "run_<uuid>",
      "expected_failure_fingerprint": "sha256:<64 lowercase hex>",
      "diagnostic_index": 0,
      "max_excerpt_bytes": 1024
    }
  }
}
```

Validation happens before file content is read. The runtime requires matching
current `VerificationRecoveryProvenance`, revalidates the latest failed source
verifier gate, checks `ReadWorkspace`, selects one bounded diagnostic by index,
sanitizes the workspace-relative path, rejects protected paths, parent
traversal, symlinks, directories, missing files, non-regular files, non-UTF-8
content, and excerpt budgets outside `128..=8192` bytes, then reads at most one
existing regular UTF-8 workspace file.

The excerpt is inserted only into the in-memory recovery prompt. Successful
task-run responses may include bounded metadata:

```json
{
  "verification_recovery_context_read": {
    "context_read_id": "ctx_<64 lowercase hex>",
    "source_task_id": "task_<uuid>",
    "source_run_id": "run_<uuid>",
    "recovery_task_id": "task_<uuid>",
    "recovery_run_id": "run_<uuid>",
    "failure_fingerprint": "sha256:<64 lowercase hex>",
    "diagnostic_index": 0,
    "tool_id": "verification.cargo_test",
    "check_id": "cargo_test",
    "diagnostic_kind": "test_failure",
    "severity": "error",
    "test_name_hash": "sha256:<64 lowercase hex>",
    "read_path_fingerprint": "sha256:<64 lowercase hex>",
    "line": 12,
    "column": 3,
    "excerpt_start_line": 10,
    "excerpt_end_line": 14,
    "excerpt_bytes": 220,
    "excerpt_sha256": "sha256:<64 lowercase hex>",
    "excerpt_truncated": true,
    "prompt_preview_redacted": true,
    "replayed": false,
    "next_action": "run_recovery_task_with_context"
  }
}
```

The ledger event `VerificationRecoveryContextReadMaterialized` and the RPC
summary never include raw excerpts, raw file content, raw prompts, rendered
diagnostics, stdout/stderr, command strings, environment values, absolute
paths, canonical paths, or secrets. Replay of a terminal recovery run
reconstructs the same bounded summary from ledger metadata without rereading
the file or appending duplicate context-read evidence.

## `task.get`

Returns a persisted task by `task_id`.

Request line:

```json
{"jsonrpc":"2.0","id":2,"method":"task.get","params":{"task_id":"task_<uuid>"}}
```

Expected response result shape:

```json
{
  "task_id": "task_<uuid>",
  "run_id": "run_<uuid>",
  "goal": "Implement something",
  "mode_id": "orchestrator",
  "status": "Created | Running | Completed | Failed | Cancelled",
  "created_at": "2026-06-26T00:00:00Z",
  "updated_at": "2026-06-26T00:00:00Z"
}
```

Missing tasks return `-32602` in Phase 1.0.

## `task.run`

Runs a `Created` task through the Phase 1.1 no-op AgentLoop skeleton. The runtime is authoritative for transitions and persists `Running` and `Completed` state changes before returning.

Request line:

```json
{"jsonrpc":"2.0","id":2,"method":"task.run","params":{"task_id":"task_<uuid>"}}
```

Expected response line:

```json
{"jsonrpc":"2.0","id":2,"result":{"task_id":"task_<uuid>","run_id":"run_<uuid>","status":"Completed","agent_loop":{"final_state":"Completed","completion_summary":"LLM agent loop completed for task_<uuid>"}}}
```

Unknown tasks and tasks whose status is not `Created` return `-32602`. Phase 1.1 does not call an LLM, execute tools, parse AgentModes, use Qdrant, use llama-server, or run an indexer.

## `task.list`

Returns all persisted tasks discovered in `.brownie/runs/*/state.json` plus a
runtime-owned aggregate progress overview for that bounded task set.

Request line:

```json
{"jsonrpc":"2.0","id":3,"method":"task.list"}
```

Expected response result shape:

```json
{"tasks":[{"task_id":"task_<uuid>","run_id":"run_<uuid>","goal":"Implement something","mode_id":"orchestrator","status":"Created","created_at":"2026-06-26T00:00:00Z","updated_at":"2026-06-26T00:00:00Z"}],"progress_overview":{"source_fingerprint":"sha256:<64 hex chars>","aggregate_sequence":20260626000000,"task_count":1,"root_task_ids":["task_<uuid>"],"runnable_task_ids":["task_<uuid>"],"blocked_task_ids":[],"terminal_task_ids":[],"parent_join_ready_task_ids":[],"status_counts":{"created":1,"queued":0,"running":0,"completed":0,"failed":0,"cancelled":0},"stage_counts":[{"current_stage":"created","task_count":1}],"next_action_sets":[{"next_action":"run_task_explicitly","task_count":1,"task_ids":["task_<uuid>"]}],"blocked_sets":[],"nodes":[{"task_id":"task_<uuid>","run_id":"run_<uuid>","status":"Created","lifecycle_phase":"created","current_stage":"created","next_action":"run_task_explicitly","parent_task_id":null,"parent_run_id":null,"child_task_count":0,"created_at":"2026-06-26T00:00:00Z","updated_at":"2026-06-26T00:00:00Z"}],"edges":[]}}
```

The `progress_overview` is derived by Rust from persisted `TaskRecord` state,
controlled child provenance, and parent/child terminal outcome plus consumption
evidence only for completed parent-join candidates. It exposes only task IDs, run
IDs, bounded status/stage/action enums, aggregate counts, parent/child edges, a
numeric aggregate sequence, and a replay-safe source fingerprint. It does not
compute arbitrary percentages, call `run.inspect` for every task, scan every task
ledger, execute tasks, infer policy inside the VSIX, or mix live progress
observation with aggregate persisted progress. Completed parents with all
controlled children in terminal states, valid child terminal outcome evidence,
and no consumed parent-join continuation fingerprint for the current child
result fingerprint are reported in `parent_join_ready_task_ids` with
`run_parent_task_explicitly`; completed parents with runnable pending children
are reported with `run_remaining_child_tasks_explicitly`, completed parents with
non-runnable children are reported with `inspect_non_runnable_child_tasks`, and
consumed join-candidate parents are not reported as join-ready.

## Errors

The runtime returns JSON-RPC errors for protocol failures that it can report:

- `-32700` for parse errors.
- `-32600` for invalid requests, including invalid JSON-RPC versions.
- `-32601` for unknown methods.
- `-32602` for invalid params, including empty task goals and missing task IDs.
- `-32603` for internal errors.

## Rule

The VSIX is a presentation and workspace bridge. Runtime policy and task execution remain in Rust.

## Phase 1.2 `task.run` behavior

In Phase 1.2, the `task.run` JSON-RPC request and response shape are unchanged, but the runtime now connects the task to prompt materialization and a deterministic local fake LLM adapter.

For a `Created` task, the runtime performs this ordered lifecycle:

```text
TaskStarted
TaskRunning
PromptBuilt
LlmRequestCreated
LlmResponseReceived
TaskCompleted
```

The response still reports `Completed` on success. The additional ledger events contain metadata only, such as message counts, fake model name, and short previews. Full prompt text is not persisted by default.

The fake LLM adapter is deterministic and local-only. Phase 1.2 performs no real LLM network calls and does not introduce tool execution, AgentModes parsing, Mode Pack fetch or activation, Qdrant, llama-server, or indexing behavior.

## M1 agent-loop runtime summary

M1 makes the existing Rust-owned agent-loop execution visible on the task runtime path without adding a new RPC. During `task.run`, the runtime records `AgentLoopStarted` and `AgentLoopCompleted` ledger events around the agent-loop call. Successful responses include an `agent_loop` summary with `final_state` and `completion_summary`, allowing VSIX and headless callers to confirm that the runtime path exercised the agent loop rather than only observing task status.

## Phase 1.3 mode protocol methods

Phase 1.3 adds `mode.list` and `mode.get` JSON-RPC methods backed by the built-in stub mode registry. These methods do not fetch or parse external AgentModes repositories.

`mode.list` returns `{ "modes": ModeSummary[] }`, where each summary includes `mode_id`, `display_name`, `role_definition`, and permission booleans. `mode.get` accepts `{ "mode_id": string }` and returns one `ModeSummary`.

Unknown mode IDs passed to `mode.get` return JSON-RPC `-32602 invalid params`. `task.start` applies the same unknown-mode rejection, while omitted or `null` `mode_id` defaults to `orchestrator`.

## M2 local Mode Pack runtime behavior

M2 extends the existing mode RPCs without adding a new endpoint. When `.brownie/modepack.json` exists under the workspace root, `mode.list`, `mode.get`, `permission.check`, and explicit `task.start` mode resolution include local Mode Pack modes after validating the file through the Rust `brownie-modepack` crate.

Invalid Mode Pack files fail these mode-resolution paths with an internal runtime error rather than silently falling back. Local Mode Pack modes must not duplicate existing mode IDs and must remain read-only without workspace write, process execution, network access, service control, or destructive permissions.

`task.start` records the resolved policy snapshot in the run ledger. `task.run` uses that ledger snapshot so already-started tasks are not affected by later edits to `.brownie/modepack.json`.

## Phase 1.4 permission gate update

Phase 1.4 adds the `RuntimePermissionGate` foundation. Runtime permission checks are based on compiled mode policy capabilities and override LLM instructions.

Runtime actions are `ReadWorkspace`, `WriteWorkspace`, `ExecuteProcess`, `AccessNetwork`, `ControlService`, `DestructiveOperation`, `SpawnSubtask`, and `IndexCodebase`. Phase 1.4 records permission decisions only; it does not execute real tools, write files, apply patches, execute processes, call real LLM APIs, parse AgentModes YAML, fetch Mode Packs, or implement Qdrant/llama-server/indexer behavior.

The runtime protocol includes `permission.check`. Task runs append `PermissionChecked` ledger events for minimum checks and append `PermissionDenied` when a checked action is denied. `ModeResolved` stores a full permission snapshot so prompt materialization can summarize active mode capabilities.

## Phase 1.5 tool planning update

Phase 1.5 adds dry-run tool planning before future tool execution. Tool definitions and plans are declarative only and do not perform file reads, file writes, process execution, subtask spawning, network access, service control, or destructive operations. Planned tools are evaluated through `RuntimePermissionGate`; denied dry-run items are recorded but do not fail `task.run` in Phase 1.5. See `docs/specifications/tool-planning-spec-v0.md`.

## Phase 1.6 assistant tool intent dry-run

Phase 1.6 adds assistant tool intent parsing from fenced `brownie-tool-intent` JSON blocks. The runtime validates all requested tool IDs against `BuiltinToolRegistry` and evaluates valid requests with `RuntimePermissionGate`. Denied or rejected assistant tool intent is recorded for inspection, but no tool is executed and `task.run` remains allowed to complete in this phase.

## Phase 1.7 read-only tool execution note

Phase 1.7 adds standalone `tool.execute` for permission-gated `workspace.read` execution only. All writes, process execution, subtasks, network access, service control, and destructive operations remain non-executable. `task.run` does not automatically execute tools in Phase 1.7. See `docs/specifications/tool-execution-spec-v0.md` for workspace boundary, protected path, truncation, UTF-8, and ledger behavior.

## Phase 1.8 task-scoped read-only execution

Phase 1.8 introduces task-scoped execution for approved assistant `workspace.read` tool intents only. Assistant tool intent requests may include an `input` object; omitted input is treated as `{}`, and non-object input is rejected before permission evaluation.

During `task.run`, denied intents, rejected intents, and non-read tool intents are not executed. Even if another tool intent is permission-approved for planning or policy purposes, Phase 1.8 does not execute write, process, subtask, network, service, or destructive operations.

For approved `workspace.read` intents with explicit `input.path`, the runtime records `ToolExecutionRequested`, `ToolExecutionPermissionChecked`, and one terminal `ToolExecutionCompleted`, `ToolExecutionDenied`, or `ToolExecutionFailed` ledger event. The ledger stores execution metadata and a bounded output preview only; full file content is not persisted to the ledger. `task.run` remains `Completed` even if this read-only execution fails in Phase 1.8.

## Phase 1.9 tool feedback loop

Phase 1.9 introduces a second-pass Fake LLM feedback loop inside `task.run` after an approved `workspace.read` execution completes. The runtime re-reads the task ledger, materializes the tool execution summary into the next prompt, builds a second-pass prompt, and records `SecondPassPromptBuilt`, `SecondPassLlmRequestCreated`, and `SecondPassLlmResponseReceived` ledger events.

The second pass runs only when at least one `ToolExecutionCompleted` event exists. `workspace.read` results are summarized into prompt materialization as metadata such as status, `bytes_read`, and `truncated`; full file content is not persisted in the ledger. Phase 1.9 does not add write, process, network, service-control, destructive, or subtask execution, and it continues to use only the in-process Fake LLM.

## M4 bounded task context window

M4 strengthens the existing `task.run` prompt materialization path without adding a new endpoint. The runtime-owned `ContextMaterializer` now assembles a deterministic bounded ledger context window for prompts. The prompt `Ledger` section includes only the latest 12 ledger event kinds, while a `Context Window` section records `total_events`, `included_events`, `omitted_events`, `max_events`, `first_included_event`, and `last_included_event`.

`PromptBuilt` and `SecondPassPromptBuilt` ledger payloads persist the same summary-only context evidence as `context_total_events`, `context_included_events`, `context_omitted_events`, `context_max_events`, `context_window_bounded`, `context_first_included_event`, and `context_last_included_event`. These fields let callers and future agent-loop stages reason about bounded context reuse without exposing raw prompt text when sensitive guards redact previews.

M4 does not add patch apply, direct workspace mutation, unrestricted process execution, network fetch, service-control, destructive actions, or new diagnostics wrapper RPCs. It only changes how existing task/run context is selected, summarized, and recorded.

## M11.1 headless continue-once

`headless.continue_once` is a bounded runtime-owned continuation method for
headless callers. Params include `authorize=true`,
`expected_progress_fingerprint`, `expected_aggregate_sequence`, and an optional
bounded `continuation_id`. The runtime recomputes `task.list.progress_overview`
from persisted task state, rejects stale fingerprint or sequence mismatches with
bounded `stale_progress` metadata, and appends no task ledger event on stale or
missing authorization paths.

When the expected aggregate state is current, the runtime selects one stable
candidate from progress overview nodes whose task status is `Created` or
controlled `Queued` and whose next action is `run_task_explicitly`. It records a
bounded `HeadlessContinuationDecisionRecorded` event on the selected task before
delegating to the existing `task.run` admission and execution path. The response
reports the selected task/run IDs, decision ID, candidate count, expected and
current aggregate progress handles, optional post-run aggregate handles, stale
and replay flags, and the bounded `task_run_result` when execution starts.

The method executes at most one task, selects no fallback candidate, and does not
run parent-join-ready completed parents, recovery retries, proposal apply,
verifier expansion, shell/git/network/service actions, a scheduler, an async
executor, or a live progress observer. VSIX code validates the protocol shape but
does not infer task-selection policy. Result and decision evidence must not store
or return raw prompts, provider responses, file contents, ledger payloads,
stdout/stderr, commands, environment values, raw request bodies, absolute paths,
canonical paths, secrets, or arbitrary percentages.

M11.2 adds replay and route metadata to this same method. If `continuation_id`
matches prior bounded decision evidence, the runtime returns `replayed=true`
with the same selected task/run handles and does not append duplicate
`HeadlessContinuationDecisionRecorded` or `TaskRunning` events. Replayed running
tasks return `status = task_in_progress` with no `task_run_result`; replayed
terminal tasks return a bounded reconstructed `task_run_result` when available.
Responses may include `next_route`, a bounded object with `kind`, `reason`,
optional task/run/proposal/apply/fingerprint handles, and `next_action`. Route
kinds are limited to `inspect_progress_overview`,
`start_verification_recovery_explicitly`,
`review_and_authorize_recovery_proposal`,
`apply_approved_recovery_proposal_explicitly`,
`start_verification_retry_explicitly`,
`run_verification_retry_task_explicitly`, `run_parent_task_explicitly`,
`no_eligible_task`, and `refresh_progress_overview`.

M11.3 adds optional bounded continuation-budget fields to the same method.
Params may include `max_steps`; it must be 1, 2, or 3. Budgets greater than 1
require `continuation_id`, and the runtime derives per-step ids by appending
`.step.N`. A budget response sets `max_steps`, `step_count`, `executed_count`,
`replayed_count`, `stop_reason`, and `steps`. Each step reports only bounded
status, decision id, continuation id, selected task/run handles, candidate
count, current/post aggregate progress handles, replay flag, next route, and
next action. The method stops at stale progress, no eligible task,
`task_in_progress`, route boundaries for recovery/proposal/apply/verifier retry
or parent join, missing post-run progress, or budget exhaustion. It does not add
another RPC, a report surface, scheduler, background loop, or automatic
execution beyond explicit task continuation.

M16.1 adds optional post-apply verification retry admission fields to the same
method: `verification_recovery_retry_source`, optional
`verification_recovery_retry_goal`, and optional
`verification_recovery_retry_mode_id`. The source shape is the existing
`VerificationRecoveryRetrySource` and requires
`authorize_verification_retry = true`, source/recovery/proposal/apply handles,
the expected failed-verifier fingerprint, and the expected successful apply
fingerprint. These fields cannot be combined with `max_steps > 1`.

When the expected aggregate progress fingerprint and sequence are current, the
runtime reuses the existing M8.3 retry admission validator. A valid request
creates or replays one `Created` verification recovery retry task, records
bounded headless decision evidence when a new task is admitted, and returns
`status = task_in_progress`, selected retry task/run handles, no
`task_run_result`, and `next_route.kind =
run_verification_retry_task_explicitly`. Missing authorization, stale progress,
stale source failure evidence, stale apply evidence, or malformed source fields
fail before retry task creation. M16.1 does not run `proposal.apply`, mutate the
workspace, run verifier tools, append `TaskRunning` for the retry task, call
providers, run shell/git/network/service actions, or expose raw prompts,
provider responses, file content, diffs, commands, stdout/stderr, environment
values, secrets, absolute paths, or canonical paths.

M16.2 adds optional targeted retry-run fields to the same method:
`verification_recovery_retry_run_target`. The target includes retry task/run
handles, proposal/apply handles, expected failed-verifier fingerprint, expected
successful apply fingerprint, and `authorize_verification_retry_run = true`.
These fields cannot be combined with `max_steps > 1` or
`verification_recovery_retry_source`.

When the expected aggregate progress fingerprint and sequence are current, the
runtime requires the targeted retry task/run to exist in `Created` or `Queued`
state and to carry matching `verification_recovery_retry_provenance`. A valid
request delegates to the existing retry `task.run` execution path, records a
bounded headless decision after successful admission, and returns `status =
task_executed`, selected retry task/run handles, bounded
`verification_recovery_retry` outcome metadata, and a next route derived from
the retry result. Replaying the same `continuation_id` returns the same terminal
retry outcome without duplicate `HeadlessContinuationDecisionRecorded`,
`TaskRunning`, verifier request, or terminal tool evidence. Stale progress,
missing authorization, wrong task/run handles, non-runnable status, missing
retry provenance, stale proposal/apply handles, stale fingerprints, or malformed
target fields fail before `TaskRunning`. M16.2 does not create another retry
task, run `proposal.apply`, mutate the workspace, call providers, run
shell/git/network/service actions beyond controlled verifier execution, start
recovery automatically, schedule a loop, or expose raw prompts, provider
responses, file content, diffs, commands, stdout/stderr, environment values,
secrets, absolute paths, or canonical paths.

## Phase 1.10 run inspection methods

The runtime exposes read-only `run.events`, `run.inspect`, and `task.inspect` JSON-RPC methods. They return sanitized ledger previews and run summaries only; full file content and raw tool output are not returned through inspection responses. Unknown run or task IDs return `-32602 invalid params`.


## Phase 2.0 LLM provider boundary

Phase 2.0 routes LLM calls through a provider abstraction. The Fake provider remains the default and no external LLM API is contacted unless `BROWNIE_LLM_PROVIDER=openai-compatible` and the required OpenAI-compatible environment configuration are present. The `llm.status` JSON-RPC method reports provider, enabled state, model, base URL, and a non-secret reason; it never returns API keys or Authorization headers. Task ledger LLM request events store only provider/model/message_count metadata, and response events store only provider/content_preview. Streaming and additional tool execution capabilities remain out of scope. See `docs/specifications/llm-provider-spec-v0.md`.

## Phase 2.1 LLM status and failure events

`llm.status` returns `provider`, `enabled`, `model`, `base_url`, `reason`, `strict`, and `will_fallback_to_fake`. `will_fallback_to_fake` is true only when OpenAI-compatible was requested, required configuration is missing, and `BROWNIE_LLM_STRICT` is not true. No API key or Authorization/Bearer value is returned.

Ledger event kinds include `LlmRequestFailed` and `SecondPassLlmRequestFailed`. When a configured provider call fails during `task.run`, the runtime records the redacted failure event, records `TaskFailed`, marks the task Failed, and returns JSON-RPC `-32603`. Disabled OpenAI-compatible with `strict=false` falls back to Fake and does not emit a failure event. Phase 2.1 does not add streaming or any new workspace.write, process.exec, network tool, service-control, destructive, or subtask-spawn execution capability.

## Phase 2.2 `runtime.config.get`

`runtime.config.get` returns a sanitized view of the active runtime configuration with `config_source`, optional `config_path`, optional `active_profile`, and the same `llm_status` shape returned by `llm.status`. `LlmStatusResult` includes `config_source` and `active_profile`. Secrets such as direct API keys, Authorization headers, and bearer tokens are never returned.

## Phase 2.3 OpenAI-compatible smoke and redaction clarification

Phase 2.3 requires deterministic mock-server coverage for config-profile opt-in to the OpenAI-compatible provider. The mock path validates `POST /v1/chat/completions`, the `model` field, system/user messages, presence of an `Authorization` header without logging its value, successful response parsing, and strict failures for non-2xx, malformed JSON, and missing choices.

CI must not require a live local or external LLM endpoint. Optional live local endpoint smoke steps are documented in `docs/specifications/openai-compatible-smoke-spec-v0.md`.

Run inspection/event metadata may include provider, model, redacted base URL, and strict mode. It must not include API key values, `Authorization`, or `Bearer` token values.

Unknown `BROWNIE_LLM_PROVIDER` values must not silently become Fake. Status reports `provider=Unknown`, `enabled=false`, and a safe explanatory reason; strict task runs fail.

## Phase 2.4 `runtime.diagnostics.get`

`runtime.diagnostics.get` returns `config_source`, optional `active_profile`, sanitized `llm_status`, and diagnostics with `severity`, `code`, `message`, and optional `subject`. The method is read-only and does not contact external LLM endpoints. It prefers structured diagnostics over JSON-RPC errors when config parsing or validation fails.

## Phase 2.5 LLM health

Phase 2.5 adds the explicit `llm.health` JSON-RPC method, specified in `docs/specifications/llm-health-spec-v0.md`. `runtime.diagnostics.get` remains read-only and no-network. Endpoint readiness checks are only performed by `llm.health` when `allow_network=true`; Fake health remains no-network. OpenAI-compatible health uses `GET {base_url}/models`, does not persist response bodies, does not write run ledgers, and redacts API keys, Authorization/Bearer values, and query-string secrets.

## Phase 2.6 real-provider task.run guard

`BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK=true` is required before strict enabled OpenAI-compatible `task.run` may make network LLM calls. The default is false. `llm.status` and `runtime.config.get` expose `task_run_network_allowed`; `runtime.diagnostics.get` reports `TASK_RUN_NETWORK_ALLOWED` or `TASK_RUN_NETWORK_NOT_ALLOWED` for strict enabled OpenAI-compatible profiles. Missing guard is a warning in diagnostics and a pre-network `task.run` error. Non-strict OpenAI-compatible `task.run` falls back to Fake. See `docs/specifications/real-provider-task-run-smoke-spec-v0.md`.

## Phase 2.7 LLM request budget note

See [LLM Request Budget Spec v0](llm-request-budget-spec-v0.md). Runtime provider requests are bounded by the resolved budget, status/config responses include the budget summary, diagnostics report default/profile/env/invalid budget sources, and ledger/inspection payloads keep prompt and response previews only.

## Phase 2.8 prompt sensitive guard

Runtime LLM configuration includes `sensitive_guard` (`off`, `warn`, `fail`) with `BROWNIE_LLM_SENSITIVE_GUARD` as the highest-priority override. Fake defaults to `warn`; OpenAI-compatible defaults to `fail`. Provider calls are preceded by budget validation and prompt sensitive-content scanning. In fail mode, findings block the provider call and task failure metadata records only categories, counts, message indexes, and guard mode. Matched secret text, full prompt text, and full provider responses must not be persisted or exposed through status, diagnostics, ledger, or inspection APIs.

## `tool.intent.parse` trust boundary

Provider responses are untrusted input. The `tool.intent.parse` method parses fenced `brownie-tool-intent` blocks, validates parser limits and schemas, runs `workspace.read` path preflight, and returns only parser metadata plus summaries.

`ToolIntentDecisionSummary` contains `input_summary`:

```json
{"has_path":true,"field_count":1}
```

It must not contain a raw `input` field. Raw provider responses and raw `brownie-tool-intent` JSON are never returned by this RPC. Rejected requests include stable rejection codes such as `malformed_json`, `invalid_schema`, `unknown_tool`, and `invalid_input` without echoing raw input JSON.

Ledger and inspection surfaces follow the same trust boundary: parser metadata, rejection codes, and input summaries may be stored or displayed; raw provider responses and raw intent JSON must not be stored or displayed.

## `proposal.list`

Phase 3.0 adds `proposal.list` with params `{ "run_id": string }`. The result is `{ "run_id": string, "proposals": [...] }`, where each proposal summary contains `proposal_id`, `path`, `operation`, `content_preview`, `content_chars`, and `truncated`. Unknown runs return `-32602`.

## Phase 3.1 proposal validation and inspection

`proposal.list` summaries now include `validation_status`, `validation_reason`, `diff_preview`, `diff_truncated`, and `diff_redacted` in addition to the Phase 3.0 fields. Allowed validation statuses are `Valid`, `Invalid`, and `Blocked`.

`proposal.inspect` accepts `{ "run_id": string, "proposal_id": string }` and returns `{ "proposal": WorkspacePatchProposalSummary }`. Empty IDs, unknown runs, and unknown proposals return JSON-RPC `-32602`.

Diff previews are synthetic unified diff previews only. They are capped before ledger storage and RPC exposure. Sensitive-like proposed content redacts `content_preview` and suppresses diff preview; sensitive-like existing target content also suppresses diff preview. The runtime still does not apply patches or write files for `workspace.write`.

## Phase 3.2 `proposal.approve` / `proposal.reject`

`proposal.approve` accepts `{ "run_id": string, "proposal_id": string, "reason"?: string }` and returns `{ "proposal": WorkspacePatchProposalSummary, "apply_plan": WorkspacePatchApplyPlanSummary }`. The proposal must exist, be `Valid`, and have `approval_status` `Pending`; otherwise the runtime returns JSON-RPC `-32602`. The method records `WorkspacePatchApproved` and `WorkspacePatchApplyPlanCreated` ledger events only. It does not write files and does not apply patches.

`proposal.reject` accepts `{ "run_id": string, "proposal_id": string, "reason"?: string }` and returns `{ "proposal": WorkspacePatchProposalSummary }`. The proposal must exist and be `Pending`; otherwise the runtime returns `-32602`. The method records `WorkspacePatchRejected` only and does not write files.

`WorkspacePatchProposalSummary` now includes `approval_status`, `approval_reason`, `approved_at`, `rejected_at`, and may include summary-only `latest_apply_plan`. Forbidden raw fields remain excluded from all proposal and apply-plan responses.

## Phase 3.3 `proposal.preflight`

`proposal.preflight` accepts `{ "run_id": string, "proposal_id": string }` and returns `{ "proposal": WorkspacePatchProposalSummary, "snapshot": WorkspacePatchPreflightSnapshotSummary, "apply_plan": WorkspacePatchApplyPlanSummary }`. The proposal must exist, be `Approved`, and have `validation_status = Valid`; otherwise the runtime returns JSON-RPC `-32602`.

`WorkspacePatchPreflightSnapshotSummary` contains metadata only: `proposal_id`, `snapshot_id`, workspace-relative `path`, `canonical_path_hash`, `file_exists`, `file_kind` (`File`, `Directory`, `Missing`, `Other`, or `Unreadable`), `file_size_bytes`, `file_modified_unix_ms`, `file_sha256`, `captured_at`, `stale`, and `stale_reason`. The runtime hashes canonical paths instead of returning absolute paths, and it never returns file content, raw content, full content, patches, diffs, or raw input JSON.

`WorkspacePatchProposalSummary` includes `latest_snapshot` and `approval_reason_redacted`. Secret-like approval or rejection reasons are represented as `[redacted]` and are not stored raw. Preflight appends ledger metadata only and never writes files or applies patches.

## Phase 3.4 `proposal.readiness`

`proposal.readiness` accepts `{ "run_id": string, "proposal_id": string }` and returns `{ "proposal": WorkspacePatchProposalSummary, "report": WorkspacePatchReadinessReportSummary }`. Empty IDs, unknown runs, and unknown proposals return JSON-RPC `-32602`.

`WorkspacePatchReadinessReportSummary` contains `proposal_id`, `report_id`, `readiness_status`, `readiness_reason`, `readiness_fingerprint`, `fingerprint_input_count`, `generated_at`, a bounded checklist of `WorkspacePatchReadinessCheckSummary`, and a deterministic human-readable summary. Allowed readiness statuses are `Ready`, `NotReady`, and `Blocked`; allowed check statuses are `Pass`, `Fail`, `Blocked`, and `Skipped`.

The method uses the reconstructed proposal summary and latest preflight snapshot. It does not need a fresh target-file read in normal operation, does not write files, and does not apply patches. Historical Phase 3.4 readiness reported readiness for final human review only; after M6.1, readiness can also report that controlled apply execution is available through the separate `proposal.apply` RPC.

`WorkspacePatchReadinessReportCreated` is appended as summary-only ledger metadata. Readiness reports, checklists, snapshots, and ledger payloads must not expose raw file content, raw proposed content, raw input JSON, full patch content, raw diffs, canonical absolute paths, absolute paths, or secret-like text. Forbidden raw field names are `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, and `file_content`.

## Phase 3.5 `proposal.applyCapability`

`proposal.applyCapability` accepts `{ "run_id": string, "proposal_id": string }` and returns `{ "proposal": WorkspacePatchProposalSummary, "capability": WorkspacePatchApplyCapabilitySummary }`. Empty IDs, unknown runs, and unknown proposals return JSON-RPC `-32602`.

`WorkspacePatchApplyCapabilitySummary` contains summary metadata only: `proposal_id`, `capability_id`, `apply_supported`, `apply_enabled`, `mode`, `reason`, `required_gates`, `can_apply_now`, `checked_at`, `check_count`, `failed_checks`, `blocked_checks`, and a bounded checklist of `WorkspacePatchApplyCapabilityCheckSummary`. Historical Phase 3.5 reported `apply_supported = false`, `apply_enabled = false`, and `mode = dry_run_only`; after M6.1, the same summary can report `apply_supported = true`, `apply_enabled = true`, `mode = controlled_apply`, and `can_apply_now = true` only when the proposal gates required by `proposal.apply` are satisfied.

`proposal.applyCapability` is an inspect-only design contract. It may inspect existing proposal state and append a summary-only `WorkspacePatchApplyCapabilityChecked` ledger event. It must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.6 `proposal.applyDryRun`

`proposal.applyDryRun` accepts `{ "run_id": string, "proposal_id": string }` and returns `{ "proposal": WorkspacePatchProposalSummary, "dry_run": WorkspacePatchApplyDryRunSummary }`. Empty IDs, unknown runs, and unknown proposals return JSON-RPC `-32602`.

`WorkspacePatchApplyDryRunSummary` contains summary metadata only: `proposal_id`, `dry_run_id`, `dry_run_status`, `dry_run_reason`, `checked_at`, `required_gates`, `check_count`, `failed_checks`, `blocked_checks`, `no_patch_applied`, `apply_executed`, `workspace_files_changed`, and a bounded checklist of `WorkspacePatchApplyDryRunCheckSummary`. In Phase 3.6, dry-run inspection never applies a patch and never writes workspace files, so `no_patch_applied` is always `true`, `apply_executed` is always `false`, and `workspace_files_changed` is always `false`.

`proposal.applyDryRun` appends `WorkspacePatchApplyDryRunChecked` with summary-only metadata. It may inspect existing proposal, approval, preflight, readiness, and apply-disabled state, but it must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## M6.1 `proposal.apply`

`proposal.apply` accepts `{ "run_id": string, "proposal_id": string, "expected_target_sha256": string, "replacement_content": string, "authorize": true }` and returns `{ "proposal": WorkspacePatchProposalSummary, "apply_result": WorkspacePatchApplyResultSummary }`. Empty IDs, missing expected hashes, missing content, unknown runs, and unknown proposals return JSON-RPC `-32602`.

The method is the first runtime-owned workspace mutation path. It only applies one approved `replace_file` proposal to one existing regular UTF-8 workspace-relative file. It requires a current unconsumed approval, explicit one-time authorization, a latest fresh preflight snapshot, matching expected target SHA-256, safe path validation, protected path denial, parent traversal denial, symlink rejection, and bounded replacement content. It rejects file creation, deletion, directory mutation, arbitrary rename, multi-file transactions, shell execution, git execution, test execution, network access, service control, and automatic apply without explicit authorization.

Before writing, the runtime revalidates proposal state, approval freshness, latest preflight metadata, current target hash, file kind, UTF-8 target content, sensitive-like content, and a deterministic synthetic diff match against the approved proposal summary. The replacement content is request input only: it is never stored in the ledger and never returned in RPC responses.

Successful apply writes through a temporary sibling file, flushes and syncs file contents, atomically replaces the target, performs best-effort parent directory sync, verifies the post-write SHA-256, records `WorkspacePatchApplyResultRecorded` with summary-only metadata, and returns a bounded `WorkspacePatchApplyResultSummary`. Failure paths record bounded denial/failure metadata, avoid consuming authorization before a successful verified replacement, preserve the original target whenever possible, and remove partial temporary files.

## M3 controlled apply readiness fingerprint

M3 strengthens the existing `proposal.readiness` and `proposal.applyDryRun` paths without adding a new endpoint. `proposal.readiness` records a `readiness_fingerprint` over stable summary-only proposal evidence, approval state, latest preflight snapshot metadata, and readiness checklist status. `proposal.applyDryRun` recomputes that fingerprint from the current reconstructed proposal state and fails the `readiness_fingerprint_current` gate when the latest readiness report no longer matches current evidence.

The fingerprint is summary-only. It must not include raw file content, raw diffs, raw input JSON, canonical absolute paths, shell command text, stdout/stderr, environment values, or network-derived content. M3 still never applies patches, writes workspace files, runs shell or git commands, fetches network resources, or authorizes apply.

## Phase 3.7 `proposal.applyDryRunHistory`

`proposal.applyDryRunHistory` accepts `{ "run_id": string, "proposal_id": string }` and returns `{ "proposal": WorkspacePatchProposalSummary, "history": WorkspacePatchApplyDryRunHistorySummary }`. Empty IDs, unknown runs, and unknown proposals return JSON-RPC `-32602`.

`WorkspacePatchApplyDryRunHistorySummary` contains `proposal_id`, `dry_run_count`, `latest_dry_run`, `dry_runs`, and `generated_at`. `dry_runs` is bounded to the 10 newest `WorkspacePatchApplyDryRunHistoryEntry` values in newest-first order; `dry_run_count` reports the full number of matching dry-run checks reconstructed from the ledger. `latest_dry_run` is the newest matching entry or `null` when no dry-run checks exist.

Each history entry is summary-only metadata reconstructed from sanitized `WorkspacePatchApplyDryRunChecked` payloads: `proposal_id`, `dry_run_id`, `dry_run_status`, `dry_run_reason`, `checked_at`, `required_gates`, `check_count`, `failed_checks`, `blocked_checks`, `no_patch_applied`, `apply_executed`, and `workspace_files_changed`. Every exposed entry must report `no_patch_applied = true`, `apply_executed = false`, and `workspace_files_changed = false`.

`proposal.applyDryRunHistory` appends no ledger event. It must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.8 `proposal.auditTrail`

`proposal.auditTrail` accepts `{ "run_id": string, "proposal_id": string }` and returns `{ "proposal": WorkspacePatchProposalSummary, "audit_trail": WorkspacePatchAuditTrailSummary }`. Empty IDs, unknown runs, and unknown proposals return JSON-RPC `-32602`.

`WorkspacePatchAuditTrailSummary` contains `proposal_id`, `event_count`, `latest_event`, `events`, and `generated_at`. `event_count` reports the total proposal lifecycle entries reconstructed from the ledger. `events` contains up to the 50 newest lifecycle entries in ledger order, and `latest_event` identifies the newest lifecycle entry even when the returned list is bounded.

Each `WorkspacePatchAuditTrailEntry` contains `event_id`, `audit_event`, `event_kind`, `timestamp`, `proposal_id`, `summary`, and `metadata`. Audit event names are stable high-level lifecycle names such as `proposal_created`, `proposal_approved`, `proposal_rejected`, `preflight_snapshot_created`, `apply_plan_created`, `readiness_checked`, `apply_capability_checked`, and `apply_dry_run_checked`.

`proposal.auditTrail` is reconstructed from existing sanitized ledger events and appends no ledger event. It must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.9 `proposal.reviewBundle`

`proposal.reviewBundle` accepts `{ "run_id": string, "proposal_id": string }` and returns `{ "proposal": WorkspacePatchProposalSummary, "review_bundle": WorkspacePatchReviewBundleSummary }`. Empty IDs, unknown runs, and unknown proposals return JSON-RPC `-32602`.

`WorkspacePatchReviewBundleSummary` contains `proposal_id`, `review_status`, `review_reason`, `latest_readiness`, `latest_apply_capability`, `latest_apply_dry_run`, `audit_event_count`, `latest_audit_event`, `required_next_actions`, and `generated_at`. `review_status` is `Complete` when the latest readiness, apply capability, and apply dry-run signals all exist, otherwise `NeedsAction`. Missing signals are listed as RPC names in `required_next_actions`.

The latest signal fields are compact `WorkspacePatchReviewSignalSummary` values containing only `status`, optional `reason`, optional `generated_at`, and optional `source_id`. `latest_audit_event` reuses the sanitized `WorkspacePatchAuditTrailEntry` shape.

`proposal.reviewBundle` is reconstructed from existing sanitized ledger events and appends no ledger event. It must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.10 `proposal.reviewVerdict`

`proposal.reviewVerdict` accepts `{ "run_id": string, "proposal_id": string }` and returns `{ "proposal": WorkspacePatchProposalSummary, "review_verdict": WorkspacePatchReviewVerdictSummary }`. Empty IDs, unknown runs, and unknown proposals return JSON-RPC `-32602`.

`WorkspacePatchReviewVerdictSummary` contains `proposal_id`, `verdict_status`, `verdict_reason`, `evidence_status`, `blocking_reasons`, `missing_signals`, `latest_review_bundle_status`, `apply_authorized`, and `generated_at`. Allowed verdict statuses are `ReadyForHumanReview`, `NeedsSignals`, and `BlockedForReview`. `apply_authorized` is always `false`.

`NeedsSignals` is returned when readiness, apply capability, or apply dry-run evidence is missing. `BlockedForReview` is returned when latest readiness is not `Ready`, dry-run evidence is incomplete or indicates patch application or workspace file changes, or proposal evidence is blocked or redacted. Apply capability values of `false` are expected safety-boundary evidence and are not apply authorization.

`proposal.reviewVerdict` is reconstructed from existing sanitized ledger events and appends no ledger event. It must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.11 `proposal.reviewReport`

`proposal.reviewReport` accepts `{ "run_id": string, "proposal_id": string }` and returns `{ "proposal": WorkspacePatchProposalSummary, "review_report": WorkspacePatchReviewReportSummary }`. Empty IDs, unknown runs, and unknown proposals return JSON-RPC `-32602`.

`WorkspacePatchReviewReportSummary` is summary-only and contains `proposal_id`, `report_status`, `report_reason`, `review_bundle`, `review_verdict`, `audit_event_count`, `recent_audit_events`, `required_next_actions`, `apply_authorized`, and `generated_at`. `report_status` is `Complete` only when the review bundle is complete and the verdict is `ReadyForHumanReview`, `NeedsAction` when signals are missing, and `Blocked` when the verdict is `BlockedForReview`. `recent_audit_events` contains at most the five newest sanitized lifecycle entries in newest-first order. `apply_authorized` is always `false`.

`proposal.reviewReport` is reconstructed from existing sanitized ledger events and appends no ledger event. It must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.12 `proposal.reviewQueue`

`proposal.reviewQueue` accepts `{ "run_id": string }` and returns `{ "review_queue": WorkspacePatchReviewQueueSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueSummary` is summary-only and contains `run_id`, `queue_status`, `queue_reason`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `items`, `required_next_actions`, and `generated_at`. Each item contains compact proposal identifiers and review status fields: `proposal_id`, `path`, `validation_status`, `approval_status`, `report_status`, `report_reason`, `verdict_status`, `review_status`, `audit_event_count`, `latest_audit_event`, `required_next_actions`, `apply_authorized`, and `generated_at`.

`queue_status` is `Blocked` when any queue item is blocked, `NeedsAction` when no item is blocked and at least one item needs action, and `Complete` only when all queue items are complete. `apply_authorized` is always `false` for every item. `proposal.reviewQueue` is reconstructed from existing sanitized ledger events and appends no ledger event. It must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.13 `proposal.reviewQueueDiagnostics`

`proposal.reviewQueueDiagnostics` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics": WorkspacePatchReviewQueueDiagnosticsSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsSummary` is summary-only and contains `run_id`, `diagnostics_status`, `diagnostics_reason`, `queue_status`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `check_count`, `failed_checks`, `blocked_checks`, `checks`, `required_next_actions`, `apply_authorized`, and `generated_at`. Each check contains `name`, `status`, and `reason`.

Diagnostics reconstruct the existing `proposal.reviewQueue` summary and validate compact consistency checks such as count/status agreement, `apply_authorized=false` on all queue items, compact review evidence presence, and deduplicated required next actions. `diagnostics_status` is `Blocked` when consistency checks fail or queue evidence is blocked, `NeedsAction` when checks pass but the queue still needs action, and `Complete` when checks pass and the queue is complete. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.14 `proposal.reviewQueueDiagnosticsHistory`

`proposal.reviewQueueDiagnosticsHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_history": WorkspacePatchReviewQueueDiagnosticsHistorySummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `diagnostics_count`, `latest_diagnostics`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `diagnostics_id`, `diagnostics_status`, `queue_status`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_checks`, `blocked_checks`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The history surface reconstructs the latest `proposal.reviewQueueDiagnostics` summary on demand and returns it as a bounded one-entry history. `history_status` mirrors the latest diagnostics status. `diagnostics_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.15 `proposal.reviewQueueDiagnosticsReport`

`proposal.reviewQueueDiagnosticsReport` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_report": WorkspacePatchReviewQueueDiagnosticsReportSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsReportSummary` is summary-only and contains `run_id`, `report_status`, `report_reason`, `queue_status`, `diagnostics_status`, `diagnostics_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_checks`, `blocked_checks`, `required_next_actions`, `latest_diagnostics`, `apply_authorized`, and `generated_at`.

The report surface reconstructs the latest review queue diagnostics history on demand and returns a bounded operator report over queue and diagnostics state. `report_status` mirrors the diagnostics status. `latest_diagnostics` is the latest bounded diagnostics history entry when available. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.16 `proposal.reviewQueueDiagnosticsDigest`

`proposal.reviewQueueDiagnosticsDigest` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest": WorkspacePatchReviewQueueDiagnosticsDigestSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestSummary` is summary-only and contains `run_id`, `digest_status`, `digest_reason`, `queue_status`, `diagnostics_status`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest surface reconstructs the latest diagnostics report on demand and returns a compact dashboard-oriented status payload. `digest_status` mirrors the report status, and `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.17 `proposal.reviewQueueDiagnosticsDigestHistory`

`proposal.reviewQueueDiagnosticsDigestHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_history": WorkspacePatchReviewQueueDiagnosticsDigestHistorySummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `digest_count`, `latest_digest`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `digest_id`, `digest_status`, `queue_status`, `diagnostics_status`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest history surface reconstructs the latest diagnostics digest on demand and returns it as a bounded one-entry history. `history_status` mirrors the latest digest status. `digest_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.18 `proposal.reviewQueueDiagnosticsDigestReport`

`proposal.reviewQueueDiagnosticsDigestReport` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report": WorkspacePatchReviewQueueDiagnosticsDigestReportSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportSummary` is summary-only and contains `run_id`, `report_status`, `report_reason`, `digest_status`, `history_status`, `digest_count`, `latest_digest`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report surface reconstructs the latest diagnostics digest history on demand and summarizes it for operators. `report_status` mirrors the digest history status. `digest_count` is the number of bounded digest history entries represented. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.19 `proposal.reviewQueueDiagnosticsDigestReportHistory`

`proposal.reviewQueueDiagnosticsDigestReportHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_history": WorkspacePatchReviewQueueDiagnosticsDigestReportHistorySummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `report_count`, `latest_report`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `report_id`, `report_status`, `digest_status`, `history_status`, `digest_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report history surface reconstructs the latest diagnostics digest report on demand and returns it as a bounded one-entry history. `history_status` mirrors the latest report status. `report_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.20 `proposal.reviewQueueDiagnosticsDigestReportVerdict`

`proposal.reviewQueueDiagnosticsDigestReportVerdict` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictSummary` is summary-only and contains `run_id`, `verdict_status`, `verdict_reason`, `history_status`, `report_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict surface reconstructs the latest diagnostics digest report history on demand and summarizes it for operators. `verdict_status` mirrors the digest report history status. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.21 `proposal.reviewQueueDiagnosticsDigestReportVerdictHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistorySummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `verdict_count`, `latest_verdict`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `verdict_id`, `verdict_status`, `history_status`, `report_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict history surface reconstructs the latest diagnostics digest report verdict on demand and returns it as a bounded one-entry history. `history_status` mirrors the latest verdict status. `verdict_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.22 `proposal.reviewQueueDiagnosticsDigestReportVerdictReport`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReport` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportSummary` is summary-only and contains `run_id`, `report_status`, `report_reason`, `history_status`, `verdict_status`, `verdict_count`, `latest_verdict`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report surface reconstructs the latest diagnostics digest report verdict history on demand and summarizes it for operators. `report_status` mirrors the verdict history status. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.23 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistorySummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `report_count`, `latest_report`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `report_id`, `report_status`, `history_status`, `verdict_status`, `verdict_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history surface reconstructs the latest diagnostics digest report verdict report on demand and returns it as a bounded one-entry history. `history_status` mirrors the latest report status. `report_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.24 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigest`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigest` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestSummary` is summary-only and contains `run_id`, `digest_status`, `digest_reason`, `history_status`, `report_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest surface reconstructs the latest diagnostics digest report verdict report history on demand and summarizes it for dashboards. `digest_status` mirrors the history status. `report_status` mirrors the latest report status when available. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.25 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistorySummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `digest_count`, `latest_digest`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `digest_id`, `digest_status`, `history_status`, `report_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history surface reconstructs the latest diagnostics digest report verdict report history digest on demand and returns it as a bounded one-entry history. `history_status` mirrors the latest digest status. `digest_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.26 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReport`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReport` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportSummary` is summary-only and contains `run_id`, `report_status`, `report_reason`, `history_status`, `digest_status`, `digest_count`, `latest_digest`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report surface reconstructs the latest diagnostics digest report verdict report history digest history on demand and summarizes it for operators. `report_status` mirrors the history status. `digest_status` mirrors the latest digest status when available. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.27 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistorySummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `report_count`, `latest_report`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `report_id`, `report_status`, `history_status`, `digest_status`, `digest_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history surface reconstructs the latest diagnostics digest report verdict report history digest history report on demand and returns it as a bounded one-entry history. `history_status` mirrors the latest report status. `report_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.28 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigest`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigest` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestSummary` is summary-only and contains `run_id`, `digest_status`, `digest_reason`, `history_status`, `report_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest surface reconstructs the latest diagnostics digest report verdict report history digest history report history on demand and summarizes it for dashboards. `digest_status` mirrors the history status. `report_status` mirrors the latest report status when available. `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.29 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistorySummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `digest_count`, `latest_digest`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `digest_id`, `digest_status`, `history_status`, `report_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history surface reconstructs the latest diagnostics digest report verdict report history digest history report history digest on demand and returns it as a bounded one-entry history. `history_status` mirrors the latest digest status. `digest_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.30 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReport`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReport` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary` is summary-only and contains `run_id`, `report_status`, `report_reason`, `history_status`, `digest_status`, `digest_count`, `latest_digest`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report surface reconstructs the latest diagnostics digest report verdict report history digest history report history digest history on demand and summarizes it for operators. `report_status` mirrors the history status. `digest_status` mirrors the latest digest status when available. `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.31 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `report_count`, `latest_report`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `report_id`, `report_status`, `history_status`, `digest_status`, `digest_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history surface reconstructs the latest diagnostics digest report verdict report history digest history report history digest history report on demand and returns it as a bounded one-entry history. `history_status` mirrors the latest report status. `report_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.32 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary` is summary-only and contains `run_id`, `digest_status`, `digest_reason`, `history_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest surface reconstructs the latest diagnostics digest report verdict report history digest history report history digest history report history on demand and returns compact digest fields for digest status, history status, report count, proposal counts, check counts, and required next actions. `digest_status` mirrors the history status. `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.33 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `digest_count`, `latest_digest`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `digest_id`, `digest_status`, `history_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history surface reconstructs the latest diagnostics digest report verdict report history digest history report history digest history report history digest on demand and returns it as a bounded one-entry history. `history_status` mirrors the latest digest status. `digest_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.34 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary` is summary-only and contains `run_id`, `report_status`, `report_reason`, `history_status`, `digest_status`, `digest_count`, `latest_digest`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report surface reconstructs the latest diagnostics digest report verdict report history digest history report history digest history report history digest history on demand and summarizes it for operators. `report_status` mirrors the history status. `digest_status` mirrors the latest digest status when available. `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.35 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `report_count`, `latest_report`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `report_id`, `report_status`, `history_status`, `digest_status`, `digest_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history surface reconstructs the latest diagnostics digest report verdict report history digest history report history digest history report history digest history report on demand and returns it as a bounded one-entry history. `history_status` mirrors the latest report status. `report_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.36 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary }`. Empty IDs and unknown runs return JSON-RPC `-32602`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary` is summary-only and contains `run_id`, `digest_status`, `digest_reason`, `history_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest surface reconstructs the current diagnostics digest report verdict report history digest history report history digest history report history digest history report history on demand and returns compact dashboard fields. `digest_status` mirrors the history status. Count fields and required next actions are derived from the latest report entry when available. `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.37 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without an available Phase 3.36 digest, return a summary-only empty history with `digest_count = 0`, `latest_digest = null`, `entries = []`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `digest_count`, `latest_digest`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `digest_id`, `digest_status`, `history_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history surface reconstructs the latest diagnostics digest report verdict report history digest history report history digest history report history digest history report history digest on demand and returns it as a bounded history. `history_status` mirrors the latest digest status when available, and reports a blocked empty history when no digest is available. `digest_count` is the number of bounded entries returned. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.38 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without an available Phase 3.37 history entry, return a summary-only report with `digest_count = 0`, `latest_digest = null`, zero count fields, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary` is summary-only and contains `run_id`, `report_status`, `report_reason`, `history_status`, `digest_status`, `digest_count`, `latest_digest`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report surface reuses the Phase 3.37 history inspection path as its source of truth and summarizes the latest digest when available. `report_status` mirrors the history status. `digest_status` mirrors the latest digest status when available and otherwise mirrors the empty history status. Count fields and required next actions are derived only from the latest digest. `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.39 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without an available Phase 3.38 report entry, return a summary-only empty history with `report_count = 0`, `latest_report = null`, `entries = []`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `report_count`, `latest_report`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `report_id`, `report_status`, `history_status`, `digest_status`, `digest_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report history surface reuses the Phase 3.38 report inspection path as its source of truth and returns a bounded one-entry history when a report exists. `history_status` mirrors the latest report status. `report_count` is the number of bounded entries returned and matches `entries.length`. Each entry's `required_next_action_count` matches its bounded `required_next_actions` length. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.40 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without an available Phase 3.39 report history entry, return a summary-only digest with zero count fields, empty `required_next_actions`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary` is summary-only and contains `run_id`, `digest_status`, `digest_reason`, `history_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest surface reuses the Phase 3.39 report history inspection path as its source of truth and returns compact digest fields. `digest_status` mirrors the report history status. Count fields and required next actions are derived from the latest report when available. `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.41 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without an available Phase 3.40 digest, return a summary-only empty history with `digest_count = 0`, `latest_digest = null`, `entries = []`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `digest_count`, `latest_digest`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `digest_id`, `digest_status`, `history_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history surface reuses the Phase 3.40 digest inspection path as its source of truth and returns a bounded one-entry history when a digest exists. `history_status` mirrors the latest digest status. `digest_count` is the number of bounded entries returned and matches `entries.length`. Each entry's `required_next_action_count` matches its bounded `required_next_actions` length. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.42 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without an available Phase 3.41 digest history entry, return a summary-only report with `digest_count = 0`, `latest_digest = null`, zero count fields, empty `required_next_actions`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary` is summary-only and contains `run_id`, `report_status`, `report_reason`, `history_status`, `digest_count`, `latest_digest`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report surface reuses the Phase 3.41 digest history inspection path as its source of truth and summarizes the latest digest when available. `report_status` mirrors the history status. Count fields and required next actions are derived from the latest digest. `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false` on the report and nested latest digest. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.43 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without an available Phase 3.42 report, return a summary-only empty history with `report_count = 0`, `latest_report = null`, `entries = []`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `report_count`, `latest_report`, `entries`, `apply_authorized`, and `generated_at`. Each entry contains `report_id`, `report_status`, `history_status`, `digest_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history surface reuses the Phase 3.42 report inspection path as its source of truth and returns a bounded one-entry history when a report exists. `history_status` mirrors the latest report status. `report_count` is the number of bounded entries returned and matches `entries.length`. Each entry's `required_next_action_count` matches its bounded `required_next_actions` length. `apply_authorized` is always `false` on the history and every entry. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.44 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without available Phase 3.43 history, return a summary-only empty digest with zero counts, empty `required_next_actions`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary` is summary-only and contains `run_id`, `digest_status`, `digest_reason`, `history_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest surface reuses the Phase 3.43 history inspection path as its source of truth and returns compact digest fields. `digest_status` mirrors the history status. Count fields and required next actions are derived from the latest report when available. `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.45 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without available Phase 3.44 digest, return a summary-only empty history with `digest_count = 0`, `latest_digest = null`, `entries = []`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `digest_count`, `latest_digest`, `entries`, `apply_authorized`, and `generated_at`. Each entry is a `WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary` containing `digest_id`, `digest_status`, `history_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest history surface reuses the Phase 3.44 digest inspection path as its source of truth and returns a bounded summary-only history. `digest_count` equals `entries.length`, and each entry's `required_next_action_count` equals `required_next_actions.length`. `latest_digest` is either `null` or one of the same compact entry shapes. `apply_authorized` is always `false` at the top level and inside entries. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.46 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without available Phase 3.45 history, return a summary-only empty report with `digest_count = 0`, `latest_digest = null`, zero aggregate counts, empty `required_next_actions`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary` is summary-only and contains `run_id`, `report_status`, `report_reason`, `history_status`, `digest_count`, `latest_digest`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest history report surface reuses the Phase 3.45 history inspection path as its source of truth and returns compact report fields. Count fields and required next actions are derived from `latest_digest` when available. `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false` at the top level and inside `latest_digest`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.47 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without available Phase 3.46 report content, return a summary-only empty history with `report_count = 0`, `latest_report = null`, `entries = []`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `report_count`, `latest_report`, `entries`, `apply_authorized`, and `generated_at`. Each entry is a `WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary` containing `report_id`, `report_status`, `history_status`, `digest_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest history report history surface reuses the Phase 3.46 report inspection path as its source of truth and returns a bounded summary-only history. `report_count` equals `entries.length`, and each entry's `required_next_action_count` equals `required_next_actions.length`. `latest_report` is either `null` or one of the same compact entry shapes. `apply_authorized` is always `false` at the top level and inside entries. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.48 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigest` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without available Phase 3.47 history content, return a summary-only empty digest with `report_count = 0`, zero aggregate counts, empty `required_next_actions`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary` is summary-only and contains `run_id`, `digest_status`, `digest_reason`, `history_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest history report history digest surface reuses the Phase 3.47 history inspection path as its source of truth and returns compact digest fields. Count fields and required next actions are derived from `latest_report` when available. `required_next_action_count` matches the bounded `required_next_actions` length. `apply_authorized` is always `false`. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.49 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without available Phase 3.48 digest content, return a summary-only empty history with `digest_count = 0`, `latest_digest = null`, `entries = []`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `digest_count`, `latest_digest`, `entries`, `apply_authorized`, and `generated_at`. Each entry is a `WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary` containing `digest_id`, `digest_status`, `history_status`, `report_count`, `proposal_count`, `complete_count`, `needs_action_count`, `blocked_count`, `failed_check_count`, `blocked_check_count`, `required_next_action_count`, `required_next_actions`, `apply_authorized`, and `generated_at`.

The digest report verdict report history digest history report history digest history report history digest history report history digest history report history digest history report history digest history report history digest history surface reuses the Phase 3.48 digest inspection path as its source of truth and returns a bounded summary-only history. `digest_count` equals `entries.length`, and each entry's `required_next_action_count` equals `required_next_actions.length`. `latest_digest` is either `null` or one of the same compact entry shapes. `apply_authorized` is always `false` at the top level and inside entries. The method appends no ledger event and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, or `file_content`.

## Phase 3.50 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReport` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without available Phase 3.49 history content, return a compact summary-only empty report with `digest_count = 0`, `latest_digest = null`, zero aggregate counts, empty `required_next_actions`, and `apply_authorized = false`.

The report exposes only `run_id`, `report_status`, `report_reason`, `history_status`, `digest_count`, `latest_digest`, aggregate proposal/check counts, bounded `required_next_actions`, `apply_authorized=false`, and `generated_at`. If present, `latest_digest` is the Phase 3.49 summary-only latest digest entry. Top-level and nested `required_next_action_count` values must match their array lengths. The method appends no ledger event, never authorizes apply, and must not apply patches, write workspace files, run shell or git commands, use network access, expose canonical absolute paths, or return/store raw file content, raw reports, raw digests, raw diffs, raw input JSON, `content`, `raw_content`, `full_content`, `patch`, `diff`, `raw_input`, `canonical_path`, `absolute_path`, `file_content`, command strings, stdout, stderr, environment values, or serialized request bodies.

## Phase 3.51 `proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory`

`proposal.reviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistory` accepts `{ "run_id": string }` and returns `{ "review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history": WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary }`. Empty IDs return JSON-RPC `-32602`. Unknown runs, or runs without available Phase 3.50 report content, return a summary-only empty history with `report_count = 0`, `latest_report = null`, `entries = []`, and `apply_authorized = false`.

`WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary` is summary-only and contains `run_id`, `history_status`, `history_reason`, `report_count`, `latest_report`, `entries`, `apply_authorized`, and `generated_at`. Each entry is a `WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary` containing `report_id`, `report_status`, `history_status`, `digest_count`, aggregate proposal/check counts, `required_next_action_count`, bounded `required_next_actions`, `apply_authorized`, and `generated_at`. The endpoint reuses the Phase 3.50 report builder, appends no ledger event, never authorizes apply, and exposes no raw content, diffs, paths, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5 subtask orchestration queue

M5 introduces runtime-owned subtask orchestration state without spawning subtasks. During `task.run`, an approved assistant `subtask.spawn` intent appends one `SubtaskOrchestrationQueued` ledger event. The event is summary-only and includes `subtask_id`, `parent_task_id`, `parent_run_id`, `tool_id`, `required_action`, `status = "Queued"`, `queue_position`, `request_reason`, `input_summary`, `execution_enabled = false`, and a high-level reason.

`run.events` returns these fields through the normal sanitized ledger summary path, and `run.inspect` / `task.inspect` expose `has_subtask_orchestration_queued` and `subtask_queue_count`. M5 does not launch child tasks, execute process commands, access the network, control services, apply patches, write workspace files, or persist raw `input`, raw provider responses, raw prompts, raw file content, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5.1 subtask handoff preparation

M5.1 consumes queued subtask orchestration evidence inside `task.run` without spawning child tasks. When a run has one or more `SubtaskOrchestrationQueued` events, the runtime appends one `SubtaskHandoffPrepared` ledger event before completion. The event is summary-only and includes `handoff_id`, `parent_task_id`, `parent_run_id`, `status = "Prepared"`, `queued_count`, `queued_subtask_ids`, `source_event_count`, `execution_enabled = false`, `next_action = "await_future_runtime_scheduler"`, and a high-level reason.

`run.events` returns the sanitized handoff fields, and `run.inspect` / `task.inspect` expose `has_subtask_handoff_prepared` and `subtask_handoff_count`. M5.1 does not launch child tasks, execute process commands, access the network, control services, apply patches, write workspace files, or persist raw `input`, raw provider responses, raw prompts, raw file content, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5.2 subtask scheduler readiness

M5.2 evaluates prepared subtask handoff evidence inside `task.run` without spawning child tasks. When a run has one or more `SubtaskHandoffPrepared` events, the runtime appends one `SubtaskSchedulerReadinessRecorded` ledger event before completion. The event is summary-only and includes `readiness_id`, `parent_task_id`, `parent_run_id`, `handoff_id`, `handoff_count`, `queued_count`, `source_event_count`, `status = "Blocked"`, `readiness_status = "Blocked"`, `readiness_reason`, `check_count`, `blocked_checks`, `execution_enabled = false`, `dispatch_enabled = false`, `next_action = "await_runtime_scheduler_dispatch"`, and a high-level reason.

`run.events` returns the sanitized readiness fields, and `run.inspect` / `task.inspect` expose `has_subtask_scheduler_readiness` and `subtask_scheduler_readiness_count`. M5.2 does not launch child tasks, execute process commands, access the network, control services, apply patches, write workspace files, or persist raw `input`, raw provider responses, raw prompts, raw file content, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5.3 subtask dispatch plan preparation

M5.3 consumes scheduler-readiness evidence inside `task.run` without spawning child tasks. When a run has one or more `SubtaskSchedulerReadinessRecorded` events, the runtime appends one `SubtaskDispatchPlanPrepared` ledger event before completion. The event is summary-only and includes `plan_id`, `parent_task_id`, `parent_run_id`, `readiness_id`, `readiness_count`, `queued_count`, `source_event_count`, `status = "Blocked"`, `dispatch_plan_status = "Blocked"`, `dispatch_reason`, `required_capability`, `check_count`, `blocked_checks`, `execution_enabled = false`, `dispatch_enabled = false`, `next_action = "await_runtime_subtask_dispatcher"`, and a high-level reason.

`run.events` returns the sanitized dispatch-plan fields, and `run.inspect` / `task.inspect` expose `has_subtask_dispatch_plan_prepared` and `subtask_dispatch_plan_count`. M5.3 does not launch child tasks, execute process commands, access the network, control services, apply patches, write workspace files, or persist raw `input`, raw provider responses, raw prompts, raw file content, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5.4 subtask dispatch contract preparation

M5.4 consumes dispatch-plan evidence inside `task.run` without spawning child tasks. When a run has one or more `SubtaskDispatchPlanPrepared` events, the runtime appends one `SubtaskDispatchContractPrepared` ledger event before completion. The event is summary-only and includes `contract_id`, `parent_task_id`, `parent_run_id`, `plan_id`, `plan_count`, `queued_count`, `source_event_count`, `status = "Blocked"`, `dispatch_contract_status = "Blocked"`, `eligibility_status = "Blocked"`, `dispatch_contract_reason`, `required_capability`, `required_preconditions`, `check_count`, `blocked_checks`, `execution_enabled = false`, `dispatch_enabled = false`, `next_action = "await_dispatch_contract_implementation"`, and a high-level reason.

`run.events` returns the sanitized dispatch-contract fields, and `run.inspect` / `task.inspect` expose `has_subtask_dispatch_contract_prepared` and `subtask_dispatch_contract_count`. M5.4 does not launch child tasks, execute process commands, access the network, control services, apply patches, write workspace files, or persist raw `input`, raw provider responses, raw prompts, raw file content, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5.5 subtask dispatch admission evaluation

M5.5 consumes dispatch-contract evidence inside `task.run` without spawning child tasks. When a run has one or more `SubtaskDispatchContractPrepared` events, the runtime appends one `SubtaskDispatchAdmissionEvaluated` ledger event before completion. The event is summary-only and includes `admission_id`, `parent_task_id`, `parent_run_id`, `contract_id`, `contract_count`, `queued_count`, `source_event_count`, `status = "Blocked"`, `admission_status = "Blocked"`, `execution_gate_status = "Blocked"`, `admission_reason`, `required_capability`, `precondition_count`, `satisfied_precondition_count`, `blocked_preconditions`, `check_count`, `blocked_checks`, `execution_enabled = false`, `dispatch_enabled = false`, `next_action = "await_dispatch_admission_preconditions"`, and a high-level reason.

`run.events` returns the sanitized dispatch-admission fields, and `run.inspect` / `task.inspect` expose `has_subtask_dispatch_admission_evaluated` and `subtask_dispatch_admission_count`. M5.5 does not launch child tasks, execute process commands, access the network, control services, apply patches, write workspace files, or persist raw `input`, raw provider responses, raw prompts, raw file content, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5.6 subtask dispatch readiness snapshot

M5.6 consumes dispatch-admission evidence inside `task.run` without spawning child tasks. When a run has one or more `SubtaskDispatchAdmissionEvaluated` events, the runtime appends one `SubtaskDispatchReadinessSnapshotRecorded` ledger event before completion. The event is summary-only and includes `snapshot_id`, `parent_task_id`, `parent_run_id`, `admission_id`, `admission_count`, `queued_count`, `source_event_count`, `status = "Blocked"`, `readiness_status = "Blocked"`, `scheduler_handoff_status = "Blocked"`, `readiness_reason`, `required_capability`, `precondition_count`, `satisfied_precondition_count`, `blocked_preconditions`, `check_count`, `blocked_checks`, `readiness_fingerprint`, `fingerprint_input_count`, `execution_enabled = false`, `dispatch_enabled = false`, `next_action = "await_dispatch_readiness_snapshot_handoff"`, and a high-level reason.

`run.events` returns the sanitized dispatch-readiness snapshot fields, and `run.inspect` / `task.inspect` expose `has_subtask_dispatch_readiness_snapshot` and `subtask_dispatch_readiness_snapshot_count`. M5.6 does not launch child tasks, execute process commands, access the network, control services, apply patches, write workspace files, or persist raw `input`, raw provider responses, raw prompts, raw file content, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5.7 subtask dispatcher guard verdict

M5.7 consumes dispatch-readiness snapshot evidence inside `task.run` without spawning child tasks. When a run has one or more `SubtaskDispatchReadinessSnapshotRecorded` events, the runtime appends one `SubtaskDispatcherGuardVerdictRecorded` ledger event before completion. The event is summary-only and includes `guard_id`, `parent_task_id`, `parent_run_id`, `snapshot_id`, `snapshot_count`, `queued_count`, `source_event_count`, `status = "Blocked"`, `guard_status = "Blocked"`, `scheduler_handoff_status = "Blocked"`, `handoff_preflight_status = "Blocked"`, `snapshot_validity_status`, `snapshot_fingerprint`, `snapshot_fingerprint_count`, `fingerprint_input_count`, `guard_reason`, `required_capability`, `precondition_count`, `satisfied_precondition_count`, `blocked_preconditions`, `check_count`, `blocked_checks`, `execution_enabled = false`, `dispatch_enabled = false`, `next_action = "await_dispatcher_guard_preconditions"`, and a high-level reason.

`run.events` returns the sanitized dispatcher-guard verdict fields, and `run.inspect` / `task.inspect` expose `has_subtask_dispatcher_guard_verdict` and `subtask_dispatcher_guard_verdict_count`. M5.7 does not launch child tasks, execute process commands, access the network, control services, apply patches, write workspace files, or persist raw `input`, raw provider responses, raw prompts, raw file content, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5.8 subtask dispatch decision

M5.8 consumes dispatcher guard verdict evidence inside `task.run` without spawning child tasks. When a run has one or more `SubtaskDispatcherGuardVerdictRecorded` events, the runtime appends one `SubtaskDispatchDecisionRecorded` ledger event before completion. The event is summary-only and includes `decision_id`, `parent_task_id`, `parent_run_id`, `guard_id`, `guard_count`, `snapshot_id`, `queued_count`, `source_event_count`, `status = "Blocked"`, `decision_status = "Blocked"`, `candidate_status = "Blocked"`, `dispatch_decision = "Denied"`, `dispatch_denial_reason`, `handoff_preflight_status`, `guard_status`, `snapshot_validity_status`, `snapshot_fingerprint`, `snapshot_fingerprint_count`, `fingerprint_input_count`, `dispatch_candidate_count`, `eligible_candidate_count`, `blocked_candidate_count`, `required_capability`, `precondition_count`, `satisfied_precondition_count`, `blocked_preconditions`, `check_count`, `blocked_checks`, `execution_enabled = false`, `dispatch_enabled = false`, `next_action = "await_dispatch_decision_preconditions"`, and a high-level reason.

`run.events` returns the sanitized dispatch-decision fields, and `run.inspect` / `task.inspect` expose `has_subtask_dispatch_decision` and `subtask_dispatch_decision_count`. M5.8 does not launch child tasks, execute process commands, access the network, control services, apply patches, write workspace files, or persist raw `input`, raw provider responses, raw prompts, raw file content, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5.9 subtask dispatch candidate manifest

M5.9 consumes dispatch decision evidence inside `task.run` without spawning child tasks. When a run has one or more `SubtaskDispatchDecisionRecorded` events and queued subtask ids, the runtime appends one `SubtaskDispatchCandidateManifestRecorded` ledger event before completion. The event is summary-only and includes `manifest_id`, `parent_task_id`, `parent_run_id`, `decision_id`, `decision_count`, `guard_id`, `snapshot_id`, `queued_count`, `source_event_count`, `status = "Blocked"`, `manifest_status = "Blocked"`, `candidate_status = "Blocked"`, `dispatch_decision = "Denied"`, `candidate_denial_reason`, `candidate_count`, `dispatch_candidate_count`, `eligible_candidate_count`, `blocked_candidate_count`, `candidate_ids`, `eligible_candidate_ids`, `blocked_candidate_ids`, `candidate_manifest_fingerprint`, `snapshot_fingerprint`, `fingerprint_input_count`, `required_capability`, `precondition_count`, `satisfied_precondition_count`, `blocked_preconditions`, `check_count`, `blocked_checks`, `execution_enabled = false`, `dispatch_enabled = false`, `next_action = "await_dispatch_candidate_manifest_preconditions"`, and a high-level reason.

`run.events` returns the sanitized candidate-manifest fields, and `run.inspect` / `task.inspect` expose `has_subtask_dispatch_candidate_manifest` and `subtask_dispatch_candidate_manifest_count`. M5.9 does not launch child tasks, execute process commands, access the network, control services, apply patches, write workspace files, or persist raw `input`, raw provider responses, raw prompts, raw file content, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5.10 subtask dispatch handoff envelope

M5.10 consumes dispatch candidate manifest evidence inside `task.run` without executing child work. When a run has one or more `SubtaskDispatchCandidateManifestRecorded` events, the runtime appends one `SubtaskDispatchHandoffEnvelopeRecorded` ledger event before completion. The event is summary-only and includes `handoff_envelope_id`, `parent_task_id`, `parent_run_id`, `manifest_id`, `manifest_count`, `decision_id`, `queued_count`, `source_event_count`, `status = "Accepted"`, `handoff_envelope_status = "Accepted"`, `handoff_ticket_status = "Blocked"`, `replay_guard_status = "Blocked"`, `scheduler_handoff_status = "Blocked"`, `candidate_status = "Blocked"`, `dispatch_decision = "Denied"`, `candidate_denial_reason`, `replay_guard_reason`, `candidate_count`, `dispatch_candidate_count`, `eligible_candidate_count`, `blocked_candidate_count`, `handoff_ticket_count`, `candidate_ids`, `eligible_candidate_ids`, `blocked_candidate_ids`, `candidate_manifest_fingerprint`, `handoff_envelope_fingerprint`, `fingerprint_input_count`, `required_capability`, `precondition_count`, `satisfied_precondition_count`, `blocked_preconditions`, `check_count`, `blocked_checks`, `execution_enabled = false`, `dispatch_enabled = false`, `next_action = "materialize_controlled_child_task"`, and a high-level reason.

`run.events` returns the sanitized handoff-envelope fields, and `run.inspect` / `task.inspect` expose `has_subtask_dispatch_handoff_envelope` and `subtask_dispatch_handoff_envelope_count`. The envelope itself does not execute process commands, access the network, control services, apply patches, write workspace files, perform scheduler handoff, or persist raw `input`, raw provider responses, raw prompts, raw file content, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5.11 controlled child task materialization

M5.11 consumes an accepted `SubtaskDispatchHandoffEnvelopeRecorded` event inside `task.run` and materializes exactly one child `TaskRecord` for the parent run. The child record is a runtime entity, not another parent-run blocked summary wrapper. It stores `parent_task_id`, `parent_run_id`, `source_candidate_id`, `source_handoff_envelope_id`, and `source_handoff_envelope_fingerprint`, and its initial status is `Queued`.

The child run receives only a `TaskStarted` ledger event with `status = "Queued"`, parent/source provenance, `execution_enabled = false`, `scheduler_handoff_enabled = false`, and a high-level reason. The runtime prevents duplicate child creation by checking existing child records for the same parent run and `source_handoff_envelope_fingerprint`.

`run.inspect` / `task.inspect` expose `child_task_count` and `child_task_ids` for parent runs. M5.11 does not run the child LLM loop, execute process commands, access the network, control services, apply patches, write workspace files, perform scheduler handoff, or persist raw `input`, raw provider responses, raw prompts, raw file content, command strings, stdout, stderr, environment values, or serialized request bodies.

## M5.12 explicit queued child task run admission

M5.12 admits a materialized child `TaskRecord` with status `Queued` through the existing `task.run` method only when the child has complete controlled provenance. Admission requires non-empty `parent_task_id`, `parent_run_id`, `source_candidate_id`, `source_handoff_envelope_id`, and `source_handoff_envelope_fingerprint`, verifies that the parent task owns the parent run, and verifies that the parent run has a `SubtaskDispatchHandoffEnvelopeRecorded` event covering the child candidate and handoff envelope fingerprint.

After admission, the child uses the same Rust-owned `task.run` lifecycle as a normal `Created` task: it transitions to `Running`, records the existing permission/tool/prompt/LLM ledger sequence, and finishes with the existing terminal task status. `Completed`, `Failed`, `Cancelled`, and already `Running` tasks remain non-rerunnable.

Parent runs still do not auto-run children. `run.inspect` exposes the parent-to-child relation with `child_task_count` and `child_task_ids`, and `task.inspect` on the child exposes the child status plus parent/source provenance. M5.12 does not add scheduler auto-dispatch, external workers, process execution expansion, network bypass, service control, patch apply, direct workspace mutation paths, or a new blocked summary event wrapper.

## M5.13 parent child run result inspection

M5.13 extends parent run inspection with structured `child_tasks` summaries while preserving `child_task_count` and `child_task_ids` for compatibility. Each child summary includes the child `task_id`, child `run_id`, status, parent/source provenance, child ledger event count, whether the child agent loop completed, completion final state, a bounded completion summary preview, and the existing sanitized final response preview when available.

These summaries are derived from persisted child `TaskRecord` state and sanitized child ledger events. They do not persist or expose raw child prompts, raw provider responses, raw file contents, command strings, stdout, stderr, environment values, or serialized request bodies. Parent `task.run` still does not execute children; child execution remains limited to explicit `task.run` admission for the child task.

M5.13 adds no scheduler auto-dispatch, external workers, process execution expansion, network bypass, service control, patch apply, direct workspace mutation paths, diagnostics wrapper RPCs, or blocked summary event wrappers.

## M5.14 child task source intent materialization

M5.14 makes the controlled child `TaskRecord` semantically useful by carrying a `source_intent_summary` derived from the approved `subtask.spawn` request that led to materialization. The summary includes `tool_id`, `required_action`, bounded `request_reason`, and bounded `input_summary`; it excludes raw `input` objects and serialized request bodies.

The materialized child goal is derived from the approved request reason and stable source candidate id rather than only a generic parent/candidate wrapper phrase. `ChildTaskInspectSummary` exposes the same `source_intent_summary` through parent `run.inspect` / `task.inspect` child summaries.

M5.14 preserves duplicate prevention by source handoff envelope fingerprint, preserves explicit child `task.run` admission, and adds no scheduler auto-dispatch, external workers, process execution expansion, network bypass, service control, patch apply, direct workspace mutation paths, diagnostics wrapper RPCs, or blocked summary event wrappers.

## M5.15 structured subtask spawn child materialization

M5.15 adds bounded structured input for approved `subtask.spawn` intent. The optional input may contain only `goal` and `mode_id`; omitted input remains valid. Parser preflight rejects unknown fields, non-string fields, empty fields, oversized fields, and unsafe `mode_id` syntax before permission evaluation.

Before approval, queueing, or child materialization, the runtime resolves requested `mode_id` values against the workspace mode policy set. Unknown modes use the existing `ToolIntentDenied` event path and do not create `ToolIntentApproved`, queued subtask evidence, or child records. Valid requested inputs are persisted only as sanitized summary fields: `requested_goal_preview` and `requested_mode_id`.

Controlled child materialization uses `requested_goal_preview` as the child `TaskRecord.goal` and `requested_mode_id` as the child `TaskRecord.mode_id` when present. `run.inspect`, `task.inspect`, child `TaskStarted`, and `ChildTaskSourceIntentSummary` expose the same sanitized fields without raw `input` objects or serialized request bodies. M5.15 preserves duplicate prevention, explicit child `task.run` admission, and the no scheduler auto-dispatch / no process / no network / no service-control / no patch-apply / no direct workspace mutation boundary.

## M5.16 multi-candidate child task materialization

M5.16 extends controlled child materialization across all distinct candidates covered by one accepted `SubtaskDispatchHandoffEnvelopeRecorded` event. A handoff envelope with multiple `candidate_ids` or `blocked_candidate_ids` materializes one queued child `TaskRecord` per distinct source candidate instead of stopping after the first candidate.

Duplicate prevention is scoped to `parent_run_id + source_candidate_id + source_handoff_envelope_fingerprint`, so rerunning materialization for the same envelope reuses existing children without blocking different candidates from the same envelope. Each child keeps its own parent/source provenance, per-candidate `source_intent_summary`, sanitized `requested_goal_preview`, and sanitized `requested_mode_id` when available.

Parent `task.run` still does not run child tasks, and each child remains limited to the existing explicit queued child `task.run` admission path. M5.16 adds no scheduler handoff, external worker, process execution expansion, network bypass, service control, patch apply, direct workspace mutation path, diagnostics wrapper RPC, raw `input` persistence, or new blocked summary wrapper.

## M5.17 parent join continuation

M5.17 allows an explicit `task.run` call on a completed parent task after all controlled child tasks for that parent run have completed. The parent continuation consumes bounded `child_completion_summaries` derived from child inspection state, including child task/run IDs, source candidate IDs, source handoff envelope fingerprints, completion final state, bounded completion summary previews, and bounded final response previews.

The parent does not auto-run child tasks. Incomplete or non-controlled children reject the parent continuation before the parent status is changed to `Running`. Raw child prompts, provider responses, file content, command strings, stdout, stderr, environment values, raw tool inputs, and serialized request bodies are not exposed in the parent continuation context.

## M5.18 parent join continuation replay guard

M5.18 makes parent join continuation replay-safe. Before a completed parent is moved back to `Running`, the runtime derives a deterministic summary-safe child completion fingerprint from the controlled completed child evidence and records `ParentJoinContinuationFingerprintConsumed` for the admitted fingerprint.

Repeating `task.run` for the same parent and unchanged child completion fingerprint is rejected before another `TaskRunning` / agent-loop pass starts. A materially different controlled completed child result set produces a different fingerprint and can be admitted. This phase adds no scheduler handoff, child auto-run, external worker, process execution expansion, network bypass, service control, patch apply, direct workspace mutation path, diagnostics wrapper RPC, raw child data persistence, or blocked summary wrapper.

## M5.25 recovery-cycle child provenance inspection

M5.25 adds optional `recovery_cycle_provenance` to `TaskRecord` and `ChildTaskInspectSummary`. The field is populated only for a controlled child materialized from an accepted parent-join handoff envelope whose `parent_join_recovery_cycle` is `true`. It remains `null` for ordinary task records, initial handoff materialization, and non-recovery parent-join continuations.

`RecoveryCycleChildProvenance` contains only bounded lineage fields: `parent_join_admission_id`, `parent_join_child_completion_fingerprint`, `parent_join_child_completion_child_count`, `parent_join_terminal_failed_child_count`, `parent_join_terminal_completed_child_count`, `parent_join_recovery_cycle`, and `parent_join_recovery_cycle_depth`. `parent_join_child_completion_child_count` is the number of terminal controlled children in the parent-join evidence set, and the failed/completed counts must sum to that value. `parent_join_recovery_cycle_depth` is the recovery-cycle depth recorded by parent-join admission; it must be at least 1 when `parent_join_recovery_cycle = true` and must be 0 for non-recovery parent joins.

Accepted parent-join envelopes with `parent_join_admission_id` fail materialization if any provenance field is missing, malformed, or internally inconsistent. `parent_join_child_completion_fingerprint` must use the `sha256:<64 lowercase hex>` form, and `parent_join_admission_id` must be non-empty. The runtime does not silently create a recovery-cycle child with missing lineage.

Direct child `task.inspect` returns the field on `task.recovery_cycle_provenance`. Parent `run.inspect` and parent `task.inspect` return the same bounded object on the matching `child_tasks[].recovery_cycle_provenance` summary. Existing persisted `TaskRecord` state remains backward compatible because missing `recovery_cycle_provenance` deserializes as `null`.

M5.25 does not expose raw child prompts, raw provider responses, raw file content, command strings, stdout, stderr, environment values, raw tool input objects, serialized request bodies, raw failure payloads, or unbounded error text. It adds no scheduler handoff, child auto-run, external worker, process execution expansion, network bypass, service control, patch apply, direct workspace mutation path, diagnostics wrapper RPC, or blocked summary wrapper.
## M17.1 headless run session advance

`headless.run.advance` accepts `authorize=true`, `session_id`, optional
`advance_id`, `expected_session_sequence`, optional `max_steps` from 1 to 3,
and initial `expected_progress_fingerprint` / `expected_aggregate_sequence` for
new sessions. Session IDs and advance IDs are bounded ASCII handles. A new
session must start at sequence 1 and must match current progress. Existing
sessions must use the next sequence; the runtime derives the starting progress
guard from the prior persisted checkpoint rather than accepting caller-supplied
raw progress.

A successful call delegates to existing `headless.continue_once` behavior using
runtime-derived continuation IDs, persists a `HeadlessRunSessionCheckpoint`, and
returns `HeadlessRunAdvanceResult` with bounded session sequence, replay flag,
start/post progress handles, step counts, stop reason, checkpoint fingerprint,
next route, per-step summaries, and next action. Repeating a committed sequence
returns the persisted checkpoint with `replayed=true`; it does not duplicate
`TaskRunning`, `HeadlessContinuationDecisionRecorded`, or
`HeadlessRunSessionAdvanced` evidence. The method adds no scheduler, background
worker, automatic apply/recovery, provider execution expansion, shell/git/
network/service expansion, VSIX policy decision, or raw prompt/provider/file/
command/output/environment/path exposure.

## M17.2 headless run session drive

`headless.run.drive` accepts `authorize=true`, `session_id`, optional
`drive_id`, `expected_start_session_sequence`, optional `max_advances` from 1
to 3, and optional `max_steps_per_advance` from 1 to 3. A drive requires an
existing M17.1 session checkpoint at the expected start sequence. The runtime
derives subsequent session sequences and delegates to existing
`headless.run.advance` / `headless.continue_once` behavior; callers do not
provide per-advance progress handles or next sequence values.

A successful drive persists a `HeadlessRunSessionDriveCheckpoint` and returns
`HeadlessRunDriveResult` with bounded session/drive handles, start/end session
sequence, replay flag, budget counts, execution/replay counts, stop reason,
drive fingerprint, start/post progress handles, next route, bounded per-advance
summaries, and next action. Repeating a committed drive id returns the persisted
drive result with `replayed=true`; it does not duplicate task execution,
`HeadlessRunSessionAdvanced`, or drive evidence. The method adds no scheduler,
background worker, automatic apply/recovery, provider execution expansion,
shell/git/network/service expansion, VSIX policy decision, or raw
prompt/provider/file/command/output/environment/path exposure.
