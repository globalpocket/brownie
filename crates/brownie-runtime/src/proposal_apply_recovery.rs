//! Bounded replacement recovery. Intent metadata uses the same trusted store
//! boundary as approval/ledger records. Temporary content is never serialized.
//! A live hard-link witness prevents inode reuse from becoming success evidence.
use super::*;
// Preserve legacy Unix journal numbers while retaining all 128 Windows ID bits.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
enum FileId {
    Unix(u64),
    Windows([u8; 16]),
}

struct IdentityMetadata {
    metadata: std::fs::Metadata,
    volume: u64,
    file_id: FileId,
}

impl IdentityMetadata {
    fn dev(&self) -> u64 {
        self.volume
    }
    fn ino(&self) -> FileId {
        self.file_id
    }
}

impl std::ops::Deref for IdentityMetadata {
    type Target = std::fs::Metadata;
    fn deref(&self) -> &Self::Target {
        &self.metadata
    }
}

#[cfg(unix)]
fn identity_metadata(path: impl AsRef<Path>) -> std::io::Result<IdentityMetadata> {
    use std::os::unix::fs::MetadataExt;
    let metadata = std::fs::symlink_metadata(path)?;
    Ok(IdentityMetadata {
        volume: metadata.dev(),
        file_id: FileId::Unix(metadata.ino()),
        metadata,
    })
}

#[cfg(windows)]
fn identity_metadata(path: impl AsRef<Path>) -> std::io::Result<IdentityMetadata> {
    use std::os::windows::{
        fs::{MetadataExt, OpenOptionsExt},
        io::AsRawHandle,
    };
    // FILE_ID_INFO, queried from the same open handle as file metadata.
    // https://learn.microsoft.com/windows/win32/api/winbase/ns-winbase-file_id_info
    #[repr(C)]
    struct FileIdInfo {
        volume: u64,
        identifier: [u8; 16],
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetFileInformationByHandleEx(
            handle: *mut std::ffi::c_void,
            class: i32,
            info: *mut std::ffi::c_void,
            size: u32,
        ) -> i32;
    }
    const OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const REPARSE_POINT: u32 = 0x0000_0400;
    let file = std::fs::OpenOptions::new()
        .access_mode(0)
        .custom_flags(OPEN_REPARSE_POINT | BACKUP_SEMANTICS)
        .open(path)?;
    let metadata = file.metadata()?;
    if metadata.file_attributes() & REPARSE_POINT != 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "recovery evidence is a reparse point",
        ));
    }
    let mut info = FileIdInfo {
        volume: 0,
        identifier: [0; 16],
    };
    // FileIdInfo (18) returns the full identifier; no truncated-ID fallback.
    let ok = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            18,
            (&mut info as *mut FileIdInfo).cast(),
            std::mem::size_of::<FileIdInfo>() as u32,
        )
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(IdentityMetadata {
        metadata,
        volume: info.volume,
        file_id: FileId::Windows(info.identifier),
    })
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Intent {
    version: u32,
    binding: String,
    target_path_hash: String,
    witness: String,
    staging: String,
    prepared_device: u64,
    prepared_inode: FileId,
    old_device: u64,
    old_inode: FileId,
    #[serde(default)]
    expected_post_write_sha256: Option<String>,
    #[serde(default)]
    terminal_result_sha256: Option<String>,
    #[serde(default)]
    recorded_result: Option<WorkspacePatchApplyResultSummary>,
    result: WorkspacePatchApplyResultSummary,
}

fn error(_: impl std::fmt::Display) -> String {
    "replace-file recovery evidence unavailable or invalid".to_string()
}

fn path(store: &BrownieStore, params: &ProposalApplyParams) -> PathBuf {
    store.tasks().run_dir(&params.run_id).join(format!(
        "apply-intent-{}.json",
        hex_sha256(params.proposal_id.as_bytes())
    ))
}

fn binding(
    store: &BrownieStore,
    task: &TaskRecord,
    params: &ProposalApplyParams,
    proposal: &WorkspacePatchProposalSummary,
) -> Result<String, String> {
    // Raw request and policy are hashed in memory, never written to the intent.
    let current = inspect_proposal(store, &params.run_id, &proposal.proposal_id)?;
    let value = json!({"request": params, "approved_at": proposal.approved_at,
        "path": proposal.path, "operation": proposal.operation,
        "preflight": current.latest_snapshot, "diff": proposal.diff_preview,
        "policy": resolve_apply_write_policy(store, task)?});
    Ok(hex_sha256(&serde_json::to_vec(&value).map_err(error)?))
}

fn regular(path: &Path) -> Result<IdentityMetadata, String> {
    let metadata = identity_metadata(path).map_err(error)?;
    if !metadata.file_type().is_file() {
        return Err(error("not a regular file"));
    }
    Ok(metadata)
}

fn witness_path(target: &Path, name: &str) -> Result<PathBuf, String> {
    if !name.starts_with(".brownie-replace-witness-")
        || !name.ends_with(".tmp")
        || Path::new(name).components().count() != 1
    {
        return Err(error("invalid witness name"));
    }
    Ok(target
        .parent()
        .ok_or_else(|| error("missing parent"))?
        .join(name))
}

fn staging_path(target: &Path, name: &str) -> Result<PathBuf, String> {
    let prefix = format!(
        ".{}.brownie-apply-",
        target
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(|| error("target name"))?
    );
    if !name.starts_with(&prefix)
        || !name.ends_with(".tmp")
        || Path::new(name).components().count() != 1
    {
        return Err(error("invalid staging name"));
    }
    Ok(target
        .parent()
        .ok_or_else(|| error("missing parent"))?
        .join(name))
}

fn cleanup(intent_path: &Path, witness: &Path, staging: &Path) -> Result<(), String> {
    if let Ok(metadata) = identity_metadata(staging) {
        let wm = regular(witness)?;
        if !metadata.file_type().is_file()
            || metadata.dev() != wm.dev()
            || metadata.ino() != wm.ino()
        {
            return Err(error("staging identity changed"));
        }
        std::fs::remove_file(staging).map_err(error)?;
    }
    std::fs::remove_file(witness).map_err(error)?;
    std::fs::remove_file(intent_path).map_err(error)?;
    Ok(())
}

