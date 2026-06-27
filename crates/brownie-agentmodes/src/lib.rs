//! AgentModes compatibility crate.

use serde::{Deserialize, Serialize};

pub const COMPATIBILITY_TARGET: &str = "AgentModes";
pub const DEFAULT_MODE_ID: &str = "orchestrator";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CompiledModePolicy {
    pub mode_id: String,
    pub display_name: String,
    pub role_definition: String,
    pub permissions: ModePermissions,
    pub completion_rules: Vec<String>,
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
}

pub struct BuiltinModeRegistry;

impl BuiltinModeRegistry {
    pub fn list() -> Vec<CompiledModePolicy> {
        vec![orchestrator(), implementer(), verifier()]
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
) -> ModePermissions {
    ModePermissions {
        read_only: !workspace_write,
        workspace_write,
        process_exec,
        network_access: false,
        service_control: false,
        destructive: false,
        can_spawn_subtasks,
    }
}

fn orchestrator() -> CompiledModePolicy {
    CompiledModePolicy {
        mode_id: DEFAULT_MODE_ID.to_string(),
        display_name: "Orchestrator".to_string(),
        role_definition:
            "Coordinate task planning without direct workspace writes or process execution."
                .to_string(),
        permissions: permissions(false, false, true),
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
        permissions: permissions(true, true, false),
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
        permissions: permissions(false, true, false),
        completion_rules: vec![
            "Stop after reporting verification status and relevant failures.".to_string(),
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
        assert_eq!(ids, vec!["orchestrator", "implementer", "verifier"]);
    }

    #[test]
    fn builtin_registry_resolves_default_orchestrator() {
        let policy = BuiltinModeRegistry::default_policy();
        assert_eq!(policy.mode_id, "orchestrator");
        assert!(!policy.permissions.workspace_write);
        assert!(!policy.permissions.process_exec);
        assert!(policy.permissions.can_spawn_subtasks);
    }

    #[test]
    fn builtin_registry_unknown_returns_none() {
        assert_eq!(BuiltinModeRegistry::get("unknown-mode"), None);
    }
}
