use std::path::Path;

pub(super) fn prepare_current_agentmodes_checkout_for_test(root: &Path) -> Result<(), String> {
    let baseline = brownie_agentmodes::CURRENT_AGENTMODES_COMPATIBILITY_BASELINE;
    if current_agentmodes_revision(root).as_deref() == Some(baseline.revision)
        && root
            .join(brownie_agentmodes::AGENTMODES_WORKFLOW_PATH)
            .is_file()
        && root.join("prompts/core.orchestrator.md").is_file()
    {
        return Ok(());
    }
    if root.exists() {
        std::fs::remove_dir_all(root).map_err(|error| format!("remove stale checkout: {error}"))?;
    }
    std::fs::create_dir_all(root.parent().expect("AgentModes checkout parent"))
        .map_err(|error| format!("create checkout parent: {error}"))?;
    let repository_url = format!("https://github.com/{}.git", baseline.repository);
    run_git_with_retries("clone AgentModes compatibility baseline", || {
        if root.exists() {
            let _ = std::fs::remove_dir_all(root);
        }
        let mut command = std::process::Command::new("git");
        command
            .args([
                "-c",
                "http.connectTimeout=10",
                "-c",
                "http.lowSpeedTime=10",
                "-c",
                "http.lowSpeedLimit=1",
            ])
            .arg("clone")
            .arg("--no-checkout")
            .arg(&repository_url)
            .arg(root);
        command
    })?;
    run_git_with_retries("fetch AgentModes compatibility baseline revision", || {
        let mut command = std::process::Command::new("git");
        command
            .arg("-C")
            .arg(root)
            .arg("fetch")
            .arg("--depth")
            .arg("1")
            .arg("origin")
            .arg(baseline.revision);
        command
    })?;
    run_git_with_retries(
        "checkout AgentModes compatibility baseline revision",
        || {
            let mut command = std::process::Command::new("git");
            command
                .arg("-C")
                .arg(root)
                .arg("checkout")
                .arg("--detach")
                .arg(baseline.revision);
            command
        },
    )?;
    Ok(())
}

fn run_git_with_retries<F>(operation: &str, mut command: F) -> Result<(), String>
where
    F: FnMut() -> std::process::Command,
{
    const MAX_ATTEMPTS: usize = 2;
    let mut diagnostics = Vec::new();
    for attempt in 1..=MAX_ATTEMPTS {
        let output = command()
            .output()
            .map_err(|error| format!("attempt {attempt}: spawn failed: {error}"))?;
        if output.status.success() {
            return Ok(());
        }
        diagnostics.push(format!(
            "attempt {attempt}: status={}; stderr={}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
        if attempt < MAX_ATTEMPTS {
            std::thread::sleep(std::time::Duration::from_secs(attempt as u64));
        }
    }
    Err(format!("{operation}; {}", diagnostics.join(" | ")))
}

pub(super) fn current_agentmodes_revision(root: &Path) -> Option<String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(root)
        .arg("rev-parse")
        .arg("HEAD")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