// The original target is still intact. Missing temporary files may be the
// result of an interrupted cleanup, but existing ones must retain their exact
// prepared identity. Validate both before deleting either; never infer Applied.
fn validate_unwritten<'a>(
    witness: &'a Path,
    staging: &'a Path,
    intent: &Intent,
) -> Result<Vec<&'a Path>, String> {
    let mut remaining = Vec::new();
    for path in [staging, witness] {
        match identity_metadata(path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(error(e)),
            Ok(m) => {
                if !m.file_type().is_file()
                    || m.dev() != intent.prepared_device
                    || m.ino() != intent.prepared_inode
                {
                    return Err(error("unwritten temporary identity changed"));
                }
                remaining.push(path);
            }
        }
    }
    Ok(remaining)
}

fn cleanup_unwritten(
    intent_path: &Path,
    witness: &Path,
    staging: &Path,
    intent: &Intent,
) -> Result<(), String> {
    for path in validate_unwritten(witness, staging, intent)? {
        std::fs::remove_file(path).map_err(error)?;
    }
    std::fs::remove_file(intent_path).map_err(error)
}

/// Called only after current explicit authorization, policy and approval checks.
/// A before-write interruption is retried through all ordinary preflight checks.
/// An after-write interruption reconciles the retained file identity, not a hash alone.
pub(super) fn recover(
    store: &BrownieStore,
    task: &TaskRecord,
    params: &ProposalApplyParams,
    proposal: &WorkspacePatchProposalSummary,
) -> Result<Option<WorkspacePatchApplyResultSummary>, String> {
    let intent_path = path(store, params);
    match identity_metadata(&intent_path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(error(e)),
        Ok(_) => {}
    }
    regular(&intent_path)?;
    let intent: Intent =
        serde_json::from_slice(&std::fs::read(&intent_path).map_err(error)?).map_err(error)?;
    if !matches!(intent.version, 1 | 2)
        || (intent.version == 1 && proposal.operation != "replace_file")
        || (intent.version == 2 && intent.expected_post_write_sha256.is_none())
        || intent.binding != binding(store, task, params, proposal)?
        || intent.result.proposal_id != params.proposal_id
        || intent.result.path != proposal.path
        || intent.result.expected_target_sha256 != params.expected_target_sha256
        || intent.result.pre_write_target_sha256 != params.expected_target_sha256
        || intent.result.operation != proposal.operation
        || !matches!(
            proposal.operation.as_str(),
            "replace_file" | "patch_file" | "create_file" | "delete_file"
        )
        || (proposal.operation == "create_file" && params.expected_target_absent != Some(true))
        || intent.terminal_result_sha256.is_some()
        || intent.result.applied
        || intent.result.authorization_consumed
    {
        return Err(error("binding mismatch"));
    }
    match inspect_retained_item(store, params, proposal, &intent)? {
        Some(result) => {
            let (_, result) =
                record_apply_result(store, task, &params.run_id, &params.proposal_id, result)?;
            cleanup_recorded(store, task, params)?;
            Ok(Some(result))
        }
        None => {
            let target = if proposal.operation == "create_file" {
                resolve_create_apply_target_path(store, proposal).map_err(error)?
            } else {
                resolve_apply_target_path(store, proposal).map_err(error)?
            };
            cleanup_unwritten(
                &intent_path,
                &witness_path(&target, &intent.witness)?,
                &staging_path(&target, &intent.staging)?,
                &intent,
            )?;
            Ok(None)
        }
    }
}

/// Read-only classification. A transaction must inspect every bound item before
/// it resumes any mutation; this function never records or cleans an item.
fn inspect_retained_item(
    store: &BrownieStore,
    params: &ProposalApplyParams,
    proposal: &WorkspacePatchProposalSummary,
    intent: &Intent,
) -> Result<Option<WorkspacePatchApplyResultSummary>, String> {
    let target = if matches!(proposal.operation.as_str(), "create_file" | "delete_file") {
        resolve_create_apply_target_path(store, proposal)
            .or_else(|_| resolve_apply_target_path(store, proposal))
            .map_err(error)?
    } else {
        resolve_apply_target_path(store, proposal).map_err(error)?
    };
    if intent.target_path_hash != hex_sha256(target.as_os_str().as_encoded_bytes()) {
        return Err(error("target location changed"));
    }
    let witness = witness_path(&target, &intent.witness)?;
    let staging = staging_path(&target, &intent.staging)?;
    if proposal.operation == "create_file" {
        match identity_metadata(&target) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                validate_unwritten(&witness, &staging, intent)?;
                return Ok(None);
            }
            Err(e) => return Err(error(e)),
            Ok(_) => {}
        }
    }
    if proposal.operation == "delete_file" {
        match identity_metadata(&target) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let wm = regular(&witness)?;
                let sm = regular(&staging)?;
                let retained_hash = format!(
                    "sha256:{}",
                    hex_sha256(&std::fs::read(&staging).map_err(error)?)
                );
                if wm.dev() != intent.prepared_device
                    || wm.ino() != intent.prepared_inode
                    || sm.dev() != wm.dev()
                    || sm.ino() != wm.ino()
                    || Some(retained_hash) != params.expected_target_sha256
                {
                    return Err(error("removed target evidence changed"));
                }
                let mut result = intent.result.clone();
                result.apply_status = "Applied".into();
                result.apply_reason =
                    "Recovered authorized deletion from retained original identity.".into();
                result.applied = true;
                result.authorization_consumed = true;
                result.atomic_delete_completed = true;
                result.post_delete_target_exists = Some(false);
                result.applied_at = Some(now_rfc3339());
                return Ok(Some(result));
            }
            Err(e) => return Err(error(e)),
            Ok(_) => {}
        }
    }
    let tm = regular(&target)?;
    let bytes = std::fs::read(&target).map_err(error)?;
    let current_hash = format!("sha256:{}", hex_sha256(&bytes));
    if tm.dev() == intent.old_device
        && tm.ino() == intent.old_inode
        && Some(current_hash.as_str()) == params.expected_target_sha256.as_deref()
    {
        validate_unwritten(&witness, &staging, intent)?;
        return Ok(None);
    }
    let wm = regular(&witness)?;
    if wm.dev() != intent.prepared_device || wm.ino() != intent.prepared_inode {
        return Err(error("witness identity changed"));
    }
    let expected = match intent.expected_post_write_sha256.as_ref() {
        Some(hash) if is_sha256_fingerprint(hash) => hash.clone(),
        None if proposal.operation == "replace_file" => format!(
            "sha256:{}",
            hex_sha256(
                params
                    .replacement_content
                    .as_deref()
                    .ok_or_else(|| error("missing content"))?
                    .as_bytes()
            )
        ),
        _ => return Err(error("missing or invalid prepared result hash")),
    };
    if tm.dev() == wm.dev() && tm.ino() == wm.ino() && current_hash == expected {
        let mut result = intent.result.clone();
        result.apply_status = "Applied".to_string();
        result.apply_reason = "Recovered authorized replacement by retained file identity and verified content; result recorded at recovery.".to_string();
        result.applied = true;
        result.authorization_consumed = true;
        result.atomic_replacement_completed = proposal.operation != "create_file";
        result.atomic_create_completed = proposal.operation == "create_file";
        result.post_write_sha256 = Some(current_hash);
        result.applied_at = Some(now_rfc3339());
        result.temp_file_cleaned = false;
        result.checklist.push(apply_result_check(
            "retained_replacement_identity_verified",
            "Pass",
            None,
        ));
        return Ok(Some(result));
    }
    Err(error(
        "target differs from both prepared and original identity",
    ))
}

