/* oxlint-disable typescript/no-explicit-any, unicorn/consistent-function-scoping -- the page scripts take the page's untyped global, faked here; small helpers stay beside the tests that use them */
import { describe, expect, it } from 'vitest';
import {
  analyzePerformance,
  analyzeSecurity,
  cacheAction,
  cacheEntries,
  evaluateCss,
  idbRecords,
  storageOverview,
  MAX_REQUESTS_PER_FINDING,
  parseCsp,
  parseHar,
  perfCollector,
  rate,
  selectorMatches,
  summarize,
  waterfall,
  webStorageWrite,
  type Captured,
  type Finding,
  type PageMetrics,
} from '../src/index.ts';

interface Spec {
  url?: string;
  method?: string;
  status?: number;
  type?: string;
  mime?: string;
  req?: Record<string, string>;
  res?: Record<string, string | string[]>;
  error?: string;
  size?: number;
  started?: string;
  time?: number;
  version?: string;
  redirect?: string;
}

let nextId = 1;
const pairs = (h: Record<string, string | string[]> = {}) =>
  Object.entries(h).flatMap(([name, v]) => (Array.isArray(v) ? v : [v]).map((value) => ({ name, value })));

function cap(o: Spec = {}): Captured {
  const raw = {
    startedDateTime: o.started ?? '2025-01-01T00:00:00.000Z',
    time: o.time ?? 50,
    request: {
      method: o.method ?? 'GET',
      url: o.url ?? 'https://app.example/',
      httpVersion: o.version ?? 'h2',
      headers: pairs(o.req),
      queryString: [],
      cookies: [],
      headersSize: -1,
      bodySize: -1,
    },
    response: {
      status: o.status ?? 200,
      statusText: '',
      httpVersion: o.version ?? 'h2',
      headers: pairs(o.res),
      cookies: [],
      content: { size: o.size ?? 100, mimeType: o.mime ?? '' },
      redirectURL: o.redirect ?? '',
      headersSize: -1,
      bodySize: -1,
      ...(o.error ? { _error: o.error } : {}),
    },
    cache: {},
    timings: { blocked: 5, dns: -1, connect: 10, ssl: -1, send: 1, wait: 20, receive: 14 },
    _resourceType: o.type ?? '',
  };
  return summarize(parseHar(JSON.stringify({ log: { entries: [raw] } })).entries[0]!, nextId++, 'import');
}

const codes = (findings: Finding[]) => findings.map((f) => f.code);
const find = (findings: Finding[], code: string) => findings.find((f) => f.code === code);
const SECURE_DOC: Spec = {
  type: 'document',
  mime: 'text/html',
  res: {
    'content-security-policy': "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'strict-transport-security': 'max-age=31536000',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=()',
  },
};

// ---------------------------------------------------------------------------------- CORS

