export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
}

export interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: JsonRpcError;
}

export interface RuntimeStatusResult {
  name: string;
  version: string;
  status: string;
}

export type TaskStatus = 'Created' | 'Running' | 'Completed' | 'Failed' | 'Cancelled';

export interface TaskStartParams {
  goal: string;
  modeId?: string;
}

export interface TaskStartResult {
  task_id: string;
  run_id: string;
  status: TaskStatus;
}

export interface TaskRunResult {
  task_id: string;
  run_id: string;
  status: TaskStatus;
}

export interface TaskRecord {
  task_id: string;
  run_id: string;
  goal: string;
  mode_id?: string | null;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
}

export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse<unknown> {
  if (!isRecord(value)) {
    return false;
  }

  if (value.jsonrpc !== '2.0' || typeof value.id !== 'number') {
    return false;
  }

  const hasResult = Object.prototype.hasOwnProperty.call(value, 'result');
  const hasError = Object.prototype.hasOwnProperty.call(value, 'error');
  if (!hasResult && !hasError) {
    return false;
  }

  if (hasError && !isJsonRpcError(value.error)) {
    return false;
  }

  return true;
}

export function isRuntimeStatusResult(value: unknown): value is RuntimeStatusResult {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.version === 'string' &&
    typeof value.status === 'string'
  );
}

export function isTaskStartResult(value: unknown): value is TaskStartResult {
  return (
    isRecord(value) &&
    typeof value.task_id === 'string' &&
    typeof value.run_id === 'string' &&
    isTaskStatus(value.status)
  );
}

export function isTaskRunResult(value: unknown): value is TaskRunResult {
  return (
    isRecord(value) &&
    typeof value.task_id === 'string' &&
    typeof value.run_id === 'string' &&
    isTaskStatus(value.status)
  );
}

export function isTaskRecord(value: unknown): value is TaskRecord {
  return (
    isRecord(value) &&
    typeof value.task_id === 'string' &&
    typeof value.run_id === 'string' &&
    typeof value.goal === 'string' &&
    (value.mode_id === undefined || value.mode_id === null || typeof value.mode_id === 'string') &&
    isTaskStatus(value.status) &&
    typeof value.created_at === 'string' &&
    typeof value.updated_at === 'string'
  );
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return value === 'Created' || value === 'Running' || value === 'Completed' || value === 'Failed' || value === 'Cancelled';
}

function isJsonRpcError(value: unknown): value is JsonRpcError {
  return isRecord(value) && typeof value.code === 'number' && typeof value.message === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
