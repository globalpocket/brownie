use super::*;

pub(super) fn handle_proposal_apply(id: Value, params: Option<Value>) -> JsonRpcResponse<Value> {
    let params: ProposalApplyParams = match parse_params(params) {
        Ok(params) => params,
        Err(message) => return error_response(id, -32602, &message),
    };
    if params.run_id.trim().is_empty()
        || (params.proposal_id.trim().is_empty() && params.transaction_items.is_none())
    {
        return error_response(
            id,
            -32602,
            "invalid params: run_id and proposal_id are required unless transaction_items are provided",
        );
    }
    let store = match BrownieStore::from_env_or_cwd() {
        Ok(store) => store,
        Err(error) => return error_response(id, -32602, &format!("invalid params: {error}")),
    };
    match apply_proposal(&store, &params) {
        Ok((proposal, apply_result)) => result_response(
            id,
            json!(ProposalApplyResult {
                proposal,
                apply_result
            }),
        ),
        Err(message) => error_response(id, -32602, &message),
    }
}

const APPLY_APPROVAL_TTL_SECONDS: i64 = 15 * 60;

fn apply_result_check(
    name: &str,
    status: &str,
    reason: Option<&str>,
) -> WorkspacePatchApplyResultCheckSummary {
    WorkspacePatchApplyResultCheckSummary {
        name: name.to_string(),
        status: status.to_string(),
        reason: reason.map(ToString::to_string),
    }
}

fn record_apply_result(
    store: &BrownieStore,
    task: &TaskRecord,
    run_id: &str,
    proposal_id: &str,
    mut apply_result: WorkspacePatchApplyResultSummary,
) -> Result<
    (
        WorkspacePatchProposalSummary,
        WorkspacePatchApplyResultSummary,
    ),
    String,
> {
    apply_result.check_count = apply_result.checklist.len();
    apply_result.failed_checks = apply_result
        .checklist
        .iter()
        .filter(|check| check.status == "Fail")
        .map(|check| check.name.clone())
        .collect();
    apply_result.blocked_checks = apply_result
        .checklist
        .iter()
        .filter(|check| check.status == "Blocked")
        .map(|check| check.name.clone())
        .collect();
    let mut payload = json!({
        "proposal_id": proposal_id,
        "apply_id": &apply_result.apply_id,
        "apply_status": &apply_result.apply_status,
        "apply_reason": &apply_result.apply_reason,
        "authorization_id": &apply_result.authorization_id,
        "authorization_consumed": apply_result.authorization_consumed,
        "applied": apply_result.applied,
        "operation": &apply_result.operation,
        "atomic_replacement_completed": apply_result.atomic_replacement_completed,
        "atomic_create_completed": apply_result.atomic_create_completed,
        "atomic_delete_completed": apply_result.atomic_delete_completed,
        "path": &apply_result.path,
        "expected_target_sha256": &apply_result.expected_target_sha256,
        "expected_target_absent": apply_result.expected_target_absent,
        "pre_write_target_sha256": &apply_result.pre_write_target_sha256,
        "pre_write_target_exists": apply_result.pre_write_target_exists,
        "post_write_sha256": &apply_result.post_write_sha256,
        "post_delete_target_exists": apply_result.post_delete_target_exists,
        "content_chars": apply_result.content_chars,
        "content_bytes": apply_result.content_bytes,
        "checked_at": &apply_result.checked_at,
        "applied_at": &apply_result.applied_at,
        "temp_file_cleaned": apply_result.temp_file_cleaned,
        "check_count": apply_result.check_count,
        "failed_checks": &apply_result.failed_checks,
        "blocked_checks": &apply_result.blocked_checks,
    });
    if let Some(transaction_id) = &apply_result.transaction_id {
        if let Some(payload_object) = payload.as_object_mut() {
            payload_object.insert("transaction_id".to_string(), json!(transaction_id));
            payload_object.insert(
                "transaction_status".to_string(),
                json!(&apply_result.transaction_status),
            );
            payload_object.insert(
                "transaction_item_count".to_string(),
                json!(apply_result.transaction_items.len()),
            );
            payload_object.insert(
                "transaction_items".to_string(),
                json!(&apply_result.transaction_items),
            );
        }
    }
    if let Some(recovery_source) = &apply_result.transaction_recovery_source {
        if let Some(payload_object) = payload.as_object_mut() {
            payload_object.insert(
                "transaction_recovery_source".to_string(),
                json!(recovery_source),
            );
            payload_object.insert(
                "transaction_recovery_status".to_string(),
                json!(&apply_result.transaction_recovery_status),
            );
        }
    }
    store
        .tasks()
        .append_task_event_with_payload(
            task,
            LedgerEventKind::WorkspacePatchApplyResultRecorded,
            Some(payload),
        )
        .map_err(|e| format!("invalid params: {e}"))?;
    Ok((inspect_proposal(store, run_id, proposal_id)?, apply_result))
}

fn resolve_apply_write_policy(
    store: &BrownieStore,
    task: &TaskRecord,
) -> Result<CompiledModePolicy, String> {
    let events = store
        .tasks()
        .read_ledger_events(&task.run_id)
        .map_err(|error| format!("invalid params: {error}"))?;
    if let Some(mode_event) = events
        .iter()
        .rev()
        .find(|event| event.kind == LedgerEventKind::ModeResolved)
    {
        let payload = mode_event
            .payload
            .as_ref()
            .ok_or_else(|| "apply permission check failed: mode evidence is missing".to_string())?;
        return compiled_mode_policy_from_payload(payload).ok_or_else(|| {
            "apply permission check failed: mode evidence is malformed".to_string()
        });
    }
    let mode_id = task
        .mode_id
        .as_deref()
        .filter(|mode_id| !mode_id.trim().is_empty())
        .ok_or_else(|| "apply permission check failed: source run mode is missing".to_string())?;
    resolve_workspace_mode_policy(store, mode_id)?
        .ok_or_else(|| "apply permission check failed: source run mode is unknown".to_string())
}

fn append_apply_write_permission_check(
    store: &BrownieStore,
    task: &TaskRecord,
    apply_result: &mut WorkspacePatchApplyResultSummary,
) -> Result<bool, String> {
    let policy = match resolve_apply_write_policy(store, task) {
        Ok(policy) => policy,
        Err(reason) => {
            apply_result.checklist.push(apply_result_check(
                "apply_time_write_workspace_permission",
                "Fail",
                Some(&reason),
            ));
            apply_result.apply_reason = reason.clone();
            let payload = json!({
                "scope": "proposal.apply",
                "apply_id": apply_result.apply_id,
                "proposal_id": apply_result.proposal_id,
                "operation": apply_result.operation,
                "required_action": "WriteWorkspace",
                "allowed": false,
                "reason": reason,
            });
            store
                .tasks()
                .append_task_event_with_payload(
                    task,
                    LedgerEventKind::PermissionChecked,
                    Some(payload.clone()),
                )
                .map_err(|e| format!("invalid params: {e}"))?;
            store
                .tasks()
                .append_task_event_with_payload(
                    task,
                    LedgerEventKind::PermissionDenied,
                    Some(payload),
                )
                .map_err(|e| format!("invalid params: {e}"))?;
            return Ok(false);
        }
    };
    let decision = RuntimePermissionGate::check(&policy, RuntimeAction::WriteWorkspace);
    let status = if decision.allowed { "Pass" } else { "Fail" };
    apply_result.checklist.push(apply_result_check(
        "apply_time_write_workspace_permission",
        status,
        Some(&decision.reason),
    ));
    if !decision.allowed {
        apply_result.apply_reason = decision.reason.clone();
    }
    let payload = json!({
        "scope": "proposal.apply",
        "apply_id": apply_result.apply_id,
        "proposal_id": apply_result.proposal_id,
        "operation": apply_result.operation,
        "mode_id": policy.mode_id,
        "required_action": "WriteWorkspace",
        "allowed": decision.allowed,
        "reason": decision.reason,
    });
    store
        .tasks()
        .append_task_event_with_payload(
            task,
            LedgerEventKind::PermissionChecked,
            Some(payload.clone()),
        )
        .map_err(|e| format!("invalid params: {e}"))?;
    if !decision.allowed {
        store
            .tasks()
            .append_task_event_with_payload(task, LedgerEventKind::PermissionDenied, Some(payload))
            .map_err(|e| format!("invalid params: {e}"))?;
    }
    Ok(decision.allowed)
}

fn has_consumed_apply_authorization(events: &[LedgerEvent], proposal_id: &str) -> bool {
    events.iter().any(|event| {
        if event.kind != LedgerEventKind::WorkspacePatchApplyResultRecorded {
            return false;
        }
        let Some(payload) = sanitize_ledger_payload(event.payload.clone()) else {
            return false;
        };
        let consumed = payload
            .get("authorization_consumed")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let applied = payload
            .get("applied")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !consumed || !applied {
            return false;
        }
        if payload.get("proposal_id").and_then(Value::as_str) == Some(proposal_id) {
            return true;
        }
        payload
            .get("transaction_items")
            .and_then(Value::as_array)
            .map(|items| {
                items.iter().any(|item| {
                    item.get("proposal_id").and_then(Value::as_str) == Some(proposal_id)
                        && item
                            .get("applied")
                            .and_then(Value::as_bool)
                            .unwrap_or(false)
                })
            })
            .unwrap_or(false)
    })
}

fn approval_current_failure_reason(approved_at: Option<&str>) -> Option<&'static str> {
    let Some(approved_at) = approved_at else {
        return Some("Proposal approval timestamp is missing.");
    };
    let Ok(approved_at) =
        time::OffsetDateTime::parse(approved_at, &time::format_description::well_known::Rfc3339)
    else {
        return Some("Proposal approval timestamp is invalid.");
    };
    let now = time::OffsetDateTime::now_utc();
    if approved_at > now + time::Duration::seconds(60) {
        return Some("Proposal approval timestamp is in the future.");
    }
    if now - approved_at > time::Duration::seconds(APPLY_APPROVAL_TTL_SECONDS) {
        return Some("Proposal approval has expired.");
    }
    None
}

pub(super) fn resolve_apply_target_path(
    store: &BrownieStore,
    proposal: &WorkspacePatchProposalSummary,
) -> Result<PathBuf, &'static str> {
    brownie_tools::preflight_workspace_write_path(&proposal.path)
        .map_err(|_| "Target path is not safe.")?;
    if std::path::Path::new(&proposal.path)
        .components()
        .any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("Target path is not safe.");
    }
    let root = store
        .workspace_root()
        .canonicalize()
        .map_err(|_| "Workspace root is not accessible.")?;
    let target = root.join(&proposal.path);
    let symlink_metadata =
        std::fs::symlink_metadata(&target).map_err(|_| "Target file does not exist.")?;
    if symlink_metadata.file_type().is_symlink() {
        return Err("Target path is a symlink.");
    }
    if !symlink_metadata.is_file() {
        return Err("Target path is not a regular file.");
    }
    let canonical_target = target
        .canonicalize()
        .map_err(|_| "Target file does not exist.")?;
    if !canonical_target.starts_with(&root) {
        return Err("Target path escapes workspace root.");
    }
    Ok(canonical_target)
}

fn resolve_create_apply_target_path(
    store: &BrownieStore,
    proposal: &WorkspacePatchProposalSummary,
) -> Result<PathBuf, &'static str> {
    brownie_tools::preflight_workspace_write_path(&proposal.path)
        .map_err(|_| "Target path is not safe.")?;
    let relative_path = Path::new(&proposal.path);
    if relative_path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err("Target path is not safe.");
    }
    let file_name = relative_path
        .file_name()
        .ok_or("Target file name is missing.")?;
    let root = store
        .workspace_root()
        .canonicalize()
        .map_err(|_| "Workspace root is not accessible.")?;
    let parent_relative = relative_path.parent().unwrap_or_else(|| Path::new(""));
    let parent = root.join(parent_relative);
    let parent_metadata = std::fs::symlink_metadata(&parent)
        .map_err(|_| "Target parent directory does not exist.")?;
    if parent_metadata.file_type().is_symlink() {
        return Err("Target parent directory is a symlink.");
    }
    if !parent_metadata.is_dir() {
        return Err("Target parent path is not a directory.");
    }
    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| "Target parent directory is not accessible.")?;
    if !canonical_parent.starts_with(&root) {
        return Err("Target parent escapes workspace root.");
    }
    let target = canonical_parent.join(file_name);
    match std::fs::symlink_metadata(&target) {
        Ok(_) => Err("Target path already exists."),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(target),
        Err(_) => Err("Target path is not accessible."),
    }
}

struct AtomicReplaceOutcome {
    post_write_sha256: Option<String>,
    temp_file_cleaned: bool,
    atomic_replacement_completed: bool,
    failure_reason: Option<&'static str>,
}

struct PreparedAtomicReplace {
    temp_path: PathBuf,
    parent_path: PathBuf,
}

struct PreparedAtomicReplaceOutcome {
    prepared: Option<PreparedAtomicReplace>,
    temp_file_cleaned: bool,
    failure_reason: Option<&'static str>,
}

struct AtomicCreateOutcome {
    post_write_sha256: Option<String>,
    temp_file_cleaned: bool,
    atomic_create_completed: bool,
    failure_reason: Option<&'static str>,
}

struct PreparedAtomicCreate {
    temp_file: tempfile::NamedTempFile,
    parent_path: PathBuf,
    target_path: PathBuf,
}

struct PreparedAtomicCreateOutcome {
    prepared: Option<PreparedAtomicCreate>,
    temp_file_cleaned: bool,
    failure_reason: Option<&'static str>,
}

struct AtomicDeleteOutcome {
    post_delete_target_exists: Option<bool>,
    atomic_delete_completed: bool,
    failure_reason: Option<&'static str>,
}

fn atomic_create_new_file(target: &Path, content_bytes: &[u8]) -> AtomicCreateOutcome {
    let Some(parent) = target.parent() else {
        return AtomicCreateOutcome {
            post_write_sha256: None,
            temp_file_cleaned: true,
            atomic_create_completed: false,
            failure_reason: Some("Target parent directory is unavailable."),
        };
    };
    let mut temp_file = match tempfile::NamedTempFile::new_in(parent) {
        Ok(file) => file,
        Err(_) => {
            return AtomicCreateOutcome {
                post_write_sha256: None,
                temp_file_cleaned: true,
                atomic_create_completed: false,
                failure_reason: Some("Temporary sibling file creation failed."),
            }
        }
    };
    if temp_file.write_all(content_bytes).is_err() {
        let cleaned = temp_file.close().is_ok();
        return AtomicCreateOutcome {
            post_write_sha256: None,
            temp_file_cleaned: cleaned,
            atomic_create_completed: false,
            failure_reason: Some("Bounded write to temporary sibling file failed."),
        };
    }
    if temp_file.flush().is_err() || temp_file.as_file().sync_all().is_err() {
        let cleaned = temp_file.close().is_ok();
        return AtomicCreateOutcome {
            post_write_sha256: None,
            temp_file_cleaned: cleaned,
            atomic_create_completed: false,
            failure_reason: Some("Temporary file flush or sync failed."),
        };
    }
    match temp_file.persist_noclobber(target) {
        Ok(persisted_file) => {
            let _ = persisted_file.sync_all();
        }
        Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
            let cleaned = error.file.close().is_ok();
            return AtomicCreateOutcome {
                post_write_sha256: None,
                temp_file_cleaned: cleaned,
                atomic_create_completed: false,
                failure_reason: Some("Target path already exists."),
            };
        }
        Err(error) => {
            let cleaned = error.file.close().is_ok();
            return AtomicCreateOutcome {
                post_write_sha256: None,
                temp_file_cleaned: cleaned,
                atomic_create_completed: false,
                failure_reason: Some("Atomic create failed."),
            };
        }
    }
    if let Ok(parent_dir) = std::fs::File::open(parent) {
        let _ = parent_dir.sync_all();
    }
    let post_write_bytes = match std::fs::read(target) {
        Ok(bytes) => bytes,
        Err(_) => {
            return AtomicCreateOutcome {
                post_write_sha256: None,
                temp_file_cleaned: true,
                atomic_create_completed: true,
                failure_reason: Some("Post-write verification read failed."),
            }
        }
    };
    AtomicCreateOutcome {
        post_write_sha256: Some(format!("sha256:{}", hex_sha256(&post_write_bytes))),
        temp_file_cleaned: true,
        atomic_create_completed: true,
        failure_reason: None,
    }
}

fn prepare_atomic_create_new_file(
    target: &Path,
    content_bytes: &[u8],
) -> PreparedAtomicCreateOutcome {
    let Some(parent) = target.parent() else {
        return PreparedAtomicCreateOutcome {
            prepared: None,
            temp_file_cleaned: true,
            failure_reason: Some("Target parent directory is unavailable."),
        };
    };
    let mut temp_file = match tempfile::NamedTempFile::new_in(parent) {
        Ok(file) => file,
        Err(_) => {
            return PreparedAtomicCreateOutcome {
                prepared: None,
                temp_file_cleaned: true,
                failure_reason: Some("Temporary sibling file creation failed."),
            }
        }
    };
    if temp_file.write_all(content_bytes).is_err() {
        let cleaned = temp_file.close().is_ok();
        return PreparedAtomicCreateOutcome {
            prepared: None,
            temp_file_cleaned: cleaned,
            failure_reason: Some("Bounded write to temporary sibling file failed."),
        };
    }
    if temp_file.flush().is_err() || temp_file.as_file().sync_all().is_err() {
        let cleaned = temp_file.close().is_ok();
        return PreparedAtomicCreateOutcome {
            prepared: None,
            temp_file_cleaned: cleaned,
            failure_reason: Some("Temporary file flush or sync failed."),
        };
    }
    PreparedAtomicCreateOutcome {
        prepared: Some(PreparedAtomicCreate {
            temp_file,
            parent_path: parent.to_path_buf(),
            target_path: target.to_path_buf(),
        }),
        temp_file_cleaned: false,
        failure_reason: None,
    }
}

fn commit_prepared_atomic_create(prepared: PreparedAtomicCreate) -> AtomicCreateOutcome {
    match prepared.temp_file.persist_noclobber(&prepared.target_path) {
        Ok(persisted_file) => {
            let _ = persisted_file.sync_all();
        }
        Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
            let cleaned = error.file.close().is_ok();
            return AtomicCreateOutcome {
                post_write_sha256: None,
                temp_file_cleaned: cleaned,
                atomic_create_completed: false,
                failure_reason: Some("Target path already exists."),
            };
        }
        Err(error) => {
            let cleaned = error.file.close().is_ok();
            return AtomicCreateOutcome {
                post_write_sha256: None,
                temp_file_cleaned: cleaned,
                atomic_create_completed: false,
                failure_reason: Some("Atomic create failed."),
            };
        }
    }
    if let Ok(parent_dir) = std::fs::File::open(&prepared.parent_path) {
        let _ = parent_dir.sync_all();
    }
    let post_write_bytes = match std::fs::read(&prepared.target_path) {
        Ok(bytes) => bytes,
        Err(_) => {
            return AtomicCreateOutcome {
                post_write_sha256: None,
                temp_file_cleaned: true,
                atomic_create_completed: true,
                failure_reason: Some("Post-write verification read failed."),
            }
        }
    };
    AtomicCreateOutcome {
        post_write_sha256: Some(format!("sha256:{}", hex_sha256(&post_write_bytes))),
        temp_file_cleaned: true,
        atomic_create_completed: true,
        failure_reason: None,
    }
}

fn cleanup_atomic_replace_temp(path: &Path) -> bool {
    match std::fs::remove_file(path) {
        Ok(()) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Err(_) => false,
    }
}

fn prepare_atomic_replace_existing_file(
    target: &Path,
    replacement_bytes: &[u8],
) -> PreparedAtomicReplaceOutcome {
    let Some(parent) = target.parent() else {
        return PreparedAtomicReplaceOutcome {
            prepared: None,
            temp_file_cleaned: true,
            failure_reason: Some("Target parent directory is unavailable."),
        };
    };
    let file_name = target
        .file_name()
        .map(|name| name.to_string_lossy().replace('/', "_"))
        .unwrap_or_else(|| "target".to_string());
    let temp_path = parent.join(format!(
        ".{file_name}.brownie-apply-{}.tmp",
        uuid::Uuid::new_v4().simple()
    ));
    let mut temp_file = match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp_path)
    {
        Ok(file) => file,
        Err(_) => {
            return PreparedAtomicReplaceOutcome {
                prepared: None,
                temp_file_cleaned: true,
                failure_reason: Some("Temporary sibling file creation failed."),
            }
        }
    };
    if temp_file.write_all(replacement_bytes).is_err() {
        drop(temp_file);
        let cleaned = cleanup_atomic_replace_temp(&temp_path);
        return PreparedAtomicReplaceOutcome {
            prepared: None,
            temp_file_cleaned: cleaned,
            failure_reason: Some("Bounded write to temporary sibling file failed."),
        };
    }
    if temp_file.flush().is_err() || temp_file.sync_all().is_err() {
        drop(temp_file);
        let cleaned = cleanup_atomic_replace_temp(&temp_path);
        return PreparedAtomicReplaceOutcome {
            prepared: None,
            temp_file_cleaned: cleaned,
            failure_reason: Some("Temporary file flush or sync failed."),
        };
    }
    drop(temp_file);
    PreparedAtomicReplaceOutcome {
        prepared: Some(PreparedAtomicReplace {
            temp_path,
            parent_path: parent.to_path_buf(),
        }),
        temp_file_cleaned: false,
        failure_reason: None,
    }
}

fn commit_prepared_atomic_replace(
    prepared: PreparedAtomicReplace,
    target: &Path,
) -> AtomicReplaceOutcome {
    if std::fs::rename(&prepared.temp_path, target).is_err() {
        let cleaned = cleanup_atomic_replace_temp(&prepared.temp_path);
        return AtomicReplaceOutcome {
            post_write_sha256: None,
            temp_file_cleaned: cleaned,
            atomic_replacement_completed: false,
            failure_reason: Some("Atomic replacement failed."),
        };
    }
    if let Ok(parent_dir) = std::fs::File::open(&prepared.parent_path) {
        let _ = parent_dir.sync_all();
    }
    let post_write_bytes = match std::fs::read(target) {
        Ok(bytes) => bytes,
        Err(_) => {
            return AtomicReplaceOutcome {
                post_write_sha256: None,
                temp_file_cleaned: true,
                atomic_replacement_completed: true,
                failure_reason: Some("Post-write verification read failed."),
            }
        }
    };
    AtomicReplaceOutcome {
        post_write_sha256: Some(format!("sha256:{}", hex_sha256(&post_write_bytes))),
        temp_file_cleaned: true,
        atomic_replacement_completed: true,
        failure_reason: None,
    }
}

