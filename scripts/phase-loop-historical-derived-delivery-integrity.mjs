import crypto from 'node:crypto';

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

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function isGitSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
}

function isArtifactDigest(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function validJourneyArtifact(value) {
  const checks = value?.evidence?.checks;
  const requiredChecks = [
    'mode_pack_load',
    'workspace_mutation',
    'ledger_generation',
    'forced_interruption',
    'resume',
    'stale_replay_rejection'
  ];
  return (
    typeof value?.target === 'string' && value.target
    && isSha256(value?.evidence_sha256)
    && value?.evidence?.schema_version === 1
    && value.evidence.evidence_id === 'brownie-release-artifact-runtime-journey-v1'
    && value.evidence.target === value.target
    && isArtifactDigest(value.evidence?.artifact?.archive_sha256)
    && isArtifactDigest(value.evidence?.artifact?.artifact_sha256)
    && isArtifactDigest(value.evidence?.artifact?.runtime_sha256)
    && requiredChecks.every((key) => checks?.[key]?.passed === true)
    && checks?.forced_interruption?.controller_action === 'resume'
    && typeof checks?.forced_interruption?.stop_reason === 'string'
    && checks?.resume?.status === 'no_eligible_task'
    && checks?.resume?.controller_action === 'stop'
    && checks?.stale_replay_rejection?.status === 'no_eligible_task'
    && checks?.stale_replay_rejection?.controller_action === 'stop'
    && checks?.stale_replay_rejection?.workspace_unchanged === true
    && sha256(JSON.stringify(canonicalJson(value.evidence))) === value.evidence_sha256
  );
}

// This is intentionally a separate receipt kind.  A historical release-
// artifact journey has a bounded interruption as part of its *success* path;
// it must not be forged into `runtime.completed:true` just to fit a normal
// controller-terminal receipt.  The writer verifies GitHub, replan lineage,
// source blobs, and the raw uploaded journey evidence before producing it.
export function validateHistoricalDerivedDeliveryReceipt(record) {
  const receipt = record?.delivery_receipt;
  const evidence = receipt?.historical_delivery_evidence;
  const artifacts = Array.isArray(evidence?.journey_artifacts) ? evidence.journey_artifacts : [];
  const targets = new Set(artifacts.map((artifact) => artifact?.target));
  const valid = (
    record?.schema_version >= 2
    && record?.record_type === 'derived_historical_delivery_attestation'
    && typeof record?.claim_id === 'string' && record.claim_id.startsWith('derived-historical-')
    && typeof record?.root_claim_id === 'string' && record.root_claim_id
    && typeof record?.selected_todo_id === 'string' && record.selected_todo_id
    && isSha256(record?.selected_todo_sha256)
    && receipt?.schema_version === 1
    && receipt.claim_id === record.claim_id
    && receipt.root_claim_id === record.root_claim_id
    && receipt.selected_todo_sha256 === record.selected_todo_sha256
    && receipt.approved === true
    && receipt.ci_passed === true
    && receipt.merged === true
    && typeof receipt.author === 'string' && receipt.author
    && typeof receipt.reviewer === 'string' && receipt.reviewer
    && receipt.author !== receipt.reviewer
    && receipt.merge_actor === receipt.reviewer
    && evidence?.schema_version === 1
    && evidence?.kind === 'release_artifact_runtime_journey'
    && evidence.parent_claim_id === record.root_claim_id
    && isSha256(evidence?.parent_selected_todo_sha256)
    && evidence.child_selected_todo_sha256 === record.selected_todo_sha256
    && isSha256(evidence?.child_completion_condition_sha256)
    && isSha256(evidence?.replan_record_sha256)
    && isSha256(evidence?.dossier_sha256)
    && typeof evidence?.pr_url === 'string' && evidence.pr_url
    && isGitSha(evidence?.pr_head_sha)
    && isGitSha(evidence?.merge_commit)
    && Array.isArray(evidence?.release_workflow_runs) && evidence.release_workflow_runs.length > 0
    && evidence.release_workflow_runs.every((run) => (
      Number.isInteger(run?.id) && run.id > 0
      && run?.conclusion === 'success'
      && run?.head_sha === evidence.pr_head_sha
      && typeof run?.workflow_name === 'string' && run.workflow_name
    ))
    && artifacts.length > 0
    && targets.size === artifacts.length
    && artifacts.every(validJourneyArtifact)
  );
  return {
    valid,
    reason: valid ? null : 'derived_historical_delivery_receipt_invalid'
  };
}
