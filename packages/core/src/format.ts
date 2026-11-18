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

const indent = (d: number) => '\n' + '  '.repeat(d);

/**
 * Re-indents JSON text without parsing numbers into doubles, so 12345678901234567890 and
 * escapes survive exactly. Returns null when the text is not JSON.
 */
export function prettyJson(text: string): string | null {
  try {
    JSON.parse(text);
  } catch {
    return null; // not JSON: caller shows the raw text
  }
  const out: string[] = [];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out.push(text.slice(i, j + 1));
      i = j;
    } else if (ch === '{' || ch === '[') {
      const close = ch === '{' ? '}' : ']';
      let j = i + 1;
      while (/\s/.test(text[j] ?? '')) j++;
      if (text[j] === close) {
        out.push(ch + close);
        i = j;
      } else out.push(ch + indent(++depth));
    } else if (ch === '}' || ch === ']') out.push(indent(--depth) + ch);
    else if (ch === ',') out.push(',' + indent(depth));
    else if (ch === ':') out.push(': ');
    else if (!/\s/.test(ch)) out.push(ch);
  }
  return out.join('');
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
