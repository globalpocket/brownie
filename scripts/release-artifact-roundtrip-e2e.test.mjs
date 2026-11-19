import { extractReleaseArchive } from './release-artifact-extract.mjs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const releaseTargets = [
  {
    id: 'linux-x64',
    archiveName: 'brownie-linux-x64.tar.gz',
    archiveType: 'tar',
    binaryName: 'brownie',
    runtimeName: 'brownie-runtime'
  },
  {
    id: 'darwin-arm64',
    archiveName: 'brownie-darwin-arm64.tar.gz',
    archiveType: 'tar',
    binaryName: 'brownie',
    runtimeName: 'brownie-runtime'
  },
  {
    id: 'win32-x64',
    archiveName: 'brownie-win32-x64.zip',
    archiveType: 'zip',
    binaryName: 'brownie.exe',
    runtimeName: 'brownie-runtime.exe'
  }
];

const downloadedArtifactRoot = process.env.BROWNIE_RELEASE_ROUNDTRIP_DOWNLOAD_ROOT ?? '';
const downloadedTargetId = process.env.BROWNIE_RELEASE_ROUNDTRIP_TARGET ?? '';

test('archive extraction rejects zero exit without actual package files and retains diagnostics', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-extract-empty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => extractReleaseArchive(releaseTargets[2], 'fixture.zip', root, {
    platform: 'win32', spawn: () => ({ status: 0, stdout: 'extractor returned', stderr: 'retained diagnostic' })
  }), error => {
    assert.match(error.message, /artifact-evidence\.json/u);
    assert.match(error.message, /retained diagnostic/u);
    assert.match(error.message, /"status":0/u);
    assert.match(error.message, /"entries":\[\]/u);
    return true;
  });
});

test('Windows extraction passes literal archive paths to the native executable and requires every file', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-extract-literal-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = "C:\\a directory\\package's [literal].zip";
  const target = releaseTargets[2];
  extractReleaseArchive(target, archive, root, { platform: 'win32', spawn: (command, args, options) => {
    assert.equal(path.win32.basename(command), 'tar.exe');
    assert.deepEqual(args, ['-xf', archive, '-C', root]);
    assert.equal(options.shell, undefined);
    assert.equal(options.timeout, 60_000);
    for (const name of [target.binaryName, target.runtimeName, 'SHA256SUMS', 'artifact-evidence.json', 'smoke-evidence.json']) {
      fs.writeFileSync(path.join(root, name), 'fixture');
    }
    return { status: 0, stdout: '', stderr: '' };
  } });
});

test('archive extraction preserves existing destination files instead of counting them as new output', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-extract-existing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const evidence = path.join(root, 'artifact-evidence.json');
  fs.writeFileSync(evidence, 'preexisting');
  assert.throws(() => extractReleaseArchive(releaseTargets[2], 'fixture.zip', root, {
    spawn: () => assert.fail('must not run over existing files')
  }), /empty destination/u);
  assert.equal(fs.readFileSync(evidence, 'utf8'), 'preexisting');
});

test('archive extraction rejects process failure even when all package files appeared', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-extract-failed-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = releaseTargets[2];
  assert.throws(() => extractReleaseArchive(target, 'fixture.zip', root, { spawn: () => {
    for (const name of [target.binaryName, target.runtimeName, 'SHA256SUMS', 'artifact-evidence.json', 'smoke-evidence.json']) {
      fs.writeFileSync(path.join(root, name), 'partial command output');
    }
    return { status: 7, stdout: '', stderr: 'actual extractor failure' };
  } }), /actual extractor failure/u);
});

