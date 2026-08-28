//! External Mode Pack management crate.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use brownie_agentmodes::{CompiledModePolicy, ModePermissions, WorkspaceWriteScope};
use serde::Deserialize;

pub const DEFAULT_MODEPACK_NAME: &str = "agentmodes";
pub const WORKSPACE_MODEPACK_PATH: &str = ".brownie/modepack.json";
pub const MODEPACK_SCHEMA_VERSION: u64 = 1;
const MAX_HANDOFF_TARGETS: usize = 16;
const MAX_HANDOFF_TARGET_CHARS: usize = 64;
const MAX_MODE_ID_REFERENCE_CHARS: usize = 64;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ModePackEntrypoints {
    pub default: Option<String>,
}

impl ModePackEntrypoints {
    pub fn default_mode_id(&self) -> Option<&str> {
        self.default.as_deref()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModePackSnapshot {
    pub name: String,
    pub schema_version: u64,
    pub source_path: PathBuf,
    pub entrypoints: ModePackEntrypoints,
    pub modes: Vec<CompiledModePolicy>,
}

#[derive(Debug, Deserialize)]
struct RawModePack {
    name: String,
    schema_version: u64,
    #[serde(default)]
    entrypoints: RawModePackEntrypoints,
    modes: Vec<RawModePolicy>,
}

#[derive(Debug, Default, Deserialize)]
struct RawModePackEntrypoints {
    #[serde(default)]
    default: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawModePolicy {
    mode_id: String,
    display_name: String,
    role_definition: String,
    #[serde(default)]
    when_to_use: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    prompt_sections: Vec<brownie_agentmodes::CompiledPromptSection>,
    #[serde(default)]
    verification_responsibility: Option<String>,
    #[serde(default)]
    instruction_fingerprint: Option<String>,
    permissions: ModePermissions,
    #[serde(default)]
    workspace_write_scopes: Vec<WorkspaceWriteScope>,
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
            when_to_use: raw_mode
                .when_to_use
                .map(|value| non_empty("when_to_use", value))
                .transpose()?,
            description: raw_mode
                .description
                .map(|value| non_empty("description", value))
                .transpose()?,
            prompt_sections: raw_mode
                .prompt_sections
                .into_iter()
                .map(validate_prompt_section)
                .collect::<Result<Vec<_>>>()?,
            verification_responsibility: raw_mode
                .verification_responsibility
                .map(|value| non_empty("verification_responsibility", value))
                .transpose()?,
            instruction_fingerprint: raw_mode
                .instruction_fingerprint
                .map(|value| non_empty("instruction_fingerprint", value))
                .transpose()?,
            permissions: raw_mode.permissions,
            workspace_write_scopes: raw_mode.workspace_write_scopes,
            allowed_handoff_targets,
            completion_rules: raw_mode
                .completion_rules
                .into_iter()
                .map(|rule| non_empty("completion_rules[]", rule))
                .collect::<Result<Vec<_>>>()?,
        });
    }
    let entrypoints = validate_entrypoints(raw.entrypoints, &seen)?;

