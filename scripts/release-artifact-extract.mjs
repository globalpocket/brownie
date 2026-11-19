import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Exit zero is not evidence of extraction. All consumers require a fresh
// destination and the actual package files before checking their SHA bindings.
export function extractReleaseArchive(target, archivePath, extractionRoot, options = {}) {
  const platform = options.platform ?? process.platform;
  const spawn = options.spawn ?? spawnSync;
  if (!fs.statSync(extractionRoot).isDirectory() || fs.readdirSync(extractionRoot).length) {
    throw new Error('release extraction requires an empty destination directory');
  }
  let command;
  let args;
  if (target.archiveType === 'tar') {
    command = 'tar';
    args = ['-xzf', archivePath, '-C', extractionRoot];
  } else if (target.archiveType === 'zip' && platform === 'win32') {
    // Use Windows' native libarchive executable directly, without a PowerShell
    // command-string layer or its nonterminating-error/exit-code semantics.
    command = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    args = ['-xf', archivePath, '-C', extractionRoot];
  } else if (target.archiveType === 'zip') {
    command = 'unzip';
    args = ['-q', archivePath, '-d', extractionRoot];
  } else {
    throw new Error(`unsupported release archive type: ${target.archiveType}`);
  }
  const result = spawn(command, args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000, maxBuffer: 4 * 1024 * 1024
  });
  // These are the shared package inputs consumed by roundtrip, journey and soak.
  // Smoke reports are produced by packaging but are not journey/soak inputs.
  const required = [target.binaryName, target.runtimeName, 'SHA256SUMS', 'artifact-evidence.json'];
  const symbolicLinks = [];
  const missing = required.filter(name => {
    try {
      const stat = fs.lstatSync(path.join(extractionRoot, name));
      if (stat.isSymbolicLink()) symbolicLinks.push(name);
      return !stat.isFile();
    }
    catch { return true; }
  });
  if (result.error || result.status !== 0 || missing.length) {
    throw new Error(`release archive extraction failed: ${JSON.stringify({
      archivePath, extractionRoot, command, args, status: result.status,
      signal: result.signal, error: result.error?.message, missing,
      fileError: symbolicLinks.length ? 'release extraction rejects symbolic link' : undefined,
      symbolicLinks,
      entries: fs.readdirSync(extractionRoot).slice(0, 40),
      stdout: String(result.stdout ?? '').slice(-8192),
      stderr: String(result.stderr ?? '').slice(-8192)
    })}`);
  }
}
