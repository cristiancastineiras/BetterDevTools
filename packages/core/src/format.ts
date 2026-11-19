import type { Body, Header } from './har.ts';

export type BodyKind = 'json' | 'xml' | 'html' | 'form' | 'image' | 'text' | 'binary';

export function bodyKind(mime: string, encoding?: string): BodyKind {
  const m = mime.toLowerCase();
  if (m.includes('json')) return 'json';
  if (m.includes('html')) return 'html';
  if (m.startsWith('image/')) return 'image';
  if (m.includes('xml')) return 'xml';
  if (m.includes('x-www-form-urlencoded')) return 'form';
  if (encoding === 'base64' && !/^text\/|javascript|css|ecmascript/.test(m)) return 'binary';
  return 'text';
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Decoded text of a body (base64 bodies are decoded as UTF-8). */
export function bodyText(body: Pick<Body, 'text' | 'encoding'>): string {
  return body.encoding === 'base64' ? new TextDecoder().decode(base64ToBytes(body.text)) : body.text;
}

// JSON's only whitespace: space, tab, line feed, carriage return
const isJsonSpace = (code: number) => code === 32 || code === 10 || code === 13 || code === 9;
// what ends a number or a literal (true, false, null)
const isJsonDelimiter = (code: number) => code === 44 || code === 93 || code === 125 || code === 58 || isJsonSpace(code);

/**
 * Re-indents JSON text exactly as written: 12345678901234567890, 1.50, "é" and key order
 * all survive. Returns null when the text is not JSON. Pass `parsed` when the caller already ran
 * JSON.parse on it, so a big body is parsed only once.
 *
 * Fast path: when serialising the parsed value gives back the very same text (what almost every
 * API sends), the browser's native JSON.stringify produces the indented copy, about 5x faster.
 * Anything it would change (big or 1.50-style numbers, \u escapes, numeric keys reordered,
 * duplicate keys) fails that comparison and goes through the exact formatter instead.
 */
export function prettyJson(text: string, parsed?: { value: unknown }): string | null {
  let value: unknown;
  if (parsed) value = parsed.value;
  else {
    try {
      value = JSON.parse(text);
    } catch {
      return null; // not JSON: caller shows the raw text
    }
  }
  const indented = JSON.stringify(value, null, 2);
  if (indented === text) return text;
  if (JSON.stringify(value) === text) return indented;
  return reindentJson(text);
}

/** The exact formatter: one pass over char codes, copying strings and numbers as slices. */
function reindentJson(text: string): string {
  const indents = ['\n'];
  const indent = (depth: number) => (indents[depth] ??= `\n${'  '.repeat(depth)}`);
  const length = text.length;
  let out = '';
  let depth = 0;
  let i = 0;
  while (i < length) {
    const code = text.charCodeAt(i);
    if (code === 34) {
      // a string: find the closing quote that is not escaped (an odd run of backslashes escapes it)
      let end = i;
      for (;;) {
        end = text.indexOf('"', end + 1);
        let slashes = 0;
        while (text.charCodeAt(end - 1 - slashes) === 92) slashes++;
        if (slashes % 2 === 0) break;
      }
      out += text.slice(i, end + 1);
      i = end + 1;
    } else if (code === 123 || code === 91) {
      let next = i + 1;
      while (isJsonSpace(text.charCodeAt(next))) next++;
      if (text.charCodeAt(next) === code + 2) {
        // {} or [] (the closing bracket is the opening code + 2)
        out += code === 123 ? '{}' : '[]';
        i = next + 1;
      } else {
        out += (code === 123 ? '{' : '[') + indent(++depth);
        i++;
      }
    } else if (code === 125 || code === 93) {
      out += indent(--depth) + (code === 125 ? '}' : ']');
      i++;
    } else if (code === 44) {
      out += `,${indent(depth)}`;
      i++;
    } else if (code === 58) {
      out += ': ';
      i++;
    } else if (isJsonSpace(code)) {
      i++;
    } else {
      let end = i + 1;
      while (end < length && !isJsonDelimiter(text.charCodeAt(end))) end++;
      out += text.slice(i, end);
      i = end;
    }
  }
  return out;
}

const VOID = /^<(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)\b/i;

/** Line-per-tag indentation for XML and HTML; display only. */
export function prettyMarkup(text: string): string {
  let depth = 0;
  return text
    .replace(/>\s*</g, '>\n<')
    .split('\n')
    .map((line) => {
      const l = line.trim();
      if (l.startsWith('</')) depth = Math.max(0, depth - 1);
      const out = '  '.repeat(depth) + l;
      const opens = /^<[^!?/][^>]*>$/.test(l) && !l.endsWith('/>') && !VOID.test(l);
      if (opens && !/^<([\w:-]+)[^>]*>.*<\/\1>$/.test(l)) depth++;
      return out;
    })
    .join('\n');
}

/** Brace indentation for single-line GraphQL documents; multi-line queries are already readable. */
export function prettyGraphql(query: string): string {
  if (query.includes('\n')) return query;
  let depth = 0;
  return query
    .replace(/\s*\{\s*/g, ' {\n')
    .replace(/\s*\}\s*/g, '\n}\n')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      const t = l.trim();
      if (t.startsWith('}')) depth = Math.max(0, depth - 1);
      const out = '  '.repeat(depth) + t;
      if (t.endsWith('{')) depth++;
      return out;
    })
    .join('\n');
}

/** GraphQL-over-HTTP request body ({query, variables, operationName}), or null. */
export function graphqlOf(text: string): { query: string; variables: string; operationName: string } | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null; // not JSON, so not a GraphQL POST body
  }
  if (typeof doc !== 'object' || doc === null || !('query' in doc) || typeof doc.query !== 'string') return null;
  const vars = 'variables' in doc ? doc.variables : undefined;
  const op = 'operationName' in doc && typeof doc.operationName === 'string' ? doc.operationName : '';
  return { query: doc.query, variables: vars === undefined ? '' : JSON.stringify(vars, null, 2), operationName: op };
}

export function formFields(text: string): Header[] {
  return [...new URLSearchParams(text)].map(([name, value]) => ({ name, value }));
}

/** Offset / hex / ASCII dump, rendered as text only. */
export function hexDump(bytes: Uint8Array, limit = 4096): string {
  const lines: string[] = [];
  const end = Math.min(bytes.length, limit);
  for (let o = 0; o < end; o += 16) {
    const row = [...bytes.subarray(o, Math.min(o + 16, end))];
    const hex = row.map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = row.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${o.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${ascii}`);
  }
  if (bytes.length > limit) lines.push(`… ${bytes.length - limit} more bytes not shown`);
  return lines.join('\n');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function headersText(headers: Header[], sorted = false): string {
  const list = sorted ? headers.toSorted((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())) : headers;
  return list.map((h) => `${h.name}: ${h.value}`).join('\n');
}

/** Text for diffing: binary stays base64, text is decoded and JSON re-indented so diffs are per field. */
export function comparableText(b: Pick<Body, 'text' | 'encoding'>, mime: string): string {
  const kind = bodyKind(mime, b.encoding);
  const text = b.encoding && (kind === 'binary' || kind === 'image') ? b.text : bodyText(b);
  return prettyJson(text) ?? text;
}
