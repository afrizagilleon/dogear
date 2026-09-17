/**
 * extension/kernel/compiler.ts
 * Cell code compilation and wrapping (D-2, RQ-04, INV-7).
 *
 * NOTE ON CSP & BLOB COMPILATION (INV-7):
 * D-2: Blob URL dynamic import (previously used in src/compile.ts) is permanently abandoned
 * because it is completely blocked in USER_SCRIPT world (cDynBlob: false across all 8 policies)
 * and subjected to strict page CSP in MAIN world.
 *
 * The new kernel compiles cell source directly into an executable function wrapper expression
 * that executes synchronously within the target execution world without blob URLs.
 */

import type { KernelCell } from './types';

// The wrapper adds 1 header line before user's cell code:
// Line 1: (async function(api) { const { ctx, print } = api;
// Line 2..N: <user source>
// Line N+1: })
export const CELL_WRAPPER_HEADER_LINES = 2;

export function compileCellSource(cell: KernelCell): string {
  const cellIdentifier = `nb-cell-${cell.name || cell.id}.js`;
  return `(async function(api) {\nconst { ctx, print } = api;\n${cell.source}\n})\n//# sourceURL=${cellIdentifier}`;
}