fn build_intent(
    store: &BrownieStore,
    task: &TaskRecord,
    params: &ProposalApplyParams,
    proposal: &WorkspacePatchProposalSummary,
    target: &Path,
    prepared: &PreparedAtomicReplace,
    result: &WorkspacePatchApplyResultSummary,
) -> Result<Intent, String> {
    let bound = binding(store, task, params, proposal)?;
    let metadata = if proposal.operation == "create_file" {
        if params.expected_target_absent != Some(true) {
            return Err(error("missing absence expectation"));
        }
        match identity_metadata(target) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            _ => return Err(error("create target already exists or inaccessible")),
        }
    } else {
        Some(regular(target)?)
    };
    let name = format!(
        ".brownie-replace-witness-{}.tmp",
        uuid::Uuid::new_v4().simple()
    );
    let witness = witness_path(target, &name)?;
    let witness_source = if proposal.operation == "delete_file" {
        target
    } else {
        &prepared.temp_path
    };
    std::fs::hard_link(witness_source, &witness).map_err(error)?;
    let prepared_metadata = regular(&witness)?;
    let intent = Intent {
        version: 2,
        target_path_hash: hex_sha256(target.as_os_str().as_encoded_bytes()),
        staging: prepared
            .temp_path
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(|| error("invalid staging"))?
            .to_string(),
        prepared_device: prepared_metadata.dev(),
        prepared_inode: prepared_metadata.ino(),
        binding: bound,
        witness: name,
        old_device: metadata.as_ref().map_or(0, IdentityMetadata::dev),
        old_inode: metadata
            .as_ref()
            .map_or(FileId::Unix(0), IdentityMetadata::ino),
        expected_post_write_sha256: Some(format!(
            "sha256:{}",
            hex_sha256(&std::fs::read(&witness).map_err(error)?)
        )),
        terminal_result_sha256: None,
        recorded_result: None,
        result: result.clone(),
    };
    Ok(intent)
}

pub(super) fn prepare(
    store: &BrownieStore,
    task: &TaskRecord,
    params: &ProposalApplyParams,
    proposal: &WorkspacePatchProposalSummary,
    target: &Path,
    prepared: &PreparedAtomicReplace,
    result: &WorkspacePatchApplyResultSummary,
) -> Result<PathBuf, String> {
    let intent = build_intent(store, task, params, proposal, target, prepared, result)?;
    let witness = witness_path(target, &intent.witness)?;
    let destination = path(store, params);
    let persisted = (|| -> Result<(), String> {
        let parent = destination
            .parent()
            .ok_or_else(|| error("missing parent"))?;
        let mut file = tempfile::NamedTempFile::new_in(parent).map_err(error)?;
        serde_json::to_writer(&mut file, &intent).map_err(error)?;
        file.as_file().sync_all().map_err(error)?;
        file.persist_noclobber(&destination).map_err(error)?;
        brownie_store::sync_directory_metadata(parent).map_err(error)?;
        brownie_store::sync_directory_metadata(
            target
                .parent()
                .ok_or_else(|| error("missing target parent"))?,
        )
        .map_err(error)?;
        Ok(())
    })();
    if let Err(error) = persisted {
        // Once the intent exists, preserve its witness for explicit recovery.
        // Before that point there is no durable reference to clean it later.
        if !destination.exists() {
            let _ = std::fs::remove_file(&witness);
        }
        return Err(error);
    }
    Ok(witness)
}

// Preserve the exact response before appending its bounded ledger projection.
// The ledger schema remains unchanged; recovery compares every projected field.
pub(super) fn retain_recorded_result(
    store: &BrownieStore,
    run_id: &str,
    proposal_id: &str,
    result: &WorkspacePatchApplyResultSummary,
) -> Result<(), String> {
    if !result.applied || !result.authorization_consumed || result.transaction_id.is_some() {
        return Ok(());
    }
    let ip = store.tasks().run_dir(run_id).join(format!(
        "apply-intent-{}.json",
        hex_sha256(proposal_id.as_bytes())
    ));
    match identity_metadata(&ip) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(error(e)),
        Ok(_) => {}
    }
    regular(&ip)?;
    let mut intent: Intent =
        serde_json::from_slice(&std::fs::read(&ip).map_err(error)?).map_err(error)?;
    if intent.result.apply_id != result.apply_id
        || intent.result.proposal_id != proposal_id
        || intent.result.authorization_id != result.authorization_id
        || intent.result.operation != result.operation
        || intent.result.path != result.path
        || intent.terminal_result_sha256.is_some()
    {
        return Err(error("recorded response binding mismatch"));
    }
    intent.recorded_result = Some(result.clone());
    let parent = ip.parent().ok_or_else(|| error("missing intent parent"))?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(error)?;
    serde_json::to_writer(&mut file, &intent).map_err(error)?;
    file.as_file().sync_all().map_err(error)?;
    file.persist(&ip).map_err(error)?;
    brownie_store::sync_directory_metadata(parent).map_err(error)
}

pub(super) fn finish(
    store: &BrownieStore,
    task: &TaskRecord,
    params: &ProposalApplyParams,
) -> Result<(), String> {
    cleanup_recorded(store, task, params).map(|_| ())
}

