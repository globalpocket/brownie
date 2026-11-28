//! Windows PowerShell fake MCP server script content.
//!
//! These scripts are used by MCP tests on Windows where .sh scripts cannot be
//! executed directly. Each .ps1 reads one JSON-RPC request line from stdin,
//! detects whether it is a `tools/list` or `tools/call` request, and writes the
//! matching JSON-RPC response to stdout using explicit byte writes (UTF-8 with
//! a single LF line ending) to avoid any CRLF or cmd.exe escaping issues.

/// Generate the PowerShell launcher content for a scenario.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn fake_server_ps1(scenario: &str) -> String {
    // Timeout / exit scenarios do not return a JSON response.
    match scenario {
        "timeout" => {
            // Sleep past MCP_STDIO_TIMEOUT_MS (20s) so the client deadline fires.
            "Read-Host -Prompt '' | Out-Null\nStart-Sleep -Seconds 35\n".to_string()
        }
        "timeout_pid" => {
            // Write this process's PID to the PID file, then sleep.
            format!(
                "Read-Host -Prompt '' | Out-Null\n$PID | Out-File -FilePath '{{{}}}' -Encoding ascii\nStart-Sleep -Seconds 30\n",
                "mcp-timeout.pid"
            )
        }
        "oversized_no_newline_pid" => {
            // Write PID, output a large response with no trailing newline, then sleep.
            let big = "x".repeat(163840);
            format!(
                "Read-Host -Prompt '' | Out-Null\n\
                 $PID | Out-File -FilePath 'mcp-oversized.pid' -Encoding ascii\n\
                 $bytes = [System.Text.Encoding]::UTF8.GetBytes('{big}')\n\
                 [System.Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)\n\
                 Start-Sleep -Seconds 30\n"
            )
        }
        "exit" => "exit 7\n".to_string(),
        _ => {
            // Detect tools/list vs tools/call and output the matching response
            // using explicit byte writes (UTF-8 + LF). Counting scenarios also
            // append a line to mcp-count.log next to the script.
            let is_counting = matches!(
                scenario,
                "counting"
                    | "counting_tool_error"
                    | "schema_validation_counting"
                    | "schema_output_validating"
                    | "schema_output_invalid"
                    | "schema_output_omitted"
                    | "annotated_counting"
                    | "annotation_read_only_false"
                    | "annotation_destructive_true"
                    | "annotation_idempotent_false"
                    | "annotation_open_world_true"
            );
            let list_json = fake_server_response(scenario, "list")
                .unwrap_or_else(|| standard_catalog_list().to_string());
            let call_json = fake_server_response(scenario, "call")
                .unwrap_or_else(|| standard_call_ok().to_string());
            // Escape single quotes for PowerShell single-quoted strings.
            let list_ps = escape_for_ps(&list_json);
            let call_ps = escape_for_ps(&call_json);
            if is_counting {
                format!(
                    "param([string]$listJson = '{list_ps}', [string]$callJson = '{call_ps}')\n\
                     $request = [Console]::In.ReadLine()\n\
                     $log = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'mcp-count.log'\n\
                     if ($request -match 'tools/list') {{\n\
                     Add-Content -Path $log -Value 'tools/list'\n\
                     $out = $listJson\n\
                     }} else {{\n\
                     Add-Content -Path $log -Value 'tools/call:search_code'\n\
                     $out = $callJson\n\
                     }}\n\
                     $bytes = [System.Text.Encoding]::UTF8.GetBytes($out)\n\
                     [System.Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)\n"
                )
            } else {
                format!(
                    "param([string]$listJson = '{list_ps}', [string]$callJson = '{call_ps}')\n\
                     $request = [Console]::In.ReadLine()\n\
                     if ($request -match 'tools/list') {{\n\
                     $out = $listJson\n\
                     }} else {{\n\
                     $out = $callJson\n\
                     }}\n\
                     $bytes = [System.Text.Encoding]::UTF8.GetBytes($out)\n\
                     [System.Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)\n"
                )
            }
        }
    }
}

/// Escape a string for inclusion in a PowerShell single-quoted string literal.
/// In PowerShell single-quoted strings, the only escape is `''` for a literal `'`.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn escape_for_ps(s: &str) -> String {
    s.replace('\'', "''")
}

/// Generate the PowerShell script for the "changed schema" fake server, which
/// returns a changed tools/list and a changed tools/call response.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn changed_schema_ps1() -> String {
    let list_json = "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"changed\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"changed\":{\"type\":\"boolean\"}}}}]}}\n";
    let call_json = "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"changed\"}],\"isError\":false}}\n";
    let list_ps = escape_for_ps(list_json);
    let call_ps = escape_for_ps(call_json);
    format!(
        "param([string]$listJson = '{list_ps}', [string]$callJson = '{call_ps}')\n\
         $request = [Console]::In.ReadLine()\n\
         if ($request -match 'tools/list') {{ $out = $listJson }} else {{ $out = $callJson }}\n\
         $bytes = [System.Text.Encoding]::UTF8.GetBytes($out)\n\
         [System.Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)\n"
    )
}

