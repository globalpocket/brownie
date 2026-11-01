import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { attestHistoricalDerivedDelivery } from './phase-loop-historical-derived-delivery-attestation.mjs';
import { durableCompletionRecordReceipt } from './phase-loop-todo-state.mjs';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

const parent = `- [ ] E-parent: Patch only \`scripts/target.mjs\`.
  Route: implementation.
  Source TODO: external review.
  Depends on: <none>.
  Completion condition: the extracted package records a bounded journey with durable replay evidence.
  Forbidden changes: do not use source-tree binaries.
  Verification: run \`node --test scripts/target.test.mjs\`, \`pnpm guard:runtime-operational-evidence:test\`, and the Release Workflow matrix.`;

const child = `- [ ] E-child: Patch only \`scripts/target.mjs\`.
  Route: implementation.
  Source TODO: E-parent.
  Depends on: <none>.
  Completion condition: Patch only \`scripts/target.mjs\` so the extracted package records a bounded journey with durable replay evidence.
  Forbidden changes: do not use source-tree binaries.
  Verification: run \`node --test scripts/target.test.mjs\`, \`pnpm guard:runtime-operational-evidence:test\`, and the Release Workflow matrix.`;

function journeyEvidence(target) {
  return {
    schema_version: 1,
    evidence_id: 'brownie-release-artifact-runtime-journey-v1',
    target,
    artifact: {
      archive_sha256: `sha256:${'a'.repeat(64)}`,
      artifact_sha256: `sha256:${'b'.repeat(64)}`,
      runtime_sha256: `sha256:${'c'.repeat(64)}`
    },
    checks: {
      mode_pack_load: { passed: true, mode_count: 1 },
      workspace_mutation: { passed: true, before: 'sha256:before', after: 'sha256:after' },
      ledger_generation: { passed: true, ledger_sha256: `sha256:${'d'.repeat(64)}` },
      forced_interruption: { passed: true, controller_action: 'resume', stop_reason: 'fixture_interruption' },
      resume: { passed: true, status: 'no_eligible_task', controller_action: 'stop' },
      stale_replay_rejection: { passed: true, status: 'no_eligible_task', controller_action: 'stop', workspace_unchanged: true }
    }
  };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-derived-attestation-'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts/target.mjs'), 'export const target = true;\n');
  fs.mkdirSync(path.join(root, '.brownie'), { recursive: true });
  fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Queue\n\n${child}\n`);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'fixture']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  git(root, ['add', 'scripts/target.mjs', '.brownie/todo.md']);
  git(root, ['commit', '-qm', 'delivery']);
  const head = git(root, ['rev-parse', 'HEAD']);
  writeJson(path.join(root, '.brownie/private/phase-loop/runs/parent.json'), {
    claim_id: 'parent-claim',
    selected_todo: parent,
    selected_todo_sha256: sha256(parent),
    baseline_todo_text: `# Queue\n\n${parent}\n`
  });
  writeJson(path.join(root, '.brownie/private/phase-loop/todo-replans/parent.json'), {
    schema_version: 1,
    record_type: 'todo_replan',
    operation: 'split_parent_into_children',
    parent_status: 'superseded_by_children',
    parent_todo_id: 'E-parent',
    generated_child_ids: ['E-child']
  });
  const dossier = {
    schema_version: 1,
    record_type: 'historical_derived_delivery_dossier',
    parent_claim_snapshot_path: '.brownie/private/phase-loop/runs/parent.json',
    replan_record_path: '.brownie/private/phase-loop/todo-replans/parent.json',
    child_todo_id: 'E-child',
    delivery: {
      pr_url: 'https://github.com/example-org/example-repo/pull/42',
      expected_head_sha: head,
      expected_merge_commit: head,
      expected_changed_files: ['scripts/target.mjs'],
      required_delivery_source_paths: ['scripts/target.mjs'],
      release_workflow_runs: [{ id: 42, workflow_name: 'Release Workflow' }],
      artifact_journeys: [{ name: 'runtime-journey-linux-x64', workflow_run_id: 42, target: 'linux-x64' }]
    }
  };
  writeJson(path.join(root, 'docs/dossier.json'), dossier);
  const actorDeployment = {
    schema_version: 1,
    repository: 'example-org/example-repo',
    roles: {
      implementation: { github_login: 'implementation-worker', branch_prefixes: ['implementation/'] },
      review: { github_login: 'reviewer-worker' },
      merge: { github_login: 'reviewer-worker' }
    },
    constraints: { require_independent_review: true }
  };
  const observedDelivery = {
    pr: {
      url: dossier.delivery.pr_url,
      state: 'MERGED',
      author: 'implementation-worker',
      head_sha: head,
      merge_commit: head,
      merged_by: 'reviewer-worker',
      files: [{ path: 'scripts/target.mjs' }],
      ci_passed: true,
      reviews: [{ author: 'reviewer-worker', state: 'APPROVED', commit_id: head }]
    },
    workflow_runs: [{ id: 42, workflow_name: 'Release Workflow', head_sha: head, conclusion: 'success' }],
    journey_artifacts: [{ name: 'runtime-journey-linux-x64', workflow_run_id: 42, evidence: journeyEvidence('linux-x64') }]
  };
  return { root, actorDeployment, observedDelivery };
}

