export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
}

export interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: JsonRpcError;
}

export interface RuntimeStatusResult {
  name: string;
  version: string;
  status: string;
}

export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse<unknown> {
  if (!isRecord(value)) {
    return false;
  }

  if (value.jsonrpc !== '2.0' || typeof value.id !== 'number') {
    return false;
  }

  const hasResult = Object.prototype.hasOwnProperty.call(value, 'result');
  const hasError = Object.prototype.hasOwnProperty.call(value, 'error');
  if (!hasResult && !hasError) {
    return false;
  }

  if (hasError && !isJsonRpcError(value.error)) {
    return false;
  }

  return true;
}

export function isRuntimeStatusResult(value: unknown): value is RuntimeStatusResult {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.version === 'string' &&
    typeof value.status === 'string'
  );
}

function isJsonRpcError(value: unknown): value is JsonRpcError {
  return isRecord(value) && typeof value.code === 'number' && typeof value.message === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
