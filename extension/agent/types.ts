/**
 * extension/agent/types.ts
 * Agent protocol and run record types (D-2, D-3, D-4, RQ-02, RQ-03, RQ-04, RQ-05).
 */

import type { SerializedError } from '../shared/types';

export interface RunRecord {
  stepId: string;
  startedAt: string;
  completedAt: string;
  status: 'ok' | 'error';
  result?: unknown;
  output: string;
  error?: SerializedError | null;
  host: string;
  candidateIndex?: number;
  candidateMatch?: {
    index: number;
    candidateIndex: number;
    candidate: string;
    candidates: string[];
    elapsedMs?: number;
  };
}

export interface AgentStepRequest {
  stepId: string;
  host?: string;
  tabId?: number;
  data?: Record<string, unknown>;
}
