import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const errors = [];
const phase = 'M5.17';
const manifestPath = 'docs/architecture/phase-value-manifest.m5.17.json';

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
    manifest.concrete_capability_transition === 'completed_child_parent_join_continuation',
    `${phase} must declare the completed child parent join continuation transition.`
  );
  requireManifestValue(
    manifest.forbidden_pattern === 'additional_blocked_summary_event_wrapper_without_parent_join_continuation',
    `${phase} must forbid adding another blocked summary wrapper without parent join continuation.`
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
    'completed controlled child tasks',
    'parent join continuation',
    'child_completion_summaries',
    'bounded completion_summary_preview and final_response_preview',
    'Non-controlled child tasks do not satisfy parent join continuation',
    'No raw child prompts',
    'Parent task.run does not auto-run child tasks',
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
  for (const token of evidence.rust_tools_tokens ?? []) {
    requireToken('crates/brownie-tools/src/lib.rs', token);
  }
  for (const token of evidence.rust_store_tokens ?? []) {
    requireToken('crates/brownie-store/src/lib.rs', token);
  }
  for (const token of evidence.rust_protocol_tokens ?? []) {
    requireToken('crates/brownie-protocol/src/lib.rs', token);
  }
  for (const token of evidence.rust_context_tokens ?? []) {
    requireToken('crates/brownie-context/src/lib.rs', token);
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
    'SubtaskHandoffReceiptRecorded',
    'SubtaskChildRunAdmissionSummaryRecorded',
    'SubtaskChildRunResultSummaryRecorded'
  ];
  for (const token of forbiddenWrapperEvents) {
    if (runtimeText.includes(token) || storeText.includes(token)) {
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
