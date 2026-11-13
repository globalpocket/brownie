//! Nonmutating store access for summary-only inspection RPCs.

use super::{
    durable_schema_manifest_is_current, validate_current_durable_schema_manifest, BrownieStore,
    TaskStore,
};
use anyhow::{bail, Result};

impl BrownieStore {
    /// Inspect existing state without initializing schema, migrating or recovering it.
    /// Missing task data remain missing; callers retain their normal not-found errors.
    pub fn for_read_only_inspection_from_env_or_cwd() -> Result<Self> {
        let mut task_store = TaskStore::new(Self::workspace_root_from_env_or_cwd()?);
        task_store.inspection_only = true;
        task_store.ensure_schema_for_read()?;
        Ok(Self { task_store })
    }
}

impl TaskStore {
    pub(super) fn ensure_schema_for_read(&self) -> Result<()> {
        if !self.inspection_only {
            self.ensure_durable_schema()?;
            return Ok(());
        }
        match self.read_durable_schema_manifest()? {
            Some(manifest) => {
                if !durable_schema_manifest_is_current(&manifest)? {
                    bail!("durable schema migration is required before read-only inspection");
                }
                validate_current_durable_schema_manifest(self, &manifest)?;
            }
            None if self.runs_dir().exists() => {
                bail!("existing task data require a valid durable schema before inspection");
            }
            None => {}
        }
        Ok(())
    }
}
