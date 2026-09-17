import { describe, expect, it } from 'vitest';
import {
  DEEP_CORPUS_ARIA_LABEL,
  DEEP_CORPUS_MIN_DEPTH,
  DEEP_CORPUS_SIBLING_COUNT,
  DEEP_CORPUS_TARGET_TEXT,
  deepCorpusHtml,
} from './deep-corpus';

describe('M13 T-04 deep corpus shape (§4)', () => {
  const html = deepCorpusHtml();

  it('nests at least 12 levels from the corpus root to the target p', () => {
    const beforeTarget = html.split(DEEP_CORPUS_TARGET_TEXT)[0];
    const opens = (beforeTarget.match(/<(div|main|p)\b/g) || []).length;
    expect(opens).toBeGreaterThanOrEqual(DEEP_CORPUS_MIN_DEPTH);
  });

  it('has no data-testid, data-cy, or data-qa on the target path', () => {
    expect(html).not.toMatch(/data-testid|data-cy|data-qa|data-test=/);
  });

  it('uses generated and utility classes only', () => {
    const classes = [...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
    expect(classes.length).toBeGreaterThan(0);
    for (const cls of classes) {
      expect(cls === 'flex' || cls === 'grid' || /^(?:px|py|gap)-/.test(cls) || /^(?:css|sc)-/.test(cls)).toBe(true);
    }
  });

  it('has one main, sibling paragraphs, and a rank-2 aria-label branch', () => {
    expect(html.match(/<main\b/g)?.length).toBe(1);
    expect(html.match(/<p\b/g)?.length).toBe(DEEP_CORPUS_SIBLING_COUNT);
    expect(html).toContain(`aria-label="${DEEP_CORPUS_ARIA_LABEL}"`);
    expect(html).toContain(DEEP_CORPUS_TARGET_TEXT);
  });
});
