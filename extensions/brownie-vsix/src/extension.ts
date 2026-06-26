import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import * as vscode from 'vscode';

interface JsonRpcError {
  code: number;
  message: string;
}

interface RuntimeStatusResult {
  name: string;
  version: string;
  status: string;
}

interface RuntimeStatusResponse {
  jsonrpc: '2.0';
  id: number;
  result?: RuntimeStatusResult;
  error?: JsonRpcError;
}

const RUNTIME_STATUS_REQUEST = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'runtime.status',
});

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('brownie.runtimeStatus', async () => {
    try {
      const response = await requestRuntimeStatus();

      if (response.error !== undefined) {
        await vscode.window.showErrorMessage(
          `Brownie runtime error ${response.error.code}: ${response.error.message}`,
        );
        return;
      }

      if (response.result === undefined) {
        await vscode.window.showErrorMessage('Brownie runtime returned no status result.');
        return;
      }

      const { name, version, status } = response.result;
      await vscode.window.showInformationMessage(`Brownie runtime: ${name} ${version} ${status}`);
    } catch (error) {
      await vscode.window.showErrorMessage(`Brownie runtime status failed: ${formatError(error)}`);
    }
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // Runtime processes are short-lived in Phase 0.2.
}

async function requestRuntimeStatus(): Promise<RuntimeStatusResponse> {
  const workspaceRoot = getWorkspaceRoot();

  return new Promise<RuntimeStatusResponse>((resolve, reject) => {
    const child = cp.spawn('cargo', ['run', '-q', '-p', 'brownie-runtime'], {
      cwd: workspaceRoot,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let settled = false;
    let stderr = '';

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      reject(new Error('timed out after 10 seconds waiting for brownie-runtime'));
    }, 10_000);

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      settleWithError(error);
    });

    child.on('exit', (code, signal) => {
      if (!settled && code !== 0) {
        settleWithError(
          new Error(`brownie-runtime exited with code ${code ?? 'unknown'} signal ${signal ?? 'none'}${stderrMessage(stderr)}`),
        );
      }
    });

    const lines = readline.createInterface({ input: child.stdout });
    lines.once('line', (line) => {
      try {
        const response = JSON.parse(line) as RuntimeStatusResponse;
        if (!isRuntimeStatusResponse(response)) {
          throw new Error(`unexpected response shape: ${line}`);
        }
        settleWithValue(response);
      } catch (error) {
        settleWithError(error);
      } finally {
        child.kill();
        lines.close();
      }
    });

    child.stdin.write(`${RUNTIME_STATUS_REQUEST}\n`, (error) => {
      if (error !== undefined && error !== null) {
        settleWithError(error);
        return;
      }
      child.stdin.end();
    });

    function settleWithValue(response: RuntimeStatusResponse): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(response);
    }

    function settleWithError(error: unknown): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      child.kill();
      reject(new Error(`${formatError(error)}${stderrMessage(stderr)}`));
    }
  });
}

function getWorkspaceRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (folders === undefined || folders.length === 0) {
    throw new Error('open the Brownie repository workspace before running this command');
  }

  return findRepositoryRoot(folders[0].uri.fsPath);
}

function findRepositoryRoot(startPath: string): string {
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

function isRuntimeStatusResponse(value: unknown): value is RuntimeStatusResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const response = value as Partial<RuntimeStatusResponse>;
  return response.jsonrpc === '2.0' && typeof response.id === 'number';
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function stderrMessage(stderr: string): string {
  const trimmed = stderr.trim();
  return trimmed.length > 0 ? `; stderr: ${trimmed}` : '';
}
