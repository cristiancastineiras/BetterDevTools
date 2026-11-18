import { parseCookieHeader } from './cookies.ts';
import type { HarEntry, Header } from './har.ts';

/** Editable request. `query` and `headers` are line-based text (`k=v`, `Name: value`; `#` comments). */
export interface Draft {
  method: string;
  url: string;
  query: string;
  headers: string;
  body: string;
  /** Send browser cookies and the captured credential headers. Off by default. */
  credentials: boolean;
  /** Captured Authorization/Cookie headers; only sent when `credentials` is on, never persisted. */
  credentialHeaders: Header[];
  /** Editable copy of the captured cookies; sent only with `sendCookies`, never persisted. */
  cookies: { name: string; value: string }[];
  sendCookies: boolean;
  /** Captured entry this draft came from, for comparison. */
  sourceId: number | null;
}

export interface BuiltRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body: string | undefined;
  credentials: 'include' | 'omit';
  /** Edited cookies to attach (fetch cannot set Cookie; the sender must). */
  cookieHeader: string | undefined;
}

const CREDENTIAL = /^(cookie|authorization|proxy-authorization)$/i;
// Fetch "forbidden request-headers" and HTTP/2 pseudo headers: the browser sets these itself.
const FORBIDDEN =
  /^(:.*|accept-charset|accept-encoding|access-control-request-.*|connection|content-length|cookie2|date|dnt|expect|host|keep-alive|origin|referer|te|trailer|transfer-encoding|upgrade|via|sec-.*|proxy-.*)$/i;

// Headers the browser adds to requests by itself. A replayed copy lets the browser add them again:
// set from fetch() they would count as script-set headers, which turns a simple cross-origin
// request into a CORS preflight the server may reject, so an untouched replay would fail.
const BROWSER_ADDED = /^(user-agent|priority|pragma|cache-control|upgrade-insecure-requests|x-client-data|purpose|accept-language)$/i;

export const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** Methods other than GET/HEAD/OPTIONS may change server state and need explicit confirmation. */
export const needsConfirmation = (method: string) => !SAFE_METHODS.includes(method.toUpperCase());

export class ReplayBlocked extends Error {}

/**
 * Guard every send path calls: a mutating request, or one carrying credentials or cookies, never
 * goes out without `confirmed`.
 */
export function assertReplayAllowed(method: string, confirmed: boolean, carriesCredentials = false): void {
  if (confirmed) return;
  if (needsConfirmation(method)) throw new ReplayBlocked(`${method} needs explicit confirmation before sending`);
  if (carriesCredentials) throw new ReplayBlocked('Sending credentials or cookies needs explicit confirmation');
}

export const carriesCredentials = (d: Pick<Draft, 'credentials' | 'sendCookies' | 'cookies'>) =>
  d.credentials || (d.sendCookies && d.cookies.length > 0);

export function draftFromEntry(har: HarEntry, sourceId: number | null = null): Draft {
  const url = har.request.url;
  const q = url.indexOf('?');
  const hash = url.indexOf('#');
  const base = url.slice(0, q < 0 ? (hash < 0 ? url.length : hash) : q);
  const query = q < 0 ? '' : url.slice(q + 1, hash < 0 ? url.length : hash);
  const headers = har.request.headers.filter((h) => !FORBIDDEN.test(h.name) && !CREDENTIAL.test(h.name) && !BROWSER_ADDED.test(h.name));
  return {
    method: har.request.method.toUpperCase(),
    url: base,
    query: query.split('&').filter(Boolean).join('\n'),
    headers: headers.map((h) => `${h.name}: ${h.value}`).join('\n'),
    body: har.request.postData?.text ?? '',
    credentials: false,
    credentialHeaders: har.request.headers.filter((h) => CREDENTIAL.test(h.name) && !/^cookie$/i.test(h.name)),
    cookies: har.request.headers
      .filter((h) => /^cookie$/i.test(h.name))
      .flatMap((h) => parseCookieHeader(h.value))
      .map(({ name, value }) => ({ name, value })),
    sendCookies: false,
    sourceId,
  };
}

export const emptyDraft = (): Draft => ({
  method: 'GET',
  url: 'https://',
  query: '',
  headers: '',
  body: '',
  credentials: false,
  credentialHeaders: [],
  cookies: [],
  sendCookies: false,
  sourceId: null,
});

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/** Resolves `{{name}}` from the active environment; unknown names are reported, not sent. */
export function buildRequest(d: Draft, vars: Record<string, string>): { request: BuiltRequest } | { error: string } {
  const missing = new Set<string>();
  const sub = (s: string) =>
    s.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k: string) => {
      if (Object.hasOwn(vars, k)) return vars[k] ?? '';
      missing.add(k);
      return m;
    });
  const url = URL.parse(sub(d.url.trim()));
  const query = lines(sub(d.query)).join('&');
  const headers: [string, string][] = [];
  for (const line of lines(sub(d.headers))) {
    const i = line.indexOf(':', 1);
    if (i < 1) return { error: `Header line without a colon: "${line}"` };
    const name = line.slice(0, i).trim();
    if (!FORBIDDEN.test(name)) headers.push([name, line.slice(i + 1).trim()]);
  }
  const body = sub(d.body);
  if (missing.size) return { error: `Unresolved variables: ${[...missing].join(', ')}` };
  if (!url || !/^https?:$/.test(url.protocol)) return { error: 'Only http:// and https:// URLs can be sent' };
  if (query) url.search = query;
  const method = d.method.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(method)) return { error: `Invalid method "${d.method}"` };
  if (d.credentials) for (const h of d.credentialHeaders) headers.push([h.name, h.value]);
  return {
    request: {
      method,
      url: url.href,
      headers,
      body: method === 'GET' || method === 'HEAD' || body === '' ? undefined : body,
      credentials: d.credentials ? 'include' : 'omit',
      cookieHeader:
        d.sendCookies && d.cookies.some((c) => c.name.trim())
          ? d.cookies
              .filter((c) => c.name.trim())
              .map((c) => `${c.name.trim()}=${sub(c.value)}`)
              .join('; ')
          : undefined,
    },
  };
}

const shellQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/** POSIX-shell cURL command; every argument is single-quoted, so no shell injection. */
export function toCurl(r: BuiltRequest): string {
  const parts = ['curl'];
  if (r.method !== 'GET') parts.push('-X', r.method);
  parts.push(shellQuote(r.url));
  for (const [k, v] of r.headers) parts.push('-H', shellQuote(`${k}: ${v}`));
  if (r.body !== undefined) parts.push('--data-raw', shellQuote(r.body));
  return parts.join(' ');
}