fn atomic_replace_existing_file(target: &Path, replacement_bytes: &[u8]) -> AtomicReplaceOutcome {
    let prepared_outcome = prepare_atomic_replace_existing_file(target, replacement_bytes);
    let Some(prepared) = prepared_outcome.prepared else {
        return AtomicReplaceOutcome {
            post_write_sha256: None,
            temp_file_cleaned: prepared_outcome.temp_file_cleaned,
            atomic_replacement_completed: false,
            failure_reason: prepared_outcome.failure_reason,
        };
    };
    commit_prepared_atomic_replace(prepared, target)
}

fn atomic_delete_existing_file(target: &Path) -> AtomicDeleteOutcome {
    let Some(parent) = target.parent() else {
        return AtomicDeleteOutcome {
            post_delete_target_exists: None,
            atomic_delete_completed: false,
            failure_reason: Some("Target parent directory is unavailable."),
        };
    };
    if std::fs::remove_file(target).is_err() {
        return AtomicDeleteOutcome {
            post_delete_target_exists: Some(true),
            atomic_delete_completed: false,
            failure_reason: Some("Bounded delete failed."),
        };
    }
    if let Ok(parent_dir) = std::fs::File::open(parent) {
        let _ = parent_dir.sync_all();
    }
    match std::fs::symlink_metadata(target) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => AtomicDeleteOutcome {
            post_delete_target_exists: Some(false),
            atomic_delete_completed: true,
            failure_reason: None,
        },
        Ok(_) => AtomicDeleteOutcome {
            post_delete_target_exists: Some(true),
            atomic_delete_completed: true,
            failure_reason: Some("Post-delete absence verification failed."),
        },
        Err(_) => AtomicDeleteOutcome {
            post_delete_target_exists: None,
            atomic_delete_completed: true,
            failure_reason: Some("Post-delete absence verification failed."),
        },
    }
}

fn append_preflight_snapshot_event(
    store: &BrownieStore,
    task: &TaskRecord,
    snapshot: &WorkspacePatchPreflightSnapshotSummary,
) -> Result<(), String> {
    store
        .tasks()
        .append_task_event_with_payload(
            task,
            LedgerEventKind::WorkspacePatchPreflightSnapshotCreated,
            Some(json!(snapshot)),
        )
        .map_err(|e| format!("invalid params: {e}"))
}

fn apply_create_file_proposal(
    store: &BrownieStore,
    task: &TaskRecord,
    params: &ProposalApplyParams,
    proposal: &WorkspacePatchProposalSummary,
    mut apply_result: WorkspacePatchApplyResultSummary,
    replacement_content: &str,
    content_bytes: &[u8],
) -> Result<
    (
        WorkspacePatchProposalSummary,
        WorkspacePatchApplyResultSummary,
    ),
    String,
> {
    if params.expected_target_absent != Some(true) {
        apply_result.checklist.push(apply_result_check(
            "expected_target_absent_confirmed",
            "Fail",
            Some("Create-file apply requires expected_target_absent=true."),
        ));
        apply_result.apply_reason =
            "Create-file apply requires explicit target absence confirmation.".to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "expected_target_absent_confirmed",
        "Pass",
        None,
    ));

    let Some(previous_snapshot) = proposal.latest_snapshot.as_ref() else {
        apply_result.checklist.push(apply_result_check(
            "latest_preflight_exists",
            "Fail",
            Some("Run proposal.preflight before applying."),
        ));
        apply_result.apply_reason = "Latest preflight snapshot is missing.".to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    };
    apply_result
        .checklist
        .push(apply_result_check("latest_preflight_exists", "Pass", None));

    let current_snapshot =
        match capture_preflight_snapshot(store, proposal, Some(previous_snapshot)) {
            Ok(snapshot) => snapshot,
            Err(reason) => {
                apply_result.checklist.push(apply_result_check(
                    "latest_preflight_validation",
                    "Fail",
                    Some(&reason),
                ));
                apply_result.apply_reason = "Latest preflight validation failed.".to_string();
                return record_apply_result(
                    store,
                    task,
                    &params.run_id,
                    &params.proposal_id,
                    apply_result,
                );
            }
        };
    append_preflight_snapshot_event(store, task, &current_snapshot)?;
    apply_result.pre_write_target_exists = Some(current_snapshot.file_exists);
    if current_snapshot.stale {
        apply_result.checklist.push(apply_result_check(
            "latest_preflight_validation",
            "Fail",
            current_snapshot
                .stale_reason
                .as_deref()
                .or(Some("Latest preflight snapshot is stale.")),
        ));
        apply_result.apply_reason = "Latest preflight validation found a stale target.".to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "latest_preflight_validation",
        "Pass",
        None,
    ));
    if current_snapshot.file_exists {
        apply_result.checklist.push(apply_result_check(
            "target_absent_current",
            "Fail",
            Some("Target path already exists."),
        ));
        apply_result.apply_reason = "Target path already exists.".to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result
        .checklist
        .push(apply_result_check("target_absent_current", "Pass", None));

    let target_path = match resolve_create_apply_target_path(store, proposal) {
        Ok(path) => path,
        Err(reason) => {
            let check_name = if reason.contains("parent directory does not exist") {
                "target_parent_exists"
            } else if reason.contains("parent path is not a directory") {
                "target_parent_directory"
            } else if reason.contains("parent directory is a symlink") {
                "target_parent_not_symlink"
            } else if reason.contains("already exists") {
                "target_absent_current"
            } else {
                "target_path_safe"
            };
            apply_result
                .checklist
                .push(apply_result_check(check_name, "Fail", Some(reason)));
            apply_result.apply_reason = reason.to_string();
            return record_apply_result(
                store,
                task,
                &params.run_id,
                &params.proposal_id,
                apply_result,
            );
        }
    };
    apply_result
        .checklist
        .push(apply_result_check("target_path_safe", "Pass", None));
    apply_result
        .checklist
        .push(apply_result_check("target_parent_exists", "Pass", None));
    apply_result
        .checklist
        .push(apply_result_check("target_parent_directory", "Pass", None));
    apply_result.checklist.push(apply_result_check(
        "target_parent_not_symlink",
        "Pass",
        None,
    ));

    let create_diff = synthetic_unified_diff(&proposal.path, "", replacement_content);
    if proposal.diff_preview.as_deref() != Some(create_diff.as_str()) {
        apply_result.checklist.push(apply_result_check(
            "approved_diff_matches_absent_target",
            "Fail",
            Some("Approved diff does not match absent target and proposed content."),
        ));
        apply_result.apply_reason =
            "Approved diff does not match absent target and proposed content.".to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "approved_diff_matches_absent_target",
        "Pass",
        None,
    ));

    let expected_post_write_hash = format!("sha256:{}", hex_sha256(content_bytes));
    let outcome = atomic_create_new_file(&target_path, content_bytes);
    apply_result.temp_file_cleaned = outcome.temp_file_cleaned;
    apply_result.atomic_create_completed = outcome.atomic_create_completed;
    apply_result.post_write_sha256 = outcome.post_write_sha256.clone();
    if let Some(reason) = outcome.failure_reason {
        apply_result.checklist.push(apply_result_check(
            "temporary_sibling_file_created",
            if reason == "Temporary sibling file creation failed." {
                "Fail"
            } else {
                "Pass"
            },
            if reason == "Temporary sibling file creation failed." {
                Some(reason)
            } else {
                None
            },
        ));
        apply_result.checklist.push(apply_result_check(
            "bounded_write_flushed_and_synced",
            if reason.contains("write") || reason.contains("flush") || reason.contains("sync") {
                "Fail"
            } else {
                "Pass"
            },
            if reason.contains("write") || reason.contains("flush") || reason.contains("sync") {
                Some(reason)
            } else {
                None
            },
        ));
        apply_result.checklist.push(apply_result_check(
            "atomic_create_completed",
            if outcome.atomic_create_completed {
                "Pass"
            } else {
                "Fail"
            },
            if outcome.atomic_create_completed {
                None
            } else {
                Some(reason)
            },
        ));
        apply_result.checklist.push(apply_result_check(
            "post_write_sha256_verified",
            "Fail",
            Some(reason),
        ));
        apply_result.apply_status = if reason == "Target path already exists." {
            "Denied".to_string()
        } else {
            "Failed".to_string()
        };
        apply_result.apply_reason = reason.to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "temporary_sibling_file_created",
        "Pass",
        None,
    ));
    apply_result.checklist.push(apply_result_check(
        "bounded_write_flushed_and_synced",
        "Pass",
        None,
    ));
    apply_result
        .checklist
        .push(apply_result_check("atomic_create_completed", "Pass", None));
    if apply_result.post_write_sha256.as_deref() != Some(expected_post_write_hash.as_str()) {
        apply_result.checklist.push(apply_result_check(
            "post_write_sha256_verified",
            "Fail",
            Some("Post-write SHA-256 did not match proposed content."),
        ));
        apply_result.apply_status = "Failed".to_string();
        apply_result.apply_reason =
            "Post-write SHA-256 did not match proposed content; created target was left in place."
                .to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "post_write_sha256_verified",
        "Pass",
        None,
    ));
    apply_result.apply_status = "Applied".to_string();
    apply_result.apply_reason = "File created and post-write SHA-256 verified.".to_string();
    apply_result.authorization_consumed = true;
    apply_result.applied = true;
    apply_result.applied_at = Some(now_rfc3339());
    record_apply_result(
        store,
        task,
        &params.run_id,
        &params.proposal_id,
        apply_result,
    )
}

fn apply_delete_file_proposal(
    store: &BrownieStore,
    task: &TaskRecord,
    params: &ProposalApplyParams,
    proposal: &WorkspacePatchProposalSummary,
    mut apply_result: WorkspacePatchApplyResultSummary,
) -> Result<
    (
        WorkspacePatchProposalSummary,
        WorkspacePatchApplyResultSummary,
    ),
    String,
> {
    if params.replacement_content.is_some() {
        apply_result.checklist.push(apply_result_check(
            "replacement_content_omitted_for_delete",
            "Fail",
            Some("Delete-file apply must omit replacement_content."),
        ));
        apply_result.apply_reason =
            "Delete-file apply must not include replacement content.".to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "replacement_content_omitted_for_delete",
        "Pass",
        None,
    ));

    if proposal.content_chars != 0 || !proposal.content_preview.is_empty() {
        apply_result.checklist.push(apply_result_check(
            "delete_proposal_has_no_replacement_content",
            "Fail",
            Some("Delete-file proposals must not carry replacement content metadata."),
        ));
        apply_result.apply_reason =
            "Delete-file proposal includes replacement content metadata.".to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "delete_proposal_has_no_replacement_content",
        "Pass",
        None,
    ));

    if proposal.diff_redacted || proposal.content_preview == "[redacted]" {
        apply_result.checklist.push(apply_result_check(
            "proposal_diff_available",
            "Blocked",
            Some("Proposal diff or content preview is redacted."),
        ));
        apply_result.apply_reason = "Proposal diff or content preview is redacted.".to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    if proposal.diff_truncated || proposal.diff_preview.is_none() {
        apply_result.checklist.push(apply_result_check(
            "proposal_diff_available",
            "Fail",
            Some("Proposal diff must be available and untruncated for apply verification."),
        ));
        apply_result.apply_reason = "Proposal diff is unavailable or truncated.".to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result
        .checklist
        .push(apply_result_check("proposal_diff_available", "Pass", None));

    let Some(expected_target_sha256) = params.expected_target_sha256.as_deref() else {
        apply_result.checklist.push(apply_result_check(
            "expected_target_hash_valid",
            "Fail",
            Some("Expected target hash must be provided for delete_file apply."),
        ));
        apply_result.apply_reason =
            "Expected target hash must be provided for delete_file apply.".to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    };

    if !is_sha256_fingerprint(expected_target_sha256) {
        apply_result.checklist.push(apply_result_check(
            "expected_target_hash_valid",
            "Fail",
            Some("Expected target hash must be a sha256 fingerprint."),
        ));
        apply_result.apply_reason =
            "Expected target hash must be a sha256 fingerprint.".to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "expected_target_hash_valid",
        "Pass",
        None,
    ));

    let Some(previous_snapshot) = proposal.latest_snapshot.as_ref() else {
        apply_result.checklist.push(apply_result_check(
            "latest_preflight_exists",
            "Fail",
            Some("Run proposal.preflight before applying."),
        ));
        apply_result.apply_reason = "Latest preflight snapshot is missing.".to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    };
    apply_result
        .checklist
        .push(apply_result_check("latest_preflight_exists", "Pass", None));

    let current_snapshot =
        match capture_preflight_snapshot(store, proposal, Some(previous_snapshot)) {
            Ok(snapshot) => snapshot,
            Err(reason) => {
                apply_result.checklist.push(apply_result_check(
                    "latest_preflight_validation",
                    "Fail",
                    Some(&reason),
                ));
                apply_result.apply_reason = "Latest preflight validation failed.".to_string();
                return record_apply_result(
                    store,
                    task,
                    &params.run_id,
                    &params.proposal_id,
                    apply_result,
                );
            }
        };
    append_preflight_snapshot_event(store, task, &current_snapshot)?;
    apply_result.pre_write_target_exists = Some(current_snapshot.file_exists);
    if current_snapshot.stale {
        apply_result.checklist.push(apply_result_check(
            "latest_preflight_validation",
            "Fail",
            current_snapshot
                .stale_reason
                .as_deref()
                .or(Some("Latest preflight snapshot is stale.")),
        ));
        apply_result.apply_reason = "Latest preflight validation found a stale target.".to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "latest_preflight_validation",
        "Pass",
        None,
    ));
    if !current_snapshot.file_exists {
        apply_result.checklist.push(apply_result_check(
            "target_file_exists",
            "Fail",
            Some("Target file does not exist."),
        ));
        apply_result.apply_reason = "Target file does not exist.".to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    if current_snapshot.file_kind == "Symlink" {
        apply_result.checklist.push(apply_result_check(
            "target_file_not_symlink",
            "Fail",
            Some("Target path is a symlink."),
        ));
        apply_result.apply_reason = "Target path is a symlink.".to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    if current_snapshot.file_kind != "File" {
        apply_result.checklist.push(apply_result_check(
            "target_file_regular",
            "Fail",
            Some("Target path is not a regular file."),
        ));
        apply_result.apply_reason = "Target path is not a regular file.".to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }

    let target_path = match resolve_apply_target_path(store, proposal) {
        Ok(path) => path,
        Err(reason) => {
            let check_name = if reason.contains("symlink") {
                "target_file_not_symlink"
            } else if reason.contains("regular") {
                "target_file_regular"
            } else if reason.contains("exist") {
                "target_file_exists"
            } else {
                "target_path_safe"
            };
            apply_result
                .checklist
                .push(apply_result_check(check_name, "Fail", Some(reason)));
            apply_result.apply_reason = reason.to_string();
            return record_apply_result(
                store,
                task,
                &params.run_id,
                &params.proposal_id,
                apply_result,
            );
        }
    };
    apply_result
        .checklist
        .push(apply_result_check("target_path_safe", "Pass", None));
    apply_result
        .checklist
        .push(apply_result_check("target_file_exists", "Pass", None));
    apply_result
        .checklist
        .push(apply_result_check("target_file_regular", "Pass", None));
    apply_result
        .checklist
        .push(apply_result_check("target_file_not_symlink", "Pass", None));

    let current_bytes = match std::fs::read(&target_path) {
        Ok(bytes) => bytes,
        Err(_) => {
            apply_result.checklist.push(apply_result_check(
                "target_file_readable",
                "Fail",
                Some("Target file could not be read before apply."),
            ));
            apply_result.apply_reason = "Target file could not be read before apply.".to_string();
            return record_apply_result(
                store,
                task,
                &params.run_id,
                &params.proposal_id,
                apply_result,
            );
        }
    };
    let pre_write_hash = format!("sha256:{}", hex_sha256(&current_bytes));
    apply_result.pre_write_target_sha256 = Some(pre_write_hash.clone());
    apply_result.pre_write_target_exists = Some(true);
    apply_result
        .checklist
        .push(apply_result_check("target_file_readable", "Pass", None));

    if current_snapshot.file_sha256.as_deref() != Some(pre_write_hash.as_str())
        || expected_target_sha256 != pre_write_hash
    {
        apply_result.checklist.push(apply_result_check(
            "expected_target_hash_matches",
            "Fail",
            Some("Expected target hash does not match current target file."),
        ));
        apply_result.apply_reason =
            "Expected target hash does not match current target file.".to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "expected_target_hash_matches",
        "Pass",
        None,
    ));

    let current_content = match std::str::from_utf8(&current_bytes) {
        Ok(content) => content,
        Err(_) => {
            apply_result.checklist.push(apply_result_check(
                "target_file_utf8",
                "Fail",
                Some("Target file is not UTF-8."),
            ));
            apply_result.apply_reason = "Target file is not UTF-8.".to_string();
            return record_apply_result(
                store,
                task,
                &params.run_id,
                &params.proposal_id,
                apply_result,
            );
        }
    };
    if scan_text_for_sensitive_content(current_content) {
        apply_result.checklist.push(apply_result_check(
            "target_file_sensitive_scan",
            "Blocked",
            Some("Target file contains sensitive-like data."),
        ));
        apply_result.apply_reason = "Target file contains sensitive-like data.".to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result
        .checklist
        .push(apply_result_check("target_file_utf8", "Pass", None));
    apply_result.checklist.push(apply_result_check(
        "target_file_sensitive_scan",
        "Pass",
        None,
    ));

    let current_diff = synthetic_unified_diff(&proposal.path, current_content, "");
    if proposal.diff_preview.as_deref() != Some(current_diff.as_str()) {
        apply_result.checklist.push(apply_result_check(
            "approved_diff_matches_current_target",
            "Fail",
            Some("Approved diff does not match the current target deletion."),
        ));
        apply_result.apply_reason =
            "Approved diff does not match the current target deletion.".to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "approved_diff_matches_current_target",
        "Pass",
        None,
    ));

    let outcome = atomic_delete_existing_file(&target_path);
    apply_result.atomic_delete_completed = outcome.atomic_delete_completed;
    apply_result.post_delete_target_exists = outcome.post_delete_target_exists;
    if let Some(reason) = outcome.failure_reason {
        apply_result.checklist.push(apply_result_check(
            "bounded_delete",
            if reason == "Bounded delete failed." {
                "Fail"
            } else {
                "Pass"
            },
            if reason == "Bounded delete failed." {
                Some(reason)
            } else {
                None
            },
        ));
        apply_result.checklist.push(apply_result_check(
            "atomic_delete_completed",
            if outcome.atomic_delete_completed {
                "Pass"
            } else {
                "Fail"
            },
            if outcome.atomic_delete_completed {
                None
            } else {
                Some(reason)
            },
        ));
        apply_result.checklist.push(apply_result_check(
            "post_delete_absence_verified",
            "Fail",
            Some(reason),
        ));
        apply_result.apply_status = "Failed".to_string();
        apply_result.apply_reason = reason.to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result
        .checklist
        .push(apply_result_check("bounded_delete", "Pass", None));
    apply_result
        .checklist
        .push(apply_result_check("atomic_delete_completed", "Pass", None));
    apply_result.checklist.push(apply_result_check(
        "post_delete_absence_verified",
        "Pass",
        None,
    ));
    apply_result.apply_status = "Applied".to_string();
    apply_result.apply_reason = "File deleted and post-delete absence verified.".to_string();
    apply_result.authorization_consumed = true;
    apply_result.applied = true;
    apply_result.applied_at = Some(now_rfc3339());
    record_apply_result(
        store,
        task,
        &params.run_id,
        &params.proposal_id,
        apply_result,
    )
}

fn deny_patch_file_apply(
    store: &BrownieStore,
    task: &TaskRecord,
    params: &ProposalApplyParams,
    mut apply_result: WorkspacePatchApplyResultSummary,
    check_name: &str,
    status: &str,
    reason: &str,
) -> Result<
    (
        WorkspacePatchProposalSummary,
        WorkspacePatchApplyResultSummary,
    ),
    String,
> {
    apply_result
        .checklist
        .push(apply_result_check(check_name, status, Some(reason)));
    apply_result.apply_reason = reason.to_string();
    record_apply_result(
        store,
        task,
        &params.run_id,
        &params.proposal_id,
        apply_result,
    )
}

fn apply_patch_file_proposal(
    store: &BrownieStore,
    task: &TaskRecord,
    params: &ProposalApplyParams,
    proposal: &WorkspacePatchProposalSummary,
    mut apply_result: WorkspacePatchApplyResultSummary,
) -> Result<
    (
        WorkspacePatchProposalSummary,
        WorkspacePatchApplyResultSummary,
    ),
    String,
> {
    if params.replacement_content.is_some() {
        return deny_patch_file_apply(
            store,
            task,
            params,
            apply_result,
            "replacement_content_omitted_for_patch",
            "Fail",
            "Patch-file apply must omit replacement_content.",
        );
    }
    let hunks = match patch_hunks_from_apply_params(params) {
        Ok(hunks) => hunks,
        Err(reason) => {
            return deny_patch_file_apply(
                store,
                task,
                params,
                apply_result,
                "patch_hunk_required",
                "Fail",
                reason,
            )
        }
    };
    if hunks.iter().any(|hunk| hunk.old_text.is_empty()) {
        return deny_patch_file_apply(
            store,
            task,
            params,
            apply_result,
            "patch_hunk_required",
            "Fail",
            "Patch-file old text must not be empty.",
        );
    }
    apply_result
        .checklist
        .push(apply_result_check("patch_hunk_required", "Pass", None));

    let hunk_chars: usize = hunks
        .iter()
        .map(|hunk| hunk.old_text.chars().count() + hunk.new_text.chars().count())
        .sum();
    apply_result.content_chars = hunk_chars;
    apply_result.content_bytes = hunks
        .iter()
        .map(|hunk| hunk.old_text.as_bytes().len() as u64 + hunk.new_text.as_bytes().len() as u64)
        .sum();
    if hunk_chars > DEFAULT_MAX_WORKSPACE_WRITE_CONTENT_CHARS {
        return deny_patch_file_apply(
            store,
            task,
            params,
            apply_result,
            "patch_hunk_bounded",
            "Fail",
            "Patch hunk exceeds the runtime write limit.",
        );
    }
    apply_result
        .checklist
        .push(apply_result_check("patch_hunk_bounded", "Pass", None));
    if hunks.iter().any(|hunk| {
        scan_text_for_sensitive_content(&hunk.old_text)
            || scan_text_for_sensitive_content(&hunk.new_text)
    }) {
        return deny_patch_file_apply(
            store,
            task,
            params,
            apply_result,
            "patch_hunk_sensitive_scan",
            "Blocked",
            "Patch hunk contains sensitive-like data.",
        );
    }
    apply_result.checklist.push(apply_result_check(
        "patch_hunk_sensitive_scan",
        "Pass",
        None,
    ));

    let hunk_fingerprint = patch_hunks_fingerprint(&hunks);
    if proposal.hunk_count != Some(hunks.len())
        || proposal.hunk_fingerprint.as_deref() != Some(hunk_fingerprint.as_str())
    {
        return deny_patch_file_apply(
            store,
            task,
            params,
            apply_result,
            "patch_hunk_matches_proposal",
            "Fail",
            "Patch hunk does not match approved proposal metadata.",
        );
    }
    apply_result.checklist.push(apply_result_check(
        "patch_hunk_matches_proposal",
        "Pass",
        None,
    ));

    if proposal.diff_redacted || proposal.content_preview == "[redacted]" {
        return deny_patch_file_apply(
            store,
            task,
            params,
            apply_result,
            "proposal_diff_available",
            "Blocked",
            "Proposal diff or content preview is redacted.",
        );
    }
    if proposal.diff_truncated || proposal.diff_preview.is_none() {
        return deny_patch_file_apply(
            store,
            task,
            params,
            apply_result,
            "proposal_diff_available",
            "Fail",
            "Proposal diff must be available and untruncated for apply verification.",
        );
    }
    apply_result
        .checklist
        .push(apply_result_check("proposal_diff_available", "Pass", None));

    let expected_preview = if hunks.len() == 1 {
        format!(
            "[patch_file single_hunk old_chars={} new_chars={}]",
            hunks[0].old_text.chars().count(),
            hunks[0].new_text.chars().count()
        )
    } else {
        format!(
            "[patch_file multi_hunk count={} total_chars={}]",
            hunks.len(),
            hunk_chars
        )
    };
    let expected_diff = if hunks.len() == 1 {
        format!(
            "--- a/{}\n+++ b/{}\n@@ patch_file single_hunk old_chars={} new_chars={} @@\n[patch hunk elided]\n",
            proposal.path,
            proposal.path,
            hunks[0].old_text.chars().count(),
            hunks[0].new_text.chars().count()
        )
    } else {
        format!(
            "--- a/{}\n+++ b/{}\n@@ patch_file multi_hunk count={} total_chars={} @@\n[patch hunks elided]\n",
            proposal.path,
            proposal.path,
            hunks.len(),
            hunk_chars
        )
    };
    if proposal.content_preview != expected_preview
        || proposal.diff_preview.as_deref() != Some(expected_diff.as_str())
    {
        return deny_patch_file_apply(
            store,
            task,
            params,
            apply_result,
            "approved_patch_metadata_matches",
            "Fail",
            "Approved patch metadata does not match the requested hunk.",
        );
    }
    apply_result.checklist.push(apply_result_check(
        "approved_patch_metadata_matches",
        "Pass",
        None,
    ));

    let Some(expected_target_sha256) = params.expected_target_sha256.as_deref() else {
        return deny_patch_file_apply(
            store,
            task,
            params,
            apply_result,
            "expected_target_hash_valid",
            "Fail",
            "Expected target hash must be provided for patch_file apply.",
        );
    };
    if !is_sha256_fingerprint(expected_target_sha256) {
        return deny_patch_file_apply(
            store,
            task,
            params,
            apply_result,
            "expected_target_hash_valid",
            "Fail",
            "Expected target hash must be a sha256 fingerprint.",
        );
    }
    apply_result.checklist.push(apply_result_check(
        "expected_target_hash_valid",
        "Pass",
        None,
    ));

    let Some(previous_snapshot) = proposal.latest_snapshot.as_ref() else {
        return deny_patch_file_apply(
            store,
            task,
            params,
            apply_result,
            "latest_preflight_exists",
            "Fail",
            "Run proposal.preflight before applying.",
        );
    };
    apply_result
        .checklist
        .push(apply_result_check("latest_preflight_exists", "Pass", None));
    let current_snapshot =
        match capture_preflight_snapshot(store, proposal, Some(previous_snapshot)) {
            Ok(snapshot) => snapshot,
            Err(_) => {
                return deny_patch_file_apply(
                    store,
                    task,
                    params,
                    apply_result,
                    "latest_preflight_validation",
                    "Fail",
                    "Latest preflight validation failed.",
                )
            }
        };
    append_preflight_snapshot_event(store, task, &current_snapshot)?;
    if current_snapshot.stale {
        return deny_patch_file_apply(
            store,
            task,
            params,
            apply_result,
            "latest_preflight_validation",
            "Fail",
            current_snapshot
                .stale_reason
                .as_deref()
                .unwrap_or("Latest preflight snapshot is stale."),
        );
    }
    apply_result.checklist.push(apply_result_check(
        "latest_preflight_validation",
        "Pass",
        None,
    ));

    let target_path = match resolve_apply_target_path(store, proposal) {
        Ok(path) => path,
        Err(reason) => {
            return deny_patch_file_apply(
                store,
                task,
                params,
                apply_result,
                "target_path_safe",
                "Fail",
                reason,
            )
        }
    };
    apply_result
        .checklist
        .push(apply_result_check("target_path_safe", "Pass", None));
    apply_result
        .checklist
        .push(apply_result_check("target_file_exists", "Pass", None));
    apply_result
        .checklist
        .push(apply_result_check("target_file_regular", "Pass", None));
    apply_result
        .checklist
        .push(apply_result_check("target_file_not_symlink", "Pass", None));

    let current_bytes = match std::fs::read(&target_path) {
        Ok(bytes) => bytes,
        Err(_) => {
            return deny_patch_file_apply(
                store,
                task,
                params,
                apply_result,
                "target_file_readable",
                "Fail",
                "Target file could not be read before apply.",
            )
        }
    };
    let pre_write_hash = format!("sha256:{}", hex_sha256(&current_bytes));
    apply_result.pre_write_target_sha256 = Some(pre_write_hash.clone());
    apply_result.pre_write_target_exists = Some(true);
    apply_result
        .checklist
        .push(apply_result_check("target_file_readable", "Pass", None));
    if current_snapshot.file_sha256.as_deref() != Some(pre_write_hash.as_str())
        || expected_target_sha256 != pre_write_hash
    {
        return deny_patch_file_apply(
            store,
            task,
            params,
            apply_result,
            "expected_target_hash_matches",
            "Fail",
            "Expected target hash does not match current target file.",
        );
    }
    apply_result.checklist.push(apply_result_check(
        "expected_target_hash_matches",
        "Pass",
        None,
    ));

    let current_content = match std::str::from_utf8(&current_bytes) {
        Ok(content) => content,
        Err(_) => {
            return deny_patch_file_apply(
                store,
                task,
                params,
                apply_result,
                "target_file_utf8",
                "Fail",
                "Target file is not UTF-8.",
            )
        }
    };
    if scan_text_for_sensitive_content(current_content) {
        return deny_patch_file_apply(
            store,
            task,
            params,
            apply_result,
            "target_file_sensitive_scan",
            "Blocked",
            "Target file contains sensitive-like data.",
        );
    }
    apply_result
        .checklist
        .push(apply_result_check("target_file_utf8", "Pass", None));
    apply_result.checklist.push(apply_result_check(
        "target_file_sensitive_scan",
        "Pass",
        None,
    ));

    let replacement_content = match apply_text_hunks(current_content, &hunks) {
        Ok(content) => content,
        Err(reason) => {
            return deny_patch_file_apply(
                store,
                task,
                params,
                apply_result,
                "patch_hunk_context_matches",
                "Fail",
                reason,
            )
        }
    };
    apply_result.checklist.push(apply_result_check(
        "patch_hunk_context_matches",
        "Pass",
        None,
    ));

    let replacement_bytes = replacement_content.as_bytes();
    let expected_post_write_hash = format!("sha256:{}", hex_sha256(replacement_bytes));
    let outcome = atomic_replace_existing_file(&target_path, replacement_bytes);
    apply_result.temp_file_cleaned = outcome.temp_file_cleaned;
    apply_result.atomic_replacement_completed = outcome.atomic_replacement_completed;
    apply_result.post_write_sha256 = outcome.post_write_sha256.clone();
    if let Some(reason) = outcome.failure_reason {
        apply_result.checklist.push(apply_result_check(
            "temporary_sibling_file_created",
            if reason == "Temporary sibling file creation failed." {
                "Fail"
            } else {
                "Pass"
            },
            if reason == "Temporary sibling file creation failed." {
                Some(reason)
            } else {
                None
            },
        ));
        apply_result.checklist.push(apply_result_check(
            "bounded_write_flushed_and_synced",
            if reason.contains("write") || reason.contains("flush") || reason.contains("sync") {
                "Fail"
            } else {
                "Pass"
            },
            if reason.contains("write") || reason.contains("flush") || reason.contains("sync") {
                Some(reason)
            } else {
                None
            },
        ));
        apply_result.checklist.push(apply_result_check(
            "atomic_replacement_completed",
            if outcome.atomic_replacement_completed {
                "Pass"
            } else {
                "Fail"
            },
            if outcome.atomic_replacement_completed {
                None
            } else {
                Some(reason)
            },
        ));
        apply_result.checklist.push(apply_result_check(
            "post_write_sha256_verified",
            "Fail",
            Some(reason),
        ));
        apply_result.apply_status = "Failed".to_string();
        apply_result.apply_reason = reason.to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "temporary_sibling_file_created",
        "Pass",
        None,
    ));
    apply_result.checklist.push(apply_result_check(
        "bounded_write_flushed_and_synced",
        "Pass",
        None,
    ));
    apply_result.checklist.push(apply_result_check(
        "atomic_replacement_completed",
        "Pass",
        None,
    ));
    if apply_result.post_write_sha256.as_deref() != Some(expected_post_write_hash.as_str()) {
        apply_result.checklist.push(apply_result_check(
            "post_write_sha256_verified",
            "Fail",
            Some("Post-write SHA-256 does not match patch result."),
        ));
        apply_result.apply_status = "Failed".to_string();
        apply_result.apply_reason = "Post-write SHA-256 does not match patch result.".to_string();
        return record_apply_result(
            store,
            task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "post_write_sha256_verified",
        "Pass",
        None,
    ));
    apply_result.apply_status = "Applied".to_string();
    apply_result.apply_reason =
        "Patch-file hunks applied and post-write SHA-256 verified.".to_string();
    apply_result.authorization_consumed = true;
    apply_result.applied = true;
    apply_result.applied_at = Some(now_rfc3339());
    record_apply_result(
        store,
        task,
        &params.run_id,
        &params.proposal_id,
        apply_result,
    )
}

