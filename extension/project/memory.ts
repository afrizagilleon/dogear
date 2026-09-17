/**
 * extension/project/memory.ts
 * In-memory implementation of ProjectStore (RQ-01, RQ-02, D-1).
 */

import type { ProjectFileEntry, ProjectStore } from '../platform/interface';

export function normalizeProjectPath(input: string): string {
  let normalized = input.trim().replace(/\\/g, '/');
  // Strip leading ./ or /
  normalized = normalized.replace(/^(\.\/|\/)+/, '');
  // Clean redundant slashes
  normalized = normalized.replace(/\/+/g, '/');
  return normalized;
}

export class MemoryProjectStore implements ProjectStore {
  readonly kind = 'memory' as const;
  private files = new Map<string, { content: string; mtime: number }>();

  async readFile(path: string): Promise<string> {
    const norm = normalizeProjectPath(path);
    const file = this.files.get(norm);
    if (!file) {
      throw new Error(`File not found: '${norm}' tidak ditemukan di project store.`);
    }
    return file.content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const norm = normalizeProjectPath(path);
    this.files.set(norm, { content, mtime: Date.now() });
  }

  async deleteFile(path: string): Promise<void> {
    const norm = normalizeProjectPath(path);
    this.files.delete(norm);
  }

  async exists(path: string): Promise<boolean> {
    const norm = normalizeProjectPath(path);
    return this.files.has(norm);
  }

  async listFiles(prefix?: string): Promise<ProjectFileEntry[]> {
    const normPrefix = prefix ? normalizeProjectPath(prefix) : '';
    const entries: ProjectFileEntry[] = [];

    for (const [filePath, data] of this.files.entries()) {
      if (!normPrefix || filePath.startsWith(normPrefix)) {
        entries.push({
          path: filePath,
          kind: 'file',
          size: data.content.length,
          mtime: data.mtime,
        });
      }
    }

    return entries.sort((a, b) => a.path.localeCompare(b.path));
  }

  clear(): void {
    this.files.clear();
  }
}
