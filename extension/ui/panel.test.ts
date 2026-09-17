import { describe, it, expect } from 'vitest';
import { formatScratchResult, SidePanelApp, CELL_BUSY_REASON, type SidePanelState, type StepItem } from './panel';
import { MemoryProjectStore } from '../project/memory';
import type { ProjectStore } from '../platform/interface';

describe('M-11 formatScratchResult (T-05, RQ-05)', () => {
  it('formats regular values distinctly (numbers, booleans, strings)', () => {
    expect(formatScratchResult({ ok: true, result: 42 })).toEqual({
      text: '42',
      isError: false,
    });
    expect(formatScratchResult({ ok: true, result: true })).toEqual({
      text: 'true',
      isError: false,
    });
    expect(formatScratchResult({ ok: true, result: 'halo' })).toEqual({
      text: 'halo',
      isError: false,
    });
  });

  it('formats undefined as literal "undefined" (never empty string)', () => {
    const res = formatScratchResult({ ok: true, result: undefined });
    expect(res.text).toBe('undefined');
    expect(res.isError).toBe(false);
  });

  it('formats null as literal "null"', () => {
    const res = formatScratchResult({ ok: true, result: null });
    expect(res.text).toBe('null');
    expect(res.isError).toBe(false);
  });

  it('formats empty string as visible quotes \'""\'', () => {
    const res = formatScratchResult({ ok: true, result: '' });
    expect(res.text).toBe('""');
    expect(res.isError).toBe(false);
  });

  it('formats object/array as pretty-printed JSON (not [object Object])', () => {
    const obj = { nama: 'budi', skor: 100 };
    const res = formatScratchResult({ ok: true, result: obj });
    expect(res.text).toBe(JSON.stringify(obj, null, 2));
    expect(res.text).not.toContain('[object Object]');
    expect(res.isError).toBe(false);
  });

  it('formats aborted cell as stopped, not as an ordinary failure', () => {
    expect(formatScratchResult({
      ok: false,
      aborted: true,
      output: '■ stopped',
      error: { name: 'AbortError', message: 'aborted' },
    })).toEqual({
      text: '■ stopped',
      isError: false,
    });
  });

  it('formats error with name, sebab, and tindakan', () => {
    const errorObj = {
      name: 'SelectorNotFoundError',
      message: 'Elemen tidak ditemukan',
      cause: 'Selector #submit tidak cocok di DOM',
      action: 'Periksa selector pada elemen target',
    };
    const res = formatScratchResult({
      ok: false,
      error: errorObj,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('\u2716 SelectorNotFoundError: Elemen tidak ditemukan');
    expect(res.text).toContain('Sebab: Selector #submit tidak cocok di DOM');
    expect(res.text).toContain('Tindakan: Periksa selector pada elemen target');
  });

  it('preserves printed output before the result if present', () => {
    const res = formatScratchResult({
      ok: true,
      result: 42,
      output: 'Menghitung nilai...',
    });
    expect(res.text).toBe('Menghitung nilai...\n42');
    expect(res.isError).toBe(false);
  });
});

describe('T-06: Panel footer edit button (RQ-07, D-8, D-9)', () => {
  interface VNodeLike {
    type: unknown;
    props?: {
      class?: string;
      disabled?: boolean;
      children?: unknown;
      onClick?: () => void;
      [key: string]: unknown;
    };
  }

  function findVNodes(vnode: unknown, pred: (v: VNodeLike) => boolean): VNodeLike[] {
    const results: VNodeLike[] = [];
    function walk(node: unknown) {
      if (!node || typeof node !== 'object') return;
      const v = node as VNodeLike;
      if (pred(v)) results.push(v);
      const children = v.props?.children;
      if (Array.isArray(children)) {
        for (const c of children) walk(c);
      } else if (children && typeof children === 'object') {
        walk(children);
      }
    }
    walk(vnode);
    return results;
  }

  it('renders edit button in footer and has NO nb-footer-inert elements anywhere in the tree', () => {
    const app = new SidePanelApp({
      steps: [
        { id: 'steps/01-init.js', name: 'Init', source: 'steps/01-init.js', enabled: true, order: 1 },
      ],
    });
    const vnode = app.render();

    const inertElements = findVNodes(vnode, (v) => {
      const cls = v.props?.class || '';
      return typeof cls === 'string' && cls.includes('nb-footer-inert');
    });
    expect(inertElements.length, 'No elements with nb-footer-inert should exist in panel').toBe(0);

    const editBtns = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-footer-edit');
    expect(editBtns.length).toBe(1);
    expect(editBtns[0].type).toBe('button');
  });

  it('disables edit button when no step is selected or steps are empty', () => {
    // Case 1: Empty steps
    const emptyApp = new SidePanelApp({ steps: [] });
    const emptyVnode = emptyApp.render();
    const emptyEditBtn = findVNodes(emptyVnode, (v) => v.props?.['data-testid'] === 'nb-footer-edit')[0];
    expect(emptyEditBtn).toBeDefined();
    expect(emptyEditBtn.props?.disabled).toBe(true);

    // Case 2: Steps provided but selectedStepId explicitly set to null
    const app = new SidePanelApp({
      steps: [
        { id: 'steps/01-init.js', name: 'Init', source: 'steps/01-init.js', enabled: true, order: 1 },
      ],
    });
    app.state = { ...app.state, selectedStepId: null };
    const vnode = app.render();
    const editBtn = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-footer-edit')[0];
    expect(editBtn).toBeDefined();
    expect(editBtn.props?.disabled).toBe(true);
  });

  it('enables edit button when a step is selected and calls onOpenEditor with the step file path on click', () => {
    let openedPath = '';
    const app = new SidePanelApp({
      steps: [
        { id: 'steps/01-init.js', name: 'Init', source: 'steps/01-init.js', enabled: true, order: 1 },
        { id: 'steps/02-action.js', name: 'Action', source: 'steps/02-action.js', enabled: true, order: 2 },
      ],
      onOpenEditor: (filePath) => {
        openedPath = filePath;
      },
    });

    // Default selection is first step
    expect(app.state.selectedStepId).toBe('steps/01-init.js');
    let vnode = app.render();
    let editBtn = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-footer-edit')[0];
    expect(editBtn.props?.disabled).toBe(false);

    // Trigger click on edit button
    editBtn.props?.onClick?.();
    expect(openedPath).toBe('steps/01-init.js');

    // Select second step
    app.state = { ...app.state, selectedStepId: 'steps/02-action.js' };
    vnode = app.render();
    editBtn = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-footer-edit')[0];
    editBtn.props?.onClick?.();
    expect(openedPath).toBe('steps/02-action.js');
  });

  it('renders stop disabled when idle and enabled while a scratch cell is running', () => {
    const app = new SidePanelApp({ steps: [] });
    let vnode = app.render();
    let stopBtn = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-footer-stop')[0];
    expect(stopBtn).toBeDefined();
    expect(stopBtn.type).toBe('button');
    expect(stopBtn.props?.disabled).toBe(true);
    expect(stopBtn.props?.children).toBe('stop');

    app.state = { ...app.state, scratchRunning: true };
    vnode = app.render();
    stopBtn = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-footer-stop')[0];
    expect(stopBtn.props?.disabled).toBe(false);
    expect(stopBtn.props?.['aria-label']).toBe('Hentikan sel yang sedang berjalan');
  });
});

describe('M18 T-03: lock every run control while a cell is running (bite-test 2)', () => {
  interface VNodeLike {
    type: unknown;
    props?: {
      class?: string;
      disabled?: boolean;
      title?: string;
      children?: unknown;
      [key: string]: unknown;
    };
  }

  function findVNodes(vnode: unknown, pred: (v: VNodeLike) => boolean): VNodeLike[] {
    const results: VNodeLike[] = [];
    function walk(node: unknown) {
      if (!node || typeof node !== 'object') return;
      const v = node as VNodeLike;
      if (pred(v)) results.push(v);
      const children = v.props?.children;
      if (Array.isArray(children)) {
        for (const c of children) walk(c);
      } else if (children && typeof children === 'object') {
        walk(children);
      }
    }
    walk(vnode);
    return results;
  }

  function busyPanel() {
    const app = new SidePanelApp({
      steps: [
        { id: 's1', name: 'Init', source: 'window.__nbSecondCell = true; return 1', enabled: true, order: 1 },
      ],
    });
    app.state = { ...app.state, scratchRunning: true };
    return app.render();
  }

  it('locks run all while a cell is running, with a readable reason', () => {
    const runAll = findVNodes(busyPanel(), (v) => v.props?.['data-testid'] === 'nb-btn-run-all')[0];
    expect(runAll).toBeDefined();
    expect(runAll.props?.disabled).toBe(true);
    expect(runAll.props?.title).toBe(CELL_BUSY_REASON);
    expect(runAll.props?.['aria-label']).toBe(CELL_BUSY_REASON);
  });

  it('locks per-step run while a cell is running, with a readable reason', () => {
    const runStep = findVNodes(busyPanel(), (v) => v.props?.['data-testid'] === 'nb-btn-run-s1')[0];
    expect(runStep).toBeDefined();
    expect(runStep.props?.disabled).toBe(true);
    expect(runStep.props?.title).toBe(CELL_BUSY_REASON);
    expect(runStep.props?.['aria-label']).toBe(CELL_BUSY_REASON);
  });

  it('locks pick while a cell is running, with a readable reason', () => {
    const pick = findVNodes(busyPanel(), (v) => v.props?.['data-testid'] === 'nb-footer-pick')[0];
    expect(pick).toBeDefined();
    expect(pick.props?.disabled).toBe(true);
    expect(pick.props?.title).toBe(CELL_BUSY_REASON);
    expect(pick.props?.['aria-label']).toBe(CELL_BUSY_REASON);
  });
});

describe('M18 T-04: panel declares which tab a cell is running on', () => {
  interface VNodeLike {
    type: unknown;
    props?: {
      children?: unknown;
      [key: string]: unknown;
    };
  }

  function findVNodes(vnode: unknown, pred: (v: VNodeLike) => boolean): VNodeLike[] {
    const results: VNodeLike[] = [];
    function walk(node: unknown) {
      if (!node || typeof node !== 'object') return;
      const v = node as VNodeLike;
      if (pred(v)) results.push(v);
      const children = v.props?.children;
      if (Array.isArray(children)) {
        for (const c of children) walk(c);
      } else if (children && typeof children === 'object') {
        walk(children);
      }
    }
    walk(vnode);
    return results;
  }

  it('marks the header when the viewed tab is not the running tab', () => {
    const app = new SidePanelApp({
      steps: [],
      tabId: 2,
      currentSite: 'b.example',
    });
    const priv = app as unknown as { scratchRunTabId: number; scratchRunHost: string };
    priv.scratchRunTabId = 1;
    priv.scratchRunHost = 'a.example';
    app.state = { ...app.state, scratchRunning: true, currentSite: 'b.example' };
    const mark = findVNodes(app.render(), (v) => v.props?.['data-testid'] === 'nb-tab-mismatch')[0];
    expect(mark).toBeDefined();
    expect(mark.props?.children).toBe('berjalan di a.example');
    expect(mark.props?.['data-run-tab']).toBe('1');
    expect(mark.props?.['data-view-tab']).toBe('2');
  });

  it('does not mark the header when the viewed tab is the running tab', () => {
    const app = new SidePanelApp({
      steps: [],
      tabId: 1,
      currentSite: 'a.example',
    });
    const priv = app as unknown as { scratchRunTabId: number; scratchRunHost: string };
    priv.scratchRunTabId = 1;
    priv.scratchRunHost = 'a.example';
    app.state = { ...app.state, scratchRunning: true, currentSite: 'a.example' };
    const mark = findVNodes(app.render(), (v) => v.props?.['data-testid'] === 'nb-tab-mismatch')[0];
    expect(mark).toBeUndefined();
  });

  it('labels transcript entries with their origin host', () => {
    const app = new SidePanelApp({ steps: [] });
    app.state = {
      ...app.state,
      scratchEntries: [
        { id: 'e1', input: 'return 1', output: '1', isError: false, host: 'rapidtables.com' },
      ],
    };
    const host = findVNodes(app.render(), (v) => v.props?.['data-testid'] === 'nb-scratch-entry-host')[0];
    expect(host).toBeDefined();
    expect(host.props?.children).toBe('rapidtables.com');
  });
});

describe('M18 T-05: clear, help examples', () => {
  interface VNodeLike {
    type: unknown;
    props?: {
      disabled?: boolean;
      onClick?: () => void;
      children?: unknown;
      [key: string]: unknown;
    };
  }

  function findVNodes(vnode: unknown, pred: (v: VNodeLike) => boolean): VNodeLike[] {
    const results: VNodeLike[] = [];
    function walk(node: unknown) {
      if (!node || typeof node !== 'object') return;
      const v = node as VNodeLike;
      if (pred(v)) results.push(v);
      const children = v.props?.children;
      if (Array.isArray(children)) {
        for (const c of children) walk(c);
      } else if (children && typeof children === 'object') {
        walk(children);
      }
    }
    walk(vnode);
    return results;
  }

  it('clear empties visible transcript and leaves Ctrl+Up history intact', () => {
    const app = new SidePanelApp({ steps: [] });
    app.state = {
      ...app.state,
      scratchEntries: [
        { id: 'e1', input: 'return 1', output: '1', isError: false },
        { id: 'e2', input: 'return 2', output: '2', isError: false },
      ],
      scratchHistory: ['return 1', 'return 2'],
    };
    app.setState = ((partial: unknown) => {
      const next = typeof partial === 'function'
        ? (partial as (s: typeof app.state) => Partial<typeof app.state>)(app.state)
        : (partial as Partial<typeof app.state>);
      app.state = { ...app.state, ...next };
    }) as typeof app.setState;
    let vnode = app.render();
    const clearBtn = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-scratch-clear')[0];
    expect(clearBtn).toBeDefined();
    expect(clearBtn.props?.disabled).toBe(false);
    clearBtn.props?.onClick?.();
    expect(app.state.scratchEntries.length).toBe(0);
    expect(app.state.scratchHistory).toEqual(['return 1', 'return 2']);
    vnode = app.render();
    expect(findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-scratch-entry').length).toBe(0);
  });

  it('help drawer has one example per helper and a below-the-fold hint', () => {
    const app = new SidePanelApp({ steps: [] });
    app.state = { ...app.state, helpOpen: true, drawerMode: 'help' };
    const vnode = app.render();
    const examples = findVNodes(vnode, (v) => typeof v.props?.['data-testid'] === 'string' && String(v.props['data-testid']).startsWith('nb-help-example-'));
    expect(examples.length).toBe(17);
    for (const ex of examples) {
      const text = String(ex.props?.children || '');
      expect(text.length).toBeGreaterThan(0);
    }
    const more = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-help-more')[0];
    expect(more).toBeDefined();
    expect(String(more.props?.children || '')).toContain('masih ada helper di bawah');
  });
});

describe('M-20 T-01: Panel reads notebook from store (RQ-01, Bite-test 2)', () => {
  interface VNodeLike {
    type: unknown;
    props?: {
      class?: string;
      disabled?: boolean;
      children?: unknown;
      onClick?: () => void;
      [key: string]: unknown;
    };
  }

  function findVNodes(vnode: unknown, pred: (v: VNodeLike) => boolean): VNodeLike[] {
    const results: VNodeLike[] = [];
    function walk(node: unknown) {
      if (!node || typeof node !== 'object') return;
      const v = node as VNodeLike;
      if (pred(v)) results.push(v);
      const children = v.props?.children;
      if (Array.isArray(children)) {
        for (const c of children) walk(c);
      } else if (children && typeof children === 'object') {
        walk(children);
      }
    }
    walk(vnode);
    return results;
  }

  it('renders 3 steps, marks disabled step as nonaktif, and DOES NOT render empty state (Bite-test 2 invariant)', () => {
    const steps = [
      { id: 'steps/01-one.js', name: 'Step Pertama', source: 'steps/01-one.js', enabled: true, order: 1 },
      { id: 'steps/02-two.js', name: 'Step Kedua', source: 'steps/02-two.js', enabled: false, order: 2 },
      { id: 'steps/03-three.js', name: 'Step Ketiga', source: 'steps/03-three.js', enabled: true, order: 3 },
    ];

    const app = new SidePanelApp({
      steps,
      notebookName: 'Test Notebook',
      notebookExists: true,
    });

    const vnode = app.render();

    // Invariant: empty state MUST NOT be rendered
    const emptyStates = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-empty-state');
    expect(emptyStates.length, 'Empty state must NOT appear when steps are present').toBe(0);

    // Count step items: exactly 3
    const stepItems = findVNodes(vnode, (v) => typeof v.props?.class === 'string' && v.props.class.includes('nb-step-item'));
    expect(stepItems.length).toBe(3);

    // Verify step 1
    const s1 = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-step-steps/01-one.js')[0];
    expect(s1).toBeDefined();
    expect(s1.props?.['data-step-enabled']).toBe('true');

    // Verify step 2 (disabled)
    const s2 = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-step-steps/02-two.js')[0];
    expect(s2).toBeDefined();
    expect(s2.props?.['data-step-enabled']).toBe('false');
    expect(s2.props?.['data-outcome']).toBe('inactive');
    expect(s2.props?.class).toContain('disabled');

    const s2Badge = findVNodes(s2, (v) => v.props?.['data-testid'] === 'nb-kind-steps/02-two.js')[0];
    expect(s2Badge).toBeDefined();
    expect(s2Badge.props?.children).toBe('nonaktif');

    // Verify step 3
    const s3 = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-step-steps/03-three.js')[0];
    expect(s3).toBeDefined();
    expect(s3.props?.['data-step-enabled']).toBe('true');

    // Verify Run All button is present and not disabled
    const runAllBtn = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-btn-run-all')[0];
    expect(runAllBtn).toBeDefined();
    expect(runAllBtn.props?.disabled).toBe(false);

    // Verify notebook name in header
    const nbNameEl = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-notebook-name')[0];
    expect(nbNameEl).toBeDefined();
    expect(String(nbNameEl.props?.children)).toContain('Test Notebook');
  });

  it('renders readable error banner when notebookError is present and does NOT render "belum memiliki step" (M21 T-01, Bite-test 2)', () => {
    const app = new SidePanelApp({
      steps: [],
      notebookExists: false,
      notebookError: 'Missing front-matter block bounded by `---`.',
    });

    const vnode = app.render();
    const errorBanner = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-notebook-error')[0];
    expect(errorBanner).toBeDefined();

    const emptyNb = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-empty-notebook');
    expect(emptyNb.length).toBe(0);

    const vnodeStr = JSON.stringify(vnode);
    expect(vnodeStr).not.toContain('belum memiliki step');
  });

  it('renders repair button and overwrite warning when notebookError is present (M21 T-02, Bite-test 1)', async () => {
    let savedContent = '';
    const mockStore = {
      exists: async () => true,
      readFile: async () => 'broken',
      writeFile: async (_path: string, content: string) => {
        savedContent = content;
      },
    } as unknown as ProjectStore;

    let onCreatedCalled = false;
    const app = new SidePanelApp({
      steps: [],
      notebookExists: false,
      notebookError: 'Invalid notebook.md: Missing front-matter block bounded by `---`.',
      projectStore: mockStore,
      onNotebookCreated: () => {
        onCreatedCalled = true;
      },
    });

    const vnode = app.render();
    const repairBtn = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-btn-repair-notebook')[0];
    expect(repairBtn).toBeDefined();

    const warningEl = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-repair-warning')[0];
    expect(warningEl).toBeDefined();
    expect(String(warningEl.props?.children)).toContain('menimpa notebook.md');

    // Click repair
    await (repairBtn.props as { onClick?: () => Promise<void> }).onClick?.();

    expect(savedContent).toContain('name: Notebook Baru');
    expect(savedContent).toContain('steps: []');
    expect(onCreatedCalled).toBe(true);

    const nextVnode = app.render();
    const emptyNb = findVNodes(nextVnode, (v) => v.props?.['data-testid'] === 'nb-empty-notebook')[0];
    expect(emptyNb).toBeDefined();
    const errorBanner = findVNodes(nextVnode, (v) => v.props?.['data-testid'] === 'nb-notebook-error');
    expect(errorBanner.length).toBe(0);
  });

  it('disables save-scratch button when notebookError is present (M21 T-02, RQ-03)', () => {
    const app = new SidePanelApp({
      steps: [],
      notebookExists: false,
      notebookError: 'Missing front-matter block bounded by `---`.',
    });
    app.setState({ scratchInput: 'return 1 + 1;' });

    const vnode = app.render();
    const saveBtn = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-btn-save-scratch-step')[0];
    expect(saveBtn).toBeDefined();
    expect(saveBtn.props?.disabled).toBe(true);
    expect(saveBtn.props?.title).toContain('Notebook rusak');
  });

  it('renders orphan files section with adopt and delete buttons (M21 T-03, RQ-04)', () => {
    const app = new SidePanelApp({
      steps: [],
      notebookExists: true,
      orphanFiles: ['steps/01-isi-editor.js'],
    });

    const vnode = app.render();
    const orphanSection = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-orphan-section')[0];
    expect(orphanSection).toBeDefined();

    const orphanItem = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-orphan-item')[0];
    expect(orphanItem).toBeDefined();
    expect(orphanItem.props?.['data-path']).toBe('steps/01-isi-editor.js');

    const adoptBtn = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-btn-adopt-orphan')[0];
    expect(adoptBtn).toBeDefined();

    const deleteBtn = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-btn-delete-orphan')[0];
    expect(deleteBtn).toBeDefined();
  });

  it('handleAdoptOrphan adds orphan file to notebook.md and steps (M21 T-03)', async () => {
    const memoryStore = new MemoryProjectStore();
    await memoryStore.writeFile('notebook.md', '---\nname: Test Notebook\nsteps: []\n---\n');
    await memoryStore.writeFile('steps/01-isi-editor.js', 'console.log("hello");');

    const app = new SidePanelApp({
      steps: [],
      notebookExists: true,
      projectStore: memoryStore,
      orphanFiles: ['steps/01-isi-editor.js'],
    });

    const vnode = app.render();
    const adoptBtn = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-btn-adopt-orphan')[0];
    await (adoptBtn.props as { onClick?: () => Promise<void> }).onClick?.();

    const mdContent = await memoryStore.readFile('notebook.md');
    expect(mdContent).toContain('steps/01-isi-editor.js');
    expect(mdContent).toContain('Isi editor');

    const nextVnode = app.render();
    const orphanSection = findVNodes(nextVnode, (v) => v.props?.['data-testid'] === 'nb-orphan-section');
    expect(orphanSection.length).toBe(0);

    const stepItem = findVNodes(nextVnode, (v) => v.props?.['data-testid'] === 'nb-step-steps/01-isi-editor.js')[0];
    expect(stepItem).toBeDefined();
  });

  it('handleDeleteOrphan removes orphan file from store and state (M21 T-03)', async () => {
    const memoryStore = new MemoryProjectStore();
    await memoryStore.writeFile('steps/99-temp.js', '// temporary');

    const app = new SidePanelApp({
      steps: [],
      notebookExists: true,
      projectStore: memoryStore,
      orphanFiles: ['steps/99-temp.js'],
    });

    const vnode = app.render();
    const deleteBtn = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-btn-delete-orphan')[0];
    await (deleteBtn.props as { onClick?: () => Promise<void> }).onClick?.();

    expect(await memoryStore.exists('steps/99-temp.js')).toBe(false);
    const nextVnode = app.render();
    const orphanSection = findVNodes(nextVnode, (v) => v.props?.['data-testid'] === 'nb-orphan-section');
    expect(orphanSection.length).toBe(0);
  });

  it('declutters bottom scratch column and increases scratch input rows to 3 (M21 T-04, RQ-05)', () => {
    const app = new SidePanelApp({
      steps: [],
      notebookExists: true,
      notebookName: 'Test Declutter',
    });

    const vnode = app.render();

    // 1. Verify static copy sentence is gone
    const copyNodes = findVNodes(vnode, (v) =>
      typeof v.props?.children === 'string' && v.props.children.includes('Coba potongan kode di halaman ini tanpa notebook')
    );
    expect(copyNodes.length).toBe(0);

    // 2. Verify Tab indentasi hint is gone
    const tabHintNodes = findVNodes(vnode, (v) =>
      typeof v.props?.children === 'string' && v.props.children.includes('Tab indentasi')
    );
    expect(tabHintNodes.length).toBe(0);

    // 3. Verify scratch textarea has rows = 3 (> 1)
    const scratchInputNode = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-scratch-input')[0];
    expect(scratchInputNode).toBeDefined();
    expect(scratchInputNode.type).toBe('textarea');
    expect(Number(scratchInputNode.props?.rows)).toBeGreaterThan(1);
    expect(Number(scratchInputNode.props?.rows)).toBe(3);

    // 4. Verify step name input has distinct testid and tag
    const stepNameNode = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-input-step-name')[0];
    expect(stepNameNode).toBeDefined();
    expect(stepNameNode.type).toBe('input');
    expect(stepNameNode.props?.['data-testid']).not.toBe(scratchInputNode.props?.['data-testid']);

    // 5. Verify hint contains Enter baris baru and Ctrl+Enter jalankan
    const hintNode = findVNodes(vnode, (v) => v.props?.class === 'nb-scratch-hint')[0];
    expect(hintNode).toBeDefined();
  });

  it('renders "Notebook ini belum memiliki step" without fallback "notebook" when notebookName is empty (M21 T-01)', () => {
    const app = new SidePanelApp({
      steps: [],
      notebookExists: true,
      notebookName: '',
    });

    const vnode = app.render();
    const emptyTitle = findVNodes(vnode, (v) => v.props?.class === 'nb-empty-notebook-title')[0];
    expect(emptyTitle).toBeDefined();
    expect(String(emptyTitle.props?.children)).toBe('Notebook ini belum memiliki step');
    expect(String(emptyTitle.props?.children)).not.toContain('"notebook"');
  });

  it('renders create notebook form when notebookExists is false (T-02)', () => {
    const app = new SidePanelApp({
      steps: [],
      notebookExists: false,
    });

    const vnode = app.render();
    const createInput = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-input-notebook-name')[0];
    const createBtn = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-btn-create-notebook')[0];

    expect(createInput).toBeDefined();
    expect(createBtn).toBeDefined();
  });

  it('handleCreateNotebook writes notebook.md to store and updates state (T-02)', async () => {
    const memoryStore = new MemoryProjectStore();
    const createdNames: string[] = [];

    interface TestableSidePanel {
      state: SidePanelState;
      setState: (update: Partial<SidePanelState>) => void;
      handleCreateNotebook: () => Promise<void>;
      handleSaveScratchAsStep: () => Promise<void>;
    }
    const asTestable = (inst: SidePanelApp) => (inst as unknown as TestableSidePanel);

    const app = new SidePanelApp({
      steps: [],
      notebookExists: false,
      projectStore: memoryStore,
      onNotebookCreated: (name) => {
        createdNames.push(name);
      },
    });

    app.state = { ...app.state, newNotebookName: 'Proses Audit WhatsApp' };

    // Call handleCreateNotebook directly
    await asTestable(app).handleCreateNotebook();

    // Verify store contains notebook.md
    const exists = await memoryStore.exists('notebook.md');
    expect(exists).toBe(true);

    const content = await memoryStore.readFile('notebook.md');
    expect(content).toContain('name: Proses Audit WhatsApp');
    expect(content).toContain('steps: []');

    // Verify callback called
    expect(createdNames).toEqual(['Proses Audit WhatsApp']);

    // Verify app state
    expect(asTestable(app).state.notebookExists).toBe(true);
    expect(asTestable(app).state.notebookName).toBe('Proses Audit WhatsApp');

    // Verify render reflects new notebook
    const vnode = app.render();
    const emptyState = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-empty-state')[0];
    const emptyNotebook = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-empty-notebook')[0];
    const nbName = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-notebook-name')[0];

    expect(emptyState).toBeUndefined();
    expect(emptyNotebook).toBeDefined();
    expect(nbName).toBeDefined();
    expect(String(nbName.props?.children)).toContain('Proses Audit WhatsApp');
  });

  it('handleCreateNotebook shows error when writing fails (D-3, RQ-06)', async () => {
    interface TestableSidePanel {
      state: SidePanelState;
      setState: (update: Partial<SidePanelState>) => void;
      handleCreateNotebook: () => Promise<void>;
      handleSaveScratchAsStep: () => Promise<void>;
    }
    const asTestable = (inst: SidePanelApp) => (inst as unknown as TestableSidePanel);

    const failingStore: ProjectStore = {
      kind: 'opfs',
      exists: async () => false,
      readFile: async () => '',
      writeFile: async () => {
        throw new Error('Disk read-only');
      },
      deleteFile: async () => {},
      listFiles: async () => [],
    };

    const app = new SidePanelApp({
      steps: [],
      notebookExists: false,
      projectStore: failingStore,
    });

    asTestable(app).setState({ newNotebookName: 'Gagal' });
    await asTestable(app).handleCreateNotebook();

    expect(asTestable(app).state.createNotebookError).toContain('Disk read-only');
    expect(asTestable(app).state.notebookExists).toBe(false);

    const vnode = app.render();
    const errEl = findVNodes(vnode, (v) => v.props?.['data-testid'] === 'nb-create-notebook-error')[0];
    expect(errEl).toBeDefined();
    expect(String(errEl.props?.children)).toContain('Disk read-only');
  });

  it('handleSaveScratchAsStep performs two writes: step file and notebook.md (T-03, RQ-03)', async () => {
    interface TestableSidePanel {
      state: SidePanelState;
      setState: (update: Partial<SidePanelState>) => void;
      handleCreateNotebook: () => Promise<void>;
      handleSaveScratchAsStep: () => Promise<void>;
    }
    const asTestable = (inst: SidePanelApp) => (inst as unknown as TestableSidePanel);

    const memoryStore = new MemoryProjectStore();
    await memoryStore.writeFile('notebook.md', '---\nname: Test Flow\nsteps: []\n---\n');

    const savedSteps: StepItem[] = [];
    const app = new SidePanelApp({
      steps: [],
      notebookExists: true,
      notebookName: 'Test Flow',
      projectStore: memoryStore,
      onStepSaved: (s) => {
        savedSteps.push(s);
      },
    });

    app.state = {
      ...app.state,
      scratchInput: 'return 123 + 456;',
      newStepName: 'Hitung Angka',
    };

    await asTestable(app).handleSaveScratchAsStep();

    // 1. Verify step file in store
    const stepFileExists = await memoryStore.exists('steps/01-hitung-angka.js');
    expect(stepFileExists).toBe(true);
    const stepContent = await memoryStore.readFile('steps/01-hitung-angka.js');
    expect(stepContent).toBe('return 123 + 456;');

    // 2. Verify notebook.md updated
    const mdContent = await memoryStore.readFile('notebook.md');
    expect(mdContent).toContain('- path: steps/01-hitung-angka.js');
    expect(mdContent).toContain('name: Hitung Angka');
    expect(mdContent).toContain('enabled: true');

    // 3. Verify app state and callback
    expect(savedSteps.length).toBe(1);
    expect(savedSteps[0].id).toBe('steps/01-hitung-angka.js');
    expect(asTestable(app).state.steps.length).toBe(1);
    expect(asTestable(app).state.steps[0].id).toBe('steps/01-hitung-angka.js');
    expect(asTestable(app).state.newStepName).toBe('');
    expect(asTestable(app).state.saveStepError).toBeNull();
  });

  it('handleSaveScratchAsStep isolates Write 1 failure: notebook.md is untouched (T-03, D-3)', async () => {
    interface TestableSidePanel {
      state: SidePanelState;
      setState: (update: Partial<SidePanelState>) => void;
      handleCreateNotebook: () => Promise<void>;
      handleSaveScratchAsStep: () => Promise<void>;
    }
    const asTestable = (inst: SidePanelApp) => (inst as unknown as TestableSidePanel);

    const memoryStore = new MemoryProjectStore();
    await memoryStore.writeFile('notebook.md', '---\nname: Untouched Notebook\nsteps: []\n---\n');

    // Make step file write fail
    const origWrite = memoryStore.writeFile.bind(memoryStore);
    memoryStore.writeFile = async (path: string, content: string) => {
      if (path.startsWith('steps/')) {
        throw new Error('Permission denied writing step file');
      }
      return origWrite(path, content);
    };

    const app = new SidePanelApp({
      steps: [],
      notebookExists: true,
      notebookName: 'Untouched Notebook',
      projectStore: memoryStore,
    });

    app.state = {
      ...app.state,
      scratchInput: 'return true;',
      newStepName: 'Step Gagal 1',
    };

    await asTestable(app).handleSaveScratchAsStep();

    expect(asTestable(app).state.saveStepError).toContain('Gagal menulis berkas step');
    expect(asTestable(app).state.saveStepError).toContain('notebook.md tidak diubah');

    // Verify notebook.md still unchanged
    const mdContent = await memoryStore.readFile('notebook.md');
    expect(mdContent).not.toContain('Step Gagal 1');
  });

  it('handleSaveScratchAsStep isolates Write 2 failure: reports orphaned file (T-03, §7)', async () => {
    interface TestableSidePanel {
      state: SidePanelState;
      setState: (update: Partial<SidePanelState>) => void;
      handleCreateNotebook: () => Promise<void>;
      handleSaveScratchAsStep: () => Promise<void>;
    }
    const asTestable = (inst: SidePanelApp) => (inst as unknown as TestableSidePanel);

    const memoryStore = new MemoryProjectStore();
    await memoryStore.writeFile('notebook.md', '---\nname: Existing Notebook\nsteps: []\n---\n');

    // Make notebook.md write fail
    const origWrite = memoryStore.writeFile.bind(memoryStore);
    memoryStore.writeFile = async (path: string, content: string) => {
      if (path === 'notebook.md') {
        throw new Error('Lock contention on notebook.md');
      }
      return origWrite(path, content);
    };

    const app = new SidePanelApp({
      steps: [],
      notebookExists: true,
      notebookName: 'Existing Notebook',
      projectStore: memoryStore,
    });

    app.state = {
      ...app.state,
      scratchInput: 'return false;',
      newStepName: 'Step Yatim',
    };

    await asTestable(app).handleSaveScratchAsStep();

    expect(asTestable(app).state.saveStepError).toContain('Gagal memperbarui notebook.md');
    expect(asTestable(app).state.saveStepError).toContain('tersimpan sebagai berkas yatim');

    // Step file was written
    const stepExists = await memoryStore.exists('steps/01-step-yatim.js');
    expect(stepExists).toBe(true);
  });

  it('handleToggleStepEnabled toggles step and persists to notebook.md (T-04, RQ-04)', async () => {
    interface TestableSidePanel {
      state: SidePanelState;
      handleToggleStepEnabled: (stepId: string) => Promise<void>;
    }
    const asTestable = (inst: SidePanelApp) => (inst as unknown as TestableSidePanel);

    const memoryStore = new MemoryProjectStore();
    const initialMd = [
      '---',
      'name: Toggle Flow',
      'steps:',
      '  - path: steps/01-one.js',
      '    name: Step Satu',
      '    enabled: true',
      '  - path: steps/02-two.js',
      '    name: Step Dua',
      '    enabled: false',
      '---',
      '',
    ].join('\n');
    await memoryStore.writeFile('notebook.md', initialMd);

    const steps: StepItem[] = [
      { id: 'steps/01-one.js', name: 'Step Satu', source: 'steps/01-one.js', enabled: true, order: 1 },
      { id: 'steps/02-two.js', name: 'Step Dua', source: 'steps/02-two.js', enabled: false, order: 2 },
    ];

    const app = new SidePanelApp({
      steps,
      notebookExists: true,
      notebookName: 'Toggle Flow',
      projectStore: memoryStore,
    });

    // Disable step 1
    await asTestable(app).handleToggleStepEnabled('steps/01-one.js');
    expect(asTestable(app).state.steps[0].enabled).toBe(false);

    let md = await memoryStore.readFile('notebook.md');
    expect(md).toContain('- path: steps/01-one.js');
    expect(md).toContain('enabled: false');

    // Enable step 2
    await asTestable(app).handleToggleStepEnabled('steps/02-two.js');
    expect(asTestable(app).state.steps[1].enabled).toBe(true);

    md = await memoryStore.readFile('notebook.md');
    expect(md).toContain('- path: steps/02-two.js');
    expect(md).toContain('enabled: true');
  });

  it('handleMoveStep reorders steps and persists order to notebook.md (T-04, RQ-04)', async () => {
    interface TestableSidePanel {
      state: SidePanelState;
      handleMoveStep: (stepId: string, direction: 'up' | 'down') => Promise<void>;
    }
    const asTestable = (inst: SidePanelApp) => (inst as unknown as TestableSidePanel);

    const memoryStore = new MemoryProjectStore();
    const initialMd = [
      '---',
      'name: Order Flow',
      'steps:',
      '  - path: steps/01-first.js',
      '    name: Pertama',
      '    enabled: true',
      '  - path: steps/02-second.js',
      '    name: Kedua',
      '    enabled: true',
      '---',
      '',
    ].join('\n');
    await memoryStore.writeFile('notebook.md', initialMd);

    const steps: StepItem[] = [
      { id: 'steps/01-first.js', name: 'Pertama', source: 'steps/01-first.js', enabled: true, order: 1 },
      { id: 'steps/02-second.js', name: 'Kedua', source: 'steps/02-second.js', enabled: true, order: 2 },
    ];

    const app = new SidePanelApp({
      steps,
      notebookExists: true,
      notebookName: 'Order Flow',
      projectStore: memoryStore,
    });

    // Move second step up
    await asTestable(app).handleMoveStep('steps/02-second.js', 'up');

    expect(asTestable(app).state.steps[0].id).toBe('steps/02-second.js');
    expect(asTestable(app).state.steps[0].order).toBe(1);
    expect(asTestable(app).state.steps[1].id).toBe('steps/01-first.js');
    expect(asTestable(app).state.steps[1].order).toBe(2);

    const md = await memoryStore.readFile('notebook.md');
    const firstIdx = md.indexOf('steps/02-second.js');
    const secondIdx = md.indexOf('steps/01-first.js');
    expect(firstIdx).toBeLessThan(secondIdx);
  });
});


