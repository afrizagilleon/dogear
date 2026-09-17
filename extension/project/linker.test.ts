/**
 * extension/project/linker.test.ts
 * Unit tests for NotebookModuleLinker (RQ-04, RQ-05, RQ-07, OQ-1, OQ-2).
 */

import { describe, it, expect } from 'vitest';
import { MemoryProjectStore } from './memory';
import { NotebookModuleLinker, parseImports, resolveRelativePath } from './linker';

describe('NotebookModuleLinker', () => {
  it('resolves relative paths correctly', () => {
    expect(resolveRelativePath('steps/01.js', '../lib/auth.js')).toBe('lib/auth.js');
    expect(resolveRelativePath('lib/a.js', './b.js')).toBe('lib/b.js');
    expect(resolveRelativePath('lib/sub/deep.js', '../../common/util.js')).toBe('common/util.js');
  });

  it('rejects bare import specifiers with descriptive error (INV-8, RQ-07)', () => {
    expect(() => parseImports("import _ from 'lodash';", 'steps/01.js')).toThrow(
      /Bare import specifier 'lodash'/
    );
  });

  it('links 2-level dependency graph accurately (RQ-04)', async () => {
    const store = new MemoryProjectStore();
    await store.writeFile('lib/auth.js', 'export const secret = 42;\nexport function getAuth() { return secret; }');
    await store.writeFile('steps/01.js', "import { getAuth } from '../lib/auth.js';\nreturn getAuth();");

    const linker = new NotebookModuleLinker(store);
    const result = await linker.link('steps/01.js');

    expect(result.dependencies).toEqual(['lib/auth.js']);
    expect(result.source).toContain('[Module: lib/auth.js]');
    expect(result.source).toContain('[Step Entry: steps/01.js]');
    expect(result.source).toContain('sourceMappingURL=data:application/json');
  });

  it('links 3-level graph in bottom-up order with timing measurement (RQ-05, OQ-2)', async () => {
    const store = new MemoryProjectStore();
    // 3-level dependency: steps/01.js -> lib/service.js -> lib/core.js
    await store.writeFile('lib/core.js', 'export const baseVal = 100;\nexport function getCore() { return baseVal; }');
    await store.writeFile('lib/service.js', "import { getCore } from './core.js';\nexport function compute() { return getCore() + 50; }");
    await store.writeFile('steps/01.js', "import { compute } from '../lib/service.js';\nreturn compute() + 25;");

    const linker = new NotebookModuleLinker(store);
    const result = await linker.link('steps/01.js');

    // Bottom-up: core.js first, then service.js
    expect(result.dependencies).toEqual(['lib/core.js', 'lib/service.js']);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    console.log(`[OQ-2 Linker Timing] 3-level graph linked in: ${result.durationMs.toFixed(3)}ms`);
  });

  it('detects cyclic dependencies and throws clear error (OQ-1, RQ-07)', async () => {
    const store = new MemoryProjectStore();
    await store.writeFile('lib/a.js', "import { b } from './b.js';\nexport const a = b + 1;");
    await store.writeFile('lib/b.js', "import { a } from './a.js';\nexport const b = a + 1;");
    await store.writeFile('steps/01.js', "import { a } from '../lib/a.js';\nreturn a;");

    const linker = new NotebookModuleLinker(store);
    await expect(linker.link('steps/01.js')).rejects.toThrow(
      /CyclicDependencyError.*lib\/a\.js -> lib\/b\.js -> lib\/a\.js/
    );
  });

  it('throws descriptive error on non-existent imported file (INV-8, RQ-07)', async () => {
    const store = new MemoryProjectStore();
    await store.writeFile('steps/01.js', "import { foo } from '../lib/missing.js';\nreturn foo;");

    const linker = new NotebookModuleLinker(store);
    await expect(linker.link('steps/01.js')).rejects.toThrow(
      /ModuleResolutionError: Modul 'lib\/missing\.js' yang diimpor oleh 'steps\/01\.js' tidak ditemukan/
    );
  });
});
