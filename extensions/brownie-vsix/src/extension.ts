import * as vscode from 'vscode';
import { formatError } from './runtime/errors';
import type { RuntimeActionName } from './runtime/protocol';
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

  const modeListCommand = vscode.commands.registerCommand('brownie.modeList', async () => {
    try {
      const modes = await runtimeClient.listModes();
      output.appendLine(`mode.list: ${JSON.stringify(modes, null, 2)}`);
      output.show(true);
      await vscode.window.showInformationMessage(`Brownie modes: ${modes.length}`);
    } catch (error) {
      output.appendLine(`mode.list failed: ${formatError(error)}`);
      await vscode.window.showErrorMessage(`Brownie mode list failed: ${formatError(error)}`);
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


  const permissionCheckCommand = vscode.commands.registerCommand('brownie.permissionCheck', async () => {
    const modeId = await vscode.window.showInputBox({
      prompt: 'Mode ID',
      placeHolder: 'orchestrator',
      ignoreFocusOut: true,
    });

    if (modeId === undefined) {
      return;
    }

    const actions: RuntimeActionName[] = [
      'ReadWorkspace',
      'WriteWorkspace',
      'ExecuteProcess',
      'AccessNetwork',
      'ControlService',
      'DestructiveOperation',
      'SpawnSubtask',
    ];
    const action = await vscode.window.showQuickPick(actions, {
      placeHolder: 'Select a runtime action to check',
    });

    if (action === undefined) {
      return;
    }

    try {
      const result = await runtimeClient.checkPermission(modeId.trim(), action as RuntimeActionName);
      output.appendLine(`permission.check: ${JSON.stringify(result)}`);
      output.show(true);
      await vscode.window.showInformationMessage(
        `Brownie permission ${result.allowed ? 'allowed' : 'denied'}: ${result.action}`,
      );
    } catch (error) {
      output.appendLine(`permission.check failed: ${formatError(error)}`);
      await vscode.window.showErrorMessage(`Brownie permission check failed: ${formatError(error)}`);
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


  const toolPlanCommand = vscode.commands.registerCommand('brownie.toolPlan', async () => {
    const taskId = await vscode.window.showInputBox({
      prompt: 'Task ID',
      placeHolder: 'task_...',
      ignoreFocusOut: true,
    });

    if (taskId === undefined) {
      return;
    }

    try {
      const result = await runtimeClient.planTools(taskId.trim());
      const allowed = result.items.filter((item) => item.allowed).length;
      const denied = result.items.length - allowed;
      output.appendLine(`tool.plan: ${JSON.stringify(result, null, 2)}`);
      output.show(true);
      await vscode.window.showInformationMessage(
        `Brownie tool plan: ${allowed} allowed, ${denied} denied`,
      );
    } catch (error) {
      output.appendLine(`tool.plan failed: ${formatError(error)}`);
      await vscode.window.showErrorMessage(`Brownie tool plan failed: ${formatError(error)}`);
    }
  });


  const toolIntentParseCommand = vscode.commands.registerCommand('brownie.toolIntentParse', async () => {
    const modeId = await vscode.window.showInputBox({
      prompt: 'Mode ID',
      placeHolder: 'orchestrator',
      ignoreFocusOut: true,
    });

    if (modeId === undefined) {
      return;
    }

    const assistantContent = await vscode.window.showInputBox({
      prompt: 'Assistant content containing a brownie-tool-intent fenced block',
      placeHolder: '```brownie-tool-intent\n{"tool_requests":[...]}\n```',
      ignoreFocusOut: true,
    });

    if (assistantContent === undefined) {
      return;
    }

    try {
      const result = await runtimeClient.parseToolIntent(modeId.trim(), assistantContent);
      const approved = result.items.filter((item) => item.allowed).length;
      const denied = result.items.length - approved;
      const rejected = result.rejected.length;
      output.appendLine(`tool.intent.parse: ${JSON.stringify(result, null, 2)}`);
      output.show(true);
      await vscode.window.showInformationMessage(
        `Brownie tool intent: ${approved} approved, ${denied} denied, ${rejected} rejected`,
      );
    } catch (error) {
      output.appendLine(`tool.intent.parse failed: ${formatError(error)}`);
      await vscode.window.showErrorMessage(`Brownie tool intent parse failed: ${formatError(error)}`);
    }
  });

  const toolExecuteReadCommand = vscode.commands.registerCommand('brownie.toolExecuteRead', async () => {
    const modeIdInput = await vscode.window.showInputBox({
      prompt: 'Mode ID',
      value: 'orchestrator',
      ignoreFocusOut: true,
    });

    if (modeIdInput === undefined) {
      return;
    }

    const path = await vscode.window.showInputBox({
      prompt: 'Workspace-relative path to read',
      placeHolder: 'README.md',
      ignoreFocusOut: true,
    });

    if (path === undefined) {
      return;
    }

    try {
      const result = await runtimeClient.executeTool(modeIdInput.trim() || 'orchestrator', 'workspace.read', { path: path.trim() });
      output.appendLine(`tool.execute workspace.read: ${JSON.stringify(result, null, 2)}`);
      output.show(true);
      const outputValue = result.output as { bytes_read?: unknown; truncated?: unknown };
      await vscode.window.showInformationMessage(
        `Brownie workspace.read ${result.status}: bytes_read=${String(outputValue.bytes_read ?? 'n/a')}, truncated=${String(outputValue.truncated ?? 'n/a')}`,
      );
    } catch (error) {
      output.appendLine(`tool.execute workspace.read failed: ${formatError(error)}`);
      await vscode.window.showErrorMessage(`Brownie execute read tool failed: ${formatError(error)}`);
    }
  });

  context.subscriptions.push(output, statusCommand, modeListCommand, taskStartCommand, taskListCommand, permissionCheckCommand, taskRunCommand, toolPlanCommand, toolIntentParseCommand, toolExecuteReadCommand);
}

export function deactivate(): void {
  // Runtime processes are short-lived in Phase 1.0.
}
