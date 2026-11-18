import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptsDirectory, '..');
const claimSmokeFixture = path.join(scriptsDirectory, 'phase-loop-claim-smoke.test.sh');
const todoStateEntry = path.join(scriptsDirectory, 'phase-loop-todo-state.mjs');
const todoGuardEntry = path.join(scriptsDirectory, 'guard-todo-decomposition.mjs');

function localDependencyClosure(entry, visited = new Set()) {
  const absoluteEntry = path.resolve(entry);
  if (visited.has(absoluteEntry)) return visited;
  visited.add(absoluteEntry);
  const source = fs.readFileSync(absoluteEntry, 'utf8');
  for (const match of source.matchAll(/from\s+['"]\.\/([^'"]+)['"]/gu)) {
    const dependency = path.resolve(path.dirname(absoluteEntry), match[1]);
    assert.equal(
      dependency.startsWith(`${scriptsDirectory}${path.sep}`),
      true,
      `fixture dependency must remain below scripts/: ${dependency}`
    );
    assert.equal(fs.existsSync(dependency), true, `missing local dependency: ${dependency}`);
    localDependencyClosure(dependency, visited);
  }
  return visited;
}

function assertFixtureCopiesDependencyClosure(source, entry, entryName) {
  const dependencyNames = [...localDependencyClosure(entry)]
    .filter((file) => file !== entry)
    .map((file) => path.relative(scriptsDirectory, file))
    .sort();
  assert.notEqual(dependencyNames.length, 0, `the ${entryName} dependency closure must not be silently empty`);

  const entryPattern = entryName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const fixtureCopies = [...source.matchAll(new RegExp(
    `cp "\\$REPO_ROOT/scripts/${entryPattern}" "(\\$[A-Za-z_][A-Za-z0-9_]*\\/scripts)\\/${entryPattern}"`,
    'gu'
  ))];
  assert.notEqual(fixtureCopies.length, 0, `expected at least one isolated ${entryName} fixture`);

  for (const [, fixtureScripts] of fixtureCopies) {
    for (const dependency of dependencyNames) {
      const expectedCopy = `cp "$REPO_ROOT/scripts/${dependency}" "${fixtureScripts}/${dependency}"`;
      assert.equal(
        source.includes(expectedCopy),
        true,
        `isolated fixture ${fixtureScripts} must copy ${entryName} dependency ${dependency}`
      );
    }
  }
}

test('claim-smoke isolated TODO fixtures copy every static dependency closure', () => {
  const source = fs.readFileSync(claimSmokeFixture, 'utf8');
  assertFixtureCopiesDependencyClosure(source, todoStateEntry, 'phase-loop-todo-state.mjs');
  assertFixtureCopiesDependencyClosure(source, todoGuardEntry, 'guard-todo-decomposition.mjs');
});

test('claim-smoke isolates both controller and Runtime state from the checked-out repository', () => {
  const source = fs.readFileSync(claimSmokeFixture, 'utf8');
  assert.match(source, /export PHASE_LOOP_BROWNIE_STORE_ROOT="\$CLAIM_SMOKE_BROWNIE_STORE_ROOT"/);
  assert.match(source, /export BROWNIE_STORE_ROOT="\$CLAIM_SMOKE_BROWNIE_STORE_ROOT"/);
  assert.match(source, /CLAIM_SMOKE_REPO_RUNTIME_STORE_SHA256/);
  assert.match(source, /claim_smoke_repository_runtime_store_sha256/);
});

test('CI check executes both isolated terminal liveness shards for the merged-delivery recovery path', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
  assert.equal(
    manifest.scripts['phase-loop:claim-smoke:terminal'],
    'node --test scripts/phase-loop-claim-smoke-fixture-dependencies.test.mjs && PHASE_LOOP_CLAIM_SMOKE_SECTION=terminal PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE=1 bash scripts/phase-loop-claim-smoke.test.sh && PHASE_LOOP_CLAIM_SMOKE_SECTION=merged-terminal PHASE_LOOP_CLAIM_SMOKE_BATCH_SIZE=1 bash scripts/phase-loop-claim-smoke.test.sh'
  );
  assert.match(fs.readFileSync(claimSmokeFixture, 'utf8'), /claim_smoke_shards=\(terminal merged-terminal/);
  assert.match(manifest.scripts.check, /pnpm phase-loop:claim-smoke:terminal/);
});

