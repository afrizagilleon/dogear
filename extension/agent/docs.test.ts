/**
 * extension/agent/docs.test.ts
 * Verifies AGENTS.md content template for notebook project store (A1-T4, RQ-08).
 */

import { describe, it, expect } from 'vitest';
import { AGENTS_MD_CONTENT } from './docs';
import { MemoryProjectStore } from '../project/memory';

describe('AGENTS.md documentation template (A1-T4, RQ-08)', () => {
  it('contains essential sections required for autonomous agent integration', () => {
    expect(AGENTS_MD_CONTENT).toContain('## 1. Antarmuka Folder');
    expect(AGENTS_MD_CONTENT).toContain('## 2. Mengirim Request Eksekusi (`requests/*.json`)');
    expect(AGENTS_MD_CONTENT).toContain('## 3. Siklus Pemrosesan & Pemindahan Request');
    expect(AGENTS_MD_CONTENT).toContain('## 4. Membaca Hasil Eksekusi (`runs/*.json`)');
    expect(AGENTS_MD_CONTENT).toContain('## 5. Model Kepercayaan & Keamanan');
    expect(AGENTS_MD_CONTENT).toContain('## 6. Batasan Platform Browser');
    expect(AGENTS_MD_CONTENT).toContain('## 7. Perilaku Service Worker Sleep & Lifecycle');
    expect(AGENTS_MD_CONTENT).toContain('requests/processed/');
    expect(AGENTS_MD_CONTENT).toContain('SiteNotRegisteredError');
  });

  it('can be written and read from a ProjectStore instance', async () => {
    const store = new MemoryProjectStore();
    await store.writeFile('AGENTS.md', AGENTS_MD_CONTENT);
    const readBack = await store.readFile('AGENTS.md');
    expect(readBack).toBe(AGENTS_MD_CONTENT);
  });
});
