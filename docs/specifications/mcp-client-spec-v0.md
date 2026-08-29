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

The only supported first-phase path is:

`MCP server -> Rust MCP client -> tools/list -> validation -> bounded catalog -> PromptBuilder -> LLM`

`tools/call` follows the same runtime-owned boundary. The normalized Brownie
tool id is:

`mcp.<server_id>.<tool_name>`

Server ids and tool names are bounded ASCII identifiers. Namespace collisions,
duplicate tool names, malformed schemas, oversized schemas, protocol errors,
server failures, and timeouts fail closed.

## Mode Pack Policy

Mode Packs may declare structured MCP server configuration and per-mode
allow-lists. The shape is:

```json
{
  "mcp_servers": {
    "github": {
      "transport": "stdio",
      "command": "...",
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
          { "id": "github", "tools": ["search_code"] }
        ]
      }
    }
  ]
}
```

`mcp_tool_access` is narrowed by Mode Pack source trust and the runtime
capability ceiling. Repository-local untrusted Mode Packs cannot grant MCP
execution. The AgentModes `mcp` group remains non-authoritative; it does not set
`mcp_tool_access` or a server/tool allow-list by itself.

## Permission Contract

An MCP tool call is authorized only when all of these are true:

- the active task mode has `mcp_tool_access`;
- the mode's compiled policy includes the server id;
- the mode's compiled policy includes the tool name for that server;
- the server configuration exists in structured Mode Pack policy;
- the stdio server launch is performed by Brownie Runtime;
- the live catalog entry matches task-pinned catalog provenance.

MCP descriptions, schemas, server responses, command names, and AgentModes
prose are never authority sources.

## Task-Pinned Provenance

At task admission, Runtime materializes bounded MCP catalog evidence in
`ModeResolved` when the mode has MCP access. The evidence includes:

- server id;
- tool name;
- input schema fingerprint;
- output schema fingerprint when available;
- server/config identity fingerprint;
- MCP protocol version;
- catalog fingerprint.

The ledger and prompt do not store raw server command arguments, environment
values, credentials, secret headers, absolute source paths, or unbounded schema
text. Prompt materialization can expose the bounded catalog evidence below
runtime safety invariants, Mode Pack permission policy, and mode instructions.

## Failure And Replay

`tools/list` and `tools/call` failures are bounded runtime tool failures. They
do not widen policy and do not change task replay authority. If the server
catalog changes after task admission, execution is denied unless the current
entry still matches the task-pinned catalog fingerprint evidence.

The first-phase stdio lifecycle is request-scoped. Brownie does not add a
scheduler, background polling loop, permanent MCP process, recursive self-spawn,
or a second permission system.
