//! JSON-RPC protocol types for Brownie VSIX/runtime communication.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: Value,
    pub method: String,
    #[serde(default)]
    pub params: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct JsonRpcResponse<T> {
    pub jsonrpc: String,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmRequestBudgetSummary {
    pub max_prompt_chars: usize,
    pub max_messages: usize,
    pub request_timeout_ms: u64,
    pub response_preview_chars: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmStatusResult {
    pub provider: String,
    pub enabled: bool,
    pub model: String,
    pub base_url: Option<String>,
    pub reason: Option<String>,
    pub strict: bool,
    pub will_fallback_to_fake: bool,
    pub task_run_network_allowed: bool,
    pub config_source: String,
    pub active_profile: Option<String>,
    pub budget: LlmRequestBudgetSummary,
    pub sensitive_guard: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RuntimeConfigGetResult {
    pub config_source: String,
    pub config_path: Option<String>,
    pub active_profile: Option<String>,
    pub llm_status: LlmStatusResult,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RuntimeDiagnosticsResult {
    pub config_source: String,
    pub active_profile: Option<String>,
    pub llm_status: LlmStatusResult,
    pub parser_config: ToolIntentParserConfigSummary,
    pub diagnostics: Vec<RuntimeDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolIntentParserConfigSummary {
    pub max_blocks: usize,
    pub max_block_bytes: usize,
    pub max_tool_requests: usize,
    pub max_input_bytes: usize,
    pub max_reason_chars: usize,
    pub max_workspace_write_content_chars: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmHealthParams {
    pub allow_network: bool,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmHealthResult {
    pub provider: String,
    pub config_source: String,
    pub active_profile: Option<String>,
    pub enabled: bool,
    pub attempted: bool,
    pub healthy: bool,
    pub model: String,
    pub base_url: Option<String>,
    pub checked_at: String,
    pub latency_ms: Option<u64>,
    pub status_code: Option<u16>,
    pub reason: Option<String>,
    pub diagnostics: Vec<RuntimeDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RuntimeDiagnostic {
    pub severity: DiagnosticSeverity,
    pub code: String,
    pub message: String,
    pub subject: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DiagnosticSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RuntimeStatus {
    pub name: String,
    pub version: String,
    pub status: RuntimeState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RuntimeState {
    Ready,
    Starting,
    Stopping,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModeSummary {
    pub mode_id: String,
    pub display_name: String,
    pub role_definition: String,
    pub permissions: ModePermissionsSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePermissionsSummary {
    pub read_only: bool,
    pub workspace_write: bool,
    pub process_exec: bool,
    pub network_access: bool,
    pub service_control: bool,
    pub destructive: bool,
    pub can_spawn_subtasks: bool,
    pub codebase_index: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModeListResult {
    pub modes: Vec<ModeSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModeGetParams {
    pub mode_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PermissionCheckParams {
    pub mode_id: String,
    pub action: RuntimeActionName,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PermissionCheckResult {
    pub mode_id: String,
    pub action: RuntimeActionName,
    pub allowed: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackActivateParams {
    pub authorize: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackReplaceActiveParams {
    pub authorize_replacement: bool,
    pub expected_current_activation_fingerprint: String,
    pub expected_candidate_activation_fingerprint: String,
    pub approved_candidate_approval_id: Option<String>,
    pub expected_approved_candidate_content_sha256: Option<String>,
    pub expected_approved_candidate_compiled_policy_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackRollbackActiveParams {
    pub authorize_rollback: bool,
    pub expected_current_activation_fingerprint: String,
    pub expected_rollback_activation_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackFetchCandidateParams {
    pub authorize_fetch: bool,
    pub url: String,
    pub expected_content_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackApproveCandidateParams {
    pub authorize_trust: bool,
    pub expected_content_sha256: String,
    pub expected_compiled_policy_fingerprint: String,
    pub expected_provenance_id: String,
    pub expected_provenance_event_id: String,
    pub expected_signer_fingerprint: String,
    pub expected_statement_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackTrustSignerParams {
    pub authorize_trust: bool,
    pub signer_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackRevokeSignerParams {
    pub authorize_revocation: bool,
    pub signer_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackVerifyCandidateProvenanceParams {
    pub authorize_provenance_verification: bool,
    pub expected_content_sha256: String,
    pub expected_compiled_policy_fingerprint: String,
    pub expected_signer_fingerprint: String,
    pub provenance_statement_json: String,
    pub provenance_signature_base64: String,
    pub provenance_public_key_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackActiveSnapshotSummary {
    pub activation_id: String,
    pub activation_fingerprint: String,
    pub modepack_name: String,
    pub schema_version: u64,
    pub source_kind: String,
    pub source_path: String,
    pub mode_count: usize,
    pub mode_ids: Vec<String>,
    pub compiled_policy_fingerprint: String,
    pub activated_at: String,
    pub activation_event_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackActivateResult {
    pub activated: bool,
    pub replayed: bool,
    pub snapshot: ModePackActiveSnapshotSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackReplaceActiveResult {
    pub replaced: bool,
    pub replayed: bool,
    pub previous_snapshot: ModePackActiveSnapshotSummary,
    pub replacement_snapshot: ModePackActiveSnapshotSummary,
    pub replacement_event_id: String,
    pub approved_candidate: Option<ModePackApprovedCandidateSummary>,
    pub candidate_consumed_event_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackRollbackActiveResult {
    pub rolled_back: bool,
    pub replayed: bool,
    pub current_snapshot: ModePackActiveSnapshotSummary,
    pub restored_snapshot: ModePackActiveSnapshotSummary,
    pub rollback_event_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackCandidateSummary {
    pub candidate_id: String,
    pub source_kind: String,
    pub source_url_host: String,
    pub source_url_fingerprint: String,
    pub content_sha256: String,
    pub byte_count: usize,
    pub modepack_name: String,
    pub schema_version: u64,
    pub mode_count: usize,
    pub mode_ids: Vec<String>,
    pub compiled_policy_fingerprint: String,
    pub cached_at: String,
    pub cache_event_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackApprovedCandidateSummary {
    pub approval_id: String,
    pub candidate_id: String,
    pub source_kind: String,
    pub source_url_host: String,
    pub source_url_fingerprint: String,
    pub content_sha256: String,
    pub modepack_name: String,
    pub schema_version: u64,
    pub mode_count: usize,
    pub mode_ids: Vec<String>,
    pub compiled_policy_fingerprint: String,
    pub provenance_id: String,
    pub provenance_event_id: String,
    #[serde(default)]
    pub trusted_signer_trust_id: String,
    #[serde(default)]
    pub trusted_signer_event_id: String,
    pub signer_fingerprint: String,
    pub statement_sha256: String,
    pub approved_at: String,
    pub approval_event_id: String,
    pub consumed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackTrustedSignerSummary {
    pub trust_id: String,
    pub signer_fingerprint: String,
    pub trusted_at: String,
    pub trust_event_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackRevokedSignerSummary {
    pub revocation_id: String,
    pub signer_fingerprint: String,
    pub trusted_signer_trust_id: String,
    pub trusted_signer_event_id: String,
    pub revoked_at: String,
    pub revocation_event_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackCandidateProvenanceSummary {
    pub provenance_id: String,
    pub candidate_id: String,
    pub source_kind: String,
    pub source_url_host: String,
    pub source_url_fingerprint: String,
    pub content_sha256: String,
    pub modepack_name: String,
    pub schema_version: u64,
    pub mode_count: usize,
    pub mode_ids: Vec<String>,
    pub compiled_policy_fingerprint: String,
    pub signer_fingerprint: String,
    pub statement_sha256: String,
    pub signature_sha256: String,
    pub verified_at: String,
    pub provenance_event_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackFetchCandidateResult {
    pub fetched: bool,
    pub replayed: bool,
    pub candidate: ModePackCandidateSummary,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackApproveCandidateResult {
    pub approved: bool,
    pub replayed: bool,
    pub approval: ModePackApprovedCandidateSummary,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackTrustSignerResult {
    pub trusted: bool,
    pub replayed: bool,
    pub trusted_signer: ModePackTrustedSignerSummary,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackRevokeSignerResult {
    pub revoked: bool,
    pub replayed: bool,
    pub revoked_signer: ModePackRevokedSignerSummary,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackVerifyCandidateProvenanceResult {
    pub verified: bool,
    pub replayed: bool,
    pub provenance: ModePackCandidateProvenanceSummary,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RuntimeActionName {
    ReadWorkspace,
    WriteWorkspace,
    ExecuteProcess,
    AccessNetwork,
    ControlService,
    DestructiveOperation,
    SpawnSubtask,
    IndexCodebase,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolPlanParams {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolPlanResult {
    pub task_id: String,
    pub run_id: String,
    pub mode_id: String,
    pub items: Vec<ToolPlanDecisionSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolPlanDecisionSummary {
    pub tool_id: String,
    pub required_action: RuntimeActionName,
    pub allowed: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolIntentParseParams {
    pub assistant_content: String,
    pub mode_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolIntentParseResult {
    pub mode_id: String,
    pub parser: ToolIntentParserSummary,
    pub items: Vec<ToolIntentDecisionSummary>,
    pub rejected: Vec<ToolIntentRejectedSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolIntentParserSummary {
    pub found_blocks: usize,
    pub accepted_blocks: usize,
    pub accepted_requests: usize,
    pub rejected_requests: usize,
    pub max_blocks: usize,
    pub max_block_bytes: usize,
    pub max_tool_requests: usize,
    pub max_input_bytes: usize,
    pub max_reason_chars: usize,
    pub max_workspace_write_content_chars: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolIntentInputSummary {
    pub has_path: bool,
    pub field_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolIntentDecisionSummary {
    pub tool_id: String,
    pub required_action: RuntimeActionName,
    pub allowed: bool,
    pub reason: String,
    pub request_reason: String,
    pub input_summary: ToolIntentInputSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolIntentRejectedSummary {
    pub tool_id: Option<String>,
    pub reason: String,
    pub code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolListResult {
    pub tools: Vec<ToolSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolSummary {
    pub tool_id: String,
    pub display_name: String,
    pub description: String,
    pub required_action: RuntimeActionName,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolExecuteParams {
    pub mode_id: String,
    pub tool_id: String,
    pub input: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolExecuteResult {
    pub tool_id: String,
    pub status: ToolExecuteStatus,
    pub output: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ToolExecuteStatus {
    Completed,
    Denied,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskStartParams {
    pub goal: String,
    pub mode_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verification_recovery_source: Option<VerificationRecoverySource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch_apply_recovery_source: Option<PatchApplyRecoverySource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verification_recovery_retry_source: Option<VerificationRecoveryRetrySource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm_provider_failure_retry_source: Option<LlmProviderFailureRetrySource>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VerificationRecoverySource {
    pub source_task_id: String,
    pub source_run_id: String,
    pub expected_failure_fingerprint: String,
    pub authorize_recovery: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PatchApplyRecoverySource {
    pub source_run_id: String,
    pub source_proposal_id: String,
    pub source_apply_id: String,
    pub expected_source_apply_fingerprint: String,
    pub expected_failure_fingerprint: String,
    pub authorize_patch_apply_recovery: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PatchApplyRecoveryRunTarget {
    pub recovery_task_id: String,
    pub recovery_run_id: String,
    pub source_run_id: String,
    pub source_proposal_id: String,
    pub source_apply_id: String,
    pub expected_source_apply_fingerprint: String,
    pub expected_failure_fingerprint: String,
    pub authorize_patch_apply_recovery_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PatchApplyRecoveryApplyTarget {
    pub recovery_task_id: String,
    pub recovery_run_id: String,
    pub source_run_id: String,
    pub source_proposal_id: String,
    pub source_apply_id: String,
    pub recovery_proposal_id: String,
    pub expected_source_apply_fingerprint: String,
    pub expected_failure_fingerprint: String,
    pub expected_target_sha256: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch_old_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch_new_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch_hunks: Option<Vec<ProposalPatchHunk>>,
    pub authorize_patch_apply_recovery_apply: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VerificationRecoveryRetrySource {
    pub source_task_id: String,
    pub source_run_id: String,
    pub recovery_task_id: String,
    pub recovery_run_id: String,
    pub proposal_id: String,
    pub apply_id: String,
    pub expected_failure_fingerprint: String,
    pub expected_apply_fingerprint: String,
    pub authorize_verification_retry: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VerificationRecoveryRunTarget {
    pub recovery_task_id: String,
    pub recovery_run_id: String,
    pub source_task_id: String,
    pub source_run_id: String,
    pub expected_failure_fingerprint: String,
    pub authorize_recovery_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VerificationRecoveryApplyTarget {
    pub source_task_id: String,
    pub source_run_id: String,
    pub recovery_task_id: String,
    pub recovery_run_id: String,
    pub proposal_id: String,
    pub expected_failure_fingerprint: String,
    pub expected_target_sha256: Option<String>,
    pub expected_target_absent: Option<bool>,
    pub replacement_content: Option<String>,
    pub authorize_recovery_apply: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VerificationRecoveryRetryRunTarget {
    pub retry_task_id: String,
    pub retry_run_id: String,
    pub proposal_id: String,
    pub apply_id: String,
    pub expected_failure_fingerprint: String,
    pub expected_apply_fingerprint: String,
    pub authorize_verification_retry_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmProviderFailureRetryRunTarget {
    pub retry_task_id: String,
    pub retry_run_id: String,
    pub source_task_id: String,
    pub source_run_id: String,
    pub expected_failure_fingerprint: String,
    pub authorize_provider_failure_retry_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmProviderFailureRetrySource {
    pub source_task_id: String,
    pub source_run_id: String,
    pub expected_failure_fingerprint: String,
    pub authorize_provider_failure_retry: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskStartResult {
    pub task_id: String,
    pub run_id: String,
    pub status: TaskStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_recovery_admission: Option<VerificationRecoveryAdmission>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub patch_apply_recovery_admission: Option<PatchApplyRecoveryAdmission>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_recovery_retry_admission: Option<VerificationRecoveryRetryAdmission>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm_provider_failure_retry_admission: Option<LlmProviderFailureRetryAdmission>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VerificationRecoveryAdmission {
    pub source_task_id: String,
    pub source_run_id: String,
    pub recovery_task_id: String,
    pub recovery_run_id: String,
    pub failure_fingerprint: String,
    pub recovery_running_enabled: bool,
    pub next_action: String,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PatchApplyRecoveryAdmission {
    pub source_run_id: String,
    pub source_proposal_id: String,
    pub source_apply_id: String,
    pub recovery_task_id: String,
    pub recovery_run_id: String,
    pub source_apply_fingerprint: String,
    pub failure_fingerprint: String,
    pub recovery_running_enabled: bool,
    pub next_action: String,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VerificationRecoveryRetryAdmission {
    pub source_task_id: String,
    pub source_run_id: String,
    pub recovery_task_id: String,
    pub recovery_run_id: String,
    pub retry_task_id: String,
    pub retry_run_id: String,
    pub proposal_id: String,
    pub apply_id: String,
    pub failure_fingerprint: String,
    pub apply_fingerprint: String,
    pub retry_running_enabled: bool,
    pub next_action: String,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmProviderFailureRetryAdmission {
    pub source_task_id: String,
    pub source_run_id: String,
    pub retry_task_id: String,
    pub retry_run_id: String,
    pub failure_fingerprint: String,
    pub failure_class: String,
    pub retryable: bool,
    pub retry_running_enabled: bool,
    pub next_action: String,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskGetParams {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TaskRunParams {
    pub task_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_index_context: Option<TaskRunSelectedIndexContext>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verification_recovery_context_read: Option<TaskRunVerificationRecoveryContextRead>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_budget: Option<TaskRunContextBudget>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TaskRunVerificationRecoveryContextRead {
    pub authorize: bool,
    pub source_task_id: String,
    pub source_run_id: String,
    pub expected_failure_fingerprint: String,
    pub diagnostic_index: usize,
    pub max_excerpt_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TaskRunContextBudget {
    pub max_prompt_chars: usize,
    pub max_ledger_events: usize,
    pub max_selected_index_chars: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ParentJoinRunTarget {
    pub authorize_parent_join_run: bool,
    pub parent_task_id: String,
    pub parent_run_id: String,
    pub expected_child_completion_fingerprint: String,
    pub expected_child_completion_child_count: usize,
    pub expected_terminal_completed_child_count: usize,
    pub expected_terminal_failed_child_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HeadlessContinueOnceParams {
    pub authorize: bool,
    pub expected_progress_fingerprint: String,
    pub expected_aggregate_sequence: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub continuation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_steps: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_budget: Option<TaskRunContextBudget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verification_recovery_source: Option<VerificationRecoverySource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verification_recovery_goal: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verification_recovery_mode_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verification_recovery_retry_source: Option<VerificationRecoveryRetrySource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verification_recovery_retry_goal: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verification_recovery_retry_mode_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm_provider_failure_retry_source: Option<LlmProviderFailureRetrySource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm_provider_failure_retry_goal: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm_provider_failure_retry_mode_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verification_recovery_run_target: Option<VerificationRecoveryRunTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verification_recovery_context_read: Option<TaskRunVerificationRecoveryContextRead>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch_apply_recovery_source: Option<PatchApplyRecoverySource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch_apply_recovery_goal: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch_apply_recovery_mode_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch_apply_recovery_run_target: Option<PatchApplyRecoveryRunTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch_apply_recovery_apply_target: Option<PatchApplyRecoveryApplyTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verification_recovery_apply_target: Option<VerificationRecoveryApplyTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verification_recovery_retry_run_target: Option<VerificationRecoveryRetryRunTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm_provider_failure_retry_run_target: Option<LlmProviderFailureRetryRunTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_join_run_target: Option<ParentJoinRunTarget>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HeadlessRunAdvanceParams {
    pub authorize: bool,
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub advance_id: Option<String>,
    pub expected_session_sequence: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_steps: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_budget: Option<TaskRunContextBudget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_progress_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_aggregate_sequence: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HeadlessRunDriveParams {
    pub authorize: bool,
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drive_id: Option<String>,
    pub expected_start_session_sequence: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_advances: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_steps_per_advance: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_budget: Option<TaskRunContextBudget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorize_completion_finalization: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_completion_closure_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TaskRunSelectedIndexContext {
    pub query_id: String,
    pub selection_id: String,
    pub query_fingerprint: String,
    pub selection_fingerprint: String,
    pub snapshot: CodebaseIndexQuerySnapshotSummary,
    pub path: String,
    pub file_kind: String,
    pub content: String,
    pub truncated: bool,
    pub bytes_read: usize,
    pub content_sha256: String,
    pub content_hash_verified: bool,
    pub ledger_event_id: String,
    pub ledger_event_kind: String,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunEventsParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunInspectParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(deny_unknown_fields)]
pub struct CodebaseIndexBuildParams {
    #[serde(default)]
    pub mode_id: Option<String>,
    #[serde(default)]
    pub root: Option<String>,
    #[serde(default)]
    pub force_refresh: Option<bool>,
    #[serde(default)]
    pub max_files: Option<usize>,
    #[serde(default)]
    pub max_directories: Option<usize>,
    #[serde(default)]
    pub max_path_chars: Option<usize>,
    #[serde(default)]
    pub max_file_bytes: Option<u64>,
    #[serde(default)]
    pub max_visited_entries: Option<usize>,
    #[serde(default)]
    pub max_directory_entries: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CodebaseIndexBuildResult {
    pub snapshot: CodebaseIndexSnapshotSummary,
    pub persisted: bool,
    pub ledger_event_id: String,
    pub ledger_event_kind: String,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CodebaseIndexQueryParams {
    pub mode_id: String,
    pub query: String,
    #[serde(default)]
    pub max_results: Option<usize>,
    #[serde(default)]
    pub file_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CodebaseIndexQueryResult {
    pub query_id: String,
    pub selection_id: String,
    pub query_fingerprint: String,
    pub snapshot: CodebaseIndexQuerySnapshotSummary,
    pub matched_entry_count: usize,
    pub returned_entry_count: usize,
    pub max_results: usize,
    pub entries: Vec<CodebaseIndexSelectedEntry>,
    pub ledger_event_id: String,
    pub ledger_event_kind: String,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CodebaseIndexSelectionReadParams {
    pub query_id: String,
    pub selection_id: String,
    pub query_fingerprint: String,
    pub snapshot: CodebaseIndexQuerySnapshotSummary,
    pub max_results: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_kind_filter: Option<String>,
    pub entries: Vec<CodebaseIndexSelectedEntry>,
    pub read_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CodebaseIndexSelectionReadResult {
    pub query_id: String,
    pub selection_id: String,
    pub query_fingerprint: String,
    pub selection_fingerprint: String,
    pub snapshot: CodebaseIndexQuerySnapshotSummary,
    pub path: String,
    pub file_kind: String,
    pub content: String,
    pub truncated: bool,
    pub bytes_read: usize,
    pub content_sha256: String,
    pub content_hash_verified: bool,
    pub ledger_event_id: String,
    pub ledger_event_kind: String,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CodebaseIndexQuerySnapshotSummary {
    pub index_id: String,
    pub root: String,
    pub workspace_fingerprint: String,
    pub snapshot_fingerprint: String,
    pub built_at: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CodebaseIndexSelectedEntry {
    pub path: String,
    pub file_kind: String,
    pub byte_length: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_count: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_sha256: Option<String>,
    pub score: usize,
    pub match_reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CodebaseIndexSnapshotManifest {
    pub snapshot: CodebaseIndexSnapshotSummary,
    pub entries: Vec<CodebaseIndexFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CodebaseIndexSnapshotSummary {
    pub index_id: String,
    pub root: String,
    pub workspace_fingerprint: String,
    pub snapshot_fingerprint: String,
    pub built_at: String,
    pub counts: CodebaseIndexCountsSummary,
    pub limits: CodebaseIndexLimitsSummary,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CodebaseIndexCountsSummary {
    pub indexed_files: usize,
    pub walked_directories: usize,
    pub skipped_protected: usize,
    pub skipped_ignored: usize,
    pub skipped_sensitive: usize,
    pub skipped_symlink: usize,
    pub skipped_too_large: usize,
    pub skipped_binary_like: usize,
    pub skipped_unreadable: usize,
    pub skipped_unsafe_path: usize,
    pub skipped_other: usize,
    pub truncated_entries: usize,
    pub visited_entries: usize,
    pub truncated_directories: usize,
    pub ignore_rule_files_loaded: usize,
    pub ignore_rule_count: usize,
    pub sensitive_finding_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CodebaseIndexLimitsSummary {
    pub max_files: usize,
    pub max_directories: usize,
    pub max_path_chars: usize,
    pub max_file_bytes: u64,
    pub max_visited_entries: usize,
    pub max_directory_entries: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CodebaseIndexFileEntry {
    pub path: String,
    pub file_kind: String,
    pub byte_length: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_count: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalListParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalInspectParams {
    pub run_id: String,
    pub proposal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalApproveParams {
    pub run_id: String,
    pub proposal_id: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalRejectParams {
    pub run_id: String,
    pub proposal_id: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalPreflightParams {
    pub run_id: String,
    pub proposal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReadinessParams {
    pub run_id: String,
    pub proposal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalApplyCapabilityParams {
    pub run_id: String,
    pub proposal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalApplyDryRunParams {
    pub run_id: String,
    pub proposal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalApplyTransactionItem {
    pub proposal_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_target_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_target_absent: Option<bool>,
    pub replacement_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalApplyTransactionRecoverySource {
    pub source_run_id: String,
    pub source_apply_id: String,
    pub source_transaction_id: String,
    pub expected_source_transaction_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalPatchHunk {
    pub old_text: String,
    pub new_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalApplyParams {
    pub run_id: String,
    pub proposal_id: String,
    pub expected_target_sha256: Option<String>,
    pub expected_target_absent: Option<bool>,
    pub replacement_content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch_old_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch_new_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch_hunks: Option<Vec<ProposalPatchHunk>>,
    pub authorize: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transaction_items: Option<Vec<ProposalApplyTransactionItem>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transaction_recovery_source: Option<ProposalApplyTransactionRecoverySource>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalApplyDryRunHistoryParams {
    pub run_id: String,
    pub proposal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalAuditTrailParams {
    pub run_id: String,
    pub proposal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewBundleParams {
    pub run_id: String,
    pub proposal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewVerdictParams {
    pub run_id: String,
    pub proposal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewReportParams {
    pub run_id: String,
    pub proposal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsHistoryParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsReportParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestHistoryParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportHistoryParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictHistoryParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskInspectParams {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmProviderFailureOutcome {
    pub provider: String,
    pub model: String,
    pub request_phase: String,
    pub failure_class: String,
    pub retryable: bool,
    pub next_action: String,
    pub failure_fingerprint: String,
    pub reason: String,
    pub reason_chars: usize,
    pub reason_truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskRunResult {
    pub task_id: String,
    pub run_id: String,
    pub status: TaskStatus,
    pub agent_loop: TaskRunAgentLoopSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_evidence: Option<TaskRunCompletionEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm_provider_failure: Option<LlmProviderFailureOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_index_prompt_context: Option<TaskRunSelectedIndexPromptContextSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_recovery_context_read: Option<TaskRunVerificationRecoveryContextReadSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_budget: Option<TaskRunContextBudgetSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_completion_gate: Option<TaskRunVerificationCompletionGate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_recovery_repair: Option<TaskRunVerificationRecoveryRepairOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub patch_apply_recovery_repair: Option<TaskRunPatchApplyRecoveryRepairOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_recovery_retry: Option<TaskRunVerificationRecoveryRetryOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery_cycle_budget_outcome: Option<RecoveryCycleBudgetOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub child_orchestration_outcome: Option<TaskRunChildOrchestrationOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_join_readiness_outcome: Option<TaskRunParentJoinReadinessOutcome>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskRunVerificationRecoveryContextReadSummary {
    pub context_read_id: String,
    pub source_task_id: String,
    pub source_run_id: String,
    pub recovery_task_id: String,
    pub recovery_run_id: String,
    pub failure_fingerprint: String,
    pub diagnostic_index: usize,
    pub tool_id: String,
    pub check_id: String,
    pub diagnostic_kind: String,
    pub severity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_name_hash: Option<String>,
    pub read_path_fingerprint: String,
    pub line: Option<usize>,
    pub column: Option<usize>,
    pub excerpt_start_line: usize,
    pub excerpt_end_line: usize,
    pub excerpt_bytes: usize,
    pub excerpt_sha256: String,
    pub excerpt_truncated: bool,
    pub prompt_preview_redacted: bool,
    pub replayed: bool,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HeadlessContinueOnceStatus {
    StaleProgress,
    NoEligibleTask,
    TaskInProgress,
    TaskExecuted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HeadlessContinueRouteKind {
    InspectProgressOverview,
    StartVerificationRecoveryExplicitly,
    RunRecoveryTaskExplicitly,
    ReviewAndAuthorizeRecoveryProposal,
    ApplyApprovedRecoveryProposalExplicitly,
    StartVerificationRetryExplicitly,
    RunVerificationRetryTaskExplicitly,
    RunLlmProviderRetryTaskExplicitly,
    RunParentTaskExplicitly,
    NoEligibleTask,
    RefreshProgressOverview,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessContinueRoute {
    pub kind: HeadlessContinueRouteKind,
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposal_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apply_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apply_fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress_fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aggregate_sequence: Option<u64>,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessContinueOnceResult {
    pub status: HeadlessContinueOnceStatus,
    pub decision_id: Option<String>,
    pub continuation_id: Option<String>,
    pub selected_task_id: Option<String>,
    pub selected_run_id: Option<String>,
    pub candidate_count: usize,
    pub expected_progress_fingerprint: String,
    pub expected_aggregate_sequence: u64,
    pub current_progress_fingerprint: String,
    pub current_aggregate_sequence: u64,
    pub post_progress_fingerprint: Option<String>,
    pub post_aggregate_sequence: Option<u64>,
    pub stale: bool,
    pub replayed: bool,
    pub task_run_result: Option<TaskRunResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposal_apply_result: Option<ProposalApplyResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm_provider_failure_retry_admission: Option<LlmProviderFailureRetryAdmission>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_route: Option<HeadlessContinueRoute>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_steps: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executed_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replayed_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub steps: Vec<HeadlessContinueStepResult>,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessContinueStepResult {
    pub step_index: u8,
    pub status: HeadlessContinueOnceStatus,
    pub decision_id: Option<String>,
    pub continuation_id: Option<String>,
    pub selected_task_id: Option<String>,
    pub selected_run_id: Option<String>,
    pub candidate_count: usize,
    pub current_progress_fingerprint: String,
    pub current_aggregate_sequence: u64,
    pub post_progress_fingerprint: Option<String>,
    pub post_aggregate_sequence: Option<u64>,
    pub replayed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_budget: Option<TaskRunContextBudgetSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_completion_evidence: Option<TaskRunCompletionEvidence>,
    pub next_route: Option<HeadlessContinueRoute>,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessRunProgressCheckpoint {
    pub progress_fingerprint: String,
    pub aggregate_sequence: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HeadlessRunCompletionClosureStatus {
    Complete,
    RoutedExplicitAction,
    BudgetExhausted,
    StaleNoProgress,
    TaskInProgress,
    NoEligibleTask,
    UnknownNonterminal,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessRunCompletionClosure {
    pub status: HeadlessRunCompletionClosureStatus,
    pub stop_reason: String,
    pub terminal_task_count: usize,
    pub total_task_count: usize,
    pub runnable_task_count: usize,
    pub blocked_task_count: usize,
    pub route_candidate_count: usize,
    pub progress_fingerprint: String,
    pub aggregate_sequence: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub route_kind: Option<HeadlessContinueRouteKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub route_task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub route_run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_completion_fingerprint: Option<String>,
    pub next_action: String,
    pub closure_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessRunCompletionFinalization {
    pub status: String,
    pub session_id: String,
    pub drive_id: String,
    pub start_session_sequence: u64,
    pub end_session_sequence: u64,
    pub closure_fingerprint: String,
    pub progress_fingerprint: String,
    pub aggregate_sequence: u64,
    pub terminal_task_count: usize,
    pub total_task_count: usize,
    pub finalization_fingerprint: String,
    pub replayed: bool,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessRunAdvanceResult {
    pub status: HeadlessContinueOnceStatus,
    pub session_id: String,
    pub advance_id: String,
    pub session_sequence: u64,
    pub replayed: bool,
    pub start_progress: HeadlessRunProgressCheckpoint,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_progress: Option<HeadlessRunProgressCheckpoint>,
    pub max_steps: u8,
    pub step_count: usize,
    pub executed_count: usize,
    pub replayed_count: usize,
    pub stop_reason: String,
    pub checkpoint_fingerprint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_completion_evidence: Option<TaskRunCompletionEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_route: Option<HeadlessContinueRoute>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub steps: Vec<HeadlessContinueStepResult>,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessRunDriveResult {
    pub status: HeadlessContinueOnceStatus,
    pub session_id: String,
    pub drive_id: String,
    pub start_session_sequence: u64,
    pub end_session_sequence: u64,
    pub replayed: bool,
    pub max_advances: u8,
    pub max_steps_per_advance: u8,
    pub advance_count: usize,
    pub executed_count: usize,
    pub replayed_count: usize,
    pub stop_reason: String,
    pub drive_fingerprint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_completion_evidence: Option<TaskRunCompletionEvidence>,
    pub completion_closure: HeadlessRunCompletionClosure,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_finalization: Option<HeadlessRunCompletionFinalization>,
    pub start_progress: HeadlessRunProgressCheckpoint,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_progress: Option<HeadlessRunProgressCheckpoint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_route: Option<HeadlessContinueRoute>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub advances: Vec<HeadlessRunAdvanceResult>,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskRunSelectedIndexPromptContextSummary {
    pub prompt_context_id: String,
    pub source_event_id: String,
    pub source_event_kind: String,
    pub query_id: String,
    pub selection_id: String,
    pub query_fingerprint: String,
    pub selection_fingerprint: String,
    pub index_id: String,
    pub workspace_fingerprint: String,
    pub snapshot_fingerprint: String,
    pub read_path_fingerprint: String,
    pub file_kind: String,
    pub bytes_read: usize,
    pub content_char_count: usize,
    pub materialized_content_char_count: usize,
    pub content_truncated_for_prompt: bool,
    pub content_sha256: String,
    pub prompt_preview_redacted: bool,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskRunContextBudgetSummary {
    pub requested: bool,
    pub max_prompt_chars: usize,
    pub max_ledger_events: usize,
    pub max_selected_index_chars: usize,
    pub total_events: usize,
    pub included_events: usize,
    pub omitted_events: usize,
    pub selected_index_context_present: bool,
    pub selected_index_content_chars: usize,
    pub selected_index_materialized_chars: usize,
    pub selected_index_truncated: bool,
    pub protected_context_chars: usize,
    pub prompt_chars: usize,
    pub prompt_within_budget: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskRunAgentLoopSummary {
    pub final_state: String,
    pub completion_summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskRunCompletionEvidence {
    pub final_state: String,
    pub task_status: TaskStatus,
    pub completion_result_fingerprint: String,
    pub completion_summary_preview: String,
    pub completion_summary_chars: usize,
    pub completion_summary_truncated: bool,
    pub final_response_present: bool,
    pub final_response_chars: usize,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BoundedCargoDiagnostic {
    pub tool_id: String,
    pub check_id: String,
    pub diagnostic_kind: String,
    pub severity: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test_name_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_relative_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column: Option<usize>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskRunVerificationCompletionGate {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requirement_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requirement_source_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_apply_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requirement_fingerprint: Option<String>,
    pub required_verifier_count: usize,
    pub passed_verifier_count: usize,
    pub failed_verifier_count: usize,
    pub required_verifier_tool_ids: Vec<String>,
    pub passed_verifier_tool_ids: Vec<String>,
    pub failed_verifier_tool_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub missing_verifier_tool_ids: Vec<String>,
    pub failure_reasons: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bounded_cargo_diagnostics: Vec<BoundedCargoDiagnostic>,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskRunVerificationRecoveryRepairOutcome {
    pub gate_status: String,
    pub source_task_id: String,
    pub source_run_id: String,
    pub recovery_task_id: String,
    pub recovery_run_id: String,
    pub failure_fingerprint: String,
    pub failed_verifier_tool_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposal_id: Option<String>,
    pub proposal_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    pub replayed: bool,
    pub apply_enabled: bool,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskRunPatchApplyRecoveryRepairOutcome {
    pub gate_status: String,
    pub source_run_id: String,
    pub source_proposal_id: String,
    pub source_apply_id: String,
    pub recovery_task_id: String,
    pub recovery_run_id: String,
    pub source_apply_fingerprint: String,
    pub failure_fingerprint: String,
    pub failure_class: String,
    pub proposal_id: Option<String>,
    pub proposal_count: usize,
    pub failure_reason: Option<String>,
    pub replayed: bool,
    pub apply_enabled: bool,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskRunVerificationRecoveryRetryOutcome {
    pub source_task_id: String,
    pub source_run_id: String,
    pub recovery_task_id: String,
    pub recovery_run_id: String,
    pub retry_task_id: String,
    pub retry_run_id: String,
    pub proposal_id: String,
    pub apply_id: String,
    pub failure_fingerprint: String,
    pub apply_fingerprint: String,
    pub retried_verifier_tool_ids: Vec<String>,
    pub passed_verifier_tool_ids: Vec<String>,
    pub failed_verifier_tool_ids: Vec<String>,
    pub retry_status: String,
    pub replayed: bool,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskRunChildOrchestrationOutcome {
    pub parent_run_id: String,
    pub materialized_child_task_ids: Vec<String>,
    pub materialized_child_count: usize,
    pub queued_child_task_ids: Vec<String>,
    pub queued_child_count: usize,
    pub child_running_enabled: bool,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskRunParentJoinReadinessOutcome {
    pub parent_task_id: String,
    pub parent_run_id: String,
    pub child_task_id: String,
    pub child_run_id: String,
    pub child_terminal_status: TaskStatus,
    pub terminal_controlled_child_count: usize,
    pub pending_controlled_child_count: usize,
    pub pending_controlled_child_task_ids: Vec<String>,
    pub non_runnable_controlled_child_count: usize,
    pub non_runnable_controlled_child_task_ids: Vec<String>,
    pub parent_join_ready: bool,
    pub parent_running_enabled: bool,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunInspectParentJoinReadinessSummary {
    pub parent_task_id: String,
    pub parent_run_id: String,
    pub terminal_controlled_child_count: usize,
    pub pending_controlled_child_count: usize,
    pub pending_controlled_child_task_ids: Vec<String>,
    pub non_runnable_controlled_child_count: usize,
    pub non_runnable_controlled_child_task_ids: Vec<String>,
    pub parent_join_ready: bool,
    pub parent_running_enabled: bool,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunInspectConsumedParentJoinRecoverySummary {
    pub parent_task_id: String,
    pub parent_run_id: String,
    pub parent_join_consumed: bool,
    pub consumed_terminal_controlled_child_count: usize,
    pub continuation_controlled_child_count: usize,
    pub continuation_runnable_child_count: usize,
    pub continuation_runnable_child_task_ids: Vec<String>,
    pub continuation_non_runnable_child_count: usize,
    pub continuation_non_runnable_child_task_ids: Vec<String>,
    pub continuation_terminal_child_count: usize,
    pub parent_running_enabled: bool,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChildInspectParentJoinReadinessSummary {
    pub parent_task_id: String,
    pub parent_run_id: String,
    pub inspected_child_task_id: String,
    pub inspected_child_run_id: String,
    pub inspected_child_status: TaskStatus,
    pub terminal_controlled_child_count: usize,
    pub pending_controlled_child_count: usize,
    pub pending_controlled_child_task_ids: Vec<String>,
    pub non_runnable_controlled_child_count: usize,
    pub non_runnable_controlled_child_task_ids: Vec<String>,
    pub parent_join_ready: bool,
    pub parent_running_enabled: bool,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChildInspectConsumedParentJoinRecoverySummary {
    pub parent_task_id: String,
    pub parent_run_id: String,
    pub inspected_child_task_id: String,
    pub inspected_child_run_id: String,
    pub inspected_child_status: TaskStatus,
    pub parent_join_consumed: bool,
    pub consumed_terminal_controlled_child_count: usize,
    pub continuation_controlled_child_count: usize,
    pub continuation_runnable_child_count: usize,
    pub continuation_runnable_child_task_ids: Vec<String>,
    pub continuation_non_runnable_child_count: usize,
    pub continuation_non_runnable_child_task_ids: Vec<String>,
    pub continuation_terminal_child_count: usize,
    pub parent_running_enabled: bool,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecoveryCycleBudgetOutcome {
    pub recovery_cycle_budget_status: String,
    pub parent_join_admission_id: String,
    pub parent_join_recovery_cycle_depth: usize,
    pub max_recovery_cycle_depth: usize,
    pub blocked_candidate_count: usize,
    pub child_materialization_enabled: bool,
    pub child_running_enabled: bool,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskListResult {
    pub tasks: Vec<TaskRecord>,
    pub progress_overview: TaskListProgressOverview,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskListProgressOverview {
    pub source_fingerprint: String,
    pub aggregate_sequence: u64,
    pub task_count: usize,
    pub root_task_ids: Vec<String>,
    pub runnable_task_ids: Vec<String>,
    pub blocked_task_ids: Vec<String>,
    pub terminal_task_ids: Vec<String>,
    pub parent_join_ready_task_ids: Vec<String>,
    pub status_counts: TaskStatusCounts,
    pub stage_counts: Vec<TaskListProgressStageCount>,
    pub next_action_sets: Vec<TaskListProgressNextActionSet>,
    pub blocked_sets: Vec<TaskListProgressBlockedSet>,
    pub headless_route_candidates: Vec<TaskListHeadlessRouteCandidate>,
    pub nodes: Vec<TaskProgressGraphNode>,
    pub edges: Vec<TaskProgressGraphEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskListHeadlessRouteCandidate {
    pub kind: HeadlessContinueRouteKind,
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposal_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apply_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apply_fingerprint: Option<String>,
    pub progress_fingerprint: String,
    pub aggregate_sequence: u64,
    pub route_fingerprint: String,
    pub priority: u8,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskStatusCounts {
    pub created: usize,
    pub queued: usize,
    pub running: usize,
    pub completed: usize,
    pub failed: usize,
    pub cancelled: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskListProgressStageCount {
    pub current_stage: ProgressCurrentStage,
    pub task_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskListProgressNextActionSet {
    pub next_action: ProgressNextAction,
    pub task_count: usize,
    pub task_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskListProgressBlockedSet {
    pub current_stage: ProgressCurrentStage,
    pub next_action: ProgressNextAction,
    pub task_count: usize,
    pub task_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskProgressGraphNode {
    pub task_id: String,
    pub run_id: String,
    pub status: TaskStatus,
    pub lifecycle_phase: ProgressLifecyclePhase,
    pub current_stage: ProgressCurrentStage,
    pub next_action: ProgressNextAction,
    pub parent_task_id: Option<String>,
    pub parent_run_id: Option<String>,
    pub child_task_count: usize,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskProgressGraphEdge {
    pub parent_task_id: String,
    pub parent_run_id: String,
    pub child_task_id: String,
    pub child_run_id: String,
    pub source_candidate_id: String,
    pub source_handoff_envelope_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunEventsResult {
    pub run_id: String,
    pub events: Vec<LedgerEventSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunInspectResult {
    pub run: RunInspectSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchProposalSummary {
    pub proposal_id: String,
    pub path: String,
    pub operation: String,
    pub content_preview: String,
    pub content_chars: usize,
    pub truncated: bool,
    pub validation_status: String,
    pub validation_reason: Option<String>,
    pub diff_preview: Option<String>,
    pub diff_truncated: bool,
    pub diff_redacted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hunk_count: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hunk_fingerprint: Option<String>,
    pub approval_status: String,
    pub approval_reason: Option<String>,
    pub approval_reason_redacted: bool,
    pub approved_at: Option<String>,
    pub rejected_at: Option<String>,
    pub latest_apply_plan: Option<WorkspacePatchApplyPlanSummary>,
    pub latest_snapshot: Option<WorkspacePatchPreflightSnapshotSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchPreflightSnapshotSummary {
    pub proposal_id: String,
    pub snapshot_id: String,
    pub path: String,
    pub canonical_path_hash: String,
    pub file_exists: bool,
    pub file_kind: String,
    pub file_size_bytes: Option<u64>,
    pub file_modified_unix_ms: Option<i64>,
    pub file_sha256: Option<String>,
    pub captured_at: String,
    pub stale: bool,
    pub stale_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchApplyPlanSummary {
    pub proposal_id: String,
    pub plan_id: String,
    pub status: String,
    pub checklist: Vec<WorkspacePatchApplyCheckSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchApplyCheckSummary {
    pub name: String,
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReadinessReportSummary {
    pub proposal_id: String,
    pub report_id: String,
    pub readiness_status: String,
    pub readiness_reason: Option<String>,
    pub readiness_fingerprint: String,
    pub fingerprint_input_count: usize,
    pub generated_at: String,
    pub checklist: Vec<WorkspacePatchReadinessCheckSummary>,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReadinessCheckSummary {
    pub name: String,
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchApplyCapabilitySummary {
    pub proposal_id: String,
    pub capability_id: String,
    pub apply_supported: bool,
    pub apply_enabled: bool,
    pub mode: String,
    pub reason: String,
    pub required_gates: Vec<String>,
    pub can_apply_now: bool,
    pub checked_at: String,
    pub check_count: usize,
    pub failed_checks: Vec<String>,
    pub blocked_checks: Vec<String>,
    pub checklist: Vec<WorkspacePatchApplyCapabilityCheckSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchApplyCapabilityCheckSummary {
    pub name: String,
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchApplyDryRunSummary {
    pub proposal_id: String,
    pub dry_run_id: String,
    pub dry_run_status: String,
    pub dry_run_reason: String,
    pub checked_at: String,
    pub required_gates: Vec<String>,
    pub check_count: usize,
    pub failed_checks: Vec<String>,
    pub blocked_checks: Vec<String>,
    pub no_patch_applied: bool,
    pub apply_executed: bool,
    pub workspace_files_changed: bool,
    pub checklist: Vec<WorkspacePatchApplyDryRunCheckSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchApplyDryRunCheckSummary {
    pub name: String,
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchApplyTransactionItemResultSummary {
    pub proposal_id: String,
    pub apply_status: String,
    pub apply_reason: String,
    pub operation: String,
    pub path: String,
    pub expected_target_sha256: Option<String>,
    pub expected_target_absent: Option<bool>,
    pub pre_write_target_sha256: Option<String>,
    pub pre_write_target_exists: Option<bool>,
    pub post_write_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_delete_target_exists: Option<bool>,
    pub content_chars: usize,
    pub content_bytes: u64,
    pub atomic_replacement_completed: bool,
    pub atomic_create_completed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub atomic_delete_completed: Option<bool>,
    pub applied: bool,
    pub temp_file_cleaned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchTransactionRecoverySourceSummary {
    pub source_run_id: String,
    pub source_apply_id: String,
    pub source_transaction_id: String,
    pub source_transaction_fingerprint: String,
    pub source_transaction_status: String,
    pub source_item_count: usize,
    pub source_applied_item_count: usize,
    pub source_recovery_item_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchApplyResultSummary {
    pub proposal_id: String,
    pub apply_id: String,
    pub apply_status: String,
    pub apply_reason: String,
    pub authorization_id: String,
    pub authorization_consumed: bool,
    pub applied: bool,
    pub operation: String,
    pub atomic_replacement_completed: bool,
    pub atomic_create_completed: bool,
    pub atomic_delete_completed: bool,
    pub path: String,
    pub expected_target_sha256: Option<String>,
    pub expected_target_absent: Option<bool>,
    pub pre_write_target_sha256: Option<String>,
    pub pre_write_target_exists: Option<bool>,
    pub post_write_sha256: Option<String>,
    pub post_delete_target_exists: Option<bool>,
    pub content_chars: usize,
    pub content_bytes: u64,
    pub checked_at: String,
    pub applied_at: Option<String>,
    pub temp_file_cleaned: bool,
    pub check_count: usize,
    pub failed_checks: Vec<String>,
    pub blocked_checks: Vec<String>,
    pub checklist: Vec<WorkspacePatchApplyResultCheckSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transaction_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transaction_status: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub transaction_items: Vec<WorkspacePatchApplyTransactionItemResultSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transaction_recovery_source: Option<WorkspacePatchTransactionRecoverySourceSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transaction_recovery_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchApplyResultCheckSummary {
    pub name: String,
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchApplyDryRunHistoryEntry {
    pub proposal_id: String,
    pub dry_run_id: String,
    pub dry_run_status: String,
    pub dry_run_reason: String,
    pub checked_at: String,
    pub required_gates: Vec<String>,
    pub check_count: usize,
    pub failed_checks: Vec<String>,
    pub blocked_checks: Vec<String>,
    pub no_patch_applied: bool,
    pub apply_executed: bool,
    pub workspace_files_changed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchApplyDryRunHistorySummary {
    pub proposal_id: String,
    pub dry_run_count: usize,
    pub latest_dry_run: Option<WorkspacePatchApplyDryRunHistoryEntry>,
    pub dry_runs: Vec<WorkspacePatchApplyDryRunHistoryEntry>,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchAuditTrailEntry {
    pub event_id: String,
    pub audit_event: String,
    pub event_kind: String,
    pub timestamp: String,
    pub proposal_id: String,
    pub summary: String,
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchAuditTrailSummary {
    pub proposal_id: String,
    pub event_count: usize,
    pub latest_event: Option<WorkspacePatchAuditTrailEntry>,
    pub events: Vec<WorkspacePatchAuditTrailEntry>,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewSignalSummary {
    pub status: String,
    pub reason: Option<String>,
    pub generated_at: Option<String>,
    pub source_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewBundleSummary {
    pub proposal_id: String,
    pub review_status: String,
    pub review_reason: String,
    pub latest_readiness: Option<WorkspacePatchReviewSignalSummary>,
    pub latest_apply_capability: Option<WorkspacePatchReviewSignalSummary>,
    pub latest_apply_dry_run: Option<WorkspacePatchReviewSignalSummary>,
    pub audit_event_count: usize,
    pub latest_audit_event: Option<WorkspacePatchAuditTrailEntry>,
    pub required_next_actions: Vec<String>,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewVerdictSummary {
    pub proposal_id: String,
    pub verdict_status: String,
    pub verdict_reason: String,
    pub evidence_status: String,
    pub blocking_reasons: Vec<String>,
    pub missing_signals: Vec<String>,
    pub latest_review_bundle_status: String,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewReportSummary {
    pub proposal_id: String,
    pub report_status: String,
    pub report_reason: String,
    pub review_bundle: WorkspacePatchReviewBundleSummary,
    pub review_verdict: WorkspacePatchReviewVerdictSummary,
    pub audit_event_count: usize,
    pub recent_audit_events: Vec<WorkspacePatchAuditTrailEntry>,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueItemSummary {
    pub proposal_id: String,
    pub path: String,
    pub validation_status: String,
    pub approval_status: String,
    pub report_status: String,
    pub report_reason: String,
    pub verdict_status: String,
    pub review_status: String,
    pub audit_event_count: usize,
    pub latest_audit_event: Option<WorkspacePatchAuditTrailEntry>,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueSummary {
    pub run_id: String,
    pub queue_status: String,
    pub queue_reason: String,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub items: Vec<WorkspacePatchReviewQueueItemSummary>,
    pub required_next_actions: Vec<String>,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsCheckSummary {
    pub name: String,
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsSummary {
    pub run_id: String,
    pub diagnostics_status: String,
    pub diagnostics_reason: String,
    pub queue_status: String,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub check_count: usize,
    pub failed_checks: Vec<String>,
    pub blocked_checks: Vec<String>,
    pub checks: Vec<WorkspacePatchReviewQueueDiagnosticsCheckSummary>,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsHistoryEntrySummary {
    pub diagnostics_id: String,
    pub diagnostics_status: String,
    pub queue_status: String,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_checks: Vec<String>,
    pub blocked_checks: Vec<String>,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsHistorySummary {
    pub run_id: String,
    pub history_status: String,
    pub history_reason: String,
    pub diagnostics_count: usize,
    pub latest_diagnostics: Option<WorkspacePatchReviewQueueDiagnosticsHistoryEntrySummary>,
    pub entries: Vec<WorkspacePatchReviewQueueDiagnosticsHistoryEntrySummary>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsReportSummary {
    pub run_id: String,
    pub report_status: String,
    pub report_reason: String,
    pub queue_status: String,
    pub diagnostics_status: String,
    pub diagnostics_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_checks: Vec<String>,
    pub blocked_checks: Vec<String>,
    pub required_next_actions: Vec<String>,
    pub latest_diagnostics: Option<WorkspacePatchReviewQueueDiagnosticsHistoryEntrySummary>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestSummary {
    pub run_id: String,
    pub digest_status: String,
    pub digest_reason: String,
    pub queue_status: String,
    pub diagnostics_status: String,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestHistoryEntrySummary {
    pub digest_id: String,
    pub digest_status: String,
    pub queue_status: String,
    pub diagnostics_status: String,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestHistorySummary {
    pub run_id: String,
    pub history_status: String,
    pub history_reason: String,
    pub digest_count: usize,
    pub latest_digest: Option<WorkspacePatchReviewQueueDiagnosticsDigestHistoryEntrySummary>,
    pub entries: Vec<WorkspacePatchReviewQueueDiagnosticsDigestHistoryEntrySummary>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportSummary {
    pub run_id: String,
    pub report_status: String,
    pub report_reason: String,
    pub digest_status: String,
    pub history_status: String,
    pub digest_count: usize,
    pub latest_digest: Option<WorkspacePatchReviewQueueDiagnosticsDigestHistoryEntrySummary>,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportHistoryEntrySummary {
    pub report_id: String,
    pub report_status: String,
    pub digest_status: String,
    pub history_status: String,
    pub digest_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportHistorySummary {
    pub run_id: String,
    pub history_status: String,
    pub history_reason: String,
    pub report_count: usize,
    pub latest_report: Option<WorkspacePatchReviewQueueDiagnosticsDigestReportHistoryEntrySummary>,
    pub entries: Vec<WorkspacePatchReviewQueueDiagnosticsDigestReportHistoryEntrySummary>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictSummary {
    pub run_id: String,
    pub verdict_status: String,
    pub verdict_reason: String,
    pub history_status: String,
    pub report_status: String,
    pub report_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistoryEntrySummary {
    pub verdict_id: String,
    pub verdict_status: String,
    pub history_status: String,
    pub report_status: String,
    pub report_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistorySummary {
    pub run_id: String,
    pub history_status: String,
    pub history_reason: String,
    pub verdict_count: usize,
    pub latest_verdict:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistoryEntrySummary>,
    pub entries: Vec<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistoryEntrySummary>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportSummary {
    pub run_id: String,
    pub report_status: String,
    pub report_reason: String,
    pub history_status: String,
    pub verdict_status: String,
    pub verdict_count: usize,
    pub latest_verdict:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistoryEntrySummary>,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryEntrySummary {
    pub report_id: String,
    pub report_status: String,
    pub history_status: String,
    pub verdict_status: String,
    pub verdict_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistorySummary {
    pub run_id: String,
    pub history_status: String,
    pub history_reason: String,
    pub report_count: usize,
    pub latest_report:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryEntrySummary>,
    pub entries:
        Vec<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryEntrySummary>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestSummary {
    pub run_id: String,
    pub digest_status: String,
    pub digest_reason: String,
    pub history_status: String,
    pub report_status: String,
    pub report_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryEntrySummary
{
    pub digest_id: String,
    pub digest_status: String,
    pub history_status: String,
    pub report_status: String,
    pub report_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistorySummary {
    pub run_id: String,
    pub history_status: String,
    pub history_reason: String,
    pub digest_count: usize,
    pub latest_digest:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryEntrySummary>,
    pub entries:
        Vec<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryEntrySummary>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportSummary {
    pub run_id: String,
    pub report_status: String,
    pub report_reason: String,
    pub history_status: String,
    pub digest_status: String,
    pub digest_count: usize,
    pub latest_digest:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryEntrySummary>,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryEntrySummary
{
    pub report_id: String,
    pub report_status: String,
    pub history_status: String,
    pub digest_status: String,
    pub digest_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistorySummary {
    pub run_id: String,
    pub history_status: String,
    pub history_reason: String,
    pub report_count: usize,
    pub latest_report:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryEntrySummary>,
    pub entries:
        Vec<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryEntrySummary>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestSummary
{
    pub run_id: String,
    pub digest_status: String,
    pub digest_reason: String,
    pub history_status: String,
    pub report_status: String,
    pub report_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary
{
    pub digest_id: String,
    pub digest_status: String,
    pub history_status: String,
    pub report_status: String,
    pub report_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistorySummary
{
    pub run_id: String,
    pub history_status: String,
    pub history_reason: String,
    pub digest_count: usize,
    pub latest_digest:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary>,
    pub entries:
        Vec<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary
{
    pub run_id: String,
    pub report_status: String,
    pub report_reason: String,
    pub history_status: String,
    pub digest_status: String,
    pub digest_count: usize,
    pub latest_digest:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary>,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary
{
    pub report_id: String,
    pub report_status: String,
    pub history_status: String,
    pub digest_status: String,
    pub digest_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary
{
    pub run_id: String,
    pub history_status: String,
    pub history_reason: String,
    pub report_count: usize,
    pub latest_report:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary>,
    pub entries:
        Vec<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary
{
    pub run_id: String,
    pub digest_status: String,
    pub digest_reason: String,
    pub history_status: String,
    pub report_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary
{
    pub digest_id: String,
    pub digest_status: String,
    pub history_status: String,
    pub report_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary
{
    pub run_id: String,
    pub history_status: String,
    pub history_reason: String,
    pub digest_count: usize,
    pub latest_digest:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary>,
    pub entries:
        Vec<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary
{
    pub run_id: String,
    pub report_status: String,
    pub report_reason: String,
    pub history_status: String,
    pub digest_status: String,
    pub digest_count: usize,
    pub latest_digest:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary>,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary
{
    pub report_id: String,
    pub report_status: String,
    pub history_status: String,
    pub digest_status: String,
    pub digest_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary
{
    pub run_id: String,
    pub history_status: String,
    pub history_reason: String,
    pub report_count: usize,
    pub latest_report:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary>,
    pub entries:
        Vec<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary
{
    pub run_id: String,
    pub digest_status: String,
    pub digest_reason: String,
    pub history_status: String,
    pub report_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary
{
    pub digest_id: String,
    pub digest_status: String,
    pub history_status: String,
    pub report_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary
{
    pub run_id: String,
    pub history_status: String,
    pub history_reason: String,
    pub digest_count: usize,
    pub latest_digest:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary>,
    pub entries:
        Vec<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary
{
    pub run_id: String,
    pub report_status: String,
    pub report_reason: String,
    pub history_status: String,
    pub digest_status: String,
    pub digest_count: usize,
    pub latest_digest:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary>,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary
{
    pub report_id: String,
    pub report_status: String,
    pub history_status: String,
    pub digest_status: String,
    pub digest_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary
{
    pub run_id: String,
    pub history_status: String,
    pub history_reason: String,
    pub report_count: usize,
    pub latest_report:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary>,
    pub entries:
        Vec<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary
{
    pub run_id: String,
    pub digest_status: String,
    pub digest_reason: String,
    pub history_status: String,
    pub report_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary
{
    pub digest_id: String,
    pub digest_status: String,
    pub history_status: String,
    pub report_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary
{
    pub run_id: String,
    pub history_status: String,
    pub history_reason: String,
    pub digest_count: usize,
    pub latest_digest:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary>,
    pub entries:
        Vec<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary
{
    pub run_id: String,
    pub report_status: String,
    pub report_reason: String,
    pub history_status: String,
    pub digest_count: usize,
    pub latest_digest:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary>,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary
{
    pub report_id: String,
    pub report_status: String,
    pub history_status: String,
    pub digest_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary
{
    pub run_id: String,
    pub history_status: String,
    pub history_reason: String,
    pub report_count: usize,
    pub latest_report:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary>,
    pub entries:
        Vec<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary
{
    pub run_id: String,
    pub digest_status: String,
    pub digest_reason: String,
    pub history_status: String,
    pub report_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary
{
    pub digest_id: String,
    pub digest_status: String,
    pub history_status: String,
    pub report_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary
{
    pub run_id: String,
    pub history_status: String,
    pub history_reason: String,
    pub digest_count: usize,
    pub latest_digest:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary>,
    pub entries:
        Vec<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary
{
    pub run_id: String,
    pub report_status: String,
    pub report_reason: String,
    pub history_status: String,
    pub digest_count: usize,
    pub latest_digest:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary>,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary
{
    pub report_id: String,
    pub report_status: String,
    pub history_status: String,
    pub digest_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary
{
    pub run_id: String,
    pub history_status: String,
    pub history_reason: String,
    pub report_count: usize,
    pub latest_report:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary>,
    pub entries:
        Vec<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary
{
    pub run_id: String,
    pub digest_status: String,
    pub digest_reason: String,
    pub history_status: String,
    pub report_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary
{
    pub digest_id: String,
    pub digest_status: String,
    pub history_status: String,
    pub report_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary {
    pub run_id: String,
    pub report_status: String,
    pub report_reason: String,
    pub history_status: String,
    pub digest_count: usize,
    pub latest_digest:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary>,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary
{
    pub report_id: String,
    pub report_status: String,
    pub history_status: String,
    pub digest_count: usize,
    pub proposal_count: usize,
    pub complete_count: usize,
    pub needs_action_count: usize,
    pub blocked_count: usize,
    pub failed_check_count: usize,
    pub blocked_check_count: usize,
    pub required_next_action_count: usize,
    pub required_next_actions: Vec<String>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary
{
    pub run_id: String,
    pub history_status: String,
    pub history_reason: String,
    pub report_count: usize,
    pub latest_report:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary>,
    pub entries:
        Vec<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryEntrySummary>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary
{
    pub run_id: String,
    pub history_status: String,
    pub history_reason: String,
    pub digest_count: usize,
    pub latest_digest:
        Option<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary>,
    pub entries:
        Vec<WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryEntrySummary>,
    pub apply_authorized: bool,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalListResult {
    pub run_id: String,
    pub proposals: Vec<WorkspacePatchProposalSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalInspectResult {
    pub proposal: WorkspacePatchProposalSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalApproveResult {
    pub proposal: WorkspacePatchProposalSummary,
    pub apply_plan: WorkspacePatchApplyPlanSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalRejectResult {
    pub proposal: WorkspacePatchProposalSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalPreflightResult {
    pub proposal: WorkspacePatchProposalSummary,
    pub snapshot: WorkspacePatchPreflightSnapshotSummary,
    pub apply_plan: WorkspacePatchApplyPlanSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReadinessResult {
    pub proposal: WorkspacePatchProposalSummary,
    pub report: WorkspacePatchReadinessReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalApplyCapabilityResult {
    pub proposal: WorkspacePatchProposalSummary,
    pub capability: WorkspacePatchApplyCapabilitySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalApplyDryRunResult {
    pub proposal: WorkspacePatchProposalSummary,
    pub dry_run: WorkspacePatchApplyDryRunSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalApplyResult {
    pub proposal: WorkspacePatchProposalSummary,
    pub apply_result: WorkspacePatchApplyResultSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalApplyDryRunHistoryResult {
    pub proposal: WorkspacePatchProposalSummary,
    pub history: WorkspacePatchApplyDryRunHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalAuditTrailResult {
    pub proposal: WorkspacePatchProposalSummary,
    pub audit_trail: WorkspacePatchAuditTrailSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewBundleResult {
    pub proposal: WorkspacePatchProposalSummary,
    pub review_bundle: WorkspacePatchReviewBundleSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewVerdictResult {
    pub proposal: WorkspacePatchProposalSummary,
    pub review_verdict: WorkspacePatchReviewVerdictSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewReportResult {
    pub proposal: WorkspacePatchProposalSummary,
    pub review_report: WorkspacePatchReviewReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueResult {
    pub review_queue: WorkspacePatchReviewQueueSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsResult {
    pub review_queue_diagnostics: WorkspacePatchReviewQueueDiagnosticsSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsHistoryResult {
    pub review_queue_diagnostics_history: WorkspacePatchReviewQueueDiagnosticsHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsReportResult {
    pub review_queue_diagnostics_report: WorkspacePatchReviewQueueDiagnosticsReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestResult {
    pub review_queue_diagnostics_digest: WorkspacePatchReviewQueueDiagnosticsDigestSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestHistoryResult {
    pub review_queue_diagnostics_digest_history:
        WorkspacePatchReviewQueueDiagnosticsDigestHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportResult {
    pub review_queue_diagnostics_digest_report:
        WorkspacePatchReviewQueueDiagnosticsDigestReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportHistoryResult {
    pub review_queue_diagnostics_digest_report_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictResult {
    pub review_queue_diagnostics_digest_report_verdict:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportResult {
    pub review_queue_diagnostics_digest_report_verdict_report:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskInspectResult {
    pub task: TaskRecord,
    pub run: RunInspectSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_join_readiness_summary: Option<ChildInspectParentJoinReadinessSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consumed_parent_join_recovery_summary:
        Option<ChildInspectConsumedParentJoinRecoverySummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunInspectSummary {
    pub run_id: String,
    pub task_id: Option<String>,
    pub status: Option<TaskStatus>,
    pub progress_snapshot: ProgressSnapshot,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery_cycle_budget_outcome: Option<RecoveryCycleBudgetOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_join_readiness_summary: Option<RunInspectParentJoinReadinessSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consumed_parent_join_recovery_summary: Option<RunInspectConsumedParentJoinRecoverySummary>,
    pub child_task_count: usize,
    pub child_task_ids: Vec<String>,
    pub child_tasks: Vec<ChildTaskInspectSummary>,
    pub event_count: usize,
    pub has_tool_execution_completed: bool,
    pub has_subtask_orchestration_queued: bool,
    pub subtask_queue_count: usize,
    pub has_subtask_handoff_prepared: bool,
    pub subtask_handoff_count: usize,
    pub has_subtask_scheduler_readiness: bool,
    pub subtask_scheduler_readiness_count: usize,
    pub has_subtask_dispatch_plan_prepared: bool,
    pub subtask_dispatch_plan_count: usize,
    pub has_subtask_dispatch_contract_prepared: bool,
    pub subtask_dispatch_contract_count: usize,
    pub has_subtask_dispatch_admission_evaluated: bool,
    pub subtask_dispatch_admission_count: usize,
    pub has_subtask_dispatch_readiness_snapshot: bool,
    pub subtask_dispatch_readiness_snapshot_count: usize,
    pub has_subtask_dispatcher_guard_verdict: bool,
    pub subtask_dispatcher_guard_verdict_count: usize,
    pub has_subtask_dispatch_decision: bool,
    pub subtask_dispatch_decision_count: usize,
    pub has_subtask_dispatch_candidate_manifest: bool,
    pub subtask_dispatch_candidate_manifest_count: usize,
    pub has_subtask_dispatch_handoff_envelope: bool,
    pub subtask_dispatch_handoff_envelope_count: usize,
    pub has_second_pass: bool,
    pub final_response_preview: Option<String>,
    pub timeline: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProgressSnapshot {
    pub lifecycle_phase: ProgressLifecyclePhase,
    pub current_stage: ProgressCurrentStage,
    pub next_action: ProgressNextAction,
    pub source_fingerprint: String,
    pub event_count: usize,
    pub agent_loop_terminal_evidence_present: bool,
    pub task_terminal_event_present: bool,
    pub controlled_child_count: usize,
    pub pending_controlled_child_count: usize,
    pub terminal_controlled_child_count: usize,
    pub non_runnable_controlled_child_count: usize,
    pub verification_state: ProgressVerificationState,
    pub verifier_required: bool,
    pub verifier_failed: bool,
    pub verifier_passed: bool,
    pub recovery_signal_present: bool,
    pub apply_signal_present: bool,
    pub selected_index_context_present: bool,
    pub selected_index_context_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProgressLifecyclePhase {
    Created,
    Queued,
    Running,
    BlockedForExplicitAction,
    Terminal,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProgressCurrentStage {
    Created,
    Queued,
    RunningAgentLoop,
    InspectNonRunnableChildTasks,
    CompletedWithPendingChildren,
    ParentJoinReady,
    Completed,
    Failed,
    Cancelled,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProgressNextAction {
    RunTaskExplicitly,
    RunParentTaskExplicitly,
    RunRemainingChildTasksExplicitly,
    InspectNonRunnableChildTasks,
    StartVerificationRecoveryExplicitly,
    InspectTerminalResult,
    InspectTask,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProgressVerificationState {
    NotRequired,
    Pending,
    Passed,
    Failed,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChildTaskInspectSummary {
    pub task_id: String,
    pub run_id: String,
    pub status: TaskStatus,
    pub parent_task_id: Option<String>,
    pub parent_run_id: Option<String>,
    pub source_candidate_id: Option<String>,
    pub source_handoff_envelope_id: Option<String>,
    pub source_handoff_envelope_fingerprint: Option<String>,
    pub source_intent_summary: Option<ChildTaskSourceIntentSummary>,
    pub recovery_cycle_provenance: Option<RecoveryCycleChildProvenance>,
    pub verification_recovery_provenance: Option<VerificationRecoveryProvenance>,
    pub verification_recovery_retry_provenance: Option<VerificationRecoveryRetryProvenance>,
    pub llm_provider_failure_retry_provenance: Option<LlmProviderFailureRetryProvenance>,
    pub event_count: usize,
    pub has_agent_loop_completed: bool,
    pub completion_final_state: Option<String>,
    pub completion_result_fingerprint: Option<String>,
    pub completion_summary_preview: Option<String>,
    pub final_response_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChildTaskSourceIntentSummary {
    pub tool_id: String,
    pub required_action: RuntimeActionName,
    pub request_reason: String,
    pub requested_goal_preview: Option<String>,
    pub requested_mode_id: Option<String>,
    pub input_summary: ToolIntentInputSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecoveryCycleChildProvenance {
    pub parent_join_admission_id: String,
    pub parent_join_child_completion_fingerprint: String,
    pub parent_join_child_completion_child_count: usize,
    pub parent_join_terminal_failed_child_count: usize,
    pub parent_join_terminal_completed_child_count: usize,
    pub parent_join_recovery_cycle: bool,
    pub parent_join_recovery_cycle_depth: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VerificationRecoveryProvenance {
    pub source_task_id: String,
    pub source_run_id: String,
    pub failure_fingerprint: String,
    pub required_verifier_count: usize,
    pub passed_verifier_count: usize,
    pub failed_verifier_count: usize,
    pub failed_verifier_tool_ids: Vec<String>,
    pub failure_reasons: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bounded_cargo_diagnostics: Vec<BoundedCargoDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PatchApplyRecoveryProvenance {
    pub source_run_id: String,
    pub source_proposal_id: String,
    pub source_apply_id: String,
    pub source_apply_fingerprint: String,
    pub failure_fingerprint: String,
    pub failure_class: String,
    pub operation: String,
    pub path: String,
    pub hunk_count: Option<usize>,
    pub hunk_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VerificationRecoveryRetryProvenance {
    pub source_task_id: String,
    pub source_run_id: String,
    pub recovery_task_id: String,
    pub recovery_run_id: String,
    pub proposal_id: String,
    pub apply_id: String,
    pub failure_fingerprint: String,
    pub apply_fingerprint: String,
    pub retried_verifier_tool_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmProviderFailureRetryProvenance {
    pub source_task_id: String,
    pub source_run_id: String,
    pub failure_fingerprint: String,
    pub failure_class: String,
    pub provider: String,
    pub model: String,
    pub request_phase: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LedgerEventSummary {
    pub event_id: String,
    pub task_id: String,
    pub run_id: String,
    pub kind: String,
    pub timestamp: String,
    pub payload: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskRecord {
    pub task_id: String,
    pub run_id: String,
    pub goal: String,
    pub mode_id: Option<String>,
    pub status: TaskStatus,
    pub parent_task_id: Option<String>,
    pub parent_run_id: Option<String>,
    pub source_candidate_id: Option<String>,
    pub source_handoff_envelope_id: Option<String>,
    pub source_handoff_envelope_fingerprint: Option<String>,
    pub source_intent_summary: Option<ChildTaskSourceIntentSummary>,
    #[serde(default)]
    pub recovery_cycle_provenance: Option<RecoveryCycleChildProvenance>,
    #[serde(default)]
    pub verification_recovery_provenance: Option<VerificationRecoveryProvenance>,
    #[serde(default)]
    pub patch_apply_recovery_provenance: Option<PatchApplyRecoveryProvenance>,
    #[serde(default)]
    pub verification_recovery_retry_provenance: Option<VerificationRecoveryRetryProvenance>,
    #[serde(default)]
    pub llm_provider_failure_retry_provenance: Option<LlmProviderFailureRetryProvenance>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TaskStatus {
    Created,
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}
