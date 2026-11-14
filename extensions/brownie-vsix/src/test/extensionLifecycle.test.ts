import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import type * as ExtensionModule from '../extension';

const runtimeRequire = createRequire(path.join(process.cwd(), 'package.json'));
const extensionPath = path.join(process.cwd(), 'dist', 'extension.js');

beforeAll(() => {
  // Execute the actual compiled entrypoint, including its normal Runtime factory.
  execFileSync(process.execPath, [runtimeRequire.resolve('typescript/bin/tsc'), '-p', '.'], {
    cwd: process.cwd(), timeout: 30_000, stdio: 'pipe',
  });
}, 35_000);

type Disposable = { dispose(): void };
type Context = { subscriptions: Disposable[] };
type CompiledExtension = typeof ExtensionModule;

function withCompiledExtension(run: (extension: CompiledExtension, host: ReturnType<typeof commandHost>) => void): void {
  const host = commandHost();
  const modules = runtimeRequire('node:module') as { _load: (...args: unknown[]) => unknown };
  const processes = runtimeRequire('node:child_process') as { spawn: (...args: unknown[]) => unknown };
  const originalLoad = modules._load;
  const originalSpawn = processes.spawn;
  modules._load = function (this: unknown, ...args: unknown[]): unknown {
    return args[0] === 'vscode' ? host.api : Reflect.apply(originalLoad, this, args);
  };
  processes.spawn = () => { throw new Error('Activation must not execute a Runtime process'); };
  delete runtimeRequire.cache[runtimeRequire.resolve(extensionPath)];
  try {
    run(runtimeRequire(extensionPath) as CompiledExtension, host);
  } finally {
    modules._load = originalLoad;
    processes.spawn = originalSpawn;
    for (const item of host.handles) item.dispose();
  }
}

function commandHost() {
  const active = new Set<string>();
  const registered: string[] = [];
  const handles: Disposable[] = [];
  const api = {
    commands: {
      registerCommand(id: string, callback: unknown): Disposable {
        if (typeof callback !== 'function' || active.has(id)) throw new Error(`Command already registered: ${id}`);
        active.add(id); registered.push(id);
        let disposed = false;
        const handle = { dispose() { if (!disposed) { disposed = true; active.delete(id); } } };
        handles.push(handle);
        return handle;
      },
    },
    window: { createOutputChannel() { return { appendLine() {}, show() {}, dispose() {} }; } },
    workspace: { workspaceFolders: [] },
  };
  return { api, active, registered, handles };
}

function disposeContext(context: Context): void {
  for (const item of context.subscriptions) item.dispose();
}

function activateContext(extension: CompiledExtension, context: Context): void {
  // The synthetic host supplies only the context field used by activation.
  extension.activate(context as Parameters<CompiledExtension['activate']>[0]);
}

describe('compiled extension command lifecycle', () => {
  it('disposes every registered command through the actual context lifecycle', () => {
    withCompiledExtension((extension, host) => {
      const context: Context = { subscriptions: [] };
      activateContext(extension, context);
      expect(host.registered).toContain('brownie.runtimeDiagnostics');
      expect(host.active.size).toBe(host.registered.length);
      disposeContext(context);
      extension.deactivate();
      expect([...host.active]).toEqual([]);
    });
  });

  it('can activate again after disposal without retaining a duplicate command', () => {
    withCompiledExtension((extension, host) => {
      const first: Context = { subscriptions: [] };
      activateContext(extension, first);
      const firstCount = host.registered.length;
      disposeContext(first);
      extension.deactivate();
      const second: Context = { subscriptions: [] };
      expect(() => activateContext(extension, second)).not.toThrow();
      expect(host.registered.length).toBe(firstCount * 2);
      disposeContext(second);
      extension.deactivate();
      expect([...host.active]).toEqual([]);
    });
  });
});
