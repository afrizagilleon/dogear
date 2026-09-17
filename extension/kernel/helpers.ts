/**
 * extension/kernel/helpers.ts
 * DOM, timing, and formatting helpers available in cell execution realm (D-2, D-3, RQ-02, RQ-03, RQ-06).
 * Preserves names from legacy userscript (INV-7) for notebook compatibility.
 */

/**
 * Injected helper definitions for cell execution realm (D-2, D-3, RQ-02, RQ-03, RQ-06).
 * Single source of truth (F-5 A-2) imported directly by platform script executors.
 */
export const INJECTED_HELPERS_SCRIPT = `
  class AbortError extends Error {
    constructor(msg = 'aborted') {
      super(msg);
      this.name = 'AbortError';
    }
  }

  function __nbDefaultSignal() {
    if (typeof window === 'undefined') return undefined;
    return window.__nbCellAbortCtl ? window.__nbCellAbortCtl.signal : undefined;
  }

  if (typeof window !== 'undefined' && typeof AbortController === 'function') {
    window.__nbCellAbortCtl = new AbortController();
    window.__nbAbortCell = function () {
      const c = window.__nbCellAbortCtl;
      if (c && c.signal && !c.signal.aborted) {
        try { c.abort(); } catch (e) {}
      }
    };
  }

  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    const s = signal || __nbDefaultSignal();
    if (s?.aborted) return reject(new AbortError());
    const t = setTimeout(resolve, ms);
    s?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new AbortError());
    }, { once: true });
  });

  const parkForUnload = (timeout = 30000, signal) => new Promise((_, reject) => {
    const s = signal || __nbDefaultSignal();
    if (s?.aborted) return reject(new AbortError('parkForUnload aborted'));
    let timer;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', onGone);
        window.removeEventListener('beforeunload', onGone);
      }
      s?.removeEventListener('abort', onAbort);
    };
    const onGone = () => {
      cleanup();
      reject(new AbortError('page unloaded during park'));
    };
    const onAbort = () => {
      cleanup();
      reject(new AbortError('parkForUnload aborted by signal'));
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', onGone, { once: true });
      window.addEventListener('beforeunload', onGone, { once: true });
    }
    s?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('parkForUnload: no navigation within ' + timeout + 'ms'));
    }, timeout);
  });

  const $ = (sel, root = (typeof document !== 'undefined' ? document : null)) => {
    if (typeof window !== 'undefined') window.__nb_last_selector = sel;
    const el = root && typeof root.querySelector === 'function' ? root.querySelector(sel) : null;
    if (el && typeof window !== 'undefined') window.__nb_last_element = el;
    return el;
  };

  const $$ = (sel, root = (typeof document !== 'undefined' ? document : null)) => {
    if (typeof window !== 'undefined') window.__nb_last_selector = sel;
    const list = root && typeof root.querySelectorAll === 'function' ? Array.from(root.querySelectorAll(sel)) : [];
    if (list.length > 0 && typeof window !== 'undefined') window.__nb_last_element = list[0];
    return list;
  };

  const waitFor = async (sel, opts = {}) => {
    if (typeof window !== 'undefined') window.__nb_last_selector = sel;
    const { timeout = 5000, interval = 50, root = (typeof document !== 'undefined' ? document : null), signal = __nbDefaultSignal() } = opts;
    const start = Date.now();

    for (;;) {
      if (signal?.aborted) throw new AbortError('waitFor aborted');
      if (root && typeof root.querySelector === 'function') {
        const el = root.querySelector(sel);
        if (el) {
          if (typeof window !== 'undefined') window.__nb_last_element = el;
          return el;
        }
      }
      if (Date.now() - start > timeout) {
        throw new Error('waitFor timeout (' + timeout + 'ms): ' + sel);
      }
      await sleep(interval, signal);
    }
  };

  const pick = async (candidates, opts = {}) => {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new Error('pick: candidates must be a non-empty array of selector strings');
    }
    if (typeof window !== 'undefined') {
      window.__nb_last_candidates = candidates;
      window.__nb_last_selector = candidates[0];
    }
    const {
      timeout = 5000,
      interval = 50,
      root = (typeof document !== 'undefined' ? document : null),
      signal = __nbDefaultSignal(),
    } = opts;

    const start = Date.now();

    const checkCandidates = () => {
      if (!root || typeof root.querySelector !== 'function') return null;
      for (let i = 0; i < candidates.length; i++) {
        const sel = candidates[i];
        const el = root.querySelector(sel);
        if (el) return { el, index: i, sel };
      }
      return null;
    };

    const commitFound = (found) => {
      const { el, index: i, sel } = found;
      if (typeof window !== 'undefined') window.__nb_last_element = el;
      const report = {
        index: i,
        candidateIndex: i + 1,
        candidate: sel,
        candidates: [...candidates],
        elapsedMs: Date.now() - start,
      };
      if (typeof window !== 'undefined') {
        window.__nb_last_pick = report;
        window.__nb_picks = window.__nb_picks || [];
        window.__nb_picks.push(report);
      }
      if (typeof g !== 'undefined' && g) {
        g.__nb_last_pick = report;
        g.__nb_picks = g.__nb_picks || [];
        g.__nb_picks.push(report);
      }
      if (typeof ctx !== 'undefined' && ctx) {
        ctx.__nb_last_pick = report;
        ctx.__nb_picks = ctx.__nb_picks || [];
        ctx.__nb_picks.push(report);
      }
      if (i > 0 && typeof print === 'function') {
        print('[WARNING] Selector shift: matched candidate ' + (i + 1) + ' of ' + candidates.length + ' ("' + sel + '")');
      }
      return el;
    };

    const initial = checkCandidates();
    if (initial) return commitFound(initial);

    for (;;) {
      if (signal?.aborted) throw new AbortError('pick aborted');
      const found = checkCandidates();
      if (found) return commitFound(found);

      if (Date.now() - start >= timeout) {
        const candidateListStr = candidates.map((c) => '"' + c + '"').join(', ');
        const err = new Error(
          'pick: Tidak ada elemen yang cocok untuk seluruh kandidat selector: ' + candidateListStr + ' (timeout ' + timeout + 'ms)'
        );
        err.name = 'SelectorPickError';
        err.cause = 'Seluruh ' + candidates.length + ' kandidat selector (' + candidateListStr + ') gagal ditemukan di DOM halaman setelah menunggu ' + timeout + 'ms.';
        err.action = 'Periksa apakah struktur DOM situs web telah berubah, atau perbarui daftar kandidat selector pada step.';
        err.candidates = candidates;
        throw err;
      }

      await sleep(interval, signal);
    }
  };

  class ClickBlockedError extends Error {
    constructor(msg, cause, action, blockedBy) {
      super(msg);
      this.name = 'ClickBlockedError';
      if (cause) this.cause = cause;
      if (action) this.action = action;
      if (blockedBy) this.blockedBy = blockedBy;
    }
  }

  async function resolveTarget(target, opts = {}) {
    if (typeof target === 'string') {
      if (typeof window !== 'undefined') window.__nb_last_selector = target;
      return await waitFor(target, opts);
    }
    if (Array.isArray(target)) {
      return await pick(target, opts);
    }
    if (target && typeof target === 'object' && typeof target.nodeType === 'number') {
      if (typeof window !== 'undefined') window.__nb_last_element = target;
      return target;
    }
    throw new Error('Target harus berupa elemen DOM, string selector, atau array kandidat selector');
  };

  const click = async (target, opts = {}) => {
    const el = await resolveTarget(target, opts);
    if (!el || typeof el !== 'object' || el.nodeType !== 1) {
      throw new Error('click: Target tidak valid atau bukan Element');
    }

    if (el.tagName === 'IFRAME' || (typeof document !== 'undefined' && el.ownerDocument !== document)) {
      throw new ClickBlockedError(
        'click: Sasaran berada di dalam <iframe> atau merupakan <iframe> dan tidak dapat diklik tembus dari dokumen induk',
        'Elemen sasaran berada di dalam atau merupakan sebuah <iframe>. Event klik sintetis pada elemen iframe tidak menembus atau mengirim event ke dokumen induk.',
        'Targetkan elemen pada dokumen utama, atau gunakan konteks eksekusi frame yang bersangkutan.',
        el
      );
    }

    if (typeof el.scrollIntoView === 'function') {
      try {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      } catch {}
    }

    const rect = el.getBoundingClientRect();
    const cx = rect.left + (rect.width > 0 ? rect.width / 2 : 0);
    const cy = rect.top + (rect.height > 0 ? rect.height / 2 : 0);

    const topEl = typeof document !== 'undefined' && typeof document.elementFromPoint === 'function'
      ? document.elementFromPoint(cx, cy)
      : el;

    if (!topEl) {
      throw new ClickBlockedError(
        'click: Elemen berada di luar viewport setelah scroll',
        'Pemeriksaan elementFromPoint(' + Math.round(cx) + ', ' + Math.round(cy) + ') mengembalikan null.',
        'Pastikan elemen berada di dalam viewport layar dan dapat di-scroll.',
        null
      );
    }

    if (topEl !== el && !el.contains(topEl)) {
      const tag = topEl.tagName ? topEl.tagName.toLowerCase() : 'unknown';
      const id = topEl.id ? '#' + topEl.id : '';
      const cls = topEl.className && typeof topEl.className === 'string'
        ? '.' + topEl.className.trim().split(' ').filter(Boolean).join('.')
        : '';
      const blockerDesc = '<' + tag + id + cls + '>';

      throw new ClickBlockedError(
        'click: Elemen terhalang oleh ' + blockerDesc,
        'Pemeriksaan elementFromPoint(' + Math.round(cx) + ', ' + Math.round(cy) + ') menemukan elemen penghalang: ' + blockerDesc + '.',
        'Tutup atau sembunyikan lapisan overlay penghalang sebelum melakukan klik, atau targetkan elemen overlay tersebut jika itu yang dimaksud.',
        topEl
      );
    }

    const eventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: typeof window !== 'undefined' ? window : null,
      clientX: cx,
      clientY: cy,
      screenX: cx,
      screenY: cy,
      button: 0,
      buttons: 1,
    };

    el.dispatchEvent(new PointerEvent('pointerdown', eventInit));
    el.dispatchEvent(new MouseEvent('mousedown', eventInit));

    if (typeof el.focus === 'function') {
      try { el.focus(); } catch {}
    }

    const upInit = { ...eventInit, buttons: 0 };
    el.dispatchEvent(new PointerEvent('pointerup', upInit));
    el.dispatchEvent(new MouseEvent('mouseup', upInit));
    const notCanceled = el.dispatchEvent(new MouseEvent('click', upInit));

    const anchor = (el.tagName === 'A' ? el : (typeof el.closest === 'function' ? el.closest('a') : null));
    if (notCanceled && anchor && typeof anchor.click === 'function') {
      try {
        anchor.click();
      } catch {}
    }

    return el;
  };

  class FillVerifyError extends Error {
    constructor(msg, cause, action, expected, actual) {
      super(msg);
      this.name = 'FillVerifyError';
      if (cause) this.cause = cause;
      if (action) this.action = action;
      if (expected !== undefined) this.expected = expected;
      if (actual !== undefined) this.actual = actual;
    }
  }

  class FillStrategyError extends Error {
    constructor(msg, cause, action, strategy) {
      super(msg);
      this.name = 'FillStrategyError';
      if (cause) this.cause = cause;
      if (action) this.action = action;
      if (strategy !== undefined) this.strategy = strategy;
    }
  }

  class NotEditableError extends Error {
    constructor(msg, cause, action) {
      super(msg);
      this.name = 'NotEditableError';
      if (cause) this.cause = cause;
      if (action) this.action = action;
    }
  }

  const fill = async (target, text, opts = {}) => {
    const el = await resolveTarget(target, opts);
    if (!el || typeof el !== 'object' || el.nodeType !== 1) {
      throw new Error('fill: Target tidak valid atau bukan Element');
    }

    const tag = el.tagName ? el.tagName.toLowerCase() : 'unknown';
    const isInput = tag === 'input';
    const isTextarea = tag === 'textarea';
    const isCE = !!el.isContentEditable || el.getAttribute?.('contenteditable') === 'true';

    if (isInput) {
      const type = (el.type || 'text').toLowerCase();
      const nonTextTypes = ['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'file', 'hidden'];
      if (nonTextTypes.includes(type)) {
        throw new NotEditableError(
          'fill: Elemen <input type="' + type + '"> tidak mendukung pengisian teks',
          'Elemen input bertipe "' + type + '" bukan input teks yang dapat diisi nilai string.',
          'Gunakan helper click() untuk tombol/checkbox/radio, atau targetkan input teks yang sesuai.'
        );
      }
    } else if (!isTextarea && !isCE) {
      throw new NotEditableError(
        'fill: Elemen bukan input teks, textarea, atau contenteditable',
        'Elemen <' + tag + '> tidak dapat diedit atau tidak memiliki atribut contenteditable="true".',
        'Pastikan target mengarah ke elemen input, textarea, atau editor yang mendukung pengisian teks.'
      );
    }

    if (typeof el.scrollIntoView === 'function') {
      try {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      } catch {}
    }

    if (typeof el.focus === 'function') {
      try { el.focus(); } catch {}
    }

    const valStr = String(text ?? '');

    if (isInput || isTextarea) {
      // Rasional Rekayasa (A1-T4, D-1):
      // Strategi b (Native property descriptor setter + input event dispatch) dipilih melalui
      // penalaran rekayasa yang disengaja untuk menjamin kompatibilitas pelacak nilai React
      // di dunia nyata, sebagai superset yang menembus setter lokal tanpa merusak komponen terkendali
      // (meskipun matriks empiris tidak membedakan a dari b karena Preact tidak memiliki value tracker).
      const proto = isTextarea
        ? (typeof HTMLTextAreaElement !== 'undefined' ? HTMLTextAreaElement.prototype : Object.getPrototypeOf(el))
        : (typeof HTMLInputElement !== 'undefined' ? HTMLInputElement.prototype : Object.getPrototypeOf(el));
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) {
        desc.set.call(el, valStr);
      } else {
        el.value = valStr;
      }
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // Berdasarkan Matriks T-01 baris 3, 4 (Plain ContentEditable, CodeMirror 6) & A1-T3:
      // Strategi c (focus + selection + beforeinput check + execCommand('insertText')) menyisipkan teks
      // dan memicu transaksi dokumen internal editor modern tanpa merusak buffer kursor.
      // Jika execCommand mengembalikan false atau dibatalkan oleh beforeinput, dilempar FillStrategyError.
      let inserted = false;
      if (typeof window !== 'undefined' && window.getSelection && typeof document !== 'undefined') {
        try {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          sel.removeAllRanges();
          sel.addRange(range);

          let allowed = true;
          if (typeof InputEvent === 'function') {
            const beforeInputEvt = new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: valStr,
              composed: true,
            });
            allowed = el.dispatchEvent(beforeInputEvt);
          }

          if (allowed && typeof document.execCommand === 'function') {
            inserted = document.execCommand('insertText', false, valStr);
          }
        } catch {}
      }
      if (!inserted) {
        throw new FillStrategyError(
          'fill: Strategi execCommand("insertText") ditolak atau gagal pada elemen contenteditable',
          'Event beforeinput dibatalkan (preventDefault) atau perintah execCommand("insertText") mengembalikan false.',
          'Periksa apakah target contenteditable menerapkan pencegahan input atau memerlukan interaksi khusus. Dilarang menulis langsung ke textContent untuk menghindari manipulasi DOM sunyi di luar state editor.',
          'execCommand("insertText")'
        );
      }
    }

    // Tunggu satu putaran render
    await new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => setTimeout(resolve, 50));
      } else {
        setTimeout(resolve, 50);
      }
    });

    let actual;
    if (isInput || isTextarea) {
      actual = el.value;
    } else {
      const raw = el.innerText !== undefined ? el.innerText : el.textContent;
      actual = (raw || '').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)).trim();
    }

    const expected = (isInput || isTextarea) ? valStr : valStr.trim();
    if (actual !== expected) {
      throw new FillVerifyError(
        'fill: Verifikasi isian gagal, nilai pasca-render tidak sesuai',
        'Nilai yang diminta "' + valStr + '" tidak cocok dengan nilai yang terbaca "' + actual + '".',
        'Periksa apakah halaman memiliki event handler yang mengubah atau menolak isian (input filter/reverter).',
        valStr,
        actual
      );
    }

    return el;
  };

  function parsePressKey(keySpec, opts) {
    const mods = {
      ctrl: !!(opts && opts.ctrl),
      shift: !!(opts && opts.shift),
      alt: !!(opts && opts.alt),
      meta: !!(opts && opts.meta),
    };
    const parts = String(keySpec || '').split('+');
    let key = parts.length ? parts[parts.length - 1] : '';
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i].toLowerCase();
      if (p === 'ctrl' || p === 'control') mods.ctrl = true;
      else if (p === 'shift') mods.shift = true;
      else if (p === 'alt') mods.alt = true;
      else if (p === 'meta' || p === 'cmd' || p === 'win') mods.meta = true;
    }
    if (key === 'Esc') key = 'Escape';
    if (key === 'Up') key = 'ArrowUp';
    if (key === 'Down') key = 'ArrowDown';
    if (key === 'Left') key = 'ArrowLeft';
    if (key === 'Right') key = 'ArrowRight';
    let code = opts && opts.code;
    if (!code) {
      if (key.length === 1 && /[a-zA-Z]/.test(key)) code = 'Key' + key.toUpperCase();
      else if (key.length === 1 && /[0-9]/.test(key)) code = 'Digit' + key;
      else code = key;
    }
    return { key, code, mods };
  }

  const press = async (target, key, opts = {}) => {
    const el = await resolveTarget(target, opts);
    if (!el || typeof el !== 'object' || el.nodeType !== 1) {
      throw new Error('press: Target tidak valid atau bukan Element');
    }
    if (typeof el.focus === 'function') {
      try { el.focus(); } catch (e) {}
    }
    const parsed = parsePressKey(key, opts);
    const init = {
      key: parsed.key,
      code: parsed.code,
      bubbles: true,
      cancelable: true,
      composed: true,
      ctrlKey: parsed.mods.ctrl,
      shiftKey: parsed.mods.shift,
      altKey: parsed.mods.alt,
      metaKey: parsed.mods.meta,
    };
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
    return el;
  };

  function __nbAssertTabAllowed(name) {
    if (typeof __nb_allow_tab_requests !== 'undefined' && !__nb_allow_tab_requests) {
      throw new Error("Helper tab '" + name + "' hanya berlaku pada run notebook melalui jembatan native, tidak dapat digunakan di panel.");
    }
  }

  function __nbRecordTabRequest(req) {
    __nbAssertTabAllowed(req.type);
    const existing = (typeof window !== 'undefined' && window.__nb_tab_request)
      || (typeof ctx !== 'undefined' && ctx && ctx.__nb_tab_request)
      || (typeof globalThis !== 'undefined' && globalThis.__nb_tab_request);
    if (existing) {
      throw new Error('Dua permintaan tab dalam satu langkah: ' + existing.type + ' sudah terdaftar sebelum ' + req.type);
    }
    if (typeof window !== 'undefined') window.__nb_tab_request = req;
    if (typeof globalThis !== 'undefined') globalThis.__nb_tab_request = req;
    if (typeof ctx !== 'undefined' && ctx) ctx.__nb_tab_request = req;
  }

  const useNewTab = (opts) => {
    __nbAssertTabAllowed('useNewTab');
    const timeout = (opts && typeof opts.timeout === 'number') ? opts.timeout : 10000;
    __nbRecordTabRequest({ type: 'useNewTab', timeout });
  };

  const openTab = (url) => {
    __nbAssertTabAllowed('openTab');
    if (!url || typeof url !== 'string') {
      throw new Error('openTab: parameter url harus berupa string');
    }
    __nbRecordTabRequest({ type: 'openTab', url });
  };

  const goto = (url) => {
    __nbAssertTabAllowed('goto');
    if (!url || typeof url !== 'string') {
      throw new Error('goto: parameter url harus berupa string');
    }
    __nbRecordTabRequest({ type: 'goto', url });
  };

  const backToOpener = (opts) => {
    __nbAssertTabAllowed('backToOpener');
    const close = !!(opts && opts.close);
    __nbRecordTabRequest({ type: 'backToOpener', close });
  };

  // CATATAN ARSITEKTURAL (M17 T-04 / M18 T-06):
  // type (menyisipkan teks per-tombol) tetap dilepas. press dihidupkan kembali untuk memicu
  // listener JavaScript milik halaman. Event sintetis selalu isTrusted:false.
`;

