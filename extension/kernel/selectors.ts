export type SelectorRank = 1 | 2 | 3 | 4 | 5;

export type SelectorKind = 'testid' | 'semantic' | 'id' | 'class' | 'structural';

export type PluralForm = 'leaf-index' | 'all-indices';

export interface PluralSelector {
  selector: string;
  matchCount: number;
  form: PluralForm;
  call: string;
}

export interface SelectorCandidate {
  selector: string;
  rank: SelectorRank;
  kind: SelectorKind;
  fragile: boolean;
  matchCount?: number;
  plurals?: PluralSelector[];
}

export const MAX_DISPLAYED_CANDIDATES = 6;

const TEST_ID_ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-qa'] as const;

export const UTILITY_EXACT_LIST = [
  'flex',
  'grid',
  'block',
  'inline',
  'hidden',
  'relative',
  'absolute',
  'fixed',
  'sticky',
  'contents',
  'isolate',
  'static',
  'truncate',
  'visible',
  'invisible',
  'underline',
  'italic',
  'uppercase',
  'lowercase',
  'capitalize',
  'grow',
  'shrink',
  'border',
  'rounded',
  'shadow',
  'outline',
  'ring',
  'transition',
  'transform',
  'filter',
  'sr-only',
] as const;

const UTILITY_EXACT = new Set<string>(UTILITY_EXACT_LIST);

const UTILITY_PREFIX =
  /^(?:sm:|md:|lg:|xl:|2xl:|hover:|focus:|focus-visible:|active:|disabled:|dark:)*(?:m|p|w|h|gap|space|text|bg|border|rounded|shadow|font|leading|tracking|items|justify|self|place|overflow|z|opacity|cursor|pointer|top|left|right|bottom|inset|min|max|basis|grow|shrink|col|row|order|object|whitespace|break|align|list|appearance|outline|ring|from|via|to|animate|transition|duration|ease|delay|origin|scale|rotate|translate|skew|fill|stroke|px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|size)-/;

const LANDMARK_TAGS = ['main', 'nav', 'header', 'footer', 'aside', 'article'] as const;

const CSS_IN_JS = /^(?:css|sc|jsx|emotion)-/i;
const REACT_GENERATED_ID = /^:r[0-9a-z]+:$/i;
const EMBER_ID = /^ember\d+$/i;
const ANGULAR_NG = /^ng-tns-c\d+-\d+$/i;

export function cssEscapeIdent(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/([\0-\x1f\x7f-\x9f!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~\s])/g, '\\$1');
}

function attrSelector(name: string, value: string): string {
  return `[${name}=${JSON.stringify(value)}]`;
}

export function isGeneratedIdent(value: string): boolean {
  if (!value) return true;
  if (/^\d/.test(value)) return true;
  if (CSS_IN_JS.test(value)) return true;
  if (REACT_GENERATED_ID.test(value)) return true;
  if (EMBER_ID.test(value)) return true;
  if (ANGULAR_NG.test(value)) return true;
  if (hasHashSuffix(value)) return true;
  return false;
}

function hasHashSuffix(value: string): boolean {
  const match = value.match(/[-_]([a-z0-9]+)$/i);
  if (!match) return false;
  const suffix = match[1];
  if (suffix.length < 6) return false;
  return /[a-z]/i.test(suffix) && /\d/.test(suffix);
}

export function isUtilityClass(value: string): boolean {
  if (!value) return false;
  if (UTILITY_EXACT.has(value)) return true;
  return UTILITY_PREFIX.test(value);
}

function readClassNames(el: Element): string[] {
  if (el.classList && typeof el.classList.length === 'number') {
    return Array.from(el.classList);
  }
  const raw = typeof el.className === 'string' ? el.className : el.getAttribute('class') || '';
  return raw.split(/\s+/).filter(Boolean);
}

function queryCount(root: ParentNode | undefined, selector: string): number {
  if (!root || typeof root.querySelectorAll !== 'function') return -1;
  try {
    return root.querySelectorAll(selector).length;
  } catch {
    return -1;
  }
}

