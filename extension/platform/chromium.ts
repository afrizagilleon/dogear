/**
 * extension/platform/chromium.ts
 * Chromium platform implementation (Chrome / Edge).
 * Encapsulates chrome.sidePanel, chrome.offscreen, and browser userScripts injection (D-4, RQ-06, M2 A-2, M3 T-01).
 */

import { INJECTED_HELPERS_SCRIPT } from '../kernel/helpers';
import { INJECTED_CHECKPOINT_SCRIPT } from '../kernel/checkpoint';
import { INJECTED_REMAP_STACK_SCRIPT } from '../kernel/errors';
import {
  NativeConnectionError,
  type PlatformAdapter,
  type SidePanelController,
  type BackgroundDomContext,
  type ScriptExecutor,
  type ScriptExecutionOptions,
  type ScriptExecutionResult,
  type StorageArea,
  type ActiveTabInfo,
  type NativeMessagingPort,
  type TabNavigator,
} from './interface';
import { type PlatformCapabilities, serializeError } from '../shared/types';

/**
 * Checks if chrome.userScripts API is available in current context (RQ-01, INV-7).
 */
export function isUserScriptsAvailable(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.userScripts);
}

let globalInjectedHudScript = '';

/**
 * Configure or register in-page HUD script injection (D-4, RQ-02).
 * In Studio, sidepanel/editor registers INJECTED_HUD_SCRIPT.
 * In Runtime, HUD script is absent so zero HUD elements or styles are mounted.
 * Designed so that enabling HUD in runtime later only requires setting a build flag
 * or registering a provider, without modifying execution layers.
 */
export function setInjectedHudScript(script: string): void {
  globalInjectedHudScript = script;
}

export function getInjectedHudScript(): string {
  if (globalInjectedHudScript) return globalInjectedHudScript;
  const g = (typeof globalThis !== 'undefined' ? globalThis : self) as Record<string, unknown>;
  return (g.__nbInjectedHudScript as string) || '';
}

class ChromiumSidePanelController implements SidePanelController {
  async open(options?: { tabId?: number; windowId?: number }): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.sidePanel?.open) {
      if (options?.tabId !== undefined) {
        await chrome.sidePanel.open({ tabId: options.tabId });
      } else if (options?.windowId !== undefined) {
        await chrome.sidePanel.open({ windowId: options.windowId });
      }
    }
  }

  async setOptions(options: { path: string; enabled?: boolean }): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.sidePanel?.setOptions) {
      await chrome.sidePanel.setOptions({
        path: options.path,
        enabled: options.enabled ?? true,
      });
    }
  }

  async setPanelBehavior(behavior: { openPanelOnActionClick: boolean }): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({
        openPanelOnActionClick: behavior.openPanelOnActionClick,
      });
    }
  }
}

class ChromiumBackgroundDomContext implements BackgroundDomContext {
  async ensureContext(url: string, justification: string): Promise<boolean> {
    if (typeof chrome === 'undefined' || !chrome.offscreen?.createDocument) {
      return false;
    }
    const hasDoc = await this.hasContext();
    if (!hasDoc) {
      await chrome.offscreen.createDocument({
        url,
        reasons: ['WORKERS' as chrome.offscreen.Reason],
        justification,
      });
      return true;
    }
    return false;
  }

  async hasContext(): Promise<boolean> {
    if (typeof chrome === 'undefined' || !chrome.offscreen?.hasDocument) {
      return false;
    }
    return await chrome.offscreen.hasDocument();
  }

  async closeContext(): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.offscreen?.closeDocument) {
      const hasDoc = await this.hasContext();
      if (hasDoc) {
        await chrome.offscreen.closeDocument();
      }
    }
  }
}

