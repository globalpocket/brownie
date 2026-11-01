#!/usr/bin/env node
/*
 * Strict recovery for a historical delivery that was implemented, reviewed,
 * merged, and exercised before the phase loop had a durable claim-bound
 * receipt.  It is deliberately narrower than a normal completion path:
 *
 * - it accepts only a checked-in dossier, immutable parent claim snapshot,
 *   durable parent-to-child replan edge, GitHub's observed PR/review/CI facts,
 *   and uploaded release-artifact journey evidence;
 * - it proves that the delivery tree is still the selected canonical tree;
 * - it never converts a patch, a PR, or green CI into a fake
 *   `runtime.completed:true` payload; and
 * - it writes nothing unless every check succeeds and --write is explicit.
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPhaseLoopActorDeployment, roleActor } from './phase-loop-actor-deployment.mjs';
import { completionConditionSha256 } from './phase-loop-delivery-integrity.mjs';
import { validateHistoricalDerivedDeliveryReceipt } from './phase-loop-historical-derived-delivery-integrity.mjs';
import { readTodoCompletionInvalidationRecords } from './phase-loop-todo-state.mjs';

const defaultTodo = '.brownie/todo.md';
const defaultState = '.brownie/private/phase-loop';
const defaultTargetRef = 'origin/main';
const __filename = fileURLToPath(import.meta.url);

function sha256(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
}

function canonicalSha256(value) {
  return sha256(JSON.stringify(canonicalJson(value)));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function todoBlocks(text) {
  const source = String(text ?? '');
  const starts = [...source.matchAll(/^(?:[-*]|\d+[.)])\s+\[[ xX]\]\s+/gmu)].map((match) => match.index);
  return starts.map((start, index) => source.slice(start, starts[index + 1] ?? source.length).trimEnd());
}

function todoId(block) {
  return String(block ?? '').split('\n')[0]
    .replace(/^(?:[-*]|\d+[.)])\s+\[[ xX]\]\s+/u, '')
    .split(':')[0]?.trim() ?? '';
}

function lineValue(block, label) {
  const line = String(block ?? '').split('\n').map((line) => line.trim())
    .find((line) => line.startsWith(`${label}:`));
  return line ? line.slice(label.length + 1).trim().replace(/[.]$/u, '') : '';
}

function commands(block) {
  return [...lineValue(block, 'Verification').matchAll(/`([^`]+)`/gu)]
    .map((match) => match[1].trim()).filter(Boolean);
}

function patchPaths(block) {
  const firstLine = String(block ?? '').split('\n')[0] ?? '';
  return [...firstLine.matchAll(/`([^`]+)`/gu)]
    .map((match) => match[1].trim())
    .filter((value) => value.includes('/') && !value.includes(' '));
}

function findBlock(text, id) {
  const matches = todoBlocks(text).filter((block) => todoId(block) === id);
  if (matches.length !== 1) throw new Error(matches.length ? `ambiguous_todo_id:${id}` : `todo_not_found:${id}`);
  return matches[0];
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function git(repoRoot, args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    const detail = error?.stderr?.toString('utf8').trim() || error?.message || 'git_failed';
    throw new Error(`git_${args[0]}_failed:${detail}`);
  }
}

function blobSha(repoRoot, ref, repoPath) {
  return git(repoRoot, ['rev-parse', `${ref}:${repoPath}`]);
}

function workspaceSha(repoRoot, repoPath) {
  const file = path.resolve(repoRoot, repoPath);
  try {
    if (!fs.statSync(file).isFile()) return null;
  } catch {
    return null;
  }
  return git(repoRoot, ['hash-object', '--', repoPath]);
}

function parsePrNumber(prUrl) {
  const match = String(prUrl ?? '').match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/u);
  if (!match) throw new Error('dossier_pr_url_invalid');
  return { repository: match[1], number: Number(match[2]) };
}

function normalizedFiles(files) {
  return [...new Set((files ?? []).map((file) => typeof file === 'string' ? file : file?.path).filter(Boolean))].sort();
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateDossier(dossier) {
  const delivery = dossier?.delivery;
  const errors = [];
  if (dossier?.schema_version !== 1 || dossier?.record_type !== 'historical_derived_delivery_dossier') errors.push('dossier_schema_invalid');
  if (!String(dossier?.parent_claim_snapshot_path ?? '').trim()) errors.push('dossier_parent_snapshot_missing');
  if (!String(dossier?.replan_record_path ?? '').trim()) errors.push('dossier_replan_record_missing');
  if (!String(dossier?.child_todo_id ?? '').trim()) errors.push('dossier_child_todo_missing');
  if (!delivery || typeof delivery !== 'object') errors.push('dossier_delivery_missing');
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/u.test(String(delivery?.pr_url ?? ''))) errors.push('dossier_pr_url_invalid');
  if (!/^[a-f0-9]{40}$/u.test(String(delivery?.expected_head_sha ?? ''))) errors.push('dossier_head_invalid');
  if (!/^[a-f0-9]{40}$/u.test(String(delivery?.expected_merge_commit ?? ''))) errors.push('dossier_merge_invalid');
  if (!Array.isArray(delivery?.expected_changed_files) || delivery.expected_changed_files.length === 0) errors.push('dossier_changed_files_missing');
  if (!Array.isArray(delivery?.required_delivery_source_paths) || delivery.required_delivery_source_paths.length === 0
    || delivery.required_delivery_source_paths.some((file) => !delivery.expected_changed_files.includes(file))) {
    errors.push('dossier_required_delivery_source_paths_invalid');
  }
  if (!Array.isArray(delivery?.release_workflow_runs) || delivery.release_workflow_runs.length === 0) errors.push('dossier_workflow_runs_missing');
  if (!Array.isArray(delivery?.artifact_journeys) || delivery.artifact_journeys.length === 0) errors.push('dossier_artifact_journeys_missing');
  return errors;
}

function validJourneyEvidence(evidence, expectedTarget) {
  const checks = evidence?.checks;
  const required = ['mode_pack_load', 'workspace_mutation', 'ledger_generation', 'forced_interruption', 'resume', 'stale_replay_rejection'];
  return (
    evidence?.schema_version === 1
    && evidence.evidence_id === 'brownie-release-artifact-runtime-journey-v1'
    && evidence.target === expectedTarget
    && required.every((key) => checks?.[key]?.passed === true)
    && checks?.forced_interruption?.controller_action === 'resume'
    && typeof checks?.forced_interruption?.stop_reason === 'string'
    && checks?.resume?.status === 'no_eligible_task'
    && checks?.resume?.controller_action === 'stop'
    && checks?.stale_replay_rejection?.status === 'no_eligible_task'
    && checks?.stale_replay_rejection?.controller_action === 'stop'
    && checks?.stale_replay_rejection?.workspace_unchanged === true
  );
}

function effectiveWorkflowRuns(observed, dossier) {
  const expected = new Map(dossier.delivery.release_workflow_runs.map((run) => [Number(run.id), run]));
  const actual = new Map((observed.workflow_runs ?? []).map((run) => [Number(run.id), run]));
  const errors = [];
  for (const [id, wanted] of expected) {
    const run = actual.get(id);
    if (!run || run.workflow_name !== wanted.workflow_name || run.head_sha !== dossier.delivery.expected_head_sha || run.conclusion !== 'success') {
      errors.push(`release_workflow_run_invalid:${id}`);
    }
  }
  return errors;
}

function observedArtifactMap(observed) {
  return new Map((observed.journey_artifacts ?? []).map((artifact) => [artifact.name, artifact]));
}

function validateObservedDelivery({ observed, dossier, actors }) {
  const errors = [];
  const pr = observed?.pr;
  const expected = dossier.delivery;
  const expectedPr = parsePrNumber(expected.pr_url);
  if (expectedPr.repository !== actors.repository) errors.push('dossier_repository_mismatch');
  if (!pr || pr.url !== expected.pr_url || pr.state !== 'MERGED') errors.push('delivery_pr_not_merged');
  if (pr?.author !== actors.implementation) errors.push('delivery_pr_author_mismatch');
  if (pr?.head_sha !== expected.expected_head_sha || pr?.merge_commit !== expected.expected_merge_commit) errors.push('delivery_pr_commit_mismatch');
  if (pr?.merged_by !== actors.merge) errors.push('delivery_pr_merge_actor_mismatch');
  const approvals = (pr?.reviews ?? []).filter((review) => (
    review?.author === actors.review && review?.state === 'APPROVED' && review?.commit_id === expected.expected_head_sha
  ));
  if (approvals.length === 0) errors.push('delivery_pr_same_head_independent_approval_missing');
  if (pr?.ci_passed !== true) errors.push('delivery_pr_ci_not_green');
  if (!sameArray(normalizedFiles(pr?.files), normalizedFiles(expected.expected_changed_files))) errors.push('delivery_pr_file_scope_mismatch');
  errors.push(...effectiveWorkflowRuns(observed, dossier));
  const artifacts = observedArtifactMap(observed);
  const artifactNames = new Set();
  for (const expectedArtifact of expected.artifact_journeys) {
    if (artifactNames.has(expectedArtifact.name)) errors.push(`dossier_artifact_duplicate:${expectedArtifact.name}`);
    artifactNames.add(expectedArtifact.name);
    const artifact = artifacts.get(expectedArtifact.name);
    if (!artifact || artifact.workflow_run_id !== Number(expectedArtifact.workflow_run_id)
      || !validJourneyEvidence(artifact.evidence, expectedArtifact.target)) {
      errors.push(`release_journey_artifact_invalid:${expectedArtifact.name}`);
    }
  }
  return errors;
}

function validateLineage({ repoRoot, todoText, dossier, targetRef }) {
  const errors = [];
  const parentSnapshotPath = path.resolve(repoRoot, dossier.parent_claim_snapshot_path);
  const replanPath = path.resolve(repoRoot, dossier.replan_record_path);
  let parentSnapshot;
  let replan;
  try { parentSnapshot = readJson(parentSnapshotPath); } catch { errors.push('parent_claim_snapshot_unreadable'); }
  try { replan = readJson(replanPath); } catch { errors.push('parent_replan_record_unreadable'); }
  if (errors.length > 0) return { errors, parentSnapshot: null, parent: null, child: null, replan: null };
  const parent = String(parentSnapshot?.selected_todo ?? '').trimEnd();
  const parentId = todoId(parent);
  const child = findBlock(todoText, dossier.child_todo_id);
  if (!parent || !parentId || parentSnapshot?.claim_id == null
    || (parentSnapshot?.selected_todo_sha256 && parentSnapshot.selected_todo_sha256 !== sha256(parent))) {
    errors.push('parent_claim_snapshot_invalid');
  }
  if (replan?.record_type !== 'todo_replan' || replan?.operation !== 'split_parent_into_children'
    || replan?.parent_status !== 'superseded_by_children' || replan?.parent_todo_id !== parentId
    || !Array.isArray(replan?.generated_child_ids) || !replan.generated_child_ids.includes(dossier.child_todo_id)) {
    errors.push('parent_to_child_replan_edge_invalid');
  }
  if (lineValue(child, 'Source TODO') !== parentId) errors.push('child_source_parent_mismatch');
  if (!lineValue(child, 'Completion condition').includes(lineValue(parent, 'Completion condition'))) {
    errors.push('child_completion_contract_weakened');
  }
  const parentCommands = commands(parent);
  const childCommands = commands(child);
  if (!parentCommands.every((command) => childCommands.includes(command))) errors.push('child_verification_contract_weakened');
  const sourcePaths = patchPaths(child).filter((candidate) => candidate.startsWith('scripts/'));
  if (sourcePaths.length === 0) errors.push('child_patch_target_missing');
  if (!sourcePaths.every((candidate) => dossier.delivery.required_delivery_source_paths.includes(candidate))) {
    errors.push('child_patch_target_not_bound_to_delivery_source');
  }
  if (errors.length === 0) {
    // Later controller, test-harness, or package hardening can legitimately
    // alter the broad original PR file set.  The derivation is only for the
    // child patch target, so bind that executable source exactly while the
    // raw CI evidence preserves the historical test/workflow facts.
    for (const repoPath of dossier.delivery.required_delivery_source_paths) {
      try {
        if (blobSha(repoRoot, dossier.delivery.expected_head_sha, repoPath) !== blobSha(repoRoot, targetRef, repoPath)) {
          errors.push(`canonical_delivery_tree_drift:${repoPath}`);
        }
      } catch {
        errors.push(`canonical_delivery_tree_unreadable:${repoPath}`);
      }
    }
    for (const repoPath of sourcePaths) {
      try {
        if (workspaceSha(repoRoot, repoPath) !== blobSha(repoRoot, targetRef, repoPath)) {
          errors.push(`selected_workspace_target_diverged:${repoPath}`);
        }
      } catch {
        errors.push(`selected_workspace_target_unreadable:${repoPath}`);
      }
    }
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', dossier.delivery.expected_merge_commit, targetRef], { cwd: repoRoot, stdio: 'ignore' });
    } catch {
      errors.push('merged_delivery_not_ancestor_of_canonical_target');
    }
  }
  return { errors, parentSnapshot, parent, parentId, child, replan, parentSnapshotPath, replanPath };
}

function buildRecord({ dossier, dossierPath, dossierSha256, observed, lineage, actors, now }) {
  const childHash = sha256(lineage.child);
  const claimId = `derived-historical-${lineage.parentSnapshot.claim_id}-${childHash.slice(0, 12)}-${dossier.delivery.expected_merge_commit.slice(0, 12)}`;
  const historicalEvidence = {
    schema_version: 1,
    kind: 'release_artifact_runtime_journey',
    parent_claim_id: lineage.parentSnapshot.claim_id,
    parent_selected_todo_sha256: sha256(lineage.parent),
    child_selected_todo_sha256: childHash,
    child_completion_condition_sha256: completionConditionSha256({ selected_todo: lineage.child }),
    replan_record_sha256: sha256(fs.readFileSync(lineage.replanPath, 'utf8')),
    dossier_sha256: dossierSha256,
    pr_url: dossier.delivery.pr_url,
    pr_head_sha: dossier.delivery.expected_head_sha,
    merge_commit: dossier.delivery.expected_merge_commit,
    release_workflow_runs: (observed.workflow_runs ?? []).map((run) => ({
      id: Number(run.id), workflow_name: run.workflow_name, head_sha: run.head_sha, conclusion: run.conclusion
    })),
    journey_artifacts: dossier.delivery.artifact_journeys.map((expected) => {
      const artifact = observedArtifactMap(observed).get(expected.name);
      return {
        name: expected.name,
        target: expected.target,
        evidence_sha256: canonicalSha256(artifact.evidence),
        evidence: artifact.evidence
      };
    })
  };
  return {
    schema_version: 2,
    record_type: 'derived_historical_delivery_attestation',
    claim_id: claimId,
    root_claim_id: lineage.parentSnapshot.claim_id,
    selected_todo_id: dossier.child_todo_id,
    selected_todo_first_line: lineage.child.split('\n')[0],
    selected_todo_sha256: childHash,
    reason: 'historical_parent_delivery_attested_to_derived_child_with_release_artifact_evidence',
    delivery_receipt: {
      schema_version: 1,
      claim_id: claimId,
      root_claim_id: lineage.parentSnapshot.claim_id,
      selected_todo_sha256: childHash,
      approved: true,
      ci_passed: true,
      merged: true,
      author: actors.implementation,
      reviewer: actors.review,
      merge_actor: actors.merge,
      pr_url: dossier.delivery.pr_url,
      pr_head_sha: dossier.delivery.expected_head_sha,
      merge_commit: dossier.delivery.expected_merge_commit,
      historical_delivery_evidence: historicalEvidence
    },
    attestation: {
      dossier_path: dossierPath,
      parent_claim_snapshot_path: lineage.parentSnapshotPath,
      replan_record_path: lineage.replanPath,
      observed_at: now
    }
  };
}

export function attestHistoricalDerivedDelivery({
  repoRoot,
  dossierPath,
  observedDelivery,
  actorDeploymentPath,
  actorDeployment,
  todoPath = defaultTodo,
  statePath = defaultState,
  targetRef = defaultTargetRef,
  write = false,
  now = new Date().toISOString()
}) {
  const root = path.resolve(repoRoot);
  const dossierFile = path.resolve(root, dossierPath);
  const dossier = readJson(dossierFile);
  const dossierErrors = validateDossier(dossier);
  if (dossierErrors.length > 0) return { attested: false, errors: dossierErrors };
  const actor = loadPhaseLoopActorDeployment({ repoRoot: root, deploymentPath: actorDeploymentPath, deployment: actorDeployment });
  if (!actor.ok) return { attested: false, errors: actor.errors.map((error) => `actor_deployment_invalid:${error}`) };
  const actors = {
    repository: actor.deployment.repository,
    implementation: roleActor(actor.deployment, 'implementation'),
    review: roleActor(actor.deployment, 'review'),
    merge: roleActor(actor.deployment, 'merge')
  };
  const todoText = fs.readFileSync(path.resolve(root, todoPath), 'utf8');
  const lineage = validateLineage({ repoRoot: root, todoText, dossier, targetRef });
  const observedErrors = validateObservedDelivery({ observed: observedDelivery, dossier, actors });
  const errors = [...lineage.errors, ...observedErrors];
  if (errors.length > 0) return { attested: false, errors: [...new Set(errors)].sort() };
  const record = buildRecord({
    dossier,
    dossierPath: relative(root, dossierFile),
    dossierSha256: sha256(fs.readFileSync(dossierFile, 'utf8')),
    observed: observedDelivery,
    lineage,
    actors,
    now
  });
  const validation = validateHistoricalDerivedDeliveryReceipt(record);
  if (!validation.valid) return { attested: false, errors: [validation.reason] };
  const invalidated = readTodoCompletionInvalidationRecords(root).some((entry) => (
    entry.selected_todo_id === dossier.child_todo_id && entry.invalidated_completion_claim_id === record.claim_id
  ));
  if (invalidated) return { attested: false, errors: ['derived_historical_attestation_already_invalidated'] };
  const stateRoot = path.resolve(root, statePath);
  const receiptId = sha256(`${record.claim_id}\n${record.selected_todo_sha256}\n${record.delivery_receipt.merge_commit}`).slice(0, 24);
  const durablePath = path.join(stateRoot, 'todo-completions', `derived-historical-${receiptId}.json`);
  const auditPath = path.join(stateRoot, 'historical-derived-delivery-attestations', `${receiptId}.json`);
  if (!write) {
    return { attested: false, ready_to_attest: true, claim_id: record.claim_id, selected_todo_id: record.selected_todo_id, durable_record_path: relative(root, durablePath), audit_path: relative(root, auditPath) };
  }
  if (fs.existsSync(durablePath)) {
    const existing = readJson(durablePath);
    if (canonicalSha256(existing) !== canonicalSha256(record)) {
      return { attested: false, errors: ['derived_historical_attestation_path_conflict'] };
    }
    return { attested: false, idempotent_attestation: true, claim_id: record.claim_id, selected_todo_id: record.selected_todo_id, durable_record_path: relative(root, durablePath), audit_path: relative(root, auditPath) };
  }
  atomicJson(durablePath, record);
  atomicJson(auditPath, {
    schema_version: 1,
    record_type: 'historical_derived_delivery_attestation_audit',
    claim_id: record.claim_id,
    root_claim_id: record.root_claim_id,
    selected_todo_id: record.selected_todo_id,
    durable_record_path: relative(root, durablePath),
    pr_url: record.delivery_receipt.pr_url,
    merge_commit: record.delivery_receipt.merge_commit,
    reviewer: record.delivery_receipt.reviewer,
    attested_at: now
  });
  return { attested: true, claim_id: record.claim_id, selected_todo_id: record.selected_todo_id, durable_record_path: relative(root, durablePath), audit_path: relative(root, auditPath) };
}

function ghJson(args) {
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

function findNamedFile(root, name) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name === name) return candidate;
    if (entry.isDirectory()) {
      const found = findNamedFile(candidate, name);
      if (found) return found;
    }
  }
  return null;
}

export function collectObservedHistoricalDelivery({ dossier, repository = parsePrNumber(dossier.delivery.pr_url).repository }) {
  const { number } = parsePrNumber(dossier.delivery.pr_url);
  const view = ghJson(['pr', 'view', String(number), '--repo', repository, '--json', 'url,state,author,headRefOid,mergeCommit,mergedBy,statusCheckRollup,files']);
  const reviews = ghJson(['api', `repos/${repository}/pulls/${number}/reviews`, '--paginate']);
  const workflowRuns = dossier.delivery.release_workflow_runs.map((expected) => {
    const run = ghJson(['api', `repos/${repository}/actions/runs/${Number(expected.id)}`]);
    return { id: Number(expected.id), workflow_name: run.name, head_sha: run.head_sha, conclusion: run.conclusion };
  });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-historical-delivery-'));
  try {
    const artifacts = [];
    for (const expected of dossier.delivery.artifact_journeys) {
      const destination = path.join(temp, expected.name);
      fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
      execFileSync('gh', ['run', 'download', String(expected.workflow_run_id), '--repo', repository, '--name', expected.name, '--dir', destination], { stdio: ['ignore', 'pipe', 'pipe'] });
      const evidencePath = findNamedFile(destination, 'runtime-journey-evidence.json');
      if (!evidencePath) throw new Error(`runtime_journey_artifact_missing_evidence:${expected.name}`);
      artifacts.push({ name: expected.name, workflow_run_id: Number(expected.workflow_run_id), evidence: readJson(evidencePath) });
    }
    return {
      pr: {
        url: view.url,
        state: view.state,
        author: view.author?.login,
        head_sha: view.headRefOid,
        merge_commit: view.mergeCommit?.oid,
        merged_by: view.mergedBy?.login,
        files: view.files,
        ci_passed: Array.isArray(view.statusCheckRollup) && view.statusCheckRollup.length > 0 && view.statusCheckRollup.every((check) => (
          check?.status === 'COMPLETED' && check?.conclusion === 'SUCCESS'
        )),
        reviews: reviews.map((review) => ({ author: review.user?.login, state: review.state, commit_id: review.commit_id }))
      },
      workflow_runs: workflowRuns,
      journey_artifacts: artifacts
    };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const args = { repoRoot: path.resolve(path.dirname(__filename), '..'), todoPath: defaultTodo, statePath: defaultState, targetRef: defaultTargetRef, write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--repo') args.repoRoot = path.resolve(argv[++index] ?? '');
    else if (key === '--dossier') args.dossierPath = argv[++index] ?? null;
    else if (key === '--actor-deployment') args.actorDeploymentPath = argv[++index] ?? null;
    else if (key === '--todo') args.todoPath = argv[++index] ?? null;
    else if (key === '--state') args.statePath = argv[++index] ?? null;
    else if (key === '--target-ref') args.targetRef = argv[++index] ?? null;
    else if (key === '--write') args.write = true;
    else throw new Error(`unknown_argument:${key}`);
  }
  if (!args.dossierPath) throw new Error('missing_required_argument:--dossier');
  if (!args.actorDeploymentPath) throw new Error('missing_required_argument:--actor-deployment');
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const dossier = readJson(path.resolve(args.repoRoot, args.dossierPath));
    const observed = collectObservedHistoricalDelivery({ dossier });
    const result = attestHistoricalDerivedDelivery({ ...args, observedDelivery: observed });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(result.attested || result.ready_to_attest ? 0 : 2);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
}
