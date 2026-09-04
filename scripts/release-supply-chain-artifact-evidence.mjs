import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultOutPath = '.brownie/release-evidence/supply-chain-artifact-evidence.json';

const requiredSections = [
  'lockfile_fixed',
  'dependency_security_license_scan',
  'secret_scan',
  'sbom',
  'artifacts',
  'artifact_smoke',
  'checksums',
  'signature_or_integrity_proof',
  'provenance'
];

const secretPatterns = [
  {
    id: 'github_token',
    regex: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/g
  },
  {
    id: 'aws_access_key_id',
    regex: /\bAKIA[0-9A-Z]{16}\b/g
  },
  {
    id: 'private_key_block',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]{32,}?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g
  },
  {
    id: 'slack_token',
    regex: /\bxox[baprs]-[A-Za-z0-9-]{24,}\b/g
  }
];

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function parseArgs(argv) {
  const options = {
    repoRoot: defaultRepoRoot,
    outPath: defaultOutPath
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--repo-root') {
      options.repoRoot = path.resolve(argv[++index] ?? '');
    } else if (arg === '--out') {
      options.outPath = argv[++index] ?? '';
    } else {
      throw new Error(`Unknown supply-chain evidence argument: ${arg}`);
    }
  }
  if (!options.outPath) {
    throw new Error('--out must not be empty');
  }
  return options;
}

function repoPath(repoRoot, relativePath) {
  return path.join(repoRoot, relativePath);
}

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join('/').replace(/^\.\//, '');
}

