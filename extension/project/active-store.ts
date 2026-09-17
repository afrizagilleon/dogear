/**
 * extension/project/active-store.ts
 * Global active ProjectStore reference manager across extension components.
 */

import type { ProjectStore } from '../platform/interface';

let globalActiveStore: ProjectStore | null = null;

export function setActiveStore(store: ProjectStore | null): void {
  globalActiveStore = store;
}

export function getActiveStore(): ProjectStore | null {
  return globalActiveStore;
}
