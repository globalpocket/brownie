import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultManifestPath = 'docs/architecture/phase-value-manifest.json';

const requiredValueGateAnswerIds = [
  'strategic_capabilities',
  'new_capability',
  'why_existing_functionality_is_insufficient',
  'product_gap_if_skipped',
  'non_duplicative',
  'no_new_rpc',
  'no_new_summary',
  'runtime_behavior_change',
  'headless_autonomous_contribution',
  'milestone_progress'
];

const guardEngineFiles = [
  '.github/workflows/ci.yml',
  'package.json',
  'scripts/guard-diagnostics-api.mjs',
  'scripts/guard-phase-value.mjs',
  'scripts/guard-phase-value.test.mjs',
  'docs/architecture/phase-value-gate.md',
  'docs/architecture/phase-value-manifest.json'
];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join('/').replace(/^\.\//, '');
}

function readJson(repoRoot, relativePath, errors) {
  const filePath = path.join(repoRoot, relativePath);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    errors.push(`Failed to read JSON ${relativePath}: ${error.message}`);
    return {};
  }
}

function requireValue(condition, errors, message) {
  if (!condition) {
    errors.push(message);
  }
}

function parseChangedFilesFromEnv(env) {
  const raw = env.BROWNIE_PHASE_VALUE_CHANGED_FILES;
  if (!isNonEmptyString(raw)) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    return JSON.parse(trimmed).map(normalizeRelativePath);
  }
  return trimmed
    .split(/[\n,]/)
    .map((entry) => normalizeRelativePath(entry.trim()))
    .filter(Boolean);
}

