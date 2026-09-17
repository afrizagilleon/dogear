/**
 * extension/native/probes.test.ts
 * Reconstructs Probe 1 and Probe 2 from D-24 §3.1.
 * Imports product NativeBridge, uses mock port recording all outgoing frames,
 * and mock scriptExecutor recording executed source per tab.
 * 
 * At baseline 559c990:
 * - Probe 1 produces 2 outcomes on cancel (INV-8 broken).
 * - Probe 2 shows tab 11 executing MARK_BA and MARK_BB from Run B (isolation broken).
 */

import { describe, it, expect } from 'vitest';
import { NativeBridge, type NativePortLike } from './bridge';
import { MemoryProjectStore } from '../project/memory';
import type { PlatformAdapter, ScriptExecutionOptions, ScriptExecutionResult } from '../platform/interface';
import type { DogearMessage } from './types';

export class RecordingPort implements NativePortLike {
  public sentMessages: DogearMessage[] = [];
  public messageListeners: Array<(msg: unknown) => void> = [];
  public disconnectListeners: Array<() => void> = [];

  postMessage(msg: unknown): void {
    this.sentMessages.push(msg as DogearMessage);
  }

  onMessage = {
    addListener: (callback: (msg: unknown) => void): void => {
      this.messageListeners.push(callback);
    },
    removeListener: (callback: (msg: unknown) => void): void => {
      const idx = this.messageListeners.indexOf(callback);
      if (idx !== -1) this.messageListeners.splice(idx, 1);
    },
  };

  onDisconnect = {
    addListener: (callback: () => void): void => {
      this.disconnectListeners.push(callback);
    },
  };

  async deliver(msg: unknown): Promise<void> {
    for (const listener of [...this.messageListeners]) {
      await listener(msg);
    }
  }

  get outcomes(): Array<Extract<DogearMessage, { type: 'outcome' }>> {
    return this.sentMessages.filter((m): m is Extract<DogearMessage, { type: 'outcome' }> => m.type === 'outcome');
  }
}

export function createProbeHarness() {
  const store = new MemoryProjectStore();
  const executedPerTab: Array<{
    tabId: number;
    cellId: string;
    source: string;
    marker?: string;
  }> = [];

  let onExecuteHook: ((options: ScriptExecutionOptions) => Promise<void> | void) | null = null;

  const mockPlatform: Partial<PlatformAdapter> = {
    scriptExecutor: {
      executeScript: async (options: ScriptExecutionOptions): Promise<ScriptExecutionResult> => {
        let marker: string | undefined;
        if (options.source.includes('MARK_AA')) marker = 'MARK_AA';
        else if (options.source.includes('MARK_AB')) marker = 'MARK_AB';
        else if (options.source.includes('MARK_BA')) marker = 'MARK_BA';
        else if (options.source.includes('MARK_BB')) marker = 'MARK_BB';
        else if (options.source.includes('MARK_BC')) marker = 'MARK_BC';

        executedPerTab.push({
          tabId: options.tabId ?? 0,
          cellId: options.cellId,
          source: options.source,
          marker,
        });

        if (onExecuteHook) {
          await onExecuteHook(options);
        }

        return {
          ok: true,
          output: `executed ${options.cellId}`,
          result: { status: 'completed' },
        };
      },
    },
  };

  const bridge = new NativeBridge({
    platformAdapter: mockPlatform as PlatformAdapter,
    projectStore: store,
  });

  const port = new RecordingPort();
  bridge.attachPort(port);

  return {
    store,
    bridge,
    port,
    executedPerTab,
    setOnExecuteHook: (fn: typeof onExecuteHook) => {
      onExecuteHook = fn;
    },
  };
}

