/**
 * extension/kernel/helpers.test.ts
 * Unit tests for kernel helpers ($, $$, waitFor, sleep, parkForUnload, AbortError, fmt).
 * pick() behaviour is tested by the in-browser suite kept in the development repo.
 */

import { describe, it, expect } from 'vitest';
import { $, $$, waitFor, sleep, parkForUnload, AbortError, fmt, INJECTED_HELPERS_SCRIPT, RUNTIME_HELPERS } from './helpers';

describe('T-02 & T-03: Kernel helpers', () => {
  it('sleep delays for at least specified duration (RQ-03)', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45); // allow minimal timer jitter in CI
  });

  it('sleep rejects with AbortError when signal is aborted (RQ-03, INV-7)', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    await expect(sleep(200, controller.signal)).rejects.toThrow(AbortError);
    await expect(sleep(200, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('sleep rejects immediately if signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(100, controller.signal)).rejects.toThrow(AbortError);
  });

  it('$ and $$ query elements from provided root (RQ-02)', () => {
    const fakeRoot = {
      querySelector: (sel: string) => (sel === '#test' ? { id: 'test' } : null),
      querySelectorAll: (sel: string) => (sel === 'a' ? [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }] : []),
    } as unknown as ParentNode;

    expect($( '#test', fakeRoot)).toEqual({ id: 'test' });
    expect($('.missing', fakeRoot)).toBeNull();
    expect($$('a', fakeRoot).length).toBe(3);
    expect($$('.missing', fakeRoot)).toEqual([]);
  });

  it('waitFor resolves when element appears (RQ-02)', async () => {
    let exists = false;
    setTimeout(() => { exists = true; }, 30);

    const fakeRoot = {
      querySelector: (sel: string) => (exists && sel === '#dyn' ? { id: 'dyn' } : null),
    } as unknown as ParentNode;

    const el = await waitFor('#dyn', { root: fakeRoot, timeout: 200, interval: 10 });
    expect(el).toEqual({ id: 'dyn' });
  });

  it('waitFor polls periodically and resolves when element appears (K-14 pure polling)', async () => {
    let queries = 0;
    const fakeRoot = {
      querySelector: (sel: string) => {
        queries++;
        return queries >= 3 && sel === '#dyn-poll' ? { id: 'dyn-poll' } : null;
      },
    } as unknown as ParentNode;

    const el = await waitFor('#dyn-poll', { root: fakeRoot, timeout: 500, interval: 20 });
    expect(el).toEqual({ id: 'dyn-poll' });
    expect(queries).toBeGreaterThanOrEqual(3);
  });

  it('waitFor throws error mentioning selector and duration on timeout (RQ-02)', async () => {
    const fakeRoot = {
      querySelector: () => null,
    } as unknown as ParentNode;

    await expect(
      waitFor('.tidak-ada', { root: fakeRoot, timeout: 100, interval: 10 })
    ).rejects.toThrow('waitFor timeout (100ms): .tidak-ada');
  });

  it('fmt formats primitives, null, undefined, and objects cleanly', () => {
    expect(fmt(undefined)).toBe('');
    expect(fmt('hello')).toBe('hello');
    expect(fmt(42)).toBe('42');
    expect(fmt(null)).toBe('null');
    expect(fmt({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it('parkForUnload rejects with timeout error mentioning duration when no unload occurs (RQ-06, D-2)', async () => {
    await expect(parkForUnload(80)).rejects.toThrow('parkForUnload: no navigation within 80ms');
  });

  it('parkForUnload rejects with AbortError when signal is aborted (RQ-06, D-2)', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    await expect(parkForUnload(500, controller.signal)).rejects.toThrow(AbortError);
  });
});

describe('T-05: Bidirectional locking between RUNTIME_HELPERS and INJECTED_HELPERS_SCRIPT (RQ-06)', () => {
  const REALM_GLOBALS = new Set(['auto', 'ctx', 'print', 'gmFetch']);

  // Extract all top-level `const <name> =` declarations from INJECTED_HELPERS_SCRIPT
  const topLevelScriptHelpers = [...INJECTED_HELPERS_SCRIPT.matchAll(/^\s{2}const\s+([a-zA-Z0-9_$]+)\s*=/gm)].map(
    (m) => m[1]
  );

  it('every top-level const helper in INJECTED_HELPERS_SCRIPT has a documented entry in RUNTIME_HELPERS', () => {
    const documentedNames = new Set(RUNTIME_HELPERS.map((h) => h.name));
    for (const helperName of topLevelScriptHelpers) {
      expect(
        documentedNames.has(helperName),
        `Top-level helper "${helperName}" in INJECTED_HELPERS_SCRIPT must be documented in RUNTIME_HELPERS`
      ).toBe(true);
    }
  });

  it('every entry in RUNTIME_HELPERS is either declared as top-level const in INJECTED_HELPERS_SCRIPT or is a known realm global', () => {
    const scriptHelperSet = new Set(topLevelScriptHelpers);
    for (const helper of RUNTIME_HELPERS) {
      const isScriptHelper = scriptHelperSet.has(helper.name);
      const isRealmGlobal = REALM_GLOBALS.has(helper.name);
      expect(
        isScriptHelper || isRealmGlobal,
        `Documented helper "${helper.name}" in RUNTIME_HELPERS must either be declared as top-level const in INJECTED_HELPERS_SCRIPT or be a recognized realm global`
      ).toBe(true);
    }
  });

  it('all RUNTIME_HELPERS entries have non-empty name, signature, description, and one-line example adhering to D-LANG', () => {
    expect(RUNTIME_HELPERS.length).toBe(17);
    for (const h of RUNTIME_HELPERS) {
      expect(h.name.length).toBeGreaterThan(0);
      expect(h.signature.length).toBeGreaterThan(0);
      expect(h.description.length).toBeGreaterThan(0);
      expect(h.description.endsWith('.')).toBe(true);
      expect(h.example.length).toBeGreaterThan(0);
      expect(h.example.includes('\n')).toBe(false);
    }
  });
});

describe('T-04: Tab navigation helpers (K-8, K-9, K-12)', () => {
  it('records tab requests and forbids two tab requests in the same step (K-9)', async () => {
    const { useNewTab, openTab, goto, backToOpener } = await import('./helpers');
    const g = globalThis as Record<string, unknown>;

    // Clean initial state
    delete g.__nb_tab_request;

    useNewTab({ timeout: 5000 });
    expect(g.__nb_tab_request).toEqual({ type: 'useNewTab', timeout: 5000 });

    // Calling another helper in the same step must throw immediately mentioning the first
    expect(() => openTab('https://example.com')).toThrow(
      'Dua permintaan tab dalam satu langkah: useNewTab sudah terdaftar sebelum openTab'
    );

    delete g.__nb_tab_request;
    openTab('https://example.com/item');
    expect(g.__nb_tab_request).toEqual({ type: 'openTab', url: 'https://example.com/item' });

    delete g.__nb_tab_request;
    goto('https://example.com/next');
    expect(g.__nb_tab_request).toEqual({ type: 'goto', url: 'https://example.com/next' });

    delete g.__nb_tab_request;
    backToOpener({ close: true });
    expect(g.__nb_tab_request).toEqual({ type: 'backToOpener', close: true });

    delete g.__nb_tab_request;
  });

  it('rejects invalid url strings for openTab and goto', async () => {
    const { openTab, goto } = await import('./helpers');
    expect(() => (openTab as unknown as (u: unknown) => void)('')).toThrow('openTab: parameter url harus berupa string');
    expect(() => (goto as unknown as (u: unknown) => void)(null)).toThrow('goto: parameter url harus berupa string');
  });

  it('tab helpers throw explicit K-13 error when called without native allowTabRequests (K-13, F-1)', async () => {
    const g = globalThis as Record<string, unknown>;
    g.__nb_allow_tab_requests = false;
    try {
      const { useNewTab, openTab, goto, backToOpener } = await import('./helpers');
      expect(() => useNewTab()).toThrow("Helper tab 'useNewTab' hanya berlaku pada run notebook melalui jembatan native, tidak dapat digunakan di panel.");
      expect(() => openTab('https://example.com')).toThrow("Helper tab 'openTab' hanya berlaku pada run notebook melalui jembatan native, tidak dapat digunakan di panel.");
      expect(() => goto('https://example.com')).toThrow("Helper tab 'goto' hanya berlaku pada run notebook melalui jembatan native, tidak dapat digunakan di panel.");
      expect(() => backToOpener()).toThrow("Helper tab 'backToOpener' hanya berlaku pada run notebook melalui jembatan native, tidak dapat digunakan di panel.");
    } finally {
      delete g.__nb_allow_tab_requests;
    }
  });
});

