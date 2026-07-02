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
  max_workspace_write_content_chars: number;
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

export interface WorkspacePatchProposalSummary {
  proposal_id: string;
  path: string;
  operation: string;
  content_preview: string;
  content_chars: number;
  truncated: boolean;
  validation_status: string;
  validation_reason: string | null;
  diff_preview: string | null;
  diff_truncated: boolean;
  diff_redacted: boolean;
  approval_status: string;
  approval_reason: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  approval_reason_redacted: boolean;
  latest_apply_plan?: WorkspacePatchApplyPlanSummary | null;
  latest_snapshot?: WorkspacePatchPreflightSnapshotSummary | null;
}

export interface WorkspacePatchPreflightSnapshotSummary {
  proposal_id: string;
  snapshot_id: string;
  path: string;
  canonical_path_hash: string;
  file_exists: boolean;
  file_kind: 'File' | 'Directory' | 'Missing' | 'Other' | 'Unreadable';
  file_size_bytes: number | null;
  file_modified_unix_ms: number | null;
  file_sha256: string | null;
  captured_at: string;
  stale: boolean;
  stale_reason: string | null;
}

export interface WorkspacePatchApplyPlanSummary {
  proposal_id: string;
  plan_id: string;
  status: string;
  checklist: WorkspacePatchApplyCheckSummary[];
}

export interface WorkspacePatchApplyCheckSummary {
  name: string;
  status: string;
  reason: string | null;
}

export interface WorkspacePatchApplyCapabilitySummary {
  proposal_id: string;
  capability_id: string;
  apply_supported: false;
  apply_enabled: false;
  mode: 'dry_run_only';
  reason: string;
  required_gates: string[];
  can_apply_now: false;
  checked_at: string;
  check_count: number;
  failed_checks: string[];
  blocked_checks: string[];
  checklist: WorkspacePatchApplyCapabilityCheckSummary[];
}

export interface WorkspacePatchApplyCapabilityCheckSummary {
  name: string;
  status: 'Pass' | 'Fail' | 'Blocked' | 'Skipped';
  reason: string | null;
}

export interface ProposalListResult {
  run_id: string;
  proposals: WorkspacePatchProposalSummary[];
}

export interface ProposalInspectResult {
  proposal: WorkspacePatchProposalSummary;
}

export interface ProposalApproveResult {
  proposal: WorkspacePatchProposalSummary;
  apply_plan: WorkspacePatchApplyPlanSummary;
}

export interface ProposalApplyCapabilityResult {
  proposal: WorkspacePatchProposalSummary;
  capability: WorkspacePatchApplyCapabilitySummary;
}

export interface WorkspacePatchReadinessReportSummary {
  proposal_id: string;
  report_id: string;
  readiness_status: 'Ready' | 'NotReady' | 'Blocked';
  readiness_reason: string | null;
  generated_at: string;
  checklist: WorkspacePatchReadinessCheckSummary[];
  summary: string;
}

export interface WorkspacePatchReadinessCheckSummary {
  name: string;
  status: 'Pass' | 'Fail' | 'Blocked' | 'Skipped';
  reason: string | null;
}

export interface ProposalReadinessResult {
  proposal: WorkspacePatchProposalSummary;
  report: WorkspacePatchReadinessReportSummary;
}

export interface ProposalRejectResult {
  proposal: WorkspacePatchProposalSummary;
}