class ChromiumScriptExecutor implements ScriptExecutor {
  async configureWorld(options: { csp?: string; messaging?: boolean }): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.userScripts?.configureWorld) {
      await chrome.userScripts.configureWorld({
        messaging: options.messaging ?? true,
        csp: options.csp,
      });
    }
  }

  async executeScript(options: ScriptExecutionOptions): Promise<ScriptExecutionResult> {
    // 1. Validate chrome.userScripts availability (INV-8, RQ-01)
    if (!isUserScriptsAvailable()) {
      return {
        ok: false,
        error: serializeError(new Error('chrome.userScripts API is not available')),
        output: '✖ InjectionPathwayError: chrome.userScripts API is not available.\n  Sebab: Toggle "Allow user scripts" belum aktif di chrome://extensions pada profil ini.\n  Tindakan: Buka chrome://extensions, aktifkan Developer Mode, dan nyalakan "Allow user scripts" untuk dogear.',
      };
    }

    // 2. Resolve target tabId if not explicitly provided
    let tabId = options.tabId;
    if (tabId === undefined && chrome.tabs?.query) {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0 && tabs[0].id !== undefined) {
          tabId = tabs[0].id;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: serializeError(err),
          output: `✖ InjectionPathwayError: Gagal mencari tab aktif.\n  Sebab: ${msg}\n  Tindakan: Pastikan ekstensi memiliki izin tabs/activeTab.`,
        };
      }
    }

    if (tabId === undefined) {
      return {
        ok: false,
        error: serializeError(new Error('No active browser tab found for script execution')),
        output: '✖ InjectionPathwayError: Tab browser target tidak ditemukan.\n  Sebab: Tidak ada tab aktif atau tabId yang valid untuk injeksi script.\n  Tindakan: Buka atau pilih tab target sebelum menjalankan cell.',
      };
    }

    const cellName = options.cellName || options.cellId;
    const targetWorld = options.world || 'MAIN';
    const userLineMapJson = JSON.stringify(options.lineMap || []);
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
      return {
        ok: false,
        error: serializeError(new Error('chrome.runtime.id is undefined: Extension runtime context is missing')),
        output: '✖ InjectionPathwayError: chrome.runtime.id tidak ditemukan.\n  Sebab: Konteks ekstensi tidak terpasang atau ID ekstensi belum diinisialisasi.\n  Tindakan: Muat ulang ekstensi dari halaman chrome://extensions.',
      };
    }
    const extensionId = chrome.runtime.id;
    const hudScript = options.skipHud ? '' : (options.injectedHudScript || getInjectedHudScript());

    const prefixCode = `(async () => {
  const g = (typeof window !== 'undefined' ? window : globalThis);
  const ctxKey = '__nb_steprunner_ctx';
  if (!g[ctxKey]) {
    g[ctxKey] = { data: {}, refs: {}, lib: {} };
  }
  const ctx = g[ctxKey];
  const out = [];

  // K-1: Bersihkan global "pick terakhir" di awal setiap langkah (window, globalThis, dan ctx).
  // Jangan sentuh __nb_picks.
  if (typeof window !== 'undefined') {
    window.__nb_last_element = null;
    window.__nb_last_pick = null;
    window.__nb_last_selector = null;
    window.__nb_last_candidates = null;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.__nb_last_element = null;
    globalThis.__nb_last_pick = null;
    globalThis.__nb_last_selector = null;
    globalThis.__nb_last_candidates = null;
  }
  if (ctx) {
    ctx.__nb_last_element = null;
    ctx.__nb_last_pick = null;
    ctx.__nb_last_selector = null;
    ctx.__nb_last_candidates = null;
  }

  // K-12: Bersihkan permintaan tab di awal tiap langkah di window, globalThis, dan ctx.
  if (typeof window !== 'undefined') {
    window.__nb_tab_request = null;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.__nb_tab_request = null;
  }
  if (ctx) {
    ctx.__nb_tab_request = null;
  }

  const __nb_allow_tab_requests = ${!!options.allowTabRequests};

  const formatVal = (v) => {
    if (v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (v === null) return 'null';
    if (typeof Element !== 'undefined' && v instanceof Element) {
      return ('<' + v.tagName.toLowerCase() + '> ' + (v.className || '')).trim();
    }
    if (typeof Node !== 'undefined' && v instanceof Node) {
      return '[' + v.nodeName + ']';
    }
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  };

  const print = (...args) => {
    out.push(args.map(a => typeof a === 'string' ? a : formatVal(a)).join(' '));
  };

  ${INJECTED_HELPERS_SCRIPT}

  ${INJECTED_CHECKPOINT_SCRIPT}

  ${hudScript}

  if (typeof mountInPageHud === 'function') {
    mountInPageHud({ status: 'running', stepName: '${cellName}', visible: true });
  }

  const gmFetch = (url, opts = {}) => new Promise((resolve, reject) => {
    const handleResponse = (res) => {
      if (!res) return reject(new Error('gmFetch failed: No response received from background worker'));
      if (!res.ok) return reject(new Error('gmFetch error: ' + (res.error || res.statusText || 'Fetch failed')));
      resolve(res.data);
    };

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      const sendFn = chrome.runtime.id
        ? (msg, cb) => chrome.runtime.sendMessage(msg, cb)
        : (msg, cb) => chrome.runtime.sendMessage('${extensionId}', msg, cb);
      sendFn({ type: 'GM_FETCH', url, options: opts }, (res) => {
        if (typeof chrome !== 'undefined' && chrome.runtime?.lastError) {
          return reject(new Error('gmFetch failed: ' + chrome.runtime.lastError.message));
        }
        handleResponse(res);
      });
    } else if (typeof window !== 'undefined' && typeof window.postMessage === 'function') {
      const reqId = 'gmf_' + Math.random().toString(36).slice(2) + '_' + Date.now();
      const timeoutTimer = setTimeout(() => {
        window.removeEventListener('message', onMsg);
        reject(new Error('gmFetch timeout (10000ms): No response from background bridge'));
      }, 10000);
      const onMsg = (event) => {
        if (event.data && event.data.type === '__NB_GM_FETCH_RES__' && event.data.id === reqId) {
          clearTimeout(timeoutTimer);
          window.removeEventListener('message', onMsg);
          handleResponse(event.data.result);
        }
      };
      window.addEventListener('message', onMsg);
      window.postMessage({
        type: '__NB_GM_FETCH_REQ__',
        id: reqId,
        payload: { type: 'GM_FETCH', url, options: opts },
      }, '*');
    } else {
      reject(new Error('gmFetch failed: Unsupported execution context'));
    }
  });

  const auto = {
    get armed() { return !!g.__nb_auto_armed; },
    async next(target) {
      const currentSnap = safeSnapshot(ctx.data);
      const host = (typeof location !== 'undefined' ? location.host : '') || 'default';
      const cellId = '${cellName || 'cell'}';
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        const sendFn = chrome.runtime.id
          ? (msg, cb) => chrome.runtime.sendMessage(msg, cb)
          : (msg, cb) => chrome.runtime.sendMessage('${extensionId}', msg, cb);
        await new Promise((resolve) => {
          sendFn({
            type: 'NB_CHECKPOINT_COMMIT',
            host,
            cellId,
            data: currentSnap,
          }, () => resolve());
        });
      } else {
        await new Promise((resolve) => {
          const reqId = 'cp_' + Math.random().toString(36).slice(2);
          const onCpMsg = (evt) => {
            if (evt.data && evt.data.type === '__NB_CP_RES__' && evt.data.id === reqId) {
              window.removeEventListener('message', onCpMsg);
              resolve();
            }
          };
          window.addEventListener('message', onCpMsg);
          window.postMessage({
            type: '__NB_CP_REQ__',
            id: reqId,
            payload: {
              type: 'NB_CHECKPOINT_COMMIT',
              host,
              cellId,
              data: currentSnap,
            },
          }, '*');
        });
      }
      if (typeof target === 'function') await target();
      else if (typeof target === 'string') location.assign(target);
      await parkForUnload(30000);
    },
    async stop() {
      const host = (typeof location !== 'undefined' ? location.host : '') || 'default';
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        const sendFn = chrome.runtime.id
          ? (msg, cb) => chrome.runtime.sendMessage(msg, cb)
          : (msg, cb) => chrome.runtime.sendMessage('${extensionId}', msg, cb);
        await new Promise((resolve) => {
          sendFn({ type: 'NB_AUTO_DISARM', host }, () => resolve());
        });
      } else {
        await new Promise((resolve) => {
          const reqId = 'disarm_' + Math.random().toString(36).slice(2);
          const onDisarmMsg = (evt) => {
            if (evt.data && evt.data.type === '__NB_DISARM_RES__' && evt.data.id === reqId) {
              window.removeEventListener('message', onDisarmMsg);
              resolve();
            }
          };
          window.addEventListener('message', onDisarmMsg);
          window.postMessage({
            type: '__NB_DISARM_REQ__',
            id: reqId,
            payload: { type: 'NB_AUTO_DISARM', host },
          }, '*');
        });
      }
      print('■ auto stopped');
    },
  };

  const api = { ctx, print, $, $$, waitFor, pick, click, ClickBlockedError, fill, FillVerifyError, FillStrategyError, NotEditableError, press, sleep, parkForUnload, auto, AbortError, gmFetch, fmt: formatVal, useNewTab, openTab, goto, backToOpener };
  let __res;
  let __ok = true;
  let __err = null;
  const __snapBefore = safeSnapshot(ctx.data);
  try {
    __res = await (async () => {
      const { ctx, print, $, $$, waitFor, pick, click, ClickBlockedError, fill, FillVerifyError, FillStrategyError, NotEditableError, press, sleep, parkForUnload, auto, AbortError, gmFetch, fmt, useNewTab, openTab, goto, backToOpener } = api;
`;

    const userCodeOffset = prefixCode.split('\n').length - 1;

    const suffixCode = `
    })();
    if (__res !== undefined) {
      out.push(formatVal(__res));
    }
    if (typeof mountInPageHud === 'function') {
      mountInPageHud({
        status: 'ok',
        stepName: '${cellName}',
        output: (formatVal(__res) || out.join('\\n')),
        visible: true,
      });
    }
  } catch (e) {
    __ok = false;
    const aborted = !!(e && e.name === 'AbortError');
    if (aborted) {
      __err = {
        name: 'AbortError',
        message: (e && e.message != null) ? String(e.message) : 'aborted',
      };
      out.push('■ stopped');
      if (typeof mountInPageHud === 'function') {
        mountInPageHud({
          status: 'ok',
          stepName: '${cellName}',
          output: '■ stopped',
          visible: true,
        });
      }
    } else {
      const rawStack = e?.stack || '';
      const lineMap = ${userLineMapJson};
      ${INJECTED_REMAP_STACK_SCRIPT}
      const remapped = remapInPageStack(rawStack, lineMap, ${userCodeOffset});
      const errObj = {
        name: (e && typeof e.name === 'string' && e.name) ? e.name : 'Error',
        message: (e && e.message != null) ? String(e.message) : String(e),
      };
      if (remapped || rawStack) {
        errObj.stack = remapped || rawStack;
      }
      if (e && (e.cause || e.sebab)) {
        errObj.cause = String(e.cause || e.sebab);
      }
      if (e && (e.action || e.tindakan)) {
        errObj.action = String(e.action || e.tindakan);
      }
      if (e && Array.isArray(e.candidates)) {
        errObj.candidates = e.candidates;
      }
      __err = errObj;
      const own = (remapped || rawStack).split('\\n').filter(l => /(?:nb-(?:cell|frame)|[a-zA-Z0-9_\\-\\.\\/]+\\.(?:js|ts)):/.test(l)).map(l => '  ' + l.trim());
      const causeText = (e && (e.cause || e.sebab)) ? String(e.cause || e.sebab) : 'Eksepsi dilempar saat mengeksekusi step.';
      const actionText = (e && (e.action || e.tindakan)) ? String(e.action || e.tindakan) : 'Periksa logika pada kode step atau tangani error dengan blok try/catch.';
      out.push('✖ ' + (e?.name || 'Error') + ': ' + errObj.message + (own.length ? '\\n' + own.join('\\n') : '') + '\\n  Sebab: ' + causeText + '\\n  Tindakan: ' + actionText);
      if (typeof mountInPageHud === 'function') {
        mountInPageHud({
          status: 'error',
          stepName: '${cellName}',
          output: errObj.message,
          visible: true,
        });
      }
    }
  }
  const __snapAfter = safeSnapshot(ctx.data);
  const captureInPageDomSnippet = (targetEl, err) => {
    try {
      if (typeof document === 'undefined' || !document.body) {
        return { domSnippet: '', anchor: 'none' };
      }

      if (targetEl && typeof targetEl === 'object' && targetEl.nodeType === 1) {
        const parent = targetEl.parentElement;
        const snip = (parent && parent !== document.body) ? parent.outerHTML : targetEl.outerHTML;
        return { domSnippet: snip, anchor: (targetEl.tagName ? targetEl.tagName.toLowerCase() : 'element') };
      }

      const searchTerms = [];
      if (err && err.candidates && Array.isArray(err.candidates)) {
        searchTerms.push(...err.candidates);
      }
      if (typeof window !== 'undefined' && window.__nb_last_selector) {
        searchTerms.push(window.__nb_last_selector);
      }
      if (typeof window !== 'undefined' && Array.isArray(window.__nb_last_candidates)) {
        searchTerms.push(...window.__nb_last_candidates);
      }

      const tokens = [];
      for (let i = 0; i < searchTerms.length; i++) {
        const st = searchTerms[i];
        if (!st || typeof st !== 'string') continue;
        tokens.push(st);
        const clean = st.replace(/^[#.]/, '');
        tokens.push(clean);
        const parts = clean.split(/[-_]/);
        if (parts.length > 1) {
          tokens.push(...parts);
        }
      }

      let bestMatch = null;
      if (tokens.length > 0) {
        const allElements = Array.from(document.querySelectorAll('*'));
        for (let i = 0; i < tokens.length; i++) {
          const token = tokens[i];
          if (!token || token.length < 3) continue;
          const lowerToken = token.toLowerCase();
          for (let j = 0; j < allElements.length; j++) {
            const el = allElements[j];
            const id = (el.id || '').toLowerCase();
            const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
            if (id && (id.indexOf(lowerToken) !== -1 || lowerToken.indexOf(id) !== -1)) {
              bestMatch = el;
              break;
            }
            if (cls && (cls.indexOf(lowerToken) !== -1 || lowerToken.indexOf(cls) !== -1)) {
              bestMatch = el;
              break;
            }
          }
          if (bestMatch) break;
        }
      }

      if (bestMatch) {
        const container = bestMatch.parentElement || bestMatch;
        const snip = (container.parentElement && container.parentElement !== document.body)
          ? container.parentElement.outerHTML
          : container.outerHTML;
        return { domSnippet: snip, anchor: (bestMatch.tagName ? bestMatch.tagName.toLowerCase() : 'element') };
      }

      // K-4: Kalau tidak ada jangkar sama sekali, nyatakan ketiadaan secara terbuka
      const candDesc = searchTerms.length > 0 ? searchTerms.map(s => '"' + s + '"').join(', ') : 'none';
      const pageTitle = typeof document !== 'undefined' && document.title ? (' "' + document.title + '"') : '';
      return {
        domSnippet: '<!-- [anchor: none] Halaman' + pageTitle + ': tidak ditemukan elemen yang cocok untuk kandidat selector: ' + candDesc + ' -->',
        anchor: 'none',
      };
    } catch {
      return { domSnippet: '', anchor: 'none' };
    }
  };

  const __evidenceRes = captureInPageDomSnippet(
    __ok ? (typeof window !== 'undefined' ? window.__nb_last_element : null) : null,
    __err
  );

  const lastPick = (typeof window !== 'undefined' ? window.__nb_last_pick : null) || (ctx ? ctx.__nb_last_pick : null) || null;
  const __tabReq = (typeof window !== 'undefined' ? window.__nb_tab_request : null)
    || (ctx ? ctx.__nb_tab_request : null)
    || (typeof globalThis !== 'undefined' ? globalThis.__nb_tab_request : null)
    || null;
  const resObj = {
    ok: __ok,
    aborted: !!(__err && __err.name === 'AbortError'),
    result: __res,
    output: out.join('\\n'),
    error: __err,
    tabRequest: __ok ? (__tabReq || undefined) : undefined,
    attemptedCandidates: (__err && Array.isArray(__err.candidates)) ? __err.candidates : undefined,
    candidateIndex: __ok ? (lastPick ? lastPick.candidateIndex : undefined) : undefined,
    candidateMatch: __ok ? (lastPick || undefined) : undefined,
    ctxDataBefore: __snapBefore,
    ctxDataAfter: __snapAfter,
    evidence: {
      url: (typeof location !== 'undefined' ? location.href : ''),
      domSnippet: __evidenceRes.domSnippet,
      anchor: __evidenceRes.anchor,
    },
  };
  g.__nb_last_result = resObj;
  return resObj;
})();
//# sourceURL=nb-cell-${cellName}.js`;

    const wrappedCode = prefixCode + options.source + suffixCode;

    const userScripts = chrome.userScripts as unknown as {
      execute?: (details: {
        target: { tabId: number };
        world?: string;
        js: Array<{ code: string }>;
      }) => Promise<Array<{ result?: unknown }>>;
      register?: typeof chrome.userScripts.register;
      unregister?: typeof chrome.userScripts.unregister;
    };

    // 3. Primary execution pathway: chrome.userScripts.execute
    if (userScripts.execute) {
      try {
        if (targetWorld === 'MAIN') {
          // Ensure messaging enabled for USER_SCRIPT world
          if (chrome.userScripts?.configureWorld) {
            try {
              await chrome.userScripts.configureWorld({ messaging: true });
            } catch {}
          }
          // Inject bridge into USER_SCRIPT realm on target tab
          try {
            await userScripts.execute({
              target: { tabId },
              world: 'USER_SCRIPT',
              js: [
                {
                  code: `(() => {
                    if (window.__nb_bridge_active) return;
                    window.__nb_bridge_active = true;
                    window.addEventListener('message', (evt) => {
                      if (!evt.data) return;
                      if (evt.data.type === '__NB_GM_FETCH_REQ__') {
                        const reqId = evt.data.id;
                        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                          chrome.runtime.sendMessage(evt.data.payload, (res) => {
                            const lastErr = typeof chrome !== 'undefined' && chrome.runtime?.lastError ? chrome.runtime.lastError.message : null;
                            window.postMessage({
                              type: '__NB_GM_FETCH_RES__',
                              id: reqId,
                              result: lastErr ? { ok: false, error: lastErr } : res,
                            }, '*');
                          });
                        } else {
                          window.postMessage({
                            type: '__NB_GM_FETCH_RES__',
                            id: reqId,
                            result: { ok: false, error: 'chrome.runtime messaging unavailable in USER_SCRIPT realm' },
                          }, '*');
                        }
                      }
                      if (evt.data.type === '__NB_CP_REQ__') {
                        const reqId = evt.data.id;
                        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                          chrome.runtime.sendMessage(evt.data.payload, () => {
                            window.postMessage({ type: '__NB_CP_RES__', id: reqId }, '*');
                          });
                        }
                      }
                      if (evt.data.type === '__NB_DISARM_REQ__') {
                        const reqId = evt.data.id;
                        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                          chrome.runtime.sendMessage(evt.data.payload, () => {
                            window.postMessage({ type: '__NB_DISARM_RES__', id: reqId }, '*');
                          });
                        }
                      }
                    });
                  })();`,
                },
              ],
            });
          } catch {}
        }

        const results = await userScripts.execute({
          target: { tabId },
          world: targetWorld,
          js: [{ code: wrappedCode }],
        });

        if (!results || results.length === 0 || !results[0]?.result) {
          return {
            ok: false,
            error: serializeError(new Error('User script execution produced empty result')),
            output: `✖ InjectionPathwayError: Injeksi user script ke tab ${tabId} tidak mengembalikan frame result.\n  Sebab: Halaman target mungkin mengalami navigasi/reload, tab tertutup, atau frame context terputus.\n  Tindakan: Pastikan tab tetap terbuka dan muat ulang halaman sebelum menjalankan ulang cell.`,
          };
        }

        const res = results[0].result as ScriptExecutionResult;
        if (!res.ok && res.error) {
          res.error = serializeError(res.error);
        }
        return res;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: serializeError(err),
          output: `✖ InjectionPathwayError: Eksekusi chrome.userScripts.execute pada tab ${tabId} melempar error.\n  Sebab: ${msg}\n  Tindakan: Periksa izin host dan pastikan halaman bukan URL internal browser (chrome://).`,
        };
      }
    }

    // 4. Fallback check: if userScripts.execute is missing
    return {
      ok: false,
      error: serializeError(new Error('chrome.userScripts.execute is not supported on this browser version')),
      output: '✖ InjectionPathwayError: chrome.userScripts.execute tidak didukung oleh versi browser ini.\n  Sebab: Fitur injeksi langsung cell memerlukan Chrome/Chromium 138+ dengan API UserScripts Execute.\n  Tindakan: Perbarui browser Chromium Anda ke versi terbaru.',
    };
  }

  async signalCancel(tabId: number, token: string): Promise<void> {
    const userScripts = chrome.userScripts as unknown as {
      execute?: (details: {
        target: { tabId: number };
        world?: string;
        js: Array<{ code: string }>;
      }) => Promise<Array<{ result?: unknown }>>;
    };
    if (!userScripts.execute) {
      throw new Error('chrome.userScripts.execute is not available');
    }
    const tokenJson = JSON.stringify(token);
    await userScripts.execute({
      target: { tabId },
      world: 'MAIN',
      js: [{
        code: `(() => {
          window.__nbCancel = ${tokenJson};
          window.__nbCancelWrittenAt = Date.now();
          if (typeof window.__nbAbortCell === 'function') window.__nbAbortCell();
          return { cancel: window.__nbCancel };
        })();`,
      }],
    });
  }
}

