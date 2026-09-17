/**
 * extension/kernel/runner.ts
 * Pipeline runner with checkpointing, auto mode, and cross-navigation resumption (CJ-1, CJ-3, D-1, D-3, D-4, D-7, RQ-04, RQ-08, RQ-09).
 * Coordinates sequential execution of notebook cells, snapshot commits, and state restore across real browser page reloads.
 */

import type { PlatformAdapter } from '../platform/interface';
import { getPlatformAdapter } from '../platform';
import { kernelService } from './service';
import type { KernelCell } from './types';
import { serializeError, type SerializedError } from './errors';
import { loadCheckpoint, saveCheckpoint, safeSnapshot } from './checkpoint';
import { loadAuto, armAuto, disarmAuto, tickAutoLoad, type AutoState } from './auto';
import { siteRegistry, SiteRegistryService } from '../registry';

export interface PipelineOptions {
  tabId: number;
  host?: string;
  autoArm?: boolean;
  maxLoads?: number;
  signal?: AbortSignal;
  platformAdapter?: PlatformAdapter;
  siteRegistry?: SiteRegistryService;
}

export interface PipelineResult {
  status: 'completed' | 'halted' | 'error' | 'budget_exhausted';
  executedCellIds: string[];
  lastSuccessCellId: string | null;
  data: Record<string, unknown>;
  error?: SerializedError;
  output?: string;
  notice?: string;
  autoState?: AutoState;
}

export class PipelineRunner {
  /**
   * Helper to restore ctx.data from storage into target tab's page context.
   */
  async restoreContext(tabId: number, host: string, platform: PlatformAdapter): Promise<Record<string, unknown>> {
    const cp = await loadCheckpoint(platform.storage, host);
    const dataToRestore = cp?.data ? safeSnapshot(cp.data) : {};
    const escaped = JSON.stringify(dataToRestore);
    await platform.scriptExecutor.executeScript({
      tabId,
      cellId: 'restore-ctx',
      source: `
        window.__nb_steprunner_ctx = window.__nb_steprunner_ctx || { data: {}, refs: {}, lib: {} };
        Object.assign(window.__nb_steprunner_ctx.data, ${escaped});
        return window.__nb_steprunner_ctx.data;
      `,
      world: 'MAIN',
    });
    return dataToRestore;
  }

  /**
   * Helper to snapshot ctx.data from the target tab's page context.
   */
  async snapshotContext(tabId: number, platform: PlatformAdapter): Promise<Record<string, unknown>> {
    const res = await platform.scriptExecutor.executeScript({
      tabId,
      cellId: 'snapshot-ctx',
      source: `return window.__nb_steprunner_ctx?.data || {};`,
      world: 'MAIN',
    });
    if (res.ok && res.result && typeof res.result === 'object') {
      return safeSnapshot(res.result as Record<string, unknown>);
    }
    return {};
  }

