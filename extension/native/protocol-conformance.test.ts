/**
 * extension/native/protocol-conformance.test.ts
 * Verifies that a run message synthesized solely from PROTOKOL.md
 * executes successfully and conforms to the protocol contract (T-07, RQ-08).
 */

import { describe, it, expect } from 'vitest';
import { NativeBridge } from './bridge';
import { MemoryProjectStore } from '../project/memory';
import type { PlatformAdapter, ScriptExecutionOptions, ScriptExecutionResult } from '../platform/interface';
import type { HostMessage } from './types';

describe('T-07: Protocol Documentation Conformance (RQ-08)', () => {
  it('executes a run message synthesized strictly from PROTOKOL.md without reading codebase', async () => {
    const store = new MemoryProjectStore();

    // Payload synthesized strictly from reading extension/native/PROTOKOL.md §2.A:
    const messageFromDoc: HostMessage = {
      action: 'run',
      notebook_id: 'nb-pesanan-01',
      version: '1.0.0',
      tabId: 12345,
      notebook: `---
name: "Proses Pesanan"
steps:
  - path: "steps/01-ambil.js"
    name: "Ambil Pesanan"
---
# Notebook Pesanan
`,
      files: {
        'steps/01-ambil.js': "ctx.data.orderId = 'ORD-99'; return { status: 'completed', data: { orderId: ctx.data.orderId } };",
      },
      params: {
        prioritas: 'tinggi',
      },
    };

    const mockExecutionContext = { data: {} as Record<string, unknown> };

    const mockPlatform: Partial<PlatformAdapter> = {
      scriptExecutor: {
        executeScript: async (options: ScriptExecutionOptions): Promise<ScriptExecutionResult> => {
          if (options.cellId === 'steps/01-ambil.js' || options.source.includes('ORD-99')) {
            mockExecutionContext.data.orderId = 'ORD-99';
            return {
              ok: true,
              output: 'Pesanan ORD-99 siap',
              result: { status: 'completed', data: { orderId: 'ORD-99' } },
            };
          }
          return { ok: true, output: 'ok' };
        },
      },
    };

    const bridge = new NativeBridge({
      platformAdapter: mockPlatform as PlatformAdapter,
      projectStore: store,
    });

    // Execute message synthesized purely from documentation
    const result = await bridge.handleMessage(messageFromDoc);

    // Verify response conforms to PROTOKOL.md §3.A:
    expect(result.type).toBe('outcome');
    if (result.type === 'outcome') {
      expect(result.state).toBe('completed');
      expect(result.error).toBeUndefined();
      expect(result.lastSuccessCellId).toBe('steps/01-ambil.js');
      expect(result.data).toEqual({ orderId: 'ORD-99' });
    }
  });
});