function executeNoEligibleRefusalSequence(firstResult) {
  const source = fs.readFileSync(claimSmokeFixture, 'utf8');
  const anchor = source.indexOf('no_eligible_split_todo_before=');
  const start = source.indexOf('set +e\n', anchor);
  const endMarker = 'test "$no_eligible_split_exit" = "76"';
  const end = source.indexOf(endMarker, start);
  assert.ok(anchor >= 0 && start > anchor && end > start, 'actual refusal sequence must exist');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-refusal-contract-'));
  try {
    const log = path.join(directory, 'invocations');
    const harness = `first_result="$1"
contract_log="$2"
call_count=0
PHASE_LOOP=fixture-controller
PHASE_LOOP_COMMAND_TIMEOUT_SECONDS=5
run_with_timeout() {
  call_count=$((call_count + 1))
  printf '%s\\n' "$*" >> "$contract_log"
  if [ "$call_count" = 1 ]; then return "$first_result"; fi
  return 76
}
` + source.slice(start, end + endMarker.length) + '\n';
    const result = spawnSync('bash', ['-c', harness, 'fixture', String(firstResult), log], {
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.error, undefined);
    return { status: result.status, calls: fs.readFileSync(log, 'utf8').trim().split('\n') };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('no-eligible refusal retry records both expected semantic refusals', () => {
  const result = executeNoEligibleRefusalSequence(76);
  assert.equal(result.status, 0);
  assert.equal(result.calls.length, 2);
  for (const call of result.calls) assert.match(call, /--expected-exit 76/);
});
for (const [name, code] of [['timeout', 124], ['unexpected success', 0], ['unexpected failure', 1]]) {
  test(`no-eligible refusal retry stops at first ${name}`, () => {
    const result = executeNoEligibleRefusalSequence(code);
    assert.notEqual(result.status, 0, 'a later refusal must not hide the first wrong result');
    assert.equal(result.calls.length, 1, 'do not continue after the first wrong result');
  });
}

// Exercise the actual negative assertions and fallback extracted from the shell fixture.
for (const engine of ['native', 'fallback']) {
  for (const entry of ['helper', 'inline']) {
    for (const scenario of ['present_file', 'absent_file', 'present_directory', 'absent_directory', 'missing_path']) {
      test(`negative search ${engine} ${entry} ${scenario}`, () => {
        const source = fs.readFileSync(claimSmokeFixture, 'utf8');
        const fallback = source.match(/cat > "\$fallback_bin_dir\/rg" <<'SH'\n([\s\S]*?)\nSH/);
        assert.ok(fallback, 'actual rg fallback must exist');
        const functions = [...source.matchAll(/^assert_(?:not_contains|no_matches)\(\) \{\n[\s\S]*?^\}/gm)].map(match => match[0]).join('\n');
        assert.ok(functions.includes('assert_not_contains()'));
        const inline = source.split('\n').find(line => line.includes('"$merged_terminal_state" "$merged_terminal_todo" "$merged_terminal_breakdown"') && /! rg|assert_no_matches/.test(line));
        assert.ok(inline, 'actual merged-terminal negative assertion must exist');
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-negative-search-'));
        try {
          const bin = path.join(directory, 'bin');
          fs.mkdirSync(bin);
          if (engine === 'fallback') {
            fs.writeFileSync(path.join(bin, 'rg'), fallback[1] + '\n', { mode: 0o700 });
          } else {
            const native = spawnSync('bash', ['-c', 'command -v rg'], { encoding: 'utf8' });
            assert.equal(native.status, 0, 'native control requires rg; absence is not a pass');
            fs.symlinkSync(native.stdout.trim(), path.join(bin, 'rg'));
          }
          const target = path.join(directory, 'target');
          const empty = path.join(directory, 'empty');
          fs.writeFileSync(empty, '');
          const content = scenario.startsWith('present') ? 'todo.completed\n' : 'ordinary content\n';
          if (scenario.endsWith('directory')) {
            fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'events'), content);
          } else if (scenario !== 'missing_path') fs.writeFileSync(target, content);
          const invocation = entry === 'helper'
            ? 'assert_not_contains "$1" "TODO-decompose|todo.completed"'
            : 'merged_terminal_state="$1"; merged_terminal_todo="$2"; merged_terminal_breakdown="$2"\n' + inline;
          const result = spawnSync('bash', ['-c', 'set -eu\n' + functions + '\n' + invocation, 'fixture', target, empty], {
            encoding: 'utf8', timeout: 5000, env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH },
          });
          assert.equal(result.error, undefined);
          assert.equal(result.signal, null);
          const expectedStatus = scenario === 'missing_path' ? 2 : scenario.startsWith('absent') ? 0 : 1;
          assert.equal(result.status, expectedStatus, result.stderr);
          if (scenario === 'missing_path') assert.match(result.stderr, /absence assertion failed: search error 2/);
        } finally { fs.rmSync(directory, { recursive: true, force: true }); }
      });
    }
  }
}

test('fallback searches piped input when no path is supplied', () => {
  const source = fs.readFileSync(claimSmokeFixture, 'utf8');
  const fallback = source.match(/cat > "\$fallback_bin_dir\/rg" <<'SH'\n([\s\S]*?)\nSH/);
  assert.ok(fallback);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-piped-search-'));
  try {
    fs.writeFileSync(path.join(directory, 'decoy'), 'disk-token\n');
    for (const [pattern, expected] of [['stream-token', 0], ['disk-token', 1]]) {
      const result = spawnSync('bash', ['-c', fallback[1], 'rg', '-q', pattern], {
        cwd: directory, input: 'stream-token\n', encoding: 'utf8', timeout: 5000,
      });
      assert.equal(result.status, expected, result.stderr);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
