import { describe, it, expect } from 'vitest';
import { getPickerCellSource } from '../ui/picker';
import {
  composePluralSelectors,
  composeSelectorCandidates,
  formatDollarCall,
  formatPickCall,
  getComposerRuntimeSource,
  isGeneratedIdent,
  isUtilityClass,
  limitCandidates,
  MAX_DISPLAYED_CANDIDATES,
  UTILITY_EXACT_LIST,
  type SelectorCandidate,
} from './selectors';

class FakeEl {
  tagName: string;
  id: string;
  className: string;
  parentElement: FakeEl | null = null;
  children: FakeEl[] = [];
  private attrs: Record<string, string>;

  constructor(tag: string, attrs: Record<string, string> = {}) {
    this.tagName = tag.toUpperCase();
    this.id = attrs.id || '';
    this.className = attrs.class || '';
    this.attrs = { ...attrs };
  }

  get classList(): string[] {
    return this.className.split(/\s+/).filter(Boolean);
  }

  getAttribute(name: string): string | null {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
}

function el(tag: string, attrs: Record<string, string> = {}, parent?: FakeEl): FakeEl {
  const node = new FakeEl(tag, attrs);
  if (parent) {
    node.parentElement = parent;
    parent.children.push(node);
  }
  return node;
}

function asElement(node: FakeEl): Element {
  return node as unknown as Element;
}

describe('T-01 composeSelectorCandidates ranking (§4.3)', () => {
  it('rank 1: data-testid / data-test / data-cy / data-qa come first', () => {
    const body = el('body');
    const node = el(
      'button',
      {
        'data-testid': 'submit-btn',
        'data-test': 'submit-test',
        'data-cy': 'submit-cy',
        'data-qa': 'submit-qa',
        id: 'human-id',
      },
      body
    );
    const candidates = composeSelectorCandidates(asElement(node));
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates[0]).toMatchObject({
      selector: '[data-testid="submit-btn"]',
      rank: 1,
      kind: 'testid',
      fragile: false,
    });
    expect(candidates.map((c) => c.selector)).toEqual(
      expect.arrayContaining([
        '[data-testid="submit-btn"]',
        '[data-test="submit-test"]',
        '[data-cy="submit-cy"]',
        '[data-qa="submit-qa"]',
      ])
    );
    const testIds = candidates.filter((c) => c.rank === 1);
    expect(testIds.every((c) => candidates.indexOf(c) < candidates.findIndex((x) => x.rank > 1))).toBe(true);
  });

  it('rank 2: aria-label, role+name, name, placeholder', () => {
    const body = el('body');
    const node = el(
      'input',
      {
        'aria-label': 'Cari artikel',
        role: 'searchbox',
        name: 'q',
        placeholder: 'ketik kata kunci',
      },
      body
    );
    const candidates = composeSelectorCandidates(asElement(node));
    const semantic = candidates.filter((c) => c.rank === 2);
    expect(semantic.map((c) => c.selector)).toEqual([
      '[aria-label="Cari artikel"]',
      '[role="searchbox"][aria-label="Cari artikel"]',
      '[name="q"]',
      '[placeholder="ketik kata kunci"]',
    ]);
    expect(semantic.every((c) => c.kind === 'semantic' && c.fragile === false)).toBe(true);
    expect(candidates[0].rank).toBe(2);
  });

  it('rank 3: human-written #id is kept, generated id is not', () => {
    const body = el('body');
    const human = el('div', { id: 'login-form' }, body);
    const generated = el('div', { id: 'css-1x2y3z' }, body);

    const humanCandidates = composeSelectorCandidates(asElement(human));
    expect(humanCandidates.some((c) => c.rank === 3 && c.selector === '#login-form')).toBe(true);

    const generatedCandidates = composeSelectorCandidates(asElement(generated));
    expect(generatedCandidates.some((c) => c.kind === 'id')).toBe(false);
    expect(generatedCandidates.map((c) => c.selector).join(' ')).not.toContain('#css-1x2y3z');
    expect(isGeneratedIdent('css-1x2y3z')).toBe(true);
    expect(isGeneratedIdent('login-form')).toBe(false);
  });

  it('rank 4: semantic class is kept, generated class is not', () => {
    const body = el('body');
    const semantic = el('button', { class: 'submit-btn' }, body);
    const generated = el('button', { class: 'sc-a1b2c3' }, body);

    const semanticCandidates = composeSelectorCandidates(asElement(semantic));
    expect(semanticCandidates.some((c) => c.rank === 4 && c.selector === '.submit-btn')).toBe(true);

    const generatedCandidates = composeSelectorCandidates(asElement(generated));
    expect(generatedCandidates.some((c) => c.kind === 'class')).toBe(false);
    expect(generatedCandidates.map((c) => c.selector).join(' ')).not.toContain('.sc-a1b2c3');
  });

  it('rank 5: structural path is always last and marked fragile', () => {
    const body = el('body');
    const wrap = el('div', {}, body);
    const first = el('span', {}, wrap);
    const target = el('span', { 'data-testid': 'item' }, wrap);
    void first;

    const candidates = composeSelectorCandidates(asElement(target));
    const last = candidates[candidates.length - 1];
    expect(last.rank).toBe(5);
    expect(last.kind).toBe('structural');
    expect(last.fragile).toBe(true);
    expect(last.selector).toContain(':nth-child(');
    expect(last.selector).toMatch(/span:nth-child\(2\)$/);
    expect(candidates[0].selector).toBe('[data-testid="item"]');
  });

  it('returns an ordered candidate list, never a single selector', () => {
    const body = el('body');
    const node = el('button', { 'data-testid': 'ok', id: 'ok-btn', class: 'ok-class' }, body);
    const candidates = composeSelectorCandidates(asElement(node));
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBeGreaterThan(1);
    const pickCall = formatPickCall(candidates);
    expect(pickCall.startsWith('(await pick([')).toBe(true);
    expect(candidates[0].selector).toBe('[data-testid="ok"]');
    expect(pickCall).toContain('[data-testid=\\"ok\\"]');
  });
});

