use super::*;

pub(super) fn handle_codebase_index_build(
    id: Value,
    params: Option<Value>,
) -> JsonRpcResponse<Value> {
    let params = match params {
        Some(value) => match serde_json::from_value::<CodebaseIndexBuildParams>(value) {
            Ok(params) => params,
            Err(error) => return error_response(id, -32602, &format!("invalid params: {error}")),
        },
        None => CodebaseIndexBuildParams::default(),
    };

    let mode_id = match normalize_mode_id(params.mode_id.as_deref()) {
        Ok(mode_id) => mode_id,
        Err(message) => return error_response(id, -32602, &message),
    };

    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };

    let policy = match resolve_workspace_mode_policy(&store, &mode_id) {
        Ok(Some(policy)) => policy,
        Ok(None) => {
            let payload = codebase_index_permission_payload(
                &mode_id,
                false,
                "unknown mode_id for codebase indexing",
                &params,
            );
            if let Err(error) = store
                .codebase_index()
                .append_event(LedgerEventKind::CodebaseIndexPermissionChecked, payload)
            {
                return error_response(
                    id,
                    -32603,
                    &format!("internal error: failed to record codebase index permission decision: {error}"),
                );
            }
            return error_response(id, -32602, "invalid params: unknown mode_id");
        }
        Err(message) => return error_response(id, -32602, &message),
    };

    let decision = RuntimePermissionGate::check(&policy, RuntimeAction::IndexCodebase);
    if !decision.allowed {
        let permission_payload =
            codebase_index_permission_payload(&mode_id, false, &decision.reason, &params);
        if let Err(error) = store.codebase_index().append_event(
            LedgerEventKind::CodebaseIndexPermissionChecked,
            permission_payload,
        ) {
            return error_response(
                id,
                -32603,
                &format!(
                    "internal error: failed to record codebase index permission decision: {error}"
                ),
            );
        }
        return error_response(
            id,
            -32602,
            &format!("permission denied: {}", decision.reason),
        );
    }

    let index_store = store.codebase_index();
    let build_lock = match index_store.begin_build() {
        Ok(lock) => lock,
        Err(error) => {
            return error_response(
                id,
                -32603,
                &format!("internal error: failed to acquire codebase index build lock: {error}"),
            )
        }
    };

    let built_at = match codebase_index_timestamp() {
        Ok(timestamp) => timestamp,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };

    let snapshot = match build_workspace_file_inventory(
        store.workspace_root(),
        CodebaseIndexBuildOptions {
            root: params.root.clone(),
            max_files: params.max_files,
            max_directories: params.max_directories,
            max_path_chars: params.max_path_chars,
            max_file_bytes: params.max_file_bytes,
            max_visited_entries: params.max_visited_entries,
            max_directory_entries: params.max_directory_entries,
        },
    ) {
        Ok(snapshot) => snapshot,
        Err(CodebaseIndexError::UnsupportedPlatform(_)) => {
            return error_response(
                id,
                -32603,
                "unsupported platform: codebase index build requires safe no-follow file reads",
            )
        }
        Err(error) => return error_response(id, -32602, &format!("invalid params: {error}")),
    };

    let manifest = codebase_index_manifest(snapshot, built_at);
    let permission_payload =
        codebase_index_permission_payload(&mode_id, true, &decision.reason, &params);
    if let Err(error) = index_store.append_event(
        LedgerEventKind::CodebaseIndexPermissionChecked,
        permission_payload,
    ) {
        return error_response(
            id,
            -32603,
            &format!(
                "internal error: failed to record codebase index permission decision: {error}"
            ),
        );
    }
    let event_payload = codebase_index_build_event_payload(&manifest, &mode_id, &params);

    let event = match index_store.commit_current_snapshot_with_lock(
        &build_lock,
        &manifest,
        LedgerEventKind::CodebaseIndexSnapshotBuilt,
        event_payload,
    ) {
        Ok(event) => event,
        Err(error) => {
            return error_response(
                id,
                -32603,
                &format!("internal error: failed to persist codebase index snapshot: {error}"),
            )
        }
    };

    result_response(
        id,
        json!(CodebaseIndexBuildResult {
            snapshot: manifest.snapshot,
            persisted: true,
            ledger_event_id: event.event_id,
            ledger_event_kind: format!("{:?}", event.kind),
            next_action: CODEBASE_INDEX_NEXT_ACTION.to_string(),
        }),
    )
}

#[derive(Debug, Clone)]
struct CodebaseIndexQueryCandidate {
    entry: CodebaseIndexSelectedEntry,
}