function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed with ${String(result.status)}\n${result.stderr || result.stdout}`
  );
  return result;
}

function writeExecutable(filePath, source) {
  fs.writeFileSync(filePath, source);
  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o755);
  }
}

function createFixturePackage(target, packageRoot) {
  const runtimePath = path.join(packageRoot, target.runtimeName);
  const binaryPath = path.join(packageRoot, target.binaryName);
  writeExecutable(runtimePath, [
    '#!/usr/bin/env node',
    `process.stdout.write('runtime-ready:${target.id}\\n');`
  ].join('\n') + '\n');
  writeExecutable(binaryPath, [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const { spawnSync } = require('node:child_process');",
    `const runtime = path.join(path.dirname(process.argv[1]), ${JSON.stringify(target.runtimeName)});`,
    "if (!fs.existsSync(runtime)) process.exit(41);",
    "const result = spawnSync(process.execPath, [runtime], { encoding: 'utf8' });",
    "if (result.status !== 0) process.exit(result.status ?? 42);",
    `process.stdout.write('cli-ready:${target.id}:' + result.stdout.trim() + '\\n');`
  ].join('\n') + '\n');

  const artifactEvidence = {
    schema_version: 1,
    evidence_id: 'brownie-release-artifact-roundtrip-fixture-v1',
    target: target.id,
    artifact: {
      path: target.binaryName,
      sha256: sha256File(binaryPath),
      bytes: fs.statSync(binaryPath).size,
      target: target.id
    },
    runtime_companion: {
      path: target.runtimeName,
      sha256: sha256File(runtimePath),
      bytes: fs.statSync(runtimePath).size
    }
  };
  fs.writeFileSync(
    path.join(packageRoot, 'artifact-evidence.json'),
    `${JSON.stringify(artifactEvidence, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(packageRoot, 'smoke-evidence.json'),
    `${JSON.stringify({ target: target.id, status: 'satisfied' }, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(packageRoot, 'SHA256SUMS'),
    [
      `${artifactEvidence.artifact.sha256.slice('sha256:'.length)}  ${target.binaryName}`,
      `${artifactEvidence.runtime_companion.sha256.slice('sha256:'.length)}  ${target.runtimeName}`
    ].join('\n') + '\n'
  );
  return artifactEvidence;
}

function createArchive(target, packageRoot, archivePath) {
  if (target.archiveType === 'tar') {
    run('tar', ['-czf', archivePath, '-C', packageRoot, target.binaryName, target.runtimeName, 'SHA256SUMS', 'artifact-evidence.json', 'smoke-evidence.json']);
    return sha256File(archivePath);
  }

  if (process.platform === 'win32') {
    const literalFiles = [target.binaryName, target.runtimeName, 'SHA256SUMS', 'artifact-evidence.json', 'smoke-evidence.json']
      .map((name) => `'${path.join(packageRoot, name).replaceAll("'", "''")}'`)
      .join(', ');
    run('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -LiteralPath ${literalFiles} -DestinationPath '${archivePath.replaceAll("'", "''")}' -Force`
    ]);
    return sha256File(archivePath);
  }

  run('zip', ['-q', archivePath, target.binaryName, target.runtimeName, 'SHA256SUMS', 'artifact-evidence.json', 'smoke-evidence.json'], { cwd: packageRoot });
  return sha256File(archivePath);
}

const extractArchive = extractReleaseArchive;

function copyTree(sourceRoot, destinationRoot) {
  fs.cpSync(sourceRoot, destinationRoot, { recursive: true });
}

function findFile(root, fileName) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name === fileName) return fullPath;
    if (entry.isDirectory()) {
      const found = findFile(fullPath, fileName);
      if (found) return found;
    }
  }
  return null;
}

function parseChecksums(filePath) {
  return Object.fromEntries(
    fs.readFileSync(filePath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => {
        const match = line.match(/^([a-f0-9]{64})  (.+)$/u);
        assert.ok(match, `invalid SHA256SUMS line: ${line}`);
        return [match[2], `sha256:${match[1]}`];
      })
  );
}

