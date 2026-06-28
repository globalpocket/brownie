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

  const llmStatusCommand = vscode.commands.registerCommand('brownie.llmStatus', async () => {
    try {
      const status = await runtimeClient.llmStatus();
      output.appendLine(`llm.status:`);
      output.appendLine(`provider: ${status.provider}`);
      output.appendLine(`enabled: ${String(status.enabled)}`);
      output.appendLine(`model: ${status.model}`);
      output.appendLine(`base_url: ${status.base_url ?? 'null'}`);
      output.appendLine(`strict: ${String(status.strict)}`);
      output.appendLine(`will_fallback_to_fake: ${String(status.will_fallback_to_fake)}`);
      output.appendLine(`task_run_network_allowed: ${String(status.task_run_network_allowed)}`);
      output.appendLine(`sensitive_guard: ${status.sensitive_guard}`);
      output.appendLine(`budget.max_prompt_chars: ${String(status.budget.max_prompt_chars)}`);
      output.appendLine(`budget.max_messages: ${String(status.budget.max_messages)}`);
      output.appendLine(`budget.request_timeout_ms: ${String(status.budget.request_timeout_ms)}`);
      output.appendLine(`budget.response_preview_chars: ${String(status.budget.response_preview_chars)}`);
      output.appendLine(`reason: ${status.reason ?? 'null'}`);
      output.show(true);
      await vscode.window.showInformationMessage(
        `Brownie LLM: ${status.provider} ${status.model} enabled=${String(status.enabled)} strict=${String(status.strict)}`,
      );
    } catch (error) {
      output.appendLine(`llm.status failed: ${formatError(error)}`);
      await vscode.window.showErrorMessage(`Brownie LLM status failed: ${formatError(error)}`);
    }
  });

  const llmHealthCommand = vscode.commands.registerCommand('brownie.llmHealth', async () => {
    const confirm = await vscode.window.showWarningMessage(
      'Brownie will connect to the configured LLM endpoint to check /models readiness. Continue?',
      { modal: true },
      'Confirm',
    );

    if (confirm !== 'Confirm') {
      return;
    }

    try {
      const health = await runtimeClient.llmHealth({ allow_network: true, timeout_ms: 5000 });
      output.appendLine(`llm.health:`);
      output.appendLine(JSON.stringify(health, null, 2));
      output.show(true);
      await vscode.window.showInformationMessage(
        `Brownie LLM health: provider=${health.provider} healthy=${String(health.healthy)} latency=${health.latency_ms ?? 'n/a'}ms`,
      );
    } catch (error) {
      output.appendLine(`llm.health failed: ${formatError(error)}`);
      await vscode.window.showErrorMessage(`Brownie LLM health failed: ${formatError(error)}`);
    }
  });

  const runtimeConfigCommand = vscode.commands.registerCommand('brownie.runtimeConfig', async () => {
    try {
      const config = await runtimeClient.runtimeConfig();
      output.appendLine(`runtime.config.get:`);
      output.appendLine(JSON.stringify(config, null, 2));
      output.show(true);
      await vscode.window.showInformationMessage(
        `Brownie config: source=${config.config_source} profile=${config.active_profile ?? 'null'} provider=${config.llm_status.provider}`,
      );
    } catch (error) {
      output.appendLine(`runtime.config.get failed: ${formatError(error)}`);
      await vscode.window.showErrorMessage(`Brownie runtime config failed: ${formatError(error)}`);
    }
  });

  const runtimeDiagnosticsCommand = vscode.commands.registerCommand('brownie.runtimeDiagnostics', async () => {
    try {
      const diagnostics = await runtimeClient.runtimeDiagnostics();
      output.appendLine(`runtime.diagnostics.get:`);
      output.appendLine(JSON.stringify(diagnostics, null, 2));
      output.show(true);
      const errors = diagnostics.diagnostics.filter((item) => item.severity === 'Error').length;
      const warnings = diagnostics.diagnostics.filter((item) => item.severity === 'Warning').length;
      await vscode.window.showInformationMessage(
        `Brownie diagnostics: ${errors} errors, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`,
      );
    } catch (error) {
      output.appendLine(`runtime.diagnostics.get failed: ${formatError(error)}`);
      await vscode.window.showErrorMessage(`Brownie runtime diagnostics failed: ${formatError(error)}`);
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


  const taskInspectCommand = vscode.commands.registerCommand('brownie.taskInspect', async () => {
    const taskId = await vscode.window.showInputBox({
      prompt: 'Task ID',
      placeHolder: 'task_...',
      ignoreFocusOut: true,
    });

    if (taskId === undefined) {
      return;
    }

    try {
      const result = await runtimeClient.inspectTask(taskId.trim());
      output.appendLine(`task.inspect: ${JSON.stringify(result, null, 2)}`);
      output.show(true);
      await vscode.window.showInformationMessage(
        `Brownie task inspect: ${result.task.status}, events=${result.run.event_count}, second_pass=${result.run.has_second_pass}`,
      );
    } catch (error) {
      output.appendLine(`task.inspect failed: ${formatError(error)}`);
      await vscode.window.showErrorMessage(`Brownie task inspect failed: ${formatError(error)}`);
    }
  });

  const runInspectCommand = vscode.commands.registerCommand('brownie.runInspect', async () => {
    const runId = await vscode.window.showInputBox({
      prompt: 'Run ID',
      placeHolder: 'run_...',
      ignoreFocusOut: true,
    });

    if (runId === undefined) {
      return;
    }

    try {
      const result = await runtimeClient.inspectRun(runId.trim());
      output.appendLine(`run.inspect: ${JSON.stringify(result, null, 2)}`);
      output.show(true);
      await vscode.window.showInformationMessage(
        `Brownie run inspect: events=${result.event_count}, second_pass=${result.has_second_pass}`,
      );
    } catch (error) {
      output.appendLine(`run.inspect failed: ${formatError(error)}`);
      await vscode.window.showErrorMessage(`Brownie run inspect failed: ${formatError(error)}`);
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

  context.subscriptions.push(output, statusCommand, llmStatusCommand, llmHealthCommand, runtimeConfigCommand, modeListCommand, taskStartCommand, taskListCommand, permissionCheckCommand, taskRunCommand, toolPlanCommand, toolIntentParseCommand, toolExecuteReadCommand, taskInspectCommand, runInspectCommand);
}

export function deactivate(): void {
  // Runtime processes are short-lived in Phase 1.0.
}
