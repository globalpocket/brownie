import { RuntimeJsonRpcError, RuntimeProtocolError } from './errors';
import type { JsonRpcRequest, ModeSummary, PermissionCheckResult, RuntimeActionName, RuntimeStatusResult, TaskRecord, TaskRunResult, ToolPlanResult, TaskStartParams, TaskStartResult } from './protocol';
import { isModeListResult, isModeSummary, isPermissionCheckResult, isRuntimeStatusResult, isTaskRecord, isTaskRunResult, isToolPlanResult, isTaskStartResult } from './protocol';
import type { RuntimeTransport } from './runtimeProcess';

const DEFAULT_TIMEOUT_MS = 10_000;

export class RuntimeClient {
  private nextId = 1;

  constructor(
    private readonly transport: RuntimeTransport,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async status(): Promise<RuntimeStatusResult> {
    const result = await this.call<RuntimeStatusResult>('runtime.status');

    if (!isRuntimeStatusResult(result)) {
      throw new RuntimeProtocolError('runtime.status returned an invalid result');
    }

    return result;
  }

  async listModes(): Promise<ModeSummary[]> {
    const result = await this.call<{ modes: unknown }>('mode.list');

    if (!isModeListResult(result)) {
      throw new RuntimeProtocolError('mode.list returned an invalid result');
    }

    return result.modes;
  }

  async getMode(modeId: string): Promise<ModeSummary> {
    const result = await this.call<ModeSummary>('mode.get', { mode_id: modeId });

    if (!isModeSummary(result)) {
      throw new RuntimeProtocolError('mode.get returned an invalid result');
    }

    return result;
  }

  async checkPermission(modeId: string, action: RuntimeActionName): Promise<PermissionCheckResult> {
    const result = await this.call<PermissionCheckResult>('permission.check', {
      mode_id: modeId,
      action,
    });

    if (!isPermissionCheckResult(result)) {
      throw new RuntimeProtocolError('permission.check returned an invalid result');
    }

    return result;
  }

  async startTask(params: TaskStartParams): Promise<TaskStartResult> {
    const result = await this.call<TaskStartResult>('task.start', {
      goal: params.goal,
      mode_id: params.modeId,
    });

    if (!isTaskStartResult(result)) {
      throw new RuntimeProtocolError('task.start returned an invalid result');
    }

    return result;
  }

  async runTask(taskId: string): Promise<TaskRunResult> {
    const result = await this.call<TaskRunResult>('task.run', { task_id: taskId });

    if (!isTaskRunResult(result)) {
      throw new RuntimeProtocolError('task.run returned an invalid result');
    }

    return result;
  }

  async planTools(taskId: string): Promise<ToolPlanResult> {
    const result = await this.call<ToolPlanResult>('tool.plan', { task_id: taskId });

    if (!isToolPlanResult(result)) {
      throw new RuntimeProtocolError('tool.plan returned an invalid result');
    }

    return result;
  }

  async getTask(taskId: string): Promise<TaskRecord> {
    const result = await this.call<TaskRecord>('task.get', { task_id: taskId });

    if (!isTaskRecord(result)) {
      throw new RuntimeProtocolError('task.get returned an invalid result');
    }

    return result;
  }

  async listTasks(): Promise<TaskRecord[]> {
    const result = await this.call<{ tasks: unknown }>('task.list');

    if (!isTaskListResult(result)) {
      throw new RuntimeProtocolError('task.list returned an invalid result');
    }

    return result.tasks;
  }

  private async call<T>(method: string, params?: unknown): Promise<T> {
    const response = await this.send<T>(method, params);

    if (response.error !== undefined) {
      throw new RuntimeJsonRpcError(response.error);
    }

    return response.result as T;
  }

  private send<T>(method: string, params?: unknown) {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.nextId,
      method,
    };
    this.nextId += 1;

    if (params !== undefined) {
      request.params = params;
    }

    return this.transport.request<T>(request, this.timeoutMs);
  }
}

function isTaskListResult(value: unknown): value is { tasks: TaskRecord[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { tasks?: unknown }).tasks) &&
    (value as { tasks: unknown[] }).tasks.every(isTaskRecord)
  );
}
