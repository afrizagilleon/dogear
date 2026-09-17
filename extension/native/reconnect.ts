/**
 * extension/native/reconnect.ts
 * Native messaging host connection manager, autonomous reconnection, and backoff scheduling (K-10, K-11, RQ-11).
 *
 * Enforces:
 * - K-10: Exponential backoff sequence: 1, 2, 4, 8, 16, 30, 30... seconds.
 *   Reset to 1s upon successful/healthy connection.
 * - K-11: Never connect while pipeline is running and port is alive; never open duplicate ports.
 * - INV-2 / Layer separation: Zero direct chrome.* calls in this file (platform-agnostic / injected).
 */

import { NATIVE_HOST_NAME, getPlatformAdapter } from '../platform';
import type { PlatformAdapter } from '../platform/interface';
import { nativeBridge, type NativeBridge, type ManifestLike, type NativePortLike } from './bridge';

export const BACKOFF_DELAYS_S = [1, 2, 4, 8, 16, 30] as const;

export class ReconnectBackoff {
  private attempt = 0;

  getNextDelaySeconds(): number {
    const idx = Math.min(this.attempt, BACKOFF_DELAYS_S.length - 1);
    const delay = BACKOFF_DELAYS_S[idx];
    this.attempt++;
    return delay;
  }

  getNextDelayMs(): number {
    return this.getNextDelaySeconds() * 1000;
  }

  reset(): void {
    this.attempt = 0;
  }

  get currentAttempt(): number {
    return this.attempt;
  }
}

export interface ConnectionManagerOptions {
  platformAdapter?: PlatformAdapter;
  bridge?: NativeBridge;
  hostName?: string;
  connectNativeFn?: (hostName: string) => NativePortLike;
  getLastErrorFn?: () => string | undefined;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (id: unknown) => void;
  healthyDelayMs?: number;
  onLog?: (msg: string, ...args: unknown[]) => void;
}

export class NativeConnectionManager {
  private platform: PlatformAdapter;
  private bridge: NativeBridge;
  private hostName: string;
  private currentPort: NativePortLike | null = null;
  private isConnected = false;
  private backoff = new ReconnectBackoff();
  private reconnectTimer: unknown = null;
  private healthyTimer: unknown = null;
  private lastDisconnectReason: string | null = null;
  private connectNativeFn?: (hostName: string) => NativePortLike;
  private getLastErrorFn?: () => string | undefined;
  private setTimeoutFn: (fn: () => void, ms: number) => unknown;
  private clearTimeoutFn: (id: unknown) => void;
  private healthyDelayMs: number;
  private onLog?: (msg: string, ...args: unknown[]) => void;

  constructor(options?: ConnectionManagerOptions) {
    this.platform = options?.platformAdapter || getPlatformAdapter();
    this.bridge = options?.bridge || nativeBridge;
    this.hostName = options?.hostName || NATIVE_HOST_NAME;
    this.connectNativeFn = options?.connectNativeFn;
    this.getLastErrorFn = options?.getLastErrorFn;
    this.setTimeoutFn = options?.setTimeoutFn || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutFn = options?.clearTimeoutFn || ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
    this.healthyDelayMs = options?.healthyDelayMs ?? 1000;
    this.onLog = options?.onLog;
  }

  isPortAlive(): boolean {
    return this.isConnected && this.currentPort !== null;
  }

  getBackoff(): ReconnectBackoff {
    return this.backoff;
  }

  getLastDisconnectReason(): string | null {
    return this.lastDisconnectReason;
  }

  getCurrentPort(): NativePortLike | null {
    return this.currentPort;
  }

  connect(portOptions?: { manifest?: ManifestLike; runtimeId?: string; disconnectReason?: string }): NativePortLike | null {
    // K-11 Guard: Never open a second port while an active port is already alive
    if (this.isPortAlive()) {
      this.log('[reconnect] Port already alive, ignoring connect request (K-11)');
      return this.currentPort;
    }

    // Clear any scheduled reconnect timer
    if (this.reconnectTimer) {
      this.clearTimeoutFn(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      this.log('[reconnect] Connecting to native host:', this.hostName);
      const port = this.connectNativeFn
        ? this.connectNativeFn(this.hostName)
        : this.platform.connectNative(this.hostName);

      this.currentPort = port;
      this.isConnected = true;

      // Attach port to bridge (which emits hello frame per RQ-01)
      this.bridge.attachPort(port, portOptions);

      // Healthy timer: if port survives healthyDelayMs without disconnecting, reset backoff (K-10)
      if (this.healthyTimer) this.clearTimeoutFn(this.healthyTimer);
      this.healthyTimer = this.setTimeoutFn(() => {
        if (this.isPortAlive()) {
          this.log('[reconnect] Port connection healthy, resetting backoff (K-10)');
          this.backoff.reset();
        }
      }, this.healthyDelayMs);

      // Hook disconnect listener
      if (port.onDisconnect?.addListener) {
        port.onDisconnect.addListener(() => {
          const reason = this.getLastErrorFn ? this.getLastErrorFn() : undefined;
          this.handleDisconnect(reason);
        });
      }

      return port;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log('[reconnect] connectNative failed:', msg);
      this.handleDisconnect(msg);
      return null;
    }
  }

  handleDisconnect(reason?: string): void {
    if (!this.isConnected && this.currentPort === null) {
      return;
    }

    if (this.healthyTimer) {
      this.clearTimeoutFn(this.healthyTimer);
      this.healthyTimer = null;
    }

    const disconnectReason = reason || 'Native port disconnected';
    this.lastDisconnectReason = disconnectReason;
    this.isConnected = false;
    this.currentPort = null;

    this.log(`[reconnect] Native port disconnected (reason: ${disconnectReason})`);

    // K-10: schedule reconnect with exponential backoff
    // __MEASURE_DISABLE_BACKOFF__ is a build-time constant (always false in production builds,
    // dead-code eliminated by the bundler). Set to true only in measurement builds to isolate
    // the alarm reconnect path for OQ-3 measurement (A2-T01).
    if (
      typeof __MEASURE_DISABLE_BACKOFF__ !== 'undefined' &&
      __MEASURE_DISABLE_BACKOFF__
    ) {
      this.log('[reconnect] Backoff reconnect disabled by build constant (measurement mode)');
      return;
    }

    const delayS = this.backoff.getNextDelaySeconds();
    this.log(`[reconnect] Scheduling next reconnect in ${delayS}s (attempt ${this.backoff.currentAttempt})`);

    if (this.reconnectTimer) this.clearTimeoutFn(this.reconnectTimer);
    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayS * 1000);
  }

  cancelScheduledReconnect(): void {
    if (this.reconnectTimer) {
      this.clearTimeoutFn(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private log(msg: string, ...args: unknown[]): void {
    if (this.onLog) {
      this.onLog(msg, ...args);
    } else {
      console.log(msg, ...args);
    }
  }
}

export const nativeConnectionManager = new NativeConnectionManager();
