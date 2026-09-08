import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultSchemaPath = 'docs/architecture/local-release-targets.schema.json';
const defaultExamplePath = 'docs/architecture/local-release-targets.example.json';
const defaultManifestPath = '.brownie/local-release-targets.json';
const allowedIds = new Set(['darwin-arm64', 'linux-arm64', 'linux-x64', 'win32-x64']);
const allowedKinds = new Set(['local', 'ssh']);
const allowedShells = new Set(['posix', 'powershell']);
const hostPattern = /^[A-Za-z0-9._@:-]+$/;
const workspacePattern = /^[A-Za-z0-9._/:\\-]+$/;

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function readJson(repoRoot, relativePath, errors) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
  } catch (error) {
    errors.push(`${relativePath} must be readable JSON: ${error.message}`);
    return {};
  }
}

function requireValue(condition, errors, message) {
  if (!condition) {
    errors.push(message);
  }
}

function validateTarget(target, errors, owner) {
  requireValue(target && typeof target === 'object' && !Array.isArray(target), errors, `${owner} must be an object.`);
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    return;
  }
  const keys = new Set(Object.keys(target));
  for (const key of keys) {
    requireValue(['id', 'kind', 'required', 'host', 'workspace', 'shell', 'runner_arch', 'container_platform'].includes(key), errors, `${owner}.${key} is not allowed.`);
  }
  requireValue(allowedIds.has(target.id), errors, `${owner}.id must be one of darwin-arm64, linux-arm64, linux-x64, win32-x64.`);
  requireValue(allowedKinds.has(target.kind), errors, `${owner}.kind must be local or ssh.`);
  requireValue(typeof target.required === 'boolean', errors, `${owner}.required must be boolean.`);
  if (target.kind === 'local') {
    requireValue(target.host === undefined, errors, `${owner}.host must be omitted for local targets.`);
    requireValue(target.workspace === undefined, errors, `${owner}.workspace must be omitted for local targets.`);
    requireValue(target.shell === undefined, errors, `${owner}.shell must be omitted for local targets.`);
  } else if (target.kind === 'ssh') {
    requireValue(typeof target.host === 'string' && hostPattern.test(target.host), errors, `${owner}.host must be a bounded SSH host alias.`);
    requireValue(typeof target.workspace === 'string' && workspacePattern.test(target.workspace), errors, `${owner}.workspace must be a bounded absolute workspace path without shell metacharacters or spaces.`);
    requireValue(allowedShells.has(target.shell), errors, `${owner}.shell must be posix or powershell.`);
  }
  if (target.container_platform !== undefined) {
    requireValue(target.container_platform === 'linux/amd64', errors, `${owner}.container_platform must be linux/amd64.`);
    requireValue(target.id === 'linux-x64', errors, `${owner}.container_platform is only supported for linux-x64.`);
    requireValue(target.shell === 'posix', errors, `${owner}.container_platform requires posix shell.`);
  }
  if (target.runner_arch !== undefined) {
    requireValue(['x64', 'arm64'].includes(target.runner_arch), errors, `${owner}.runner_arch must be x64 or arm64.`);
    requireValue(target.kind === 'ssh', errors, `${owner}.runner_arch is only supported for ssh targets.`);
  }
}

export function validateLocalReleaseTargetsManifest(manifest, options = {}) {
  const owner = options.owner ?? 'manifest';
  const errors = [];
  requireValue(manifest && typeof manifest === 'object' && !Array.isArray(manifest), errors, `${owner} must be an object.`);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return errors;
  }
  const keys = new Set(Object.keys(manifest));
  for (const key of keys) {
    requireValue(['schema_version', 'targets'].includes(key), errors, `${owner}.${key} is not allowed.`);
  }
  requireValue(manifest.schema_version === 1, errors, `${owner}.schema_version must be 1.`);
  requireValue(Array.isArray(manifest.targets) && manifest.targets.length > 0, errors, `${owner}.targets must be a non-empty array.`);
  const seen = new Set();
  for (const [index, target] of (Array.isArray(manifest.targets) ? manifest.targets : []).entries()) {
    validateTarget(target, errors, `${owner}.targets[${index}]`);
    if (target?.id) {
      requireValue(!seen.has(target.id), errors, `${owner}.targets must not contain duplicate id ${target.id}.`);
      seen.add(target.id);
    }
  }
  return errors;
}

export function runLocalReleaseTargetsGuard(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const schemaPath = options.schemaPath ?? defaultSchemaPath;
  const examplePath = options.examplePath ?? defaultExamplePath;
  const manifestPath = options.manifestPath ?? process.env.BROWNIE_LOCAL_RELEASE_TARGETS ?? defaultManifestPath;
  const errors = [];
  const schema = readJson(repoRoot, schemaPath, errors);
  requireValue(schema?.properties?.targets?.type === 'array', errors, `${schemaPath} must define targets as an array.`);
  requireValue(schema?.properties?.targets?.items?.properties?.id?.enum?.includes('linux-x64'), errors, `${schemaPath} must include linux-x64 target id.`);
  requireValue(schema?.properties?.targets?.items?.properties?.id?.enum?.includes('linux-arm64'), errors, `${schemaPath} must include linux-arm64 target id.`);
  requireValue(schema?.properties?.targets?.items?.properties?.id?.enum?.includes('win32-x64'), errors, `${schemaPath} must include win32-x64 target id.`);
  const example = readJson(repoRoot, examplePath, errors);
  errors.push(...validateLocalReleaseTargetsManifest(example, { owner: examplePath }));
  const fullManifestPath = path.resolve(repoRoot, manifestPath);
  const relativeManifest = path.relative(repoRoot, fullManifestPath);
  requireValue(!relativeManifest.startsWith('..') && !path.isAbsolute(relativeManifest), errors, `${manifestPath} must stay inside repository root.`);
  let manifestValidated = false;
  if (fs.existsSync(fullManifestPath)) {
    const manifest = readJson(repoRoot, relativeManifest, errors);
    errors.push(...validateLocalReleaseTargetsManifest(manifest, { owner: relativeManifest }));
    manifestValidated = true;
  }
  return { errors, schemaPath, examplePath, manifestPath: relativeManifest, manifestValidated };
}

if (isMainModule()) {
  const result = runLocalReleaseTargetsGuard();
  if (result.errors.length > 0) {
    console.error('Local release targets guard failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  process.stdout.write(
    `${JSON.stringify({ schema: result.schemaPath, example: result.examplePath, manifest: result.manifestPath, manifest_validated: result.manifestValidated, status: 'passed' }, null, 2)}\n`
  );
}
