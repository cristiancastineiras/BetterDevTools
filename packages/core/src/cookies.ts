import { looksLikeJwt } from './auth.ts';
import { csvCell } from './export.ts';
import type { HarEntry } from './har.ts';
import { DEFAULT_REDACT, REDACTED } from './redact.ts';

export interface CookieInfo {
  name: string;
  value: string;
  source: 'request' | 'response';
  domain?: string | undefined;
  path?: string | undefined;
  expires?: string | undefined;
  maxAge?: number | undefined;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string | undefined;
  partitioned: boolean;
  priority?: string | undefined;
}

const base = (name: string, value: string, source: CookieInfo['source']): CookieInfo => ({
  name,
  value,
  source,
  secure: false,
  httpOnly: false,
  partitioned: false,
});

/** `Cookie: a=1; b=2` → pairs. Values keep any `=` they contain; nameless pairs are dropped. */
export function parseCookieHeader(value: string): CookieInfo[] {
  return value.split(';').flatMap((pair) => {
    const i = pair.indexOf('=');
    const name = (i < 0 ? pair : pair.slice(0, i)).trim();
    return name ? [base(name, i < 0 ? '' : pair.slice(i + 1).trim(), 'request')] : [];
  });
}

/** One `Set-Cookie` line with all attributes; null when it has no `name=value` pair. */
export function parseSetCookie(line: string): CookieInfo | null {
  const [pair = '', ...attrs] = line.split(';');
  const i = pair.indexOf('=');
  const name = pair.slice(0, i).trim();
  if (i < 1 || !name) return null;
  const c = base(name, pair.slice(i + 1).trim(), 'response');
  for (const attr of attrs) {
    const j = attr.indexOf('=');
    const key = (j < 0 ? attr : attr.slice(0, j)).trim().toLowerCase();
    const val = j < 0 ? '' : attr.slice(j + 1).trim();
    if (key === 'domain') c.domain = val;
    else if (key === 'path') c.path = val;
    else if (key === 'expires') c.expires = val;
    else if (key === 'max-age') c.maxAge = /^-?\d+$/.test(val) ? Number(val) : undefined;
    else if (key === 'secure') c.secure = true;
    else if (key === 'httponly') c.httpOnly = true;
    else if (key === 'samesite') c.sameSite = val;
    else if (key === 'partitioned') c.partitioned = true;
    else if (key === 'priority') c.priority = val;
  }
  return c;
}

const named = (headers: HarEntry['request']['headers'], n: string) => headers.filter((h) => h.name.toLowerCase() === n);

/** Cookies as sent and set, read from the raw headers (HAR cookie arrays lack attributes in some browsers). */
export function cookiesOf(har: HarEntry): { request: CookieInfo[]; response: CookieInfo[] } {
  const request = named(har.request.headers, 'cookie').flatMap((h) => parseCookieHeader(h.value));
  // Chrome joins repeated Set-Cookie headers with newlines
  const response = named(har.response.headers, 'set-cookie')
    .flatMap((h) => h.value.split('\n'))
    .flatMap((l) => parseSetCookie(l) ?? []);
  return {
    request: request.length ? request : har.request.cookies.map((c) => base(c.name, c.value, 'request')),
    response: response.length ? response : har.response.cookies.map((c) => base(c.name, c.value, 'response')),
  };
}

const SECRET_NAME = /sess|sid|token|auth|jwt|csrf|xsrf|secret|key|pass/i;

export function isSecretCookie(c: Pick<CookieInfo, 'name' | 'value'>): boolean {
  return SECRET_NAME.test(c.name) || DEFAULT_REDACT.params.includes(c.name.toLowerCase()) || looksLikeJwt(c.value);
}

export type CookieExportFormat = 'json' | 'csv' | 'netscape';

const COLUMNS = [
  'source',
  'name',
  'value',
  'domain',
  'path',
  'expires',
  'maxAge',
  'secure',
  'httpOnly',
  'sameSite',
  'partitioned',
  'priority',
] as const;

/** Exports cookies; values are replaced with [REDACTED] unless `redact` is false. */
export function exportCookies(list: CookieInfo[], format: CookieExportFormat, o: { redact: boolean; host: string; now?: number }): string {
  const rows = list.map((c) => ({ ...c, value: o.redact ? REDACTED : c.value }));
  if (format === 'json') return JSON.stringify(rows, null, 2);
  if (format === 'csv')
    return [COLUMNS.join(','), ...rows.map((c) => COLUMNS.map((k) => csvCell(String(c[k] ?? ''))).join(','))].join('\r\n') + '\r\n';
  const now = o.now ?? Date.now();
  const lines = rows.map((c) => {
    const domain = c.domain || o.host;
    const expiry =
      c.maxAge !== undefined ? Math.floor(now / 1000) + c.maxAge : c.expires ? Math.floor((Date.parse(c.expires) || 0) / 1000) : 0;
    const fields = [
      domain,
      domain.startsWith('.') ? 'TRUE' : 'FALSE',
      c.path || '/',
      c.secure ? 'TRUE' : 'FALSE',
      String(expiry),
      c.name,
      c.value,
    ];
    return (c.httpOnly ? '#HttpOnly_' : '') + fields.join('\t');
  });
  return ['# Netscape HTTP Cookie File', ...lines, ''].join('\n');
}
