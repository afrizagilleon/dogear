/**
 * extension/platform/fetch.ts
 * Unified background cross-origin fetch handler (D-1, D-5, RQ-04, M3 A-1).
 * Single source of truth for background fetch execution across extension contexts.
 */

export interface GmFetchRequestPayload {
  url?: string;
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
  fetchOptions?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
}

export interface GmFetchResponsePayload {
  ok: boolean;
  status?: number;
  statusText?: string;
  data?: unknown;
  text?: string;
  error?: string;
}

export async function executeGmFetch(payload: GmFetchRequestPayload): Promise<GmFetchResponsePayload> {
  try {
    const url = payload.url;
    if (!url) throw new Error('Missing URL for gmFetch');
    const fetchOpts = payload.fetchOptions || payload.options;
    const resp = await fetch(url, {
      method: fetchOpts?.method || 'GET',
      headers: fetchOpts?.headers,
      body: fetchOpts?.body,
    });
    const text = await resp.text();
    let parsedData: unknown = text;
    try {
      parsedData = JSON.parse(text);
    } catch {}
    return {
      ok: resp.ok,
      status: resp.status,
      statusText: resp.statusText,
      data: parsedData,
      text,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: msg,
    };
  }
}
