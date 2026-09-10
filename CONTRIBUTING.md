# Contributing to Brownie

Brownie is pre-release software. Contributions should preserve the Runtime
authority boundary, durable ledger guarantees, and owner-governance release
gates.

## Pull request rules

- Keep implementation changes scoped to one reviewable concern.
- Run the relevant local checks before opening or updating a pull request.
- Do not commit machine-local credentials, VM disks, VM images, private GitHub
  auth state, or release scratch state. Private state belongs under
  `.brownie/private/`.
- Update release-readiness evidence, semantic contracts, or guard assessments
  when a guarded source file changes and the guard requires a refreshed
  fingerprint.

## Brownie Phase Loop actor separation

Brownie Phase Loop implementation work is expected to use:

- implementation actor: `brownie-agent`
- review actor: `globalpocket`
- merge actor: `globalpocket`

Implementation PRs should be authored and pushed by `brownie-agent`. Review and
merge should be performed by `globalpocket` after required checks pass.

Before implementation pushes, run:

```sh
pnpm --workspace-root phase-loop:implementation-preflight
```

Before review or merge automation, run:

```sh
pnpm --workspace-root phase-loop:review-preflight
```

`main` should keep required pull request review, last-pusher approval, required
status checks, enforced admins, force-push denial, deletion denial, and
conversation resolution enabled. If actor collapse makes a one-off operation
impossible, any branch-protection relaxation must be explicit, temporary,
recorded, and restored immediately.

## Security-sensitive changes

Changes to permission enforcement, controlled tool execution, ledger replay or
schema validation, release evidence, GitHub governance, Mode Pack trust, or
artifact integrity are security-sensitive. They require:

- focused review;
- relevant guard/test execution;
- updated owner-governance or release-readiness evidence when guard output
  changes;
- no self-approval as release evidence.

## Release evidence

Do not claim Release Ready from static documentation alone. Release evidence must
come from executable checks, guarded evidence files, verified GitHub review
provenance, protected ref/tag policy, and owner-approved integrity authority or
stronger artifact signing.