/// Finalization after a result append was durable but the process exited before
/// removing temporary witnesses. Never writes the target or adds another result.
pub(super) fn cleanup_recorded(
    store: &BrownieStore,
    task: &TaskRecord,
    params: &ProposalApplyParams,
) -> Result<Option<WorkspacePatchApplyResultSummary>, String> {
    let ip = path(store, params);
    match identity_metadata(&ip) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(error(e)),
        Ok(_) => {}
    }
    regular(&ip)?;
    let mut intent: Intent =
        serde_json::from_slice(&std::fs::read(&ip).map_err(error)?).map_err(error)?;
    let proposal = inspect_proposal(store, &params.run_id, &params.proposal_id)?;
    if !matches!(intent.version, 1 | 2)
        || (intent.version == 1 && proposal.operation != "replace_file")
        || intent.result.proposal_id != params.proposal_id
        || intent.result.operation != proposal.operation
        || intent.result.path != proposal.path
        || intent.binding != binding(store, task, params, &proposal)?
    {
        return Err(error("recorded request binding changed"));
    }
    let events = read_existing_run_events(store, &params.run_id)?;
    let results: Vec<_> = events
        .iter()
        .filter_map(|event| {
            if event.kind != LedgerEventKind::WorkspacePatchApplyResultRecorded {
                return None;
            }
            event.payload.as_ref().filter(|p| {
                p["apply_id"].as_str() == Some(intent.result.apply_id.as_str())
                    && p["proposal_id"].as_str() == Some(params.proposal_id.as_str())
                    && p["apply_status"] == "Applied"
                    && p["authorization_consumed"] == true
                    && p["applied"] == true
                    && p["operation"].as_str() == Some(intent.result.operation.as_str())
                    && p["path"].as_str() == Some(intent.result.path.as_str())
                    && p["authorization_id"] == json!(intent.result.authorization_id)
                    && p["expected_target_sha256"] == json!(intent.result.expected_target_sha256)
            })
        })
        .collect();
    if results.len() != 1 {
        return Err(error("missing or duplicate committed result"));
    }
    let target = if proposal.operation == "delete_file" {
        resolve_create_apply_target_path(store, &proposal).map_err(error)?
    } else {
        resolve_apply_target_path(store, &proposal).map_err(error)?
    };
    if intent.target_path_hash != hex_sha256(target.as_os_str().as_encoded_bytes()) {
        return Err(error("target location changed"));
    }
    // A committed result authorizes cleanup only for the same resulting target.
    // Validate before changing terminal metadata or removing recovery evidence.
    if proposal.operation == "delete_file" {
        match identity_metadata(&target) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            _ => return Err(error("deleted target reappeared")),
        }
    } else {
        let metadata = regular(&target)?;
        if metadata.dev() != intent.prepared_device
            || metadata.ino() != intent.prepared_inode
            || intent.expected_post_write_sha256.as_deref()
                != Some(
                    format!(
                        "sha256:{}",
                        hex_sha256(&std::fs::read(&target).map_err(error)?)
                    )
                    .as_str(),
                )
        {
            return Err(error("committed target changed"));
        }
    }
    let witness = witness_path(&target, &intent.witness)?;
    let staging = staging_path(&target, &intent.staging)?;
    // Validate every remaining cleanup input before changing terminal metadata.
    // A deleted target has no bytes left at its original path; its retained
    // original must still match the approved preimage, not merely its identity.
    let remaining = validate_unwritten(&witness, &staging, &intent)?;
    if remaining.contains(&staging.as_path()) && !remaining.contains(&witness.as_path()) {
        return Err(error("staging remains without witness"));
    }
    if proposal.operation == "delete_file" {
        for material in remaining {
            if Some(format!(
                "sha256:{}",
                hex_sha256(&std::fs::read(material).map_err(error)?)
            )) != intent.expected_post_write_sha256
            {
                return Err(error("deleted retained content changed"));
            }
        }
    }
    let recorded = intent
        .recorded_result
        .as_ref()
        .ok_or_else(|| error("complete recorded response unavailable"))?;
    let response_digest = hex_sha256(&serde_json::to_vec(recorded).map_err(error)?);
    if results[0]["recorded_response_sha256"].as_str() != Some(response_digest.as_str()) {
        return Err(error("recorded response digest differs from ledger"));
    }
    let full = serde_json::to_value(recorded).map_err(error)?;
    if !results[0]
        .as_object()
        .ok_or_else(|| error("invalid ledger result"))?
        .iter()
        .all(|(key, value)| key == "recorded_response_sha256" || full.get(key) == Some(value))
    {
        return Err(error("recorded response differs from ledger"));
    }
    let recorded = recorded.clone();
    let digest = hex_sha256(&serde_json::to_vec(results[0]).map_err(error)?);
    if let Some(terminal) = &intent.terminal_result_sha256 {
        if terminal != &digest {
            return Err(error("terminal result changed"));
        }
    } else {
        // The terminal state binds the durable ledger result; it is not a second
        // application and must be persisted before any intent material is removed.
        intent.terminal_result_sha256 = Some(digest);
        let parent = ip.parent().ok_or_else(|| error("missing intent parent"))?;
        let mut file = tempfile::NamedTempFile::new_in(parent).map_err(error)?;
        serde_json::to_writer(&mut file, &intent).map_err(error)?;
        file.as_file().sync_all().map_err(error)?;
        file.persist(&ip).map_err(error)?;
        brownie_store::sync_directory_metadata(parent).map_err(error)?;
    }
    #[cfg(test)]
    crash_boundary("terminal");
    match identity_metadata(&witness) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // A prior cleanup may have removed the witness before its journal.
            if staging.exists() {
                return Err(error("staging remains without witness"));
            }
            std::fs::remove_file(ip).map_err(error)
        }
        Err(e) => Err(error(e)),
        Ok(_) => {
            let wm = regular(&witness)?;
            if wm.dev() != intent.prepared_device || wm.ino() != intent.prepared_inode {
                return Err(error("witness changed"));
            }
            cleanup(&ip, &witness, &staging)
        }
    }?;
    Ok(Some(recorded))
}

