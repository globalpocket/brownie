import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { PassThrough } from 'node:stream';
import * as cp from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CargoRuntimeTransport } from '../runtime/cargoRuntimeTransport';
import type { JsonRpcRequest } from '../runtime/protocol';

const observed = vi.hoisted(() => ({ construct: vi.fn(), request: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: vi.fn(), spawnSync: vi.fn() }));
vi.mock('../runtime/runtimeProcess', () => ({
  RuntimeProcess: class {
    constructor(options: unknown) { observed.construct(options); }
    request(...args: unknown[]) { return observed.request(...args); }
  },
}));

function build(pid: number | undefined = undefined) {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), pid });
  vi.mocked(cp.spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof cp.spawn>);
  return child;
}
const cwd = fs.realpathSync(process.cwd());
const request: JsonRpcRequest = { jsonrpc: '2.0', id: 1, method: 'runtime.status' };
function artifact(executable = process.execPath, manifest = path.join(cwd, 'crates', 'brownie-runtime', 'Cargo.toml')) {
  return { reason: 'compiler-artifact', manifest_path: manifest,
    target: { name: 'brownie-runtime', kind: ['bin'] }, executable };
}
function finish(child: ReturnType<typeof build>, records: unknown[] = [artifact(), { reason: 'build-finished', success: true }]) {
  child.stdout.write(records.map(r => JSON.stringify(r)).join('\n') + '\n');
  child.emit('close', 0, null);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  observed.request.mockResolvedValue({ jsonrpc: '2.0', id: 1, result: { status: 'Ready' } });
});
afterEach(() => { vi.useRealTimers(); });

describe('Cargo preparation before the Runtime response deadline', () => {
  it('waits through an eleven-second preparation before starting the ordinary short RPC', async () => {
    const child = build();
    const result = new CargoRuntimeTransport(() => cwd).request(request, 300);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(observed.construct).not.toHaveBeenCalled();
    expect(observed.request).not.toHaveBeenCalled();
    finish(child);
    await expect(result).resolves.toMatchObject({ result: { status: 'Ready' } });
    expect(observed.construct).toHaveBeenCalledWith({ command: process.execPath, args: [], cwd });
    expect(observed.request).toHaveBeenCalledWith(request, 300);
  });

  it('uses Cargo artifact evidence for custom output directories instead of guessing target/debug', async () => {
    const child = build();
    const result = new CargoRuntimeTransport(() => cwd).request(request, 10_000);
    finish(child);
    await result;
    expect(observed.construct.mock.calls[0][0].command).toBe(process.execPath);
    expect(vi.mocked(cp.spawn).mock.calls[0][1]).toEqual(['build', '--locked', '-q', '-p', 'brownie-runtime', '--message-format=json']);
  });

  it('shares in-flight preparation and rechecks source on the next request', async () => {
    const transport = new CargoRuntimeTransport(() => cwd);
    const first = build();
    const requests = [transport.request(request, 300), transport.request({ ...request, id: 2 }, 300)];
    expect(cp.spawn).toHaveBeenCalledTimes(1);
    finish(first); await Promise.all(requests);
    const next = build(); const again = transport.request(request, 300);
    expect(cp.spawn).toHaveBeenCalledTimes(2);
    finish(next); await again;
  });

  it('does not launch or reuse a stale executable after a failed build', async () => {
    const child = build(); const result = new CargoRuntimeTransport(() => cwd).request(request, 300);
    child.stdout.write(JSON.stringify(artifact()) + '\n');
    child.stderr.write('compile failed'); child.emit('close', 101, null);
    await expect(result).rejects.toThrow(/cargo build failed \(101\): compile failed/);
    expect(observed.construct).not.toHaveBeenCalled();
  });

  for (const [name, records] of [
    ['missing artifact', [{ reason: 'build-finished', success: true }]],
    ['ambiguous artifact', [artifact(), artifact(path.resolve(cwd, 'other-runtime')), { reason: 'build-finished', success: true }]],
    ['other manifest', [artifact(process.execPath, path.join(cwd, 'other', 'Cargo.toml')), { reason: 'build-finished', success: true }]],
    ['no successful build-finished', [artifact(), { reason: 'build-finished', success: false }]],
  ] as const) {
    it(`rejects ${name} without starting Runtime`, async () => {
      const child = build(); const result = new CargoRuntimeTransport(() => cwd).request(request, 300);
      finish(child, [...records]);
      await expect(result).rejects.toThrow(/artifact evidence rejected/);
      expect(observed.construct).not.toHaveBeenCalled();
    });
  }

  it('retains a finite preparation deadline and permits a later explicit retry', async () => {
    const transport = new CargoRuntimeTransport(() => cwd); build();
    const result = transport.request(request, 300);
    const rejected = expect(result).rejects.toThrow(/cargo build timed out after 600000ms/);
    await vi.advanceTimersByTimeAsync(600_001); await rejected;
    expect(observed.construct).not.toHaveBeenCalled();
    const child = build(); const retry = transport.request(request, 300); finish(child); await retry;
  });

  it('rejects malformed or excessive compiler output before Runtime execution', async () => {
    const invalid = build(); const transport = new CargoRuntimeTransport(() => cwd);
    const malformed = transport.request(request, 300);
    invalid.stdout.write('not-json\n'); invalid.emit('close', 0, null);
    await expect(malformed).rejects.toThrow(/artifact evidence rejected/);
    const excessive = build(); const bounded = transport.request(request, 300);
    excessive.stdout.write('x'.repeat(8 * 1024 * 1024 + 1));
    await expect(bounded).rejects.toThrow(/bounded buffer/);
    expect(observed.construct).not.toHaveBeenCalled();
  });

  it('decodes artifact paths when a UTF-8 character straddles output chunks', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brownie-cargo-artifact-'));
    const executable = path.join(directory, '\u5b9f\u884c-runtime');
    fs.writeFileSync(executable, 'synthetic path-only artifact fixture');
    try {
      const child = build(); const result = new CargoRuntimeTransport(() => cwd).request(request, 300);
      const bytes = Buffer.from(JSON.stringify(artifact(executable)) + '\n' + JSON.stringify({ reason: 'build-finished', success: true }) + '\n');
      const split = bytes.indexOf(Buffer.from('\u5b9f')) + 1;
      child.stdout.write(bytes.subarray(0, split)); child.stdout.write(bytes.subarray(split));
      child.emit('close', 0, null); await result;
      expect(observed.construct.mock.calls[0][0].command).toBe(executable);
    } finally { fs.rmSync(directory, { recursive: true }); }
  });

  it('terminates its own build group on preparation timeout', async () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    try {
      build(424242); const result = new CargoRuntimeTransport(() => cwd).request(request, 300);
      const rejected = expect(result).rejects.toThrow(/cargo build timed out/);
      await vi.advanceTimersByTimeAsync(600_001); await rejected;
      if (process.platform === 'win32') expect(cp.spawnSync).toHaveBeenCalledWith('taskkill', ['/pid', '424242', '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
      else expect(kill).toHaveBeenCalledWith(-424242, 'SIGKILL');
      expect(observed.construct).not.toHaveBeenCalled();
    } finally { kill.mockRestore(); }
  });
});
