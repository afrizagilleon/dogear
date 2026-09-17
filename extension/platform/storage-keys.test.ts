/**
 * extension/platform/storage-keys.test.ts
 * Enforces frozen storage key prefixes and schema identifiers (M19 T-05, Bite-test 1, §2.4, D-4).
 *
 * Freezes product storage keys to guarantee backward compatibility with user profiles.
 * Any modification of storage keys (e.g. nb:auto -> dogear:auto) will silently wipe user state.
 */

import { describe, it, expect } from 'vitest';
import { AUTO_SCHEMA_PREFIX, autoKey } from '../kernel/auto';
import { CHECKPOINT_SCHEMA_PREFIX, checkpointKey } from '../kernel/checkpoint';
import { REGISTRY_STORAGE_KEY } from '../registry';
import { SCRATCH_HISTORY_STORAGE_KEY, EMPTY_NOTICE_COLLAPSED_STORAGE_KEY } from '../ui/panel';

describe('T-05: Storage Keys Frozen Invariant (Bite-test 1, §2.4, D-4)', () => {
  it('preserves exact schema prefixes and keys without alteration', () => {
    // 1. Auto schema prefix must be strictly 'nb:auto'
    expect(AUTO_SCHEMA_PREFIX).toBe('nb:auto');
    expect(autoKey('app.example.com')).toBe('nb:auto:app.example.com');

    // 2. Checkpoint schema prefix must be strictly 'nb:checkpoint'
    expect(CHECKPOINT_SCHEMA_PREFIX).toBe('nb:checkpoint');
    expect(checkpointKey('sample-notebook')).toBe('nb:checkpoint:sample-notebook');

    // 3. Site registry key must be strictly 'nb:registry:sites'
    expect(REGISTRY_STORAGE_KEY).toBe('nb:registry:sites');

    // 4. Scratchpad history key must be strictly 'nb:scratch:history'
    expect(SCRATCH_HISTORY_STORAGE_KEY).toBe('nb:scratch:history');

    // 5. Empty notice collapsed key must be strictly 'nb:empty-notice:collapsed'
    expect(EMPTY_NOTICE_COLLAPSED_STORAGE_KEY).toBe('nb:empty-notice:collapsed');
  });

  it('rejects any renamed storage keys or non-nb prefixes', () => {
    // Regression check: Ensure none of the 5 storage keys use 'dogear' or non-nb prefixes
    const productKeys = [
      AUTO_SCHEMA_PREFIX,
      CHECKPOINT_SCHEMA_PREFIX,
      REGISTRY_STORAGE_KEY,
      SCRATCH_HISTORY_STORAGE_KEY,
      EMPTY_NOTICE_COLLAPSED_STORAGE_KEY,
    ];

    for (const key of productKeys) {
      expect(key.startsWith('nb:')).toBe(true);
      expect(key.startsWith('dogear:')).toBe(false);
      expect(key.startsWith('host:')).toBe(false);
      expect(key).not.toContain('dogear');
      expect(key).not.toContain('host');
    }
  });

  it('preserves shared constants STORAGE_KEYS shape', async () => {
    const { STORAGE_KEYS } = await import('../shared/constants');
    expect(STORAGE_KEYS.EXECUTION_STATE).toBe('nbs_exec_state');
    expect(STORAGE_KEYS.SETTINGS).toBe('nbs_settings');
    expect(STORAGE_KEYS.WORKSPACE_HANDLE).toBe('nbs_workspace_handle');
  });
});
