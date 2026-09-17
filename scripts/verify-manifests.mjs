// scripts/verify-manifests.mjs
// Content verification script for generated extension manifests (M1 Amendment A-1)
// Enforces that both Chrome and Firefox targets produce valid MV3 manifests with correct background shape and permissions.

import fs from 'node:fs';
import path from 'node:path';

function verifyManifests() {
  console.log('[verify:manifests] Verifying build manifests for Chrome and Firefox targets...');
  let hasErrors = false;
  const errors = [];

  function fail(msg) {
    hasErrors = true;
    errors.push(msg);
  }

  const chromePath = path.resolve('.output/chrome-mv3/manifest.json');
  const firefoxPath = path.resolve('.output/firefox-mv3/manifest.json');

  if (!fs.existsSync(chromePath)) {
    fail(`[REJECT: missing manifest] Chrome manifest not found at ${chromePath}`);
  }
  if (!fs.existsSync(firefoxPath)) {
    fail(`[REJECT: missing manifest] Firefox manifest not found at ${firefoxPath}`);
  }

  if (hasErrors) {
    console.error('[verify:manifests:FAIL] Missing build output files:');
    for (const e of errors) console.error(`  -> ${e}`);
    process.exit(1);
  }

  const chromeManifest = JSON.parse(fs.readFileSync(chromePath, 'utf8'));
  const firefoxManifest = JSON.parse(fs.readFileSync(firefoxPath, 'utf8'));

  // 1. Both manifests must have manifest_version === 3
  if (chromeManifest.manifest_version !== 3) {
    fail(`[REJECT: chrome manifest_version] Expected manifest_version === 3, found ${chromeManifest.manifest_version}`);
  }
  if (firefoxManifest.manifest_version !== 3) {
    fail(`[REJECT: firefox manifest_version] Expected manifest_version === 3, found ${firefoxManifest.manifest_version} (violates A-1)`);
  }

  // 2. Chrome must have background.service_worker
  if (!chromeManifest.background?.service_worker) {
    fail('[REJECT: chrome background] Chrome MV3 manifest missing background.service_worker');
  }

  // 3. Firefox must have MV3 background shape (background.scripts array)
  if (!Array.isArray(firefoxManifest.background?.scripts) || firefoxManifest.background.scripts.length === 0) {
    fail('[REJECT: firefox background] Firefox MV3 manifest missing background.scripts array');
  }

  // 4. Chrome permissions must contain required permissions including alarms (D-22, T-06, RQ-11)
  const expectedChromePermissions = ['scripting', 'storage', 'offscreen', 'userScripts', 'activeTab', 'alarms'];
  const chromePerms = chromeManifest.permissions || [];
  for (const p of expectedChromePermissions) {
    if (!chromePerms.includes(p)) {
      fail(`[REJECT: chrome permissions missing] Chrome manifest missing required permission: "${p}"`);
    }
  }

  // 6. Runtime manifest (if built) must contain alarms (RQ-11)
  const runtimePath = path.resolve('.output/runtime/manifest.json');
  if (fs.existsSync(runtimePath)) {
    const runtimeManifest = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    const runtimePerms = runtimeManifest.permissions || [];
    if (!runtimePerms.includes('alarms')) {
      fail('[REJECT: runtime permissions missing] Runtime manifest missing required permission: "alarms" (RQ-11)');
    }
  }

  // 5. Firefox permissions must contain 4 permissions (without offscreen)
  const expectedFirefoxPermissions = ['scripting', 'storage', 'userScripts', 'activeTab'];
  const firefoxPerms = firefoxManifest.permissions || [];
  for (const p of expectedFirefoxPermissions) {
    if (!firefoxPerms.includes(p)) {
      fail(`[REJECT: firefox permissions missing] Firefox manifest missing required permission: "${p}"`);
    }
  }
  if (firefoxPerms.includes('offscreen')) {
    fail('[REJECT: firefox unexpected permission] Firefox manifest contains unsupported permission "offscreen"');
  }

  if (hasErrors) {
    console.error(`[verify:manifests:FAIL] Verification failed with ${errors.length} errors:`);
    for (const e of errors) console.error(`  -> ${e}`);
    process.exit(1);
  }

  console.log('[verify:manifests:PASS] Both Chrome and Firefox MV3 manifests verified successfully:');
  console.log(`  -> Chrome  : MV${chromeManifest.manifest_version}, service_worker: ${chromeManifest.background.service_worker}, permissions: [${chromePerms.join(', ')}]`);
  console.log(`  -> Firefox : MV${firefoxManifest.manifest_version}, scripts: [${firefoxManifest.background.scripts.join(', ')}], permissions: [${firefoxPerms.join(', ')}]`);
  process.exit(0);
}

verifyManifests();