export class AbortError extends Error {
  constructor(msg = 'aborted') {
    super(msg);
    this.name = 'AbortError';
  }
}

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new AbortError());
      },
      { once: true }
    );
  });

/**
 * Park until the page navigates away — used by auto navigation steps after committing
 * checkpoint and triggering navigation.
 * It NEVER resolves (D-2, INV-7): reaching the next step would mean running it
 * against a document that is being torn down, and (worse) checkpointing on the wrong page.
 * Unload (pagehide, beforeunload) or stop signal -> rejects with AbortError.
 * Watchdog timeout -> rejects with Error(`parkForUnload: no navigation within ${timeout}ms`).
 */
export function parkForUnload(timeout = 30000, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((_, reject) => {
    if (signal?.aborted) return reject(new AbortError('parkForUnload aborted'));
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', onGone);
        window.removeEventListener('beforeunload', onGone);
      }
      signal?.removeEventListener('abort', onAbort);
    };

    const onGone = () => {
      cleanup();
      reject(new AbortError('page unloaded during park'));
    };

    const onAbort = () => {
      cleanup();
      reject(new AbortError('parkForUnload aborted by signal'));
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', onGone, { once: true });
      window.addEventListener('beforeunload', onGone, { once: true });
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`parkForUnload: no navigation within ${timeout}ms`));
    }, timeout);
  });
}

