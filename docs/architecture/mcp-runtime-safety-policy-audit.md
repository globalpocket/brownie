# Brownie MCP Runtime Safety Policy Audit

This audit registers the user-requested MCP Runtime Safety Policy finite closure
campaign as a Runtime-owned follow-on to the Runtime Release Readiness campaign.
It preserves the existing MCP-first architecture and does not introduce a
Brownie-specific tool adapter path.

Audited main: `ff2987db53fb6e9ae0a3ef6ac8993387bb9d4d7d`

| ID | Priority | Area | Status | Classification | Evidence summary | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| `mcp-result-error-semantics` | P0 | MCP `isError` and execution status semantics | implemented sufficient | closed | MCP `tools/call` now separates `ProtocolSucceeded`, `ToolSucceeded`, `ToolReturnedError`, `ProtocolFailed`, `TimedOut`, `InputRequiredUnsupported`, and malformed-result `Failed` outcomes while preserving the external `ToolExecuteStatus` enum. `resultType="complete"` and absent backward-compatible `resultType` are accepted, `input_required` fails closed in v0, omitted `isError` defaults to success, and `isError=true` emits `ToolExecutionFailed` with only bounded untrusted context. | Use as the baseline for later MCP safety phases. |
| `mcp-tool-safety-policy` | P0 | Tool-level Brownie safety policy | partial | required before release | Current Mode Pack policy has server/tool allow-lists and `mcp_tool_access`, but no structured per-tool side-effect, approval, idempotency, or retry policy. Legacy tool-name entries must not imply read-only safety. | Close in MCP-S2 by extending Mode Pack MCP policy without adding an adapter manifest. |
| `mcp-tool-annotation-provenance` | P0 | MCP tool annotations | unimplemented | required before release | `tools/list` catalogs schema/config fingerprints, but it does not yet parse, pin, fingerprint, or conflict-check MCP annotations such as `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`. | Close in MCP-S3 with bounded annotation parsing and drift detection. |
| `mcp-tool-approval-binding` | P0 | Tool-level approval | partial | required before release | Runtime approval/proposal mechanisms exist for other controlled operations, but MCP external mutation/destructive calls are not yet bound to one concrete tool call approval fingerprint. | Close in MCP-S4 using existing runtime approval machinery, not a second MCP permission system. |
| `mcp-runtime-schema-validation` | P0 | Runtime input/output schema validation | partial | required before release | MCP catalog fingerprints and bounded schema summaries exist, and arguments must be objects, but real input/output data is not yet validated against a bounded JSON Schema subset at `tools/call` boundaries. | Close in MCP-S5 with fail-closed bounded schema validation. |
| `mcp-secret-reference-contract` | P1 | Secret reference contract | unimplemented | required before release | MCP stdio environment inheritance is cleared, but there is no runtime-owned secret-reference contract for ephemeral, scoped credential injection. No secret manager is required here. | Close in MCP-S6 with a minimal `SecretResolver` contract and no persisted secret values. |
| `mcp-executable-identity` | P1 | MCP server executable identity | partial | required before release | Absolute executable path, PATH lookup denial, fixed args, neutral cwd, cleared env, timeout, and child cleanup exist. Executable content identity is not yet pinned and checked before `tools/list` and `tools/call`. | Close in MCP-S7 by adding executable hash identity evidence without storing raw paths or binary content. |
| `mcp-p1-transport-task-reevaluation` | P2 | P1 transport and task surfaces | runtime outside this P0 campaign | post-v0 | Streamable HTTP, remote MCP, OAuth, Apps, Roots, Elicitation, Sampling, long-running MCP tasks, and public registry work are intentionally excluded from this P0 safety closure. | Reevaluate only after stdio MCP safety closure is complete. |

Runtime Release Ready remains `false` while open Runtime-owned MCP safety items
and the previously recorded Runtime Release Readiness blockers remain open.
