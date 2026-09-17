/**
 * extension/kernel/checkpoint.test.ts
 * Unit tests for checkpoint snapshotting, host key isolation, and safe fallback (D-5, D-6, RQ-02, RQ-03).
 */

import { describe, it, expect } from 'vitest';
import { safeSnapshot, saveCheckpoint, loadCheckpoint, clearCheckpoint } from './checkpoint';
import { TestStorage } from '../platform/test-adapter';

describe('T-02: Checkpoint safeSnapshot and Storage', () => {
  it('clones serializable nested data exactly (RQ-02)', () => {
    const original = {
      n: 7,
      s: 'hello',
      nested: { a: [1, 2, 3], active: true },
    };
    const snap = safeSnapshot(original);
    expect(snap).toEqual(original);
    expect(snap).not.toBe(original);
  });

  it('drops un-serializable properties (e.g. functions, circular, DOM-like) without failing (D-5)', () => {
    const complexObj: Record<string, unknown> = {
      valid: 42,
      fn: () => 'do-not-serialize',
      domNode: { nodeType: 1, textContent: 'div' },
    };
    const snapComplex = safeSnapshot(complexObj);
    expect(snapComplex.valid).toBe(42);

    // Add symbol / non-cloneable
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular; // circular reference causes structuredClone to fail or throw

    const snapCircular = safeSnapshot({
      valid: 'ok',
      bad: circular,
    });
    expect(snapCircular.valid).toBe('ok');
  });

  it('saves and loads checkpoint with host isolation (D-6)', async () => {
    const storage = new TestStorage();
    const dataA = { counter: 10, user: 'alice' };
    const dataB = { counter: 20, user: 'bob' };

    await saveCheckpoint(storage, 'site-a.com', { lastSuccessCellId: 'step-1', data: dataA });
    await saveCheckpoint(storage, 'site-b.com', { lastSuccessCellId: 'step-2', data: dataB });

    const cpA = await loadCheckpoint(storage, 'site-a.com');
    const cpB = await loadCheckpoint(storage, 'site-b.com');

    expect(cpA?.lastSuccessCellId).toBe('step-1');
    expect(cpA?.data).toEqual(dataA);

    expect(cpB?.lastSuccessCellId).toBe('step-2');
    expect(cpB?.data).toEqual(dataB);

    // Clear host A does not affect host B
    await clearCheckpoint(storage, 'site-a.com');
    expect(await loadCheckpoint(storage, 'site-a.com')).toBeNull();
    expect(await loadCheckpoint(storage, 'site-b.com')).not.toBeNull();
  });
});
