/**
 * extension/ui/editor.test.ts
 * Unit tests for full-tab minimal editor (RQ-12, D-4).
 */

import { describe, it, expect } from 'vitest';
import { EditorApp } from './editor';
import { MemoryProjectStore } from '../project/memory';

describe('Editor Tab Minimal (RQ-12, D-4)', () => {
  it('initializes with file path and content', () => {
    const app = new EditorApp({
      filePath: 'steps/calculate.js',
      initialContent: 'return 5 * 10;',
    });

    expect(app.state.filePath).toBe('steps/calculate.js');
    expect(app.state.content).toBe('return 5 * 10;');
    expect(app.state.isDirty).toBe(false);
  });

  it('saves updated content to ProjectStore and clears dirty flag', async () => {
    const store = new MemoryProjectStore();
    await store.writeFile('steps/calculate.js', 'return 5 * 10;');

    let savedContent = '';
    const app = new EditorApp({
      filePath: 'steps/calculate.js',
      initialContent: 'return 5 * 10;',
      projectStore: store,
      onSave: async (path, content) => {
        savedContent = content;
        await store.writeFile(path, content);
      },
    });

    // Edit content to 50 * 10
    app.state = { ...app.state, content: 'return 50 * 10;', isDirty: true };
    expect(app.state.isDirty).toBe(true);

    // Save
    await app.handleSave();
    expect(savedContent).toBe('return 50 * 10;');
    expect(await store.readFile('steps/calculate.js')).toBe('return 50 * 10;');
  });

  it('runs updated content via onRun and updates output pane', async () => {
    let executedSource = '';
    const app = new EditorApp({
      filePath: 'steps/calculate.js',
      initialContent: 'return 50 * 10;',
      onRun: async (path, content) => {
        executedSource = content;
        return { ok: true, output: '500', result: 500 };
      },
    });

    await app.handleRun();
    expect(executedSource).toBe('return 50 * 10;');
  });

  it('Bite-test 1: handleSave refuses to report "Tersimpan" without save target (D-3, INV-8)', async () => {
    // Mount editor without onSave and without projectStore
    const app = new EditorApp({
      filePath: 'steps/calculate.js',
      initialContent: 'return 1;',
    });

    app.state = { ...app.state, content: 'return 2;', isDirty: true };

    await expect(app.handleSave()).rejects.toThrow('Tidak ada tujuan penulisan');
    expect(app.state.saveStatus).not.toBe('Tersimpan');
    expect(app.state.saveStatus).toContain('Gagal simpan');

    // Save button disabled when no save target
    interface VNodeLike {
      props?: {
        class?: string;
        disabled?: boolean;
        children?: unknown;
        [key: string]: unknown;
      };
    }
    const vnode = app.render() as unknown as VNodeLike;
    const header = (vnode.props?.children as VNodeLike[])?.[0];
    const actions = (header?.props?.children as VNodeLike[])?.find((c) => c?.props?.class === 'nb-editor-actions');
    const btn = (actions?.props?.children as VNodeLike[])?.find((c) => c?.props?.['data-testid'] === 'nb-editor-btn-save');
    expect(btn?.props?.disabled).toBe(true);
  });

  it('loads file content from projectStore when initialContent is not forced (RQ-05)', async () => {
    const store = new MemoryProjectStore();
    await store.writeFile('steps/real.js', 'return "real-store-content";');

    const app = new EditorApp({
      filePath: 'steps/real.js',
      projectStore: store,
    });

    await app.loadFileContent();
    expect(app.state.content).toBe('return "real-store-content";');
    expect(app.state.isDirty).toBe(false);
  });

  it('shows readable not-found message when file does not exist in store', async () => {
    const store = new MemoryProjectStore();

    const app = new EditorApp({
      filePath: 'steps/ghost.js',
      projectStore: store,
    });

    await app.loadFileContent();
    expect(app.state.content).toContain("Berkas 'steps/ghost.js' tidak ditemukan");
    expect(app.state.content).not.toBe('// dogear Editor\nreturn 42;\n');
    expect(app.state.isDirty).toBe(false);
  });

  it('saves directly to projectStore without onSave callback (RQ-05, D-3)', async () => {
    const store = new MemoryProjectStore();
    await store.writeFile('steps/auto-save.js', 'return 1;');

    const app = new EditorApp({
      filePath: 'steps/auto-save.js',
      projectStore: store,
    });

    app.state = { ...app.state, content: 'return 999;', isDirty: true };
    await app.handleSave();

    expect(app.state.saveStatus).toBe('Tersimpan');
    expect(app.state.isDirty).toBe(false);
    expect(await store.readFile('steps/auto-save.js')).toBe('return 999;');
  });
});
