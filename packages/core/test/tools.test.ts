import { describe, expect, it } from 'vitest';
import {
  colorFormats,
  contrastRatio,
  convertBase,
  convertCase,
  CronError,
  curlToCode,
  CURL_TARGETS,
  decodeText,
  describeCron,
  encodeText,
  ENCODINGS,
  formatJson,
  formatUuid,
  guessUnit,
  hashAll,
  hmac,
  inZone,
  jsonUnescape,
  md5,
  minifyJson,
  nextRuns,
  parseColor,
  parseCron,
  parseCurl,
  parseInstant,
  parseSse,
  parseUrlText,
  parseUuid,
  queryJsonPath,
  runRegex,
  sortJson,
  textStats,
  toHex,
  uuidV7,
  verifyJwtHmac,
  verifyWebhook,
  wcag,
  jsonToYaml,
  jsonError,
  type CurlRequest,
} from '../src/index.ts';

const enc = new TextEncoder();
const hex = (text: string) => toHex(md5(enc.encode(text)));

// ------------------------------------------------------------------------------------ JSONPath

const STORE = {
  store: {
    book: [
      { category: 'reference', author: 'Nigel Rees', title: 'Sayings of the Century', price: 8.95 },
      { category: 'fiction', author: 'Evelyn Waugh', title: 'Sword of Honour', price: 12.99 },
      { category: 'fiction', author: 'Herman Melville', title: 'Moby Dick', isbn: '0-553-21311-3', price: 8.99 },
      { category: 'fiction', author: 'J. R. R. Tolkien', title: 'The Lord of the Rings', isbn: '0-395-19395-8', price: 22.99 },
    ],
    bicycle: { color: 'red', price: 399 },
  },
};
const values = (path: string) => {
  const r = queryJsonPath(STORE, path);
  if (!r.ok) throw new Error(r.error);
  return r.nodes.map((n) => n.value);
};

describe('JSONPath (RFC 9535 examples)', () => {
  it('selects names, wildcards, indexes, slices and unions', () => {
    expect(values('$.store.book[*].author')).toEqual(['Nigel Rees', 'Evelyn Waugh', 'Herman Melville', 'J. R. R. Tolkien']);
    expect(values('$.store.bicycle.color')).toEqual(['red']);
    expect(values("$['store']['bicycle']['price']")).toEqual([399]);
    expect(values('$..book[2].title')).toEqual(['Moby Dick']);
    expect(values('$..book[-1].title')).toEqual(['The Lord of the Rings']);
    expect(values('$..book[0,1].title')).toEqual(['Sayings of the Century', 'Sword of Honour']);
    expect(values('$..book[:2].title')).toEqual(['Sayings of the Century', 'Sword of Honour']);
    expect(values('$..book[::2].title')).toEqual(['Sayings of the Century', 'Moby Dick']);
    expect(values('$..book[::-1].title')[0]).toBe('The Lord of the Rings');
  });

  it('descends recursively', () => {
    expect(values('$..author')).toHaveLength(4);
    expect(values('$.store..price')).toEqual([8.95, 12.99, 8.99, 22.99, 399]);
    expect((values('$..*') as unknown[]).length).toBeGreaterThan(20);
  });

  it('filters with comparisons, logic, existence and functions', () => {
    expect(values('$..book[?@.isbn].title')).toEqual(['Moby Dick', 'The Lord of the Rings']);
    expect(values('$..book[?@.price<10].title')).toEqual(['Sayings of the Century', 'Moby Dick']);
    expect(values('$..book[?(@.price > 10 && @.category == "fiction")].title')).toEqual(['Sword of Honour', 'The Lord of the Rings']);
    expect(values('$..book[?!@.isbn].title')).toHaveLength(2);
    expect(values('$..book[?@.category=="reference" || @.price>20].title')).toHaveLength(2);
    expect(values('$..book[?length(@.title)>20].title')).toEqual(['Sayings of the Century', 'The Lord of the Rings']);
    expect(values('$..book[?match(@.author, "J\\\\. .*")].title')).toEqual(['The Lord of the Rings']);
    expect(values('$..book[?search(@.title, "Dick")].title')).toEqual(['Moby Dick']);
    expect(values('$[?count(@.*)>1]')).toHaveLength(1);
  });

  it('reports normalised paths', () => {
    const result = queryJsonPath(STORE, '$..book[1].price');
    expect(result).toEqual({ ok: true, nodes: [{ path: "$['store']['book'][1]['price']", value: 12.99 }] });
    expect(queryJsonPath({ "a'b": 1 }, "$['a\\'b']")).toMatchObject({ nodes: [{ path: "$['a\\'b']" }] });
  });

  it('says where a path is wrong', () => {
    expect(queryJsonPath({}, 'store.book')).toMatchObject({ ok: false });
    expect(queryJsonPath({}, '$.store[')).toMatchObject({ ok: false, error: expect.stringContaining('position') });
    expect(queryJsonPath({}, '$[?@.a ~ 1]')).toMatchObject({ ok: false });
    expect(queryJsonPath({}, '$[?nope(@.a)]')).toMatchObject({ ok: false, error: expect.stringContaining('nope') });
    expect(queryJsonPath({ a: 1 }, '$.b')).toEqual({ ok: true, nodes: [] });
  });
});

