import { describe, expect, it } from 'vitest';
import { RuntimeJsonRpcError } from '../runtime/errors';
import { isJsonRpcResponse, isRuntimeStatusResult, type JsonRpcRequest, type JsonRpcResponse } from '../runtime/protocol';
import { RuntimeClient } from '../runtime/runtimeClient';
import type { RuntimeTransport } from '../runtime/runtimeProcess';

class FakeTransport implements RuntimeTransport {
  requests: JsonRpcRequest[] = [];

  constructor(private readonly response: JsonRpcResponse<unknown>) {}

  async request<T>(request: JsonRpcRequest): Promise<JsonRpcResponse<T>> {
    this.requests.push(request);
    return this.response as JsonRpcResponse<T>;
  }
}

describe('protocol validation', () => {
  it('accepts a valid JSON-RPC response', () => {
    expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1, result: { ok: true } })).toBe(true);
  });

  it('rejects invalid JSON-RPC response shapes', () => {
    expect(isJsonRpcResponse(null)).toBe(false);
    expect(isJsonRpcResponse({ jsonrpc: '2.0', result: {} })).toBe(false);
    expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1 })).toBe(false);
    expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1, error: { code: '1', message: 'bad' } })).toBe(false);
  });

  it('accepts runtime.status results with string fields', () => {
    expect(isRuntimeStatusResult({ name: 'brownie-runtime', version: '0.1.0', status: 'Ready' })).toBe(true);
  });
});

describe('RuntimeClient', () => {
  it('creates a runtime.status request', async () => {
    const transport = new FakeTransport({
      jsonrpc: '2.0',
      id: 1,
      result: { name: 'brownie-runtime', version: '0.1.0', status: 'Ready' },
    });
    const client = new RuntimeClient(transport);

    await expect(client.status()).resolves.toEqual({
      name: 'brownie-runtime',
      version: '0.1.0',
      status: 'Ready',
    });
    expect(transport.requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'runtime.status' }]);
  });

  it('converts JSON-RPC error responses into exceptions', async () => {
    const transport = new FakeTransport({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32601, message: 'method not found' },
    });
    const client = new RuntimeClient(transport);

    await expect(client.status()).rejects.toBeInstanceOf(RuntimeJsonRpcError);
  });
});
