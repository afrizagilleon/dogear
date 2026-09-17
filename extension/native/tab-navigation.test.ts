/**
 * extension/native/tab-navigation.test.ts
 * Tests for Tab Navigation Helpers at step boundary (K-8, K-9, K-10, K-12, RQ-07, RQ-08, RQ-09).
 */

import { describe, it, expect } from 'vitest';
import { NativeBridge } from './bridge';
import { TestPlatformAdapter } from '../platform/test-adapter';
import { MemoryProjectStore } from '../project/memory';
import type { DogearMessage } from './types';

describe('T-04: Tab Navigation at Step Boundary (K-8, K-9, K-12)', () => {
  it('openTab, goto, and backToOpener({ close: true }) work at step boundary (RQ-08)', async () => {
    const platform = new TestPlatformAdapter();
    const store = new MemoryProjectStore();
    const bridge = new NativeBridge({ platformAdapter: platform, projectStore: store });

    const portMessages: DogearMessage[] = [];
    bridge.attachPort({
      postMessage: (msg: unknown) => portMessages.push(msg as DogearMessage),
      onMessage: { addListener: () => {} },
    });

    const notebook = `---
name: "Tab Nav RQ-08"
steps:
  - path: "steps/01-open.js"
    name: "01-open"
  - path: "steps/02-goto.js"
    name: "02-goto"
  - path: "steps/03-back.js"
    name: "03-back"
  - path: "steps/04-finish.js"
    name: "04-finish"
---
# Tab Nav RQ-08`;

    const files = {
      'steps/01-open.js': `
        openTab('http://localhost/child-tab');
        return { status: 'completed' };
      `,
      'steps/02-goto.js': `
        goto('http://localhost/child-tab-updated');
        return { status: 'completed' };
      `,
      'steps/03-back.js': `
        backToOpener({ close: true });
        return { status: 'completed' };
      `,
      'steps/04-finish.js': `
        return { status: 'completed', data: { finished: true } };
      `,
    };

    const res = await bridge.handleMessage({
      action: 'run',
      runId: 'run-rq08',
      notebook_id: 'nb-rq08',
      notebook,
      files,
      tabId: 1,
    }, (progress) => {
      portMessages.push(progress);
    });

    expect(res.type).toBe('outcome');
    if (res.type !== 'outcome') throw new Error('Expected outcome');
    expect(res.state).toBe('completed');

    const stepMessages = portMessages.filter((m) => m.type === 'step');
    expect(stepMessages.length).toBe(4);

    // Step 1 runs on initial tab 1
    expect(stepMessages[0].evidence?.url).toBe('http://localhost/');

    // Step 2 runs on new tab created by openTab (ID 101)
    expect(stepMessages[1].evidence?.url).toBe('http://localhost/child-tab');

    // Step 3 runs on new tab after goto updated its URL
    expect(stepMessages[2].evidence?.url).toBe('http://localhost/child-tab-updated');

    // Step 4 runs back on opener tab (ID 1) after backToOpener
    expect(stepMessages[3].evidence?.url).toBe('http://localhost/');

    // The abandoned child tab (ID 101) must have been closed (close: true)
    expect(await platform.tabNavigator.isTabAlive(101)).toBe(false);
  });

  it('useNewTab switches to tab opened by openerTabId (RQ-07)', async () => {
    const platform = new TestPlatformAdapter();
    const store = new MemoryProjectStore();
    const bridge = new NativeBridge({ platformAdapter: platform, projectStore: store });

    const portMessages: DogearMessage[] = [];
    bridge.attachPort({
      postMessage: (msg: unknown) => portMessages.push(msg as DogearMessage),
      onMessage: { addListener: () => {} },
    });

    const notebook = `---
name: "useNewTab RQ-07"
steps:
  - path: "steps/01-click.js"
    name: "01-click"
  - path: "steps/02-verify.js"
    name: "02-verify"
---
# useNewTab RQ-07`;

    // Step 1 simulates opening new tab from tab 1 and registers useNewTab
    const files = {
      'steps/01-click.js': `
        // Simulate click opening new tab in background
        ctx.lib = { openedId: 101 };
        useNewTab({ timeout: 1000 });
        return { status: 'completed' };
      `,
      'steps/02-verify.js': `
        return { status: 'completed', data: { onNewTab: true } };
      `,
    };

    // Pre-populate the new tab that was opened from tab 1
    platform.tabNavigator.simulateNewTab(1, 'http://localhost/opened-by-click');

    const res = await bridge.handleMessage({
      action: 'run',
      runId: 'run-rq07',
      notebook_id: 'nb-rq07',
      notebook,
      files,
      tabId: 1,
    }, (progress) => {
      portMessages.push(progress);
    });

    expect(res.type).toBe('outcome');
    if (res.type !== 'outcome') throw new Error('Expected outcome');
    expect(res.state).toBe('completed');

    const stepMessages = portMessages.filter((m) => m.type === 'step');
    expect(stepMessages.length).toBe(2);
    expect(stepMessages[0].evidence?.url).toBe('http://localhost/');
    expect(stepMessages[1].evidence?.url).toBe('http://localhost/opened-by-click');
  });

  it('useNewTab times out and returns needs_review with cause and action when no tab opened (RQ-07 negative)', async () => {
    const platform = new TestPlatformAdapter();
    const store = new MemoryProjectStore();
    const bridge = new NativeBridge({ platformAdapter: platform, projectStore: store });

    const portMessages: DogearMessage[] = [];
    bridge.attachPort({
      postMessage: (msg: unknown) => portMessages.push(msg as DogearMessage),
      onMessage: { addListener: () => {} },
    });

    const notebook = `---
name: "useNewTab Timeout"
steps:
  - path: "steps/01-wait.js"
    name: "01-wait"
  - path: "steps/02-never.js"
    name: "02-never"
---
# useNewTab Timeout`;

    const files = {
      'steps/01-wait.js': `
        // Call useNewTab without opening any tab
        useNewTab({ timeout: 100 });
        return { status: 'completed' };
      `,
      'steps/02-never.js': `
        return { status: 'completed' };
      `,
    };

    const res = await bridge.handleMessage({
      action: 'run',
      runId: 'run-timeout',
      notebook_id: 'nb-timeout',
      notebook,
      files,
      tabId: 1,
    });

    expect(res.type).toBe('outcome');
    if (res.type !== 'outcome') throw new Error('Expected outcome');
    expect(res.state).toBe('needs_review');
    expect(res.reason).toContain('Batas waktu 100ms terlampaui saat menunggu tab baru');
    expect(res.reason).toContain('Tidak ditemukan tab baru');
    expect(res.executedCellIds).toEqual(['steps/01-wait.js']);
  });

  it('two tab requests in one step throw error immediately and prevent tab switch (K-9)', async () => {
    const platform = new TestPlatformAdapter();
    const store = new MemoryProjectStore();
    const bridge = new NativeBridge({ platformAdapter: platform, projectStore: store });

    const notebook = `---
name: "Two Requests in One Step"
steps:
  - path: "steps/01-double.js"
    name: "01-double"
---
# Two Requests`;

    const files = {
      'steps/01-double.js': `
        openTab('http://localhost/first');
        goto('http://localhost/second');
        return { status: 'completed' };
      `,
    };

    const res = await bridge.handleMessage({
      action: 'run',
      runId: 'run-double',
      notebook_id: 'nb-double',
      notebook,
      files,
      tabId: 1,
    });

    expect(res.type).toBe('outcome');
    if (res.type !== 'outcome') throw new Error('Expected outcome');
    expect(res.state).toBe('needs_review');
    expect(res.reason).toContain('Dua permintaan tab dalam satu langkah: openTab sudah terdaftar sebelum goto');
    expect(res.executedCellIds).toEqual([]);
  });

  it('K-12: Tab requests are cleared at start of step in window, ctx, and global (Bite-test 4 isolation)', async () => {
    const platform = new TestPlatformAdapter();
    const store = new MemoryProjectStore();
    const bridge = new NativeBridge({ platformAdapter: platform, projectStore: store });

    const notebook = `---
name: "K-12 Cleanup"
steps:
  - path: "steps/01-request.js"
    name: "01-request"
  - path: "steps/02-no-request.js"
    name: "02-no-request"
---
# K-12 Cleanup`;

    const files = {
      'steps/01-request.js': `
        openTab('http://localhost/tab2');
        return { status: 'completed' };
      `,
      'steps/02-no-request.js': `
        // Does NOT request any tab navigation
        return { status: 'completed', data: { step2Ran: true } };
      `,
    };

    const res = await bridge.handleMessage({
      action: 'run',
      runId: 'run-k12',
      notebook_id: 'nb-k12',
      notebook,
      files,
      tabId: 1,
    });

    expect(res.type).toBe('outcome');
    if (res.type !== 'outcome') throw new Error('Expected outcome');
    expect(res.state).toBe('completed');
  });

  it('tab helpers throw K-13 error at call site when called outside native run (K-13, F-1)', async () => {
    const platform = new TestPlatformAdapter();
    for (const helperCall of ['useNewTab()', 'openTab("https://example.com")', 'goto("https://example.com")', 'backToOpener()']) {
      const execResult = await platform.scriptExecutor.executeScript({
        cellId: 'cell-panel',
        world: 'MAIN',
        source: `${helperCall};\nreturn 1;`,
        allowTabRequests: false, // Panel / non-native execution
      });
      expect(execResult.ok).toBe(false);
      expect(execResult.output).toContain('hanya berlaku pada run notebook melalui jembatan native, tidak dapat digunakan di panel');
    }
  });

  it('openTab that never completes loading ends in needs_review mentioning the URL (A1-T03, F-3)', async () => {
    const platform = new TestPlatformAdapter();
    const store = new MemoryProjectStore();
    const bridge = new NativeBridge({ platformAdapter: platform, projectStore: store });

    const failedUrl = 'https://unreachable-domain.test/hang';
    platform.tabNavigator.neverCompleteUrls.add(failedUrl);

    const notebook = `---
name: "Uncompleted openTab"
steps:
  - path: "steps/01-open-hang.js"
    name: "01-open-hang"
  - path: "steps/02-never.js"
    name: "02-never"
---
# Uncompleted openTab`;

    const files = {
      'steps/01-open-hang.js': `
        openTab('${failedUrl}');
        return { status: 'completed' };
      `,
      'steps/02-never.js': `
        return { status: 'completed' };
      `,
    };

    const res = await bridge.handleMessage({
      action: 'run',
      runId: 'run-open-hang',
      notebook_id: 'nb-hang',
      notebook,
      files,
      tabId: 1,
    });

    expect(res.type).toBe('outcome');
    if (res.type !== 'outcome') throw new Error('Expected outcome');
    expect(res.state).toBe('needs_review');
    expect(res.reason).toContain(failedUrl);
    expect(res.reason).toContain('Status tab tidak mencapai complete');
    expect(res.executedCellIds).toEqual(['steps/01-open-hang.js']);
  });

  it('goto that never completes loading ends in needs_review mentioning the URL (A1-T03, F-3)', async () => {
    const platform = new TestPlatformAdapter();
    const store = new MemoryProjectStore();
    const bridge = new NativeBridge({ platformAdapter: platform, projectStore: store });

    const failedGotoUrl = 'https://unreachable-domain.test/goto-hang';
    platform.tabNavigator.neverCompleteUrls.add(failedGotoUrl);

    const notebook = `---
name: "Uncompleted goto"
steps:
  - path: "steps/01-goto-hang.js"
    name: "01-goto-hang"
  - path: "steps/02-never.js"
    name: "02-never"
---
# Uncompleted goto`;

    const files = {
      'steps/01-goto-hang.js': `
        goto('${failedGotoUrl}');
        return { status: 'completed' };
      `,
      'steps/02-never.js': `
        return { status: 'completed' };
      `,
    };

    const res = await bridge.handleMessage({
      action: 'run',
      runId: 'run-goto-hang',
      notebook_id: 'nb-goto-hang',
      notebook,
      files,
      tabId: 1,
    });

    expect(res.type).toBe('outcome');
    if (res.type !== 'outcome') throw new Error('Expected outcome');
    expect(res.state).toBe('needs_review');
    expect(res.reason).toContain(failedGotoUrl);
    expect(res.reason).toContain('Status tab tidak mencapai complete');
    expect(res.executedCellIds).toEqual(['steps/01-goto-hang.js']);
  });

  it('closeTab failure does not abort run, but records warning in reason (A1-T03, F-3)', async () => {
    const platform = new TestPlatformAdapter();
    const store = new MemoryProjectStore();
    const bridge = new NativeBridge({ platformAdapter: platform, projectStore: store });

    platform.tabNavigator.throwOnCloseTab = true;

    const notebook = `---
name: "closeTab warning"
steps:
  - path: "steps/01-open.js"
    name: "01-open"
  - path: "steps/02-back-close.js"
    name: "02-back-close"
  - path: "steps/03-final.js"
    name: "03-final"
---
# closeTab warning`;

    const files = {
      'steps/01-open.js': `
        openTab('http://localhost/new-tab');
        return { status: 'completed' };
      `,
      'steps/02-back-close.js': `
        backToOpener({ close: true });
        return { status: 'completed' };
      `,
      'steps/03-final.js': `
        return { status: 'completed', data: { reachedEnd: true } };
      `,
    };

    const res = await bridge.handleMessage({
      action: 'run',
      runId: 'run-close-fail',
      notebook_id: 'nb-close-fail',
      notebook,
      files,
      tabId: 1,
    });

    expect(res.type).toBe('outcome');
    if (res.type !== 'outcome') throw new Error('Expected outcome');
    expect(res.state).toBe('completed');
    expect(res.reason).toContain('Peringatan penutupan tab');
    expect(res.reason).toContain('permission denied');
    expect(res.executedCellIds).toEqual(['steps/01-open.js', 'steps/02-back-close.js', 'steps/03-final.js']);
  });
});