pub(super) fn handle_codebase_index_query(
    id: Value,
    params: Option<Value>,
) -> JsonRpcResponse<Value> {
    let params: CodebaseIndexQueryParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };

    let mode_id = match normalize_mode_id(Some(&params.mode_id)) {
        Ok(mode_id) => mode_id,
        Err(message) => return error_response(id, -32602, &message),
    };

    let (normalized_query, query_tokens, max_results, file_kind_filter) =
        match validate_codebase_index_query_params(&params) {
            Ok(validated) => validated,
            Err(message) => return error_response(id, -32602, &message),
        };
    let query_fingerprint = codebase_index_query_fingerprint(
        &normalized_query,
        max_results,
        file_kind_filter.as_deref(),
    );

    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32603, &format!("internal error: {error}")),
    };

    let policy = match resolve_workspace_mode_policy(&store, &mode_id) {
        Ok(Some(policy)) => policy,
        Ok(None) => {
            let payload = codebase_index_query_permission_payload(
                &mode_id,
                false,
                "unknown mode_id for codebase index query",
                &query_fingerprint,
                normalized_query.chars().count(),
                query_tokens.len(),
                max_results,
                file_kind_filter.as_deref(),
            );
            if let Err(error) = store
                .codebase_index()
                .append_event(LedgerEventKind::CodebaseIndexPermissionChecked, payload)
            {
                return error_response(
                    id,
                    -32603,
                    &format!("internal error: failed to record codebase index permission decision: {error}"),
                );
            }
            return error_response(id, -32602, "invalid params: unknown mode_id");
        }
        Err(message) => return error_response(id, -32602, &message),
    };

    let decision = RuntimePermissionGate::check(&policy, RuntimeAction::IndexCodebase);
    let permission_payload = codebase_index_query_permission_payload(
        &mode_id,
        decision.allowed,
        &decision.reason,
        &query_fingerprint,
        normalized_query.chars().count(),
        query_tokens.len(),
        max_results,
        file_kind_filter.as_deref(),
    );
    if let Err(error) = store.codebase_index().append_event(
        LedgerEventKind::CodebaseIndexPermissionChecked,
        permission_payload,
    ) {
        return error_response(
            id,
            -32603,
            &format!(
                "internal error: failed to record codebase index permission decision: {error}"
            ),
        );
    }
    if !decision.allowed {
        return error_response(
            id,
            -32602,
            &format!("permission denied: {}", decision.reason),
        );
    }

    let index_store = store.codebase_index();
    let manifest = match index_store.read_current_snapshot() {
        Ok(Some(manifest)) => manifest,
        Ok(None) => {
            return error_response(
                id,
                -32602,
                "invalid params: current codebase index snapshot is missing",
            )
        }
        Err(_) => {
            return error_response(
                id,
                -32602,
                "invalid params: current codebase index snapshot is malformed or unreadable",
            )
        }
    };
    if let Err(message) = validate_codebase_index_current_snapshot(&manifest) {
        return error_response(id, -32602, &message);
    }

    let (selected_entries, matched_entry_count, skipped_entry_count) =
        codebase_index_select_entries(
            &manifest.entries,
            &query_tokens,
            &normalized_query,
            file_kind_filter.as_deref(),
            max_results,
        );
    let selection_fingerprint = codebase_index_selection_fingerprint(
        &query_fingerprint,
        &manifest.snapshot.snapshot_fingerprint,
        file_kind_filter.as_deref(),
        max_results,
        &selected_entries,
    );
    let query_id = format!(
        "query_{}",
        fingerprint_short_suffix(&query_fingerprint).expect("query fingerprint is sha256")
    );
    let selection_id = format!(
        "selection_{}",
        fingerprint_short_suffix(&selection_fingerprint).expect("selection fingerprint is sha256")
    );

    let event_payload = codebase_index_query_event_payload(
        &manifest,
        &mode_id,
        &query_id,
        &selection_id,
        &query_fingerprint,
        &selection_fingerprint,
        matched_entry_count,
        selected_entries.len(),
        skipped_entry_count,
        max_results,
        file_kind_filter.as_deref(),
        &selected_entries,
    );
    let event = match index_store
        .append_event(LedgerEventKind::CodebaseIndexQueryCompleted, event_payload)
    {
        Ok(event) => event,
        Err(error) => {
            return error_response(
                id,
                -32603,
                &format!("internal error: failed to record codebase index query result: {error}"),
            )
        }
    };

    result_response(
        id,
        json!(CodebaseIndexQueryResult {
            query_id,
            selection_id,
            query_fingerprint,
            snapshot: CodebaseIndexQuerySnapshotSummary {
                index_id: manifest.snapshot.index_id,
                root: manifest.snapshot.root,
                workspace_fingerprint: manifest.snapshot.workspace_fingerprint,
                snapshot_fingerprint: manifest.snapshot.snapshot_fingerprint,
                built_at: manifest.snapshot.built_at,
                truncated: manifest.snapshot.truncated,
            },
            matched_entry_count,
            returned_entry_count: selected_entries.len(),
            max_results,
            entries: selected_entries,
            ledger_event_id: event.event_id,
            ledger_event_kind: format!("{:?}", event.kind),
            next_action: CODEBASE_INDEX_QUERY_NEXT_ACTION.to_string(),
        }),
    )
}

fn validate_codebase_index_query_params(
    params: &CodebaseIndexQueryParams,
) -> Result<(String, Vec<String>, usize, Option<String>), String> {
    let normalized_query = params
        .query
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    if normalized_query.is_empty() {
        return Err("invalid params: query must not be empty".to_string());
    }
    if params.query.chars().count() > CODEBASE_INDEX_QUERY_MAX_CHARS {
        return Err("invalid params: query is too long".to_string());
    }
    let query_tokens = codebase_index_query_tokens(&normalized_query);
    if query_tokens.is_empty() {
        return Err("invalid params: query must include searchable characters".to_string());
    }
    let max_results = params
        .max_results
        .unwrap_or(CODEBASE_INDEX_QUERY_DEFAULT_MAX_RESULTS);
    if max_results == 0 || max_results > CODEBASE_INDEX_QUERY_MAX_RESULTS {
        return Err(format!(
            "invalid params: max_results must be between 1 and {CODEBASE_INDEX_QUERY_MAX_RESULTS}"
        ));
    }
    let file_kind_filter = match params.file_kind.as_deref() {
        Some(value) => {
            let trimmed = value.trim();
            if !is_supported_codebase_index_file_kind(trimmed) {
                return Err("invalid params: file_kind is unsupported".to_string());
            }
            Some(trimmed.to_string())
        }
        None => None,
    };
    Ok((
        normalized_query,
        query_tokens,
        max_results,
        file_kind_filter,
    ))
}

fn codebase_index_query_tokens(query: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut seen = BTreeSet::new();
    let mut current = String::new();
    for ch in query.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
            current.push(ch.to_ascii_lowercase());
            continue;
        }
        push_codebase_index_query_token(&mut current, &mut seen, &mut tokens);
    }
    push_codebase_index_query_token(&mut current, &mut seen, &mut tokens);
    tokens.truncate(16);
    tokens
}

fn push_codebase_index_query_token(
    current: &mut String,
    seen: &mut BTreeSet<String>,
    tokens: &mut Vec<String>,
) {
    let token = current
        .trim_matches(|ch: char| matches!(ch, '.' | '_' | '-'))
        .to_string();
    current.clear();
    if token.is_empty() || !token.chars().any(|ch| ch.is_ascii_alphanumeric()) {
        return;
    }
    if seen.insert(token.clone()) {
        tokens.push(token);
    }
}

fn validate_codebase_index_current_snapshot(
    manifest: &CodebaseIndexSnapshotManifest,
) -> Result<(), String> {
    if !manifest.snapshot.index_id.starts_with("idx_")
        || manifest.snapshot.index_id.len() != "idx_".len() + 16
        || !manifest.snapshot.index_id["idx_".len()..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err("invalid params: current codebase index snapshot is malformed".to_string());
    }
    if !is_safe_codebase_index_path(&manifest.snapshot.root, true) {
        return Err("invalid params: current codebase index snapshot is malformed".to_string());
    }
    if !is_sha256_fingerprint(&manifest.snapshot.workspace_fingerprint)
        || !is_sha256_fingerprint(&manifest.snapshot.snapshot_fingerprint)
    {
        return Err("invalid params: current codebase index snapshot is malformed".to_string());
    }
    if manifest.entries.len() > manifest.snapshot.limits.max_files {
        return Err("invalid params: current codebase index snapshot is malformed".to_string());
    }
    Ok(())
}

fn codebase_index_select_entries(
    entries: &[CodebaseIndexFileEntry],
    query_tokens: &[String],
    normalized_query: &str,
    file_kind_filter: Option<&str>,
    max_results: usize,
) -> (Vec<CodebaseIndexSelectedEntry>, usize, usize) {
    let mut candidates = Vec::new();
    let mut skipped_entry_count = 0usize;
    for entry in entries {
        if !is_safe_codebase_index_path(&entry.path, false)
            || !is_supported_codebase_index_file_kind(&entry.file_kind)
            || entry
                .content_sha256
                .as_deref()
                .is_some_and(|fingerprint| !is_sha256_fingerprint(fingerprint))
        {
            skipped_entry_count += 1;
            continue;
        }
        if file_kind_filter.is_some_and(|kind| entry.file_kind != kind) {
            continue;
        }
        if let Some(candidate) =
            codebase_index_match_entry(entry, query_tokens, normalized_query, file_kind_filter)
        {
            candidates.push(candidate);
        }
    }
    candidates.sort_by(|left, right| {
        right
            .entry
            .score
            .cmp(&left.entry.score)
            .then_with(|| left.entry.path.cmp(&right.entry.path))
    });
    let matched_entry_count = candidates.len();
    let selected_entries = candidates
        .into_iter()
        .take(max_results)
        .map(|candidate| candidate.entry)
        .collect();
    (selected_entries, matched_entry_count, skipped_entry_count)
}

