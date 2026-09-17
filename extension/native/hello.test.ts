/**
 * extension/native/hello.test.ts
 * Tests for hello handshake frame creation, build detection, and profileHint (RQ-01, K-1, K-2).
 */

import { describe, it, expect } from 'vitest';
import { createHelloMessage, computeProfileHint, detectBuildType } from './hello';

describe('RQ-01 & K-1 & K-2: Hello message and profileHint', () => {
  it('1. Detects runtime build correctly from manifest without action or with runtime name', () => {
    expect(detectBuildType({ name: 'dogear runtime', version: '0.1.0' })).toBe('runtime');
    expect(detectBuildType({ name: 'dogear', version: '0.1.0' })).toBe('runtime'); // no action -> runtime
    expect(detectBuildType({ name: 'dogear', version: '0.1.0', action: { default_title: 'test' } })).toBe('studio');
  });

  it('2. createHelloMessage constructs valid HelloMessage with runtime build', () => {
    const msg = createHelloMessage({
      manifest: { name: 'dogear runtime', version: '0.1.0' },
      runtimeId: 'baacajlbmbceebginkpgoeiiakegbkka',
    });

    expect(msg.type).toBe('hello');
    expect(msg.build).toBe('runtime');
    expect(msg.extVersion).toBe('0.1.0');
    expect(msg.profileHint).toBeDefined();
    expect(typeof msg.profileHint).toBe('string');
    expect(msg.profileHint).toHaveLength(8);
  });

  it('3. createHelloMessage constructs valid HelloMessage with studio build', () => {
    const msg = createHelloMessage({
      manifest: { name: 'dogear', version: '0.1.0', action: { default_title: 'Run' } },
      runtimeId: 'baacajlbmbceebginkpgoeiiakegbkka',
    });

    expect(msg.type).toBe('hello');
    expect(msg.build).toBe('studio');
    expect(msg.extVersion).toBe('0.1.0');
    expect(msg.profileHint).toBeDefined();
  });

  it('4. K-2: profileHint is opaque, deterministic, and contains no user or path information', () => {
    const id = 'eaomghbcmcnbgkbjlfpledpejagkgalg';
    const hint1 = computeProfileHint(id);
    const hint2 = computeProfileHint(id);

    expect(hint1).toBe(hint2); // Deterministic
    expect(hint1).toMatch(/^[0-9a-f]{8}$/); // Hex opaque string
    expect(hint1).not.toContain('user');
    expect(hint1).not.toContain('asus');
    expect(hint1).not.toContain('c:');
    expect(hint1).not.toContain('/');
    expect(hint1).not.toContain('\\');
  });
});
