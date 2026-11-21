import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { artifactWorkflowProvenance } from './release-artifact-workflow-provenance.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repoRoot, encoding: 'utf8'}).trim();
const env = {
  BROWNIE_RELEASE_REQUIRE_WORKFLOW_PROVENANCE: '1',
  GITHUB_ACTIONS: 'true',
  GITHUB_SHA: head,
  GITHUB_RUN_ID: '42',
  GITHUB_RUN_ATTEMPT: '2',
};
test('records the actual checkout OID and GitHub run attempt', () => {
  assert.deepEqual(artifactWorkflowProvenance(repoRoot, '42', env),
    {tested_commit: head, workflow_run_attempt: '2'});
});
test('local fixtures do not claim workflow provenance', () => {
  assert.deepEqual(artifactWorkflowProvenance(repoRoot, 'fixture', {}), {});
});
test('rejects a different checkout commit or a SHA-256 in the commit field', () => {
  assert.throws(() => artifactWorkflowProvenance(repoRoot, '42', {...env,GITHUB_SHA:'0'.repeat(40)}), /checkout differs/);
  assert.throws(() => artifactWorkflowProvenance(repoRoot, '42', {...env,GITHUB_SHA:'0'.repeat(64)}), /exact GitHub workflow/);
});
test('rejects a foreign run or absent attempt', () => {
  assert.throws(() => artifactWorkflowProvenance(repoRoot, '41', env), /exact GitHub workflow/);
  assert.throws(() => artifactWorkflowProvenance(repoRoot, '42', {...env,GITHUB_RUN_ATTEMPT:''}), /exact GitHub workflow/);
});
