import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultWorkflowPath = '.github/workflows/release.yml';

const collectorCommands = [
  'release:supply-chain-artifact-evidence',
  'guard:supply-chain-artifact-evidence',
  'release:runtime-operational-evidence',
  'guard:runtime-operational-evidence'
];

function requireMatch(text, expression, message, errors) {
  if (!expression.test(text)) errors.push(message);
}

function jobBlock(workflow, jobName) {
  const heading = new RegExp(`^  ${jobName}:\\n`, 'm');
  const match = heading.exec(workflow);
  if (!match) return '';
  const start = match.index;
  const next = /^  [A-Za-z0-9_-]+:\n/gm;
  next.lastIndex = start + match[0].length;
  const boundary = next.exec(workflow);
  return workflow.slice(start, boundary?.index);
}

function targetSet(job) {
  return [...job.matchAll(/^\s+target: ([A-Za-z0-9_-]+)$/gm)]
    .map((match) => match[1])
    .sort()
    .join(',');
}

function stepBlock(job, stepName) {
  const heading = new RegExp(`^      - name: ${stepName}\\n`, 'm');
  const match = heading.exec(job);
  if (!match) return '';
  const following = /^      - name: /gm;
  following.lastIndex = match.index + match[0].length;
  const boundary = following.exec(job);
  return job.slice(match.index, boundary?.index);
}

