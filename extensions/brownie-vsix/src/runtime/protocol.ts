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

export interface LlmProviderFailureOutcome {
  provider: string;
  model: string;
  request_phase: string;
  failure_class: string;
  retryable: boolean;
  next_action: string;
  failure_fingerprint: string;
  reason: string;
  reason_chars: number;
  reason_truncated: boolean;
  http_status?: number | null;
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

export interface ModePackActiveSnapshotSummary {
  activation_id: string;
  activation_fingerprint: string;
  modepack_name: string;
  schema_version: number;
  source_kind: string;
  source_path: string;
  mode_count: number;
  mode_ids: string[];
  compiled_policy_fingerprint: string;
  activated_at: string;
  activation_event_id: string;
}

export interface ModePackActivateResult {
  activated: boolean;
  replayed: boolean;
  snapshot: ModePackActiveSnapshotSummary;
}

export interface ModePackReplaceActiveResult {
  replaced: boolean;
  replayed: boolean;
  previous_snapshot: ModePackActiveSnapshotSummary;
  replacement_snapshot: ModePackActiveSnapshotSummary;
  replacement_event_id: string;
  approved_candidate?: ModePackApprovedCandidateSummary | null;
  candidate_consumed_event_id?: string | null;
  update_admission?: ModePackUpdateAdmissionSummary | null;
}

export interface ModePackRollbackActiveResult {
  rolled_back: boolean;
  replayed: boolean;
  current_snapshot: ModePackActiveSnapshotSummary;
  restored_snapshot: ModePackActiveSnapshotSummary;
  rollback_event_id: string;
}

export interface ModePackUpdateAdmissionSummary {
  update_id: string;
  current_activation_fingerprint: string;
  replacement_activation_fingerprint: string;
  modepack_name: string;
  source_kind: string;
  approval_id: string;
  candidate_id: string;
  source_url_host: string;
  source_url_fingerprint: string;
  dns_binding: ModePackDnsBindingSummary;
  content_sha256: string;
  compiled_policy_fingerprint: string;
  provenance_id: string;
  provenance_event_id: string;
  trusted_signer_trust_id: string;
  trusted_signer_event_id: string;
  signer_fingerprint: string;
  statement_sha256: string;
  admitted_at: string;
  admission_event_id: string;
}

export interface ModePackCandidateSummary {
  candidate_id: string;
  source_kind: string;
  source_url_host: string;
  source_url_fingerprint: string;
  dns_binding: ModePackDnsBindingSummary;
  content_sha256: string;
  byte_count: number;
  modepack_name: string;
  schema_version: number;
  mode_count: number;
  mode_ids: string[];
  compiled_policy_fingerprint: string;
  cached_at: string;
  cache_event_id: string;
}

export interface ModePackDnsBindingSummary {
  resolution_fingerprint: string;
  pinned_address_fingerprint: string;
  resolved_address_count: number;
  pinned_address_family: string;
}

export interface ModePackFetchCandidateResult {
  fetched: boolean;
  replayed: boolean;
  candidate: ModePackCandidateSummary;
  next_action: string;
}

export interface ModePackRegistryUpdateSelectionSummary {
  selection_id: string;
  registry_url_host: string;
  registry_url_fingerprint: string;
  registry_dns_binding: ModePackDnsBindingSummary;
  registry_manifest_sha256: string;
  registry_provenance_statement_sha256: string;
  registry_signer_fingerprint: string;
  registry_trusted_signer_trust_id: string;
  registry_trusted_signer_event_id: string;
  current_activation_fingerprint: string;
  current_modepack_name: string;
  current_source_kind: string;
  candidate_url: string;
  candidate_url_host: string;
  candidate_url_fingerprint: string;
  candidate_content_sha256: string;
  candidate_compiled_policy_fingerprint: string;
  provenance_statement_url: string;
  provenance_statement_url_host: string;
  provenance_statement_url_fingerprint: string;
  provenance_statement_sha256: string;
  signer_fingerprint: string;
  selected_at: string;
  selection_event_id: string;
}

export interface ModePackSelectRegistryUpdateResult {
  selected: boolean;
  replayed: boolean;
  selection: ModePackRegistryUpdateSelectionSummary;
  next_action: string;
}

export interface ModePackApprovedCandidateSummary {
  approval_id: string;
  candidate_id: string;
  source_kind: string;
  source_url_host: string;
  source_url_fingerprint: string;
  dns_binding?: ModePackDnsBindingSummary | null;
  content_sha256: string;
  modepack_name: string;
  schema_version: number;
  mode_count: number;
  mode_ids: string[];
  compiled_policy_fingerprint: string;
  provenance_id: string;
  provenance_event_id: string;
  trusted_signer_trust_id: string;
  trusted_signer_event_id: string;
  signer_fingerprint: string;
  statement_sha256: string;
  approved_at: string;
  approval_event_id: string;
  consumed: boolean;
}

export interface ModePackTrustedSignerSummary {
  trust_id: string;
  signer_fingerprint: string;
  trusted_at: string;
  expires_at?: string;
  trust_event_id: string;
}

export interface ModePackRevokedSignerSummary {
  revocation_id: string;
  signer_fingerprint: string;
  trusted_signer_trust_id: string;
  trusted_signer_event_id: string;
  revoked_at: string;
  revocation_event_id: string;
}

export interface ModePackApproveCandidateResult {
  approved: boolean;
  replayed: boolean;
  approval: ModePackApprovedCandidateSummary;
  next_action: string;
}

export interface ModePackTrustSignerResult {
  trusted: boolean;
  replayed: boolean;
  trusted_signer: ModePackTrustedSignerSummary;
  next_action: string;
}

export interface ModePackRevokeSignerResult {
  revoked: boolean;
  replayed: boolean;
  revoked_signer: ModePackRevokedSignerSummary;
  next_action: string;
}

export interface ModePackCandidateProvenanceSummary {
  provenance_id: string;
  candidate_id: string;
  source_kind: string;
  source_url_host: string;
  source_url_fingerprint: string;
  dns_binding?: ModePackDnsBindingSummary | null;
  content_sha256: string;
  modepack_name: string;
  schema_version: number;
  mode_count: number;
  mode_ids: string[];
  compiled_policy_fingerprint: string;
  signer_fingerprint: string;
  statement_sha256: string;
  signature_sha256: string;
  verified_at: string;
  provenance_event_id: string;
}

export interface ModePackVerifyCandidateProvenanceResult {
  verified: boolean;
  replayed: boolean;
  provenance: ModePackCandidateProvenanceSummary;
  next_action: string;
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
  test_name_hash?: string | null;
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

export interface PatchApplyRecoveryProvenance {
  source_run_id: string;
  source_proposal_id: string;
  source_apply_id: string;
  source_apply_fingerprint: string;
  failure_fingerprint: string;
  failure_class: string;
  operation: string;
  path: string;
  hunk_count?: number | null;
  hunk_fingerprint?: string | null;
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

export interface LlmProviderFailureRetryProvenance {
  source_task_id: string;
  source_run_id: string;
  failure_fingerprint: string;
  failure_class: string;
  provider: string;
  model: string;
  request_phase: string;
  retryable: boolean;
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
  patchApplyRecoverySource?: PatchApplyRecoverySource | null;
  verificationRecoveryRetrySource?: VerificationRecoveryRetrySource | null;
  llmProviderFailureRetrySource?: LlmProviderFailureRetrySource | null;
}

export type TaskRunSelectedIndexContext = CodebaseIndexSelectionReadResult;

export interface TaskRunVerificationRecoveryContextRead {
  authorize: boolean;
  source_task_id: string;
  source_run_id: string;
  expected_failure_fingerprint: string;
  diagnostic_index: number;
  max_excerpt_bytes: number;
}

export interface TaskRunContextBudget {
  max_prompt_chars: number;
  max_ledger_events: number;
  max_selected_index_chars: number;
}

export interface TaskRunParams {
  task_id: string;
  selected_index_context?: TaskRunSelectedIndexContext | null;
  verification_recovery_context_read?: TaskRunVerificationRecoveryContextRead | null;
  context_budget?: TaskRunContextBudget | null;
  completion_acceptance?: TaskRunCompletionAcceptanceRequest | null;
}

export interface TaskRunCompletionAcceptanceRequest {
  authorize_completion_acceptance: true;
  source_run_id: string;
  acceptance_id: string;
  expected_completion_result_fingerprint: string;
}

export interface ParentJoinRunTarget {
  authorize_parent_join_run: true;
  parent_task_id: string;
  parent_run_id: string;
  expected_child_completion_fingerprint: string;
  expected_child_completion_child_count: number;
  expected_terminal_completed_child_count: number;
  expected_terminal_failed_child_count: number;
}

export interface HeadlessContinueOnceParams {
  authorize: true;
  expected_progress_fingerprint: string;
  expected_aggregate_sequence: number;
  continuation_id?: string | null;
  max_steps?: number | null;
  context_budget?: TaskRunContextBudget | null;
  verification_recovery_source?: VerificationRecoverySource | null;
  verification_recovery_goal?: string | null;
  verification_recovery_mode_id?: string | null;
  verification_recovery_retry_source?: VerificationRecoveryRetrySource | null;
  verification_recovery_retry_goal?: string | null;
  verification_recovery_retry_mode_id?: string | null;
  llm_provider_failure_retry_source?: LlmProviderFailureRetrySource | null;
  llm_provider_failure_retry_goal?: string | null;
  llm_provider_failure_retry_mode_id?: string | null;
  verification_recovery_run_target?: VerificationRecoveryRunTarget | null;
  verification_recovery_context_read?: TaskRunVerificationRecoveryContextRead | null;
  patch_apply_recovery_source?: PatchApplyRecoverySource | null;
  patch_apply_recovery_goal?: string | null;
  patch_apply_recovery_mode_id?: string | null;
  patch_apply_recovery_run_target?: PatchApplyRecoveryRunTarget | null;
  patch_apply_recovery_apply_target?: PatchApplyRecoveryApplyTarget | null;
  verification_recovery_apply_target?: VerificationRecoveryApplyTarget | null;
  verification_recovery_retry_run_target?: VerificationRecoveryRetryRunTarget | null;
  llm_provider_failure_retry_run_target?: LlmProviderFailureRetryRunTarget | null;
  parent_join_run_target?: ParentJoinRunTarget | null;
  modepack_registry_update_selection_target?: ModePackRegistryUpdateSelectionTarget | null;
  modepack_selected_candidate_fetch_target?: ModePackSelectedCandidateFetchTarget | null;
  modepack_selected_candidate_provenance_verification_target?: ModePackSelectedCandidateProvenanceVerificationTarget | null;
  modepack_selected_candidate_approval_target?: ModePackSelectedCandidateApprovalTarget | null;
  modepack_selected_approved_candidate_replacement_target?: ModePackSelectedApprovedCandidateReplacementTarget | null;
  modepack_selected_active_rollback_target?: ModePackSelectedActiveRollbackTarget | null;
}

export interface HeadlessRunAdvanceParams {
  authorize: true;
  session_id: string;
  advance_id?: string | null;
  expected_session_sequence: number;
  max_steps?: number | null;
  context_budget?: TaskRunContextBudget | null;
  expected_progress_fingerprint?: string | null;
  expected_aggregate_sequence?: number | null;
  modepack_registry_update_selection_target?: ModePackRegistryUpdateSelectionTarget | null;
  modepack_selected_candidate_fetch_target?: ModePackSelectedCandidateFetchTarget | null;
  modepack_selected_candidate_provenance_verification_target?: ModePackSelectedCandidateProvenanceVerificationTarget | null;
  modepack_selected_candidate_approval_target?: ModePackSelectedCandidateApprovalTarget | null;
  modepack_selected_approved_candidate_replacement_target?: ModePackSelectedApprovedCandidateReplacementTarget | null;
}

export interface HeadlessRunDriveParams {
  authorize: true;
  session_id: string;
  drive_id?: string | null;
  expected_start_session_sequence: number;
  max_advances?: number | null;
  max_steps_per_advance?: number | null;
  context_budget?: TaskRunContextBudget | null;
  authorize_completion_finalization?: boolean | null;
  expected_completion_closure_fingerprint?: string | null;
  product_evidence_derivation?: HeadlessRunProductEvidenceDerivationRequest | null;
  product_completion_decision?: HeadlessRunProductCompletionDecisionRequest | null;
  modepack_registry_update_selection_target?: ModePackRegistryUpdateSelectionTarget | null;
  modepack_selected_candidate_fetch_target?: ModePackSelectedCandidateFetchTarget | null;
  modepack_selected_candidate_provenance_verification_target?: ModePackSelectedCandidateProvenanceVerificationTarget | null;
  modepack_selected_candidate_approval_target?: ModePackSelectedCandidateApprovalTarget | null;
  modepack_selected_approved_candidate_replacement_target?: ModePackSelectedApprovedCandidateReplacementTarget | null;
  journey_admission?: HeadlessRunJourneyAdmission | null;
  journey_route_resume?: HeadlessRunJourneyRouteResume | null;
  journey_closure?: HeadlessRunJourneyClosure | null;
  journey_execution?: HeadlessRunJourneyExecution | null;
}

export interface HeadlessRunProductCompletionDecisionRequest {
  authorize_product_completion_decision: true;
  decision_id: string;
  expected_accepted_completion_fingerprint: string;
  expected_terminal_completion_fingerprint: string;
  expected_completion_closure_fingerprint: string;
  expected_product_evidence_fingerprint: string;
  evidence_status: string;
  target_capability: string;
  concrete_capability_transition: string;
  validated_gate_categories: string[];
  derived_product_evidence_matrix_fingerprint?: string | null;
  behavior_evidence_count: number;
  rejected_alternatives_count: number;
  safety_boundary_reviewed: boolean;
  non_goals_reviewed: boolean;
  technical_debt_reviewed: boolean;
  remaining_capability?: string | null;
  milestone_exit_rationale?: string | null;
}

export interface HeadlessRunProductEvidenceDerivationRequest {
  authorize_product_evidence_derivation: true;
  derivation_id: string;
  phase_id: string;
  milestone: string;
  expected_accepted_completion_fingerprint: string;
  expected_terminal_completion_fingerprint: string;
  expected_completion_closure_fingerprint: string;
  project_completion_policy: HeadlessRunProductEvidenceArtifactSource;
  artifacts: HeadlessRunProductEvidenceArtifactSource[];
}

export interface HeadlessRunProductEvidenceArtifactSource {
  path: string;
  expected_sha256: string;
}

export interface HeadlessRunJourneyAdmission {
  journey_id: string;
  authorize_journey_start: true;
  task_start: HeadlessRunJourneyTaskStartEnvelope;
}

export interface HeadlessRunJourneyRouteResume {
  journey_id: string;
  authorize_journey_route_resume: true;
  expected_journey_fingerprint: string;
  expected_route_kind: HeadlessContinueRouteKind;
  expected_source_checkpoint_fingerprint: string;
}

export interface HeadlessRunJourneyClosure {
  journey_id: string;
  authorize_journey_closure: true;
  expected_journey_fingerprint: string;
  source_replacement_drive_id: string;
  expected_replacement_resume_fingerprint: string;
}

export interface HeadlessRunJourneyExecution {
  journey_id: string;
  authorize_journey_execution: true;
  expected_journey_fingerprint?: string | null;
  task_start?: HeadlessRunJourneyTaskStartEnvelope | null;
  expected_execution_checkpoint_fingerprint?: string | null;
}

export interface HeadlessRunJourneyTaskStartEnvelope {
  goal: string;
  mode_id?: string | null;
}

export interface VerificationRecoverySource {
  source_task_id: string;
  source_run_id: string;
  expected_failure_fingerprint: string;
  authorize_recovery: boolean;
}

export interface PatchApplyRecoverySource {
  source_run_id: string;
  source_proposal_id: string;
  source_apply_id: string;
  expected_source_apply_fingerprint: string;
  expected_failure_fingerprint: string;
  authorize_patch_apply_recovery: boolean;
}

export interface PatchApplyRecoveryRunTarget {
  recovery_task_id: string;
  recovery_run_id: string;
  source_run_id: string;
  source_proposal_id: string;
  source_apply_id: string;
  expected_source_apply_fingerprint: string;
  expected_failure_fingerprint: string;
  authorize_patch_apply_recovery_run: boolean;
}

export interface PatchApplyRecoveryApplyTarget {
  recovery_task_id: string;
  recovery_run_id: string;
  source_run_id: string;
  source_proposal_id: string;
  source_apply_id: string;
  recovery_proposal_id: string;
  expected_source_apply_fingerprint: string;
  expected_failure_fingerprint: string;
  expected_target_sha256: string;
  patch_old_text?: string | null;
  patch_new_text?: string | null;
  patch_hunks?: ProposalPatchHunk[] | null;
  authorize_patch_apply_recovery_apply: boolean;
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

export interface VerificationRecoveryRetryRunTarget {
  retry_task_id: string;
  retry_run_id: string;
  proposal_id: string;
  apply_id: string;
  expected_failure_fingerprint: string;
  expected_apply_fingerprint: string;
  authorize_verification_retry_run: boolean;
}

export interface VerificationRecoveryRunTarget {
  recovery_task_id: string;
  recovery_run_id: string;
  source_task_id: string;
  source_run_id: string;
  expected_failure_fingerprint: string;
  authorize_recovery_run: boolean;
}

export interface VerificationRecoveryApplyTarget {
  source_task_id: string;
  source_run_id: string;
  recovery_task_id: string;
  recovery_run_id: string;
  proposal_id: string;
  expected_failure_fingerprint: string;
  expected_target_sha256?: string | null;
  expected_target_absent?: boolean | null;
  replacement_content?: string | null;
  authorize_recovery_apply: boolean;
}

export interface LlmProviderFailureRetrySource {
  source_task_id: string;
  source_run_id: string;
  expected_failure_fingerprint: string;
  authorize_provider_failure_retry: boolean;
}

export interface LlmProviderFailureRetryRunTarget {
  retry_task_id: string;
  retry_run_id: string;
  source_task_id: string;
  source_run_id: string;
  expected_failure_fingerprint: string;
  authorize_provider_failure_retry_run: boolean;
}

export interface TaskStartResult {
  task_id: string;
  run_id: string;
  status: TaskStatus;
  verification_recovery_admission?: VerificationRecoveryAdmission | null;
  patch_apply_recovery_admission?: PatchApplyRecoveryAdmission | null;
  verification_recovery_retry_admission?: VerificationRecoveryRetryAdmission | null;
  llm_provider_failure_retry_admission?: LlmProviderFailureRetryAdmission | null;
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

export interface PatchApplyRecoveryAdmission {
  source_run_id: string;
  source_proposal_id: string;
  source_apply_id: string;
  recovery_task_id: string;
  recovery_run_id: string;
  source_apply_fingerprint: string;
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

export interface LlmProviderFailureRetryAdmission {
  source_task_id: string;
  source_run_id: string;
  retry_task_id: string;
  retry_run_id: string;
  failure_fingerprint: string;
  failure_class: string;
  retryable: true;
  retry_running_enabled: false;
  next_action: 'run_llm_provider_retry_task_explicitly';
  replayed: boolean;
}

export interface TaskRunResult {
  task_id: string;
  run_id: string;
  status: TaskStatus;
  agent_loop: AgentLoopRunSummary;
  completion_evidence?: TaskRunCompletionEvidence | null;
  completion_acceptance?: TaskRunCompletionAcceptance | null;
  selected_index_prompt_context?: TaskRunSelectedIndexPromptContextSummary | null;
  verification_recovery_context_read?: TaskRunVerificationRecoveryContextReadSummary | null;
  context_budget?: TaskRunContextBudgetSummary | null;
  verification_completion_gate?: TaskRunVerificationCompletionGate | null;
  verification_recovery_repair?: TaskRunVerificationRecoveryRepairOutcome | null;
  patch_apply_recovery_repair?: TaskRunPatchApplyRecoveryRepairOutcome | null;
  verification_recovery_retry?: TaskRunVerificationRecoveryRetryOutcome | null;
  recovery_cycle_budget_outcome?: RecoveryCycleBudgetOutcome | null;
  child_orchestration_outcome?: TaskRunChildOrchestrationOutcome | null;
  parent_join_readiness_outcome?: TaskRunParentJoinReadinessOutcome | null;
  llm_provider_failure?: LlmProviderFailureOutcome | null;
}

export interface TaskRunCompletionEvidence {
  final_state: string;
  task_status: TaskStatus;
  completion_result_fingerprint: string;
  completion_summary_preview: string;
  completion_summary_chars: number;
  completion_summary_truncated: boolean;
  final_response_present: boolean;
  final_response_chars: number;
  replayed: boolean;
}

export interface TaskRunCompletionAcceptance {
  acceptance_id: string;
  task_id: string;
  run_id: string;
  status: 'AcceptedComplete';
  terminal_completion_fingerprint: string;
  acceptance_fingerprint: string;
  verifier_gate_status: string;
  replayed: boolean;
  next_action: string;
}

export type HeadlessContinueOnceStatus = 'stale_progress' | 'no_eligible_task' | 'task_in_progress' | 'task_executed';

export type HeadlessContinueRouteKind =
  | 'inspect_progress_overview'
  | 'start_verification_recovery_explicitly'
  | 'run_recovery_task_explicitly'
  | 'review_and_authorize_recovery_proposal'
  | 'apply_approved_recovery_proposal_explicitly'
  | 'start_verification_retry_explicitly'
  | 'run_verification_retry_task_explicitly'
  | 'run_llm_provider_retry_task_explicitly'
  | 'fetch_selected_mode_pack_candidate_explicitly'
  | 'fetch_selected_modepack_candidate_explicitly'
  | 'verify_selected_mode_pack_candidate_provenance_explicitly'
  | 'verify_selected_modepack_candidate_provenance_explicitly'
  | 'approve_verified_mode_pack_candidate_explicitly'
  | 'approve_verified_modepack_candidate_explicitly'
  | 'replace_active_with_approved_mode_pack_candidate_explicitly'
  | 'replace_active_with_approved_modepack_candidate_explicitly'
  | 'run_parent_task_explicitly'
  | 'no_eligible_task'
  | 'refresh_progress_overview';

export interface HeadlessContinueRoute {
  kind: HeadlessContinueRouteKind;
  reason: string;
  task_id?: string | null;
  run_id?: string | null;
  proposal_id?: string | null;
  apply_id?: string | null;
  failure_fingerprint?: string | null;
  apply_fingerprint?: string | null;
  progress_fingerprint?: string | null;
  aggregate_sequence?: number | null;
  next_action: string;
}

export interface HeadlessContinueOnceResult {
  status: HeadlessContinueOnceStatus;
  decision_id?: string | null;
  continuation_id?: string | null;
  selected_task_id?: string | null;
  selected_run_id?: string | null;
  candidate_count: number;
  expected_progress_fingerprint: string;
  expected_aggregate_sequence: number;
  current_progress_fingerprint: string;
  current_aggregate_sequence: number;
  post_progress_fingerprint?: string | null;
  post_aggregate_sequence?: number | null;
  stale: boolean;
  replayed: boolean;
  task_run_result?: TaskRunResult | null;
  proposal_apply_result?: ProposalApplyResult | null;
  modepack_select_registry_update_result?: ModePackSelectRegistryUpdateResult | null;
  modepack_fetch_candidate_result?: ModePackFetchCandidateResult | null;
  modepack_verify_candidate_provenance_result?: ModePackVerifyCandidateProvenanceResult | null;
  modepack_approve_candidate_result?: ModePackApproveCandidateResult | null;
  modepack_replace_active_result?: ModePackReplaceActiveResult | null;
  modepack_rollback_active_result?: ModePackRollbackActiveResult | null;
  llm_provider_failure_retry_admission?: LlmProviderFailureRetryAdmission | null;
  next_route?: HeadlessContinueRoute | null;
  max_steps?: number | null;
  step_count?: number | null;
  executed_count?: number | null;
  replayed_count?: number | null;
  stop_reason?: string | null;
  steps?: HeadlessContinueStepResult[];
  next_action: string;
}

export interface ModePackRegistryUpdateSelectionTarget {
  authorize_modepack_registry_update_selection: true;
  authorize_registry_trust: true;
  registry_url: string;
  expected_registry_manifest_sha256: string;
  expected_current_activation_fingerprint: string;
  expected_registry_provenance_statement_sha256: string;
  expected_registry_signer_fingerprint: string;
  expected_registry_trusted_signer_trust_id: string;
  expected_registry_trusted_signer_event_id: string;
  registry_provenance_statement_json: string;
  registry_provenance_signature_base64: string;
  registry_provenance_public_key_base64: string;
}

export interface ModePackSelectedCandidateFetchTarget {
  authorize_selected_candidate_fetch: true;
  selection_id: string;
  selection_event_id: string;
  expected_registry_manifest_sha256: string;
  expected_candidate_url_fingerprint: string;
  expected_candidate_content_sha256: string;
  expected_candidate_compiled_policy_fingerprint: string;
  expected_provenance_statement_url_fingerprint: string;
  expected_provenance_statement_sha256: string;
  expected_signer_fingerprint: string;
  expected_current_activation_fingerprint: string;
}

export interface ModePackSelectedCandidateProvenanceVerificationTarget {
  authorize_selected_candidate_provenance_verification: true;
  fetch_continuation_id: string;
  expected_fetch_decision_id: string;
  selection_id: string;
  selection_event_id: string;
  expected_candidate_url_fingerprint: string;
  expected_candidate_content_sha256: string;
  expected_candidate_compiled_policy_fingerprint: string;
  expected_provenance_statement_url_fingerprint: string;
  expected_provenance_statement_sha256: string;
  expected_signer_fingerprint: string;
  expected_current_activation_fingerprint: string;
  provenance_statement_json: string;
  provenance_signature_base64: string;
  provenance_public_key_base64: string;
}

export interface ModePackSelectedCandidateApprovalTarget {
  authorize_selected_candidate_approval: true;
  fetch_continuation_id: string;
  expected_fetch_decision_id: string;
  provenance_verification_continuation_id: string;
  expected_provenance_verification_decision_id: string;
  selection_id: string;
  selection_event_id: string;
  expected_candidate_url_fingerprint: string;
  expected_candidate_content_sha256: string;
  expected_candidate_compiled_policy_fingerprint: string;
  expected_provenance_id: string;
  expected_provenance_event_id: string;
  expected_provenance_statement_url_fingerprint: string;
  expected_provenance_statement_sha256: string;
  expected_signer_fingerprint: string;
  expected_current_activation_fingerprint: string;
}

export interface ModePackSelectedApprovedCandidateReplacementTarget {
  authorize_selected_candidate_replacement: true;
  fetch_continuation_id: string;
  expected_fetch_decision_id: string;
  provenance_verification_continuation_id: string;
  expected_provenance_verification_decision_id: string;
  approval_continuation_id: string;
  expected_approval_decision_id: string;
  selection_id: string;
  selection_event_id: string;
  expected_candidate_url_fingerprint: string;
  expected_candidate_content_sha256: string;
  expected_candidate_compiled_policy_fingerprint: string;
  expected_candidate_activation_fingerprint: string;
  expected_provenance_id: string;
  expected_provenance_event_id: string;
  expected_provenance_statement_url_fingerprint: string;
  expected_provenance_statement_sha256: string;
  expected_signer_fingerprint: string;
  expected_current_activation_fingerprint: string;
  expected_approved_candidate_id: string;
  expected_approved_candidate_approval_id: string;
  expected_approved_candidate_approval_event_id: string;
}

export interface ModePackSelectedActiveRollbackTarget {
  authorize_selected_active_modepack_rollback: true;
  replacement_event_id: string;
  expected_current_activation_fingerprint: string;
  expected_rollback_activation_fingerprint: string;
}

export interface HeadlessContinueStepResult {
  step_index: number;
  status: HeadlessContinueOnceStatus;
  decision_id?: string | null;
  continuation_id?: string | null;
  selected_task_id?: string | null;
  selected_run_id?: string | null;
  candidate_count: number;
  current_progress_fingerprint: string;
  current_aggregate_sequence: number;
  post_progress_fingerprint?: string | null;
  post_aggregate_sequence?: number | null;
  replayed: boolean;
  context_budget?: TaskRunContextBudgetSummary | null;
  terminal_completion_evidence?: TaskRunCompletionEvidence | null;
  next_route?: HeadlessContinueRoute | null;
  next_action: string;
}

export interface HeadlessRunProgressCheckpoint {
  progress_fingerprint: string;
  aggregate_sequence: number;
}

export interface HeadlessRunAdvanceResult {
  status: HeadlessContinueOnceStatus;
  session_id: string;
  advance_id: string;
  session_sequence: number;
  replayed: boolean;
  start_progress: HeadlessRunProgressCheckpoint;
  post_progress?: HeadlessRunProgressCheckpoint | null;
  max_steps: number;
  step_count: number;
  executed_count: number;
  replayed_count: number;
  stop_reason: string;
  checkpoint_fingerprint: string;
  terminal_completion_evidence?: TaskRunCompletionEvidence | null;
  next_route?: HeadlessContinueRoute | null;
  steps?: HeadlessContinueStepResult[];
  next_action: string;
}

export interface HeadlessRunDriveResult {
  status: HeadlessContinueOnceStatus;
  session_id: string;
  drive_id: string;
  start_session_sequence: number;
  end_session_sequence: number;
  replayed: boolean;
  max_advances: number;
  max_steps_per_advance: number;
  advance_count: number;
  executed_count: number;
  replayed_count: number;
  stop_reason: string;
  drive_fingerprint: string;
  terminal_completion_evidence?: TaskRunCompletionEvidence | null;
  completion_closure: HeadlessRunCompletionClosure;
  completion_finalization?: HeadlessRunCompletionFinalization | null;
  accepted_completion?: HeadlessRunAcceptedCompletion | null;
  product_evidence_matrix?: HeadlessRunProductEvidenceMatrix | null;
  product_completion_decision?: HeadlessRunProductCompletionDecision | null;
  start_progress: HeadlessRunProgressCheckpoint;
  post_progress?: HeadlessRunProgressCheckpoint | null;
  next_route?: HeadlessContinueRoute | null;
  advances?: HeadlessRunAdvanceResult[];
  journey_route_resume?: HeadlessRunJourneyRouteResumeMetadata | null;
  journey_closure?: HeadlessRunJourneyClosureMetadata | null;
  journey?: HeadlessRunJourneyMetadata | null;
  journey_execution?: HeadlessRunJourneyExecutionMetadata | null;
  next_action: string;
}

export interface HeadlessRunProductCompletionDecision {
  decision_id: string;
  task_id: string;
  run_id: string;
  acceptance_id: string;
  status: 'product_complete' | 'continue_development' | 'blocked_by_product_evidence';
  next_action: 'stop_autonomous_development' | 'plan_next_phase' | 'repair_product_completion_evidence';
  target_capability: string;
  concrete_capability_transition: string;
  accepted_completion_fingerprint: string;
  terminal_completion_fingerprint: string;
  completion_closure_fingerprint: string;
  product_evidence_fingerprint: string;
  decision_fingerprint: string;
  validated_gate_categories: string[];
  derived_product_evidence_matrix_fingerprint?: string | null;
  behavior_evidence_count: number;
  rejected_alternatives_count: number;
  safety_boundary_reviewed: boolean;
  non_goals_reviewed: boolean;
  technical_debt_reviewed: boolean;
  remaining_capability?: string | null;
  milestone_exit_rationale?: string | null;
  replayed: boolean;
}

export interface HeadlessRunProductEvidenceMatrix {
  derivation_id: string;
  task_id: string;
  run_id: string;
  acceptance_id: string;
  phase_id: string;
  milestone: string;
  target_capability: string;
  concrete_capability_transition: string;
  accepted_completion_fingerprint: string;
  terminal_completion_fingerprint: string;
  completion_closure_fingerprint: string;
  product_evidence_matrix_fingerprint: string;
  product_completion_claim: boolean;
  artifact_count: number;
  artifact_hashes: HeadlessRunProductEvidenceArtifact[];
  validated_gate_categories: string[];
  behavior_evidence_count: number;
  rejected_alternatives_count: number;
  safety_boundary_reviewed: boolean;
  non_goals_reviewed: boolean;
  technical_debt_reviewed: boolean;
  next_action: 'record_product_completion_decision_with_runtime_evidence';
  replayed: boolean;
}

export interface HeadlessRunProductEvidenceArtifact {
  path: string;
  sha256: string;
}

export interface HeadlessRunJourneyMetadata {
  journey_id: string;
  task_id: string;
  run_id: string;
  session_id: string;
  drive_id: string;
  start_progress_fingerprint: string;
  start_aggregate_sequence: number;
  post_progress_fingerprint?: string | null;
  post_aggregate_sequence?: number | null;
  closure_status: HeadlessRunCompletionClosureStatus;
  next_action: string;
  replayed: boolean;
  journey_fingerprint: string;
}

export interface HeadlessRunJourneyRouteResumeMetadata {
  journey_id: string;
  task_id: string;
  run_id: string;
  session_id: string;
  drive_id: string;
  route_kind: HeadlessContinueRouteKind;
  source_continuation_id: string;
  source_decision_id: string;
  source_checkpoint_fingerprint: string;
  derived_target_class: string;
  result_advance_id?: string | null;
  result_continuation_id?: string | null;
  post_route_progress_fingerprint?: string | null;
  post_route_aggregate_sequence?: number | null;
  next_action: string;
  replayed: boolean;
  resume_fingerprint: string;
}

export interface HeadlessRunJourneyClosureMetadata {
  journey_id: string;
  task_id: string;
  run_id: string;
  session_id: string;
  drive_id: string;
  source_replacement_drive_id: string;
  source_replacement_resume_fingerprint: string;
  replacement_route_kind: HeadlessContinueRouteKind;
  replacement_continuation_id: string;
  replacement_checkpoint_fingerprint: string;
  active_modepack_activation_fingerprint: string;
  closure_fingerprint: string;
  finalization_fingerprint?: string | null;
  terminal_completion_fingerprint?: string | null;
  progress_fingerprint: string;
  aggregate_sequence: number;
  next_action: string;
  replayed: boolean;
  journey_closure_fingerprint: string;
}

export interface HeadlessRunJourneyExecutionBoundaryMetadata {
  boundary: string;
  drive_id: string;
  route_kind?: HeadlessContinueRouteKind | null;
  session_sequence: number;
  drive_fingerprint: string;
  resume_fingerprint?: string | null;
  journey_closure_fingerprint?: string | null;
  replayed: boolean;
}

export interface HeadlessRunJourneyExecutionMetadata {
  journey_id: string;
  task_id: string;
  run_id: string;
  session_id: string;
  drive_id: string;
  journey_fingerprint: string;
  completed_boundaries: HeadlessRunJourneyExecutionBoundaryMetadata[];
  complete: boolean;
  next_action: string;
  replayed: boolean;
  execution_checkpoint_fingerprint: string;
}

export type HeadlessRunCompletionClosureStatus =
  | 'complete'
  | 'routed_explicit_action'
  | 'budget_exhausted'
  | 'stale_no_progress'
  | 'task_in_progress'
  | 'no_eligible_task'
  | 'unknown_nonterminal';

export interface HeadlessRunCompletionClosure {
  status: HeadlessRunCompletionClosureStatus;
  stop_reason: string;
  terminal_task_count: number;
  total_task_count: number;
  runnable_task_count: number;
  blocked_task_count: number;
  route_candidate_count: number;
  progress_fingerprint: string;
  aggregate_sequence: number;
  route_kind?: HeadlessContinueRouteKind | null;
  route_task_id?: string | null;
  route_run_id?: string | null;
  terminal_completion_fingerprint?: string | null;
  next_action: string;
  closure_fingerprint: string;
}

export interface HeadlessRunCompletionFinalization {
  status: 'finalized';
  session_id: string;
  drive_id: string;
  start_session_sequence: number;
  end_session_sequence: number;
  closure_fingerprint: string;
  progress_fingerprint: string;
  aggregate_sequence: number;
  owner_task_id?: string | null;
  owner_run_id?: string | null;
  terminal_completion_fingerprint?: string | null;
  terminal_task_count: number;
  total_task_count: number;
  finalization_fingerprint: string;
  replayed: boolean;
  next_action: string;
}

export interface HeadlessRunAcceptedCompletion {
  task_id: string;
  run_id: string;
  acceptance_id: string;
  status: 'AcceptedComplete';
  terminal_completion_fingerprint: string;
  acceptance_fingerprint: string;
  verifier_gate_status: string;
  replayed: boolean;
  next_action: string;
}

export interface TaskRunSelectedIndexPromptContextSummary {
  prompt_context_id: string;
  source_event_id: string;
  source_event_kind: 'CodebaseIndexSelectionReadCompleted';
  query_id: string;
  selection_id: string;
  query_fingerprint: string;
  selection_fingerprint: string;
  index_id: string;
  workspace_fingerprint: string;
  snapshot_fingerprint: string;
  read_path_fingerprint: string;
  file_kind: CodebaseIndexFileEntry['file_kind'];
  bytes_read: number;
  content_char_count: number;
  materialized_content_char_count: number;
  content_truncated_for_prompt: boolean;
  content_sha256: string;
  prompt_preview_redacted: true;
  next_action: 'continue_task_execution_with_materialized_context';
}

export interface TaskRunVerificationRecoveryContextReadSummary {
  context_read_id: string;
  source_task_id: string;
  source_run_id: string;
  recovery_task_id: string;
  recovery_run_id: string;
  failure_fingerprint: string;
  diagnostic_index: number;
  tool_id: string;
  check_id: string;
  diagnostic_kind: string;
  severity: string;
  test_name_hash?: string | null;
  read_path_fingerprint: string;
  line?: number | null;
  column?: number | null;
  excerpt_start_line: number;
  excerpt_end_line: number;
  excerpt_bytes: number;
  excerpt_sha256: string;
  excerpt_truncated: boolean;
  prompt_preview_redacted: true;
  replayed: boolean;
  next_action: 'run_recovery_task_with_context';
}

export interface TaskRunContextBudgetSummary {
  requested: boolean;
  max_prompt_chars: number;
  max_ledger_events: number;
  max_selected_index_chars: number;
  total_events: number;
  included_events: number;
  omitted_events: number;
  selected_index_context_present: boolean;
  selected_index_content_chars: number;
  selected_index_materialized_chars: number;
  selected_index_truncated: boolean;
  protected_context_chars: number;
  prompt_chars: number;
  prompt_within_budget: boolean;
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

export interface TaskRunPatchApplyRecoveryRepairOutcome {
  gate_status: 'Passed' | 'Failed';
  source_run_id: string;
  source_proposal_id: string;
  source_apply_id: string;
  recovery_task_id: string;
  recovery_run_id: string;
  source_apply_fingerprint: string;
  failure_fingerprint: string;
  failure_class: string;
  proposal_id?: string | null;
  proposal_count: number;
  failure_reason?: string | null;
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
  patch_apply_recovery_provenance?: PatchApplyRecoveryProvenance | null;
  verification_recovery_retry_provenance?: VerificationRecoveryRetryProvenance | null;
  llm_provider_failure_retry_provenance?: LlmProviderFailureRetryProvenance | null;
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
  progress_snapshot: ProgressSnapshot;
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

export type ProgressLifecyclePhase = 'created' | 'queued' | 'running' | 'blocked_for_explicit_action' | 'terminal' | 'unknown';

export type ProgressCurrentStage =
  | 'created'
  | 'queued'
  | 'running_agent_loop'
  | 'inspect_non_runnable_child_tasks'
  | 'completed_with_pending_children'
  | 'parent_join_ready'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export type ProgressNextAction =
  | 'run_task_explicitly'
  | 'run_parent_task_explicitly'
  | 'run_remaining_child_tasks_explicitly'
  | 'inspect_non_runnable_child_tasks'
  | 'start_verification_recovery_explicitly'
  | 'inspect_terminal_result'
  | 'inspect_task';

export type ProgressVerificationState = 'not_required' | 'pending' | 'passed' | 'failed' | 'unknown';

export interface ProgressSnapshot {
  lifecycle_phase: ProgressLifecyclePhase;
  current_stage: ProgressCurrentStage;
  next_action: ProgressNextAction;
  source_fingerprint: string;
  event_count: number;
  agent_loop_terminal_evidence_present: boolean;
  task_terminal_event_present: boolean;
  controlled_child_count: number;
  pending_controlled_child_count: number;
  terminal_controlled_child_count: number;
  non_runnable_controlled_child_count: number;
  verification_state: ProgressVerificationState;
  verifier_required: boolean;
  verifier_failed: boolean;
  verifier_passed: boolean;
  recovery_signal_present: boolean;
  apply_signal_present: boolean;
  selected_index_context_present: boolean;
  selected_index_context_count: number;
}

export interface TaskListResult {
  tasks: TaskRecord[];
  progress_overview: TaskListProgressOverview;
}

export interface TaskListProgressOverview {
  source_fingerprint: string;
  aggregate_sequence: number;
  task_count: number;
  root_task_ids: string[];
  runnable_task_ids: string[];
  blocked_task_ids: string[];
  terminal_task_ids: string[];
  parent_join_ready_task_ids: string[];
  status_counts: TaskStatusCounts;
  stage_counts: TaskListProgressStageCount[];
  next_action_sets: TaskListProgressNextActionSet[];
  blocked_sets: TaskListProgressBlockedSet[];
  headless_route_candidates: TaskListHeadlessRouteCandidate[];
  nodes: TaskProgressGraphNode[];
  edges: TaskProgressGraphEdge[];
}

export interface TaskListHeadlessRouteCandidate {
  kind: HeadlessContinueRouteKind;
  reason: string;
  task_id?: string | null;
  run_id?: string | null;
  proposal_id?: string | null;
  apply_id?: string | null;
  failure_fingerprint?: string | null;
  apply_fingerprint?: string | null;
  progress_fingerprint: string;
  aggregate_sequence: number;
  route_fingerprint: string;
  priority: number;
  next_action: string;
}

export interface TaskStatusCounts {
  created: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export interface TaskListProgressStageCount {
  current_stage: ProgressCurrentStage;
  task_count: number;
}

export interface TaskListProgressNextActionSet {
  next_action: ProgressNextAction;
  task_count: number;
  task_ids: string[];
}

export interface TaskListProgressBlockedSet {
  current_stage: ProgressCurrentStage;
  next_action: ProgressNextAction;
  task_count: number;
  task_ids: string[];
}

export interface TaskProgressGraphNode {
  task_id: string;
  run_id: string;
  status: TaskStatus;
  lifecycle_phase: ProgressLifecyclePhase;
  current_stage: ProgressCurrentStage;
  next_action: ProgressNextAction;
  parent_task_id?: string | null;
  parent_run_id?: string | null;
  child_task_count: number;
  created_at: string;
  updated_at: string;
}

export interface TaskProgressGraphEdge {
  parent_task_id: string;
  parent_run_id: string;
  child_task_id: string;
  child_run_id: string;
  source_candidate_id: string;
  source_handoff_envelope_fingerprint: string;
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
  llm_provider_failure_retry_provenance?: LlmProviderFailureRetryProvenance | null;
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
  next_action: 'build_bounded_index_query_file_selection';
}

export interface CodebaseIndexQueryResult {
  query_id: string;
  selection_id: string;
  query_fingerprint: string;
  snapshot: CodebaseIndexQuerySnapshotSummary;
  matched_entry_count: number;
  returned_entry_count: number;
  max_results: number;
  entries: CodebaseIndexSelectedEntry[];
  ledger_event_id: string;
  ledger_event_kind: 'CodebaseIndexQueryCompleted';
  next_action: 'read_selected_files_with_controlled_workspace_read';
}

export interface CodebaseIndexSelectionReadResult {
  query_id: string;
  selection_id: string;
  query_fingerprint: string;
  selection_fingerprint: string;
  snapshot: CodebaseIndexQuerySnapshotSummary;
  path: string;
  file_kind: CodebaseIndexFileEntry['file_kind'];
  content: string;
  truncated: boolean;
  bytes_read: number;
  content_sha256: string;
  content_hash_verified: boolean;
  ledger_event_id: string;
  ledger_event_kind: 'CodebaseIndexSelectionReadCompleted';
  next_action: 'use_selected_file_context_for_prompt_materialization';
}

export interface CodebaseIndexQuerySnapshotSummary {
  index_id: string;
  root: string;
  workspace_fingerprint: string;
  snapshot_fingerprint: string;
  built_at: string;
  truncated: boolean;
}

export interface CodebaseIndexSelectedEntry {
  path: string;
  file_kind: CodebaseIndexFileEntry['file_kind'];
  byte_length: number;
  line_count?: number | null;
  content_sha256?: string | null;
  score: number;
  match_reasons: CodebaseIndexMatchReason[];
}

export type CodebaseIndexMatchReason = 'path_exact' | 'path_token' | 'file_name' | 'extension' | 'kind';

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
  skipped_ignored: number;
  skipped_sensitive: number;
  skipped_symlink: number;
  skipped_too_large: number;
  skipped_binary_like: number;
  skipped_unreadable: number;
  skipped_unsafe_path: number;
  skipped_other: number;
  truncated_entries: number;
  visited_entries: number;
  truncated_directories: number;
  ignore_rule_files_loaded: number;
  ignore_rule_count: number;
  sensitive_finding_count: number;
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

export interface ProposalPatchHunk {
  old_text: string;
  new_text: string;
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
  hunk_count?: number | null;
  hunk_fingerprint?: string | null;
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
  transaction_id?: string | null;
  transaction_status?: string | null;
  transaction_items?: WorkspacePatchApplyTransactionItemResultSummary[];
  transaction_recovery_source?: WorkspacePatchTransactionRecoverySourceSummary | null;
  transaction_recovery_status?: string | null;
}

export interface WorkspacePatchTransactionRecoverySourceSummary {
  source_run_id: string;
  source_apply_id: string;
  source_transaction_id: string;
  source_transaction_fingerprint: string;
  source_transaction_status: string;
  source_item_count: number;
  source_applied_item_count: number;
  source_recovery_item_count: number;
}

export interface WorkspacePatchApplyTransactionItemResultSummary {
  proposal_id: string;
  apply_status: string;
  apply_reason: string;
  operation: string;
  path: string;
  expected_target_sha256: string | null;
  expected_target_absent: boolean | null;
  pre_write_target_sha256: string | null;
  pre_write_target_exists: boolean | null;
  post_write_sha256: string | null;
  post_delete_target_exists?: boolean | null;
  content_chars: number;
  content_bytes: number;
  atomic_replacement_completed: boolean;
  atomic_create_completed: boolean;
  atomic_delete_completed?: boolean | null;
  applied: boolean;
  temp_file_cleaned: boolean;
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

export function isModePackActivateResult(value: unknown): value is ModePackActivateResult {
  return (
    isRecord(value) &&
    typeof value.activated === 'boolean' &&
    typeof value.replayed === 'boolean' &&
    isModePackActiveSnapshotSummary(value.snapshot)
  );
}

export function isModePackReplaceActiveResult(value: unknown): value is ModePackReplaceActiveResult {
  return (
    isRecord(value) &&
    typeof value.replaced === 'boolean' &&
    typeof value.replayed === 'boolean' &&
    isModePackActiveSnapshotSummary(value.previous_snapshot) &&
    isModePackActiveSnapshotSummary(value.replacement_snapshot) &&
    typeof value.replacement_event_id === 'string' &&
    (value.approved_candidate === undefined || value.approved_candidate === null || isModePackApprovedCandidateSummary(value.approved_candidate)) &&
    (value.candidate_consumed_event_id === undefined || value.candidate_consumed_event_id === null || typeof value.candidate_consumed_event_id === 'string') &&
    (value.update_admission === undefined || value.update_admission === null || isModePackUpdateAdmissionSummary(value.update_admission)) &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_modepack_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ledger_payload')
  );
}

function isModePackUpdateAdmissionSummary(value: unknown): value is ModePackUpdateAdmissionSummary {
  return (
    isRecord(value) &&
    typeof value.update_id === 'string' &&
    typeof value.current_activation_fingerprint === 'string' &&
    isSha256Fingerprint(value.current_activation_fingerprint) &&
    typeof value.replacement_activation_fingerprint === 'string' &&
    isSha256Fingerprint(value.replacement_activation_fingerprint) &&
    typeof value.modepack_name === 'string' &&
    typeof value.source_kind === 'string' &&
    typeof value.approval_id === 'string' &&
    typeof value.candidate_id === 'string' &&
    typeof value.source_url_host === 'string' &&
    typeof value.source_url_fingerprint === 'string' &&
    isSha256Fingerprint(value.source_url_fingerprint) &&
    isModePackDnsBindingSummary(value.dns_binding) &&
    typeof value.content_sha256 === 'string' &&
    isSha256Fingerprint(value.content_sha256) &&
    typeof value.compiled_policy_fingerprint === 'string' &&
    isSha256Fingerprint(value.compiled_policy_fingerprint) &&
    typeof value.provenance_id === 'string' &&
    typeof value.provenance_event_id === 'string' &&
    typeof value.trusted_signer_trust_id === 'string' &&
    typeof value.trusted_signer_event_id === 'string' &&
    typeof value.signer_fingerprint === 'string' &&
    isSha256Fingerprint(value.signer_fingerprint) &&
    typeof value.statement_sha256 === 'string' &&
    isSha256Fingerprint(value.statement_sha256) &&
    typeof value.admitted_at === 'string' &&
    typeof value.admission_event_id === 'string' &&
    !Object.prototype.hasOwnProperty.call(value, 'modepack_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_modepack_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_provenance_statement_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'provenance_signature_base64') &&
    !Object.prototype.hasOwnProperty.call(value, 'provenance_public_key_base64') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ledger_payload')
  );
}

export function isModePackRollbackActiveResult(value: unknown): value is ModePackRollbackActiveResult {
  return (
    isRecord(value) &&
    typeof value.rolled_back === 'boolean' &&
    typeof value.replayed === 'boolean' &&
    isModePackActiveSnapshotSummary(value.current_snapshot) &&
    isModePackActiveSnapshotSummary(value.restored_snapshot) &&
    typeof value.rollback_event_id === 'string' &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_modepack_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ledger_payload')
  );
}

export function isModePackFetchCandidateResult(value: unknown): value is ModePackFetchCandidateResult {
  return (
    isRecord(value) &&
    typeof value.fetched === 'boolean' &&
    typeof value.replayed === 'boolean' &&
    isModePackCandidateSummary(value.candidate) &&
    typeof value.next_action === 'string' &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_modepack_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ledger_payload')
  );
}

export function isModePackSelectRegistryUpdateResult(value: unknown): value is ModePackSelectRegistryUpdateResult {
  return (
    isRecord(value) &&
    typeof value.selected === 'boolean' &&
    typeof value.replayed === 'boolean' &&
    isModePackRegistryUpdateSelectionSummary(value.selection) &&
    typeof value.next_action === 'string' &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_registry_manifest_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_modepack_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_provenance_statement_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'registry_provenance_statement_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'registry_provenance_signature_base64') &&
    !Object.prototype.hasOwnProperty.call(value, 'registry_provenance_public_key_base64') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ledger_payload')
  );
}

export function isModePackApproveCandidateResult(value: unknown): value is ModePackApproveCandidateResult {
  return (
    isRecord(value) &&
    typeof value.approved === 'boolean' &&
    typeof value.replayed === 'boolean' &&
    isModePackApprovedCandidateSummary(value.approval) &&
    typeof value.next_action === 'string' &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_modepack_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ledger_payload')
  );
}

export function isModePackTrustSignerResult(value: unknown): value is ModePackTrustSignerResult {
  return (
    isRecord(value) &&
    typeof value.trusted === 'boolean' &&
    typeof value.replayed === 'boolean' &&
    isModePackTrustedSignerSummary(value.trusted_signer) &&
    typeof value.next_action === 'string' &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ledger_payload') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_modepack_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_provenance_statement_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'provenance_signature_base64') &&
    !Object.prototype.hasOwnProperty.call(value, 'provenance_public_key_base64')
  );
}

export function isModePackRevokeSignerResult(value: unknown): value is ModePackRevokeSignerResult {
  return (
    isRecord(value) &&
    typeof value.revoked === 'boolean' &&
    typeof value.replayed === 'boolean' &&
    isModePackRevokedSignerSummary(value.revoked_signer) &&
    typeof value.next_action === 'string' &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ledger_payload') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_modepack_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_provenance_statement_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'provenance_signature_base64') &&
    !Object.prototype.hasOwnProperty.call(value, 'provenance_public_key_base64')
  );
}

export function isModePackVerifyCandidateProvenanceResult(value: unknown): value is ModePackVerifyCandidateProvenanceResult {
  return (
    isRecord(value) &&
    typeof value.verified === 'boolean' &&
    typeof value.replayed === 'boolean' &&
    isModePackCandidateProvenanceSummary(value.provenance) &&
    typeof value.next_action === 'string' &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_modepack_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_provenance_statement_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'provenance_signature_base64') &&
    !Object.prototype.hasOwnProperty.call(value, 'provenance_public_key_base64') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ledger_payload')
  );
}

function isModePackRegistryUpdateSelectionSummary(value: unknown): value is ModePackRegistryUpdateSelectionSummary {
  return (
    isRecord(value) &&
    typeof value.selection_id === 'string' &&
    typeof value.registry_url_host === 'string' &&
    typeof value.registry_url_fingerprint === 'string' &&
    isSha256Fingerprint(value.registry_url_fingerprint) &&
    isModePackDnsBindingSummary(value.registry_dns_binding) &&
    typeof value.registry_manifest_sha256 === 'string' &&
    isSha256Fingerprint(value.registry_manifest_sha256) &&
    typeof value.registry_provenance_statement_sha256 === 'string' &&
    isSha256Fingerprint(value.registry_provenance_statement_sha256) &&
    typeof value.registry_signer_fingerprint === 'string' &&
    isSha256Fingerprint(value.registry_signer_fingerprint) &&
    typeof value.registry_trusted_signer_trust_id === 'string' &&
    typeof value.registry_trusted_signer_event_id === 'string' &&
    typeof value.current_activation_fingerprint === 'string' &&
    isSha256Fingerprint(value.current_activation_fingerprint) &&
    typeof value.current_modepack_name === 'string' &&
    typeof value.current_source_kind === 'string' &&
    typeof value.candidate_url === 'string' &&
    typeof value.candidate_url_host === 'string' &&
    typeof value.candidate_url_fingerprint === 'string' &&
    isSha256Fingerprint(value.candidate_url_fingerprint) &&
    typeof value.candidate_content_sha256 === 'string' &&
    isSha256Fingerprint(value.candidate_content_sha256) &&
    typeof value.candidate_compiled_policy_fingerprint === 'string' &&
    isSha256Fingerprint(value.candidate_compiled_policy_fingerprint) &&
    typeof value.provenance_statement_url === 'string' &&
    typeof value.provenance_statement_url_host === 'string' &&
    typeof value.provenance_statement_url_fingerprint === 'string' &&
    isSha256Fingerprint(value.provenance_statement_url_fingerprint) &&
    typeof value.provenance_statement_sha256 === 'string' &&
    isSha256Fingerprint(value.provenance_statement_sha256) &&
    typeof value.signer_fingerprint === 'string' &&
    isSha256Fingerprint(value.signer_fingerprint) &&
    typeof value.selected_at === 'string' &&
    typeof value.selection_event_id === 'string' &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_registry_manifest_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_modepack_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ip_address') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_provenance_statement_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'registry_provenance_statement_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'registry_provenance_signature_base64') &&
    !Object.prototype.hasOwnProperty.call(value, 'registry_provenance_public_key_base64') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ledger_payload')
  );
}

function isModePackApprovedCandidateSummary(value: unknown): value is ModePackApprovedCandidateSummary {
  return (
    isRecord(value) &&
    typeof value.approval_id === 'string' &&
    typeof value.candidate_id === 'string' &&
    typeof value.source_kind === 'string' &&
    typeof value.source_url_host === 'string' &&
    typeof value.source_url_fingerprint === 'string' &&
    isSha256Fingerprint(value.source_url_fingerprint) &&
    (value.dns_binding === undefined || value.dns_binding === null || isModePackDnsBindingSummary(value.dns_binding)) &&
    typeof value.content_sha256 === 'string' &&
    isSha256Fingerprint(value.content_sha256) &&
    typeof value.modepack_name === 'string' &&
    typeof value.schema_version === 'number' &&
    Number.isInteger(value.schema_version) &&
    typeof value.mode_count === 'number' &&
    Number.isInteger(value.mode_count) &&
    Array.isArray(value.mode_ids) &&
    value.mode_ids.every((modeId) => typeof modeId === 'string') &&
    typeof value.compiled_policy_fingerprint === 'string' &&
    isSha256Fingerprint(value.compiled_policy_fingerprint) &&
    typeof value.provenance_id === 'string' &&
    typeof value.provenance_event_id === 'string' &&
    typeof value.trusted_signer_trust_id === 'string' &&
    typeof value.trusted_signer_event_id === 'string' &&
    typeof value.signer_fingerprint === 'string' &&
    isSha256Fingerprint(value.signer_fingerprint) &&
    typeof value.statement_sha256 === 'string' &&
    isSha256Fingerprint(value.statement_sha256) &&
    typeof value.approved_at === 'string' &&
    typeof value.approval_event_id === 'string' &&
    typeof value.consumed === 'boolean' &&
    !Object.prototype.hasOwnProperty.call(value, 'modepack_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_modepack_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ledger_payload')
  );
}

function isModePackTrustedSignerSummary(value: unknown): value is ModePackTrustedSignerSummary {
  return (
    isRecord(value) &&
    typeof value.trust_id === 'string' &&
    typeof value.signer_fingerprint === 'string' &&
    isSha256Fingerprint(value.signer_fingerprint) &&
    typeof value.trusted_at === 'string' &&
    (value.expires_at === undefined || typeof value.expires_at === 'string') &&
    typeof value.trust_event_id === 'string' &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ledger_payload') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_modepack_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_provenance_statement_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'provenance_signature_base64') &&
    !Object.prototype.hasOwnProperty.call(value, 'provenance_public_key_base64')
  );
}

function isModePackRevokedSignerSummary(value: unknown): value is ModePackRevokedSignerSummary {
  return (
    isRecord(value) &&
    typeof value.revocation_id === 'string' &&
    typeof value.signer_fingerprint === 'string' &&
    isSha256Fingerprint(value.signer_fingerprint) &&
    typeof value.trusted_signer_trust_id === 'string' &&
    typeof value.trusted_signer_event_id === 'string' &&
    typeof value.revoked_at === 'string' &&
    typeof value.revocation_event_id === 'string' &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ledger_payload') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_modepack_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_provenance_statement_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'provenance_signature_base64') &&
    !Object.prototype.hasOwnProperty.call(value, 'provenance_public_key_base64')
  );
}

function isModePackCandidateProvenanceSummary(value: unknown): value is ModePackCandidateProvenanceSummary {
  return (
    isRecord(value) &&
    typeof value.provenance_id === 'string' &&
    typeof value.candidate_id === 'string' &&
    typeof value.source_kind === 'string' &&
    typeof value.source_url_host === 'string' &&
    typeof value.source_url_fingerprint === 'string' &&
    isSha256Fingerprint(value.source_url_fingerprint) &&
    (value.dns_binding === undefined || value.dns_binding === null || isModePackDnsBindingSummary(value.dns_binding)) &&
    typeof value.content_sha256 === 'string' &&
    isSha256Fingerprint(value.content_sha256) &&
    typeof value.modepack_name === 'string' &&
    typeof value.schema_version === 'number' &&
    Number.isInteger(value.schema_version) &&
    typeof value.mode_count === 'number' &&
    Number.isInteger(value.mode_count) &&
    Array.isArray(value.mode_ids) &&
    value.mode_ids.every((modeId) => typeof modeId === 'string') &&
    typeof value.compiled_policy_fingerprint === 'string' &&
    isSha256Fingerprint(value.compiled_policy_fingerprint) &&
    typeof value.signer_fingerprint === 'string' &&
    isSha256Fingerprint(value.signer_fingerprint) &&
    typeof value.statement_sha256 === 'string' &&
    isSha256Fingerprint(value.statement_sha256) &&
    typeof value.signature_sha256 === 'string' &&
    isSha256Fingerprint(value.signature_sha256) &&
    typeof value.verified_at === 'string' &&
    typeof value.provenance_event_id === 'string' &&
    !Object.prototype.hasOwnProperty.call(value, 'modepack_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_modepack_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_provenance_statement_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'provenance_signature_base64') &&
    !Object.prototype.hasOwnProperty.call(value, 'provenance_public_key_base64') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ledger_payload')
  );
}

function isModePackCandidateSummary(value: unknown): value is ModePackCandidateSummary {
  return (
    isRecord(value) &&
    typeof value.candidate_id === 'string' &&
    typeof value.source_kind === 'string' &&
    typeof value.source_url_host === 'string' &&
    typeof value.source_url_fingerprint === 'string' &&
    isSha256Fingerprint(value.source_url_fingerprint) &&
    isModePackDnsBindingSummary(value.dns_binding) &&
    typeof value.content_sha256 === 'string' &&
    isSha256Fingerprint(value.content_sha256) &&
    typeof value.byte_count === 'number' &&
    Number.isInteger(value.byte_count) &&
    value.byte_count >= 0 &&
    typeof value.modepack_name === 'string' &&
    typeof value.schema_version === 'number' &&
    Number.isInteger(value.schema_version) &&
    typeof value.mode_count === 'number' &&
    Number.isInteger(value.mode_count) &&
    Array.isArray(value.mode_ids) &&
    value.mode_ids.every((modeId) => typeof modeId === 'string') &&
    typeof value.compiled_policy_fingerprint === 'string' &&
    isSha256Fingerprint(value.compiled_policy_fingerprint) &&
    typeof value.cached_at === 'string' &&
    typeof value.cache_event_id === 'string' &&
    !Object.prototype.hasOwnProperty.call(value, 'modepack_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_modepack_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ip_address') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ledger_payload')
  );
}

function isModePackDnsBindingSummary(value: unknown): value is ModePackDnsBindingSummary {
  return (
    isRecord(value) &&
    typeof value.resolution_fingerprint === 'string' &&
    isSha256Fingerprint(value.resolution_fingerprint) &&
    typeof value.pinned_address_fingerprint === 'string' &&
    isSha256Fingerprint(value.pinned_address_fingerprint) &&
    typeof value.resolved_address_count === 'number' &&
    Number.isInteger(value.resolved_address_count) &&
    value.resolved_address_count > 0 &&
    (value.pinned_address_family === 'ipv4' || value.pinned_address_family === 'ipv6') &&
    !Object.prototype.hasOwnProperty.call(value, 'address') &&
    !Object.prototype.hasOwnProperty.call(value, 'ip') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ip_address')
  );
}

function isModePackActiveSnapshotSummary(value: unknown): value is ModePackActiveSnapshotSummary {
  return (
    isRecord(value) &&
    typeof value.activation_id === 'string' &&
    typeof value.activation_fingerprint === 'string' &&
    isSha256Fingerprint(value.activation_fingerprint) &&
    typeof value.modepack_name === 'string' &&
    Number.isInteger(value.schema_version) &&
    typeof value.source_kind === 'string' &&
    typeof value.source_path === 'string' &&
    Number.isInteger(value.mode_count) &&
    Array.isArray(value.mode_ids) &&
    value.mode_ids.every((modeId) => typeof modeId === 'string') &&
    typeof value.compiled_policy_fingerprint === 'string' &&
    isSha256Fingerprint(value.compiled_policy_fingerprint) &&
    typeof value.activated_at === 'string' &&
    typeof value.activation_event_id === 'string' &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_modepack_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ledger_payload')
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
  return !Object.prototype.hasOwnProperty.call(value, 'content') && !Object.prototype.hasOwnProperty.call(value, 'raw_content') && !Object.prototype.hasOwnProperty.call(value, 'full_content') && !Object.prototype.hasOwnProperty.call(value, 'patch') && !Object.prototype.hasOwnProperty.call(value, 'diff') && !Object.prototype.hasOwnProperty.call(value, 'raw_input') && !Object.prototype.hasOwnProperty.call(value, 'raw_query') && !Object.prototype.hasOwnProperty.call(value, 'canonical_path') && !Object.prototype.hasOwnProperty.call(value, 'absolute_path') && !Object.prototype.hasOwnProperty.call(value, 'file_content') && !Object.prototype.hasOwnProperty.call(value, 'command') && !Object.prototype.hasOwnProperty.call(value, 'stdout') && !Object.prototype.hasOwnProperty.call(value, 'stderr') && !Object.prototype.hasOwnProperty.call(value, 'env') && !Object.prototype.hasOwnProperty.call(value, 'test_name') && !Object.prototype.hasOwnProperty.call(value, 'request_body') && !Object.prototype.hasOwnProperty.call(value, 'serialized_request_body');
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

export function isWorkspacePatchApplyTransactionItemResultSummary(value: unknown): value is WorkspacePatchApplyTransactionItemResultSummary {
  return isRecord(value) && typeof value.proposal_id === 'string' && typeof value.apply_status === 'string' && typeof value.apply_reason === 'string' && typeof value.operation === 'string' && typeof value.path === 'string' && (typeof value.expected_target_sha256 === 'string' || value.expected_target_sha256 === null) && (typeof value.expected_target_absent === 'boolean' || value.expected_target_absent === null) && (typeof value.pre_write_target_sha256 === 'string' || value.pre_write_target_sha256 === null) && (typeof value.pre_write_target_exists === 'boolean' || value.pre_write_target_exists === null) && (typeof value.post_write_sha256 === 'string' || value.post_write_sha256 === null) && (value.post_delete_target_exists === undefined || typeof value.post_delete_target_exists === 'boolean' || value.post_delete_target_exists === null) && isNonNegativeInteger(value.content_chars) && isNonNegativeInteger(value.content_bytes) && typeof value.atomic_replacement_completed === 'boolean' && typeof value.atomic_create_completed === 'boolean' && (value.atomic_delete_completed === undefined || typeof value.atomic_delete_completed === 'boolean' || value.atomic_delete_completed === null) && typeof value.applied === 'boolean' && typeof value.temp_file_cleaned === 'boolean' && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchTransactionRecoverySourceSummary(value: unknown): value is WorkspacePatchTransactionRecoverySourceSummary {
  return isRecord(value) && typeof value.source_run_id === 'string' && typeof value.source_apply_id === 'string' && typeof value.source_transaction_id === 'string' && typeof value.source_transaction_fingerprint === 'string' && typeof value.source_transaction_status === 'string' && isNonNegativeInteger(value.source_item_count) && isNonNegativeInteger(value.source_applied_item_count) && isNonNegativeInteger(value.source_recovery_item_count) && hasNoForbiddenRawFields(value);
}

export function isWorkspacePatchApplyResultSummary(value: unknown): value is WorkspacePatchApplyResultSummary {
  return isRecord(value) && typeof value.proposal_id === 'string' && typeof value.apply_id === 'string' && typeof value.apply_status === 'string' && typeof value.apply_reason === 'string' && typeof value.authorization_id === 'string' && typeof value.authorization_consumed === 'boolean' && typeof value.applied === 'boolean' && typeof value.operation === 'string' && typeof value.atomic_replacement_completed === 'boolean' && typeof value.atomic_create_completed === 'boolean' && typeof value.atomic_delete_completed === 'boolean' && typeof value.path === 'string' && (typeof value.expected_target_sha256 === 'string' || value.expected_target_sha256 === null) && (typeof value.expected_target_absent === 'boolean' || value.expected_target_absent === null) && (typeof value.pre_write_target_sha256 === 'string' || value.pre_write_target_sha256 === null) && (typeof value.pre_write_target_exists === 'boolean' || value.pre_write_target_exists === null) && (typeof value.post_write_sha256 === 'string' || value.post_write_sha256 === null) && (typeof value.post_delete_target_exists === 'boolean' || value.post_delete_target_exists === null) && isNonNegativeInteger(value.content_chars) && isNonNegativeInteger(value.content_bytes) && typeof value.checked_at === 'string' && (typeof value.applied_at === 'string' || value.applied_at === null) && typeof value.temp_file_cleaned === 'boolean' && isNonNegativeInteger(value.check_count) && Array.isArray(value.failed_checks) && value.failed_checks.every((check) => typeof check === 'string') && Array.isArray(value.blocked_checks) && value.blocked_checks.every((check) => typeof check === 'string') && Array.isArray(value.checklist) && value.checklist.every(isWorkspacePatchApplyResultCheckSummary) && (value.transaction_id === undefined || typeof value.transaction_id === 'string' || value.transaction_id === null) && (value.transaction_status === undefined || typeof value.transaction_status === 'string' || value.transaction_status === null) && (value.transaction_items === undefined || (Array.isArray(value.transaction_items) && value.transaction_items.every(isWorkspacePatchApplyTransactionItemResultSummary))) && (value.transaction_recovery_source === undefined || value.transaction_recovery_source === null || isWorkspacePatchTransactionRecoverySourceSummary(value.transaction_recovery_source)) && (value.transaction_recovery_status === undefined || typeof value.transaction_recovery_status === 'string' || value.transaction_recovery_status === null) && hasNoForbiddenRawFields(value);
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
    (value.hunk_count === undefined || value.hunk_count === null || isNonNegativeInteger(value.hunk_count)) &&
    (value.hunk_fingerprint === undefined || value.hunk_fingerprint === null || typeof value.hunk_fingerprint === 'string') &&
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
  'test_name_hash',
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

const LLM_PROVIDER_FAILURE_RETRY_PROVENANCE_KEYS = new Set([
  'source_task_id',
  'source_run_id',
  'failure_fingerprint',
  'failure_class',
  'provider',
  'model',
  'request_phase',
  'retryable',
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

const LLM_PROVIDER_FAILURE_RETRY_ADMISSION_KEYS = new Set([
  'source_task_id',
  'source_run_id',
  'retry_task_id',
  'retry_run_id',
  'failure_fingerprint',
  'failure_class',
  'retryable',
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
  if (!isRecord(value) || !hasOnlyKeys(value, BOUNDED_CARGO_DIAGNOSTIC_KEYS) || !hasNoForbiddenRawFields(value)) {
    return false;
  }
  if (value.tool_id === 'verification.cargo_test') {
    const hasValidTestNameHash = typeof value.test_name_hash === 'string' && isSha256Fingerprint(value.test_name_hash);
    const hasValidLocation =
      typeof value.workspace_relative_path === 'string' &&
      isBoundedCargoDiagnosticPath(value.workspace_relative_path) &&
      isPositiveInteger(value.line) &&
      isPositiveInteger(value.column);
    return (
      value.check_id === 'cargo_test' &&
      (value.diagnostic_kind === 'panic_location' || value.diagnostic_kind === 'test_failure' || value.diagnostic_kind === 'unavailable') &&
      value.severity === 'error' &&
      (value.code === undefined || value.code === null) &&
      (value.test_name_hash === undefined || value.test_name_hash === null || hasValidTestNameHash) &&
      (value.workspace_relative_path === undefined || value.workspace_relative_path === null || (typeof value.workspace_relative_path === 'string' && isBoundedCargoDiagnosticPath(value.workspace_relative_path))) &&
      (value.line === undefined || value.line === null || isPositiveInteger(value.line)) &&
      (value.column === undefined || value.column === null || isPositiveInteger(value.column)) &&
      typeof value.truncated === 'boolean' &&
      (value.diagnostic_kind !== 'panic_location' || (hasValidTestNameHash && hasValidLocation)) &&
      (value.diagnostic_kind !== 'test_failure' || hasValidTestNameHash)
    );
  }
  return (
    value.tool_id === 'verification.cargo_check' &&
    value.check_id === 'cargo_check' &&
    (value.diagnostic_kind === 'compile_error' || value.diagnostic_kind === 'compile_warning') &&
    (value.severity === 'error' || value.severity === 'warning') &&
    (value.code === undefined || value.code === null || isBoundedCargoDiagnosticCode(value.code)) &&
    (value.test_name_hash === undefined || value.test_name_hash === null) &&
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

export function isLlmProviderFailureRetryAdmission(value: unknown): value is LlmProviderFailureRetryAdmission {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, LLM_PROVIDER_FAILURE_RETRY_ADMISSION_KEYS) &&
    typeof value.source_task_id === 'string' &&
    value.source_task_id.trim().length > 0 &&
    typeof value.source_run_id === 'string' &&
    value.source_run_id.trim().length > 0 &&
    typeof value.retry_task_id === 'string' &&
    value.retry_task_id.trim().length > 0 &&
    typeof value.retry_run_id === 'string' &&
    value.retry_run_id.trim().length > 0 &&
    typeof value.failure_fingerprint === 'string' &&
    isSha256Fingerprint(value.failure_fingerprint) &&
    typeof value.failure_class === 'string' &&
    value.failure_class.trim().length > 0 &&
    value.retryable === true &&
    value.retry_running_enabled === false &&
    value.next_action === 'run_llm_provider_retry_task_explicitly' &&
    typeof value.replayed === 'boolean'
  );
}

export function isLlmProviderFailureRetryProvenance(value: unknown): value is LlmProviderFailureRetryProvenance {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, LLM_PROVIDER_FAILURE_RETRY_PROVENANCE_KEYS) &&
    typeof value.source_task_id === 'string' &&
    value.source_task_id.trim().length > 0 &&
    typeof value.source_run_id === 'string' &&
    value.source_run_id.trim().length > 0 &&
    typeof value.failure_fingerprint === 'string' &&
    isSha256Fingerprint(value.failure_fingerprint) &&
    typeof value.failure_class === 'string' &&
    value.failure_class.trim().length > 0 &&
    typeof value.provider === 'string' &&
    value.provider.trim().length > 0 &&
    typeof value.model === 'string' &&
    typeof value.request_phase === 'string' &&
    value.request_phase.trim().length > 0 &&
    value.retryable === true
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
    && (value.llm_provider_failure_retry_admission === undefined || value.llm_provider_failure_retry_admission === null || isLlmProviderFailureRetryAdmission(value.llm_provider_failure_retry_admission))
  );
}

export function isTaskRunParams(value: unknown): value is TaskRunParams {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['task_id', 'selected_index_context', 'verification_recovery_context_read', 'context_budget', 'completion_acceptance']) &&
    typeof value.task_id === 'string' &&
    value.task_id.trim().length > 0 &&
    (value.selected_index_context === undefined || value.selected_index_context === null || isCodebaseIndexSelectionReadResult(value.selected_index_context)) &&
    (value.verification_recovery_context_read === undefined || value.verification_recovery_context_read === null || isTaskRunVerificationRecoveryContextRead(value.verification_recovery_context_read)) &&
    (value.context_budget === undefined || value.context_budget === null || isTaskRunContextBudget(value.context_budget)) &&
    (value.completion_acceptance === undefined || value.completion_acceptance === null || isTaskRunCompletionAcceptanceRequest(value.completion_acceptance))
  );
}

export function isTaskRunCompletionAcceptanceRequest(value: unknown): value is TaskRunCompletionAcceptanceRequest {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'authorize_completion_acceptance',
      'source_run_id',
      'acceptance_id',
      'expected_completion_result_fingerprint',
    ]) &&
    value.authorize_completion_acceptance === true &&
    typeof value.source_run_id === 'string' &&
    value.source_run_id.trim().length > 0 &&
    isHeadlessRunId(value.acceptance_id) &&
    typeof value.expected_completion_result_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_completion_result_fingerprint)
  );
}

export function isTaskRunVerificationRecoveryContextRead(value: unknown): value is TaskRunVerificationRecoveryContextRead {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'authorize',
      'source_task_id',
      'source_run_id',
      'expected_failure_fingerprint',
      'diagnostic_index',
      'max_excerpt_bytes',
    ]) &&
    value.authorize === true &&
    typeof value.source_task_id === 'string' &&
    value.source_task_id.trim().length > 0 &&
    typeof value.source_run_id === 'string' &&
    value.source_run_id.trim().length > 0 &&
    typeof value.expected_failure_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_failure_fingerprint) &&
    isNonNegativeInteger(value.diagnostic_index) &&
    isNonNegativeInteger(value.max_excerpt_bytes) &&
    value.max_excerpt_bytes >= 128 &&
    value.max_excerpt_bytes <= 8192
  );
}

export function isTaskRunContextBudget(value: unknown): value is TaskRunContextBudget {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['max_prompt_chars', 'max_ledger_events', 'max_selected_index_chars']) &&
    isNonNegativeInteger(value.max_prompt_chars) &&
    value.max_prompt_chars >= 128 &&
    value.max_prompt_chars <= 1000000 &&
    isNonNegativeInteger(value.max_ledger_events) &&
    value.max_ledger_events <= 64 &&
    isNonNegativeInteger(value.max_selected_index_chars) &&
    value.max_selected_index_chars <= 65536
  );
}

export function isHeadlessContinueOnceParams(value: unknown): value is HeadlessContinueOnceParams {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['authorize', 'expected_progress_fingerprint', 'expected_aggregate_sequence', 'continuation_id', 'max_steps', 'context_budget', 'verification_recovery_source', 'verification_recovery_goal', 'verification_recovery_mode_id', 'verification_recovery_retry_source', 'verification_recovery_retry_goal', 'verification_recovery_retry_mode_id', 'llm_provider_failure_retry_source', 'llm_provider_failure_retry_goal', 'llm_provider_failure_retry_mode_id', 'verification_recovery_run_target', 'verification_recovery_context_read', 'patch_apply_recovery_source', 'patch_apply_recovery_goal', 'patch_apply_recovery_mode_id', 'patch_apply_recovery_run_target', 'patch_apply_recovery_apply_target', 'verification_recovery_apply_target', 'verification_recovery_retry_run_target', 'llm_provider_failure_retry_run_target', 'parent_join_run_target', 'modepack_registry_update_selection_target', 'modepack_selected_candidate_fetch_target', 'modepack_selected_candidate_provenance_verification_target', 'modepack_selected_candidate_approval_target', 'modepack_selected_approved_candidate_replacement_target', 'modepack_selected_active_rollback_target']) &&
    value.authorize === true &&
    typeof value.expected_progress_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_progress_fingerprint) &&
    isNonNegativeInteger(value.expected_aggregate_sequence) &&
    (value.continuation_id === undefined || value.continuation_id === null || isHeadlessContinuationId(value.continuation_id)) &&
    (value.max_steps === undefined || value.max_steps === null || (isNonNegativeInteger(value.max_steps) && value.max_steps >= 1 && value.max_steps <= 3)) &&
    (value.context_budget === undefined || value.context_budget === null || isTaskRunContextBudget(value.context_budget)) &&
    (value.verification_recovery_source === undefined || value.verification_recovery_source === null || isVerificationRecoverySource(value.verification_recovery_source)) &&
    (value.verification_recovery_goal === undefined || value.verification_recovery_goal === null || typeof value.verification_recovery_goal === 'string') &&
    (value.verification_recovery_mode_id === undefined || value.verification_recovery_mode_id === null || typeof value.verification_recovery_mode_id === 'string') &&
    (value.verification_recovery_retry_source === undefined || value.verification_recovery_retry_source === null || isVerificationRecoveryRetrySource(value.verification_recovery_retry_source)) &&
    (value.verification_recovery_retry_goal === undefined || value.verification_recovery_retry_goal === null || typeof value.verification_recovery_retry_goal === 'string') &&
    (value.verification_recovery_retry_mode_id === undefined || value.verification_recovery_retry_mode_id === null || typeof value.verification_recovery_retry_mode_id === 'string') &&
    (value.llm_provider_failure_retry_source === undefined || value.llm_provider_failure_retry_source === null || isLlmProviderFailureRetrySource(value.llm_provider_failure_retry_source)) &&
    (value.llm_provider_failure_retry_goal === undefined || value.llm_provider_failure_retry_goal === null || typeof value.llm_provider_failure_retry_goal === 'string') &&
    (value.llm_provider_failure_retry_mode_id === undefined || value.llm_provider_failure_retry_mode_id === null || typeof value.llm_provider_failure_retry_mode_id === 'string') &&
    (value.verification_recovery_run_target === undefined || value.verification_recovery_run_target === null || isVerificationRecoveryRunTarget(value.verification_recovery_run_target)) &&
    (value.verification_recovery_context_read === undefined || value.verification_recovery_context_read === null || isTaskRunVerificationRecoveryContextRead(value.verification_recovery_context_read)) &&
    (value.patch_apply_recovery_source === undefined || value.patch_apply_recovery_source === null || isPatchApplyRecoverySource(value.patch_apply_recovery_source)) &&
    (value.patch_apply_recovery_goal === undefined || value.patch_apply_recovery_goal === null || typeof value.patch_apply_recovery_goal === 'string') &&
    (value.patch_apply_recovery_mode_id === undefined || value.patch_apply_recovery_mode_id === null || typeof value.patch_apply_recovery_mode_id === 'string') &&
    (value.patch_apply_recovery_run_target === undefined || value.patch_apply_recovery_run_target === null || isPatchApplyRecoveryRunTarget(value.patch_apply_recovery_run_target)) &&
    (value.patch_apply_recovery_apply_target === undefined || value.patch_apply_recovery_apply_target === null || isPatchApplyRecoveryApplyTarget(value.patch_apply_recovery_apply_target)) &&
    (value.verification_recovery_apply_target === undefined || value.verification_recovery_apply_target === null || isVerificationRecoveryApplyTarget(value.verification_recovery_apply_target)) &&
    (value.verification_recovery_retry_run_target === undefined || value.verification_recovery_retry_run_target === null || isVerificationRecoveryRetryRunTarget(value.verification_recovery_retry_run_target)) &&
    (value.llm_provider_failure_retry_run_target === undefined || value.llm_provider_failure_retry_run_target === null || isLlmProviderFailureRetryRunTarget(value.llm_provider_failure_retry_run_target)) &&
    (value.parent_join_run_target === undefined || value.parent_join_run_target === null || isParentJoinRunTarget(value.parent_join_run_target)) &&
    (value.modepack_registry_update_selection_target === undefined || value.modepack_registry_update_selection_target === null || isModePackRegistryUpdateSelectionTarget(value.modepack_registry_update_selection_target)) &&
    (value.modepack_selected_candidate_fetch_target === undefined || value.modepack_selected_candidate_fetch_target === null || isModePackSelectedCandidateFetchTarget(value.modepack_selected_candidate_fetch_target)) &&
    (value.modepack_selected_candidate_provenance_verification_target === undefined || value.modepack_selected_candidate_provenance_verification_target === null || isModePackSelectedCandidateProvenanceVerificationTarget(value.modepack_selected_candidate_provenance_verification_target)) &&
    (value.modepack_selected_candidate_approval_target === undefined || value.modepack_selected_candidate_approval_target === null || isModePackSelectedCandidateApprovalTarget(value.modepack_selected_candidate_approval_target)) &&
    (value.modepack_selected_approved_candidate_replacement_target === undefined || value.modepack_selected_approved_candidate_replacement_target === null || isModePackSelectedApprovedCandidateReplacementTarget(value.modepack_selected_approved_candidate_replacement_target)) &&
    (value.modepack_selected_active_rollback_target === undefined || value.modepack_selected_active_rollback_target === null || isModePackSelectedActiveRollbackTarget(value.modepack_selected_active_rollback_target))
  );
}

