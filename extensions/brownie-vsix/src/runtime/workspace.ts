import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { RuntimeClient } from './runtimeClient';
import { RuntimeProcess } from './runtimeProcess';

export function createRuntimeClient(_context: vscode.ExtensionContext): RuntimeClient {
  return new RuntimeClient(
    new RuntimeProcess({
      command: 'cargo',
      args: ['run', '-q', '-p', 'brownie-runtime'],
      cwd: getWorkspaceRoot,
    }),
  );
}

export function getWorkspaceRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (folders === undefined || folders.length === 0) {
    throw new Error('open the Brownie repository workspace before running this command');
  }

  return findRepositoryRoot(folders[0].uri.fsPath);
}

export function findRepositoryRoot(startPath: string): string {
  let current = startPath;

  while (true) {
    if (
      fs.existsSync(path.join(current, 'Cargo.toml')) &&
      fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`could not find Brownie repository root from ${startPath}`);
    }
    current = parent;
  }
}
