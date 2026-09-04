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
const canonicalMapPath = resolve(__dirname, '../../../../docs/architecture/runtime-protocol-event-canonical-map.json');

interface SemanticProtocolContract {
  phase: string;
  method_contracts: Array<{
    method: string;
    param_type: string | null;
    result_type: string;
    request_schema: unknown;
    result_schema: unknown;
    request_schema_ref?: string | null;
    result_schema_ref?: string;
    request_recursive_schema_fingerprint?: string | null;
    result_recursive_schema_fingerprint?: string;
  }>;
  type_schemas: Record<string, {
    properties?: Record<string, unknown>;
    $defs?: Record<string, unknown>;
  }>;
  golden_fixtures: Record<string, unknown>;
  unknown_field_policy: {
    rust_public_params: Array<{ type: string; deny_unknown_fields: boolean }>;
  };
  durable_event_migration_coupling: {
    ledger_payload_envelope_type: string;
    ledger_payload_envelope_field: string;
    event_payload_schema_fingerprint_count: number;
    payload_schema_fixtures: Array<{
      ledger_event_kind: string;
      payload_schema_fingerprint: string;
      payload_instance_shape_fingerprint: string;
    }>;
  };
}

interface CanonicalProtocolMap {
  protocol_method_groups: Array<{ methods: string[] }>;
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

function readCanonicalMap(): CanonicalProtocolMap {
  return JSON.parse(readFileSync(canonicalMapPath, 'utf8')) as CanonicalProtocolMap;
}

describe('Runtime semantic protocol contract', () => {
  it('covers every explicit Runtime method from the canonical map', () => {
    const contract = readContract();
    const mappedMethods = new Set(readCanonicalMap().protocol_method_groups.flatMap((group) => group.methods));
    const contractedMethods = new Set(contract.method_contracts.map((method) => method.method));

    expect(contract.phase).toBe('RRP-5.15');
    expect(contractedMethods).toEqual(mappedMethods);
    expect(contract.method_contracts.every((method) => method.request_schema && method.result_schema)).toBe(true);
    expect(contract.method_contracts.every((method) => method.result_schema_ref === `#/type_schemas/${method.result_type}`)).toBe(true);
    expect(contract.method_contracts.every((method) => method.result_recursive_schema_fingerprint?.startsWith('shape-fnv1a64:'))).toBe(true);
    expect(contract.unknown_field_policy.rust_public_params.every((entry) => entry.deny_unknown_fields)).toBe(true);
  });

  it('exposes recursive nested schemas for complex Runtime results', () => {
    const contract = readContract();
    const replaceActive = contract.type_schemas.ModePackReplaceActiveResult;

    expect(replaceActive.$defs?.ModePackActiveSnapshotSummary).toBeTruthy();
    expect(replaceActive.$defs?.ModePackApprovedCandidateSummary).toBeTruthy();
    expect(replaceActive.properties?.previous_snapshot).toMatchObject({
      $ref: '#/$defs/ModePackActiveSnapshotSummary',
    });
  });

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
    expect(fixtures.ledger_event_with_payload_envelope).toMatchObject({
      payload_envelope: {
        schema_version: 11,
        shape_id: 'ledger_payload.TaskCompleted.v11',
        schema_id: 'ledger_payload.TaskCompleted.v11',
        schema_fingerprint: expect.stringMatching(/^shape-fnv1a64:/),
        instance_shape_fingerprint: expect.stringMatching(/^shape-fnv1a64:/),
      },
    });
  });

  it('records durable ledger payload shape migration coupling', () => {
    const coupling = readContract().durable_event_migration_coupling;

    expect(coupling.ledger_payload_envelope_type).toBe('LedgerPayloadEnvelope');
    expect(coupling.ledger_payload_envelope_field).toBe('payload_envelope');
    expect(coupling.event_payload_schema_fingerprint_count).toBeGreaterThan(0);
    const taskCompleted = coupling.payload_schema_fixtures.filter((fixture) => fixture.ledger_event_kind === 'TaskCompleted');
    expect(new Set(taskCompleted.map((fixture) => fixture.payload_schema_fingerprint)).size).toBe(1);
    expect(new Set(taskCompleted.map((fixture) => fixture.payload_instance_shape_fingerprint)).size).toBeGreaterThan(1);
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
