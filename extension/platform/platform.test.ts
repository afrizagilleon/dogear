/**
 * extension/platform/platform.test.ts
 * Unit tests for platform adapter factory, capability isolation, storage, and unified fetch (RQ-04, RQ-05, RQ-06, M3 A-1).
 */

import { describe, it, expect, vi } from 'vitest';
import { getPlatformAdapter, ChromiumPlatformAdapter, FirefoxPlatformAdapter, executeGmFetch, NativeConnectionError, NATIVE_HOST_NAME } from './index';
import { TestStorage } from './test-adapter';
import { serializeError } from '../shared/types';

describe('getPlatformAdapter', () => {
  it('returns ChromiumPlatformAdapter when overrideTarget is chrome', () => {
    const adapter = getPlatformAdapter('chrome');
    expect(adapter).toBeInstanceOf(ChromiumPlatformAdapter);
    expect(adapter.target).toBe('chrome');
    expect(adapter.capabilities.hasSidePanel).toBe(true);
    expect(adapter.capabilities.hasOffscreenDocument).toBe(true);
    expect(adapter.storage).toBeDefined();
  });

  it('returns FirefoxPlatformAdapter when overrideTarget is firefox', () => {
    const adapter = getPlatformAdapter('firefox');
    expect(adapter).toBeInstanceOf(FirefoxPlatformAdapter);
    expect(adapter.target).toBe('firefox');
    expect(adapter.capabilities.hasSidePanel).toBe(true);
    expect(adapter.capabilities.hasOffscreenDocument).toBe(false);
    expect(adapter.storage).toBeDefined();
  });

  it('configures openPanelOnActionClick on sidePanel controller (A3-T1, F-12, INV-3)', async () => {
    const adapter = getPlatformAdapter('chrome');
    const mockSetPanelBehavior = vi.fn().mockResolvedValue(undefined);
    (globalThis as Record<string, unknown>).chrome = {
      sidePanel: {
        setPanelBehavior: mockSetPanelBehavior,
      },
    };

    try {
      await adapter.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
      expect(mockSetPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
    } finally {
      delete (globalThis as Record<string, unknown>).chrome;
    }
  });
});

describe('T-05: Platform Storage (RQ-05, D-6)', () => {
  it('writes object, reads it back, and matches exactly', async () => {
    const storage = new TestStorage();
    const testObj = {
      notebookId: 'nb-123',
      version: 1,
      cells: [{ id: 'c1', source: 'return 42;' }],
      nested: { enabled: true, count: 5 },
    };

    await storage.set('nb:test', testObj);
    const read = await storage.get<typeof testObj>('nb:test');
    expect(read).toEqual(testObj);
    expect(read?.cells[0].source).toBe('return 42;');
  });

  it('returns default value or undefined for non-existent key', async () => {
    const storage = new TestStorage();
    const readUndefined = await storage.get('missing-key');
    expect(readUndefined).toBeUndefined();

    const readDefault = await storage.get('missing-key', { fallback: true });
    expect(readDefault).toEqual({ fallback: true });
  });

  it('removes key and subsequent get returns undefined', async () => {
    const storage = new TestStorage();
    await storage.set('item1', 'value1');
    expect(await storage.get('item1')).toBe('value1');

    await storage.remove('item1');
    expect(await storage.get('item1')).toBeUndefined();
  });

  it('clears all keys and lists keys correctly', async () => {
    const storage = new TestStorage();
    await storage.set('k1', 1);
    await storage.set('k2', 2);
    expect(await storage.keys()).toEqual(['k1', 'k2']);

    await storage.clear();
    expect(await storage.keys()).toEqual([]);
    expect(await storage.get('k1')).toBeUndefined();
  });
});

describe('M3 A-1: Unified executeGmFetch (RQ-04, D-1)', () => {
  it('handles missing URL gracefully', async () => {
    const res = await executeGmFetch({});
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Missing URL for gmFetch');
  });

  it('executes successful fetch and parses JSON', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ secret: 'abc-123' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    try {
      const res = await executeGmFetch({
        url: 'https://example.com/api/test',
        fetchOptions: { method: 'GET' },
      });
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      expect(res.data).toEqual({ secret: 'abc-123' });
      expect(res.text).toBe('{"secret":"abc-123"}');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('handles network / fetch failure safely', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
    vi.stubGlobal('fetch', mockFetch);

    try {
      const res = await executeGmFetch({
        url: 'https://example.com/api/fail',
      });
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Connection refused');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('M-11 T-01: Platform Active Tab and UserScripts inspection (RQ-01)', () => {
  it('detects userScripts availability accurately and dynamically', () => {
    const adapter = new ChromiumPlatformAdapter();
    expect(adapter.isUserScriptsAvailable()).toBe(false);
    expect(adapter.capabilities.hasUserScripts).toBe(false);

    (globalThis as Record<string, unknown>).chrome = {
      userScripts: {},
    };

    try {
      expect(adapter.isUserScriptsAvailable()).toBe(true);
      expect(adapter.capabilities.hasUserScripts).toBe(true);
    } finally {
      delete (globalThis as Record<string, unknown>).chrome;
    }
  });

  it('reads active tab host via getActiveTab()', async () => {
    const adapter = new ChromiumPlatformAdapter();
    (globalThis as Record<string, unknown>).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 101, url: 'https://aljazeera.com/news' }]),
      },
    };

    try {
      const active = await adapter.getActiveTab();
      expect(active).toBeDefined();
      expect(active?.id).toBe(101);
      expect(active?.host).toBe('aljazeera.com');
      expect(active?.url).toBe('https://aljazeera.com/news');
    } finally {
      delete (globalThis as Record<string, unknown>).chrome;
    }
  });

  it('subscribes to tab change events with onActiveTabChanged', async () => {
    const adapter = new ChromiumPlatformAdapter();
    let activatedListener: ((activeInfo: { tabId: number }) => void) | undefined;
    let updatedListener: ((tabId: number, changeInfo: { url?: string; status?: string }, tab: { id: number; active: boolean; url?: string }) => void) | undefined;

    (globalThis as Record<string, unknown>).chrome = {
      tabs: {
        get: vi.fn().mockImplementation(async (tabId: number) => ({ id: tabId, url: 'https://example.org/page' })),
        onActivated: {
          addListener: (fn: (activeInfo: { tabId: number }) => void) => { activatedListener = fn; },
          removeListener: vi.fn(),
        },
        onUpdated: {
          addListener: (fn: (tabId: number, changeInfo: { url?: string; status?: string }, tab: { id: number; active: boolean; url?: string }) => void) => { updatedListener = fn; },
          removeListener: vi.fn(),
        },
      },
    };

    try {
      const calls: Array<{ id?: number; host?: string; url?: string }> = [];
      const unsubscribe = adapter.onActiveTabChanged((info) => {
        calls.push(info);
      });

      expect(activatedListener).toBeDefined();
      expect(updatedListener).toBeDefined();

      // Trigger activation
      await activatedListener!({ tabId: 202 });
      expect(calls.length).toBe(1);
      expect(calls[0].id).toBe(202);
      expect(calls[0].host).toBe('example.org');

      // Trigger update on active tab
      updatedListener!(202, { url: 'https://aljazeera.com/live' }, { id: 202, active: true, url: 'https://aljazeera.com/live' });
      expect(calls.length).toBe(2);
      expect(calls[1].host).toBe('aljazeera.com');

      unsubscribe();
    } finally {
      delete (globalThis as Record<string, unknown>).chrome;
    }
  });
});