describe('CORS diagnosis', () => {
  const origin = { origin: 'https://app.example' };

  it('finds a cross-origin response the page cannot read', () => {
    const r = analyzeSecurity([cap({ url: 'https://api.other/x', type: 'fetch', req: origin })]);
    expect(find(r, 'cors-missing-allow-origin')).toMatchObject({ severity: 'high', category: 'cors', subject: 'https://api.other' });
  });

  it('accepts a correct response and flags the wrong ones', () => {
    const ok = cap({
      url: 'https://api.other/x',
      req: origin,
      res: { 'access-control-allow-origin': 'https://app.example', vary: 'Origin' },
    });
    const noVary = cap({ url: 'https://api.other/y', req: origin, res: { 'access-control-allow-origin': 'https://app.example' } });
    const wildcard = cap({
      url: 'https://creds.other/',
      req: origin,
      res: { 'access-control-allow-origin': '*', 'access-control-allow-credentials': 'true' },
    });
    const mismatch = cap({ url: 'https://api.third/', req: origin, res: { 'access-control-allow-origin': 'https://elsewhere.example' } });
    const nullOrigin = cap({ url: 'https://api.fourth/', req: origin, res: { 'access-control-allow-origin': 'null' } });
    const blocked = cap({ url: 'https://api.fifth/', req: origin, status: 0, error: 'net::ERR_FAILED' });
    const r = analyzeSecurity([ok, noVary, wildcard, mismatch, nullOrigin, blocked]);
    expect(
      codes(r)
        .filter((c) => c.startsWith('cors-'))
        .toSorted(),
    ).toEqual(['cors-blocked', 'cors-no-vary', 'cors-null-origin', 'cors-origin-mismatch', 'cors-wildcard-credentials']);
    expect(find(r, 'cors-origin-mismatch')?.params).toEqual({ allowed: 'https://elsewhere.example', origin: 'https://app.example' });
    expect(find(r, 'cors-no-vary')?.requests).toEqual([noVary.id]);
  });

  it('checks preflights: failure, redirect, method and headers', () => {
    const ask = { ...origin, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-type, x-custom' };
    const failed = cap({ url: 'https://a.other/', method: 'OPTIONS', status: 403, req: ask });
    const redirected = cap({ url: 'https://b.other/', method: 'OPTIONS', status: 302, req: ask });
    const methodMissing = cap({
      url: 'https://c.other/',
      method: 'OPTIONS',
      status: 204,
      req: ask,
      res: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': '*' },
    });
    const headerMissing = cap({
      url: 'https://d.other/',
      method: 'OPTIONS',
      status: 204,
      req: ask,
      res: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'PUT', 'access-control-allow-headers': 'content-type' },
    });
    const good = cap({
      url: 'https://e.other/',
      method: 'OPTIONS',
      status: 204,
      req: ask,
      res: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'PUT',
        'access-control-allow-headers': 'Content-Type, X-Custom',
      },
    });
    const r = analyzeSecurity([failed, redirected, methodMissing, headerMissing, good]);
    expect(codes(r).toSorted()).toEqual([
      'cors-preflight-failed',
      'cors-preflight-headers',
      'cors-preflight-method',
      'cors-preflight-redirect',
    ]);
    expect(find(r, 'cors-preflight-headers')?.params.missing).toBe('x-custom');
    expect(find(r, 'cors-preflight-method')?.params.method).toBe('PUT');
  });

  it('ignores same-origin traffic', () => {
    expect(
      analyzeSecurity([cap({ url: 'https://app.example/api', req: { origin: 'https://app.example' } })]).filter(
        (f) => f.category === 'cors',
      ),
    ).toEqual([]);
  });
});

// ----------------------------------------------------------------------- CSP, headers, cookies

describe('security headers and CSP', () => {
  it('passes a hardened document', () => {
    expect(analyzeSecurity([cap(SECURE_DOC)])).toEqual([]);
  });

  it('flags a bare document', () => {
    const r = analyzeSecurity([cap({ type: 'document', mime: 'text/html' })]);
    expect(codes(r).toSorted()).toEqual([
      'clickjacking',
      'csp-missing',
      'hsts-missing',
      'nosniff-missing',
      'permissions-policy-missing',
      'referrer-policy-missing',
    ]);
    expect(find(r, 'csp-missing')).toMatchObject({ severity: 'medium', category: 'csp' });
    expect(r.map((f) => f.severity)).toEqual(['medium', 'medium', 'medium', 'low', 'low', 'info']);
  });

  it('reads the policy, not just its presence', () => {
    const doc = (csp: string) => analyzeSecurity([cap({ ...SECURE_DOC, res: { ...SECURE_DOC.res, 'content-security-policy': csp } })]);
    expect(
      codes(doc("default-src 'self'; script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")),
    ).toEqual(['csp-unsafe-inline']);
    expect(doc("script-src 'nonce-abc' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")).toEqual([]);
    expect(codes(doc("script-src 'self' 'unsafe-eval'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"))).toEqual([
      'csp-unsafe-eval',
    ]);
    expect(find(doc("script-src * data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"), 'csp-wildcard')).toMatchObject({
      severity: 'high',
      params: { sources: '* data:' },
    });
    expect(find(doc("script-src https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"), 'csp-wildcard')?.severity).toBe(
      'medium',
    );
    expect(codes(doc("script-src 'self'"))).toEqual(expect.arrayContaining(['csp-no-object-src', 'csp-no-base-uri']));
    const reportOnly = analyzeSecurity([
      cap({
        ...SECURE_DOC,
        res: { ...SECURE_DOC.res, 'content-security-policy': [], 'content-security-policy-report-only': "default-src 'self'" },
      }),
    ]);
    // a report-only policy enforces nothing, so frame-ancestors in it does not stop clickjacking either
    expect(codes(reportOnly)).toEqual(['clickjacking', 'csp-report-only']);
    expect(parseCsp("Default-Src 'self'; script-src a b; script-src c").get('script-src')).toEqual(['a', 'b']);
  });

  it('judges HSTS, version leaks and caching of private responses', () => {
    const weak = analyzeSecurity([cap({ ...SECURE_DOC, res: { ...SECURE_DOC.res, 'strict-transport-security': 'max-age=60' } })]);
    expect(find(weak, 'hsts-weak')).toMatchObject({ severity: 'low', params: { value: 'max-age=60' } });
    const leak = analyzeSecurity([cap({ url: 'https://app.example/x', res: { server: 'nginx/1.18.0', 'x-powered-by': 'Express' } })]);
    expect(leak.map((f) => f.subject)).toEqual(['server: nginx/1.18.0']);
    const sensitive = analyzeSecurity([cap({ url: 'https://app.example/me', req: { authorization: 'Bearer x' } })]);
    expect(codes(sensitive)).toEqual(['cache-sensitive']);
    expect(
      analyzeSecurity([cap({ url: 'https://app.example/me', req: { authorization: 'Bearer x' }, res: { 'cache-control': 'no-store' } })]),
    ).toEqual([]);
  });
});