function selectorsOf(node: FakeEl): string[] {
  return composeSelectorCandidates(asElement(node)).map((c) => c.selector);
}

describe('T-02 reject generated id/class patterns (§4.3)', () => {
  it('rejects id/class that is entirely numeric or starts with a digit', () => {
    expect(isGeneratedIdent('123')).toBe(true);
    expect(isGeneratedIdent('1header')).toBe(true);
    const body = el('body');
    const node = el('div', { id: '123', class: '9col' }, body);
    const selectors = selectorsOf(node);
    expect(selectors.some((s) => s.includes('#123') || s.includes('.9col'))).toBe(false);
  });

  it('rejects CSS-in-JS pattern css-1x2y3z', () => {
    expect(isGeneratedIdent('css-1x2y3z')).toBe(true);
    const body = el('body');
    const node = el('div', { id: 'css-1x2y3z', class: 'css-1x2y3z' }, body);
    const selectors = selectorsOf(node);
    expect(selectors.join(' ')).not.toContain('css-1x2y3z');
  });

  it('rejects styled-components pattern sc-a1b2c3', () => {
    expect(isGeneratedIdent('sc-a1b2c3')).toBe(true);
    const body = el('body');
    const node = el('div', { class: 'sc-a1b2c3' }, body);
    expect(selectorsOf(node).join(' ')).not.toContain('sc-a1b2c3');
  });

  it('rejects jsx-1234567890', () => {
    expect(isGeneratedIdent('jsx-1234567890')).toBe(true);
    const body = el('body');
    const node = el('div', { class: 'jsx-1234567890' }, body);
    expect(selectorsOf(node).join(' ')).not.toContain('jsx-1234567890');
  });

  it('rejects emotion-*', () => {
    expect(isGeneratedIdent('emotion-cache')).toBe(true);
    const body = el('body');
    const node = el('div', { class: 'emotion-1abcde' }, body);
    expect(selectorsOf(node).join(' ')).not.toContain('emotion-');
  });

  it('rejects React modern id :r0: and :r1a:', () => {
    expect(isGeneratedIdent(':r0:')).toBe(true);
    expect(isGeneratedIdent(':r1a:')).toBe(true);
    const body = el('body');
    const r0 = el('div', { id: ':r0:' }, body);
    const r1a = el('div', { id: ':r1a:' }, body);
    expect(selectorsOf(r0).join(' ')).not.toContain(':r0:');
    expect(selectorsOf(r1a).join(' ')).not.toContain(':r1a:');
  });

  it('rejects Ember id ember123', () => {
    expect(isGeneratedIdent('ember123')).toBe(true);
    const body = el('body');
    const node = el('div', { id: 'ember123' }, body);
    expect(selectorsOf(node).join(' ')).not.toContain('ember123');
  });

  it('rejects Angular id ng-tns-c12-3', () => {
    expect(isGeneratedIdent('ng-tns-c12-3')).toBe(true);
    const body = el('body');
    const node = el('div', { id: 'ng-tns-c12-3' }, body);
    expect(selectorsOf(node).join(' ')).not.toContain('ng-tns-c12-3');
  });

  it('rejects long hash suffix btn-a8f3d92', () => {
    expect(isGeneratedIdent('btn-a8f3d92')).toBe(true);
    const body = el('body');
    const node = el('button', { class: 'btn-a8f3d92' }, body);
    expect(selectorsOf(node).join(' ')).not.toContain('btn-a8f3d92');
  });

  it('rejects utility class chain px-4 py-2 flex items-center as identity', () => {
    expect(isUtilityClass('px-4')).toBe(true);
    expect(isUtilityClass('py-2')).toBe(true);
    expect(isUtilityClass('flex')).toBe(true);
    expect(isUtilityClass('items-center')).toBe(true);
    const body = el('body');
    const node = el('button', { class: 'px-4 py-2 flex items-center' }, body);
    const candidates = composeSelectorCandidates(asElement(node));
    expect(candidates.some((c) => c.kind === 'class')).toBe(false);
    expect(candidates.map((c) => c.selector).join(' ')).not.toMatch(/\.(px-4|py-2|flex|items-center)/);
  });

  it('bite-test 1: mixed data-testid + generated id + structural keeps testid first and structural last', () => {
    const body = el('body');
    const wrap = el('div', {}, body);
    el('span', {}, wrap);
    const target = el(
      'button',
      {
        'data-testid': 'save-row',
        id: 'css-1x2y3z',
        class: 'sc-a1b2c3 px-4 py-2',
      },
      wrap
    );
    const candidates = composeSelectorCandidates(asElement(target));
    const selectors = candidates.map((c) => c.selector);
    expect(candidates[0]).toMatchObject({
      selector: '[data-testid="save-row"]',
      rank: 1,
      kind: 'testid',
    });
    const last = candidates[candidates.length - 1];
    expect(last.rank).toBe(5);
    expect(last.kind).toBe('structural');
    expect(last.fragile).toBe(true);
    expect(selectors.join(' ')).not.toContain('css-1x2y3z');
    expect(selectors.join(' ')).not.toContain('sc-a1b2c3');
    expect(selectors).toEqual([
      '[data-testid="save-row"]',
      last.selector,
    ]);
  });
});

