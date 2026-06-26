import { RuntimeJsonRpcError, RuntimeProtocolError } from './errors';
import type { JsonRpcRequest, RuntimeStatusResult } from './protocol';
import { isRuntimeStatusResult } from './protocol';
import type { RuntimeTransport } from './runtimeProcess';

const DEFAULT_TIMEOUT_MS = 10_000;

export class RuntimeClient {
  private nextId = 1;

  constructor(
    private readonly transport: RuntimeTransport,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async status(): Promise<RuntimeStatusResult> {
    const response = await this.send<RuntimeStatusResult>('runtime.status');

    if (response.error !== undefined) {
      throw new RuntimeJsonRpcError(response.error);
    }

    if (!isRuntimeStatusResult(response.result)) {
      throw new RuntimeProtocolError('runtime.status returned an invalid result');
    }

    return response.result;
  }

  private send<T>(method: string, params?: unknown) {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.nextId,
      method,
    };
    this.nextId += 1;

    if (params !== undefined) {
      request.params = params;
    }

    return this.transport.request<T>(request, this.timeoutMs);
  }
}
