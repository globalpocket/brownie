import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultChecksumPath = '.brownie/release-evidence/SHA256SUMS';
const defaultOutPath = '.brownie/release-evidence/integrity-verification.json';

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function parseArgs(argv) {
  const options = {
    repoRoot: defaultRepoRoot,
    checksumPath: defaultChecksumPath,
    outPath: defaultOutPath
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--repo-root') {
      options.repoRoot = path.resolve(argv[++index] ?? '');
    } else if (arg === '--checksums') {
      options.checksumPath = argv[++index] ?? '';
    } else if (arg === '--out') {
      options.outPath = argv[++index] ?? '';
    } else {
      throw new Error(`Unknown integrity verification argument: ${arg}`);
    }
  }
  return options;
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
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function parseChecksumLines(text) {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})  ([^\r\n]+)$/);
      if (!match) {
        return { malformed: true, line_hash: `sha256:${crypto.createHash('sha256').update(line).digest('hex')}` };
      }
      return {
        malformed: false,
        expected_sha256: `sha256:${match[1]}`,
        path: normalizeRelativePath(match[2])
      };
    });
}

function writeJson(repoRoot, relativePath, value) {
  const fullPath = resolveRepoRelative(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`);
}

export function buildIntegrityVerificationEvidence(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const checksumPath = normalizeRelativePath(options.checksumPath ?? defaultChecksumPath);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const checksumFullPath = resolveRepoRelative(repoRoot, checksumPath);
  const entries = fs.existsSync(checksumFullPath)
    ? parseChecksumLines(fs.readFileSync(checksumFullPath, 'utf8'))
    : [];

  const verified_entries = entries.map((entry) => {
    if (entry.malformed) {
      return {
        status: 'malformed',
        line_hash: entry.line_hash
      };
    }
    const fullPath = resolveRepoRelative(repoRoot, entry.path);
    if (!fs.existsSync(fullPath)) {
      return {
        path: entry.path,
        expected_sha256: entry.expected_sha256,
        actual_sha256: null,
        status: 'missing'
      };
    }
    const actualSha256 = sha256File(fullPath);
    return {
      path: entry.path,
      expected_sha256: entry.expected_sha256,
      actual_sha256: actualSha256,
      status: actualSha256 === entry.expected_sha256 ? 'satisfied' : 'mismatch'
    };
  });

  const failClosedReasons = [];
  if (!fs.existsSync(checksumFullPath)) {
    failClosedReasons.push('checksums:missing');
  }
  for (const [index, entry] of verified_entries.entries()) {
    if (entry.status !== 'satisfied') {
      failClosedReasons.push(`verified_entries[${index}]:${entry.status}`);
    }
  }

  return {
    schema_version: 1,
    evidence_id: 'brownie-release-integrity-verification-v1',
    generated_at: generatedAt,
    repository: 'globalpocket/brownie',
    checksum_path: checksumPath,
    checksum_file_sha256: fs.existsSync(checksumFullPath) ? sha256File(checksumFullPath) : null,
    verified_entries,
    status: failClosedReasons.length === 0 && verified_entries.length > 0 ? 'satisfied' : 'failed',
    release_ready: false,
    runtime_release_ready: false,
    owner_approval_required: true,
    note: 'Checksum verification proves local file integrity against SHA256SUMS only; it is not a signature and does not replace owner-approved signing or integrity authority.',
    fail_closed_reasons: failClosedReasons
  };
}

export function writeIntegrityVerificationEvidence(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const outPath = normalizeRelativePath(options.outPath ?? defaultOutPath);
  const evidence = buildIntegrityVerificationEvidence({ ...options, repoRoot });
  writeJson(repoRoot, outPath, evidence);
  return { evidence, outPath };
}

if (isMainModule()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = writeIntegrityVerificationEvidence(options);
    process.stdout.write(`${JSON.stringify({ path: result.outPath, status: result.evidence.status, fail_closed_reasons: result.evidence.fail_closed_reasons }, null, 2)}\n`);
    process.exit(result.evidence.status === 'satisfied' ? 0 : 1);
  } catch (error) {
    console.error(`Integrity verification failed: ${error.message}`);
    process.exit(1);
  }
}
