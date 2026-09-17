/**
 * extension/native/reconnect.test.ts
 * Unit tests for native messaging reconnection, backoff sequence (K-10), and port exclusivity (K-11).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  ReconnectBackoff,
  NativeConnectionManager,
} from './reconnect';
import { NativeBridge, type NativePortLike } from './bridge';
import { TestPlatformAdapter } from '../platform/test-adapter';

describe('T-06: Backoff Sequence K-10 (isolated member tests)', () => {
  it('1. step 1 delay is 1s', () => {
    const backoff = new ReconnectBackoff();
    expect(backoff.getNextDelaySeconds()).toBe(1);
    expect(backoff.currentAttempt).toBe(1);
  });

  it('2. step 2 delay is 2s', () => {
    const backoff = new ReconnectBackoff();
    backoff.getNextDelaySeconds(); // 1
    expect(backoff.getNextDelaySeconds()).toBe(2);
    expect(backoff.currentAttempt).toBe(2);
  });

  it('3. step 3 delay is 4s', () => {
    const backoff = new ReconnectBackoff();
    backoff.getNextDelaySeconds(); // 1
    backoff.getNextDelaySeconds(); // 2
    expect(backoff.getNextDelaySeconds()).toBe(4);
    expect(backoff.currentAttempt).toBe(3);
  });

  it('4. step 4 delay is 8s', () => {
    const backoff = new ReconnectBackoff();
    backoff.getNextDelaySeconds(); // 1
    backoff.getNextDelaySeconds(); // 2
    backoff.getNextDelaySeconds(); // 4
    expect(backoff.getNextDelaySeconds()).toBe(8);
    expect(backoff.currentAttempt).toBe(4);
  });

  it('5. step 5 delay is 16s', () => {
    const backoff = new ReconnectBackoff();
    for (let i = 0; i < 4; i++) backoff.getNextDelaySeconds();
    expect(backoff.getNextDelaySeconds()).toBe(16);
    expect(backoff.currentAttempt).toBe(5);
  });

  it('6. step 6 delay is 30s', () => {
    const backoff = new ReconnectBackoff();
    for (let i = 0; i < 5; i++) backoff.getNextDelaySeconds();
    expect(backoff.getNextDelaySeconds()).toBe(30);
    expect(backoff.currentAttempt).toBe(6);
  });

  it('7. step 7 and beyond remain capped at 30s', () => {
    const backoff = new ReconnectBackoff();
    for (let i = 0; i < 6; i++) backoff.getNextDelaySeconds();
    expect(backoff.getNextDelaySeconds()).toBe(30);
    expect(backoff.getNextDelaySeconds()).toBe(30);
    expect(backoff.currentAttempt).toBe(8);
  });

  it('8. reset restores delay back to 1s', () => {
    const backoff = new ReconnectBackoff();
    for (let i = 0; i < 6; i++) backoff.getNextDelaySeconds();
    expect(backoff.getNextDelaySeconds()).toBe(30);
    backoff.reset();
    expect(backoff.currentAttempt).toBe(0);
    expect(backoff.getNextDelaySeconds()).toBe(1);
  });
});

describe('T-06: NativeConnectionManager & K-11 Duplicate Port Prevention', () => {
  function createMockPort(): NativePortLike & { disconnectTrigger: () => void } {
    let disconnectCb: (() => void) | null = null;
    return {
      postMessage: vi.fn(),
      onMessage: {
        addListener: vi.fn(),
      },
      onDisconnect: {
        addListener: (cb: () => void) => {
          disconnectCb = cb;
        },
      },
      disconnectTrigger: () => {
        if (disconnectCb) disconnectCb();
      },
    };
  }

  it('K-11 Guard: calling connect() while port is alive does NOT open a second port', () => {
    let connectCount = 0;
    const mockPort = createMockPort();
    const platform = new TestPlatformAdapter();
    const bridge = new NativeBridge({ platformAdapter: platform });

    const manager = new NativeConnectionManager({
      platformAdapter: platform,
      bridge,
      connectNativeFn: () => {
        connectCount++;
        return mockPort;
      },
    });

    const port1 = manager.connect();
    expect(connectCount).toBe(1);
    expect(port1).toBe(mockPort);
    expect(manager.isPortAlive()).toBe(true);

    // Second connect while first is alive
    const port2 = manager.connect();
    expect(connectCount).toBe(1); // STILL 1! No second port opened
    expect(port2).toBe(mockPort);
  });

  it('Healthy connection resets backoff to 1s (K-10)', async () => {
    vi.useFakeTimers();
    try {
      const mockPort = createMockPort();
      const platform = new TestPlatformAdapter();
      const bridge = new NativeBridge({ platformAdapter: platform });

      const manager = new NativeConnectionManager({
        platformAdapter: platform,
        bridge,
        connectNativeFn: () => mockPort,
        healthyDelayMs: 500,
      });

      // Simulate 3 failures first to increase backoff
      const backoff = manager.getBackoff();
      backoff.getNextDelaySeconds(); // 1
      backoff.getNextDelaySeconds(); // 2
      backoff.getNextDelaySeconds(); // 4
      expect(backoff.currentAttempt).toBe(3);

      // Now connect healthy
      manager.connect();
      expect(backoff.currentAttempt).toBe(3);

      // Fast forward past healthy threshold
      vi.advanceTimersByTime(600);

      // Backoff should now be reset!
      expect(backoff.currentAttempt).toBe(0);
      expect(backoff.getNextDelaySeconds()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Disconnect triggers backoff and allows reconnect after failure', () => {
    const mockPort1 = createMockPort();
    const mockPort2 = createMockPort();
    let currentPort = mockPort1;
    let connectCount = 0;

    const platform = new TestPlatformAdapter();
    const bridge = new NativeBridge({ platformAdapter: platform });

    const manager = new NativeConnectionManager({
      platformAdapter: platform,
      bridge,
      connectNativeFn: () => {
        connectCount++;
        return currentPort;
      },
    });

    manager.connect();
    expect(connectCount).toBe(1);
    expect(manager.isPortAlive()).toBe(true);

    // Disconnect port 1
    mockPort1.disconnectTrigger();
    expect(manager.isPortAlive()).toBe(false);
    expect(manager.getLastDisconnectReason()).toBe('Native port disconnected');

    // After disconnect, reconnecting works and opens a new port
    currentPort = mockPort2;
    manager.connect();
    expect(connectCount).toBe(2);
    expect(manager.isPortAlive()).toBe(true);
    expect(manager.getCurrentPort()).toBe(mockPort2);
  });
});