function resolveRepoRelative(repoRoot, relativePath) {
  const resolved = path.resolve(repoRoot, relativePath);
  const relative = path.relative(repoRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes repository root: ${relativePath}`);
  }
  return resolved;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return `sha256:${hash.digest('hex')}`;
}

function sha256Text(text) {
  return `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`;
}

function run(repoRoot, command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CARGO_TERM_COLOR: 'never' }
  });
  return {
    command: [command, ...args].join(' '),
    exit_code: result.status,
    passed: result.status === 0
  };
}

function gitValue(repoRoot, args) {
  const result = run(repoRoot, 'git', args);
  if (!result.passed) {
    return null;
  }
  return spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).stdout.trim();
}

function trackedFiles(repoRoot) {
  const result = spawnSync('git', ['ls-files'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  if (result.status !== 0) {
    return [];
  }
  return result.stdout
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readIfExists(repoRoot, relativePath) {
  const fullPath = repoPath(repoRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  return fs.readFileSync(fullPath, 'utf8');
}

function parseCargoLockComponents(text) {
  const components = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (line.trim() === '[[package]]') {
      if (current?.name && current?.version) {
        components.push(current);
      }
      current = { ecosystem: 'cargo' };
    } else if (current) {
      const match = line.match(/^([a-z_]+)\s*=\s*"([^"]*)"/);
      if (match && ['name', 'version', 'source'].includes(match[1])) {
        current[match[1]] = match[2];
      }
    }
  }
  if (current?.name && current?.version) {
    components.push(current);
  }
  return components;
}

function parsePnpmLockComponents(text) {
  const components = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^\s{2}\/([^@\s][^@\s/]*|@[^/\s]+\/[^@\s]+)@([^:\s]+):\s*$/);
    if (match) {
      components.push({
        ecosystem: 'pnpm',
        name: match[1],
        version: match[2]
      });
    }
  }
  return components;
}

function buildSbom(repoRoot, generatedAt) {
  const cargoLock = readIfExists(repoRoot, 'Cargo.lock');
  const pnpmLock = readIfExists(repoRoot, 'pnpm-lock.yaml');
  const components = [
    ...(cargoLock ? parseCargoLockComponents(cargoLock) : []),
    ...(pnpmLock ? parsePnpmLockComponents(pnpmLock) : [])
  ];
  return {
    bomFormat: 'BrownieReleaseEvidence',
    specVersion: '1.0',
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    metadata: {
      generated_at: generatedAt,
      component: {
        type: 'application',
        name: 'brownie-runtime',
        repository: 'globalpocket/brownie'
      }
    },
    components
  };
}

function findReleaseArtifacts(repoRoot) {
  const candidates = [
    'target/release/brownie',
    'target/release/brownie.exe',
    'target/release/brownie-runtime',
    'target/release/brownie-runtime.exe'
  ];
  for (const entry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
    if (entry.isFile() && /\.(?:vsix|tgz|zip|tar\.gz)$/.test(entry.name)) {
      candidates.push(entry.name);
    }
  }
  return candidates
    .filter((relativePath) => fs.existsSync(repoPath(repoRoot, relativePath)))
    .map((relativePath) => ({
      path: normalizeRelativePath(relativePath),
      sha256: sha256File(repoPath(repoRoot, relativePath)),
      bytes: fs.statSync(repoPath(repoRoot, relativePath)).size
    }));
}

function scanSecrets(repoRoot, files) {
  const findings = [];
  const eligible = files.filter((relativePath) => {
    if (relativePath.startsWith('target/') || relativePath.startsWith('node_modules/')) {
      return false;
    }
    if (/\.(?:png|jpg|jpeg|gif|webp|pdf|pptx|vsix|zip|gz|lock)$/i.test(relativePath)) {
      return false;
    }
    return true;
  });

  for (const relativePath of eligible) {
    const fullPath = repoPath(repoRoot, relativePath);
    let text;
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile() || stat.size > 512 * 1024) {
        continue;
      }
      text = fs.readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }
    for (const pattern of secretPatterns) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(text)) {
        findings.push({
          path: normalizeRelativePath(relativePath),
          pattern_id: pattern.id
        });
      }
    }
  }
  return findings;
}

function statusFromRequiredTools(toolResults) {
  if (toolResults.some((entry) => entry.available === true && entry.passed === false)) {
    return 'failed';
  }
  if (toolResults.every((entry) => entry.available === true && entry.passed === true)) {
    return 'satisfied';
  }
  return 'partial_tooling_missing';
}

function commandAvailable(command) {
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  return result.status === 0;
}

function buildDependencyEvidence(repoRoot) {
  const cargoMetadata = run(repoRoot, 'cargo', ['metadata', '--locked', '--format-version', '1', '--no-deps']);
  const cargoAuditAvailable = commandAvailable('cargo-audit') || run(repoRoot, 'cargo', ['audit', '--version']).passed;
  const cargoDenyAvailable = commandAvailable('cargo-deny') || run(repoRoot, 'cargo', ['deny', '--version']).passed;
  const pnpmAvailable = commandAvailable('pnpm');
  const cargoAudit = cargoAuditAvailable ? run(repoRoot, 'cargo', ['audit', '--locked']) : null;
  const cargoDeny = cargoDenyAvailable ? run(repoRoot, 'cargo', ['deny', 'check']) : null;
  const pnpmAudit = pnpmAvailable ? run(repoRoot, 'pnpm', ['audit', '--prod', '--audit-level', 'moderate', '--json']) : null;

  const tools = [
    {
      id: 'cargo_metadata_locked',
      available: true,
      passed: cargoMetadata.passed,
      command: cargoMetadata.command
    },
    {
      id: 'cargo_audit',
      available: cargoAuditAvailable,
      passed: cargoAudit?.passed ?? false,
      command: 'cargo audit --locked'
    },
    {
      id: 'cargo_deny',
      available: cargoDenyAvailable,
      passed: cargoDeny?.passed ?? false,
      command: 'cargo deny check'
    },
    {
      id: 'pnpm_audit',
      available: pnpmAvailable,
      passed: pnpmAudit?.passed ?? false,
      command: 'pnpm audit --prod --audit-level moderate'
    }
  ];

  return {
    status: statusFromRequiredTools(tools),
    release_blocking: true,
    tools,
    note: 'RRP-8.4 records fail-closed dependency/security/license evidence slots; missing cargo audit, cargo deny, or pnpm audit execution remains release-blocking.'
  };
}

function writeJson(repoRoot, relativePath, value) {
  const fullPath = resolveRepoRelative(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(repoRoot, relativePath, value) {
  const fullPath = resolveRepoRelative(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, value);
}

export function buildSupplyChainArtifactEvidence(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const outPath = normalizeRelativePath(options.outPath ?? defaultOutPath);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const outDir = normalizeRelativePath(path.dirname(outPath));
  const files = trackedFiles(repoRoot);
  const lockfiles = ['Cargo.lock', 'pnpm-lock.yaml']
    .filter((relativePath) => fs.existsSync(repoPath(repoRoot, relativePath)))
    .map((relativePath) => ({
      path: relativePath,
      sha256: sha256File(repoPath(repoRoot, relativePath))
    }));
  const secretFindings = scanSecrets(repoRoot, files);
  const sbom = buildSbom(repoRoot, generatedAt);
  const sbomPath = normalizeRelativePath(path.join(outDir, 'brownie-runtime-sbom.json'));
  writeJson(repoRoot, sbomPath, sbom);

  const artifacts = findReleaseArtifacts(repoRoot);
  const provenancePath = normalizeRelativePath(path.join(outDir, 'brownie-runtime-provenance.json'));
  const sourceCommit = gitValue(repoRoot, ['rev-parse', 'HEAD']);
  const treeStatus = gitValue(repoRoot, ['status', '--porcelain']);
  const dependencyEvidence = buildDependencyEvidence(repoRoot);
  const provenance = {
    schema_version: 1,
    provenance_id: 'brownie-runtime-local-provenance-v1',
    source_commit: sourceCommit,
    source_tree_dirty: Boolean(treeStatus),
    workflow_run_id: process.env.GITHUB_RUN_ID ?? null,
    generated_at: generatedAt,
    sbom_path: sbomPath,
    artifact_paths: artifacts.map((artifact) => artifact.path),
    release_ready: false,
    note: 'Local provenance evidence is not a signature and does not replace owner-controlled release signing or GitHub workflow provenance.'
  };
  writeJson(repoRoot, provenancePath, provenance);

  const checksumEntries = [
    {
      path: sbomPath,
      sha256: sha256File(repoPath(repoRoot, sbomPath))
    },
    {
      path: provenancePath,
      sha256: sha256File(repoPath(repoRoot, provenancePath))
    },
    ...artifacts
  ];
  const checksumPath = normalizeRelativePath(path.join(outDir, 'SHA256SUMS'));
  writeText(
    repoRoot,
    checksumPath,
    checksumEntries
      .map((entry) => `${entry.sha256.replace(/^sha256:/, '')}  ${entry.path}`)
      .sort()
      .join('\n') + '\n'
  );

  const sections = {
    lockfile_fixed: {
      status: lockfiles.length === 2 ? 'satisfied' : 'missing_lockfile',
      release_blocking: true,
      lockfiles
    },
    dependency_security_license_scan: dependencyEvidence,
    secret_scan: {
      status: secretFindings.length === 0 ? 'satisfied' : 'failed',
      release_blocking: true,
      scanner: 'brownie-high-confidence-secret-patterns-v1',
      scanned_tracked_file_count: files.length,
      findings_count: secretFindings.length,
      findings: secretFindings
    },
    sbom: {
      status: 'satisfied',
      release_blocking: true,
      path: sbomPath,
      sha256: sha256File(repoPath(repoRoot, sbomPath)),
      component_count: sbom.components.length
    },
    artifacts: {
      status: artifacts.length > 0 ? 'satisfied' : 'not_generated',
      release_blocking: true,
      artifacts
    },
    artifact_smoke: {
      status: artifacts.length > 0 ? 'not_executed' : 'not_executed_missing_artifacts',
      release_blocking: true,
      smoke_targets: artifacts.map((artifact) => artifact.path)
    },
    checksums: {
      status: artifacts.length > 0 ? 'satisfied' : 'partial_no_release_artifacts',
      release_blocking: true,
      path: checksumPath,
      sha256: sha256File(repoPath(repoRoot, checksumPath)),
      entries: checksumEntries.map((entry) => ({
        path: entry.path,
        sha256: entry.sha256
      }))
    },
    signature_or_integrity_proof: {
      status: 'blocked_external',
      release_blocking: true,
      path: null,
      owner_action: 'Configure signing authority or approve a formal integrity mechanism before public release.'
    },
    provenance: {
      status: 'satisfied',
      release_blocking: true,
      path: provenancePath,
      sha256: sha256File(repoPath(repoRoot, provenancePath))
    }
  };

  const failClosedReasons = [];
  for (const sectionId of requiredSections) {
    const section = sections[sectionId];
    if (!section || section.status !== 'satisfied') {
      failClosedReasons.push(`${sectionId}:${section?.status ?? 'missing'}`);
    }
  }

  return {
    schema_version: 1,
    evidence_id: 'brownie-supply-chain-artifact-evidence-v1',
    phase: 'RRP-8.4',
    repository: 'globalpocket/brownie',
    generated_at: generatedAt,
    source_commit: sourceCommit,
    source_tree_dirty: Boolean(treeStatus),
    release_ready: false,
    runtime_release_ready: false,
    required_sections: requiredSections,
    sections,
    fail_closed_reasons: failClosedReasons
  };
}

export function writeSupplyChainArtifactEvidence(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const outPath = normalizeRelativePath(options.outPath ?? defaultOutPath);
  const evidence = buildSupplyChainArtifactEvidence({ ...options, repoRoot, outPath });
  writeJson(repoRoot, outPath, evidence);
  return { evidence, outPath };
}

if (isMainModule()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = writeSupplyChainArtifactEvidence(options);
    process.stdout.write(`${JSON.stringify({ path: result.outPath, release_ready: result.evidence.release_ready, fail_closed_reasons: result.evidence.fail_closed_reasons }, null, 2)}\n`);
  } catch (error) {
    console.error(`Supply-chain/artifact evidence generation failed: ${error.message}`);
    process.exit(1);
  }
}
