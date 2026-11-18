import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertReplayAllowed,
  buildRequest,
  carriesCredentials,
  draftFromEntry,
  needsConfirmation,
  parseHar,
  ReplayBlocked,
  toCurl,
} from '../src/index.ts';
import { sampleEntries, sampleHarText } from './fixtures.ts';

afterEach(() => vi.restoreAllMocks());

describe('replay drafts', () => {
  const [get, gql] = sampleEntries();

  it('omits credentials, forbidden and pseudo headers by default', () => {
    const d = draftFromEntry(get!, 1);
    expect(d.headers).toBe('accept: application/json');
    expect(d.credentials).toBe(false);
    expect(d.credentialHeaders.map((h) => h.name)).toEqual(['authorization']);
    expect(d.query.split('\n')).toEqual(['expand=roles', 'token=abc123', 'q=a%2Bb']);
    expect(d.url).toBe('https://api.example.com/users/42');
    const built = buildRequest(d, {});
    expect('request' in built && built.request).toMatchObject({
      credentials: 'omit',
      url: 'https://api.example.com/users/42?expand=roles&token=abc123&q=a%2Bb',
    });
  });

  it('leaves out headers the browser adds itself, so an untouched replay needs no CORS preflight', () => {
    const browserHeaders = ['User-Agent', 'Priority', 'Cache-Control', 'Pragma', 'Accept-Language', 'sec-ch-ua'].map((name) => ({
      name,
      value: 'x',
    }));
    const entry = {
      ...get!,
      request: { ...get!.request, headers: [...get!.request.headers, ...browserHeaders, { name: 'X-Api-Key', value: 'k' }] },
    };
    expect(draftFromEntry(entry).headers).toBe('accept: application/json\nX-Api-Key: k');
  });

  it('copies captured cookies for editing and sends them only when asked', () => {
    const d = draftFromEntry(get!);
    expect(d.cookies).toEqual([{ name: 'sid', value: 's3cr3t' }]);
    const off = buildRequest(d, {});
    expect('request' in off && off.request.cookieHeader).toBeUndefined();
    const on = buildRequest(
      {
        ...d,
        sendCookies: true,
        cookies: [
          { name: 'sid', value: '{{sid}}' },
          { name: ' ', value: 'x' },
        ],
      },
      { sid: 'edited' },
    );
    expect('request' in on && on.request.cookieHeader).toBe('sid=edited');
  });

  it('adds captured credentials only when asked', () => {
    const built = buildRequest({ ...draftFromEntry(get!), credentials: true }, {});
    expect('request' in built && built.request.credentials).toBe('include');
    expect('request' in built && built.request.headers).toContainEqual(['authorization', 'Bearer live-secret']);
  });

  it('resolves variables and reports missing ones instead of sending', () => {
    const d = { ...draftFromEntry(gql!), url: '{{base}}/graphql', headers: 'x-key: {{ key }}\n# disabled: 1' };
    expect(buildRequest(d, { base: 'https://h.test' })).toEqual({ error: 'Unresolved variables: key' });
    const ok = buildRequest(d, { base: 'https://h.test', key: 'k1' });
    expect('request' in ok && ok.request).toMatchObject({ url: 'https://h.test/graphql', headers: [['x-key', 'k1']], method: 'POST' });
  });

  it('refuses non-http targets and malformed input', () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'chrome://settings', 'not a url']) {
      expect(buildRequest({ ...draftFromEntry(get!), url }, {})).toHaveProperty('error');
    }
    expect(buildRequest({ ...draftFromEntry(get!), method: 'GE T' }, {})).toHaveProperty('error');
    expect(buildRequest({ ...draftFromEntry(get!), headers: 'no colon' }, {})).toHaveProperty('error');
  });
});

describe('mutating requests', () => {
  it('need confirmation unless the method is safe', () => {
    expect(['GET', 'head', 'OPTIONS'].map(needsConfirmation)).toEqual([false, false, false]);
    expect(['POST', 'PUT', 'PATCH', 'DELETE', 'PURGE'].map(needsConfirmation)).toEqual([true, true, true, true, true]);
  });

  it('credentials and cookies also need confirmation, even for GET', () => {
    expect(() => assertReplayAllowed('GET', false, true)).toThrow(ReplayBlocked);
    expect(() => assertReplayAllowed('GET', true, true)).not.toThrow();
    const d = draftFromEntry(sampleEntries()[0]!);
    expect(carriesCredentials(d)).toBe(false);
    expect(carriesCredentials({ ...d, sendCookies: true })).toBe(true);
    expect(carriesCredentials({ ...d, sendCookies: true, cookies: [] })).toBe(false);
  });

  it('are blocked by the send guard without confirmation', () => {
    expect(() => assertReplayAllowed('POST', false)).toThrow(ReplayBlocked);
    expect(() => assertReplayAllowed('DELETE', false)).toThrow(ReplayBlocked);
    expect(() => assertReplayAllowed('POST', true)).not.toThrow();
    expect(() => assertReplayAllowed('GET', false)).not.toThrow();
  });

  it('are never sent while importing or analysing a file', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { entries } = parseHar(sampleHarText);
    entries.forEach((e) => buildRequest(draftFromEntry(e), {}));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('cURL', () => {
  it('quotes every argument for a POSIX shell', () => {
    const built = buildRequest({ ...draftFromEntry(sampleEntries()[2]!), body: "it's $(rm -rf ~)" }, {});
    if (!('request' in built)) throw new Error(built.error);
    expect(toCurl(built.request)).toBe(
      `curl -X POST 'https://example.com/login' -H 'content-type: application/x-www-form-urlencoded' --data-raw 'it'\\''s $(rm -rf ~)'`,
    );
  });
});
