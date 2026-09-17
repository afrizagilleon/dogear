import { getComposerRuntimeSource, type PluralSelector, type SelectorCandidate } from '../kernel/selectors';
import { generateTokenCssVars } from './tokens';

export const PICKER_ROOT_ID = 'nb-picker-root';
export const PICKER_STYLE_ID = 'nb-picker-style';
export const PICKER_HIGHLIGHT_ID = 'nb-picker-highlight';

function appendCandidateRow(
  parent: HTMLElement,
  opts: {
    indexText: string;
    selectorText: string;
    matchCount?: number;
    fragile?: boolean;
    testid?: string;
    rank?: number;
    kind?: string;
    countTestid?: string;
  }
): HTMLElement {
  const item = document.createElement('div');
  item.className = 'nb-cand';
  if (opts.testid) item.setAttribute('data-testid', opts.testid);
  if (opts.rank !== undefined) item.setAttribute('data-rank', String(opts.rank));
  if (opts.kind) item.setAttribute('data-kind', opts.kind);
  if (opts.matchCount !== undefined) {
    item.setAttribute('data-match-count', String(opts.matchCount));
    if (opts.matchCount > 1) {
      item.setAttribute('data-match-warning', 'true');
      item.classList.add('nb-cand--multi');
    }
  }
  if (opts.fragile) {
    item.setAttribute('data-fragile', 'true');
    item.classList.add('nb-cand--fragile');
  }

  const indexEl = document.createElement('span');
  indexEl.className = 'nb-cand-index';
  indexEl.textContent = opts.indexText;
  item.appendChild(indexEl);

  const selectorEl = document.createElement('code');
  selectorEl.className = 'nb-cand-selector';
  selectorEl.setAttribute('data-testid', 'nb-picker-selector');
  selectorEl.appendChild(document.createTextNode(opts.selectorText));
  if (opts.fragile) {
    const tag = document.createElement('span');
    tag.className = 'nb-cand-fragile';
    tag.textContent = 'rapuh';
    selectorEl.appendChild(tag);
  }
  item.appendChild(selectorEl);

  if (opts.matchCount !== undefined) {
    const countEl = document.createElement('span');
    countEl.className = opts.matchCount > 1 ? 'nb-cand-count nb-cand-count--multi' : 'nb-cand-count';
    if (opts.countTestid) countEl.setAttribute('data-testid', opts.countTestid);
    countEl.textContent = `${opts.matchCount} cocok`;
    item.appendChild(countEl);
  }

  parent.appendChild(item);
  return item;
}

export function renderCandidateList(
  container: HTMLElement,
  candidates: SelectorCandidate[],
  plurals: PluralSelector[] = [],
  onPluralClick?: (call: string) => void
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'nb-cand-wrap';

  const list = document.createElement('div');
  list.className = 'nb-cand-list';
  list.setAttribute('data-testid', 'nb-picker-candidates');
  candidates.forEach((candidate, index) => {
    appendCandidateRow(list, {
      indexText: String(index + 1),
      selectorText: candidate.selector,
      matchCount: candidate.matchCount,
      fragile: candidate.fragile,
      testid: 'nb-picker-candidate',
      rank: candidate.rank,
      kind: candidate.kind,
      countTestid: 'nb-picker-match-count',
    });
  });
  wrap.appendChild(list);

  if (plurals.length > 0) {
    const section = document.createElement('div');
    section.className = 'nb-cand-plurals';
    section.setAttribute('data-testid', 'nb-picker-plurals');
    const title = document.createElement('div');
    title.className = 'nb-cand-plurals-title';
    title.textContent = 'semua yang sejenis \u2014 untuk mengambil daftar';
    section.appendChild(title);
    for (const plural of plurals) {
      const row = appendCandidateRow(section, {
        indexText: '\u2022',
        selectorText: plural.call,
        matchCount: plural.matchCount,
        testid: 'nb-picker-plural',
        countTestid: 'nb-picker-plural-count',
      });
      row.setAttribute('data-form', plural.form);
      row.classList.add('nb-cand--plural');
      const countEl = row.querySelector('.nb-cand-count');
      if (countEl) {
        countEl.classList.remove('nb-cand-count--multi');
        countEl.classList.add('nb-cand-count--list');
      }
      if (onPluralClick) {
        row.addEventListener('click', () => onPluralClick(plural.call));
      }
    }
    wrap.appendChild(section);
  }

  container.replaceChildren(wrap);
  return wrap;
}

