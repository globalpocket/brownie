# AgentModes Compatibility Specification v0

## Purpose

Brownie must run AgentModes configuration with stable, runtime-enforced semantics.

AgentModes is an external compatibility target. It is not vendored into the
Brownie repository. The current compatibility baseline is
`globalpocket/AgentModes` at
`c48df6c6975b3597b97e75abbbd84bc9ab314ab9`, which is the AgentModes v2 Core
layout. Required compatibility tests must resolve exactly that revision, using
either an explicit root or a managed temporary checkout, and fail rather than
silently skipping real compatibility coverage when the source tree is missing or
at another revision.

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
requests remain reserved v0 protocol fields and fail closed in effective Mode
Pack policy, including trusted active snapshots and untrusted repository-local
ingress. AgentModes rules, skills, commands, contracts, prose, or groups cannot
grant these reserved capabilities.

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

Brownie accepts AgentModes YAML as compatibility input and compiles it into the
stable Brownie Mode Pack policy shape. The legacy v1 path reads `customModes`
entries with `slug`, `name`, `roleDefinition`, `whenToUse`, `description`,
`groups`, and `customInstructions`. The current v2 workspace framework path
prefers `workflow.yaml`, reads each mode's bounded Markdown `prompt_file`, and
collects bounded policy artifacts from `schemas/*.yaml` and
`runtime-policies/brownie/*.yaml`. The older `core/*.yaml` compiler remains a
fallback for checked-out v2 Core revisions without `workflow.yaml`. Brownie does
not rewrite the AgentModes format or vendor the AgentModes repository.

Only structured AgentModes `groups` grant runtime capabilities. `read` grants
metadata-only workspace read/index capability, `edit` grants trusted workspace
write capability, `command` grants trusted process execution capability, and
`mcp` grants no Brownie runtime side-effect capability in v0. Prompt prose,
role definitions, custom instructions, and completion text remain workflow
policy data and cannot grant write, command, network, service, destructive, or
subtask authority. The compiled JSON must still pass Mode Pack validation, and
every side effect remains subject to `RuntimePermissionGate`.

If no explicit compiler default entrypoint is provided, the legacy v1 compiler
selects `orchestrator` when that AgentModes slug exists. For AgentModes v2 Core,
the default is `core.orchestrator` when present. Explicit defaults must refer to
a compiled mode id and use the same bounded ASCII identifier shape as other Mode
Pack references. Unknown groups, malformed group entries, duplicate slugs or role
ids, missing required fields, unsafe identifiers, and unknown explicit defaults
fail closed.

AgentModes v2 roles are single-pass role contracts. Their `permissions.read`
field may compile to metadata/index read capability, `permissions.edit` may
compile to workspace write only when runtime ceilings allow it, and
`permissions.command` may compile to process execution only for trusted source
classes and runtime ceilings. `git`, `network`, and `mcp` are runtime-owned or
reserved authority in the v2 Core compatibility path and do not grant Brownie
side effects. `phase_write=true` or `dispatch=true` in a v2 role fails closed.
The open-source v2 Core baseline contains only read-only/reporting roles
(`core.orchestrator`, `core.reviewer`, and `core.reporter`); member-only
development pack roles must not be assumed present by Brownie compatibility
tests.

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

MP-3.2C verifies that real AgentModes orchestrator-sized prompt policy can
reach provider request creation through ordinary omitted-budget task execution.
The CLI does not choose an AgentModes-specific prompt size and does not inject a
fixed `4096` prompt budget for normal `brownie run` or compatible resume paths.
Instead, the runtime fits the protected AgentModes policy and task objective
against the resolved provider prompt budget while keeping ledger/RPC evidence
bounded. Explicit smaller caller budgets remain valid protocol input, but they
fail closed rather than dropping runtime policy, task-pinned Mode Pack policy,
or compiled AgentModes instructions.

MP-3.2F adds a bounded policy artifact surface for real AgentModes content
outside mode role YAML. The legacy v1 compiler may collect markdown artifacts
from `rules`, `commands`, `docs/contracts`, and recursive `skills/**/SKILL.md`.
The v2 Core compiler also collects YAML artifacts from `schemas` and
`runtime-policies/brownie`. Collection uses normalized relative paths, stable
categories, bounded content, content fingerprints, deterministic ordering, and
fail-closed symlink/root-escape rejection. These artifacts are protected workflow
policy material only: their prose, command text, skill text, contracts, schemas,
and runtime-policy text cannot grant workspace write, process execution,
network/service access, destructive actions, Git authority, MCP authority, or
subtask spawning.

