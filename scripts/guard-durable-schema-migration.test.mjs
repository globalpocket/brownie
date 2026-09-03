import test from 'node:test';
import assert from 'node:assert/strict';

import { validateDurableSchemaMigration } from './guard-durable-schema-migration.mjs';

function validFixture() {
  return {
    storeText: [
      'pub const DURABLE_STORE_SCHEMA_VERSION: u64 = 2;',
      'const DURABLE_STORE_SCHEMA_STATE_MIGRATION_IN_PROGRESS: &str = "migration_in_progress";',
      'const DURABLE_STORE_LAYOUT_MANIFEST: &str = "store-layout.json";',
      'const DURABLE_SCHEMA_MIGRATIONS: &[DurableSchemaMigration] = &[DurableSchemaMigration { from_version: 1, to_version: 2 }];',
      'fn durable_schema_migration_in_progress_manifest() {}',
      'fn migrate_durable_schema_manifest_locked() {}',
      'fn write_durable_store_layout_manifest() {}',
      'fn validate_durable_store_layout_manifest() {}',
      'fn durable_schema_v1_manifest_migrates_to_v2_layout() {}',
      'fn durable_schema_in_progress_migration_resumes_idempotently_without_layout_marker() {}',
      'fn durable_schema_in_progress_migration_resumes_after_layout_marker_write() {}',
      'fn durable_schema_partial_migration_conflict_fails_closed_before_mutation() {}',
      'fn durable_schema_process_loss_migration_resumes_after_each_durable_checkpoint() {}',
      'fn durable_schema_v1_fixture_preserves_task_run_ledger_checkpoint_and_resume_identity() {}'
    ].join('\n'),
    packageText: '"guard:durable-schema-migration": "node scripts/guard-durable-schema-migration.mjs"',
    vsixPackageText: 'pnpm --workspace-root guard:durable-schema-migration',
    audit: {
      runtime_release_ready: false,
      release_ready_blocked_by: [
        'runtime-release-guard-ci',
        'protocol-event-canonization',
        'platform-deadline-durability-hardening'
      ],
      classifications: [
        {
          id: 'durable-schema-version-and-migration',
          status: 'implemented_sufficient',
          debt_classification: 'closed',
          evidence: [
            'RRP-4.1 migrates v1 to v2 with migration_in_progress, store-layout.json, process-loss recovery, v1 task/run/ledger fixture preservation, and partial migration checks.'
          ]
        }
      ]
    }
  };
}

test('valid durable schema migration evidence passes', () => {
  assert.deepEqual(validateDurableSchemaMigration(validFixture()), []);
});

test('guard fails without real v1 to v2 migration registry', () => {
  const fixture = validFixture();
  fixture.storeText = fixture.storeText.replace('to_version: 2', 'to_version: 1');

  assert.match(validateDurableSchemaMigration(fixture).join('\n'), /migration registry/);
});

test('guard fails when interrupted migration evidence is absent', () => {
  const fixture = validFixture();
  fixture.storeText = fixture.storeText.replace('fn durable_schema_in_progress_migration_resumes_after_layout_marker_write() {}', '');

  assert.match(validateDurableSchemaMigration(fixture).join('\n'), /resumes_after_layout_marker_write/);
});

test('guard fails when process-loss migration evidence is absent', () => {
  const fixture = validFixture();
  fixture.storeText = fixture.storeText.replace('fn durable_schema_process_loss_migration_resumes_after_each_durable_checkpoint() {}', '');

  assert.match(validateDurableSchemaMigration(fixture).join('\n'), /process_loss_migration/);
});

test('guard fails when v1 durable artifact preservation evidence is absent', () => {
  const fixture = validFixture();
  fixture.storeText = fixture.storeText.replace('fn durable_schema_v1_fixture_preserves_task_run_ledger_checkpoint_and_resume_identity() {}', '');

  assert.match(validateDurableSchemaMigration(fixture).join('\n'), /v1_fixture_preserves/);
});

test('guard fails when later reopened blockers are hidden', () => {
  const fixture = validFixture();
  fixture.audit.release_ready_blocked_by = ['runtime-release-guard-ci'];

  assert.match(validateDurableSchemaMigration(fixture).join('\n'), /protocol-event-canonization/);
});
