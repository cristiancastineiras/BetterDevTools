import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bodyKind,
  diffLines,
  formFields,
  graphqlOf,
  hexDump,
  prettyGraphql,
  prettyJson,
  prettyMarkup,
  redactDeep,
  redactEntry,
  REDACTED,
} from '../src/index.ts';
import { sampleEntries } from './fixtures.ts';

describe('viewers', () => {
  it('re-indents JSON without losing precision or escapes', () => {
    expect(prettyJson('{"big":12345678901234567890,"s":"a\\"{,}","e":[],"o":{}}')).toBe(
      '{\n  "big": 12345678901234567890,\n  "s": "a\\"{,}",\n  "e": [],\n  "o": {}\n}',
    );
    expect(prettyJson('not json')).toBeNull();
  });

  it('formats JSON the same way on the native fast path and the exact path', () => {
    // fast path: the text is what JSON.stringify would write
    expect(prettyJson('{"a":[1,{"b":null}],"c":"x"}')).toBe('{\n  "a": [\n    1,\n    {\n      "b": null\n    }\n  ],\n  "c": "x"\n}');
    // already indented: returned as it is
    const indented = '{\n  "a": 1\n}';
    expect(prettyJson(indented)).toBe(indented);
    // things JSON.stringify would change keep their source text
    expect(prettyJson('{"n":1.50,"e":1e3,"u":"\\u00e9","2":"b","1":"a"}')).toBe(
      '{\n  "n": 1.50,\n  "e": 1e3,\n  "u": "\\u00e9",\n  "2": "b",\n  "1": "a"\n}',
    );
    expect(prettyJson('{"k":1,"k":2}')).toBe('{\n  "k": 1,\n  "k": 2\n}');
    expect(prettyJson(' [ "a\\\\" , "b\\\\\\"c" ] ')).toBe('[\n  "a\\\\",\n  "b\\\\\\"c"\n]');
    expect(prettyJson('[1]', { value: [1] })).toBe('[\n  1\n]');
  });

  it('indents markup, skipping void elements', () => {
    expect(prettyMarkup('<a><b>x</b><br><c/></a>')).toBe('<a>\n  <b>x</b>\n  <br>\n  <c/>\n</a>');
  });

  it('formats GraphQL bodies', () => {
    const g = graphqlOf(sampleEntries()[1]!.request.postData!.text!);
    expect(g).toMatchObject({ operationName: 'Me', query: 'query Me { me { id name } }' });
    expect(prettyGraphql(g!.query)).toBe('query Me {\n  me {\n    id name\n  }\n}');
    expect(graphqlOf('{"a":1}')).toBeNull();
  });

  it('decodes forms, detects kinds and dumps binary as text', () => {
    expect(formFields('a=1&b=x%20y')).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: 'x y' },
    ]);
    expect(bodyKind('application/problem+json')).toBe('json');
    expect(bodyKind('application/octet-stream', 'base64')).toBe('binary');
    expect(bodyKind('text/css', 'base64')).toBe('text');
    const dump = hexDump(base64ToBytes('PHNjcmlwdD4='), 4);
    expect(dump).toBe(`00000000  ${'3c 73 63 72'.padEnd(47)}  <scr\n… 4 more bytes not shown`);
  });
});

describe('diff', () => {
  it('marks added and removed lines', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc')).toEqual([
      { op: '=', text: 'a' },
      { op: '-', text: 'b' },
      { op: '+', text: 'x' },
      { op: '=', text: 'c' },
    ]);
    expect(diffLines('same', 'same')).toEqual([{ op: '=', text: 'same' }]);
  });

  it('refuses inputs beyond its memory budget', () => {
    const big = Array.from({ length: 3000 }, (_, i) => `l${i}`).join('\n');
    expect(diffLines(big, big.replaceAll('l', 'm'), 1_000_000)).toBeNull();
  });
});

describe('redaction', () => {
  it('masks headers, cookies, query and body secrets without touching other bytes', () => {
    const original = sampleEntries()[0]!;
    const before = JSON.stringify(original);
    const e = redactEntry(original);
    expect(JSON.stringify(original)).toBe(before);
    expect(e.request.cookies[0]!.value).toBe(REDACTED);
    expect(e.request.queryString).toContainEqual({ name: 'token', value: REDACTED });
    expect(e.request.url).toContain('q=a%2Bb');
  });

  it('masks secrets in URL fragments, redirects and URL-bearing headers', () => {
    const base = sampleEntries()[2]!;
    const e = redactEntry({
      ...base,
      request: {
        ...base.request,
        url: 'https://app.test/cb#access_token=eyJ.x&token_type=bearer',
        headers: [{ name: 'Referer', value: 'https://a.test/?sig=abc&page=2' }],
      },
      response: {
        ...base.response,
        redirectURL: 'https://a.test/next?token=t1&x=1',
        headers: [{ name: 'Location', value: '/next?token=t1&x=1' }],
      },
    });
    expect(e.request.url).toBe(`https://app.test/cb#access_token=${REDACTED}&token_type=bearer`);
    expect(e.request.headers[0]!.value).toBe(`https://a.test/?sig=${REDACTED}&page=2`);
    expect(e.response.redirectURL).toBe(`https://a.test/next?token=${REDACTED}&x=1`);
    expect(e.response.headers[0]!.value).toBe(`/next?token=${REDACTED}&x=1`);
  });

  it('masks secret-named keys in structured logs', () => {
    expect(redactDeep({ headers: { Authorization: 'x' }, nested: [{ password: 'p', ok: 1 }] })).toEqual({
      headers: { Authorization: REDACTED },
      nested: [{ password: REDACTED, ok: 1 }],
    });
  });
});