describe('cookies', () => {
  const setCookie = (...lines: string[]) =>
    analyzeSecurity([cap({ url: 'https://app.example/login', res: { 'set-cookie': lines, 'cache-control': 'no-store' } })]);

  it('flags missing attributes, graded by how session-like the name is', () => {
    const r = setCookie('sid=abc; Path=/', 'theme=dark; Path=/; Secure; HttpOnly; SameSite=Lax');
    expect(r.filter((f) => f.category === 'cookies').map((f) => [f.code, f.severity, f.subject])).toEqual([
      ['cookie-no-httponly', 'medium', 'sid (app.example)'],
      ['cookie-no-secure', 'medium', 'sid (app.example)'],
      ['cookie-no-samesite', 'low', 'sid (app.example)'],
    ]);
    expect(codes(setCookie('prefs=1; Secure; HttpOnly; SameSite=Strict'))).toEqual([]);
  });

  it('flags SameSite=None without Secure and broken prefixes', () => {
    expect(codes(setCookie('a=1; SameSite=None; HttpOnly'))).toEqual(['cookie-samesite-none-insecure']);
    expect(codes(setCookie('__Host-a=1; Secure; HttpOnly; SameSite=Lax; Domain=x.example; Path=/'))).toEqual(['cookie-host-prefix']);
    expect(codes(setCookie('__Secure-a=1; HttpOnly; SameSite=Lax'))).toEqual(expect.arrayContaining(['cookie-secure-prefix']));
    expect(codes(setCookie('__Host-a=1; Secure; HttpOnly; SameSite=Lax; Path=/'))).toEqual([]);
  });
});

describe('mixed content and TLS', () => {
  it('flags http subresources on an https page, but not localhost', () => {
    const page = cap({ ...SECURE_DOC });
    const r = analyzeSecurity([
      page,
      cap({ url: 'http://cdn.example/app.js', type: 'script' }),
      cap({ url: 'http://cdn.example/logo.png', type: 'image' }),
      cap({ url: 'http://localhost:3000/x', type: 'fetch' }),
    ]);
    expect(r.map((f) => [f.code, f.severity, f.subject])).toEqual([
      ['mixed-active', 'high', 'cdn.example'],
      ['mixed-passive', 'medium', 'cdn.example'],
    ]);
  });

  it('flags certificate failures and documents served without TLS', () => {
    const r = analyzeSecurity([
      cap({ url: 'https://bad.example/', status: 0, error: 'net::ERR_CERT_DATE_INVALID' }),
      cap({ url: 'http://plain.example/', type: 'document', mime: 'text/html' }),
    ]);
    expect(find(r, 'tls-error')).toMatchObject({
      severity: 'high',
      params: { error: 'net::ERR_CERT_DATE_INVALID' },
      subject: 'bad.example',
    });
    expect(find(r, 'no-tls')).toMatchObject({ subject: 'plain.example' });
  });

  it('groups repeats, caps the request list and sorts by severity', () => {
    const many = Array.from({ length: 80 }, (_, i) => cap({ url: `https://api.other/${i}`, req: { origin: 'https://app.example' } }));
    const r = analyzeSecurity([...many, cap({ type: 'document', mime: 'text/html' })]);
    expect(r[0]).toMatchObject({ code: 'cors-missing-allow-origin', count: 80 });
    expect(r[0]!.requests).toHaveLength(MAX_REQUESTS_PER_FINDING);
    expect(r.map((f) => f.severity)).toEqual(
      r
        .map((f) => f.severity)
        .toSorted((a, b) => ['high', 'medium', 'low', 'info'].indexOf(a) - ['high', 'medium', 'low', 'info'].indexOf(b)),
    );
  });
});

