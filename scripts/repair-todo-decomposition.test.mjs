import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validateTodoDecompositionText } from './guard-todo-decomposition.mjs';
import { validateQueueApplyCandidate, validateDecompositionTransition, validateRuntimeProposalRequest, validateQueueRepairTransition, validateDecompositionLeaves, uncheckedTodoBlocks } from './repair-todo-decomposition.mjs';

test('external controller queue admits only the bound workspace proposal without mutation', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-external-queue-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'notes.txt');
  fs.writeFileSync(target, 'original');
  const digest = value => createHash('sha256').update(value).digest('hex');
  const selected = '- [ ] selected: Patch only `notes.txt`: Update the selected document.';
  const metadata = { selected_todo_text: selected, selected_todo_sha256: digest(selected),
    bdk_state: 'implementation', queue_relative_path: null };
  const request = {
    schema_version: 1, context: { metadata, metadata_sha256: `sha256:${digest(JSON.stringify(metadata))}` },
    proposal: { proposal: { proposal_id: 'p1', path: 'notes.txt', operation: 'patch_file' } },
    apply_params: { proposal_id: 'p1', run_id: 'r1', expected_target_sha256: `sha256:${digest('original')}`,
      patch_hunks: [{ old_text: 'original', new_text: 'updated' }] }
  };
  const bytes = Buffer.from(JSON.stringify(request));
  assert.deepEqual(validateRuntimeProposalRequest(bytes, root), {
    schema_version: 1, valid: true, applied: false, request_sha256: `sha256:${digest(bytes)}`
  });
  for (const targetPath of ['.brownie/todo.md', '../queue.md', '/tmp/queue.md', 'unrelated.txt']) {
    request.proposal.proposal.path = targetPath;
    assert.throws(() => validateRuntimeProposalRequest(Buffer.from(JSON.stringify(request)), root), /outside bound controller policy/u);
  }
  assert.equal(fs.readFileSync(target, 'utf8'), 'original');
  assert.deepEqual(fs.readdirSync(root), ['notes.txt']);
});

test('Runtime proposal endpoint rejects decomposition of an unrelated parent without writing', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-bound-parent-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.brownie'));
  const selected = '- [ ] selected: Decompose bounded work';
  const other = '- [ ] other: Preserve unrelated work';
  const current = `${selected}\n\n${other}\n`;
  const target = path.join(root, '.brownie/todo.md');
  fs.writeFileSync(target, current);
  const digest = value => createHash('sha256').update(value).digest('hex');
  const metadata = { selected_todo_text: selected, selected_todo_sha256: digest(selected),
    bdk_state: 'decompose_todo', queue_relative_path: '.brownie/todo.md' };
  const request = {
    schema_version: 1, context: { metadata, metadata_sha256: `sha256:${digest(JSON.stringify(metadata))}` },
    proposal: { proposal: { proposal_id: 'p1', path: '.brownie/todo.md', operation: 'patch_file' } },
    apply_params: { proposal_id: 'p1', run_id: 'r1', expected_target_sha256: `sha256:${digest(current)}`,
      patch_hunks: [{ old_text: other, new_text: '- [ ] child: Patch only `package.json`\n  Source TODO: selected.' }] }
  };
  assert.throws(() => validateRuntimeProposalRequest(Buffer.from(JSON.stringify(request)), root), /exactly the selected parent/u);
  assert.equal(fs.readFileSync(target, 'utf8'), current);
  metadata.bdk_state = 'todo_queue_repair';
  request.context.metadata_sha256 = `sha256:${digest(JSON.stringify(metadata))}`;
  assert.throws(() => validateRuntimeProposalRequest(Buffer.from(JSON.stringify(request)), root), /cannot introduce new leaf IDs/u);
  assert.equal(fs.readFileSync(target, 'utf8'), current);
});

test('decomposition transition binds exact parent and refuses unrelated edits or forged lineage', () => {
  const parent = '- [ ] parent: Split work\n  Source TODO: ancestor.';
  const leaf = '- [ ] child: Patch only `package.json`\n  Source TODO: parent.';
  const current = `# Queue\n${parent}\n\n- [ ] unrelated: Preserve this\n`;
  const hunk = { old_text: parent, new_text: leaf };
  assert.doesNotThrow(() => validateDecompositionTransition(parent, current, [hunk]));
  assert.doesNotThrow(() => validateDecompositionTransition(parent, current, [{ ...hunk,
    new_text: `${leaf}\n\n- [ ] child2: Create only \`new.txt\`\n  Source TODO: ancestor.` }]));
  for (const replacement of [parent, '', leaf.replace('parent.', 'parent-extra.'),
    leaf.replace('parent.', 'child.'), `${leaf}\n${leaf}`, `${leaf}\n- [x] done: hidden completion`,
    `unbound prefix\n${leaf}`]) {
    assert.throws(() => validateDecompositionTransition(parent, current, [{ ...hunk, new_text: replacement }]));
  }
  for (const hunks of [[{ ...hunk, old_text: 'Split work' }], [hunk, hunk],
    [{ ...hunk, occurrence: 1 }], [{ ...hunk, old_text: current }]]) {
    assert.throws(() => validateDecompositionTransition(parent, current, hunks));
  }
  assert.throws(() => validateDecompositionTransition(parent, `${current}\n${parent}`, [hunk]));
  assert.throws(() => validateDecompositionTransition(parent, current.replace(parent, 'changed'), [hunk]));
});

test('external queue apply policy retains Runtime rejection and acceptance cases without mutation', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-external-apply-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  fs.mkdirSync(path.join(root, '.brownie'));
  fs.writeFileSync(path.join(root, 'package.json'), '{}\n');
  fs.writeFileSync(path.join(root, '.github/workflows/release.yml'), 'name: release\n');
  const queue = path.join(root, '.brownie/todo.md');
  fs.writeFileSync(queue, 'original queue\n');
  const cases = [
    ['- [ ] E-23b-target-03: Create only `package.json`\n  Depends on: <none>\n', false, /already exists/u],
    ['- [ ] E-23b-target-03: Patch only `package.json`\n  Depends on: E-23b-target-04\n- [ ] E-23b-target-04: Patch only `.github/workflows/release.yml`\n  Depends on: E-23b-target-03\n', false, /cyclic/u],
    ['* [ ] TODO-maintenance-a: Patch only `package.json`\n  Depends on: TODO-maintenance-b\n* [ ] TODO-maintenance-b: Patch only `.github/workflows/release.yml`\n  Depends on: TODO-maintenance-a\n', false, /cyclic/u],
    ['1. [ ] TODO-release-contract: Create only `package.json`\n   Depends on: <none>\n', false, /already exists/u],
    ['- [ ] E-23b-target-03: Patch only `package.json`\n  Depends on: <none>\n- [ ] E-23b-target-04: Patch only `.github/workflows/release.yml`\n  Depends on: E-23b-target-03\n', true],
    ['- [ ] E-23b-roundtrip: Create only `scripts/new-roundtrip.mjs`; Patch only `package.json` and `.github/workflows/release.yml`\n  Depends on: <none>\n', true]
  ];
  for (const [candidate, valid, reason] of cases) {
    const result = validateQueueApplyCandidate(root, candidate);
    assert.equal(result.valid, valid, JSON.stringify(result));
    if (reason) assert.match(result.errors.join('\n'), reason);
    assert.equal(fs.readFileSync(queue, 'utf8'), 'original queue\n');
    assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), '{}\n');
    assert.equal(fs.existsSync(path.join(root, 'scripts/new-roundtrip.mjs')), false);
  }
});

test('external queue candidate refuses aliases, missing targets, duplicate IDs and oversized input', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-external-path-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'actual'));
  fs.symlinkSync('actual', path.join(root, 'alias'));
  for (const target of ['../outside', '/absolute', 'a/../b', 'alias/new', 'a\\b', '']) {
    assert.equal(validateQueueApplyCandidate(root, `- [ ] leaf: Create only \`${target}\``).valid, false, target);
  }
  assert.equal(validateQueueApplyCandidate(root, '- [ ] leaf: Patch only `missing`').valid, false);
  assert.equal(validateQueueApplyCandidate(root, '- [ ] leaf: Create only `new`\n- [ ] leaf: Create only `other`').valid, false);
  assert.equal(validateQueueApplyCandidate(root, '- [ ] a: Create only `new`\n  Depends on: `b`.\n- [ ] b: Create only `other`\n  Depends on: a.').valid, false);
  assert.equal(validateQueueApplyCandidate(root, 'x'.repeat(1024 * 1024 + 1)).valid, false);
  assert.equal(validateQueueApplyCandidate(root, '- [ ] invalid: \ud800').valid, false);
  assert.equal(validateQueueApplyCandidate(root, '- [ ] none: Create only `new`\n  Depends on: none').valid, false);
  // Completed blocks delimit metadata and cannot manufacture a live cycle.
  assert.equal(validateQueueApplyCandidate(root, '- [ ] leaf: Create only `new`\n  Depends on: <none>\n- [x] prior: old\n  Depends on: leaf').valid, true);
});

test('validation subprocess binds exact request and target bytes and never applies its candidate', t => {
  const root = makeTempRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const queue = path.join(root, '.brownie/todo.md');
  const original = '# Brownie TODO Queue\n\n- [ ] original: Patch only `package.json`\n';
  fs.writeFileSync(queue, original);
  const digest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
  const requestFile = path.join(root, 'validation.json');
  const request = {
    schema_version: 1, proposal_id: 'proposal-1', run_id: 'run-1', path: '.brownie/todo.md',
    expected_target_sha256: digest(original),
    candidate: '# Brownie TODO Queue\n\n- [ ] candidate: Patch only `package.json`\n'
  };
  function invoke(value, expectedDigest) {
    const bytes = JSON.stringify(value);
    fs.writeFileSync(requestFile, bytes);
    return spawnSync(process.execPath, [
      path.join(repoRoot, 'scripts/repair-todo-decomposition.mjs'),
      '--validate-proposal', requestFile, '--request-sha256', expectedDigest ?? digest(bytes)
    ], { env: { ...process.env, BROWNIE_REPAIR_TODO_REPO_ROOT: root }, encoding: 'utf8' });
  }
  const accepted = invoke(request);
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  const receipt = JSON.parse(accepted.stdout);
  assert.equal(receipt.valid, true);
  assert.equal(receipt.applied, false);
  assert.equal(receipt.candidate_sha256, digest(request.candidate));
  assert.equal(receipt.proposal_id, request.proposal_id);
  assert.equal(receipt.run_id, request.run_id);
  assert.equal(fs.readFileSync(queue, 'utf8'), original);
  for (const [value, expectedDigest, reason] of [
    [request, digest('old request'), /stale validation request/u],
    [{ ...request, expected_target_sha256: digest('old target') }, undefined, /stale queue target/u],
    [{ ...request, path: 'package.json' }, undefined, /invalid queue validation request/u],
    [{ ...request, unexpected: true }, undefined, /invalid queue validation request/u],
    [{ ...request, candidate: '- [ ] leaf: Create only `package.json`' }, undefined, /already exists/u],
    [{ ...request, candidate: '' }, undefined, /TODO|todo|queue/u]
  ]) {
    const rejected = invoke(value, expectedDigest);
    assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
    assert.match(rejected.stdout, reason);
    assert.equal(fs.readFileSync(queue, 'utf8'), original);
  }
  fs.renameSync(queue, `${queue}.original`);
  fs.symlinkSync('todo.md.original', queue);
  const alias = invoke(request);
  assert.equal(alias.status, 1);
  assert.match(alias.stdout, /unsafe symlink target/u);
  assert.equal(fs.readFileSync(`${queue}.original`, 'utf8'), original);
});

