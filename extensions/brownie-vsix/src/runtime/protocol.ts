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

export type RuntimeActionName =
  | 'ReadWorkspace'
  | 'WriteWorkspace'
  | 'ExecuteProcess'
  | 'AccessNetwork'
  | 'ControlService'
  | 'DestructiveOperation'
  | 'SpawnSubtask';


export interface ModePermissionsSummary {
  read_only: boolean;
  workspace_write: boolean;
  process_exec: boolean;
  network_access: boolean;
  service_control: boolean;
  destructive: boolean;
  can_spawn_subtasks: boolean;
}

export interface ModeSummary {
  mode_id: string;
  display_name: string;
  role_definition: string;
  permissions: ModePermissionsSummary;
}

export interface PermissionCheckResult {
  mode_id: string;
  action: RuntimeActionName;
  allowed: boolean;
  reason: string;
}

export interface ToolPlanDecisionSummary {
  tool_id: string;
  required_action: RuntimeActionName;
  allowed: boolean;
  reason: string;
}

export interface ToolPlanResult {
  task_id: string;
  run_id: string;
  mode_id: string;
  items: ToolPlanDecisionSummary[];
}

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

export function isModeSummary(value: unknown): value is ModeSummary {
  return (
    isRecord(value) &&
    typeof value.mode_id === 'string' &&
    typeof value.display_name === 'string' &&
    typeof value.role_definition === 'string' &&
    isModePermissionsSummary(value.permissions)
  );
}

export function isModeListResult(value: unknown): value is { modes: ModeSummary[] } {
  return isRecord(value) && Array.isArray(value.modes) && value.modes.every(isModeSummary);
}

export function isPermissionCheckResult(value: unknown): value is PermissionCheckResult {
  return (
    isRecord(value) &&
    typeof value.mode_id === 'string' &&
    isRuntimeActionName(value.action) &&
    typeof value.allowed === 'boolean' &&
    typeof value.reason === 'string'
  );
}

export function isToolPlanResult(value: unknown): value is ToolPlanResult {
  return (
    isRecord(value) &&
    typeof value.task_id === 'string' &&
    typeof value.run_id === 'string' &&
    typeof value.mode_id === 'string' &&
    Array.isArray(value.items) &&
    value.items.every(isToolPlanDecisionSummary)
  );
}

function isToolPlanDecisionSummary(value: unknown): value is ToolPlanDecisionSummary {
  return (
    isRecord(value) &&
    typeof value.tool_id === 'string' &&
    isRuntimeActionName(value.required_action) &&
    typeof value.allowed === 'boolean' &&
    typeof value.reason === 'string'
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

function isModePermissionsSummary(value: unknown): value is ModePermissionsSummary {
  return (
    isRecord(value) &&
    typeof value.read_only === 'boolean' &&
    typeof value.workspace_write === 'boolean' &&
    typeof value.process_exec === 'boolean' &&
    typeof value.network_access === 'boolean' &&
    typeof value.service_control === 'boolean' &&
    typeof value.destructive === 'boolean' &&
    typeof value.can_spawn_subtasks === 'boolean'
  );
}

function isRuntimeActionName(value: unknown): value is RuntimeActionName {
  return (
    value === 'ReadWorkspace' ||
    value === 'WriteWorkspace' ||
    value === 'ExecuteProcess' ||
    value === 'AccessNetwork' ||
    value === 'ControlService' ||
    value === 'DestructiveOperation' ||
    value === 'SpawnSubtask'
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
