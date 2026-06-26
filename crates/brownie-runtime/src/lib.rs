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
}