  /**
   * Runs or resumes a pipeline of notebook cells across page loads.
   */
  async runPipeline(cells: KernelCell[], options: PipelineOptions): Promise<PipelineResult> {
    const platform = options.platformAdapter || getPlatformAdapter();
    const registry = options.siteRegistry || (options.platformAdapter ? new SiteRegistryService(options.platformAdapter.storage) : siteRegistry);
    const host = options.host || 'default';
    const executedCellIds: string[] = [];

    // 1. Check auto state and budget if auto mode is armed
    let autoState = await loadAuto(platform.storage, host);

    // D-4R: Arming auto on an unregistered host registers it and announces it
    let registrationNotice: string | undefined;
    if (options.autoArm) {
      if (host && host !== 'default') {
        const isReg = await registry.isRegistered(host);
        if (!isReg) {
          await registry.add(host);
          registrationNotice = `Pemberitahuan: Situs '${host}' otomatis didaftarkan ke registry untuk auto mode.`;
          console.log(`[dogear] ${registrationNotice}`);
        }
      }
      autoState = await armAuto(platform.storage, host, options.maxLoads);
    }

    if (autoState.armed) {
      // D-1R, D-3R, RQ-03: Auto mode MUST be guarded by the registry.
      // If host is not registered (or was revoked), reject auto execution immediately.
      if (host && host !== 'default') {
        const isReg = await registry.isRegistered(host);
        if (!isReg) {
          await disarmAuto(platform.storage, host);
          return {
            status: 'error',
            executedCellIds,
            lastSuccessCellId: null,
            data: {},
            error: serializeError({
              name: 'SiteNotRegisteredError',
              message: `Situs '${host}' belum terdaftar di registry.`,
              cause: 'Eksekusi otomatis dibatasi hanya untuk situs yang telah didaftarkan pengguna.',
              action: 'Daftarkan situs ini melalui Site Registry sebelum menjalankan auto mode.',
            }),
            output: `✖ SiteNotRegisteredError: Situs '${host}' belum terdaftar di registry.\n  Sebab: Eksekusi otomatis dibatasi hanya untuk situs yang telah didaftarkan pengguna.\n  Tindakan: Daftarkan situs ini melalui Site Registry sebelum menjalankan auto mode.`,
            notice: registrationNotice,
            autoState: await loadAuto(platform.storage, host),
          };
        }
      }

      const tick = await tickAutoLoad(platform.storage, host);
      if (!tick.ok) {
        return {
          status: 'budget_exhausted',
          executedCellIds,
          lastSuccessCellId: null,
          data: {},
          output: tick.reason,
          notice: registrationNotice,
          autoState: tick.state,
        };
      }
      autoState = tick.state;
    }

    // 2. Restore checkpoint data into tab
    await this.restoreContext(options.tabId, host, platform);

    // 3. Determine starting index from checkpoint (RQ-04, D-3, D-7)
    const cp = await loadCheckpoint(platform.storage, host);
    let startIndex = 0;
    if (cp?.lastSuccessCellId) {
      const idx = cells.findIndex((c) => c.id === cp.lastSuccessCellId);
      if (idx !== -1) {
        startIndex = idx + 1;
      }
    }

    // If all cells were already executed, pipeline is completed
    if (startIndex >= cells.length) {
      const finalData = await this.snapshotContext(options.tabId, platform);
      return {
        status: 'completed',
        executedCellIds,
        lastSuccessCellId: cp?.lastSuccessCellId || null,
        data: finalData,
        notice: registrationNotice,
        autoState,
      };
    }

    // 4. Sequential execution of remaining cells
    let lastSuccessId = cp?.lastSuccessCellId || null;

    for (let i = startIndex; i < cells.length; i++) {
      const cell = cells[i];

      // Check abort signal
      if (options.signal?.aborted) {
        const currentData = await this.snapshotContext(options.tabId, platform);
        return {
          status: 'halted',
          executedCellIds,
          lastSuccessCellId: lastSuccessId,
          data: currentData,
          notice: registrationNotice,
          autoState,
        };
      }

      // Execute cell via kernel
      const res = await kernelService.runCell(cell, {
        tabId: options.tabId,
        platformAdapter: platform,
      });

      if (res.ok) {
        executedCellIds.push(cell.id);
        lastSuccessId = cell.id;

        // D-1: Commit checkpoint BEFORE any navigation happens
        const currentData = await this.snapshotContext(options.tabId, platform);
        await saveCheckpoint(platform.storage, host, {
          lastSuccessCellId: cell.id,
          data: currentData,
        });
      } else {
        // Check if error is an expected AbortError (e.g. from parkForUnload on navigation)
        const errObj = res.error;
        const errText = errObj ? `${errObj.name} ${errObj.message} ${res.output}` : (res.output || '');
        const isAbort = Boolean(res.aborted || errObj?.name === 'AbortError' || errText.includes('AbortError') || errText.includes('aborted') || errText.includes('page unloaded'));

        if (isAbort) {
          // Page navigation underway — load latest checkpoint committed before navigation (D-1)
          const latestCp = await loadCheckpoint(platform.storage, host);
          if (latestCp?.lastSuccessCellId) {
            lastSuccessId = latestCp.lastSuccessCellId;
            if (!executedCellIds.includes(latestCp.lastSuccessCellId)) {
              executedCellIds.push(latestCp.lastSuccessCellId);
            }
          }
          return {
            status: 'halted',
            executedCellIds,
            lastSuccessCellId: lastSuccessId,
            data: latestCp?.data || {},
            notice: registrationNotice,
            autoState,
          };
        }

        // Real cell execution error -> disarm auto mode and halt (RQ-09)
        await disarmAuto(platform.storage, host);
        const currentData = await this.snapshotContext(options.tabId, platform).catch(() => ({}));
        return {
          status: 'error',
          executedCellIds,
          lastSuccessCellId: lastSuccessId,
          data: currentData,
          error: res.error ? serializeError(res.error) : serializeError(new Error(res.output || 'Step execution error')),
          output: res.output,
          notice: registrationNotice,
          autoState: await loadAuto(platform.storage, host),
        };
      }
    }

    // 5. Finished entire pipeline
    const finalData = await this.snapshotContext(options.tabId, platform);
    return {
      status: 'completed',
      executedCellIds,
      lastSuccessCellId: lastSuccessId,
      data: finalData,
      notice: registrationNotice,
      autoState,
    };
  }
}

export const pipelineRunner = new PipelineRunner();