function isModePackRegistryUpdateSelectionTarget(value: unknown): value is ModePackRegistryUpdateSelectionTarget {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'authorize_modepack_registry_update_selection',
      'authorize_registry_trust',
      'registry_url',
      'expected_registry_manifest_sha256',
      'expected_current_activation_fingerprint',
      'expected_registry_provenance_statement_sha256',
      'expected_registry_signer_fingerprint',
      'expected_registry_trusted_signer_trust_id',
      'expected_registry_trusted_signer_event_id',
      'registry_provenance_statement_json',
      'registry_provenance_signature_base64',
      'registry_provenance_public_key_base64',
    ]) &&
    value.authorize_modepack_registry_update_selection === true &&
    value.authorize_registry_trust === true &&
    typeof value.registry_url === 'string' &&
    value.registry_url.startsWith('https://') &&
    typeof value.expected_registry_manifest_sha256 === 'string' &&
    isSha256Fingerprint(value.expected_registry_manifest_sha256) &&
    typeof value.expected_current_activation_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_current_activation_fingerprint) &&
    typeof value.expected_registry_provenance_statement_sha256 === 'string' &&
    isSha256Fingerprint(value.expected_registry_provenance_statement_sha256) &&
    typeof value.expected_registry_signer_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_registry_signer_fingerprint) &&
    typeof value.expected_registry_trusted_signer_trust_id === 'string' &&
    value.expected_registry_trusted_signer_trust_id.length > 0 &&
    typeof value.expected_registry_trusted_signer_event_id === 'string' &&
    value.expected_registry_trusted_signer_event_id.length > 0 &&
    typeof value.registry_provenance_statement_json === 'string' &&
    value.registry_provenance_statement_json.length > 0 &&
    typeof value.registry_provenance_signature_base64 === 'string' &&
    value.registry_provenance_signature_base64.length > 0 &&
    typeof value.registry_provenance_public_key_base64 === 'string' &&
    value.registry_provenance_public_key_base64.length > 0
  );
}

