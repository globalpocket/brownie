# Legacy `.brownie` Ledger Policy

## Problem

Brownie stores Runtime state under the workspace-local `.brownie/` directory.
During active Runtime development, ledger payload schemas can change rapidly.
Old local development ledgers may then fail current read/replay validation before
a new `brownie run` reaches task admission or the LLM provider.

This is distinct from a release durability guarantee. Release compatibility must
cover supported persisted store schemas and explicitly registered ledger payload
envelope versions. It does not require every pre-release scratch `.brownie/`
directory produced during schema churn to remain a live execution source.

## Classification

Treat workspace `.brownie/` state as one of three classes:

1. Current live state
   - Created by the current Runtime schema.
   - May be used for resume, replay, phase-loop execution, and acceptance
     evidence.

2. Supported legacy release state
   - Created by a released or explicitly supported pre-release migration fixture.
   - Must be migrated, replayed, or failed closed with a deterministic recovery
     reason.
   - Compatibility must be covered by tests and the protocol/store compatibility
     registry.

3. Unsupported development scratch state
   - Created by old local development builds before the current schema contract
     stabilized.
   - Must not block unrelated new task admission.
   - Must not be silently trusted, rewritten, or used as release evidence.
   - May be deleted when it is retained only for obsolete local compatibility
     and the operator has decided it is no longer useful.

Do not remove compatibility code, fixtures, or ledger artifacts that exist to
preserve an actual Brownie feature such as release migration, resume/replay,
ModePack policy evidence, permission enforcement, or workspace mutation
recovery. Those are feature-derived compatibility surfaces, not disposable
legacy scratch.

## Runtime Policy

The Runtime should fail closed for an invalid run ledger when that ledger is the
target of a resume, replay, inspection, or recovery operation.

The Runtime should not fail global task admission merely because an unrelated
historical run under `.brownie/runs/` is no longer readable by the current
payload schema. New task admission should depend only on current store manifests,
active locks, selected task/run records, and the specific records needed for the
requested operation.

If a global scan encounters an unreadable historical run, it should surface a
bounded diagnostic and continue when the requested operation does not depend on
that run.

## Phase-Loop Policy

The Brownie phase-loop controller should use an explicit state root.

Recommended local development layout:

- Repository source: `/Users/satoshitanaka/Documents/brownie`
- Brownie phase-loop live workspace/state: configured with
  `PHASE_LOOP_WORKSPACE_ROOT`
- Phase-loop supervisor logs/status: `.brownie-phase-loop/`
- LAN LLM credentials: `phase-loop.env` or `.test/brownie-loop.env`, both ignored
  by git

For trial or smoke runs, use an isolated workspace root so old repo-local
development ledgers cannot affect the result.

For production-like repository mutation runs, either:

- start from a clean/current `.brownie/` state created by the current Runtime, or
- archive the old development `.brownie/` directory outside the live workspace
  before starting the loop.

Do not delete old `.brownie/` state when it may contain useful debugging
evidence. Prefer moving it to a timestamped ignored archive first. Once the
state is confirmed to be obsolete compatibility-only scratch, the archive may be
deleted.

## Archive Procedure

When old local state blocks new phase-loop admission and is not needed as the
target of a resume/replay operation:

1. Stop any running Brownie phase-loop supervisor.
2. Move `.brownie/` to an ignored timestamped archive path such as
   `.brownie-archive/20260906T000000Z.brownie/`.
3. Start Brownie again so the current Runtime creates a fresh `.brownie/`.
4. Keep the archive out of git.

The archive is forensic evidence only. It is not a release compatibility fixture
unless copied into an explicit test fixture and covered by a migration/replay
test. If it is kept only for lower-version local scratch compatibility and no
longer has diagnostic value, it may be removed.

## Implemented Code Follow-Up

The observed failure mode showed that new `brownie run --file phase-loop.md`
could fail before useful work because a historical run ledger failed validation
during completion candidate scanning. The Runtime corrective is:

- skip unreadable unrelated completed-run ledgers only while scanning completion
  candidates;
- preserve fail-closed behavior for direct inspection/resume/replay of that
  invalid run;
- keep the existing behavior where the newest readable completed task without
  terminal completion evidence does not fall back to stale older evidence;
- cover the behavior with a focused regression test.
