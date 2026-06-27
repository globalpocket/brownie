//! Runtime tool abstraction crate.

use brownie_agentmodes::{CompiledModePolicy, RuntimeAction, RuntimePermissionGate};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolSideEffectLevel {
    ReadOnly,
    WorkspaceWrite,
    ProcessExec,
    NetworkAccess,
    ServiceControl,
    Destructive,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolDefinition {
    pub tool_id: String,
    pub display_name: String,
    pub description: String,
    pub required_action: RuntimeAction,
    pub input_schema: ToolInputSchema,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolInputSchema {
    pub fields: Vec<ToolInputField>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolInputField {
    pub name: String,
    pub required: bool,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolPlanItem {
    pub tool_id: String,
    pub reason: String,
    pub required_action: RuntimeAction,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolPlan {
    pub items: Vec<ToolPlanItem>,
}

pub struct BuiltinToolRegistry;

impl BuiltinToolRegistry {
    pub fn list() -> Vec<ToolDefinition> {
        vec![
            tool("workspace.read", "Workspace Read", "Dry-run definition for workspace read requests.", RuntimeAction::ReadWorkspace),
            tool("workspace.write", "Workspace Write", "Dry-run definition for workspace write requests; no writes are executed in Phase 1.6.", RuntimeAction::WriteWorkspace),
            tool("process.exec", "Process Exec", "Dry-run definition for process execution requests; no commands are executed in Phase 1.6.", RuntimeAction::ExecuteProcess),
            tool("subtask.spawn", "Subtask Spawn", "Dry-run definition for subtask spawn requests; no subtasks are spawned in Phase 1.6.", RuntimeAction::SpawnSubtask),
            tool("network.access", "Network Access", "Dry-run definition for network access requests.", RuntimeAction::AccessNetwork),
            tool("service.control", "Service Control", "Dry-run definition for service control requests.", RuntimeAction::ControlService),
            tool("destructive.operation", "Destructive Operation", "Dry-run definition for destructive operation requests.", RuntimeAction::DestructiveOperation),
        ]
    }
    pub fn get(tool_id: &str) -> Option<ToolDefinition> {
        Self::list()
            .into_iter()
            .find(|tool| tool.tool_id == tool_id)
    }
}

fn tool(
    tool_id: &str,
    display_name: &str,
    description: &str,
    required_action: RuntimeAction,
) -> ToolDefinition {
    ToolDefinition {
        tool_id: tool_id.to_string(),
        display_name: display_name.to_string(),
        description: description.to_string(),
        required_action,
        input_schema: ToolInputSchema { fields: Vec::new() },
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AssistantToolIntent {
    pub tool_requests: Vec<AssistantToolRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AssistantToolRequest {
    pub tool_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ParsedToolIntent {
    pub requests: Vec<AssistantToolRequest>,
    pub rejected: Vec<RejectedToolIntent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RejectedToolIntent {
    pub tool_id: Option<String>,
    pub reason: String,
}

pub struct ToolIntentParser;

impl ToolIntentParser {
    pub fn parse_assistant_content(content: &str) -> ParsedToolIntent {
        let Some(json_block) = extract_fenced_block(content) else {
            return ParsedToolIntent {
                requests: Vec::new(),
                rejected: Vec::new(),
            };
        };
        let value: Value = match serde_json::from_str(json_block.trim()) {
            Ok(value) => value,
            Err(error) => {
                return ParsedToolIntent {
                    requests: Vec::new(),
                    rejected: vec![RejectedToolIntent {
                        tool_id: None,
                        reason: format!("Invalid brownie-tool-intent JSON: {error}"),
                    }],
                }
            }
        };
        let Some(items) = value.get("tool_requests").and_then(Value::as_array) else {
            return ParsedToolIntent {
                requests: Vec::new(),
                rejected: vec![RejectedToolIntent {
                    tool_id: None,
                    reason: "tool_requests must be an array.".to_string(),
                }],
            };
        };
        let mut requests = Vec::new();
        let mut rejected = Vec::new();
        for item in items {
            let tool_id = item
                .get("tool_id")
                .and_then(Value::as_str)
                .map(str::to_string);
            let reason = item
                .get("reason")
                .and_then(Value::as_str)
                .map(str::to_string);
            match (tool_id, reason) {
                (Some(tool_id), Some(reason)) if BuiltinToolRegistry::get(&tool_id).is_some() => {
                    requests.push(AssistantToolRequest { tool_id, reason })
                }
                (Some(tool_id), Some(_)) => rejected.push(RejectedToolIntent {
                    tool_id: Some(tool_id),
                    reason: "Unknown tool id.".to_string(),
                }),
                (tool_id, _) => rejected.push(RejectedToolIntent {
                    tool_id,
                    reason: "tool_id and reason must be strings.".to_string(),
                }),
            }
        }
        ParsedToolIntent { requests, rejected }
    }
}

fn extract_fenced_block(content: &str) -> Option<&str> {
    let marker = "```brownie-tool-intent";
    let start = content.find(marker)? + marker.len();
    let rest = &content[start..];
    let rest = rest
        .strip_prefix('\r')
        .unwrap_or(rest)
        .strip_prefix('\n')
        .unwrap_or(rest);
    let end = rest.find("```")?;
    Some(&rest[..end])
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolIntentEvaluation {
    pub items: Vec<ToolIntentDecision>,
    pub rejected: Vec<RejectedToolIntent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolIntentDecision {
    pub tool_id: String,
    pub required_action: RuntimeAction,
    pub allowed: bool,
    pub reason: String,
    pub request_reason: String,
}

pub struct ToolIntentEvaluator;

impl ToolIntentEvaluator {
    pub fn evaluate(policy: &CompiledModePolicy, parsed: ParsedToolIntent) -> ToolIntentEvaluation {
        let mut rejected = parsed.rejected;
        let mut items = Vec::new();
        for request in parsed.requests {
            let Some(definition) = BuiltinToolRegistry::get(&request.tool_id) else {
                rejected.push(RejectedToolIntent {
                    tool_id: Some(request.tool_id),
                    reason: "Unknown tool id.".to_string(),
                });
                continue;
            };
            let decision = RuntimePermissionGate::check(policy, definition.required_action.clone());
            items.push(ToolIntentDecision {
                tool_id: definition.tool_id,
                required_action: definition.required_action,
                allowed: decision.allowed,
                reason: decision.reason,
                request_reason: request.reason,
            });
        }
        ToolIntentEvaluation { items, rejected }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolPlanningInput {
    pub task_id: String,
    pub goal: String,
    pub mode_id: String,
}

pub struct ToolPlanner;
impl ToolPlanner {
    pub fn plan(input: ToolPlanningInput) -> ToolPlan {
        let mut items = vec![plan_item(
            "workspace.read",
            "Every task may need workspace context.",
        )];
        let goal = input.goal.to_lowercase();
        if contains_any(
            &goal,
            &[
                "write",
                "edit",
                "modify",
                "implement",
                "修正",
                "編集",
                "実装",
            ],
        ) {
            items.push(plan_item(
                "workspace.write",
                "Goal suggests implementation or editing work.",
            ));
        }
        if contains_any(
            &goal,
            &["test", "check", "verify", "run", "検証", "テスト", "実行"],
        ) {
            items.push(plan_item(
                "process.exec",
                "Goal suggests running tests or checks.",
            ));
        }
        if input.mode_id == "orchestrator" {
            items.push(plan_item(
                "subtask.spawn",
                "Orchestrator mode may coordinate subtasks.",
            ));
        }
        ToolPlan { items }
    }
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}
fn plan_item(tool_id: &str, reason: &str) -> ToolPlanItem {
    let definition = BuiltinToolRegistry::get(tool_id).expect("built-in tool exists");
    ToolPlanItem {
        tool_id: definition.tool_id,
        reason: reason.to_string(),
        required_action: definition.required_action,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolPlanEvaluation {
    pub items: Vec<ToolPlanDecision>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolPlanDecision {
    pub tool_id: String,
    pub required_action: RuntimeAction,
    pub allowed: bool,
    pub reason: String,
}
pub struct ToolPlanEvaluator;
impl ToolPlanEvaluator {
    pub fn evaluate(policy: &CompiledModePolicy, plan: ToolPlan) -> ToolPlanEvaluation {
        let items = plan
            .items
            .into_iter()
            .map(|item| {
                let decision = RuntimePermissionGate::check(policy, item.required_action.clone());
                ToolPlanDecision {
                    tool_id: item.tool_id,
                    required_action: item.required_action,
                    allowed: decision.allowed,
                    reason: decision.reason,
                }
            })
            .collect();
        ToolPlanEvaluation { items }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use brownie_agentmodes::BuiltinModeRegistry;
    #[test]
    fn builtin_tool_registry_lists_required_tools() {
        let ids: Vec<_> = BuiltinToolRegistry::list()
            .into_iter()
            .map(|tool| tool.tool_id)
            .collect();
        assert_eq!(
            ids,
            vec![
                "workspace.read",
                "workspace.write",
                "process.exec",
                "subtask.spawn",
                "network.access",
                "service.control",
                "destructive.operation"
            ]
        );
    }
    #[test]
    fn planner_includes_expected_items() {
        let plan = ToolPlanner::plan(ToolPlanningInput {
            task_id: "task_1".into(),
            goal: "Implement and test".into(),
            mode_id: "orchestrator".into(),
        });
        let ids: Vec<_> = plan
            .items
            .iter()
            .map(|item| item.tool_id.as_str())
            .collect();
        assert!(ids.contains(&"workspace.read"));
        assert!(ids.contains(&"workspace.write"));
        assert!(ids.contains(&"process.exec"));
        assert!(ids.contains(&"subtask.spawn"));
    }
    #[test]
    fn evaluator_allows_and_denies_with_runtime_gate() {
        let policy = BuiltinModeRegistry::get("orchestrator").expect("policy");
        let plan = ToolPlanner::plan(ToolPlanningInput {
            task_id: "task_1".into(),
            goal: "Implement and test".into(),
            mode_id: "orchestrator".into(),
        });
        let evaluation = ToolPlanEvaluator::evaluate(&policy, plan);
        assert!(evaluation
            .items
            .iter()
            .any(|item| item.tool_id == "workspace.read" && item.allowed));
        assert!(evaluation
            .items
            .iter()
            .any(|item| item.tool_id == "workspace.write" && !item.allowed));
    }
    #[test]
    fn parser_parses_valid_fenced_json() {
        let parsed = ToolIntentParser::parse_assistant_content("x\n```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"workspace.read\",\"reason\":\"Need context.\"}]}\n```");
        assert_eq!(parsed.requests.len(), 1);
        assert!(parsed.rejected.is_empty());
    }
    #[test]
    fn parser_returns_empty_without_fence() {
        let parsed = ToolIntentParser::parse_assistant_content("none");
        assert!(parsed.requests.is_empty());
        assert!(parsed.rejected.is_empty());
    }
    #[test]
    fn parser_rejects_invalid_json_without_panic() {
        let parsed =
            ToolIntentParser::parse_assistant_content("```brownie-tool-intent\nnot-json\n```");
        assert!(parsed.requests.is_empty());
        assert_eq!(parsed.rejected.len(), 1);
    }
    #[test]
    fn parser_rejects_unknown_tool_id() {
        let parsed = ToolIntentParser::parse_assistant_content("```brownie-tool-intent\n{\"tool_requests\":[{\"tool_id\":\"unknown.tool\",\"reason\":\"Need it.\"}]}\n```");
        assert!(parsed.requests.is_empty());
        assert_eq!(parsed.rejected[0].tool_id.as_deref(), Some("unknown.tool"));
    }
    #[test]
    fn intent_evaluator_allows_read_and_denies_write_for_orchestrator() {
        let policy = BuiltinModeRegistry::get("orchestrator").expect("policy");
        let parsed = ParsedToolIntent {
            requests: vec![
                AssistantToolRequest {
                    tool_id: "workspace.read".into(),
                    reason: "Read".into(),
                },
                AssistantToolRequest {
                    tool_id: "workspace.write".into(),
                    reason: "Write".into(),
                },
            ],
            rejected: vec![],
        };
        let evaluation = ToolIntentEvaluator::evaluate(&policy, parsed);
        assert!(evaluation
            .items
            .iter()
            .any(|item| item.tool_id == "workspace.read" && item.allowed));
        assert!(evaluation
            .items
            .iter()
            .any(|item| item.tool_id == "workspace.write" && !item.allowed));
    }
}