function isModePackSelectedCandidateFetchTarget(value: unknown): value is ModePackSelectedCandidateFetchTarget {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'authorize_selected_candidate_fetch',
      'selection_id',
      'selection_event_id',
      'expected_registry_manifest_sha256',
      'expected_candidate_url_fingerprint',
      'expected_candidate_content_sha256',
      'expected_candidate_compiled_policy_fingerprint',
      'expected_provenance_statement_url_fingerprint',
      'expected_provenance_statement_sha256',
      'expected_signer_fingerprint',
      'expected_current_activation_fingerprint',
    ]) &&
    value.authorize_selected_candidate_fetch === true &&
    typeof value.selection_id === 'string' &&
    value.selection_id.length > 0 &&
    typeof value.selection_event_id === 'string' &&
    value.selection_event_id.length > 0 &&
    typeof value.expected_registry_manifest_sha256 === 'string' &&
    isSha256Fingerprint(value.expected_registry_manifest_sha256) &&
    typeof value.expected_candidate_url_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_candidate_url_fingerprint) &&
    typeof value.expected_candidate_content_sha256 === 'string' &&
    isSha256Fingerprint(value.expected_candidate_content_sha256) &&
    typeof value.expected_candidate_compiled_policy_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_candidate_compiled_policy_fingerprint) &&
    typeof value.expected_provenance_statement_url_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_provenance_statement_url_fingerprint) &&
    typeof value.expected_provenance_statement_sha256 === 'string' &&
    isSha256Fingerprint(value.expected_provenance_statement_sha256) &&
    typeof value.expected_signer_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_signer_fingerprint) &&
    typeof value.expected_current_activation_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_current_activation_fingerprint) &&
    !Object.prototype.hasOwnProperty.call(value, 'candidate_url') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_registry_manifest_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_modepack_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_provenance_statement_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_signature') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_public_key') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ledger_payload')
  );
}

