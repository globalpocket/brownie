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

export interface WorkspacePatchApplyDryRunSummary {
  proposal_id: string;
  dry_run_id: string;
  dry_run_status: string;
  dry_run_reason: string;
  checked_at: string;
  required_gates: string[];
  check_count: number;
  failed_checks: string[];
  blocked_checks: string[];
  no_patch_applied: true;
  apply_executed: false;
  workspace_files_changed: false;
  checklist: WorkspacePatchApplyDryRunCheckSummary[];
}

export interface WorkspacePatchApplyDryRunCheckSummary {
  name: string;
  status: 'Pass' | 'Fail' | 'Blocked' | 'Skipped';
  reason: string | null;
}

export interface WorkspacePatchApplyDryRunHistoryEntry {
  proposal_id: string;
  dry_run_id: string;
  dry_run_status: string;
  dry_run_reason: string;
  checked_at: string;
  required_gates: string[];
  check_count: number;
  failed_checks: string[];
  blocked_checks: string[];
  no_patch_applied: true;
  apply_executed: false;
  workspace_files_changed: false;
}

export interface WorkspacePatchApplyDryRunHistorySummary {
  proposal_id: string;
  dry_run_count: number;
  latest_dry_run: WorkspacePatchApplyDryRunHistoryEntry | null;
  dry_runs: WorkspacePatchApplyDryRunHistoryEntry[];
  generated_at: string;
}

export interface WorkspacePatchAuditTrailEntry {
  event_id: string;
  audit_event: string;
  event_kind: string;
  timestamp: string;
  proposal_id: string;
  summary: string;
  metadata: Record<string, unknown>;
}

export interface WorkspacePatchAuditTrailSummary {
  proposal_id: string;
  event_count: number;
  latest_event: WorkspacePatchAuditTrailEntry | null;
  events: WorkspacePatchAuditTrailEntry[];
  generated_at: string;
}

export interface WorkspacePatchReviewSignalSummary {
  status: string;
  reason: string | null;
  generated_at: string | null;
  source_id: string | null;
}

export interface WorkspacePatchReviewBundleSummary {
  proposal_id: string;
  review_status: 'Complete' | 'NeedsAction';
  review_reason: string;
  latest_readiness: WorkspacePatchReviewSignalSummary | null;
  latest_apply_capability: WorkspacePatchReviewSignalSummary | null;
  latest_apply_dry_run: WorkspacePatchReviewSignalSummary | null;
  audit_event_count: number;
  latest_audit_event: WorkspacePatchAuditTrailEntry | null;
  required_next_actions: string[];
  generated_at: string;
}

