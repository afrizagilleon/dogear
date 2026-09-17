// scripts/screenshot.mjs
//
// Takes deterministic screenshots of dogear in use, for the README.
//
// It launches Chrome against a profile that already has the extension installed,
// serves a small demo page, opens the side panel, types a step into the scratch
// box, runs it, and captures both the panel and the page.
//
// Chrome removed --load-extension in v152, so the extension has to be installed
// by hand once:
//
//   1. chrome.exe --user-data-dir="D:\some\path\.chrome-shots"
//   2. chrome://extensions -> Developer mode -> Load unpacked -> .output/chrome-mv3
//   3. Details -> Allow user scripts
//   4. close that window
//
// Then:
//
//   bun run build
//   node scripts/screenshot.mjs --profile "D:\some\path\.chrome-shots"
//
// Output: docs/panel.png and docs/page.png (override with --out).
//
// NOTE: before capturing, this REPLACES the notebooks stored in that profile
// with a small demo notebook, so the screenshots look the same every run.
// Use a profile you keep for screenshots, not one holding work you care about.
// Pass --keep-state to skip the seeding and photograph the profile as it is.
//
// Requires Node 22+ (global fetch and WebSocket).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- arguments

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PROFILE = arg('profile');
const OUT_DIR = path.resolve(arg('out', 'docs'));
const CDP_PORT = Number(arg('port', '9555'));
const HTTP_PORT = Number(arg('http-port', '9556'));
const PANEL_W = Number(arg('panel-width', '460'));
const PANEL_H = Number(arg('panel-height', '900'));
const SCALE = Number(arg('scale', '2'));
const KEEP_STATE = process.argv.includes('--keep-state');

if (!PROFILE) {
  console.error(
    'Missing --profile.\n' +
    'Point it at a Chrome profile directory that already has dogear installed\n' +
    '(see the comment at the top of this file for the one-time setup).'
  );
  process.exit(1);
}
if (!fs.existsSync(PROFILE)) {
  console.error(`Profile directory does not exist: ${PROFILE}`);
  process.exit(1);
}

// ------------------------------------------------------------ chrome binary

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

function resolveChrome() {
  const explicit = arg('chrome');
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error(`--chrome not found: ${explicit}`);
    return explicit;
  }
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) return c;
  throw new Error('Chrome not found. Pass --chrome "<path to chrome>".');
}

// ---------------------------------------------------------- extension id