function attest(value, extra = {}) {
  return attestHistoricalDerivedDelivery({
    repoRoot: value.root,
    dossierPath: 'docs/dossier.json',
    actorDeployment: value.actorDeployment,
    observedDelivery: value.observedDelivery,
    targetRef: 'HEAD',
    now: '2026-11-01T00:00:00.000Z',
    ...extra
  });
}

test('requires direct release-artifact evidence before it may attest a parent delivery to one replan child', () => {
  const value = fixture();
  const dryRun = attest(value);
  assert.equal(dryRun.ready_to_attest, true, JSON.stringify(dryRun));
  assert.equal(dryRun.attested, false);
  const committed = attest(value, { write: true });
  assert.equal(committed.attested, true, JSON.stringify(committed));
  const record = JSON.parse(fs.readFileSync(path.join(value.root, committed.durable_record_path), 'utf8'));
  assert.equal(record.root_claim_id, 'parent-claim');
  assert.equal(record.selected_todo_id, 'E-child');
  assert.equal(durableCompletionRecordReceipt(record).valid, true);
});

test('repairs an interrupted attestation without leaving an effective completion unaudited', () => {
  const value = fixture();
  const committed = attest(value, { write: true });
  const durablePath = path.join(value.root, committed.durable_record_path);
  const auditPath = path.join(value.root, committed.audit_path);

  fs.rmSync(auditPath);
  const repairedAudit = attest(value, { write: true });
  assert.equal(repairedAudit.idempotent_attestation, true, JSON.stringify(repairedAudit));
  assert.equal(fs.existsSync(auditPath), true);

  fs.rmSync(durablePath);
  const repairedCompletion = attest(value, { write: true });
  assert.equal(repairedCompletion.attested, true, JSON.stringify(repairedCompletion));
  assert.equal(fs.existsSync(durablePath), true);
  assert.equal(fs.existsSync(auditPath), true);
});

test('fails closed when the current selected source target diverges from the canonical merged delivery', () => {
  const value = fixture();
  fs.appendFileSync(path.join(value.root, 'scripts/target.mjs'), 'export const later = true;\n');
  const result = attest(value);
  assert.equal(result.ready_to_attest, undefined);
  assert(result.errors.includes('selected_workspace_target_diverged:scripts/target.mjs'), JSON.stringify(result));
});

test('fails closed when approval was not made on the exact merged head', () => {
  const value = fixture();
  value.observedDelivery.pr.reviews[0].commit_id = 'f'.repeat(40);
  const result = attest(value);
  assert(result.errors.includes('delivery_pr_same_head_independent_approval_missing'), JSON.stringify(result));
});

test('fails closed when an uploaded journey artifact lacks replay-rejection evidence', () => {
  const value = fixture();
  value.observedDelivery.journey_artifacts[0].evidence.checks.stale_replay_rejection.workspace_unchanged = false;
  const result = attest(value);
  assert(result.errors.includes('release_journey_artifact_invalid:runtime-journey-linux-x64'), JSON.stringify(result));
});

test('does not accept a replan whose child is not causally derived from the parent claim', () => {
  const value = fixture();
  const replan = path.join(value.root, '.brownie/private/phase-loop/todo-replans/parent.json');
  const valueFromDisk = JSON.parse(fs.readFileSync(replan, 'utf8'));
  valueFromDisk.generated_child_ids = ['other-child'];
  writeJson(replan, valueFromDisk);
  const result = attest(value);
  assert(result.errors.includes('parent_to_child_replan_edge_invalid'), JSON.stringify(result));
});
