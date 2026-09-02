# MCP Client Spec v0

Brownie Runtime owns MCP client execution. VSIX, CLI, LLM output, and
AgentModes prose do not connect to MCP servers directly and do not grant MCP
authority.

This phase implements the MCP 2026-07-28 core tools path for stdio transports:

- `tools/list`
- `tools/call`
- bounded normalized tool catalog entries
- structured Mode Pack server and tool allow-lists
- `RuntimePermissionGate` checks through `UseMcpTool`
- task-pinned catalog provenance

Deferred MCP surfaces include HTTP+SSE, Apps, Sampling, Roots, Logging, Tasks,
elicitation, OAuth browser flows, public registries, automatic server
installation, and permission inference from server text.

## Architecture

The only supported first-phase catalog path is:

`MCP server -> Rust MCP client -> tools/list -> validation -> bounded catalog -> PromptBuilder -> LLM`

`tools/call` follows the same runtime-owned controlled execution boundary. The
normal autonomous path is:

`LLM response -> brownie-tool-intent parse -> task-pinned MCP tool definition -> RuntimePermissionGate::UseMcpTool -> structured server/tool allow-list -> task-pinned catalog validation -> runtime-private server config resolution -> MCP tools/call -> bounded ToolExecutionCompleted/ToolExecutionFailed evidence -> bounded untrusted tool-result context -> next agent step`

The normalized Brownie tool id is:

`mcp.<server_id>.<tool_name>`

Every MCP request carries bounded client metadata under `_meta`:

- `io.modelcontextprotocol/protocolVersion`
- `io.modelcontextprotocol/clientInfo`
- `io.modelcontextprotocol/clientCapabilities`

When Brownie does not advertise optional MCP client capabilities, it still sends
`clientCapabilities` as an empty object. Servers that reject requests missing
required 2026-07-28 metadata are valid conformance fixtures for this contract.

Server ids and tool names are bounded ASCII identifiers. Namespace collisions,
duplicate tool names, malformed schemas, oversized schemas, protocol errors,
server failures, and timeouts fail closed.

The autonomous tool-intent path uses the same boundary. For an admitted task,
`tool.intent.parse` resolves task-pinned `ModeResolved` MCP catalog evidence,
adds only those dynamic `mcp.<server_id>.<tool_name>` tools to the evaluator,
and then runs the normal `RuntimePermissionGate` decision. MCP tools are not
statically added to the built-in registry and unknown or non-pinned MCP tool ids
remain rejected.

## Mode Pack Policy

Mode Packs may declare structured MCP server configuration and per-mode
allow-lists. The shape is:

```json
{
  "mcp_servers": {
    "github": {
      "transport": "stdio",
      "command": "/absolute/path/to/server",
      "args": ["..."]
    }
  },
  "modes": [
    {
      "mode_id": "reviewer",
      "permissions": {
        "mcp_tool_access": true
      },
      "mcp": {
        "servers": [
          {
            "id": "github",
            "tools": [
              {
                "name": "search_code",
                "side_effect": "read_only",
                "approval": "not_required",
                "idempotency": "safe",
                "retry": "policy_controlled"
              }
            ]
          }
        ]
      }
    }
  ]
}
```

`mcp_tool_access` is narrowed by Mode Pack source trust and the runtime
capability ceiling. Repository-local untrusted Mode Packs cannot grant MCP
execution. The AgentModes `mcp` group remains non-authoritative; it does not set
`mcp_tool_access`, a server/tool allow-list, or a Brownie safety policy by
itself. Legacy string allow-list entries remain readable compatibility input but
compile as unclassified prohibited policy and are denied at runtime.

## Permission Contract

An MCP tool call is authorized only when all of these are true:

- the active task mode has `mcp_tool_access`;
- the mode's compiled policy includes the server id;
- the mode's compiled policy includes the tool name for that server;
- the mode's compiled policy includes structured Brownie tool safety policy;
- the tool safety policy is `read_only`, `approval=not_required`,
  `idempotency=safe`, and `retry` is not `prohibited`;
