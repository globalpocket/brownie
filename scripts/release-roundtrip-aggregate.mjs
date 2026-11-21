import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactWorkflowProvenance } from './release-artifact-workflow-provenance.mjs';
import { extractReleaseArchive } from './release-artifact-extract.mjs';
import { runReleaseWorkflowArtifactTopologyGuard } from './guard-release-workflow-artifact-topology.mjs';

const gitObjectId = /^[0-9a-f]{40}$/u;
const sha256 = /^sha256:[0-9a-f]{64}$/u;
const positiveInteger = /^[1-9][0-9]*$/u;
const targetId = /^[a-z0-9]+(?:-[a-z0-9]+)+$/u;
const digestFields = {
  package: 'archive_sha256',
  cli: 'artifact_sha256',
  runtime: 'runtime_sha256',
};

function matchesString(value, pattern) {
  return typeof value === 'string' && pattern.test(value);
}

function requireSubject(subject) {
  if (!matchesString(subject?.source_commit, gitObjectId)
      || !matchesString(subject?.tested_commit, gitObjectId)
      || !matchesString(subject?.workflow_run_id, positiveInteger)
      || !matchesString(subject?.workflow_run_attempt, positiveInteger)) {
    throw new Error('Invalid release roundtrip subject');
  }
}

function sameSubject(left, right) {
  return left.source_commit === right.source_commit && left.tested_commit === right.tested_commit
    && left.workflow_run_id === right.workflow_run_id && left.workflow_run_attempt === right.workflow_run_attempt;
}

export function measureRoundtripArtifact(bytes) {
  return Object.fromEntries(Object.entries(digestFields).map(([kind, field]) => {
    const data = bytes?.[kind];
    if (!(data instanceof Uint8Array) || data.byteLength === 0) {
      throw new Error(`Missing local ${kind} bytes`);
    }
    return [field, `sha256:${createHash('sha256').update(data).digest('hex')}`];
  }));
}

export async function aggregateRoundtripReceipts(subject, targets, receipts, readArtifact) {
  requireSubject(subject);
  if (!Array.isArray(targets) || targets.length === 0
      || targets.some(target => !matchesString(target, targetId))
      || new Set(targets).size !== targets.length) {
    throw new Error('Invalid declared roundtrip targets');
  }
  const expected = new Set(targets);
  const byTarget = new Map();
  for (const receipt of receipts) {
    if (!expected.has(receipt?.target) || byTarget.has(receipt.target)) {
      throw new Error(`Unexpected or duplicate roundtrip target: ${receipt?.target}`);
    }
    if (!sameSubject(receipt, subject)) throw new Error(`Foreign roundtrip subject: ${receipt.target}`);
    for (const field of Object.values(digestFields)) {
      if (!matchesString(receipt.artifact?.[field], sha256)) {
        throw new Error(`Invalid ${field}: ${receipt.target}`);
      }
    }
    byTarget.set(receipt.target, receipt);
  }
  if (byTarget.size !== expected.size) {
    throw new Error(`Missing roundtrip targets: ${targets.filter(target => !byTarget.has(target)).join(', ')}`);
  }
  const verified = [];
  for (const target of targets) {
    const actual = measureRoundtripArtifact(await readArtifact(target));
    for (const field of Object.values(digestFields)) {
      if (actual[field] !== byTarget.get(target).artifact[field]) {
        throw new Error(`Roundtrip digest mismatch: ${target} ${field}`);
      }
    }
    verified.push({ target, artifact: actual });
  }
  return { ...subject, targets: verified };
}

function readFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > 128 * 1024 * 1024) throw new Error(`Expected a bounded ordinary artifact file: ${file}`);
  return fs.readFileSync(file);
}