describe('T-03 match counts, fragile flag, and display cap (OQ-2)', () => {
  it('attaches matchCount from root.querySelectorAll', () => {
    const body = el('body');
    const node = el('button', { 'data-testid': 'dup' }, body);
    const root = {
      querySelectorAll: (sel: string) => {
        if (sel === '[data-testid="dup"]') return [{}, {}];
        return [{}];
      },
    } as unknown as ParentNode;
    const candidates = composeSelectorCandidates(asElement(node), root);
    const testid = candidates.find((c) => c.kind === 'testid');
    const structural = candidates.find((c) => c.kind === 'structural');
    expect(testid?.matchCount).toBe(2);
    expect(structural?.matchCount).toBe(1);
    expect(structural?.fragile).toBe(true);
    expect(testid?.fragile).toBe(false);
  });

  it('limitCandidates always keeps structural last when capping', () => {
    expect(MAX_DISPLAYED_CANDIDATES).toBe(6);
    const many: SelectorCandidate[] = Array.from({ length: 10 }, (_, i) => ({
      selector: `[data-testid="x${i}"]`,
      rank: 1,
      kind: 'testid',
      fragile: false,
    }));
    many.push({
      selector: 'body > button',
      rank: 5,
      kind: 'structural',
      fragile: true,
    });
    const limited = limitCandidates(many, 6);
    expect(limited).toHaveLength(6);
    expect(limited[limited.length - 1]).toMatchObject({
      kind: 'structural',
      fragile: true,
    });
      expect(limited.filter((c) => c.kind === 'testid')).toHaveLength(5);
    });
  });

