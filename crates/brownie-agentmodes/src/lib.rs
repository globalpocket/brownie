//! AgentModes compatibility crate.

use std::collections::HashSet;
use std::fs;
use std::path::Path;

use anyhow::{bail, Context, Result};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping as YamlMapping, Value as YamlValue};
use sha2::{Digest, Sha256};

pub const COMPATIBILITY_TARGET: &str = "AgentModes";
pub const DEFAULT_MODE_ID: &str = "orchestrator";
pub const AGENTMODES_MODEPACK_SCHEMA_VERSION: u64 = 1;
pub const HANDOFF_TARGET_ALL_MODEPACK_MODES: &str = "$modepack/*";
const MAX_MODE_ID_CHARS: usize = 64;
const MAX_MODE_TEXT_CHARS: usize = 32_000;
const MAX_POLICY_ARTIFACTS: usize = 64;
const MAX_POLICY_ARTIFACT_CONTENT_CHARS: usize = 32_000;
const MAX_POLICY_ARTIFACT_PATH_CHARS: usize = 256;

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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub workspace_write_scopes: Vec<WorkspaceWriteScope>,
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
pub struct CompiledPolicyArtifact {
    pub category: String,
    pub relative_path: String,
    pub title: String,
    pub content: String,
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
pub struct WorkspaceWriteScope {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_regex: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
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
    pub delegation_coordinators: Vec<String>,
    pub global_policy_artifacts: Vec<CompiledPolicyArtifact>,
    pub source_trust: AgentModesSourceTrust,
    pub capability_ceiling: AgentModesCapabilityCeiling,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentModesSourceTrust {
    TrustedLocalDeveloper,
    TrustedSignedActiveModePack,
    UntrustedRepositoryLocal,
}

impl Default for AgentModesSourceTrust {
    fn default() -> Self {
        Self::TrustedLocalDeveloper
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AgentModesCapabilityCeiling {
    pub workspace_write: bool,
    pub process_exec: bool,
    pub can_spawn_subtasks: bool,
}

impl Default for AgentModesCapabilityCeiling {
    fn default() -> Self {
        Self {
            workspace_write: true,
            process_exec: true,
            can_spawn_subtasks: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentModesModePack {
    pub name: String,
    pub schema_version: u64,
    #[serde(default, skip_serializing_if = "AgentModesEntrypoints::is_empty")]
    pub entrypoints: AgentModesEntrypoints,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub global_policy_artifacts: Vec<CompiledPolicyArtifact>,
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

    pub fn check_workspace_write_path(
        policy: &CompiledModePolicy,
        relative_path: &str,
    ) -> PermissionDecision {
        let base = Self::check(policy, RuntimeAction::WriteWorkspace);
        if !base.allowed {
            return base;
        }
        if policy.workspace_write_scopes.is_empty() {
            return PermissionDecision {
                action: RuntimeAction::WriteWorkspace,
                allowed: true,
                reason: format!("Mode {} allows workspace writes.", policy.mode_id),
            };
        }
        let allowed = policy
            .workspace_write_scopes
            .iter()
            .any(|scope| workspace_write_scope_matches(scope, relative_path));
        let reason = if allowed {
            format!(
                "Mode {} allows workspace writes for {relative_path} within compiled scope.",
                policy.mode_id
            )
        } else {
            format!(
                "Mode {} does not allow workspace writes for {relative_path} outside compiled scope.",
                policy.mode_id
            )
        };
        PermissionDecision {
            action: RuntimeAction::WriteWorkspace,
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

pub fn compile_agentmodes_policy_artifacts_from_root(
    root: impl AsRef<Path>,
) -> Result<Vec<CompiledPolicyArtifact>> {
    let root = root.as_ref();
    let mut files = Vec::new();
    for (category, directory) in [
        ("rule", "rules"),
        ("skill", "skills"),
        ("command", "commands"),
        ("contract", "docs/contracts"),
    ] {
        collect_policy_artifact_files(root, category, directory, &mut files)?;
    }
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    if files.len() > MAX_POLICY_ARTIFACTS {
        bail!("AgentModes policy artifact count exceeds limit");
    }
    Ok(files)
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
    let mut compiled_modes = Vec::with_capacity(raw.custom_modes.len());
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
        let permissions = permissions_from_agentmodes_groups(
            &groups,
            options.source_trust,
            options.capability_ceiling,
        );
        let workspace_write_scopes = workspace_write_scopes_from_agentmodes_groups(&groups);
        let completion_rules = compile_agentmodes_completion_rules(&prompt_sections)?;
        let verification_responsibility = None;
        let instruction_fingerprint = Some(mode_instruction_fingerprint(
            &role_definition,
            when_to_use.as_deref(),
            description.as_deref(),
            &prompt_sections,
            &completion_rules,
            verification_responsibility.as_deref(),
            &workspace_write_scopes,
        ));

        compiled_modes.push(CompiledModePolicy {
            mode_id,
            display_name,
            role_definition,
            when_to_use,
            description,
            prompt_sections,
            verification_responsibility,
            instruction_fingerprint,
            permissions,
            workspace_write_scopes,
            allowed_handoff_targets: None,
            completion_rules,
        });
    }

    let default = resolve_agentmodes_default_entrypoint(options.default_entrypoint, &seen)?;
    let delegation_coordinators =
        validate_delegation_coordinators(options.delegation_coordinators, &seen)?;
    let mode_ids = compiled_modes
        .iter()
        .map(|mode| mode.mode_id.clone())
        .collect::<Vec<_>>();
    let modes = compiled_modes
        .into_iter()
        .map(|mut mode| {
            if delegation_coordinators.contains(&mode.mode_id)
                && mode_ids.len() > 1
                && options.capability_ceiling.can_spawn_subtasks
            {
                if mode.permissions.workspace_write || mode.permissions.process_exec {
                    bail!(
                        "delegation_coordinators[] mode {} must not declare workspace write or process execution groups",
                        mode.mode_id
                    );
                }
                mode.permissions.read_only = true;
                mode.permissions.can_spawn_subtasks = true;
                mode.allowed_handoff_targets =
                    Some(vec![HANDOFF_TARGET_ALL_MODEPACK_MODES.to_string()]);
            }
            Ok(mode)
        })
        .collect::<Result<Vec<_>>>()?;

    let global_policy_artifacts =
        validate_agentmodes_policy_artifacts(options.global_policy_artifacts)?;

    Ok(AgentModesModePack {
        name,
        schema_version: AGENTMODES_MODEPACK_SCHEMA_VERSION,
        entrypoints: AgentModesEntrypoints { default },
        global_policy_artifacts,
        modes,
    })
}

fn collect_policy_artifact_files(
    root: &Path,
    category: &str,
    directory: &str,
    artifacts: &mut Vec<CompiledPolicyArtifact>,
) -> Result<()> {
    let dir = root.join(directory);
    if !dir.exists() {
        return Ok(());
    }
    let mut paths = Vec::new();
    for entry in fs::read_dir(&dir)
        .with_context(|| format!("failed to read AgentModes policy directory {directory}"))?
    {
        let path = entry
            .with_context(|| format!("failed to read AgentModes policy directory {directory}"))?
            .path();
        if path.is_file() && path.extension().and_then(|value| value.to_str()) == Some("md") {
            paths.push(path);
        }
    }
    paths.sort();
    for path in paths {
        let relative_path = relative_policy_artifact_path(root, &path)?;
        let content = fs::read_to_string(&path).with_context(|| {
            format!("failed to read AgentModes policy artifact {relative_path}")
        })?;
        let content = bounded_policy_artifact_content(&relative_path, content)?;
        let title = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or(category)
            .replace(['-', '_'], " ");
        artifacts.push(CompiledPolicyArtifact {
            category: category.to_string(),
            relative_path,
            title,
            content_fingerprint: sha256_fingerprint(content.as_bytes()),
            content,
        });
    }
    Ok(())
}

fn relative_policy_artifact_path(root: &Path, path: &Path) -> Result<String> {
    let relative = path.strip_prefix(root).with_context(|| {
        format!(
            "AgentModes policy artifact escaped root: {}",
            path.display()
        )
    })?;
    let relative = normalize_relative_policy_artifact_path(relative)?;
    validate_policy_artifact_relative_path("policy_artifacts[].relative_path", relative)
}

fn normalize_relative_policy_artifact_path(path: &Path) -> Result<String> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            std::path::Component::Normal(part) => {
                let Some(part) = part.to_str() else {
                    bail!("AgentModes policy artifact path must be UTF-8");
                };
                parts.push(part.to_string());
            }
            _ => bail!("AgentModes policy artifact path must be relative and normalized"),
        }
    }
    Ok(parts.join("/"))
}

fn validate_agentmodes_policy_artifacts(
    artifacts: Vec<CompiledPolicyArtifact>,
) -> Result<Vec<CompiledPolicyArtifact>> {
    if artifacts.len() > MAX_POLICY_ARTIFACTS {
        bail!("AgentModes policy artifact count exceeds limit");
    }
    let mut seen = HashSet::new();
    artifacts
        .into_iter()
        .map(|artifact| {
            let category = validate_policy_artifact_category(artifact.category)?;
            let relative_path = validate_policy_artifact_relative_path(
                "policy_artifacts[].relative_path",
                artifact.relative_path,
            )?;
            if !seen.insert(relative_path.clone()) {
                bail!("duplicate AgentModes policy artifact path: {relative_path}");
            }
            let title = bounded_agentmodes_field("policy_artifacts[].title", artifact.title)?;
            let content = bounded_policy_artifact_content(&relative_path, artifact.content)?;
            let content_fingerprint = bounded_agentmodes_field(
                "policy_artifacts[].content_fingerprint",
                artifact.content_fingerprint,
            )?;
            Ok(CompiledPolicyArtifact {
                category,
                relative_path,
                title,
                content,
                content_fingerprint,
            })
        })
        .collect()
}

fn validate_policy_artifact_category(category: String) -> Result<String> {
    let category = non_empty_agentmodes_field("policy_artifacts[].category", category)?;
    match category.as_str() {
        "rule" | "skill" | "command" | "contract" => Ok(category),
        other => bail!("AgentModes policy artifact category is unsupported: {other}"),
    }
}

fn validate_policy_artifact_relative_path(field: &str, value: String) -> Result<String> {
    let value = non_empty_agentmodes_field(field, value)?;
    if value.chars().count() > MAX_POLICY_ARTIFACT_PATH_CHARS {
        bail!("AgentModes {field} exceeds path length limit");
    }
    if value.starts_with('/')
        || value.contains('\\')
        || value
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        bail!("AgentModes {field} must be a normalized relative path");
    }
    if !value.ends_with(".md") {
        bail!("AgentModes {field} must reference a markdown policy artifact");
    }
    Ok(value)
}

fn bounded_policy_artifact_content(field: &str, value: String) -> Result<String> {
    let value = non_empty_agentmodes_field(field, value)?;
    if value.chars().count() > MAX_POLICY_ARTIFACT_CONTENT_CHARS {
        bail!("AgentModes policy artifact {field} exceeds content size limit");
    }
    Ok(value)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum AgentModesGroupKind {
    Read,
    Edit,
    Command,
    Mcp,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CompiledAgentModesGroup {
    kind: AgentModesGroupKind,
    scope: Option<WorkspaceWriteScope>,
}

fn compile_agentmodes_groups(
    mode_id: &str,
    groups: &[YamlValue],
) -> Result<Vec<CompiledAgentModesGroup>> {
    let mut seen = HashSet::new();
    let mut compiled = Vec::new();
    for group in groups {
        let (group_name, metadata) = agentmodes_group_parts(group).ok_or_else(|| {
            anyhow::anyhow!("mode {mode_id} has malformed AgentModes group entry")
        })?;
        let parsed = match group_name {
            "read" => AgentModesGroupKind::Read,
            "edit" => AgentModesGroupKind::Edit,
            "command" => AgentModesGroupKind::Command,
            "mcp" => AgentModesGroupKind::Mcp,
            other => bail!("mode {mode_id} requests unsupported AgentModes group: {other}"),
        };
        if !seen.insert(parsed) {
            bail!("mode {mode_id} declares duplicate AgentModes group: {group_name}");
        }
        let scope = compile_workspace_write_scope(mode_id, group_name, metadata)?;
        compiled.push(CompiledAgentModesGroup {
            kind: parsed,
            scope,
        });
    }
    Ok(compiled)
}

fn agentmodes_group_parts(group: &YamlValue) -> Option<(&str, Option<&YamlMapping>)> {
    match group {
        YamlValue::String(value) => Some((value.as_str(), None)),
        YamlValue::Sequence(values) => {
            let name = values.first().and_then(YamlValue::as_str)?;
            let metadata = values.get(1).and_then(YamlValue::as_mapping);
            Some((name, metadata))
        }
        _ => None,
    }
}

fn compile_workspace_write_scope(
    mode_id: &str,
    group_name: &str,
    metadata: Option<&YamlMapping>,
) -> Result<Option<WorkspaceWriteScope>> {
    if metadata.is_some() && group_name != "edit" {
        bail!("mode {mode_id} declares metadata for unsupported scoped group: {group_name}");
    }
    let Some(metadata) = metadata else {
        return Ok(None);
    };
    let file_regex = yaml_string_field(metadata, "fileRegex")
        .map(|value| bounded_agentmodes_field("customModes[].groups[].fileRegex", value))
        .transpose()?;
    if let Some(file_regex) = file_regex.as_deref() {
        Regex::new(file_regex)
            .with_context(|| format!("mode {mode_id} declares invalid edit fileRegex"))?;
    }
    let description = yaml_string_field(metadata, "description")
        .map(|value| bounded_agentmodes_field("customModes[].groups[].description", value))
        .transpose()?;
    if file_regex.is_none() && description.is_none() {
        bail!("mode {mode_id} declares empty edit scope metadata");
    }
    Ok(Some(WorkspaceWriteScope {
        file_regex,
        description,
    }))
}

fn yaml_string_field(metadata: &YamlMapping, field: &str) -> Option<String> {
    metadata
        .get(YamlValue::String(field.to_string()))
        .and_then(YamlValue::as_str)
        .map(ToString::to_string)
}

fn permissions_from_agentmodes_groups(
    groups: &[CompiledAgentModesGroup],
    source_trust: AgentModesSourceTrust,
    capability_ceiling: AgentModesCapabilityCeiling,
) -> ModePermissions {
    let contains = |kind| groups.iter().any(|group| group.kind == kind);
    let workspace_write = contains(AgentModesGroupKind::Edit) && capability_ceiling.workspace_write;
    let process_exec = contains(AgentModesGroupKind::Command)
        && capability_ceiling.process_exec
        && source_trust_allows_process_exec(source_trust);
    ModePermissions {
        read_only: !workspace_write && !process_exec,
        workspace_write,
        process_exec,
        network_access: false,
        service_control: false,
        destructive: false,
        can_spawn_subtasks: false,
        codebase_index: contains(AgentModesGroupKind::Read),
    }
}

fn source_trust_allows_process_exec(source_trust: AgentModesSourceTrust) -> bool {
    matches!(
        source_trust,
        AgentModesSourceTrust::TrustedLocalDeveloper
            | AgentModesSourceTrust::TrustedSignedActiveModePack
    )
}

fn workspace_write_scopes_from_agentmodes_groups(
    groups: &[CompiledAgentModesGroup],
) -> Vec<WorkspaceWriteScope> {
    groups
        .iter()
        .filter(|group| group.kind == AgentModesGroupKind::Edit)
        .filter_map(|group| group.scope.clone())
        .collect()
}

fn workspace_write_scope_matches(scope: &WorkspaceWriteScope, relative_path: &str) -> bool {
    if let Some(file_regex) = scope.file_regex.as_deref() {
        return Regex::new(file_regex)
            .map(|regex| regex.is_match(relative_path))
            .unwrap_or(false);
    }
    true
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
    prompt_sections: &[CompiledPromptSection],
) -> Result<Vec<String>> {
    let mut rules = Vec::new();
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

fn mode_instruction_fingerprint(
    role_definition: &str,
    when_to_use: Option<&str>,
    description: Option<&str>,
    prompt_sections: &[CompiledPromptSection],
    completion_rules: &[String],
    verification_responsibility: Option<&str>,
    workspace_write_scopes: &[WorkspaceWriteScope],
) -> String {
    let canonical = serde_json::json!({
        "role_definition": role_definition,
        "when_to_use": when_to_use,
        "description": description,
        "prompt_sections": prompt_sections,
        "workspace_write_scopes": workspace_write_scopes,
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

fn validate_delegation_coordinators(
    requested: Vec<String>,
    mode_ids: &HashSet<String>,
) -> Result<HashSet<String>> {
    let mut normalized = HashSet::new();
    for requested in requested {
        let requested = validate_agentmodes_mode_id("delegation_coordinators[]", requested)?;
        if !mode_ids.contains(&requested) {
            bail!("delegation_coordinators[] references unknown AgentModes slug: {requested}");
        }
        if !normalized.insert(requested.clone()) {
            bail!("duplicate delegation_coordinators[] entry: {requested}");
        }
    }
    Ok(normalized)
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
        workspace_write_scopes: vec![],
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
        workspace_write_scopes: vec![],
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
        workspace_write_scopes: vec![],
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
        workspace_write_scopes: vec![],
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
            workspace_write_scopes: vec![],
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
            workspace_write_scopes: vec![],
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
    groups: []
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
                delegation_coordinators: vec!["orchestrator".to_string()],
                ..AgentModesCompileOptions::default()
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
        assert!(!orchestrator.permissions.codebase_index);
        assert!(!orchestrator.permissions.workspace_write);
        assert!(!orchestrator.permissions.process_exec);
        assert!(orchestrator.permissions.can_spawn_subtasks);
        assert_eq!(
            orchestrator.allowed_handoff_targets,
            Some(vec![HANDOFF_TARGET_ALL_MODEPACK_MODES.to_string()])
        );
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
        assert_eq!(integrator.verification_responsibility, None);
        assert_eq!(
            integrator.workspace_write_scopes.as_slice(),
            &[WorkspaceWriteScope {
                file_regex: Some(".*".to_string()),
                description: Some("Scoped edit permission.".to_string())
            }]
        );
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
    fn empty_groups_do_not_grant_delegation_without_structured_coordinator_metadata() {
        let modepack = compile_agentmodes_modepack_from_yaml(
            representative_agentmodes_yaml(),
            AgentModesCompileOptions::default(),
        )
        .expect("compiled AgentModes Mode Pack");

        let orchestrator = modepack
            .modes
            .iter()
            .find(|mode| mode.mode_id == "orchestrator")
            .expect("orchestrator");
        assert!(!RuntimePermissionGate::check(orchestrator, RuntimeAction::SpawnSubtask).allowed);
        assert_eq!(orchestrator.allowed_handoff_targets, None);
    }

    #[test]
    fn source_trust_and_global_ceiling_bound_effective_capabilities() {
        let untrusted = compile_agentmodes_modepack_from_yaml(
            representative_agentmodes_yaml(),
            AgentModesCompileOptions {
                delegation_coordinators: vec!["orchestrator".to_string()],
                source_trust: AgentModesSourceTrust::UntrustedRepositoryLocal,
                ..AgentModesCompileOptions::default()
            },
        )
        .expect("compiled untrusted AgentModes Mode Pack");
        let tester = untrusted
            .modes
            .iter()
            .find(|mode| mode.mode_id == "tester")
            .expect("tester");
        assert!(!RuntimePermissionGate::check(tester, RuntimeAction::ExecuteProcess).allowed);

        let integrator = untrusted
            .modes
            .iter()
            .find(|mode| mode.mode_id == "verified-integrator")
            .expect("verified integrator");
        assert!(RuntimePermissionGate::check(integrator, RuntimeAction::WriteWorkspace).allowed);
        assert!(!RuntimePermissionGate::check(integrator, RuntimeAction::ExecuteProcess).allowed);

        let ceiling_denied = compile_agentmodes_modepack_from_yaml(
            representative_agentmodes_yaml(),
            AgentModesCompileOptions {
                delegation_coordinators: vec!["orchestrator".to_string()],
                capability_ceiling: AgentModesCapabilityCeiling {
                    workspace_write: false,
                    process_exec: false,
                    can_spawn_subtasks: false,
                },
                ..AgentModesCompileOptions::default()
            },
        )
        .expect("compiled ceiling-limited AgentModes Mode Pack");
        let orchestrator = ceiling_denied
            .modes
            .iter()
            .find(|mode| mode.mode_id == "orchestrator")
            .expect("orchestrator");
        assert!(!RuntimePermissionGate::check(orchestrator, RuntimeAction::SpawnSubtask).allowed);
        assert_eq!(orchestrator.allowed_handoff_targets, None);
        let code = ceiling_denied
            .modes
            .iter()
            .find(|mode| mode.mode_id == "code")
            .expect("code");
        assert!(!RuntimePermissionGate::check(code, RuntimeAction::WriteWorkspace).allowed);
    }

    #[test]
    fn compiles_representative_agentmodes_mode_files_with_instruction_sentinels() {
        let modepack = compile_agentmodes_modepack_from_yaml_documents(
            [
                include_str!("../tests/fixtures/agentmodes/orchestrator.yaml"),
                include_str!("../tests/fixtures/agentmodes/verified-integrator.yaml"),
                include_str!("../tests/fixtures/agentmodes/code.yaml"),
                include_str!("../tests/fixtures/agentmodes/tester.yaml"),
                include_str!("../tests/fixtures/agentmodes/architect.yaml"),
            ],
            AgentModesCompileOptions {
                delegation_coordinators: vec!["orchestrator".to_string()],
                ..AgentModesCompileOptions::default()
            },
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
        assert!(RuntimePermissionGate::check(orchestrator, RuntimeAction::SpawnSubtask).allowed);
        assert_eq!(
            orchestrator.allowed_handoff_targets,
            Some(vec![HANDOFF_TARGET_ALL_MODEPACK_MODES.to_string()])
        );

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
        assert_eq!(code.verification_responsibility, None);
        assert!(code
            .completion_rules
            .iter()
            .all(|rule| !rule.contains("When to use")));

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

        let architect = modepack
            .modes
            .iter()
            .find(|mode| mode.mode_id == "architect")
            .expect("architect");
        assert_eq!(
            architect.workspace_write_scopes.as_slice(),
            &[WorkspaceWriteScope {
                file_regex: Some("\\.md$".to_string()),
                description: Some("Markdown only".to_string())
            }]
        );
        assert!(
            RuntimePermissionGate::check_workspace_write_path(architect, "docs/plan.md").allowed
        );
        assert!(
            !RuntimePermissionGate::check_workspace_write_path(architect, "src/lib.rs").allowed
        );
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
                ..AgentModesCompileOptions::default()
            },
        )
        .expect_err("unknown default entrypoint")
        .to_string();

        assert!(error.contains("references unknown AgentModes slug"));
    }

    #[test]
    fn rejects_unknown_delegation_coordinator_metadata() {
        let error = compile_agentmodes_modepack_from_yaml(
            representative_agentmodes_yaml(),
            AgentModesCompileOptions {
                delegation_coordinators: vec!["missing-mode".to_string()],
                ..AgentModesCompileOptions::default()
            },
        )
        .expect_err("unknown delegation coordinator")
        .to_string();

        assert!(error.contains("delegation_coordinators[] references unknown AgentModes slug"));
    }

    #[test]
    fn serializes_compiled_agentmodes_modepack_with_bounded_prompt_policy() {
        let json = compile_agentmodes_modepack_to_json(
            representative_agentmodes_yaml(),
            AgentModesCompileOptions {
                global_policy_artifacts: vec![CompiledPolicyArtifact {
                    category: "rule".to_string(),
                    relative_path: "rules/runtime-safety.md".to_string(),
                    title: "Runtime Safety".to_string(),
                    content: "Global rules remain protected prompt policy only.".to_string(),
                    content_fingerprint: "sha256:test-global-rule".to_string(),
                }],
                ..AgentModesCompileOptions::default()
            },
        )
        .expect("serialized AgentModes Mode Pack");

        assert!(json.contains("\"schema_version\": 1"));
        assert!(json.contains("\"default\": \"orchestrator\""));
        assert!(json.contains("\"global_policy_artifacts\""));
        assert!(json.contains("\"relative_path\": \"rules/runtime-safety.md\""));
        assert!(json.contains("\"prompt_sections\""));
        assert!(json.contains("Delegate to specialists"));
        assert!(json.contains("Make the smallest safe diff"));
        assert!(json.contains("\"instruction_fingerprint\""));
    }

    #[test]
    fn rejects_unsafe_agentmodes_policy_artifacts_fail_closed() {
        let error = compile_agentmodes_modepack_from_yaml(
            representative_agentmodes_yaml(),
            AgentModesCompileOptions {
                global_policy_artifacts: vec![CompiledPolicyArtifact {
                    category: "rule".to_string(),
                    relative_path: "../secrets.md".to_string(),
                    title: "Escaped".to_string(),
                    content: "Bad path.".to_string(),
                    content_fingerprint: "sha256:test".to_string(),
                }],
                ..AgentModesCompileOptions::default()
            },
        )
        .expect_err("unsafe artifact should fail")
        .to_string();

        assert!(error.contains("must be a normalized relative path"));
    }

    #[test]
    fn compiles_current_agentmodes_global_policy_artifacts_when_source_is_available() {
        let root = std::path::Path::new("/Users/satoshitanaka/Documents/AgentModes");
        if !root.join("modes").exists() {
            return;
        }

        let artifacts =
            compile_agentmodes_policy_artifacts_from_root(root).expect("compiled policy artifacts");

        assert!(!artifacts.is_empty());
        assert!(artifacts.iter().any(|artifact| artifact.relative_path
            == "rules/00-agentmodes-compact-mode-contract.md"
            && artifact.category == "rule"));
        assert!(artifacts
            .iter()
            .any(|artifact| artifact.relative_path == "commands/analysis.md"
                && artifact.category == "command"));
        assert!(artifacts.iter().any(|artifact| artifact.relative_path
            == "docs/contracts/task-packet-v1.md"
            && artifact.category == "contract"));
        assert!(artifacts.iter().all(|artifact| {
            !artifact.relative_path.starts_with('/')
                && !artifact.relative_path.contains("..")
                && artifact.content_fingerprint.starts_with("sha256:")
                && !artifact.content.is_empty()
        }));
        assert!(!artifacts
            .iter()
            .any(|artifact| artifact.relative_path.contains(".DS_Store")));
    }

    #[test]
    fn compiles_current_agentmodes_pack_scale_when_source_is_available() {
        let modes_dir = std::path::Path::new("/Users/satoshitanaka/Documents/AgentModes/modes");
        if !modes_dir.exists() {
            return;
        }
        let mut documents = Vec::new();
        for entry in std::fs::read_dir(modes_dir).expect("read AgentModes modes dir") {
            let path = entry.expect("dir entry").path();
            if path.extension().and_then(|value| value.to_str()) == Some("yaml") {
                documents.push(std::fs::read_to_string(path).expect("read AgentModes mode file"));
            }
        }
        documents.sort();
        let document_refs = documents.iter().map(String::as_str).collect::<Vec<_>>();

        let modepack = compile_agentmodes_modepack_from_yaml_documents(
            document_refs,
            AgentModesCompileOptions {
                modepack_name: Some("current-agentmodes".to_string()),
                delegation_coordinators: vec![
                    "orchestrator".to_string(),
                    "workflow-orchestrator".to_string(),
                    "epoch-orchestrator".to_string(),
                ],
                ..AgentModesCompileOptions::default()
            },
        )
        .expect("compile current AgentModes mode pack");

        assert!(modepack.modes.len() > 16);
        let orchestrator = modepack
            .modes
            .iter()
            .find(|mode| mode.mode_id == "orchestrator")
            .expect("orchestrator");
        assert!(RuntimePermissionGate::check(orchestrator, RuntimeAction::SpawnSubtask).allowed);
        assert_eq!(
            orchestrator.allowed_handoff_targets,
            Some(vec![HANDOFF_TARGET_ALL_MODEPACK_MODES.to_string()])
        );
        let composer = modepack
            .modes
            .iter()
            .find(|mode| mode.mode_id == "user-response-composer")
            .expect("user response composer");
        assert!(!RuntimePermissionGate::check(composer, RuntimeAction::SpawnSubtask).allowed);
        assert_eq!(composer.allowed_handoff_targets, None);
    }
}
