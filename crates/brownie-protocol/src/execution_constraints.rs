//! Generic task-local restrictions. These restrict, and never grant, authority.
//! Paths are exact normalized workspace-relative paths, not glob patterns.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TaskExecutionConstraints {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read_paths: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub write_paths: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub denied_read_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub denied_write_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub write_operations: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_workspace_reads: Option<u32>,
    #[serde(default)]
    pub requires_workspace_write_proposal: bool,
}

impl TaskExecutionConstraints {
    /// Call before persistence and after loading. Invalid constraints fail closed
    /// in the predicates as well, including values constructed directly in Rust.
    pub fn validate(&self) -> Result<(), &'static str> {
        for paths in [
            self.read_paths.as_deref(),
            self.write_paths.as_deref(),
            Some(self.denied_read_paths.as_slice()),
            Some(self.denied_write_paths.as_slice()),
        ]
        .into_iter()
        .flatten()
        {
            if paths.len() > 128 {
                return Err("task constraint path list exceeds its bound");
            }
            let mut seen = BTreeSet::new();
            for path in paths {
                if !normalized_relative_path(path) {
                    return Err("task constraints require exact normalized relative paths");
                }
                if !seen.insert(path) {
                    return Err("task constraint path list contains duplicates");
                }
            }
        }
        if let Some(operations) = &self.write_operations {
            let mut seen = BTreeSet::new();
            if operations.len() > 3
                || operations
                    .iter()
                    .any(|operation| !known_write_operation(operation) || !seen.insert(operation))
            {
                return Err("task constraints require distinct supported write operations");
            }
        }
        Ok(())
    }

    /// The caller must still enforce mode permissions and filesystem admission.
    pub fn allows_read(&self, path: &str) -> bool {
        self.validate().is_ok()
            && normalized_relative_path(path)
            && !self.denied_read_paths.iter().any(|denied| denied == path)
            && self
                .read_paths
                .as_ref()
                .is_none_or(|paths| paths.iter().any(|allowed| allowed == path))
    }

    /// The caller must still enforce mode permissions, approval and preflight.
    pub fn allows_write(&self, path: &str, operation: &str) -> bool {
        self.validate().is_ok()
            && normalized_relative_path(path)
            && known_write_operation(operation)
            && !self.denied_write_paths.iter().any(|denied| denied == path)
            && self
                .write_paths
                .as_ref()
                .is_none_or(|paths| paths.iter().any(|allowed| allowed == path))
            && self
                .write_operations
                .as_ref()
                .is_none_or(|operations| operations.iter().any(|allowed| allowed == operation))
    }

    pub fn read_budget_exhausted(&self, completed_reads: u64) -> bool {
        self.validate().is_err()
            || self
                .max_workspace_reads
                .is_some_and(|limit| completed_reads >= u64::from(limit))
    }
}

fn known_write_operation(operation: &str) -> bool {
    matches!(operation, "create_file" | "replace_file" | "patch_file")
}

fn normalized_relative_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 2048
        && !path
            .chars()
            .any(|ch| ch.is_control() || matches!(ch, '\\' | ':' | '*' | '?' | '[' | ']'))
        && path
            .split('/')
            .all(|component| !component.is_empty() && !matches!(component, "." | ".."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn exact_scope_and_operation_intersect_and_explicit_denial_wins() {
        let constraints: TaskExecutionConstraints = serde_json::from_value(json!({
            "read_paths": ["notes.txt", "private.txt"],
            "write_paths": ["notes.txt", "private.txt"],
            "denied_read_paths": ["private.txt"],
            "denied_write_paths": ["private.txt"],
            "write_operations": ["patch_file"]
        }))
        .unwrap();
        assert!(constraints.allows_read("notes.txt"));
        assert!(constraints.allows_write("notes.txt", "patch_file"));
        assert!(!constraints.allows_read("private.txt"));
        assert!(!constraints.allows_write("private.txt", "patch_file"));
        assert!(!constraints.allows_write("notes.txt", "replace_file"));
        assert!(!constraints.allows_write("other.txt", "patch_file"));
        assert!(!constraints.allows_read("notes.txt/other.txt"));
    }

    #[test]
    fn empty_scope_denies_every_path_and_zero_budget_denies_first_read() {
        let constraints = TaskExecutionConstraints {
            read_paths: Some(vec![]),
            write_paths: Some(vec![]),
            max_workspace_reads: Some(0),
            ..Default::default()
        };
        assert!(constraints.validate().is_ok());
        assert!(!constraints.allows_read("notes.txt"));
        assert!(!constraints.allows_write("notes.txt", "patch_file"));
        assert!(constraints.read_budget_exhausted(0));
    }

    #[test]
    fn budget_has_an_exact_boundary_and_survives_serialization() {
        let constraints = TaskExecutionConstraints {
            max_workspace_reads: Some(2),
            requires_workspace_write_proposal: true,
            ..Default::default()
        };
        let restored: TaskExecutionConstraints =
            serde_json::from_slice(&serde_json::to_vec(&constraints).unwrap()).unwrap();
        assert_eq!(restored, constraints);
        assert!(!restored.read_budget_exhausted(1));
        assert!(restored.read_budget_exhausted(2));
        assert!(restored.read_budget_exhausted(u64::MAX));
    }

    #[test]
    fn traversal_aliases_absolute_paths_and_globs_cannot_widen_scope() {
        for path in [
            "",
            "/notes.txt",
            "../notes.txt",
            "a/../notes.txt",
            "./notes.txt",
            "a//b",
            "a/",
            "C:/notes.txt",
            "a\\b",
            "*.txt",
            "a\0b",
        ] {
            let constraints = TaskExecutionConstraints {
                write_paths: Some(vec![path.into()]),
                ..Default::default()
            };
            assert!(constraints.validate().is_err(), "{path:?}");
            assert!(!constraints.allows_write(path, "patch_file"));
            assert!(!constraints.allows_read("notes.txt"));
        }
    }

    #[test]
    fn rejects_unknown_fields_negative_budgets_duplicate_paths_and_operations() {
        for value in [
            json!({"override_mode_permissions": true}),
            json!({"max_workspace_reads": -1}),
            json!({"max_workspace_reads": 1.5}),
        ] {
            assert!(serde_json::from_value::<TaskExecutionConstraints>(value).is_err());
        }
        for value in [
            json!({"read_paths": ["notes.txt", "notes.txt"]}),
            json!({"write_operations": ["patch_file", "patch_file"]}),
            json!({"write_operations": ["delete_file"]}),
        ] {
            let constraints: TaskExecutionConstraints = serde_json::from_value(value).unwrap();
            assert!(constraints.validate().is_err());
            assert!(!constraints.allows_write("notes.txt", "patch_file"));
        }
    }

    #[test]
    fn bounds_lists_and_path_lengths_without_revealing_path_content() {
        for paths in [
            vec!["x".repeat(2049)],
            (0..129).map(|i| format!("file-{i}")).collect(),
        ] {
            let constraints = TaskExecutionConstraints {
                read_paths: Some(paths),
                ..Default::default()
            };
            assert!(constraints.validate().is_err());
        }
    }
}
