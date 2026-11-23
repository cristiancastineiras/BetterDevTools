import { cookiesOf } from './cookies.ts';
import type { Captured, Header } from './har.ts';

// Security and CORS diagnosis from what the browser recorded: the rules look at headers, methods
// and failures only, never at bodies. Each finding carries a stable `code`; the panel turns it
// into an explanation and a fix in the user's language.

export type Severity = 'high' | 'medium' | 'low' | 'info';
export type FindingCategory = 'cors' | 'csp' | 'cookies' | 'headers' | 'mixed-content' | 'tls';

export interface Finding {
  code: string;
  severity: Severity;
  category: FindingCategory;
  /** What it is about: an origin, a cookie name, a header value. */
  subject: string;
  /** Values the explanation mentions (a header list, an error text…). */
  params: Record<string, string>;
  /** Ids of the captured requests that show it, at most MAX_REQUESTS_PER_FINDING. */
  requests: number[];
  count: number;
}

export const MAX_REQUESTS_PER_FINDING = 50;
const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

const value = (headers: Header[], name: string): string | undefined => headers.find((h) => h.name.toLowerCase() === name)?.value;
const lower = (headers: Header[], name: string) => value(headers, name)?.trim().toLowerCase();
const list = (text: string | undefined) =>
  (text ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/** `script-src 'self' https:` → directive → sources, lower-cased. */
export function parseCsp(policy: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name && !out.has(name.toLowerCase()))
      out.set(
        name.toLowerCase(),
        sources.map((s) => s.toLowerCase()),
      );
  }
  return out;
}

const ACTIVE_TYPES = new Set(['script', 'stylesheet', 'xhr', 'fetch', 'websocket', 'document', 'font', 'other']);
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|.*\.localhost)(:\d+)?$/;
const CERT_ERROR = /CERT|SSL|SEC_ERROR|SSL_ERROR|certificate/i;
const VERSIONED = /\d+\.\d+/;
const HSTS_MIN_SECONDS = 15_552_000; // 180 days