export function validateReleaseWorkflowArtifactTopology(workflow) {
  const errors = [];
  const build = jobBlock(workflow, 'build-and-evidence');
  const roundtrip = jobBlock(workflow, 'artifact-roundtrip');

  if (!build) errors.push('release workflow must define build-and-evidence.');
  if (!roundtrip) errors.push('release workflow must define artifact-roundtrip.');
  if (!build || !roundtrip) return errors;

  if (targetSet(build) !== targetSet(roundtrip) || targetSet(build).length === 0) {
    errors.push('artifact-roundtrip matrix targets must exactly match build-and-evidence matrix targets.');
  }
  requireMatch(roundtrip, /^    needs: build-and-evidence$/m, 'artifact-roundtrip must depend on build-and-evidence.', errors);
  requireMatch(
    build,
    /- name: Verify release workflow artifact topology\n\s+run: pnpm --workspace-root guard:release-workflow-artifact-topology/u,
    'build-and-evidence must run the artifact topology guard before building release artifacts.',
    errors
  );

  requireMatch(
    build,
    /name: artifacts-\$\{\{ matrix\.target \}\}[\s\S]*?\.brownie\/release-evidence\/artifacts\/\$\{\{ matrix\.target \}\}\//u,
    'build-and-evidence must upload each target-local release-evidence directory in artifacts-${{ matrix.target }}.',
    errors
  );
  requireMatch(
    roundtrip,
    /name: artifacts-\$\{\{ matrix\.target \}\}\n\s+path: roundtrip-download/u,
    'artifact-roundtrip must download only artifacts-${{ matrix.target }} into roundtrip-download.',
    errors
  );

  const bind = stepBlock(roundtrip, 'Bind downloaded runtime evidence to this release artifact');
  requireMatch(
    bind,
    /source_evidence_dir="roundtrip-download\/\.brownie\/release-evidence\/artifacts\/\$\{\{ matrix\.target \}\}"/u,
    'binding step must source the target-local downloaded evidence directory.',
    errors
  );
  requireMatch(
    bind,
    /bound_evidence_dir="\.brownie\/release-evidence\/artifacts\/\$\{\{ matrix\.target \}\}"/u,
    'binding step must restore evidence to the target-local collector directory.',
    errors
  );
  requireMatch(
    bind,
    /cp -R "\$source_evidence_dir"\/\. "\$bound_evidence_dir"\/[\s\S]*?cp roundtrip-download\/runtime-journey-evidence\.json "\$bound_evidence_dir\/runtime-journey-evidence\.json"[\s\S]*?cp roundtrip-download\/runtime-stateful-soak-evidence\.json "\$bound_evidence_dir\/runtime-stateful-soak-evidence\.json"[\s\S]*?rm -rf roundtrip-download/u,
    'binding step must restore artifact, journey, and soak receipts before removing the download directory.',
    errors
  );

  const collector = stepBlock(roundtrip, 'Generate and validate bound release evidence');
  requireMatch(
    collector,
    /BROWNIE_RELEASE_EVIDENCE_TARGET: \$\{\{ matrix\.target \}\}/u,
    'bound release evidence collection must set BROWNIE_RELEASE_EVIDENCE_TARGET to matrix.target.',
    errors
  );
  for (const command of collectorCommands) {
    requireMatch(collector, new RegExp(`pnpm --workspace-root ${command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u'), `bound release evidence collection must run ${command}.`, errors);
  }

  const upload = stepBlock(roundtrip, 'Upload validated bound release evidence');
  requireMatch(upload, /name: release-evidence-\$\{\{ matrix\.target \}\}/u, 'validated evidence upload must be target-scoped.', errors);
  for (const pathFragment of [
    '.brownie/release-evidence/supply-chain-artifact-evidence.json',
    '.brownie/release-evidence/runtime-operational-evidence.json',
    '.brownie/release-evidence/artifacts/${{ matrix.target }}/artifact-evidence.json',
    '.brownie/release-evidence/artifacts/${{ matrix.target }}/${{ matrix.archive_name }}',
    '.brownie/release-evidence/artifacts/${{ matrix.target }}/runtime-journey-evidence.json',
    '.brownie/release-evidence/artifacts/${{ matrix.target }}/runtime-stateful-soak-evidence.json'
  ]) {
    requireMatch(upload, new RegExp(pathFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'), `validated evidence upload must include ${pathFragment}.`, errors);
  }

  const collectorPattern = new RegExp(collectorCommands.map((command) => command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gu');
  for (const match of workflow.matchAll(collectorPattern)) {
    const offset = match.index ?? 0;
    const roundtripOffset = workflow.indexOf(roundtrip);
    const inRoundtrip = offset >= roundtripOffset && offset < roundtripOffset + roundtrip.length;
    const buildOffset = workflow.indexOf(build);
    const inBuild = offset >= buildOffset && offset < buildOffset + build.length;
    const isBuildSupplyCollector = inBuild && [
      'release:supply-chain-artifact-evidence',
      'guard:supply-chain-artifact-evidence'
    ].includes(match[0]);
    if (!inRoundtrip && !isBuildSupplyCollector) {
      errors.push(`${match[0]} must not run outside the target-scoped artifact-roundtrip job.`);
    }
  }
  const orderedStepNames = [
    'Run downloaded artifact Runtime journey',
    'Run downloaded artifact stateful soak',
    'Bind downloaded runtime evidence to this release artifact',
    'Generate and validate bound release evidence',
    'Upload validated bound release evidence'
  ];
  const positions = orderedStepNames.map((name) => roundtrip.indexOf(`- name: ${name}`));
  if (positions.some((position) => position < 0) || positions.some((position, index) => index > 0 && position <= positions[index - 1])) {
    errors.push('artifact roundtrip evidence steps must run journey, soak, binding, collection, then upload in that order.');
  }
  return errors;
}

export function runReleaseWorkflowArtifactTopologyGuard(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const workflowPath = options.workflowPath ?? defaultWorkflowPath;
  const workflow = options.workflow ?? fs.readFileSync(path.join(repoRoot, workflowPath), 'utf8');
  const errors = validateReleaseWorkflowArtifactTopology(workflow);
  if (errors.length > 0) throw new Error(`Release workflow artifact topology guard failed:\n- ${errors.join('\n- ')}`);
  return { workflowPath, targetSet: targetSet(jobBlock(workflow, 'artifact-roundtrip')).split(',') };
}

if (process.argv[1] === __filename) {
  const result = runReleaseWorkflowArtifactTopologyGuard();
  process.stdout.write(`Release workflow artifact topology guard passed for ${result.targetSet.join(', ')}.\n`);
}
