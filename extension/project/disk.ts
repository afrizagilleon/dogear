/**
 * extension/project/disk.ts
 * Disk-backed ProjectStore implementation using File System Access API (showDirectoryPicker) (RQ-10).
 */

import type { ProjectFileEntry, ProjectStore } from '../platform/interface';
import { normalizeProjectPath } from './memory';

export class DiskProjectStore implements ProjectStore {
  readonly kind = 'disk' as const;
  private rootHandle: FileSystemDirectoryHandle | null;

  constructor(rootHandle: FileSystemDirectoryHandle | null = null) {
    this.rootHandle = rootHandle;
  }

  setRootHandle(handle: FileSystemDirectoryHandle): void {
    this.rootHandle = handle;
  }

  getRootHandle(): FileSystemDirectoryHandle | null {
    return this.rootHandle;
  }

  async queryPermission(mode: 'read' | 'readwrite' = 'readwrite'): Promise<PermissionState> {
    if (!this.rootHandle) return 'denied';
    const handleWithPerm = this.rootHandle as unknown as {
      queryPermission?: (opts: { mode: string }) => Promise<PermissionState>;
    };
    if (handleWithPerm.queryPermission) {
      return await handleWithPerm.queryPermission({ mode });
    }
    return 'prompt';
  }

  async requestPermission(mode: 'read' | 'readwrite' = 'readwrite'): Promise<PermissionState> {
    if (!this.rootHandle) return 'denied';
    const handleWithPerm = this.rootHandle as unknown as {
      requestPermission?: (opts: { mode: string }) => Promise<PermissionState>;
    };
    if (handleWithPerm.requestPermission) {
      return await handleWithPerm.requestPermission({ mode });
    }
    return 'prompt';
  }

  private async getFileHandle(
    path: string,
    create = false
  ): Promise<FileSystemFileHandle> {
    if (!this.rootHandle) {
      throw new Error('DiskProjectStore: No directory handle open. Call showDirectoryPicker first.');
    }
    const clean = normalizeProjectPath(path);
    const parts = clean.split('/').filter(Boolean);
    if (parts.length === 0) {
      throw new Error(`Invalid file path: '${path}'`);
    }

    let dir = this.rootHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i], { create });
    }
    return await dir.getFileHandle(parts[parts.length - 1], { create });
  }

  async readFile(path: string): Promise<string> {
    const handle = await this.getFileHandle(path, false);
    const file = await handle.getFile();
    return await file.text();
  }

  async writeFile(path: string, content: string): Promise<void> {
    const handle = await this.getFileHandle(path, true);
    const writable = await (handle as unknown as { createWritable: () => Promise<FileSystemWritableFileStream> }).createWritable();
    await writable.write(content);
    await writable.close();
  }

  async deleteFile(path: string): Promise<void> {
    if (!this.rootHandle) return;
    const clean = normalizeProjectPath(path);
    const parts = clean.split('/').filter(Boolean);
    if (parts.length === 0) return;

    let dir = this.rootHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      try {
        dir = await dir.getDirectoryHandle(parts[i], { create: false });
      } catch {
        return;
      }
    }
    try {
      await dir.removeEntry(parts[parts.length - 1]);
    } catch {}
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.getFileHandle(path, false);
      return true;
    } catch {
      return false;
    }
  }

  async listFiles(prefix = ''): Promise<ProjectFileEntry[]> {
    if (!this.rootHandle) return [];
    const normPrefix = prefix ? normalizeProjectPath(prefix) : '';
    const entries: ProjectFileEntry[] = [];

    const traverse = async (dir: FileSystemDirectoryHandle, currentPath: string) => {
      // @ts-expect-error FileSystemDirectoryHandle async iterable in browser
      for await (const [name, handle] of dir.entries()) {
        const itemPath = currentPath ? `${currentPath}/${name}` : name;
        if (handle.kind === 'file') {
          const file = await (handle as FileSystemFileHandle).getFile();
          entries.push({
            path: itemPath,
            size: file.size,
            mtime: file.lastModified,
            kind: 'file',
          });
        } else if (handle.kind === 'directory') {
          await traverse(handle as FileSystemDirectoryHandle, itemPath);
        }
      }
    };

    await traverse(this.rootHandle, '');
    if (!normPrefix) return entries;
    return entries.filter((e) => e.path.startsWith(normPrefix));
  }

  async getMtime(path: string): Promise<number | null> {
    try {
      const handle = await this.getFileHandle(path, false);
      const file = await handle.getFile();
      return file.lastModified;
    } catch {
      return null;
    }
  }
}
