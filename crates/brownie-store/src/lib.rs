//! Brownie persistence crate.

use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use brownie_protocol::{
    ChildTaskSourceIntentSummary, CodebaseIndexSnapshotManifest, HeadlessRunAdvanceResult,
    HeadlessRunCompletionFinalization, HeadlessRunDriveResult, LlmProviderFailureRetryProvenance,
    ModePackActiveSnapshotSummary, ModePackApprovedCandidateSummary,
    ModePackCandidateProvenanceSummary, ModePackCandidateSummary, ModePackFetchCandidateResult,
    ModePackRegistryUpdateSelectionSummary, ModePackRevokedSignerSummary,
    ModePackTrustedSignerSummary, ModePackUpdateAdmissionSummary, PatchApplyRecoveryProvenance,
    RecoveryCycleChildProvenance, TaskRecord, TaskStartParams, TaskStatus,
    VerificationRecoveryProvenance, VerificationRecoveryRetryProvenance,
};
use serde::{Deserialize, Serialize};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use uuid::Uuid;

pub const WORKSPACE_STATE_DIR: &str = ".brownie";
pub const RUNS_DIR: &str = "runs";
pub const CODEBASE_INDEX_DIR: &str = "codebase-index";
const HEADLESS_CONTINUATIONS_DIR: &str = "headless-continuations";
const HEADLESS_RUN_SESSIONS_DIR: &str = "headless-run-sessions";
const MODEPACK_ACTIVE_DIR: &str = "modepack-active";
const MODEPACK_CANDIDATES_DIR: &str = "modepack-candidates";
const RUN_ADMISSION_LOCK_RETRIES: usize = 200;
const RUN_ADMISSION_LOCK_SLEEP: Duration = Duration::from_millis(10);
const CODEBASE_INDEX_LOCK_STALE_AFTER_SECONDS: i64 = 30 * 60;

#[derive(Debug, Clone)]
pub struct BrownieStore {
    task_store: TaskStore,
}

impl BrownieStore {
    pub fn new(workspace_root: impl Into<PathBuf>) -> Self {
        Self {
            task_store: TaskStore::new(workspace_root),
        }
    }

    pub fn from_env_or_cwd() -> Result<Self> {
        let workspace_root = match std::env::var_os("BROWNIE_WORKSPACE_ROOT") {
            Some(root) => PathBuf::from(root),
            None => std::env::current_dir().context("failed to read current working directory")?,
        };
        Ok(Self::new(workspace_root))
    }

    pub fn tasks(&self) -> &TaskStore {
        &self.task_store
    }

    pub fn codebase_index(&self) -> CodebaseIndexStore {
        CodebaseIndexStore::new(self.workspace_root().to_path_buf())
    }

    pub fn read_active_modepack_snapshot(&self) -> Result<Option<ActiveModePackSnapshot>> {
        let path = self.active_modepack_current_path();
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        Ok(Some(serde_json::from_str(&content).with_context(|| {
            format!("failed to parse {}", path.display())
        })?))
    }

    pub fn commit_active_modepack_snapshot(
        &self,
        snapshot: &ActiveModePackSnapshot,
    ) -> Result<ModePackActivationCommit> {
        if let Some(existing) = self.read_active_modepack_snapshot()? {
            if existing.summary.source_path == snapshot.summary.source_path
                && existing.summary.activation_fingerprint
                    == snapshot.summary.activation_fingerprint
            {
                return Ok(ModePackActivationCommit {
                    replayed: true,
                    event_id: existing.summary.activation_event_id.clone(),
                    snapshot: existing,
                });
            }
            bail!(
                "conflicting active modepack snapshot for source {}",
                snapshot.summary.source_path
            );
        }

        let root = self.active_modepack_dir();
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create {}", root.display()))?;
        let mut committed = snapshot.clone();
        committed.summary.activation_event_id = format!("event_{}", Uuid::new_v4());
        let body = serde_json::to_string_pretty(&committed)
            .context("failed to serialize active modepack snapshot")?;
        write_file_atomically(&root.join("current.json"), body.as_bytes())
            .context("failed to write active modepack snapshot")?;
        let event = ActiveModePackLedgerEvent {
            event_id: committed.summary.activation_event_id.clone(),
            kind: "ModePackActivated".to_string(),
            timestamp: committed.summary.activated_at.clone(),
            payload: serde_json::to_value(&committed.summary)
                .context("failed to serialize active modepack summary")?,
        };
        self.append_active_modepack_event(&event)?;
        Ok(ModePackActivationCommit {
            replayed: false,
            event_id: event.event_id,
            snapshot: committed,
        })
    }

    pub fn replace_active_modepack_snapshot(
        &self,
        expected_current_activation_fingerprint: &str,
        snapshot: &ActiveModePackSnapshot,
        update_admission: Option<&ModePackUpdateAdmissionSummary>,
    ) -> Result<ModePackReplacementCommit> {
        if let Some(replayed) = self.find_replayed_active_modepack_replacement(
            expected_current_activation_fingerprint,
            &snapshot.summary.activation_fingerprint,
        )? {
            return Ok(replayed);
        }

        let Some(previous) = self.read_active_modepack_snapshot()? else {
            bail!("missing active modepack snapshot");
        };
        if previous.summary.activation_fingerprint != expected_current_activation_fingerprint {
            bail!(
                "stale active modepack snapshot: expected {} but found {}",
                expected_current_activation_fingerprint,
                previous.summary.activation_fingerprint
            );
        }
        if previous.summary.activation_fingerprint == snapshot.summary.activation_fingerprint {
            bail!("replacement modepack activation fingerprint matches current snapshot");
        }

        let root = self.active_modepack_dir();
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create {}", root.display()))?;
        let mut replacement = snapshot.clone();
        replacement.summary.activation_event_id = format!("event_{}", Uuid::new_v4());
        let body = serde_json::to_string_pretty(&replacement)
            .context("failed to serialize active modepack snapshot")?;
        write_file_atomically(&root.join("current.json"), body.as_bytes())
            .context("failed to write replacement active modepack snapshot")?;
        let verified = self
            .read_active_modepack_snapshot()
            .context("failed to verify replacement active modepack snapshot")?
            .context("replacement active modepack snapshot was not persisted")?;
        if verified.summary.activation_fingerprint != replacement.summary.activation_fingerprint {
            let previous_body = serde_json::to_string_pretty(&previous)
                .context("failed to serialize previous active modepack snapshot")?;
            let _ = write_file_atomically(&root.join("current.json"), previous_body.as_bytes());
            bail!("replacement active modepack snapshot verification failed");
        }

        let update_admission = update_admission.map(|summary| {
            let mut summary = summary.clone();
            summary.admission_event_id = replacement.summary.activation_event_id.clone();
            summary
        });
        let event = ActiveModePackLedgerEvent {
            event_id: replacement.summary.activation_event_id.clone(),
            kind: "ModePackReplaced".to_string(),
            timestamp: replacement.summary.activated_at.clone(),
            payload: serde_json::json!({
                "previous_snapshot": previous.summary,
                "replacement_snapshot": replacement.summary,
                "previous_snapshot_full": previous,
                "update_admission": update_admission,
            }),
        };
        if let Err(error) = self.append_active_modepack_event(&event) {
            let previous_body = serde_json::to_string_pretty(&previous)
                .context("failed to serialize previous active modepack snapshot")?;
            let _ = write_file_atomically(&root.join("current.json"), previous_body.as_bytes());
            return Err(error).context("failed to append active modepack replacement ledger");
        }

        Ok(ModePackReplacementCommit {
            replayed: false,
            event_id: event.event_id,
            previous_snapshot: previous,
            replacement_snapshot: replacement,
            update_admission,
        })
    }

    pub fn rollback_active_modepack_snapshot(
        &self,
        expected_current_activation_fingerprint: &str,
        expected_rollback_activation_fingerprint: &str,
    ) -> Result<ModePackRollbackCommit> {
        if let Some(replayed) = self.find_replayed_active_modepack_rollback(
            expected_current_activation_fingerprint,
            expected_rollback_activation_fingerprint,
        )? {
            return Ok(replayed);
        }

        let Some(current) = self.read_active_modepack_snapshot()? else {
            bail!("missing active modepack snapshot");
        };
        if current.summary.activation_fingerprint != expected_current_activation_fingerprint {
            bail!(
                "stale active modepack snapshot: expected {} but found {}",
                expected_current_activation_fingerprint,
                current.summary.activation_fingerprint
            );
        }

        let rollback_snapshot = self
            .latest_rollback_capable_previous_snapshot()?
            .context("missing rollback-capable active modepack replacement evidence")?;
        if rollback_snapshot.summary.activation_fingerprint
            != expected_rollback_activation_fingerprint
        {
            bail!(
                "rollback modepack activation fingerprint mismatch: expected {} but found {}",
                expected_rollback_activation_fingerprint,
                rollback_snapshot.summary.activation_fingerprint
            );
        }
        if rollback_snapshot.summary.activation_fingerprint
            == current.summary.activation_fingerprint
        {
            bail!("rollback modepack activation fingerprint matches current snapshot");
        }

        let root = self.active_modepack_dir();
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create {}", root.display()))?;
        let restored_body = serde_json::to_string_pretty(&rollback_snapshot)
            .context("failed to serialize rollback active modepack snapshot")?;
        write_file_atomically(&root.join("current.json"), restored_body.as_bytes())
            .context("failed to write rollback active modepack snapshot")?;
        let verified = self
            .read_active_modepack_snapshot()
            .context("failed to verify rollback active modepack snapshot")?
            .context("rollback active modepack snapshot was not persisted")?;
        if verified.summary.activation_fingerprint
            != rollback_snapshot.summary.activation_fingerprint
        {
            let current_body = serde_json::to_string_pretty(&current)
                .context("failed to serialize current active modepack snapshot")?;
            let _ = write_file_atomically(&root.join("current.json"), current_body.as_bytes());
            bail!("rollback active modepack snapshot verification failed");
        }

        let event = ActiveModePackLedgerEvent {
            event_id: format!("event_{}", Uuid::new_v4()),
            kind: "ModePackRolledBack".to_string(),
            timestamp: timestamp().context("failed to timestamp active modepack rollback")?,
            payload: serde_json::json!({
                "current_snapshot": current.summary,
                "restored_snapshot": rollback_snapshot.summary,
            }),
        };
        if let Err(error) = self.append_active_modepack_event(&event) {
            let current_body = serde_json::to_string_pretty(&current)
                .context("failed to serialize current active modepack snapshot")?;
            let _ = write_file_atomically(&root.join("current.json"), current_body.as_bytes());
            return Err(error).context("failed to append active modepack rollback ledger");
        }

        Ok(ModePackRollbackCommit {
            replayed: false,
            event_id: event.event_id,
            current_snapshot: current,
            restored_snapshot: rollback_snapshot,
        })
    }

