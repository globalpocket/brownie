//! Brownie persistence crate.

use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use brownie_protocol::{
    ChildTaskSourceIntentSummary, CodebaseIndexSnapshotManifest, HeadlessContinueRouteKind,
    HeadlessRunAdvanceResult, HeadlessRunCompletionFinalization, HeadlessRunDriveResult,
    HeadlessRunJourneyExecutionMetadata, HeadlessRunJourneyObjectiveContextMetadata,
    HeadlessRunObjectiveProposalAuthorizationPreflight, HeadlessRunProgressCheckpoint,
    HeadlessRunRecoveryIdentityEvidence, LlmProviderFailureRetryProvenance,
    ModePackActiveSnapshotSummary, ModePackApproveCandidateResult,
    ModePackApprovedCandidateSummary, ModePackCandidateProvenanceSummary, ModePackCandidateSummary,
    ModePackFetchCandidateResult, ModePackRegistryUpdateSelectionSummary,
    ModePackReplaceActiveResult, ModePackRevokedSignerSummary, ModePackRollbackActiveResult,
    ModePackSelectRegistryUpdateResult, ModePackTrustedSignerSummary,
    ModePackUpdateAdmissionSummary, ModePackVerifyCandidateProvenanceResult,
    PatchApplyRecoveryProvenance, ProductContinuationProvenance, ProductLoopStopRecoveryProvenance,
    ProductObjectiveContinuationProvenance, ProposalApplyResult, RecoveryCycleChildProvenance,
    RuntimeDeadline, TaskRecord, TaskStartParams, TaskStatus, VerificationRecoveryProvenance,
    VerificationRecoveryRetryProvenance,
};
use serde::{Deserialize, Serialize};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use uuid::Uuid;

pub const WORKSPACE_STATE_DIR: &str = ".brownie";
pub const RUNS_DIR: &str = "runs";
pub const CODEBASE_INDEX_DIR: &str = "codebase-index";
pub const DURABLE_STORE_SCHEMA_MANIFEST: &str = "store-schema.json";
pub const DURABLE_STORE_SCHEMA_VERSION: u64 = 2;
pub const DURABLE_STORE_SCHEMA_MIN_SUPPORTED_VERSION: u64 = 1;
const DURABLE_STORE_LAYOUT_MANIFEST: &str = "store-layout.json";
const HEADLESS_CONTINUATIONS_DIR: &str = "headless-continuations";
const HEADLESS_OBJECTIVE_ADMISSIONS_DIR: &str = "headless-objective-admissions";
const HEADLESS_JOURNEY_EXECUTIONS_DIR: &str = "headless-journey-executions";
const HEADLESS_JOURNEYS_DIR: &str = "headless-journeys";
const HEADLESS_RUN_SESSIONS_DIR: &str = "headless-run-sessions";
const MODEPACK_ACTIVE_DIR: &str = "modepack-active";
const MODEPACK_ACTIVE_SNAPSHOTS_DIR: &str = "snapshots";
const MODEPACK_CANDIDATES_DIR: &str = "modepack-candidates";
const RUN_ADMISSION_LOCK_RETRIES: usize = 200;
const RUN_ADMISSION_LOCK_SLEEP: Duration = Duration::from_millis(10);
const HEADLESS_OBJECTIVE_ADMISSION_LOCK_STALE_AFTER: Duration = Duration::from_secs(5);
const CODEBASE_INDEX_LOCK_STALE_AFTER_SECONDS: i64 = 30 * 60;
const DURABLE_STORE_SCHEMA_ID: &str = "brownie-runtime-durable-store";
const DURABLE_STORE_SCHEMA_MANIFEST_FORMAT_VERSION: u64 = 1;
const DURABLE_STORE_SCHEMA_STATE_CURRENT: &str = "current";
const DURABLE_STORE_SCHEMA_STATE_MIGRATION_IN_PROGRESS: &str = "migration_in_progress";
const DURABLE_STORE_SCHEMA_MIGRATION_INITIALIZED: &str = "initialized-v2";
const DURABLE_STORE_SCHEMA_MIGRATION_INITIALIZED_V1: &str = "initialized-v1";
const DURABLE_STORE_SCHEMA_MIGRATION_ADOPTED: &str = "adopted-missing-v1-layout";
const DURABLE_STORE_SCHEMA_MIGRATION_ADOPTED_V2: &str = "adopted-missing-v1-layout-to-v2";
const DURABLE_STORE_SCHEMA_MIGRATION_V1_TO_V2: &str = "v1-to-v2-layout-marker";
const DURABLE_STORE_LAYOUT_ID: &str = "brownie-runtime-durable-store-layout";
const DURABLE_STORE_LAYOUT_VERSION: u64 = 1;
const DURABLE_STORE_LAYOUT_CURRENT: &str = "runtime-store-v2-bounded-local-layout";
const RUN_TERMINAL_MUTATION_LOCK: &str = "terminal-mutation.lock";
const RUN_TERMINAL_TRANSITION_MARKER: &str = "terminal-transition.json";
#[cfg(test)]
const DURABLE_SCHEMA_MIGRATION_FAILPOINT_ENV: &str = "BROWNIE_STORE_SCHEMA_MIGRATION_FAILPOINT";
#[cfg(test)]
const DURABLE_SCHEMA_MIGRATION_CHILD_ROOT_ENV: &str = "BROWNIE_STORE_SCHEMA_MIGRATION_CHILD_ROOT";
#[cfg(test)]
const TERMINAL_TRANSITION_FAILPOINT_ENV: &str = "BROWNIE_STORE_TERMINAL_TRANSITION_FAILPOINT";
#[cfg(test)]
const TERMINAL_TRANSITION_CHILD_ROOT_ENV: &str = "BROWNIE_STORE_TERMINAL_TRANSITION_CHILD_ROOT";
const DURABLE_SCHEMA_MIGRATION_FAILPOINT_AFTER_IN_PROGRESS: &str = "after_in_progress_marker";
const DURABLE_SCHEMA_MIGRATION_FAILPOINT_AFTER_LAYOUT: &str = "after_layout_marker";
const DURABLE_SCHEMA_MIGRATION_FAILPOINT_AFTER_CURRENT_V2: &str = "after_current_v2_manifest";
const TERMINAL_TRANSITION_FAILPOINT_AFTER_MARKER: &str = "after_terminal_transition_marker";
const TERMINAL_TRANSITION_FAILPOINT_AFTER_STATE: &str = "after_terminal_state";
const TERMINAL_TRANSITION_FAILPOINT_AFTER_LEDGER: &str = "after_terminal_ledger";
#[cfg(test)]
thread_local! {
    static DURABLE_WRITE_FAILPOINT: std::cell::RefCell<Option<&'static str>> =
        const { std::cell::RefCell::new(None) };
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct DurableStoreSchemaManifest {
    pub schema_id: String,
    pub manifest_format_version: u64,
    pub store_schema_version: u64,
    pub minimum_runtime_store_schema_version: u64,
    pub state: String,
    pub migration: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub migration_from_store_schema_version: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub migration_to_store_schema_version: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct DurableStoreLayoutManifest {
    schema_id: String,
    manifest_format_version: u64,
    store_schema_version: u64,
    layout: String,
    migration: String,
}

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
        let store = Self::new(workspace_root);
        store.ensure_durable_schema()?;
        Ok(store)
    }

    pub fn tasks(&self) -> &TaskStore {
        &self.task_store
    }

    pub fn ensure_durable_schema(&self) -> Result<DurableStoreSchemaManifest> {
        self.task_store.ensure_durable_schema()
    }

    pub fn codebase_index(&self) -> CodebaseIndexStore {
        CodebaseIndexStore::new(self.workspace_root().to_path_buf())
    }

    pub fn read_active_modepack_snapshot(&self) -> Result<Option<ActiveModePackSnapshot>> {
        self.ensure_durable_schema()?;
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

    pub fn read_active_modepack_snapshot_by_fingerprint(
        &self,
        activation_fingerprint: &str,
    ) -> Result<Option<ActiveModePackSnapshot>> {
        self.ensure_durable_schema()?;
        let path = self.active_modepack_snapshot_archive_path(activation_fingerprint);
        if path.exists() {
            let content = fs::read_to_string(&path)
                .with_context(|| format!("failed to read {}", path.display()))?;
            let snapshot: ActiveModePackSnapshot = serde_json::from_str(&content)
                .with_context(|| format!("failed to parse {}", path.display()))?;
            if snapshot.summary.activation_fingerprint != activation_fingerprint {
                bail!("archived active modepack snapshot fingerprint mismatch");
            }
            return Ok(Some(snapshot));
        }
        if let Some(current) = self.read_active_modepack_snapshot()? {
            if current.summary.activation_fingerprint == activation_fingerprint {
                return Ok(Some(current));
            }
        }
        Ok(None)
    }

    pub fn has_active_modepack_state(&self) -> bool {
        self.active_modepack_current_path().exists()
            || self.active_modepack_dir().join("ledger.jsonl").exists()
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
        self.archive_active_modepack_snapshot(&committed)?;
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
        self.archive_active_modepack_snapshot(&previous)?;
        self.archive_active_modepack_snapshot(&replacement)?;
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
        self.archive_active_modepack_snapshot(&current)?;
        self.archive_active_modepack_snapshot(&rollback_snapshot)?;
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

    pub fn active_modepack_replacement_event_matches(
        &self,
        replacement_event_id: &str,
        expected_current_activation_fingerprint: &str,
        expected_rollback_activation_fingerprint: &str,
    ) -> Result<bool> {
        for event in self.read_active_modepack_events()? {
            if event.kind != "ModePackReplaced" || event.event_id != replacement_event_id {
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
                return Ok(false);
            };
            return Ok(
                previous.activation_fingerprint == expected_rollback_activation_fingerprint
                    && replacement.activation_fingerprint
                        == expected_current_activation_fingerprint,
            );
        }
        Ok(false)
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
                        mcp_servers: Vec::new(),
                        global_policy_artifacts: Vec::new(),
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
                        mcp_servers: Vec::new(),
                        global_policy_artifacts: Vec::new(),
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
                    let Some(summary) =
                        event
                            .payload
                            .get("previous_snapshot")
                            .cloned()
                            .and_then(|value| {
                                serde_json::from_value::<ModePackActiveSnapshotSummary>(value).ok()
                            })
                    else {
                        latest = None;
                        saw_summary_only_replacement = true;
                        continue;
                    };
                    let Some(snapshot) = self.read_active_modepack_snapshot_by_fingerprint(
                        &summary.activation_fingerprint,
                    )?
                    else {
                        latest = None;
                        saw_summary_only_replacement = true;
                        continue;
                    };
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
            bail!("latest active modepack replacement private snapshot is missing");
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
        self.ensure_durable_schema()?;
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
        self.ensure_durable_schema()?;
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
        self.ensure_durable_schema()?;
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

    pub fn read_headless_modepack_registry_update_selection_checkpoint(
        &self,
        continuation_id: &str,
    ) -> Result<Option<HeadlessModePackRegistryUpdateSelectionCheckpoint>> {
        self.ensure_durable_schema()?;
        let path = self.headless_modepack_registry_update_selection_path(continuation_id);
        match fs::read_to_string(&path) {
            Ok(body) => serde_json::from_str(&body)
                .with_context(|| format!("failed to parse {}", path.display()))
                .map(Some),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
        }
    }

    pub fn write_headless_modepack_registry_update_selection_checkpoint(
        &self,
        checkpoint: &HeadlessModePackRegistryUpdateSelectionCheckpoint,
    ) -> Result<()> {
        let root = self
            .workspace_root()
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_CONTINUATIONS_DIR);
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create {}", root.display()))?;
        let path =
            self.headless_modepack_registry_update_selection_path(&checkpoint.continuation_id);
        if let Some(existing) = self.read_headless_modepack_registry_update_selection_checkpoint(
            &checkpoint.continuation_id,
        )? {
            if existing == *checkpoint {
                return Ok(());
            }
            bail!(
                "conflicting headless modepack registry update selection checkpoint for {}",
                checkpoint.continuation_id
            );
        }
        let body = serde_json::to_string_pretty(checkpoint).context(
            "failed to serialize headless modepack registry update selection checkpoint",
        )?;
        write_file_atomically(&path, body.as_bytes())
    }

    pub fn read_headless_modepack_selected_candidate_provenance_verification_checkpoint(
        &self,
        continuation_id: &str,
    ) -> Result<Option<HeadlessModePackSelectedCandidateProvenanceVerificationCheckpoint>> {
        self.ensure_durable_schema()?;
        let path =
            self.headless_modepack_selected_candidate_provenance_verification_path(continuation_id);
        match fs::read_to_string(&path) {
            Ok(body) => serde_json::from_str(&body)
                .with_context(|| format!("failed to parse {}", path.display()))
                .map(Some),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
        }
    }

    pub fn write_headless_modepack_selected_candidate_provenance_verification_checkpoint(
        &self,
        checkpoint: &HeadlessModePackSelectedCandidateProvenanceVerificationCheckpoint,
    ) -> Result<()> {
        let root = self
            .workspace_root()
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_CONTINUATIONS_DIR);
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create {}", root.display()))?;
        let path = self.headless_modepack_selected_candidate_provenance_verification_path(
            &checkpoint.continuation_id,
        );
        if let Some(existing) = self
            .read_headless_modepack_selected_candidate_provenance_verification_checkpoint(
                &checkpoint.continuation_id,
            )?
        {
            if existing == *checkpoint {
                return Ok(());
            }
            bail!(
                "conflicting headless modepack selected candidate provenance verification checkpoint for {}",
                checkpoint.continuation_id
            );
        }
        let body = serde_json::to_string_pretty(checkpoint).context(
            "failed to serialize headless modepack selected candidate provenance verification checkpoint",
        )?;
        write_file_atomically(&path, body.as_bytes())
    }

    pub fn read_headless_modepack_selected_candidate_approval_checkpoint(
        &self,
        continuation_id: &str,
    ) -> Result<Option<HeadlessModePackSelectedCandidateApprovalCheckpoint>> {
        self.ensure_durable_schema()?;
        let path = self.headless_modepack_selected_candidate_approval_path(continuation_id);
        match fs::read_to_string(&path) {
            Ok(body) => serde_json::from_str(&body)
                .with_context(|| format!("failed to parse {}", path.display()))
                .map(Some),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
        }
    }

    pub fn write_headless_modepack_selected_candidate_approval_checkpoint(
        &self,
        checkpoint: &HeadlessModePackSelectedCandidateApprovalCheckpoint,
    ) -> Result<()> {
        let root = self
            .workspace_root()
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_CONTINUATIONS_DIR);
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create {}", root.display()))?;
        let path =
            self.headless_modepack_selected_candidate_approval_path(&checkpoint.continuation_id);
        if let Some(existing) = self.read_headless_modepack_selected_candidate_approval_checkpoint(
            &checkpoint.continuation_id,
        )? {
            if existing == *checkpoint {
                return Ok(());
            }
            bail!(
                "conflicting headless modepack selected candidate approval checkpoint for {}",
                checkpoint.continuation_id
            );
        }
        let body = serde_json::to_string_pretty(checkpoint).context(
            "failed to serialize headless modepack selected candidate approval checkpoint",
        )?;
        write_file_atomically(&path, body.as_bytes())
    }

    pub fn read_headless_objective_proposal_authorization_preflight_checkpoint(
        &self,
        continuation_id: &str,
    ) -> Result<Option<HeadlessObjectiveProposalAuthorizationPreflightCheckpoint>> {
        self.ensure_durable_schema()?;
        let path = self.headless_objective_proposal_authorization_preflight_path(continuation_id);
        match fs::read_to_string(&path) {
            Ok(body) => serde_json::from_str(&body)
                .with_context(|| format!("failed to parse {}", path.display()))
                .map(Some),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
        }
    }

    pub fn write_headless_objective_proposal_authorization_preflight_checkpoint(
        &self,
        checkpoint: &HeadlessObjectiveProposalAuthorizationPreflightCheckpoint,
    ) -> Result<()> {
        let root = self
            .workspace_root()
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_CONTINUATIONS_DIR);
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create {}", root.display()))?;
        let path = self
            .headless_objective_proposal_authorization_preflight_path(&checkpoint.continuation_id);
        if let Some(existing) = self
            .read_headless_objective_proposal_authorization_preflight_checkpoint(
                &checkpoint.continuation_id,
            )?
        {
            if existing == *checkpoint {
                return Ok(());
            }
            bail!(
                "conflicting headless objective proposal authorization preflight checkpoint for {}",
                checkpoint.continuation_id
            );
        }
        let body = serde_json::to_string_pretty(checkpoint).context(
            "failed to serialize headless objective proposal authorization preflight checkpoint",
        )?;
        write_file_atomically(&path, body.as_bytes())
    }

    pub fn read_headless_objective_proposal_apply_checkpoint(
        &self,
        continuation_id: &str,
    ) -> Result<Option<HeadlessObjectiveProposalApplyCheckpoint>> {
        self.ensure_durable_schema()?;
        let path = self.headless_objective_proposal_apply_path(continuation_id);
        match fs::read_to_string(&path) {
            Ok(body) => serde_json::from_str(&body)
                .with_context(|| format!("failed to parse {}", path.display()))
                .map(Some),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
        }
    }

    pub fn write_headless_objective_proposal_apply_checkpoint(
        &self,
        checkpoint: &HeadlessObjectiveProposalApplyCheckpoint,
    ) -> Result<()> {
        let root = self
            .workspace_root()
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_CONTINUATIONS_DIR);
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create {}", root.display()))?;
        let path = self.headless_objective_proposal_apply_path(&checkpoint.continuation_id);
        if let Some(existing) =
            self.read_headless_objective_proposal_apply_checkpoint(&checkpoint.continuation_id)?
        {
            if existing == *checkpoint {
                return Ok(());
            }
            bail!(
                "conflicting headless objective proposal apply checkpoint for {}",
                checkpoint.continuation_id
            );
        }
        let body = serde_json::to_string_pretty(checkpoint)
            .context("failed to serialize headless objective proposal apply checkpoint")?;
        write_file_atomically(&path, body.as_bytes())
    }

    pub fn read_headless_objective_apply_verification_checkpoint(
        &self,
        continuation_id: &str,
    ) -> Result<Option<HeadlessObjectiveApplyVerificationCheckpoint>> {
        self.ensure_durable_schema()?;
        let path = self.headless_objective_apply_verification_path(continuation_id);
        match fs::read_to_string(&path) {
            Ok(body) => serde_json::from_str(&body)
                .with_context(|| format!("failed to parse {}", path.display()))
                .map(Some),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
        }
    }

    pub fn write_headless_objective_apply_verification_checkpoint(
        &self,
        checkpoint: &HeadlessObjectiveApplyVerificationCheckpoint,
    ) -> Result<()> {
        let root = self
            .workspace_root()
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_CONTINUATIONS_DIR);
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create {}", root.display()))?;
        let path = self.headless_objective_apply_verification_path(&checkpoint.continuation_id);
        if let Some(existing) =
            self.read_headless_objective_apply_verification_checkpoint(&checkpoint.continuation_id)?
        {
            if existing == *checkpoint {
                return Ok(());
            }
            bail!(
                "conflicting headless objective apply verification checkpoint for {}",
                checkpoint.continuation_id
            );
        }
        let body = serde_json::to_string_pretty(checkpoint)
            .context("failed to serialize headless objective apply verification checkpoint")?;
        write_file_atomically(&path, body.as_bytes())
    }

    pub fn read_headless_objective_completion_acceptance_checkpoint(
        &self,
        continuation_id: &str,
    ) -> Result<Option<HeadlessObjectiveCompletionAcceptanceCheckpoint>> {
        self.ensure_durable_schema()?;
        let path = self.headless_objective_completion_acceptance_path(continuation_id);
        match fs::read_to_string(&path) {
            Ok(body) => serde_json::from_str(&body)
                .with_context(|| format!("failed to parse {}", path.display()))
                .map(Some),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
        }
    }

    pub fn write_headless_objective_completion_acceptance_checkpoint(
        &self,
        checkpoint: &HeadlessObjectiveCompletionAcceptanceCheckpoint,
    ) -> Result<()> {
        let root = self
            .workspace_root()
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_CONTINUATIONS_DIR);
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create {}", root.display()))?;
        let path = self.headless_objective_completion_acceptance_path(&checkpoint.continuation_id);
        if let Some(existing) = self
            .read_headless_objective_completion_acceptance_checkpoint(&checkpoint.continuation_id)?
        {
            if existing == *checkpoint {
                return Ok(());
            }
            bail!(
                "conflicting headless objective completion acceptance checkpoint for {}",
                checkpoint.continuation_id
            );
        }
        let body = serde_json::to_string_pretty(checkpoint)
            .context("failed to serialize headless objective completion acceptance checkpoint")?;
        write_file_atomically(&path, body.as_bytes())
    }

    pub fn read_headless_modepack_selected_candidate_replacement_checkpoint(
        &self,
        continuation_id: &str,
    ) -> Result<Option<HeadlessModePackSelectedCandidateReplacementCheckpoint>> {
        self.ensure_durable_schema()?;
        let path = self.headless_modepack_selected_candidate_replacement_path(continuation_id);
        match fs::read_to_string(&path) {
            Ok(body) => serde_json::from_str(&body)
                .with_context(|| format!("failed to parse {}", path.display()))
                .map(Some),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
        }
    }

    pub fn write_headless_modepack_selected_candidate_replacement_checkpoint(
        &self,
        checkpoint: &HeadlessModePackSelectedCandidateReplacementCheckpoint,
    ) -> Result<()> {
        let root = self
            .workspace_root()
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_CONTINUATIONS_DIR);
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create {}", root.display()))?;
        let path =
            self.headless_modepack_selected_candidate_replacement_path(&checkpoint.continuation_id);
        if let Some(existing) = self
            .read_headless_modepack_selected_candidate_replacement_checkpoint(
                &checkpoint.continuation_id,
            )?
        {
            if existing == *checkpoint {
                return Ok(());
            }
            bail!(
                "conflicting headless modepack selected candidate replacement checkpoint for {}",
                checkpoint.continuation_id
            );
        }
        let body = serde_json::to_string_pretty(checkpoint).context(
            "failed to serialize headless modepack selected candidate replacement checkpoint",
        )?;
        write_file_atomically(&path, body.as_bytes())
    }

    pub fn read_headless_modepack_selected_active_rollback_checkpoint(
        &self,
        continuation_id: &str,
    ) -> Result<Option<HeadlessModePackSelectedActiveRollbackCheckpoint>> {
        self.ensure_durable_schema()?;
        let path = self.headless_modepack_selected_active_rollback_path(continuation_id);
        match fs::read_to_string(&path) {
            Ok(body) => serde_json::from_str(&body)
                .with_context(|| format!("failed to parse {}", path.display()))
                .map(Some),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
        }
    }

    pub fn write_headless_modepack_selected_active_rollback_checkpoint(
        &self,
        checkpoint: &HeadlessModePackSelectedActiveRollbackCheckpoint,
    ) -> Result<()> {
        let root = self
            .workspace_root()
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_CONTINUATIONS_DIR);
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create {}", root.display()))?;
        let path =
            self.headless_modepack_selected_active_rollback_path(&checkpoint.continuation_id);
        if let Some(existing) = self.read_headless_modepack_selected_active_rollback_checkpoint(
            &checkpoint.continuation_id,
        )? {
            if existing == *checkpoint {
                return Ok(());
            }
            bail!(
                "conflicting headless modepack selected active rollback checkpoint for {}",
                checkpoint.continuation_id
            );
        }
        let body = serde_json::to_string_pretty(checkpoint)
            .context("failed to serialize headless modepack selected active rollback checkpoint")?;
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
        self.ensure_durable_schema()?;
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
        self.ensure_durable_schema()?;
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
        self.ensure_durable_schema()?;
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
        self.ensure_durable_schema()?;
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

    fn active_modepack_snapshot_archive_path(&self, activation_fingerprint: &str) -> PathBuf {
        let file_name = activation_fingerprint
            .strip_prefix("sha256:")
            .unwrap_or(activation_fingerprint);
        self.active_modepack_dir()
            .join(MODEPACK_ACTIVE_SNAPSHOTS_DIR)
            .join(format!("{file_name}.json"))
    }

    fn archive_active_modepack_snapshot(&self, snapshot: &ActiveModePackSnapshot) -> Result<()> {
        let path =
            self.active_modepack_snapshot_archive_path(&snapshot.summary.activation_fingerprint);
        if path.exists() {
            return Ok(());
        }
        let parent = path
            .parent()
            .context("active modepack snapshot archive path has no parent")?;
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
        let body = serde_json::to_string_pretty(snapshot)
            .context("failed to serialize archived active modepack snapshot")?;
        write_file_atomically(&path, body.as_bytes())
            .context("failed to write archived active modepack snapshot")
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

    fn headless_modepack_registry_update_selection_path(&self, continuation_id: &str) -> PathBuf {
        self.workspace_root()
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_CONTINUATIONS_DIR)
            .join(format!(
                "modepack-registry-update-selection-{continuation_id}.json"
            ))
    }

    fn headless_modepack_selected_candidate_provenance_verification_path(
        &self,
        continuation_id: &str,
    ) -> PathBuf {
        self.workspace_root()
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_CONTINUATIONS_DIR)
            .join(format!(
                "modepack-selected-provenance-verification-{continuation_id}.json"
            ))
    }

    fn headless_modepack_selected_candidate_approval_path(&self, continuation_id: &str) -> PathBuf {
        self.workspace_root()
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_CONTINUATIONS_DIR)
            .join(format!(
                "modepack-selected-candidate-approval-{continuation_id}.json"
            ))
    }

    fn headless_objective_proposal_authorization_preflight_path(
        &self,
        continuation_id: &str,
    ) -> PathBuf {
        self.workspace_root()
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_CONTINUATIONS_DIR)
            .join(format!(
                "objective-proposal-authorization-preflight-{continuation_id}.json"
            ))
    }

    fn headless_objective_proposal_apply_path(&self, continuation_id: &str) -> PathBuf {
        self.workspace_root()
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_CONTINUATIONS_DIR)
            .join(format!("objective-proposal-apply-{continuation_id}.json"))
    }

    fn headless_objective_apply_verification_path(&self, continuation_id: &str) -> PathBuf {
        self.workspace_root()
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_CONTINUATIONS_DIR)
            .join(format!(
                "objective-apply-verification-{continuation_id}.json"
            ))
    }

    fn headless_objective_completion_acceptance_path(&self, continuation_id: &str) -> PathBuf {
        self.workspace_root()
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_CONTINUATIONS_DIR)
            .join(format!(
                "objective-completion-acceptance-{continuation_id}.json"
            ))
    }

    fn headless_modepack_selected_candidate_replacement_path(
        &self,
        continuation_id: &str,
    ) -> PathBuf {
        self.workspace_root()
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_CONTINUATIONS_DIR)
            .join(format!(
                "modepack-selected-candidate-replacement-{continuation_id}.json"
            ))
    }

    fn headless_modepack_selected_active_rollback_path(&self, continuation_id: &str) -> PathBuf {
        self.workspace_root()
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_CONTINUATIONS_DIR)
            .join(format!(
                "modepack-selected-active-rollback-{continuation_id}.json"
            ))
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
        sync_dir(&root)?;
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
        sync_dir(&root)?;
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when_to_use: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub prompt_sections: Vec<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verification_responsibility: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instruction_fingerprint: Option<String>,
    pub permissions: serde_json::Value,
    #[serde(default)]
    pub workspace_write_scopes: Vec<serde_json::Value>,
    pub allowed_handoff_targets: Option<Vec<String>>,
    #[serde(default)]
    pub mcp_access: Vec<serde_json::Value>,
    pub completion_rules: Vec<String>,
    pub policy_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActiveModePackSnapshot {
    pub summary: ModePackActiveSnapshotSummary,
    #[serde(default)]
    pub mcp_servers: Vec<serde_json::Value>,
    #[serde(default)]
    pub global_policy_artifacts: Vec<serde_json::Value>,
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
pub struct HeadlessModePackRegistryUpdateSelectionCheckpoint {
    pub continuation_id: String,
    pub decision_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_fingerprint: Option<String>,
    pub expected_progress_fingerprint: String,
    pub expected_aggregate_sequence: u64,
    pub current_progress_fingerprint: String,
    pub current_aggregate_sequence: u64,
    pub post_progress_fingerprint: String,
    pub post_aggregate_sequence: u64,
    pub expected_current_activation_fingerprint: String,
    pub expected_registry_manifest_sha256: String,
    pub expected_registry_provenance_statement_sha256: String,
    pub expected_registry_signer_fingerprint: String,
    pub selection_id: String,
    pub selection_event_id: String,
    pub result: ModePackSelectRegistryUpdateResult,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessModePackSelectedCandidateFetchCheckpoint {
    pub continuation_id: String,
    pub decision_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_fingerprint: Option<String>,
    pub expected_progress_fingerprint: String,
    pub expected_aggregate_sequence: u64,
    pub current_progress_fingerprint: String,
    pub current_aggregate_sequence: u64,
    pub post_progress_fingerprint: String,
    pub post_aggregate_sequence: u64,
    pub selection_id: String,
    pub selection_event_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_provenance_statement_url_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_provenance_statement_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_signer_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_current_activation_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance_statement_json: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance_signature_base64: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance_public_key_base64: Option<String>,
    pub result: ModePackFetchCandidateResult,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessModePackSelectedCandidateProvenanceVerificationCheckpoint {
    pub continuation_id: String,
    pub decision_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_fingerprint: Option<String>,
    pub fetch_continuation_id: String,
    pub expected_fetch_decision_id: String,
    pub expected_progress_fingerprint: String,
    pub expected_aggregate_sequence: u64,
    pub current_progress_fingerprint: String,
    pub current_aggregate_sequence: u64,
    pub post_progress_fingerprint: String,
    pub post_aggregate_sequence: u64,
    pub selection_id: String,
    pub selection_event_id: String,
    pub result: ModePackVerifyCandidateProvenanceResult,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessModePackSelectedCandidateApprovalCheckpoint {
    pub continuation_id: String,
    pub decision_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_fingerprint: Option<String>,
    pub fetch_continuation_id: String,
    pub expected_fetch_decision_id: String,
    pub provenance_verification_continuation_id: String,
    pub expected_provenance_verification_decision_id: String,
    pub expected_progress_fingerprint: String,
    pub expected_aggregate_sequence: u64,
    pub current_progress_fingerprint: String,
    pub current_aggregate_sequence: u64,
    pub post_progress_fingerprint: String,
    pub post_aggregate_sequence: u64,
    pub selection_id: String,
    pub selection_event_id: String,
    pub result: ModePackApproveCandidateResult,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessObjectiveProposalAuthorizationPreflightCheckpoint {
    pub continuation_id: String,
    pub decision_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_fingerprint: Option<String>,
    pub expected_progress_fingerprint: String,
    pub expected_aggregate_sequence: u64,
    pub current_progress_fingerprint: String,
    pub current_aggregate_sequence: u64,
    pub post_progress_fingerprint: String,
    pub post_aggregate_sequence: u64,
    pub journey_id: String,
    pub session_id: String,
    pub source_drive_id: String,
    pub proposal_id: String,
    pub result: HeadlessRunObjectiveProposalAuthorizationPreflight,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessObjectiveProposalApplyCheckpoint {
    pub continuation_id: String,
    pub decision_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_fingerprint: Option<String>,
    pub authorization_preflight_continuation_id: String,
    pub expected_authorization_preflight_decision_id: String,
    pub expected_progress_fingerprint: String,
    pub expected_aggregate_sequence: u64,
    pub current_progress_fingerprint: String,
    pub current_aggregate_sequence: u64,
    pub post_progress_fingerprint: String,
    pub post_aggregate_sequence: u64,
    pub journey_id: String,
    pub session_id: String,
    pub source_drive_id: String,
    pub task_id: String,
    pub run_id: String,
    pub proposal_id: String,
    pub source_event_id: String,
    pub source_event_kind: String,
    pub expected_authorization_preflight_fingerprint: String,
    pub expected_preflight_snapshot_id: String,
    pub expected_apply_plan_id: String,
    pub replacement_content_sha256: String,
    pub apply_fingerprint: String,
    pub result: ProposalApplyResult,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessObjectiveApplyVerificationCheckpoint {
    pub continuation_id: String,
    pub decision_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_fingerprint: Option<String>,
    pub objective_apply_continuation_id: String,
    pub expected_objective_apply_decision_id: String,
    pub expected_progress_fingerprint: String,
    pub expected_aggregate_sequence: u64,
    pub current_progress_fingerprint: String,
    pub current_aggregate_sequence: u64,
    pub post_progress_fingerprint: String,
    pub post_aggregate_sequence: u64,
    pub journey_id: String,
    pub session_id: String,
    pub source_drive_id: String,
    pub task_id: String,
    pub run_id: String,
    pub proposal_id: String,
    pub apply_id: String,
    pub expected_path_fingerprint: String,
    pub expected_apply_fingerprint: String,
    pub expected_post_write_sha256: String,
    pub current_target_sha256: String,
    pub verification_status: String,
    pub route_kind: HeadlessContinueRouteKind,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessObjectiveCompletionAcceptanceCheckpoint {
    pub continuation_id: String,
    pub decision_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_fingerprint: Option<String>,
    pub objective_apply_verification_continuation_id: String,
    pub expected_objective_apply_verification_decision_id: String,
    pub expected_progress_fingerprint: String,
    pub expected_aggregate_sequence: u64,
    pub current_progress_fingerprint: String,
    pub current_aggregate_sequence: u64,
    pub post_progress_fingerprint: String,
    pub post_aggregate_sequence: u64,
    pub journey_id: String,
    pub session_id: String,
    pub source_drive_id: String,
    pub task_id: String,
    pub run_id: String,
    pub proposal_id: String,
    pub apply_id: String,
    pub expected_path_fingerprint: String,
    pub expected_apply_fingerprint: String,
    pub expected_post_write_sha256: String,
    pub expected_current_target_sha256: String,
    pub expected_verification_fingerprint: String,
    pub acceptance_status: String,
    pub route_kind: HeadlessContinueRouteKind,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessModePackSelectedCandidateReplacementCheckpoint {
    pub continuation_id: String,
    pub decision_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_fingerprint: Option<String>,
    pub fetch_continuation_id: String,
    pub expected_fetch_decision_id: String,
    pub provenance_verification_continuation_id: String,
    pub expected_provenance_verification_decision_id: String,
    pub approval_continuation_id: String,
    pub expected_approval_decision_id: String,
    pub expected_progress_fingerprint: String,
    pub expected_aggregate_sequence: u64,
    pub current_progress_fingerprint: String,
    pub current_aggregate_sequence: u64,
    pub post_progress_fingerprint: String,
    pub post_aggregate_sequence: u64,
    pub selection_id: String,
    pub selection_event_id: String,
    pub result: ModePackReplaceActiveResult,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessModePackSelectedActiveRollbackCheckpoint {
    pub continuation_id: String,
    pub decision_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_fingerprint: Option<String>,
    pub replacement_event_id: String,
    pub expected_progress_fingerprint: String,
    pub expected_aggregate_sequence: u64,
    pub current_progress_fingerprint: String,
    pub current_aggregate_sequence: u64,
    pub post_progress_fingerprint: String,
    pub post_aggregate_sequence: u64,
    pub expected_current_activation_fingerprint: String,
    pub expected_rollback_activation_fingerprint: String,
    pub result: ModePackRollbackActiveResult,
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
pub struct HeadlessJourneyStartCheckpoint {
    pub journey_id: String,
    pub session_id: String,
    pub drive_id: String,
    pub task_id: String,
    pub run_id: String,
    pub task_start_fingerprint: String,
    pub start_progress: HeadlessRunProgressCheckpoint,
    pub journey_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub objective_context: Option<HeadlessRunJourneyObjectiveContextMetadata>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_objective_continuation_provenance: Option<ProductObjectiveContinuationProvenance>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessObjectiveAdmissionCheckpoint {
    pub admission_id: String,
    pub material_fingerprint: String,
    pub journey_id: String,
    pub session_id: String,
    pub drive_id: String,
    pub task_id: String,
    pub run_id: String,
    pub journey_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessObjectiveAdmissionReservation {
    pub admission_id: String,
    pub material_fingerprint: String,
    pub journey_id: String,
    pub session_id: String,
    pub drive_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadlessJourneyExecutionCheckpoint {
    pub journey_id: String,
    pub session_id: String,
    pub drive_id: String,
    pub request_fingerprint: String,
    pub journey_fingerprint: String,
    pub complete: bool,
    pub metadata: HeadlessRunJourneyExecutionMetadata,
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
        validate_ledger_payload_schema(&kind, &payload)?;
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
        sync_dir(&self.index_dir())?;
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
            let event: CodebaseIndexLedgerEvent = serde_json::from_str(&line)
                .with_context(|| format!("failed to parse {}", ledger_path.display()))?;
            validate_ledger_payload_schema(&event.kind, &event.payload)?;
            events.push(event);
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
                    sync_dir(&root)?;
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
        if !owner.is_reclaimable_stale_build_lock() {
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
            sync_dir(parent)?;
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
        Ok(owner.is_reclaimable_stale_build_lock())
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
            let _ = sync_dir(parent);
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

    fn is_reclaimable_stale_build_lock(&self) -> bool {
        self.is_reclaimable_after_min_age_and_process_exit(
            "build.lock",
            Some(CODEBASE_INDEX_LOCK_STALE_AFTER_SECONDS),
        )
    }

    fn is_reclaimable_after_process_exit(&self, expected_lock_file: &str) -> bool {
        self.is_reclaimable_after_min_age_and_process_exit(expected_lock_file, None)
    }

    fn is_reclaimable_after_min_age_and_process_exit(
        &self,
        expected_lock_file: &str,
        min_age_seconds: Option<i64>,
    ) -> bool {
        let Some(pid) = self.pid else {
            return false;
        };
        let Some(created_at) = self.created_at else {
            return false;
        };
        let Some(nonce) = self.nonce.as_deref() else {
            return false;
        };
        if nonce.len() < 16 || self.lock_file.as_deref() != Some(expected_lock_file) {
            return false;
        }
        if let Some(min_age_seconds) = min_age_seconds {
            let age = OffsetDateTime::now_utc() - created_at;
            if age.whole_seconds() < min_age_seconds {
                return false;
            }
        }
        !process_is_alive(pid)
    }
}

#[cfg(test)]
fn durable_schema_migration_test_failpoint(point: &str) {
    if std::env::var(DURABLE_SCHEMA_MIGRATION_FAILPOINT_ENV).as_deref() == Ok(point) {
        std::process::abort();
    }
}

#[cfg(not(test))]
fn durable_schema_migration_test_failpoint(_point: &str) {}

#[cfg(test)]
fn terminal_transition_test_failpoint(point: &str) {
    if std::env::var(TERMINAL_TRANSITION_FAILPOINT_ENV).as_deref() == Ok(point) {
        std::process::abort();
    }
}

#[cfg(not(test))]
fn terminal_transition_test_failpoint(_point: &str) {}

#[cfg(unix)]
fn process_is_alive(pid: u32) -> bool {
    if pid == 0 || pid > i32::MAX as u32 {
        return false;
    }
    let result = unsafe { libc::kill(pid as i32, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(windows)]
fn process_is_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    type Handle = *mut core::ffi::c_void;
    const SYNCHRONIZE: u32 = 0x0010_0000;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const WAIT_TIMEOUT: u32 = 0x0000_0102;
    const ERROR_ACCESS_DENIED: i32 = 5;
    unsafe extern "system" {
        fn OpenProcess(desired_access: u32, inherit_handle: i32, process_id: u32) -> Handle;
        fn WaitForSingleObject(handle: Handle, milliseconds: u32) -> u32;
        fn CloseHandle(handle: Handle) -> i32;
    }

    let handle = unsafe { OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return std::io::Error::last_os_error().raw_os_error() == Some(ERROR_ACCESS_DENIED);
    }
    let wait = unsafe { WaitForSingleObject(handle, 0) };
    unsafe {
        CloseHandle(handle);
    }
    wait == WAIT_TIMEOUT
}

#[cfg(all(not(unix), not(windows)))]
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
        #[cfg(test)]
        if durable_write_failpoint_matches("disk_full_before_write") {
            bail!("simulated durable write failure: disk_full_before_write");
        }
        #[cfg(test)]
        if durable_write_failpoint_matches("truncated_state_before_rename") {
            let partial_len = body.len().min(1);
            file.write_all(&body[..partial_len]).with_context(|| {
                format!(
                    "failed to write partial temporary file {}",
                    tmp_path.display()
                )
            })?;
            file.sync_all().with_context(|| {
                format!(
                    "failed to sync partial temporary file {}",
                    tmp_path.display()
                )
            })?;
            bail!("simulated durable write failure: truncated_state_before_rename");
        }
        file.write_all(body)
            .with_context(|| format!("failed to write temporary file {}", tmp_path.display()))?;
        file.sync_all()
            .with_context(|| format!("failed to sync temporary file {}", tmp_path.display()))?;
        drop(file);
        #[cfg(test)]
        if durable_write_failpoint_matches("rename_denied_after_sync") {
            bail!("simulated durable write failure: rename_denied_after_sync");
        }
        reject_durable_target_link_or_reparse_point(path)?;
        atomic_replace_file(&tmp_path, path)?;
        sync_dir(parent)?;
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&tmp_path);
    }
    write_result
}

fn reject_durable_target_link_or_reparse_point(path: &std::path::Path) -> Result<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(error)
                .with_context(|| format!("failed to inspect durable target {}", path.display()))
        }
    };
    if metadata.file_type().is_symlink() {
        bail!("durable target must not be a symlink: {}", path.display());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            bail!(
                "durable target must not be a Windows reparse point: {}",
                path.display()
            );
        }
    }
    Ok(())
}

#[cfg(unix)]
fn atomic_replace_file(tmp_path: &std::path::Path, path: &std::path::Path) -> Result<()> {
    fs::rename(tmp_path, path).with_context(|| {
        format!(
            "failed to atomically replace {} from {}",
            path.display(),
            tmp_path.display()
        )
    })
}

#[cfg(windows)]
fn atomic_replace_file(tmp_path: &std::path::Path, path: &std::path::Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x0000_0001;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x0000_0008;
    unsafe extern "system" {
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

    let existing = tmp_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let new = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let moved = unsafe {
        MoveFileExW(
            existing.as_ptr(),
            new.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        return Err(std::io::Error::last_os_error()).with_context(|| {
            format!(
                "failed to atomically replace {} from {}",
                path.display(),
                tmp_path.display()
            )
        });
    }
    Ok(())
}

#[cfg(all(not(unix), not(windows)))]
fn atomic_replace_file(_tmp_path: &std::path::Path, path: &std::path::Path) -> Result<()> {
    bail!(
        "durable atomic replace is unsupported on this platform for {}",
        path.display()
    )
}

#[cfg(test)]
fn durable_write_failpoint_matches(expected: &str) -> bool {
    DURABLE_WRITE_FAILPOINT.with(|failpoint| failpoint.borrow().as_deref() == Some(expected))
}

#[cfg(test)]
fn set_durable_write_failpoint(failpoint: &'static str) -> DurableWriteFailpointGuard {
    DURABLE_WRITE_FAILPOINT.with(|current| {
        *current.borrow_mut() = Some(failpoint);
    });
    DurableWriteFailpointGuard
}

#[cfg(test)]
struct DurableWriteFailpointGuard;

#[cfg(test)]
impl Drop for DurableWriteFailpointGuard {
    fn drop(&mut self) {
        DURABLE_WRITE_FAILPOINT.with(|current| {
            *current.borrow_mut() = None;
        });
    }
}

#[cfg(unix)]
fn sync_dir(path: &std::path::Path) -> Result<()> {
    let file = fs::File::open(path)
        .with_context(|| format!("failed to open directory {}", path.display()))?;
    file.sync_all()
        .with_context(|| format!("failed to sync directory {}", path.display()))
}

#[cfg(windows)]
fn sync_dir(path: &std::path::Path) -> Result<()> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
        .with_context(|| format!("failed to open directory {}", path.display()))?;
    file.sync_all()
        .with_context(|| format!("failed to sync directory {}", path.display()))
}

#[cfg(all(not(unix), not(windows)))]
fn sync_dir(path: &std::path::Path) -> Result<()> {
    bail!(
        "directory durability sync is unsupported on this platform for {}",
        path.display()
    )
}

#[cfg(unix)]
fn reclaim_stale_process_lock(lock_path: &Path, expected_lock_file: &str) -> Result<bool> {
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
        Err(error) => return Err(error).context("failed to inspect process lock"),
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
        return Err(error).context("failed to claim process lock");
    }
    let _claim = FlockGuard {
        fd: file.as_raw_fd(),
    };

    let lock_metadata = file.metadata().context("failed to inspect process lock")?;
    if !lock_metadata.is_file() {
        return Ok(false);
    }
    let mut before = String::new();
    file.read_to_string(&mut before)
        .context("failed to read process lock")?;
    let owner = BuildLockOwner::parse(&before);
    if !owner.is_reclaimable_after_process_exit(expected_lock_file) {
        return Ok(false);
    }

    let path_metadata = match fs::symlink_metadata(lock_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(true),
        Err(error) => return Err(error).context("failed to reinspect process lock"),
    };
    if path_metadata.dev() != lock_metadata.dev() || path_metadata.ino() != lock_metadata.ino() {
        return Ok(false);
    }
    fs::remove_file(lock_path).context("failed to reclaim stale process lock")?;
    if let Some(parent) = lock_path.parent() {
        sync_dir(parent)?;
    }
    Ok(true)
}

#[cfg(windows)]
fn reclaim_stale_process_lock(lock_path: &Path, expected_lock_file: &str) -> Result<bool> {
    reject_durable_target_link_or_reparse_point(lock_path)?;
    let before = match fs::read_to_string(lock_path) {
        Ok(body) => body,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(true),
        Err(error) => return Err(error).context("failed to read process lock"),
    };
    let owner = BuildLockOwner::parse(&before);
    if !owner.is_reclaimable_after_process_exit(expected_lock_file) {
        return Ok(false);
    }

    let claim_path = lock_path.with_extension(format!(
        "{}.reclaiming-{}",
        expected_lock_file,
        Uuid::new_v4().simple()
    ));
    match fs::rename(lock_path, &claim_path) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(true),
        Err(_) => return Ok(false),
    }
    let claimed = match fs::read_to_string(&claim_path) {
        Ok(body) => body,
        Err(error) => {
            let _ = fs::rename(&claim_path, lock_path);
            return Err(error).context("failed to read claimed process lock");
        }
    };
    if claimed != before {
        let _ = fs::rename(&claim_path, lock_path);
        return Ok(false);
    }
    fs::remove_file(&claim_path).context("failed to reclaim stale process lock")?;
    if let Some(parent) = lock_path.parent() {
        sync_dir(parent)?;
    }
    Ok(true)
}

#[cfg(all(not(unix), not(windows)))]
fn reclaim_stale_process_lock(_lock_path: &Path, _expected_lock_file: &str) -> Result<bool> {
    Ok(false)
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
pub struct ProductContinuationTaskStartParams {
    pub goal: String,
    pub mode_id: Option<String>,
    pub provenance: ProductContinuationProvenance,
    pub objective_continuation_provenance: Option<ProductObjectiveContinuationProvenance>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProductContinuationTaskStartResult {
    pub record: TaskRecord,
    pub replayed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProductLoopStopRecoveryTaskStartParams {
    pub goal: String,
    pub mode_id: Option<String>,
    pub provenance: ProductLoopStopRecoveryProvenance,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProductLoopStopRecoveryTaskStartResult {
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

    pub fn ensure_durable_schema(&self) -> Result<DurableStoreSchemaManifest> {
        match self.read_durable_schema_manifest() {
            Ok(Some(manifest)) => {
                if durable_schema_manifest_is_current(&manifest)? {
                    validate_current_durable_schema_manifest(self, &manifest)?;
                    Ok(manifest)
                } else {
                    self.migrate_durable_schema_manifest(manifest)
                }
            }
            Ok(None) => self.initialize_or_adopt_durable_schema_manifest(),
            Err(error) => Err(error),
        }
    }

    pub fn read_durable_schema_manifest(&self) -> Result<Option<DurableStoreSchemaManifest>> {
        let path = self.durable_schema_manifest_path();
        match fs::read_to_string(&path) {
            Ok(body) => serde_json::from_str(&body)
                .with_context(|| format!("failed to parse {}", path.display()))
                .map(Some),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
        }
    }

    pub fn start_task(&self, params: TaskStartParams) -> Result<TaskRecord> {
        self.start_task_with_recovery_identity(params, None)
    }

    pub fn start_task_with_headless_run_recovery_identity(
        &self,
        params: TaskStartParams,
        recovery_identity: HeadlessRunRecoveryIdentityEvidence,
    ) -> Result<TaskRecord> {
        self.start_task_with_recovery_identity(params, Some(recovery_identity))
    }

    fn start_task_with_recovery_identity(
        &self,
        params: TaskStartParams,
        headless_run_recovery_identity: Option<HeadlessRunRecoveryIdentityEvidence>,
    ) -> Result<TaskRecord> {
        self.ensure_durable_schema()?;
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
            product_continuation_provenance: None,
            product_objective_continuation_provenance: None,
            product_loop_stop_recovery_provenance: None,
            headless_run_recovery_identity,
            runtime_deadline: None,
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

    pub fn find_task_by_headless_run_recovery_identity(
        &self,
        recovery_identity: &HeadlessRunRecoveryIdentityEvidence,
    ) -> Result<Vec<TaskRecord>> {
        let mut matches = self
            .list_tasks()?
            .into_iter()
            .filter(|record| {
                record.headless_run_recovery_identity.as_ref() == Some(recovery_identity)
            })
            .collect::<Vec<_>>();
        matches.sort_by(|a, b| a.task_id.cmp(&b.task_id).then(a.run_id.cmp(&b.run_id)));
        Ok(matches)
    }

    pub fn start_child_task(&self, params: ChildTaskStartParams) -> Result<TaskRecord> {
        self.ensure_durable_schema()?;
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
            product_continuation_provenance: None,
            product_objective_continuation_provenance: None,
            product_loop_stop_recovery_provenance: None,
            headless_run_recovery_identity: None,
            runtime_deadline: None,
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
            product_continuation_provenance: None,
            product_objective_continuation_provenance: None,
            product_loop_stop_recovery_provenance: None,
            headless_run_recovery_identity: None,
            runtime_deadline: None,
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
            product_continuation_provenance: None,
            product_objective_continuation_provenance: None,
            product_loop_stop_recovery_provenance: None,
            headless_run_recovery_identity: None,
            runtime_deadline: None,
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
            product_continuation_provenance: None,
            product_objective_continuation_provenance: None,
            product_loop_stop_recovery_provenance: None,
            headless_run_recovery_identity: None,
            runtime_deadline: None,
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
            product_continuation_provenance: None,
            product_objective_continuation_provenance: None,
            product_loop_stop_recovery_provenance: None,
            headless_run_recovery_identity: None,
            runtime_deadline: None,
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

    pub fn start_product_continuation_task(
        &self,
        params: ProductContinuationTaskStartParams,
    ) -> Result<ProductContinuationTaskStartResult> {
        let _lock = self.acquire_run_admission_lock(&params.provenance.source_run_id)?;
        if let Some(record) = self.find_product_continuation_task_by_decision_fingerprint(
            &params.provenance.source_task_id,
            &params.provenance.source_run_id,
            &params.provenance.decision_fingerprint,
        )? {
            if record.product_continuation_provenance.as_ref() == Some(&params.provenance)
                && record.product_objective_continuation_provenance
                    == params.objective_continuation_provenance
                && record.goal == params.goal
                && record.mode_id == params.mode_id
            {
                return Ok(ProductContinuationTaskStartResult {
                    record,
                    replayed: true,
                });
            }
            bail!("conflicting product continuation admission for source decision fingerprint");
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
            llm_provider_failure_retry_provenance: None,
            product_continuation_provenance: Some(params.provenance),
            product_objective_continuation_provenance: params.objective_continuation_provenance,
            product_loop_stop_recovery_provenance: None,
            headless_run_recovery_identity: None,
            runtime_deadline: None,
            created_at: now.clone(),
            updated_at: now,
        };

        let run_dir = self.run_dir(&run_id);
        fs::create_dir_all(&run_dir)
            .with_context(|| format!("failed to create {}", run_dir.display()))?;
        self.write_task_state(&record)?;
        let provenance = record.product_continuation_provenance.clone();
        let objective_provenance = record.product_objective_continuation_provenance.clone();
        self.append_task_event_with_payload(
            &record,
            LedgerEventKind::TaskStarted,
            Some(serde_json::json!({
                "status": "Created",
                "product_continuation_provenance": provenance,
                "product_objective_continuation_provenance": objective_provenance,
                "source_task_id": record
                    .product_continuation_provenance
                    .as_ref()
                    .map(|provenance| provenance.source_task_id.clone()),
                "source_run_id": record
                    .product_continuation_provenance
                    .as_ref()
                    .map(|provenance| provenance.source_run_id.clone()),
                "source_decision_id": record
                    .product_continuation_provenance
                    .as_ref()
                    .map(|provenance| provenance.source_decision_id.clone()),
                "decision_fingerprint": record
                    .product_continuation_provenance
                    .as_ref()
                    .map(|provenance| provenance.decision_fingerprint.clone()),
                "product_evidence_fingerprint": record
                    .product_continuation_provenance
                    .as_ref()
                    .map(|provenance| provenance.product_evidence_fingerprint.clone()),
                "derived_objective_fingerprint": record
                    .product_objective_continuation_provenance
                    .as_ref()
                    .map(|provenance| provenance.derived_objective_fingerprint.clone()),
                "derived_goal_fingerprint": record
                    .product_objective_continuation_provenance
                    .as_ref()
                    .map(|provenance| provenance.derived_goal_fingerprint.clone()),
                "execution_enabled": false,
                "product_continuation_running_enabled": false,
                "scheduler_handoff_enabled": false,
                "next_action": "run_product_continuation_task_explicitly",
                "reason": "Product continuation task admitted from bounded continue_development decision evidence; execution remains explicit."
            })),
        )?;

        Ok(ProductContinuationTaskStartResult {
            record,
            replayed: false,
        })
    }

    pub fn start_product_loop_stop_recovery_task(
        &self,
        params: ProductLoopStopRecoveryTaskStartParams,
    ) -> Result<ProductLoopStopRecoveryTaskStartResult> {
        let _lock = self.acquire_product_loop_stop_recovery_admission_lock(
            &params.provenance.source_session_id,
            &params.provenance.source_drive_id,
        )?;
        if let Some(record) = self.find_product_loop_stop_recovery_task_by_boundary_fingerprint(
            &params.provenance.recovery_boundary_fingerprint,
        )? {
            if record.product_loop_stop_recovery_provenance.as_ref() == Some(&params.provenance)
                && record.goal == params.goal
                && record.mode_id == params.mode_id
            {
                return Ok(ProductLoopStopRecoveryTaskStartResult {
                    record,
                    replayed: true,
                });
            }
            bail!("conflicting product loop stop recovery admission for boundary fingerprint");
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
            llm_provider_failure_retry_provenance: None,
            product_continuation_provenance: None,
            product_objective_continuation_provenance: None,
            product_loop_stop_recovery_provenance: Some(params.provenance),
            headless_run_recovery_identity: None,
            runtime_deadline: None,
            created_at: now.clone(),
            updated_at: now,
        };

        let run_dir = self.run_dir(&run_id);
        fs::create_dir_all(&run_dir)
            .with_context(|| format!("failed to create {}", run_dir.display()))?;
        self.write_task_state(&record)?;
        let provenance = record.product_loop_stop_recovery_provenance.clone();
        self.append_task_event_with_payload(
            &record,
            LedgerEventKind::TaskStarted,
            Some(serde_json::json!({
                "status": "Created",
                "product_loop_stop_recovery_provenance": provenance,
                "source_session_id": record
                    .product_loop_stop_recovery_provenance
                    .as_ref()
                    .map(|provenance| provenance.source_session_id.clone()),
                "source_drive_id": record
                    .product_loop_stop_recovery_provenance
                    .as_ref()
                    .map(|provenance| provenance.source_drive_id.clone()),
                "drive_fingerprint": record
                    .product_loop_stop_recovery_provenance
                    .as_ref()
                    .map(|provenance| provenance.drive_fingerprint.clone()),
                "stop_reason": record
                    .product_loop_stop_recovery_provenance
                    .as_ref()
                    .map(|provenance| provenance.stop_reason.clone()),
                "stop_class": record
                    .product_loop_stop_recovery_provenance
                    .as_ref()
                    .map(|provenance| provenance.stop_class.clone()),
                "source_progress_fingerprint": record
                    .product_loop_stop_recovery_provenance
                    .as_ref()
                    .map(|provenance| provenance.source_progress_fingerprint.clone()),
                "end_session_sequence": record
                    .product_loop_stop_recovery_provenance
                    .as_ref()
                    .map(|provenance| provenance.end_session_sequence),
                "next_route_fingerprint": record
                    .product_loop_stop_recovery_provenance
                    .as_ref()
                    .and_then(|provenance| provenance.next_route_fingerprint.clone()),
                "recovery_boundary_fingerprint": record
                    .product_loop_stop_recovery_provenance
                    .as_ref()
                    .map(|provenance| provenance.recovery_boundary_fingerprint.clone()),
                "execution_enabled": false,
                "product_loop_stop_recovery_running_enabled": false,
                "scheduler_handoff_enabled": false,
                "next_action": "run_recovery_task_explicitly",
                "reason": "Product-loop stop recovery task admitted from bounded recoverable drive-stop evidence; execution remains explicit."
            })),
        )?;

        Ok(ProductLoopStopRecoveryTaskStartResult {
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
        if task_status_is_terminal(&status) {
            return self.update_terminal_task_status_with_payload(
                task_id, None, status, event_kind, payload,
            );
        }

        let Some(mut record) = self.get_task(task_id)? else {
            bail!("task not found: {task_id}");
        };

        record.status = status;
        record.updated_at = timestamp()?;
        self.write_task_state(&record)?;
        self.append_task_event_with_payload(&record, event_kind, payload)?;
        Ok(record)
    }

    pub fn update_task_status_with_runtime_deadline(
        &self,
        task_id: &str,
        status: TaskStatus,
        event_kind: LedgerEventKind,
        runtime_deadline: Option<RuntimeDeadline>,
    ) -> Result<TaskRecord> {
        if task_status_is_terminal(&status) {
            bail!("runtime deadline admission only applies before terminal mutation");
        }
        let Some(mut record) = self.get_task(task_id)? else {
            bail!("task not found: {task_id}");
        };
        let runtime_deadline =
            reconcile_runtime_deadline(record.runtime_deadline.as_ref(), runtime_deadline)?;
        record.runtime_deadline = runtime_deadline.clone();
        record.status = status;
        record.updated_at = timestamp()?;
        self.write_task_state(&record)?;
        let payload = runtime_deadline.map(|deadline| {
            serde_json::json!({
                "runtime_deadline": deadline,
                "deadline_scope": "task_run",
                "deadline_persisted": true
            })
        });
        self.append_task_event_with_payload(&record, event_kind, payload)?;
        Ok(record)
    }

    pub fn update_task_status_with_payload_checked(
        &self,
        task_id: &str,
        expected_status: TaskStatus,
        expected_updated_at: &str,
        status: TaskStatus,
        event_kind: LedgerEventKind,
        payload: Option<serde_json::Value>,
    ) -> Result<TaskRecord> {
        self.update_terminal_task_status_with_payload(
            task_id,
            Some((expected_status, expected_updated_at.to_string())),
            status,
            event_kind,
            payload,
        )
    }

    fn update_terminal_task_status_with_payload(
        &self,
        task_id: &str,
        expected: Option<(TaskStatus, String)>,
        status: TaskStatus,
        event_kind: LedgerEventKind,
        payload: Option<serde_json::Value>,
    ) -> Result<TaskRecord> {
        if !task_status_is_terminal(&status) {
            bail!("terminal task mutation requires a terminal target status");
        }
        if !ledger_event_kind_is_terminal_task(&event_kind) {
            bail!("terminal task mutation requires a terminal ledger event kind");
        }

        let Some(initial_record) = self.get_task(task_id)? else {
            bail!("task not found: {task_id}");
        };
        let run_id = initial_record.run_id.clone();
        let _lock = self.acquire_run_terminal_mutation_lock(&run_id)?;
        self.recover_terminal_transition_marker_for_run_locked(&run_id)?;
        let Some(mut record) = self.read_task_state_by_run_id_raw(&run_id)? else {
            bail!("task not found after terminal mutation lock: {task_id}");
        };
        if record.task_id != task_id {
            bail!("task id changed during terminal mutation: {task_id}");
        }
        if record.run_id != run_id {
            bail!("task run id changed during terminal mutation: {task_id}");
        }
        if let Some((expected_status, expected_updated_at)) = expected.as_ref() {
            if record.status != *expected_status || record.updated_at != *expected_updated_at {
                if task_status_is_terminal(&record.status) && record.status == status {
                    return Ok(record);
                }
                bail!(
                    "task terminal status race: expected {:?} at {} but found {:?} at {}",
                    expected_status,
                    expected_updated_at,
                    record.status,
                    record.updated_at
                );
            }
        }

        let expected_status = record.status.clone();
        let expected_updated_at = record.updated_at.clone();
        record.status = status.clone();
        record.updated_at = timestamp()?;
        let ledger_event = self.build_task_ledger_event(&record, event_kind, payload)?;
        let marker = TerminalTransitionMarker {
            marker_version: 1,
            task_id: record.task_id.clone(),
            run_id: record.run_id.clone(),
            expected_status,
            expected_updated_at,
            terminal_status: status,
            state_updated_at: record.updated_at.clone(),
            ledger_event,
        };
        self.write_terminal_transition_marker(&marker)?;
        terminal_transition_test_failpoint(TERMINAL_TRANSITION_FAILPOINT_AFTER_MARKER);
        self.write_task_state(&record)?;
        terminal_transition_test_failpoint(TERMINAL_TRANSITION_FAILPOINT_AFTER_STATE);
        RunLedger::new(self.run_dir(&record.run_id)).append(&marker.ledger_event)?;
        terminal_transition_test_failpoint(TERMINAL_TRANSITION_FAILPOINT_AFTER_LEDGER);
        self.remove_terminal_transition_marker(&record.run_id)?;
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

    pub fn find_product_continuation_task_by_decision_fingerprint(
        &self,
        source_task_id: &str,
        source_run_id: &str,
        decision_fingerprint: &str,
    ) -> Result<Option<TaskRecord>> {
        for record in self.list_tasks()? {
            if record
                .product_continuation_provenance
                .as_ref()
                .map(|provenance| {
                    provenance.source_task_id.as_str() == source_task_id
                        && provenance.source_run_id.as_str() == source_run_id
                        && provenance.decision_fingerprint.as_str() == decision_fingerprint
                })
                .unwrap_or(false)
            {
                return Ok(Some(record));
            }
        }
        Ok(None)
    }

    pub fn find_product_loop_stop_recovery_task_by_boundary_fingerprint(
        &self,
        recovery_boundary_fingerprint: &str,
    ) -> Result<Option<TaskRecord>> {
        for record in self.list_tasks()? {
            if record
                .product_loop_stop_recovery_provenance
                .as_ref()
                .map(|provenance| provenance.recovery_boundary_fingerprint.as_str())
                == Some(recovery_boundary_fingerprint)
            {
                return Ok(Some(record));
            }
        }
        Ok(None)
    }

    pub fn list_tasks(&self) -> Result<Vec<TaskRecord>> {
        self.ensure_durable_schema()?;
        let runs_dir = self.runs_dir();
        if !runs_dir.exists() {
            return Ok(Vec::new());
        }
        self.recover_terminal_transition_markers()?;

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
        self.ensure_durable_schema()?;
        let run_dir = self.run_dir(&record.run_id);
        fs::create_dir_all(&run_dir)
            .with_context(|| format!("failed to create {}", run_dir.display()))?;
        let state =
            serde_json::to_string_pretty(record).context("failed to serialize task state")?;
        let state_path = run_dir.join("state.json");
        write_file_atomically(&state_path, state.as_bytes()).with_context(|| {
            format!(
                "failed to durably replace task state {}",
                state_path.display()
            )
        })
    }

    fn read_task_state_by_run_id_raw(&self, run_id: &str) -> Result<Option<TaskRecord>> {
        let state_path = self.run_dir(run_id).join("state.json");
        match fs::read_to_string(&state_path) {
            Ok(content) => serde_json::from_str(&content)
                .with_context(|| format!("failed to parse {}", state_path.display()))
                .map(Some),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => {
                Err(error).with_context(|| format!("failed to read {}", state_path.display()))
            }
        }
    }

    fn terminal_transition_marker_path(&self, run_id: &str) -> PathBuf {
        self.run_dir(run_id).join(RUN_TERMINAL_TRANSITION_MARKER)
    }

    fn write_terminal_transition_marker(&self, marker: &TerminalTransitionMarker) -> Result<()> {
        let run_dir = self.run_dir(&marker.run_id);
        fs::create_dir_all(&run_dir)
            .with_context(|| format!("failed to create {}", run_dir.display()))?;
        let body = serde_json::to_vec_pretty(marker)
            .context("failed to serialize terminal transition marker")?;
        write_file_atomically(&run_dir.join(RUN_TERMINAL_TRANSITION_MARKER), &body)
            .context("failed to write terminal transition marker")
    }

    fn remove_terminal_transition_marker(&self, run_id: &str) -> Result<()> {
        let marker_path = self.terminal_transition_marker_path(run_id);
        match fs::remove_file(&marker_path) {
            Ok(()) => {
                if let Some(parent) = marker_path.parent() {
                    sync_dir(parent)?;
                }
                Ok(())
            }
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error).context("failed to remove terminal transition marker"),
        }
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
        self.ensure_durable_schema()?;
        self.recover_terminal_transition_marker_for_run(run_id)?;
        RunLedger::new(self.run_dir(run_id)).read_events()
    }

    pub fn read_headless_continuation_decision(
        &self,
        continuation_id: &str,
    ) -> Result<Option<HeadlessContinuationDecisionLookup>> {
        self.ensure_durable_schema()?;
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
        self.ensure_durable_schema()?;
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
        self.ensure_durable_schema()?;
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

    pub fn read_headless_journey_start_checkpoint(
        &self,
        journey_id: &str,
    ) -> Result<Option<HeadlessJourneyStartCheckpoint>> {
        self.ensure_durable_schema()?;
        let path = self.headless_journey_start_path(journey_id);
        match fs::read_to_string(&path) {
            Ok(body) => serde_json::from_str(&body)
                .with_context(|| format!("failed to parse {}", path.display()))
                .map(Some),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
        }
    }

    pub fn list_headless_journey_start_checkpoints(
        &self,
    ) -> Result<Vec<HeadlessJourneyStartCheckpoint>> {
        self.ensure_durable_schema()?;
        let dir = self.headless_journeys_dir();
        if !dir.exists() {
            return Ok(Vec::new());
        }

        let mut checkpoints = Vec::new();
        for entry in
            fs::read_dir(&dir).with_context(|| format!("failed to read {}", dir.display()))?
        {
            let entry = entry.context("failed to read headless journey directory entry")?;
            if !entry
                .file_type()
                .context("failed to read headless journey entry type")?
                .is_file()
            {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
                continue;
            }
            let content = fs::read_to_string(&path)
                .with_context(|| format!("failed to read {}", path.display()))?;
            checkpoints.push(
                serde_json::from_str(&content)
                    .with_context(|| format!("failed to parse {}", path.display()))?,
            );
        }
        checkpoints.sort_by(
            |a: &HeadlessJourneyStartCheckpoint, b: &HeadlessJourneyStartCheckpoint| {
                a.session_id
                    .cmp(&b.session_id)
                    .then(a.journey_id.cmp(&b.journey_id))
            },
        );
        Ok(checkpoints)
    }

    pub fn write_headless_journey_start_checkpoint(
        &self,
        checkpoint: &HeadlessJourneyStartCheckpoint,
    ) -> Result<()> {
        let path = self.headless_journey_start_path(&checkpoint.journey_id);
        if let Some(existing) =
            self.read_headless_journey_start_checkpoint(&checkpoint.journey_id)?
        {
            if existing == *checkpoint {
                return Ok(());
            }
            bail!(
                "conflicting headless journey start checkpoint for {}",
                checkpoint.journey_id
            );
        }
        let body = serde_json::to_string_pretty(checkpoint)
            .context("failed to serialize headless journey start checkpoint")?;
        write_file_atomically(&path, body.as_bytes())
    }

    pub fn remove_headless_journey_start_checkpoint(
        &self,
        checkpoint: &HeadlessJourneyStartCheckpoint,
    ) -> Result<()> {
        let path = self.headless_journey_start_path(&checkpoint.journey_id);
        match self.read_headless_journey_start_checkpoint(&checkpoint.journey_id)? {
            Some(existing) if existing == *checkpoint => {
                fs::remove_file(&path)
                    .with_context(|| format!("failed to remove {}", path.display()))?;
            }
            Some(_) => bail!(
                "refusing to remove conflicting headless journey start checkpoint for {}",
                checkpoint.journey_id
            ),
            None => {}
        }
        Ok(())
    }

    pub fn read_headless_objective_admission_checkpoint(
        &self,
        admission_id: &str,
    ) -> Result<Option<HeadlessObjectiveAdmissionCheckpoint>> {
        self.ensure_durable_schema()?;
        let path = self.headless_objective_admission_path(admission_id);
        match fs::read_to_string(&path) {
            Ok(body) => serde_json::from_str(&body)
                .with_context(|| format!("failed to parse {}", path.display()))
                .map(Some),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
        }
    }

    pub fn read_headless_objective_admission_reservation(
        &self,
        admission_id: &str,
    ) -> Result<Option<HeadlessObjectiveAdmissionReservation>> {
        self.ensure_durable_schema()?;
        let path = self.headless_objective_admission_reservation_path(admission_id);
        match fs::read_to_string(&path) {
            Ok(body) => serde_json::from_str(&body)
                .with_context(|| format!("failed to parse {}", path.display()))
                .map(Some),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
        }
    }

    pub fn write_headless_objective_admission_reservation(
        &self,
        reservation: &HeadlessObjectiveAdmissionReservation,
    ) -> Result<()> {
        let path = self.headless_objective_admission_reservation_path(&reservation.admission_id);
        if let Some(existing) =
            self.read_headless_objective_admission_reservation(&reservation.admission_id)?
        {
            if existing == *reservation {
                return Ok(());
            }
            bail!(
                "conflicting headless objective admission reservation for {}",
                reservation.admission_id
            );
        }
        let body = serde_json::to_string_pretty(reservation)
            .context("failed to serialize headless objective admission reservation")?;
        write_file_atomically(&path, body.as_bytes())
    }

    pub fn write_headless_objective_admission_checkpoint(
        &self,
        checkpoint: &HeadlessObjectiveAdmissionCheckpoint,
    ) -> Result<()> {
        let path = self.headless_objective_admission_path(&checkpoint.admission_id);
        if let Some(existing) =
            self.read_headless_objective_admission_checkpoint(&checkpoint.admission_id)?
        {
            if existing == *checkpoint {
                return Ok(());
            }
            bail!(
                "conflicting headless objective admission checkpoint for {}",
                checkpoint.admission_id
            );
        }
        let body = serde_json::to_string_pretty(checkpoint)
            .context("failed to serialize headless objective admission checkpoint")?;
        write_file_atomically(&path, body.as_bytes())
    }

    pub fn with_headless_objective_admission_lock<T>(
        &self,
        admission_id: &str,
        f: impl FnOnce() -> Result<T>,
    ) -> Result<T> {
        let _lock = self.acquire_headless_objective_admission_lock(admission_id)?;
        f()
    }

    pub fn remove_headless_objective_admission_checkpoint(
        &self,
        checkpoint: &HeadlessObjectiveAdmissionCheckpoint,
    ) -> Result<()> {
        let path = self.headless_objective_admission_path(&checkpoint.admission_id);
        match self.read_headless_objective_admission_checkpoint(&checkpoint.admission_id)? {
            Some(existing) if existing == *checkpoint => {
                fs::remove_file(&path)
                    .with_context(|| format!("failed to remove {}", path.display()))?;
            }
            Some(_) => bail!(
                "refusing to remove conflicting headless objective admission checkpoint for {}",
                checkpoint.admission_id
            ),
            None => {}
        }
        Ok(())
    }

    pub fn remove_task_run(&self, task_id: &str, run_id: &str) -> Result<()> {
        let Some(record) = self.get_task(task_id)? else {
            return Ok(());
        };
        if record.run_id != run_id {
            bail!("refusing to remove task {task_id} with mismatched run {run_id}");
        }
        let run_dir = self.run_dir(run_id);
        match fs::remove_dir_all(&run_dir) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error)
                .with_context(|| format!("failed to remove task run {}", run_dir.display())),
        }
    }

    pub fn read_headless_journey_execution_checkpoint(
        &self,
        journey_id: &str,
    ) -> Result<Option<HeadlessJourneyExecutionCheckpoint>> {
        self.ensure_durable_schema()?;
        let path = self.headless_journey_execution_path(journey_id);
        match fs::read_to_string(&path) {
            Ok(body) => serde_json::from_str(&body)
                .with_context(|| format!("failed to parse {}", path.display()))
                .map(Some),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
        }
    }

    pub fn write_headless_journey_execution_checkpoint(
        &self,
        checkpoint: &HeadlessJourneyExecutionCheckpoint,
    ) -> Result<()> {
        let path = self.headless_journey_execution_path(&checkpoint.journey_id);
        if let Some(existing) =
            self.read_headless_journey_execution_checkpoint(&checkpoint.journey_id)?
        {
            if existing == *checkpoint {
                return Ok(());
            }
            if existing.session_id != checkpoint.session_id
                || existing.drive_id != checkpoint.drive_id
                || existing.request_fingerprint != checkpoint.request_fingerprint
                || existing.journey_fingerprint != checkpoint.journey_fingerprint
                || existing.metadata.task_id != checkpoint.metadata.task_id
                || existing.metadata.run_id != checkpoint.metadata.run_id
                || existing.metadata.completed_boundaries.len()
                    > checkpoint.metadata.completed_boundaries.len()
            {
                bail!(
                    "conflicting headless journey execution checkpoint for {}",
                    checkpoint.journey_id
                );
            }
        }
        let body = serde_json::to_string_pretty(checkpoint)
            .context("failed to serialize headless journey execution checkpoint")?;
        write_file_atomically(&path, body.as_bytes())
    }

    pub fn read_headless_run_completion_finalization_checkpoint(
        &self,
        session_id: &str,
        drive_id: &str,
    ) -> Result<Option<HeadlessRunCompletionFinalizationCheckpoint>> {
        self.ensure_durable_schema()?;
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
        self.ensure_durable_schema()?;
        let ledger_events = events
            .into_iter()
            .map(|(kind, payload)| self.build_task_ledger_event(record, kind, payload))
            .collect::<Result<Vec<_>>>()?;
        RunLedger::new(self.run_dir(&record.run_id)).append_many(&ledger_events)
    }

    fn build_task_ledger_event(
        &self,
        record: &TaskRecord,
        kind: LedgerEventKind,
        payload: Option<serde_json::Value>,
    ) -> Result<LedgerEvent> {
        let payload_envelope = ledger_payload_envelope(&kind, payload.as_ref())?;
        Ok(LedgerEvent {
            event_id: format!("event_{}", Uuid::new_v4()),
            task_id: record.task_id.clone(),
            run_id: record.run_id.clone(),
            kind,
            timestamp: timestamp()?,
            payload,
            payload_envelope,
        })
    }

    fn recover_terminal_transition_markers(&self) -> Result<()> {
        let runs_dir = self.runs_dir();
        if !runs_dir.exists() {
            return Ok(());
        }
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
            let Some(run_id) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            self.recover_terminal_transition_marker_for_run(&run_id)?;
        }
        Ok(())
    }

    fn recover_terminal_transition_marker_for_run(&self, run_id: &str) -> Result<()> {
        let marker_path = self.terminal_transition_marker_path(run_id);
        if !marker_path.exists() {
            return Ok(());
        }
        let _lock = self.acquire_run_terminal_mutation_lock(run_id)?;
        self.recover_terminal_transition_marker_for_run_locked(run_id)
    }

    fn recover_terminal_transition_marker_for_run_locked(&self, run_id: &str) -> Result<()> {
        let marker_path = self.terminal_transition_marker_path(run_id);
        let body = match fs::read_to_string(&marker_path) {
            Ok(body) => body,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("failed to read {}", marker_path.display()))
            }
        };
        let marker: TerminalTransitionMarker = serde_json::from_str(&body)
            .with_context(|| format!("failed to parse {}", marker_path.display()))?;
        if marker.marker_version != 1 {
            bail!("unsupported terminal transition marker version");
        }
        if marker.run_id != run_id || marker.ledger_event.run_id != run_id {
            bail!("terminal transition marker run id mismatch");
        }
        if marker.ledger_event.task_id != marker.task_id {
            bail!("terminal transition marker task id mismatch");
        }
        if marker.ledger_event.kind != terminal_status_event_kind(&marker.terminal_status)? {
            bail!("terminal transition marker event kind mismatch");
        }
        let ledger = RunLedger::new(self.run_dir(run_id));
        let events = ledger.read_events()?;
        let ledger_has_marker_event = events
            .iter()
            .any(|event| event.event_id == marker.ledger_event.event_id);
        let state = self.read_task_state_by_run_id_raw(run_id)?;
        match state {
            Some(record)
                if record.task_id == marker.task_id
                    && record.status == marker.terminal_status
                    && record.updated_at == marker.state_updated_at =>
            {
                if !ledger_has_marker_event {
                    ledger.append(&marker.ledger_event)?;
                }
                self.remove_terminal_transition_marker(run_id)?;
            }
            Some(record)
                if record.task_id == marker.task_id
                    && record.status == marker.expected_status
                    && record.updated_at == marker.expected_updated_at
                    && !ledger_has_marker_event =>
            {
                self.remove_terminal_transition_marker(run_id)?;
            }
            _ if ledger_has_marker_event => {
                bail!("terminal transition marker has ledger event but task state is inconsistent");
            }
            _ => {
                bail!("terminal transition marker conflicts with current task state");
            }
        }
        Ok(())
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

    fn acquire_run_terminal_mutation_lock(&self, run_id: &str) -> Result<RunAdmissionLock> {
        let run_dir = self.run_dir(run_id);
        fs::create_dir_all(&run_dir)
            .with_context(|| format!("failed to create {}", run_dir.display()))?;
        let lock_path = run_dir.join(RUN_TERMINAL_MUTATION_LOCK);
        for _ in 0..RUN_ADMISSION_LOCK_RETRIES {
            match OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&lock_path)
            {
                Ok(mut file) => {
                    let nonce = Uuid::new_v4();
                    writeln!(file, "pid={}", std::process::id())
                        .context("failed to write terminal mutation lock heartbeat")?;
                    writeln!(file, "created_at={}", timestamp()?)
                        .context("failed to write terminal mutation lock heartbeat")?;
                    writeln!(file, "nonce={nonce}")
                        .context("failed to write terminal mutation lock heartbeat")?;
                    writeln!(file, "lock_file={RUN_TERMINAL_MUTATION_LOCK}")
                        .context("failed to write terminal mutation lock heartbeat")?;
                    file.sync_all()
                        .context("failed to sync terminal mutation lock")?;
                    sync_dir(&run_dir)?;
                    return Ok(RunAdmissionLock { path: lock_path });
                }
                Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                    if reclaim_stale_process_lock(&lock_path, RUN_TERMINAL_MUTATION_LOCK)
                        .context("failed to inspect terminal mutation lock")?
                    {
                        continue;
                    }
                    thread::sleep(RUN_ADMISSION_LOCK_SLEEP);
                }
                Err(error) => {
                    return Err(error)
                        .with_context(|| format!("failed to acquire {}", lock_path.display()));
                }
            }
        }
        bail!(
            "terminal mutation lock remained busy after {} attempts: {}",
            RUN_ADMISSION_LOCK_RETRIES,
            lock_path.display()
        )
    }

    fn acquire_product_loop_stop_recovery_admission_lock(
        &self,
        session_id: &str,
        drive_id: &str,
    ) -> Result<RunAdmissionLock> {
        let drive_path = self.headless_run_session_drive_path(session_id, drive_id);
        let parent = drive_path.parent().with_context(|| {
            format!(
                "failed to resolve product loop stop recovery lock parent for {}",
                drive_path.display()
            )
        })?;
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
        let lock_path = parent.join(format!(
            "{drive_id}.product-loop-stop-recovery-admission.lock"
        ));
        for _ in 0..RUN_ADMISSION_LOCK_RETRIES {
            match OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&lock_path)
            {
                Ok(mut file) => {
                    writeln!(file, "{}", timestamp()?)
                        .context("failed to write product loop stop recovery admission lock")?;
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
            "product loop stop recovery admission lock remained busy after {} attempts: {}",
            RUN_ADMISSION_LOCK_RETRIES,
            lock_path.display()
        )
    }

    fn acquire_headless_objective_admission_lock(
        &self,
        admission_id: &str,
    ) -> Result<RunAdmissionLock> {
        let checkpoint_path = self.headless_objective_admission_path(admission_id);
        let parent = checkpoint_path.parent().with_context(|| {
            format!(
                "failed to resolve headless objective admission lock parent for {}",
                checkpoint_path.display()
            )
        })?;
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
        let lock_path = parent.join(format!("{admission_id}.lock"));
        for _ in 0..RUN_ADMISSION_LOCK_RETRIES {
            match OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&lock_path)
            {
                Ok(mut file) => {
                    writeln!(file, "{}", timestamp()?)
                        .context("failed to write headless objective admission lock")?;
                    return Ok(RunAdmissionLock { path: lock_path });
                }
                Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                    if self
                        .should_reclaim_headless_objective_admission_lock(&lock_path, admission_id)
                        .unwrap_or(false)
                    {
                        match fs::remove_file(&lock_path) {
                            Ok(()) => continue,
                            Err(error) if error.kind() == ErrorKind::NotFound => continue,
                            Err(_) => {}
                        }
                    }
                    thread::sleep(RUN_ADMISSION_LOCK_SLEEP);
                }
                Err(error) => {
                    return Err(error)
                        .with_context(|| format!("failed to acquire {}", lock_path.display()));
                }
            }
        }
        bail!(
            "headless objective admission lock remained busy after {} attempts: {}",
            RUN_ADMISSION_LOCK_RETRIES,
            lock_path.display()
        )
    }

    fn should_reclaim_headless_objective_admission_lock(
        &self,
        lock_path: &Path,
        admission_id: &str,
    ) -> Result<bool> {
        if self
            .read_headless_objective_admission_checkpoint(admission_id)?
            .is_some()
        {
            return Ok(true);
        }
        let Ok(metadata) = fs::metadata(lock_path) else {
            return Ok(false);
        };
        let Ok(modified) = metadata.modified() else {
            return Ok(false);
        };
        let age = modified.elapsed().unwrap_or_default();
        Ok(age >= HEADLESS_OBJECTIVE_ADMISSION_LOCK_STALE_AFTER)
    }

    fn initialize_or_adopt_durable_schema_manifest(&self) -> Result<DurableStoreSchemaManifest> {
        let state_dir_existed = self.workspace_state_dir().exists();
        let _lock = self.acquire_durable_schema_migration_lock()?;
        if let Some(manifest) = self.read_durable_schema_manifest()? {
            if durable_schema_manifest_is_current(&manifest)? {
                validate_current_durable_schema_manifest(self, &manifest)?;
                return Ok(manifest);
            }
            return self.migrate_durable_schema_manifest_locked(manifest);
        }

        let migration = if state_dir_existed {
            DURABLE_STORE_SCHEMA_MIGRATION_ADOPTED_V2
        } else {
            DURABLE_STORE_SCHEMA_MIGRATION_INITIALIZED
        };
        self.write_durable_store_layout_manifest(migration)?;
        let manifest = current_durable_schema_manifest(migration);
        let body = serde_json::to_string_pretty(&manifest)
            .context("failed to serialize durable store schema manifest")?;
        write_file_atomically(&self.durable_schema_manifest_path(), body.as_bytes())
            .context("failed to write durable store schema manifest")?;
        Ok(manifest)
    }

    fn migrate_durable_schema_manifest(
        &self,
        manifest: DurableStoreSchemaManifest,
    ) -> Result<DurableStoreSchemaManifest> {
        let _lock = self.acquire_durable_schema_migration_lock()?;
        if let Some(latest) = self.read_durable_schema_manifest()? {
            if latest != manifest {
                if durable_schema_manifest_is_current(&latest)? {
                    validate_current_durable_schema_manifest(self, &latest)?;
                    return Ok(latest);
                }
                return self.migrate_durable_schema_manifest_locked(latest);
            }
        }
        self.migrate_durable_schema_manifest_locked(manifest)
    }

    fn migrate_durable_schema_manifest_locked(
        &self,
        manifest: DurableStoreSchemaManifest,
    ) -> Result<DurableStoreSchemaManifest> {
        let migration = durable_schema_migration_for_manifest(&manifest)?;
        let in_progress = durable_schema_migration_in_progress_manifest(migration);
        let body = serde_json::to_string_pretty(&in_progress)
            .context("failed to serialize durable schema migration marker")?;
        write_file_atomically(&self.durable_schema_manifest_path(), body.as_bytes())
            .context("failed to write durable schema migration marker")?;
        durable_schema_migration_test_failpoint(
            DURABLE_SCHEMA_MIGRATION_FAILPOINT_AFTER_IN_PROGRESS,
        );

        self.write_durable_store_layout_manifest(migration.id)?;
        durable_schema_migration_test_failpoint(DURABLE_SCHEMA_MIGRATION_FAILPOINT_AFTER_LAYOUT);
        let completed = durable_schema_migration_completed_manifest(migration);
        let body = serde_json::to_string_pretty(&completed)
            .context("failed to serialize durable schema migration completion")?;
        write_file_atomically(&self.durable_schema_manifest_path(), body.as_bytes())
            .context("failed to write durable schema migration completion")?;
        durable_schema_migration_test_failpoint(
            DURABLE_SCHEMA_MIGRATION_FAILPOINT_AFTER_CURRENT_V2,
        );
        validate_current_durable_schema_manifest(self, &completed)?;
        Ok(completed)
    }

    fn read_durable_store_layout_manifest(&self) -> Result<Option<DurableStoreLayoutManifest>> {
        let path = self
            .workspace_state_dir()
            .join(DURABLE_STORE_LAYOUT_MANIFEST);
        match fs::read_to_string(&path) {
            Ok(body) => serde_json::from_str(&body)
                .with_context(|| format!("failed to parse {}", path.display()))
                .map(Some),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
        }
    }

    fn write_durable_store_layout_manifest(&self, migration: &str) -> Result<()> {
        let layout = DurableStoreLayoutManifest {
            schema_id: DURABLE_STORE_LAYOUT_ID.to_string(),
            manifest_format_version: DURABLE_STORE_LAYOUT_VERSION,
            store_schema_version: DURABLE_STORE_SCHEMA_VERSION,
            layout: DURABLE_STORE_LAYOUT_CURRENT.to_string(),
            migration: migration.to_string(),
        };
        if let Some(existing) = self.read_durable_store_layout_manifest()? {
            validate_durable_store_layout_manifest(&existing)?;
            if existing.layout == layout.layout
                && existing.store_schema_version == layout.store_schema_version
            {
                return Ok(());
            }
            bail!("conflicting durable store layout migration marker");
        }
        let body = serde_json::to_string_pretty(&layout)
            .context("failed to serialize durable store layout manifest")?;
        write_file_atomically(
            &self
                .workspace_state_dir()
                .join(DURABLE_STORE_LAYOUT_MANIFEST),
            body.as_bytes(),
        )
        .context("failed to write durable store layout manifest")
    }

    fn acquire_durable_schema_migration_lock(&self) -> Result<RunAdmissionLock> {
        let state_dir = self.workspace_state_dir();
        fs::create_dir_all(&state_dir)
            .with_context(|| format!("failed to create {}", state_dir.display()))?;
        let lock_path = state_dir.join("store-schema.lock");
        for _ in 0..RUN_ADMISSION_LOCK_RETRIES {
            match OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&lock_path)
            {
                Ok(mut file) => {
                    let nonce = Uuid::new_v4();
                    writeln!(file, "pid={}", std::process::id())
                        .context("failed to write durable schema migration lock heartbeat")?;
                    writeln!(file, "created_at={}", timestamp()?)
                        .context("failed to write durable schema migration lock heartbeat")?;
                    writeln!(file, "nonce={nonce}")
                        .context("failed to write durable schema migration lock heartbeat")?;
                    writeln!(file, "lock_file=store-schema.lock")
                        .context("failed to write durable schema migration lock heartbeat")?;
                    file.sync_all()
                        .context("failed to sync durable schema migration lock")?;
                    sync_dir(&state_dir)?;
                    return Ok(RunAdmissionLock { path: lock_path });
                }
                Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                    if self.reclaim_stale_durable_schema_migration_lock(&lock_path)? {
                        continue;
                    }
                    thread::sleep(RUN_ADMISSION_LOCK_SLEEP);
                }
                Err(error) => {
                    return Err(error)
                        .with_context(|| format!("failed to acquire {}", lock_path.display()));
                }
            }
        }
        bail!(
            "durable schema migration lock remained busy after {} attempts: {}",
            RUN_ADMISSION_LOCK_RETRIES,
            lock_path.display()
        )
    }

    #[cfg(unix)]
    fn reclaim_stale_durable_schema_migration_lock(&self, lock_path: &Path) -> Result<bool> {
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
            Err(error) => {
                return Err(error).context("failed to inspect durable schema migration lock")
            }
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
            return Err(error).context("failed to claim stale durable schema migration lock");
        }
        let _claim = FlockGuard {
            fd: file.as_raw_fd(),
        };

        let lock_metadata = file
            .metadata()
            .context("failed to inspect claimed durable schema migration lock")?;
        if !lock_metadata.is_file() {
            return Ok(false);
        }
        let mut before = String::new();
        file.read_to_string(&mut before)
            .context("failed to read claimed durable schema migration lock")?;
        let owner = BuildLockOwner::parse(&before);
        if !owner.is_reclaimable_after_process_exit("store-schema.lock") {
            return Ok(false);
        }

        let path_metadata = match fs::symlink_metadata(lock_path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(true),
            Err(error) => {
                return Err(error).context("failed to reinspect durable schema migration lock")
            }
        };
        if path_metadata.dev() != lock_metadata.dev() || path_metadata.ino() != lock_metadata.ino()
        {
            return Ok(false);
        }
        fs::remove_file(lock_path)
            .context("failed to reclaim stale durable schema migration lock")?;
        if let Some(parent) = lock_path.parent() {
            sync_dir(parent)?;
        }
        Ok(true)
    }

    #[cfg(not(unix))]
    fn reclaim_stale_durable_schema_migration_lock(&self, _lock_path: &Path) -> Result<bool> {
        Ok(false)
    }

    fn durable_schema_manifest_path(&self) -> PathBuf {
        self.workspace_state_dir()
            .join(DURABLE_STORE_SCHEMA_MANIFEST)
    }

    fn workspace_state_dir(&self) -> PathBuf {
        self.workspace_root.join(WORKSPACE_STATE_DIR)
    }

    fn runs_dir(&self) -> PathBuf {
        self.workspace_state_dir().join(RUNS_DIR)
    }

    fn headless_continuation_decision_path(&self, continuation_id: &str) -> PathBuf {
        self.workspace_root
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_CONTINUATIONS_DIR)
            .join(format!("{continuation_id}.json"))
    }

    fn headless_objective_admission_path(&self, admission_id: &str) -> PathBuf {
        self.workspace_root
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_OBJECTIVE_ADMISSIONS_DIR)
            .join(format!("{admission_id}.json"))
    }

    fn headless_objective_admission_reservation_path(&self, admission_id: &str) -> PathBuf {
        self.workspace_root
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_OBJECTIVE_ADMISSIONS_DIR)
            .join(format!("{admission_id}.reservation.json"))
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

    fn headless_journey_start_path(&self, journey_id: &str) -> PathBuf {
        self.headless_journeys_dir()
            .join(format!("{journey_id}.json"))
    }

    fn headless_journeys_dir(&self) -> PathBuf {
        self.workspace_root
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_JOURNEYS_DIR)
    }

    fn headless_journey_execution_path(&self, journey_id: &str) -> PathBuf {
        self.workspace_root
            .join(WORKSPACE_STATE_DIR)
            .join(HEADLESS_JOURNEY_EXECUTIONS_DIR)
            .join(format!("{journey_id}.json"))
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
        if let Some(parent) = self.path.parent() {
            let _ = sync_dir(parent);
        }
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
            validate_ledger_event_payload_contract(event, true)
                .context("failed to validate ledger event payload contract before append")?;
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
        file.sync_all()
            .context("failed to sync run ledger events")?;
        sync_dir(&self.run_dir)?;
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
            events.push({
                let event = serde_json::from_str::<LedgerEvent>(&line)
                    .with_context(|| format!("failed to parse {}", ledger_path.display()))?;
                validate_ledger_event_payload_contract(&event, false)
                    .with_context(|| format!("failed to validate {}", ledger_path.display()))?;
                event
            });
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

fn task_status_is_terminal(status: &TaskStatus) -> bool {
    matches!(
        status,
        TaskStatus::Completed | TaskStatus::Failed | TaskStatus::Cancelled
    )
}

fn validate_runtime_deadline(deadline: &RuntimeDeadline) -> Result<()> {
    if deadline.deadline_id.trim().is_empty() {
        bail!("runtime deadline id must not be empty");
    }
    OffsetDateTime::parse(&deadline.expires_at, &Rfc3339)
        .context("runtime deadline expires_at must be RFC3339")?;
    Ok(())
}

fn reconcile_runtime_deadline(
    existing: Option<&RuntimeDeadline>,
    requested: Option<RuntimeDeadline>,
) -> Result<Option<RuntimeDeadline>> {
    if let Some(deadline) = existing {
        validate_runtime_deadline(deadline)?;
    }
    if let Some(deadline) = requested.as_ref() {
        validate_runtime_deadline(deadline)?;
    }
    match (existing, requested) {
        (Some(existing), Some(requested)) if existing != &requested => {
            bail!("runtime deadline mismatch for resumed task/run");
        }
        (Some(existing), _) => Ok(Some(existing.clone())),
        (None, requested) => Ok(requested),
    }
}

fn ledger_event_kind_is_terminal_task(kind: &LedgerEventKind) -> bool {
    matches!(
        kind,
        LedgerEventKind::TaskCompleted
            | LedgerEventKind::TaskFailed
            | LedgerEventKind::TaskCancelled
    )
}

fn terminal_status_event_kind(status: &TaskStatus) -> Result<LedgerEventKind> {
    match status {
        TaskStatus::Completed => Ok(LedgerEventKind::TaskCompleted),
        TaskStatus::Failed => Ok(LedgerEventKind::TaskFailed),
        TaskStatus::Cancelled => Ok(LedgerEventKind::TaskCancelled),
        _ => bail!("task status is not terminal"),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct LedgerPayloadEnvelope {
    pub schema_version: u64,
    pub shape_id: String,
    pub shape_fingerprint: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub schema_id: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub schema_fingerprint: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub instance_shape_fingerprint: String,
}

pub const LEDGER_PAYLOAD_SCHEMA_VERSION: u64 = 12;
pub const LEDGER_PAYLOAD_SHAPE_VERSION: u64 = LEDGER_PAYLOAD_SCHEMA_VERSION;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LedgerPayloadSchemaClassification {
    PayloadAbsent,
    StrictTyped,
    TypedKnownFieldsOpen,
    VersionedOpen,
    LegacyCompatibilityOnly,
}

impl LedgerPayloadSchemaClassification {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PayloadAbsent => "payload_absent",
            Self::StrictTyped => "strict_typed",
            Self::TypedKnownFieldsOpen => "typed_known_fields_open",
            Self::VersionedOpen => "versioned_open",
            Self::LegacyCompatibilityOnly => "legacy_compatibility_only",
        }
    }

    pub fn contract_status(self) -> &'static str {
        match self {
            Self::PayloadAbsent | Self::StrictTyped => "closed",
            Self::TypedKnownFieldsOpen | Self::VersionedOpen => "partial",
            Self::LegacyCompatibilityOnly => "legacy_only",
        }
    }

    pub fn release_blocking(self) -> bool {
        matches!(self, Self::TypedKnownFieldsOpen | Self::VersionedOpen)
    }
}

pub fn ledger_payload_schema_classification(
    kind: &LedgerEventKind,
) -> LedgerPayloadSchemaClassification {
    match kind {
        LedgerEventKind::TaskCompleted
        | LedgerEventKind::TaskFailed
        | LedgerEventKind::TaskCancelled
        | LedgerEventKind::PermissionChecked
        | LedgerEventKind::PermissionDenied
        | LedgerEventKind::ToolPlanned
        | LedgerEventKind::ToolPermissionChecked
        | LedgerEventKind::ToolPlanApproved
        | LedgerEventKind::ToolPlanDenied
        | LedgerEventKind::ToolIntentParsed
        | LedgerEventKind::ToolIntentRejected
        | LedgerEventKind::ToolIntentPermissionChecked
        | LedgerEventKind::ToolIntentApproved
        | LedgerEventKind::ToolIntentDenied
        | LedgerEventKind::ToolExecutionRequested
        | LedgerEventKind::McpToolExecutionApproved
        | LedgerEventKind::ToolExecutionPermissionChecked
        | LedgerEventKind::ToolExecutionCompleted
        | LedgerEventKind::ToolExecutionFailed
        | LedgerEventKind::ToolExecutionDenied
        | LedgerEventKind::CodebaseIndexPermissionChecked
        | LedgerEventKind::CodebaseIndexSnapshotBuilt
        | LedgerEventKind::CodebaseIndexQueryCompleted
        | LedgerEventKind::CodebaseIndexSelectionReadCompleted
        | LedgerEventKind::CodebaseIndexPromptContextMaterialized
        | LedgerEventKind::VerificationRecoveryContextReadMaterialized
        | LedgerEventKind::AgentLoopStarted
        | LedgerEventKind::AgentLoopCompleted
        | LedgerEventKind::TaskCompletionAccepted
        | LedgerEventKind::PromptBuilt
        | LedgerEventKind::PromptSensitiveScanCompleted
        | LedgerEventKind::PromptSensitiveScanFailed
        | LedgerEventKind::LlmRequestCreated
        | LedgerEventKind::LlmRequestFailed
        | LedgerEventKind::LlmResponseReceived
        | LedgerEventKind::SecondPassPromptBuilt
        | LedgerEventKind::SecondPassLlmRequestCreated
        | LedgerEventKind::SecondPassLlmRequestFailed
        | LedgerEventKind::SecondPassLlmResponseReceived
        | LedgerEventKind::TaskStarted
        | LedgerEventKind::TaskRunning
        | LedgerEventKind::ModeResolved
        | LedgerEventKind::ExternalModePackChildProvenanceDenied
        | LedgerEventKind::ExternalModePackTaskProvenanceDenied
        | LedgerEventKind::SubtaskOrchestrationQueued
        | LedgerEventKind::SubtaskHandoffPrepared
        | LedgerEventKind::SubtaskSchedulerReadinessRecorded
        | LedgerEventKind::SubtaskDispatchPlanPrepared
        | LedgerEventKind::SubtaskDispatchContractPrepared
        | LedgerEventKind::SubtaskDispatchAdmissionEvaluated
        | LedgerEventKind::SubtaskDispatchReadinessSnapshotRecorded
        | LedgerEventKind::SubtaskDispatcherGuardVerdictRecorded
        | LedgerEventKind::SubtaskDispatchDecisionRecorded
        | LedgerEventKind::SubtaskDispatchCandidateManifestRecorded
        | LedgerEventKind::SubtaskDispatchHandoffEnvelopeRecorded
        | LedgerEventKind::ParentJoinContinuationFingerprintConsumed
        | LedgerEventKind::WorkspacePatchProposed
        | LedgerEventKind::WorkspacePatchApproved
        | LedgerEventKind::WorkspacePatchRejected
        | LedgerEventKind::WorkspacePatchPreflightSnapshotCreated
        | LedgerEventKind::WorkspacePatchApplyPlanCreated
        | LedgerEventKind::WorkspacePatchApplyCapabilityChecked
        | LedgerEventKind::WorkspacePatchApplyDryRunChecked
        | LedgerEventKind::WorkspacePatchApplyResultRecorded
        | LedgerEventKind::WorkspacePatchReadinessReportCreated => {
            LedgerPayloadSchemaClassification::StrictTyped
        }
        LedgerEventKind::WorkspacePatchApprovalRequested => {
            LedgerPayloadSchemaClassification::PayloadAbsent
        }
        _ => LedgerPayloadSchemaClassification::VersionedOpen,
    }
}

pub fn ledger_payload_shape_id(kind: &LedgerEventKind) -> String {
    ledger_payload_schema_id(kind)
}

pub fn ledger_payload_schema_id(kind: &LedgerEventKind) -> String {
    format!("ledger_payload.{kind:?}.v{LEDGER_PAYLOAD_SCHEMA_VERSION}")
}

pub fn ledger_payload_shape_fingerprint(kind: &LedgerEventKind) -> String {
    ledger_payload_schema_fingerprint(kind)
}

pub fn ledger_payload_schema_fingerprint(kind: &LedgerEventKind) -> String {
    stable_ledger_payload_fingerprint(&ledger_payload_schema_fingerprint_input(kind))
}

pub fn ledger_payload_shape_fingerprint_for_value(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> String {
    ledger_payload_instance_shape_fingerprint_for_value(kind, payload)
}

pub fn ledger_payload_instance_shape_fingerprint_for_value(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> String {
    stable_ledger_payload_fingerprint(&ledger_payload_instance_shape_fingerprint_input(
        kind,
        &ledger_payload_shape_descriptor(payload),
    ))
}

fn ledger_payload_envelope(
    kind: &LedgerEventKind,
    payload: Option<&serde_json::Value>,
) -> Result<Option<LedgerPayloadEnvelope>> {
    let Some(payload) = payload else {
        return Ok(None);
    };
    validate_ledger_payload_schema(kind, payload)?;
    let schema_id = ledger_payload_schema_id(kind);
    let schema_fingerprint = ledger_payload_schema_fingerprint(kind);
    Ok(Some(LedgerPayloadEnvelope {
        schema_version: LEDGER_PAYLOAD_SCHEMA_VERSION,
        shape_id: schema_id.clone(),
        shape_fingerprint: schema_fingerprint.clone(),
        schema_id,
        schema_fingerprint,
        instance_shape_fingerprint: ledger_payload_instance_shape_fingerprint_for_value(
            kind, payload,
        ),
    }))
}

fn validate_ledger_event_payload_contract(
    event: &LedgerEvent,
    require_current: bool,
) -> Result<()> {
    match (&event.payload, &event.payload_envelope) {
        (None, None) => Ok(()),
        (None, Some(_)) => bail!("ledger event has payload envelope without payload"),
        (Some(payload), None) if !require_current => {
            validate_ledger_payload_schema(&event.kind, payload)
        }
        (Some(_), None) => bail!("ledger event payload is missing payload_envelope"),
        (Some(payload), Some(envelope))
            if !require_current && envelope.schema_version < LEDGER_PAYLOAD_SCHEMA_VERSION =>
        {
            validate_legacy_ledger_payload_envelope(&event.kind, payload, envelope)
        }
        (Some(payload), Some(envelope)) => {
            validate_ledger_payload_schema(&event.kind, payload)?;
            validate_ledger_payload_envelope(&event.kind, payload, envelope)
        }
    }
}

fn validate_ledger_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    match ledger_payload_schema_classification(kind) {
        LedgerPayloadSchemaClassification::PayloadAbsent => {
            bail!("{kind:?} ledger event does not accept a payload");
        }
        LedgerPayloadSchemaClassification::StrictTyped => {
            validate_strict_ledger_payload_schema(kind, payload)?;
        }
        LedgerPayloadSchemaClassification::TypedKnownFieldsOpen => {
            validate_task_completed_payload_schema(payload)?;
        }
        LedgerPayloadSchemaClassification::VersionedOpen => {
            if payload.is_null() {
                bail!("{kind:?} versioned-open ledger payload must not be null");
            }
        }
        LedgerPayloadSchemaClassification::LegacyCompatibilityOnly => {
            bail!("{kind:?} ledger payload schema is legacy-read compatibility only");
        }
    }
    Ok(())
}

fn validate_task_completed_payload_schema(payload: &serde_json::Value) -> Result<()> {
    validate_terminal_task_payload_schema(&LedgerEventKind::TaskCompleted, payload)
}

fn validate_strict_ledger_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    match kind {
        LedgerEventKind::TaskCompleted
        | LedgerEventKind::TaskFailed
        | LedgerEventKind::TaskCancelled => validate_terminal_task_payload_schema(kind, payload),
        LedgerEventKind::PermissionChecked | LedgerEventKind::PermissionDenied => {
            validate_permission_payload_schema(kind, payload)
        }
        LedgerEventKind::ToolPlanned => validate_tool_planned_payload_schema(kind, payload),
        LedgerEventKind::ToolPermissionChecked
        | LedgerEventKind::ToolPlanApproved
        | LedgerEventKind::ToolPlanDenied => validate_tool_plan_payload_schema(kind, payload),
        LedgerEventKind::ToolIntentParsed => {
            validate_tool_intent_parsed_payload_schema(kind, payload)
        }
        LedgerEventKind::ToolIntentRejected => {
            validate_tool_intent_rejected_payload_schema(kind, payload)
        }
        LedgerEventKind::ToolIntentPermissionChecked
        | LedgerEventKind::ToolIntentApproved
        | LedgerEventKind::ToolIntentDenied => validate_tool_intent_payload_schema(kind, payload),
        LedgerEventKind::ToolExecutionRequested => {
            validate_tool_execution_requested_payload_schema(kind, payload)
        }
        LedgerEventKind::ToolExecutionPermissionChecked => {
            validate_tool_execution_permission_payload_schema(kind, payload)
        }
        LedgerEventKind::McpToolExecutionApproved => {
            validate_mcp_tool_execution_approved_payload_schema(kind, payload)
        }
        LedgerEventKind::ToolExecutionCompleted => {
            validate_tool_execution_terminal_payload_schema(kind, payload, "Completed")
        }
        LedgerEventKind::ToolExecutionDenied => {
            validate_tool_execution_terminal_payload_schema(kind, payload, "Denied")
        }
        LedgerEventKind::ToolExecutionFailed => {
            validate_tool_execution_terminal_payload_schema(kind, payload, "Failed")
        }
        LedgerEventKind::CodebaseIndexPermissionChecked => {
            validate_codebase_index_permission_payload_schema(kind, payload)
        }
        LedgerEventKind::CodebaseIndexSnapshotBuilt => {
            validate_codebase_index_snapshot_built_payload_schema(kind, payload)
        }
        LedgerEventKind::CodebaseIndexQueryCompleted => {
            validate_codebase_index_query_completed_payload_schema(kind, payload)
        }
        LedgerEventKind::CodebaseIndexSelectionReadCompleted => {
            validate_codebase_index_selection_read_completed_payload_schema(kind, payload)
        }
        LedgerEventKind::CodebaseIndexPromptContextMaterialized => {
            validate_codebase_index_prompt_context_materialized_payload_schema(kind, payload)
        }
        LedgerEventKind::VerificationRecoveryContextReadMaterialized => {
            validate_verification_recovery_context_read_materialized_payload_schema(kind, payload)
        }
        LedgerEventKind::AgentLoopStarted => {
            validate_agent_loop_started_payload_schema(kind, payload)
        }
        LedgerEventKind::AgentLoopCompleted => {
            validate_agent_loop_completed_payload_schema(kind, payload)
        }
        LedgerEventKind::TaskCompletionAccepted => {
            validate_task_completion_accepted_payload_schema(kind, payload)
        }
        LedgerEventKind::PromptBuilt | LedgerEventKind::SecondPassPromptBuilt => {
            validate_prompt_built_payload_schema(kind, payload)
        }
        LedgerEventKind::PromptSensitiveScanCompleted
        | LedgerEventKind::PromptSensitiveScanFailed => {
            validate_prompt_sensitive_scan_payload_schema(kind, payload)
        }
        LedgerEventKind::LlmRequestCreated | LedgerEventKind::SecondPassLlmRequestCreated => {
            validate_llm_request_created_payload_schema(kind, payload)
        }
        LedgerEventKind::LlmRequestFailed | LedgerEventKind::SecondPassLlmRequestFailed => {
            validate_llm_request_failed_payload_schema(kind, payload)
        }
        LedgerEventKind::LlmResponseReceived | LedgerEventKind::SecondPassLlmResponseReceived => {
            validate_llm_response_received_payload_schema(kind, payload)
        }
        LedgerEventKind::TaskStarted => validate_task_started_payload_schema(kind, payload),
        LedgerEventKind::TaskRunning => validate_task_running_payload_schema(kind, payload),
        LedgerEventKind::ModeResolved => validate_mode_resolved_payload_schema(kind, payload),
        LedgerEventKind::ExternalModePackChildProvenanceDenied => {
            validate_external_modepack_child_denied_payload_schema(kind, payload)
        }
        LedgerEventKind::ExternalModePackTaskProvenanceDenied => {
            validate_external_modepack_task_denied_payload_schema(kind, payload)
        }
        LedgerEventKind::SubtaskOrchestrationQueued => {
            validate_subtask_orchestration_queued_payload_schema(kind, payload)
        }
        LedgerEventKind::SubtaskHandoffPrepared => {
            validate_subtask_handoff_prepared_payload_schema(kind, payload)
        }
        LedgerEventKind::SubtaskSchedulerReadinessRecorded => {
            validate_subtask_scheduler_readiness_payload_schema(kind, payload)
        }
        LedgerEventKind::SubtaskDispatchPlanPrepared => {
            validate_subtask_dispatch_plan_payload_schema(kind, payload)
        }
        LedgerEventKind::SubtaskDispatchContractPrepared => {
            validate_subtask_dispatch_contract_payload_schema(kind, payload)
        }
        LedgerEventKind::SubtaskDispatchAdmissionEvaluated => {
            validate_subtask_dispatch_admission_payload_schema(kind, payload)
        }
        LedgerEventKind::SubtaskDispatchReadinessSnapshotRecorded => {
            validate_subtask_dispatch_readiness_snapshot_payload_schema(kind, payload)
        }
        LedgerEventKind::SubtaskDispatcherGuardVerdictRecorded => {
            validate_subtask_dispatcher_guard_verdict_payload_schema(kind, payload)
        }
        LedgerEventKind::SubtaskDispatchDecisionRecorded => {
            validate_subtask_dispatch_decision_payload_schema(kind, payload)
        }
        LedgerEventKind::SubtaskDispatchCandidateManifestRecorded => {
            validate_subtask_dispatch_candidate_manifest_payload_schema(kind, payload)
        }
        LedgerEventKind::SubtaskDispatchHandoffEnvelopeRecorded => {
            validate_subtask_dispatch_handoff_envelope_payload_schema(kind, payload)
        }
        LedgerEventKind::ParentJoinContinuationFingerprintConsumed => {
            validate_parent_join_continuation_consumed_payload_schema(kind, payload)
        }
        LedgerEventKind::WorkspacePatchProposed => {
            validate_workspace_patch_proposed_payload_schema(kind, payload)
        }
        LedgerEventKind::WorkspacePatchApproved => {
            validate_workspace_patch_approved_payload_schema(kind, payload)
        }
        LedgerEventKind::WorkspacePatchRejected => {
            validate_workspace_patch_rejected_payload_schema(kind, payload)
        }
        LedgerEventKind::WorkspacePatchPreflightSnapshotCreated => {
            validate_workspace_patch_preflight_snapshot_payload_schema(kind, payload)
        }
        LedgerEventKind::WorkspacePatchApplyPlanCreated => {
            validate_workspace_patch_apply_plan_payload_schema(kind, payload)
        }
        LedgerEventKind::WorkspacePatchApplyCapabilityChecked => {
            validate_workspace_patch_apply_capability_payload_schema(kind, payload)
        }
        LedgerEventKind::WorkspacePatchApplyDryRunChecked => {
            validate_workspace_patch_apply_dry_run_payload_schema(kind, payload)
        }
        LedgerEventKind::WorkspacePatchApplyResultRecorded => {
            validate_workspace_patch_apply_result_payload_schema(kind, payload)
        }
        LedgerEventKind::WorkspacePatchReadinessReportCreated => {
            validate_workspace_patch_readiness_report_payload_schema(kind, payload)
        }
        _ => bail!("{kind:?} strict ledger payload schema is not registered"),
    }
}

fn validate_terminal_task_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = payload
        .as_object()
        .with_context(|| format!("{kind:?} ledger payload must be a JSON object"))?;
    for field in object.keys() {
        if !TERMINAL_TASK_KNOWN_PAYLOAD_FIELDS.contains(&field.as_str()) {
            bail!("{kind:?} ledger payload field {field} is not allowed by strict terminal task schema");
        }
    }
    if !TERMINAL_TASK_KNOWN_PAYLOAD_FIELDS
        .iter()
        .any(|field| object.contains_key(*field))
    {
        bail!("{kind:?} ledger payload must include at least one known bounded terminal evidence field");
    }

    validate_optional_payload_string_field(object, "status")?;
    validate_optional_payload_string_field(object, "reason")?;
    validate_optional_payload_object_field(object, "completion_evidence")?;
    validate_optional_payload_bool_field(object, "late_tool_response")?;
    validate_optional_payload_bool_field(object, "terminal_process_loss")?;
    validate_optional_payload_string_field(object, "terminal_race_candidate")?;
    validate_optional_payload_string_field(object, "verification_completion_gate_status")?;
    validate_optional_payload_string_field(object, "verification_recovery_repair_gate_status")?;
    validate_optional_payload_u64_field(object, "required_verifier_count")?;
    validate_optional_payload_u64_field(object, "passed_verifier_count")?;
    validate_optional_payload_u64_field(object, "failed_verifier_count")?;
    validate_optional_payload_string_array_field(object, "required_verifier_tool_ids")?;
    validate_optional_payload_string_array_field(object, "passed_verifier_tool_ids")?;
    validate_optional_payload_string_array_field(object, "failed_verifier_tool_ids")?;
    validate_optional_payload_string_array_field(object, "missing_verifier_tool_ids")?;
    validate_optional_payload_string_array_field(object, "failure_reasons")?;
    validate_optional_payload_string_field(object, "next_action")?;
    validate_optional_payload_array_field(object, "bounded_cargo_diagnostics")?;
    validate_optional_payload_string_field(object, "verification_requirement_id")?;
    validate_optional_payload_string_field(object, "verification_requirement_source_kind")?;
    validate_optional_payload_string_field(object, "source_apply_id")?;
    validate_optional_payload_string_field(object, "verification_requirement_fingerprint")?;
    validate_optional_payload_string_field(object, "requirement_fingerprint")?;
    validate_optional_payload_bool_field(object, "verification_recovery_repair")?;
    validate_optional_payload_string_field(object, "source_task_id")?;
    validate_optional_payload_string_field(object, "source_run_id")?;
    validate_optional_payload_string_field(object, "recovery_task_id")?;
    validate_optional_payload_string_field(object, "recovery_run_id")?;
    validate_optional_payload_string_field(object, "failure_fingerprint")?;
    validate_optional_payload_u64_field(object, "proposal_count")?;
    validate_optional_payload_bool_field(object, "apply_enabled")?;
    validate_optional_payload_string_field(object, "proposal_id")?;
    validate_optional_payload_string_field(object, "failure_reason")?;
    validate_optional_payload_string_field(object, "cancel_status")?;
    validate_optional_payload_string_field(object, "cancel_id")?;
    validate_optional_payload_string_field(object, "cancel_fingerprint")?;
    validate_optional_payload_string_field(object, "request_fingerprint_version")?;
    validate_optional_payload_string_field(object, "task_id")?;
    validate_optional_payload_string_field(object, "run_id")?;
    validate_optional_payload_string_field(object, "previous_status")?;
    validate_optional_payload_string_field(object, "expected_task_updated_at")?;
    validate_optional_payload_bool_field(object, "caller_authorized")?;
    validate_optional_payload_bool_field(object, "terminal_evidence")?;
    validate_optional_payload_object_field(object, "mcp")?;
    validate_optional_payload_object_field(object, "git")?;
    validate_optional_payload_object_field(object, "runtime_deadline")?;

    if let Some(status) = object.get("status").and_then(serde_json::Value::as_str) {
        let expected = match kind {
            LedgerEventKind::TaskCompleted => "Completed",
            LedgerEventKind::TaskFailed => "Failed",
            LedgerEventKind::TaskCancelled => "Cancelled",
            _ => unreachable!("terminal task payload validator only accepts terminal task events"),
        };
        if status != expected {
            bail!("{kind:?} ledger payload status must be {expected}");
        }
    }
    if let Some(cancel_status) = object
        .get("cancel_status")
        .and_then(serde_json::Value::as_str)
    {
        if *kind != LedgerEventKind::TaskCancelled || cancel_status != "Cancelled" {
            bail!("{kind:?} ledger payload cancel_status is only valid for TaskCancelled");
        }
    }
    Ok(())
}

fn validate_permission_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = payload
        .as_object()
        .with_context(|| format!("{kind:?} ledger payload must be a JSON object"))?;
    for field in object.keys() {
        if !PERMISSION_KNOWN_PAYLOAD_FIELDS.contains(&field.as_str()) {
            bail!(
                "{kind:?} ledger payload field {field} is not allowed by strict permission schema"
            );
        }
    }
    for field in ["mode_id", "allowed", "reason"] {
        if !object.contains_key(field) {
            bail!("{kind:?} ledger payload must include {field}");
        }
    }
    if !object.contains_key("action") && !object.contains_key("required_action") {
        bail!("{kind:?} ledger payload must include action or required_action");
    }

    validate_required_payload_string_field(object, "mode_id")?;
    validate_required_payload_bool_field(object, "allowed")?;
    validate_required_payload_string_field(object, "reason")?;
    validate_optional_payload_string_field(object, "action")?;
    validate_optional_payload_string_field(object, "scope")?;
    validate_optional_payload_string_field(object, "tool_id")?;
    validate_optional_payload_string_field(object, "apply_id")?;
    validate_optional_payload_string_field(object, "proposal_id")?;
    validate_optional_payload_string_field(object, "path")?;
    validate_optional_payload_string_field(object, "operation")?;
    validate_optional_payload_string_field(object, "required_action")?;
    validate_optional_payload_u64_field(object, "workspace_write_scope_count")?;
    Ok(())
}

const PERMISSION_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "action",
    "allowed",
    "apply_id",
    "mode_id",
    "operation",
    "path",
    "proposal_id",
    "reason",
    "required_action",
    "scope",
    "tool_id",
    "workspace_write_scope_count",
];

fn validate_tool_plan_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(kind, payload, TOOL_PLAN_KNOWN_PAYLOAD_FIELDS)?;
    for field in ["tool_id", "required_action", "allowed", "reason"] {
        if !object.contains_key(field) {
            bail!("{kind:?} ledger payload must include {field}");
        }
    }
    validate_required_payload_string_field(object, "tool_id")?;
    validate_required_payload_string_field(object, "required_action")?;
    validate_required_payload_bool_field(object, "allowed")?;
    validate_required_payload_string_field(object, "reason")?;
    Ok(())
}

fn validate_tool_planned_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(kind, payload, TOOL_PLANNED_KNOWN_PAYLOAD_FIELDS)?;
    validate_required_payload_string_array_field(object, "tool_ids")?;
    Ok(())
}

fn validate_tool_intent_parsed_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object =
        validate_known_payload_object(kind, payload, TOOL_INTENT_PARSED_KNOWN_PAYLOAD_FIELDS)?;
    validate_required_payload_string_array_field(object, "tool_ids")?;
    validate_required_payload_object_field(object, "parser")?;
    Ok(())
}

fn validate_tool_intent_rejected_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object =
        validate_known_payload_object(kind, payload, TOOL_INTENT_REJECTED_KNOWN_PAYLOAD_FIELDS)?;
    validate_required_payload_string_field(object, "tool_id")?;
    validate_required_payload_string_field(object, "reason")?;
    validate_required_payload_string_field(object, "code")?;
    Ok(())
}

struct StrictPayloadShape<'a> {
    known_fields: &'a [&'a str],
    required_strings: &'a [&'a str],
    required_u64s: &'a [&'a str],
    required_bools: &'a [&'a str],
    required_string_arrays: &'a [&'a str],
    required_objects: &'a [&'a str],
    optional_strings: &'a [&'a str],
    optional_u64s: &'a [&'a str],
    optional_bools: &'a [&'a str],
    optional_string_arrays: &'a [&'a str],
    optional_objects: &'a [&'a str],
}

fn validate_subtask_dispatch_payload_shape(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
    shape: StrictPayloadShape<'_>,
) -> Result<()> {
    let object = validate_known_payload_object(kind, payload, shape.known_fields)?;
    for field in shape.required_strings {
        validate_required_payload_string_field(object, field)?;
    }
    for field in shape.required_u64s {
        validate_required_payload_u64_field(object, field)?;
    }
    for field in shape.required_bools {
        validate_required_payload_bool_field(object, field)?;
    }
    for field in shape.required_string_arrays {
        validate_required_payload_string_array_field(object, field)?;
    }
    for field in shape.required_objects {
        validate_required_payload_object_field(object, field)?;
    }
    for field in shape.optional_strings {
        validate_optional_payload_string_field(object, field)?;
    }
    for field in shape.optional_u64s {
        validate_optional_payload_u64_field(object, field)?;
    }
    for field in shape.optional_bools {
        validate_optional_payload_bool_field(object, field)?;
    }
    for field in shape.optional_string_arrays {
        validate_optional_payload_string_array_field(object, field)?;
    }
    for field in shape.optional_objects {
        validate_optional_payload_object_field(object, field)?;
    }
    Ok(())
}

fn validate_subtask_orchestration_queued_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    validate_subtask_dispatch_payload_shape(
        kind,
        payload,
        StrictPayloadShape {
            known_fields: SUBTASK_ORCHESTRATION_QUEUED_KNOWN_PAYLOAD_FIELDS,
            required_strings: &[
                "subtask_id",
                "parent_task_id",
                "parent_run_id",
                "tool_id",
                "required_action",
                "status",
                "request_reason",
                "reason",
            ],
            required_u64s: &["queue_position"],
            required_bools: &["execution_enabled"],
            required_string_arrays: &[],
            required_objects: &["input_summary"],
            optional_strings: &["requested_goal_preview", "requested_mode_id"],
            optional_u64s: &[],
            optional_bools: &[],
            optional_string_arrays: &[],
            optional_objects: &[],
        },
    )
}

fn validate_subtask_handoff_prepared_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    validate_subtask_dispatch_payload_shape(
        kind,
        payload,
        StrictPayloadShape {
            known_fields: SUBTASK_HANDOFF_PREPARED_KNOWN_PAYLOAD_FIELDS,
            required_strings: &[
                "handoff_id",
                "parent_task_id",
                "parent_run_id",
                "status",
                "next_action",
                "reason",
            ],
            required_u64s: &["queued_count", "source_event_count"],
            required_bools: &["execution_enabled"],
            required_string_arrays: &["queued_subtask_ids"],
            required_objects: &[],
            optional_strings: &[],
            optional_u64s: &[],
            optional_bools: &[],
            optional_string_arrays: &[],
            optional_objects: &[],
        },
    )
}

fn validate_subtask_scheduler_readiness_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    validate_subtask_dispatch_payload_shape(
        kind,
        payload,
        StrictPayloadShape {
            known_fields: SUBTASK_SCHEDULER_READINESS_KNOWN_PAYLOAD_FIELDS,
            required_strings: &[
                "readiness_id",
                "parent_task_id",
                "parent_run_id",
                "handoff_id",
                "status",
                "readiness_status",
                "readiness_reason",
                "next_action",
                "reason",
            ],
            required_u64s: &[
                "handoff_count",
                "queued_count",
                "source_event_count",
                "check_count",
            ],
            required_bools: &["execution_enabled", "dispatch_enabled"],
            required_string_arrays: &["blocked_checks"],
            required_objects: &[],
            optional_strings: &[],
            optional_u64s: &[],
            optional_bools: &[],
            optional_string_arrays: &[],
            optional_objects: &[],
        },
    )
}

fn validate_subtask_dispatch_plan_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    validate_subtask_dispatch_payload_shape(
        kind,
        payload,
        StrictPayloadShape {
            known_fields: SUBTASK_DISPATCH_PLAN_KNOWN_PAYLOAD_FIELDS,
            required_strings: &[
                "plan_id",
                "parent_task_id",
                "parent_run_id",
                "readiness_id",
                "status",
                "dispatch_plan_status",
                "dispatch_reason",
                "required_capability",
                "next_action",
                "reason",
            ],
            required_u64s: &[
                "readiness_count",
                "queued_count",
                "source_event_count",
                "check_count",
            ],
            required_bools: &["execution_enabled", "dispatch_enabled"],
            required_string_arrays: &["blocked_checks"],
            required_objects: &[],
            optional_strings: &[],
            optional_u64s: &[],
            optional_bools: &[],
            optional_string_arrays: &[],
            optional_objects: &[],
        },
    )
}

fn validate_subtask_dispatch_contract_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    validate_subtask_dispatch_payload_shape(
        kind,
        payload,
        StrictPayloadShape {
            known_fields: SUBTASK_DISPATCH_CONTRACT_KNOWN_PAYLOAD_FIELDS,
            required_strings: &[
                "contract_id",
                "parent_task_id",
                "parent_run_id",
                "plan_id",
                "status",
                "dispatch_contract_status",
                "eligibility_status",
                "dispatch_contract_reason",
                "required_capability",
                "next_action",
                "reason",
            ],
            required_u64s: &[
                "plan_count",
                "queued_count",
                "source_event_count",
                "check_count",
            ],
            required_bools: &["execution_enabled", "dispatch_enabled"],
            required_string_arrays: &["required_preconditions", "blocked_checks"],
            required_objects: &[],
            optional_strings: &[],
            optional_u64s: &[],
            optional_bools: &[],
            optional_string_arrays: &[],
            optional_objects: &[],
        },
    )
}

fn validate_subtask_dispatch_admission_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    validate_subtask_dispatch_payload_shape(
        kind,
        payload,
        StrictPayloadShape {
            known_fields: SUBTASK_DISPATCH_ADMISSION_KNOWN_PAYLOAD_FIELDS,
            required_strings: &[
                "admission_id",
                "parent_task_id",
                "parent_run_id",
                "contract_id",
                "status",
                "admission_status",
                "execution_gate_status",
                "admission_reason",
                "required_capability",
                "next_action",
                "reason",
            ],
            required_u64s: &[
                "contract_count",
                "queued_count",
                "source_event_count",
                "precondition_count",
                "satisfied_precondition_count",
                "check_count",
            ],
            required_bools: &["execution_enabled", "dispatch_enabled"],
            required_string_arrays: &["blocked_preconditions", "blocked_checks"],
            required_objects: &[],
            optional_strings: &[],
            optional_u64s: &[],
            optional_bools: &[],
            optional_string_arrays: &[],
            optional_objects: &[],
        },
    )
}

fn validate_subtask_dispatch_readiness_snapshot_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    validate_subtask_dispatch_payload_shape(
        kind,
        payload,
        StrictPayloadShape {
            known_fields: SUBTASK_DISPATCH_READINESS_SNAPSHOT_KNOWN_PAYLOAD_FIELDS,
            required_strings: &[
                "snapshot_id",
                "parent_task_id",
                "parent_run_id",
                "admission_id",
                "status",
                "readiness_status",
                "scheduler_handoff_status",
                "readiness_reason",
                "required_capability",
                "readiness_fingerprint",
                "next_action",
                "reason",
            ],
            required_u64s: &[
                "admission_count",
                "queued_count",
                "source_event_count",
                "precondition_count",
                "satisfied_precondition_count",
                "check_count",
                "fingerprint_input_count",
            ],
            required_bools: &["execution_enabled", "dispatch_enabled"],
            required_string_arrays: &["blocked_preconditions", "blocked_checks"],
            required_objects: &[],
            optional_strings: &[],
            optional_u64s: &[],
            optional_bools: &[],
            optional_string_arrays: &[],
            optional_objects: &[],
        },
    )
}

fn validate_subtask_dispatcher_guard_verdict_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    validate_subtask_dispatch_payload_shape(
        kind,
        payload,
        StrictPayloadShape {
            known_fields: SUBTASK_DISPATCHER_GUARD_VERDICT_KNOWN_PAYLOAD_FIELDS,
            required_strings: &[
                "guard_id",
                "parent_task_id",
                "parent_run_id",
                "snapshot_id",
                "status",
                "guard_status",
                "scheduler_handoff_status",
                "handoff_preflight_status",
                "snapshot_validity_status",
                "snapshot_fingerprint",
                "guard_reason",
                "required_capability",
                "next_action",
                "reason",
            ],
            required_u64s: &[
                "snapshot_count",
                "queued_count",
                "source_event_count",
                "snapshot_fingerprint_count",
                "fingerprint_input_count",
                "precondition_count",
                "satisfied_precondition_count",
                "check_count",
            ],
            required_bools: &["execution_enabled", "dispatch_enabled"],
            required_string_arrays: &["blocked_preconditions", "blocked_checks"],
            required_objects: &[],
            optional_strings: &[],
            optional_u64s: &[],
            optional_bools: &[],
            optional_string_arrays: &[],
            optional_objects: &[],
        },
    )
}

fn validate_subtask_dispatch_decision_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    validate_subtask_dispatch_payload_shape(
        kind,
        payload,
        StrictPayloadShape {
            known_fields: SUBTASK_DISPATCH_DECISION_KNOWN_PAYLOAD_FIELDS,
            required_strings: &[
                "decision_id",
                "parent_task_id",
                "parent_run_id",
                "guard_id",
                "snapshot_id",
                "status",
                "decision_status",
                "candidate_status",
                "dispatch_decision",
                "dispatch_denial_reason",
                "handoff_preflight_status",
                "guard_status",
                "snapshot_validity_status",
                "snapshot_fingerprint",
                "required_capability",
                "next_action",
                "reason",
            ],
            required_u64s: &[
                "guard_count",
                "queued_count",
                "source_event_count",
                "snapshot_fingerprint_count",
                "fingerprint_input_count",
                "dispatch_candidate_count",
                "eligible_candidate_count",
                "blocked_candidate_count",
                "precondition_count",
                "satisfied_precondition_count",
                "check_count",
            ],
            required_bools: &["execution_enabled", "dispatch_enabled"],
            required_string_arrays: &["blocked_preconditions", "blocked_checks"],
            required_objects: &[],
            optional_strings: &[],
            optional_u64s: &[],
            optional_bools: &[],
            optional_string_arrays: &[],
            optional_objects: &[],
        },
    )
}

fn validate_subtask_dispatch_candidate_manifest_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    validate_subtask_dispatch_payload_shape(
        kind,
        payload,
        StrictPayloadShape {
            known_fields: SUBTASK_DISPATCH_CANDIDATE_MANIFEST_KNOWN_PAYLOAD_FIELDS,
            required_strings: &[
                "manifest_id",
                "parent_task_id",
                "parent_run_id",
                "decision_id",
                "guard_id",
                "snapshot_id",
                "status",
                "manifest_status",
                "candidate_status",
                "dispatch_decision",
                "candidate_denial_reason",
                "candidate_manifest_fingerprint",
                "snapshot_fingerprint",
                "required_capability",
                "next_action",
                "reason",
            ],
            required_u64s: &[
                "decision_count",
                "queued_count",
                "source_event_count",
                "candidate_count",
                "dispatch_candidate_count",
                "eligible_candidate_count",
                "blocked_candidate_count",
                "fingerprint_input_count",
                "precondition_count",
                "satisfied_precondition_count",
                "check_count",
            ],
            required_bools: &["execution_enabled", "dispatch_enabled"],
            required_string_arrays: &[
                "candidate_ids",
                "eligible_candidate_ids",
                "blocked_candidate_ids",
                "blocked_preconditions",
                "blocked_checks",
            ],
            required_objects: &[],
            optional_strings: &[],
            optional_u64s: &[],
            optional_bools: &[],
            optional_string_arrays: &[],
            optional_objects: &[],
        },
    )
}

fn validate_subtask_dispatch_handoff_envelope_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    validate_subtask_dispatch_payload_shape(
        kind,
        payload,
        StrictPayloadShape {
            known_fields: SUBTASK_DISPATCH_HANDOFF_ENVELOPE_KNOWN_PAYLOAD_FIELDS,
            required_strings: &[
                "handoff_envelope_id",
                "parent_task_id",
                "parent_run_id",
                "status",
                "handoff_envelope_status",
                "scheduler_handoff_status",
                "candidate_status",
                "dispatch_decision",
                "handoff_envelope_fingerprint",
                "required_capability",
                "next_action",
                "reason",
            ],
            required_u64s: &[
                "candidate_count",
                "eligible_candidate_count",
                "blocked_candidate_count",
                "fingerprint_input_count",
            ],
            required_bools: &["execution_enabled", "dispatch_enabled"],
            required_string_arrays: &[
                "candidate_ids",
                "eligible_candidate_ids",
                "blocked_candidate_ids",
            ],
            required_objects: &[],
            optional_strings: &[
                "manifest_id",
                "decision_id",
                "handoff_ticket_status",
                "replay_guard_status",
                "candidate_denial_reason",
                "replay_guard_reason",
                "candidate_manifest_fingerprint",
                "parent_join_admission_id",
                "parent_join_child_completion_fingerprint",
                "recovery_cycle_budget_status",
                "continuation_source",
            ],
            optional_u64s: &[
                "manifest_count",
                "queued_count",
                "source_event_count",
                "dispatch_candidate_count",
                "handoff_ticket_count",
                "precondition_count",
                "satisfied_precondition_count",
                "check_count",
                "parent_join_child_completion_child_count",
                "parent_join_terminal_completed_child_count",
                "parent_join_terminal_failed_child_count",
                "parent_join_fingerprint_input_count",
                "parent_join_recovery_cycle_depth",
                "max_recovery_cycle_depth",
            ],
            optional_bools: &["continuation_materialization", "parent_join_recovery_cycle"],
            optional_string_arrays: &["blocked_preconditions", "blocked_checks"],
            optional_objects: &[],
        },
    )
}

fn validate_parent_join_continuation_consumed_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    validate_subtask_dispatch_payload_shape(
        kind,
        payload,
        StrictPayloadShape {
            known_fields: PARENT_JOIN_CONTINUATION_CONSUMED_KNOWN_PAYLOAD_FIELDS,
            required_strings: &[
                "parent_join_continuation_status",
                "admission_id",
                "child_completion_fingerprint",
                "reason",
            ],
            required_u64s: &[
                "child_completion_child_count",
                "child_terminal_completed_count",
                "child_terminal_failed_count",
                "child_recovery_cycle_depth",
                "fingerprint_input_count",
            ],
            required_bools: &[],
            required_string_arrays: &[],
            required_objects: &[],
            optional_strings: &[],
            optional_u64s: &[],
            optional_bools: &[],
            optional_string_arrays: &[],
            optional_objects: &[],
        },
    )
}

fn validate_workspace_patch_proposed_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(
        kind,
        payload,
        WORKSPACE_PATCH_PROPOSED_KNOWN_PAYLOAD_FIELDS,
    )?;
    for field in [
        "proposal_id",
        "tool_id",
        "path",
        "operation",
        "content_preview",
        "validation_status",
    ] {
        validate_required_payload_string_field(object, field)?;
    }
    validate_required_payload_u64_field(object, "content_chars")?;
    for field in ["truncated", "diff_truncated", "diff_redacted"] {
        validate_required_payload_bool_field(object, field)?;
    }
    validate_required_payload_string_or_null_field(object, "validation_reason")?;
    validate_required_payload_string_or_null_field(object, "diff_preview")?;
    for field in [
        "hunk_fingerprint",
        "source_task_id",
        "source_run_id",
        "recovery_task_id",
        "recovery_run_id",
        "failure_fingerprint",
        "source_proposal_id",
        "source_apply_id",
        "source_apply_fingerprint",
        "failure_class",
        "source_operation",
        "source_path",
        "source_hunk_fingerprint",
    ] {
        validate_optional_payload_string_field(object, field)?;
    }
    for field in ["hunk_count", "source_hunk_count"] {
        validate_optional_payload_u64_field(object, field)?;
    }
    for field in [
        "verification_recovery_repair",
        "patch_apply_recovery_repair",
    ] {
        validate_optional_payload_bool_field(object, field)?;
    }
    validate_optional_payload_string_array_field(object, "failed_verifier_tool_ids")?;
    Ok(())
}

fn validate_workspace_patch_approved_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(
        kind,
        payload,
        WORKSPACE_PATCH_APPROVAL_KNOWN_PAYLOAD_FIELDS,
    )?;
    validate_required_payload_string_field(object, "proposal_id")?;
    validate_required_payload_string_field(object, "approval_status")?;
    validate_required_payload_string_or_null_field(object, "approval_reason")?;
    validate_required_payload_bool_field(object, "approval_reason_redacted")?;
    validate_required_payload_string_field(object, "approved_at")?;
    validate_optional_payload_string_field(object, "rejected_at")?;
    if object
        .get("approval_status")
        .and_then(serde_json::Value::as_str)
        != Some("Approved")
    {
        bail!("{kind:?} ledger payload approval_status must be Approved");
    }
    Ok(())
}

fn validate_workspace_patch_rejected_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(
        kind,
        payload,
        WORKSPACE_PATCH_APPROVAL_KNOWN_PAYLOAD_FIELDS,
    )?;
    validate_required_payload_string_field(object, "proposal_id")?;
    validate_required_payload_string_field(object, "approval_status")?;
    validate_required_payload_string_or_null_field(object, "approval_reason")?;
    validate_required_payload_bool_field(object, "approval_reason_redacted")?;
    validate_required_payload_string_field(object, "rejected_at")?;
    validate_optional_payload_string_field(object, "approved_at")?;
    if object
        .get("approval_status")
        .and_then(serde_json::Value::as_str)
        != Some("Rejected")
    {
        bail!("{kind:?} ledger payload approval_status must be Rejected");
    }
    Ok(())
}

fn validate_workspace_patch_preflight_snapshot_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(
        kind,
        payload,
        WORKSPACE_PATCH_PREFLIGHT_SNAPSHOT_KNOWN_PAYLOAD_FIELDS,
    )?;
    for field in [
        "proposal_id",
        "snapshot_id",
        "path",
        "canonical_path_hash",
        "file_kind",
        "captured_at",
    ] {
        validate_required_payload_string_field(object, field)?;
    }
    validate_required_payload_bool_field(object, "file_exists")?;
    validate_required_payload_bool_field(object, "stale")?;
    validate_required_payload_u64_or_null_field(object, "file_size_bytes")?;
    validate_required_payload_i64_or_null_field(object, "file_modified_unix_ms")?;
    validate_required_payload_string_or_null_field(object, "file_sha256")?;
    validate_required_payload_string_or_null_field(object, "stale_reason")?;
    Ok(())
}

fn validate_workspace_patch_apply_plan_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(
        kind,
        payload,
        WORKSPACE_PATCH_APPLY_PLAN_KNOWN_PAYLOAD_FIELDS,
    )?;
    for field in ["proposal_id", "plan_id", "operation", "status"] {
        validate_required_payload_string_field(object, field)?;
    }
    validate_required_payload_u64_field(object, "check_count")?;
    validate_required_payload_string_array_field(object, "failed_checks")?;
    Ok(())
}

fn validate_workspace_patch_apply_capability_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(
        kind,
        payload,
        WORKSPACE_PATCH_APPLY_CAPABILITY_KNOWN_PAYLOAD_FIELDS,
    )?;
    for field in [
        "proposal_id",
        "capability_id",
        "mode",
        "reason",
        "checked_at",
    ] {
        validate_required_payload_string_field(object, field)?;
    }
    for field in ["apply_supported", "apply_enabled", "can_apply_now"] {
        validate_required_payload_bool_field(object, field)?;
    }
    validate_required_payload_u64_field(object, "check_count")?;
    for field in ["required_gates", "failed_checks", "blocked_checks"] {
        validate_required_payload_string_array_field(object, field)?;
    }
    Ok(())
}

fn validate_workspace_patch_apply_dry_run_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(
        kind,
        payload,
        WORKSPACE_PATCH_APPLY_DRY_RUN_KNOWN_PAYLOAD_FIELDS,
    )?;
    for field in [
        "proposal_id",
        "dry_run_id",
        "dry_run_status",
        "dry_run_reason",
        "checked_at",
    ] {
        validate_required_payload_string_field(object, field)?;
    }
    for field in [
        "no_patch_applied",
        "apply_executed",
        "workspace_files_changed",
    ] {
        validate_required_payload_bool_field(object, field)?;
    }
    validate_required_payload_u64_field(object, "check_count")?;
    for field in ["required_gates", "failed_checks", "blocked_checks"] {
        validate_required_payload_string_array_field(object, field)?;
    }
    Ok(())
}

fn validate_workspace_patch_apply_result_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(
        kind,
        payload,
        WORKSPACE_PATCH_APPLY_RESULT_KNOWN_PAYLOAD_FIELDS,
    )?;
    for field in [
        "proposal_id",
        "apply_id",
        "apply_status",
        "apply_reason",
        "operation",
        "path",
    ] {
        validate_required_payload_string_field(object, field)?;
    }
    for field in ["authorization_consumed", "applied"] {
        validate_required_payload_bool_field(object, field)?;
    }
    for field in ["failed_checks", "blocked_checks"] {
        validate_required_payload_string_array_field(object, field)?;
    }
    for field in [
        "authorization_id",
        "expected_target_sha256",
        "pre_write_target_sha256",
        "post_write_sha256",
        "checked_at",
        "applied_at",
        "transaction_id",
        "transaction_status",
        "transaction_recovery_status",
        "hunk_fingerprint",
    ] {
        validate_optional_payload_string_or_null_field(object, field)?;
    }
    for field in [
        "expected_target_absent",
        "pre_write_target_exists",
        "post_delete_target_exists",
        "atomic_replacement_completed",
        "atomic_create_completed",
        "atomic_delete_completed",
        "temp_file_cleaned",
    ] {
        validate_optional_payload_bool_or_null_field(object, field)?;
    }
    for field in [
        "content_chars",
        "content_bytes",
        "check_count",
        "transaction_item_count",
        "hunk_count",
    ] {
        validate_optional_payload_u64_field(object, field)?;
    }
    validate_optional_payload_array_field(object, "transaction_items")?;
    validate_optional_payload_object_field(object, "transaction_recovery_source")?;
    Ok(())
}

fn validate_workspace_patch_readiness_report_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(
        kind,
        payload,
        WORKSPACE_PATCH_READINESS_REPORT_KNOWN_PAYLOAD_FIELDS,
    )?;
    for field in [
        "proposal_id",
        "report_id",
        "readiness_status",
        "readiness_fingerprint",
        "generated_at",
    ] {
        validate_required_payload_string_field(object, field)?;
    }
    validate_required_payload_string_or_null_field(object, "readiness_reason")?;
    for field in ["fingerprint_input_count", "check_count"] {
        validate_required_payload_u64_field(object, field)?;
    }
    for field in ["failed_checks", "blocked_checks"] {
        validate_required_payload_string_array_field(object, field)?;
    }
    Ok(())
}

fn validate_tool_intent_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(kind, payload, TOOL_INTENT_KNOWN_PAYLOAD_FIELDS)?;
    for field in [
        "tool_id",
        "required_action",
        "allowed",
        "reason",
        "request_reason",
        "input_summary",
    ] {
        if !object.contains_key(field) {
            bail!("{kind:?} ledger payload must include {field}");
        }
    }
    validate_required_payload_string_field(object, "tool_id")?;
    validate_required_payload_string_field(object, "required_action")?;
    validate_required_payload_bool_field(object, "allowed")?;
    validate_required_payload_string_field(object, "reason")?;
    validate_required_payload_string_field(object, "request_reason")?;
    validate_required_payload_object_field(object, "input_summary")?;
    validate_optional_payload_string_field(object, "mode_id")?;
    validate_optional_payload_string_field(object, "requested_mode_id")?;
    validate_optional_payload_string_field(object, "source_apply_id")?;
    validate_optional_payload_string_field(object, "source_run_id")?;
    validate_optional_payload_string_field(object, "source_task_id")?;
    validate_optional_payload_string_field(object, "verification_requirement_fingerprint")?;
    validate_optional_payload_string_field(object, "verification_requirement_id")?;
    validate_optional_payload_string_field(object, "verification_requirement_source_kind")?;
    validate_optional_payload_bool_field(object, "verification_recovery_retry")?;
    Ok(())
}

fn validate_tool_execution_requested_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(
        kind,
        payload,
        TOOL_EXECUTION_REQUESTED_KNOWN_PAYLOAD_FIELDS,
    )?;
    for field in ["tool_id", "input_summary"] {
        if !object.contains_key(field) {
            bail!("{kind:?} ledger payload must include {field}");
        }
    }
    validate_required_payload_string_field(object, "tool_id")?;
    validate_required_payload_object_field(object, "input_summary")?;
    validate_optional_payload_string_field(object, "request_fingerprint")?;
    validate_optional_payload_string_field(object, "source_apply_id")?;
    validate_optional_payload_string_field(object, "verification_requirement_fingerprint")?;
    validate_optional_payload_string_field(object, "verification_requirement_id")?;
    validate_optional_payload_string_field(object, "verification_requirement_source_kind")?;
    validate_optional_payload_bool_field(object, "verification_recovery_retry")?;
    Ok(())
}

fn validate_tool_execution_permission_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(
        kind,
        payload,
        TOOL_EXECUTION_PERMISSION_KNOWN_PAYLOAD_FIELDS,
    )?;
    for field in ["tool_id", "required_action", "allowed", "reason"] {
        if !object.contains_key(field) {
            bail!("{kind:?} ledger payload must include {field}");
        }
    }
    validate_required_payload_string_field(object, "tool_id")?;
    validate_required_payload_string_field(object, "required_action")?;
    validate_required_payload_bool_field(object, "allowed")?;
    validate_required_payload_string_field(object, "reason")?;
    validate_optional_payload_string_field(object, "server_id")?;
    validate_optional_payload_string_field(object, "tool_name")?;
    validate_optional_payload_string_field(object, "request_fingerprint")?;
    validate_optional_payload_object_or_null_field(object, "mcp_safety_policy")?;
    validate_optional_payload_string_field(object, "source_apply_id")?;
    validate_optional_payload_string_field(object, "verification_requirement_fingerprint")?;
    validate_optional_payload_string_field(object, "verification_requirement_id")?;
    validate_optional_payload_string_field(object, "verification_requirement_source_kind")?;
    validate_optional_payload_bool_field(object, "verification_recovery_retry")?;
    Ok(())
}

fn validate_tool_execution_terminal_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
    expected_status: &str,
) -> Result<()> {
    let object =
        validate_known_payload_object(kind, payload, TOOL_EXECUTION_TERMINAL_KNOWN_PAYLOAD_FIELDS)?;
    for field in ["tool_id", "status"] {
        if !object.contains_key(field) {
            bail!("{kind:?} ledger payload must include {field}");
        }
    }
    if matches!(
        kind,
        LedgerEventKind::ToolExecutionDenied | LedgerEventKind::ToolExecutionFailed
    ) && !object.contains_key("reason")
    {
        bail!("{kind:?} ledger payload must include reason");
    }
    validate_required_payload_string_field(object, "tool_id")?;
    validate_required_payload_string_field(object, "status")?;
    validate_optional_payload_string_field(object, "reason")?;
    if object.get("status").and_then(serde_json::Value::as_str) != Some(expected_status) {
        bail!("{kind:?} ledger payload status must be {expected_status}");
    }
    validate_optional_payload_string_field(object, "output_preview")?;
    validate_optional_payload_u64_field(object, "bytes_read")?;
    validate_optional_payload_bool_field(object, "truncated")?;
    validate_optional_payload_string_field(object, "check_id")?;
    validate_optional_payload_string_field(object, "verification_status")?;
    validate_optional_payload_bool_field(object, "process_launched")?;
    validate_optional_payload_i64_or_null_field(object, "exit_code")?;
    validate_optional_payload_bool_field(object, "timed_out")?;
    validate_optional_payload_u64_field(object, "duration_ms")?;
    validate_optional_payload_u64_field(object, "standard_output_bytes")?;
    validate_optional_payload_u64_field(object, "standard_error_bytes")?;
    validate_optional_payload_bool_field(object, "standard_output_truncated")?;
    validate_optional_payload_bool_field(object, "standard_error_truncated")?;
    validate_optional_payload_bool_field(object, "output_redacted")?;
    validate_optional_payload_bool_field(object, "target_dir_isolated")?;
    validate_optional_payload_bool_field(object, "cleanup_succeeded")?;
    validate_optional_payload_bool_field(object, "cargo_dependency_fetch_offline")?;
    validate_optional_payload_bool_field(object, "os_network_isolated")?;
    validate_optional_payload_bool_field(object, "compile_time_code_sandboxed")?;
    validate_optional_payload_bool_field(object, "test_code_executed")?;
    validate_optional_payload_bool_field(object, "trusted_workspace_required")?;
    validate_optional_payload_bool_field(object, "process_tree_timeout_supported")?;
    validate_optional_payload_bool_field(object, "process_tree_kill_attempted")?;
    validate_optional_payload_bool_field(object, "process_tree_kill_succeeded")?;
    validate_optional_payload_string_field(object, "process_tree_kill_reason")?;
    validate_optional_payload_string_field(object, "operation")?;
    validate_optional_payload_u64_field(object, "line_count")?;
    validate_optional_payload_u64_field(object, "captured_bytes")?;
    validate_optional_payload_bool_field(object, "output_truncated")?;
    validate_optional_payload_bool_field(object, "output_oversized")?;
    validate_optional_payload_bool_field(object, "reader_thread_joined")?;
    validate_optional_payload_bool_field(object, "git_environment_hardened")?;
    validate_optional_payload_bool_field(object, "git_prompts_disabled")?;
    validate_optional_payload_bool_field(object, "git_optional_locks_disabled")?;
    validate_optional_payload_bool_field(object, "raw_diff_redacted")?;
    validate_optional_payload_bool_field(object, "raw_file_content_redacted")?;
    validate_optional_payload_bool_field(object, "absolute_paths_redacted")?;
    validate_optional_payload_bool_field(object, "raw_message_redacted")?;
    validate_optional_payload_string_field(object, "message_fingerprint")?;
    validate_optional_payload_string_field(object, "expected_parent_head")?;
    validate_optional_payload_string_field(object, "authorized_change_set_fingerprint")?;
    validate_optional_payload_string_field(object, "workspace_write_scope_fingerprint")?;
    validate_optional_payload_string_field(object, "logical_invocation_fingerprint")?;
    validate_optional_payload_u64_field(object, "authorized_path_count")?;
    validate_optional_payload_string_field(object, "committed_tree_fingerprint")?;
    validate_optional_payload_string_field(object, "commit_id")?;
    validate_optional_payload_bool_field(object, "replayed")?;
    validate_optional_payload_bool_field(object, "mutation_process_launched")?;
    validate_optional_payload_u64_field(object, "git_process_count")?;
    validate_optional_payload_bool_field(object, "git_processes_bounded")?;
    validate_optional_payload_bool_field(object, "ambient_index_ignored")?;
    validate_optional_payload_bool_field(object, "used_temporary_index")?;
    validate_optional_payload_bool_field(object, "temporary_index_cleaned")?;
    validate_optional_payload_bool_field(object, "used_git_plumbing")?;
    validate_optional_payload_bool_field(object, "repository_hooks_bypassed")?;
    validate_optional_payload_bool_field(object, "runtime_authorization_required")?;
    validate_optional_payload_string_field(object, "failed_git_operation")?;
    validate_optional_payload_array_field(object, "bounded_cargo_diagnostics")?;
    validate_optional_payload_object_field(object, "git")?;
    validate_optional_payload_object_field(object, "mcp")?;
    validate_optional_payload_object_field(object, "catalog_provenance")?;
    validate_optional_payload_object_or_null_field(object, "mcp_safety_policy")?;
    validate_optional_payload_object_field(object, "mcp_approval_binding")?;
    validate_optional_payload_string_field(object, "source_apply_id")?;
    validate_optional_payload_string_field(object, "verification_requirement_fingerprint")?;
    validate_optional_payload_string_field(object, "verification_requirement_id")?;
    validate_optional_payload_string_field(object, "verification_requirement_source_kind")?;
    validate_optional_payload_bool_field(object, "verification_recovery_retry")?;
    Ok(())
}

fn validate_mcp_tool_execution_approved_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(
        kind,
        payload,
        MCP_TOOL_EXECUTION_APPROVED_KNOWN_PAYLOAD_FIELDS,
    )?;
    for field in [
        "approval_schema_version",
        "task_id",
        "run_id",
        "tool_id",
        "server_id",
        "tool_name",
        "request_fingerprint",
        "catalog_provenance",
        "mcp_safety_policy",
        "approval_fingerprint",
        "status",
        "approval_state_fingerprint",
    ] {
        if !object.contains_key(field) {
            bail!("{kind:?} ledger payload must include {field}");
        }
    }
    validate_required_payload_u64_field(object, "approval_schema_version")?;
    validate_required_payload_string_field(object, "task_id")?;
    validate_required_payload_string_field(object, "run_id")?;
    validate_required_payload_string_field(object, "tool_id")?;
    validate_required_payload_string_field(object, "server_id")?;
    validate_required_payload_string_field(object, "tool_name")?;
    validate_required_payload_string_field(object, "request_fingerprint")?;
    validate_required_payload_object_field(object, "catalog_provenance")?;
    validate_optional_payload_object_or_null_field(object, "mcp_safety_policy")?;
    validate_required_payload_string_field(object, "approval_fingerprint")?;
    validate_required_payload_string_field(object, "status")?;
    validate_required_payload_string_field(object, "approval_state_fingerprint")?;
    validate_optional_payload_string_field(object, "approval_id_fingerprint")?;
    validate_optional_payload_string_field(object, "outcome")?;
    validate_optional_payload_string_field(object, "outcome_fingerprint")?;
    validate_optional_payload_string_field(object, "recovery_fingerprint")?;
    validate_optional_payload_string_field(object, "recovery_reason")?;
    validate_optional_payload_string_field(object, "recovery_source_state_fingerprint")?;
    if let Some(status) = object.get("status").and_then(serde_json::Value::as_str) {
        let accepted = [
            "requested",
            "approved",
            "executing",
            "consumed",
            "rejected",
            "expired",
            "invalidated",
            "outcome_unknown",
        ];
        if !accepted.contains(&status) {
            bail!("{kind:?} ledger payload status is not a known MCP approval state");
        }
    }
    Ok(())
}

fn validate_codebase_index_permission_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(
        kind,
        payload,
        CODEBASE_INDEX_PERMISSION_KNOWN_PAYLOAD_FIELDS,
    )?;
    for field in ["mode_id", "action", "allowed", "reason"] {
        if !object.contains_key(field) {
            bail!("{kind:?} ledger payload must include {field}");
        }
    }
    validate_required_payload_string_field(object, "mode_id")?;
    validate_required_payload_string_field(object, "action")?;
    validate_required_payload_bool_field(object, "allowed")?;
    validate_required_payload_string_field(object, "reason")?;
    validate_optional_payload_bool_field(object, "requested_root_present")?;
    validate_optional_payload_bool_field(object, "requested_force_refresh")?;
    validate_optional_payload_string_field(object, "request_kind")?;
    validate_optional_payload_string_field(object, "query_fingerprint")?;
    validate_optional_payload_u64_field(object, "query_length_chars")?;
    validate_optional_payload_u64_field(object, "query_token_count")?;
    validate_optional_payload_u64_field(object, "max_results")?;
    validate_optional_payload_string_field(object, "file_kind_filter")?;
    validate_optional_payload_string_field(object, "query_id")?;
    validate_optional_payload_string_field(object, "selection_id")?;
    validate_optional_payload_string_field(object, "selection_fingerprint")?;
    validate_optional_payload_string_field(object, "index_id")?;
    validate_optional_payload_string_field(object, "workspace_fingerprint")?;
    validate_optional_payload_string_field(object, "snapshot_fingerprint")?;
    validate_optional_payload_u64_field(object, "entry_count")?;
    if object.get("action").and_then(serde_json::Value::as_str) != Some("IndexCodebase") {
        bail!("{kind:?} ledger payload action must be IndexCodebase");
    }
    if let Some(request_kind) = object
        .get("request_kind")
        .and_then(serde_json::Value::as_str)
    {
        if !matches!(request_kind, "query" | "selection_read") {
            bail!("{kind:?} ledger payload request_kind is not supported");
        }
    }
    Ok(())
}

fn validate_codebase_index_snapshot_built_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(
        kind,
        payload,
        CODEBASE_INDEX_SNAPSHOT_BUILT_KNOWN_PAYLOAD_FIELDS,
    )?;
    for field in [
        "index_id",
        "mode_id",
        "root",
        "workspace_fingerprint",
        "snapshot_fingerprint",
        "built_at",
        "indexed_files",
        "walked_directories",
        "skipped_protected",
        "skipped_ignored",
        "skipped_sensitive",
        "skipped_symlink",
        "skipped_too_large",
        "skipped_binary_like",
        "skipped_unreadable",
        "skipped_unsafe_path",
        "skipped_other",
        "truncated_entries",
        "visited_entries",
        "truncated_directories",
        "ignore_rule_files_loaded",
        "ignore_rule_count",
        "sensitive_finding_count",
        "truncated",
        "max_files",
        "max_directories",
        "max_path_chars",
        "max_file_bytes",
        "max_visited_entries",
        "max_directory_entries",
        "requested_force_refresh",
        "next_action",
    ] {
        if !object.contains_key(field) {
            bail!("{kind:?} ledger payload must include {field}");
        }
    }
    for field in [
        "index_id",
        "mode_id",
        "root",
        "workspace_fingerprint",
        "snapshot_fingerprint",
        "built_at",
        "next_action",
    ] {
        validate_required_payload_string_field(object, field)?;
    }
    for field in [
        "indexed_files",
        "walked_directories",
        "skipped_protected",
        "skipped_ignored",
        "skipped_sensitive",
        "skipped_symlink",
        "skipped_too_large",
        "skipped_binary_like",
        "skipped_unreadable",
        "skipped_unsafe_path",
        "skipped_other",
        "truncated_entries",
        "visited_entries",
        "truncated_directories",
        "ignore_rule_files_loaded",
        "ignore_rule_count",
        "sensitive_finding_count",
        "max_files",
        "max_directories",
        "max_path_chars",
        "max_file_bytes",
        "max_visited_entries",
        "max_directory_entries",
    ] {
        validate_required_payload_u64_field(object, field)?;
    }
    validate_required_payload_bool_field(object, "truncated")?;
    validate_required_payload_bool_field(object, "requested_force_refresh")?;
    if object
        .get("next_action")
        .and_then(serde_json::Value::as_str)
        != Some("build_bounded_index_query_file_selection")
    {
        bail!("{kind:?} ledger payload next_action is not supported");
    }
    Ok(())
}

fn validate_codebase_index_query_completed_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(
        kind,
        payload,
        CODEBASE_INDEX_QUERY_COMPLETED_KNOWN_PAYLOAD_FIELDS,
    )?;
    for field in [
        "mode_id",
        "query_id",
        "selection_id",
        "query_fingerprint",
        "selection_fingerprint",
        "index_id",
        "workspace_fingerprint",
        "snapshot_fingerprint",
        "snapshot_truncated",
        "matched_entry_count",
        "returned_entry_count",
        "skipped_entry_count",
        "max_results",
        "file_kind_filter",
        "match_reason_counts",
        "next_action",
    ] {
        if !object.contains_key(field) {
            bail!("{kind:?} ledger payload must include {field}");
        }
    }
    for field in [
        "mode_id",
        "query_id",
        "selection_id",
        "query_fingerprint",
        "selection_fingerprint",
        "index_id",
        "workspace_fingerprint",
        "snapshot_fingerprint",
        "file_kind_filter",
        "next_action",
    ] {
        validate_required_payload_string_field(object, field)?;
    }
    validate_required_payload_bool_field(object, "snapshot_truncated")?;
    for field in [
        "matched_entry_count",
        "returned_entry_count",
        "skipped_entry_count",
        "max_results",
    ] {
        validate_required_payload_u64_field(object, field)?;
    }
    validate_required_payload_object_field(object, "match_reason_counts")?;
    if object
        .get("next_action")
        .and_then(serde_json::Value::as_str)
        != Some("read_selected_files_with_controlled_workspace_read")
    {
        bail!("{kind:?} ledger payload next_action is not supported");
    }
    Ok(())
}

fn validate_codebase_index_selection_read_completed_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(
        kind,
        payload,
        CODEBASE_INDEX_SELECTION_READ_COMPLETED_KNOWN_PAYLOAD_FIELDS,
    )?;
    for field in [
        "mode_id",
        "tool_id",
        "query_id",
        "selection_id",
        "query_fingerprint",
        "selection_fingerprint",
        "index_id",
        "workspace_fingerprint",
        "snapshot_fingerprint",
        "snapshot_truncated",
        "read_path_fingerprint",
        "file_kind",
        "byte_length",
        "bytes_read",
        "truncated",
        "content_sha256",
        "content_hash_verified",
        "entry_count",
        "max_results",
        "file_kind_filter",
        "next_action",
    ] {
        if !object.contains_key(field) {
            bail!("{kind:?} ledger payload must include {field}");
        }
    }
    for field in [
        "mode_id",
        "tool_id",
        "query_id",
        "selection_id",
        "query_fingerprint",
        "selection_fingerprint",
        "index_id",
        "workspace_fingerprint",
        "snapshot_fingerprint",
        "read_path_fingerprint",
        "file_kind",
        "content_sha256",
        "file_kind_filter",
        "next_action",
    ] {
        validate_required_payload_string_field(object, field)?;
    }
    for field in ["byte_length", "bytes_read", "entry_count", "max_results"] {
        validate_required_payload_u64_field(object, field)?;
    }
    validate_required_payload_bool_field(object, "snapshot_truncated")?;
    validate_required_payload_bool_field(object, "truncated")?;
    validate_required_payload_bool_field(object, "content_hash_verified")?;
    if object.get("tool_id").and_then(serde_json::Value::as_str)
        != Some("codebase.index.selection.read")
    {
        bail!("{kind:?} ledger payload tool_id is not supported");
    }
    if object.get("content_hash_verified") != Some(&serde_json::Value::Bool(true)) {
        bail!("{kind:?} ledger payload content_hash_verified must be true");
    }
    if object
        .get("next_action")
        .and_then(serde_json::Value::as_str)
        != Some("use_selected_file_context_for_prompt_materialization")
    {
        bail!("{kind:?} ledger payload next_action is not supported");
    }
    Ok(())
}

fn validate_codebase_index_prompt_context_materialized_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(
        kind,
        payload,
        CODEBASE_INDEX_PROMPT_CONTEXT_MATERIALIZED_KNOWN_PAYLOAD_FIELDS,
    )?;
    for field in [
        "mode_id",
        "task_id",
        "run_id",
        "prompt_context_id",
        "source_event_id",
        "source_event_kind",
        "query_id",
        "selection_id",
        "query_fingerprint",
        "selection_fingerprint",
        "index_id",
        "workspace_fingerprint",
        "snapshot_fingerprint",
        "read_path_fingerprint",
        "file_kind",
        "bytes_read",
        "content_char_count",
        "content_sha256",
        "content_hash_verified",
        "prompt_preview_redacted",
        "next_action",
    ] {
        if !object.contains_key(field) {
            bail!("{kind:?} ledger payload must include {field}");
        }
    }
    for field in [
        "mode_id",
        "task_id",
        "run_id",
        "prompt_context_id",
        "source_event_id",
        "source_event_kind",
        "query_id",
        "selection_id",
        "query_fingerprint",
        "selection_fingerprint",
        "index_id",
        "workspace_fingerprint",
        "snapshot_fingerprint",
        "read_path_fingerprint",
        "file_kind",
        "content_sha256",
        "next_action",
    ] {
        validate_required_payload_string_field(object, field)?;
    }
    validate_required_payload_u64_field(object, "bytes_read")?;
    validate_required_payload_u64_field(object, "content_char_count")?;
    validate_required_payload_bool_field(object, "content_hash_verified")?;
    validate_required_payload_bool_field(object, "prompt_preview_redacted")?;
    if object
        .get("source_event_kind")
        .and_then(serde_json::Value::as_str)
        != Some("CodebaseIndexSelectionReadCompleted")
    {
        bail!("{kind:?} ledger payload source_event_kind is not supported");
    }
    if object.get("content_hash_verified") != Some(&serde_json::Value::Bool(true))
        || object.get("prompt_preview_redacted") != Some(&serde_json::Value::Bool(true))
    {
        bail!("{kind:?} ledger payload materialization booleans must be true");
    }
    if object
        .get("next_action")
        .and_then(serde_json::Value::as_str)
        != Some("continue_task_execution_with_materialized_context")
    {
        bail!("{kind:?} ledger payload next_action is not supported");
    }
    Ok(())
}

fn validate_verification_recovery_context_read_materialized_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(
        kind,
        payload,
        VERIFICATION_RECOVERY_CONTEXT_READ_KNOWN_PAYLOAD_FIELDS,
    )?;
    for field in [
        "verification_recovery_context_read",
        "context_read_id",
        "source_task_id",
        "source_run_id",
        "recovery_task_id",
        "recovery_run_id",
        "failure_fingerprint",
        "diagnostic_index",
        "tool_id",
        "check_id",
        "diagnostic_kind",
        "severity",
        "test_name_hash",
        "read_path_fingerprint",
        "line",
        "column",
        "excerpt_start_line",
        "excerpt_end_line",
        "excerpt_bytes",
        "excerpt_sha256",
        "excerpt_truncated",
        "prompt_preview_redacted",
        "mode_id",
        "required_action",
        "next_action",
    ] {
        if !object.contains_key(field) {
            bail!("{kind:?} ledger payload must include {field}");
        }
    }
    validate_required_payload_bool_field(object, "verification_recovery_context_read")?;
    for field in [
        "context_read_id",
        "source_task_id",
        "source_run_id",
        "recovery_task_id",
        "recovery_run_id",
        "failure_fingerprint",
        "tool_id",
        "check_id",
        "diagnostic_kind",
        "severity",
        "read_path_fingerprint",
        "excerpt_sha256",
        "mode_id",
        "required_action",
        "next_action",
    ] {
        validate_required_payload_string_field(object, field)?;
    }
    validate_required_payload_string_or_null_field(object, "test_name_hash")?;
    validate_required_payload_u64_field(object, "diagnostic_index")?;
    validate_required_payload_u64_or_null_field(object, "line")?;
    validate_required_payload_u64_or_null_field(object, "column")?;
    validate_required_payload_u64_field(object, "excerpt_start_line")?;
    validate_required_payload_u64_field(object, "excerpt_end_line")?;
    validate_required_payload_u64_field(object, "excerpt_bytes")?;
    validate_required_payload_bool_field(object, "excerpt_truncated")?;
    validate_required_payload_bool_field(object, "prompt_preview_redacted")?;
    if object.get("verification_recovery_context_read") != Some(&serde_json::Value::Bool(true))
        || object.get("prompt_preview_redacted") != Some(&serde_json::Value::Bool(true))
    {
        bail!("{kind:?} ledger payload recovery context booleans must be true");
    }
    if object
        .get("required_action")
        .and_then(serde_json::Value::as_str)
        != Some("ReadWorkspace")
    {
        bail!("{kind:?} ledger payload required_action must be ReadWorkspace");
    }
    if object
        .get("next_action")
        .and_then(serde_json::Value::as_str)
        != Some("run_recovery_task_with_context")
    {
        bail!("{kind:?} ledger payload next_action is not supported");
    }
    Ok(())
}

fn validate_agent_loop_started_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object =
        validate_known_payload_object(kind, payload, AGENT_LOOP_STARTED_KNOWN_PAYLOAD_FIELDS)?;
    for field in ["entrypoint", "state"] {
        if !object.contains_key(field) {
            bail!("{kind:?} ledger payload must include {field}");
        }
    }
    validate_required_payload_string_field(object, "entrypoint")?;
    validate_required_payload_string_field(object, "state")?;
    validate_optional_payload_bool_field(object, "verification_recovery_retry")?;
    Ok(())
}

fn validate_agent_loop_completed_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object =
        validate_known_payload_object(kind, payload, AGENT_LOOP_COMPLETED_KNOWN_PAYLOAD_FIELDS)?;
    for field in ["final_state", "completion_summary"] {
        if !object.contains_key(field) {
            bail!("{kind:?} ledger payload must include {field}");
        }
    }
    validate_required_payload_string_field(object, "final_state")?;
    validate_required_payload_string_field(object, "completion_summary")?;
    validate_optional_payload_string_field(object, "completion_result_fingerprint")?;
    validate_optional_payload_bool_field(object, "final_response_present")?;
    validate_optional_payload_u64_field(object, "final_response_chars")?;
    validate_optional_payload_bool_field(object, "verification_recovery_retry")?;
    Ok(())
}

fn validate_task_completion_accepted_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(
        kind,
        payload,
        TASK_COMPLETION_ACCEPTED_KNOWN_PAYLOAD_FIELDS,
    )?;
    for field in [
        "acceptance_id",
        "task_id",
        "run_id",
        "status",
        "terminal_completion_fingerprint",
        "acceptance_fingerprint",
        "verifier_gate_status",
        "replayed",
        "next_action",
    ] {
        if !object.contains_key(field) {
            bail!("{kind:?} ledger payload must include {field}");
        }
    }
    validate_required_payload_string_field(object, "acceptance_id")?;
    validate_required_payload_string_field(object, "task_id")?;
    validate_required_payload_string_field(object, "run_id")?;
    validate_required_payload_string_field(object, "status")?;
    validate_required_payload_string_field(object, "terminal_completion_fingerprint")?;
    validate_required_payload_string_field(object, "acceptance_fingerprint")?;
    validate_required_payload_string_field(object, "verifier_gate_status")?;
    validate_required_payload_bool_field(object, "replayed")?;
    validate_required_payload_string_field(object, "next_action")?;
    if object.get("status").and_then(serde_json::Value::as_str) != Some("AcceptedComplete") {
        bail!("{kind:?} ledger payload status must be AcceptedComplete");
    }
    if object
        .get("next_action")
        .and_then(serde_json::Value::as_str)
        != Some("inspect_accepted_completion")
    {
        bail!("{kind:?} ledger payload next_action is not supported");
    }
    Ok(())
}

fn validate_prompt_built_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(kind, payload, PROMPT_BUILT_KNOWN_PAYLOAD_FIELDS)?;
    validate_payload_has_known_field(kind, object)?;
    validate_optional_payload_u64_field(object, "message_count")?;
    validate_optional_payload_u64_field(object, "max_prompt_chars")?;
    validate_optional_payload_u64_field(object, "context_total_events")?;
    validate_optional_payload_u64_field(object, "context_included_events")?;
    validate_optional_payload_u64_field(object, "context_omitted_events")?;
    validate_optional_payload_u64_field(object, "context_max_events")?;
    validate_optional_payload_bool_field(object, "context_window_bounded")?;
    validate_optional_payload_string_field(object, "context_first_included_event")?;
    validate_optional_payload_string_field(object, "context_last_included_event")?;
    validate_optional_payload_bool_field(object, "context_budget_requested")?;
    validate_optional_payload_u64_field(object, "context_budget_max_prompt_chars")?;
    validate_optional_payload_u64_field(object, "context_budget_max_ledger_events")?;
    validate_optional_payload_u64_field(object, "context_budget_max_selected_index_chars")?;
    validate_optional_payload_u64_field(object, "context_budget_prompt_chars")?;
    validate_optional_payload_u64_field(object, "context_budget_protected_context_chars")?;
    validate_optional_payload_bool_field(object, "context_budget_prompt_within_budget")?;
    validate_optional_payload_bool_field(object, "context_budget_selected_index_context_present")?;
    validate_optional_payload_u64_field(object, "context_budget_selected_index_content_chars")?;
    validate_optional_payload_u64_field(
        object,
        "context_budget_selected_index_materialized_chars",
    )?;
    validate_optional_payload_bool_field(object, "context_budget_selected_index_truncated")?;
    validate_optional_payload_string_field(object, "prompt_preview")?;
    validate_optional_payload_bool_field(object, "prompt_preview_redacted")?;
    validate_optional_payload_string_field(object, "prompt_preview_redaction_reason")?;
    Ok(())
}

fn validate_prompt_sensitive_scan_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object =
        validate_known_payload_object(kind, payload, PROMPT_SENSITIVE_SCAN_KNOWN_PAYLOAD_FIELDS)?;
    for field in [
        "mode",
        "sensitive_guard",
        "finding_count",
        "categories",
        "message_indexes",
    ] {
        if !object.contains_key(field) {
            bail!("{kind:?} ledger payload must include {field}");
        }
    }
    validate_required_payload_string_field(object, "mode")?;
    validate_required_payload_string_field(object, "sensitive_guard")?;
    validate_required_payload_u64_field(object, "finding_count")?;
    validate_required_payload_string_array_field(object, "categories")?;
    validate_required_payload_u64_array_field(object, "message_indexes")?;
    Ok(())
}

fn validate_llm_request_created_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object =
        validate_known_payload_object(kind, payload, LLM_REQUEST_CREATED_KNOWN_PAYLOAD_FIELDS)?;
    for field in ["provider", "model", "message_count", "base_url", "strict"] {
        if !object.contains_key(field) {
            bail!("{kind:?} ledger payload must include {field}");
        }
    }
    validate_required_payload_string_field(object, "provider")?;
    validate_required_payload_string_field(object, "model")?;
    validate_required_payload_u64_field(object, "message_count")?;
    validate_required_payload_string_or_null_field(object, "base_url")?;
    validate_required_payload_bool_field(object, "strict")?;
    Ok(())
}

fn validate_llm_request_failed_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object =
        validate_known_payload_object(kind, payload, LLM_REQUEST_FAILED_KNOWN_PAYLOAD_FIELDS)?;
    validate_payload_has_known_field(kind, object)?;
    validate_optional_payload_string_field(object, "provider")?;
    validate_optional_payload_string_field(object, "model")?;
    validate_optional_payload_string_field(object, "reason")?;
    validate_optional_payload_u64_field(object, "reason_chars")?;
    validate_optional_payload_string_field(object, "reason_sha256")?;
    validate_optional_payload_bool_field(object, "reason_truncated")?;
    validate_optional_payload_string_or_null_field(object, "base_url")?;
    validate_optional_payload_bool_field(object, "strict")?;
    validate_optional_payload_string_field(object, "sensitive_guard")?;
    validate_optional_payload_object_field(object, "llm_provider_failure")?;
    Ok(())
}

fn validate_llm_response_received_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object =
        validate_known_payload_object(kind, payload, LLM_RESPONSE_RECEIVED_KNOWN_PAYLOAD_FIELDS)?;
    if !object.contains_key("provider")
        || (!object.contains_key("content_preview")
            && !object.contains_key("content_preview_redacted"))
    {
        bail!(
            "{kind:?} ledger payload must include provider and bounded response preview evidence"
        );
    }
    validate_required_payload_string_field(object, "provider")?;
    validate_optional_payload_u64_field(object, "response_preview_chars")?;
    validate_optional_payload_string_field(object, "content_preview")?;
    validate_optional_payload_bool_field(object, "content_preview_redacted")?;
    validate_optional_payload_string_field(object, "content_preview_redaction_reason")?;
    Ok(())
}

fn validate_task_started_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(kind, payload, TASK_STARTED_KNOWN_PAYLOAD_FIELDS)?;
    validate_payload_has_known_field(kind, object)?;
    validate_optional_payload_string_field(object, "status")?;
    validate_optional_payload_string_or_null_field(object, "parent_task_id")?;
    validate_optional_payload_string_or_null_field(object, "parent_run_id")?;
    validate_optional_payload_string_or_null_field(object, "source_candidate_id")?;
    validate_optional_payload_string_or_null_field(object, "source_handoff_envelope_id")?;
    validate_optional_payload_string_or_null_field(object, "source_handoff_envelope_fingerprint")?;
    validate_optional_payload_object_or_null_field(object, "source_intent_summary")?;
    validate_optional_payload_object_or_null_field(object, "recovery_cycle_provenance")?;
    validate_optional_payload_object_or_null_field(object, "external_modepack_child_provenance")?;
    validate_optional_payload_object_or_null_field(object, "verification_recovery_provenance")?;
    validate_optional_payload_object_or_null_field(object, "patch_apply_recovery_provenance")?;
    validate_optional_payload_object_or_null_field(
        object,
        "verification_recovery_retry_provenance",
    )?;
    validate_optional_payload_object_or_null_field(
        object,
        "llm_provider_failure_retry_provenance",
    )?;
    validate_optional_payload_object_or_null_field(object, "product_continuation_provenance")?;
    validate_optional_payload_object_or_null_field(
        object,
        "product_objective_continuation_provenance",
    )?;
    validate_optional_payload_object_or_null_field(
        object,
        "product_loop_stop_recovery_provenance",
    )?;
    validate_optional_payload_string_or_null_field(object, "source_task_id")?;
    validate_optional_payload_string_or_null_field(object, "source_run_id")?;
    validate_optional_payload_string_or_null_field(object, "source_apply_id")?;
    validate_optional_payload_string_or_null_field(object, "source_proposal_id")?;
    validate_optional_payload_string_or_null_field(object, "source_decision_id")?;
    validate_optional_payload_string_or_null_field(object, "failure_fingerprint")?;
    validate_optional_payload_string_or_null_field(object, "failure_class")?;
    validate_optional_payload_string_or_null_field(object, "recovery_task_id")?;
    validate_optional_payload_string_or_null_field(object, "recovery_run_id")?;
    validate_optional_payload_string_or_null_field(object, "proposal_id")?;
    validate_optional_payload_string_or_null_field(object, "apply_id")?;
    validate_optional_payload_string_or_null_field(object, "apply_fingerprint")?;
    validate_optional_payload_array_or_null_field(object, "retried_verifier_tool_ids")?;
    validate_optional_payload_string_or_null_field(object, "decision_fingerprint")?;
    validate_optional_payload_string_or_null_field(object, "product_evidence_fingerprint")?;
    validate_optional_payload_string_or_null_field(object, "derived_objective_fingerprint")?;
    validate_optional_payload_string_or_null_field(object, "derived_goal_fingerprint")?;
    validate_optional_payload_string_or_null_field(object, "source_session_id")?;
    validate_optional_payload_string_or_null_field(object, "source_drive_id")?;
    validate_optional_payload_string_or_null_field(object, "drive_fingerprint")?;
    validate_optional_payload_string_or_null_field(object, "stop_reason")?;
    validate_optional_payload_string_or_null_field(object, "stop_class")?;
    validate_optional_payload_string_or_null_field(object, "source_progress_fingerprint")?;
    validate_optional_payload_u64_or_null_field(object, "end_session_sequence")?;
    validate_optional_payload_string_or_null_field(object, "next_route_fingerprint")?;
    validate_optional_payload_string_or_null_field(object, "recovery_boundary_fingerprint")?;
    validate_optional_payload_bool_field(object, "execution_enabled")?;
    validate_optional_payload_bool_field(object, "scheduler_handoff_enabled")?;
    validate_optional_payload_bool_field(object, "recovery_running_enabled")?;
    validate_optional_payload_bool_field(object, "retry_running_enabled")?;
    validate_optional_payload_bool_field(object, "product_continuation_running_enabled")?;
    validate_optional_payload_bool_field(object, "product_loop_stop_recovery_running_enabled")?;
    validate_optional_payload_bool_or_null_field(object, "retryable")?;
    validate_optional_payload_string_field(object, "next_action")?;
    validate_optional_payload_string_field(object, "reason")?;
    Ok(())
}

fn validate_task_running_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(kind, payload, TASK_RUNNING_KNOWN_PAYLOAD_FIELDS)?;
    validate_payload_has_known_field(kind, object)?;
    validate_optional_payload_object_field(object, "runtime_deadline")?;
    validate_optional_payload_string_field(object, "deadline_scope")?;
    validate_optional_payload_bool_field(object, "deadline_persisted")?;
    validate_optional_payload_string_field(object, "admission_id")?;
    validate_optional_payload_string_field(object, "admission_kind")?;
    validate_optional_payload_string_field(object, "reason")?;
    if object.contains_key("runtime_deadline") {
        for field in ["deadline_scope", "deadline_persisted"] {
            if !object.contains_key(field) {
                bail!("{kind:?} ledger payload must include {field} with runtime_deadline");
            }
        }
        if object
            .get("deadline_scope")
            .and_then(serde_json::Value::as_str)
            != Some("task_run")
        {
            bail!("{kind:?} ledger payload deadline_scope must be task_run");
        }
        if object
            .get("deadline_persisted")
            .and_then(serde_json::Value::as_bool)
            != Some(true)
        {
            bail!("{kind:?} ledger payload deadline_persisted must be true");
        }
    }
    if object.contains_key("admission_id") || object.contains_key("admission_kind") {
        for field in ["admission_id", "admission_kind", "reason"] {
            if !object.contains_key(field) {
                bail!("{kind:?} ledger payload must include {field} for admission evidence");
            }
        }
    }
    Ok(())
}

fn validate_mode_resolved_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(kind, payload, MODE_RESOLVED_KNOWN_PAYLOAD_FIELDS)?;
    for field in [
        "mode_id",
        "display_name",
        "role_definition",
        "prompt_sections",
        "instruction_fingerprint",
        "workspace_write_scopes",
        "mcp_access",
        "completion_rules",
        "permissions",
    ] {
        if !object.contains_key(field) {
            bail!("{kind:?} ledger payload must include {field}");
        }
    }
    validate_required_payload_string_field(object, "mode_id")?;
    validate_required_payload_string_field(object, "display_name")?;
    validate_required_payload_string_field(object, "role_definition")?;
    validate_optional_payload_string_or_null_field(object, "when_to_use")?;
    validate_optional_payload_string_or_null_field(object, "description")?;
    validate_required_payload_array_field(object, "prompt_sections")?;
    validate_optional_payload_string_or_null_field(object, "verification_responsibility")?;
    validate_optional_payload_string_or_null_field(object, "instruction_fingerprint")?;
    validate_required_payload_array_field(object, "workspace_write_scopes")?;
    validate_optional_payload_array_or_null_field(object, "allowed_handoff_targets")?;
    validate_required_payload_array_field(object, "mcp_access")?;
    validate_required_payload_array_field(object, "completion_rules")?;
    validate_required_payload_object_field(object, "permissions")?;
    validate_optional_payload_array_field(object, "mcp_tool_catalogs")?;
    validate_optional_payload_object_field(object, "external_modepack_task_provenance")?;
    Ok(())
}

fn validate_external_modepack_child_denied_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(
        kind,
        payload,
        EXTERNAL_MODEPACK_CHILD_DENIED_KNOWN_PAYLOAD_FIELDS,
    )?;
    for field in ["status", "reason", "task_id", "run_id"] {
        if !object.contains_key(field) {
            bail!("{kind:?} ledger payload must include {field}");
        }
    }
    validate_required_payload_string_field(object, "status")?;
    validate_required_payload_string_field(object, "reason")?;
    validate_required_payload_string_field(object, "task_id")?;
    validate_required_payload_string_field(object, "run_id")?;
    validate_optional_payload_string_or_null_field(object, "parent_run_id")?;
    validate_optional_payload_string_or_null_field(object, "source_candidate_id")?;
    validate_optional_payload_string_or_null_field(object, "source_handoff_envelope_id")?;
    validate_optional_payload_string_or_null_field(object, "source_handoff_envelope_fingerprint")?;
    validate_optional_payload_string_or_null_field(object, "mode_id")?;
    if object.get("status").and_then(serde_json::Value::as_str) != Some("Denied") {
        bail!("{kind:?} ledger payload status must be Denied");
    }
    Ok(())
}

fn validate_external_modepack_task_denied_payload_schema(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> Result<()> {
    let object = validate_known_payload_object(
        kind,
        payload,
        EXTERNAL_MODEPACK_TASK_DENIED_KNOWN_PAYLOAD_FIELDS,
    )?;
    for field in [
        "status",
        "reason",
        "task_id",
        "run_id",
        "source_kind",
        "source_path",
    ] {
        if !object.contains_key(field) {
            bail!("{kind:?} ledger payload must include {field}");
        }
    }
    validate_required_payload_string_field(object, "status")?;
    validate_required_payload_string_field(object, "reason")?;
    validate_required_payload_string_field(object, "task_id")?;
    validate_required_payload_string_field(object, "run_id")?;
    validate_optional_payload_string_or_null_field(object, "mode_id")?;
    validate_required_payload_string_field(object, "source_kind")?;
    validate_required_payload_string_field(object, "source_path")?;
    if object.get("status").and_then(serde_json::Value::as_str) != Some("Denied") {
        bail!("{kind:?} ledger payload status must be Denied");
    }
    Ok(())
}

fn validate_known_payload_object<'a>(
    kind: &LedgerEventKind,
    payload: &'a serde_json::Value,
    allowed_fields: &[&str],
) -> Result<&'a serde_json::Map<String, serde_json::Value>> {
    let object = payload
        .as_object()
        .with_context(|| format!("{kind:?} ledger payload must be a JSON object"))?;
    for field in object.keys() {
        if !allowed_fields.contains(&field.as_str()) {
            bail!("{kind:?} ledger payload field {field} is not allowed by strict tool schema");
        }
    }
    Ok(object)
}

fn validate_payload_has_known_field(
    kind: &LedgerEventKind,
    object: &serde_json::Map<String, serde_json::Value>,
) -> Result<()> {
    if object.is_empty() {
        bail!("{kind:?} ledger payload must include at least one known field");
    }
    Ok(())
}

const AGENT_LOOP_STARTED_KNOWN_PAYLOAD_FIELDS: &[&str] =
    &["entrypoint", "state", "verification_recovery_retry"];

const AGENT_LOOP_COMPLETED_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "completion_result_fingerprint",
    "completion_summary",
    "final_response_chars",
    "final_response_present",
    "final_state",
    "verification_recovery_retry",
];

const TASK_COMPLETION_ACCEPTED_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "acceptance_fingerprint",
    "acceptance_id",
    "next_action",
    "replayed",
    "run_id",
    "status",
    "task_id",
    "terminal_completion_fingerprint",
    "verifier_gate_status",
];

const PROMPT_BUILT_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "context_budget_max_ledger_events",
    "context_budget_max_prompt_chars",
    "context_budget_max_selected_index_chars",
    "context_budget_prompt_chars",
    "context_budget_prompt_within_budget",
    "context_budget_protected_context_chars",
    "context_budget_requested",
    "context_budget_selected_index_content_chars",
    "context_budget_selected_index_context_present",
    "context_budget_selected_index_materialized_chars",
    "context_budget_selected_index_truncated",
    "context_first_included_event",
    "context_included_events",
    "context_last_included_event",
    "context_max_events",
    "context_omitted_events",
    "context_total_events",
    "context_window_bounded",
    "max_prompt_chars",
    "message_count",
    "prompt_preview",
    "prompt_preview_redacted",
    "prompt_preview_redaction_reason",
];

const PROMPT_SENSITIVE_SCAN_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "categories",
    "finding_count",
    "message_indexes",
    "mode",
    "sensitive_guard",
];

const LLM_REQUEST_CREATED_KNOWN_PAYLOAD_FIELDS: &[&str] =
    &["base_url", "message_count", "model", "provider", "strict"];

const LLM_REQUEST_FAILED_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "base_url",
    "llm_provider_failure",
    "model",
    "provider",
    "reason",
    "reason_chars",
    "reason_sha256",
    "reason_truncated",
    "sensitive_guard",
    "strict",
];

const LLM_RESPONSE_RECEIVED_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "content_preview",
    "content_preview_redacted",
    "content_preview_redaction_reason",
    "provider",
    "response_preview_chars",
];

const TASK_STARTED_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "apply_fingerprint",
    "apply_id",
    "decision_fingerprint",
    "derived_goal_fingerprint",
    "derived_objective_fingerprint",
    "drive_fingerprint",
    "end_session_sequence",
    "execution_enabled",
    "external_modepack_child_provenance",
    "failure_class",
    "failure_fingerprint",
    "llm_provider_failure_retry_provenance",
    "next_action",
    "next_route_fingerprint",
    "parent_run_id",
    "parent_task_id",
    "patch_apply_recovery_provenance",
    "product_continuation_provenance",
    "product_continuation_running_enabled",
    "product_evidence_fingerprint",
    "product_loop_stop_recovery_provenance",
    "product_loop_stop_recovery_running_enabled",
    "product_objective_continuation_provenance",
    "proposal_id",
    "reason",
    "recovery_boundary_fingerprint",
    "recovery_cycle_provenance",
    "recovery_run_id",
    "recovery_running_enabled",
    "recovery_task_id",
    "retried_verifier_tool_ids",
    "retry_running_enabled",
    "retryable",
    "scheduler_handoff_enabled",
    "source_apply_id",
    "source_candidate_id",
    "source_decision_id",
    "source_drive_id",
    "source_handoff_envelope_fingerprint",
    "source_handoff_envelope_id",
    "source_intent_summary",
    "source_progress_fingerprint",
    "source_proposal_id",
    "source_run_id",
    "source_session_id",
    "source_task_id",
    "status",
    "stop_class",
    "stop_reason",
    "verification_recovery_provenance",
    "verification_recovery_retry_provenance",
];

const TASK_RUNNING_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "admission_id",
    "admission_kind",
    "deadline_persisted",
    "deadline_scope",
    "reason",
    "runtime_deadline",
];

const MODE_RESOLVED_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "allowed_handoff_targets",
    "completion_rules",
    "description",
    "display_name",
    "external_modepack_task_provenance",
    "instruction_fingerprint",
    "mcp_access",
    "mcp_tool_catalogs",
    "mode_id",
    "permissions",
    "prompt_sections",
    "role_definition",
    "verification_responsibility",
    "workspace_write_scopes",
    "when_to_use",
];

const EXTERNAL_MODEPACK_CHILD_DENIED_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "mode_id",
    "parent_run_id",
    "reason",
    "run_id",
    "source_candidate_id",
    "source_handoff_envelope_fingerprint",
    "source_handoff_envelope_id",
    "status",
    "task_id",
];

const EXTERNAL_MODEPACK_TASK_DENIED_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "mode_id",
    "reason",
    "run_id",
    "source_kind",
    "source_path",
    "status",
    "task_id",
];

const TOOL_PLAN_KNOWN_PAYLOAD_FIELDS: &[&str] =
    &["allowed", "reason", "required_action", "tool_id"];

const TOOL_PLANNED_KNOWN_PAYLOAD_FIELDS: &[&str] = &["tool_ids"];

const TOOL_INTENT_PARSED_KNOWN_PAYLOAD_FIELDS: &[&str] = &["parser", "tool_ids"];

const TOOL_INTENT_REJECTED_KNOWN_PAYLOAD_FIELDS: &[&str] = &["code", "reason", "tool_id"];

const WORKSPACE_PATCH_PROPOSED_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "content_chars",
    "content_preview",
    "diff_preview",
    "diff_redacted",
    "diff_truncated",
    "failed_verifier_tool_ids",
    "failure_class",
    "failure_fingerprint",
    "hunk_count",
    "hunk_fingerprint",
    "operation",
    "patch_apply_recovery_repair",
    "path",
    "proposal_id",
    "recovery_run_id",
    "recovery_task_id",
    "source_apply_fingerprint",
    "source_apply_id",
    "source_hunk_count",
    "source_hunk_fingerprint",
    "source_operation",
    "source_path",
    "source_proposal_id",
    "source_run_id",
    "source_task_id",
    "tool_id",
    "truncated",
    "validation_reason",
    "validation_status",
    "verification_recovery_repair",
];

const WORKSPACE_PATCH_APPROVAL_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "approval_reason",
    "approval_reason_redacted",
    "approval_status",
    "approved_at",
    "proposal_id",
    "rejected_at",
];

const WORKSPACE_PATCH_PREFLIGHT_SNAPSHOT_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "canonical_path_hash",
    "captured_at",
    "file_exists",
    "file_kind",
    "file_modified_unix_ms",
    "file_sha256",
    "file_size_bytes",
    "path",
    "proposal_id",
    "snapshot_id",
    "stale",
    "stale_reason",
];

const WORKSPACE_PATCH_APPLY_PLAN_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "check_count",
    "failed_checks",
    "operation",
    "plan_id",
    "proposal_id",
    "status",
];

const WORKSPACE_PATCH_APPLY_CAPABILITY_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "apply_enabled",
    "apply_supported",
    "blocked_checks",
    "can_apply_now",
    "capability_id",
    "check_count",
    "checked_at",
    "failed_checks",
    "mode",
    "proposal_id",
    "reason",
    "required_gates",
];

const WORKSPACE_PATCH_APPLY_DRY_RUN_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "apply_executed",
    "blocked_checks",
    "check_count",
    "checked_at",
    "dry_run_id",
    "dry_run_reason",
    "dry_run_status",
    "failed_checks",
    "no_patch_applied",
    "proposal_id",
    "required_gates",
    "workspace_files_changed",
];

const WORKSPACE_PATCH_APPLY_RESULT_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "applied",
    "applied_at",
    "apply_id",
    "apply_reason",
    "apply_status",
    "atomic_create_completed",
    "atomic_delete_completed",
    "atomic_replacement_completed",
    "authorization_consumed",
    "authorization_id",
    "blocked_checks",
    "check_count",
    "checked_at",
    "content_bytes",
    "content_chars",
    "expected_target_absent",
    "expected_target_sha256",
    "failed_checks",
    "hunk_count",
    "hunk_fingerprint",
    "operation",
    "path",
    "post_delete_target_exists",
    "post_write_sha256",
    "pre_write_target_exists",
    "pre_write_target_sha256",
    "proposal_id",
    "temp_file_cleaned",
    "transaction_id",
    "transaction_item_count",
    "transaction_items",
    "transaction_recovery_source",
    "transaction_recovery_status",
    "transaction_status",
];

const WORKSPACE_PATCH_READINESS_REPORT_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "blocked_checks",
    "check_count",
    "failed_checks",
    "fingerprint_input_count",
    "generated_at",
    "proposal_id",
    "readiness_fingerprint",
    "readiness_reason",
    "readiness_status",
    "report_id",
];

const SUBTASK_ORCHESTRATION_QUEUED_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "execution_enabled",
    "input_summary",
    "parent_run_id",
    "parent_task_id",
    "queue_position",
    "reason",
    "request_reason",
    "requested_goal_preview",
    "requested_mode_id",
    "required_action",
    "status",
    "subtask_id",
    "tool_id",
];

const SUBTASK_HANDOFF_PREPARED_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "execution_enabled",
    "handoff_id",
    "next_action",
    "parent_run_id",
    "parent_task_id",
    "queued_count",
    "queued_subtask_ids",
    "reason",
    "source_event_count",
    "status",
];

const SUBTASK_SCHEDULER_READINESS_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "blocked_checks",
    "check_count",
    "dispatch_enabled",
    "execution_enabled",
    "handoff_count",
    "handoff_id",
    "next_action",
    "parent_run_id",
    "parent_task_id",
    "queued_count",
    "readiness_id",
    "readiness_reason",
    "readiness_status",
    "reason",
    "source_event_count",
    "status",
];

const SUBTASK_DISPATCH_PLAN_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "blocked_checks",
    "check_count",
    "dispatch_enabled",
    "dispatch_plan_status",
    "dispatch_reason",
    "execution_enabled",
    "next_action",
    "parent_run_id",
    "parent_task_id",
    "plan_id",
    "queued_count",
    "readiness_count",
    "readiness_id",
    "reason",
    "required_capability",
    "source_event_count",
    "status",
];

const SUBTASK_DISPATCH_CONTRACT_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "blocked_checks",
    "check_count",
    "contract_id",
    "dispatch_contract_reason",
    "dispatch_contract_status",
    "dispatch_enabled",
    "eligibility_status",
    "execution_enabled",
    "next_action",
    "parent_run_id",
    "parent_task_id",
    "plan_count",
    "plan_id",
    "queued_count",
    "reason",
    "required_capability",
    "required_preconditions",
    "source_event_count",
    "status",
];

const SUBTASK_DISPATCH_ADMISSION_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "admission_id",
    "admission_reason",
    "admission_status",
    "blocked_checks",
    "blocked_preconditions",
    "check_count",
    "contract_count",
    "contract_id",
    "dispatch_enabled",
    "execution_enabled",
    "execution_gate_status",
    "next_action",
    "parent_run_id",
    "parent_task_id",
    "precondition_count",
    "queued_count",
    "reason",
    "required_capability",
    "satisfied_precondition_count",
    "source_event_count",
    "status",
];

const SUBTASK_DISPATCH_READINESS_SNAPSHOT_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "admission_count",
    "admission_id",
    "blocked_checks",
    "blocked_preconditions",
    "check_count",
    "dispatch_enabled",
    "execution_enabled",
    "fingerprint_input_count",
    "next_action",
    "parent_run_id",
    "parent_task_id",
    "precondition_count",
    "queued_count",
    "readiness_fingerprint",
    "readiness_reason",
    "readiness_status",
    "reason",
    "required_capability",
    "satisfied_precondition_count",
    "scheduler_handoff_status",
    "snapshot_id",
    "source_event_count",
    "status",
];

const SUBTASK_DISPATCHER_GUARD_VERDICT_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "blocked_checks",
    "blocked_preconditions",
    "check_count",
    "dispatch_enabled",
    "execution_enabled",
    "fingerprint_input_count",
    "guard_id",
    "guard_reason",
    "guard_status",
    "handoff_preflight_status",
    "next_action",
    "parent_run_id",
    "parent_task_id",
    "precondition_count",
    "queued_count",
    "reason",
    "required_capability",
    "satisfied_precondition_count",
    "scheduler_handoff_status",
    "snapshot_count",
    "snapshot_fingerprint",
    "snapshot_fingerprint_count",
    "snapshot_id",
    "snapshot_validity_status",
    "source_event_count",
    "status",
];

const SUBTASK_DISPATCH_DECISION_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "blocked_candidate_count",
    "blocked_checks",
    "blocked_preconditions",
    "candidate_status",
    "check_count",
    "decision_id",
    "decision_status",
    "dispatch_candidate_count",
    "dispatch_decision",
    "dispatch_denial_reason",
    "dispatch_enabled",
    "eligible_candidate_count",
    "execution_enabled",
    "fingerprint_input_count",
    "guard_count",
    "guard_id",
    "guard_status",
    "handoff_preflight_status",
    "next_action",
    "parent_run_id",
    "parent_task_id",
    "precondition_count",
    "queued_count",
    "reason",
    "required_capability",
    "satisfied_precondition_count",
    "snapshot_fingerprint",
    "snapshot_fingerprint_count",
    "snapshot_id",
    "snapshot_validity_status",
    "source_event_count",
    "status",
];

const SUBTASK_DISPATCH_CANDIDATE_MANIFEST_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "blocked_candidate_count",
    "blocked_candidate_ids",
    "blocked_checks",
    "blocked_preconditions",
    "candidate_count",
    "candidate_denial_reason",
    "candidate_ids",
    "candidate_manifest_fingerprint",
    "candidate_status",
    "check_count",
    "decision_count",
    "decision_id",
    "dispatch_candidate_count",
    "dispatch_decision",
    "dispatch_enabled",
    "eligible_candidate_count",
    "eligible_candidate_ids",
    "execution_enabled",
    "fingerprint_input_count",
    "guard_id",
    "manifest_id",
    "manifest_status",
    "next_action",
    "parent_run_id",
    "parent_task_id",
    "precondition_count",
    "queued_count",
    "reason",
    "required_capability",
    "satisfied_precondition_count",
    "snapshot_fingerprint",
    "snapshot_id",
    "source_event_count",
    "status",
];

const SUBTASK_DISPATCH_HANDOFF_ENVELOPE_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "blocked_candidate_count",
    "blocked_candidate_ids",
    "blocked_checks",
    "blocked_preconditions",
    "candidate_count",
    "candidate_denial_reason",
    "candidate_ids",
    "candidate_manifest_fingerprint",
    "candidate_status",
    "check_count",
    "continuation_materialization",
    "continuation_source",
    "decision_id",
    "dispatch_candidate_count",
    "dispatch_decision",
    "dispatch_enabled",
    "eligible_candidate_count",
    "eligible_candidate_ids",
    "execution_enabled",
    "fingerprint_input_count",
    "handoff_envelope_fingerprint",
    "handoff_envelope_id",
    "handoff_envelope_status",
    "handoff_ticket_count",
    "handoff_ticket_status",
    "manifest_count",
    "manifest_id",
    "max_recovery_cycle_depth",
    "next_action",
    "parent_join_admission_id",
    "parent_join_child_completion_child_count",
    "parent_join_child_completion_fingerprint",
    "parent_join_fingerprint_input_count",
    "parent_join_recovery_cycle",
    "parent_join_recovery_cycle_depth",
    "parent_join_terminal_completed_child_count",
    "parent_join_terminal_failed_child_count",
    "parent_run_id",
    "parent_task_id",
    "precondition_count",
    "queued_count",
    "reason",
    "recovery_cycle_budget_status",
    "replay_guard_reason",
    "replay_guard_status",
    "required_capability",
    "satisfied_precondition_count",
    "scheduler_handoff_status",
    "source_event_count",
    "status",
];

const PARENT_JOIN_CONTINUATION_CONSUMED_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "admission_id",
    "child_completion_child_count",
    "child_completion_fingerprint",
    "child_recovery_cycle_depth",
    "child_terminal_completed_count",
    "child_terminal_failed_count",
    "fingerprint_input_count",
    "parent_join_continuation_status",
    "reason",
];

const TOOL_INTENT_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "allowed",
    "input_summary",
    "mode_id",
    "reason",
    "request_reason",
    "requested_mode_id",
    "required_action",
    "source_apply_id",
    "source_run_id",
    "source_task_id",
    "tool_id",
    "verification_requirement_fingerprint",
    "verification_requirement_id",
    "verification_requirement_source_kind",
    "verification_recovery_retry",
];

const TOOL_EXECUTION_REQUESTED_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "input_summary",
    "request_fingerprint",
    "source_apply_id",
    "tool_id",
    "verification_requirement_fingerprint",
    "verification_requirement_id",
    "verification_requirement_source_kind",
    "verification_recovery_retry",
];

const TOOL_EXECUTION_PERMISSION_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "allowed",
    "mcp_safety_policy",
    "reason",
    "request_fingerprint",
    "required_action",
    "server_id",
    "source_apply_id",
    "tool_id",
    "tool_name",
    "verification_requirement_fingerprint",
    "verification_requirement_id",
    "verification_requirement_source_kind",
    "verification_recovery_retry",
];

const TOOL_EXECUTION_TERMINAL_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "absolute_paths_redacted",
    "ambient_index_ignored",
    "authorized_change_set_fingerprint",
    "authorized_path_count",
    "bounded_cargo_diagnostics",
    "bytes_read",
    "captured_bytes",
    "cargo_dependency_fetch_offline",
    "catalog_provenance",
    "check_id",
    "cleanup_succeeded",
    "commit_id",
    "committed_tree_fingerprint",
    "compile_time_code_sandboxed",
    "duration_ms",
    "exit_code",
    "expected_parent_head",
    "failed_git_operation",
    "git",
    "git_environment_hardened",
    "git_optional_locks_disabled",
    "git_process_count",
    "git_processes_bounded",
    "git_prompts_disabled",
    "line_count",
    "logical_invocation_fingerprint",
    "mcp",
    "mcp_approval_binding",
    "mcp_safety_policy",
    "message_fingerprint",
    "mutation_process_launched",
    "operation",
    "os_network_isolated",
    "output_oversized",
    "output_preview",
    "output_redacted",
    "output_truncated",
    "process_launched",
    "process_tree_kill_attempted",
    "process_tree_kill_reason",
    "process_tree_kill_succeeded",
    "process_tree_timeout_supported",
    "raw_diff_redacted",
    "raw_file_content_redacted",
    "raw_message_redacted",
    "reason",
    "reader_thread_joined",
    "replayed",
    "repository_hooks_bypassed",
    "runtime_authorization_required",
    "source_apply_id",
    "standard_error_bytes",
    "standard_error_truncated",
    "standard_output_bytes",
    "standard_output_truncated",
    "status",
    "target_dir_isolated",
    "temporary_index_cleaned",
    "test_code_executed",
    "timed_out",
    "tool_id",
    "truncated",
    "trusted_workspace_required",
    "used_git_plumbing",
    "used_temporary_index",
    "verification_requirement_fingerprint",
    "verification_requirement_id",
    "verification_requirement_source_kind",
    "verification_recovery_retry",
    "verification_status",
    "workspace_write_scope_fingerprint",
];

const MCP_TOOL_EXECUTION_APPROVED_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "approval_fingerprint",
    "approval_id_fingerprint",
    "approval_schema_version",
    "approval_state_fingerprint",
    "catalog_provenance",
    "mcp_safety_policy",
    "outcome",
    "outcome_fingerprint",
    "recovery_fingerprint",
    "recovery_reason",
    "recovery_source_state_fingerprint",
    "request_fingerprint",
    "run_id",
    "server_id",
    "status",
    "task_id",
    "tool_id",
    "tool_name",
];

const CODEBASE_INDEX_PERMISSION_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "action",
    "allowed",
    "entry_count",
    "file_kind_filter",
    "index_id",
    "max_results",
    "mode_id",
    "query_fingerprint",
    "query_id",
    "query_length_chars",
    "query_token_count",
    "reason",
    "request_kind",
    "requested_force_refresh",
    "requested_root_present",
    "selection_fingerprint",
    "selection_id",
    "snapshot_fingerprint",
    "workspace_fingerprint",
];

const CODEBASE_INDEX_SNAPSHOT_BUILT_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "built_at",
    "ignore_rule_count",
    "ignore_rule_files_loaded",
    "index_id",
    "indexed_files",
    "max_directories",
    "max_directory_entries",
    "max_file_bytes",
    "max_files",
    "max_path_chars",
    "max_visited_entries",
    "mode_id",
    "next_action",
    "requested_force_refresh",
    "root",
    "sensitive_finding_count",
    "skipped_binary_like",
    "skipped_ignored",
    "skipped_other",
    "skipped_protected",
    "skipped_sensitive",
    "skipped_symlink",
    "skipped_too_large",
    "skipped_unreadable",
    "skipped_unsafe_path",
    "snapshot_fingerprint",
    "truncated",
    "truncated_directories",
    "truncated_entries",
    "visited_entries",
    "walked_directories",
    "workspace_fingerprint",
];

const CODEBASE_INDEX_QUERY_COMPLETED_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "file_kind_filter",
    "index_id",
    "match_reason_counts",
    "matched_entry_count",
    "max_results",
    "mode_id",
    "next_action",
    "query_fingerprint",
    "query_id",
    "returned_entry_count",
    "selection_fingerprint",
    "selection_id",
    "skipped_entry_count",
    "snapshot_fingerprint",
    "snapshot_truncated",
    "workspace_fingerprint",
];

const CODEBASE_INDEX_SELECTION_READ_COMPLETED_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "byte_length",
    "bytes_read",
    "content_hash_verified",
    "content_sha256",
    "entry_count",
    "file_kind",
    "file_kind_filter",
    "index_id",
    "max_results",
    "mode_id",
    "next_action",
    "query_fingerprint",
    "query_id",
    "read_path_fingerprint",
    "selection_fingerprint",
    "selection_id",
    "snapshot_fingerprint",
    "snapshot_truncated",
    "tool_id",
    "truncated",
    "workspace_fingerprint",
];

const CODEBASE_INDEX_PROMPT_CONTEXT_MATERIALIZED_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "bytes_read",
    "content_char_count",
    "content_hash_verified",
    "content_sha256",
    "file_kind",
    "index_id",
    "mode_id",
    "next_action",
    "prompt_context_id",
    "prompt_preview_redacted",
    "query_fingerprint",
    "query_id",
    "read_path_fingerprint",
    "run_id",
    "selection_fingerprint",
    "selection_id",
    "snapshot_fingerprint",
    "source_event_id",
    "source_event_kind",
    "task_id",
    "workspace_fingerprint",
];

const VERIFICATION_RECOVERY_CONTEXT_READ_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "check_id",
    "column",
    "context_read_id",
    "diagnostic_index",
    "diagnostic_kind",
    "excerpt_bytes",
    "excerpt_end_line",
    "excerpt_sha256",
    "excerpt_start_line",
    "excerpt_truncated",
    "failure_fingerprint",
    "line",
    "mode_id",
    "next_action",
    "prompt_preview_redacted",
    "read_path_fingerprint",
    "recovery_run_id",
    "recovery_task_id",
    "required_action",
    "severity",
    "source_run_id",
    "source_task_id",
    "test_name_hash",
    "tool_id",
    "verification_recovery_context_read",
];

const TERMINAL_TASK_KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "caller_authorized",
    "cancel_fingerprint",
    "cancel_id",
    "cancel_status",
    "completion_evidence",
    "expected_task_updated_at",
    "apply_enabled",
    "bounded_cargo_diagnostics",
    "failed_verifier_count",
    "failed_verifier_tool_ids",
    "failure_fingerprint",
    "failure_reason",
    "failure_reasons",
    "git",
    "late_tool_response",
    "missing_verifier_tool_ids",
    "mcp",
    "next_action",
    "passed_verifier_count",
    "passed_verifier_tool_ids",
    "previous_status",
    "proposal_count",
    "proposal_id",
    "reason",
    "recovery_run_id",
    "recovery_task_id",
    "request_fingerprint_version",
    "required_verifier_count",
    "required_verifier_tool_ids",
    "requirement_fingerprint",
    "run_id",
    "runtime_deadline",
    "status",
    "task_id",
    "terminal_evidence",
    "terminal_process_loss",
    "terminal_race_candidate",
    "source_apply_id",
    "source_run_id",
    "source_task_id",
    "verification_completion_gate_status",
    "verification_recovery_repair",
    "verification_recovery_repair_gate_status",
    "verification_requirement_fingerprint",
    "verification_requirement_id",
    "verification_requirement_source_kind",
];

fn validate_optional_payload_string_field(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<()> {
    if let Some(value) = object.get(field) {
        if !value.is_string() {
            bail!("ledger payload field {field} must be a string");
        }
    }
    Ok(())
}

fn validate_required_payload_string_field(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<()> {
    let Some(value) = object.get(field) else {
        bail!("ledger payload field {field} is required");
    };
    if !value.is_string() {
        bail!("ledger payload field {field} must be a string");
    }
    Ok(())
}

fn validate_required_payload_string_or_null_field(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<()> {
    let Some(value) = object.get(field) else {
        bail!("ledger payload field {field} is required");
    };
    if !value.is_string() && !value.is_null() {
        bail!("ledger payload field {field} must be a string or null");
    }
    Ok(())
}

fn validate_optional_payload_string_or_null_field(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<()> {
    if let Some(value) = object.get(field) {
        if !value.is_string() && !value.is_null() {
            bail!("ledger payload field {field} must be a string or null");
        }
    }
    Ok(())
}

fn validate_required_payload_bool_field(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<()> {
    let Some(value) = object.get(field) else {
        bail!("ledger payload field {field} is required");
    };
    if !value.is_boolean() {
        bail!("ledger payload field {field} must be a boolean");
    }
    Ok(())
}

fn validate_required_payload_object_field(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<()> {
    let Some(value) = object.get(field) else {
        bail!("ledger payload field {field} is required");
    };
    if !value.is_object() {
        bail!("ledger payload field {field} must be an object");
    }
    Ok(())
}

fn validate_required_payload_u64_field(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<()> {
    let Some(value) = object.get(field) else {
        bail!("ledger payload field {field} is required");
    };
    if value.as_u64().is_none() {
        bail!("ledger payload field {field} must be an unsigned integer");
    }
    Ok(())
}

fn validate_required_payload_u64_or_null_field(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<()> {
    let Some(value) = object.get(field) else {
        bail!("ledger payload field {field} is required");
    };
    if !value.is_null() && value.as_u64().is_none() {
        bail!("ledger payload field {field} must be an unsigned integer or null");
    }
    Ok(())
}

fn validate_optional_payload_u64_or_null_field(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<()> {
    if let Some(value) = object.get(field) {
        if !(value.is_u64() || value.is_null()) {
            bail!("ledger payload field {field} must be a u64 or null");
        }
    }
    Ok(())
}

fn validate_optional_payload_bool_field(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<()> {
    if let Some(value) = object.get(field) {
        if !value.is_boolean() {
            bail!("ledger payload field {field} must be a boolean");
        }
    }
    Ok(())
}

fn validate_optional_payload_bool_or_null_field(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<()> {
    if let Some(value) = object.get(field) {
        if !(value.is_boolean() || value.is_null()) {
            bail!("ledger payload field {field} must be a boolean or null");
        }
    }
    Ok(())
}

fn validate_optional_payload_object_or_null_field(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<()> {
    if let Some(value) = object.get(field) {
        if !value.is_object() && !value.is_null() {
            bail!("ledger payload field {field} must be an object or null");
        }
    }
    Ok(())
}

fn validate_optional_payload_object_field(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<()> {
    if let Some(value) = object.get(field) {
        if !value.is_object() {
            bail!("ledger payload field {field} must be an object");
        }
    }
    Ok(())
}

fn validate_optional_payload_u64_field(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<()> {
    if let Some(value) = object.get(field) {
        if value.as_u64().is_none() {
            bail!("ledger payload field {field} must be an unsigned integer");
        }
    }
    Ok(())
}

fn validate_optional_payload_i64_or_null_field(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<()> {
    if let Some(value) = object.get(field) {
        if !value.is_null() && value.as_i64().is_none() && value.as_u64().is_none() {
            bail!("ledger payload field {field} must be an integer or null");
        }
    }
    Ok(())
}

fn validate_required_payload_i64_or_null_field(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<()> {
    let Some(value) = object.get(field) else {
        bail!("ledger payload field {field} is required");
    };
    if !value.is_null() && value.as_i64().is_none() && value.as_u64().is_none() {
        bail!("ledger payload field {field} must be an integer or null");
    }
    Ok(())
}

fn validate_optional_payload_string_array_field(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<()> {
    if let Some(value) = object.get(field) {
        let Some(values) = value.as_array() else {
            bail!("ledger payload field {field} must be an array");
        };
        if values.iter().any(|entry| !entry.is_string()) {
            bail!("ledger payload field {field} must contain only strings");
        }
    }
    Ok(())
}

fn validate_required_payload_string_array_field(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<()> {
    let Some(value) = object.get(field) else {
        bail!("ledger payload field {field} is required");
    };
    let Some(values) = value.as_array() else {
        bail!("ledger payload field {field} must be an array");
    };
    if values.iter().any(|entry| !entry.is_string()) {
        bail!("ledger payload field {field} must contain only strings");
    }
    Ok(())
}

fn validate_required_payload_u64_array_field(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<()> {
    let Some(value) = object.get(field) else {
        bail!("ledger payload field {field} is required");
    };
    let Some(values) = value.as_array() else {
        bail!("ledger payload field {field} must be an array");
    };
    if values.iter().any(|entry| entry.as_u64().is_none()) {
        bail!("ledger payload field {field} must contain only unsigned integers");
    }
    Ok(())
}

fn validate_optional_payload_array_field(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<()> {
    if let Some(value) = object.get(field) {
        if !value.is_array() {
            bail!("ledger payload field {field} must be an array");
        }
    }
    Ok(())
}

fn validate_required_payload_array_field(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<()> {
    let Some(value) = object.get(field) else {
        bail!("ledger payload field {field} is required");
    };
    if !value.is_array() {
        bail!("ledger payload field {field} must be an array");
    }
    Ok(())
}

fn validate_optional_payload_array_or_null_field(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<()> {
    if let Some(value) = object.get(field) {
        if !(value.is_array() || value.is_null()) {
            bail!("ledger payload field {field} must be an array or null");
        }
    }
    Ok(())
}

fn validate_ledger_payload_envelope(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
    envelope: &LedgerPayloadEnvelope,
) -> Result<()> {
    if envelope.schema_version == 1 && envelope.schema_id.is_empty() {
        let expected_shape_id = ledger_payload_legacy_v1_shape_id(kind);
        if envelope.shape_id != expected_shape_id {
            bail!("legacy ledger payload envelope shape_id mismatch");
        }
        let expected_shape_fingerprint =
            ledger_payload_legacy_v1_shape_fingerprint_for_value(kind, payload);
        if envelope.shape_fingerprint != expected_shape_fingerprint {
            bail!("legacy ledger payload envelope shape_fingerprint mismatch");
        }
        return Ok(());
    }

    if envelope.schema_version != LEDGER_PAYLOAD_SCHEMA_VERSION {
        bail!("ledger payload envelope schema_version mismatch");
    }
    let expected_schema_id = ledger_payload_schema_id(kind);
    if envelope.schema_id != expected_schema_id || envelope.shape_id != expected_schema_id {
        bail!("ledger payload envelope schema_id mismatch");
    }
    let expected_schema_fingerprint = ledger_payload_schema_fingerprint(kind);
    if envelope.schema_fingerprint != expected_schema_fingerprint
        || envelope.shape_fingerprint != expected_schema_fingerprint
    {
        bail!("ledger payload envelope schema_fingerprint mismatch");
    }
    let expected_instance_fingerprint =
        ledger_payload_instance_shape_fingerprint_for_value(kind, payload);
    if envelope.instance_shape_fingerprint != expected_instance_fingerprint {
        bail!("ledger payload envelope instance_shape_fingerprint mismatch");
    }
    Ok(())
}

fn validate_legacy_ledger_payload_envelope(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
    envelope: &LedgerPayloadEnvelope,
) -> Result<()> {
    if envelope.schema_version == 1 && envelope.schema_id.is_empty() {
        let expected_shape_id = ledger_payload_legacy_v1_shape_id(kind);
        if envelope.shape_id != expected_shape_id {
            bail!("legacy ledger payload envelope shape_id mismatch");
        }
        let expected_shape_fingerprint =
            ledger_payload_legacy_v1_shape_fingerprint_for_value(kind, payload);
        if envelope.shape_fingerprint != expected_shape_fingerprint {
            bail!("legacy ledger payload envelope shape_fingerprint mismatch");
        }
        return Ok(());
    }

    if (2..LEDGER_PAYLOAD_SCHEMA_VERSION).contains(&envelope.schema_version) {
        let expected_schema_id = format!("ledger_payload.{kind:?}.v{}", envelope.schema_version);
        if envelope.schema_id != expected_schema_id || envelope.shape_id != expected_schema_id {
            bail!("legacy ledger payload envelope schema_id mismatch");
        }
        let expected_schema_fingerprint = stable_ledger_payload_fingerprint(&format!(
            "{kind:?}:payload_schema_v{}:descriptor:{}",
            envelope.schema_version,
            ledger_payload_legacy_schema_descriptor(kind, envelope.schema_version)
        ));
        if envelope.schema_fingerprint != expected_schema_fingerprint
            || envelope.shape_fingerprint != expected_schema_fingerprint
        {
            bail!("legacy ledger payload envelope schema_fingerprint mismatch");
        }
        let expected_instance_fingerprint = stable_ledger_payload_fingerprint(&format!(
            "{kind:?}:payload_instance_shape_v{}:descriptor:{}",
            envelope.schema_version,
            ledger_payload_shape_descriptor(payload)
        ));
        if envelope.instance_shape_fingerprint != expected_instance_fingerprint {
            bail!("legacy ledger payload envelope instance_shape_fingerprint mismatch");
        }
        return Ok(());
    }

    bail!("unsupported legacy ledger payload envelope schema_version");
}

fn ledger_payload_schema_fingerprint_input(kind: &LedgerEventKind) -> String {
    format!(
        "{kind:?}:payload_schema_v{LEDGER_PAYLOAD_SCHEMA_VERSION}:descriptor:{}",
        ledger_payload_schema_descriptor(kind)
    )
}

fn ledger_payload_schema_descriptor(kind: &LedgerEventKind) -> String {
    match kind {
        LedgerEventKind::TaskCompleted => terminal_task_payload_schema_descriptor("Completed"),
        LedgerEventKind::TaskFailed => terminal_task_payload_schema_descriptor("Failed"),
        LedgerEventKind::TaskCancelled => terminal_task_payload_schema_descriptor("Cancelled"),
        LedgerEventKind::PermissionChecked | LedgerEventKind::PermissionDenied => {
            permission_payload_schema_descriptor()
        }
        LedgerEventKind::ToolPlanned => tool_planned_payload_schema_descriptor(),
        LedgerEventKind::ToolPermissionChecked
        | LedgerEventKind::ToolPlanApproved
        | LedgerEventKind::ToolPlanDenied => tool_plan_payload_schema_descriptor(),
        LedgerEventKind::ToolIntentParsed => tool_intent_parsed_payload_schema_descriptor(),
        LedgerEventKind::ToolIntentRejected => tool_intent_rejected_payload_schema_descriptor(),
        LedgerEventKind::ToolIntentPermissionChecked
        | LedgerEventKind::ToolIntentApproved
        | LedgerEventKind::ToolIntentDenied => tool_intent_payload_schema_descriptor(),
        LedgerEventKind::ToolExecutionRequested => {
            tool_execution_requested_payload_schema_descriptor()
        }
        LedgerEventKind::McpToolExecutionApproved => {
            mcp_tool_execution_approved_payload_schema_descriptor()
        }
        LedgerEventKind::ToolExecutionPermissionChecked => {
            tool_execution_permission_payload_schema_descriptor()
        }
        LedgerEventKind::ToolExecutionCompleted => {
            tool_execution_terminal_payload_schema_descriptor("Completed")
        }
        LedgerEventKind::ToolExecutionDenied => {
            tool_execution_terminal_payload_schema_descriptor("Denied")
        }
        LedgerEventKind::ToolExecutionFailed => {
            tool_execution_terminal_payload_schema_descriptor("Failed")
        }
        LedgerEventKind::CodebaseIndexPermissionChecked => {
            codebase_index_permission_payload_schema_descriptor()
        }
        LedgerEventKind::CodebaseIndexSnapshotBuilt => {
            codebase_index_snapshot_built_payload_schema_descriptor()
        }
        LedgerEventKind::CodebaseIndexQueryCompleted => {
            codebase_index_query_completed_payload_schema_descriptor()
        }
        LedgerEventKind::CodebaseIndexSelectionReadCompleted => {
            codebase_index_selection_read_completed_payload_schema_descriptor()
        }
        LedgerEventKind::CodebaseIndexPromptContextMaterialized => {
            codebase_index_prompt_context_materialized_payload_schema_descriptor()
        }
        LedgerEventKind::VerificationRecoveryContextReadMaterialized => {
            verification_recovery_context_read_payload_schema_descriptor()
        }
        LedgerEventKind::AgentLoopStarted => agent_loop_started_payload_schema_descriptor(),
        LedgerEventKind::AgentLoopCompleted => agent_loop_completed_payload_schema_descriptor(),
        LedgerEventKind::TaskCompletionAccepted => {
            task_completion_accepted_payload_schema_descriptor()
        }
        LedgerEventKind::PromptBuilt | LedgerEventKind::SecondPassPromptBuilt => {
            prompt_built_payload_schema_descriptor()
        }
        LedgerEventKind::PromptSensitiveScanCompleted
        | LedgerEventKind::PromptSensitiveScanFailed => {
            prompt_sensitive_scan_payload_schema_descriptor()
        }
        LedgerEventKind::LlmRequestCreated | LedgerEventKind::SecondPassLlmRequestCreated => {
            llm_request_created_payload_schema_descriptor()
        }
        LedgerEventKind::LlmRequestFailed | LedgerEventKind::SecondPassLlmRequestFailed => {
            llm_request_failed_payload_schema_descriptor()
        }
        LedgerEventKind::LlmResponseReceived | LedgerEventKind::SecondPassLlmResponseReceived => {
            llm_response_received_payload_schema_descriptor()
        }
        LedgerEventKind::TaskStarted => task_started_payload_schema_descriptor(),
        LedgerEventKind::TaskRunning => task_running_payload_schema_descriptor(),
        LedgerEventKind::ModeResolved => mode_resolved_payload_schema_descriptor(),
        LedgerEventKind::ExternalModePackChildProvenanceDenied => {
            external_modepack_child_denied_payload_schema_descriptor()
        }
        LedgerEventKind::ExternalModePackTaskProvenanceDenied => {
            external_modepack_task_denied_payload_schema_descriptor()
        }
        LedgerEventKind::SubtaskOrchestrationQueued => {
            subtask_orchestration_queued_payload_schema_descriptor()
        }
        LedgerEventKind::SubtaskHandoffPrepared => subtask_handoff_prepared_payload_schema_descriptor(),
        LedgerEventKind::SubtaskSchedulerReadinessRecorded => {
            subtask_scheduler_readiness_payload_schema_descriptor()
        }
        LedgerEventKind::SubtaskDispatchPlanPrepared => {
            subtask_dispatch_plan_payload_schema_descriptor()
        }
        LedgerEventKind::SubtaskDispatchContractPrepared => {
            subtask_dispatch_contract_payload_schema_descriptor()
        }
        LedgerEventKind::SubtaskDispatchAdmissionEvaluated => {
            subtask_dispatch_admission_payload_schema_descriptor()
        }
        LedgerEventKind::SubtaskDispatchReadinessSnapshotRecorded => {
            subtask_dispatch_readiness_snapshot_payload_schema_descriptor()
        }
        LedgerEventKind::SubtaskDispatcherGuardVerdictRecorded => {
            subtask_dispatcher_guard_verdict_payload_schema_descriptor()
        }
        LedgerEventKind::SubtaskDispatchDecisionRecorded => {
            subtask_dispatch_decision_payload_schema_descriptor()
        }
        LedgerEventKind::SubtaskDispatchCandidateManifestRecorded => {
            subtask_dispatch_candidate_manifest_payload_schema_descriptor()
        }
        LedgerEventKind::SubtaskDispatchHandoffEnvelopeRecorded => {
            subtask_dispatch_handoff_envelope_payload_schema_descriptor()
        }
        LedgerEventKind::ParentJoinContinuationFingerprintConsumed => {
            parent_join_continuation_consumed_payload_schema_descriptor()
        }
        LedgerEventKind::WorkspacePatchProposed => {
            workspace_patch_proposed_payload_schema_descriptor()
        }
        LedgerEventKind::WorkspacePatchApprovalRequested => {
            workspace_patch_approval_requested_payload_schema_descriptor()
        }
        LedgerEventKind::WorkspacePatchApproved => {
            workspace_patch_approved_payload_schema_descriptor()
        }
        LedgerEventKind::WorkspacePatchRejected => {
            workspace_patch_rejected_payload_schema_descriptor()
        }
        LedgerEventKind::WorkspacePatchPreflightSnapshotCreated => {
            workspace_patch_preflight_snapshot_payload_schema_descriptor()
        }
        LedgerEventKind::WorkspacePatchApplyPlanCreated => {
            workspace_patch_apply_plan_payload_schema_descriptor()
        }
        LedgerEventKind::WorkspacePatchApplyCapabilityChecked => {
            workspace_patch_apply_capability_payload_schema_descriptor()
        }
        LedgerEventKind::WorkspacePatchApplyDryRunChecked => {
            workspace_patch_apply_dry_run_payload_schema_descriptor()
        }
        LedgerEventKind::WorkspacePatchApplyResultRecorded => {
            workspace_patch_apply_result_payload_schema_descriptor()
        }
        LedgerEventKind::WorkspacePatchReadinessReportCreated => {
            workspace_patch_readiness_report_payload_schema_descriptor()
        }
        _ => "versioned_open{schema_contract:event-kind-versioned-payload;typed_schema_required_before_release:true}".to_string(),
    }
}

fn terminal_task_payload_schema_descriptor(status: &str) -> String {
    format!(
        "strict_typed{{payload_optional:true;known_optional_fields:apply_enabled:boolean,bounded_cargo_diagnostics:array,caller_authorized:boolean,cancel_fingerprint:string,cancel_id:string,cancel_status:string,completion_evidence:object,expected_task_updated_at:string,failed_verifier_count:u64,failed_verifier_tool_ids:array<string>,failure_fingerprint:string,failure_reason:string,failure_reasons:array<string>,git:object,late_tool_response:boolean,mcp:object,missing_verifier_tool_ids:array<string>,next_action:string,passed_verifier_count:u64,passed_verifier_tool_ids:array<string>,previous_status:string,proposal_count:u64,proposal_id:string,reason:string,recovery_run_id:string,recovery_task_id:string,request_fingerprint_version:string,required_verifier_count:u64,required_verifier_tool_ids:array<string>,requirement_fingerprint:string,run_id:string,runtime_deadline:object,source_apply_id:string,source_run_id:string,source_task_id:string,status:string,task_id:string,terminal_evidence:boolean,terminal_process_loss:boolean,terminal_race_candidate:string,verification_completion_gate_status:string,verification_recovery_repair:boolean,verification_recovery_repair_gate_status:string,verification_requirement_fingerprint:string,verification_requirement_id:string,verification_requirement_source_kind:string;known_field_required:true;additional_fields:false;terminal_status:{status}}}"
    )
}

fn permission_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:allowed:boolean,mode_id:string,reason:string;one_of_required:action:string|required_action:string;known_optional_fields:action:string,apply_id:string,operation:string,path:string,proposal_id:string,required_action:string,scope:string,tool_id:string,workspace_write_scope_count:u64;additional_fields:false;permission_decision_payload:true}".to_string()
}

fn tool_plan_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:allowed:boolean,reason:string,required_action:string,tool_id:string;additional_fields:false;tool_plan_decision_payload:true}".to_string()
}

fn tool_planned_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:tool_ids:array<string>;additional_fields:false;tool_planned_inventory_payload:true}".to_string()
}

fn tool_intent_parsed_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:parser:object,tool_ids:array<string>;additional_fields:false;tool_intent_parsed_payload:true}".to_string()
}

fn tool_intent_rejected_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:code:string,reason:string,tool_id:string;additional_fields:false;tool_intent_rejected_payload:true}".to_string()
}

fn tool_intent_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:allowed:boolean,input_summary:object,reason:string,request_reason:string,required_action:string,tool_id:string;known_optional_fields:mode_id:string,requested_mode_id:string,source_apply_id:string,source_run_id:string,source_task_id:string,verification_recovery_retry:boolean,verification_requirement_fingerprint:string,verification_requirement_id:string,verification_requirement_source_kind:string;additional_fields:false;tool_intent_decision_payload:true}".to_string()
}

fn tool_execution_requested_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:input_summary:object,tool_id:string;known_optional_fields:request_fingerprint:string,source_apply_id:string,verification_recovery_retry:boolean,verification_requirement_fingerprint:string,verification_requirement_id:string,verification_requirement_source_kind:string;additional_fields:false;tool_execution_request_payload:true}".to_string()
}

fn tool_execution_permission_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:allowed:boolean,reason:string,required_action:string,tool_id:string;known_optional_fields:mcp_safety_policy:object_or_null,request_fingerprint:string,server_id:string,source_apply_id:string,tool_name:string,verification_recovery_retry:boolean,verification_requirement_fingerprint:string,verification_requirement_id:string,verification_requirement_source_kind:string;additional_fields:false;tool_execution_permission_payload:true}".to_string()
}

fn mcp_tool_execution_approved_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:approval_fingerprint:string,approval_schema_version:u64,approval_state_fingerprint:string,catalog_provenance:object,mcp_safety_policy:object_or_null,request_fingerprint:string,run_id:string,server_id:string,status:string,task_id:string,tool_id:string,tool_name:string;known_optional_fields:approval_id_fingerprint:string,outcome:string,outcome_fingerprint:string,recovery_fingerprint:string,recovery_reason:string,recovery_source_state_fingerprint:string;additional_fields:false;mcp_tool_execution_approval_payload:true}".to_string()
}

fn tool_execution_terminal_payload_schema_descriptor(status: &str) -> String {
    let required_fields = match status {
        "Completed" => "required_fields:status:string,tool_id:string",
        _ => "required_fields:reason:string,status:string,tool_id:string",
    };
    format!(
        "strict_typed{{payload_optional:false;{required_fields};known_optional_fields:absolute_paths_redacted:boolean,ambient_index_ignored:boolean,authorized_change_set_fingerprint:string,authorized_path_count:u64,bounded_cargo_diagnostics:array,bytes_read:u64,captured_bytes:u64,cargo_dependency_fetch_offline:boolean,catalog_provenance:object,check_id:string,cleanup_succeeded:boolean,commit_id:string,committed_tree_fingerprint:string,compile_time_code_sandboxed:boolean,duration_ms:u64,exit_code:integer_or_null,expected_parent_head:string,failed_git_operation:string,git:object,git_environment_hardened:boolean,git_optional_locks_disabled:boolean,git_process_count:u64,git_processes_bounded:boolean,git_prompts_disabled:boolean,line_count:u64,logical_invocation_fingerprint:string,mcp:object,mcp_approval_binding:object,mcp_safety_policy:object_or_null,message_fingerprint:string,mutation_process_launched:boolean,operation:string,os_network_isolated:boolean,output_oversized:boolean,output_preview:string,output_redacted:boolean,output_truncated:boolean,process_launched:boolean,process_tree_kill_attempted:boolean,process_tree_kill_reason:string,process_tree_kill_succeeded:boolean,process_tree_timeout_supported:boolean,raw_diff_redacted:boolean,raw_file_content_redacted:boolean,raw_message_redacted:boolean,reason:string,reader_thread_joined:boolean,replayed:boolean,repository_hooks_bypassed:boolean,runtime_authorization_required:boolean,source_apply_id:string,standard_error_bytes:u64,standard_error_truncated:boolean,standard_output_bytes:u64,standard_output_truncated:boolean,target_dir_isolated:boolean,temporary_index_cleaned:boolean,test_code_executed:boolean,timed_out:boolean,truncated:boolean,trusted_workspace_required:boolean,used_git_plumbing:boolean,used_temporary_index:boolean,verification_recovery_retry:boolean,verification_requirement_fingerprint:string,verification_requirement_id:string,verification_requirement_source_kind:string,verification_status:string,workspace_write_scope_fingerprint:string;additional_fields:false;tool_execution_terminal_payload:true;terminal_status:{status}}}"
    )
}

fn codebase_index_permission_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:action:string,allowed:boolean,mode_id:string,reason:string;known_optional_fields:entry_count:u64,file_kind_filter:string,index_id:string,max_results:u64,query_fingerprint:string,query_id:string,query_length_chars:u64,query_token_count:u64,request_kind:string,requested_force_refresh:boolean,requested_root_present:boolean,selection_fingerprint:string,selection_id:string,snapshot_fingerprint:string,workspace_fingerprint:string;additional_fields:false;codebase_index_permission_payload:true;action:IndexCodebase}".to_string()
}

fn codebase_index_snapshot_built_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:built_at:string,ignore_rule_count:u64,ignore_rule_files_loaded:u64,index_id:string,indexed_files:u64,max_directories:u64,max_directory_entries:u64,max_file_bytes:u64,max_files:u64,max_path_chars:u64,max_visited_entries:u64,mode_id:string,next_action:string,requested_force_refresh:boolean,root:string,sensitive_finding_count:u64,skipped_binary_like:u64,skipped_ignored:u64,skipped_other:u64,skipped_protected:u64,skipped_sensitive:u64,skipped_symlink:u64,skipped_too_large:u64,skipped_unreadable:u64,skipped_unsafe_path:u64,snapshot_fingerprint:string,truncated:boolean,truncated_directories:u64,truncated_entries:u64,visited_entries:u64,walked_directories:u64,workspace_fingerprint:string;additional_fields:false;codebase_index_snapshot_payload:true;next_action:build_bounded_index_query_file_selection}".to_string()
}

fn codebase_index_query_completed_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:file_kind_filter:string,index_id:string,match_reason_counts:object,matched_entry_count:u64,max_results:u64,mode_id:string,next_action:string,query_fingerprint:string,query_id:string,returned_entry_count:u64,selection_fingerprint:string,selection_id:string,skipped_entry_count:u64,snapshot_fingerprint:string,snapshot_truncated:boolean,workspace_fingerprint:string;additional_fields:false;codebase_index_query_payload:true;next_action:read_selected_files_with_controlled_workspace_read}".to_string()
}

fn codebase_index_selection_read_completed_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:byte_length:u64,bytes_read:u64,content_hash_verified:boolean,content_sha256:string,entry_count:u64,file_kind:string,file_kind_filter:string,index_id:string,max_results:u64,mode_id:string,next_action:string,query_fingerprint:string,query_id:string,read_path_fingerprint:string,selection_fingerprint:string,selection_id:string,snapshot_fingerprint:string,snapshot_truncated:boolean,tool_id:string,truncated:boolean,workspace_fingerprint:string;additional_fields:false;codebase_index_selection_read_payload:true;tool_id:codebase.index.selection.read;content_hash_verified:true;next_action:use_selected_file_context_for_prompt_materialization}".to_string()
}

fn codebase_index_prompt_context_materialized_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:bytes_read:u64,content_char_count:u64,content_hash_verified:boolean,content_sha256:string,file_kind:string,index_id:string,mode_id:string,next_action:string,prompt_context_id:string,prompt_preview_redacted:boolean,query_fingerprint:string,query_id:string,read_path_fingerprint:string,run_id:string,selection_fingerprint:string,selection_id:string,snapshot_fingerprint:string,source_event_id:string,source_event_kind:string,task_id:string,workspace_fingerprint:string;additional_fields:false;codebase_index_prompt_context_payload:true;source_event_kind:CodebaseIndexSelectionReadCompleted;content_hash_verified:true;prompt_preview_redacted:true;next_action:continue_task_execution_with_materialized_context}".to_string()
}

fn verification_recovery_context_read_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:check_id:string,column:u64_or_null,context_read_id:string,diagnostic_index:u64,diagnostic_kind:string,excerpt_bytes:u64,excerpt_end_line:u64,excerpt_sha256:string,excerpt_start_line:u64,excerpt_truncated:boolean,failure_fingerprint:string,line:u64_or_null,mode_id:string,next_action:string,prompt_preview_redacted:boolean,read_path_fingerprint:string,recovery_run_id:string,recovery_task_id:string,required_action:string,severity:string,source_run_id:string,source_task_id:string,test_name_hash:string_or_null,tool_id:string,verification_recovery_context_read:boolean;additional_fields:false;verification_recovery_context_read_payload:true;required_action:ReadWorkspace;verification_recovery_context_read:true;prompt_preview_redacted:true;next_action:run_recovery_task_with_context}".to_string()
}

fn agent_loop_started_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:entrypoint:string,state:string;known_optional_fields:verification_recovery_retry:boolean;additional_fields:false;agent_loop_started_payload:true}".to_string()
}

fn agent_loop_completed_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:completion_summary:string,final_state:string;known_optional_fields:completion_result_fingerprint:string,final_response_chars:u64,final_response_present:boolean,verification_recovery_retry:boolean;additional_fields:false;agent_loop_completed_payload:true}".to_string()
}

fn task_completion_accepted_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:acceptance_fingerprint:string,acceptance_id:string,next_action:string,replayed:boolean,run_id:string,status:string,task_id:string,terminal_completion_fingerprint:string,verifier_gate_status:string;additional_fields:false;task_completion_accepted_payload:true;status:AcceptedComplete;next_action:inspect_accepted_completion}".to_string()
}

fn prompt_built_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;known_optional_fields:context_budget_max_ledger_events:u64,context_budget_max_prompt_chars:u64,context_budget_max_selected_index_chars:u64,context_budget_prompt_chars:u64,context_budget_prompt_within_budget:boolean,context_budget_protected_context_chars:u64,context_budget_requested:boolean,context_budget_selected_index_content_chars:u64,context_budget_selected_index_context_present:boolean,context_budget_selected_index_materialized_chars:u64,context_budget_selected_index_truncated:boolean,context_first_included_event:string,context_included_events:u64,context_last_included_event:string,context_max_events:u64,context_omitted_events:u64,context_total_events:u64,context_window_bounded:boolean,max_prompt_chars:u64,message_count:u64,prompt_preview:string,prompt_preview_redacted:boolean,prompt_preview_redaction_reason:string;known_field_required:true;additional_fields:false;prompt_built_payload:true}".to_string()
}

fn prompt_sensitive_scan_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:categories:array<string>,finding_count:u64,message_indexes:array<u64>,mode:string,sensitive_guard:string;additional_fields:false;prompt_sensitive_scan_payload:true}".to_string()
}

fn llm_request_created_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:base_url:string_or_null,message_count:u64,model:string,provider:string,strict:boolean;additional_fields:false;llm_request_created_payload:true}".to_string()
}

fn llm_request_failed_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;known_optional_fields:base_url:string_or_null,llm_provider_failure:object,model:string,provider:string,reason:string,reason_chars:u64,reason_sha256:string,reason_truncated:boolean,sensitive_guard:string,strict:boolean;known_field_required:true;additional_fields:false;llm_request_failed_payload:true}".to_string()
}

fn llm_response_received_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:provider:string;one_of_required:content_preview:string|content_preview_redacted:boolean;known_optional_fields:content_preview:string,content_preview_redacted:boolean,content_preview_redaction_reason:string,response_preview_chars:u64;additional_fields:false;llm_response_received_payload:true}".to_string()
}

fn task_started_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:true;known_optional_fields:apply_fingerprint:string_or_null,apply_id:string_or_null,decision_fingerprint:string_or_null,derived_goal_fingerprint:string_or_null,derived_objective_fingerprint:string_or_null,drive_fingerprint:string_or_null,end_session_sequence:u64_or_null,execution_enabled:boolean,external_modepack_child_provenance:object_or_null,failure_class:string_or_null,failure_fingerprint:string_or_null,llm_provider_failure_retry_provenance:object_or_null,next_action:string,next_route_fingerprint:string_or_null,parent_run_id:string_or_null,parent_task_id:string_or_null,patch_apply_recovery_provenance:object_or_null,product_continuation_provenance:object_or_null,product_continuation_running_enabled:boolean,product_evidence_fingerprint:string_or_null,product_loop_stop_recovery_provenance:object_or_null,product_loop_stop_recovery_running_enabled:boolean,product_objective_continuation_provenance:object_or_null,proposal_id:string_or_null,reason:string,recovery_boundary_fingerprint:string_or_null,recovery_cycle_provenance:object_or_null,recovery_run_id:string_or_null,recovery_running_enabled:boolean,recovery_task_id:string_or_null,retried_verifier_tool_ids:array_or_null,retry_running_enabled:boolean,retryable:boolean_or_null,scheduler_handoff_enabled:boolean,source_apply_id:string_or_null,source_candidate_id:string_or_null,source_decision_id:string_or_null,source_drive_id:string_or_null,source_handoff_envelope_fingerprint:string_or_null,source_handoff_envelope_id:string_or_null,source_intent_summary:object_or_null,source_progress_fingerprint:string_or_null,source_proposal_id:string_or_null,source_run_id:string_or_null,source_session_id:string_or_null,source_task_id:string_or_null,status:string,stop_class:string_or_null,stop_reason:string_or_null,verification_recovery_provenance:object_or_null,verification_recovery_retry_provenance:object_or_null;known_field_required:true;additional_fields:false;task_started_payload:true}".to_string()
}

fn task_running_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:true;known_optional_fields:admission_id:string,admission_kind:string,deadline_persisted:boolean,deadline_scope:string,reason:string,runtime_deadline:object;known_field_required:true;conditional_required:runtime_deadline=>deadline_scope+deadline_persisted,admission_id|admission_kind=>admission_id+admission_kind+reason;additional_fields:false;task_running_payload:true}".to_string()
}

fn mode_resolved_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:completion_rules:array,display_name:string,instruction_fingerprint:string_or_null,mcp_access:array,mode_id:string,permissions:object,prompt_sections:array,role_definition:string,workspace_write_scopes:array;known_optional_fields:allowed_handoff_targets:array_or_null,description:string_or_null,external_modepack_task_provenance:object,mcp_tool_catalogs:array,verification_responsibility:string_or_null,when_to_use:string_or_null;additional_fields:false;mode_resolved_payload:true}".to_string()
}

fn external_modepack_child_denied_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:reason:string,run_id:string,status:string,task_id:string;known_optional_fields:mode_id:string_or_null,parent_run_id:string_or_null,source_candidate_id:string_or_null,source_handoff_envelope_fingerprint:string_or_null,source_handoff_envelope_id:string_or_null;additional_fields:false;external_modepack_child_provenance_denied_payload:true;status:Denied}".to_string()
}

fn external_modepack_task_denied_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:reason:string,run_id:string,source_kind:string,source_path:string,status:string,task_id:string;known_optional_fields:mode_id:string_or_null;additional_fields:false;external_modepack_task_provenance_denied_payload:true;status:Denied}".to_string()
}

fn subtask_orchestration_queued_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:execution_enabled:boolean,input_summary:object,parent_run_id:string,parent_task_id:string,queue_position:u64,reason:string,request_reason:string,required_action:string,status:string,subtask_id:string,tool_id:string;known_optional_fields:requested_goal_preview:string,requested_mode_id:string;additional_fields:false;subtask_orchestration_payload:true}".to_string()
}

fn subtask_handoff_prepared_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:execution_enabled:boolean,handoff_id:string,next_action:string,parent_run_id:string,parent_task_id:string,queued_count:u64,queued_subtask_ids:array<string>,reason:string,source_event_count:u64,status:string;additional_fields:false;subtask_handoff_prepared_payload:true}".to_string()
}

fn subtask_scheduler_readiness_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:blocked_checks:array<string>,check_count:u64,dispatch_enabled:boolean,execution_enabled:boolean,handoff_count:u64,handoff_id:string,next_action:string,parent_run_id:string,parent_task_id:string,queued_count:u64,readiness_id:string,readiness_reason:string,readiness_status:string,reason:string,source_event_count:u64,status:string;additional_fields:false;subtask_scheduler_readiness_payload:true}".to_string()
}

fn subtask_dispatch_plan_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:blocked_checks:array<string>,check_count:u64,dispatch_enabled:boolean,dispatch_plan_status:string,dispatch_reason:string,execution_enabled:boolean,next_action:string,parent_run_id:string,parent_task_id:string,plan_id:string,queued_count:u64,readiness_count:u64,readiness_id:string,reason:string,required_capability:string,source_event_count:u64,status:string;additional_fields:false;subtask_dispatch_plan_payload:true}".to_string()
}

fn subtask_dispatch_contract_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:blocked_checks:array<string>,check_count:u64,contract_id:string,dispatch_contract_reason:string,dispatch_contract_status:string,dispatch_enabled:boolean,eligibility_status:string,execution_enabled:boolean,next_action:string,parent_run_id:string,parent_task_id:string,plan_count:u64,plan_id:string,queued_count:u64,reason:string,required_capability:string,required_preconditions:array<string>,source_event_count:u64,status:string;additional_fields:false;subtask_dispatch_contract_payload:true}".to_string()
}

fn subtask_dispatch_admission_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:admission_id:string,admission_reason:string,admission_status:string,blocked_checks:array<string>,blocked_preconditions:array<string>,check_count:u64,contract_count:u64,contract_id:string,dispatch_enabled:boolean,execution_enabled:boolean,execution_gate_status:string,next_action:string,parent_run_id:string,parent_task_id:string,precondition_count:u64,queued_count:u64,reason:string,required_capability:string,satisfied_precondition_count:u64,source_event_count:u64,status:string;additional_fields:false;subtask_dispatch_admission_payload:true}".to_string()
}

fn subtask_dispatch_readiness_snapshot_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:admission_count:u64,admission_id:string,blocked_checks:array<string>,blocked_preconditions:array<string>,check_count:u64,dispatch_enabled:boolean,execution_enabled:boolean,fingerprint_input_count:u64,next_action:string,parent_run_id:string,parent_task_id:string,precondition_count:u64,queued_count:u64,readiness_fingerprint:string,readiness_reason:string,readiness_status:string,reason:string,required_capability:string,satisfied_precondition_count:u64,scheduler_handoff_status:string,snapshot_id:string,source_event_count:u64,status:string;additional_fields:false;subtask_dispatch_readiness_snapshot_payload:true}".to_string()
}

fn subtask_dispatcher_guard_verdict_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:blocked_checks:array<string>,blocked_preconditions:array<string>,check_count:u64,dispatch_enabled:boolean,execution_enabled:boolean,fingerprint_input_count:u64,guard_id:string,guard_reason:string,guard_status:string,handoff_preflight_status:string,next_action:string,parent_run_id:string,parent_task_id:string,precondition_count:u64,queued_count:u64,reason:string,required_capability:string,satisfied_precondition_count:u64,scheduler_handoff_status:string,snapshot_count:u64,snapshot_fingerprint:string,snapshot_fingerprint_count:u64,snapshot_id:string,snapshot_validity_status:string,source_event_count:u64,status:string;additional_fields:false;subtask_dispatcher_guard_verdict_payload:true}".to_string()
}

fn subtask_dispatch_decision_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:blocked_candidate_count:u64,blocked_checks:array<string>,blocked_preconditions:array<string>,candidate_status:string,check_count:u64,decision_id:string,decision_status:string,dispatch_candidate_count:u64,dispatch_decision:string,dispatch_denial_reason:string,dispatch_enabled:boolean,eligible_candidate_count:u64,execution_enabled:boolean,fingerprint_input_count:u64,guard_count:u64,guard_id:string,guard_status:string,handoff_preflight_status:string,next_action:string,parent_run_id:string,parent_task_id:string,precondition_count:u64,queued_count:u64,reason:string,required_capability:string,satisfied_precondition_count:u64,snapshot_fingerprint:string,snapshot_fingerprint_count:u64,snapshot_id:string,snapshot_validity_status:string,source_event_count:u64,status:string;additional_fields:false;subtask_dispatch_decision_payload:true}".to_string()
}

fn subtask_dispatch_candidate_manifest_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:blocked_candidate_count:u64,blocked_candidate_ids:array<string>,blocked_checks:array<string>,blocked_preconditions:array<string>,candidate_count:u64,candidate_denial_reason:string,candidate_ids:array<string>,candidate_manifest_fingerprint:string,candidate_status:string,check_count:u64,decision_count:u64,decision_id:string,dispatch_candidate_count:u64,dispatch_decision:string,dispatch_enabled:boolean,eligible_candidate_count:u64,eligible_candidate_ids:array<string>,execution_enabled:boolean,fingerprint_input_count:u64,guard_id:string,manifest_id:string,manifest_status:string,next_action:string,parent_run_id:string,parent_task_id:string,precondition_count:u64,queued_count:u64,reason:string,required_capability:string,satisfied_precondition_count:u64,snapshot_fingerprint:string,snapshot_id:string,source_event_count:u64,status:string;additional_fields:false;subtask_dispatch_candidate_manifest_payload:true}".to_string()
}

fn subtask_dispatch_handoff_envelope_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:blocked_candidate_count:u64,blocked_candidate_ids:array<string>,candidate_count:u64,candidate_ids:array<string>,candidate_status:string,dispatch_decision:string,dispatch_enabled:boolean,eligible_candidate_count:u64,eligible_candidate_ids:array<string>,execution_enabled:boolean,fingerprint_input_count:u64,handoff_envelope_fingerprint:string,handoff_envelope_id:string,handoff_envelope_status:string,next_action:string,parent_run_id:string,parent_task_id:string,reason:string,required_capability:string,scheduler_handoff_status:string,status:string;known_optional_fields:blocked_checks:array<string>,blocked_preconditions:array<string>,candidate_denial_reason:string,candidate_manifest_fingerprint:string,check_count:u64,continuation_materialization:boolean,continuation_source:string,decision_id:string,dispatch_candidate_count:u64,handoff_ticket_count:u64,handoff_ticket_status:string,manifest_count:u64,manifest_id:string,max_recovery_cycle_depth:u64,parent_join_admission_id:string,parent_join_child_completion_child_count:u64,parent_join_child_completion_fingerprint:string,parent_join_fingerprint_input_count:u64,parent_join_recovery_cycle:boolean,parent_join_recovery_cycle_depth:u64,parent_join_terminal_completed_child_count:u64,parent_join_terminal_failed_child_count:u64,precondition_count:u64,queued_count:u64,recovery_cycle_budget_status:string,replay_guard_reason:string,replay_guard_status:string,satisfied_precondition_count:u64,source_event_count:u64;additional_fields:false;subtask_dispatch_handoff_envelope_payload:true}".to_string()
}

fn parent_join_continuation_consumed_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:admission_id:string,child_completion_child_count:u64,child_completion_fingerprint:string,child_recovery_cycle_depth:u64,child_terminal_completed_count:u64,child_terminal_failed_count:u64,fingerprint_input_count:u64,parent_join_continuation_status:string,reason:string;additional_fields:false;parent_join_continuation_consumed_payload:true}".to_string()
}

fn workspace_patch_proposed_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:content_chars:u64,content_preview:string,diff_preview:string_or_null,diff_redacted:boolean,diff_truncated:boolean,operation:string,path:string,proposal_id:string,tool_id:string,truncated:boolean,validation_reason:string_or_null,validation_status:string;known_optional_fields:failed_verifier_tool_ids:array<string>,failure_class:string,failure_fingerprint:string,hunk_count:u64,hunk_fingerprint:string,patch_apply_recovery_repair:boolean,recovery_run_id:string,recovery_task_id:string,source_apply_fingerprint:string,source_apply_id:string,source_hunk_count:u64,source_hunk_fingerprint:string,source_operation:string,source_path:string,source_proposal_id:string,source_run_id:string,source_task_id:string,verification_recovery_repair:boolean;additional_fields:false;workspace_patch_proposed_payload:true}".to_string()
}

fn workspace_patch_approval_requested_payload_schema_descriptor() -> String {
    "payload_absent{payload_optional:false;workspace_patch_approval_requested_payload_absent:true}"
        .to_string()
}

fn workspace_patch_approved_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:approval_reason:string_or_null,approval_reason_redacted:boolean,approval_status:string,approved_at:string,proposal_id:string;known_optional_fields:rejected_at:string;additional_fields:false;workspace_patch_approved_payload:true;approval_status:Approved}".to_string()
}

fn workspace_patch_rejected_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:approval_reason:string_or_null,approval_reason_redacted:boolean,approval_status:string,proposal_id:string,rejected_at:string;known_optional_fields:approved_at:string;additional_fields:false;workspace_patch_rejected_payload:true;approval_status:Rejected}".to_string()
}

fn workspace_patch_preflight_snapshot_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:canonical_path_hash:string,captured_at:string,file_exists:boolean,file_kind:string,file_modified_unix_ms:integer_or_null,file_sha256:string_or_null,file_size_bytes:u64_or_null,path:string,proposal_id:string,snapshot_id:string,stale:boolean,stale_reason:string_or_null;additional_fields:false;workspace_patch_preflight_snapshot_payload:true}".to_string()
}

fn workspace_patch_apply_plan_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:check_count:u64,failed_checks:array<string>,operation:string,plan_id:string,proposal_id:string,status:string;additional_fields:false;workspace_patch_apply_plan_payload:true}".to_string()
}

fn workspace_patch_apply_capability_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:apply_enabled:boolean,apply_supported:boolean,blocked_checks:array<string>,can_apply_now:boolean,capability_id:string,check_count:u64,checked_at:string,failed_checks:array<string>,mode:string,proposal_id:string,reason:string,required_gates:array<string>;additional_fields:false;workspace_patch_apply_capability_payload:true}".to_string()
}

fn workspace_patch_apply_dry_run_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:apply_executed:boolean,blocked_checks:array<string>,check_count:u64,checked_at:string,dry_run_id:string,dry_run_reason:string,dry_run_status:string,failed_checks:array<string>,no_patch_applied:boolean,proposal_id:string,required_gates:array<string>,workspace_files_changed:boolean;additional_fields:false;workspace_patch_apply_dry_run_payload:true}".to_string()
}

fn workspace_patch_apply_result_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:applied:boolean,apply_id:string,apply_reason:string,apply_status:string,authorization_consumed:boolean,blocked_checks:array<string>,failed_checks:array<string>,operation:string,path:string,proposal_id:string;known_optional_fields:applied_at:string_or_null,atomic_create_completed:boolean_or_null,atomic_delete_completed:boolean_or_null,atomic_replacement_completed:boolean_or_null,authorization_id:string_or_null,check_count:u64,checked_at:string_or_null,content_bytes:u64,content_chars:u64,expected_target_absent:boolean_or_null,expected_target_sha256:string_or_null,hunk_count:u64,hunk_fingerprint:string_or_null,post_delete_target_exists:boolean_or_null,post_write_sha256:string_or_null,pre_write_target_exists:boolean_or_null,pre_write_target_sha256:string_or_null,temp_file_cleaned:boolean_or_null,transaction_id:string_or_null,transaction_item_count:u64,transaction_items:array,transaction_recovery_source:object,transaction_recovery_status:string_or_null,transaction_status:string_or_null;additional_fields:false;workspace_patch_apply_result_payload:true}".to_string()
}

fn workspace_patch_readiness_report_payload_schema_descriptor() -> String {
    "strict_typed{payload_optional:false;required_fields:blocked_checks:array<string>,check_count:u64,failed_checks:array<string>,fingerprint_input_count:u64,generated_at:string,proposal_id:string,readiness_fingerprint:string,readiness_reason:string_or_null,readiness_status:string,report_id:string;additional_fields:false;workspace_patch_readiness_report_payload:true}".to_string()
}

fn ledger_payload_legacy_schema_descriptor(kind: &LedgerEventKind, schema_version: u64) -> String {
    match kind {
        LedgerEventKind::TaskCompleted
        | LedgerEventKind::TaskFailed
        | LedgerEventKind::TaskCancelled
            if schema_version >= 3 =>
        {
            let status = match kind {
                LedgerEventKind::TaskCompleted => "Completed",
                LedgerEventKind::TaskFailed => "Failed",
                LedgerEventKind::TaskCancelled => "Cancelled",
                _ => unreachable!(),
            };
            terminal_task_payload_schema_descriptor(status)
        }
        LedgerEventKind::PermissionChecked | LedgerEventKind::PermissionDenied
            if schema_version >= 4 =>
        {
            permission_payload_schema_descriptor()
        }
        LedgerEventKind::ToolPlanned if schema_version >= 10 => {
            tool_planned_payload_schema_descriptor()
        }
        LedgerEventKind::ToolPermissionChecked
        | LedgerEventKind::ToolPlanApproved
        | LedgerEventKind::ToolPlanDenied
            if schema_version >= 5 =>
        {
            tool_plan_payload_schema_descriptor()
        }
        LedgerEventKind::ToolIntentParsed if schema_version >= 10 => {
            tool_intent_parsed_payload_schema_descriptor()
        }
        LedgerEventKind::ToolIntentRejected if schema_version >= 10 => {
            tool_intent_rejected_payload_schema_descriptor()
        }
        LedgerEventKind::ToolIntentPermissionChecked
        | LedgerEventKind::ToolIntentApproved
        | LedgerEventKind::ToolIntentDenied
            if schema_version >= 5 =>
        {
            tool_intent_payload_schema_descriptor()
        }
        LedgerEventKind::ToolExecutionRequested if schema_version >= 5 => {
            tool_execution_requested_payload_schema_descriptor()
        }
        LedgerEventKind::ToolExecutionPermissionChecked if schema_version >= 5 => {
            tool_execution_permission_payload_schema_descriptor()
        }
        LedgerEventKind::ToolExecutionDenied if schema_version >= 5 => {
            tool_execution_terminal_payload_schema_descriptor("Denied")
        }
        LedgerEventKind::McpToolExecutionApproved if schema_version >= 6 => {
            mcp_tool_execution_approved_payload_schema_descriptor()
        }
        LedgerEventKind::ToolExecutionCompleted if schema_version >= 6 => {
            tool_execution_terminal_payload_schema_descriptor("Completed")
        }
        LedgerEventKind::ToolExecutionFailed if schema_version >= 6 => {
            tool_execution_terminal_payload_schema_descriptor("Failed")
        }
        LedgerEventKind::CodebaseIndexPermissionChecked if schema_version >= 7 => {
            codebase_index_permission_payload_schema_descriptor()
        }
        LedgerEventKind::CodebaseIndexSnapshotBuilt if schema_version >= 7 => {
            codebase_index_snapshot_built_payload_schema_descriptor()
        }
        LedgerEventKind::CodebaseIndexQueryCompleted if schema_version >= 7 => {
            codebase_index_query_completed_payload_schema_descriptor()
        }
        LedgerEventKind::CodebaseIndexSelectionReadCompleted if schema_version >= 7 => {
            codebase_index_selection_read_completed_payload_schema_descriptor()
        }
        LedgerEventKind::CodebaseIndexPromptContextMaterialized if schema_version >= 7 => {
            codebase_index_prompt_context_materialized_payload_schema_descriptor()
        }
        LedgerEventKind::VerificationRecoveryContextReadMaterialized if schema_version >= 7 => {
            verification_recovery_context_read_payload_schema_descriptor()
        }
        LedgerEventKind::AgentLoopStarted if schema_version >= 8 => {
            agent_loop_started_payload_schema_descriptor()
        }
        LedgerEventKind::AgentLoopCompleted if schema_version >= 8 => {
            agent_loop_completed_payload_schema_descriptor()
        }
        LedgerEventKind::TaskCompletionAccepted if schema_version >= 8 => {
            task_completion_accepted_payload_schema_descriptor()
        }
        LedgerEventKind::PromptBuilt | LedgerEventKind::SecondPassPromptBuilt
            if schema_version >= 8 =>
        {
            prompt_built_payload_schema_descriptor()
        }
        LedgerEventKind::PromptSensitiveScanCompleted | LedgerEventKind::PromptSensitiveScanFailed
            if schema_version >= 8 =>
        {
            prompt_sensitive_scan_payload_schema_descriptor()
        }
        LedgerEventKind::LlmRequestCreated | LedgerEventKind::SecondPassLlmRequestCreated
            if schema_version >= 8 =>
        {
            llm_request_created_payload_schema_descriptor()
        }
        LedgerEventKind::LlmRequestFailed | LedgerEventKind::SecondPassLlmRequestFailed
            if schema_version >= 8 =>
        {
            llm_request_failed_payload_schema_descriptor()
        }
        LedgerEventKind::LlmResponseReceived | LedgerEventKind::SecondPassLlmResponseReceived
            if schema_version >= 8 =>
        {
            llm_response_received_payload_schema_descriptor()
        }
        LedgerEventKind::TaskStarted if schema_version >= 9 => {
            task_started_payload_schema_descriptor()
        }
        LedgerEventKind::TaskRunning if schema_version >= 9 => {
            task_running_payload_schema_descriptor()
        }
        LedgerEventKind::ModeResolved if schema_version >= 9 => {
            mode_resolved_payload_schema_descriptor()
        }
        LedgerEventKind::ExternalModePackChildProvenanceDenied if schema_version >= 9 => {
            external_modepack_child_denied_payload_schema_descriptor()
        }
        LedgerEventKind::ExternalModePackTaskProvenanceDenied if schema_version >= 9 => {
            external_modepack_task_denied_payload_schema_descriptor()
        }
        LedgerEventKind::SubtaskOrchestrationQueued if schema_version >= 11 => {
            subtask_orchestration_queued_payload_schema_descriptor()
        }
        LedgerEventKind::SubtaskHandoffPrepared if schema_version >= 11 => {
            subtask_handoff_prepared_payload_schema_descriptor()
        }
        LedgerEventKind::SubtaskSchedulerReadinessRecorded if schema_version >= 11 => {
            subtask_scheduler_readiness_payload_schema_descriptor()
        }
        LedgerEventKind::SubtaskDispatchPlanPrepared if schema_version >= 11 => {
            subtask_dispatch_plan_payload_schema_descriptor()
        }
        LedgerEventKind::SubtaskDispatchContractPrepared if schema_version >= 11 => {
            subtask_dispatch_contract_payload_schema_descriptor()
        }
        LedgerEventKind::SubtaskDispatchAdmissionEvaluated if schema_version >= 11 => {
            subtask_dispatch_admission_payload_schema_descriptor()
        }
        LedgerEventKind::SubtaskDispatchReadinessSnapshotRecorded if schema_version >= 11 => {
            subtask_dispatch_readiness_snapshot_payload_schema_descriptor()
        }
        LedgerEventKind::SubtaskDispatcherGuardVerdictRecorded if schema_version >= 11 => {
            subtask_dispatcher_guard_verdict_payload_schema_descriptor()
        }
        LedgerEventKind::SubtaskDispatchDecisionRecorded if schema_version >= 11 => {
            subtask_dispatch_decision_payload_schema_descriptor()
        }
        LedgerEventKind::SubtaskDispatchCandidateManifestRecorded if schema_version >= 11 => {
            subtask_dispatch_candidate_manifest_payload_schema_descriptor()
        }
        LedgerEventKind::SubtaskDispatchHandoffEnvelopeRecorded if schema_version >= 11 => {
            subtask_dispatch_handoff_envelope_payload_schema_descriptor()
        }
        LedgerEventKind::ParentJoinContinuationFingerprintConsumed if schema_version >= 11 => {
            parent_join_continuation_consumed_payload_schema_descriptor()
        }
        LedgerEventKind::WorkspacePatchProposed if schema_version >= 12 => {
            workspace_patch_proposed_payload_schema_descriptor()
        }
        LedgerEventKind::WorkspacePatchApprovalRequested if schema_version >= 12 => {
            workspace_patch_approval_requested_payload_schema_descriptor()
        }
        LedgerEventKind::WorkspacePatchApproved if schema_version >= 12 => {
            workspace_patch_approved_payload_schema_descriptor()
        }
        LedgerEventKind::WorkspacePatchRejected if schema_version >= 12 => {
            workspace_patch_rejected_payload_schema_descriptor()
        }
        LedgerEventKind::WorkspacePatchPreflightSnapshotCreated if schema_version >= 12 => {
            workspace_patch_preflight_snapshot_payload_schema_descriptor()
        }
        LedgerEventKind::WorkspacePatchApplyPlanCreated if schema_version >= 12 => {
            workspace_patch_apply_plan_payload_schema_descriptor()
        }
        LedgerEventKind::WorkspacePatchApplyCapabilityChecked if schema_version >= 12 => {
            workspace_patch_apply_capability_payload_schema_descriptor()
        }
        LedgerEventKind::WorkspacePatchApplyDryRunChecked if schema_version >= 12 => {
            workspace_patch_apply_dry_run_payload_schema_descriptor()
        }
        LedgerEventKind::WorkspacePatchApplyResultRecorded if schema_version >= 12 => {
            workspace_patch_apply_result_payload_schema_descriptor()
        }
        LedgerEventKind::WorkspacePatchReadinessReportCreated if schema_version >= 12 => {
            workspace_patch_readiness_report_payload_schema_descriptor()
        }
        LedgerEventKind::TaskCompleted => "typed_known_fields_open{known_optional_fields:completion_evidence:object,git:object,late_tool_response:boolean,mcp:object,runtime_deadline:object,status:string,terminal_process_loss:boolean,terminal_race_candidate:string,verification_completion_gate_status:legacy_open;known_field_required:true;additional_fields:true;strict_typed_payload_required_before_release:true}".to_string(),
        _ => "versioned_open{schema_contract:event-kind-versioned-payload;typed_schema_required_before_release:true}".to_string(),
    }
}

fn ledger_payload_instance_shape_fingerprint_input(
    kind: &LedgerEventKind,
    descriptor: &str,
) -> String {
    format!(
        "{kind:?}:payload_instance_shape_v{LEDGER_PAYLOAD_SCHEMA_VERSION}:descriptor:{descriptor}"
    )
}

fn ledger_payload_legacy_v1_shape_id(kind: &LedgerEventKind) -> String {
    format!("ledger_payload.{kind:?}.v1")
}

fn ledger_payload_legacy_v1_shape_fingerprint_for_value(
    kind: &LedgerEventKind,
    payload: &serde_json::Value,
) -> String {
    stable_ledger_payload_fingerprint(&format!(
        "{kind:?}:payload_shape_v1:descriptor:{}",
        ledger_payload_shape_descriptor(payload)
    ))
}

fn ledger_payload_shape_descriptor(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Bool(_) => "boolean".to_string(),
        serde_json::Value::Number(number) if number.is_i64() || number.is_u64() => {
            "integer".to_string()
        }
        serde_json::Value::Number(_) => "number".to_string(),
        serde_json::Value::String(_) => "string".to_string(),
        serde_json::Value::Array(values) => {
            if values.is_empty() {
                "array<empty>".to_string()
            } else {
                let mut item_shapes = values
                    .iter()
                    .map(ledger_payload_shape_descriptor)
                    .collect::<Vec<_>>();
                item_shapes.sort();
                item_shapes.dedup();
                format!("array<{}>", item_shapes.join("|"))
            }
        }
        serde_json::Value::Object(object) => {
            let fields = object
                .iter()
                .map(|(key, value)| format!("{key}:{}", ledger_payload_shape_descriptor(value)))
                .collect::<Vec<_>>()
                .join(",");
            format!("object{{{fields}}}")
        }
    }
}

fn stable_ledger_payload_fingerprint(input: &str) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in input.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("shape-fnv1a64:{hash:016x}")
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload_envelope: Option<LedgerPayloadEnvelope>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct TerminalTransitionMarker {
    marker_version: u64,
    task_id: String,
    run_id: String,
    expected_status: TaskStatus,
    expected_updated_at: String,
    terminal_status: TaskStatus,
    state_updated_at: String,
    ledger_event: LedgerEvent,
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
    McpToolExecutionApproved,
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
    HeadlessRunProductEvidenceMatrixDerived,
    HeadlessRunSelectedProductGapClosureRecorded,
    HeadlessRunProductCompletionDecisionRecorded,
    HeadlessJourneyStarted,
    HeadlessJourneyRouteResumed,
    HeadlessJourneyClosed,
    HeadlessJourneyExecuted,
    HeadlessRunCompletionFinalized,
    TaskRunning,
    AgentLoopStarted,
    AgentLoopCompleted,
    TaskCompletionAccepted,
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

fn current_durable_schema_manifest(migration: &str) -> DurableStoreSchemaManifest {
    DurableStoreSchemaManifest {
        schema_id: DURABLE_STORE_SCHEMA_ID.to_string(),
        manifest_format_version: DURABLE_STORE_SCHEMA_MANIFEST_FORMAT_VERSION,
        store_schema_version: DURABLE_STORE_SCHEMA_VERSION,
        minimum_runtime_store_schema_version: DURABLE_STORE_SCHEMA_MIN_SUPPORTED_VERSION,
        state: DURABLE_STORE_SCHEMA_STATE_CURRENT.to_string(),
        migration: migration.to_string(),
        layout: Some(DURABLE_STORE_LAYOUT_CURRENT.to_string()),
        migration_from_store_schema_version: None,
        migration_to_store_schema_version: None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DurableSchemaMigration {
    id: &'static str,
    from_version: u64,
    to_version: u64,
}

const DURABLE_SCHEMA_MIGRATIONS: &[DurableSchemaMigration] = &[DurableSchemaMigration {
    id: DURABLE_STORE_SCHEMA_MIGRATION_V1_TO_V2,
    from_version: 1,
    to_version: 2,
}];

fn durable_schema_migration_in_progress_manifest(
    migration: DurableSchemaMigration,
) -> DurableStoreSchemaManifest {
    DurableStoreSchemaManifest {
        schema_id: DURABLE_STORE_SCHEMA_ID.to_string(),
        manifest_format_version: DURABLE_STORE_SCHEMA_MANIFEST_FORMAT_VERSION,
        store_schema_version: migration.from_version,
        minimum_runtime_store_schema_version: DURABLE_STORE_SCHEMA_MIN_SUPPORTED_VERSION,
        state: DURABLE_STORE_SCHEMA_STATE_MIGRATION_IN_PROGRESS.to_string(),
        migration: migration.id.to_string(),
        layout: None,
        migration_from_store_schema_version: Some(migration.from_version),
        migration_to_store_schema_version: Some(migration.to_version),
    }
}

fn durable_schema_migration_completed_manifest(
    migration: DurableSchemaMigration,
) -> DurableStoreSchemaManifest {
    DurableStoreSchemaManifest {
        schema_id: DURABLE_STORE_SCHEMA_ID.to_string(),
        manifest_format_version: DURABLE_STORE_SCHEMA_MANIFEST_FORMAT_VERSION,
        store_schema_version: migration.to_version,
        minimum_runtime_store_schema_version: DURABLE_STORE_SCHEMA_MIN_SUPPORTED_VERSION,
        state: DURABLE_STORE_SCHEMA_STATE_CURRENT.to_string(),
        migration: migration.id.to_string(),
        layout: Some(DURABLE_STORE_LAYOUT_CURRENT.to_string()),
        migration_from_store_schema_version: Some(migration.from_version),
        migration_to_store_schema_version: Some(migration.to_version),
    }
}

fn validate_durable_schema_manifest_common(manifest: &DurableStoreSchemaManifest) -> Result<()> {
    if manifest.schema_id != DURABLE_STORE_SCHEMA_ID {
        bail!("unsupported durable store schema id");
    }
    if manifest.manifest_format_version != DURABLE_STORE_SCHEMA_MANIFEST_FORMAT_VERSION {
        bail!(
            "unsupported durable store schema manifest format version: {}",
            manifest.manifest_format_version
        );
    }
    if manifest.store_schema_version == 0 {
        bail!("malformed durable store schema version");
    }
    if manifest.store_schema_version > DURABLE_STORE_SCHEMA_VERSION {
        bail!(
            "unsupported future durable store schema version: {}",
            manifest.store_schema_version
        );
    }
    if manifest.minimum_runtime_store_schema_version > DURABLE_STORE_SCHEMA_VERSION {
        bail!(
            "durable store requires newer runtime schema support: {}",
            manifest.minimum_runtime_store_schema_version
        );
    }
    Ok(())
}

fn durable_schema_manifest_is_current(manifest: &DurableStoreSchemaManifest) -> Result<bool> {
    validate_durable_schema_manifest_common(manifest)?;
    Ok(
        manifest.store_schema_version == DURABLE_STORE_SCHEMA_VERSION
            && manifest.state == DURABLE_STORE_SCHEMA_STATE_CURRENT,
    )
}

fn validate_current_durable_schema_manifest(
    store: &TaskStore,
    manifest: &DurableStoreSchemaManifest,
) -> Result<()> {
    validate_durable_schema_manifest_common(manifest)?;
    if manifest.state != DURABLE_STORE_SCHEMA_STATE_CURRENT {
        bail!("durable store schema is not current");
    }
    if manifest.store_schema_version != DURABLE_STORE_SCHEMA_VERSION {
        bail!(
            "durable store schema migration required from version {}",
            manifest.store_schema_version
        );
    }
    if manifest.layout.as_deref() != Some(DURABLE_STORE_LAYOUT_CURRENT) {
        bail!("durable store schema layout marker is missing or unsupported");
    }
    if !matches!(
        manifest.migration.as_str(),
        DURABLE_STORE_SCHEMA_MIGRATION_INITIALIZED
            | DURABLE_STORE_SCHEMA_MIGRATION_ADOPTED_V2
            | DURABLE_STORE_SCHEMA_MIGRATION_V1_TO_V2
    ) {
        bail!("unsupported durable store schema migration state");
    }
    let layout = store
        .read_durable_store_layout_manifest()?
        .ok_or_else(|| anyhow::anyhow!("durable store layout marker is missing"))?;
    validate_durable_store_layout_manifest(&layout)?;
    let _ = store.reclaim_stale_durable_schema_migration_lock(
        &store.workspace_state_dir().join("store-schema.lock"),
    )?;
    Ok(())
}

fn validate_durable_store_layout_manifest(manifest: &DurableStoreLayoutManifest) -> Result<()> {
    if manifest.schema_id != DURABLE_STORE_LAYOUT_ID {
        bail!("unsupported durable store layout schema id");
    }
    if manifest.manifest_format_version != DURABLE_STORE_LAYOUT_VERSION {
        bail!("unsupported durable store layout manifest format version");
    }
    if manifest.store_schema_version != DURABLE_STORE_SCHEMA_VERSION {
        bail!("unsupported durable store layout schema version");
    }
    if manifest.layout != DURABLE_STORE_LAYOUT_CURRENT {
        bail!("unsupported durable store layout marker");
    }
    if !matches!(
        manifest.migration.as_str(),
        DURABLE_STORE_SCHEMA_MIGRATION_INITIALIZED
            | DURABLE_STORE_SCHEMA_MIGRATION_ADOPTED_V2
            | DURABLE_STORE_SCHEMA_MIGRATION_V1_TO_V2
    ) {
        bail!("unsupported durable store layout migration state");
    }
    Ok(())
}

fn durable_schema_migration_for_manifest(
    manifest: &DurableStoreSchemaManifest,
) -> Result<DurableSchemaMigration> {
    validate_durable_schema_manifest_common(manifest)?;
    if manifest.state == DURABLE_STORE_SCHEMA_STATE_MIGRATION_IN_PROGRESS {
        let migration = DURABLE_SCHEMA_MIGRATIONS
            .iter()
            .copied()
            .find(|candidate| {
                manifest.migration == candidate.id
                    && manifest.migration_from_store_schema_version == Some(candidate.from_version)
                    && manifest.migration_to_store_schema_version == Some(candidate.to_version)
            })
            .ok_or_else(|| anyhow::anyhow!("unsupported durable store schema migration marker"))?;
        return Ok(migration);
    }
    if manifest.state != DURABLE_STORE_SCHEMA_STATE_CURRENT {
        bail!("durable store schema is not current");
    }
    if manifest.store_schema_version == DURABLE_STORE_SCHEMA_VERSION {
        bail!("durable store schema is already current");
    }
    if manifest.store_schema_version == 1
        && !matches!(
            manifest.migration.as_str(),
            DURABLE_STORE_SCHEMA_MIGRATION_INITIALIZED_V1 | DURABLE_STORE_SCHEMA_MIGRATION_ADOPTED
        )
    {
        bail!("unsupported durable store schema migration state");
    }
    DURABLE_SCHEMA_MIGRATIONS
        .iter()
        .copied()
        .find(|candidate| {
            candidate.from_version == manifest.store_schema_version
                && candidate.to_version == DURABLE_STORE_SCHEMA_VERSION
        })
        .ok_or_else(|| {
            anyhow::anyhow!(
                "unsupported durable store schema migration path: {} -> {}",
                manifest.store_schema_version,
                DURABLE_STORE_SCHEMA_VERSION
            )
        })
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
    fn durable_schema_manifest_created_on_first_task_store_access() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());

        assert!(store.list_tasks().expect("list tasks").is_empty());

        let manifest = store
            .read_durable_schema_manifest()
            .expect("read manifest")
            .expect("manifest");
        assert_eq!(
            manifest,
            current_durable_schema_manifest(DURABLE_STORE_SCHEMA_MIGRATION_INITIALIZED)
        );
        let layout = store
            .read_durable_store_layout_manifest()
            .expect("read layout")
            .expect("layout");
        assert_eq!(layout.layout, DURABLE_STORE_LAYOUT_CURRENT);
        assert!(temp
            .path()
            .join(WORKSPACE_STATE_DIR)
            .join(DURABLE_STORE_SCHEMA_MANIFEST)
            .exists());
        assert!(!temp
            .path()
            .join(WORKSPACE_STATE_DIR)
            .join("store-schema.lock")
            .exists());
    }

    #[test]
    fn durable_schema_missing_manifest_adopts_existing_v1_layout() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::create_dir_all(temp.path().join(WORKSPACE_STATE_DIR).join(RUNS_DIR))
            .expect("legacy runs dir");
        let store = TaskStore::new(temp.path());

        let manifest = store.ensure_durable_schema().expect("ensure schema");

        assert_eq!(
            manifest,
            current_durable_schema_manifest(DURABLE_STORE_SCHEMA_MIGRATION_ADOPTED_V2)
        );
        assert_eq!(
            store
                .read_durable_store_layout_manifest()
                .expect("read layout")
                .expect("layout")
                .migration,
            DURABLE_STORE_SCHEMA_MIGRATION_ADOPTED_V2
        );
    }

    #[test]
    fn durable_schema_v1_manifest_migrates_to_v2_layout() {
        let temp = tempfile::tempdir().expect("tempdir");
        write_durable_schema_manifest_for_test(
            temp.path(),
            &legacy_v1_durable_schema_manifest(DURABLE_STORE_SCHEMA_MIGRATION_INITIALIZED_V1),
        );
        let store = TaskStore::new(temp.path());

        let manifest = store.ensure_durable_schema().expect("migrated schema");

        assert_eq!(
            manifest,
            durable_schema_migration_completed_manifest(DURABLE_SCHEMA_MIGRATIONS[0])
        );
        assert_eq!(
            store
                .read_durable_store_layout_manifest()
                .expect("read layout")
                .expect("layout")
                .layout,
            DURABLE_STORE_LAYOUT_CURRENT
        );
    }

    #[test]
    fn durable_schema_in_progress_migration_resumes_idempotently_without_layout_marker() {
        let temp = tempfile::tempdir().expect("tempdir");
        write_durable_schema_manifest_for_test(
            temp.path(),
            &durable_schema_migration_in_progress_manifest(DURABLE_SCHEMA_MIGRATIONS[0]),
        );
        let store = TaskStore::new(temp.path());

        let first = store.ensure_durable_schema().expect("first resume");
        let second = store.ensure_durable_schema().expect("second resume");

        assert_eq!(first, second);
        assert_eq!(
            first,
            durable_schema_migration_completed_manifest(DURABLE_SCHEMA_MIGRATIONS[0])
        );
    }

    #[test]
    fn durable_schema_in_progress_migration_resumes_after_layout_marker_write() {
        let temp = tempfile::tempdir().expect("tempdir");
        write_durable_schema_manifest_for_test(
            temp.path(),
            &durable_schema_migration_in_progress_manifest(DURABLE_SCHEMA_MIGRATIONS[0]),
        );
        let store = TaskStore::new(temp.path());
        store
            .write_durable_store_layout_manifest(DURABLE_STORE_SCHEMA_MIGRATION_V1_TO_V2)
            .expect("layout marker");

        let manifest = store.ensure_durable_schema().expect("resume");

        assert_eq!(
            manifest,
            durable_schema_migration_completed_manifest(DURABLE_SCHEMA_MIGRATIONS[0])
        );
    }

    #[test]
    fn durable_schema_partial_migration_conflict_fails_closed_before_mutation() {
        let temp = tempfile::tempdir().expect("tempdir");
        write_durable_schema_manifest_for_test(
            temp.path(),
            &durable_schema_migration_in_progress_manifest(DURABLE_SCHEMA_MIGRATIONS[0]),
        );
        let bad_layout = DurableStoreLayoutManifest {
            schema_id: DURABLE_STORE_LAYOUT_ID.to_string(),
            manifest_format_version: DURABLE_STORE_SCHEMA_MANIFEST_FORMAT_VERSION,
            store_schema_version: DURABLE_STORE_SCHEMA_VERSION,
            layout: "runtime-store-v2-conflicting-layout".to_string(),
            migration: DURABLE_STORE_SCHEMA_MIGRATION_V1_TO_V2.to_string(),
        };
        write_durable_store_layout_manifest_for_test(temp.path(), &bad_layout);
        let store = TaskStore::new(temp.path());

        let error = store
            .start_task(TaskStartParams {
                goal: "must not mutate".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
                product_continuation_source: None,
            })
            .expect_err("partial migration rejected");

        assert!(error
            .to_string()
            .contains("unsupported durable store layout marker"));
        assert!(!temp
            .path()
            .join(WORKSPACE_STATE_DIR)
            .join(RUNS_DIR)
            .exists());
    }

    #[test]
    fn durable_schema_malformed_manifest_fails_closed() {
        let temp = tempfile::tempdir().expect("tempdir");
        let manifest_path = temp
            .path()
            .join(WORKSPACE_STATE_DIR)
            .join(DURABLE_STORE_SCHEMA_MANIFEST);
        write_file_atomically(&manifest_path, b"{not-json").expect("write malformed manifest");
        let store = TaskStore::new(temp.path());

        let error = store.list_tasks().expect_err("malformed manifest rejected");

        assert!(error.to_string().contains("failed to parse"));
    }

    #[test]
    fn durable_schema_future_version_fails_closed_before_task_state_mutation() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());
        let mut manifest =
            current_durable_schema_manifest(DURABLE_STORE_SCHEMA_MIGRATION_INITIALIZED);
        manifest.store_schema_version = DURABLE_STORE_SCHEMA_VERSION + 1;
        let body = serde_json::to_string_pretty(&manifest).expect("serialize manifest");
        write_file_atomically(
            &temp
                .path()
                .join(WORKSPACE_STATE_DIR)
                .join(DURABLE_STORE_SCHEMA_MANIFEST),
            body.as_bytes(),
        )
        .expect("write future manifest");

        let error = store
            .start_task(TaskStartParams {
                goal: "must not mutate".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
                product_continuation_source: None,
            })
            .expect_err("future manifest rejected");

        assert!(error
            .to_string()
            .contains("unsupported future durable store schema version"));
        assert!(!temp
            .path()
            .join(WORKSPACE_STATE_DIR)
            .join(RUNS_DIR)
            .exists());
    }

    #[test]
    fn durable_schema_minimum_runtime_version_fails_closed() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = BrownieStore::new(temp.path());
        let mut manifest =
            current_durable_schema_manifest(DURABLE_STORE_SCHEMA_MIGRATION_INITIALIZED);
        manifest.minimum_runtime_store_schema_version = DURABLE_STORE_SCHEMA_VERSION + 1;
        let body = serde_json::to_string_pretty(&manifest).expect("serialize manifest");
        write_file_atomically(
            &temp
                .path()
                .join(WORKSPACE_STATE_DIR)
                .join(DURABLE_STORE_SCHEMA_MANIFEST),
            body.as_bytes(),
        )
        .expect("write future manifest");

        let error = store
            .ensure_durable_schema()
            .expect_err("future manifest rejected");

        assert!(error
            .to_string()
            .contains("durable store requires newer runtime schema support"));
    }

    #[cfg(unix)]
    #[test]
    fn durable_schema_process_loss_migration_resumes_after_each_durable_checkpoint() {
        for failpoint in [
            DURABLE_SCHEMA_MIGRATION_FAILPOINT_AFTER_IN_PROGRESS,
            DURABLE_SCHEMA_MIGRATION_FAILPOINT_AFTER_LAYOUT,
            DURABLE_SCHEMA_MIGRATION_FAILPOINT_AFTER_CURRENT_V2,
        ] {
            let temp = tempfile::tempdir().expect("tempdir");
            let fixture = seed_v1_store_with_task_run_ledger_and_checkpoint(temp.path());

            let failed = run_durable_schema_migration_child(temp.path(), Some(failpoint));
            assert!(
                !failed.success(),
                "migration child unexpectedly survived failpoint {failpoint}"
            );
            let lock_path = temp
                .path()
                .join(WORKSPACE_STATE_DIR)
                .join("store-schema.lock");
            assert!(
                lock_path.exists(),
                "process loss at {failpoint} should leave the schema lock behind"
            );
            assert_interrupted_migration_checkpoint(temp.path(), failpoint);

            let recovered = run_durable_schema_migration_child(temp.path(), None);
            assert!(
                recovered.success(),
                "restart child failed to resume migration after {failpoint}: {recovered:?}"
            );
            assert!(
                !lock_path.exists(),
                "restart after {failpoint} should reclaim the dead-owner schema lock"
            );
            assert_v1_fixture_preserved_and_resumable(temp.path(), &fixture);
        }
    }

    #[test]
    #[ignore]
    fn durable_schema_process_failpoint_child() {
        let Some(root) = std::env::var_os(DURABLE_SCHEMA_MIGRATION_CHILD_ROOT_ENV) else {
            return;
        };
        let expects_failpoint = std::env::var_os(DURABLE_SCHEMA_MIGRATION_FAILPOINT_ENV).is_some();
        let store = TaskStore::new(PathBuf::from(root));
        let manifest = store.ensure_durable_schema().expect("ensure schema");
        if expects_failpoint {
            panic!("durable schema migration failpoint did not abort the child process");
        }
        assert_eq!(manifest.store_schema_version, DURABLE_STORE_SCHEMA_VERSION);
        assert_eq!(manifest.state, DURABLE_STORE_SCHEMA_STATE_CURRENT);
    }

    #[test]
    fn durable_schema_v1_fixture_preserves_task_run_ledger_checkpoint_and_resume_identity() {
        let temp = tempfile::tempdir().expect("tempdir");
        let fixture = seed_v1_store_with_task_run_ledger_and_checkpoint(temp.path());
        let store = TaskStore::new(temp.path());

        let manifest = store.ensure_durable_schema().expect("migrate fixture");

        assert_eq!(
            manifest,
            durable_schema_migration_completed_manifest(DURABLE_SCHEMA_MIGRATIONS[0])
        );
        assert_v1_fixture_preserved_and_resumable(temp.path(), &fixture);
    }

    #[test]
    fn durable_write_failure_injection_disk_full_fails_closed_before_task_state() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());
        store
            .ensure_durable_schema()
            .expect("schema before failpoint");
        let _failpoint = set_durable_write_failpoint("disk_full_before_write");

        let error = store
            .start_task(TaskStartParams {
                goal: "disk full failpoint".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
                product_continuation_source: None,
            })
            .expect_err("disk full failpoint should fail closed");

        let error_text = format!("{error:?}");
        assert!(error_text.contains("disk_full_before_write"));
        assert!(!temp
            .path()
            .join(WORKSPACE_STATE_DIR)
            .join(RUNS_DIR)
            .join("ledger.jsonl")
            .exists());
        assert_no_durable_write_temps(temp.path());
    }

    #[test]
    fn durable_write_failure_injection_rename_denied_cleans_temporary_file() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());
        store
            .ensure_durable_schema()
            .expect("schema before failpoint");
        let _failpoint = set_durable_write_failpoint("rename_denied_after_sync");

        let error = store
            .start_task(TaskStartParams {
                goal: "rename denied failpoint".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
                product_continuation_source: None,
            })
            .expect_err("rename failpoint should fail closed");

        let error_text = format!("{error:?}");
        assert!(error_text.contains("rename_denied_after_sync"));
        assert_no_durable_write_temps(temp.path());
        assert!(store
            .list_tasks()
            .expect("list after failed write")
            .is_empty());
    }

    #[test]
    fn durable_write_failure_injection_truncated_state_does_not_replace_existing_state() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());
        let record = store
            .start_task(TaskStartParams {
                goal: "preserve old state".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
                product_continuation_source: None,
            })
            .expect("start task");
        let state_path = store.run_dir(&record.run_id).join("state.json");
        let original_state = fs::read(&state_path).expect("read original state");
        let _failpoint = set_durable_write_failpoint("truncated_state_before_rename");

        let error = store
            .update_task_status(
                &record.task_id,
                TaskStatus::Running,
                LedgerEventKind::TaskRunning,
            )
            .expect_err("truncated temp failpoint should fail closed");

        let error_text = format!("{error:?}");
        assert!(error_text.contains("truncated_state_before_rename"));
        assert_eq!(
            fs::read(&state_path).expect("read state after failed write"),
            original_state
        );
        assert_no_durable_write_temps(temp.path());
        let events = store
            .read_ledger_events(&record.run_id)
            .expect("ledger after failed write");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, LedgerEventKind::TaskStarted);
    }

    #[test]
    fn ledger_payload_envelope_separates_schema_and_instance_shape_fingerprints() {
        let base_payload = serde_json::json!({"status": "Completed"});
        let added_field_payload =
            serde_json::json!({"status": "Completed", "late_tool_response": true});
        let nested_payload =
            serde_json::json!({"status": "Completed", "evidence": {"attempts": [1, 2]}});

        let base_schema = ledger_payload_schema_fingerprint(&LedgerEventKind::TaskCompleted);
        let base = ledger_payload_instance_shape_fingerprint_for_value(
            &LedgerEventKind::TaskCompleted,
            &base_payload,
        );
        let added_field = ledger_payload_instance_shape_fingerprint_for_value(
            &LedgerEventKind::TaskCompleted,
            &added_field_payload,
        );
        let nested = ledger_payload_instance_shape_fingerprint_for_value(
            &LedgerEventKind::TaskCompleted,
            &nested_payload,
        );
        let base_envelope =
            ledger_payload_envelope(&LedgerEventKind::TaskCompleted, Some(&base_payload))
                .expect("build envelope")
                .expect("payload envelope");
        let added_envelope =
            ledger_payload_envelope(&LedgerEventKind::TaskCompleted, Some(&added_field_payload))
                .expect("build envelope")
                .expect("payload envelope");

        assert_eq!(base_envelope.schema_version, LEDGER_PAYLOAD_SCHEMA_VERSION);
        assert_eq!(base_envelope.shape_id, base_envelope.schema_id);
        assert_eq!(base_envelope.shape_fingerprint, base_schema);
        assert_eq!(base_envelope.schema_fingerprint, base_schema);
        assert_eq!(added_envelope.schema_fingerprint, base_schema);
        assert_ne!(
            base, added_field,
            "adding a payload field must change the diagnostic instance shape fingerprint"
        );
        assert_ne!(
            base, nested,
            "nested payload structure must participate in the shape fingerprint"
        );
        assert_ne!(
            base,
            base_schema,
            "diagnostic instance fingerprints must not collapse to the fixed contract schema fingerprint"
        );
    }

    #[test]
    fn ledger_payload_schema_classification_inventory_marks_open_payload_debt() {
        let task_completed_classification =
            ledger_payload_schema_classification(&LedgerEventKind::TaskCompleted);
        assert_eq!(task_completed_classification.as_str(), "strict_typed");
        assert_eq!(task_completed_classification.contract_status(), "closed");
        assert!(!task_completed_classification.release_blocking());
        assert!(
            ledger_payload_schema_descriptor(&LedgerEventKind::TaskCompleted)
                .contains("additional_fields:false")
        );

        let task_cancelled_classification =
            ledger_payload_schema_classification(&LedgerEventKind::TaskCancelled);
        assert_eq!(task_cancelled_classification.as_str(), "strict_typed");
        assert_eq!(task_cancelled_classification.contract_status(), "closed");
        assert!(!task_cancelled_classification.release_blocking());
        assert!(
            !ledger_payload_schema_descriptor(&LedgerEventKind::TaskCancelled).starts_with("any{")
        );

        let permission_checked_classification =
            ledger_payload_schema_classification(&LedgerEventKind::PermissionChecked);
        assert_eq!(permission_checked_classification.as_str(), "strict_typed");
        assert_eq!(
            permission_checked_classification.contract_status(),
            "closed"
        );
        assert!(!permission_checked_classification.release_blocking());
        assert!(
            ledger_payload_schema_descriptor(&LedgerEventKind::PermissionChecked)
                .contains("permission_decision_payload:true")
        );

        for kind in [
            LedgerEventKind::ToolPermissionChecked,
            LedgerEventKind::ToolPlanApproved,
            LedgerEventKind::ToolPlanDenied,
            LedgerEventKind::ToolIntentPermissionChecked,
            LedgerEventKind::ToolIntentApproved,
            LedgerEventKind::ToolIntentDenied,
            LedgerEventKind::ToolExecutionRequested,
            LedgerEventKind::ToolExecutionPermissionChecked,
            LedgerEventKind::ToolExecutionDenied,
        ] {
            let classification = ledger_payload_schema_classification(&kind);
            assert_eq!(classification.as_str(), "strict_typed", "{kind:?}");
            assert_eq!(classification.contract_status(), "closed", "{kind:?}");
            assert!(!classification.release_blocking(), "{kind:?}");
            assert!(
                ledger_payload_schema_descriptor(&kind).contains("additional_fields:false"),
                "{kind:?}"
            );
        }

        for kind in [
            LedgerEventKind::AgentLoopStarted,
            LedgerEventKind::AgentLoopCompleted,
            LedgerEventKind::TaskCompletionAccepted,
            LedgerEventKind::PromptBuilt,
            LedgerEventKind::PromptSensitiveScanCompleted,
            LedgerEventKind::PromptSensitiveScanFailed,
            LedgerEventKind::LlmRequestCreated,
            LedgerEventKind::LlmRequestFailed,
            LedgerEventKind::LlmResponseReceived,
            LedgerEventKind::SecondPassPromptBuilt,
            LedgerEventKind::SecondPassLlmRequestCreated,
            LedgerEventKind::SecondPassLlmRequestFailed,
            LedgerEventKind::SecondPassLlmResponseReceived,
        ] {
            let classification = ledger_payload_schema_classification(&kind);
            assert_eq!(classification.as_str(), "strict_typed", "{kind:?}");
            assert_eq!(classification.contract_status(), "closed", "{kind:?}");
            assert!(!classification.release_blocking(), "{kind:?}");
            assert!(
                ledger_payload_schema_descriptor(&kind).contains("additional_fields:false"),
                "{kind:?}"
            );
        }

        for kind in [
            LedgerEventKind::TaskStarted,
            LedgerEventKind::TaskRunning,
            LedgerEventKind::ModeResolved,
            LedgerEventKind::ExternalModePackChildProvenanceDenied,
            LedgerEventKind::ExternalModePackTaskProvenanceDenied,
        ] {
            let classification = ledger_payload_schema_classification(&kind);
            assert_eq!(classification.as_str(), "strict_typed", "{kind:?}");
            assert_eq!(classification.contract_status(), "closed", "{kind:?}");
            assert!(!classification.release_blocking(), "{kind:?}");
            assert!(
                ledger_payload_schema_descriptor(&kind).contains("additional_fields:false"),
                "{kind:?}"
            );
        }

        for kind in [
            LedgerEventKind::ToolPlanned,
            LedgerEventKind::ToolIntentParsed,
            LedgerEventKind::ToolIntentRejected,
        ] {
            let classification = ledger_payload_schema_classification(&kind);
            assert_eq!(classification.as_str(), "strict_typed", "{kind:?}");
            assert_eq!(classification.contract_status(), "closed", "{kind:?}");
            assert!(!classification.release_blocking(), "{kind:?}");
            assert!(
                ledger_payload_schema_descriptor(&kind).contains("additional_fields:false"),
                "{kind:?}"
            );
        }

        let approval_requested_classification =
            ledger_payload_schema_classification(&LedgerEventKind::WorkspacePatchApprovalRequested);
        assert_eq!(approval_requested_classification.as_str(), "payload_absent");
        assert_eq!(
            approval_requested_classification.contract_status(),
            "closed"
        );
        assert!(!approval_requested_classification.release_blocking());
        assert!(ledger_payload_schema_descriptor(
            &LedgerEventKind::WorkspacePatchApprovalRequested
        )
        .contains("workspace_patch_approval_requested_payload_absent:true"));

        for kind in [
            LedgerEventKind::WorkspacePatchProposed,
            LedgerEventKind::WorkspacePatchApproved,
            LedgerEventKind::WorkspacePatchRejected,
            LedgerEventKind::WorkspacePatchPreflightSnapshotCreated,
            LedgerEventKind::WorkspacePatchApplyPlanCreated,
            LedgerEventKind::WorkspacePatchApplyCapabilityChecked,
            LedgerEventKind::WorkspacePatchApplyDryRunChecked,
            LedgerEventKind::WorkspacePatchApplyResultRecorded,
            LedgerEventKind::WorkspacePatchReadinessReportCreated,
        ] {
            let classification = ledger_payload_schema_classification(&kind);
            assert_eq!(classification.as_str(), "strict_typed", "{kind:?}");
            assert_eq!(classification.contract_status(), "closed", "{kind:?}");
            assert!(!classification.release_blocking(), "{kind:?}");
            assert!(
                ledger_payload_schema_descriptor(&kind).contains("additional_fields:false"),
                "{kind:?}"
            );
        }
    }

    #[test]
    fn ledger_payload_write_rejects_payload_that_violates_typed_schema() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());
        let record = store
            .start_task(TaskStartParams {
                goal: "typed payload schema".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
                product_continuation_source: None,
            })
            .expect("start task");

        let error = store
            .append_task_events_with_payloads(
                &record,
                vec![(
                    LedgerEventKind::TaskCompleted,
                    Some(serde_json::json!({"status": true})),
                )],
            )
            .expect_err("invalid typed TaskCompleted payload should fail closed");

        assert!(format!("{error:#}").contains("status must be a string"));
    }

    #[test]
    fn ledger_payload_write_rejects_empty_or_malformed_task_completed_payload() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());
        let record = store
            .start_task(TaskStartParams {
                goal: "task completed payload validation".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
                product_continuation_source: None,
            })
            .expect("start task");

        let empty = store
            .append_task_events_with_payloads(
                &record,
                vec![(LedgerEventKind::TaskCompleted, Some(serde_json::json!({})))],
            )
            .expect_err("empty TaskCompleted payload should fail closed");
        assert!(format!("{empty:#}").contains("known bounded terminal evidence"));

        let unknown_only = store
            .append_task_events_with_payloads(
                &record,
                vec![(
                    LedgerEventKind::TaskCompleted,
                    Some(serde_json::json!({"completely_unknown_field": true})),
                )],
            )
            .expect_err("unknown-only TaskCompleted payload should fail closed");
        assert!(format!("{unknown_only:#}").contains("not allowed by strict terminal task schema"));

        let malformed_object_field = store
            .append_task_events_with_payloads(
                &record,
                vec![(
                    LedgerEventKind::TaskCompleted,
                    Some(serde_json::json!({"status": "Completed", "mcp": true})),
                )],
            )
            .expect_err("malformed TaskCompleted mcp payload should fail closed");
        assert!(format!("{malformed_object_field:#}").contains("mcp must be an object"));

        store
            .append_task_events_with_payloads(
                &record,
                vec![(
                    LedgerEventKind::TaskFailed,
                    Some(serde_json::json!({
                        "status": "Failed",
                        "verification_completion_gate_status": "Failed",
                        "required_verifier_count": 1,
                        "passed_verifier_count": 0,
                        "failed_verifier_count": 1,
                        "required_verifier_tool_ids": ["verification.cargo_check"],
                        "passed_verifier_tool_ids": [],
                        "failed_verifier_tool_ids": ["verification.cargo_check"],
                        "failure_reasons": ["cargo check failed"],
                        "requirement_fingerprint": format!("sha256:{}", "e".repeat(64))
                    })),
                )],
            )
            .expect("strict TaskFailed verifier payload should pass");

        store
            .append_task_events_with_payloads(
                &record,
                vec![(
                    LedgerEventKind::TaskCancelled,
                    Some(serde_json::json!({
                        "cancel_status": "Cancelled",
                        "cancel_id": "cancel_001",
                        "cancel_fingerprint": format!("sha256:{}", "c".repeat(64)),
                        "request_fingerprint_version": "v1",
                        "task_id": record.task_id,
                        "run_id": record.run_id,
                        "previous_status": "Running",
                        "expected_task_updated_at": record.updated_at,
                        "caller_authorized": true,
                        "terminal_evidence": true,
                        "reason": "Runtime admitted an explicit caller-authorized cancel command for this task/run."
                    })),
                )],
            )
            .expect("strict TaskCancelled cancel payload should pass");
    }

    #[test]
    fn ledger_payload_write_rejects_malformed_permission_payload() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());
        let record = store
            .start_task(TaskStartParams {
                goal: "permission payload validation".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
                product_continuation_source: None,
            })
            .expect("start task");

        store
            .append_task_events_with_payloads(
                &record,
                vec![(
                    LedgerEventKind::PermissionChecked,
                    Some(serde_json::json!({
                        "mode_id": "default",
                        "action": "ReadWorkspace",
                        "allowed": true,
                        "reason": "allowed by policy"
                    })),
                )],
            )
            .expect("strict PermissionChecked runtime-action payload should pass");

        store
            .append_task_events_with_payloads(
                &record,
                vec![(
                    LedgerEventKind::PermissionDenied,
                    Some(serde_json::json!({
                        "scope": "workspace.write",
                        "tool_id": "workspace.write",
                        "path": "src/lib.rs",
                        "operation": "replace_file",
                        "mode_id": "default",
                        "required_action": "WriteWorkspace",
                        "workspace_write_scope_count": 0,
                        "allowed": false,
                        "reason": "path outside allowed workspace write scopes"
                    })),
                )],
            )
            .expect("strict PermissionDenied workspace-scope payload should pass");

        let missing_action = store
            .append_task_events_with_payloads(
                &record,
                vec![(
                    LedgerEventKind::PermissionChecked,
                    Some(serde_json::json!({
                        "mode_id": "default",
                        "allowed": true,
                        "reason": "allowed by policy"
                    })),
                )],
            )
            .expect_err("permission payload without action evidence should fail closed");
        assert!(format!("{missing_action:#}").contains("action or required_action"));

        let malformed_allowed = store
            .append_task_events_with_payloads(
                &record,
                vec![(
                    LedgerEventKind::PermissionChecked,
                    Some(serde_json::json!({
                        "mode_id": "default",
                        "action": "ReadWorkspace",
                        "allowed": "true",
                        "reason": "allowed by policy"
                    })),
                )],
            )
            .expect_err("permission payload with malformed allowed field should fail closed");
        assert!(format!("{malformed_allowed:#}").contains("allowed must be a boolean"));

        let unknown_field = store
            .append_task_events_with_payloads(
                &record,
                vec![(
                    LedgerEventKind::PermissionDenied,
                    Some(serde_json::json!({
                        "mode_id": "default",
                        "action": "WriteWorkspace",
                        "allowed": false,
                        "reason": "denied by policy",
                        "raw_policy": "not allowed"
                    })),
                )],
            )
            .expect_err("permission payload with unknown field should fail closed");
        assert!(format!("{unknown_field:#}").contains("strict permission schema"));
    }

    #[test]
    fn ledger_payload_write_rejects_malformed_tool_payloads() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());
        let record = store
            .start_task(TaskStartParams {
                goal: "tool payload validation".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
                product_continuation_source: None,
            })
            .expect("start task");

        for kind in [
            LedgerEventKind::ToolPermissionChecked,
            LedgerEventKind::ToolPlanApproved,
            LedgerEventKind::ToolPlanDenied,
        ] {
            store
                .append_task_events_with_payloads(
                    &record,
                    vec![(
                        kind.clone(),
                        Some(serde_json::json!({
                            "tool_id": "workspace.read",
                            "required_action": "ReadWorkspace",
                            "allowed": true,
                            "reason": "allowed by policy"
                        })),
                    )],
                )
                .unwrap_or_else(|error| panic!("strict {kind:?} payload should pass: {error:#}"));
        }

        for kind in [
            LedgerEventKind::ToolIntentPermissionChecked,
            LedgerEventKind::ToolIntentApproved,
            LedgerEventKind::ToolIntentDenied,
        ] {
            store
                .append_task_events_with_payloads(
                    &record,
                    vec![(
                        kind.clone(),
                        Some(serde_json::json!({
                            "tool_id": "workspace.read",
                            "required_action": "ReadWorkspace",
                            "allowed": true,
                            "reason": "allowed by policy",
                            "request_reason": "Need context.",
                            "input_summary": {
                                "summary_schema": "tool_intent_input_v1",
                                "field_count": 1,
                                "string_field_count": 1,
                                "object_field_count": 0,
                                "array_field_count": 0,
                                "bool_field_count": 0,
                                "numeric_field_count": 0,
                                "null_field_count": 0,
                                "other_field_count": 0,
                                "fingerprint": format!("sha256:{}", "a".repeat(64))
                            }
                        })),
                    )],
                )
                .unwrap_or_else(|error| panic!("strict {kind:?} payload should pass: {error:#}"));
        }

        store
            .append_task_events_with_payloads(
                &record,
                vec![(
                    LedgerEventKind::ToolExecutionRequested,
                    Some(serde_json::json!({
                        "tool_id": "workspace.read",
                        "request_fingerprint": format!("sha256:{}", "b".repeat(64)),
                        "input_summary": {
                            "summary_schema": "tool_intent_input_v1",
                            "field_count": 1,
                            "string_field_count": 1,
                            "object_field_count": 0,
                            "array_field_count": 0,
                            "bool_field_count": 0,
                            "numeric_field_count": 0,
                            "null_field_count": 0,
                            "other_field_count": 0,
                            "fingerprint": format!("sha256:{}", "c".repeat(64))
                        }
                    })),
                )],
            )
            .expect("strict ToolExecutionRequested payload should pass");

        store
            .append_task_events_with_payloads(
                &record,
                vec![(
                    LedgerEventKind::ToolExecutionPermissionChecked,
                    Some(serde_json::json!({
                        "tool_id": "mcp.server.tool",
                        "required_action": "ReadWorkspace",
                        "allowed": true,
                        "reason": "allowed by policy",
                        "server_id": "server",
                        "tool_name": "tool",
                        "request_fingerprint": format!("sha256:{}", "d".repeat(64)),
                        "mcp_safety_policy": null
                    })),
                )],
            )
            .expect("strict ToolExecutionPermissionChecked payload should pass");

        store
            .append_task_events_with_payloads(
                &record,
                vec![(
                    LedgerEventKind::McpToolExecutionApproved,
                    Some(serde_json::json!({
                        "approval_schema_version": 1,
                        "task_id": record.task_id,
                        "run_id": record.run_id,
                        "tool_id": "mcp.server.tool",
                        "server_id": "server",
                        "tool_name": "tool",
                        "request_fingerprint": format!("sha256:{}", "e".repeat(64)),
                        "catalog_provenance": {
                            "server_id": "server",
                            "tool_name": "tool",
                            "catalog_fingerprint": format!("sha256:{}", "f".repeat(64))
                        },
                        "mcp_safety_policy": null,
                        "approval_fingerprint": format!("sha256:{}", "1".repeat(64)),
                        "status": "executing",
                        "approval_state_fingerprint": format!("sha256:{}", "2".repeat(64))
                    })),
                )],
            )
            .expect("strict McpToolExecutionApproved payload should pass");

        store
            .append_task_events_with_payloads(
                &record,
                vec![(
                    LedgerEventKind::ToolExecutionCompleted,
                    Some(serde_json::json!({
                        "tool_id": "workspace.read",
                        "status": "Completed",
                        "output_preview": "bounded output",
                        "bytes_read": 14,
                        "truncated": false
                    })),
                )],
            )
            .expect("strict ToolExecutionCompleted payload should pass without reason");

        store
            .append_task_events_with_payloads(
                &record,
                vec![(
                    LedgerEventKind::ToolExecutionFailed,
                    Some(serde_json::json!({
                        "tool_id": "mcp.server.tool",
                        "status": "Failed",
                        "reason": "MCP tool returned error.",
                        "mcp": {
                            "server_id": "server",
                            "tool_name": "tool",
                            "request_fingerprint": format!("sha256:{}", "3".repeat(64)),
                            "result_fingerprint": format!("sha256:{}", "4".repeat(64)),
                            "execution_status": "tool_returned_error"
                        },
                        "catalog_provenance": {
                            "server_id": "server",
                            "tool_name": "tool",
                            "catalog_fingerprint": format!("sha256:{}", "5".repeat(64))
                        },
                        "mcp_safety_policy": null,
                        "mcp_approval_binding": {
                            "approval_schema_version": 1,
                            "task_id": record.task_id,
                            "run_id": record.run_id,
                            "tool_id": "mcp.server.tool",
                            "server_id": "server",
                            "tool_name": "tool",
                            "request_fingerprint": format!("sha256:{}", "3".repeat(64)),
                            "catalog_provenance": {},
                            "mcp_safety_policy": null,
                            "approval_fingerprint": format!("sha256:{}", "6".repeat(64)),
                            "status": "consumed",
                            "approval_state_fingerprint": format!("sha256:{}", "7".repeat(64)),
                            "outcome": "tool_returned_error",
                            "outcome_fingerprint": format!("sha256:{}", "4".repeat(64))
                        }
                    })),
                )],
            )
            .expect("strict ToolExecutionFailed MCP terminal payload should pass");

        store
            .append_task_events_with_payloads(
                &record,
                vec![(
                    LedgerEventKind::ToolExecutionDenied,
                    Some(serde_json::json!({
                        "tool_id": "workspace.write",
                        "status": "Denied",
                        "reason": "denied by policy"
                    })),
                )],
            )
            .expect("strict ToolExecutionDenied payload should pass");

        let unknown_field = store
            .append_task_events_with_payloads(
                &record,
                vec![(
                    LedgerEventKind::ToolIntentApproved,
                    Some(serde_json::json!({
                        "tool_id": "workspace.read",
                        "required_action": "ReadWorkspace",
                        "allowed": true,
                        "reason": "allowed by policy",
                        "request_reason": "Need context.",
                        "input_summary": {},
                        "raw_input": "not allowed"
                    })),
                )],
            )
            .expect_err("tool intent payload with unknown field should fail closed");
        assert!(format!("{unknown_field:#}").contains("strict tool schema"));

        let missing_input_summary = store
            .append_task_events_with_payloads(
                &record,
                vec![(
                    LedgerEventKind::ToolExecutionRequested,
                    Some(serde_json::json!({
                        "tool_id": "workspace.read"
                    })),
                )],
            )
            .expect_err("tool execution request without input_summary should fail closed");
        assert!(format!("{missing_input_summary:#}").contains("input_summary"));

        let malformed_status = store
            .append_task_events_with_payloads(
                &record,
                vec![(
                    LedgerEventKind::ToolExecutionDenied,
                    Some(serde_json::json!({
                        "tool_id": "workspace.write",
                        "status": "Completed",
                        "reason": "denied by policy"
                    })),
                )],
            )
            .expect_err("tool execution denied payload with wrong status should fail closed");
        assert!(format!("{malformed_status:#}").contains("status must be Denied"));

        let missing_mcp_approval_state = store
            .append_task_events_with_payloads(
                &record,
                vec![(
                    LedgerEventKind::McpToolExecutionApproved,
                    Some(serde_json::json!({
                        "approval_schema_version": 1,
                        "task_id": record.task_id,
                        "run_id": record.run_id,
                        "tool_id": "mcp.server.tool",
                        "server_id": "server",
                        "tool_name": "tool",
                        "request_fingerprint": format!("sha256:{}", "e".repeat(64)),
                        "catalog_provenance": {},
                        "mcp_safety_policy": null,
                        "approval_fingerprint": format!("sha256:{}", "1".repeat(64)),
                        "status": "approved"
                    })),
                )],
            )
            .expect_err("MCP approval payload without state fingerprint should fail closed");
        assert!(format!("{missing_mcp_approval_state:#}").contains("approval_state_fingerprint"));

        let completed_unknown_field = store
            .append_task_events_with_payloads(
                &record,
                vec![(
                    LedgerEventKind::ToolExecutionCompleted,
                    Some(serde_json::json!({
                        "tool_id": "workspace.read",
                        "status": "Completed",
                        "raw_output": "not allowed"
                    })),
                )],
            )
            .expect_err("ToolExecutionCompleted payload with unknown raw field should fail closed");
        assert!(format!("{completed_unknown_field:#}").contains("strict tool schema"));

        let failed_without_reason = store
            .append_task_events_with_payloads(
                &record,
                vec![(
                    LedgerEventKind::ToolExecutionFailed,
                    Some(serde_json::json!({
                        "tool_id": "workspace.read",
                        "status": "Failed"
                    })),
                )],
            )
            .expect_err("ToolExecutionFailed payload without reason should fail closed");
        assert!(format!("{failed_without_reason:#}").contains("must include reason"));
    }

    #[test]
    fn ledger_payload_write_rejects_malformed_codebase_and_verification_payloads() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = BrownieStore::new(temp.path());
        let record = store
            .tasks()
            .start_task(TaskStartParams {
                goal: "codebase payload validation".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
                product_continuation_source: None,
            })
            .expect("start task");

        store
            .codebase_index()
            .append_event(
                LedgerEventKind::CodebaseIndexPermissionChecked,
                serde_json::json!({
                    "mode_id": "orchestrator",
                    "action": "IndexCodebase",
                    "allowed": true,
                    "reason": "allowed by policy",
                    "request_kind": "query",
                    "query_fingerprint": format!("sha256:{}", "1".repeat(64)),
                    "query_length_chars": 8,
                    "query_token_count": 1,
                    "max_results": 10,
                    "file_kind_filter": "Rust"
                }),
            )
            .expect("strict CodebaseIndexPermissionChecked payload should pass");

        let malformed_permission = store.codebase_index().append_event(
            LedgerEventKind::CodebaseIndexPermissionChecked,
            serde_json::json!({
                "mode_id": "orchestrator",
                "action": "ReadWorkspace",
                "allowed": true,
                "reason": "wrong action"
            }),
        );
        assert!(format!(
            "{:#}",
            malformed_permission.expect_err("wrong codebase action should fail")
        )
        .contains("action must be IndexCodebase"));

        let snapshot_manifest = test_index_manifest("idx_1234567890abcdef", "d");
        let mut snapshot_payload = test_codebase_index_snapshot_payload(&snapshot_manifest, false);
        snapshot_payload
            .as_object_mut()
            .expect("snapshot object")
            .insert(
                "unexpected_raw_path".to_string(),
                serde_json::json!("src/lib.rs"),
            );
        let malformed_snapshot = store.codebase_index().append_event(
            LedgerEventKind::CodebaseIndexSnapshotBuilt,
            snapshot_payload,
        );
        assert!(format!(
            "{:#}",
            malformed_snapshot.expect_err("unknown codebase snapshot field should fail")
        )
        .contains("not allowed by strict tool schema"));

        let recovery_payload = serde_json::json!({
            "verification_recovery_context_read": true,
            "context_read_id": "ctx_abcdef1234567890",
            "source_task_id": "task_source",
            "source_run_id": "run_source",
            "recovery_task_id": record.task_id,
            "recovery_run_id": record.run_id,
            "failure_fingerprint": format!("sha256:{}", "2".repeat(64)),
            "diagnostic_index": 0,
            "tool_id": "verification.recovery.context.read",
            "check_id": "check_cargo_test",
            "diagnostic_kind": "compile_error",
            "severity": "error",
            "test_name_hash": null,
            "read_path_fingerprint": format!("sha256:{}", "3".repeat(64)),
            "line": 12,
            "column": null,
            "excerpt_start_line": 10,
            "excerpt_end_line": 14,
            "excerpt_bytes": 120,
            "excerpt_sha256": format!("sha256:{}", "4".repeat(64)),
            "excerpt_truncated": false,
            "prompt_preview_redacted": true,
            "mode_id": "orchestrator",
            "required_action": "ReadWorkspace",
            "next_action": "run_recovery_task_with_context"
        });
        store
            .tasks()
            .append_task_event_with_payload(
                &record,
                LedgerEventKind::VerificationRecoveryContextReadMaterialized,
                Some(recovery_payload.clone()),
            )
            .expect("strict VerificationRecoveryContextReadMaterialized payload should pass");

        let mut malformed_recovery = recovery_payload;
        malformed_recovery
            .as_object_mut()
            .expect("recovery object")
            .insert(
                "required_action".to_string(),
                serde_json::json!("WriteWorkspace"),
            );
        let recovery_error = store
            .tasks()
            .append_task_event_with_payload(
                &record,
                LedgerEventKind::VerificationRecoveryContextReadMaterialized,
                Some(malformed_recovery),
            )
            .expect_err("wrong recovery required_action should fail");
        assert!(format!("{recovery_error:#}").contains("required_action must be ReadWorkspace"));
    }

    #[test]
    fn ledger_payload_write_rejects_malformed_workspace_patch_payloads() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());
        let record = store
            .start_task(TaskStartParams {
                goal: "workspace patch payload schema".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
                product_continuation_source: None,
            })
            .expect("start task");

        for (kind, payload) in [
            (
                LedgerEventKind::WorkspacePatchApprovalRequested,
                serde_json::json!({"proposal_id": "proposal_1"}),
            ),
            (
                LedgerEventKind::WorkspacePatchProposed,
                serde_json::json!({
                    "proposal_id": "proposal_1",
                    "tool_id": "workspace.write",
                    "path": "README.md",
                    "operation": "replace_file",
                    "content_preview": "updated",
                    "content_chars": 7,
                    "truncated": false,
                    "validation_status": "Valid",
                    "validation_reason": null,
                    "diff_preview": "diff",
                    "diff_truncated": false,
                    "diff_redacted": false,
                    "raw_content": "not allowed"
                }),
            ),
            (
                LedgerEventKind::WorkspacePatchApplyCapabilityChecked,
                serde_json::json!({
                    "proposal_id": "proposal_1",
                    "capability_id": "capability_1",
                    "apply_supported": true,
                    "apply_enabled": false,
                    "mode": "controlled_apply",
                    "reason": "blocked",
                    "required_gates": ["proposal_valid"],
                    "can_apply_now": false,
                    "checked_at": "2026-09-04T00:00:00Z",
                    "check_count": 1,
                    "failed_checks": [false],
                    "blocked_checks": []
                }),
            ),
            (
                LedgerEventKind::WorkspacePatchApplyResultRecorded,
                serde_json::json!({
                    "proposal_id": "proposal_1",
                    "apply_id": "apply_1",
                    "apply_status": "Applied",
                    "apply_reason": "Applied.",
                    "authorization_consumed": true,
                    "applied": true,
                    "operation": "replace_file",
                    "path": "README.md",
                    "failed_checks": [],
                    "blocked_checks": [],
                    "transaction_items": {}
                }),
            ),
        ] {
            let error = store
                .append_task_events_with_payloads(&record, vec![(kind.clone(), Some(payload))])
                .expect_err("malformed workspace patch payload should fail closed");
            assert!(
                error.to_string().contains("ledger payload")
                    || error.to_string().contains("does not accept a payload"),
                "{kind:?}: {error}"
            );
        }

        store
            .append_task_events_with_payloads(
                &record,
                vec![
                    (
                        LedgerEventKind::WorkspacePatchProposed,
                        Some(serde_json::json!({
                            "proposal_id": "proposal_1",
                            "tool_id": "workspace.write",
                            "path": "README.md",
                            "operation": "replace_file",
                            "content_preview": "updated",
                            "content_chars": 7,
                            "truncated": false,
                            "validation_status": "Valid",
                            "validation_reason": null,
                            "diff_preview": "diff",
                            "diff_truncated": false,
                            "diff_redacted": false,
                            "hunk_count": 1,
                            "hunk_fingerprint": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                        })),
                    ),
                    (
                        LedgerEventKind::WorkspacePatchApproved,
                        Some(serde_json::json!({
                            "proposal_id": "proposal_1",
                            "approval_status": "Approved",
                            "approval_reason": null,
                            "approval_reason_redacted": false,
                            "approved_at": "2026-09-04T00:00:00Z"
                        })),
                    ),
                    (
                        LedgerEventKind::WorkspacePatchRejected,
                        Some(serde_json::json!({
                            "proposal_id": "proposal_2",
                            "approval_status": "Rejected",
                            "approval_reason": "not needed",
                            "approval_reason_redacted": false,
                            "rejected_at": "2026-09-04T00:00:01Z"
                        })),
                    ),
                    (
                        LedgerEventKind::WorkspacePatchPreflightSnapshotCreated,
                        Some(serde_json::json!({
                            "proposal_id": "proposal_1",
                            "snapshot_id": "snapshot_1",
                            "path": "README.md",
                            "canonical_path_hash": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                            "file_exists": true,
                            "file_kind": "file",
                            "file_size_bytes": 10,
                            "file_modified_unix_ms": 1800000000000_i64,
                            "file_sha256": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                            "captured_at": "2026-09-04T00:00:02Z",
                            "stale": false,
                            "stale_reason": null
                        })),
                    ),
                    (
                        LedgerEventKind::WorkspacePatchApplyPlanCreated,
                        Some(serde_json::json!({
                            "proposal_id": "proposal_1",
                            "plan_id": "plan_1",
                            "operation": "replace_file",
                            "status": "Ready",
                            "check_count": 1,
                            "failed_checks": []
                        })),
                    ),
                    (
                        LedgerEventKind::WorkspacePatchApplyCapabilityChecked,
                        Some(serde_json::json!({
                            "proposal_id": "proposal_1",
                            "capability_id": "capability_1",
                            "apply_supported": true,
                            "apply_enabled": true,
                            "mode": "controlled_apply",
                            "reason": "ready",
                            "required_gates": ["proposal_valid"],
                            "can_apply_now": true,
                            "checked_at": "2026-09-04T00:00:03Z",
                            "check_count": 1,
                            "failed_checks": [],
                            "blocked_checks": []
                        })),
                    ),
                    (
                        LedgerEventKind::WorkspacePatchApplyDryRunChecked,
                        Some(serde_json::json!({
                            "proposal_id": "proposal_1",
                            "dry_run_id": "dry_run_1",
                            "dry_run_status": "Completed",
                            "dry_run_reason": "No mutation.",
                            "checked_at": "2026-09-04T00:00:04Z",
                            "required_gates": ["proposal_valid"],
                            "check_count": 1,
                            "failed_checks": [],
                            "blocked_checks": [],
                            "no_patch_applied": true,
                            "apply_executed": false,
                            "workspace_files_changed": false
                        })),
                    ),
                    (
                        LedgerEventKind::WorkspacePatchApplyResultRecorded,
                        Some(serde_json::json!({
                            "proposal_id": "proposal_1",
                            "apply_id": "apply_1",
                            "apply_status": "Applied",
                            "apply_reason": "Applied.",
                            "authorization_id": "authorization_1",
                            "authorization_consumed": true,
                            "applied": true,
                            "operation": "replace_file",
                            "atomic_replacement_completed": true,
                            "atomic_create_completed": false,
                            "atomic_delete_completed": false,
                            "path": "README.md",
                            "expected_target_sha256": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                            "expected_target_absent": false,
                            "pre_write_target_sha256": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                            "pre_write_target_exists": true,
                            "post_write_sha256": "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                            "post_delete_target_exists": null,
                            "content_chars": 7,
                            "content_bytes": 7,
                            "checked_at": "2026-09-04T00:00:05Z",
                            "applied_at": "2026-09-04T00:00:06Z",
                            "temp_file_cleaned": true,
                            "check_count": 1,
                            "failed_checks": [],
                            "blocked_checks": []
                        })),
                    ),
                    (
                        LedgerEventKind::WorkspacePatchReadinessReportCreated,
                        Some(serde_json::json!({
                            "proposal_id": "proposal_1",
                            "report_id": "report_1",
                            "readiness_status": "Ready",
                            "readiness_reason": null,
                            "readiness_fingerprint": "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                            "fingerprint_input_count": 3,
                            "generated_at": "2026-09-04T00:00:07Z",
                            "check_count": 1,
                            "failed_checks": [],
                            "blocked_checks": []
                        })),
                    ),
                ],
            )
            .expect("strict workspace patch payloads should append");
    }

    #[test]
    fn ledger_read_rejects_mismatched_payload_envelope() {
        let temp = tempfile::tempdir().expect("tempdir");
        let run_dir = temp.path().join("runs").join("run_1");
        fs::create_dir_all(&run_dir).expect("create run dir");
        let payload = serde_json::json!({"status": "Completed"});
        let mut envelope = ledger_payload_envelope(&LedgerEventKind::TaskCompleted, Some(&payload))
            .expect("build envelope")
            .expect("payload envelope");
        envelope.instance_shape_fingerprint = "shape-fnv1a64:0000000000000000".into();
        let event = LedgerEvent {
            event_id: "evt_1".into(),
            task_id: "task_1".into(),
            run_id: "run_1".into(),
            kind: LedgerEventKind::TaskCompleted,
            timestamp: "2026-09-03T00:00:00Z".into(),
            payload: Some(payload),
            payload_envelope: Some(envelope),
        };
        let body = format!(
            "{}\n",
            serde_json::to_string(&event).expect("serialize event")
        );
        fs::write(run_dir.join("ledger.jsonl"), body).expect("write ledger");

        let error = RunLedger::new(run_dir)
            .read_events()
            .expect_err("mismatched envelope must fail closed on read");

        assert!(format!("{error:#}").contains("instance_shape_fingerprint mismatch"));
    }

    #[test]
    fn ledger_read_accepts_legacy_v1_payload_envelope() {
        let temp = tempfile::tempdir().expect("tempdir");
        let run_dir = temp.path().join("runs").join("run_1");
        fs::create_dir_all(&run_dir).expect("create run dir");
        let payload = serde_json::json!({"status": "Completed"});
        let event = LedgerEvent {
            event_id: "evt_1".into(),
            task_id: "task_1".into(),
            run_id: "run_1".into(),
            kind: LedgerEventKind::TaskCompleted,
            timestamp: "2026-09-03T00:00:00Z".into(),
            payload: Some(payload.clone()),
            payload_envelope: Some(LedgerPayloadEnvelope {
                schema_version: 1,
                shape_id: ledger_payload_legacy_v1_shape_id(&LedgerEventKind::TaskCompleted),
                shape_fingerprint: ledger_payload_legacy_v1_shape_fingerprint_for_value(
                    &LedgerEventKind::TaskCompleted,
                    &payload,
                ),
                schema_id: String::new(),
                schema_fingerprint: String::new(),
                instance_shape_fingerprint: String::new(),
            }),
        };
        let body = format!(
            "{}\n",
            serde_json::to_string(&event).expect("serialize event")
        );
        fs::write(run_dir.join("ledger.jsonl"), body).expect("write ledger");

        let events = RunLedger::new(run_dir).read_events().expect("read ledger");

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, LedgerEventKind::TaskCompleted);
    }

    #[test]
    fn task_terminal_status_race_fails_closed_before_late_completion_overwrites_cancel() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());
        let record = store
            .start_task(TaskStartParams {
                goal: "late terminal race".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
                product_continuation_source: None,
            })
            .expect("start task");
        let running = store
            .update_task_status(
                &record.task_id,
                TaskStatus::Running,
                LedgerEventKind::TaskRunning,
            )
            .expect("mark running");
        store
            .update_task_status(
                &record.task_id,
                TaskStatus::Cancelled,
                LedgerEventKind::TaskCancelled,
            )
            .expect("concurrent cancel wins");

        let error = store
            .update_task_status_with_payload_checked(
                &record.task_id,
                TaskStatus::Running,
                &running.updated_at,
                TaskStatus::Completed,
                LedgerEventKind::TaskCompleted,
                Some(serde_json::json!({"late_tool_response": true})),
            )
            .expect_err("late completion should not overwrite cancel");

        assert!(error.to_string().contains("task terminal status race"));
        let current = store
            .get_task(&record.task_id)
            .expect("task lookup")
            .expect("task");
        assert_eq!(current.status, TaskStatus::Cancelled);
        let events = store
            .read_ledger_events(&record.run_id)
            .expect("ledger after race");
        assert!(events
            .iter()
            .any(|event| event.kind == LedgerEventKind::TaskCancelled));
        assert!(!events
            .iter()
            .any(|event| event.kind == LedgerEventKind::TaskCompleted));
    }

    #[test]
    fn task_terminal_status_stale_same_terminal_replays_without_duplicate_event() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());
        let record = store
            .start_task(TaskStartParams {
                goal: "duplicate terminal completion".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
                product_continuation_source: None,
            })
            .expect("start task");
        let running = store
            .update_task_status(
                &record.task_id,
                TaskStatus::Running,
                LedgerEventKind::TaskRunning,
            )
            .expect("mark running");
        let completed = store
            .update_task_status_with_payload_checked(
                &record.task_id,
                TaskStatus::Running,
                &running.updated_at,
                TaskStatus::Completed,
                LedgerEventKind::TaskCompleted,
                Some(serde_json::json!({"terminal_race_candidate": "first"})),
            )
            .expect("first completion");

        let replayed = store
            .update_task_status_with_payload_checked(
                &record.task_id,
                TaskStatus::Running,
                &running.updated_at,
                TaskStatus::Completed,
                LedgerEventKind::TaskCompleted,
                Some(serde_json::json!({"terminal_race_candidate": "duplicate"})),
            )
            .expect("duplicate same-terminal completion should replay");

        assert_eq!(replayed.status, TaskStatus::Completed);
        assert_eq!(replayed.updated_at, completed.updated_at);
        let events = store
            .read_ledger_events(&record.run_id)
            .expect("ledger after duplicate same terminal");
        assert_eq!(
            events
                .iter()
                .filter(|event| event.kind == LedgerEventKind::TaskCompleted)
                .count(),
            1
        );
    }

    #[test]
    fn ledger_payload_write_rejects_malformed_lifecycle_payloads() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());
        let record = store
            .start_task(TaskStartParams {
                goal: "lifecycle payload schema".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
                product_continuation_source: None,
            })
            .expect("start task");

        for (kind, payload) in [
            (
                LedgerEventKind::AgentLoopStarted,
                serde_json::json!({"entrypoint": "task.run"}),
            ),
            (
                LedgerEventKind::AgentLoopCompleted,
                serde_json::json!({"final_state": "Completed"}),
            ),
            (
                LedgerEventKind::TaskCompletionAccepted,
                serde_json::json!({
                    "acceptance_id": "accept_1",
                    "task_id": record.task_id,
                    "run_id": record.run_id,
                    "status": "Complete",
                    "terminal_completion_fingerprint": "sha256:terminal",
                    "acceptance_fingerprint": "sha256:acceptance",
                    "verifier_gate_status": "NotRequired",
                    "replayed": false,
                    "next_action": "inspect_accepted_completion"
                }),
            ),
            (LedgerEventKind::PromptBuilt, serde_json::json!({})),
            (
                LedgerEventKind::PromptSensitiveScanCompleted,
                serde_json::json!({
                    "mode": "warn",
                    "sensitive_guard": "warn",
                    "finding_count": 1,
                    "categories": ["secret"],
                    "message_indexes": ["zero"]
                }),
            ),
            (
                LedgerEventKind::LlmRequestCreated,
                serde_json::json!({
                    "provider": "Fake",
                    "model": "mock",
                    "message_count": 1,
                    "base_url": {},
                    "strict": false
                }),
            ),
            (LedgerEventKind::LlmRequestFailed, serde_json::json!({})),
            (
                LedgerEventKind::LlmResponseReceived,
                serde_json::json!({"provider": "Fake"}),
            ),
            (
                LedgerEventKind::SecondPassPromptBuilt,
                serde_json::json!({"prompt_preview": "ok", "raw_prompt": "forbidden"}),
            ),
            (
                LedgerEventKind::SecondPassLlmRequestCreated,
                serde_json::json!({
                    "provider": "Fake",
                    "model": "mock",
                    "message_count": 1,
                    "base_url": null
                }),
            ),
            (
                LedgerEventKind::SecondPassLlmRequestFailed,
                serde_json::json!({"provider": 1}),
            ),
            (
                LedgerEventKind::SecondPassLlmResponseReceived,
                serde_json::json!({
                    "provider": "Fake",
                    "content_preview": "ok",
                    "raw_response": "forbidden"
                }),
            ),
        ] {
            let error = store
                .append_task_events_with_payloads(&record, vec![(kind.clone(), Some(payload))])
                .expect_err("malformed lifecycle payload should fail closed");
            assert!(
                error.to_string().contains("ledger payload"),
                "{kind:?}: {error}"
            );
        }

        store
            .append_task_events_with_payloads(
                &record,
                vec![
                    (
                        LedgerEventKind::AgentLoopStarted,
                        Some(serde_json::json!({
                            "entrypoint": "task.run",
                            "state": "BuildingContext"
                        })),
                    ),
                    (
                        LedgerEventKind::AgentLoopCompleted,
                        Some(serde_json::json!({
                            "final_state": "Completed",
                            "completion_summary": "done",
                            "completion_result_fingerprint": "sha256:abc",
                            "final_response_present": true,
                            "final_response_chars": 3
                        })),
                    ),
                    (
                        LedgerEventKind::TaskCompletionAccepted,
                        Some(serde_json::json!({
                            "acceptance_id": "accept_2",
                            "task_id": "task_lifecycle",
                            "run_id": "run_lifecycle",
                            "status": "AcceptedComplete",
                            "terminal_completion_fingerprint": "sha256:terminal",
                            "acceptance_fingerprint": "sha256:acceptance",
                            "verifier_gate_status": "NotRequired",
                            "replayed": false,
                            "next_action": "inspect_accepted_completion"
                        })),
                    ),
                    (
                        LedgerEventKind::PromptBuilt,
                        Some(serde_json::json!({
                            "message_count": 1,
                            "prompt_preview_redacted": true
                        })),
                    ),
                    (
                        LedgerEventKind::PromptSensitiveScanFailed,
                        Some(serde_json::json!({
                            "mode": "deny",
                            "sensitive_guard": "deny",
                            "finding_count": 1,
                            "categories": [],
                            "message_indexes": []
                        })),
                    ),
                    (
                        LedgerEventKind::LlmRequestCreated,
                        Some(serde_json::json!({
                            "provider": "Fake",
                            "model": "mock",
                            "message_count": 1,
                            "base_url": null,
                            "strict": false
                        })),
                    ),
                    (
                        LedgerEventKind::LlmRequestFailed,
                        Some(serde_json::json!({
                            "llm_provider_failure": {"request_phase": "initial"}
                        })),
                    ),
                    (
                        LedgerEventKind::LlmResponseReceived,
                        Some(serde_json::json!({
                            "provider": "Fake",
                            "content_preview": "ok"
                        })),
                    ),
                    (
                        LedgerEventKind::SecondPassPromptBuilt,
                        Some(serde_json::json!({"prompt_preview": "ok"})),
                    ),
                    (
                        LedgerEventKind::SecondPassLlmRequestCreated,
                        Some(serde_json::json!({
                            "provider": "Fake",
                            "model": "mock",
                            "message_count": 1,
                            "base_url": null,
                            "strict": false
                        })),
                    ),
                    (
                        LedgerEventKind::SecondPassLlmRequestFailed,
                        Some(serde_json::json!({
                            "llm_provider_failure": {"request_phase": "second_pass"}
                        })),
                    ),
                    (
                        LedgerEventKind::SecondPassLlmResponseReceived,
                        Some(serde_json::json!({
                            "provider": "Fake",
                            "content_preview": "ok"
                        })),
                    ),
                ],
            )
            .expect("valid lifecycle payloads should append");
    }

    #[test]
    fn ledger_payload_write_rejects_malformed_task_admission_and_mode_payloads() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());
        let record = store
            .start_task(TaskStartParams {
                goal: "task admission payload schema".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
                product_continuation_source: None,
            })
            .expect("start task");

        for (kind, payload) in [
            (
                LedgerEventKind::TaskStarted,
                serde_json::json!({
                    "mode_id": "orchestrator",
                    "raw_goal": "not allowed"
                }),
            ),
            (
                LedgerEventKind::TaskRunning,
                serde_json::json!({
                    "runtime_deadline": {
                        "deadline_unix_ms": 1_780_000_000_000u64
                    }
                }),
            ),
            (
                LedgerEventKind::ModeResolved,
                serde_json::json!({
                    "mode_id": "orchestrator",
                    "display_name": "Orchestrator"
                }),
            ),
            (
                LedgerEventKind::ExternalModePackChildProvenanceDenied,
                serde_json::json!({
                    "status": "Allowed",
                    "reason": "stale_external_modepack_child_policy_mismatch",
                    "task_id": record.task_id.clone(),
                    "run_id": record.run_id.clone()
                }),
            ),
            (
                LedgerEventKind::ExternalModePackTaskProvenanceDenied,
                serde_json::json!({
                    "status": "Denied",
                    "reason": "stale_external_modepack_task_policy_missing",
                    "task_id": record.task_id.clone(),
                    "run_id": record.run_id.clone(),
                    "source_kind": "workspace_modepack"
                }),
            ),
        ] {
            let error = store
                .append_task_events_with_payloads(&record, vec![(kind.clone(), Some(payload))])
                .expect_err("malformed task admission or mode payload should fail closed");
            assert!(
                error.to_string().contains("ledger payload"),
                "{kind:?}: {error}"
            );
        }

        store
            .append_task_events_with_payloads(
                &record,
                vec![
                    (
                        LedgerEventKind::TaskStarted,
                        Some(serde_json::json!({
                            "status": "Queued",
                            "reason": "bounded task admission recorded"
                        })),
                    ),
                    (
                        LedgerEventKind::TaskRunning,
                        Some(serde_json::json!({
                            "admission_id": "task_run_admission_1",
                            "admission_kind": "runtime_task_run",
                            "reason": "task admitted"
                        })),
                    ),
                    (
                        LedgerEventKind::ModeResolved,
                        Some(serde_json::json!({
                            "mode_id": "orchestrator",
                            "display_name": "Orchestrator",
                            "role_definition": "Coordinate bounded runtime work.",
                            "prompt_sections": [],
                            "instruction_fingerprint": format!("sha256:{}", "2".repeat(64)),
                            "workspace_write_scopes": [],
                            "mcp_access": [],
                            "completion_rules": [],
                            "permissions": {}
                        })),
                    ),
                    (
                        LedgerEventKind::ExternalModePackChildProvenanceDenied,
                        Some(serde_json::json!({
                            "status": "Denied",
                            "reason": "stale_external_modepack_child_policy_mismatch",
                            "task_id": record.task_id.clone(),
                            "run_id": record.run_id.clone(),
                            "source_candidate_id": null,
                            "source_handoff_envelope_id": null,
                            "source_handoff_envelope_fingerprint": null
                        })),
                    ),
                    (
                        LedgerEventKind::ExternalModePackTaskProvenanceDenied,
                        Some(serde_json::json!({
                            "status": "Denied",
                            "reason": "stale_external_modepack_task_policy_missing",
                            "task_id": record.task_id.clone(),
                            "run_id": record.run_id.clone(),
                            "source_kind": "workspace_modepack",
                            "source_path": ".brownie/modepack.json"
                        })),
                    ),
                ],
            )
            .expect("strict task admission and mode payloads should append");
    }

    #[test]
    fn ledger_payload_write_rejects_malformed_tool_planning_and_intent_parse_payloads() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());
        let record = store
            .start_task(TaskStartParams {
                goal: "tool planning payload schema".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
                product_continuation_source: None,
            })
            .expect("start task");

        for (kind, payload) in [
            (
                LedgerEventKind::ToolPlanned,
                serde_json::json!({"tool_ids": ["workspace.read"], "raw_plan": "not allowed"}),
            ),
            (
                LedgerEventKind::ToolPlanned,
                serde_json::json!({"tool_ids": [1]}),
            ),
            (
                LedgerEventKind::ToolIntentParsed,
                serde_json::json!({"tool_ids": ["workspace.write"]}),
            ),
            (
                LedgerEventKind::ToolIntentParsed,
                serde_json::json!({"tool_ids": ["workspace.write"], "parser": 1}),
            ),
            (
                LedgerEventKind::ToolIntentRejected,
                serde_json::json!({"tool_id": "unknown"}),
            ),
            (
                LedgerEventKind::ToolIntentRejected,
                serde_json::json!({
                    "tool_id": "unknown",
                    "reason": "not allowed",
                    "code": false
                }),
            ),
        ] {
            let error = store
                .append_task_events_with_payloads(&record, vec![(kind.clone(), Some(payload))])
                .expect_err("malformed tool planning or intent parse payload should fail closed");
            assert!(
                error.to_string().contains("ledger payload"),
                "{kind:?}: {error}"
            );
        }

        store
            .append_task_events_with_payloads(
                &record,
                vec![
                    (
                        LedgerEventKind::ToolPlanned,
                        Some(serde_json::json!({"tool_ids": ["workspace.read", "git.status"]})),
                    ),
                    (
                        LedgerEventKind::ToolIntentParsed,
                        Some(serde_json::json!({
                            "tool_ids": ["workspace.write"],
                            "parser": {
                                "found_blocks": 1,
                                "accepted_blocks": 1,
                                "accepted_requests": 1,
                                "rejected_requests": 0,
                                "max_blocks": 4,
                                "max_block_bytes": 8192,
                                "max_tool_requests": 8,
                                "max_input_bytes": 65536,
                                "max_reason_chars": 512,
                                "max_workspace_write_content_chars": 200000
                            }
                        })),
                    ),
                    (
                        LedgerEventKind::ToolIntentRejected,
                        Some(serde_json::json!({
                            "tool_id": "unsafe.tool",
                            "reason": "tool is not available in the task-pinned mode policy",
                            "code": "tool_not_allowed"
                        })),
                    ),
                ],
            )
            .expect("strict tool planning and intent parse payloads should append");
    }

    #[test]
    fn ledger_payload_write_rejects_malformed_subtask_dispatch_payloads() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());
        let record = store
            .start_task(TaskStartParams {
                goal: "subtask dispatch payload schema".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
                product_continuation_source: None,
            })
            .expect("start task");

        for (kind, payload) in [
            (
                LedgerEventKind::SubtaskOrchestrationQueued,
                serde_json::json!({
                    "subtask_id": "subtask_1",
                    "parent_task_id": record.task_id,
                    "parent_run_id": record.run_id,
                    "tool_id": "subtask.spawn",
                    "required_action": "SpawnSubtask",
                    "status": "Queued",
                    "queue_position": 1,
                    "request_reason": "split work",
                    "input_summary": {},
                    "execution_enabled": false,
                    "reason": "queued",
                    "raw_goal": "not allowed"
                }),
            ),
            (
                LedgerEventKind::SubtaskDispatchPlanPrepared,
                serde_json::json!({
                    "plan_id": "plan_1",
                    "parent_task_id": record.task_id,
                    "parent_run_id": record.run_id,
                    "readiness_id": "readiness_1",
                    "readiness_count": 1,
                    "queued_count": 1,
                    "source_event_count": 1,
                    "status": "Blocked",
                    "dispatch_plan_status": "Blocked",
                    "dispatch_reason": "blocked",
                    "required_capability": "runtime_subtask_dispatcher",
                    "check_count": 1,
                    "blocked_checks": [false],
                    "execution_enabled": false,
                    "dispatch_enabled": false,
                    "next_action": "wait",
                    "reason": "blocked"
                }),
            ),
            (
                LedgerEventKind::ParentJoinContinuationFingerprintConsumed,
                serde_json::json!({
                    "admission_id": "parent_join_admission_1",
                    "child_completion_fingerprint": format!("sha256:{}", "a".repeat(64)),
                    "child_completion_child_count": 1,
                    "child_terminal_completed_count": 1,
                    "child_terminal_failed_count": 0,
                    "child_recovery_cycle_depth": 0,
                    "fingerprint_input_count": 5,
                    "reason": "missing status"
                }),
            ),
        ] {
            let error = store
                .append_task_events_with_payloads(&record, vec![(kind.clone(), Some(payload))])
                .expect_err("malformed subtask dispatch payload should fail closed");
            assert!(
                error.to_string().contains("ledger payload"),
                "{kind:?}: {error}"
            );
        }

        store
            .append_task_events_with_payloads(
                &record,
                vec![
                    (
                        LedgerEventKind::SubtaskOrchestrationQueued,
                        Some(serde_json::json!({
                            "subtask_id": "subtask_1",
                            "parent_task_id": record.task_id,
                            "parent_run_id": record.run_id,
                            "tool_id": "subtask.spawn",
                            "required_action": "SpawnSubtask",
                            "status": "Queued",
                            "queue_position": 1,
                            "request_reason": "split work",
                            "input_summary": {},
                            "execution_enabled": false,
                            "reason": "queued",
                            "requested_goal_preview": "child goal",
                            "requested_mode_id": "implementer"
                        })),
                    ),
                    (
                        LedgerEventKind::SubtaskHandoffPrepared,
                        Some(serde_json::json!({
                            "handoff_id": "handoff_1",
                            "parent_task_id": record.task_id,
                            "parent_run_id": record.run_id,
                            "status": "Prepared",
                            "queued_count": 1,
                            "queued_subtask_ids": ["subtask_1"],
                            "source_event_count": 1,
                            "execution_enabled": false,
                            "next_action": "await_future_runtime_scheduler",
                            "reason": "prepared"
                        })),
                    ),
                    (
                        LedgerEventKind::SubtaskSchedulerReadinessRecorded,
                        Some(serde_json::json!({
                            "readiness_id": "readiness_1",
                            "parent_task_id": record.task_id,
                            "parent_run_id": record.run_id,
                            "handoff_id": "handoff_1",
                            "handoff_count": 1,
                            "queued_count": 1,
                            "source_event_count": 1,
                            "status": "Blocked",
                            "readiness_status": "Blocked",
                            "readiness_reason": "not ready",
                            "check_count": 1,
                            "blocked_checks": ["runtime_scheduler_not_implemented"],
                            "execution_enabled": false,
                            "dispatch_enabled": false,
                            "next_action": "await_runtime_scheduler_dispatch",
                            "reason": "blocked"
                        })),
                    ),
                    (
                        LedgerEventKind::SubtaskDispatchPlanPrepared,
                        Some(serde_json::json!({
                            "plan_id": "plan_1",
                            "parent_task_id": record.task_id,
                            "parent_run_id": record.run_id,
                            "readiness_id": "readiness_1",
                            "readiness_count": 1,
                            "queued_count": 1,
                            "source_event_count": 1,
                            "status": "Blocked",
                            "dispatch_plan_status": "Blocked",
                            "dispatch_reason": "blocked",
                            "required_capability": "runtime_subtask_dispatcher",
                            "check_count": 1,
                            "blocked_checks": ["runtime_dispatcher_not_implemented"],
                            "execution_enabled": false,
                            "dispatch_enabled": false,
                            "next_action": "await_runtime_subtask_dispatcher",
                            "reason": "blocked"
                        })),
                    ),
                    (
                        LedgerEventKind::SubtaskDispatchContractPrepared,
                        Some(serde_json::json!({
                            "contract_id": "contract_1",
                            "parent_task_id": record.task_id,
                            "parent_run_id": record.run_id,
                            "plan_id": "plan_1",
                            "plan_count": 1,
                            "queued_count": 1,
                            "source_event_count": 1,
                            "status": "Blocked",
                            "dispatch_contract_status": "Blocked",
                            "eligibility_status": "Blocked",
                            "dispatch_contract_reason": "blocked",
                            "required_capability": "runtime_subtask_dispatcher",
                            "required_preconditions": ["runtime_subtask_dispatcher_implemented"],
                            "check_count": 1,
                            "blocked_checks": ["dispatch_contract_not_executable"],
                            "execution_enabled": false,
                            "dispatch_enabled": false,
                            "next_action": "await_dispatch_contract_implementation",
                            "reason": "blocked"
                        })),
                    ),
                    (
                        LedgerEventKind::SubtaskDispatchAdmissionEvaluated,
                        Some(serde_json::json!({
                            "admission_id": "admission_1",
                            "parent_task_id": record.task_id,
                            "parent_run_id": record.run_id,
                            "contract_id": "contract_1",
                            "contract_count": 1,
                            "queued_count": 1,
                            "source_event_count": 1,
                            "status": "Blocked",
                            "admission_status": "Blocked",
                            "execution_gate_status": "Blocked",
                            "admission_reason": "blocked",
                            "required_capability": "runtime_subtask_dispatcher",
                            "precondition_count": 1,
                            "satisfied_precondition_count": 0,
                            "blocked_preconditions": ["runtime_subtask_dispatcher_implemented"],
                            "check_count": 1,
                            "blocked_checks": ["dispatch_admission_blocked"],
                            "execution_enabled": false,
                            "dispatch_enabled": false,
                            "next_action": "await_dispatch_admission_preconditions",
                            "reason": "blocked"
                        })),
                    ),
                    (
                        LedgerEventKind::SubtaskDispatchReadinessSnapshotRecorded,
                        Some(serde_json::json!({
                            "snapshot_id": "snapshot_1",
                            "parent_task_id": record.task_id,
                            "parent_run_id": record.run_id,
                            "admission_id": "admission_1",
                            "admission_count": 1,
                            "queued_count": 1,
                            "source_event_count": 1,
                            "status": "Blocked",
                            "readiness_status": "Blocked",
                            "scheduler_handoff_status": "Blocked",
                            "readiness_reason": "blocked",
                            "required_capability": "runtime_subtask_dispatcher",
                            "precondition_count": 1,
                            "satisfied_precondition_count": 0,
                            "blocked_preconditions": ["runtime_subtask_dispatcher_implemented"],
                            "check_count": 1,
                            "blocked_checks": ["dispatch_readiness_snapshot_blocked"],
                            "readiness_fingerprint": format!("sha256:{}", "b".repeat(64)),
                            "fingerprint_input_count": 8,
                            "execution_enabled": false,
                            "dispatch_enabled": false,
                            "next_action": "await_dispatch_readiness_snapshot_handoff",
                            "reason": "blocked"
                        })),
                    ),
                    (
                        LedgerEventKind::SubtaskDispatcherGuardVerdictRecorded,
                        Some(serde_json::json!({
                            "guard_id": "guard_1",
                            "parent_task_id": record.task_id,
                            "parent_run_id": record.run_id,
                            "snapshot_id": "snapshot_1",
                            "snapshot_count": 1,
                            "queued_count": 1,
                            "source_event_count": 1,
                            "status": "Blocked",
                            "guard_status": "Blocked",
                            "scheduler_handoff_status": "Blocked",
                            "handoff_preflight_status": "Blocked",
                            "snapshot_validity_status": "Current",
                            "snapshot_fingerprint": format!("sha256:{}", "b".repeat(64)),
                            "snapshot_fingerprint_count": 1,
                            "fingerprint_input_count": 8,
                            "guard_reason": "blocked",
                            "required_capability": "runtime_subtask_dispatcher",
                            "precondition_count": 1,
                            "satisfied_precondition_count": 0,
                            "blocked_preconditions": ["runtime_subtask_dispatcher_implemented"],
                            "check_count": 1,
                            "blocked_checks": ["dispatcher_guard_blocked"],
                            "execution_enabled": false,
                            "dispatch_enabled": false,
                            "next_action": "await_dispatcher_guard_preconditions",
                            "reason": "blocked"
                        })),
                    ),
                    (
                        LedgerEventKind::SubtaskDispatchDecisionRecorded,
                        Some(serde_json::json!({
                            "decision_id": "decision_1",
                            "parent_task_id": record.task_id,
                            "parent_run_id": record.run_id,
                            "guard_id": "guard_1",
                            "guard_count": 1,
                            "snapshot_id": "snapshot_1",
                            "queued_count": 1,
                            "source_event_count": 1,
                            "status": "Blocked",
                            "decision_status": "Blocked",
                            "candidate_status": "Blocked",
                            "dispatch_decision": "Denied",
                            "dispatch_denial_reason": "blocked",
                            "handoff_preflight_status": "Blocked",
                            "guard_status": "Blocked",
                            "snapshot_validity_status": "Current",
                            "snapshot_fingerprint": format!("sha256:{}", "b".repeat(64)),
                            "snapshot_fingerprint_count": 1,
                            "fingerprint_input_count": 8,
                            "dispatch_candidate_count": 1,
                            "eligible_candidate_count": 0,
                            "blocked_candidate_count": 1,
                            "required_capability": "runtime_subtask_dispatcher",
                            "precondition_count": 1,
                            "satisfied_precondition_count": 0,
                            "blocked_preconditions": ["runtime_subtask_dispatcher_implemented"],
                            "check_count": 1,
                            "blocked_checks": ["dispatch_decision_blocked"],
                            "execution_enabled": false,
                            "dispatch_enabled": false,
                            "next_action": "await_dispatch_decision_preconditions",
                            "reason": "blocked"
                        })),
                    ),
                    (
                        LedgerEventKind::SubtaskDispatchCandidateManifestRecorded,
                        Some(serde_json::json!({
                            "manifest_id": "manifest_1",
                            "parent_task_id": record.task_id,
                            "parent_run_id": record.run_id,
                            "decision_id": "decision_1",
                            "decision_count": 1,
                            "guard_id": "guard_1",
                            "snapshot_id": "snapshot_1",
                            "queued_count": 1,
                            "source_event_count": 1,
                            "status": "Blocked",
                            "manifest_status": "Blocked",
                            "candidate_status": "Blocked",
                            "dispatch_decision": "Denied",
                            "candidate_denial_reason": "blocked",
                            "candidate_count": 1,
                            "dispatch_candidate_count": 1,
                            "eligible_candidate_count": 0,
                            "blocked_candidate_count": 1,
                            "candidate_ids": ["subtask_1"],
                            "eligible_candidate_ids": [],
                            "blocked_candidate_ids": ["subtask_1"],
                            "candidate_manifest_fingerprint": format!("sha256:{}", "c".repeat(64)),
                            "snapshot_fingerprint": format!("sha256:{}", "b".repeat(64)),
                            "fingerprint_input_count": 8,
                            "required_capability": "runtime_subtask_dispatcher",
                            "precondition_count": 1,
                            "satisfied_precondition_count": 0,
                            "blocked_preconditions": ["runtime_subtask_dispatcher_implemented"],
                            "check_count": 1,
                            "blocked_checks": ["dispatch_candidate_manifest_blocked"],
                            "execution_enabled": false,
                            "dispatch_enabled": false,
                            "next_action": "await_dispatch_candidate_manifest_preconditions",
                            "reason": "blocked"
                        })),
                    ),
                    (
                        LedgerEventKind::SubtaskDispatchHandoffEnvelopeRecorded,
                        Some(serde_json::json!({
                            "handoff_envelope_id": "envelope_1",
                            "parent_task_id": record.task_id,
                            "parent_run_id": record.run_id,
                            "manifest_id": "manifest_1",
                            "manifest_count": 1,
                            "decision_id": "decision_1",
                            "queued_count": 1,
                            "source_event_count": 1,
                            "status": "Accepted",
                            "handoff_envelope_status": "Accepted",
                            "handoff_ticket_status": "Blocked",
                            "replay_guard_status": "Blocked",
                            "scheduler_handoff_status": "Blocked",
                            "candidate_status": "Blocked",
                            "dispatch_decision": "Denied",
                            "candidate_denial_reason": "blocked",
                            "candidate_count": 1,
                            "dispatch_candidate_count": 1,
                            "eligible_candidate_count": 0,
                            "blocked_candidate_count": 1,
                            "handoff_ticket_count": 0,
                            "candidate_ids": ["subtask_1"],
                            "eligible_candidate_ids": [],
                            "blocked_candidate_ids": ["subtask_1"],
                            "candidate_manifest_fingerprint": format!("sha256:{}", "c".repeat(64)),
                            "handoff_envelope_fingerprint": format!("sha256:{}", "d".repeat(64)),
                            "fingerprint_input_count": 8,
                            "required_capability": "runtime_subtask_dispatcher",
                            "precondition_count": 1,
                            "satisfied_precondition_count": 0,
                            "blocked_preconditions": ["runtime_subtask_dispatcher_implemented"],
                            "check_count": 1,
                            "blocked_checks": ["dispatch_handoff_envelope_blocked"],
                            "execution_enabled": false,
                            "dispatch_enabled": false,
                            "next_action": "materialize_controlled_child_task",
                            "reason": "blocked"
                        })),
                    ),
                    (
                        LedgerEventKind::ParentJoinContinuationFingerprintConsumed,
                        Some(serde_json::json!({
                            "parent_join_continuation_status": "Consumed",
                            "admission_id": "parent_join_admission_1",
                            "child_completion_fingerprint": format!("sha256:{}", "a".repeat(64)),
                            "child_completion_child_count": 1,
                            "child_terminal_completed_count": 1,
                            "child_terminal_failed_count": 0,
                            "child_recovery_cycle_depth": 0,
                            "fingerprint_input_count": 5,
                            "reason": "consumed"
                        })),
                    ),
                ],
            )
            .expect("strict subtask dispatch payloads should append");
    }

    #[test]
    fn task_terminal_status_race_serialized_by_run_terminal_mutation_lock() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = std::sync::Arc::new(TaskStore::new(temp.path()));
        let record = store
            .start_task(TaskStartParams {
                goal: "concurrent terminal race".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
                product_continuation_source: None,
            })
            .expect("start task");
        let running = store
            .update_task_status(
                &record.task_id,
                TaskStatus::Running,
                LedgerEventKind::TaskRunning,
            )
            .expect("mark running");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
        let completion_store = std::sync::Arc::clone(&store);
        let completion_barrier = std::sync::Arc::clone(&barrier);
        let completion_task_id = record.task_id.clone();
        let completion_updated_at = running.updated_at.clone();
        let completion = std::thread::spawn(move || {
            completion_barrier.wait();
            completion_store.update_task_status_with_payload_checked(
                &completion_task_id,
                TaskStatus::Running,
                &completion_updated_at,
                TaskStatus::Completed,
                LedgerEventKind::TaskCompleted,
                Some(serde_json::json!({"terminal_race_candidate": "completion"})),
            )
        });
        let cancel_store = std::sync::Arc::clone(&store);
        let cancel_barrier = std::sync::Arc::clone(&barrier);
        let cancel_task_id = record.task_id.clone();
        let cancel_updated_at = running.updated_at.clone();
        let cancel = std::thread::spawn(move || {
            cancel_barrier.wait();
            cancel_store.update_task_status_with_payload_checked(
                &cancel_task_id,
                TaskStatus::Running,
                &cancel_updated_at,
                TaskStatus::Cancelled,
                LedgerEventKind::TaskCancelled,
                Some(serde_json::json!({"terminal_race_candidate": "cancel"})),
            )
        });
        barrier.wait();

        let outcomes = vec![
            completion.join().expect("completion thread"),
            cancel.join().expect("cancel thread"),
        ];
        assert_eq!(
            outcomes.iter().filter(|outcome| outcome.is_ok()).count(),
            1,
            "exactly one terminal mutation should win the run lock"
        );
        assert_eq!(
            outcomes.iter().filter(|outcome| outcome.is_err()).count(),
            1,
            "the stale terminal mutation should fail closed"
        );
        assert!(outcomes
            .iter()
            .filter_map(|outcome| outcome.as_ref().err())
            .any(|error| error.to_string().contains("task terminal status race")));

        let current = store
            .get_task(&record.task_id)
            .expect("task lookup")
            .expect("task");
        assert!(matches!(
            current.status,
            TaskStatus::Completed | TaskStatus::Cancelled
        ));
        let events = store
            .read_ledger_events(&record.run_id)
            .expect("ledger after concurrent race");
        let terminal_events = events
            .iter()
            .filter(|event| {
                matches!(
                    event.kind,
                    LedgerEventKind::TaskCompleted | LedgerEventKind::TaskCancelled
                )
            })
            .count();
        assert_eq!(terminal_events, 1);
        assert!(!store
            .terminal_transition_marker_path(&record.run_id)
            .exists());
        assert!(!store
            .run_dir(&record.run_id)
            .join(RUN_TERMINAL_MUTATION_LOCK)
            .exists());
    }

    #[test]
    fn task_terminal_transition_process_loss_repairs_missing_terminal_ledger_event() {
        let temp = tempfile::tempdir().expect("tempdir");
        let failed =
            run_terminal_transition_child(temp.path(), TERMINAL_TRANSITION_FAILPOINT_AFTER_STATE);
        assert!(
            !failed.success(),
            "terminal transition child unexpectedly survived failpoint"
        );

        let store = TaskStore::new(temp.path());
        let tasks = store.list_tasks().expect("recover and list tasks");
        assert_eq!(tasks.len(), 1);
        let recovered = &tasks[0];
        assert_eq!(recovered.status, TaskStatus::Completed);
        let events = store
            .read_ledger_events(&recovered.run_id)
            .expect("recovered ledger");
        assert_eq!(
            events
                .iter()
                .filter(|event| event.kind == LedgerEventKind::TaskCompleted)
                .count(),
            1
        );
        assert!(!store
            .terminal_transition_marker_path(&recovered.run_id)
            .exists());
        assert!(!store
            .run_dir(&recovered.run_id)
            .join(RUN_TERMINAL_MUTATION_LOCK)
            .exists());
    }

    #[test]
    #[ignore]
    fn terminal_transition_process_failpoint_child() {
        let Some(root) = std::env::var_os(TERMINAL_TRANSITION_CHILD_ROOT_ENV) else {
            return;
        };
        let store = TaskStore::new(Path::new(&root));
        let record = store
            .start_task(TaskStartParams {
                goal: "terminal process loss".into(),
                mode_id: None,
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
                product_continuation_source: None,
            })
            .expect("start task");
        let running = store
            .update_task_status(
                &record.task_id,
                TaskStatus::Running,
                LedgerEventKind::TaskRunning,
            )
            .expect("mark running");
        store
            .update_task_status_with_payload_checked(
                &record.task_id,
                TaskStatus::Running,
                &running.updated_at,
                TaskStatus::Completed,
                LedgerEventKind::TaskCompleted,
                Some(serde_json::json!({"terminal_process_loss": true})),
            )
            .expect("terminal transition");
        if std::env::var_os(TERMINAL_TRANSITION_FAILPOINT_ENV).is_some() {
            panic!("terminal transition failpoint did not abort the child process");
        }
    }

    fn legacy_v1_durable_schema_manifest(migration: &str) -> DurableStoreSchemaManifest {
        DurableStoreSchemaManifest {
            schema_id: DURABLE_STORE_SCHEMA_ID.to_string(),
            manifest_format_version: DURABLE_STORE_SCHEMA_MANIFEST_FORMAT_VERSION,
            store_schema_version: 1,
            minimum_runtime_store_schema_version: 1,
            state: DURABLE_STORE_SCHEMA_STATE_CURRENT.to_string(),
            migration: migration.to_string(),
            layout: None,
            migration_from_store_schema_version: None,
            migration_to_store_schema_version: None,
        }
    }

    fn write_durable_schema_manifest_for_test(root: &Path, manifest: &DurableStoreSchemaManifest) {
        let body = serde_json::to_string_pretty(manifest).expect("serialize manifest");
        write_file_atomically(
            &root
                .join(WORKSPACE_STATE_DIR)
                .join(DURABLE_STORE_SCHEMA_MANIFEST),
            body.as_bytes(),
        )
        .expect("write manifest");
    }

    fn write_durable_store_layout_manifest_for_test(
        root: &Path,
        manifest: &DurableStoreLayoutManifest,
    ) {
        let body = serde_json::to_string_pretty(manifest).expect("serialize layout");
        write_file_atomically(
            &root
                .join(WORKSPACE_STATE_DIR)
                .join(DURABLE_STORE_LAYOUT_MANIFEST),
            body.as_bytes(),
        )
        .expect("write layout");
    }

    #[derive(Debug)]
    struct V1DurableFixtureEvidence {
        task_id: String,
        run_id: String,
        state_bytes: Vec<u8>,
        ledger_bytes: Vec<u8>,
        checkpoint_bytes: Vec<u8>,
        ledger_kinds: Vec<LedgerEventKind>,
        checkpoint_fingerprint: String,
    }

    fn seed_v1_store_with_task_run_ledger_and_checkpoint(root: &Path) -> V1DurableFixtureEvidence {
        let store = TaskStore::new(root);
        let record = store
            .start_task(TaskStartParams {
                goal: "preserve durable v1 fixture".into(),
                mode_id: Some("orchestrator".into()),
                verification_recovery_source: None,
                patch_apply_recovery_source: None,
                verification_recovery_retry_source: None,
                llm_provider_failure_retry_source: None,
                product_continuation_source: None,
            })
            .expect("start fixture task");
        let running = store
            .update_task_status(
                &record.task_id,
                TaskStatus::Running,
                LedgerEventKind::TaskRunning,
            )
            .expect("mark fixture running");
        let checkpoint = HeadlessObjectiveAdmissionCheckpoint {
            admission_id: "rrp-4-1-v1-fixture-admission".to_string(),
            material_fingerprint: format!("sha256:{}", "a".repeat(64)),
            journey_id: "rrp-4-1-v1-fixture-journey".to_string(),
            session_id: "rrp-4-1-v1-fixture-session".to_string(),
            drive_id: "rrp-4-1-v1-fixture-drive".to_string(),
            task_id: running.task_id.clone(),
            run_id: running.run_id.clone(),
            journey_fingerprint: format!("sha256:{}", "b".repeat(64)),
        };
        store
            .write_headless_objective_admission_checkpoint(&checkpoint)
            .expect("write fixture checkpoint");

        let run_dir = store.run_dir(&running.run_id);
        let state_path = run_dir.join("state.json");
        let ledger_path = run_dir.join("ledger.jsonl");
        let checkpoint_path = store.headless_objective_admission_path(&checkpoint.admission_id);
        let ledger_kinds = store
            .read_ledger_events(&running.run_id)
            .expect("read fixture ledger")
            .into_iter()
            .map(|event| event.kind)
            .collect::<Vec<_>>();
        let evidence = V1DurableFixtureEvidence {
            task_id: running.task_id.clone(),
            run_id: running.run_id.clone(),
            state_bytes: fs::read(&state_path).expect("read fixture state"),
            ledger_bytes: fs::read(&ledger_path).expect("read fixture ledger bytes"),
            checkpoint_bytes: fs::read(&checkpoint_path).expect("read fixture checkpoint"),
            ledger_kinds,
            checkpoint_fingerprint: checkpoint.material_fingerprint.clone(),
        };

        fs::remove_file(
            root.join(WORKSPACE_STATE_DIR)
                .join(DURABLE_STORE_LAYOUT_MANIFEST),
        )
        .expect("remove v2-only layout marker");
        write_durable_schema_manifest_for_test(
            root,
            &legacy_v1_durable_schema_manifest(DURABLE_STORE_SCHEMA_MIGRATION_INITIALIZED_V1),
        );
        evidence
    }

    fn run_durable_schema_migration_child(
        root: &Path,
        failpoint: Option<&str>,
    ) -> std::process::ExitStatus {
        let mut command = std::process::Command::new(std::env::current_exe().expect("test exe"));
        command
            .arg("--ignored")
            .arg("--nocapture")
            .arg("durable_schema_process_failpoint_child")
            .env(DURABLE_SCHEMA_MIGRATION_CHILD_ROOT_ENV, root);
        if let Some(failpoint) = failpoint {
            command.env(DURABLE_SCHEMA_MIGRATION_FAILPOINT_ENV, failpoint);
        }
        command.status().expect("run migration child")
    }

    fn run_terminal_transition_child(root: &Path, failpoint: &str) -> std::process::ExitStatus {
        std::process::Command::new(std::env::current_exe().expect("test exe"))
            .arg("--ignored")
            .arg("--nocapture")
            .arg("terminal_transition_process_failpoint_child")
            .env(TERMINAL_TRANSITION_CHILD_ROOT_ENV, root)
            .env(TERMINAL_TRANSITION_FAILPOINT_ENV, failpoint)
            .status()
            .expect("run terminal transition child")
    }

    fn assert_interrupted_migration_checkpoint(root: &Path, failpoint: &str) {
        let store = TaskStore::new(root);
        let manifest = store
            .read_durable_schema_manifest()
            .expect("read interrupted manifest")
            .expect("interrupted manifest");
        let layout = store
            .read_durable_store_layout_manifest()
            .expect("read interrupted layout");
        match failpoint {
            DURABLE_SCHEMA_MIGRATION_FAILPOINT_AFTER_IN_PROGRESS => {
                assert_eq!(
                    manifest.state,
                    DURABLE_STORE_SCHEMA_STATE_MIGRATION_IN_PROGRESS
                );
                assert_eq!(manifest.migration_from_store_schema_version, Some(1));
                assert_eq!(manifest.migration_to_store_schema_version, Some(2));
                assert!(layout.is_none());
            }
            DURABLE_SCHEMA_MIGRATION_FAILPOINT_AFTER_LAYOUT => {
                assert_eq!(
                    manifest.state,
                    DURABLE_STORE_SCHEMA_STATE_MIGRATION_IN_PROGRESS
                );
                assert_eq!(
                    layout.expect("layout after layout failpoint").layout,
                    DURABLE_STORE_LAYOUT_CURRENT
                );
            }
            DURABLE_SCHEMA_MIGRATION_FAILPOINT_AFTER_CURRENT_V2 => {
                assert_eq!(manifest.state, DURABLE_STORE_SCHEMA_STATE_CURRENT);
                assert_eq!(manifest.store_schema_version, DURABLE_STORE_SCHEMA_VERSION);
                assert_eq!(
                    layout.expect("layout after current v2 failpoint").layout,
                    DURABLE_STORE_LAYOUT_CURRENT
                );
            }
            other => panic!("unknown failpoint {other}"),
        }
    }

    fn assert_v1_fixture_preserved_and_resumable(root: &Path, fixture: &V1DurableFixtureEvidence) {
        let store = TaskStore::new(root);
        let tasks = store.list_tasks().expect("list migrated tasks");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].task_id, fixture.task_id);
        assert_eq!(tasks[0].run_id, fixture.run_id);
        assert_eq!(tasks[0].status, TaskStatus::Running);

        let run_dir = store.run_dir(&fixture.run_id);
        assert_eq!(
            fs::read(run_dir.join("state.json")).expect("read migrated state"),
            fixture.state_bytes
        );
        assert_eq!(
            fs::read(run_dir.join("ledger.jsonl")).expect("read migrated ledger"),
            fixture.ledger_bytes
        );
        let checkpoint_path =
            store.headless_objective_admission_path("rrp-4-1-v1-fixture-admission");
        assert_eq!(
            fs::read(&checkpoint_path).expect("read migrated checkpoint"),
            fixture.checkpoint_bytes
        );

        let ledger_kinds = store
            .read_ledger_events(&fixture.run_id)
            .expect("read migrated ledger events")
            .into_iter()
            .map(|event| event.kind)
            .collect::<Vec<_>>();
        assert_eq!(ledger_kinds, fixture.ledger_kinds);
        assert_eq!(
            ledger_kinds,
            vec![LedgerEventKind::TaskStarted, LedgerEventKind::TaskRunning]
        );
        let checkpoint = store
            .read_headless_objective_admission_checkpoint("rrp-4-1-v1-fixture-admission")
            .expect("read migrated checkpoint")
            .expect("checkpoint");
        assert_eq!(checkpoint.task_id, fixture.task_id);
        assert_eq!(checkpoint.run_id, fixture.run_id);
        assert_eq!(
            checkpoint.material_fingerprint,
            fixture.checkpoint_fingerprint
        );

        let resumed = store
            .update_task_status(
                &fixture.task_id,
                TaskStatus::Completed,
                LedgerEventKind::TaskCompleted,
            )
            .expect("resume migrated task lifecycle");
        assert_eq!(resumed.status, TaskStatus::Completed);
        let resumed_events = store
            .read_ledger_events(&fixture.run_id)
            .expect("read resumed ledger");
        assert_eq!(resumed_events.len(), 3);
        assert_eq!(resumed_events[2].kind, LedgerEventKind::TaskCompleted);
    }

    fn assert_no_durable_write_temps(root: &Path) {
        let state_dir = root.join(WORKSPACE_STATE_DIR);
        if !state_dir.exists() {
            return;
        }
        let mut stack = vec![state_dir];
        while let Some(dir) = stack.pop() {
            for entry in fs::read_dir(&dir).expect("read dir") {
                let entry = entry.expect("dir entry");
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }
                let name = path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("");
                assert!(
                    !name.contains(".tmp-"),
                    "durable write temporary file leaked: {}",
                    path.display()
                );
            }
        }
    }

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
                test_codebase_index_snapshot_payload(&manifest, false),
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
            test_codebase_index_snapshot_payload(&next, false),
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
            test_codebase_index_snapshot_payload(&next, false),
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
                test_codebase_index_snapshot_payload(&next, false),
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

    fn test_codebase_index_snapshot_payload(
        manifest: &CodebaseIndexSnapshotManifest,
        requested_force_refresh: bool,
    ) -> serde_json::Value {
        serde_json::json!({
            "index_id": manifest.snapshot.index_id,
            "mode_id": "orchestrator",
            "root": manifest.snapshot.root,
            "workspace_fingerprint": manifest.snapshot.workspace_fingerprint,
            "snapshot_fingerprint": manifest.snapshot.snapshot_fingerprint,
            "built_at": manifest.snapshot.built_at,
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
            "requested_force_refresh": requested_force_refresh,
            "next_action": "build_bounded_index_query_file_selection",
        })
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
                product_continuation_source: None,
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
                product_continuation_source: None,
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
                product_continuation_source: None,
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
    fn headless_journey_execution_checkpoint_namespace_does_not_collide_with_start_checkpoint() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());
        let progress = HeadlessRunProgressCheckpoint {
            progress_fingerprint: format!("sha256:{}", "a".repeat(64)),
            aggregate_sequence: 1,
        };
        let start_checkpoint = HeadlessJourneyStartCheckpoint {
            journey_id: "foo.execution".to_string(),
            session_id: "session.foo.execution".to_string(),
            drive_id: "drive.foo.execution".to_string(),
            task_id: "task.foo.execution".to_string(),
            run_id: "run.foo.execution".to_string(),
            task_start_fingerprint: format!("sha256:{}", "b".repeat(64)),
            start_progress: progress.clone(),
            journey_fingerprint: format!("sha256:{}", "c".repeat(64)),
            objective_context: None,
            product_objective_continuation_provenance: None,
        };
        store
            .write_headless_journey_start_checkpoint(&start_checkpoint)
            .expect("write start checkpoint");

        let metadata = HeadlessRunJourneyExecutionMetadata {
            journey_id: "foo".to_string(),
            task_id: "task.foo".to_string(),
            run_id: "run.foo".to_string(),
            session_id: "session.foo".to_string(),
            drive_id: "drive.foo".to_string(),
            journey_fingerprint: format!("sha256:{}", "d".repeat(64)),
            completed_boundaries: Vec::new(),
            complete: false,
            next_action: "inspect_progress_overview".to_string(),
            replayed: false,
            execution_checkpoint_fingerprint: format!("sha256:{}", "e".repeat(64)),
        };
        let execution_checkpoint = HeadlessJourneyExecutionCheckpoint {
            journey_id: "foo".to_string(),
            session_id: "session.foo".to_string(),
            drive_id: "drive.foo".to_string(),
            request_fingerprint: format!("sha256:{}", "f".repeat(64)),
            journey_fingerprint: metadata.journey_fingerprint.clone(),
            complete: false,
            metadata: metadata.clone(),
        };
        store
            .write_headless_journey_execution_checkpoint(&execution_checkpoint)
            .expect("write execution checkpoint");

        assert_eq!(
            store
                .read_headless_journey_start_checkpoint("foo.execution")
                .expect("read start checkpoint"),
            Some(start_checkpoint)
        );
        assert_eq!(
            store
                .read_headless_journey_execution_checkpoint("foo")
                .expect("read execution checkpoint"),
            Some(execution_checkpoint)
        );
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
                product_continuation_source: None,
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
                product_continuation_source: None,
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