test('compiled controller policy validates exact Runtime patch material through stdin', t => {
  const root = makeTempRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hash = value => createHash('sha256').update(value).digest('hex');
  const original = '# Brownie TODO Queue\n\n- [ ] original: Patch only `package.json`\n';
  const queue = path.join(root, '.brownie/todo.md');
  fs.writeFileSync(queue, original);
  const selected = '- [ ] repair: Patch only `.brownie/todo.md`';
  const prompt = `## Selected TODO\n\n${selected}\n`;
  const promptPath = path.join(root, 'prompt.md');
  const metaPath = path.join(root, 'metadata.json');
  const constraintsPath = path.join(root, 'constraints.json');
  fs.writeFileSync(promptPath, prompt);
  fs.writeFileSync(metaPath, JSON.stringify({ prompt_path: promptPath, prompt_sha256: hash(prompt), selected_todo_text: selected, selected_todo_sha256: hash(selected), bdk_state: 'todo_queue_repair', queue_relative_path: '.brownie/todo.md' }));
  const compiled = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/phase-loop-task-constraints.mjs'), promptPath, metaPath, constraintsPath], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr);
  const policy = JSON.parse(fs.readFileSync(`${constraintsPath}.validator.json`, 'utf8'));
  const request = {
    schema_version: 1, context: policy.context,
    proposal: { proposal: { proposal_id: 'p1', path: '.brownie/todo.md', operation: 'patch_file' } },
    apply_params: { proposal_id: 'p1', run_id: 'r1', expected_target_sha256: `sha256:${hash(original)}`, patch_hunks: [{ old_text: '- [ ] original: Patch only `package.json`', new_text: '- [ ] original: Patch only `package.json` to correct the bounded script.' }] }
  };
  function invoke(input) {
    const bytes = JSON.stringify(input);
    const result = spawnSync(policy.program, policy.args, { input: bytes, cwd: root, encoding: 'utf8' });
    return { result, bytes, receipt: JSON.parse(result.stdout) };
  }
  const accepted = invoke(request);
  assert.equal(accepted.result.status, 0, accepted.result.stdout + accepted.result.stderr);
  assert.equal(accepted.receipt.request_sha256, `sha256:${hash(accepted.bytes)}`);
  assert.equal(accepted.receipt.candidate_sha256, `sha256:${hash(original.replace('- [ ] original: Patch only `package.json`', request.apply_params.patch_hunks[0].new_text))}`);
  const review = structuredClone(request);
  review.validation_stage = 'before_authorization';
  review.proposal.proposal.approval_status = 'Pending';
  delete review.apply_params.expected_target_sha256;
  const reviewed = invoke(review);
  assert.equal(reviewed.result.status, 0, reviewed.result.stdout + reviewed.result.stderr);
  assert.equal(reviewed.receipt.applied, false);
  assert.equal(reviewed.receipt.candidate_sha256, accepted.receipt.candidate_sha256);
  assert.equal(reviewed.receipt.request_sha256, `sha256:${hash(reviewed.bytes)}`);
  assert.equal(fs.readFileSync(queue, 'utf8'), original);
  const invalidStage = { ...request, validation_stage: 'skip_validation' };
  assert.equal(invoke(invalidStage).result.status, 1);
  const alreadyApproved = structuredClone(review);
  alreadyApproved.proposal.proposal.approval_status = 'Approved';
  assert.equal(invoke(alreadyApproved).result.status, 1);
  assert.equal(invoke({ ...review, validation_stage: 'before_apply' }).result.status, 1,
    'apply still requires an exact Runtime preflight snapshot');
  fs.writeFileSync(queue, `${original}\n# changed after review\n`);
  assert.equal(invoke(request).result.status, 1, 'review does not authorize applying to a changed target');
  fs.writeFileSync(queue, original);
  for (const base of [request, review]) for (const change of [
    input => { input.apply_params.patch_hunks[0].new_text = '- [ ] corrected: Patch only `package.json`'; },
    input => { input.apply_params.patch_hunks[0].new_text = '- [ ] invalid: Create only `package.json`'; },
    input => { input.apply_params.expected_target_sha256 = `sha256:${hash('stale')}`; },
    input => { input.apply_params.proposal_id = 'another'; },
    input => { input.proposal.proposal.path = 'package.json'; },
    input => { input.context.metadata.selected_todo_text += '\nchanged'; },
    input => { input.apply_params.patch_hunks.push({ ...input.apply_params.patch_hunks[0] }); }
  ]) {
    const changed = structuredClone(base); change(changed);
    assert.equal(invoke(changed).result.status, 1);
    assert.equal(fs.readFileSync(queue, 'utf8'), original);
  }
  fs.appendFileSync(metaPath, '\n');
  fs.unlinkSync(promptPath);
  assert.equal(invoke(request).result.status, 0, 'claim policy survives prompt retention without rebuilding scope');
  assert.equal(fs.readFileSync(queue, 'utf8'), original);
});

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function durableCompletionRecord(todoId, claimId = `claim-${todoId}`) {
  const selectedHash = createHash('sha256').update(`fixture:${todoId}`).digest('hex');
  return {
    schema_version: 2,
    claim_id: claimId,
    root_claim_id: claimId,
    selected_todo_id: todoId,
    selected_todo_sha256: selectedHash,
    delivery_receipt: {
      schema_version: 1,
      claim_id: claimId,
      root_claim_id: claimId,
      selected_todo_sha256: selectedHash,
      author: 'implementation',
      reviewer: 'review',
      merge_actor: 'review',
      approved: true,
      ci_passed: true,
      merged: true,
      semantic_completion_evidence: {
        schema_version: 1,
        root_claim_id: claimId,
        selected_todo_sha256: selectedHash,
        completion_condition_sha256: createHash('sha256').update(`fixture completion:${todoId}`).digest('hex'),
        verification_results: [{ command: 'node --test fixture.mjs', exit_code: 0 }],
        observables: [{ kind: 'fixture', sha256: createHash('sha256').update(`fixture observable:${todoId}`).digest('hex') }]
      }
    }
  };
}

function makeTempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-repair-todo-decomposition-'));
  fs.mkdirSync(path.join(root, '.brownie/private/phase-loop/todo-claims'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs/architecture'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    scripts: {
      'guard:release-contract': 'node scripts/guard-release-contract.mjs',
      'guard:release-contract:test': 'node --test scripts/guard-release-contract.test.mjs',
      'guard:runtime-release-readiness': 'node scripts/guard-runtime-release-readiness.mjs',
      'guard:phase-value': 'node scripts/guard-phase-value.mjs',
      'guard:release-evidence-semantic-consistency': 'node scripts/guard-release-evidence-semantic-consistency.mjs',
      'guard:release-evidence-semantic-consistency:test': 'node --test scripts/guard-release-evidence-semantic-consistency.test.mjs',
      'guard:runtime-operational-evidence': 'node scripts/guard-runtime-operational-evidence.mjs',
      'guard:runtime-operational-evidence:test': 'node --test scripts/guard-runtime-operational-evidence.test.mjs',
      'guard:supply-chain-artifact-evidence': 'node scripts/guard-supply-chain-artifact-evidence.mjs',
      'guard:supply-chain-artifact-evidence:test': 'node --test scripts/guard-supply-chain-artifact-evidence.test.mjs',
      'guard:owner-governance-evidence': 'node scripts/guard-owner-governance-evidence.mjs',
      'guard:owner-governance-evidence:test': 'node --test scripts/guard-owner-governance-evidence.test.mjs',
      'release:runtime-operational-evidence:test': 'node --test scripts/guard-runtime-operational-evidence.test.mjs',
      'release:owner-governance-evidence:test': 'node --test scripts/release-owner-governance-evidence.test.mjs',
      'guard:todo-decomposition': 'node scripts/guard-todo-decomposition.mjs'
    }
  }, null, 2));
  for (const file of [
    'docs/architecture/runtime-release-contract.json',
    'docs/architecture/runtime-release-readiness-audit.json',
    'docs/architecture/phase-value-manifest.json',
    'docs/architecture/final-product-ready-judgment.md',
    'scripts/guard-release-contract.test.mjs',
    'scripts/guard-release-contract.mjs',
    'scripts/guard-release-evidence-semantic-consistency.mjs',
    'scripts/guard-release-evidence-semantic-consistency.test.mjs',
    'scripts/release-runtime-operational-evidence.mjs',
    'scripts/guard-runtime-operational-evidence.mjs',
    'scripts/guard-runtime-operational-evidence.test.mjs',
    'scripts/release-supply-chain-artifact-evidence.mjs',
    'scripts/guard-supply-chain-artifact-evidence.mjs',
    'scripts/guard-supply-chain-artifact-evidence.test.mjs',
    'scripts/release-owner-governance-evidence.mjs',
    'scripts/release-owner-governance-evidence.test.mjs',
    'scripts/guard-owner-governance-evidence.mjs',
    'scripts/guard-owner-governance-evidence.test.mjs',
    'scripts/guard-runtime-release-readiness.mjs',
    'scripts/guard-phase-value.mjs'
  ]) {
    fs.writeFileSync(path.join(root, file), file.endsWith('.json') ? '{}\n' : '// fixture\n');
  }
  fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
    '# TODO breakdown',
    '',
    'Dependency graph:',
    '',
    'Verification ledger:',
    '',
    'Quality rubric:',
    '',
    'History:',
    ''
  ].join('\n'));
  return root;
}

function runRepair(root) {
  return spawnSync(process.execPath, [
    'scripts/repair-todo-decomposition.mjs',
    '--claim',
    path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'),
    '--todo',
    '.brownie/todo.md',
    '--breakdown',
    '.brownie/todo-breakdown.md',
    '--run-stamp',
    'test-run'
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      BROWNIE_REPAIR_TODO_REPO_ROOT: root
    },
    encoding: 'utf8'
  });
}

