import { describe, expect, it } from 'vitest';
import { urlTokens, urlVariables } from '../src/lib/url-tokens.ts';

const parts = (text: string) => urlTokens(text).map((token) => `${token.kind}:${text.slice(token.from, token.to)}`);

describe('URL tokens', () => {
  it('cuts a full URL into scheme, host, port, path, query and hash', () => {
    expect(parts('https://api.example.com:8080/v1/users?a=1&b=x#top')).toEqual([
      'scheme:https://',
      'host:api.example.com',
      'punct::',
      'port:8080',
      'slash:/',
      'path:v1',
      'slash:/',
      'path:users',
      'punct:?',
      'key:a',
      'punct:=',
      'value:1',
      'punct:&',
      'key:b',
      'punct:=',
      'value:x',
      'hash:#top',
    ]);
  });

  it('copes with half-typed URLs, variables and empty parts', () => {
    expect(parts('https://')).toEqual(['scheme:https://']);
    expect(parts('{{base}}/x')).toEqual(['host:{{base}}', 'slash:/', 'path:x']);
    expect(parts('{{base}}:{{port}}/x')).toEqual(['host:{{base}}', 'punct::', 'port:{{port}}', 'slash:/', 'path:x']);
    expect(parts('localhost:')).toEqual(['host:localhost', 'punct::']);
    expect(parts('a.com/?flag&=v&')).toEqual(['host:a.com', 'slash:/', 'punct:?', 'key:flag', 'punct:&', 'punct:=', 'value:v', 'punct:&']);
    expect(parts('')).toEqual([]);
  });

  it('covers the text without overlaps or gaps', () => {
    const text = 'http://h:1/a//b?x=1&&y#z#w';
    const tokens = urlTokens(text);
    expect(tokens.map((token) => text.slice(token.from, token.to)).join('')).toBe(text);
  });

  it('finds variables', () => {
    expect(urlVariables('{{base}}/u/{{ id }}?q={{q.v-1}} {{bad name}}')).toEqual([
      { from: 0, to: 8, name: 'base' },
      { from: 11, to: 19, name: 'id' },
      { from: 22, to: 31, name: 'q.v-1' },
    ]);
  });
});