struct PreparedReplaceTransactionItem {
    proposal_id: String,
    operation: String,
    path: String,
    target_path: PathBuf,
    expected_target_sha256: String,
    pre_write_target_sha256: String,
    replacement_bytes: Vec<u8>,
    content_chars: usize,
    content_bytes: u64,
}

struct PreparedCreateTransactionItem {
    proposal_id: String,
    operation: String,
    path: String,
    target_path: PathBuf,
    replacement_bytes: Vec<u8>,
    content_chars: usize,
    content_bytes: u64,
}

struct PreparedDeleteTransactionItem {
    proposal_id: String,
    operation: String,
    path: String,
    target_path: PathBuf,
    expected_target_sha256: String,
    pre_write_target_sha256: String,
}

fn transaction_item_result(
    item: &PreparedReplaceTransactionItem,
    apply_status: &str,
    apply_reason: &str,
    post_write_sha256: Option<String>,
    atomic_replacement_completed: bool,
    applied: bool,
    temp_file_cleaned: bool,
) -> WorkspacePatchApplyTransactionItemResultSummary {
    WorkspacePatchApplyTransactionItemResultSummary {
        proposal_id: item.proposal_id.clone(),
        apply_status: apply_status.to_string(),
        apply_reason: apply_reason.to_string(),
        operation: item.operation.clone(),
        path: item.path.clone(),
        expected_target_sha256: Some(item.expected_target_sha256.clone()),
        expected_target_absent: None,
        pre_write_target_sha256: Some(item.pre_write_target_sha256.clone()),
        pre_write_target_exists: Some(true),
        post_write_sha256,
        post_delete_target_exists: None,
        content_chars: item.content_chars,
        content_bytes: item.content_bytes,
        atomic_replacement_completed,
        atomic_create_completed: false,
        atomic_delete_completed: None,
        applied,
        temp_file_cleaned,
    }
}

fn create_transaction_item_result(
    item: &PreparedCreateTransactionItem,
    apply_status: &str,
    apply_reason: &str,
    post_write_sha256: Option<String>,
    atomic_create_completed: bool,
    applied: bool,
    temp_file_cleaned: bool,
) -> WorkspacePatchApplyTransactionItemResultSummary {
    WorkspacePatchApplyTransactionItemResultSummary {
        proposal_id: item.proposal_id.clone(),
        apply_status: apply_status.to_string(),
        apply_reason: apply_reason.to_string(),
        operation: item.operation.clone(),
        path: item.path.clone(),
        expected_target_sha256: None,
        expected_target_absent: Some(true),
        pre_write_target_sha256: None,
        pre_write_target_exists: Some(false),
        post_write_sha256,
        post_delete_target_exists: None,
        content_chars: item.content_chars,
        content_bytes: item.content_bytes,
        atomic_replacement_completed: false,
        atomic_create_completed,
        atomic_delete_completed: None,
        applied,
        temp_file_cleaned,
    }
}

fn delete_transaction_item_result(
    item: &PreparedDeleteTransactionItem,
    apply_status: &str,
    apply_reason: &str,
    post_delete_target_exists: Option<bool>,
    atomic_delete_completed: bool,
    applied: bool,
    temp_file_cleaned: bool,
) -> WorkspacePatchApplyTransactionItemResultSummary {
    WorkspacePatchApplyTransactionItemResultSummary {
        proposal_id: item.proposal_id.clone(),
        apply_status: apply_status.to_string(),
        apply_reason: apply_reason.to_string(),
        operation: item.operation.clone(),
        path: item.path.clone(),
        expected_target_sha256: Some(item.expected_target_sha256.clone()),
        expected_target_absent: None,
        pre_write_target_sha256: Some(item.pre_write_target_sha256.clone()),
        pre_write_target_exists: Some(true),
        post_write_sha256: None,
        post_delete_target_exists,
        content_chars: 0,
        content_bytes: 0,
        atomic_replacement_completed: false,
        atomic_create_completed: false,
        atomic_delete_completed: Some(atomic_delete_completed),
        applied,
        temp_file_cleaned,
    }
}

fn fallback_transaction_proposal_id(params: &ProposalApplyParams) -> String {
    if !params.proposal_id.trim().is_empty() {
        return params.proposal_id.trim().to_string();
    }
    params
        .transaction_items
        .as_ref()
        .and_then(|items| items.first())
        .map(|item| item.proposal_id.clone())
        .unwrap_or_else(|| "transaction".to_string())
}

pub(super) fn transaction_source_fingerprint(payload: &Value) -> Option<String> {
    let compact = json!({
        "apply_id": payload.get("apply_id")?.as_str()?,
        "transaction_id": payload.get("transaction_id")?.as_str()?,
        "transaction_status": payload.get("transaction_status")?.as_str()?,
        "transaction_items": payload.get("transaction_items")?,
    });
    let bytes = serde_json::to_vec(&compact).ok()?;
    Some(format!("sha256:{}", hex_sha256(&bytes)))
}

fn latest_transaction_apply_payload(
    events: &[LedgerEvent],
    source_apply_id: &str,
    source_transaction_id: &str,
) -> Option<Value> {
    events.iter().rev().find_map(|event| {
        if event.kind != LedgerEventKind::WorkspacePatchApplyResultRecorded {
            return None;
        }
        let payload = sanitize_ledger_payload(event.payload.clone())?;
        if payload.get("apply_id").and_then(Value::as_str) != Some(source_apply_id) {
            return None;
        }
        if payload.get("transaction_id").and_then(Value::as_str) != Some(source_transaction_id) {
            return None;
        }
        Some(payload)
    })
}

fn has_recovered_transaction(
    events: &[LedgerEvent],
    source_apply_id: &str,
    source_transaction_id: &str,
) -> bool {
    events.iter().any(|event| {
        if event.kind != LedgerEventKind::WorkspacePatchApplyResultRecorded {
            return false;
        }
        let Some(payload) = sanitize_ledger_payload(event.payload.clone()) else {
            return false;
        };
        let recovered = payload
            .get("transaction_recovery_status")
            .and_then(Value::as_str)
            == Some("Applied");
        if !recovered {
            return false;
        }
        let Some(source) = payload.get("transaction_recovery_source") else {
            return false;
        };
        source.get("source_apply_id").and_then(Value::as_str) == Some(source_apply_id)
            && source.get("source_transaction_id").and_then(Value::as_str)
                == Some(source_transaction_id)
    })
}

fn transaction_proposal_operations(
    store: &BrownieStore,
    params: &ProposalApplyParams,
) -> Result<BTreeSet<String>, String> {
    let mut operations = BTreeSet::new();
    if let Some(items) = params.transaction_items.as_ref() {
        for item in items {
            let proposal = inspect_proposal(store, &params.run_id, &item.proposal_id)?;
            operations.insert(proposal.operation);
        }
    }
    Ok(operations)
}

fn current_sha256_for_workspace_path(
    store: &BrownieStore,
    path: &str,
) -> Result<String, &'static str> {
    brownie_tools::preflight_workspace_write_path(path).map_err(|_| "Source path is not safe.")?;
    let root = store
        .workspace_root()
        .canonicalize()
        .map_err(|_| "Workspace root is not accessible.")?;
    let target = root.join(path);
    let metadata =
        std::fs::symlink_metadata(&target).map_err(|_| "Source target file is not accessible.")?;
    if metadata.file_type().is_symlink() {
        return Err("Source target file is a symlink.");
    }
    if !metadata.is_file() {
        return Err("Source target path is not a file.");
    }
    let canonical_target = target
        .canonicalize()
        .map_err(|_| "Source target file is not accessible.")?;
    if !canonical_target.starts_with(&root) {
        return Err("Source target escapes workspace root.");
    }
    let bytes =
        std::fs::read(&canonical_target).map_err(|_| "Source target file is not readable.")?;
    Ok(format!("sha256:{}", hex_sha256(&bytes)))
}

fn workspace_path_currently_absent(store: &BrownieStore, path: &str) -> Result<(), &'static str> {
    brownie_tools::preflight_workspace_write_path(path).map_err(|_| "Source path is not safe.")?;
    let relative_path = Path::new(path);
    if relative_path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err("Source path is not safe.");
    }
    let root = store
        .workspace_root()
        .canonicalize()
        .map_err(|_| "Workspace root is not accessible.")?;
    let parent_relative = relative_path.parent().unwrap_or_else(|| Path::new(""));
    let parent = root.join(parent_relative);
    let parent_metadata = std::fs::symlink_metadata(&parent)
        .map_err(|_| "Source parent directory does not exist.")?;
    if parent_metadata.file_type().is_symlink() {
        return Err("Source parent directory is a symlink.");
    }
    if !parent_metadata.is_dir() {
        return Err("Source parent path is not a directory.");
    }
    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| "Source parent directory is not accessible.")?;
    if !canonical_parent.starts_with(&root) {
        return Err("Source parent escapes workspace root.");
    }
    let target = root.join(relative_path);
    match std::fs::symlink_metadata(&target) {
        Ok(_) => Err("Source target exists."),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("Source target is not accessible."),
    }
}

fn apply_replace_file_transaction_recovery(
    store: &BrownieStore,
    params: &ProposalApplyParams,
) -> Result<
    (
        WorkspacePatchProposalSummary,
        WorkspacePatchApplyResultSummary,
    ),
    String,