function isModePackSelectedCandidateProvenanceVerificationTarget(value: unknown): value is ModePackSelectedCandidateProvenanceVerificationTarget {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'authorize_selected_candidate_provenance_verification',
      'fetch_continuation_id',
      'expected_fetch_decision_id',
      'selection_id',
      'selection_event_id',
      'expected_candidate_url_fingerprint',
      'expected_candidate_content_sha256',
      'expected_candidate_compiled_policy_fingerprint',
      'expected_provenance_statement_url_fingerprint',
      'expected_provenance_statement_sha256',
      'expected_signer_fingerprint',
      'expected_current_activation_fingerprint',
      'provenance_statement_json',
      'provenance_signature_base64',
      'provenance_public_key_base64',
    ]) &&
    value.authorize_selected_candidate_provenance_verification === true &&
    typeof value.fetch_continuation_id === 'string' &&
    isHeadlessContinuationId(value.fetch_continuation_id) &&
    typeof value.expected_fetch_decision_id === 'string' &&
    /^headless_decision_[a-f0-9]{32}$/.test(value.expected_fetch_decision_id) &&
    typeof value.selection_id === 'string' &&
    value.selection_id.length > 0 &&
    typeof value.selection_event_id === 'string' &&
    value.selection_event_id.length > 0 &&
    typeof value.expected_candidate_url_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_candidate_url_fingerprint) &&
    typeof value.expected_candidate_content_sha256 === 'string' &&
    isSha256Fingerprint(value.expected_candidate_content_sha256) &&
    typeof value.expected_candidate_compiled_policy_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_candidate_compiled_policy_fingerprint) &&
    typeof value.expected_provenance_statement_url_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_provenance_statement_url_fingerprint) &&
    typeof value.expected_provenance_statement_sha256 === 'string' &&
    isSha256Fingerprint(value.expected_provenance_statement_sha256) &&
    typeof value.expected_signer_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_signer_fingerprint) &&
    typeof value.expected_current_activation_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_current_activation_fingerprint) &&
    typeof value.provenance_statement_json === 'string' &&
    value.provenance_statement_json.length > 0 &&
    value.provenance_statement_json.length <= 65536 &&
    typeof value.provenance_signature_base64 === 'string' &&
    value.provenance_signature_base64.length > 0 &&
    value.provenance_signature_base64.length <= 512 &&
    typeof value.provenance_public_key_base64 === 'string' &&
    value.provenance_public_key_base64.length > 0 &&
    value.provenance_public_key_base64.length <= 512 &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_provenance_statement_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_signature') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_public_key') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ledger_payload') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_modepack_json')
  );
}

function isModePackSelectedCandidateApprovalTarget(value: unknown): value is ModePackSelectedCandidateApprovalTarget {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'authorize_selected_candidate_approval',
      'fetch_continuation_id',
      'expected_fetch_decision_id',
      'provenance_verification_continuation_id',
      'expected_provenance_verification_decision_id',
      'selection_id',
      'selection_event_id',
      'expected_candidate_url_fingerprint',
      'expected_candidate_content_sha256',
      'expected_candidate_compiled_policy_fingerprint',
      'expected_provenance_id',
      'expected_provenance_event_id',
      'expected_provenance_statement_url_fingerprint',
      'expected_provenance_statement_sha256',
      'expected_signer_fingerprint',
      'expected_current_activation_fingerprint',
    ]) &&
    value.authorize_selected_candidate_approval === true &&
    typeof value.fetch_continuation_id === 'string' &&
    isHeadlessContinuationId(value.fetch_continuation_id) &&
    typeof value.expected_fetch_decision_id === 'string' &&
    /^headless_decision_[a-f0-9]{32}$/.test(value.expected_fetch_decision_id) &&
    typeof value.provenance_verification_continuation_id === 'string' &&
    isHeadlessContinuationId(value.provenance_verification_continuation_id) &&
    typeof value.expected_provenance_verification_decision_id === 'string' &&
    /^headless_decision_[a-f0-9]{32}$/.test(value.expected_provenance_verification_decision_id) &&
    typeof value.selection_id === 'string' &&
    value.selection_id.length > 0 &&
    typeof value.selection_event_id === 'string' &&
    value.selection_event_id.length > 0 &&
    typeof value.expected_candidate_url_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_candidate_url_fingerprint) &&
    typeof value.expected_candidate_content_sha256 === 'string' &&
    isSha256Fingerprint(value.expected_candidate_content_sha256) &&
    typeof value.expected_candidate_compiled_policy_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_candidate_compiled_policy_fingerprint) &&
    typeof value.expected_provenance_id === 'string' &&
    value.expected_provenance_id.length > 0 &&
    typeof value.expected_provenance_event_id === 'string' &&
    value.expected_provenance_event_id.length > 0 &&
    typeof value.expected_provenance_statement_url_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_provenance_statement_url_fingerprint) &&
    typeof value.expected_provenance_statement_sha256 === 'string' &&
    isSha256Fingerprint(value.expected_provenance_statement_sha256) &&
    typeof value.expected_signer_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_signer_fingerprint) &&
    typeof value.expected_current_activation_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_current_activation_fingerprint) &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_provenance_statement_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_signature') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_public_key') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ledger_payload')
  );
}

function isModePackSelectedApprovedCandidateReplacementTarget(value: unknown): value is ModePackSelectedApprovedCandidateReplacementTarget {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'authorize_selected_candidate_replacement',
      'fetch_continuation_id',
      'expected_fetch_decision_id',
      'provenance_verification_continuation_id',
      'expected_provenance_verification_decision_id',
      'approval_continuation_id',
      'expected_approval_decision_id',
      'selection_id',
      'selection_event_id',
      'expected_candidate_url_fingerprint',
      'expected_candidate_content_sha256',
      'expected_candidate_compiled_policy_fingerprint',
      'expected_candidate_activation_fingerprint',
      'expected_provenance_id',
      'expected_provenance_event_id',
      'expected_provenance_statement_url_fingerprint',
      'expected_provenance_statement_sha256',
      'expected_signer_fingerprint',
      'expected_current_activation_fingerprint',
      'expected_approved_candidate_id',
      'expected_approved_candidate_approval_id',
      'expected_approved_candidate_approval_event_id',
    ]) &&
    value.authorize_selected_candidate_replacement === true &&
    isHeadlessContinuationId(value.fetch_continuation_id) &&
    isHeadlessContinuationId(value.provenance_verification_continuation_id) &&
    isHeadlessContinuationId(value.approval_continuation_id) &&
    typeof value.expected_fetch_decision_id === 'string' &&
    /^headless_decision_[a-f0-9]{32}$/.test(value.expected_fetch_decision_id) &&
    typeof value.expected_provenance_verification_decision_id === 'string' &&
    /^headless_decision_[a-f0-9]{32}$/.test(value.expected_provenance_verification_decision_id) &&
    typeof value.expected_approval_decision_id === 'string' &&
    /^headless_decision_[a-f0-9]{32}$/.test(value.expected_approval_decision_id) &&
    typeof value.selection_id === 'string' &&
    value.selection_id.trim().length > 0 &&
    typeof value.selection_event_id === 'string' &&
    value.selection_event_id.trim().length > 0 &&
    typeof value.expected_candidate_url_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_candidate_url_fingerprint) &&
    typeof value.expected_candidate_content_sha256 === 'string' &&
    isSha256Fingerprint(value.expected_candidate_content_sha256) &&
    typeof value.expected_candidate_compiled_policy_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_candidate_compiled_policy_fingerprint) &&
    typeof value.expected_candidate_activation_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_candidate_activation_fingerprint) &&
    typeof value.expected_provenance_id === 'string' &&
    value.expected_provenance_id.trim().length > 0 &&
    typeof value.expected_provenance_event_id === 'string' &&
    value.expected_provenance_event_id.trim().length > 0 &&
    typeof value.expected_provenance_statement_url_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_provenance_statement_url_fingerprint) &&
    typeof value.expected_provenance_statement_sha256 === 'string' &&
    isSha256Fingerprint(value.expected_provenance_statement_sha256) &&
    typeof value.expected_signer_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_signer_fingerprint) &&
    typeof value.expected_current_activation_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_current_activation_fingerprint) &&
    typeof value.expected_approved_candidate_id === 'string' &&
    value.expected_approved_candidate_id.trim().length > 0 &&
    typeof value.expected_approved_candidate_approval_id === 'string' &&
    value.expected_approved_candidate_approval_id.trim().length > 0 &&
    typeof value.expected_approved_candidate_approval_event_id === 'string' &&
    value.expected_approved_candidate_approval_event_id.trim().length > 0 &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_modepack_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ledger_payload')
  );
}

function isModePackSelectedActiveRollbackTarget(value: unknown): value is ModePackSelectedActiveRollbackTarget {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'authorize_selected_active_modepack_rollback',
      'replacement_event_id',
      'expected_current_activation_fingerprint',
      'expected_rollback_activation_fingerprint',
    ]) &&
    value.authorize_selected_active_modepack_rollback === true &&
    typeof value.replacement_event_id === 'string' &&
    value.replacement_event_id.trim().length > 0 &&
    typeof value.expected_current_activation_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_current_activation_fingerprint) &&
    typeof value.expected_rollback_activation_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_rollback_activation_fingerprint) &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_modepack_json') &&
    !Object.prototype.hasOwnProperty.call(value, 'raw_ledger_payload')
  );
}

export function isHeadlessRunAdvanceParams(value: unknown): value is HeadlessRunAdvanceParams {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['authorize', 'session_id', 'advance_id', 'expected_session_sequence', 'max_steps', 'context_budget', 'expected_progress_fingerprint', 'expected_aggregate_sequence', 'modepack_registry_update_selection_target', 'modepack_selected_candidate_fetch_target', 'modepack_selected_candidate_provenance_verification_target', 'modepack_selected_candidate_approval_target', 'modepack_selected_approved_candidate_replacement_target']) &&
    value.authorize === true &&
    isHeadlessRunId(value.session_id) &&
    (value.advance_id === undefined || value.advance_id === null || isHeadlessRunId(value.advance_id)) &&
    isNonNegativeInteger(value.expected_session_sequence) &&
    value.expected_session_sequence >= 1 &&
    (value.max_steps === undefined || value.max_steps === null || (isNonNegativeInteger(value.max_steps) && value.max_steps >= 1 && value.max_steps <= 3)) &&
    (value.context_budget === undefined || value.context_budget === null || isTaskRunContextBudget(value.context_budget)) &&
    (value.expected_progress_fingerprint === undefined || value.expected_progress_fingerprint === null || (typeof value.expected_progress_fingerprint === 'string' && isSha256Fingerprint(value.expected_progress_fingerprint))) &&
    (value.expected_aggregate_sequence === undefined || value.expected_aggregate_sequence === null || isNonNegativeInteger(value.expected_aggregate_sequence)) &&
    (value.modepack_registry_update_selection_target === undefined || value.modepack_registry_update_selection_target === null || isModePackRegistryUpdateSelectionTarget(value.modepack_registry_update_selection_target)) &&
    (value.modepack_selected_candidate_fetch_target === undefined || value.modepack_selected_candidate_fetch_target === null || isModePackSelectedCandidateFetchTarget(value.modepack_selected_candidate_fetch_target)) &&
    (value.modepack_selected_candidate_provenance_verification_target === undefined || value.modepack_selected_candidate_provenance_verification_target === null || isModePackSelectedCandidateProvenanceVerificationTarget(value.modepack_selected_candidate_provenance_verification_target)) &&
    (value.modepack_selected_candidate_approval_target === undefined || value.modepack_selected_candidate_approval_target === null || isModePackSelectedCandidateApprovalTarget(value.modepack_selected_candidate_approval_target)) &&
    (value.modepack_selected_approved_candidate_replacement_target === undefined || value.modepack_selected_approved_candidate_replacement_target === null || isModePackSelectedApprovedCandidateReplacementTarget(value.modepack_selected_approved_candidate_replacement_target))
  );
}

