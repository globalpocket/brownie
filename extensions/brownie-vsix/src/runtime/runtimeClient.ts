import { RuntimeJsonRpcError, RuntimeProtocolError } from './errors';
import type { JsonRpcRequest, LlmStatusResult, RuntimeConfigGetResult, RuntimeDiagnosticsResult, ModeSummary, PermissionCheckResult, RuntimeActionName, RuntimeStatusResult, RunEventsResult, RunInspectResult, RunInspectSummary, TaskInspectResult, TaskRecord, TaskRunResult, ToolExecuteResult, ToolIntentParseResult, ToolPlanResult, TaskStartParams, TaskStartResult } from './protocol';
import { isLlmStatusResult, isRuntimeConfigGetResult, isRuntimeDiagnosticsResult, isModeListResult, isModeSummary, isPermissionCheckResult, isRunEventsResult, isRunInspectResult, isRuntimeStatusResult, isTaskInspectResult, isTaskRecord, isTaskRunResult, isToolExecuteResult, isToolIntentParseResult, isToolPlanResult, isTaskStartResult } from './protocol';
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

  async llmStatus(): Promise<LlmStatusResult> {
    const result = await this.call<LlmStatusResult>('llm.status');

    if (!isLlmStatusResult(result)) {
      throw new RuntimeProtocolError('llm.status returned an invalid result');
    }

    return result;
  }

  async runtimeDiagnostics(): Promise<RuntimeDiagnosticsResult> {
    const result = await this.call<RuntimeDiagnosticsResult>('runtime.diagnostics.get');

    if (!isRuntimeDiagnosticsResult(result)) {
      throw new RuntimeProtocolError('runtime.diagnostics.get returned an invalid result');
    }

    return result;
  }

  async runtimeConfig(): Promise<RuntimeConfigGetResult> {
    const result = await this.call<RuntimeConfigGetResult>('runtime.config.get');

    if (!isRuntimeConfigGetResult(result)) {
      throw new RuntimeProtocolError('runtime.config.get returned an invalid result');
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

  async getRunEvents(runId: string): Promise<RunEventsResult> {
    const result = await this.call<RunEventsResult>('run.events', { run_id: runId });

    if (!isRunEventsResult(result)) {
      throw new RuntimeProtocolError('run.events returned an invalid result');
    }

    return result;
  }

  async inspectRun(runId: string): Promise<RunInspectSummary> {
    const result = await this.call<RunInspectResult>('run.inspect', { run_id: runId });

    if (!isRunInspectResult(result)) {
      throw new RuntimeProtocolError('run.inspect returned an invalid result');
    }

    return result.run;
  }

  async inspectTask(taskId: string): Promise<TaskInspectResult> {
    const result = await this.call<TaskInspectResult>('task.inspect', { task_id: taskId });

    if (!isTaskInspectResult(result)) {
      throw new RuntimeProtocolError('task.inspect returned an invalid result');
    }

    return result;
  }

  async parseToolIntent(modeId: string, assistantContent: string): Promise<ToolIntentParseResult> {
    const result = await this.call<ToolIntentParseResult>('tool.intent.parse', {
      mode_id: modeId,
      assistant_content: assistantContent,
    });

    if (!isToolIntentParseResult(result)) {
      throw new RuntimeProtocolError('tool.intent.parse returned an invalid result');
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

  async executeTool(modeId: string, toolId: string, input: unknown): Promise<ToolExecuteResult> {
    const result = await this.call<ToolExecuteResult>('tool.execute', {
      mode_id: modeId,
      tool_id: toolId,
      input,
    });

    if (!isToolExecuteResult(result)) {
      throw new RuntimeProtocolError('tool.execute returned an invalid result');
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
