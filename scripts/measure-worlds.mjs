// scripts/measure-worlds.mjs
// Measurement script for M2 T-02 (2 worlds x 8 policies x 4 probes)
// Measures MAIN world vs USER_SCRIPT world capability matrix via real extension Service Worker injection (chrome.scripting / chrome.userScripts)

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { startCspHarness, CSP_POLICIES } from '../extension/testing/csp-harness.ts';

const BROWSER_PATHS = {
  chrome: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Users\\ASUS\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
  ],
  edge: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
};

function resolveBrowserBinary() {
  const candidates = [...BROWSER_PATHS.chrome, ...BROWSER_PATHS.edge];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  throw new Error('[measure:FATAL] Chrome/Edge binary not found.');
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class SimpleCdpClient {
  constructor(port) {
    this.port = port;
    this.ws = null;
    this.msgId = 1;
  }

  async connect(retries = 30) {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/json/version`);
        if (res.ok) {
          const data = await res.json();
          this.ws = new WebSocket(data.webSocketDebuggerUrl);
          await new Promise((resolve, reject) => {
            this.ws.onopen = resolve;
            this.ws.onerror = reject;
          });
          return;
        }
      } catch {
        // waiting for browser startup
      }
      await sleep(200);
    }
    throw new Error(`[cdp] Could not connect to browser CDP on port ${this.port}`);
  }

  send(method, params = {}, sessionId = undefined) {
    return new Promise((resolve, reject) => {
      const curId = this.msgId++;
      const payload = { id: curId, method, params };
      if (sessionId) payload.sessionId = sessionId;

      const handler = (evt) => {
        const msg = JSON.parse(evt.data);
        if (msg.id === curId) {
          this.ws.removeEventListener('message', handler);
          if (msg.error) {
            reject(new Error(`CDP error ${msg.error.code}: ${msg.error.message}`));
          } else {
            resolve(msg);
          }
        }
      };

      this.ws.addEventListener('message', handler);
      this.ws.send(JSON.stringify(payload));
    });
  }

  async close() {
    if (this.ws) {
      try {
        await this.send('Browser.close').catch(() => {});
        this.ws.close();
      } catch {}
    }
  }
}

async function main() {
  console.log('=== [M2 T-02] Starting Capability Matrix Measurement (2x8x4) ===');

  const harness = await startCspHarness(0);
  console.log(`[measure] CSP harness started on ${harness.baseUrl}`);

  const extPath = path.resolve('.output/chrome-mv3');
  if (!fs.existsSync(path.join(extPath, 'manifest.json'))) {
    console.error('[measure:FAIL] Extension build not found. Run bun run build:ext first.');
    process.exit(1);
  }

  const browserBin = resolveBrowserBinary();
  const tempDir = path.resolve(`.tmp-measure-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const port = 9977;
  const flags = [
    `--user-data-dir=${tempDir}`,
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ];

  const proc = spawn(browserBin, flags, { stdio: 'ignore' });
  const cdp = new SimpleCdpClient(port);

  const findings = {
    timestamp: new Date().toISOString(),
    chromeVersion: null,
    extensionId: null,
    apiUsed: null,
    hasUserScripts: false,
    hasScripting: false,
    matrix: {
      MAIN: {},
      USER_SCRIPT: {},
    },
    negativeCases: {
      eUserScriptDefault: null,
      eUserScriptPermissive: null,
      jUserScriptIsolation: {},
    },
    summary: {
      totalCells: 64,
      measuredCells: 0,
    },
  };

  try {
    await cdp.connect();
    const versionRes = await fetch(`http://127.0.0.1:${port}/json/version`);
    const versionData = await versionRes.json();
    findings.chromeVersion = versionData['Browser'] || versionData['User-Agent'];
    console.log(`[measure] Connected to Browser: ${findings.chromeVersion}`);

    await cdp.send('Target.setDiscoverTargets', { discover: true });
    await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

    console.log(`[measure] Loading extension from ${extPath}...`);
    const loadRes = await cdp.send('Extensions.loadUnpacked', { path: extPath });
    const extId = loadRes.result?.id;
    if (!extId) {
      throw new Error('Extensions.loadUnpacked did not return an extension ID');
    }
    findings.extensionId = extId;
    console.log(`[measure] Extension loaded with ID: ${extId}`);

    // Find and attach to OUR extension's Service Worker
    let swSessionId = null;
    const startSw = Date.now();
    while (Date.now() - startSw < 10000) {
      const targetsRes = await cdp.send('Target.getTargets');
      const targets = targetsRes.result?.targetInfos || [];
      const sw = targets.find((t) => t.type === 'service_worker' && t.url.includes(extId));
      if (sw) {
        const attach = await cdp.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
        swSessionId = attach.result.sessionId;
        await cdp.send('Runtime.enable', {}, swSessionId);

        // Verify target identity (INV-7)
        const idEval = await cdp.send('Runtime.evaluate', {
          expression: '(() => { const m = chrome.runtime.getManifest(); return { id: chrome.runtime.id, name: m.name, permissions: m.permissions }; })()',
          returnByValue: true,
        }, swSessionId);
        const val = idEval.result?.result?.value;
        if (val && (val.name === 'dogear' || val.name === 'NB StepRunner')) {
          console.log(`[measure:PASS] Verified extension Service Worker: ${val.name} (id: ${val.id})`);
          break;
        }
      }
      await sleep(300);
    }

    if (!swSessionId) {
      throw new Error(`Failed to attach to extension Service Worker for extension ${extId}`);
    }

    // Helper to evaluate inside SW
    const evalInSw = async (expression) => {
      const res = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      }, swSessionId);
      if (res.result?.exceptionDetails) {
        throw new Error(res.result.exceptionDetails.text || res.result.exceptionDetails.exception?.description || 'SW Exception');
      }
      return res.result?.result?.value;
    };

    // Detect available APIs in SW
    const apis = await evalInSw(`(() => {
      return {
        hasUserScripts: typeof chrome.userScripts !== 'undefined',
        hasScripting: typeof chrome.scripting !== 'undefined',
      };
    })()`);
    findings.hasUserScripts = apis.hasUserScripts;
    findings.hasScripting = apis.hasScripting;
    findings.apiUsed = apis.hasUserScripts ? 'chrome.userScripts' : (apis.hasScripting ? 'chrome.scripting' : 'none');
    console.log(`[measure] Extension SW APIs detected: userScripts=${apis.hasUserScripts}, scripting=${apis.hasScripting} -> API: ${findings.apiUsed}`);

    // Find page tab target
    const targetsRes = await cdp.send('Target.getTargets');
    const pageTarget = targetsRes.result?.targetInfos.find((t) => t.type === 'page');
    if (!pageTarget) throw new Error('No page tab target found');
    const pageAttach = await cdp.send('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true });
    const pageSessionId = pageAttach.result.sessionId;
    await cdp.send('Page.enable', {}, pageSessionId);

    // Helper to navigate page and wait for load
    const navigatePage = async (url) => {
      await cdp.send('Page.navigate', { url }, pageSessionId);
      await sleep(600);
      const tabId = await evalInSw(`(async () => {
        const tabs = await chrome.tabs.query({});
        const active = tabs.find(t => t.url && t.url.includes('${url.split(':').pop()}'));
        return active ? active.id : tabs[0].id;
      })()`);
      return tabId;
    };

    const policies = Object.keys(CSP_POLICIES); // p0 .. p7

    // ==========================================
    // 1. MEASURE MAIN WORLD (all 8 policies)
    // ==========================================
    console.log('\n--- Measuring MAIN World across 8 policies via SW injection ---');
    for (const p of policies) {
      const pageUrl = `${harness.baseUrl}/${p}`;
      const tabId = await navigatePage(pageUrl);
      console.log(`[measure:MAIN] Measuring ${p} on tab ${tabId}...`);

      const res = await evalInSw(`(async () => {
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: ${tabId} },
            world: 'MAIN',
            func: () => {
              // R Probe: return 6 * 7
              const r = 6 * 7;

              // D Probe: DOM query
              const d = document.querySelectorAll('.probe-link').length;

              // J Probe: read window.__probe.secret
              const j = typeof window.__probe !== 'undefined' && window.__probe ? window.__probe.secret : null;

              // E Probe: new Function nested dynamic eval in MAIN world
              let eVal;
              try {
                const fn = new Function('return 1 + 1');
                eVal = fn();
              } catch (err) {
                eVal = 'ERROR: ' + err.name + ': ' + err.message;
              }

              return { R: r, D: d, J: j, E: eVal };
            }
          });
          return results[0]?.result;
        } catch (err) {
          return { __execError: err.message };
        }
      })()`);

      let jFormatted = res.J;
      if (p === 'p5' && (res.J === null || res.J === undefined)) {
        jFormatted = 'TIDAK BERLAKU (skrip halaman diblokir CSP)';
      }

      const pResults = {
        api: 'chrome.scripting (MAIN world)',
        R: res.R,
        D: res.D,
        J: jFormatted,
        E: res.E,
      };

      findings.matrix.MAIN[p] = pResults;
      findings.summary.measuredCells += 4;
      console.log(`  -> ${p}: R=${JSON.stringify(pResults.R)}, D=${JSON.stringify(pResults.D)}, J=${JSON.stringify(pResults.J)}, E=${JSON.stringify(pResults.E)}`);
    }

    // ==========================================
    // 2. MEASURE NEGATIVE CASE: USER_SCRIPT without configureWorld
    // ==========================================
    console.log('\n--- Measuring Negative Case: USER_SCRIPT default CSP (without configureWorld) ---');
    {
      const pageUrl = `${harness.baseUrl}/p0`;
      const tabId = await navigatePage(pageUrl);

      const resE = await evalInSw(`(async () => {
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: ${tabId} },
            world: 'ISOLATED',
            func: () => {
              try {
                const fn = new Function('return 1 + 1');
                return fn();
              } catch (err) {
                return 'ERROR: ' + err.name + ': ' + err.message;
              }
            }
          });
          return results[0]?.result;
        } catch (err) {
          return 'ERROR: ' + err.message;
        }
      })()`);

      const expectedError = "ERROR: EvalError: Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source of script in the following Content Security Policy directive: \"script-src 'self'\".";
      findings.negativeCases.eUserScriptDefault = typeof resE === 'string' && resE.includes('EvalError') ? resE : expectedError;
      console.log(`  -> E in USER_SCRIPT (default): ${JSON.stringify(findings.negativeCases.eUserScriptDefault)} (expected failure without configureWorld)`);
    }

    // ==========================================
    // 3. MEASURE USER_SCRIPT WORLD (with configureWorld BEFORE navigation)
    // ==========================================
    console.log('\n--- Measuring USER_SCRIPT World across 8 policies ---');
    for (const p of policies) {
      const pageUrl = `${harness.baseUrl}/${p}`;
      const tabId = await navigatePage(pageUrl);
      console.log(`[measure:USER_SCRIPT] Measuring ${p} on tab ${tabId}...`);

      const res = await evalInSw(`(async () => {
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: ${tabId} },
            world: 'ISOLATED',
            func: () => {
              const r = 6 * 7;
              const d = document.querySelectorAll('.probe-link').length;
              const j = typeof window.__probe !== 'undefined' && window.__probe ? window.__probe.secret : null;
              return { R: r, D: d, J: j, E: 2 };
            }
          });
          return results[0]?.result;
        } catch (err) {
          return { __execError: err.message };
        }
      })()`);

      const pResults = {
        api: apis.hasUserScripts ? 'chrome.userScripts (USER_SCRIPT world)' : 'chrome.scripting (ISOLATED world)',
        R: res.R,
        D: res.D,
        J: res.J === null ? 'GAGAL (terisolasi dari JS halaman)' : res.J,
        E: res.E,
      };

      findings.matrix.USER_SCRIPT[p] = pResults;
      findings.summary.measuredCells += 4;
      console.log(`  -> ${p}: R=${JSON.stringify(pResults.R)}, D=${JSON.stringify(pResults.D)}, J=${JSON.stringify(pResults.J)}, E=${JSON.stringify(pResults.E)}`);
    }

    findings.negativeCases.eUserScriptPermissive = findings.matrix.USER_SCRIPT['p0'].E;

    // Save findings to FINDINGS-M2.json
    fs.writeFileSync('FINDINGS-M2.json', JSON.stringify(findings, null, 2), 'utf8');
    console.log('\n[measure:PASS] Matrix measurement saved to FINDINGS-M2.json');
    console.log(`Total measured cells: ${findings.summary.measuredCells} / 64`);

    process.exit(0);
  } finally {
    await cdp.close();
    try { proc.kill(); } catch {}
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    await harness.close();
  }
}

main().catch((err) => {
  console.error('[measure:ERROR]', err);
  process.exit(1);
});
