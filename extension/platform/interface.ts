/**
 * extension/platform/interface.ts
 * Platform capability abstraction interface (D-4, D-6, RQ-05, RQ-06, M2 A-1, M3 T-05).
 * Normalizes behavioral, script injection, storage, and capability differences across browser targets.
 */

import type { BrowserTarget, PlatformCapabilities, SerializedError } from '../shared/types';

export type { SerializedError };

export interface SidePanelController {
  open(options?: { tabId?: number; windowId?: number }): Promise<void>;
  setOptions(options: { path: string; enabled?: boolean }): Promise<void>;
  setPanelBehavior(behavior: { openPanelOnActionClick: boolean }): Promise<void>;
}

export interface BackgroundDomContext {
  ensureContext(url: string, justification: string): Promise<boolean>;
  hasContext(): Promise<boolean>;
  closeContext(): Promise<void>;
}

export interface ScriptExecutionOptions {
  tabId?: number;
  world: 'MAIN' | 'USER_SCRIPT';
  cellId: string;
  cellName?: string;
  source: string;
  lineMap?: Array<{
    filePath: string;
    startLine: number;
    endLine: number;
    originalContent: string;
  }>;
  injectedHudScript?: string;
  skipHud?: boolean;
  allowTabRequests?: boolean;
}

export type TabRequest =
  | { type: 'useNewTab'; timeout: number }
  | { type: 'openTab'; url: string }
  | { type: 'goto'; url: string }
  | { type: 'backToOpener'; close: boolean };

export interface TabNavigator {
  waitForNewTab(openerTabId: number, sinceMs: number, timeoutMs: number, signal?: AbortSignal): Promise<number | null>;
  openTab(url: string, signal?: AbortSignal): Promise<number>;
  goto(tabId: number, url: string, signal?: AbortSignal): Promise<void>;
  closeTab(tabId: number): Promise<void>;
  isTabAlive?(tabId: number): Promise<boolean>;
  startTracking?(): void;
  stopTracking?(): void;
}

export interface ScriptExecutionResult {
  ok: boolean;
  result?: unknown;
  output: string;
  error?: SerializedError | null;
  aborted?: boolean;
  tabRequest?: TabRequest;
  attemptedCandidates?: string[];
  candidateIndex?: number;
  candidateMatch?: {
    index: number;
    candidateIndex: number;
    candidate: string;
    candidates: string[];
    elapsedMs?: number;
  };
  ctxDataBefore?: Record<string, unknown>;
  ctxDataAfter?: Record<string, unknown>;
  evidence?: {
    url: string;
    domSnippet: string;
    anchor?: string;
    truncated?: boolean;
    originalBytes?: number;
    screenshot?: {
      part?: number;
      parts?: number;
      jpegBase64: string;
    };
  };
}

export interface ScriptExecutor {
  executeScript(options: ScriptExecutionOptions): Promise<ScriptExecutionResult>;
  configureWorld?(options: { csp?: string; messaging?: boolean }): Promise<void>;
  signalCancel?(tabId: number, token: string): Promise<void>;
}

export interface StorageArea {
  get<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
}

export interface ProjectFileEntry {
  path: string;
  kind: 'file' | 'directory';
  size?: number;
  mtime?: number;
}

export interface ProjectStore {
  readonly kind: 'memory' | 'opfs' | 'disk';
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  listFiles(prefix?: string): Promise<ProjectFileEntry[]>;
}

export interface ActiveTabInfo {
  id?: number;
  host?: string;
  url?: string;
}

export const NATIVE_HOST_NAME = 'com.dogear.host';

export interface NativeMessagingPort {
  name?: string;
  postMessage: (msg: unknown) => void;
  disconnect?: () => void;
  onMessage: {
    addListener: (callback: (msg: unknown) => void) => void;
    removeListener?: (callback: (msg: unknown) => void) => void;
  };
  onDisconnect?: {
    addListener: (callback: () => void) => void;
  };
}

export class NativeConnectionError extends Error {
  override readonly cause: string;
  readonly action: string;

  constructor(message: string, options: { cause: string; action: string }) {
    super(message);
    this.name = 'NativeConnectionError';
    this.cause = options.cause;
    this.action = options.action;
  }
}

export interface PlatformAdapter {
  readonly target: BrowserTarget;
  readonly capabilities: PlatformCapabilities;
  readonly sidePanel: SidePanelController;
  readonly backgroundDom: BackgroundDomContext;
  readonly scriptExecutor: ScriptExecutor;
  readonly storage: StorageArea;
  readonly projectStore?: ProjectStore;
  readonly tabNavigator?: TabNavigator;
  getTabHost?(tabId: number): Promise<string | undefined>;
  getActiveTab?(): Promise<ActiveTabInfo | undefined>;
  onActiveTabChanged?(callback: (tab: ActiveTabInfo) => void): () => void;
  isUserScriptsAvailable?(): boolean;
  connectNative(hostName: string): NativeMessagingPort;
  captureVisibleTab?(windowId?: number): Promise<string | null>;
}


