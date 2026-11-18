import { describe, expect, it } from 'vitest';
import { cookiesOf, exportCookies, isSecretCookie, parseCookieHeader, parseSetCookie, REDACTED } from '../src/index.ts';
import { sampleEntries } from './fixtures.ts';

describe('cookie parsing', () => {
  it('splits a Cookie header, keeping = inside values', () => {
    expect(parseCookieHeader('a=1; b=x=y;  c ; =d')).toMatchObject([
      { name: 'a', value: '1' },
      { name: 'b', value: 'x=y' },
      { name: 'c', value: '' },
    ]);
  });

  it('reads every Set-Cookie attribute', () => {
    expect(
      parseSetCookie(
        'sid=abc; Domain=.example.com; Path=/app; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Max-Age=60; Secure; HttpOnly; SameSite=Lax; Partitioned; Priority=High',
      ),
    ).toEqual({
      name: 'sid',
      value: 'abc',
      source: 'response',
      domain: '.example.com',
      path: '/app',
      expires: 'Wed, 21 Oct 2026 07:28:00 GMT',
      maxAge: 60,
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      partitioned: true,
      priority: 'High',
    });
    expect(parseSetCookie('flag')).toBeNull();
    expect(parseSetCookie('x=1; max-age=abc')).toMatchObject({ maxAge: undefined, secure: false });
  });

  it('collects request and response cookies from headers, one Set-Cookie per line', () => {
    const [first] = sampleEntries();
    const c = cookiesOf({
      ...first!,
      response: { ...first!.response, headers: [{ name: 'set-cookie', value: 'a=1; Path=/\nb=2; Secure' }] },
    });
    expect(c.request.map((x) => x.name)).toEqual(['sid']);
    expect(c.response.map((x) => [x.name, x.secure])).toEqual([
      ['a', false],
      ['b', true],
    ]);
  });

  it('flags secret-looking cookies', () => {
    expect(isSecretCookie({ name: 'session_id', value: 'x' })).toBe(true);
    expect(isSecretCookie({ name: 'theme', value: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig' })).toBe(true);
    expect(isSecretCookie({ name: 'theme', value: 'dark' })).toBe(false);
  });
});

describe('cookie export', () => {
  const list = [
    { ...parseSetCookie('sid=s3cret; Domain=.example.com; Path=/; Max-Age=3600; Secure; HttpOnly')!, value: 's3cret' },
    { name: 'theme', value: '=dark', source: 'request' as const, secure: false, httpOnly: false, partitioned: false },
  ];
  const now = Date.UTC(2026, 0, 1);

  it('redacts values by default in every format', () => {
    for (const format of ['json', 'csv', 'netscape'] as const) {
      const out = exportCookies(list, format, { redact: true, host: 'app.example.com', now });
      expect(out, format).not.toContain('s3cret');
      expect(out, format).toContain(REDACTED);
    }
  });

  it('writes JSON, CSV (formula-safe) and Netscape jars', () => {
    expect(JSON.parse(exportCookies(list, 'json', { redact: false, host: 'h', now }))[0]).toMatchObject({
      name: 'sid',
      value: 's3cret',
      httpOnly: true,
    });
    const csv = exportCookies(list, 'csv', { redact: false, host: 'h', now }).trimEnd().split('\r\n');
    expect(csv[0]).toBe('source,name,value,domain,path,expires,maxAge,secure,httpOnly,sameSite,partitioned,priority');
    expect(csv[2]).toContain(`'=dark`);
    const jar = exportCookies(list, 'netscape', { redact: false, host: 'app.example.com', now }).split('\n');
    expect(jar[0]).toBe('# Netscape HTTP Cookie File');
    expect(jar).toContain(`#HttpOnly_.example.com\tTRUE\t/\tTRUE\t${now / 1000 + 3600}\tsid\ts3cret`);
    expect(jar).toContain('app.example.com\tFALSE\t/\tFALSE\t0\ttheme\t=dark');
  });
});