#[cfg(test)]
pub(super) fn crash_boundary(boundary: &str) {
    if std::env::var("CODEX_R05_2_EXIT").ok().as_deref() == Some(boundary) {
        if let Some(marker) = std::env::var_os("CODEX_R05_2_KILL_MARKER") {
            let marker = std::path::PathBuf::from(marker);
            let pending = marker.with_extension("pending");
            std::fs::write(&pending, boundary).expect("write owned-child boundary marker");
            std::fs::rename(pending, marker).expect("publish complete boundary marker");
            loop {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
        std::process::exit(match boundary {
            "before" => 85,
            "after" => 86,
            "terminal" => 88,
            _ => 87,
        });
    }
}

#[cfg(test)]
pub(super) fn inspect_for_test(
    store: &BrownieStore,
    params: &ProposalApplyParams,
) -> Result<bool, String> {
    let intent: Intent =
        serde_json::from_slice(&std::fs::read(path(store, params)).map_err(error)?)
            .map_err(error)?;
    let proposal = inspect_proposal(store, &params.run_id, &params.proposal_id)?;
    inspect_retained_item(store, params, &proposal, &intent).map(|result| result.is_some())
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct TransactionIntent {
    version: u32,
    binding: String,
    items: Vec<Intent>,
    result: WorkspacePatchApplyResultSummary,
    terminal: Option<String>,
}

fn transaction_path(store: &BrownieStore, params: &ProposalApplyParams) -> PathBuf {
    store
        .tasks()
        .run_dir(&params.run_id)
        .join("apply-transaction-intent.json")
}

fn transaction_binding(
    store: &BrownieStore,
    task: &TaskRecord,
    params: &ProposalApplyParams,
) -> Result<String, String> {
    if !params.authorize {
        return Err(error("transaction requires explicit authorization"));
    }
    if let Some(source) = &params.transaction_recovery_source {
        if source.source_run_id != params.run_id {
            return Err(error("recovery source run changed"));
        }
        let events = read_existing_run_events(store, &params.run_id)?;
        let payload = latest_transaction_apply_payload(
            &events,
            &source.source_apply_id,
            &source.source_transaction_id,
        )
        .ok_or_else(|| error("recovery source missing"))?;
        if transaction_source_fingerprint(&payload).as_deref()
            != Some(source.expected_source_transaction_fingerprint.as_str())
        {
            return Err(error("recovery source fingerprint changed"));
        }
        for item in payload["transaction_items"]
            .as_array()
            .ok_or_else(|| error("source items missing"))?
        {
            if item["applied"] == true {
                let path = item["path"]
                    .as_str()
                    .ok_or_else(|| error("source path missing"))?;
                if item["operation"] == "delete_file" {
                    workspace_path_currently_absent(store, path).map_err(error)?;
                    continue;
                }
                let expected = item["post_write_sha256"]
                    .as_str()
                    .ok_or_else(|| error("source hash missing"))?;
                if current_sha256_for_workspace_path(store, path).map_err(error)? != expected {
                    return Err(error("applied source target changed"));
                }
            }
        }
    }
    let policy = resolve_apply_write_policy(store, task)?;
    let mut proposals = Vec::new();
    for item in params
        .transaction_items
        .as_ref()
        .ok_or_else(|| error("missing transaction items"))?
    {
        let proposal = inspect_proposal(store, &params.run_id, &item.proposal_id)?;
        if proposal.validation_status != "Valid"
            || proposal.approval_status != "Approved"
            || approval_current_failure_reason(proposal.approved_at.as_deref()).is_some()
            || !RuntimePermissionGate::check_workspace_write_path(&policy, &proposal.path).allowed
        {
            return Err(error("transaction admission changed"));
        }
        proposals.push(json!({"id":item.proposal_id,"operation":proposal.operation,
            "path":proposal.path,"approved_at":proposal.approved_at,"preflight":proposal.latest_snapshot,
            "diff":proposal.diff_preview}));
    }
    Ok(hex_sha256(
        &serde_json::to_vec(&json!({"request":params,"policy":policy,"proposals":proposals}))
            .map_err(error)?,
    ))
}

fn transaction_item_params(
    store: &BrownieStore,
    params: &ProposalApplyParams,
    index: usize,
) -> Result<ProposalApplyParams, String> {
    let item = params
        .transaction_items
        .as_ref()
        .and_then(|items| items.get(index))
        .ok_or_else(|| error("missing item"))?;
    let mut single = params.clone();
    single.proposal_id = item.proposal_id.clone();
    single.expected_target_sha256 = item.expected_target_sha256.clone();
    single.expected_target_absent = item.expected_target_absent;
    single.replacement_content =
        if inspect_proposal(store, &params.run_id, &item.proposal_id)?.operation == "delete_file" {
            None
        } else {
            Some(item.replacement_content.clone())
        };
    single.transaction_items = None;
    single.transaction_recovery_source = None;
    Ok(single)
}

fn persist_transaction(
    path: &Path,
    intent: &TransactionIntent,
    initial: bool,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| error("missing run directory"))?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(error)?;
    serde_json::to_writer(&mut file, intent).map_err(error)?;
    file.as_file().sync_all().map_err(error)?;
    if initial {
        file.persist_noclobber(path).map_err(error)?;
    } else {
        file.persist(path).map_err(error)?;
    }
    brownie_store::sync_directory_metadata(parent).map_err(error)
}

pub(super) fn begin_replace_transaction(
    store: &BrownieStore,
    task: &TaskRecord,
    params: &ProposalApplyParams,
    result: WorkspacePatchApplyResultSummary,
    items: &[PreparedReplaceTransactionItem],
    prepared: Vec<PreparedAtomicReplace>,
) -> Result<
    (
        WorkspacePatchProposalSummary,
        WorkspacePatchApplyResultSummary,
    ),
    String,
> {
    let summaries = items
        .iter()
        .map(|item| {
            transaction_item_result(
                item,
                "Pending",
                "Durable item prepared",
                None,
                false,
                false,
                false,
            )
        })
        .collect();
    begin_transaction(store, task, params, result, summaries, prepared)
}

pub(super) fn begin_create_transaction(
    store: &BrownieStore,
    task: &TaskRecord,
    params: &ProposalApplyParams,
    result: WorkspacePatchApplyResultSummary,
    items: &[PreparedCreateTransactionItem],
) -> Result<
    (
        WorkspacePatchProposalSummary,
        WorkspacePatchApplyResultSummary,
    ),
    String,
> {
    let mut prepared = Vec::new();
    for item in items {
        let material =
            prepare_atomic_replace_existing_file(&item.target_path, &item.replacement_bytes);
        match material.prepared {
            Some(material) => prepared.push(material),
            None => {
                for material in &prepared {
                    cleanup_atomic_replace_temp(&material.temp_path);
                }
                return Err(error("transaction create preparation failed"));
            }
        }
    }
    let summaries = items
        .iter()
        .map(|item| {
            create_transaction_item_result(
                item,
                "Pending",
                "Durable item prepared",
                None,
                false,
                false,
                false,
            )
        })
        .collect();
    begin_transaction(store, task, params, result, summaries, prepared)
}

pub(super) fn begin_delete_transaction(
    store: &BrownieStore,
    task: &TaskRecord,
    params: &ProposalApplyParams,
    result: WorkspacePatchApplyResultSummary,
    items: &[PreparedDeleteTransactionItem],
) -> Result<
    (
        WorkspacePatchProposalSummary,
        WorkspacePatchApplyResultSummary,
    ),
    String,
> {
    let mut prepared = Vec::new();
    for item in items {
        let parent = item
            .target_path
            .parent()
            .ok_or_else(|| error("missing parent"))?;
        let name = item
            .target_path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| error("invalid filename"))?;
        prepared.push(PreparedAtomicReplace {
            temp_path: parent.join(format!(
                ".{name}.brownie-apply-{}.tmp",
                uuid::Uuid::new_v4().simple()
            )),
            parent_path: parent.to_path_buf(),
        });
    }
    let summaries = items
        .iter()
        .map(|item| {
            delete_transaction_item_result(
                item,
                "Pending",
                "Durable item prepared",
                None,
                false,
                false,
                false,
            )
        })
        .collect();
    begin_transaction(store, task, params, result, summaries, prepared)
}

fn begin_transaction(
    store: &BrownieStore,
    task: &TaskRecord,
    params: &ProposalApplyParams,
    result: WorkspacePatchApplyResultSummary,
    items: Vec<WorkspacePatchApplyTransactionItemResultSummary>,
    prepared: Vec<PreparedAtomicReplace>,
) -> Result<
    (
        WorkspacePatchProposalSummary,
        WorkspacePatchApplyResultSummary,
    ),
    String,
> {
    let mut transaction = TransactionIntent {
        version: 1,
        binding: transaction_binding(store, task, params)?,
        items: Vec::new(),
        result,
        terminal: None,
    };
    for (index, (item, material)) in items.iter().zip(&prepared).enumerate() {
        let single = transaction_item_params(store, params, index)?;
        let proposal = inspect_proposal(store, &params.run_id, &item.proposal_id)?;
        let mut result = transaction.result.clone();
        result.proposal_id = item.proposal_id.clone();
        result.operation = item.operation.clone();
        result.path = item.path.clone();
        result.expected_target_sha256 = item.expected_target_sha256.clone();
        result.pre_write_target_sha256 = item.pre_write_target_sha256.clone();
        result.pre_write_target_exists = item.pre_write_target_exists;
        result.expected_target_absent = item.expected_target_absent;
        result.transaction_id = None;
        result.transaction_status = None;
        result.transaction_items.clear();
        let target = if proposal.operation == "create_file" {
            resolve_create_apply_target_path(store, &proposal)
        } else {
            resolve_apply_target_path(store, &proposal)
        }
        .map_err(error)?;
        transaction.items.push(build_intent(
            store, task, &single, &proposal, &target, material, &result,
        )?);
        transaction.result.transaction_items.push(item.clone());
    }
    if transaction.items.len() != items.len() || prepared.len() != items.len() {
        return Err(error("item cardinality mismatch"));
    }
    for material in &prepared {
        brownie_store::sync_directory_metadata(&material.parent_path).map_err(error)?;
    }
    persist_transaction(&transaction_path(store, params), &transaction, true)?;
    #[cfg(test)]
    crash_boundary("tx-before");
    resume_transaction(store, params)?.ok_or_else(|| error("transaction disappeared"))
}

/// Pending transactions own their full ordered request. No item is resumed until
/// all items and current approval/policy/preflight bindings have been checked.
pub(super) fn resume_transaction(
    store: &BrownieStore,
    params: &ProposalApplyParams,
) -> Result<
    Option<(
        WorkspacePatchProposalSummary,
        WorkspacePatchApplyResultSummary,
    )>,
    String,
> {
    let path = transaction_path(store, params);
    match identity_metadata(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(error(e)),
        Ok(_) => {}
    }
    regular(&path)?;
    let mut transaction: TransactionIntent =
        serde_json::from_slice(&std::fs::read(&path).map_err(error)?).map_err(error)?;
    let task = store
        .tasks()
        .get_task_by_run_id(&params.run_id)
        .map_err(error)?
        .ok_or_else(|| error("missing task"))?;
    if transaction.version != 1
        || transaction.binding != transaction_binding(store, &task, params)?
        || params.transaction_items.as_ref().map(Vec::len) != Some(transaction.items.len())
        || transaction.items.is_empty()
        || transaction.result.transaction_items.len() != transaction.items.len()
    {
        return Err(error("transaction binding mismatch"));
    }
    let events = read_existing_run_events(store, &params.run_id)?;
    let recorded: Vec<_> = events
        .iter()
        .filter(|e| e.kind == LedgerEventKind::WorkspacePatchApplyResultRecorded)
        .filter_map(|e| e.payload.as_ref())
        .filter(|p| p["apply_id"] == transaction.result.apply_id)
        .collect();
    if recorded.len() > 1 {
        return Err(error("duplicate transaction result"));
    }
    if recorded.is_empty() {
        if let Some(source) = &params.transaction_recovery_source {
            if has_recovered_transaction(
                &events,
                &source.source_apply_id,
                &source.source_transaction_id,
            ) {
                return Err(error("source already recovered"));
            }
        }
        if transaction.terminal.is_some() {
            return Err(error("terminal without ledger result"));
        }
        let mut states = Vec::new();
        for (index, intent) in transaction.items.iter().enumerate() {
            let single = transaction_item_params(store, params, index)?;
            let proposal = inspect_proposal(store, &params.run_id, &single.proposal_id)?;
            if !matches!(
                proposal.operation.as_str(),
                "replace_file" | "create_file" | "delete_file"
            ) || intent.binding != binding(store, &task, &single, &proposal)?
                || has_consumed_apply_authorization(&events, &single.proposal_id)
            {
                return Err(error("item binding or authorization changed"));
            }
            let state = inspect_retained_item(store, &single, &proposal, intent)?;
            let target = if matches!(proposal.operation.as_str(), "create_file" | "delete_file") {
                resolve_create_apply_target_path(store, &proposal)
                    .or_else(|_| resolve_apply_target_path(store, &proposal))
            } else {
                resolve_apply_target_path(store, &proposal)
            }
            .map_err(error)?;
            let staging = staging_path(&target, &intent.staging)?;
            if state.is_none() {
                let witness = witness_path(&target, &intent.witness)?;
                let material = if proposal.operation == "delete_file" {
                    &witness
                } else {
                    &staging
                };
                if proposal.operation == "delete_file" && identity_metadata(&staging).is_ok() {
                    return Err(error("delete staging exists before mutation"));
                }
                let metadata = regular(material)?;
                if metadata.dev() != intent.prepared_device
                    || metadata.ino() != intent.prepared_inode
                    || Some(format!(
                        "sha256:{}",
                        hex_sha256(&std::fs::read(material).map_err(error)?)
                    )) != intent.expected_post_write_sha256
                {
                    return Err(error("pending item material changed"));
                }
            }
            states.push((single, proposal, target, staging, state));
        }
        for (index, (single, proposal, target, staging, state)) in states.into_iter().enumerate() {
            if state.is_none() {
                let prepared = PreparedAtomicReplace {
                    temp_path: staging,
                    parent_path: target
                        .parent()
                        .ok_or_else(|| error("missing parent"))?
                        .to_path_buf(),
                };
                match proposal.operation.as_str() {
                    "create_file" => {
                        std::fs::hard_link(&prepared.temp_path, &target).map_err(error)?;
                    }
                    "delete_file" => {
                        std::fs::rename(&target, &prepared.temp_path).map_err(error)?;
                    }
                    _ => {
                        // The intent owns this staging file until the rename succeeds.
                        // A transient failure must leave it available for the next retry.
                        #[cfg(test)]
                        if std::env::var("CODEX_TX_FAIL_RENAME_INDEX").ok().as_deref()
                            == Some(index.to_string().as_str())
                        {
                            return Err(error(std::io::Error::from(
                                std::io::ErrorKind::PermissionDenied,
                            )));
                        }
                        std::fs::rename(&prepared.temp_path, &target).map_err(error)?;
                    }
                }
                brownie_store::sync_directory_metadata(
                    target.parent().ok_or_else(|| error("missing parent"))?,
                )
                .map_err(error)?;
                #[cfg(test)]
                crash_boundary(&format!("tx-after-{index}"));
            }
            let applied =
                inspect_retained_item(store, &single, &proposal, &transaction.items[index])?
                    .ok_or_else(|| error("item not applied"))?;
            let result = &mut transaction.result.transaction_items[index];
            result.apply_status = "Applied".into();
            result.apply_reason = "Retained item identity and hash verified".into();
            result.applied = true;
            result.atomic_replacement_completed = applied.atomic_replacement_completed;
            result.atomic_create_completed = applied.atomic_create_completed;
            result.atomic_delete_completed =
                (proposal.operation == "delete_file").then_some(applied.atomic_delete_completed);
            result.post_delete_target_exists = applied.post_delete_target_exists;
            result.post_write_sha256 = applied.post_write_sha256;
            result.temp_file_cleaned = true;
        }
        transaction.result.apply_status = "Applied".into();
        transaction.result.apply_reason = "All transaction items durably verified".into();
        transaction.result.applied = true;
        transaction.result.authorization_consumed = true;
        transaction.result.atomic_replacement_completed = matches!(
            transaction.result.operation.as_str(),
            "replace_file_transaction" | "replace_file_transaction_recovery"
        );
        transaction.result.atomic_create_completed = matches!(
            transaction.result.operation.as_str(),
            "create_file_transaction" | "create_file_transaction_recovery"
        );
        transaction.result.atomic_delete_completed = matches!(
            transaction.result.operation.as_str(),
            "delete_file_transaction" | "delete_file_transaction_recovery"
        );
        transaction.result.post_delete_target_exists =
            transaction.result.atomic_delete_completed.then_some(false);
        transaction.result.transaction_status = Some("Applied".into());
        if params.transaction_recovery_source.is_some() {
            transaction.result.transaction_recovery_status = Some("Applied".into());
        }
        transaction
            .result
            .applied_at
            .get_or_insert_with(now_rfc3339);
        transaction.result.check_count = transaction.result.checklist.len();
        transaction.result.failed_checks = transaction
            .result
            .checklist
            .iter()
            .filter(|c| c.status == "Fail")
            .map(|c| c.name.clone())
            .collect();
        transaction.result.blocked_checks = transaction
            .result
            .checklist
            .iter()
            .filter(|c| c.status == "Blocked")
            .map(|c| c.name.clone())
            .collect();
        persist_transaction(&path, &transaction, false)?;
        record_apply_result(
            store,
            &task,
            &params.run_id,
            &transaction.result.proposal_id,
            transaction.result.clone(),
        )?;
        #[cfg(test)]
        crash_boundary("tx-recorded");
    }
    let events = read_existing_run_events(store, &params.run_id)?;
    let payloads: Vec<_> = events
        .iter()
        .filter(|e| e.kind == LedgerEventKind::WorkspacePatchApplyResultRecorded)
        .filter_map(|e| e.payload.as_ref())
        .filter(|p| p["apply_id"] == transaction.result.apply_id)
        .collect();
    let response_digest = hex_sha256(&serde_json::to_vec(&transaction.result).map_err(error)?);
    if payloads.len() != 1
        || payloads[0]["recorded_response_sha256"].as_str() != Some(response_digest.as_str())
        || payloads[0]["apply_status"] != "Applied"
        || payloads[0]["authorization_consumed"] != true
        || payloads[0]["transaction_items"] != json!(transaction.result.transaction_items)
        || payloads[0]["transaction_id"] != json!(transaction.result.transaction_id)
    {
        return Err(error("transaction result mismatch"));
    }
    // Validate every target and all retained cleanup material before writing the
    // terminal state or removing any witness. Missing witnesses are allowed only
    // for already-recorded, partially completed cleanup.
    for (index, intent) in transaction.items.iter().enumerate() {
        let single = transaction_item_params(store, params, index)?;
        let proposal = inspect_proposal(store, &params.run_id, &single.proposal_id)?;
        let target = if matches!(proposal.operation.as_str(), "create_file" | "delete_file") {
            resolve_create_apply_target_path(store, &proposal)
                .or_else(|_| resolve_apply_target_path(store, &proposal))
        } else {
            resolve_apply_target_path(store, &proposal)
        }
        .map_err(error)?;
        if proposal.operation == "delete_file" {
            match identity_metadata(&target) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                _ => return Err(error("committed deleted target reappeared")),
            }
        } else {
            let tm = regular(&target)?;
            if tm.dev() != intent.prepared_device
                || tm.ino() != intent.prepared_inode
                || Some(format!(
                    "sha256:{}",
                    hex_sha256(&std::fs::read(&target).map_err(error)?)
                )) != intent.expected_post_write_sha256
            {
                return Err(error("committed transaction target changed"));
            }
        }
        let witness = witness_path(&target, &intent.witness)?;
        let staging = staging_path(&target, &intent.staging)?;
        let mut present = [false; 2];
        for (slot, material) in [&witness, &staging].iter().enumerate() {
            match identity_metadata(material) {
                Ok(m) => {
                    if !m.is_file()
                        || m.dev() != intent.prepared_device
                        || m.ino() != intent.prepared_inode
                    {
                        return Err(error("transaction cleanup material changed"));
                    }
                    if proposal.operation == "delete_file"
                        && Some(format!(
                            "sha256:{}",
                            hex_sha256(&std::fs::read(material).map_err(error)?)
                        )) != intent.expected_post_write_sha256
                    {
                        return Err(error("deleted retained content changed"));
                    }
                    present[slot] = true;
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(error(e)),
            }
        }
        if present[1] && !present[0] {
            return Err(error("staging without witness"));
        }
    }
    let digest = hex_sha256(&serde_json::to_vec(payloads[0]).map_err(error)?);
    if transaction.terminal.as_ref().is_some_and(|d| d != &digest) {
        return Err(error("transaction terminal mismatch"));
    }
    transaction.terminal = Some(digest);
    persist_transaction(&path, &transaction, false)?;
    #[cfg(test)]
    crash_boundary("tx-terminal");
    for (index, intent) in transaction.items.iter().enumerate() {
        let single = transaction_item_params(store, params, index)?;
        let proposal = inspect_proposal(store, &params.run_id, &single.proposal_id)?;
        let target = if matches!(proposal.operation.as_str(), "create_file" | "delete_file") {
            resolve_create_apply_target_path(store, &proposal)
                .or_else(|_| resolve_apply_target_path(store, &proposal))
        } else {
            resolve_apply_target_path(store, &proposal)
        }
        .map_err(error)?;
        let witness = witness_path(&target, &intent.witness)?;
        let staging = staging_path(&target, &intent.staging)?;
        match identity_metadata(&witness) {
            Ok(_) => {
                let wm = regular(&witness)?;
                if wm.dev() != intent.prepared_device || wm.ino() != intent.prepared_inode {
                    return Err(error("transaction witness changed"));
                }
                if let Ok(sm) = identity_metadata(&staging) {
                    if !sm.is_file() || sm.dev() != wm.dev() || sm.ino() != wm.ino() {
                        return Err(error("transaction staging changed"));
                    }
                    std::fs::remove_file(&staging).map_err(error)?;
                }
                std::fs::remove_file(witness).map_err(error)?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound && !staging.exists() => {}
            Err(e) => return Err(error(e)),
        }
    }
    std::fs::remove_file(path).map_err(error)?;
    Ok(Some((
        inspect_proposal(store, &params.run_id, &transaction.result.proposal_id)?,
        transaction.result,
    )))
}

#[cfg(test)]
mod identity_tests {
    use super::*;

    #[test]
    fn replacement_directory_sync_failure_preserves_mutation_status() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("target");
        std::fs::write(&target, b"before").unwrap();
        let mut prepared = prepare_atomic_replace_existing_file(&target, b"after")
            .prepared
            .unwrap();
        let staging = prepared.temp_path.clone();
        // Force only the directory-sync step to fail, after the real rename.
        prepared.parent_path = root.path().join("missing-directory");
        let outcome = commit_prepared_atomic_replace(prepared, &target);
        assert!(outcome.atomic_replacement_completed);
        assert!(outcome.temp_file_cleaned);
        assert_eq!(
            outcome.failure_reason,
            Some("Parent directory sync failed after atomic replacement.")
        );
        assert!(outcome.post_write_sha256.is_none());
        assert_eq!(std::fs::read(&target).unwrap(), b"after");
        assert!(!staging.exists());
    }

    #[test]
    fn full_width_identity_roundtrips_without_truncation() {
        let mut high = [0_u8; 16];
        high[15] = 128;
        let ids = [
            FileId::Unix(u64::MAX),
            FileId::Windows([0; 16]),
            FileId::Windows(high),
        ];
        assert_ne!(ids[1], ids[2]);
        for id in ids {
            let encoded = serde_json::to_vec(&id).unwrap();
            assert_eq!(serde_json::from_slice::<FileId>(&encoded).unwrap(), id);
        }
        assert_eq!(
            serde_json::from_str::<FileId>("18446744073709551615").unwrap(),
            ids[0]
        );
        assert!(serde_json::from_str::<FileId>("[1,2]").is_err());
    }

    #[test]
    fn hard_link_identity_differs_from_same_content_copy() {
        let root = tempfile::tempdir().unwrap();
        let original = root.path().join("original");
        let witness = root.path().join("witness");
        let foreign = root.path().join("foreign");
        std::fs::write(&original, b"same content").unwrap();
        std::fs::hard_link(&original, &witness).unwrap();
        std::fs::write(&foreign, b"same content").unwrap();
        let a = identity_metadata(&original).unwrap();
        let b = identity_metadata(&witness).unwrap();
        let c = identity_metadata(&foreign).unwrap();
        assert_eq!((a.dev(), a.ino()), (b.dev(), b.ino()));
        assert_ne!((a.dev(), a.ino()), (c.dev(), c.ino()));
    }
}
