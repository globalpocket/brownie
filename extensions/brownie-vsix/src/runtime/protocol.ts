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

export interface LlmRequestBudgetSummary {
  max_prompt_chars: number;
  max_messages: number;
  request_timeout_ms: number;
  response_preview_chars: number;
}

export interface LlmStatusResult {
  provider: string;
  enabled: boolean;
  model: string;
  base_url?: string | null;
  reason?: string | null;
  strict: boolean;
  will_fallback_to_fake: boolean;
  task_run_network_allowed: boolean;
  config_source: string;
  active_profile?: string | null;
  budget: LlmRequestBudgetSummary;
  sensitive_guard: string;
}

export interface RuntimeConfigGetResult {
  config_source: string;
  config_path?: string | null;
  active_profile?: string | null;
  llm_status: LlmStatusResult;
}

export type DiagnosticSeverity = 'Info' | 'Warning' | 'Error';

export interface RuntimeDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  subject?: string | null;
}

export interface RuntimeDiagnosticsResult {
  config_source: string;
  active_profile?: string | null;
  llm_status: LlmStatusResult;
  parser_config: ToolIntentParserConfigSummary;
  diagnostics: RuntimeDiagnostic[];
}
export interface ToolIntentParserConfigSummary {
  max_blocks: number;
  max_block_bytes: number;
  max_tool_requests: number;
  max_input_bytes: number;
  max_reason_chars: number;
}

export interface ToolIntentParserSummary extends ToolIntentParserConfigSummary {
  found_blocks: number;
  accepted_blocks: number;
  accepted_requests: number;
  rejected_requests: number;
}