fn codebase_index_match_entry(
    entry: &CodebaseIndexFileEntry,
    query_tokens: &[String],
    normalized_query: &str,
    _file_kind_filter: Option<&str>,
) -> Option<CodebaseIndexQueryCandidate> {
    let path = entry.path.to_ascii_lowercase();
    let file_name = path.rsplit('/').next().unwrap_or(path.as_str());
    let extension = file_name.rsplit_once('.').map(|(_, extension)| extension);
    let file_kind = entry.file_kind.to_ascii_lowercase();
    let mut score = 0usize;
    let mut reasons = Vec::new();

    if path == normalized_query {
        score += 1000;
        push_match_reason(&mut reasons, "path_exact");
    }
    if file_name == normalized_query || file_name.contains(normalized_query) {
        score += 250;
        push_match_reason(&mut reasons, "file_name");
    }
    for token in query_tokens {
        if path.contains(token) {
            score += 50;
            push_match_reason(&mut reasons, "path_token");
        }
        if extension.is_some_and(|extension| {
            extension == token.as_str() || format!(".{extension}") == token.as_str()
        }) {
            score += 75;
            push_match_reason(&mut reasons, "extension");
        }
        if file_kind == *token {
            score += 40;
            push_match_reason(&mut reasons, "kind");
        }
    }
    reasons.truncate(5);
    (score > 0).then(|| CodebaseIndexQueryCandidate {
        entry: CodebaseIndexSelectedEntry {
            path: entry.path.clone(),
            file_kind: entry.file_kind.clone(),
            byte_length: entry.byte_length,
            line_count: entry.line_count,
            content_sha256: entry.content_sha256.clone(),
            score,
            match_reasons: reasons,
        },
    })
}

fn push_match_reason(reasons: &mut Vec<String>, reason: &str) {
    if !reasons.iter().any(|existing| existing == reason) {
        reasons.push(reason.to_string());
    }
}

fn codebase_index_query_fingerprint(
    normalized_query: &str,
    max_results: usize,
    file_kind_filter: Option<&str>,
) -> String {
    let body = format!(
        "version=codebase_index_query_v1\nquery={normalized_query}\nmax_results={max_results}\nfile_kind={}",
        file_kind_filter.unwrap_or("")
    );
    format!("sha256:{}", hex_sha256(body.as_bytes()))
}

pub(super) fn codebase_index_selection_fingerprint(
    query_fingerprint: &str,
    snapshot_fingerprint: &str,
    file_kind_filter: Option<&str>,
    max_results: usize,
    entries: &[CodebaseIndexSelectedEntry],
) -> String {
    let mut parts = vec![
        "version=codebase_index_selection_v1".to_string(),
        format!("query_fingerprint={query_fingerprint}"),
        format!("snapshot_fingerprint={snapshot_fingerprint}"),
        format!("file_kind={}", file_kind_filter.unwrap_or("")),
        format!("max_results={max_results}"),
    ];
    for entry in entries {
        parts.push(format!(
            "{}|{}|{}|{}|{}|{}",
            entry.path,
            entry.file_kind,
            entry.byte_length,
            entry.content_sha256.as_deref().unwrap_or(""),
            entry.score,
            entry.match_reasons.join(",")
        ));
    }
    format!("sha256:{}", hex_sha256(parts.join("\n").as_bytes()))
}

fn codebase_index_query_permission_payload(
    mode_id: &str,
    allowed: bool,
    reason: &str,
    query_fingerprint: &str,
    query_length_chars: usize,
    query_token_count: usize,
    max_results: usize,
    file_kind_filter: Option<&str>,
) -> Value {
    json!({
        "mode_id": mode_id,
        "action": RuntimeActionName::IndexCodebase,
        "request_kind": "query",
        "allowed": allowed,
        "reason": preview_with_limit(reason, 160),
        "query_fingerprint": query_fingerprint,
        "query_length_chars": query_length_chars,
        "query_token_count": query_token_count,
        "max_results": max_results,
        "file_kind_filter": file_kind_filter.unwrap_or(""),
    })
}

fn codebase_index_query_event_payload(
    manifest: &CodebaseIndexSnapshotManifest,
    mode_id: &str,
    query_id: &str,
    selection_id: &str,
    query_fingerprint: &str,
    selection_fingerprint: &str,
    matched_entry_count: usize,
    returned_entry_count: usize,
    skipped_entry_count: usize,
    max_results: usize,
    file_kind_filter: Option<&str>,
    entries: &[CodebaseIndexSelectedEntry],
) -> Value {
    json!({
        "mode_id": mode_id,
        "query_id": query_id,
        "selection_id": selection_id,
        "query_fingerprint": query_fingerprint,
        "selection_fingerprint": selection_fingerprint,
        "index_id": manifest.snapshot.index_id.clone(),
        "workspace_fingerprint": manifest.snapshot.workspace_fingerprint.clone(),
        "snapshot_fingerprint": manifest.snapshot.snapshot_fingerprint.clone(),
        "snapshot_truncated": manifest.snapshot.truncated,
        "matched_entry_count": matched_entry_count,
        "returned_entry_count": returned_entry_count,
        "skipped_entry_count": skipped_entry_count,
        "max_results": max_results,
        "file_kind_filter": file_kind_filter.unwrap_or(""),
        "match_reason_counts": codebase_index_match_reason_counts(entries),
        "next_action": CODEBASE_INDEX_QUERY_NEXT_ACTION,
    })
}

#[derive(Debug, Clone)]
struct ValidatedCodebaseIndexSelectionRead {
    file_kind_filter: Option<String>,
    selected_entry: CodebaseIndexSelectedEntry,
    selection_fingerprint: String,
    expected_content_sha256: String,
}

