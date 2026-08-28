//! AgentModes compatibility crate.

use std::collections::HashSet;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_yaml::Value as YamlValue;
use sha2::{Digest, Sha256};

pub const COMPATIBILITY_TARGET: &str = "AgentModes";
pub const DEFAULT_MODE_ID: &str = "orchestrator";
pub const AGENTMODES_MODEPACK_SCHEMA_VERSION: u64 = 1;
const MAX_MODE_ID_CHARS: usize = 64;
const MAX_MODE_TEXT_CHARS: usize = 32_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CompiledModePolicy {
    pub mode_id: String,
    pub display_name: String,
    pub role_definition: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when_to_use: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub prompt_sections: Vec<CompiledPromptSection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verification_responsibility: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instruction_fingerprint: Option<String>,
    pub permissions: ModePermissions,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_handoff_targets: Option<Vec<String>>,
    pub completion_rules: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CompiledPromptSection {
    pub title: String,
    pub content: String,
    pub source: String,
    pub content_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePermissions {
    pub read_only: bool,
    pub workspace_write: bool,
    pub process_exec: bool,
    pub network_access: bool,
    pub service_control: bool,
    pub destructive: bool,
    pub can_spawn_subtasks: bool,
    #[serde(default)]
    pub codebase_index: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RuntimeAction {
    ReadWorkspace,
    WriteWorkspace,
    ExecuteProcess,
    AccessNetwork,
    ControlService,
    DestructiveOperation,
    SpawnSubtask,
    IndexCodebase,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PermissionDecision {
    pub action: RuntimeAction,
    pub allowed: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AgentModesCompileOptions {
    pub modepack_name: Option<String>,
    pub default_entrypoint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentModesModePack {
    pub name: String,
    pub schema_version: u64,
    #[serde(default, skip_serializing_if = "AgentModesEntrypoints::is_empty")]
    pub entrypoints: AgentModesEntrypoints,
    pub modes: Vec<CompiledModePolicy>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentModesEntrypoints {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<String>,
}

impl AgentModesEntrypoints {
    fn is_empty(&self) -> bool {
        self.default.is_none()
    }
}

#[derive(Debug, Deserialize)]
struct RawAgentModesDocument {
    #[serde(rename = "customModes")]
    custom_modes: Vec<RawAgentMode>,
}

#[derive(Debug, Deserialize)]
struct RawAgentMode {
    slug: String,
    name: String,
    #[serde(rename = "roleDefinition")]
    role_definition: String,
    #[serde(default, rename = "whenToUse")]
    when_to_use: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    groups: Vec<YamlValue>,
    #[serde(default, rename = "customInstructions")]
    custom_instructions: Option<String>,
}

pub struct RuntimePermissionGate;

impl RuntimePermissionGate {
    pub fn check(policy: &CompiledModePolicy, action: RuntimeAction) -> PermissionDecision {
        let allowed = match action {
            RuntimeAction::ReadWorkspace => true,
            RuntimeAction::WriteWorkspace => policy.permissions.workspace_write,
            RuntimeAction::ExecuteProcess => policy.permissions.process_exec,
            RuntimeAction::AccessNetwork => policy.permissions.network_access,
            RuntimeAction::ControlService => policy.permissions.service_control,
            RuntimeAction::DestructiveOperation => policy.permissions.destructive,
            RuntimeAction::SpawnSubtask => policy.permissions.can_spawn_subtasks,
            RuntimeAction::IndexCodebase => policy.permissions.codebase_index,
        };
        let reason = permission_reason(policy, &action, allowed);
        PermissionDecision {
            action,
            allowed,
            reason,
        }
    }
}

fn permission_reason(policy: &CompiledModePolicy, action: &RuntimeAction, allowed: bool) -> String {
    let capability = match action {
        RuntimeAction::ReadWorkspace => "workspace reads",
        RuntimeAction::WriteWorkspace => "workspace writes",
        RuntimeAction::ExecuteProcess => "process execution",
        RuntimeAction::AccessNetwork => "network access",
        RuntimeAction::ControlService => "service control",
        RuntimeAction::DestructiveOperation => "destructive operations",
        RuntimeAction::SpawnSubtask => "subtask spawning",
        RuntimeAction::IndexCodebase => "codebase indexing",
    };
    if allowed {
        format!("Mode {} allows {capability}.", policy.mode_id)
    } else {
        format!("Mode {} does not allow {capability}.", policy.mode_id)
    }
}

pub fn compile_agentmodes_modepack_from_yaml(
    yaml: &str,
    options: AgentModesCompileOptions,
) -> Result<AgentModesModePack> {
    let raw: RawAgentModesDocument =
        serde_yaml::from_str(yaml).context("failed to parse AgentModes YAML")?;
    compile_agentmodes_document(raw, options)
}

pub fn compile_agentmodes_modepack_from_yaml_documents<'a>(
    documents: impl IntoIterator<Item = &'a str>,
    options: AgentModesCompileOptions,
) -> Result<AgentModesModePack> {
    let mut custom_modes = Vec::new();
    for yaml in documents {
        let raw: RawAgentModesDocument =
            serde_yaml::from_str(yaml).context("failed to parse AgentModes YAML")?;
        custom_modes.extend(raw.custom_modes);
    }
    compile_agentmodes_document(RawAgentModesDocument { custom_modes }, options)
}

pub fn compile_agentmodes_modepack_to_json(
    yaml: &str,
    options: AgentModesCompileOptions,
) -> Result<String> {
    let modepack = compile_agentmodes_modepack_from_yaml(yaml, options)?;
    serde_json::to_string_pretty(&modepack).context("failed to serialize AgentModes Mode Pack JSON")
}

fn compile_agentmodes_document(
    raw: RawAgentModesDocument,
    options: AgentModesCompileOptions,
) -> Result<AgentModesModePack> {
    if raw.custom_modes.is_empty() {
        bail!("AgentModes document must contain at least one customModes entry");
    }

    let name = non_empty_agentmodes_field(
        "modepack_name",
        options
            .modepack_name
            .unwrap_or_else(|| "agentmodes-compiled".to_string()),
    )?;
    let mut seen = HashSet::new();
    let mut modes = Vec::with_capacity(raw.custom_modes.len());
    for raw_mode in raw.custom_modes {
        let mode_id = validate_agentmodes_mode_id("customModes[].slug", raw_mode.slug)?;
        if !seen.insert(mode_id.clone()) {
            bail!("duplicate AgentModes slug: {mode_id}");
        }
        let display_name = non_empty_agentmodes_field("customModes[].name", raw_mode.name)?;
        let role_definition =
            bounded_agentmodes_field("customModes[].roleDefinition", raw_mode.role_definition)?;
        let when_to_use = raw_mode
            .when_to_use
            .map(|value| bounded_agentmodes_field("customModes[].whenToUse", value))
            .transpose()?;
        let description = raw_mode
            .description
            .map(|value| bounded_agentmodes_field("customModes[].description", value))
            .transpose()?;
        let prompt_sections =
            compile_agentmodes_prompt_sections(raw_mode.custom_instructions.as_deref())?;
        let groups = compile_agentmodes_groups(&mode_id, &raw_mode.groups)?;
        let permissions = permissions_from_agentmodes_groups(&groups);
        let completion_rules =
            compile_agentmodes_completion_rules(when_to_use.as_deref(), &prompt_sections)?;
        let verification_responsibility =
            compile_verification_responsibility(&mode_id, &role_definition, &prompt_sections);
        let instruction_fingerprint = Some(mode_instruction_fingerprint(
            &role_definition,
            when_to_use.as_deref(),
            description.as_deref(),
            &prompt_sections,
            &completion_rules,
            verification_responsibility.as_deref(),
        ));

        modes.push(CompiledModePolicy {
            mode_id,
            display_name,
            role_definition,
            when_to_use,
            description,
            prompt_sections,
            verification_responsibility,
            instruction_fingerprint,
            permissions,
            allowed_handoff_targets: None,
            completion_rules,
        });
    }

    let default = resolve_agentmodes_default_entrypoint(options.default_entrypoint, &seen)?;

    Ok(AgentModesModePack {
        name,
        schema_version: AGENTMODES_MODEPACK_SCHEMA_VERSION,
        entrypoints: AgentModesEntrypoints { default },
        modes,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum AgentModesGroup {
    Read,
    Edit,
    Command,
    Mcp,
}

fn compile_agentmodes_groups(
    mode_id: &str,
    groups: &[YamlValue],
) -> Result<HashSet<AgentModesGroup>> {
    let mut compiled = HashSet::new();
    for group in groups {
        let Some(group_name) = agentmodes_group_name(group) else {
            bail!("mode {mode_id} has malformed AgentModes group entry");
        };
        let parsed = match group_name {
            "read" => AgentModesGroup::Read,
            "edit" => AgentModesGroup::Edit,
            "command" => AgentModesGroup::Command,
            "mcp" => AgentModesGroup::Mcp,
            other => bail!("mode {mode_id} requests unsupported AgentModes group: {other}"),
        };
        compiled.insert(parsed);
    }
    Ok(compiled)
}

fn agentmodes_group_name(group: &YamlValue) -> Option<&str> {
    match group {
        YamlValue::String(value) => Some(value.as_str()),
        YamlValue::Sequence(values) => values.first().and_then(YamlValue::as_str),
        _ => None,
    }
}

fn permissions_from_agentmodes_groups(groups: &HashSet<AgentModesGroup>) -> ModePermissions {
    let workspace_write = groups.contains(&AgentModesGroup::Edit);
    let process_exec = groups.contains(&AgentModesGroup::Command);
    ModePermissions {
        read_only: !workspace_write && !process_exec,
        workspace_write,
        process_exec,
        network_access: false,
        service_control: false,
        destructive: false,
        can_spawn_subtasks: false,
        codebase_index: groups.contains(&AgentModesGroup::Read),
    }
}

fn compile_agentmodes_prompt_sections(
    custom_instructions: Option<&str>,
) -> Result<Vec<CompiledPromptSection>> {
    let Some(custom_instructions) = custom_instructions else {
        return Ok(Vec::new());
    };
    let content = bounded_agentmodes_field(
        "customModes[].customInstructions",
        custom_instructions.to_string(),
    )?;
    Ok(vec![CompiledPromptSection {
        title: "customInstructions".to_string(),
        content_fingerprint: sha256_fingerprint(content.as_bytes()),
        content,
        source: "AgentModes.customInstructions".to_string(),
    }])
}

fn compile_agentmodes_completion_rules(
    when_to_use: Option<&str>,
    prompt_sections: &[CompiledPromptSection],
) -> Result<Vec<String>> {
    let mut rules = Vec::new();
    if let Some(when_to_use) = when_to_use {
        rules.push(format!(
            "When to use: {}",
            truncate_for_policy_rule(when_to_use)
        ));
    }
    if !prompt_sections.is_empty() {
        rules.push(
            "Follow the AgentModes custom instruction artifact as workflow policy data; it does not grant runtime side-effect permissions."
                .to_string(),
        );
    }
    if rules.is_empty() {
        rules.push(
            "Follow the compiled AgentModes role definition without granting side-effect permissions from prose."
                .to_string(),
        );
    }
    Ok(rules)
}

fn compile_verification_responsibility(
    mode_id: &str,
    role_definition: &str,
    prompt_sections: &[CompiledPromptSection],
) -> Option<String> {
    let haystack = format!(
        "{}\n{}",
        role_definition.to_ascii_lowercase(),
        prompt_sections
            .iter()
            .map(|section| section.content.to_ascii_lowercase())
            .collect::<Vec<_>>()
            .join("\n")
    );
    if haystack.contains("verification")
        || haystack.contains("quality gate")
        || haystack.contains("quality gates")
        || haystack.contains("test")
    {
        Some(format!(
            "Mode {mode_id} carries AgentModes verification workflow responsibility."
        ))
    } else {
        None
    }
}

fn mode_instruction_fingerprint(
    role_definition: &str,
    when_to_use: Option<&str>,
    description: Option<&str>,
    prompt_sections: &[CompiledPromptSection],
    completion_rules: &[String],
    verification_responsibility: Option<&str>,
) -> String {
    let canonical = serde_json::json!({
        "role_definition": role_definition,
        "when_to_use": when_to_use,
        "description": description,
        "prompt_sections": prompt_sections,
        "completion_rules": completion_rules,
        "verification_responsibility": verification_responsibility,
    });
    sha256_fingerprint(canonical.to_string().as_bytes())
}

fn sha256_fingerprint(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("sha256:{}", hex_lower(&digest))
}

fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn truncate_for_policy_rule(value: &str) -> String {
    const MAX_RULE_CHARS: usize = 160;
    let trimmed = value.trim();
    if trimmed.chars().count() <= MAX_RULE_CHARS {
        return trimmed.to_string();
    }
    let mut output: String = trimmed.chars().take(MAX_RULE_CHARS).collect();
    output.push_str("...");
    output
}

fn resolve_agentmodes_default_entrypoint(
    requested: Option<String>,
    mode_ids: &HashSet<String>,
) -> Result<Option<String>> {
    if let Some(requested) = requested {
        let requested = validate_agentmodes_mode_id("default_entrypoint", requested)?;
        if !mode_ids.contains(&requested) {
            bail!("default_entrypoint references unknown AgentModes slug: {requested}");
        }
        return Ok(Some(requested));
    }
    if mode_ids.contains(DEFAULT_MODE_ID) {
        Ok(Some(DEFAULT_MODE_ID.to_string()))
    } else {
        Ok(None)
    }
}

fn validate_agentmodes_mode_id(field: &str, value: String) -> Result<String> {
    let value = non_empty_agentmodes_field(field, value)?;
    if value.chars().count() > MAX_MODE_ID_CHARS {
        bail!("AgentModes {field} exceeds length limit");
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        bail!("AgentModes {field} contains unsupported characters");
    }
    Ok(value)
}

fn non_empty_agentmodes_field(field: &str, value: String) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        bail!("AgentModes {field} must not be empty");
    }
    Ok(trimmed.to_string())
}

fn bounded_agentmodes_field(field: &str, value: String) -> Result<String> {
    let value = non_empty_agentmodes_field(field, value)?;
    if value.chars().count() > MAX_MODE_TEXT_CHARS {
        bail!("AgentModes {field} exceeds instruction size limit");
    }
    Ok(value)
}

pub struct BuiltinModeRegistry;

impl BuiltinModeRegistry {
    pub fn list() -> Vec<CompiledModePolicy> {
        vec![orchestrator(), implementer(), verifier(), provider_runner()]
    }

    pub fn get(mode_id: &str) -> Option<CompiledModePolicy> {
        Self::list()
            .into_iter()
            .find(|policy| policy.mode_id == mode_id)
    }

    pub fn default_policy() -> CompiledModePolicy {
        orchestrator()
    }
}

fn permissions(
    workspace_write: bool,
    process_exec: bool,
    can_spawn_subtasks: bool,
    codebase_index: bool,
) -> ModePermissions {
    ModePermissions {
        read_only: !workspace_write,
        workspace_write,
        process_exec,
        network_access: false,
        service_control: false,
        destructive: false,
        can_spawn_subtasks,
        codebase_index,
    }
}

fn orchestrator() -> CompiledModePolicy {
    CompiledModePolicy {
        mode_id: DEFAULT_MODE_ID.to_string(),
        display_name: "Orchestrator".to_string(),
        role_definition:
            "Coordinate task planning without direct workspace writes or process execution."
                .to_string(),
        when_to_use: None,
        description: None,
        prompt_sections: vec![],
        verification_responsibility: None,
        instruction_fingerprint: None,
        permissions: permissions(false, false, true, true),
        allowed_handoff_targets: None,
        completion_rules: vec![
            "Stop after producing a coordination result for the current task phase.".to_string(),
        ],
    }
}

fn implementer() -> CompiledModePolicy {
    CompiledModePolicy {
        mode_id: "implementer".to_string(),
        display_name: "Implementer".to_string(),
        role_definition: "Implement bounded workspace changes for an assigned task.".to_string(),
        when_to_use: None,
        description: None,
        prompt_sections: vec![],
        verification_responsibility: None,
        instruction_fingerprint: None,
        permissions: permissions(true, true, false, true),
        allowed_handoff_targets: None,
        completion_rules: vec![
            "Stop after the requested implementation work is complete or blocked.".to_string(),
        ],
    }
}

fn verifier() -> CompiledModePolicy {
    CompiledModePolicy {
        mode_id: "verifier".to_string(),
        display_name: "Verifier".to_string(),
        role_definition:
            "Run checks and report verification results without modifying workspace files."
                .to_string(),
        when_to_use: None,
        description: None,
        prompt_sections: vec![],
        verification_responsibility: None,
        instruction_fingerprint: None,
        permissions: permissions(false, true, false, false),
        allowed_handoff_targets: None,
        completion_rules: vec![
            "Stop after reporting verification status and relevant failures.".to_string(),
        ],
    }
}

fn provider_runner() -> CompiledModePolicy {
    CompiledModePolicy {
        mode_id: "provider-runner".to_string(),
        display_name: "Provider Runner".to_string(),
        role_definition:
            "Run configured LLM provider tasks without workspace writes or process execution."
                .to_string(),
        when_to_use: None,
        description: None,
        prompt_sections: vec![],
        verification_responsibility: None,
        instruction_fingerprint: None,
        permissions: ModePermissions {
            read_only: true,
            workspace_write: false,
            process_exec: false,
            network_access: true,
            service_control: false,
            destructive: false,
            can_spawn_subtasks: false,
            codebase_index: false,
        },
        allowed_handoff_targets: None,
        completion_rules: vec![
            "Stop after configured provider execution completes or fails.".to_string(),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_registry_lists_required_modes() {
        let ids: Vec<_> = BuiltinModeRegistry::list()
            .into_iter()
            .map(|policy| policy.mode_id)
            .collect();
        assert_eq!(
            ids,
            vec!["orchestrator", "implementer", "verifier", "provider-runner"]
        );
    }

    #[test]
    fn builtin_registry_resolves_default_orchestrator() {
        let policy = BuiltinModeRegistry::default_policy();
        assert_eq!(policy.mode_id, "orchestrator");
        assert!(!policy.permissions.workspace_write);
        assert!(!policy.permissions.process_exec);
        assert!(policy.permissions.can_spawn_subtasks);
        assert!(policy.permissions.codebase_index);
    }

    #[test]
    fn builtin_registry_unknown_returns_none() {
        assert_eq!(BuiltinModeRegistry::get("unknown-mode"), None);
    }

    #[test]
    fn permission_gate_allows_read_workspace_for_all_modes() {
        for policy in BuiltinModeRegistry::list() {
            let decision = RuntimePermissionGate::check(&policy, RuntimeAction::ReadWorkspace);
            assert!(decision.allowed, "{} should read workspace", policy.mode_id);
        }
    }

    #[test]
    fn permission_gate_matches_builtin_capabilities() {
        let orchestrator = BuiltinModeRegistry::get("orchestrator").expect("orchestrator");
        assert!(
            !RuntimePermissionGate::check(&orchestrator, RuntimeAction::WriteWorkspace).allowed
        );
        assert!(
            !RuntimePermissionGate::check(&orchestrator, RuntimeAction::ExecuteProcess).allowed
        );
        assert!(RuntimePermissionGate::check(&orchestrator, RuntimeAction::SpawnSubtask).allowed);
        assert!(RuntimePermissionGate::check(&orchestrator, RuntimeAction::IndexCodebase).allowed);

        let implementer = BuiltinModeRegistry::get("implementer").expect("implementer");
        assert!(RuntimePermissionGate::check(&implementer, RuntimeAction::WriteWorkspace).allowed);
        assert!(RuntimePermissionGate::check(&implementer, RuntimeAction::ExecuteProcess).allowed);
        assert!(RuntimePermissionGate::check(&implementer, RuntimeAction::IndexCodebase).allowed);

        let verifier = BuiltinModeRegistry::get("verifier").expect("verifier");
        assert!(!RuntimePermissionGate::check(&verifier, RuntimeAction::WriteWorkspace).allowed);
        assert!(RuntimePermissionGate::check(&verifier, RuntimeAction::ExecuteProcess).allowed);
        assert!(!RuntimePermissionGate::check(&verifier, RuntimeAction::IndexCodebase).allowed);

        let provider_runner = BuiltinModeRegistry::get("provider-runner").expect("provider-runner");
        assert!(
            RuntimePermissionGate::check(&provider_runner, RuntimeAction::AccessNetwork).allowed
        );
        assert!(
            !RuntimePermissionGate::check(&provider_runner, RuntimeAction::WriteWorkspace).allowed
        );
        assert!(
            !RuntimePermissionGate::check(&provider_runner, RuntimeAction::ExecuteProcess).allowed
        );
    }

    #[test]
    fn permission_gate_matches_external_compiled_capabilities() {
        let editor = CompiledModePolicy {
            mode_id: "external-editor".to_string(),
            display_name: "External Editor".to_string(),
            role_definition: "Prompt text cannot grant process execution.".to_string(),
            when_to_use: None,
            description: None,
            prompt_sections: vec![],
            verification_responsibility: None,
            instruction_fingerprint: None,
            permissions: ModePermissions {
                read_only: false,
                workspace_write: true,
                process_exec: false,
                network_access: false,
                service_control: false,
                destructive: false,
                can_spawn_subtasks: false,
                codebase_index: false,
            },
            allowed_handoff_targets: None,
            completion_rules: vec![
                "Even completion text cannot grant process execution.".to_string()
            ],
        };
        assert!(RuntimePermissionGate::check(&editor, RuntimeAction::WriteWorkspace).allowed);
        assert!(!RuntimePermissionGate::check(&editor, RuntimeAction::ExecuteProcess).allowed);

        let tester = CompiledModePolicy {
            mode_id: "external-tester".to_string(),
            display_name: "External Tester".to_string(),
            role_definition: "Prompt text cannot grant workspace writes.".to_string(),
            when_to_use: None,
            description: None,
            prompt_sections: vec![],
            verification_responsibility: None,
            instruction_fingerprint: None,
            permissions: ModePermissions {
                read_only: false,
                workspace_write: false,
                process_exec: true,
                network_access: false,
                service_control: false,
                destructive: false,
                can_spawn_subtasks: false,
                codebase_index: false,
            },
            allowed_handoff_targets: None,
            completion_rules: vec![
                "Even completion text cannot grant workspace writes.".to_string()
            ],
        };
        assert!(!RuntimePermissionGate::check(&tester, RuntimeAction::WriteWorkspace).allowed);
        assert!(RuntimePermissionGate::check(&tester, RuntimeAction::ExecuteProcess).allowed);
    }

    fn representative_agentmodes_yaml() -> &'static str {
        r#"
customModes:
  - slug: orchestrator
    name: Orchestrator
    roleDefinition: Coordinate the workflow without direct edits.
    whenToUse: Use for complex coordination.
    description: Coordinate multi-mode tasks.
    groups:
      - read
    customInstructions: |
      Delegate to specialists; do not edit directly.
  - slug: code
    name: Code
    roleDefinition: Implement bounded changes.
    description: Write code within delegated scope.
    groups:
      - read
      - edit
    customInstructions: |
      Make the smallest safe diff.
  - slug: tester
    name: Tester
    roleDefinition: Execute one verification command.
    description: Run a specified verification command.
    groups:
      - read
      - command
  - slug: reviewer
    name: Reviewer
    roleDefinition: Review changes. This prose says edit and command but must not grant authority.
    description: Review without side effects.
    groups:
      - read
      - mcp
  - slug: verified-integrator
    name: Verified Integrator
    roleDefinition: Integrate scoped changes with verification evidence.
    description: Edit and verify scoped changes.
    groups:
      - read
      - - edit
        - fileRegex: ".*"
          description: Scoped edit permission.
      - command
"#
    }

    #[test]
    fn compiles_representative_agentmodes_yaml_to_stable_modepack_policy() {
        let modepack = compile_agentmodes_modepack_from_yaml(
            representative_agentmodes_yaml(),
            AgentModesCompileOptions {
                modepack_name: Some("representative-agentmodes".to_string()),
                default_entrypoint: None,
            },
        )
        .expect("compiled AgentModes Mode Pack");

        assert_eq!(modepack.name, "representative-agentmodes");
        assert_eq!(modepack.schema_version, AGENTMODES_MODEPACK_SCHEMA_VERSION);
        assert_eq!(
            modepack.entrypoints.default,
            Some("orchestrator".to_string())
        );
        assert_eq!(modepack.modes.len(), 5);

        let orchestrator = modepack
            .modes
            .iter()
            .find(|mode| mode.mode_id == "orchestrator")
            .expect("orchestrator");
        assert!(orchestrator.permissions.read_only);
        assert!(orchestrator.permissions.codebase_index);
        assert!(!orchestrator.permissions.workspace_write);
        assert!(!orchestrator.permissions.process_exec);
        assert_eq!(orchestrator.allowed_handoff_targets, None);
        assert_eq!(
            orchestrator.when_to_use.as_deref(),
            Some("Use for complex coordination.")
        );
        assert_eq!(
            orchestrator.description.as_deref(),
            Some("Coordinate multi-mode tasks.")
        );
        assert!(orchestrator
            .prompt_sections
            .iter()
            .any(|section| section.content.contains("Delegate to specialists")));
        assert!(orchestrator
            .instruction_fingerprint
            .as_deref()
            .unwrap_or("")
            .starts_with("sha256:"));

        let integrator = modepack
            .modes
            .iter()
            .find(|mode| mode.mode_id == "verified-integrator")
            .expect("verified integrator");
        assert!(!integrator.permissions.read_only);
        assert!(integrator.permissions.workspace_write);
        assert!(integrator.permissions.process_exec);
        assert!(integrator.permissions.codebase_index);
        assert!(integrator
            .verification_responsibility
            .as_deref()
            .unwrap_or("")
            .contains("verification"));
    }

    #[test]
    fn agentmodes_groups_are_the_only_side_effect_capability_source() {
        let modepack = compile_agentmodes_modepack_from_yaml(
            representative_agentmodes_yaml(),
            AgentModesCompileOptions::default(),
        )
        .expect("compiled AgentModes Mode Pack");

        let reviewer = modepack
            .modes
            .iter()
            .find(|mode| mode.mode_id == "reviewer")
            .expect("reviewer");
        assert!(reviewer.role_definition.contains("edit and command"));
        assert!(!RuntimePermissionGate::check(reviewer, RuntimeAction::WriteWorkspace).allowed);
        assert!(!RuntimePermissionGate::check(reviewer, RuntimeAction::ExecuteProcess).allowed);
        assert!(!RuntimePermissionGate::check(reviewer, RuntimeAction::AccessNetwork).allowed);
        assert!(!RuntimePermissionGate::check(reviewer, RuntimeAction::SpawnSubtask).allowed);

        let code = modepack
            .modes
            .iter()
            .find(|mode| mode.mode_id == "code")
            .expect("code");
        assert!(RuntimePermissionGate::check(code, RuntimeAction::WriteWorkspace).allowed);
        assert!(!RuntimePermissionGate::check(code, RuntimeAction::ExecuteProcess).allowed);
    }

    #[test]
    fn compiles_representative_agentmodes_mode_files_with_instruction_sentinels() {
        let modepack = compile_agentmodes_modepack_from_yaml_documents(
            [
                include_str!("../tests/fixtures/agentmodes/orchestrator.yaml"),
                include_str!("../tests/fixtures/agentmodes/verified-integrator.yaml"),
                include_str!("../tests/fixtures/agentmodes/code.yaml"),
                include_str!("../tests/fixtures/agentmodes/tester.yaml"),
            ],
            AgentModesCompileOptions::default(),
        )
        .expect("compiled representative AgentModes mode files");

        assert_eq!(
            modepack.entrypoints.default,
            Some("orchestrator".to_string())
        );
        let orchestrator = modepack
            .modes
            .iter()
            .find(|mode| mode.mode_id == "orchestrator")
            .expect("orchestrator");
        assert!(orchestrator
            .role_definition
            .contains("least-privilege specialist subtasks"));
        let orchestrator_instructions = orchestrator.prompt_sections[0].content.as_str();
        assert!(orchestrator_instructions.contains("least-privilege specialists"));
        assert!(orchestrator_instructions.contains("quality gates"));
        assert!(orchestrator_instructions.contains("new_task"));
        assert!(orchestrator
            .instruction_fingerprint
            .as_deref()
            .unwrap_or("")
            .starts_with("sha256:"));
        assert!(!RuntimePermissionGate::check(orchestrator, RuntimeAction::WriteWorkspace).allowed);
        assert!(!RuntimePermissionGate::check(orchestrator, RuntimeAction::ExecuteProcess).allowed);

        let verified_integrator = modepack
            .modes
            .iter()
            .find(|mode| mode.mode_id == "verified-integrator")
            .expect("verified integrator");
        assert!(
            RuntimePermissionGate::check(verified_integrator, RuntimeAction::WriteWorkspace)
                .allowed
        );
        assert!(
            RuntimePermissionGate::check(verified_integrator, RuntimeAction::ExecuteProcess)
                .allowed
        );
        assert!(
            !RuntimePermissionGate::check(verified_integrator, RuntimeAction::AccessNetwork)
                .allowed
        );
        assert!(verified_integrator.prompt_sections[0]
            .content
            .contains("Completion requires explicit verification evidence"));

        let code = modepack
            .modes
            .iter()
            .find(|mode| mode.mode_id == "code")
            .expect("code");
        assert!(RuntimePermissionGate::check(code, RuntimeAction::WriteWorkspace).allowed);
        assert!(!RuntimePermissionGate::check(code, RuntimeAction::ExecuteProcess).allowed);

        let tester = modepack
            .modes
            .iter()
            .find(|mode| mode.mode_id == "tester")
            .expect("tester");
        assert!(!RuntimePermissionGate::check(tester, RuntimeAction::WriteWorkspace).allowed);
        assert!(RuntimePermissionGate::check(tester, RuntimeAction::ExecuteProcess).allowed);
        assert!(tester.prompt_sections[0]
            .content
            .contains("Execute exactly commands[0]"));
    }

    #[test]
    fn rejects_malformed_agentmodes_inputs_fail_closed() {
        for (yaml, expected) in [
            ("customModes: []", "at least one customModes entry"),
            (
                r#"
customModes:
  - slug: "../escape"
    name: Escape
    roleDefinition: Bad mode id.
    groups:
      - read
"#,
                "contains unsupported characters",
            ),
            (
                r#"
customModes:
  - slug: duplicate
    name: One
    roleDefinition: First.
    groups:
      - read
  - slug: duplicate
    name: Two
    roleDefinition: Second.
    groups:
      - read
"#,
                "duplicate AgentModes slug",
            ),
            (
                r#"
customModes:
  - slug: unknown
    name: Unknown
    roleDefinition: Unsupported group.
    groups:
      - browser
"#,
                "unsupported AgentModes group",
            ),
            (
                r#"
customModes:
  - slug: malformed
    name: Malformed
    roleDefinition: Malformed group.
    groups:
      - { invalid: true }
"#,
                "malformed AgentModes group entry",
            ),
        ] {
            let error =
                compile_agentmodes_modepack_from_yaml(yaml, AgentModesCompileOptions::default())
                    .expect_err("invalid AgentModes document should fail")
                    .to_string();
            assert!(
                error.contains(expected),
                "expected {error:?} to contain {expected:?}"
            );
        }
    }

    #[test]
    fn rejects_unknown_explicit_default_entrypoint() {
        let error = compile_agentmodes_modepack_from_yaml(
            representative_agentmodes_yaml(),
            AgentModesCompileOptions {
                modepack_name: None,
                default_entrypoint: Some("missing-mode".to_string()),
            },
        )
        .expect_err("unknown default entrypoint")
        .to_string();

        assert!(error.contains("references unknown AgentModes slug"));
    }

    #[test]
    fn serializes_compiled_agentmodes_modepack_with_bounded_prompt_policy() {
        let json = compile_agentmodes_modepack_to_json(
            representative_agentmodes_yaml(),
            AgentModesCompileOptions::default(),
        )
        .expect("serialized AgentModes Mode Pack");

        assert!(json.contains("\"schema_version\": 1"));
        assert!(json.contains("\"default\": \"orchestrator\""));
        assert!(json.contains("\"prompt_sections\""));
        assert!(json.contains("Delegate to specialists"));
        assert!(json.contains("Make the smallest safe diff"));
        assert!(json.contains("\"instruction_fingerprint\""));
    }
}
