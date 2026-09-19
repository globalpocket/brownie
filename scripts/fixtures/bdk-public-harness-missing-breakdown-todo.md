# Missing breakdown fixture

- [ ] E-99-missing-breakdown: Patch only `package.json` to demonstrate missing breakdown detection.
  Route: implementation.
  Source TODO: E-99-parent.
  Depends on: <none>.
  Completion condition: fixture should fail because the derived leaf is absent from the breakdown ledger.
  Forbidden changes: do not modify unrelated files.
  Verification: run `pnpm --workspace-root guard:bdk-public-harness:test`.
