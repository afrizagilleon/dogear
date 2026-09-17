/**
 * extension/native/bridge.ts
 * Native messaging bridge between a companion desktop host and the dogear runtime (D-1, D-2, D-3, D-4, D-6, INV-8, INV-9, RQ-01, RQ-04).
 * Single entrance for the host process into the notebook runtime.
 */

import type { PlatformAdapter, ProjectStore } from '../platform/interface';
import { getPlatformAdapter } from '../platform';
import { pipelineRunner, PipelineRunner } from '../kernel/runner';
import { parseNotebookMarkdown, loadNotebookCells } from '../project/notebook-parser';
import { serializeError } from '../shared/types';
import { evaluateCellOutcome, mapFailureToOutcome, mapSignalToOutcome } from './outcome';
import type { HostMessage, DogearMessage, TerminalState, StepEvidence } from './types';
import { getActiveStore } from '../project/active-store';
import { OpfsProjectStore } from '../project/opfs';
import { MemoryProjectStore } from '../project/memory';
import { recordRun } from '../agent/runs';

import { sendOutgoingMessage } from './frame-out';
import { createHelloMessage, type ManifestLike } from './hello';
export { type ManifestLike } from './hello';
import { computeDataDiff, truncateDomSnippet, createStepMessage } from './step';

export interface NativePortLike {
  name?: string;
  onMessage: {
    addListener: (callback: (msg: unknown) => void) => void;
    removeListener?: (callback: (msg: unknown) => void) => void;
  };
  postMessage: (msg: unknown) => void;
  onDisconnect?: {
    addListener: (callback: () => void) => void;
  };
}

export interface ActiveRunState {
  runId: string;
  tabId: number;
  currentTabId: number;
  tabStack: number[];
  notebookId: string;
  abortController: AbortController;
  closeWarnings: string[];
}

export class NativeBridge {
  private activeRuns = new Map<string, ActiveRunState>();
  private platform: PlatformAdapter;
  private store: ProjectStore;
  private runner: PipelineRunner;
  private buildOverride?: 'studio' | 'runtime';
  private versionOverride?: string;
  private manifest?: ManifestLike;
  private runtimeId?: string;

  constructor(options?: {
    platformAdapter?: PlatformAdapter;
    projectStore?: ProjectStore;
    runner?: PipelineRunner;
    buildOverride?: 'studio' | 'runtime';
    versionOverride?: string;
    manifest?: ManifestLike;
    runtimeId?: string;
  }) {
    this.platform = options?.platformAdapter || getPlatformAdapter();
    this.store = options?.projectStore || getActiveStore() || new OpfsProjectStore();
    this.runner = options?.runner || pipelineRunner;
    this.buildOverride = options?.buildOverride;
    this.versionOverride = options?.versionOverride;
    this.manifest = options?.manifest;
    this.runtimeId = options?.runtimeId;
  }

  setStore(store: ProjectStore): void {
    this.store = store;
  }

  setManifestInfo(info: { manifest?: ManifestLike; runtimeId?: string }): void {
    if (info.manifest) this.manifest = info.manifest;
    if (info.runtimeId) this.runtimeId = info.runtimeId;
  }

  get isRunningPipeline(): boolean {
    return this.activeRuns.size > 0;
  }

  get activeRunCount(): number {
    return this.activeRuns.size;
  }

  private getRunUsingTab(tabId: number): ActiveRunState | undefined {
    for (const run of this.activeRuns.values()) {
      if (run.currentTabId === tabId || run.tabStack.includes(tabId)) {
        return run;
      }
    }
    return undefined;
  }

  private getStatusMessage(): DogearMessage {
    const runs = Array.from(this.activeRuns.values()).map((r) => ({
      runId: r.runId,
      tabId: r.currentTabId,
      notebookId: r.notebookId,
    }));
    const activeNotebook = runs.length > 0 ? runs[0].notebookId : undefined;
    return {
      type: 'status',
      state: runs.length > 0 ? 'running' : 'idle',
      activeNotebook,
      runs: runs.length > 0 ? runs : undefined,
    };
  }

