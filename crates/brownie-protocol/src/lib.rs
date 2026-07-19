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
pub struct ProposalApplyDryRunParams {
    pub run_id: String,
    pub proposal_id: String,
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
pub struct TaskRunResult {
    pub task_id: String,
    pub run_id: String,
    pub status: TaskStatus,
    pub agent_loop: TaskRunAgentLoopSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery_cycle_budget_outcome: Option<RecoveryCycleBudgetOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub child_orchestration_outcome: Option<TaskRunChildOrchestrationOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_join_readiness_outcome: Option<TaskRunParentJoinReadinessOutcome>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskRunAgentLoopSummary {
    pub final_state: String,
    pub completion_summary: String,
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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunInspectSummary {
    pub run_id: String,
    pub task_id: Option<String>,
    pub status: Option<TaskStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery_cycle_budget_outcome: Option<RecoveryCycleBudgetOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_join_readiness_summary: Option<RunInspectParentJoinReadinessSummary>,
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
