//! Process-loss recovery cases, invoked through stable parent test names.
use super::*;

#[cfg(any(unix, windows))]
pub(super) fn durable_transaction_child_probe() {
    let Some(root) = std::env::var_os("CODEX_TX_ROOT") else {
        return;
    };
    let _guard = lock_env();
    let root = std::path::PathBuf::from(root);
    std::env::set_var("BROWNIE_WORKSPACE_ROOT", &root);
    let phase = std::env::var("CODEX_TX_PHASE").unwrap();
    let operation = std::env::var("CODEX_TX_OPERATION").unwrap();
    let request = if phase == "setup" {
        if operation != "create_file" {
            std::fs::write(root.join("README.md"), "original README").unwrap();
            std::fs::write(root.join("NOTES.md"), "original notes").unwrap();
        }
        let start = parse_line(r#"{"jsonrpc":"2.0","id":1,"method":"task.start","params":{"goal":"Implement bounded two-file update","mode_id":"implementer"}}"#).result.unwrap();
        let store = BrownieStore::new(&root);
        let task = store
            .tasks()
            .get_task(start["task_id"].as_str().unwrap())
            .unwrap()
            .unwrap();
        let mut items = Vec::new();
        for (id, path, content) in [
            ("tx-a", "README.md", "updated README"),
            ("tx-b", "NOTES.md", "updated notes"),
        ] {
            append_generated_patch_proposal(
                &store,
                &task,
                id,
                path,
                &operation,
                if operation == "delete_file" {
                    ""
                } else {
                    content
                },
            );
            assert!(parse_line(&json!({"jsonrpc":"2.0","id":2,"method":"proposal.approve","params":{"run_id":task.run_id,"proposal_id":id,"reason":"owned transaction test"}}).to_string()).error.is_none());
            let preflight=parse_line(&json!({"jsonrpc":"2.0","id":3,"method":"proposal.preflight","params":{"run_id":task.run_id,"proposal_id":id}}).to_string()).result.unwrap();
            let mut item = json!({"proposal_id":id,"expected_target_sha256":preflight["snapshot"]["file_sha256"]});
            if operation == "create_file" {
                item["expected_target_absent"] = json!(true);
            }
            item["replacement_content"] = json!(if operation == "delete_file" {
                ""
            } else {
                content
            });
            items.push(item);
        }
        let mut request = json!({"jsonrpc":"2.0","id":4,"method":"proposal.apply","params":{"run_id":task.run_id,"proposal_id":"tx-a","authorize":true,"transaction_items":items}});
        if std::env::var("CODEX_TX_EXPLICIT").as_deref() == Ok("true") {
            let first_hash = format!(
                "sha256:{}",
                hex_sha256(if operation == "delete_file" {
                    b"original README"
                } else {
                    b"updated README"
                })
            );
            let second_hash = format!("sha256:{}", hex_sha256(b"original notes"));
            let mut source = match operation.as_str() {
                "create_file" => partial_create_transaction_source_payload(
                    "tx-source",
                    "source-apply",
                    "source-tx",
                    "tx-a",
                    "tx-b",
                    &first_hash,
                ),
                "delete_file" => partial_delete_transaction_source_payload(
                    "tx-source",
                    "source-apply",
                    "source-tx",
                    "tx-a",
                    "tx-b",
                    &first_hash,
                    &second_hash,
                ),
                _ => partial_transaction_source_payload(
                    "tx-source",
                    "source-apply",
                    "source-tx",
                    "tx-a",
                    "tx-b",
                    &first_hash,
                    &second_hash,
                ),
            };
            source["transaction_items"][0]["path"] = json!("README.md");
            source["transaction_items"][1]["path"] = json!("NOTES.md");
            if operation == "delete_file" {
                std::fs::remove_file(root.join("README.md")).unwrap();
            } else {
                std::fs::write(root.join("README.md"), "updated README").unwrap();
            }
            let fingerprint = transaction_source_fingerprint(&source).unwrap();
            store
                .tasks()
                .append_task_event_with_payload(
                    &task,
                    LedgerEventKind::WorkspacePatchApplyResultRecorded,
                    Some(source),
                )
                .unwrap();
            request["params"]["proposal_id"] = json!("tx-b");
            request["params"]["transaction_items"]
                .as_array_mut()
                .unwrap()
                .remove(0);
            request["params"]["transaction_recovery_source"] = json!({"source_run_id":task.run_id,"source_apply_id":"source-apply","source_transaction_id":"source-tx","expected_source_transaction_fingerprint":fingerprint});
        }
        let request = request.to_string();
        std::fs::write(root.join("request.json"), &request).unwrap();
        request
    } else {
        std::fs::read_to_string(root.join("request.json")).unwrap()
    };
    let response = handle_jsonrpc_input_line(&request).unwrap();
    std::fs::write(root.join(format!("response-{phase}.json")), response).unwrap();
}

#[cfg(any(unix, windows))]
pub(super) fn durable_replace_transaction_owned_process_recovery() {
    durable_transaction_owned_process_recovery("replace_file", false);
}

#[cfg(any(unix, windows))]
pub(super) fn durable_create_transaction_owned_process_recovery() {
    durable_transaction_owned_process_recovery("create_file", false);
}

#[cfg(any(unix, windows))]
pub(super) fn durable_delete_transaction_owned_process_recovery() {
    durable_transaction_owned_process_recovery("delete_file", false);
}

#[cfg(any(unix, windows))]
pub(super) fn durable_explicit_transaction_owned_process_recovery() {
    for operation in ["replace_file", "create_file", "delete_file"] {
        durable_transaction_owned_process_recovery(operation, true);
    }
}

#[cfg(any(unix, windows))]
fn durable_transaction_owned_process_recovery(operation: &str, explicit: bool) {
    #[cfg(unix)]
    use std::os::unix::process::ExitStatusExt;
    let ordinary_cases = [
        "normal",
        "tx-before",
        "tx-after-0",
        "tx-after-1",
        "tx-recorded",
        "tx-terminal",
        "changed-second",
        "reordered",
        "missing-second-material",
        "altered-terminal",
    ];
    let explicit_cases = [
        "normal",
        "tx-before",
        "tx-after-0",
        "tx-recorded",
        "tx-terminal",
        "changed-source",
        "changed-source-fingerprint",
        "missing-second-material",
        "altered-terminal",
    ];
    for case in if explicit {
        explicit_cases.as_slice()
    } else {
        ordinary_cases.as_slice()
    }
    .iter()
    .copied()
    {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path();
        let boundary = match case {
            "normal" => None,
            "changed-second" | "reordered" | "changed-source" | "changed-source-fingerprint" => {
                Some("tx-after-0")
            }
            "missing-second-material" => Some("tx-before"),
            "altered-terminal" => Some("tx-terminal"),
            _ => Some(case),
        };
        let invoke = |phase: &str, boundary: Option<&str>| {
            let mut command = std::process::Command::new(std::env::current_exe().unwrap());
            command
                .env_clear()
                .envs(std::env::vars_os().filter(|(key, _)| {
                    !key.to_string_lossy().starts_with("BROWNIE_")
                        && !key.to_string_lossy().starts_with("CODEX_R05_2_")
                        && !key.to_string_lossy().starts_with("CODEX_TX_")
                }));
            command
                .args([
                    "--exact",
                    "tests::durable_transaction_child_probe",
                    "--nocapture",
                ])
                .env("CODEX_TX_ROOT", root)
                .env("CODEX_TX_PHASE", phase)
                .env("CODEX_TX_OPERATION", operation)
                .env("CODEX_TX_EXPLICIT", explicit.to_string());
            if let Some(boundary) = boundary {
                let marker = root.join("boundary");
                command
                    .env("CODEX_R05_2_EXIT", boundary)
                    .env("CODEX_R05_2_KILL_MARKER", &marker);
                command
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped());
                let mut child = command.spawn().unwrap();
                let pid = child.id();
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
                loop {
                    if marker.exists() {
                        assert_eq!(std::fs::read_to_string(&marker).unwrap(), boundary);
                        assert!(child.try_wait().unwrap().is_none());
                        child.kill().unwrap();
                        let output = child.wait_with_output().unwrap();
                        #[cfg(unix)]
                        assert_eq!(output.status.signal(), Some(9));
                        #[cfg(windows)]
                        assert!(
                            !output.status.success(),
                            "owned child must terminate unsuccessfully"
                        );
                        eprintln!(
                            "transaction operation={operation} case={case} pid={pid} boundary={boundary} status={}",
                            output.status
                        );
                        return output;
                    }
                    if let Some(status) = child.try_wait().unwrap() {
                        panic!("{case}: child ended before boundary: {status}");
                    }
                    if std::time::Instant::now() >= deadline {
                        child.kill().unwrap();
                        let output = child.wait_with_output().unwrap();
                        panic!("{case}: timeout; child reaped: {output:?}");
                    }
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
            }
            command.output().unwrap()
        };
        let setup = invoke("setup", boundary);
        if boundary.is_none() {
            assert!(
                setup.status.success(),
                "{}",
                String::from_utf8_lossy(&setup.stderr)
            );
        }
        let mut request: Value =
            serde_json::from_slice(&std::fs::read(root.join("request.json")).unwrap()).unwrap();
        let run = root
            .join(".brownie/runs")
            .join(request["params"]["run_id"].as_str().unwrap());
        let intent = run.join("apply-transaction-intent.json");
        let negative = matches!(
            case,
            "changed-second"
                | "reordered"
                | "missing-second-material"
                | "altered-terminal"
                | "changed-source"
                | "changed-source-fingerprint"
        );
        match case {
            "changed-source" => {
                std::fs::write(root.join("README.md"), "external source change").unwrap();
            }
            "changed-source-fingerprint" => {
                request["params"]["transaction_recovery_source"]
                    ["expected_source_transaction_fingerprint"] =
                    json!(format!("sha256:{}", "0".repeat(64)));
                std::fs::write(root.join("request.json"), request.to_string()).unwrap();
            }
            "changed-second" => std::fs::write(root.join("NOTES.md"), "external change").unwrap(),
            "reordered" => {
                request["params"]["transaction_items"]
                    .as_array_mut()
                    .unwrap()
                    .reverse();
                std::fs::write(root.join("request.json"), request.to_string()).unwrap();
            }
            "missing-second-material" => {
                let state: Value =
                    serde_json::from_slice(&std::fs::read(&intent).unwrap()).unwrap();
                std::fs::remove_file(
                    root.join(
                        state["items"][if explicit { 0 } else { 1 }][if operation
                            == "delete_file"
                        {
                            "witness"
                        } else {
                            "staging"
                        }]
                        .as_str()
                        .unwrap(),
                    ),
                )
                .unwrap();
            }
            "altered-terminal" => {
                let mut state: Value =
                    serde_json::from_slice(&std::fs::read(&intent).unwrap()).unwrap();
                state["terminal"] = json!("0".repeat(64));
                std::fs::write(&intent, state.to_string()).unwrap();
            }
            _ => {}
        }
        let snapshot = || {
            ["README.md", "NOTES.md"].map(|name| {
                let p = root.join(name);
                if p.exists() {
                    Some((
                        std::fs::read(&p).unwrap(),
                        std::fs::metadata(p).unwrap().modified().unwrap(),
                    ))
                } else {
                    None
                }
            })
        };
        let before = snapshot();
        for phase in ["retry1", "retry2"] {
            let output = invoke(phase, None);
            assert!(
                output.status.success(),
                "{case}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            if negative {
                let response: Value = serde_json::from_slice(
                    &std::fs::read(root.join(format!("response-{phase}.json"))).unwrap(),
                )
                .unwrap();
                assert!(response["error"].is_object(), "{case}: {response}");
            }
        }
        let events = std::fs::read_to_string(run.join("ledger.jsonl")).unwrap();
        let applied = events
            .lines()
            .map(|l| serde_json::from_str::<Value>(l).unwrap())
            .filter(|e| {
                e["kind"] == "WorkspacePatchApplyResultRecorded"
                    && e["payload"]["apply_status"] == "Applied"
            })
            .count();
        assert_eq!(
            applied,
            usize::from(!negative || case == "altered-terminal"),
            "{case}"
        );
        if negative {
            assert_eq!(
                snapshot(),
                before,
                "{case}: rejected request mutated a target"
            );
            assert!(intent.exists());
        } else {
            if operation == "delete_file" {
                assert!(!root.join("README.md").exists());
                assert!(!root.join("NOTES.md").exists());
            } else {
                assert_eq!(
                    std::fs::read_to_string(root.join("README.md")).unwrap(),
                    "updated README"
                );
                assert_eq!(
                    std::fs::read_to_string(root.join("NOTES.md")).unwrap(),
                    "updated notes"
                );
            }
            assert!(!intent.exists());
            if case != "tx-before" {
                assert_eq!(snapshot()[0], before[0], "{case}: first item applied twice");
            }
        }
    }
}

#[cfg(any(unix, windows))]
pub(super) fn r05_2_apply_write_record_process_exit_probe() {
    if std::env::var_os("CODEX_R05_2_ROOT").is_none() {
        return;
    }
    let _guard = lock_env();
    let root = std::path::PathBuf::from(std::env::var("CODEX_R05_2_ROOT").unwrap());
    std::fs::create_dir_all(&root).unwrap();
    std::env::set_var("BROWNIE_WORKSPACE_ROOT", &root);
    std::env::set_var("BROWNIE_LLM_PROVIDER", "fake");
    let phase = std::env::var("CODEX_R05_2_PHASE").unwrap();
    let request = if phase == "setup" {
        let patch = std::env::var("CODEX_R05_2_OPERATION").ok().as_deref() == Some("patch_file");
        let create = std::env::var("CODEX_R05_2_OPERATION").ok().as_deref() == Some("create_file");
        let delete = std::env::var("CODEX_R05_2_OPERATION").ok().as_deref() == Some("delete_file");
        if !create {
            std::fs::write(
                root.join("README.md"),
                if patch {
                    "alpha\nbeta\ngamma\n"
                } else {
                    "original README"
                },
            )
            .unwrap();
        }
        let (run_id, proposal_id) = if create || delete {
            let store = BrownieStore::new(&root);
            let response = parse_line(r#"{"jsonrpc":"2.0","id":1,"method":"task.start","params":{"goal":"Implement a bounded new file","mode_id":"implementer"}}"#).result.unwrap();
            let task = store
                .tasks()
                .get_task(response["task_id"].as_str().unwrap())
                .unwrap()
                .unwrap();
            append_generated_patch_proposal(
                &store,
                &task,
                "owned-create",
                "README.md",
                if delete { "delete_file" } else { "create_file" },
                if delete { "" } else { "new README content" },
            );
            (task.run_id, "owned-create".to_string())
        } else if patch {
            let response = parse_line(r#"{"jsonrpc":"2.0","id":1,"method":"task.start","params":{"goal":"Implement README patch_file update","mode_id":"implementer"}}"#).result.unwrap();
            let run_id = response["run_id"].as_str().unwrap().to_string();
            let run = parse_line(&json!({"jsonrpc":"2.0","id":2,"method":"task.run","params":{"task_id":response["task_id"]}}).to_string());
            assert!(
                run.error.is_none(),
                "ordinary task.run failed: {:?}",
                run.error
            );
            let listed = parse_line(&json!({"jsonrpc":"2.0","id":3,"method":"proposal.list","params":{"run_id":run_id}}).to_string()).result.unwrap();
            let proposals = listed["proposals"].as_array().unwrap();
            assert_eq!(proposals.len(), 1);
            assert_eq!(proposals[0]["operation"], "patch_file");
            assert_eq!(proposals[0]["validation_status"], "Valid");
            let proposal_id = proposals[0]["proposal_id"].as_str().unwrap().to_string();
            let store = BrownieStore::new(&root);
            let events = read_existing_run_events(&store, &run_id).unwrap();
            assert!(events
                .iter()
                .any(|event| event.kind == LedgerEventKind::LlmResponseReceived));
            assert!(events
                .iter()
                .any(|event| event.kind == LedgerEventKind::ToolIntentParsed));
            std::fs::write(root.join("ordinary-proposal.json"), listed.to_string()).unwrap();
            (run_id, proposal_id)
        } else {
            start_fake_readme_patch_proposal()
        };
        let approve = parse_line(&json!({"jsonrpc":"2.0","id":4,"method":"proposal.approve","params":{"run_id":run_id,"proposal_id":proposal_id,"reason":"owned crash-boundary fixture"}}).to_string());
        assert!(approve.error.is_none());
        let preflight = parse_line(&json!({"jsonrpc":"2.0","id":5,"method":"proposal.preflight","params":{"run_id":run_id,"proposal_id":proposal_id}}).to_string()).result.unwrap();
        let request = json!({"jsonrpc":"2.0","id":6,"method":"proposal.apply","params":{"run_id":run_id,"proposal_id":proposal_id,"expected_target_sha256":preflight["snapshot"]["file_sha256"],"replacement_content":"new README content","authorize":true}}).to_string();
        let request = if delete {
            let mut value: Value = serde_json::from_str(&request).unwrap();
            value["params"]
                .as_object_mut()
                .unwrap()
                .remove("replacement_content");
            value.to_string()
        } else if create {
            let mut value: Value = serde_json::from_str(&request).unwrap();
            value["params"]
                .as_object_mut()
                .unwrap()
                .remove("expected_target_sha256");
            value["params"]["expected_target_absent"] = json!(true);
            value.to_string()
        } else if patch {
            let mut value: Value = serde_json::from_str(&request).unwrap();
            value["params"]
                .as_object_mut()
                .unwrap()
                .remove("replacement_content");
            value["params"]["patch_old_text"] = json!("beta\n");
            value["params"]["patch_new_text"] = json!("delta\n");
            value.to_string()
        } else {
            request
        };
        std::fs::write(root.join("request.json"), &request).unwrap();
        request
    } else {
        std::fs::read_to_string(root.join("request.json")).unwrap()
    };
    if phase == "inspect" {
        let request: Value = serde_json::from_str(&request).unwrap();
        let params: ProposalApplyParams =
            serde_json::from_value(request["params"].clone()).unwrap();
        let classified =
            proposal_apply::inspect_retained_apply_for_test(&BrownieStore::new(&root), &params);
        eprintln!("read-only retained classification: {classified:?}");
        return;
    }
    let response = handle_jsonrpc_input_line(&request).unwrap();
    std::fs::write(root.join(format!("response-{phase}.json")), response).unwrap();
}

#[cfg(any(unix, windows))]
pub(super) fn replace_recovery_process_loss_and_identity_controls() {
    workspace_recovery_process_loss_controls("replace_file", false);
}

#[cfg(any(unix, windows))]
pub(super) fn patch_recovery_process_loss_and_identity_controls() {
    workspace_recovery_process_loss_controls("patch_file", false);
}

#[cfg(any(unix, windows))]
pub(super) fn patch_recovery_owned_process_kill_controls() {
    workspace_recovery_process_loss_controls("patch_file", true);
}

#[cfg(any(unix, windows))]
pub(super) fn create_recovery_owned_process_kill_controls() {
    workspace_recovery_process_loss_controls("create_file", true);
}

#[cfg(any(unix, windows))]
pub(super) fn delete_recovery_owned_process_kill_controls() {
    workspace_recovery_process_loss_controls("delete_file", true);
}

#[cfg(any(unix, windows))]
fn workspace_recovery_process_loss_controls(operation: &str, external_kill: bool) {
    let mut cases = vec![
        "normal",
        "before",
        "before-cleanup-staging",
        "before-cleanup-witness",
        "before-cleanup-intent",
        "before-cleanup-foreign-staging",
        "before-cleanup-foreign-witness",
        "after",
        "recorded",
        "terminal",
        "terminal-altered-digest",
        "terminal-changed-request",
        "terminal-replaced-target",
        "terminal-edited-target",
        "replaced-target",
        "edited-target",
        "missing-intent",
        "altered-binding",
        "replaced-witness",
        "changed-request",
        "changed-authorization",
        "changed-policy",
        "changed-preflight",
    ];
    if operation == "delete_file" {
        cases.extend([
            "before-target-disappeared",
            "missing-tombstone",
            "replaced-tombstone",
            "terminal-edited-tombstone",
        ]);
    }
    for case in cases {
        let terminal_refusal = case.starts_with("terminal-");
        let unwritten_cleanup = case.starts_with("before-cleanup-");
        let restartable_cleanup = matches!(
            case,
            "before-cleanup-staging" | "before-cleanup-witness" | "before-cleanup-intent"
        );
        let positive = matches!(
            case,
            "normal" | "before" | "after" | "recorded" | "terminal"
        ) || restartable_cleanup;
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path();
        let invoke = |phase: &str, boundary: Option<&str>| {
            let mut command = std::process::Command::new(std::env::current_exe().unwrap());
            command
                .env_clear()
                .envs(std::env::vars_os().filter(|(key, _)| {
                    !key.to_string_lossy().starts_with("BROWNIE_")
                        && !key.to_string_lossy().starts_with("CODEX_R05_2_")
                }));
            command
                .args([
                    "--exact",
                    "tests::r05_2_apply_write_record_process_exit_probe",
                    "--nocapture",
                ])
                .env("CODEX_R05_2_ROOT", root)
                .env("CODEX_R05_2_PHASE", phase)
                .env("CODEX_R05_2_OPERATION", operation);
            if let Some(boundary) = boundary {
                command.env("CODEX_R05_2_EXIT", boundary);
            }
            if let Some(boundary) = boundary.filter(|_| external_kill) {
                let marker = root.join("owned-child-boundary");
                command.env("CODEX_R05_2_KILL_MARKER", &marker);
                command.stdout(std::process::Stdio::piped());
                command.stderr(std::process::Stdio::piped());
                let mut child = command.spawn().unwrap();
                let pid = child.id();
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
                loop {
                    if marker.exists() {
                        assert_eq!(std::fs::read_to_string(&marker).unwrap(), boundary);
                        assert!(
                            child.try_wait().unwrap().is_none(),
                            "child exited before kill"
                        );
                        child.kill().unwrap();
                        let output = child.wait_with_output().unwrap();
                        eprintln!(
                            "owned-child case={case} pid={pid} boundary={} status={}",
                            boundary, output.status
                        );
                        return output;
                    }
                    if let Some(status) = child.try_wait().unwrap() {
                        panic!("{case}: child {pid} exited before boundary: {status}");
                    }
                    if std::time::Instant::now() >= deadline {
                        child.kill().unwrap();
                        let output = child.wait_with_output().unwrap();
                        panic!(
                            "{case}: boundary timeout; owned child {pid} reaped: {:?}",
                            output
                        );
                    }
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
            }
            command.output().unwrap()
        };
        let boundary = match case {
            "normal" => None,
            "before" | "before-target-disappeared" => Some("before"),
            _ if unwritten_cleanup => Some("before"),
            "recorded" => Some("recorded"),
            "terminal" => Some("terminal"),
            _ if terminal_refusal => Some("terminal"),
            _ => Some("after"),
        };
        let setup = invoke("setup", boundary);
        if external_kill && boundary.is_some() {
            #[cfg(unix)]
            use std::os::unix::process::ExitStatusExt;
            #[cfg(windows)]
            assert!(
                !setup.status.success(),
                "owned child must terminate unsuccessfully"
            );
            #[cfg(unix)]
            assert_eq!(
                setup.status.signal(),
                Some(9),
                "{case}: expected owned-child SIGKILL"
            );
        } else {
            assert_eq!(
                setup.status.code(),
                Some(match boundary {
                    None => 0,
                    Some("before") => 85,
                    Some("recorded") => 87,
                    Some("terminal") => 88,
                    _ => 86,
                }),
                "{case}: {}",
                String::from_utf8_lossy(&setup.stderr)
            );
        }
        let target = root.join("README.md");
        let request: Value =
            serde_json::from_slice(&std::fs::read(root.join("request.json")).unwrap()).unwrap();
        let run_dir = root
            .join(".brownie/runs")
            .join(request["params"]["run_id"].as_str().unwrap());
        let intent_path = run_dir.join(format!(
            "apply-intent-{}.json",
            hex_sha256(
                request["params"]["proposal_id"]
                    .as_str()
                    .unwrap()
                    .as_bytes()
            )
        ));
        if matches!(case, "recorded" | "terminal") {
            let intent: Value =
                serde_json::from_slice(&std::fs::read(&intent_path).unwrap()).unwrap();
            assert_eq!(
                intent["terminal_result_sha256"].is_string(),
                case == "terminal"
            );
            if case == "terminal" {
                let events = std::fs::read_to_string(run_dir.join("ledger.jsonl")).unwrap();
                let applied: Vec<Value> = events
                    .lines()
                    .map(|line| serde_json::from_str::<Value>(line).unwrap())
                    .filter(|event| {
                        event["kind"] == "WorkspacePatchApplyResultRecorded"
                            && event["payload"]["apply_status"] == "Applied"
                    })
                    .collect();
                assert_eq!(applied.len(), 1);
                assert_eq!(
                    intent["terminal_result_sha256"],
                    hex_sha256(&serde_json::to_vec(&applied[0]["payload"]).unwrap())
                );
            }
        }
        if unwritten_cleanup {
            let intent: Value =
                serde_json::from_slice(&std::fs::read(&intent_path).unwrap()).unwrap();
            let staging = root.join(intent["staging"].as_str().unwrap());
            let witness = root.join(intent["witness"].as_str().unwrap());
            if restartable_cleanup {
                if operation != "delete_file" {
                    std::fs::remove_file(&staging).unwrap();
                } else {
                    assert!(!staging.exists());
                }
                if case != "before-cleanup-staging" {
                    std::fs::remove_file(&witness).unwrap();
                }
                if case == "before-cleanup-intent" {
                    std::fs::remove_file(&intent_path).unwrap();
                }
            } else {
                let changed = if case == "before-cleanup-foreign-staging" {
                    &staging
                } else {
                    &witness
                };
                let replacement = root.join("foreign-temporary");
                let bytes = if operation == "delete_file" && changed == &staging {
                    std::fs::read(&target).unwrap()
                } else {
                    std::fs::read(changed).unwrap()
                };
                std::fs::write(&replacement, bytes).unwrap();
                std::fs::rename(&replacement, changed).unwrap();
            }
        } else if !positive {
            let mut intent: Value =
                serde_json::from_slice(&std::fs::read(&intent_path).unwrap()).unwrap();
            let witness = root.join(intent["witness"].as_str().unwrap());
            match case {
                "before-target-disappeared" => std::fs::remove_file(&target).unwrap(),
                "terminal-edited-tombstone" => {
                    std::fs::write(
                        root.join(intent["staging"].as_str().unwrap()),
                        b"altered retained original",
                    )
                    .unwrap();
                }
                "missing-tombstone" => {
                    std::fs::remove_file(root.join(intent["staging"].as_str().unwrap())).unwrap();
                }
                "replaced-tombstone" => {
                    let staging = root.join(intent["staging"].as_str().unwrap());
                    let foreign = root.join("foreign-tombstone");
                    std::fs::write(&foreign, std::fs::read(&staging).unwrap()).unwrap();
                    std::fs::rename(foreign, staging).unwrap();
                }
                "terminal-altered-digest" => {
                    intent["terminal_result_sha256"] = json!("0".repeat(64));
                    std::fs::write(&intent_path, serde_json::to_vec(&intent).unwrap()).unwrap();
                }
                "terminal-changed-request" => {
                    let mut changed = request.clone();
                    if operation == "delete_file" {
                        changed["params"]["expected_target_sha256"] =
                            json!(format!("sha256:{}", "0".repeat(64)));
                    } else {
                        changed["params"][if operation == "patch_file" {
                            "patch_new_text"
                        } else {
                            "replacement_content"
                        }] = json!("different request");
                    }
                    std::fs::write(
                        root.join("request.json"),
                        serde_json::to_vec(&changed).unwrap(),
                    )
                    .unwrap();
                }
                "replaced-target" | "terminal-replaced-target" => {
                    let tmp = root.join("external");
                    let source = if operation == "delete_file" {
                        &witness
                    } else {
                        &target
                    };
                    std::fs::write(&tmp, std::fs::read(source).unwrap()).unwrap();
                    std::fs::rename(tmp, &target).unwrap();
                }
                "edited-target" | "terminal-edited-target" => {
                    std::fs::write(&target, "external change").unwrap()
                }
                "missing-intent" => std::fs::remove_file(&intent_path).unwrap(),
                "altered-binding" => {
                    intent["binding"] = json!("invalid");
                    std::fs::write(&intent_path, serde_json::to_vec(&intent).unwrap()).unwrap();
                }
                "replaced-witness" => {
                    let tmp = root.join("external");
                    std::fs::write(&tmp, std::fs::read(&witness).unwrap()).unwrap();
                    std::fs::rename(tmp, witness).unwrap();
                }
                "changed-authorization" => {
                    let mut changed = request.clone();
                    changed["params"]["authorize"] = json!(false);
                    std::fs::write(
                        root.join("request.json"),
                        serde_json::to_vec(&changed).unwrap(),
                    )
                    .unwrap();
                }
                "changed-preflight" => {
                    let ledger = run_dir.join("ledger.jsonl");
                    let text = std::fs::read_to_string(&ledger).unwrap();
                    let mut events: Vec<Value> = text
                        .lines()
                        .map(|line| serde_json::from_str(line).unwrap())
                        .collect();
                    let snapshot = events
                        .iter_mut()
                        .rev()
                        .find(|event| event["kind"] == "WorkspacePatchPreflightSnapshotCreated")
                        .unwrap();
                    snapshot["payload"]["snapshot_id"] = json!("different-preflight-snapshot");
                    std::fs::write(
                        ledger,
                        events
                            .iter()
                            .map(|event| serde_json::to_string(event).unwrap() + "\n")
                            .collect::<String>(),
                    )
                    .unwrap();
                }
                "changed-policy" => {
                    let ledger = run_dir.join("ledger.jsonl");
                    let text = std::fs::read_to_string(&ledger).unwrap();
                    let mut events: Vec<Value> = text
                        .lines()
                        .map(|line| serde_json::from_str(line).unwrap())
                        .collect();
                    let policy = events
                        .iter_mut()
                        .rev()
                        .find(|event| event["kind"] == "ModeResolved")
                        .unwrap();
                    policy["payload"]["permissions"]["workspace_write"] = json!(false);
                    let text = events
                        .iter()
                        .map(|event| serde_json::to_string(event).unwrap() + "\n")
                        .collect::<String>();
                    std::fs::write(ledger, text).unwrap();
                }
                "changed-request" => {
                    let mut request = request.clone();
                    request["params"][if operation == "patch_file" {
                        "patch_new_text"
                    } else {
                        "replacement_content"
                    }] = json!("different request");
                    std::fs::write(
                        root.join("request.json"),
                        serde_json::to_vec(&request).unwrap(),
                    )
                    .unwrap();
                }
                _ => unreachable!(),
            }
        }
        // The classifier is used before any transaction item is resumed.
        // Check both successful and rejected inspections without allowing
        // hidden state initialization, ledger writes, cleanup or migration.
        fn snapshot(
            root: &std::path::Path,
        ) -> Vec<(std::path::PathBuf, Vec<u8>, std::time::SystemTime)> {
            fn visit(
                path: &std::path::Path,
                entries: &mut Vec<(std::path::PathBuf, Vec<u8>, std::time::SystemTime)>,
            ) {
                let metadata = std::fs::symlink_metadata(path).unwrap();
                let bytes = if metadata.is_file() {
                    std::fs::read(path).unwrap()
                } else {
                    Vec::new()
                };
                entries.push((path.to_path_buf(), bytes, metadata.modified().unwrap()));
                if metadata.is_dir() {
                    for child in std::fs::read_dir(path).unwrap() {
                        visit(&child.unwrap().path(), entries);
                    }
                }
            }
            let mut entries = Vec::new();
            visit(root, &mut entries);
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            entries
        }
        let before_inspection = snapshot(root);
        let inspection = invoke("inspect", None);
        assert!(
            inspection.status.success(),
            "{case}: inspection child failed: {}",
            String::from_utf8_lossy(&inspection.stderr)
        );
        assert_eq!(
            snapshot(root),
            before_inspection,
            "{case}: classifier mutated fixture"
        );
        let refusal_snapshot = terminal_refusal.then(|| {
            (
                std::fs::read(&intent_path).unwrap(),
                std::fs::read(run_dir.join("ledger.jsonl")).unwrap(),
                std::fs::read(&target).ok(),
            )
        });
        let before_retry = std::fs::metadata(&target)
            .ok()
            .map(|m| m.modified().unwrap());
        for phase in ["retry1", "retry2"] {
            let retry = invoke(phase, None);
            assert!(
                retry.status.success(),
                "{case}: {}",
                String::from_utf8_lossy(&retry.stderr)
            );
        }
        let ledger = std::fs::read_to_string(run_dir.join("ledger.jsonl")).unwrap();
        let applied = ledger
            .lines()
            .map(|s| serde_json::from_str::<Value>(s).unwrap())
            .filter(|v| {
                v["kind"] == "WorkspacePatchApplyResultRecorded"
                    && v["payload"]["apply_status"] == "Applied"
            })
            .count();
        assert_eq!(applied, usize::from(positive || terminal_refusal), "{case}");
        if let Some((intent, ledger, target_bytes)) = refusal_snapshot {
            assert_eq!(
                std::fs::read(&intent_path).unwrap(),
                intent,
                "{case}: intent changed on refusal"
            );
            let after = std::fs::read(run_dir.join("ledger.jsonl")).unwrap();
            assert!(
                after.starts_with(&ledger),
                "{case}: prior ledger changed on refusal"
            );
            let added: Vec<Value> = std::str::from_utf8(&after[ledger.len()..])
                .unwrap()
                .lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect();
            assert_eq!(added.len(), 2, "{case}: unexpected retry events");
            assert!(
                added
                    .iter()
                    .all(|event| event["kind"] == "PermissionChecked"
                        && event["payload"]["proposal_id"] == request["params"]["proposal_id"]),
                "{case}: refusal added an application or unrelated event"
            );
            assert_eq!(
                std::fs::read(&target).ok(),
                target_bytes,
                "{case}: target changed on refusal"
            );
            for phase in ["retry1", "retry2"] {
                let response: Value = serde_json::from_slice(
                    &std::fs::read(root.join(format!("response-{phase}.json"))).unwrap(),
                )
                .unwrap();
                assert!(
                    response["error"].is_object(),
                    "{case}: expected refusal: {response}"
                );
            }
        }
        if case != "before" && !restartable_cleanup {
            assert_eq!(
                std::fs::metadata(&target)
                    .ok()
                    .map(|m| m.modified().unwrap()),
                before_retry,
                "{case}: unexpected second write"
            );
        }
        assert!(
            !ledger.contains("new README content"),
            "{case}: raw content in ledger"
        );
        if unwritten_cleanup && !restartable_cleanup {
            let intent: Value =
                serde_json::from_slice(&std::fs::read(&intent_path).unwrap()).unwrap();
            for key in ["staging", "witness"] {
                let expected = !(operation == "delete_file"
                    && key == "staging"
                    && case == "before-cleanup-foreign-witness");
                assert_eq!(
                    root.join(intent[key].as_str().unwrap()).exists(),
                    expected,
                    "{case}: {key}"
                );
            }
        }
        if positive {
            if operation == "delete_file" {
                assert!(!target.exists(), "{case}: deleted target exists");
            } else {
                assert_eq!(
                    std::fs::read_to_string(&target).unwrap(),
                    if operation == "patch_file" {
                        "alpha\ndelta\ngamma\n"
                    } else {
                        "new README content"
                    }
                );
            }
            assert!(!intent_path.exists(), "{case}: intent not cleaned");
            assert!(
                !std::fs::read_dir(root).unwrap().any(|entry| entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .contains(".tmp")),
                "{case}: temporary material retained"
            );
        }
    }
}
