// scripts/check-layers.mjs
// Layer boundary enforcement script (INV-2, RQ-08)
// Asserts that no direct `chrome.` API calls exist in extension/ outside extension/platform/

import fs from 'node:fs';
import path from 'node:path';

function findFiles(dir, extFilter = ['.ts', '.js', '.mts', '.mjs', '.tsx', '.jsx']) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(findFiles(fullPath, extFilter));
    } else {
      const ext = path.extname(file);
      if (extFilter.includes(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function checkLayers() {
  console.log('[check:layers] Checking architectural layer boundaries (INV-2)...');
  const extensionDir = path.resolve('extension');
  const platformDir = path.resolve('extension/platform');
  const entrypointsDir = path.resolve('extension/entrypoints');

  const files = findFiles(extensionDir);
  const violations = [];

  for (const filePath of files) {
    const normalizedFile = path.resolve(filePath);
    // Allow chrome.* calls inside extension/platform/ and extension/entrypoints/
    if (normalizedFile.startsWith(platformDir) || normalizedFile.startsWith(entrypointsDir)) {
      continue;
    }

    const relativePath = path.relative(process.cwd(), normalizedFile);
    const content = fs.readFileSync(normalizedFile, 'utf8');
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comment lines
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        continue;
      }

      // Strip string literals to avoid false positives
      const codeWithoutStrings = line.replace(/'(?:\\'|[^'])*'|"(?:\\"|[^"])*"|`(?:\\`|[^`])*`/g, '""');

      if (/\bchrome\.[a-zA-Z0-9_]/.test(codeWithoutStrings)) {
        violations.push({
          file: relativePath,
          line: i + 1,
          content: line.trim(),
        });
      }
    }
  }

  if (violations.length > 0) {
    console.error(`[check:layers:FAIL] Found ${violations.length} architectural layer violations (direct chrome.* API calls outside platform/ and entrypoints/):`);
    for (const v of violations) {
      console.error(`  -> in ${v.file}:${v.line}: ${v.content}`);
    }
    console.error('\nDirect browser extension APIs (chrome.*) must only be accessed within extension/platform/ and extension/entrypoints/. Use PlatformAdapter.');
    process.exit(1);
  }

  // Enforcement 2 (Amandemen M2 A-2):
  // Prohibit eval, all Function constructor variants (new Function, new AsyncFunction, Function(),
  // getPrototypeOf(async function(){}).constructor), and createObjectURL across the ENTIRE extension/ directory.
  const forbiddenViolations = [];

  for (const filePath of files) {
    const normalizedFile = path.resolve(filePath);
    const relativePath = path.relative(process.cwd(), normalizedFile);
    const content = fs.readFileSync(normalizedFile, 'utf8');
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        continue;
      }

      // Strip string literals to avoid false positives on error stack/fixture strings
      const codeWithoutStrings = line.replace(/'(?:\\'|[^'])*'|"(?:\\"|[^"])*"|`(?:\\`|[^`])*`/g, '""');

      // Check for any use of eval, Function constructors, getPrototypeOf(...function), or createObjectURL
      const hasEval = /\beval\b/.test(codeWithoutStrings);
      const hasFunctionCtor = /\bnew\s+(?:Async|Generator|AsyncGenerator)?Function\b/.test(codeWithoutStrings) || /\bFunction\s*\(/.test(codeWithoutStrings);
      const hasGetPrototypeOfFn = /\bgetPrototypeOf\s*\([^)]*function/i.test(codeWithoutStrings);
      const hasCreateObjectURL = /\bcreateObjectURL\b/.test(codeWithoutStrings);

      if (hasEval || hasFunctionCtor || hasGetPrototypeOfFn || hasCreateObjectURL) {
        forbiddenViolations.push({
          file: relativePath,
          line: i + 1,
          content: line.trim(),
        });
      }
    }
  }

  if (forbiddenViolations.length > 0) {
    console.error(`[check:layers:FAIL] Found ${forbiddenViolations.length} prohibited execution constructs in extension/ (A-2):`);
    for (const v of forbiddenViolations) {
      console.error(`  -> ${v.file}:${v.line} : ${v.content}`);
    }
    console.error('\nCode in extension/ must NEVER evaluate strings locally (no eval, no Function/AsyncFunction constructors, no createObjectURL). All execution must be performed natively via browser userScripts.');
    process.exit(1);
  }

  // Enforcement 3 (Amandemen M4 A-2, F-5, diperluas M-SEL A-1):
  // Single source of truth for runtime helpers and checkpoint primitives.
  // Prohibit duplicate declarations of helper and checkpoint symbols across the codebase,
  // including inside template strings (A1-T2: kambuhan keenam).
  const canonicalOwners = {
    parkForUnload: 'extension/kernel/helpers.ts',
    sleep: 'extension/kernel/helpers.ts',
    waitFor: 'extension/kernel/helpers.ts',
    pick: 'extension/kernel/helpers.ts',
    AbortError: 'extension/kernel/helpers.ts',
    safeSnapshot: 'extension/kernel/checkpoint.ts',
    checkpointKey: 'extension/kernel/checkpoint.ts',
    autoKey: 'extension/kernel/auto.ts',
  };

  const multiDeclWhitelist = new Set([
    'extension/kernel/helpers.ts:sleep',
    'extension/kernel/helpers.ts:parkForUnload',
    'extension/kernel/helpers.ts:waitFor',
    'extension/kernel/helpers.ts:AbortError',
    'extension/kernel/checkpoint.ts:safeSnapshot',
  ]);

  const duplicateViolations = [];

  for (const filePath of files) {
    const normalizedFile = path.resolve(filePath);
    const relativePath = path.relative(process.cwd(), normalizedFile).replace(/\\/g, '/');

    // Skip test files from duplicate symbol check
    if (relativePath.includes('.test.') || relativePath.includes('/testing/')) {
      continue;
    }

    const content = fs.readFileSync(normalizedFile, 'utf8');
    const lines = content.split(/\r?\n/);

    // Count declarations per symbol in this file
    const declCounts = {};
    const declLines = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        continue;
      }

      // Check for declaration of protected helper symbols
      for (const [symbol] of Object.entries(canonicalOwners)) {
        // Matches declarations like: `const sleep =`, `function sleep(`, `class AbortError`
        const symbolDeclPattern = new RegExp(`(?:\\b(?:const|let|var)\\s+${symbol}\\s*=|\\bfunction\\s+${symbol}\\b|\\bclass\\s+${symbol}\\b)`);
        if (symbolDeclPattern.test(line)) {
          if (!declCounts[symbol]) { declCounts[symbol] = 0; declLines[symbol] = []; }
          declCounts[symbol]++;
          declLines[symbol].push(i + 1);
        }
      }
    }

    // Process accumulated declarations
    for (const [symbol, count] of Object.entries(declCounts)) {
      const canonicalPath = canonicalOwners[symbol];

      if (relativePath === canonicalPath) {
        // Canonical file: flag multi-declarations not in whitelist
        if (count > 1 && !multiDeclWhitelist.has(relativePath + ':' + symbol)) {
          duplicateViolations.push({
            symbol,
            canonicalPath,
            file: relativePath,
            line: declLines[symbol][0],
            content: `${count} declarations of '${symbol}' found in canonical file (lines ${declLines[symbol].join(', ')}) — keep exactly one canonical definition`,
          });
        }
      } else if (count > 0) {
        // Non-canonical file: any declaration is a violation
        duplicateViolations.push({
          symbol,
          canonicalPath,
          file: relativePath,
          line: declLines[symbol][0],
          content: `'${symbol}' declared outside canonical owner ${canonicalPath}`,
        });
      }
    }
  }

  if (duplicateViolations.length > 0) {
    console.error(`[check:layers:FAIL] Found ${duplicateViolations.length} duplicate helper declarations in extension/ (F-5 A-2, M-SEL A-1):`);
    for (const v of duplicateViolations) {
      console.error(`  -> Symbol '${v.symbol}' at ${v.file}:${v.line} — ${v.content}`);
    }
    console.error('\nAll runtime helpers and primitives must have exactly ONE canonical source of truth. Do not declare duplicate copies.');
    process.exit(1);
  }

  // Enforcement 4 (M6 D-1, RQ-02, F-3 A-1):
  // Single conformance suite for all ProjectStore implementations.
  // Every class implementing ProjectStore MUST be genuinely registered and executed in extension/project/conformance.test.ts.
  const conformanceTestPath = path.resolve('extension/project/conformance.test.ts');
  const conformanceRaw = fs.existsSync(conformanceTestPath) ? fs.readFileSync(conformanceTestPath, 'utf8') : '';
  
  // Strip single-line and multi-line comments from conformance.test.ts to ignore dummy comment mentions
  const conformanceCodeOnly = conformanceRaw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '');

  const unregisteredStores = [];

  for (const filePath of files) {
    const normalizedFile = path.resolve(filePath);
    const relativePath = path.relative(process.cwd(), normalizedFile).replace(/\\/g, '/');

    // Skip test files
    if (relativePath.includes('.test.') || relativePath.includes('/testing/')) {
      continue;
    }

    const content = fs.readFileSync(normalizedFile, 'utf8');
    const storeClassMatches = content.matchAll(/class\s+([A-Za-z0-9_]+)\s+implements\s+ProjectStore\b/g);

    for (const match of storeClassMatches) {
      const className = match[1];
      // Must be instantiated or registered in executable code (e.g., `new StoreName(` or `runProjectStoreConformanceSuite(..., StoreName)`)
      const registrationPattern = new RegExp(`(?:\\bnew\\s+${className}\\b|\\brunProjectStoreConformanceSuite\\s*\\([\\s\\S]*?\\b${className}\\b|\\bdescribe[\\s\\S]*?\\b${className}\\b)`);
      if (!registrationPattern.test(conformanceCodeOnly)) {
        unregisteredStores.push({
          className,
          file: relativePath,
        });
      }
    }
  }

  if (unregisteredStores.length > 0) {
    console.error(`[check:layers:FAIL] Found ${unregisteredStores.length} ProjectStore implementations NOT registered in conformance suite (M6 D-1, RQ-02, F-3 A-1):`);
    for (const s of unregisteredStores) {
      console.error(`  -> Implementation '${s.className}' in ${s.file} is missing executable registration in extension/project/conformance.test.ts`);
    }
    console.error('\nAll ProjectStore implementations MUST be genuinely registered and tested against the single conformance test suite. Register it in extension/project/conformance.test.ts.');
    process.exit(1);
  }

  // Enforcement 5 (M7 T-08, RQ-08, RQ-09, §3.3):
  // Enforce design tokens and prohibit forbidden CSS/UI features in extension/ui/ and extension/entrypoints/.
  const tokenFile = path.resolve('extension/ui/tokens.ts');
  const uiViolations = [];

  for (const filePath of files) {
    const normalizedFile = path.resolve(filePath);
    const relativePath = path.relative(process.cwd(), normalizedFile).replace(/\\/g, '/');

    // Only inspect UI components & entrypoints, skip tokens.ts and tests
    if (
      normalizedFile === tokenFile ||
      relativePath.includes('.test.') ||
      relativePath.includes('/testing/')
    ) {
      continue;
    }

    if (!relativePath.startsWith('extension/ui/') && !relativePath.startsWith('extension/entrypoints/')) {
      continue;
    }

    const content = fs.readFileSync(normalizedFile, 'utf8');
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        continue;
      }

      // 1. Literal color codes outside tokens.ts (RQ-08, INV-11)
      const colorMatch = line.match(/(#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(|\boklch\s*\(|\boklab\s*\()/);
      if (colorMatch) {
        uiViolations.push({
          type: 'literal-color',
          file: relativePath,
          line: i + 1,
          matched: colorMatch[0],
          content: trimmed,
        });
      }

      // 2. Prohibited CSS features (§3.3, RQ-09)
      const forbiddenCssMatch = line.match(/(\bbackdrop-filter\b|\bfilter:\s*blur\(|\blinear-gradient\b|\bradial-gradient\b|\bbox-shadow\b)/);
      if (forbiddenCssMatch) {
        uiViolations.push({
          type: 'prohibited-css',
          file: relativePath,
          line: i + 1,
          matched: forbiddenCssMatch[0],
          content: trimmed,
        });
      }

      // 3. Border radius > 3px (§3.3, RQ-09)
      const radiusMatch = line.match(/border-radius:\s*([1-9]\d*)px/);
      if (radiusMatch) {
        uiViolations.push({
          type: 'excessive-radius',
          file: relativePath,
          line: i + 1,
          matched: radiusMatch[0],
          content: trimmed,
        });
      }
    }
  }

  if (uiViolations.length > 0) {
    console.error(`[check:layers:FAIL] Found ${uiViolations.length} design token / UI rule violations in extension/ (RQ-08, RQ-09, §3.3):`);
    for (const v of uiViolations) {
      console.error(`  -> [${v.type}] in ${v.file}:${v.line} (${v.matched}): ${v.content}`);
    }
    console.error('\nAll UI styling must use tokens from extension/ui/tokens.ts. Literal colors, backdrop filters, box-shadows, and radii > 3px are strictly prohibited.');
    process.exit(1);
  }

  // Enforcement 6 (Milestone M-SEL, RQ-02, D-1, D-2):
  // Prohibit Indonesian protocol keys, action names, and terminal state enum values in TypeScript/JavaScript code across extension/.
  // Machine keys must be English: run, cancel, status, outcome, progress, completed, skipped, needs_review, session_dead, state, reason, version.
  const protocolViolations = [];
  const prohibitedProtocolPatterns = [
    { pattern: /\baction:\s*['"`](jalankan|batalkan)['"`]/, name: 'prohibited-action-key' },
    { pattern: /\btype:\s*['"`](keadaan_akhir|kemajuan)['"`]/, name: 'prohibited-message-type' },
    { pattern: /\b(keadaan|alasan|versi)\s*:\s*['"`]/, name: 'prohibited-protocol-key' },
    { pattern: /\b(state|status|keadaan)\s*:\s*['"`](selesai|dilewati|perlu_dicek|sesi_mati)['"`]/, name: 'prohibited-state-value' },
    { pattern: /(===|!==)\s*['"`](selesai|dilewati|perlu_dicek|sesi_mati)['"`]/, name: 'prohibited-state-comparison' },
    { pattern: /['"`](selesai|dilewati|perlu_dicek|sesi_mati)['"`]\s*(===|!==)/, name: 'prohibited-state-comparison' },
    { pattern: /\bcase\s*['"`](selesai|dilewati|perlu_dicek|sesi_mati)['"`]/, name: 'prohibited-state-case' },
    { pattern: /\.(keadaan|alasan)\b/, name: 'prohibited-property-access' },
    { pattern: /\b(type\s+KeadaanAkhir|interface\s+PesanHost|interface\s+PesanDogear|interface\s+JawabanJalankan)\b/, name: 'prohibited-protocol-type-name' },
  ];

  for (const filePath of files) {
    const normalizedFile = path.resolve(filePath);
    const relativePath = path.relative(process.cwd(), normalizedFile);
    const content = fs.readFileSync(normalizedFile, 'utf8');
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      // Skip comments
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        continue;
      }

      for (const { pattern, name } of prohibitedProtocolPatterns) {
        const match = line.match(pattern);
        if (match) {
          protocolViolations.push({
            type: name,
            file: relativePath,
            line: i + 1,
            matched: match[0],
            content: trimmed,
          });
        }
      }
    }
  }

  if (protocolViolations.length > 0) {
    console.error(`[check:layers:FAIL] Found ${protocolViolations.length} prohibited Indonesian protocol key/state violations in extension/ (RQ-02, D-1, D-2):`);
    for (const v of protocolViolations) {
      console.error(`  -> [${v.type}] in ${v.file}:${v.line} (${v.matched}): ${v.content}`);
    }
    console.error('\nNative protocol keys, types, and terminal states must be in English (run, cancel, outcome, completed, skipped, needs_review, session_dead, state, reason, version).');
    process.exit(1);
  }

  // Enforcement 7 (M14 D-6, INV-17):
  // Reject rendered elements whose only attribute is data-testid.
  const inv17Violations = [];
  const skipAttr = new Set(['key', 'ref']);

  function skipQuoted(content, i) {
    const q = content[i];
    i++;
    while (i < content.length) {
      if (content[i] === '\\') {
        i += 2;
        continue;
      }
      if (content[i] === q) return i;
      i++;
    }
    return i;
  }

  function extractObjectLiteral(content, braceStart) {
    let depth = 0;
    for (let i = braceStart; i < content.length; i++) {
      const ch = content[i];
      if (ch === "'" || ch === '"' || ch === '`') {
        i = skipQuoted(content, i);
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return content.slice(braceStart, i + 1);
      }
    }
    return null;
  }

  function objectKeys(objSrc) {
    const keys = [];
    const body = objSrc.slice(1, -1);
    let i = 0;
    let depth = 0;
    let token = '';
    while (i < body.length) {
      const ch = body[i];
      if (ch === "'" || ch === '"' || ch === '`') {
        const start = i;
        i = skipQuoted(body, i);
        if (depth === 0) token += body.slice(start, i + 1);
        i++;
        continue;
      }
      if (ch === '{' || ch === '[' || ch === '(') depth++;
      if (ch === '}' || ch === ']' || ch === ')') depth--;
      if (depth === 0 && ch === ':') {
        const key = token.trim().replace(/^['"]|['"]$/g, '');
        if (key) keys.push(key);
        token = '';
        i++;
        continue;
      }
      if (depth === 0 && ch === ',') {
        token = '';
        i++;
        continue;
      }
      if (depth === 0) token += ch;
      i++;
    }
    return keys;
  }

  function lineNumberAt(content, index) {
    return content.slice(0, index).split(/\r?\n/).length;
  }

  for (const filePath of files) {
    const normalizedFile = path.resolve(filePath);
    const relativePath = path.relative(process.cwd(), normalizedFile).replace(/\\/g, '/');
    if (relativePath.includes('.test.') || relativePath.includes('/testing/')) continue;
    if (!relativePath.startsWith('extension/ui/') && !relativePath.startsWith('extension/entrypoints/')) continue;

    const content = fs.readFileSync(normalizedFile, 'utf8');

    const hRe = /\bh\s*\(\s*(['"`][^'"`]+['"`])\s*,\s*\{/g;
    let hm;
    while ((hm = hRe.exec(content))) {
      const braceStart = hm.index + hm[0].length - 1;
      const objSrc = extractObjectLiteral(content, braceStart);
      if (!objSrc) continue;
      const keys = objectKeys(objSrc);
      if (!keys.includes('data-testid')) continue;
      const rendered = keys.filter((k) => !skipAttr.has(k) && !/^on[A-Z]/.test(k));
      if (rendered.length === 1 && rendered[0] === 'data-testid') {
        inv17Violations.push({
          file: relativePath,
          line: lineNumberAt(content, hm.index),
          content: hm[0].slice(0, 80),
        });
      }
    }

    const htmlRe = /<([a-zA-Z][\w-]*)([^>]*data-testid[^>]*)>/g;
    let htmlm;
    while ((htmlm = htmlRe.exec(content))) {
      const attrs = htmlm[2];
      const names = [...attrs.matchAll(/([:@a-zA-Z_][\w:-]*)\s*=/g)].map((x) => x[1]);
      if (names.length === 1 && names[0] === 'data-testid') {
        inv17Violations.push({
          file: relativePath,
          line: lineNumberAt(content, htmlm.index),
          content: htmlm[0].slice(0, 120),
        });
      }
    }

    const createRe = /(?:const|let|var)\s+([A-Za-z_][\w]*)\s*=\s*document\.createElement\s*\(/g;
    let cm;
    while ((cm = createRe.exec(content))) {
      const ident = cm[1];
      const identRe = new RegExp(`\\b${ident}\\.(className|id|classList|setAttribute)\\s*(=|\\()`, 'g');
      const attrs = new Set();
      let am;
      while ((am = identRe.exec(content))) {
        if (am[1] === 'className' || am[1] === 'classList') attrs.add('class');
        else if (am[1] === 'id') attrs.add('id');
        else if (am[1] === 'setAttribute') {
          const call = content.slice(am.index, am.index + 80);
          const name = call.match(/setAttribute\s*\(\s*['"]([^'"]+)['"]/);
          if (name) attrs.add(name[1]);
        }
      }
      if (attrs.has('data-testid') && attrs.size === 1) {
        const testidLine = content.split(/\r?\n/).findIndex((ln) => ln.includes(`${ident}.setAttribute`) && ln.includes('data-testid')) + 1;
        inv17Violations.push({
          file: relativePath,
          line: testidLine || lineNumberAt(content, cm.index),
          content: `${ident} rendered with only data-testid`,
        });
      }
    }
  }

  if (inv17Violations.length > 0) {
    console.error(`[check:layers:FAIL] Found ${inv17Violations.length} INV-17 violations (data-testid as the only rendered attribute):`);
    for (const v of inv17Violations) {
      console.error(`  -> ${v.file}:${v.line}: ${v.content}`);
    }
    console.error('\nEvery human-visible element must have its own class (INV-17). data-testid cannot be the only attribute.');
    process.exit(1);
  }

  console.log(`[check:layers:PASS] Clean! Checked ${files.length} files in extension/ — zero leaks outside platform/, zero prohibited execution primitives, zero duplicate helper declarations, all ProjectStore implementations registered in conformance suite, zero UI token/forbidden style violations, zero prohibited Indonesian protocol keys, and zero INV-17 data-testid-only elements.`);
  process.exit(0);
}

checkLayers();
