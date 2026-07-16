//! Context materialization and sliding window truncation crate.

use brownie_protocol::TaskRecord;
use brownie_store::{LedgerEvent, LedgerEventKind};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextRegion {
    Protected,
    Recent,
    Truncatable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PromptRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PromptMessage {
    pub role: PromptRole,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PromptView {
    pub messages: Vec<PromptMessage>,
}

pub const MAX_LEDGER_CONTEXT_EVENTS: usize = 12;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContextWindowSummary {
    pub total_events: usize,
    pub included_events: usize,
    pub omitted_events: usize,
    pub max_events: usize,
    pub first_included_event: Option<String>,
    pub last_included_event: Option<String>,
}

impl ContextWindowSummary {
    pub fn empty() -> Self {
        Self {
            total_events: 0,
            included_events: 0,
            omitted_events: 0,
            max_events: MAX_LEDGER_CONTEXT_EVENTS,
            first_included_event: None,
            last_included_event: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PromptBuildInput {
    pub task_id: String,
    pub run_id: String,
    pub goal: String,
    pub mode_id: Option<String>,
    pub mode_policy_summary: Option<String>,
    pub permission_summary: Vec<String>,
    pub tool_plan_summary: Vec<String>,
    pub tool_intent_summary: Vec<String>,
    pub tool_execution_summary: Vec<String>,
    pub subtask_orchestration_summary: Vec<String>,
    pub context_window: ContextWindowSummary,
    pub ledger_summary: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextMaterializerInput {
    pub task: TaskRecord,
    pub ledger_events: Vec<LedgerEvent>,
}

pub struct ContextMaterializer;

impl ContextMaterializer {
    pub fn materialize(input: ContextMaterializerInput) -> PromptBuildInput {
        let mode_policy_summary = input
            .ledger_events
            .iter()
            .rev()
            .find(|event| event.kind == LedgerEventKind::ModeResolved)
            .and_then(|event| event.payload.as_ref())
            .map(format_mode_policy_summary)
            .unwrap_or_else(|| {
                "Mode Policy:
<unresolved>"
                    .to_string()
            });

        let permission_summary = format_permission_summary(&input.ledger_events);
        let tool_plan_summary = format_tool_plan_summary(&input.ledger_events);
        let tool_intent_summary = format_tool_intent_summary(&input.ledger_events);
        let tool_execution_summary = format_tool_execution_summary(&input.ledger_events);
        let subtask_orchestration_summary =
            format_subtask_orchestration_summary(&input.ledger_events);
        let (ledger_summary, context_window) = format_ledger_context_window(&input.ledger_events);

        PromptBuildInput {
            task_id: input.task.task_id,
            run_id: input.task.run_id,
            goal: input.task.goal,
            mode_id: input.task.mode_id,
            mode_policy_summary: Some(mode_policy_summary),
            permission_summary,
            tool_plan_summary,
            tool_intent_summary,
            tool_execution_summary,
            subtask_orchestration_summary,
            context_window,
            ledger_summary,
        }
    }
}

fn format_ledger_context_window(events: &[LedgerEvent]) -> (Vec<String>, ContextWindowSummary) {
    let total_events = events.len();
    let start = total_events.saturating_sub(MAX_LEDGER_CONTEXT_EVENTS);
    let included = &events[start..];
    let ledger_summary = included
        .iter()
        .map(|event| format!("{:?}", event.kind))
        .collect::<Vec<_>>();
    let first_included_event = ledger_summary.first().cloned();
    let last_included_event = ledger_summary.last().cloned();
    (
        ledger_summary,
        ContextWindowSummary {
            total_events,
            included_events: included.len(),
            omitted_events: start,
            max_events: MAX_LEDGER_CONTEXT_EVENTS,
            first_included_event,
            last_included_event,
        },
    )
}

fn format_mode_policy_summary(payload: &serde_json::Value) -> String {
    let mode_id = payload
        .get("mode_id")
        .and_then(|value| value.as_str())
        .unwrap_or("<unknown>");
    let permissions = payload.get("permissions");
    let permission_bool = |name: &str| {
        permissions
            .and_then(|value| value.get(name))
            .and_then(|value| value.as_bool())
            .map(|value| value.to_string())
            .unwrap_or_else(|| "<unknown>".to_string())
    };

    format!(
        "Mode Policy:
mode_id: {mode_id}
workspace_write: {}
process_exec: {}
can_spawn_subtasks: {}
network_access: {}
service_control: {}
destructive: {}
read_only: {}",
        permission_bool("workspace_write"),
        permission_bool("process_exec"),
        permission_bool("can_spawn_subtasks"),
        permission_bool("network_access"),
        permission_bool("service_control"),
        permission_bool("destructive"),
        permission_bool("read_only")
    )
}

fn format_permission_summary(events: &[LedgerEvent]) -> Vec<String> {
    events
        .iter()
        .filter(|event| event.kind == LedgerEventKind::PermissionChecked)
        .filter_map(|event| {
            let payload = event.payload.as_ref()?;
            let action = payload.get("action")?.as_str()?;
            let allowed = payload.get("allowed")?.as_bool()?;
            let status = if allowed { "allowed" } else { "denied" };
            Some(format!("{action}: {status}"))
        })
        .collect()
}

fn format_tool_plan_summary(events: &[LedgerEvent]) -> Vec<String> {
    events
        .iter()
        .filter(|event| event.kind == LedgerEventKind::ToolPermissionChecked)
        .filter_map(|event| {
            let payload = event.payload.as_ref()?;
            let tool_id = payload.get("tool_id")?.as_str()?;
            let allowed = payload.get("allowed")?.as_bool()?;
            let status = if allowed { "allowed" } else { "denied" };
            Some(format!("{tool_id}: {status}"))
        })
        .collect()
}

fn format_tool_intent_summary(events: &[LedgerEvent]) -> Vec<String> {
    let mut summary = Vec::new();
    for event in events {
        match event.kind {
            LedgerEventKind::ToolIntentPermissionChecked => {
                let Some(payload) = event.payload.as_ref() else {
                    continue;
                };
                let Some(tool_id) = payload.get("tool_id").and_then(|value| value.as_str()) else {
                    continue;
                };
                let Some(allowed) = payload.get("allowed").and_then(|value| value.as_bool()) else {
                    continue;
                };
                let status = if allowed { "allowed" } else { "denied" };
                summary.push(format!("{tool_id}: {status}"));
            }
            LedgerEventKind::ToolIntentRejected => {
                let Some(payload) = event.payload.as_ref() else {
                    continue;
                };
                let tool_id = payload
                    .get("tool_id")
                    .and_then(|value| value.as_str())
                    .unwrap_or("<unknown>");
                summary.push(format!("{tool_id}: rejected"));
            }
            _ => {}
        }
    }
    summary
}

fn format_tool_execution_summary(events: &[LedgerEvent]) -> Vec<String> {
    events
        .iter()
        .filter(|event| {
            matches!(
                event.kind,
                LedgerEventKind::ToolExecutionCompleted
                    | LedgerEventKind::ToolExecutionDenied
                    | LedgerEventKind::ToolExecutionFailed
            )
        })
        .filter_map(|event| {
            let payload = event.payload.as_ref()?;
            let tool_id = payload.get("tool_id")?.as_str()?;
            let status = payload.get("status")?.as_str()?;
            match event.kind {
                LedgerEventKind::ToolExecutionCompleted => {
                    let bytes_read = payload.get("bytes_read").and_then(|value| value.as_u64());
                    let truncated = payload.get("truncated").and_then(|value| value.as_bool());
                    Some(format!(
                        "{tool_id}: {status} bytes_read={} truncated={}",
                        bytes_read
                            .map(|value| value.to_string())
                            .unwrap_or_else(|| "<unknown>".to_string()),
                        truncated
                            .map(|value| value.to_string())
                            .unwrap_or_else(|| "<unknown>".to_string())
                    ))
                }
                LedgerEventKind::ToolExecutionDenied | LedgerEventKind::ToolExecutionFailed => {
                    let reason = payload
                        .get("reason")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    Some(format!("{tool_id}: {status} reason={reason}"))
                }
                _ => None,
            }
        })
        .collect()
}

fn format_subtask_orchestration_summary(events: &[LedgerEvent]) -> Vec<String> {
    events
        .iter()
        .filter_map(|event| {
            let payload = event.payload.as_ref()?;
            match event.kind {
                LedgerEventKind::SubtaskOrchestrationQueued => {
                    let subtask_id = payload
                        .get("subtask_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let status = payload
                        .get("status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let tool_id = payload
                        .get("tool_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let queue_position = payload
                        .get("queue_position")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let execution_enabled = payload
                        .get("execution_enabled")
                        .and_then(|value| value.as_bool())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let mut fields = vec![format!(
                        "{subtask_id}: {status} tool_id={tool_id} queue_position={queue_position} execution_enabled={execution_enabled}"
                    )];
                    if let Some(goal) = payload
                        .get("requested_goal_preview")
                        .and_then(|value| value.as_str())
                    {
                        fields.push(format!("requested_goal_preview={goal}"));
                    }
                    if let Some(mode_id) =
                        payload.get("requested_mode_id").and_then(|value| value.as_str())
                    {
                        fields.push(format!("requested_mode_id={mode_id}"));
                    }
                    Some(fields.join(" "))
                }
                LedgerEventKind::SubtaskHandoffPrepared => {
                    let handoff_id = payload
                        .get("handoff_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let status = payload
                        .get("status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let queued_count = payload
                        .get("queued_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let execution_enabled = payload
                        .get("execution_enabled")
                        .and_then(|value| value.as_bool())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let next_action = payload
                        .get("next_action")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    Some(format!(
                        "{handoff_id}: {status} queued_count={queued_count} execution_enabled={execution_enabled} next_action={next_action}"
                    ))
                }
                LedgerEventKind::SubtaskSchedulerReadinessRecorded => {
                    let readiness_id = payload
                        .get("readiness_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let readiness_status = payload
                        .get("readiness_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let handoff_count = payload
                        .get("handoff_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let queued_count = payload
                        .get("queued_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let dispatch_enabled = payload
                        .get("dispatch_enabled")
                        .and_then(|value| value.as_bool())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let next_action = payload
                        .get("next_action")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    Some(format!(
                        "{readiness_id}: {readiness_status} handoff_count={handoff_count} queued_count={queued_count} dispatch_enabled={dispatch_enabled} next_action={next_action}"
                    ))
                }
                LedgerEventKind::SubtaskDispatchPlanPrepared => {
                    let plan_id = payload
                        .get("plan_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let dispatch_plan_status = payload
                        .get("dispatch_plan_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let readiness_count = payload
                        .get("readiness_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let queued_count = payload
                        .get("queued_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let dispatch_enabled = payload
                        .get("dispatch_enabled")
                        .and_then(|value| value.as_bool())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let next_action = payload
                        .get("next_action")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    Some(format!(
                        "{plan_id}: {dispatch_plan_status} readiness_count={readiness_count} queued_count={queued_count} dispatch_enabled={dispatch_enabled} next_action={next_action}"
                    ))
                }
                LedgerEventKind::SubtaskDispatchContractPrepared => {
                    let contract_id = payload
                        .get("contract_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let dispatch_contract_status = payload
                        .get("dispatch_contract_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let plan_count = payload
                        .get("plan_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let queued_count = payload
                        .get("queued_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let eligibility_status = payload
                        .get("eligibility_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let dispatch_enabled = payload
                        .get("dispatch_enabled")
                        .and_then(|value| value.as_bool())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let next_action = payload
                        .get("next_action")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    Some(format!(
                        "{contract_id}: {dispatch_contract_status} plan_count={plan_count} queued_count={queued_count} eligibility_status={eligibility_status} dispatch_enabled={dispatch_enabled} next_action={next_action}"
                    ))
                }
                LedgerEventKind::SubtaskDispatchAdmissionEvaluated => {
                    let admission_id = payload
                        .get("admission_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let admission_status = payload
                        .get("admission_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let contract_count = payload
                        .get("contract_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let queued_count = payload
                        .get("queued_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let execution_gate_status = payload
                        .get("execution_gate_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let dispatch_enabled = payload
                        .get("dispatch_enabled")
                        .and_then(|value| value.as_bool())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let next_action = payload
                        .get("next_action")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    Some(format!(
                        "{admission_id}: {admission_status} contract_count={contract_count} queued_count={queued_count} execution_gate_status={execution_gate_status} dispatch_enabled={dispatch_enabled} next_action={next_action}"
                    ))
                }
                LedgerEventKind::SubtaskDispatchReadinessSnapshotRecorded => {
                    let snapshot_id = payload
                        .get("snapshot_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let readiness_status = payload
                        .get("readiness_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let admission_count = payload
                        .get("admission_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let queued_count = payload
                        .get("queued_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let scheduler_handoff_status = payload
                        .get("scheduler_handoff_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let dispatch_enabled = payload
                        .get("dispatch_enabled")
                        .and_then(|value| value.as_bool())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let fingerprint_input_count = payload
                        .get("fingerprint_input_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let next_action = payload
                        .get("next_action")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    Some(format!(
                        "{snapshot_id}: {readiness_status} admission_count={admission_count} queued_count={queued_count} scheduler_handoff_status={scheduler_handoff_status} dispatch_enabled={dispatch_enabled} fingerprint_input_count={fingerprint_input_count} next_action={next_action}"
                    ))
                }
                LedgerEventKind::SubtaskDispatcherGuardVerdictRecorded => {
                    let guard_id = payload
                        .get("guard_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let guard_status = payload
                        .get("guard_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let snapshot_count = payload
                        .get("snapshot_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let queued_count = payload
                        .get("queued_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let handoff_preflight_status = payload
                        .get("handoff_preflight_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let snapshot_validity_status = payload
                        .get("snapshot_validity_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let dispatch_enabled = payload
                        .get("dispatch_enabled")
                        .and_then(|value| value.as_bool())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let next_action = payload
                        .get("next_action")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    Some(format!(
                        "{guard_id}: {guard_status} snapshot_count={snapshot_count} queued_count={queued_count} handoff_preflight_status={handoff_preflight_status} dispatch_enabled={dispatch_enabled} snapshot_validity_status={snapshot_validity_status} next_action={next_action}"
                    ))
                }
                LedgerEventKind::SubtaskDispatchDecisionRecorded => {
                    let decision_id = payload
                        .get("decision_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let decision_status = payload
                        .get("decision_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let guard_count = payload
                        .get("guard_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let candidate_status = payload
                        .get("candidate_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let dispatch_candidate_count = payload
                        .get("dispatch_candidate_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let eligible_candidate_count = payload
                        .get("eligible_candidate_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let dispatch_enabled = payload
                        .get("dispatch_enabled")
                        .and_then(|value| value.as_bool())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let next_action = payload
                        .get("next_action")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    Some(format!(
                        "{decision_id}: {decision_status} guard_count={guard_count} candidate_status={candidate_status} dispatch_candidate_count={dispatch_candidate_count} eligible_candidate_count={eligible_candidate_count} dispatch_enabled={dispatch_enabled} next_action={next_action}"
                    ))
                }
                LedgerEventKind::SubtaskDispatchCandidateManifestRecorded => {
                    let manifest_id = payload
                        .get("manifest_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let manifest_status = payload
                        .get("manifest_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let decision_count = payload
                        .get("decision_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let candidate_count = payload
                        .get("candidate_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let blocked_candidate_count = payload
                        .get("blocked_candidate_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let eligible_candidate_count = payload
                        .get("eligible_candidate_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let dispatch_enabled = payload
                        .get("dispatch_enabled")
                        .and_then(|value| value.as_bool())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let next_action = payload
                        .get("next_action")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    Some(format!(
                        "{manifest_id}: {manifest_status} decision_count={decision_count} candidate_count={candidate_count} blocked_candidate_count={blocked_candidate_count} eligible_candidate_count={eligible_candidate_count} dispatch_enabled={dispatch_enabled} next_action={next_action}"
                    ))
                }
                LedgerEventKind::SubtaskDispatchHandoffEnvelopeRecorded => {
                    let handoff_envelope_id = payload
                        .get("handoff_envelope_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let handoff_envelope_status = payload
                        .get("handoff_envelope_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let manifest_count = payload
                        .get("manifest_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let candidate_count = payload
                        .get("candidate_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let handoff_ticket_count = payload
                        .get("handoff_ticket_count")
                        .and_then(|value| value.as_u64())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let replay_guard_status = payload
                        .get("replay_guard_status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    let dispatch_enabled = payload
                        .get("dispatch_enabled")
                        .and_then(|value| value.as_bool())
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "<unknown>".to_string());
                    let next_action = payload
                        .get("next_action")
                        .and_then(|value| value.as_str())
                        .unwrap_or("<unknown>");
                    Some(format!(
                        "{handoff_envelope_id}: {handoff_envelope_status} manifest_count={manifest_count} candidate_count={candidate_count} handoff_ticket_count={handoff_ticket_count} replay_guard_status={replay_guard_status} dispatch_enabled={dispatch_enabled} next_action={next_action}"
                    ))
                }
                _ => None,
            }
        })
        .collect()
}

fn format_context_window_summary(summary: &ContextWindowSummary) -> String {
    format!(
        "total_events: {}\nincluded_events: {}\nomitted_events: {}\nmax_events: {}\nfirst_included_event: {}\nlast_included_event: {}",
        summary.total_events,
        summary.included_events,
        summary.omitted_events,
        summary.max_events,
        summary
            .first_included_event
            .as_deref()
            .unwrap_or("<none>"),
        summary
            .last_included_event
            .as_deref()
            .unwrap_or("<none>")
    )
}

pub struct PromptBuilder;

impl PromptBuilder {
    pub fn build(input: PromptBuildInput) -> PromptView {
        let mode_id = input.mode_id.as_deref().unwrap_or("<none>");
        let mode_policy_summary = input
            .mode_policy_summary
            .unwrap_or_else(|| "Mode Policy:\n<unresolved>".to_string());
        let permission_checks = if input.permission_summary.is_empty() {
            "- <none>".to_string()
        } else {
            input
                .permission_summary
                .iter()
                .map(|entry| format!("- {entry}"))
                .collect::<Vec<_>>()
                .join("\n")
        };

        let tool_plan = if input.tool_plan_summary.is_empty() {
            "- <none>".to_string()
        } else {
            input
                .tool_plan_summary
                .iter()
                .map(|entry| format!("- {entry}"))
                .collect::<Vec<_>>()
                .join("\n")
        };

        let tool_intent = if input.tool_intent_summary.is_empty() {
            "- <none>".to_string()
        } else {
            input
                .tool_intent_summary
                .iter()
                .map(|entry| format!("- {entry}"))
                .collect::<Vec<_>>()
                .join("\n")
        };

        let tool_execution = if input.tool_execution_summary.is_empty() {
            "- <none>".to_string()
        } else {
            input
                .tool_execution_summary
                .iter()
                .map(|entry| format!("- {entry}"))
                .collect::<Vec<_>>()
                .join("\n")
        };
        let subtask_orchestration = if input.subtask_orchestration_summary.is_empty() {
            "- <none>".to_string()
        } else {
            input
                .subtask_orchestration_summary
                .iter()
                .map(|entry| format!("- {entry}"))
                .collect::<Vec<_>>()
                .join("\n")
        };
        let context_window = format_context_window_summary(&input.context_window);

        let ledger = if input.ledger_summary.is_empty() {
            "- <empty>".to_string()
        } else {
            input
                .ledger_summary
                .iter()
                .map(|entry| format!("- {entry}"))
                .collect::<Vec<_>>()
                .join("\n")
        };

        PromptView {
            messages: vec![
                PromptMessage {
                    role: PromptRole::System,
                    content: "You are Brownie Runtime. Execute the task according to the current runtime phase. Real LLM/tool execution is disabled in this phase.".to_string(),
                },
                PromptMessage {
                    role: PromptRole::User,
                    content: format!(
                        "Task ID: {}\nRun ID: {}\nMode ID: {}\n{}\n\nPermission Checks:\n{}\n\nTool Plan:\n{}\n\nAssistant Tool Intent:\n{}\n\nTool Execution:\n{}\n\nSubtask Orchestration:\n{}\n\nContext Window:\n{}\n\nGoal:\n{}\n\nLedger:\n{}",
                        input.task_id, input.run_id, mode_id, mode_policy_summary, permission_checks, tool_plan, tool_intent, tool_execution, subtask_orchestration, context_window, input.goal, ledger
                    ),
                },
            ],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TokenBudget {
    pub max_prompt_chars: usize,
}

pub struct SlidingWindowTruncator;

impl SlidingWindowTruncator {
    pub fn truncate(prompt: PromptView, budget: TokenBudget) -> PromptView {
        let total_chars: usize = prompt
            .messages
            .iter()
            .map(|message| message.content.len())
            .sum();
        if total_chars <= budget.max_prompt_chars {
            return prompt;
        }

        let mut messages = Vec::new();
        for message in prompt.messages {
            let protected = matches!(message.role, PromptRole::System)
                || (matches!(message.role, PromptRole::User)
                    && message.content.contains("Goal:\n"));
            if protected {
                messages.push(message);
            }
        }

        PromptView { messages }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use brownie_store::LedgerEventKind;

    fn task_record() -> TaskRecord {
        TaskRecord {
            task_id: "task_1".into(),
            run_id: "run_1".into(),
            goal: "Ship Phase 1.2".into(),
            mode_id: Some("orchestrator".into()),
            status: brownie_protocol::TaskStatus::Running,
            parent_task_id: None,
            parent_run_id: None,
            source_candidate_id: None,
            source_handoff_envelope_id: None,
            source_handoff_envelope_fingerprint: None,
            source_intent_summary: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:01Z".into(),
        }
    }

    #[test]
    fn prompt_builder_builds_deterministic_messages() {
        let prompt = PromptBuilder::build(PromptBuildInput {
            task_id: "task_1".into(),
            run_id: "run_1".into(),
            goal: "Test goal".into(),
            mode_id: Some("orchestrator".into()),
            mode_policy_summary: Some("Mode Policy:\nmode_id: orchestrator".into()),
            permission_summary: vec![],
            tool_plan_summary: vec![],
            tool_intent_summary: vec![],
            tool_execution_summary: vec![],
            subtask_orchestration_summary: vec![],
            context_window: ContextWindowSummary {
                total_events: 2,
                included_events: 2,
                omitted_events: 0,
                max_events: MAX_LEDGER_CONTEXT_EVENTS,
                first_included_event: Some("TaskStarted".into()),
                last_included_event: Some("TaskRunning".into()),
            },
            ledger_summary: vec!["TaskStarted".into(), "TaskRunning".into()],
        });

        assert_eq!(prompt.messages.len(), 2);
        assert_eq!(prompt.messages[0].role, PromptRole::System);
        assert!(prompt.messages[0]
            .content
            .contains("Real LLM/tool execution is disabled"));
        assert_eq!(prompt.messages[1].role, PromptRole::User);
        assert!(prompt.messages[1].content.contains("Task ID: task_1"));
        assert!(prompt.messages[1]
            .content
            .contains("- TaskStarted\n- TaskRunning"));
    }

    #[test]
    fn context_materializer_includes_task_goal_and_ledger_summary() {
        let input = ContextMaterializerInput {
            task: task_record(),
            ledger_events: vec![LedgerEvent {
                event_id: "event_1".into(),
                task_id: "task_1".into(),
                run_id: "run_1".into(),
                kind: LedgerEventKind::TaskStarted,
                timestamp: "2026-01-01T00:00:00Z".into(),
                payload: None,
            }],
        };

        let materialized = ContextMaterializer::materialize(input);
        assert_eq!(materialized.goal, "Ship Phase 1.2");
        assert_eq!(materialized.ledger_summary, vec!["TaskStarted"]);
        assert_eq!(materialized.context_window.total_events, 1);
        assert_eq!(materialized.context_window.included_events, 1);
        assert_eq!(materialized.context_window.omitted_events, 0);
        assert_eq!(
            materialized.mode_policy_summary,
            Some("Mode Policy:\n<unresolved>".into())
        );
    }

    #[test]
    fn context_materializer_bounds_ledger_summary_to_recent_events() {
        let kinds = [
            LedgerEventKind::TaskStarted,
            LedgerEventKind::ModeResolved,
            LedgerEventKind::PermissionChecked,
            LedgerEventKind::ToolPlanned,
            LedgerEventKind::ToolPermissionChecked,
            LedgerEventKind::ToolPlanApproved,
            LedgerEventKind::AgentLoopStarted,
            LedgerEventKind::PromptBuilt,
            LedgerEventKind::LlmRequestCreated,
            LedgerEventKind::LlmResponseReceived,
            LedgerEventKind::ToolIntentParsed,
            LedgerEventKind::ToolIntentPermissionChecked,
            LedgerEventKind::ToolExecutionRequested,
            LedgerEventKind::ToolExecutionCompleted,
            LedgerEventKind::TaskCompleted,
        ];
        let input = ContextMaterializerInput {
            task: task_record(),
            ledger_events: kinds
                .iter()
                .enumerate()
                .map(|(index, kind)| LedgerEvent {
                    event_id: format!("event_{index}"),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: kind.clone(),
                    timestamp: "2026-01-01T00:00:00Z".into(),
                    payload: None,
                })
                .collect(),
        };

        let materialized = ContextMaterializer::materialize(input);
        assert_eq!(materialized.context_window.total_events, kinds.len());
        assert_eq!(
            materialized.context_window.included_events,
            MAX_LEDGER_CONTEXT_EVENTS
        );
        assert_eq!(materialized.context_window.omitted_events, 3);
        assert_eq!(materialized.ledger_summary.len(), MAX_LEDGER_CONTEXT_EVENTS);
        assert_eq!(materialized.ledger_summary.first().unwrap(), "ToolPlanned");
        assert_eq!(materialized.ledger_summary.last().unwrap(), "TaskCompleted");
        assert!(!materialized
            .ledger_summary
            .contains(&"TaskStarted".to_string()));

        let prompt = PromptBuilder::build(materialized);
        assert!(prompt.messages[1].content.contains("Context Window:"));
        assert!(prompt.messages[1].content.contains("omitted_events: 3"));
        assert!(prompt.messages[1]
            .content
            .contains("first_included_event: ToolPlanned"));
    }

    #[test]
    fn context_materializer_includes_mode_policy_summary_from_ledger() {
        let input = ContextMaterializerInput {
            task: task_record(),
            ledger_events: vec![LedgerEvent {
                event_id: "event_1".into(),
                task_id: "task_1".into(),
                run_id: "run_1".into(),
                kind: LedgerEventKind::ModeResolved,
                timestamp: "2026-01-01T00:00:00Z".into(),
                payload: Some(serde_json::json!({
                    "mode_id": "orchestrator",
                    "display_name": "Orchestrator",
                    "permissions": {
                        "read_only": true,
                        "workspace_write": false,
                        "process_exec": false,
                        "network_access": false,
                        "service_control": false,
                        "destructive": false,
                        "can_spawn_subtasks": true
                    }
                })),
            }],
        };

        let materialized = ContextMaterializer::materialize(input);
        let summary = materialized.mode_policy_summary.expect("mode summary");
        assert!(summary.contains("mode_id: orchestrator"));
        assert!(summary.contains("workspace_write: false"));
        assert!(summary.contains("can_spawn_subtasks: true"));
    }

    #[test]
    fn context_materializer_includes_permission_summary() {
        let input = ContextMaterializerInput {
            task: task_record(),
            ledger_events: vec![LedgerEvent {
                event_id: "event_1".into(),
                task_id: "task_1".into(),
                run_id: "run_1".into(),
                kind: LedgerEventKind::PermissionChecked,
                timestamp: "2026-01-01T00:00:00Z".into(),
                payload: Some(serde_json::json!({
                    "mode_id": "orchestrator",
                    "action": "WriteWorkspace",
                    "allowed": false,
                    "reason": "Mode orchestrator does not allow workspace writes."
                })),
            }],
        };

        let materialized = ContextMaterializer::materialize(input);
        assert_eq!(
            materialized.permission_summary,
            vec!["WriteWorkspace: denied"]
        );
        let prompt = PromptBuilder::build(materialized);
        assert!(prompt.messages[1].content.contains("Permission Checks:"));
        assert!(prompt.messages[1]
            .content
            .contains("- WriteWorkspace: denied"));
    }

    #[test]
    fn context_materializer_includes_assistant_tool_intent_summary() {
        let input = ContextMaterializerInput {
            task: task_record(),
            ledger_events: vec![
                LedgerEvent {
                    event_id: "event_1".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::ToolIntentPermissionChecked,
                    timestamp: "2026-01-01T00:00:00Z".into(),
                    payload: Some(serde_json::json!({"tool_id":"workspace.read","allowed":true})),
                },
                LedgerEvent {
                    event_id: "event_2".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::ToolIntentRejected,
                    timestamp: "2026-01-01T00:00:01Z".into(),
                    payload: Some(
                        serde_json::json!({"tool_id":"unknown.tool","reason":"Unknown tool id."}),
                    ),
                },
            ],
        };

        let materialized = ContextMaterializer::materialize(input);
        assert_eq!(
            materialized.tool_intent_summary,
            vec!["workspace.read: allowed", "unknown.tool: rejected"]
        );
    }

    #[test]
    fn context_materializer_and_prompt_include_tool_execution_summary() {
        let input = ContextMaterializerInput {
            task: task_record(),
            ledger_events: vec![LedgerEvent {
                event_id: "event_1".into(),
                task_id: "task_1".into(),
                run_id: "run_1".into(),
                kind: LedgerEventKind::ToolExecutionCompleted,
                timestamp: "2026-01-01T00:00:00Z".into(),
                payload: Some(serde_json::json!({
                    "tool_id": "workspace.read",
                    "status": "Completed",
                    "bytes_read": 123,
                    "truncated": false,
                    "output_preview": "# Brownie"
                })),
            }],
        };

        let materialized = ContextMaterializer::materialize(input);
        assert_eq!(
            materialized.tool_execution_summary,
            vec!["workspace.read: Completed bytes_read=123 truncated=false"]
        );
        let prompt = PromptBuilder::build(materialized);
        assert!(prompt.messages[1].content.contains("Tool Execution:"));
        assert!(prompt.messages[1]
            .content
            .contains("- workspace.read: Completed bytes_read=123 truncated=false"));
    }

    #[test]
    fn context_materializer_and_prompt_include_subtask_orchestration_summary() {
        let input = ContextMaterializerInput {
            task: task_record(),
            ledger_events: vec![
                LedgerEvent {
                    event_id: "event_1".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::SubtaskOrchestrationQueued,
                    timestamp: "2026-01-01T00:00:00Z".into(),
                    payload: Some(serde_json::json!({
                        "subtask_id": "subtask_run_1_1",
                        "tool_id": "subtask.spawn",
                        "status": "Queued",
                        "queue_position": 1,
                        "execution_enabled": false,
                        "requested_goal_preview": "Review parser boundary.",
                        "requested_mode_id": "implementer",
                        "input_summary": {
                            "has_path": false,
                            "field_count": 2
                        }
                    })),
                },
                LedgerEvent {
                    event_id: "event_2".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::SubtaskHandoffPrepared,
                    timestamp: "2026-01-01T00:00:01Z".into(),
                    payload: Some(serde_json::json!({
                        "handoff_id": "subtask_handoff_run_1_1",
                        "status": "Prepared",
                        "queued_count": 1,
                        "execution_enabled": false,
                        "next_action": "await_future_runtime_scheduler"
                    })),
                },
                LedgerEvent {
                    event_id: "event_3".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::SubtaskSchedulerReadinessRecorded,
                    timestamp: "2026-01-01T00:00:02Z".into(),
                    payload: Some(serde_json::json!({
                        "readiness_id": "subtask_scheduler_readiness_run_1_1",
                        "readiness_status": "Blocked",
                        "handoff_count": 1,
                        "queued_count": 1,
                        "dispatch_enabled": false,
                        "next_action": "await_runtime_scheduler_dispatch"
                    })),
                },
                LedgerEvent {
                    event_id: "event_4".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::SubtaskDispatchPlanPrepared,
                    timestamp: "2026-01-01T00:00:03Z".into(),
                    payload: Some(serde_json::json!({
                        "plan_id": "subtask_dispatch_plan_run_1_1",
                        "dispatch_plan_status": "Blocked",
                        "readiness_count": 1,
                        "queued_count": 1,
                        "dispatch_enabled": false,
                        "next_action": "await_runtime_subtask_dispatcher"
                    })),
                },
                LedgerEvent {
                    event_id: "event_5".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::SubtaskDispatchContractPrepared,
                    timestamp: "2026-01-01T00:00:04Z".into(),
                    payload: Some(serde_json::json!({
                        "contract_id": "subtask_dispatch_contract_run_1_1",
                        "dispatch_contract_status": "Blocked",
                        "plan_count": 1,
                        "queued_count": 1,
                        "eligibility_status": "Blocked",
                        "dispatch_enabled": false,
                        "next_action": "await_dispatch_contract_implementation"
                    })),
                },
                LedgerEvent {
                    event_id: "event_6".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::SubtaskDispatchAdmissionEvaluated,
                    timestamp: "2026-01-01T00:00:05Z".into(),
                    payload: Some(serde_json::json!({
                        "admission_id": "subtask_dispatch_admission_run_1_1",
                        "admission_status": "Blocked",
                        "contract_count": 1,
                        "queued_count": 1,
                        "execution_gate_status": "Blocked",
                        "dispatch_enabled": false,
                        "next_action": "await_dispatch_admission_preconditions"
                    })),
                },
                LedgerEvent {
                    event_id: "event_7".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::SubtaskDispatchReadinessSnapshotRecorded,
                    timestamp: "2026-01-01T00:00:06Z".into(),
                    payload: Some(serde_json::json!({
                        "snapshot_id": "subtask_dispatch_readiness_snapshot_run_1_1",
                        "readiness_status": "Blocked",
                        "admission_count": 1,
                        "queued_count": 1,
                        "scheduler_handoff_status": "Blocked",
                        "dispatch_enabled": false,
                        "fingerprint_input_count": 12,
                        "next_action": "await_dispatch_readiness_snapshot_handoff"
                    })),
                },
                LedgerEvent {
                    event_id: "event_8".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::SubtaskDispatcherGuardVerdictRecorded,
                    timestamp: "2026-01-01T00:00:07Z".into(),
                    payload: Some(serde_json::json!({
                        "guard_id": "subtask_dispatcher_guard_run_1_1",
                        "guard_status": "Blocked",
                        "snapshot_count": 1,
                        "queued_count": 1,
                        "handoff_preflight_status": "Blocked",
                        "dispatch_enabled": false,
                        "snapshot_validity_status": "Current",
                        "next_action": "await_dispatcher_guard_preconditions"
                    })),
                },
                LedgerEvent {
                    event_id: "event_9".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::SubtaskDispatchDecisionRecorded,
                    timestamp: "2026-01-01T00:00:08Z".into(),
                    payload: Some(serde_json::json!({
                        "decision_id": "subtask_dispatch_decision_run_1_1",
                        "decision_status": "Blocked",
                        "guard_count": 1,
                        "candidate_status": "Blocked",
                        "dispatch_candidate_count": 1,
                        "eligible_candidate_count": 0,
                        "dispatch_enabled": false,
                        "next_action": "await_dispatch_decision_preconditions"
                    })),
                },
                LedgerEvent {
                    event_id: "event_10".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::SubtaskDispatchCandidateManifestRecorded,
                    timestamp: "2026-01-01T00:00:09Z".into(),
                    payload: Some(serde_json::json!({
                        "manifest_id": "subtask_dispatch_candidate_manifest_run_1_1",
                        "manifest_status": "Blocked",
                        "decision_count": 1,
                        "candidate_count": 1,
                        "blocked_candidate_count": 1,
                        "eligible_candidate_count": 0,
                        "dispatch_enabled": false,
                        "next_action": "await_dispatch_candidate_manifest_preconditions"
                    })),
                },
                LedgerEvent {
                    event_id: "event_11".into(),
                    task_id: "task_1".into(),
                    run_id: "run_1".into(),
                    kind: LedgerEventKind::SubtaskDispatchHandoffEnvelopeRecorded,
                    timestamp: "2026-01-01T00:00:10Z".into(),
                    payload: Some(serde_json::json!({
                        "handoff_envelope_id": "subtask_dispatch_handoff_envelope_run_1_1",
                        "handoff_envelope_status": "Blocked",
                        "manifest_count": 1,
                        "candidate_count": 1,
                        "handoff_ticket_count": 0,
                        "replay_guard_status": "Blocked",
                        "dispatch_enabled": false,
                        "next_action": "await_dispatch_handoff_envelope_preconditions"
                    })),
                },
            ],
        };

        let materialized = ContextMaterializer::materialize(input);
        assert_eq!(
            materialized.subtask_orchestration_summary,
            vec![
                "subtask_run_1_1: Queued tool_id=subtask.spawn queue_position=1 execution_enabled=false requested_goal_preview=Review parser boundary. requested_mode_id=implementer",
                "subtask_handoff_run_1_1: Prepared queued_count=1 execution_enabled=false next_action=await_future_runtime_scheduler",
                "subtask_scheduler_readiness_run_1_1: Blocked handoff_count=1 queued_count=1 dispatch_enabled=false next_action=await_runtime_scheduler_dispatch",
                "subtask_dispatch_plan_run_1_1: Blocked readiness_count=1 queued_count=1 dispatch_enabled=false next_action=await_runtime_subtask_dispatcher",
                "subtask_dispatch_contract_run_1_1: Blocked plan_count=1 queued_count=1 eligibility_status=Blocked dispatch_enabled=false next_action=await_dispatch_contract_implementation",
                "subtask_dispatch_admission_run_1_1: Blocked contract_count=1 queued_count=1 execution_gate_status=Blocked dispatch_enabled=false next_action=await_dispatch_admission_preconditions",
                "subtask_dispatch_readiness_snapshot_run_1_1: Blocked admission_count=1 queued_count=1 scheduler_handoff_status=Blocked dispatch_enabled=false fingerprint_input_count=12 next_action=await_dispatch_readiness_snapshot_handoff",
                "subtask_dispatcher_guard_run_1_1: Blocked snapshot_count=1 queued_count=1 handoff_preflight_status=Blocked dispatch_enabled=false snapshot_validity_status=Current next_action=await_dispatcher_guard_preconditions",
                "subtask_dispatch_decision_run_1_1: Blocked guard_count=1 candidate_status=Blocked dispatch_candidate_count=1 eligible_candidate_count=0 dispatch_enabled=false next_action=await_dispatch_decision_preconditions",
                "subtask_dispatch_candidate_manifest_run_1_1: Blocked decision_count=1 candidate_count=1 blocked_candidate_count=1 eligible_candidate_count=0 dispatch_enabled=false next_action=await_dispatch_candidate_manifest_preconditions",
                "subtask_dispatch_handoff_envelope_run_1_1: Blocked manifest_count=1 candidate_count=1 handoff_ticket_count=0 replay_guard_status=Blocked dispatch_enabled=false next_action=await_dispatch_handoff_envelope_preconditions"
            ]
        );
        let prompt = PromptBuilder::build(materialized);
        assert!(prompt.messages[1]
            .content
            .contains("Subtask Orchestration:"));
        assert!(prompt.messages[1]
            .content
            .contains("- subtask_run_1_1: Queued tool_id=subtask.spawn queue_position=1 execution_enabled=false requested_goal_preview=Review parser boundary. requested_mode_id=implementer"));
        assert!(prompt.messages[1]
            .content
            .contains("- subtask_handoff_run_1_1: Prepared queued_count=1 execution_enabled=false next_action=await_future_runtime_scheduler"));
        assert!(prompt.messages[1]
            .content
            .contains("- subtask_scheduler_readiness_run_1_1: Blocked handoff_count=1 queued_count=1 dispatch_enabled=false next_action=await_runtime_scheduler_dispatch"));
        assert!(prompt.messages[1]
            .content
            .contains("- subtask_dispatch_plan_run_1_1: Blocked readiness_count=1 queued_count=1 dispatch_enabled=false next_action=await_runtime_subtask_dispatcher"));
        assert!(prompt.messages[1]
            .content
            .contains("- subtask_dispatch_contract_run_1_1: Blocked plan_count=1 queued_count=1 eligibility_status=Blocked dispatch_enabled=false next_action=await_dispatch_contract_implementation"));
        assert!(prompt.messages[1]
            .content
            .contains("- subtask_dispatch_admission_run_1_1: Blocked contract_count=1 queued_count=1 execution_gate_status=Blocked dispatch_enabled=false next_action=await_dispatch_admission_preconditions"));
        assert!(prompt.messages[1]
            .content
            .contains("- subtask_dispatch_readiness_snapshot_run_1_1: Blocked admission_count=1 queued_count=1 scheduler_handoff_status=Blocked dispatch_enabled=false fingerprint_input_count=12 next_action=await_dispatch_readiness_snapshot_handoff"));
        assert!(prompt.messages[1]
            .content
            .contains("- subtask_dispatcher_guard_run_1_1: Blocked snapshot_count=1 queued_count=1 handoff_preflight_status=Blocked dispatch_enabled=false snapshot_validity_status=Current next_action=await_dispatcher_guard_preconditions"));
        assert!(prompt.messages[1]
            .content
            .contains("- subtask_dispatch_decision_run_1_1: Blocked guard_count=1 candidate_status=Blocked dispatch_candidate_count=1 eligible_candidate_count=0 dispatch_enabled=false next_action=await_dispatch_decision_preconditions"));
        assert!(prompt.messages[1]
            .content
            .contains("- subtask_dispatch_candidate_manifest_run_1_1: Blocked decision_count=1 candidate_count=1 blocked_candidate_count=1 eligible_candidate_count=0 dispatch_enabled=false next_action=await_dispatch_candidate_manifest_preconditions"));
        assert!(prompt.messages[1]
            .content
            .contains("- subtask_dispatch_handoff_envelope_run_1_1: Blocked manifest_count=1 candidate_count=1 handoff_ticket_count=0 replay_guard_status=Blocked dispatch_enabled=false next_action=await_dispatch_handoff_envelope_preconditions"));
    }

    #[test]
    fn truncator_preserves_system_message_and_task_goal() {
        let prompt = PromptView {
            messages: vec![
                PromptMessage {
                    role: PromptRole::System,
                    content: "system".into(),
                },
                PromptMessage {
                    role: PromptRole::Assistant,
                    content: "x".repeat(1000),
                },
                PromptMessage {
                    role: PromptRole::User,
                    content: "Goal:\nkeep me".into(),
                },
            ],
        };

        let truncated = SlidingWindowTruncator::truncate(
            prompt,
            TokenBudget {
                max_prompt_chars: 10,
            },
        );
        assert_eq!(truncated.messages.len(), 2);
        assert_eq!(truncated.messages[0].content, "system");
        assert!(truncated.messages[1].content.contains("keep me"));
    }
}
