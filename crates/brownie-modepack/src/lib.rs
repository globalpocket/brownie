//! External Mode Pack management crate.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use brownie_agentmodes::{CompiledModePolicy, ModePermissions};
use serde::Deserialize;

pub const DEFAULT_MODEPACK_NAME: &str = "agentmodes";
pub const WORKSPACE_MODEPACK_PATH: &str = ".brownie/modepack.json";
pub const MODEPACK_SCHEMA_VERSION: u64 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModePackSnapshot {
    pub name: String,
    pub schema_version: u64,
    pub source_path: PathBuf,
    pub modes: Vec<CompiledModePolicy>,
}

#[derive(Debug, Deserialize)]
struct RawModePack {
    name: String,
    schema_version: u64,
    modes: Vec<RawModePolicy>,
}

#[derive(Debug, Deserialize)]
struct RawModePolicy {
    mode_id: String,
    display_name: String,
    role_definition: String,
    permissions: ModePermissions,
    #[serde(default)]
    completion_rules: Vec<String>,
}

pub fn load_workspace_modepack(
    workspace_root: impl AsRef<Path>,
) -> Result<Option<ModePackSnapshot>> {
    let path = workspace_root.as_ref().join(WORKSPACE_MODEPACK_PATH);
    if !path.exists() {
        return Ok(None);
    }
    let content =
        fs::read_to_string(&path).with_context(|| format!("failed to read {}", path.display()))?;
    let raw: RawModePack = serde_json::from_str(&content)
        .with_context(|| format!("failed to parse {}", path.display()))?;
    Ok(Some(compile_snapshot(raw, path)?))
}

fn compile_snapshot(raw: RawModePack, source_path: PathBuf) -> Result<ModePackSnapshot> {
    if raw.schema_version != MODEPACK_SCHEMA_VERSION {
        bail!(
            "unsupported modepack schema_version {}; expected {}",
            raw.schema_version,
            MODEPACK_SCHEMA_VERSION
        );
    }
    let name = non_empty("name", raw.name)?;
    if raw.modes.is_empty() {
        bail!("modepack must contain at least one mode");
    }

    let mut seen = HashSet::new();
    let mut modes = Vec::with_capacity(raw.modes.len());
    for raw_mode in raw.modes {
        let mode_id = non_empty("mode_id", raw_mode.mode_id)?;
        if !seen.insert(mode_id.clone()) {
            bail!("duplicate mode_id in modepack: {mode_id}");
        }
        validate_permissions(&mode_id, &raw_mode.permissions)?;
        modes.push(CompiledModePolicy {
            mode_id,
            display_name: non_empty("display_name", raw_mode.display_name)?,
            role_definition: non_empty("role_definition", raw_mode.role_definition)?,
            permissions: raw_mode.permissions,
            completion_rules: raw_mode
                .completion_rules
                .into_iter()
                .map(|rule| non_empty("completion_rules[]", rule))
                .collect::<Result<Vec<_>>>()?,
        });
    }

    Ok(ModePackSnapshot {
        name,
        schema_version: raw.schema_version,
        source_path,
        modes,
    })
}

fn non_empty(field: &str, value: String) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        bail!("modepack {field} must not be empty");
    }
    Ok(trimmed.to_string())
}

fn validate_permissions(mode_id: &str, permissions: &ModePermissions) -> Result<()> {
    if !permissions.read_only || permissions.workspace_write {
        bail!("mode {mode_id} requests unsupported workspace write access");
    }
    if permissions.process_exec {
        bail!("mode {mode_id} requests unsupported process execution");
    }
    if permissions.network_access {
        bail!("mode {mode_id} requests unsupported network access");
    }
    if permissions.service_control {
        bail!("mode {mode_id} requests unsupported service control");
    }
    if permissions.destructive {
        bail!("mode {mode_id} requests unsupported destructive operations");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_local_modepack_snapshot() {
        let temp = tempfile::tempdir().expect("tempdir");
        let brownie_dir = temp.path().join(".brownie");
        fs::create_dir_all(&brownie_dir).expect("brownie dir");
        fs::write(
            brownie_dir.join("modepack.json"),
            r#"{
              "name": "local-agentmodes",
              "schema_version": 1,
              "modes": [
                {
                  "mode_id": "reviewer-lite",
                  "display_name": "Reviewer Lite",
                  "role_definition": "Review local changes without writing files.",
                  "permissions": {
                    "read_only": true,
                    "workspace_write": false,
                    "process_exec": false,
                    "network_access": false,
                    "service_control": false,
                    "destructive": false,
                    "can_spawn_subtasks": false
                  },
                  "completion_rules": ["Stop after reporting local review findings."]
                }
              ]
            }"#,
        )
        .expect("modepack");

        let snapshot = load_workspace_modepack(temp.path())
            .expect("load")
            .expect("snapshot");

        assert_eq!(snapshot.name, "local-agentmodes");
        assert_eq!(snapshot.schema_version, MODEPACK_SCHEMA_VERSION);
        assert_eq!(
            snapshot.source_path,
            temp.path().join(WORKSPACE_MODEPACK_PATH)
        );
        assert_eq!(snapshot.modes.len(), 1);
        assert_eq!(snapshot.modes[0].mode_id, "reviewer-lite");
        assert!(!snapshot.modes[0].permissions.workspace_write);
    }

    #[test]
    fn rejects_unsafe_permissions() {
        let temp = tempfile::tempdir().expect("tempdir");
        let brownie_dir = temp.path().join(".brownie");
        fs::create_dir_all(&brownie_dir).expect("brownie dir");
        fs::write(
            brownie_dir.join("modepack.json"),
            r#"{
              "name": "unsafe",
              "schema_version": 1,
              "modes": [
                {
                  "mode_id": "networker",
                  "display_name": "Networker",
                  "role_definition": "Should be rejected.",
                  "permissions": {
                    "read_only": true,
                    "workspace_write": false,
                    "process_exec": false,
                    "network_access": true,
                    "service_control": false,
                    "destructive": false,
                    "can_spawn_subtasks": false
                  }
                }
              ]
            }"#,
        )
        .expect("modepack");

        let error = load_workspace_modepack(temp.path())
            .expect_err("unsafe modepack should fail")
            .to_string();

        assert!(error.contains("unsupported network access"));
    }

    #[test]
    fn rejects_workspace_write_and_process_execution() {
        let temp = tempfile::tempdir().expect("temp dir");
        let brownie_dir = temp
            .path()
            .join(WORKSPACE_MODEPACK_PATH)
            .parent()
            .expect("modepack parent")
            .to_path_buf();
        fs::create_dir_all(&brownie_dir).expect("modepack dir");
        fs::write(
            brownie_dir.join("modepack.json"),
            r#"{
              "name": "unsafe",
              "schema_version": 1,
              "modes": [
                {
                  "mode_id": "writer",
                  "display_name": "Writer",
                  "role_definition": "Should be rejected.",
                  "permissions": {
                    "read_only": false,
                    "workspace_write": true,
                    "process_exec": true,
                    "network_access": false,
                    "service_control": false,
                    "destructive": false,
                    "can_spawn_subtasks": false
                  }
                }
              ]
            }"#,
        )
        .expect("modepack");

        let error = load_workspace_modepack(temp.path())
            .expect_err("unsafe modepack should fail")
            .to_string();

        assert!(error.contains("unsupported workspace write access"));
    }
}
