import { describe, expect, it } from 'vitest';
import { RuntimeClient } from '../runtime/runtimeClient';
import { RuntimeProcess, type RuntimeTransport } from '../runtime/runtimeProcess';
import type { JsonRpcRequest, JsonRpcResponse } from '../runtime/protocol';

const taskResult = {
  task_id: 'task_transport_fixture', run_id: 'run_transport_fixture', status: 'Completed',
  agent_loop: { final_state: 'Completed', completion_summary: 'Synthetic peer response; no Runtime or LLM task executed.' },
};

function providerStatus(requestTimeoutMs: number) {
  return {
    provider: 'Fake', enabled: true, model: 'brownie-fake-llm', strict: false,
    will_fallback_to_fake: false, llm_provider_access_allowed: false,
    task_run_network_allowed: false, config_source: 'Default', sensitive_guard: 'warn',
    budget: { max_prompt_chars: 120000, max_messages: 64, request_timeout_ms: requestTimeoutMs, response_preview_chars: 2000 },
  };
}

class ObservedTransport implements RuntimeTransport {
  readonly calls: { request: JsonRpcRequest; timeoutMs: number }[] = [];
  constructor(readonly providerTimeoutMs: number) {}
  async request<T>(request: JsonRpcRequest, timeoutMs: number): Promise<JsonRpcResponse<T>> {
    this.calls.push({ request, timeoutMs });
    const result = request.method === 'llm.status' ? providerStatus(this.providerTimeoutMs)
      : request.method === 'runtime.status' ? { name: 'brownie-runtime', version: 'fixture', status: 'ok' } : taskResult;
    return { jsonrpc: '2.0', id: request.id, result } as JsonRpcResponse<T>;
  }
}

describe('task.run transport deadline', () => {
  it('covers both provider passes without clamping configured budgets to the old ten seconds', async () => {
    for (const [providerTimeoutMs, expectedTransportMs] of [[1000, 12000], [30000, 70000], [300000, 610000]]) {
      const transport = new ObservedTransport(providerTimeoutMs);
      await expect(new RuntimeClient(transport).runTask(taskResult.task_id)).resolves.toEqual(taskResult);
      expect(transport.calls.map(c => [c.request.method, c.timeoutMs])).toEqual([
        ['llm.status', 10000], ['task.run', expectedTransportMs],
      ]);
      expect(transport.calls[1].request.params).toEqual({ task_id: taskResult.task_id });
    }
  });

  it('retains the caller RPC allowance and leaves unrelated RPC deadlines unchanged', async () => {
    const transport = new ObservedTransport(1000);
    const client = new RuntimeClient(transport, 17);
    await client.status();
    await client.runTask(taskResult.task_id);
    expect(transport.calls.map(c => [c.request.method, c.timeoutMs])).toEqual([
      ['runtime.status', 17], ['llm.status', 17], ['task.run', 2017],
    ]);
  });

  it('rejects malformed or out-of-contract provider budgets before dispatching task.run', async () => {
    for (const budget of [-1, 0, 999, 1000.5, 300001, Number.POSITIVE_INFINITY]) {
      const transport = new ObservedTransport(budget);
      await expect(new RuntimeClient(transport).runTask(taskResult.task_id)).rejects.toThrow();
      expect(transport.calls.map(c => c.request.method)).toEqual(['llm.status']);
    }
  });

  it('does not let timer overflow turn a long transport allowance into a one-millisecond timer', async () => {
    const transport = new ObservedTransport(300000);
    await expect(new RuntimeClient(transport, 2_147_483_647).runTask(taskResult.task_id))
      .rejects.toThrow('supported finite timer range');
    expect(transport.calls.map(c => c.request.method)).toEqual(['llm.status']);
  });

  it('does not dispatch task.run after a failed provider-status lookup', async () => {
    const calls: string[] = [];
    const transport: RuntimeTransport = {
      async request<T>(request: JsonRpcRequest): Promise<JsonRpcResponse<T>> {
        calls.push(request.method);
        return { jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'status unavailable' } };
      },
    };
    await expect(new RuntimeClient(transport).runTask(taskResult.task_id)).rejects.toThrow('status unavailable');
    expect(calls).toEqual(['llm.status']);
  });

  it('retains task.run result validation after the preliminary status response', async () => {
    class InvalidResult extends ObservedTransport {
      override async request<T>(request: JsonRpcRequest, timeoutMs: number): Promise<JsonRpcResponse<T>> {
        const result = await super.request<T>(request, timeoutMs);
        return request.method === 'task.run'
          ? { jsonrpc: '2.0', id: request.id, result: { status: 'invented' } as T } : result;
      }
    }
    await expect(new RuntimeClient(new InvalidResult(30000)).runTask(taskResult.task_id))
      .rejects.toThrow('task.run returned an invalid result');
  });

  it('receives an actual child-process response delayed beyond the old ten-second deadline', async () => {
    const peer = `const readline=require('node:readline');
      readline.createInterface({input:process.stdin}).on('line',line=>{
        const r=JSON.parse(line);
        const result=r.method==='llm.status'?${JSON.stringify(providerStatus(30000))}:${JSON.stringify(taskResult)};
        setTimeout(()=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n'),
          r.method==='task.run'?11000:0);
      });`;
    const actual = new RuntimeProcess({ command: process.execPath, args: ['-e', peer], cwd: process.cwd() });
    const calls: { method: string; timeoutMs: number }[] = [];
    const transport: RuntimeTransport = {
      request<T>(request: JsonRpcRequest, timeoutMs: number) {
        calls.push({ method: request.method, timeoutMs });
        return actual.request<T>(request, timeoutMs);
      },
    };
    const started = performance.now();
    await expect(new RuntimeClient(transport).runTask(taskResult.task_id)).resolves.toEqual(taskResult);
    const elapsedMs = performance.now() - started;
    expect(elapsedMs).toBeGreaterThanOrEqual(11000);
    expect(calls).toEqual([{ method: 'llm.status', timeoutMs: 10000 }, { method: 'task.run', timeoutMs: 70000 }]);
    console.log('TASK_RUN_TRANSPORT_OBSERVATION:' + JSON.stringify({
      peer_delay_ms: 11000, elapsed_ms: elapsedMs, calls, response_received: true,
      actual_child_process_transport: true, actual_Runtime_or_LLM_task_executed: false,
    }));
  }, 25000);
});