function buildPickerRuntime(
  tokenCss: string,
  compose: (el: Element, root?: ParentNode, options?: { limit?: number }) => Array<Record<string, unknown>>
): Promise<Record<string, unknown>> {
  const ROOT_ID = 'nb-picker-root';
  const STYLE_ID = 'nb-picker-style';
  const HIGHLIGHT_ID = 'nb-picker-highlight';
  const HIT_ID = 'nb-picker-hit';

  function cleanup() {
    const root = document.getElementById(ROOT_ID);
    if (root) root.remove();
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();
  }

  function isOverlayNode(node: EventTarget | null): boolean {
    if (!(node instanceof Element)) return false;
    return !!(node.closest('#' + ROOT_ID) || node.id === STYLE_ID);
  }

  function resolveTarget(x: number, y: number): Element | null {
    const stack = document.elementsFromPoint(x, y);
    for (let i = 0; i < stack.length; i++) {
      const node = stack[i];
      if (isOverlayNode(node)) continue;
      if (node.id === 'nb-steprunner-hud-root' || node.closest('#nb-steprunner-hud-root')) continue;
      if (node === document.documentElement || node === document.body) continue;
      return node;
    }
    return null;
  }

  cleanup();
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = tokenCss +
    '#' + ROOT_ID + '{position:fixed;inset:0;pointer-events:none;z-index:2147483642;}' +
    '#' + HIT_ID + '{position:fixed;inset:0;pointer-events:auto;}' +
    '#' + HIGHLIGHT_ID + '{position:fixed;pointer-events:none;border:2px solid var(--nb-color-accent);background:transparent;box-sizing:border-box;z-index:1;}';
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.setAttribute('data-testid', 'nb-picker-overlay');
  const hit = document.createElement('div');
  hit.id = HIT_ID;
  hit.setAttribute('data-testid', 'nb-picker-hit');
  const highlight = document.createElement('div');
  highlight.id = HIGHLIGHT_ID;
  highlight.setAttribute('data-testid', 'nb-picker-highlight');
  root.appendChild(hit);
  root.appendChild(highlight);
  document.body.appendChild(root);

  return new Promise((resolve) => {
    let settled = false;

    const origPush = history.pushState;
    const origReplace = history.replaceState;

    function finish(payload: Record<string, unknown>) {
      if (settled) return;
      settled = true;
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pagehide', onGone);
      window.removeEventListener('beforeunload', onGone);
      window.removeEventListener('popstate', onGone);
      history.pushState = origPush;
      history.replaceState = origReplace;
      cleanup();
      resolve(payload);
    }

    function paint(el: Element | null) {
      if (!el) {
        highlight.style.width = '0';
        highlight.style.height = '0';
        return;
      }
      const rect = el.getBoundingClientRect();
      highlight.style.top = rect.top + 'px';
      highlight.style.left = rect.left + 'px';
      highlight.style.width = rect.width + 'px';
      highlight.style.height = rect.height + 'px';
    }

    function onMove(event: MouseEvent) {
      paint(resolveTarget(event.clientX, event.clientY));
    }

    function onClick(event: MouseEvent) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const fromPoint = resolveTarget(event.clientX, event.clientY);
      const fromTarget = event.target instanceof Element ? event.target : null;
      const el = fromPoint || (fromTarget && !isOverlayNode(fromTarget) ? fromTarget : null);
      if (!el) {
        finish({ cancelled: true, reason: 'empty' });
        return;
      }
      if (!el.shadowRoot && el.childNodes.length === 0 && el.tagName.indexOf('-') !== -1) {
        finish({
          cancelled: false,
          unreachable: {
            reason: 'closed-shadow',
            message: 'Elemen berada di dalam shadow root tertutup. Pemilih tidak menembusnya dan tidak mengarang selector.',
            host: el.tagName.toLowerCase(),
          },
          candidates: [],
          pickCall: '',
        });
        return;
      }
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
        finish({
          cancelled: false,
          unreachable: {
            reason: 'iframe',
            message: 'Elemen berada di dalam iframe. Pemilih tidak menjangkaunya dan tidak mengarang selector.',
            host: el.id ? '#' + el.id : el.tagName.toLowerCase(),
          },
          candidates: [],
          pickCall: '',
        });
        return;
      }
      const rootNode = el.getRootNode();
      if (rootNode instanceof ShadowRoot) {
        const host = rootNode.host;
        finish({
          cancelled: false,
          unreachable: {
            reason: 'closed-shadow',
            message: 'Elemen berada di dalam shadow root. Pemilih tidak menembusnya dan tidak mengarang selector.',
            host: host instanceof Element ? (host.id ? '#' + host.id : host.tagName.toLowerCase()) : 'host',
            mode: rootNode.mode,
          },
          candidates: [],
          pickCall: '',
        });
        return;
      }
      const candidates = compose(el, document);
      const selectors = candidates.map((c) => c.selector);
      let plurals: unknown[] = [];
      for (let i = 0; i < candidates.length; i++) {
        const extra = candidates[i].plurals;
        if (candidates[i].kind === 'structural' && Array.isArray(extra)) {
          plurals = extra;
          break;
        }
      }
      finish({
        cancelled: false,
        tagName: el.tagName.toLowerCase(),
        id: el.id || '',
        candidates,
        plurals,
        pickCall: '(await pick(' + JSON.stringify(selectors) + '))',
      });
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish({ cancelled: true, reason: 'escape' });
      }
    }

    function onGone() {
      finish({ cancelled: true, reason: 'navigation' });
    }

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('pagehide', onGone);
    window.addEventListener('beforeunload', onGone);
    window.addEventListener('popstate', onGone);
    history.pushState = function () {
      const ret = origPush.apply(history, arguments as unknown as Parameters<History['pushState']>);
      onGone();
      return ret;
    };
    history.replaceState = function () {
      const ret = origReplace.apply(history, arguments as unknown as Parameters<History['replaceState']>);
      onGone();
      return ret;
    };
  });
}

