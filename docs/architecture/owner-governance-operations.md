# Owner Governance Operations

This runbook separates implementation automation from owner review and release
authority. It is part of Brownie's fail-closed release governance surface.

## Actor model

| Responsibility | GitHub actor |
| --- | --- |
| Brownie Phase Loop implementation PR author / pusher | `brownie-agent` |
| Codex review, approval, merge, and owner governance operation | `globalpocket` |

The implementation actor and review actor must remain distinct for release
evidence. A review by the implementation actor is not independent review
evidence.

## Main branch protection

`main` should keep:

- required pull request review count of at least 1;
- stale review dismissal;
- last-pusher approval;
- required status checks for `check` and `index-platform`;
- enforced admins;
- force-push denial;
- deletion denial;
- conversation resolution where available.

If a protected operation cannot proceed because Codex and the owner account are
temporarily collapsed into the same GitHub actor, use this bounded exception
process:

1. Confirm required checks are green and the PR is otherwise mergeable.
2. Record why the actor model collapsed and which branch protection setting is
   being relaxed.
3. Relax only the minimum setting required for the bounded operation.
4. Complete the bounded operation.
5. Immediately restore the original setting.
6. Re-read branch protection and record the restored state.

Do not remove branch protection wholesale to bypass a single PR.

## Protected tag policy

Release tags should use a protected tag or ruleset pattern such as `v*`.
Protected release tags must not be overwritten or deleted as part of normal
release automation.

Before a release tag is accepted as governance evidence, owner-governance
evidence must record a positive protected-tag ruleset count and the release
contract must remain fail-closed if that evidence is unavailable.

## Integrity authority

Brownie's interim integrity authority is owner-approved protected-ref,
remote-CI-provenance, SHA256SUMS, and local checksum verification. It remains an
interim mechanism until stronger artifact signing is introduced.

Release evidence must bind:

- source commit;
- protected branch or protected release tag;
- successful remote CI run;
- generated release evidence or artifacts;
- SHA-256 checksums;
- local checksum verification result;
- owner-approved integrity authority decision.

Checksums alone are not a signature and do not prove release authorization.

## Independent review evidence

Independent review evidence must be verified through GitHub review provenance.
The required review scopes are:

- release workflow;
- permission model;
- Ledger Contract;
- Mode Pack trust boundary;
- signing or integrity provenance;
- Release Ready judgment.

Static review text is not sufficient by itself. The owner-governance evidence
collector must verify pull request number, review id, reviewer, implementation
PR author, reviewed commit SHA, state, and submission timestamp against GitHub.

## OSS posture

Brownie currently uses Apache-2.0. Acceptable use, security reporting, trademark
guidance, and contribution rules are documented separately:

- `LICENSE`
- `SECURITY.md`
- `ACCEPTABLE_USE.md`
- `TRADEMARK.md`
- `CONTRIBUTING.md`

Public publication remains owner-gated until release artifacts, smoke tests,
integrity evidence, and independent reviews are complete.