export interface LlmHealthResult {
  provider: string;
  config_source: string;
  active_profile?: string | null;
  enabled: boolean;
  attempted: boolean;
  healthy: boolean;
  model: string;
  base_url?: string | null;
  checked_at: string;
  latency_ms?: number | null;
  status_code?: number | null;
  reason?: string | null;
  diagnostics: RuntimeDiagnostic[];
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

export interface ToolIntentInputSummary {
  has_path: boolean;
  field_count: number;
}

export interface ToolIntentDecisionSummary {
  tool_id: string;
  required_action: RuntimeActionName;
  allowed: boolean;
  reason: string;
  request_reason: string;
  input_summary: ToolIntentInputSummary;
}

export interface ToolIntentRejectedSummary {
  tool_id?: string | null;
  reason: string;
  code: string;
}

export interface ToolIntentParseResult {
  mode_id: string;
  parser: ToolIntentParserSummary;
  items: ToolIntentDecisionSummary[];
  rejected: ToolIntentRejectedSummary[];
}

export type ToolExecuteStatus = 'Completed' | 'Denied' | 'Failed';

export interface ToolExecuteResult {
  tool_id: string;
  status: ToolExecuteStatus;
  output: unknown;
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

export interface LedgerEventSummary {
  event_id: string;
  task_id: string;
  run_id: string;
  kind: string;
  timestamp: string;
  payload?: unknown;
}

export interface RunInspectSummary {
  run_id: string;
  task_id?: string | null;
  status?: TaskStatus | null;
  event_count: number;
  has_tool_execution_completed: boolean;
  has_second_pass: boolean;
  final_response_preview?: string | null;
  timeline: string[];
}

export interface RunEventsResult {
  run_id: string;
  events: LedgerEventSummary[];
}

export interface RunInspectResult {
  run: RunInspectSummary;
}

export interface TaskInspectResult {
  task: TaskRecord;
  run: RunInspectSummary;
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

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function isLlmRequestBudgetSummary(value: unknown): value is LlmRequestBudgetSummary {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.max_prompt_chars) &&
    isNonNegativeInteger(value.max_messages) &&
    isNonNegativeInteger(value.request_timeout_ms) &&
    isNonNegativeInteger(value.response_preview_chars)
  );
}

export function isLlmStatusResult(value: unknown): value is LlmStatusResult {
  return (
    isRecord(value) &&
    typeof value.provider === 'string' &&
    typeof value.enabled === 'boolean' &&
    typeof value.model === 'string' &&
    (value.base_url === undefined || value.base_url === null || typeof value.base_url === 'string') &&
    (value.reason === undefined || value.reason === null || typeof value.reason === 'string') &&
    typeof value.strict === 'boolean' &&
    typeof value.will_fallback_to_fake === 'boolean' &&
    typeof value.task_run_network_allowed === 'boolean' &&
    typeof value.config_source === 'string' &&
    (value.active_profile === undefined || value.active_profile === null || typeof value.active_profile === 'string') &&
    isLlmRequestBudgetSummary(value.budget) &&
    typeof value.sensitive_guard === 'string' &&
    !Object.prototype.hasOwnProperty.call(value, 'api_key')
  );
}

export function isRuntimeDiagnostic(value: unknown): value is RuntimeDiagnostic {
  return (
    isRecord(value) &&
    (value.severity === 'Info' || value.severity === 'Warning' || value.severity === 'Error') &&
    typeof value.code === 'string' &&
    typeof value.message === 'string' &&
    (value.subject === undefined || value.subject === null || typeof value.subject === 'string') &&
    !Object.prototype.hasOwnProperty.call(value, 'api_key')
  );
}

export function isRuntimeDiagnosticsResult(value: unknown): value is RuntimeDiagnosticsResult {
  return (
    isRecord(value) &&
    typeof value.config_source === 'string' &&
    (value.active_profile === undefined || value.active_profile === null || typeof value.active_profile === 'string') &&
    isLlmStatusResult(value.llm_status) &&
    isToolIntentParserConfigSummary(value.parser_config) &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every(isRuntimeDiagnostic) &&
    !Object.prototype.hasOwnProperty.call(value, 'api_key')
  );
}

export function isLlmHealthResult(value: unknown): value is LlmHealthResult {
  return (
    isRecord(value) &&
    typeof value.provider === 'string' &&
    typeof value.config_source === 'string' &&
    (value.active_profile === undefined || value.active_profile === null || typeof value.active_profile === 'string') &&
    typeof value.enabled === 'boolean' &&
    typeof value.attempted === 'boolean' &&
    typeof value.healthy === 'boolean' &&
    typeof value.model === 'string' &&
    (value.base_url === undefined || value.base_url === null || typeof value.base_url === 'string') &&
    typeof value.checked_at === 'string' &&
    (value.latency_ms === undefined || value.latency_ms === null || typeof value.latency_ms === 'number') &&
    (value.status_code === undefined || value.status_code === null || typeof value.status_code === 'number') &&
    (value.reason === undefined || value.reason === null || typeof value.reason === 'string') &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every(isRuntimeDiagnostic) &&
    !Object.prototype.hasOwnProperty.call(value, 'api_key')
  );
}

export function isRuntimeConfigGetResult(value: unknown): value is RuntimeConfigGetResult {
  return (
    isRecord(value) &&
    typeof value.config_source === 'string' &&
    (value.config_path === undefined || value.config_path === null || typeof value.config_path === 'string') &&
    (value.active_profile === undefined || value.active_profile === null || typeof value.active_profile === 'string') &&
    isLlmStatusResult(value.llm_status) &&
    !Object.prototype.hasOwnProperty.call(value, 'api_key')
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

export function isToolIntentParseResult(value: unknown): value is ToolIntentParseResult {
  return (
    isRecord(value) &&
    typeof value.mode_id === 'string' &&
    isToolIntentParserSummary(value.parser) &&
    Array.isArray(value.items) &&
    value.items.every(isToolIntentDecisionSummary) &&
    Array.isArray(value.rejected) &&
    value.rejected.every(isToolIntentRejectedSummary)
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

export function isToolExecuteResult(value: unknown): value is ToolExecuteResult {
  return (
    isRecord(value) &&
    typeof value.tool_id === 'string' &&
    isToolExecuteStatus(value.status) &&
    Object.prototype.hasOwnProperty.call(value, 'output')
  );
}

function isToolIntentInputSummary(value: unknown): value is ToolIntentInputSummary {
  if (!isRecord(value) || typeof value.has_path !== 'boolean') {
    return false;
  }
  const fieldCount = value.field_count;
  return Number.isInteger(fieldCount) && typeof fieldCount === 'number' && fieldCount >= 0;
}

function isToolIntentDecisionSummary(value: unknown): value is ToolIntentDecisionSummary {
  return (
    isRecord(value) &&
    !Object.prototype.hasOwnProperty.call(value, 'input') &&
    typeof value.tool_id === 'string' &&
    isRuntimeActionName(value.required_action) &&
    typeof value.allowed === 'boolean' &&
    typeof value.reason === 'string' &&
    typeof value.request_reason === 'string' &&
    isToolIntentInputSummary(value.input_summary)
  );
}

function isToolIntentRejectedSummary(value: unknown): value is ToolIntentRejectedSummary {
  return (
    isRecord(value) &&
    (value.tool_id === undefined || value.tool_id === null || typeof value.tool_id === 'string') &&
    typeof value.reason === 'string' &&
    typeof value.code === 'string'
  );
}

function isToolIntentParserConfigSummary(value: unknown): value is ToolIntentParserConfigSummary {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.max_blocks) &&
    isNonNegativeInteger(value.max_block_bytes) &&
    isNonNegativeInteger(value.max_tool_requests) &&
    isNonNegativeInteger(value.max_input_bytes) &&
    isNonNegativeInteger(value.max_reason_chars)
  );
}

function isToolIntentParserSummary(value: unknown): value is ToolIntentParserSummary {
  return (
    isToolIntentParserConfigSummary(value) &&
    isRecord(value) &&
    isNonNegativeInteger(value.found_blocks) &&
    isNonNegativeInteger(value.accepted_blocks) &&
    isNonNegativeInteger(value.accepted_requests) &&
    isNonNegativeInteger(value.rejected_requests)
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

export function isLedgerEventSummary(value: unknown): value is LedgerEventSummary {
  return (
    isRecord(value) &&
    typeof value.event_id === 'string' &&
    typeof value.task_id === 'string' &&
    typeof value.run_id === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.timestamp === 'string'
  );
}

export function isRunEventsResult(value: unknown): value is RunEventsResult {
  return isRecord(value) && typeof value.run_id === 'string' && Array.isArray(value.events) && value.events.every(isLedgerEventSummary);
}

export function isRunInspectSummary(value: unknown): value is RunInspectSummary {
  return (
    isRecord(value) &&
    typeof value.run_id === 'string' &&
    (value.task_id === undefined || value.task_id === null || typeof value.task_id === 'string') &&
    (value.status === undefined || value.status === null || isTaskStatus(value.status)) &&
    typeof value.event_count === 'number' &&
    Number.isInteger(value.event_count) &&
    value.event_count >= 0 &&
    typeof value.has_tool_execution_completed === 'boolean' &&
    typeof value.has_second_pass === 'boolean' &&
    (value.final_response_preview === undefined || value.final_response_preview === null || typeof value.final_response_preview === 'string') &&
    Array.isArray(value.timeline) &&
    value.timeline.every((entry) => typeof entry === 'string')
  );
}

export function isRunInspectResult(value: unknown): value is RunInspectResult {
  return isRecord(value) && isRunInspectSummary(value.run);
}

export function isTaskInspectResult(value: unknown): value is TaskInspectResult {
  return isRecord(value) && isTaskRecord(value.task) && isRunInspectSummary(value.run);
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

function isToolExecuteStatus(value: unknown): value is ToolExecuteStatus {
  return value === 'Completed' || value === 'Denied' || value === 'Failed';
}

function isJsonRpcError(value: unknown): value is JsonRpcError {
  return isRecord(value) && typeof value.code === 'number' && typeof value.message === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
