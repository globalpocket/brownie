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
pub enum RuntimeActionName {
    ReadWorkspace,
    WriteWorkspace,
    ExecuteProcess,
    AccessNetwork,
    ControlService,
    DestructiveOperation,
    SpawnSubtask,
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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskStartResult {
    pub task_id: String,
    pub run_id: String,
    pub status: TaskStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskGetParams {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskRunParams {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunEventsParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunInspectParams {
    pub run_id: String,
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
pub struct TaskInspectParams {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskRunResult {
    pub task_id: String,
    pub run_id: String,
    pub status: TaskStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskListResult {
    pub tasks: Vec<TaskRecord>,
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
    pub capability_status: String,
    pub capability_reason: Option<String>,
    pub generated_at: String,
    pub execution_enabled: bool,
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
pub struct TaskInspectResult {
    pub task: TaskRecord,
    pub run: RunInspectSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunInspectSummary {
    pub run_id: String,
    pub task_id: Option<String>,
    pub status: Option<TaskStatus>,
    pub event_count: usize,
    pub has_tool_execution_completed: bool,
    pub has_second_pass: bool,
    pub final_response_preview: Option<String>,
    pub timeline: Vec<String>,
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
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TaskStatus {
    Created,
    Running,
    Completed,
    Failed,
    Cancelled,
}
