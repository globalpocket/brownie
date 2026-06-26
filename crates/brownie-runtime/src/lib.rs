//! Brownie runtime entry points.

use brownie_protocol::{
    JsonRpcError, JsonRpcRequest, JsonRpcResponse, RuntimeState, RuntimeStatus, TaskGetParams,
    TaskListResult, TaskStartParams, TaskStartResult,
};
use brownie_store::BrownieStore;
use serde_json::{json, Value};

const JSONRPC_VERSION: &str = "2.0";
const METHOD_RUNTIME_STATUS: &str = "runtime.status";
const METHOD_TASK_START: &str = "task.start";
const METHOD_TASK_GET: &str = "task.get";
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