  /**
   * Attaches the bridge to a native messaging Port (D-1).
   * Emits hello message as the first frame upon connection (RQ-01, K-1).
   */
  attachPort(
    port: NativePortLike,
    portOptions?: { manifest?: ManifestLike; runtimeId?: string }
  ): void {
    const safeSend = (message: unknown) => {
      try {
        sendOutgoingMessage(port, message);
      } catch (_sendErr: unknown) {
        void _sendErr;
        // K-6, F-5: Abaikan error jika port sudah putus (mis. "Attempting to use a disconnected port object")
      }
    };

    const hello = createHelloMessage({
      manifest: portOptions?.manifest || this.manifest,
      runtimeId: portOptions?.runtimeId || this.runtimeId,
      buildOverride: this.buildOverride,
      versionOverride: this.versionOverride,
    });
    safeSend(hello);
    port.onMessage.addListener(async (msg: unknown) => {
      try {
        const response = await this.handleMessage(msg as HostMessage, (progress) => {
          safeSend(progress);
        });
        safeSend(response);
      } catch (err: unknown) {
        // INV-8: Never fail silently, never let an unexpected exception hang the host!
        try {
          const serialized = serializeError(err);
          safeSend({
            type: 'outcome',
            state: 'needs_review',
            reason: `Kesalahan internal jembatan: ${serialized.message}`,
            error: serialized,
            runId: (msg as HostMessage)?.action === 'run' ? (msg as Extract<HostMessage, { action: 'run' }>).runId : undefined,
          } satisfies DogearMessage);
        } catch (_catchErr: unknown) {
          void _catchErr;
        }
      }
    });

    if (port.onDisconnect?.addListener) {
      port.onDisconnect.addListener(() => {
        // K-6: If native host unexpectedly disconnects while running, abort all active runs
        for (const run of this.activeRuns.values()) {
          run.abortController.abort();
        }
      });
    }
  }

  /**
   * Dispatches an incoming host message to appropriate action.
   * Guarantees EXACTLY ONE terminal response for 'run' (INV-8, D-1, D-2).
   */
  async handleMessage(
    message: HostMessage,
    onProgress?: (progress: DogearMessage) => void
  ): Promise<DogearMessage> {
    if (!message || typeof message !== 'object') {
      return {
        type: 'outcome',
        state: 'needs_review',
        reason: 'Pesan host tidak valid (bukan objek)',
        error: serializeError(new Error('Invalid message payload')),
      };
    }

    switch (message.action) {
      case 'status':
        return this.getStatusMessage();

      case 'cancel': {
        // K-3 & K-4: Cancel reply is status, not outcome. Accepts optional runId.
        const targetRunId = message.runId;
        if (targetRunId) {
          const run = this.activeRuns.get(targetRunId);
          if (run) {
            run.abortController.abort();
          }
        } else {
          for (const run of this.activeRuns.values()) {
            run.abortController.abort();
          }
        }
        return this.getStatusMessage();
      }

      case 'run':
        return await this.executePipeline(message, onProgress);

      default: {
        const unknownAction = (message as { action?: string }).action;
        return {
          type: 'outcome',
          state: 'needs_review',
          reason: `Action tidak dikenal: '${unknownAction}'`,
          error: serializeError(new Error(`Unknown action: ${unknownAction}`)),
        };
      }
    }
  }

  /**
   * Cancels active pipeline if running (D-6, RQ-05, K-4).
   */
  cancel(runId?: string): { ok: boolean; status: 'cancelled' | 'not_running' } {
    if (this.activeRuns.size === 0) {
      return { ok: true, status: 'not_running' };
    }
    if (runId) {
      const run = this.activeRuns.get(runId);
      if (!run) return { ok: true, status: 'not_running' };
      run.abortController.abort();
    } else {
      for (const run of this.activeRuns.values()) {
        run.abortController.abort();
      }
    }
    return { ok: true, status: 'cancelled' };
  }

  /**
   * Executes notebook pipeline and produces exactly one terminal state.
   */
  private async executePipeline(
    message: Extract<HostMessage, { action: 'run' }>,
    onProgress?: (progress: DogearMessage) => void
  ): Promise<DogearMessage> {
    const runId =
      message.runId ||
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `run-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`);

