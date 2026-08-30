# Mode Pack Specification v0

## Purpose

Brownie treats AgentModes as an external Mode Pack.

`brownie-modepack` manages retrieval, validation, compilation, activation, and rollback of Mode Pack snapshots.

## Core rule

Brownie executes a validated snapshot, not a live branch.

## Snapshot lifecycle

- check for a newer revision
- fetch a candidate revision
- show differences
- validate mode definitions
- compile policies
- activate the candidate
- rollback when needed

## Lock data

The active snapshot should record:

- modepack name
- repository location
- branch or tag
- commit id
- schema version
- structured MCP server configuration when present
- compilation time

## Running task rule

A running task keeps the Mode Pack snapshot selected at task start. Later Mode Pack activation applies only to new tasks unless an explicit task migration is implemented.

## M2 local runtime slice

M2 adds a local-only Mode Pack snapshot path at `.brownie/modepack.json`. The file is parsed by `brownie-modepack` and may contribute additional compiled modes to existing runtime mode paths:

- `mode.list`
- `mode.get`
- `permission.check`
- `task.start`

The M2 JSON schema is intentionally minimal:

```json
{
  "name": "local-agentmodes",
  "schema_version": 1,
  "modes": [
    {
      "mode_id": "reviewer-lite",
      "display_name": "Reviewer Lite",
      "role_definition": "Review local changes without writing files.",
      "permissions": {
        "read_only": true,
        "workspace_write": false,
        "process_exec": false,
        "network_access": false,
        "service_control": false,
        "destructive": false,
        "can_spawn_subtasks": false,
        "codebase_index": false
      },
      "completion_rules": ["Stop after reporting local review findings."]
    }
  ]
}
```

M2 does not fetch remote Mode Packs. M9.2 permits Mode Packs to opt into metadata-only codebase indexing with `codebase_index`; omitted fields default to `false` for compatibility. `task.start` stores the resolved policy summary in `ModeResolved`, and `task.run` reconstructs the policy from that ledger snapshot so later Mode Pack edits do not change already-started tasks.

MP-1 allows external Mode Packs to declare trusted `workspace_write` and
`process_exec` capability bits for editor, tester, and integrator-style modes.
`read_only` is summary metadata and must not be combined with side-effect
capabilities. Network access, service control, and destructive operations are
reserved v0 protocol fields: external Mode Packs may contain those fields for
schema compatibility, but effective runtime policy must narrow them to `false`
even for trusted local or trusted signed sources. The runtime compiles declared
grantable capability bits into effective policy data and continues to require
every side effect to pass `RuntimePermissionGate`; prompt text, role
definitions, and completion rules cannot grant capability authority.
MP-1 does not add Mode Pack entrypoint selection, AgentModes compiler expansion,
generic workspace editing, generic process execution, Git capability, delegation
execution, or Rust-owned workflow sequencing.

## MP-2 default entrypoint

MP-2 adds an optional top-level `entrypoints.default` field to the Mode Pack
schema:

```json
{
  "name": "local-agentmodes",
  "schema_version": 1,
  "entrypoints": {
    "default": "external-orchestrator"
  },
  "modes": [
    {
      "mode_id": "external-orchestrator",
      "display_name": "External Orchestrator",
      "role_definition": "Select the workflow route.",
      "permissions": {
        "read_only": true,
        "workspace_write": false,
        "process_exec": false,
        "network_access": false,
        "service_control": false,
        "destructive": false,
        "can_spawn_subtasks": false,
        "codebase_index": false
      }
    }
  ]
}
```

The default entrypoint must reference a mode in the same compiled snapshot. The
mode id reference is normalized with the same bounded ASCII shape as handoff
targets: non-empty, 64 characters or fewer, and limited to letters, digits,
`.`, `_`, and `-`. Unknown, blank, or unsupported values fail closed during Mode
Pack validation.

For the CLI primary run path, `brownie run "<objective>"` starts a headless
journey without a CLI-selected mode. The runtime resolves that omitted journey
task mode to the active Mode Pack snapshot's `entrypoints.default` when present.
If no active snapshot exists, the runtime may resolve the local workspace Mode
Pack default. If no Mode Pack is configured, the legacy built-in headless
bootstrap fallback remains `implementer`. If a Mode Pack is configured but is
invalid, stale, or lacks a usable default entrypoint, the runtime fails closed
before task creation or journey mutation instead of silently routing to a
built-in workflow. Direct low-level `task.start` omitted-mode behavior remains
the built-in runtime default policy and is not a Mode Pack workflow selector.

