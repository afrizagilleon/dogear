/**
 * extension/kernel/errors.ts
 * Cell error formatting and stack line remapping (RQ-07, INV-7).
 * Adapted from src/errors.ts — preserves all comments and rationale.
 */

import { CELL_WRAPPER_HEADER_LINES } from './compiler';
import { type SerializedError, serializeError } from '../shared/types';

export { type SerializedError, serializeError };

// compile() wraps the cell source with lines before user's code, so stack line points higher than real one.
export const HEADER_LINES = CELL_WRAPPER_HEADER_LINES;

export interface ModuleLineMapEntry {
  filePath: string;
  startLine: number; // 1-indexed start line in combined user source
  endLine: number;   // 1-indexed end line in combined user source
  originalContent: string;
}

/**
 * Injected stack trace remapping function for cell execution realm (D-4, RQ-06, F-5 A-1).
 * Single source of truth interpolated into in-page execution templates in platform/chromium.ts.
 */
export const INJECTED_REMAP_STACK_SCRIPT = `
  function remapInPageStack(rawStack, lineMap, userCodeOffset) {
    if (!rawStack) return '';
    return rawStack.replace(/(nb-(?:cell|frame)[^\\s:)]*\\.js):(\\d+):(\\d+)/g, (_m, f, l, c) => {
      const userLine = Math.max(1, Number(l) - userCodeOffset);
      if (lineMap && lineMap.length > 0) {
        const match = lineMap.find((m) => userLine >= m.startLine && userLine <= m.endLine);
        if (match) {
          const modLine = Math.max(1, userLine - match.startLine + 1);
          return match.filePath + ':' + modLine + ':' + c;
        }
      }
      return f + ':' + userLine + ':' + c;
    });
  }
`;

/** Rewrite `nb-cell-*.js:LINE:COL` / `nb-frame-*.js:LINE:COL` back to the line the user wrote or module file (D-4, RQ-06). */
export function remapLines(text: string, lineMap?: ModuleLineMapEntry[]): string {
  return text.replace(
    /(nb-(?:cell|frame)[^\s:)]*\.js):(\d+):(\d+)/g,
    (_m, file, line, col) => {
      const userLine = Math.max(1, Number(line) - HEADER_LINES);
      if (lineMap && lineMap.length > 0) {
        const match = lineMap.find((m) => userLine >= m.startLine && userLine <= m.endLine);
        if (match) {
          const modLine = Math.max(1, userLine - match.startLine + 1);
          return `${match.filePath}:${modLine}:${col}`;
        }
      }
      return `${file}:${userLine}:${col}`;
    }
  );
}

/**
 * Render an error the way a person can act on it: name + message first, then only the
 * frames from the user's own cell, then the offending source line.
 *
 * The headline is built from err.name/err.message rather than taken from err.stack —
 * V8 prefixes the stack with "Name: message" but Firefox/Safari do not, and relying on
 * the stack silently drops the message on those engines.
 */
export function formatKernelError(err: unknown, source = '', lineMap?: ModuleLineMapEntry[]): string {
  const errObj = typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : null;
  const name = (errObj && typeof errObj.name === 'string' ? errObj.name : null) || 'Error';
  const msg = errObj && errObj.message != null ? String(errObj.message) : String(err);
  const head = `✖ ${name}: ${msg}`;

  let middle = '';
  const rawStack = errObj && typeof errObj.stack === 'string' ? remapLines(errObj.stack, lineMap) : '';
  if (rawStack) {
    let lines = rawStack.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length && lines[0].startsWith(name + ':')) lines = lines.slice(1); // V8 duplicate

    // Engine and extension internals are noise; keep the frames inside the user's own code or linked modules.
    const own = lines.filter((l) => /(?:nb-(?:cell|frame)[^\s:)]*\.js|[a-zA-Z0-9_\-\.\/]+\.(?:js|ts)):(\d+):/.test(l));
    const shown = (own.length ? own : lines.slice(0, 3)).map((l) => '  ' + l.trim());

    // Quote the offending source line — the fastest way to see what actually broke.
    const hit = /(?:nb-(?:cell|frame)[^\s:)]*\.js|([a-zA-Z0-9_\-\.\/]+\.(?:js|ts))):(\d+):/.exec(own[0] || '');
    let quoted = '';
    if (hit) {
      const matchedFile = hit[1];
      const lineNum = Number(hit[2]);
      if (matchedFile && lineMap) {
        const entry = lineMap.find((m) => m.filePath === matchedFile);
        if (entry) {
          const srcLine = entry.originalContent.split('\n')[lineNum - 1];
          if (srcLine != null) {
            quoted = `\n  ${lineNum} | ${srcLine}`;
          }
        }
      }
      if (!quoted && lineNum !== undefined && source) {
        const srcLine = source.split('\n')[lineNum - 1];
        if (srcLine != null) {
          quoted = `\n  ${lineNum} | ${srcLine}`;
        }
      }
    }
    middle = (shown.length ? '\n' + shown.join('\n') : '') + (quoted ? quoted : '');
  }

  const cause = (errObj && (errObj.cause || errObj.sebab))
    ? `\n  Sebab: ${String(errObj.cause || errObj.sebab)}`
    : `\n  Sebab: Eksepsi dilempar saat mengeksekusi step.`;
  const action = (errObj && (errObj.action || errObj.tindakan))
    ? `\n  Tindakan: ${String(errObj.action || errObj.tindakan)}`
    : `\n  Tindakan: Periksa logika pada kode step atau tangani error dengan blok try/catch.`;

  return head + middle + cause + action;
}

