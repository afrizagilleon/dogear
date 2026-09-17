/**
 * extension/native/cancel.test.ts
 * Mandatory bite-test for cancel() and status (T-04, RQ-05, D-6).
 * Proves that cancel() ACTUALLY stops execution — step 2 and step 3 never run,
 * proven via observable side effects, not merely checking a boolean flag.
 */

import { describe, it, expect } from 'vitest';
import { NativeBridge } from './bridge';
import { MemoryProjectStore } from '../project/memory';
import type { PlatformAdapter, ScriptExecutionOptions, ScriptExecutionResult } from '../platform/interface';

describe('T-04: cancel() and status Mandatory Bite-test (RQ-05, D-6)', () => {
  it('proves that cancel() after step 1 guarantees step 2 and step 3 NEVER run via observable side-effects', async () => {
    const store = new MemoryProjectStore();

    // 3-step notebook markdown
    const threeStepNotebook = `---
name: "3-Step Cancellation Test Pipeline"
steps:
  - path: "steps/01-step.js"
    name: "Step 1"
  - path: "steps/02-step.js"
    name: "Step 2"
  - path: "steps/03-step.js"
    name: "Step 3"
---

# 3-Step Pipeline for Cancellation Verification
`;

    // Observable page/tab side-effect tracking state
    const observablePageEffects = {
      step1Executed: false,
      step2Executed: false,
      step3Executed: false,
    };

    const executedScriptsList: ScriptExecutionOptions[] = [];

    // Custom mock platform executor that simulates observable page state mutations
    const mockPlatform: Partial<PlatformAdapter> = {
      scriptExecutor: {
        executeScript: async (options: ScriptExecutionOptions): Promise<ScriptExecutionResult> => {
          executedScriptsList.push(options);

          if (options.cellId === 'steps/01-step.js') {
            observablePageEffects.step1Executed = true;
            return {
              ok: true,
              output: 'step 1 executed successfully',
              result: { step: 1, mutated: true },
            };
          }

          if (options.cellId === 'steps/02-step.js') {
            observablePageEffects.step2Executed = true;
            return {
              ok: true,
              output: 'step 2 executed successfully',
              result: { step: 2, mutated: true },
            };
          }

          if (options.cellId === 'steps/03-step.js') {
            observablePageEffects.step3Executed = true;
            return {
              ok: true,
              output: 'step 3 executed successfully',
              result: { step: 3, mutated: true },
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

    // Recording mock port to measure frames emitted over port (D-24 Rule #6, RQ-01, K-3)
    const sentFrames: Array<Record<string, unknown>> = [];
    const portListeners: Array<(msg: unknown) => Promise<void> | void> = [];
    const mockPort = {
      postMessage: (msg: unknown) => {
        sentFrames.push(msg as Record<string, unknown>);
      },
      onMessage: {
        addListener: (cb: (msg: unknown) => Promise<void> | void) => {
          portListeners.push(cb);
        },
      },
    };
    bridge.attachPort(mockPort);

    const deliver = async (msg: unknown) => {
      for (const cb of [...portListeners]) {
        await cb(msg);
      }
    };

    const notebookFiles: Record<string, string> = {
      'steps/01-step.js': `print("Running step 1"); return { step: 1 };`,
      'steps/02-step.js': `print("Running step 2"); return { step: 2 };`,
      'steps/03-step.js': `print("Running step 3"); return { step: 3 };`,
    };

    // Initial check: status is idle
    const initialStatus = await bridge.handleMessage({ action: 'status' });
    expect(initialStatus).toEqual({ type: 'status', state: 'idle' });

    // Efek SEBELUM eksekusi: semua false
    expect(observablePageEffects.step1Executed).toBe(false);
    expect(observablePageEffects.step2Executed).toBe(false);
    expect(observablePageEffects.step3Executed).toBe(false);
    expect(executedScriptsList).toHaveLength(0);

    // Jalankan pipeline lewat port, dan saat step 1 dieksekusi, kirim cancel lewat port
    let cancelSent = false;
    const originalExecute = mockPlatform.scriptExecutor!.executeScript;
    mockPlatform.scriptExecutor!.executeScript = async (opts) => {
      const res = await originalExecute(opts);
      if (opts.cellId === 'steps/01-step.js' && !cancelSent) {
        cancelSent = true;
        // Kirim cancel saat step 1 selesai
        await deliver({ action: 'cancel' });
      }
      return res;
    };

    // Mulai run lewat port
    await deliver({
      action: 'run',
      runId: 'cancel-test-run-1',
      notebook_id: 'nb-cancellation-test',
      notebook: threeStepNotebook,
      files: notebookFiles,
      tabId: 101,
    });

    // =========================================================================
    // BUKTI EFEK SESUDAH PEMBATALAN (OBSERVABLE EFFECTS PROOF):
    // =========================================================================
    // 1. Step 1 terbukti berjalan
    expect(observablePageEffects.step1Executed).toBe(true);

    // 2. Step 2 terbukti TIDAK PERNAH berjalan (efek halaman tidak berubah)
    expect(observablePageEffects.step2Executed).toBe(false);

    // 3. Step 3 terbukti TIDAK PERNAH berjalan (efek halaman tidak berubah)
    expect(observablePageEffects.step3Executed).toBe(false);

    // 4. scriptExecutor hanya dipanggil TEPAT 1 kali untuk step 1
    expect(executedScriptsList).toHaveLength(1);
    expect(executedScriptsList[0].cellId).toBe('steps/01-step.js');

    // 5. K-3: Balasan cancel lewat port adalah status, BUKAN outcome
    const statusOnPort = sentFrames.filter((f) => f.type === 'status');
    expect(statusOnPort.length).toBeGreaterThan(0);

    // 6. INV-8 / RQ-01: TEPAT SATU outcome diterima lewat port
    const outcomesOnPort = sentFrames.filter((f) => f.type === 'outcome');
    expect(outcomesOnPort).toHaveLength(1);
    const portOutcome = outcomesOnPort[0];
    expect(portOutcome.state).toBe('needs_review');
    expect(portOutcome.reason).toContain('dibatalkan');
    expect(portOutcome.lastSuccessCellId).toBe('steps/01-step.js');
    expect(portOutcome.executedCellIds).toEqual(['steps/01-step.js']);
    expect(portOutcome.runId).toBe('cancel-test-run-1');

    // 8. Status kembali menjadi idle
    const postStatus = await bridge.handleMessage({ action: 'status' });
    expect(postStatus).toEqual({ type: 'status', state: 'idle' });
  });
});