// ----------------------------------------------------------------------------- performance

const page = (over: Partial<PageMetrics> = {}): PageMetrics => ({
  longTasks: { count: 0, blocking: 0 },
  blocking: [],
  images: [],
  ...over,
});

describe('performance analysis', () => {
  it('rates vitals with the published thresholds', () => {
    expect([rate('lcp', 2500), rate('lcp', 2501), rate('lcp', 4001)]).toEqual(['good', 'needs-improvement', 'poor']);
    expect([rate('cls', 0.1), rate('cls', 0.2), rate('cls', 0.3)]).toEqual(['good', 'needs-improvement', 'poor']);
    expect([rate('inp', 200), rate('inp', 500), rate('inp', 501)]).toEqual(['good', 'needs-improvement', 'poor']);
  });

  it('finds the usual request-level problems', () => {
    const big = cap({
      url: 'https://app.example/app.js',
      type: 'script',
      mime: 'application/javascript',
      size: 300_000,
      res: { 'cache-control': 'max-age=60' },
    });
    const slow = cap({ url: 'https://app.example/api', type: 'fetch', mime: 'application/json', time: 3500 });
    const uncached = cap({ url: 'https://app.example/logo.png', type: 'image', mime: 'image/png' });
    const noStore = cap({ url: 'https://app.example/font.woff2', type: 'font', mime: 'font/woff2', res: { 'cache-control': 'no-store' } });
    const redirect = cap({ url: 'http://app.example/', status: 301, redirect: 'https://app.example/' });
    const validated = cap({
      url: 'https://app.example/a.css',
      type: 'stylesheet',
      mime: 'text/css',
      res: { etag: '"1"', 'content-encoding': 'br' },
      size: 5000,
    });
    const r = analyzePerformance([big, slow, uncached, noStore, redirect, validated], undefined);
    expect(r.map((f) => [f.code, f.subject])).toEqual(
      expect.arrayContaining([
        ['uncompressed', big.url],
        ['slow-request', slow.url],
        ['no-cache', uncached.url],
        ['no-store-static', noStore.url],
        ['redirect', redirect.url],
      ]),
    );
    expect(r.some((f) => f.subject === validated.url)).toBe(false);
    expect(r.find((f) => f.code === 'slow-request')?.severity).toBe('high');
    expect(r[0]!.severity).toBe('high');
  });

  it('uses what the page reports', () => {
    const img = cap({ url: 'https://app.example/hero.jpg', type: 'image', mime: 'image/jpeg', res: { 'cache-control': 'max-age=999' } });
    const r = analyzePerformance(
      [img],
      page({
        blocking: ['https://app.example/a.css'],
        images: [{ src: img.url, natural: [4000, 3000], rendered: [400, 300], bytes: 900_000 }],
        longTasks: { count: 4, blocking: 1200 },
        cls: 0.3,
      }),
    );
    expect(r.map((f) => f.code).toSorted()).toEqual(['layout-shift', 'long-tasks', 'oversized-image', 'render-blocking']);
    expect(r.find((f) => f.code === 'oversized-image')).toMatchObject({
      severity: 'high',
      params: { natural: '4000×3000', rendered: '400×300', kb: '879' },
      requests: [img.id],
    });
  });

  it('draws the waterfall from the first request on', () => {
    const rows = waterfall([
      cap({ url: 'https://app.example/b', started: '2025-01-01T00:00:00.300Z', time: 100 }),
      cap({ url: 'https://app.example/a', started: '2025-01-01T00:00:00.000Z', time: 200 }),
    ]);
    expect(rows.map((r) => [r.label, r.start])).toEqual([
      ['/a', 0],
      ['/b', 300],
    ]);
    expect(rows[0]!.phases.map((p) => p.name)).toEqual(['blocked', 'connect', 'send', 'wait', 'receive']);
    expect(rows[0]!.total).toBe(200);
  });
});