Global policy artifacts are serialized into the generated Mode Pack as
`global_policy_artifacts` and must pass normal Mode Pack validation before they
can be activated. Runtime permission remains derived from structured mode
policy, source trust, runtime ceilings, and `RuntimePermissionGate`, not from
artifact text or AgentModes-specific Rust mode ids.

When a Mode Pack is activated, its policy artifacts are included in the active
snapshot fingerprint surface and later written into task-pinned `ModeResolved`
provenance for the selected external mode. Context materialization treats
categories differently: `rule`, `schema`, and `runtime_policy` artifacts may be
protected global policy/catalog evidence, while `skill`, `command`, and
`contract` artifacts remain task-pinned catalogs unless a structured
compatibility selection explicitly materializes them. Ledger evidence uses
relative artifact identities and bounded content; absolute AgentModes source
paths and raw Mode Pack JSON are not required for replay. Real compatibility
tests use Brownie-managed baseline metadata for expected mode-file, workflow
mode, prompt-file, compiled-mode, rule, skill, command, contract, schema, and
runtime-policy counts so revision drift or missing artifacts fails before
release acceptance.

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

## MP-3.2A full-pack scale handoff contract

Current AgentModes compatibility must be proven against the real pinned
AgentModes source shape, not only short representative fixtures. For the v2 Core
baseline with a workspace framework entrypoint, Brownie must compile current
`workflow.yaml` modes and their Markdown `prompt_file` role prompts, collect the
current `schemas/*.yaml` and `runtime-policies/brownie/*.yaml` policy artifacts,
validate the generated Brownie Mode Pack, and activate it through the same
runtime snapshot path used by ordinary external Mode Packs. Older Core
baselines without `workflow.yaml` may still compile through the fallback
`core/*.yaml` role-contract path.

The v2 Core baseline intentionally has no write-capable child role and no
dispatching role. Brownie must not substitute built-in implementer behavior,
invent member-only development pack roles, or claim an autonomous coding E2E
against the open-source Core repository. Installed CLI compatibility evidence
for this baseline proves signed activation, default `core.orchestrator`
admission, task-pinned provenance, and fail-closed denial of workspace write or
subtask requests that exceed Core role authority.

Empty `groups` is not delegation authority. A no-group AgentModes mode is
read-only by default and cannot spawn subtasks unless a structured
compatibility adapter explicitly marks that mode as a delegation coordinator.
That adapter metadata is validated against the compiled Mode Pack graph, cannot
name missing modes, cannot be duplicated, and cannot turn an edit or command
mode into a coordinator. Prompt prose, `whenToUse`, and `new_task(...)` strings
remain workflow instructions only; they do not grant `SpawnSubtask`.

For large packs, explicit all-other-mode allow-lists are replaced by the
bounded selector `$modepack/*`. The selector means every validated mode in the
same compiled Mode Pack except the active mode itself. The selector must not be
mixed with explicit target names. Runtime subtask admission still resolves the
requested child mode against task-pinned policy before queueing or materializing
a child, so the selector is compact authority evidence, not a bypass around
target validation.

## MP-3.2B Boomerang new_task adapter

AgentModes prompt policy may instruct controller modes to delegate with
Boomerang `new_task(mode, message)`. Brownie treats that shape as a
compatibility alias for the existing runtime-owned `subtask.spawn` intent, not
as a new authority source. The adapter belongs at the runtime tool-intent
parsing boundary and normalizes a bounded call into `subtask.spawn` input before
permission evaluation.

The adapter must not derive delegation authority from prose, `whenToUse`, mode
ids, keyword search, or `groups: []`. A mode can delegate only when its compiled
policy has `SpawnSubtask` and the requested child target passes task-pinned
handoff validation, including the `$modepack/*` same-pack selector contract
from MP-3.2A. Non-dispatch modes, including current v2 Core roles such as
`core.orchestrator`, `core.reviewer`, and `core.reporter`, remain unable to
create children even if they mention or emit `new_task`.

Runtime evidence remains bounded and summary-only. Brownie must not persist raw
provider output, raw `new_task` arguments, or the full child message beyond
existing sanitized request summaries and child goal previews.

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
