use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Barrier};
use std::thread::{self, JoinHandle};
use std::time::Duration;

struct Provider {
    url: String,
    stopped: Arc<AtomicBool>,
    requests: Arc<AtomicUsize>,
    thread: Option<JoinHandle<()>>,
}

impl Provider {
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("fixture listener");
        let url = format!("http://{}/v1", listener.local_addr().unwrap());
        listener.set_nonblocking(true).unwrap();
        let stopped = Arc::new(AtomicBool::new(false));
        let requests = Arc::new(AtomicUsize::new(0));
        let stop = Arc::clone(&stopped);
        let count = Arc::clone(&requests);
        let thread = thread::spawn(move || {
            while !stop.load(Ordering::SeqCst) {
                let (mut stream, _) = match listener.accept() {
                    Ok(pair) => pair,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                        continue;
                    }
                    Err(error) => panic!("fixture accept: {error}"),
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                stream
                    .set_write_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut first = String::new();
                reader.read_line(&mut first).unwrap();
                let mut length = 0;
                loop {
                    let mut line = String::new();
                    assert_ne!(
                        reader.read_line(&mut line).unwrap(),
                        0,
                        "complete HTTP headers"
                    );
                    if line == "\r\n" {
                        break;
                    }
                    if let Some((name, value)) = line.split_once(':') {
                        if name.eq_ignore_ascii_case("content-length") {
                            length = value.trim().parse::<usize>().unwrap();
                        }
                    }
                }
                assert!(length <= 1024 * 1024, "bounded fixture request");
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                let response = if first.starts_with("GET /v1/models ") {
                    json!({"data":[{"id":"concurrency-fixture"}]})
                } else {
                    assert!(first.starts_with("POST /v1/chat/completions "), "{first}");
                    assert!(count.fetch_add(1, Ordering::SeqCst) < 16, "bounded fixture calls");
                    json!({"choices":[{"message":{"role":"assistant","content":"Fixture task completed."}}]})
                }.to_string();
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", response.len(), response).unwrap();
            }
        });
        Self {
            url,
            stopped,
            requests,
            thread: Some(thread),
        }
    }
}

impl Drop for Provider {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            if !std::thread::panicking() {
                thread.join().expect("provider exits");
            }
        }
    }
}

struct Client {
    child: Child,
    stdin: ChildStdin,
    responses: mpsc::Receiver<Value>,
    reader: Option<JoinHandle<()>>,
    sequence: u64,
}

impl Client {
    fn start(workspace: &std::path::Path) -> Self {
        let mut command = Command::new(env!("CARGO_BIN_EXE_brownie-runtime"));
        command.current_dir(workspace).env_clear();
        for key in [
            "PATH",
            "Path",
            "PATHEXT",
            "SystemRoot",
            "SYSTEMROOT",
            "TEMP",
            "TMP",
            "TMPDIR",
        ] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        command
            .env("HOME", workspace)
            .env("USERPROFILE", workspace)
            .env("BROWNIE_WORKSPACE_ROOT", workspace)
            .env("BROWNIE_LLM_ALLOW_PROVIDER_ACCESS", "true")
            .env("BROWNIE_LLM_REQUEST_TIMEOUT_MS", "5000")
            .env(
                "BROWNIE_TEST_LLM_API_KEY",
                "SYNTHETIC_CONCURRENCY_FIXTURE_NOT_A_CREDENTIAL",
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = command.spawn().expect("actual Runtime process");
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (send, responses) = mpsc::channel();
        let reader = thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let value =
                    serde_json::from_str(&line.expect("Runtime stdout")).expect("NDJSON response");
                if send.send(value).is_err() {
                    break;
                }
            }
        });
        Self {
            child,
            stdin,
            responses,
            reader: Some(reader),
            sequence: 0,
        }
    }

    fn rpc(&mut self, method: &str, params: Value) -> Value {
        self.sequence += 1;
        let id = self.sequence;
        writeln!(
            self.stdin,
            "{}",
            json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})
        )
        .unwrap();
        self.stdin.flush().unwrap();
        let response = self
            .responses
            .recv_timeout(Duration::from_secs(15))
            .expect("bounded Runtime response");
        assert_eq!(response["id"], id);
        response
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}

