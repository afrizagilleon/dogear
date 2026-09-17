/**
 * extension/project/opfs.ts
 * Origin Private File System (OPFS) implementation of ProjectStore (RQ-01, RQ-02, RQ-03, D-1, D-2).
 * Operates in standard browser extension/page context without requiring user permissions or gestures.
 */

import type { ProjectFileEntry, ProjectStore } from '../platform/interface';
import { normalizeProjectPath } from './memory';

function isMissingEntry(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = 'name' in err ? String(err.name) : '';
  if (name === 'NotFoundError' || name === 'NotFound') return true;
  const message = 'message' in err ? String(err.message) : String(err);
  return /not found|tidak ditemukan|Directory not found/i.test(message);
}

export class OpfsProjectStore implements ProjectStore {
  readonly kind = 'opfs' as const;
  private rootDirPromise: Promise<FileSystemDirectoryHandle> | null = null;

  constructor(private rootHandle?: FileSystemDirectoryHandle) {}

  private async getRoot(): Promise<FileSystemDirectoryHandle> {
    if (this.rootHandle) return this.rootHandle;
    if (!this.rootDirPromise) {
      if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
        throw new Error('OPFS is not supported in this environment (navigator.storage.getDirectory is undefined).');
      }
      this.rootDirPromise = navigator.storage.getDirectory();
    }
    return this.rootDirPromise;
  }

  private splitPath(path: string): { dirParts: string[]; fileName: string } {
    const norm = normalizeProjectPath(path);
    if (!norm) {
      throw new Error('Project path cannot be empty');
    }
    const parts = norm.split('/');
    const fileName = parts.pop()!;
    return { dirParts: parts, fileName };
  }

  private async resolveDir(dirParts: string[], create = false): Promise<FileSystemDirectoryHandle> {
    let current = await this.getRoot();
    for (const part of dirParts) {
      try {
        current = await current.getDirectoryHandle(part, { create });
      } catch (err: unknown) {
        throw new Error(`Directory not found: '${dirParts.join('/')}' (${String(err)})`);
      }
    }
    return current;
  }

  async readFile(path: string): Promise<string> {
    const norm = normalizeProjectPath(path);
    const { dirParts, fileName } = this.splitPath(norm);
    try {
      const dirHandle = await this.resolveDir(dirParts, false);
      const fileHandle = await dirHandle.getFileHandle(fileName, { create: false });
      const file = await fileHandle.getFile();
      return await file.text();
    } catch {
      throw new Error(`File not found: '${norm}' tidak ditemukan di OPFS project store.`);
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    const norm = normalizeProjectPath(path);
    const { dirParts, fileName } = this.splitPath(norm);
    const dirHandle = await this.resolveDir(dirParts, true);
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  async deleteFile(path: string): Promise<void> {
    const norm = normalizeProjectPath(path);
    const { dirParts, fileName } = this.splitPath(norm);
    try {
      const dirHandle = await this.resolveDir(dirParts, false);
      await dirHandle.removeEntry(fileName);
    } catch (err: unknown) {
      if (isMissingEntry(err)) return;
      throw err;
    }
  }

  async exists(path: string): Promise<boolean> {
    const norm = normalizeProjectPath(path);
    if (!norm) return false;
    const { dirParts, fileName } = this.splitPath(norm);
    try {
      const dirHandle = await this.resolveDir(dirParts, false);
      const fileHandle = await dirHandle.getFileHandle(fileName, { create: false });
      await fileHandle.getFile();
      return true;
    } catch {
      return false;
    }
  }

  async listFiles(prefix?: string): Promise<ProjectFileEntry[]> {
    const normPrefix = prefix ? normalizeProjectPath(prefix) : '';
    const root = await this.getRoot();
    const entries: ProjectFileEntry[] = [];

    async function walk(dir: FileSystemDirectoryHandle, currentPath: string): Promise<void> {
      // Use entries() on FileSystemDirectoryHandle
      for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        const itemPath = currentPath ? `${currentPath}/${name}` : name;
        if (handle.kind === 'file') {
          const file = await (handle as FileSystemFileHandle).getFile();
          entries.push({
            path: itemPath,
            kind: 'file',
            size: file.size,
            mtime: file.lastModified,
          });
        } else if (handle.kind === 'directory') {
          await walk(handle as FileSystemDirectoryHandle, itemPath);
        }
      }
    }

    await walk(root, '');

    return entries
      .filter((e) => !normPrefix || e.path.startsWith(normPrefix))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async clear(): Promise<void> {
    const root = await this.getRoot();
    for await (const [name] of (root as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      await root.removeEntry(name, { recursive: true });
    }
  }
}
