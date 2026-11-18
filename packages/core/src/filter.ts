import type { Captured } from './har.ts';

export type Matcher = (c: Captured) => boolean;

const UNITS = new Map([
  ['', 1],
  ['b', 1],
  ['k', 1024],
  ['kb', 1024],
  ['m', 1048576],
  ['mb', 1048576],
  ['ms', 1],
  ['s', 1000],
]);

function numeric(value: string, get: (c: Captured) => number): Matcher | undefined {
  const m = /^(>=|<=|>|<|=)?(\d+(?:\.\d+)?)([a-z]*)$/.exec(value);
  const unit = m ? UNITS.get(m[3] ?? '') : undefined;
  if (!m || unit === undefined) return undefined;
  const n = Number(m[2]) * unit;
  switch (m[1]) {
    case '>':
      return (c) => get(c) > n;
    case '<':
      return (c) => get(c) < n;
    case '>=':
      return (c) => get(c) >= n;
    case '<=':
      return (c) => get(c) <= n;
    default:
      return (c) => get(c) === n;
  }
}

type Field = (value: string, bodyText: (id: number) => string) => Matcher | undefined;

const initiator: Field = (v) => (c) => c.initiator.toLowerCase().includes(v);

/** Filter keys; values are matched case-insensitively. Documented in docs/filters.md. */
export const FILTER_FIELDS = new Map<string, Field>([
  [
    'method',
    (v) =>
      (
        (set) => (c: Captured) =>
          set.includes(c.method.toLowerCase())
      )(v.split(',')),
  ],
  ['domain', (v) => (c) => c.host.includes(v)],
  ['status', (v) => (/^[1-5]xx$/.test(v) ? (c) => Math.floor(c.status / 100) === Number(v[0]) : numeric(v, (c) => c.status))],
  ['mime', (v) => (c) => c.mime.toLowerCase().includes(v)],
  ['type', (v) => (c) => c.type.toLowerCase() === v],
  ['duration', (v) => numeric(v, (c) => c.duration)],
  ['size', (v) => numeric(v, (c) => c.size)],
  ['priority', (v) => (c) => c.priority.toLowerCase() === v],
  ['initiator', initiator],
  ['origin', initiator],
  ['source', (v) => (c) => c.source === v],
  ['body', (v, bodyText) => (c) => bodyText(c.id).toLowerCase().includes(v)],
  ['is', (v) => (v === 'error' ? (c) => c.error !== '' || c.status >= 400 : v === 'redirect' ? (c) => c.redirect !== '' : undefined)],
]);

/**
 * Compiles a query such as `method:post status:4xx -domain:cdn size:>10k login`.
 * Unknown keys and malformed values fall back to free-text search, so typing never errors.
 */
export function compileFilter(
  query: string,
  bodyText: (id: number) => string = () => '',
  options: { searchBodies?: boolean } = {},
): Matcher {
  const tests: Matcher[] = [];
  for (const raw of query.trim().toLowerCase().split(/\s+/)) {
    if (!raw) continue;
    const negated = raw.length > 1 && raw.startsWith('-');
    const term = negated ? raw.slice(1) : raw;
    const colon = term.indexOf(':');
    const fieldTest = colon > 0 ? FILTER_FIELDS.get(term.slice(0, colon))?.(term.slice(colon + 1), bodyText) : undefined;
    // free text matches URL, method, status and type; with searchBodies also the decoded body text
    const textTest: Matcher = options.searchBodies
      ? (c) => c.hay.includes(term) || bodyText(c.id).toLowerCase().includes(term)
      : (c) => c.hay.includes(term);
    const test = fieldTest ?? textTest;
    tests.push(negated ? (c) => !test(c) : test);
  }
  return (c) => tests.every((t) => t(c));
}
