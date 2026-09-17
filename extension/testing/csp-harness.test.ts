/**
 * extension/testing/csp-harness.test.ts
 * Tests for CSP test harness server fixture (RQ-01, INV-4).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startCspHarness, CSP_POLICIES, PROBE_SECRET, type CspServerInstance } from './csp-harness';

describe('CSP Test Harness Server', () => {
  let harness: CspServerInstance;

  beforeAll(async () => {
    harness = await startCspHarness(0);
  });

  afterAll(async () => {
    if (harness) {
      await harness.close();
    }
  });

  it('p0 does not send Content-Security-Policy header', async () => {
    const res = await fetch(`${harness.baseUrl}/p0`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBeNull();
  });

  it('p5 sends exact Content-Security-Policy header "script-src \'none\'"', async () => {
    const res = await fetch(`${harness.baseUrl}/p5`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe("script-src 'none'");
  });

  it('verifies all 8 policies p0..p7 return correct exact headers', async () => {
    for (const [key, expectedCsp] of Object.entries(CSP_POLICIES)) {
      const res = await fetch(`${harness.baseUrl}/${key}`);
      expect(res.status).toBe(200);
      const actualCsp = res.headers.get('content-security-policy');
      expect(actualCsp).toBe(expectedCsp);
    }
  });

  it('serves /probe.js with probe secret', async () => {
    const res = await fetch(`${harness.baseUrl}/probe.js`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(`secret: "${PROBE_SECRET}"`);
  });
});