pub(super) fn execute_codebase_index_selection_read(
    store: &BrownieStore,
    policy: &CompiledModePolicy,
    mode_id: &str,
    input: Value,
) -> anyhow::Result<ToolExecuteResult> {
    let params = match serde_json::from_value::<CodebaseIndexSelectionReadParams>(input) {
        Ok(params) => params,
        Err(error) => {
            return Ok(codebase_index_selection_read_failed(format!(
                "invalid input: {error}"
            )))
        }
    };
    let validated = match validate_codebase_index_selection_read_params(&params) {
        Ok(validated) => validated,
        Err(message) => return Ok(codebase_index_selection_read_failed(message)),
    };

    let decision = RuntimePermissionGate::check(policy, RuntimeAction::IndexCodebase);
    let permission_payload = codebase_index_selection_read_permission_payload(
        mode_id,
        decision.allowed,
        &decision.reason,
        &params,
        &validated.selection_fingerprint,
        validated.file_kind_filter.as_deref(),
    );
    store.codebase_index().append_event(
        LedgerEventKind::CodebaseIndexPermissionChecked,
        permission_payload,
    )?;
    if !decision.allowed {
        return Ok(ToolExecuteResult {
            tool_id: CODEBASE_INDEX_SELECTION_READ_TOOL_ID.to_string(),
            status: ToolExecuteStatus::Denied,
            output: json!({ "reason": decision.reason }),
        });
    }

    let index_store = store.codebase_index();
    let manifest = match index_store.read_current_snapshot()? {
        Some(manifest) => manifest,
        None => {
            return Ok(codebase_index_selection_read_failed(
                "current codebase index snapshot is missing",
            ))
        }
    };
    if let Err(message) = validate_codebase_index_current_snapshot(&manifest) {
        return Ok(codebase_index_selection_read_failed(message));
    }
    if let Err(message) = validate_codebase_index_selection_read_current_snapshot(
        &manifest,
        &params,
        &validated.selected_entry,
    ) {
        return Ok(codebase_index_selection_read_failed(message));
    }

    let events = index_store.read_events()?;
    if !events.iter().any(|event| {
        codebase_index_query_evidence_matches(
            event,
            &params,
            &validated.selection_fingerprint,
            validated.file_kind_filter.as_deref(),
        )
    }) {
        return Ok(codebase_index_selection_read_failed(
            "matching codebase index query evidence is missing",
        ));
    }

    let read_result = WorkspaceReadExecutor::read(
        store.workspace_root(),
        &params.read_path,
        MAX_WORKSPACE_READ_BYTES,
    )?;
    if read_result.status != ToolExecutionStatus::Completed {
        return Ok(codebase_index_selection_read_failed(
            read_result
                .output
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("workspace read failed"),
        ));
    }
    let Some(content) = read_result.output.get("content").and_then(Value::as_str) else {
        return Ok(codebase_index_selection_read_failed(
            "workspace read result is malformed",
        ));
    };
    let truncated = read_result
        .output
        .get("truncated")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let Some(bytes_read) = read_result
        .output
        .get("bytes_read")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
    else {
        return Ok(codebase_index_selection_read_failed(
            "workspace read result is missing byte count",
        ));
    };
    if truncated {
        return Ok(codebase_index_selection_read_failed(
            "selected file exceeds bounded read limit",
        ));
    }
    if bytes_read as u64 != validated.selected_entry.byte_length {
        return Ok(codebase_index_selection_read_failed(
            "selected file byte length changed since index selection",
        ));
    }
    let actual_content_sha256 = format!("sha256:{}", hex_sha256(content.as_bytes()));
    if actual_content_sha256 != validated.expected_content_sha256 {
        return Ok(codebase_index_selection_read_failed(
            "selected file hash changed since index selection",
        ));
    }

    let event_payload = codebase_index_selection_read_event_payload(
        mode_id, &params, &validated, bytes_read, truncated,
    );
    let event = index_store.append_event(
        LedgerEventKind::CodebaseIndexSelectionReadCompleted,
        event_payload,
    )?;

    Ok(ToolExecuteResult {
        tool_id: CODEBASE_INDEX_SELECTION_READ_TOOL_ID.to_string(),
        status: ToolExecuteStatus::Completed,
        output: json!(CodebaseIndexSelectionReadResult {
            query_id: params.query_id,
            selection_id: params.selection_id,
            query_fingerprint: params.query_fingerprint,
            selection_fingerprint: validated.selection_fingerprint,
            snapshot: params.snapshot,
            path: params.read_path,
            file_kind: validated.selected_entry.file_kind,
            content: content.to_string(),
            truncated,
            bytes_read,
            content_sha256: actual_content_sha256,
            content_hash_verified: true,
            ledger_event_id: event.event_id,
            ledger_event_kind: format!("{:?}", event.kind),
            next_action: CODEBASE_INDEX_SELECTION_READ_NEXT_ACTION.to_string(),
        }),
    })
}

fn codebase_index_selection_read_failed(reason: impl Into<String>) -> ToolExecuteResult {
    ToolExecuteResult {
        tool_id: CODEBASE_INDEX_SELECTION_READ_TOOL_ID.to_string(),
        status: ToolExecuteStatus::Failed,
        output: json!({ "reason": preview_with_limit(&reason.into(), 240) }),
    }
}

fn validate_codebase_index_selection_read_params(
    params: &CodebaseIndexSelectionReadParams,
) -> Result<ValidatedCodebaseIndexSelectionRead, String> {
    if !is_codebase_index_query_id(&params.query_id) {
        return Err("invalid input: query_id is malformed".to_string());
    }
    if !is_codebase_index_selection_id(&params.selection_id) {
        return Err("invalid input: selection_id is malformed".to_string());
    }
    if !is_sha256_fingerprint(&params.query_fingerprint) {
        return Err("invalid input: query_fingerprint is malformed".to_string());
    }
    validate_codebase_index_query_snapshot_summary(&params.snapshot)?;
    if params.max_results == 0 || params.max_results > CODEBASE_INDEX_QUERY_MAX_RESULTS {
        return Err(format!(
            "invalid input: max_results must be between 1 and {CODEBASE_INDEX_QUERY_MAX_RESULTS}"
        ));
    }
    if params.entries.is_empty() {
        return Err("invalid input: entries must not be empty".to_string());
    }
    if params.entries.len() > params.max_results
        || params.entries.len() > CODEBASE_INDEX_QUERY_MAX_RESULTS
    {
        return Err("invalid input: entries exceeds bounded selection limit".to_string());
    }
    if !is_safe_codebase_index_path(&params.read_path, false) {
        return Err("invalid input: read_path is unsafe".to_string());
    }
    let file_kind_filter = match params.file_kind_filter.as_deref() {
        Some(value) => {
            if value.chars().count() > 32 {
                return Err("invalid input: file_kind_filter is too long".to_string());
            }
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else if is_supported_codebase_index_file_kind(trimmed) {
                Some(trimmed.to_string())
            } else {
                return Err("invalid input: file_kind_filter is unsupported".to_string());
            }
        }
        None => None,
    };

    let mut selected_entry = None;
    for entry in &params.entries {
        validate_codebase_index_selection_read_entry(entry)?;
        if file_kind_filter
            .as_deref()
            .is_some_and(|file_kind| entry.file_kind != file_kind)
        {
            return Err("invalid input: entry does not match file_kind_filter".to_string());
        }
        if entry.path == params.read_path {
            if selected_entry.is_some() {
                return Err("invalid input: read_path appears multiple times".to_string());
            }
            selected_entry = Some(entry.clone());
        }
    }
    let Some(selected_entry) = selected_entry else {
        return Err("invalid input: read_path is not present in entries".to_string());
    };
    if usize::try_from(selected_entry.byte_length)
        .map(|byte_length| byte_length > MAX_WORKSPACE_READ_BYTES)
        .unwrap_or(true)
    {
        return Err("invalid input: selected entry exceeds bounded read limit".to_string());
    }
    let expected_content_sha256 = selected_entry
        .content_sha256
        .clone()
        .ok_or_else(|| "invalid input: selected entry requires content_sha256".to_string())?;
    let selection_fingerprint = codebase_index_selection_fingerprint(
        &params.query_fingerprint,
        &params.snapshot.snapshot_fingerprint,
        file_kind_filter.as_deref(),
        params.max_results,
        &params.entries,
    );
    let expected_selection_id = format!(
        "selection_{}",
        fingerprint_short_suffix(&selection_fingerprint).expect("selection fingerprint is sha256")
    );
    if params.selection_id != expected_selection_id {
        return Err("invalid input: selection_id does not match selection fingerprint".to_string());
    }
    Ok(ValidatedCodebaseIndexSelectionRead {
        file_kind_filter,
        selected_entry,
        selection_fingerprint,
        expected_content_sha256,
    })
}

