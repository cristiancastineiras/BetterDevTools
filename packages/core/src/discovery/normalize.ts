// URL normalisation for API discovery: /api/users/123 and /api/users/456 are one endpoint,
// GET /api/users/{userId}. A segment becomes a parameter only on evidence (its shape, or many
// distinct values with the same response shape), never just because two paths look alike.

export type ParamKind = 'integer' | 'uuid' | 'objectId' | 'ulid' | 'hash' | 'date' | 'token' | 'email' | 'slug';

const PATTERNS: [ParamKind, RegExp][] = [
  ['uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i],
  ['objectId', /^[0-9a-f]{24}$/i],
  ['hash', /^[0-9a-f]{16,}$/i],
  ['ulid', /^[0-9A-HJKMNP-TV-Z]{26}$/],
  ['date', /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?$/],
  ['integer', /^\d+$/],
  ['email', /^[^/@\s]+@[^/@\s]+\.[^/@\s]+$/],
];

/** What a path segment is, when its shape alone says it is a value and not a name. */
export function segmentKind(segment: string): ParamKind | null {
  let text = segment;
  try {
    text = decodeURIComponent(segment);
  } catch {
    // a lone % stays as it is
  }
  for (const [kind, pattern] of PATTERNS) if (pattern.test(text)) return kind;
  // long mixed letters and digits: a generated id (nanoid, base64url), not a word
  if (/^[A-Za-z0-9_-]{20,}$/.test(text) && /\d/.test(text) && /[A-Za-z]/.test(text)) return 'token';
  return null;
}

/** "users" → "user", "categories" → "category", "status" stays. */
export function singular(word: string): string {
  const w = word.replace(/\.[a-z0-9]+$/i, '');
  if (/(ss|us|is)$/i.test(w)) return w;
  if (/ies$/i.test(w)) return `${w.slice(0, -3)}y`;
  if (/(sses|xes|ches|shes)$/i.test(w)) return w.slice(0, -2);
  if (/s$/i.test(w) && w.length > 2) return w.slice(0, -1);
  return w;
}

const camel = (text: string) =>
  text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part, index) => (index ? part[0]!.toUpperCase() + part.slice(1) : part[0]!.toLowerCase() + part.slice(1)))
    .join('');

/** Parameter name from the segment before it: users/123 → userId; a non-id kind → user. */
export function paramName(previous: string | undefined, kind: ParamKind): string {
  const base = previous && !previous.startsWith('{') ? camel(singular(previous)) : '';
  if (!base) return kind === 'integer' || kind === 'uuid' || kind === 'objectId' || kind === 'ulid' || kind === 'hash' || kind === 'token' ? 'id' : kind;
  return kind === 'slug' || kind === 'date' || kind === 'email' ? (kind === 'slug' ? base : `${base}${kind[0]!.toUpperCase()}${kind.slice(1)}`) : `${base}Id`;
}

export interface PathParam {
  name: string;
  kind: ParamKind;
  example: string;
}

export interface NormalizedPath {
  /** Template with literal segments the cardinality pass may still turn into parameters. */
  template: string;
  params: PathParam[];
  /** Segments, `null` where a parameter stands. */
  literals: (string | null)[];
}

/** First pass, per request: segments whose shape marks them as values become `{name}`. */
export function normalizePath(pathname: string): NormalizedPath {
  const segments = pathname.split('/').filter((segment, index) => index === 0 || segment !== '');
  const parts = segments.length && segments[0] === '' ? segments.slice(1) : segments;
  const params: PathParam[] = [];
  const literals: (string | null)[] = [];
  const used = new Map<string, number>();
  const out: string[] = [];
  parts.forEach((segment, index) => {
    const kind = segmentKind(segment);
    if (!kind) {
      literals.push(segment);
      out.push(segment);
      return;
    }
    let name = paramName(parts[index - 1], kind);
    const times = (used.get(name) ?? 0) + 1;
    used.set(name, times);
    if (times > 1) name = `${name}${times}`;
    params.push({ name, kind, example: segment });
    literals.push(null);
    out.push(`{${name}}`);
  });
  return { template: `/${out.join('/')}`, params, literals };
}

/** The template with every parameter written as `{}`, to compare shapes whatever the names are. */
export const shapeOf = (template: string): string => template.replace(/\{[^}]+\}/g, '{}');
