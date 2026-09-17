/**
 * extension/project/disk-mock.ts
 * In-memory FileSystemDirectoryHandle mock for testing DiskProjectStore in non-browser/unit environments (F-2 A-1).
 */

export function createMockDirectoryHandle(name = 'root'): FileSystemDirectoryHandle {
  const files = new Map<string, { content: string; mtime: number }>();
  const subdirs = new Map<string, FileSystemDirectoryHandle>();

  const handle: Partial<FileSystemDirectoryHandle> = {
    kind: 'directory',
    name,
    async getFileHandle(fileName: string, options?: { create?: boolean }) {
      if (!files.has(fileName)) {
        if (options?.create) {
          files.set(fileName, { content: '', mtime: Date.now() });
        } else {
          const err = new Error(`File '${fileName}' not found in mock directory`);
          err.name = 'NotFoundError';
          throw err;
        }
      }
      const fileEntry = files.get(fileName)!;
      const fileHandle: Partial<FileSystemFileHandle> = {
        kind: 'file',
        name: fileName,
        async getFile() {
          return {
            name: fileName,
            size: fileEntry.content.length,
            lastModified: fileEntry.mtime,
            text: async () => fileEntry.content,
          } as unknown as File;
        },
        async createWritable() {
          let buffer = '';
          return {
            async write(data: string) {
              buffer += data;
            },
            async close() {
              fileEntry.content = buffer;
              fileEntry.mtime = Date.now();
            },
          } as unknown as FileSystemWritableFileStream;
        },
      };
      return fileHandle as FileSystemFileHandle;
    },
    async getDirectoryHandle(dirName: string, options?: { create?: boolean }) {
      if (!subdirs.has(dirName)) {
        if (options?.create) {
          subdirs.set(dirName, createMockDirectoryHandle(dirName));
        } else {
          const err = new Error(`Directory '${dirName}' not found in mock directory`);
          err.name = 'NotFoundError';
          throw err;
        }
      }
      return subdirs.get(dirName)!;
    },
    async removeEntry(entryName: string) {
      if (!files.delete(entryName)) {
        subdirs.delete(entryName);
      }
    },
    // @ts-expect-error async iterator for entries
    async *entries() {
      for (const [fName, fEntry] of files.entries()) {
        const fHandle = {
          kind: 'file',
          name: fName,
          async getFile() {
            return {
              name: fName,
              size: fEntry.content.length,
              lastModified: fEntry.mtime,
              text: async () => fEntry.content,
            } as unknown as File;
          },
        };
        yield [fName, fHandle as FileSystemFileHandle];
      }
      for (const [dName, dHandle] of subdirs.entries()) {
        yield [dName, dHandle];
      }
    },
    async queryPermission() {
      return 'granted' as PermissionState;
    },
    async requestPermission() {
      return 'granted' as PermissionState;
    },
  };

  return handle as FileSystemDirectoryHandle;
}