function segmentFor(current: Element): string {
  const tag = current.tagName.toLowerCase();
  const parent: Element | null = current.parentElement;
  if (!parent) return tag;
  const siblings = parent.children;
  let index = -1;
  for (let i = 0; i < siblings.length; i++) {
    if (siblings[i] === current) {
      index = i + 1;
      break;
    }
  }
  if (index === -1 || siblings.length === 1) return tag;
  return `${tag}:nth-child(${index})`;
}

function uniqueStableSelector(el: Element, root?: ParentNode): string | null {
  for (const attr of TEST_ID_ATTRS) {
    const value = el.getAttribute(attr);
    if (!value) continue;
    const sel = attrSelector(attr, value);
    if (queryCount(root, sel) === 1) return sel;
  }
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    const sel = attrSelector('aria-label', ariaLabel);
    if (queryCount(root, sel) === 1) return sel;
  }
  const name = el.getAttribute('name');
  if (name) {
    const sel = attrSelector('name', name);
    if (queryCount(root, sel) === 1) return sel;
  }
  if (el.id && !isGeneratedIdent(el.id)) {
    const sel = `#${cssEscapeIdent(el.id)}`;
    if (queryCount(root, sel) === 1) return sel;
  }
  const tag = el.tagName.toLowerCase();
  if ((LANDMARK_TAGS as readonly string[]).includes(tag) && queryCount(root, tag) === 1) {
    return tag;
  }
  return null;
}

function findNearestAnchor(el: Element, root?: ParentNode): { node: Element; selector: string } | null {
  let walk: Element | null = el.parentElement;
  while (walk && walk.tagName) {
    const tag = walk.tagName.toLowerCase();
    if (tag === 'html' || tag === 'body') break;
    const selector = uniqueStableSelector(walk, root);
    if (selector) return { node: walk, selector };
    walk = walk.parentElement;
  }
  return null;
}

function joinPath(anchorSel: string | null, parts: string[]): string {
  if (anchorSel && parts.length) return `${anchorSel} > ${parts.join(' > ')}`;
  if (anchorSel) return anchorSel;
  return parts.join(' > ');
}

function structuralPath(el: Element, root?: ParentNode): string {
  const anchor = findNearestAnchor(el, root);
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current.tagName && current !== anchor?.node) {
    const tag = current.tagName.toLowerCase();
    if (tag === 'html' || tag === 'body') break;
    parts.unshift(segmentFor(current));
    const selector = joinPath(anchor ? anchor.selector : null, parts);
    const floor = anchor ? parts.length >= 1 : parts.length >= 2;
    if (floor && queryCount(root, selector) === 1) break;
    current = current.parentElement;
  }
  return joinPath(anchor ? anchor.selector : null, parts);
}

export function limitCandidates(
  candidates: SelectorCandidate[],
  max = MAX_DISPLAYED_CANDIDATES
): SelectorCandidate[] {
  if (candidates.length <= max) return candidates;
  const structural = candidates.filter((c) => c.kind === 'structural');
  const rest = candidates.filter((c) => c.kind !== 'structural');
  const restRoom = Math.max(0, max - structural.length);
  return [...rest.slice(0, restRoom), ...structural];
}

function withMatchCounts(candidates: SelectorCandidate[], root: ParentNode): SelectorCandidate[] {
  return candidates.map((candidate) => {
    let matchCount = 0;
    try {
      matchCount = root.querySelectorAll(candidate.selector).length;
    } catch {
      matchCount = 0;
    }
    return { ...candidate, matchCount };
  });
}

