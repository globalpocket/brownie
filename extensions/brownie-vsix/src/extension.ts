import * as vscode from 'vscode';
import { formatError } from './runtime/errors';
import { createRuntimeClient } from './runtime/workspace';

export function activate(context: vscode.ExtensionContext): void {
  const runtimeClient = createRuntimeClient(context);

  const disposable = vscode.commands.registerCommand('brownie.runtimeStatus', async () => {
    try {
      const status = await runtimeClient.status();
      await vscode.window.showInformationMessage(
        `Brownie runtime: ${status.name} ${status.version} ${status.status}`,
      );
    } catch (error) {
      await vscode.window.showErrorMessage(`Brownie runtime status failed: ${formatError(error)}`);
    }
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // Runtime processes are short-lived in Phase 0.3.
}