class ChromiumStorage implements StorageArea {
  async get<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      return defaultValue;
    }
    const res = await chrome.storage.local.get(key);
    if (res && Object.prototype.hasOwnProperty.call(res, key)) {
      return res[key] as T;
    }
    return defaultValue;
  }

  async set<T = unknown>(key: string, value: T): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      throw new Error('[platform:FATAL] chrome.storage.local is not available');
    }
    await chrome.storage.local.set({ [key]: value });
  }

  async remove(key: string): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      return;
    }
    await chrome.storage.local.remove(key);
  }

  async clear(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      return;
    }
    await chrome.storage.local.clear();
  }

  async keys(): Promise<string[]> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      return [];
    }
    const all = await chrome.storage.local.get(null);
    return Object.keys(all || {});
  }
}

export class ChromiumPlatformAdapter implements PlatformAdapter {
  readonly target = 'chrome' as const;
  get capabilities(): PlatformCapabilities {
    return {
      hasSidePanel: true,
      hasOffscreenDocument: true,
      hasUserScripts: isUserScriptsAvailable(),
    };
  }
  readonly sidePanel: SidePanelController = new ChromiumSidePanelController();
  readonly backgroundDom: BackgroundDomContext = new ChromiumBackgroundDomContext();
  readonly scriptExecutor: ScriptExecutor = new ChromiumScriptExecutor();
  readonly storage: StorageArea = new ChromiumStorage();

