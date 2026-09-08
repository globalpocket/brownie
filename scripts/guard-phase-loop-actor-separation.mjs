import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultPolicyPath = 'docs/architecture/phase-loop-actor-separation-policy.json';

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

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

function requireValue(condition, errors, message) {
  if (!condition) {
    errors.push(message);
  }
}

export function runPhaseLoopActorSeparationGuard(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const policyPath = options.policyPath ?? defaultPolicyPath;
  const errors = [];
  const policy = options.policy ?? readJson(repoRoot, policyPath, errors);
  const packageJson = options.packageJson ?? readJson(repoRoot, 'package.json', errors);
  const vsixPackageJson = options.vsixPackageJson ?? readJson(repoRoot, 'extensions/brownie-vsix/package.json', errors);
  const gitignore = options.gitignore ?? readText(repoRoot, '.gitignore', errors);
  const createWindowsVm = options.createWindowsVm ?? readText(repoRoot, 'scripts/create-windows-release-vm.mjs', errors);
  const manageVmImages = options.manageVmImages ?? readText(repoRoot, 'scripts/manage-release-vm-images.mjs', errors);
  const bootstrapVms = options.bootstrapVms ?? readText(repoRoot, 'scripts/bootstrap-release-vms.mjs', errors);

  requireValue(policy.schema_version === 1, errors, `${policyPath} schema_version must be 1.`);
  requireValue(policy.policy_id === 'brownie-phase-loop-actor-separation-v1', errors, `${policyPath} policy_id must match.`);
  requireValue(policy.repository === 'globalpocket/brownie', errors, `${policyPath} repository must be globalpocket/brownie.`);
  requireValue(policy.implementation_actor === 'brownie-agent', errors, `${policyPath} implementation_actor must be brownie-agent.`);
  requireValue(policy.review_actor === 'globalpocket', errors, `${policyPath} review_actor must be globalpocket.`);
  requireValue(policy.merge_actor === 'globalpocket', errors, `${policyPath} merge_actor must be globalpocket.`);
  requireValue(policy.implementation_actor !== policy.review_actor, errors, `${policyPath} implementation_actor and review_actor must differ.`);
  requireValue(
    Array.isArray(policy.forbidden_success_claims) &&
      policy.forbidden_success_claims.some((claim) => /static review JSON/i.test(claim)),
    errors,
    `${policyPath} must forbid static review JSON as concrete GitHub review provenance.`
  );
  requireValue(
    Array.isArray(policy.requirements) &&
      policy.requirements.some((requirement) => requirement.includes('.brownie/private/')),
    errors,
    `${policyPath} requirements must place private local state under .brownie/private/.`
  );

  requireValue(gitignore.includes('.brownie/private/'), errors, '.gitignore must ignore .brownie/private/.');
  requireValue(!/^\.brownie\/\s*$/m.test(gitignore), errors, '.gitignore must not ignore all of .brownie/.');
  for (const [owner, text] of [
    ['scripts/create-windows-release-vm.mjs', createWindowsVm],
    ['scripts/manage-release-vm-images.mjs', manageVmImages],
    ['scripts/bootstrap-release-vms.mjs', bootstrapVms]
  ]) {
    requireValue(text.includes('.brownie/private/'), errors, `${owner} must use .brownie/private/ for private local VM state.`);
    requireValue(!text.includes("'.brownie/vms") && !text.includes("'.brownie/vm-images"), errors, `${owner} must not use legacy .brownie/vms or .brownie/vm-images paths.`);
  }

  requireValue(packageJson.scripts?.['phase-loop:implementation-preflight'] === 'node scripts/phase-loop-actor-preflight.mjs --role implementation', errors, 'package.json must define phase-loop:implementation-preflight.');
  requireValue(packageJson.scripts?.['phase-loop:review-preflight'] === 'node scripts/phase-loop-actor-preflight.mjs --role review', errors, 'package.json must define phase-loop:review-preflight.');
  requireValue(packageJson.scripts?.['guard:phase-loop-actor-separation'] === 'node scripts/guard-phase-loop-actor-separation.mjs', errors, 'package.json must define guard:phase-loop-actor-separation.');
  requireValue(packageJson.scripts?.['guard:phase-loop-actor-separation:test'] === 'node --test scripts/guard-phase-loop-actor-separation.test.mjs', errors, 'package.json must define guard:phase-loop-actor-separation:test.');
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root guard:phase-loop-actor-separation'), errors, 'VSIX check must invoke guard:phase-loop-actor-separation.');
  requireValue(vsixPackageJson.scripts?.check?.includes('pnpm --workspace-root guard:phase-loop-actor-separation:test'), errors, 'VSIX check must invoke guard:phase-loop-actor-separation:test.');

  return { errors, policyPath };
}

if (isMainModule()) {
  const result = runPhaseLoopActorSeparationGuard();
  if (result.errors.length > 0) {
    console.error('Phase-loop actor separation guard failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log(`Phase-loop actor separation guard passed for ${result.policyPath}.`);
}
