# Runtime Documentation Golden Path

This document is the human-readable path for reproducing Brownie Runtime
Product Ready evidence from a clean checkout. It explains which repository-local
commands generate or validate evidence, where that evidence is stored, and how
to interpret the current fail-closed release judgment.

It does not claim `runtime_release_ready=true`. Release readiness remains a
computed judgment from the release contract, readiness audit, and generated
evidence.

## Scope

The golden path covers Runtime-owned release evidence:

- release gate command inventory and dry-run validation;
- local VM / artifact lifecycle evidence;
- runtime operational evidence, including the Golden Journey fixture;
- supply-chain, artifact, checksum, SBOM, provenance, and integrity evidence;
- owner-governance fail-closed evidence;
- final readiness judgment inputs.

Tracked BDK expansion, enterprise product work, and owner-only publication
decisions are documented in `todo.md` and in the release contract, but they are
not Runtime implementation work by themselves.

## Prerequisites

Start from a clean checkout of the repository and install dependencies:

```bash
pnpm install --frozen-lockfile
```

For full local artifact lifecycle evidence, the configured local release targets
must also be available. The repository-local target schema and example are:

- `docs/architecture/local-release-targets.schema.json`
- `docs/architecture/local-release-targets.example.json`

The local manifest is `.brownie/local-release-targets.json`. A clean checkout
does not contain this file. Create it from the example, then edit host names,
workspaces, and target details for the local macOS/Linux/Windows machines:

```bash
mkdir -p .brownie
cp docs/architecture/local-release-targets.example.json .brownie/local-release-targets.json
$EDITOR .brownie/local-release-targets.json
pnpm --workspace-root guard:local-release-targets
```

Bootstrap or refresh the configured VMs before collecting cross-platform
artifact evidence:

```bash
pnpm --workspace-root release:vm-bootstrap
```

If a VM image has not yet been created or restored on the host, use the VM image
lifecycle commands documented by `release:linux-vm-create`,
`release:windows-vm-create`, and `release:vm-image` before bootstrap.

VM-private state, credentials, and machine-local runtime state belong under
`.brownie/private/` and must not be committed.

## Step 1: Inspect the release contract and readiness audit

The primary judgment inputs are:

- `docs/architecture/runtime-release-contract.json`
- `docs/architecture/runtime-release-readiness-audit.json`

Validate them with:

```bash
pnpm --workspace-root guard:runtime-release-readiness
pnpm --workspace-root guard:release-contract
```

The release contract's `runtime_release_ready` field is authoritative only when
the guards and evidence agree. A false value is expected while any release
blocking evidence remains incomplete or fail-closed.

## Step 2: Review the release gate inventory

The release gate lists the commands required for a full Runtime release
qualification. To inspect the gate without executing the heavy release commands,
run:

```bash
pnpm --workspace-root release:gate -- --dry-run
```

The dry run is itself checked by the release contract guard. It is a command
inventory and policy check, not a substitute for running every release evidence
collector.

## Step 3: Generate or refresh local release artifacts

When the local macOS, Linux, and Windows release targets are available, generate
artifacts with:

```bash
pnpm --workspace-root release:local-artifacts:all
```

Single-target generation is available with:

```bash
pnpm --workspace-root release:local-artifact -- --target <target>
```

Linux x64 Docker-backed generation is available through:

```bash
pnpm --workspace-root release:linux-x64-docker-artifact -- --platform linux/amd64 --target linux-x64
```

Artifact evidence is written under:

- `.brownie/release-evidence/artifacts/darwin-arm64/`
- `.brownie/release-evidence/artifacts/linux-arm64/`
- `.brownie/release-evidence/artifacts/linux-x64/`
- `.brownie/release-evidence/artifacts/win32-x64/`

Each artifact directory records the built binary, `artifact-evidence.json`,
`smoke-evidence.json`, and checksums when generated.

## Step 4: Generate release evidence

`release:runtime-operational-evidence` currently exercises the debug CLI at
`target/debug/brownie` for its Golden Journey fixture. Build that binary before
collecting runtime operational evidence:

```bash
cargo build -p brownie-cli --bin brownie -p brownie-runtime --bin brownie-runtime
```

Then refresh the repository-local evidence files with:

```bash
pnpm --workspace-root release:dependency-security-license-audit
pnpm --workspace-root release:supply-chain-artifact-evidence
pnpm --workspace-root release:runtime-operational-evidence
pnpm --workspace-root release:integrity-verify
pnpm --workspace-root release:owner-governance-evidence
```

The main evidence files are:

- `.brownie/release-evidence/dependency-security-license-audit.json`
- `.brownie/release-evidence/supply-chain-artifact-evidence.json`
- `.brownie/release-evidence/runtime-operational-evidence.json`
- `.brownie/release-evidence/integrity-verification.json`
- `.brownie/release-evidence/owner-governance-evidence.json`

Supply-chain evidence also records:

- `.brownie/release-evidence/brownie-runtime-sbom.json`
- `.brownie/release-evidence/brownie-runtime-provenance.json`
- `.brownie/release-evidence/SHA256SUMS`

## Step 5: Verify the Golden Journey fixture

Runtime operational evidence includes the Golden Journey fixture under:

- `.brownie/release-evidence/golden-journey-fixture/README.md`
- `.brownie/release-evidence/golden-journey-fixture/objective.md`
- `.brownie/release-evidence/golden-journey-fixture/golden-journey-output.md`

The fixture is valid only when runtime operational evidence observes the complete
bounded lifecycle:

1. objective proposal preflight;
2. proposal apply;
3. post-apply verification;
4. workspace mutation;
5. completion.

Validate the operational evidence with:

```bash
pnpm --workspace-root guard:runtime-operational-evidence
pnpm --workspace-root guard:runtime-operational-evidence:test
```

## Step 6: Verify owner-governance evidence

Owner-governance evidence records settings and decisions that Runtime automation
can check but must not silently self-authorize. Validate it with:

```bash
pnpm --workspace-root guard:owner-governance-evidence
pnpm --workspace-root guard:owner-governance-evidence:test
```

Owner-governance evidence may still remain fail-closed for owner/external
reasons such as independent review completion or remote CI provenance. Those
fail-closed reasons should be recorded as owner/external evidence and not
misclassified as Runtime implementation defects.

## Step 7: Run the standard check path

Run the repository's normal check path:

```bash
pnpm --workspace-root check
```

This invokes the VSIX check path and the guarded Brownie release checks wired
into it. Passing `check` means the current repository-local guard suite accepts
the current evidence and contracts; it does not by itself override explicit
fail-closed release fields.

## Step 8: Interpret the final readiness judgment

The final Product Ready judgment must read these inputs together:

- `docs/architecture/runtime-release-contract.json`
- `docs/architecture/runtime-release-readiness-audit.json`
- `.brownie/release-evidence/runtime-operational-evidence.json`
- `.brownie/release-evidence/supply-chain-artifact-evidence.json`
- `.brownie/release-evidence/owner-governance-evidence.json`

Set or accept `runtime_release_ready=true` only when every release-blocking
Runtime-owned condition is satisfied by current evidence and owner/external
fail-closed reasons are resolved or explicitly accepted by the release policy.
Until then, keep the release contract fail-closed and describe remaining
blockers in the relevant evidence files.