function gitChangedFiles(repoRoot, args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .map((entry) => normalizeRelativePath(entry.trim()))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function detectChangedFiles(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const env = options.env ?? process.env;
  if (Array.isArray(options.changedFiles)) {
    return [...new Set(options.changedFiles.map(normalizeRelativePath))];
  }

  const envChangedFiles = parseChangedFilesFromEnv(env);
  if (envChangedFiles !== null) {
    return [...new Set(envChangedFiles)];
  }

  const changed = [
    ...gitChangedFiles(repoRoot, ['diff', '--name-only']),
    ...gitChangedFiles(repoRoot, ['diff', '--cached', '--name-only'])
  ];

  if (isNonEmptyString(env.GITHUB_BASE_REF)) {
    const baseRef = `origin/${env.GITHUB_BASE_REF}`;
    changed.push(...gitChangedFiles(repoRoot, ['diff', '--name-only', `${baseRef}...HEAD`]));
  } else {
    changed.push(...gitChangedFiles(repoRoot, ['diff', '--name-only', 'HEAD~1...HEAD']));
  }

  return [...new Set(changed)];
}

export function findGuardEngineChangedFiles(changedFiles) {
  return changedFiles
    .map(normalizeRelativePath)
    .filter(
      (changedFile) =>
        guardEngineFiles.includes(changedFile) ||
        changedFile.startsWith('.github/workflows/') ||
        /^docs\/architecture\/phase-value-manifest\.[^.]+(?:\.[^.]+)*\.json$/.test(changedFile)
    );
}

function validatePhaseValueGate(manifest, manifestPath, errors) {
  const valueGate = manifest.phase_value_gate ?? {};
  const questions = Array.isArray(valueGate.questions) ? valueGate.questions : [];
  const answers = valueGate.answers ?? {};

  requireValue(questions.length > 0, errors, `${manifestPath} phase_value_gate.questions must be non-empty.`);
  const questionIds = new Set();
  for (const [index, question] of questions.entries()) {
    requireValue(isNonEmptyString(question.id), errors, `${manifestPath} phase_value_gate.questions[${index}].id must be non-empty.`);
    if (isNonEmptyString(question.id)) {
      questionIds.add(question.id);
      requireValue(
        isNonEmptyString(answers[question.id]),
        errors,
        `${manifestPath} phase_value_gate.answers.${question.id} must be non-empty.`
      );
    }
  }

  for (const answerId of requiredValueGateAnswerIds) {
    requireValue(questionIds.has(answerId), errors, `${manifestPath} phase_value_gate.questions must include ${answerId}.`);
    requireValue(isNonEmptyString(answers[answerId]), errors, `${manifestPath} phase_value_gate.answers.${answerId} must be non-empty.`);
  }
}

function validateGuardEngineChangeReview(manifest, manifestPath, changedFiles, errors) {
  const guardChangedFiles = findGuardEngineChangedFiles(changedFiles);
  if (guardChangedFiles.length === 0) {
    return;
  }

  const review = manifest.guard_engine_change_review ?? {};
  requireValue(review.required === true, errors, `${manifestPath} guard_engine_change_review.required must be true when guard engine files change.`);
  requireValue(review.strict_review_required === true, errors, `${manifestPath} guard_engine_change_review.strict_review_required must be true.`);
  requireValue(review.no_self_approval === true, errors, `${manifestPath} guard_engine_change_review.no_self_approval must be true.`);
  requireValue(isNonEmptyString(review.review_intent), errors, `${manifestPath} guard_engine_change_review.review_intent must be non-empty.`);

  const declaredFiles = new Set((Array.isArray(review.changed_files) ? review.changed_files : []).map(normalizeRelativePath));
  requireValue(declaredFiles.size > 0, errors, `${manifestPath} guard_engine_change_review.changed_files must be non-empty.`);
  for (const changedFile of guardChangedFiles) {
    requireValue(
      declaredFiles.has(changedFile),
      errors,
      `${manifestPath} guard_engine_change_review.changed_files must include changed guard file ${changedFile}.`
    );
  }
}

export function validatePhaseValueManifest(manifest, options = {}) {
  const errors = [];
  const manifestPath = options.manifestPath ?? defaultManifestPath;
  const changedFiles = options.changedFiles ?? [];

  requireValue(Number.isInteger(manifest.schema_version) && manifest.schema_version > 0, errors, `${manifestPath} schema_version must be a positive integer.`);
  requireValue(isNonEmptyString(manifest.phase), errors, `${manifestPath} phase must be non-empty.`);
  requireValue(isNonEmptyString(manifest.current_milestone) || isNonEmptyString(manifest.milestone), errors, `${manifestPath} current_milestone or milestone must be non-empty.`);
  requireValue(isNonEmptyString(manifest.target_capability), errors, `${manifestPath} target_capability must be non-empty.`);
  requireValue(isNonEmptyString(manifest.concrete_capability_transition), errors, `${manifestPath} concrete_capability_transition must be non-empty.`);
  requireValue(isNonEmptyString(manifest.forbidden_pattern), errors, `${manifestPath} forbidden_pattern must be non-empty.`);
  requireValue(
    isNonEmptyString(manifest.project_objective) || isNonEmptyString(manifest.project_objective_ref),
    errors,
    `${manifestPath} must include project_objective or project_objective_ref.`
  );

  const mappings = Array.isArray(manifest.strategic_capability_mapping) ? manifest.strategic_capability_mapping : [];
  requireValue(mappings.length > 0, errors, `${manifestPath} strategic_capability_mapping must be non-empty.`);
  for (const [index, mapping] of mappings.entries()) {
    requireValue(
      isNonEmptyString(mapping.capability) && isNonEmptyString(mapping.relationship),
      errors,
      `${manifestPath} strategic_capability_mapping[${index}] must include capability and relationship.`
    );
  }

  validatePhaseValueGate(manifest, manifestPath, errors);

  const reviewGate = manifest.review_value_gate ?? {};
  requireValue(
    Array.isArray(reviewGate.reject_when) && reviewGate.reject_when.length > 0,
    errors,
    `${manifestPath} review_value_gate.reject_when must be non-empty.`
  );

  const exitCriteria = Array.isArray(manifest.exit_criteria) ? manifest.exit_criteria : [];
  requireValue(exitCriteria.length > 0, errors, `${manifestPath} exit_criteria must be non-empty.`);
  for (const [index, criterion] of exitCriteria.entries()) {
    requireValue(isNonEmptyString(criterion), errors, `${manifestPath} exit_criteria[${index}] must be non-empty.`);
  }

  validateGuardEngineChangeReview(manifest, manifestPath, changedFiles, errors);

  return errors;
}

export function runPhaseValueGuard(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const manifestPath = options.manifestPath ?? process.env.BROWNIE_PHASE_VALUE_MANIFEST ?? defaultManifestPath;
  const errors = [];
  const manifest = options.manifest ?? readJson(repoRoot, manifestPath, errors);
  const changedFiles = detectChangedFiles({ repoRoot, env: options.env, changedFiles: options.changedFiles });
  errors.push(...validatePhaseValueManifest(manifest, { manifestPath, changedFiles }));
  return { errors, manifestPath, changedFiles };
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const result = runPhaseValueGuard();
  if (result.errors.length > 0) {
    console.error('Phase value guard failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`Phase value guard passed for ${result.manifestPath}.`);
}
