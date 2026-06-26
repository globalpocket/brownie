//! Brownie runtime entry points.

use brownie_protocol::{
    JsonRpcError, JsonRpcRequest, JsonRpcResponse, RuntimeState, RuntimeStatus,
};
use serde_json::Value;

const JSONRPC_VERSION: &str = "2.0";
const METHOD_RUNTIME_STATUS: &str = "runtime.status";

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

pub fn handle_jsonrpc_request(request: JsonRpcRequest) -> JsonRpcResponse<RuntimeStatus> {
    if request.jsonrpc != JSONRPC_VERSION {
        return error_response(request.id, -32600, "invalid JSON-RPC version");
    }

    match request.method.as_str() {
        METHOD_RUNTIME_STATUS => JsonRpcResponse {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id: request.id,
            result: Some(runtime_status()),
            error: None,
        },
        _ => error_response(request.id, -32601, "method not found"),
    }
}

fn parse_error_response(error: serde_json::Error) -> JsonRpcResponse<RuntimeStatus> {
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

fn error_response(id: Value, code: i64, message: &str) -> JsonRpcResponse<RuntimeStatus> {
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

    fn parse_line(line: &str) -> JsonRpcResponse<RuntimeStatus> {
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
    fn handles_runtime_status_jsonrpc_request() {
        let response = handle_jsonrpc_request(JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Value::from(1),
            method: "runtime.status".to_string(),
            params: None,
        });

        assert!(response.error.is_none());
        assert_eq!(response.id, Value::from(1));
        assert_eq!(
            response.result.expect("status result").status,
            RuntimeState::Ready
        );
    }

    #[test]
    fn handles_runtime_status_input_line() {
        let response = parse_line(r#"{"jsonrpc":"2.0","id":1,"method":"runtime.status"}"#);

        assert!(response.error.is_none());
        assert_eq!(response.id, Value::from(1));
        assert_eq!(
            response.result.expect("status result").name,
            "brownie-runtime"
        );
    }

    #[test]
    fn unknown_method_returns_method_not_found() {
        let response = parse_line(r#"{"jsonrpc":"2.0","id":2,"method":"runtime.unknown"}"#);

        assert!(response.result.is_none());
        assert_eq!(response.id, Value::from(2));
        assert_eq!(response.error.expect("error").code, -32601);
    }

    #[test]
    fn invalid_json_returns_parse_error() {
        let response = parse_line("not json");

        assert!(response.result.is_none());
        assert_eq!(response.id, Value::Null);
        assert_eq!(response.error.expect("error").code, -32700);
    }

    #[test]
    fn empty_line_is_ignored() {
        assert_eq!(handle_jsonrpc_input_line("  \t "), None);
    }

    #[test]
    fn multiple_input_lines_can_be_processed_in_order() {
        let input = [
            r#"{"jsonrpc":"2.0","id":1,"method":"runtime.status"}"#,
            r#"{"jsonrpc":"2.0","id":2,"method":"runtime.unknown"}"#,
        ];

        let responses: Vec<JsonRpcResponse<RuntimeStatus>> =
            input.iter().map(|line| parse_line(line)).collect();

        assert_eq!(responses[0].id, Value::from(1));
        assert!(responses[0].result.is_some());
        assert_eq!(responses[1].id, Value::from(2));
        assert_eq!(responses[1].error.as_ref().expect("error").code, -32601);
    }
}
