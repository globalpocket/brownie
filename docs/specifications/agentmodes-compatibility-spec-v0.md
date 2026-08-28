# AgentModes Compatibility Specification v0

## Purpose

Brownie must run AgentModes configuration with stable, runtime-enforced semantics.

AgentModes is an external compatibility target. It is not vendored into the Brownie repository.

## Pipeline

```text
AgentModes files
  -> ParsedMode
  -> ValidatedMode
  -> CompiledModePolicy
  -> AgentLoop / ToolRouter / PromptBuilder
```

The agent loop must never read raw mode files directly. It must consume compiled policy.

## Policy dimensions

A compiled mode policy must eventually represent:

- mode id
- display name
- role definition
- prompt sections
- allowed tools
- side-effect permissions
- file edit permission
- command execution permission
- network/service control permission
- subtask permission
- allowed handoff targets
- completion rules
- verification responsibility

## Permission model

Runtime permission is stronger than prompt instruction.

If a mode is read-only, workspace write tools must be rejected even if the LLM requests them.

If a mode is verification-only, edits must be rejected unless the mode policy explicitly allows corrective edits.

## Validation

Mode validation must check at minimum:

- duplicate mode ids
- missing required fields
- unknown tool names
- invalid handoff targets
- invalid permission combinations
- completion rule references to unavailable tools

## Compatibility tests

Brownie must maintain golden tests for representative AgentModes files.

The tests should verify that the same input mode definitions compile to stable runtime policies.

## Non-goals for v0

- Rewriting AgentModes format.
- Embedding AgentModes repo into Brownie.
- Runtime mutation of active mode definitions inside a running task.

## Phase 1.3 built-in mode policy baseline

Phase 1.3 does not implement AgentModes YAML parsing, Mode Pack fetching, validation, or activation. Instead, the runtime uses a static built-in stub mode registry as the compatibility bridge before the full parser exists.

The built-in registry resolves `mode_id` values into `CompiledModePolicy` records. The required Phase 1.3 modes are `orchestrator`, `implementer`, and `verifier`. Unknown mode IDs are rejected by runtime entry points that require an executable policy.

Runtime permissions are modeled as policy data so later phases can enforce them outside of LLM instructions. Permission policy remains authoritative over prompt text.

## MP-1 external side-effect capabilities

External Mode Pack policies may compile `workspace_write` and `process_exec`
bits into `CompiledModePolicy` for editor, tester, and integrator-style modes.
The compiled permission bits, not the prompt text, role definition, or completion
rules, decide whether `RuntimePermissionGate` allows workspace writes or process
execution. External network access, service control, and destructive capability
requests remain invalid and fail closed during Mode Pack validation.

## MP-2 default entrypoint compatibility

Active Mode Packs may now provide a top-level `entrypoints.default` mode id. The
entrypoint is validated against the compiled snapshot and then stored in the
active snapshot summary and fingerprints. For `brownie run "<objective>"`, the
CLI leaves the entry mode omitted and the runtime resolves the headless journey
start to the active Mode Pack default when one exists. This keeps AgentModes
workflow selection in Mode Pack policy while the CLI remains transport glue.

The resolved entry mode is captured in the journey start fingerprint and in the
task's `ModeResolved` evidence. Replaying the same journey therefore reuses the
same runtime-owned decision without duplicate admission, and later changes to a
live `.brownie/modepack.json` cannot rewrite the task-pinned policy. If no Mode
Pack default is available, Brownie keeps its built-in fallback behavior.

## MP-3 AgentModes compatibility compiler

Brownie now accepts representative AgentModes YAML as compatibility input and
compiles it into the stable Brownie Mode Pack policy shape. The compiler reads
`customModes` entries with `slug`, `name`, `roleDefinition`, `whenToUse`,
`description`, `groups`, and `customInstructions`; it does not rewrite the
AgentModes format or vendor the AgentModes repository.

Only structured AgentModes `groups` grant runtime capabilities. `read` grants
metadata-only workspace read/index capability, `edit` grants trusted workspace
write capability, `command` grants trusted process execution capability, and
`mcp` grants no Brownie runtime side-effect capability in v0. Prompt prose,
role definitions, custom instructions, and completion text remain workflow
policy data and cannot grant write, command, network, service, destructive, or
subtask authority. The compiled JSON must still pass Mode Pack validation, and
every side effect remains subject to `RuntimePermissionGate`.

If no explicit compiler default entrypoint is provided, the compiler selects
`orchestrator` when that AgentModes slug exists. Explicit defaults must refer to
a compiled mode id and use the same bounded ASCII identifier shape as other Mode
Pack references. Unknown groups, malformed group entries, duplicate slugs,
missing required fields, unsafe identifiers, and unknown explicit defaults fail
closed.

MP-3.1 narrows the compiler boundary for real AgentModes execution semantics.
`whenToUse` is selection guidance and must not compile into completion rules.
Free-form role text and custom instructions must not create verification
ownership, completion behavior, side-effect capability, or delegation authority.
Those prose fields are protected prompt policy only.

