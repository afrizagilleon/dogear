/**
 * extension/kernel/auto.ts
 * Auto mode state and page-load budget management (D-4, RQ-07).
 * Owns persisted arming state, budget counters, and automatic disarm triggers across page loads.
 */

import type { StorageArea } from '../platform/interface';

export interface AutoState {
  armed: boolean;
  loads: number;
  maxLoads: number;
}

export const DEFAULT_MAX_LOADS = 200;
export const AUTO_SCHEMA_PREFIX = 'nb:auto';

export function autoKey(host: string): string {
  const cleanHost = host || 'default';
  return `${AUTO_SCHEMA_PREFIX}:${cleanHost}`;
}

export async function loadAuto(storage: StorageArea, host: string): Promise<AutoState> {
  const key = autoKey(host);
  const s = await storage.get<AutoState>(key);
  if (!s || typeof s !== 'object') {
    return { armed: false, loads: 0, maxLoads: DEFAULT_MAX_LOADS };
  }
  return {
    armed: !!s.armed,
    loads: typeof s.loads === 'number' ? s.loads : 0,
    maxLoads: typeof s.maxLoads === 'number' ? s.maxLoads : DEFAULT_MAX_LOADS,
  };
}

export async function saveAuto(storage: StorageArea, host: string, state: AutoState): Promise<void> {
  const key = autoKey(host);
  await storage.set(key, {
    armed: state.armed,
    loads: state.loads,
    maxLoads: state.maxLoads,
  });
}

/**
 * Arm Auto mode and reset the page-load budget (D-4).
 */
export async function armAuto(storage: StorageArea, host: string, maxLoads = DEFAULT_MAX_LOADS): Promise<AutoState> {
  const state: AutoState = {
    armed: true,
    loads: 0,
    maxLoads,
  };
  await saveAuto(storage, host, state);
  return state;
}

/**
 * Disarm Auto mode — pipeline will not auto-resume on the next load.
 */
export async function disarmAuto(storage: StorageArea, host: string): Promise<AutoState> {
  const state = await loadAuto(storage, host);
  state.armed = false;
  await saveAuto(storage, host, state);
  return state;
}

/**
 * Count one auto-resumed page load.
 * Returns false (and disarms) if the budget is spent, with an expressive diagnostic message (D-4, INV-8).
 */
export async function tickAutoLoad(
  storage: StorageArea,
  host: string
): Promise<{ ok: boolean; state: AutoState; reason?: string }> {
  const state = await loadAuto(storage, host);
  state.loads++;
  if (state.loads > state.maxLoads) {
    state.armed = false;
    await saveAuto(storage, host, state);
    return {
      ok: false,
      state,
      reason: `Budget page-load habis (tercapai ${state.loads}/${state.maxLoads})`,
    };
  }
  await saveAuto(storage, host, state);
  return { ok: true, state };
}
