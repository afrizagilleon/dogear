// scripts/check-protocol-keys.mjs
// Mechanical gate enforcing English protocol keys and states across extension/ (T-03, RQ-02, D-1, D-2)

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

export function checkProtocolKeys() {
  console.log('[check:protocol-keys] Checking for prohibited Indonesian protocol keys/states in extension/ (RQ-02, D-1, D-2)...');
  const extensionDir = path.resolve('extension');
  const files = findFiles(extensionDir);
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
    console.error(`[check:protocol-keys:FAIL] Found ${protocolViolations.length} prohibited Indonesian protocol key/state violations in extension/ (RQ-02, D-1, D-2):`);
    for (const v of protocolViolations) {
      console.error(`  -> [${v.type}] in ${v.file}:${v.line} (${v.matched}): ${v.content}`);
    }
    console.error('\nNative protocol keys, types, and terminal states must be in English (run, cancel, outcome, completed, skipped, needs_review, session_dead, state, reason, version).');
    process.exit(1);
  }

  console.log(`[check:protocol-keys:PASS] Clean! Checked ${files.length} files in extension/ — zero prohibited Indonesian protocol keys or states found.`);
  return true;
}

if (process.argv[1] && process.argv[1].endsWith('check-protocol-keys.mjs')) {
  checkProtocolKeys();
}
