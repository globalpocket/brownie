//! Brownie runtime entry points.

use brownie_agent_loop::{AgentLoop, AgentLoopState};
use brownie_context::{ContextMaterializer, ContextMaterializerInput};
use brownie_protocol::{
    JsonRpcError, JsonRpcRequest, JsonRpcResponse, RuntimeState, RuntimeStatus, TaskGetParams,
    TaskListResult, TaskRunParams, TaskRunResult, TaskStartParams, TaskStartResult, TaskStatus,
};
use brownie_store::{BrownieStore, LedgerEventKind};
use serde_json::{json, Value};

const JSONRPC_VERSION: &str = "2.0";
const METHOD_RUNTIME_STATUS: &str = "runtime.status";
const METHOD_TASK_START: &str = "task.start";
const METHOD_TASK_GET: &str = "task.get";
const METHOD_TASK_RUN: &str = "task.run";
const METHOD_TASK_LIST: &str = "task.list";

pub fn runtime_status() -> RuntimeStatus {
    RuntimeStatus {
        name: "brownie-runtime".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        status: RuntimeState::Ready,
    }
}

pub fn handle_jsonrpc_input_line(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let response = match serde_json::from_str::<JsonRpcRequest>(trimmed) {
        Ok(request) => handle_jsonrpc_request(request),
        Err(error) => parse_error_response(error),
    };

    Some(serde_json::to_string(&response).expect("JSON-RPC response should serialize"))
}

pub fn handle_jsonrpc_request(request: JsonRpcRequest) -> JsonRpcResponse<Value> {
    if request.jsonrpc != JSONRPC_VERSION {
        return error_response(request.id, -32600, "invalid JSON-RPC version");
    }

    match request.method.as_str() {
        METHOD_RUNTIME_STATUS => result_response(request.id, json!(runtime_status())),
        METHOD_TASK_START => handle_task_start(request.id, request.params),
        METHOD_TASK_GET => handle_task_get(request.id, request.params),
        METHOD_TASK_RUN => handle_task_run(request.id, request.params),
        METHOD_TASK_LIST => handle_task_list(request.id),
        _ => error_response(request.id, -32601, "method not found"),
    }
}

fn handle_task_start(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: TaskStartParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };

    if params.goal.trim().is_empty() {
        return error_response(id, -32602, "invalid params: goal must not be empty");
    }

    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };

    match store.tasks().start_task(params) {
        Ok(record) => result_response(
            id,
            json!(TaskStartResult {
                task_id: record.task_id,
                run_id: record.run_id,
                status: record.status,
            }),
        ),
        Err(error) => error_response(id, -32603, &format!("internal error: {error}")),
    }
}

fn handle_task_get(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: TaskGetParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };

    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };

    match store.tasks().get_task(&params.task_id) {
        Ok(Some(record)) => result_response(id, json!(record)),
        Ok(None) => error_response(id, -32602, "invalid params: task not found"),
        Err(error) => error_response(id, -32603, &format!("internal error: {error}")),
    }
}

fn handle_task_run(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: TaskRunParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };

    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };

    let record = match store.tasks().get_task(&params.task_id) {
        Ok(Some(record)) => record,
        Ok(None) => return error_response(id, -32602, "invalid params: task not found"),
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };

    if record.status != TaskStatus::Created {
        return error_response(id, -32602, "invalid params: task must be Created");
    }

    let running = match store.tasks().update_task_status(
        &record.task_id,
        TaskStatus::Running,
        LedgerEventKind::TaskRunning,
    ) {
        Ok(record) => record,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };

    let ledger_events = match store.tasks().read_ledger_events(&running.run_id) {
        Ok(events) => events,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };
    let prompt_input = ContextMaterializer::materialize(ContextMaterializerInput {
        task: running.clone(),
        ledger_events,
    });
    let result = AgentLoop::run_with_fake_llm(prompt_input);

    if let Err(error) = store.tasks().append_task_event_with_payload(
        &running,
        LedgerEventKind::PromptBuilt,
        Some(json!({
            "message_count": result.prompt.messages.len(),
            "prompt_preview": preview_prompt(&result.prompt),
        })),
    ) {
        return error_response(id, -32603, &format!("internal error: {error}"));
    }
    if let Err(error) = store.tasks().append_task_event_with_payload(
        &running,
        LedgerEventKind::LlmRequestCreated,
        Some(json!({
            "model": result.llm_request.model.clone(),
            "message_count": result.llm_request.messages.len(),
        })),
    ) {
        return error_response(id, -32603, &format!("internal error: {error}"));
    }
    if let Err(error) = store.tasks().append_task_event_with_payload(
        &running,
        LedgerEventKind::LlmResponseReceived,
        Some(json!({
            "content_preview": preview(&result.llm_response.content),
        })),
    ) {
        return error_response(id, -32603, &format!("internal error: {error}"));
    }

    let final_status = match result.final_state {
        AgentLoopState::Completed => TaskStatus::Completed,
        AgentLoopState::Cancelled => TaskStatus::Cancelled,
        AgentLoopState::Failed => TaskStatus::Failed,
        _ => TaskStatus::Failed,
    };
    let event_kind = match final_status {
        TaskStatus::Completed => LedgerEventKind::TaskCompleted,
        TaskStatus::Cancelled => LedgerEventKind::TaskCancelled,
        TaskStatus::Failed => LedgerEventKind::TaskFailed,
        TaskStatus::Created | TaskStatus::Running => LedgerEventKind::TaskFailed,
    };

    match store
        .tasks()
        .update_task_status(&running.task_id, final_status, event_kind)
    {
        Ok(record) => result_response(
            id,
            json!(TaskRunResult {
                task_id: record.task_id,
                run_id: record.run_id,
                status: record.status,
            }),
        ),
        Err(error) => error_response(id, -32603, &format!("internal error: {error}")),
    }
}

