import { describe, expect, it } from 'vitest';
import { RuntimeJsonRpcError } from '../runtime/errors';
import { isJsonRpcResponse, isLedgerEventSummary, isLlmHealthResult, isLlmStatusResult, isModeSummary, isPermissionCheckResult, isRunInspectSummary, isRuntimeConfigGetResult, isRuntimeDiagnosticsResult, isRuntimeStatusResult, isToolExecuteResult, isToolIntentParseResult, isToolPlanResult, type JsonRpcRequest, type JsonRpcResponse } from '../runtime/protocol';
import { RuntimeClient } from '../runtime/runtimeClient';
import type { RuntimeTransport } from '../runtime/runtimeProcess';

class FakeTransport implements RuntimeTransport {
  requests: JsonRpcRequest[] = [];

  constructor(private readonly response: JsonRpcResponse<unknown>) {}

  async request<T>(request: JsonRpcRequest): Promise<JsonRpcResponse<T>> {
    this.requests.push(request);
    return this.response as JsonRpcResponse<T>;
  }
}


const modeSummary = {
  mode_id: 'orchestrator',
  display_name: 'Orchestrator',
  role_definition: 'Coordinate tasks.',
  permissions: {
    read_only: true,
    workspace_write: false,
    process_exec: false,
    network_access: false,
    service_control: false,
    destructive: false,
    can_spawn_subtasks: true,
  },
};

const taskRecord = {
  task_id: 'task_1',
  run_id: 'run_1',
  goal: 'test goal',
  mode_id: 'orchestrator',
  status: 'Created',
  created_at: '2026-06-26T00:00:00Z',
  updated_at: '2026-06-26T00:00:00Z',
};