// ------------------------------------------------------------------------------------- regex

describe('regex tester', () => {
  it('lists matches with groups and named groups', () => {
    const r = runRegex({ pattern: '(?<key>\\w+)=(\\d+)', flags: 'g', text: 'a=1 b=22', replacement: null });
    expect(r).toMatchObject({ ok: true, more: false, replaced: null });
    if (r.ok) {
      expect(r.matches.map((m) => [m.index, m.text, m.groups, m.named.key])).toEqual([
        [0, 'a=1', ['a', '1'], 'a'],
        [4, 'b=22', ['b', '22'], 'b'],
      ]);
    }
  });

  it('previews a replacement and honours the flags', () => {
    expect(runRegex({ pattern: '(\\w+)@', flags: 'gi', text: 'Ann@x, BOB@y', replacement: '<$1>' })).toMatchObject({
      replaced: '<Ann>x, <BOB>y',
    });
    expect(runRegex({ pattern: 'a', flags: '', text: 'aaa', replacement: null })).toMatchObject({ matches: [{ index: 0 }] });
  });

  it('handles empty matches, the limit and bad patterns', () => {
    const empty = runRegex({ pattern: 'x*', flags: 'g', text: 'ab', replacement: null });
    expect(empty.ok && empty.matches.length).toBe(3);
    const many = runRegex({ pattern: '.', flags: 'g', text: 'x'.repeat(50), replacement: null }, 10);
    expect(many).toMatchObject({ ok: true, more: true });
    expect(runRegex({ pattern: '(', flags: '', text: '', replacement: null })).toMatchObject({ ok: false });
    expect(runRegex({ pattern: 'a', flags: 'z', text: '', replacement: null })).toMatchObject({ ok: false });
  });
});

// ---------------------------------------------------------------------------- encode and hash

describe('encodings', () => {
  it('round-trips every encoding, including non-ASCII', () => {
    const text = 'Héllo <wörld> & "ñ" 🙂';
    for (const kind of ENCODINGS) expect(decodeText(kind, encodeText(kind, text))).toBe(text);
  });

  it('matches known encodings', () => {
    expect(encodeText('base64', 'hello')).toBe('aGVsbG8=');
    expect(encodeText('base64url', '??>>')).toBe('Pz8-Pg');
    expect(decodeText('base64', 'aGVsbG8')).toBe('hello');
    expect(decodeText('base64', 'Pz8-Pg')).toBe('??>>');
    expect(encodeText('url', 'a b&c=d')).toBe('a%20b%26c%3Dd');
    expect(encodeText('url-form', 'a b')).toBe('a+b');
    expect(encodeText('hex', 'Hi')).toBe('48 69');
    expect(encodeText('binary', 'A')).toBe('01000001');
    expect(encodeText('html', '<a href="x">')).toBe('&lt;a href=&quot;x&quot;&gt;');
    expect(decodeText('html', '&lt;p&gt;&amp;&#65;&#x42;&euro;&unknown;')).toBe('<p>&AB€&unknown;');
    expect(decodeText('unicode', '\\u0041\\u{1F642}\\n')).toBe('A🙂\n');
    expect(encodeText('rot13', 'Hello')).toBe('Uryyb');
  });

  it('rejects input that is not in that encoding', () => {
    expect(() => decodeText('base64', '!!!')).toThrow('Base64');
    expect(() => decodeText('hex', 'xyz')).toThrow('hex');
    expect(() => decodeText('binary', '012')).toThrow('binary');
    expect(() => decodeText('url', '%E0%A4%A')).toThrow('percent');
  });
});

