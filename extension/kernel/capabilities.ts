/**
 * extension/kernel/capabilities.ts
 * Capability requirement declarations and expressive failure diagnostics (D-3, D-4, RQ-08, RQ-09).
 */

import type { KernelCell } from './types';

export interface SiteCapabilityContext {
  cspHeader?: string | null;
  isScriptBlockedByCsp?: boolean;
}

export class KernelCapabilityError extends Error {
  readonly cspPolicy: string;
  readonly missingCapability: string;
  readonly userAction: string;

  constructor(options: {
    cspPolicy: string;
    missingCapability: string;
    userAction: string;
  }) {
    const fullMessage = [
      '✖ KernelCapabilityError: Kebutuhan cell tidak dapat dipenuhi pada lingkungan halaman saat ini.',
      `  [1] Kebijakan CSP situs: ${options.cspPolicy}`,
      `  [2] Kapabilitas yang kurang: ${options.missingCapability}`,
      `  [3] Tindakan pengguna yang disarankan: ${options.userAction}`,
    ].join('\n');

    super(fullMessage);
    this.name = 'KernelCapabilityError';
    this.cspPolicy = options.cspPolicy;
    this.missingCapability = options.missingCapability;
    this.userAction = options.userAction;
  }
}

export function validateCellCapabilities(
  cell: KernelCell,
  siteCaps?: SiteCapabilityContext
): { ok: true } | { ok: false; error: KernelCapabilityError } {
  // Default aman (D-3): jika cell tidak menyatakan deklarasi khusus, eksekusi diizinkan
  if (!cell.needsPageContext) {
    return { ok: true };
  }

  // Jika cell menyatakan butuh JS halaman (needsPageContext: true)
  // dan CSP situs memblokir skrip halaman (mis. script-src 'none' di p5)
  if (siteCaps?.isScriptBlockedByCsp) {
    const cspPolicy = siteCaps.cspHeader ? `"${siteCaps.cspHeader}"` : '"script-src \'none\'" (halaman tidak mengizinkan skrip)';
    const missingCapability = 'Akses konteks/variabel JavaScript halaman utama (needsPageContext)';
    const userAction = 'Nonaktifkan deklarasi needsPageContext jika hanya memerlukan interaksi DOM murni, atau jalankan pada halaman yang mengizinkan eksekusi JavaScript.';

    return {
      ok: false,
      error: new KernelCapabilityError({
        cspPolicy,
        missingCapability,
        userAction,
      }),
    };
  }

  return { ok: true };
}
