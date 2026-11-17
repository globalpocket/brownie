//! Full objective RPC chain with live index construction and acceptance refusal controls.
use brownie_protocol::{JsonRpcResponse, TaskStatus};
use brownie_store::{BrownieStore, LedgerEventKind};
use serde_json::{json, Value};
use std::{ffi::OsString, path::Path};

struct Environment(Vec<(OsString, OsString)>);
impl Environment {
    fn isolated() -> Self {
        let saved: Vec<_> = std::env::vars_os()
            .filter(|(k, _)| k.to_str().is_some_and(|k| k.starts_with("BROWNIE_")))
            .collect();
        for (k, _) in &saved {
            std::env::remove_var(k);
        }
        std::env::set_var("BROWNIE_LLM_PROVIDER", "fake");
        Self(saved)
    }
}
impl Drop for Environment {
    fn drop(&mut self) {
        for (k, _) in std::env::vars_os()
            .filter(|(k, _)| k.to_str().is_some_and(|k| k.starts_with("BROWNIE_")))
        {
            std::env::remove_var(k);
        }
        for (k, v) in &self.0 {
            std::env::set_var(k, v);
        }
    }
}
fn parse_line(line: &str) -> JsonRpcResponse<Value> {
    serde_json::from_str(&brownie_runtime::handle_jsonrpc_input_line(line).expect("RPC response"))
        .expect("typed response")
}
fn rpc(method: &str, params: Value) -> Value {
    let response =
        parse_line(&json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}).to_string());
    assert!(response.error.is_none(), "{:?}", response.error);
    response.result.expect("result")
}
fn prepared_selected_index_context(workspace: &Path, content: &str) -> (BrownieStore, Value) {
    std::fs::create_dir_all(workspace.join("src/runtime")).unwrap();
    std::fs::write(workspace.join("src/runtime/query.rs"), content).unwrap();
    std::fs::write(workspace.join("src/lib.rs"), "pub fn other() {}\n").unwrap();
    std::env::set_var("BROWNIE_WORKSPACE_ROOT", workspace);
    rpc(
        "codebase.index.build",
        json!({"mode_id":"orchestrator","max_files":20}),
    );
    let q = rpc(
        "codebase.index.query",
        json!({"mode_id":"orchestrator","query":"runtime rs","max_results":2,"file_kind":"Rust"}),
    );
    let mut input = json!({"file_kind_filter":"Rust","read_path":"src/runtime/query.rs"});
    for key in [
        "query_id",
        "selection_id",
        "query_fingerprint",
        "snapshot",
        "max_results",
        "entries",
    ] {
        input[key] = q[key].clone();
    }
    let read = rpc(
        "tool.execute",
        json!({"mode_id":"orchestrator","tool_id":"codebase.index.selection.read","input":input}),
    );
    assert_eq!(read["status"], "Completed");
    (BrownieStore::new(workspace), read["output"].clone())
}

