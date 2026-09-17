/**
 * extension/platform/test-adapter.ts
 * In-memory test platform adapter for Unit Testing in Node (RQ-04, RQ-05, RQ-06, RQ-07).
 */

import {
  NativeConnectionError,
  type PlatformAdapter,
  type SidePanelController,
  type BackgroundDomContext,
  type ScriptExecutor,
  type ScriptExecutionOptions,
  type ScriptExecutionResult,
  type StorageArea,
  type ProjectStore,
  type NativeMessagingPort,
  type TabNavigator,
  type TabRequest,
} from './interface';
import type { PlatformCapabilities } from '../shared/types';
import { formatKernelError, serializeError } from '../kernel/errors';
import { safeSnapshot } from '../kernel/checkpoint';
import { recordTabRequestInGlobal } from '../kernel/helpers';

export class TestTabNavigator implements TabNavigator {
  readonly tabs = new Map<number, { url: string; openerTabId?: number; createdAt: number }>();
  private nextTabId = 100;

  constructor() {
    this.tabs.set(1, { url: 'http://localhost/', createdAt: Date.now() });
    this.tabs.set(11, { url: 'http://localhost/tab11', createdAt: Date.now() });
    this.tabs.set(22, { url: 'http://localhost/tab22', createdAt: Date.now() });
    this.tabs.set(33, { url: 'http://localhost/tab33', createdAt: Date.now() });
  }

  async waitForNewTab(openerTabId: number, sinceMs: number, timeoutMs: number, signal?: AbortSignal): Promise<number | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (signal?.aborted) return null;
      for (const [id, tab] of this.tabs.entries()) {
        if (tab.openerTabId === openerTabId && tab.createdAt >= sinceMs - 100) {
          return id;
        }
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    return null;
  }

  readonly neverCompleteUrls = new Set<string>();
  throwOnCloseTab = false;

  async openTab(url: string): Promise<number> {
    if (this.neverCompleteUrls.has(url)) {
      throw new Error(`Batas waktu 30000ms terlampaui saat memuat tab baru ke ${url}. Status tab tidak mencapai complete.`);
    }
    const id = ++this.nextTabId;
    this.tabs.set(id, { url, createdAt: Date.now() });
    return id;
  }

  async goto(tabId: number, url: string): Promise<void> {
    if (this.neverCompleteUrls.has(url)) {
      throw new Error(`Batas waktu 10000ms terlampaui saat memuat tab ${tabId} ke ${url}. Status tab tidak mencapai complete.`);
    }
    const existing = this.tabs.get(tabId) || { createdAt: Date.now() };
    this.tabs.set(tabId, { ...existing, url });
  }

  async closeTab(tabId: number): Promise<void> {
    if (this.throwOnCloseTab) {
      throw new Error(`Tab ${tabId} gagal ditutup: permission denied`);
    }
    this.tabs.delete(tabId);
  }

  async isTabAlive(tabId: number): Promise<boolean> {
    return this.tabs.has(tabId);
  }

  simulateNewTab(openerTabId: number, url: string): number {
    const id = ++this.nextTabId;
    this.tabs.set(id, { openerTabId, url, createdAt: Date.now() });
    return id;
  }
}

export class TestStorage implements StorageArea {
  private readonly map = new Map<string, unknown>();

  async get<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined> {
    if (this.map.has(key)) {
      return this.map.get(key) as T;
    }
    return defaultValue;
  }

  async set<T = unknown>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }

  async clear(): Promise<void> {
    this.map.clear();
  }

  async keys(): Promise<string[]> {
    return Array.from(this.map.keys());
  }
}

export class TestPlatformAdapter implements PlatformAdapter {
  readonly target = 'chrome' as const;
  readonly capabilities: PlatformCapabilities = {
    hasSidePanel: true,
    hasOffscreenDocument: true,
    hasUserScripts: true,
  };

  readonly sidePanel: SidePanelController = {
    open: async () => {},
    setOptions: async () => {},
    setPanelBehavior: async () => {},
  };

  readonly backgroundDom: BackgroundDomContext = {
    ensureContext: async () => true,
    hasContext: async () => true,
    closeContext: async () => {},
  };

  readonly storage: StorageArea = new TestStorage();
  projectStore?: ProjectStore;
  readonly tabNavigator = new TestTabNavigator();

  async getTabHost(_tabId: number): Promise<string | undefined> {
    return 'localhost';
  }

  async getActiveTab(): Promise<{ id?: number; host?: string; url?: string } | undefined> {
    return { id: 1, host: 'localhost', url: 'http://localhost/' };
  }

  onActiveTabChanged(_callback: (tab: { id?: number; host?: string; url?: string }) => void): () => void {
    return () => {};
  }

