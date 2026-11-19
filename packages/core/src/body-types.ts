// Helpers for the Replay editor: key/value rows, request body types and Content-Type handling.
// The draft keeps plain text (headers, query, body); these functions turn it into rows and back.

export const BODY_TYPES = ['none', 'json', 'text', 'javascript', 'html', 'xml', 'urlencoded', 'multipart', 'graphql'] as const;
export type BodyTypeId = (typeof BODY_TYPES)[number];

export interface BodyTypeInfo {
  /** Content-Type the type sets (null: leaves the header alone). */
  contentType: string | null;
  /** Syntax colouring of the editor (null: not an editor but a table or another layout). */
  lang: 'json' | 'js' | 'markup' | 'plain' | null;
}

export const BODY_TYPE_INFO: Record<BodyTypeId, BodyTypeInfo> = {
  none: { contentType: null, lang: null },
  json: { contentType: 'application/json', lang: 'json' },
  text: { contentType: 'text/plain', lang: 'plain' },
  javascript: { contentType: 'application/javascript', lang: 'js' },
  html: { contentType: 'text/html', lang: 'markup' },
  xml: { contentType: 'application/xml', lang: 'markup' },
  urlencoded: { contentType: 'application/x-www-form-urlencoded', lang: null },
  multipart: { contentType: 'multipart/form-data', lang: null },
  graphql: { contentType: 'application/json', lang: null },
};

/** Types whose body is just text in an editor; switching between them keeps the text. */
export const isTextBody = (type: BodyTypeId): boolean => BODY_TYPE_INFO[type].lang !== null;

// ------------------------------------------------------------------------------------ rows

export interface Row {
  enabled: boolean;
  key: string;
  value: string;
}

/**
 * Lines of `key<sep>value` as rows. A line starting with `#` is a disabled row, the same
 * convention the draft already uses for comments, so a disabled row is never sent.
 */
export function parseRows(text: string, separator: ':' | '='): Row[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): Row => {
      const enabled = !line.startsWith('#');
      const content = enabled ? line : line.slice(1).trim();
      const at = content.indexOf(separator, separator === ':' ? 1 : 0);
      return at < 0
        ? { enabled, key: content, value: '' }
        : { enabled, key: content.slice(0, at).trim(), value: content.slice(at + 1).trim() };
    });
}

/** The inverse of parseRows; rows with neither a key nor a value are left out. */
export function rowsText(rows: Row[], separator: ':' | '='): string {
  return rows
    .filter((row) => row.key.trim() || row.value)
    .map((row) => `${row.enabled ? '' : '# '}${row.key.trim()}${separator === ':' ? ': ' : '='}${row.value}`)
    .join('\n');
}

/** Value of the first enabled header with this name (case-insensitive), or null. */
export function getHeader(headers: string, name: string): string | null {
  const row = parseRows(headers, ':').find((r) => r.enabled && r.key.toLowerCase() === name.toLowerCase());
  return row ? row.value : null;
}

/** Sets the header (replacing an enabled one, or adding it); `null` removes it. */
export function setHeader(headers: string, name: string, value: string | null): string {
  const rows = parseRows(headers, ':');
  const index = rows.findIndex((r) => r.enabled && r.key.toLowerCase() === name.toLowerCase());
  if (value === null) {
    if (index >= 0) rows.splice(index, 1);
  } else if (index >= 0) {
    rows[index] = { enabled: true, key: rows[index]!.key, value };
  } else {
    rows.push({ enabled: true, key: name, value });
  }
  return rowsText(rows, ':');
}

// ---------------------------------------------------------------------------- body inference

