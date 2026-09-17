/**
 * extension/kernel/errors.test.ts
 * Tests for exact line-number error reporting and stack remapping (RQ-07, INV-7).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { kernelService, remapLines, formatKernelError, serializeError } from './index';
import { setPlatformAdapterForTesting } from '../platform';
import { TestPlatformAdapter } from '../platform/test-adapter';

describe('T-06: Error line remapping', () => {
  beforeEach(() => {
    setPlatformAdapterForTesting(new TestPlatformAdapter());
  });

  it('reports error on exact line 3 of user cell code (RQ-07)', async () => {
    const cell = {
      id: 'cell-line-3',
      name: 'line3-test',
      source: 'const a = 1;\nconst b = 2;\nthrow new TypeError("bad type on line 3");',
    };

    const res = await kernelService.runCell(cell);
    expect(res.ok).toBe(false);
    expect(res.output).toContain('✖ TypeError: bad type on line 3');
    // Exact line number 3 assertion
    expect(res.output).toContain('3 | throw new TypeError("bad type on line 3");');
  });

  it('reports error on exact line 5 of user cell code (RQ-07)', async () => {
    const cell = {
      id: 'cell-line-5',
      name: 'line5-test',
      source: 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nthrow new RangeError("out of bounds on line 5");',
    };

    const res = await kernelService.runCell(cell);
    expect(res.ok).toBe(false);
    expect(res.output).toContain('✖ RangeError: out of bounds on line 5');
    // Exact line number 5 assertion
    expect(res.output).toContain('5 | throw new RangeError("out of bounds on line 5");');
  });

  it('remaps stack frame lines by subtracting wrapper header lines', () => {
    const rawStack = 'Error: test\n    at eval (nb-cell-foo.js:5:10)';
    const remapped = remapLines(rawStack);
    // Header lines is 2, so line 5 becomes line 3
    expect(remapped).toBe('Error: test\n    at eval (nb-cell-foo.js:3:10)');
  });

  it('formats error with headline and offending source line', () => {
    const source = 'const x = 10;\nconst y = 20;\nthrow new Error("boom");';
    const err = new Error('boom');
    err.stack = 'Error: boom\n    at eval (nb-cell-bar.js:5:1)';
    const formatted = formatKernelError(err, source);
    expect(formatted).toContain('✖ Error: boom');
    expect(formatted).toContain('3 | throw new Error("boom");');
  });

  it('remaps error stack frames from linked modules with exact file and line (D-4, RQ-06)', () => {
    const rawStack = 'Error: auth failure\n    at login (nb-cell-step-01.js:16:10)';
    const lineMap = [
      {
        filePath: 'lib/auth.js',
        startLine: 3,
        endLine: 18,
        originalContent: '// line 1\n// line 2\n// line 3\n// line 4\n// line 5\n// line 6\n// line 7\n// line 8\n// line 9\n// line 10\n// line 11\nthrow new Error("auth failure on line 12");\n// line 13\n// line 14',
      },
    ];
    const remapped = remapLines(rawStack, lineMap);
    // userLine = 16 - 2 = 14. In lineMap [3..18], relative line is 14 - 3 + 1 = 12.
    expect(remapped).toBe('Error: auth failure\n    at login (lib/auth.js:12:10)');
  });

  it('serializes errors into plain objects that survive JSON.stringify without becoming {} (D-1, RQ-01)', async () => {
    const rawErr = new TypeError('Database connection lost');
    const serialized = serializeError(rawErr);
    expect(serialized.name).toBe('TypeError');
    expect(serialized.message).toBe('Database connection lost');

    // Prove that JSON.stringify retains name and message instead of turning into {}
    const jsonStr = JSON.stringify(serialized);
    expect(jsonStr).not.toBe('{}');
    const parsed = JSON.parse(jsonStr);
    expect(parsed.name).toBe('TypeError');
    expect(parsed.message).toBe('Database connection lost');

    // Prove across kernelService.runCell boundary
    const cell = {
      id: 'failing-cell',
      source: 'throw new RangeError("Index out of bounds");',
    };
    const res = await kernelService.runCell(cell);
    expect(res.ok).toBe(false);
    expect(res.error).toBeDefined();
    expect(res.error?.name).toBe('RangeError');
    expect(res.error?.message).toBe('Index out of bounds');

    const resultJson = JSON.stringify(res);
    const parsedResult = JSON.parse(resultJson);
    expect(parsedResult.error).toEqual(
      expect.objectContaining({
        name: 'RangeError',
        message: 'Index out of bounds',
      })
    );
    expect(parsedResult.error).not.toEqual({});
  });
});
