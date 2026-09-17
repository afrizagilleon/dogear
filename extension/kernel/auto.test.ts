/**
 * extension/kernel/auto.test.ts
 * Unit tests for auto mode state, arming, host isolation, and budget exhaustion (D-4, RQ-07).
 */

import { describe, it, expect } from 'vitest';
import { loadAuto, armAuto, disarmAuto, tickAutoLoad } from './auto';
import { TestStorage } from '../platform/test-adapter';

describe('T-05: Auto state & budget (D-4, RQ-07)', () => {
  it('arms and resets budget to 0', async () => {
    const storage = new TestStorage();
    const state = await armAuto(storage, 'example.com', 5);
    expect(state.armed).toBe(true);
    expect(state.loads).toBe(0);
    expect(state.maxLoads).toBe(5);

    const loaded = await loadAuto(storage, 'example.com');
    expect(loaded).toEqual(state);
  });

  it('disarms auto mode without resetting loads counter', async () => {
    const storage = new TestStorage();
    await armAuto(storage, 'example.com', 5);
    await tickAutoLoad(storage, 'example.com');
    const disarmed = await disarmAuto(storage, 'example.com');
    expect(disarmed.armed).toBe(false);
    expect(disarmed.loads).toBe(1);
  });

  it('ticks load counter and rejects when budget is exceeded with reason (D-4, INV-8)', async () => {
    const storage = new TestStorage();
    await armAuto(storage, 'example.com', 2);

    const tick1 = await tickAutoLoad(storage, 'example.com');
    expect(tick1.ok).toBe(true);
    expect(tick1.state.loads).toBe(1);
    expect(tick1.state.armed).toBe(true);

    const tick2 = await tickAutoLoad(storage, 'example.com');
    expect(tick2.ok).toBe(true);
    expect(tick2.state.loads).toBe(2);
    expect(tick2.state.armed).toBe(true);

    // 3rd load exceeds maxLoads = 2
    const tick3 = await tickAutoLoad(storage, 'example.com');
    expect(tick3.ok).toBe(false);
    expect(tick3.state.loads).toBe(3);
    expect(tick3.state.armed).toBe(false); // automatically disarmed
    expect(tick3.reason).toBe('Budget page-load habis (tercapai 3/2)');
  });
});