fn validate_codebase_index_query_snapshot_summary(
    snapshot: &CodebaseIndexQuerySnapshotSummary,
) -> Result<(), String> {
    if !is_codebase_index_id(&snapshot.index_id)
        || !is_safe_codebase_index_path(&snapshot.root, true)
        || !is_sha256_fingerprint(&snapshot.workspace_fingerprint)
        || !is_sha256_fingerprint(&snapshot.snapshot_fingerprint)
        || snapshot.built_at.trim().is_empty()
    {
        return Err("invalid input: snapshot is malformed".to_string());
    }
    Ok(())
}

fn validate_codebase_index_selection_read_entry(
    entry: &CodebaseIndexSelectedEntry,
) -> Result<(), String> {
    if !is_safe_codebase_index_path(&entry.path, false) {
        return Err("invalid input: selected entry path is unsafe".to_string());
    }
    if !is_supported_codebase_index_file_kind(&entry.file_kind) {
        return Err("invalid input: selected entry file_kind is unsupported".to_string());
    }
    let Some(content_sha256) = entry.content_sha256.as_deref() else {
        return Err("invalid input: selected entry requires content_sha256".to_string());
    };
    if !is_sha256_fingerprint(content_sha256) {
        return Err("invalid input: selected entry content_sha256 is malformed".to_string());
    }
    if entry.score == 0 {
        return Err("invalid input: selected entry score must be positive".to_string());
    }
    if entry.match_reasons.is_empty() || entry.match_reasons.len() > 5 {
        return Err("invalid input: selected entry match_reasons are malformed".to_string());
    }
    if entry
        .match_reasons
        .iter()
        .any(|reason| !is_codebase_index_match_reason(reason))
    {
        return Err("invalid input: selected entry match_reasons are unsupported".to_string());
    }
    Ok(())
}

fn validate_codebase_index_selection_read_current_snapshot(
    manifest: &CodebaseIndexSnapshotManifest,
    params: &CodebaseIndexSelectionReadParams,
    selected_entry: &CodebaseIndexSelectedEntry,
) -> Result<(), String> {
    if manifest.snapshot.index_id != params.snapshot.index_id
        || manifest.snapshot.root != params.snapshot.root
        || manifest.snapshot.workspace_fingerprint != params.snapshot.workspace_fingerprint
        || manifest.snapshot.snapshot_fingerprint != params.snapshot.snapshot_fingerprint
        || manifest.snapshot.built_at != params.snapshot.built_at
        || manifest.snapshot.truncated != params.snapshot.truncated
    {
        return Err("invalid input: current snapshot does not match selection binding".to_string());
    }
    let Some(current_entry) = manifest
        .entries
        .iter()
        .find(|entry| entry.path == selected_entry.path)
    else {
        return Err("invalid input: selected path is missing from current snapshot".to_string());
    };
    if current_entry.file_kind != selected_entry.file_kind
        || current_entry.byte_length != selected_entry.byte_length
        || current_entry.line_count != selected_entry.line_count
        || current_entry.content_sha256 != selected_entry.content_sha256
    {
        return Err("invalid input: current snapshot entry does not match selection".to_string());
    }
    Ok(())
}

fn codebase_index_query_evidence_matches(
    event: &brownie_store::CodebaseIndexLedgerEvent,
    params: &CodebaseIndexSelectionReadParams,
    selection_fingerprint: &str,
    file_kind_filter: Option<&str>,
) -> bool {
    if event.kind != LedgerEventKind::CodebaseIndexQueryCompleted {
        return false;
    }
    event_payload_str(&event.payload, "query_id") == Some(params.query_id.as_str())
        && event_payload_str(&event.payload, "selection_id") == Some(params.selection_id.as_str())
        && event_payload_str(&event.payload, "query_fingerprint")
            == Some(params.query_fingerprint.as_str())
        && event_payload_str(&event.payload, "selection_fingerprint") == Some(selection_fingerprint)
        && event_payload_str(&event.payload, "index_id") == Some(params.snapshot.index_id.as_str())
        && event_payload_str(&event.payload, "workspace_fingerprint")
            == Some(params.snapshot.workspace_fingerprint.as_str())
        && event_payload_str(&event.payload, "snapshot_fingerprint")
            == Some(params.snapshot.snapshot_fingerprint.as_str())
        && event_payload_usize(&event.payload, "max_results") == Some(params.max_results)
        && event_payload_str(&event.payload, "file_kind_filter")
            == Some(file_kind_filter.unwrap_or(""))
}

fn codebase_index_selection_read_permission_payload(
    mode_id: &str,
    allowed: bool,
    reason: &str,
    params: &CodebaseIndexSelectionReadParams,
    selection_fingerprint: &str,
    file_kind_filter: Option<&str>,
) -> Value {
    json!({
        "mode_id": mode_id,
        "action": RuntimeActionName::IndexCodebase,
        "request_kind": "selection_read",
        "allowed": allowed,
        "reason": preview_with_limit(reason, 160),
        "query_id": params.query_id,
        "selection_id": params.selection_id,
        "query_fingerprint": params.query_fingerprint,
        "selection_fingerprint": selection_fingerprint,
        "index_id": params.snapshot.index_id,
        "workspace_fingerprint": params.snapshot.workspace_fingerprint,
        "snapshot_fingerprint": params.snapshot.snapshot_fingerprint,
        "entry_count": params.entries.len(),
        "max_results": params.max_results,
        "file_kind_filter": file_kind_filter.unwrap_or(""),
    })
}

