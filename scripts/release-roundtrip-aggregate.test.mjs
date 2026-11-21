import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateRoundtripReceipts, measureRoundtripArtifact } from './release-roundtrip-aggregate.mjs';

const subject = {
  source_commit: 'a'.repeat(40),
  tested_commit: 'b'.repeat(40),
  workflow_run_id: '42',
  workflow_run_attempt: '2',
};
const targets = ['linux-x64', 'darwin-arm64', 'win32-x64'];
const artifactBytes = target => ({
  package: Buffer.from(`${target} package`),
  cli: Buffer.from(`${target} CLI`),
  runtime: Buffer.from(`${target} Runtime`),
});
const receipts = targets.map(target => ({ ...subject, target, artifact: measureRoundtripArtifact(artifactBytes(target)) }));

test('matches each declared target to independently measured package and executable bytes', async () => {
  const verified = await aggregateRoundtripReceipts(subject, targets, receipts.toReversed(), artifactBytes);
  assert.deepEqual(verified, {
    ...subject,
    targets: receipts.map(({target, artifact}) => ({target, artifact})),
  });
});

test('rejects missing, duplicated and foreign targets before reading artifact bytes', async () => {
  const unreadable = () => assert.fail('receipt set must be validated before artifacts are read');
  await assert.rejects(aggregateRoundtripReceipts(subject, targets, receipts.slice(1), unreadable), /Missing roundtrip targets/);
  await assert.rejects(aggregateRoundtripReceipts(subject, targets, [...receipts, receipts[0]], unreadable), /duplicate roundtrip target/);
  await assert.rejects(aggregateRoundtripReceipts(subject, targets, [{ ...receipts[0], target: 'linux-arm64' }, ...receipts.slice(1)], unreadable), /Unexpected/);
});

test('rejects foreign provenance and distinguishes Git object IDs from SHA-256', async () => {
  for (const [field, value] of [['source_commit', 'c'.repeat(40)], ['tested_commit', 'c'.repeat(40)], ['workflow_run_id', '43'], ['workflow_run_attempt', '1']]) {
    await assert.rejects(aggregateRoundtripReceipts(subject, targets, [{ ...receipts[0], [field]: value }, ...receipts.slice(1)], artifactBytes), /Foreign roundtrip subject/);
  }
  await assert.rejects(aggregateRoundtripReceipts({ ...subject, tested_commit: 'b'.repeat(64) }, targets, receipts, artifactBytes), /Invalid release roundtrip subject/);
});

test('rejects substitution of the package, CLI or Runtime bytes', async () => {
  for (const field of ['package', 'cli', 'runtime']) {
    await assert.rejects(aggregateRoundtripReceipts(subject, targets, receipts,
      target => ({ ...artifactBytes(target), [field]: Buffer.from('substituted') })), /Roundtrip digest mismatch/);
  }
});
