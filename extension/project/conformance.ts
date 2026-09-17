/**
 * extension/project/conformance.ts
 * Reusable parameterized conformance test suite for ProjectStore implementations (D-1, RQ-01, RQ-02, INV-9, M6 A-1).
 * Single canonical source of truth for all ProjectStore test assertions across Vitest and Browser runners.
 */

import type { ProjectStore } from '../platform/interface';

// Helper assertion functions for framework-neutral execution
function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(message || `Assertion failed: expected '${String(expected)}', got '${String(actual)}'`);
  }
}

function assertDeepEqual<T>(actual: T, expected: T, message?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(message || `Assertion failed: expected ${e}, got ${a}`);
  }
}

function assertMatch(actual: string, pattern: RegExp, message?: string): void {
  if (!pattern.test(actual)) {
    throw new Error(message || `Assertion failed: '${actual}' does not match pattern ${pattern}`);
  }
}

export interface ConformanceTestCase {
  id: string;
  name: string;
  run: (store: ProjectStore) => Promise<void>;
}

/**
 * Single canonical list of conformance test cases.
 * Used by BOTH Vitest unit tests and real in-browser integration runners.
 */
export const CONFORMANCE_TEST_CASES: ConformanceTestCase[] = [
  {
    id: 'write-read',
    name: 'writes and reads file content accurately (RQ-01)',
    run: async (store: ProjectStore) => {
      await store.writeFile('lib/auth.js', 'export const token = "abc";');
      const content = await store.readFile('lib/auth.js');
      assertEqual(content, 'export const token = "abc";');
    },
  },
  {
    id: 'exists',
    name: 'reports existence correctly via exists() (RQ-01)',
    run: async (store: ProjectStore) => {
      assertEqual(await store.exists('lib/auth.js'), false);
      await store.writeFile('lib/auth.js', 'export const x = 1;');
      assertEqual(await store.exists('lib/auth.js'), true);
      assertEqual(await store.exists('lib/missing.js'), false);
    },
  },
  {
    id: 'missing-throws',
    name: 'throws meaningful error when reading non-existent file (INV-8, D-6)',
    run: async (store: ProjectStore) => {
      let threw = false;
      try {
        await store.readFile('non/existent/file.js');
      } catch (err: unknown) {
        threw = true;
        assertMatch(String(err), /non\/existent\/file\.js|not found|tidak ditemukan/i);
      }
      assertEqual(threw, true, 'Expected readFile to throw on non-existent file');
    },
  },
  {
    id: 'delete',
    name: 'deletes existing file and verifies removal (RQ-01)',
    run: async (store: ProjectStore) => {
      await store.writeFile('temp.txt', 'hello');
      assertEqual(await store.exists('temp.txt'), true);

      await store.deleteFile('temp.txt');
      assertEqual(await store.exists('temp.txt'), false);

      let readThrew = false;
      try {
        await store.readFile('temp.txt');
      } catch {
        readThrew = true;
      }
      assertEqual(readThrew, true, 'Expected readFile to throw after file deletion');
    },
  },
  {
    id: 'overwrite',
    name: 'overwrites existing file with new content (RQ-01, D-2)',
    run: async (store: ProjectStore) => {
      await store.writeFile('config.json', '{"v": 1}');
      assertEqual(await store.readFile('config.json'), '{"v": 1}');

      await store.writeFile('config.json', '{"v": 2}');
      assertEqual(await store.readFile('config.json'), '{"v": 2}');
    },
  },
  {
    id: 'nested-paths',
    name: 'handles nested directory paths seamlessly (RQ-01)',
    run: async (store: ProjectStore) => {
      await store.writeFile('a/b/c/deep.js', 'export const deep = 42;');
      assertEqual(await store.exists('a/b/c/deep.js'), true);
      assertEqual(await store.readFile('a/b/c/deep.js'), 'export const deep = 42;');
    },
  },
  {
    id: 'normalize-paths',
    name: 'normalizes paths with leading slashes or dot-slash (RQ-01)',
    run: async (store: ProjectStore) => {
      await store.writeFile('./steps/01.js', 'console.log(1);');
      assertEqual(await store.exists('steps/01.js'), true);
      assertEqual(await store.exists('/steps/01.js'), true);
      assertEqual(await store.readFile('/steps/01.js'), 'console.log(1);');
      assertEqual(await store.readFile('steps/01.js'), 'console.log(1);');
    },
  },
  {
    id: 'list-all',
    name: 'lists all files accurately (RQ-01)',
    run: async (store: ProjectStore) => {
      await store.writeFile('steps/01.js', '// step 1');
      await store.writeFile('steps/02.js', '// step 2');
      await store.writeFile('lib/helper.js', '// helper');
      await store.writeFile('notebook.md', '# Notebook');

      const all = await store.listFiles();
      const paths = all.map((f) => f.path).sort();
      assertDeepEqual(paths, ['lib/helper.js', 'notebook.md', 'steps/01.js', 'steps/02.js']);
    },
  },
  {
    id: 'list-filter',
    name: 'lists files filtered by prefix (RQ-01)',
    run: async (store: ProjectStore) => {
      await store.writeFile('steps/01.js', '// step 1');
      await store.writeFile('steps/02.js', '// step 2');
      await store.writeFile('lib/helper.js', '// helper');

      const steps = await store.listFiles('steps');
      const stepPaths = steps.map((f) => f.path).sort();
      assertDeepEqual(stepPaths, ['steps/01.js', 'steps/02.js']);

      const lib = await store.listFiles('lib/');
      const libPaths = lib.map((f) => f.path);
      assertDeepEqual(libPaths, ['lib/helper.js']);
    },
  },
];

export interface ConformanceResult {
  passed: boolean;
  total: number;
  failures: string[];
}

/**
 * Universal runner for in-browser, extension, or standalone runtime.
 * Executes the EXACT SAME test cases from CONFORMANCE_TEST_CASES.
 */
export async function runStoreConformance(
  store: ProjectStore,
  options?: { cleanup?: (store: ProjectStore) => Promise<void> | void }
): Promise<ConformanceResult> {
  const failures: string[] = [];
  let total = 0;

  for (const testCase of CONFORMANCE_TEST_CASES) {
    total++;
    try {
      if (options?.cleanup) {
        await options.cleanup(store);
      }
      await testCase.run(store);
    } catch (err: unknown) {
      failures.push(`${testCase.name}: ${String(err)}`);
    }
  }

  return {
    passed: failures.length === 0,
    total,
    failures,
  };
}