Active Mode Pack snapshot summaries store `default_entrypoint`, and active
compiled-policy and activation fingerprints include it. Journey start
fingerprints are computed from the runtime-resolved effective task start, so
replay and stale-conflict checks bind the same entrypoint decision instead of
letting the CLI choose or rewrite workflow policy. `ModeResolved` continues to
store the task-pinned policy and external Mode Pack provenance, and every
side-effect still passes `RuntimePermissionGate`.

## MP-3 AgentModes compatibility compiler

MP-3 adds a bounded compatibility compiler from representative AgentModes YAML
into the existing Brownie Mode Pack JSON policy model. The compiler consumes
`customModes` entries and emits the same `name`, `schema_version`,
`entrypoints.default`, and `modes` fields that `brownie-modepack` already
validates. AgentModes remains an external compatibility target; Brownie does not
vendor AgentModes, change its source format, or encode AgentModes workflow
routing decisions as Rust logic.

The compiler maps structured AgentModes groups to trusted runtime capability
bits: `read` enables read/index metadata, `edit` enables `workspace_write`,
`command` enables `process_exec`, and `mcp` is accepted without granting
network, service, destructive, or subtask authority. Role definitions,
`description`, `whenToUse`, and `customInstructions` text are preserved as
bounded workflow policy metadata; they cannot grant capabilities. The generated
Mode Pack must still pass normal Mode Pack validation, and side effects continue
to be authorized by `RuntimePermissionGate` at use time.

MP-3.1 preserves structured AgentModes group metadata instead of collapsing it
to broad booleans. Structured `edit` metadata such as `fileRegex` and
`description` compiles into `workspace_write_scopes`. If scopes are present,
workspace writes are valid only for matching workspace-relative paths. Prose
cannot widen these scopes.

MP-3.1 also prevents selection guidance and prompt prose from becoming runtime
semantics. `whenToUse` remains selection metadata and must not be emitted as a
completion rule. Role definitions and custom instructions must not infer
verification ownership, completion authority, capabilities, or delegation
authority. Delegation coordinator authority comes from structured compatibility
shape and the compiled Mode Pack mode graph; allowed targets are generated from
that graph and enforced by runtime handoff admission.

Effective external capability is bounded by declared structured groups, source
trust, and the runtime global capability ceiling. Source trust narrows
capability but never grants it. In particular, an arbitrary repository-local
Mode Pack or AgentModes source cannot self-authorize `process_exec`; trusted
local developer and trusted signed active sources may preserve declared command
capability only when the runtime global ceiling also allows it.

MP-3.2D extends this trust rule from AgentModes compilation to raw Mode Pack
ingress. Repository-local `.brownie/modepack.json` is untrusted by default and
its effective policy cannot self-authorize workspace writes, process execution,
network access, service control, destructive operations, or subtask spawning by
declaring those fields. Trusted local developer and trusted signed active Mode
Pack ingress may preserve declared side-effect capability only after the same
runtime ceiling is applied, and `RuntimePermissionGate` remains final authority
at use time. Capability narrowing happens before task policy exposure, active
snapshot evidence, and task-pinned `ModeResolved` reconstruction, so persisted
runtime policy reflects effective permissions rather than raw declared
privilege.

Compiled external modes may carry `when_to_use`, `description`,
`prompt_sections`, `workspace_write_scopes`, `allowed_handoff_targets`, and
`instruction_fingerprint`. `prompt_sections` are deterministic, bounded
instruction artifacts derived from AgentModes fields such as
`customInstructions`; each section carries a source label and content
fingerprint. Mode Pack validation accepts these fields only as policy metadata
and rejects malformed prompt sections fail-closed. The active snapshot
fingerprint includes these instruction fields so task-pinned policy, replay,
stale conflict handling, and child provenance reason about the exact workflow
instructions admitted for the task.

Active snapshot policy entries also persist `workspace_write_scopes`. Runtime
mode resolution writes those scopes into `ModeResolved`, and context
materialization renders the task-pinned scopes and handoff targets in protected
system policy. This makes prompt budgeting and prompt construction consume the
same effective policy surface as runtime permission checks.

Mode Packs may include top-level `global_policy_artifacts` for bounded workflow
policy and artifact catalogs. Each artifact has a stable category (`rule`,
`skill`, `command`, or `contract`), a normalized markdown `relative_path`, a
title, bounded content, and a content fingerprint. AgentModes skill artifacts
use the recursive `skills/**/SKILL.md` layout and are cataloged by relative path
instead of being flattened into direct `skills/*.md` files. These artifacts are
validated as protected policy metadata only. They do not grant workspace write,
process execution, network/service access, destructive operation, or subtask
authority, and they do not bypass source-trust narrowing or
`RuntimePermissionGate`.

