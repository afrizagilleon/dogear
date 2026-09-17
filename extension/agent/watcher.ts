/**
 * extension/agent/watcher.ts
 * Agent request directory watcher & polling scheduler (D-3, D-4, RQ-03, RQ-05, RQ-06).
 * Scans requests/*.json, delegates execution to processAgentRequestFile,
 * and maintains active polling cycle without external servers or sockets (INV-11).
 */

import type { ProjectStore, PlatformAdapter } from '../platform/interface';
import { processAgentRequestFile, type ProcessRequestResult } from './processor';

export class AgentWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;
  private defaultIntervalMs = 300;

  async pollOnce(
    store: ProjectStore,
    options?: {
      tabId?: number;
      platformAdapter?: PlatformAdapter;
    }
  ): Promise<ProcessRequestResult[]> {
    if (this.isProcessing) return [];
    this.isProcessing = true;

    try {
      const entries = await store.listFiles('requests');
      const pending = entries
        .filter(
          (e) =>
            e.kind === 'file' &&
            e.path.startsWith('requests/') &&
            !e.path.startsWith('requests/processed/') &&
            e.path.endsWith('.json')
        )
        .sort((a, b) => a.path.localeCompare(b.path));

      const results: ProcessRequestResult[] = [];
      for (const entry of pending) {
        const res = await processAgentRequestFile(store, entry.path, options);
        results.push(res);
      }
      return results;
    } catch (err) {
      console.warn('[dogear AgentWatcher] Polling iteration error:', err);
      return [];
    } finally {
      this.isProcessing = false;
    }
  }

  start(
    store: ProjectStore,
    intervalMs = this.defaultIntervalMs,
    options?: {
      tabId?: number;
      platformAdapter?: PlatformAdapter;
    }
  ): void {
    this.stop();
    // Run immediately once
    this.pollOnce(store, options).catch(() => {});
    this.timer = setInterval(() => {
      this.pollOnce(store, options).catch(() => {});
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }
}

export const agentWatcher = new AgentWatcher();
