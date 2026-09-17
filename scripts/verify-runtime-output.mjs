// scripts/verify-runtime-output.mjs
// Mechanical verification gate for runtime build output (M-SPLIT, RQ-02, RQ-04, INV-12).
// Inspects the filesystem contents of .output/runtime and rejects any files or manifest fields
// originating from sidepanel, editor, or authoring surfaces.

import fs from 'node:fs';
import path from 'node:path';

function findFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(findFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function verifyRuntimeOutput() {
  console.log('[verify:runtime] Checking runtime build output in .output/runtime (RQ-02, RQ-04, INV-12)...');
  const runtimeDir = path.resolve('.output/runtime');

  if (!fs.existsSync(runtimeDir)) {
    console.error(`[verify:runtime:FAIL] Runtime directory not found: ${runtimeDir}`);
    console.error('Run "bun run build:runtime" before verifying.');
    process.exit(1);
  }

  const files = findFiles(runtimeDir);
  const violations = [];

  // Forbidden patterns: any file or chunk originating from sidepanel or editor
  const forbiddenPatterns = [
    /\bsidepanel\b/i,
    /\beditor\b/i,
    /\bpanel\b/i,
  ];

  for (const filePath of files) {
    const relPath = path.relative(runtimeDir, filePath).replace(/\\/g, '/');
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(relPath)) {
        violations.push({
          type: 'prohibited-file',
          file: relPath,
          reason: `File matches forbidden authoring pattern ${pattern}`,
        });
      }
    }
  }

  // Inspect manifest.json
  const manifestPath = path.join(runtimeDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    violations.push({
      type: 'missing-manifest',
      file: 'manifest.json',
      reason: 'manifest.json does not exist in .output/runtime',
    });
  } else {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      if (manifest.side_panel !== undefined) {
        violations.push({
          type: 'prohibited-manifest-field',
          file: 'manifest.json',
          reason: 'manifest.json contains prohibited field "side_panel" (D-3)',
        });
      }
      if (manifest.action !== undefined) {
        violations.push({
          type: 'prohibited-manifest-field',
          file: 'manifest.json',
          reason: 'manifest.json contains prohibited field "action" (D-3)',
        });
      }
      if (manifest.commands !== undefined) {
        violations.push({
          type: 'prohibited-manifest-field',
          file: 'manifest.json',
          reason: 'manifest.json contains prohibited field "commands" (D-3)',
        });
      }
      if (Array.isArray(manifest.permissions) && manifest.permissions.includes('sidePanel')) {
        violations.push({
          type: 'prohibited-permission',
          file: 'manifest.json',
          reason: 'manifest.json contains prohibited permission "sidePanel" (D-3)',
        });
      }
    } catch (e) {
      violations.push({
        type: 'invalid-manifest',
        file: 'manifest.json',
        reason: `manifest.json could not be parsed: ${e.message}`,
      });
    }
  }

  // ── Wakeup symbol guard (A2-T02, F-7 regression prevention) ─────────────────
  // Verifies that chrome.runtime.onStartup, chrome.alarms.onAlarm, and chrome.alarms.create
  // are present in background.js.
  //
  // HONEST CAVEAT: This gate proves the code EXISTS in the compiled bundle.
  // It does NOT prove Chrome ever ran these listeners. F-7 occurred precisely in the state
  // where all three symbols were present and none of them ran. This gate closes regressions
  // (accidental deletion), not F-7 itself.
  const backgroundJsPath = path.join(runtimeDir, 'background.js');
  if (!fs.existsSync(backgroundJsPath)) {
    violations.push({
      type: 'missing-background-js',
      file: 'background.js',
      reason: 'background.js does not exist in .output/runtime',
    });
  } else {
    const bgJs = fs.readFileSync(backgroundJsPath, 'utf8');
    const requiredSymbols = [
      { symbol: 'onStartup', description: 'chrome.runtime.onStartup registration (RQ-11, A2-T02)' },
      { symbol: 'onAlarm', description: 'chrome.alarms.onAlarm registration (RQ-11, A2-T02)' },
      { symbol: 'alarms.create', description: 'chrome.alarms.create call (RQ-11, A2-T02)' },
    ];
    for (const { symbol, description } of requiredSymbols) {
      if (!bgJs.includes(symbol)) {
        violations.push({
          type: 'missing-wakeup-symbol',
          file: 'background.js',
          reason: `Symbol '${symbol}' not found in background.js — ${description}`,
        });
      }
    }
  }

  if (violations.length > 0) {
    console.error(`[verify:runtime:FAIL] Found ${violations.length} violation(s) in .output/runtime:`);
    for (const v of violations) {
      console.error(`  -> [${v.type}] ${v.file}: ${v.reason}`);
    }
    console.error('\nRuntime build must NEVER bundle sidepanel, editor, or authoring surfaces (INV-12, D-2, D-3).');
    console.error('Runtime build MUST contain onStartup, onAlarm, and alarms.create symbols (RQ-11, A2-T02).');
    process.exit(1);
  }

  console.log(`[verify:runtime:PASS] Clean! Checked ${files.length} files in .output/runtime — zero panel/editor files, zero prohibited manifest fields, all wakeup symbols present.`);
  process.exit(0);
}

verifyRuntimeOutput();

