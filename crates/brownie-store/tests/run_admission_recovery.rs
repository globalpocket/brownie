//! Exercise the canonical lease through the public TaskStore admission path.
use brownie_protocol::{TaskStartParams, TaskStatus};
use brownie_store::{LedgerEventKind, ParentJoinContinuationRunAdmission, TaskStore};
use fs2::FileExt;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Barrier};
use std::thread;
use std::time::{Duration, Instant};

struct OwnedChild(Child);
impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn admission() -> ParentJoinContinuationRunAdmission {
    ParentJoinContinuationRunAdmission {
        child_completion_fingerprint: format!("sha256:{}", "a".repeat(64)),
        child_completion_child_count: 1,
        child_completion_fingerprint_input_count: 1,
        child_terminal_completed_count: 1,
        child_terminal_failed_count: 0,
        child_recovery_cycle_depth: 0,
    }
}

fn fixture(root: &Path) -> (TaskStore, String, PathBuf) {
    assert!(
        std::env::var_os("BROWNIE_STORE_ROOT").is_none(),
        "owned fixture requires an isolated store environment"
    );
    let store = TaskStore::new(root);
    let task = store
        .start_task(TaskStartParams {
            goal: "Owned admission recovery fixture".into(),
            mode_id: None,
            verification_recovery_source: None,
            patch_apply_recovery_source: None,
            verification_recovery_retry_source: None,
            llm_provider_failure_retry_source: None,
            product_continuation_source: None,
        })
        .unwrap();
    let lock = store
        .run_dir(&task.run_id)
        .join("parent-join-admission.lock");
    (store, task.task_id, lock)
}

fn complete_parent(store: &TaskStore, task_id: &str) {
    store
        .update_task_status(task_id, TaskStatus::Running, LedgerEventKind::TaskRunning)
        .unwrap();
    store
        .update_task_status(
            task_id,
            TaskStatus::Completed,
            LedgerEventKind::TaskCompleted,
        )
        .unwrap();
}

fn exactly_one_admission(store: &TaskStore, task_id: &str) {
    let task = store.get_task(task_id).unwrap().unwrap();
    let events = store.read_ledger_events(&task.run_id).unwrap();
    assert_eq!(events.iter().filter(|event| event.kind == LedgerEventKind::ParentJoinContinuationFingerprintConsumed).count(), 1);
    assert_eq!(
        events
            .iter()
            .filter(|event| event.kind == LedgerEventKind::TaskRunning
                && event
                    .payload
                    .as_ref()
                    .is_some_and(|payload| payload["admission_kind"] == "parent_join_continuation"))
            .count(),
        1
    );
}

#[test]
fn owned_kernel_lease_child() {
    let Some(lock) = std::env::var_os("BROWNIE_OWNED_ADMISSION_LOCK_PATH") else {
        return;
    };
    let ready = PathBuf::from(std::env::var_os("BROWNIE_OWNED_ADMISSION_READY_PATH").unwrap());
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(lock)
        .unwrap();
    file.try_lock_exclusive().unwrap();
    fs::write(ready, b"canonical inode held by owned process").unwrap();
    loop {
        thread::sleep(Duration::from_secs(1));
    }
}

#[test]
fn public_admission_excludes_live_owner_and_recovers_after_process_death() {
    let temp = tempfile::tempdir().unwrap();
    let (store, task_id, lock) = fixture(temp.path());
    assert!(store
        .admit_parent_join_continuation(&task_id, admission())
        .unwrap()
        .is_none());
    let original = fs::read(&lock).expect("public admission must retain the canonical lease inode");
    complete_parent(&store, &task_id);
    let task = store.get_task(&task_id).unwrap().unwrap();
    let before = store.read_ledger_events(&task.run_id).unwrap();
    let ready = temp.path().join("owned-child-ready");
    let mut child = OwnedChild(
        Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "owned_kernel_lease_child", "--nocapture"])
            .env("BROWNIE_OWNED_ADMISSION_LOCK_PATH", &lock)
            .env("BROWNIE_OWNED_ADMISSION_READY_PATH", &ready)
            .stdout(Stdio::null())
            .spawn()
            .unwrap(),
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    while !ready.exists() {
        assert!(
            Instant::now() < deadline,
            "owned lease holder never became ready"
        );
        assert!(
            child.0.try_wait().unwrap().is_none(),
            "owned child exited early"
        );
        thread::sleep(Duration::from_millis(5));
    }
    assert!(store
        .admit_parent_join_continuation(&task_id, admission())
        .is_err());
    assert_eq!(fs::read(&lock).unwrap(), original);
    assert_eq!(store.read_ledger_events(&task.run_id).unwrap(), before);
    child.0.kill().unwrap();
    assert!(!child.0.wait().unwrap().success());
    assert_eq!(fs::read(&lock).unwrap(), original, "no stale-file deletion");
    assert!(store
        .admit_parent_join_continuation(&task_id, admission())
        .unwrap()
        .is_some());
    assert_eq!(fs::read(&lock).unwrap(), original);
    exactly_one_admission(&store, &task_id);
    store
        .update_task_status(
            &task_id,
            TaskStatus::Completed,
            LedgerEventKind::TaskCompleted,
        )
        .unwrap();
    assert!(store
        .admit_parent_join_continuation(&task_id, admission())
        .unwrap()
        .is_none());
    exactly_one_admission(&store, &task_id);
}

#[test]
fn public_admission_normal_release_and_concurrent_reentry_remain_available() {
    let temp = tempfile::tempdir().unwrap();
    let (store, task_id, lock) = fixture(temp.path());
    complete_parent(&store, &task_id);
    let barrier = Arc::new(Barrier::new(8));
    let handles: Vec<_> = (0..8)
        .map(|_| {
            let store = store.clone();
            let task_id = task_id.clone();
            let barrier = barrier.clone();
            thread::spawn(move || {
                barrier.wait();
                store
                    .admit_parent_join_continuation(&task_id, admission())
                    .unwrap()
                    .is_some()
            })
        })
        .collect();
    let admitted = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .filter(|admitted| *admitted)
        .count();
    assert_eq!(admitted, 1);
    assert!(lock.is_file());
    assert!(store
        .admit_parent_join_continuation(&task_id, admission())
        .unwrap()
        .is_none());
    exactly_one_admission(&store, &task_id);
}

#[test]
fn public_admission_never_reclaims_unknown_legacy_ownership_by_age() {
    let temp = tempfile::tempdir().unwrap();
    for bytes in [b"2000-01-01T00:00:00Z\n".as_slice(), b"", b"unknown owner"] {
        let (store, task_id, lock) = fixture(temp.path());
        fs::create_dir_all(lock.parent().unwrap()).unwrap();
        fs::write(&lock, bytes).unwrap();
        assert!(store
            .admit_parent_join_continuation(&task_id, admission())
            .is_err());
        assert_eq!(fs::read(&lock).unwrap(), bytes);
    }
}
