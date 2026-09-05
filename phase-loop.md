# Brownie Phase Loop

Run one bounded development step for `globalpocket/brownie`.

Goal: advance Brownie Runtime toward technical Release Ready while keeping `runtime_release_ready=false`.

Current priority: close `runtime-release-guard-ci` by improving repository-local CI/release-gate evidence. Do not claim full release readiness, publish, tag, change license, or create release assets.

Immediate step: update `.github/workflows/ci.yml` so CI directly runs the local release-gate dry-run.

`pnpm --workspace-root release:gate -- --dry-run`

Place the step after `pnpm install` and before VSIX check/test/build.

Do not start by reading files in this trial run. The required replacement content is below. Your first tool request should be `workspace.write` with `operation: replace_file`, `path: .github/workflows/ci.yml`, and this exact content:

name: CI

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Cargo check
        run: cargo check --workspace

      - name: Cargo test
        run: cargo test --workspace

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Enable Corepack
        run: corepack enable

      - name: Install pnpm dependencies
        run: pnpm install

      - name: Release gate dry-run
        run: pnpm --workspace-root release:gate -- --dry-run

      - name: Diagnostics guard
        run: pnpm guard:diagnostics

      - name: Phase value guard
        run: pnpm guard:phase-value

      - name: Phase value guard tests
        run: pnpm guard:phase-value:test

      - name: VSIX check
        run: pnpm --filter brownie-vsix check

      - name: VSIX test
        run: pnpm --filter brownie-vsix test

      - name: VSIX build
        run: pnpm --filter brownie-vsix build

  index-platform:
    runs-on: windows-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Verify unsupported index platform fails closed
        run: cargo test -p brownie-indexer unsupported_platform_fails_closed

After editing, run focused verification if available:

- `pnpm --workspace-root guard:release-contract:test`
- `pnpm --workspace-root guard:runtime-release-readiness`

Safety: Rust Runtime remains authority. CLI/VSIX stay thin. Separate `AccessNetwork` from `AccessLlmProvider`. GitHub operations should use approved MCP/tooling; do not add bespoke GitHub APIs. Do not ledger raw secrets, raw prompts, full provider responses, absolute paths, file contents, environment values, or process output.

Stop after one concrete edit, one focused verification, or a clear blocker.
