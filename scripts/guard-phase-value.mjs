import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const errors = [];
const phase = 'M5.38';
const manifestPath = 'docs/architecture/phase-value-manifest.m5.38.json';

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
    manifest.concrete_capability_transition === 'parent_inspection_consumed_parent_join_recovery',
    `${phase} must declare the parent inspection consumed parent-join recovery transition.`
  );
  requireManifestValue(
    manifest.forbidden_pattern === 'diagnostics_only_or_parent_inspection_consumed_join_without_continuation_handles',
    `${phase} must forbid diagnostics-only parent inspection consumed join recovery without continuation handles.`
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
    'Parent task.inspect',
    'consumed_parent_join_recovery_summary',
    'parent task id',
    'parent run id',
    'parent_join_consumed=true',
    'consumed terminal controlled child count',
    'continuation controlled child count',
    'continuation runnable child count',
    'continuation runnable child task ids',
    'continuation non-runnable child count',
    'continuation non-runnable child task ids',
    'continuation terminal child count',
    'parent_running_enabled=false',
    'run_continuation_child_tasks_explicitly',
    'inspect_non_runnable_continuation_child_tasks',
    'inspect_parent_task',
    'run_parent_task_explicitly',
    'stale continuation child handles',
    'TaskRunning',
    'parent join consumption',
    'handoff envelope',
    'child TaskRecord',
    'M5.37 direct child consumed_parent_join_recovery_summary',
    'M5.36 direct child parent_join_readiness_summary',
    'M5.35 parent inspection readiness',
    'M5.34 terminal child readiness',
    'M5.32 parent-join child-orchestration replay',
    'M5.31 initial parent replay',
    'M5.30 first materialization',
    'M5.29 replay-safe',
    'M5.27 over-budget recovery-cycle child',
    'In-budget recovery-cycle child',
    'Non-controlled, parentless, child-task, and standalone tasks',
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
    'consumed_parent_join_recovery_summary_for_parent_inspection',
    'RunInspectConsumedParentJoinRecoverySummary',
    'consumed_parent_join_recovery_summary',
    'parent_join_consumed',
    'consumed_terminal_controlled_child_count',
    'continuation_controlled_child_count',
    'continuation_runnable_child_count',
    'continuation_runnable_child_task_ids',
    'continuation_non_runnable_child_count',
    'continuation_non_runnable_child_task_ids',
    'continuation_terminal_child_count',
    'run_continuation_child_tasks_explicitly',
    'inspect_non_runnable_continuation_child_tasks',
    'inspect_parent_task',
    'consumed_terminal_controlled_child_set_for_consumed_parent_join',
    'consumed_parent_join_continuation_handoff_fingerprints',
    'continuation_controlled_children_for_consumed_parent_join',
    'assert_parent_inspect_consumed_parent_join_recovery_summary',
    'task_run_parent_join_materializes_continuation_subtask_without_auto_run',
    'task_run_parent_join_materializes_second_continuation_cycle_without_stale_candidates',
    'parent_join_readiness_summary_for_parent_inspection',
    'RunInspectParentJoinReadinessSummary',
    'parent_join_readiness_summary',
    'controlled_child_records_for_parent_run',
    'child_has_terminal_parent_join_outcome',
    'parent_join_child_completion_evidence',
    'assert_parent_inspection_did_not_mutate',
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
