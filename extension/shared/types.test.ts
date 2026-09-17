/**
 * extension/shared/types.test.ts
 * Real unit tests for step execution message validation protocol (RQ-04).
 */

import { describe, it, expect } from 'vitest';
import { isStepExecutionRequest, type StepExecutionRequest } from './types';

describe('isStepExecutionRequest', () => {
  it('validates a well-formed StepExecutionRequest object', () => {
    const validMessage: StepExecutionRequest = {
      action: 'EXECUTE_STEP',
      timestamp: 1787600000000,
      step: {
        id: 'step-123',
        code: 'console.log("hello");',
        status: 'idle',
      },
    };

    expect(isStepExecutionRequest(validMessage)).toBe(true);
  });

  it('rejects invalid action names', () => {
    const invalidAction = {
      action: 'UNKNOWN_ACTION',
      timestamp: 1787600000000,
      step: { id: 'step-1', code: '', status: 'idle' },
    };

    expect(isStepExecutionRequest(invalidAction)).toBe(false);
  });

  it('rejects non-object or null payloads', () => {
    expect(isStepExecutionRequest(null)).toBe(false);
    expect(isStepExecutionRequest(undefined)).toBe(false);
    expect(isStepExecutionRequest('string')).toBe(false);
    expect(isStepExecutionRequest(12345)).toBe(false);
  });

  it('rejects payload missing timestamp or step object', () => {
    const missingTimestamp = {
      action: 'EXECUTE_STEP',
      step: { id: 'step-1', code: '', status: 'idle' },
    };
    const missingStep = {
      action: 'EXECUTE_STEP',
      timestamp: 123456,
    };

    expect(isStepExecutionRequest(missingTimestamp)).toBe(false);
    expect(isStepExecutionRequest(missingStep)).toBe(false);
  });
});
