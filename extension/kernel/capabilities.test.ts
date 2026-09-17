/**
 * extension/kernel/capabilities.test.ts
 * Tests for capability requirement declarations and expressive diagnostics (D-3, D-4, RQ-08, RQ-09).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { kernelService } from './index';
import { setPlatformAdapterForTesting } from '../platform';
import { TestPlatformAdapter } from '../platform/test-adapter';

describe('T-07: Capability Declarations and Expressive Diagnostics', () => {
  beforeEach(() => {
    setPlatformAdapterForTesting(new TestPlatformAdapter());
  });

  // (a) Cell declaring needsPageContext on supporting CSP policy -> succeeds with correct value
  it('(a) cell declaring needsPageContext on supporting policy succeeds with correct value (RQ-08)', async () => {
    const cell = {
      id: 'cell-need-js',
      source: 'return 42;',
      needsPageContext: true,
    };

    const res = await kernelService.runCell(cell, {
      siteCapabilities: {
        cspHeader: "script-src 'self'",
        isScriptBlockedByCsp: false,
      },
    });

    expect(res.ok).toBe(true);
    expect(res.result).toBe(42);
    expect(res.output).toBe('42');
  });

  // (b) Cell declaring needsPageContext on restricting policy -> returns ok:false with 3-part diagnostic message
  it('(b) cell declaring needsPageContext on restricting policy fails with all 3 diagnostic parts (RQ-09, D-4)', async () => {
    const cell = {
      id: 'cell-blocked-js',
      source: 'return window.__pageSecret;',
      needsPageContext: true,
    };

    const res = await kernelService.runCell(cell, {
      siteCapabilities: {
        cspHeader: "script-src 'none'",
        isScriptBlockedByCsp: true,
      },
    });

    expect(res.ok).toBe(false);
    expect(res.error?.name).toBe('KernelCapabilityError');

    // Exact assertions verifying all 3 parts required by D-4:
    // [1] CSP situs
    expect(res.output).toContain("Kebijakan CSP situs: \"script-src 'none'\"");
    // [2] Kapabilitas yang kurang
    expect(res.output).toContain('Kapabilitas yang kurang: Akses konteks/variabel JavaScript halaman utama (needsPageContext)');
    // [3] Apa yang bisa dilakukan pengguna
    expect(res.output).toContain('Tindakan pengguna yang disarankan: Nonaktifkan deklarasi needsPageContext');
  });

  // (c) Cell without declaration -> safe default, does not throw
  it('(c) cell without requirement declaration runs under safe default without throwing (D-3)', async () => {
    const cell = {
      id: 'cell-no-decl',
      source: 'return 100;',
      // needsPageContext is omitted / undefined
    };

    const res = await kernelService.runCell(cell, {
      siteCapabilities: {
        cspHeader: "script-src 'none'",
        isScriptBlockedByCsp: true,
      },
    });

    // Without declaration, cell runs without throwing
    expect(res.ok).toBe(true);
    expect(res.result).toBe(100);
  });
});
