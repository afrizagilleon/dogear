/**
 * extension/shared/constants.ts
 * Shared constants for dogear extension.
 * Pure immutable constants with zero side effects (RQ-07).
 */

export const PROTOCOL_VERSION = '1.0.0' as const;

export const STORAGE_KEYS = {
  EXECUTION_STATE: 'nbs_exec_state',
  SETTINGS: 'nbs_settings',
  WORKSPACE_HANDLE: 'nbs_workspace_handle',
} as const;

export const CHANNELS = {
  RUNTIME_MESSAGE: 'nbs_runtime_message',
  PORT_STEP_RUNNER: 'nbs_step_runner_port',
} as const;
