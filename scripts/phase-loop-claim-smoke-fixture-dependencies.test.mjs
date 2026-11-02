import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
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
