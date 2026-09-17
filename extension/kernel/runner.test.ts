/**
 * extension/kernel/runner.test.ts
 * Unit tests for PipelineRunner resume point, checkpoint integration, and error halts (RQ-04, RQ-07, RQ-09).
 */

import { describe, it, expect } from 'vitest';
import { pipelineRunner } from './runner';
import { saveCheckpoint } from './checkpoint';
import { armAuto, loadAuto } from './auto';
import { TestPlatformAdapter } from '../platform/test-adapter';
import type { KernelCell } from './types';

describe('T-03: Resume point and PipelineRunner (RQ-04, RQ-09)', () => {
  it('resumes from the step after lastSuccessCellId (RQ-04)', async () => {
    const platform = new TestPlatformAdapter();
    const cells: KernelCell[] = [
      { id: 'step-1', source: 'return 1;' },
      { id: 'step-2', source: 'return 2;' },
      { id: 'step-3', source: 'return 3;' },
    ];

    // Seed checkpoint: step-2 was last successful step
    await saveCheckpoint(platform.storage, 'site.test', {
      lastSuccessCellId: 'step-2',
      data: { previousVal: 42 },
    });

    const res = await pipelineRunner.runPipeline(cells, {
      tabId: 1,
      host: 'site.test',
      platformAdapter: platform,
    });

    expect(res.status).toBe('completed');
    // Only step-3 should be executed, step-1 and step-2 are skipped
    expect(res.executedCellIds).toEqual(['step-3']);
    expect(res.lastSuccessCellId).toBe('step-3');
  });

  it('halts and disarms auto mode on cell execution error (RQ-09)', async () => {
    const platform = new TestPlatformAdapter();
    const cells: KernelCell[] = [
      { id: 'step-1', source: 'return 1;' },
      { id: 'step-err', source: 'throw new TypeError("bad type on line 3");' },
      { id: 'step-3', source: 'return 3;' },
    ];

    const res = await pipelineRunner.runPipeline(cells, {
      tabId: 1,
      host: 'site.test',
      autoArm: true,
      platformAdapter: platform,
    });

    expect(res.status).toBe('error');
    expect(res.executedCellIds).toEqual(['step-1']);
    expect(res.lastSuccessCellId).toBe('step-1');
    expect(res.executedCellIds).not.toContain('step-3'); // Step 3 must NOT run

    const autoState = await loadAuto(platform.storage, 'site.test');
    expect(autoState.armed).toBe(false); // Disarmed on error
  });

  it('rejects auto mode on unregistered / revoked host and disarms (D-1R, D-3R, RQ-03)', async () => {
    const platform = new TestPlatformAdapter();
    const registry = new TestPlatformAdapter().storage; // create isolated registry
    const { SiteRegistryService } = await import('../registry');
    const testRegistry = new SiteRegistryService(registry);

    const cells: KernelCell[] = [
      { id: 'step-1', source: 'return 1;' },
    ];

    // Arm auto mode directly without autoArm
    await armAuto(platform.storage, 'unregistered.site', 5);

    const res = await pipelineRunner.runPipeline(cells, {
      tabId: 1,
      host: 'unregistered.site',
      platformAdapter: platform,
      siteRegistry: testRegistry,
    });

    expect(res.status).toBe('error');
    expect(res.executedCellIds).toEqual([]);
    expect(res.output).toContain('SiteNotRegisteredError');
    expect(res.output).toContain('unregistered.site');

    const autoState = await loadAuto(platform.storage, 'unregistered.site');
    expect(autoState.armed).toBe(false); // Disarmed on rejection
  });

  it('auto-arms on unregistered host by adding to registry and announcing notice (D-4R, RQ-04)', async () => {
    const platform = new TestPlatformAdapter();
    const { SiteRegistryService } = await import('../registry');
    const testRegistry = new SiteRegistryService(new TestPlatformAdapter().storage);

    const cells: KernelCell[] = [
      { id: 'step-1', source: 'return 1;' },
    ];

    expect(await testRegistry.isRegistered('new-auto.site')).toBe(false);

    const res = await pipelineRunner.runPipeline(cells, {
      tabId: 1,
      host: 'new-auto.site',
      autoArm: true,
      platformAdapter: platform,
      siteRegistry: testRegistry,
    });

    expect(res.status).toBe('completed');
    expect(res.executedCellIds).toEqual(['step-1']);
    expect(await testRegistry.isRegistered('new-auto.site')).toBe(true);
    expect(res.notice).toContain("Situs 'new-auto.site' otomatis didaftarkan ke registry untuk auto mode.");
  });
});
