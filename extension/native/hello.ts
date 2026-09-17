/**
 * extension/native/hello.ts
 * Handshake hello frame creation and profileHint calculation (RQ-01, K-1, K-2).
 * Architectural compliance: no direct chrome.* calls outside platform/ and entrypoints/ (INV-2).
 */

import type { HelloMessage } from './types';

export function computeProfileHint(id: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export interface ManifestLike {
  name?: string;
  version?: string;
  action?: unknown;
}

export function detectBuildType(manifest?: ManifestLike): 'studio' | 'runtime' {
  if (!manifest) return 'studio';
  const name = (manifest.name || '').toLowerCase();
  if (name.includes('runtime') || !manifest.action) {
    return 'runtime';
  }
  return 'studio';
}

export function createHelloMessage(options?: {
  manifest?: ManifestLike;
  runtimeId?: string;
  buildOverride?: 'studio' | 'runtime';
  versionOverride?: string;
}): HelloMessage {
  const manifest = options?.manifest;
  const build = options?.buildOverride || detectBuildType(manifest);
  const extVersion = options?.versionOverride || manifest?.version || '0.1.0';
  const id = options?.runtimeId;
  const profileHint = id ? computeProfileHint(id) : undefined;

  return {
    type: 'hello',
    build,
    extVersion,
    ...(profileHint ? { profileHint } : {}),
  };
}