- the server configuration exists in structured Mode Pack policy;
- the stdio server launch is performed by Brownie Runtime;
- the live catalog entry matches task-pinned catalog provenance.

MCP descriptions, schemas, server responses, command names, and AgentModes
prose are never authority sources. MCP annotations are bounded structured hints,
not authority sources. Brownie Runtime parses only boolean `readOnlyHint`,
`destructiveHint`, `idempotentHint`, and `openWorldHint` values from
`tools/list`; missing values remain unknown, and invalid known annotation field
types fail closed during catalog admission. Runtime never infers annotations
from tool descriptions or other prose.

Catalog entries include the bounded annotation payload and an
`annotation_fingerprint`. The task-pinned MCP catalog fingerprint covers those
annotation values, and `tools/call` rechecks both the live catalog fingerprint
and the per-tool annotation fingerprint before server execution. Annotation
drift therefore fails closed as catalog drift. Annotation hints can only narrow
structured Mode Pack policy: approval-free read-only execution is denied before
`tools/call` when `readOnlyHint=false`, `destructiveHint=true`,
`idempotentHint=false`, or `openWorldHint=true`. An annotation can never grant
`mcp_tool_access`, add a server/tool allow-list entry, bypass approval binding,
or widen a Brownie safety policy.

Server configuration resolution is runtime-owned and tied to the Mode Pack
activation snapshot selected at task admission. Runtime archives the
secret-bearing server configuration in a private activation snapshot store keyed
by activation fingerprint. Tool execution must not re-read the workspace
`.brownie/modepack.json` or the current active snapshot as authority for an
already admitted task. If another Mode Pack is later activated, the task still
resolves MCP configuration from its pinned activation snapshot. If that private
snapshot is missing or does not contain the pinned server/tool authority, MCP
execution fails closed; it never falls back to a different activation.

## Stdio Launch Contract

The v0 MCP transport is stdio only and launch is request-scoped. Brownie Runtime
launches only the structured command from the task-pinned trusted Mode Pack
activation snapshot. The `command` value must be an absolute path; relative
commands and PATH lookup are rejected. Arguments are fixed by the structured
server configuration and are not supplied by provider output or MCP server
text.

The child process starts with a cleared inherited environment plus only
runtime-selected deterministic values required for the protocol boundary.
Ambient Brownie Runtime environment variables, secrets, credentials, user shell
state, and workspace-specific values are not inherited. The child also starts in
a neutral runtime-selected cwd, not the admitted workspace. Servers that depend
on relative executable names, relative path arguments interpreted against the
workspace, or workspace-cwd inheritance are intentionally outside the v0
contract unless the trusted Mode Pack supplies an absolute executable and
explicit absolute or self-contained arguments.

The "trusted executable" boundary in v0 means a trusted signed/local Mode Pack
activation names an absolute executable path that Runtime may launch under the
bounded stdio contract. Brownie v0 does not add executable canonicalization,
hash allow-listing, signing verification, or binary provenance validation for
the executable itself.

Each `tools/list` or `tools/call` request owns its MCP child lifecycle. Runtime
uses null stdin after the JSON-RPC request stream, bounded response reads,
hard timeouts, process-tree termination where supported, child reaping, and
reader cleanup. Timeout, protocol failure, EOF, malformed response, and oversize
response paths fail closed and must not leave a live child process tree behind.

## Task-Pinned Provenance

At task admission, Runtime materializes bounded MCP catalog evidence in
`ModeResolved` when the mode has MCP access. The evidence includes:

- server id;
- tool name;
- input schema fingerprint;
- output schema fingerprint when available;
- bounded input schema summary for model/tool-definition materialization;
- server/config identity fingerprint;
- MCP protocol version;
- catalog fingerprint.