> {
    let task = store
        .tasks()
        .get_task_by_run_id(&params.run_id)
        .map_err(|e| format!("invalid params: {e}"))?
        .ok_or_else(|| "invalid params: run not found".to_string())?;
    let items = params
        .transaction_items
        .as_ref()
        .ok_or_else(|| "invalid params: transaction_items are required".to_string())?;
    let source = params
        .transaction_recovery_source
        .as_ref()
        .ok_or_else(|| "invalid params: transaction_recovery_source is required".to_string())?;
    let proposal_id_for_result = fallback_transaction_proposal_id(params);
    let first_proposal = inspect_proposal(store, &params.run_id, &proposal_id_for_result)?;
    let mut apply_result = WorkspacePatchApplyResultSummary {
        proposal_id: proposal_id_for_result.clone(),
        apply_id: format!("apply_{}", uuid::Uuid::new_v4().simple()),
        apply_status: "Denied".to_string(),
        apply_reason: "Transaction recovery preconditions were not satisfied.".to_string(),
        authorization_id: format!("apply_tx_recovery_auth_{}", uuid::Uuid::new_v4().simple()),
        authorization_consumed: false,
        applied: false,
        operation: "replace_file_transaction_recovery".to_string(),
        atomic_replacement_completed: false,
        atomic_create_completed: false,
        atomic_delete_completed: false,
        path: "[transaction_recovery]".to_string(),
        expected_target_sha256: None,
        expected_target_absent: None,
        pre_write_target_sha256: None,
        pre_write_target_exists: None,
        post_write_sha256: None,
        post_delete_target_exists: None,
        content_chars: 0,
        content_bytes: 0,
        checked_at: now_rfc3339(),
        applied_at: None,
        temp_file_cleaned: true,
        check_count: 0,
        failed_checks: Vec::new(),
        blocked_checks: Vec::new(),
        checklist: vec![apply_result_check(
            "transaction_recovery_request_present",
            "Pass",
            None,
        )],
        transaction_id: Some(format!(
            "apply_tx_recovery_{}",
            uuid::Uuid::new_v4().simple()
        )),
        transaction_status: Some("Denied".to_string()),
        transaction_items: Vec::new(),
        transaction_recovery_source: None,
        transaction_recovery_status: Some("Denied".to_string()),
    };

    let deny = |mut result: WorkspacePatchApplyResultSummary,
                check_name: &str,
                reason: &str|
     -> Result<
        (
            WorkspacePatchProposalSummary,
            WorkspacePatchApplyResultSummary,
        ),
        String,
    > {
        result
            .checklist
            .push(apply_result_check(check_name, "Fail", Some(reason)));
        result.apply_reason = reason.to_string();
        result.transaction_status = Some("Denied".to_string());
        result.transaction_recovery_status = Some("Denied".to_string());
        record_apply_result(
            store,
            &task,
            &params.run_id,
            &proposal_id_for_result,
            result,
        )
    };

    if !params.authorize {
        return deny(
            apply_result,
            "one_time_transaction_recovery_authorization",
            "Transaction recovery request must explicitly set authorize=true.",
        );
    }
    apply_result.checklist.push(apply_result_check(
        "one_time_transaction_recovery_authorization",
        "Pass",
        None,
    ));
    if !append_apply_write_permission_check(store, &task, &mut apply_result)? {
        apply_result.transaction_status = Some("Denied".to_string());
        apply_result.transaction_recovery_status = Some("Denied".to_string());
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &proposal_id_for_result,
            apply_result,
        );
    }
    if source.source_run_id != params.run_id {
        return deny(
            apply_result,
            "transaction_recovery_source_same_run",
            "Transaction recovery source must refer to the current run.",
        );
    }
    if !(1..=5).contains(&items.len()) {
        return deny(
            apply_result,
            "transaction_recovery_item_count_bounded",
            "Transaction recovery requires between one and five recovery items.",
        );
    }

    let events = read_existing_run_events(store, &params.run_id)?;
    let Some(source_payload) = latest_transaction_apply_payload(
        &events,
        &source.source_apply_id,
        &source.source_transaction_id,
    ) else {
        return deny(
            apply_result,
            "transaction_recovery_source_latest",
            "Transaction recovery source evidence was not found.",
        );
    };
    let Some(source_fingerprint) = transaction_source_fingerprint(&source_payload) else {
        return deny(
            apply_result,
            "transaction_recovery_source_fingerprint",
            "Transaction recovery source evidence is malformed.",
        );
    };
    if source.expected_source_transaction_fingerprint != source_fingerprint {
        return deny(
            apply_result,
            "transaction_recovery_source_fingerprint",
            "Transaction recovery source fingerprint does not match latest evidence.",
        );
    }
    if has_recovered_transaction(
        &events,
        &source.source_apply_id,
        &source.source_transaction_id,
    ) {
        return deny(
            apply_result,
            "transaction_recovery_source_unrecovered",
            "Transaction recovery source has already been recovered.",
        );
    }
    if source_payload.get("operation").and_then(Value::as_str) != Some("replace_file_transaction") {
        return deny(
            apply_result,
            "transaction_recovery_replace_file_source_only",
            "Replace-file transaction recovery requires a replace_file_transaction source.",
        );
    }
    let source_status = source_payload
        .get("transaction_status")
        .and_then(Value::as_str)
        .unwrap_or("");
    if source_status != "PartialFailed" && source_status != "Failed" {
        return deny(
            apply_result,
            "transaction_recovery_source_partial_failed",
            "Transaction recovery source must be a partial failed transaction.",
        );
    }
    let source_items = source_payload
        .get("transaction_items")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            "invalid params: transaction recovery source items are malformed".to_string()
        })?;
    let source_applied = source_items
        .iter()
        .filter(|item| {
            item.get("applied")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .count();
    if source_applied == 0 || source_applied >= source_items.len() {
        return deny(
            apply_result,
            "transaction_recovery_source_partial_failed",
            "Transaction recovery source must include both applied and unrecovered items.",
        );
    }
    let recovery_proposal_ids: BTreeSet<String> =
        items.iter().map(|item| item.proposal_id.clone()).collect();
    for source_item in source_items {
        let proposal_id = source_item
            .get("proposal_id")
            .and_then(Value::as_str)
            .unwrap_or("");
        let applied = source_item
            .get("applied")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if source_item.get("operation").and_then(Value::as_str)
            != Some(WorkspacePatchOperation::ReplaceFile.as_str())
        {
            return deny(
                apply_result,
                "transaction_recovery_replace_file_source_only",
                "Replace-file transaction recovery source items must be replace_file items.",
            );
        }
        if applied {
            if recovery_proposal_ids.contains(proposal_id) {
                return deny(
                    apply_result,
                    "transaction_recovery_does_not_rewrite_applied_items",
                    "Transaction recovery must not rewrite already-applied source items.",
                );
            }
            let Some(path) = source_item.get("path").and_then(Value::as_str) else {
                return deny(
                    apply_result,
                    "transaction_recovery_applied_source_revalidated",
                    "Applied source transaction item is missing path evidence.",
                );
            };
            let Some(post_write_sha256) =
                source_item.get("post_write_sha256").and_then(Value::as_str)
            else {
                return deny(
                    apply_result,
                    "transaction_recovery_applied_source_revalidated",
                    "Applied source transaction item is missing post-write hash evidence.",
                );
            };
            match current_sha256_for_workspace_path(store, path) {
                Ok(current_hash) if current_hash == post_write_sha256 => {}
                _ => return deny(
                    apply_result,
                    "transaction_recovery_applied_source_revalidated",
                    "Already-applied source transaction item no longer matches recorded evidence.",
                ),
            }
        }
    }
    apply_result.transaction_recovery_source =
        Some(WorkspacePatchTransactionRecoverySourceSummary {
            source_run_id: source.source_run_id.clone(),
            source_apply_id: source.source_apply_id.clone(),
            source_transaction_id: source.source_transaction_id.clone(),
            source_transaction_fingerprint: source_fingerprint,
            source_transaction_status: source_status.to_string(),
            source_item_count: source_items.len(),
            source_applied_item_count: source_applied,
            source_recovery_item_count: items.len(),
        });
    apply_result.checklist.push(apply_result_check(
        "transaction_recovery_source_revalidated",
        "Pass",
        None,
    ));

    let mut seen_proposals = BTreeSet::new();
    let mut seen_paths: BTreeSet<String> = BTreeSet::new();
    let mut prepared_items = Vec::new();
    for item in items {
        if item.proposal_id.trim().is_empty() || !seen_proposals.insert(item.proposal_id.clone()) {
            return deny(
                apply_result,
                "transaction_recovery_proposal_ids_unique",
                "Transaction recovery item proposal_id values must be non-empty and unique.",
            );
        }
        let source_item = source_items.iter().find(|source_item| {
            source_item.get("proposal_id").and_then(Value::as_str)
                == Some(item.proposal_id.as_str())
        });
        let Some(source_item) = source_item else {
            return deny(
                apply_result,
                "transaction_recovery_items_from_source",
                "Every recovery item must come from the source transaction.",
            );
        };
        if source_item
            .get("applied")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return deny(
                apply_result,
                "transaction_recovery_items_not_applied",
                "Recovery items must not already be applied in source transaction evidence.",
            );
        }
        let proposal = inspect_proposal(store, &params.run_id, &item.proposal_id)?;
        if proposal.operation != WorkspacePatchOperation::ReplaceFile.as_str() {
            return deny(
                apply_result,
                "transaction_recovery_replace_file_only",
                "Transaction recovery only supports replace_file proposals.",
            );
        }
        if proposal.validation_status != "Valid" || proposal.approval_status != "Approved" {
            return deny(
                apply_result,
                "transaction_recovery_proposals_valid_and_approved",
                "Every transaction recovery proposal must be valid and approved.",
            );
        }
        if let Some(reason) = approval_current_failure_reason(proposal.approved_at.as_deref()) {
            return deny(
                apply_result,
                "transaction_recovery_approvals_current",
                reason,
            );
        }
        if has_consumed_apply_authorization(&events, &item.proposal_id) {
            return deny(
                apply_result,
                "transaction_recovery_approvals_unconsumed",
                "A transaction recovery proposal apply authorization has already been consumed.",
            );
        }
        if item.replacement_content.chars().count() > DEFAULT_MAX_WORKSPACE_WRITE_CONTENT_CHARS
            || scan_text_for_sensitive_content(&item.replacement_content)
        {
            return deny(
                apply_result,
                "transaction_recovery_replacement_content_safe",
                "Replacement content is too large or contains sensitive-like data.",
            );
        }
        if item.replacement_content.chars().count() != proposal.content_chars
            || preview_with_limit(&item.replacement_content, DEFAULT_PROPOSAL_PREVIEW_CHARS)
                != proposal.content_preview
            || proposal.diff_redacted
            || proposal.content_preview == "[redacted]"
            || proposal.diff_truncated
            || proposal.diff_preview.is_none()
        {
            return deny(
                apply_result,
                "transaction_recovery_replacement_content_matches_proposal",
                "Replacement content does not match approved proposal metadata.",
            );
        }
        let Some(expected_target_sha256) = item.expected_target_sha256.as_deref() else {
            return deny(
                apply_result,
                "transaction_recovery_expected_target_hashes_valid",
                "Every recovery expected target hash must be provided.",
            );
        };
        if !is_sha256_fingerprint(expected_target_sha256) {
            return deny(
                apply_result,
                "transaction_recovery_expected_target_hashes_valid",
                "Every recovery expected target hash must be a sha256 fingerprint.",
            );
        }
        let Some(previous_snapshot) = proposal.latest_snapshot.as_ref() else {
            return deny(
                apply_result,
                "transaction_recovery_latest_preflight_exists",
                "Run proposal.preflight for every recovery proposal before applying.",
            );
        };
        let current_snapshot =
            match capture_preflight_snapshot(store, &proposal, Some(previous_snapshot)) {
                Ok(snapshot) => snapshot,
                Err(_) => {
                    return deny(
                        apply_result,
                        "transaction_recovery_latest_preflight_validation",
                        "Latest preflight validation failed for a recovery proposal.",
                    )
                }
            };
        append_preflight_snapshot_event(store, &task, &current_snapshot)?;
        if current_snapshot.stale {
            return deny(
                apply_result,
                "transaction_recovery_latest_preflight_validation",
                "Latest preflight validation found a stale recovery target.",
            );
        }
        let target_path = match resolve_apply_target_path(store, &proposal) {
            Ok(path) => path,
            Err(reason) => {
                return deny(
                    apply_result,
                    "transaction_recovery_target_path_safe",
                    reason,
                )
            }
        };
        for seen_path in seen_paths.iter() {
            if seen_path == &proposal.path
                || seen_path.starts_with(&format!("{}/", proposal.path))
                || proposal.path.starts_with(&format!("{seen_path}/"))
            {
                return deny(
                    apply_result,
                    "transaction_recovery_target_paths_non_overlapping",
                    "Transaction recovery target paths must be unique and non-overlapping.",
                );
            }
        }
        seen_paths.insert(proposal.path.clone());
        let current_bytes = std::fs::read(&target_path).map_err(|_| {
            "Target file could not be read before transaction recovery apply.".to_string()
        })?;
        let pre_write_hash = format!("sha256:{}", hex_sha256(&current_bytes));
        if current_snapshot.file_sha256.as_deref() != Some(pre_write_hash.as_str())
            || expected_target_sha256 != pre_write_hash
        {
            return deny(
                apply_result,
                "transaction_recovery_expected_target_hashes_match",
                "Expected target hash does not match current recovery target file.",
            );
        }
        let current_content = match std::str::from_utf8(&current_bytes) {
            Ok(content) => content,
            Err(_) => {
                return deny(
                    apply_result,
                    "transaction_recovery_targets_utf8",
                    "Every transaction recovery target file must be UTF-8.",
                )
            }
        };
        if scan_text_for_sensitive_content(current_content) {
            return deny(
                apply_result,
                "transaction_recovery_targets_sensitive_scan",
                "A transaction recovery target file contains sensitive-like data.",
            );
        }
        let current_diff =
            synthetic_unified_diff(&proposal.path, current_content, &item.replacement_content);
        if proposal.diff_preview.as_deref() != Some(current_diff.as_str()) {
            return deny(
                apply_result,
                "transaction_recovery_approved_diffs_match_current_targets",
                "Approved diff does not match a current transaction recovery target.",
            );
        }
        let content_chars = item.replacement_content.chars().count();
        let replacement_bytes = item.replacement_content.as_bytes().to_vec();
        let content_bytes = replacement_bytes.len() as u64;
        apply_result.content_chars += content_chars;
        apply_result.content_bytes += content_bytes;
        prepared_items.push(PreparedReplaceTransactionItem {
            proposal_id: item.proposal_id.clone(),
            operation: proposal.operation,
            path: proposal.path,
            target_path,
            expected_target_sha256: expected_target_sha256.to_string(),
            pre_write_target_sha256: pre_write_hash,
            replacement_bytes,
            content_chars,
            content_bytes,
        });
    }
    apply_result.checklist.push(apply_result_check(
        "transaction_recovery_admission_all_items_passed",
        "Pass",
        None,
    ));

    let mut prepared_replacements = Vec::new();
    for item in &prepared_items {
        let prepared =
            prepare_atomic_replace_existing_file(&item.target_path, &item.replacement_bytes);
        if let Some(prepared) = prepared.prepared {
            prepared_replacements.push(prepared);
            continue;
        }
        let reason = prepared
            .failure_reason
            .unwrap_or("Temporary sibling file preparation failed.");
        for replacement in prepared_replacements {
            apply_result.temp_file_cleaned = apply_result.temp_file_cleaned
                && cleanup_atomic_replace_temp(&replacement.temp_path);
        }
        apply_result.transaction_items.push(transaction_item_result(
            item,
            "Failed",
            reason,
            None,
            false,
            false,
            prepared.temp_file_cleaned,
        ));
        apply_result.apply_status = "Failed".to_string();
        apply_result.apply_reason = reason.to_string();
        apply_result.transaction_status = Some("PartialFailed".to_string());
        apply_result.transaction_recovery_status = Some("Failed".to_string());
        apply_result.checklist.push(apply_result_check(
            "transaction_recovery_temporary_sibling_files_created",
            "Fail",
            Some(reason),
        ));
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &proposal_id_for_result,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "transaction_recovery_temporary_sibling_files_created",
        "Pass",
        None,
    ));

    for (item, prepared_replacement) in prepared_items.iter().zip(prepared_replacements) {
        let expected_post_write_hash = format!("sha256:{}", hex_sha256(&item.replacement_bytes));
        let outcome = commit_prepared_atomic_replace(prepared_replacement, &item.target_path);
        apply_result.temp_file_cleaned =
            apply_result.temp_file_cleaned && outcome.temp_file_cleaned;
        if let Some(reason) = outcome.failure_reason {
            apply_result.transaction_items.push(transaction_item_result(
                item,
                "Failed",
                reason,
                outcome.post_write_sha256,
                outcome.atomic_replacement_completed,
                false,
                outcome.temp_file_cleaned,
            ));
            apply_result.apply_status = "Failed".to_string();
            apply_result.apply_reason = reason.to_string();
            apply_result.transaction_status = Some("PartialFailed".to_string());
            apply_result.transaction_recovery_status = Some("PartialFailed".to_string());
            apply_result.checklist.push(apply_result_check(
                "transaction_recovery_atomic_replacements_completed",
                "Fail",
                Some(reason),
            ));
            return record_apply_result(
                store,
                &task,
                &params.run_id,
                &proposal_id_for_result,
                apply_result,
            );
        }
        if outcome.post_write_sha256.as_deref() != Some(expected_post_write_hash.as_str()) {
            apply_result.transaction_items.push(transaction_item_result(
                item,
                "Failed",
                "Post-write SHA-256 does not match replacement content.",
                outcome.post_write_sha256,
                outcome.atomic_replacement_completed,
                false,
                outcome.temp_file_cleaned,
            ));
            apply_result.apply_status = "Failed".to_string();
            apply_result.apply_reason =
                "Post-write SHA-256 does not match replacement content.".to_string();
            apply_result.transaction_status = Some("PartialFailed".to_string());
            apply_result.transaction_recovery_status = Some("PartialFailed".to_string());
            apply_result.checklist.push(apply_result_check(
                "transaction_recovery_post_write_sha256_verified",
                "Fail",
                Some("Post-write SHA-256 does not match replacement content."),
            ));
            return record_apply_result(
                store,
                &task,
                &params.run_id,
                &proposal_id_for_result,
                apply_result,
            );
        }
        apply_result.transaction_items.push(transaction_item_result(
            item,
            "Applied",
            "File recovered and post-write SHA-256 verified.",
            outcome.post_write_sha256.clone(),
            outcome.atomic_replacement_completed,
            true,
            outcome.temp_file_cleaned,
        ));
    }
    apply_result.checklist.push(apply_result_check(
        "transaction_recovery_atomic_replacements_completed",
        "Pass",
        None,
    ));
    apply_result.checklist.push(apply_result_check(
        "transaction_recovery_post_write_sha256_verified",
        "Pass",
        None,
    ));
    apply_result.apply_status = "Applied".to_string();
    apply_result.apply_reason =
        "Transaction recovery applied and all post-write SHA-256 values verified.".to_string();
    apply_result.transaction_status = Some("Applied".to_string());
    apply_result.transaction_recovery_status = Some("Applied".to_string());
    apply_result.atomic_replacement_completed = true;
    apply_result.authorization_consumed = true;
    apply_result.applied = true;
    apply_result.applied_at = Some(now_rfc3339());
    record_apply_result(
        store,
        &task,
        &params.run_id,
        &proposal_id_for_result,
        apply_result,
    )
    .map(|(_, result)| (first_proposal, result))
}

fn apply_create_file_transaction_recovery(
    store: &BrownieStore,
    params: &ProposalApplyParams,
) -> Result<
    (
        WorkspacePatchProposalSummary,
        WorkspacePatchApplyResultSummary,
    ),
    String,