fn handle_task_list(id: Value) -> JsonRpcResponse<Value> {
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };

    match store.tasks().list_tasks() {
        Ok(tasks) => result_response(id, json!(TaskListResult { tasks })),
        Err(error) => error_response(id, -32603, &format!("internal error: {error}")),
    }
}

fn preview_prompt(prompt: &brownie_context::PromptView) -> String {
    let joined = prompt
        .messages
        .iter()
        .map(|message| message.content.as_str())
        .collect::<Vec<_>>()
        .join("\n---\n");
    preview(&joined)
}

fn preview(content: &str) -> String {
    const MAX_PREVIEW_CHARS: usize = 200;
    content.chars().take(MAX_PREVIEW_CHARS).collect()
}

fn parse_params<T: serde::de::DeserializeOwned>(params: Option<Value>) -> Result<T, String> {
    let params = params.ok_or_else(|| "invalid params: missing params".to_string())?;
    serde_json::from_value(params).map_err(|error| format!("invalid params: {error}"))
}

fn parse_error_response(error: serde_json::Error) -> JsonRpcResponse<Value> {
    JsonRpcResponse {
        jsonrpc: JSONRPC_VERSION.to_string(),
        id: Value::Null,
        result: None,
        error: Some(JsonRpcError {
            code: -32700,
            message: format!("parse error: {error}"),
        }),
    }
}

fn result_response(id: Value, result: Value) -> JsonRpcResponse<Value> {
    JsonRpcResponse {
        jsonrpc: JSONRPC_VERSION.to_string(),
        id,
        result: Some(result),
        error: None,
    }
}

