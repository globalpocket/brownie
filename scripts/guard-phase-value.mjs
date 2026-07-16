import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const errors = [];

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
  requireManifestValue(manifest.phase === 'M5.11', 'phase-value-manifest.m5.11.json must describe phase M5.11.');
  requireManifestValue(manifest.target_capability === 'subtask_orchestration', 'M5.11 target_capability must be subtask_orchestration.');
  requireManifestValue(
    manifest.concrete_capability_transition === 'minimal_controlled_child_task_materialization',
    'M5.11 must declare the minimal controlled child task materialization transition.'
  );
  requireManifestValue(
    manifest.forbidden_pattern === 'additional_blocked_summary_event_wrapper_without_child_task_materialization',
    'M5.11 must forbid adding another blocked summary wrapper without child task materialization.'
  );

  const mappings = Array.isArray(manifest.strategic_capability_mapping)
    ? manifest.strategic_capability_mapping
    : [];
  requireManifestValue(mappings.length > 0, 'M5.11 must include strategic_capability_mapping.');
  requireManifestValue(
    mappings.some((mapping) => mapping.capability === 'subtask_orchestration' && isNonEmptyString(mapping.relationship)),
    'M5.11 strategic_capability_mapping must include subtask_orchestration.'
  );

  const valueGate = manifest.phase_value_gate ?? {};
  const questions = Array.isArray(valueGate.questions) ? valueGate.questions : [];
  const answers = valueGate.answers ?? {};
  requireManifestValue(questions.length > 0, 'M5.11 phase_value_gate.questions must be non-empty.');
  for (const question of questions) {
    requireManifestValue(isNonEmptyString(question.id), 'Every M5.11 phase_value_gate question must include an id.');
    if (isNonEmptyString(question.id)) {
      requireManifestValue(
        isNonEmptyString(answers[question.id]),
        `M5.11 phase_value_gate.answers.${question.id} must be non-empty.`
      );
    }
  }

  const exitCriteria = Array.isArray(manifest.exit_criteria) ? manifest.exit_criteria : [];
  for (const token of [
    'child TaskRecord',
    'parent_task_id',
    'parent_run_id',
    'source candidate ID',
    'source handoff envelope fingerprint',
    'duplicate',
    'Queued',
    'run.inspect'
  ]) {
    requireManifestValue(
      exitCriteria.some((criterion) => typeof criterion === 'string' && criterion.includes(token)),
      `M5.11 exit_criteria must mention ${token}.`
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
  for (const token of evidence.rust_store_tokens ?? []) {
    requireToken('crates/brownie-store/src/lib.rs', token);
  }
  for (const token of evidence.rust_runtime_tokens ?? []) {
    requireToken('crates/brownie-runtime/src/lib.rs', token);
  }
  for (const token of evidence.vsix_protocol_tokens ?? []) {
    requireToken('extensions/brownie-vsix/src/runtime/protocol.ts', token);
  }

  const runtimeText = readText('crates/brownie-runtime/src/lib.rs');
  const storeText = readText('crates/brownie-store/src/lib.rs');
  const forbiddenWrapperEvents = [
    'SubtaskDispatchTicketRecorded',
    'SubtaskAdmissionTokenRecorded',
    'SubtaskSchedulerPacketRecorded',
    'SubtaskHandoffReceiptRecorded'
  ];
  for (const token of forbiddenWrapperEvents) {
    if (runtimeText.includes(token) || storeText.includes(token)) {
      errors.push(`M5.11 must not add wrapper-only event ${token}.`);
    }
  }
}

const manifest = readJson('docs/architecture/phase-value-manifest.m5.11.json');
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