    const withRunId = (outcome: Extract<DogearMessage, { type: 'outcome' }>): DogearMessage => {
      const activeState = this.activeRuns.get(runId);
      let reason = outcome.reason;
      if (activeState?.closeWarnings && activeState.closeWarnings.length > 0) {
        const warningsText = activeState.closeWarnings.join('; ');
        reason = reason ? `${reason}; ${warningsText}` : warningsText;
      }
      return {
        ...outcome,
        reason,
        runId,
      };
    };

    let targetTabId = message.tabId;
    if (targetTabId === undefined && this.platform.getActiveTab) {
      try {
        const activeTab = await this.platform.getActiveTab();
        targetTabId = activeTab?.id;
      } catch (_err: unknown) {
        void _err;
        // Tab aktif tidak dapat dibaca dari platform
      }
    }

    if (targetTabId === undefined) {
      return withRunId({
        type: 'outcome',
        state: 'needs_review',
        reason: 'Tab browser tidak ditemukan (tab hilang atau tabId tidak valid)',
        error: serializeError(new Error('Target tabId could not be resolved')),
      });
    }

    // K-2: Satu run aktif per tab. Tab sibuk ditolak seketika (RQ-05).
    const busyRun = this.getRunUsingTab(targetTabId);
    if (busyRun) {
      return withRunId({
        type: 'outcome',
        state: 'needs_review',
        reason: `Tab ${targetTabId} sedang digunakan oleh run '${busyRun.runId}'`,
        error: serializeError(new Error(`Tab ${targetTabId} busy in run ${busyRun.runId}`)),
      });
    }

    const abortController = new AbortController();
    const runState: ActiveRunState = {
      runId,
      tabId: targetTabId,
      currentTabId: targetTabId,
      tabStack: [targetTabId],
      notebookId: message.notebook_id || 'unnamed_notebook',
      abortController,
      closeWarnings: [],
    };
    this.activeRuns.set(runId, runState);
    this.platform.tabNavigator?.startTracking?.();

