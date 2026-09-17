/**
 * extension/native/port-opfs.test.ts
 * Tests for updating notebooks via port into storage (T-05, RQ-06, D-4).
 * Proves that the host can send v1 -> runs Hasil A, then send v2 with new code -> runs Hasil B,
 * with non-interchangeable values, proving updates without rebuilding extension.
 */

import { describe, it, expect } from 'vitest';
import { NativeBridge } from './bridge';
import { MemoryProjectStore } from '../project/memory';
import type { PlatformAdapter, ScriptExecutionOptions, ScriptExecutionResult } from '../platform/interface';

describe('T-05: Notebook via port -> Store update (RQ-06, D-4)', () => {
  it('sends notebook v1 -> runs Hasil A; sends notebook v2 -> runs Hasil B with non-interchangeable values', async () => {
    const store = new MemoryProjectStore();

    let currentScriptContent = '';

    const mockPlatform: Partial<PlatformAdapter> = {
      scriptExecutor: {
        executeScript: async (options: ScriptExecutionOptions): Promise<ScriptExecutionResult> => {
          currentScriptContent = options.source;

          // Execute the dynamic cell source in controlled test scope
          if (options.source.includes('8848411')) {
            return {
              ok: true,
              output: 'Hasil V1: 8848411',
              result: {
                status: 'completed',
                data: { computedValue: 8848411, version: 'v1.0.0' },
              },
            };
          }

          if (options.source.includes('9919293')) {
            return {
              ok: true,
              output: 'Hasil V2: 9919293',
              result: {
                status: 'completed',
                data: { computedValue: 9919293, version: 'v2.0.0-updated' },
              },
            };
          }

          if (options.source.includes('7727188')) {
            return {
              ok: true,
              output: 'Hasil Root OPFS: 7727188',
              result: {
                status: 'completed',
                data: { computedValue: 7727188, version: 'v-root' },
              },
            };
          }

          return { ok: true, output: 'ok' };
        },
      },
    };

    const bridge = new NativeBridge({
      platformAdapter: mockPlatform as PlatformAdapter,
      projectStore: store,
    });

    // =========================================================================
    // 1. KIRIM NOTEBOOK V1 LEWAT PORT
    // =========================================================================
    const v1Markdown = `---
name: "Revenue Calculator V1"
steps:
  - path: "steps/compute.js"
    name: "Calculate V1"
---

# Revenue Calculator V1
`;
    const v1Files = {
      'steps/compute.js': `// V1 computation logic
const val = 8848411; // Unik V1
return { status: 'completed', data: { computedValue: val, version: 'v1.0.0' } };
`,
    };

    const resA = await bridge.handleMessage({
      action: 'run',
      notebook_id: 'nb-revenue',
      version: '1.0.0',
      notebook: v1Markdown,
      files: v1Files,
      tabId: 201,
    });

    // Verifikasi Hasil A (v1)
    expect(resA.type).toBe('outcome');
    if (resA.type === 'outcome') {
      expect(resA.state).toBe('completed');
      expect(resA.data?.computedValue).toBe(8848411);
      expect(resA.data?.version).toBe('v1.0.0');
    }

    // K-7: Akar store tidak tersentuh oleh run inline (diisolasi di memori per-run)
    expect(await store.exists('notebook.md')).toBe(false);
    expect(await store.exists('steps/compute.js')).toBe(false);
    // Namun run mengeksekusi kodenya sendiri
    expect(currentScriptContent).toContain('8848411');

    // =========================================================================
    // 2. KIRIM NOTEBOOK V2 LEWAT PORT (DIPERBARUI TANPA REBUILD EKSTENSI)
    // =========================================================================
    const v2Markdown = `---
name: "Revenue Calculator V2 Updated"
steps:
  - path: "steps/compute.js"
    name: "Calculate V2 Updated"
---

# Revenue Calculator V2 Updated
`;
    const v2Files = {
      'steps/compute.js': `// V2 updated computation logic
const val = 9919293; // Unik V2 (tidak mungkin tertukar)
return { status: 'completed', data: { computedValue: val, version: 'v2.0.0-updated' } };
`,
    };

    const resB = await bridge.handleMessage({
      action: 'run',
      notebook_id: 'nb-revenue',
      version: '2.0.0',
      notebook: v2Markdown,
      files: v2Files,
      tabId: 201,
    });

    // Verifikasi Hasil B (v2)
    expect(resB.type).toBe('outcome');
    if (resB.type === 'outcome') {
      expect(resB.state).toBe('completed');
      expect(resB.data?.computedValue).toBe(9919293);
      expect(resB.data?.version).toBe('v2.0.0-updated');
    }

    // K-7: Akar store tetap tidak tersentuh oleh run inline v2
    expect(await store.exists('notebook.md')).toBe(false);
    expect(await store.exists('steps/compute.js')).toBe(false);
    expect(currentScriptContent).toContain('9919293');

    // Nilai Hasil A dan Hasil B saling berbeda secara mutlak
    if (resA.type === 'outcome' && resB.type === 'outcome') {
      expect(resA.data?.computedValue).not.toEqual(resB.data?.computedValue);
    }

    // =========================================================================
    // 3. RUN TANPA NOTEBOOK TETAP MEMBACA AKAR STORE (K-7 OPFS MODE)
    // =========================================================================
    const rootMarkdown = `---
name: "Revenue Calculator Root OPFS"
steps:
  - path: "steps/compute.js"
    name: "Calculate Root OPFS"
---
# Root OPFS
`;
    await store.writeFile('notebook.md', rootMarkdown);
    await store.writeFile('steps/compute.js', `return { status: 'completed', data: { computedValue: 7727188, version: 'v-root' } };`);

    const resRoot = await bridge.handleMessage({
      action: 'run',
      notebook_id: 'nb-revenue-root',
      tabId: 201,
      // Tanpa notebook dan tanpa files -> membaca dari akar store
    });

    expect(resRoot.type).toBe('outcome');
    if (resRoot.type === 'outcome') {
      expect(resRoot.state).toBe('completed');
      expect(resRoot.data?.computedValue).toBe(7727188);
      expect(resRoot.data?.version).toBe('v-root');
    }
  });
});