fn error_response(id: Value, code: i64, message: &str) -> JsonRpcResponse<Value> {
    JsonRpcResponse {
        jsonrpc: JSONRPC_VERSION.to_string(),
        id,
        result: None,
        error: Some(JsonRpcError {
            code,
            message: message.to_string(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use brownie_protocol::{TaskRecord, TaskStatus};
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn parse_line(line: &str) -> JsonRpcResponse<Value> {
        serde_json::from_str(&handle_jsonrpc_input_line(line).expect("response line"))
            .expect("valid response")
    }

    #[test]
    fn runtime_status_reports_ready() {
        let status = runtime_status();
        assert_eq!(status.name, "brownie-runtime");
        assert_eq!(status.status, RuntimeState::Ready);
    }

    #[test]
    fn handles_runtime_status_input_line() {
        let response = parse_line(r#"{"jsonrpc":"2.0","id":1,"method":"runtime.status"}"#);
        assert!(response.error.is_none());
        assert_eq!(response.id, Value::from(1));
        assert_eq!(
            response.result.expect("status result")["name"],
            "brownie-runtime"
        );
    }

    #[test]
    fn task_start_get_and_list_through_jsonrpc() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let temp = tempfile::tempdir().expect("tempdir");
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());

        let start = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"task.start","params":{"goal":"Implement something","mode_id":"orchestrator"}}"#,
        );
        assert!(start.error.is_none());
        let result = start.result.expect("start result");
        assert_eq!(result["status"], "Created");
        let task_id = result["task_id"].as_str().expect("task id").to_string();
        let run_id = result["run_id"].as_str().expect("run id").to_string();
        assert!(temp
            .path()
            .join(".brownie/runs")
            .join(&run_id)
            .join("state.json")
            .exists());
        assert!(temp
            .path()
            .join(".brownie/runs")
            .join(&run_id)
            .join("ledger.jsonl")
            .exists());

        let get = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":2,"method":"task.get","params":{{"task_id":"{task_id}"}}}}"#
        ));
        let record: TaskRecord =
            serde_json::from_value(get.result.expect("get result")).expect("task record");
        assert_eq!(record.task_id, task_id);
        assert_eq!(record.status, TaskStatus::Created);

        let list = parse_line(r#"{"jsonrpc":"2.0","id":3,"method":"task.list"}"#);
        assert_eq!(
            list.result.expect("list result")["tasks"]
                .as_array()
                .expect("tasks")
                .len(),
            1
        );

        std::env::remove_var("BROWNIE_WORKSPACE_ROOT");
    }

    #[test]
    fn task_run_changes_created_to_completed_through_jsonrpc() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let temp = tempfile::tempdir().expect("tempdir");
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());

        let start = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"task.start","params":{"goal":"Run no-op","mode_id":"orchestrator"}}"#,
        );
        let start_result = start.result.expect("start result");
        let task_id = start_result["task_id"]
            .as_str()
            .expect("task id")
            .to_string();
        let run_id = start_result["run_id"].as_str().expect("run id").to_string();

        let run = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":2,"method":"task.run","params":{{"task_id":"{task_id}"}}}}"#
        ));
        assert!(run.error.is_none());
        let result = run.result.expect("run result");
        assert_eq!(result["task_id"], task_id);
        assert_eq!(result["run_id"], run_id);
        assert_eq!(result["status"], "Completed");

        let get = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":3,"method":"task.get","params":{{"task_id":"{task_id}"}}}}"#
        ));
        let record: TaskRecord =
            serde_json::from_value(get.result.expect("get result")).expect("task record");
        assert_eq!(record.status, TaskStatus::Completed);

        let state: TaskRecord = serde_json::from_str(
            &std::fs::read_to_string(
                temp.path()
                    .join(".brownie/runs")
                    .join(&run_id)
                    .join("state.json"),
            )
            .expect("state"),
        )
        .expect("state record");
        assert_eq!(state.status, TaskStatus::Completed);

        let ledger = std::fs::read_to_string(
            temp.path()
                .join(".brownie/runs")
                .join(&run_id)
                .join("ledger.jsonl"),
        )
        .expect("ledger");
        assert!(ledger.contains("TaskStarted"));
        assert!(ledger.contains("TaskRunning"));
        assert!(ledger.contains("PromptBuilt"));
        assert!(ledger.contains("LlmRequestCreated"));
        assert!(ledger.contains("LlmResponseReceived"));
        assert!(ledger.contains("TaskCompleted"));
        let events: Vec<LedgerEventKind> = ledger
            .lines()
            .map(|line| {
                serde_json::from_str::<brownie_store::LedgerEvent>(line)
                    .expect("event")
                    .kind
            })
            .collect();
        assert_eq!(
            events,
            vec![
                LedgerEventKind::TaskStarted,
                LedgerEventKind::TaskRunning,
                LedgerEventKind::PromptBuilt,
                LedgerEventKind::LlmRequestCreated,
                LedgerEventKind::LlmResponseReceived,
                LedgerEventKind::TaskCompleted,
            ]
        );

        std::env::remove_var("BROWNIE_WORKSPACE_ROOT");
    }

    #[test]
    fn task_run_unknown_task_returns_invalid_params() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let temp = tempfile::tempdir().expect("tempdir");
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());

        let response = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"task.run","params":{"task_id":"task_missing"}}"#,
        );
        assert!(response.result.is_none());
        assert_eq!(response.error.expect("error").code, -32602);

        std::env::remove_var("BROWNIE_WORKSPACE_ROOT");
    }

    #[test]
    fn task_run_completed_task_returns_invalid_params() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let temp = tempfile::tempdir().expect("tempdir");
        std::env::set_var("BROWNIE_WORKSPACE_ROOT", temp.path());

        let start = parse_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"task.start","params":{"goal":"Run once","mode_id":null}}"#,
        );
        let task_id = start.result.expect("start result")["task_id"]
            .as_str()
            .expect("task id")
            .to_string();
        let first = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":2,"method":"task.run","params":{{"task_id":"{task_id}"}}}}"#
        ));
        assert!(first.error.is_none());

        let second = parse_line(&format!(
            r#"{{"jsonrpc":"2.0","id":3,"method":"task.run","params":{{"task_id":"{task_id}"}}}}"#
        ));
        assert!(second.result.is_none());
        assert_eq!(second.error.expect("error").code, -32602);

        std::env::remove_var("BROWNIE_WORKSPACE_ROOT");
    }

    #[test]
    fn task_start_with_empty_goal_returns_invalid_params() {
        let response = parse_line(
            r#"{"jsonrpc":"2.0","id":4,"method":"task.start","params":{"goal":"   ","mode_id":null}}"#,
        );
        assert!(response.result.is_none());
        assert_eq!(response.error.expect("error").code, -32602);
    }

    #[test]
    fn unknown_method_returns_method_not_found() {
        let response = parse_line(r#"{"jsonrpc":"2.0","id":2,"method":"runtime.unknown"}"#);
        assert_eq!(response.error.expect("error").code, -32601);
    }

    #[test]
    fn invalid_json_returns_parse_error() {
        let response = parse_line("not json");
        assert_eq!(response.id, Value::Null);
        assert_eq!(response.error.expect("error").code, -32700);
    }

    #[test]
    fn empty_line_is_ignored() {
        assert_eq!(handle_jsonrpc_input_line("  \t "), None);
    }
}
