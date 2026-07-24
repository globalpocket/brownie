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

export type TaskStatus = 'Created' | 'Queued' | 'Running' | 'Completed' | 'Failed' | 'Cancelled';

export type RuntimeActionName =
  | 'ReadWorkspace'
  | 'WriteWorkspace'
  | 'ExecuteProcess'
  | 'AccessNetwork'
  | 'ControlService'
  | 'DestructiveOperation'
  | 'SpawnSubtask'
  | 'IndexCodebase';


export interface ModePermissionsSummary {
  read_only: boolean;
  workspace_write: boolean;
  process_exec: boolean;
  network_access: boolean;
  service_control: boolean;
  destructive: boolean;
  can_spawn_subtasks: boolean;
  codebase_index: boolean;
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

export interface ChildTaskSourceIntentSummary {
  tool_id: string;
  required_action: RuntimeActionName;
  request_reason: string;
  requested_goal_preview?: string | null;
  requested_mode_id?: string | null;
  input_summary: ToolIntentInputSummary;
}

export interface RecoveryCycleChildProvenance {
  parent_join_admission_id: string;
  parent_join_child_completion_fingerprint: string;
  parent_join_child_completion_child_count: number;
  parent_join_terminal_failed_child_count: number;
  parent_join_terminal_completed_child_count: number;
  parent_join_recovery_cycle: boolean;
  parent_join_recovery_cycle_depth: number;
}

export interface BoundedCargoDiagnostic {
  tool_id: string;
  check_id: string;
  diagnostic_kind: string;
  severity: string;
  code?: string | null;
  workspace_relative_path?: string | null;
  line?: number | null;
  column?: number | null;
  truncated: boolean;
}

export interface VerificationRecoveryProvenance {
  source_task_id: string;
  source_run_id: string;
  failure_fingerprint: string;
  required_verifier_count: number;
  passed_verifier_count: number;
  failed_verifier_count: number;
  failed_verifier_tool_ids: string[];
  failure_reasons: string[];
  bounded_cargo_diagnostics?: BoundedCargoDiagnostic[];
}

export interface VerificationRecoveryRetryProvenance {
  source_task_id: string;
  source_run_id: string;
  recovery_task_id: string;
  recovery_run_id: string;
  proposal_id: string;
  apply_id: string;
  failure_fingerprint: string;
  apply_fingerprint: string;
  retried_verifier_tool_ids: string[];
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
  verificationRecoverySource?: VerificationRecoverySource | null;
  verificationRecoveryRetrySource?: VerificationRecoveryRetrySource | null;
}

export interface VerificationRecoverySource {
  source_task_id: string;
  source_run_id: string;
  expected_failure_fingerprint: string;
  authorize_recovery: boolean;
}

export interface VerificationRecoveryRetrySource {
  source_task_id: string;
  source_run_id: string;
  recovery_task_id: string;
  recovery_run_id: string;
  proposal_id: string;
  apply_id: string;
  expected_failure_fingerprint: string;
  expected_apply_fingerprint: string;
  authorize_verification_retry: boolean;
}

export interface TaskStartResult {
  task_id: string;
  run_id: string;
  status: TaskStatus;
  verification_recovery_admission?: VerificationRecoveryAdmission | null;
  verification_recovery_retry_admission?: VerificationRecoveryRetryAdmission | null;
}

export interface VerificationRecoveryAdmission {
  source_task_id: string;
  source_run_id: string;
  recovery_task_id: string;
  recovery_run_id: string;
  failure_fingerprint: string;
  recovery_running_enabled: boolean;
  next_action: string;
  replayed: boolean;
}

export interface VerificationRecoveryRetryAdmission {
  source_task_id: string;
  source_run_id: string;
  recovery_task_id: string;
  recovery_run_id: string;
  retry_task_id: string;
  retry_run_id: string;
  proposal_id: string;
  apply_id: string;
  failure_fingerprint: string;
  apply_fingerprint: string;
  retry_running_enabled: false;
  next_action: 'run_verification_retry_task_explicitly';
  replayed: boolean;
}

export interface TaskRunResult {
  task_id: string;
  run_id: string;
  status: TaskStatus;
  agent_loop: AgentLoopRunSummary;
  verification_completion_gate?: TaskRunVerificationCompletionGate | null;
  verification_recovery_repair?: TaskRunVerificationRecoveryRepairOutcome | null;
  verification_recovery_retry?: TaskRunVerificationRecoveryRetryOutcome | null;
  recovery_cycle_budget_outcome?: RecoveryCycleBudgetOutcome | null;
  child_orchestration_outcome?: TaskRunChildOrchestrationOutcome | null;
  parent_join_readiness_outcome?: TaskRunParentJoinReadinessOutcome | null;
}

export interface AgentLoopRunSummary {
  final_state: string;
  completion_summary: string;
}

export interface TaskRunVerificationCompletionGate {
  status: 'Passed' | 'Failed';
  requirement_id?: string | null;
  requirement_source_kind?: 'verification_recovery_retry_apply' | null;
  source_apply_id?: string | null;
  requirement_fingerprint?: string | null;
  required_verifier_count: number;
  passed_verifier_count: number;
  failed_verifier_count: number;
  required_verifier_tool_ids: string[];
  passed_verifier_tool_ids: string[];
  failed_verifier_tool_ids: string[];
  missing_verifier_tool_ids?: string[];
  failure_reasons: string[];
  bounded_cargo_diagnostics?: BoundedCargoDiagnostic[];
  next_action: 'complete_task' | 'inspect_verification_failure_and_retry_task';
}

export interface TaskRunVerificationRecoveryRepairOutcome {
  gate_status: 'Passed' | 'Failed';
  source_task_id: string;
  source_run_id: string;
  recovery_task_id: string;
  recovery_run_id: string;
  failure_fingerprint: string;
  failed_verifier_tool_ids: string[];
  proposal_id?: string | null;
  proposal_count: number;
  failure_reason?: 'MissingRecoveryRepairProposal' | 'AmbiguousRecoveryRepairProposals' | 'InvalidRecoveryRepairProvenance' | 'RecoveryRepairProposalNotApplicable' | null;
  replayed: boolean;
  apply_enabled: false;
  next_action: 'review_and_authorize_recovery_proposal' | 'inspect_recovery_repair_gate_failure';
}

export interface TaskRunVerificationRecoveryRetryOutcome {
  source_task_id: string;
  source_run_id: string;
  recovery_task_id: string;
  recovery_run_id: string;
  retry_task_id: string;
  retry_run_id: string;
  proposal_id: string;
  apply_id: string;
  failure_fingerprint: string;
  apply_fingerprint: string;
  retried_verifier_tool_ids: string[];
  passed_verifier_tool_ids: string[];
  failed_verifier_tool_ids: string[];
  retry_status: 'Passed' | 'Failed';
  replayed: boolean;
  next_action: 'complete_recovered_task' | 'inspect_verification_failure_and_retry_task';
}

export interface TaskRunChildOrchestrationOutcome {
  parent_run_id: string;
  materialized_child_task_ids: string[];
  materialized_child_count: number;
  queued_child_task_ids: string[];
  queued_child_count: number;
  child_running_enabled: false;
  next_action: 'run_child_task_explicitly';
}

export interface TaskRunParentJoinReadinessOutcome {
  parent_task_id: string;
  parent_run_id: string;
  child_task_id: string;
  child_run_id: string;
  child_terminal_status: 'Completed' | 'Failed';
  terminal_controlled_child_count: number;
  pending_controlled_child_count: number;
  pending_controlled_child_task_ids: string[];
  non_runnable_controlled_child_count: number;
  non_runnable_controlled_child_task_ids: string[];
  parent_join_ready: boolean;
  parent_running_enabled: false;
  next_action: 'run_parent_task_explicitly' | 'run_remaining_child_tasks_explicitly' | 'inspect_non_runnable_child_tasks';
}

export interface RunInspectParentJoinReadinessSummary {
  parent_task_id: string;
  parent_run_id: string;
  terminal_controlled_child_count: number;
  pending_controlled_child_count: number;
  pending_controlled_child_task_ids: string[];
  non_runnable_controlled_child_count: number;
  non_runnable_controlled_child_task_ids: string[];
  parent_join_ready: boolean;
  parent_running_enabled: false;
  next_action: 'run_parent_task_explicitly' | 'run_remaining_child_tasks_explicitly' | 'inspect_non_runnable_child_tasks';
}

export interface RunInspectConsumedParentJoinRecoverySummary {
  parent_task_id: string;
  parent_run_id: string;
  parent_join_consumed: true;
  consumed_terminal_controlled_child_count: number;
  continuation_controlled_child_count: number;
  continuation_runnable_child_count: number;
  continuation_runnable_child_task_ids: string[];
  continuation_non_runnable_child_count: number;
  continuation_non_runnable_child_task_ids: string[];
  continuation_terminal_child_count: number;
  parent_running_enabled: false;
  next_action: 'run_continuation_child_tasks_explicitly' | 'inspect_non_runnable_continuation_child_tasks' | 'inspect_parent_task';
}

export interface ChildInspectParentJoinReadinessSummary {
  parent_task_id: string;
  parent_run_id: string;
  inspected_child_task_id: string;
  inspected_child_run_id: string;
  inspected_child_status: TaskStatus;
  terminal_controlled_child_count: number;
  pending_controlled_child_count: number;
  pending_controlled_child_task_ids: string[];
  non_runnable_controlled_child_count: number;
  non_runnable_controlled_child_task_ids: string[];
  parent_join_ready: boolean;
  parent_running_enabled: false;
  next_action: 'run_parent_task_explicitly' | 'run_remaining_child_tasks_explicitly' | 'inspect_non_runnable_child_tasks';
}

export interface ChildInspectConsumedParentJoinRecoverySummary {
  parent_task_id: string;
  parent_run_id: string;
  inspected_child_task_id: string;
  inspected_child_run_id: string;
  inspected_child_status: TaskStatus;
  parent_join_consumed: true;
  consumed_terminal_controlled_child_count: number;
  continuation_controlled_child_count: number;
  continuation_runnable_child_count: number;
  continuation_runnable_child_task_ids: string[];
  continuation_non_runnable_child_count: number;
  continuation_non_runnable_child_task_ids: string[];
  continuation_terminal_child_count: number;
  parent_running_enabled: false;
  next_action: 'run_continuation_child_tasks_explicitly' | 'inspect_non_runnable_continuation_child_tasks' | 'inspect_parent_task';
}

export interface RecoveryCycleBudgetOutcome {
  recovery_cycle_budget_status: 'Exceeded';
  parent_join_admission_id: string;
  parent_join_recovery_cycle_depth: number;
  max_recovery_cycle_depth: number;
  blocked_candidate_count: number;
  child_materialization_enabled: false;
  child_running_enabled: false;
  next_action: string;
}

export interface TaskRecord {
  task_id: string;
  run_id: string;
  goal: string;
  mode_id?: string | null;
  status: TaskStatus;
  parent_task_id?: string | null;
  parent_run_id?: string | null;
  source_candidate_id?: string | null;
  source_handoff_envelope_id?: string | null;
  source_handoff_envelope_fingerprint?: string | null;
  source_intent_summary?: ChildTaskSourceIntentSummary | null;
  recovery_cycle_provenance?: RecoveryCycleChildProvenance | null;
  verification_recovery_provenance?: VerificationRecoveryProvenance | null;
  verification_recovery_retry_provenance?: VerificationRecoveryRetryProvenance | null;
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
  recovery_cycle_budget_outcome?: RecoveryCycleBudgetOutcome | null;
  parent_join_readiness_summary?: RunInspectParentJoinReadinessSummary | null;
  consumed_parent_join_recovery_summary?: RunInspectConsumedParentJoinRecoverySummary | null;
  child_task_count: number;
  child_task_ids: string[];
  child_tasks: ChildTaskInspectSummary[];
  event_count: number;
  has_tool_execution_completed: boolean;
  has_subtask_orchestration_queued: boolean;
  subtask_queue_count: number;
  has_subtask_handoff_prepared: boolean;
  subtask_handoff_count: number;
  has_subtask_scheduler_readiness: boolean;
  subtask_scheduler_readiness_count: number;
  has_subtask_dispatch_plan_prepared: boolean;
  subtask_dispatch_plan_count: number;
  has_subtask_dispatch_contract_prepared: boolean;
  subtask_dispatch_contract_count: number;
  has_subtask_dispatch_admission_evaluated: boolean;
  subtask_dispatch_admission_count: number;
  has_subtask_dispatch_readiness_snapshot: boolean;
  subtask_dispatch_readiness_snapshot_count: number;
  has_subtask_dispatcher_guard_verdict: boolean;
  subtask_dispatcher_guard_verdict_count: number;
  has_subtask_dispatch_decision: boolean;
  subtask_dispatch_decision_count: number;
  has_subtask_dispatch_candidate_manifest: boolean;
  subtask_dispatch_candidate_manifest_count: number;
  has_subtask_dispatch_handoff_envelope: boolean;
  subtask_dispatch_handoff_envelope_count: number;
  has_second_pass: boolean;
  final_response_preview?: string | null;
  timeline: string[];
}

export interface ChildTaskInspectSummary {
  task_id: string;
  run_id: string;
  status: TaskStatus;
  parent_task_id?: string | null;
  parent_run_id?: string | null;
  source_candidate_id?: string | null;
  source_handoff_envelope_id?: string | null;
  source_handoff_envelope_fingerprint?: string | null;
  source_intent_summary?: ChildTaskSourceIntentSummary | null;
  recovery_cycle_provenance?: RecoveryCycleChildProvenance | null;
  verification_recovery_provenance?: VerificationRecoveryProvenance | null;
  verification_recovery_retry_provenance?: VerificationRecoveryRetryProvenance | null;
  event_count: number;
  has_agent_loop_completed: boolean;
  completion_final_state?: string | null;
  completion_result_fingerprint?: string | null;
  completion_summary_preview?: string | null;
  final_response_preview?: string | null;
}

export interface RunEventsResult {
  run_id: string;
  events: LedgerEventSummary[];
}

export interface RunInspectResult {
  run: RunInspectSummary;
}

export interface CodebaseIndexBuildResult {
  snapshot: CodebaseIndexSnapshotSummary;
  persisted: boolean;
  ledger_event_id: string;
  ledger_event_kind: 'CodebaseIndexSnapshotBuilt';
  next_action: 'build_ignore_aware_sensitive_filtering';
}

export interface CodebaseIndexSnapshotManifest {
  snapshot: CodebaseIndexSnapshotSummary;
  entries: CodebaseIndexFileEntry[];
}

export interface CodebaseIndexSnapshotSummary {
  index_id: string;
  root: string;
  workspace_fingerprint: string;
  snapshot_fingerprint: string;
  built_at: string;
  counts: CodebaseIndexCountsSummary;
  limits: CodebaseIndexLimitsSummary;
  truncated: boolean;
}

export interface CodebaseIndexCountsSummary {
  indexed_files: number;
  walked_directories: number;
  skipped_protected: number;
  skipped_symlink: number;
  skipped_too_large: number;
  skipped_binary_like: number;
  skipped_unreadable: number;
  skipped_unsafe_path: number;
  skipped_other: number;
  truncated_entries: number;
  visited_entries: number;
  truncated_directories: number;
}

export interface CodebaseIndexLimitsSummary {
  max_files: number;
  max_directories: number;
  max_path_chars: number;
  max_file_bytes: number;
  max_visited_entries: number;
  max_directory_entries: number;
}

export interface CodebaseIndexFileEntry {
  path: string;
  file_kind: 'Rust' | 'TypeScript' | 'JavaScript' | 'Json' | 'Toml' | 'Markdown' | 'Yaml' | 'Shell' | 'Text' | 'Other';
  byte_length: number;
  line_count?: number | null;
  content_sha256?: string | null;
}

export interface TaskInspectResult {
  task: TaskRecord;
  run: RunInspectSummary;
  parent_join_readiness_summary?: ChildInspectParentJoinReadinessSummary | null;
  consumed_parent_join_recovery_summary?: ChildInspectConsumedParentJoinRecoverySummary | null;
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
  apply_supported: boolean;
  apply_enabled: boolean;
  mode: string;
  reason: string;
  required_gates: string[];
  can_apply_now: boolean;
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

export interface WorkspacePatchApplyResultSummary {
  proposal_id: string;
  apply_id: string;
  apply_status: string;
  apply_reason: string;
  authorization_id: string;
  authorization_consumed: boolean;
  applied: boolean;
  operation: string;
  atomic_replacement_completed: boolean;
  atomic_create_completed: boolean;
  atomic_delete_completed: boolean;
  path: string;
  expected_target_sha256: string | null;
  expected_target_absent: boolean | null;
  pre_write_target_sha256: string | null;
  pre_write_target_exists: boolean | null;
  post_write_sha256: string | null;
  post_delete_target_exists: boolean | null;
  content_chars: number;
  content_bytes: number;
  checked_at: string;
  applied_at: string | null;
  temp_file_cleaned: boolean;
  check_count: number;
  failed_checks: string[];
  blocked_checks: string[];
  checklist: WorkspacePatchApplyResultCheckSummary[];
}

export interface WorkspacePatchApplyResultCheckSummary {
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

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary {
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

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary {
  run_id: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_reason: string;
  report_count: number;
  latest_report: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary | null;
  entries: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary {
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

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary {
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

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary {
  run_id: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_reason: string;
  digest_count: number;
  latest_digest: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary | null;
  entries: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary {
  run_id: string;
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_reason: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  digest_status: 'Complete' | 'NeedsAction' | 'Blocked';
  digest_count: number;
  latest_digest: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary | null;
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

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary {
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

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary {
  run_id: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_reason: string;
  report_count: number;
  latest_report: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary | null;
  entries: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary {
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

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary {
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

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary {
  run_id: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_reason: string;
  digest_count: number;
  latest_digest: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary | null;
  entries: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary {
  run_id: string;
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_reason: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  digest_count: number;
  latest_digest: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary | null;
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

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary {
  report_id: string;
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
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

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary {
  run_id: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_reason: string;
  report_count: number;
  latest_report: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary | null;
  entries: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary {
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

export interface ProposalApplyResult {
  proposal: WorkspacePatchProposalSummary;
  apply_result: WorkspacePatchApplyResultSummary;
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

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary {
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

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary {
  run_id: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_reason: string;
  digest_count: number;
  latest_digest: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary | null;
  entries: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary[];
  apply_authorized: false;
  generated_at: string;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary {
  run_id: string;
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_reason: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  digest_count: number;
  latest_digest: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary | null;
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

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary {
  report_id: string;
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
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

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary {
  run_id: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_reason: string;
  report_count: number;
  latest_report: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary | null;
  entries: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary[];
  apply_authorized: false;
  generated_at: string;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary {
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

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary {
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

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary {
  run_id: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_reason: string;
  digest_count: number;
  latest_digest: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary | null;
  entries: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary[];
  apply_authorized: false;
  generated_at: string;
}

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary {
  run_id: string;
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
  report_reason: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  digest_count: number;
  latest_digest: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary | null;
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

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary {
  report_id: string;
  report_status: 'Complete' | 'NeedsAction' | 'Blocked';
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

export interface WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary {
  run_id: string;
  history_status: 'Complete' | 'NeedsAction' | 'Blocked';
  history_reason: string;
  report_count: number;
  latest_report: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary | null;
  entries: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary[];
  apply_authorized: false;
  generated_at: string;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary;
}

export interface ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
  review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history: WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary;
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
  return !Object.prototype.hasOwnProperty.call(value, 'content') && !Object.prototype.hasOwnProperty.call(value, 'raw_content') && !Object.prototype.hasOwnProperty.call(value, 'full_content') && !Object.prototype.hasOwnProperty.call(value, 'patch') && !Object.prototype.hasOwnProperty.call(value, 'diff') && !Object.prototype.hasOwnProperty.call(value, 'raw_input') && !Object.prototype.hasOwnProperty.call(value, 'canonical_path') && !Object.prototype.hasOwnProperty.call(value, 'absolute_path') && !Object.prototype.hasOwnProperty.call(value, 'file_content') && !Object.prototype.hasOwnProperty.call(value, 'command') && !Object.prototype.hasOwnProperty.call(value, 'stdout') && !Object.prototype.hasOwnProperty.call(value, 'stderr') && !Object.prototype.hasOwnProperty.call(value, 'env') && !Object.prototype.hasOwnProperty.call(value, 'request_body') && !Object.prototype.hasOwnProperty.call(value, 'serialized_request_body');
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
  return isRecord(value) && typeof value.proposal_id === 'string' && typeof value.capability_id === 'string' && typeof value.apply_supported === 'boolean' && typeof value.apply_enabled === 'boolean' && typeof value.mode === 'string' && typeof value.reason === 'string' && Array.isArray(value.required_gates) && value.required_gates.every((gate) => typeof gate === 'string') && typeof value.can_apply_now === 'boolean' && typeof value.checked_at === 'string' && isNonNegativeInteger(value.check_count) && Array.isArray(value.failed_checks) && value.failed_checks.every((check) => typeof check === 'string') && Array.isArray(value.blocked_checks) && value.blocked_checks.every((check) => typeof check === 'string') && Array.isArray(value.checklist) && value.checklist.every(isWorkspacePatchApplyCapabilityCheckSummary) && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchApplyDryRunCheckSummary(value: unknown): value is WorkspacePatchApplyDryRunCheckSummary {
  return isRecord(value) && typeof value.name === 'string' && (value.status === 'Pass' || value.status === 'Fail' || value.status === 'Blocked' || value.status === 'Skipped') && (typeof value.reason === 'string' || value.reason === null) && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchApplyDryRunSummary(value: unknown): value is WorkspacePatchApplyDryRunSummary {
  return isRecord(value) && typeof value.proposal_id === 'string' && typeof value.dry_run_id === 'string' && typeof value.dry_run_status === 'string' && typeof value.dry_run_reason === 'string' && typeof value.checked_at === 'string' && Array.isArray(value.required_gates) && value.required_gates.every((gate) => typeof gate === 'string') && isNonNegativeInteger(value.check_count) && Array.isArray(value.failed_checks) && value.failed_checks.every((check) => typeof check === 'string') && Array.isArray(value.blocked_checks) && value.blocked_checks.every((check) => typeof check === 'string') && value.no_patch_applied === true && value.apply_executed === false && value.workspace_files_changed === false && Array.isArray(value.checklist) && value.checklist.every(isWorkspacePatchApplyDryRunCheckSummary) && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchApplyResultCheckSummary(value: unknown): value is WorkspacePatchApplyResultCheckSummary {
  return isRecord(value) && typeof value.name === 'string' && (value.status === 'Pass' || value.status === 'Fail' || value.status === 'Blocked' || value.status === 'Skipped') && (typeof value.reason === 'string' || value.reason === null) && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchApplyResultSummary(value: unknown): value is WorkspacePatchApplyResultSummary {
  return isRecord(value) && typeof value.proposal_id === 'string' && typeof value.apply_id === 'string' && typeof value.apply_status === 'string' && typeof value.apply_reason === 'string' && typeof value.authorization_id === 'string' && typeof value.authorization_consumed === 'boolean' && typeof value.applied === 'boolean' && typeof value.operation === 'string' && typeof value.atomic_replacement_completed === 'boolean' && typeof value.atomic_create_completed === 'boolean' && typeof value.atomic_delete_completed === 'boolean' && typeof value.path === 'string' && (typeof value.expected_target_sha256 === 'string' || value.expected_target_sha256 === null) && (typeof value.expected_target_absent === 'boolean' || value.expected_target_absent === null) && (typeof value.pre_write_target_sha256 === 'string' || value.pre_write_target_sha256 === null) && (typeof value.pre_write_target_exists === 'boolean' || value.pre_write_target_exists === null) && (typeof value.post_write_sha256 === 'string' || value.post_write_sha256 === null) && (typeof value.post_delete_target_exists === 'boolean' || value.post_delete_target_exists === null) && isNonNegativeInteger(value.content_chars) && isNonNegativeInteger(value.content_bytes) && typeof value.checked_at === 'string' && (typeof value.applied_at === 'string' || value.applied_at === null) && typeof value.temp_file_cleaned === 'boolean' && isNonNegativeInteger(value.check_count) && Array.isArray(value.failed_checks) && value.failed_checks.every((check) => typeof check === 'string') && Array.isArray(value.blocked_checks) && value.blocked_checks.every((check) => typeof check === 'string') && Array.isArray(value.checklist) && value.checklist.every(isWorkspacePatchApplyResultCheckSummary) && hasNoForbiddenRawFields(value);
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

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary {
  return isRecord(value) && typeof value.report_id === 'string' && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && isNonNegativeInteger(value.digest_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && typeof value.history_reason === 'string' && isNonNegativeInteger(value.report_count) && (value.latest_report === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary(value.latest_report)) && Array.isArray(value.entries) && value.entries.every(isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary) && value.report_count === value.entries.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && typeof value.digest_reason === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && isNonNegativeInteger(value.report_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary {
  return isRecord(value) && typeof value.digest_id === 'string' && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && isNonNegativeInteger(value.report_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && typeof value.history_reason === 'string' && isNonNegativeInteger(value.digest_count) && (value.latest_digest === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary(value.latest_digest)) && Array.isArray(value.entries) && value.entries.every(isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary) && value.digest_count === value.entries.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary {
  return isRecord(value) && typeof value.digest_id === 'string' && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && isNonNegativeInteger(value.report_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && typeof value.history_reason === 'string' && isNonNegativeInteger(value.digest_count) && (value.latest_digest === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary(value.latest_digest)) && Array.isArray(value.entries) && value.entries.every(isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary) && value.digest_count === value.entries.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && typeof value.report_reason === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && isNonNegativeInteger(value.digest_count) && (value.latest_digest === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary(value.latest_digest)) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary {
  return isRecord(value) && typeof value.report_id === 'string' && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && isNonNegativeInteger(value.digest_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && typeof value.history_reason === 'string' && isNonNegativeInteger(value.report_count) && (value.latest_report === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary(value.latest_report)) && Array.isArray(value.entries) && value.entries.every(isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary) && value.report_count === value.entries.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && typeof value.digest_reason === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && isNonNegativeInteger(value.report_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary {
  return isRecord(value) && typeof value.digest_id === 'string' && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && isNonNegativeInteger(value.report_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && typeof value.history_reason === 'string' && isNonNegativeInteger(value.digest_count) && (value.latest_digest === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary(value.latest_digest)) && Array.isArray(value.entries) && value.entries.every(isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary) && value.digest_count === value.entries.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && typeof value.report_reason === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && isNonNegativeInteger(value.digest_count) && (value.latest_digest === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary(value.latest_digest)) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary {
  return isRecord(value) && typeof value.report_id === 'string' && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && isNonNegativeInteger(value.digest_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && typeof value.history_reason === 'string' && isNonNegativeInteger(value.report_count) && (value.latest_report === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary(value.latest_report)) && Array.isArray(value.entries) && value.entries.every(isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary) && value.report_count === value.entries.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && typeof value.digest_reason === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && isNonNegativeInteger(value.report_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary {
  return isRecord(value) && typeof value.digest_id === 'string' && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && isNonNegativeInteger(value.report_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && typeof value.history_reason === 'string' && isNonNegativeInteger(value.digest_count) && (value.latest_digest === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary(value.latest_digest)) && Array.isArray(value.entries) && value.entries.every(isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary) && value.digest_count === value.entries.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && typeof value.report_reason === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && isNonNegativeInteger(value.digest_count) && (value.latest_digest === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary(value.latest_digest)) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary {
  return isRecord(value) && typeof value.report_id === 'string' && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && isNonNegativeInteger(value.digest_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && typeof value.history_reason === 'string' && isNonNegativeInteger(value.report_count) && (value.latest_report === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary(value.latest_report)) && Array.isArray(value.entries) && value.entries.every(isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary) && value.report_count === value.entries.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.digest_status === 'Complete' || value.digest_status === 'NeedsAction' || value.digest_status === 'Blocked') && typeof value.digest_reason === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && isNonNegativeInteger(value.report_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
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

export function isProposalApplyResult(value: unknown): value is ProposalApplyResult {
  return isRecord(value) && isWorkspacePatchProposalSummary(value.proposal) && isWorkspacePatchApplyResultSummary(value.apply_result) && hasNoForbiddenRawFields(value);
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

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest) && hasNoForbiddenRawFields(value);
}

function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary {
  return (
    isRecord(value) &&
    typeof value.run_id === 'string' &&
    (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') &&
    typeof value.report_reason === 'string' &&
    (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') &&
    isNonNegativeInteger(value.digest_count) &&
    (value.latest_digest === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary(value.latest_digest)) &&
    isNonNegativeInteger(value.proposal_count) &&
    isNonNegativeInteger(value.complete_count) &&
    isNonNegativeInteger(value.needs_action_count) &&
    isNonNegativeInteger(value.blocked_count) &&
    isNonNegativeInteger(value.failed_check_count) &&
    isNonNegativeInteger(value.blocked_check_count) &&
    isNonNegativeInteger(value.required_next_action_count) &&
    Array.isArray(value.required_next_actions) &&
    value.required_next_actions.every((action) => typeof action === 'string') &&
    value.required_next_action_count === value.required_next_actions.length &&
    value.apply_authorized === false &&
    typeof value.generated_at === 'string' &&
    hasNoForbiddenRawFields(value)
  );
}

function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary {
  return isRecord(value) && typeof value.report_id === 'string' && (value.report_status === 'Complete' || value.report_status === 'NeedsAction' || value.report_status === 'Blocked') && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && isNonNegativeInteger(value.digest_count) && isNonNegativeInteger(value.proposal_count) && isNonNegativeInteger(value.complete_count) && isNonNegativeInteger(value.needs_action_count) && isNonNegativeInteger(value.blocked_count) && isNonNegativeInteger(value.failed_check_count) && isNonNegativeInteger(value.blocked_check_count) && isNonNegativeInteger(value.required_next_action_count) && Array.isArray(value.required_next_actions) && value.required_next_actions.every((action) => typeof action === 'string') && value.required_next_action_count === value.required_next_actions.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary(value: unknown): value is WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary {
  return isRecord(value) && typeof value.run_id === 'string' && (value.history_status === 'Complete' || value.history_status === 'NeedsAction' || value.history_status === 'Blocked') && typeof value.history_reason === 'string' && isNonNegativeInteger(value.report_count) && (value.latest_report === null || isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary(value.latest_report)) && Array.isArray(value.entries) && value.entries.every(isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary) && value.report_count === value.entries.length && value.apply_authorized === false && typeof value.generated_at === 'string' && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history) && hasNoForbiddenRawFields(value);
}

export function isProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult(value: unknown): value is ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
  return isRecord(value) && isWorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary(value.review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history) && hasNoForbiddenRawFields(value);
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

function isChildTaskSourceIntentSummary(value: unknown): value is ChildTaskSourceIntentSummary {
  return (
    isRecord(value) &&
    !Object.prototype.hasOwnProperty.call(value, 'input') &&
    typeof value.tool_id === 'string' &&
    isRuntimeActionName(value.required_action) &&
    typeof value.request_reason === 'string' &&
    (value.requested_goal_preview === undefined || value.requested_goal_preview === null || typeof value.requested_goal_preview === 'string') &&
    (value.requested_mode_id === undefined || value.requested_mode_id === null || typeof value.requested_mode_id === 'string') &&
    isToolIntentInputSummary(value.input_summary)
  );
}

const RECOVERY_CYCLE_CHILD_PROVENANCE_KEYS = new Set([
  'parent_join_admission_id',
  'parent_join_child_completion_fingerprint',
  'parent_join_child_completion_child_count',
  'parent_join_terminal_failed_child_count',
  'parent_join_terminal_completed_child_count',
  'parent_join_recovery_cycle',
  'parent_join_recovery_cycle_depth',
]);

const VERIFICATION_RECOVERY_PROVENANCE_KEYS = new Set([
  'source_task_id',
  'source_run_id',
  'failure_fingerprint',
  'required_verifier_count',
  'passed_verifier_count',
  'failed_verifier_count',
  'failed_verifier_tool_ids',
  'failure_reasons',
  'bounded_cargo_diagnostics',
]);

const MAX_BOUNDED_CARGO_DIAGNOSTICS = 5;

const BOUNDED_CARGO_DIAGNOSTIC_KEYS = new Set([
  'tool_id',
  'check_id',
  'diagnostic_kind',
  'severity',
  'code',
  'workspace_relative_path',
  'line',
  'column',
  'truncated',
]);

const VERIFICATION_RECOVERY_RETRY_PROVENANCE_KEYS = new Set([
  'source_task_id',
  'source_run_id',
  'recovery_task_id',
  'recovery_run_id',
  'proposal_id',
  'apply_id',
  'failure_fingerprint',
  'apply_fingerprint',
  'retried_verifier_tool_ids',
]);

const VERIFICATION_RECOVERY_ADMISSION_KEYS = new Set([
  'source_task_id',
  'source_run_id',
  'recovery_task_id',
  'recovery_run_id',
  'failure_fingerprint',
  'recovery_running_enabled',
  'next_action',
  'replayed',
]);

const VERIFICATION_RECOVERY_RETRY_ADMISSION_KEYS = new Set([
  'source_task_id',
  'source_run_id',
  'recovery_task_id',
  'recovery_run_id',
  'retry_task_id',
  'retry_run_id',
  'proposal_id',
  'apply_id',
  'failure_fingerprint',
  'apply_fingerprint',
  'retry_running_enabled',
  'next_action',
  'replayed',
]);

const TASK_RUN_VERIFICATION_RECOVERY_REPAIR_KEYS = new Set([
  'gate_status',
  'source_task_id',
  'source_run_id',
  'recovery_task_id',
  'recovery_run_id',
  'failure_fingerprint',
  'failed_verifier_tool_ids',
  'proposal_id',
  'proposal_count',
  'failure_reason',
  'replayed',
  'apply_enabled',
  'next_action',
]);

const TASK_RUN_VERIFICATION_RECOVERY_RETRY_KEYS = new Set([
  'source_task_id',
  'source_run_id',
  'recovery_task_id',
  'recovery_run_id',
  'retry_task_id',
  'retry_run_id',
  'proposal_id',
  'apply_id',
  'failure_fingerprint',
  'apply_fingerprint',
  'retried_verifier_tool_ids',
  'passed_verifier_tool_ids',
  'failed_verifier_tool_ids',
  'retry_status',
  'replayed',
  'next_action',
]);

const RECOVERY_CYCLE_BUDGET_OUTCOME_KEYS = new Set([
  'recovery_cycle_budget_status',
  'parent_join_admission_id',
  'parent_join_recovery_cycle_depth',
  'max_recovery_cycle_depth',
  'blocked_candidate_count',
  'child_materialization_enabled',
  'child_running_enabled',
  'next_action',
]);

const TASK_RUN_CHILD_ORCHESTRATION_OUTCOME_KEYS = new Set([
  'parent_run_id',
  'materialized_child_task_ids',
  'materialized_child_count',
  'queued_child_task_ids',
  'queued_child_count',
  'child_running_enabled',
  'next_action',
]);

const TASK_RUN_PARENT_JOIN_READINESS_OUTCOME_KEYS = new Set([
  'parent_task_id',
  'parent_run_id',
  'child_task_id',
  'child_run_id',
  'child_terminal_status',
  'terminal_controlled_child_count',
  'pending_controlled_child_count',
  'pending_controlled_child_task_ids',
  'non_runnable_controlled_child_count',
  'non_runnable_controlled_child_task_ids',
  'parent_join_ready',
  'parent_running_enabled',
  'next_action',
]);

const RUN_INSPECT_PARENT_JOIN_READINESS_SUMMARY_KEYS = new Set([
  'parent_task_id',
  'parent_run_id',
  'terminal_controlled_child_count',
  'pending_controlled_child_count',
  'pending_controlled_child_task_ids',
  'non_runnable_controlled_child_count',
  'non_runnable_controlled_child_task_ids',
  'parent_join_ready',
  'parent_running_enabled',
  'next_action',
]);

const RUN_INSPECT_CONSUMED_PARENT_JOIN_RECOVERY_SUMMARY_KEYS = new Set([
  'parent_task_id',
  'parent_run_id',
  'parent_join_consumed',
  'consumed_terminal_controlled_child_count',
  'continuation_controlled_child_count',
  'continuation_runnable_child_count',
  'continuation_runnable_child_task_ids',
  'continuation_non_runnable_child_count',
  'continuation_non_runnable_child_task_ids',
  'continuation_terminal_child_count',
  'parent_running_enabled',
  'next_action',
]);

const CHILD_INSPECT_PARENT_JOIN_READINESS_SUMMARY_KEYS = new Set([
  'parent_task_id',
  'parent_run_id',
  'inspected_child_task_id',
  'inspected_child_run_id',
  'inspected_child_status',
  'terminal_controlled_child_count',
  'pending_controlled_child_count',
  'pending_controlled_child_task_ids',
  'non_runnable_controlled_child_count',
  'non_runnable_controlled_child_task_ids',
  'parent_join_ready',
  'parent_running_enabled',
  'next_action',
]);

const CHILD_INSPECT_CONSUMED_PARENT_JOIN_RECOVERY_SUMMARY_KEYS = new Set([
  'parent_task_id',
  'parent_run_id',
  'inspected_child_task_id',
  'inspected_child_run_id',
  'inspected_child_status',
  'parent_join_consumed',
  'consumed_terminal_controlled_child_count',
  'continuation_controlled_child_count',
  'continuation_runnable_child_count',
  'continuation_runnable_child_task_ids',
  'continuation_non_runnable_child_count',
  'continuation_non_runnable_child_task_ids',
  'continuation_terminal_child_count',
  'parent_running_enabled',
  'next_action',
]);

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: Set<string>): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isSha256Fingerprint(value: string): boolean {
  return /^sha256:[0-9a-f]{64}$/.test(value);
}

export function isRecoveryCycleChildProvenance(value: unknown): value is RecoveryCycleChildProvenance {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, RECOVERY_CYCLE_CHILD_PROVENANCE_KEYS) &&
    typeof value.parent_join_admission_id === 'string' &&
    value.parent_join_admission_id.trim().length > 0 &&
    typeof value.parent_join_child_completion_fingerprint === 'string' &&
    isSha256Fingerprint(value.parent_join_child_completion_fingerprint) &&
    isNonNegativeInteger(value.parent_join_child_completion_child_count) &&
    isNonNegativeInteger(value.parent_join_terminal_failed_child_count) &&
    isNonNegativeInteger(value.parent_join_terminal_completed_child_count) &&
    value.parent_join_terminal_failed_child_count + value.parent_join_terminal_completed_child_count === value.parent_join_child_completion_child_count &&
    typeof value.parent_join_recovery_cycle === 'boolean' &&
    isNonNegativeInteger(value.parent_join_recovery_cycle_depth) &&
    ((value.parent_join_recovery_cycle && value.parent_join_recovery_cycle_depth >= 1) || (!value.parent_join_recovery_cycle && value.parent_join_recovery_cycle_depth === 0))
  );
}

function isBoundedCargoDiagnosticArray(value: unknown): value is BoundedCargoDiagnostic[] {
  return Array.isArray(value) && value.length <= MAX_BOUNDED_CARGO_DIAGNOSTICS && value.every(isBoundedCargoDiagnostic);
}

function isBoundedCargoDiagnostic(value: unknown): value is BoundedCargoDiagnostic {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, BOUNDED_CARGO_DIAGNOSTIC_KEYS) &&
    hasNoForbiddenRawFields(value) &&
    value.tool_id === 'verification.cargo_check' &&
    value.check_id === 'cargo_check' &&
    (value.diagnostic_kind === 'compile_error' || value.diagnostic_kind === 'compile_warning') &&
    (value.severity === 'error' || value.severity === 'warning') &&
    (value.code === undefined || value.code === null || isBoundedCargoDiagnosticCode(value.code)) &&
    typeof value.workspace_relative_path === 'string' &&
    isBoundedCargoDiagnosticPath(value.workspace_relative_path) &&
    isPositiveInteger(value.line) &&
    isPositiveInteger(value.column) &&
    typeof value.truncated === 'boolean'
  );
}

function isBoundedCargoDiagnosticCode(value: unknown): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value);
}

function isBoundedCargoDiagnosticPath(value: string): boolean {
  if (value.length === 0 || value.length > 240 || value.startsWith('/') || value.includes('\\') || value.includes('\0')) {
    return false;
  }
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..' && segment !== '.git' && segment !== '.brownie' && segment !== 'node_modules' && segment !== 'target');
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function isVerificationRecoveryProvenance(value: unknown): value is VerificationRecoveryProvenance {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, VERIFICATION_RECOVERY_PROVENANCE_KEYS) &&
    typeof value.source_task_id === 'string' &&
    value.source_task_id.trim().length > 0 &&
    typeof value.source_run_id === 'string' &&
    value.source_run_id.trim().length > 0 &&
    typeof value.failure_fingerprint === 'string' &&
    isSha256Fingerprint(value.failure_fingerprint) &&
    isNonNegativeInteger(value.required_verifier_count) &&
    isNonNegativeInteger(value.passed_verifier_count) &&
    isNonNegativeInteger(value.failed_verifier_count) &&
    value.passed_verifier_count + value.failed_verifier_count === value.required_verifier_count &&
    isStringArray(value.failed_verifier_tool_ids) &&
    value.failed_verifier_tool_ids.length === value.failed_verifier_count &&
    isStringArray(value.failure_reasons) &&
    (value.bounded_cargo_diagnostics === undefined || isBoundedCargoDiagnosticArray(value.bounded_cargo_diagnostics))
  );
}

export function isVerificationRecoveryRetryProvenance(value: unknown): value is VerificationRecoveryRetryProvenance {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, VERIFICATION_RECOVERY_RETRY_PROVENANCE_KEYS) &&
    typeof value.source_task_id === 'string' &&
    value.source_task_id.trim().length > 0 &&
    typeof value.source_run_id === 'string' &&
    value.source_run_id.trim().length > 0 &&
    typeof value.recovery_task_id === 'string' &&
    value.recovery_task_id.trim().length > 0 &&
    typeof value.recovery_run_id === 'string' &&
    value.recovery_run_id.trim().length > 0 &&
    typeof value.proposal_id === 'string' &&
    value.proposal_id.trim().length > 0 &&
    typeof value.apply_id === 'string' &&
    value.apply_id.trim().length > 0 &&
    typeof value.failure_fingerprint === 'string' &&
    isSha256Fingerprint(value.failure_fingerprint) &&
    typeof value.apply_fingerprint === 'string' &&
    isSha256Fingerprint(value.apply_fingerprint) &&
    isStringArray(value.retried_verifier_tool_ids) &&
    value.retried_verifier_tool_ids.length > 0
  );
}

export function isVerificationRecoveryAdmission(value: unknown): value is VerificationRecoveryAdmission {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, VERIFICATION_RECOVERY_ADMISSION_KEYS) &&
    typeof value.source_task_id === 'string' &&
    value.source_task_id.trim().length > 0 &&
    typeof value.source_run_id === 'string' &&
    value.source_run_id.trim().length > 0 &&
    typeof value.recovery_task_id === 'string' &&
    value.recovery_task_id.trim().length > 0 &&
    typeof value.recovery_run_id === 'string' &&
    value.recovery_run_id.trim().length > 0 &&
    typeof value.failure_fingerprint === 'string' &&
    isSha256Fingerprint(value.failure_fingerprint) &&
    value.recovery_running_enabled === false &&
    value.next_action === 'run_recovery_task_explicitly' &&
    typeof value.replayed === 'boolean'
  );
}

export function isVerificationRecoveryRetryAdmission(value: unknown): value is VerificationRecoveryRetryAdmission {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, VERIFICATION_RECOVERY_RETRY_ADMISSION_KEYS) &&
    typeof value.source_task_id === 'string' &&
    value.source_task_id.trim().length > 0 &&
    typeof value.source_run_id === 'string' &&
    value.source_run_id.trim().length > 0 &&
    typeof value.recovery_task_id === 'string' &&
    value.recovery_task_id.trim().length > 0 &&
    typeof value.recovery_run_id === 'string' &&
    value.recovery_run_id.trim().length > 0 &&
    typeof value.retry_task_id === 'string' &&
    value.retry_task_id.trim().length > 0 &&
    typeof value.retry_run_id === 'string' &&
    value.retry_run_id.trim().length > 0 &&
    typeof value.proposal_id === 'string' &&
    value.proposal_id.trim().length > 0 &&
    typeof value.apply_id === 'string' &&
    value.apply_id.trim().length > 0 &&
    typeof value.failure_fingerprint === 'string' &&
    isSha256Fingerprint(value.failure_fingerprint) &&
    typeof value.apply_fingerprint === 'string' &&
    isSha256Fingerprint(value.apply_fingerprint) &&
    value.retry_running_enabled === false &&
    value.next_action === 'run_verification_retry_task_explicitly' &&
    typeof value.replayed === 'boolean'
  );
}

export function isTaskRunVerificationRecoveryRepairOutcome(value: unknown): value is TaskRunVerificationRecoveryRepairOutcome {
  const recoveryRepairFailureReasons = new Set([
    'MissingRecoveryRepairProposal',
    'AmbiguousRecoveryRepairProposals',
    'InvalidRecoveryRepairProvenance',
    'RecoveryRepairProposalNotApplicable',
  ]);
  const proposalIdIsPresent = isRecord(value) && typeof value.proposal_id === 'string' && value.proposal_id.trim().length > 0;
  const proposalIdIsAbsent = isRecord(value) && (value.proposal_id === undefined || value.proposal_id === null);
  const passedRepairGate = isRecord(value) &&
    value.gate_status === 'Passed' &&
    proposalIdIsPresent &&
    value.proposal_count === 1 &&
    (value.failure_reason === undefined || value.failure_reason === null) &&
    value.next_action === 'review_and_authorize_recovery_proposal';
  const failedRepairReason = isRecord(value) && typeof value.failure_reason === 'string' ? value.failure_reason : null;
  const failedRepairProposalCountMatches = isRecord(value) &&
    isNonNegativeInteger(value.proposal_count) &&
    (failedRepairReason === 'RecoveryRepairProposalNotApplicable'
      ? value.proposal_count > 0
      : value.proposal_count === 0 || value.proposal_count > 1);
  const failedRepairGate = isRecord(value) &&
    value.gate_status === 'Failed' &&
    proposalIdIsAbsent &&
    failedRepairProposalCountMatches &&
    typeof value.failure_reason === 'string' &&
    recoveryRepairFailureReasons.has(value.failure_reason) &&
    value.next_action === 'inspect_recovery_repair_gate_failure';
  return (
    isRecord(value) &&
    hasOnlyKeys(value, TASK_RUN_VERIFICATION_RECOVERY_REPAIR_KEYS) &&
    hasNoForbiddenRawFields(value) &&
    (value.gate_status === 'Passed' || value.gate_status === 'Failed') &&
    typeof value.source_task_id === 'string' &&
    value.source_task_id.trim().length > 0 &&
    typeof value.source_run_id === 'string' &&
    value.source_run_id.trim().length > 0 &&
    typeof value.recovery_task_id === 'string' &&
    value.recovery_task_id.trim().length > 0 &&
    typeof value.recovery_run_id === 'string' &&
    value.recovery_run_id.trim().length > 0 &&
    typeof value.failure_fingerprint === 'string' &&
    isSha256Fingerprint(value.failure_fingerprint) &&
    isStringArray(value.failed_verifier_tool_ids) &&
    value.failed_verifier_tool_ids.length > 0 &&
    isNonNegativeInteger(value.proposal_count) &&
    typeof value.replayed === 'boolean' &&
    value.apply_enabled === false &&
    (passedRepairGate || failedRepairGate)
  );
}

export function isTaskRunVerificationRecoveryRetryOutcome(value: unknown): value is TaskRunVerificationRecoveryRetryOutcome {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, TASK_RUN_VERIFICATION_RECOVERY_RETRY_KEYS) &&
    hasNoForbiddenRawFields(value) &&
    typeof value.source_task_id === 'string' &&
    value.source_task_id.trim().length > 0 &&
    typeof value.source_run_id === 'string' &&
    value.source_run_id.trim().length > 0 &&
    typeof value.recovery_task_id === 'string' &&
    value.recovery_task_id.trim().length > 0 &&
    typeof value.recovery_run_id === 'string' &&
    value.recovery_run_id.trim().length > 0 &&
    typeof value.retry_task_id === 'string' &&
    value.retry_task_id.trim().length > 0 &&
    typeof value.retry_run_id === 'string' &&
    value.retry_run_id.trim().length > 0 &&
    typeof value.proposal_id === 'string' &&
    value.proposal_id.trim().length > 0 &&
    typeof value.apply_id === 'string' &&
    value.apply_id.trim().length > 0 &&
    typeof value.failure_fingerprint === 'string' &&
    isSha256Fingerprint(value.failure_fingerprint) &&
    typeof value.apply_fingerprint === 'string' &&
    isSha256Fingerprint(value.apply_fingerprint) &&
    isStringArray(value.retried_verifier_tool_ids) &&
    value.retried_verifier_tool_ids.length > 0 &&
    isStringArray(value.passed_verifier_tool_ids) &&
    isStringArray(value.failed_verifier_tool_ids) &&
    value.passed_verifier_tool_ids.length + value.failed_verifier_tool_ids.length === value.retried_verifier_tool_ids.length &&
    (value.retry_status === 'Passed' || value.retry_status === 'Failed') &&
    typeof value.replayed === 'boolean' &&
    (value.next_action === 'complete_recovered_task' || value.next_action === 'inspect_verification_failure_and_retry_task')
  );
}

export function isRecoveryCycleBudgetOutcome(value: unknown): value is RecoveryCycleBudgetOutcome {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, RECOVERY_CYCLE_BUDGET_OUTCOME_KEYS) &&
    value.recovery_cycle_budget_status === 'Exceeded' &&
    typeof value.parent_join_admission_id === 'string' &&
    value.parent_join_admission_id.trim().length > 0 &&
    isNonNegativeInteger(value.parent_join_recovery_cycle_depth) &&
    value.parent_join_recovery_cycle_depth > 0 &&
    isNonNegativeInteger(value.max_recovery_cycle_depth) &&
    isNonNegativeInteger(value.blocked_candidate_count) &&
    value.blocked_candidate_count > 0 &&
    value.child_materialization_enabled === false &&
    value.child_running_enabled === false &&
    typeof value.next_action === 'string' &&
    value.next_action.trim().length > 0
  );
}

export function isTaskRunChildOrchestrationOutcome(value: unknown): value is TaskRunChildOrchestrationOutcome {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, TASK_RUN_CHILD_ORCHESTRATION_OUTCOME_KEYS) ||
    typeof value.parent_run_id !== 'string' ||
    value.parent_run_id.trim().length === 0
  ) {
    return false;
  }
  const materializedChildTaskIds = value.materialized_child_task_ids;
  const queuedChildTaskIds = value.queued_child_task_ids;

  return (
    Array.isArray(materializedChildTaskIds) &&
    materializedChildTaskIds.length > 0 &&
    materializedChildTaskIds.every((taskId) => typeof taskId === 'string' && taskId.trim().length > 0) &&
    isNonNegativeInteger(value.materialized_child_count) &&
    value.materialized_child_count === materializedChildTaskIds.length &&
    Array.isArray(queuedChildTaskIds) &&
    queuedChildTaskIds.length > 0 &&
    queuedChildTaskIds.every((taskId) => typeof taskId === 'string' && materializedChildTaskIds.includes(taskId)) &&
    isNonNegativeInteger(value.queued_child_count) &&
    value.queued_child_count === queuedChildTaskIds.length &&
    value.child_running_enabled === false &&
    value.next_action === 'run_child_task_explicitly'
  );
}

export function isTaskRunParentJoinReadinessOutcome(value: unknown): value is TaskRunParentJoinReadinessOutcome {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, TASK_RUN_PARENT_JOIN_READINESS_OUTCOME_KEYS) ||
    typeof value.parent_task_id !== 'string' ||
    value.parent_task_id.trim().length === 0 ||
    typeof value.parent_run_id !== 'string' ||
    value.parent_run_id.trim().length === 0 ||
    typeof value.child_task_id !== 'string' ||
    value.child_task_id.trim().length === 0 ||
    typeof value.child_run_id !== 'string' ||
    value.child_run_id.trim().length === 0 ||
    (value.child_terminal_status !== 'Completed' && value.child_terminal_status !== 'Failed') ||
    !isNonNegativeInteger(value.terminal_controlled_child_count) ||
    value.terminal_controlled_child_count === 0 ||
    !isNonNegativeInteger(value.pending_controlled_child_count) ||
    !Array.isArray(value.pending_controlled_child_task_ids) ||
    !value.pending_controlled_child_task_ids.every((taskId) => typeof taskId === 'string' && taskId.trim().length > 0 && taskId !== value.child_task_id) ||
    new Set(value.pending_controlled_child_task_ids).size !== value.pending_controlled_child_task_ids.length ||
    value.pending_controlled_child_count !== value.pending_controlled_child_task_ids.length ||
    !isNonNegativeInteger(value.non_runnable_controlled_child_count) ||
    !Array.isArray(value.non_runnable_controlled_child_task_ids) ||
    !value.non_runnable_controlled_child_task_ids.every((taskId) => typeof taskId === 'string' && taskId.trim().length > 0 && taskId !== value.child_task_id) ||
    new Set(value.non_runnable_controlled_child_task_ids).size !== value.non_runnable_controlled_child_task_ids.length ||
    value.non_runnable_controlled_child_count !== value.non_runnable_controlled_child_task_ids.length ||
    typeof value.parent_join_ready !== 'boolean' ||
    value.parent_running_enabled !== false
  ) {
    return false;
  }
  const pendingControlledChildTaskIds = value.pending_controlled_child_task_ids as string[];
  const nonRunnableControlledChildTaskIds = value.non_runnable_controlled_child_task_ids as string[];
  if (nonRunnableControlledChildTaskIds.some((taskId) => pendingControlledChildTaskIds.includes(taskId))) {
    return false;
  }
  if (value.non_runnable_controlled_child_count > 0) {
    return value.parent_join_ready === false && value.next_action === 'inspect_non_runnable_child_tasks';
  }
  if (value.pending_controlled_child_count === 0) {
    return value.parent_join_ready === true && value.next_action === 'run_parent_task_explicitly';
  }
  return value.parent_join_ready === false && value.next_action === 'run_remaining_child_tasks_explicitly';
}

export function isRunInspectParentJoinReadinessSummary(value: unknown): value is RunInspectParentJoinReadinessSummary {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, RUN_INSPECT_PARENT_JOIN_READINESS_SUMMARY_KEYS) ||
    typeof value.parent_task_id !== 'string' ||
    value.parent_task_id.trim().length === 0 ||
    typeof value.parent_run_id !== 'string' ||
    value.parent_run_id.trim().length === 0 ||
    !isNonNegativeInteger(value.terminal_controlled_child_count) ||
    !isNonNegativeInteger(value.pending_controlled_child_count) ||
    !Array.isArray(value.pending_controlled_child_task_ids) ||
    !value.pending_controlled_child_task_ids.every((taskId) => typeof taskId === 'string' && taskId.trim().length > 0) ||
    new Set(value.pending_controlled_child_task_ids).size !== value.pending_controlled_child_task_ids.length ||
    value.pending_controlled_child_count !== value.pending_controlled_child_task_ids.length ||
    !isNonNegativeInteger(value.non_runnable_controlled_child_count) ||
    !Array.isArray(value.non_runnable_controlled_child_task_ids) ||
    !value.non_runnable_controlled_child_task_ids.every((taskId) => typeof taskId === 'string' && taskId.trim().length > 0) ||
    new Set(value.non_runnable_controlled_child_task_ids).size !== value.non_runnable_controlled_child_task_ids.length ||
    value.non_runnable_controlled_child_count !== value.non_runnable_controlled_child_task_ids.length ||
    typeof value.parent_join_ready !== 'boolean' ||
    value.parent_running_enabled !== false
  ) {
    return false;
  }
  const pendingControlledChildTaskIds = value.pending_controlled_child_task_ids as string[];
  const nonRunnableControlledChildTaskIds = value.non_runnable_controlled_child_task_ids as string[];
  if (nonRunnableControlledChildTaskIds.some((taskId) => pendingControlledChildTaskIds.includes(taskId))) {
    return false;
  }
  if (value.non_runnable_controlled_child_count > 0) {
    return value.parent_join_ready === false && value.next_action === 'inspect_non_runnable_child_tasks';
  }
  if (value.pending_controlled_child_count === 0) {
    return value.terminal_controlled_child_count > 0 && value.parent_join_ready === true && value.next_action === 'run_parent_task_explicitly';
  }
  return value.parent_join_ready === false && value.next_action === 'run_remaining_child_tasks_explicitly';
}

export function isRunInspectConsumedParentJoinRecoverySummary(value: unknown): value is RunInspectConsumedParentJoinRecoverySummary {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, RUN_INSPECT_CONSUMED_PARENT_JOIN_RECOVERY_SUMMARY_KEYS) ||
    typeof value.parent_task_id !== 'string' ||
    value.parent_task_id.trim().length === 0 ||
    typeof value.parent_run_id !== 'string' ||
    value.parent_run_id.trim().length === 0 ||
    value.parent_join_consumed !== true ||
    !isNonNegativeInteger(value.consumed_terminal_controlled_child_count) ||
    value.consumed_terminal_controlled_child_count === 0 ||
    !isNonNegativeInteger(value.continuation_controlled_child_count) ||
    !isNonNegativeInteger(value.continuation_runnable_child_count) ||
    !Array.isArray(value.continuation_runnable_child_task_ids) ||
    !value.continuation_runnable_child_task_ids.every((taskId) => typeof taskId === 'string' && taskId.trim().length > 0) ||
    new Set(value.continuation_runnable_child_task_ids).size !== value.continuation_runnable_child_task_ids.length ||
    value.continuation_runnable_child_count !== value.continuation_runnable_child_task_ids.length ||
    !isNonNegativeInteger(value.continuation_non_runnable_child_count) ||
    !Array.isArray(value.continuation_non_runnable_child_task_ids) ||
    !value.continuation_non_runnable_child_task_ids.every((taskId) => typeof taskId === 'string' && taskId.trim().length > 0) ||
    new Set(value.continuation_non_runnable_child_task_ids).size !== value.continuation_non_runnable_child_task_ids.length ||
    value.continuation_non_runnable_child_count !== value.continuation_non_runnable_child_task_ids.length ||
    !isNonNegativeInteger(value.continuation_terminal_child_count) ||
    value.continuation_controlled_child_count !== value.continuation_runnable_child_count + value.continuation_non_runnable_child_count + value.continuation_terminal_child_count ||
    value.parent_running_enabled !== false
  ) {
    return false;
  }
  const runnableChildTaskIds = value.continuation_runnable_child_task_ids as string[];
  const nonRunnableChildTaskIds = value.continuation_non_runnable_child_task_ids as string[];
  if (nonRunnableChildTaskIds.some((taskId) => runnableChildTaskIds.includes(taskId))) {
    return false;
  }
  if (value.next_action === 'run_parent_task_explicitly') {
    return false;
  }
  if (value.continuation_non_runnable_child_count > 0) {
    return value.next_action === 'inspect_non_runnable_continuation_child_tasks';
  }
  if (value.continuation_runnable_child_count > 0) {
    return value.next_action === 'run_continuation_child_tasks_explicitly';
  }
  return value.next_action === 'inspect_parent_task';
}

export function isChildInspectParentJoinReadinessSummary(value: unknown): value is ChildInspectParentJoinReadinessSummary {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, CHILD_INSPECT_PARENT_JOIN_READINESS_SUMMARY_KEYS) ||
    typeof value.parent_task_id !== 'string' ||
    value.parent_task_id.trim().length === 0 ||
    typeof value.parent_run_id !== 'string' ||
    value.parent_run_id.trim().length === 0 ||
    typeof value.inspected_child_task_id !== 'string' ||
    value.inspected_child_task_id.trim().length === 0 ||
    typeof value.inspected_child_run_id !== 'string' ||
    value.inspected_child_run_id.trim().length === 0 ||
    !isTaskStatus(value.inspected_child_status) ||
    !isNonNegativeInteger(value.terminal_controlled_child_count) ||
    !isNonNegativeInteger(value.pending_controlled_child_count) ||
    !Array.isArray(value.pending_controlled_child_task_ids) ||
    !value.pending_controlled_child_task_ids.every((taskId) => typeof taskId === 'string' && taskId.trim().length > 0) ||
    new Set(value.pending_controlled_child_task_ids).size !== value.pending_controlled_child_task_ids.length ||
    value.pending_controlled_child_count !== value.pending_controlled_child_task_ids.length ||
    !isNonNegativeInteger(value.non_runnable_controlled_child_count) ||
    !Array.isArray(value.non_runnable_controlled_child_task_ids) ||
    !value.non_runnable_controlled_child_task_ids.every((taskId) => typeof taskId === 'string' && taskId.trim().length > 0) ||
    new Set(value.non_runnable_controlled_child_task_ids).size !== value.non_runnable_controlled_child_task_ids.length ||
    value.non_runnable_controlled_child_count !== value.non_runnable_controlled_child_task_ids.length ||
    typeof value.parent_join_ready !== 'boolean' ||
    value.parent_running_enabled !== false
  ) {
    return false;
  }
  const pendingControlledChildTaskIds = value.pending_controlled_child_task_ids as string[];
  const nonRunnableControlledChildTaskIds = value.non_runnable_controlled_child_task_ids as string[];
  if (nonRunnableControlledChildTaskIds.some((taskId) => pendingControlledChildTaskIds.includes(taskId))) {
    return false;
  }
  if (value.non_runnable_controlled_child_count > 0) {
    return value.parent_join_ready === false && value.next_action === 'inspect_non_runnable_child_tasks';
  }
  if (value.pending_controlled_child_count === 0) {
    return value.terminal_controlled_child_count > 0 && value.parent_join_ready === true && value.next_action === 'run_parent_task_explicitly';
  }
  return value.parent_join_ready === false && value.next_action === 'run_remaining_child_tasks_explicitly';
}

export function isChildInspectConsumedParentJoinRecoverySummary(value: unknown): value is ChildInspectConsumedParentJoinRecoverySummary {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, CHILD_INSPECT_CONSUMED_PARENT_JOIN_RECOVERY_SUMMARY_KEYS) ||
    typeof value.parent_task_id !== 'string' ||
    value.parent_task_id.trim().length === 0 ||
    typeof value.parent_run_id !== 'string' ||
    value.parent_run_id.trim().length === 0 ||
    typeof value.inspected_child_task_id !== 'string' ||
    value.inspected_child_task_id.trim().length === 0 ||
    typeof value.inspected_child_run_id !== 'string' ||
    value.inspected_child_run_id.trim().length === 0 ||
    !isTaskStatus(value.inspected_child_status) ||
    value.parent_join_consumed !== true ||
    !isNonNegativeInteger(value.consumed_terminal_controlled_child_count) ||
    value.consumed_terminal_controlled_child_count === 0 ||
    !isNonNegativeInteger(value.continuation_controlled_child_count) ||
    !isNonNegativeInteger(value.continuation_runnable_child_count) ||
    !Array.isArray(value.continuation_runnable_child_task_ids) ||
    !value.continuation_runnable_child_task_ids.every((taskId) => typeof taskId === 'string' && taskId.trim().length > 0) ||
    new Set(value.continuation_runnable_child_task_ids).size !== value.continuation_runnable_child_task_ids.length ||
    value.continuation_runnable_child_count !== value.continuation_runnable_child_task_ids.length ||
    !isNonNegativeInteger(value.continuation_non_runnable_child_count) ||
    !Array.isArray(value.continuation_non_runnable_child_task_ids) ||
    !value.continuation_non_runnable_child_task_ids.every((taskId) => typeof taskId === 'string' && taskId.trim().length > 0) ||
    new Set(value.continuation_non_runnable_child_task_ids).size !== value.continuation_non_runnable_child_task_ids.length ||
    value.continuation_non_runnable_child_count !== value.continuation_non_runnable_child_task_ids.length ||
    !isNonNegativeInteger(value.continuation_terminal_child_count) ||
    value.continuation_controlled_child_count !== value.continuation_runnable_child_count + value.continuation_non_runnable_child_count + value.continuation_terminal_child_count ||
    value.parent_running_enabled !== false
  ) {
    return false;
  }
  const runnableChildTaskIds = value.continuation_runnable_child_task_ids as string[];
  const nonRunnableChildTaskIds = value.continuation_non_runnable_child_task_ids as string[];
  if (nonRunnableChildTaskIds.some((taskId) => runnableChildTaskIds.includes(taskId))) {
    return false;
  }
  if (value.next_action === 'run_parent_task_explicitly') {
    return false;
  }
  if (value.continuation_non_runnable_child_count > 0) {
    return value.next_action === 'inspect_non_runnable_continuation_child_tasks';
  }
  if (value.continuation_runnable_child_count > 0) {
    return value.next_action === 'run_continuation_child_tasks_explicitly';
  }
  return value.next_action === 'inspect_parent_task';
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
    isTaskStatus(value.status) &&
    (value.verification_recovery_admission === undefined || value.verification_recovery_admission === null || isVerificationRecoveryAdmission(value.verification_recovery_admission))
    && (value.verification_recovery_retry_admission === undefined || value.verification_recovery_retry_admission === null || isVerificationRecoveryRetryAdmission(value.verification_recovery_retry_admission))
  );
}

export function isTaskRunResult(value: unknown): value is TaskRunResult {
  return (
    isRecord(value) &&
    typeof value.task_id === 'string' &&
    typeof value.run_id === 'string' &&
    isTaskStatus(value.status) &&
    isAgentLoopRunSummary(value.agent_loop) &&
    (value.verification_completion_gate === undefined || value.verification_completion_gate === null || isTaskRunVerificationCompletionGate(value.verification_completion_gate)) &&
    (value.verification_recovery_repair === undefined || value.verification_recovery_repair === null || isTaskRunVerificationRecoveryRepairOutcome(value.verification_recovery_repair)) &&
    (value.verification_recovery_retry === undefined || value.verification_recovery_retry === null || isTaskRunVerificationRecoveryRetryOutcome(value.verification_recovery_retry)) &&
    (value.recovery_cycle_budget_outcome === undefined || value.recovery_cycle_budget_outcome === null || isRecoveryCycleBudgetOutcome(value.recovery_cycle_budget_outcome)) &&
    (value.child_orchestration_outcome === undefined || value.child_orchestration_outcome === null || isTaskRunChildOrchestrationOutcome(value.child_orchestration_outcome)) &&
    (value.parent_join_readiness_outcome === undefined || value.parent_join_readiness_outcome === null || isTaskRunParentJoinReadinessOutcome(value.parent_join_readiness_outcome))
  );
}

export function isAgentLoopRunSummary(value: unknown): value is AgentLoopRunSummary {
  return (
    isRecord(value) &&
    typeof value.final_state === 'string' &&
    typeof value.completion_summary === 'string'
  );
}

export function isTaskRunVerificationCompletionGate(value: unknown): value is TaskRunVerificationCompletionGate {
  return (
    isRecord(value) &&
    (value.status === 'Passed' || value.status === 'Failed') &&
    (value.requirement_id === undefined || value.requirement_id === null || (typeof value.requirement_id === 'string' && value.requirement_id.trim().length > 0)) &&
    (value.requirement_source_kind === undefined || value.requirement_source_kind === null || value.requirement_source_kind === 'verification_recovery_retry_apply') &&
    (value.source_apply_id === undefined || value.source_apply_id === null || (typeof value.source_apply_id === 'string' && value.source_apply_id.trim().length > 0)) &&
    (value.requirement_fingerprint === undefined || value.requirement_fingerprint === null || (typeof value.requirement_fingerprint === 'string' && isSha256Fingerprint(value.requirement_fingerprint))) &&
    typeof value.required_verifier_count === 'number' &&
    typeof value.passed_verifier_count === 'number' &&
    typeof value.failed_verifier_count === 'number' &&
    isStringArray(value.required_verifier_tool_ids) &&
    isStringArray(value.passed_verifier_tool_ids) &&
    isStringArray(value.failed_verifier_tool_ids) &&
    (value.missing_verifier_tool_ids === undefined || isStringArray(value.missing_verifier_tool_ids)) &&
    isStringArray(value.failure_reasons) &&
    (value.bounded_cargo_diagnostics === undefined || isBoundedCargoDiagnosticArray(value.bounded_cargo_diagnostics)) &&
    (value.next_action === 'complete_task' || value.next_action === 'inspect_verification_failure_and_retry_task')
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
    (value.parent_task_id === undefined || value.parent_task_id === null || typeof value.parent_task_id === 'string') &&
    (value.parent_run_id === undefined || value.parent_run_id === null || typeof value.parent_run_id === 'string') &&
    (value.source_candidate_id === undefined || value.source_candidate_id === null || typeof value.source_candidate_id === 'string') &&
    (value.source_handoff_envelope_id === undefined || value.source_handoff_envelope_id === null || typeof value.source_handoff_envelope_id === 'string') &&
    (value.source_handoff_envelope_fingerprint === undefined || value.source_handoff_envelope_fingerprint === null || typeof value.source_handoff_envelope_fingerprint === 'string') &&
    (value.source_intent_summary === undefined || value.source_intent_summary === null || isChildTaskSourceIntentSummary(value.source_intent_summary)) &&
    (value.recovery_cycle_provenance === undefined || value.recovery_cycle_provenance === null || isRecoveryCycleChildProvenance(value.recovery_cycle_provenance)) &&
    (value.verification_recovery_provenance === undefined || value.verification_recovery_provenance === null || isVerificationRecoveryProvenance(value.verification_recovery_provenance)) &&
    (value.verification_recovery_retry_provenance === undefined || value.verification_recovery_retry_provenance === null || isVerificationRecoveryRetryProvenance(value.verification_recovery_retry_provenance)) &&
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
    typeof value.timestamp === 'string' &&
    (value.payload === undefined || value.payload === null || isSanitizedLedgerPayload(value.payload))
  );
}

function isSanitizedLedgerPayload(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const forbiddenKeys = [
    'stdout',
    'stderr',
    'raw_stdout',
    'raw_stderr',
    'raw_output',
    'command',
    'argv',
    'args',
    'cwd',
    'env',
    'environment',
    'stdin',
    'shell',
    'target_dir',
    'canonical_path',
    'absolute_path',
    'file_content',
    'content',
    'full_content',
    'raw_input',
    'network_disabled',
  ];
  if (forbiddenKeys.some((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    return false;
  }
  const booleanKeys = [
    'truncated',
    'process_launched',
    'timed_out',
    'standard_output_truncated',
    'standard_error_truncated',
    'output_redacted',
    'target_dir_isolated',
    'cleanup_succeeded',
    'cargo_dependency_fetch_offline',
    'os_network_isolated',
    'compile_time_code_sandboxed',
    'trusted_workspace_required',
    'process_tree_timeout_supported',
    'process_tree_kill_attempted',
    'process_tree_kill_succeeded',
  ];
  for (const key of booleanKeys) {
    if (Object.prototype.hasOwnProperty.call(value, key) && typeof value[key] !== 'boolean') {
      return false;
    }
  }
  const numberKeys = [
    'bytes_read',
    'exit_code',
    'duration_ms',
    'standard_output_bytes',
    'standard_error_bytes',
  ];
  for (const key of numberKeys) {
    if (Object.prototype.hasOwnProperty.call(value, key) && typeof value[key] !== 'number' && value[key] !== null) {
      return false;
    }
  }
  const stringKeys = [
    'check_id',
    'verification_status',
    'process_tree_kill_reason',
    'reason',
    'tool_id',
    'status',
  ];
  for (const key of stringKeys) {
    if (Object.prototype.hasOwnProperty.call(value, key) && typeof value[key] !== 'string') {
      return false;
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(value, 'bounded_cargo_diagnostics') &&
    !isBoundedCargoDiagnosticArray(value.bounded_cargo_diagnostics)
  ) {
    return false;
  }
  return true;
}

export function isRunEventsResult(value: unknown): value is RunEventsResult {
  return isRecord(value) && typeof value.run_id === 'string' && Array.isArray(value.events) && value.events.every(isLedgerEventSummary);
}

export function isCodebaseIndexBuildResult(value: unknown): value is CodebaseIndexBuildResult {
  return (
    isRecord(value) &&
    hasNoForbiddenRawFields(value) &&
    isCodebaseIndexSnapshotSummary(value.snapshot) &&
    value.persisted === true &&
    typeof value.ledger_event_id === 'string' &&
    value.ledger_event_kind === 'CodebaseIndexSnapshotBuilt' &&
    value.next_action === 'build_ignore_aware_sensitive_filtering'
  );
}

export function isCodebaseIndexSnapshotManifest(value: unknown): value is CodebaseIndexSnapshotManifest {
  return (
    isRecord(value) &&
    hasNoForbiddenRawFields(value) &&
    isCodebaseIndexSnapshotSummary(value.snapshot) &&
    Array.isArray(value.entries) &&
    value.entries.length <= 20000 &&
    value.entries.every(isCodebaseIndexFileEntry) &&
    value.entries.length === value.snapshot.counts.indexed_files
  );
}

export function isCodebaseIndexSnapshotSummary(value: unknown): value is CodebaseIndexSnapshotSummary {
  return (
    isRecord(value) &&
    hasNoForbiddenRawFields(value) &&
    typeof value.index_id === 'string' &&
    /^idx_[a-f0-9]{16}$/.test(value.index_id) &&
    typeof value.root === 'string' &&
    isSafeIndexRoot(value.root) &&
    typeof value.workspace_fingerprint === 'string' &&
    isSha256Fingerprint(value.workspace_fingerprint) &&
    typeof value.snapshot_fingerprint === 'string' &&
    isSha256Fingerprint(value.snapshot_fingerprint) &&
    typeof value.built_at === 'string' &&
    isCodebaseIndexCountsSummary(value.counts) &&
    isCodebaseIndexLimitsSummary(value.limits) &&
    typeof value.truncated === 'boolean'
  );
}

function isCodebaseIndexCountsSummary(value: unknown): value is CodebaseIndexCountsSummary {
  return (
    isRecord(value) &&
    Object.values(value).every(isNonNegativeInteger) &&
    isNonNegativeInteger(value.indexed_files) &&
    isNonNegativeInteger(value.walked_directories) &&
    isNonNegativeInteger(value.skipped_protected) &&
    isNonNegativeInteger(value.skipped_symlink) &&
    isNonNegativeInteger(value.skipped_too_large) &&
    isNonNegativeInteger(value.skipped_binary_like) &&
    isNonNegativeInteger(value.skipped_unreadable) &&
    isNonNegativeInteger(value.skipped_unsafe_path) &&
    isNonNegativeInteger(value.skipped_other) &&
    isNonNegativeInteger(value.truncated_entries) &&
    isNonNegativeInteger(value.visited_entries) &&
    isNonNegativeInteger(value.truncated_directories)
  );
}

function isCodebaseIndexLimitsSummary(value: unknown): value is CodebaseIndexLimitsSummary {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.max_files) &&
    value.max_files > 0 &&
    value.max_files <= 20000 &&
    isNonNegativeInteger(value.max_directories) &&
    value.max_directories > 0 &&
    value.max_directories <= 5000 &&
    isNonNegativeInteger(value.max_path_chars) &&
    value.max_path_chars > 0 &&
    value.max_path_chars <= 1024 &&
    isNonNegativeInteger(value.max_file_bytes) &&
    value.max_file_bytes > 0 &&
    value.max_file_bytes <= 2097152 &&
    isNonNegativeInteger(value.max_visited_entries) &&
    value.max_visited_entries > 0 &&
    value.max_visited_entries <= 200000 &&
    isNonNegativeInteger(value.max_directory_entries) &&
    value.max_directory_entries > 0 &&
    value.max_directory_entries <= 20000
  );
}

function isCodebaseIndexFileEntry(value: unknown): value is CodebaseIndexFileEntry {
  return (
    isRecord(value) &&
    hasNoForbiddenRawFields(value) &&
    typeof value.path === 'string' &&
    isSafeIndexEntryPath(value.path) &&
    isCodebaseIndexFileKind(value.file_kind) &&
    isNonNegativeInteger(value.byte_length) &&
    (value.line_count === undefined || value.line_count === null || isNonNegativeInteger(value.line_count)) &&
    (value.content_sha256 === undefined || value.content_sha256 === null || (typeof value.content_sha256 === 'string' && isSha256Fingerprint(value.content_sha256)))
  );
}

function isCodebaseIndexFileKind(value: unknown): value is CodebaseIndexFileEntry['file_kind'] {
  return value === 'Rust' || value === 'TypeScript' || value === 'JavaScript' || value === 'Json' || value === 'Toml' || value === 'Markdown' || value === 'Yaml' || value === 'Shell' || value === 'Text' || value === 'Other';
}

function isSafeIndexRoot(value: string): boolean {
  return value === '.' || isSafeIndexEntryPath(value);
}

function isSafeIndexEntryPath(value: string): boolean {
  if (value.length === 0 || value.length > 1024 || value.startsWith('/') || value.startsWith('~') || value.includes('\\')) {
    return false;
  }
  const parts = value.split('/');
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..' && !['.git', '.brownie', 'node_modules', 'target'].includes(part));
}

export function isChildTaskInspectSummary(value: unknown): value is ChildTaskInspectSummary {
  return (
    isRecord(value) &&
    typeof value.task_id === 'string' &&
    typeof value.run_id === 'string' &&
    isTaskStatus(value.status) &&
    (value.parent_task_id === undefined || value.parent_task_id === null || typeof value.parent_task_id === 'string') &&
    (value.parent_run_id === undefined || value.parent_run_id === null || typeof value.parent_run_id === 'string') &&
    (value.source_candidate_id === undefined || value.source_candidate_id === null || typeof value.source_candidate_id === 'string') &&
    (value.source_handoff_envelope_id === undefined || value.source_handoff_envelope_id === null || typeof value.source_handoff_envelope_id === 'string') &&
    (value.source_handoff_envelope_fingerprint === undefined || value.source_handoff_envelope_fingerprint === null || typeof value.source_handoff_envelope_fingerprint === 'string') &&
    (value.source_intent_summary === undefined || value.source_intent_summary === null || isChildTaskSourceIntentSummary(value.source_intent_summary)) &&
    (value.recovery_cycle_provenance === undefined || value.recovery_cycle_provenance === null || isRecoveryCycleChildProvenance(value.recovery_cycle_provenance)) &&
    (value.verification_recovery_provenance === undefined || value.verification_recovery_provenance === null || isVerificationRecoveryProvenance(value.verification_recovery_provenance)) &&
    (value.verification_recovery_retry_provenance === undefined || value.verification_recovery_retry_provenance === null || isVerificationRecoveryRetryProvenance(value.verification_recovery_retry_provenance)) &&
    isNonNegativeInteger(value.event_count) &&
    typeof value.has_agent_loop_completed === 'boolean' &&
    (value.completion_final_state === undefined || value.completion_final_state === null || typeof value.completion_final_state === 'string') &&
    (value.completion_result_fingerprint === undefined || value.completion_result_fingerprint === null || typeof value.completion_result_fingerprint === 'string') &&
    (value.completion_summary_preview === undefined || value.completion_summary_preview === null || typeof value.completion_summary_preview === 'string') &&
    (value.final_response_preview === undefined || value.final_response_preview === null || typeof value.final_response_preview === 'string')
  );
}

export function isRunInspectSummary(value: unknown): value is RunInspectSummary {
  return (
    isRecord(value) &&
    typeof value.run_id === 'string' &&
    (value.task_id === undefined || value.task_id === null || typeof value.task_id === 'string') &&
    (value.status === undefined || value.status === null || isTaskStatus(value.status)) &&
    (value.recovery_cycle_budget_outcome === undefined || value.recovery_cycle_budget_outcome === null || isRecoveryCycleBudgetOutcome(value.recovery_cycle_budget_outcome)) &&
    (value.parent_join_readiness_summary === undefined || value.parent_join_readiness_summary === null || isRunInspectParentJoinReadinessSummary(value.parent_join_readiness_summary)) &&
    (value.consumed_parent_join_recovery_summary === undefined || value.consumed_parent_join_recovery_summary === null || isRunInspectConsumedParentJoinRecoverySummary(value.consumed_parent_join_recovery_summary)) &&
    isNonNegativeInteger(value.child_task_count) &&
    Array.isArray(value.child_task_ids) &&
    value.child_task_ids.every((taskId) => typeof taskId === 'string') &&
    Array.isArray(value.child_tasks) &&
    value.child_tasks.every(isChildTaskInspectSummary) &&
    typeof value.event_count === 'number' &&
    Number.isInteger(value.event_count) &&
    value.event_count >= 0 &&
    typeof value.has_tool_execution_completed === 'boolean' &&
    typeof value.has_subtask_orchestration_queued === 'boolean' &&
    typeof value.subtask_queue_count === 'number' &&
    Number.isInteger(value.subtask_queue_count) &&
    value.subtask_queue_count >= 0 &&
    typeof value.has_subtask_handoff_prepared === 'boolean' &&
    typeof value.subtask_handoff_count === 'number' &&
    Number.isInteger(value.subtask_handoff_count) &&
    value.subtask_handoff_count >= 0 &&
    typeof value.has_subtask_scheduler_readiness === 'boolean' &&
    typeof value.subtask_scheduler_readiness_count === 'number' &&
    Number.isInteger(value.subtask_scheduler_readiness_count) &&
    value.subtask_scheduler_readiness_count >= 0 &&
    typeof value.has_subtask_dispatch_plan_prepared === 'boolean' &&
    typeof value.subtask_dispatch_plan_count === 'number' &&
    Number.isInteger(value.subtask_dispatch_plan_count) &&
    value.subtask_dispatch_plan_count >= 0 &&
    typeof value.has_subtask_dispatch_contract_prepared === 'boolean' &&
    typeof value.subtask_dispatch_contract_count === 'number' &&
    Number.isInteger(value.subtask_dispatch_contract_count) &&
    value.subtask_dispatch_contract_count >= 0 &&
    typeof value.has_subtask_dispatch_admission_evaluated === 'boolean' &&
    typeof value.subtask_dispatch_admission_count === 'number' &&
    Number.isInteger(value.subtask_dispatch_admission_count) &&
    value.subtask_dispatch_admission_count >= 0 &&
    typeof value.has_subtask_dispatch_readiness_snapshot === 'boolean' &&
    typeof value.subtask_dispatch_readiness_snapshot_count === 'number' &&
    Number.isInteger(value.subtask_dispatch_readiness_snapshot_count) &&
    value.subtask_dispatch_readiness_snapshot_count >= 0 &&
    typeof value.has_subtask_dispatcher_guard_verdict === 'boolean' &&
    typeof value.subtask_dispatcher_guard_verdict_count === 'number' &&
    Number.isInteger(value.subtask_dispatcher_guard_verdict_count) &&
    value.subtask_dispatcher_guard_verdict_count >= 0 &&
    typeof value.has_subtask_dispatch_decision === 'boolean' &&
    typeof value.subtask_dispatch_decision_count === 'number' &&
    Number.isInteger(value.subtask_dispatch_decision_count) &&
    value.subtask_dispatch_decision_count >= 0 &&
    typeof value.has_subtask_dispatch_candidate_manifest === 'boolean' &&
    typeof value.subtask_dispatch_candidate_manifest_count === 'number' &&
    Number.isInteger(value.subtask_dispatch_candidate_manifest_count) &&
    value.subtask_dispatch_candidate_manifest_count >= 0 &&
    typeof value.has_subtask_dispatch_handoff_envelope === 'boolean' &&
    typeof value.subtask_dispatch_handoff_envelope_count === 'number' &&
    Number.isInteger(value.subtask_dispatch_handoff_envelope_count) &&
    value.subtask_dispatch_handoff_envelope_count >= 0 &&
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
  return (
    isRecord(value) &&
    isTaskRecord(value.task) &&
    isRunInspectSummary(value.run) &&
    (value.parent_join_readiness_summary === undefined ||
      value.parent_join_readiness_summary === null ||
      isChildInspectParentJoinReadinessSummary(value.parent_join_readiness_summary)) &&
    (value.consumed_parent_join_recovery_summary === undefined ||
      value.consumed_parent_join_recovery_summary === null ||
      isChildInspectConsumedParentJoinRecoverySummary(value.consumed_parent_join_recovery_summary))
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
    typeof value.can_spawn_subtasks === 'boolean' &&
    typeof value.codebase_index === 'boolean'
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
    value === 'SpawnSubtask' ||
    value === 'IndexCodebase'
  );
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return value === 'Created' || value === 'Queued' || value === 'Running' || value === 'Completed' || value === 'Failed' || value === 'Cancelled';
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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}
