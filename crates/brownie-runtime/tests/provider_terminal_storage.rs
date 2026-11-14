use serde_json::{json, Value};
use std::{
    ffi::OsString,
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

static ENV_LOCK: Mutex<()> = Mutex::new(());

struct Environment(Vec<(OsString, OsString)>);
impl Environment {
    fn isolated() -> Self {
        let saved: Vec<_> = std::env::vars_os()
            .filter(|(key, _)| key.to_str().is_some_and(|key| key.starts_with("BROWNIE_")))
            .collect();
        for (key, _) in &saved {
            std::env::remove_var(key);
        }
        Self(saved)
    }
}
impl Drop for Environment {
    fn drop(&mut self) {
        for (key, _) in std::env::vars_os()
            .filter(|(key, _)| key.to_str().is_some_and(|key| key.starts_with("BROWNIE_")))
        {
            std::env::remove_var(key);
        }
        for (key, value) in &self.0 {
            std::env::set_var(key, value);
        }
    }
}

#[derive(Clone, Copy)]
enum Fault {
    None,
    Ledger,
    State,
    Both,
}

#[derive(Default)]
struct StorageFault(Vec<(PathBuf, PathBuf)>);
impl StorageFault {
    fn inject(&mut self, run: &std::path::Path, fault: Fault) {
        let names: &[&str] = match fault {
            Fault::None => &[],
            Fault::Ledger => &["ledger.jsonl"],
            Fault::State => &["state.json"],
            Fault::Both => &["ledger.jsonl", "state.json"],
        };
        for name in names {
            let target = run.join(name);
            let backup = run.join(format!("{name}.before-test-fault"));
            std::fs::rename(&target, &backup).unwrap();
            self.0.push((target.clone(), backup));
            std::fs::create_dir(&target).unwrap();
        }
    }
    fn restore(&mut self) {
        for (target, backup) in self.0.drain(..).rev() {
            if target.is_dir() {
                std::fs::remove_dir(&target).unwrap();
            }
            std::fs::rename(backup, target).unwrap();
        }
    }
}
impl Drop for StorageFault {
    fn drop(&mut self) {
        self.restore();
    }
}

fn rpc(method: &str, params: Value) -> Value {
    let request = json!({"jsonrpc":"2.0","id":1,"method":method,"params":params});
    serde_json::from_str(&brownie_runtime::handle_jsonrpc_input_line(&request.to_string()).unwrap())
        .unwrap()
}

struct Mock {
    base_url: String,
    stop: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<usize>>,
}
impl Mock {
    fn start(
        run: PathBuf,
        fault: Fault,
        failure_pass: usize,
        storage: Arc<Mutex<StorageFault>>,
    ) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let base_url = format!("http://{}/v1", listener.local_addr().unwrap());
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        let worker = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(10);
            let mut posts = 0;
            while posts < failure_pass && !stopped.load(Ordering::SeqCst) {
                assert!(Instant::now() < deadline, "bounded test listener expired");
                let (mut stream, _) = match listener.accept() {
                    Ok(value) => value,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                        continue;
                    }
                    Err(error) => panic!("test accept failed: {error}"),
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut bytes = Vec::new();
                let (header_end, length) = loop {
                    let mut chunk = [0; 4096];
                    let count = stream.read(&mut chunk).unwrap();
                    assert!(
                        count > 0 && bytes.len() + count <= 256 * 1024,
                        "bounded complete request"
                    );
                    bytes.extend_from_slice(&chunk[..count]);
                    if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                        let header = std::str::from_utf8(&bytes[..end]).unwrap();
                        let length = header
                            .lines()
                            .find_map(|line| {
                                let (name, value) = line.split_once(':')?;
                                name.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().unwrap())
                            })
                            .unwrap_or(0);
                        assert!(end + 4 + length <= 256 * 1024);
                        if bytes.len() >= end + 4 + length {
                            break (end + 4, length);
                        }
                    }
                };
                let header = std::str::from_utf8(&bytes[..header_end]).unwrap();
                let (status, response) = if header.starts_with("GET /v1/models HTTP/1.1") {
                    ("200 OK", json!({"data":[{"id":"storage-fixture"}]}))
                } else {
                    assert!(header.starts_with("POST /v1/chat/completions HTTP/1.1"));
                    let body: Value =
                        serde_json::from_slice(&bytes[header_end..header_end + length]).unwrap();
                    assert_eq!(body["model"], "storage-fixture");
                    posts += 1;
                    if posts == failure_pass {
                        storage.lock().unwrap().inject(&run, fault);
                        (
                            "500 Internal Server Error",
                            json!({"error":"synthetic_provider_failure"}),
                        )
                    } else {
                        let intent = format!(
                            "```brownie-tool-intent\n{}\n```",
                            json!({"tool_requests":[
                                {"tool_id":"workspace.read","reason":"Read the fixture","input":{"path":"fixture.md"}}
                            ]})
                        );
                        (
                            "200 OK",
                            json!({"choices":[{"message":{"content":intent}}]}),
                        )
                    }
                };
                let body = response.to_string();
                write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
            posts
        });
        Self {
            base_url,
            stop,
            worker: Some(worker),
        }
    }
    fn finish(&mut self) -> usize {
        self.worker
            .take()
            .unwrap()
            .join()
            .expect("actual mock requests")
    }
}
impl Drop for Mock {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn check(fault: Fault, failure_pass: usize) {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let _environment = Environment::isolated();
    let workspace = tempfile::tempdir().unwrap();
    std::env::set_var("BROWNIE_WORKSPACE_ROOT", workspace.path());
    std::fs::write(
        workspace.path().join("fixture.md"),
        "Isolated provider failure fixture.\n",
    )
    .unwrap();
    let started = rpc(
        "task.start",
        json!({"goal":"Read fixture.md and summarize it","mode_id":null}),
    );
    assert!(started.get("error").is_none(), "{started}");
    let task = &started["result"];
    let run = workspace
        .path()
        .join(".brownie/runs")
        .join(task["run_id"].as_str().unwrap());
    let storage = Arc::new(Mutex::new(StorageFault::default()));
    let mut mock = Mock::start(run, fault, failure_pass, storage.clone());
    for (name, value) in [
        ("BROWNIE_LLM_PROVIDER", "openai-compatible"),
        ("BROWNIE_LLM_MODEL", "storage-fixture"),
        ("BROWNIE_LLM_BASE_URL", mock.base_url.as_str()),
        ("BROWNIE_LLM_API_KEY", "SYNTHETIC_STORAGE_TEST_SECRET"),
        ("BROWNIE_LLM_STRICT", "true"),
        ("BROWNIE_LLM_ALLOW_PROVIDER_ACCESS", "true"),
        ("BROWNIE_LLM_ALLOW_TASK_RUN_NETWORK", "true"),
        ("BROWNIE_LLM_REQUEST_TIMEOUT_MS", "1000"),
    ] {
        std::env::set_var(name, value);
    }
    let status = rpc("llm.status", json!({}));
    assert_eq!(status["result"]["provider"], "OpenAiCompatible");
    for key in ["enabled", "strict", "llm_provider_access_allowed"] {
        assert_eq!(status["result"][key], true);
    }
    assert_eq!(status["result"]["will_fallback_to_fake"], false);
    let health = rpc(
        "llm.health",
        json!({"allow_network":true,"timeout_ms":1000}),
    );
    assert_eq!(health["result"]["healthy"], true, "{health}");
    let result = rpc("task.run", json!({"task_id":task["task_id"]}));
    assert_eq!(mock.finish(), failure_pass);
    storage.lock().unwrap().restore();
    if matches!(fault, Fault::None) {
        assert!(result.get("error").is_none(), "{result}");
        assert_eq!(result["result"]["status"], "Failed");
        assert_eq!(
            rpc("task.get", json!({"task_id":task["task_id"]}))["result"]["status"],
            "Failed"
        );
        let events = rpc("run.events", json!({"run_id":task["run_id"]}));
        assert_eq!(
            events["result"]["events"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|event| event["kind"] == "TaskFailed")
                .count(),
            1
        );
    } else {
        assert!(
            result.get("result").is_none(),
            "no successful result may hide failed persistence: {result}"
        );
        assert_eq!(result["error"]["code"], -32603);
        let message = result["error"]["message"].as_str().unwrap();
        assert!(
            message.contains("persistence") && message.contains("terminal_transition"),
            "storage cause must remain observable: {message}"
        );
        assert!(message.len() <= 1024);
        assert!(
            !message.contains(workspace.path().to_str().unwrap()),
            "no storage source path disclosure"
        );
    }
    let serialized = result.to_string();
    assert!(!serialized.contains("SYNTHETIC_STORAGE_TEST_SECRET"));
    assert!(!serialized.contains("Authorization") && !serialized.contains("Bearer"));
}

#[test]
fn healthy_first_provider_failure_remains_durably_failed() {
    check(Fault::None, 1);
}
#[test]
fn healthy_second_provider_failure_remains_durably_failed() {
    check(Fault::None, 2);
}
#[test]
fn ledger_persistence_failure_is_not_hidden() {
    check(Fault::Ledger, 1);
}
#[test]
fn terminal_state_persistence_failure_is_not_hidden() {
    check(Fault::State, 1);
}
#[test]
fn combined_persistence_failures_are_not_hidden() {
    check(Fault::Both, 1);
}

#[test]
fn second_pass_ledger_persistence_failure_is_not_hidden() {
    check(Fault::Ledger, 2);
}
#[test]
fn second_pass_terminal_state_persistence_failure_is_not_hidden() {
    check(Fault::State, 2);
}
#[test]
fn second_pass_combined_persistence_failures_are_not_hidden() {
    check(Fault::Both, 2);
}