export interface WorkspacePatchReviewVerdictSummary {
  proposal_id: string;
  verdict_status: 'ReadyForHumanReview' | 'NeedsSignals' | 'BlockedForReview';
  verdict_reason: string;
  evidence_status: 'Complete' | 'Incomplete' | 'Blocked';
  blocking_reasons: string[];
  missing_signals: string[];
  latest_review_bundle_status: 'Complete' | 'NeedsAction';
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewReportSummary {
  proposal_id: string;
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_reason: string;
  review_bundle: WorkspacePatchReviewBundleSummary;
  review_verdict: WorkspacePatchReviewVerdictSummary;
  audit_event_count: number;
  recent_audit_events: WorkspacePatchAuditTrailEntry[];
  required_next_actions: string[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueItemSummary {
  proposal_id: string;
  path: string;
  validation_status: 'Valid' | 'Invalid' | 'Blocked';
  approval_status: 'Pending' | 'Approved' | 'Rejected' | 'Superseded';
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_reason: string;
  verdict_status: 'ReadyForHumanReview' | 'NeedsSignals' | 'BlockedForReview';
  review_status: 'Complete' | 'NeedsAction';
  audit_event_count: number;
  latest_audit_event: WorkspacePatchAuditTrailEntry | null;
  required_next_actions: string[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueSummary {
  run_id: string;
  queue_status: 'Complete' | 'NeedsAction' | 'Blocked';
  queue_reason: string;
  proposal_count: number;
  complete_count: number;
  needs_action_count: number;
  blocked_count: number;
  items: WorkspacePatchReviewQueueItemSummary[];
  required_next_actions: string[];
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsCheckSummary {
  name: string;
  status: 'Pass' | 'Fail' | 'Blocked';
  reason: string | null;
}

export interface WorkspacePatchReviewQueueDiagnosticsSummary {
  run_id: string;
  diagnostics_status: 'Complete' | 'NeedsAction' | 'Blocked';
  diagnostics_reason: string;
  queue_status: 'Complete' | 'NeedsAction' | 'Blocked';
  proposal_count: number;
  complete_count: number;
  needs_action_count: number;
  blocked_count: number;
  check_count: number;
  failed_checks: string[];
  blocked_checks: string[];
  checks: WorkspacePatchReviewQueueDiagnosticsCheckSummary[];
  required_next_actions: string[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsHistoryEntrySummary {
  diagnostics_id: string;
  diagnostics_status: 'Complete' | 'NeedsAction' | 'Blocked';
  queue_status: 'Complete' | 'NeedsAction' | 'Blocked';
  proposal_count: number;
  complete_count: number;
  needs_action_count: number;
  blocked_count: number;
  failed_checks: string[];
  blocked_checks: string[];
  required_next_actions: string[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsHistorySummary {
  run_id: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_reason: string;
  diagnostics_count: number;
  latest_diagnostics: WorkspacePatchReviewQueueDiagnosticsHistoryEntrySummary | null;
  entries: WorkspacePatchReviewQueueDiagnosticsHistoryEntrySummary[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsReportSummary {
  run_id: string;
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_reason: string;
  queue_status: 'Complete' | 'NeedsAction' | 'Blocked';
  diagnostics_status: 'Complete' | 'NeedsAction' | 'Blocked';
  diagnostics_count: number;
  proposal_count: number;
  complete_count: number;
  needs_action_count: number;
  blocked_count: number;
  failed_checks: string[];
  blocked_checks: string[];
  required_next_actions: string[];
  latest_diagnostics: WorkspacePatchReviewQueueDiagnosticsHistoryEntrySummary | null;
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestSummary {
  run_id: string;
  digest_status: 'Complete' | 'NeedsAction' | 'Blocked';
  digest_reason: string;
  queue_status: 'Complete' | 'NeedsAction' | 'Blocked';
  diagnostics_status: 'Complete' | 'NeedsAction' | 'Blocked';
  proposal_count: number;
  complete_count: number;
  needs_action_count: number;
  blocked_count: number;
  failed_check_count: number;
  blocked_check_count: number;
  required_next_action_count: number;
  required_next_actions: string[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestHistoryEntrySummary {
  digest_id: string;
  digest_status: 'Complete' | 'NeedsAction' | 'Blocked';
  queue_status: 'Complete' | 'NeedsAction' | 'Blocked';
  diagnostics_status: 'Complete' | 'NeedsAction' | 'Blocked';
  proposal_count: number;
  complete_count: number;
  needs_action_count: number;
  blocked_count: number;
  failed_check_count: number;
  blocked_check_count: number;
  required_next_action_count: number;
  required_next_actions: string[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestHistorySummary {
  run_id: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_reason: string;
  digest_count: number;
  latest_digest: WorkspacePatchReviewQueueDiagnosticsDigestHistoryEntrySummary | null;
  entries: WorkspacePatchReviewQueueDiagnosticsDigestHistoryEntrySummary[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportSummary {
  run_id: string;
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_reason: string;
  digest_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  digest_count: number;
  latest_digest: WorkspacePatchReviewQueueDiagnosticsDigestHistoryEntrySummary | null;
  proposal_count: number;
  complete_count: number;
  needs_action_count: number;
  blocked_count: number;
  failed_check_count: number;
  blocked_check_count: number;
  required_next_action_count: number;
  required_next_actions: string[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportHistoryEntrySummary {
  report_id: string;
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
  digest_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  digest_count: number;
  proposal_count: number;
  complete_count: number;
  needs_action_count: number;
  blocked_count: number;
  failed_check_count: number;
  blocked_check_count: number;
  required_next_action_count: number;
  required_next_actions: string[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportHistorySummary {
  run_id: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_reason: string;
  report_count: number;
  latest_report: WorkspacePatchReviewQueueDiagnosticsDigestReportHistoryEntrySummary | null;
  entries: WorkspacePatchReviewQueueDiagnosticsDigestReportHistoryEntrySummary[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictSummary {
  run_id: string;
  verdict_status: 'Complete' | 'NeedsAction' | 'Blocked';
  verdict_reason: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_count: number;
  proposal_count: number;
  complete_count: number;
  needs_action_count: number;
  blocked_count: number;
  failed_check_count: number;
  blocked_check_count: number;
  required_next_action_count: number;
  required_next_actions: string[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistoryEntrySummary {
  verdict_id: string;
  verdict_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_count: number;
  proposal_count: number;
  complete_count: number;
  needs_action_count: number;
  blocked_count: number;
  failed_check_count: number;
  blocked_check_count: number;
  required_next_action_count: number;
  required_next_actions: string[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistorySummary {
  run_id: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_reason: string;
  verdict_count: number;
  latest_verdict: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistoryEntrySummary | null;
  entries: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistoryEntrySummary[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportSummary {
  run_id: string;
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_reason: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  verdict_status: 'Complete' | 'NeedsAction' | 'Blocked';
  verdict_count: number;
  latest_verdict: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistoryEntrySummary | null;
  proposal_count: number;
  complete_count: number;
  needs_action_count: number;
  blocked_count: number;
  failed_check_count: number;
  blocked_check_count: number;
  required_next_action_count: number;
  required_next_actions: string[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryEntrySummary {
  report_id: string;
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  verdict_status: 'Complete' | 'NeedsAction' | 'Blocked';
  verdict_count: number;
  proposal_count: number;
  complete_count: number;
  needs_action_count: number;
  blocked_count: number;
  failed_check_count: number;
  blocked_check_count: number;
  required_next_action_count: number;
  required_next_actions: string[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistorySummary {
  run_id: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_reason: string;
  report_count: number;
  latest_report: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryEntrySummary | null;
  entries: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryEntrySummary[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestSummary {
  run_id: string;
  digest_status: 'Complete' | 'NeedsAction' | 'Blocked';
  digest_reason: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_count: number;
  proposal_count: number;
  complete_count: number;
  needs_action_count: number;
  blocked_count: number;
  failed_check_count: number;
  blocked_check_count: number;
  required_next_action_count: number;
  required_next_actions: string[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryEntrySummary {
  digest_id: string;
  digest_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_count: number;
  proposal_count: number;
  complete_count: number;
  needs_action_count: number;
  blocked_count: number;
  failed_check_count: number;
  blocked_check_count: number;
  required_next_action_count: number;
  required_next_actions: string[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistorySummary {
  run_id: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_reason: string;
  digest_count: number;
  latest_digest: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryEntrySummary | null;
  entries: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryEntrySummary[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportSummary {
  run_id: string;
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_reason: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  digest_status: 'Complete' | 'NeedsAction' | 'Blocked';
  digest_count: number;
  latest_digest: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryEntrySummary | null;
  proposal_count: number;
  complete_count: number;
  needs_action_count: number;
  blocked_count: number;
  failed_check_count: number;
  blocked_check_count: number;
  required_next_action_count: number;
  required_next_actions: string[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryEntrySummary {
  report_id: string;
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  digest_status: 'Complete' | 'NeedsAction' | 'Blocked';
  digest_count: number;
  proposal_count: number;
  complete_count: number;
  needs_action_count: number;
  blocked_count: number;
  failed_check_count: number;
  blocked_check_count: number;
  required_next_action_count: number;
  required_next_actions: string[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistorySummary {
  run_id: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_reason: string;
  report_count: number;
  latest_report: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryEntrySummary | null;
  entries: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryEntrySummary[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestSummary {
  run_id: string;
  digest_status: 'Complete' | 'NeedsAction' | 'Blocked';
  digest_reason: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_count: number;
  proposal_count: number;
  complete_count: number;
  needs_action_count: number;
  blocked_count: number;
  failed_check_count: number;
  blocked_check_count: number;
  required_next_action_count: number;
  required_next_actions: string[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary {
  digest_id: string;
  digest_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_count: number;
  proposal_count: number;
  complete_count: number;
  needs_action_count: number;
  blocked_count: number;
  failed_check_count: number;
  blocked_check_count: number;
  required_next_action_count: number;
  required_next_actions: string[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistorySummary {
  run_id: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_reason: string;
  digest_count: number;
  latest_digest: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary | null;
  entries: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary {
  run_id: string;
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_reason: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  digest_status: 'Complete' | 'NeedsAction' | 'Blocked';
  digest_count: number;
  latest_digest: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary | null;
  proposal_count: number;
  complete_count: number;
  needs_action_count: number;
  blocked_count: number;
  failed_check_count: number;
  blocked_check_count: number;
  required_next_action_count: number;
  required_next_actions: string[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary {
  report_id: string;
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  digest_status: 'Complete' | 'NeedsAction' | 'Blocked';
  digest_count: number;
  proposal_count: number;
  complete_count: number;
  needs_action_count: number;
  blocked_count: number;
  failed_check_count: number;
  blocked_check_count: number;
  required_next_action_count: number;
  required_next_actions: string[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary {
  run_id: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_reason: string;
  report_count: number;
  latest_report: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary | null;
  entries: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary {
  run_id: string;
  digest_status: 'Complete' | 'NeedsAction' | 'Blocked';
  digest_reason: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_count: number;
  proposal_count: number;
  complete_count: number;
  needs_action_count: number;
  blocked_count: number;
  failed_check_count: number;
  blocked_check_count: number;
  required_next_action_count: number;
  required_next_actions: string[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary {
  digest_id: string;
  digest_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_count: number;
  proposal_count: number;
  complete_count: number;
  needs_action_count: number;
  blocked_count: number;
  failed_check_count: number;
  blocked_check_count: number;
  required_next_action_count: number;
  required_next_actions: string[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary {
  run_id: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_reason: string;
  digest_count: number;
  latest_digest: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary | null;
  entries: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary {
  run_id: string;
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_reason: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  digest_status: 'Complete' | 'NeedsAction' | 'Blocked';
  digest_count: number;
  latest_digest: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary | null;
  proposal_count: number;
  complete_count: number;
  needs_action_count: number;
  blocked_count: number;
  failed_check_count: number;
  blocked_check_count: number;
  required_next_action_count: number;
  required_next_actions: string[];
  apply_authorized: false;
  generated_at: string;
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

export interface ProposalApplyDryRunResult {
  proposal: WorkspacePatchProposalSummary;
  dry_run: WorkspacePatchApplyDryRunSummary;
}

export interface ProposalApplyDryRunHistoryResult {
  proposal: WorkspacePatchProposalSummary;
  history: WorkspacePatchApplyDryRunHistorySummary;
}

export interface ProposalAuditTrailResult {
  proposal: WorkspacePatchProposalSummary;
  audit_trail: WorkspacePatchAuditTrailSummary;
}

export interface ProposalReviewBundleResult {
  proposal: WorkspacePatchProposalSummary;
  review_bundle: WorkspacePatchReviewBundleSummary;
}

export interface ProposalReviewVerdictResult {
  proposal: WorkspacePatchProposalSummary;
  review_verdict: WorkspacePatchReviewVerdictSummary;
}

export interface ProposalReviewReportResult {
  proposal: WorkspacePatchProposalSummary;
  review_report: WorkspacePatchReviewReportSummary;
}

export interface ProposalReviewQueueResult {
  review_queue: WorkspacePatchReviewQueueSummary;
}

export interface ProposalReviewQueueDiagnosticsResult {
  review_queue_diagnostics: WorkspacePatchReviewQueueDiagnosticsSummary;
}

export interface ProposalReviewQueueDiagnosticsHistoryResult {
  review_queue_diagnostics_history: WorkspacePatchReviewQueueDiagnosticsHistorySummary;
}

export interface ProposalReviewQueueDiagnosticsReportResult {
  review_queue_diagnostics_report: WorkspacePatchReviewQueueDiagnosticsReportSummary;
}

export interface ProposalReviewQueueDiagnosticsDigestResult {
  review_queue_diagnostics_digest: WorkspacePatchReviewQueueDiagnosticsDigestSummary;
}

export interface ProposalReviewQueueDiagnosticsDigestHistoryResult {
  review_queue_diagnostics_digest_history: WorkspacePatchReviewQueueDiagnosticsDigestHistorySummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportResult {
  review_queue_diagnostics_digest_report: WorkspacePatchReviewQueueDiagnosticsDigestReportSummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportHistoryResult {
  review_queue_diagnostics_digest_report_history: WorkspacePatchReviewQueueDiagnosticsDigestReportHistorySummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictResult {
  review_queue_diagnostics_digest_report_verdict: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictSummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictHistoryResult {
  review_queue_diagnostics_digest_report_verdict_history: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistorySummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportResult {
  review_queue_diagnostics_digest_report_verdict_report: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportSummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryResult {
  review_queue_diagnostics_digest_report_verdict_report_history: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistorySummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestSummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistorySummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportSummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistorySummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestSummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistorySummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary;
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

export function isWorkspacePatchApplyDryRunCheckSummary(value: unknown): value is WorkspacePatchApplyDryRunCheckSummary {
  return isRecord(value) && typeof value.name === 'string' && (value.status === 'Pass' || value.status === 'Fail' || value.status === 'Blocked' || value.status === 'Skipped') && (typeof value.reason === 'string' || value.reason === null) && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchApplyDryRunSummary(value: unknown): value is WorkspacePatchApplyDryRunSummary {
  return isRecord(value) && typeof value.proposal_id === 'string' && typeof value.dry_run_id === 'string' && typeof value.dry_run_status === 'string' && typeof value.dry_run_reason === 'string' && typeof value.checked_at === 'string' && Array.isArray(value.required_gates) && value.required_gates.every((gate) => typeof gate === 'string') && isNonNegativeInteger(value.check_count) && Array.isArray(value.failed_checks) && value.failed_checks.every((check) => typeof check === 'string') && Array.isArray(value.blocked_checks) && value.blocked_checks.every((check) => typeof check === 'string') && value.no_patch_applied === true && value.apply_executed === false && value.workspace_files_changed === false && Array.isArray(value.checklist) && value.checklist.every(isWorkspacePatchApplyDryRunCheckSummary) && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchApplyDryRunHistoryEntry(value: unknown): value is WorkspacePatchApplyDryRunHistoryEntry {
  return isRecord(value) && typeof value.proposal_id === 'string' && typeof value.dry_run_id === 'string' && typeof value.dry_run_status === 'string' && typeof value.dry_run_reason === 'string' && typeof value.checked_at === 'string' && Array.isArray(value.required_gates) && value.required_gates.every((gate) => typeof gate === 'string') && isNonNegativeInteger(value.check_count) && Array.isArray(value.failed_checks) && value.failed_checks.every((check) => typeof check === 'string') && Array.isArray(value.blocked_checks) && value.blocked_checks.every((check) => typeof check === 'string') && value.no_patch_applied === true && value.apply_executed === false && value.workspace_files_changed === false && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchApplyDryRunHistorySummary(value: unknown): value is WorkspacePatchApplyDryRunHistorySummary {
  return isRecord(value) && typeof value.proposal_id === 'string' && isNonNegativeInteger(value.dry_run_count) && (value.latest_dry_run === null || isWorkspacePatchApplyDryRunHistoryEntry(value.latest_dry_run)) && Array.isArray(value.dry_runs) && value.dry_runs.every(isWorkspacePatchApplyDryRunHistoryEntry) && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

function isAuditMetadataValue(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' || (Array.isArray(value) && value.every(isAuditMetadataValue));
}

export function isWorkspacePatchAuditTrailEntry(value: unknown): value is WorkspacePatchAuditTrailEntry {
  return isRecord(value) && typeof value.event_id === 'string' && typeof value.audit_event === 'string' && typeof value.event_kind === 'string' && typeof value.timestamp === 'string' && typeof value.proposal_id === 'string' && typeof value.summary === 'string' && isRecord(value.metadata) && Object.values(value.metadata).every(isAuditMetadataValue) && hasNoForbiddenRawFields(value) && hasNoForbiddenRawFields(value.metadata);
}

export function isWorkspacePatchAuditTrailSummary(value: unknown): value is WorkspacePatchAuditTrailSummary {
  return isRecord(value) && typeof value.proposal_id === 'string' && isNonNegativeInteger(value.event_count) && (value.latest_event === null || isWorkspacePatchAuditTrailEntry(value.latest_event)) && Array.isArray(value.events) && value.events.every(isWorkspacePatchAuditTrailEntry) && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewSignalSummary(value: unknown): value is WorkspacePatchReviewSignalSummary {
  return isRecord(value) && typeof value.status === 'string' && (typeof value.reason === 'string' || value.reason === null) && (typeof value.generated_at === 'string' || value.generated_at === null) && (typeof value.source_id === 'string' || value.source_id === null) && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewBundleSummary(value: unknown): value is WorkspacePatchReviewBundleSummary {
  return isRecord(value) && typeof value.proposal_id === 'string' && (value.review_status === 'Complete' || value.review_status === 'NeedsAction') && typeof value.review_reason === 'string' && (value.latest_readiness === null || isWorkspacePatchReviewSignalSummary(value.latest_readiness)) && (value.latest_apply_capability === null || isWorkspacePatchReviewSignalSummary(value.latest_apply_capability)) && (value.latest_apply_dry_run === null || isWorkspacePatchReviewSignalSummary(value.latest_apply_dry_run)) && isNonNegativeInteger(value.audit_event_count) && (value.latest_audit_event === null || isWorkspacePatchAuditTrailEntry(value.latest_audit_event)) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewVerdictSummary(value: unknown): value is WorkspacePatchReviewVerdictSummary {
  return isRecord(value) && typeof value.proposal_id === 'string' && (value.verdict_status === 'ReadyForHumanReview' || value.verdict_status === 'NeedsSignals' || value.verdict_status === 'BlockedForReview') && typeof value.verdict_reason === 'string' && (value.evidence_status === 'Complete' || value.evidence_status === 'Incomplete' || value.evidence_status === 'Blocked') && Array.isArray(value.blocking_reasons) && value.blocking_reasons.every((reason) => typeof reason === 'string') && Array.isArray(value.missing_signals) && value.missing_signals.every((signal) => typeof signal === 'string') && (value.latest_review_bundle_status === 'Complete' || value.latest_review_bundle_status === 'NeedsAction') && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewReportSummary(value: unknown): value is WorkspacePatchReviewReportSummary {
  return isRecord(value) && typeof value.proposal_id === 'string' && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && typeof value.report_reason === 'string' && isWorkspacePatchReviewBundleSummary(value.review_bundle) && isWorkspacePatchReviewVerdictSummary(value.review_verdict) && isNonNegativeInteger(value.audit_event_count) && Array.isArray(value.recent_audit_events) && value.recent_audit_events.every(isWorkspacePatchAuditTrailEntry) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueItemSummary(value: unknown): value is WorkspacePatchReviewQueueItemSummary {
  return isRecord(value) && typeof value.proposal_id === 'string' && typeof value.path === 'string' && (value.validation_status === 'Valid' || value.validation_status === 'Invalid' || value.validation_status === 'Blocked') && (value.approval_status === 'Pending' || value.approval_status === 'Approved' || value.approval_status === 'Rejected' || value.approval_status === 'Superseded') && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && typeof value.report_reason === 'string' && (value.verdict_status === 'ReadyForHumanReview' || value.verdict_status === 'NeedsSignals' || value.verdict_status === 'BlockedForReview') && (value.review_status === 'Complete' || value.review_status === 'NeedsAction') && isNonNegativeInteger(value.audit_event_count) && (value.latest_audit_event === null || isWorkspacePatchAuditTrailEntry(value.latest_audit_event)) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueSummary(value: unknown): value is WorkspacePatchReviewQueueSummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.queue_status === 'Complete' || value.queue_status === 'NeedsAction' || value.queue_status === 'Blocked') && typeof value.queue_reason === 'string' && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && Array.isArray(value.items) && value.items.every(isWorkspacePatchReviewQueueItemSummary) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsCheckSummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsCheckSummary {
  return isRecord(value) && typeof value.name === 'string' && (value.status === 'Pass' || value.status === 'Fail' || value.status === 'Blocked') && (typeof value.reason === 'string' || value.reason === null) && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsSummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsSummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.diagnostics_status === 'Complete' || value.diagnostics_status === 'NeedsAction' || value.diagnostics_status === 'Blocked') && typeof value.diagnostics_reason === 'string' && (value.queue_status === 'Complete' || value.queue_status === 'NeedsAction' || value.queue_status === 'Blocked') && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.check_count) && Array.isArray(value.failed_checks) && value.failed_checks.every((check) => typeof check === 'string') && Array.isArray(value.blocked_checks) && value.blocked_checks.every((check) => typeof check === 'string') && Array.isArray(value.checks) && value.checks.every(isWorkspacePatchReviewQueueDiagnosticsCheckSummary) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsHistoryEntrySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsHistoryEntrySummary {
  return isRecord(value) && typeof value.diagnostics_id === 'string' && (value.diagnostics_status === 'Complete' || value.diagnostics_status === 'NeedsAction' || value.diagnostics_status === 'Blocked') && (value.queue_status === 'Complete' || value.queue_status === 'NeedsAction' || value.queue_status === 'Blocked') && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && Array.isArray(value.failed_checks) && value.failed_checks.every((check) => typeof check === 'string') && Array.isArray(value.blocked_checks) && value.blocked_checks.every((check) => typeof check === 'string') && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsHistorySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsHistorySummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && typeof value.history_reason === 'string' && isNonNegativeInteger(value.diagnostics_count) && (value.latest_diagnostics === null || isWorkspacePatchReviewQueueDiagnosticsHistoryEntrySummary(value.latest_diagnostics)) && Array.isArray(value.entries) && value.entries.every(isWorkspacePatchReviewQueueDiagnosticsHistoryEntrySummary) && value.diagnostics_count === value.entries.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsReportSummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsReportSummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && typeof value.report_reason === 'string' && (value.queue_status === 'Complete' || value.queue_status === 'NeedsAction' || value.queue_status === 'Blocked') && (value.diagnostics_status === 'Complete' || value.diagnostics_status === 'NeedsAction' || value.diagnostics_status === 'Blocked') && isNonNegativeInteger(value.diagnostics_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && Array.isArray(value.failed_checks) && value.failed_checks.every((check) => typeof check === 'string') && Array.isArray(value.blocked_checks) && value.blocked_checks.every((check) => typeof check === 'string') && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && (value.latest_diagnostics === null || isWorkspacePatchReviewQueueDiagnosticsHistoryEntrySummary(value.latest_diagnostics)) && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestSummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestSummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && typeof value.digest_reason === 'string' && (value.queue_status === 'Complete' || value.queue_status === 'NeedsAction' || value.queue_status === 'Blocked') && (value.diagnostics_status === 'Complete' || value.diagnostics_status === 'NeedsAction' || value.diagnostics_status === 'Blocked') && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestHistoryEntrySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestHistoryEntrySummary {
  return isRecord(value) && typeof value.digest_id === 'string' && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && (value.queue_status === 'Complete' || value.queue_status === 'NeedsAction' || value.queue_status === 'Blocked') && (value.diagnostics_status === 'Complete' || value.diagnostics_status === 'NeedsAction' || value.diagnostics_status === 'Blocked') && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestHistorySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestHistorySummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && typeof value.history_reason === 'string' && isNonNegativeInteger(value.digest_count) && (value.latest_digest === null || isWorkspacePatchReviewQueueDiagnosticsDigestHistoryEntrySummary(value.latest_digest)) && Array.isArray(value.entries) && value.entries.every(isWorkspacePatchReviewQueueDiagnosticsDigestHistoryEntrySummary) && value.digest_count === value.entries.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportSummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportSummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && typeof value.report_reason === 'string' && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && isNonNegativeInteger(value.digest_count) && (value.latest_digest === null || isWorkspacePatchReviewQueueDiagnosticsDigestHistoryEntrySummary(value.latest_digest)) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportHistoryEntrySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportHistoryEntrySummary {
  return isRecord(value) && typeof value.report_id === 'string' && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && isNonNegativeInteger(value.digest_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportHistorySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportHistorySummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && typeof value.history_reason === 'string' && isNonNegativeInteger(value.report_count) && (value.latest_report === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportHistoryEntrySummary(value.latest_report)) && Array.isArray(value.entries) && value.entries.every(isWorkspacePatchReviewQueueDiagnosticsDigestReportHistoryEntrySummary) && value.report_count === value.entries.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictSummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictSummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.verdict_status === 'Complete' || value.verdict_status === 'NeedsAction' || value.verdict_status === 'Blocked') && typeof value.verdict_reason === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && isNonNegativeInteger(value.report_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistoryEntrySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistoryEntrySummary {
  return isRecord(value) && typeof value.verdict_id === 'string' && (value.verdict_status === 'Complete' || value.verdict_status === 'NeedsAction' || value.verdict_status === 'Blocked') && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && isNonNegativeInteger(value.report_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistorySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistorySummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && typeof value.history_reason === 'string' && isNonNegativeInteger(value.verdict_count) && (value.latest_verdict === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistoryEntrySummary(value.latest_verdict)) && Array.isArray(value.entries) && value.entries.every(isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistoryEntrySummary) && value.verdict_count === value.entries.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportSummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportSummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && typeof value.report_reason === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && (value.verdict_status === 'Complete' || value.verdict_status === 'NeedsAction' || value.verdict_status === 'Blocked') && isNonNegativeInteger(value.verdict_count) && (value.latest_verdict === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistoryEntrySummary(value.latest_verdict)) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryEntrySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryEntrySummary {
  return isRecord(value) && typeof value.report_id === 'string' && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && (value.verdict_status === 'Complete' || value.verdict_status === 'NeedsAction' || value.verdict_status === 'Blocked') && isNonNegativeInteger(value.verdict_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistorySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistorySummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && typeof value.history_reason === 'string' && isNonNegativeInteger(value.report_count) && (value.latest_report === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryEntrySummary(value.latest_report)) && Array.isArray(value.entries) && value.entries.every(isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryEntrySummary) && value.report_count === value.entries.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestSummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestSummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && typeof value.digest_reason === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && isNonNegativeInteger(value.report_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryEntrySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryEntrySummary {
  return isRecord(value) && typeof value.digest_id === 'string' && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && isNonNegativeInteger(value.report_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistorySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistorySummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && typeof value.history_reason === 'string' && isNonNegativeInteger(value.digest_count) && (value.latest_digest === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryEntrySummary(value.latest_digest)) && Array.isArray(value.entries) && value.entries.every(isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryEntrySummary) && value.digest_count === value.entries.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportSummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportSummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && typeof value.report_reason === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && isNonNegativeInteger(value.digest_count) && (value.latest_digest === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryEntrySummary(value.latest_digest)) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryEntrySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryEntrySummary {
  return isRecord(value) && typeof value.report_id === 'string' && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && isNonNegativeInteger(value.digest_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistorySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistorySummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && typeof value.history_reason === 'string' && isNonNegativeInteger(value.report_count) && (value.latest_report === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryEntrySummary(value.latest_report)) && Array.isArray(value.entries) && value.entries.every(isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryEntrySummary) && value.report_count === value.entries.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestSummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestSummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && typeof value.digest_reason === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && isNonNegativeInteger(value.report_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary {
  return isRecord(value) && typeof value.digest_id === 'string' && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && isNonNegativeInteger(value.report_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistorySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistorySummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && typeof value.history_reason === 'string' && isNonNegativeInteger(value.digest_count) && (value.latest_digest === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary(value.latest_digest)) && Array.isArray(value.entries) && value.entries.every(isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary) && value.digest_count === value.entries.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && typeof value.report_reason === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && isNonNegativeInteger(value.digest_count) && (value.latest_digest === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary(value.latest_digest)) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary {
  return isRecord(value) && typeof value.report_id === 'string' && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && isNonNegativeInteger(value.digest_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && typeof value.history_reason === 'string' && isNonNegativeInteger(value.report_count) && (value.latest_report === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary(value.latest_report)) && Array.isArray(value.entries) && value.entries.every(isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary) && value.report_count === value.entries.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && typeof value.digest_reason === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && isNonNegativeInteger(value.report_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary {
  return isRecord(value) && typeof value.digest_id === 'string' && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && isNonNegativeInteger(value.report_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && typeof value.history_reason === 'string' && isNonNegativeInteger(value.digest_count) && (value.latest_digest === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary(value.latest_digest)) && Array.isArray(value.entries) && value.entries.every(isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary) && value.digest_count === value.entries.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && typeof value.report_reason === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && isNonNegativeInteger(value.digest_count) && (value.latest_digest === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary(value.latest_digest)) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
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

export function isProposalApplyDryRunResult(value: unknown): value is ProposalApplyDryRunResult {
  return isRecord(value) && isWorkspacePatchProposalSummary(value.proposal) && isWorkspacePatchApplyDryRunSummary(value.dry_run) && hasNoForbiddenRawFields(value);
}

export function isProposalApplyDryRunHistoryResult(value: unknown): value is ProposalApplyDryRunHistoryResult {
  return isRecord(value) && isWorkspacePatchProposalSummary(value.proposal) && isWorkspacePatchApplyDryRunHistorySummary(value.history) && hasNoForbiddenRawFields(value);
}

export function isProposalAuditTrailResult(value: unknown): value is ProposalAuditTrailResult {
  return isRecord(value) && isWorkspacePatchProposalSummary(value.proposal) && isWorkspacePatchAuditTrailSummary(value.audit_trail) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewBundleResult(value: unknown): value is ProposalReviewBundleResult {
  return isRecord(value) && isWorkspacePatchProposalSummary(value.proposal) && isWorkspacePatchReviewBundleSummary(value.review_bundle) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewVerdictResult(value: unknown): value is ProposalReviewVerdictResult {
  return isRecord(value) && isWorkspacePatchProposalSummary(value.proposal) && isWorkspacePatchReviewVerdictSummary(value.review_verdict) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewReportResult(value: unknown): value is ProposalReviewReportResult {
  return isRecord(value) && isWorkspacePatchProposalSummary(value.proposal) && isWorkspacePatchReviewReportSummary(value.review_report) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueResult(value: unknown): value is ProposalReviewQueueResult {
  return isRecord(value) && isWorkspacePatchReviewQueueSummary(value.review_queue) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsResult(value: unknown): value is ProposalReviewQueueDiagnosticsResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsSummary(value.review_queue_diagnostics) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsHistoryResult(value: unknown): value is ProposalReviewQueueDiagnosticsHistoryResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsHistorySummary(value.review_queue_diagnostics_history) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsReportResult(value: unknown): value is ProposalReviewQueueDiagnosticsReportResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsReportSummary(value.review_queue_diagnostics_report) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestSummary(value.review_queue_diagnostics_digest) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestHistoryResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestHistoryResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestHistorySummary(value.review_queue_diagnostics_digest_history) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportSummary(value.review_queue_diagnostics_digest_report) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportHistoryResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportHistoryResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportHistorySummary(value.review_queue_diagnostics_digest_report_history) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictSummary(value.review_queue_diagnostics_digest_report_verdict) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictHistoryResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictHistoryResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistorySummary(value.review_queue_diagnostics_digest_report_verdict_history) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportSummary(value.review_queue_diagnostics_digest_report_verdict_report) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistorySummary(value.review_queue_diagnostics_digest_report_verdict_report_history) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestSummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistorySummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportSummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistorySummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestSummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistorySummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report) && hasNoForbiddenRawFields(value);
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
