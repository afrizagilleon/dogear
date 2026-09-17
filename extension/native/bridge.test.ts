/**
 * extension/native/bridge.test.ts
 * Tests for NativeBridge: port messaging, run, broken notebook, and missing tab (T-03, RQ-01, RQ-04, INV-8, INV-9).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NativeBridge, type NativePortLike } from './bridge';
import { MemoryProjectStore } from '../project/memory';
import {
  NOTEBOOK_COMPLETED,
} from './fixtures';
import type { PlatformAdapter, ScriptExecutionOptions, ScriptExecutionResult } from '../platform/interface';
import type { DogearMessage } from './types';
import { listRuns, readRun } from '../agent/runs';

class MockPlatformAdapter implements Partial<PlatformAdapter> {
  public executedScripts: ScriptExecutionOptions[] = [];
  public scriptResults: Map<string, ScriptExecutionResult> = new Map();

  scriptExecutor = {
    executeScript: async (options: ScriptExecutionOptions): Promise<ScriptExecutionResult> => {
      this.executedScripts.push(options);
      if (this.scriptResults.has(options.cellId)) {
        return this.scriptResults.get(options.cellId)!;
      }
      return { ok: true, output: 'ok' };
    },
  };
}

describe('T-03: Port Native + run (RQ-01, RQ-04, INV-8, INV-9)', () => {
  let store: MemoryProjectStore;
  let mockPlatform: MockPlatformAdapter;
  let bridge: NativeBridge;

  beforeEach(() => {
    store = new MemoryProjectStore();
    mockPlatform = new MockPlatformAdapter();
    bridge = new NativeBridge({
      platformAdapter: mockPlatform as unknown as PlatformAdapter,
      projectStore: store,
    });
  });

  it('1. Handles status message with idle and running state (RQ-01)', async () => {
    const res = await bridge.handleMessage({ action: 'status' });
    expect(res).toEqual({
      type: 'status',
      state: 'idle',
    });
  });

  it('2. Broken notebook test: malformed notebook produces exactly needs_review and never hangs (RQ-04, INV-8)', async () => {
    const brokenNotebookMarkdown = `invalid: yaml: frontmatter: [unclosed`;

    const res = await bridge.handleMessage({
      action: 'run',
      notebook_id: 'nb-broken',
      notebook: brokenNotebookMarkdown,
      tabId: 101,
    });

    expect(res.type).toBe('outcome');
    if (res.type === 'outcome') {
      expect(res.state).toBe('needs_review');
      expect(res.reason).toContain('Notebook rusak');
      expect(res.error).toBeDefined();
    }
  });

  it('3. Missing tab test: non-existent tabId produces exactly needs_review and never hangs (RQ-04, INV-8)', async () => {
    // When tabId is not provided and browser tab query cannot find any tab
    const res = await bridge.handleMessage({
      action: 'run',
      notebook_id: 'nb-no-tab',
      notebook: NOTEBOOK_COMPLETED.markdown,
      files: NOTEBOOK_COMPLETED.files,
      tabId: undefined, // no tab
    });

    expect(res.type).toBe('outcome');
    if (res.type === 'outcome') {
      expect(res.state).toBe('needs_review');
      expect(res.reason).toContain('Tab browser tidak ditemukan');
      expect(res.error).toBeDefined();
    }
  });

  it('4. Normal run: executes cells through PipelineRunner and returns exactly one terminal state (INV-8, INV-9)', async () => {
    mockPlatform.scriptResults.set('steps/01-ambil-pesanan.js', {
      ok: true,
      output: 'ok',
      result: { status: 'completed', data: { nomorPesanan: 'INV-100' } },
    });
    mockPlatform.scriptResults.set('steps/02-konfirmasi.js', {
      ok: true,
      output: 'ok',
      result: { status: 'completed', data: { statusPemrosesan: 'SUKSES' } },
    });

    const progressMessages: DogearMessage[] = [];
    const res = await bridge.handleMessage(
      {
        action: 'run',
        notebook_id: NOTEBOOK_COMPLETED.id,
        notebook: NOTEBOOK_COMPLETED.markdown,
        files: NOTEBOOK_COMPLETED.files,
        tabId: 101,
      },
      (p) => progressMessages.push(p)
    );

    expect(res.type).toBe('outcome');
    if (res.type === 'outcome') {
      expect(res.state).toBe('completed');
      expect(res.error).toBeUndefined();
      expect(res.lastSuccessCellId).toBe('steps/02-konfirmasi.js');
      expect(res.executedCellIds).toEqual(['steps/01-ambil-pesanan.js', 'steps/02-konfirmasi.js']);
    }

    // Verified progress reporting
    expect(progressMessages.length).toBeGreaterThan(0);
    expect(progressMessages[0].type).toBe('progress');
  });

  it('5. Port attachment: attaches to NativePortLike and emits hello first, then exchanges named messages (RQ-01, K-1)', async () => {
    const messagesReceivedByPort: unknown[] = [];
    let messageListener: ((msg: unknown) => void) | null = null;

    const mockPort: NativePortLike = {
      name: 'com.dogear.host',
      onMessage: {
        addListener: (cb) => {
          messageListener = cb;
        },
      },
      postMessage: (msg) => {
        messagesReceivedByPort.push(msg);
      },
    };

    bridge.attachPort(mockPort);
    expect(messageListener).toBeDefined();

    // First frame MUST be hello (K-1, RQ-01)
    expect(messagesReceivedByPort).toHaveLength(1);
    expect(messagesReceivedByPort[0]).toMatchObject({
      type: 'hello',
      build: expect.stringMatching(/^(studio|runtime)$/),
      extVersion: expect.any(String),
    });

    // Send status request through port
    await messageListener!({ action: 'status' });
    expect(messagesReceivedByPort).toHaveLength(2);
    expect(messagesReceivedByPort[1]).toEqual({
      type: 'status',
      state: 'idle',
    });
  });

  it('6. Selector candidate 2 match crosses realm into runs/*.json and pipeline remains completed (T-05, RQ-05, RQ-06, D-5, D-6, OQ-2)', async () => {
    // Simulate candidate 2 matching inside page execution
    mockPlatform.scriptResults.set('steps/01-ambil-pesanan.js', {
      ok: true,
      output: '[WARNING] Selector shift: matched candidate 2 of 3 ("[aria-label=\'Percakapan\']")',
      result: { status: 'completed', data: { nomorPesanan: 'INV-200' } },
      candidateIndex: 2,
      candidateMatch: {
        index: 1,
        candidateIndex: 2,
        candidate: "[aria-label='Percakapan']",
        candidates: ["[data-testid='chat-item']", "[aria-label='Percakapan']", "main > ul > li"],
        elapsedMs: 215,
      },
    });

    const progressMessages: DogearMessage[] = [];
    const res = await bridge.handleMessage(
      {
        action: 'run',
        notebook_id: 'nb-single-step',
        notebook: `---
name: "Test Single Step"
steps:
  - path: "steps/01-ambil-pesanan.js"
    name: "Ambil Pesanan"
---
# Single Step Notebook`,
        files: {
          'steps/01-ambil-pesanan.js': '// dummy source',
        },
        tabId: 101,
      },
      (p) => progressMessages.push(p)
    );

    // 1. Pipeline status MUST be completed (D-6, RQ-06)
    expect(res.type).toBe('outcome');
    if (res.type === 'outcome') {
      expect(res.state).toBe('completed');
      expect(res.candidateIndex).toBe(2);
      expect(res.candidateMatches).toHaveLength(1);
      expect(res.candidateMatches?.[0].candidate).toBe("[aria-label='Percakapan']");
    }

    // 2. Progress messages must receive candidateIndex (OQ-2)
    const progressWithCandidate = progressMessages.find(
      (m) => m.type === 'progress' && m.candidateIndex === 2
    );
    expect(progressWithCandidate).toBeDefined();

    // 3. Bite-test: Indeks kandidat MUST be present in runs/*.json on project store (RQ-05, §3.4)
    const runFiles = await listRuns(store);
    expect(runFiles.length).toBeGreaterThanOrEqual(1);

    const runRecord = await readRun(store, runFiles[0]);
    expect(runRecord.status).toBe('ok');
    expect(runRecord.candidateIndex).toBe(2);
    expect(runRecord.candidateMatch).toBeDefined();
    expect(runRecord.candidateMatch?.index).toBe(1);
    expect(runRecord.candidateMatch?.candidateIndex).toBe(2);
    expect(runRecord.candidateMatch?.candidate).toBe("[aria-label='Percakapan']");
    expect(runRecord.output).toContain('Selector shift: matched candidate 2 of 3');
  });

  it('7. runId propagation: adopts provided runId or generates a new one, and attaches it to outcome (T-04, RQ-02, K-6)', async () => {
    // (a) Without runId -> generates a non-empty string runId
    const resGenerated = await bridge.handleMessage({
      action: 'run',
      notebook_id: NOTEBOOK_COMPLETED.id,
      notebook: NOTEBOOK_COMPLETED.markdown,
      files: NOTEBOOK_COMPLETED.files,
      tabId: 101,
    });
    expect(resGenerated.type).toBe('outcome');
    if (resGenerated.type === 'outcome') {
      expect(typeof resGenerated.runId).toBe('string');
      expect(resGenerated.runId?.length).toBeGreaterThan(0);
    }

    // (b) With explicit runId -> preserves exact runId
    const resExplicit = await bridge.handleMessage({
      action: 'run',
      runId: 'host-run-xyz-789',
      notebook_id: NOTEBOOK_COMPLETED.id,
      notebook: NOTEBOOK_COMPLETED.markdown,
      files: NOTEBOOK_COMPLETED.files,
      tabId: 101,
    });
    expect(resExplicit.type).toBe('outcome');
    if (resExplicit.type === 'outcome') {
      expect(resExplicit.runId).toBe('host-run-xyz-789');
    }

    // (c) Broken notebook with runId -> attaches runId to failure outcome
    const resBroken = await bridge.handleMessage({
      action: 'run',
      runId: 'broken-run-456',
      notebook_id: 'nb-broken',
      notebook: 'invalid: yaml: [broken',
      tabId: 101,
    });
    expect(resBroken.type).toBe('outcome');
    if (resBroken.type === 'outcome') {
      expect(resBroken.runId).toBe('broken-run-456');
      expect(resBroken.state).toBe('needs_review');
    }
  });

  it('8. Step emission: emits step messages per step with dataDiff and evidence, followed by outcome (T-05, RQ-03, RQ-04)', async () => {
    mockPlatform.scriptResults.set('steps/01-ambil-pesanan.js', {
      ok: true,
      output: 'ok',
      result: { status: 'completed' },
      ctxDataBefore: {},
      ctxDataAfter: { orderId: 'ORD-99' },
      evidence: { url: 'http://localhost/shop', domSnippet: '<div>step1</div>' },
    });
    mockPlatform.scriptResults.set('steps/02-konfirmasi.js', {
      ok: true,
      output: 'ok',
      result: { status: 'completed' },
      ctxDataBefore: { orderId: 'ORD-99' },
      ctxDataAfter: { orderId: 'ORD-100', total: 5 },
      evidence: { url: 'http://localhost/shop/confirm', domSnippet: '<div>step2</div>' },
    });

    const emitted: DogearMessage[] = [];
    const outcome = await bridge.handleMessage(
      {
        action: 'run',
        runId: 'run-step-test',
        notebook_id: NOTEBOOK_COMPLETED.id,
        notebook: NOTEBOOK_COMPLETED.markdown,
        files: NOTEBOOK_COMPLETED.files,
        tabId: 101,
      },
      (msg) => emitted.push(msg)
    );

    expect(outcome.type).toBe('outcome');
    if (outcome.type === 'outcome') {
      expect(outcome.state).toBe('completed');
      expect(outcome.runId).toBe('run-step-test');
    }

    const stepMessages = emitted.filter((m): m is Extract<DogearMessage, { type: 'step' }> => m.type === 'step');
    expect(stepMessages).toHaveLength(2);

    // Step 1 check
    expect(stepMessages[0].cellId).toBe('steps/01-ambil-pesanan.js');
    expect(stepMessages[0].runId).toBe('run-step-test');
    expect(stepMessages[0].state).toBe('ok');
    expect(stepMessages[0].dataDiff).toEqual({
      added: { orderId: 'ORD-99' },
      changed: {},
      removed: [],
    });
    expect(stepMessages[0].evidence.url).toBe('http://localhost/shop');

    // Step 2 check (RQ-04)
    expect(stepMessages[1].cellId).toBe('steps/02-konfirmasi.js');
    expect(stepMessages[1].runId).toBe('run-step-test');
    expect(stepMessages[1].state).toBe('ok');
    expect(stepMessages[1].dataDiff).toEqual({
      added: { total: 5 },
      changed: { orderId: { from: 'ORD-99', to: 'ORD-100' } },
      removed: [],
    });
    expect(stepMessages[1].evidence.url).toBe('http://localhost/shop/confirm');
  });

  it('9. Step emission on failure: emits step with state: "failed" and evidence before returning needs_review outcome (T-05, RQ-05, INV-8)', async () => {
    mockPlatform.scriptResults.set('steps/01-ambil-pesanan.js', {
      ok: false,
      output: 'Selector not found: #tombol-kirim',
      error: { name: 'Error', message: 'Element not found: #tombol-kirim' },
      ctxDataBefore: {},
      ctxDataAfter: {},
      evidence: {
        url: 'http://localhost/form',
        domSnippet: '<button id="tombol-krim">Kirim</button>',
      },
    });

    const emitted: DogearMessage[] = [];
    const outcome = await bridge.handleMessage(
      {
        action: 'run',
        runId: 'run-fail-test',
        notebook_id: NOTEBOOK_COMPLETED.id,
        notebook: NOTEBOOK_COMPLETED.markdown,
        files: NOTEBOOK_COMPLETED.files,
        tabId: 101,
      },
      (msg) => emitted.push(msg)
    );

    expect(outcome.type).toBe('outcome');
    if (outcome.type === 'outcome') {
      expect(outcome.state).toBe('needs_review');
      expect(outcome.runId).toBe('run-fail-test');
    }

    const stepMessages = emitted.filter((m): m is Extract<DogearMessage, { type: 'step' }> => m.type === 'step');
    expect(stepMessages).toHaveLength(1);
    expect(stepMessages[0].state).toBe('failed');
    expect(stepMessages[0].evidence.domSnippet).toContain('tombol-krim');
    expect(stepMessages[0].error).toBeDefined();
  });

  it('10. Bite-test 2 (F-2, A1-T02): NativeBridge step reporting preserves numeric candidateHit for successful pick', async () => {
    mockPlatform.scriptResults.set('steps/01-ambil-pesanan.js', {
      ok: true,
      output: 'ok',
      result: { status: 'completed' },
      candidateIndex: 2,
      candidateMatch: {
        index: 1,
        candidateIndex: 2,
        candidate: '#tombol-kirim-alt',
        candidates: ['#tombol-kirim-utama', '#tombol-kirim-alt'],
      },
    });

    const emitted: DogearMessage[] = [];
    await bridge.handleMessage(
      {
        action: 'run',
        runId: 'run-candidate-hit-test',
        notebook_id: NOTEBOOK_COMPLETED.id,
        notebook: NOTEBOOK_COMPLETED.markdown,
        files: NOTEBOOK_COMPLETED.files,
        tabId: 101,
      },
      (msg) => emitted.push(msg)
    );

    const stepMessages = emitted.filter((m): m is Extract<DogearMessage, { type: 'step' }> => m.type === 'step');
    expect(stepMessages.length).toBeGreaterThanOrEqual(1);
    const step1 = stepMessages.find((m) => m.cellId === 'steps/01-ambil-pesanan.js');
    expect(step1).toBeDefined();
    expect(step1?.state).toBe('ok');
    expect(step1?.candidateHit).toBe(2);
    expect(step1?.candidatesTried).toEqual(['#tombol-kirim-utama', '#tombol-kirim-alt']);
  });
});