export function isHeadlessRunDriveParams(value: unknown): value is HeadlessRunDriveParams {
  const hasJourneyRouteResume = isRecord(value) && value.journey_route_resume !== undefined && value.journey_route_resume !== null;
  const hasJourneyClosure = isRecord(value) && value.journey_closure !== undefined && value.journey_closure !== null;
  const hasJourneyExecution = isRecord(value) && value.journey_execution !== undefined && value.journey_execution !== null;
  const hasJourneyExecutionTaskStart = hasJourneyExecution && isRecord(value.journey_execution) && value.journey_execution.task_start !== undefined && value.journey_execution.task_start !== null;
  const explicitModePackTargetCount = isRecord(value)
    ? [
        value.modepack_registry_update_selection_target,
        value.modepack_selected_candidate_fetch_target,
        value.modepack_selected_candidate_provenance_verification_target,
        value.modepack_selected_candidate_approval_target,
        value.modepack_selected_approved_candidate_replacement_target,
      ].filter((target) => target !== undefined && target !== null).length
    : 0;
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['authorize', 'session_id', 'drive_id', 'expected_start_session_sequence', 'max_advances', 'max_steps_per_advance', 'context_budget', 'authorize_completion_finalization', 'expected_completion_closure_fingerprint', 'product_evidence_derivation', 'product_completion_decision', 'modepack_registry_update_selection_target', 'modepack_selected_candidate_fetch_target', 'modepack_selected_candidate_provenance_verification_target', 'modepack_selected_candidate_approval_target', 'modepack_selected_approved_candidate_replacement_target', 'journey_admission', 'journey_route_resume', 'journey_closure', 'journey_execution']) &&
    value.authorize === true &&
    isHeadlessRunId(value.session_id) &&
    (value.drive_id === undefined || value.drive_id === null || isHeadlessRunId(value.drive_id)) &&
    isNonNegativeInteger(value.expected_start_session_sequence) &&
    value.expected_start_session_sequence >= 0 &&
    (value.max_advances === undefined || value.max_advances === null || (isNonNegativeInteger(value.max_advances) && value.max_advances >= 1 && value.max_advances <= 3)) &&
    (value.max_steps_per_advance === undefined || value.max_steps_per_advance === null || (isNonNegativeInteger(value.max_steps_per_advance) && value.max_steps_per_advance >= 1 && value.max_steps_per_advance <= 3)) &&
    (value.authorize_completion_finalization === undefined || value.authorize_completion_finalization === null || typeof value.authorize_completion_finalization === 'boolean') &&
    (value.expected_completion_closure_fingerprint === undefined || value.expected_completion_closure_fingerprint === null || (typeof value.expected_completion_closure_fingerprint === 'string' && isSha256Fingerprint(value.expected_completion_closure_fingerprint))) &&
    (value.product_evidence_derivation === undefined || value.product_evidence_derivation === null || isHeadlessRunProductEvidenceDerivationRequest(value.product_evidence_derivation)) &&
    (value.product_completion_decision === undefined || value.product_completion_decision === null || isHeadlessRunProductCompletionDecisionRequest(value.product_completion_decision)) &&
    (value.context_budget === undefined || value.context_budget === null || isTaskRunContextBudget(value.context_budget)) &&
    (value.modepack_registry_update_selection_target === undefined || value.modepack_registry_update_selection_target === null || isModePackRegistryUpdateSelectionTarget(value.modepack_registry_update_selection_target)) &&
    (value.modepack_selected_candidate_fetch_target === undefined || value.modepack_selected_candidate_fetch_target === null || isModePackSelectedCandidateFetchTarget(value.modepack_selected_candidate_fetch_target)) &&
    (value.modepack_selected_candidate_provenance_verification_target === undefined || value.modepack_selected_candidate_provenance_verification_target === null || isModePackSelectedCandidateProvenanceVerificationTarget(value.modepack_selected_candidate_provenance_verification_target)) &&
    (value.modepack_selected_candidate_approval_target === undefined || value.modepack_selected_candidate_approval_target === null || isModePackSelectedCandidateApprovalTarget(value.modepack_selected_candidate_approval_target)) &&
    (value.modepack_selected_approved_candidate_replacement_target === undefined || value.modepack_selected_approved_candidate_replacement_target === null || isModePackSelectedApprovedCandidateReplacementTarget(value.modepack_selected_approved_candidate_replacement_target)) &&
    (value.journey_admission === undefined || value.journey_admission === null || isHeadlessRunJourneyAdmission(value.journey_admission)) &&
    (value.journey_route_resume === undefined || value.journey_route_resume === null || isHeadlessRunJourneyRouteResume(value.journey_route_resume)) &&
    (value.journey_closure === undefined || value.journey_closure === null || isHeadlessRunJourneyClosure(value.journey_closure)) &&
    (value.journey_execution === undefined || value.journey_execution === null || isHeadlessRunJourneyExecution(value.journey_execution)) &&
    (value.expected_start_session_sequence >= 1 || value.journey_admission !== undefined && value.journey_admission !== null || hasJourneyExecution) &&
    (value.journey_admission === undefined || value.journey_admission === null || value.expected_start_session_sequence === 0) &&
    (!(hasJourneyRouteResume && hasJourneyClosure)) &&
    (!hasJourneyExecution || (
      (value.expected_start_session_sequence >= 1 || hasJourneyExecutionTaskStart) &&
      typeof value.drive_id === 'string' &&
      isHeadlessRunId(value.drive_id) &&
      (value.journey_admission === undefined || value.journey_admission === null) &&
      (value.journey_route_resume === undefined || value.journey_route_resume === null) &&
      (value.journey_closure === undefined || value.journey_closure === null) &&
      explicitModePackTargetCount === 0 &&
      (value.context_budget === undefined || value.context_budget === null) &&
      (value.authorize_completion_finalization === undefined || value.authorize_completion_finalization === null) &&
      (value.expected_completion_closure_fingerprint === undefined || value.expected_completion_closure_fingerprint === null) &&
      (
        value.expected_start_session_sequence >= 1 ||
        (
          isRecord(value.journey_execution) &&
          (value.journey_execution.expected_journey_fingerprint === undefined || value.journey_execution.expected_journey_fingerprint === null)
        )
      ) &&
      (
        value.expected_start_session_sequence === 0 ||
        (
          isRecord(value.journey_execution) &&
          typeof value.journey_execution.expected_journey_fingerprint === 'string' &&
          isSha256Fingerprint(value.journey_execution.expected_journey_fingerprint)
        )
      ) &&
      value.max_advances === 1 &&
      value.max_steps_per_advance === 1
    )) &&
    (!hasJourneyRouteResume || (
      value.expected_start_session_sequence >= 1 &&
      typeof value.drive_id === 'string' &&
      isHeadlessRunId(value.drive_id) &&
      (value.journey_admission === undefined || value.journey_admission === null) &&
      explicitModePackTargetCount === 0 &&
      (value.context_budget === undefined || value.context_budget === null) &&
      value.authorize_completion_finalization !== true &&
      value.max_advances === 1 &&
      value.max_steps_per_advance === 1
    )) &&
    (!hasJourneyClosure || (
      value.expected_start_session_sequence >= 1 &&
      typeof value.drive_id === 'string' &&
      isHeadlessRunId(value.drive_id) &&
      (value.journey_admission === undefined || value.journey_admission === null) &&
      (value.journey_route_resume === undefined || value.journey_route_resume === null) &&
      explicitModePackTargetCount === 0 &&
      (value.context_budget === undefined || value.context_budget === null) &&
      (value.authorize_completion_finalization === undefined || value.authorize_completion_finalization === null) &&
      (value.expected_completion_closure_fingerprint === undefined || value.expected_completion_closure_fingerprint === null) &&
      value.max_advances === 1 &&
      value.max_steps_per_advance === 1
    ))
  );
}

export function isHeadlessRunJourneyAdmission(value: unknown): value is HeadlessRunJourneyAdmission {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['journey_id', 'authorize_journey_start', 'task_start']) &&
    isHeadlessRunId(value.journey_id) &&
    value.authorize_journey_start === true &&
    isHeadlessRunJourneyTaskStartEnvelope(value.task_start)
  );
}

export function isHeadlessRunJourneyRouteResume(value: unknown): value is HeadlessRunJourneyRouteResume {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['journey_id', 'authorize_journey_route_resume', 'expected_journey_fingerprint', 'expected_route_kind', 'expected_source_checkpoint_fingerprint']) &&
    hasNoForbiddenRawFields(value) &&
    isHeadlessRunId(value.journey_id) &&
    value.authorize_journey_route_resume === true &&
    typeof value.expected_journey_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_journey_fingerprint) &&
    (
      value.expected_route_kind === 'fetch_selected_mode_pack_candidate_explicitly' ||
      value.expected_route_kind === 'verify_selected_mode_pack_candidate_provenance_explicitly' ||
      value.expected_route_kind === 'approve_verified_mode_pack_candidate_explicitly' ||
      value.expected_route_kind === 'replace_active_with_approved_mode_pack_candidate_explicitly'
    ) &&
    typeof value.expected_source_checkpoint_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_source_checkpoint_fingerprint)
  );
}

export function isHeadlessRunJourneyClosure(value: unknown): value is HeadlessRunJourneyClosure {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['journey_id', 'authorize_journey_closure', 'expected_journey_fingerprint', 'source_replacement_drive_id', 'expected_replacement_resume_fingerprint']) &&
    hasNoForbiddenRawFields(value) &&
    isHeadlessRunId(value.journey_id) &&
    value.authorize_journey_closure === true &&
    typeof value.expected_journey_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_journey_fingerprint) &&
    isHeadlessRunId(value.source_replacement_drive_id) &&
    typeof value.expected_replacement_resume_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_replacement_resume_fingerprint)
  );
}

export function isHeadlessRunJourneyTaskStartEnvelope(value: unknown): value is HeadlessRunJourneyTaskStartEnvelope {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['goal', 'mode_id']) &&
    typeof value.goal === 'string' &&
    value.goal.trim().length > 0 &&
    value.goal.length <= 2000 &&
    (value.mode_id === undefined || value.mode_id === null || isBoundedHandle(value.mode_id))
  );
}

function isParentJoinRunTarget(value: unknown): value is ParentJoinRunTarget {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['authorize_parent_join_run', 'parent_task_id', 'parent_run_id', 'expected_child_completion_fingerprint', 'expected_child_completion_child_count', 'expected_terminal_completed_child_count', 'expected_terminal_failed_child_count']) &&
    value.authorize_parent_join_run === true &&
    typeof value.parent_task_id === 'string' &&
    value.parent_task_id.length > 0 &&
    typeof value.parent_run_id === 'string' &&
    value.parent_run_id.length > 0 &&
    typeof value.expected_child_completion_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_child_completion_fingerprint) &&
    isNonNegativeInteger(value.expected_child_completion_child_count) &&
    value.expected_child_completion_child_count > 0 &&
    isNonNegativeInteger(value.expected_terminal_completed_child_count) &&
    isNonNegativeInteger(value.expected_terminal_failed_child_count) &&
    value.expected_terminal_completed_child_count + value.expected_terminal_failed_child_count === value.expected_child_completion_child_count
  );
}

function isVerificationRecoveryRetrySource(value: unknown): value is VerificationRecoveryRetrySource {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['source_task_id', 'source_run_id', 'recovery_task_id', 'recovery_run_id', 'proposal_id', 'apply_id', 'expected_failure_fingerprint', 'expected_apply_fingerprint', 'authorize_verification_retry']) &&
    typeof value.source_task_id === 'string' &&
    typeof value.source_run_id === 'string' &&
    typeof value.recovery_task_id === 'string' &&
    typeof value.recovery_run_id === 'string' &&
    typeof value.proposal_id === 'string' &&
    typeof value.apply_id === 'string' &&
    typeof value.expected_failure_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_failure_fingerprint) &&
    typeof value.expected_apply_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_apply_fingerprint) &&
    value.authorize_verification_retry === true
  );
}

function isVerificationRecoverySource(value: unknown): value is VerificationRecoverySource {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['source_task_id', 'source_run_id', 'expected_failure_fingerprint', 'authorize_recovery']) &&
    typeof value.source_task_id === 'string' &&
    typeof value.source_run_id === 'string' &&
    typeof value.expected_failure_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_failure_fingerprint) &&
    value.authorize_recovery === true
  );
}

function isPatchApplyRecoverySource(value: unknown): value is PatchApplyRecoverySource {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['source_run_id', 'source_proposal_id', 'source_apply_id', 'expected_source_apply_fingerprint', 'expected_failure_fingerprint', 'authorize_patch_apply_recovery']) &&
    typeof value.source_run_id === 'string' &&
    typeof value.source_proposal_id === 'string' &&
    typeof value.source_apply_id === 'string' &&
    typeof value.expected_source_apply_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_source_apply_fingerprint) &&
    typeof value.expected_failure_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_failure_fingerprint) &&
    value.authorize_patch_apply_recovery === true
  );
}

function isPatchApplyRecoveryRunTarget(value: unknown): value is PatchApplyRecoveryRunTarget {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['recovery_task_id', 'recovery_run_id', 'source_run_id', 'source_proposal_id', 'source_apply_id', 'expected_source_apply_fingerprint', 'expected_failure_fingerprint', 'authorize_patch_apply_recovery_run']) &&
    typeof value.recovery_task_id === 'string' &&
    typeof value.recovery_run_id === 'string' &&
    typeof value.source_run_id === 'string' &&
    typeof value.source_proposal_id === 'string' &&
    typeof value.source_apply_id === 'string' &&
    typeof value.expected_source_apply_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_source_apply_fingerprint) &&
    typeof value.expected_failure_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_failure_fingerprint) &&
    value.authorize_patch_apply_recovery_run === true
  );
}

function isPatchApplyRecoveryApplyTarget(value: unknown): value is PatchApplyRecoveryApplyTarget {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['recovery_task_id', 'recovery_run_id', 'source_run_id', 'source_proposal_id', 'source_apply_id', 'recovery_proposal_id', 'expected_source_apply_fingerprint', 'expected_failure_fingerprint', 'expected_target_sha256', 'patch_old_text', 'patch_new_text', 'patch_hunks', 'authorize_patch_apply_recovery_apply']) &&
    typeof value.recovery_task_id === 'string' &&
    typeof value.recovery_run_id === 'string' &&
    typeof value.source_run_id === 'string' &&
    typeof value.source_proposal_id === 'string' &&
    typeof value.source_apply_id === 'string' &&
    typeof value.recovery_proposal_id === 'string' &&
    typeof value.expected_source_apply_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_source_apply_fingerprint) &&
    typeof value.expected_failure_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_failure_fingerprint) &&
    typeof value.expected_target_sha256 === 'string' &&
    isSha256Fingerprint(value.expected_target_sha256) &&
    (value.patch_old_text === undefined || value.patch_old_text === null || typeof value.patch_old_text === 'string') &&
    (value.patch_new_text === undefined || value.patch_new_text === null || typeof value.patch_new_text === 'string') &&
    (value.patch_hunks === undefined || value.patch_hunks === null || (Array.isArray(value.patch_hunks) && value.patch_hunks.every(isProposalPatchHunk))) &&
    value.authorize_patch_apply_recovery_apply === true
  );
}

function isProposalPatchHunk(value: unknown): value is ProposalPatchHunk {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['old_text', 'new_text']) &&
    typeof value.old_text === 'string' &&
    typeof value.new_text === 'string'
  );
}

function isLlmProviderFailureRetrySource(value: unknown): value is LlmProviderFailureRetrySource {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['source_task_id', 'source_run_id', 'expected_failure_fingerprint', 'authorize_provider_failure_retry']) &&
    typeof value.source_task_id === 'string' &&
    typeof value.source_run_id === 'string' &&
    typeof value.expected_failure_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_failure_fingerprint) &&
    value.authorize_provider_failure_retry === true
  );
}

function isLlmProviderFailureRetryRunTarget(value: unknown): value is LlmProviderFailureRetryRunTarget {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['retry_task_id', 'retry_run_id', 'source_task_id', 'source_run_id', 'expected_failure_fingerprint', 'authorize_provider_failure_retry_run']) &&
    typeof value.retry_task_id === 'string' &&
    typeof value.retry_run_id === 'string' &&
    typeof value.source_task_id === 'string' &&
    typeof value.source_run_id === 'string' &&
    typeof value.expected_failure_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_failure_fingerprint) &&
    value.authorize_provider_failure_retry_run === true
  );
}

function isVerificationRecoveryRetryRunTarget(value: unknown): value is VerificationRecoveryRetryRunTarget {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['retry_task_id', 'retry_run_id', 'proposal_id', 'apply_id', 'expected_failure_fingerprint', 'expected_apply_fingerprint', 'authorize_verification_retry_run']) &&
    typeof value.retry_task_id === 'string' &&
    typeof value.retry_run_id === 'string' &&
    typeof value.proposal_id === 'string' &&
    typeof value.apply_id === 'string' &&
    typeof value.expected_failure_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_failure_fingerprint) &&
    typeof value.expected_apply_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_apply_fingerprint) &&
    value.authorize_verification_retry_run === true
  );
}

function isVerificationRecoveryRunTarget(value: unknown): value is VerificationRecoveryRunTarget {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['recovery_task_id', 'recovery_run_id', 'source_task_id', 'source_run_id', 'expected_failure_fingerprint', 'authorize_recovery_run']) &&
    typeof value.recovery_task_id === 'string' &&
    typeof value.recovery_run_id === 'string' &&
    typeof value.source_task_id === 'string' &&
    typeof value.source_run_id === 'string' &&
    typeof value.expected_failure_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_failure_fingerprint) &&
    value.authorize_recovery_run === true
  );
}

function isVerificationRecoveryApplyTarget(value: unknown): value is VerificationRecoveryApplyTarget {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['source_task_id', 'source_run_id', 'recovery_task_id', 'recovery_run_id', 'proposal_id', 'expected_failure_fingerprint', 'expected_target_sha256', 'expected_target_absent', 'replacement_content', 'authorize_recovery_apply']) &&
    typeof value.source_task_id === 'string' &&
    typeof value.source_run_id === 'string' &&
    typeof value.recovery_task_id === 'string' &&
    typeof value.recovery_run_id === 'string' &&
    typeof value.proposal_id === 'string' &&
    typeof value.expected_failure_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_failure_fingerprint) &&
    (value.expected_target_sha256 === undefined || value.expected_target_sha256 === null || (typeof value.expected_target_sha256 === 'string' && isSha256Fingerprint(value.expected_target_sha256))) &&
    (value.expected_target_absent === undefined || value.expected_target_absent === null || typeof value.expected_target_absent === 'boolean') &&
    (value.replacement_content === undefined || value.replacement_content === null || typeof value.replacement_content === 'string') &&
    value.authorize_recovery_apply === true
  );
}

export function isTaskRunResult(value: unknown): value is TaskRunResult {
  return (
    isRecord(value) &&
    typeof value.task_id === 'string' &&
    typeof value.run_id === 'string' &&
    isTaskStatus(value.status) &&
    isAgentLoopRunSummary(value.agent_loop) &&
    (value.completion_evidence === undefined || value.completion_evidence === null || isTaskRunCompletionEvidence(value.completion_evidence)) &&
    (value.completion_acceptance === undefined || value.completion_acceptance === null || isTaskRunCompletionAcceptance(value.completion_acceptance)) &&
    (value.selected_index_prompt_context === undefined || value.selected_index_prompt_context === null || isTaskRunSelectedIndexPromptContextSummary(value.selected_index_prompt_context)) &&
    (value.verification_recovery_context_read === undefined || value.verification_recovery_context_read === null || isTaskRunVerificationRecoveryContextReadSummary(value.verification_recovery_context_read)) &&
    (value.context_budget === undefined || value.context_budget === null || isTaskRunContextBudgetSummary(value.context_budget)) &&
    (value.verification_completion_gate === undefined || value.verification_completion_gate === null || isTaskRunVerificationCompletionGate(value.verification_completion_gate)) &&
    (value.verification_recovery_repair === undefined || value.verification_recovery_repair === null || isTaskRunVerificationRecoveryRepairOutcome(value.verification_recovery_repair)) &&
    (value.verification_recovery_retry === undefined || value.verification_recovery_retry === null || isTaskRunVerificationRecoveryRetryOutcome(value.verification_recovery_retry)) &&
    (value.recovery_cycle_budget_outcome === undefined || value.recovery_cycle_budget_outcome === null || isRecoveryCycleBudgetOutcome(value.recovery_cycle_budget_outcome)) &&
    (value.child_orchestration_outcome === undefined || value.child_orchestration_outcome === null || isTaskRunChildOrchestrationOutcome(value.child_orchestration_outcome)) &&
    (value.parent_join_readiness_outcome === undefined || value.parent_join_readiness_outcome === null || isTaskRunParentJoinReadinessOutcome(value.parent_join_readiness_outcome)) &&
    (value.llm_provider_failure === undefined || value.llm_provider_failure === null || isLlmProviderFailureOutcome(value.llm_provider_failure))
  );
}

export function isTaskRunCompletionAcceptance(value: unknown): value is TaskRunCompletionAcceptance {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'acceptance_id',
      'task_id',
      'run_id',
      'status',
      'terminal_completion_fingerprint',
      'acceptance_fingerprint',
      'verifier_gate_status',
      'replayed',
      'next_action',
    ]) &&
    isHeadlessRunId(value.acceptance_id) &&
    typeof value.task_id === 'string' &&
    value.task_id.trim().length > 0 &&
    typeof value.run_id === 'string' &&
    value.run_id.trim().length > 0 &&
    value.status === 'AcceptedComplete' &&
    typeof value.terminal_completion_fingerprint === 'string' &&
    isSha256Fingerprint(value.terminal_completion_fingerprint) &&
    typeof value.acceptance_fingerprint === 'string' &&
    isSha256Fingerprint(value.acceptance_fingerprint) &&
    typeof value.verifier_gate_status === 'string' &&
    value.verifier_gate_status.trim().length > 0 &&
    typeof value.replayed === 'boolean' &&
    typeof value.next_action === 'string' &&
    value.next_action.trim().length > 0
  );
}

export function isTaskRunCompletionEvidence(value: unknown): value is TaskRunCompletionEvidence {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'final_state',
      'task_status',
      'completion_result_fingerprint',
      'completion_summary_preview',
      'completion_summary_chars',
      'completion_summary_truncated',
      'final_response_present',
      'final_response_chars',
      'replayed',
    ]) &&
    typeof value.final_state === 'string' &&
    isTaskStatus(value.task_status) &&
    typeof value.completion_result_fingerprint === 'string' &&
    value.completion_result_fingerprint.startsWith('sha256:') &&
    typeof value.completion_summary_preview === 'string' &&
    typeof value.completion_summary_chars === 'number' &&
    typeof value.completion_summary_truncated === 'boolean' &&
    typeof value.final_response_present === 'boolean' &&
    typeof value.final_response_chars === 'number' &&
    typeof value.replayed === 'boolean'
  );
}

export function isLlmProviderFailureOutcome(value: unknown): value is LlmProviderFailureOutcome {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'provider',
      'model',
      'request_phase',
      'failure_class',
      'retryable',
      'next_action',
      'failure_fingerprint',
      'reason',
      'reason_chars',
      'reason_truncated',
      'http_status',
    ]) &&
    typeof value.provider === 'string' &&
    typeof value.model === 'string' &&
    typeof value.request_phase === 'string' &&
    typeof value.failure_class === 'string' &&
    typeof value.retryable === 'boolean' &&
    typeof value.next_action === 'string' &&
    typeof value.failure_fingerprint === 'string' &&
    isSha256Fingerprint(value.failure_fingerprint) &&
    typeof value.reason === 'string' &&
    isNonNegativeInteger(value.reason_chars) &&
    typeof value.reason_truncated === 'boolean' &&
    (value.http_status === undefined || value.http_status === null || (isNonNegativeInteger(value.http_status) && value.http_status >= 100 && value.http_status <= 599))
  );
}

