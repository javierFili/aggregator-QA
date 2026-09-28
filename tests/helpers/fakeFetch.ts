import type { FetchLike } from '../../src/aggregator/AggregatorClient.js';

export interface FakeRoute {
  status?: number;
  headers?: Record<string, string>;
  body: string | object;
}

export interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
}

/** A fetch replacement driven by a URL → response map (or function). Records every request. */
export function fakeFetch(routes: Record<string, FakeRoute | ((url: string, init?: RequestInit) => FakeRoute)>): FetchLike & { calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url === k || url.startsWith(k));
    if (!key) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    const entry = routes[key]!;
    const route = typeof entry === 'function' ? entry(url, init) : entry;
    const body = typeof route.body === 'string' ? route.body : JSON.stringify(route.body);
    const contentType = typeof route.body === 'string' ? 'text/html; charset=utf-8' : 'application/json';
    return new Response(route.status && route.status >= 300 && route.status < 400 ? null : body, {
      status: route.status ?? 200,
      headers: { 'content-type': contentType, ...(route.headers ?? {}) },
    });
  }) as FetchLike & { calls: RecordedRequest[] };
  fn.calls = calls;
  return fn;
}

export function envelope(message: unknown, status = true): FakeRoute {
  return { body: { status, message } };
}
