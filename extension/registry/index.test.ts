/**
 * extension/registry/index.test.ts
 * Unit tests for SiteRegistryService (D-1, D-2, D-3, RQ-06).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SiteRegistryService, normalizeSitePattern, REGISTRY_STORAGE_KEY } from './index';
import { TestStorage } from '../platform/test-adapter';

describe('T-01: SiteRegistryService', () => {
  let storage: TestStorage;
  let registry: SiteRegistryService;

  beforeEach(() => {
    storage = new TestStorage();
    registry = new SiteRegistryService(storage);
  });

  it('normalizes URL inputs and host patterns cleanly (A1-T3, F-4)', () => {
    expect(normalizeSitePattern('https://example.com/some/path')).toBe('example.com');
    expect(normalizeSitePattern('http://api.mysite.org/v1/')).toBe('api.mysite.org');
    expect(normalizeSitePattern('  GITHUB.COM/  ')).toBe('github.com');
    expect(normalizeSitePattern('*.test.local')).toBe('*.test.local');
    expect(normalizeSitePattern('example.com/dashboard')).toBe('example.com');
    expect(normalizeSitePattern('example.com:8080')).toBe('example.com');
    expect(normalizeSitePattern('https://example.com:8080/x')).toBe('example.com');
    expect(normalizeSitePattern('*.wildcard.org/path')).toBe('*.wildcard.org');
    expect(() => normalizeSitePattern('')).toThrow('Site pattern cannot be empty');
  });

  it('starts with empty list when no sites registered', async () => {
    expect(await registry.list()).toEqual([]);
  });

  it('adds site and lists it accurately (RQ-06)', async () => {
    const res = await registry.add('example.com');
    expect(res).toEqual(['example.com']);
    expect(await registry.list()).toEqual(['example.com']);

    // Persisted to storage directly (D-1)
    const stored = await storage.get<string[]>(REGISTRY_STORAGE_KEY);
    expect(stored).toEqual(['example.com']);
  });

  it('is idempotent when adding existing site (D-2, RQ-04)', async () => {
    await registry.add('example.com');
    const res = await registry.add('https://example.com/foo');
    expect(res).toEqual(['example.com']);
    expect(await registry.list()).toEqual(['example.com']);
  });

  it('maintains sorted list with multiple sites', async () => {
    await registry.add('zeta.com');
    await registry.add('alpha.org');
    await registry.add('beta.net');
    expect(await registry.list()).toEqual(['alpha.org', 'beta.net', 'zeta.com']);
  });

  it('removes registered site cleanly (D-3, RQ-05)', async () => {
    await registry.add('alpha.org');
    await registry.add('beta.net');
    const afterRemove = await registry.remove('alpha.org');
    expect(afterRemove).toEqual(['beta.net']);
    expect(await registry.list()).toEqual(['beta.net']);
  });

  it('checks isRegistered for matching hostnames and subdomains', async () => {
    await registry.add('example.com');
    await registry.add('*.wildcard.org');

    expect(await registry.isRegistered('https://example.com/p1')).toBe(true);
    expect(await registry.isRegistered('example.com')).toBe(true);
    expect(await registry.isRegistered('sub.example.com')).toBe(false);
    expect(await registry.isRegistered('https://foo.wildcard.org/app')).toBe(true);
    expect(await registry.isRegistered('unregistered.net')).toBe(false);
  });

  it('clears registry completely', async () => {
    await registry.add('site1.com');
    await registry.clear();
    expect(await registry.list()).toEqual([]);
  });
});
