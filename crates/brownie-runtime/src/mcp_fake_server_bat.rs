//! Windows .bat fake MCP server script content.
//!
//! These scripts are used by MCP tests on Windows where .sh scripts
//! cannot be executed directly. They use cmd.exe with set /p for stdin
//! and echo for stdout.

#[cfg_attr(not(windows), allow(dead_code))]
pub fn fake_server_bat(scenario: &str) -> String {
    match scenario {
        "duplicate" => {
            "@echo off\r\nset /p request=\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"safe\",\"inputSchema\":{\"type\":\"object\"}},{\"name\":\"search_code\",\"description\":\"safe\",\"inputSchema\":{\"type\":\"object\"}}]}}\r\n"
        }
        "malformed_schema" => {
            "@echo off\r\nset /p request=\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"safe\",\"inputSchema\":null}]}}\r\n"
        }
        "oversized_schema" => {
            "@echo off\r\nset /p request=\r\nfor /l %%i in (1,1,200) do set big=!big!xxxxxxxxxx\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"safe\",\"inputSchema\":{\"type\":\"object\",\"description\":\"!big!\"}}]}}\r\n"
        }
        "schema_unsupported_keyword" => {
            "@echo off\r\nset /p request=\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"safe\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\",\"pattern\":\"^safe$\"}}}}]}}\r\n"
        }
        "protocol_error" => {
            "@echo off\r\nset /p request=\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32603,\"message\":\"boom\"}}\r\n"
        }
        "invalid_jsonrpc" => {
            "@echo off\r\nset /p request=\r\necho {\"jsonrpc\":\"1.0\",\"id\":1,\"result\":{\"tools\":[]}}\r\n"
        }
        "mismatched_id" => {
            "@echo off\r\nset /p request=\r\necho {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[]}}\r\n"
        }
        "result_and_error" => {
            "@echo off\r\nset /p request=\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[]},\"error\":{\"code\":-32603,\"message\":\"boom\"}}\r\n"
        }
        "timeout" => {
            "@echo off\r\nset /p request=\r\ntimeout /t 5 /nobreak >nul\r\n"
        }
        "timeout_pid" => {
            "@echo off\r\necho %~nx0> mcp-timeout.pid\r\nset /p request=\r\ntimeout /t 30 /nobreak >nul\r\n"
        }
        "oversized_no_newline_pid" => {
            "@echo off\r\necho %~nx0> mcp-oversized.pid\r\nset /p request=\r\nfor /l %%i in (1,1,400) do set big=!big!xxxxxxxxxx\r\necho !big! | findstr /v \"\"\r\ntimeout /t 30 /nobreak >nul\r\n"
        }
        "exit" => {
            "@echo off\r\nexit /b 7\r\n"
        }
        "strict_meta" => {
            "@echo off\r\nset /p request=\r\nset \"req=%request%\"\r\nif not \"%req%\"==*io.modelcontextprotocol/protocolVersion* (echo {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32602,\"message\":\"missing protocolVersion\"}}& exit /b 0)\r\nif not \"%req%\"==*io.modelcontextprotocol/clientInfo* (echo {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32602,\"message\":\"missing clientInfo\"}}& exit /b 0)\r\nif not \"%req%\"==*io.modelcontextprotocol/clientCapabilities* (echo {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32602,\"message\":\"missing clientCapabilities\"}}& exit /b 0)\r\nif \"%req%\"==*tools/list* (echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}& exit /b 0)\r\nif \"%req%\"==*tools/call* (echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"ok\"}],\"isError\":false}}& exit /b 0)\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32602,\"message\":\"missing required MCP 2026-07-28 client metadata\"}}\r\n"
        }
        "tool_error" => {
            "@echo off\r\nset /p request=\r\nset \"req=%request%\"\r\nif \"%req%\"==*tools/list* (echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}& exit /b 0)\r\nif \"%req%\"==*tools/call* (echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"MCP_TOOL_ERROR_2b91\"}],\"isError\":true}}& exit /b 0)\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32601,\"message\":\"unknown\"}}\r\n"
        }
        "call_protocol_error" => {
            "@echo off\r\nset /p request=\r\nset \"req=%request%\"\r\nif \"%req%\"==*tools/list* (echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}& exit /b 0)\r\nif \"%req%\"==*tools/call* (echo {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32603,\"message\":\"boom\"}}& exit /b 0)\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32601,\"message\":\"unknown\"}}\r\n"
        }
        "call_timeout" => {
            "@echo off\r\nset /p request=\r\nset \"req=%request%\"\r\nif \"%req%\"==*tools/list* (echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}& exit /b 0)\r\nif \"%req%\"==*tools/call* (timeout /t 5 /nobreak >nul& exit /b 0)\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32601,\"message\":\"unknown\"}}\r\n"
        }
        "call_malformed_result" => {
            "@echo off\r\nset /p request=\r\nset \"req=%request%\"\r\nif \"%req%\"==*tools/list* (echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}& exit /b 0)\r\nif \"%req%\"==*tools/call* (echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"resultType\":\"complete\",\"content\":\"not an array\",\"isError\":false}}& exit /b 0)\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32601,\"message\":\"unknown\"}}\r\n"
        }
        "call_omitted_is_error" => {
            "@echo off\r\nset /p request=\r\nset \"req=%request%\"\r\nif \"%req%\"==*tools/list* (echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"resultType\":\"complete\",\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}& exit /b 0)\r\nif \"%req%\"==*tools/call* (echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"resultType\":\"complete\",\"content\":[{\"type\":\"text\",\"text\":\"MCP_RESULT_OMITTED_IS_ERROR\"}]}}& exit /b 0)\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32601,\"message\":\"unknown\"}}\r\n"
        }
        "call_input_required" => {
            "@echo off\r\nset /p request=\r\nset \"req=%request%\"\r\nif \"%req%\"==*tools/list* (echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"resultType\":\"complete\",\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}& exit /b 0)\r\nif \"%req%\"==*tools/call* (echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"resultType\":\"input_required\",\"requestState\":\"bounded-state-token\"}}& exit /b 0)\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32601,\"message\":\"unknown\"}}\r\n"
        }
        "call_unknown_result_type" => {
            "@echo off\r\nset /p request=\r\nset \"req=%request%\"\r\nif \"%req%\"==*tools/list* (echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"resultType\":\"complete\",\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}& exit /b 0)\r\nif \"%req%\"==*tools/call* (echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"resultType\":\"unknown_future\",\"content\":[{\"type\":\"text\",\"text\":\"unsupported\"}],\"isError\":false}}& exit /b 0)\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32601,\"message\":\"unknown\"}}\r\n"
        }
        "counting" => {
            "@echo off\r\nset /p request=\r\nset \"req=%request%\"\r\nset \"log=%~dp0mcp-count.log\"\r\nif \"%req%\"==*tools/list* (echo tools/list>> \"%log%\"& echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}& exit /b 0)\r\nif \"%req%\"==*tools/call* (echo tools/call:search_code>> \"%log%\"& echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"MCP_RESULT_7f91c2\"}],\"isError\":false}}& exit /b 0)\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32601,\"message\":\"unknown\"}}\r\n"
        }
        "counting_tool_error" => {
            "@echo off\r\nset /p request=\r\nset \"req=%request%\"\r\nset \"log=%~dp0mcp-count.log\"\r\nif \"%req%\"==*tools/list* (echo tools/list>> \"%log%\"& echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}& exit /b 0)\r\nif \"%req%\"==*tools/call* (echo tools/call:search_code>> \"%log%\"& echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"MCP_TOOL_ERROR_2b91\"}],\"isError\":true}}& exit /b 0)\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32601,\"message\":\"unknown\"}}\r\n"
        }
        "schema_validation_counting" => {
            "@echo off\r\nset /p request=\r\nset \"req=%request%\"\r\nset \"log=%~dp0mcp-count.log\"\r\nif \"%req%\"==*tools/list* (echo tools/list>> \"%log%\"& echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\",\"minLength\":3,\"maxLength\":8},\"limit\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":5},\"mode\":{\"type\":\"string\",\"enum\":[\"code\"]},\"fixed\":{\"type\":\"boolean\",\"const\":true},\"tags\":{\"type\":\"array\",\"items\":{\"type\":\"string\"}}},\"required\":[\"query\"],\"additionalProperties\":false},\"outputSchema\":{\"type\":\"object\"}}]}}& exit /b 0)\r\nif \"%req%\"==*tools/call* (echo tools/call:search_code>> \"%log%\"& echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"MCP_RESULT_7f91c2\"}],\"isError\":false}}& exit /b 0)\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32601,\"message\":\"unknown\"}}\r\n"
        }
        "schema_output_validating" => {
            "@echo off\r\nset /p request=\r\nset \"req=%request%\"\r\nset \"log=%~dp0mcp-count.log\"\r\nif \"%req%\"==*tools/list* (echo tools/list>> \"%log%\"& echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\",\"properties\":{\"answer\":{\"type\":\"string\"}},\"required\":[\"answer\"],\"additionalProperties\":false}}]}}& exit /b 0)\r\nif \"%req%\"==*tools/call* (echo tools/call:search_code>> \"%log%\"& echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"structuredContent\":{\"answer\":\"ok\"},\"content\":[{\"type\":\"text\",\"text\":\"MCP_RESULT_7f91c2\"}],\"isError\":false}}& exit /b 0)\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32601,\"message\":\"unknown\"}}\r\n"
        }
        "schema_output_invalid" => {
            "@echo off\r\nset /p request=\r\nset \"req=%request%\"\r\nset \"log=%~dp0mcp-count.log\"\r\nif \"%req%\"==*tools/list* (echo tools/list>> \"%log%\"& echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\",\"properties\":{\"answer\":{\"type\":\"string\"}},\"required\":[\"answer\"],\"additionalProperties\":false}}]}}& exit /b 0)\r\nif \"%req%\"==*tools/call* (echo tools/call:search_code>> \"%log%\"& echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"structuredContent\":{\"answer\":7},\"content\":[{\"type\":\"text\",\"text\":\"SHOULD_NOT_BE_SUCCESS\"}],\"isError\":false}}& exit /b 0)\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32601,\"message\":\"unknown\"}}\r\n"
        }
        "schema_output_omitted" => {
            "@echo off\r\nset /p request=\r\nset \"req=%request%\"\r\nset \"log=%~dp0mcp-count.log\"\r\nif \"%req%\"==*tools/list* (echo tools/list>> \"%log%\"& echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}}}]}}& exit /b 0)\r\nif \"%req%\"==*tools/call* (echo tools/call:search_code>> \"%log%\"& echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"MCP_RESULT_7f91c2\"}],\"isError\":false}}& exit /b 0)\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32601,\"message\":\"unknown\"}}\r\n"
        }
        "annotated_counting" => {
            "@echo off\r\nset /p request=\r\nset \"req=%request%\"\r\nset \"log=%~dp0mcp-count.log\"\r\nif \"%req%\"==*tools/list* (echo tools/list>> \"%log%\"& echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"annotations\":{\"readOnlyHint\":true,\"destructiveHint\":false,\"idempotentHint\":true,\"openWorldHint\":false},\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}& exit /b 0)\r\nif \"%req%\"==*tools/call* (echo tools/call:search_code>> \"%log%\"& echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"MCP_RESULT_7f91c2\"}],\"isError\":false}}& exit /b 0)\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32601,\"message\":\"unknown\"}}\r\n"
        }
        "annotation_read_only_false" => {
            "@echo off\r\nset /p request=\r\nset \"req=%request%\"\r\nset \"log=%~dp0mcp-count.log\"\r\nif \"%req%\"==*tools/list* (echo tools/list>> \"%log%\"& echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"annotations\":{\"readOnlyHint\":false,\"destructiveHint\":false,\"idempotentHint\":true,\"openWorldHint\":false},\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}& exit /b 0)\r\nif \"%req%\"==*tools/call* (echo tools/call:search_code>> \"%log%\"& echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"should not call\"}],\"isError\":false}}& exit /b 0)\r\n"
        }
        "annotation_destructive_true" => {
            "@echo off\r\nset /p request=\r\nset \"req=%request%\"\r\nset \"log=%~dp0mcp-count.log\"\r\nif \"%req%\"==*tools/list* (echo tools/list>> \"%log%\"& echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"annotations\":{\"readOnlyHint\":true,\"destructiveHint\":true,\"idempotentHint\":true,\"openWorldHint\":false},\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}& exit /b 0)\r\nif \"%req%\"==*tools/call* (echo tools/call:search_code>> \"%log%\"& echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"should not call\"}],\"isError\":false}}& exit /b 0)\r\n"
        }
        "annotation_idempotent_false" => {
            "@echo off\r\nset /p request=\r\nset \"req=%request%\"\r\nset \"log=%~dp0mcp-count.log\"\r\nif \"%req%\"==*tools/list* (echo tools/list>> \"%log%\"& echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"annotations\":{\"readOnlyHint\":true,\"destructiveHint\":false,\"idempotentHint\":false,\"openWorldHint\":false},\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}& exit /b 0)\r\nif \"%req%\"==*tools/call* (echo tools/call:search_code>> \"%log%\"& echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"should not call\"}],\"isError\":false}}& exit /b 0)\r\n"
        }
        "annotation_open_world_true" => {
            "@echo off\r\nset /p request=\r\nset \"req=%request%\"\r\nset \"log=%~dp0mcp-count.log\"\r\nif \"%req%\"==*tools/list* (echo tools/list>> \"%log%\"& echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"annotations\":{\"readOnlyHint\":true,\"destructiveHint\":false,\"idempotentHint\":true,\"openWorldHint\":true},\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}& exit /b 0)\r\nif \"%req%\"==*tools/call* (echo tools/call:search_code>> \"%log%\"& echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"should not call\"}],\"isError\":false}}& exit /b 0)\r\n"
        }
        "annotation_invalid_type" => {
            "@echo off\r\nset /p request=\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"annotations\":{\"readOnlyHint\":\"yes\"},\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}\r\n"
        }
        "oversized_result" => {
            "@echo off\r\nset /p request=\r\nset \"req=%request%\"\r\nif \"%req%\"==*tools/list* (echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}& exit /b 0)\r\nif \"%req%\"==*tools/call* (for /l %%i in (1,1,90) do set big=!big!yyyyyyyyyy& echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"raw_marker\":\"RAW_JSON_RPC_RESPONSE_MARKER\",\"content\":[{\"type\":\"text\",\"text\":\"MCP_RESULT_7f91c2:!big!\"},{\"type\":\"image\",\"data\":\"BINARY_PAYLOAD_SHOULD_NOT_REACH_PROMPT\",\"mimeType\":\"image/png\"}],\"isError\":false}}& exit /b 0)\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32601,\"message\":\"unknown\"}}\r\n"
        }
        _ => {
            "@echo off\r\nset /p request=\r\nset \"req=%request%\"\r\nif \"%req%\"==*tools/list* (echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}& exit /b 0)\r\nif \"%req%\"==*tools/call* (echo {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"ok\"}],\"isError\":false}}& exit /b 0)\r\necho {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32601,\"message\":\"unknown\"}}\r\n"
        }
    }
    .to_string()
}