function packageBytes(directory, target) {
  const windows = target.startsWith('win32-');
  const extension = windows ? '.exe' : '';
  const layout = { archiveType: windows ? 'zip' : 'tar', binaryName: 'brownie' + extension, runtimeName: 'brownie-runtime' + extension };
  const archive = path.join(directory, `brownie-${target}${windows ? '.zip' : '.tar.gz'}`);
  const original = readFile(archive);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-roundtrip-aggregate-'));
  try {
    extractReleaseArchive(layout, archive, temporary);
    if (!original.equals(readFile(archive))) throw new Error('Archive changed during extraction');
    return { package: original, cli: readFile(path.join(temporary, layout.binaryName)),
      runtime: readFile(path.join(temporary, layout.runtimeName)) };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function writeReceipt(destination, value) {
  fs.writeFileSync(destination, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}

export function targetReceipt(subject, root, directory, target) {
  requireSubject(subject);
  if (!matchesString(target, targetId)) throw new Error('Invalid roundtrip target');
  const artifact = measureRoundtripArtifact(packageBytes(directory, target));
  const collectorFields = { archive_sha256: 'package_sha256', artifact_sha256: 'binary_sha256', runtime_sha256: 'runtime_sha256' };
  const supplyCollector = 'supply-chain-artifact-evidence.json';
  for (const file of ['runtime-operational-evidence.json', supplyCollector]) {
    const collected = JSON.parse(readFile(path.join(root, file)));
    const complete = collected.release_evidence_binding?.bindings.filter(binding => binding.status === 'satisfied') ?? [];
    const [binding] = complete;
    if ((file === supplyCollector && collected.source_commit !== subject.source_commit) || complete.length !== 1
        || binding?.target !== target || binding.status !== 'satisfied' || binding.errors?.length !== 0
        || binding.implementation_commit !== `sha256:${subject.source_commit}`
        || binding.tested_commit !== subject.tested_commit || binding.workflow_run_id !== subject.workflow_run_id
        || Object.entries(collectorFields).some(([field, observed]) => artifact[field] !== binding[observed])) {
      throw new Error(`Collector evidence mismatch: ${target} ${file}`);
    }
  }
  for (const kind of ['journey', 'stateful-soak']) {
    const evidence = JSON.parse(readFile(path.join(directory, `runtime-${kind}-evidence.json`)));
    const id = kind === 'journey' ? 'brownie-release-artifact-runtime-journey-v1' : 'brownie-release-artifact-stateful-soak-v1';
    const checks = Object.values(evidence.checks ?? {});
    if (evidence.evidence_id !== id || evidence.target !== target
        || evidence.tested_commit !== subject.tested_commit || evidence.workflow_run_id !== subject.workflow_run_id
        || evidence.workflow_run_attempt !== subject.workflow_run_attempt
        || checks.length === 0 || checks.some(check => check?.passed !== true)
        || Object.keys(artifact).some(field => artifact[field] !== evidence.artifact?.[field])) {
      throw new Error(`Roundtrip evidence mismatch: ${target} ${kind}`);
    }
  }
  return { ...subject, target, artifact };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const [mode, argument] = process.argv.slice(2);
  const workflow_run_id = process.env.GITHUB_RUN_ID;
  const provenance = artifactWorkflowProvenance(root, workflow_run_id);
  const subject = { source_commit: provenance.tested_commit, workflow_run_id, ...provenance };
  requireSubject(subject);
  const { targetSet: targets } = runReleaseWorkflowArtifactTopologyGuard({ repoRoot: root });
  if (mode === 'target' && targets.includes(argument)) {
    const evidenceRoot = path.join(root, '.brownie/release-evidence');
    const directory = path.join(evidenceRoot, 'artifacts', argument);
    writeReceipt(path.join(directory, 'roundtrip-target-receipt.json'), targetReceipt(subject, evidenceRoot, directory, argument));
    return;
  }
  if (mode !== 'aggregate' || !argument) throw new Error('Expected target <target> or aggregate <download-directory>');
  const bundles = targets.map(target => `release-evidence-${target}`);
  const observed = fs.readdirSync(argument).sort();
  if (JSON.stringify(observed) !== JSON.stringify(bundles.toSorted())) throw new Error('Downloaded bundles differ from the declared release targets');
  const directory = target => path.join(argument, `release-evidence-${target}`, 'artifacts', target);
  const receipts = targets.map(target => JSON.parse(readFile(path.join(directory(target), 'roundtrip-target-receipt.json'))));
  const aggregate = await aggregateRoundtripReceipts(subject, targets, receipts, target => packageBytes(directory(target), target));
  writeReceipt('release-roundtrip-aggregate.json', aggregate);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
