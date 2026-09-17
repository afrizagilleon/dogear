/**
 * extension/native/outcome.ts
 * Evaluation and resolution of the four terminal execution states (D-1, D-2, D-3, RQ-01, RQ-04).
 * Exactly four final states: completed | skipped | needs_review | session_dead.
 * If runtime encounters an unexpected anomaly -> defaults strictly to 'needs_review' (never 5th state).
 */

import { serializeError } from '../shared/types';
import type { TerminalState, CellOutcomeSignal, RunOutcome } from './types';
import { isCellOutcomeSignal } from './types';

/**
 * Normalizes any cell evaluation result into a structured outcome signal.
 */
export function evaluateCellOutcome(result: unknown): CellOutcomeSignal {
  if (isCellOutcomeSignal(result)) {
    return {
      status: result.status,
      reason: result.reason,
      data: result.data,
    };
  }

  // Plain return value -> default to 'completed'
  return {
    status: 'completed',
    data: result !== undefined && result !== null && typeof result === 'object'
      ? (result as Record<string, unknown>)
      : undefined,
  };
}

/**
 * Maps an execution failure, thrown exception, or unexpected condition to exactly 'needs_review' (D-1, D-2, RQ-04).
 */
export function mapFailureToOutcome(error: unknown, fallbackMessage?: string): RunOutcome {
  const serialized = serializeError(error);
  const reason = serialized.message || fallbackMessage || 'Kegagalan eksekusi tidak terduga';

  return {
    state: 'needs_review',
    reason,
    error: serialized,
  };
}

/**
 * Resolves a successful execution signal to final response.
 * Handles 'session_dead' as a first-class result on the result channel (D-3).
 */
export function mapSignalToOutcome(
  signal: CellOutcomeSignal,
  lastSuccessCellId: string | null = null,
  executedCellIds: string[] = []
): RunOutcome {
  // Validate strictly to four states
  const validStates: Record<TerminalState, true> = {
    completed: true,
    skipped: true,
    needs_review: true,
    session_dead: true,
  };

  const state: TerminalState = validStates[signal.status] ? signal.status : 'needs_review';

  return {
    state,
    reason: signal.reason,
    data: signal.data,
    lastSuccessCellId,
    executedCellIds,
  };
}
