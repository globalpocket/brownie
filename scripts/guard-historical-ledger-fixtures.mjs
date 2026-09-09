#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { requiredReleaseGateCommands } from './release-gate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');

export const HISTORICAL_LEDGER_GUARD_COMMAND =
  'pnpm --workspace-root guard:historical-ledger-fixtures';
export const HISTORICAL_LEDGER_GUARD_TEST_COMMAND =
  'pnpm --workspace-root guard:historical-ledger-fixtures:test';

const defaultPackagePath = 'package.json';
const defaultVsixPackagePath = 'extensions/brownie-vsix/package.json';
const defaultStorePath = 'crates/brownie-store/src/lib.rs';
const defaultFixtureRoot = 'crates/brownie-store/tests/fixtures/historical-ledger';
const v1ManifestPath = `${defaultFixtureRoot}/v1-running-task/.brownie/store-schema.json`;
const v1StatePath = `${defaultFixtureRoot}/v1-running-task/.brownie/runs/run_historical_v1_running_task/state.json`;
const v1LedgerPath = `${defaultFixtureRoot}/v1-running-task/.brownie/runs/run_historical_v1_running_task/ledger.jsonl`;
const v1AdmissionPath =
  `${defaultFixtureRoot}/v1-running-task/.brownie/headless-objective-admissions/rrp-4-1-v1-fixture-admission.json`;
const mismatchLedgerPath =
  `${defaultFixtureRoot}/mismatched-payload-envelope/runs/run_historical_mismatched_envelope/ledger.jsonl`;

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
    return JSON.parse(readText(repoRoot, relativePath, errors));
  } catch (error) {
    errors.push(`${relativePath} must be readable JSON: ${error.message}`);
    return {};
  }
}

function parseJsonl(text, label, errors) {
  const lines = String(text)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      errors.push(`${label} line ${index + 1} must be JSON: ${error.message}`);
      return {};
    }
  });
}

function requireValue(condition, errors, message) {
  if (!condition) {
    errors.push(message);
  }
}

function commandString(entry) {
  return [entry.command, ...(entry.args ?? [])].join(' ');
}

function splitScriptCommands(script) {
  return String(script ?? '')
    .split('&&')
    .map((part) => part.trim())
    .filter(Boolean);
}

function hasExactScriptCommand(script, command) {
  return splitScriptCommands(script).includes(command);
}

