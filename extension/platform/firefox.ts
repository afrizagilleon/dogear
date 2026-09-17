/**
 * extension/platform/firefox.ts
 * Firefox platform implementation (Gecko / Tier-2 target).
 * Encapsulates browser.sidebarAction, browser.storage, and background DOM handling (D-4, D-6, RQ-05, RQ-06, M2 A-1, M3 T-05).
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
  type NativeMessagingPort,
} from './interface';
import type { PlatformCapabilities } from '../shared/types';

class FirefoxSidePanelController implements SidePanelController {
  async open(_options?: { tabId?: number; windowId?: number }): Promise<void> {
    const browserApi = (globalThis as Record<string, unknown>).browser as { sidebarAction?: { open?: () => Promise<void> } } | undefined;
    if (browserApi?.sidebarAction?.open) {
      await browserApi.sidebarAction.open();
    }
  }

  async setOptions(options: { path: string; enabled?: boolean }): Promise<void> {
    const browserApi = (globalThis as Record<string, unknown>).browser as { sidebarAction?: { setPanel?: (opts: { panel: string }) => Promise<void> } } | undefined;
    if (browserApi?.sidebarAction?.setPanel) {
      await browserApi.sidebarAction.setPanel({ panel: options.path });
    }
  }

  async setPanelBehavior(_behavior: { openPanelOnActionClick: boolean }): Promise<void> {
    // Firefox uses sidebarAction which handles toolbar clicks natively
  }
}

class FirefoxBackgroundDomContext implements BackgroundDomContext {
  async ensureContext(_url: string, _justification: string): Promise<boolean> {
    return true;
  }

  async hasContext(): Promise<boolean> {
    return true;
  }

  async closeContext(): Promise<void> {
    // No-op for Firefox background context
  }
}

class FirefoxScriptExecutor implements ScriptExecutor {
  async executeScript(options: ScriptExecutionOptions): Promise<ScriptExecutionResult> {
    const browserApi = (globalThis as Record<string, unknown>).browser as {
      scripting?: {
        executeScript?: (args: Record<string, unknown>) => Promise<Array<{ result: unknown }>>;
      };
      tabs?: {
        query?: (queryInfo: Record<string, unknown>) => Promise<Array<{ id?: number }>>;
      };
    } | undefined;

    let tabId = options.tabId;
    if (tabId === undefined && browserApi?.tabs?.query) {
      const tabs = await browserApi.tabs.query({ active: true, currentWindow: true });
      if (tabs.length > 0 && tabs[0].id !== undefined) {
        tabId = tabs[0].id;
      }
    }

    if (tabId === undefined) {
      throw new Error('[platform:FATAL] No active browser tab found for Firefox script execution');
    }

    if (browserApi?.scripting?.executeScript) {
      const targetWorld = options.world === 'USER_SCRIPT' ? 'ISOLATED' : 'MAIN';
      const results = await browserApi.scripting.executeScript({
        target: { tabId },
        world: targetWorld,
        func: (sourceCode: string) => {
          return { ok: true, result: sourceCode, output: '' };
        },
        args: [options.source],
      });
      return (results[0]?.result as ScriptExecutionResult) || { ok: false, output: 'No result from Firefox' };
    }

    throw new Error('[platform:FATAL] browser.scripting is not available on Firefox');
  }

  async signalCancel(tabId: number, token: string): Promise<void> {
    const browserApi = (globalThis as Record<string, unknown>).browser as {
      scripting?: {
        executeScript?: (args: Record<string, unknown>) => Promise<Array<{ result: unknown }>>;
      };
    } | undefined;
    if (!browserApi?.scripting?.executeScript) {
      throw new Error('[platform:FATAL] browser.scripting is not available on Firefox');
    }
    await browserApi.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (tok: string) => {
        const w = window as unknown as {
          __nbCancel?: string;
          __nbCancelWrittenAt?: number;
          __nbAbortCell?: () => void;
        };
        w.__nbCancel = tok;
        w.__nbCancelWrittenAt = Date.now();
        if (typeof w.__nbAbortCell === 'function') w.__nbAbortCell();
        return { cancel: w.__nbCancel };
      },
      args: [token],
    });
  }
}

class FirefoxStorage implements StorageArea {
  private getStorage() {
    const browserApi = (globalThis as Record<string, unknown>).browser as {
      storage?: {
        local?: {
          get: (keys: string | string[] | null) => Promise<Record<string, unknown>>;
          set: (items: Record<string, unknown>) => Promise<void>;
          remove: (keys: string | string[]) => Promise<void>;
          clear: () => Promise<void>;
        };
      };
    } | undefined;
    return browserApi?.storage?.local;
  }

  async get<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined> {
    const st = this.getStorage();
    if (!st) return defaultValue;
    const res = await st.get(key);
    if (res && Object.prototype.hasOwnProperty.call(res, key)) {
      return res[key] as T;
    }
    return defaultValue;
  }

  async set<T = unknown>(key: string, value: T): Promise<void> {
    const st = this.getStorage();
    if (!st) throw new Error('[platform:FATAL] browser.storage.local is not available');
    await st.set({ [key]: value });
  }

  async remove(key: string): Promise<void> {
    const st = this.getStorage();
    if (!st) return;
    await st.remove(key);
  }

  async clear(): Promise<void> {
    const st = this.getStorage();
    if (!st) return;
    await st.clear();
  }

  async keys(): Promise<string[]> {
    const st = this.getStorage();
    if (!st) return [];
    const all = await st.get(null);
    return Object.keys(all || {});
  }
}

export class FirefoxPlatformAdapter implements PlatformAdapter {
  readonly target = 'firefox' as const;
  readonly capabilities: PlatformCapabilities = {
    hasSidePanel: true,
    hasOffscreenDocument: false,
    hasUserScripts: false,
  };
  readonly sidePanel: SidePanelController = new FirefoxSidePanelController();
  readonly backgroundDom: BackgroundDomContext = new FirefoxBackgroundDomContext();
  readonly scriptExecutor: ScriptExecutor = new FirefoxScriptExecutor();
  readonly storage: StorageArea = new FirefoxStorage();

  connectNative(hostName: string): NativeMessagingPort {
    const browserApi = (globalThis as Record<string, unknown>).browser as {
      runtime?: { connectNative?: (name: string) => NativeMessagingPort };
    } | undefined;
    if (!browserApi?.runtime?.connectNative) {
      throw new NativeConnectionError('browser.runtime.connectNative tidak tersedia', {
        cause: 'API native messaging tidak ada di konteks Firefox ini',
        action: 'Pastikan izin nativeMessaging ada di manifest dan pemanggilan berjalan di background',
      });
    }
    try {
      return browserApi.runtime.connectNative(hostName);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new NativeConnectionError(msg, {
        cause: `browser.runtime.connectNative('${hostName}') gagal`,
        action: 'Daftarkan host native com.dogear.host lalu ulangi',
      });
    }
  }
}
