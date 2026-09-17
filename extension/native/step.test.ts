/**
 * extension/native/step.test.ts
 * Unit tests for dataDiff computation, evidence truncation, and step message creation (T-05, RQ-03, RQ-04, RQ-05, RQ-06, K-7, K-8, INV-22).
 */

import { describe, it, expect } from 'vitest';
import { computeDataDiff, truncateDomSnippet, createStepMessage } from './step';
import { utf8ByteLength } from './frame-out';

describe('T-05: Step reporting helpers (RQ-04, K-7, K-8, INV-22)', () => {
  it('1. computeDataDiff produces exact RQ-04 shape for added, changed, and removed keys', () => {
    // Step 1: writes orderId = 'ORD-99'
    const diff1 = computeDataDiff({}, { orderId: 'ORD-99' });
    expect(diff1).toEqual({
      added: { orderId: 'ORD-99' },
      changed: {},
      removed: [],
    });

    // Step 2: changes orderId to 'ORD-100' and adds total = 5
    const diff2 = computeDataDiff({ orderId: 'ORD-99' }, { orderId: 'ORD-100', total: 5 });
    expect(diff2).toEqual({
      added: { total: 5 },
      changed: {
        orderId: { from: 'ORD-99', to: 'ORD-100' },
      },
      removed: [],
    });

    // Step 3: removes total
    const diff3 = computeDataDiff({ orderId: 'ORD-100', total: 5 }, { orderId: 'ORD-100' });
    expect(diff3).toEqual({
      added: {},
      changed: {},
      removed: ['total'],
    });
  });

  it('2. computeDataDiff negative case: unchanged data yields all three empty, never omitted (RQ-04)', () => {
    const diffUnchanged = computeDataDiff({ count: 10 }, { count: 10 });
    expect(diffUnchanged).toEqual({
      added: {},
      changed: {},
      removed: [],
    });
    expect(diffUnchanged.truncated).toBeUndefined();
    expect(diffUnchanged.originalBytes).toBeUndefined();
  });

  it('3. computeDataDiff truncates oversized diff and preserves original byte count (K-8, INV-22)', () => {
    // 2-byte emoji payload to test INV-22
    const emojiBlob = '🚀'.repeat(40_000); // 40,000 emojis = 80,000 UTF-16 code units = 160,000 UTF-8 bytes
    const before = {};
    const after = { blob: emojiBlob };

    const diff = computeDataDiff(before, after, 50_000);
    expect(diff.truncated).toBe(true);
    expect(typeof diff.originalBytes).toBe('number');
    expect(diff.originalBytes!).toBeGreaterThan(160_000);
    // Truncated value is shortened
    expect((diff.added.blob as string).length).toBeLessThan(1_000);
    expect((diff.added.blob as string)).toContain('[TRUNCATED]');
  });

  it('4. truncateDomSnippet truncates properly when exceeding byte threshold (K-8, INV-22)', () => {
    const normalHtml = '<button id="tombol-krim">Kirim</button>';
    const normalRes = truncateDomSnippet(normalHtml, 50_000);
    expect(normalRes.domSnippet).toBe(normalHtml);
    expect(normalRes.truncated).toBeUndefined();

    // Oversized snippet with emojis
    const largeHtml = '<div>' + '🌟'.repeat(30_000) + '</div>'; // 120,000 UTF-8 bytes
    const truncatedRes = truncateDomSnippet(largeHtml, 50_000);
    expect(truncatedRes.truncated).toBe(true);
    expect(truncatedRes.originalBytes).toBe(utf8ByteLength(largeHtml));
    expect(utf8ByteLength(truncatedRes.domSnippet)).toBeLessThanOrEqual(50_000);
    expect(truncatedRes.domSnippet).toContain('[TRUNCATED]');
  });

  it('5. createStepMessage packages all required fields for step reporting (RQ-03)', () => {
    const msg = createStepMessage({
      runId: 'run-123',
      cellId: 'steps/01.js',
      state: 'ok',
      durationMs: 45,
      candidateHit: null,
      candidatesTried: [],
      dataDiff: { added: {}, changed: {}, removed: [] },
      evidence: { url: 'http://localhost/test', domSnippet: '<div>ok</div>' },
    });

    expect(msg).toEqual({
      type: 'step',
      runId: 'run-123',
      cellId: 'steps/01.js',
      state: 'ok',
      durationMs: 45,
      candidateHit: null,
      candidatesTried: [],
      dataDiff: { added: {}, changed: {}, removed: [] },
      evidence: { url: 'http://localhost/test', domSnippet: '<div>ok</div>' },
      error: undefined,
    });
  });

  it('6. INV-23: candidateHit is strictly null when state is failed, even if numeric candidateHit is supplied', () => {
    const msg = createStepMessage({
      runId: 'run-fail',
      cellId: 'steps/03.js',
      state: 'failed',
      durationMs: 120,
      candidateHit: 1, // Deliberately pass candidateHit: 1
      candidatesTried: ['#selector-a', '#selector-b'],
      dataDiff: { added: {}, changed: {}, removed: [] },
      evidence: { url: 'http://localhost/test', domSnippet: '<div>failed</div>' },
    });

    expect(msg.candidateHit).toBeNull();
  });

  it('7. Bite-Test 2: candidateHit preserves numeric value when state is ok', () => {
    const msg = createStepMessage({
      runId: 'run-ok',
      cellId: 'steps/02.js',
      state: 'ok',
      durationMs: 80,
      candidateHit: 2,
      candidatesTried: ['#selector-1', '#selector-2'],
      dataDiff: { added: {}, changed: {}, removed: [] },
      evidence: { url: 'http://localhost/test', domSnippet: '<div>matched</div>' },
    });

    expect(msg.candidateHit).toBe(2);
  });
});