> {
    let task = store
        .tasks()
        .get_task_by_run_id(&params.run_id)
        .map_err(|e| format!("invalid params: {e}"))?
        .ok_or_else(|| "invalid params: run not found".to_string())?;
    let items = params
        .transaction_items
        .as_ref()
        .ok_or_else(|| "invalid params: transaction_items are required".to_string())?;
    let source = params
        .transaction_recovery_source
        .as_ref()
        .ok_or_else(|| "invalid params: transaction_recovery_source is required".to_string())?;
    let proposal_id_for_result = fallback_transaction_proposal_id(params);
    let first_proposal = inspect_proposal(store, &params.run_id, &proposal_id_for_result)?;
    let mut apply_result = WorkspacePatchApplyResultSummary {
        proposal_id: proposal_id_for_result.clone(),
        apply_id: format!("apply_{}", uuid::Uuid::new_v4().simple()),
        apply_status: "Denied".to_string(),
        apply_reason: "Create-file transaction recovery preconditions were not satisfied."
            .to_string(),
        authorization_id: format!(
            "apply_create_tx_recovery_auth_{}",
            uuid::Uuid::new_v4().simple()
        ),
        authorization_consumed: false,
        applied: false,
        operation: "create_file_transaction_recovery".to_string(),
        atomic_replacement_completed: false,
        atomic_create_completed: false,
        atomic_delete_completed: false,
        path: "[transaction_recovery]".to_string(),
        expected_target_sha256: None,
        expected_target_absent: Some(true),
        pre_write_target_sha256: None,
        pre_write_target_exists: None,
        post_write_sha256: None,
        post_delete_target_exists: None,
        content_chars: 0,
        content_bytes: 0,
        checked_at: now_rfc3339(),
        applied_at: None,
        temp_file_cleaned: true,
        check_count: 0,
        failed_checks: Vec::new(),
        blocked_checks: Vec::new(),
        checklist: vec![apply_result_check(
            "transaction_recovery_request_present",
            "Pass",
            None,
        )],
        transaction_id: Some(format!(
            "apply_create_tx_recovery_{}",
            uuid::Uuid::new_v4().simple()
        )),
        transaction_status: Some("Denied".to_string()),
        transaction_items: Vec::new(),
        transaction_recovery_source: None,
        transaction_recovery_status: Some("Denied".to_string()),
    };

    let deny = |mut result: WorkspacePatchApplyResultSummary,
                check_name: &str,
                reason: &str|
     -> Result<
        (
            WorkspacePatchProposalSummary,
            WorkspacePatchApplyResultSummary,
        ),
        String,
    > {
        result
            .checklist
            .push(apply_result_check(check_name, "Fail", Some(reason)));
        result.apply_reason = reason.to_string();
        result.transaction_status = Some("Denied".to_string());
        result.transaction_recovery_status = Some("Denied".to_string());
        record_apply_result(
            store,
            &task,
            &params.run_id,
            &proposal_id_for_result,
            result,
        )
    };

    if !params.authorize {
        return deny(
            apply_result,
            "one_time_transaction_recovery_authorization",
            "Transaction recovery request must explicitly set authorize=true.",
        );
    }
    apply_result.checklist.push(apply_result_check(
        "one_time_transaction_recovery_authorization",
        "Pass",
        None,
    ));
    if !append_apply_write_permission_check(store, &task, &mut apply_result)? {
        apply_result.transaction_status = Some("Denied".to_string());
        apply_result.transaction_recovery_status = Some("Denied".to_string());
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &proposal_id_for_result,
            apply_result,
        );
    }
    if source.source_run_id != params.run_id {
        return deny(
            apply_result,
            "transaction_recovery_source_same_run",
            "Transaction recovery source must refer to the current run.",
        );
    }
    if !(1..=5).contains(&items.len()) {
        return deny(
            apply_result,
            "transaction_recovery_item_count_bounded",
            "Transaction recovery requires between one and five recovery items.",
        );
    }

    let events = read_existing_run_events(store, &params.run_id)?;
    let Some(source_payload) = latest_transaction_apply_payload(
        &events,
        &source.source_apply_id,
        &source.source_transaction_id,
    ) else {
        return deny(
            apply_result,
            "transaction_recovery_source_latest",
            "Transaction recovery source evidence was not found.",
        );
    };
    let Some(source_fingerprint) = transaction_source_fingerprint(&source_payload) else {
        return deny(
            apply_result,
            "transaction_recovery_source_fingerprint",
            "Transaction recovery source evidence is malformed.",
        );
    };
    if source.expected_source_transaction_fingerprint != source_fingerprint {
        return deny(
            apply_result,
            "transaction_recovery_source_fingerprint",
            "Transaction recovery source fingerprint does not match latest evidence.",
        );
    }
    if has_recovered_transaction(
        &events,
        &source.source_apply_id,
        &source.source_transaction_id,
    ) {
        return deny(
            apply_result,
            "transaction_recovery_source_unrecovered",
            "Transaction recovery source has already been recovered.",
        );
    }
    if source_payload.get("operation").and_then(Value::as_str) != Some("create_file_transaction") {
        return deny(
            apply_result,
            "transaction_recovery_create_file_source_only",
            "Create-file transaction recovery requires a create_file_transaction source.",
        );
    }
    let source_status = source_payload
        .get("transaction_status")
        .and_then(Value::as_str)
        .unwrap_or("");
    if source_status != "PartialFailed" && source_status != "Failed" {
        return deny(
            apply_result,
            "transaction_recovery_source_partial_failed",
            "Transaction recovery source must be a failed or partial failed transaction.",
        );
    }
    let source_items = source_payload
        .get("transaction_items")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            "invalid params: transaction recovery source items are malformed".to_string()
        })?;
    let source_applied = source_items
        .iter()
        .filter(|item| {
            item.get("applied")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .count();
    if source_applied >= source_items.len() {
        return deny(
            apply_result,
            "transaction_recovery_source_partial_failed",
            "Transaction recovery source must include unrecovered items.",
        );
    }
    let recovery_proposal_ids: BTreeSet<String> =
        items.iter().map(|item| item.proposal_id.clone()).collect();
    for source_item in source_items {
        let proposal_id = source_item
            .get("proposal_id")
            .and_then(Value::as_str)
            .unwrap_or("");
        let applied = source_item
            .get("applied")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if source_item.get("operation").and_then(Value::as_str)
            != Some(WorkspacePatchOperation::CreateFile.as_str())
        {
            return deny(
                apply_result,
                "transaction_recovery_create_file_source_only",
                "Create-file transaction recovery source items must be create_file items.",
            );
        }
        if applied {
            if recovery_proposal_ids.contains(proposal_id) {
                return deny(
                    apply_result,
                    "transaction_recovery_does_not_rewrite_applied_items",
                    "Transaction recovery must not rewrite already-applied source items.",
                );
            }
            let Some(path) = source_item.get("path").and_then(Value::as_str) else {
                return deny(
                    apply_result,
                    "transaction_recovery_applied_source_revalidated",
                    "Applied source transaction item is missing path evidence.",
                );
            };
            let Some(post_write_sha256) =
                source_item.get("post_write_sha256").and_then(Value::as_str)
            else {
                return deny(
                    apply_result,
                    "transaction_recovery_applied_source_revalidated",
                    "Applied source transaction item is missing post-write hash evidence.",
                );
            };
            match current_sha256_for_workspace_path(store, path) {
                Ok(current_hash) if current_hash == post_write_sha256 => {}
                _ => return deny(
                    apply_result,
                    "transaction_recovery_applied_source_revalidated",
                    "Already-applied source transaction item no longer matches recorded evidence.",
                ),
            }
        }
    }
    apply_result.transaction_recovery_source =
        Some(WorkspacePatchTransactionRecoverySourceSummary {
            source_run_id: source.source_run_id.clone(),
            source_apply_id: source.source_apply_id.clone(),
            source_transaction_id: source.source_transaction_id.clone(),
            source_transaction_fingerprint: source_fingerprint,
            source_transaction_status: source_status.to_string(),
            source_item_count: source_items.len(),
            source_applied_item_count: source_applied,
            source_recovery_item_count: items.len(),
        });
    apply_result.checklist.push(apply_result_check(
        "transaction_recovery_source_revalidated",
        "Pass",
        None,
    ));

    let mut seen_proposals = BTreeSet::new();
    let mut seen_paths: BTreeSet<String> = BTreeSet::new();
    let mut prepared_items = Vec::new();
    for item in items {
        if item.proposal_id.trim().is_empty() || !seen_proposals.insert(item.proposal_id.clone()) {
            return deny(
                apply_result,
                "transaction_recovery_proposal_ids_unique",
                "Transaction recovery item proposal_id values must be non-empty and unique.",
            );
        }
        let source_item = source_items.iter().find(|source_item| {
            source_item.get("proposal_id").and_then(Value::as_str)
                == Some(item.proposal_id.as_str())
        });
        let Some(source_item) = source_item else {
            return deny(
                apply_result,
                "transaction_recovery_items_from_source",
                "Every recovery item must come from the source transaction.",
            );
        };
        if source_item
            .get("applied")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return deny(
                apply_result,
                "transaction_recovery_items_not_applied",
                "Recovery items must not already be applied in source transaction evidence.",
            );
        }
        if item.expected_target_absent != Some(true) {
            return deny(
                apply_result,
                "transaction_recovery_expected_target_absent_confirmed",
                "Every create-file recovery item requires expected_target_absent=true.",
            );
        }
        if item.expected_target_sha256.is_some() {
            return deny(
                apply_result,
                "transaction_recovery_create_target_hash_omitted",
                "Create-file recovery items must omit expected_target_sha256.",
            );
        }
        let proposal = inspect_proposal(store, &params.run_id, &item.proposal_id)?;
        if proposal.operation != WorkspacePatchOperation::CreateFile.as_str() {
            return deny(
                apply_result,
                "transaction_recovery_create_file_only",
                "Create-file transaction recovery only supports create_file proposals.",
            );
        }
        if proposal.validation_status != "Valid" || proposal.approval_status != "Approved" {
            return deny(
                apply_result,
                "transaction_recovery_proposals_valid_and_approved",
                "Every transaction recovery proposal must be valid and approved.",
            );
        }
        if let Some(reason) = approval_current_failure_reason(proposal.approved_at.as_deref()) {
            return deny(
                apply_result,
                "transaction_recovery_approvals_current",
                reason,
            );
        }
        if has_consumed_apply_authorization(&events, &item.proposal_id) {
            return deny(
                apply_result,
                "transaction_recovery_approvals_unconsumed",
                "A transaction recovery proposal apply authorization has already been consumed.",
            );
        }
        if item.replacement_content.chars().count() > DEFAULT_MAX_WORKSPACE_WRITE_CONTENT_CHARS
            || scan_text_for_sensitive_content(&item.replacement_content)
        {
            return deny(
                apply_result,
                "transaction_recovery_replacement_content_safe",
                "Replacement content is too large or contains sensitive-like data.",
            );
        }
        if item.replacement_content.chars().count() != proposal.content_chars
            || preview_with_limit(&item.replacement_content, DEFAULT_PROPOSAL_PREVIEW_CHARS)
                != proposal.content_preview
            || proposal.diff_redacted
            || proposal.content_preview == "[redacted]"
            || proposal.diff_truncated
            || proposal.diff_preview.is_none()
        {
            return deny(
                apply_result,
                "transaction_recovery_replacement_content_matches_proposal",
                "Replacement content does not match approved proposal metadata.",
            );
        }
        let Some(previous_snapshot) = proposal.latest_snapshot.as_ref() else {
            return deny(
                apply_result,
                "transaction_recovery_latest_preflight_exists",
                "Run proposal.preflight for every recovery proposal before applying.",
            );
        };
        let current_snapshot =
            match capture_preflight_snapshot(store, &proposal, Some(previous_snapshot)) {
                Ok(snapshot) => snapshot,
                Err(_) => {
                    return deny(
                        apply_result,
                        "transaction_recovery_latest_preflight_validation",
                        "Latest preflight validation failed for a recovery proposal.",
                    )
                }
            };
        append_preflight_snapshot_event(store, &task, &current_snapshot)?;
        if current_snapshot.stale {
            return deny(
                apply_result,
                "transaction_recovery_latest_preflight_validation",
                "Latest preflight validation found a stale recovery target.",
            );
        }
        if current_snapshot.file_exists {
            return deny(
                apply_result,
                "transaction_recovery_targets_absent_current",
                "A create-file recovery target already exists.",
            );
        }
        let target_path = match resolve_create_apply_target_path(store, &proposal) {
            Ok(path) => path,
            Err(reason) => {
                return deny(
                    apply_result,
                    "transaction_recovery_target_path_safe",
                    reason,
                )
            }
        };
        for seen_path in seen_paths.iter() {
            if seen_path == &proposal.path
                || seen_path.starts_with(&format!("{}/", proposal.path))
                || proposal.path.starts_with(&format!("{seen_path}/"))
            {
                return deny(
                    apply_result,
                    "transaction_recovery_target_paths_non_overlapping",
                    "Transaction recovery target paths must be unique and non-overlapping.",
                );
            }
        }
        seen_paths.insert(proposal.path.clone());
        let create_diff = synthetic_unified_diff(&proposal.path, "", &item.replacement_content);
        if proposal.diff_preview.as_deref() != Some(create_diff.as_str()) {
            return deny(
                apply_result,
                "transaction_recovery_approved_diffs_match_absent_targets",
                "Approved diff does not match an absent transaction recovery target.",
            );
        }
        let content_chars = item.replacement_content.chars().count();
        let replacement_bytes = item.replacement_content.as_bytes().to_vec();
        let content_bytes = replacement_bytes.len() as u64;
        apply_result.content_chars += content_chars;
        apply_result.content_bytes += content_bytes;
        prepared_items.push(PreparedCreateTransactionItem {
            proposal_id: item.proposal_id.clone(),
            operation: proposal.operation,
            path: proposal.path,
            target_path,
            replacement_bytes,
            content_chars,
            content_bytes,
        });
    }
    apply_result.checklist.push(apply_result_check(
        "transaction_recovery_admission_all_items_passed",
        "Pass",
        None,
    ));

    let mut prepared_creates = Vec::new();
    for item in &prepared_items {
        let prepared = prepare_atomic_create_new_file(&item.target_path, &item.replacement_bytes);
        if let Some(prepared) = prepared.prepared {
            prepared_creates.push(prepared);
            continue;
        }
        let reason = prepared
            .failure_reason
            .unwrap_or("Temporary sibling file preparation failed.");
        apply_result
            .transaction_items
            .push(create_transaction_item_result(
                item,
                "Failed",
                reason,
                None,
                false,
                false,
                prepared.temp_file_cleaned,
            ));
        apply_result.apply_status = "Failed".to_string();
        apply_result.apply_reason = reason.to_string();
        apply_result.transaction_status = Some("Failed".to_string());
        apply_result.transaction_recovery_status = Some("Failed".to_string());
        apply_result.checklist.push(apply_result_check(
            "transaction_recovery_temporary_sibling_files_created",
            "Fail",
            Some(reason),
        ));
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &proposal_id_for_result,
            apply_result,
        )
        .map(|(_, result)| (first_proposal, result));
    }
    apply_result.checklist.push(apply_result_check(
        "transaction_recovery_temporary_sibling_files_created",
        "Pass",
        None,
    ));

    for (item, prepared_create) in prepared_items.iter().zip(prepared_creates) {
        let expected_post_write_hash = format!("sha256:{}", hex_sha256(&item.replacement_bytes));
        let outcome = commit_prepared_atomic_create(prepared_create);
        apply_result.temp_file_cleaned =
            apply_result.temp_file_cleaned && outcome.temp_file_cleaned;
        if let Some(reason) = outcome.failure_reason {
            apply_result
                .transaction_items
                .push(create_transaction_item_result(
                    item,
                    if reason == "Target path already exists." {
                        "Denied"
                    } else {
                        "Failed"
                    },
                    reason,
                    outcome.post_write_sha256,
                    outcome.atomic_create_completed,
                    false,
                    outcome.temp_file_cleaned,
                ));
            apply_result.apply_status = if reason == "Target path already exists." {
                "Denied".to_string()
            } else {
                "Failed".to_string()
            };
            apply_result.apply_reason = reason.to_string();
            apply_result.transaction_status = Some(if apply_result.transaction_items.len() > 1 {
                "PartialFailed".to_string()
            } else {
                apply_result.apply_status.clone()
            });
            apply_result.transaction_recovery_status = Some(apply_result.apply_status.clone());
            apply_result.checklist.push(apply_result_check(
                "transaction_recovery_atomic_creates_completed",
                "Fail",
                Some(reason),
            ));
            return record_apply_result(
                store,
                &task,
                &params.run_id,
                &proposal_id_for_result,
                apply_result,
            )
            .map(|(_, result)| (first_proposal, result));
        }
        if outcome.post_write_sha256.as_deref() != Some(expected_post_write_hash.as_str()) {
            apply_result
                .transaction_items
                .push(create_transaction_item_result(
                    item,
                    "Failed",
                    "Post-write SHA-256 does not match replacement content.",
                    outcome.post_write_sha256,
                    outcome.atomic_create_completed,
                    false,
                    outcome.temp_file_cleaned,
                ));
            apply_result.apply_status = "Failed".to_string();
            apply_result.apply_reason =
                "Post-write SHA-256 does not match replacement content.".to_string();
            apply_result.transaction_status = Some("PartialFailed".to_string());
            apply_result.transaction_recovery_status = Some("Failed".to_string());
            apply_result.checklist.push(apply_result_check(
                "transaction_recovery_post_write_sha256_verified",
                "Fail",
                Some("Post-write SHA-256 does not match replacement content."),
            ));
            return record_apply_result(
                store,
                &task,
                &params.run_id,
                &proposal_id_for_result,
                apply_result,
            )
            .map(|(_, result)| (first_proposal, result));
        }
        apply_result
            .transaction_items
            .push(create_transaction_item_result(
                item,
                "Applied",
                "File recovered and post-write SHA-256 verified.",
                outcome.post_write_sha256.clone(),
                outcome.atomic_create_completed,
                true,
                outcome.temp_file_cleaned,
            ));
    }
    apply_result.checklist.push(apply_result_check(
        "transaction_recovery_atomic_creates_completed",
        "Pass",
        None,
    ));
    apply_result.checklist.push(apply_result_check(
        "transaction_recovery_post_write_sha256_verified",
        "Pass",
        None,
    ));
    apply_result.apply_status = "Applied".to_string();
    apply_result.apply_reason =
        "Create-file transaction recovery applied and all post-write SHA-256 values verified."
            .to_string();
    apply_result.transaction_status = Some("Applied".to_string());
    apply_result.transaction_recovery_status = Some("Applied".to_string());
    apply_result.atomic_create_completed = true;
    apply_result.authorization_consumed = true;
    apply_result.applied = true;
    apply_result.applied_at = Some(now_rfc3339());
    record_apply_result(
        store,
        &task,
        &params.run_id,
        &proposal_id_for_result,
        apply_result,
    )
    .map(|(_, result)| (first_proposal, result))
}

fn apply_delete_file_transaction_recovery(
    store: &BrownieStore,
    params: &ProposalApplyParams,
) -> Result<
    (
        WorkspacePatchProposalSummary,
        WorkspacePatchApplyResultSummary,
    ),
    String,
> {
    let task = store
        .tasks()
        .get_task_by_run_id(&params.run_id)
        .map_err(|e| format!("invalid params: {e}"))?
        .ok_or_else(|| "invalid params: run not found".to_string())?;
    let items = params
        .transaction_items
        .as_ref()
        .ok_or_else(|| "invalid params: transaction_items are required".to_string())?;
    let source = params
        .transaction_recovery_source
        .as_ref()
        .ok_or_else(|| "invalid params: transaction_recovery_source is required".to_string())?;
    let proposal_id_for_result = fallback_transaction_proposal_id(params);
    let first_proposal = inspect_proposal(store, &params.run_id, &proposal_id_for_result)?;
    let mut apply_result = WorkspacePatchApplyResultSummary {
        proposal_id: proposal_id_for_result.clone(),
        apply_id: format!("apply_{}", uuid::Uuid::new_v4().simple()),
        apply_status: "Denied".to_string(),
        apply_reason: "Delete-file transaction recovery preconditions were not satisfied."
            .to_string(),
        authorization_id: format!(
            "apply_delete_tx_recovery_auth_{}",
            uuid::Uuid::new_v4().simple()
        ),
        authorization_consumed: false,
        applied: false,
        operation: "delete_file_transaction_recovery".to_string(),
        atomic_replacement_completed: false,
        atomic_create_completed: false,
        atomic_delete_completed: false,
        path: "[transaction_recovery]".to_string(),
        expected_target_sha256: None,
        expected_target_absent: None,
        pre_write_target_sha256: None,
        pre_write_target_exists: None,
        post_write_sha256: None,
        post_delete_target_exists: None,
        content_chars: 0,
        content_bytes: 0,
        checked_at: now_rfc3339(),
        applied_at: None,
        temp_file_cleaned: true,
        check_count: 0,
        failed_checks: Vec::new(),
        blocked_checks: Vec::new(),
        checklist: vec![apply_result_check(
            "transaction_recovery_request_present",
            "Pass",
            None,
        )],
        transaction_id: Some(format!(
            "apply_delete_tx_recovery_{}",
            uuid::Uuid::new_v4().simple()
        )),
        transaction_status: Some("Denied".to_string()),
        transaction_items: Vec::new(),
        transaction_recovery_source: None,
        transaction_recovery_status: Some("Denied".to_string()),
    };

    let deny = |mut result: WorkspacePatchApplyResultSummary,
                check_name: &str,
                reason: &str|
     -> Result<
        (
            WorkspacePatchProposalSummary,
            WorkspacePatchApplyResultSummary,
        ),
        String,
    > {
        result
            .checklist
            .push(apply_result_check(check_name, "Fail", Some(reason)));
        result.apply_reason = reason.to_string();
        result.transaction_status = Some("Denied".to_string());
        result.transaction_recovery_status = Some("Denied".to_string());
        record_apply_result(
            store,
            &task,
            &params.run_id,
            &proposal_id_for_result,
            result,
        )
        .map(|(_, result)| (first_proposal.clone(), result))
    };

    if !params.authorize {
        return deny(
            apply_result,
            "one_time_transaction_recovery_authorization",
            "Transaction recovery request must explicitly set authorize=true.",
        );
    }
    apply_result.checklist.push(apply_result_check(
        "one_time_transaction_recovery_authorization",
        "Pass",
        None,
    ));
    if !append_apply_write_permission_check(store, &task, &mut apply_result)? {
        apply_result.transaction_status = Some("Denied".to_string());
        apply_result.transaction_recovery_status = Some("Denied".to_string());
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &proposal_id_for_result,
            apply_result,
        )
        .map(|(_, result)| (first_proposal, result));
    }
    if source.source_run_id != params.run_id {
        return deny(
            apply_result,
            "transaction_recovery_source_same_run",
            "Transaction recovery source must refer to the current run.",
        );
    }
    if !(1..=5).contains(&items.len()) {
        return deny(
            apply_result,
            "transaction_recovery_item_count_bounded",
            "Transaction recovery requires between one and five recovery items.",
        );
    }

    let events = read_existing_run_events(store, &params.run_id)?;
    let Some(source_payload) = latest_transaction_apply_payload(
        &events,
        &source.source_apply_id,
        &source.source_transaction_id,
    ) else {
        return deny(
            apply_result,
            "transaction_recovery_source_latest",
            "Transaction recovery source evidence was not found.",
        );
    };
    let Some(source_fingerprint) = transaction_source_fingerprint(&source_payload) else {
        return deny(
            apply_result,
            "transaction_recovery_source_fingerprint",
            "Transaction recovery source evidence is malformed.",
        );
    };
    if source.expected_source_transaction_fingerprint != source_fingerprint {
        return deny(
            apply_result,
            "transaction_recovery_source_fingerprint",
            "Transaction recovery source fingerprint does not match latest evidence.",
        );
    }
    if has_recovered_transaction(
        &events,
        &source.source_apply_id,
        &source.source_transaction_id,
    ) {
        return deny(
            apply_result,
            "transaction_recovery_source_unrecovered",
            "Transaction recovery source has already been recovered.",
        );
    }
    if source_payload.get("operation").and_then(Value::as_str) != Some("delete_file_transaction") {
        return deny(
            apply_result,
            "transaction_recovery_delete_file_source_only",
            "Delete-file transaction recovery requires a delete_file_transaction source.",
        );
    }
    let source_status = source_payload
        .get("transaction_status")
        .and_then(Value::as_str)
        .unwrap_or("");
    if source_status != "PartialFailed" && source_status != "Failed" {
        return deny(
            apply_result,
            "transaction_recovery_source_partial_failed",
            "Transaction recovery source must be a failed or partial failed transaction.",
        );
    }
    let source_items = source_payload
        .get("transaction_items")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            "invalid params: transaction recovery source items are malformed".to_string()
        })?;
    let source_applied = source_items
        .iter()
        .filter(|item| {
            item.get("applied")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .count();
    if source_applied == 0 || source_applied >= source_items.len() {
        return deny(
            apply_result,
            "transaction_recovery_source_partial_failed",
            "Transaction recovery source must include both applied and unrecovered items.",
        );
    }
    let recovery_proposal_ids: BTreeSet<String> =
        items.iter().map(|item| item.proposal_id.clone()).collect();
    for source_item in source_items {
        let proposal_id = source_item
            .get("proposal_id")
            .and_then(Value::as_str)
            .unwrap_or("");
        let applied = source_item
            .get("applied")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if source_item.get("operation").and_then(Value::as_str)
            != Some(WorkspacePatchOperation::DeleteFile.as_str())
        {
            return deny(
                apply_result,
                "transaction_recovery_delete_file_source_only",
                "Delete-file transaction recovery source items must be delete_file items.",
            );
        }
        if applied {
            if recovery_proposal_ids.contains(proposal_id) {
                return deny(
                    apply_result,
                    "transaction_recovery_does_not_reapply_applied_items",
                    "Transaction recovery must not delete already-applied source items.",
                );
            }
            let Some(path) = source_item.get("path").and_then(Value::as_str) else {
                return deny(
                    apply_result,
                    "transaction_recovery_applied_source_absent",
                    "Applied source transaction item is missing path evidence.",
                );
            };
            if workspace_path_currently_absent(store, path).is_err() {
                return deny(
                    apply_result,
                    "transaction_recovery_applied_source_absent",
                    "Already-applied source delete item is no longer absent.",
                );
            }
        }
    }
    apply_result.transaction_recovery_source =
        Some(WorkspacePatchTransactionRecoverySourceSummary {
            source_run_id: source.source_run_id.clone(),
            source_apply_id: source.source_apply_id.clone(),
            source_transaction_id: source.source_transaction_id.clone(),
            source_transaction_fingerprint: source_fingerprint,
            source_transaction_status: source_status.to_string(),
            source_item_count: source_items.len(),
            source_applied_item_count: source_applied,
            source_recovery_item_count: items.len(),
        });
    apply_result.checklist.push(apply_result_check(
        "transaction_recovery_source_revalidated",
        "Pass",
        None,
    ));

    let mut seen_proposals = BTreeSet::new();
    let mut seen_paths: BTreeSet<String> = BTreeSet::new();
    let mut prepared_items = Vec::new();
    for item in items {
        if item.proposal_id.trim().is_empty() || !seen_proposals.insert(item.proposal_id.clone()) {
            return deny(
                apply_result,
                "transaction_recovery_proposal_ids_unique",
                "Transaction recovery item proposal_id values must be non-empty and unique.",
            );
        }
        let source_item = source_items.iter().find(|source_item| {
            source_item.get("proposal_id").and_then(Value::as_str)
                == Some(item.proposal_id.as_str())
        });
        let Some(source_item) = source_item else {
            return deny(
                apply_result,
                "transaction_recovery_items_from_source",
                "Every recovery item must come from the source transaction.",
            );
        };
        if source_item
            .get("applied")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return deny(
                apply_result,
                "transaction_recovery_items_not_applied",
                "Recovery items must not already be applied in source transaction evidence.",
            );
        }
        if !item.replacement_content.is_empty() {
            return deny(
                apply_result,
                "transaction_recovery_replacement_content_omitted_for_delete",
                "Delete-file recovery items must use empty replacement_content.",
            );
        }
        if item.expected_target_absent.is_some() {
            return deny(
                apply_result,
                "transaction_recovery_delete_target_absence_omitted",
                "Delete-file recovery items must omit expected_target_absent.",
            );
        }
        let proposal = inspect_proposal(store, &params.run_id, &item.proposal_id)?;
        if proposal.operation != WorkspacePatchOperation::DeleteFile.as_str() {
            return deny(
                apply_result,
                "transaction_recovery_delete_file_only",
                "Delete-file transaction recovery only supports delete_file proposals.",
            );
        }
        if proposal.validation_status != "Valid" || proposal.approval_status != "Approved" {
            return deny(
                apply_result,
                "transaction_recovery_proposals_valid_and_approved",
                "Every transaction recovery proposal must be valid and approved.",
            );
        }
        if let Some(reason) = approval_current_failure_reason(proposal.approved_at.as_deref()) {
            return deny(
                apply_result,
                "transaction_recovery_approvals_current",
                reason,
            );
        }
        if has_consumed_apply_authorization(&events, &item.proposal_id) {
            return deny(
                apply_result,
                "transaction_recovery_approvals_unconsumed",
                "A transaction recovery proposal apply authorization has already been consumed.",
            );
        }
        if proposal.content_chars != 0 || !proposal.content_preview.is_empty() {
            return deny(
                apply_result,
                "transaction_recovery_delete_proposal_has_no_replacement_content",
                "Delete-file proposals must not carry replacement content metadata.",
            );
        }
        if proposal.diff_redacted
            || proposal.content_preview == "[redacted]"
            || proposal.diff_truncated
            || proposal.diff_preview.is_none()
        {
            return deny(
                apply_result,
                "transaction_recovery_proposal_diff_available",
                "Proposal diff must be available and untruncated for transaction recovery.",
            );
        }
        let Some(expected_target_sha256) = item.expected_target_sha256.as_deref() else {
            return deny(
                apply_result,
                "transaction_recovery_expected_target_hashes_valid",
                "Every recovery expected target hash must be provided.",
            );
        };
        if !is_sha256_fingerprint(expected_target_sha256) {
            return deny(
                apply_result,
                "transaction_recovery_expected_target_hashes_valid",
                "Every recovery expected target hash must be a sha256 fingerprint.",
            );
        }
        let Some(previous_snapshot) = proposal.latest_snapshot.as_ref() else {
            return deny(
                apply_result,
                "transaction_recovery_latest_preflight_exists",
                "Run proposal.preflight for every recovery proposal before applying.",
            );
        };
        let current_snapshot =
            match capture_preflight_snapshot(store, &proposal, Some(previous_snapshot)) {
                Ok(snapshot) => snapshot,
                Err(_) => {
                    return deny(
                        apply_result,
                        "transaction_recovery_latest_preflight_validation",
                        "Latest preflight validation failed for a recovery proposal.",
                    )
                }
            };
        append_preflight_snapshot_event(store, &task, &current_snapshot)?;
        if current_snapshot.stale {
            return deny(
                apply_result,
                "transaction_recovery_latest_preflight_validation",
                "Latest preflight validation found a stale recovery target.",
            );
        }
        if !current_snapshot.file_exists {
            return deny(
                apply_result,
                "transaction_recovery_target_file_exists",
                "Every delete-file recovery target must exist.",
            );
        }
        if current_snapshot.file_kind == "Symlink" {
            return deny(
                apply_result,
                "transaction_recovery_target_file_not_symlink",
                "Every delete-file recovery target must not be a symlink.",
            );
        }
        if current_snapshot.file_kind != "File" {
            return deny(
                apply_result,
                "transaction_recovery_target_file_regular",
                "Every delete-file recovery target must be a regular file.",
            );
        }
        let target_path = match resolve_apply_target_path(store, &proposal) {
            Ok(path) => path,
            Err(reason) => {
                return deny(
                    apply_result,
                    "transaction_recovery_target_path_safe",
                    reason,
                )
            }
        };
        for seen_path in seen_paths.iter() {
            if seen_path == &proposal.path
                || seen_path.starts_with(&format!("{}/", proposal.path))
                || proposal.path.starts_with(&format!("{seen_path}/"))
            {
                return deny(
                    apply_result,
                    "transaction_recovery_target_paths_non_overlapping",
                    "Transaction recovery target paths must be unique and non-overlapping.",
                );
            }
        }
        seen_paths.insert(proposal.path.clone());
        let current_bytes = std::fs::read(&target_path).map_err(|_| {
            "Target file could not be read before transaction recovery apply.".to_string()
        })?;
        let pre_write_hash = format!("sha256:{}", hex_sha256(&current_bytes));
        if current_snapshot.file_sha256.as_deref() != Some(pre_write_hash.as_str())
            || expected_target_sha256 != pre_write_hash
        {
            return deny(
                apply_result,
                "transaction_recovery_expected_target_hashes_match",
                "Expected target hash does not match current recovery target file.",
            );
        }
        let current_content = match std::str::from_utf8(&current_bytes) {
            Ok(content) => content,
            Err(_) => {
                return deny(
                    apply_result,
                    "transaction_recovery_targets_utf8",
                    "Every transaction recovery target file must be UTF-8.",
                )
            }
        };
        if scan_text_for_sensitive_content(current_content) {
            return deny(
                apply_result,
                "transaction_recovery_targets_sensitive_scan",
                "A transaction recovery target file contains sensitive-like data.",
            );
        }
        let current_diff = synthetic_unified_diff(&proposal.path, current_content, "");
        if proposal.diff_preview.as_deref() != Some(current_diff.as_str()) {
            return deny(
                apply_result,
                "transaction_recovery_approved_diffs_match_current_targets",
                "Approved diff does not match a current transaction recovery target deletion.",
            );
        }
        prepared_items.push(PreparedDeleteTransactionItem {
            proposal_id: item.proposal_id.clone(),
            operation: proposal.operation,
            path: proposal.path,
            target_path,
            expected_target_sha256: expected_target_sha256.to_string(),
            pre_write_target_sha256: pre_write_hash,
        });
    }
    apply_result.checklist.push(apply_result_check(
        "transaction_recovery_admission_all_items_passed",
        "Pass",
        None,
    ));

    for item in &prepared_items {
        let outcome = atomic_delete_existing_file(&item.target_path);
        apply_result.atomic_delete_completed =
            apply_result.atomic_delete_completed || outcome.atomic_delete_completed;
        apply_result.post_delete_target_exists = outcome.post_delete_target_exists;
        if let Some(reason) = outcome.failure_reason {
            apply_result
                .transaction_items
                .push(delete_transaction_item_result(
                    item,
                    "Failed",
                    reason,
                    outcome.post_delete_target_exists,
                    outcome.atomic_delete_completed,
                    false,
                    true,
                ));
            apply_result.apply_status = "Failed".to_string();
            apply_result.apply_reason = reason.to_string();
            apply_result.transaction_status = Some(if apply_result.transaction_items.len() > 1 {
                "PartialFailed".to_string()
            } else {
                "Failed".to_string()
            });
            apply_result.transaction_recovery_status = Some(
                apply_result
                    .transaction_status
                    .clone()
                    .unwrap_or_else(|| "Failed".into()),
            );
            apply_result.checklist.push(apply_result_check(
                "transaction_recovery_atomic_deletes_completed",
                "Fail",
                Some(reason),
            ));
            return record_apply_result(
                store,
                &task,
                &params.run_id,
                &proposal_id_for_result,
                apply_result,
            )
            .map(|(_, result)| (first_proposal, result));
        }
        apply_result
            .transaction_items
            .push(delete_transaction_item_result(
                item,
                "Applied",
                "File recovered by delete and post-delete absence verified.",
                outcome.post_delete_target_exists,
                outcome.atomic_delete_completed,
                true,
                true,
            ));
    }
    apply_result.checklist.push(apply_result_check(
        "transaction_recovery_atomic_deletes_completed",
        "Pass",
        None,
    ));
    apply_result.checklist.push(apply_result_check(
        "transaction_recovery_post_delete_absence_verified",
        "Pass",
        None,
    ));
    apply_result.apply_status = "Applied".to_string();
    apply_result.apply_reason =
        "Delete-file transaction recovery applied and all post-delete absence checks passed."
            .to_string();
    apply_result.transaction_status = Some("Applied".to_string());
    apply_result.transaction_recovery_status = Some("Applied".to_string());
    apply_result.atomic_delete_completed = true;
    apply_result.post_delete_target_exists = Some(false);
    apply_result.authorization_consumed = true;
    apply_result.applied = true;
    apply_result.applied_at = Some(now_rfc3339());
    record_apply_result(
        store,
        &task,
        &params.run_id,
        &proposal_id_for_result,
        apply_result,
    )
    .map(|(_, result)| (first_proposal, result))
}