Active snapshots include the validated `global_policy_artifacts` collection in
the compiled-policy fingerprint surface. Task admission copies the active
snapshot's artifacts into `ModeResolved` external Mode Pack provenance. Prompt
construction materializes `rule` artifacts by default as protected global policy
but does not insert unrelated `skill`, `command`, or `contract` content into
every request. Those categories remain task-pinned catalogs until selected by
structured compatibility metadata or an explicit workflow invocation path.
Running tasks therefore keep the artifact set selected at task start instead of
reading live files after admission.
MP-3.2G required compatibility tests must resolve the pinned AgentModes
baseline revision through either an explicit root or a managed temporary
checkout, then run the real compile, validation, activation, prompt, and handoff
tests with the compatibility source marked required so missing source cannot
silently skip coverage.

When no explicit compiler default entrypoint is supplied, the generated Mode
Pack selects `orchestrator` only if that slug exists. Explicit compiler defaults
must resolve to a compiled mode id. Duplicate slugs, blank required fields,
unsafe mode ids, malformed group entries, unknown groups, and unknown explicit
defaults fail closed before activation.

Active Mode Pack policy shadows built-in fallback policy for the same mode id
when a task is admitted through that active snapshot. Built-ins remain explicit
bootstrap/fallback modes only when no active Mode Pack default can select the
workflow. Brownie must not add Rust branches that encode AgentModes routing,
Git timing, verification sequencing, or completion behavior outside compiled
Mode Pack policy.

Collision precedence is deterministic: active/candidate Mode Pack validation
still rejects duplicate ids inside the Mode Pack itself, but it does not reject
ids that also exist in Brownie's built-in bootstrap registry. When such an id is
present, the runtime removes the built-in fallback entry from the effective
policy set and uses the external policy plus task-pinned provenance.

## M12.1 handoff target admission

M12.1 lets an external Mode Pack mode with `can_spawn_subtasks=true` declare an
`allowed_handoff_targets` array. The array is required for spawning external
modes, capped at 16 entries, and each target id must be non-empty, duplicate-free,
64 characters or fewer, and limited to ASCII letters, digits, `.`, `_`, and `-`.
Modes without `can_spawn_subtasks` must omit the field or leave it empty.

At runtime, `subtask.spawn` admission first uses the existing permission gate for
`SpawnSubtask`, then verifies that the requested `input.mode_id` exists and is in
the active mode policy's `allowed_handoff_targets` when that policy declares one.
Denied targets append bounded denial evidence before subtask queueing or child
materialization. Built-in modes keep unrestricted legacy handoff behavior by
storing no target allow-list.

## M12.2 controlled child snapshot provenance

M12.2 carries the external Mode Pack policy boundary from parent admission into
controlled child execution. When a child task is materialized from an external
Mode Pack handoff target, the child `TaskStarted` evidence stores bounded
`external_modepack_child_provenance`: source kind, Mode Pack name, schema
version, workspace-relative Mode Pack path, child mode id, policy fingerprint,
parent run id, and handoff envelope identifiers.

`task.run` validates that provenance before recording `TaskRunning` for the
queued child. Missing, malformed, stale, or mismatched external Mode Pack child
provenance is denied before provider or tool execution. The denial evidence is
bounded and must not include raw Mode Pack JSON, raw prompts, provider
responses, file content, stdout, stderr, commands, environment values, secrets,
request bodies, absolute paths, or canonical paths.

## MCP policy

Mode Packs may declare first-phase MCP access with a top-level `mcp_servers`
map and per-mode `mcp.servers[].tools` allow-lists. Only `stdio` transport is
valid in v0. Server ids and tool names are bounded identifiers, and duplicate,
unknown, malformed, or oversized entries fail closed during Mode Pack
validation.

The mode permission bit is `mcp_tool_access`. It is narrowed by source trust and
the runtime capability ceiling. Untrusted repository-local Mode Packs cannot
grant MCP execution even if they declare `mcp_tool_access` and allow-listed
tools. AgentModes `mcp` groups remain candidates/prose only unless a structured
Mode Pack MCP server/tool allow-list exists.

Mode Pack MCP server command configuration is structured runtime policy. It is
not prompt authority, and raw command configuration, credentials, environment
values, or secret headers must not be copied into prompt, ledger, or RPC
evidence. Task admission stores bounded catalog provenance instead; see
`mcp-client-spec-v0.md`. Running task execution resolves MCP configuration from
the runtime-owned active snapshot identity selected at task start, not by
re-reading the live workspace Mode Pack file.

## Non-goals for v0

- Vendoring AgentModes into Brownie.
- Changing active mode definitions during a running task.
