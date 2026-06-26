use std::io::{self, IsTerminal, Read};

use brownie_protocol::{JsonRpcRequest, JsonRpcResponse, RuntimeStatus};

fn main() -> anyhow::Result<()> {
    let mut input = String::new();

    if io::stdin().is_terminal() {
        let status = brownie_runtime::runtime_status();
        println!("{}", serde_json::to_string(&status)?);
        return Ok(());
    }

    io::stdin().read_to_string(&mut input)?;
    let response = match serde_json::from_str::<JsonRpcRequest>(&input) {
        Ok(request) => brownie_runtime::handle_jsonrpc_request(request),
        Err(error) => JsonRpcResponse::<RuntimeStatus> {
            jsonrpc: "2.0".to_string(),
            id: serde_json::Value::Null,
            result: None,
            error: Some(brownie_protocol::JsonRpcError {
                code: -32700,
                message: format!("parse error: {error}"),
            }),
        },
    };

    println!("{}", serde_json::to_string(&response)?);
    Ok(())
}
