/**
 * extension/kernel/checkpoint.ts
 * Checkpoint and state snapshot/restore for cross-navigation execution (D-1, D-5, D-6, RQ-02, RQ-03, RQ-04).
 * Handles serializable snapshotting of ctx.data, excluding DOM references and uncloneable objects.
 */

import type { StorageArea } from '../platform/interface';

export interface CheckpointData {
  lastSuccessCellId: string | null;
  data: Record<string, unknown>;
  savedAt: number;
}

export const CHECKPOINT_SCHEMA_PREFIX = 'nb:checkpoint';

export function checkpointKey(host: string): string {
  const cleanHost = host || 'default';
  return `${CHECKPOINT_SCHEMA_PREFIX}:${cleanHost}`;
}

/**
 * Injected checkpoint helper definitions for cell execution realm (D-1, D-5).
 * Single source of truth (F-5 A-2) imported directly by platform script executors.
 */
export const INJECTED_CHECKPOINT_SCRIPT = `
  const safeSnapshot = (data) => {
    if (!data || typeof data !== 'object') return {};
    try { return structuredClone(data); } catch {
      const out = {};
      for (const [k, v] of Object.entries(data)) {
        try { out[k] = JSON.parse(JSON.stringify(v)); } catch {}
      }
      return out;
    }
  };
`;

/**
 * Snapshot only the serializable ctx.data.
 * DOM nodes live in ctx.refs -> excluded (D-5, INV-7).
 * Uses structuredClone with JSON fallback that drops non-serializable fields rather than failing.
 */
export function safeSnapshot(data: Record<string, unknown>): Record<string, unknown> {
  if (!data || typeof data !== 'object') {
    return {};
  }
  try {
    return structuredClone(data);
  } catch {
    // Fallback: drop fields that cannot be serialized, do not fail entirely (D-5, INV-7)
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      try {
        out[k] = JSON.parse(JSON.stringify(v));
      } catch {
        // Drop un-serializable property safely
      }
    }
    return out;
  }
}

export async function loadCheckpoint(storage: StorageArea, host: string): Promise<CheckpointData | null> {
  const key = checkpointKey(host);
  const cp = await storage.get<CheckpointData>(key);
  if (!cp || typeof cp !== 'object') return null;
  return {
    lastSuccessCellId: cp.lastSuccessCellId || null,
    data: safeSnapshot(cp.data || {}),
    savedAt: typeof cp.savedAt === 'number' ? cp.savedAt : Date.now(),
  };
}

export async function saveCheckpoint(
  storage: StorageArea,
  host: string,
  checkpoint: { lastSuccessCellId: string | null; data: Record<string, unknown> } | null
): Promise<void> {
  const key = checkpointKey(host);
  if (!checkpoint) {
    await storage.remove(key);
    return;
  }
  const payload: CheckpointData = {
    lastSuccessCellId: checkpoint.lastSuccessCellId,
    data: safeSnapshot(checkpoint.data),
    savedAt: Date.now(),
  };
  await storage.set(key, payload);
}

export async function clearCheckpoint(storage: StorageArea, host: string): Promise<void> {
  const key = checkpointKey(host);
  await storage.remove(key);
}