describe('hashes', () => {
  it('computes MD5, SHA and CRC32 to their published values', async () => {
    expect(hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(hex('The quick brown fox jumps over the lazy dog')).toBe('9e107d9d372bb6826bd81d3542a419d6');
    expect(hex('a'.repeat(1000))).toBe('cabe45dcc9ae5b66ba86600cca6b8ba8');
    const rows = Object.fromEntries((await hashAll('abc')).map((r) => [r.name, r.hex]));
    expect(rows.SHA256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(rows.SHA1).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect((await hashAll('123456789')).find((r) => r.name === 'CRC32')?.hex).toBe('cbf43926');
  });

  it('computes HMAC for MD5 and SHA-256', async () => {
    const key = enc.encode('key');
    const message = enc.encode('The quick brown fox jumps over the lazy dog');
    expect(toHex(await hmac('md5', key, message))).toBe('80070713463e7749b90c2dc24911e275');
    expect(toHex(await hmac('sha256', key, message))).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  });
});

describe('JWT signatures', () => {
  const token =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  it('verifies HS256 with the right secret only', async () => {
    expect(await verifyJwtHmac(token, 'your-256-bit-secret')).toEqual({ status: 'valid' });
    expect(await verifyJwtHmac(token, 'wrong')).toEqual({ status: 'invalid' });
    expect(await verifyJwtHmac(`${token.slice(0, -2)}xx`, 'your-256-bit-secret')).toEqual({ status: 'invalid' });
  });
  it('does not pretend to verify other algorithms', async () => {
    const rs256 = `${btoa('{"alg":"RS256"}').replace(/=/g, '')}.e30.sig`;
    expect(await verifyJwtHmac(rs256, 'x')).toMatchObject({ status: 'unsupported' });
  });
});

describe('webhook signatures', () => {
  it('verifies GitHub with its documented test vector', async () => {
    const check = {
      provider: 'github' as const,
      secret: "It's a Secret to Everybody",
      body: 'Hello, World!',
      header: 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
    };
    expect(await verifyWebhook(check)).toMatchObject({ ok: true });
    expect(await verifyWebhook({ ...check, body: 'Hello, World?' })).toMatchObject({ ok: false, reason: 'mismatch' });
    expect(await verifyWebhook({ ...check, secret: '' })).toMatchObject({ ok: false, reason: 'missing' });
  });

  it('verifies Stripe and Slack, flagging old timestamps', async () => {
    const now = 1_700_000_000_000;
    const t = String(now / 1000);
    const stripe = toHex(await hmac('sha256', enc.encode('whsec'), enc.encode(`${t}.{"id":1}`)));
    expect(await verifyWebhook({ provider: 'stripe', secret: 'whsec', body: '{"id":1}', header: `t=${t},v1=${stripe}`, now })).toEqual({
      ok: true,
      expected: stripe,
      stale: false,
    });
    expect(
      await verifyWebhook({ provider: 'stripe', secret: 'whsec', body: '{"id":1}', header: `t=${t},v1=${stripe}`, now: now + 600_000 }),
    ).toMatchObject({ ok: true, stale: true });
    expect(await verifyWebhook({ provider: 'stripe', secret: 'whsec', body: '{}', header: 'nonsense' })).toMatchObject({
      reason: 'malformed',
    });
    const slack = toHex(await hmac('sha256', enc.encode('s'), enc.encode(`v0:${t}:body`)));
    expect(await verifyWebhook({ provider: 'slack', secret: 's', body: 'body', header: `v0=${slack}`, timestamp: t, now })).toMatchObject({
      ok: true,
    });
  });

  it('verifies a generic HMAC in hex or base64', async () => {
    const digest = await hmac('sha512', enc.encode('k'), enc.encode('m'));
    const base64 = btoa(String.fromCharCode(...digest));
    expect(await verifyWebhook({ provider: 'generic', secret: 'k', body: 'm', header: toHex(digest), algorithm: 'sha512' })).toMatchObject({
      ok: true,
    });
    expect(
      await verifyWebhook({ provider: 'generic', secret: 'k', body: 'm', header: base64, algorithm: 'sha512', encoding: 'base64' }),
    ).toMatchObject({ ok: true });
    expect(await verifyWebhook({ provider: 'generic', secret: 'k', body: 'm', header: 'deadbeef', algorithm: 'sha512' })).toMatchObject({
      ok: false,
    });
  });
});

// ------------------------------------------------------------------------------------- JSON

describe('JSON tools', () => {
  it('formats without touching big numbers, and indents with tabs or four spaces', () => {
    expect(formatJson('{"id":12345678901234567890,"n":1.50}')).toEqual({
      ok: true,
      output: '{\n  "id": 12345678901234567890,\n  "n": 1.50\n}',
    });
    expect(formatJson('{"a":[1]}', 4)).toMatchObject({ output: '{\n    "a": [\n        1\n    ]\n}' });
    expect(formatJson('{"a":[1]}', 'tab')).toMatchObject({ output: '{\n\t"a": [\n\t\t1\n\t]\n}' });
  });

  it('minifies, sorts and converts', () => {
    expect(minifyJson('{ "a" : "x y", "b": [1, 2] }')).toEqual({ ok: true, output: '{"a":"x y","b":[1,2]}' });
    expect(sortJson('{"b":1,"a":{"d":1,"c":2}}')).toMatchObject({ output: '{\n  "a": {\n    "c": 2,\n    "d": 1\n  },\n  "b": 1\n}' });
    expect(jsonToYaml('{"a":[1,2],"b":{"c":"x"}}')).toMatchObject({ ok: true, output: expect.stringContaining('a:') });
    expect(jsonUnescape('"line\\nbreak"')).toEqual({ ok: true, output: 'line\nbreak' });
    expect(jsonUnescape('plain \\"q\\"')).toEqual({ ok: true, output: 'plain "q"' });
  });

  it('points at the error', () => {
    const result = formatJson('{\n  "a": 1,\n  "b": }');
    expect(result).toMatchObject({ ok: false, line: 3, column: 8 });
    expect(formatJson('{"a":1,}')).toMatchObject({ line: 1, column: 8 });
    expect(formatJson('[1, 2')).toMatchObject({ line: 1, column: 6 });
    expect(formatJson('{"a": "x\ny"}')).toMatchObject({ line: 1, column: 9 });
    expect(formatJson('')).toMatchObject({ ok: false });
    expect(jsonError('x', new Error('Unexpected token at line 4 column 9'))).toMatchObject({ line: 4, column: 9 });
  });
});

// ------------------------------------------------------------------------------------- UUID

describe('UUID', () => {
  it('v7 carries its time, version and variant, and a batch sorts', () => {
    const when = Date.UTC(2025, 5, 1, 12, 0, 0);
    const batch = Array.from({ length: 50 }, () => uuidV7(when));
    expect(batch).toEqual(batch.toSorted());
    expect(new Set(batch).size).toBe(50);
    expect(parseUuid(batch[0]!)).toEqual({ valid: true, version: 7, variant: 'RFC 9562', time: when });
  });

  it('reads other versions and formats', () => {
    expect(parseUuid('c232ab00-9414-11ec-b3c8-9f6bdeced846')).toMatchObject({ version: 1, time: Date.UTC(2022, 1, 22, 19, 22, 22) });
    expect(parseUuid('{123E4567-E89B-42D3-A456-426614174000}')).toMatchObject({ valid: true, version: 4 });
    expect(parseUuid('nope')).toEqual({ valid: false });
    expect(formatUuid('123e4567-e89b-42d3-a456-426614174000', { upper: true, hyphens: false, braces: true })).toBe(
      '{123E4567E89B42D3A456426614174000}',
    );
  });
});

// ------------------------------------------------------------------------------------ epoch

describe('epoch', () => {
  it('reads timestamps by size and dates by text', () => {
    expect(guessUnit(10)).toBe('s');
    expect(parseInstant('1700000000')).toEqual({ ms: 1_700_000_000_000, unit: 's' });
    expect(parseInstant('1700000000123')).toEqual({ ms: 1_700_000_000_123, unit: 'ms' });
    expect(parseInstant('1700000000123456')).toMatchObject({ unit: 'us' });
    expect(parseInstant('1700000000', 0, 'ms')).toEqual({ ms: 1_700_000_000, unit: 'ms' });
    expect(parseInstant('2023-11-14T22:13:20Z')).toEqual({ ms: 1_700_000_000_000, unit: 'date' });
    expect(parseInstant('now', 42)).toEqual({ ms: 42, unit: 'date' });
    expect(parseInstant('not a date')).toBeNull();
  });

  it('shows an instant in a zone', () => {
    expect(inZone(1_700_000_000_123, 'UTC')).toEqual({ zone: 'UTC', text: '2023-11-14 22:13:20.123', offset: '+00:00' });
    expect(inZone(1_700_000_000_000, 'Asia/Tokyo')).toMatchObject({ text: '2023-11-15 07:13:20.000', offset: '+09:00' });
  });
});

// ------------------------------------------------------------------------------------- cron

describe('cron', () => {
  it('describes expressions in English and Spanish', () => {
    expect(describeCron(parseCron('*/5 * * * *'))).toBe('Every 5 minutes');
    expect(describeCron(parseCron('* * * * *'))).toBe('Every minute');
    expect(describeCron(parseCron('0 9 * * 1-5'))).toBe('At 09:00, on Monday through Friday');
    expect(describeCron(parseCron('30 4 1 JAN *'))).toBe('At 04:30, on day-of-month 1, in January');
    expect(describeCron(parseCron('15 * * * *'))).toBe('At minute 15 past every hour');
    expect(describeCron(parseCron('0 */2 * * *'))).toBe('At minute 0 past every 2nd hour');
    expect(describeCron(parseCron('0 9 * * 1-5'), 'es')).toBe('A las 09:00, de lunes a viernes');
    expect(describeCron(parseCron('@daily'))).toBe('At 00:00');
  });

  it('computes the next runs', () => {
    const after = new Date('2024-01-01T10:07:00Z');
    expect(nextRuns(parseCron('*/15 * * * *'), after, 4, true).map((d) => d.toISOString())).toEqual([
      '2024-01-01T10:15:00.000Z',
      '2024-01-01T10:30:00.000Z',
      '2024-01-01T10:45:00.000Z',
      '2024-01-01T11:00:00.000Z',
    ]);
    expect(nextRuns(parseCron('0 0 29 2 *'), after, 2, true).map((d) => d.getUTCFullYear())).toEqual([2024, 2028]);
    expect(nextRuns(parseCron('0 0 30 2 *'), after, 1, true)).toEqual([]);
    // day-of-month and day-of-week together mean either
    expect(nextRuns(parseCron('0 0 15 * 1'), after, 3, true).map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2024-01-08',
      '2024-01-15',
      '2024-01-22',
    ]);
    expect(nextRuns(parseCron('30 * * * * *'), after, 2, true).map((d) => d.toISOString())).toEqual([
      '2024-01-01T10:07:30.000Z',
      '2024-01-01T10:08:30.000Z',
    ]);
  });

  it('rejects what is not a schedule', () => {
    for (const bad of ['* * * *', '60 * * * *', '* 24 * * *', '*/0 * * * *', '5-1 * * * *', '* * * FOO *', '@reboot'])
      expect(() => parseCron(bad), bad).toThrow(CronError);
  });
});

// -------------------------------------------------------------------------------------- curl

const parsed = (command: string): CurlRequest => {
  const r = parseCurl(command);
  if (!r.ok) throw new Error(r.error);
  return r.request;
};

describe('cURL converter', () => {
  const chrome = `curl 'https://api.example.com/users?id=1' \\
  -H 'accept: application/json' \\
  -H 'content-type: application/json' \\
  -b 'sid=abc' \\
  --data-raw '{"name":"Ada","tags":["a"],"ok":true,"n":null}' \\
  --compressed`;

  it('reads what Chrome copies', () => {
    expect(parsed(chrome)).toMatchObject({
      method: 'POST',
      url: 'https://api.example.com/users?id=1',
      body: '{"name":"Ada","tags":["a"],"ok":true,"n":null}',
      compressed: true,
      headers: [
        ['accept', 'application/json'],
        ['content-type', 'application/json'],
        ['Cookie', 'sid=abc'],
      ],
    });
  });

  it('reads the common options', () => {
    expect(parsed('curl -X PUT -u user:pa:ss -d a=1 -d b=2 example.com/x')).toMatchObject({
      method: 'PUT',
      url: 'http://example.com/x',
      body: 'a=1&b=2',
      basicAuth: { user: 'user', password: 'pa:ss' },
    });
    expect(parsed('curl -I https://x.test')).toMatchObject({ method: 'HEAD' });
    expect(parsed('curl -sSLk https://x.test')).toMatchObject({ followRedirects: true, insecure: true });
    expect(parsed('curl -XDELETE https://x.test/1')).toMatchObject({ method: 'DELETE' });
    expect(parsed('curl -G -d q=a https://x.test/s')).toMatchObject({ method: 'GET', url: 'https://x.test/s?q=a', body: undefined });
    expect(parsed("curl $'https://x.test/\\x41' -H $'X-A: b\\tc'")).toMatchObject({ url: 'https://x.test/A', headers: [['X-A', 'b\tc']] });
    expect(parsed('curl -F a=1 -F "b=two words" https://x.test')).toMatchObject({
      method: 'POST',
      form: [
        ['a', '1'],
        ['b', 'two words'],
      ],
    });
    expect(parsed('curl --json \'{"a":1}\' https://x.test').headers).toEqual([
      ['Content-Type', 'application/json'],
      ['Accept', 'application/json'],
    ]);
    expect(parsed('curl --header="X-A: 1" --url https://x.test | jq .')).toMatchObject({ url: 'https://x.test', headers: [['X-A', '1']] });
    expect(parseCurl('curl -s')).toEqual({ ok: false, error: 'No URL found in the command' });
  });

  it('writes working code for every target', () => {
    const r = parsed(chrome);
    expect(curlToCode(r, 'fetch')).toContain('method: "POST"');
    expect(curlToCode(r, 'fetch')).toContain('body: JSON.stringify({');
    expect(curlToCode(r, 'axios')).toContain('method: "post"');
    expect(curlToCode(r, 'axios')).toContain('data: {');
    const python = curlToCode(r, 'python');
    expect(python).toContain('"ok": True');
    expect(python).toContain('"n": None');
    expect(python).toContain('allow_redirects=False');
    expect(curlToCode(r, 'csharp')).toContain('new StringContent(');
    expect(curlToCode(r, 'csharp')).toContain('HttpMethod.Post');
    expect(curlToCode(r, 'csharp')).not.toContain('Headers.TryAddWithoutValidation("content-type"');
    expect(curlToCode(r, 'java')).toContain('.method("POST", HttpRequest.BodyPublishers.ofString(');
    for (const target of CURL_TARGETS) expect(curlToCode(r, target)).toContain('https://api.example.com/users?id=1');
  });

  it('handles auth, forms and unusual methods', () => {
    const auth = parsed('curl -u ada:secret https://x.test');
    expect(curlToCode(auth, 'fetch')).toContain(`"Authorization": "Basic ${btoa('ada:secret')}"`);
    expect(curlToCode(auth, 'python')).toContain('auth=("ada", "secret")');
    const form = parsed('curl -F a=1 https://x.test');
    expect(curlToCode(form, 'fetch')).toContain('new FormData()');
    expect(curlToCode(form, 'python')).toContain('files={');
    expect(curlToCode(form, 'csharp')).toContain('MultipartFormDataContent');
    expect(curlToCode(parsed('curl -X PROPFIND https://x.test'), 'csharp')).toContain('new HttpMethod("PROPFIND")');
    expect(curlToCode(parsed('curl -k https://x.test'), 'python')).toContain('verify=False');
  });
});

// -------------------------------------------------------------------------------------- color

describe('colors', () => {
  it('parses the CSS syntaxes', () => {
    expect(parseColor('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('#00ff0080')).toMatchObject({ g: 255, a: 128 / 255 });
    expect(parseColor('rgb(255 0 0 / 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
    expect(parseColor('rgba(10, 20, 30, 0.25)')).toEqual({ r: 10, g: 20, b: 30, a: 0.25 });
    expect(parseColor('hsl(120, 100%, 25%)')).toEqual({ r: 0, g: 128, b: 0, a: 1 });
    expect(parseColor('hwb(0 0% 0%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('hsl(0.5turn 100% 50%)')).toEqual({ r: 0, g: 255, b: 255, a: 1 });
    expect(parseColor('rebeccapurple')).toBeNull();
    expect(parseColor('rgb(1 2)')).toBeNull();
  });

  it('converts between formats', () => {
    const red = Object.fromEntries(colorFormats({ r: 255, g: 0, b: 0, a: 1 }).map((f) => [f.name, f.value]));
    expect(red).toEqual({
      HEX: '#ff0000',
      RGB: 'rgb(255 0 0)',
      HSL: 'hsl(0 100% 50%)',
      HWB: 'hwb(0 0% 0%)',
      OKLCH: 'oklch(62.8% 0.258 29.2)',
    });
    expect(colorFormats({ r: 0, g: 0, b: 0, a: 0.5 }).find((f) => f.name === 'HEX')?.value).toBe('#00000080');
  });

  it('measures WCAG contrast', () => {
    const black = { r: 0, g: 0, b: 0, a: 1 };
    const white = { r: 255, g: 255, b: 255, a: 1 };
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
    expect(contrastRatio({ r: 119, g: 119, b: 119, a: 1 }, white)).toBeCloseTo(4.48, 2);
    expect(contrastRatio({ ...black, a: 0.5 }, white)).toBeLessThan(21);
    expect(wcag(4.48)).toMatchObject({ aaNormal: false, aaLarge: true, aaaLarge: false, ui: true });
    expect(wcag(7)).toMatchObject({ aaaNormal: true });
  });
});

// ------------------------------------------------------------------------------------ the rest

describe('text utilities', () => {
  it('converts number bases exactly', () => {
    expect(convertBase('ff', 16)).toEqual({ 2: '11111111', 8: '377', 10: '255', 16: 'ff' });
    expect(convertBase('-0b101', 2)).toMatchObject({ 10: '-5' });
    expect(convertBase('18446744073709551616', 10)).toMatchObject({ 16: '10000000000000000' });
    expect(convertBase('12', 2)).toBeNull();
  });

  it('converts naming styles and counts text', () => {
    const cases = Object.fromEntries(convertCase('helloWorld HTTPServer foo-bar').map((c) => [c.name, c.value]));
    expect(cases.snake_case).toBe('hello_world_http_server_foo_bar');
    expect(cases.camelCase).toBe('helloWorldHttpServerFooBar');
    expect(cases['kebab-case']).toBe('hello-world-http-server-foo-bar');
    expect(textStats('ab cd\nñ')).toEqual({ characters: 7, charactersNoSpaces: 5, words: 3, lines: 2, bytes: 8 });
  });

  it('parses URLs and warns about trouble', () => {
    const url = parseUrlText('http://user:pw@xn--bcher-kva.example/a%20b/c?x=1&y=%2520&flag#/p?t=9')!;
    expect(url.segments).toEqual(['a b', 'c']);
    expect(url.query).toEqual([
      { key: 'x', value: '1', raw: 'x=1' },
      { key: 'y', value: '%20', raw: 'y=%2520' },
      { key: 'flag', value: '', raw: 'flag' },
    ]);
    expect(url.hash).toEqual([{ key: 't', value: '9', raw: 't=9' }]);
    expect(url.warnings.toSorted()).toEqual(['credentials', 'double-encoded', 'insecure', 'punycode']);
    expect(parseUrlText('not a url')).toBeNull();
  });

  it('parses event streams like EventSource', () => {
    const events = parseSse(': hi\nid: 1\nevent: tick\ndata: a\ndata: b\n\ndata: only\nretry: 3000\n\n\ndata: unfinished');
    expect(events).toEqual([
      { event: 'tick', data: 'a\nb', id: '1', retry: undefined, comments: ['hi'] },
      { event: 'message', data: 'only', id: undefined, retry: 3000, comments: [] },
      { event: 'message', data: 'unfinished', id: undefined, retry: undefined, comments: [] },
    ]);
  });
});