#[test]
fn headless_continue_applies_objective_proposal_after_authorization_preflight_and_replays() {
    let _environment = Environment::isolated();
    let temp = tempfile::tempdir().expect("tempdir");
    std::fs::write(temp.path().join("README.md"), "original README").expect("write readme");
    let (_store, selected_context) = prepared_selected_index_context(
        temp.path(),
        "pub fn selected_context_for_objective_apply() {}\n",
    );
    let store = BrownieStore::new(temp.path());
    let drive_request = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "headless.run.drive",
        "params": {
            "authorize": true,
            "session_id": "m56.apply",
            "drive_id": "m56.apply.drive",
            "expected_start_session_sequence": 0,
            "max_advances": 1,
            "max_steps_per_advance": 1,
            "context_budget": {
                "max_prompt_chars": 8192,
                "max_ledger_events": 16,
                "max_selected_index_chars": 1024
            },
            "journey_admission": {
                "journey_id": "m56.apply.1",
                "authorize_journey_start": true,
                "task_start": {
                    "goal": "Implement README update",
                    "mode_id": "implementer"
                },
                "objective_context": {
                    "authorize_objective_context_admission": true,
                    "objective_id": "m56.objective.apply",
                    "objective_fingerprint": format!("sha256:{}", "8".repeat(64)),
                    "selected_index_context": selected_context
                }
            }
        }
    });
    let drive = parse_line(&drive_request.to_string())
        .result
        .expect("drive result");
    let candidate = &drive["objective_proposal_candidate"];
    let run_id = candidate["run_id"].as_str().expect("run id").to_string();
    let proposal_id = candidate["proposal_id"]
        .as_str()
        .expect("proposal id")
        .to_string();
    let progress = drive["post_progress"].as_object().expect("post progress");
    let authorization_target = json!({
        "authorize_objective_proposal_preflight": true,
        "journey_id": candidate["journey_id"],
        "session_id": candidate["session_id"],
        "source_drive_id": candidate["drive_id"],
        "expected_journey_fingerprint": drive["journey"]["journey_fingerprint"],
        "expected_candidate_fingerprint": candidate["candidate_fingerprint"],
        "expected_objective_context_fingerprint": candidate["objective_context_fingerprint"],
        "expected_selected_context_fingerprint": candidate["selected_context_fingerprint"],
        "expected_task_id": candidate["task_id"],
        "expected_run_id": candidate["run_id"],
        "expected_proposal_id": candidate["proposal_id"],
        "expected_source_event_id": candidate["source_event_id"],
        "expected_source_event_kind": candidate["source_event_kind"],
        "expected_operation": candidate["operation"],
        "expected_path_fingerprint": candidate["path_fingerprint"],
        "expected_validation_status": candidate["validation_status"],
        "expected_approval_status": candidate["approval_status"],
        "authorization_token_fingerprint": format!("sha256:{}", "c".repeat(64)),
    });
    let authorization_request = json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "headless.continue_once",
        "params": {
            "authorize": true,
            "continuation_id": "m56.apply.auth.preflight",
            "expected_progress_fingerprint": progress["progress_fingerprint"],
            "expected_aggregate_sequence": progress["aggregate_sequence"],
            "objective_proposal_authorization_preflight_target": authorization_target
        }
    });
    let authorized = parse_line(&authorization_request.to_string())
        .result
        .expect("authorization result");
    let authorization_result = &authorized["objective_proposal_authorization_preflight_result"];
    let expected_hash = authorization_result["preflight_snapshot"]["file_sha256"]
        .as_str()
        .expect("preflight file hash")
        .to_string();
    let apply_progress_fingerprint = authorized["post_progress_fingerprint"]
        .as_str()
        .expect("post progress")
        .to_string();
    let apply_aggregate_sequence = authorized["post_aggregate_sequence"]
        .as_u64()
        .expect("post sequence");
    let apply_target = json!({
        "authorize_objective_proposal_apply": true,
        "authorization_preflight_continuation_id": "m56.apply.auth.preflight",
        "expected_authorization_preflight_decision_id": authorized["decision_id"],
        "journey_id": authorization_result["journey_id"],
        "session_id": authorization_result["session_id"],
        "source_drive_id": authorization_result["source_drive_id"],
        "expected_journey_fingerprint": drive["journey"]["journey_fingerprint"],
        "expected_candidate_fingerprint": authorization_result["candidate_fingerprint"],
        "expected_objective_context_fingerprint": authorization_result["objective_context_fingerprint"],
        "expected_selected_context_fingerprint": authorization_result["selected_context_fingerprint"],
        "expected_task_id": authorization_result["task_id"],
        "expected_run_id": authorization_result["run_id"],
        "expected_proposal_id": authorization_result["proposal_id"],
        "expected_source_event_id": authorization_result["source_event_id"],
        "expected_source_event_kind": authorization_result["source_event_kind"],
        "expected_operation": authorization_result["operation"],
        "expected_path_fingerprint": authorization_result["path_fingerprint"],
        "expected_validation_status": authorization_result["validation_status"],
        "expected_approval_status": authorization_result["approval_status"],
        "expected_authorization_preflight_fingerprint": authorization_result["authorization_preflight_fingerprint"],
        "expected_preflight_snapshot_id": authorization_result["preflight_snapshot"]["snapshot_id"],
        "expected_apply_plan_id": authorization_result["apply_plan"]["plan_id"],
        "expected_target_sha256": expected_hash,
        "patch_old_text": "original README",
        "patch_new_text": "new README content"
    });
    let mut denied_target = apply_target.clone();
    denied_target["expected_authorization_preflight_fingerprint"] =
        json!(format!("sha256:{}", "9".repeat(64)));
    let denied = parse_line(
        &json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "headless.continue_once",
            "params": {
                "authorize": true,
                "continuation_id": "m56.apply.denied",
                "expected_progress_fingerprint": apply_progress_fingerprint,
                "expected_aggregate_sequence": apply_aggregate_sequence,
                "objective_proposal_apply_target": denied_target
            }
        })
        .to_string(),
    )
    .error
    .expect("denied apply");
    assert_eq!(denied.code, -32602);
    assert_eq!(
        std::fs::read_to_string(temp.path().join("README.md")).expect("readme"),
        "original README"
    );
    assert_eq!(
        store
            .tasks()
            .read_ledger_events(&run_id)
            .expect("events")
            .iter()
            .filter(|event| event.kind == LedgerEventKind::WorkspacePatchApplyResultRecorded)
            .count(),
        0
    );

    let apply_request = json!({
        "jsonrpc": "2.0",
        "id": 4,
        "method": "headless.continue_once",
        "params": {
            "authorize": true,
            "continuation_id": "m56.apply.objective",
            "expected_progress_fingerprint": apply_progress_fingerprint,
            "expected_aggregate_sequence": apply_aggregate_sequence,
            "objective_proposal_apply_target": apply_target
        }
    });
    let applied = parse_line(&apply_request.to_string());
    assert!(applied.error.is_none(), "apply error: {:?}", applied.error);
    let applied = applied.result.expect("apply result");
    assert_eq!(applied["status"], "task_executed");
    assert_eq!(applied["task_run_result"], Value::Null);
    assert_eq!(
        applied["objective_proposal_authorization_preflight_result"],
        Value::Null
    );
    assert_eq!(
        applied["proposal_apply_result"]["apply_result"]["apply_status"],
        "Applied"
    );
    assert_eq!(
        applied["proposal_apply_result"]["apply_result"]["applied"],
        true
    );
    assert_eq!(
        applied["proposal_apply_result"]["apply_result"]["authorization_consumed"],
        true
    );
    assert_eq!(
        applied["next_route"]["kind"],
        "verify_objective_apply_explicitly"
    );
    assert_eq!(
        std::fs::read_to_string(temp.path().join("README.md")).expect("readme"),
        "new README content"
    );
    let apply_id = applied["proposal_apply_result"]["apply_result"]["apply_id"]
        .as_str()
        .expect("apply id")
        .to_string();
    let apply_event_count = || {
        store
            .tasks()
            .read_ledger_events(&run_id)
            .expect("events")
            .iter()
            .filter(|event| event.kind == LedgerEventKind::WorkspacePatchApplyResultRecorded)
            .count()
    };
    assert_eq!(apply_event_count(), 1);
    let checkpoint = store
        .read_headless_objective_proposal_apply_checkpoint("m56.apply.objective")
        .expect("read checkpoint")
        .expect("checkpoint");
    assert_eq!(checkpoint.proposal_id, proposal_id);
    assert_eq!(checkpoint.result.apply_result.apply_id, apply_id);
    assert!(checkpoint.replacement_content_sha256.starts_with("sha256:"));
    let apply_fingerprint = checkpoint.apply_fingerprint.clone();
    let post_write_sha256 = checkpoint
        .result
        .apply_result
        .post_write_sha256
        .clone()
        .expect("post write hash");

    let replay = parse_line(&apply_request.to_string())
        .result
        .expect("apply replay");
    assert_eq!(replay["replayed"], true);
    assert_eq!(
        replay["proposal_apply_result"]["apply_result"]["apply_id"],
        apply_id
    );
    assert_eq!(apply_event_count(), 1);
    let bounded_events: Vec<_> = store
        .tasks()
        .read_ledger_events(&run_id)
        .expect("events")
        .into_iter()
        .filter(|event| {
            matches!(
                event.kind,
                LedgerEventKind::WorkspacePatchApplyResultRecorded
                    | LedgerEventKind::HeadlessContinuationDecisionRecorded
            )
        })
        .collect();
    let serialized_events = serde_json::to_string(&bounded_events).unwrap();
    for forbidden in [
        "new README content",
        "raw_content",
        "full_content",
        "raw_input",
        "file_content",
    ] {
        assert!(!serialized_events.contains(forbidden));
    }

    let verify_target = json!({
        "authorize_objective_apply_verification": true,
        "objective_apply_continuation_id": "m56.apply.objective",
        "expected_objective_apply_decision_id": applied["decision_id"],
        "journey_id": authorization_result["journey_id"],
        "session_id": authorization_result["session_id"],
        "source_drive_id": authorization_result["source_drive_id"],
        "expected_task_id": authorization_result["task_id"],
        "expected_run_id": authorization_result["run_id"],
        "expected_proposal_id": authorization_result["proposal_id"],
        "expected_apply_id": apply_id,
        "expected_operation": "patch_file",
        "expected_apply_status": "Applied",
        "expected_authorization_consumed": true,
        "expected_path_fingerprint": authorization_result["path_fingerprint"],
        "expected_apply_fingerprint": apply_fingerprint,
        "expected_post_write_sha256": post_write_sha256
    });
    let verify_request = json!({
        "jsonrpc": "2.0",
        "id": 5,
        "method": "headless.continue_once",
        "params": {
            "authorize": true,
            "continuation_id": "m56.apply.verify",
            "expected_progress_fingerprint": applied["post_progress_fingerprint"],
            "expected_aggregate_sequence": applied["post_aggregate_sequence"],
            "objective_apply_verification_target": verify_target
        }
    });
    let verified = parse_line(&verify_request.to_string())
        .result
        .expect("verify result");
    assert_eq!(verified["status"], "task_executed");
    assert_eq!(
        verified["next_route"]["kind"],
        "accept_objective_completion_explicitly"
    );
    assert_eq!(verified["next_action"], "accept_objective_completion");
    assert_eq!(
        verified["objective_apply_verification_result"]["verification_status"],
        "verified"
    );
    assert_eq!(
        verified["objective_apply_verification_result"]["route_kind"],
        "accept_objective_completion_explicitly"
    );
    assert_eq!(
        verified["objective_apply_verification_result"]["current_target_sha256"],
        post_write_sha256
    );
    assert_eq!(
        verified["objective_apply_verification_result"]["next_action"],
        "accept_objective_completion"
    );
    let verification_checkpoint = store
        .read_headless_objective_apply_verification_checkpoint("m56.apply.verify")
        .expect("read verification checkpoint")
        .expect("verification checkpoint");
    assert_eq!(verification_checkpoint.verification_status, "verified");
    assert_eq!(
        verification_checkpoint.current_target_sha256,
        post_write_sha256
    );
    let completion_target = json!({
        "authorize_objective_completion_acceptance": true,
        "objective_apply_verification_continuation_id": "m56.apply.verify",
        "expected_objective_apply_verification_decision_id": verified["decision_id"],
        "journey_id": authorization_result["journey_id"],
        "session_id": authorization_result["session_id"],
        "source_drive_id": authorization_result["source_drive_id"],
        "expected_task_id": authorization_result["task_id"],
        "expected_run_id": authorization_result["run_id"],
        "expected_proposal_id": authorization_result["proposal_id"],
        "expected_apply_id": apply_id,
        "expected_operation": "replace_file",
        "expected_apply_status": "Applied",
        "expected_authorization_consumed": true,
        "expected_path_fingerprint": authorization_result["path_fingerprint"],
        "expected_apply_fingerprint": apply_fingerprint,
        "expected_post_write_sha256": post_write_sha256,
        "expected_current_target_sha256": verification_checkpoint.current_target_sha256,
        "expected_verification_status": "verified",
        "expected_verification_route_kind": "accept_objective_completion_explicitly",
        "expected_verification_fingerprint": verification_checkpoint
            .request_fingerprint
            .clone()
            .expect("verification request fingerprint"),
    });
    let denied_completion = parse_line(
        &json!({
            "jsonrpc": "2.0",
            "id": 7,
            "method": "headless.continue_once",
            "params": {
                "authorize": true,
                "continuation_id": "m56.apply.complete.denied",
                "expected_progress_fingerprint": verified["post_progress_fingerprint"],
                "expected_aggregate_sequence": verified["post_aggregate_sequence"],
                "objective_completion_acceptance_target": {
                    "authorize_objective_completion_acceptance": false,
                    "objective_apply_verification_continuation_id": "m56.apply.verify",
                    "expected_objective_apply_verification_decision_id": verified["decision_id"],
                    "journey_id": authorization_result["journey_id"],
                    "session_id": authorization_result["session_id"],
                    "source_drive_id": authorization_result["source_drive_id"],
                    "expected_task_id": authorization_result["task_id"],
                    "expected_run_id": authorization_result["run_id"],
                    "expected_proposal_id": authorization_result["proposal_id"],
                    "expected_apply_id": apply_id,
                    "expected_operation": "replace_file",
                    "expected_apply_status": "Applied",
                    "expected_authorization_consumed": true,
                    "expected_path_fingerprint": authorization_result["path_fingerprint"],
                    "expected_apply_fingerprint": apply_fingerprint,
                    "expected_post_write_sha256": post_write_sha256,
                    "expected_current_target_sha256": verification_checkpoint.current_target_sha256,
                    "expected_verification_status": "verified",
                    "expected_verification_route_kind": "accept_objective_completion_explicitly",
                    "expected_verification_fingerprint": verification_checkpoint
                        .request_fingerprint
                        .clone()
                        .expect("verification request fingerprint"),
                }
            }
        })
        .to_string(),
    )
    .error
    .expect("denied completion");
    assert_eq!(denied_completion.code, -32602);
    assert!(store
        .read_headless_objective_completion_acceptance_checkpoint("m56.apply.complete.denied")
        .expect("read denied completion checkpoint")
        .is_none());
    let completion_request = json!({
        "jsonrpc": "2.0",
        "id": 8,
        "method": "headless.continue_once",
        "params": {
            "authorize": true,
            "continuation_id": "m56.apply.complete",
            "expected_progress_fingerprint": verified["post_progress_fingerprint"],
            "expected_aggregate_sequence": verified["post_aggregate_sequence"],
            "objective_completion_acceptance_target": completion_target
        }
    });
    let verified_bytes = std::fs::read(temp.path().join("README.md")).expect("verified bytes");
    let ledger_before = store.tasks().read_ledger_events(&run_id).expect("ledger");
    for changed_content in [Some("changed after verification"), None] {
        let path = temp.path().join("README.md");
        match changed_content {
            Some(content) => std::fs::write(&path, content).expect("change verified target"),
            None => std::fs::remove_file(&path).expect("remove verified target"),
        }
        let refused = parse_line(&completion_request.to_string())
            .error
            .expect("stale target must not be accepted");
        assert_eq!(refused.code, -32602);
        assert!(
            refused.message.to_ascii_lowercase().contains("target"),
            "{}",
            refused.message
        );
        assert!(store
            .read_headless_objective_completion_acceptance_checkpoint("m56.apply.complete")
            .expect("read refused completion")
            .is_none());
        assert_eq!(
            store.tasks().read_ledger_events(&run_id).expect("ledger"),
            ledger_before
        );
        std::fs::write(path, &verified_bytes).expect("restore verified target");
    }
    // Wrong evidence must not create a completion or consume the continuation.
    for field in ["expected_apply_id", "expected_verification_fingerprint"] {
        let mut conflicting = completion_request.clone();
        conflicting["params"]["objective_completion_acceptance_target"][field] =
            if field.ends_with("fingerprint") {
                json!(format!("sha256:{}", "0".repeat(64)))
            } else {
                json!("different_apply")
            };
        assert_eq!(
            parse_line(&conflicting.to_string())
                .error
                .expect("conflicting evidence refused")
                .code,
            -32602
        );
        assert!(store
            .read_headless_objective_completion_acceptance_checkpoint("m56.apply.complete")
            .unwrap()
            .is_none());
        assert_eq!(
            store.tasks().read_ledger_events(&run_id).unwrap(),
            ledger_before
        );
    }
    let completed = parse_line(&completion_request.to_string())
        .result
        .expect("completion acceptance result");
    assert_eq!(completed["status"], "task_executed");
    assert_eq!(completed["next_action"], "close_headless_run");
    assert_eq!(completed["next_route"]["kind"], "refresh_progress_overview");
    assert_eq!(completed["next_route"]["next_action"], "close_headless_run");
    assert_eq!(
        completed["objective_completion_acceptance_result"]["acceptance_status"],
        "accepted"
    );
    assert_eq!(
        completed["objective_completion_acceptance_result"]["verification_status"],
        "verified"
    );
    assert_eq!(
        completed["objective_completion_acceptance_result"]["current_target_sha256"],
        post_write_sha256
    );
    assert_eq!(
        completed["objective_completion_acceptance_result"]["next_action"],
        "close_headless_run"
    );
    let completion_checkpoint = store
        .read_headless_objective_completion_acceptance_checkpoint("m56.apply.complete")
        .expect("read completion checkpoint")
        .expect("completion checkpoint");
    assert_eq!(completion_checkpoint.acceptance_status, "accepted");
    assert_eq!(
        completion_checkpoint.expected_verification_fingerprint,
        verification_checkpoint
            .request_fingerprint
            .clone()
            .expect("verification request fingerprint")
    );
    let completion_events = || {
        store
            .tasks()
            .read_ledger_events(&run_id)
            .expect("events")
            .iter()
            .filter(|event| event.kind == LedgerEventKind::HeadlessContinuationDecisionRecorded)
            .filter(|event| {
                event
                    .payload
                    .as_ref()
                    .and_then(|payload| payload.get("authorize_objective_completion_acceptance"))
                    .and_then(Value::as_bool)
                    == Some(true)
            })
            .count()
    };
    assert_eq!(completion_events(), 1);
    std::fs::write(temp.path().join("README.md"), "subsequent user edit").unwrap();
    let completion_replay = parse_line(&completion_request.to_string())
        .result
        .expect("completion replay");
    assert_eq!(completion_replay["replayed"], true);
    assert_eq!(completion_replay["decision_id"], completed["decision_id"]);
    assert_eq!(
        completion_replay["objective_completion_acceptance_result"]["acceptance_fingerprint"],
        completed["objective_completion_acceptance_result"]["acceptance_fingerprint"]
    );
    assert_eq!(
        completion_replay["objective_completion_acceptance_result"]["replayed"],
        true
    );
    assert_eq!(completion_events(), 1);
    assert_eq!(
        std::fs::read_to_string(temp.path().join("README.md")).unwrap(),
        "subsequent user edit"
    );
    std::fs::write(temp.path().join("README.md"), &verified_bytes).unwrap();
    let verify_replay = parse_line(&verify_request.to_string())
        .result
        .expect("verify replay");
    assert_eq!(verify_replay["replayed"], true);
    assert_eq!(
        verify_replay["next_route"]["kind"],
        verified["next_route"]["kind"]
    );
    assert_eq!(
        verify_replay["objective_apply_verification_result"]["verification_fingerprint"],
        verified["objective_apply_verification_result"]["verification_fingerprint"]
    );
    assert_eq!(
        verify_replay["objective_apply_verification_result"]["replayed"],
        true
    );

    std::fs::write(temp.path().join("README.md"), "drifted README").expect("drift target");
    let mismatch_request = json!({
        "jsonrpc": "2.0",
        "id": 6,
        "method": "headless.continue_once",
        "params": {
            "authorize": true,
            "continuation_id": "m56.apply.verify.mismatch",
            "expected_progress_fingerprint": verified["post_progress_fingerprint"],
            "expected_aggregate_sequence": verified["post_aggregate_sequence"],
            "objective_apply_verification_target": verify_target
        }
    });
    let mismatch = parse_line(&mismatch_request.to_string())
        .result
        .expect("mismatch result");
    assert_eq!(
        mismatch["next_route"]["kind"],
        "start_verification_recovery_explicitly"
    );
    assert_eq!(mismatch["next_action"], "start_verification_recovery");
    let mismatch_checkpoint = store
        .read_headless_objective_apply_verification_checkpoint("m56.apply.verify.mismatch")
        .expect("read mismatch checkpoint")
        .expect("mismatch checkpoint");
    assert_eq!(mismatch_checkpoint.verification_status, "mismatch");
    assert_eq!(
        std::fs::read_to_string(temp.path().join("README.md")).expect("readme"),
        "drifted README"
    );

    // Applying a proposal consumes only its matching preflight checkpoint.
    // A later scoped resume must not route that checkpoint back to apply.
    store
        .tasks()
        .update_task_status(
            candidate["task_id"].as_str().expect("task id"),
            TaskStatus::Failed,
            LedgerEventKind::TaskFailed,
        )
        .expect("terminalize applied task");
    let current_progress = parse_line(r#"{"jsonrpc":"2.0","id":9,"method":"task.list"}"#)
        .result
        .expect("current progress")["progress_overview"]
        .clone();
    let resumed = parse_line(&format!(
        r#"{{"jsonrpc":"2.0","id":10,"method":"headless.continue_once","params":{{"authorize":true,"continuation_id":"m56.apply.resume.after-consumption","expected_progress_fingerprint":"{}","expected_aggregate_sequence":{},"continuation_scope":{{"session_id":"m56.apply"}}}}}}"#,
        current_progress["source_fingerprint"].as_str().expect("fingerprint"),
        current_progress["aggregate_sequence"].as_u64().expect("sequence"),
    ))
    .result
    .expect("resume after consumed preflight");
    assert_eq!(resumed["status"], "no_eligible_task");
    assert_eq!(resumed["candidate_count"], 0);
    assert!(resumed["objective_proposal_authorization_preflight_result"].is_null());

    std::env::remove_var("BROWNIE_WORKSPACE_ROOT");
}
