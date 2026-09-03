import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  isHeadlessRunDriveParams,
  isJsonRpcResponse,
  isLedgerEventSummary,
  isTaskCancelParams,
  isTaskCancelResult,
  isTaskRunParams,
  isTaskStartParams,
  isTaskStartResult,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from '../runtime/protocol';
import { RuntimeClient } from '../runtime/runtimeClient';
import type { RuntimeTransport } from '../runtime/runtimeProcess';

const contractPath = resolve(__dirname, '../../../../docs/architecture/runtime-semantic-protocol-contract.json');

interface SemanticProtocolContract {
  golden_fixtures: Record<string, unknown>;
}

class SemanticContractTransport implements RuntimeTransport {
  readonly requests: JsonRpcRequest[] = [];

  constructor(private readonly response: JsonRpcResponse<unknown>) {}

  async request<T>(request: JsonRpcRequest): Promise<JsonRpcResponse<T>> {
    this.requests.push(request);
    return this.response as JsonRpcResponse<T>;
  }
}

function readContract(): SemanticProtocolContract {
  return JSON.parse(readFileSync(contractPath, 'utf8')) as SemanticProtocolContract;
}

describe('Runtime semantic protocol contract', () => {
  it('validates Rust semantic contract fixtures at the VSIX boundary', () => {
    const fixtures = readContract().golden_fixtures;

    expect(isTaskStartParams(fixtures.task_start_vsix_client_input)).toBe(true);
    expect(isTaskStartParams(fixtures.task_start_wire_params)).toBe(false);
    expect(isTaskStartResult(fixtures.task_start_result)).toBe(true);
    expect(isTaskCancelParams(fixtures.task_cancel_params)).toBe(true);
    expect(isTaskCancelResult(fixtures.task_cancel_result)).toBe(true);
    expect(isTaskRunParams(fixtures.task_run_minimal_params)).toBe(true);
    expect(isTaskRunParams(fixtures.task_run_explicit_null_params)).toBe(true);
    expect(isLedgerEventSummary(fixtures.ledger_event_summary)).toBe(true);
  });

  it('rejects unknown fields from semantic contract fixtures', () => {
    const fixtures = readContract().golden_fixtures;

    expect(isTaskStartParams({ ...(fixtures.task_start_vsix_client_input as object), unexpected: true })).toBe(false);
    expect(isTaskCancelParams({ ...(fixtures.task_cancel_params as object), unexpected: true })).toBe(false);
    expect(isTaskCancelResult({ ...(fixtures.task_cancel_result as object), unexpected: true })).toBe(false);
    expect(isTaskRunParams({ ...(fixtures.task_run_minimal_params as object), unexpected: true })).toBe(false);
    expect(isHeadlessRunDriveParams({
      authorize: true,
      session_id: 'session_1',
      drive_id: 'drive_1',
      unexpected: true,
    })).toBe(false);
  });

  it('projects VSIX camelCase task.start input to the Rust wire shape', async () => {
    const fixtures = readContract().golden_fixtures;
    const transport = new SemanticContractTransport({
      jsonrpc: '2.0',
      id: 1,
      result: fixtures.task_start_result,
    });

    await expect(new RuntimeClient(transport).startTask(fixtures.task_start_vsix_client_input as Parameters<RuntimeClient['startTask']>[0])).resolves.toEqual(fixtures.task_start_result);
    expect(transport.requests).toHaveLength(1);
    expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1, result: fixtures.task_start_result })).toBe(true);
    expect(transport.requests[0]).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      method: 'task.start',
      params: fixtures.task_start_wire_params,
    });
  });
});