// The unpacked extension id is derived from its path, so it is stable per
// profile. Read it out of the profile instead of hard-coding it.
function findExtensionId(profileDir) {
  const candidates = [
    path.join(profileDir, 'Default', 'Secure Preferences'),
    path.join(profileDir, 'Secure Preferences'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    let prefs;
    try {
      prefs = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const settings = prefs?.extensions?.settings || {};
    for (const [id, entry] of Object.entries(settings)) {
      const p = typeof entry?.path === 'string' ? entry.path : '';
      if (/chrome-mv3|dogear/i.test(p)) return id;
    }
  }
  throw new Error(
    `Could not find the dogear extension in ${profileDir}.\n` +
    'Install it once with "Load unpacked" (see the top of this file), then retry.'
  );
}

// ------------------------------------------------------------- CDP client

class Cdp {
  constructor(port) {
    this.port = port;
    this.id = 1;
    this.ws = null;
  }

  async connect() {
    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/json/version`);
        if (res.ok) {
          const v = await res.json();
          this.ws = new WebSocket(v.webSocketDebuggerUrl);
          await new Promise((resolve, reject) => {
            this.ws.onopen = resolve;
            this.ws.onerror = () => reject(new Error('CDP websocket failed'));
          });
          return v;
        }
      } catch {
        /* chrome is still starting */
      }
      await sleep(200);
    }
    throw new Error(`Could not reach CDP on port ${this.port}`);
  }

  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      const timer = setTimeout(() => {
        this.ws.removeEventListener('message', onMessage);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30000);
      const onMessage = (evt) => {
        const msg = JSON.parse(evt.data);
        if (msg.id !== id) return;
        clearTimeout(timer);
        this.ws.removeEventListener('message', onMessage);
        if (msg.error) reject(new Error(`CDP ${method}: ${msg.error.message}`));
        else resolve(msg.result);
      };
      this.ws.addEventListener('message', onMessage);
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* already gone */
    }
  }
}

async function openTarget(cdp, url) {
  const { targetId } = await cdp.send('Target.createTarget', { url });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  return { targetId, sessionId };
}

async function evaluate(cdp, sessionId, expression) {
  const res = await cdp.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId
  );
  if (res.exceptionDetails) {
    throw new Error(`Page threw: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
  }
  return res.result?.value;
}

async function waitFor(cdp, sessionId, expression, what, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await sleep(200);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${what}`);
}

async function capture(cdp, sessionId, file, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: SCALE, mobile: false }, sessionId);
  await cdp.send('Page.bringToFront', {}, sessionId);
  await sleep(400); // let the layout settle at the new size
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`  wrote ${path.relative(process.cwd(), file)} (${width}x${height} @${SCALE}x, ${kb} KB)`);
}

// ------------------------------------------------------------- demo page

const DEMO_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Orders — demo</title>
<style>
  :root { color-scheme: light; }
  body { font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 0; color: #18181b; background: #fafafa; }
  header { padding: 24px 32px; border-bottom: 1px solid #e4e4e7; background: #fff; }
  h1 { margin: 0; font-size: 22px; letter-spacing: -0.01em; }
  main { padding: 24px 32px; }
  .row { display: flex; justify-content: space-between; align-items: center;
         padding: 14px 16px; background: #fff; border: 1px solid #e4e4e7;
         border-radius: 10px; margin-bottom: 10px; }
  .who { font-weight: 600; }
  .meta { color: #71717a; font-size: 13px; }
  .badge { font-size: 12px; padding: 3px 9px; border-radius: 999px; background: #eef2ff; color: #4338ca; }
  .badge.unread { background: #fef3c7; color: #92400e; }
</style>
</head>
<body>
  <header><h1>Orders</h1></header>
  <main id="list-pane" data-testid="inbox-list">
    <div class="row"><div><div class="who">ORD-1042</div><div class="meta">2 items · paid</div></div><span class="badge">shipped</span></div>
    <div class="row"><div><div class="who">ORD-1043</div><div class="meta">1 item · pending</div></div><span class="badge unread" data-testid="unread-badge">needs review</span></div>
    <div class="row"><div><div class="who">ORD-1044</div><div class="meta">5 items · paid</div></div><span class="badge unread" data-testid="unread-badge">needs review</span></div>
    <div class="row"><div><div class="who">ORD-1045</div><div class="meta">3 items · refunded</div></div><span class="badge">closed</span></div>
  </main>
</body>
</html>`;

// Seeded into the profile's OPFS so the panel shows the same notebook every run,
// instead of whatever happened to be left in that profile.
const DEMO_NOTEBOOK = `---
name: "Audit pesanan"
steps:
  - path: "steps/01-buka.js"
    name: "Buka daftar pesanan"
  - path: "steps/02-hitung.js"
    name: "Hitung yang perlu ditinjau"
---
# Audit pesanan
`;

const DEMO_STEPS = {
  'steps/01-buka.js': `const daftar = await pick([
  '[data-testid="inbox-list"]',
  '#list-pane',
], { timeout: 20000 });

ctx.data.baris = daftar.querySelectorAll('.row').length;
print('Daftar siap:', ctx.data.baris, 'baris');
`,
  'steps/02-hitung.js': `const perluDitinjau = $$('[data-testid="unread-badge"]');

if (perluDitinjau.length === 0) {
  return { status: 'skipped', reason: 'Tidak ada yang perlu ditinjau' };
}

ctx.data.perluDitinjau = perluDitinjau.length;
return { status: 'completed', data: { perluDitinjau: perluDitinjau.length } };
`,
};

const SNIPPET = `const rows = $$('.row');
const perluDitinjau = $$('[data-testid="unread-badge"]');

print('baris   :', rows.length);
print('ditinjau:', perluDitinjau.length);

const judul = await pick(['h1', '.title']);
print('halaman :', judul.textContent.trim());`;

// --------------------------------------------------------------- main

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const extId = findExtensionId(PROFILE);
  console.log(`extension : ${extId}`);

  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(DEMO_PAGE);
  });
  await new Promise((resolve) => server.listen(HTTP_PORT, '127.0.0.1', resolve));
  console.log(`demo page : http://127.0.0.1:${HTTP_PORT}`);

  const chrome = spawn(resolveChrome(), [
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,860',
    'about:blank',
  ], { stdio: 'ignore' });

  const cdp = new Cdp(CDP_PORT);
  try {
    const version = await cdp.connect();
    console.log(`browser   : ${version.Browser}`);

    // The demo page must exist as a normal web tab first: the panel runs its
    // step against the active *web* tab, not against the panel itself.
    const page = await openTarget(cdp, `http://127.0.0.1:${HTTP_PORT}/`);
    await waitFor(cdp, page.sessionId, `!!document.querySelector('.row')`, 'demo page to render');

    const panel = await openTarget(cdp, `chrome-extension://${extId}/sidepanel.html`);
    await waitFor(
      cdp, panel.sessionId,
      `!!document.querySelector('[data-testid="nb-scratch-input"]')`,
      'the side panel to load (is "Allow user scripts" enabled for this extension?)'
    );

    // Replace whatever notebooks this profile happens to hold with the demo one,
    // so the panel looks identical on every run. The panel and the service worker
    // share the extension's OPFS, so writing it from here is enough.
    if (!KEEP_STATE) {
      const seedWrites = Object.entries(DEMO_STEPS)
        .map(([rel, src]) => `await writeFile(${JSON.stringify(rel)}, ${JSON.stringify(src)});`)
        .join('\n        ');

      await evaluate(cdp, panel.sessionId, `(async () => {
        const root = await navigator.storage.getDirectory();
        for await (const name of root.keys()) {
          await root.removeEntry(name, { recursive: true });
        }
        const writeFile = async (rel, text) => {
          const parts = rel.split('/');
          let dir = root;
          for (const seg of parts.slice(0, -1)) {
            dir = await dir.getDirectoryHandle(seg, { create: true });
          }
          const handle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
          const writable = await handle.createWritable();
          await writable.write(text);
          await writable.close();
        };
        await writeFile('notebook.md', ${JSON.stringify(DEMO_NOTEBOOK)});
        ${seedWrites}
        return true;
      })()`);

      await cdp.send('Page.reload', {}, panel.sessionId);
      await waitFor(
        cdp, panel.sessionId,
        `!!document.querySelector('[data-testid="nb-scratch-input"]')`,
        'the side panel to reload after seeding'
      );
      console.log('seeded    : demo notebook (2 steps)');
    }

    // Type into the scratch box the way a person would: set the value through
    // the native setter so the framework sees a real input event, then Ctrl+Enter.
    await evaluate(cdp, panel.sessionId, `(() => {
      const input = document.querySelector('[data-testid="nb-scratch-input"]');
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setValue.call(input, ${JSON.stringify(SNIPPET)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
      return true;
    })()`);

    await waitFor(
      cdp, panel.sessionId,
      `(() => {
         const out = document.querySelector('[data-testid="nb-scratch-output"]')
                  || document.querySelector('[data-testid="nb-scratch-out"]');
         return !!out && out.textContent.trim().length > 0;
       })()`,
      'the step to produce output'
    );
    await sleep(600); // let the output finish painting

    console.log('capturing :');
    await capture(cdp, panel.sessionId, path.join(OUT_DIR, 'panel.png'), PANEL_W, PANEL_H);
    await capture(cdp, page.sessionId, path.join(OUT_DIR, 'page.png'), 1200, 760);

    console.log('done.');
  } finally {
    cdp.close();
    chrome.kill();
    server.close();
  }
}

main().catch((err) => {
  console.error(`\nscreenshot failed: ${err.message}`);
  process.exit(1);
});