/** Findings for a set of captured requests, most severe first. */
export function analyzeSecurity(requests: readonly Captured[]): Finding[] {
  const found = new Map<string, Finding>();
  const add = (
    code: string,
    severity: Severity,
    category: FindingCategory,
    subject: string,
    id: number,
    params: Record<string, string> = {},
  ) => {
    const key = `${code}\u0000${subject}`;
    let finding = found.get(key);
    if (!finding) found.set(key, (finding = { code, severity, category, subject, params, requests: [], count: 0 }));
    finding.count++;
    if (finding.requests.length < MAX_REQUESTS_PER_FINDING && !finding.requests.includes(id)) finding.requests.push(id);
  };

  const pageIsHttps =
    requests.some((c) => (c.type === 'document' || !c.type) && c.url.startsWith('https:')) &&
    !requests.some((c) => c.type === 'document' && c.url.startsWith('http:') && !LOCAL_HOST.test(c.host));

  for (const c of requests) {
    const { request: rq, response: rs } = c.har;
    const url = URL.parse(c.url);
    if (!url) continue;
    const secure = url.protocol === 'https:' || url.protocol === 'wss:';
    const isDocument = c.type === 'document' || (!c.type && c.mime === 'text/html');
    const origin = lower(rq.headers, 'origin') ?? '';
    const crossOrigin = origin !== '' && origin !== url.origin;
    const where = url.origin;

    // ----------------------------------------------------------------------------------- TLS
    if (c.error && CERT_ERROR.test(c.error)) add('tls-error', 'high', 'tls', url.host, c.id, { error: c.error });

    // ------------------------------------------------------------------------ mixed content
    if (pageIsHttps && !secure && !LOCAL_HOST.test(url.host) && /^(http|ws):$/.test(url.protocol)) {
      add(
        ACTIVE_TYPES.has(c.type) || !c.type ? 'mixed-active' : 'mixed-passive',
        ACTIVE_TYPES.has(c.type) || !c.type ? 'high' : 'medium',
        'mixed-content',
        url.host,
        c.id,
      );
    }
    if (isDocument && url.protocol === 'http:' && !LOCAL_HOST.test(url.host)) add('no-tls', 'medium', 'tls', url.host, c.id);

    // ------------------------------------------------------------------------------- CORS
    const preflight = rq.method.toUpperCase() === 'OPTIONS' && lower(rq.headers, 'access-control-request-method') !== undefined;
    const allowOrigin = lower(rs.headers, 'access-control-allow-origin');
    const allowCredentials = lower(rs.headers, 'access-control-allow-credentials') === 'true';
    if (preflight) {
      const wantedMethod = (lower(rq.headers, 'access-control-request-method') ?? '').toUpperCase();
      const wantedHeaders = list(value(rq.headers, 'access-control-request-headers'));
      if (c.status >= 300 && c.status < 400) add('cors-preflight-redirect', 'high', 'cors', where, c.id, { status: String(c.status) });
      else if (!c.status || c.status >= 400)
        add('cors-preflight-failed', 'high', 'cors', where, c.id, { status: String(c.status || c.error || 'failed') });
      else {
        if (allowOrigin === undefined) add('cors-missing-allow-origin', 'high', 'cors', where, c.id);
        const methods = list(value(rs.headers, 'access-control-allow-methods')).map((m) => m.toUpperCase());
        if (
          !methods.includes(wantedMethod) &&
          !(methods.includes('*') && !allowCredentials) &&
          !['GET', 'HEAD', 'POST'].includes(wantedMethod)
        )
          add('cors-preflight-method', 'high', 'cors', where, c.id, { method: wantedMethod, allowed: methods.join(', ') || '—' });
        const allowed = list(value(rs.headers, 'access-control-allow-headers'));
        const missing = wantedHeaders.filter(
          (h) => !allowed.includes(h) && !(allowed.includes('*') && !allowCredentials && h !== 'authorization'),
        );
        if (missing.length) add('cors-preflight-headers', 'high', 'cors', where, c.id, { missing: missing.join(', ') });
      }
    } else if (crossOrigin) {
      if (!c.status && c.error) add('cors-blocked', 'high', 'cors', where, c.id, { error: c.error });
      else if (c.status) {
        if (allowOrigin === undefined) add('cors-missing-allow-origin', 'high', 'cors', where, c.id);
        else if (allowOrigin === '*' && allowCredentials) add('cors-wildcard-credentials', 'high', 'cors', where, c.id);
        else if (allowOrigin === 'null') add('cors-null-origin', 'medium', 'cors', where, c.id);
        else if (allowOrigin !== '*' && allowOrigin !== origin)
          add('cors-origin-mismatch', 'high', 'cors', where, c.id, { allowed: allowOrigin, origin });
        else if (
          allowOrigin !== '*' &&
          !list(value(rs.headers, 'vary')).includes('origin') &&
          !list(value(rs.headers, 'vary')).includes('*')
        )
          add('cors-no-vary', 'low', 'cors', where, c.id);
      }
    }

    // --------------------------------------------------------------------------- cookies
    for (const cookie of cookiesOf(c.har).response) {
      const sameSite = (cookie.sameSite ?? '').toLowerCase();
      const subject = `${cookie.name} (${url.host})`;
      if (sameSite === 'none' && !cookie.secure) add('cookie-samesite-none-insecure', 'high', 'cookies', subject, c.id);
      if (cookie.name.startsWith('__Host-') && (!cookie.secure || cookie.domain || cookie.path !== '/'))
        add('cookie-host-prefix', 'high', 'cookies', subject, c.id);
      else if (cookie.name.startsWith('__Secure-') && !cookie.secure) add('cookie-secure-prefix', 'high', 'cookies', subject, c.id);
      if (!cookie.secure && secure && sameSite !== 'none') add('cookie-no-secure', 'medium', 'cookies', subject, c.id);
      if (!cookie.httpOnly)
        add('cookie-no-httponly', /sess|sid|token|auth|jwt/i.test(cookie.name) ? 'medium' : 'low', 'cookies', subject, c.id);
      if (!sameSite) add('cookie-no-samesite', 'low', 'cookies', subject, c.id);
    }

    // ---------------------------------------------------------------- headers of any response
    for (const name of ['server', 'x-powered-by', 'x-aspnet-version']) {
      const text = value(rs.headers, name);
      if (text && VERSIONED.test(text)) add('version-leak', 'low', 'headers', `${name}: ${text}`, c.id);
    }
    const setsCookie =
      rs.headers.some((h) => h.name.toLowerCase() === 'set-cookie') || rq.headers.some((h) => h.name.toLowerCase() === 'authorization');
    if (
      setsCookie &&
      c.status >= 200 &&
      c.status < 300 &&
      !/no-store|private/.test(lower(rs.headers, 'cache-control') ?? '') &&
      !isDocument
    )
      add('cache-sensitive', 'low', 'headers', url.host, c.id);

    // -------------------------------------------------------------- documents: CSP and friends
    if (!isDocument || c.status < 200 || c.status >= 400) continue;
    const csp = value(rs.headers, 'content-security-policy');
    const reportOnly = value(rs.headers, 'content-security-policy-report-only');
    if (csp === undefined)
      add(reportOnly === undefined ? 'csp-missing' : 'csp-report-only', reportOnly === undefined ? 'medium' : 'low', 'csp', url.host, c.id);
    else {
      const policy = parseCsp(csp);
      const scripts = policy.get('script-src') ?? policy.get('default-src') ?? [];
      const strict = scripts.some((s) => s.startsWith("'nonce-") || s.startsWith("'sha") || s === "'strict-dynamic'");
      if (scripts.includes("'unsafe-inline'") && !strict) add('csp-unsafe-inline', 'high', 'csp', url.host, c.id);
      if (scripts.includes("'unsafe-eval'")) add('csp-unsafe-eval', 'medium', 'csp', url.host, c.id);
      const broad = scripts.filter((s) => ['*', 'data:', 'http:', 'blob:'].includes(s));
      if (broad.length) add('csp-wildcard', 'high', 'csp', url.host, c.id, { sources: broad.join(' ') });
      else if (scripts.includes('https:') && !strict) add('csp-wildcard', 'medium', 'csp', url.host, c.id, { sources: 'https:' });
      if (!policy.has('object-src') && !policy.has('default-src')) add('csp-no-object-src', 'low', 'csp', url.host, c.id);
      if (!policy.has('base-uri')) add('csp-no-base-uri', 'low', 'csp', url.host, c.id);
    }
    if (secure) {
      const hsts = lower(rs.headers, 'strict-transport-security');
      if (hsts === undefined) add('hsts-missing', 'medium', 'headers', url.host, c.id);
      else if (Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0) < HSTS_MIN_SECONDS)
        add('hsts-weak', 'low', 'headers', url.host, c.id, { value: hsts });
    }
    if (lower(rs.headers, 'x-content-type-options') !== 'nosniff') add('nosniff-missing', 'low', 'headers', url.host, c.id);
    if (lower(rs.headers, 'x-frame-options') === undefined && !/frame-ancestors/.test(lower(rs.headers, 'content-security-policy') ?? ''))
      add('clickjacking', 'medium', 'headers', url.host, c.id);
    if (lower(rs.headers, 'referrer-policy') === undefined) add('referrer-policy-missing', 'low', 'headers', url.host, c.id);
    if (lower(rs.headers, 'permissions-policy') === undefined) add('permissions-policy-missing', 'info', 'headers', url.host, c.id);
  }

  return [...found.values()].toSorted(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count || a.code.localeCompare(b.code),
  );
}
