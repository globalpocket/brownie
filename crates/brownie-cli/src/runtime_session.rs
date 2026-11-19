//! One owned Runtime process for an explicit CLI run/resume invocation.
//! No request material survives this process or the invocation's scope.
use super::{read_bounded_response_line, RuntimeClientError, MAX_RESPONSE_BYTES};
use std::io::Write;
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

pub(super) type Slot = Arc<Mutex<Option<Session>>>;

#[derive(Debug, Default)]
pub(super) struct Session {
    process: Option<Process>,
}

#[derive(Debug)]
struct Process {
    child: Child,
    stdin: ChildStdin,
    responses: mpsc::Receiver<std::io::Result<Vec<u8>>>,
}

impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub(super) struct Scope(Slot);

impl Scope {
    pub(super) fn begin(slot: &Slot) -> Result<Self, RuntimeClientError> {
        let mut state = slot
            .lock()
            .map_err(|_| RuntimeClientError::CommunicationFailed)?;
        if state.is_some() {
            return Err(RuntimeClientError::CommunicationFailed);
        }
        *state = Some(Session::default());
        Ok(Self(Arc::clone(slot)))
    }
}

impl Drop for Scope {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0.lock() {
            state.take();
        }
    }
}

impl Process {
    fn spawn(path: &Path) -> Result<Self, RuntimeClientError> {
        let mut child = Command::new(path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    RuntimeClientError::RuntimeUnavailable
                } else {
                    RuntimeClientError::CommunicationFailed
                }
            })?;
        let stdin = child
            .stdin
            .take()
            .ok_or(RuntimeClientError::CommunicationFailed)?;
        let mut stdout = child
            .stdout
            .take()
            .ok_or(RuntimeClientError::CommunicationFailed)?;
        let (sender, responses) = mpsc::sync_channel(1);
        std::thread::spawn(move || loop {
            let result = read_bounded_response_line(&mut stdout);
            let terminal = result.as_ref().map_or(true, |bytes| {
                bytes.is_empty() || bytes.len() > MAX_RESPONSE_BYTES
            });
            if sender.send(result).is_err() || terminal {
                break;
            }
        });
        Ok(Self {
            child,
            stdin,
            responses,
        })
    }
}

impl Session {
    pub(super) fn send(
        &mut self,
        runtime: &Path,
        request: &str,
        timeout: Duration,
    ) -> Result<String, RuntimeClientError> {
        // A child ending between requests loses its volatile material. The
        // next Runtime still has to validate explicit apply material normally.
        if let Some(process) = self.process.as_mut() {
            if process
                .child
                .try_wait()
                .map_err(|_| RuntimeClientError::CommunicationFailed)?
                .is_some()
            {
                self.process.take();
            }
        }
        if self.process.is_none() {
            self.process = Some(Process::spawn(runtime)?);
        }
        let process = self
            .process
            .as_mut()
            .ok_or(RuntimeClientError::CommunicationFailed)?;
        if writeln!(process.stdin, "{request}")
            .and_then(|_| process.stdin.flush())
            .is_err()
        {
            self.process.take();
            return Err(RuntimeClientError::CommunicationFailed);
        }
        let result = process.responses.recv_timeout(timeout);
        let bytes = match result {
            Ok(Ok(bytes)) => bytes,
            Ok(Err(_)) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                self.process.take();
                return Err(RuntimeClientError::CommunicationFailed);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.process.take();
                return Err(RuntimeClientError::TimedOut);
            }
        };
        if bytes.is_empty() || bytes.len() > MAX_RESPONSE_BYTES {
            let status = if bytes.is_empty() {
                let deadline = std::time::Instant::now() + timeout.min(Duration::from_millis(100));
                loop {
                    let observed = self
                        .process
                        .as_mut()
                        .and_then(|p| p.child.try_wait().ok())
                        .flatten();
                    if observed.is_some() || std::time::Instant::now() >= deadline {
                        break observed;
                    }
                    std::thread::sleep(Duration::from_millis(2));
                }
            } else {
                None
            };
            self.process.take();
            if bytes.is_empty()
                && super::release_artifact_soak_process_loss_requested()
                && status.and_then(|s| s.code())
                    == Some(super::RELEASE_ARTIFACT_SOAK_PROCESS_LOSS_EXIT_CODE)
            {
                return Err(RuntimeClientError::ReleaseArtifactSoakProcessLoss);
            }
            return Err(RuntimeClientError::InvalidResponse);
        }
        let text = String::from_utf8(bytes).map_err(|_| RuntimeClientError::InvalidResponse)?;
        text.lines()
            .find(|line| !line.trim().is_empty())
            .map(|line| line.trim().to_owned())
            .ok_or(RuntimeClientError::InvalidResponse)
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    struct OwnedPeer(std::path::PathBuf);
    impl OwnedPeer {
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for OwnedPeer {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn peer(fixture: &str) -> OwnedPeer {
        let root = OwnedPeer(
            std::env::temp_dir().join(format!("brownie-session-{}", uuid::Uuid::new_v4())),
        );
        std::fs::create_dir(root.path()).unwrap();
        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let script = root.path().join("peer");
        let source = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(fixture);
        std::os::unix::fs::symlink(source, script).unwrap();
        root
    }

    #[test]
    fn one_scope_keeps_actual_process_memory_and_drop_ends_the_child() {
        let root = peer("session_counter.py");
        let slot = Slot::default();
        let scope = Scope::begin(&slot).unwrap();
        let mut values = Vec::new();
        for _ in 0..2 {
            let text = slot
                .lock()
                .unwrap()
                .as_mut()
                .unwrap()
                .send(&root.path().join("peer"), "{}", Duration::from_secs(2))
                .unwrap();
            values.push(serde_json::from_str::<serde_json::Value>(&text).unwrap());
        }
        assert_eq!(values[0]["pid"], values[1]["pid"]);
        assert_eq!(values[0]["n"], 1);
        assert_eq!(values[1]["n"], 2);
        let pid = values[0]["pid"].as_u64().unwrap().to_string();
        drop(scope);
        assert!(slot.lock().unwrap().is_none());
        assert!(!Command::new("/bin/kill")
            .args(["-0", &pid])
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success());
    }

    #[test]
    fn response_timeout_ends_the_owned_child_and_does_not_replay_the_request() {
        let root = peer("session_timeout.py");
        let mut session = Session::default();
        let pid: u32 = session
            .send(&root.path().join("peer"), "warm", Duration::from_secs(2))
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(
            session.send(&root.path().join("peer"), "{}", Duration::from_millis(200)),
            Err(RuntimeClientError::TimedOut)
        );
        assert!(session.process.is_none());
        assert!(!Command::new("/bin/kill")
            .args(["-0", &pid.to_string()])
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success());
        assert_eq!(
            std::fs::read_to_string(root.path().join("calls")).unwrap(),
            "one\n"
        );
    }

    #[test]
    fn nested_scope_is_refused_and_other_scopes_are_unchanged() {
        let slot = Slot::default();
        let scope = Scope::begin(&slot).unwrap();
        assert!(matches!(
            Scope::begin(&slot),
            Err(RuntimeClientError::CommunicationFailed)
        ));
        drop(scope);
        assert!(Scope::begin(&slot).is_ok());
    }
}