export function isHeadlessContinueOnceResult(value: unknown): value is HeadlessContinueOnceResult {
  if (
    !isRecord(value) ||
    !hasOnlyFields(value, [
      'status',
      'decision_id',
      'continuation_id',
      'selected_task_id',
      'selected_run_id',
      'candidate_count',
      'expected_progress_fingerprint',
      'expected_aggregate_sequence',
      'current_progress_fingerprint',
      'current_aggregate_sequence',
      'post_progress_fingerprint',
      'post_aggregate_sequence',
      'stale',
      'replayed',
      'task_run_result',
      'proposal_apply_result',
      'modepack_select_registry_update_result',
      'modepack_fetch_candidate_result',
      'modepack_verify_candidate_provenance_result',
      'modepack_approve_candidate_result',
      'modepack_replace_active_result',
      'modepack_rollback_active_result',
      'llm_provider_failure_retry_admission',
      'next_route',
      'max_steps',
      'step_count',
      'executed_count',
      'replayed_count',
      'stop_reason',
      'steps',
      'next_action',
    ]) ||
    !hasNoForbiddenTaskListProgressFields(value) ||
    !isHeadlessContinueOnceStatus(value.status) ||
    (value.decision_id !== undefined && value.decision_id !== null && (typeof value.decision_id !== 'string' || !/^headless_decision_[a-f0-9]{32}$/.test(value.decision_id))) ||
    (value.continuation_id !== undefined && value.continuation_id !== null && !isHeadlessContinuationId(value.continuation_id)) ||
    (value.selected_task_id !== undefined && value.selected_task_id !== null && typeof value.selected_task_id !== 'string') ||
    (value.selected_run_id !== undefined && value.selected_run_id !== null && typeof value.selected_run_id !== 'string') ||
    !isNonNegativeInteger(value.candidate_count) ||
    typeof value.expected_progress_fingerprint !== 'string' ||
    !isSha256Fingerprint(value.expected_progress_fingerprint) ||
    !isNonNegativeInteger(value.expected_aggregate_sequence) ||
    typeof value.current_progress_fingerprint !== 'string' ||
    !isSha256Fingerprint(value.current_progress_fingerprint) ||
    !isNonNegativeInteger(value.current_aggregate_sequence) ||
    (value.post_progress_fingerprint !== undefined && value.post_progress_fingerprint !== null && (typeof value.post_progress_fingerprint !== 'string' || !isSha256Fingerprint(value.post_progress_fingerprint))) ||
    (value.post_aggregate_sequence !== undefined && value.post_aggregate_sequence !== null && !isNonNegativeInteger(value.post_aggregate_sequence)) ||
    typeof value.stale !== 'boolean' ||
    typeof value.replayed !== 'boolean' ||
    (value.task_run_result !== undefined && value.task_run_result !== null && !isTaskRunResult(value.task_run_result)) ||
    (value.proposal_apply_result !== undefined && value.proposal_apply_result !== null && !isProposalApplyResult(value.proposal_apply_result)) ||
    (value.modepack_select_registry_update_result !== undefined && value.modepack_select_registry_update_result !== null && !isModePackSelectRegistryUpdateResult(value.modepack_select_registry_update_result)) ||
    (value.modepack_fetch_candidate_result !== undefined && value.modepack_fetch_candidate_result !== null && !isModePackFetchCandidateResult(value.modepack_fetch_candidate_result)) ||
    (value.modepack_verify_candidate_provenance_result !== undefined && value.modepack_verify_candidate_provenance_result !== null && !isModePackVerifyCandidateProvenanceResult(value.modepack_verify_candidate_provenance_result)) ||
    (value.modepack_approve_candidate_result !== undefined && value.modepack_approve_candidate_result !== null && !isModePackApproveCandidateResult(value.modepack_approve_candidate_result)) ||
    (value.modepack_replace_active_result !== undefined && value.modepack_replace_active_result !== null && !isModePackReplaceActiveResult(value.modepack_replace_active_result)) ||
    (value.modepack_rollback_active_result !== undefined && value.modepack_rollback_active_result !== null && !isModePackRollbackActiveResult(value.modepack_rollback_active_result)) ||
    (value.llm_provider_failure_retry_admission !== undefined && value.llm_provider_failure_retry_admission !== null && !isLlmProviderFailureRetryAdmission(value.llm_provider_failure_retry_admission)) ||
    (value.next_route !== undefined && value.next_route !== null && !isHeadlessContinueRoute(value.next_route)) ||
    (value.max_steps !== undefined && value.max_steps !== null && (!isNonNegativeInteger(value.max_steps) || value.max_steps < 1 || value.max_steps > 3)) ||
    (value.step_count !== undefined && value.step_count !== null && !isNonNegativeInteger(value.step_count)) ||
    (value.executed_count !== undefined && value.executed_count !== null && !isNonNegativeInteger(value.executed_count)) ||
    (value.replayed_count !== undefined && value.replayed_count !== null && !isNonNegativeInteger(value.replayed_count)) ||
    (value.stop_reason !== undefined && value.stop_reason !== null && (typeof value.stop_reason !== 'string' || value.stop_reason.length > 120)) ||
    (value.steps !== undefined && (!Array.isArray(value.steps) || !value.steps.every(isHeadlessContinueStepResult))) ||
    typeof value.next_action !== 'string'
  ) {
    return false;
  }

  if (value.max_steps !== undefined && value.max_steps !== null) {
    if (
      value.step_count === undefined ||
      value.step_count === null ||
      value.executed_count === undefined ||
      value.executed_count === null ||
      value.replayed_count === undefined ||
      value.replayed_count === null ||
      typeof value.stop_reason !== 'string' ||
      !Array.isArray(value.steps) ||
      value.step_count !== value.steps.length ||
      value.executed_count > value.step_count ||
      value.replayed_count > value.step_count
    ) {
      return false;
    }
  }

  if (value.status === 'stale_progress') {
    return value.stale === true && value.task_run_result == null && value.decision_id == null;
  }
  if (value.status === 'no_eligible_task') {
    return value.stale === false && value.task_run_result == null && value.decision_id == null;
  }
  if (value.status === 'task_in_progress') {
    return value.stale === false && value.decision_id !== undefined && value.decision_id !== null && value.selected_task_id !== undefined && value.selected_task_id !== null && value.selected_run_id !== undefined && value.selected_run_id !== null && value.task_run_result == null && value.next_route !== undefined && value.next_route !== null && (value.next_route.kind === 'inspect_progress_overview' || value.next_route.kind === 'run_recovery_task_explicitly' || value.next_route.kind === 'run_llm_provider_retry_task_explicitly');
  }
  if (
    value.status === 'task_executed' &&
    value.stale === false &&
    value.decision_id !== undefined &&
    value.decision_id !== null &&
    value.modepack_select_registry_update_result !== undefined &&
    value.modepack_select_registry_update_result !== null
  ) {
    return value.selected_task_id == null && value.selected_run_id == null && value.task_run_result == null && value.modepack_fetch_candidate_result == null && value.modepack_verify_candidate_provenance_result == null && value.modepack_approve_candidate_result == null && value.modepack_replace_active_result == null && value.modepack_rollback_active_result == null && value.next_route !== undefined && value.next_route !== null && isModePackRouteKind(value.next_route.kind, 'fetch_selected_mode_pack_candidate_explicitly', 'fetch_selected_modepack_candidate_explicitly');
  }
  if (
    value.status === 'task_executed' &&
    value.stale === false &&
    value.decision_id !== undefined &&
    value.decision_id !== null &&
    value.modepack_fetch_candidate_result !== undefined &&
    value.modepack_fetch_candidate_result !== null
  ) {
    return value.selected_task_id == null && value.selected_run_id == null && value.task_run_result == null && value.modepack_select_registry_update_result == null && value.modepack_replace_active_result == null && value.modepack_rollback_active_result == null && value.next_route !== undefined && value.next_route !== null && isModePackRouteKind(value.next_route.kind, 'verify_selected_mode_pack_candidate_provenance_explicitly', 'verify_selected_modepack_candidate_provenance_explicitly');
  }
  if (
    value.status === 'task_executed' &&
    value.stale === false &&
    value.decision_id !== undefined &&
    value.decision_id !== null &&
    value.modepack_verify_candidate_provenance_result !== undefined &&
    value.modepack_verify_candidate_provenance_result !== null
  ) {
    return value.selected_task_id == null && value.selected_run_id == null && value.task_run_result == null && value.modepack_select_registry_update_result == null && value.modepack_fetch_candidate_result == null && value.modepack_approve_candidate_result == null && value.modepack_replace_active_result == null && value.modepack_rollback_active_result == null && value.next_route !== undefined && value.next_route !== null && isModePackRouteKind(value.next_route.kind, 'approve_verified_mode_pack_candidate_explicitly', 'approve_verified_modepack_candidate_explicitly');
  }
  if (
    value.status === 'task_executed' &&
    value.stale === false &&
    value.decision_id !== undefined &&
    value.decision_id !== null &&
    value.modepack_approve_candidate_result !== undefined &&
    value.modepack_approve_candidate_result !== null
  ) {
    return value.selected_task_id == null && value.selected_run_id == null && value.task_run_result == null && value.modepack_select_registry_update_result == null && value.modepack_fetch_candidate_result == null && value.modepack_verify_candidate_provenance_result == null && value.modepack_replace_active_result == null && value.modepack_rollback_active_result == null && value.next_route !== undefined && value.next_route !== null && (isModePackRouteKind(value.next_route.kind, 'replace_active_with_approved_mode_pack_candidate_explicitly', 'replace_active_with_approved_modepack_candidate_explicitly') || (value.next_route.kind === 'refresh_progress_overview' && isModePackRouteKind(value.next_route.next_action, 'replace_active_with_approved_mode_pack_candidate_explicitly', 'replace_active_with_approved_modepack_candidate_explicitly')));
  }
  if (
    value.status === 'task_executed' &&
    value.stale === false &&
    value.decision_id !== undefined &&
    value.decision_id !== null &&
    value.modepack_replace_active_result !== undefined &&
    value.modepack_replace_active_result !== null
  ) {
    return value.selected_task_id == null && value.selected_run_id == null && value.task_run_result == null && value.modepack_select_registry_update_result == null && value.modepack_fetch_candidate_result == null && value.modepack_verify_candidate_provenance_result == null && value.modepack_approve_candidate_result == null && value.modepack_rollback_active_result == null && value.next_route !== undefined && value.next_route !== null && value.next_route.kind === 'refresh_progress_overview';
  }
  if (
    value.status === 'task_executed' &&
    value.stale === false &&
    value.decision_id !== undefined &&
    value.decision_id !== null &&
    value.modepack_rollback_active_result !== undefined &&
    value.modepack_rollback_active_result !== null
  ) {
    return value.selected_task_id == null && value.selected_run_id == null && value.task_run_result == null && value.modepack_select_registry_update_result == null && value.modepack_fetch_candidate_result == null && value.modepack_verify_candidate_provenance_result == null && value.modepack_approve_candidate_result == null && value.modepack_replace_active_result == null && value.next_route !== undefined && value.next_route !== null && value.next_route.kind === 'refresh_progress_overview';
  }
  return (
    value.status === 'task_executed' &&
    value.stale === false &&
    value.decision_id !== undefined &&
    value.decision_id !== null &&
    value.selected_task_id !== undefined &&
    value.selected_task_id !== null &&
    value.selected_run_id !== undefined &&
    value.selected_run_id !== null &&
    value.task_run_result !== undefined &&
    value.task_run_result !== null &&
    value.modepack_fetch_candidate_result == null &&
    value.modepack_verify_candidate_provenance_result == null &&
    value.modepack_approve_candidate_result == null &&
    value.modepack_replace_active_result == null && value.modepack_rollback_active_result == null
  );
}

function isHeadlessContinueStepResult(value: unknown): value is HeadlessContinueStepResult {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'step_index',
      'status',
      'decision_id',
      'continuation_id',
      'selected_task_id',
      'selected_run_id',
      'candidate_count',
      'current_progress_fingerprint',
      'current_aggregate_sequence',
      'post_progress_fingerprint',
      'post_aggregate_sequence',
      'replayed',
      'context_budget',
      'terminal_completion_evidence',
      'next_route',
      'next_action',
    ]) &&
    isNonNegativeInteger(value.step_index) &&
    value.step_index >= 1 &&
    isHeadlessContinueOnceStatus(value.status) &&
    (value.decision_id === undefined || value.decision_id === null || (typeof value.decision_id === 'string' && /^headless_decision_[a-f0-9]{32}$/.test(value.decision_id))) &&
    (value.continuation_id === undefined || value.continuation_id === null || isHeadlessContinuationId(value.continuation_id)) &&
    (value.selected_task_id === undefined || value.selected_task_id === null || typeof value.selected_task_id === 'string') &&
    (value.selected_run_id === undefined || value.selected_run_id === null || typeof value.selected_run_id === 'string') &&
    isNonNegativeInteger(value.candidate_count) &&
    typeof value.current_progress_fingerprint === 'string' &&
    isSha256Fingerprint(value.current_progress_fingerprint) &&
    isNonNegativeInteger(value.current_aggregate_sequence) &&
    (value.post_progress_fingerprint === undefined || value.post_progress_fingerprint === null || (typeof value.post_progress_fingerprint === 'string' && isSha256Fingerprint(value.post_progress_fingerprint))) &&
    (value.post_aggregate_sequence === undefined || value.post_aggregate_sequence === null || isNonNegativeInteger(value.post_aggregate_sequence)) &&
    typeof value.replayed === 'boolean' &&
    (value.context_budget === undefined || value.context_budget === null || isTaskRunContextBudgetSummary(value.context_budget)) &&
    (value.terminal_completion_evidence === undefined || value.terminal_completion_evidence === null || isTaskRunCompletionEvidence(value.terminal_completion_evidence)) &&
    (value.next_route === undefined || value.next_route === null || isHeadlessContinueRoute(value.next_route)) &&
    typeof value.next_action === 'string'
  );
}

function isHeadlessRunProgressCheckpoint(value: unknown): value is HeadlessRunProgressCheckpoint {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['progress_fingerprint', 'aggregate_sequence']) &&
    typeof value.progress_fingerprint === 'string' &&
    isSha256Fingerprint(value.progress_fingerprint) &&
    isNonNegativeInteger(value.aggregate_sequence)
  );
}

export function isHeadlessRunAdvanceResult(value: unknown): value is HeadlessRunAdvanceResult {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'status',
      'session_id',
      'advance_id',
      'session_sequence',
      'replayed',
      'start_progress',
      'post_progress',
      'max_steps',
      'step_count',
      'executed_count',
      'replayed_count',
      'stop_reason',
      'checkpoint_fingerprint',
      'terminal_completion_evidence',
      'next_route',
      'steps',
      'next_action',
    ]) &&
    isHeadlessContinueOnceStatus(value.status) &&
    isHeadlessRunId(value.session_id) &&
    isHeadlessRunId(value.advance_id) &&
    isNonNegativeInteger(value.session_sequence) &&
    value.session_sequence >= 1 &&
    typeof value.replayed === 'boolean' &&
    isHeadlessRunProgressCheckpoint(value.start_progress) &&
    (value.post_progress === undefined || value.post_progress === null || isHeadlessRunProgressCheckpoint(value.post_progress)) &&
    isNonNegativeInteger(value.max_steps) &&
    value.max_steps >= 1 &&
    value.max_steps <= 3 &&
    isNonNegativeInteger(value.step_count) &&
    isNonNegativeInteger(value.executed_count) &&
    isNonNegativeInteger(value.replayed_count) &&
    value.executed_count <= value.step_count &&
    value.replayed_count <= value.step_count &&
    typeof value.stop_reason === 'string' &&
    value.stop_reason.length > 0 &&
    value.stop_reason.length <= 120 &&
    typeof value.checkpoint_fingerprint === 'string' &&
    isSha256Fingerprint(value.checkpoint_fingerprint) &&
    (value.terminal_completion_evidence === undefined || value.terminal_completion_evidence === null || isTaskRunCompletionEvidence(value.terminal_completion_evidence)) &&
    (value.next_route === undefined || value.next_route === null || isHeadlessContinueRoute(value.next_route)) &&
    (value.steps === undefined || (Array.isArray(value.steps) && value.steps.length === value.step_count && value.steps.every(isHeadlessContinueStepResult))) &&
    typeof value.next_action === 'string'
  );
}

export function isHeadlessRunJourneyExecution(value: unknown): value is HeadlessRunJourneyExecution {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['journey_id', 'authorize_journey_execution', 'expected_journey_fingerprint', 'task_start', 'expected_execution_checkpoint_fingerprint']) &&
    hasNoForbiddenRawFields(value) &&
    isHeadlessRunId(value.journey_id) &&
    value.authorize_journey_execution === true &&
    (value.expected_journey_fingerprint === undefined || value.expected_journey_fingerprint === null || (typeof value.expected_journey_fingerprint === 'string' && isSha256Fingerprint(value.expected_journey_fingerprint))) &&
    (value.task_start === undefined || value.task_start === null || isHeadlessRunJourneyTaskStartEnvelope(value.task_start)) &&
    (value.expected_execution_checkpoint_fingerprint === undefined || value.expected_execution_checkpoint_fingerprint === null || (typeof value.expected_execution_checkpoint_fingerprint === 'string' && isSha256Fingerprint(value.expected_execution_checkpoint_fingerprint)))
  );
}

export function isHeadlessRunDriveResult(value: unknown): value is HeadlessRunDriveResult {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'status',
      'session_id',
      'drive_id',
      'start_session_sequence',
      'end_session_sequence',
      'replayed',
      'max_advances',
      'max_steps_per_advance',
      'advance_count',
      'executed_count',
      'replayed_count',
      'stop_reason',
      'drive_fingerprint',
      'terminal_completion_evidence',
      'completion_closure',
      'completion_finalization',
      'accepted_completion',
      'product_evidence_matrix',
      'product_completion_decision',
      'start_progress',
      'post_progress',
      'next_route',
      'advances',
      'journey_route_resume',
      'journey_closure',
      'journey',
      'journey_execution',
      'next_action',
    ]) &&
    isHeadlessContinueOnceStatus(value.status) &&
    isHeadlessRunId(value.session_id) &&
    isHeadlessRunId(value.drive_id) &&
    isNonNegativeInteger(value.start_session_sequence) &&
    value.start_session_sequence >= 0 &&
    (value.start_session_sequence >= 1 || value.journey !== undefined && value.journey !== null) &&
    isNonNegativeInteger(value.end_session_sequence) &&
    value.end_session_sequence >= value.start_session_sequence &&
    typeof value.replayed === 'boolean' &&
    isNonNegativeInteger(value.max_advances) &&
    value.max_advances >= 1 &&
    value.max_advances <= 3 &&
    isNonNegativeInteger(value.max_steps_per_advance) &&
    value.max_steps_per_advance >= 1 &&
    value.max_steps_per_advance <= 3 &&
    isNonNegativeInteger(value.advance_count) &&
    isNonNegativeInteger(value.executed_count) &&
    isNonNegativeInteger(value.replayed_count) &&
    typeof value.stop_reason === 'string' &&
    value.stop_reason.length > 0 &&
    value.stop_reason.length <= 120 &&
    typeof value.drive_fingerprint === 'string' &&
    isSha256Fingerprint(value.drive_fingerprint) &&
    (value.terminal_completion_evidence === undefined || value.terminal_completion_evidence === null || isTaskRunCompletionEvidence(value.terminal_completion_evidence)) &&
    isHeadlessRunCompletionClosure(value.completion_closure) &&
    (value.completion_finalization === undefined || value.completion_finalization === null || isHeadlessRunCompletionFinalization(value.completion_finalization)) &&
    (value.accepted_completion === undefined || value.accepted_completion === null || isHeadlessRunAcceptedCompletion(value.accepted_completion)) &&
    (value.product_evidence_matrix === undefined || value.product_evidence_matrix === null || isHeadlessRunProductEvidenceMatrix(value.product_evidence_matrix)) &&
    (value.product_completion_decision === undefined || value.product_completion_decision === null || isHeadlessRunProductCompletionDecision(value.product_completion_decision)) &&
    isHeadlessRunProgressCheckpoint(value.start_progress) &&
    (value.post_progress === undefined || value.post_progress === null || isHeadlessRunProgressCheckpoint(value.post_progress)) &&
    (value.next_route === undefined || value.next_route === null || isHeadlessContinueRoute(value.next_route)) &&
    (value.advances === undefined || (Array.isArray(value.advances) && value.advances.length === value.advance_count && value.advances.every(isHeadlessRunAdvanceResult))) &&
    (value.journey_route_resume === undefined || value.journey_route_resume === null || isHeadlessRunJourneyRouteResumeMetadata(value.journey_route_resume)) &&
    (value.journey_closure === undefined || value.journey_closure === null || isHeadlessRunJourneyClosureMetadata(value.journey_closure)) &&
    (value.journey === undefined || value.journey === null || isHeadlessRunJourneyMetadata(value.journey)) &&
    (value.journey_execution === undefined || value.journey_execution === null || isHeadlessRunJourneyExecutionMetadata(value.journey_execution)) &&
    typeof value.next_action === 'string'
  );
}

export function isHeadlessRunJourneyMetadata(value: unknown): value is HeadlessRunJourneyMetadata {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['journey_id', 'task_id', 'run_id', 'session_id', 'drive_id', 'start_progress_fingerprint', 'start_aggregate_sequence', 'post_progress_fingerprint', 'post_aggregate_sequence', 'closure_status', 'next_action', 'replayed', 'journey_fingerprint']) &&
    isHeadlessRunId(value.journey_id) &&
    isBoundedHandle(value.task_id) &&
    isBoundedHandle(value.run_id) &&
    isHeadlessRunId(value.session_id) &&
    isHeadlessRunId(value.drive_id) &&
    typeof value.start_progress_fingerprint === 'string' &&
    isSha256Fingerprint(value.start_progress_fingerprint) &&
    isNonNegativeInteger(value.start_aggregate_sequence) &&
    (value.post_progress_fingerprint === undefined || value.post_progress_fingerprint === null || (typeof value.post_progress_fingerprint === 'string' && isSha256Fingerprint(value.post_progress_fingerprint))) &&
    (value.post_aggregate_sequence === undefined || value.post_aggregate_sequence === null || isNonNegativeInteger(value.post_aggregate_sequence)) &&
    isHeadlessRunCompletionClosureStatus(value.closure_status) &&
    typeof value.next_action === 'string' &&
    value.next_action.length > 0 &&
    value.next_action.length <= 120 &&
    typeof value.replayed === 'boolean' &&
    typeof value.journey_fingerprint === 'string' &&
    isSha256Fingerprint(value.journey_fingerprint)
  );
}

export function isHeadlessRunJourneyRouteResumeMetadata(value: unknown): value is HeadlessRunJourneyRouteResumeMetadata {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['journey_id', 'task_id', 'run_id', 'session_id', 'drive_id', 'route_kind', 'source_continuation_id', 'source_decision_id', 'source_checkpoint_fingerprint', 'derived_target_class', 'result_advance_id', 'result_continuation_id', 'post_route_progress_fingerprint', 'post_route_aggregate_sequence', 'next_action', 'replayed', 'resume_fingerprint']) &&
    hasNoForbiddenRawFields(value) &&
    isHeadlessRunId(value.journey_id) &&
    isBoundedHandle(value.task_id) &&
    isBoundedHandle(value.run_id) &&
    isHeadlessRunId(value.session_id) &&
    isHeadlessRunId(value.drive_id) &&
    (
      value.route_kind === 'fetch_selected_mode_pack_candidate_explicitly' ||
      value.route_kind === 'verify_selected_mode_pack_candidate_provenance_explicitly' ||
      value.route_kind === 'approve_verified_mode_pack_candidate_explicitly' ||
      value.route_kind === 'replace_active_with_approved_mode_pack_candidate_explicitly'
    ) &&
    isBoundedHandle(value.source_continuation_id) &&
    isBoundedHandle(value.source_decision_id) &&
    typeof value.source_checkpoint_fingerprint === 'string' &&
    isSha256Fingerprint(value.source_checkpoint_fingerprint) &&
    (
      (value.route_kind === 'fetch_selected_mode_pack_candidate_explicitly' &&
        value.derived_target_class === 'modepack_selected_candidate_fetch_target') ||
      (value.route_kind === 'verify_selected_mode_pack_candidate_provenance_explicitly' &&
        value.derived_target_class === 'modepack_selected_candidate_provenance_verification_target') ||
      (value.route_kind === 'approve_verified_mode_pack_candidate_explicitly' &&
        value.derived_target_class === 'modepack_selected_candidate_approval_target') ||
      (value.route_kind === 'replace_active_with_approved_mode_pack_candidate_explicitly' &&
        value.derived_target_class === 'modepack_selected_approved_candidate_replacement_target')
    ) &&
    (value.result_advance_id === undefined || value.result_advance_id === null || isHeadlessRunId(value.result_advance_id)) &&
    (value.result_continuation_id === undefined || value.result_continuation_id === null || isBoundedHandle(value.result_continuation_id)) &&
    (value.post_route_progress_fingerprint === undefined || value.post_route_progress_fingerprint === null || (typeof value.post_route_progress_fingerprint === 'string' && isSha256Fingerprint(value.post_route_progress_fingerprint))) &&
    (value.post_route_aggregate_sequence === undefined || value.post_route_aggregate_sequence === null || isNonNegativeInteger(value.post_route_aggregate_sequence)) &&
    typeof value.next_action === 'string' &&
    value.next_action.length > 0 &&
    value.next_action.length <= 120 &&
    typeof value.replayed === 'boolean' &&
    typeof value.resume_fingerprint === 'string' &&
    isSha256Fingerprint(value.resume_fingerprint)
  );
}

export function isHeadlessRunJourneyClosureMetadata(value: unknown): value is HeadlessRunJourneyClosureMetadata {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['journey_id', 'task_id', 'run_id', 'session_id', 'drive_id', 'source_replacement_drive_id', 'source_replacement_resume_fingerprint', 'replacement_route_kind', 'replacement_continuation_id', 'replacement_checkpoint_fingerprint', 'active_modepack_activation_fingerprint', 'closure_fingerprint', 'finalization_fingerprint', 'terminal_completion_fingerprint', 'progress_fingerprint', 'aggregate_sequence', 'next_action', 'replayed', 'journey_closure_fingerprint']) &&
    hasNoForbiddenRawFields(value) &&
    isHeadlessRunId(value.journey_id) &&
    isBoundedHandle(value.task_id) &&
    isBoundedHandle(value.run_id) &&
    isHeadlessRunId(value.session_id) &&
    isHeadlessRunId(value.drive_id) &&
    isHeadlessRunId(value.source_replacement_drive_id) &&
    typeof value.source_replacement_resume_fingerprint === 'string' &&
    isSha256Fingerprint(value.source_replacement_resume_fingerprint) &&
    value.replacement_route_kind === 'replace_active_with_approved_mode_pack_candidate_explicitly' &&
    isBoundedHandle(value.replacement_continuation_id) &&
    typeof value.replacement_checkpoint_fingerprint === 'string' &&
    isSha256Fingerprint(value.replacement_checkpoint_fingerprint) &&
    typeof value.active_modepack_activation_fingerprint === 'string' &&
    isSha256Fingerprint(value.active_modepack_activation_fingerprint) &&
    typeof value.closure_fingerprint === 'string' &&
    isSha256Fingerprint(value.closure_fingerprint) &&
    (value.finalization_fingerprint === undefined || value.finalization_fingerprint === null || (typeof value.finalization_fingerprint === 'string' && isSha256Fingerprint(value.finalization_fingerprint))) &&
    (value.terminal_completion_fingerprint === undefined || value.terminal_completion_fingerprint === null || (typeof value.terminal_completion_fingerprint === 'string' && isSha256Fingerprint(value.terminal_completion_fingerprint))) &&
    typeof value.progress_fingerprint === 'string' &&
    isSha256Fingerprint(value.progress_fingerprint) &&
    isNonNegativeInteger(value.aggregate_sequence) &&
    typeof value.next_action === 'string' &&
    value.next_action.length > 0 &&
    value.next_action.length <= 120 &&
    typeof value.replayed === 'boolean' &&
    typeof value.journey_closure_fingerprint === 'string' &&
    isSha256Fingerprint(value.journey_closure_fingerprint)
  );
}

export function isHeadlessRunJourneyExecutionBoundaryMetadata(value: unknown): value is HeadlessRunJourneyExecutionBoundaryMetadata {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['boundary', 'drive_id', 'route_kind', 'session_sequence', 'drive_fingerprint', 'resume_fingerprint', 'journey_closure_fingerprint', 'replayed']) &&
    hasNoForbiddenRawFields(value) &&
    (
      value.boundary === 'fetch_selected_candidate' ||
      value.boundary === 'verify_candidate_provenance' ||
      value.boundary === 'approve_verified_candidate' ||
      value.boundary === 'replace_active_modepack' ||
      value.boundary === 'admit_journey' ||
      value.boundary === 'close_journey'
    ) &&
    isHeadlessRunId(value.drive_id) &&
    (
      value.route_kind === undefined ||
      value.route_kind === null ||
      value.route_kind === 'fetch_selected_mode_pack_candidate_explicitly' ||
      value.route_kind === 'verify_selected_mode_pack_candidate_provenance_explicitly' ||
      value.route_kind === 'approve_verified_mode_pack_candidate_explicitly' ||
      value.route_kind === 'replace_active_with_approved_mode_pack_candidate_explicitly'
    ) &&
    isNonNegativeInteger(value.session_sequence) &&
    typeof value.drive_fingerprint === 'string' &&
    isSha256Fingerprint(value.drive_fingerprint) &&
    (value.resume_fingerprint === undefined || value.resume_fingerprint === null || (typeof value.resume_fingerprint === 'string' && isSha256Fingerprint(value.resume_fingerprint))) &&
    (value.journey_closure_fingerprint === undefined || value.journey_closure_fingerprint === null || (typeof value.journey_closure_fingerprint === 'string' && isSha256Fingerprint(value.journey_closure_fingerprint))) &&
    typeof value.replayed === 'boolean'
  );
}

