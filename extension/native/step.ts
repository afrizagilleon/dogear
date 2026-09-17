/**
 * extension/native/step.ts
 * Step message construction, 1st-level dataDiff, evidence collation, and K-8 truncation (T-05, RQ-03, RQ-04, RQ-05, RQ-06, K-7, K-8, INV-22).
 */

import type { StepDataDiff, StepEvidence, StepMessage } from './types';
import type { SerializedError } from '../shared/types';
import { utf8ByteLength } from './frame-out';

export const DEFAULT_DIFF_MAX_BYTES = 50_000;
export const DEFAULT_DOM_SNIPPET_MAX_BYTES = 50_000;

/**
 * Computes 1st-level dataDiff of ctx.data before vs after step execution (K-7, RQ-04).
 * Enforces UTF-8 byte measurement (INV-22) and sets truncated: true with originalBytes on overflow (K-8).
 */
export function computeDataDiff(
  before: Record<string, unknown> = {},
  after: Record<string, unknown> = {},
  maxBytes: number = DEFAULT_DIFF_MAX_BYTES
): StepDataDiff {
  const added: Record<string, unknown> = {};
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  const removed: string[] = [];

  const safeBefore = before && typeof before === 'object' ? before : {};
  const safeAfter = after && typeof after === 'object' ? after : {};

  const beforeKeys = Object.keys(safeBefore);
  const afterKeys = Object.keys(safeAfter);

  for (const key of afterKeys) {
    if (!Object.prototype.hasOwnProperty.call(safeBefore, key)) {
      added[key] = safeAfter[key];
    } else {
      const bVal = safeBefore[key];
      const aVal = safeAfter[key];
      if (!deepEquals(bVal, aVal)) {
        changed[key] = { from: bVal, to: aVal };
      }
    }
  }

  for (const key of beforeKeys) {
    if (!Object.prototype.hasOwnProperty.call(safeAfter, key)) {
      removed.push(key);
    }
  }

  const diff: StepDataDiff = { added, changed, removed };
  const json = JSON.stringify(diff);
  const totalBytes = utf8ByteLength(json);

  if (totalBytes > maxBytes) {
    // Truncate large string values in added and changed
    const truncatedAdded: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(added)) {
      if (typeof v === 'string' && utf8ByteLength(v) > 1000) {
        truncatedAdded[k] = v.slice(0, 500) + '...[TRUNCATED]';
      } else {
        truncatedAdded[k] = v;
      }
    }

    const truncatedChanged: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, { from, to }] of Object.entries(changed)) {
      const tFrom = typeof from === 'string' && utf8ByteLength(from) > 1000 ? from.slice(0, 500) + '...[TRUNCATED]' : from;
      const tTo = typeof to === 'string' && utf8ByteLength(to) > 1000 ? to.slice(0, 500) + '...[TRUNCATED]' : to;
      truncatedChanged[k] = { from: tFrom, to: tTo };
    }

    return {
      added: truncatedAdded,
      changed: truncatedChanged,
      removed,
      truncated: true,
      originalBytes: totalBytes,
    };
  }

  return diff;
}

/**
 * Truncates domSnippet if it exceeds maxBytes in UTF-8 (K-8, INV-22).
 */
export function truncateDomSnippet(
  snippet: string,
  maxBytes: number = DEFAULT_DOM_SNIPPET_MAX_BYTES
): { domSnippet: string; truncated?: boolean; originalBytes?: number } {
  const totalBytes = utf8ByteLength(snippet);
  if (totalBytes <= maxBytes) {
    return { domSnippet: snippet };
  }

  // Truncate to approximately fit under maxBytes while respecting codepoints
  let byteCount = 0;
  let cutIndex = 0;
  for (let i = 0; i < snippet.length; ) {
    const cp = snippet.codePointAt(i);
    if (cp === undefined) break;
    const cpBytes = cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
    if (byteCount + cpBytes > maxBytes - 100) {
      break;
    }
    byteCount += cpBytes;
    cutIndex = i + (cp > 0xffff ? 2 : 1);
    i = cutIndex;
  }

  const truncatedSnippet = snippet.slice(0, cutIndex) + '...<!-- [TRUNCATED] -->';
  return {
    domSnippet: truncatedSnippet,
    truncated: true,
    originalBytes: totalBytes,
  };
}

/**
 * Constructs a single StepMessage for completed, failed, or skipped step (K-3, RQ-03).
 */
export function createStepMessage(options: {
  runId: string;
  cellId: string;
  state: 'ok' | 'failed' | 'skipped';
  durationMs: number;
  candidateHit: number | null;
  candidatesTried?: string[];
  dataDiff: StepDataDiff;
  evidence: StepEvidence;
  error?: SerializedError;
}): StepMessage {
  // INV-23 / K-2: candidateHit pada state: 'failed' selalu null sebagai invarian.
  const candidateHit = options.state === 'failed' ? null : options.candidateHit;

  return {
    type: 'step',
    runId: options.runId,
    cellId: options.cellId,
    state: options.state,
    durationMs: options.durationMs,
    candidateHit,
    candidatesTried: options.candidatesTried ?? [],
    dataDiff: options.dataDiff,
    evidence: options.evidence,
    error: options.error,
  };
}

function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
