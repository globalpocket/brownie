import { describe, expect, it } from 'vitest';
import { RuntimeJsonRpcError } from '../runtime/errors';
import { isJsonRpcResponse, isModeSummary, isPermissionCheckResult, isRuntimeStatusResult, isToolIntentParseResult, isToolPlanResult, type JsonRpcRequest, type JsonRpcResponse } from '../runtime/protocol';
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