fn apply_replace_file_transaction(
    store: &BrownieStore,
    params: &ProposalApplyParams,
) -> Result<
    (
        WorkspacePatchProposalSummary,
        WorkspacePatchApplyResultSummary,
    ),
    String,
> {
    let task = store
        .tasks()
        .get_task_by_run_id(&params.run_id)
        .map_err(|e| format!("invalid params: {e}"))?
        .ok_or_else(|| "invalid params: run not found".to_string())?;
    let items = params
        .transaction_items
        .as_ref()
        .ok_or_else(|| "invalid params: transaction_items are required".to_string())?;
    let proposal_id_for_result = fallback_transaction_proposal_id(params);
    let first_proposal = inspect_proposal(store, &params.run_id, &proposal_id_for_result)?;
    let mut apply_result = WorkspacePatchApplyResultSummary {
        proposal_id: proposal_id_for_result.clone(),
        apply_id: format!("apply_{}", uuid::Uuid::new_v4().simple()),
        apply_status: "Denied".to_string(),
        apply_reason: "Transaction apply preconditions were not satisfied.".to_string(),
        authorization_id: format!("apply_tx_auth_{}", uuid::Uuid::new_v4().simple()),
        authorization_consumed: false,
        applied: false,
        operation: "replace_file_transaction".to_string(),
        atomic_replacement_completed: false,
        atomic_create_completed: false,
        atomic_delete_completed: false,
        path: "[transaction]".to_string(),
        expected_target_sha256: None,
        expected_target_absent: None,
        pre_write_target_sha256: None,
        pre_write_target_exists: None,
        post_write_sha256: None,
        post_delete_target_exists: None,
        content_chars: 0,
        content_bytes: 0,
        checked_at: now_rfc3339(),
        applied_at: None,
        temp_file_cleaned: true,
        check_count: 0,
        failed_checks: Vec::new(),
        blocked_checks: Vec::new(),
        checklist: vec![apply_result_check(
            "transaction_request_present",
            "Pass",
            None,
        )],
        transaction_id: Some(format!("apply_tx_{}", uuid::Uuid::new_v4().simple())),
        transaction_status: Some("Denied".to_string()),
        transaction_items: Vec::new(),
        transaction_recovery_source: None,
        transaction_recovery_status: None,
    };

    if !params.authorize {
        apply_result.checklist.push(apply_result_check(
            "one_time_transaction_authorization",
            "Fail",
            Some("Transaction apply request must explicitly set authorize=true."),
        ));
        apply_result.apply_reason =
            "Transaction apply request must explicitly set authorize=true.".to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &proposal_id_for_result,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "one_time_transaction_authorization",
        "Pass",
        None,
    ));
    if !append_apply_write_permission_check(store, &task, &mut apply_result)? {
        apply_result.transaction_status = Some("Denied".to_string());
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &proposal_id_for_result,
            apply_result,
        );
    }

    if !(2..=5).contains(&items.len()) {
        apply_result.checklist.push(apply_result_check(
            "transaction_item_count_bounded",
            "Fail",
            Some("Transaction apply requires between two and five items."),
        ));
        apply_result.apply_reason =
            "Transaction apply requires between two and five items.".to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &proposal_id_for_result,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "transaction_item_count_bounded",
        "Pass",
        None,
    ));

    let events = read_existing_run_events(store, &params.run_id)?;
    let mut seen_proposals = BTreeSet::new();
    let mut seen_paths: BTreeSet<String> = BTreeSet::new();
    let mut prepared_items = Vec::new();

    for item in items {
        if item.proposal_id.trim().is_empty() || !seen_proposals.insert(item.proposal_id.clone()) {
            apply_result.checklist.push(apply_result_check(
                "transaction_proposal_ids_unique",
                "Fail",
                Some("Transaction item proposal_id values must be non-empty and unique."),
            ));
            apply_result.apply_reason =
                "Transaction item proposal_id values must be non-empty and unique.".to_string();
            return record_apply_result(
                store,
                &task,
                &params.run_id,
                &proposal_id_for_result,
                apply_result,
            );
        }

        let proposal = inspect_proposal(store, &params.run_id, &item.proposal_id)?;
        let deny_item = |apply_result: WorkspacePatchApplyResultSummary,
                         check_name: &str,
                         reason: &str|
         -> Result<
            (
                WorkspacePatchProposalSummary,
                WorkspacePatchApplyResultSummary,
            ),
            String,
        > {
            let mut result = apply_result;
            result
                .checklist
                .push(apply_result_check(check_name, "Fail", Some(reason)));
            result.apply_reason = reason.to_string();
            result.transaction_status = Some("Denied".to_string());
            record_apply_result(
                store,
                &task,
                &params.run_id,
                &proposal_id_for_result,
                result,
            )
        };
        if proposal.operation != WorkspacePatchOperation::ReplaceFile.as_str() {
            return deny_item(
                apply_result,
                "transaction_replace_file_only",
                "Transaction apply only supports replace_file proposals.",
            );
        }
        if proposal.validation_status != "Valid" {
            return deny_item(
                apply_result,
                "transaction_proposals_valid",
                "Every transaction proposal must have validation_status=Valid.",
            );
        }
        if proposal.approval_status != "Approved" {
            return deny_item(
                apply_result,
                "transaction_proposals_approved",
                "Every transaction proposal must be approved before apply.",
            );
        }
        if let Some(reason) = approval_current_failure_reason(proposal.approved_at.as_deref()) {
            return deny_item(apply_result, "transaction_approvals_current", reason);
        }
        if has_consumed_apply_authorization(&events, &item.proposal_id) {
            return deny_item(
                apply_result,
                "transaction_approvals_unconsumed",
                "A transaction proposal apply authorization has already been consumed.",
            );
        }
        if item.replacement_content.chars().count() > DEFAULT_MAX_WORKSPACE_WRITE_CONTENT_CHARS {
            return deny_item(
                apply_result,
                "transaction_replacement_content_bounded",
                "Replacement content exceeds the runtime write limit.",
            );
        }
        if scan_text_for_sensitive_content(&item.replacement_content) {
            return deny_item(
                apply_result,
                "transaction_replacement_content_sensitive_scan",
                "Replacement content contains sensitive-like data.",
            );
        }
        if item.replacement_content.chars().count() != proposal.content_chars
            || preview_with_limit(&item.replacement_content, DEFAULT_PROPOSAL_PREVIEW_CHARS)
                != proposal.content_preview
        {
            return deny_item(
                apply_result,
                "transaction_replacement_content_matches_proposal",
                "Replacement content does not match approved proposal metadata.",
            );
        }
        if proposal.diff_redacted
            || proposal.content_preview == "[redacted]"
            || proposal.diff_truncated
            || proposal.diff_preview.is_none()
        {
            return deny_item(
                apply_result,
                "transaction_proposal_diff_available",
                "Proposal diff must be available and untruncated for transaction apply.",
            );
        }
        let Some(expected_target_sha256) = item.expected_target_sha256.as_deref() else {
            return deny_item(
                apply_result,
                "transaction_expected_target_hashes_valid",
                "Every expected target hash must be provided.",
            );
        };
        if !is_sha256_fingerprint(expected_target_sha256) {
            return deny_item(
                apply_result,
                "transaction_expected_target_hashes_valid",
                "Every expected target hash must be a sha256 fingerprint.",
            );
        }
        let Some(previous_snapshot) = proposal.latest_snapshot.as_ref() else {
            return deny_item(
                apply_result,
                "transaction_latest_preflight_exists",
                "Run proposal.preflight for every transaction proposal before applying.",
            );
        };
        let current_snapshot =
            match capture_preflight_snapshot(store, &proposal, Some(previous_snapshot)) {
                Ok(snapshot) => snapshot,
                Err(_) => {
                    return deny_item(
                        apply_result,
                        "transaction_latest_preflight_validation",
                        "Latest preflight validation failed for a transaction proposal.",
                    )
                }
            };
        append_preflight_snapshot_event(store, &task, &current_snapshot)?;
        if current_snapshot.stale {
            return deny_item(
                apply_result,
                "transaction_latest_preflight_validation",
                "Latest preflight validation found a stale transaction target.",
            );
        }
        let target_path = match resolve_apply_target_path(store, &proposal) {
            Ok(path) => path,
            Err(reason) => return deny_item(apply_result, "transaction_target_path_safe", reason),
        };
        for seen_path in seen_paths.iter() {
            if seen_path == &proposal.path
                || seen_path.starts_with(&format!("{}/", proposal.path))
                || proposal.path.starts_with(&format!("{seen_path}/"))
            {
                return deny_item(
                    apply_result,
                    "transaction_target_paths_non_overlapping",
                    "Transaction target paths must be unique and non-overlapping.",
                );
            }
        }
        seen_paths.insert(proposal.path.clone());
        let current_bytes = std::fs::read(&target_path)
            .map_err(|_| "Target file could not be read before transaction apply.".to_string())?;
        let pre_write_hash = format!("sha256:{}", hex_sha256(&current_bytes));
        if current_snapshot.file_sha256.as_deref() != Some(pre_write_hash.as_str())
            || expected_target_sha256 != pre_write_hash
        {
            return deny_item(
                apply_result,
                "transaction_expected_target_hashes_match",
                "Expected target hash does not match current transaction target file.",
            );
        }
        let current_content = match std::str::from_utf8(&current_bytes) {
            Ok(content) => content,
            Err(_) => {
                return deny_item(
                    apply_result,
                    "transaction_targets_utf8",
                    "Every transaction target file must be UTF-8.",
                )
            }
        };
        if scan_text_for_sensitive_content(current_content) {
            return deny_item(
                apply_result,
                "transaction_targets_sensitive_scan",
                "A transaction target file contains sensitive-like data.",
            );
        }
        let current_diff =
            synthetic_unified_diff(&proposal.path, current_content, &item.replacement_content);
        if proposal.diff_preview.as_deref() != Some(current_diff.as_str()) {
            return deny_item(
                apply_result,
                "transaction_approved_diffs_match_current_targets",
                "Approved diff does not match a current transaction target and replacement content.",
            );
        }
        let content_chars = item.replacement_content.chars().count();
        let replacement_bytes = item.replacement_content.as_bytes().to_vec();
        let content_bytes = replacement_bytes.len() as u64;
        apply_result.content_chars += content_chars;
        apply_result.content_bytes += content_bytes;
        prepared_items.push(PreparedReplaceTransactionItem {
            proposal_id: item.proposal_id.clone(),
            operation: proposal.operation,
            path: proposal.path,
            target_path,
            expected_target_sha256: expected_target_sha256.to_string(),
            pre_write_target_sha256: pre_write_hash,
            replacement_bytes,
            content_chars,
            content_bytes,
        });
    }
    apply_result.checklist.push(apply_result_check(
        "transaction_admission_all_items_passed",
        "Pass",
        None,
    ));

    let mut prepared_replacements = Vec::new();
    for item in &prepared_items {
        let prepared =
            prepare_atomic_replace_existing_file(&item.target_path, &item.replacement_bytes);
        if let Some(prepared) = prepared.prepared {
            prepared_replacements.push(prepared);
            continue;
        }
        let reason = prepared
            .failure_reason
            .unwrap_or("Temporary sibling file preparation failed.");
        for replacement in prepared_replacements {
            apply_result.temp_file_cleaned = apply_result.temp_file_cleaned
                && cleanup_atomic_replace_temp(&replacement.temp_path);
        }
        apply_result.transaction_items.push(transaction_item_result(
            item,
            "Failed",
            reason,
            None,
            false,
            false,
            prepared.temp_file_cleaned,
        ));
        apply_result.apply_status = "Failed".to_string();
        apply_result.apply_reason = reason.to_string();
        apply_result.transaction_status = Some("Failed".to_string());
        apply_result.checklist.push(apply_result_check(
            "transaction_temporary_sibling_files_created",
            "Fail",
            Some(reason),
        ));
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &proposal_id_for_result,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "transaction_temporary_sibling_files_created",
        "Pass",
        None,
    ));

    for (item, prepared_replacement) in prepared_items.iter().zip(prepared_replacements) {
        let expected_post_write_hash = format!("sha256:{}", hex_sha256(&item.replacement_bytes));
        let outcome = commit_prepared_atomic_replace(prepared_replacement, &item.target_path);
        apply_result.temp_file_cleaned =
            apply_result.temp_file_cleaned && outcome.temp_file_cleaned;
        if let Some(reason) = outcome.failure_reason {
            apply_result.transaction_items.push(transaction_item_result(
                item,
                "Failed",
                reason,
                outcome.post_write_sha256,
                outcome.atomic_replacement_completed,
                false,
                outcome.temp_file_cleaned,
            ));
            apply_result.apply_status = "Failed".to_string();
            apply_result.apply_reason = reason.to_string();
            apply_result.transaction_status = Some("PartialFailed".to_string());
            apply_result.checklist.push(apply_result_check(
                "transaction_atomic_replacements_completed",
                "Fail",
                Some(reason),
            ));
            return record_apply_result(
                store,
                &task,
                &params.run_id,
                &proposal_id_for_result,
                apply_result,
            );
        }
        if outcome.post_write_sha256.as_deref() != Some(expected_post_write_hash.as_str()) {
            apply_result.transaction_items.push(transaction_item_result(
                item,
                "Failed",
                "Post-write SHA-256 does not match replacement content.",
                outcome.post_write_sha256,
                outcome.atomic_replacement_completed,
                false,
                outcome.temp_file_cleaned,
            ));
            apply_result.apply_status = "Failed".to_string();
            apply_result.apply_reason =
                "Post-write SHA-256 does not match replacement content.".to_string();
            apply_result.transaction_status = Some("PartialFailed".to_string());
            apply_result.checklist.push(apply_result_check(
                "transaction_post_write_sha256_verified",
                "Fail",
                Some("Post-write SHA-256 does not match replacement content."),
            ));
            return record_apply_result(
                store,
                &task,
                &params.run_id,
                &proposal_id_for_result,
                apply_result,
            );
        }
        apply_result.transaction_items.push(transaction_item_result(
            item,
            "Applied",
            "File replaced and post-write SHA-256 verified.",
            outcome.post_write_sha256.clone(),
            outcome.atomic_replacement_completed,
            true,
            outcome.temp_file_cleaned,
        ));
    }
    apply_result.checklist.push(apply_result_check(
        "transaction_atomic_replacements_completed",
        "Pass",
        None,
    ));
    apply_result.checklist.push(apply_result_check(
        "transaction_post_write_sha256_verified",
        "Pass",
        None,
    ));
    apply_result.apply_status = "Applied".to_string();
    apply_result.apply_reason =
        "Transaction applied and all post-write SHA-256 values verified.".to_string();
    apply_result.transaction_status = Some("Applied".to_string());
    apply_result.atomic_replacement_completed = true;
    apply_result.authorization_consumed = true;
    apply_result.applied = true;
    apply_result.applied_at = Some(now_rfc3339());
    record_apply_result(
        store,
        &task,
        &params.run_id,
        &proposal_id_for_result,
        apply_result,
    )
    .map(|(_, result)| (first_proposal, result))
}