The ledger and prompt do not store raw server command arguments, environment
values, credentials, secret headers, absolute source paths, or unbounded schema
text. Prompt materialization may expose bounded tool id, bounded description,
and bounded input field names/types/required flags as ephemeral catalog material
below runtime safety invariants, Mode Pack permission policy, and mode
instructions. Fingerprints remain the provenance anchor; schema text and MCP
descriptions never become authority.

## Bounded Tool Result Context

Successful `tools/call` results may materialize bounded MCP text content for the
next normal agent step. This context is untrusted tool data below runtime safety
policy, task-pinned Mode Pack policy, and mode instructions. It can inform the
model's answer, but it cannot grant permissions, add tools, change server
allow-lists, activate Mode Packs, mutate workspace scope, or override recovery
and completion policy.

The v0 result-context contract is intentionally narrow:

- text content items may be included after deterministic bounding;
- content item count, materialized item count, total text chars, materialized
  text chars, per-item and total limits, truncation flags, `isError`,
  protocol status, tool status, execution status, retry policy, and the result
  fingerprint are recorded as bounded evidence;
- `ProtocolSucceeded` means a valid JSON-RPC `tools/call` response envelope with
  a complete result was received, not that the tool itself succeeded;
- `resultType="complete"` is the only v0 call result type parsed as a normal
  `CallToolResult`; absent `resultType` is accepted as backward-compatible
  `complete`; `input_required` and unknown result types fail closed without
  implementing multi-round-trip input, Elicitation, Roots, Sampling, or remote
  transport behavior;
- explicit `isError=false` or omitted `isError` is `ToolSucceeded` and may
  create `ToolExecutionCompleted` evidence;
- explicit `isError=true` is `ToolReturnedError`, creates
  `ToolExecutionFailed` evidence, may carry bounded untrusted error text
  context, and is not verification-success, task-completion, or
  completed-success replay evidence;
- unsupported, binary, resource, image, audio, or blob-like items are reduced to
  bounded metadata or fail closed before prompt materialization;
- raw JSON-RPC responses, raw schemas, raw prompts, raw provider responses,
  credentials, environment values, secret headers, absolute or canonical paths,
  and raw file content are not persisted in the ledger and are not exposed as
  authority.

The runtime keeps enough bounded, sanitized result context in durable
task-scoped evidence to replay a completed MCP call. If Brownie crashes after
`tools/call` succeeds but before the second-pass model request, resume must use
the persisted bounded result context and request fingerprint instead of
unconditionally re-running the MCP tool. A repeated request with matching
task/tool/input fingerprint reuses the completed evidence; mismatched or absent
evidence follows the normal permission and execution path or fails closed.
`ToolReturnedError`, `ProtocolFailed`, `TimedOut`, `Denied`, `Cancelled`, and
`InputRequiredUnsupported` are not success replay cache entries. Retry of
tool-error or protocol-failure evidence is allowed only by explicit policy in
later safety-policy phases.

## Failure And Replay

`tools/list` and `tools/call` failures are bounded runtime tool failures. They
do not widen policy and do not change task replay authority. JSON-RPC `error`
responses, malformed envelopes, non-string `resultType`, and unknown
`resultType` values are `ProtocolFailed`; request timeouts are `TimedOut`;
`input_required` is `InputRequiredUnsupported` in v0; malformed `CallToolResult`
bodies, including missing/non-array `content` or non-boolean `isError`, are
`Failed`. If the server catalog changes after task admission, execution is
denied unless the current entry still matches the task-pinned catalog fingerprint
evidence.

The first-phase stdio lifecycle is request-scoped. Timeout, protocol failure,
EOF, malformed response, or oversized response paths terminate the MCP child
process before returning a bounded failure. Stdio response size is enforced while
reading, not after a full line is allocated; oversized no-newline responses fail
closed without storing or logging the full response, and the reader thread and
child process tree are reclaimed. Brownie does not add a scheduler, background
polling loop, permanent MCP process, recursive self-spawn, or a second
permission system.
