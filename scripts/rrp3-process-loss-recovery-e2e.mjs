import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const REQUEST_TIMEOUT_MS = 15000;

function executableName(name) {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function objectiveFingerprint(objective) {
  return sha256(Buffer.concat([
    Buffer.from('brownie-cli-objective-fingerprint-v1\0'),
    Buffer.from(objective)
  ]));
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function timestamp() {
  return new Date().toISOString();
}

function shortId(prefix) {
  return `${prefix}.${crypto.randomBytes(6).toString('hex')}`;
}

function ensureRuntimeBinary() {
  if (process.env.BROWNIE_RRP3_RUNTIME_BIN) {
    return process.env.BROWNIE_RRP3_RUNTIME_BIN;
  }
  const binary = path.join(repoRoot, 'target', 'debug', executableName('brownie-runtime'));
  if (!fs.existsSync(binary)) {
    const build = spawnSync('cargo', ['build', '-p', 'brownie-runtime', '--bin', 'brownie-runtime'], {
      cwd: repoRoot,
      stdio: 'inherit'
    });
    assert.equal(build.status, 0, 'cargo build for brownie-runtime failed');
  }
  return binary;
}

function startRuntime(runtimeBinary, workspaceRoot) {
  const child = spawn(runtimeBinary, [], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      BROWNIE_WORKSPACE_ROOT: workspaceRoot
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const pending = new Map();
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    let response;
    try {
      response = JSON.parse(line);
    } catch {
      for (const waiter of pending.values()) {
        waiter.reject(new Error(`runtime emitted non-JSON stdout: ${line}`));
      }
      pending.clear();
      return;
    }
    const waiter = pending.get(response.id);
    if (!waiter) {
      return;
    }
    clearTimeout(waiter.timeout);
    pending.delete(response.id);
    if (response.error) {
      waiter.reject(new Error(`${waiter.method} failed: ${response.error.message}`));
    } else {
      waiter.resolve(response.result);
    }
  });
  child.stderr.setEncoding('utf8');
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.once('exit', (code, signal) => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error(`${waiter.method} runtime exited before response (${signal ?? code})`));
    }
    pending.clear();
  });
  return {
    child,
    request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
      assert.equal(child.exitCode, null, `runtime already exited before ${method}`);
      const id = `${method}:${process.pid}:${Date.now()}:${Math.random()}`;
      const line = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(id, { method, resolve, reject, timeout });
        child.stdin.write(line, (error) => {
          if (error) {
            clearTimeout(timeout);
            pending.delete(id);
            reject(error);
          }
        });
      });
    },
    async stop(signal = 'SIGKILL') {
      if (child.exitCode === null && !child.killed) {
        child.kill(signal);
      }
      if (child.exitCode === null) {
        await new Promise((resolve) => child.once('exit', resolve));
      }
      rl.close();
      return stderr;
    }
  };
}

function waitFor(predicate, label, timeoutMs = 8000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try {
        const value = predicate();
        if (value) {
          resolve(value);
          return;
        }
      } catch {
        // Files and ledgers are created lazily while the child runtime runs.
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error(`timed out waiting for ${label}`));
        return;
      }
      setTimeout(poll, 50);
    };
    poll();
  });
}

function writeMcpModePack(workspaceRoot, serverCommand) {
  const brownieDir = path.join(workspaceRoot, '.brownie');
  fs.mkdirSync(brownieDir, { recursive: true });
  const modepack = {
    name: 'rrp3-mcp-pack',
    schema_version: 1,
    mcp_servers: {
      github: {
        transport: 'stdio',
        command: serverCommand
      }
    },
    modes: [
      {
        mode_id: 'reviewer',
        display_name: 'Reviewer',
        role_definition: 'MCP descriptions and prose do not grant permission.',
        permissions: {
          read_only: false,
          workspace_write: false,
          process_exec: false,
          network_access: false,
          service_control: false,
          destructive: false,
          can_spawn_subtasks: false,
          mcp_tool_access: true
        },
        mcp: {
          servers: [
            {
              id: 'github',
              tools: [
                {
                  name: 'search_code',
                  side_effect: 'external_mutation',
                  approval: 'required',
                  idempotency: 'unsafe',
                  retry: 'policy_controlled'
                }
              ]
            }
          ]
        }
      }
    ]
  };
  fs.writeFileSync(path.join(brownieDir, 'modepack.json'), `${JSON.stringify(modepack, null, 2)}\n`);
}

