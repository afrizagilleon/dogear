/**
 * extension/entrypoints/background.ts
 * Background service worker entrypoint.
 * Hosts kernel service, execution dispatcher, cross-origin gmFetch handler, and checkpoint commits (D-1, D-5, D-6, RQ-04, M3 A-1, M4).
 * Sole owner of background message dispatching and cross-origin fetch execution.
 */

import { defineBackground } from 'wxt/sandbox';
import {
  kernelService,
  saveCheckpoint,
  disarmAuto,
  type KernelCell,
} from '../kernel';
import { siteRegistry } from '../registry';
import type { RunCellOptions } from '../kernel/service';
import { executeGmFetch, type GmFetchRequestPayload } from '../platform/fetch';
import { getPlatformAdapter } from '../platform';
import { loadNotebookCells } from '../project/notebook-parser';
import { OpfsProjectStore } from '../project/opfs';
import { setActiveStore, getActiveStore } from '../project/active-store';
import { agentWatcher } from '../agent/watcher';
import type { ProjectStore } from '../platform/interface';
import { nativeBridge, NativeBridge } from '../native/bridge';
import { NativeConnectionManager } from '../native/reconnect';
import { ALL_EXAMPLE_NOTEBOOKS, NOTEBOOK_COMPLETED, NOTEBOOK_SKIPPED, NOTEBOOK_NEEDS_REVIEW, NOTEBOOK_SESSION_DEAD } from '../native/fixtures';

interface BackgroundMessage {
  type?: string;
  cell?: KernelCell;
  options?: RunCellOptions | GmFetchRequestPayload['options'];
  url?: string;
  fetchOptions?: GmFetchRequestPayload['fetchOptions'];
  host?: string;
  cellId?: string;
  data?: Record<string, unknown>;
  site?: string;
}

