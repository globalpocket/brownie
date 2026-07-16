//! Brownie persistence crate.

use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;

use anyhow::{bail, Context, Result};
use brownie_protocol::{ChildTaskSourceIntentSummary, TaskRecord, TaskStartParams, TaskStatus};
use serde::{Deserialize, Serialize};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use uuid::Uuid;

pub const WORKSPACE_STATE_DIR: &str = ".brownie";
pub const RUNS_DIR: &str = "runs";

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

    pub fn workspace_root(&self) -> &std::path::Path {
        self.task_store.workspace_root()
    }
}

#[derive(Debug, Clone)]
pub struct TaskStore {
    workspace_root: PathBuf,
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
                "execution_enabled": false,
                "scheduler_handoff_enabled": false,
                "reason": "Controlled child task materialized from parent handoff envelope; child execution remains disabled."
            })),
        )?;

        Ok(record)
    }

    pub fn update_task_status(
        &self,
        task_id: &str,
        status: TaskStatus,
        event_kind: LedgerEventKind,
    ) -> Result<TaskRecord> {
        let Some(mut record) = self.get_task(task_id)? else {
            bail!("task not found: {task_id}");
        };

        record.status = status;
        record.updated_at = timestamp()?;
        self.write_task_state(&record)?;
        self.append_task_event(&record, event_kind)?;
        Ok(record)
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
        fs::write(run_dir.join("state.json"), state).context("failed to write task state")
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
        RunLedger::new(self.run_dir(&record.run_id)).append(&LedgerEvent {
            event_id: format!("event_{}", Uuid::new_v4()),
            task_id: record.task_id.clone(),
            run_id: record.run_id.clone(),
            kind,
            timestamp: timestamp()?,
            payload,
        })
    }

    pub fn read_ledger_events(&self, run_id: &str) -> Result<Vec<LedgerEvent>> {
        RunLedger::new(self.run_dir(run_id)).read_events()
    }

    fn runs_dir(&self) -> PathBuf {
        self.workspace_root.join(WORKSPACE_STATE_DIR).join(RUNS_DIR)
    }

    pub fn workspace_root(&self) -> &std::path::Path {
        &self.workspace_root
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
        fs::create_dir_all(&self.run_dir)
            .with_context(|| format!("failed to create {}", self.run_dir.display()))?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.run_dir.join("ledger.jsonl"))
            .context("failed to open run ledger")?;
        serde_json::to_writer(&mut file, event).context("failed to serialize ledger event")?;
        writeln!(file).context("failed to write ledger newline")?;
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
pub enum LedgerEventKind {
    TaskStarted,
    ModeResolved,
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
    WorkspacePatchReadinessReportCreated,
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
    fn task_start_creates_state_and_ledger() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = TaskStore::new(temp.path());

        let record = store
            .start_task(TaskStartParams {
                goal: "test goal".into(),
                mode_id: Some("orchestrator".into()),
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
                    input_summary: brownie_protocol::ToolIntentInputSummary {
                        has_path: false,
                        field_count: 0,
                    },
                }),
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
        assert_eq!(source_intent_summary.input_summary.field_count, 0);
        assert_eq!(
            store
                .find_child_task_by_handoff_fingerprint(&parent.run_id, "sha256:child")
                .expect("find child")
                .as_ref()
                .map(|record| record.task_id.as_str()),
            Some(child.task_id.as_str())
        );
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
        assert!(payload["source_intent_summary"].get("input").is_none());
        assert_eq!(payload["execution_enabled"], false);
        assert_eq!(payload["scheduler_handoff_enabled"], false);
    }
}