describe('A1-T1 one ranking machine for kernel and product cell', () => {
  it('treats sr-only as a utility on both paths', () => {
    expect(UTILITY_EXACT_LIST).toContain('sr-only');
    expect(isUtilityClass('sr-only')).toBe(true);
    const body = el('body');
    const node = el('div', { class: 'sr-only save-row' }, body);
    const kernel = composeSelectorCandidates(asElement(node));
    expect(kernel.some((c) => c.kind === 'class' && c.selector === '.save-row')).toBe(true);
    expect(kernel.map((c) => c.selector).join(' ')).not.toContain('sr-only');
    const runtime = getComposerRuntimeSource();
    expect(runtime).toContain('"sr-only":true');
    expect(getPickerCellSource()).toContain(runtime);
  });

  it('runs the same utility corpus through kernel list and product cell source', () => {
    const runtime = getComposerRuntimeSource();
    const keys = [...runtime.matchAll(/"([^"]+)":true/g)].map((match) => match[1]).sort();
    expect(keys).toEqual([...UTILITY_EXACT_LIST].sort());
    const body = el('body');
    const wrap = el('div', {}, body);
    el('span', {}, wrap);
    const mixed = el(
      'button',
      {
        'data-testid': 'save-row',
        id: 'css-1x2y3z',
        class: 'sc-a1b2c3 px-4 py-2 sr-only save-row',
      },
      wrap
    );
    const selectors = composeSelectorCandidates(asElement(mixed)).map((c) => c.selector);
    expect(selectors[0]).toBe('[data-testid="save-row"]');
    expect(selectors.join(' ')).not.toContain('sr-only');
    expect(selectors.join(' ')).not.toContain('css-1x2y3z');
    expect(getPickerCellSource()).toContain(runtime);
  });
});

describe('M13 T-01 structural path never includes body or html', () => {
  it('kernel structural candidate omits body and html', () => {
    const html = el('html');
    const body = el('body', {}, html);
    const wrap = el('div', {}, body);
    el('span', {}, wrap);
    const target = el('span', {}, wrap);
    const candidates = composeSelectorCandidates(asElement(target));
    const structural = candidates.find((c) => c.kind === 'structural');
    expect(structural?.selector).toBeTruthy();
    expect(structural?.selector).not.toMatch(/(?:^|[\s>])(?:body|html)(?::|$|[\s>])/);
    expect(structural?.selector).not.toContain('body');
    expect(structural?.selector).not.toContain('html');
    expect(structural?.selector).toMatch(/span:nth-child\(2\)$/);
  });

  it('runtime source skips body and html before pushing a segment', () => {
    const runtime = getComposerRuntimeSource();
    expect(runtime).toContain("tag === 'html' || tag === 'body'");
    expect(runtime).not.toMatch(/if \(tag === 'body'\) break;/);
    expect(getPickerCellSource()).toContain(runtime);
  });
});

describe('M13 T-02 stop when unique, never a naked leaf', () => {
  it('keeps at least one ancestor even when the leaf selector is unique', () => {
    const body = el('body');
    const wrap = el('div', {}, body);
    el('span', {}, wrap);
    const target = el('p', {}, wrap);
    const root = {
      querySelectorAll: (sel: string) => {
        if (sel === 'p:nth-child(2)') return [{}];
        if (sel === 'div > p:nth-child(2)') return [{}];
        return [{}, {}];
      },
    } as unknown as ParentNode;
    const candidates = composeSelectorCandidates(asElement(target), root);
    const structural = candidates.find((c) => c.kind === 'structural');
    expect(structural?.selector).toBe('div > p:nth-child(2)');
    expect(structural?.selector).not.toBe('p:nth-child(2)');
    expect(structural?.matchCount).toBe(1);
  });

  it('stops once the path is unique after the ancestor floor', () => {
    const body = el('body');
    const outer = el('div', {}, body);
    const mid = el('div', {}, outer);
    const inner = el('div', {}, mid);
    el('span', {}, inner);
    const target = el('p', {}, inner);
    const root = {
      querySelectorAll: (sel: string) => {
        if (sel.split(' > ').length < 2) return [{}, {}];
        if (sel === 'div > p:nth-child(2)') return [{}];
        return [{}];
      },
    } as unknown as ParentNode;
    const candidates = composeSelectorCandidates(asElement(target), root);
    const structural = candidates.find((c) => c.kind === 'structural');
    expect(structural?.selector).toBe('div > p:nth-child(2)');
    expect(structural?.selector.split(' > ').length).toBe(2);
    expect(structural?.matchCount).toBe(1);
  });

  it('runtime source stops at unique after two segments', () => {
    const runtime = getComposerRuntimeSource();
    expect(runtime).toContain('parts.length >= 2');
    expect(getPickerCellSource()).toContain(runtime);
  });
});