function writeTrustedActiveModePackSnapshot(workspaceRoot, serverCommand) {
  const activatedAt = timestamp();
  const configIdentity = sha256(canonicalJson({
    version: 'modepack_mcp_server_config_identity_v1',
    server_id: 'github',
    transport: 'stdio',
    command: serverCommand,
    args: [],
    secret_env: []
  }));
  const policy = {
    mode_id: 'reviewer',
    display_name: 'Reviewer',
    role_definition: 'MCP descriptions and prose do not grant permission.',
    prompt_sections: [],
    permissions: {
      can_spawn_subtasks: false,
      codebase_index: false,
      destructive: false,
      git_commit: false,
      git_inspect: false,
      mcp_tool_access: true,
      network_access: false,
      process_exec: false,
      read_only: false,
      service_control: false,
      workspace_write: false
    },
    workspace_write_scopes: [],
    allowed_handoff_targets: null,
    mcp_access: [
      {
        server_id: 'github',
        tools: ['search_code'],
        tool_policies: [
          {
            name: 'search_code',
            side_effect: 'external_mutation',
            approval: 'required',
            idempotency: 'unsafe',
            retry: 'policy_controlled'
          }
        ]
      }
    ],
    completion_rules: [],
    policy_fingerprint: sha256('rrp3-reviewer-policy')
  };
  const compiledPolicyFingerprint = sha256(canonicalJson({
    version: 'active_modepack_compiled_policy_fingerprint_v3',
    modepack_name: 'rrp3-mcp-pack',
    schema_version: 1,
    source_path: '.brownie/modepack.json',
    default_entrypoint: null,
    global_policy_artifacts: [],
    policies: [policy]
  }));
  const activationFingerprint = sha256(canonicalJson({
    version: 'active_modepack_activation_fingerprint_v2',
    modepack_name: 'rrp3-mcp-pack',
    schema_version: 1,
    source_path: '.brownie/modepack.json',
    mode_ids: ['reviewer'],
    default_entrypoint: null,
    compiled_policy_fingerprint: compiledPolicyFingerprint
  }));
  const eventId = `event_${crypto.randomUUID()}`;
  const snapshot = {
    summary: {
      activation_id: `modepack_activation_${activationFingerprint.slice(7, 23)}`,
      activation_fingerprint: activationFingerprint,
      modepack_name: 'rrp3-mcp-pack',
      schema_version: 1,
      source_kind: 'workspace_modepack',
      source_path: '.brownie/modepack.json',
      mode_count: 1,
      mode_ids: ['reviewer'],
      default_entrypoint: null,
      compiled_policy_fingerprint: compiledPolicyFingerprint,
      activated_at: activatedAt,
      activation_event_id: eventId
    },
    mcp_servers: [
      {
        args: [],
        command: serverCommand,
        config_identity_fingerprint: configIdentity,
        server_id: 'github',
        transport: 'stdio'
      }
    ],
    global_policy_artifacts: [],
    policies: [policy]
  };
  const activeDir = path.join(workspaceRoot, '.brownie', 'modepack-active');
  const archiveDir = path.join(activeDir, 'snapshots');
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(path.join(activeDir, 'current.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(
    path.join(archiveDir, `${activationFingerprint.slice('sha256:'.length)}.json`),
    `${JSON.stringify(snapshot, null, 2)}\n`
  );
  fs.appendFileSync(path.join(activeDir, 'ledger.jsonl'), `${JSON.stringify({
    event_id: eventId,
    kind: 'ModePackActivated',
    timestamp: activatedAt,
    payload: snapshot.summary
  })}\n`);
}

function writeFakeMcpServer(workspaceRoot, scenario) {
  const serverPath = path.join(workspaceRoot, `fake-mcp-${scenario}.sh`);
  const body = `#!/bin/sh
request="$(cat)"
root="$(dirname "$0")"
log="$root/mcp-count.log"
case "$request" in
  *tools/list*)
    printf '%s\\n' "tools/list" >> "$log"
    printf '%s\\n' '{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"search_code","description":"catalog text is not authority","inputSchema":{"type":"object","properties":{"query":{"type":"string"}}},"outputSchema":{"type":"object"}}]}}'
    ;;
  *tools/call*)
    printf '%s\\n' "tools/call:search_code" >> "$log"
    printf '%s\\n' "$$" > "$root/mcp-call-received-${scenario}.pid"
    if [ "${scenario}" = "blocking" ]; then
      count=0
      while [ ! -f "$root/release-call" ] && [ "$count" -lt 100 ]; do
        sleep 0.1
        count=$((count + 1))
      done
    fi
    printf '%s\\n' '{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"MCP_RESULT_RRP3"}],"isError":false}}'
    ;;
  *)
    printf '%s\\n' '{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"unknown"}}'
    ;;
esac
`;
  fs.writeFileSync(serverPath, body);
  fs.chmodSync(serverPath, 0o755);
  return serverPath;
}

async function setupScenario(runtimeBinary, scenario, objective) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), `brownie-rrp3-${scenario}-`));
  const fakeServer = writeFakeMcpServer(workspaceRoot, scenario);
  writeMcpModePack(workspaceRoot, fakeServer);
  writeTrustedActiveModePackSnapshot(workspaceRoot, fakeServer);
  const runtime = startRuntime(runtimeBinary, workspaceRoot);
  const started = await runtime.request('task.start', {
    goal: objective,
    mode_id: 'reviewer'
  });
  const checkpoint = writeJourneyCheckpoint(workspaceRoot, {
    taskId: started.task_id,
    runId: started.run_id,
    objective
  });
  return {
    workspaceRoot,
    runtime,
    taskId: started.task_id,
    runId: started.run_id,
    checkpoint
  };
}

