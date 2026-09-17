export const DEEP_CORPUS_ROOT_ID = 'm13-deep-corpus';
export const DEEP_CORPUS_SIBLING_COUNT = 7;
export const DEEP_CORPUS_TARGET_INDEX = 1;
export const DEEP_CORPUS_TARGET_TEXT = 'pesan belum dibaca';
export const DEEP_CORPUS_MIN_DEPTH = 12;
export const DEEP_CORPUS_ARIA_LABEL = 'Buka menu percakapan';

export function deepCorpusHtml(): string {
  const siblings = Array.from({ length: DEEP_CORPUS_SIBLING_COUNT }, (_, i) => {
    const cls = i % 3 === 0 ? 'css-p1a2b3 px-4' : i % 3 === 1 ? 'css-p4c5d6 py-2' : 'css-p7e8f9 flex';
    const text = i === DEEP_CORPUS_TARGET_INDEX ? DEEP_CORPUS_TARGET_TEXT : `pesan lain ${i + 1}`;
    return `<p class="${cls}">${text}</p>`;
  }).join('');
  return (
    `<div id="${DEEP_CORPUS_ROOT_ID}">` +
      `<div class="css-1x2y3z flex">` +
        `<div class="sc-a1b2c3 px-4">` +
          `<div class="css-4d5e6f py-2">` +
            `<div class="sc-d4e5f6 flex">` +
              `<div class="css-7g8h9i grid">` +
                `<div class="sc-g7h8i9 gap-4">` +
                  `<main class="sc-main1x px-4">` +
                    `<div class="css-j0k1l2 py-2">` +
                      `<div class="sc-m3n4o5 flex">` +
                        `<div class="css-p6q7r8 px-4">` +
                          `<div class="sc-s9t0u1 py-2">${siblings}</div>` +
                        `</div>` +
                      `</div>` +
                    `</div>` +
                  `</main>` +
                  `<aside class="css-aside1 flex">` +
                    `<button class="sc-btn9x px-4 py-2" aria-label="${DEEP_CORPUS_ARIA_LABEL}">menu</button>` +
                  `</aside>` +
                `</div>` +
              `</div>` +
            `</div>` +
          `</div>` +
        `</div>` +
      `</div>` +
    `</div>`
  );
}

export function depthFromBody(el: Element): number {
  let depth = 0;
  let current: Element | null = el;
  while (current && current.tagName && current.tagName.toLowerCase() !== 'body') {
    depth += 1;
    current = current.parentElement;
  }
  return depth;
}

export function installDeepCorpus(doc: Document): {
  root: HTMLElement;
  target: Element;
  siblingCount: number;
  depthFromBody: number;
} {
  const existing = doc.getElementById(DEEP_CORPUS_ROOT_ID);
  if (existing) existing.remove();
  doc.body.insertAdjacentHTML('beforeend', deepCorpusHtml());
  const root = doc.getElementById(DEEP_CORPUS_ROOT_ID);
  if (!root) throw new Error('deep corpus root missing after install');
  const siblings = root.querySelectorAll('main p');
  const target = siblings[DEEP_CORPUS_TARGET_INDEX];
  if (!target) throw new Error('deep corpus target missing');
  return {
    root,
    target,
    siblingCount: siblings.length,
    depthFromBody: depthFromBody(target),
  };
}