  isUserScriptsAvailable(): boolean {
    return isUserScriptsAvailable();
  }

  connectNative(hostName: string): NativeMessagingPort {
    if (typeof chrome === 'undefined' || !chrome.runtime?.connectNative) {
      throw new NativeConnectionError('chrome.runtime.connectNative tidak tersedia', {
        cause: 'API native messaging tidak ada di konteks ini',
        action: 'Pastikan izin nativeMessaging ada di manifest dan pemanggilan berjalan di service worker',
      });
    }
    try {
      const port = chrome.runtime.connectNative(hostName);
      port.onDisconnect.addListener(() => {
        const last = chrome.runtime.lastError;
        if (last?.message) {
          console.error('[dogear] NativeConnectionError', {
            name: 'NativeConnectionError',
            message: last.message,
            cause: `Koneksi native ke '${hostName}' putus`,
            action: 'Periksa host terdaftar di HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts dan manifest allowed_origins',
          });
        }
      });
      return port;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new NativeConnectionError(msg, {
        cause: `chrome.runtime.connectNative('${hostName}') gagal`,
        action: 'Daftarkan host native com.dogear.host lalu ulangi',
      });
    }
  }

  async getTabHost(tabId: number): Promise<string | undefined> {
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs?.get) {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.url) {
          return new URL(tab.url).host;
        }
      }
    } catch {
      // Tab might be restricted or closed
    }
    return undefined;
  }

  async getActiveTab(): Promise<ActiveTabInfo | undefined> {
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
        const isWebTab = (t?: chrome.tabs.Tab): boolean => {
          if (!t || !t.url) return false;
          return t.url.startsWith('http://') || t.url.startsWith('https://');
        };

        // 1. Try querying active tab in current window
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        let targetTab = tabs.find(isWebTab);

        // 2. If no web tab active in currentWindow (e.g. sidepanel opened in standalone tab/window),
        // query active tabs across all windows
        if (!targetTab) {
          const allActive = await chrome.tabs.query({ active: true });
          targetTab = allActive.find(isWebTab);
        }

        // 3. If still no active web tab, query all tabs and pick most recently accessed web tab
        if (!targetTab) {
          const allTabs = await chrome.tabs.query({});
          const webTabs = allTabs.filter(isWebTab);
          if (webTabs.length > 0) {
            webTabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
            targetTab = webTabs[0];
          }
        }

        if (targetTab) {
          let host: string | undefined;
          if (targetTab.url) {
            try {
              host = new URL(targetTab.url).host;
            } catch {}
          }
          return { id: targetTab.id, host, url: targetTab.url };
        }

        // 4. Fallback if there is an active tab without web URL
        if (tabs.length > 0 && tabs[0]) {
          const tab = tabs[0];
          let host: string | undefined;
          if (tab.url) {
            try {
              host = new URL(tab.url).host;
            } catch {}
          }
          return { id: tab.id, host, url: tab.url };
        }
      }
    } catch {}
    return undefined;
  }

  onActiveTabChanged(callback: (tab: ActiveTabInfo) => void): () => void {
    if (typeof chrome === 'undefined' || !chrome.tabs) {
      return () => {};
    }

    const emitActiveTab = async (tabId?: number) => {
      try {
        if (tabId !== undefined && chrome.tabs?.get) {
          const tab = await chrome.tabs.get(tabId);
          if (tab?.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
            let host: string | undefined;
            try {
              host = new URL(tab.url).host;
            } catch {}
            callback({ id: tab.id, host, url: tab.url });
            return;
          }
        }
        const active = await this.getActiveTab();
        if (active) {
          callback(active);
        }
      } catch {}
    };

    const handleActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
      emitActiveTab(activeInfo.tabId);
    };

    const handleUpdated = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://')) && (changeInfo.url || changeInfo.status === 'complete')) {
        let host: string | undefined;
        try {
          host = new URL(tab.url).host;
        } catch {}
        callback({ id: tab.id, host, url: tab.url });
      }
    };

    chrome.tabs.onActivated?.addListener(handleActivated);
    chrome.tabs.onUpdated?.addListener(handleUpdated);

    return () => {
      chrome.tabs.onActivated?.removeListener(handleActivated);
      chrome.tabs.onUpdated?.removeListener(handleUpdated);
    };
  }

  async captureVisibleTab(windowId?: number): Promise<string | null> {
    if (typeof chrome === 'undefined' || !chrome.tabs?.captureVisibleTab) {
      return null;
    }
    return new Promise((resolve) => {
      try {
        const targetWin = windowId ?? undefined;
        chrome.tabs.captureVisibleTab(
          targetWin as number,
          { format: 'jpeg', quality: 50 },
          (dataUrl) => {
            if (chrome.runtime?.lastError || !dataUrl) {
              resolve(null);
            } else {
              const prefix = 'data:image/jpeg;base64,';
              const base64 = dataUrl.startsWith(prefix) ? dataUrl.slice(prefix.length) : dataUrl;
              resolve(base64);
            }
          }
        );
      } catch {
        resolve(null);
      }
    });
  }

  readonly tabNavigator: TabNavigator = {
    startTracking: (): void => {
      startTabTracking();
    },

    stopTracking: (): void => {
      stopTabTracking();
    },

    waitForNewTab: async (openerTabId: number, sinceMs: number, timeoutMs: number, signal?: AbortSignal): Promise<number | null> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (signal?.aborted) return null;
        for (let i = recentCreatedTabs.length - 1; i >= 0; i--) {
          const entry = recentCreatedTabs[i];
          if (entry.openerTabId === openerTabId && entry.createdAt >= sinceMs - 100) {
            await waitForTabComplete(entry.id, 10000, signal);
            return entry.id;
          }
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      return null;
    },

    openTab: async (url: string, signal?: AbortSignal): Promise<number> => {
      if (typeof chrome === 'undefined' || !chrome.tabs?.create) {
        throw new Error('chrome.tabs.create tidak tersedia');
      }
      // INV-25, RQ-09, K-10: tab baru selalu active: false
      const tab = await chrome.tabs.create({ url, active: false });
      if (tab.id === undefined) {
        throw new Error(`Gagal membuat tab baru (${url}): tab.id tidak ada`);
      }
      await waitForTabComplete(tab.id, 30000, signal, url);
      return tab.id;
    },

    goto: async (tabId: number, url: string, signal?: AbortSignal): Promise<void> => {
      if (typeof chrome === 'undefined' || !chrome.tabs?.update) {
        throw new Error('chrome.tabs.update tidak tersedia');
      }
      let currentTab: chrome.tabs.Tab | undefined;
      try {
        currentTab = await chrome.tabs.get(tabId);
      } catch (getErr: unknown) {
        const msg = getErr instanceof Error ? getErr.message : String(getErr);
        throw new Error(`Gagal memeriksa tab ${tabId} untuk goto(${url}): ${msg}`);
      }
      if (currentTab?.url === url && currentTab?.status === 'complete') {
        return;
      }
      await chrome.tabs.update(tabId, { url });
      await waitForTabComplete(tabId, 10000, signal, url);
    },

    closeTab: async (tabId: number): Promise<void> => {
      if (typeof chrome === 'undefined' || !chrome.tabs?.remove) {
        return;
      }
      await chrome.tabs.remove(tabId);
    },

    isTabAlive: async (tabId: number): Promise<boolean> => {
      if (typeof chrome === 'undefined' || !chrome.tabs?.get) {
        return false;
      }
      try {
        const tab = await chrome.tabs.get(tabId);
        return !!tab;
      } catch (_aliveErr: unknown) {
        void _aliveErr;
        return false;
      }
    },
  };
}