fn apply_create_file_transaction(
    store: &BrownieStore,
    params: &ProposalApplyParams,
) -> Result<
    (
        WorkspacePatchProposalSummary,
        WorkspacePatchApplyResultSummary,
    ),
    String,
> {
    let task = store
        .tasks()
        .get_task_by_run_id(&params.run_id)
        .map_err(|e| format!("invalid params: {e}"))?
        .ok_or_else(|| "invalid params: run not found".to_string())?;
    let items = params
        .transaction_items
        .as_ref()
        .ok_or_else(|| "invalid params: transaction_items are required".to_string())?;
    let proposal_id_for_result = fallback_transaction_proposal_id(params);
    let first_proposal = inspect_proposal(store, &params.run_id, &proposal_id_for_result)?;
    let mut apply_result = WorkspacePatchApplyResultSummary {
        proposal_id: proposal_id_for_result.clone(),
        apply_id: format!("apply_{}", uuid::Uuid::new_v4().simple()),
        apply_status: "Denied".to_string(),
        apply_reason: "Create-file transaction apply preconditions were not satisfied.".to_string(),
        authorization_id: format!("apply_tx_auth_{}", uuid::Uuid::new_v4().simple()),
        authorization_consumed: false,
        applied: false,
        operation: "create_file_transaction".to_string(),
        atomic_replacement_completed: false,
        atomic_create_completed: false,
        atomic_delete_completed: false,
        path: "[transaction]".to_string(),
        expected_target_sha256: None,
        expected_target_absent: Some(true),
        pre_write_target_sha256: None,
        pre_write_target_exists: None,
        post_write_sha256: None,
        post_delete_target_exists: None,
        content_chars: 0,
        content_bytes: 0,
        checked_at: now_rfc3339(),
        applied_at: None,
        temp_file_cleaned: true,
        check_count: 0,
        failed_checks: Vec::new(),
        blocked_checks: Vec::new(),
        checklist: vec![apply_result_check(
            "transaction_request_present",
            "Pass",
            None,
        )],
        transaction_id: Some(format!("apply_tx_{}", uuid::Uuid::new_v4().simple())),
        transaction_status: Some("Denied".to_string()),
        transaction_items: Vec::new(),
        transaction_recovery_source: None,
        transaction_recovery_status: None,
    };

    let deny = |mut result: WorkspacePatchApplyResultSummary,
                check_name: &str,
                reason: &str|
     -> Result<
        (
            WorkspacePatchProposalSummary,
            WorkspacePatchApplyResultSummary,
        ),
        String,
    > {
        result
            .checklist
            .push(apply_result_check(check_name, "Fail", Some(reason)));
        result.apply_reason = reason.to_string();
        result.transaction_status = Some("Denied".to_string());
        record_apply_result(
            store,
            &task,
            &params.run_id,
            &proposal_id_for_result,
            result,
        )
        .map(|(_, result)| (first_proposal.clone(), result))
    };

    if !params.authorize {
        return deny(
            apply_result,
            "one_time_transaction_authorization",
            "Transaction apply request must explicitly set authorize=true.",
        );
    }
    apply_result.checklist.push(apply_result_check(
        "one_time_transaction_authorization",
        "Pass",
        None,
    ));
    if !append_apply_write_permission_check(store, &task, &mut apply_result)? {
        apply_result.transaction_status = Some("Denied".to_string());
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &proposal_id_for_result,
            apply_result,
        )
        .map(|(_, result)| (first_proposal, result));
    }

    if !(2..=5).contains(&items.len()) {
        return deny(
            apply_result,
            "transaction_item_count_bounded",
            "Create-file transaction apply requires between two and five items.",
        );
    }
    apply_result.checklist.push(apply_result_check(
        "transaction_item_count_bounded",
        "Pass",
        None,
    ));

    let events = read_existing_run_events(store, &params.run_id)?;
    let mut seen_proposals = BTreeSet::new();
    let mut seen_paths: BTreeSet<String> = BTreeSet::new();
    let mut prepared_items = Vec::new();

    for item in items {
        if item.proposal_id.trim().is_empty() || !seen_proposals.insert(item.proposal_id.clone()) {
            return deny(
                apply_result,
                "transaction_proposal_ids_unique",
                "Transaction item proposal_id values must be non-empty and unique.",
            );
        }
        if item.expected_target_absent != Some(true) {
            return deny(
                apply_result,
                "transaction_expected_target_absent_confirmed",
                "Every create-file transaction item requires expected_target_absent=true.",
            );
        }
        if item.expected_target_sha256.is_some() {
            return deny(
                apply_result,
                "transaction_create_target_hash_omitted",
                "Create-file transaction items must omit expected_target_sha256.",
            );
        }
        let proposal = inspect_proposal(store, &params.run_id, &item.proposal_id)?;
        if proposal.operation != WorkspacePatchOperation::CreateFile.as_str() {
            return deny(
                apply_result,
                "transaction_create_file_only",
                "Create-file transaction apply only supports create_file proposals.",
            );
        }
        if proposal.validation_status != "Valid" {
            return deny(
                apply_result,
                "transaction_proposals_valid",
                "Every transaction proposal must have validation_status=Valid.",
            );
        }
        if proposal.approval_status != "Approved" {
            return deny(
                apply_result,
                "transaction_proposals_approved",
                "Every transaction proposal must be approved before apply.",
            );
        }
        if let Some(reason) = approval_current_failure_reason(proposal.approved_at.as_deref()) {
            return deny(apply_result, "transaction_approvals_current", reason);
        }
        if has_consumed_apply_authorization(&events, &item.proposal_id) {
            return deny(
                apply_result,
                "transaction_approvals_unconsumed",
                "A transaction proposal apply authorization has already been consumed.",
            );
        }
        if item.replacement_content.chars().count() > DEFAULT_MAX_WORKSPACE_WRITE_CONTENT_CHARS {
            return deny(
                apply_result,
                "transaction_replacement_content_bounded",
                "Replacement content exceeds the runtime write limit.",
            );
        }
        if scan_text_for_sensitive_content(&item.replacement_content) {
            return deny(
                apply_result,
                "transaction_replacement_content_sensitive_scan",
                "Replacement content contains sensitive-like data.",
            );
        }
        if item.replacement_content.chars().count() != proposal.content_chars
            || preview_with_limit(&item.replacement_content, DEFAULT_PROPOSAL_PREVIEW_CHARS)
                != proposal.content_preview
        {
            return deny(
                apply_result,
                "transaction_replacement_content_matches_proposal",
                "Replacement content does not match approved proposal metadata.",
            );
        }
        if proposal.diff_redacted
            || proposal.content_preview == "[redacted]"
            || proposal.diff_truncated
            || proposal.diff_preview.is_none()
        {
            return deny(
                apply_result,
                "transaction_proposal_diff_available",
                "Proposal diff must be available and untruncated for transaction apply.",
            );
        }
        let Some(previous_snapshot) = proposal.latest_snapshot.as_ref() else {
            return deny(
                apply_result,
                "transaction_latest_preflight_exists",
                "Run proposal.preflight for every transaction proposal before applying.",
            );
        };
        let current_snapshot =
            match capture_preflight_snapshot(store, &proposal, Some(previous_snapshot)) {
                Ok(snapshot) => snapshot,
                Err(_) => {
                    return deny(
                        apply_result,
                        "transaction_latest_preflight_validation",
                        "Latest preflight validation failed for a transaction proposal.",
                    )
                }
            };
        append_preflight_snapshot_event(store, &task, &current_snapshot)?;
        if current_snapshot.stale {
            return deny(
                apply_result,
                "transaction_latest_preflight_validation",
                "Latest preflight validation found a stale transaction target.",
            );
        }
        if current_snapshot.file_exists {
            return deny(
                apply_result,
                "transaction_targets_absent_current",
                "A create-file transaction target already exists.",
            );
        }
        let target_path = match resolve_create_apply_target_path(store, &proposal) {
            Ok(path) => path,
            Err(reason) => return deny(apply_result, "transaction_target_path_safe", reason),
        };
        for seen_path in seen_paths.iter() {
            if seen_path == &proposal.path
                || seen_path.starts_with(&format!("{}/", proposal.path))
                || proposal.path.starts_with(&format!("{seen_path}/"))
            {
                return deny(
                    apply_result,
                    "transaction_target_paths_non_overlapping",
                    "Transaction target paths must be unique and non-overlapping.",
                );
            }
        }
        seen_paths.insert(proposal.path.clone());
        let create_diff = synthetic_unified_diff(&proposal.path, "", &item.replacement_content);
        if proposal.diff_preview.as_deref() != Some(create_diff.as_str()) {
            return deny(
                apply_result,
                "transaction_approved_diffs_match_absent_targets",
                "Approved diff does not match an absent transaction target and replacement content.",
            );
        }
        let content_chars = item.replacement_content.chars().count();
        let replacement_bytes = item.replacement_content.as_bytes().to_vec();
        let content_bytes = replacement_bytes.len() as u64;
        apply_result.content_chars += content_chars;
        apply_result.content_bytes += content_bytes;
        prepared_items.push(PreparedCreateTransactionItem {
            proposal_id: item.proposal_id.clone(),
            operation: proposal.operation,
            path: proposal.path,
            target_path,
            replacement_bytes,
            content_chars,
            content_bytes,
        });
    }
    apply_result.checklist.push(apply_result_check(
        "transaction_admission_all_items_passed",
        "Pass",
        None,
    ));

    let mut prepared_creates = Vec::new();
    for item in &prepared_items {
        let prepared = prepare_atomic_create_new_file(&item.target_path, &item.replacement_bytes);
        if let Some(prepared) = prepared.prepared {
            prepared_creates.push(prepared);
            continue;
        }
        let reason = prepared
            .failure_reason
            .unwrap_or("Temporary sibling file preparation failed.");
        apply_result
            .transaction_items
            .push(create_transaction_item_result(
                item,
                "Failed",
                reason,
                None,
                false,
                false,
                prepared.temp_file_cleaned,
            ));
        apply_result.apply_status = "Failed".to_string();
        apply_result.apply_reason = reason.to_string();
        apply_result.transaction_status = Some("Failed".to_string());
        apply_result.checklist.push(apply_result_check(
            "transaction_temporary_sibling_files_created",
            "Fail",
            Some(reason),
        ));
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &proposal_id_for_result,
            apply_result,
        )
        .map(|(_, result)| (first_proposal, result));
    }
    apply_result.checklist.push(apply_result_check(
        "transaction_temporary_sibling_files_created",
        "Pass",
        None,
    ));

    for (item, prepared_create) in prepared_items.iter().zip(prepared_creates) {
        let expected_post_write_hash = format!("sha256:{}", hex_sha256(&item.replacement_bytes));
        let outcome = commit_prepared_atomic_create(prepared_create);
        apply_result.temp_file_cleaned =
            apply_result.temp_file_cleaned && outcome.temp_file_cleaned;
        if let Some(reason) = outcome.failure_reason {
            apply_result
                .transaction_items
                .push(create_transaction_item_result(
                    item,
                    if reason == "Target path already exists." {
                        "Denied"
                    } else {
                        "Failed"
                    },
                    reason,
                    outcome.post_write_sha256,
                    outcome.atomic_create_completed,
                    false,
                    outcome.temp_file_cleaned,
                ));
            apply_result.apply_status = if reason == "Target path already exists." {
                "Denied".to_string()
            } else {
                "Failed".to_string()
            };
            apply_result.apply_reason = reason.to_string();
            apply_result.transaction_status = Some(if apply_result.transaction_items.len() > 1 {
                "PartialFailed".to_string()
            } else {
                apply_result.apply_status.clone()
            });
            apply_result.checklist.push(apply_result_check(
                "transaction_atomic_creates_completed",
                "Fail",
                Some(reason),
            ));
            return record_apply_result(
                store,
                &task,
                &params.run_id,
                &proposal_id_for_result,
                apply_result,
            )
            .map(|(_, result)| (first_proposal, result));
        }
        if outcome.post_write_sha256.as_deref() != Some(expected_post_write_hash.as_str()) {
            apply_result
                .transaction_items
                .push(create_transaction_item_result(
                    item,
                    "Failed",
                    "Post-write SHA-256 does not match replacement content.",
                    outcome.post_write_sha256,
                    outcome.atomic_create_completed,
                    false,
                    outcome.temp_file_cleaned,
                ));
            apply_result.apply_status = "Failed".to_string();
            apply_result.apply_reason =
                "Post-write SHA-256 does not match replacement content.".to_string();
            apply_result.transaction_status = Some("PartialFailed".to_string());
            apply_result.checklist.push(apply_result_check(
                "transaction_post_write_sha256_verified",
                "Fail",
                Some("Post-write SHA-256 does not match replacement content."),
            ));
            return record_apply_result(
                store,
                &task,
                &params.run_id,
                &proposal_id_for_result,
                apply_result,
            )
            .map(|(_, result)| (first_proposal, result));
        }
        apply_result
            .transaction_items
            .push(create_transaction_item_result(
                item,
                "Applied",
                "File created and post-write SHA-256 verified.",
                outcome.post_write_sha256.clone(),
                outcome.atomic_create_completed,
                true,
                outcome.temp_file_cleaned,
            ));
    }
    apply_result.checklist.push(apply_result_check(
        "transaction_atomic_creates_completed",
        "Pass",
        None,
    ));
    apply_result.checklist.push(apply_result_check(
        "transaction_post_write_sha256_verified",
        "Pass",
        None,
    ));
    apply_result.apply_status = "Applied".to_string();
    apply_result.apply_reason =
        "Create-file transaction applied and all post-write SHA-256 values verified.".to_string();
    apply_result.transaction_status = Some("Applied".to_string());
    apply_result.atomic_create_completed = true;
    apply_result.authorization_consumed = true;
    apply_result.applied = true;
    apply_result.applied_at = Some(now_rfc3339());
    record_apply_result(
        store,
        &task,
        &params.run_id,
        &proposal_id_for_result,
        apply_result,
    )
    .map(|(_, result)| (first_proposal, result))
}

fn apply_delete_file_transaction(
    store: &BrownieStore,
    params: &ProposalApplyParams,
) -> Result<
    (
        WorkspacePatchProposalSummary,
        WorkspacePatchApplyResultSummary,
    ),
    String,
> {
    let task = store
        .tasks()
        .get_task_by_run_id(&params.run_id)
        .map_err(|e| format!("invalid params: {e}"))?
        .ok_or_else(|| "invalid params: run not found".to_string())?;
    let items = params
        .transaction_items
        .as_ref()
        .ok_or_else(|| "invalid params: transaction_items are required".to_string())?;
    let proposal_id_for_result = fallback_transaction_proposal_id(params);
    let first_proposal = inspect_proposal(store, &params.run_id, &proposal_id_for_result)?;
    let mut apply_result = WorkspacePatchApplyResultSummary {
        proposal_id: proposal_id_for_result.clone(),
        apply_id: format!("apply_{}", uuid::Uuid::new_v4().simple()),
        apply_status: "Denied".to_string(),
        apply_reason: "Delete-file transaction apply preconditions were not satisfied.".to_string(),
        authorization_id: format!("apply_tx_auth_{}", uuid::Uuid::new_v4().simple()),
        authorization_consumed: false,
        applied: false,
        operation: "delete_file_transaction".to_string(),
        atomic_replacement_completed: false,
        atomic_create_completed: false,
        atomic_delete_completed: false,
        path: "[transaction]".to_string(),
        expected_target_sha256: None,
        expected_target_absent: None,
        pre_write_target_sha256: None,
        pre_write_target_exists: None,
        post_write_sha256: None,
        post_delete_target_exists: None,
        content_chars: 0,
        content_bytes: 0,
        checked_at: now_rfc3339(),
        applied_at: None,
        temp_file_cleaned: true,
        check_count: 0,
        failed_checks: Vec::new(),
        blocked_checks: Vec::new(),
        checklist: vec![apply_result_check(
            "transaction_request_present",
            "Pass",
            None,
        )],
        transaction_id: Some(format!("apply_tx_{}", uuid::Uuid::new_v4().simple())),
        transaction_status: Some("Denied".to_string()),
        transaction_items: Vec::new(),
        transaction_recovery_source: None,
        transaction_recovery_status: None,
    };

    let deny = |mut result: WorkspacePatchApplyResultSummary,
                check_name: &str,
                reason: &str|
     -> Result<
        (
            WorkspacePatchProposalSummary,
            WorkspacePatchApplyResultSummary,
        ),
        String,
    > {
        result
            .checklist
            .push(apply_result_check(check_name, "Fail", Some(reason)));
        result.apply_reason = reason.to_string();
        result.transaction_status = Some("Denied".to_string());
        record_apply_result(
            store,
            &task,
            &params.run_id,
            &proposal_id_for_result,
            result,
        )
        .map(|(_, result)| (first_proposal.clone(), result))
    };

    if !params.authorize {
        return deny(
            apply_result,
            "one_time_transaction_authorization",
            "Transaction apply request must explicitly set authorize=true.",
        );
    }
    apply_result.checklist.push(apply_result_check(
        "one_time_transaction_authorization",
        "Pass",
        None,
    ));
    if !append_apply_write_permission_check(store, &task, &mut apply_result)? {
        apply_result.transaction_status = Some("Denied".to_string());
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &proposal_id_for_result,
            apply_result,
        )
        .map(|(_, result)| (first_proposal, result));
    }

    if !(2..=5).contains(&items.len()) {
        return deny(
            apply_result,
            "transaction_item_count_bounded",
            "Delete-file transaction apply requires between two and five items.",
        );
    }
    apply_result.checklist.push(apply_result_check(
        "transaction_item_count_bounded",
        "Pass",
        None,
    ));

    let events = read_existing_run_events(store, &params.run_id)?;
    let mut seen_proposals = BTreeSet::new();
    let mut seen_paths: BTreeSet<String> = BTreeSet::new();
    let mut prepared_items = Vec::new();

    for item in items {
        if item.proposal_id.trim().is_empty() || !seen_proposals.insert(item.proposal_id.clone()) {
            return deny(
                apply_result,
                "transaction_proposal_ids_unique",
                "Transaction item proposal_id values must be non-empty and unique.",
            );
        }
        if !item.replacement_content.is_empty() {
            return deny(
                apply_result,
                "transaction_replacement_content_omitted_for_delete",
                "Delete-file transaction items must use empty replacement_content.",
            );
        }
        if item.expected_target_absent.is_some() {
            return deny(
                apply_result,
                "transaction_delete_target_absence_omitted",
                "Delete-file transaction items must omit expected_target_absent.",
            );
        }

        let proposal = inspect_proposal(store, &params.run_id, &item.proposal_id)?;
        if proposal.operation != WorkspacePatchOperation::DeleteFile.as_str() {
            return deny(
                apply_result,
                "transaction_delete_file_only",
                "Delete-file transaction apply only supports delete_file proposals.",
            );
        }
        if proposal.validation_status != "Valid" {
            return deny(
                apply_result,
                "transaction_proposals_valid",
                "Every transaction proposal must have validation_status=Valid.",
            );
        }
        if proposal.approval_status != "Approved" {
            return deny(
                apply_result,
                "transaction_proposals_approved",
                "Every transaction proposal must be approved before apply.",
            );
        }
        if let Some(reason) = approval_current_failure_reason(proposal.approved_at.as_deref()) {
            return deny(apply_result, "transaction_approvals_current", reason);
        }
        if has_consumed_apply_authorization(&events, &item.proposal_id) {
            return deny(
                apply_result,
                "transaction_approvals_unconsumed",
                "A transaction proposal apply authorization has already been consumed.",
            );
        }
        if proposal.content_chars != 0 || !proposal.content_preview.is_empty() {
            return deny(
                apply_result,
                "transaction_delete_proposal_has_no_replacement_content",
                "Delete-file proposals must not carry replacement content metadata.",
            );
        }
        if proposal.diff_redacted
            || proposal.content_preview == "[redacted]"
            || proposal.diff_truncated
            || proposal.diff_preview.is_none()
        {
            return deny(
                apply_result,
                "transaction_proposal_diff_available",
                "Proposal diff must be available and untruncated for transaction apply.",
            );
        }
        let Some(expected_target_sha256) = item.expected_target_sha256.as_deref() else {
            return deny(
                apply_result,
                "transaction_expected_target_hashes_valid",
                "Every expected target hash must be provided.",
            );
        };
        if !is_sha256_fingerprint(expected_target_sha256) {
            return deny(
                apply_result,
                "transaction_expected_target_hashes_valid",
                "Every expected target hash must be a sha256 fingerprint.",
            );
        }
        let Some(previous_snapshot) = proposal.latest_snapshot.as_ref() else {
            return deny(
                apply_result,
                "transaction_latest_preflight_exists",
                "Run proposal.preflight for every transaction proposal before applying.",
            );
        };
        let current_snapshot =
            match capture_preflight_snapshot(store, &proposal, Some(previous_snapshot)) {
                Ok(snapshot) => snapshot,
                Err(_) => {
                    return deny(
                        apply_result,
                        "transaction_latest_preflight_validation",
                        "Latest preflight validation failed for a transaction proposal.",
                    )
                }
            };
        append_preflight_snapshot_event(store, &task, &current_snapshot)?;
        if current_snapshot.stale {
            return deny(
                apply_result,
                "transaction_latest_preflight_validation",
                "Latest preflight validation found a stale transaction target.",
            );
        }
        if !current_snapshot.file_exists {
            return deny(
                apply_result,
                "transaction_target_file_exists",
                "Every delete-file transaction target must exist.",
            );
        }
        if current_snapshot.file_kind == "Symlink" {
            return deny(
                apply_result,
                "transaction_target_file_not_symlink",
                "Every delete-file transaction target must not be a symlink.",
            );
        }
        if current_snapshot.file_kind != "File" {
            return deny(
                apply_result,
                "transaction_target_file_regular",
                "Every delete-file transaction target must be a regular file.",
            );
        }
        let target_path = match resolve_apply_target_path(store, &proposal) {
            Ok(path) => path,
            Err(reason) => return deny(apply_result, "transaction_target_path_safe", reason),
        };
        for seen_path in seen_paths.iter() {
            if seen_path == &proposal.path
                || seen_path.starts_with(&format!("{}/", proposal.path))
                || proposal.path.starts_with(&format!("{seen_path}/"))
            {
                return deny(
                    apply_result,
                    "transaction_target_paths_non_overlapping",
                    "Transaction target paths must be unique and non-overlapping.",
                );
            }
        }
        seen_paths.insert(proposal.path.clone());
        let current_bytes = std::fs::read(&target_path)
            .map_err(|_| "Target file could not be read before transaction apply.".to_string())?;
        let pre_write_hash = format!("sha256:{}", hex_sha256(&current_bytes));
        if current_snapshot.file_sha256.as_deref() != Some(pre_write_hash.as_str())
            || expected_target_sha256 != pre_write_hash
        {
            return deny(
                apply_result,
                "transaction_expected_target_hashes_match",
                "Expected target hash does not match current transaction target file.",
            );
        }
        let current_content = match std::str::from_utf8(&current_bytes) {
            Ok(content) => content,
            Err(_) => {
                return deny(
                    apply_result,
                    "transaction_targets_utf8",
                    "Every transaction target file must be UTF-8.",
                )
            }
        };
        if scan_text_for_sensitive_content(current_content) {
            return deny(
                apply_result,
                "transaction_targets_sensitive_scan",
                "A transaction target file contains sensitive-like data.",
            );
        }
        let current_diff = synthetic_unified_diff(&proposal.path, current_content, "");
        if proposal.diff_preview.as_deref() != Some(current_diff.as_str()) {
            return deny(
                apply_result,
                "transaction_approved_diffs_match_current_targets",
                "Approved diff does not match a current transaction target deletion.",
            );
        }
        prepared_items.push(PreparedDeleteTransactionItem {
            proposal_id: item.proposal_id.clone(),
            operation: proposal.operation,
            path: proposal.path,
            target_path,
            expected_target_sha256: expected_target_sha256.to_string(),
            pre_write_target_sha256: pre_write_hash,
        });
    }
    apply_result.checklist.push(apply_result_check(
        "transaction_admission_all_items_passed",
        "Pass",
        None,
    ));

    for item in &prepared_items {
        let outcome = atomic_delete_existing_file(&item.target_path);
        apply_result.atomic_delete_completed =
            apply_result.atomic_delete_completed || outcome.atomic_delete_completed;
        apply_result.post_delete_target_exists = outcome.post_delete_target_exists;
        if let Some(reason) = outcome.failure_reason {
            apply_result
                .transaction_items
                .push(delete_transaction_item_result(
                    item,
                    "Failed",
                    reason,
                    outcome.post_delete_target_exists,
                    outcome.atomic_delete_completed,
                    false,
                    true,
                ));
            apply_result.apply_status = "Failed".to_string();
            apply_result.apply_reason = reason.to_string();
            apply_result.transaction_status = Some(if apply_result.transaction_items.len() > 1 {
                "PartialFailed".to_string()
            } else {
                "Failed".to_string()
            });
            apply_result.checklist.push(apply_result_check(
                "transaction_atomic_deletes_completed",
                "Fail",
                Some(reason),
            ));
            return record_apply_result(
                store,
                &task,
                &params.run_id,
                &proposal_id_for_result,
                apply_result,
            )
            .map(|(_, result)| (first_proposal, result));
        }
        apply_result
            .transaction_items
            .push(delete_transaction_item_result(
                item,
                "Applied",
                "File deleted and post-delete absence verified.",
                outcome.post_delete_target_exists,
                outcome.atomic_delete_completed,
                true,
                true,
            ));
    }
    apply_result.checklist.push(apply_result_check(
        "transaction_atomic_deletes_completed",
        "Pass",
        None,
    ));
    apply_result.checklist.push(apply_result_check(
        "transaction_post_delete_absence_verified",
        "Pass",
        None,
    ));
    apply_result.apply_status = "Applied".to_string();
    apply_result.apply_reason =
        "Delete-file transaction applied and all post-delete absence checks passed.".to_string();
    apply_result.transaction_status = Some("Applied".to_string());
    apply_result.atomic_delete_completed = true;
    apply_result.post_delete_target_exists = Some(false);
    apply_result.authorization_consumed = true;
    apply_result.applied = true;
    apply_result.applied_at = Some(now_rfc3339());
    record_apply_result(
        store,
        &task,
        &params.run_id,
        &proposal_id_for_result,
        apply_result,
    )
    .map(|(_, result)| (first_proposal, result))
}

