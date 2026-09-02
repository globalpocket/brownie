# Brownie Tool Execution Spec v0

## Phase 1.7 scope

Phase 1.7 introduces the minimum read-only execution foundation. The only executable tool in that slice is `workspace.read`. Later phases add fixed controlled verifier tools and M9.5 adds `codebase.index.selection.read` as an index-bound read path under the same `tool.execute` RPC.

All write, patch, process, subtask, network, service-control, and destructive tools remain non-executable. `task.run` continues to parse and dry-run evaluate assistant tool intents, but it does not automatically execute tools.

## `tool.execute`

`tool.execute` is a standalone JSON-RPC method for explicit tool execution. Because it has no task context in Phase 1.7, callers must provide `mode_id` so the runtime can evaluate the request through `RuntimePermissionGate` before any execution dispatch.

Controlled tool execution is a Brownie Runtime responsibility only for bounded
local capabilities and generic protocol contracts. Hosted schedulers, daemon
processes, forge apps, notification systems, SIEM/OTel exporters, tenant
operations, and broad language adapter catalogs are External Control Plane or
External Adapter responsibilities under
`runtime-boundary-and-release-dod-spec-v0.md`.

Example request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tool.execute",
  "params": {
    "mode_id": "orchestrator",
    "tool_id": "workspace.read",
    "input": { "path": "README.md" }
  }
}
```

Unknown `mode_id` is rejected as invalid params (`-32602`). Permission denial returns a tool result with status `Denied` and a reason in `output`.

## `workspace.read`

Input:

```json
{ "path": "README.md" }
```

Completed output:

```json
{
  "path": "README.md",
  "content": "...",
  "truncated": false,
  "bytes_read": 123
}
```

Large files are capped at 65536 bytes and return `truncated: true`.

## Workspace boundary and protected paths

`workspace.read` treats `path` as workspace-root relative. Absolute paths, `..` path traversal, and symlink targets are rejected. The runtime canonicalizes both workspace root and target path, then rejects any target outside the workspace root.

Phase 1.7 does not list directories. It rejects protected workspace paths under `.git`, `.brownie`, `node_modules`, and `target`. `.brownie` is protected because run ledgers and internal runtime state require explicit future diagnostics rather than broad tool access.

Binary or invalid UTF-8 files fail safely instead of returning raw bytes.

## M9.5 codebase index selection read

M9.5 adds one controlled built-in read tool, `codebase.index.selection.read`.
It does not add a JSON-RPC method; callers invoke it through `tool.execute`.
The tool requires the normal `ReadWorkspace` permission through the built-in
tool registry, then the Rust runtime performs a secondary
`RuntimeAction::IndexCodebase` check before reading current index state or file
content.

The input binds one requested `read_path` to a prior `codebase.index.query`
selection handle: query id, selection id, query fingerprint, snapshot identity
and fingerprints, bounded selected entries, max result bound, and optional file
kind filter. The runtime recomputes the selection fingerprint from the supplied
entries, requires a matching `CodebaseIndexQueryCompleted` ledger event, then
re-reads the current snapshot and verifies the selected entry metadata and
content SHA-256 before returning content.

Successful output returns bounded UTF-8 content for exactly one selected file,
read byte counts, query/selection/snapshot fingerprints, content-hash
verification status, `ledger_event_kind =
"CodebaseIndexSelectionReadCompleted"`, and
`next_action = "use_selected_file_context_for_prompt_materialization"`.

Successful index-read ledger payloads are summary-only. They may contain ids,
fingerprints, counts, byte counts, file kind, content SHA-256, hash-verification
status, truncation status, and a read-path fingerprint. They must not contain
raw query text, selected raw paths, raw file content, snippets, diffs,
stdout/stderr, environment values, commands, prompts, provider responses,
absolute paths, canonical paths, or secrets.

## M9.6 selected index context in task prompts

M9.6 does not add another executable tool. It lets the existing `task.run` path
consume one optional selected-read result after the selected read has already
completed through `tool.execute(codebase.index.selection.read)`. The runtime
revalidates the selected-read result against `CodebaseIndexSelectionReadCompleted`
evidence before task admission, requires the task mode to allow both
`ReadWorkspace` and `IndexCodebase`, and fails before `TaskRunning` on missing,
stale, unsafe, truncated, mismatched, or tampered context.

Successful task runs may place raw selected file content in the in-memory prompt
only. Task ledger events, prompt-preview payloads, task-run result summaries,
diagnostics, and VSIX protocol validators must remain summary-only and must not
persist raw selected paths or raw selected file content.

## Ledger behavior

The store defines task-scoped event kinds: `ToolExecutionRequested`,
`ToolExecutionPermissionChecked`, `ToolExecutionCompleted`,
`ToolExecutionDenied`, and `ToolExecutionFailed`.

Standalone `tool.execute` does not write run ledger events in Phase 1.7 because
it is not attached to a task/run. Task-scoped execution during `task.run` uses
these event kinds for controlled workspace reads, fixed verification tools, and
task-pinned MCP tools.

## MCP tools

MCP tools use the same `tool.execute` boundary with normalized ids of the form
`mcp.<server_id>.<tool_name>`. Unlike older standalone native tool calls, MCP
execution requires `task_id` so Runtime can use the task-pinned `ModeResolved`
policy and MCP catalog provenance admitted for that task.

## MP-7 Git tools

MP-7 adds dedicated runtime-owned Git controlled tools instead of allowing
generic shell Git execution. `git.status` and `git.diff` run fixed bounded
inspection commands in the admitted workspace repository and return sanitized
summary metadata plus bounded untrusted Git result context only.

`git.status` and `git.diff` require `UseGitInspectCapability`; `git.commit`
requires `UseGitCommitCapability`. Neither Git capability implies the other,
and `process_exec` grants neither. `git.status` and `git.diff` do not accept
caller-supplied argv, cwd, environment, stdin, shell, timeout, path, branch,
ref, revision, remote, push, or PR fields. The runtime resolves the admitted
workspace repository, rejects non-repositories fail-closed, and launches only
the fixed inspection command for the requested controlled capability.
`git.status` disables repository-local FSMonitor with command-level
`-c core.fsmonitor=false`. `git.diff` disables repository external helpers with
`--no-ext-diff` and `--no-textconv`. Their successful result contains a nested
`git` block with operation, result fingerprint, summary line counts,
materialized summary line counts, bounded summary lines, maximum line and item
limits, truncation evidence, and explicit evidence that raw diffs, raw file
content, and absolute paths were redacted. That nested block may be materialized
for the next agent step as `untrusted_git_result_context`; it is tool data below
runtime safety policy and Mode Pack permission policy and never grants
authority.

Git inspection process execution is bounded while output is being read. The
runtime starts the child with null stdin and a hardened Git environment that
disables prompts, askpass helpers, pager behavior, optional locks, system/global
config, and caller environment inheritance except the minimum executable lookup
needed to launch Git. Stdout and stderr are captured with a shared aggregate
byte ceiling. Timeout and oversize paths fail closed, attempt process-tree
termination where supported, reap the child, join reader threads, and store only
bounded lifecycle metadata such as timeout/oversize booleans, process-tree kill
attempt evidence, reader-thread join evidence, hardened-environment evidence,
and duration. Raw stdout, stderr, command strings, argv, environment values,
absolute paths, canonical paths, credentials, secrets, raw diffs, and raw file
content are not persisted.

`git.commit` creates a local commit only from runtime-authorized workspace
mutation evidence in the admitted repository. Its provider/tool-intent input is
limited to a bounded `message` string; callers cannot provide argv, cwd,
environment, stdin, shell, timeout, remote, path, branch, ref, revision, push,
PR, branch deletion fields, or commit authorization. Before execution, Runtime
builds the private commit authorization from task-pinned policy and durable
workspace proposal/apply evidence. The authorization binds the originating
task/run/journey, proposal and apply ids, workspace-relative path set,
post-apply content fingerprints or delete evidence, applicable workspace-write
scope fingerprint, expected parent HEAD, and logical Git invocation identity.
If this provenance is missing, malformed, stale, or inconsistent with the
current workspace, `git.commit` fails closed.

`git.commit` ignores the ambient Git index. Mutation uses a runtime-owned
temporary index and Git plumbing: the parent tree is read into that index,
authorized path blobs/removals are written into it, `write-tree` produces the
candidate tree, `commit-tree` creates the commit with a Brownie
commit-intent trailer bound to the logical invocation fingerprint, and
`update-ref` performs a stale-checked branch update against the expected parent
HEAD. Repository hook lifecycles such as `pre-commit`, `prepare-commit-msg`,
`commit-msg`, and `post-commit` must not run. Runtime records sanitized
metadata such as message fingerprint, commit id, authorized change-set
fingerprint, workspace-write scope fingerprint, expected parent HEAD,
committed tree fingerprint, replay status, bounded process telemetry, temporary
index use/cleanup, and hook-bypass evidence. Raw diffs, raw file content, raw
commit message text, raw command strings, argv, stdout, stderr, environment
values, absolute paths, canonical paths, credentials, and secrets must not be
stored in ledger evidence.

Successful commit execution writes the Brownie commit-intent trailer so retry
after a lost response can recognize the same logical invocation and return
replay evidence without creating a duplicate commit. A later agent step with a
new runtime-authorized change set and the same message has a different logical
invocation identity and may create a new commit. This is local repository
mutation only; remote Git operations remain out of scope.

Runtime denies MCP execution when the task is unknown, the mode lacks
`UseMcpTool`/`mcp_tool_access`, the server/tool pair is absent from the compiled
Mode Pack allow-list, the structured server configuration is missing, or the
current `tools/list` catalog no longer matches the task-pinned schema/config
fingerprints. `tools/call` is attempted only after those checks pass.

MCP stdio server launch is runtime-owned and request-scoped in this phase. MCP
server descriptions, schemas, command names, response text, and AgentModes prose
cannot grant permission or widen tool routing authority. Successful MCP tool
results may contribute bounded text result context to the next agent step as
untrusted data, with result fingerprints, request fingerprints, item counts,
text limits, and truncation evidence. Raw JSON-RPC responses, server
configuration, credentials, environment values, secret headers, raw schemas,
prompts, provider responses, absolute paths, canonical paths, and raw file
content are not ledger authority or prompt authority. See
`mcp-client-spec-v0.md`.

MCP-S1 separates JSON-RPC protocol success from MCP tool success without
changing the external `ToolExecuteStatus` enum. A valid `tools/call` envelope
with a result is `ProtocolSucceeded`; only an explicit `isError=false` result is
`ToolSucceeded` and may emit `ToolExecutionCompleted`. An explicit
`isError=true` result is `ToolReturnedError`: the runtime emits
`ToolExecutionFailed` with bounded MCP error context, does not treat it as
verification or completion evidence, and does not place it in the completed
success replay cache. JSON-RPC `error` responses are `ProtocolFailed`, request
timeouts are `TimedOut`, and malformed result bodies are `Failed`. Retry remains
policy-controlled and must not be inferred from the MCP result text.

## Phase 1.8 task-scoped read-only execution

Phase 1.8 introduces task-scoped execution for approved assistant `workspace.read` tool intents only. Assistant tool intent requests may include an `input` object; omitted input is treated as `{}`, and non-object input is rejected before permission evaluation.

During `task.run`, denied intents, rejected intents, and non-read tool intents are not executed. Even if another tool intent is permission-approved for planning or policy purposes, Phase 1.8 does not execute write, process, subtask, network, service, or destructive operations.

For approved `workspace.read` intents with explicit `input.path`, the runtime records `ToolExecutionRequested`, `ToolExecutionPermissionChecked`, and one terminal `ToolExecutionCompleted`, `ToolExecutionDenied`, or `ToolExecutionFailed` ledger event. The ledger stores execution metadata and a bounded output preview only; full file content is not persisted to the ledger. `task.run` remains `Completed` even if this read-only execution fails in Phase 1.8.

## Phase 1.9 tool feedback loop

Phase 1.9 introduces a second-pass Fake LLM feedback loop inside `task.run` after an approved `workspace.read` execution completes. The runtime re-reads the task ledger, materializes the tool execution summary into the next prompt, builds a second-pass prompt, and records `SecondPassPromptBuilt`, `SecondPassLlmRequestCreated`, and `SecondPassLlmResponseReceived` ledger events.

The second pass runs only when at least one `ToolExecutionCompleted` event exists. `workspace.read` results are summarized into prompt materialization as metadata such as status, `bytes_read`, and `truncated`; full file content is not persisted in the ledger. Phase 1.9 does not add write, process, network, service-control, destructive, or subtask execution, and it continues to use only the in-process Fake LLM.

## M7.1 controlled cargo fmt verification execution

M7.1 adds one executable verifier: `verification.cargo_fmt_check`. It requires `RuntimeAction::ExecuteProcess`, but it does not make generic `process.exec` executable. The fixed verifier runs exactly `cargo fmt --check` from the workspace root. Its input may be `{}` or `{ "check_id": "cargo_fmt_check" }`; command, argv, args, cwd, env, stdin, shell, timeout, timeout_ms, and unknown fields are rejected before launch.

Standalone `tool.execute` may execute `verification.cargo_fmt_check` when the selected mode has `ExecuteProcess` permission. Task-scoped assistant intents use the same executor and record `ToolExecutionRequested`, `ToolExecutionPermissionChecked`, and a terminal `ToolExecutionCompleted`, `ToolExecutionDenied`, or `ToolExecutionFailed` event. Modes without `ExecuteProcess` record denial without launching a process.

Verifier output and ledger payloads are bounded metadata only: `check_id`, `verification_status`, `process_launched`, `exit_code`, `timed_out`, `duration_ms`, `standard_output_bytes`, `standard_error_bytes`, truncation flags, `output_redacted`, and a bounded reason when applicable. Raw stdout, stderr, command strings, raw input JSON, environment values, stdin, file content, canonical paths, absolute paths, shell execution, git execution, network access, service control, and arbitrary test execution remain out of scope.

## M7.2 controlled cargo check verification execution

M7.2 adds the second executable verifier: `verification.cargo_check`. It requires `RuntimeAction::ExecuteProcess`, reuses `tool.execute` and task-scoped `task.run`, and still does not make generic `process.exec` executable. The fixed verifier runs exactly `cargo check --workspace --all-targets --locked --offline`. Its input may be `{}` or `{ "check_id": "cargo_check" }`; command, argv, args, cwd, env, stdin, shell, timeout, timeout_ms, package, features, target, path, and unknown fields are rejected before launch.

The runtime preflight requires workspace `Cargo.toml` and an existing `Cargo.lock`, and rejects `build.rs` files in this phase so caller-requested compilation cannot execute build scripts. Cargo check uses a runtime-owned isolated target directory outside the workspace, sets Cargo dependency-fetch offline mode, removes the isolated target directory after execution, and never stores the isolated path or environment values in RPC responses or ledger payloads.

Verifier output and ledger payloads remain bounded metadata only. In addition to the M7.1 verifier fields, `verification.cargo_check` may expose `target_dir_isolated`, `cleanup_succeeded`, `cargo_dependency_fetch_offline`, `os_network_isolated`, `compile_time_code_sandboxed`, and `trusted_workspace_required`. Cargo offline mode must not be reported as OS-level network isolation. Raw stdout, stderr, command strings, raw input JSON, environment values, target directory paths, stdin, file content, canonical paths, absolute paths, shell execution, git execution, network access, service control, arbitrary caller-selected tests, and workspace mutation remain out of scope.

## M29.1 controlled cargo test verification execution

M29.1 adds the third executable verifier: `verification.cargo_test`. It requires `RuntimeAction::ExecuteProcess`, reuses `tool.execute` and task-scoped `task.run`, and still does not make generic `process.exec` executable. The fixed verifier runs exactly `cargo test --workspace --all-targets --locked --offline`. Its input may be `{}` or `{ "check_id": "cargo_test" }`; command, argv, args, cwd, env, stdin, shell, timeout, timeout_ms, package, packages, feature, features, target, test, test_name, path, filter, nocapture, ignored, release, jobs, profile, manifest_path, and unknown fields are rejected before launch.

The runtime preflight requires workspace `Cargo.toml` and an existing `Cargo.lock`. Cargo test uses a runtime-owned isolated target directory outside the workspace, sets Cargo dependency-fetch offline mode, applies the existing bounded timeout and process-tree timeout handling, removes the isolated target directory after execution, and never stores the isolated path or environment values in RPC responses or ledger payloads.

Verifier output and ledger payloads remain bounded metadata only. In addition to the M7.1 verifier fields, `verification.cargo_test` may expose `target_dir_isolated`, `cleanup_succeeded`, `cargo_dependency_fetch_offline`, `os_network_isolated`, `compile_time_code_sandboxed`, `test_code_executed`, and `trusted_workspace_required`. Because workspace tests execute trusted workspace code, launched runs report `test_code_executed=true`; rejected or denied requests do not claim execution. Cargo offline mode must not be reported as OS-level network isolation, and no compile-time sandbox is claimed. Raw stdout, stderr, command strings, raw input JSON, environment values, target directory paths, stdin, file content, canonical paths, absolute paths, shell execution, git execution, network access, service control, caller-selected tests, and workspace mutation remain out of scope.

## M30.1 bounded cargo test failure diagnostics

M30.1 allows launched failed `verification.cargo_test` runs to attach bounded `bounded_cargo_diagnostics` to the existing tool result and ledger payload. The verifier may expose at most five entries. A cargo-test diagnostic may contain only `tool_id`, `check_id`, `diagnostic_kind`, `severity`, `test_name_hash`, optional sanitized `workspace_relative_path`, optional `line`, optional `column`, and `truncated`. Test names are stored only as deterministic SHA-256 fingerprints. Raw stdout, stderr, rendered panic messages, assertion values, source snippets, raw test names, command strings, argv, environment values, absolute paths, canonical paths, and file content remain forbidden.

## M7.3 verification evidence completion gate

M7.3 keeps controlled verifier execution on existing runtime surfaces and does not add a new RPC. During `task.run`, the runtime treats task-scoped `verification.cargo_fmt_check`, `verification.cargo_check`, and `verification.cargo_test` intents as required verification evidence for that run. Before `AgentLoopCompleted` and terminal task status are recorded, the runtime re-reads the run ledger and requires each requested verifier to have a fresh terminal `ToolExecutionCompleted` event with `verification_status = "Passed"`.

If the required verifier evidence is denied, rejected, failed, timed out, spawn-failed, missing, malformed, or stale, the task terminal status becomes `Failed` and the terminal `TaskFailed` event records bounded gate metadata: `verification_completion_gate_status`, verifier counts, verifier tool id lists, bounded failure reasons, and `next_action`. Passing evidence records the same bounded gate metadata on `TaskCompleted` and returns `verification_completion_gate` in the existing `task.run` result. The gate never stores or returns raw stdout, stderr, command strings, raw input JSON, environment values, target directory paths, stdin, file content, absolute paths, canonical paths, prompts, provider responses, secrets, or arbitrary process metadata.

## R3.1 verifier integrity metadata and timeout containment

R3.1 corrects the existing controlled verifier result contract without adding a new RPC. Controlled verifier outputs include bounded process-tree timeout metadata: `process_tree_timeout_supported`, `process_tree_kill_attempted`, `process_tree_kill_succeeded`, and `process_tree_kill_reason`. On Unix, the runtime launches verifier commands in a process group and attempts to terminate that group on timeout. On unsupported platforms, the runtime reports `process_tree_timeout_supported=false` and keeps the timeout result bounded.

`verification.cargo_check` reports Cargo offline dependency-fetch behavior separately from stronger sandbox guarantees: `cargo_dependency_fetch_offline=true`, `os_network_isolated=false`, `compile_time_code_sandboxed=false`, and `trusted_workspace_required=true`. The verifier still rejects `build.rs` workspaces in this phase, but it does not claim compile-time code sandboxing. Runtime event sanitization and VSIX protocol validation admit only these bounded fields and reject raw process data or the legacy `network_disabled` overclaim.
