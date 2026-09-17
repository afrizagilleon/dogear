/**
 * extension/entrypoints/editor/main.ts
 * Full-tab editor entrypoint (RQ-12, D-4).
 */

import { mountEditor, EditorApp } from '../../ui/editor';
import { INJECTED_HUD_SCRIPT } from '../../ui/hud';
import { kernelService } from '../../kernel';
import { getPlatformAdapter, setInjectedHudScript } from '../../platform';
import { OpfsProjectStore } from '../../project/opfs';
import { MemoryProjectStore } from '../../project/memory';
import { DiskProjectStore } from '../../project/disk';
import type { ProjectStore } from '../../platform/interface';

setInjectedHudScript(INJECTED_HUD_SCRIPT);

console.log('[dogear] Editor tab entrypoint initialized');
const g = (typeof window !== 'undefined' ? window : globalThis) as Record<string, unknown>;
g.__nbMountEditor = mountEditor;
g.__nbEditorApp = EditorApp;
g.__nbKernelService = kernelService;
g.__nbPlatformAdapter = getPlatformAdapter();
g.__nbOpfsStore = new OpfsProjectStore();
g.__nbMemoryStore = new MemoryProjectStore();
g.__nbDiskProjectStore = DiskProjectStore;

// Auto-mount from URL query params (e.g. ?file=steps/01-init.js)
if (typeof document !== 'undefined') {
  const root = document.getElementById('root');
  if (root) {
    const params = new URLSearchParams(window.location.search);
    const file = params.get('file') || 'steps/01-init.js';
    const store = ((g.__nbCurrentStore || g.__nbOpfsStore) as ProjectStore) || new OpfsProjectStore();
    mountEditor(root, {
      filePath: file,
      projectStore: store,
    });
  }
}