pub(super) fn apply_proposal(
    store: &BrownieStore,
    params: &ProposalApplyParams,
) -> Result<
    (
        WorkspacePatchProposalSummary,
        WorkspacePatchApplyResultSummary,
    ),
    String,
> {
    if params.transaction_recovery_source.is_some() {
        if params.transaction_items.is_some() {
            let operations = transaction_proposal_operations(store, params)?;
            if operations.len() == 1
                && operations.contains(WorkspacePatchOperation::CreateFile.as_str())
            {
                return apply_create_file_transaction_recovery(store, params);
            }
            if operations.len() == 1
                && operations.contains(WorkspacePatchOperation::DeleteFile.as_str())
            {
                return apply_delete_file_transaction_recovery(store, params);
            }
        }
        return apply_replace_file_transaction_recovery(store, params);
    }
    if params.transaction_items.is_some() {
        let operations = transaction_proposal_operations(store, params)?;
        if operations.len() == 1
            && operations.contains(WorkspacePatchOperation::CreateFile.as_str())
        {
            return apply_create_file_transaction(store, params);
        }
        if operations.len() == 1
            && operations.contains(WorkspacePatchOperation::DeleteFile.as_str())
        {
            return apply_delete_file_transaction(store, params);
        }
        return apply_replace_file_transaction(store, params);
    }

    let task = store
        .tasks()
        .get_task_by_run_id(&params.run_id)
        .map_err(|e| format!("invalid params: {e}"))?
        .ok_or_else(|| "invalid params: run not found".to_string())?;
    let proposal = inspect_proposal(store, &params.run_id, &params.proposal_id)?;
    let apply_id = format!("apply_{}", uuid::Uuid::new_v4().simple());
    let authorization_id = format!("apply_auth_{}", uuid::Uuid::new_v4().simple());
    let checked_at = now_rfc3339();
    let operation = proposal.operation.clone();
    let replacement_content_for_counts = params.replacement_content.as_deref().unwrap_or("");
    let content_chars = if operation == WorkspacePatchOperation::DeleteFile.as_str() {
        0
    } else if operation == WorkspacePatchOperation::PatchFile.as_str() {
        params.patch_hunks.as_ref().map_or_else(
            || {
                params
                    .patch_old_text
                    .as_deref()
                    .unwrap_or("")
                    .chars()
                    .count()
                    + params
                        .patch_new_text
                        .as_deref()
                        .unwrap_or("")
                        .chars()
                        .count()
            },
            |hunks| {
                hunks
                    .iter()
                    .map(|hunk| hunk.old_text.chars().count() + hunk.new_text.chars().count())
                    .sum()
            },
        )
    } else {
        replacement_content_for_counts.chars().count()
    };
    let content_bytes = if operation == WorkspacePatchOperation::DeleteFile.as_str() {
        0
    } else if operation == WorkspacePatchOperation::PatchFile.as_str() {
        params.patch_hunks.as_ref().map_or_else(
            || {
                params
                    .patch_old_text
                    .as_deref()
                    .unwrap_or("")
                    .as_bytes()
                    .len() as u64
                    + params
                        .patch_new_text
                        .as_deref()
                        .unwrap_or("")
                        .as_bytes()
                        .len() as u64
            },
            |hunks| {
                hunks
                    .iter()
                    .map(|hunk| {
                        hunk.old_text.as_bytes().len() as u64
                            + hunk.new_text.as_bytes().len() as u64
                    })
                    .sum()
            },
        )
    } else {
        replacement_content_for_counts.as_bytes().len() as u64
    };
    let mut apply_result = WorkspacePatchApplyResultSummary {
        proposal_id: params.proposal_id.clone(),
        apply_id,
        apply_status: "Denied".to_string(),
        apply_reason: "Apply preconditions were not satisfied.".to_string(),
        authorization_id,
        authorization_consumed: false,
        applied: false,
        operation: operation.clone(),
        atomic_replacement_completed: false,
        atomic_create_completed: false,
        atomic_delete_completed: false,
        path: proposal.path.clone(),
        expected_target_sha256: params.expected_target_sha256.clone(),
        expected_target_absent: params.expected_target_absent,
        pre_write_target_sha256: None,
        pre_write_target_exists: None,
        post_write_sha256: None,
        post_delete_target_exists: None,
        content_chars,
        content_bytes,
        checked_at,
        applied_at: None,
        temp_file_cleaned: true,
        check_count: 0,
        failed_checks: Vec::new(),
        blocked_checks: Vec::new(),
        checklist: vec![apply_result_check("proposal_exists", "Pass", None)],
        transaction_id: None,
        transaction_status: None,
        transaction_items: Vec::new(),
        transaction_recovery_source: None,
        transaction_recovery_status: None,
    };

    if !params.authorize {
        apply_result.checklist.push(apply_result_check(
            "one_time_apply_authorization",
            "Fail",
            Some("Apply request must explicitly set authorize=true."),
        ));
        apply_result.apply_reason =
            "Apply request did not include explicit authorization.".to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "one_time_apply_authorization",
        "Pass",
        None,
    ));
    if !append_apply_write_permission_check(store, &task, &mut apply_result)? {
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }

    if operation != WorkspacePatchOperation::ReplaceFile.as_str()
        && operation != WorkspacePatchOperation::CreateFile.as_str()
        && operation != WorkspacePatchOperation::DeleteFile.as_str()
        && operation != WorkspacePatchOperation::PatchFile.as_str()
    {
        apply_result.checklist.push(apply_result_check(
            "supported_operation",
            "Fail",
            Some("Only replace_file, create_file, delete_file, and patch_file proposals can be applied."),
        ));
        apply_result.apply_reason = "Proposal operation is not supported.".to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result
        .checklist
        .push(apply_result_check("supported_operation", "Pass", None));

    if proposal.validation_status == "Blocked" {
        apply_result.checklist.push(apply_result_check(
            "proposal_is_valid",
            "Blocked",
            proposal.validation_reason.as_deref(),
        ));
        apply_result.apply_status = "Denied".to_string();
        apply_result.apply_reason =
            "Proposal validation is blocked by sensitive-like content.".to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    if proposal.validation_status != "Valid" {
        apply_result.checklist.push(apply_result_check(
            "proposal_is_valid",
            "Fail",
            proposal.validation_reason.as_deref(),
        ));
        apply_result.apply_reason = "Proposal validation status is not Valid.".to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result
        .checklist
        .push(apply_result_check("proposal_is_valid", "Pass", None));

    if proposal.approval_status != "Approved" {
        apply_result.checklist.push(apply_result_check(
            "proposal_is_approved",
            "Fail",
            Some("Proposal must be approved before apply."),
        ));
        apply_result.apply_reason = "Proposal is not approved.".to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result
        .checklist
        .push(apply_result_check("proposal_is_approved", "Pass", None));

    if let Some(reason) = approval_current_failure_reason(proposal.approved_at.as_deref()) {
        apply_result.checklist.push(apply_result_check(
            "approval_not_expired",
            "Fail",
            Some(reason),
        ));
        apply_result.apply_reason = reason.to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result
        .checklist
        .push(apply_result_check("approval_not_expired", "Pass", None));

    let events = read_existing_run_events(store, &params.run_id)?;
    if has_consumed_apply_authorization(&events, &params.proposal_id) {
        apply_result.checklist.push(apply_result_check(
            "approval_unconsumed",
            "Fail",
            Some("Proposal apply authorization has already been consumed."),
        ));
        apply_result.apply_reason =
            "Proposal apply authorization has already been consumed.".to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result
        .checklist
        .push(apply_result_check("approval_unconsumed", "Pass", None));

    if operation == WorkspacePatchOperation::DeleteFile.as_str() {
        return apply_delete_file_proposal(store, &task, params, &proposal, apply_result);
    }
    if operation == WorkspacePatchOperation::PatchFile.as_str() {
        return apply_patch_file_proposal(store, &task, params, &proposal, apply_result);
    }

    let Some(replacement_content) = params.replacement_content.as_deref() else {
        apply_result.checklist.push(apply_result_check(
            "replacement_content_required",
            "Fail",
            Some("Replacement content must be provided for replace_file and create_file apply."),
        ));
        apply_result.apply_reason =
            "Replacement content must be provided for replace_file and create_file apply."
                .to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    };
    let replacement_bytes = replacement_content.as_bytes();

    if replacement_content.chars().count() > DEFAULT_MAX_WORKSPACE_WRITE_CONTENT_CHARS {
        apply_result.checklist.push(apply_result_check(
            "replacement_content_bounded",
            "Fail",
            Some("Replacement content exceeds the runtime write limit."),
        ));
        apply_result.apply_reason =
            "Replacement content exceeds the runtime write limit.".to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "replacement_content_bounded",
        "Pass",
        None,
    ));

    if scan_text_for_sensitive_content(replacement_content) {
        apply_result.checklist.push(apply_result_check(
            "replacement_content_sensitive_scan",
            "Blocked",
            Some("Replacement content contains sensitive-like data."),
        ));
        apply_result.apply_reason = "Replacement content contains sensitive-like data.".to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "replacement_content_sensitive_scan",
        "Pass",
        None,
    ));

    if replacement_content.chars().count() != proposal.content_chars
        || preview_with_limit(replacement_content, DEFAULT_PROPOSAL_PREVIEW_CHARS)
            != proposal.content_preview
    {
        apply_result.checklist.push(apply_result_check(
            "replacement_content_matches_proposal",
            "Fail",
            Some("Replacement content does not match approved proposal metadata."),
        ));
        apply_result.apply_reason =
            "Replacement content does not match approved proposal metadata.".to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "replacement_content_matches_proposal",
        "Pass",
        None,
    ));

    if proposal.diff_redacted || proposal.content_preview == "[redacted]" {
        apply_result.checklist.push(apply_result_check(
            "proposal_diff_available",
            "Blocked",
            Some("Proposal diff or content preview is redacted."),
        ));
        apply_result.apply_reason = "Proposal diff or content preview is redacted.".to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    if proposal.diff_truncated || proposal.diff_preview.is_none() {
        apply_result.checklist.push(apply_result_check(
            "proposal_diff_available",
            "Fail",
            Some("Proposal diff must be available and untruncated for apply verification."),
        ));
        apply_result.apply_reason = "Proposal diff is unavailable or truncated.".to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result
        .checklist
        .push(apply_result_check("proposal_diff_available", "Pass", None));

    if operation == WorkspacePatchOperation::CreateFile.as_str() {
        return apply_create_file_proposal(
            store,
            &task,
            params,
            &proposal,
            apply_result,
            replacement_content,
            replacement_bytes,
        );
    }

    let Some(expected_target_sha256) = params.expected_target_sha256.as_deref() else {
        apply_result.checklist.push(apply_result_check(
            "expected_target_hash_valid",
            "Fail",
            Some("Expected target hash must be provided for replace_file apply."),
        ));
        apply_result.apply_reason =
            "Expected target hash must be provided for replace_file apply.".to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    };

    if !is_sha256_fingerprint(expected_target_sha256) {
        apply_result.checklist.push(apply_result_check(
            "expected_target_hash_valid",
            "Fail",
            Some("Expected target hash must be a sha256 fingerprint."),
        ));
        apply_result.apply_reason =
            "Expected target hash must be a sha256 fingerprint.".to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "expected_target_hash_valid",
        "Pass",
        None,
    ));

    let Some(previous_snapshot) = proposal.latest_snapshot.as_ref() else {
        apply_result.checklist.push(apply_result_check(
            "latest_preflight_exists",
            "Fail",
            Some("Run proposal.preflight before applying."),
        ));
        apply_result.apply_reason = "Latest preflight snapshot is missing.".to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    };
    apply_result
        .checklist
        .push(apply_result_check("latest_preflight_exists", "Pass", None));

    let current_snapshot =
        match capture_preflight_snapshot(store, &proposal, Some(previous_snapshot)) {
            Ok(snapshot) => snapshot,
            Err(reason) => {
                apply_result.checklist.push(apply_result_check(
                    "latest_preflight_validation",
                    "Fail",
                    Some(&reason),
                ));
                apply_result.apply_reason = "Latest preflight validation failed.".to_string();
                return record_apply_result(
                    store,
                    &task,
                    &params.run_id,
                    &params.proposal_id,
                    apply_result,
                );
            }
        };
    append_preflight_snapshot_event(store, &task, &current_snapshot)?;
    if current_snapshot.stale {
        apply_result.checklist.push(apply_result_check(
            "latest_preflight_validation",
            "Fail",
            current_snapshot
                .stale_reason
                .as_deref()
                .or(Some("Latest preflight snapshot is stale.")),
        ));
        apply_result.apply_reason = "Latest preflight validation found a stale target.".to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "latest_preflight_validation",
        "Pass",
        None,
    ));

    let target_path = match resolve_apply_target_path(store, &proposal) {
        Ok(path) => path,
        Err(reason) => {
            let check_name = if reason.contains("symlink") {
                "target_file_not_symlink"
            } else if reason.contains("regular") {
                "target_file_regular"
            } else if reason.contains("exist") {
                "target_file_exists"
            } else {
                "target_path_safe"
            };
            apply_result
                .checklist
                .push(apply_result_check(check_name, "Fail", Some(reason)));
            apply_result.apply_reason = reason.to_string();
            return record_apply_result(
                store,
                &task,
                &params.run_id,
                &params.proposal_id,
                apply_result,
            );
        }
    };
    apply_result
        .checklist
        .push(apply_result_check("target_path_safe", "Pass", None));
    apply_result
        .checklist
        .push(apply_result_check("target_file_exists", "Pass", None));
    apply_result
        .checklist
        .push(apply_result_check("target_file_regular", "Pass", None));
    apply_result
        .checklist
        .push(apply_result_check("target_file_not_symlink", "Pass", None));

    let current_bytes = match std::fs::read(&target_path) {
        Ok(bytes) => bytes,
        Err(_) => {
            apply_result.checklist.push(apply_result_check(
                "target_file_readable",
                "Fail",
                Some("Target file could not be read before apply."),
            ));
            apply_result.apply_reason = "Target file could not be read before apply.".to_string();
            return record_apply_result(
                store,
                &task,
                &params.run_id,
                &params.proposal_id,
                apply_result,
            );
        }
    };
    let pre_write_hash = format!("sha256:{}", hex_sha256(&current_bytes));
    apply_result.pre_write_target_sha256 = Some(pre_write_hash.clone());
    apply_result.pre_write_target_exists = Some(true);
    apply_result
        .checklist
        .push(apply_result_check("target_file_readable", "Pass", None));

    if current_snapshot.file_sha256.as_deref() != Some(pre_write_hash.as_str())
        || expected_target_sha256 != pre_write_hash
    {
        apply_result.checklist.push(apply_result_check(
            "expected_target_hash_matches",
            "Fail",
            Some("Expected target hash does not match current target file."),
        ));
        apply_result.apply_reason =
            "Expected target hash does not match current target file.".to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "expected_target_hash_matches",
        "Pass",
        None,
    ));

    let current_content = match std::str::from_utf8(&current_bytes) {
        Ok(content) => content,
        Err(_) => {
            apply_result.checklist.push(apply_result_check(
                "target_file_utf8",
                "Fail",
                Some("Target file is not UTF-8."),
            ));
            apply_result.apply_reason = "Target file is not UTF-8.".to_string();
            return record_apply_result(
                store,
                &task,
                &params.run_id,
                &params.proposal_id,
                apply_result,
            );
        }
    };
    if scan_text_for_sensitive_content(current_content) {
        apply_result.checklist.push(apply_result_check(
            "target_file_sensitive_scan",
            "Blocked",
            Some("Target file contains sensitive-like data."),
        ));
        apply_result.apply_reason = "Target file contains sensitive-like data.".to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result
        .checklist
        .push(apply_result_check("target_file_utf8", "Pass", None));
    apply_result.checklist.push(apply_result_check(
        "target_file_sensitive_scan",
        "Pass",
        None,
    ));

    let current_diff = synthetic_unified_diff(&proposal.path, current_content, replacement_content);
    if proposal.diff_preview.as_deref() != Some(current_diff.as_str()) {
        apply_result.checklist.push(apply_result_check(
            "approved_diff_matches_current_target",
            "Fail",
            Some("Approved diff does not match the current target and replacement content."),
        ));
        apply_result.apply_reason =
            "Approved diff does not match the current target and replacement content.".to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "approved_diff_matches_current_target",
        "Pass",
        None,
    ));

    let expected_post_write_hash = format!("sha256:{}", hex_sha256(replacement_bytes));
    let outcome = atomic_replace_existing_file(&target_path, replacement_bytes);
    apply_result.temp_file_cleaned = outcome.temp_file_cleaned;
    apply_result.atomic_replacement_completed = outcome.atomic_replacement_completed;
    apply_result.post_write_sha256 = outcome.post_write_sha256.clone();
    if let Some(reason) = outcome.failure_reason {
        apply_result.checklist.push(apply_result_check(
            "temporary_sibling_file_created",
            if reason == "Temporary sibling file creation failed." {
                "Fail"
            } else {
                "Pass"
            },
            if reason == "Temporary sibling file creation failed." {
                Some(reason)
            } else {
                None
            },
        ));
        apply_result.checklist.push(apply_result_check(
            "bounded_write_flushed_and_synced",
            if reason.contains("write") || reason.contains("flush") || reason.contains("sync") {
                "Fail"
            } else {
                "Pass"
            },
            if reason.contains("write") || reason.contains("flush") || reason.contains("sync") {
                Some(reason)
            } else {
                None
            },
        ));
        apply_result.checklist.push(apply_result_check(
            "atomic_replacement_completed",
            if outcome.atomic_replacement_completed {
                "Pass"
            } else {
                "Fail"
            },
            if outcome.atomic_replacement_completed {
                None
            } else {
                Some(reason)
            },
        ));
        apply_result.checklist.push(apply_result_check(
            "post_write_sha256_verified",
            "Fail",
            Some(reason),
        ));
        apply_result.apply_status = "Failed".to_string();
        apply_result.apply_reason = reason.to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "temporary_sibling_file_created",
        "Pass",
        None,
    ));
    apply_result.checklist.push(apply_result_check(
        "bounded_write_flushed_and_synced",
        "Pass",
        None,
    ));
    apply_result.checklist.push(apply_result_check(
        "atomic_replacement_completed",
        "Pass",
        None,
    ));
    if apply_result.post_write_sha256.as_deref() != Some(expected_post_write_hash.as_str()) {
        apply_result.checklist.push(apply_result_check(
            "post_write_sha256_verified",
            "Fail",
            Some("Post-write SHA-256 does not match replacement content."),
        ));
        apply_result.apply_status = "Failed".to_string();
        apply_result.apply_reason =
            "Post-write SHA-256 does not match replacement content.".to_string();
        return record_apply_result(
            store,
            &task,
            &params.run_id,
            &params.proposal_id,
            apply_result,
        );
    }
    apply_result.checklist.push(apply_result_check(
        "post_write_sha256_verified",
        "Pass",
        None,
    ));
    apply_result.apply_status = "Applied".to_string();
    apply_result.apply_reason = "Patch applied and post-write SHA-256 verified.".to_string();
    apply_result.authorization_consumed = true;
    apply_result.applied = true;
    apply_result.applied_at = Some(now_rfc3339());
    record_apply_result(
        store,
        &task,
        &params.run_id,
        &params.proposal_id,
        apply_result,
    )
}
