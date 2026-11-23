import type { Header } from './har.ts';
import { DEFAULT_REDACT } from './redact.ts';

// ------------------------------------------------------------------------------------- JWT

export interface JwtInfo {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
  alg?: string | undefined;
  typ?: string | undefined;
  iss?: string | undefined;
  sub?: string | undefined;
  aud: string[];
  exp?: number | undefined;
  iat?: number | undefined;
  nbf?: number | undefined;
  /** Claims outside the registered set, in token order. */
  custom: [string, unknown][];
  state: 'active' | 'expired' | 'not-yet-valid' | 'no-expiry';
}

export type JwtResult = { ok: true; jwt: JwtInfo } | { ok: false; error: string };

const JWT_SHAPE = /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const REGISTERED = new Set(['iss', 'sub', 'aud', 'exp', 'nbf', 'iat', 'jti']);

/** Three Base64URL parts with a JSON-looking header (`eyJ` = `{"`). Shape only, not validity. */
export const looksLikeJwt = (s: string): boolean => JWT_SHAPE.test(s);

function jsonPart(part: string): Record<string, unknown> | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) return undefined;
  try {
    const b64 = part
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(Math.ceil(part.length / 4) * 4, '=');
    const bin = atob(b64);
    const value: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined;
  } catch {
    return undefined; // malformed Base64URL or JSON: reported by the caller
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * Decodes a JWS compact token locally. Nothing is verified: the signature is shown as-is and
 * the result says nothing about whether the token is authentic.
 */
export function decodeJwt(token: string, now = Date.now()): JwtResult {
  const parts = token.trim().split('.');
  if (parts.length === 5) return { ok: false, error: 'Encrypted token (JWE): its payload cannot be decoded locally' };
  if (parts.length !== 3) return { ok: false, error: `Expected 3 dot-separated parts, found ${parts.length}` };
  const [h = '', p = '', signature = ''] = parts;
  const header = jsonPart(h);
  if (!header) return { ok: false, error: 'The header is not Base64URL-encoded JSON' };
  const payload = jsonPart(p);
  if (!payload) return { ok: false, error: 'The payload is not a Base64URL-encoded JSON object' };
  const aud = payload.aud;
  const exp = num(payload.exp);
  const nbf = num(payload.nbf);
  const state =
    exp !== undefined && exp * 1000 <= now
      ? 'expired'
      : nbf !== undefined && nbf * 1000 > now
        ? 'not-yet-valid'
        : exp !== undefined
          ? 'active'
          : 'no-expiry';
  return {
    ok: true,
    jwt: {
      header,
      payload,
      signature,
      alg: str(header.alg),
      typ: str(header.typ),
      iss: str(payload.iss),
      sub: str(payload.sub),
      aud: typeof aud === 'string' ? [aud] : Array.isArray(aud) ? aud.filter((a): a is string => typeof a === 'string') : [],
      exp,
      iat: num(payload.iat),
      nbf,
      custom: Object.entries(payload).filter(([k]) => !REGISTERED.has(k)),
      state,
    },
  };
}

// ------------------------------------------------------------------------------------ auth

export type AuthScheme = 'Bearer' | 'Basic' | 'JWT' | 'Digest' | 'API key' | 'Cookie' | 'Custom' | 'Unknown';

export interface AuthItem {
  source: 'request' | 'response';
  header: string;
  scheme: AuthScheme;
  /** The full header value (or cookie value), to be masked by the UI unless revealed. */
  value: string;
  customScheme?: string | undefined;
  basicUser?: string | undefined;
  cookieName?: string | undefined;
  jwt?: JwtResult | undefined;
}

const AUTH_HEADERS = new Set(['authorization', 'proxy-authorization', 'www-authenticate', 'proxy-authenticate']);

function basicUser(credential: string): string | undefined {
  try {
    const decoded = atob(credential);
    const i = decoded.indexOf(':');
    return i < 0 ? undefined : decoded.slice(0, i);
  } catch {
    return undefined; // not Base64: shown as an opaque credential
  }
}

function classify(source: AuthItem['source'], h: Header, now: number): AuthItem {
  const value = h.value.trim();
  const m = /^([A-Za-z][\w!#$%&'*+.^`|~-]*)\s+(.+)$/s.exec(value);
  if (!m) {
    return looksLikeJwt(value)
      ? { source, header: h.name, scheme: 'JWT', value, jwt: decodeJwt(value, now) }
      : { source, header: h.name, scheme: 'Unknown', value };
  }
  const [, scheme = '', rest = ''] = m;
  const lower = scheme.toLowerCase();
  if (lower === 'bearer') {
    const token = rest.trim();
    return { source, header: h.name, scheme: 'Bearer', value, jwt: looksLikeJwt(token) ? decodeJwt(token, now) : undefined };
  }
  if (lower === 'basic') return { source, header: h.name, scheme: 'Basic', value, basicUser: basicUser(rest.trim()) };
  if (lower === 'digest') return { source, header: h.name, scheme: 'Digest', value };
  const token = rest.trim();
  return {
    source,
    header: h.name,
    scheme: 'Custom',
    value,
    customScheme: scheme,
    jwt: looksLikeJwt(token) ? decodeJwt(token, now) : undefined,
  };
}

function cookieItems(source: AuthItem['source'], h: Header, now: number): AuthItem[] {
  const items: AuthItem[] = [{ source, header: h.name, scheme: 'Cookie', value: h.value }];
  const pairs = source === 'request' ? h.value.split(';') : [h.value.split(';')[0] ?? ''];
  for (const pair of pairs) {
    const i = pair.indexOf('=');
    const name = pair.slice(0, i).trim();
    const v = pair.slice(i + 1).trim();
    if (i > 0 && looksLikeJwt(v)) items.push({ source, header: h.name, scheme: 'JWT', value: v, cookieName: name, jwt: decodeJwt(v, now) });
  }
  return items;
}

/**
 * Finds authentication material in request and response headers: Authorization-style headers,
 * challenges, cookies (and JWTs inside them) and secret-named headers such as X-API-Key.
 */
export function detectAuth(request: Header[], response: Header[], extraSecretNames: string[] = [], now = Date.now()): AuthItem[] {
  const secretNames = new Set([...DEFAULT_REDACT.headers, ...extraSecretNames.map((n) => n.toLowerCase())]);
  const items: AuthItem[] = [];
  const scan = (source: AuthItem['source'], headers: Header[]) => {
    for (const h of headers) {
      const name = h.name.toLowerCase();
      if (AUTH_HEADERS.has(name)) items.push(classify(source, h, now));
      else if (name === 'cookie' || name === 'set-cookie') items.push(...cookieItems(source, h, now));
      else if (secretNames.has(name)) {
        const v = h.value.trim();
        items.push(
          looksLikeJwt(v)
            ? { source, header: h.name, scheme: 'JWT', value: v, jwt: decodeJwt(v, now) }
            : { source, header: h.name, scheme: 'API key', value: v },
        );
      }
    }
  };
  scan('request', request);
  scan('response', response);
  return items;
}