/// Generate the PowerShell script for the "annotation drift" fake server, which
/// appends to mcp-count.log and returns a drift tools/list and a changed
/// tools/call response.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn annotation_drift_ps1() -> String {
    let list_json = "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"annotations\":{\"readOnlyHint\":false,\"destructiveHint\":false,\"idempotentHint\":true,\"openWorldHint\":false},\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}\n";
    let call_json = "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"changed annotation\"}],\"isError\":false}}\n";
    let list_ps = escape_for_ps(list_json);
    let call_ps = escape_for_ps(call_json);
    format!(
        "param([string]$listJson = '{list_ps}', [string]$callJson = '{call_ps}')\n\
         $request = [Console]::In.ReadLine()\n\
         $log = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'mcp-count.log'\n\
         if ($request -match 'tools/list') {{\n\
         Add-Content -Path $log -Value 'tools/list'\n\
         $out = $listJson\n\
         }} else {{\n\
         Add-Content -Path $log -Value 'tools/call:search_code'\n\
         $out = $callJson\n\
         }}\n\
         $bytes = [System.Text.Encoding]::UTF8.GetBytes($out)\n\
         [System.Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)\n"
    )
}

/// The standard tools/list catalog response (LF line ending).
fn standard_catalog_list() -> &'static str {
    "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}\n"
}

/// The standard tools/call "ok" response (LF line ending).
fn standard_call_ok() -> &'static str {
    "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"ok\"}],\"isError\":false}}\n"
}