describe('protocol validation', () => {
  it('accepts a valid JSON-RPC response', () => {
    expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1, result: { ok: true } })).toBe(true);
  });

  it('rejects invalid JSON-RPC response shapes', () => {
    expect(isJsonRpcResponse(null)).toBe(false);
    expect(isJsonRpcResponse({ jsonrpc: '2.0', result: {} })).toBe(false);
    expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1 })).toBe(false);
    expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1, error: { code: '1', message: 'bad' } })).toBe(false);
  });

  it('accepts mode summaries and rejects invalid permission shapes', () => {
    expect(isModeSummary(modeSummary)).toBe(true);
    expect(isModeSummary({ ...modeSummary, permissions: { ...modeSummary.permissions, workspace_write: 'false' } })).toBe(false);
  });

  it('accepts runtime.status results with string fields', () => {
    expect(isRuntimeStatusResult({ name: 'brownie-runtime', version: '0.1.0', status: 'Ready' })).toBe(true);
  });

  it('accepts valid llm.status results and rejects missing required fields', () => {
    expect(isLlmStatusResult({ provider: 'Fake', enabled: true, model: 'brownie-fake-llm', base_url: null, reason: null, strict: false, will_fallback_to_fake: false, config_source: 'Default', active_profile: null })).toBe(true);
    expect(isLlmStatusResult({ provider: 'Unknown', enabled: false, model: '', base_url: null, reason: 'unknown provider: mystery', strict: true, will_fallback_to_fake: false, config_source: 'Env', active_profile: null })).toBe(true);
    expect(isLlmStatusResult({ provider: 'Fake', enabled: true, model: 'brownie-fake-llm', will_fallback_to_fake: false, config_source: 'Default' })).toBe(false);
    expect(isLlmStatusResult({ provider: 'Fake', enabled: true })).toBe(false);
    expect(isLlmStatusResult({ provider: 'Fake', enabled: true, model: 'brownie-fake-llm', base_url: null, reason: null, strict: false, will_fallback_to_fake: false, active_profile: null })).toBe(false);
    expect(isLlmStatusResult({ provider: 'Fake', enabled: true, model: 'brownie-fake-llm', base_url: null, reason: null, strict: false, will_fallback_to_fake: false, config_source: 'Default', api_key: 'secret' })).toBe(false);
  });

  it('accepts valid runtime diagnostics results', () => {
    const llm_status = { provider: 'Fake', enabled: true, model: 'brownie-fake-llm', base_url: null, reason: null, strict: false, will_fallback_to_fake: false, config_source: 'Default', active_profile: null };
    expect(isRuntimeDiagnosticsResult({ config_source: 'Default', active_profile: null, llm_status, diagnostics: [{ severity: 'Info', code: 'CONFIG_NOT_FOUND', message: 'No config.', subject: '.brownie/config.json' }] })).toBe(true);
    expect(isRuntimeDiagnosticsResult({ config_source: 'Default', active_profile: null, llm_status, diagnostics: [{ code: 'CONFIG_NOT_FOUND', message: 'No config.' }] })).toBe(false);
    expect(isRuntimeDiagnosticsResult({ config_source: 'Default', active_profile: null, llm_status, diagnostics: [{ severity: 'Info', message: 'No config.' }] })).toBe(false);
    expect(isRuntimeDiagnosticsResult({ config_source: 'Default', active_profile: null, llm_status, diagnostics: [], api_key: 'secret' })).toBe(false);
  });

  it('accepts valid llm.health results and rejects invalid health fields', () => {
    const result = {
      provider: 'Fake',
      config_source: 'Default',
      active_profile: null,
      enabled: true,
      attempted: false,
      healthy: true,
      model: 'brownie-fake-llm',
      base_url: null,
      checked_at: '2026-06-28T00:00:00Z',
      latency_ms: null,
      status_code: null,
      reason: null,
      diagnostics: [{ severity: 'Info', code: 'PROVIDER_FAKE_HEALTHY', message: 'ok', subject: null }],
    };
    expect(isLlmHealthResult(result)).toBe(true);
    expect(isLlmHealthResult({ ...result, attempted: undefined })).toBe(false);
    expect(isLlmHealthResult({ ...result, healthy: undefined })).toBe(false);
    expect(isLlmHealthResult({ ...result, latency_ms: '1' })).toBe(false);
  });

  it('accepts valid runtime.config.get results', () => {
    const llm_status = { provider: 'Fake', enabled: true, model: 'brownie-fake-llm', base_url: null, reason: null, strict: false, will_fallback_to_fake: false, config_source: 'Default', active_profile: null };
    expect(isRuntimeConfigGetResult({ config_source: 'Default', config_path: null, active_profile: null, llm_status })).toBe(true);
    expect(isRuntimeConfigGetResult({ config_source: 'Default', llm_status, api_key: 'secret' })).toBe(false);
  });

  it('accepts valid permission.check results', () => {
    expect(isPermissionCheckResult({ mode_id: 'orchestrator', action: 'WriteWorkspace', allowed: false, reason: 'denied' })).toBe(true);
  });

  it('rejects invalid permission.check result shapes', () => {
    expect(isPermissionCheckResult({ mode_id: 'orchestrator', action: 'UnknownAction', allowed: false, reason: 'denied' })).toBe(false);
    expect(isPermissionCheckResult({ mode_id: 'orchestrator', action: 'WriteWorkspace', allowed: 'false', reason: 'denied' })).toBe(false);
  });

  it('accepts valid tool intent parse results and rejects invalid decision shapes', () => {
    const result = {
      mode_id: 'orchestrator',
      items: [{ tool_id: 'workspace.read', required_action: 'ReadWorkspace', allowed: true, reason: 'ok', request_reason: 'need context' }],
      rejected: [{ tool_id: null, reason: 'bad json' }, { reason: 'missing id is ok' }],
    };
    expect(isToolIntentParseResult(result)).toBe(true);
    expect(isToolIntentParseResult({ ...result, items: [{ tool_id: 'workspace.read', required_action: 'Nope', allowed: true, reason: 'ok', request_reason: 'need context' }] })).toBe(false);
  });

  it('accepts valid tool.plan results and rejects invalid item shapes', () => {
    const result = {
      task_id: 'task_1',
      run_id: 'run_1',
      mode_id: 'orchestrator',
      items: [{ tool_id: 'workspace.read', required_action: 'ReadWorkspace', allowed: true, reason: 'ok' }],
    };
    expect(isToolPlanResult(result)).toBe(true);
    expect(isToolPlanResult({ ...result, items: [{ tool_id: 'workspace.read', required_action: 'Nope', allowed: true, reason: 'ok' }] })).toBe(false);
  });

  it('accepts run inspection summaries and sanitized event payloads', () => {
    const summary = {
      run_id: 'run_1',
      task_id: 'task_1',
      status: 'Completed',
      event_count: 3,
      has_tool_execution_completed: true,
      has_second_pass: true,
      final_response_preview: 'done',
      timeline: ['TaskStarted'],
    };
    expect(isRunInspectSummary(summary)).toBe(true);
    expect(isRunInspectSummary({ ...summary, has_second_pass: 'true' })).toBe(false);
    expect(isRunInspectSummary({ ...summary, event_count: -1 })).toBe(false);
    expect(isLedgerEventSummary({
      event_id: 'event_1',
      task_id: 'task_1',
      run_id: 'run_1',
      kind: 'ToolExecutionCompleted',
      timestamp: '2026-06-26T00:00:00Z',
      payload: { output_preview: 'safe', bytes_read: 4, truncated: false },
    })).toBe(true);
  });

  it('validates tool.execute results', () => {
    expect(isToolExecuteResult({ tool_id: 'workspace.read', status: 'Completed', output: { content: 'ok' } })).toBe(true);
    expect(isToolExecuteResult({ tool_id: 'workspace.write', status: 'Denied', output: { reason: 'no' } })).toBe(true);
    expect(isToolExecuteResult({ tool_id: 'workspace.read', status: 'Unknown', output: {} })).toBe(false);
  });
});

