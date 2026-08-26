import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { planInstall, runInstall } from './install-brownie-cli.mjs';

function tempPrefix(name) {
  return mkdtempSync(path.join(tmpdir(), `brownie-cli-install-${name}-`));
}

test('dry run reports bounded install plan without mutating selected prefix', () => {
  const prefix = tempPrefix('dry-run');
  try {
    const result = runInstall(['--prefix', prefix, '--profile', 'debug', '--dry-run']);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.dry_run, true);
    assert.equal(payload.profile, 'debug');
    assert.equal(payload.prefix, prefix);
    assert.equal(payload.bin_dir, path.join(prefix, 'bin'));
    assert.equal(payload.destination, path.join(prefix, 'bin', process.platform === 'win32' ? 'brownie.exe' : 'brownie'));
    assert.equal(payload.runtime_destination, path.join(prefix, 'bin', process.platform === 'win32' ? 'brownie-runtime.exe' : 'brownie-runtime'));
    assert.equal(fs.existsSync(path.join(prefix, 'bin')), false);
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test('rejects malformed and system prefixes before install mutation', () => {
  assert.throws(
    () => planInstall({ prefix: 'relative-prefix', profile: 'debug' }),
    /absolute path/
  );
  assert.throws(
    () => planInstall({ prefix: path.parse(process.cwd()).root, profile: 'debug' }),
    /non-root path/
  );
  if (process.platform !== 'win32') {
    assert.throws(
      () => planInstall({ prefix: '/usr/local', profile: 'debug' }),
      /system prefix/
    );
  }
});

test('temporary prefix install copies the brownie binary and preserves version usability', () => {
  const prefix = tempPrefix('install');
  let repo = null;
  try {
    execFileSync('cargo', ['build', '-p', 'brownie-cli', '--bin', 'brownie', '-p', 'brownie-runtime', '--bin', 'brownie-runtime'], {
      cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'),
      stdio: 'inherit'
    });

    const result = runInstall(['--prefix', prefix, '--profile', 'debug', '--skip-build']);
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.dry_run, false);
    const installed = path.join(prefix, 'bin', process.platform === 'win32' ? 'brownie.exe' : 'brownie');
    const installedRuntime = path.join(prefix, 'bin', process.platform === 'win32' ? 'brownie-runtime.exe' : 'brownie-runtime');
    assert.equal(fs.existsSync(installed), true);
    assert.equal(fs.existsSync(installedRuntime), true);

    const version = execFileSync(installed, ['--version'], { encoding: 'utf8' });
    assert.match(version, /^brownie /);

    repo = tempPrefix('ordinary-repo');
    execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
    fs.writeFileSync(path.join(repo, 'README.md'), '# Ordinary repository\n');
    const status = execFileSync(installed, ['status'], { cwd: repo, encoding: 'utf8' });
    assert.match(status, /^brownie-runtime /);
  } finally {
    rmSync(prefix, { recursive: true, force: true });
    if (repo) {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});
