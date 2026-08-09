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
const MAX_HANDOFF_TARGETS: usize = 16;
const MAX_HANDOFF_TARGET_CHARS: usize = 64;

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
    allowed_handoff_targets: Vec<String>,
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

pub fn load_modepack_from_str(
    content: &str,
    source_path: impl Into<PathBuf>,
) -> Result<ModePackSnapshot> {
    let raw: RawModePack =
        serde_json::from_str(content).context("failed to parse Mode Pack JSON")?;
    compile_snapshot(raw, source_path.into())
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
        let allowed_handoff_targets = validate_handoff_targets(
            &mode_id,
            &raw_mode.permissions,
            raw_mode.allowed_handoff_targets,
        )?;
        modes.push(CompiledModePolicy {
            mode_id,
            display_name: non_empty("display_name", raw_mode.display_name)?,
            role_definition: non_empty("role_definition", raw_mode.role_definition)?,
            permissions: raw_mode.permissions,
            allowed_handoff_targets,
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

fn validate_handoff_targets(
    mode_id: &str,
    permissions: &ModePermissions,
    targets: Vec<String>,
) -> Result<Option<Vec<String>>> {
    if !permissions.can_spawn_subtasks {
        if targets.is_empty() {
            return Ok(None);
        }
        bail!("mode {mode_id} declares handoff targets without subtask permission");
    }
    if targets.is_empty() {
        bail!("mode {mode_id} can spawn subtasks but declares no allowed_handoff_targets");
    }
    if targets.len() > MAX_HANDOFF_TARGETS {
        bail!("mode {mode_id} declares too many allowed_handoff_targets");
    }
    let mut seen = HashSet::new();
    let mut normalized = Vec::with_capacity(targets.len());
    for target in targets {
        let target = non_empty("allowed_handoff_targets[]", target)?;
        if target.chars().count() > MAX_HANDOFF_TARGET_CHARS {
            bail!("mode {mode_id} allowed_handoff_targets entry exceeds length limit");
        }
        if !target
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
        {
            bail!("mode {mode_id} allowed_handoff_targets entry contains unsupported characters");
        }
        if !seen.insert(target.clone()) {
            bail!("mode {mode_id} declares duplicate allowed_handoff_targets entry: {target}");
        }
        normalized.push(target);
    }
    Ok(Some(normalized))
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
        assert_eq!(snapshot.modes[0].allowed_handoff_targets, None);
    }

    #[test]
    fn loads_spawning_mode_with_bounded_handoff_targets() {
        let temp = tempfile::tempdir().expect("tempdir");
        let brownie_dir = temp.path().join(".brownie");
        fs::create_dir_all(&brownie_dir).expect("brownie dir");
        fs::write(
            brownie_dir.join("modepack.json"),
            r#"{
              "name": "handoff-pack",
              "schema_version": 1,
              "modes": [
                {
                  "mode_id": "external-orchestrator",
                  "display_name": "External Orchestrator",
                  "role_definition": "Delegate only to approved child modes.",
                  "permissions": {
                    "read_only": true,
                    "workspace_write": false,
                    "process_exec": false,
                    "network_access": false,
                    "service_control": false,
                    "destructive": false,
                    "can_spawn_subtasks": true
                  },
                  "allowed_handoff_targets": ["reviewer-lite"]
                },
                {
                  "mode_id": "reviewer-lite",
                  "display_name": "Reviewer Lite",
                  "role_definition": "Review without writing.",
                  "permissions": {
                    "read_only": true,
                    "workspace_write": false,
                    "process_exec": false,
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

        let snapshot = load_workspace_modepack(temp.path())
            .expect("load")
            .expect("snapshot");

        let orchestrator = snapshot
            .modes
            .iter()
            .find(|mode| mode.mode_id == "external-orchestrator")
            .expect("external orchestrator");
        assert_eq!(
            orchestrator.allowed_handoff_targets,
            Some(vec!["reviewer-lite".to_string()])
        );
    }

    #[test]
    fn rejects_spawning_mode_without_handoff_targets() {
        let temp = tempfile::tempdir().expect("tempdir");
        let brownie_dir = temp.path().join(".brownie");
        fs::create_dir_all(&brownie_dir).expect("brownie dir");
        fs::write(
            brownie_dir.join("modepack.json"),
            r#"{
              "name": "unsafe-handoff",
              "schema_version": 1,
              "modes": [
                {
                  "mode_id": "external-orchestrator",
                  "display_name": "External Orchestrator",
                  "role_definition": "Should declare handoff targets.",
                  "permissions": {
                    "read_only": true,
                    "workspace_write": false,
                    "process_exec": false,
                    "network_access": false,
                    "service_control": false,
                    "destructive": false,
                    "can_spawn_subtasks": true
                  }
                }
              ]
            }"#,
        )
        .expect("modepack");

        let error = load_workspace_modepack(temp.path())
            .expect_err("spawning mode without targets should fail")
            .to_string();

        assert!(error.contains("declares no allowed_handoff_targets"));
    }

    #[test]
    fn rejects_invalid_handoff_targets() {
        let temp = tempfile::tempdir().expect("tempdir");
        let brownie_dir = temp.path().join(".brownie");
        fs::create_dir_all(&brownie_dir).expect("brownie dir");
        fs::write(
            brownie_dir.join("modepack.json"),
            r#"{
              "name": "unsafe-handoff",
              "schema_version": 1,
              "modes": [
                {
                  "mode_id": "external-orchestrator",
                  "display_name": "External Orchestrator",
                  "role_definition": "Invalid target.",
                  "permissions": {
                    "read_only": true,
                    "workspace_write": false,
                    "process_exec": false,
                    "network_access": false,
                    "service_control": false,
                    "destructive": false,
                    "can_spawn_subtasks": true
                  },
                  "allowed_handoff_targets": ["../implementer"]
                }
              ]
            }"#,
        )
        .expect("modepack");

        let error = load_workspace_modepack(temp.path())
            .expect_err("invalid target should fail")
            .to_string();

        assert!(error.contains("unsupported characters"));
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
