import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');

function readText(repoRoot, relativePath, errors) {
  try {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
  } catch (error) {
    errors.push(`${relativePath} must be readable: ${error.message}`);
    return '';
  }
}

function readJson(repoRoot, relativePath, errors) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
  } catch (error) {
    errors.push(`${relativePath} must be readable JSON: ${error.message}`);
    return {};
  }
}

function requireValue(condition, errors, message) {
  if (!condition) {
    errors.push(message);
  }
}

function evidenceText(item) {
  return Array.isArray(item?.evidence) ? item.evidence.join('\n') : '';
}

export function validateDurableSchemaMigration({ storeText, audit, packageText, vsixPackageText }) {
  const errors = [];

  requireValue(
    /pub const DURABLE_STORE_SCHEMA_VERSION:\s*u64\s*=\s*2;/.test(storeText),
    errors,
    'brownie-store must advance the durable store schema to v2 for a real migration target.'
  );
  requireValue(
    storeText.includes('DURABLE_SCHEMA_MIGRATIONS') && storeText.includes('from_version: 1') && storeText.includes('to_version: 2'),
    errors,
    'brownie-store must declare an explicit durable schema migration registry containing 1 -> 2.'
  );
  for (const token of [
    'DURABLE_STORE_SCHEMA_STATE_MIGRATION_IN_PROGRESS',
    'durable_schema_migration_in_progress_manifest',
    'migrate_durable_schema_manifest_locked',
    'write_durable_store_layout_manifest',
    'validate_durable_store_layout_manifest',
    'DURABLE_STORE_LAYOUT_MANIFEST'
  ]) {
    requireValue(storeText.includes(token), errors, `brownie-store must include ${token}.`);
  }
  for (const testName of [
    'durable_schema_v1_manifest_migrates_to_v2_layout',
    'durable_schema_in_progress_migration_resumes_idempotently_without_layout_marker',
    'durable_schema_in_progress_migration_resumes_after_layout_marker_write',
    'durable_schema_partial_migration_conflict_fails_closed_before_mutation',
    'durable_schema_process_loss_migration_resumes_after_each_durable_checkpoint',
    'durable_schema_v1_fixture_preserves_task_run_ledger_checkpoint_and_resume_identity'
  ]) {
    requireValue(storeText.includes(testName), errors, `brownie-store tests must include ${testName}.`);
  }

  const byId = new Map((Array.isArray(audit.classifications) ? audit.classifications : []).map((item) => [item.id, item]));
  const durable = byId.get('durable-schema-version-and-migration');
  requireValue(durable?.status === 'implemented_sufficient', errors, 'durable-schema-version-and-migration must remain implemented_sufficient after RRP-4.1.');
  requireValue(durable?.debt_classification === 'closed', errors, 'durable-schema-version-and-migration must be closed after RRP-4.1.');
  const durableEvidence = evidenceText(durable);
  for (const token of ['RRP-4.1', 'v1 to v2', 'migration_in_progress', 'store-layout.json', 'process-loss', 'v1 task/run/ledger fixture', 'partial migration']) {
    requireValue(durableEvidence.includes(token), errors, `durable schema evidence must mention ${token}.`);
  }

  const blockedBy = new Set(Array.isArray(audit.release_ready_blocked_by) ? audit.release_ready_blocked_by : []);
  requireValue(blockedBy.has('runtime-release-guard-ci'), errors, 'release_ready_blocked_by must include reopened blocker runtime-release-guard-ci.');
  const protocolCanonization = byId.get('protocol-event-canonization');
  const protocolCanonizationClosed =
    protocolCanonization?.status === 'implemented_sufficient' &&
    protocolCanonization?.debt_classification === 'closed';
  if (protocolCanonizationClosed) {
    const protocolEvidence = evidenceText(protocolCanonization);
    for (const token of ['RRP-5.1', 'runtime-semantic-protocol-contract.json', 'unknown-field', 'durable event migration coupling']) {
      requireValue(protocolEvidence.includes(token), errors, `closed protocol-event-canonization evidence must mention ${token}.`);
    }
  } else {
    requireValue(blockedBy.has('protocol-event-canonization'), errors, 'release_ready_blocked_by must include reopened blocker protocol-event-canonization until RRP-5.1 closes it.');
  }
  const platformDeadline = byId.get('platform-deadline-durability-hardening');
  const platformDeadlineClosed =
    platformDeadline?.status === 'implemented_sufficient' &&
    platformDeadline?.debt_classification === 'closed';
  requireValue(
    platformDeadlineClosed || blockedBy.has('platform-deadline-durability-hardening'),
    errors,
    'release_ready_blocked_by must include platform-deadline-durability-hardening unless RRP-7.1 has closed it.'
  );
  requireValue(audit.runtime_release_ready === false, errors, 'runtime_release_ready must remain false.');

  requireValue(
    packageText.includes('guard:durable-schema-migration'),
    errors,
    'workspace package.json must expose guard:durable-schema-migration.'
  );
  requireValue(
    vsixPackageText.includes('pnpm --workspace-root guard:durable-schema-migration'),
    errors,
    'VSIX check path must run guard:durable-schema-migration.'
  );

  return errors;
}

export function runDurableSchemaMigrationGuard(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const readErrors = [];
  const storeText = options.storeText ?? readText(repoRoot, 'crates/brownie-store/src/lib.rs', readErrors);
  const packageText = options.packageText ?? readText(repoRoot, 'package.json', readErrors);
  const vsixPackageText = options.vsixPackageText ?? readText(repoRoot, 'extensions/brownie-vsix/package.json', readErrors);
  const audit = options.audit ?? readJson(repoRoot, 'docs/architecture/runtime-release-readiness-audit.json', readErrors);
  return {
    errors: [
      ...readErrors,
      ...validateDurableSchemaMigration({ storeText, audit, packageText, vsixPackageText })
    ]
  };
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const result = runDurableSchemaMigrationGuard();
  if (result.errors.length > 0) {
    console.error('Durable schema migration guard failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log('Durable schema migration guard passed.');
}
