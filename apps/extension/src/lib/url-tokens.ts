// Splits a URL, as typed, into coloured parts and finds its {{variables}}. The text is never
// parsed or normalised (it may be half typed, or start with a variable), only cut by position.
// Pure functions, unit-tested in test/url-tokens.test.ts.

export type UrlTokenKind = 'scheme' | 'host' | 'port' | 'slash' | 'path' | 'punct' | 'key' | 'value' | 'hash';

export interface UrlToken {
  from: number;
  to: number;
  kind: UrlTokenKind;
}

const PARTS = /^([a-z][a-z0-9+.-]*:\/\/)?([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i;
const PORT = /(:)(\d*|\{\{[^{}]*\}\})$/;

/** The parts of a URL: scheme, host, port, path (slashes apart), query keys and values, hash. */
export function urlTokens(text: string): UrlToken[] {
  const match = PARTS.exec(text);
  if (!match) return [];
  const [, scheme = '', authority = '', path = '', query = '', hash = ''] = match;
  const tokens: UrlToken[] = [];
  const add = (from: number, to: number, kind: UrlTokenKind) => {
    if (to > from) tokens.push({ from, to, kind });
  };

  let at = 0;
  add(at, (at += scheme.length), 'scheme');

  const port = PORT.exec(authority);
  const hostLength = port ? authority.length - port[0].length : authority.length;
  add(at, at + hostLength, 'host');
  if (port) {
    add(at + hostLength, at + hostLength + 1, 'punct');
    add(at + hostLength + 1, at + authority.length, 'port');
  }
  at += authority.length;

  for (const [segment] of path.matchAll(/\/|[^/]+/g)) {
    add(at, at + segment.length, segment === '/' ? 'slash' : 'path');
    at += segment.length;
  }

  if (query) {
    add(at, (at += 1), 'punct'); // ?
    for (const [pair] of query.slice(1).matchAll(/&|[^&]+/g)) {
      if (pair === '&') {
        add(at, (at += 1), 'punct');
        continue;
      }
      const equals = pair.indexOf('=');
      const keyEnd = equals < 0 ? pair.length : equals;
      add(at, at + keyEnd, 'key');
      if (equals >= 0) {
        add(at + keyEnd, at + keyEnd + 1, 'punct');
        add(at + keyEnd + 1, at + pair.length, 'value');
      }
      at += pair.length;
    }
  }

  add(at, at + hash.length, 'hash');
  return tokens;
}

export interface UrlVariable {
  from: number;
  to: number;
  name: string;
}

/** Every {{name}} in the text. */
export function urlVariables(text: string): UrlVariable[] {
  return [...text.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((match) => ({ from: match.index, to: match.index + match[0].length, name: match[1]! }));
}