fn codebase_index_selection_read_event_payload(
    mode_id: &str,
    params: &CodebaseIndexSelectionReadParams,
    validated: &ValidatedCodebaseIndexSelectionRead,
    bytes_read: usize,
    truncated: bool,
) -> Value {
    json!({
        "mode_id": mode_id,
        "tool_id": CODEBASE_INDEX_SELECTION_READ_TOOL_ID,
        "query_id": params.query_id,
        "selection_id": params.selection_id,
        "query_fingerprint": params.query_fingerprint,
        "selection_fingerprint": validated.selection_fingerprint,
        "index_id": params.snapshot.index_id,
        "workspace_fingerprint": params.snapshot.workspace_fingerprint,
        "snapshot_fingerprint": params.snapshot.snapshot_fingerprint,
        "snapshot_truncated": params.snapshot.truncated,
        "read_path_fingerprint": format!("sha256:{}", hex_sha256(params.read_path.as_bytes())),
        "file_kind": validated.selected_entry.file_kind,
        "byte_length": validated.selected_entry.byte_length,
        "bytes_read": bytes_read,
        "truncated": truncated,
        "content_sha256": validated.expected_content_sha256,
        "content_hash_verified": true,
        "entry_count": params.entries.len(),
        "max_results": params.max_results,
        "file_kind_filter": validated.file_kind_filter.as_deref().unwrap_or(""),
        "next_action": CODEBASE_INDEX_SELECTION_READ_NEXT_ACTION,
    })
}

#[derive(Debug, Clone)]
pub(super) struct ValidatedTaskRunSelectedIndexContext {
    pub(super) prompt_context: SelectedIndexPromptContext,
    pub(super) summary: TaskRunSelectedIndexPromptContextSummary,
    pub(super) event_payload: Value,
}

#[derive(Debug, Clone)]
pub(super) struct ValidatedSelectedIndexContextEvidence {
    read_path_fingerprint: String,
    content_char_count: usize,
}

pub(super) fn validate_task_run_selected_index_context(
    store: &BrownieStore,
    record: &brownie_protocol::TaskRecord,
    policy: &CompiledModePolicy,
    context: &TaskRunSelectedIndexContext,
) -> Result<ValidatedTaskRunSelectedIndexContext, TaskRunAdmissionRejection> {
    let evidence = validate_selected_index_context_evidence(store, policy, context)?;
    let prompt_context_id = selected_index_prompt_context_id(record, context);
    let summary = TaskRunSelectedIndexPromptContextSummary {
        prompt_context_id: prompt_context_id.clone(),
        source_event_id: context.ledger_event_id.clone(),
        source_event_kind: context.ledger_event_kind.clone(),
        query_id: context.query_id.clone(),
        selection_id: context.selection_id.clone(),
        query_fingerprint: context.query_fingerprint.clone(),
        selection_fingerprint: context.selection_fingerprint.clone(),
        index_id: context.snapshot.index_id.clone(),
        workspace_fingerprint: context.snapshot.workspace_fingerprint.clone(),
        snapshot_fingerprint: context.snapshot.snapshot_fingerprint.clone(),
        read_path_fingerprint: evidence.read_path_fingerprint.clone(),
        file_kind: context.file_kind.clone(),
        bytes_read: context.bytes_read,
        content_char_count: evidence.content_char_count,
        materialized_content_char_count: evidence.content_char_count,
        content_truncated_for_prompt: false,
        content_sha256: context.content_sha256.clone(),
        prompt_preview_redacted: true,
        next_action: CODEBASE_INDEX_PROMPT_CONTEXT_NEXT_ACTION.to_string(),
    };
    let prompt_context = SelectedIndexPromptContext {
        prompt_context_id: prompt_context_id.clone(),
        source_event_id: context.ledger_event_id.clone(),
        query_id: context.query_id.clone(),
        selection_id: context.selection_id.clone(),
        selection_fingerprint: context.selection_fingerprint.clone(),
        snapshot_fingerprint: context.snapshot.snapshot_fingerprint.clone(),
        path: context.path.clone(),
        file_kind: context.file_kind.clone(),
        bytes_read: context.bytes_read,
        content_sha256: context.content_sha256.clone(),
        content_char_count: evidence.content_char_count,
        materialized_content_char_count: evidence.content_char_count,
        content_truncated_for_prompt: false,
        content: context.content.clone(),
    };
    let event_payload =
        codebase_index_prompt_context_materialized_payload(record, policy, &summary);
    Ok(ValidatedTaskRunSelectedIndexContext {
        prompt_context,
        summary,
        event_payload,
    })
}

pub(super) fn validate_selected_index_context_evidence(
    store: &BrownieStore,
    policy: &CompiledModePolicy,
    context: &TaskRunSelectedIndexContext,
) -> Result<ValidatedSelectedIndexContextEvidence, TaskRunAdmissionRejection> {
    validate_selected_index_context_permission(policy, RuntimeAction::ReadWorkspace)?;
    validate_selected_index_context_permission(policy, RuntimeAction::IndexCodebase)?;
    if !is_codebase_index_query_id(&context.query_id) {
        return invalid_selected_index_context("query_id is malformed");
    }
    if !is_codebase_index_selection_id(&context.selection_id) {
        return invalid_selected_index_context("selection_id is malformed");
    }
    if !is_sha256_fingerprint(&context.query_fingerprint) {
        return invalid_selected_index_context("query_fingerprint is malformed");
    }
    if !is_sha256_fingerprint(&context.selection_fingerprint) {
        return invalid_selected_index_context("selection_fingerprint is malformed");
    }
    validate_codebase_index_query_snapshot_summary(&context.snapshot)
        .map_err(|message| selected_index_context_invalid_params(&message))?;
    if !is_safe_codebase_index_path(&context.path, false) {
        return invalid_selected_index_context("path is unsafe");
    }
    if !is_supported_codebase_index_file_kind(&context.file_kind) {
        return invalid_selected_index_context("file_kind is unsupported");
    }
    if context.truncated {
        return invalid_selected_index_context("truncated selected content is not allowed");
    }
    if context.content.as_bytes().len() > MAX_WORKSPACE_READ_BYTES {
        return invalid_selected_index_context("content exceeds bounded read limit");
    }
    if context.bytes_read != context.content.as_bytes().len() {
        return invalid_selected_index_context("bytes_read does not match content byte length");
    }
    let actual_content_sha256 = format!("sha256:{}", hex_sha256(context.content.as_bytes()));
    if context.content_sha256 != actual_content_sha256 {
        return invalid_selected_index_context("content_sha256 does not match content");
    }
    if !context.content_hash_verified {
        return invalid_selected_index_context("content_hash_verified must be true");
    }
    if context.ledger_event_id.trim().is_empty() {
        return invalid_selected_index_context("ledger_event_id is required");
    }
    if context.ledger_event_kind != "CodebaseIndexSelectionReadCompleted" {
        return invalid_selected_index_context(
            "ledger_event_kind must be CodebaseIndexSelectionReadCompleted",
        );
    }
    if context.next_action != CODEBASE_INDEX_SELECTION_READ_NEXT_ACTION {
        return invalid_selected_index_context("next_action is stale");
    }

    let events = store
        .codebase_index()
        .read_events()
        .map_err(|error| selected_index_context_internal(&error.to_string()))?;
    let Some(source_event) = events
        .iter()
        .find(|event| event.event_id == context.ledger_event_id)
    else {
        return invalid_selected_index_context("source selected-read ledger event is missing");
    };
    if source_event.kind != LedgerEventKind::CodebaseIndexSelectionReadCompleted {
        return invalid_selected_index_context(
            "source ledger event kind is not CodebaseIndexSelectionReadCompleted",
        );
    }
    let read_path_fingerprint = format!("sha256:{}", hex_sha256(context.path.as_bytes()));
    if !selected_index_context_source_payload_matches(
        &source_event.payload,
        context,
        &read_path_fingerprint,
    ) {
        return invalid_selected_index_context("source selected-read ledger event does not match");
    }

    Ok(ValidatedSelectedIndexContextEvidence {
        read_path_fingerprint,
        content_char_count: context.content.chars().count(),
    })
}

