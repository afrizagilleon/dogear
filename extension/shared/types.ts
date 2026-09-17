/**
 * extension/shared/types.ts
 * Core types and protocols for dogear extension.
 * Pure type definitions and type guards with zero side effects (RQ-07).
 */

export type BrowserTarget = 'chrome' | 'firefox';

export type ExecutionStrategy = 'st1_userscripts_main' | 'st2_userscripts_user' | 'st3_blob_import' | 'st4_static_main' | 'st5_isolated_dom';

export type CellStatus = 'idle' | 'running' | 'success' | 'error';

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: string;
  action?: string;
  candidates?: string[];
}

export function serializeError(err: unknown): SerializedError {
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    const name = typeof obj.name === 'string' && obj.name ? obj.name : (err instanceof Error ? err.name : 'Error');
    const message = typeof obj.message === 'string'
      ? obj.message
      : (err instanceof Error ? err.message : String(obj.message ?? err));
    const stack = typeof obj.stack === 'string' ? obj.stack : (err instanceof Error ? err.stack : undefined);
    const cause = typeof obj.cause === 'string' ? obj.cause : (typeof obj.sebab === 'string' ? obj.sebab : undefined);
    const action = typeof obj.action === 'string' ? obj.action : (typeof obj.tindakan === 'string' ? obj.tindakan : undefined);
    const candidates = Array.isArray(obj.candidates) ? (obj.candidates as string[]) : undefined;
    const res: SerializedError = { name, message };
    if (stack) res.stack = stack;
    if (cause) res.cause = cause;
    if (action) res.action = action;
    if (candidates) res.candidates = candidates;
    return res;
  }
  return {
    name: 'Error',
    message: String(err ?? 'Unknown error'),
  };
}

export interface CellStep {
  readonly id: string;
  readonly code: string;
  readonly status: CellStatus;
  readonly output?: string;
  readonly error?: string;
}

export interface StepExecutionRequest {
  readonly action: 'EXECUTE_STEP';
  readonly step: CellStep;
  readonly timestamp: number;
}

export interface StepExecutionResponse {
  readonly success: boolean;
  readonly stepId: string;
  readonly result?: unknown;
  readonly error?: string;
  readonly timestamp: number;
}

export interface PlatformCapabilities {
  readonly hasSidePanel: boolean;
  readonly hasOffscreenDocument: boolean;
  readonly hasUserScripts: boolean;
}

/**
 * Type guard for StepExecutionRequest
 */
export function isStepExecutionRequest(msg: unknown): msg is StepExecutionRequest {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m.action === 'EXECUTE_STEP' && typeof m.timestamp === 'number' && typeof m.step === 'object' && m.step !== null;
}
