//! External Mode Pack management crate.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use brownie_agentmodes::{
    compile_agentmodes_modepack_from_root, AgentModesCapabilityCeiling, AgentModesCompileOptions,
    AgentModesSourceTrust, CompiledMcpServerAccess, CompiledModePolicy, CompiledPolicyArtifact,
    ModePermissions, WorkspaceWriteScope, HANDOFF_TARGET_ALL_MODEPACK_MODES,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const DEFAULT_MODEPACK_NAME: &str = "agentmodes";
pub const WORKSPACE_MODEPACK_PATH: &str = ".brownie/modepack.json";
pub const WORKSPACE_AGENTMODES_FRAMEWORK_PATH: &str = ".brownie/AgentModes";
pub const WORKSPACE_AGENTMODES_WORKFLOW_PATH: &str = ".brownie/AgentModes/workflow.yaml";
pub const MODEPACK_SCHEMA_VERSION: u64 = 1;
const MAX_HANDOFF_TARGETS: usize = 16;
const MAX_HANDOFF_TARGET_CHARS: usize = 64;
const MAX_MODE_ID_REFERENCE_CHARS: usize = 64;
const MAX_POLICY_ARTIFACTS: usize = 64;
const MAX_POLICY_ARTIFACT_CONTENT_CHARS: usize = 32_000;
const MAX_POLICY_ARTIFACT_PATH_CHARS: usize = 256;
pub const MAX_MCP_SERVERS: usize = 8;
pub const MAX_MCP_TOOLS_PER_MODE_SERVER: usize = 32;
pub const MAX_MCP_SERVER_ID_CHARS: usize = 64;
pub const MAX_MCP_TOOL_NAME_CHARS: usize = 96;
pub const MAX_MCP_COMMAND_CHARS: usize = 512;
pub const MAX_MCP_ARGS: usize = 32;
pub const MAX_MCP_ARG_CHARS: usize = 512;

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
    pub source_trust: ModePackSourceTrust,
    pub capability_ceiling: ModePackCapabilityCeiling,
    pub entrypoints: ModePackEntrypoints,
    pub global_policy_artifacts: Vec<CompiledPolicyArtifact>,
    pub mcp_servers: Vec<ModePackMcpServerConfig>,
    pub modes: Vec<CompiledModePolicy>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModePackSourceTrust {
    TrustedLocalDeveloper,
    TrustedSignedActiveModePack,
    UntrustedRepositoryLocal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModePackCapabilityCeiling {
    pub workspace_write: bool,
    pub process_exec: bool,
    pub git_inspect: bool,
    pub git_commit: bool,
    pub network_access: bool,
    pub service_control: bool,
    pub destructive: bool,
    pub can_spawn_subtasks: bool,
    pub mcp_tool_access: bool,
}

impl Default for ModePackCapabilityCeiling {
    fn default() -> Self {
        Self {
            workspace_write: true,
            process_exec: true,
            git_inspect: true,
            git_commit: true,
            network_access: false,
            service_control: false,
            destructive: false,
            can_spawn_subtasks: true,
            mcp_tool_access: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModePackMcpServerConfig {
    pub server_id: String,
    pub transport: String,
    pub command: String,
    pub args: Vec<String>,
    pub config_identity_fingerprint: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModePackLoadOptions {
    pub source_trust: ModePackSourceTrust,
    pub capability_ceiling: ModePackCapabilityCeiling,
}

impl ModePackLoadOptions {
    pub fn trusted_local_developer() -> Self {
        Self {
            source_trust: ModePackSourceTrust::TrustedLocalDeveloper,
            capability_ceiling: ModePackCapabilityCeiling::default(),
        }
    }

    pub fn trusted_signed_active_modepack() -> Self {
        Self {
            source_trust: ModePackSourceTrust::TrustedSignedActiveModePack,
            capability_ceiling: ModePackCapabilityCeiling::default(),
        }
    }

    pub fn untrusted_repository_local() -> Self {
        Self {
            source_trust: ModePackSourceTrust::UntrustedRepositoryLocal,
            capability_ceiling: ModePackCapabilityCeiling::default(),
        }
    }
}

impl Default for ModePackLoadOptions {
    fn default() -> Self {
        Self::trusted_local_developer()
    }
}

#[derive(Debug, Deserialize)]
struct RawModePack {
    name: String,
    schema_version: u64,
    #[serde(default)]
    entrypoints: RawModePackEntrypoints,
    #[serde(default)]
    global_policy_artifacts: Vec<CompiledPolicyArtifact>,
    #[serde(default)]
    mcp_servers: std::collections::BTreeMap<String, RawMcpServerConfig>,
    modes: Vec<RawModePolicy>,
}

#[derive(Debug, Default, Deserialize)]
struct RawMcpServerConfig {
    transport: String,
    command: String,
    #[serde(default)]
    args: Vec<String>,
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
    mcp: RawModeMcpAccess,
    #[serde(default)]
    completion_rules: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
struct RawModeMcpAccess {
    #[serde(default)]
    servers: Vec<RawModeMcpServerAccess>,
}

#[derive(Debug, Deserialize)]
struct RawModeMcpServerAccess {
    id: String,
    #[serde(default)]
    tools: Vec<String>,
}

pub fn load_workspace_modepack(
    workspace_root: impl AsRef<Path>,
) -> Result<Option<ModePackSnapshot>> {
    load_workspace_modepack_with_options(
        workspace_root,
        ModePackLoadOptions::untrusted_repository_local(),
    )
}

pub fn load_workspace_modepack_with_options(
    workspace_root: impl AsRef<Path>,
    options: ModePackLoadOptions,
) -> Result<Option<ModePackSnapshot>> {
    let workspace_root = workspace_root.as_ref();
    let path = workspace_root.join(WORKSPACE_MODEPACK_PATH);
    if path.exists() {
        let content = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        let raw: RawModePack = serde_json::from_str(&content)
            .with_context(|| format!("failed to parse {}", path.display()))?;
        return Ok(Some(compile_snapshot(raw, path, options)?));
    }

    let agentmodes_workflow_path = workspace_root.join(WORKSPACE_AGENTMODES_WORKFLOW_PATH);
    if agentmodes_workflow_path.exists() {
        let agentmodes_root = workspace_root.join(WORKSPACE_AGENTMODES_FRAMEWORK_PATH);
        let modepack = compile_agentmodes_modepack_from_root(
            &agentmodes_root,
            agentmodes_compile_options_from_modepack_load_options(options),
        )
        .with_context(|| {
            format!(
                "failed to compile AgentModes workspace framework {}",
                agentmodes_workflow_path.display()
            )
        })?;
        let json = serde_json::to_string(&modepack)
            .context("failed to serialize compiled AgentModes workspace framework")?;
        return Ok(Some(load_modepack_from_str_with_options(
            &json,
            agentmodes_workflow_path,
            options,
        )?));
    }

    Ok(None)
}

fn agentmodes_compile_options_from_modepack_load_options(
    options: ModePackLoadOptions,
) -> AgentModesCompileOptions {
    AgentModesCompileOptions {
        modepack_name: None,
        default_entrypoint: None,
        delegation_coordinators: vec![],
        global_policy_artifacts: vec![],
        source_trust: agentmodes_source_trust_from_modepack_source_trust(options.source_trust),
        capability_ceiling: AgentModesCapabilityCeiling {
            workspace_write: options.capability_ceiling.workspace_write,
            process_exec: options.capability_ceiling.process_exec,
            can_spawn_subtasks: options.capability_ceiling.can_spawn_subtasks,
        },
    }
}

fn agentmodes_source_trust_from_modepack_source_trust(
    source_trust: ModePackSourceTrust,
) -> AgentModesSourceTrust {
    match source_trust {
        ModePackSourceTrust::TrustedLocalDeveloper => AgentModesSourceTrust::TrustedLocalDeveloper,
        ModePackSourceTrust::TrustedSignedActiveModePack => {
            AgentModesSourceTrust::TrustedSignedActiveModePack
        }
        ModePackSourceTrust::UntrustedRepositoryLocal => {
            AgentModesSourceTrust::UntrustedRepositoryLocal
        }
    }
}

pub fn load_modepack_from_str(
    content: &str,
    source_path: impl Into<PathBuf>,
) -> Result<ModePackSnapshot> {
    load_modepack_from_str_with_options(content, source_path, ModePackLoadOptions::default())
}

pub fn load_modepack_from_str_with_options(
    content: &str,
    source_path: impl Into<PathBuf>,
    options: ModePackLoadOptions,
) -> Result<ModePackSnapshot> {
    let raw: RawModePack =
        serde_json::from_str(content).context("failed to parse Mode Pack JSON")?;
    compile_snapshot(raw, source_path.into(), options)
}

fn compile_snapshot(
    raw: RawModePack,
    source_path: PathBuf,
    options: ModePackLoadOptions,
) -> Result<ModePackSnapshot> {
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

    let mcp_servers = validate_mcp_servers(raw.mcp_servers)?;
    let mcp_server_ids = mcp_servers
        .iter()
        .map(|server| server.server_id.clone())
        .collect::<HashSet<_>>();
    let mut seen = HashSet::new();
    let mut modes = Vec::with_capacity(raw.modes.len());
    for raw_mode in raw.modes {
        let mode_id = non_empty("mode_id", raw_mode.mode_id)?;
        if !seen.insert(mode_id.clone()) {
            bail!("duplicate mode_id in modepack: {mode_id}");
        }
        validate_permissions(&mode_id, &raw_mode.permissions)?;
        let permissions = effective_permissions(raw_mode.permissions, options);
        let allowed_handoff_targets =
            validate_handoff_targets(&mode_id, &permissions, raw_mode.allowed_handoff_targets)?;
        let allowed_handoff_targets = if permissions.can_spawn_subtasks {
            allowed_handoff_targets
        } else {
            None
        };
        let workspace_write_scopes = if permissions.workspace_write {
            raw_mode.workspace_write_scopes
        } else {
            Vec::new()
        };
        let mcp_access = validate_mode_mcp_access(&mode_id, raw_mode.mcp, &mcp_server_ids)?;
        let mcp_access = if permissions.mcp_tool_access {
            mcp_access
        } else {
            Vec::new()
        };
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
            permissions,
            workspace_write_scopes,
            allowed_handoff_targets,
            mcp_access,
            completion_rules: raw_mode
                .completion_rules
                .into_iter()
                .map(|rule| non_empty("completion_rules[]", rule))
                .collect::<Result<Vec<_>>>()?,
        });
    }
    let entrypoints = validate_entrypoints(raw.entrypoints, &seen)?;
    let global_policy_artifacts = validate_policy_artifacts(raw.global_policy_artifacts)?;

    Ok(ModePackSnapshot {
        name,
        schema_version: raw.schema_version,
        source_path,
        source_trust: options.source_trust,
        capability_ceiling: options.capability_ceiling,
        entrypoints,
        global_policy_artifacts,
        mcp_servers,
        modes,
    })
}

fn effective_permissions(
    declared: ModePermissions,
    options: ModePackLoadOptions,
) -> ModePermissions {
    let trusted_side_effect_source = matches!(
        options.source_trust,
        ModePackSourceTrust::TrustedLocalDeveloper
            | ModePackSourceTrust::TrustedSignedActiveModePack
    );
    let workspace_write = declared.workspace_write
        && trusted_side_effect_source
        && options.capability_ceiling.workspace_write;
    let process_exec = declared.process_exec
        && trusted_side_effect_source
        && options.capability_ceiling.process_exec;
    let git_inspect = declared.git_inspect
        && trusted_side_effect_source
        && options.capability_ceiling.git_inspect;
    let git_commit =
        declared.git_commit && trusted_side_effect_source && options.capability_ceiling.git_commit;
    let network_access = false;
    let service_control = false;
    let destructive = false;
    let can_spawn_subtasks = declared.can_spawn_subtasks
        && trusted_side_effect_source
        && options.capability_ceiling.can_spawn_subtasks;
    let mcp_tool_access = declared.mcp_tool_access
        && trusted_side_effect_source
        && options.capability_ceiling.mcp_tool_access;
    ModePermissions {
        read_only: declared.read_only
            || !(workspace_write
                || process_exec
                || git_inspect
                || git_commit
                || network_access
                || service_control
                || destructive
                || can_spawn_subtasks
                || mcp_tool_access),
        workspace_write,
        process_exec,
        git_inspect,
        git_commit,
        network_access,
        service_control,
        destructive,
        can_spawn_subtasks,
        codebase_index: declared.codebase_index,
        mcp_tool_access,
    }
}

fn non_empty(field: &str, value: String) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        bail!("modepack {field} must not be empty");
    }
    Ok(trimmed.to_string())
}

fn validate_mcp_servers(
    raw: std::collections::BTreeMap<String, RawMcpServerConfig>,
) -> Result<Vec<ModePackMcpServerConfig>> {
    if raw.len() > MAX_MCP_SERVERS {
        bail!("modepack mcp_servers exceeds server limit");
    }
    raw.into_iter()
        .map(|(server_id, config)| {
            let server_id = validate_mcp_identifier(
                "mcp_servers server id",
                &server_id,
                MAX_MCP_SERVER_ID_CHARS,
            )?;
            let transport = non_empty("mcp_servers[].transport", config.transport)?;
            if transport != "stdio" {
                bail!("modepack mcp_servers[{server_id}].transport is unsupported: {transport}");
            }
            let command = validate_mcp_stdio_command(&server_id, config.command)?;
            if config.args.len() > MAX_MCP_ARGS {
                bail!("modepack mcp_servers[{server_id}].args exceeds argument limit");
            }
            let args = config
                .args
                .into_iter()
                .map(|arg| validate_mcp_text("mcp_servers[].args[]", arg, MAX_MCP_ARG_CHARS))
                .collect::<Result<Vec<_>>>()?;
            let config_identity_fingerprint =
                mcp_config_identity_fingerprint(&server_id, &transport, &command, &args);
            Ok(ModePackMcpServerConfig {
                server_id,
                transport,
                command,
                args,
                config_identity_fingerprint,
            })
        })
        .collect()
}

fn validate_mode_mcp_access(
    mode_id: &str,
    raw: RawModeMcpAccess,
    known_servers: &HashSet<String>,
) -> Result<Vec<CompiledMcpServerAccess>> {
    if raw.servers.len() > MAX_MCP_SERVERS {
        bail!("modepack mode {mode_id} mcp.servers exceeds server limit");
    }
    let mut seen_servers = HashSet::new();
    raw.servers
        .into_iter()
        .map(|server| {
            let server_id =
                validate_mcp_identifier("mcp.servers[].id", &server.id, MAX_MCP_SERVER_ID_CHARS)?;
            if !known_servers.contains(&server_id) {
                bail!("modepack mode {mode_id} references unknown MCP server: {server_id}");
            }
            if !seen_servers.insert(server_id.clone()) {
                bail!("modepack mode {mode_id} has duplicate MCP server: {server_id}");
            }
            if server.tools.is_empty() {
                bail!(
                    "modepack mode {mode_id} MCP server {server_id} must allow at least one tool"
                );
            }
            if server.tools.len() > MAX_MCP_TOOLS_PER_MODE_SERVER {
                bail!("modepack mode {mode_id} MCP server {server_id} exceeds tool limit");
            }
            let mut seen_tools = HashSet::new();
            let mut tools = server
                .tools
                .into_iter()
                .map(|tool| {
                    validate_mcp_identifier("mcp.servers[].tools[]", &tool, MAX_MCP_TOOL_NAME_CHARS)
                })
                .collect::<Result<Vec<_>>>()?;
            tools.sort();
            for tool in &tools {
                if !seen_tools.insert(tool.clone()) {
                    bail!(
                        "modepack mode {mode_id} MCP server {server_id} has duplicate tool: {tool}"
                    );
                }
            }
            Ok(CompiledMcpServerAccess { server_id, tools })
        })
        .collect()
}

fn validate_mcp_identifier(field: &str, value: &str, max_chars: usize) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        bail!("modepack {field} must not be empty");
    }
    if value.chars().count() > max_chars {
        bail!("modepack {field} exceeds length limit");
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.')
    {
        bail!("modepack {field} must be a bounded MCP identifier");
    }
    Ok(value.to_string())
}

fn validate_mcp_text(field: &str, value: String, max_chars: usize) -> Result<String> {
    let value = non_empty(field, value)?;
    if value.chars().count() > max_chars || value.chars().any(char::is_control) {
        bail!("modepack {field} is not a bounded single-line value");
    }
    Ok(value)
}

fn validate_mcp_stdio_command(server_id: &str, value: String) -> Result<String> {
    let command = validate_mcp_text("mcp_servers[].command", value, MAX_MCP_COMMAND_CHARS)?;
    let path = Path::new(&command);
    if !path.is_absolute() {
        bail!(
            "modepack mcp_servers[{server_id}].command must be an absolute executable path; PATH lookup is not allowed"
        );
    }
    if path.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir | std::path::Component::CurDir
        )
    }) {
        bail!(
            "modepack mcp_servers[{server_id}].command must not contain relative path components"
        );
    }
    Ok(command)
}