export function isHeadlessRunJourneyExecutionMetadata(value: unknown): value is HeadlessRunJourneyExecutionMetadata {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['journey_id', 'task_id', 'run_id', 'session_id', 'drive_id', 'journey_fingerprint', 'completed_boundaries', 'complete', 'next_action', 'replayed', 'execution_checkpoint_fingerprint']) &&
    hasNoForbiddenRawFields(value) &&
    isHeadlessRunId(value.journey_id) &&
    isBoundedHandle(value.task_id) &&
    isBoundedHandle(value.run_id) &&
    isHeadlessRunId(value.session_id) &&
    isHeadlessRunId(value.drive_id) &&
    typeof value.journey_fingerprint === 'string' &&
    isSha256Fingerprint(value.journey_fingerprint) &&
    Array.isArray(value.completed_boundaries) &&
    value.completed_boundaries.length <= 6 &&
    value.completed_boundaries.every(isHeadlessRunJourneyExecutionBoundaryMetadata) &&
    typeof value.complete === 'boolean' &&
    typeof value.next_action === 'string' &&
    value.next_action.length > 0 &&
    value.next_action.length <= 120 &&
    typeof value.replayed === 'boolean' &&
    typeof value.execution_checkpoint_fingerprint === 'string' &&
    isSha256Fingerprint(value.execution_checkpoint_fingerprint)
  );
}

export function isHeadlessRunCompletionClosure(value: unknown): value is HeadlessRunCompletionClosure {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'status',
      'stop_reason',
      'terminal_task_count',
      'total_task_count',
      'runnable_task_count',
      'blocked_task_count',
      'route_candidate_count',
      'progress_fingerprint',
      'aggregate_sequence',
      'route_kind',
      'route_task_id',
      'route_run_id',
      'terminal_completion_fingerprint',
      'next_action',
      'closure_fingerprint',
    ]) &&
    isHeadlessRunCompletionClosureStatus(value.status) &&
    typeof value.stop_reason === 'string' &&
    value.stop_reason.length > 0 &&
    value.stop_reason.length <= 120 &&
    isNonNegativeInteger(value.terminal_task_count) &&
    isNonNegativeInteger(value.total_task_count) &&
    value.terminal_task_count <= value.total_task_count &&
    isNonNegativeInteger(value.runnable_task_count) &&
    isNonNegativeInteger(value.blocked_task_count) &&
    isNonNegativeInteger(value.route_candidate_count) &&
    typeof value.progress_fingerprint === 'string' &&
    isSha256Fingerprint(value.progress_fingerprint) &&
    isNonNegativeInteger(value.aggregate_sequence) &&
    (value.route_kind === undefined || value.route_kind === null || isHeadlessContinueRouteKind(value.route_kind)) &&
    (value.route_task_id === undefined || value.route_task_id === null || isBoundedHandle(value.route_task_id)) &&
    (value.route_run_id === undefined || value.route_run_id === null || isBoundedHandle(value.route_run_id)) &&
    (value.terminal_completion_fingerprint === undefined || value.terminal_completion_fingerprint === null || (typeof value.terminal_completion_fingerprint === 'string' && isSha256Fingerprint(value.terminal_completion_fingerprint))) &&
    typeof value.next_action === 'string' &&
    value.next_action.length > 0 &&
    value.next_action.length <= 120 &&
    typeof value.closure_fingerprint === 'string' &&
    isSha256Fingerprint(value.closure_fingerprint)
  );
}

export function isHeadlessRunCompletionFinalization(value: unknown): value is HeadlessRunCompletionFinalization {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'status',
      'session_id',
      'drive_id',
      'start_session_sequence',
      'end_session_sequence',
      'closure_fingerprint',
      'progress_fingerprint',
      'aggregate_sequence',
      'owner_task_id',
      'owner_run_id',
      'terminal_completion_fingerprint',
      'terminal_task_count',
      'total_task_count',
      'finalization_fingerprint',
      'replayed',
      'next_action',
    ]) &&
    value.status === 'finalized' &&
    isHeadlessRunId(value.session_id) &&
    isHeadlessRunId(value.drive_id) &&
    isNonNegativeInteger(value.start_session_sequence) &&
    value.start_session_sequence >= 1 &&
    isNonNegativeInteger(value.end_session_sequence) &&
    value.end_session_sequence >= value.start_session_sequence &&
    typeof value.closure_fingerprint === 'string' &&
    isSha256Fingerprint(value.closure_fingerprint) &&
    typeof value.progress_fingerprint === 'string' &&
    isSha256Fingerprint(value.progress_fingerprint) &&
    isNonNegativeInteger(value.aggregate_sequence) &&
    (value.owner_task_id === undefined || value.owner_task_id === null || isBoundedHandle(value.owner_task_id)) &&
    (value.owner_run_id === undefined || value.owner_run_id === null || isBoundedHandle(value.owner_run_id)) &&
    (value.terminal_completion_fingerprint === undefined || value.terminal_completion_fingerprint === null || (typeof value.terminal_completion_fingerprint === 'string' && isSha256Fingerprint(value.terminal_completion_fingerprint))) &&
    isNonNegativeInteger(value.terminal_task_count) &&
    isNonNegativeInteger(value.total_task_count) &&
    value.terminal_task_count <= value.total_task_count &&
    typeof value.finalization_fingerprint === 'string' &&
    isSha256Fingerprint(value.finalization_fingerprint) &&
    typeof value.replayed === 'boolean' &&
    typeof value.next_action === 'string' &&
    value.next_action.length > 0 &&
    value.next_action.length <= 120
  );
}

export function isHeadlessRunAcceptedCompletion(value: unknown): value is HeadlessRunAcceptedCompletion {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'task_id',
      'run_id',
      'acceptance_id',
      'status',
      'terminal_completion_fingerprint',
      'acceptance_fingerprint',
      'verifier_gate_status',
      'replayed',
      'next_action',
    ]) &&
    hasNoForbiddenRawFields(value) &&
    isBoundedHandle(value.task_id) &&
    isBoundedHandle(value.run_id) &&
    isHeadlessRunId(value.acceptance_id) &&
    value.status === 'AcceptedComplete' &&
    typeof value.terminal_completion_fingerprint === 'string' &&
    isSha256Fingerprint(value.terminal_completion_fingerprint) &&
    typeof value.acceptance_fingerprint === 'string' &&
    isSha256Fingerprint(value.acceptance_fingerprint) &&
    typeof value.verifier_gate_status === 'string' &&
    value.verifier_gate_status.length > 0 &&
    value.verifier_gate_status.length <= 64 &&
    typeof value.replayed === 'boolean' &&
    typeof value.next_action === 'string' &&
    value.next_action.length > 0 &&
    value.next_action.length <= 120
  );
}

export function isHeadlessRunProductCompletionDecisionRequest(value: unknown): value is HeadlessRunProductCompletionDecisionRequest {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'authorize_product_completion_decision',
      'decision_id',
      'expected_accepted_completion_fingerprint',
      'expected_terminal_completion_fingerprint',
      'expected_completion_closure_fingerprint',
      'expected_product_evidence_fingerprint',
      'evidence_status',
      'target_capability',
      'concrete_capability_transition',
      'validated_gate_categories',
      'derived_product_evidence_matrix_fingerprint',
      'behavior_evidence_count',
      'rejected_alternatives_count',
      'safety_boundary_reviewed',
      'non_goals_reviewed',
      'technical_debt_reviewed',
      'remaining_capability',
      'milestone_exit_rationale',
    ]) &&
    hasNoForbiddenRawFields(value) &&
    value.authorize_product_completion_decision === true &&
    isHeadlessRunId(value.decision_id) &&
    typeof value.expected_accepted_completion_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_accepted_completion_fingerprint) &&
    typeof value.expected_terminal_completion_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_terminal_completion_fingerprint) &&
    typeof value.expected_completion_closure_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_completion_closure_fingerprint) &&
    typeof value.expected_product_evidence_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_product_evidence_fingerprint) &&
    isBoundedAsciiMetadata(value.evidence_status, 64) &&
    isBoundedAsciiMetadata(value.target_capability, 96) &&
    isBoundedAsciiMetadata(value.concrete_capability_transition, 120) &&
    Array.isArray(value.validated_gate_categories) &&
    value.validated_gate_categories.length <= 16 &&
    value.validated_gate_categories.every((category) => isBoundedAsciiMetadata(category, 96)) &&
    (value.derived_product_evidence_matrix_fingerprint === undefined || value.derived_product_evidence_matrix_fingerprint === null || (typeof value.derived_product_evidence_matrix_fingerprint === 'string' && isSha256Fingerprint(value.derived_product_evidence_matrix_fingerprint))) &&
    isNonNegativeInteger(value.behavior_evidence_count) &&
    isNonNegativeInteger(value.rejected_alternatives_count) &&
    typeof value.safety_boundary_reviewed === 'boolean' &&
    typeof value.non_goals_reviewed === 'boolean' &&
    typeof value.technical_debt_reviewed === 'boolean' &&
    (value.remaining_capability === undefined || value.remaining_capability === null || isBoundedAsciiMetadata(value.remaining_capability, 120)) &&
    (value.milestone_exit_rationale === undefined || value.milestone_exit_rationale === null || isBoundedAsciiMetadata(value.milestone_exit_rationale, 160))
  );
}

export function isHeadlessRunProductEvidenceDerivationRequest(value: unknown): value is HeadlessRunProductEvidenceDerivationRequest {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'authorize_product_evidence_derivation',
      'derivation_id',
      'phase_id',
      'milestone',
      'expected_accepted_completion_fingerprint',
      'expected_terminal_completion_fingerprint',
      'expected_completion_closure_fingerprint',
      'project_completion_policy',
      'artifacts',
    ]) &&
    hasNoForbiddenRawFields(value) &&
    value.authorize_product_evidence_derivation === true &&
    isHeadlessRunId(value.derivation_id) &&
    isBoundedAsciiMetadata(value.phase_id, 32) &&
    isBoundedAsciiMetadata(value.milestone, 120) &&
    typeof value.expected_accepted_completion_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_accepted_completion_fingerprint) &&
    typeof value.expected_terminal_completion_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_terminal_completion_fingerprint) &&
    typeof value.expected_completion_closure_fingerprint === 'string' &&
    isSha256Fingerprint(value.expected_completion_closure_fingerprint) &&
    isHeadlessRunProductEvidenceArtifactSource(value.project_completion_policy) &&
    value.project_completion_policy.path.endsWith('.json') &&
    Array.isArray(value.artifacts) &&
    value.artifacts.length >= 1 &&
    value.artifacts.length <= 32 &&
    value.artifacts.every(isHeadlessRunProductEvidenceArtifactSource) &&
    hasUniqueProductEvidenceArtifactPaths(value.project_completion_policy, value.artifacts)
  );
}

function hasUniqueProductEvidenceArtifactPaths(
  projectCompletionPolicy: HeadlessRunProductEvidenceArtifactSource,
  artifacts: HeadlessRunProductEvidenceArtifactSource[],
): boolean {
  return new Set([projectCompletionPolicy.path, ...artifacts.map((artifact) => artifact.path)]).size === artifacts.length + 1;
}

export function isHeadlessRunProductEvidenceArtifactSource(value: unknown): value is HeadlessRunProductEvidenceArtifactSource {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['path', 'expected_sha256']) &&
    hasNoForbiddenRawFields(value) &&
    isBoundedRelativePath(value.path) &&
    typeof value.expected_sha256 === 'string' &&
    isSha256Fingerprint(value.expected_sha256)
  );
}

export function isHeadlessRunProductEvidenceArtifact(value: unknown): value is HeadlessRunProductEvidenceArtifact {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['path', 'sha256']) &&
    hasNoForbiddenRawFields(value) &&
    isBoundedRelativePath(value.path) &&
    typeof value.sha256 === 'string' &&
    isSha256Fingerprint(value.sha256)
  );
}

export function isHeadlessRunProductEvidenceMatrix(value: unknown): value is HeadlessRunProductEvidenceMatrix {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'derivation_id',
      'task_id',
      'run_id',
      'acceptance_id',
      'phase_id',
      'milestone',
      'target_capability',
      'concrete_capability_transition',
      'accepted_completion_fingerprint',
      'terminal_completion_fingerprint',
      'completion_closure_fingerprint',
      'product_evidence_matrix_fingerprint',
      'product_completion_claim',
      'artifact_count',
      'artifact_hashes',
      'validated_gate_categories',
      'behavior_evidence_count',
      'rejected_alternatives_count',
      'safety_boundary_reviewed',
      'non_goals_reviewed',
      'technical_debt_reviewed',
      'next_action',
      'replayed',
    ]) &&
    hasNoForbiddenRawFields(value) &&
    isHeadlessRunId(value.derivation_id) &&
    isBoundedHandle(value.task_id) &&
    isBoundedHandle(value.run_id) &&
    isHeadlessRunId(value.acceptance_id) &&
    isBoundedAsciiMetadata(value.phase_id, 32) &&
    isBoundedAsciiMetadata(value.milestone, 120) &&
    isBoundedAsciiMetadata(value.target_capability, 96) &&
    isBoundedAsciiMetadata(value.concrete_capability_transition, 120) &&
    typeof value.accepted_completion_fingerprint === 'string' &&
    isSha256Fingerprint(value.accepted_completion_fingerprint) &&
    typeof value.terminal_completion_fingerprint === 'string' &&
    isSha256Fingerprint(value.terminal_completion_fingerprint) &&
    typeof value.completion_closure_fingerprint === 'string' &&
    isSha256Fingerprint(value.completion_closure_fingerprint) &&
    typeof value.product_evidence_matrix_fingerprint === 'string' &&
    isSha256Fingerprint(value.product_evidence_matrix_fingerprint) &&
    typeof value.product_completion_claim === 'boolean' &&
    isNonNegativeInteger(value.artifact_count) &&
    Array.isArray(value.artifact_hashes) &&
    value.artifact_hashes.length === value.artifact_count &&
    value.artifact_hashes.every(isHeadlessRunProductEvidenceArtifact) &&
    Array.isArray(value.validated_gate_categories) &&
    value.validated_gate_categories.length <= 16 &&
    value.validated_gate_categories.every((category) => isBoundedAsciiMetadata(category, 96)) &&
    isNonNegativeInteger(value.behavior_evidence_count) &&
    isNonNegativeInteger(value.rejected_alternatives_count) &&
    typeof value.safety_boundary_reviewed === 'boolean' &&
    typeof value.non_goals_reviewed === 'boolean' &&
    typeof value.technical_debt_reviewed === 'boolean' &&
    value.next_action === 'record_product_completion_decision_with_runtime_evidence' &&
    typeof value.replayed === 'boolean'
  );
}

export function isHeadlessRunProductCompletionDecision(value: unknown): value is HeadlessRunProductCompletionDecision {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'decision_id',
      'task_id',
      'run_id',
      'acceptance_id',
      'status',
      'next_action',
      'target_capability',
      'concrete_capability_transition',
      'accepted_completion_fingerprint',
      'terminal_completion_fingerprint',
      'completion_closure_fingerprint',
      'product_evidence_fingerprint',
      'decision_fingerprint',
      'validated_gate_categories',
      'derived_product_evidence_matrix_fingerprint',
      'behavior_evidence_count',
      'rejected_alternatives_count',
      'safety_boundary_reviewed',
      'non_goals_reviewed',
      'technical_debt_reviewed',
      'remaining_capability',
      'milestone_exit_rationale',
      'replayed',
    ]) &&
    hasNoForbiddenRawFields(value) &&
    isHeadlessRunId(value.decision_id) &&
    isBoundedHandle(value.task_id) &&
    isBoundedHandle(value.run_id) &&
    isHeadlessRunId(value.acceptance_id) &&
    (value.status === 'product_complete' || value.status === 'continue_development' || value.status === 'blocked_by_product_evidence') &&
    (value.next_action === 'stop_autonomous_development' || value.next_action === 'plan_next_phase' || value.next_action === 'repair_product_completion_evidence') &&
    isBoundedAsciiMetadata(value.target_capability, 96) &&
    isBoundedAsciiMetadata(value.concrete_capability_transition, 120) &&
    typeof value.accepted_completion_fingerprint === 'string' &&
    isSha256Fingerprint(value.accepted_completion_fingerprint) &&
    typeof value.terminal_completion_fingerprint === 'string' &&
    isSha256Fingerprint(value.terminal_completion_fingerprint) &&
    typeof value.completion_closure_fingerprint === 'string' &&
    isSha256Fingerprint(value.completion_closure_fingerprint) &&
    typeof value.product_evidence_fingerprint === 'string' &&
    isSha256Fingerprint(value.product_evidence_fingerprint) &&
    typeof value.decision_fingerprint === 'string' &&
    isSha256Fingerprint(value.decision_fingerprint) &&
    Array.isArray(value.validated_gate_categories) &&
    value.validated_gate_categories.length <= 16 &&
    value.validated_gate_categories.every((category) => isBoundedAsciiMetadata(category, 96)) &&
    (value.derived_product_evidence_matrix_fingerprint === undefined || value.derived_product_evidence_matrix_fingerprint === null || (typeof value.derived_product_evidence_matrix_fingerprint === 'string' && isSha256Fingerprint(value.derived_product_evidence_matrix_fingerprint))) &&
    isNonNegativeInteger(value.behavior_evidence_count) &&
    isNonNegativeInteger(value.rejected_alternatives_count) &&
    typeof value.safety_boundary_reviewed === 'boolean' &&
    typeof value.non_goals_reviewed === 'boolean' &&
    typeof value.technical_debt_reviewed === 'boolean' &&
    (value.remaining_capability === undefined || value.remaining_capability === null || isBoundedAsciiMetadata(value.remaining_capability, 120)) &&
    (value.milestone_exit_rationale === undefined || value.milestone_exit_rationale === null || isBoundedAsciiMetadata(value.milestone_exit_rationale, 160)) &&
    typeof value.replayed === 'boolean'
  );
}

function isHeadlessRunCompletionClosureStatus(value: unknown): value is HeadlessRunCompletionClosureStatus {
  return (
    value === 'complete' ||
    value === 'routed_explicit_action' ||
    value === 'budget_exhausted' ||
    value === 'stale_no_progress' ||
    value === 'task_in_progress' ||
    value === 'no_eligible_task' ||
    value === 'unknown_nonterminal'
  );
}

function isHeadlessContinueOnceStatus(value: unknown): value is HeadlessContinueOnceStatus {
  return value === 'stale_progress' || value === 'no_eligible_task' || value === 'task_in_progress' || value === 'task_executed';
}

function isHeadlessContinuationId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,96}$/.test(value);
}

function isHeadlessRunId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,48}$/.test(value);
}

function isBoundedAsciiMetadata(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maxLength &&
    /^[A-Za-z0-9_.: -]+$/.test(value)
  );
}

function isBoundedHandle(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
}

function isBoundedRelativePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 240 &&
    !value.startsWith('/') &&
    !value.startsWith('~') &&
    !value.includes('\\') &&
    value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
  );
}

function isHeadlessContinueRouteKind(value: unknown): value is HeadlessContinueRouteKind {
  return value === 'inspect_progress_overview' || value === 'start_verification_recovery_explicitly' || value === 'run_recovery_task_explicitly' || value === 'review_and_authorize_recovery_proposal' || value === 'apply_approved_recovery_proposal_explicitly' || value === 'start_verification_retry_explicitly' || value === 'run_verification_retry_task_explicitly' || value === 'run_llm_provider_retry_task_explicitly' || value === 'fetch_selected_mode_pack_candidate_explicitly' || value === 'fetch_selected_modepack_candidate_explicitly' || value === 'verify_selected_mode_pack_candidate_provenance_explicitly' || value === 'verify_selected_modepack_candidate_provenance_explicitly' || value === 'approve_verified_mode_pack_candidate_explicitly' || value === 'approve_verified_modepack_candidate_explicitly' || value === 'replace_active_with_approved_mode_pack_candidate_explicitly' || value === 'replace_active_with_approved_modepack_candidate_explicitly' || value === 'run_parent_task_explicitly' || value === 'no_eligible_task' || value === 'refresh_progress_overview';
}

function isModePackRouteKind(value: unknown, canonical: HeadlessContinueRouteKind, legacy: HeadlessContinueRouteKind): boolean {
  return value === canonical || value === legacy;
}

function isHeadlessContinueRoute(value: unknown): value is HeadlessContinueRoute {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['kind', 'reason', 'task_id', 'run_id', 'proposal_id', 'apply_id', 'failure_fingerprint', 'apply_fingerprint', 'progress_fingerprint', 'aggregate_sequence', 'next_action']) &&
    hasNoForbiddenTaskListProgressFields(value) &&
    isHeadlessContinueRouteKind(value.kind) &&
    typeof value.reason === 'string' &&
    value.reason.length > 0 &&
    value.reason.length <= 240 &&
    (value.task_id === undefined || value.task_id === null || typeof value.task_id === 'string') &&
    (value.run_id === undefined || value.run_id === null || typeof value.run_id === 'string') &&
    (value.proposal_id === undefined || value.proposal_id === null || typeof value.proposal_id === 'string') &&
    (value.apply_id === undefined || value.apply_id === null || typeof value.apply_id === 'string') &&
    (value.failure_fingerprint === undefined || value.failure_fingerprint === null || (typeof value.failure_fingerprint === 'string' && isSha256Fingerprint(value.failure_fingerprint))) &&
    (value.apply_fingerprint === undefined || value.apply_fingerprint === null || (typeof value.apply_fingerprint === 'string' && isSha256Fingerprint(value.apply_fingerprint))) &&
    (value.progress_fingerprint === undefined || value.progress_fingerprint === null || (typeof value.progress_fingerprint === 'string' && isSha256Fingerprint(value.progress_fingerprint))) &&
    (value.aggregate_sequence === undefined || value.aggregate_sequence === null || isNonNegativeInteger(value.aggregate_sequence)) &&
    typeof value.next_action === 'string' &&
    value.next_action.length > 0 &&
    value.next_action.length <= 96
  );
}

function isTaskListHeadlessRouteCandidate(value: unknown): value is TaskListHeadlessRouteCandidate {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['kind', 'reason', 'task_id', 'run_id', 'proposal_id', 'apply_id', 'failure_fingerprint', 'apply_fingerprint', 'progress_fingerprint', 'aggregate_sequence', 'route_fingerprint', 'priority', 'next_action']) &&
    hasNoForbiddenTaskListProgressFields(value) &&
    isHeadlessContinueRouteKind(value.kind) &&
    typeof value.reason === 'string' &&
    value.reason.length > 0 &&
    value.reason.length <= 240 &&
    (value.task_id === undefined || value.task_id === null || typeof value.task_id === 'string') &&
    (value.run_id === undefined || value.run_id === null || typeof value.run_id === 'string') &&
    (value.proposal_id === undefined || value.proposal_id === null || typeof value.proposal_id === 'string') &&
    (value.apply_id === undefined || value.apply_id === null || typeof value.apply_id === 'string') &&
    (value.failure_fingerprint === undefined || value.failure_fingerprint === null || (typeof value.failure_fingerprint === 'string' && isSha256Fingerprint(value.failure_fingerprint))) &&
    (value.apply_fingerprint === undefined || value.apply_fingerprint === null || (typeof value.apply_fingerprint === 'string' && isSha256Fingerprint(value.apply_fingerprint))) &&
    typeof value.progress_fingerprint === 'string' &&
    isSha256Fingerprint(value.progress_fingerprint) &&
    isNonNegativeInteger(value.aggregate_sequence) &&
    typeof value.route_fingerprint === 'string' &&
    isSha256Fingerprint(value.route_fingerprint) &&
    isNonNegativeInteger(value.priority) &&
    value.priority <= 255 &&
    typeof value.next_action === 'string' &&
    value.next_action.length > 0 &&
    value.next_action.length <= 96
  );
}

