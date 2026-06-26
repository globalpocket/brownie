import type { JsonRpcError } from './protocol';

export class RuntimeProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeProtocolError';
  }
}

export class RuntimeJsonRpcError extends Error {
  constructor(readonly rpcError: JsonRpcError) {
    super(`runtime error ${rpcError.code}: ${rpcError.message}`);
    this.name = 'RuntimeJsonRpcError';
  }
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function stderrMessage(stderr: string): string {
  const trimmed = stderr.trim();
  return trimmed.length > 0 ? `; stderr: ${trimmed}` : '';
}
