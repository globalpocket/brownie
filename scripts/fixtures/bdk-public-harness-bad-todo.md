# Bad TODO fixture

- [ ] E-99-bad-patch-target: Patch only `scripts/does-not-exist-for-bdk-public-harness.mjs` to demonstrate target precheck.
  Route: implementation.
  Source TODO: E-99-parent.
  Depends on: <none>.
  Completion condition: fixture should fail because the Patch only target is absent.
  Forbidden changes: do not modify unrelated files.
  Verification: run `pnpm --workspace-root guard:bdk-public-harness:test`.
