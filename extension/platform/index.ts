/**
 * extension/platform/index.ts
 * Platform adapter factory and exports (D-4, RQ-06, M3 A-1).
 */

import type { PlatformAdapter } from './interface';
import type { BrowserTarget } from '../shared/types';
import { ChromiumPlatformAdapter } from './chromium';
import { FirefoxPlatformAdapter } from './firefox';

export * from './interface';
export * from './chromium';
export * from './firefox';
export * from './fetch';

let currentAdapter: PlatformAdapter | null = null;

export function setPlatformAdapterForTesting(adapter: PlatformAdapter | null): void {
  currentAdapter = adapter;
}

export function getPlatformAdapter(overrideTarget?: BrowserTarget): PlatformAdapter {
  if (overrideTarget === 'firefox') {
    return new FirefoxPlatformAdapter();
  }
  if (overrideTarget === 'chrome') {
    return new ChromiumPlatformAdapter();
  }

  if (currentAdapter) {
    return currentAdapter;
  }

  // Detect runtime browser environment
  const isFirefox = typeof (globalThis as Record<string, unknown>).browser !== 'undefined'
    && typeof (globalThis as Record<string, unknown>).chrome === 'undefined';

  currentAdapter = isFirefox ? new FirefoxPlatformAdapter() : new ChromiumPlatformAdapter();
  return currentAdapter;
}
