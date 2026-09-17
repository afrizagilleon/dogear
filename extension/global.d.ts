/**
 * extension/global.d.ts
 * Global build-time constant declarations.
 *
 * __MEASURE_DISABLE_BACKOFF__ is defined by wxt.config.ts via Vite's `define` mechanism.
 * In production builds it is always `false` (dead-code eliminated by the bundler).
 * Only measurement builds (DISABLE_BACKOFF=1 env) set it to `true` to isolate
 * the chrome.alarms reconnect path from the onDisconnect backoff path (OQ-3, A2-T01).
 */
declare const __MEASURE_DISABLE_BACKOFF__: boolean;
