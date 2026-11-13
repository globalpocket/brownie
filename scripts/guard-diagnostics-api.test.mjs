import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const methods = ['proposal.reviewQueue', 'proposal.reviewQueueDiagnostics'];
const extra = 'proposal.reviewQueueDiagnosticsHistory';
const heading = '\n## Exact Current Method And Type Inventory\n';
const stem = method => 'Proposal' + method.slice('proposal.'.length).replace(/^r/, 'R');
const row = method => `| \`${method}\` | \`${stem(method)}Params\` / \`${stem(method)}Result\` | Legacy |`;

function fixture(change = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-diagnostics-inventory-'));
  const write = (name, text) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const document = '# Inventory\n' + heading + '\n| Method | Types | Status |\n|---|---|---|\n' + methods.map(row).join('\n') + '\n\n## After\n';
  const protocol = methods.flatMap(method => [`pub struct ${stem(method)}Params {}`, `pub struct ${stem(method)}Result {}`]).join('\n');
  const runtime = 'const METHOD_PROPOSAL_REVIEW_QUEUE: &str = "proposal.reviewQueue";\n' +
    'const METHOD_PROPOSAL_REVIEW_QUEUE_DIAGNOSTICS: &str = "proposal.reviewQueueDiagnostics";\n' +
    'fn dispatch() { match request { METHOD_PROPOSAL_REVIEW_QUEUE => {}, METHOD_PROPOSAL_REVIEW_QUEUE_DIAGNOSTICS => {} } }\n';
  write('scripts/guard-diagnostics-api.mjs', fs.readFileSync(path.join(source, 'scripts/guard-diagnostics-api.mjs')));
  for (const name of ['phase-value-manifest.json', 'diagnostics-legacy-api-metadata.json']) {
    write('docs/architecture/' + name, fs.readFileSync(path.join(source, 'docs/architecture', name)));
  }
  const files = { document, protocol, runtime };
  change(files);
  write('docs/architecture/diagnostics-api-consolidation.md', files.document);
  write('crates/brownie-protocol/src/lib.rs', files.protocol);
  write('crates/brownie-runtime/src/lib.rs', files.runtime);
  try {
    return spawnSync(process.execPath, ['scripts/guard-diagnostics-api.mjs'], { cwd: root, encoding: 'utf8', timeout: 10_000 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function rejected(change, diagnostic) {
  const result = fixture(change);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, diagnostic);
}

test('accepts the complete registered method and existing protocol type inventory', () => {
  const result = fixture();
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
test('rejects a registered method omitted from the exact table', () => {
  rejected(files => { files.document = files.document.replace(row(methods[1]) + '\n', ''); }, /Missing exact diagnostics inventory method/);
});
test('rejects an allowlisted but unregistered method in the exact table', () => {
  rejected(files => { files.document = files.document.replace('\n## After', '\n' + row(extra) + '\n## After'); }, /Unregistered exact diagnostics inventory method/);
});
test('rejects duplicate exact inventory methods', () => {
  rejected(files => { files.document = files.document.replace('\n## After', '\n' + row(methods[0]) + '\n## After'); }, /Duplicate exact diagnostics inventory method/);
});
test('rejects the wrong protocol type pair even if all methods are present', () => {
  rejected(files => { files.document = files.document.replace(stem(methods[1]) + 'Params', 'OtherParams'); }, /Mismatched exact diagnostics inventory type pair/);
});
test('rejects a documented type that does not exist in Rust', () => {
  rejected(files => { files.protocol = files.protocol.replace(`pub struct ${stem(methods[1])}Result {}`, ''); }, /type is absent from Rust protocol/);
});
test('rejects a missing exact inventory section', () => {
  rejected(files => { files.document = files.document.replace(heading, '\n## Different section\n'); }, /section must occur exactly once/);
});
test('rejects duplicate exact inventory sections', () => {
  rejected(files => { files.document += heading; }, /section must occur exactly once/);
});
test('does not treat method mentions outside the exact inventory as table rows', () => {
  const result = fixture(files => { files.document += '\n' + row(extra); });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
test('does not require an unregistered Rust constant to have an inventory row', () => {
  const result = fixture(files => { files.runtime += `const METHOD_UNUSED: &str = "${extra}";\n`; });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('registers the actual diagnostics guard for strict independent review', async () => {
  const { runPhaseValueGuard } = await import('./guard-phase-value.mjs');
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'docs/architecture/phase-value-manifest.json'), 'utf8'));
  const changedFiles = ['scripts/guard-diagnostics-api.mjs'];
  const valid = runPhaseValueGuard({ repoRoot: source, manifest, changedFiles });
  assert.deepEqual(valid.errors, []);
  const omitted = structuredClone(manifest);
  omitted.guard_engine_change_review.changed_files = omitted.guard_engine_change_review.changed_files.filter(name => name !== changedFiles[0]);
  const invalid = runPhaseValueGuard({ repoRoot: source, manifest: omitted, changedFiles });
  assert.equal(invalid.errors.length, 1);
  assert.match(invalid.errors[0], /must include changed guard file scripts\/guard-diagnostics-api.mjs/);
});