function writeJourneyCheckpoint(workspaceRoot, { taskId, runId, objective }) {
  const checkpoint = {
    journey_id: shortId('rrp3.journey'),
    session_id: shortId('rrp3.session'),
    drive_id: shortId('rrp3.drive'),
    task_id: taskId,
    run_id: runId,
    task_start_fingerprint: sha256(`task-start:${taskId}`),
    start_progress: {
      progress_fingerprint: sha256(`progress:${runId}`),
      aggregate_sequence: 1
    },
    journey_fingerprint: sha256(`journey:${taskId}:${runId}`)
  };
  const dir = path.join(workspaceRoot, '.brownie', 'headless-journeys');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${checkpoint.journey_id}.json`), `${JSON.stringify(checkpoint, null, 2)}\n`);
  return {
    ...checkpoint,
    objective_fingerprint: objectiveFingerprint(objective)
  };
}

async function approve(runtime, taskId, approvalId, input = { query: 'bounded' }) {
  const approval = await runtime.request('mcp.tool.approve', {
    task_id: taskId,
    mode_id: 'reviewer',
    tool_id: 'mcp.github.search_code',
    input,
    approve: true,
    approval_id: approvalId
  });
  assert.equal(approval.status, 'approved', JSON.stringify(approval));
  assert.equal(approval.mcp_approval_binding.status, 'approved', JSON.stringify(approval));
  return approval.mcp_approval_binding;
}

function toolExecute(runtime, taskId, input = { query: 'bounded' }, timeoutMs = REQUEST_TIMEOUT_MS) {
  return runtime.request('tool.execute', {
    task_id: taskId,
    mode_id: 'reviewer',
    tool_id: 'mcp.github.search_code',
    input
  }, timeoutMs);
}

function runDir(workspaceRoot, runId) {
  return path.join(workspaceRoot, '.brownie', 'runs', runId);
}

function lockPath(workspaceRoot, runId, approvalFingerprint) {
  const lockName = approvalFingerprint.slice('sha256:'.length);
  return path.join(runDir(workspaceRoot, runId), `mcp-approval-${lockName}.lock`);
}

function ledgerPath(workspaceRoot, runId) {
  return path.join(runDir(workspaceRoot, runId), 'ledger.jsonl');
}

function readLedger(workspaceRoot, runId) {
  const body = fs.readFileSync(ledgerPath(workspaceRoot, runId), 'utf8').trim();
  if (!body) {
    return [];
  }
  return body.split('\n').map((line) => JSON.parse(line));
}

function mcpApprovalPayloads(workspaceRoot, runId) {
  return readLedger(workspaceRoot, runId)
    .filter((event) => event.kind === 'McpToolExecutionApproved')
    .map((event) => event.payload);
}

function mcpApprovalStates(workspaceRoot, runId) {
  return mcpApprovalPayloads(workspaceRoot, runId).map((payload) => payload.status);
}

function appendLedgerEvent(workspaceRoot, runId, taskId, kind, payload) {
  fs.mkdirSync(runDir(workspaceRoot, runId), { recursive: true });
  const event = {
    event_id: `event_rrp3_${crypto.randomUUID()}`,
    task_id: taskId,
    run_id: runId,
    kind,
    timestamp: timestamp(),
    payload
  };
  fs.appendFileSync(ledgerPath(workspaceRoot, runId), `${JSON.stringify(event)}\n`);
}

function approvalStatePayload(approvalBinding, status, outcome, outcomeFingerprint = null) {
  const payload = {
    ...approvalBinding,
    status
  };
  if (outcome) {
    payload.outcome = outcome;
  }
  if (outcomeFingerprint) {
    payload.outcome_fingerprint = outcomeFingerprint;
  }
  payload.approval_state_fingerprint = sha256(canonicalJson({
    version: 'mcp_tool_approval_state_v1',
    approval_fingerprint: approvalBinding.approval_fingerprint ?? '',
    status,
    outcome: outcome ?? null,
    outcome_fingerprint: outcomeFingerprint
  }));
  return payload;
}

async function recoveryProbe(runtime, checkpoint) {
  return runtime.request('headless.run.recovery_probe', {
    authorize_recovery_probe: true,
    session_id: checkpoint.session_id,
    drive_id: checkpoint.drive_id,
    journey_id: checkpoint.journey_id,
    objective_fingerprint: checkpoint.objective_fingerprint
  });
}

function callCount(workspaceRoot) {
  const logPath = path.join(workspaceRoot, 'mcp-count.log');
  if (!fs.existsSync(logPath)) {
    return 0;
  }
  return fs.readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line === 'tools/call:search_code')
    .length;
}

async function staleLockDoesNotBlock(runtimeBinary) {
  const scenario = await setupScenario(runtimeBinary, 'counting', 'RRP-3 stale lock convergence');
  const approvalBinding = await approve(scenario.runtime, scenario.taskId, 'rrp3-stale-lock');
  const staleLockPath = lockPath(scenario.workspaceRoot, scenario.runId, approvalBinding.approval_fingerprint);
  fs.writeFileSync(staleLockPath, 'legacy-stale-create-new-lock\n');
  await scenario.runtime.stop();

  const restarted = startRuntime(runtimeBinary, scenario.workspaceRoot);
  const executed = await toolExecute(restarted, scenario.taskId);
  assert.equal(executed.status, 'Completed');
  assert.equal(callCount(scenario.workspaceRoot), 1);
  assert.deepEqual(mcpApprovalStates(scenario.workspaceRoot, scenario.runId), ['approved', 'executing', 'consumed']);
  assert.equal(fs.existsSync(staleLockPath), true, 'residual lock file is not durable authority');
  await restarted.stop();
}

async function executingWithoutCallRecovers(runtimeBinary) {
  const scenario = await setupScenario(runtimeBinary, 'counting', 'RRP-3 executing before spawn recovery');
  const approvalBinding = await approve(scenario.runtime, scenario.taskId, 'rrp3-executing-before-spawn');
  appendLedgerEvent(
    scenario.workspaceRoot,
    scenario.runId,
    scenario.taskId,
    'McpToolExecutionApproved',
    approvalStatePayload(approvalBinding, 'executing', 'tools_call_claimed')
  );
  fs.writeFileSync(lockPath(scenario.workspaceRoot, scenario.runId, approvalBinding.approval_fingerprint), 'legacy-stale-create-new-lock\n');
  await scenario.runtime.stop();

  const restarted = startRuntime(runtimeBinary, scenario.workspaceRoot);
  const probe = await recoveryProbe(restarted, scenario.checkpoint);
  assert.equal(probe.admission_state, 'persisted');
  assert.deepEqual(mcpApprovalStates(scenario.workspaceRoot, scenario.runId), ['approved', 'executing', 'outcome_unknown']);
  const denied = await toolExecute(restarted, scenario.taskId);
  assert.equal(denied.status, 'Denied');
  assert.match(denied.output.reason, /outcome_unknown/);
  assert.equal(callCount(scenario.workspaceRoot), 0);
  await recoveryProbe(restarted, scenario.checkpoint);
  assert.equal(mcpApprovalStates(scenario.workspaceRoot, scenario.runId).filter((state) => state === 'outcome_unknown').length, 1);
  await restarted.stop();
}

async function processLossDuringToolCallRecovers(runtimeBinary) {
  const scenario = await setupScenario(runtimeBinary, 'blocking', 'RRP-3 process loss during MCP call');
  await approve(scenario.runtime, scenario.taskId, 'rrp3-process-loss-during-call');
  const pendingExecution = toolExecute(scenario.runtime, scenario.taskId, { query: 'bounded' }, 30000)
    .catch((error) => error);
  await waitFor(
    () => fs.existsSync(path.join(scenario.workspaceRoot, 'mcp-call-received-blocking.pid')),
    'fake MCP tools/call receipt'
  );
  await waitFor(
    () => mcpApprovalStates(scenario.workspaceRoot, scenario.runId).includes('executing'),
    'durable executing approval state'
  );
  await scenario.runtime.stop('SIGKILL');
  fs.writeFileSync(path.join(scenario.workspaceRoot, 'release-call'), '1\n');
  await pendingExecution;

  const restarted = startRuntime(runtimeBinary, scenario.workspaceRoot);
  await recoveryProbe(restarted, scenario.checkpoint);
  assert.deepEqual(mcpApprovalStates(scenario.workspaceRoot, scenario.runId), ['approved', 'executing', 'outcome_unknown']);
  const denied = await toolExecute(restarted, scenario.taskId);
  assert.equal(denied.status, 'Denied');
  assert.match(denied.output.reason, /outcome_unknown/);
  assert.equal(callCount(scenario.workspaceRoot), 1);
  await recoveryProbe(restarted, scenario.checkpoint);
  assert.equal(mcpApprovalStates(scenario.workspaceRoot, scenario.runId).filter((state) => state === 'outcome_unknown').length, 1);
  await restarted.stop();
}

async function racingProcessesExecuteAtMostOnce(runtimeBinary) {
  const scenario = await setupScenario(runtimeBinary, 'blocking', 'RRP-3 independent process race');
  await approve(scenario.runtime, scenario.taskId, 'rrp3-race');
  const peer = startRuntime(runtimeBinary, scenario.workspaceRoot);
  const first = toolExecute(scenario.runtime, scenario.taskId, { query: 'bounded' }, 30000);
  const second = toolExecute(peer, scenario.taskId, { query: 'bounded' }, 30000);
  await waitFor(
    () => fs.existsSync(path.join(scenario.workspaceRoot, 'mcp-call-received-blocking.pid')),
    'race fake MCP tools/call receipt'
  );
  await waitFor(
    () => mcpApprovalStates(scenario.workspaceRoot, scenario.runId).includes('executing'),
    'race durable executing approval state'
  );
  fs.writeFileSync(path.join(scenario.workspaceRoot, 'release-call'), '1\n');
  const results = await Promise.all([first, second]);
  const statuses = results.map((result) => result.status).sort();
  assert.deepEqual(statuses, ['Completed', 'Denied']);
  assert.equal(callCount(scenario.workspaceRoot), 1);
  assert.deepEqual(mcpApprovalStates(scenario.workspaceRoot, scenario.runId), ['approved', 'executing', 'consumed']);
  await peer.stop();
  await scenario.runtime.stop();
}

async function terminalConsumedStateDoesNotRerunAfterRestart(runtimeBinary) {
  const scenario = await setupScenario(runtimeBinary, 'counting', 'RRP-3 terminal replay safety');
  await approve(scenario.runtime, scenario.taskId, 'rrp3-terminal-replay');
  const executed = await toolExecute(scenario.runtime, scenario.taskId);
  assert.equal(executed.status, 'Completed');
  await scenario.runtime.stop('SIGKILL');

  const restarted = startRuntime(runtimeBinary, scenario.workspaceRoot);
  const denied = await toolExecute(restarted, scenario.taskId);
  assert.equal(denied.status, 'Denied');
  assert.match(denied.output.reason, /consumed/);
  assert.equal(callCount(scenario.workspaceRoot), 1);
  assert.deepEqual(mcpApprovalStates(scenario.workspaceRoot, scenario.runId), ['approved', 'executing', 'consumed']);
  await restarted.stop();
}

async function main() {
  const runtimeBinary = ensureRuntimeBinary();
  await staleLockDoesNotBlock(runtimeBinary);
  await executingWithoutCallRecovers(runtimeBinary);
  await processLossDuringToolCallRecovers(runtimeBinary);
  await racingProcessesExecuteAtMostOnce(runtimeBinary);
  await terminalConsumedStateDoesNotRerunAfterRestart(runtimeBinary);
  console.log('RRP-3 real process-loss recovery E2E passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