function assertDownloadedPackageRoundTrips(target, uploadRoot, expectedArchiveSha256) {
  const downloadRoot = fs.mkdtempSync(path.join(os.tmpdir(), `brownie-release-download-${target.id}-`));
  const downloadedArtifactRoot = path.join(downloadRoot, '.brownie', 'release-evidence', 'artifacts', target.id);
  fs.mkdirSync(downloadedArtifactRoot, { recursive: true });
  copyTree(uploadRoot, downloadedArtifactRoot);

  const downloadedArchive = path.join(downloadedArtifactRoot, target.archiveName);
  assert.ok(fs.existsSync(downloadedArchive), `${target.id} archive was not downloaded`);
  assert.equal(sha256File(downloadedArchive), expectedArchiveSha256, `${target.id} package SHA changed during download`);
  const extractionRoot = fs.mkdtempSync(path.join(os.tmpdir(), `brownie-release-extract-${target.id}-`));
  extractArchive(target, downloadedArchive, extractionRoot);

  const evidence = JSON.parse(fs.readFileSync(path.join(extractionRoot, 'artifact-evidence.json'), 'utf8'));
  const checksums = parseChecksums(path.join(extractionRoot, 'SHA256SUMS'));
  for (const [field, name] of [['artifact', target.binaryName], ['runtime_companion', target.runtimeName]]) {
    const filePath = path.join(extractionRoot, name);
    assert.ok(fs.existsSync(filePath), `${target.id} package is missing ${name}`);
    assert.equal(evidence[field].path, name);
    assert.equal(evidence[field].sha256, sha256File(filePath));
    assert.equal(checksums[name], sha256File(filePath));
  }
  assert.equal(evidence.target, target.id);

  const packagedCli = path.join(extractionRoot, target.binaryName);
  const launch = spawnSync(process.execPath, [packagedCli], {
    cwd: extractionRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  assert.equal(launch.status, 0, `${target.id} packaged CLI failed to start\n${launch.stderr || launch.stdout}`);
  assert.match(launch.stdout, new RegExp(`^cli-ready:${target.id}:runtime-ready:${target.id}$`, 'mu'));
}

function assertCiDownloadedPackageRoundTrips(target) {
  assert.equal(downloadedTargetId, target.id);
  const archivePath = findFile(downloadedArtifactRoot, target.archiveName);
  assert.ok(archivePath, `${target.id} archive was not downloaded by actions/download-artifact`);
  assert.match(sha256File(archivePath), /^sha256:[a-f0-9]{64}$/u);
  const extractionRoot = fs.mkdtempSync(path.join(os.tmpdir(), `brownie-ci-release-extract-${target.id}-`));
  extractArchive(target, archivePath, extractionRoot);

  const evidence = JSON.parse(fs.readFileSync(path.join(extractionRoot, 'artifact-evidence.json'), 'utf8'));
  const checksums = parseChecksums(path.join(extractionRoot, 'SHA256SUMS'));
  for (const [field, name] of [['artifact', target.binaryName], ['runtime_companion', target.runtimeName]]) {
    const filePath = path.join(extractionRoot, name);
    assert.ok(fs.existsSync(filePath), `${target.id} extracted package is missing ${name}`);
    assert.equal(evidence[field].path, name);
    assert.equal(evidence[field].sha256, sha256File(filePath));
    assert.equal(checksums[name], sha256File(filePath));
  }
  assert.equal(evidence.target, target.id);
  const expectedPlatform = process.platform === 'win32' ? 'win32' : process.platform;
  const expectedArch = process.arch === 'x64' ? 'x64' : process.arch;
  assert.equal(target.id, `${expectedPlatform}-${expectedArch}`, 'CI matrix target does not match runner platform');

  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), `brownie-ci-release-workspace-${target.id}-`));
  const packagedCli = path.join(extractionRoot, target.binaryName);
  if (process.platform !== 'win32') {
    fs.accessSync(packagedCli, fs.constants.X_OK);
  }
  const environment = { ...process.env, BROWNIE_WORKSPACE_ROOT: workspaceRoot };
  delete environment.BROWNIE_RUNTIME_PATH;
  const launch = spawnSync(packagedCli, ['--json', 'status'], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    timeout: 60_000,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  assert.equal(launch.status, 0, `${target.id} downloaded packaged CLI failed to start its Runtime companion\n${launch.stderr || launch.stdout}`);
  assert.doesNotThrow(() => JSON.parse(launch.stdout), `${target.id} packaged CLI did not return JSON status`);
}

test('release workflow uploads every target artifact directory required for roundtrip verification', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /uses: actions\/upload-artifact@v4/u);
  assert.match(workflow, /uses: actions\/download-artifact@v4/u);
  assert.match(workflow, /needs: build-and-evidence/u);
  assert.match(workflow, /BROWNIE_RELEASE_ROUNDTRIP_DOWNLOAD_ROOT/u);
  assert.match(workflow, /\.brownie\/release-evidence\/artifacts\/\$\{\{ matrix\.target \}\}\//u);
  for (const target of releaseTargets) {
    assert.match(workflow, new RegExp(`target: ${target.id}\\n\\s+archive_name: ${target.archiveName}`, 'u'));
  }
});

if (process.env.CI === 'true') {
  test('CI roundtrip consumes the artifact downloaded by the release workflow', () => {
    assert.ok(downloadedArtifactRoot, 'CI download root is required for the release roundtrip job');
    assert.ok(downloadedTargetId, 'CI target is required for the release roundtrip job');
    const target = releaseTargets.find((candidate) => candidate.id === downloadedTargetId);
    assert.ok(target, `unsupported CI target: ${downloadedTargetId}`);
    assertCiDownloadedPackageRoundTrips(target);
  });
}

test('downloaded release packages preserve SHA bindings and start with their Runtime companion', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-release-upload-fixtures-'));
  for (const target of releaseTargets) {
    const packageRoot = path.join(fixtureRoot, target.id);
    fs.mkdirSync(packageRoot, { recursive: true });
    createFixturePackage(target, packageRoot);
    const packageSha256 = createArchive(target, packageRoot, path.join(packageRoot, target.archiveName));
    assertDownloadedPackageRoundTrips(target, packageRoot, packageSha256);
  }
});