export function getPickerCellSource(): string {
  return `return (${buildPickerRuntime.toString()})(${JSON.stringify(generateTokenCssVars())}, ${getComposerRuntimeSource()});`;
}

function buildSearchRuntime(
  query: string,
  compose: (el: Element, root?: ParentNode, options?: { limit?: number }) => Array<Record<string, unknown>>
): Record<string, unknown> {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) {
    return { empty: true, message: 'Teks pencarian kosong. Ketik teks tampak, aria-label, atau placeholder.' };
  }
  const hits: Element[] = [];
  const all = document.querySelectorAll('body *');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (el.id === 'nb-picker-root' || el.id === 'nb-steprunner-hud-root') continue;
    if (el.closest('#nb-picker-root') || el.closest('#nb-steprunner-hud-root')) continue;
    let own = '';
    const kids = el.childNodes;
    for (let k = 0; k < kids.length; k++) {
      if (kids[k].nodeType === 3) own += kids[k].textContent || '';
    }
    own = own.trim();
    const aria = el.getAttribute('aria-label') || '';
    const ph = el.getAttribute('placeholder') || '';
    if (
      own.toLowerCase().indexOf(needle) !== -1 ||
      aria.toLowerCase().indexOf(needle) !== -1 ||
      ph.toLowerCase().indexOf(needle) !== -1
    ) {
      hits.push(el);
    }
  }
  if (hits.length === 0) {
    return { empty: true, message: 'Tidak ada elemen yang memuat teks itu.' };
  }
  const matches = hits.slice(0, 6).map((el) => {
    const candidates = compose(el, document);
    const selectors = candidates.map((c) => c.selector);
    let plurals: unknown[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const extra = candidates[i].plurals;
      if (candidates[i].kind === 'structural' && Array.isArray(extra)) {
        plurals = extra;
        break;
      }
    }
    return {
      tagName: el.tagName.toLowerCase(),
      id: el.id || '',
      text: (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent || '').trim().slice(0, 80),
      candidates,
      plurals,
      pickCall: '(await pick(' + JSON.stringify(selectors) + '))',
    };
  });
  return { empty: false, count: hits.length, matches };
}

export function getSearchCellSource(query: string): string {
  return `return (${buildSearchRuntime.toString()})(${JSON.stringify(query)}, ${getComposerRuntimeSource()});`;
}
