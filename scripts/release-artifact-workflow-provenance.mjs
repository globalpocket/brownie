import { execFileSync } from 'node:child_process';

const gitObjectId = /^[0-9a-f]{40}$/u;
const positiveInteger = /^[1-9][0-9]*$/u;

export function artifactWorkflowProvenance(repoRoot, workflowRunId, env = process.env) {
  if (env.BROWNIE_RELEASE_REQUIRE_WORKFLOW_PROVENANCE !== '1') return {};
  if (env.GITHUB_ACTIONS !== 'true' || !positiveInteger.test(env.GITHUB_RUN_ID ?? '')
      || workflowRunId !== env.GITHUB_RUN_ID || !positiveInteger.test(env.GITHUB_RUN_ATTEMPT ?? '')
      || !gitObjectId.test(env.GITHUB_SHA ?? '')) {
    throw new Error('release artifact evidence requires an exact GitHub workflow run and attempt');
  }
  const testedCommit = execFileSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'],
    { cwd: repoRoot, encoding: 'utf8', timeout: 10000 }).trim();
  if (testedCommit !== env.GITHUB_SHA) {
    throw new Error('release artifact checkout differs from the GitHub tested commit');
  }
  return { tested_commit: testedCommit, workflow_run_attempt: env.GITHUB_RUN_ATTEMPT };
}