export default defineBackground(() => {
  console.log('[dogear] Background service worker initialized');
  const g = (typeof self !== 'undefined' ? self : globalThis) as Record<string, unknown>;
  g.__nbKernelService = kernelService;
  g.__nbSiteRegistry = siteRegistry;

  let activeStore: ProjectStore = new OpfsProjectStore();
  setActiveStore(activeStore);
  agentWatcher.start(activeStore);

  const setBackgroundStore = (store: ProjectStore) => {
    activeStore = store;
    setActiveStore(store);
    nativeBridge.setStore(store);
    agentWatcher.start(store);
  };
  g.__nbSetBackgroundStore = setBackgroundStore;
  g.__nbGetBackgroundStore = () => getActiveStore() || activeStore;
  g.__nbAgentWatcher = agentWatcher;
  g.__nbNativeBridge = nativeBridge;
  g.__nbNativeBridgeClass = NativeBridge;
  g.__nbNativeFixtures = { ALL_EXAMPLE_NOTEBOOKS, NOTEBOOK_COMPLETED, NOTEBOOK_SKIPPED, NOTEBOOK_NEEDS_REVIEW, NOTEBOOK_SESSION_DEAD };

  // Configure side panel to open on toolbar action click (A3-T1, F-12, INV-3)
  const platform = getPlatformAdapter();
  g.__nbGetPlatformAdapter = getPlatformAdapter;
  platform.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
    console.warn('[dogear] Failed to set openPanelOnActionClick behavior:', err);
  });

  // Native messaging connection and autonomous wakeup manager (T-06, RQ-11, K-10, K-11)
  const connectionManager = new NativeConnectionManager({
    platformAdapter: platform,
    bridge: nativeBridge,
    getLastErrorFn: () => (typeof chrome !== 'undefined' ? chrome.runtime?.lastError?.message : undefined),
    onLog: (msg, ...args) => console.log('[dogear]', msg, ...args),
  });
  g.__nbNativeConnectionManager = connectionManager;

  const HEARTBEAT_ALARM_NAME = 'native-heartbeat';

  const ensureHeartbeatAlarm = () => {
    if (typeof chrome === 'undefined' || !chrome.alarms) return;
    chrome.alarms.get(HEARTBEAT_ALARM_NAME, (alarm) => {
      if (!alarm) {
        chrome.alarms.create(HEARTBEAT_ALARM_NAME, {
          periodInMinutes: 1,
        });
        console.log('[dogear] Scheduled periodic heartbeat alarm (1 min):', HEARTBEAT_ALARM_NAME);
      }
    });
  };

  const tryConnectNative = () => {
    const manifest = typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest() : undefined;
    const runtimeId = typeof chrome !== 'undefined' && chrome.runtime?.id ? chrome.runtime.id : undefined;
    connectionManager.connect({ manifest, runtimeId });
  };

  // Autonomous wake-up listeners (RQ-11, OQ-3, K-10, K-11)
  if (typeof chrome !== 'undefined' && chrome.runtime?.onStartup) {
    chrome.runtime.onStartup.addListener(() => {
      console.log('[dogear] chrome.runtime.onStartup fired');
      ensureHeartbeatAlarm();
      tryConnectNative();
    });
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => {
      console.log('[dogear] chrome.runtime.onInstalled fired');
      ensureHeartbeatAlarm();
      tryConnectNative();
    });
  }

  if (typeof chrome !== 'undefined' && chrome.alarms?.onAlarm) {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === HEARTBEAT_ALARM_NAME) {
        console.log('[dogear] Heartbeat alarm fired at', Date.now());

        if (!connectionManager.isPortAlive() && !nativeBridge.isRunningPipeline) {
          console.log('[dogear] Heartbeat alarm fired, reconnecting native port');
          tryConnectNative();
        }
      }
    });
  }

  // Initial startup connection & alarm registration
  ensureHeartbeatAlarm();
  tryConnectNative();

  // Ensure messaging is enabled for user scripts
  if (typeof chrome !== 'undefined' && chrome.userScripts?.configureWorld) {
    chrome.userScripts.configureWorld({ messaging: true }).catch(() => {});
  }

  const handleMessage = (
    message: BackgroundMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    if (message?.type === 'RUN_CELL' && message.cell) {
      kernelService.runCell(message.cell, message.options as RunCellOptions).then(sendResponse);
      return true;
    }

    if (message?.type === 'GM_FETCH') {
      // gmFetch: Perform cross-origin fetch in background Service Worker context (D-1, RQ-04, M3 A-1)
      // Background context possesses host_permissions and is exempt from document-level SOP/CORS.
      executeGmFetch({
        url: message.url,
        fetchOptions: message.fetchOptions,
        options: message.options as GmFetchRequestPayload['options'],
      }).then(sendResponse);
      return true;
    }

    if (message?.type === 'NB_CHECKPOINT_COMMIT') {
      const adapter = getPlatformAdapter();
      const host = message.host || 'default';
      saveCheckpoint(adapter.storage, host, {
        lastSuccessCellId: message.cellId || null,
        data: message.data || {},
      }).then(() => sendResponse({ ok: true }));
      return true;
    }

    if (message?.type === 'NB_AUTO_DISARM') {
      const adapter = getPlatformAdapter();
      const host = message.host || 'default';
      disarmAuto(adapter.storage, host).then(() => sendResponse({ ok: true }));
      return true;
    }

    if (message?.type === 'REGISTRY_ADD' && message.site) {
      siteRegistry.add(message.site).then((sites) => sendResponse({ ok: true, sites }));
      return true;
    }

    if (message?.type === 'REGISTRY_REMOVE' && message.site) {
      siteRegistry.remove(message.site).then((sites) => sendResponse({ ok: true, sites }));
      return true;
    }

    if (message?.type === 'REGISTRY_LIST') {
      siteRegistry.list().then((sites) => sendResponse({ ok: true, sites }));
      return true;
    }
  };

  const runNextCellOnTab = async (tabId?: number, _url?: string, store?: ProjectStore): Promise<unknown> => {
    let targetTabId = tabId;
    if (targetTabId === undefined && typeof chrome !== 'undefined' && chrome.tabs?.query) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      targetTabId = tabs[0]?.id;
    }
    if (targetTabId === undefined) {
      console.warn('[dogear] No target tab found to run cell');
      return { ok: false, error: 'No target tab found' };
    }

    const currentStore = store || activeStore;
    let notebookMd = '';
    try {
      notebookMd = await currentStore.readFile('notebook.md');
    } catch {
      return { ok: false, error: 'Failed to read notebook.md from project store' };
    }

    let loaded: { cells: KernelCell[] };
    try {
      loaded = await loadNotebookCells(notebookMd, currentStore);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Failed to load notebook cells: ${msg}` };
    }

    if (!loaded.cells || loaded.cells.length === 0) {
      return { ok: false, error: 'No enabled steps found in notebook.md' };
    }

    const firstCell = loaded.cells[0];
    return await kernelService.runCell(firstCell, { tabId: targetTabId });
  };

  g.__nbRunNextCellOnTab = runNextCellOnTab;

  // Keyboard shortcut trigger: Ctrl+Shift+E (D-1 revised, §10.6.2)
  if (typeof chrome !== 'undefined' && chrome.commands?.onCommand) {
    chrome.commands.onCommand.addListener((command) => {
      console.log('[dogear Command] Triggered command:', command);
      runNextCellOnTab().catch((err) => {
        console.error('[dogear Command] Error running cell:', err);
      });
    });
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(handleMessage);
  }

  const runtimeWithUserScript = typeof chrome !== 'undefined'
    ? (chrome.runtime as unknown as { onUserScriptMessage?: { addListener: (fn: typeof handleMessage) => void } })
    : undefined;
  if (runtimeWithUserScript?.onUserScriptMessage?.addListener) {
    runtimeWithUserScript.onUserScriptMessage.addListener(handleMessage);
  }
});