export interface CreatedTabRecord {
  id: number;
  openerTabId?: number;
  createdAt: number;
  windowId?: number;
}

const recentCreatedTabs: CreatedTabRecord[] = [];
let trackingCount = 0;
let tabCreatedListener: ((tab: chrome.tabs.Tab) => void) | null = null;

export function recordTabCreated(record: CreatedTabRecord): void {
  recentCreatedTabs.push(record);
  if (recentCreatedTabs.length > 100) {
    recentCreatedTabs.shift();
  }
}

export function startTabTracking(): void {
  trackingCount++;
  if (trackingCount === 1) {
    if (typeof chrome !== 'undefined' && chrome.tabs?.onCreated) {
      if (!tabCreatedListener) {
        tabCreatedListener = (tab: chrome.tabs.Tab) => {
          if (tab && tab.id !== undefined) {
            recordTabCreated({
              id: tab.id,
              openerTabId: tab.openerTabId,
              createdAt: Date.now(),
              windowId: tab.windowId,
            });
          }
        };
      }
      chrome.tabs.onCreated.addListener(tabCreatedListener);
    }
  }
}

export function stopTabTracking(): void {
  trackingCount = Math.max(0, trackingCount - 1);
  if (trackingCount === 0 && tabCreatedListener) {
    if (typeof chrome !== 'undefined' && chrome.tabs?.onCreated) {
      chrome.tabs.onCreated.removeListener(tabCreatedListener);
    }
  }
}

