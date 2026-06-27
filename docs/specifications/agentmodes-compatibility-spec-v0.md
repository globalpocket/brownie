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

## Phase 1.4 permission gate update

Phase 1.4 adds the `RuntimePermissionGate` foundation. Runtime permission checks are based on compiled mode policy capabilities and override LLM instructions.

Runtime actions are `ReadWorkspace`, `WriteWorkspace`, `ExecuteProcess`, `AccessNetwork`, `ControlService`, `DestructiveOperation`, and `SpawnSubtask`. Phase 1.4 records permission decisions only; it does not execute real tools, write files, apply patches, execute processes, call real LLM APIs, parse AgentModes YAML, fetch Mode Packs, or implement Qdrant/llama-server/indexer behavior.

The runtime protocol includes `permission.check`. Task runs append `PermissionChecked` ledger events for minimum checks and append `PermissionDenied` when a checked action is denied. `ModeResolved` stores a full permission snapshot so prompt materialization can summarize active mode capabilities.
