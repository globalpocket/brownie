//! Bounded replace-file recovery. Intent metadata uses the same trusted store
//! boundary as approval/ledger records. Temporary content is never serialized.
//! A live hard-link witness prevents inode reuse from becoming success evidence.
use super::*;
use std::os::unix::fs::MetadataExt;

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Intent {
    version: u32,
    binding: String,
    target_path_hash: String,
    witness: String,
    staging: String,
    prepared_device: u64,
    prepared_inode: u64,
    old_device: u64,
    old_inode: u64,
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
    let value = json!({"request": params, "approved_at": proposal.approved_at,
        "path": proposal.path, "policy": resolve_apply_write_policy(store, task)?});
    Ok(hex_sha256(&serde_json::to_vec(&value).map_err(error)?))
}

fn regular(path: &Path) -> Result<std::fs::Metadata, String> {
    let metadata = std::fs::symlink_metadata(path).map_err(error)?;
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
    if let Ok(metadata) = std::fs::symlink_metadata(staging) {
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
    match std::fs::symlink_metadata(&intent_path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(error(e)),
        Ok(_) => {}
    }
    regular(&intent_path)?;
    let intent: Intent =
        serde_json::from_slice(&std::fs::read(&intent_path).map_err(error)?).map_err(error)?;
    if intent.version != 1
        || intent.binding != binding(store, task, params, proposal)?
        || intent.result.proposal_id != params.proposal_id
        || intent.result.path != proposal.path
        || intent.result.expected_target_sha256 != params.expected_target_sha256
        || intent.result.pre_write_target_sha256 != params.expected_target_sha256
        || intent.result.operation != "replace_file"
        || intent.result.applied
        || intent.result.authorization_consumed
    {
        return Err(error("binding mismatch"));
    }
    let target = resolve_apply_target_path(store, proposal).map_err(error)?;
    if intent.target_path_hash != hex_sha256(target.as_os_str().as_encoded_bytes()) {
        return Err(error("target location changed"));
    }
    let witness = witness_path(&target, &intent.witness)?;
    let tm = regular(&target)?;
    let wm = regular(&witness)?;
    if wm.dev() != intent.prepared_device || wm.ino() != intent.prepared_inode {
        return Err(error("witness identity changed"));
    }
    let staging = staging_path(&target, &intent.staging)?;
    let bytes = std::fs::read(&target).map_err(error)?;
    let current_hash = format!("sha256:{}", hex_sha256(&bytes));
    let expected = format!(
        "sha256:{}",
        hex_sha256(
            params
                .replacement_content
                .as_deref()
                .ok_or_else(|| error("missing content"))?
                .as_bytes()
        )
    );
    if tm.dev() == wm.dev() && tm.ino() == wm.ino() && current_hash == expected {
        let mut result = intent.result;
        result.apply_status = "Applied".to_string();
        result.apply_reason = "Recovered authorized replacement by retained file identity and verified content; result recorded at recovery.".to_string();
        result.applied = true;
        result.authorization_consumed = true;
        result.atomic_replacement_completed = true;
        result.post_write_sha256 = Some(current_hash);
        result.applied_at = Some(now_rfc3339());
        result.temp_file_cleaned = false;
        result.checklist.push(apply_result_check(
            "retained_replacement_identity_verified",
            "Pass",
            None,
        ));
        // Keep the witness until the durable result append succeeds. Failure leaves
        // recovery retryable, without performing another write.
        let (_, result) =
            record_apply_result(store, task, &params.run_id, &params.proposal_id, result)?;
        cleanup(&intent_path, &witness, &staging)?;
        return Ok(Some(result));
    }
    if tm.dev() == intent.old_device
        && tm.ino() == intent.old_inode
        && Some(current_hash.as_str()) == params.expected_target_sha256.as_deref()
    {
        cleanup(&intent_path, &witness, &staging)?;
        return Ok(None);
    }
    Err(error(
        "target differs from both prepared and original identity",
    ))
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
    let bound = binding(store, task, params, proposal)?;
    let metadata = regular(target)?;
    let name = format!(
        ".brownie-replace-witness-{}.tmp",
        uuid::Uuid::new_v4().simple()
    );
    let witness = witness_path(target, &name)?;
    std::fs::hard_link(&prepared.temp_path, &witness).map_err(error)?;
    let prepared_metadata = regular(&witness)?;
    let intent = Intent {
        version: 1,
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
        old_device: metadata.dev(),
        old_inode: metadata.ino(),
        result: result.clone(),
    };
    let destination = path(store, params);
    let persisted = (|| -> Result<(), String> {
        let parent = destination
            .parent()
            .ok_or_else(|| error("missing parent"))?;
        let mut file = tempfile::NamedTempFile::new_in(parent).map_err(error)?;
        serde_json::to_writer(&mut file, &intent).map_err(error)?;
        file.as_file().sync_all().map_err(error)?;
        file.persist_noclobber(&destination).map_err(error)?;
        std::fs::File::open(parent)
            .and_then(|file| file.sync_all())
            .map_err(error)?;
        std::fs::File::open(
            target
                .parent()
                .ok_or_else(|| error("missing target parent"))?,
        )
        .and_then(|file| file.sync_all())
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

pub(super) fn finish(
    store: &BrownieStore,
    params: &ProposalApplyParams,
    witness: &Path,
) -> Result<(), String> {
    let intent_path = path(store, params);
    let intent: Intent =
        serde_json::from_slice(&std::fs::read(&intent_path).map_err(error)?).map_err(error)?;
    let target = witness
        .parent()
        .ok_or_else(|| error("missing parent"))?
        .join(
            Path::new(&intent.result.path)
                .file_name()
                .ok_or_else(|| error("missing target"))?,
        );
    let staging = staging_path(&target, &intent.staging)?;
    cleanup(&intent_path, witness, &staging)
}

/// Finalization after a result append was durable but the process exited before
/// removing temporary witnesses. Never writes the target or adds another result.
pub(super) fn cleanup_recorded(
    store: &BrownieStore,
    params: &ProposalApplyParams,
) -> Result<(), String> {
    let ip = path(store, params);
    match std::fs::symlink_metadata(&ip) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(error(e)),
        Ok(_) => {}
    }
    regular(&ip)?;
    let intent: Intent =
        serde_json::from_slice(&std::fs::read(&ip).map_err(error)?).map_err(error)?;
    let events = read_existing_run_events(store, &params.run_id)?;
    let recorded = events.iter().any(|event| {
        event.kind == LedgerEventKind::WorkspacePatchApplyResultRecorded
            && event.payload.as_ref().is_some_and(|p| {
                p["apply_id"].as_str() == Some(intent.result.apply_id.as_str())
                    && p["proposal_id"].as_str() == Some(params.proposal_id.as_str())
                    && p["apply_status"] == "Applied"
                    && p["authorization_consumed"] == true
            })
    });
    if !recorded {
        return Err(error("no committed result"));
    }
    let proposal = inspect_proposal(store, &params.run_id, &params.proposal_id)?;
    let target = resolve_apply_target_path(store, &proposal).map_err(error)?;
    if intent.target_path_hash != hex_sha256(target.as_os_str().as_encoded_bytes()) {
        return Err(error("target location changed"));
    }
    let witness = witness_path(&target, &intent.witness)?;
    let staging = staging_path(&target, &intent.staging)?;
    match std::fs::symlink_metadata(&witness) {
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
    }
}

#[cfg(test)]
pub(super) fn crash_boundary(boundary: &str) {
    if std::env::var("CODEX_R05_2_EXIT").ok().as_deref() == Some(boundary) {
        std::process::exit(match boundary {
            "before" => 85,
            "after" => 86,
            _ => 87,
        });
    }
}
