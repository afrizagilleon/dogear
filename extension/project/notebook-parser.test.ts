/**
 * extension/project/notebook-parser.test.ts
 * Tests for notebook.md parsing and step filtering (RQ-09, T-08).
 */

import { describe, it, expect } from 'vitest';
import { parseNotebookMarkdown, loadNotebookCells, serializeNotebookMarkdown } from './notebook-parser';
import { MemoryProjectStore } from './memory';

describe('T-08: Notebook Markdown Parser (RQ-09)', () => {
  const sampleNotebook = `---
name: "E-Commerce Checkout Pipeline"
steps:
  - path: steps/01-login.js
    name: "User Login"
    enabled: true
  - path: steps/02-mfa.js
    name: "SMS MFA Verification"
    enabled: false
  - path: steps/03-checkout.js
    name: "Complete Purchase"
    enabled: true
---

# E-Commerce Checkout Pipeline

This notebook runs the automated checkout flow while skipping MFA in staging.
`;

  it('parses frontmatter and filters enabled steps accurately', () => {
    const parsed = parseNotebookMarkdown(sampleNotebook);

    expect(parsed.name).toBe('E-Commerce Checkout Pipeline');
    expect(parsed.allSteps).toHaveLength(3);

    // Expected enabled steps: only steps 1 and 3 in exact order
    expect(parsed.enabledSteps).toHaveLength(2);
    expect(parsed.enabledSteps[0]).toEqual({
      path: 'steps/01-login.js',
      name: 'User Login',
      enabled: true,
      world: 'MAIN',
    });
    expect(parsed.enabledSteps[1]).toEqual({
      path: 'steps/03-checkout.js',
      name: 'Complete Purchase',
      enabled: true,
      world: 'MAIN',
    });
  });

  it('loads and links cells for enabled steps from ProjectStore', async () => {
    const store = new MemoryProjectStore();
    await store.writeFile('lib/auth.js', 'export const token = "abc";');
    await store.writeFile('steps/01-login.js', 'import { token } from "../lib/auth.js"; return token;');
    await store.writeFile('steps/02-mfa.js', 'throw new Error("Disabled step should not run");');
    await store.writeFile('steps/03-checkout.js', 'return 200;');

    const { notebook, cells } = await loadNotebookCells(sampleNotebook, store);

    expect(notebook.enabledSteps.map((s) => s.path)).toEqual([
      'steps/01-login.js',
      'steps/03-checkout.js',
    ]);
    expect(cells).toHaveLength(2);
    expect(cells[0].id).toBe('steps/01-login.js');
    expect(cells[1].id).toBe('steps/03-checkout.js');
  });

  it('serializes notebook back to valid markdown that parses equivalently', () => {
    const original = {
      name: 'Flow Uji Coba',
      description: 'Catatan tambahan.',
      allSteps: [
        { path: 'steps/01-init.js', name: 'Inisialisasi', enabled: true },
        { path: 'steps/02-skip.js', name: 'Langkah Skip', enabled: false },
      ],
    };

    const serialized = serializeNotebookMarkdown(original);
    const parsed = parseNotebookMarkdown(serialized);

    expect(parsed.name).toBe('Flow Uji Coba');
    expect(parsed.description).toBe('Catatan tambahan.');
    expect(parsed.allSteps).toHaveLength(2);
    expect(parsed.allSteps[0]).toEqual({
      path: 'steps/01-init.js',
      name: 'Inisialisasi',
      enabled: true,
      world: 'MAIN',
    });
    expect(parsed.allSteps[1]).toEqual({
      path: 'steps/02-skip.js',
      name: 'Langkah Skip',
      enabled: false,
      world: 'MAIN',
    });
    expect(parsed.enabledSteps).toHaveLength(1);
  });
});
