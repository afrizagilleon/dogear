/**
 * extension/registry/index.ts
 * Site registry management (D-1, D-2, D-3, RQ-06).
 * Persists registered websites to platform storage without requiring manifest edits or extension reinstallation.
 */

import type { StorageArea } from '../platform/interface';
import { getPlatformAdapter } from '../platform';

export const REGISTRY_STORAGE_KEY = 'nb:registry:sites';

export function normalizeSitePattern(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Site pattern cannot be empty');
  }

  // Handle wildcard pattern (e.g. *.example.com or *.example.com/path)
  if (trimmed.startsWith('*.')) {
    const withoutWildcard = trimmed.slice(2);
    const cleanSub = normalizeSitePattern(withoutWildcard);
    return `*.${cleanSub}`;
  }

  // If input lacks scheme (e.g. example.com/dashboard or example.com:8080/x), prepend dummy scheme for URL parsing
  const withScheme = (trimmed.startsWith('http://') || trimmed.startsWith('https://'))
    ? trimmed
    : `http://${trimmed}`;

  try {
    const u = new URL(withScheme);
    if (u.hostname) {
      return u.hostname.toLowerCase();
    }
  } catch {
    // Fall back to manual sanitization
  }

  // Strip path, query, hash, and port manually if URL parse fails
  const noPath = trimmed.split('/')[0].split('?')[0].split('#')[0];
  const noPort = noPath.split(':')[0];
  return noPort.toLowerCase();
}

export class SiteRegistryService {
  constructor(private storage?: StorageArea) {}

  private getStorage(): StorageArea {
    return this.storage || getPlatformAdapter().storage;
  }

  async list(): Promise<string[]> {
    const list = await this.getStorage().get<string[]>(REGISTRY_STORAGE_KEY);
    if (!Array.isArray(list)) return [];
    return Array.from(new Set(list)).sort();
  }

  async add(patternOrHost: string): Promise<string[]> {
    const normalized = normalizeSitePattern(patternOrHost);
    const current = await this.list();
    if (!current.includes(normalized)) {
      current.push(normalized);
      current.sort();
      await this.getStorage().set(REGISTRY_STORAGE_KEY, current);
    }
    return current;
  }

  async remove(patternOrHost: string): Promise<string[]> {
    const normalized = normalizeSitePattern(patternOrHost);
    const current = await this.list();
    const filtered = current.filter((s) => s !== normalized);
    await this.getStorage().set(REGISTRY_STORAGE_KEY, filtered);
    return filtered;
  }

  async isRegistered(urlOrHost: string): Promise<boolean> {
    if (!urlOrHost) return false;
    let targetHost = urlOrHost.toLowerCase().trim();
    try {
      const withScheme = (targetHost.startsWith('http://') || targetHost.startsWith('https://'))
        ? targetHost
        : `http://${targetHost}`;
      const u = new URL(withScheme);
      if (u.hostname) {
        targetHost = u.hostname.toLowerCase();
      }
    } catch {
      targetHost = targetHost.split('/')[0].split('?')[0].split('#')[0].split(':')[0].toLowerCase();
    }
    const sites = await this.list();
    return sites.some((site) => {
      if (site === targetHost) return true;
      if (site.startsWith('*.')) {
        const domain = site.slice(2);
        return targetHost === domain || targetHost.endsWith('.' + domain);
      }
      return false;
    });
  }

  async clear(): Promise<void> {
    await this.getStorage().remove(REGISTRY_STORAGE_KEY);
  }
}

export const siteRegistry = new SiteRegistryService();
