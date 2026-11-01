import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const claimSmokeFixture = path.join(scriptsDirectory, 'phase-loop-claim-smoke.test.sh');
const todoStateEntry = path.join(scriptsDirectory, 'phase-loop-todo-state.mjs');

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

test('claim-smoke isolated TODO-state fixtures copy their local dependency closure', () => {
  const source = fs.readFileSync(claimSmokeFixture, 'utf8');
  const dependencyNames = [...localDependencyClosure(todoStateEntry)]
    .filter((file) => file !== todoStateEntry)
    .map((file) => path.relative(scriptsDirectory, file))
    .sort();
  assert.notEqual(dependencyNames.length, 0, 'the TODO-state dependency closure must not be silently empty');

  const fixtureCopies = [...source.matchAll(
    /cp "\$REPO_ROOT\/scripts\/phase-loop-todo-state\.mjs" "(\$[A-Za-z_][A-Za-z0-9_]*\/scripts)\/phase-loop-todo-state\.mjs"/gu
  )];
  assert.notEqual(fixtureCopies.length, 0, 'expected at least one isolated TODO-state fixture');

  for (const [, fixtureScripts] of fixtureCopies) {
    for (const dependency of dependencyNames) {
      const expectedCopy = `cp "$REPO_ROOT/scripts/${dependency}" "${fixtureScripts}/${dependency}"`;
      assert.equal(
        source.includes(expectedCopy),
        true,
        `isolated fixture ${fixtureScripts} must copy TODO-state dependency ${dependency}`
      );
    }
  }
});