/// Returns the JSON-RPC response content (LF line ending) for a given scenario
/// and request kind. `request_kind` is `"list"` for tools/list and `"call"` for
/// tools/call.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn fake_server_response(scenario: &str, request_kind: &str) -> Option<String> {
    // Scenarios that never return a JSON response.
    match scenario {
        "timeout" | "timeout_pid" | "exit" | "oversized_no_newline_pid" => return None,
        _ => {}
    }

    match (scenario, request_kind) {
        // ---- tools/list responses ----
        ("duplicate", "list") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"safe\",\"inputSchema\":{\"type\":\"object\"}},{\"name\":\"search_code\",\"description\":\"safe\",\"inputSchema\":{\"type\":\"object\"}}]}}\n".to_string(),
        ),
        ("malformed_schema", "list") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"safe\",\"inputSchema\":null}]}}\n".to_string(),
        ),
        ("oversized_schema", "list") => {
            let big = "x".repeat(20000);
            Some(format!(
                "{{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{{\"tools\":[{{\"name\":\"search_code\",\"description\":\"safe\",\"inputSchema\":{{\"type\":\"object\",\"description\":\"{big}\"}}}}]}}}}\n"
            ))
        }
        ("schema_unsupported_keyword", "list") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"safe\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\",\"pattern\":\"^safe$\"}}}}]}}\n".to_string(),
        ),
        ("protocol_error", "list") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32603,\"message\":\"boom\"}}\n".to_string(),
        ),
        ("invalid_jsonrpc", "list") => Some(
            "{\"jsonrpc\":\"1.0\",\"id\":1,\"result\":{\"tools\":[]}}\n".to_string(),
        ),
        ("mismatched_id", "list") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[]}}\n".to_string(),
        ),
        ("result_and_error", "list") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[]},\"error\":{\"code\":-32603,\"message\":\"boom\"}}\n".to_string(),
        ),
        ("annotation_invalid_type", "list") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"annotations\":{\"readOnlyHint\":\"yes\"},\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}\n".to_string(),
        ),
        ("schema_validation_counting", "list") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\",\"minLength\":3,\"maxLength\":8},\"limit\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":5},\"mode\":{\"type\":\"string\",\"enum\":[\"code\"]},\"fixed\":{\"type\":\"boolean\",\"const\":true},\"tags\":{\"type\":\"array\",\"items\":{\"type\":\"string\"}}},\"required\":[\"query\"],\"additionalProperties\":false},\"outputSchema\":{\"type\":\"object\"}}]}}\n".to_string(),
        ),
        ("schema_output_validating", "list")
        | ("schema_output_invalid", "list") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\",\"properties\":{\"answer\":{\"type\":\"string\"}},\"required\":[\"answer\"],\"additionalProperties\":false}}]}}\n".to_string(),
        ),
        ("schema_output_omitted", "list") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}}}]}}\n".to_string(),
        ),
        ("annotated_counting", "list") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"annotations\":{\"readOnlyHint\":true,\"destructiveHint\":false,\"idempotentHint\":true,\"openWorldHint\":false},\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}\n".to_string(),
        ),
        ("annotation_read_only_false", "list") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"annotations\":{\"readOnlyHint\":false,\"destructiveHint\":false,\"idempotentHint\":true,\"openWorldHint\":false},\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}\n".to_string(),
        ),
        ("annotation_destructive_true", "list") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"annotations\":{\"readOnlyHint\":true,\"destructiveHint\":true,\"idempotentHint\":true,\"openWorldHint\":false},\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}\n".to_string(),
        ),
        ("annotation_idempotent_false", "list") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"annotations\":{\"readOnlyHint\":true,\"destructiveHint\":false,\"idempotentHint\":false,\"openWorldHint\":false},\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}\n".to_string(),
        ),
        ("annotation_open_world_true", "list") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"annotations\":{\"readOnlyHint\":true,\"destructiveHint\":false,\"idempotentHint\":true,\"openWorldHint\":true},\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}\n".to_string(),
        ),
        ("call_omitted_is_error", "list") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"resultType\":\"complete\",\"tools\":[{\"name\":\"search_code\",\"description\":\"catalog text is not authority\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}}},\"outputSchema\":{\"type\":\"object\"}}]}}\n".to_string(),
        ),
        // ---- tools/call responses ----
        ("tool_error", "call") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"MCP_TOOL_ERROR_2b91\"}],\"isError\":true}}\n".to_string(),
        ),
        ("call_protocol_error", "call") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32603,\"message\":\"boom\"}}\n".to_string(),
        ),
        ("call_malformed_result", "call") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"resultType\":\"complete\",\"content\":\"not an array\",\"isError\":false}}\n".to_string(),
        ),
        ("call_omitted_is_error", "call") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"resultType\":\"complete\",\"content\":[{\"type\":\"text\",\"text\":\"MCP_RESULT_OMITTED_IS_ERROR\"}]}}\n".to_string(),
        ),
        ("call_input_required", "call") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"resultType\":\"input_required\",\"requestState\":\"bounded-state-token\"}}\n".to_string(),
        ),
        ("call_unknown_result_type", "call") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"resultType\":\"unknown_future\",\"content\":[{\"type\":\"text\",\"text\":\"unsupported\"}],\"isError\":false}}\n".to_string(),
        ),
        ("counting", "call") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"MCP_RESULT_7f91c2\"}],\"isError\":false}}\n".to_string(),
        ),
        ("counting_tool_error", "call") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"MCP_TOOL_ERROR_2b91\"}],\"isError\":true}}\n".to_string(),
        ),
        ("schema_validation_counting", "call") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"MCP_RESULT_7f91c2\"}],\"isError\":false}}\n".to_string(),
        ),
        ("schema_output_validating", "call") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"structuredContent\":{\"answer\":\"ok\"},\"content\":[{\"type\":\"text\",\"text\":\"MCP_RESULT_7f91c2\"}],\"isError\":false}}\n".to_string(),
        ),
        ("schema_output_invalid", "call") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"structuredContent\":{\"answer\":7},\"content\":[{\"type\":\"text\",\"text\":\"SHOULD_NOT_BE_SUCCESS\"}],\"isError\":false}}\n".to_string(),
        ),
        ("schema_output_omitted", "call") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"MCP_RESULT_7f91c2\"}],\"isError\":false}}\n".to_string(),
        ),
        ("annotated_counting", "call") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"MCP_RESULT_7f91c2\"}],\"isError\":false}}\n".to_string(),
        ),
        ("annotation_read_only_false", "call") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"should not call\"}],\"isError\":false}}\n".to_string(),
        ),
        ("annotation_destructive_true", "call") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"should not call\"}],\"isError\":false}}\n".to_string(),
        ),
        ("annotation_idempotent_false", "call") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"should not call\"}],\"isError\":false}}\n".to_string(),
        ),
        ("annotation_open_world_true", "call") => Some(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"should not call\"}],\"isError\":false}}\n".to_string(),
        ),
        ("oversized_result", "call") => {
            let big = "y".repeat(9000);
            Some(format!(
                "{{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{{\"raw_marker\":\"RAW_JSON_RPC_RESPONSE_MARKER\",\"content\":[{{\"type\":\"text\",\"text\":\"MCP_RESULT_7f91c2:{big}\"}},{{\"type\":\"image\",\"data\":\"BINARY_PAYLOAD_SHOULD_NOT_REACH_PROMPT\",\"mimeType\":\"image/png\"}}],\"isError\":false}}}}\n"
            ))
        }
        // ---- Defaults ----
        (_, "list") => Some(standard_catalog_list().to_string()),
        (_, "call") => Some(standard_call_ok().to_string()),
        // Catch-all for any other request kind (should not occur in practice).
        (_, _) => Some(standard_call_ok().to_string()),
    }
}