pub(super) fn validate_selected_index_context_permission(
    policy: &CompiledModePolicy,
    action: RuntimeAction,
) -> Result<(), TaskRunAdmissionRejection> {
    let decision = RuntimePermissionGate::check(policy, action);
    if decision.allowed {
        return Ok(());
    }
    Err(TaskRunAdmissionRejection::InvalidParams(
        "invalid params: selected_index_context permission is required",
    ))
}

fn selected_index_context_source_payload_matches(
    payload: &Value,
    context: &TaskRunSelectedIndexContext,
    read_path_fingerprint: &str,
) -> bool {
    event_payload_str(payload, "query_id") == Some(context.query_id.as_str())
        && event_payload_str(payload, "selection_id") == Some(context.selection_id.as_str())
        && event_payload_str(payload, "query_fingerprint")
            == Some(context.query_fingerprint.as_str())
        && event_payload_str(payload, "selection_fingerprint")
            == Some(context.selection_fingerprint.as_str())
        && event_payload_str(payload, "index_id") == Some(context.snapshot.index_id.as_str())
        && event_payload_str(payload, "workspace_fingerprint")
            == Some(context.snapshot.workspace_fingerprint.as_str())
        && event_payload_str(payload, "snapshot_fingerprint")
            == Some(context.snapshot.snapshot_fingerprint.as_str())
        && payload.get("snapshot_truncated").and_then(Value::as_bool)
            == Some(context.snapshot.truncated)
        && event_payload_str(payload, "read_path_fingerprint") == Some(read_path_fingerprint)
        && event_payload_str(payload, "file_kind") == Some(context.file_kind.as_str())
        && event_payload_usize(payload, "byte_length") == Some(context.bytes_read)
        && event_payload_usize(payload, "bytes_read") == Some(context.bytes_read)
        && payload.get("truncated").and_then(Value::as_bool) == Some(false)
        && event_payload_str(payload, "content_sha256") == Some(context.content_sha256.as_str())
        && payload
            .get("content_hash_verified")
            .and_then(Value::as_bool)
            == Some(true)
        && event_payload_str(payload, "next_action")
            == Some(CODEBASE_INDEX_SELECTION_READ_NEXT_ACTION)
}

fn selected_index_prompt_context_id(
    record: &brownie_protocol::TaskRecord,
    context: &TaskRunSelectedIndexContext,
) -> String {
    let seed = json!({
        "version": "selected_index_prompt_context_v1",
        "task_id": record.task_id,
        "run_id": record.run_id,
        "source_event_id": context.ledger_event_id,
        "query_id": context.query_id,
        "selection_id": context.selection_id,
        "selection_fingerprint": context.selection_fingerprint,
        "content_sha256": context.content_sha256,
    });
    let digest = hex_sha256(seed.to_string().as_bytes());
    format!("ctx_{}", &digest[..16])
}

fn codebase_index_prompt_context_materialized_payload(
    record: &brownie_protocol::TaskRecord,
    policy: &CompiledModePolicy,
    summary: &TaskRunSelectedIndexPromptContextSummary,
) -> Value {
    json!({
        "mode_id": policy.mode_id,
        "task_id": record.task_id,
        "run_id": record.run_id,
        "prompt_context_id": summary.prompt_context_id,
        "source_event_id": summary.source_event_id,
        "source_event_kind": summary.source_event_kind,
        "query_id": summary.query_id,
        "selection_id": summary.selection_id,
        "query_fingerprint": summary.query_fingerprint,
        "selection_fingerprint": summary.selection_fingerprint,
        "index_id": summary.index_id,
        "workspace_fingerprint": summary.workspace_fingerprint,
        "snapshot_fingerprint": summary.snapshot_fingerprint,
        "read_path_fingerprint": summary.read_path_fingerprint,
        "file_kind": summary.file_kind,
        "bytes_read": summary.bytes_read,
        "content_char_count": summary.content_char_count,
        "content_sha256": summary.content_sha256,
        "content_hash_verified": true,
        "prompt_preview_redacted": true,
        "next_action": summary.next_action,
    })
}

pub(super) fn append_codebase_index_prompt_context_materialized(
    store: &BrownieStore,
    running: &brownie_protocol::TaskRecord,
    selected_context: &ValidatedTaskRunSelectedIndexContext,
) -> anyhow::Result<()> {
    store.tasks().append_task_event_with_payload(
        running,
        LedgerEventKind::CodebaseIndexPromptContextMaterialized,
        Some(selected_context.event_payload.clone()),
    )?;
    Ok(())
}

fn event_payload_str<'a>(payload: &'a Value, field: &str) -> Option<&'a str> {
    payload.get(field).and_then(Value::as_str)
}

fn event_payload_usize(payload: &Value, field: &str) -> Option<usize> {
    payload
        .get(field)
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
}

fn codebase_index_match_reason_counts(
    entries: &[CodebaseIndexSelectedEntry],
) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for entry in entries {
        for reason in &entry.match_reasons {
            *counts.entry(reason.clone()).or_insert(0) += 1;
        }
    }
    counts
}

pub(super) fn fingerprint_short_suffix(fingerprint: &str) -> Option<&str> {
    fingerprint
        .strip_prefix("sha256:")
        .and_then(|hex| hex.get(..16))
}