test('rebaselines sibling leaves when verification dependencies form a cycle and Create-only targets already exist', () => {
  const root = makeTempRepo();
  try {
    fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
    fs.mkdirSync(path.join(root, '.brownie/private/phase-loop/todo-completions'), { recursive: true });
    fs.writeFileSync(path.join(root, '.github/workflows/release.yml'), 'name: fixture\n');
    fs.writeFileSync(
      path.join(root, '.brownie/private/phase-loop/todo-completions/e23a.json'),
      JSON.stringify(durableCompletionRecord('E-23a-release-artifact-portable-archive'))
    );
    const sourceId = 'E-23b-release-artifact-download-roundtrip';
    const leaf = (suffix, target, dependencies, verificationTarget = 'scripts/release-artifact-roundtrip-e2e.test.mjs') => `- [ ] ${sourceId}-target-${suffix}: Create only \`${target}\` for the downloaded release-artifact roundtrip:
  Route: implementation.
  Source TODO: ${sourceId}.
  Depends on: ${dependencies.length > 0 ? dependencies.join(', ') : '<none>'}.
  Completion condition: Create only \`${target}\` with a bounded downloaded-artifact verification path.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`node --test ${verificationTarget}\`.`;
    const target01 = `${sourceId}-target-01`;
    const target02 = `${sourceId}-target-02`;
    const target03 = `${sourceId}-target-03`;
    const target04 = `${sourceId}-target-04`;
    const target05 = `${sourceId}-target-05`;
    const target06 = `${sourceId}-target-06`;
    const target07 = `${sourceId}-target-07`;
    const todoText = [
      '# Brownie TODO Queue',
      '',
      `- [x] ${sourceId}: Parent release artifact roundtrip.`,
      '',
      leaf('01', 'scripts/release-artifact-roundtrip-e2e.mjs', ['E-23a-release-artifact-portable-archive', target02]),
      '',
      leaf('02', 'scripts/release-artifact-roundtrip-e2e.test.mjs', [target01]),
      '',
      leaf('03', 'package.json', [target02]),
      '',
      leaf('04', '.github/workflows/release.yml', [target03, target02]),
      '',
      leaf('05', 'scripts/release-artifact-support.test.mjs', [target02]),
      '',
      leaf('06', 'scripts/release-artifact-support.mjs', [target05], 'scripts/release-artifact-support.test.mjs'),
      '',
      `- [ ] ${target07}: Create only \`scripts/release-artifact-extra.mjs\` and \`package.json\` for a mixed-scope fixture:
  Route: implementation.
  Source TODO: ${sourceId}.
  Depends on: ${target02}.
  Completion condition: keep each target classified by whether it already exists.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`node --test scripts/release-artifact-roundtrip-e2e.test.mjs\`.`,
      ''
    ].join('\n');
    const breakdownText = [
      '# TODO breakdown',
      '',
      `## ${sourceId} split`,
      '',
      `Parent TODO: ${sourceId}: Parent release artifact roundtrip.`,
      'Dependency graph:',
      `- ${target01}: E-23a-release-artifact-portable-archive, ${target02}`,
      `- ${target02}: ${target01}`,
      `- ${target03}: ${target02}`,
      `- ${target04}: ${target03}, ${target02}`,
      `- ${target05}: ${target02}`,
      `- ${target06}: ${target05}`,
      `- ${target07}: ${target02}`,
      '',
      'Verification ledger:',
      `- ${target01}: \`node --test scripts/release-artifact-roundtrip-e2e.test.mjs\``,
      `- ${target02}: \`node --test scripts/release-artifact-roundtrip-e2e.test.mjs\``,
      `- ${target03}: \`node --test scripts/release-artifact-roundtrip-e2e.test.mjs\``,
      `- ${target04}: \`node --test scripts/release-artifact-roundtrip-e2e.test.mjs\``,
      `- ${target05}: \`node --test scripts/release-artifact-roundtrip-e2e.test.mjs\``,
      `- ${target06}: \`node --test scripts/release-artifact-support.test.mjs\``,
      `- ${target07}: \`node --test scripts/release-artifact-roundtrip-e2e.test.mjs\``,
      '',
      'Quality rubric:',
      '- Each leaf has one concrete target and an executable verification command.',
      '',
      'History:',
      '- fixture',
      ''
    ].join('\n');
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), todoText);
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), breakdownText);
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-e23b-cycle',
      selected_todo: leaf('01', 'scripts/release-artifact-roundtrip-e2e.mjs', ['E-23a-release-artifact-portable-archive', target02])
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const repairedTodo = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const repairedBreakdown = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    assert.match(repairedTodo, new RegExp(`${target01}[\\s\\S]*?Depends on: E-23a-release-artifact-portable-archive, ${target02}\\.`));
    assert.match(repairedTodo, new RegExp(`${target02}[\\s\\S]*?Depends on: <none>\\.`));
    assert.match(repairedTodo, new RegExp(target03 + ': Patch only `package\\.json`'));
    assert.match(repairedTodo, new RegExp(target04 + ': Patch only `\\.github/workflows/release\\.yml`'));
    assert.match(repairedTodo, new RegExp(`${target05}[\\s\\S]*?Depends on: ${target02}\\.`));
    assert.match(repairedTodo, new RegExp(target07 + ': Patch only `package\\.json` and Create only `scripts/release-artifact-extra\\.mjs`'));
    assert.match(repairedBreakdown, new RegExp(`- ${target02}: <none>`));

    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'scripts/release-artifact-extra.mjs'), '// fixture\n');
    const repeated = runRepair(root);
    assert.equal(repeated.status, 0, `${repeated.stdout}\n${repeated.stderr}`);
    const rerunTodo = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    assert.match(rerunTodo, new RegExp(target07 + ': Patch only `package\\.json` and `scripts/release-artifact-extra\\.mjs`'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('normalizes an existing Create-only target when it is the final unchecked source leaf', () => {
  const root = makeTempRepo();
  try {
    const sourceId = 'E-23z-single-existing-target';
    const leafId = `${sourceId}-target-01`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), [
      '# Brownie TODO Queue',
      '',
      `- [x] ${sourceId}: Parent fixture.`,
      '',
      `- [ ] ${leafId}: Create only \`package.json\` for the final unchecked source leaf:`,
      '  Route: implementation.',
      `  Source TODO: ${sourceId}.`,
      '  Depends on: <none>.',
      '  Completion condition: classify the existing target correctly.',
      '  Forbidden changes: do not edit unrelated files.',
      '  Verification: run `pnpm --workspace-root guard:todo-decomposition`.',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      `## ${sourceId} split`,
      '',
      `Parent TODO: ${sourceId}: Parent fixture.`,
      'Dependency graph:',
      `- ${leafId}: <none>`,
      '',
      'Verification ledger:',
      `- ${leafId}: \`pnpm --workspace-root guard:todo-decomposition\``,
      '',
      'Quality rubric:',
      '- The final leaf has a concrete target.',
      '',
      'History:',
      '- fixture',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-single-existing-target',
      selected_todo: `- [ ] ${leafId}: Create only \`package.json\` for the final unchecked source leaf:`
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8'), new RegExp(leafId + ': Patch only `package\\.json`'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('does not accept a sibling dependency backed only by an invalidated completion receipt', () => {
  const root = makeTempRepo();
  try {
    const sourceId = 'E-23z-invalidated-completion';
    const leafId = `${sourceId}-target-01`;
    const removedId = 'E-23z-superseded-parent';
    fs.mkdirSync(path.join(root, '.brownie/private/phase-loop/todo-completions'), { recursive: true });
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-completions/invalid.json'), JSON.stringify({
      selected_todo_id: removedId,
      reason: 'source_parent_completed'
    }));
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), [
      '# Brownie TODO Queue',
      '',
      `- [x] ${sourceId}: Parent fixture.`,
      '',
      `- [ ] ${leafId}: Create only \`package.json\` for an invalidated completion fixture:`,
      '  Route: implementation.',
      `  Source TODO: ${sourceId}.`,
      `  Depends on: ${removedId}.`,
      '  Completion condition: require a canonically valid dependency.',
      '  Forbidden changes: do not edit unrelated files.',
      '  Verification: run `pnpm --workspace-root guard:todo-decomposition`.',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      `## ${sourceId} split`,
      '',
      `Parent TODO: ${sourceId}: Parent fixture.`,
      'Dependency graph:',
      `- ${leafId}: ${removedId}`,
      '',
      'Verification ledger:',
      `- ${leafId}: \`pnpm --workspace-root guard:todo-decomposition\``,
      '',
      'Quality rubric:',
      '- The final leaf has a concrete target.',
      '',
      'History:',
      '- fixture',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-invalidated-completion',
      selected_todo: `- [ ] ${leafId}: Create only \`package.json\` for an invalidated completion fixture:`
    }, null, 2));

    const result = runRepair(root);
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /unresolved_dependency_without_completion/);
    assert.ok(fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8').includes(`${leafId}: Create only \`package.json\``));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preserves a canonically completed dependency during sibling normalization', () => {
  const root = makeTempRepo();
  try {
    const tick = String.fromCharCode(96);
    const sourceId = 'E-23z-canonical-completion';
    const leafId = sourceId + '-target-01';
    const completedId = 'E-23z-completed-prerequisite';
    fs.mkdirSync(path.join(root, '.brownie/private/phase-loop/todo-completions'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.brownie/private/phase-loop/todo-completions/completed.json'),
      JSON.stringify(durableCompletionRecord(completedId))
    );
    const leaf = '- [ ] ' + leafId + ': Create only ' + tick + 'package.json' + tick + ' after the completed prerequisite:\n'
      + '  Route: implementation.\n'
      + '  Source TODO: ' + sourceId + '.\n'
      + '  Depends on: ' + completedId + '.\n'
      + '  Completion condition: normalize the existing target without dropping the completed prerequisite.\n'
      + '  Forbidden changes: do not edit unrelated files.\n'
      + '  Verification: run ' + tick + 'pnpm --workspace-root guard:todo-decomposition' + tick + '.';
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), [
      '- [x] ' + sourceId + ': Parent fixture.',
      '',
      leaf,
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown', '', '## ' + sourceId + ' split', '',
      'Parent TODO: ' + sourceId, '', 'Dependency graph:',
      '- ' + leafId + ': ' + completedId, '', 'Verification ledger:',
      '- ' + leafId + ': ' + tick + 'pnpm --workspace-root guard:todo-decomposition' + tick,
      '', 'Quality rubric:', '- ' + leafId + ': bounded target.', '', 'History:', ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-canonical-completion',
      selected_todo: leaf
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
    const todo = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    assert.match(todo, new RegExp(leafId + ': Patch only ' + tick + 'package\\.json' + tick));
    assert.match(todo, new RegExp('Depends on: ' + completedId + '\\.'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a sibling normalization that depends on an unresolved checked superseded parent', () => {
  const root = makeTempRepo();
  try {
    const tick = String.fromCharCode(96);
    const parentId = 'E-23z-unresolved-parent';
    const childId = parentId + '-target-01';
    const sourceId = 'E-23z-dependent-source';
    const leafId = sourceId + '-target-01';
    const child = '- [ ] ' + childId + ': Create only ' + tick + 'scripts/new-child.mjs' + tick + ' for the split parent:\n'
      + '  Route: implementation.\n'
      + '  Source TODO: ' + parentId + '.\n'
      + '  Depends on: <none>.\n'
      + '  Completion condition: create the generated child.\n'
      + '  Forbidden changes: do not edit unrelated files.\n'
      + '  Verification: run ' + tick + 'pnpm --workspace-root guard:todo-decomposition' + tick + '.';
    const leaf = '- [ ] ' + leafId + ': Create only ' + tick + 'package.json' + tick + ' after the unresolved parent:\n'
      + '  Route: implementation.\n'
      + '  Source TODO: ' + sourceId + '.\n'
      + '  Depends on: ' + parentId + '.\n'
      + '  Completion condition: preserve the unresolved parent dependency.\n'
      + '  Forbidden changes: do not edit unrelated files.\n'
      + '  Verification: run ' + tick + 'pnpm --workspace-root guard:todo-decomposition' + tick + '.';
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), [
      '- [x] ' + parentId + ': Superseded parent fixture.',
      '', child, '', leaf, ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown', '', '## ' + parentId + ' split', '',
      'Parent TODO: ' + parentId, '', 'Targets:', '- ' + childId + ': ' + tick + 'scripts/new-child.mjs' + tick,
      '', 'Dependency graph:', '- ' + childId + ': <none>', '- ' + leafId + ': ' + parentId,
      '', 'Verification ledger:', '- ' + childId + ': ' + tick + 'pnpm --workspace-root guard:todo-decomposition' + tick,
      '- ' + leafId + ': ' + tick + 'pnpm --workspace-root guard:todo-decomposition' + tick,
      '', 'Quality rubric:', '- ' + childId + ': bounded target.', '- ' + leafId + ': bounded target.', '', 'History:', ''
    ].join('\n'));
    fs.mkdirSync(path.join(root, '.brownie/private/phase-loop/todo-replans'), { recursive: true });
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-replans/split.json'), JSON.stringify({
      schema_version: 1,
      record_type: 'todo_replan',
      operation: 'split_parent_into_children',
      parent_status: 'superseded_by_children',
      parent_todo_id: parentId,
      generated_child_ids: [childId]
    }));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-unresolved-parent',
      selected_todo: leaf
    }, null, 2));

    const result = runRepair(root);
    assert.notEqual(result.status, 0, result.stdout + '\n' + result.stderr);
    assert.match(result.stdout, /source_sibling_contract_repair_failed_guard/u);
    assert.match(fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8'), new RegExp(leafId + ': Create only ' + tick + 'package\\.json' + tick));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('retains descriptive scope words while normalizing an existing Create-only target', () => {
  const root = makeTempRepo();
  try {
    const sourceId = 'E-23z-descriptive-scope-word';
    const leafId = `${sourceId}-target-01`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), [
      '# Brownie TODO Queue',
      '',
      `- [x] ${sourceId}: Parent fixture.`,
      '',
      `- [ ] ${leafId}: Create only \`package.json\` to preserve Patch only behavior:`,
      '  Route: implementation.',
      `  Source TODO: ${sourceId}.`,
      '  Depends on: <none>.',
      '  Completion condition: retain descriptive wording outside scopes.',
      '  Forbidden changes: do not edit unrelated files.',
      '  Verification: run `pnpm --workspace-root guard:todo-decomposition`.',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown', '', `## ${sourceId} split`, '', `Parent TODO: ${sourceId}: Parent fixture.`,
      'Dependency graph:', `- ${leafId}: <none>`, '', 'Verification ledger:',
      `- ${leafId}: \`pnpm --workspace-root guard:todo-decomposition\``, '', 'Quality rubric:',
      '- The final leaf has a concrete target.', '', 'History:', '- fixture', ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-descriptive-scope-word',
      selected_todo: `- [ ] ${leafId}: Create only \`package.json\` to preserve Patch only behavior:`
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8').includes(`${leafId}: Patch only \`package.json\` to preserve Patch only behavior:`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('does not treat a verification path prefix as an exact sibling output', () => {
  const root = makeTempRepo();
  try {
    const sourceId = 'E-23z-verification-prefix';
    const firstId = `${sourceId}-target-01`;
    const secondId = `${sourceId}-target-02`;
    const leaf = (id, target, dependency, verification) => `- [ ] ${id}: Create only \`${target}\` for an exact verification-path fixture:
  Route: implementation.
  Source TODO: ${sourceId}.
  Depends on: ${dependency}.
  Completion condition: retain only dependencies justified by exact verification paths.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`node --test ${verification}\`.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), [
      '# Brownie TODO Queue',
      '',
      `- [x] ${sourceId}: Parent fixture.`,
      '',
      leaf(firstId, 'scripts/prefix-tool.mjs', secondId, 'scripts/prefix-tool.mjs'),
      '',
      leaf(secondId, 'scripts/prefix-tool.mjs.map', firstId, 'scripts/prefix-tool.mjs.map'),
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      `## ${sourceId} split`,
      '',
      `Parent TODO: ${sourceId}: Parent fixture.`,
      'Dependency graph:',
      `- ${firstId}: ${secondId}`,
      `- ${secondId}: ${firstId}`,
      '',
      'Verification ledger:',
      `- ${firstId}: \`node --test scripts/prefix-tool.mjs\``,
      `- ${secondId}: \`node --test scripts/prefix-tool.mjs.map\``,
      '',
      'Quality rubric:',
      '- Each leaf has a concrete target.',
      '',
      'History:',
      '- fixture',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-verification-prefix',
      selected_todo: leaf(firstId, 'scripts/prefix-tool.mjs', secondId, 'scripts/prefix-tool.mjs')
    }, null, 2));

    const result = runRepair(root);
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /unrepairable_source_sibling_cycle/);
    const todo = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    assert.match(todo, new RegExp(`${firstId}[\\s\\S]*?Depends on: ${secondId}\\.`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('does not treat descriptive backticks as Create-only scopes when breaking a cycle', () => {
  const root = makeTempRepo();
  try {
    const sourceId = 'E-23z-descriptive-scope';
    const firstId = `${sourceId}-target-01`;
    const secondId = `${sourceId}-target-02`;
    const first = `- [ ] ${firstId}: Create only \`scripts/declared-output.mjs\` with verification described by \`scripts/descriptive-output.mjs\`:
  Route: implementation.
  Source TODO: ${sourceId}.
  Depends on: ${secondId}.
  Completion condition: preserve only the leading Create-only target as scope.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`node --test scripts/declared-output.mjs\`.`;
    const second = `- [ ] ${secondId}: Create only \`scripts/descriptive-output.mjs\` for the companion leaf:
  Route: implementation.
  Source TODO: ${sourceId}.
  Depends on: ${firstId}.
  Completion condition: retain the cycle when no exact declared creator justifies removal.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`node --test scripts/descriptive-output.mjs\`.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), [
      '# Brownie TODO Queue',
      '',
      `- [x] ${sourceId}: Parent fixture.`,
      '',
      first,
      '',
      second,
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      `## ${sourceId} split`,
      '',
      `Parent TODO: ${sourceId}: Parent fixture.`,
      'Dependency graph:',
      `- ${firstId}: ${secondId}`,
      `- ${secondId}: ${firstId}`,
      '',
      'Verification ledger:',
      `- ${firstId}: \`node --test scripts/declared-output.mjs\``,
      `- ${secondId}: \`node --test scripts/descriptive-output.mjs\``,
      '',
      'Quality rubric:',
      '- Each leaf has a concrete target.',
      '',
      'History:',
      '- fixture',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-descriptive-scope',
      selected_todo: first
    }, null, 2));

    const result = runRepair(root);
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /unrepairable_source_sibling_cycle/);
    assert.match(fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8'), new RegExp(`${firstId}[\\s\\S]*?Depends on: ${secondId}\\.`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('does not remove a cycle edge when its output verifier is only downstream of the cycle', () => {
  const root = makeTempRepo();
  try {
    const sourceId = 'E-23z-downstream-verifier';
    const firstId = `${sourceId}-target-01`;
    const secondId = `${sourceId}-target-02`;
    const downstreamId = `${sourceId}-target-03`;
    const leaf = (id, target, dependency, verification) => `- [ ] ${id}: Create only \`${target}\` for a cycle-path verifier fixture:
  Route: implementation.
  Source TODO: ${sourceId}.
  Depends on: ${dependency}.
  Completion condition: retain a cycle unless the verifier proves the particular removed edge is a prerequisite.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`node --test ${verification}\`.`;
    const first = leaf(firstId, 'scripts/first.mjs', secondId, 'scripts/first.mjs');
    const second = leaf(secondId, 'scripts/second.mjs', firstId, 'scripts/second.mjs');
    const downstream = leaf(downstreamId, 'scripts/downstream.mjs', firstId, 'scripts/first.mjs');
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), [
      '# Brownie TODO Queue',
      '',
      `- [x] ${sourceId}: Parent fixture.`,
      '',
      first,
      '',
      second,
      '',
      downstream,
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      `## ${sourceId} split`,
      '',
      `Parent TODO: ${sourceId}: Parent fixture.`,
      'Dependency graph:',
      `- ${firstId}: ${secondId}`,
      `- ${secondId}: ${firstId}`,
      `- ${downstreamId}: ${firstId}`,
      '',
      'Verification ledger:',
      `- ${firstId}: \`node --test scripts/first.mjs\``,
      `- ${secondId}: \`node --test scripts/second.mjs\``,
      `- ${downstreamId}: \`node --test scripts/first.mjs\``,
      '',
      'Quality rubric:',
      '- Each leaf has a concrete target.',
      '',
      'History:',
      '- fixture',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-downstream-verifier',
      selected_todo: first
    }, null, 2));

    const result = runRepair(root);
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /unrepairable_source_sibling_cycle/);
    const todo = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    assert.match(todo, new RegExp(`${firstId}[\\s\\S]*?Depends on: ${secondId}\\.`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('does not use the target leaf to reach a verifier while deciding which cycle edge to remove', () => {
  const root = makeTempRepo();
  try {
    const sourceId = 'E-23z-shared-cycle-verifier';
    const targetId = `${sourceId}-target-01`;
    const prerequisiteId = `${sourceId}-target-02`;
    const verifierId = `${sourceId}-target-03`;
    const leaf = (id, target, dependencies, verification) => `- [ ] ${id}: Create only \`${target}\` for a target-excluding cycle-path fixture:
  Route: implementation.
  Source TODO: ${sourceId}.
  Depends on: ${dependencies}.
  Completion condition: retain each prerequisite unless its verifier is reachable without traversing the target leaf.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`node --test ${verification}\`.`;
    const target = leaf(targetId, 'scripts/target.mjs', `${prerequisiteId}, ${verifierId}`, 'scripts/target.mjs');
    const prerequisite = leaf(prerequisiteId, 'scripts/prerequisite.mjs', targetId, 'scripts/prerequisite.mjs');
    const verifier = leaf(verifierId, 'scripts/verifier.mjs', targetId, 'scripts/target.mjs');
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), [
      '# Brownie TODO Queue',
      '',
      `- [x] ${sourceId}: Parent fixture.`,
      '',
      target,
      '',
      prerequisite,
      '',
      verifier,
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      `## ${sourceId} split`,
      '',
      `Parent TODO: ${sourceId}: Parent fixture.`,
      'Dependency graph:',
      `- ${targetId}: ${prerequisiteId}, ${verifierId}`,
      `- ${prerequisiteId}: ${targetId}`,
      `- ${verifierId}: ${targetId}`,
      '',
      'Verification ledger:',
      `- ${targetId}: \`node --test scripts/target.mjs\``,
      `- ${prerequisiteId}: \`node --test scripts/prerequisite.mjs\``,
      `- ${verifierId}: \`node --test scripts/target.mjs\``,
      '',
      'Quality rubric:',
      '- Each leaf has a concrete target.',
      '',
      'History:',
      '- fixture',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-shared-cycle-verifier',
      selected_todo: target
    }, null, 2));

    const result = runRepair(root);
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /source_sibling_contract_repair_failed_guard/);
    const todo = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    assert.match(todo, new RegExp(`${targetId}[\\s\\S]*?Depends on: ${prerequisiteId}, ${verifierId}\\.`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deterministically decomposes E-19h release contract trace binding with allowlisted verification', () => {
  const root = makeTempRepo();
  try {
    const selected = `- [ ] TODO-decompose-broad-todo-9430463ff3c2: Decompose broad TODO \`E-19h-release-contract-trace-binding\` into implementable leaf TODOs:
  Route: todo-decomposition. Source: selected TODO hash \`9430463ff3c2e340974866ff0574dea52903644e5f289db085bce6cb4865f68e\` needs Brownie-owned decomposition because \`broad_unbounded_todo\`. Brownie must patch \`.brownie/todo.md\` so the broad selected TODO and this decomposition request are replaced by smaller unchecked leaf TODOs. Each generated leaf must include \`Route:\`, \`Source TODO:\`, \`Depends on:\`, \`Completion condition:\`, \`Forbidden changes:\`, and \`Verification:\`. Implementation leaves must name at most two concrete \`Patch only\` or \`Create only\` paths. Also update \`.brownie/todo-breakdown.md\` with the dependency graph, verification ledger, and a short history note. Do not implement the underlying task in this decomposition pass. Generated at \`2026-09-28T00:05:26Z\`.`;
    const source = `- [ ] E-19h-release-contract-trace-binding: Patch only \`docs/architecture/runtime-release-contract.json\`, \`docs/architecture/runtime-release-readiness-audit.json\`, and \`scripts/guard-release-contract.test.mjs\` so implementation commit, tested commit, workflow run id, and artifact SHA cannot remain \`pending-evidence-binding\` when the contract claims a corresponding release evidence section is implemented.
  Route: implementation.
  Depends on: <none>.
  Completion condition: Release Contract and readiness audit fail closed with explicit blockers until current tested commit, workflow run, and artifact SHA bindings are real values or the section is marked not satisfied.
  Forbidden changes: do not fill trace fields with placeholders, do not mark evidence implemented without matching generated evidence, and do not declare Runtime Product Ready.
  Verification: run \`pnpm --workspace-root guard:release-contract:test\`, \`pnpm --workspace-root guard:release-contract\`, and \`pnpm --workspace-root guard:runtime-release-readiness\`.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n${selected}\n\n${source}\n`);
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-test',
      selected_todo: selected
    }, null, 2));
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      '## TODO-decompose-broad-todo-9430463ff3c2',
      '',
      'Parent TODO: stale-parent.',
      '',
      'Dependency graph:',
      '- stale-leaf: <none>',
      '',
      'Verification ledger:',
      '- stale-leaf: `node --test scripts/stale.test.mjs`',
      '',
      'Quality rubric:',
      '- stale rubric.',
      '',
      'History:',
      '- stale entry.',
      '',
      '## unrelated-breakdown-section',
      '',
      'Parent TODO: unrelated-parent.',
      '',
      'Dependency graph:',
      '- unrelated-leaf: <none>',
      '',
      'Verification ledger:',
      '- unrelated-leaf: `node --test scripts/unrelated.test.mjs`',
      '',
      'Quality rubric:',
      '- unrelated rubric.',
      '',
      'History:',
      '- unrelated entry.',
      ''
    ].join('\n'));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const breakdownText = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    assert(!todoText.includes('TODO-decompose-broad-todo-9430463ff3c2'), todoText);
    assert(!todoText.includes('- [ ] E-19h-release-contract-trace-binding:'), todoText);
    assert(todoText.includes('E-19h-release-contract-trace-test'), todoText);
    assert(todoText.includes('E-19h-release-contract-trace-fields'), todoText);
    assert(todoText.includes('pnpm --workspace-root guard:release-contract:test'), todoText);
    assert(todoText.includes('pnpm --workspace-root guard:runtime-release-readiness'), todoText);
    assert(breakdownText.includes('E-19h-release-contract-trace-test'), breakdownText);
    assert(!breakdownText.includes('stale-leaf'), breakdownText);
    assert(breakdownText.includes('## unrelated-breakdown-section'), breakdownText);
    assert(breakdownText.includes('- unrelated-leaf: <none>'), breakdownText);
    assert.deepEqual(validateTodoDecompositionText(todoText, {
      path: '.brownie/todo.md',
      repoRoot: root,
      packageScripts: new Set([
        'guard:release-contract',
        'guard:release-contract:test',
        'guard:runtime-release-readiness',
        'guard:phase-value',
        'guard:todo-decomposition'
      ]),
      breakdownPath: '.brownie/todo-breakdown.md',
      breakdownText,
      productReady: false,
      releaseBlockersRemaining: true
    }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('falls back to explicit blocker leaf when broad TODO has no bounded target paths', () => {
  const root = makeTempRepo();
  try {
    const selected = `- [ ] TODO-decompose-broad-todo-nopath: Decompose broad TODO \`E-22a-no-target\` into implementable leaf TODOs:
  Route: todo-decomposition. Source: selected TODO hash \`abc\` needs Brownie-owned decomposition because \`broad_unbounded_todo\`. Brownie must patch \`.brownie/todo.md\`.`;
    const source = `- [ ] E-22a-no-target: Resolve the remaining release blocker without target scope.
  Route: implementation.
  Depends on: <none>.
  Completion condition: a concrete scope is identified.
  Forbidden changes: do not edit unrelated files.
  Verification: blocker: target scope is unknown.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n${selected}\n\n${source}\n`);
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-test',
      selected_todo: selected
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    assert(todoText.includes('E-22a-no-target-blocker'), todoText);
    assert(todoText.includes('Route: release-ops.'), todoText);
    assert(todoText.includes('Verification: blocker:'), todoText);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('repairs selected leaf peer target while preserving its completed prerequisite', () => {
  const root = makeTempRepo();
  try {
    const selected = `- [ ] E-20g-final-judgment-sync-target-01: Patch only \`docs/architecture/final-product-ready-judgment.json\` to complete one bounded slice of E-20g-final-judgment-sync:
  Route: documentation.
  Source TODO: E-20g-final-judgment-sync.
  Depends on: E-20f-release-generation-sync.
  Completion condition: Patch only \`docs/architecture/final-product-ready-judgment.json\` so this slice satisfies the parent TODO intent: semantic consistency tests fail when Final Judgment names an obsolete blocker generation while TODO, Phase manifest, or Readiness Audit name a newer Release blocker.
  Forbidden changes: do not mark Product Ready, do not remove owner-review history, and do not weaken semantic consistency failures; do not edit unrelated files or sibling split targets \`scripts/guard-release-evidence-semantic-consistency.test.mjs\`.
  Verification: run \`pnpm --workspace-root guard:release-evidence-semantic-consistency:test\` and \`pnpm --workspace-root guard:release-evidence-semantic-consistency\`.`;
    const sibling = `- [ ] E-20g-final-judgment-sync-target-02: Patch only \`scripts/guard-release-evidence-semantic-consistency.test.mjs\` to complete one bounded slice of E-20g-final-judgment-sync:
  Route: implementation.
  Source TODO: E-20g-final-judgment-sync.
  Depends on: E-20g-final-judgment-sync-target-01.
  Completion condition: Patch only \`scripts/guard-release-evidence-semantic-consistency.test.mjs\` so this slice satisfies the parent TODO intent.
  Forbidden changes: do not mark Product Ready, do not remove owner-review history, and do not edit unrelated files or sibling split targets \`docs/architecture/final-product-ready-judgment.json\`.
  Verification: run \`pnpm --workspace-root guard:release-evidence-semantic-consistency:test\`.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n- [x] E-20g-final-judgment-sync: Patch only \`docs/architecture/final-product-ready-judgment.json\` and \`scripts/guard-release-evidence-semantic-consistency.test.mjs\`: require Final Judgment generation/status to match the live TODO/phase/audit blocker generation.\n\n${selected}\n\n${sibling}\n`);
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      '## TODO-decompose-e20g',
      '',
      'Parent TODO: E-20g-final-judgment-sync',
      '',
      'Dependency graph:',
      '- E-20g-final-judgment-sync-target-01: E-20f-release-generation-sync',
      '- E-20g-final-judgment-sync-target-02: E-20g-final-judgment-sync-target-01',
      '',
      'Verification ledger:',
      '- E-20g-final-judgment-sync-target-01: run `pnpm --workspace-root guard:release-evidence-semantic-consistency:test` and `pnpm --workspace-root guard:release-evidence-semantic-consistency`',
      '- E-20g-final-judgment-sync-target-02: run `pnpm --workspace-root guard:release-evidence-semantic-consistency:test`',
      '',
      'Quality rubric:',
      '- E-20g-final-judgment-sync-target-01: bounded target scope.',
      '- E-20g-final-judgment-sync-target-02: bounded target scope.',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-test',
      selected_todo: selected
    }, null, 2));

    fs.mkdirSync(path.join(root, '.brownie/private/phase-loop/todo-completions'), {recursive:true});
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-completions/prerequisite.json'), JSON.stringify(durableCompletionRecord('E-20f-release-generation-sync')));
    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const breakdownText = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    const repairedSelected = todoText.slice(
      todoText.indexOf('- [ ] E-20g-final-judgment-sync-target-01:'),
      todoText.indexOf('- [ ] E-20g-final-judgment-sync-target-02:')
    );
    assert(!repairedSelected.includes('docs/architecture/final-product-ready-judgment.json'), repairedSelected);
    assert(repairedSelected.includes('docs/architecture/final-product-ready-judgment.md'), repairedSelected);
    assert(repairedSelected.includes('Depends on: E-20f-release-generation-sync.'), repairedSelected);
    assert(breakdownText.includes('- E-20g-final-judgment-sync-target-01: E-20f-release-generation-sync'), breakdownText);
    assert.deepEqual(validateTodoDecompositionText(todoText, {
      path: '.brownie/todo.md',
      repoRoot: root,
      packageScripts: new Set([
        'guard:release-contract',
        'guard:release-contract:test',
        'guard:runtime-release-readiness',
        'guard:phase-value',
        'guard:release-evidence-semantic-consistency',
        'guard:release-evidence-semantic-consistency:test',
        'guard:todo-decomposition'
      ]),
      breakdownPath: '.brownie/todo-breakdown.md',
      breakdownText,
      completedTodoIds: new Set(['E-20f-release-generation-sync']),
      productReady: false,
      releaseBlockersRemaining: true
    }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects dangling dependency when active claim disappeared without completion', () => {
  const root = makeTempRepo();
  try {
    const selected = `- [ ] E-15e-todo-queue-decomposition: Patch only \`.brownie/todo.md\` to replace the selected decomposition TODO with bounded leaves.
  Route: todo-decomposition.
  Source TODO: TODO-decompose-release-ops-blockers-1c5120ce46c2-r2.
  Depends on: <none>.
  Completion condition: leaf TODOs are generated.
  Forbidden changes: do not patch implementation files.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    const remainingLeaf = `- [ ] E-15f-todo-breakdown-update: Patch only \`.brownie/todo-breakdown.md\` to add the parent TODO, dependency graph, and verification ledger for the generated leaf TODOs.
  Route: todo-decomposition.
  Source TODO: TODO-decompose-release-ops-blockers-1c5120ce46c2-r2.
  Depends on: E-15e-todo-queue-decomposition.
  Completion condition: The breakdown ledger contains the parent ID, leaf IDs, dependency edges, and a short history note.
  Forbidden changes: do not modify implementation files or declare Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n${remainingLeaf}\n`);
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      'Parent TODO: TODO-decompose-release-ops-blockers-1c5120ce46c2-r2',
      '',
      'Dependency graph:',
      '- E-15e-todo-queue-decomposition: <none>',
      '- E-15f-todo-breakdown-update: E-15e-todo-queue-decomposition',
      '',
      'Verification ledger:',
      '- E-15e-todo-queue-decomposition: run `pnpm --workspace-root guard:todo-decomposition`',
      '- E-15f-todo-breakdown-update: run `pnpm --workspace-root guard:todo-decomposition`',
      '',
      'Quality rubric:',
      '- E-15f-todo-breakdown-update: bounded breakdown update leaf.',
      '',
      'History:',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-test',
      selected_todo: selected
    }, null, 2));

    const beforeTodo = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const beforeBreakdown = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    const result = runRepair(root);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.applied, false);
    assert.equal(parsed.reason, 'unresolved_dependency_without_completion');
    assert.equal(fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8'), beforeTodo);
    assert.equal(fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8'), beforeBreakdown);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebases a dependency on an unresolved superseded parent to its live child frontier', () => {
  const root = makeTempRepo();
  try {
    const parentId = 'E-23a-parent';
    const childId = `${parentId}-target-01`;
    const downstreamSourceId = 'E-23b-release-work';
    const downstreamId = `${downstreamSourceId}-target-01`;
    const child = `- [ ] ${childId}: Patch only \`scripts/guard-release-contract.mjs\` for the parent fixture:
  Route: implementation.
  Source TODO: ${parentId}.
  Depends on: <none>.
  Completion condition: preserve the parent work as an executable child.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root guard:release-contract\`.`;
    const downstream = `- [ ] ${downstreamId}: Patch only \`scripts/guard-runtime-release-readiness.mjs\` after the parent fixture:
  Route: implementation.
  Source TODO: ${downstreamSourceId}.
  Depends on: ${parentId}.
  Completion condition: retain the predecessor ordering through an executable dependency.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root guard:runtime-release-readiness\`.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), [
      `- [x] ${parentId}: Patch only \`scripts/guard-release-contract.mjs\`.`,
      '  Route: implementation.',
      '  Source TODO: fixture.',
      '  Depends on: <none>.',
      '  Completion condition: parent fixture.',
      '  Forbidden changes: do not edit unrelated files.',
      '  Verification: run `pnpm --workspace-root guard:release-contract`.',
      '', child, '', downstream, ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown', '', `## ${parentId} no-eligible multi-target split`, '', `Parent TODO: ${parentId}`, '',
      'Targets:', `- ${childId}: \`scripts/guard-release-contract.mjs\``, '', 'Dependency graph:',
      `- ${childId}: <none>`, `- ${downstreamId}: ${parentId}`,
      '', 'Verification ledger:', `- ${childId}: run \`pnpm --workspace-root guard:release-contract\``, `- ${downstreamId}: run \`pnpm --workspace-root guard:runtime-release-readiness\``,
      '', 'Quality rubric:', `- ${childId}: executable child.`, `- ${downstreamId}: ordered successor.`, '', 'History:', ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1, claim_id: 'claim-superseded-parent', selected_todo: downstream
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.operation, 'deterministic_dangling_dependency_repair');
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const breakdownText = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    assert.match(todoText, new RegExp(`Depends on: ${childId}\\.`));
    assert.doesNotMatch(todoText, new RegExp(`Depends on: ${parentId}\\.`));
    assert.match(breakdownText, new RegExp(`- ${downstreamId}: ${childId}`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed when a superseded dependency has an incomplete child frontier', () => {
  const root = makeTempRepo();
  try {
    const tick = String.fromCharCode(96);
    const parentId = 'E-23a-parent';
    const liveChildId = parentId + '-target-01';
    const missingChildId = parentId + '-target-02';
    const downstreamSourceId = 'E-23b-release-work';
    const downstreamId = downstreamSourceId + '-target-01';
    const liveChild = '- [ ] ' + liveChildId + ': Patch only ' + tick + 'scripts/guard-release-contract.mjs' + tick + ' for the parent fixture:\n'
      + '  Route: implementation.\n'
      + '  Source TODO: ' + parentId + '.\n'
      + '  Depends on: <none>.\n'
      + '  Completion condition: preserve the parent work as an executable child.\n'
      + '  Forbidden changes: do not edit unrelated files.\n'
      + '  Verification: run ' + tick + 'pnpm --workspace-root guard:release-contract' + tick + '.';
    const downstream = '- [ ] ' + downstreamId + ': Patch only ' + tick + 'scripts/guard-runtime-release-readiness.mjs' + tick + ' after the parent fixture:\n'
      + '  Route: implementation.\n'
      + '  Source TODO: ' + downstreamSourceId + '.\n'
      + '  Depends on: ' + parentId + '.\n'
      + '  Completion condition: retain the predecessor ordering through an executable dependency.\n'
      + '  Forbidden changes: do not edit unrelated files.\n'
      + '  Verification: run ' + tick + 'pnpm --workspace-root guard:runtime-release-readiness' + tick + '.';
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), [
      '- [x] ' + parentId + ': Patch only ' + tick + 'scripts/guard-release-contract.mjs' + tick + '.',
      '  Route: implementation.',
      '  Source TODO: fixture.',
      '  Depends on: <none>.',
      '  Completion condition: parent fixture.',
      '  Forbidden changes: do not edit unrelated files.',
      '  Verification: run ' + tick + 'pnpm --workspace-root guard:release-contract' + tick + '.',
      '', liveChild, '', downstream, ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown', '', '## ' + parentId + ' incomplete split', '',
      'Parent TODO: ' + parentId, '', 'Dependency graph:',
      '- ' + liveChildId + ': <none>', '- ' + downstreamId + ': ' + parentId,
      '', 'Verification ledger:',
      '- ' + liveChildId + ': run ' + tick + 'pnpm --workspace-root guard:release-contract' + tick,
      '- ' + downstreamId + ': run ' + tick + 'pnpm --workspace-root guard:runtime-release-readiness' + tick,
      '', 'Quality rubric:', '- ' + liveChildId + ': executable child.',
      '- ' + downstreamId + ': ordered successor.', '', 'History:', ''
    ].join('\n'));
    fs.mkdirSync(path.join(root, '.brownie/private/phase-loop/todo-replans'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.brownie/private/phase-loop/todo-replans/incomplete.json'),
      JSON.stringify({
        schema_version: 1,
        record_type: 'todo_replan',
        operation: 'split_parent_into_children',
        parent_status: 'superseded_by_children',
        parent_todo_id: parentId,
        generated_child_ids: [liveChildId, missingChildId],
        generated_leaf_ids: [liveChildId, missingChildId]
      }, null, 2)
    );
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1, claim_id: 'claim-incomplete-frontier', selected_todo: downstream
    }, null, 2));

    const result = runRepair(root);
    assert.notEqual(result.status, 0, result.stdout + '\n' + result.stderr);
    assert.match(result.stdout, /superseded_dependency_has_incomplete_child_frontier/u);
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    assert.match(todoText, new RegExp('Depends on: ' + parentId + '\\.'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('atomically repairs a derived leaf dependency and missing breakdown entries after a stale claim', () => {
  const root = makeTempRepo();
  try {
    const staleSelected = `- [ ] E-23a-stale-decomposition: Patch only \`.brownie/todo.md\` to repair an earlier decomposition.
  Route: todo-decomposition.
  Source TODO: E-23a-parent.
  Depends on: <none>.
  Completion condition: the queue is valid.
  Forbidden changes: do not edit implementation files.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    const decomposition = `- [ ] E-23a-breakdown-sync: Patch only \`.brownie/todo-breakdown.md\` to record child leaves for E-23a-parent:
  Route: todo-decomposition.
  Source TODO: E-23a-parent.
  Depends on: <none>.
  Completion condition: the breakdown ledger records each derived leaf.
  Forbidden changes: do not edit implementation files.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    const implementation = `- [ ] E-23a-child-impl: Patch only \`scripts/release-local-artifact.mjs\` to implement the bounded child:
  Route: implementation.
  Source TODO: E-23a-parent.
  Depends on: <none>.
  Completion condition: the child implementation is complete.
  Forbidden changes: do not declare Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    const dependent = `- [ ] E-23a-child-test: Patch only \`scripts/release-local-artifact.test.mjs\` to test the bounded child:
  Route: implementation.
  Source TODO: E-23a-parent.
  Depends on: E-23a-child-impl, E-23a-stale-decomposition.
  Completion condition: the child test is complete.
  Forbidden changes: do not declare Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    fs.writeFileSync(path.join(root, 'scripts/release-local-artifact.mjs'), '// fixture\n');
    fs.writeFileSync(path.join(root, 'scripts/release-local-artifact.test.mjs'), '// fixture\n');
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n${decomposition}\n\n${implementation}\n\n${dependent}\n`);
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      'Dependency graph:',
      '- E-23a-stale-decomposition: <none>',
      '- E-23a-child-test: E-23a-child-impl, E-23a-stale-decomposition',
      '',
      'Verification ledger:',
      '- E-23a-stale-decomposition: run `pnpm --workspace-root guard:todo-decomposition`',
      '',
      'Quality rubric:',
      '',
      'History:',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-test',
      selected_todo: staleSelected
    }, null, 2));

    fs.mkdirSync(path.join(root, '.brownie/private/phase-loop/todo-completions'), {recursive:true});
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-completions/prerequisite.json'), JSON.stringify(durableCompletionRecord('E-23a-stale-decomposition')));
    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const breakdownText = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    assert(todoText.includes('Depends on: E-23a-child-impl, E-23a-stale-decomposition.'), todoText);
    assert(breakdownText.includes('## TODO-repair-derived-E-23a-parent'), breakdownText);
    assert(breakdownText.includes('- E-23a-child-test: E-23a-child-impl'), breakdownText);
    assert.deepEqual(validateTodoDecompositionText(todoText, {
      path: '.brownie/todo.md',
      repoRoot: root,
      packageScripts: new Set(['guard:todo-decomposition']),
      breakdownPath: '.brownie/todo-breakdown.md',
      breakdownText,
      completedTodoIds: new Set(['E-23a-stale-decomposition']),
      productReady: false,
      releaseBlockersRemaining: true
    }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('adds missing breakdown section for breakdown-only decomposition leaf', () => {
  const root = makeTempRepo();
  try {
    const selected = `- [ ] E-15f-todo-breakdown-update: Patch only \`.brownie/todo-breakdown.md\` to add the parent TODO, dependency graph, and verification ledger for the generated leaf TODOs.
  Route: todo-decomposition.
  Source TODO: TODO-decompose-release-ops-blockers-1c5120ce46c2-r2.
  Depends on: <none>.
  Completion condition: The breakdown ledger contains the parent ID, leaf IDs, dependency edges, and a short history note.
  Forbidden changes: do not modify implementation files or declare Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    const blocker = `- [ ] E-99-release-blocker: Blocker: external release evidence remains pending.
  Route: blocker.
  Depends on: <none>.
  Completion condition: external evidence is supplied.
  Forbidden changes: do not invent evidence values or declare Product Ready.
  Verification: blocker: exact missing evidence or field is named, and no workspace file is patched until that evidence is available.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n${selected}\n\n${blocker}\n`);
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      'Parent TODO: some-other-parent',
      '',
      'Dependency graph:',
      '- E-15f-todo-breakdown-update: <none>',
      '',
      'Verification ledger:',
      '- E-15f-todo-breakdown-update: run `pnpm --workspace-root guard:todo-decomposition`',
      '',
      'Quality rubric:',
      '- E-15f-todo-breakdown-update: bounded breakdown update leaf.',
      '',
      'History:',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-test',
      selected_todo: selected
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.operation, 'deterministic_breakdown_update_leaf_repair');
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const breakdownText = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    assert(breakdownText.includes('Parent TODO: TODO-decompose-release-ops-blockers-1c5120ce46c2-r2'), breakdownText);
    assert(breakdownText.includes('## TODO-repair-E-15f-todo-breakdown-update'), breakdownText);
    assert(!todoText.includes('- [ ] E-15f-todo-breakdown-update:'), todoText);
    assert.deepEqual(validateTodoDecompositionText(todoText, {
      path: '.brownie/todo.md',
      repoRoot: root,
      packageScripts: new Set([
        'guard:release-contract',
        'guard:release-contract:test',
        'guard:runtime-release-readiness',
        'guard:phase-value',
        'guard:todo-decomposition'
      ]),
      breakdownPath: '.brownie/todo-breakdown.md',
      breakdownText,
      productReady: false,
      releaseBlockersRemaining: true
    }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('removes release-ops decomposition request when leaf outputs already exist', () => {
  const root = makeTempRepo();
  try {
    const selected = `- [ ] TODO-decompose-release-ops-blockers-abc123: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to convert release-ops blocker TODOs into implementable Brownie-owned leaf TODOs:
  Route: todo-decomposition.
  Queue hash: \`abc123\`.
  Depends on: <none>.
  Completion condition: The release-ops blocker TODOs are replaced by bounded implementation/documentation/release-ops leaves that name exact target files and existing verification commands, while truly owner-controlled or external-environment requirements remain explicit blockers.
  Forbidden changes: do not patch implementation files in this decomposition pass, do not invent evidence values, and do not declare Runtime Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    const releaseOpsLeaf = `- [ ] E-21c-release-ops-todo-split-clean-release-workspace: Blocker: clean Release workspace setup remains pending:
  Route: release-ops.
  Source TODO: E-21c-release-ops-todo-split.
  Depends on: <none>.
  Completion condition: Release Ops has a concrete fail-closed evidence item and Product Ready remains false until that evidence is produced.
  Forbidden changes: do not patch implementation files, do not invent evidence values, and do not declare Runtime Product Ready.
  Verification: blocker: Release Ops evidence remains fail-closed until this item is replaced by generated evidence or by a bounded implementation TODO with existing verification.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n${selected}\n\n${releaseOpsLeaf}\n`);
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      'Parent TODO: E-21c-release-ops-todo-split',
      '',
      'Dependency graph:',
      '- E-21c-release-ops-todo-split-clean-release-workspace: <none>',
      '',
      'Verification ledger:',
      '- E-21c-release-ops-todo-split-clean-release-workspace: blocker: Release Ops evidence remains fail-closed',
      '',
      'Quality rubric:',
      '- E-21c-release-ops-todo-split-clean-release-workspace: bounded release-ops blocker.',
      '',
      'History:',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-test',
      selected_todo: selected
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.operation, 'deterministic_release_ops_decomposition_request_repair');
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const breakdownText = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    assert(!todoText.includes('- [ ] TODO-decompose-release-ops-blockers-abc123:'), todoText);
    assert(todoText.includes('- [ ] E-21c-release-ops-todo-split-clean-release-workspace:'), todoText);
    assert(breakdownText.includes('Parent TODO: TODO-decompose-release-ops-blockers-abc123'), breakdownText);
    assert.deepEqual(validateTodoDecompositionText(todoText, {
      path: '.brownie/todo.md',
      repoRoot: root,
      packageScripts: new Set([
        'guard:release-contract',
        'guard:release-contract:test',
        'guard:runtime-release-readiness',
        'guard:phase-value',
        'guard:todo-decomposition'
      ]),
      breakdownPath: '.brownie/todo-breakdown.md',
      breakdownText,
      productReady: false,
      releaseBlockersRemaining: true
    }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('refines Brownie-owned release-ops blockers into executable implementation leaves', () => {
  const root = makeTempRepo();
  try {
    const selected = `- [ ] TODO-refine-brownie-owned-blockers-feedface1234: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to refine Brownie-owned blocker TODOs into executable implementation/documentation leaves:
  Route: todo-decomposition.
  Queue hash: \`feedface1234\`.
  Depends on: <none>.
  Completion condition: Brownie-owned blockers are replaced by bounded implementation or documentation TODOs with exact target files and existing verification commands, while true external authority blockers remain explicit blockers.
  Forbidden changes: do not patch implementation files in this refinement pass, do not invent evidence values, do not weaken fail-closed release gates, and do not declare Runtime Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\` and \`pnpm --workspace-root phase-loop:todo-queue-integrity\`.`;
    const ownedA = `- [ ] E-21c-release-ops-todo-split-golden-journey: Blocker: Golden Journey evidence is generated from a temporary workspace with observable workspace mutation instead of reusing the dirty development workspace:
  Route: release-ops.
  Source TODO: E-21c-release-ops-todo-split.
  Depends on: <none>.
  Completion condition: Release Ops has a concrete fail-closed evidence item for Golden Journey evidence, and Product Ready remains false until that evidence is produced and bound to the current release commit.
  Forbidden changes: do not patch implementation files for this Release Ops blocker, do not invent evidence values, and do not declare Runtime Product Ready.
  Verification: blocker: Release Ops evidence remains fail-closed until this item is replaced by generated evidence or by a bounded implementation TODO with existing verification.`;
    const ownedB = `- [ ] E-21c-release-ops-todo-split-provenance-binding: Blocker: artifact SHA, source commit, workflow/run identity, and clean tree status are bound together before Release Contract trace fields can be populated:
  Route: release-ops.
  Source TODO: E-21c-release-ops-todo-split.
  Depends on: E-21c-release-ops-todo-split-golden-journey.
  Completion condition: Release Ops has a concrete fail-closed evidence item for provenance binding, and Product Ready remains false until that evidence is produced and bound to the current release commit.
  Forbidden changes: do not patch implementation files for this Release Ops blocker, do not invent evidence values, and do not declare Runtime Product Ready.
  Verification: blocker: Release Ops evidence remains fail-closed until this item is replaced by generated evidence or by a bounded implementation TODO with existing verification.`;
    const external = `- [ ] E-20i-runtime-release-ops-blocker: Blocker: Owner-controlled Runtime Release Ops authority is required for clean CI build, artifact upload/provenance, and GitHub Release publication.
  Route: blocker.
  Source TODO: TODO-decompose-release-ops-blockers.
  Depends on: <none>.
  Completion condition: Release engineering owner provides or documents the Runtime Release Ops authority needed for clean CI builds, artifact upload/provenance binding, and GitHub Release publication. Customer or Enterprise production deployment credentials are explicitly out of Runtime Product Ready scope and must not block the OSS Runtime release.
  Forbidden changes: do not attempt to configure external CI/CD, create credentials, publish a GitHub Release, or request customer/Enterprise production deployment credentials.
  Verification: inspect/blocker/fail-closed until Release Ops owner provides evidence of clean CI/artifact/provenance/publication authority or documents the remaining owner-controlled Runtime Release requirement.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n${selected}\n\n${ownedA}\n\n${ownedB}\n\n${external}\n`);
    fs.mkdirSync(path.join(root, '.brownie/private/phase-loop/todo-replans'), { recursive: true });
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-replans/E-19k.json'), JSON.stringify({
      schema_version: 1,
      record_type: 'todo_replan',
      operation: 'split_parent_into_children',
      parent_todo_id: 'E-19k-remaining-release-evidence-blocker',
      parent_status: 'superseded_by_children',
      replacement_source_todo_id: 'E-21c-release-ops-todo-split',
      generated_child_ids: [
        'E-21c-release-ops-todo-split-golden-journey',
        'E-21c-release-ops-todo-split-provenance-binding'
      ]
    }, null, 2));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-owned-refinement',
      selected_todo: selected
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.operation, 'deterministic_brownie_owned_blocker_refinement_repair');
    assert(parsed.replanRecordPaths.some((entry) => entry.includes('E-19k-remaining-release-evidence-blocker')), parsed);
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const breakdownText = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    assert(!todoText.includes('- [ ] TODO-refine-brownie-owned-blockers-feedface1234:'), todoText);
    assert(!todoText.includes('- [ ] E-21c-release-ops-todo-split-golden-journey: Blocker:'), todoText);
    assert(todoText.includes('E-21c-runtime-operational-evidence-impl-1'), todoText);
    assert(todoText.includes('Route: implementation.'), todoText);
    assert(todoText.includes('scripts/release-runtime-operational-evidence.mjs'), todoText);
    assert(todoText.includes('scripts/release-supply-chain-artifact-evidence.mjs'), todoText);
    assert(todoText.includes('Depends on: E-21c-runtime-operational-evidence-impl-1.'), todoText);
    assert(todoText.includes('- [ ] E-20i-runtime-release-ops-blocker:'), todoText);
    assert(breakdownText.includes('Parent TODO: brownie-owned-blocker-refinement'), breakdownText);
    assert.deepEqual(validateTodoDecompositionText(todoText, {
      path: '.brownie/todo.md',
      repoRoot: root,
      packageScripts: new Set([
        'guard:release-contract',
        'guard:release-contract:test',
        'guard:runtime-release-readiness',
        'guard:phase-value',
        'guard:release-evidence-semantic-consistency',
        'guard:release-evidence-semantic-consistency:test',
        'guard:runtime-operational-evidence',
        'guard:runtime-operational-evidence:test',
        'guard:supply-chain-artifact-evidence',
        'guard:supply-chain-artifact-evidence:test',
        'release:runtime-operational-evidence:test',
        'guard:todo-decomposition'
      ]),
      breakdownPath: '.brownie/todo-breakdown.md',
      breakdownText,
      productReady: false,
      releaseBlockersRemaining: true
    }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('converts directory-scoped implementation leaf into Brownie-owned decomposition TODO', () => {
  const root = makeTempRepo();
  try {
    const selected = `- [ ] E-21a-clean-release-workspace-contract-leaf-c: Patch only \`scripts/\` to close one bounded slice of E-21a-clean-release-workspace-contract:
  Route: implementation.
  Source TODO: E-21a-clean-release-workspace-contract.
  Depends on: <none>.
  Completion condition: The bounded E-21a-clean-release-workspace-contract slice for scripts/ is implemented and verified without changing unrelated release readiness state.
  Forbidden changes: do not edit unrelated files, do not invent release evidence values, and do not declare Runtime Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n${selected}\n`);
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-directory',
      selected_todo: selected
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const breakdownText = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    assert(todoText.includes('E-21a-clean-release-workspace-contract-leaf-c-decompose-targets'), todoText);
    assert(todoText.includes('Route: todo-decomposition.'), todoText);
    assert(todoText.includes('Patch only `.brownie/todo.md` and `.brownie/todo-breakdown.md`'), todoText);
    assert(!todoText.includes('Patch only `scripts/`'), todoText);
    assert(breakdownText.includes('TODO-repair-E-21a-clean-release-workspace-contract-leaf-c-decompose-targets'), breakdownText);
    assert.deepEqual(validateTodoDecompositionText(todoText, {
      path: '.brownie/todo.md',
      repoRoot: root,
      packageScripts: new Set(['guard:todo-decomposition']),
      breakdownPath: '.brownie/todo-breakdown.md',
      breakdownText,
      productReady: false,
      releaseBlockersRemaining: true
    }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('expands Brownie-owned directory decomposition TODO into concrete script leaves', () => {
  const root = makeTempRepo();
  try {
    const selected = `- [ ] E-21a-clean-release-workspace-contract-leaf-c-decompose-targets: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to decompose directory-scoped TODO E-21a-clean-release-workspace-contract-leaf-c into concrete file-specific leaves:
  Route: todo-decomposition.
  Source TODO: E-21a-clean-release-workspace-contract.
  Depends on: <none>.
  Completion condition: Brownie replaces the directory target \`scripts/\` with executable single-file Patch only/Create only leaves, each with existing verification commands and without implementing the underlying Release work in this decomposition pass.
  Forbidden changes: do not edit implementation, documentation, or Release evidence files outside \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\`; do not declare Runtime Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    const dependent = `- [ ] E-21b-release-workspace-guard-decompose-targets: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to decompose directory-scoped TODO E-21b-release-workspace-guard into concrete file-specific leaves:
  Route: todo-decomposition.
  Source TODO: E-21b-release-workspace-guard.
  Depends on: E-21a-clean-release-workspace-contract-leaf-c-decompose-targets.
  Completion condition: Brownie replaces the directory target \`scripts/\` with executable single-file Patch only/Create only leaves.
  Forbidden changes: do not edit implementation, documentation, or Release evidence files outside \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\`; do not declare Runtime Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n${selected}\n\n${dependent}\n`);
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      '## TODO-repair-E-21b-release-workspace-guard-decompose-targets',
      '',
      'Parent TODO: E-21b-release-workspace-guard',
      '',
      'Dependency graph:',
      '- E-21b-release-workspace-guard-decompose-targets: E-21a-clean-release-workspace-contract-leaf-c-decompose-targets',
      '',
      'Verification ledger:',
      '- E-21b-release-workspace-guard-decompose-targets: run `pnpm --workspace-root guard:todo-decomposition`',
      '',
      'Quality rubric:',
      '- E-21b-release-workspace-guard-decompose-targets: bounded TODO repair scope.',
      '',
      'History:',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-decompose-targets',
      selected_todo: selected
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const breakdownText = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    assert(!todoText.includes('- [ ] E-21a-clean-release-workspace-contract-leaf-c-decompose-targets:'), todoText);
    assert(todoText.includes('E-21a-clean-release-workspace-contract-scripts-leaf-a'), todoText);
    assert(todoText.includes('Patch only `scripts/guard-release-contract.mjs` and `scripts/guard-release-contract.test.mjs`'), todoText);
    assert(todoText.includes('Depends on: E-21a-clean-release-workspace-contract-scripts-leaf-a.'), todoText);
    assert(breakdownText.includes('TODO-decompose-E-21a-clean-release-workspace-contract-leaf-c-decompose-targets'), breakdownText);
    assert.deepEqual(validateTodoDecompositionText(todoText, {
      path: '.brownie/todo.md',
      repoRoot: root,
      packageScripts: new Set([
        'guard:release-contract',
        'guard:release-contract:test',
        'guard:todo-decomposition'
      ]),
      breakdownPath: '.brownie/todo-breakdown.md',
      breakdownText,
      productReady: false,
      releaseBlockersRemaining: true
    }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('expands residual Release Ops blocker decomposition into fail-closed evidence leaves', () => {
  const root = makeTempRepo();
  try {
    const selected = `- [ ] E-21c-release-ops-todo-split-decompose-targets: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to replace the residual E-19k blocker with concrete Release Ops leaves:
  Route: todo-decomposition.
  Source TODO: E-21c-release-ops-todo-split.
  Depends on: <none>.
  Completion condition: Brownie creates executable Release Ops leaves for clean artifact generation, artifact E2E smoke, lifecycle, Golden Journey, stateful soak, provenance binding, owner governance reproducibility, and document generation sync, while keeping Product Ready false.
  Forbidden changes: do not edit implementation, documentation, or Release evidence files outside \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\`; do not declare Runtime Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    const residual = `- [ ] E-19k-remaining-release-evidence-blocker: Blocker: release evidence remains incomplete after E-19 TODO injection, and Product Ready must remain false until Golden Journey, artifact E2E, lifecycle, stateful soak, provenance binding, dependency audit sync, and owner-verifiable branch protection are closed.
  Route: release-ops.
  Depends on: <none>.
  Completion condition: remaining release blocker evidence is explicitly identified and Product Ready is not inferred from a queue that only contains blockers.
  Forbidden changes: do not patch workspace files for this blocker; do not declare Runtime Product Ready, Runtime Release Ready, or public Release Ready.
  Verification: blocker: release evidence remains fail-closed and no workspace file is patched until the next concrete executable evidence TODO is available.`;
    const dependent = `- [ ] E-21d-generation-consistency-guard-decompose-targets: Patch only \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\` to decompose directory-scoped TODO E-21d-generation-consistency-guard into concrete file-specific leaves:
  Route: todo-decomposition.
  Source TODO: E-21d-generation-consistency-guard.
  Depends on: E-21c-release-ops-todo-split-decompose-targets.
  Completion condition: Brownie replaces the directory target \`scripts/\` with executable single-file Patch only/Create only leaves.
  Forbidden changes: do not edit implementation, documentation, or Release evidence files outside \`.brownie/todo.md\` and \`.brownie/todo-breakdown.md\`; do not declare Runtime Product Ready.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `# Brownie TODO Queue\n\n## Product Ready Blocking Queue\n\n${selected}\n\n${dependent}\n\n${residual}\n`);
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      '## TODO-repair-E-21d-generation-consistency-guard-decompose-targets',
      '',
      'Parent TODO: E-21d-generation-consistency-guard',
      '',
      'Dependency graph:',
      '- E-21d-generation-consistency-guard-decompose-targets: E-21c-release-ops-todo-split-decompose-targets',
      '',
      'Verification ledger:',
      '- E-21d-generation-consistency-guard-decompose-targets: run `pnpm --workspace-root guard:todo-decomposition`',
      '',
      'Quality rubric:',
      '- E-21d-generation-consistency-guard-decompose-targets: bounded TODO repair scope.',
      '',
      'History:',
      ''
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-release-ops-split',
      selected_todo: selected
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const todoText = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const breakdownText = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    assert(!todoText.includes('- [ ] E-21c-release-ops-todo-split-decompose-targets:'), todoText);
    assert(!todoText.includes('- [ ] E-19k-remaining-release-evidence-blocker:'), todoText);
    assert(todoText.includes('E-21c-release-ops-todo-split-clean-release-workspace'), todoText);
    assert(todoText.includes('E-21c-release-ops-todo-split-stateful-soak'), todoText);
    assert(todoText.includes('E-21c-release-ops-todo-split-document-generation-sync'), todoText);
    assert(todoText.includes('E-21d-generation-consistency-guard-decompose-targets'), todoText);
    assert(todoText.includes('Depends on: <none>.'), todoText);
    assert(breakdownText.includes('TODO-decompose-E-21c-release-ops-todo-split-decompose-targets'), breakdownText);
    assert.deepEqual(validateTodoDecompositionText(todoText, {
      path: '.brownie/todo.md',
      repoRoot: root,
      packageScripts: new Set(['guard:todo-decomposition']),
      breakdownPath: '.brownie/todo-breakdown.md',
      breakdownText,
      productReady: false,
      releaseBlockersRemaining: true
    }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preserves completed and unproved dependencies together when repair is refused', () => {
  const root = makeTempRepo();
  try {
    const selected = `- [ ] E-22d-runtime-stateful-soak-evidence: Patch only \`scripts/release-runtime-operational-evidence.mjs\` and \`scripts/guard-runtime-operational-evidence.test.mjs\`:
  Route: implementation.
  Source TODO: E-22d.
  Depends on: E-22c-runtime-artifact-e2e-evidence, E-22-old-breakdown-only.
  Completion condition: Runtime operational evidence fails closed unless stateful soak evidence covers process-loss recovery and finite convergence.
  Forbidden changes: do not weaken Golden Journey evidence and do not declare Runtime Product Ready.
  Verification: run \`pnpm --workspace-root release:runtime-operational-evidence:test\` and \`pnpm --workspace-root guard:runtime-operational-evidence\`.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `${selected}\n`);
    fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), [
      '# TODO breakdown',
      '',
      'Parent TODO: E-22d-runtime-stateful-soak-evidence',
      '',
      'Dependency graph:',
      '- E-22d-runtime-stateful-soak-evidence: E-22c-runtime-artifact-e2e-evidence, E-22-old-breakdown-only',
      '- E-22-old-breakdown-only: <none>',
      '',
      'Verification ledger:',
      '',
      'Quality rubric:',
      '',
      'History:',
      ''
    ].join('\n'));
    fs.mkdirSync(path.join(root, '.brownie/private/phase-loop/todo-completions'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.brownie/private/phase-loop/todo-completions/e22c.json'),
      JSON.stringify(durableCompletionRecord('E-22c-runtime-artifact-e2e-evidence'), null, 2)
    );
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-completed-dependency',
      selected_todo: selected
    }, null, 2));

    const beforeTodo = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    const beforeBreakdown = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    const result = runRepair(root);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.applied, false);
    assert.equal(parsed.reason, 'unresolved_dependency_without_completion');
    assert.equal(fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8'), beforeTodo);
    assert.equal(fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8'), beforeBreakdown);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed with an auditable result when workspace package.json is invalid', () => {
  const root = makeTempRepo();
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{ invalid json\n');
    fs.writeFileSync(path.join(root, 'scripts/fixture.mjs'), 'export const fixture = true;\n');
    fs.writeFileSync(path.join(root, 'scripts/second-fixture.mjs'), 'export const secondFixture = true;\n');
    const source = `- [ ] E-invalid-package-contract: Patch only \`scripts/fixture.mjs\`, \`scripts/second-fixture.mjs\` to restore a broad workspace contract:
  Route: implementation.
  Depends on: <none>.
  Source concern: the workspace contract spans multiple independently verified fixture surfaces.
  Completion condition: both fixture surfaces remain executable.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`node --check scripts/fixture.mjs\`.`;
    const selected = `- [ ] TODO-decompose-broad-todo-invalid-package: Decompose broad TODO \`E-invalid-package-contract\` into bounded leaves:
  Route: todo-decomposition.
  Source TODO: E-invalid-package-contract.
  Depends on: <none>.
  Completion condition: replace the broad source TODO with bounded executable leaves.
  Forbidden changes: do not edit unrelated files.
  Verification: run \`pnpm --workspace-root guard:todo-decomposition\`.`;
    fs.writeFileSync(path.join(root, '.brownie/todo.md'), `${source}\n\n${selected}\n`);
    fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({
      schema_version: 1,
      claim_id: 'claim-invalid-package-contract',
      selected_todo: selected
    }, null, 2));

    const result = runRepair(root);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.applied, false, payload);
    assert.equal(payload.eligible, true, payload);
    assert.equal(payload.blocked, true, payload);
    assert.equal(payload.reason, 'workspace_package_json_invalid', payload);
    assert.equal(payload.error_code, 'workspace_package_json_invalid', payload);
    assert.match(payload.error_message, /package\.json is invalid/u);
    assert.doesNotMatch(result.stdout, /SyntaxError: Unexpected token/u);
    assert.equal(result.stderr, '');
    const todoAfter = fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8');
    assert.match(todoAfter, /E-invalid-package-contract/u);
    assert.match(todoAfter, /TODO-decompose-broad-todo-invalid-package/u);
    const breakdownAfter = fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8');
    assert.match(breakdownAfter, /^# TODO breakdown/u);
    assert.doesNotMatch(breakdownAfter, /TODO-decompose-broad-todo-invalid-package/u);
    assert.equal(fs.existsSync(path.join(root, '.brownie/private/phase-loop/todo-replans')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const mode of ['stale_claim', 'live_selected', 'mixed_live_and_missing', 'missing_outside_breakdown']) {
  test(`preserves unproved prerequisite atomically: ${mode}`, () => {
    const root = makeTempRepo();
    try {
      const fixture = {"remaining": "- [ ] E-15f-todo-breakdown-update: Patch only `.brownie/todo-breakdown.md` to document the required implementation leaves.\n  Route: todo-decomposition.\n  Source TODO: TODO-decompose-release-ops-blockers-abc123.\n  Depends on: E-15e-todo-queue-decomposition.\n  Completion condition: actual prerequisite implementation leaves are documented.\n  Forbidden changes: do not invent completion evidence.\n  Verification: run `pnpm --workspace-root guard:todo-decomposition`.\n", "breakdown": "# TODO breakdown\n\nParent TODO: TODO-decompose-release-ops-blockers-abc123\n\nDependency graph:\n- E-15e-todo-queue-decomposition: <none>\n- E-15f-todo-breakdown-update: E-15e-todo-queue-decomposition\n\nVerification ledger:\n- E-15f-todo-breakdown-update: run `pnpm --workspace-root guard:todo-decomposition`\n\nQuality rubric:\n- E-15f-todo-breakdown-update: bounded TODO maintenance.\n\nHistory:\n", "selected": "- [ ] E-15e-todo-queue-decomposition: Patch only `.brownie/todo.md`:\n  Route: todo-decomposition.\n  Source TODO: TODO-decompose-release-ops-blockers-abc123.\n  Depends on: <none>.\n  Completion condition: actual leaves created.\n  Forbidden changes: do not invent completion.\n  Verification: run `pnpm --workspace-root guard:todo-decomposition`.\n"};
      let todo = fixture.remaining;
      let breakdown = fixture.breakdown;
      let selected = fixture.selected;
      if (mode === 'live_selected') {
        todo = todo.replace('Route: todo-decomposition.', 'Route: implementation.');
        selected = todo;
      }
      if (mode === 'mixed_live_and_missing') {
        todo = todo.replace('Depends on: E-15e-todo-queue-decomposition.', 'Depends on: E-15e-todo-queue-decomposition, E-live.');
        todo += '\n- [ ] E-live: Patch only `scripts/guard-release-contract.mjs`:\n  Route: implementation.\n  Source TODO: E-parent.\n  Depends on: <none>.\n  Completion condition: independent live work.\n  Forbidden changes: do not invent completion.\n  Verification: run `pnpm --workspace-root guard:release-contract`.\n';
      }
      if (mode === 'missing_outside_breakdown') breakdown = '# no prerequisite record\n';
      fs.writeFileSync(path.join(root, '.brownie/todo.md'), todo);
      fs.writeFileSync(path.join(root, '.brownie/todo-breakdown.md'), breakdown);
      fs.writeFileSync(path.join(root, '.brownie/private/phase-loop/todo-claims/current.json'), JSON.stringify({claim_id:'audit-prerequisite',selected_todo:selected}));
      const result = runRepair(root);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.applied, false);
      assert.equal(parsed.reason, 'unresolved_dependency_without_completion');
      assert(parsed.unresolved_dependencies.some(row => row.dependencies.includes('E-15e-todo-queue-decomposition')));
      assert.equal(fs.readFileSync(path.join(root, '.brownie/todo.md'), 'utf8'), todo);
      assert.equal(fs.readFileSync(path.join(root, '.brownie/todo-breakdown.md'), 'utf8'), breakdown);
    } finally { fs.rmSync(root, {recursive:true,force:true}); }
  });
}

// Migrated from the former Runtime inline-leaf normalization test. The
// controller rejects malformed material; Runtime must not invent its route.
test('external decomposition rejects the original inline blocker instead of inventing metadata', () => {
  const selected = "- [ ] E-15e-release-readiness-audit-sync-leaf: Patch only `docs/architecture/runtime-release-readiness-audit.json`:\n  Route: documentation.\n  Source TODO: E-15e-release-contract-audit-phase-resync.\n  Depends on: E-15e-release-contract-doc-sync-leaf.\n  Completion condition: runtime release readiness audit records the current fail-closed evidence state without claiming Runtime Product Ready.\n  Forbidden changes: do not mark Runtime Product Ready and do not remove owner-controlled independent review blockers.\n  Verification: run `pnpm --workspace-root guard:runtime-release-readiness`.\n";
  const inline = "- [ ] E-15e-release-readiness-audit-sync-blocker: Blocker: cannot patch `docs/architecture/runtime-release-readiness-audit.json` without a safe exact old_text. Source TODO: E-15e-release-contract-audit-phase-resync. Depends on: E-15e-release-contract-doc-sync-leaf. Completion condition: runtime release readiness audit records the current fail-closed evidence state without claiming Runtime Product Ready. Forbidden changes: do not mark Runtime Product Ready and do not remove owner-controlled independent review blockers. Verification: run `pnpm --workspace-root guard:runtime-release-readiness` and inspect `docs/architecture/runtime-release-readiness-audit.json` for the required section.\n";
  const hunk = { old_text: selected.trimEnd(), new_text: inline };
  assert.throws(() => validateDecompositionTransition(selected, selected, [hunk]), /parent lineage/u);
  assert.equal(hunk.new_text, inline);
  assert.equal(hunk.new_text.includes('Route:'), false);
});

// Exact queue material from the former Runtime repair-policy tests.
const migratedQueueRepairCases = [
  {
    "name": "todo_repair_patch_rejects_self_source_leaf",
    "current": "old",
    "candidate": "- [ ] E-15d-soak-section-collector: Patch only `scripts/release-runtime-operational-evidence.mjs`:\n  Route: implementation.\n  Source TODO: E-15d-soak-section-collector: Patch only `scripts/release-runtime-operational-evidence.mjs`.\n  Depends on: <none>.\n  Completion condition: generated evidence is repaired.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.\n",
    "valid": false
  },
  {
    "name": "todo_repair_patch_rejects_duplicate_leaf_ids_in_new_text",
    "current": "old",
    "candidate": "- [ ] E-15d-soak-section-guard: Patch only `scripts/guard-runtime-operational-evidence.test.mjs`:\n  Route: implementation.\n  Source TODO: E-15d-stateful-soak-runner-real.\n  Depends on: E-15d-soak-section-collector.\n  Completion condition: guard evidence is repaired.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.\n- [ ] E-15d-soak-section-guard: Patch only `scripts/guard-runtime-operational-evidence.test.mjs`:\n  Route: implementation.\n  Source TODO: E-15d-stateful-soak-runner-real.\n  Depends on: E-15d-soak-section-collector.\n  Completion condition: guard evidence is repaired.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.\n",
    "valid": false
  },
  {
    "name": "todo_repair_patch_rejects_duplicate_leaf_ids_inside_hunks",
    "current": "old",
    "candidate": "- [ ] E-15d-soak-section-guard: Patch only `scripts/guard-runtime-operational-evidence.test.mjs`:\n  Route: implementation.\n  Source TODO: E-15d-stateful-soak-runner-real.\n  Depends on: E-15d-soak-section-collector.\n  Completion condition: guard evidence is repaired.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.\n- [ ] E-15d-soak-section-guard: Patch only `scripts/guard-runtime-operational-evidence.test.mjs`:\n  Route: implementation.\n  Source TODO: E-15d-stateful-soak-runner-real.\n  Depends on: E-15d-soak-section-collector.\n  Completion condition: guard evidence is repaired.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.\n",
    "valid": false
  },
  {
    "name": "todo_repair_patch_rejects_appended_leaf_ids_outside_old_text",
    "current": "- [ ] E-15d-soak-section-collector: Patch only `scripts/release-runtime-operational-evidence.mjs`:\n  Route: implementation.\n  Source TODO: E-15d-stateful-soak-runner-real.\n  Depends on: <none>.\n  Completion condition: collector evidence is repaired.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.\n",
    "candidate": "- [ ] E-15d-soak-section-collector: Patch only `scripts/release-runtime-operational-evidence.mjs`:\n  Route: implementation.\n  Source TODO: E-15d-stateful-soak-runner-real.\n  Depends on: <none>.\n  Completion condition: collector evidence is repaired.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.\n- [ ] E-15d-soak-section-guard: Patch only `scripts/guard-runtime-operational-evidence.test.mjs`:\n  Route: implementation.\n  Source TODO: E-15d-stateful-soak-runner-real.\n  Depends on: E-15d-soak-section-collector.\n  Completion condition: guard evidence is repaired.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.\n",
    "valid": false
  },
  {
    "name": "todo_repair_patch_allows_whole_corrupt_block_replacement",
    "current": "- [ ] E-15d-soak-section-collector: Patch only `scripts/release-runtime-operational-evidence.mjs`:\n  Route: implementation.\n  Source TODO: E-15d-stateful-soak-runner-real.\n  Depends on: <none>.\n  Completion condition: collector evidence is repaired.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.\n- [ ] E-15d-soak-section-guard: Patch only `scripts/guard-runtime-operational-evidence.test.mjs`:\n  Route: implementation.\n  Source TODO: E-15d-stateful-soak-runner-real.\n  Depends on: E-15d-soak-section-collector.\n  Completion condition: guard evidence is repaired.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.\n- [ ] E-15d-soak-section-guard: Patch only `scripts/guard-runtime-operational-evidence.test.mjs`:\n  Route: implementation.\n  Source TODO: E-15d-stateful-soak-runner-real.\n  Depends on: E-15d-soak-section-collector.\n  Completion condition: guard evidence is repaired.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.\n",
    "candidate": "- [ ] E-15d-soak-section-collector: Patch only `scripts/release-runtime-operational-evidence.mjs`:\n  Route: implementation.\n  Source TODO: E-15d-stateful-soak-runner-real.\n  Depends on: <none>.\n  Completion condition: collector evidence is repaired.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.\n- [ ] E-15d-soak-section-guard: Patch only `scripts/guard-runtime-operational-evidence.test.mjs`:\n  Route: implementation.\n  Source TODO: E-15d-stateful-soak-runner-real.\n  Depends on: E-15d-soak-section-collector.\n  Completion condition: guard evidence is repaired.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.\n",
    "valid": true
  }
];
for (const fixture of migratedQueueRepairCases) {
  test(`external queue repair: ${fixture.name}`, () => {
    const validate = () => validateQueueRepairTransition(fixture.current, fixture.candidate);
    if (fixture.valid) assert.doesNotThrow(validate);
    else assert.throws(validate, /queue repair/);
  });
}

// Original Runtime decomposition cases; old-text trailing whitespace is normalized
// to the explicit selected-block contract, without changing leaf material.
const migratedDecompositionCases = [
  {
    "name": "decompose_todo_requires_parent_source_and_verification:0",
    "selected": "- [ ] TODO-decompose-blocked-queue-abc123: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs.",
    "old_text": "- [ ] TODO-other: Decompose unrelated work.",
    "new_text": "- [ ] E-15b-a: Patch only `scripts/example.mjs`.\n  Route: implementation.\n  Source TODO: TODO-decompose-blocked-queue-abc123.\n  Depends on: <none>.\n  Completion condition: the bounded example patch is implemented and verified.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root check`.\n",
    "valid": false
  },
  {
    "name": "decompose_todo_requires_parent_source_and_verification:1",
    "selected": "- [ ] TODO-decompose-blocked-queue-abc123: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs.",
    "old_text": "- [ ] TODO-decompose-blocked-queue-abc123: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs.",
    "new_text": "- [ ] E-15b-a: Patch one file.\n  Route: implementation.\n  Completion condition: the bounded example patch is implemented and verified.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root check`.\n",
    "valid": false
  },
  {
    "name": "decompose_todo_requires_parent_source_and_verification:2",
    "selected": "- [ ] TODO-decompose-blocked-queue-abc123: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs.",
    "old_text": "- [ ] TODO-decompose-blocked-queue-abc123: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs.",
    "new_text": "- [ ] E-15b-a: Patch only `scripts/example.mjs`.\n  Route: implementation.\n  Source TODO: TODO-other.\n  Depends on: <none>.\n  Completion condition: the bounded example patch is implemented and verified.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root check`.\n",
    "valid": false
  },
  {
    "name": "decompose_todo_requires_parent_source_and_verification:3",
    "selected": "- [ ] TODO-decompose-blocked-queue-abc123: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs.",
    "old_text": "- [ ] TODO-decompose-blocked-queue-abc123: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs.",
    "new_text": "- [ ] E-15b-a: Patch one file.\n  Route: implementation.\n  Source TODO: TODO-decompose-blocked-queue-abc123.\n  Depends on: <none>.\n  Completion condition: the bounded example patch is implemented and verified.\n  Forbidden changes: do not edit unrelated files.\n",
    "valid": false
  },
  {
    "name": "decompose_todo_validates_each_leaf_independently:0",
    "selected": "- [ ] TODO-decompose-blocked-queue-abc123: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs.",
    "old_text": "- [ ] TODO-decompose-blocked-queue-abc123: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs.",
    "new_text": "- [ ] E-15b-a: Patch only `scripts/example-a.mjs`.\n  Route: implementation.\n  Source TODO: TODO-decompose-blocked-queue-abc123.\n  Depends on: <none>.\n  Completion condition: the bounded example patch is implemented and verified.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root check`.\n- [ ] E-15b-b: Patch only `scripts/example-b.mjs`.\n  Route: implementation.\n  Depends on: <none>.\n  Completion condition: the bounded example patch is implemented and verified.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root check`.\n",
    "valid": false
  },
  {
    "name": "decompose_todo_rejects_kept_broad_decomposition_item:0",
    "selected": "- [ ] TODO-decompose-blocked-queue-abc123: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs.",
    "old_text": "- [ ] TODO-decompose-blocked-queue-abc123: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs.",
    "new_text": "- [ ] TODO-decompose-blocked-queue-abc123: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs.\n  Route: todo-decomposition.\n  Source TODO: TODO-decompose-blocked-queue-abc123.\n  Depends on: <none>.\n  Completion condition: the broad item is replaced.\n  Forbidden changes: do not edit implementation files.\n  Verification: run `pnpm --workspace-root check`.\n",
    "valid": false
  },
  {
    "name": "decompose_todo_rejects_unscoped_leaf:0",
    "selected": "- [ ] TODO-decompose-blocked-queue-abc123: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs.",
    "old_text": "- [ ] TODO-decompose-blocked-queue-abc123: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs.",
    "new_text": "- [ ] E-15b-a: Fix the release evidence problems.\n  Route: implementation.\n  Source TODO: TODO-decompose-blocked-queue-abc123.\n  Depends on: <none>.\n  Completion condition: the bounded example patch is implemented and verified.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root check`.\n",
    "valid": false
  },
  {
    "name": "decompose_todo_allows_structured_leaf_todo_patch:0",
    "selected": "- [ ] TODO-decompose-blocked-queue-abc123: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs.",
    "old_text": "- [ ] TODO-decompose-blocked-queue-abc123: Decompose the currently blocked Product Ready TODO queue into implementable leaf TODOs.",
    "new_text": "- [ ] E-15b-a: Patch only `scripts/example.mjs`.\n  Route: implementation.\n  Source TODO: TODO-decompose-blocked-queue-abc123.\n  Depends on: <none>.\n  Completion condition: the bounded example patch is implemented and verified.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root check`.\n",
    "valid": true
  },
  {
    "name": "decompose_todo_with_repair_feedback_allows_new_leaf_ids:0",
    "selected": "- [ ] E-23a-replan: Patch only `.brownie/todo.md` to split a stalled leaf:\n  Route: todo-decomposition.\n  Source TODO: E-23a-target-01.\n  Depends on: <none>.\n  Completion condition: replace the stalled leaf with executable children.\n  Forbidden changes: do not edit implementation files.\n  Verification: run `pnpm --workspace-root guard:todo-decomposition`.",
    "old_text": "- [ ] E-23a-replan: Patch only `.brownie/todo.md` to split a stalled leaf:\n  Route: todo-decomposition.\n  Source TODO: E-23a-target-01.\n  Depends on: <none>.\n  Completion condition: replace the stalled leaf with executable children.\n  Forbidden changes: do not edit implementation files.\n  Verification: run `pnpm --workspace-root guard:todo-decomposition`.",
    "new_text": "- [ ] E-23a-target-01-impl: Patch only `scripts/release-local-artifact.mjs`:\n  Route: implementation.\n  Source TODO: E-23a-replan.\n  Depends on: <none>.\n  Completion condition: the bounded producer change is implemented.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root release:local-artifact:test`.\n- [ ] E-23a-target-01-test: Patch only `scripts/release-local-artifact.test.mjs`:\n  Route: implementation.\n  Source TODO: E-23a-replan.\n  Depends on: E-23a-target-01-impl.\n  Completion condition: the bounded producer behavior is covered.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root release:local-artifact:test`.\n",
    "valid": true
  },
  {
    "name": "decompose_todo_with_repair_feedback_rejects_duplicate_leaf_ids:0",
    "selected": "- [ ] E-23a-replan: Patch only `.brownie/todo.md` to split a stalled leaf:\n  Route: todo-decomposition.\n  Source TODO: E-23a-target-01.\n  Depends on: <none>.\n  Completion condition: replace the stalled leaf with executable children.\n  Forbidden changes: do not edit implementation files.\n  Verification: run `pnpm --workspace-root guard:todo-decomposition`.",
    "old_text": "- [ ] E-23a-replan: Patch only `.brownie/todo.md` to split a stalled leaf:\n  Route: todo-decomposition.\n  Source TODO: E-23a-target-01.\n  Depends on: <none>.\n  Completion condition: replace the stalled leaf with executable children.\n  Forbidden changes: do not edit implementation files.\n  Verification: run `pnpm --workspace-root guard:todo-decomposition`.",
    "new_text": "- [ ] E-23a-target-01-impl: Patch only `scripts/release-local-artifact.mjs`:\n  Route: implementation.\n  Source TODO: E-23a-replan.\n  Depends on: <none>.\n  Completion condition: the bounded producer change is implemented.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root release:local-artifact:test`.\n- [ ] E-23a-target-01-impl: Patch only `scripts/release-local-artifact.mjs`:\n  Route: implementation.\n  Source TODO: E-23a-replan.\n  Depends on: <none>.\n  Completion condition: the bounded producer change is implemented.\n  Forbidden changes: do not edit unrelated files.\n  Verification: run `pnpm --workspace-root release:local-artifact:test`.\n",
    "valid": false
  },
  {
    "name": "implementation_todo_can_patch_todo_md_when_replacing_selected_todo_with_valid_leaf_decomposition:0",
    "selected": "- [ ] E-15d-soak-section-collector: Patch only `scripts/release-runtime-operational-evidence.mjs` to make generated soak evidence satisfied from a bounded stateful fixture:\n  Route: implementation.\n  Source TODO: E-15d-runtime-soak-evidence-stateful.\n  Depends on: <none>.\n  Completion condition: generated runtime operational evidence has a satisfied soak_test section.\n  Forbidden changes: do not edit release-ready status.\n  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.",
    "old_text": "- [ ] E-15d-soak-section-collector: Patch only `scripts/release-runtime-operational-evidence.mjs` to make generated soak evidence satisfied from a bounded stateful fixture:\n  Route: implementation.\n  Source TODO: E-15d-runtime-soak-evidence-stateful.\n  Depends on: <none>.\n  Completion condition: generated runtime operational evidence has a satisfied soak_test section.\n  Forbidden changes: do not edit release-ready status.\n  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.",
    "new_text": "- [ ] E-15d-soak-section-fixture-shape: Patch only `scripts/release-runtime-operational-evidence.mjs` to add the bounded stateful soak fixture shape:\n  Route: implementation.\n  Source TODO: E-15d-soak-section-collector.\n  Depends on: <none>.\n  Completion condition: generated soak evidence contains sanitized stateful step names without raw process output.\n  Forbidden changes: do not edit release-ready status.\n  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.\n",
    "valid": true
  },
  {
    "name": "implementation_todo_decomposition_attempt_must_not_keep_selected_todo_pending:0",
    "selected": "- [ ] E-15d-soak-section-collector: Patch only `scripts/release-runtime-operational-evidence.mjs` to make generated soak evidence satisfied from a bounded stateful fixture:\n  Route: implementation.\n  Source TODO: E-15d-runtime-soak-evidence-stateful.\n  Depends on: <none>.\n  Completion condition: generated runtime operational evidence has a satisfied soak_test section.\n  Forbidden changes: do not edit release-ready status.\n  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.",
    "old_text": "- [ ] E-15d-soak-section-collector: Patch only `scripts/release-runtime-operational-evidence.mjs` to make generated soak evidence satisfied from a bounded stateful fixture:\n  Route: implementation.\n  Source TODO: E-15d-runtime-soak-evidence-stateful.\n  Depends on: <none>.\n  Completion condition: generated runtime operational evidence has a satisfied soak_test section.\n  Forbidden changes: do not edit release-ready status.\n  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.",
    "new_text": "- [ ] E-15d-soak-section-collector: Patch only `scripts/release-runtime-operational-evidence.mjs` to make generated soak evidence satisfied from a bounded stateful fixture:\n  Route: implementation.\n  Source TODO: E-15d-runtime-soak-evidence-stateful.\n  Depends on: <none>.\n  Completion condition: generated runtime operational evidence has a satisfied soak_test section.\n  Forbidden changes: do not edit release-ready status.\n  Verification: run `pnpm --workspace-root guard:runtime-operational-evidence:test`.\n",
    "valid": false
  },
  {
    "name": "concrete_patch_leaf_cannot_be_refined_to_todo_md_by_generic_guard_policy:0",
    "selected": "- [ ] E-15e-release-readiness-audit-sync-leaf: Patch only `docs/architecture/runtime-release-readiness-audit.json`:\n  Route: documentation.\n  Source TODO: E-15e-release-contract-audit-phase-resync.\n  Depends on: E-15e-release-contract-doc-sync-leaf.\n  Completion condition: runtime release readiness audit records the current fail-closed evidence state without claiming Runtime Product Ready.\n  Forbidden changes: do not mark Runtime Product Ready and do not remove owner-controlled independent review blockers.\n  Verification: run `pnpm --workspace-root guard:runtime-release-readiness`.",
    "old_text": "- [ ] E-15e-release-readiness-audit-sync-leaf: Patch only `docs/architecture/runtime-release-readiness-audit.json`:\n  Route: documentation.\n  Source TODO: E-15e-release-contract-audit-phase-resync.\n  Depends on: E-15e-release-contract-doc-sync-leaf.\n  Completion condition: runtime release readiness audit records the current fail-closed evidence state without claiming Runtime Product Ready.\n  Forbidden changes: do not mark Runtime Product Ready and do not remove owner-controlled independent review blockers.\n  Verification: run `pnpm --workspace-root guard:runtime-release-readiness`.",
    "new_text": "- [ ] E-15e-release-readiness-audit-sync-blocker: Read `docs/architecture/runtime-release-readiness-audit.json` to extract current evidence state:\n  Route: documentation.\n  Source TODO: E-15e-release-readiness-audit-sync-leaf.\n  Depends on: E-15e-release-contract-doc-sync-leaf.\n  Completion condition: extract all evidence entries and status fields from the JSON file.\n  Forbidden changes: do not modify the file content.\n  Verification: inspect `docs/architecture/runtime-release-readiness-audit.json` for evidence entries.",
    "valid": false
  }
];
for (const fixture of migratedDecompositionCases) {
  test(`external decomposition: ${fixture.name}`, () => {
    const validate = () => {
      validateDecompositionTransition(fixture.selected, fixture.selected, [{old_text: fixture.old_text, new_text: fixture.new_text}]);
      validateDecompositionLeaves(fixture.new_text);
    };
    if (fixture.valid) assert.doesNotThrow(validate);
    else assert.throws(validate);
  });
}

const migratedQueueBlockCases = [
  {
    "name": "todo_block_detection_ignores_inline_task_marker_examples",
    "text": "## Queue protocol\n\n- Pending work is represented by unchecked Markdown task items: `- [ ] ...`.\n\n## Product Ready Blocking Queue\n\n- [ ] E-16a: Make the runtime operational Golden Journey fixture exercise the full proposal/apply path\n  Route: implementation.\n"
  },
  {
    "name": "todo_block_detection_stops_at_next_heading",
    "text": "- [ ] E-14: Perform final Product Ready judgment.\n  Route: release-judgment.\n\n## Tracked but not Product Ready blocking\n\n- Phase Loop Supervisor as a maintained BDK component.\n"
  }
];
for (const fixture of migratedQueueBlockCases) {
  test(`external queue blocks: ${fixture.name}`, () => {
    const blocks = uncheckedTodoBlocks(fixture.text);
    assert.equal(blocks.length, 1);
    assert.match(blocks[0], /^- \[ \] E-/u);
    assert.match(blocks[0], /Route:/u);
    assert.doesNotMatch(blocks[0], /Pending work is represented|Tracked but not Product Ready|Phase Loop Supervisor/u);
  });
}
