import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const errors = [];
const phase = 'M5.35';
const manifestPath = 'docs/architecture/phase-value-manifest.m5.35.json';

function readText(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    errors.push(`Failed to read ${relativePath}: ${error.message}`);
    return '';
  }
}

function readJson(relativePath) {
  try {
    return JSON.parse(readText(relativePath));
  } catch (error) {
    errors.push(`Failed to parse ${relativePath}: ${error.message}`);
    return {};
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireManifestValue(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function validateManifest(manifest) {
  requireManifestValue(manifest.phase === phase, `${manifestPath} must describe phase ${phase}.`);
  requireManifestValue(manifest.target_capability === 'subtask_orchestration', `${phase} target_capability must be subtask_orchestration.`);
  requireManifestValue(
    manifest.concrete_capability_transition === 'parent_inspection_controlled_child_set_join_readiness',
    `${phase} must declare the parent inspection controlled child-set join readiness transition.`
  );
  requireManifestValue(
    manifest.forbidden_pattern === 'diagnostics_only_or_observability_only_readiness_report',
    `${phase} must forbid diagnostics-only or observability-only readiness reports.`
  );

  const mappings = Array.isArray(manifest.strategic_capability_mapping)
    ? manifest.strategic_capability_mapping
    : [];
  requireManifestValue(mappings.length > 0, `${phase} must include strategic_capability_mapping.`);
  requireManifestValue(
    mappings.some((mapping) => mapping.capability === 'subtask_orchestration' && isNonEmptyString(mapping.relationship)),
    `${phase} strategic_capability_mapping must include subtask_orchestration.`
  );

  const valueGate = manifest.phase_value_gate ?? {};
  const questions = Array.isArray(valueGate.questions) ? valueGate.questions : [];
  const answers = valueGate.answers ?? {};
  requireManifestValue(questions.length > 0, `${phase} phase_value_gate.questions must be non-empty.`);
  for (const question of questions) {
    requireManifestValue(isNonEmptyString(question.id), `Every ${phase} phase_value_gate question must include an id.`);
    if (isNonEmptyString(question.id)) {
      requireManifestValue(
        isNonEmptyString(answers[question.id]),
        `${phase} phase_value_gate.answers.${question.id} must be non-empty.`
      );
    }
  }

  const exitCriteria = Array.isArray(manifest.exit_criteria) ? manifest.exit_criteria : [];
  for (const token of [
    'Existing parent run.inspect output',
    'Existing parent task.inspect output',
    'parent_join_readiness_summary',
    'parent task id',
    'parent run id',
    'terminal controlled child count',
    'pending controlled child count',
    'pending controlled child task ids',
    'parent_join_ready=false',
    'run_remaining_child_tasks_explicitly',
    'parent_join_ready=true',
    'parent_running_enabled=false',
    'run_parent_task_explicitly',
    'after parent join consumption',
    'parent TaskRunning',
    'parent join consumption',
    'handoff envelope',
    'child TaskRecord',
    'M5.34 terminal child readiness',
    'M5.32 parent-join child-orchestration replay',
    'M5.31 initial parent replay',
    'M5.30 first materialization',
    'M5.29 replay-safe',
    'M5.27 over-budget recovery-cycle child',
    'In-budget recovery-cycle child',
    'Non-controlled, parentless, and standalone tasks',
    'No raw child prompts',
    'No scheduler handoff'
  ]) {
    requireManifestValue(
      exitCriteria.some((criterion) => typeof criterion === 'string' && criterion.includes(token)),
      `${phase} exit_criteria must mention ${token}.`
    );
  }
}

function requireToken(relativePath, token) {
  const text = readText(relativePath);
  if (!text.includes(token)) {
    errors.push(`${relativePath} must include ${token}.`);
  }
}

function validateSourceEvidence(manifest) {
  const evidence = manifest.source_evidence ?? {};
  for (const token of evidence.rust_runtime_tokens ?? []) {
    requireToken('crates/brownie-runtime/src/lib.rs', token);
  }
  for (const token of evidence.rust_protocol_tokens ?? []) {
    requireToken('crates/brownie-protocol/src/lib.rs', token);
  }
  for (const token of evidence.rust_store_tokens ?? []) {
    requireToken('crates/brownie-store/src/lib.rs', token);
  }
  for (const token of evidence.vsix_protocol_tokens ?? []) {
    requireToken('extensions/brownie-vsix/src/runtime/protocol.ts', token);
  }
  for (const token of evidence.vsix_test_tokens ?? []) {
    requireToken('extensions/brownie-vsix/src/test/runtimeClient.test.ts', token);
  }
  for (const token of evidence.architecture_doc_tokens ?? []) {
    requireToken('docs/architecture/runtime-overview.md', token);
  }

  const runtimeText = readText('crates/brownie-runtime/src/lib.rs');
  for (const token of [
    'parent_join_readiness_summary_for_parent_inspection',
    'RunInspectParentJoinReadinessSummary',
    'parent_join_readiness_summary',
    'controlled_child_records_for_parent_run',
    'child_has_terminal_parent_join_outcome',
    'parent_join_child_completion_evidence',
    'parent_join_child_completion_fingerprint_consumed',
    'terminal_controlled_child_count',
    'pending_controlled_child_count',
    'pending_controlled_child_task_ids',
    'run_remaining_child_tasks_explicitly',
    'run_parent_task_explicitly',
    'parent_inspect_reports_child_set_join_readiness_without_mutation',
    'assert_parent_inspect_join_readiness_summary',
    'assert_parent_inspection_did_not_mutate',
    'parent_join_readiness_outcome_for_terminal_child',
    'parent_join_readiness_outcome_for_replay',
    'task_run_reports_pending_siblings_before_parent_join_readiness',
    'task_run_parentless_task_omits_parent_join_readiness_outcome',
    'child_orchestration_outcome_for_replay',
    'child_orchestration_outcome_for_latest_parent_join_queued_children',
    'child_orchestration_outcome_for_existing_queued_children',
    'recovery_cycle_budget_outcome_for_replay',
    'task_run_rejects_over_budget_recovery_cycle_child_before_running',
    'task_run_accepts_recovery_cycle_child_with_parent_ledger_provenance',
    'TaskRunning',
    'ParentJoinContinuationFingerprintConsumed',
    'SubtaskDispatchHandoffEnvelopeRecorded'
  ]) {
    if (!runtimeText.includes(token)) {
      errors.push(`${phase} runtime source must include ${token}.`);
    }
  }
  const forbiddenWrapperEvents = [
    'SubtaskDispatchTicketRecorded',
    'SubtaskAdmissionTokenRecorded',
    'SubtaskSchedulerPacketRecorded',
    'SubtaskHandoffReceiptRecorded',
    'SubtaskChildRunAdmissionSummaryRecorded',
    'SubtaskChildRunResultSummaryRecorded',
    'SubtaskContinuationChildMaterialized'
  ];
  for (const token of forbiddenWrapperEvents) {
    if (runtimeText.includes(token)) {
      errors.push(`${phase} must not add wrapper-only event ${token}.`);
    }
  }
}

const manifest = readJson(manifestPath);
validateManifest(manifest);
validateSourceEvidence(manifest);

if (errors.length > 0) {
  console.error('Phase value guard failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Phase value guard passed.');
