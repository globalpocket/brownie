//! Exercise the production Git tool implementation from an isolated fixture.
use std::path::PathBuf;

use anyhow::Context;
use brownie_tools::GitCommandExecutor;
use serde_json::json;

fn main() -> anyhow::Result<()> {
    let root = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .context("explicit isolated workspace is required")?;
    let result = GitCommandExecutor::status(&root, &json!({}))?;
    println!(
        "{}",
        json!({
            "built_source_commit": option_env!("BROWNIE_PROBE_SOURCE_COMMIT"),
            "result": result,
        })
    );
    Ok(())
}