describe('D-24 Bite-Test 1: Probes (§3.1)', () => {
  it('PROBE 1 — single run then cancel must yield EXACTLY 1 outcome on port', async () => {
    const { port, setOnExecuteHook } = createProbeHarness();

    const threeStepNotebook = `---
name: "Probe 1 Notebook"
steps:
  - path: "steps/a.js"
    name: "Step A"
  - path: "steps/b.js"
    name: "Step B"
---
# Probe 1
`;
    const files = {
      'steps/a.js': '/* step a */ return { status: "completed" };',
      'steps/b.js': '/* step b */ return { status: "completed" };',
    };

    // When step A begins execution, deliver cancel message through port
    setOnExecuteHook(async (options) => {
      if (options.cellId === 'steps/a.js') {
        // Trigger cancel while step A is executing
        await port.deliver({ action: 'cancel' });
      }
    });

    await port.deliver({
      action: 'run',
      runId: 'R1',
      notebook_id: 'nb-probe-1',
      notebook: threeStepNotebook,
      files,
      tabId: 101,
    });

    const outcomes = port.outcomes;
    console.log('PROBE 1 — satu run, lalu cancel');
    console.log(`  outcome total        : ${outcomes.length}`);
    outcomes.forEach((o, i) => {
      console.log(`  outcome[${i}] runId=${o.runId} state=${o.state} reason=${o.reason}`);
    });

    // Invariant requirement (INV-8, RQ-01):
    // MUST be exactly 1 outcome emitted to port
    expect(outcomes.length).toBe(1);
    expect(outcomes[0].runId).toBe('R1');
    expect(outcomes[0].state).toBe('needs_review');
    expect(outcomes[0].executedCellIds).toEqual(['steps/a.js']);
  });

  it('PROBE 2 — two concurrent runs (tab 11 & 22) must NOT contaminate code or state', async () => {
    const { port, executedPerTab } = createProbeHarness();

    const notebookA = `---
name: "Run A"
steps:
  - path: "steps/a.js"
    name: "Step A"
  - path: "steps/b.js"
    name: "Step B"
---
`;
    const filesA = {
      'steps/a.js': 'const MARK_AA = 1; return { status: "completed" };',
      'steps/b.js': 'const MARK_AB = 1; return { status: "completed" };',
    };

    const notebookB = `---
name: "Run B"
steps:
  - path: "steps/a.js"
    name: "Step A"
  - path: "steps/b.js"
    name: "Step B"
  - path: "steps/c.js"
    name: "Step C"
---
`;
    const filesB = {
      'steps/a.js': 'const MARK_BA = 1; return { status: "completed" };',
      'steps/b.js': 'const MARK_BB = 1; return { status: "completed" };',
      'steps/c.js': 'const MARK_BC = 1; return { status: "completed" };',
    };

    // Run A and Run B launched concurrently
    const pA = port.deliver({
      action: 'run',
      runId: 'RA',
      notebook_id: 'nb-run-a',
      notebook: notebookA,
      files: filesA,
      tabId: 11,
    });

    const pB = port.deliver({
      action: 'run',
      runId: 'RB',
      notebook_id: 'nb-run-b',
      notebook: notebookB,
      files: filesB,
      tabId: 22,
    });

    await Promise.all([pA, pB]);

    console.log('PROBE 2 — dua run bersamaan (tab 11 & 22)');
    console.log('  eksekusi per tab (tab -> marker):');
    for (const ex of executedPerTab) {
      console.log(`    tab ${ex.tabId} cell ${ex.cellId} ran ${ex.marker}`);
    }

    // Tab 11 must ONLY execute MARK_AA and MARK_AB
    const tab11Executions = executedPerTab.filter((e) => e.tabId === 11);
    expect(tab11Executions.length).toBeGreaterThan(0);
    for (const ex of tab11Executions) {
      expect(ex.marker).not.toBe('MARK_BA');
      expect(ex.marker).not.toBe('MARK_BB');
    }

    // Tab 22 must ONLY execute MARK_BA, MARK_BB, MARK_BC
    const tab22Executions = executedPerTab.filter((e) => e.tabId === 22);
    expect(tab22Executions.length).toBeGreaterThan(0);
    for (const ex of tab22Executions) {
      expect(ex.marker).not.toBe('MARK_AA');
      expect(ex.marker).not.toBe('MARK_AB');
    }
  });
});
