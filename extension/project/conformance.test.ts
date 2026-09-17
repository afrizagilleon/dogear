/**
 * extension/project/conformance.test.ts
 * Vitest runner executing the single canonical CONFORMANCE_TEST_CASES suite (D-1, F-1, F-2 A-1).
 * All ProjectStore implementations MUST be registered and executed.
 */

import { describe, it, beforeEach } from 'vitest';
import type { ProjectStore } from '../platform/interface';
import { CONFORMANCE_TEST_CASES } from './conformance';
import { MemoryProjectStore } from './memory';
import { DiskProjectStore } from './disk';
import { createMockDirectoryHandle } from './disk-mock';

export function runProjectStoreConformanceSuite(
  name: string,
  factory: () => Promise<ProjectStore> | ProjectStore,
  options?: { cleanup?: (store: ProjectStore) => Promise<void> | void }
) {
  describe(`ProjectStore Conformance Suite: ${name}`, () => {
    let store: ProjectStore;

    beforeEach(async () => {
      store = await factory();
      if (options?.cleanup) {
        await options.cleanup(store);
      }
    });

    for (const testCase of CONFORMANCE_TEST_CASES) {
      it(testCase.name, async () => {
        await testCase.run(store);
      });
    }
  });
}

// 1. MemoryProjectStore conformance suite (D-1, RQ-02)
runProjectStoreConformanceSuite('MemoryProjectStore', () => {
  return new MemoryProjectStore();
});

// 2. DiskProjectStore conformance suite via mock directory handle (F-2 A-1)
runProjectStoreConformanceSuite('DiskProjectStore (Mock FileSystemDirectoryHandle)', () => {
  const root = createMockDirectoryHandle('mock-project-root');
  return new DiskProjectStore(root);
});

// 3. OpfsProjectStore reporting: executed in browser Test 16, skipped in Node with explicit reason (INV-8, F-2)
describe('ProjectStore Conformance Suite: OpfsProjectStore', () => {
  it.skip(
    'skipped in Node: requires browser navigator.storage.getDirectory; verified in browser integration Test 16',
    () => {}
  );
});