fn is_codebase_index_id(value: &str) -> bool {
    value.starts_with("idx_")
        && value.len() == "idx_".len() + 16
        && value["idx_".len()..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn is_codebase_index_query_id(value: &str) -> bool {
    value.starts_with("query_")
        && value.len() == "query_".len() + 16
        && value["query_".len()..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn is_codebase_index_selection_id(value: &str) -> bool {
    value.starts_with("selection_")
        && value.len() == "selection_".len() + 16
        && value["selection_".len()..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn is_supported_codebase_index_file_kind(kind: &str) -> bool {
    matches!(
        kind,
        "Rust"
            | "TypeScript"
            | "JavaScript"
            | "Json"
            | "Toml"
            | "Markdown"
            | "Yaml"
            | "Shell"
            | "Text"
            | "Other"
    )
}

fn is_codebase_index_match_reason(reason: &str) -> bool {
    matches!(
        reason,
        "path_exact" | "path_token" | "file_name" | "extension" | "kind"
    )
}

pub(super) fn is_safe_codebase_index_path(value: &str, allow_root: bool) -> bool {
    if allow_root && value == "." {
        return true;
    }
    if value.is_empty()
        || value.len() > 1024
        || value.starts_with('/')
        || value.starts_with('~')
        || value.contains('\\')
    {
        return false;
    }
    value.split('/').all(|part| {
        !part.is_empty()
            && part != "."
            && part != ".."
            && !matches!(
                part,
                ".git"
                    | ".brownie"
                    | "node_modules"
                    | "target"
                    | "dist"
                    | "build"
                    | "coverage"
                    | ".next"
                    | "out"
                    | "vendor"
            )
    })
}

fn normalize_mode_id(mode_id: Option<&str>) -> Result<String, String> {
    let Some(mode_id) = mode_id else {
        return Err("invalid params: mode_id is required".to_string());
    };
    let trimmed = mode_id.trim();
    if trimmed.is_empty() {
        return Err("invalid params: mode_id must not be empty".to_string());
    }
    if trimmed.chars().count() > 80 {
        return Err("invalid params: mode_id is too long".to_string());
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err("invalid params: mode_id contains unsupported characters".to_string());
    }
    Ok(trimmed.to_string())
}

fn codebase_index_permission_payload(
    mode_id: &str,
    allowed: bool,
    reason: &str,
    params: &CodebaseIndexBuildParams,
) -> Value {
    json!({
        "mode_id": mode_id,
        "action": RuntimeActionName::IndexCodebase,
        "allowed": allowed,
        "reason": preview_with_limit(reason, 160),
        "requested_root_present": params.root.as_ref().is_some_and(|root| !root.trim().is_empty()),
        "requested_force_refresh": params.force_refresh.unwrap_or(false),
    })
}

fn codebase_index_build_event_payload(
    manifest: &CodebaseIndexSnapshotManifest,
    mode_id: &str,
    params: &CodebaseIndexBuildParams,
) -> Value {
    serde_json::json!({
        "index_id": manifest.snapshot.index_id.clone(),
        "mode_id": mode_id,
        "root": manifest.snapshot.root.clone(),
        "workspace_fingerprint": manifest.snapshot.workspace_fingerprint.clone(),
        "snapshot_fingerprint": manifest.snapshot.snapshot_fingerprint.clone(),
        "built_at": manifest.snapshot.built_at.clone(),
        "indexed_files": manifest.snapshot.counts.indexed_files,
        "walked_directories": manifest.snapshot.counts.walked_directories,
        "skipped_protected": manifest.snapshot.counts.skipped_protected,
        "skipped_ignored": manifest.snapshot.counts.skipped_ignored,
        "skipped_sensitive": manifest.snapshot.counts.skipped_sensitive,
        "skipped_symlink": manifest.snapshot.counts.skipped_symlink,
        "skipped_too_large": manifest.snapshot.counts.skipped_too_large,
        "skipped_binary_like": manifest.snapshot.counts.skipped_binary_like,
        "skipped_unreadable": manifest.snapshot.counts.skipped_unreadable,
        "skipped_unsafe_path": manifest.snapshot.counts.skipped_unsafe_path,
        "skipped_other": manifest.snapshot.counts.skipped_other,
        "truncated_entries": manifest.snapshot.counts.truncated_entries,
        "visited_entries": manifest.snapshot.counts.visited_entries,
        "truncated_directories": manifest.snapshot.counts.truncated_directories,
        "ignore_rule_files_loaded": manifest.snapshot.counts.ignore_rule_files_loaded,
        "ignore_rule_count": manifest.snapshot.counts.ignore_rule_count,
        "sensitive_finding_count": manifest.snapshot.counts.sensitive_finding_count,
        "truncated": manifest.snapshot.truncated,
        "max_files": manifest.snapshot.limits.max_files,
        "max_directories": manifest.snapshot.limits.max_directories,
        "max_path_chars": manifest.snapshot.limits.max_path_chars,
        "max_file_bytes": manifest.snapshot.limits.max_file_bytes,
        "max_visited_entries": manifest.snapshot.limits.max_visited_entries,
        "max_directory_entries": manifest.snapshot.limits.max_directory_entries,
        "requested_force_refresh": params.force_refresh.unwrap_or(false),
        "next_action": CODEBASE_INDEX_NEXT_ACTION
    })
}

fn codebase_index_manifest(
    snapshot: CodebaseIndexSnapshot,
    built_at: String,
) -> CodebaseIndexSnapshotManifest {
    CodebaseIndexSnapshotManifest {
        snapshot: CodebaseIndexSnapshotSummary {
            index_id: snapshot.index_id,
            root: snapshot.root,
            workspace_fingerprint: snapshot.workspace_fingerprint,
            snapshot_fingerprint: snapshot.snapshot_fingerprint,
            built_at,
            counts: CodebaseIndexCountsSummary {
                indexed_files: snapshot.counts.indexed_files,
                walked_directories: snapshot.counts.walked_directories,
                skipped_protected: snapshot.counts.skipped_protected,
                skipped_ignored: snapshot.counts.skipped_ignored,
                skipped_sensitive: snapshot.counts.skipped_sensitive,
                skipped_symlink: snapshot.counts.skipped_symlink,
                skipped_too_large: snapshot.counts.skipped_too_large,
                skipped_binary_like: snapshot.counts.skipped_binary_like,
                skipped_unreadable: snapshot.counts.skipped_unreadable,
                skipped_unsafe_path: snapshot.counts.skipped_unsafe_path,
                skipped_other: snapshot.counts.skipped_other,
                truncated_entries: snapshot.counts.truncated_entries,
                visited_entries: snapshot.counts.visited_entries,
                truncated_directories: snapshot.counts.truncated_directories,
                ignore_rule_files_loaded: snapshot.counts.ignore_rule_files_loaded,
                ignore_rule_count: snapshot.counts.ignore_rule_count,
                sensitive_finding_count: snapshot.counts.sensitive_finding_count,
            },
            limits: CodebaseIndexLimitsSummary {
                max_files: snapshot.limits.max_files,
                max_directories: snapshot.limits.max_directories,
                max_path_chars: snapshot.limits.max_path_chars,
                max_file_bytes: snapshot.limits.max_file_bytes,
                max_visited_entries: snapshot.limits.max_visited_entries,
                max_directory_entries: snapshot.limits.max_directory_entries,
            },
            truncated: snapshot.truncated,
        },
        entries: snapshot
            .entries
            .into_iter()
            .map(|entry| CodebaseIndexFileEntry {
                path: entry.path,
                file_kind: format!("{:?}", entry.file_kind),
                byte_length: entry.byte_length,
                line_count: entry.line_count,
                content_sha256: entry.content_sha256,
            })
            .collect(),
    }
}

pub(super) fn codebase_index_timestamp() -> anyhow::Result<String> {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(anyhow::Error::from)
}
