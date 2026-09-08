# Local release VM images

Brownie release runners should avoid hosted CI dependency where practical. The
preferred local setup is:

- Linux arm64: Canonical Multipass Ubuntu 24.04 LTS image.
- Linux x64: the local Linux arm64 VM cross-compiles a static
  `x86_64-unknown-linux-musl` binary and smoke-tests it with Docker/QEMU
  `linux/amd64` container execution, or uses a project-owned x64 VM when
  available.
- Windows: Microsoft official Windows 11 ISO, activated with the owner-provided
  Windows 11 Pro license, then converted into a local golden image or snapshot.
  On Apple Silicon, use the official Windows 11 Arm64 ISO, QEMU/HVF, and
  VirtIO networking with the `NetKVM/w11/ARM64` driver staged from
  `virtio-win.iso`.

The golden image boundary is:

- include OS activation where applicable, SSH reachability, Git, Node.js,
  pnpm/Corepack, Rust, Visual Studio Build Tools for Windows ARM64-to-x64
  release runners, and any local Docker/VM control tooling needed by the runner;
- exclude generated release artifacts, release evidence, release tags,
  temporary tokens, and fixed Brownie checkout state.

After restoring an image, run:

```sh
pnpm release:vm-bootstrap
pnpm release:local-artifacts:all
pnpm release:supply-chain-artifact-evidence
pnpm guard:supply-chain-artifact-evidence
```

## Manage local golden images

Brownie provides a narrow local image-management command for release runners:

```sh
pnpm release:vm-image -- --action status
pnpm release:vm-image -- --action shutdown
pnpm release:vm-image -- --action snapshot
pnpm release:vm-image -- --action start
```

The snapshot action is intentionally conservative:

- Linux uses a named Multipass snapshot and stops the instance first because
  Multipass only snapshots stopped instances.
- Windows refuses to copy the `qcow2` while QEMU is still running. Shut the VM
  down first, then snapshot the disk, EDK2 variable store, and TPM state into
  ignored local state under `.brownie/private/vm-images/windows/<snapshot>/`.
- Restore remains an owner-controlled operation because it replaces VM disk
  state. Copy the selected snapshot directory back into `.brownie/private/vms/...`
  only while the VM is stopped, then rerun bootstrap and release evidence
  checks.

## Linux image source

Use Multipass with the pinned Ubuntu 24.04 LTS image unless a release-specific target
requires a different Linux distribution:

```sh
pnpm release:linux-vm-create -- --dry-run
pnpm release:linux-vm-create
```

The script creates or validates a `brownie-linux` VM, configures SSH access for
the current Mac user key, and updates `.brownie/local-release-targets.json` with
the native Linux arm64 target. Add a `linux-x64` target with
`container_platform: "linux/amd64"` to use the same VM as a Docker/QEMU x64
runner.

## Windows image source

Use a Microsoft official Windows 11 ISO and the purchased Windows 11 Pro
license. After initial installation and activation:

1. enable OpenSSH Server;
2. create or select the release runner user;
3. add the Mac control-host SSH public key to that user's
   `authorized_keys`;
4. install Git, Node.js LTS, Rustup, and pnpm/Corepack;
5. on Windows ARM64 runners, install Visual Studio Build Tools or let
   `release:vm-bootstrap` install it into `C:\BuildTools`;
6. verify Mac SSH access through the `brownie-windows` host alias;
7. snapshot the VM as the Windows golden image.

When Windows Capability installation for OpenSSH is unreliable, install the
official PowerShell/Win32-OpenSSH ARM64 MSI inside the VM and record the MSI
version and SHA-256 as part of the golden-image setup evidence.

Then let Brownie re-bootstrap repository state and generated release evidence.

Create the reusable Windows golden image after SSH, networking, OpenSSH, toolchain
bootstrap, Visual Studio Build Tools, and artifact smoke tests have succeeded:

```sh
pnpm release:vm-image -- --action shutdown --target windows
pnpm release:vm-image -- --action snapshot --target windows
pnpm release:vm-image -- --action start --target windows
```

## Why not use arbitrary public Windows VM images?

Linux cloud images are routinely published for local VM use by distribution
owners. Windows VM images should be treated more cautiously for this project:
use Microsoft-provided installation media or evaluation media only, then build a
project-owned golden image. This keeps licensing, provenance, and supply-chain
trust easier to explain for release evidence.
