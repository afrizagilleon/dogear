/**
 * extension/project/disk.test.ts
 * Tests for DiskProjectStore permission flow and fallback handling (RQ-10).
 */

import { describe, it, expect } from 'vitest';
import { DiskProjectStore } from './disk';

describe('T-09: DiskProjectStore (RQ-10)', () => {
  it('returns denied when no directory handle is set', async () => {
    const store = new DiskProjectStore();
    expect(await store.queryPermission()).toBe('denied');
    expect(await store.requestPermission()).toBe('denied');
  });

  it('throws descriptive error when reading/writing without an active handle', async () => {
    const store = new DiskProjectStore();
    await expect(store.readFile('test.js')).rejects.toThrow('No directory handle open');
    await expect(store.writeFile('test.js', 'content')).rejects.toThrow('No directory handle open');
    expect(await store.exists('test.js')).toBe(false);
    expect(await store.listFiles()).toEqual([]);
  });

  it('queries and requests permission from underlying handle when present', async () => {
    let queriedMode = '';
    let requestedMode = '';

    const mockHandle = {
      kind: 'directory',
      name: 'my-project',
      queryPermission: async (opts: { mode: string }) => {
        queriedMode = opts.mode;
        return 'prompt' as PermissionState;
      },
      requestPermission: async (opts: { mode: string }) => {
        requestedMode = opts.mode;
        return 'granted' as PermissionState;
      },
    } as unknown as FileSystemDirectoryHandle;

    const store = new DiskProjectStore(mockHandle);
    expect(store.getRootHandle()).toBe(mockHandle);

    const queryRes = await store.queryPermission('readwrite');
    expect(queryRes).toBe('prompt');
    expect(queriedMode).toBe('readwrite');

    const reqRes = await store.requestPermission('readwrite');
    expect(reqRes).toBe('granted');
    expect(requestedMode).toBe('readwrite');
  });
});
