import * as vscode from 'vscode';
import { formatError } from './runtime/errors';
import { createRuntimeClient } from './runtime/workspace';

export function activate(context: vscode.ExtensionContext): void {
  const runtimeClient = createRuntimeClient(context);
  const output = vscode.window.createOutputChannel('Brownie');

  const statusCommand = vscode.commands.registerCommand('brownie.runtimeStatus', async () => {
    try {
      const status = await runtimeClient.status();
      output.appendLine(`runtime.status: ${JSON.stringify(status)}`);
      await vscode.window.showInformationMessage(
        `Brownie runtime: ${status.name} ${status.version} ${status.status}`,
      );
    } catch (error) {
      output.appendLine(`runtime.status failed: ${formatError(error)}`);
      await vscode.window.showErrorMessage(`Brownie runtime status failed: ${formatError(error)}`);
    }
  });

  const taskStartCommand = vscode.commands.registerCommand('brownie.taskStart', async () => {
    const goal = await vscode.window.showInputBox({
      prompt: 'Task goal',
      placeHolder: 'Describe the task Brownie should create',
      ignoreFocusOut: true,
    });

    if (goal === undefined) {
      return;
    }

    const modeId = await vscode.window.showInputBox({
      prompt: 'Mode ID (optional)',
      placeHolder: 'orchestrator',
      ignoreFocusOut: true,
    });

    try {
      const result = await runtimeClient.startTask({
        goal,
        modeId: modeId === undefined || modeId.trim() === '' ? undefined : modeId.trim(),
      });
      output.appendLine(`task.start: ${JSON.stringify(result)}`);
      await vscode.window.showInformationMessage(
        `Brownie task created: ${result.task_id} (${result.status})`,
      );
    } catch (error) {
      output.appendLine(`task.start failed: ${formatError(error)}`);
      await vscode.window.showErrorMessage(`Brownie task start failed: ${formatError(error)}`);
    }
  });

  const taskListCommand = vscode.commands.registerCommand('brownie.taskList', async () => {
    try {
      const tasks = await runtimeClient.listTasks();
      output.appendLine(`task.list: ${JSON.stringify(tasks, null, 2)}`);
      output.show(true);
      await vscode.window.showInformationMessage(`Brownie tasks: ${tasks.length}`);
    } catch (error) {
      output.appendLine(`task.list failed: ${formatError(error)}`);
      await vscode.window.showErrorMessage(`Brownie task list failed: ${formatError(error)}`);
    }
  });


  const taskRunCommand = vscode.commands.registerCommand('brownie.taskRun', async () => {
    const taskId = await vscode.window.showInputBox({
      prompt: 'Task ID',
      placeHolder: 'task_...',
      ignoreFocusOut: true,
    });

    if (taskId === undefined) {
      return;
    }

    try {
      const result = await runtimeClient.runTask(taskId.trim());
      output.appendLine(`task.run: ${JSON.stringify(result)}`);
      output.show(true);
      await vscode.window.showInformationMessage(
        `Brownie task run: ${result.task_id} (${result.status})`,
      );
    } catch (error) {
      output.appendLine(`task.run failed: ${formatError(error)}`);
      await vscode.window.showErrorMessage(`Brownie task run failed: ${formatError(error)}`);
    }
  });

  context.subscriptions.push(output, statusCommand, taskStartCommand, taskListCommand, taskRunCommand);
}

export function deactivate(): void {
  // Runtime processes are short-lived in Phase 1.0.
}