The compiled policy preserves AgentModes workflow prose as bounded policy data:
`when_to_use`, `description`, `prompt_sections`, and an instruction fingerprint.
`customInstructions` is compiled into prompt sections with deterministic
fingerprints. These fields are snapshotted in `ModeResolved`, reconstructed by
`task.run`, and included in the active policy fingerprint so replay and
task-pinned execution cannot silently switch workflow instructions after task
admission.

Structured AgentModes group metadata is preserved. A structured `edit` group may
compile `workspace_write_scopes`, including `fileRegex` and `description`.
`workspace_write=true` only grants write authority inside the compiled static
scope when scopes are present; writes outside the scope are denied by runtime
permission checks. Later delegated dynamic scopes must narrow this static scope,
not widen it.

AgentModes coordinator compatibility is derived from structured source shape,
not mode-id special cases or prose keywords. A mode with no side-effect groups
may compile as a delegation coordinator with `can_spawn_subtasks=true` and an
`allowed_handoff_targets` set derived from the compiled Mode Pack mode graph.
Requested child modes are still admitted by Rust against the task-pinned policy
and target allow-list.

Effective capability is the intersection of declared AgentModes groups, source
trust, and the runtime global capability ceiling. Trusted local developer and
trusted signed active Mode Pack sources may preserve declared process execution
when the global ceiling allows it. Untrusted repository-local AgentModes or Mode
Packs cannot self-authorize process execution even when they declare `command`.
The trust classification is separate from permission: it narrows compiled
capability but does not itself grant any capability absent from structured
groups.

Prompt materialization must carry compiled AgentModes instructions into the
protected system-policy region, separate from task/objective text. Prompt
precedence is: runtime safety invariants, compiled Mode Pack permission policy,
compiled mode instructions, then task/objective input. Prompt prose can shape
workflow behavior, but it never grants side-effect permission; groups compile
capability bits and `RuntimePermissionGate` remains the final authority.

When an active Mode Pack defines a mode id that also exists as a built-in
fallback, the active Mode Pack policy is the runtime-selected policy for that
task. Built-in modes remain bootstrap/fallback policy only when no applicable
active Mode Pack entrypoint exists. Configured-but-invalid AgentModes or Mode
Pack entrypoints fail closed during validation instead of silently falling back
to a built-in implementer workflow.

This collision rule is required for real AgentModes compatibility because
`orchestrator` is both a Brownie bootstrap id and an AgentModes workflow id. The
runtime must preserve AgentModes `orchestrator` instructions, permissions,
handoff targets, and provenance in `ModeResolved` instead of substituting the
built-in role text.

## M12.1 handoff target compatibility

`CompiledModePolicy` now carries optional `allowed_handoff_targets` evidence for
external Mode Pack modes that can spawn subtasks. The field is compiled from the
Mode Pack snapshot, stored in `ModeResolved`, and reconstructed during
`task.run`, so handoff admission follows the policy captured when the task
started instead of later edits to `.brownie/modepack.json`.

For a `subtask.spawn` tool intent, Rust admits a requested child only when the
active mode can spawn subtasks, the requested child mode resolves, and the child
mode id is present in the active policy's allow-list when one exists. Built-in
modes preserve their existing behavior by leaving the allow-list unset.

## M12.2 child snapshot provenance compatibility

Controlled children spawned through external Mode Pack handoff targets carry a
bounded snapshot identity for the child mode policy. The identity is a runtime
fingerprint over normalized compiled policy data and Mode Pack metadata, not raw
Mode Pack content. `task.run` validates the fingerprint before a queued child
can enter `TaskRunning`, so later edits to `.brownie/modepack.json` cannot
silently change the child policy admitted by the parent handoff.

This compatibility layer still does not fetch remote Mode Packs, activate
registries, run automatic child execution, or let the VSIX decide policy.

## Phase 1.4 permission gate update

Phase 1.4 adds the `RuntimePermissionGate` foundation. Runtime permission checks are based on compiled mode policy capabilities and override LLM instructions.

Runtime actions are `ReadWorkspace`, `WriteWorkspace`, `ExecuteProcess`, `AccessNetwork`, `ControlService`, `DestructiveOperation`, `SpawnSubtask`, and `IndexCodebase`. Phase 1.4 records permission decisions only; it does not execute real tools, write files, apply patches, execute processes, call real LLM APIs, parse AgentModes YAML, fetch Mode Packs, or implement Qdrant/llama-server/indexer behavior.

The runtime protocol includes `permission.check`. Task runs append `PermissionChecked` ledger events for minimum checks and append `PermissionDenied` when a checked action is denied. `ModeResolved` stores a full permission snapshot so prompt materialization can summarize active mode capabilities.

M15.1 reuses the same runtime permission gate at apply time. `proposal.apply`
must reconstruct the source run's stored mode policy and check
`WriteWorkspace` before any workspace mutation begins. Denial is fail-closed and
records bounded permission evidence; the VSIX remains display/protocol glue and
does not decide whether an apply is allowed.