describe('T-03 connectNative (RQ-03, INV-3, INV-8)', () => {
  it('throws a structured NativeConnectionError when chrome.runtime.connectNative is missing', () => {
    const adapter = new ChromiumPlatformAdapter();
    const previous = (globalThis as Record<string, unknown>).chrome;
    delete (globalThis as Record<string, unknown>).chrome;
    try {
      expect(() => adapter.connectNative(NATIVE_HOST_NAME)).toThrow(NativeConnectionError);
      try {
        adapter.connectNative(NATIVE_HOST_NAME);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(NativeConnectionError);
        const serialized = serializeError(err);
        expect(serialized.name).toBe('NativeConnectionError');
        expect(serialized.cause).toBeTruthy();
        expect(serialized.action).toBeTruthy();
      }
    } finally {
      if (previous !== undefined) {
        (globalThis as Record<string, unknown>).chrome = previous;
      }
    }
  });

  it('wraps connectNative throws as NativeConnectionError with name, cause, and action', () => {
    const adapter = new ChromiumPlatformAdapter();
    (globalThis as Record<string, unknown>).chrome = {
      runtime: {
        connectNative: () => {
          throw new Error('Specified native messaging host not found');
        },
      },
    };
    try {
      expect(() => adapter.connectNative(NATIVE_HOST_NAME)).toThrow(NativeConnectionError);
      try {
        adapter.connectNative(NATIVE_HOST_NAME);
      } catch (err: unknown) {
        const serialized = serializeError(err);
        expect(serialized.name).toBe('NativeConnectionError');
        expect(serialized.message).toContain('Specified native messaging host not found');
        expect(serialized.cause).toContain(NATIVE_HOST_NAME);
        expect(serialized.action).toBeTruthy();
      }
    } finally {
      delete (globalThis as Record<string, unknown>).chrome;
    }
  });

  it('returns the port from chrome.runtime.connectNative', () => {
    const adapter = new ChromiumPlatformAdapter();
    const fakePort = {
      name: NATIVE_HOST_NAME,
      postMessage: vi.fn(),
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
    };
    (globalThis as Record<string, unknown>).chrome = {
      runtime: {
        connectNative: vi.fn(() => fakePort),
      },
    };
    try {
      const port = adapter.connectNative(NATIVE_HOST_NAME);
      expect(port).toBe(fakePort);
      expect(fakePort.onDisconnect.addListener).toHaveBeenCalled();
    } finally {
      delete (globalThis as Record<string, unknown>).chrome;
    }
  });
});
