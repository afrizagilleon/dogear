/**
 * extension/kernel/service.ts
 * Unified cell execution service (D-4, D-5, D-6, RQ-01, RQ-04, RQ-05, RQ-06, M2 A-2, M3 T-01).
 * Single entry point for all cell executions across panel and agent surfaces.
 * Delegates actual script execution to the browser platform injection adapter.
 */

import type { KernelCell, KernelRunResult, ExecutionWorld } from './types';
import { validateCellCapabilities, type SiteCapabilityContext } from './capabilities';
import { serializeError } from './errors';
import { getPlatformAdapter, type PlatformAdapter } from '../platform';
import type { ProjectStore } from '../platform/interface';
import { recordRun } from '../agent/runs';
import { getActiveStore } from '../project/active-store';

export interface RunCellOptions {
  tabId?: number;
  host?: string;
  trigger?: string;
  world?: ExecutionWorld;
  signal?: AbortSignal;
  siteCapabilities?: SiteCapabilityContext;
  platformAdapter?: PlatformAdapter;
  projectStore?: ProjectStore;
  skipHud?: boolean;
}

export class KernelExecutionService {
  readonly defaultWorld: ExecutionWorld = 'MAIN';

  async runCell(cell: KernelCell, options?: RunCellOptions | AbortSignal): Promise<KernelRunResult> {
    const opts: RunCellOptions = options instanceof AbortSignal ? { signal: options } : options || {};
    const startedAt = new Date().toISOString();

    if (opts.signal?.aborted) {
      const abortRes: KernelRunResult = {
        ok: false,
        aborted: true,
        error: serializeError(new Error('Execution aborted')),
        output: '■ stopped',
      };
      await this.maybeRecordRun(cell, abortRes, startedAt, opts);
      return abortRes;
    }

    // 1. Check capability requirement declaration (D-3, D-4)
    const capValidation = validateCellCapabilities(cell, opts.siteCapabilities);
    if (!capValidation.ok) {
      const capRes: KernelRunResult = {
        ok: false,
        error: serializeError(capValidation.error),
        output: capValidation.error.message,
      };
      await this.maybeRecordRun(cell, capRes, startedAt, opts);
      return capRes;
    }

    // 2. Resolve platform adapter and target world
    const platform = opts.platformAdapter || getPlatformAdapter();
    const targetWorld = cell.world || opts.world || this.defaultWorld;

    // 3. Delegate script execution to platform adapter (no local string evaluation in kernel)
    let runResult: KernelRunResult;
    try {
      const execResult = await platform.scriptExecutor.executeScript({
        tabId: opts.tabId,
        world: targetWorld,
        cellId: cell.id,
        cellName: cell.name,
        source: cell.source,
        lineMap: cell.lineMap,
        skipHud: opts.skipHud,
      });

      runResult = {
        ok: execResult.ok,
        aborted: execResult.aborted,
        result: execResult.result,
        output: execResult.output,
        error: execResult.error ? serializeError(execResult.error) : null,
        candidateIndex: execResult.candidateIndex,
        candidateMatch: execResult.candidateMatch,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      runResult = {
        ok: false,
        error: serializeError(err),
        output: `✖ PlatformExecutionError: Eksekusi cell gagal di level platform adapter.\n  Sebab: ${msg}\n  Tindakan: Periksa koneksi platform dan status tab browser.`,
      };
    }

    await this.maybeRecordRun(cell, runResult, startedAt, opts, platform);
    return runResult;
  }

  async cancelCell(tabId: number, token?: string): Promise<void> {
    const platform = getPlatformAdapter();
    const exec = platform.scriptExecutor;
    if (!exec.signalCancel) return;
    await exec.signalCancel(tabId, token || `nb-cancel-${Date.now()}`);
  }

  private async maybeRecordRun(
    cell: KernelCell,
    res: KernelRunResult,
    startedAt: string,
    opts: RunCellOptions,
    adapter?: PlatformAdapter
  ): Promise<void> {
    const platform = adapter || opts.platformAdapter || getPlatformAdapter();
    const store = opts.projectStore || platform.projectStore || getActiveStore();
    if (!store) return;

    try {
      let host = opts.host;
      if (!host && opts.tabId !== undefined && platform.getTabHost) {
        host = await platform.getTabHost(opts.tabId);
      }
      if (!host) {
        host = (typeof location !== 'undefined' && location.host) ? location.host : 'default';
      }

      const completedAt = new Date().toISOString();
      await recordRun(store, {
        stepId: cell.name || cell.id,
        startedAt,
        completedAt,
        status: res.ok ? 'ok' : 'error',
        result: res.result,
        output: res.output,
        error: res.error || null,
        host,
        candidateIndex: res.candidateIndex,
        candidateMatch: res.candidateMatch,
      });
    } catch (logErr) {
      // Run recording failure is non-fatal to execution flow
      console.warn('[dogear] Failed to record run into runs/:', logErr);
    }
  }
}

export const kernelService = new KernelExecutionService();