export interface ProposalPreflightResult {
  proposal: WorkspacePatchProposalSummary;
  snapshot: WorkspacePatchPreflightSnapshotSummary;
  apply_plan: WorkspacePatchApplyPlanSummary;
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

export function hasNoForbiddenRawFields(value: object): boolean {
  return !Object.prototype.hasOwnProperty.call(value, 'content') && !Object.prototype.hasOwnProperty.call(value, 'raw_content') && !Object.prototype.hasOwnProperty.call(value, 'full_content') && !Object.prototype.hasOwnProperty.call(value, 'patch') && !Object.prototype.hasOwnProperty.call(value, 'diff') && !Object.prototype.hasOwnProperty.call(value, 'raw_input') && !Object.prototype.hasOwnProperty.call(value, 'canonical_path') && !Object.prototype.hasOwnProperty.call(value, 'absolute_path') && !Object.prototype.hasOwnProperty.call(value, 'file_content');
}

export function isWorkspacePatchPreflightSnapshotSummary(value: unknown): value is WorkspacePatchPreflightSnapshotSummary {
  return (
    isRecord(value) &&
    typeof value.proposal_id === 'string' &&
    typeof value.snapshot_id === 'string' &&
    typeof value.path === 'string' &&
    typeof value.canonical_path_hash === 'string' &&
    typeof value.file_exists === 'boolean' &&
    (value.file_kind === 'File' || value.file_kind === 'Directory' || value.file_kind === 'Missing' || value.file_kind === 'Other' || value.file_kind === 'Unreadable') &&
    (isNonNegativeInteger(value.file_size_bytes) || value.file_size_bytes === null) &&
    ((typeof value.file_modified_unix_ms === 'number' && Number.isInteger(value.file_modified_unix_ms)) || value.file_modified_unix_ms === null) &&
    (typeof value.file_sha256 === 'string' || value.file_sha256 === null) &&
    typeof value.captured_at === 'string' &&
    typeof value.stale === 'boolean' &&
    (typeof value.stale_reason === 'string' || value.stale_reason === null) &&
    hasNoForbiddenRawFields(value)
  );
}

export function isWorkspacePatchApplyCheckSummary(value: unknown): value is WorkspacePatchApplyCheckSummary {
  return isRecord(value) && typeof value.name === 'string' && (value.status === 'Pass' || value.status === 'Fail' || value.status === 'Skipped') && (typeof value.reason === 'string' || value.reason === null);
}

export function isWorkspacePatchApplyPlanSummary(value: unknown): value is WorkspacePatchApplyPlanSummary {
  return isRecord(value) && typeof value.proposal_id === 'string' && typeof value.plan_id === 'string' && typeof value.status === 'string' && Array.isArray(value.checklist) && value.checklist.every(isWorkspacePatchApplyCheckSummary) && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchApplyCapabilityCheckSummary(value: unknown): value is WorkspacePatchApplyCapabilityCheckSummary {
  return isRecord(value) && typeof value.name === 'string' && (value.status === 'Pass' || value.status === 'Fail' || value.status === 'Blocked' || value.status === 'Skipped') && (typeof value.reason === 'string' || value.reason === null) && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchApplyCapabilitySummary(value: unknown): value is WorkspacePatchApplyCapabilitySummary {
  return isRecord(value) && typeof value.proposal_id === 'string' && typeof value.capability_id === 'string' && value.apply_supported === false && value.apply_enabled === false && value.mode === 'dry_run_only' && typeof value.reason === 'string' && Array.isArray(value.required_gates) && value.required_gates.every((gate) => typeof gate === 'string') && value.can_apply_now === false && typeof value.checked_at === 'string' && isNonNegativeInteger(value.check_count) && Array.isArray(value.failed_checks) && value.failed_checks.every((check) => typeof check === 'string') && Array.isArray(value.blocked_checks) && value.blocked_checks.every((check) => typeof check === 'string') && Array.isArray(value.checklist) && value.checklist.every(isWorkspacePatchApplyCapabilityCheckSummary) && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReadinessCheckSummary(value: unknown): value is WorkspacePatchReadinessCheckSummary {
  return isRecord(value) && typeof value.name === 'string' && (value.status === 'Pass' || value.status === 'Fail' || value.status === 'Blocked' || value.status === 'Skipped') && (typeof value.reason === 'string' || value.reason === null) && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReadinessReportSummary(value: unknown): value is WorkspacePatchReadinessReportSummary {
  return isRecord(value) && typeof value.proposal_id === 'string' && typeof value.report_id === 'string' && (value.readiness_status === 'Ready' || value.readiness_status === 'NotReady' || value.readiness_status === 'Blocked') && (typeof value.readiness_reason === 'string' || value.readiness_reason === null) && typeof value.generated_at === 'string' && Array.isArray(value.checklist) && value.checklist.every(isWorkspacePatchReadinessCheckSummary) && typeof value.summary === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchProposalSummary(value: unknown): value is WorkspacePatchProposalSummary {
  return (
    isRecord(value) &&
    typeof value.proposal_id === 'string' &&
    typeof value.path === 'string' &&
    typeof value.operation === 'string' &&
    typeof value.content_preview === 'string' &&
    isNonNegativeInteger(value.content_chars) &&
    typeof value.truncated === 'boolean' &&
    (value.validation_status === 'Valid' || value.validation_status === 'Invalid' || value.validation_status === 'Blocked') &&
    (typeof value.validation_reason === 'string' || value.validation_reason === null) &&
    (typeof value.diff_preview === 'string' || value.diff_preview === null) &&
    typeof value.diff_truncated === 'boolean' &&
    typeof value.diff_redacted === 'boolean' &&
    (value.approval_status === 'Pending' || value.approval_status === 'Approved' || value.approval_status === 'Rejected' || value.approval_status === 'Superseded') &&
    (typeof value.approval_reason === 'string' || value.approval_reason === null) &&
    typeof value.approval_reason_redacted === 'boolean' &&
    (typeof value.approved_at === 'string' || value.approved_at === null) &&
    (typeof value.rejected_at === 'string' || value.rejected_at === null) &&
    (value.latest_apply_plan === undefined || value.latest_apply_plan === null || isWorkspacePatchApplyPlanSummary(value.latest_apply_plan)) &&
    (value.latest_snapshot === undefined || value.latest_snapshot === null || isWorkspacePatchPreflightSnapshotSummary(value.latest_snapshot)) &&
    hasNoForbiddenRawFields(value)
  );
}

export function isProposalListResult(value: unknown): value is ProposalListResult {
  return (
    isRecord(value) &&
    typeof value.run_id === 'string' &&
    Array.isArray(value.proposals) &&
    value.proposals.every(isWorkspacePatchProposalSummary)
  );
}

export function isProposalInspectResult(value: unknown): value is ProposalInspectResult {
  return (
    isRecord(value) &&
    isWorkspacePatchProposalSummary(value.proposal)
  );
}

export function isProposalApproveResult(value: unknown): value is ProposalApproveResult {
  return isRecord(value) && isWorkspacePatchProposalSummary(value.proposal) && isWorkspacePatchApplyPlanSummary(value.apply_plan);
}

export function isProposalApplyCapabilityResult(value: unknown): value is ProposalApplyCapabilityResult {
  return isRecord(value) && isWorkspacePatchProposalSummary(value.proposal) && isWorkspacePatchApplyCapabilitySummary(value.capability) && hasNoForbiddenRawFields(value);
}

export function isProposalPreflightResult(value: unknown): value is ProposalPreflightResult {
  return isRecord(value) && isWorkspacePatchProposalSummary(value.proposal) && isWorkspacePatchPreflightSnapshotSummary(value.snapshot) && isWorkspacePatchApplyPlanSummary(value.apply_plan);
}

export function isProposalRejectResult(value: unknown): value is ProposalRejectResult {
  return isRecord(value) && isWorkspacePatchProposalSummary(value.proposal);
}

export function isProposalReadinessResult(value: unknown): value is ProposalReadinessResult {
  return isRecord(value) && isWorkspacePatchProposalSummary(value.proposal) && isWorkspacePatchReadinessReportSummary(value.report) && hasNoForbiddenRawFields(value);
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
    isNonNegativeInteger(value.max_reason_chars) &&
    isNonNegativeInteger(value.max_workspace_write_content_chars)
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