    fn find_replayed_active_modepack_replacement(
        &self,
        expected_current_activation_fingerprint: &str,
        expected_candidate_activation_fingerprint: &str,
    ) -> Result<Option<ModePackReplacementCommit>> {
        let ledger_path = self.active_modepack_dir().join("ledger.jsonl");
        let file = match OpenOptions::new().read(true).open(&ledger_path) {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(error).with_context(|| {
                    format!(
                        "failed to open active modepack ledger {}",
                        ledger_path.display()
                    )
                })
            }
        };
        for line in BufReader::new(file).lines() {
            let line = line.context("failed to read active modepack ledger")?;
            if line.trim().is_empty() {
                continue;
            }
            let event: ActiveModePackLedgerEvent =
                serde_json::from_str(&line).context("failed to parse active modepack ledger")?;
            if event.kind != "ModePackReplaced" {
                continue;
            }
            let previous = event
                .payload
                .get("previous_snapshot")
                .cloned()
                .and_then(|value| {
                    serde_json::from_value::<ModePackActiveSnapshotSummary>(value).ok()
                });
            let replacement =
                event
                    .payload
                    .get("replacement_snapshot")
                    .cloned()
                    .and_then(|value| {
                        serde_json::from_value::<ModePackActiveSnapshotSummary>(value).ok()
                    });
            let (Some(previous), Some(replacement)) = (previous, replacement) else {
                continue;
            };
            let update_admission =
                event
                    .payload
                    .get("update_admission")
                    .cloned()
                    .and_then(|value| {
                        serde_json::from_value::<ModePackUpdateAdmissionSummary>(value).ok()
                    });
            if previous.activation_fingerprint == expected_current_activation_fingerprint
                && replacement.activation_fingerprint == expected_candidate_activation_fingerprint
            {
                let Some(current) = self.read_active_modepack_snapshot()? else {
                    return Ok(None);
                };
                if current.summary.activation_fingerprint
                    != expected_candidate_activation_fingerprint
                {
                    return Ok(None);
                }
                return Ok(Some(ModePackReplacementCommit {
                    replayed: true,
                    event_id: event.event_id,
                    previous_snapshot: ActiveModePackSnapshot {
                        summary: previous,
                        policies: Vec::new(),
                    },
                    replacement_snapshot: current,
                    update_admission,
                }));
            }
        }
        Ok(None)
    }

    fn find_replayed_active_modepack_rollback(
        &self,
        expected_current_activation_fingerprint: &str,
        expected_rollback_activation_fingerprint: &str,
    ) -> Result<Option<ModePackRollbackCommit>> {
        for event in self.read_active_modepack_events()? {
            if event.kind != "ModePackRolledBack" {
                continue;
            }
            let current = event
                .payload
                .get("current_snapshot")
                .cloned()
                .and_then(|value| {
                    serde_json::from_value::<ModePackActiveSnapshotSummary>(value).ok()
                });
            let restored = event
                .payload
                .get("restored_snapshot")
                .cloned()
                .and_then(|value| {
                    serde_json::from_value::<ModePackActiveSnapshotSummary>(value).ok()
                });
            let (Some(current), Some(restored)) = (current, restored) else {
                continue;
            };
            if current.activation_fingerprint == expected_current_activation_fingerprint
                && restored.activation_fingerprint == expected_rollback_activation_fingerprint
            {
                let Some(active) = self.read_active_modepack_snapshot()? else {
                    return Ok(None);
                };
                if active.summary.activation_fingerprint != expected_rollback_activation_fingerprint
                {
                    return Ok(None);
                }
                return Ok(Some(ModePackRollbackCommit {
                    replayed: true,
                    event_id: event.event_id,
                    current_snapshot: ActiveModePackSnapshot {
                        summary: current,
                        policies: Vec::new(),
                    },
                    restored_snapshot: active,
                }));
            }
        }
        Ok(None)
    }

    fn latest_rollback_capable_previous_snapshot(&self) -> Result<Option<ActiveModePackSnapshot>> {
        let mut latest = None;
        let mut saw_summary_only_replacement = false;
        for event in self.read_active_modepack_events()? {
            match event.kind.as_str() {
                "ModePackReplaced" => {
                    let Some(value) = event.payload.get("previous_snapshot_full").cloned() else {
                        latest = None;
                        saw_summary_only_replacement = true;
                        continue;
                    };
                    let snapshot: ActiveModePackSnapshot = serde_json::from_value(value)
                        .context("failed to parse rollback-capable previous modepack snapshot")?;
                    latest = Some(snapshot);
                    saw_summary_only_replacement = false;
                }
                "ModePackRolledBack" => {
                    latest = None;
                    saw_summary_only_replacement = false;
                }
                _ => {}
            }
        }
        if saw_summary_only_replacement {
            bail!("latest active modepack replacement evidence is summary-only");
        }
        Ok(latest)
    }

    fn read_active_modepack_events(&self) -> Result<Vec<ActiveModePackLedgerEvent>> {
        let ledger_path = self.active_modepack_dir().join("ledger.jsonl");
        let file = match OpenOptions::new().read(true).open(&ledger_path) {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(error).with_context(|| {
                    format!(
                        "failed to open active modepack ledger {}",
                        ledger_path.display()
                    )
                })
            }
        };
        let mut events = Vec::new();
        for line in BufReader::new(file).lines() {
            let line = line.context("failed to read active modepack ledger")?;
            if line.trim().is_empty() {
                continue;
            }
            events.push(
                serde_json::from_str(&line).context("failed to parse active modepack ledger")?,
            );
        }
        Ok(events)
    }

    pub fn read_modepack_candidate_snapshot(
        &self,
        content_sha256: &str,
    ) -> Result<Option<ModePackCandidateSnapshot>> {
        let path = self.modepack_candidate_cache_path(content_sha256);
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        Ok(Some(serde_json::from_str(&content).with_context(|| {
            format!("failed to parse {}", path.display())
        })?))
    }

    pub fn read_modepack_registry_update_selection_snapshot(
        &self,
        current_activation_fingerprint: &str,
        candidate_content_sha256: &str,
    ) -> Result<Option<ModePackRegistryUpdateSelectionSnapshot>> {
        let path = self.modepack_registry_update_selection_path(
            current_activation_fingerprint,
            candidate_content_sha256,
        );
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        Ok(Some(serde_json::from_str(&content).with_context(|| {
            format!("failed to parse {}", path.display())
        })?))
    }

    pub fn commit_modepack_registry_update_selection_snapshot(
        &self,
        selection: &ModePackRegistryUpdateSelectionSnapshot,
    ) -> Result<ModePackRegistryUpdateSelectionCommit> {
        if let Some(existing) = self.read_modepack_registry_update_selection_snapshot(
            &selection.summary.current_activation_fingerprint,
            &selection.summary.candidate_content_sha256,
        )? {
            if existing.summary.registry_manifest_sha256
                != selection.summary.registry_manifest_sha256
                || existing.summary.registry_url_fingerprint
                    != selection.summary.registry_url_fingerprint
                || existing.summary.provenance_statement_sha256
                    != selection.summary.provenance_statement_sha256
                || existing.summary.registry_provenance_statement_sha256
                    != selection.summary.registry_provenance_statement_sha256
                || existing.summary.registry_signer_fingerprint
                    != selection.summary.registry_signer_fingerprint
                || existing.summary.registry_trusted_signer_trust_id
                    != selection.summary.registry_trusted_signer_trust_id
                || existing.summary.registry_trusted_signer_event_id
                    != selection.summary.registry_trusted_signer_event_id
            {
                bail!(
                    "conflicting Mode Pack registry update selection for {}",
                    selection.summary.candidate_content_sha256
                );
            }
            if !self.modepack_registry_update_selection_event_exists(
                &existing.summary.selection_event_id,
                &existing.summary.current_activation_fingerprint,
                &existing.summary.candidate_content_sha256,
            )? {
                let event = ModePackCandidateLedgerEvent {
                    event_id: existing.summary.selection_event_id.clone(),
                    kind: "ModePackRegistryUpdateSelected".to_string(),
                    timestamp: existing.summary.selected_at.clone(),
                    payload: serde_json::to_value(&existing.summary).context(
                        "failed to serialize Mode Pack registry update selection summary",
                    )?,
                };
                self.append_modepack_candidate_event(&event)?;
            }
            return Ok(ModePackRegistryUpdateSelectionCommit {
                replayed: true,
                event_id: existing.summary.selection_event_id.clone(),
                selection: existing,
            });
        }

        let root = self.modepack_candidates_dir();
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create {}", root.display()))?;
        let mut committed = selection.clone();
        committed.summary.selection_event_id = format!("event_{}", Uuid::new_v4());
        let body = serde_json::to_string_pretty(&committed)
            .context("failed to serialize Mode Pack registry update selection")?;
        write_file_atomically(
            &self.modepack_registry_update_selection_path(
                &committed.summary.current_activation_fingerprint,
                &committed.summary.candidate_content_sha256,
            ),
            body.as_bytes(),
        )
        .context("failed to write Mode Pack registry update selection")?;
        let event = ModePackCandidateLedgerEvent {
            event_id: committed.summary.selection_event_id.clone(),
            kind: "ModePackRegistryUpdateSelected".to_string(),
            timestamp: committed.summary.selected_at.clone(),
            payload: serde_json::to_value(&committed.summary)
                .context("failed to serialize Mode Pack registry update selection summary")?,
        };
        self.append_modepack_candidate_event(&event)?;
        Ok(ModePackRegistryUpdateSelectionCommit {
            replayed: false,
            event_id: event.event_id,
            selection: committed,
        })
    }

    pub fn read_headless_modepack_selected_candidate_fetch_checkpoint(
        &self,
        continuation_id: &str,
    ) -> Result<Option<HeadlessModePackSelectedCandidateFetchCheckpoint>> {
        let path = self.headless_modepack_selected_candidate_fetch_path(continuation_id);
        match fs::read_to_string(&path) {
            Ok(body) => serde_json::from_str(&body)
                .with_context(|| format!("failed to parse {}", path.display()))
                .map(Some),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
        }
    }

    pub fn write_headless_modepack_selected_candidate_fetch_checkpoint(
        &self,
        checkpoint: &HeadlessModePackSelectedCandidateFetchCheckpoint,
    ) -> Result<()> {
        let root = self
            .workspace_root()
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_CONTINUATIONS_DIR);
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create {}", root.display()))?;
        let path =
            self.headless_modepack_selected_candidate_fetch_path(&checkpoint.continuation_id);
        if let Some(existing) = self.read_headless_modepack_selected_candidate_fetch_checkpoint(
            &checkpoint.continuation_id,
        )? {
            if existing == *checkpoint {
                return Ok(());
            }
            bail!(
                "conflicting headless modepack selected candidate fetch checkpoint for {}",
                checkpoint.continuation_id
            );
        }
        let body = serde_json::to_string_pretty(checkpoint)
            .context("failed to serialize headless modepack selected candidate fetch checkpoint")?;
        write_file_atomically(&path, body.as_bytes())
    }

    pub fn commit_modepack_candidate_snapshot(
        &self,
        snapshot: &ModePackCandidateSnapshot,
    ) -> Result<ModePackCandidateCommit> {
        if let Some(existing) =
            self.read_modepack_candidate_snapshot(&snapshot.summary.content_sha256)?
        {
            return Ok(ModePackCandidateCommit {
                replayed: true,
                event_id: existing.summary.cache_event_id.clone(),
                snapshot: existing,
            });
        }

        let root = self.modepack_candidates_dir();
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create {}", root.display()))?;
        let mut committed = snapshot.clone();
        committed.summary.cache_event_id = format!("event_{}", Uuid::new_v4());
        let body = serde_json::to_string_pretty(&committed)
            .context("failed to serialize Mode Pack candidate snapshot")?;
        write_file_atomically(
            &self.modepack_candidate_cache_path(&committed.summary.content_sha256),
            body.as_bytes(),
        )
        .context("failed to write Mode Pack candidate cache")?;
        let event = ModePackCandidateLedgerEvent {
            event_id: committed.summary.cache_event_id.clone(),
            kind: "ModePackCandidateFetched".to_string(),
            timestamp: committed.summary.cached_at.clone(),
            payload: serde_json::to_value(&committed.summary)
                .context("failed to serialize Mode Pack candidate summary")?,
        };
        self.append_modepack_candidate_event(&event)?;
        Ok(ModePackCandidateCommit {
            replayed: false,
            event_id: event.event_id,
            snapshot: committed,
        })
    }

    pub fn read_approved_modepack_candidate_snapshot(
        &self,
        content_sha256: &str,
    ) -> Result<Option<ModePackApprovedCandidateSnapshot>> {
        let path = self.modepack_candidate_approval_path(content_sha256);
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        Ok(Some(serde_json::from_str(&content).with_context(|| {
            format!("failed to parse {}", path.display())
        })?))
    }

    pub fn read_modepack_candidate_provenance_snapshot(
        &self,
        content_sha256: &str,
    ) -> Result<Option<ModePackCandidateProvenanceSnapshot>> {
        let path = self.modepack_candidate_provenance_path(content_sha256);
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        Ok(Some(serde_json::from_str(&content).with_context(|| {
            format!("failed to parse {}", path.display())
        })?))
    }

    pub fn read_modepack_trusted_signer_snapshot(
        &self,
        signer_fingerprint: &str,
    ) -> Result<Option<ModePackTrustedSignerSnapshot>> {
        let path = self.modepack_trusted_signer_path(signer_fingerprint);
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        Ok(Some(serde_json::from_str(&content).with_context(|| {
            format!("failed to parse {}", path.display())
        })?))
    }

    pub fn read_modepack_revoked_signer_snapshot(
        &self,
        signer_fingerprint: &str,
    ) -> Result<Option<ModePackRevokedSignerSnapshot>> {
        let path = self.modepack_revoked_signer_path(signer_fingerprint);
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        Ok(Some(serde_json::from_str(&content).with_context(|| {
            format!("failed to parse {}", path.display())
        })?))
    }

    pub fn trust_modepack_signer_snapshot(
        &self,
        trusted: &ModePackTrustedSignerSnapshot,
    ) -> Result<ModePackTrustedSignerCommit> {
        if let Some(existing) =
            self.read_modepack_trusted_signer_snapshot(&trusted.summary.signer_fingerprint)?
        {
            if !self.modepack_trusted_signer_event_exists(
                &existing.summary.trust_event_id,
                &existing.summary.signer_fingerprint,
            )? {
                let event = ModePackCandidateLedgerEvent {
                    event_id: existing.summary.trust_event_id.clone(),
                    kind: "ModePackSignerTrusted".to_string(),
                    timestamp: existing.summary.trusted_at.clone(),
                    payload: serde_json::to_value(&existing.summary)
                        .context("failed to serialize Mode Pack trusted signer summary")?,
                };
                self.append_modepack_candidate_event(&event)?;
            }
            return Ok(ModePackTrustedSignerCommit {
                replayed: true,
                event_id: existing.summary.trust_event_id.clone(),
                trusted_signer: existing,
            });
        }

        let root = self.modepack_candidates_dir();
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create {}", root.display()))?;
        let mut committed = trusted.clone();
        committed.summary.trust_event_id = format!("event_{}", Uuid::new_v4());
        let body = serde_json::to_string_pretty(&committed)
            .context("failed to serialize Mode Pack trusted signer")?;
        write_file_atomically(
            &self.modepack_trusted_signer_path(&committed.summary.signer_fingerprint),
            body.as_bytes(),
        )
        .context("failed to write Mode Pack trusted signer")?;
        let event = ModePackCandidateLedgerEvent {
            event_id: committed.summary.trust_event_id.clone(),
            kind: "ModePackSignerTrusted".to_string(),
            timestamp: committed.summary.trusted_at.clone(),
            payload: serde_json::to_value(&committed.summary)
                .context("failed to serialize Mode Pack trusted signer summary")?,
        };
        self.append_modepack_candidate_event(&event)?;
        Ok(ModePackTrustedSignerCommit {
            replayed: false,
            event_id: event.event_id,
            trusted_signer: committed,
        })
    }

    pub fn revoke_modepack_signer_snapshot(
        &self,
        revoked: &ModePackRevokedSignerSnapshot,
    ) -> Result<ModePackRevokedSignerCommit> {
        if let Some(existing) =
            self.read_modepack_revoked_signer_snapshot(&revoked.summary.signer_fingerprint)?
        {
            if !self.modepack_revoked_signer_event_exists(
                &existing.summary.revocation_event_id,
                &existing.summary.signer_fingerprint,
            )? {
                let event = ModePackCandidateLedgerEvent {
                    event_id: existing.summary.revocation_event_id.clone(),
                    kind: "ModePackSignerRevoked".to_string(),
                    timestamp: existing.summary.revoked_at.clone(),
                    payload: serde_json::to_value(&existing.summary)
                        .context("failed to serialize Mode Pack revoked signer summary")?,
                };
                self.append_modepack_candidate_event(&event)?;
            }
            return Ok(ModePackRevokedSignerCommit {
                replayed: true,
                event_id: existing.summary.revocation_event_id.clone(),
                revoked_signer: existing,
            });
        }

        let root = self.modepack_candidates_dir();
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create {}", root.display()))?;
        let mut committed = revoked.clone();
        committed.summary.revocation_event_id = format!("event_{}", Uuid::new_v4());
        let body = serde_json::to_string_pretty(&committed)
            .context("failed to serialize Mode Pack revoked signer")?;
        write_file_atomically(
            &self.modepack_revoked_signer_path(&committed.summary.signer_fingerprint),
            body.as_bytes(),
        )
        .context("failed to write Mode Pack revoked signer")?;
        let event = ModePackCandidateLedgerEvent {
            event_id: committed.summary.revocation_event_id.clone(),
            kind: "ModePackSignerRevoked".to_string(),
            timestamp: committed.summary.revoked_at.clone(),
            payload: serde_json::to_value(&committed.summary)
                .context("failed to serialize Mode Pack revoked signer summary")?,
        };
        self.append_modepack_candidate_event(&event)?;
        Ok(ModePackRevokedSignerCommit {
            replayed: false,
            event_id: event.event_id,
            revoked_signer: committed,
        })
    }

    pub fn verify_modepack_candidate_provenance_snapshot(
        &self,
        provenance: &ModePackCandidateProvenanceSnapshot,
    ) -> Result<ModePackCandidateProvenanceCommit> {
        if let Some(existing) =
            self.read_modepack_candidate_provenance_snapshot(&provenance.summary.content_sha256)?
        {
            if existing.summary.compiled_policy_fingerprint
                != provenance.summary.compiled_policy_fingerprint
                || existing.summary.signer_fingerprint != provenance.summary.signer_fingerprint
                || existing.summary.statement_sha256 != provenance.summary.statement_sha256
                || existing.summary.signature_sha256 != provenance.summary.signature_sha256
            {
                bail!(
                    "conflicting Mode Pack candidate provenance for {}",
                    provenance.summary.content_sha256
                );
            }
            if !self.modepack_candidate_provenance_event_exists(
                &existing.summary.provenance_event_id,
                &existing.summary.content_sha256,
                &existing.summary.signer_fingerprint,
                &existing.summary.statement_sha256,
            )? {
                let event = ModePackCandidateLedgerEvent {
                    event_id: existing.summary.provenance_event_id.clone(),
                    kind: "ModePackCandidateProvenanceVerified".to_string(),
                    timestamp: existing.summary.verified_at.clone(),
                    payload: serde_json::to_value(&existing.summary)
                        .context("failed to serialize Mode Pack candidate provenance summary")?,
                };
                self.append_modepack_candidate_event(&event)?;
            }
            return Ok(ModePackCandidateProvenanceCommit {
                replayed: true,
                event_id: existing.summary.provenance_event_id.clone(),
                provenance: existing,
            });
        }

        let root = self.modepack_candidates_dir();
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create {}", root.display()))?;
        let mut committed = provenance.clone();
        committed.summary.provenance_event_id = format!("event_{}", Uuid::new_v4());
        let body = serde_json::to_string_pretty(&committed)
            .context("failed to serialize Mode Pack candidate provenance")?;
        write_file_atomically(
            &self.modepack_candidate_provenance_path(&committed.summary.content_sha256),
            body.as_bytes(),
        )
        .context("failed to write Mode Pack candidate provenance")?;
        let event = ModePackCandidateLedgerEvent {
            event_id: committed.summary.provenance_event_id.clone(),
            kind: "ModePackCandidateProvenanceVerified".to_string(),
            timestamp: committed.summary.verified_at.clone(),
            payload: serde_json::to_value(&committed.summary)
                .context("failed to serialize Mode Pack candidate provenance summary")?,
        };
        self.append_modepack_candidate_event(&event)?;
        Ok(ModePackCandidateProvenanceCommit {
            replayed: false,
            event_id: event.event_id,
            provenance: committed,
        })
    }

    pub fn approve_modepack_candidate_snapshot(
        &self,
        approval: &ModePackApprovedCandidateSnapshot,
    ) -> Result<ModePackCandidateApprovalCommit> {
        if let Some(existing) =
            self.read_approved_modepack_candidate_snapshot(&approval.summary.content_sha256)?
        {
            if existing.summary.compiled_policy_fingerprint
                != approval.summary.compiled_policy_fingerprint
                || existing.summary.provenance_id != approval.summary.provenance_id
                || existing.summary.provenance_event_id != approval.summary.provenance_event_id
                || existing.summary.trusted_signer_trust_id
                    != approval.summary.trusted_signer_trust_id
                || existing.summary.trusted_signer_event_id
                    != approval.summary.trusted_signer_event_id
                || existing.summary.signer_fingerprint != approval.summary.signer_fingerprint
                || existing.summary.statement_sha256 != approval.summary.statement_sha256
            {
                bail!(
                    "conflicting approved Mode Pack candidate provenance for {}",
                    approval.summary.content_sha256
                );
            }
            if !self.modepack_candidate_approval_event_exists(
                &existing.summary.approval_event_id,
                &existing.summary.content_sha256,
                &existing.summary.compiled_policy_fingerprint,
            )? {
                let event = ModePackCandidateLedgerEvent {
                    event_id: existing.summary.approval_event_id.clone(),
                    kind: "ModePackCandidateApproved".to_string(),
                    timestamp: existing.summary.approved_at.clone(),
                    payload: serde_json::to_value(&existing.summary)
                        .context("failed to serialize approved Mode Pack candidate summary")?,
                };
                self.append_modepack_candidate_event(&event)?;
            }
            return Ok(ModePackCandidateApprovalCommit {
                replayed: true,
                event_id: existing.summary.approval_event_id.clone(),
                approval: existing,
            });
        }

        let root = self.modepack_candidates_dir();
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create {}", root.display()))?;
        let mut committed = approval.clone();
        committed.summary.approval_event_id = format!("event_{}", Uuid::new_v4());
        let body = serde_json::to_string_pretty(&committed)
            .context("failed to serialize approved Mode Pack candidate")?;
        write_file_atomically(
            &self.modepack_candidate_approval_path(&committed.summary.content_sha256),
            body.as_bytes(),
        )
        .context("failed to write approved Mode Pack candidate")?;
        let event = ModePackCandidateLedgerEvent {
            event_id: committed.summary.approval_event_id.clone(),
            kind: "ModePackCandidateApproved".to_string(),
            timestamp: committed.summary.approved_at.clone(),
            payload: serde_json::to_value(&committed.summary)
                .context("failed to serialize approved Mode Pack candidate summary")?,
        };
        self.append_modepack_candidate_event(&event)?;
        Ok(ModePackCandidateApprovalCommit {
            replayed: false,
            event_id: event.event_id,
            approval: committed,
        })
    }

    pub fn consume_approved_modepack_candidate(
        &self,
        content_sha256: &str,
        approval_id: &str,
        replacement_event_id: &str,
        replacement_activation_fingerprint: &str,
    ) -> Result<ModePackCandidateConsumptionCommit> {
        let mut approved = self
            .read_approved_modepack_candidate_snapshot(content_sha256)?
            .context("approved Mode Pack candidate not found")?;
        if approved.summary.approval_id != approval_id {
            bail!(
                "approved Mode Pack candidate approval id mismatch: expected {} but found {}",
                approval_id,
                approved.summary.approval_id
            );
        }
        if approved.summary.consumed {
            if let Some(event_id) = self.modepack_candidate_consumption_event_id(
                approval_id,
                content_sha256,
                replacement_event_id,
                replacement_activation_fingerprint,
            )? {
                return Ok(ModePackCandidateConsumptionCommit {
                    replayed: true,
                    event_id,
                    approval: approved,
                });
            }
            let event = self.modepack_candidate_consumption_event(
                &approved,
                approval_id,
                replacement_event_id,
                replacement_activation_fingerprint,
            )?;
            self.append_modepack_candidate_event(&event)?;
            return Ok(ModePackCandidateConsumptionCommit {
                replayed: true,
                event_id: event.event_id,
                approval: approved,
            });
        }

        approved.summary.consumed = true;
        let body = serde_json::to_string_pretty(&approved)
            .context("failed to serialize consumed approved Mode Pack candidate")?;
        write_file_atomically(
            &self.modepack_candidate_approval_path(content_sha256),
            body.as_bytes(),
        )
        .context("failed to write consumed approved Mode Pack candidate")?;
        let event = self.modepack_candidate_consumption_event(
            &approved,
            approval_id,
            replacement_event_id,
            replacement_activation_fingerprint,
        )?;
        if let Err(error) = self.append_modepack_candidate_event(&event) {
            return Err(error).context("failed to append Mode Pack candidate consumption ledger");
        }
        Ok(ModePackCandidateConsumptionCommit {
            replayed: false,
            event_id: event.event_id,
            approval: approved,
        })
    }

    pub fn workspace_root(&self) -> &std::path::Path {
        self.task_store.workspace_root()
    }

    fn active_modepack_dir(&self) -> PathBuf {
        self.workspace_root()
            .join(WORKSPACE_STATE_DIR)
            .join(MODEPACK_ACTIVE_DIR)
    }

    fn active_modepack_current_path(&self) -> PathBuf {
        self.active_modepack_dir().join("current.json")
    }

    fn modepack_candidates_dir(&self) -> PathBuf {
        self.workspace_root()
            .join(WORKSPACE_STATE_DIR)
            .join(MODEPACK_CANDIDATES_DIR)
    }

    fn modepack_candidate_cache_path(&self, content_sha256: &str) -> PathBuf {
        let slug = content_sha256
            .strip_prefix("sha256:")
            .unwrap_or(content_sha256);
        self.modepack_candidates_dir().join(format!("{slug}.json"))
    }

    fn modepack_registry_update_selection_path(
        &self,
        current_activation_fingerprint: &str,
        candidate_content_sha256: &str,
    ) -> PathBuf {
        let current_slug = current_activation_fingerprint
            .strip_prefix("sha256:")
            .unwrap_or(current_activation_fingerprint);
        let candidate_slug = candidate_content_sha256
            .strip_prefix("sha256:")
            .unwrap_or(candidate_content_sha256);
        self.modepack_candidates_dir().join(format!(
            "registry-selection-{current_slug}-{candidate_slug}.json"
        ))
    }

    fn headless_modepack_selected_candidate_fetch_path(&self, continuation_id: &str) -> PathBuf {
        self.workspace_root()
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_CONTINUATIONS_DIR)
            .join(format!("modepack-selected-fetch-{continuation_id}.json"))
    }

    fn modepack_candidate_approval_path(&self, content_sha256: &str) -> PathBuf {
        let slug = content_sha256
            .strip_prefix("sha256:")
            .unwrap_or(content_sha256);
        self.modepack_candidates_dir()
            .join(format!("{slug}.approved.json"))
    }

    fn modepack_candidate_provenance_path(&self, content_sha256: &str) -> PathBuf {
        let slug = content_sha256
            .strip_prefix("sha256:")
            .unwrap_or(content_sha256);
        self.modepack_candidates_dir()
            .join(format!("{slug}.provenance.json"))
    }

    fn modepack_trusted_signer_path(&self, signer_fingerprint: &str) -> PathBuf {
        let slug = signer_fingerprint
            .strip_prefix("sha256:")
            .unwrap_or(signer_fingerprint);
        self.modepack_candidates_dir()
            .join(format!("trusted-signer-{slug}.json"))
    }

    fn modepack_revoked_signer_path(&self, signer_fingerprint: &str) -> PathBuf {
        let slug = signer_fingerprint
            .strip_prefix("sha256:")
            .unwrap_or(signer_fingerprint);
        self.modepack_candidates_dir()
            .join(format!("revoked-signer-{slug}.json"))
    }

    fn append_active_modepack_event(&self, event: &ActiveModePackLedgerEvent) -> Result<()> {
        let root = self.active_modepack_dir();
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create {}", root.display()))?;
        let mut buffer = Vec::new();
        serde_json::to_writer(&mut buffer, event)
            .context("failed to serialize active modepack ledger event")?;
        writeln!(&mut buffer).context("failed to write active modepack ledger newline")?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(root.join("ledger.jsonl"))
            .context("failed to open active modepack ledger")?;
        file.write_all(&buffer)
            .context("failed to append active modepack ledger")?;
        file.sync_all()
            .context("failed to sync active modepack ledger")?;
        sync_dir(&root);
        Ok(())
    }

    fn append_modepack_candidate_event(&self, event: &ModePackCandidateLedgerEvent) -> Result<()> {
        let root = self.modepack_candidates_dir();
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create {}", root.display()))?;
        let mut buffer = Vec::new();
        serde_json::to_writer(&mut buffer, event)
            .context("failed to serialize Mode Pack candidate ledger event")?;
        writeln!(&mut buffer).context("failed to write Mode Pack candidate ledger newline")?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(root.join("ledger.jsonl"))
            .context("failed to open Mode Pack candidate ledger")?;
        file.write_all(&buffer)
            .context("failed to append Mode Pack candidate ledger")?;
        file.sync_all()
            .context("failed to sync Mode Pack candidate ledger")?;
        sync_dir(&root);
        Ok(())
    }

    fn modepack_candidate_approval_event_exists(
        &self,
        approval_event_id: &str,
        content_sha256: &str,
        compiled_policy_fingerprint: &str,
    ) -> Result<bool> {
        let ledger_path = self.modepack_candidates_dir().join("ledger.jsonl");
        let file = match OpenOptions::new().read(true).open(&ledger_path) {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
            Err(error) => {
                return Err(error).with_context(|| {
                    format!(
                        "failed to open Mode Pack candidate ledger {}",
                        ledger_path.display()
                    )
                })
            }
        };
        for line in BufReader::new(file).lines() {
            let line = line.context("failed to read Mode Pack candidate ledger")?;
            if line.trim().is_empty() {
                continue;
            }
            let event: ModePackCandidateLedgerEvent = serde_json::from_str(&line)
                .context("failed to parse Mode Pack candidate ledger")?;
            if event.kind != "ModePackCandidateApproved" || event.event_id != approval_event_id {
                continue;
            }
            if event
                .payload
                .get("content_sha256")
                .and_then(serde_json::Value::as_str)
                == Some(content_sha256)
                && event
                    .payload
                    .get("compiled_policy_fingerprint")
                    .and_then(serde_json::Value::as_str)
                    == Some(compiled_policy_fingerprint)
            {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn modepack_registry_update_selection_event_exists(
        &self,
        selection_event_id: &str,
        current_activation_fingerprint: &str,
        candidate_content_sha256: &str,
    ) -> Result<bool> {
        let ledger_path = self.modepack_candidates_dir().join("ledger.jsonl");
        let file = match OpenOptions::new().read(true).open(&ledger_path) {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
            Err(error) => {
                return Err(error).with_context(|| {
                    format!(
                        "failed to open Mode Pack candidate ledger {}",
                        ledger_path.display()
                    )
                })
            }
        };
        for line in BufReader::new(file).lines() {
            let line = line.context("failed to read Mode Pack candidate ledger")?;
            if line.trim().is_empty() {
                continue;
            }
            let event: ModePackCandidateLedgerEvent = serde_json::from_str(&line)
                .context("failed to parse Mode Pack candidate ledger")?;
            if event.kind != "ModePackRegistryUpdateSelected"
                || event.event_id != selection_event_id
            {
                continue;
            }
            if event
                .payload
                .get("current_activation_fingerprint")
                .and_then(serde_json::Value::as_str)
                == Some(current_activation_fingerprint)
                && event
                    .payload
                    .get("candidate_content_sha256")
                    .and_then(serde_json::Value::as_str)
                    == Some(candidate_content_sha256)
            {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn modepack_candidate_provenance_event_exists(
        &self,
        provenance_event_id: &str,
        content_sha256: &str,
        signer_fingerprint: &str,
        statement_sha256: &str,
    ) -> Result<bool> {
        let ledger_path = self.modepack_candidates_dir().join("ledger.jsonl");
        let file = match OpenOptions::new().read(true).open(&ledger_path) {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
            Err(error) => {
                return Err(error).with_context(|| {
                    format!(
                        "failed to open Mode Pack candidate ledger {}",
                        ledger_path.display()
                    )
                })
            }
        };
        for line in BufReader::new(file).lines() {
            let line = line.context("failed to read Mode Pack candidate ledger")?;
            if line.trim().is_empty() {
                continue;
            }
            let event: ModePackCandidateLedgerEvent = serde_json::from_str(&line)
                .context("failed to parse Mode Pack candidate ledger")?;
            if event.kind != "ModePackCandidateProvenanceVerified"
                || event.event_id != provenance_event_id
            {
                continue;
            }
            if event
                .payload
                .get("content_sha256")
                .and_then(serde_json::Value::as_str)
                == Some(content_sha256)
                && event
                    .payload
                    .get("signer_fingerprint")
                    .and_then(serde_json::Value::as_str)
                    == Some(signer_fingerprint)
                && event
                    .payload
                    .get("statement_sha256")
                    .and_then(serde_json::Value::as_str)
                    == Some(statement_sha256)
            {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn modepack_trusted_signer_event_exists(
        &self,
        trust_event_id: &str,
        signer_fingerprint: &str,
    ) -> Result<bool> {
        let ledger_path = self.modepack_candidates_dir().join("ledger.jsonl");
        let file = match OpenOptions::new().read(true).open(&ledger_path) {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
            Err(error) => {
                return Err(error).with_context(|| {
                    format!(
                        "failed to open Mode Pack candidate ledger {}",
                        ledger_path.display()
                    )
                })
            }
        };
        for line in BufReader::new(file).lines() {
            let line = line.context("failed to read Mode Pack candidate ledger")?;
            if line.trim().is_empty() {
                continue;
            }
            let event: ModePackCandidateLedgerEvent = serde_json::from_str(&line)
                .context("failed to parse Mode Pack candidate ledger")?;
            if event.kind != "ModePackSignerTrusted" || event.event_id != trust_event_id {
                continue;
            }
            if event
                .payload
                .get("signer_fingerprint")
                .and_then(serde_json::Value::as_str)
                == Some(signer_fingerprint)
            {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn modepack_revoked_signer_event_exists(
        &self,
        revocation_event_id: &str,
        signer_fingerprint: &str,
    ) -> Result<bool> {
        let ledger_path = self.modepack_candidates_dir().join("ledger.jsonl");
        let file = match OpenOptions::new().read(true).open(&ledger_path) {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
            Err(error) => {
                return Err(error).with_context(|| {
                    format!(
                        "failed to open Mode Pack candidate ledger {}",
                        ledger_path.display()
                    )
                })
            }
        };
        for line in BufReader::new(file).lines() {
            let line = line.context("failed to read Mode Pack candidate ledger")?;
            if line.trim().is_empty() {
                continue;
            }
            let event: ModePackCandidateLedgerEvent = serde_json::from_str(&line)
                .context("failed to parse Mode Pack candidate ledger")?;
            if event.kind != "ModePackSignerRevoked" || event.event_id != revocation_event_id {
                continue;
            }
            if event
                .payload
                .get("signer_fingerprint")
                .and_then(serde_json::Value::as_str)
                == Some(signer_fingerprint)
            {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn modepack_candidate_consumption_event_id(
        &self,
        approval_id: &str,
        content_sha256: &str,
        replacement_event_id: &str,
        replacement_activation_fingerprint: &str,
    ) -> Result<Option<String>> {
        let ledger_path = self.modepack_candidates_dir().join("ledger.jsonl");
        let file = match OpenOptions::new().read(true).open(&ledger_path) {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(error).with_context(|| {
                    format!(
                        "failed to open Mode Pack candidate ledger {}",
                        ledger_path.display()
                    )
                })
            }
        };
        for line in BufReader::new(file).lines() {
            let line = line.context("failed to read Mode Pack candidate ledger")?;
            if line.trim().is_empty() {
                continue;
            }
            let event: ModePackCandidateLedgerEvent = serde_json::from_str(&line)
                .context("failed to parse Mode Pack candidate ledger")?;
            if event.kind != "ModePackCandidateConsumed" {
                continue;
            }
            if event
                .payload
                .get("approval_id")
                .and_then(serde_json::Value::as_str)
                == Some(approval_id)
                && event
                    .payload
                    .get("content_sha256")
                    .and_then(serde_json::Value::as_str)
                    == Some(content_sha256)
                && event
                    .payload
                    .get("replacement_event_id")
                    .and_then(serde_json::Value::as_str)
                    == Some(replacement_event_id)
                && event
                    .payload
                    .get("replacement_activation_fingerprint")
                    .and_then(serde_json::Value::as_str)
                    == Some(replacement_activation_fingerprint)
            {
                return Ok(Some(event.event_id));
            }
        }
        Ok(None)
    }

    fn modepack_candidate_consumption_event(
        &self,
        approved: &ModePackApprovedCandidateSnapshot,
        approval_id: &str,
        replacement_event_id: &str,
        replacement_activation_fingerprint: &str,
    ) -> Result<ModePackCandidateLedgerEvent> {
        Ok(ModePackCandidateLedgerEvent {
            event_id: format!("event_{}", Uuid::new_v4()),
            kind: "ModePackCandidateConsumed".to_string(),
            timestamp: timestamp()
                .context("failed to timestamp Mode Pack candidate consumption")?,
            payload: serde_json::json!({
                "approval_id": approval_id,
                "candidate_id": approved.summary.candidate_id,
                "content_sha256": approved.summary.content_sha256,
                "compiled_policy_fingerprint": approved.summary.compiled_policy_fingerprint,
                "replacement_event_id": replacement_event_id,
                "replacement_activation_fingerprint": replacement_activation_fingerprint,
                "consumed": true,
            }),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActiveModePackPolicySnapshot {
    pub mode_id: String,
    pub display_name: String,
    pub role_definition: String,
    pub permissions: serde_json::Value,
    pub allowed_handoff_targets: Option<Vec<String>>,
    pub completion_rules: Vec<String>,
    pub policy_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActiveModePackSnapshot {
    pub summary: ModePackActiveSnapshotSummary,
    pub policies: Vec<ActiveModePackPolicySnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackActivationCommit {
    pub replayed: bool,
    pub event_id: String,
    pub snapshot: ActiveModePackSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackReplacementCommit {
    pub replayed: bool,
    pub event_id: String,
    pub previous_snapshot: ActiveModePackSnapshot,
    pub replacement_snapshot: ActiveModePackSnapshot,
    pub update_admission: Option<ModePackUpdateAdmissionSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackRollbackCommit {
    pub replayed: bool,
    pub event_id: String,
    pub current_snapshot: ActiveModePackSnapshot,
    pub restored_snapshot: ActiveModePackSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct ActiveModePackLedgerEvent {
    event_id: String,
    kind: String,
    timestamp: String,
    payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackCandidateSnapshot {
    pub summary: ModePackCandidateSummary,
    pub modepack_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackCandidateCommit {
    pub replayed: bool,
    pub event_id: String,
    pub snapshot: ModePackCandidateSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackRegistryUpdateSelectionSnapshot {
    pub summary: ModePackRegistryUpdateSelectionSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackRegistryUpdateSelectionCommit {
    pub replayed: bool,
    pub event_id: String,
    pub selection: ModePackRegistryUpdateSelectionSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessModePackSelectedCandidateFetchCheckpoint {
    pub continuation_id: String,
    pub decision_id: String,
    pub expected_progress_fingerprint: String,
    pub expected_aggregate_sequence: u64,
    pub current_progress_fingerprint: String,
    pub current_aggregate_sequence: u64,
    pub post_progress_fingerprint: String,
    pub post_aggregate_sequence: u64,
    pub selection_id: String,
    pub selection_event_id: String,
    pub result: ModePackFetchCandidateResult,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackApprovedCandidateSnapshot {
    pub summary: ModePackApprovedCandidateSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackCandidateApprovalCommit {
    pub replayed: bool,
    pub event_id: String,
    pub approval: ModePackApprovedCandidateSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackCandidateProvenanceSnapshot {
    pub summary: ModePackCandidateProvenanceSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackTrustedSignerSnapshot {
    pub summary: ModePackTrustedSignerSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackRevokedSignerSnapshot {
    pub summary: ModePackRevokedSignerSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackTrustedSignerCommit {
    pub replayed: bool,
    pub event_id: String,
    pub trusted_signer: ModePackTrustedSignerSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackRevokedSignerCommit {
    pub replayed: bool,
    pub event_id: String,
    pub revoked_signer: ModePackRevokedSignerSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackCandidateProvenanceCommit {
    pub replayed: bool,
    pub event_id: String,
    pub provenance: ModePackCandidateProvenanceSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackCandidateConsumptionCommit {
    pub replayed: bool,
    pub event_id: String,
    pub approval: ModePackApprovedCandidateSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct ModePackCandidateLedgerEvent {
    event_id: String,
    kind: String,
    timestamp: String,
    payload: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct TaskStore {
    workspace_root: PathBuf,
}

#[derive(Debug, Clone)]
pub struct CodebaseIndexStore {
    workspace_root: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessContinuationDecisionLookup {
    pub decision_id: String,
    pub continuation_id: String,
    pub selected_task_id: String,
    pub selected_run_id: String,
    pub expected_progress_fingerprint: String,
    pub expected_aggregate_sequence: u64,
    pub candidate_count: usize,
    pub policy_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessRunSessionCheckpoint {
    pub session_id: String,
    pub advance_id: String,
    pub session_sequence: u64,
    pub result: HeadlessRunAdvanceResult,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessRunSessionDriveCheckpoint {
    pub session_id: String,
    pub drive_id: String,
    pub start_session_sequence: u64,
    pub result: HeadlessRunDriveResult,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessRunCompletionFinalizationCheckpoint {
    pub session_id: String,
    pub drive_id: String,
    pub closure_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal_completion_fingerprint: Option<String>,
    pub result: HeadlessRunCompletionFinalization,
}

impl CodebaseIndexStore {
    pub fn new(workspace_root: impl Into<PathBuf>) -> Self {
        Self {
            workspace_root: workspace_root.into(),
        }
    }

    pub fn write_current_snapshot(&self, manifest: &CodebaseIndexSnapshotManifest) -> Result<()> {
        let _lock = self.begin_build()?;
        self.write_snapshot_and_current(manifest)
    }

    pub fn begin_build(&self) -> Result<CodebaseIndexBuildLock> {
        let lock = self.acquire_build_lock()?;
        self.cleanup_temporary_files()?;
        Ok(lock)
    }

    fn write_snapshot_and_current(&self, manifest: &CodebaseIndexSnapshotManifest) -> Result<()> {
        let root = self.index_dir();
        let snapshots_dir = root.join("snapshots");
        fs::create_dir_all(&snapshots_dir)
            .with_context(|| format!("failed to create {}", snapshots_dir.display()))?;

        let body =
            serde_json::to_string_pretty(manifest).context("failed to serialize index snapshot")?;
        let snapshot_path = snapshots_dir.join(format!("{}.json", manifest.snapshot.index_id));
        write_file_atomically(&snapshot_path, body.as_bytes())
            .context("failed to write index snapshot archive")?;
        let current_path = root.join("current.json");
        write_file_atomically(&current_path, body.as_bytes())
            .context("failed to write current index")
    }

    pub fn commit_current_snapshot(
        &self,
        manifest: &CodebaseIndexSnapshotManifest,
        kind: LedgerEventKind,
        payload: serde_json::Value,
    ) -> Result<CodebaseIndexLedgerEvent> {
        let lock = self.begin_build()?;
        self.commit_current_snapshot_with_lock(&lock, manifest, kind, payload)
    }

    pub fn commit_current_snapshot_with_lock(
        &self,
        _lock: &CodebaseIndexBuildLock,
        manifest: &CodebaseIndexSnapshotManifest,
        kind: LedgerEventKind,
        payload: serde_json::Value,
    ) -> Result<CodebaseIndexLedgerEvent> {
        let root = self.index_dir();
        let snapshots_dir = root.join("snapshots");
        fs::create_dir_all(&snapshots_dir)
            .with_context(|| format!("failed to create {}", snapshots_dir.display()))?;

        let body =
            serde_json::to_string_pretty(manifest).context("failed to serialize index snapshot")?;
        let snapshot_path = snapshots_dir.join(format!("{}.json", manifest.snapshot.index_id));
        write_file_atomically(&snapshot_path, body.as_bytes())
            .context("failed to write index snapshot archive")?;

        let event = self.append_event(kind, payload)?;

        let current_path = root.join("current.json");
        write_file_atomically(&current_path, body.as_bytes())
            .context("failed to write current index")?;
        self.write_commit_marker(manifest, &event)
            .context("failed to write codebase index commit marker")?;
        Ok(event)
    }

    pub fn read_current_snapshot(&self) -> Result<Option<CodebaseIndexSnapshotManifest>> {
        let current_path = self.index_dir().join("current.json");
        if !current_path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&current_path)
            .with_context(|| format!("failed to read {}", current_path.display()))?;
        Ok(Some(serde_json::from_str(&content).with_context(|| {
            format!("failed to parse {}", current_path.display())
        })?))
    }

    pub fn append_event(
        &self,
        kind: LedgerEventKind,
        payload: serde_json::Value,
    ) -> Result<CodebaseIndexLedgerEvent> {
        let event = CodebaseIndexLedgerEvent {
            event_id: format!("event_{}", Uuid::new_v4()),
            kind,
            timestamp: timestamp()?,
            payload,
        };
        fs::create_dir_all(self.index_dir())
            .with_context(|| format!("failed to create {}", self.index_dir().display()))?;
        let mut buffer = Vec::new();
        serde_json::to_writer(&mut buffer, &event)
            .context("failed to serialize codebase index ledger event")?;
        writeln!(&mut buffer).context("failed to write index ledger newline")?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.index_dir().join("ledger.jsonl"))
            .context("failed to open codebase index ledger")?;
        file.write_all(&buffer)
            .context("failed to append codebase index ledger event")?;
        file.sync_all()
            .context("failed to sync codebase index ledger event")?;
        sync_dir(&self.index_dir());
        Ok(event)
    }

    pub fn read_events(&self) -> Result<Vec<CodebaseIndexLedgerEvent>> {
        let ledger_path = self.index_dir().join("ledger.jsonl");
        if !ledger_path.exists() {
            return Ok(Vec::new());
        }
        let file = fs::File::open(&ledger_path)
            .with_context(|| format!("failed to open {}", ledger_path.display()))?;
        let reader = BufReader::new(file);
        let mut events = Vec::new();
        for line in reader.lines() {
            let line = line.context("failed to read codebase index ledger line")?;
            if line.trim().is_empty() {
                continue;
            }
            events.push(
                serde_json::from_str(&line)
                    .with_context(|| format!("failed to parse {}", ledger_path.display()))?,
            );
        }
        Ok(events)
    }

    fn index_dir(&self) -> PathBuf {
        self.workspace_root
            .join(WORKSPACE_STATE_DIR)
            .join(CODEBASE_INDEX_DIR)
    }

    fn acquire_build_lock(&self) -> Result<CodebaseIndexBuildLock> {
        let root = self.index_dir();
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create {}", root.display()))?;
        let lock_path = root.join("build.lock");
        for attempt in 0..2 {
            match OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&lock_path)
            {
                Ok(mut file) => {
                    let nonce = Uuid::new_v4();
                    writeln!(file, "pid={}", std::process::id())
                        .context("failed to write index build lock")?;
                    writeln!(file, "created_at={}", timestamp()?)
                        .context("failed to write index build lock")?;
                    writeln!(file, "nonce={nonce}").context("failed to write index build lock")?;
                    writeln!(file, "lock_file=build.lock")
                        .context("failed to write index build lock")?;
                    file.sync_all().context("failed to sync index build lock")?;
                    sync_dir(&root);
                    return Ok(CodebaseIndexBuildLock { path: lock_path });
                }
                Err(error) if error.kind() == ErrorKind::AlreadyExists && attempt == 0 => {
                    if self.reclaim_stale_build_lock(&lock_path)? {
                        continue;
                    }
                    bail!("codebase index build lock is held");
                }
                Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                    bail!("codebase index build lock is held");
                }
                Err(error) => return Err(error).context("failed to create codebase index lock"),
            }
        }
        bail!("codebase index build lock is held")
    }

    #[cfg(unix)]
    fn reclaim_stale_build_lock(&self, lock_path: &Path) -> Result<bool> {
        use std::os::fd::AsRawFd;
        use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

        let mut file = match OpenOptions::new()
            .read(true)
            .write(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(lock_path)
        {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(true),
            Err(error) if error.raw_os_error() == Some(libc::ELOOP) => return Ok(false),
            Err(error) => return Err(error).context("failed to inspect codebase index lock"),
        };
        let lock_result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
        if lock_result != 0 {
            let error = std::io::Error::last_os_error();
            if matches!(
                error.raw_os_error(),
                Some(code) if code == libc::EWOULDBLOCK || code == libc::EAGAIN
            ) {
                return Ok(false);
            }
            return Err(error).context("failed to claim stale codebase index lock");
        }
        let _claim = FlockGuard {
            fd: file.as_raw_fd(),
        };

        let lock_metadata = file
            .metadata()
            .context("failed to inspect claimed codebase index lock")?;
        if !lock_metadata.is_file() {
            return Ok(false);
        }
        let mut before = String::new();
        file.read_to_string(&mut before)
            .context("failed to read claimed codebase index lock")?;
        let owner = BuildLockOwner::parse(&before);
        if !owner.is_reclaimable_stale() {
            return Ok(false);
        }

        let path_metadata = match fs::symlink_metadata(lock_path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(true),
            Err(error) => return Err(error).context("failed to reinspect codebase index lock"),
        };
        if path_metadata.dev() != lock_metadata.dev() || path_metadata.ino() != lock_metadata.ino()
        {
            return Ok(false);
        }
        fs::remove_file(lock_path).context("failed to reclaim stale codebase index lock")?;
        if let Some(parent) = lock_path.parent() {
            sync_dir(parent);
        }
        Ok(true)
    }

    #[cfg(not(unix))]
    fn reclaim_stale_build_lock(&self, lock_path: &Path) -> Result<bool> {
        let before = match fs::read_to_string(lock_path) {
            Ok(content) => content,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(true),
            Err(error) => return Err(error).context("failed to inspect codebase index lock"),
        };
        let owner = BuildLockOwner::parse(&before);
        Ok(owner.is_reclaimable_stale())
    }

    fn cleanup_temporary_files(&self) -> Result<()> {
        for dir in [self.index_dir(), self.index_dir().join("snapshots")] {
            if !dir.exists() {
                continue;
            }
            for entry in fs::read_dir(&dir)
                .with_context(|| format!("failed to list temporary files in {}", dir.display()))?
            {
                let entry = entry.context("failed to read temporary index entry")?;
                let file_type = entry
                    .file_type()
                    .context("failed to read temporary index entry type")?;
                if !file_type.is_file() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().to_string();
                if name.contains(".tmp-") {
                    fs::remove_file(entry.path()).with_context(|| {
                        format!("failed to remove stale temporary index file {name}")
                    })?;
                }
            }
        }
        Ok(())
    }

    fn write_commit_marker(
        &self,
        manifest: &CodebaseIndexSnapshotManifest,
        event: &CodebaseIndexLedgerEvent,
    ) -> Result<()> {
        let marker = serde_json::json!({
            "index_id": manifest.snapshot.index_id,
            "snapshot_fingerprint": manifest.snapshot.snapshot_fingerprint,
            "ledger_event_id": event.event_id,
            "ledger_event_kind": format!("{:?}", event.kind),
            "committed_at": event.timestamp,
        });
        let body = serde_json::to_string_pretty(&marker)
            .context("failed to serialize codebase index commit marker")?;
        write_file_atomically(&self.index_dir().join("commit.json"), body.as_bytes())
    }
}

#[derive(Debug)]
pub struct CodebaseIndexBuildLock {
    path: PathBuf,
}

impl Drop for CodebaseIndexBuildLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
        if let Some(parent) = self.path.parent() {
            sync_dir(parent);
        }
    }
}

#[cfg(unix)]
struct FlockGuard {
    fd: std::os::fd::RawFd,
}

#[cfg(unix)]
impl Drop for FlockGuard {
    fn drop(&mut self) {
        unsafe {
            libc::flock(self.fd, libc::LOCK_UN);
        }
    }
}

#[derive(Debug, Default)]
struct BuildLockOwner {
    pid: Option<u32>,
    created_at: Option<OffsetDateTime>,
    nonce: Option<String>,
    lock_file: Option<String>,
}

impl BuildLockOwner {
    fn parse(content: &str) -> Self {
        let mut owner = Self::default();
        for line in content.lines() {
            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            match key {
                "pid" => owner.pid = value.parse::<u32>().ok(),
                "created_at" => owner.created_at = OffsetDateTime::parse(value, &Rfc3339).ok(),
                "nonce" => {
                    if !value.trim().is_empty() {
                        owner.nonce = Some(value.trim().to_string());
                    }
                }
                "lock_file" => {
                    if !value.trim().is_empty() {
                        owner.lock_file = Some(value.trim().to_string());
                    }
                }
                _ => {}
            }
        }
        owner
    }

    fn is_reclaimable_stale(&self) -> bool {
        let Some(pid) = self.pid else {
            return false;
        };
        let Some(created_at) = self.created_at else {
            return false;
        };
        let Some(nonce) = self.nonce.as_deref() else {
            return false;
        };
        if nonce.len() < 16 || self.lock_file.as_deref() != Some("build.lock") {
            return false;
        }
        let age = OffsetDateTime::now_utc() - created_at;
        age.whole_seconds() >= CODEBASE_INDEX_LOCK_STALE_AFTER_SECONDS && !process_is_alive(pid)
    }
}

#[cfg(unix)]
fn process_is_alive(pid: u32) -> bool {
    if pid == 0 || pid > i32::MAX as u32 {
        return false;
    }
    let result = unsafe { libc::kill(pid as i32, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(not(unix))]
fn process_is_alive(_pid: u32) -> bool {
    true
}

fn write_file_atomically(path: &std::path::Path, body: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("target path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent).with_context(|| format!("failed to create {}", parent.display()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow::anyhow!("target path has invalid file name: {}", path.display()))?;
    let tmp_path = parent.join(format!("{file_name}.tmp-{}", Uuid::new_v4().simple()));

    let write_result = (|| -> Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path)
            .with_context(|| format!("failed to create temporary file {}", tmp_path.display()))?;
        file.write_all(body)
            .with_context(|| format!("failed to write temporary file {}", tmp_path.display()))?;
        file.sync_all()
            .with_context(|| format!("failed to sync temporary file {}", tmp_path.display()))?;
        drop(file);
        fs::rename(&tmp_path, path).with_context(|| {
            format!(
                "failed to atomically replace {} from {}",
                path.display(),
                tmp_path.display()
            )
        })?;
        sync_dir(parent);
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&tmp_path);
    }
    write_result
}

fn sync_dir(path: &std::path::Path) {
    if let Ok(file) = fs::File::open(path) {
        let _ = file.sync_all();
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChildTaskStartParams {
    pub goal: String,
    pub mode_id: Option<String>,
    pub parent_task_id: String,
    pub parent_run_id: String,
    pub source_candidate_id: String,
    pub source_handoff_envelope_id: String,
    pub source_handoff_envelope_fingerprint: String,
    pub source_intent_summary: Option<ChildTaskSourceIntentSummary>,
    pub recovery_cycle_provenance: Option<RecoveryCycleChildProvenance>,
    pub external_modepack_child_provenance: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerificationRecoveryTaskStartParams {
    pub goal: String,
    pub mode_id: Option<String>,
    pub provenance: VerificationRecoveryProvenance,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerificationRecoveryTaskStartResult {
    pub record: TaskRecord,
    pub replayed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchApplyRecoveryTaskStartParams {
    pub goal: String,
    pub mode_id: Option<String>,
    pub provenance: PatchApplyRecoveryProvenance,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchApplyRecoveryTaskStartResult {
    pub record: TaskRecord,
    pub replayed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerificationRecoveryRetryTaskStartParams {
    pub goal: String,
    pub mode_id: Option<String>,
    pub provenance: VerificationRecoveryRetryProvenance,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerificationRecoveryRetryTaskStartResult {
    pub record: TaskRecord,
    pub replayed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LlmProviderFailureRetryTaskStartParams {
    pub goal: String,
    pub mode_id: Option<String>,
    pub provenance: LlmProviderFailureRetryProvenance,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LlmProviderFailureRetryTaskStartResult {
    pub record: TaskRecord,
    pub replayed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParentJoinContinuationRunAdmission {
    pub child_completion_fingerprint: String,
    pub child_completion_child_count: usize,
    pub child_completion_fingerprint_input_count: usize,
    pub child_terminal_completed_count: usize,
    pub child_terminal_failed_count: usize,
    pub child_recovery_cycle_depth: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParentJoinContinuationRunAdmitted {
    pub record: TaskRecord,
    pub admission_id: String,
}

impl TaskStore {
    pub fn new(workspace_root: impl Into<PathBuf>) -> Self {
        Self {
            workspace_root: workspace_root.into(),
        }
    }

    pub fn start_task(&self, params: TaskStartParams) -> Result<TaskRecord> {
        let now = timestamp()?;
        let task_id = format!("task_{}", Uuid::new_v4());
        let run_id = format!("run_{}", Uuid::new_v4());
        let record = TaskRecord {
            task_id: task_id.clone(),
            run_id: run_id.clone(),
            goal: params.goal,
            mode_id: params.mode_id,
            status: TaskStatus::Created,
            parent_task_id: None,
            parent_run_id: None,
            source_candidate_id: None,
            source_handoff_envelope_id: None,
            source_handoff_envelope_fingerprint: None,
            source_intent_summary: None,
            recovery_cycle_provenance: None,
            verification_recovery_provenance: None,
            patch_apply_recovery_provenance: None,
            verification_recovery_retry_provenance: None,
            llm_provider_failure_retry_provenance: None,
            created_at: now.clone(),
            updated_at: now,
        };

        let run_dir = self.run_dir(&run_id);
        fs::create_dir_all(&run_dir)
            .with_context(|| format!("failed to create {}", run_dir.display()))?;
        self.write_task_state(&record)?;
        self.append_task_event(&record, LedgerEventKind::TaskStarted)?;

        Ok(record)
    }

    pub fn start_child_task(&self, params: ChildTaskStartParams) -> Result<TaskRecord> {
        let now = timestamp()?;
        let task_id = format!("task_{}", Uuid::new_v4());
        let run_id = format!("run_{}", Uuid::new_v4());
        let record = TaskRecord {
            task_id: task_id.clone(),
            run_id: run_id.clone(),
            goal: params.goal,
            mode_id: params.mode_id,
            status: TaskStatus::Queued,
            parent_task_id: Some(params.parent_task_id),
            parent_run_id: Some(params.parent_run_id),
            source_candidate_id: Some(params.source_candidate_id),
            source_handoff_envelope_id: Some(params.source_handoff_envelope_id),
            source_handoff_envelope_fingerprint: Some(params.source_handoff_envelope_fingerprint),
            source_intent_summary: params.source_intent_summary,
            recovery_cycle_provenance: params.recovery_cycle_provenance,
            verification_recovery_provenance: None,
            patch_apply_recovery_provenance: None,
            verification_recovery_retry_provenance: None,
            llm_provider_failure_retry_provenance: None,
            created_at: now.clone(),
            updated_at: now,
        };

        let run_dir = self.run_dir(&run_id);
        fs::create_dir_all(&run_dir)
            .with_context(|| format!("failed to create {}", run_dir.display()))?;
        self.write_task_state(&record)?;
        self.append_task_event_with_payload(
            &record,
            LedgerEventKind::TaskStarted,
            Some(serde_json::json!({
                "status": "Queued",
                "parent_task_id": record.parent_task_id.clone(),
                "parent_run_id": record.parent_run_id.clone(),
                "source_candidate_id": record.source_candidate_id.clone(),
                "source_handoff_envelope_id": record.source_handoff_envelope_id.clone(),
                "source_handoff_envelope_fingerprint": record.source_handoff_envelope_fingerprint.clone(),
                "source_intent_summary": record.source_intent_summary.clone(),
                "recovery_cycle_provenance": record.recovery_cycle_provenance.clone(),
                "external_modepack_child_provenance": params.external_modepack_child_provenance,
                "execution_enabled": false,
                "scheduler_handoff_enabled": false,
                "reason": "Controlled child task materialized from parent handoff envelope; child execution remains disabled."
            })),
        )?;

        Ok(record)
    }

    pub fn start_verification_recovery_task(
        &self,
        params: VerificationRecoveryTaskStartParams,
    ) -> Result<VerificationRecoveryTaskStartResult> {
        let _lock = self.acquire_run_admission_lock(&params.provenance.source_run_id)?;
        if let Some(record) = self
            .find_replayable_verification_recovery_task_by_failure_fingerprint(
                &params.provenance.failure_fingerprint,
            )?
        {
            return Ok(VerificationRecoveryTaskStartResult {
                record,
                replayed: true,
            });
        }

        let now = timestamp()?;
        let task_id = format!("task_{}", Uuid::new_v4());
        let run_id = format!("run_{}", Uuid::new_v4());
        let record = TaskRecord {
            task_id: task_id.clone(),
            run_id: run_id.clone(),
            goal: params.goal,
            mode_id: params.mode_id,
            status: TaskStatus::Created,
            parent_task_id: None,
            parent_run_id: None,
            source_candidate_id: None,
            source_handoff_envelope_id: None,
            source_handoff_envelope_fingerprint: None,
            source_intent_summary: None,
            recovery_cycle_provenance: None,
            verification_recovery_provenance: Some(params.provenance),
            patch_apply_recovery_provenance: None,
            verification_recovery_retry_provenance: None,
            llm_provider_failure_retry_provenance: None,
            created_at: now.clone(),
            updated_at: now,
        };

        let run_dir = self.run_dir(&run_id);
        fs::create_dir_all(&run_dir)
            .with_context(|| format!("failed to create {}", run_dir.display()))?;
        self.write_task_state(&record)?;
        let provenance = record.verification_recovery_provenance.clone();
        self.append_task_event_with_payload(
            &record,
            LedgerEventKind::TaskStarted,
            Some(serde_json::json!({
                "status": "Created",
                "verification_recovery_provenance": provenance,
                "source_task_id": record
                    .verification_recovery_provenance
                    .as_ref()
                    .map(|provenance| provenance.source_task_id.clone()),
                "source_run_id": record
                    .verification_recovery_provenance
                    .as_ref()
                    .map(|provenance| provenance.source_run_id.clone()),
                "failure_fingerprint": record
                    .verification_recovery_provenance
                    .as_ref()
                    .map(|provenance| provenance.failure_fingerprint.clone()),
                "execution_enabled": false,
                "recovery_running_enabled": false,
                "scheduler_handoff_enabled": false,
                "next_action": "run_recovery_task_explicitly",
                "reason": "Verification failure recovery task admitted from bounded verifier completion-gate evidence; recovery execution remains explicit."
            })),
        )?;

        Ok(VerificationRecoveryTaskStartResult {
            record,
            replayed: false,
        })
    }

    pub fn start_patch_apply_recovery_task(
        &self,
        params: PatchApplyRecoveryTaskStartParams,
    ) -> Result<PatchApplyRecoveryTaskStartResult> {
        let _lock = self.acquire_run_admission_lock(&params.provenance.source_run_id)?;
        if let Some(record) = self.find_patch_apply_recovery_task_by_failure_fingerprint(
            &params.provenance.failure_fingerprint,
        )? {
            return Ok(PatchApplyRecoveryTaskStartResult {
                record,
                replayed: true,
            });
        }

        let now = timestamp()?;
        let task_id = format!("task_{}", Uuid::new_v4());
        let run_id = format!("run_{}", Uuid::new_v4());
        let record = TaskRecord {
            task_id: task_id.clone(),
            run_id: run_id.clone(),
            goal: params.goal,
            mode_id: params.mode_id,
            status: TaskStatus::Created,
            parent_task_id: None,
            parent_run_id: None,
            source_candidate_id: None,
            source_handoff_envelope_id: None,
            source_handoff_envelope_fingerprint: None,
            source_intent_summary: None,
            recovery_cycle_provenance: None,
            verification_recovery_provenance: None,
            patch_apply_recovery_provenance: Some(params.provenance),
            verification_recovery_retry_provenance: None,
            llm_provider_failure_retry_provenance: None,
            created_at: now.clone(),
            updated_at: now,
        };

        let run_dir = self.run_dir(&run_id);
        fs::create_dir_all(&run_dir)
            .with_context(|| format!("failed to create {}", run_dir.display()))?;
        self.write_task_state(&record)?;
        let provenance = record.patch_apply_recovery_provenance.clone();
        self.append_task_event_with_payload(
            &record,
            LedgerEventKind::TaskStarted,
            Some(serde_json::json!({
                "status": "Created",
                "patch_apply_recovery_provenance": provenance,
                "source_run_id": record
                    .patch_apply_recovery_provenance
                    .as_ref()
                    .map(|provenance| provenance.source_run_id.clone()),
                "source_proposal_id": record
                    .patch_apply_recovery_provenance
                    .as_ref()
                    .map(|provenance| provenance.source_proposal_id.clone()),
                "source_apply_id": record
                    .patch_apply_recovery_provenance
                    .as_ref()
                    .map(|provenance| provenance.source_apply_id.clone()),
                "failure_fingerprint": record
                    .patch_apply_recovery_provenance
                    .as_ref()
                    .map(|provenance| provenance.failure_fingerprint.clone()),
                "execution_enabled": false,
                "recovery_running_enabled": false,
                "scheduler_handoff_enabled": false,
                "next_action": "run_recovery_task_explicitly",
                "reason": "Patch apply failure recovery task admitted from bounded apply result evidence; recovery execution remains explicit."
            })),
        )?;

        Ok(PatchApplyRecoveryTaskStartResult {
            record,
            replayed: false,
        })
    }

    pub fn start_verification_recovery_retry_task(
        &self,
        params: VerificationRecoveryRetryTaskStartParams,
    ) -> Result<VerificationRecoveryRetryTaskStartResult> {
        let _lock = self.acquire_run_admission_lock(&params.provenance.source_run_id)?;
        if let Some(record) = self.find_verification_recovery_retry_task_by_apply_fingerprint(
            &params.provenance.failure_fingerprint,
            &params.provenance.apply_fingerprint,
            &params.provenance.proposal_id,
            &params.provenance.apply_id,
        )? {
            return Ok(VerificationRecoveryRetryTaskStartResult {
                record,
                replayed: true,
            });
        }

        let now = timestamp()?;
        let task_id = format!("task_{}", Uuid::new_v4());
        let run_id = format!("run_{}", Uuid::new_v4());
        let record = TaskRecord {
            task_id: task_id.clone(),
            run_id: run_id.clone(),
            goal: params.goal,
            mode_id: params.mode_id,
            status: TaskStatus::Created,
            parent_task_id: None,
            parent_run_id: None,
            source_candidate_id: None,
            source_handoff_envelope_id: None,
            source_handoff_envelope_fingerprint: None,
            source_intent_summary: None,
            recovery_cycle_provenance: None,
            verification_recovery_provenance: None,
            patch_apply_recovery_provenance: None,
            verification_recovery_retry_provenance: Some(params.provenance),
            llm_provider_failure_retry_provenance: None,
            created_at: now.clone(),
            updated_at: now,
        };

        let run_dir = self.run_dir(&run_id);
        fs::create_dir_all(&run_dir)
            .with_context(|| format!("failed to create {}", run_dir.display()))?;
        self.write_task_state(&record)?;
        let provenance = record.verification_recovery_retry_provenance.clone();
        self.append_task_event_with_payload(
            &record,
            LedgerEventKind::TaskStarted,
            Some(serde_json::json!({
                "status": "Created",
                "verification_recovery_retry_provenance": provenance,
                "source_task_id": record
                    .verification_recovery_retry_provenance
                    .as_ref()
                    .map(|provenance| provenance.source_task_id.clone()),
                "source_run_id": record
                    .verification_recovery_retry_provenance
                    .as_ref()
                    .map(|provenance| provenance.source_run_id.clone()),
                "recovery_task_id": record
                    .verification_recovery_retry_provenance
                    .as_ref()
                    .map(|provenance| provenance.recovery_task_id.clone()),
                "recovery_run_id": record
                    .verification_recovery_retry_provenance
                    .as_ref()
                    .map(|provenance| provenance.recovery_run_id.clone()),
                "proposal_id": record
                    .verification_recovery_retry_provenance
                    .as_ref()
                    .map(|provenance| provenance.proposal_id.clone()),
                "apply_id": record
                    .verification_recovery_retry_provenance
                    .as_ref()
                    .map(|provenance| provenance.apply_id.clone()),
                "failure_fingerprint": record
                    .verification_recovery_retry_provenance
                    .as_ref()
                    .map(|provenance| provenance.failure_fingerprint.clone()),
                "apply_fingerprint": record
                    .verification_recovery_retry_provenance
                    .as_ref()
                    .map(|provenance| provenance.apply_fingerprint.clone()),
                "retried_verifier_tool_ids": record
                    .verification_recovery_retry_provenance
                    .as_ref()
                    .map(|provenance| provenance.retried_verifier_tool_ids.clone()),
                "execution_enabled": false,
                "retry_running_enabled": false,
                "scheduler_handoff_enabled": false,
                "next_action": "run_verification_retry_task_explicitly",
                "reason": "Verification retry task admitted from bounded recovery apply evidence; retry execution remains explicit."
            })),
        )?;

        Ok(VerificationRecoveryRetryTaskStartResult {
            record,
            replayed: false,
        })
    }

    pub fn start_llm_provider_failure_retry_task(
        &self,
        params: LlmProviderFailureRetryTaskStartParams,
    ) -> Result<LlmProviderFailureRetryTaskStartResult> {
        let _lock = self.acquire_run_admission_lock(&params.provenance.source_run_id)?;
        if let Some(record) = self.find_llm_provider_failure_retry_task_by_failure_fingerprint(
            &params.provenance.source_task_id,
            &params.provenance.source_run_id,
            &params.provenance.failure_fingerprint,
        )? {
            return Ok(LlmProviderFailureRetryTaskStartResult {
                record,
                replayed: true,
            });
        }

        let now = timestamp()?;
        let task_id = format!("task_{}", Uuid::new_v4());
        let run_id = format!("run_{}", Uuid::new_v4());
        let record = TaskRecord {
            task_id: task_id.clone(),
            run_id: run_id.clone(),
            goal: params.goal,
            mode_id: params.mode_id,
            status: TaskStatus::Created,
            parent_task_id: None,
            parent_run_id: None,
            source_candidate_id: None,
            source_handoff_envelope_id: None,
            source_handoff_envelope_fingerprint: None,
            source_intent_summary: None,
            recovery_cycle_provenance: None,
            verification_recovery_provenance: None,
            patch_apply_recovery_provenance: None,
            verification_recovery_retry_provenance: None,
            llm_provider_failure_retry_provenance: Some(params.provenance),
            created_at: now.clone(),
            updated_at: now,
        };

        let run_dir = self.run_dir(&run_id);
        fs::create_dir_all(&run_dir)
            .with_context(|| format!("failed to create {}", run_dir.display()))?;
        self.write_task_state(&record)?;
        let provenance = record.llm_provider_failure_retry_provenance.clone();
        self.append_task_event_with_payload(
            &record,
            LedgerEventKind::TaskStarted,
            Some(serde_json::json!({
                "status": "Created",
                "llm_provider_failure_retry_provenance": provenance,
                "source_task_id": record
                    .llm_provider_failure_retry_provenance
                    .as_ref()
                    .map(|provenance| provenance.source_task_id.clone()),
                "source_run_id": record
                    .llm_provider_failure_retry_provenance
                    .as_ref()
                    .map(|provenance| provenance.source_run_id.clone()),
                "failure_fingerprint": record
                    .llm_provider_failure_retry_provenance
                    .as_ref()
                    .map(|provenance| provenance.failure_fingerprint.clone()),
                "failure_class": record
                    .llm_provider_failure_retry_provenance
                    .as_ref()
                    .map(|provenance| provenance.failure_class.clone()),
                "retryable": record
                    .llm_provider_failure_retry_provenance
                    .as_ref()
                    .map(|provenance| provenance.retryable),
                "execution_enabled": false,
                "retry_running_enabled": false,
                "scheduler_handoff_enabled": false,
                "next_action": "run_llm_provider_retry_task_explicitly",
                "reason": "LLM provider failure retry task admitted from bounded provider failure evidence; retry execution remains explicit."
            })),
        )?;

        Ok(LlmProviderFailureRetryTaskStartResult {
            record,
            replayed: false,
        })
    }

    pub fn update_task_status(
        &self,
        task_id: &str,
        status: TaskStatus,
        event_kind: LedgerEventKind,
    ) -> Result<TaskRecord> {
        self.update_task_status_with_payload(task_id, status, event_kind, None)
    }

    pub fn update_task_status_with_payload(
        &self,
        task_id: &str,
        status: TaskStatus,
        event_kind: LedgerEventKind,
        payload: Option<serde_json::Value>,
    ) -> Result<TaskRecord> {
        let Some(mut record) = self.get_task(task_id)? else {
            bail!("task not found: {task_id}");
        };

        record.status = status;
        record.updated_at = timestamp()?;
        self.write_task_state(&record)?;
        self.append_task_event_with_payload(&record, event_kind, payload)?;
        Ok(record)
    }

    pub fn admit_parent_join_continuation(
        &self,
        task_id: &str,
        admission: ParentJoinContinuationRunAdmission,
    ) -> Result<Option<ParentJoinContinuationRunAdmitted>> {
        let Some(initial_record) = self.get_task(task_id)? else {
            bail!("task not found: {task_id}");
        };
        let _lock = self.acquire_run_admission_lock(&initial_record.run_id)?;
        let Some(mut record) = self.get_task(task_id)? else {
            bail!("task not found after admission lock: {task_id}");
        };
        if record.run_id != initial_record.run_id {
            bail!("task run id changed during parent join admission: {task_id}");
        }
        if record.status != TaskStatus::Completed {
            return Ok(None);
        }
        let events = self.read_ledger_events(&record.run_id)?;
        if parent_join_continuation_fingerprint_consumed_in_events(
            &events,
            &admission.child_completion_fingerprint,
        ) {
            return Ok(None);
        }

        let admission_id = format!("parent_join_admission_{}", Uuid::new_v4().simple());
        self.append_task_events_with_payloads(
            &record,
            vec![
                (
                    LedgerEventKind::ParentJoinContinuationFingerprintConsumed,
                    Some(serde_json::json!({
                        "parent_join_continuation_status": "Consumed",
                        "admission_id": admission_id.clone(),
                        "child_completion_fingerprint": admission.child_completion_fingerprint,
                        "child_completion_child_count": admission.child_completion_child_count,
                        "child_terminal_completed_count": admission.child_terminal_completed_count,
                        "child_terminal_failed_count": admission.child_terminal_failed_count,
                        "child_recovery_cycle_depth": admission.child_recovery_cycle_depth,
                        "fingerprint_input_count": admission.child_completion_fingerprint_input_count,
                        "reason": "Parent join continuation admitted atomically for this controlled terminal child result fingerprint."
                    })),
                ),
                (
                    LedgerEventKind::TaskRunning,
                    Some(serde_json::json!({
                        "admission_id": admission_id.clone(),
                        "admission_kind": "parent_join_continuation",
                        "reason": "Parent join continuation running after atomic fingerprint consumption."
                    })),
                ),
            ],
        )?;
        record.status = TaskStatus::Running;
        record.updated_at = timestamp()?;
        self.write_task_state(&record)?;
        Ok(Some(ParentJoinContinuationRunAdmitted {
            record,
            admission_id,
        }))
    }

    pub fn get_task(&self, task_id: &str) -> Result<Option<TaskRecord>> {
        for record in self.list_tasks()? {
            if record.task_id == task_id {
                return Ok(Some(record));
            }
        }
        Ok(None)
    }

    pub fn get_task_by_run_id(&self, run_id: &str) -> Result<Option<TaskRecord>> {
        for record in self.list_tasks()? {
            if record.run_id == run_id {
                return Ok(Some(record));
            }
        }
        Ok(None)
    }

    pub fn find_child_task_by_handoff_fingerprint(
        &self,
        parent_run_id: &str,
        source_handoff_envelope_fingerprint: &str,
    ) -> Result<Option<TaskRecord>> {
        for record in self.list_tasks()? {
            if record.parent_run_id.as_deref() == Some(parent_run_id)
                && record.source_handoff_envelope_fingerprint.as_deref()
                    == Some(source_handoff_envelope_fingerprint)
            {
                return Ok(Some(record));
            }
        }
        Ok(None)
    }

    pub fn find_child_task_by_candidate_and_handoff_fingerprint(
        &self,
        parent_run_id: &str,
        source_candidate_id: &str,
        source_handoff_envelope_fingerprint: &str,
    ) -> Result<Option<TaskRecord>> {
        for record in self.list_tasks()? {
            if record.parent_run_id.as_deref() == Some(parent_run_id)
                && record.source_candidate_id.as_deref() == Some(source_candidate_id)
                && record.source_handoff_envelope_fingerprint.as_deref()
                    == Some(source_handoff_envelope_fingerprint)
            {
                return Ok(Some(record));
            }
        }
        Ok(None)
    }

    pub fn find_verification_recovery_task_by_failure_fingerprint(
        &self,
        failure_fingerprint: &str,
    ) -> Result<Option<TaskRecord>> {
        for record in self.list_tasks()? {
            if record
                .verification_recovery_provenance
                .as_ref()
                .map(|provenance| provenance.failure_fingerprint.as_str())
                == Some(failure_fingerprint)
            {
                return Ok(Some(record));
            }
        }
        Ok(None)
    }

    pub fn find_patch_apply_recovery_task_by_failure_fingerprint(
        &self,
        failure_fingerprint: &str,
    ) -> Result<Option<TaskRecord>> {
        for record in self.list_tasks()? {
            if record
                .patch_apply_recovery_provenance
                .as_ref()
                .map(|provenance| provenance.failure_fingerprint.as_str())
                == Some(failure_fingerprint)
            {
                return Ok(Some(record));
            }
        }
        Ok(None)
    }

    fn find_replayable_verification_recovery_task_by_failure_fingerprint(
        &self,
        failure_fingerprint: &str,
    ) -> Result<Option<TaskRecord>> {
        for record in self.list_tasks()? {
            if record
                .verification_recovery_provenance
                .as_ref()
                .map(|provenance| provenance.failure_fingerprint.as_str())
                == Some(failure_fingerprint)
                && !self.is_terminal_failed_verification_recovery_repair_gate(&record)?
            {
                return Ok(Some(record));
            }
        }
        Ok(None)
    }

    fn is_terminal_failed_verification_recovery_repair_gate(
        &self,
        record: &TaskRecord,
    ) -> Result<bool> {
        if record.status != TaskStatus::Failed {
            return Ok(false);
        }
        let events = self.read_ledger_events(&record.run_id)?;
        Ok(events
            .iter()
            .rev()
            .find(|event| {
                matches!(
                    event.kind,
                    LedgerEventKind::TaskCompleted
                        | LedgerEventKind::TaskFailed
                        | LedgerEventKind::TaskCancelled
                )
            })
            .is_some_and(|event| {
                event.kind == LedgerEventKind::TaskFailed
                    && event
                        .payload
                        .as_ref()
                        .and_then(|payload| payload.get("verification_recovery_repair_gate_status"))
                        .and_then(serde_json::Value::as_str)
                        == Some("Failed")
            }))
    }

    pub fn find_verification_recovery_retry_task_by_apply_fingerprint(
        &self,
        failure_fingerprint: &str,
        apply_fingerprint: &str,
        proposal_id: &str,
        apply_id: &str,
    ) -> Result<Option<TaskRecord>> {
        for record in self.list_tasks()? {
            if record
                .verification_recovery_retry_provenance
                .as_ref()
                .map(|provenance| {
                    provenance.failure_fingerprint.as_str() == failure_fingerprint
                        && provenance.apply_fingerprint.as_str() == apply_fingerprint
                        && provenance.proposal_id.as_str() == proposal_id
                        && provenance.apply_id.as_str() == apply_id
                })
                .unwrap_or(false)
            {
                return Ok(Some(record));
            }
        }
        Ok(None)
    }

    pub fn find_llm_provider_failure_retry_task_by_failure_fingerprint(
        &self,
        source_task_id: &str,
        source_run_id: &str,
        failure_fingerprint: &str,
    ) -> Result<Option<TaskRecord>> {
        for record in self.list_tasks()? {
            if record
                .llm_provider_failure_retry_provenance
                .as_ref()
                .map(|provenance| {
                    provenance.source_task_id.as_str() == source_task_id
                        && provenance.source_run_id.as_str() == source_run_id
                        && provenance.failure_fingerprint.as_str() == failure_fingerprint
                })
                .unwrap_or(false)
            {
                return Ok(Some(record));
            }
        }
        Ok(None)
    }

    pub fn list_tasks(&self) -> Result<Vec<TaskRecord>> {
        let runs_dir = self.runs_dir();
        if !runs_dir.exists() {
            return Ok(Vec::new());
        }

        let mut tasks = Vec::new();
        for entry in fs::read_dir(&runs_dir)
            .with_context(|| format!("failed to read {}", runs_dir.display()))?
        {
            let entry = entry.context("failed to read run directory entry")?;
            if !entry
                .file_type()
                .context("failed to read run entry type")?
                .is_dir()
            {
                continue;
            }
            let state_path = entry.path().join("state.json");
            if !state_path.exists() {
                continue;
            }
            let content = fs::read_to_string(&state_path)
                .with_context(|| format!("failed to read {}", state_path.display()))?;
            tasks.push(
                serde_json::from_str(&content)
                    .with_context(|| format!("failed to parse {}", state_path.display()))?,
            );
        }
        tasks.sort_by(|a: &TaskRecord, b: &TaskRecord| {
            a.created_at
                .cmp(&b.created_at)
                .then(a.task_id.cmp(&b.task_id))
        });
        Ok(tasks)
    }

    pub fn run_dir(&self, run_id: &str) -> PathBuf {
        self.runs_dir().join(run_id)
    }

    fn write_task_state(&self, record: &TaskRecord) -> Result<()> {
        let run_dir = self.run_dir(&record.run_id);
        fs::create_dir_all(&run_dir)
            .with_context(|| format!("failed to create {}", run_dir.display()))?;
        let state =
            serde_json::to_string_pretty(record).context("failed to serialize task state")?;
        let state_path = run_dir.join("state.json");
        let tmp_path = run_dir.join(format!("state.json.tmp-{}", Uuid::new_v4().simple()));
        fs::write(&tmp_path, state).context("failed to write temporary task state")?;
        fs::rename(&tmp_path, &state_path).with_context(|| {
            format!(
                "failed to atomically replace task state {}",
                state_path.display()
            )
        })
    }

    pub fn append_task_event(&self, record: &TaskRecord, kind: LedgerEventKind) -> Result<()> {
        self.append_task_event_with_payload(record, kind, None)
    }

    pub fn append_task_event_with_payload(
        &self,
        record: &TaskRecord,
        kind: LedgerEventKind,
        payload: Option<serde_json::Value>,
    ) -> Result<()> {
        self.append_task_events_with_payloads(record, vec![(kind, payload)])
    }

    pub fn read_ledger_events(&self, run_id: &str) -> Result<Vec<LedgerEvent>> {
        RunLedger::new(self.run_dir(run_id)).read_events()
    }

    pub fn read_headless_continuation_decision(
        &self,
        continuation_id: &str,
    ) -> Result<Option<HeadlessContinuationDecisionLookup>> {
        let path = self.headless_continuation_decision_path(continuation_id);
        match fs::read_to_string(&path) {
            Ok(body) => serde_json::from_str(&body)
                .with_context(|| format!("failed to parse {}", path.display()))
                .map(Some),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
        }
    }

    pub fn write_headless_continuation_decision(
        &self,
        lookup: &HeadlessContinuationDecisionLookup,
    ) -> Result<()> {
        let path = self.headless_continuation_decision_path(&lookup.continuation_id);
        if let Some(existing) = self.read_headless_continuation_decision(&lookup.continuation_id)? {
            if existing == *lookup {
                return Ok(());
            }
            bail!(
                "conflicting headless continuation decision for {}",
                lookup.continuation_id
            );
        }
        let body = serde_json::to_string_pretty(lookup)
            .context("failed to serialize headless continuation decision")?;
        write_file_atomically(&path, body.as_bytes())
    }

    pub fn read_headless_run_session_checkpoint(
        &self,
        session_id: &str,
    ) -> Result<Option<HeadlessRunSessionCheckpoint>> {
        let path = self.headless_run_session_current_path(session_id);
        match fs::read_to_string(&path) {
            Ok(body) => serde_json::from_str(&body)
                .with_context(|| format!("failed to parse {}", path.display()))
                .map(Some),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
        }
    }

    pub fn write_headless_run_session_checkpoint(
        &self,
        checkpoint: &HeadlessRunSessionCheckpoint,
    ) -> Result<()> {
        let current_path = self.headless_run_session_current_path(&checkpoint.session_id);
        if let Some(existing) = self.read_headless_run_session_checkpoint(&checkpoint.session_id)? {
            if existing == *checkpoint {
                return Ok(());
            }
            if existing.session_sequence >= checkpoint.session_sequence {
                bail!(
                    "conflicting headless run session checkpoint for {} sequence {}",
                    checkpoint.session_id,
                    checkpoint.session_sequence
                );
            }
        }
        let body = serde_json::to_string_pretty(checkpoint)
            .context("failed to serialize headless run session checkpoint")?;
        let sequence_path = self.headless_run_session_sequence_path(
            &checkpoint.session_id,
            checkpoint.session_sequence,
        );
        write_file_atomically(&sequence_path, body.as_bytes())?;
        write_file_atomically(&current_path, body.as_bytes())
    }

    pub fn read_headless_run_session_drive_checkpoint(
        &self,
        session_id: &str,
        drive_id: &str,
    ) -> Result<Option<HeadlessRunSessionDriveCheckpoint>> {
        let path = self.headless_run_session_drive_path(session_id, drive_id);
        match fs::read_to_string(&path) {
            Ok(body) => serde_json::from_str(&body)
                .with_context(|| format!("failed to parse {}", path.display()))
                .map(Some),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
        }
    }

    pub fn write_headless_run_session_drive_checkpoint(
        &self,
        checkpoint: &HeadlessRunSessionDriveCheckpoint,
    ) -> Result<()> {
        let path =
            self.headless_run_session_drive_path(&checkpoint.session_id, &checkpoint.drive_id);
        if let Some(existing) = self.read_headless_run_session_drive_checkpoint(
            &checkpoint.session_id,
            &checkpoint.drive_id,
        )? {
            if existing == *checkpoint {
                return Ok(());
            }
            bail!(
                "conflicting headless run session drive checkpoint for {} drive {}",
                checkpoint.session_id,
                checkpoint.drive_id
            );
        }
        let body = serde_json::to_string_pretty(checkpoint)
            .context("failed to serialize headless run session drive checkpoint")?;
        write_file_atomically(&path, body.as_bytes())
    }

    pub fn read_headless_run_completion_finalization_checkpoint(
        &self,
        session_id: &str,
        drive_id: &str,
    ) -> Result<Option<HeadlessRunCompletionFinalizationCheckpoint>> {
        let path = self.headless_run_completion_finalization_path(session_id, drive_id);
        match fs::read_to_string(&path) {
            Ok(body) => serde_json::from_str(&body)
                .with_context(|| format!("failed to parse {}", path.display()))
                .map(Some),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
        }
    }

    pub fn write_headless_run_completion_finalization_checkpoint(
        &self,
        checkpoint: &HeadlessRunCompletionFinalizationCheckpoint,
    ) -> Result<()> {
        let path = self.headless_run_completion_finalization_path(
            &checkpoint.session_id,
            &checkpoint.drive_id,
        );
        if let Some(existing) = self.read_headless_run_completion_finalization_checkpoint(
            &checkpoint.session_id,
            &checkpoint.drive_id,
        )? {
            if existing == *checkpoint {
                return Ok(());
            }
            bail!(
                "conflicting headless run completion finalization checkpoint for {} drive {}",
                checkpoint.session_id,
                checkpoint.drive_id
            );
        }
        let body = serde_json::to_string_pretty(checkpoint)
            .context("failed to serialize headless run completion finalization checkpoint")?;
        write_file_atomically(&path, body.as_bytes())
    }

    fn append_task_events_with_payloads(
        &self,
        record: &TaskRecord,
        events: Vec<(LedgerEventKind, Option<serde_json::Value>)>,
    ) -> Result<()> {
        let ledger_events = events
            .into_iter()
            .map(|(kind, payload)| {
                Ok(LedgerEvent {
                    event_id: format!("event_{}", Uuid::new_v4()),
                    task_id: record.task_id.clone(),
                    run_id: record.run_id.clone(),
                    kind,
                    timestamp: timestamp()?,
                    payload,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        RunLedger::new(self.run_dir(&record.run_id)).append_many(&ledger_events)
    }

    fn acquire_run_admission_lock(&self, run_id: &str) -> Result<RunAdmissionLock> {
        let run_dir = self.run_dir(run_id);
        fs::create_dir_all(&run_dir)
            .with_context(|| format!("failed to create {}", run_dir.display()))?;
        let lock_path = run_dir.join("parent-join-admission.lock");
        for _ in 0..RUN_ADMISSION_LOCK_RETRIES {
            match OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&lock_path)
            {
                Ok(mut file) => {
                    writeln!(file, "{}", timestamp()?)
                        .context("failed to write run admission lock heartbeat")?;
                    return Ok(RunAdmissionLock { path: lock_path });
                }
                Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                    thread::sleep(RUN_ADMISSION_LOCK_SLEEP);
                }
                Err(error) => {
                    return Err(error)
                        .with_context(|| format!("failed to acquire {}", lock_path.display()));
                }
            }
        }
        bail!(
            "run admission lock remained busy after {} attempts: {}",
            RUN_ADMISSION_LOCK_RETRIES,
            lock_path.display()
        )
    }

    fn runs_dir(&self) -> PathBuf {
        self.workspace_root.join(WORKSPACE_STATE_DIR).join(RUNS_DIR)
    }

    fn headless_continuation_decision_path(&self, continuation_id: &str) -> PathBuf {
        self.workspace_root
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_CONTINUATIONS_DIR)
            .join(format!("{continuation_id}.json"))
    }

    fn headless_run_session_current_path(&self, session_id: &str) -> PathBuf {
        self.workspace_root
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_RUN_SESSIONS_DIR)
            .join(session_id)
            .join("current.json")
    }

    fn headless_run_session_sequence_path(&self, session_id: &str, sequence: u64) -> PathBuf {
        self.workspace_root
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_RUN_SESSIONS_DIR)
            .join(session_id)
            .join(format!("sequence-{sequence}.json"))
    }

    fn headless_run_session_drive_path(&self, session_id: &str, drive_id: &str) -> PathBuf {
        self.workspace_root
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_RUN_SESSIONS_DIR)
            .join(session_id)
            .join("drives")
            .join(format!("{drive_id}.json"))
    }

    fn headless_run_completion_finalization_path(
        &self,
        session_id: &str,
        drive_id: &str,
    ) -> PathBuf {
        self.workspace_root
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_RUN_SESSIONS_DIR)
            .join(session_id)
            .join("completion-finalizations")
            .join(format!("{drive_id}.json"))
    }

    pub fn workspace_root(&self) -> &std::path::Path {
        &self.workspace_root
    }
}

#[derive(Debug)]
struct RunAdmissionLock {
    path: PathBuf,
}

impl Drop for RunAdmissionLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[derive(Debug, Clone)]
pub struct RunLedger {
    run_dir: PathBuf,
}

impl RunLedger {
    pub fn new(run_dir: impl Into<PathBuf>) -> Self {
        Self {
            run_dir: run_dir.into(),
        }
    }

    pub fn append(&self, event: &LedgerEvent) -> Result<()> {
        self.append_many(std::slice::from_ref(event))
    }

    pub fn append_many(&self, events: &[LedgerEvent]) -> Result<()> {
        fs::create_dir_all(&self.run_dir)
            .with_context(|| format!("failed to create {}", self.run_dir.display()))?;
        let mut buffer = Vec::new();
        for event in events {
            serde_json::to_writer(&mut buffer, event)
                .context("failed to serialize ledger event")?;
            writeln!(&mut buffer).context("failed to write ledger newline")?;
        }
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.run_dir.join("ledger.jsonl"))
            .context("failed to open run ledger")?;
        file.write_all(&buffer)
            .context("failed to append run ledger events")?;
        Ok(())
    }

    pub fn read_events(&self) -> Result<Vec<LedgerEvent>> {
        let ledger_path = self.run_dir.join("ledger.jsonl");
        if !ledger_path.exists() {
            return Ok(Vec::new());
        }

        let file = fs::File::open(&ledger_path)
            .with_context(|| format!("failed to open {}", ledger_path.display()))?;
        let reader = BufReader::new(file);
        let mut events = Vec::new();
        for line in reader.lines() {
            let line = line.context("failed to read ledger line")?;
            if line.trim().is_empty() {
                continue;
            }
            events.push(
                serde_json::from_str(&line)
                    .with_context(|| format!("failed to parse {}", ledger_path.display()))?,
            );
        }
        Ok(events)
    }
}

fn parent_join_continuation_fingerprint_consumed_in_events(
    events: &[LedgerEvent],
    child_completion_fingerprint: &str,
) -> bool {
    events.iter().any(|event| {
        if event.kind != LedgerEventKind::ParentJoinContinuationFingerprintConsumed {
            return false;
        }
        let Some(payload) = event.payload.as_ref() else {
            return false;
        };
        if payload
            .get("child_completion_fingerprint")
            .and_then(serde_json::Value::as_str)
            != Some(child_completion_fingerprint)
        {
            return false;
        }
        let Some(admission_id) = payload
            .get("admission_id")
            .and_then(serde_json::Value::as_str)
        else {
            return true;
        };
        let Some(running_index) = events.iter().position(|candidate| {
            candidate.kind == LedgerEventKind::TaskRunning
                && candidate
                    .payload
                    .as_ref()
                    .and_then(|payload| payload.get("admission_id"))
                    .and_then(serde_json::Value::as_str)
                    == Some(admission_id)
        }) else {
            return false;
        };
        for candidate in events.iter().skip(running_index + 1) {
            if candidate.kind == LedgerEventKind::ParentJoinContinuationFingerprintConsumed {
                return false;
            }
            if matches!(
                candidate.kind,
                LedgerEventKind::TaskCompleted
                    | LedgerEventKind::TaskFailed
                    | LedgerEventKind::TaskCancelled
            ) {
                return true;
            }
        }
        false
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LedgerEvent {
    pub event_id: String,
    pub task_id: String,
    pub run_id: String,
    pub kind: LedgerEventKind,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CodebaseIndexLedgerEvent {
    pub event_id: String,
    pub kind: LedgerEventKind,
    pub timestamp: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum LedgerEventKind {
    CodebaseIndexPermissionChecked,
    CodebaseIndexSnapshotBuilt,
    CodebaseIndexQueryCompleted,
    CodebaseIndexSelectionReadCompleted,
    CodebaseIndexPromptContextMaterialized,
    VerificationRecoveryContextReadMaterialized,
    TaskStarted,
    ModeResolved,
    ExternalModePackChildProvenanceDenied,
    ExternalModePackTaskProvenanceDenied,
    PermissionChecked,
    PermissionDenied,
    ToolPlanned,
    ToolPermissionChecked,
    ToolPlanApproved,
    ToolPlanDenied,
    ToolIntentParsed,
    ToolIntentRejected,
    ToolIntentPermissionChecked,
    ToolIntentApproved,
    ToolIntentDenied,
    SubtaskOrchestrationQueued,
    SubtaskHandoffPrepared,
    SubtaskSchedulerReadinessRecorded,
    SubtaskDispatchPlanPrepared,
    SubtaskDispatchContractPrepared,
    SubtaskDispatchAdmissionEvaluated,
    SubtaskDispatchReadinessSnapshotRecorded,
    SubtaskDispatcherGuardVerdictRecorded,
    SubtaskDispatchDecisionRecorded,
    SubtaskDispatchCandidateManifestRecorded,
    SubtaskDispatchHandoffEnvelopeRecorded,
    ParentJoinContinuationFingerprintConsumed,
    ToolExecutionRequested,
    ToolExecutionPermissionChecked,
    ToolExecutionCompleted,
    ToolExecutionDenied,
    ToolExecutionFailed,
    WorkspacePatchProposed,
    WorkspacePatchApprovalRequested,
    WorkspacePatchApproved,
    WorkspacePatchRejected,
    WorkspacePatchPreflightSnapshotCreated,
    WorkspacePatchApplyPlanCreated,
    WorkspacePatchApplyCapabilityChecked,
    WorkspacePatchApplyDryRunChecked,
    WorkspacePatchApplyResultRecorded,
    WorkspacePatchReadinessReportCreated,
    HeadlessContinuationDecisionRecorded,
    HeadlessRunSessionAdvanced,
    HeadlessRunSessionDriveCompleted,
    HeadlessRunCompletionFinalized,
    TaskRunning,
    AgentLoopStarted,
    AgentLoopCompleted,
    PromptBuilt,
    PromptSensitiveScanCompleted,
    PromptSensitiveScanFailed,
    LlmRequestCreated,
    LlmRequestFailed,
    LlmResponseReceived,
    SecondPassPromptBuilt,
    SecondPassLlmRequestCreated,
    SecondPassLlmRequestFailed,
    SecondPassLlmResponseReceived,
    TaskCompleted,
    TaskFailed,
    TaskCancelled,
}

fn timestamp() -> Result<String> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .context("failed to format timestamp")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codebase_index_store_writes_current_snapshot_and_bounded_event() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = BrownieStore::new(temp.path());
        let manifest = CodebaseIndexSnapshotManifest {
            snapshot: brownie_protocol::CodebaseIndexSnapshotSummary {
                index_id: "idx_abc".to_string(),
                root: ".".to_string(),
                workspace_fingerprint: format!("sha256:{}", "a".repeat(64)),
                snapshot_fingerprint: format!("sha256:{}", "b".repeat(64)),
                built_at: "2026-07-24T00:00:00Z".to_string(),
                counts: brownie_protocol::CodebaseIndexCountsSummary {
                    indexed_files: 1,
                    walked_directories: 1,
                    skipped_protected: 0,
                    skipped_ignored: 0,
                    skipped_sensitive: 0,
                    skipped_symlink: 0,
                    skipped_too_large: 0,
                    skipped_binary_like: 0,
                    skipped_unreadable: 0,
                    skipped_unsafe_path: 0,
                    skipped_other: 0,
                    truncated_entries: 0,
                    visited_entries: 1,
                    truncated_directories: 0,
                    ignore_rule_files_loaded: 0,
                    ignore_rule_count: 0,
                    sensitive_finding_count: 0,
                },
                limits: brownie_protocol::CodebaseIndexLimitsSummary {
                    max_files: 10,
                    max_directories: 10,
                    max_path_chars: 512,
                    max_file_bytes: 1024,
                    max_visited_entries: 100,
                    max_directory_entries: 100,
                },
                truncated: false,
            },
            entries: vec![brownie_protocol::CodebaseIndexFileEntry {
                path: "src/lib.rs".to_string(),
                file_kind: "Rust".to_string(),
                byte_length: 12,
                line_count: Some(1),
                content_sha256: Some(format!("sha256:{}", "c".repeat(64))),
            }],
        };

        store
            .codebase_index()
            .write_current_snapshot(&manifest)
            .expect("write snapshot");
        let current = store
            .codebase_index()
            .read_current_snapshot()
            .expect("read current")
            .expect("current snapshot");
        assert_eq!(current, manifest);

        let event = store
            .codebase_index()
            .append_event(
                LedgerEventKind::CodebaseIndexSnapshotBuilt,
                serde_json::json!({
                    "index_id": "idx_abc",
                    "snapshot_fingerprint": manifest.snapshot.snapshot_fingerprint,
                    "indexed_files": 1,
                    "truncated": false,
                    "next_action": "build_bounded_index_query_file_selection"
                }),
            )
            .expect("append event");
        assert_eq!(event.kind, LedgerEventKind::CodebaseIndexSnapshotBuilt);
        assert_eq!(
            store.codebase_index().read_events().expect("read events")[0],
            event
        );
    }

    #[test]
    fn codebase_index_commit_preserves_current_when_lock_or_ledger_fails() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = BrownieStore::new(temp.path());
        let previous = test_index_manifest("idx_previous", "a");
        let next = test_index_manifest("idx_next", "b");

        store
            .codebase_index()
            .write_current_snapshot(&previous)
            .expect("previous current");
        let index_dir = temp.path().join(".brownie/codebase-index");
        fs::write(index_dir.join("build.lock"), "held").expect("manual lock");

        let locked = store.codebase_index().commit_current_snapshot(
            &next,
            LedgerEventKind::CodebaseIndexSnapshotBuilt,
            serde_json::json!({"index_id": "idx_next"}),
        );
        assert!(locked.is_err());
        assert_eq!(
            store
                .codebase_index()
                .read_current_snapshot()
                .expect("read current")
                .expect("current"),
            previous
        );

        fs::remove_file(index_dir.join("build.lock")).expect("remove lock");
        fs::remove_file(index_dir.join("ledger.jsonl")).ok();
        fs::create_dir(index_dir.join("ledger.jsonl")).expect("ledger dir");
        let ledger_failed = store.codebase_index().commit_current_snapshot(
            &next,
            LedgerEventKind::CodebaseIndexSnapshotBuilt,
            serde_json::json!({"index_id": "idx_next"}),
        );
        assert!(ledger_failed.is_err());
        assert_eq!(
            store
                .codebase_index()
                .read_current_snapshot()
                .expect("read current")
                .expect("current"),
            previous
        );
    }

    #[test]
    fn codebase_index_build_lock_serializes_active_builds() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = BrownieStore::new(temp.path());

        let first = store.codebase_index().begin_build().expect("first lock");
        let second = store.codebase_index().begin_build();

        assert!(second.is_err());
        drop(first);
        let third = store.codebase_index().begin_build().expect("third lock");
        drop(third);
    }

    #[cfg(unix)]
    #[test]
    fn codebase_index_reclaims_stale_build_lock_and_commits() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = BrownieStore::new(temp.path());
        let next = test_index_manifest("idx_next", "c");
        let index_dir = temp.path().join(".brownie/codebase-index");
        fs::create_dir_all(&index_dir).expect("index dir");
        fs::write(
            index_dir.join("build.lock"),
            "pid=999999999\ncreated_at=2020-01-01T00:00:00Z\nnonce=1234567890abcdef\nlock_file=build.lock\n",
        )
        .expect("stale lock");

        let event = store
            .codebase_index()
            .commit_current_snapshot(
                &next,
                LedgerEventKind::CodebaseIndexSnapshotBuilt,
                serde_json::json!({"index_id": "idx_next"}),
            )
            .expect("reclaimed commit");

        assert_eq!(event.kind, LedgerEventKind::CodebaseIndexSnapshotBuilt);
        assert_eq!(
            store
                .codebase_index()
                .read_current_snapshot()
                .expect("read current")
                .expect("current"),
            next
        );
        assert!(!index_dir.join("build.lock").exists());
    }

    fn test_index_manifest(
        index_id: &str,
        fingerprint_seed: &str,
    ) -> CodebaseIndexSnapshotManifest {
        CodebaseIndexSnapshotManifest {
            snapshot: brownie_protocol::CodebaseIndexSnapshotSummary {
                index_id: index_id.to_string(),
                root: ".".to_string(),
                workspace_fingerprint: format!("sha256:{}", fingerprint_seed.repeat(64)),
                snapshot_fingerprint: format!("sha256:{}", fingerprint_seed.repeat(64)),
                built_at: "2026-07-24T00:00:00Z".to_string(),
                counts: brownie_protocol::CodebaseIndexCountsSummary {
                    indexed_files: 1,
                    walked_directories: 1,
                    skipped_protected: 0,
                    skipped_ignored: 0,
                    skipped_sensitive: 0,
                    skipped_symlink: 0,
                    skipped_too_large: 0,
                    skipped_binary_like: 0,
                    skipped_unreadable: 0,
                    skipped_unsafe_path: 0,
                    skipped_other: 0,
                    truncated_entries: 0,
                    visited_entries: 1,
                    truncated_directories: 0,
                    ignore_rule_files_loaded: 0,
                    ignore_rule_count: 0,
                    sensitive_finding_count: 0,
                },
                limits: brownie_protocol::CodebaseIndexLimitsSummary {
                    max_files: 10,
                    max_directories: 10,
                    max_path_chars: 512,
                    max_file_bytes: 1024,
                    max_visited_entries: 100,
                    max_directory_entries: 100,
                },
                truncated: false,
            },
            entries: vec![brownie_protocol::CodebaseIndexFileEntry {
                path: "src/lib.rs".to_string(),
                file_kind: "Rust".to_string(),
                byte_length: 12,
                line_count: Some(1),
                content_sha256: Some(format!("sha256:{}", fingerprint_seed.repeat(64))),
            }],
        }
    }

    #[test]
    fn task_start_creates_state_and_ledger() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());

        let record = store
            .start_task(TaskStartParams {
                goal: "test goal".into(),
                mode_id: Some("orchestrator".into()),
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
            })
            .expect("start task");

        let run_dir = store.run_dir(&record.run_id);
        assert!(run_dir.join("state.json").exists());
        assert!(run_dir.join("ledger.jsonl").exists());
        let state: TaskRecord =
            serde_json::from_str(&fs::read_to_string(run_dir.join("state.json")).expect("state"))
                .expect("record");
        assert_eq!(state, record);
        let ledger = fs::read_to_string(run_dir.join("ledger.jsonl")).expect("ledger");
        let event: LedgerEvent =
            serde_json::from_str(ledger.lines().next().expect("event")).expect("ledger event");
        assert_eq!(event.kind, LedgerEventKind::TaskStarted);
        assert_eq!(event.task_id, record.task_id);
    }

    #[test]
    fn update_task_status_updates_state_and_appends_ledger() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());
        let record = store
            .start_task(TaskStartParams {
                goal: "run me".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
            })
            .expect("start task");

        let updated = store
            .update_task_status(
                &record.task_id,
                TaskStatus::Running,
                LedgerEventKind::TaskRunning,
            )
            .expect("update task");

        assert_eq!(updated.status, TaskStatus::Running);
        assert_ne!(updated.updated_at, "");
        let state: TaskRecord = serde_json::from_str(
            &fs::read_to_string(store.run_dir(&record.run_id).join("state.json")).expect("state"),
        )
        .expect("record");
        assert_eq!(state.status, TaskStatus::Running);
        let ledger =
            fs::read_to_string(store.run_dir(&record.run_id).join("ledger.jsonl")).expect("ledger");
        let events: Vec<LedgerEvent> = ledger
            .lines()
            .map(|line| serde_json::from_str(line).expect("event"))
            .collect();
        assert_eq!(events[0].kind, LedgerEventKind::TaskStarted);
        assert_eq!(events[1].kind, LedgerEventKind::TaskRunning);
    }

    #[test]
    fn ledger_read_events_returns_appended_events_in_order() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());
        let record = store
            .start_task(TaskStartParams {
                goal: "read ledger".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
            })
            .expect("start task");
        store
            .update_task_status(
                &record.task_id,
                TaskStatus::Running,
                LedgerEventKind::TaskRunning,
            )
            .expect("update task");

        let events = store
            .read_ledger_events(&record.run_id)
            .expect("read ledger events");
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].kind, LedgerEventKind::TaskStarted);
        assert_eq!(events[1].kind, LedgerEventKind::TaskRunning);
    }

    #[test]
    fn get_and_list_return_created_task() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());
        let record = store
            .start_task(TaskStartParams {
                goal: "list me".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
            })
            .expect("start task");

        assert_eq!(
            store.get_task(&record.task_id).expect("get task"),
            Some(record.clone())
        );
        assert_eq!(store.list_tasks().expect("list tasks"), vec![record]);
    }

    #[test]
    fn start_child_task_records_parent_provenance_and_fingerprint_lookup() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());
        let parent = store
            .start_task(TaskStartParams {
                goal: "parent".into(),
                mode_id: Some("orchestrator".into()),
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
            })
            .expect("start parent");

        let child = store
            .start_child_task(ChildTaskStartParams {
                goal: "child".into(),
                mode_id: parent.mode_id.clone(),
                parent_task_id: parent.task_id.clone(),
                parent_run_id: parent.run_id.clone(),
                source_candidate_id: "subtask_1".into(),
                source_handoff_envelope_id: "handoff_envelope_1".into(),
                source_handoff_envelope_fingerprint: "sha256:child".into(),
                source_intent_summary: Some(ChildTaskSourceIntentSummary {
                    tool_id: "subtask.spawn".into(),
                    required_action: brownie_protocol::RuntimeActionName::SpawnSubtask,
                    request_reason: "Coordinate child work.".into(),
                    requested_goal_preview: Some("Review focused parser boundary work.".into()),
                    requested_mode_id: Some("implementer".into()),
                    input_summary: brownie_protocol::ToolIntentInputSummary {
                        has_path: false,
                        field_count: 2,
                    },
                }),
                recovery_cycle_provenance: None,
                external_modepack_child_provenance: None,
            })
            .expect("start child");

        assert_eq!(child.status, TaskStatus::Queued);
        assert_eq!(
            child.parent_task_id.as_deref(),
            Some(parent.task_id.as_str())
        );
        assert_eq!(child.parent_run_id.as_deref(), Some(parent.run_id.as_str()));
        assert_eq!(child.source_candidate_id.as_deref(), Some("subtask_1"));
        assert_eq!(
            child.source_handoff_envelope_id.as_deref(),
            Some("handoff_envelope_1")
        );
        assert_eq!(
            child.source_handoff_envelope_fingerprint.as_deref(),
            Some("sha256:child")
        );
        let source_intent_summary = child
            .source_intent_summary
            .as_ref()
            .expect("source intent summary");
        assert_eq!(source_intent_summary.tool_id, "subtask.spawn");
        assert_eq!(
            source_intent_summary.required_action,
            brownie_protocol::RuntimeActionName::SpawnSubtask
        );
        assert_eq!(
            source_intent_summary.request_reason,
            "Coordinate child work."
        );
        assert_eq!(
            source_intent_summary.requested_goal_preview.as_deref(),
            Some("Review focused parser boundary work.")
        );
        assert_eq!(
            source_intent_summary.requested_mode_id.as_deref(),
            Some("implementer")
        );
        assert_eq!(source_intent_summary.input_summary.field_count, 2);
        assert_eq!(
            store
                .find_child_task_by_handoff_fingerprint(&parent.run_id, "sha256:child")
                .expect("find child")
                .as_ref()
                .map(|record| record.task_id.as_str()),
            Some(child.task_id.as_str())
        );
        assert_eq!(
            store
                .find_child_task_by_candidate_and_handoff_fingerprint(
                    &parent.run_id,
                    "subtask_1",
                    "sha256:child"
                )
                .expect("find child by candidate")
                .as_ref()
                .map(|record| record.task_id.as_str()),
            Some(child.task_id.as_str())
        );
        assert!(store
            .find_child_task_by_candidate_and_handoff_fingerprint(
                &parent.run_id,
                "subtask_missing",
                "sha256:child"
            )
            .expect("missing candidate child")
            .is_none());
        assert!(store
            .find_child_task_by_handoff_fingerprint(&parent.run_id, "sha256:missing")
            .expect("missing child")
            .is_none());

        let child_events = store
            .read_ledger_events(&child.run_id)
            .expect("child ledger events");
        assert_eq!(child_events.len(), 1);
        assert_eq!(child_events[0].kind, LedgerEventKind::TaskStarted);
        let payload = child_events[0].payload.as_ref().expect("payload");
        assert_eq!(payload["status"], "Queued");
        assert_eq!(payload["parent_task_id"], parent.task_id);
        assert_eq!(payload["parent_run_id"], parent.run_id);
        assert_eq!(payload["source_candidate_id"], "subtask_1");
        assert_eq!(
            payload["source_handoff_envelope_fingerprint"],
            "sha256:child"
        );
        assert_eq!(
            payload["source_intent_summary"]["request_reason"],
            "Coordinate child work."
        );
        assert_eq!(
            payload["source_intent_summary"]["requested_goal_preview"],
            "Review focused parser boundary work."
        );
        assert_eq!(
            payload["source_intent_summary"]["requested_mode_id"],
            "implementer"
        );
        assert!(payload["source_intent_summary"].get("input").is_none());
        assert_eq!(payload["execution_enabled"], false);
        assert_eq!(payload["scheduler_handoff_enabled"], false);
    }
}