const VARIABLE = /\{\{\s*[\w.-]+\s*\}\}/;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Which body type a draft is using, from its Content-Type and what the body looks like. */
export function bodyTypeOf(headers: string, body: string): BodyTypeId {
  if (!body.trim()) return 'none';
  const contentType = (getHeader(headers, 'content-type') ?? '').toLowerCase();
  const json = parseJson(body);
  if ((contentType.includes('json') || (!contentType && json !== undefined)) && isRecord(json)) {
    if (typeof json.query === 'string' && Object.keys(json).every((key) => ['query', 'variables', 'operationName'].includes(key))) return 'graphql';
  }
  if (contentType.includes('json') || (!contentType && json !== undefined)) return 'json';
  if (contentType.includes('x-www-form-urlencoded')) return 'urlencoded';
  if (contentType.includes('multipart/form-data')) return 'multipart';
  if (contentType.includes('xml')) return 'xml';
  if (contentType.includes('html')) return 'html';
  if (contentType.includes('javascript')) return 'javascript';
  if (contentType) return 'text';
  if (/^\s*</.test(body)) return 'xml';
  if (/^[\w%.+\-{}]+=[^&\n]*(&[\w%.+\-{}]+=[^&\n]*)*$/.test(body.trim())) return 'urlencoded';
  return 'text';
}

// ------------------------------------------------------------------- application/x-www-form-urlencoded

/** Encodes text for a form, leaving {{variables}} as they are so they can still be filled in. */
function encodeForm(text: string): string {
  return text.replace(/(\{\{\s*[\w.-]+\s*\}\})|([^{]+|\{)/g, (_all, variable: string | undefined, other: string | undefined) =>
    variable ?? encodeURIComponent(other ?? '').replace(/%20/g, '+'),
  );
}

function decodeForm(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
}

export function urlencodedRows(body: string): Row[] {
  return body
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const at = pair.indexOf('=');
      return at < 0
        ? { enabled: true, key: decodeForm(pair), value: '' }
        : { enabled: true, key: decodeForm(pair.slice(0, at)), value: decodeForm(pair.slice(at + 1)) };
    });
}

export function urlencodedBody(rows: Row[]): string {
  return rows
    .filter((row) => row.enabled && row.key)
    .map((row) => `${encodeForm(row.key)}=${encodeForm(row.value)}`)
    .join('&');
}

// ---------------------------------------------------------------------------- multipart/form-data

export function multipartBoundary(contentType: string | null): string | null {
  return contentType?.match(/boundary=("?)([^";]+)\1/i)?.[2] ?? null;
}

export function newBoundary(): string {
  return `----BetterDevToolsBoundary${[...crypto.getRandomValues(new Uint8Array(8))].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Text fields of a multipart body (files are not supported: the editor holds text only). */
export function multipartRows(body: string, boundary: string): Row[] {
  return body
    .split(`--${boundary}`)
    .slice(1)
    .flatMap((part): Row[] => {
      if (part.startsWith('--')) return [];
      const [head = '', ...rest] = part.replace(/^\r?\n/, '').split(/\r?\n\r?\n/);
      const name = head.match(/name="([^"]*)"/i)?.[1];
      return name === undefined ? [] : [{ enabled: true, key: name, value: rest.join('\n\n').replace(/\r?\n$/, '') }];
    });
}

export function multipartBody(rows: Row[], boundary: string): string {
  const parts = rows
    .filter((row) => row.enabled && row.key)
    .map((row) => `--${boundary}\r\nContent-Disposition: form-data; name="${row.key.replaceAll('"', '%22')}"\r\n\r\n${row.value}\r\n`);
  return parts.length ? `${parts.join('')}--${boundary}--\r\n` : '';
}

// ------------------------------------------------------------------------------------- GraphQL

export function graphqlParts(body: string): { query: string; variables: string } {
  const json = parseJson(body);
  if (!isRecord(json)) return { query: '', variables: '' };
  const variables = json.variables;
  return {
    query: typeof json.query === 'string' ? json.query : '',
    variables: variables === undefined || variables === null ? '' : JSON.stringify(variables, null, 2),
  };
}

/** The JSON body of a GraphQL request; `invalidVariables` when the variables are not JSON (they are left out). */
export function graphqlBody(query: string, variables: string): { body: string; invalidVariables: boolean } {
  const trimmed = variables.trim();
  // a {{variable}} placeholder is not JSON on its own; it is allowed through as text
  const parsed = trimmed ? parseJson(trimmed) : undefined;
  const invalid = trimmed !== '' && parsed === undefined && !VARIABLE.test(trimmed);
  if (!query.trim() && !trimmed) return { body: '', invalidVariables: false };
  return { body: JSON.stringify({ query, ...(parsed === undefined ? {} : { variables: parsed }) }), invalidVariables: invalid };
}