export function composeSelectorCandidates(
  el: Element,
  root?: ParentNode,
  options?: { limit?: number }
): SelectorCandidate[] {
  const candidates: SelectorCandidate[] = [];
  const seen = new Set<string>();

  const push = (candidate: SelectorCandidate) => {
    if (!candidate.selector || seen.has(candidate.selector)) return;
    seen.add(candidate.selector);
    candidates.push(candidate);
  };

  for (const attr of TEST_ID_ATTRS) {
    const value = el.getAttribute(attr);
    if (value) {
      push({
        selector: attrSelector(attr, value),
        rank: 1,
        kind: 'testid',
        fragile: false,
      });
    }
  }

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    push({
      selector: attrSelector('aria-label', ariaLabel),
      rank: 2,
      kind: 'semantic',
      fragile: false,
    });
  }

  const role = el.getAttribute('role');
  if (role && ariaLabel) {
    push({
      selector: `${attrSelector('role', role)}${attrSelector('aria-label', ariaLabel)}`,
      rank: 2,
      kind: 'semantic',
      fragile: false,
    });
  }

  const name = el.getAttribute('name');
  if (name) {
    push({
      selector: attrSelector('name', name),
      rank: 2,
      kind: 'semantic',
      fragile: false,
    });
  }

  const placeholder = el.getAttribute('placeholder');
  if (placeholder) {
    push({
      selector: attrSelector('placeholder', placeholder),
      rank: 2,
      kind: 'semantic',
      fragile: false,
    });
  }

  if (el.id && !isGeneratedIdent(el.id)) {
    push({
      selector: `#${cssEscapeIdent(el.id)}`,
      rank: 3,
      kind: 'id',
      fragile: false,
    });
  }

  const semanticClasses = readClassNames(el).filter(
    (cls) => !isGeneratedIdent(cls) && !isUtilityClass(cls)
  );
  if (semanticClasses.length > 0) {
    push({
      selector: semanticClasses.map((cls) => `.${cssEscapeIdent(cls)}`).join(''),
      rank: 4,
      kind: 'class',
      fragile: false,
    });
  }

  push({
    selector: structuralPath(el, root),
    rank: 5,
    kind: 'structural',
    fragile: true,
  });

  const counted = root && typeof root.querySelectorAll === 'function'
    ? withMatchCounts(candidates, root)
    : candidates;
  const limit = options?.limit ?? MAX_DISPLAYED_CANDIDATES;
  const limited = limitCandidates(counted, limit);
  const structural = limited.find((c) => c.kind === 'structural');
  if (structural) {
    structural.plurals = composePluralSelectors(structural.selector, root);
  }
  return limited;
}

export function formatPickCall(candidates: SelectorCandidate[]): string {
  const selectors = candidates.map((candidate) => candidate.selector);
  return `(await pick(${JSON.stringify(selectors)}))`;
}

export function formatDollarCall(selector: string): string {
  return `$$(${JSON.stringify(selector)})`;
}

export function composePluralSelectors(
  structural: string,
  root?: ParentNode
): PluralSelector[] {
  if (!structural) return [];
  const seen = new Set<string>();
  const out: PluralSelector[] = [];
  const leaf = structural.replace(/:nth-child\(\d+\)$/, '');
  const all = structural.replace(/:nth-child\(\d+\)/g, '');
  const forms: Array<{ selector: string; form: PluralForm }> = [
    { selector: leaf, form: 'leaf-index' },
    { selector: all, form: 'all-indices' },
  ];
  for (const item of forms) {
    if (!item.selector || item.selector === structural || seen.has(item.selector)) continue;
    const matchCount = queryCount(root, item.selector);
    if (matchCount <= 1) continue;
    seen.add(item.selector);
    out.push({
      selector: item.selector,
      matchCount,
      form: item.form,
      call: formatDollarCall(item.selector),
    });
  }
  return out;
}

