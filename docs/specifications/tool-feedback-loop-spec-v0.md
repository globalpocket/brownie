# Brownie Tool Feedback Loop Spec v0

## Phase 1.9 scope

Phase 1.9 adds the first same-run tool feedback loop for `workspace.read`:

1. The first Fake LLM pass emits a `brownie-tool-intent` request.
2. The runtime evaluates permissions and executes only approved `workspace.read` requests.
3. The runtime records tool execution events with preview/metadata only.
4. If at least one `ToolExecutionCompleted` event exists, the runtime re-reads the ledger.
5. `ContextMaterializer` summarizes tool execution results.
6. `PromptBuilder` includes the `Tool Execution:` section in the second-pass prompt.
7. `FakeLlm` returns a final response when it sees a completed `workspace.read` summary.
8. The runtime records second-pass prompt, request, and response ledger events.
9. `task.run` remains `Completed` for this phase.

## Privacy and safety

Full file content is not persisted in the ledger. Tool execution payloads are limited to `output_preview`, `bytes_read`, `truncated`, and failure/denial reasons. Phase 1.9 does not implement workspace writes, patch application, process execution, network access, service control, destructive actions, subtask execution, real LLM API calls, Mode Pack fetching, AgentModes YAML parsing, Qdrant, llama-server, or indexing.
