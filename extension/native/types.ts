/**
 * extension/native/types.ts
 * Type definitions and protocol schemas for the native messaging bridge (D-1, D-2, D-3, D-8, RQ-01, RQ-08).
 * Exactly four final states: completed | skipped | needs_review | session_dead (INV-8, D-1).
 */

import type { SerializedError } from '../shared/types';

export type TerminalState = 'completed' | 'skipped' | 'needs_review' | 'session_dead';

export interface CellOutcomeSignal {
  status: TerminalState;
  reason?: string;
  data?: Record<string, unknown>;
}

export interface RunOutcome {
  state: TerminalState;
  runId?: string;
  reason?: string;
  data?: Record<string, unknown>;
  error?: SerializedError;
  lastSuccessCellId?: string | null;
  executedCellIds?: string[];
  candidateIndex?: number;
  candidateMatches?: Array<{
    cellId?: string;
    index: number;
    candidateIndex: number;
    candidate: string;
    candidates: string[];
  }>;
}

export function isCellOutcomeSignal(val: unknown): val is CellOutcomeSignal {
  if (!val || typeof val !== 'object') return false;
  const obj = val as Record<string, unknown>;
  return (
    obj.status === 'completed' ||
    obj.status === 'skipped' ||
    obj.status === 'needs_review' ||
    obj.status === 'session_dead'
  );
}

/**
 * Messages from the host to dogear (D-1, D-2, RQ-02)
 */
export type HostMessage =
  | {
      action: 'run';
      runId?: string;
      notebook_id?: string;
      version?: string;
      params?: Record<string, unknown>;
      notebook?: string; // Markdown content of notebook.md
      files?: Record<string, string>; // Associated step files
      tabId?: number;
    }
  | {
      action: 'cancel';
      runId?: string;
    }
  | {
      action: 'status';
    };

export type HelloMessage = {
  type: 'hello';
  build: 'studio' | 'runtime';
  extVersion: string;
  profileHint?: string;
};

export interface StepDataDiff {
  added: Record<string, unknown>;
  changed: Record<string, { from: unknown; to: unknown }>;
  removed: string[];
  truncated?: boolean;
  originalBytes?: number;
}

export interface StepEvidence {
  url: string;
  domSnippet: string;
  anchor?: string;
  truncated?: boolean;
  originalBytes?: number;
  screenshot?: {
    part?: number;
    parts?: number;
    jpegBase64: string;
  };
}

export interface StepMessage {
  type: 'step';
  runId: string;
  cellId: string;
  state: 'ok' | 'failed' | 'skipped';
  durationMs: number;
  candidateHit: number | null;
  candidatesTried?: string[];
  dataDiff: StepDataDiff;
  evidence: StepEvidence;
  error?: SerializedError;
}

/**
 * Messages from dogear to the host (D-1, D-2, D-3, RQ-01, RQ-03)
 */
export type DogearMessage =
  | HelloMessage
  | StepMessage
  | ({
      type: 'outcome';
    } & RunOutcome)
  | {
      type: 'progress';
      cellId: string;
      status: string;
      percent?: number;
      candidateIndex?: number;
      runId?: string;
    }
  | {
      type: 'status';
      state: 'idle' | 'running' | 'halted';
      activeNotebook?: string;
      runs?: Array<{ runId: string; tabId: number; notebookId: string }>;
    };
