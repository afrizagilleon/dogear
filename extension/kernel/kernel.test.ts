/**
 * extension/kernel/kernel.test.ts
 * Unit tests for kernel execution service delegation to platform adapter (RQ-04, RQ-05, RQ-06, RQ-07, M2 A-1).
 */

import { describe, it, expect } from 'vitest';
import { kernelService } from './index';
import { NativeConnectionError, type PlatformAdapter, type ScriptExecutionOptions, type ScriptExecutionResult } from '../platform/interface';

function createMockPlatformAdapter(): PlatformAdapter {
  const store = {
    data: {} as Record<string, unknown>,
    refs: {} as Record<string, unknown>,
    lib: {} as Record<string, unknown>,
  };

  return {
    target: 'chrome',
    capabilities: { hasSidePanel: true, hasOffscreenDocument: true, hasUserScripts: true },
    sidePanel: { open: async () => {}, setOptions: async () => {}, setPanelBehavior: async () => {} },
    backgroundDom: { ensureContext: async () => true, hasContext: async () => true, closeContext: async () => {} },
    storage: {
      get: async () => undefined,
      set: async () => {},
      remove: async () => {},
      clear: async () => {},
      keys: async () => [],
    },
    scriptExecutor: {
      executeScript: async (options: ScriptExecutionOptions): Promise<ScriptExecutionResult> => {
        if (options.source === 'return 6 * 7;') {
          return { ok: true, result: 42, output: '42' };
        }
        if (options.source.includes('ctx.data.n = 7')) {
          store.data.n = 7;
          return { ok: true, result: 'written', output: 'written' };
        }
        if (options.source.includes('return ctx.data.n;')) {
          return { ok: true, result: store.data.n, output: String(store.data.n) };
        }
        if (options.source.includes('print(')) {
          return { ok: true, result: 100, output: 'a b\nc\n100' };
        }
        if (options.source.includes('throw new Error')) {
          return {
            ok: false,
            error: { name: 'Error', message: 'fail on line 3' },
            output: '✖ Error: fail on line 3\n  at eval (nb-cell-test-err.js:3:1)\n  3 | throw new Error("fail on line 3");',
          };
        }
        return { ok: true, result: undefined, output: '' };
      },
    },
    connectNative(hostName: string) {
      throw new NativeConnectionError(`connectNative tidak tersedia di mock kernel (${hostName})`, {
        cause: 'kernel.test mock tidak membuka port native',
        action: 'Suntikkan port tiruan ke nativeBridge.attachPort',
      });
    },
  };
}

describe('KernelExecutionService', () => {
  it('delegates execution to platform adapter and returns 42 (RQ-04)', async () => {
    const cell = {
      id: 'cell-1',
      source: 'return 6 * 7;',
    };
    const platform = createMockPlatformAdapter();

    const res = await kernelService.runCell(cell, { platformAdapter: platform });
    expect(res.ok).toBe(true);
    expect(res.result).toBe(42);
    expect(res.output).toBe('42');
  });

  it('persists ctx.data across sequential cell executions on platform (RQ-05)', async () => {
    const platform = createMockPlatformAdapter();
    const cellA = {
      id: 'cell-a',
      source: 'ctx.data.n = 7; return "written";',
    };
    const cellB = {
      id: 'cell-b',
      source: 'return ctx.data.n;',
    };

    const resA = await kernelService.runCell(cellA, { platformAdapter: platform });
    expect(resA.ok).toBe(true);
    expect(resA.result).toBe('written');

    const resB = await kernelService.runCell(cellB, { platformAdapter: platform });
    expect(resB.ok).toBe(true);
    expect(resB.result).toBe(7);
  });

  it('captures print output from platform execution (RQ-06)', async () => {
    const platform = createMockPlatformAdapter();
    const cell = {
      id: 'cell-print',
      source: 'print("a", "b"); print("c"); return 100;',
    };

    const res = await kernelService.runCell(cell, { platformAdapter: platform });
    expect(res.ok).toBe(true);
    expect(res.result).toBe(100);
    expect(res.output).toBe('a b\nc\n100');
  });

  it('returns formatted error output from platform execution failure (RQ-07)', async () => {
    const platform = createMockPlatformAdapter();
    const cell = {
      id: 'cell-error',
      name: 'test-err',
      source: 'const a = 10;\nconst b = 20;\nthrow new Error("fail on line 3");',
    };

    const res = await kernelService.runCell(cell, { platformAdapter: platform });
    expect(res.ok).toBe(false);
    expect(res.output).toContain('✖ Error: fail on line 3');
    expect(res.output).toContain('3 | throw new Error("fail on line 3");');
  });
});
