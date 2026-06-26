import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('brownie.runtimeStatus', async () => {
    await vscode.window.showInformationMessage('Brownie runtime status: Phase 0 stub');
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // Phase 0 stub.
}