export function isTaskRunSelectedIndexPromptContextSummary(value: unknown): value is TaskRunSelectedIndexPromptContextSummary {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'prompt_context_id',
      'source_event_id',
      'source_event_kind',
      'query_id',
      'selection_id',
      'query_fingerprint',
      'selection_fingerprint',
      'index_id',
      'workspace_fingerprint',
      'snapshot_fingerprint',
      'read_path_fingerprint',
      'file_kind',
      'bytes_read',
      'content_char_count',
      'materialized_content_char_count',
      'content_truncated_for_prompt',
      'content_sha256',
      'prompt_preview_redacted',
      'next_action',
    ]) &&
    typeof value.prompt_context_id === 'string' &&
    /^ctx_[a-f0-9]{16}$/.test(value.prompt_context_id) &&
    typeof value.source_event_id === 'string' &&
    value.source_event_id.trim().length > 0 &&
    value.source_event_kind === 'CodebaseIndexSelectionReadCompleted' &&
    typeof value.query_id === 'string' &&
    /^query_[a-f0-9]{16}$/.test(value.query_id) &&
    typeof value.selection_id === 'string' &&
    /^selection_[a-f0-9]{16}$/.test(value.selection_id) &&
    typeof value.query_fingerprint === 'string' &&
    isSha256Fingerprint(value.query_fingerprint) &&
    typeof value.selection_fingerprint === 'string' &&
    isSha256Fingerprint(value.selection_fingerprint) &&
    typeof value.index_id === 'string' &&
    /^idx_[a-f0-9]{16}$/.test(value.index_id) &&
    typeof value.workspace_fingerprint === 'string' &&
    isSha256Fingerprint(value.workspace_fingerprint) &&
    typeof value.snapshot_fingerprint === 'string' &&
    isSha256Fingerprint(value.snapshot_fingerprint) &&
    typeof value.read_path_fingerprint === 'string' &&
    isSha256Fingerprint(value.read_path_fingerprint) &&
    isCodebaseIndexFileKind(value.file_kind) &&
    isNonNegativeInteger(value.bytes_read) &&
    value.bytes_read <= 65536 &&
    isNonNegativeInteger(value.content_char_count) &&
    value.content_char_count <= 65536 &&
    isNonNegativeInteger(value.materialized_content_char_count) &&
    value.materialized_content_char_count <= value.content_char_count &&
    typeof value.content_truncated_for_prompt === 'boolean' &&
    typeof value.content_sha256 === 'string' &&
    isSha256Fingerprint(value.content_sha256) &&
    value.prompt_preview_redacted === true &&
    value.next_action === 'continue_task_execution_with_materialized_context'
  );
}

export function isTaskRunVerificationRecoveryContextReadSummary(value: unknown): value is TaskRunVerificationRecoveryContextReadSummary {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'context_read_id',
      'source_task_id',
      'source_run_id',
      'recovery_task_id',
      'recovery_run_id',
      'failure_fingerprint',
      'diagnostic_index',
      'tool_id',
      'check_id',
      'diagnostic_kind',
      'severity',
      'test_name_hash',
      'read_path_fingerprint',
      'line',
      'column',
      'excerpt_start_line',
      'excerpt_end_line',
      'excerpt_bytes',
      'excerpt_sha256',
      'excerpt_truncated',
      'prompt_preview_redacted',
      'replayed',
      'next_action',
    ]) &&
    typeof value.context_read_id === 'string' &&
    /^ctx_[a-f0-9]{64}$/.test(value.context_read_id) &&
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
    isNonNegativeInteger(value.diagnostic_index) &&
    typeof value.tool_id === 'string' &&
    value.tool_id.trim().length > 0 &&
    typeof value.check_id === 'string' &&
    value.check_id.trim().length > 0 &&
    typeof value.diagnostic_kind === 'string' &&
    value.diagnostic_kind.trim().length > 0 &&
    typeof value.severity === 'string' &&
    value.severity.trim().length > 0 &&
    (value.test_name_hash === undefined || value.test_name_hash === null || (typeof value.test_name_hash === 'string' && isSha256Fingerprint(value.test_name_hash))) &&
    typeof value.read_path_fingerprint === 'string' &&
    isSha256Fingerprint(value.read_path_fingerprint) &&
    (value.line === undefined || value.line === null || isNonNegativeInteger(value.line)) &&
    (value.column === undefined || value.column === null || isNonNegativeInteger(value.column)) &&
    isNonNegativeInteger(value.excerpt_start_line) &&
    value.excerpt_start_line >= 1 &&
    isNonNegativeInteger(value.excerpt_end_line) &&
    value.excerpt_end_line >= value.excerpt_start_line &&
    isNonNegativeInteger(value.excerpt_bytes) &&
    value.excerpt_bytes <= 8192 &&
    typeof value.excerpt_sha256 === 'string' &&
    isSha256Fingerprint(value.excerpt_sha256) &&
    typeof value.excerpt_truncated === 'boolean' &&
    value.prompt_preview_redacted === true &&
    typeof value.replayed === 'boolean' &&
    value.next_action === 'run_recovery_task_with_context'
  );
}

export function isTaskRunContextBudgetSummary(value: unknown): value is TaskRunContextBudgetSummary {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'requested',
      'max_prompt_chars',
      'max_ledger_events',
      'max_selected_index_chars',
      'total_events',
      'included_events',
      'omitted_events',
      'selected_index_context_present',
      'selected_index_content_chars',
      'selected_index_materialized_chars',
      'selected_index_truncated',
      'protected_context_chars',
      'prompt_chars',
      'prompt_within_budget',
    ]) &&
    typeof value.requested === 'boolean' &&
    isNonNegativeInteger(value.max_prompt_chars) &&
    isNonNegativeInteger(value.max_ledger_events) &&
    isNonNegativeInteger(value.max_selected_index_chars) &&
    isNonNegativeInteger(value.total_events) &&
    isNonNegativeInteger(value.included_events) &&
    isNonNegativeInteger(value.omitted_events) &&
    value.included_events <= value.total_events &&
    value.omitted_events <= value.total_events &&
    typeof value.selected_index_context_present === 'boolean' &&
    isNonNegativeInteger(value.selected_index_content_chars) &&
    isNonNegativeInteger(value.selected_index_materialized_chars) &&
    value.selected_index_materialized_chars <= value.selected_index_content_chars &&
    typeof value.selected_index_truncated === 'boolean' &&
    isNonNegativeInteger(value.protected_context_chars) &&
    isNonNegativeInteger(value.prompt_chars) &&
    typeof value.prompt_within_budget === 'boolean'
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
    (value.llm_provider_failure_retry_provenance === undefined || value.llm_provider_failure_retry_provenance === null || isLlmProviderFailureRetryProvenance(value.llm_provider_failure_retry_provenance)) &&
    typeof value.created_at === 'string' &&
    typeof value.updated_at === 'string'
  );
}

export function isTaskListResult(value: unknown): value is TaskListResult {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['tasks', 'progress_overview']) &&
    Array.isArray(value.tasks) &&
    value.tasks.every(isTaskRecord) &&
    isTaskListProgressOverview(value.progress_overview) &&
    value.progress_overview.task_count === value.tasks.length
  );
}

export function isTaskListProgressOverview(value: unknown): value is TaskListProgressOverview {
  if (
    !isRecord(value) ||
    !hasOnlyFields(value, [
      'source_fingerprint',
      'aggregate_sequence',
      'task_count',
      'root_task_ids',
      'runnable_task_ids',
      'blocked_task_ids',
      'terminal_task_ids',
      'parent_join_ready_task_ids',
      'status_counts',
      'stage_counts',
      'next_action_sets',
      'blocked_sets',
      'headless_route_candidates',
      'nodes',
      'edges',
    ]) ||
    !hasNoForbiddenTaskListProgressFields(value) ||
    typeof value.source_fingerprint !== 'string' ||
    !isSha256Fingerprint(value.source_fingerprint) ||
    !isNonNegativeInteger(value.aggregate_sequence) ||
    !isNonNegativeInteger(value.task_count) ||
    !isStringArray(value.root_task_ids) ||
    !isStringArray(value.runnable_task_ids) ||
    !isStringArray(value.blocked_task_ids) ||
    !isStringArray(value.terminal_task_ids) ||
    !isStringArray(value.parent_join_ready_task_ids) ||
    !isTaskStatusCounts(value.status_counts) ||
    !Array.isArray(value.stage_counts) ||
    !value.stage_counts.every(isTaskListProgressStageCount) ||
    !Array.isArray(value.next_action_sets) ||
    !value.next_action_sets.every(isTaskListProgressNextActionSet) ||
    !Array.isArray(value.blocked_sets) ||
    !value.blocked_sets.every(isTaskListProgressBlockedSet) ||
    !Array.isArray(value.headless_route_candidates) ||
    !value.headless_route_candidates.every(isTaskListHeadlessRouteCandidate) ||
    !Array.isArray(value.nodes) ||
    !value.nodes.every(isTaskProgressGraphNode) ||
    !Array.isArray(value.edges) ||
    !value.edges.every(isTaskProgressGraphEdge)
  ) {
    return false;
  }

  const statusCount =
    value.status_counts.created +
    value.status_counts.queued +
    value.status_counts.running +
    value.status_counts.completed +
    value.status_counts.failed +
    value.status_counts.cancelled;
  return (
    statusCount === value.task_count &&
    value.nodes.length === value.task_count &&
    value.stage_counts.reduce((sum, entry) => sum + entry.task_count, 0) === value.task_count &&
    value.next_action_sets.every((entry) => entry.task_count === entry.task_ids.length) &&
    value.blocked_sets.every((entry) => entry.task_count === entry.task_ids.length) &&
    value.headless_route_candidates.every((entry) => entry.progress_fingerprint === value.source_fingerprint && entry.aggregate_sequence === value.aggregate_sequence)
  );
}

function isTaskStatusCounts(value: unknown): value is TaskStatusCounts {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['created', 'queued', 'running', 'completed', 'failed', 'cancelled']) &&
    isNonNegativeInteger(value.created) &&
    isNonNegativeInteger(value.queued) &&
    isNonNegativeInteger(value.running) &&
    isNonNegativeInteger(value.completed) &&
    isNonNegativeInteger(value.failed) &&
    isNonNegativeInteger(value.cancelled)
  );
}

function isTaskListProgressStageCount(value: unknown): value is TaskListProgressStageCount {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['current_stage', 'task_count']) &&
    isProgressCurrentStage(value.current_stage) &&
    isNonNegativeInteger(value.task_count)
  );
}

function isTaskListProgressNextActionSet(value: unknown): value is TaskListProgressNextActionSet {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['next_action', 'task_count', 'task_ids']) &&
    isProgressNextAction(value.next_action) &&
    isNonNegativeInteger(value.task_count) &&
    isStringArray(value.task_ids) &&
    value.task_count === value.task_ids.length
  );
}

function isTaskListProgressBlockedSet(value: unknown): value is TaskListProgressBlockedSet {
  return (
    isRecord(value) &&
    hasOnlyFields(value, ['current_stage', 'next_action', 'task_count', 'task_ids']) &&
    isProgressCurrentStage(value.current_stage) &&
    isProgressNextAction(value.next_action) &&
    isNonNegativeInteger(value.task_count) &&
    isStringArray(value.task_ids) &&
    value.task_count === value.task_ids.length
  );
}

function isTaskProgressGraphNode(value: unknown): value is TaskProgressGraphNode {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'task_id',
      'run_id',
      'status',
      'lifecycle_phase',
      'current_stage',
      'next_action',
      'parent_task_id',
      'parent_run_id',
      'child_task_count',
      'created_at',
      'updated_at',
    ]) &&
    hasNoForbiddenTaskListProgressFields(value) &&
    typeof value.task_id === 'string' &&
    typeof value.run_id === 'string' &&
    isTaskStatus(value.status) &&
    isProgressLifecyclePhase(value.lifecycle_phase) &&
    isProgressCurrentStage(value.current_stage) &&
    isProgressNextAction(value.next_action) &&
    (value.parent_task_id === undefined || value.parent_task_id === null || typeof value.parent_task_id === 'string') &&
    (value.parent_run_id === undefined || value.parent_run_id === null || typeof value.parent_run_id === 'string') &&
    isNonNegativeInteger(value.child_task_count) &&
    typeof value.created_at === 'string' &&
    typeof value.updated_at === 'string'
  );
}

function isTaskProgressGraphEdge(value: unknown): value is TaskProgressGraphEdge {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'parent_task_id',
      'parent_run_id',
      'child_task_id',
      'child_run_id',
      'source_candidate_id',
      'source_handoff_envelope_fingerprint',
    ]) &&
    hasNoForbiddenTaskListProgressFields(value) &&
    typeof value.parent_task_id === 'string' &&
    typeof value.parent_run_id === 'string' &&
    typeof value.child_task_id === 'string' &&
    typeof value.child_run_id === 'string' &&
    typeof value.source_candidate_id === 'string' &&
    typeof value.source_handoff_envelope_fingerprint === 'string' &&
    isSha256Fingerprint(value.source_handoff_envelope_fingerprint)
  );
}

function hasNoForbiddenTaskListProgressFields(value: Record<string, unknown>): boolean {
  return (
    hasNoForbiddenRawFields(value) &&
    !Object.prototype.hasOwnProperty.call(value, 'goal') &&
    !Object.prototype.hasOwnProperty.call(value, 'event_count') &&
    !Object.prototype.hasOwnProperty.call(value, 'events') &&
    !Object.prototype.hasOwnProperty.call(value, 'payload') &&
    !Object.prototype.hasOwnProperty.call(value, 'timeline') &&
    !Object.prototype.hasOwnProperty.call(value, 'progress_snapshot') &&
    !Object.prototype.hasOwnProperty.call(value, 'percentage') &&
    !Object.prototype.hasOwnProperty.call(value, 'percent_complete') &&
    !Object.prototype.hasOwnProperty.call(value, 'final_response') &&
    !Object.prototype.hasOwnProperty.call(value, 'final_response_preview')
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
    'test_code_executed',
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
    value.next_action === 'build_bounded_index_query_file_selection'
  );
}

export function isCodebaseIndexQueryResult(value: unknown): value is CodebaseIndexQueryResult {
  return (
    isRecord(value) &&
    hasNoForbiddenRawFields(value) &&
    !Object.prototype.hasOwnProperty.call(value, 'query') &&
    typeof value.query_id === 'string' &&
    /^query_[a-f0-9]{16}$/.test(value.query_id) &&
    typeof value.selection_id === 'string' &&
    /^selection_[a-f0-9]{16}$/.test(value.selection_id) &&
    typeof value.query_fingerprint === 'string' &&
    isSha256Fingerprint(value.query_fingerprint) &&
    isCodebaseIndexQuerySnapshotSummary(value.snapshot) &&
    isNonNegativeInteger(value.matched_entry_count) &&
    isNonNegativeInteger(value.returned_entry_count) &&
    isNonNegativeInteger(value.max_results) &&
    value.max_results > 0 &&
    value.max_results <= 50 &&
    value.returned_entry_count <= value.max_results &&
    value.matched_entry_count >= value.returned_entry_count &&
    Array.isArray(value.entries) &&
    value.entries.length === value.returned_entry_count &&
    value.entries.every(isCodebaseIndexSelectedEntry) &&
    typeof value.ledger_event_id === 'string' &&
    value.ledger_event_kind === 'CodebaseIndexQueryCompleted' &&
    value.next_action === 'read_selected_files_with_controlled_workspace_read'
  );
}

export function isCodebaseIndexSelectionReadResult(value: unknown): value is CodebaseIndexSelectionReadResult {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'query_id',
      'selection_id',
      'query_fingerprint',
      'selection_fingerprint',
      'snapshot',
      'path',
      'file_kind',
      'content',
      'truncated',
      'bytes_read',
      'content_sha256',
      'content_hash_verified',
      'ledger_event_id',
      'ledger_event_kind',
      'next_action',
    ]) &&
    hasNoForbiddenSelectedReadFields(value) &&
    typeof value.query_id === 'string' &&
    /^query_[a-f0-9]{16}$/.test(value.query_id) &&
    typeof value.selection_id === 'string' &&
    /^selection_[a-f0-9]{16}$/.test(value.selection_id) &&
    typeof value.query_fingerprint === 'string' &&
    isSha256Fingerprint(value.query_fingerprint) &&
    typeof value.selection_fingerprint === 'string' &&
    isSha256Fingerprint(value.selection_fingerprint) &&
    isCodebaseIndexQuerySnapshotSummary(value.snapshot) &&
    typeof value.path === 'string' &&
    isSafeIndexEntryPath(value.path) &&
    isCodebaseIndexFileKind(value.file_kind) &&
    typeof value.content === 'string' &&
    value.content.length <= 65536 &&
    value.truncated === false &&
    isNonNegativeInteger(value.bytes_read) &&
    value.bytes_read === utf8ByteLength(value.content) &&
    value.bytes_read <= 65536 &&
    typeof value.content_sha256 === 'string' &&
    isSha256Fingerprint(value.content_sha256) &&
    value.content_hash_verified === true &&
    typeof value.ledger_event_id === 'string' &&
    value.ledger_event_kind === 'CodebaseIndexSelectionReadCompleted' &&
    value.next_action === 'use_selected_file_context_for_prompt_materialization'
  );
}

function hasNoForbiddenSelectedReadFields(value: Record<string, unknown>): boolean {
  for (const field of ['query', 'raw_query', 'raw_content', 'full_content', 'diff', 'raw_input', 'absolute_path', 'canonical_path', 'file_content', 'stdout', 'stderr', 'env', 'command']) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      return false;
    }
  }
  return true;
}

function hasOnlyFields(value: Record<string, unknown>, allowedFields: string[]): boolean {
  const allowed = new Set(allowedFields);
  return Object.keys(value).every((field) => allowed.has(field));
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function isCodebaseIndexQuerySnapshotSummary(value: unknown): value is CodebaseIndexQuerySnapshotSummary {
  return (
    isRecord(value) &&
    hasNoForbiddenRawFields(value) &&
    !Object.prototype.hasOwnProperty.call(value, 'query') &&
    typeof value.index_id === 'string' &&
    /^idx_[a-f0-9]{16}$/.test(value.index_id) &&
    typeof value.root === 'string' &&
    isSafeIndexRoot(value.root) &&
    typeof value.workspace_fingerprint === 'string' &&
    isSha256Fingerprint(value.workspace_fingerprint) &&
    typeof value.snapshot_fingerprint === 'string' &&
    isSha256Fingerprint(value.snapshot_fingerprint) &&
    typeof value.built_at === 'string' &&
    typeof value.truncated === 'boolean'
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
    isNonNegativeInteger(value.skipped_ignored) &&
    isNonNegativeInteger(value.skipped_sensitive) &&
    isNonNegativeInteger(value.skipped_symlink) &&
    isNonNegativeInteger(value.skipped_too_large) &&
    isNonNegativeInteger(value.skipped_binary_like) &&
    isNonNegativeInteger(value.skipped_unreadable) &&
    isNonNegativeInteger(value.skipped_unsafe_path) &&
    isNonNegativeInteger(value.skipped_other) &&
    isNonNegativeInteger(value.truncated_entries) &&
    isNonNegativeInteger(value.visited_entries) &&
    isNonNegativeInteger(value.truncated_directories) &&
    isNonNegativeInteger(value.ignore_rule_files_loaded) &&
    isNonNegativeInteger(value.ignore_rule_count) &&
    isNonNegativeInteger(value.sensitive_finding_count)
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

function isCodebaseIndexSelectedEntry(value: unknown): value is CodebaseIndexSelectedEntry {
  return (
    isRecord(value) &&
    hasNoForbiddenRawFields(value) &&
    !Object.prototype.hasOwnProperty.call(value, 'query') &&
    typeof value.path === 'string' &&
    isSafeIndexEntryPath(value.path) &&
    isCodebaseIndexFileKind(value.file_kind) &&
    isNonNegativeInteger(value.byte_length) &&
    (value.line_count === undefined || value.line_count === null || isNonNegativeInteger(value.line_count)) &&
    (value.content_sha256 === undefined || value.content_sha256 === null || (typeof value.content_sha256 === 'string' && isSha256Fingerprint(value.content_sha256))) &&
    isNonNegativeInteger(value.score) &&
    value.score > 0 &&
    Array.isArray(value.match_reasons) &&
    value.match_reasons.length > 0 &&
    value.match_reasons.length <= 5 &&
    value.match_reasons.every(isCodebaseIndexMatchReason)
  );
}

function isCodebaseIndexFileKind(value: unknown): value is CodebaseIndexFileEntry['file_kind'] {
  return value === 'Rust' || value === 'TypeScript' || value === 'JavaScript' || value === 'Json' || value === 'Toml' || value === 'Markdown' || value === 'Yaml' || value === 'Shell' || value === 'Text' || value === 'Other';
}

function isCodebaseIndexMatchReason(value: unknown): value is CodebaseIndexMatchReason {
  return value === 'path_exact' || value === 'path_token' || value === 'file_name' || value === 'extension' || value === 'kind';
}

function isSafeIndexRoot(value: string): boolean {
  return value === '.' || isSafeIndexEntryPath(value);
}

function isSafeIndexEntryPath(value: string): boolean {
  if (value.length === 0 || value.length > 1024 || value.startsWith('/') || value.startsWith('~') || value.includes('\\')) {
    return false;
  }
  const parts = value.split('/');
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..' && !['.git', '.brownie', 'node_modules', 'target', 'dist', 'build', 'coverage', '.next', 'out', 'vendor'].includes(part));
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
    (value.llm_provider_failure_retry_provenance === undefined || value.llm_provider_failure_retry_provenance === null || isLlmProviderFailureRetryProvenance(value.llm_provider_failure_retry_provenance)) &&
    isNonNegativeInteger(value.event_count) &&
    typeof value.has_agent_loop_completed === 'boolean' &&
    (value.completion_final_state === undefined || value.completion_final_state === null || typeof value.completion_final_state === 'string') &&
    (value.completion_result_fingerprint === undefined || value.completion_result_fingerprint === null || typeof value.completion_result_fingerprint === 'string') &&
    (value.completion_summary_preview === undefined || value.completion_summary_preview === null || typeof value.completion_summary_preview === 'string') &&
    (value.final_response_preview === undefined || value.final_response_preview === null || typeof value.final_response_preview === 'string')
  );
}

function isProgressLifecyclePhase(value: unknown): value is ProgressLifecyclePhase {
  return value === 'created' || value === 'queued' || value === 'running' || value === 'blocked_for_explicit_action' || value === 'terminal' || value === 'unknown';
}

function isProgressCurrentStage(value: unknown): value is ProgressCurrentStage {
  return (
    value === 'created' ||
    value === 'queued' ||
    value === 'running_agent_loop' ||
    value === 'inspect_non_runnable_child_tasks' ||
    value === 'completed_with_pending_children' ||
    value === 'parent_join_ready' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled' ||
    value === 'unknown'
  );
}

function isProgressNextAction(value: unknown): value is ProgressNextAction {
  return (
    value === 'run_task_explicitly' ||
    value === 'run_parent_task_explicitly' ||
    value === 'run_remaining_child_tasks_explicitly' ||
    value === 'inspect_non_runnable_child_tasks' ||
    value === 'start_verification_recovery_explicitly' ||
    value === 'inspect_terminal_result' ||
    value === 'inspect_task'
  );
}

function isProgressVerificationState(value: unknown): value is ProgressVerificationState {
  return value === 'not_required' || value === 'pending' || value === 'passed' || value === 'failed' || value === 'unknown';
}

export function isProgressSnapshot(value: unknown): value is ProgressSnapshot {
  return (
    isRecord(value) &&
    hasOnlyFields(value, [
      'lifecycle_phase',
      'current_stage',
      'next_action',
      'source_fingerprint',
      'event_count',
      'agent_loop_terminal_evidence_present',
      'task_terminal_event_present',
      'controlled_child_count',
      'pending_controlled_child_count',
      'terminal_controlled_child_count',
      'non_runnable_controlled_child_count',
      'verification_state',
      'verifier_required',
      'verifier_failed',
      'verifier_passed',
      'recovery_signal_present',
      'apply_signal_present',
      'selected_index_context_present',
      'selected_index_context_count',
    ]) &&
    hasNoForbiddenRawFields(value) &&
    isProgressLifecyclePhase(value.lifecycle_phase) &&
    isProgressCurrentStage(value.current_stage) &&
    isProgressNextAction(value.next_action) &&
    typeof value.source_fingerprint === 'string' &&
    isSha256Fingerprint(value.source_fingerprint) &&
    isNonNegativeInteger(value.event_count) &&
    typeof value.agent_loop_terminal_evidence_present === 'boolean' &&
    typeof value.task_terminal_event_present === 'boolean' &&
    isNonNegativeInteger(value.controlled_child_count) &&
    isNonNegativeInteger(value.pending_controlled_child_count) &&
    isNonNegativeInteger(value.terminal_controlled_child_count) &&
    isNonNegativeInteger(value.non_runnable_controlled_child_count) &&
    value.pending_controlled_child_count + value.terminal_controlled_child_count + value.non_runnable_controlled_child_count <= value.controlled_child_count &&
    isProgressVerificationState(value.verification_state) &&
    typeof value.verifier_required === 'boolean' &&
    typeof value.verifier_failed === 'boolean' &&
    typeof value.verifier_passed === 'boolean' &&
    value.verifier_failed === (value.verification_state === 'failed') &&
    value.verifier_passed === (value.verification_state === 'passed') &&
    value.verifier_required === (value.verification_state !== 'not_required') &&
    typeof value.recovery_signal_present === 'boolean' &&
    typeof value.apply_signal_present === 'boolean' &&
    typeof value.selected_index_context_present === 'boolean' &&
    isNonNegativeInteger(value.selected_index_context_count) &&
    value.selected_index_context_present === (value.selected_index_context_count > 0)
  );
}

export function isRunInspectSummary(value: unknown): value is RunInspectSummary {
  return (
    isRecord(value) &&
    typeof value.run_id === 'string' &&
    (value.task_id === undefined || value.task_id === null || typeof value.task_id === 'string') &&
    (value.status === undefined || value.status === null || isTaskStatus(value.status)) &&
    isProgressSnapshot(value.progress_snapshot) &&
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