    try {
      // K-7: Run inline ditautkan dari store per-run di memori, tidak menulis ke akar store bersama
      const isInline = !!(message.notebook || message.files);
      const executionStore: ProjectStore = isInline ? new MemoryProjectStore() : this.store;

      if (isInline) {
        if (message.files) {
          for (const [filePath, content] of Object.entries(message.files)) {
            await executionStore.writeFile(filePath, content);
          }
        }
        if (message.notebook) {
          await executionStore.writeFile('notebook.md', message.notebook);
        }
      }

      let markdown = message.notebook;
      if (!markdown) {
        try {
          markdown = await executionStore.readFile('notebook.md');
        } catch {
          return withRunId({
            type: 'outcome',
            state: 'needs_review',
            reason: 'Berkas notebook.md tidak ditemukan di storage dan tidak disertakan dalam pesan',
            error: serializeError(new Error('notebook.md not found in project store')),
          });
        }
      }

      // 2. Parse notebook.md (Uji notebook rusak -> RQ-04)
      try {
        parseNotebookMarkdown(markdown);
      } catch (err: unknown) {
        return withRunId({
          type: 'outcome',
          state: 'needs_review',
          reason: `Notebook rusak: ${err instanceof Error ? err.message : String(err)}`,
          error: serializeError(err),
        });
      }

      let host = 'default';
      if (this.platform.getTabHost && targetTabId !== undefined) {
        try {
          const tabHost = await this.platform.getTabHost(targetTabId);
          if (tabHost) host = tabHost;
        } catch (_hostErr: unknown) {
          void _hostErr;
          // Tab host tidak dapat diakses
        }
      }

      // 4. Load cells and link dependencies
      let loaded;
      try {
        loaded = await loadNotebookCells(markdown, executionStore);
      } catch (err: unknown) {
        return withRunId({
          type: 'outcome',
          state: 'needs_review',
          reason: `Gagal memuat atau menautkan modul cell: ${err instanceof Error ? err.message : String(err)}`,
          error: serializeError(err),
        });
      }

      if (!loaded.cells || loaded.cells.length === 0) {
        return withRunId({
          type: 'outcome',
          state: 'skipped',
          reason: 'Tidak ada step aktif yang ditemukan dalam notebook',
        });
      }

      // 5. Eksekusi melalui PipelineRunner yang sama (INV-9)
      const executedCellIds: string[] = [];
      let lastSuccessCellId: string | null = null;
      let lastSignal = null;
      let lastCandidateIndex: number | undefined;
      const allCandidateMatches: Array<{
        cellId?: string;
        index: number;
        candidateIndex: number;
        candidate: string;
        candidates: string[];
      }> = [];

      // 4. Jalankan cell demi cell secara sekuensial
      for (let i = 0; i < loaded.cells.length; i++) {
        // Cek apakah pembatalan telah dipanggil sebelum memulai step ini
        if (runState.abortController.signal.aborted) {
          return withRunId({
            type: 'outcome',
            state: 'needs_review',
            reason: 'Eksekusi dibatalkan sebelum seluruh step selesai (cancel)',
            lastSuccessCellId,
            executedCellIds,
            candidateIndex: lastCandidateIndex,
            candidateMatches: allCandidateMatches.length > 0 ? allCandidateMatches : undefined,
          });
        }

        const cell = loaded.cells[i];
        if (onProgress) {
          onProgress({
            type: 'progress',
            runId,
            cellId: cell.id,
            status: 'running',
            percent: Math.round((i / loaded.cells.length) * 100),
          });
        }

        const stepStartedMs = Date.now();
        const startedAt = new Date().toISOString();
        // Jalankan cell menggunakan runner & platformAdapter yang sama (INV-9)
        const cellResult = await this.platform.scriptExecutor.executeScript({
          tabId: runState.currentTabId,
          world: cell.world || 'MAIN',
          cellId: cell.id,
          cellName: cell.name,
          source: cell.source,
          lineMap: cell.lineMap,
          allowTabRequests: true,
        });
        const completedAt = new Date().toISOString();
        const stepDurationMs = Date.now() - stepStartedMs;

        // T-05: Step reporting with dataDiff and evidence (RQ-03, RQ-04, RQ-05, RQ-06)
        const dataDiff = computeDataDiff(cellResult.ctxDataBefore || {}, cellResult.ctxDataAfter || {});
        const rawSnippet = cellResult.evidence?.domSnippet || '';
        const truncatedSnippet = truncateDomSnippet(rawSnippet);
        const stepEvidence: StepEvidence = {
          url: cellResult.evidence?.url || '',
          domSnippet: truncatedSnippet.domSnippet,
        };
        if (cellResult.evidence?.anchor) {
          stepEvidence.anchor = cellResult.evidence.anchor;
        }
        if (truncatedSnippet.truncated) {
          stepEvidence.truncated = true;
          stepEvidence.originalBytes = truncatedSnippet.originalBytes;
        }

        if (this.platform.captureVisibleTab) {
          try {
            const base64 = await this.platform.captureVisibleTab();
            if (base64) {
              stepEvidence.screenshot = { jpegBase64: base64 };
            }
          } catch {
            // Best-effort: ignore captureVisibleTab failure on background/minimized tabs (K-5, RQ-06)
          }
        }

        const outcomeSignal = evaluateCellOutcome(cellResult.result);
        let stepState: 'ok' | 'failed' | 'skipped' = 'ok';
        if (!cellResult.ok) {
          stepState = 'failed';
        } else if (outcomeSignal.status === 'skipped') {
          stepState = 'skipped';
        } else if (outcomeSignal.status === 'session_dead' || outcomeSignal.status === 'needs_review') {
          stepState = 'failed';
        }

        const candidatesTried = (!cellResult.ok)
          ? (cellResult.attemptedCandidates || cellResult.error?.candidates || [])
          : (cellResult.candidateMatch?.candidates || cellResult.attemptedCandidates || []);

        const stepMsg = createStepMessage({
          runId,
          cellId: cell.id,
          state: stepState,
          durationMs: stepDurationMs,
          candidateHit: stepState === 'failed' ? null : (cellResult.candidateIndex ?? null),
          candidatesTried,
          dataDiff,
          evidence: stepEvidence,
          error: !cellResult.ok
            ? (cellResult.error || serializeError(new Error(cellResult.output || 'Step execution failed')))
            : undefined,
        });

        if (onProgress) {
          onProgress(stepMsg);
        }

        if (this.store) {
          try {
            await recordRun(this.store, {
              stepId: cell.name || cell.id,
              startedAt,
              completedAt,
              status: cellResult.ok ? 'ok' : 'error',
              result: cellResult.result,
              output: cellResult.output,
              error: cellResult.error || null,
              host,
              candidateIndex: cellResult.candidateIndex,
              candidateMatch: cellResult.candidateMatch,
            });
          } catch (runErr) {
            console.warn('[Native Bridge] Failed to record run to runs/:', runErr);
          }
        }

        if (cellResult.ok && cellResult.candidateIndex !== undefined) {
          lastCandidateIndex = cellResult.candidateIndex;
          if (cellResult.candidateMatch) {
            allCandidateMatches.push({
              cellId: cell.id,
              ...cellResult.candidateMatch,
            });
          }
          if (onProgress) {
            onProgress({
              type: 'progress',
              cellId: cell.id,
              status: 'running',
              percent: Math.round(((i + 1) / loaded.cells.length) * 100),
              candidateIndex: cellResult.candidateIndex,
            });
          }
        }

        if (!cellResult.ok) {
          // Runtime error pada cell -> otomatis dipetakan ke needs_review (D-1, D-2, RQ-04)
          return withRunId({
            type: 'outcome',
            ...mapFailureToOutcome(cellResult.error || new Error(cellResult.output || 'Step execution failed')),
            lastSuccessCellId,
            executedCellIds,
            candidateIndex: lastCandidateIndex,
            candidateMatches: allCandidateMatches.length > 0 ? allCandidateMatches : undefined,
          });
        }

        executedCellIds.push(cell.id);
        lastSuccessCellId = cell.id;

        // D-6: Pastikan jika batalkan dipanggil tepat saat step selesai, step berikutnya TIDAK berjalan
        if (runState.abortController.signal.aborted) {
          return withRunId({
            type: 'outcome',
            state: 'needs_review',
            reason: 'Eksekusi dibatalkan sebelum seluruh step selesai (cancel)',
            lastSuccessCellId,
            executedCellIds,
            candidateIndex: lastCandidateIndex,
            candidateMatches: allCandidateMatches.length > 0 ? allCandidateMatches : undefined,
          });
        }

        // Evaluasi apakah cell menghasilkan sinyal khusus (completed, skipped, session_dead, needs_review)
        const outcome = evaluateCellOutcome(cellResult.result);
        lastSignal = outcome;

        // Jika langkah menyatakan 'skipped', 'session_dead', atau 'needs_review', hentikan alur segera
        if (outcome.status === 'skipped' || outcome.status === 'session_dead' || outcome.status === 'needs_review') {
          return withRunId({
            type: 'outcome',
            ...mapSignalToOutcome(outcome, lastSuccessCellId, executedCellIds),
            candidateIndex: lastCandidateIndex,
            candidateMatches: allCandidateMatches.length > 0 ? allCandidateMatches : undefined,
          });
        }

        // K-8: Laksanakan permintaan tab di batas langkah sesudah langkah selesai ok
        if (cellResult.ok && cellResult.tabRequest) {
          const tabReq = cellResult.tabRequest;
          const nav = this.platform.tabNavigator;

          if (tabReq.type === 'useNewTab') {
            const timeout = tabReq.timeout || 10000;
            let newTabId: number | null = null;
            if (nav) {
              try {
                newTabId = await nav.waitForNewTab(runState.currentTabId, stepStartedMs, timeout, runState.abortController.signal);
              } catch (waitErr: unknown) {
                const msg = waitErr instanceof Error ? waitErr.message : String(waitErr);
                return withRunId({
                  type: 'outcome',
                  state: 'needs_review',
                  reason: `Gagal menunggu tab baru (useNewTab): ${msg}`,
                  lastSuccessCellId,
                  executedCellIds,
                  candidateIndex: lastCandidateIndex,
                  candidateMatches: allCandidateMatches.length > 0 ? allCandidateMatches : undefined,
                });
              }
            }
            if (newTabId === null) {
              return withRunId({
                type: 'outcome',
                state: 'needs_review',
                reason: `Batas waktu ${timeout}ms terlampaui saat menunggu tab baru (useNewTab). Tidak ditemukan tab baru yang dibuka oleh tab ${runState.currentTabId} sejak langkah dimulai. Pastikan langkah mengklik elemen yang membuka tab baru sebelum useNewTab.`,
                lastSuccessCellId,
                executedCellIds,
                candidateIndex: lastCandidateIndex,
                candidateMatches: allCandidateMatches.length > 0 ? allCandidateMatches : undefined,
              });
            }
            runState.tabStack.push(runState.currentTabId);
            runState.currentTabId = newTabId;
          } else if (tabReq.type === 'openTab') {
            if (nav) {
              try {
                const newTabId = await nav.openTab(tabReq.url, runState.abortController.signal);
                runState.tabStack.push(runState.currentTabId);
                runState.currentTabId = newTabId;
              } catch (openErr: unknown) {
                const msg = openErr instanceof Error ? openErr.message : String(openErr);
                return withRunId({
                  type: 'outcome',
                  state: 'needs_review',
                  reason: `Gagal membuka tab baru (${tabReq.url}): ${msg}`,
                  lastSuccessCellId,
                  executedCellIds,
                  candidateIndex: lastCandidateIndex,
                  candidateMatches: allCandidateMatches.length > 0 ? allCandidateMatches : undefined,
                });
              }
            }
          } else if (tabReq.type === 'goto') {
            if (nav) {
              try {
                await nav.goto(runState.currentTabId, tabReq.url, runState.abortController.signal);
              } catch (gotoErr: unknown) {
                const msg = gotoErr instanceof Error ? gotoErr.message : String(gotoErr);
                return withRunId({
                  type: 'outcome',
                  state: 'needs_review',
                  reason: `Gagal berpindah URL (${tabReq.url}): ${msg}`,
                  lastSuccessCellId,
                  executedCellIds,
                  candidateIndex: lastCandidateIndex,
                  candidateMatches: allCandidateMatches.length > 0 ? allCandidateMatches : undefined,
                });
              }
            }
          } else if (tabReq.type === 'backToOpener') {
            if (runState.tabStack.length === 0) {
              return withRunId({
                type: 'outcome',
                state: 'needs_review',
                reason: 'Tidak ada tab pembuka dalam tumpukan tab (backToOpener). Tumpukan tab kosong; langkah sebelumnya belum membuka atau berpindah ke tab baru.',
                lastSuccessCellId,
                executedCellIds,
                candidateIndex: lastCandidateIndex,
                candidateMatches: allCandidateMatches.length > 0 ? allCandidateMatches : undefined,
              });
            }
            const prevTabId = runState.tabStack.pop()!;
            const abandonedTabId = runState.currentTabId;
            if (tabReq.close && nav) {
              try {
                await nav.closeTab(abandonedTabId);
              } catch (closeErr: unknown) {
                const msg = closeErr instanceof Error ? closeErr.message : String(closeErr);
                runState.closeWarnings.push(`Peringatan penutupan tab: gagal menutup tab ${abandonedTabId}: ${msg}`);
              }
            }
            runState.currentTabId = prevTabId;
          }
        }
      }

      // Semua cell selesai berjalan normal
      const finalOutcome = lastSignal || { status: 'completed' as TerminalState };
      return withRunId({
        type: 'outcome',
        ...mapSignalToOutcome(finalOutcome, lastSuccessCellId, executedCellIds),
        candidateIndex: lastCandidateIndex,
        candidateMatches: allCandidateMatches.length > 0 ? allCandidateMatches : undefined,
      });
    } finally {
      this.platform.tabNavigator?.stopTracking?.();
      this.activeRuns.delete(runId);
    }
  }
}

export const nativeBridge = new NativeBridge();