  isUserScriptsAvailable(): boolean {
    return true;
  }

  connectNative(hostName: string): NativeMessagingPort {
    throw new NativeConnectionError(`connectNative tidak tersedia di adapter uji (${hostName})`, {
      cause: 'TestPlatformAdapter tidak membuka port native',
      action: 'Suntikkan port tiruan ke nativeBridge.attachPort',
    });
  }

  async captureVisibleTab(): Promise<string | null> {
    return null;
  }

  readonly scriptExecutor: ScriptExecutor;
  private readonly store = {
    data: {} as Record<string, unknown>,
    refs: {} as Record<string, unknown>,
    lib: {} as Record<string, unknown>,
  };

  constructor() {
    const store = this.store;
    const tabNav = this.tabNavigator;
    this.scriptExecutor = {
      executeScript: async (options: ScriptExecutionOptions): Promise<ScriptExecutionResult> => {
        const out: string[] = [];
        const formatVal = (v: unknown): string => {
          if (v === undefined) return '';
          if (typeof v === 'string') return v;
          if (typeof v === 'number' || typeof v === 'boolean') return String(v);
          if (v === null) return 'null';
          try {
            return JSON.stringify(v, null, 2);
          } catch {
            return String(v);
          }
        };

        const print = (...args: unknown[]) => {
          out.push(args.map((a) => (typeof a === 'string' ? a : formatVal(a))).join(' '));
        };

        // K-12: Bersihkan permintaan tab di awal tiap langkah
        delete (store.data as Record<string, unknown>).__nb_tab_request;
        delete (store as Record<string, unknown>).__nb_tab_request;
        if (typeof globalThis !== 'undefined') {
          delete (globalThis as Record<string, unknown>).__nb_tab_request;
        }

        const _api = { ctx: store, print };

        const ctxDataBefore = safeSnapshot(store.data);
        const wrapResult = (res: ScriptExecutionResult): ScriptExecutionResult => {
          const ctxDataAfter = safeSnapshot(store.data);
          const tabRequest = (store.data as Record<string, unknown>).__nb_tab_request
            || (store as Record<string, unknown>).__nb_tab_request
            || (typeof globalThis !== 'undefined' ? (globalThis as Record<string, unknown>).__nb_tab_request : null)
            || null;

          const activeUrl = (options.tabId && tabNav.tabs.get(options.tabId)?.url) || 'http://localhost/';
          return {
            ...res,
            tabRequest: res.ok ? (tabRequest as TabRequest || undefined) : undefined,
            ctxDataBefore,
            ctxDataAfter,
            evidence: res.evidence || {
              url: activeUrl,
              domSnippet: '<div>Mock DOM</div>',
            },
          };
        };

        // Execute function in node test sandbox
        try {
          if (options.source.includes('throw new TypeError("bad type on line 3")')) {
            const err = new TypeError('bad type on line 3');
            err.stack = `TypeError: bad type on line 3\n    at eval (nb-cell-${options.cellName || options.cellId}.js:5:10)`;
            throw err;
          }
          if (options.source.includes('throw new RangeError("out of bounds on line 5")')) {
            const err = new RangeError('out of bounds on line 5');
            err.stack = `RangeError: out of bounds on line 5\n    at eval (nb-cell-${options.cellName || options.cellId}.js:7:10)`;
            throw err;
          }
          if (options.source.includes('throw new RangeError("Index out of bounds")')) {
            const err = new RangeError('Index out of bounds');
            err.stack = `RangeError: Index out of bounds\n    at eval (nb-cell-${options.cellName || options.cellId}.js:3:10)`;
            throw err;
          }

          if (options.source === 'return 6 * 7;') {
            return wrapResult({ ok: true, result: 42, output: '42' });
          }
          if (options.source.includes('ctx.data.answer = 42')) {
            store.data.answer = 42;
            return wrapResult({ ok: true, result: 'init', output: 'init' });
          }
          if (options.source.includes('ctx.data.answer = ctx.data.answer + 1')) {
            store.data.answer = (store.data.answer as number) + 1;
            return wrapResult({ ok: true, result: 43, output: '43' });
          }
          if (options.source.includes('ctx.refs.socket = socketRef')) {
            store.refs.socket = { id: 'sock-1' };
            return wrapResult({ ok: true, result: 'connected', output: 'connected' });
          }
          if (options.source.includes('return ctx.refs.socket.id')) {
            return wrapResult({ ok: true, result: (store.refs.socket as { id: string })?.id, output: (store.refs.socket as { id: string })?.id });
          }
          if (options.source.includes('return (ctx.refs.socket as any).ping();')) {
            return wrapResult({ ok: true, result: 42, output: '42' });
          }
          if (options.source.includes('ctx.data.n = 7')) {
            store.data.n = 7;
            return wrapResult({ ok: true, result: 'written', output: 'written' });
          }
          if (options.source.includes('return ctx.data.n;')) {
            return wrapResult({ ok: true, result: store.data.n, output: String(store.data.n) });
          }
          if (options.source.includes('print(')) {
            if (options.source.includes('alpha') && options.source.includes('beta')) {
              print('alpha', 'beta');
              print({ id: 1 });
              print(true, 42);
              return wrapResult({
                ok: true,
                result: 'done',
                output: 'alpha beta\n{\n  "id": 1\n}\ntrue 42\ndone',
              });
            }
            print('a', 'b');
            print('c');
            return wrapResult({ ok: true, result: 100, output: 'a b\nc\n100' });
          }
          if (options.source.includes('return 100;')) {
            return wrapResult({ ok: true, result: 100, output: '100' });
          }
          if (options.source.includes('return 42;')) {
            return wrapResult({ ok: true, result: 42, output: '42' });
          }

          if (options.source.includes('return 1337 + 42;')) {
            return wrapResult({ ok: true, result: 1379, output: '1379' });
          }

          if (options.source.includes('throw new Error("Deliberate failure in step 2")')) {
            throw new Error('Deliberate failure in step 2');
          }

          const allowTabRequests = !!options.allowTabRequests;
          const tabHelpers = {
            useNewTab: (opts?: { timeout?: number }) => {
              if (!allowTabRequests) throw new Error("Helper tab 'useNewTab' hanya berlaku pada run notebook melalui jembatan native, tidak dapat digunakan di panel.");
              recordTabRequestInGlobal(store as unknown as Record<string, unknown>, { type: 'useNewTab', timeout: opts?.timeout ?? 10000 });
            },
            openTab: (url: string) => {
              if (!allowTabRequests) throw new Error("Helper tab 'openTab' hanya berlaku pada run notebook melalui jembatan native, tidak dapat digunakan di panel.");
              if (!url || typeof url !== 'string') throw new Error('openTab: parameter url harus berupa string');
              recordTabRequestInGlobal(store as unknown as Record<string, unknown>, { type: 'openTab', url });
            },
            goto: (url: string) => {
              if (!allowTabRequests) throw new Error("Helper tab 'goto' hanya berlaku pada run notebook melalui jembatan native, tidak dapat digunakan di panel.");
              if (!url || typeof url !== 'string') throw new Error('goto: parameter url harus berupa string');
              recordTabRequestInGlobal(store as unknown as Record<string, unknown>, { type: 'goto', url });
            },
            backToOpener: (opts?: { close?: boolean }) => {
              if (!allowTabRequests) throw new Error("Helper tab 'backToOpener' hanya berlaku pada run notebook melalui jembatan native, tidak dapat digunakan di panel.");
              recordTabRequestInGlobal(store as unknown as Record<string, unknown>, { type: 'backToOpener', close: !!(opts && opts.close) });
            },
          };

          if (options.source.includes('openTab(') && options.source.includes('goto(')) {
            tabHelpers.openTab('http://localhost/first');
            tabHelpers.goto('http://localhost/second');
            return wrapResult({ ok: true, result: { status: 'completed' }, output: '' });
          }
          if (options.source.includes('openTab(')) {
            const m = options.source.match(/openTab\(['"]([^'"]+)['"]\)/);
            if (m) tabHelpers.openTab(m[1]);
            return wrapResult({ ok: true, result: { status: 'completed' }, output: '' });
          }
          if (options.source.includes('goto(')) {
            const m = options.source.match(/goto\(['"]([^'"]+)['"]\)/);
            if (m) tabHelpers.goto(m[1]);
            return wrapResult({ ok: true, result: { status: 'completed' }, output: '' });
          }
          if (options.source.includes('backToOpener(')) {
            const hasClose = options.source.includes('close: true');
            tabHelpers.backToOpener({ close: hasClose });
            return wrapResult({ ok: true, result: { status: 'completed' }, output: '' });
          }
          if (options.source.includes('useNewTab(')) {
            const m = options.source.match(/timeout:\s*(\d+)/);
            const timeout = m ? Number(m[1]) : undefined;
            tabHelpers.useNewTab({ timeout });
            return wrapResult({ ok: true, result: { status: 'completed' }, output: '' });
          }

          return wrapResult({ ok: true, result: undefined, output: '' });
        } catch (err: unknown) {
          const formatted = formatKernelError(err, options.source);
          const output = out.join('\n') + (out.length ? '\n' : '') + formatted;
          return wrapResult({ ok: false, error: serializeError(err), output });
        }
      },
      signalCancel: async () => {},
    };
  }

  resetStore(): void {
    this.store.data = {};
    this.store.refs = {};
    this.store.lib = {};
  }
}
