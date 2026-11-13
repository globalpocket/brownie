import { describe, expect, it } from 'vitest';
import { RuntimeClient } from '../runtime/runtimeClient';
import { RuntimeProcess } from '../runtime/runtimeProcess';
import type { RuntimeTransport } from '../runtime/runtimeProcess';
import type { JsonRpcRequest } from '../runtime/protocol';

const peer = "const readline = require('node:readline');\nconst delay = Number(process.argv[1]);\nreadline.createInterface({ input: process.stdin }).on('line', line => {\n  const request = JSON.parse(line);\n  const status = {\n    provider: 'OpenAiCompatible', enabled: true, model: 'synthetic-transport-fixture',\n    base_url: 'http://127.0.0.1:9/v1', reason: null, strict: true,\n    will_fallback_to_fake: false, llm_provider_access_allowed: true,\n    task_run_network_allowed: true, config_source: 'Default', active_profile: null,\n    budget: { max_prompt_chars: 20000, max_messages: 50, request_timeout_ms: 30000,\n      response_preview_chars: 1000 }, sensitive_guard: 'Block',\n  };\n  const health = {\n    provider: status.provider, config_source: status.config_source, active_profile: null,\n    enabled: true, attempted: true, healthy: true, model: status.model,\n    base_url: status.base_url, checked_at: '2026-11-12T00:00:00Z', latency_ms: delay,\n    status_code: 200, reason: null, diagnostics: [],\n  };\n  setTimeout(() => {\n    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id,\n      result: request.method === 'llm.status' ? status : health }) + '\\n');\n  }, request.method === 'llm.status' ? 0 : delay);\n});\n";

function observingPeer(delayMs: number) {
  const processTransport = new RuntimeProcess({ command: process.execPath,
    args: ['-e', peer, String(delayMs)], cwd: process.cwd() });
  const calls: { method: string; timeoutMs: number; params: unknown }[] = [];
  const transport: RuntimeTransport = { request(request, timeoutMs) {
    calls.push({ method: request.method, timeoutMs, params: request.params });
    return processTransport.request(request, timeoutMs);
  } };
  return { transport, calls };
}

describe('health timeout across the actual child-process transport', () => {
  it.concurrent('allows an explicit 30-second probe to respond after 11 seconds', async () => {
    const { transport, calls } = observingPeer(11_000);
    const result = await new RuntimeClient(transport).llmHealth({ allow_network: true, timeout_ms: 30_000 });
    expect(result.healthy).toBe(true);
    expect(calls).toEqual([{ method: 'llm.health', timeoutMs: 40_000,
      params: { allow_network: true, timeout_ms: 30_000 } }]);
  }, 20_000);
  it.concurrent('resolves the workspace budget before dispatch when timeout is omitted', async () => {
    const { transport, calls } = observingPeer(11_000);
    const result = await new RuntimeClient(transport).llmHealth({ allow_network: true });
    expect(result.healthy).toBe(true);
    expect(calls.map(call => call.method)).toEqual(['llm.status', 'llm.health']);
    expect(calls[1]).toEqual({ method: 'llm.health', timeoutMs: 40_000,
      params: { allow_network: true, timeout_ms: 30_000 } });
  }, 20_000);
  it.concurrent('preserves the ordinary transport deadline for other methods', async () => {
    const { transport } = observingPeer(600);
    await expect(new RuntimeClient(transport, 300).status()).rejects.toThrow(/timed out after 300ms/);
  });
  for (const timeout of [0, 999, 300_001, NaN, Infinity, 1000.5]) {
    it(`rejects invalid probe timeout ${timeout} before any request`, async () => {
      let dispatched = false;
      const transport: RuntimeTransport = { request() {
        dispatched = true;
        throw new Error('unexpected dispatch');
      } };
      await expect(new RuntimeClient(transport).llmHealth({ allow_network: false, timeout_ms: timeout }))
        .rejects.toThrow(/integer between 1000 and 300000/);
      expect(dispatched).toBe(false);
    });
  }
});
