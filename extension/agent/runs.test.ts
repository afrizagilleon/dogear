/**
 * extension/agent/runs.test.ts
 * Unit tests for run recorder, format verification, and kernel integration (D-2, RQ-01, RQ-02).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { recordRun, listRuns, readRun, generateRunFileName } from './runs';
import type { RunRecord } from './types';
import { MemoryProjectStore } from '../project/memory';
import { KernelExecutionService } from '../kernel/service';
import { TestPlatformAdapter } from '../platform/test-adapter';
import { setPlatformAdapterForTesting } from '../platform';

describe('T-02: Agent Run Recorder (D-2, RQ-02)', () => {
  let store: MemoryProjectStore;

  beforeEach(() => {
    store = new MemoryProjectStore();
    setPlatformAdapterForTesting(new TestPlatformAdapter());
  });

  it('generates a time-sortable run filename', () => {
    const fileName = generateRunFileName('2026-09-01T12:00:00.123Z', 'steps/01-init.js');
    expect(fileName).toBe('runs/2026-09-01T12-00-00-123Z_steps_01-init.js.json');
  });

  it('records successful run to runs/ and can read it back field-per-field (RQ-02)', async () => {
    const record: RunRecord = {
      stepId: 'steps/01-init.js',
      startedAt: '2026-09-01T12:00:00.000Z',
      completedAt: '2026-09-01T12:00:00.045Z',
      status: 'ok',
      result: 42,
      output: '42',
      error: null,
      host: '127.0.0.1:58071',
    };

    const writtenPath = await recordRun(store, record);
    expect(writtenPath).toBe('runs/2026-09-01T12-00-00-000Z_steps_01-init.js.json');

    const runs = await listRuns(store);
    expect(runs).toContain(writtenPath);

    const read = await readRun(store, writtenPath);
    expect(read.stepId).toBe('steps/01-init.js');
    expect(read.startedAt).toBe('2026-09-01T12:00:00.000Z');
    expect(read.completedAt).toBe('2026-09-01T12:00:00.045Z');
    expect(read.status).toBe('ok');
    expect(read.result).toBe(42);
    expect(read.output).toBe('42');
    expect(read.error).toBeNull();
    expect(read.host).toBe('127.0.0.1:58071');
  });

  it('records failed run to runs/ with serialized error containing name and message (D-1, RQ-01, RQ-02)', async () => {
    const record: RunRecord = {
      stepId: 'steps/02-fail.js',
      startedAt: '2026-09-01T12:01:00.000Z',
      completedAt: '2026-09-01T12:01:00.020Z',
      status: 'error',
      output: '✖ TypeError: Database connection lost\n  Sebab: Eksepsi dilempar saat mengeksekusi step.',
      error: {
        name: 'TypeError',
        message: 'Database connection lost',
        stack: 'TypeError: Database connection lost\n    at eval (nb-cell-02.js:2:1)',
      },
      host: 'example.com',
    };

    const writtenPath = await recordRun(store, record);
    const read = await readRun(store, writtenPath);

    expect(read.status).toBe('error');
    expect(read.error).toBeDefined();
    expect(read.error?.name).toBe('TypeError');
    expect(read.error?.message).toBe('Database connection lost');
    expect(read.error?.stack).toContain('TypeError: Database connection lost');
  });

  it('integrates with KernelExecutionService.runCell to automatically record runs (INV-9)', async () => {
    const kernel = new KernelExecutionService();
    const cellOk = {
      id: 'step-ok',
      source: 'return 6 * 7;',
    };

    const cellFail = {
      id: 'step-fail',
      source: 'throw new RangeError("Index out of bounds");',
    };

    // Run successful cell
    await kernel.runCell(cellOk, { projectStore: store, host: 'test.localhost' });

    // Run failing cell
    await kernel.runCell(cellFail, { projectStore: store, host: 'test.localhost' });

    const runs = await listRuns(store);
    expect(runs.length).toBe(2);

    const run1 = await readRun(store, runs[0]);
    const run2 = await readRun(store, runs[1]);

    expect(run1.stepId).toBe('step-ok');
    expect(run1.status).toBe('ok');
    expect(run1.result).toBe(42);
    expect(run1.host).toBe('test.localhost');

    expect(run2.stepId).toBe('step-fail');
    expect(run2.status).toBe('error');
    expect(run2.error?.name).toBe('RangeError');
    expect(run2.error?.message).toBe('Index out of bounds');
    expect(run2.host).toBe('test.localhost');
  });
});