async function waitForTabComplete(
  tabId: number,
  timeoutMs = 10000,
  signal?: AbortSignal,
  url?: string
): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.get) return;
  let initialTab: chrome.tabs.Tab | undefined;
  try {
    initialTab = await chrome.tabs.get(tabId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Gagal memeriksa status tab ${tabId}${url ? ` (${url})` : ''}: ${msg}`);
  }
  if (initialTab?.status === 'complete') return;

  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let poller: ReturnType<typeof setInterval> | null = null;
    let onUpdated: ((tid: number, change: chrome.tabs.TabChangeInfo) => void) | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (poller) clearInterval(poller);
      if (onUpdated && chrome.tabs?.onUpdated) {
        chrome.tabs.onUpdated.removeListener(onUpdated);
      }
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(new Error(`Pemuatan tab ${tabId}${url ? ` (${url})` : ''} dibatalkan (signal aborted)`));
    };

    onUpdated = (tid: number, change: chrome.tabs.TabChangeInfo) => {
      if (tid === tabId && change.status === 'complete') {
        cleanup();
        resolve();
      }
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    if (chrome.tabs?.onUpdated) {
      chrome.tabs.onUpdated.addListener(onUpdated);
    }

    poller = setInterval(async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.status === 'complete') {
          cleanup();
          resolve();
        }
      } catch (pollErr: unknown) {
        cleanup();
        const msg = pollErr instanceof Error ? pollErr.message : String(pollErr);
        reject(new Error(`Tab ${tabId}${url ? ` (${url})` : ''} hilang saat menunggu selesai muat: ${msg}`));
      }
    }, 100);

    timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Batas waktu ${timeoutMs}ms terlampaui saat memuat tab ${tabId}${
            url ? ` ke ${url}` : ''
          }. Status tab tidak mencapai complete.`
        )
      );
    }, timeoutMs);
  });
}

