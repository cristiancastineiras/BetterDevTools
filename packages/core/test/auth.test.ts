import { describe, expect, it } from 'vitest';
import { decodeJwt, detectAuth, looksLikeJwt, methodToken, statusToken } from '../src/index.ts';

const b64url = (o: unknown) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);
const sec = (ms: number) => Math.floor(ms / 1000);
const jwt = (payload: unknown, header: unknown = { alg: 'HS256', typ: 'JWT' }) => `${b64url(header)}.${b64url(payload)}.c2lnbmF0dXJl`;

describe('HTTP tokens', () => {
  it('maps every method, case-insensitive, with a fallback', () => {
    expect(['GET', 'post', 'Put', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'TRACE', 'CONNECT', 'PURGE'].map(methodToken)).toEqual([
      'get',
      'post',
      'put',
      'patch',
      'delete',
      'options',
      'head',
      'trace',
      'connect',
      'other',
    ]);
  });

  it('maps status classes, failures and cancellations', () => {
    expect([101, 204, 304, 404, 503].map((s) => statusToken(s, ''))).toEqual(['1xx', '2xx', '3xx', '4xx', '5xx']);
    expect(statusToken(0, 'net::ERR_BLOCKED_BY_CLIENT')).toBe('error');
    expect(statusToken(0, 'net::ERR_ABORTED')).toBe('cancelled');
    expect(statusToken(0, 'Cancelled')).toBe('cancelled');
    expect(statusToken(0, '')).toBe('unknown');
    expect(statusToken(999, '')).toBe('unknown');
  });
});

describe('JWT decoding (local, unverified)', () => {
  it('decodes a valid Bearer token with registered and custom claims', () => {
    const token = jwt({
      iss: 'https://id.test',
      sub: 'u1',
      aud: 'api',
      exp: sec(NOW) + 3600,
      iat: sec(NOW) - 60,
      nbf: sec(NOW) - 60,
      role: 'admin',
      ü: 1,
    });
    const r = decodeJwt(token, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.jwt).toMatchObject({
      alg: 'HS256',
      typ: 'JWT',
      iss: 'https://id.test',
      sub: 'u1',
      aud: ['api'],
      state: 'active',
      signature: 'c2lnbmF0dXJl',
    });
    expect(r.jwt.custom).toEqual([
      ['role', 'admin'],
      ['ü', 1],
    ]);
    expect(looksLikeJwt(token)).toBe(true);
  });

  it('handles base64url without padding and multi-byte text', () => {
    const payload = b64url({ name: 'Zoë 🙂' }); // contains - or _ and no = padding
    expect(payload).not.toContain('=');
    const r = decodeJwt(`${b64url({ alg: 'none' })}.${payload}.`, NOW);
    expect(r.ok && r.jwt.payload).toEqual({ name: 'Zoë 🙂' });
    expect(r.ok && r.jwt.state).toBe('no-expiry');
  });

  it('reports time state: expired and not yet valid', () => {
    expect(decodeJwt(jwt({ exp: sec(NOW) - 1 }), NOW)).toMatchObject({ ok: true, jwt: { state: 'expired' } });
    expect(decodeJwt(jwt({ nbf: sec(NOW) + 600, exp: sec(NOW) + 6000 }), NOW)).toMatchObject({ ok: true, jwt: { state: 'not-yet-valid' } });
  });

  it('keeps single and multiple audiences as a list', () => {
    expect(decodeJwt(jwt({ aud: ['a', 'b'] }), NOW)).toMatchObject({ ok: true, jwt: { aud: ['a', 'b'] } });
    expect(decodeJwt(jwt({}), NOW)).toMatchObject({ ok: true, jwt: { aud: [], custom: [] } });
  });

  it('returns errors, never throws, for malformed tokens', () => {
    for (const bad of [
      'abc',
      'a.b',
      `${b64url('not json')}.${b64url({})}.x`,
      `${b64url({ alg: 'x' })}.%%%.x`,
      `${b64url({ alg: 'x' })}.${b64url('[1]')}.x`,
      'a.b.c.d.e',
    ]) {
      const r = decodeJwt(bad, NOW);
      expect(r.ok, bad).toBe(false);
    }
    expect(looksLikeJwt('a.b.c')).toBe(false);
  });
});

describe('auth detection', () => {
  const token = jwt({ sub: 'u1', exp: sec(NOW) + 60 });

  it('classifies Bearer (with JWT), Basic, Digest, API key and custom schemes', () => {
    const items = detectAuth(
      [
        { name: 'Authorization', value: `Bearer ${token}` },
        { name: 'Proxy-Authorization', value: `Basic ${Buffer.from('ada:pw:with:colons').toString('base64')}` },
        { name: 'X-API-Key', value: 'k-123' },
        { name: 'X-Auth-Token', value: token },
        { name: 'X-Tenant-Secret', value: 'shh' },
        { name: 'Accept', value: 'application/json' },
      ],
      [{ name: 'WWW-Authenticate', value: 'Digest realm="api", qop="auth"' }],
      ['x-tenant-secret'],
      NOW,
    );
    expect(items.map((i) => [i.header, i.scheme])).toEqual([
      ['Authorization', 'Bearer'],
      ['Proxy-Authorization', 'Basic'],
      ['X-API-Key', 'API key'],
      ['X-Auth-Token', 'JWT'],
      ['X-Tenant-Secret', 'API key'],
      ['WWW-Authenticate', 'Digest'],
    ]);
    expect(items[0]!.jwt?.ok).toBe(true);
    expect(items[1]!.basicUser).toBe('ada');
    expect(items[5]!.source).toBe('response');
  });

  it('finds cookies and JWTs stored in cookies', () => {
    const items = detectAuth(
      [{ name: 'cookie', value: `theme=dark; session=${token}` }],
      [{ name: 'set-cookie', value: 'sid=abc; HttpOnly' }],
      [],
      NOW,
    );
    expect(items.map((i) => [i.header, i.scheme, i.cookieName])).toEqual([
      ['cookie', 'Cookie', undefined],
      ['cookie', 'JWT', 'session'],
      ['set-cookie', 'Cookie', undefined],
    ]);
  });

  it('labels unknown and custom schemes and returns nothing without auth', () => {
    const items = detectAuth(
      [
        { name: 'Authorization', value: 'AWS4-HMAC-SHA256 Credential=x' },
        { name: 'Authorization', value: 'opaque' },
      ],
      [],
      [],
      NOW,
    );
    expect(items.map((i) => i.scheme)).toEqual(['Custom', 'Unknown']);
    expect(items[0]!.customScheme).toBe('AWS4-HMAC-SHA256');
    expect(detectAuth([{ name: 'accept', value: '*/*' }], [], [], NOW)).toEqual([]);
  });
});