export const $ = (sel: string, root: ParentNode = (typeof document !== 'undefined' ? document : ({} as ParentNode))): Element | null => {
  if (!root || typeof root.querySelector !== 'function') return null;
  return root.querySelector(sel);
};

export const $$ = (sel: string, root: ParentNode = (typeof document !== 'undefined' ? document : ({} as ParentNode))): Element[] => {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  return Array.from(root.querySelectorAll(sel));
};

export interface WaitForOptions {
  timeout?: number;
  interval?: number;
  root?: ParentNode;
  signal?: AbortSignal;
}

export async function waitFor<T extends Element = Element>(
  sel: string,
  opts: WaitForOptions = {}
): Promise<T> {
  const {
    timeout = 5000,
    interval = 50,
    root = (typeof document !== 'undefined' ? document : ({} as ParentNode)),
    signal,
  } = opts;

  const start = Date.now();

  for (;;) {
    if (signal?.aborted) {
      throw new AbortError('waitFor aborted');
    }
    if (root && typeof root.querySelector === 'function') {
      const el = root.querySelector(sel) as T | null;
      if (el) return el;
    }
    if (Date.now() - start > timeout) {
      throw new Error(`waitFor timeout (${timeout}ms): ${sel}`);
    }
    await sleep(interval, signal);
  }
}

