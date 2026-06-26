import * as cp from 'node:child_process';
import * as readline from 'node:readline';
import { formatError, RuntimeProtocolError, stderrMessage } from './errors';
import type { JsonRpcRequest, JsonRpcResponse } from './protocol';
import { isJsonRpcResponse } from './protocol';

export interface RuntimeProcessOptions {
  command: string;
  args: string[];
  cwd: string | (() => string);
}

export interface RuntimeTransport {
  request<T>(request: JsonRpcRequest, timeoutMs: number): Promise<JsonRpcResponse<T>>;
}

export class RuntimeProcess implements RuntimeTransport {
  constructor(private readonly options: RuntimeProcessOptions) {}

  request<T>(request: JsonRpcRequest, timeoutMs: number): Promise<JsonRpcResponse<T>> {
    return new Promise<JsonRpcResponse<T>>((resolve, reject) => {
      const child = cp.spawn(this.options.command, this.options.args, {
        cwd: this.cwd(),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let settled = false;
      let stderr = '';

      const timeout = setTimeout(() => {
        settleWithError(new Error(`timed out after ${timeoutMs}ms waiting for brownie-runtime`));
      }, timeoutMs);

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });

      child.on('error', (error) => {
        settleWithError(error);
      });

      child.on('exit', (code, signal) => {
        if (!settled && code !== 0) {
          settleWithError(
            new Error(`brownie-runtime exited with code ${code ?? 'unknown'} signal ${signal ?? 'none'}`),
          );
        }
      });

      const lines = readline.createInterface({ input: child.stdout });
      lines.on('line', (line) => {
        try {
          const parsed: unknown = JSON.parse(line);
          if (!isJsonRpcResponse(parsed)) {
            throw new RuntimeProtocolError(`unexpected JSON-RPC response shape: ${line}`);
          }
          if (parsed.id !== request.id) {
            return;
          }
          settleWithValue(parsed as JsonRpcResponse<T>);
        } catch (error) {
          settleWithError(error);
        }
      });

      lines.on('close', () => {
        if (!settled) {
          settleWithError(new Error('brownie-runtime stdout closed before matching response'));
        }
      });

      child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
        if (error !== undefined && error !== null) {
          settleWithError(error);
          return;
        }
        child.stdin.end();
      });

      function settleWithValue(response: JsonRpcResponse<T>): void {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        lines.close();
        child.kill();
        resolve(response);
      }

      function settleWithError(error: unknown): void {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        lines.close();
        child.kill();
        reject(new Error(`${formatError(error)}${stderrMessage(stderr)}`));
      }
    });
  }

  private cwd(): string {
    return typeof this.options.cwd === 'function' ? this.options.cwd() : this.options.cwd;
  }
}
