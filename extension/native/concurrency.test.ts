/**
 * extension/native/concurrency.test.ts
 * Unit tests for multi-run concurrency and port-measured invariants (T-02, RQ-03, RQ-04, RQ-05, RQ-06, K-1..K-6).
 */

import { describe, it, expect } from 'vitest';
import { NativeBridge, type NativePortLike } from './bridge';
import { MemoryProjectStore } from '../project/memory';
import type { PlatformAdapter, ScriptExecutionOptions, ScriptExecutionResult } from '../platform/interface';
import type { DogearMessage } from './types';

class RecordingPort implements NativePortLike {
  public sentMessages: DogearMessage[] = [];
  public messageListeners: Array<(msg: unknown) => Promise<void> | void> = [];
  public disconnectListeners: Array<() => void> = [];
  public isDisconnected = false;
  public throwOnPostMessageAfterDisconnect = false;

  postMessage(msg: unknown): void {
    if (this.isDisconnected && this.throwOnPostMessageAfterDisconnect) {
      throw new Error('Attempting to use a disconnected port object');
    }
    this.sentMessages.push(msg as DogearMessage);
  }

  onMessage = {
    addListener: (cb: (msg: unknown) => Promise<void> | void): void => {
      this.messageListeners.push(cb);
    },
  };

  onDisconnect = {
    addListener: (cb: () => void): void => {
      this.disconnectListeners.push(cb);
    },
  };

  disconnect(): void {
    this.isDisconnected = true;
    for (const cb of [...this.disconnectListeners]) {
      cb();
    }
  }

  async deliver(msg: unknown): Promise<void> {
    for (const cb of [...this.messageListeners]) {
      await cb(msg);
    }
  }

  get outcomes(): Array<Extract<DogearMessage, { type: 'outcome' }>> {
    return this.sentMessages.filter((m): m is Extract<DogearMessage, { type: 'outcome' }> => m.type === 'outcome');
  }

  get progressMessages(): Array<Extract<DogearMessage, { type: 'progress' }>> {
    return this.sentMessages.filter((m): m is Extract<DogearMessage, { type: 'progress' }> => m.type === 'progress');
  }

  get statusMessages(): Array<Extract<DogearMessage, { type: 'status' }>> {
    return this.sentMessages.filter((m): m is Extract<DogearMessage, { type: 'status' }> => m.type === 'status');
  }
}

