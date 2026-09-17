/**
 * extension/agent/processor.test.ts
 * Unit tests for agent request processing, movement, and failure handling (T-03, T-04, T-06).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryProjectStore } from '../project/memory';
import { TestPlatformAdapter } from '../platform/test-adapter';
import { setPlatformAdapterForTesting } from '../platform';
import { siteRegistry } from '../registry';
import { AgentWatcher } from './watcher';
import { listRuns, readRun } from './runs';

describe('T-03 & T-04: Agent Request Processing & Movement (RQ-03, RQ-05, D-4)', () => {
  let store: MemoryProjectStore;
  let watcher: AgentWatcher;

  beforeEach(async () => {
    store = new MemoryProjectStore();
    watcher = new AgentWatcher();
    setPlatformAdapterForTesting(new TestPlatformAdapter());
    await siteRegistry.add('localhost');
    await siteRegistry.add('agent-test.localhost');

    // Seed sample notebook
    await store.writeFile(
      'notebook.md',
      `---
name: Agent Test Notebook
steps:
  - path: steps/01-sum.js
    name: 1. Sum Numbers
    enabled: true
  - path: steps/02-fail.js
    name: 2. Exploding Step
    enabled: true
---
Notebook description.`
    );
    await store.writeFile('steps/01-sum.js', 'return 1337 + 42;');
    await store.writeFile('steps/02-fail.js', 'throw new Error("Deliberate failure in step 2");');
  });

  it('picks up request written via ProjectStore.writeFile, executes step, and writes result to runs/ (RQ-03)', async () => {
    // 1. Agent writes request file to requests/
    const requestJson = JSON.stringify({
      stepId: 'steps/01-sum.js',
      host: 'agent-test.localhost',
    });
    await store.writeFile('requests/req-01.json', requestJson);

    // 2. Watcher polls and executes
    const results = await watcher.pollOnce(store);
    expect(results.length).toBe(1);
    expect(results[0].ok).toBe(true);

    // 3. Verify runs/ has recorded the execution with unique non-fixture value 1379
    const runFiles = await listRuns(store);
    expect(runFiles.length).toBe(1);

    const runRecord = await readRun(store, runFiles[0]);
    expect(runRecord.stepId).toBe('1. Sum Numbers');
    expect(runRecord.status).toBe('ok');
    expect(runRecord.result).toBe(1379);
    expect(runRecord.output).toBe('1379');
    expect(runRecord.host).toBe('agent-test.localhost');
  });

  it('moves processed request from requests/ to requests/processed/ (T-04, RQ-05, D-4)', async () => {
    await store.writeFile(
      'requests/calc.json',
      JSON.stringify({
        stepId: 'steps/01-sum.js',
        host: 'agent-test.localhost',
      })
    );

    expect(await store.exists('requests/calc.json')).toBe(true);
    expect(await store.exists('requests/processed/calc.json')).toBe(false);

    await watcher.pollOnce(store);

    // Verify it is NO LONGER in requests/
    expect(await store.exists('requests/calc.json')).toBe(false);
    // Verify it IS in requests/processed/
    expect(await store.exists('requests/processed/calc.json')).toBe(true);

    const processedContent = await store.readFile('requests/processed/calc.json');
    expect(JSON.parse(processedContent).stepId).toBe('steps/01-sum.js');
  });

  it('moves nested request paths to flat requests/processed/ destination (T-04, D-4)', async () => {
    await store.writeFile(
      'requests/batch1/job-99.json',
      JSON.stringify({
        stepId: 'steps/01-sum.js',
        host: 'agent-test.localhost',
      })
    );

    await watcher.pollOnce(store);

    expect(await store.exists('requests/batch1/job-99.json')).toBe(false);
    expect(await store.exists('requests/processed/job-99.json')).toBe(true);
  });

  it('handles missing step by writing structured error to runs/ and moving request (T-06, RQ-04, RQ-07)', async () => {
    await store.writeFile(
      'requests/missing.json',
      JSON.stringify({
        stepId: 'steps/non-existent.js',
        host: 'agent-test.localhost',
      })
    );

    const results = await watcher.pollOnce(store);
    expect(results.length).toBe(1);
    expect(results[0].ok).toBe(false);

    // Moved to processed
    expect(await store.exists('requests/missing.json')).toBe(false);
    expect(await store.exists('requests/processed/missing.json')).toBe(true);

    // Run record written with structured error
    const runFiles = await listRuns(store);
    expect(runFiles.length).toBe(1);
    const runRecord = await readRun(store, runFiles[0]);

    expect(runRecord.status).toBe('error');
    expect(runRecord.error?.name).toBe('StepNotFoundError');
    expect(runRecord.output).toContain('Sebab:');
    expect(runRecord.output).toContain('Tindakan:');
  });

  it('rejects unregistered host with SiteNotRegisteredError (T-06, D-5, RQ-04)', async () => {
    await store.writeFile(
      'requests/unregistered.json',
      JSON.stringify({
        stepId: 'steps/01-sum.js',
        host: 'untrusted-agent-site.org',
      })
    );

    const results = await watcher.pollOnce(store);
    expect(results.length).toBe(1);
    expect(results[0].ok).toBe(false);

    // Moved to processed
    expect(await store.exists('requests/unregistered.json')).toBe(false);
    expect(await store.exists('requests/processed/unregistered.json')).toBe(true);

    const runFiles = await listRuns(store);
    const runRecord = await readRun(store, runFiles[0]);

    expect(runRecord.status).toBe('error');
    expect(runRecord.error?.name).toBe('SiteNotRegisteredError');
    expect(runRecord.output).toContain("Situs 'untrusted-agent-site.org' belum terdaftar di registry.");
    expect(runRecord.output).toContain('Sebab:');
    expect(runRecord.output).toContain('Tindakan:');
  });

  it('handles corrupted notebook with NotebookCorruptedError (T-06, RQ-04)', async () => {
    // Corrupt notebook
    await store.writeFile('notebook.md', 'invalid: yaml: frontmatter: [unclosed');

    await store.writeFile(
      'requests/req-corrupt.json',
      JSON.stringify({
        stepId: 'steps/01-sum.js',
        host: 'agent-test.localhost',
      })
    );

    const results = await watcher.pollOnce(store);
    expect(results.length).toBe(1);
    expect(results[0].ok).toBe(false);

    // Moved to processed
    expect(await store.exists('requests/req-corrupt.json')).toBe(false);
    expect(await store.exists('requests/processed/req-corrupt.json')).toBe(true);

    const runFiles = await listRuns(store);
    const runRecord = await readRun(store, runFiles[0]);

    expect(runRecord.status).toBe('error');
    expect(runRecord.error?.name).toBe('NotebookCorruptedError');
    expect(runRecord.output).toContain('Sebab:');
    expect(runRecord.output).toContain('Tindakan:');
  });

  it('handles malformed request JSON with MalformedRequestError (T-06, RQ-04)', async () => {
    await store.writeFile('requests/bad-json.json', '{ this is not valid json }');

    const results = await watcher.pollOnce(store);
    expect(results.length).toBe(1);
    expect(results[0].ok).toBe(false);

    // Moved to processed
    expect(await store.exists('requests/bad-json.json')).toBe(false);
    expect(await store.exists('requests/processed/bad-json.json')).toBe(true);

    const runFiles = await listRuns(store);
    const runRecord = await readRun(store, runFiles[0]);

    expect(runRecord.status).toBe('error');
    expect(runRecord.error?.name).toBe('MalformedRequestError');
    expect(runRecord.output).toContain('Sebab:');
    expect(runRecord.output).toContain('Tindakan:');
  });

  it('handles missing notebook.md with NotebookNotFoundError (T-06, RQ-04)', async () => {
    await store.deleteFile('notebook.md');
    await store.writeFile(
      'requests/req-no-nb.json',
      JSON.stringify({
        stepId: 'steps/01-sum.js',
        host: 'agent-test.localhost',
      })
    );

    const results = await watcher.pollOnce(store);
    expect(results.length).toBe(1);
    expect(results[0].ok).toBe(false);

    expect(await store.exists('requests/req-no-nb.json')).toBe(false);
    expect(await store.exists('requests/processed/req-no-nb.json')).toBe(true);

    const runFiles = await listRuns(store);
    const runRecord = await readRun(store, runFiles[0]);

    expect(runRecord.status).toBe('error');
    expect(runRecord.error?.name).toBe('NotebookNotFoundError');
    expect(runRecord.output).toContain('Sebab:');
    expect(runRecord.output).toContain('Tindakan:');
  });

  it('writes the public processed path only after the original is gone (M16 T-04)', async () => {
    await store.writeFile(
      'requests/calc.json',
      JSON.stringify({
        stepId: 'steps/01-sum.js',
        host: 'agent-test.localhost',
      })
    );
    let originalExistsAtProcessedPublish: boolean | undefined;
    const origWrite = store.writeFile.bind(store);
    store.writeFile = async (path: string, content: string) => {
      if (path === 'requests/processed/calc.json') {
        originalExistsAtProcessedPublish = await store.exists('requests/calc.json');
      }
      return origWrite(path, content);
    };

    const results = await watcher.pollOnce(store);
    expect(results.length).toBe(1);
    expect(results[0].ok).toBe(true);
    expect(originalExistsAtProcessedPublish).toBe(false);
    expect(await store.exists('requests/calc.json')).toBe(false);
    expect(await store.exists('requests/processed/calc.json')).toBe(true);
  });

  it('surfaces deleteFile failure to the caller as RequestDeleteError (M16 T-03, INV-8)', async () => {
    await store.writeFile(
      'requests/calc.json',
      JSON.stringify({
        stepId: 'steps/01-sum.js',
        host: 'agent-test.localhost',
      })
    );
    store.deleteFile = async () => {
      throw new Error('forced deleteFile failure');
    };

    const results = await watcher.pollOnce(store);
    expect(results.length).toBe(1);
    expect(results[0].ok).toBe(false);
    const err = results[0].error as { name?: string; message?: string; cause?: string; action?: string };
    expect(err.name).toBe('RequestDeleteError');
    expect(err.message).toContain('requests/calc.json');
    expect(err.cause).toContain('forced deleteFile failure');
    expect(typeof err.action).toBe('string');
    expect(err.action && err.action.length > 0).toBe(true);
  });
});