    Ok(ModePackSnapshot {
        name,
        schema_version: raw.schema_version,
        source_path,
        entrypoints,
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

fn validate_prompt_section(
    section: brownie_agentmodes::CompiledPromptSection,
) -> Result<brownie_agentmodes::CompiledPromptSection> {
    Ok(brownie_agentmodes::CompiledPromptSection {
        title: non_empty("prompt_sections[].title", section.title)?,
        content: non_empty("prompt_sections[].content", section.content)?,
        source: non_empty("prompt_sections[].source", section.source)?,
        content_fingerprint: non_empty(
            "prompt_sections[].content_fingerprint",
            section.content_fingerprint,
        )?,
    })
}

fn validate_permissions(mode_id: &str, permissions: &ModePermissions) -> Result<()> {
    if permissions.read_only && (permissions.workspace_write || permissions.process_exec) {
        bail!("mode {mode_id} declares read_only=true with side-effect capabilities");
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

fn validate_entrypoints(
    entrypoints: RawModePackEntrypoints,
    mode_ids: &HashSet<String>,
) -> Result<ModePackEntrypoints> {
    let default = entrypoints
        .default
        .map(|mode_id| validate_mode_id_reference("entrypoints.default", mode_id, mode_ids))
        .transpose()?;
    Ok(ModePackEntrypoints { default })
}

fn validate_mode_id_reference(
    field: &str,
    value: String,
    mode_ids: &HashSet<String>,
) -> Result<String> {
    let value = non_empty(field, value)?;
    if value.chars().count() > MAX_MODE_ID_REFERENCE_CHARS {
        bail!("modepack {field} exceeds length limit");
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        bail!("modepack {field} contains unsupported characters");
    }
    if !mode_ids.contains(&value) {
        bail!("modepack {field} references unknown mode_id: {value}");
    }
    Ok(value)
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
    use brownie_agentmodes::{
        compile_agentmodes_modepack_to_json, AgentModesCompileOptions, RuntimeAction,
        RuntimePermissionGate,
    };

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
        assert_eq!(snapshot.entrypoints.default_mode_id(), None);
    }

    #[test]
    fn loads_default_entrypoint_when_it_references_a_mode() {
        let temp = tempfile::tempdir().expect("tempdir");
        let brownie_dir = temp.path().join(".brownie");
        fs::create_dir_all(&brownie_dir).expect("brownie dir");
        fs::write(
            brownie_dir.join("modepack.json"),
            r#"{
              "name": "entrypoint-pack",
              "schema_version": 1,
              "entrypoints": {
                "default": "external-orchestrator"
              },
              "modes": [
                {
                  "mode_id": "external-orchestrator",
                  "display_name": "External Orchestrator",
                  "role_definition": "Select a runtime-owned workflow entry mode.",
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

        assert_eq!(
            snapshot.entrypoints.default_mode_id(),
            Some("external-orchestrator")
        );
    }

    #[test]
    fn rejects_unknown_blank_and_unsafe_default_entrypoints() {
        for (default_mode, expected) in [
            ("missing-mode", "references unknown mode_id"),
            ("   ", "must not be empty"),
            (
                "../external-orchestrator",
                "contains unsupported characters",
            ),
        ] {
            let content = format!(
                r#"{{
                  "name": "entrypoint-pack",
                  "schema_version": 1,
                  "entrypoints": {{
                    "default": "{default_mode}"
                  }},
                  "modes": [
                    {{
                      "mode_id": "external-orchestrator",
                      "display_name": "External Orchestrator",
                      "role_definition": "Select a runtime-owned workflow entry mode.",
                      "permissions": {{
                        "read_only": true,
                        "workspace_write": false,
                        "process_exec": false,
                        "network_access": false,
                        "service_control": false,
                        "destructive": false,
                        "can_spawn_subtasks": false
                      }}
                    }}
                  ]
                }}"#
            );

            let error = load_modepack_from_str(&content, ".brownie/modepack.json")
                .expect_err("invalid default entrypoint")
                .to_string();

            assert!(
                error.contains(expected),
                "expected {error:?} to contain {expected:?}"
            );
        }
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
    fn loads_workspace_write_and_process_execution_modes() {
        let temp = tempfile::tempdir().expect("tempdir");
        let brownie_dir = temp.path().join(".brownie");
        fs::create_dir_all(&brownie_dir).expect("brownie dir");
        fs::write(
            brownie_dir.join("modepack.json"),
            r#"{
              "name": "trusted-agentmodes",
              "schema_version": 1,
              "modes": [
                {
                  "mode_id": "external-editor",
                  "display_name": "External Editor",
                  "role_definition": "Edit files through runtime-controlled tools.",
                  "permissions": {
                    "read_only": false,
                    "workspace_write": true,
                    "process_exec": false,
                    "network_access": false,
                    "service_control": false,
                    "destructive": false,
                    "can_spawn_subtasks": false
                  }
                },
                {
                  "mode_id": "external-tester",
                  "display_name": "External Tester",
                  "role_definition": "Run bounded verification commands through runtime-controlled tools.",
                  "permissions": {
                    "read_only": false,
                    "workspace_write": false,
                    "process_exec": true,
                    "network_access": false,
                    "service_control": false,
                    "destructive": false,
                    "can_spawn_subtasks": false
                  }
                },
                {
                  "mode_id": "external-integrator",
                  "display_name": "External Integrator",
                  "role_definition": "Coordinate edits and verification through runtime-controlled tools.",
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

        let snapshot = load_workspace_modepack(temp.path())
            .expect("trusted side-effect modes should compile")
            .expect("snapshot");

        let editor = snapshot
            .modes
            .iter()
            .find(|mode| mode.mode_id == "external-editor")
            .expect("editor mode");
        assert!(editor.permissions.workspace_write);
        assert!(!editor.permissions.process_exec);

        let tester = snapshot
            .modes
            .iter()
            .find(|mode| mode.mode_id == "external-tester")
            .expect("tester mode");
        assert!(!tester.permissions.workspace_write);
        assert!(tester.permissions.process_exec);

        let integrator = snapshot
            .modes
            .iter()
            .find(|mode| mode.mode_id == "external-integrator")
            .expect("integrator mode");
        assert!(integrator.permissions.workspace_write);
        assert!(integrator.permissions.process_exec);
    }

    #[test]
    fn accepts_compiled_agentmodes_modepack_json() {
        let yaml = r#"
customModes:
  - slug: orchestrator
    name: Orchestrator
    roleDefinition: Coordinate without direct side effects.
    groups:
      - read
    customInstructions: |
      Delegate to specialists through AgentModes policy.
  - slug: code
    name: Code
    roleDefinition: Implement bounded changes.
    groups:
      - read
      - edit
  - slug: tester
    name: Tester
    roleDefinition: Run verification.
    groups:
      - read
      - command
  - slug: reviewer
    name: Reviewer
    roleDefinition: Review prose mentions edit and command but grants neither.
    groups:
      - read
      - mcp
"#;
        let json = compile_agentmodes_modepack_to_json(
            yaml,
            AgentModesCompileOptions {
                modepack_name: Some("compiled-agentmodes".to_string()),
                default_entrypoint: Some("orchestrator".to_string()),
                ..AgentModesCompileOptions::default()
            },
        )
        .expect("compile AgentModes YAML");
        let snapshot =
            load_modepack_from_str(&json, ".brownie/modepack.json").expect("valid Mode Pack");

        assert_eq!(snapshot.name, "compiled-agentmodes");
        assert_eq!(snapshot.entrypoints.default_mode_id(), Some("orchestrator"));
        assert!(json.contains("Delegate to specialists through AgentModes policy"));
        assert!(json.contains("\"instruction_fingerprint\""));

        let code = snapshot
            .modes
            .iter()
            .find(|mode| mode.mode_id == "code")
            .expect("code mode");
        assert!(code.prompt_sections.is_empty());
        assert!(RuntimePermissionGate::check(code, RuntimeAction::WriteWorkspace).allowed);
        assert!(!RuntimePermissionGate::check(code, RuntimeAction::ExecuteProcess).allowed);

        let tester = snapshot
            .modes
            .iter()
            .find(|mode| mode.mode_id == "tester")
            .expect("tester mode");
        assert!(!RuntimePermissionGate::check(tester, RuntimeAction::WriteWorkspace).allowed);
        assert!(RuntimePermissionGate::check(tester, RuntimeAction::ExecuteProcess).allowed);

        let reviewer = snapshot
            .modes
            .iter()
            .find(|mode| mode.mode_id == "reviewer")
            .expect("reviewer mode");
        assert!(!RuntimePermissionGate::check(reviewer, RuntimeAction::WriteWorkspace).allowed);
        assert!(!RuntimePermissionGate::check(reviewer, RuntimeAction::ExecuteProcess).allowed);
        assert!(!RuntimePermissionGate::check(reviewer, RuntimeAction::AccessNetwork).allowed);
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
    fn rejects_external_service_and_destructive_permissions() {
        for (field, expected) in [
            ("service_control", "unsupported service control"),
            ("destructive", "unsupported destructive operations"),
        ] {
            let modepack = format!(
                r#"{{
                  "name": "unsafe",
                  "schema_version": 1,
                  "modes": [
                    {{
                      "mode_id": "{field}",
                      "display_name": "Unsafe",
                      "role_definition": "Should be rejected.",
                      "permissions": {{
                        "read_only": false,
                        "workspace_write": false,
                        "process_exec": false,
                        "network_access": false,
                        "service_control": {},
                        "destructive": {},
                        "can_spawn_subtasks": false
                      }}
                    }}
                  ]
                }}"#,
                field == "service_control",
                field == "destructive"
            );

            let error = load_modepack_from_str(&modepack, ".brownie/modepack.json")
                .expect_err("unsafe modepack should fail")
                .to_string();

            assert!(
                error.contains(expected),
                "expected {expected:?} for {field}, got {error:?}"
            );
        }
    }

    #[test]
    fn rejects_read_only_side_effect_combination() {
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
              "name": "contradictory",
              "schema_version": 1,
              "modes": [
                {
                  "mode_id": "confused-editor",
                  "display_name": "Confused Editor",
                  "role_definition": "Claims read-only while asking for side effects.",
                  "permissions": {
                    "read_only": true,
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
            .expect_err("contradictory modepack should fail")
            .to_string();

        assert!(error.contains("read_only=true with side-effect capabilities"));
    }
}
