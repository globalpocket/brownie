# BDK Agent Skills adapter

This document is the architecture home for Brownie BDK compatibility with
public Agent Skills-style workflow packages.

## Goal

Brownie BDK should reuse public Agent Skills-style workflow packages instead of
growing a closed, Brownie-only workflow library. A skill package is treated as a
portable workflow bundle whose primary authority is a `SKILL.md` file plus
optional references, assets, and scripts. Brownie may learn workflow shape from
the skill, but Brownie policy, Runtime permissions, and owner instructions
remain higher authority.

The adapter is intentionally not a replacement for Brownie Runtime. It is a BDK
workflow layer that helps the phase loop choose an appropriate workflow branch
before invoking the Runtime:

1. classify the selected TODO;
2. choose a locked skill or built-in Brownie workflow;
3. build a bounded BDK Control Packet;
4. execute through Brownie Runtime or an approved external tool adapter;
5. record trajectory and evidence;
6. verify completion with Brownie guards.

## Skill discovery

The adapter discovers skills from explicit, pinned sources only. Discovery may
include:

- repository-local skills under a future audited `.brownie/skills/` directory;
- user-installed skills exposed by Codex or another Agent Skills-compatible
  runtime;
- external Git sources pinned by immutable revision and content hash;
- Brownie built-in workflows represented with the same metadata shape.

Discovery must never mean "search the internet and execute what was found".
Unpinned public skills may be proposed as candidates, but they remain inactive
until an owner-approved lock entry is added.

## Lockfile

The durable source of skill supply-chain authority is a future
`.brownie/skills.lock.json` file validated by
`docs/architecture/bdk-agent-skills-lock.schema.json` and
`scripts/guard-bdk-agent-skills.mjs`.

Each lock entry must record:

- `id`: stable skill id used by the BDK router;
- `source.type`: `local`, `git`, `codex`, or `builtin`;
- `source.uri`: local path, Git URL, or runtime skill id;
- `source.revision`: immutable revision, version, or local fingerprint;
- `content_hash`: digest of the resolved `SKILL.md` and required resources;
- `permissions.allowed_tools`: exact tool families the skill may request;
- `permissions.script_execution`: `forbidden`, `review_required`, or
  `allowed`;
- `review.status`: `approved`, `pending`, or `rejected`;
- `policy.brownie_policy_overrides_skill`: always `true`.

If a skill changes upstream, Brownie must treat it as a new candidate until the
lock entry is reviewed and repinned.

## Permission manifest

Skills do not grant permissions. A skill may request capabilities, but BDK must
intersect those requests with:

1. user instructions for the current task;
2. Brownie Runtime permissions;
3. repository policy and `.brownie/private/` secrecy rules;
4. the lock entry's `allowed_tools`;
5. the selected TODO's bounded `Patch only` / `Create only` scope.

Scripts bundled with a public skill default to `forbidden`. They become
available only when the lock entry explicitly permits script execution and the
Runtime/tool adapter can enforce the same filesystem and network boundaries.

## Router inputs

The BDK Skill Router should receive structured inputs instead of free-form
prompt prose:

- selected TODO id, first line, route, dependency state, and bounded target
  paths;
- current no-progress classification and repair feedback;
- previous trajectory events for the active claim;
- available locked skills and their tags;
- runtime permission envelope;
- required verification commands.

The router output is a small decision:

```json
{
  "skill_id": "code.patch-existing-symbol",
  "reason": "selected TODO patches one existing test helper",
  "mode": "runtime_controlled",
  "allowed_targets": ["scripts/guard-runtime-operational-evidence.test.mjs"]
}
```

If no locked skill fits, the router must choose a Brownie built-in fallback such
as `todo.decompose`, `code.read-before-edit`, `documentation.patch-existing-doc`,
or `recovery.replan`.

## Execution sandbox boundaries

The adapter never executes a public skill directly. It converts the selected
skill into a bounded BDK Control Packet and lets Brownie Runtime or an approved
adapter enforce execution. The Runtime may read skill instructions, but
workspace writes still go through Brownie's normal permission and verification
path.

Public skill instructions are lower priority than:

1. user instructions;
2. system/developer policy;
3. Brownie Runtime permissions;
4. repository guardrails;
5. selected TODO bounds.

Any conflict is resolved by ignoring the skill instruction and recording a
policy override event.

## Evidence and trajectory outputs

Every skill-routed run should emit trajectory events that can be replayed and
evaluated:

- `skill.discovered`
- `skill.lock_validated`
- `skill.selected`
- `skill.policy_intersection`
- `runtime.invoked`
- `workspace.patch_proposed`
- `verification.run`
- `todo.completed` or `todo.replanned`

Release evidence must not store raw local paths, raw stdout/stderr, credentials,
or unredacted skill resources. Skill evidence records should contain hashes,
skill ids, policy decisions, verification summaries, and fail-closed reasons.

## First migration path

The first production slice is deliberately small:

1. document the adapter contract in this file;
2. add `docs/architecture/bdk-agent-skills-lock.schema.json`;
3. add `scripts/guard-bdk-agent-skills.mjs` and tests;
4. wire package scripts for the guard;
5. add future TODOs for router integration once the lock format is guarded.

This avoids trusting public skills before Brownie can pin, review, and validate
them.
