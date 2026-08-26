use std::process::Command;

fn brownie() -> &'static str {
    env!("CARGO_BIN_EXE_brownie")
}

#[test]
fn help_succeeds_and_names_general_run_command() {
    let output = Command::new(brownie()).arg("--help").output().unwrap();
    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("run <objective>"));
    assert!(stdout.contains("resume"));
    assert!(stdout.contains("status"));
    assert!(!stdout.contains("develop"));
}

#[test]
fn version_succeeds() {
    let output = Command::new(brownie()).arg("--version").output().unwrap();
    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("brownie"));
    assert!(stdout.contains(env!("CARGO_PKG_VERSION")));
}

#[test]
fn invalid_invocation_exits_non_zero() {
    let output = Command::new(brownie())
        .args(["inspect", "task"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("missing task-id"));
}

#[test]
fn develop_is_not_a_primary_command() {
    let output = Command::new(brownie())
        .args(["develop", "change code"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("unknown command: develop"));
}