export function validateHistoricalLedgerFixtures(options = {}) {
  const errors = [];
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const packageJson =
    options.packageJson ?? readJson(repoRoot, options.packagePath ?? defaultPackagePath, errors);
  const vsixPackageJson =
    options.vsixPackageJson ??
    readJson(repoRoot, options.vsixPackagePath ?? defaultVsixPackagePath, errors);
  const storeText = options.storeText ?? readText(repoRoot, options.storePath ?? defaultStorePath, errors);
  const releaseGateCommands = options.releaseGateCommands ?? requiredReleaseGateCommands;
  const fixtures = {
    v1Manifest:
      options.v1Manifest ?? readJson(repoRoot, options.v1ManifestPath ?? v1ManifestPath, errors),
    v1State: options.v1State ?? readJson(repoRoot, options.v1StatePath ?? v1StatePath, errors),
    v1LedgerText:
      options.v1LedgerText ?? readText(repoRoot, options.v1LedgerPath ?? v1LedgerPath, errors),
    v1Admission:
      options.v1Admission ?? readJson(repoRoot, options.v1AdmissionPath ?? v1AdmissionPath, errors),
    mismatchLedgerText:
      options.mismatchLedgerText ??
      readText(repoRoot, options.mismatchLedgerPath ?? mismatchLedgerPath, errors)
  };

  requireValue(
    packageJson.scripts?.['guard:historical-ledger-fixtures'] ===
      'node scripts/guard-historical-ledger-fixtures.mjs',
    errors,
    `${defaultPackagePath} must define guard:historical-ledger-fixtures.`
  );
  requireValue(
    packageJson.scripts?.['guard:historical-ledger-fixtures:test'] ===
      'node --test scripts/guard-historical-ledger-fixtures.test.mjs',
    errors,
    `${defaultPackagePath} must define guard:historical-ledger-fixtures:test.`
  );
  requireValue(
    hasExactScriptCommand(vsixPackageJson.scripts?.check, HISTORICAL_LEDGER_GUARD_COMMAND),
    errors,
    `${defaultVsixPackagePath} check must invoke ${HISTORICAL_LEDGER_GUARD_COMMAND}.`
  );
  requireValue(
    hasExactScriptCommand(vsixPackageJson.scripts?.check, HISTORICAL_LEDGER_GUARD_TEST_COMMAND),
    errors,
    `${defaultVsixPackagePath} check must invoke ${HISTORICAL_LEDGER_GUARD_TEST_COMMAND}.`
  );
  const releaseGateCommandSet = new Set((releaseGateCommands ?? []).map(commandString));
  requireValue(
    releaseGateCommandSet.has(HISTORICAL_LEDGER_GUARD_COMMAND),
    errors,
    `release:gate required commands must include ${HISTORICAL_LEDGER_GUARD_COMMAND}.`
  );
  requireValue(
    releaseGateCommandSet.has(HISTORICAL_LEDGER_GUARD_TEST_COMMAND),
    errors,
    `release:gate required commands must include ${HISTORICAL_LEDGER_GUARD_TEST_COMMAND}.`
  );

  for (const token of [
    'durable_schema_v1_historical_fixture_preserves_task_run_ledger_checkpoint_and_resume_identity',
    'ledger_read_rejects_historical_mismatched_payload_envelope_fixture',
    'copy_historical_ledger_fixture'
  ]) {
    requireValue(storeText.includes(token), errors, `${defaultStorePath} must include ${token}.`);
  }
  requireValue(
    storeText.includes('historical-ledger') && storeText.includes('fixtures') && storeText.includes('tests'),
    errors,
    `${defaultStorePath} must load repo-fixed historical ledger fixtures from tests/fixtures/historical-ledger.`
  );

  requireValue(fixtures.v1Manifest.store_schema_version === 1, errors, `${v1ManifestPath} must be a schema v1 fixture.`);
  requireValue(fixtures.v1Manifest.migration === 'initialized-v1', errors, `${v1ManifestPath} must preserve initialized-v1 migration state.`);
  requireValue(!Object.hasOwn(fixtures.v1Manifest, 'layout'), errors, `${v1ManifestPath} must not include a v2 store-layout marker.`);

  requireValue(
    fixtures.v1State.task_id === 'task_historical_v1_running_task' &&
      fixtures.v1State.run_id === 'run_historical_v1_running_task' &&
      fixtures.v1State.status === 'Running',
    errors,
    `${v1StatePath} must preserve the running task/run identity used by the v1 ledger fixture.`
  );
  requireValue(
    fixtures.v1Admission.task_id === fixtures.v1State.task_id &&
      fixtures.v1Admission.run_id === fixtures.v1State.run_id &&
      fixtures.v1Admission.admission_id === 'rrp-4-1-v1-fixture-admission',
    errors,
    `${v1AdmissionPath} must preserve resumable admission identity for the historical v1 fixture.`
  );

  const v1Ledger = parseJsonl(fixtures.v1LedgerText, v1LedgerPath, errors);
  requireValue(v1Ledger.length === 2, errors, `${v1LedgerPath} must contain exactly two historical lifecycle events.`);
  requireValue(
    v1Ledger.map((event) => event.kind).join(',') === 'TaskStarted,TaskRunning',
    errors,
    `${v1LedgerPath} must preserve TaskStarted -> TaskRunning ordering.`
  );
  requireValue(
    v1Ledger.every((event) => event.task_id === fixtures.v1State.task_id && event.run_id === fixtures.v1State.run_id),
    errors,
    `${v1LedgerPath} events must match the fixed historical task/run identity.`
  );
  requireValue(
    v1Ledger.every((event) => !Object.hasOwn(event, 'payload_envelope')),
    errors,
    `${v1LedgerPath} must remain a pre-envelope historical ledger fixture.`
  );

  const mismatchLedger = parseJsonl(fixtures.mismatchLedgerText, mismatchLedgerPath, errors);
  const mismatch = mismatchLedger[0] ?? {};
  requireValue(mismatchLedger.length === 1, errors, `${mismatchLedgerPath} must contain one replay-rejection fixture event.`);
  requireValue(mismatch.kind === 'TaskCompleted', errors, `${mismatchLedgerPath} must exercise terminal payload validation.`);
  requireValue(mismatch.payload?.status === 'Completed', errors, `${mismatchLedgerPath} must include a terminal completion payload.`);
  requireValue(
    mismatch.payload_envelope?.schema_version === 3 &&
      mismatch.payload_envelope?.instance_shape_fingerprint === 'shape-fnv1a64:0000000000000000',
    errors,
    `${mismatchLedgerPath} must keep the mismatched instance fingerprint replay-rejection fixture.`
  );

  return errors;
}

export function runHistoricalLedgerFixturesGuard(options = {}) {
  return {
    errors: validateHistoricalLedgerFixtures(options)
  };
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const result = runHistoricalLedgerFixturesGuard();
  if (result.errors.length > 0) {
    console.error('Historical ledger fixtures guard failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log('Historical ledger fixtures guard passed.');
}
