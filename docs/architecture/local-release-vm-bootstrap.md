# Local release VM bootstrap

Brownie release artifacts are intended to be built without depending on hosted
CI services. The Mac control host can use SSH to bootstrap and operate local
Linux and Windows VMs.

The VM bootstrap boundary is intentionally narrow:

- the target VM must already exist and accept SSH;
- target host aliases and workspaces are read from `.brownie/local-release-targets.json`;
- Brownie runs a fixed bootstrap flow, not arbitrary model-written SSH commands;
- generated artifacts and smoke evidence are collected by
  `release:local-artifacts:all`.

## One-time control-host manifest

Copy the example into ignored local state and edit host aliases/workspaces:

```sh
mkdir -p .brownie
cp docs/architecture/local-release-targets.example.json .brownie/local-release-targets.json
pnpm guard:local-release-targets
```

The default target ids are:

- `darwin-arm64`
- `linux-arm64`
- `linux-x64`
- `win32-x64`

## Create the Linux VM with Multipass

For Linux, Brownie can create the local VM from a pinned Multipass Ubuntu 24.04 LTS image:

```sh
pnpm release:linux-vm-create -- --dry-run
pnpm release:linux-vm-create
```

The script expects a Mac-side SSH public key at
`~/.ssh/brownie_release_runner.pub` by default. Override with:

```sh
pnpm release:linux-vm-create -- --ssh-key /path/to/key.pub
```

It updates `.brownie/local-release-targets.json` with:

```json
{
  "id": "linux-arm64",
  "kind": "ssh",
  "host": "brownie-linux",
  "workspace": "/home/ubuntu/brownie",
  "shell": "posix",
  "required": true
}
```

On Apple Silicon Macs, the Multipass VM is `linux-arm64`. Brownie can also use
that VM as a local Docker/QEMU smoke runner for `linux-x64` by adding a second
target:

```json
{
  "id": "linux-x64",
  "kind": "ssh",
  "host": "brownie-linux",
  "workspace": "/home/ubuntu/brownie",
  "shell": "posix",
  "container_platform": "linux/amd64",
  "required": true
}
```

## Bootstrap or re-bootstrap VMs

After the VMs are reachable over SSH:

```sh
pnpm release:vm-bootstrap -- --dry-run
pnpm release:vm-bootstrap
```

To bootstrap only one VM:

```sh
pnpm release:vm-bootstrap -- --target linux-x64
pnpm release:vm-bootstrap -- --target win32-x64
```

Create or register the Windows QEMU VM shell with:

```sh
pnpm release:windows-vm-create -- --dry-run --iso /path/to/Win11.iso
pnpm release:windows-vm-create -- --iso /path/to/Win11.iso
```

On Apple Silicon, use the official Windows 11 Arm64 ISO and the ARM64/HVF VM
path:

```sh
pnpm release:windows-vm-create -- \
  --vm-arch arm64 \
  --iso /path/to/Win11_Arm64.iso \
  --display vnc \
  --launch
```

The bootstrap script is idempotent. It installs or verifies the expected release
runner toolchain when possible, clones or updates the Brownie repository, checks
out the selected ref, installs pnpm dependencies, and runs the native artifact
builder. For targets with `container_platform`, it installs Docker/QEMU support,
cross-compiles a static `x86_64-unknown-linux-musl` binary, and smoke-tests it
inside a `linux/amd64` container.
For `win32-x64` on a Windows ARM64 runner, bootstrap also installs Visual Studio
Build Tools into `C:\BuildTools` when system package installation is enabled;
the artifact builder uses `x86_64-pc-windows-msvc` via `VsDevCmd.bat` and then
smoke-tests the x64 `brownie.exe` under Windows on Arm.

For Apple Silicon Windows runners, prepare networking before running bootstrap:
stage the VirtIO `NetKVM/w11/ARM64` driver from `virtio-win.iso`, relaunch the
VM with the generated `virtio-net-pci` NIC, then enable OpenSSH Server. If the
Windows Capability route for OpenSSH stalls, install the ARM64 MSI from the
official PowerShell/Win32-OpenSSH release and record the MSI SHA-256 in the VM
setup evidence.

```sh
pnpm --workspace-root run release:local-artifact
pnpm --workspace-root run release:linux-x64-docker-artifact
```

For validating local unmerged release automation against the VM, use:

```sh
pnpm release:vm-bootstrap -- --target linux-x64 --source local-copy
pnpm release:vm-bootstrap -- --target win32-x64 --source local-copy
```

`local-copy` copies the current Mac workspace state to the VM before running
the bootstrap script, so it can validate uncommitted release automation changes.
The copy excludes `.git`, `target`, `node_modules`, release evidence, and VM
disk state. POSIX targets use `rsync`; Windows targets use a local `tar.gz`
archive uploaded over SSH and extracted with PowerShell.

Use `--skip-system-packages` when package installation has already been handled
by a VM image or configuration management layer:

```sh
pnpm release:vm-bootstrap -- --skip-system-packages
```

## Build, collect, and verify artifacts

Once bootstrap succeeds:

```sh
pnpm release:local-artifacts:all
pnpm release:supply-chain-artifact-evidence
pnpm guard:supply-chain-artifact-evidence
```

Each VM writes a bounded evidence bundle under:

```text
.brownie/release-evidence/artifacts/<target>/
  brownie or brownie.exe
  SHA256SUMS
  artifact-evidence.json
  smoke-evidence.json
```

The control host collects those bundles and the supply-chain evidence collector
keeps Release Ready fail-closed until every required platform is present and
smoke-tested.