export function getComposerRuntimeSource(): string {
  const utilityMap = Object.fromEntries(UTILITY_EXACT_LIST.map((value) => [value, true]));
  return `(function composeSelectorCandidates(el, root, options) {
    var TEST_ID_ATTRS = ${JSON.stringify(TEST_ID_ATTRS)};
    var UTILITY_EXACT = ${JSON.stringify(utilityMap)};
    var UTILITY_PREFIX = ${UTILITY_PREFIX.toString()};
    var CSS_IN_JS = ${CSS_IN_JS.toString()};
    var REACT_GENERATED_ID = ${REACT_GENERATED_ID.toString()};
    var EMBER_ID = ${EMBER_ID.toString()};
    var ANGULAR_NG = ${ANGULAR_NG.toString()};
    var MAX = ${MAX_DISPLAYED_CANDIDATES};
    var LANDMARK_TAGS = ${JSON.stringify(LANDMARK_TAGS)};
    function cssEscapeIdent(value) {
      if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
      return String(value).replace(/([\\0-\\x1f\\x7f-\\x9f!"#$%&'()*+,./:;<=>?@[\\\\\\]^\\\`{|}~\\s])/g, '\\\\$1');
    }
    function attrSelector(name, value) {
      return '[' + name + '=' + JSON.stringify(value) + ']';
    }
    function hasHashSuffix(value) {
      var match = String(value).match(/[-_]([a-z0-9]+)$/i);
      if (!match) return false;
      var suffix = match[1];
      if (suffix.length < 6) return false;
      return /[a-z]/i.test(suffix) && /\\d/.test(suffix);
    }
    function isGeneratedIdent(value) {
      if (!value) return true;
      if (/^\\d/.test(value)) return true;
      if (CSS_IN_JS.test(value)) return true;
      if (REACT_GENERATED_ID.test(value)) return true;
      if (EMBER_ID.test(value)) return true;
      if (ANGULAR_NG.test(value)) return true;
      if (hasHashSuffix(value)) return true;
      return false;
    }
    function isUtilityClass(value) {
      if (!value) return false;
      if (UTILITY_EXACT[value]) return true;
      return UTILITY_PREFIX.test(value);
    }
    function readClassNames(node) {
      if (node.classList && typeof node.classList.length === 'number') {
        return Array.from(node.classList);
      }
      var raw = typeof node.className === 'string' ? node.className : node.getAttribute('class') || '';
      return String(raw).split(/\\s+/).filter(Boolean);
    }
    function queryCount(scope, selector) {
      if (!scope || typeof scope.querySelectorAll !== 'function') return -1;
      try { return scope.querySelectorAll(selector).length; } catch (err) { return -1; }
    }
    function segmentFor(node) {
      var tag = String(node.tagName).toLowerCase();
      var parent = node.parentElement;
      if (!parent) return tag;
      var siblings = parent.children;
      var index = -1;
      for (var i = 0; i < siblings.length; i++) {
        if (siblings[i] === node) {
          index = i + 1;
          break;
        }
      }
      if (index === -1 || siblings.length === 1) return tag;
      return tag + ':nth-child(' + index + ')';
    }
    function uniqueStableSelector(node, scope) {
      var ui;
      for (ui = 0; ui < TEST_ID_ATTRS.length; ui++) {
        var attrName = TEST_ID_ATTRS[ui];
        var attrVal = node.getAttribute(attrName);
        if (!attrVal) continue;
        var attrSel = attrSelector(attrName, attrVal);
        if (queryCount(scope, attrSel) === 1) return attrSel;
      }
      var aria = node.getAttribute('aria-label');
      if (aria) {
        var ariaSel = attrSelector('aria-label', aria);
        if (queryCount(scope, ariaSel) === 1) return ariaSel;
      }
      var nameVal = node.getAttribute('name');
      if (nameVal) {
        var nameSel = attrSelector('name', nameVal);
        if (queryCount(scope, nameSel) === 1) return nameSel;
      }
      if (node.id && !isGeneratedIdent(node.id)) {
        var idSel = '#' + cssEscapeIdent(node.id);
        if (queryCount(scope, idSel) === 1) return idSel;
      }
      var nodeTag = String(node.tagName).toLowerCase();
      if (LANDMARK_TAGS.indexOf(nodeTag) !== -1 && queryCount(scope, nodeTag) === 1) return nodeTag;
      return null;
    }
    function findNearestAnchor(node, scope) {
      var walk = node.parentElement;
      while (walk && walk.tagName) {
        var walkTag = String(walk.tagName).toLowerCase();
        if (walkTag === 'html' || walkTag === 'body') break;
        var stable = uniqueStableSelector(walk, scope);
        if (stable) return { node: walk, selector: stable };
        walk = walk.parentElement;
      }
      return null;
    }
    function joinPath(anchorSel, parts) {
      if (anchorSel && parts.length) return anchorSel + ' > ' + parts.join(' > ');
      if (anchorSel) return anchorSel;
      return parts.join(' > ');
    }
    function structuralPath(node, scope) {
      var anchor = findNearestAnchor(node, scope);
      var parts = [];
      var current = node;
      while (current && current.tagName && (!anchor || current !== anchor.node)) {
        var tag = String(current.tagName).toLowerCase();
        if (tag === 'html' || tag === 'body') break;
        parts.unshift(segmentFor(current));
        var selector = joinPath(anchor ? anchor.selector : null, parts);
        var floor = anchor ? parts.length >= 1 : parts.length >= 2;
        if (floor && queryCount(scope, selector) === 1) break;
        current = current.parentElement;
      }
      return joinPath(anchor ? anchor.selector : null, parts);
    }
    function limitCandidates(list, max) {
      if (list.length <= max) return list;
      var structural = list.filter(function (c) { return c.kind === 'structural'; });
      var rest = list.filter(function (c) { return c.kind !== 'structural'; });
      var restRoom = Math.max(0, max - structural.length);
      return rest.slice(0, restRoom).concat(structural);
    }
    var candidates = [];
    var seen = {};
    function push(candidate) {
      if (!candidate.selector || seen[candidate.selector]) return;
      seen[candidate.selector] = true;
      candidates.push(candidate);
    }
    var ai;
    for (ai = 0; ai < TEST_ID_ATTRS.length; ai++) {
      var attr = TEST_ID_ATTRS[ai];
      var testIdValue = el.getAttribute(attr);
      if (testIdValue) {
        push({ selector: attrSelector(attr, testIdValue), rank: 1, kind: 'testid', fragile: false });
      }
    }
    var ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) {
      push({ selector: attrSelector('aria-label', ariaLabel), rank: 2, kind: 'semantic', fragile: false });
    }
    var role = el.getAttribute('role');
    if (role && ariaLabel) {
      push({
        selector: attrSelector('role', role) + attrSelector('aria-label', ariaLabel),
        rank: 2,
        kind: 'semantic',
        fragile: false,
      });
    }
    var name = el.getAttribute('name');
    if (name) {
      push({ selector: attrSelector('name', name), rank: 2, kind: 'semantic', fragile: false });
    }
    var placeholder = el.getAttribute('placeholder');
    if (placeholder) {
      push({ selector: attrSelector('placeholder', placeholder), rank: 2, kind: 'semantic', fragile: false });
    }
    if (el.id && !isGeneratedIdent(el.id)) {
      push({ selector: '#' + cssEscapeIdent(el.id), rank: 3, kind: 'id', fragile: false });
    }
    var semanticClasses = readClassNames(el).filter(function (cls) {
      return !isGeneratedIdent(cls) && !isUtilityClass(cls);
    });
    if (semanticClasses.length > 0) {
      push({
        selector: semanticClasses.map(function (cls) { return '.' + cssEscapeIdent(cls); }).join(''),
        rank: 4,
        kind: 'class',
        fragile: false,
      });
    }
    push({ selector: structuralPath(el, root), rank: 5, kind: 'structural', fragile: true });
    var counted = candidates;
    if (root && typeof root.querySelectorAll === 'function') {
      counted = candidates.map(function (candidate) {
        var matchCount = 0;
        try { matchCount = root.querySelectorAll(candidate.selector).length; } catch (err) { matchCount = 0; }
        var copy = {};
        for (var key in candidate) copy[key] = candidate[key];
        copy.matchCount = matchCount;
        return copy;
      });
    }
    function formatDollarCall(selector) {
      return '$$(' + JSON.stringify(selector) + ')';
    }
    function composePluralSelectors(structural, scope) {
      if (!structural) return [];
      var seen = {};
      var out = [];
      var leaf = structural.replace(/:nth-child\\(\\d+\\)$/, '');
      var all = structural.replace(/:nth-child\\(\\d+\\)/g, '');
      var forms = [
        { selector: leaf, form: 'leaf-index' },
        { selector: all, form: 'all-indices' },
      ];
      var fi;
      for (fi = 0; fi < forms.length; fi++) {
        var item = forms[fi];
        if (!item.selector || item.selector === structural || seen[item.selector]) continue;
        var n = queryCount(scope, item.selector);
        if (n <= 1) continue;
        seen[item.selector] = true;
        out.push({
          selector: item.selector,
          matchCount: n,
          form: item.form,
          call: formatDollarCall(item.selector),
        });
      }
      return out;
    }
    var limit = options && options.limit != null ? options.limit : MAX;
    var limited = limitCandidates(counted, limit);
    var structuralCand = null;
    var li;
    for (li = 0; li < limited.length; li++) {
      if (limited[li].kind === 'structural') { structuralCand = limited[li]; break; }
    }
    if (structuralCand) structuralCand.plurals = composePluralSelectors(structuralCand.selector, root);
    return limited;
  })`;
}