export function fmt(v: unknown): string {
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (v === null) return 'null';
  if (typeof Element !== 'undefined' && v instanceof Element) {
    return `<${v.tagName.toLowerCase()}> ${v.className || ''}`.trim();
  }
  if (typeof Node !== 'undefined' && v instanceof Node) {
    return `[${v.nodeName}]`;
  }
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

// pick() lives exclusively in INJECTED_HELPERS_SCRIPT as the single canonical definition (INV-7, M-SEL A-1).
// Unit tests that verify pick behaviour are in scripts/test-kernel-browser.mjs Tests 35-38.

export interface HelperDoc {
  name: string;
  signature: string;
  description: string;
  example: string;
}

export const RUNTIME_HELPERS: readonly HelperDoc[] = [
  {
    name: '$',
    signature: '$(selector, root?): Element | null',
    description: 'Mencari satu elemen yang cocok dengan selector di DOM.',
    example: `$('#submit')`,
  },
  {
    name: '$$',
    signature: '$$(selector, root?): Element[]',
    description: 'Mencari semua elemen yang cocok dengan selector sebagai array.',
    example: `$$('a.item')`,
  },
  {
    name: 'waitFor',
    signature: 'waitFor(selector, opts?): Promise<Element>',
    description: 'Menunggu hingga elemen muncul di DOM sebelum timeout.',
    example: `await waitFor('#app')`,
  },
  {
    name: 'pick',
    signature: 'pick(candidates, opts?): Promise<Element>',
    description: 'Memilih kandidat selector pertama yang cocok di halaman.',
    example: `await pick(['#ok', '.btn'])`,
  },
  {
    name: 'sleep',
    signature: 'sleep(ms, signal?): Promise<void>',
    description: 'Menjeda eksekusi selama sejumlah milidetik. Stop pada panel membatalkan sleep yang sedang berjalan. Sel while (true) {} tanpa await tidak bisa disela.',
    example: `await sleep(1000)`,
  },
  {
    name: 'click',
    signature: 'click(target, opts?): Promise<Element>',
    description: 'Mengklik elemen setelah memeriksa keterhalangan overlay dan menggulir ke tampilan.',
    example: `await click('#submit')`,
  },
  {
    name: 'fill',
    signature: 'fill(target, text, opts?): Promise<Element>',
    description: 'Mengisi teks ke elemen target dan memverifikasi nilainya pasca-render.',
    example: `await fill('#judul', 'Halo')`,
  },
  {
    name: 'parkForUnload',
    signature: 'parkForUnload(timeout?, signal?): Promise<void>',
    description: 'Menunggu hingga navigasi halaman terjadi setelah checkpoint commit.',
    example: `await parkForUnload()`,
  },
  {
    name: 'auto',
    signature: 'auto: { armed, next(target), stop() }',
    description: 'Mengelola navigasi checkpoint dan otomasi step berlanjut.',
    example: `await auto.next('/next')`,
  },
  {
    name: 'ctx',
    signature: 'ctx: { data: Record<string, unknown> }',
    description: 'Wadah data persisten yang dibagi antar-step dalam notebook.',
    example: `ctx.data.n = 1`,
  },
  {
    name: 'print',
    signature: 'print(...args: any[]): void',
    description: 'Mencetak data atau teks ke riwayat keluaran step.',
    example: `print('halo')`,
  },
  {
    name: 'gmFetch',
    signature: 'gmFetch(url, options?): Promise<any>',
    description: 'Melakukan HTTP fetch lintas-domain melalui background worker.',
    example: `await gmFetch('https://example.com')`,
  },
  {
    name: 'press',
    signature: 'press(target, key, opts?): Promise<Element>',
    description: 'Mengirim keydown/keyup ke listener JavaScript milik halaman, bukan perilaku bawaan browser. Event sintetis selalu isTrusted:false — Ctrl+C tidak menyalin ke papan klip, Tab tidak memindahkan fokus.',
    example: `await press('#q', 'Enter')`,
  },
  {
    name: 'useNewTab',
    signature: 'useNewTab(opts?): Promise<void> | void',
    description: 'Menunggu tab baru yang dibuka pada langkah ini dan mengalihkan langkah berikutnya ke sana.',
    example: `await useNewTab({ timeout: 10000 })`,
  },
  {
    name: 'openTab',
    signature: 'openTab(url): Promise<void> | void',
    description: 'Membuka tab baru di latar belakang dan melanjutkan langkah berikutnya di tab tersebut.',
    example: `openTab('https://example.com')`,
  },
  {
    name: 'goto',
    signature: 'goto(url): Promise<void> | void',
    description: 'Menavigasikan tab saat ini ke URL baru di batas langkah.',
    example: `goto('https://example.com/login')`,
  },
  {
    name: 'backToOpener',
    signature: 'backToOpener(opts?): Promise<void> | void',
    description: 'Kembali ke tab pembuka sebelumnya dalam tumpukan tab run ini.',
    example: `backToOpener({ close: true })`,
  },
];

export function recordTabRequestInGlobal(target: Record<string, unknown>, req: { type: string; [key: string]: unknown }): void {
  const g = (typeof window !== 'undefined' ? window : globalThis) as unknown as Record<string, unknown>;
  if (g.__nb_allow_tab_requests === false) {
    throw new Error(`Helper tab '${req.type}' hanya berlaku pada run notebook melalui jembatan native, tidak dapat digunakan di panel.`);
  }
  const existing = (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__nb_tab_request)
    || (target && target.__nb_tab_request)
    || (typeof globalThis !== 'undefined' && (globalThis as unknown as Record<string, unknown>).__nb_tab_request);
  if (existing) {
    const exType = (existing as { type: string }).type;
    throw new Error(`Dua permintaan tab dalam satu langkah: ${exType} sudah terdaftar sebelum ${req.type}`);
  }
  if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__nb_tab_request = req;
  if (typeof globalThis !== 'undefined') (globalThis as unknown as Record<string, unknown>).__nb_tab_request = req;
  if (target) target.__nb_tab_request = req;
}

export function useNewTab(opts?: { timeout?: number }): void {
  const g = (typeof window !== 'undefined' ? window : globalThis) as unknown as Record<string, unknown>;
  if (g.__nb_allow_tab_requests === false) {
    throw new Error("Helper tab 'useNewTab' hanya berlaku pada run notebook melalui jembatan native, tidak dapat digunakan di panel.");
  }
  const timeout = (opts && typeof opts.timeout === 'number') ? opts.timeout : 10000;
  recordTabRequestInGlobal(g, { type: 'useNewTab', timeout });
}

export function openTab(url: string): void {
  const g = (typeof window !== 'undefined' ? window : globalThis) as unknown as Record<string, unknown>;
  if (g.__nb_allow_tab_requests === false) {
    throw new Error("Helper tab 'openTab' hanya berlaku pada run notebook melalui jembatan native, tidak dapat digunakan di panel.");
  }
  if (!url || typeof url !== 'string') {
    throw new Error('openTab: parameter url harus berupa string');
  }
  recordTabRequestInGlobal(g, { type: 'openTab', url });
}

export function goto(url: string): void {
  const g = (typeof window !== 'undefined' ? window : globalThis) as unknown as Record<string, unknown>;
  if (g.__nb_allow_tab_requests === false) {
    throw new Error("Helper tab 'goto' hanya berlaku pada run notebook melalui jembatan native, tidak dapat digunakan di panel.");
  }
  if (!url || typeof url !== 'string') {
    throw new Error('goto: parameter url harus berupa string');
  }
  recordTabRequestInGlobal(g, { type: 'goto', url });
}

export function backToOpener(opts?: { close?: boolean }): void {
  const g = (typeof window !== 'undefined' ? window : globalThis) as unknown as Record<string, unknown>;
  if (g.__nb_allow_tab_requests === false) {
    throw new Error("Helper tab 'backToOpener' hanya berlaku pada run notebook melalui jembatan native, tidak dapat digunakan di panel.");
  }
  const close = !!(opts && opts.close);
  recordTabRequestInGlobal(g, { type: 'backToOpener', close });
}