// ----------------------------------------------------------------------------- page scripts

describe('page scripts', () => {
  it('collects vitals from the page observers', () => {
    const handlers = new Map<string, (list: { getEntries: () => unknown[] }) => void>();
    const scope: any = {
      PerformanceObserver: class {
        cb: (list: { getEntries: () => unknown[] }) => void;
        constructor(cb: (list: { getEntries: () => unknown[] }) => void) {
          this.cb = cb;
        }
        observe({ type }: { type: string }) {
          handlers.set(type, this.cb);
        }
      },
      performance: {
        getEntriesByType: (type: string) =>
          type === 'navigation'
            ? [{ responseStart: 120, domContentLoadedEventEnd: 800, loadEventEnd: 0 }]
            : [
                { name: 'https://x/a.css', renderBlockingStatus: 'blocking', transferSize: 10 },
                { name: 'https://x/i.png', renderBlockingStatus: 'non-blocking', transferSize: 70_000 },
              ],
      },
      devicePixelRatio: 2,
      document: {
        images: [
          { complete: true, currentSrc: 'https://x/i.png', naturalWidth: 1000, naturalHeight: 500, clientWidth: 100, clientHeight: 50 },
        ],
      },
    };
    perfCollector(scope);
    const emit = (type: string, ...entries: unknown[]) => handlers.get(type)!({ getEntries: () => entries });
    emit('largest-contentful-paint', {
      startTime: 1800,
      element: { tagName: 'IMG', id: 'hero', classList: ['a', 'b', 'c'] },
      url: 'https://x/i.png',
    });
    emit('paint', { name: 'first-paint', startTime: 10 }, { name: 'first-contentful-paint', startTime: 900 });
    emit(
      'layout-shift',
      { startTime: 100, value: 0.05 },
      { startTime: 400, value: 0.04 },
      { startTime: 450, value: 0.5, hadRecentInput: true },
      { startTime: 9000, value: 0.02 },
    );
    emit(
      'event',
      { interactionId: 1, duration: 80, target: { tagName: 'BUTTON' } },
      { interactionId: 2, duration: 320, target: { tagName: 'INPUT', id: 'q' } },
      { interactionId: 0, duration: 999 },
    );
    emit('longtask', { duration: 120 }, { duration: 40 });
    const got = scope.__betterDevToolsPerf.get() as PageMetrics;
    expect(got).toMatchObject({
      lcp: { value: 1800, element: 'img#hero.a.b', url: 'https://x/i.png' },
      fcp: 900,
      inp: { value: 320, target: 'input#q' },
      ttfb: 120,
      domContentLoaded: 800,
      load: undefined,
      longTasks: { count: 2, blocking: 70 },
      blocking: ['https://x/a.css'],
      images: [{ src: 'https://x/i.png', natural: [1000, 500], rendered: [200, 100], bytes: 70_000 }],
    });
    expect(got.cls).toBeCloseTo(0.09, 5); // the 0.02 shift is a separate window, and the one after input is ignored
    perfCollector(scope); // installing twice keeps the first collector
    expect(handlers.size).toBe(5);
  });

  it('writes Web Storage', () => {
    const store = new Map<string, string>();
    const storage = {
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    };
    const scope = {
      localStorage: storage,
      sessionStorage: {
        ...storage,
        setItem: () => {
          throw new Error('quota');
        },
      },
    };
    webStorageWrite(scope, 'local', 'set', 'a', '1');
    webStorageWrite(scope, 'local', 'set', 'b', '2');
    webStorageWrite(scope, 'local', 'remove', 'a', '');
    expect([...store]).toEqual([['b', '2']]);
    expect(() => webStorageWrite(scope, 'session', 'set', 'k', 'v')).toThrow('quota');
    webStorageWrite(scope, 'local', 'clear', '', '');
    expect(store.size).toBe(0);
  });

  it('lists, previews and deletes Cache Storage entries', async () => {
    const entries = new Map([
      ['https://x/a.json', new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json' } })],
      ['https://x/b', new Response('nope', { status: 404 })],
    ]);
    const caches = new Map<string, Map<string, Response>>([['v1', entries]]);
    const open = async (name: string) => {
      const map = caches.get(name)!;
      return {
        keys: async () => [...map.keys()].map((url) => ({ url, method: 'GET' })),
        match: async (r: { url: string } | string) => map.get(typeof r === 'string' ? r : r.url)?.clone(),
        delete: async (url: string) => map.delete(url),
      };
    };
    const scope = { caches: { open, delete: async (name: string) => caches.delete(name) } };
    expect(await cacheEntries(scope, 'v1')).toEqual([
      { url: 'https://x/a.json', method: 'GET', status: 200, type: 'default', contentType: 'application/json' },
      { url: 'https://x/b', method: 'GET', status: 404, type: 'default', contentType: 'text/plain;charset=UTF-8' },
    ]);
    expect(await cacheAction(scope, 'v1', 'preview', 'https://x/a.json')).toBe('{"a":1}');
    await cacheAction(scope, 'v1', 'delete', 'https://x/b');
    expect(entries.size).toBe(1);
    await cacheAction(scope, 'v1', 'delete', '');
    expect(caches.has('v1')).toBe(false);
  });

  it('tests selectors and CSS values against the page', () => {
    const el = (tagName: string, id: string, className: string, textContent: string) => ({ tagName, id, className, textContent });
    const scope: any = {
      document: {
        querySelectorAll: (s: string) => {
          if (s === '[') throw new SyntaxError("'[' is not a valid selector");
          return s === 'p' ? [el('P', 'a', 'x y', '  hello \n world '), el('P', '', '', 'two')] : [];
        },
      },
    };
    expect(selectorMatches(scope, 'p')).toEqual({
      total: 2,
      matches: [
        { tag: 'p', id: 'a', classes: 'x y', text: 'hello world', index: 0 },
        { tag: 'p', id: '', classes: '', text: 'two', index: 1 },
      ],
    });
    expect(selectorMatches(scope, 'em')).toEqual({ total: 0, matches: [] });
    expect(selectorMatches(scope, '[')).toEqual({ error: "'[' is not a valid selector" });

    const probe = { style: { cssText: '', setProperty: () => undefined }, remove: () => undefined };
    const css: any = {
      document: { createElement: () => probe, body: { append: () => undefined } },
      CSS: { supports: (p: string) => p !== 'nonsense' },
      getComputedStyle: () => ({ getPropertyValue: () => '320px' }),
    };
    expect(evaluateCss(css, 'width', 'calc(20rem)')).toEqual({ supported: true, computed: '320px' });
    expect(evaluateCss(css, 'nonsense', '1')).toEqual({ supported: false, computed: '' });
  });
});

// A function shipped into the page is serialised with toString: anything it uses from module scope
// is a ReferenceError there (often swallowed by its own try/catch). Running the serialised text
// in a context that has only the fake page catches that.
describe('page scripts survive serialisation', () => {
  const serialised = <A extends unknown[], R>(fn: (scope: never, ...args: A) => R) =>
    new Function('scope', 'args', `return (${fn.toString()})(scope, ...args)`) as (scope: unknown, args: A) => R;

  it('storageOverview reads Web Storage, caches, workers and usage in the page', async () => {
    const area = (entries: [string, string][]) => ({
      length: entries.length,
      key: (i: number) => entries[i]![0],
      getItem: (k: string) => entries.find(([key]) => key === k)![1],
    });
    const scope = {
      location: { origin: 'https://page.test' },
      localStorage: area([
        ['theme', 'dark'],
        ['big', 'x'.repeat(200_000)],
      ]),
      sessionStorage: area([['draft', '{}']]),
      indexedDB: { databases: async () => [] },
      caches: { keys: async () => ['v1'], open: async () => ({ keys: async () => [{}, {}] }) },
      navigator: {
        serviceWorker: {
          getRegistrations: async () => [
            { scope: 'https://page.test/', active: { scriptURL: 'https://page.test/sw.js', state: 'activated' } },
          ],
        },
        storage: { estimate: async () => ({ usage: 10, quota: 100 }) },
      },
    };
    const overview = await serialised(storageOverview)(scope, []);
    expect(overview.local.map(([k, v]) => [k, v.length])).toEqual([
      ['theme', 4],
      ['big', 100_000],
    ]);
    expect(overview).toMatchObject({
      origin: 'https://page.test',
      session: [['draft', '{}']],
      caches: [{ name: 'v1', count: 2 }],
      workers: [{ scope: 'https://page.test/', script: 'https://page.test/sw.js', state: 'activated' }],
      usage: 10,
      quota: 100,
    });
  });

  it('reads IndexedDB structure and records in the page', async () => {
    const request = <T>(result: T) => {
      const r: { result: T; onsuccess?: () => void } = { result };
      queueMicrotask(() => r.onsuccess?.());
      return r;
    };
    const records = [
      { key: 1, value: { id: 1, when: new Date(0), tags: new Set([1]), data: new Uint8Array([1, 2]) } },
      { key: 2, value: { id: 2 } },
    ];
    const store = {
      keyPath: 'id',
      autoIncrement: false,
      count: () => request(records.length),
      openCursor: () => {
        let at = 0;
        const cursor: { result: unknown; onsuccess?: () => void } = { result: null };
        const move = () => {
          const record = records[at];
          cursor.result = record
            ? {
                key: record.key,
                value: record.value,
                continue: () => {
                  at++;
                  queueMicrotask(move);
                },
                advance: (n: number) => {
                  at += n;
                  queueMicrotask(move);
                },
              }
            : null;
          cursor.onsuccess?.();
        };
        queueMicrotask(move);
        return cursor;
      },
    };
    const db = { version: 3, objectStoreNames: ['notes'], transaction: () => ({ objectStore: () => store }), close: () => undefined };
    const scope = {
      indexedDB: {
        databases: async () => [{ name: 'app', version: 3 }],
        open: () => {
          const open: { result: unknown; onsuccess?: () => void } = { result: db };
          queueMicrotask(() => open.onsuccess?.());
          return open;
        },
      },
      localStorage: area0(),
      sessionStorage: area0(),
      caches: { keys: async () => [] },
      navigator: { serviceWorker: { getRegistrations: async () => [] }, storage: { estimate: async () => ({}) } },
      location: { origin: 'https://page.test' },
    };
    function area0() {
      return { length: 0, key: () => null, getItem: () => null };
    }
    const overview = await serialised(storageOverview)(scope, []);
    expect(overview.databases).toEqual([
      { name: 'app', version: 3, stores: [{ name: 'notes', keyPath: '"id"', autoIncrement: false, count: 2 }] },
    ]);
    const page = await serialised(idbRecords)(scope, ['app', 'notes', 0, 10]);
    expect(page.total).toBe(2);
    expect(page.records[0]).toEqual({
      key: 1,
      value: { id: 1, when: { $date: '1970-01-01T00:00:00.000Z' }, tags: { $set: [1] }, data: { $bytes: 2, preview: '0102' } },
    });
    expect(page.records[1]).toEqual({ key: 2, value: { id: 2 } });
  });

  it('keeps the rest of the page scripts self-contained', () => {
    const fakeDocument = {
      querySelectorAll: () => [],
      createElement: () => ({ style: { cssText: '', setProperty: () => undefined }, remove: () => undefined }),
      body: { append: () => undefined },
    };
    expect(serialised(selectorMatches)({ document: fakeDocument }, ['p'])).toEqual({ total: 0, matches: [] });
    expect(serialised(evaluateCss)({ document: fakeDocument, CSS: { supports: () => false } }, ['width', '1'])).toEqual({
      supported: false,
      computed: '',
    });
    const store = new Map<string, string>();
    const storage = {
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    };
    serialised(webStorageWrite)({ localStorage: storage }, ['local', 'set', 'a', '1']);
    expect([...store]).toEqual([['a', '1']]);
    const handlers: unknown[] = [];
    const scope: Record<string, unknown> = {
      PerformanceObserver: class {
        observe() {
          handlers.push(1);
        }
      },
      performance: { getEntriesByType: () => [] },
      document: { images: [] },
    };
    serialised(perfCollector)(scope, []);
    expect(handlers).toHaveLength(5);
  });
});
