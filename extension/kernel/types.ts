/**
 * extension/kernel/types.ts
 * Kernel execution data types and result interfaces (RQ-04).
 * Adapted from legacy types without modifying src/.
 */

import type { SerializedError } from './errors';

export type ExecutionWorld = 'MAIN' | 'USER_SCRIPT';

export interface KernelCell {
  id: string;
  source: string;
  name?: string;
  world?: ExecutionWorld;
  needsPageContext?: boolean; // For D-3 / RQ-09 requirement declarations
  lineMap?: Array<{
    filePath: string;
    startLine: number;
    endLine: number;
    originalContent: string;
  }>;
}

export interface KernelRunResult {
  ok: boolean;
  result?: unknown;
  output: string;
  error?: SerializedError | null;
  aborted?: boolean;
  candidateIndex?: number;
  candidateMatch?: {
    index: number;
    candidateIndex: number;
    candidate: string;
    candidates: string[];
    elapsedMs?: number;
  };
}

export interface CellExecutionEnvironment {
  ctx: Record<string, unknown>;
  print: (...args: unknown[]) => void;
  [key: string]: unknown;
}
