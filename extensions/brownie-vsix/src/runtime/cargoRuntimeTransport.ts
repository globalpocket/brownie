import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { JsonRpcRequest, JsonRpcResponse } from './protocol';
import { RuntimeProcess } from './runtimeProcess';
import type { RuntimeTransport } from './runtimeProcess';

const BUILD_TIMEOUT_MS = 600_000;
const BUILD_OUTPUT_LIMIT = 8 * 1024 * 1024;

/** Cargo preparation has its own bound; Runtime RPC deadlines start afterwards. */
export class CargoRuntimeTransport implements RuntimeTransport {
  private readonly preparations = new Map<string, Promise<string>>();

  constructor(private readonly workspaceRoot: () => string) {}

  async request<T>(request: JsonRpcRequest, timeoutMs: number): Promise<JsonRpcResponse<T>> {
    const cwd = fs.realpathSync(this.workspaceRoot());
    let preparation = this.preparations.get(cwd);
    if (preparation === undefined) {
      preparation = this.prepare(cwd);
      this.preparations.set(cwd, preparation);
    }
    let executable: string;
    try {
      executable = await preparation;
    } finally {
      if (this.preparations.get(cwd) === preparation) this.preparations.delete(cwd);
    }
    return new RuntimeProcess({ command: executable, args: [], cwd }).request<T>(request, timeoutMs);
  }

  private prepare(cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = cp.spawn('cargo', ['build', '--locked', '-q', '-p', 'brownie-runtime', '--message-format=json'], {
        cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
        detached: process.platform !== 'win32',
      });
      let stdout = '';
      let stderr = '';
      let bytes = 0;
      let settled = false;
      const timer = setTimeout(() => fail(new Error(`cargo build timed out after ${BUILD_TIMEOUT_MS}ms`)), BUILD_TIMEOUT_MS);
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (child.pid !== undefined) {
          if (process.platform === 'win32') {
            cp.spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
          } else {
            try { process.kill(-child.pid, 'SIGKILL'); } catch { /* The owned build group already exited. */ }
          }
        }
        reject(error);
      };
      const collect = (stream: 'stdout' | 'stderr', chunk: string): void => {
        if (settled) return;
        bytes += Buffer.byteLength(chunk, 'utf8');
        if (bytes > BUILD_OUTPUT_LIMIT) {
          fail(new Error('cargo build output exceeded its bounded buffer'));
          return;
        }
        if (stream === 'stdout') stdout += chunk;
        else stderr += chunk;
      };
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => collect('stdout', chunk));
      child.stderr.on('data', (chunk: string) => collect('stderr', chunk));
      child.once('error', fail);
      child.once('close', (code, signal) => {
        if (settled) return;
        if (code !== 0 || signal !== null) {
          fail(new Error(`cargo build failed (${code ?? signal ?? 'unknown'}): ${stderr.trim()}`));
          return;
        }
        try {
          const executables = new Set<string>();
          let finished = false;
          for (const line of stdout.split('\n').filter(line => line.trim())) {
            const value: unknown = JSON.parse(line);
            if (typeof value !== 'object' || value === null) throw new Error('invalid Cargo record');
            const record = value as Record<string, unknown>;
            if (record.reason === 'build-finished') finished = record.success === true;
            if (record.reason !== 'compiler-artifact' || typeof record.target !== 'object' || record.target === null) continue;
            const target = record.target as Record<string, unknown>;
            if (target.name === 'brownie-runtime' && Array.isArray(target.kind) && target.kind.includes('bin') &&
                record.manifest_path === path.join(cwd, 'crates', 'brownie-runtime', 'Cargo.toml') &&
                typeof record.executable === 'string' && path.isAbsolute(record.executable)) {
              executables.add(record.executable);
            }
          }
          const executable = [...executables][0];
          if (!finished || executables.size !== 1 || !fs.statSync(executable).isFile()) {
            throw new Error('successful build with one existing Runtime executable required');
          }
          settled = true;
          clearTimeout(timer);
          resolve(executable);
        } catch (error) {
          fail(new Error(`cargo build artifact evidence rejected: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
    });
  }
}
