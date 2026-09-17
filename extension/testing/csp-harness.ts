/**
 * extension/testing/csp-harness.ts
 * Permanent CSP test harness fixture (D-1, RQ-01).
 * Serves 8 CSP policy configurations (p0..p7) identical to M0B specification.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export const CSP_POLICIES: Record<string, string | null> = {
  p0: null,
  p1: "script-src 'self'",
  p2: "script-src 'self' blob:",
  p3: "script-src 'self' 'unsafe-eval'",
  p4: "script-src 'nonce-abc123' 'strict-dynamic'",
  p5: "script-src 'none'",
  p6: "default-src 'self'",
  p7: "script-src 'self'; sandbox allow-scripts",
};

export const PROBE_SECRET = 'main-world-secret-123';
export const PROBE_DOM_COUNT = 3; // 3 link elements with class probe-link

export interface CspServerInstance {
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
}

export function createCspHarnessServer(): http.Server {
  return http.createServer((req, res) => {
    const host = req.headers.host || '127.0.0.1';
    const parsedUrl = new URL(req.url || '/', `http://${host}`);
    const pathname = parsedUrl.pathname.toLowerCase().replace(/\/$/, '');

    // Serve /api/no-cors-secret (No Access-Control-Allow-Origin header - standard fetch from tab will fail CORS)
    if (pathname === '/api/no-cors-secret') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ secret: 'sw-cross-origin-payload-999', origin: 'csp-harness-external' }));
      return;
    }

    // Serve /preact.umd.js
    if (pathname === '/preact.umd.js') {
      const preactPath = path.resolve(process.cwd(), 'node_modules/preact/dist/preact.umd.js');
      if (fs.existsSync(preactPath)) {
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(fs.readFileSync(preactPath));
        return;
      }
    }

    // Serve /codemirror.bundle.js
    if (pathname === '/codemirror.bundle.js') {
      const cmBundlePath = path.resolve(process.cwd(), 'extension/testing/codemirror.bundle.js');
      if (fs.existsSync(cmBundlePath)) {
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(fs.readFileSync(cmBundlePath));
        return;
      }
    }

    // Serve /editors (M17 Action fixture with 5 archetypes)
    if (pathname === '/editors') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>M17 Action Fixture: Editors & Archetypes</title>
</head>
<body>
  <h1>M17 Text Editors & Action Archetypes</h1>

  <!-- 1. Plain input and textarea -->
  <section id="sec-plain">
    <h2>1. Plain Input & Textarea</h2>
    <input id="target-plain-input" value="initial-input" />
    <textarea id="target-plain-textarea">initial-textarea</textarea>
  </section>

  <!-- 2. Preact Controlled Input -->
  <section id="sec-preact">
    <h2>2. Preact Controlled Input</h2>
    <div id="preact-root"></div>
  </section>

  <!-- 3. Plain ContentEditable -->
  <section id="sec-contenteditable">
    <h2>3. Plain ContentEditable</h2>
    <div id="target-contenteditable" contenteditable="true" style="border: 1px solid #aaa; min-height: 40px; padding: 4px;">initial-contenteditable</div>
  </section>

  <!-- 4. CodeMirror 6 -->
  <section id="sec-codemirror">
    <h2>4. CodeMirror 6</h2>
    <div id="codemirror-root" style="border: 1px solid #aaa; min-height: 80px;"></div>
  </section>

  <!-- 5. Hostile Input (reverts on input event) -->
  <section id="sec-hostile">
    <h2>5. Hostile Reverting Input</h2>
    <input id="target-hostile-input" value="hostile-initial" />
  </section>

  <!-- 6. ContentEditable with prevented beforeinput (Bite-test A1-T3) -->
  <section id="sec-ce-prevented">
    <h2>6. ContentEditable with Prevented BeforeInput</h2>
    <div id="target-ce-prevented" contenteditable="true" style="border: 1px solid #aaa; min-height: 40px; padding: 4px;">initial-prevented</div>
  </section>

  <!-- Click testing: blocked and unblocked targets for T-02 -->
  <section id="sec-click-targets" style="margin-top: 20px;">
    <h2>Click Targets</h2>
    <button id="target-clickable-btn" onclick="window.__clickedTarget = true;">Clickable</button>
    <div style="position: relative; display: inline-block; margin-left: 20px;">
      <button id="target-blocked-btn" onclick="window.__clickedBlocked = true;">Blocked Button</button>
      <div id="overlay-blocking" style="position: absolute; inset: 0; background: rgba(255,0,0,0.6); z-index: 10;">OVERLAY</div>
    </div>
    <iframe id="target-iframe" src="about:blank" style="width: 200px; height: 60px; margin-left: 20px;"></iframe>
  </section>

  <!-- Scripts -->
  <script src="/preact.umd.js"></script>
  <script>
    window.addEventListener('load', () => {
      const fr = document.getElementById('target-iframe');
      if (fr && fr.contentDocument) {
        fr.contentDocument.body.innerHTML = '<button id="iframe-inner-btn" onclick="window.__clickedFrameInner = true;">Inside Frame</button>';
      }
    });
    // Event logging map for all archetypes
    window.__archetypeEvents = {
      plainInput: [],
      plainTextarea: [],
      preact: [],
      contenteditable: [],
      codemirror: [],
      hostile: []
    };

    const recordEvent = (key, evt) => {
      window.__archetypeEvents[key].push({
        type: evt.type,
        isTrusted: evt.isTrusted,
        data: evt.data,
        inputType: evt.inputType,
        key: evt.key,
        value: evt.target ? (evt.target.value !== undefined ? evt.target.value : evt.target.innerText) : null,
      });
    };

    // Plain input & textarea listeners
    const plainInp = document.getElementById('target-plain-input');
    const plainTxt = document.getElementById('target-plain-textarea');
    ['keydown', 'beforeinput', 'input', 'keyup'].forEach(ev => {
      plainInp.addEventListener(ev, e => recordEvent('plainInput', e));
      plainTxt.addEventListener(ev, e => recordEvent('plainTextarea', e));
    });

    // Hostile input
    const hostileInp = document.getElementById('target-hostile-input');
    ['keydown', 'beforeinput', 'input', 'keyup'].forEach(ev => {
      hostileInp.addEventListener(ev, e => {
        recordEvent('hostile', e);
        if (e.type === 'input') {
          hostileInp.value = 'hostile-reverted';
        }
      });
    });

    // ContentEditable
    const ceEl = document.getElementById('target-contenteditable');
    ['keydown', 'beforeinput', 'input', 'keyup'].forEach(ev => {
      ceEl.addEventListener(ev, e => recordEvent('contenteditable', e));
    });

    // ContentEditable with prevented beforeinput (Bite-test A1-T3)
    const cePreventedEl = document.getElementById('target-ce-prevented');
    if (cePreventedEl) {
      cePreventedEl.addEventListener('beforeinput', (e) => {
        e.preventDefault();
      });
    }

    // Mount Preact Controlled Input
    if (window.preact) {
      const { h, render, Component } = window.preact;
      window.__preactRenderCount = 0;
      class PreactControlledInput extends Component {
        constructor() {
          super();
          this.state = { text: 'initial-preact' };
        }
        render() {
          window.__preactRenderCount = (window.__preactRenderCount || 0) + 1;
          return h('div', { id: 'preact-container' }, [
            h('input', {
              id: 'target-preact-input',
              value: this.state.text,
              onInput: (e) => {
                recordEvent('preact', e);
                this.setState({ text: e.target.value });
              },
              onKeyDown: (e) => recordEvent('preact', e),
              onKeyUp: (e) => recordEvent('preact', e),
            }),
            h('span', { id: 'preact-state-val' }, this.state.text),
          ]);
        }
      }
      render(h(PreactControlledInput), document.getElementById('preact-root'));
      window.__preactProof = {
        isReal: typeof window.preact.render === 'function',
        version: '10.29.7',
        renderCount: window.__preactRenderCount,
      };
    }
  </script>

  <script type="module" src="/codemirror.bundle.js"></script>
  <script type="module">
    if (window.CodeMirror) {
      const state = window.CodeMirror.EditorState.create({
        doc: 'initial-codemirror',
        extensions: [window.CodeMirror.basicSetup],
      });
      const view = new window.CodeMirror.EditorView({
        state,
        parent: document.getElementById('codemirror-root'),
      });
      window.__cmView = view;
      window.__cmProof = {
        isReal: typeof view.dispatch === 'function',
        version: window.CodeMirror.version || '6.0.2',
      };
      const cmContent = document.querySelector('#codemirror-root .cm-content');
      if (cmContent) {
        ['keydown', 'beforeinput', 'input', 'keyup'].forEach(ev => {
          cmContent.addEventListener(ev, e => recordEvent('codemirror', e));
        });
      }
      window.__cmReady = true;
    }
  </script>
</body>
</html>`);
      return;
    }

    // Serve /probe.js
    if (pathname === '/probe.js') {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      });
      res.end(`window.__probe = { secret: "${PROBE_SECRET}", loadedAt: Date.now() };\nconsole.log("[probe.js] loaded, __probe set");`);
      return;
    }

    // Match policy path /p0 .. /p7
    const policyKey = pathname.replace(/^\//, '');
    if (Object.prototype.hasOwnProperty.call(CSP_POLICIES, policyKey)) {
      const csp = CSP_POLICIES[policyKey];
      const headers: Record<string, string> = {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      };
      if (csp !== null) {
        headers['Content-Security-Policy'] = csp;
      }
      res.writeHead(200, headers);
      res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>CSP Test: ${policyKey.toUpperCase()}</title>
</head>
<body>
  <h1>CSP Test: ${policyKey.toUpperCase()}</h1>
  <p id="probe-dom">DOM probe target for ${policyKey}</p>
  <button id="page-btn-action" class="page-action-btn">Page Action Button</button>
  <div id="links-container">
    <a class="probe-link" href="/link1">Link 1</a>
    <a class="probe-link" href="/link2">Link 2</a>
    <a class="probe-link" href="/link3">Link 3</a>
  </div>
  <script nonce="abc123" src="/probe.js"></script>
</body>
</html>`);
      return;
    }

    // Index page
    if (pathname === '' || pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      const links = Object.keys(CSP_POLICIES)
        .map((k) => `<li><a href="/${k}">/${k}</a> — <code>${CSP_POLICIES[k] || '(none)'}</code></li>`)
        .join('\n');
      res.end(`<!DOCTYPE html><html><body><h2>CSP Harness</h2><ul>${links}</ul></body></html>`);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });
}

export async function startCspHarness(preferredPort = 0): Promise<CspServerInstance> {
  const server = createCspHarnessServer();
  return new Promise((resolve, reject) => {
    server.listen(preferredPort, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to resolve server port'));
        return;
      }
      const port = addr.port;
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        port,
        baseUrl,
        close: () => new Promise<void>((resClose) => server.close(() => resClose())),
      });
    });
    server.on('error', reject);
  });
}

// Standalone execution support: bun extension/testing/csp-harness.ts [port]
if (process.argv[1] && (process.argv[1].endsWith('csp-harness.ts') || process.argv[1].endsWith('csp-harness.js'))) {
  const requestedPort = parseInt(process.argv[2] || '4321', 10);
  startCspHarness(requestedPort).then((inst) => {
    console.log(`[csp-harness] Server listening on ${inst.baseUrl}`);
  });
}