describe('M13 T-03 nearest unique stable ancestor', () => {
  it('anchors to unique main rather than a farther #app', () => {
    const body = el('body');
    const app = el('div', { id: 'app' }, body);
    const main = el('main', { class: 'sc-a1b2c3 px-4' }, app);
    const inner = el('div', { class: 'css-1x2y3z py-2' }, main);
    el('span', {}, inner);
    const target = el('p', {}, inner);
    const root = {
      querySelectorAll: (sel: string) => {
        if (sel === 'main') return [{}];
        if (sel === '#app') return [{}];
        if (sel === 'main > p:nth-child(2)') return [{}];
        if (sel === 'main > div > p:nth-child(2)') return [{}];
        if (!sel.includes(' ') && sel !== 'main' && sel !== '#app') return [{}, {}];
        return [{}];
      },
    } as unknown as ParentNode;
    const candidates = composeSelectorCandidates(asElement(target), root);
    const structural = candidates.find((c) => c.kind === 'structural');
    expect(structural?.selector.startsWith('main >')).toBe(true);
    expect(structural?.selector).not.toContain('#app');
    expect(structural?.selector).not.toContain('body');
    expect(structural?.matchCount).toBe(1);
  });

  it('rejects an ancestor whose stable selector matchCount is not 1', () => {
    const body = el('body');
    el('main', {}, body);
    const mainB = el('main', {}, body);
    const inner = el('div', {}, mainB);
    el('span', {}, inner);
    const target = el('p', {}, inner);
    const root = {
      querySelectorAll: (sel: string) => {
        if (sel === 'main') return [{}, {}];
        if (sel.split(' > ').length < 2) return [{}, {}];
        return [{}];
      },
    } as unknown as ParentNode;
    const candidates = composeSelectorCandidates(asElement(target), root);
    const structural = candidates.find((c) => c.kind === 'structural');
    expect(structural?.selector.startsWith('main')).toBe(false);
    expect(structural?.matchCount).toBe(1);
  });
});

describe('M13 T-05 plural selectors as $$(), not pick()', () => {
  it('emits leaf-index and all-indices forms only when matchCount > 1', () => {
    const structural = 'main > div:nth-child(1) > p:nth-child(2)';
    const root = {
      querySelectorAll: (sel: string) => {
        if (sel === 'main > div:nth-child(1) > p') return [{}, {}, {}, {}, {}, {}, {}];
        if (sel === 'main > div > p') return [{}, {}, {}, {}, {}, {}, {}, {}, {}];
        return [{}];
      },
    } as unknown as ParentNode;
    const plurals = composePluralSelectors(structural, root);
    expect(plurals).toHaveLength(2);
    expect(plurals[0]).toMatchObject({
      selector: 'main > div:nth-child(1) > p',
      matchCount: 7,
      form: 'leaf-index',
      call: '$$("main > div:nth-child(1) > p")',
    });
    expect(plurals[1]).toMatchObject({
      selector: 'main > div > p',
      matchCount: 9,
      form: 'all-indices',
      call: '$$("main > div > p")',
    });
    expect(formatDollarCall('main > p')).toBe('$$("main > p")');
    expect(formatPickCall([{ selector: 'main > p:nth-child(2)', rank: 5, kind: 'structural', fragile: true }])).not.toContain('$$(');
  });

  it('does not duplicate identical forms or matchCount 1', () => {
    const structural = 'main > div > p:nth-child(2)';
    const root = {
      querySelectorAll: (sel: string) => {
        if (sel === 'main > div > p') return [{}, {}, {}];
        return [{}];
      },
    } as unknown as ParentNode;
    const plurals = composePluralSelectors(structural, root);
    expect(plurals).toHaveLength(1);
    expect(plurals[0].form).toBe('leaf-index');
    expect(plurals[0].matchCount).toBe(3);
  });
});
