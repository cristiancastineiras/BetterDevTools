import { describe, expect, it } from 'vitest';
import {
  bodyTypeOf,
  getHeader,
  graphqlBody,
  graphqlParts,
  multipartBody,
  multipartRows,
  parseRows,
  rowsText,
  setHeader,
  urlencodedBody,
  urlencodedRows,
} from '../src/index.ts';

describe('rows', () => {
  it('reads disabled rows from # lines and writes them back', () => {
    const rows = parseRows('Accept: */*\n# X-Debug: 1\nHost:x', ':');
    expect(rows).toEqual([
      { enabled: true, key: 'Accept', value: '*/*' },
      { enabled: false, key: 'X-Debug', value: '1' },
      { enabled: true, key: 'Host', value: 'x' },
    ]);
    expect(rowsText(rows, ':')).toBe('Accept: */*\n# X-Debug: 1\nHost: x');
    expect(rowsText(parseRows('a=1\n# b=2', '='), '=')).toBe('a=1\n# b=2');
  });

  it('sets and removes one header without touching the others', () => {
    const headers = 'Accept: */*\nContent-Type: text/plain';
    expect(getHeader(headers, 'content-type')).toBe('text/plain');
    expect(setHeader(headers, 'Content-Type', 'application/json')).toBe('Accept: */*\nContent-Type: application/json');
    expect(setHeader(headers, 'Content-Type', null)).toBe('Accept: */*');
    expect(setHeader('', 'Content-Type', 'text/html')).toBe('Content-Type: text/html');
  });
});

describe('body types', () => {
  it('tells them apart by Content-Type, then by shape', () => {
    expect(bodyTypeOf('', '')).toBe('none');
    expect(bodyTypeOf('Content-Type: application/json', '{"a":1}')).toBe('json');
    expect(bodyTypeOf('', '{"a":1}')).toBe('json');
    expect(bodyTypeOf('Content-Type: application/json', '{"query":"{ me }","variables":{}}')).toBe('graphql');
    expect(bodyTypeOf('Content-Type: application/x-www-form-urlencoded', 'a=1')).toBe('urlencoded');
    expect(bodyTypeOf('', 'a=1&b=2')).toBe('urlencoded');
    expect(bodyTypeOf('Content-Type: multipart/form-data; boundary=x', '--x')).toBe('multipart');
    expect(bodyTypeOf('', '<a/>')).toBe('xml');
    expect(bodyTypeOf('', 'hello world')).toBe('text');
  });

  it('round-trips form bodies and keeps {{variables}} unencoded', () => {
    const rows = [
      { enabled: true, key: 'q', value: 'a b&c' },
      { enabled: false, key: 'skip', value: '1' },
      { enabled: true, key: 'token', value: '{{token}}' },
    ];
    expect(urlencodedBody(rows)).toBe('q=a+b%26c&token={{token}}');
    expect(urlencodedRows('q=a+b%26c').map((r) => r.value)).toEqual(['a b&c']);
    const multipart = multipartBody(rows, 'B');
    expect(multipart).toBe(
      '--B\r\nContent-Disposition: form-data; name="q"\r\n\r\na b&c\r\n--B\r\nContent-Disposition: form-data; name="token"\r\n\r\n{{token}}\r\n--B--\r\n',
    );
    expect(multipartRows(multipart, 'B')).toEqual([
      { enabled: true, key: 'q', value: 'a b&c' },
      { enabled: true, key: 'token', value: '{{token}}' },
    ]);
  });

  it('splits and joins GraphQL bodies', () => {
    const { body, invalidVariables } = graphqlBody('{ me }', '{"id":1}');
    expect(JSON.parse(body)).toEqual({ query: '{ me }', variables: { id: 1 } });
    expect(invalidVariables).toBe(false);
    expect(graphqlParts(body)).toEqual({ query: '{ me }', variables: '{\n  "id": 1\n}' });
    expect(graphqlBody('{ me }', '{oops').invalidVariables).toBe(true);
  });
});