describe('RuntimeClient', () => {
  it('creates a runtime.status request', async () => {
    const transport = new FakeTransport({
      jsonrpc: '2.0',
      id: 1,
      result: { name: 'brownie-runtime', version: '0.1.0', status: 'Ready' },
    });
    const client = new RuntimeClient(transport);

    await expect(client.status()).resolves.toEqual({
      name: 'brownie-runtime',
      version: '0.1.0',
      status: 'Ready',
    });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'runtime.status' }]);
  });

  it('creates an llm.status request', async () => {
    const result = { provider: 'Fake', enabled: true, model: 'brownie-fake-llm', base_url: null, reason: null, strict: false, will_fallback_to_fake: false, config_source: 'Default', active_profile: null };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.llmStatus()).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'llm.status' }]);
  });

  it('creates an llm.health request', async () => {
    const result = { provider: 'Fake', config_source: 'Default', active_profile: null, enabled: true, attempted: false, healthy: true, model: 'brownie-fake-llm', base_url: null, checked_at: '2026-06-28T00:00:00Z', latency_ms: null, status_code: null, reason: null, diagnostics: [] };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.llmHealth({ allow_network: false })).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'llm.health', params: { allow_network: false } }]);
  });

  it('rejects invalid llm.status results', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { provider: 'Fake', enabled: true } });
    const client = new RuntimeClient(transport);

    await expect(client.llmStatus()).rejects.toThrow('llm.status returned an invalid result');
  });

  it('creates a runtime.diagnostics.get request', async () => {
    const llm_status = { provider: 'Fake', enabled: true, model: 'brownie-fake-llm', base_url: null, reason: null, strict: false, will_fallback_to_fake: false, config_source: 'Default', active_profile: null };
    const result = { config_source: 'Default', active_profile: null, llm_status, diagnostics: [] };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);
    await expect(client.runtimeDiagnostics()).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'runtime.diagnostics.get' }]);
  });

  it('creates a runtime.config.get request', async () => {
    const llm_status = { provider: 'Fake', enabled: true, model: 'brownie-fake-llm', base_url: null, reason: null, strict: false, will_fallback_to_fake: false, config_source: 'Default', active_profile: null };
    const result = { config_source: 'Default', config_path: null, active_profile: null, llm_status };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.runtimeConfig()).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'runtime.config.get' }]);
  });

  it('creates a mode.list request', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { modes: [modeSummary] } });
    const client = new RuntimeClient(transport);

    await expect(client.listModes()).resolves.toEqual([modeSummary]);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'mode.list' }]);
  });

  it('creates a mode.get request', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: modeSummary });
    const client = new RuntimeClient(transport);

    await expect(client.getMode('orchestrator')).resolves.toEqual(modeSummary);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'mode.get', params: { mode_id: 'orchestrator' } }]);
  });

  it('creates a permission.check request', async () => {
    const result = { mode_id: 'orchestrator', action: 'WriteWorkspace', allowed: false, reason: 'Mode orchestrator does not allow workspace writes.' };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.checkPermission('orchestrator', 'WriteWorkspace')).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'permission.check', params: { mode_id: 'orchestrator', action: 'WriteWorkspace' } }]);
  });

  it('rejects invalid permission.check results', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { mode_id: 'orchestrator', action: 'UnknownAction', allowed: false, reason: 'bad' } });
    const client = new RuntimeClient(transport);

    await expect(client.checkPermission('orchestrator', 'WriteWorkspace')).rejects.toThrow('permission.check returned an invalid result');
  });

  it('creates a task.start request', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { task_id: 'task_1', run_id: 'run_1', status: 'Created' } });
    const client = new RuntimeClient(transport);

    await expect(client.startTask({ goal: 'test goal', modeId: 'orchestrator' })).resolves.toEqual({ task_id: 'task_1', run_id: 'run_1', status: 'Created' });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'task.start', params: { goal: 'test goal', mode_id: 'orchestrator' } }]);
  });

  it('creates a task.run request', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { task_id: 'task_1', run_id: 'run_1', status: 'Completed' } });
    const client = new RuntimeClient(transport);

    await expect(client.runTask('task_1')).resolves.toEqual({ task_id: 'task_1', run_id: 'run_1', status: 'Completed' });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'task.run', params: { task_id: 'task_1' } }]);
  });

  it('rejects invalid task.run results', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { task_id: 'task_1', run_id: 'run_1', status: 'Unknown' } });
    const client = new RuntimeClient(transport);

    await expect(client.runTask('task_1')).rejects.toThrow('task.run returned an invalid result');
  });

  it('converts task.run JSON-RPC errors into exceptions', async () => {
    const transport = new FakeTransport({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32602, message: 'invalid params: task not found' },
    });
    const client = new RuntimeClient(transport);

    await expect(client.runTask('task_missing')).rejects.toBeInstanceOf(RuntimeJsonRpcError);
  });

  it('creates a task.inspect request', async () => {
    const result = {
      task: { ...taskRecord, status: 'Completed' },
      run: { run_id: 'run_1', task_id: 'task_1', status: 'Completed', event_count: 2, has_tool_execution_completed: true, has_second_pass: true, final_response_preview: 'done', timeline: ['TaskStarted'] },
    };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.inspectTask('task_1')).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'task.inspect', params: { task_id: 'task_1' } }]);
  });

  it('creates a run.inspect request', async () => {
    const run = { run_id: 'run_1', task_id: 'task_1', status: 'Completed', event_count: 2, has_tool_execution_completed: true, has_second_pass: false, final_response_preview: 'done', timeline: ['TaskStarted'] };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { run } });
    const client = new RuntimeClient(transport);

    await expect(client.inspectRun('run_1')).resolves.toEqual(run);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'run.inspect', params: { run_id: 'run_1' } }]);
  });

  it('creates a run.events request', async () => {
    const result = { run_id: 'run_1', events: [{ event_id: 'event_1', task_id: 'task_1', run_id: 'run_1', kind: 'TaskStarted', timestamp: '2026-06-26T00:00:00Z', payload: { reason: 'ok' } }] };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.getRunEvents('run_1')).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'run.events', params: { run_id: 'run_1' } }]);
  });

  it('creates a tool.intent.parse request', async () => {
    const result = {
      mode_id: 'orchestrator',
      items: [{ tool_id: 'workspace.read', required_action: 'ReadWorkspace', allowed: true, reason: 'ok', request_reason: 'Need context.' }],
      rejected: [],
    };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.parseToolIntent('orchestrator', 'content')).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'tool.intent.parse', params: { mode_id: 'orchestrator', assistant_content: 'content' } }]);
  });

  it('rejects invalid tool.intent.parse results', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { mode_id: 'orchestrator', items: [{ tool_id: 'workspace.read', required_action: 'Unknown', allowed: true, reason: 'bad', request_reason: 'Need context.' }], rejected: [] } });
    const client = new RuntimeClient(transport);

    await expect(client.parseToolIntent('orchestrator', 'content')).rejects.toThrow('tool.intent.parse returned an invalid result');
  });

  it('creates a tool.plan request', async () => {
    const result = {
      task_id: 'task_1',
      run_id: 'run_1',
      mode_id: 'orchestrator',
      items: [{ tool_id: 'workspace.read', required_action: 'ReadWorkspace', allowed: true, reason: 'ok' }],
    };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.planTools('task_1')).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'tool.plan', params: { task_id: 'task_1' } }]);
  });

  it('rejects invalid tool.plan results', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { task_id: 'task_1', run_id: 'run_1', mode_id: 'orchestrator', items: [{ tool_id: 'workspace.read', required_action: 'Unknown', allowed: true, reason: 'bad' }] } });
    const client = new RuntimeClient(transport);

    await expect(client.planTools('task_1')).rejects.toThrow('tool.plan returned an invalid result');
  });

  it('creates a tool.execute request', async () => {
    const result = {
      tool_id: 'workspace.read',
      status: 'Completed',
      output: { path: 'README.md', content: 'hello', truncated: false, bytes_read: 5 },
    };
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result });
    const client = new RuntimeClient(transport);

    await expect(client.executeTool('orchestrator', 'workspace.read', { path: 'README.md' })).resolves.toEqual(result);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'tool.execute', params: { mode_id: 'orchestrator', tool_id: 'workspace.read', input: { path: 'README.md' } } }]);
  });

  it('rejects invalid tool.execute results', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { tool_id: 'workspace.read', status: 'Invalid', output: {} } });
    const client = new RuntimeClient(transport);

    await expect(client.executeTool('orchestrator', 'workspace.read', { path: 'README.md' })).rejects.toThrow('tool.execute returned an invalid result');
  });

  it('creates a task.get request', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: taskRecord });
    const client = new RuntimeClient(transport);

    await expect(client.getTask('task_1')).resolves.toEqual(taskRecord);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'task.get', params: { task_id: 'task_1' } }]);
  });

  it('creates a task.list request', async () => {
    const transport = new FakeTransport({ jsonrpc: '2.0', id: 1, result: { tasks: [taskRecord] } });
    const client = new RuntimeClient(transport);

    await expect(client.listTasks()).resolves.toEqual([taskRecord]);
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'task.list' }]);
  });

  it('converts JSON-RPC error responses into exceptions', async () => {
    const transport = new FakeTransport({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32601, message: 'method not found' },
    });
    const client = new RuntimeClient(transport);

    await expect(client.status()).rejects.toBeInstanceOf(RuntimeJsonRpcError);
  });
});