function createHarness() {
  const store = new MemoryProjectStore();
  let stepDelayMs = 20;

  const mockPlatform: Partial<PlatformAdapter> = {
    scriptExecutor: {
      executeScript: async (options: ScriptExecutionOptions): Promise<ScriptExecutionResult> => {
        if (stepDelayMs > 0) {
          await new Promise((r) => setTimeout(r, stepDelayMs));
        }
        return {
          ok: true,
          output: `ok: ${options.cellId}`,
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

  return { bridge, port, setStepDelay: (ms: number) => { stepDelayMs = ms; } };
}

describe('T-02: Concurrency & Port-level Outcomes (RQ-03..RQ-06, K-1..K-6)', () => {
  it('RQ-03: Targeted cancel with runId aborts targeted run only, other run completes normally', async () => {
    const { port, setStepDelay } = createHarness();
    setStepDelay(30);

    const notebook = `---
name: "Targeted Cancel"
steps:
  - path: "steps/01.js"
  - path: "steps/02.js"
  - path: "steps/03.js"
---
`;
    const files = {
      'steps/01.js': 'return { status: "completed" };',
      'steps/02.js': 'return { status: "completed" };',
      'steps/03.js': 'return { status: "completed" };',
    };

    const p1 = port.deliver({
      action: 'run',
      runId: 'RUN-TARGET',
      notebook,
      files,
      tabId: 101,
    });

    const p2 = port.deliver({
      action: 'run',
      runId: 'RUN-SURVIVOR',
      notebook,
      files,
      tabId: 102,
    });

    // Wait slightly for step 1 to start, then cancel only RUN-TARGET
    await new Promise((r) => setTimeout(r, 15));
    await port.deliver({
      action: 'cancel',
      runId: 'RUN-TARGET',
    });

    await Promise.all([p1, p2]);

    const targetOutcomes = port.outcomes.filter((o) => o.runId === 'RUN-TARGET');
    const survivorOutcomes = port.outcomes.filter((o) => o.runId === 'RUN-SURVIVOR');

    // Each run produces EXACTLY ONE outcome on port
    expect(targetOutcomes).toHaveLength(1);
    expect(targetOutcomes[0].state).toBe('needs_review');
    expect(targetOutcomes[0].reason).toContain('dibatalkan');

    expect(survivorOutcomes).toHaveLength(1);
    expect(survivorOutcomes[0].state).toBe('completed');
  });

  it('RQ-04: Broad cancel without runId aborts all active runs with exactly 1 outcome each', async () => {
    const { port, setStepDelay } = createHarness();
    setStepDelay(30);

    const notebook = `---
name: "Broad Cancel"
steps:
  - path: "steps/01.js"
  - path: "steps/02.js"
---
`;
    const files = {
      'steps/01.js': 'return { status: "completed" };',
      'steps/02.js': 'return { status: "completed" };',
    };

    const p1 = port.deliver({
      action: 'run',
      runId: 'RUN-A',
      notebook,
      files,
      tabId: 201,
    });

    const p2 = port.deliver({
      action: 'run',
      runId: 'RUN-B',
      notebook,
      files,
      tabId: 202,
    });

    await new Promise((r) => setTimeout(r, 15));
    await port.deliver({
      action: 'cancel',
    });

    await Promise.all([p1, p2]);

    const outA = port.outcomes.filter((o) => o.runId === 'RUN-A');
    const outB = port.outcomes.filter((o) => o.runId === 'RUN-B');

    expect(outA).toHaveLength(1);
    expect(outA[0].state).toBe('needs_review');
    expect(outA[0].reason).toContain('dibatalkan');

    expect(outB).toHaveLength(1);
    expect(outB[0].state).toBe('needs_review');
    expect(outB[0].reason).toContain('dibatalkan');
  });

  it('RQ-05: Busy tab is rejected immediately naming the active runId, existing run undisturbed', async () => {
    const { port, setStepDelay } = createHarness();
    setStepDelay(40);

    const notebook = `---
name: "Busy Tab Test"
steps:
  - path: "steps/01.js"
  - path: "steps/02.js"
---
`;
    const files = {
      'steps/01.js': 'return { status: "completed" };',
      'steps/02.js': 'return { status: "completed" };',
    };

    // Start Run 1 on tab 301
    const p1 = port.deliver({
      action: 'run',
      runId: 'PRIMARY-RUN',
      notebook,
      files,
      tabId: 301,
    });

    // While Run 1 is running, attempt Run 2 on the same tab 301
    await new Promise((r) => setTimeout(r, 10));
    await port.deliver({
      action: 'run',
      runId: 'INTRUDER-RUN',
      notebook,
      files,
      tabId: 301,
    });

    // Intruder run should be rejected immediately with needs_review naming PRIMARY-RUN
    const intruderOutcomes = port.outcomes.filter((o) => o.runId === 'INTRUDER-RUN');
    expect(intruderOutcomes).toHaveLength(1);
    expect(intruderOutcomes[0].state).toBe('needs_review');
    expect(intruderOutcomes[0].reason).toContain('PRIMARY-RUN');
    expect(intruderOutcomes[0].reason).toContain('301');

    // Wait for Primary Run to complete normally
    await p1;

    const primaryOutcomes = port.outcomes.filter((o) => o.runId === 'PRIMARY-RUN');
    expect(primaryOutcomes).toHaveLength(1);
    expect(primaryOutcomes[0].state).toBe('completed');
  });

  it('RQ-06: Status and progress distinguish concurrent runs', async () => {
    const { bridge, port, setStepDelay } = createHarness();
    setStepDelay(40);

    const notebook = `---
name: "Status Progress Test"
steps:
  - path: "steps/01.js"
  - path: "steps/02.js"
---
`;
    const files = {
      'steps/01.js': 'return { status: "completed" };',
      'steps/02.js': 'return { status: "completed" };',
    };

    const p1 = port.deliver({
      action: 'run',
      runId: 'RUN-ALPHA',
      notebook,
      files,
      tabId: 401,
    });

    const p2 = port.deliver({
      action: 'run',
      runId: 'RUN-BETA',
      notebook,
      files,
      tabId: 402,
    });

    // While both are active, query status
    await new Promise((r) => setTimeout(r, 15));
    const status = (await bridge.handleMessage({ action: 'status' })) as Extract<DogearMessage, { type: 'status' }>;

    expect(status.state).toBe('running');
    expect(status.runs).toBeDefined();
    expect(status.runs).toHaveLength(2);
    const runIds = status.runs!.map((r) => r.runId);
    expect(runIds).toContain('RUN-ALPHA');
    expect(runIds).toContain('RUN-BETA');

    await Promise.all([p1, p2]);

    // Check progress messages
    const alphaProgress = port.progressMessages.filter((p) => p.runId === 'RUN-ALPHA');
    const betaProgress = port.progressMessages.filter((p) => p.runId === 'RUN-BETA');

    expect(alphaProgress.length).toBeGreaterThan(0);
    expect(betaProgress.length).toBeGreaterThan(0);

    for (const p of alphaProgress) {
      expect(p.runId).toBe('RUN-ALPHA');
    }
    for (const p of betaProgress) {
      expect(p.runId).toBe('RUN-BETA');
    }
  });

  it('K-6: Native port unexpected disconnect aborts active runs, status returns to idle, and tab is not locked', async () => {
    const { bridge, port, setStepDelay } = createHarness();
    setStepDelay(30);

    const notebook = `---
name: "K6 Disconnect Test"
steps:
  - path: "steps/01.js"
  - path: "steps/02.js"
  - path: "steps/03.js"
---
`;
    const files = {
      'steps/01.js': 'return { status: "completed" };',
      'steps/02.js': 'return { status: "completed" };',
      'steps/03.js': 'return { status: "completed" };',
    };

    const runPromise = port.deliver({
      action: 'run',
      runId: 'RUN-K6-NORMAL',
      notebook,
      files,
      tabId: 9,
    });

    // Wait until step 1 has started, then disconnect port
    await new Promise((r) => setTimeout(r, 15));
    port.disconnect();

    await runPromise;

    // All active runs should be aborted and return exactly one outcome
    const outcomes = port.outcomes.filter((o) => o.runId === 'RUN-K6-NORMAL');
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].state).toBe('needs_review');
    expect(outcomes[0].reason).toContain('dibatalkan');

    // Status is now idle
    const status = (await bridge.handleMessage({ action: 'status' })) as Extract<DogearMessage, { type: 'status' }>;
    expect(status.state).toBe('idle');
    expect(bridge.isRunningPipeline).toBe(false);

    // Tab 9 is NOT locked: running another run on the same tab 9 succeeds
    setStepDelay(0);
    const run2 = await bridge.handleMessage({
      action: 'run',
      runId: 'RUN-K6-AFTER-RECONNECT',
      notebook,
      files,
      tabId: 9,
    });
    expect(run2.type).toBe('outcome');
    if (run2.type === 'outcome') {
      expect(run2.state).toBe('completed');
    }
  });

  it('K-6: Port mimicking Chrome throws on postMessage after disconnect without unhandled rejections and tab is not locked (F-5, F-6)', async () => {
    const { bridge, port, setStepDelay } = createHarness();
    setStepDelay(30);
    port.throwOnPostMessageAfterDisconnect = true;

    const unhandledRejections: unknown[] = [];
    const onUnhandled = (err: unknown) => {
      unhandledRejections.push(err);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      const notebook = `---
name: "K6 Throwing Port Test"
steps:
  - path: "steps/01.js"
  - path: "steps/02.js"
---
`;
      const files = {
        'steps/01.js': 'return { status: "completed" };',
        'steps/02.js': 'return { status: "completed" };',
      };

      const runPromise = port.deliver({
        action: 'run',
        runId: 'RUN-M1',
        notebook,
        files,
        tabId: 9,
      });

      // While run M1 is running on tab 9, host dies / disconnects
      await new Promise((r) => setTimeout(r, 15));
      port.disconnect();

      await runPromise;

      // Allow microtasks to settle to ensure zero unhandled rejections
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandledRejections).toHaveLength(0);

      // Status is idle
      const status = (await bridge.handleMessage({ action: 'status' })) as Extract<DogearMessage, { type: 'status' }>;
      expect(status.state).toBe('idle');
      expect(bridge.isRunningPipeline).toBe(false);

      // Reconnect: attach new healthy port, run M2 on the same tab 9 -> completed!
      const newPort = new RecordingPort();
      bridge.attachPort(newPort);

      setStepDelay(0);
      const run2Promise = newPort.deliver({
        action: 'run',
        runId: 'RUN-M2',
        notebook,
        files,
        tabId: 9,
      });
      await run2Promise;

      const m2Outcomes = newPort.outcomes.filter((o) => o.runId === 'RUN-M2');
      expect(m2Outcomes).toHaveLength(1);
      expect(m2Outcomes[0].state).toBe('completed');
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });
});