#[test]
fn fixture_provider_accepts_delayed_request_headers() {
    let provider = Provider::start();
    let address = provider
        .url
        .strip_prefix("http://")
        .unwrap()
        .split('/')
        .next()
        .unwrap();
    let mut connection = TcpStream::connect(address).expect("delayed fixture connection");
    connection
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    connection
        .set_write_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    thread::sleep(Duration::from_millis(50));
    write!(connection, "GET /v1/models HTTP/1.1\r\nHost: {address}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
    let mut response = String::new();
    connection
        .read_to_string(&mut response)
        .expect("bounded provider response");
    assert!(response.starts_with("HTTP/1.1 200 OK\r\n"), "{response}");
    assert!(response.contains("concurrency-fixture"));
    assert_eq!(provider.requests.load(Ordering::SeqCst), 0);
}

#[test]
fn concurrent_standard_task_run_starts_one_real_provider_request() {
    for _ in 0..3 {
        let workspace = tempfile::tempdir().unwrap();
        let provider = Provider::start();
        std::fs::create_dir(workspace.path().join(".brownie")).unwrap();
        std::fs::write(workspace.path().join(".brownie/config.json"), json!({
            "version":1,"active_profile":"concurrency-fixture","llm":{"profiles":{
                "concurrency-fixture":{"provider":"openai-compatible","base_url":provider.url,
                    "model":"concurrency-fixture","api_key_env":"BROWNIE_TEST_LLM_API_KEY","strict":true}
            }}
        }).to_string()).unwrap();
        let mut clients = (0..4)
            .map(|_| Client::start(workspace.path()))
            .collect::<Vec<_>>();
        for client in &mut clients {
            let status = client.rpc("llm.status", json!({}));
            assert_eq!(status["result"]["provider"], "OpenAiCompatible");
            for key in ["enabled", "strict", "llm_provider_access_allowed"] {
                assert_eq!(status["result"][key], true, "{status}");
            }
            assert_eq!(status["result"]["will_fallback_to_fake"], false);
            let health = client.rpc(
                "llm.health",
                json!({"allow_network":true,"timeout_ms":5000}),
            );
            assert_eq!(health["result"]["healthy"], true, "{health}");
            assert_eq!(health["result"]["attempted"], true, "{health}");
        }
        let started = clients[0].rpc(
            "task.start",
            json!({
                "goal":"Describe the isolated fixture state. ".repeat(500),"mode_id":null
            }),
        );
        assert_eq!(started["result"]["status"], "Created", "{started}");
        let task = started["result"]["task_id"].as_str().unwrap().to_string();
        let run = started["result"]["run_id"].as_str().unwrap();
        let barrier = Arc::new(Barrier::new(5));
        let calls = clients
            .into_iter()
            .map(|mut client| {
                let barrier = Arc::clone(&barrier);
                let task = task.clone();
                thread::spawn(move || {
                    barrier.wait();
                    client.rpc("task.run", json!({"task_id":task}))
                })
            })
            .collect::<Vec<_>>();
        barrier.wait();
        let responses = calls
            .into_iter()
            .map(|call| call.join().expect("Runtime caller"))
            .collect::<Vec<_>>();
        assert_eq!(
            responses
                .iter()
                .filter(|value| value["result"]["status"] == "Completed")
                .count(),
            1,
            "{responses:?}"
        );
        assert_eq!(
            responses
                .iter()
                .filter(|value| value["error"]["code"] == -32602)
                .count(),
            3,
            "{responses:?}"
        );
        let directory = workspace.path().join(".brownie/runs").join(run);
        let raw = std::fs::read_to_string(directory.join("ledger.jsonl")).unwrap();
        let events = raw
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).expect("intact ledger"))
            .collect::<Vec<_>>();
        for kind in ["TaskRunning", "LlmRequestCreated", "TaskCompleted"] {
            assert_eq!(
                events.iter().filter(|event| event["kind"] == kind).count(),
                1,
                "{kind}: {events:?}"
            );
        }
        let response_index = events
            .iter()
            .position(|event| event["kind"] == "LlmResponseReceived")
            .expect("response persisted");
        let intent_index = events
            .iter()
            .position(|event| event["kind"] == "ToolIntentParsed")
            .expect("derived intent persisted");
        assert!(
            response_index < intent_index,
            "response must precede derived intent: {events:?}"
        );
        assert_eq!(provider.requests.load(Ordering::SeqCst), 1);
        let state: Value =
            serde_json::from_str(&std::fs::read_to_string(directory.join("state.json")).unwrap())
                .unwrap();
        assert_eq!(state["status"], "Completed");
    }
}