fn mcp_config_identity_fingerprint(
    server_id: &str,
    transport: &str,
    command: &str,
    args: &[String],
) -> String {
    let canonical = serde_json::json!({
        "version": "modepack_mcp_server_config_identity_v1",
        "server_id": server_id,
        "transport": transport,
        "command": command,
        "args": args,
    });
    format!("sha256:{}", hex_sha256(canonical.to_string().as_bytes()))
}

fn hex_sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
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

fn validate_policy_artifacts(
    artifacts: Vec<CompiledPolicyArtifact>,
) -> Result<Vec<CompiledPolicyArtifact>> {
    if artifacts.len() > MAX_POLICY_ARTIFACTS {
        bail!("modepack global_policy_artifacts exceeds count limit");
    }
    let mut seen = HashSet::new();
    artifacts
        .into_iter()
        .map(|artifact| {
            let category = validate_policy_artifact_category(artifact.category)?;
            let relative_path = validate_policy_artifact_relative_path(artifact.relative_path)?;
            if !seen.insert(relative_path.clone()) {
                bail!("duplicate modepack global_policy_artifacts path: {relative_path}");
            }
            let title = non_empty("global_policy_artifacts[].title", artifact.title)?;
            let content = non_empty("global_policy_artifacts[].content", artifact.content)?;
            if content.chars().count() > MAX_POLICY_ARTIFACT_CONTENT_CHARS {
                bail!("modepack global_policy_artifacts[].content exceeds content size limit");
            }
            let content_fingerprint = non_empty(
                "global_policy_artifacts[].content_fingerprint",
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
    let category = non_empty("global_policy_artifacts[].category", category)?;
    match category.as_str() {
        "rule" | "skill" | "command" | "contract" | "schema" | "runtime_policy" => Ok(category),
        other => bail!("modepack global_policy_artifacts category is unsupported: {other}"),
    }
}

fn validate_policy_artifact_relative_path(value: String) -> Result<String> {
    let value = non_empty("global_policy_artifacts[].relative_path", value)?;
    if value.chars().count() > MAX_POLICY_ARTIFACT_PATH_CHARS {
        bail!("modepack global_policy_artifacts[].relative_path exceeds path length limit");
    }
    if value.starts_with('/')
        || value.contains('\\')
        || value
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        bail!(
            "modepack global_policy_artifacts[].relative_path must be a normalized relative path"
        );
    }
    if !(value.ends_with(".md") || value.ends_with(".yaml") || value.ends_with(".yml")) {
        bail!("modepack global_policy_artifacts[].relative_path must reference markdown or YAML");
    }
    Ok(value)
}

fn validate_permissions(mode_id: &str, permissions: &ModePermissions) -> Result<()> {
    if permissions.read_only
        && (permissions.workspace_write
            || permissions.process_exec
            || permissions.git_inspect
            || permissions.git_commit
            || permissions.mcp_tool_access)
    {
        bail!("mode {mode_id} declares read_only=true with side-effect capabilities");
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
        return Ok(None);
    }
    if targets.is_empty() {
        bail!("mode {mode_id} can spawn subtasks but declares no allowed_handoff_targets");
    }
    if targets.len() > MAX_HANDOFF_TARGETS {
        bail!("mode {mode_id} declares too many allowed_handoff_targets");
    }
    if targets
        .iter()
        .any(|target| target == HANDOFF_TARGET_ALL_MODEPACK_MODES)
        && targets.len() != 1
    {
        bail!("mode {mode_id} mixes the all-modepack handoff selector with explicit targets");
    }
    let mut seen = HashSet::new();
    let mut normalized = Vec::with_capacity(targets.len());
    for target in targets {
        let target = non_empty("allowed_handoff_targets[]", target)?;
        if target == HANDOFF_TARGET_ALL_MODEPACK_MODES {
            normalized.push(target);
            continue;
        }
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
        compile_agentmodes_modepack_from_root, compile_agentmodes_modepack_to_json,
        AgentModesCompileOptions, RuntimeAction, RuntimePermissionGate,
        CURRENT_AGENTMODES_COMPATIBILITY_BASELINE,
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

        let snapshot = load_workspace_modepack_with_options(
            temp.path(),
            ModePackLoadOptions::trusted_local_developer(),
        )
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
    fn loads_agentmodes_workspace_framework_when_modepack_json_is_absent() {
        let temp = tempfile::tempdir().expect("tempdir");
        let agentmodes_dir = temp.path().join(WORKSPACE_AGENTMODES_FRAMEWORK_PATH);
        fs::create_dir_all(agentmodes_dir.join("prompts")).expect("AgentModes prompts");
        fs::write(
            agentmodes_dir.join("workflow.yaml"),
            r#"
name: agentmodes-core
schema_version: 1
default_mode_id: core.orchestrator
modes:
  - mode_id: core.orchestrator
    display_name: AgentModes Core Orchestrator
    prompt_file: prompts/core.orchestrator.md
    permissions:
      read: true
      edit: false
      command: false
      git: false
      network: false
      mcp: false
      phase_write: false
      dispatch: false
    completion_rules:
      - Return an ORCHESTRATOR_PROPOSAL_V1-compatible structured result.
"#,
        )
        .expect("workflow");
        fs::write(
            agentmodes_dir.join("prompts/core.orchestrator.md"),
            "# Core Orchestrator\n\nReturn ORCHESTRATOR_PROPOSAL_V1.",
        )
        .expect("prompt");

        let snapshot = load_workspace_modepack_with_options(
            temp.path(),
            ModePackLoadOptions::trusted_local_developer(),
        )
        .expect("load")
        .expect("snapshot");

        assert_eq!(snapshot.name, "agentmodes-core");
        assert_eq!(
            snapshot.source_path,
            temp.path().join(WORKSPACE_AGENTMODES_WORKFLOW_PATH)
        );
        assert_eq!(
            snapshot.entrypoints.default_mode_id(),
            Some(brownie_agentmodes::AGENTMODES_V2_DEFAULT_ROLE_ID)
        );
        let orchestrator = snapshot
            .modes
            .iter()
            .find(|mode| mode.mode_id == brownie_agentmodes::AGENTMODES_V2_DEFAULT_ROLE_ID)
            .expect("orchestrator");
        assert_eq!(
            orchestrator.prompt_sections[0].source,
            "AgentModes.workflow.prompt_file:prompts/core.orchestrator.md"
        );
        assert!(orchestrator.prompt_sections[0]
            .content
            .contains("ORCHESTRATOR_PROPOSAL_V1"));
        assert!(!RuntimePermissionGate::check(orchestrator, RuntimeAction::WriteWorkspace).allowed);
        assert!(!RuntimePermissionGate::check(orchestrator, RuntimeAction::SpawnSubtask).allowed);
        assert!(snapshot.mcp_servers.is_empty());
    }

    #[test]
    fn modepack_json_takes_precedence_over_agentmodes_workspace_framework() {
        let temp = tempfile::tempdir().expect("tempdir");
        let brownie_dir = temp.path().join(".brownie");
        fs::create_dir_all(&brownie_dir).expect("brownie dir");
        let agentmodes_dir = temp.path().join(WORKSPACE_AGENTMODES_FRAMEWORK_PATH);
        fs::create_dir_all(&agentmodes_dir).expect("AgentModes dir");
        fs::write(agentmodes_dir.join("workflow.yaml"), "not: [parsed").expect("workflow");
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

        let snapshot = load_workspace_modepack_with_options(
            temp.path(),
            ModePackLoadOptions::trusted_local_developer(),
        )
        .expect("load")
        .expect("snapshot");

        assert_eq!(snapshot.name, "local-agentmodes");
        assert_eq!(
            snapshot.source_path,
            temp.path().join(WORKSPACE_MODEPACK_PATH)
        );
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

        let snapshot = load_workspace_modepack_with_options(
            temp.path(),
            ModePackLoadOptions::trusted_local_developer(),
        )
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

        let snapshot = load_workspace_modepack_with_options(
            temp.path(),
            ModePackLoadOptions::trusted_local_developer(),
        )
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
    fn loads_spawning_mode_with_all_modepack_handoff_selector() {
        let snapshot = load_modepack_from_str(
            r#"{
              "name": "handoff-selector-pack",
              "schema_version": 1,
              "modes": [
                {
                  "mode_id": "external-orchestrator",
                  "display_name": "External Orchestrator",
                  "role_definition": "Delegate to validated members through a bounded selector.",
                  "permissions": {
                    "read_only": true,
                    "workspace_write": false,
                    "process_exec": false,
                    "network_access": false,
                    "service_control": false,
                    "destructive": false,
                    "can_spawn_subtasks": true
                  },
                  "allowed_handoff_targets": ["$modepack/*"]
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
            ".brownie/modepack.json",
        )
        .expect("valid selector Mode Pack");

        let orchestrator = snapshot
            .modes
            .iter()
            .find(|mode| mode.mode_id == "external-orchestrator")
            .expect("external orchestrator");
        assert_eq!(
            orchestrator.allowed_handoff_targets,
            Some(vec![HANDOFF_TARGET_ALL_MODEPACK_MODES.to_string()])
        );
    }

    #[test]
    fn rejects_mixed_all_modepack_handoff_selector_and_explicit_targets() {
        let error = load_modepack_from_str(
            r#"{
              "name": "mixed-handoff-selector-pack",
              "schema_version": 1,
              "modes": [
                {
                  "mode_id": "external-orchestrator",
                  "display_name": "External Orchestrator",
                  "role_definition": "Invalid mixed target selector.",
                  "permissions": {
                    "read_only": true,
                    "workspace_write": false,
                    "process_exec": false,
                    "network_access": false,
                    "service_control": false,
                    "destructive": false,
                    "can_spawn_subtasks": true
                  },
                  "allowed_handoff_targets": ["$modepack/*", "reviewer-lite"]
                }
              ]
            }"#,
            ".brownie/modepack.json",
        )
        .expect_err("mixed selector should fail")
        .to_string();

        assert!(error.contains("mixes the all-modepack handoff selector"));
    }

    #[test]
    fn untrusted_spawning_mode_without_handoff_targets_is_narrowed() {
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

        let snapshot = load_workspace_modepack(temp.path())
            .expect("untrusted missing targets should narrow")
            .expect("snapshot");
        let orchestrator = &snapshot.modes[0];

        assert!(!orchestrator.permissions.can_spawn_subtasks);
        assert_eq!(orchestrator.allowed_handoff_targets, None);
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

        let error = load_workspace_modepack_with_options(
            temp.path(),
            ModePackLoadOptions::trusted_local_developer(),
        )
        .expect_err("invalid target should fail")
        .to_string();

        assert!(error.contains("unsupported characters"));
    }

    #[test]
    fn workspace_modepack_load_defaults_to_untrusted_side_effect_ceiling() {
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
                    "network_access": true,
                    "service_control": true,
                    "destructive": true,
                    "can_spawn_subtasks": true,
                    "codebase_index": true
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
        assert_eq!(
            snapshot.source_trust,
            ModePackSourceTrust::UntrustedRepositoryLocal
        );
        assert!(editor.permissions.read_only);
        assert!(!editor.permissions.workspace_write);
        assert!(!editor.permissions.process_exec);
        assert!(!editor.permissions.network_access);
        assert!(!editor.permissions.service_control);
        assert!(!editor.permissions.destructive);
        assert!(!editor.permissions.can_spawn_subtasks);
        assert!(editor.permissions.codebase_index);
        assert_eq!(editor.allowed_handoff_targets, None);

        let tester = snapshot
            .modes
            .iter()
            .find(|mode| mode.mode_id == "external-tester")
            .expect("tester mode");
        assert!(!tester.permissions.workspace_write);
        assert!(!tester.permissions.process_exec);

        let integrator = snapshot
            .modes
            .iter()
            .find(|mode| mode.mode_id == "external-integrator")
            .expect("integrator mode");
        assert!(!integrator.permissions.workspace_write);
        assert!(!integrator.permissions.process_exec);
    }

    #[test]
    fn trusted_modepack_options_preserve_grantable_effects_but_deny_reserved_v0_side_effects() {
        let content = r#"{
          "name": "trusted-agentmodes",
          "schema_version": 1,
          "modes": [
            {
              "mode_id": "external-integrator",
              "display_name": "External Integrator",
              "role_definition": "Coordinate edits and verification through runtime-controlled tools.",
              "permissions": {
                "read_only": false,
                "workspace_write": true,
                "process_exec": true,
                "network_access": true,
                "service_control": true,
                "destructive": true,
                "can_spawn_subtasks": true,
                "codebase_index": true
              },
              "allowed_handoff_targets": ["$modepack/*"]
            }
          ]
        }"#;

        let snapshot = load_modepack_from_str_with_options(
            content,
            ".brownie/modepack.json",
            ModePackLoadOptions {
                source_trust: ModePackSourceTrust::TrustedSignedActiveModePack,
                capability_ceiling: ModePackCapabilityCeiling {
                    workspace_write: true,
                    process_exec: false,
                    git_inspect: true,
                    git_commit: true,
                    network_access: true,
                    service_control: true,
                    destructive: true,
                    can_spawn_subtasks: true,
                    mcp_tool_access: true,
                },
            },
        )
        .expect("trusted side-effect mode should compile");

        let integrator = &snapshot.modes[0];
        assert_eq!(
            snapshot.source_trust,
            ModePackSourceTrust::TrustedSignedActiveModePack
        );
        assert!(integrator.permissions.workspace_write);
        assert!(!integrator.permissions.process_exec);
        assert!(!integrator.permissions.network_access);
        assert!(!integrator.permissions.service_control);
        assert!(!integrator.permissions.destructive);
        assert!(integrator.permissions.can_spawn_subtasks);
        assert!(integrator.permissions.codebase_index);
        assert_eq!(
            integrator.allowed_handoff_targets.as_deref(),
            Some([HANDOFF_TARGET_ALL_MODEPACK_MODES.to_string()].as_slice())
        );
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
                delegation_coordinators: vec!["orchestrator".to_string()],
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
    fn preserves_bounded_global_policy_artifacts() {
        let snapshot = load_modepack_from_str(
            r#"{
              "name": "policy-artifacts",
              "schema_version": 1,
              "global_policy_artifacts": [
                {
                  "category": "rule",
                  "relative_path": "rules/runtime-safety.md",
                  "title": "Runtime Safety",
                  "content": "Global policy text is protected prompt material only.",
                  "content_fingerprint": "sha256:test-runtime-safety"
                },
                {
                  "category": "contract",
                  "relative_path": "docs/contracts/task-packet-v1.md",
                  "title": "Task Packet",
                  "content": "Contract text cannot grant runtime side effects.",
                  "content_fingerprint": "sha256:test-contract"
                }
              ],
              "modes": [
                {
                  "mode_id": "reader",
                  "display_name": "Reader",
                  "role_definition": "Read policy only.",
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
            ".brownie/modepack.json",
        )
        .expect("valid policy artifacts");

        assert_eq!(snapshot.global_policy_artifacts.len(), 2);
        assert_eq!(
            snapshot.global_policy_artifacts[0].relative_path,
            "rules/runtime-safety.md"
        );
        assert_eq!(snapshot.global_policy_artifacts[1].category, "contract");
        assert!(
            !RuntimePermissionGate::check(&snapshot.modes[0], RuntimeAction::WriteWorkspace)
                .allowed
        );
        assert!(
            !RuntimePermissionGate::check(&snapshot.modes[0], RuntimeAction::ExecuteProcess)
                .allowed
        );
    }

    #[test]
    fn rejects_unsafe_global_policy_artifact_paths() {
        let error = load_modepack_from_str(
            r#"{
              "name": "policy-artifacts",
              "schema_version": 1,
              "global_policy_artifacts": [
                {
                  "category": "rule",
                  "relative_path": "../runtime-safety.md",
                  "title": "Runtime Safety",
                  "content": "Bad path.",
                  "content_fingerprint": "sha256:test"
                }
              ],
              "modes": [
                {
                  "mode_id": "reader",
                  "display_name": "Reader",
                  "role_definition": "Read policy only.",
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
            ".brownie/modepack.json",
        )
        .expect_err("unsafe policy artifact path should fail")
        .to_string();

        assert!(error.contains("must be a normalized relative path"));
    }

    #[test]
    fn validates_current_agentmodes_pack_scale_when_source_is_available() {
        let Some(source_root) = current_agentmodes_root_for_test() else {
            return;
        };
        let baseline = CURRENT_AGENTMODES_COMPATIBILITY_BASELINE;
        let modepack = compile_agentmodes_modepack_from_root(
            &source_root,
            AgentModesCompileOptions {
                modepack_name: Some("current-agentmodes".to_string()),
                ..AgentModesCompileOptions::default()
            },
        )
        .expect("compile current AgentModes mode pack");
        let json = serde_json::to_string_pretty(&modepack).expect("serialize modepack");
        let snapshot = load_modepack_from_str_with_options(
            &json,
            ".brownie/modepack.json",
            ModePackLoadOptions::trusted_signed_active_modepack(),
        )
        .expect("validate modepack");

        assert_eq!(snapshot.modes.len(), baseline.expected_compiled_mode_count);
        assert_eq!(
            policy_artifact_category_count(&snapshot.global_policy_artifacts, "rule"),
            baseline.expected_rule_count
        );
        assert_eq!(
            policy_artifact_category_count(&snapshot.global_policy_artifacts, "skill"),
            baseline.expected_skill_count
        );
        assert_eq!(
            policy_artifact_category_count(&snapshot.global_policy_artifacts, "command"),
            baseline.expected_command_count
        );
        assert_eq!(
            policy_artifact_category_count(&snapshot.global_policy_artifacts, "contract"),
            baseline.expected_contract_count
        );
        assert_eq!(
            policy_artifact_category_count(&snapshot.global_policy_artifacts, "schema"),
            baseline.expected_schema_count
        );
        assert_eq!(
            policy_artifact_category_count(&snapshot.global_policy_artifacts, "runtime_policy"),
            baseline.expected_runtime_policy_count
        );
        assert!(snapshot
            .global_policy_artifacts
            .iter()
            .any(
                |artifact| artifact.relative_path == "schemas/role.schema.yaml"
                    && artifact.content_fingerprint.starts_with("sha256:")
            ));
        assert!(snapshot
            .global_policy_artifacts
            .iter()
            .any(
                |artifact| artifact.relative_path == "schemas/workflow.schema.yaml"
                    && artifact.content_fingerprint.starts_with("sha256:")
            ));
        let orchestrator = snapshot
            .modes
            .iter()
            .find(|mode| mode.mode_id == brownie_agentmodes::AGENTMODES_V2_DEFAULT_ROLE_ID)
            .expect("orchestrator");
        assert_eq!(
            snapshot.entrypoints.default_mode_id(),
            Some(brownie_agentmodes::AGENTMODES_V2_DEFAULT_ROLE_ID)
        );
        assert!(!RuntimePermissionGate::check(orchestrator, RuntimeAction::SpawnSubtask).allowed);
        assert_eq!(orchestrator.allowed_handoff_targets, None);
        assert!(orchestrator.prompt_sections.iter().any(|section| {
            section.source == "AgentModes.workflow.prompt_file:prompts/core.orchestrator.md"
                && section.content.contains("ORCHESTRATOR_PROPOSAL_V1")
        }));
        let reporter = snapshot
            .modes
            .iter()
            .find(|mode| mode.mode_id == "core.reporter")
            .expect("reporter");
        assert!(!RuntimePermissionGate::check(reporter, RuntimeAction::SpawnSubtask).allowed);
        assert_eq!(reporter.allowed_handoff_targets, None);
    }

    static CURRENT_AGENTMODES_CHECKOUT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn current_agentmodes_root_for_test() -> Option<std::path::PathBuf> {
        let baseline = CURRENT_AGENTMODES_COMPATIBILITY_BASELINE;
        let explicit_root = std::env::var_os(baseline.root_env).map(std::path::PathBuf::from);
        let required = current_agentmodes_required_for_test();

        if let Some(root) = explicit_root {
            assert_current_agentmodes_root_for_test(&root);
            return Some(root);
        }

        if required {
            let _guard = CURRENT_AGENTMODES_CHECKOUT_LOCK
                .lock()
                .expect("AgentModes compatibility checkout lock");
            let root = current_agentmodes_managed_checkout_for_test("brownie-modepack");
            prepare_current_agentmodes_checkout_for_test(&root);
            assert_current_agentmodes_root_for_test(&root);
            return Some(root);
        }

        let root = std::path::PathBuf::from("/Users/satoshitanaka/Documents/AgentModes");
        if !root
            .join(brownie_agentmodes::AGENTMODES_WORKFLOW_PATH)
            .is_file()
            || current_agentmodes_revision(&root).as_deref() != Some(baseline.revision)
        {
            return None;
        }

        Some(root)
    }

    fn current_agentmodes_required_for_test() -> bool {
        let baseline = CURRENT_AGENTMODES_COMPATIBILITY_BASELINE;
        truthy_env(baseline.required_env) || truthy_env("CI")
    }

    fn truthy_env(name: &str) -> bool {
        std::env::var(name)
            .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
            .unwrap_or(false)
    }

    fn assert_current_agentmodes_root_for_test(root: &std::path::Path) {
        let baseline = CURRENT_AGENTMODES_COMPATIBILITY_BASELINE;
        assert!(
            root.join("core").is_dir(),
            "{} must point to a checked-out {} repository",
            baseline.root_env,
            baseline.repository
        );
        assert!(
            root.join(brownie_agentmodes::AGENTMODES_WORKFLOW_PATH)
                .is_file(),
            "AgentModes compatibility baseline must include workflow.yaml"
        );
        assert_eq!(
            current_agentmodes_revision(root).as_deref(),
            Some(baseline.revision),
            "AgentModes compatibility baseline revision drifted"
        );
        assert!(
            root.join("core/orchestrator.yaml").is_file(),
            "AgentModes compatibility baseline must include v2 Core role artifacts"
        );
        assert!(
            root.join("prompts/core.orchestrator.md").is_file(),
            "AgentModes compatibility baseline must include workflow prompt files"
        );
        assert!(
            root.join("runtime-policies/brownie/loop-policy.yaml")
                .is_file(),
            "AgentModes compatibility baseline must include Brownie runtime policies"
        );
    }

    fn current_agentmodes_managed_checkout_for_test(namespace: &str) -> std::path::PathBuf {
        let baseline = CURRENT_AGENTMODES_COMPATIBILITY_BASELINE;
        std::env::temp_dir()
            .join("brownie-agentmodes-compat")
            .join(format!(
                "{}-{}-{}",
                namespace,
                std::process::id(),
                baseline.revision
            ))
    }

    fn prepare_current_agentmodes_checkout_for_test(root: &std::path::Path) {
        let baseline = CURRENT_AGENTMODES_COMPATIBILITY_BASELINE;
        if current_agentmodes_revision(root).as_deref() == Some(baseline.revision)
            && root
                .join(brownie_agentmodes::AGENTMODES_WORKFLOW_PATH)
                .is_file()
            && root.join("prompts/core.orchestrator.md").is_file()
        {
            return;
        }
        if root.exists() {
            std::fs::remove_dir_all(root).expect("remove stale AgentModes compatibility checkout");
        }
        std::fs::create_dir_all(root.parent().expect("AgentModes checkout parent"))
            .expect("create AgentModes compatibility checkout parent");
        let repository_url = format!("https://github.com/{}.git", baseline.repository);
        assert_git_status_for_test(
            std::process::Command::new("git")
                .arg("clone")
                .arg("--no-checkout")
                .arg(&repository_url)
                .arg(root),
            "clone AgentModes compatibility baseline",
        );
        assert_git_status_for_test(
            std::process::Command::new("git")
                .arg("-C")
                .arg(root)
                .arg("fetch")
                .arg("--depth")
                .arg("1")
                .arg("origin")
                .arg(baseline.revision),
            "fetch AgentModes compatibility baseline revision",
        );
        assert_git_status_for_test(
            std::process::Command::new("git")
                .arg("-C")
                .arg(root)
                .arg("checkout")
                .arg("--detach")
                .arg(baseline.revision),
            "checkout AgentModes compatibility baseline revision",
        );
    }

    fn assert_git_status_for_test(command: &mut std::process::Command, label: &str) {
        let status = command
            .status()
            .unwrap_or_else(|error| panic!("{label}: {error}"));
        assert!(status.success(), "{label} failed with status {status}");
    }

    fn current_agentmodes_revision(root: &std::path::Path) -> Option<String> {
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

    fn policy_artifact_category_count(
        artifacts: &[CompiledPolicyArtifact],
        category: &str,
    ) -> usize {
        artifacts
            .iter()
            .filter(|artifact| artifact.category == category)
            .count()
    }

    #[test]
    fn untrusted_workspace_modepack_narrows_network_permission() {
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

        let snapshot = load_workspace_modepack(temp.path())
            .expect("load")
            .expect("snapshot");
        let networker = &snapshot.modes[0];

        assert_eq!(
            snapshot.source_trust,
            ModePackSourceTrust::UntrustedRepositoryLocal
        );
        assert!(networker.permissions.read_only);
        assert!(!networker.permissions.network_access);
        assert!(!RuntimePermissionGate::check(networker, RuntimeAction::AccessNetwork).allowed);
    }

    #[test]
    fn untrusted_string_modepack_options_narrow_service_and_destructive_permissions() {
        for field in ["service_control", "destructive"] {
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

            let snapshot = load_modepack_from_str_with_options(
                &modepack,
                ".brownie/modepack.json",
                ModePackLoadOptions::untrusted_repository_local(),
            )
            .expect("untrusted unsafe declaration should narrow");
            let policy = &snapshot.modes[0];

            assert!(policy.permissions.read_only);
            assert!(!policy.permissions.service_control);
            assert!(!policy.permissions.destructive);
            assert!(!RuntimePermissionGate::check(policy, RuntimeAction::ControlService).allowed);
            assert!(
                !RuntimePermissionGate::check(policy, RuntimeAction::DestructiveOperation).allowed
            );
        }
    }

    #[test]
    fn git_permissions_are_explicit_and_narrowed_by_trust() {
        let modepack = r#"{
          "name": "git-pack",
          "schema_version": 1,
          "modes": [
            {
              "mode_id": "git-observer",
              "display_name": "Git Observer",
              "role_definition": "May inspect Git but must not mutate it.",
              "permissions": {
                "read_only": false,
                "workspace_write": false,
                "process_exec": true,
                "git_inspect": true,
                "git_commit": false,
                "network_access": false,
                "service_control": false,
                "destructive": false,
                "can_spawn_subtasks": false
              }
            },
            {
              "mode_id": "legacy-runner",
              "display_name": "Legacy Runner",
              "role_definition": "Process execution does not imply Git authority.",
              "permissions": {
                "read_only": false,
                "workspace_write": false,
                "process_exec": true,
                "network_access": false,
                "service_control": false,
                "destructive": false,
                "can_spawn_subtasks": false
              }
            }
          ]
        }"#;

        let trusted = load_modepack_from_str_with_options(
            modepack,
            ".brownie/modepack.json",
            ModePackLoadOptions::trusted_signed_active_modepack(),
        )
        .expect("trusted git modepack");
        let observer = trusted
            .modes
            .iter()
            .find(|mode| mode.mode_id == "git-observer")
            .expect("observer");
        assert!(RuntimePermissionGate::check(observer, RuntimeAction::ExecuteProcess).allowed);
        assert!(
            RuntimePermissionGate::check(observer, RuntimeAction::UseGitInspectCapability).allowed
        );
        assert!(
            !RuntimePermissionGate::check(observer, RuntimeAction::UseGitCommitCapability).allowed
        );

        let legacy_runner = trusted
            .modes
            .iter()
            .find(|mode| mode.mode_id == "legacy-runner")
            .expect("legacy runner");
        assert!(RuntimePermissionGate::check(legacy_runner, RuntimeAction::ExecuteProcess).allowed);
        assert!(
            !RuntimePermissionGate::check(legacy_runner, RuntimeAction::UseGitInspectCapability)
                .allowed
        );
        assert!(
            !RuntimePermissionGate::check(legacy_runner, RuntimeAction::UseGitCommitCapability)
                .allowed
        );

        let untrusted = load_modepack_from_str_with_options(
            modepack,
            ".brownie/modepack.json",
            ModePackLoadOptions::untrusted_repository_local(),
        )
        .expect("untrusted git modepack should narrow");
        let untrusted_observer = untrusted
            .modes
            .iter()
            .find(|mode| mode.mode_id == "git-observer")
            .expect("untrusted observer");
        assert!(
            !RuntimePermissionGate::check(
                untrusted_observer,
                RuntimeAction::UseGitInspectCapability
            )
            .allowed
        );
        assert!(
            !RuntimePermissionGate::check(
                untrusted_observer,
                RuntimeAction::UseGitCommitCapability
            )
            .allowed
        );
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

    #[test]
    fn trusted_modepack_preserves_structured_mcp_allow_list() {
        let modepack = r#"{
          "name": "mcp-pack",
          "schema_version": 1,
          "mcp_servers": {
            "github": {
              "transport": "stdio",
              "command": "/bin/echo",
              "args": ["{}"]
            }
          },
          "modes": [
            {
              "mode_id": "reviewer",
              "display_name": "Reviewer",
              "role_definition": "Review with a bounded MCP catalog.",
              "permissions": {
                "read_only": false,
                "workspace_write": false,
                "process_exec": false,
                "network_access": false,
                "service_control": false,
                "destructive": false,
                "can_spawn_subtasks": false,
                "mcp_tool_access": true
              },
              "mcp": {
                "servers": [
                  { "id": "github", "tools": ["get_file_contents", "search_code"] }
                ]
              }
            }
          ]
        }"#;

        let snapshot = load_modepack_from_str_with_options(
            modepack,
            ".brownie/modepack.json",
            ModePackLoadOptions::trusted_signed_active_modepack(),
        )
        .expect("trusted structured MCP policy");
        let policy = &snapshot.modes[0];

        assert!(policy.permissions.mcp_tool_access);
        assert_eq!(policy.mcp_access[0].server_id, "github");
        assert_eq!(
            policy.mcp_access[0].tools,
            vec!["get_file_contents".to_string(), "search_code".to_string()]
        );
        assert!(snapshot.mcp_servers[0]
            .config_identity_fingerprint
            .starts_with("sha256:"));
    }

    #[test]
    fn rejects_mcp_stdio_command_path_lookup() {
        let modepack = r#"{
          "name": "mcp-pack",
          "schema_version": 1,
          "mcp_servers": {
            "local": {
              "transport": "stdio",
              "command": "npx",
              "args": ["@example/server"]
            }
          },
          "modes": [
            {
              "mode_id": "reviewer",
              "display_name": "Reviewer",
              "role_definition": "Review with a bounded MCP catalog.",
              "permissions": {
                "read_only": false,
                "workspace_write": false,
                "process_exec": false,
                "network_access": false,
                "service_control": false,
                "destructive": false,
                "can_spawn_subtasks": false,
                "mcp_tool_access": true
              },
              "mcp": {
                "servers": [
                  { "id": "local", "tools": ["search"] }
                ]
              }
            }
          ]
        }"#;

        let error = load_modepack_from_str_with_options(
            modepack,
            ".brownie/modepack.json",
            ModePackLoadOptions::trusted_signed_active_modepack(),
        )
        .expect_err("relative MCP command should fail closed")
        .to_string();

        assert!(error.contains("absolute executable path"));
    }

    #[test]
    fn untrusted_workspace_modepack_cannot_grant_mcp_execution() {
        let modepack = r#"{
          "name": "mcp-pack",
          "schema_version": 1,
          "mcp_servers": {
            "local": { "transport": "stdio", "command": "/bin/echo" }
          },
          "modes": [
            {
              "mode_id": "reviewer",
              "display_name": "Reviewer",
              "role_definition": "Repository prose cannot grant MCP.",
              "permissions": {
                "read_only": false,
                "workspace_write": false,
                "process_exec": false,
                "network_access": false,
                "service_control": false,
                "destructive": false,
                "can_spawn_subtasks": false,
                "mcp_tool_access": true
              },
              "mcp": {
                "servers": [
                  { "id": "local", "tools": ["search"] }
                ]
              }
            }
          ]
        }"#;

        let snapshot = load_modepack_from_str_with_options(
            modepack,
            ".brownie/modepack.json",
            ModePackLoadOptions::untrusted_repository_local(),
        )
        .expect("untrusted structured MCP policy narrows");
        let policy = &snapshot.modes[0];

        assert!(!policy.permissions.mcp_tool_access);
        assert!(policy.mcp_access.is_empty());
    }

    #[test]
    fn rejects_unknown_or_duplicate_mcp_policy_entries() {
        let duplicate_tool = r#"{
          "name": "mcp-pack",
          "schema_version": 1,
          "mcp_servers": {
            "github": { "transport": "stdio", "command": "/bin/echo" }
          },
          "modes": [
            {
              "mode_id": "reviewer",
              "display_name": "Reviewer",
              "role_definition": "Duplicate MCP tools fail closed.",
              "permissions": {
                "read_only": false,
                "workspace_write": false,
                "process_exec": false,
                "network_access": false,
                "service_control": false,
                "destructive": false,
                "can_spawn_subtasks": false,
                "mcp_tool_access": true
              },
              "mcp": {
                "servers": [
                  { "id": "github", "tools": ["search", "search"] }
                ]
              }
            }
          ]
        }"#;
        let error = load_modepack_from_str(duplicate_tool, ".brownie/modepack.json")
            .expect_err("duplicate tool should fail")
            .to_string();
        assert!(error.contains("duplicate tool"));

        let unknown_server =
            duplicate_tool.replace("\"github\", \"tools\"", "\"missing\", \"tools\"");
        let error = load_modepack_from_str(&unknown_server, ".brownie/modepack.json")
            .expect_err("unknown server should fail")
            .to_string();
        assert!(error.contains("unknown MCP server"));
    }
}
