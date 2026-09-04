//! JSON-RPC protocol types for Brownie VSIX/runtime communication.
#![recursion_limit = "256"]

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub mod semantic_contract;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: Value,
    pub method: String,
    #[serde(default)]
    pub params: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct JsonRpcResponse<T> {
    pub jsonrpc: String,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct LlmRequestBudgetSummary {
    pub max_prompt_chars: usize,
    pub max_messages: usize,
    pub request_timeout_ms: u64,
    pub response_preview_chars: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct RuntimeConfigGetResult {
    pub config_source: String,
    pub config_path: Option<String>,
    pub active_profile: Option<String>,
    pub llm_status: LlmStatusResult,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct RuntimeDiagnosticsResult {
    pub config_source: String,
    pub active_profile: Option<String>,
    pub llm_status: LlmStatusResult,
    pub parser_config: ToolIntentParserConfigSummary,
    pub diagnostics: Vec<RuntimeDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ToolIntentParserConfigSummary {
    pub max_blocks: usize,
    pub max_block_bytes: usize,
    pub max_tool_requests: usize,
    pub max_input_bytes: usize,
    pub max_reason_chars: usize,
    pub max_workspace_write_content_chars: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct LlmHealthParams {
    pub allow_network: bool,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct RuntimeDiagnostic {
    pub severity: DiagnosticSeverity,
    pub code: String,
    pub message: String,
    pub subject: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub enum DiagnosticSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct RuntimeStatus {
    pub name: String,
    pub version: String,
    pub status: RuntimeState,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub enum RuntimeState {
    Ready,
    Starting,
    Stopping,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ModeSummary {
    pub mode_id: String,
    pub display_name: String,
    pub role_definition: String,
    pub permissions: ModePermissionsSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ModePermissionsSummary {
    pub read_only: bool,
    pub workspace_write: bool,
    pub process_exec: bool,
    #[serde(default)]
    pub git_inspect: bool,
    #[serde(default)]
    pub git_commit: bool,
    pub network_access: bool,
    pub service_control: bool,
    pub destructive: bool,
    pub can_spawn_subtasks: bool,
    pub codebase_index: bool,
    #[serde(default)]
    pub mcp_tool_access: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ModeListResult {
    pub modes: Vec<ModeSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ModeGetParams {
    pub mode_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PermissionCheckParams {
    pub mode_id: String,
    pub action: RuntimeActionName,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct PermissionCheckResult {
    pub mode_id: String,
    pub action: RuntimeActionName,
    pub allowed: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ModePackActivateParams {
    pub authorize: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ModePackReplaceActiveParams {
    pub authorize_replacement: bool,
    pub expected_current_activation_fingerprint: String,
    pub expected_candidate_activation_fingerprint: String,
    pub approved_candidate_approval_id: Option<String>,
    pub expected_approved_candidate_content_sha256: Option<String>,
    pub expected_approved_candidate_compiled_policy_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_approved_candidate_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_approved_candidate_source_url_host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_approved_candidate_source_url_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_approved_candidate_dns_resolution_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_approved_candidate_pinned_address_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_approved_candidate_approval_event_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub update_admission: Option<ModePackUpdateAdmissionParams>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ModePackUpdateAdmissionParams {
    pub authorize_update: bool,
    pub expected_current_modepack_name: String,
    pub expected_current_source_kind: String,
    pub expected_approved_candidate_provenance_id: String,
    pub expected_approved_candidate_provenance_event_id: String,
    pub expected_approved_candidate_signer_fingerprint: String,
    pub expected_approved_candidate_statement_sha256: String,
    pub expected_trusted_signer_trust_id: String,
    pub expected_trusted_signer_event_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ModePackRollbackActiveParams {
    pub authorize_rollback: bool,
    pub expected_current_activation_fingerprint: String,
    pub expected_rollback_activation_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ModePackFetchCandidateParams {
    pub authorize_fetch: bool,
    pub url: String,
    pub expected_content_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ModePackSelectRegistryUpdateParams {
    pub authorize_registry_selection: bool,
    pub authorize_registry_trust: bool,
    pub registry_url: String,
    pub expected_registry_manifest_sha256: String,
    pub expected_current_activation_fingerprint: String,
    pub expected_registry_provenance_statement_sha256: String,
    pub expected_registry_signer_fingerprint: String,
    pub expected_registry_trusted_signer_trust_id: String,
    pub expected_registry_trusted_signer_event_id: String,
    pub registry_provenance_statement_json: String,
    pub registry_provenance_signature_base64: String,
    pub registry_provenance_public_key_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ModePackRegistryUpdateSelectionTarget {
    pub authorize_modepack_registry_update_selection: bool,
    pub authorize_registry_trust: bool,
    pub registry_url: String,
    pub expected_registry_manifest_sha256: String,
    pub expected_current_activation_fingerprint: String,
    pub expected_registry_provenance_statement_sha256: String,
    pub expected_registry_signer_fingerprint: String,
    pub expected_registry_trusted_signer_trust_id: String,
    pub expected_registry_trusted_signer_event_id: String,
    pub registry_provenance_statement_json: String,
    pub registry_provenance_signature_base64: String,
    pub registry_provenance_public_key_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ModePackSelectedCandidateFetchTarget {
    pub authorize_selected_candidate_fetch: bool,
    pub selection_id: String,
    pub selection_event_id: String,
    pub expected_registry_manifest_sha256: String,
    pub expected_candidate_url_fingerprint: String,
    pub expected_candidate_content_sha256: String,
    pub expected_candidate_compiled_policy_fingerprint: String,
    pub expected_provenance_statement_url_fingerprint: String,
    pub expected_provenance_statement_sha256: String,
    pub expected_signer_fingerprint: String,
    pub expected_current_activation_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ModePackSelectedCandidateProvenanceVerificationTarget {
    pub authorize_selected_candidate_provenance_verification: bool,
    pub fetch_continuation_id: String,
    pub expected_fetch_decision_id: String,
    pub selection_id: String,
    pub selection_event_id: String,
    pub expected_candidate_url_fingerprint: String,
    pub expected_candidate_content_sha256: String,
    pub expected_candidate_compiled_policy_fingerprint: String,
    pub expected_provenance_statement_url_fingerprint: String,
    pub expected_provenance_statement_sha256: String,
    pub expected_signer_fingerprint: String,
    pub expected_current_activation_fingerprint: String,
    pub provenance_statement_json: String,
    pub provenance_signature_base64: String,
    pub provenance_public_key_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ModePackSelectedCandidateApprovalTarget {
    pub authorize_selected_candidate_approval: bool,
    pub fetch_continuation_id: String,
    pub expected_fetch_decision_id: String,
    pub provenance_verification_continuation_id: String,
    pub expected_provenance_verification_decision_id: String,
    pub selection_id: String,
    pub selection_event_id: String,
    pub expected_candidate_url_fingerprint: String,
    pub expected_candidate_content_sha256: String,
    pub expected_candidate_compiled_policy_fingerprint: String,
    pub expected_provenance_id: String,
    pub expected_provenance_event_id: String,
    pub expected_provenance_statement_url_fingerprint: String,
    pub expected_provenance_statement_sha256: String,
    pub expected_signer_fingerprint: String,
    pub expected_current_activation_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ModePackSelectedApprovedCandidateReplacementTarget {
    pub authorize_selected_candidate_replacement: bool,
    pub fetch_continuation_id: String,
    pub expected_fetch_decision_id: String,
    pub provenance_verification_continuation_id: String,
    pub expected_provenance_verification_decision_id: String,
    pub approval_continuation_id: String,
    pub expected_approval_decision_id: String,
    pub selection_id: String,
    pub selection_event_id: String,
    pub expected_candidate_url_fingerprint: String,
    pub expected_candidate_content_sha256: String,
    pub expected_candidate_compiled_policy_fingerprint: String,
    pub expected_candidate_activation_fingerprint: String,
    pub expected_provenance_id: String,
    pub expected_provenance_event_id: String,
    pub expected_provenance_statement_url_fingerprint: String,
    pub expected_provenance_statement_sha256: String,
    pub expected_signer_fingerprint: String,
    pub expected_current_activation_fingerprint: String,
    pub expected_approved_candidate_id: String,
    pub expected_approved_candidate_approval_id: String,
    pub expected_approved_candidate_approval_event_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ModePackSelectedActiveRollbackTarget {
    pub authorize_selected_active_modepack_rollback: bool,
    pub replacement_event_id: String,
    pub expected_current_activation_fingerprint: String,
    pub expected_rollback_activation_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ModePackApproveCandidateParams {
    pub authorize_trust: bool,
    pub expected_content_sha256: String,
    pub expected_compiled_policy_fingerprint: String,
    pub expected_provenance_id: String,
    pub expected_provenance_event_id: String,
    pub expected_signer_fingerprint: String,
    pub expected_statement_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ModePackTrustSignerParams {
    pub authorize_trust: bool,
    pub signer_fingerprint: String,
    #[serde(default)]
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ModePackRevokeSignerParams {
    pub authorize_revocation: bool,
    pub signer_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ModePackVerifyCandidateProvenanceParams {
    pub authorize_provenance_verification: bool,
    pub expected_content_sha256: String,
    pub expected_compiled_policy_fingerprint: String,
    pub expected_signer_fingerprint: String,
    pub provenance_statement_json: String,
    pub provenance_signature_base64: String,
    pub provenance_public_key_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ModePackDnsBindingSummary {
    pub resolution_fingerprint: String,
    pub pinned_address_fingerprint: String,
    pub resolved_address_count: usize,
    pub pinned_address_family: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ModePackActiveSnapshotSummary {
    pub activation_id: String,
    pub activation_fingerprint: String,
    pub modepack_name: String,
    pub schema_version: u64,
    pub source_kind: String,
    pub source_path: String,
    pub mode_count: usize,
    pub mode_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_entrypoint: Option<String>,
    pub compiled_policy_fingerprint: String,
    pub activated_at: String,
    pub activation_event_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ModePackActivateResult {
    pub activated: bool,
    pub replayed: bool,
    pub snapshot: ModePackActiveSnapshotSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ModePackReplaceActiveResult {
    pub replaced: bool,
    pub replayed: bool,
    pub previous_snapshot: ModePackActiveSnapshotSummary,
    pub replacement_snapshot: ModePackActiveSnapshotSummary,
    pub replacement_event_id: String,
    pub approved_candidate: Option<ModePackApprovedCandidateSummary>,
    pub candidate_consumed_event_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub update_admission: Option<ModePackUpdateAdmissionSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ModePackRollbackActiveResult {
    pub rolled_back: bool,
    pub replayed: bool,
    pub current_snapshot: ModePackActiveSnapshotSummary,
    pub restored_snapshot: ModePackActiveSnapshotSummary,
    pub rollback_event_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ModePackCandidateSummary {
    pub candidate_id: String,
    pub source_kind: String,
    pub source_url_host: String,
    pub source_url_fingerprint: String,
    pub dns_binding: ModePackDnsBindingSummary,
    pub content_sha256: String,
    pub byte_count: usize,
    pub modepack_name: String,
    pub schema_version: u64,
    pub mode_count: usize,
    pub mode_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_entrypoint: Option<String>,
    pub compiled_policy_fingerprint: String,
    pub cached_at: String,
    pub cache_event_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ModePackApprovedCandidateSummary {
    pub approval_id: String,
    pub candidate_id: String,
    pub source_kind: String,
    pub source_url_host: String,
    pub source_url_fingerprint: String,
    #[serde(default)]
    pub dns_binding: Option<ModePackDnsBindingSummary>,
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ModePackTrustedSignerSummary {
    pub trust_id: String,
    pub signer_fingerprint: String,
    pub trusted_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    pub trust_event_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ModePackRevokedSignerSummary {
    pub revocation_id: String,
    pub signer_fingerprint: String,
    pub trusted_signer_trust_id: String,
    pub trusted_signer_event_id: String,
    pub revoked_at: String,
    pub revocation_event_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ModePackUpdateAdmissionSummary {
    pub update_id: String,
    pub current_activation_fingerprint: String,
    pub replacement_activation_fingerprint: String,
    pub modepack_name: String,
    pub source_kind: String,
    pub approval_id: String,
    pub candidate_id: String,
    pub source_url_host: String,
    pub source_url_fingerprint: String,
    pub dns_binding: ModePackDnsBindingSummary,
    pub content_sha256: String,
    pub compiled_policy_fingerprint: String,
    pub provenance_id: String,
    pub provenance_event_id: String,
    pub trusted_signer_trust_id: String,
    pub trusted_signer_event_id: String,
    pub signer_fingerprint: String,
    pub statement_sha256: String,
    pub admitted_at: String,
    pub admission_event_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ModePackCandidateProvenanceSummary {
    pub provenance_id: String,
    pub candidate_id: String,
    pub source_kind: String,
    pub source_url_host: String,
    pub source_url_fingerprint: String,
    #[serde(default)]
    pub dns_binding: Option<ModePackDnsBindingSummary>,
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ModePackFetchCandidateResult {
    pub fetched: bool,
    pub replayed: bool,
    pub candidate: ModePackCandidateSummary,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ModePackRegistryUpdateSelectionSummary {
    pub selection_id: String,
    pub registry_url_host: String,
    pub registry_url_fingerprint: String,
    pub registry_dns_binding: ModePackDnsBindingSummary,
    pub registry_manifest_sha256: String,
    pub registry_provenance_statement_sha256: String,
    pub registry_signer_fingerprint: String,
    pub registry_trusted_signer_trust_id: String,
    pub registry_trusted_signer_event_id: String,
    pub current_activation_fingerprint: String,
    pub current_modepack_name: String,
    pub current_source_kind: String,
    pub candidate_url: String,
    pub candidate_url_host: String,
    pub candidate_url_fingerprint: String,
    pub candidate_content_sha256: String,
    pub candidate_compiled_policy_fingerprint: String,
    pub provenance_statement_url: String,
    pub provenance_statement_url_host: String,
    pub provenance_statement_url_fingerprint: String,
    pub provenance_statement_sha256: String,
    pub signer_fingerprint: String,
    pub selected_at: String,
    pub selection_event_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ModePackSelectRegistryUpdateResult {
    pub selected: bool,
    pub replayed: bool,
    pub selection: ModePackRegistryUpdateSelectionSummary,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ModePackApproveCandidateResult {
    pub approved: bool,
    pub replayed: bool,
    pub approval: ModePackApprovedCandidateSummary,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ModePackTrustSignerResult {
    pub trusted: bool,
    pub replayed: bool,
    pub trusted_signer: ModePackTrustedSignerSummary,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ModePackRevokeSignerResult {
    pub revoked: bool,
    pub replayed: bool,
    pub revoked_signer: ModePackRevokedSignerSummary,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ModePackVerifyCandidateProvenanceResult {
    pub verified: bool,
    pub replayed: bool,
    pub provenance: ModePackCandidateProvenanceSummary,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub enum RuntimeActionName {
    ReadWorkspace,
    WriteWorkspace,
    ExecuteProcess,
    AccessNetwork,
    ControlService,
    DestructiveOperation,
    SpawnSubtask,
    IndexCodebase,
    UseMcpTool,
    UseGitInspectCapability,
    UseGitCommitCapability,
    UseGitCapability,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ToolPlanParams {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ToolPlanResult {
    pub task_id: String,
    pub run_id: String,
    pub mode_id: String,
    pub items: Vec<ToolPlanDecisionSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ToolPlanDecisionSummary {
    pub tool_id: String,
    pub required_action: RuntimeActionName,
    pub allowed: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ToolIntentParseParams {
    pub assistant_content: String,
    pub mode_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ToolIntentParseResult {
    pub mode_id: String,
    pub parser: ToolIntentParserSummary,
    pub items: Vec<ToolIntentDecisionSummary>,
    pub rejected: Vec<ToolIntentRejectedSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ToolIntentInputSummary {
    pub has_path: bool,
    pub field_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ToolIntentDecisionSummary {
    pub tool_id: String,
    pub required_action: RuntimeActionName,
    pub allowed: bool,
    pub reason: String,
    pub request_reason: String,
    pub input_summary: ToolIntentInputSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ToolIntentRejectedSummary {
    pub tool_id: Option<String>,
    pub reason: String,
    pub code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ToolListResult {
    pub tools: Vec<ToolSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ToolSummary {
    pub tool_id: String,
    pub display_name: String,
    pub description: String,
    pub required_action: RuntimeActionName,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ToolExecuteParams {
    pub mode_id: String,
    pub tool_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    pub input: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ToolExecuteResult {
    pub tool_id: String,
    pub status: ToolExecuteStatus,
    pub output: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct McpToolApprovalApproveParams {
    pub mode_id: String,
    pub task_id: String,
    pub tool_id: String,
    pub input: serde_json::Value,
    pub approve: bool,
    pub approval_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct McpToolApprovalApproveResult {
    pub tool_id: String,
    pub status: String,
    pub mcp_approval_binding: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub enum ToolExecuteStatus {
    Completed,
    Denied,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_continuation_source: Option<ProductContinuationSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct VerificationRecoverySource {
    pub source_task_id: String,
    pub source_run_id: String,
    pub expected_failure_fingerprint: String,
    pub authorize_recovery: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct PatchApplyRecoverySource {
    pub source_run_id: String,
    pub source_proposal_id: String,
    pub source_apply_id: String,
    pub expected_source_apply_fingerprint: String,
    pub expected_failure_fingerprint: String,
    pub authorize_patch_apply_recovery: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct VerificationRecoveryRunTarget {
    pub recovery_task_id: String,
    pub recovery_run_id: String,
    pub source_task_id: String,
    pub source_run_id: String,
    pub expected_failure_fingerprint: String,
    pub authorize_recovery_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct VerificationRecoveryRetryRunTarget {
    pub retry_task_id: String,
    pub retry_run_id: String,
    pub proposal_id: String,
    pub apply_id: String,
    pub expected_failure_fingerprint: String,
    pub expected_apply_fingerprint: String,
    pub authorize_verification_retry_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct LlmProviderFailureRetryRunTarget {
    pub retry_task_id: String,
    pub retry_run_id: String,
    pub source_task_id: String,
    pub source_run_id: String,
    pub expected_failure_fingerprint: String,
    pub authorize_provider_failure_retry_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct LlmProviderFailureRetrySource {
    pub source_task_id: String,
    pub source_run_id: String,
    pub expected_failure_fingerprint: String,
    pub authorize_provider_failure_retry: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProductContinuationSource {
    pub source_task_id: String,
    pub source_run_id: String,
    pub source_decision_id: String,
    pub expected_decision_fingerprint: String,
    pub expected_accepted_completion_fingerprint: String,
    pub expected_terminal_completion_fingerprint: String,
    pub expected_completion_closure_fingerprint: String,
    pub expected_product_evidence_fingerprint: String,
    pub authorize_product_continuation: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProductContinuationAdmissionTarget {
    pub authorize_product_continuation_admission: bool,
    pub product_continuation_source: ProductContinuationSource,
    pub continuation_goal: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub continuation_mode_id: Option<String>,
    #[serde(default)]
    pub runtime_derived_objective: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProductContinuationRunTarget {
    pub authorize_product_continuation_run: bool,
    pub continuation_task_id: String,
    pub continuation_run_id: String,
    pub source_task_id: String,
    pub source_run_id: String,
    pub source_decision_id: String,
    pub expected_decision_fingerprint: String,
    pub expected_product_evidence_fingerprint: String,
    pub expected_admission_route_kind: HeadlessContinueRouteKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_admission_request_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProductContinuationDerivedTarget {
    pub authorize_product_continuation_target_derivation: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub continuation_goal: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub continuation_mode_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProductLoopStopRecoveryTarget {
    pub authorize_product_loop_stop_recovery: bool,
    pub session_id: String,
    pub drive_id: String,
    pub expected_drive_fingerprint: String,
    pub expected_stop_reason: String,
    pub expected_end_session_sequence: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_post_progress_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_next_route_fingerprint: Option<String>,
    pub recovery_goal: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery_mode_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product_continuation_admission: Option<ProductContinuationAdmission>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProductContinuationAdmission {
    pub source_task_id: String,
    pub source_run_id: String,
    pub source_decision_id: String,
    pub continuation_task_id: String,
    pub continuation_run_id: String,
    pub decision_fingerprint: String,
    pub product_evidence_fingerprint: String,
    pub continuation_running_enabled: bool,
    pub next_action: String,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TaskGetParams {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TaskCancelParams {
    pub task_id: String,
    pub run_id: String,
    pub expected_status: TaskStatus,
    pub expected_task_updated_at: String,
    pub cancel_id: String,
    pub authorize_cancel: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct TaskCancelResult {
    pub task_id: String,
    pub run_id: String,
    pub status: TaskStatus,
    pub replayed: bool,
    pub cancel_id: String,
    pub cancel_fingerprint: String,
    pub ledger_event_kind: String,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TaskRunParams {
    pub task_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_deadline: Option<RuntimeDeadline>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_index_context: Option<TaskRunSelectedIndexContext>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verification_recovery_context_read: Option<TaskRunVerificationRecoveryContextRead>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_budget: Option<TaskRunContextBudget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completion_acceptance: Option<TaskRunCompletionAcceptanceRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TaskRunCompletionAcceptanceRequest {
    pub authorize_completion_acceptance: bool,
    pub source_run_id: String,
    pub acceptance_id: String,
    pub expected_completion_result_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TaskRunVerificationRecoveryContextRead {
    pub authorize: bool,
    pub source_task_id: String,
    pub source_run_id: String,
    pub expected_failure_fingerprint: String,
    pub diagnostic_index: usize,
    pub max_excerpt_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TaskRunContextBudget {
    pub max_prompt_chars: usize,
    pub max_ledger_events: usize,
    pub max_selected_index_chars: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ObjectiveProposalAuthorizationPreflightTarget {
    pub authorize_objective_proposal_preflight: bool,
    pub journey_id: String,
    pub session_id: String,
    pub source_drive_id: String,
    pub expected_journey_fingerprint: String,
    pub expected_candidate_fingerprint: String,
    pub expected_objective_context_fingerprint: String,
    pub expected_selected_context_fingerprint: String,
    pub expected_task_id: String,
    pub expected_run_id: String,
    pub expected_proposal_id: String,
    pub expected_source_event_id: String,
    pub expected_source_event_kind: String,
    pub expected_operation: String,
    pub expected_path_fingerprint: String,
    pub expected_validation_status: String,
    pub expected_approval_status: String,
    pub authorization_token_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ObjectiveProposalApplyTarget {
    pub authorize_objective_proposal_apply: bool,
    pub authorization_preflight_continuation_id: String,
    pub expected_authorization_preflight_decision_id: String,
    pub journey_id: String,
    pub session_id: String,
    pub source_drive_id: String,
    pub expected_journey_fingerprint: String,
    pub expected_candidate_fingerprint: String,
    pub expected_objective_context_fingerprint: String,
    pub expected_selected_context_fingerprint: String,
    pub expected_task_id: String,
    pub expected_run_id: String,
    pub expected_proposal_id: String,
    pub expected_source_event_id: String,
    pub expected_source_event_kind: String,
    pub expected_operation: String,
    pub expected_path_fingerprint: String,
    pub expected_validation_status: String,
    pub expected_approval_status: String,
    pub expected_authorization_preflight_fingerprint: String,
    pub expected_preflight_snapshot_id: String,
    pub expected_apply_plan_id: String,
    pub expected_target_sha256: String,
    pub replacement_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ObjectiveApplyVerificationTarget {
    pub authorize_objective_apply_verification: bool,
    pub objective_apply_continuation_id: String,
    pub expected_objective_apply_decision_id: String,
    pub journey_id: String,
    pub session_id: String,
    pub source_drive_id: String,
    pub expected_task_id: String,
    pub expected_run_id: String,
    pub expected_proposal_id: String,
    pub expected_apply_id: String,
    pub expected_operation: String,
    pub expected_apply_status: String,
    pub expected_authorization_consumed: bool,
    pub expected_path_fingerprint: String,
    pub expected_apply_fingerprint: String,
    pub expected_post_write_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ObjectiveCompletionAcceptanceTarget {
    pub authorize_objective_completion_acceptance: bool,
    pub objective_apply_verification_continuation_id: String,
    pub expected_objective_apply_verification_decision_id: String,
    pub journey_id: String,
    pub session_id: String,
    pub source_drive_id: String,
    pub expected_task_id: String,
    pub expected_run_id: String,
    pub expected_proposal_id: String,
    pub expected_apply_id: String,
    pub expected_operation: String,
    pub expected_apply_status: String,
    pub expected_authorization_consumed: bool,
    pub expected_path_fingerprint: String,
    pub expected_apply_fingerprint: String,
    pub expected_post_write_sha256: String,
    pub expected_current_target_sha256: String,
    pub expected_verification_status: String,
    pub expected_verification_route_kind: HeadlessContinueRouteKind,
    pub expected_verification_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HeadlessContinueOnceParams {
    pub authorize: bool,
    pub expected_progress_fingerprint: String,
    pub expected_aggregate_sequence: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub continuation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub continuation_scope: Option<HeadlessContinueScope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_steps: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_budget: Option<TaskRunContextBudget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_index_context: Option<TaskRunSelectedIndexContext>,
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
    pub product_continuation_admission_target: Option<ProductContinuationAdmissionTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_continuation_run_target: Option<ProductContinuationRunTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_loop_stop_recovery_target: Option<ProductLoopStopRecoveryTarget>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub objective_proposal_authorization_preflight_target:
        Option<ObjectiveProposalAuthorizationPreflightTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub objective_proposal_apply_target: Option<ObjectiveProposalApplyTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub objective_apply_verification_target: Option<ObjectiveApplyVerificationTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub objective_completion_acceptance_target: Option<ObjectiveCompletionAcceptanceTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modepack_registry_update_selection_target: Option<ModePackRegistryUpdateSelectionTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modepack_selected_candidate_fetch_target: Option<ModePackSelectedCandidateFetchTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modepack_selected_candidate_provenance_verification_target:
        Option<ModePackSelectedCandidateProvenanceVerificationTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modepack_selected_candidate_approval_target:
        Option<ModePackSelectedCandidateApprovalTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modepack_selected_approved_candidate_replacement_target:
        Option<ModePackSelectedApprovedCandidateReplacementTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modepack_selected_active_rollback_target: Option<ModePackSelectedActiveRollbackTarget>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HeadlessContinueScope {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id_prefix: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub journey_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(default)]
    pub latest_matching_session: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HeadlessRunAdvanceParams {
    pub authorize: bool,
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub advance_id: Option<String>,
    pub expected_session_sequence: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub continuation_scope: Option<HeadlessContinueScope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_steps: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_budget: Option<TaskRunContextBudget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_index_context: Option<TaskRunSelectedIndexContext>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_continuation_admission_target: Option<ProductContinuationAdmissionTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_continuation_run_target: Option<ProductContinuationRunTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_continuation_derived_target: Option<ProductContinuationDerivedTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_join_run_target: Option<ParentJoinRunTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_progress_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_aggregate_sequence: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modepack_registry_update_selection_target: Option<ModePackRegistryUpdateSelectionTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modepack_selected_candidate_fetch_target: Option<ModePackSelectedCandidateFetchTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modepack_selected_candidate_provenance_verification_target:
        Option<ModePackSelectedCandidateProvenanceVerificationTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modepack_selected_candidate_approval_target:
        Option<ModePackSelectedCandidateApprovalTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modepack_selected_approved_candidate_replacement_target:
        Option<ModePackSelectedApprovedCandidateReplacementTarget>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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
    pub product_continuation_admission_target: Option<ProductContinuationAdmissionTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_continuation_run_target: Option<ProductContinuationRunTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_continuation_derived_target: Option<ProductContinuationDerivedTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorize_completion_finalization: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_completion_closure_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_evidence_derivation: Option<HeadlessRunProductEvidenceDerivationRequest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_product_gap_closure: Option<HeadlessRunSelectedProductGapClosureRequest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_completion_decision: Option<HeadlessRunProductCompletionDecisionRequest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_join_run_target: Option<ParentJoinRunTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modepack_registry_update_selection_target: Option<ModePackRegistryUpdateSelectionTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modepack_selected_candidate_fetch_target: Option<ModePackSelectedCandidateFetchTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modepack_selected_candidate_provenance_verification_target:
        Option<ModePackSelectedCandidateProvenanceVerificationTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modepack_selected_candidate_approval_target:
        Option<ModePackSelectedCandidateApprovalTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modepack_selected_approved_candidate_replacement_target:
        Option<ModePackSelectedApprovedCandidateReplacementTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub journey_admission: Option<HeadlessRunJourneyAdmission>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub journey_route_resume: Option<HeadlessRunJourneyRouteResume>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub journey_closure: Option<HeadlessRunJourneyClosure>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub journey_execution: Option<HeadlessRunJourneyExecution>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HeadlessRunProductCompletionDecisionRequest {
    pub authorize_product_completion_decision: bool,
    pub decision_id: String,
    pub expected_accepted_completion_fingerprint: String,
    pub expected_terminal_completion_fingerprint: String,
    pub expected_completion_closure_fingerprint: String,
    pub expected_product_evidence_fingerprint: String,
    pub evidence_status: String,
    pub target_capability: String,
    pub concrete_capability_transition: String,
    #[serde(default)]
    pub validated_gate_categories: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derived_product_evidence_matrix_fingerprint: Option<String>,
    pub behavior_evidence_count: usize,
    pub rejected_alternatives_count: usize,
    pub safety_boundary_reviewed: bool,
    pub non_goals_reviewed: bool,
    pub technical_debt_reviewed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remaining_capability: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub milestone_exit_rationale: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub technical_debt_carry_forward: Option<Vec<TechnicalDebtCarryForwardItem>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub technical_debt_transitions: Option<Vec<TechnicalDebtTransition>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HeadlessRunProductEvidenceDerivationRequest {
    pub authorize_product_evidence_derivation: bool,
    pub derivation_id: String,
    pub phase_id: String,
    pub milestone: String,
    pub expected_accepted_completion_fingerprint: String,
    pub expected_terminal_completion_fingerprint: String,
    pub expected_completion_closure_fingerprint: String,
    pub project_completion_policy: HeadlessRunProductEvidenceArtifactSource,
    #[serde(default)]
    pub artifacts: Vec<HeadlessRunProductEvidenceArtifactSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HeadlessRunSelectedProductGapClosureRequest {
    pub authorize_selected_product_gap_closure: bool,
    pub closure_id: String,
    pub source_decision_id: String,
    pub expected_source_decision_fingerprint: String,
    pub expected_product_evidence_fingerprint: String,
    pub expected_selected_remaining_gap_fingerprint: String,
    pub expected_product_objective_fingerprint: String,
    pub expected_accepted_completion_fingerprint: String,
    pub expected_terminal_completion_fingerprint: String,
    pub expected_completion_closure_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct HeadlessRunSelectedProductGapClosureEvidence {
    pub closure_id: String,
    pub task_id: String,
    pub run_id: String,
    pub acceptance_id: String,
    pub source_decision_id: String,
    pub source_decision_fingerprint: String,
    pub product_evidence_fingerprint: String,
    pub product_objective_fingerprint: String,
    pub selected_remaining_gap: HeadlessRunProductRemainingGapSelection,
    pub accepted_completion_fingerprint: String,
    pub terminal_completion_fingerprint: String,
    pub completion_closure_fingerprint: String,
    pub closure_evidence_fingerprint: String,
    pub status: String,
    pub next_action: String,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HeadlessRunProductEvidenceArtifactSource {
    pub path: String,
    pub expected_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HeadlessRunJourneyAdmission {
    pub journey_id: String,
    pub authorize_journey_start: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub admission_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_start: Option<HeadlessRunJourneyTaskStartEnvelope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub objective_context: Option<HeadlessRunJourneyObjectiveContext>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_objective_continuation_source: Option<ProductObjectiveContinuationJourneySource>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HeadlessRunJourneyRouteResume {
    pub journey_id: String,
    pub authorize_journey_route_resume: bool,
    pub expected_journey_fingerprint: String,
    pub expected_route_kind: HeadlessContinueRouteKind,
    pub expected_source_checkpoint_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HeadlessRunJourneyClosure {
    pub journey_id: String,
    pub authorize_journey_closure: bool,
    pub expected_journey_fingerprint: String,
    pub source_replacement_drive_id: String,
    pub expected_replacement_resume_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HeadlessRunJourneyExecution {
    pub journey_id: String,
    pub authorize_journey_execution: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_journey_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_start: Option<HeadlessRunJourneyTaskStartEnvelope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_execution_checkpoint_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HeadlessRunJourneyTaskStartEnvelope {
    pub goal: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HeadlessRunRecoveryProbeParams {
    pub authorize_recovery_probe: bool,
    pub session_id: String,
    pub drive_id: String,
    pub journey_id: String,
    pub objective_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct HeadlessRunRecoveryProbeResult {
    pub admission_state: String,
    pub session_id: String,
    pub drive_id: String,
    pub journey_id: String,
    pub objective_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub journey_fingerprint: Option<String>,
    pub recovery_recommendation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_runtime_invocation: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProductObjectiveContinuationJourneySource {
    pub continuation_task_id: String,
    pub continuation_run_id: String,
    pub source_task_id: String,
    pub source_run_id: String,
    pub source_decision_id: String,
    pub expected_decision_fingerprint: String,
    pub expected_accepted_completion_fingerprint: String,
    pub expected_terminal_completion_fingerprint: String,
    pub expected_completion_closure_fingerprint: String,
    pub expected_product_evidence_fingerprint: String,
    pub expected_remaining_capability_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_selected_remaining_gap_fingerprint: Option<String>,
    pub expected_derived_objective_fingerprint: String,
    pub expected_derived_goal_fingerprint: String,
    pub authorize_product_objective_journey_admission: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HeadlessRunJourneyObjectiveContext {
    pub authorize_objective_context_admission: bool,
    pub objective_id: String,
    pub objective_fingerprint: String,
    pub selected_index_context: TaskRunSelectedIndexContext,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RunEventsParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RunInspectParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq, Default)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct CodebaseIndexBuildResult {
    pub snapshot: CodebaseIndexSnapshotSummary,
    pub persisted: bool,
    pub ledger_event_id: String,
    pub ledger_event_kind: String,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CodebaseIndexQueryParams {
    pub mode_id: String,
    pub query: String,
    #[serde(default)]
    pub max_results: Option<usize>,
    #[serde(default)]
    pub file_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct CodebaseIndexQuerySnapshotSummary {
    pub index_id: String,
    pub root: String,
    pub workspace_fingerprint: String,
    pub snapshot_fingerprint: String,
    pub built_at: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct CodebaseIndexSnapshotManifest {
    pub snapshot: CodebaseIndexSnapshotSummary,
    pub entries: Vec<CodebaseIndexFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct CodebaseIndexLimitsSummary {
    pub max_files: usize,
    pub max_directories: usize,
    pub max_path_chars: usize,
    pub max_file_bytes: u64,
    pub max_visited_entries: usize,
    pub max_directory_entries: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct CodebaseIndexFileEntry {
    pub path: String,
    pub file_kind: String,
    pub byte_length: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_count: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalListParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalInspectParams {
    pub run_id: String,
    pub proposal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalApproveParams {
    pub run_id: String,
    pub proposal_id: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalRejectParams {
    pub run_id: String,
    pub proposal_id: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalPreflightParams {
    pub run_id: String,
    pub proposal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReadinessParams {
    pub run_id: String,
    pub proposal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalApplyCapabilityParams {
    pub run_id: String,
    pub proposal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalApplyDryRunParams {
    pub run_id: String,
    pub proposal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalApplyTransactionItem {
    pub proposal_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_target_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_target_absent: Option<bool>,
    pub replacement_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalApplyTransactionRecoverySource {
    pub source_run_id: String,
    pub source_apply_id: String,
    pub source_transaction_id: String,
    pub expected_source_transaction_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalPatchHunk {
    pub old_text: String,
    pub new_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalApplyDryRunHistoryParams {
    pub run_id: String,
    pub proposal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalAuditTrailParams {
    pub run_id: String,
    pub proposal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewBundleParams {
    pub run_id: String,
    pub proposal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewVerdictParams {
    pub run_id: String,
    pub proposal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewReportParams {
    pub run_id: String,
    pub proposal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsHistoryParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsReportParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestHistoryParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportHistoryParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictHistoryParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryParams
{
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TaskInspectParams {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RuntimeDeadline {
    pub deadline_id: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct TaskRunResult {
    pub task_id: String,
    pub run_id: String,
    pub status: TaskStatus,
    pub agent_loop: TaskRunAgentLoopSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_evidence: Option<TaskRunCompletionEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_acceptance: Option<TaskRunCompletionAcceptance>,
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HeadlessContinueOnceStatus {
    StaleProgress,
    NoEligibleTask,
    TaskInProgress,
    TaskExecuted,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HeadlessContinueRouteKind {
    InspectProgressOverview,
    StartVerificationRecoveryExplicitly,
    RunRecoveryTaskExplicitly,
    ReviewAndAuthorizeRecoveryProposal,
    ReviewAndAuthorizeObjectiveProposal,
    ApplyApprovedRecoveryProposalExplicitly,
    ApplyAuthorizedObjectiveProposalExplicitly,
    VerifyObjectiveApplyExplicitly,
    AcceptObjectiveCompletionExplicitly,
    StartVerificationRetryExplicitly,
    RunVerificationRetryTaskExplicitly,
    RunLlmProviderRetryTaskExplicitly,
    AdmitProductContinuationTaskExplicitly,
    RunProductContinuationTaskExplicitly,
    FetchSelectedModePackCandidateExplicitly,
    VerifySelectedModePackCandidateProvenanceExplicitly,
    ApproveVerifiedModePackCandidateExplicitly,
    ReplaceActiveWithApprovedModePackCandidateExplicitly,
    RunParentTaskExplicitly,
    NoEligibleTask,
    RefreshProgressOverview,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub objective_proposal_authorization_preflight_result:
        Option<HeadlessRunObjectiveProposalAuthorizationPreflight>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub objective_apply_verification_result: Option<HeadlessRunObjectiveApplyVerification>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub objective_completion_acceptance_result: Option<HeadlessRunObjectiveCompletionAcceptance>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm_provider_failure_retry_admission: Option<LlmProviderFailureRetryAdmission>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product_continuation_admission: Option<ProductContinuationAdmission>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modepack_select_registry_update_result: Option<ModePackSelectRegistryUpdateResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modepack_fetch_candidate_result: Option<ModePackFetchCandidateResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modepack_verify_candidate_provenance_result:
        Option<ModePackVerifyCandidateProvenanceResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modepack_approve_candidate_result: Option<ModePackApproveCandidateResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modepack_replace_active_result: Option<ModePackReplaceActiveResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modepack_rollback_active_result: Option<ModePackRollbackActiveResult>,
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_join_readiness_outcome: Option<TaskRunParentJoinReadinessOutcome>,
    pub next_route: Option<HeadlessContinueRoute>,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct HeadlessRunProgressCheckpoint {
    pub progress_fingerprint: String,
    pub aggregate_sequence: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct HeadlessRunCompletionFinalization {
    pub status: String,
    pub session_id: String,
    pub drive_id: String,
    pub start_session_sequence: u64,
    pub end_session_sequence: u64,
    pub closure_fingerprint: String,
    pub progress_fingerprint: String,
    pub aggregate_sequence: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_completion_fingerprint: Option<String>,
    pub terminal_task_count: usize,
    pub total_task_count: usize,
    pub finalization_fingerprint: String,
    pub replayed: bool,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct HeadlessRunObjectiveProposalCandidate {
    pub status: String,
    pub journey_id: String,
    pub task_id: String,
    pub run_id: String,
    pub session_id: String,
    pub drive_id: String,
    pub objective_context_fingerprint: String,
    pub selected_context_fingerprint: String,
    pub candidate_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposal_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_event_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_event_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path_fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub denial_reason: Option<String>,
    pub candidate_fingerprint: String,
    pub replayed: bool,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct HeadlessRunObjectiveProposalAuthorizationPreflight {
    pub status: String,
    pub journey_id: String,
    pub task_id: String,
    pub run_id: String,
    pub session_id: String,
    pub source_drive_id: String,
    pub proposal_id: String,
    pub source_event_id: String,
    pub source_event_kind: String,
    pub operation: String,
    pub path_fingerprint: String,
    pub objective_context_fingerprint: String,
    pub selected_context_fingerprint: String,
    pub candidate_fingerprint: String,
    pub authorization_token_fingerprint: String,
    pub validation_status: String,
    pub approval_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_at: Option<String>,
    pub preflight_snapshot: WorkspacePatchPreflightSnapshotSummary,
    pub apply_plan: WorkspacePatchApplyPlanSummary,
    pub authorization_preflight_fingerprint: String,
    pub replayed: bool,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct HeadlessRunObjectiveApplyVerification {
    pub verification_status: String,
    pub journey_id: String,
    pub task_id: String,
    pub run_id: String,
    pub session_id: String,
    pub source_drive_id: String,
    pub proposal_id: String,
    pub apply_id: String,
    pub operation: String,
    pub path_fingerprint: String,
    pub apply_fingerprint: String,
    pub expected_post_write_sha256: String,
    pub current_target_sha256: String,
    pub verification_fingerprint: String,
    pub route_kind: HeadlessContinueRouteKind,
    pub replayed: bool,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct HeadlessRunObjectiveCompletionAcceptance {
    pub acceptance_status: String,
    pub journey_id: String,
    pub task_id: String,
    pub run_id: String,
    pub session_id: String,
    pub source_drive_id: String,
    pub proposal_id: String,
    pub apply_id: String,
    pub operation: String,
    pub path_fingerprint: String,
    pub apply_fingerprint: String,
    pub expected_post_write_sha256: String,
    pub current_target_sha256: String,
    pub verification_status: String,
    pub verification_fingerprint: String,
    pub acceptance_fingerprint: String,
    pub replayed: bool,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct HeadlessRunAcceptedCompletion {
    pub task_id: String,
    pub run_id: String,
    pub acceptance_id: String,
    pub status: String,
    pub terminal_completion_fingerprint: String,
    pub acceptance_fingerprint: String,
    pub verifier_gate_status: String,
    pub replayed: bool,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accepted_completion: Option<HeadlessRunAcceptedCompletion>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product_evidence_matrix: Option<HeadlessRunProductEvidenceMatrix>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_product_gap_closure: Option<HeadlessRunSelectedProductGapClosureEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product_completion_decision: Option<HeadlessRunProductCompletionDecision>,
    pub start_progress: HeadlessRunProgressCheckpoint,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_progress: Option<HeadlessRunProgressCheckpoint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_route: Option<HeadlessContinueRoute>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub objective_proposal_candidate: Option<HeadlessRunObjectiveProposalCandidate>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub advances: Vec<HeadlessRunAdvanceResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub journey_route_resume: Option<HeadlessRunJourneyRouteResumeMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub journey_closure: Option<HeadlessRunJourneyClosureMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub journey: Option<HeadlessRunJourneyMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub journey_execution: Option<HeadlessRunJourneyExecutionMetadata>,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct HeadlessRunProductCompletionDecision {
    pub decision_id: String,
    pub task_id: String,
    pub run_id: String,
    pub acceptance_id: String,
    pub status: String,
    pub next_action: String,
    pub target_capability: String,
    pub concrete_capability_transition: String,
    pub accepted_completion_fingerprint: String,
    pub terminal_completion_fingerprint: String,
    pub completion_closure_fingerprint: String,
    pub product_evidence_fingerprint: String,
    pub decision_fingerprint: String,
    pub validated_gate_categories: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub derived_product_evidence_matrix_fingerprint: Option<String>,
    pub behavior_evidence_count: usize,
    pub rejected_alternatives_count: usize,
    pub safety_boundary_reviewed: bool,
    pub non_goals_reviewed: bool,
    pub technical_debt_reviewed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining_capability: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_remaining_gap: Option<HeadlessRunProductRemainingGapSelection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub milestone_exit_rationale: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub technical_debt_carry_forward: Option<TechnicalDebtCarryForward>,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TechnicalDebtCarryForwardItem {
    pub debt_id: String,
    pub summary: String,
    pub source_milestone: String,
    pub source_phase: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_pr: Option<String>,
    pub target_capability: String,
    #[serde(default = "default_technical_debt_classification")]
    pub classification: String,
    #[serde(default = "default_technical_debt_responsibility_domain")]
    pub responsibility_domain: String,
    pub status: String,
    pub next_action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closure_evidence_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TechnicalDebtCarryForward {
    pub fingerprint: String,
    pub items: Vec<TechnicalDebtCarryForwardItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TechnicalDebtTransition {
    pub debt_id: String,
    pub status: String,
    pub next_action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closure_evidence_fingerprint: Option<String>,
}

fn default_technical_debt_classification() -> String {
    "post_v0".to_string()
}

fn default_technical_debt_responsibility_domain() -> String {
    "runtime".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct HeadlessRunProductEvidenceMatrix {
    pub derivation_id: String,
    pub task_id: String,
    pub run_id: String,
    pub acceptance_id: String,
    pub phase_id: String,
    pub milestone: String,
    pub target_capability: String,
    pub concrete_capability_transition: String,
    pub accepted_completion_fingerprint: String,
    pub terminal_completion_fingerprint: String,
    pub completion_closure_fingerprint: String,
    pub product_evidence_matrix_fingerprint: String,
    #[serde(default)]
    pub product_completion_claim: bool,
    pub artifact_count: usize,
    pub artifact_hashes: Vec<HeadlessRunProductEvidenceArtifact>,
    pub validated_gate_categories: Vec<String>,
    pub behavior_evidence_count: usize,
    pub rejected_alternatives_count: usize,
    pub safety_boundary_reviewed: bool,
    pub non_goals_reviewed: bool,
    pub technical_debt_reviewed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_remaining_gap: Option<HeadlessRunProductRemainingGapSelection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_gap_closure_evidence: Option<HeadlessRunSelectedProductGapClosureEvidence>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub selected_gap_closure_evidence_set: Vec<HeadlessRunSelectedProductGapClosureEvidence>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_gap_closure_set_fingerprint: Option<String>,
    pub next_action: String,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HeadlessRunProductRemainingGapSelection {
    pub gap_id: String,
    pub capability: String,
    pub transition: String,
    pub status: String,
    #[serde(default = "default_product_remaining_gap_responsibility_domain")]
    pub responsibility_domain: String,
    pub required: bool,
    pub priority: u16,
    pub next_action: String,
    pub selection_fingerprint: String,
}

fn default_product_remaining_gap_responsibility_domain() -> String {
    "runtime".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct HeadlessRunProductEvidenceArtifact {
    pub path: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct HeadlessRunJourneyMetadata {
    pub journey_id: String,
    pub task_id: String,
    pub run_id: String,
    pub session_id: String,
    pub drive_id: String,
    pub start_progress_fingerprint: String,
    pub start_aggregate_sequence: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_progress_fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_aggregate_sequence: Option<u64>,
    pub closure_status: HeadlessRunCompletionClosureStatus,
    pub next_action: String,
    pub replayed: bool,
    pub journey_fingerprint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub objective_context: Option<HeadlessRunJourneyObjectiveContextMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product_objective_continuation_provenance: Option<ProductObjectiveContinuationProvenance>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposal_candidate: Option<HeadlessRunObjectiveProposalCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HeadlessRunJourneyObjectiveContextMetadata {
    pub objective_id: String,
    pub objective_fingerprint: String,
    pub objective_context_fingerprint: String,
    pub selected_context_fingerprint: String,
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
    pub content_sha256: String,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct HeadlessRunJourneyRouteResumeMetadata {
    pub journey_id: String,
    pub task_id: String,
    pub run_id: String,
    pub session_id: String,
    pub drive_id: String,
    pub route_kind: HeadlessContinueRouteKind,
    pub source_continuation_id: String,
    pub source_decision_id: String,
    pub source_checkpoint_fingerprint: String,
    pub derived_target_class: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_advance_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_continuation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_route_progress_fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_route_aggregate_sequence: Option<u64>,
    pub next_action: String,
    pub replayed: bool,
    pub resume_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct HeadlessRunJourneyClosureMetadata {
    pub journey_id: String,
    pub task_id: String,
    pub run_id: String,
    pub session_id: String,
    pub drive_id: String,
    pub source_replacement_drive_id: String,
    pub source_replacement_resume_fingerprint: String,
    pub replacement_route_kind: HeadlessContinueRouteKind,
    pub replacement_continuation_id: String,
    pub replacement_checkpoint_fingerprint: String,
    pub active_modepack_activation_fingerprint: String,
    pub closure_fingerprint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finalization_fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_completion_fingerprint: Option<String>,
    pub progress_fingerprint: String,
    pub aggregate_sequence: u64,
    pub next_action: String,
    pub replayed: bool,
    pub journey_closure_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct HeadlessRunJourneyExecutionBoundaryMetadata {
    pub boundary: String,
    pub drive_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub route_kind: Option<HeadlessContinueRouteKind>,
    pub session_sequence: u64,
    pub drive_fingerprint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume_fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub journey_closure_fingerprint: Option<String>,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct HeadlessRunJourneyExecutionMetadata {
    pub journey_id: String,
    pub task_id: String,
    pub run_id: String,
    pub session_id: String,
    pub drive_id: String,
    pub journey_fingerprint: String,
    pub completed_boundaries: Vec<HeadlessRunJourneyExecutionBoundaryMetadata>,
    pub complete: bool,
    pub next_action: String,
    pub replayed: bool,
    pub execution_checkpoint_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct TaskRunAgentLoopSummary {
    pub final_state: String,
    pub completion_summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct TaskRunCompletionAcceptance {
    pub acceptance_id: String,
    pub task_id: String,
    pub run_id: String,
    pub status: String,
    pub terminal_completion_fingerprint: String,
    pub acceptance_fingerprint: String,
    pub verifier_gate_status: String,
    pub replayed: bool,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct TaskRunChildOrchestrationOutcome {
    pub parent_run_id: String,
    pub materialized_child_task_ids: Vec<String>,
    pub materialized_child_count: usize,
    pub queued_child_task_ids: Vec<String>,
    pub queued_child_count: usize,
    pub child_running_enabled: bool,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct TaskRunParentJoinReadinessOutcome {
    pub parent_task_id: String,
    pub parent_run_id: String,
    pub child_task_id: String,
    pub child_run_id: String,
    pub child_terminal_status: TaskStatus,
    #[serde(default)]
    pub child_completion_fingerprint: String,
    #[serde(default, rename = "child_completion_fingerprint_evidence_count")]
    pub child_completion_fingerprint_input_count: usize,
    #[serde(default)]
    pub child_completion_child_count: usize,
    #[serde(default)]
    pub child_terminal_completed_count: usize,
    #[serde(default)]
    pub child_terminal_failed_count: usize,
    pub terminal_controlled_child_count: usize,
    pub pending_controlled_child_count: usize,
    pub pending_controlled_child_task_ids: Vec<String>,
    pub non_runnable_controlled_child_count: usize,
    pub non_runnable_controlled_child_task_ids: Vec<String>,
    pub parent_join_ready: bool,
    pub parent_running_enabled: bool,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TaskListParams {
    #[serde(default)]
    pub bounds: Option<TaskListBounds>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct TaskListBounds {
    #[serde(default)]
    pub max_tasks: Option<usize>,
    #[serde(default)]
    pub max_task_goal_chars: Option<usize>,
    #[serde(default)]
    pub max_task_ids: Option<usize>,
    #[serde(default)]
    pub max_groups: Option<usize>,
    #[serde(default)]
    pub max_group_task_ids: Option<usize>,
    #[serde(default)]
    pub max_headless_route_candidates: Option<usize>,
    #[serde(default)]
    pub max_nodes: Option<usize>,
    #[serde(default)]
    pub max_edges: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct TaskListResult {
    pub tasks: Vec<TaskRecord>,
    pub progress_overview: TaskListProgressOverview,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct TaskListProgressOverview {
    pub source_fingerprint: String,
    pub aggregate_sequence: u64,
    pub task_count: usize,
    #[serde(default)]
    pub runnable_count: usize,
    #[serde(default)]
    pub blocked_count: usize,
    #[serde(default)]
    pub terminal_count: usize,
    #[serde(default)]
    pub parent_join_ready_count: usize,
    pub root_task_ids: Vec<String>,
    pub runnable_task_ids: Vec<String>,
    pub blocked_task_ids: Vec<String>,
    pub terminal_task_ids: Vec<String>,
    pub parent_join_ready_task_ids: Vec<String>,
    pub status_counts: TaskStatusCounts,
    pub stage_counts: Vec<TaskListProgressStageCount>,
    pub next_action_sets: Vec<TaskListProgressNextActionSet>,
    pub blocked_sets: Vec<TaskListProgressBlockedSet>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_headless_route: Option<TaskListHeadlessRouteCandidate>,
    pub headless_route_candidates: Vec<TaskListHeadlessRouteCandidate>,
    pub nodes: Vec<TaskProgressGraphNode>,
    pub edges: Vec<TaskProgressGraphEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub journey_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub journey_fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_session_sequence: Option<u64>,
    pub progress_fingerprint: String,
    pub aggregate_sequence: u64,
    pub route_fingerprint: String,
    pub priority: u8,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct TaskStatusCounts {
    pub created: usize,
    pub queued: usize,
    pub running: usize,
    pub completed: usize,
    pub failed: usize,
    pub cancelled: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct TaskListProgressStageCount {
    pub current_stage: ProgressCurrentStage,
    pub task_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct TaskListProgressNextActionSet {
    pub next_action: ProgressNextAction,
    pub task_count: usize,
    pub task_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct TaskListProgressBlockedSet {
    pub current_stage: ProgressCurrentStage,
    pub next_action: ProgressNextAction,
    pub task_count: usize,
    pub task_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct TaskProgressGraphEdge {
    pub parent_task_id: String,
    pub parent_run_id: String,
    pub child_task_id: String,
    pub child_run_id: String,
    pub source_candidate_id: String,
    pub source_handoff_envelope_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct RunEventsResult {
    pub run_id: String,
    pub events: Vec<LedgerEventSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct RunInspectResult {
    pub run: RunInspectSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct WorkspacePatchApplyPlanSummary {
    pub proposal_id: String,
    pub plan_id: String,
    pub status: String,
    pub checklist: Vec<WorkspacePatchApplyCheckSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct WorkspacePatchApplyCheckSummary {
    pub name: String,
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct WorkspacePatchReadinessCheckSummary {
    pub name: String,
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct WorkspacePatchApplyCapabilityCheckSummary {
    pub name: String,
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct WorkspacePatchApplyDryRunCheckSummary {
    pub name: String,
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct WorkspacePatchApplyResultCheckSummary {
    pub name: String,
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct WorkspacePatchApplyDryRunHistorySummary {
    pub proposal_id: String,
    pub dry_run_count: usize,
    pub latest_dry_run: Option<WorkspacePatchApplyDryRunHistoryEntry>,
    pub dry_runs: Vec<WorkspacePatchApplyDryRunHistoryEntry>,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct WorkspacePatchAuditTrailEntry {
    pub event_id: String,
    pub audit_event: String,
    pub event_kind: String,
    pub timestamp: String,
    pub proposal_id: String,
    pub summary: String,
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct WorkspacePatchAuditTrailSummary {
    pub proposal_id: String,
    pub event_count: usize,
    pub latest_event: Option<WorkspacePatchAuditTrailEntry>,
    pub events: Vec<WorkspacePatchAuditTrailEntry>,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct WorkspacePatchReviewSignalSummary {
    pub status: String,
    pub reason: Option<String>,
    pub generated_at: Option<String>,
    pub source_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct WorkspacePatchReviewQueueDiagnosticsCheckSummary {
    pub name: String,
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalListResult {
    pub run_id: String,
    pub proposals: Vec<WorkspacePatchProposalSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalInspectResult {
    pub proposal: WorkspacePatchProposalSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalApproveResult {
    pub proposal: WorkspacePatchProposalSummary,
    pub apply_plan: WorkspacePatchApplyPlanSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalRejectResult {
    pub proposal: WorkspacePatchProposalSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalPreflightResult {
    pub proposal: WorkspacePatchProposalSummary,
    pub snapshot: WorkspacePatchPreflightSnapshotSummary,
    pub apply_plan: WorkspacePatchApplyPlanSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReadinessResult {
    pub proposal: WorkspacePatchProposalSummary,
    pub report: WorkspacePatchReadinessReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalApplyCapabilityResult {
    pub proposal: WorkspacePatchProposalSummary,
    pub capability: WorkspacePatchApplyCapabilitySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalApplyDryRunResult {
    pub proposal: WorkspacePatchProposalSummary,
    pub dry_run: WorkspacePatchApplyDryRunSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalApplyResult {
    pub proposal: WorkspacePatchProposalSummary,
    pub apply_result: WorkspacePatchApplyResultSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalApplyDryRunHistoryResult {
    pub proposal: WorkspacePatchProposalSummary,
    pub history: WorkspacePatchApplyDryRunHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalAuditTrailResult {
    pub proposal: WorkspacePatchProposalSummary,
    pub audit_trail: WorkspacePatchAuditTrailSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewBundleResult {
    pub proposal: WorkspacePatchProposalSummary,
    pub review_bundle: WorkspacePatchReviewBundleSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewVerdictResult {
    pub proposal: WorkspacePatchProposalSummary,
    pub review_verdict: WorkspacePatchReviewVerdictSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewReportResult {
    pub proposal: WorkspacePatchProposalSummary,
    pub review_report: WorkspacePatchReviewReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueResult {
    pub review_queue: WorkspacePatchReviewQueueSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsResult {
    pub review_queue_diagnostics: WorkspacePatchReviewQueueDiagnosticsSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsHistoryResult {
    pub review_queue_diagnostics_history: WorkspacePatchReviewQueueDiagnosticsHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsReportResult {
    pub review_queue_diagnostics_report: WorkspacePatchReviewQueueDiagnosticsReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestResult {
    pub review_queue_diagnostics_digest: WorkspacePatchReviewQueueDiagnosticsDigestSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestHistoryResult {
    pub review_queue_diagnostics_digest_history:
        WorkspacePatchReviewQueueDiagnosticsDigestHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportResult {
    pub review_queue_diagnostics_digest_report:
        WorkspacePatchReviewQueueDiagnosticsDigestReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportHistoryResult {
    pub review_queue_diagnostics_digest_report_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictResult {
    pub review_queue_diagnostics_digest_report_verdict:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportResult {
    pub review_queue_diagnostics_digest_report_verdict_report:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProposalReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryResult {
    pub review_queue_diagnostics_digest_report_verdict_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history_report_history_digest_history:
        WorkspacePatchReviewQueueDiagnosticsDigestReportVerdictReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistoryReportHistoryDigestHistorySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct TaskInspectResult {
    pub task: TaskRecord,
    pub run: RunInspectSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_join_readiness_summary: Option<ChildInspectParentJoinReadinessSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consumed_parent_join_recovery_summary:
        Option<ChildInspectConsumedParentJoinRecoverySummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProgressLifecyclePhase {
    Created,
    Queued,
    Running,
    BlockedForExplicitAction,
    Terminal,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProgressVerificationState {
    NotRequired,
    Pending,
    Passed,
    Failed,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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
    pub product_continuation_provenance: Option<ProductContinuationProvenance>,
    pub product_objective_continuation_provenance: Option<ProductObjectiveContinuationProvenance>,
    pub product_loop_stop_recovery_provenance: Option<ProductLoopStopRecoveryProvenance>,
    pub event_count: usize,
    pub has_agent_loop_completed: bool,
    pub completion_final_state: Option<String>,
    pub completion_result_fingerprint: Option<String>,
    pub completion_summary_preview: Option<String>,
    pub final_response_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ChildTaskSourceIntentSummary {
    pub tool_id: String,
    pub required_action: RuntimeActionName,
    pub request_reason: String,
    pub requested_goal_preview: Option<String>,
    pub requested_mode_id: Option<String>,
    pub input_summary: ToolIntentInputSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct RecoveryCycleChildProvenance {
    pub parent_join_admission_id: String,
    pub parent_join_child_completion_fingerprint: String,
    pub parent_join_child_completion_child_count: usize,
    pub parent_join_terminal_failed_child_count: usize,
    pub parent_join_terminal_completed_child_count: usize,
    pub parent_join_recovery_cycle: bool,
    pub parent_join_recovery_cycle_depth: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProductContinuationProvenance {
    pub source_task_id: String,
    pub source_run_id: String,
    pub source_decision_id: String,
    pub decision_fingerprint: String,
    pub accepted_completion_fingerprint: String,
    pub terminal_completion_fingerprint: String,
    pub completion_closure_fingerprint: String,
    pub product_evidence_fingerprint: String,
    pub target_capability: String,
    pub concrete_capability_transition: String,
    pub decision_status: String,
    pub decision_next_action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remaining_capability: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_remaining_gap: Option<HeadlessRunProductRemainingGapSelection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub technical_debt_carry_forward: Option<TechnicalDebtCarryForward>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProductObjectiveContinuationProvenance {
    pub source_task_id: String,
    pub source_run_id: String,
    pub source_decision_id: String,
    pub decision_fingerprint: String,
    pub accepted_completion_fingerprint: String,
    pub terminal_completion_fingerprint: String,
    pub completion_closure_fingerprint: String,
    pub product_evidence_fingerprint: String,
    pub target_capability: String,
    pub concrete_capability_transition: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub remaining_capability: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub remaining_capability_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_remaining_gap: Option<HeadlessRunProductRemainingGapSelection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub technical_debt_carry_forward_fingerprint: Option<String>,
    pub derived_objective_fingerprint: String,
    pub derived_goal_fingerprint: String,
    pub derivation_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct ProductLoopStopRecoveryProvenance {
    pub source_session_id: String,
    pub source_drive_id: String,
    pub drive_fingerprint: String,
    pub stop_reason: String,
    pub stop_class: String,
    pub source_progress_fingerprint: String,
    pub end_session_sequence: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_route_fingerprint: Option<String>,
    pub recovery_boundary_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct HeadlessRunRecoveryIdentityEvidence {
    pub session_id: String,
    pub drive_id: String,
    pub journey_id: String,
    pub objective_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct LedgerEventSummary {
    pub event_id: String,
    pub task_id: String,
    pub run_id: String,
    pub kind: String,
    pub timestamp: String,
    pub payload: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
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
    #[serde(default)]
    pub product_continuation_provenance: Option<ProductContinuationProvenance>,
    #[serde(default)]
    pub product_objective_continuation_provenance: Option<ProductObjectiveContinuationProvenance>,
    #[serde(default)]
    pub product_loop_stop_recovery_provenance: Option<ProductLoopStopRecoveryProvenance>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headless_run_recovery_identity: Option<HeadlessRunRecoveryIdentityEvidence>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_deadline: Option<RuntimeDeadline>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub enum TaskStatus {
    Created,
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[cfg(test)]
mod semantic_contract_tests {
    use super::*;
    use serde::de::DeserializeOwned;
    use serde_json::{json, Value};
    use std::collections::BTreeSet;

    fn rejects_unknown_field<T>(mut value: Value)
    where
        T: DeserializeOwned + std::fmt::Debug,
    {
        value
            .as_object_mut()
            .expect("object fixture")
            .insert("unexpected".to_string(), json!(true));
        let error = serde_json::from_value::<T>(value).expect_err("unknown field rejected");
        assert!(
            error.to_string().contains("unknown field"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn semantic_contract_artifact_matches_rust_generator() {
        let expected = serde_json::from_str::<Value>(include_str!(
            "../../../docs/architecture/runtime-semantic-protocol-contract.json"
        ))
        .expect("semantic contract artifact parses");
        assert_eq!(
            semantic_contract::runtime_semantic_protocol_contract(),
            expected,
            "update docs/architecture/runtime-semantic-protocol-contract.json with `cargo run -p brownie-protocol --bin brownie-protocol-semantic-contract -- --write docs/architecture/runtime-semantic-protocol-contract.json`"
        );
    }

    #[test]
    fn semantic_contract_covers_all_explicit_runtime_methods() {
        let canonical_map = serde_json::from_str::<Value>(include_str!(
            "../../../docs/architecture/runtime-protocol-event-canonical-map.json"
        ))
        .expect("canonical map parses");
        let mapped_methods = canonical_map
            .get("protocol_method_groups")
            .and_then(Value::as_array)
            .expect("protocol method groups")
            .iter()
            .flat_map(|group| {
                group
                    .get("methods")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
            })
            .collect::<BTreeSet<_>>();
        let semantic_methods = semantic_contract::explicit_runtime_method_set();
        assert_eq!(
            semantic_methods, mapped_methods,
            "semantic contract method specs must match every explicit Runtime method in the canonical map"
        );

        let contract = semantic_contract::runtime_semantic_protocol_contract();
        let contract_methods = contract
            .get("method_contracts")
            .and_then(Value::as_array)
            .expect("method contracts")
            .iter()
            .filter_map(|method| method.get("method").and_then(Value::as_str))
            .map(str::to_string)
            .collect::<BTreeSet<_>>();
        assert_eq!(
            contract_methods, mapped_methods,
            "generated artifact must include one method contract per explicit Runtime method"
        );
    }

    #[test]
    fn semantic_contract_records_all_public_param_deny_unknown_policies() {
        let missing = semantic_contract::public_param_types_without_deny_unknown_fields();
        assert!(
            missing.is_empty(),
            "public Runtime params missing deny_unknown_fields: {missing:?}"
        );

        let contract = semantic_contract::runtime_semantic_protocol_contract();
        let policy_params = contract
            .get("unknown_field_policy")
            .and_then(|policy| policy.get("rust_public_params"))
            .and_then(Value::as_array)
            .expect("rust public params policy")
            .iter()
            .filter_map(|entry| entry.get("type").and_then(Value::as_str))
            .map(str::to_string)
            .collect::<BTreeSet<_>>();
        let public_params = semantic_contract::public_param_types()
            .into_iter()
            .collect::<BTreeSet<_>>();
        assert_eq!(
            policy_params, public_params,
            "semantic contract must record unknown-field policy for every public *Params type"
        );
    }

    #[test]
    fn semantic_contract_records_recursive_nested_wire_schemas() {
        let contract = semantic_contract::runtime_semantic_protocol_contract();
        assert_eq!(
            contract.get("phase").and_then(Value::as_str),
            Some("RRP-5.17")
        );

        let type_schemas = contract
            .get("type_schemas")
            .and_then(Value::as_object)
            .expect("recursive type schemas");
        let replace_active = type_schemas
            .get("ModePackReplaceActiveResult")
            .and_then(Value::as_object)
            .expect("ModePackReplaceActiveResult schema");
        let defs = replace_active
            .get("$defs")
            .and_then(Value::as_object)
            .expect("nested schema definitions");
        assert!(
            defs.contains_key("ModePackActiveSnapshotSummary"),
            "nested ModePackActiveSnapshotSummary must be recursively defined"
        );
        assert!(
            defs.contains_key("ModePackApprovedCandidateSummary"),
            "nested candidate summary must be recursively defined"
        );
        let previous_snapshot = replace_active
            .get("properties")
            .and_then(|properties| properties.get("previous_snapshot"))
            .and_then(|value| value.get("$ref"))
            .and_then(Value::as_str);
        assert_eq!(
            previous_snapshot,
            Some("#/$defs/ModePackActiveSnapshotSummary"),
            "method result schemas must expose machine-checkable nested refs"
        );

        let method = contract
            .get("method_contracts")
            .and_then(Value::as_array)
            .expect("method contracts")
            .iter()
            .find(|method| {
                method.get("method").and_then(Value::as_str) == Some("modepack.replaceActive")
            })
            .expect("modepack.replaceActive contract");
        assert_eq!(
            method.get("result_schema_ref").and_then(Value::as_str),
            Some("#/type_schemas/ModePackReplaceActiveResult")
        );
        assert!(
            method
                .get("result_recursive_schema_fingerprint")
                .and_then(Value::as_str)
                .is_some_and(|fingerprint| fingerprint.starts_with("shape-fnv1a64:")),
            "method contract must fingerprint the recursive result schema"
        );
    }

    #[test]
    fn public_runtime_params_reject_unknown_fields() {
        rejects_unknown_field::<TaskStartParams>(json!({
            "goal": "ship bounded release evidence",
            "mode_id": "orchestrator"
        }));
        rejects_unknown_field::<TaskCancelParams>(json!({
            "task_id": "task_1",
            "run_id": "run_1",
            "expected_status": "Running",
            "expected_task_updated_at": "2026-09-03T00:00:00Z",
            "cancel_id": "cancel_1",
            "authorize_cancel": true
        }));
        rejects_unknown_field::<TaskRunParams>(json!({
            "task_id": "task_1",
            "selected_index_context": null,
            "verification_recovery_context_read": null,
            "context_budget": null,
            "completion_acceptance": null
        }));
        rejects_unknown_field::<HeadlessRunDriveParams>(json!({
            "authorize": true,
            "session_id": "session_1",
            "drive_id": "drive_1",
            "expected_start_session_sequence": 1,
            "max_advances": 1,
            "max_steps_per_advance": 1
        }));
        rejects_unknown_field::<ToolExecuteParams>(json!({
            "mode_id": "orchestrator",
            "tool_id": "workspace.read",
            "task_id": "task_1",
            "input": {"path": "README.md"}
        }));
        rejects_unknown_field::<McpToolApprovalApproveParams>(json!({
            "mode_id": "orchestrator",
            "task_id": "task_1",
            "tool_id": "mcp.search",
            "input": {"query": "safe"},
            "approve": true,
            "approval_id": "approval_1"
        }));
        rejects_unknown_field::<RunEventsParams>(json!({
            "run_id": "run_1"
        }));
        rejects_unknown_field::<ProposalApplyParams>(json!({
            "run_id": "run_1",
            "proposal_id": "proposal_1",
            "expected_target_sha256": null,
            "expected_target_absent": true,
            "replacement_content": "bounded content",
            "authorize": true
        }));
    }

    #[test]
    fn semantic_contract_fixtures_match_rust_serialization_semantics() {
        let contract = semantic_contract::runtime_semantic_protocol_contract();
        let fixtures = contract
            .get("golden_fixtures")
            .and_then(Value::as_object)
            .expect("golden fixtures object");

        let task_start = TaskStartParams {
            goal: "ship bounded release evidence".to_string(),
            mode_id: Some("orchestrator".to_string()),
            verification_recovery_source: None,
            patch_apply_recovery_source: None,
            verification_recovery_retry_source: None,
            llm_provider_failure_retry_source: None,
            product_continuation_source: None,
        };
        assert_eq!(
            fixtures.get("task_start_wire_params"),
            Some(&serde_json::to_value(task_start).expect("serialize task start"))
        );

        let task_cancel = TaskCancelParams {
            task_id: "task_1".to_string(),
            run_id: "run_1".to_string(),
            expected_status: TaskStatus::Running,
            expected_task_updated_at: "2026-09-03T00:00:00Z".to_string(),
            cancel_id: "cancel_1".to_string(),
            authorize_cancel: true,
        };
        assert_eq!(
            fixtures.get("task_cancel_params"),
            Some(&serde_json::to_value(task_cancel).expect("serialize task cancel"))
        );

        let task_run = TaskRunParams {
            task_id: "task_1".to_string(),
            runtime_deadline: None,
            selected_index_context: None,
            verification_recovery_context_read: None,
            context_budget: None,
            completion_acceptance: None,
        };
        assert_eq!(
            fixtures.get("task_run_minimal_params"),
            Some(&serde_json::to_value(task_run).expect("serialize task run"))
        );

        assert_eq!(
            fixtures.get("task_status_values"),
            Some(&json!([
                "Created",
                "Queued",
                "Running",
                "Completed",
                "Failed",
                "Cancelled"
            ]))
        );
    }
}
