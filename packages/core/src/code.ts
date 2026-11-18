import { graphqlOf } from './format.ts';
import type { Body } from './har.ts';

export type CodeFormat =
  | 'json'
  | 'graphql'
  | 'javascript'
  | 'typescript'
  | 'jsx'
  | 'css'
  | 'html'
  | 'xml'
  | 'form'
  | 'text'
  | 'image'
  | 'binary';

const SIGNATURES: [number[], 'image' | 'binary'][] = [
  [[0x89, 0x50, 0x4e, 0x47], 'image'], // PNG
  [[0xff, 0xd8, 0xff], 'image'], // JPEG
  [[0x47, 0x49, 0x46, 0x38], 'image'], // GIF
  [[0x52, 0x49, 0x46, 0x46], 'image'], // RIFF (WebP)
  [[0x00, 0x00, 0x01, 0x00], 'image'], // ICO
  [[0x25, 0x50, 0x44, 0x46], 'binary'], // PDF
  [[0x50, 0x4b, 0x03, 0x04], 'binary'], // ZIP
  [[0x1f, 0x8b], 'binary'], // gzip
  [[0x00, 0x61, 0x73, 0x6d], 'binary'], // WebAssembly
];
const TEXTUAL = /^text\/|json|javascript|ecmascript|typescript|xml|css|html|svg|x-www-form-urlencoded|graphql/;

function firstBytes(b64: string): number[] {
  try {
    return [...atob(b64.slice(0, 24))].map((c) => c.charCodeAt(0));
  } catch {
    return []; // not base64: no signature
  }
}

const TS_HINT =
  /^\s*(?:export\s+)?(?:declare\s+)?(?:interface|type|enum|namespace)\s+[A-Za-z_$]|\)\s*:\s*[A-Za-z_$][\w$<>[\]|]*\s*(?:=>|\{)/m;

/** Format from MIME, content signature and URL; base64 bodies with a text MIME are decoded first. */
export function detectFormat(mime: string, body: Pick<Body, 'text' | 'encoding'>, url = ''): CodeFormat {
  const m = mime.toLowerCase();
  if (body.encoding === 'base64') {
    const bytes = firstBytes(body.text);
    const sig = SIGNATURES.find(([s]) => s.every((b, i) => bytes[i] === b));
    if (sig) return sig[1];
    if (m.startsWith('image/') && !m.includes('svg')) return 'image';
    if (!TEXTUAL.test(m)) return 'binary';
    try {
      return detectFormat(mime, { text: new TextDecoder().decode(Uint8Array.from(atob(body.text), (c) => c.charCodeAt(0))) }, url);
    } catch {
      return 'binary'; // invalid base64
    }
  }
  const text = body.text;
  const path = URL.parse(url)?.pathname.toLowerCase() ?? '';
  if (m.includes('json')) return graphqlOf(text) ? 'graphql' : 'json';
  if (m.includes('svg') || m.includes('xml')) return 'xml';
  if (m.includes('html')) return 'html';
  if (m.includes('css') || path.endsWith('.css')) return 'css';
  if (m.includes('x-www-form-urlencoded')) return 'form';
  if (m.startsWith('image/')) return 'image';
  if (/\.(jsx|tsx)$/.test(path)) return 'jsx';
  if (m.includes('typescript') || /\.[mc]?ts$/.test(path)) return 'typescript';
  if (/javascript|ecmascript/.test(m) || /\.[mc]?js$/.test(path)) return TS_HINT.test(text) ? 'typescript' : 'javascript';
  const t = text.trimStart();
  if (/^[{[]/.test(t)) {
    try {
      JSON.parse(t);
      return 'json';
    } catch {
      // not JSON after all: fall through to the other sniffers
    }
  }
  if (/^<\?xml/i.test(t)) return 'xml';
  if (/^<!doctype html|^<html[\s>]/i.test(t)) return 'html';
  return 'text';
}

export type ViewMode = 'pretty' | 'tree' | 'raw' | 'preview' | 'hex';

/** Main view modes for a format, first one is the default. Hex is never here: it is an explicit extra action. */
export function viewModes(format: CodeFormat, svg: boolean): { main: ViewMode[]; default: ViewMode } {
  const main: ViewMode[] =
    format === 'image'
      ? ['preview', 'raw']
      : format === 'binary' || format === 'text'
        ? ['raw']
        : format === 'json'
          ? ['pretty', 'tree', 'raw']
          : format === 'html' || (format === 'xml' && svg)
            ? ['pretty', 'raw', 'preview']
            : ['pretty', 'raw'];
  return { main, default: main[0] ?? 'raw' };
}

// ------------------------------------------------------------------------------- tokenizer

export type TokenKind = 'kw' | 'str' | 'num' | 'com' | 'op' | 'prop' | 'tag' | 'attr' | 'punct' | 'text';
export type Token = [TokenKind, string];
export type Lang = 'js' | 'css' | 'markup' | 'json' | 'plain';

export const langOf = (f: CodeFormat): Lang =>
  f === 'json'
    ? 'json'
    : f === 'css'
      ? 'css'
      : f === 'html' || f === 'xml'
        ? 'markup'
        : ['javascript', 'typescript', 'jsx', 'graphql'].includes(f)
          ? 'js'
          : 'plain';

const KEYWORDS = new Set(
  (
    'abstract as async await break case catch class const continue debugger declare default delete do else enum export extends false finally for from ' +
    'function get if implements import in instanceof interface keyof let new null of private protected public readonly return satisfies set static super ' +
    'switch this throw true try type typeof undefined var void while with yield query mutation subscription fragment on'
  ).split(' '),
);
// After these, a "/" starts a regex literal instead of a division.
const REGEX_AFTER = /^(?:[(,=:[!&|?{};+\-*%<>~^]|return|typeof|case|do|else|in|of|void|throw|delete|new|yield|await)$/;

interface Rule {
  re: RegExp;
  kind: TokenKind | ((t: string, prev: string) => TokenKind | null);
}

const ws: Rule = { re: /\s+/y, kind: 'text' };
const JS: Rule[] = [
  ws,
  { re: /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y, kind: 'com' },
  { re: /'(?:\\[\s\S]|[^'\\\n])*'?|"(?:\\[\s\S]|[^"\\\n])*"?|`(?:\\[\s\S]|[^`\\])*`?/y, kind: 'str' },
  {
    re: /\/(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[dgimsuyv]*/y,
    kind: (_t, prev) => (REGEX_AFTER.test(prev) || prev === '' ? 'str' : null),
  },
  { re: /0[xX][\da-fA-F_]+n?|0[oObB][\d_]+n?|(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?n?/y, kind: 'num' },
  { re: /[A-Za-z_$][\w$]*/y, kind: (t, prev) => (prev === '.' || prev === '?.' ? 'prop' : KEYWORDS.has(t) ? 'kw' : 'text') },
  { re: /\?\.|[{}()[\];,.]/y, kind: 'punct' },
  // "/" alone, so "=/re/" still starts a regex literal after "="
  { re: /[+\-*%=&|^!<>?:~@#]+|\/=?/y, kind: 'op' },
];
const CSS: Rule[] = [
  ws,
  { re: /\/\*[\s\S]*?(?:\*\/|$)/y, kind: 'com' },
  { re: /'(?:\\[\s\S]|[^'\\\n])*'?|"(?:\\[\s\S]|[^"\\\n])*"?/y, kind: 'str' },
  { re: /@[\w-]+/y, kind: 'kw' },
  { re: /#[\da-fA-F]{3,8}\b|-?(?:\d+\.?\d*|\.\d+)(?:%|[a-zA-Z]+)?/y, kind: 'num' },
  { re: /--[\w-]+|[A-Za-z_-][\w-]*(?=\s*:(?!:))/y, kind: 'prop' },
  { re: /[A-Za-z_-][\w-]*/y, kind: 'text' },
  { re: /[{}();:,]/y, kind: 'punct' },
  { re: /[>+~*=|^$!.[\]&]+/y, kind: 'op' },
];
const JSON_RULES: Rule[] = [
  ws,
  { re: /"(?:\\[\s\S]|[^"\\])*"(?=\s*:)/y, kind: 'prop' },
  { re: /"(?:\\[\s\S]|[^"\\])*"?/y, kind: 'str' },
  { re: /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y, kind: 'num' },
  { re: /true|false|null/y, kind: 'kw' },
  { re: /[{}[\],:]/y, kind: 'punct' },
];
const TAG_INSIDE: Rule[] = [
  ws,
  { re: /\/?>/y, kind: 'tag' },
  { re: /"[^"]*"?|'[^']*'?/y, kind: 'str' },
  { re: /[^\s=>/"']+/y, kind: 'attr' },
  { re: /=/y, kind: 'punct' },
  { re: /\//y, kind: 'tag' },
];

function scan(text: string, rules: Rule[], at: number, prev: string): { kind: TokenKind; len: number } | null {
  for (const rule of rules) {
    rule.re.lastIndex = at;
    const m = rule.re.exec(text);
    if (!m || !m[0]) continue;
    const kind = typeof rule.kind === 'function' ? rule.kind(m[0], prev) : rule.kind;
    if (kind) return { kind, len: m[0].length };
  }
  return null;
}

function markup(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let inTag = false;
  while (i < text.length) {
    if (!inTag) {
      const com = /<!--[\s\S]*?(?:-->|$)|<![^>]*>?|<\?[\s\S]*?(?:\?>|$)/y;
      com.lastIndex = i;
      const tag = /<\/?[A-Za-z][\w:.-]*/y;
      tag.lastIndex = i;
      const c = com.exec(text);
      const t = c ? null : tag.exec(text);
      if (c) out.push(['com', c[0]]);
      else if (t) {
        out.push(['tag', t[0]]);
        inTag = true;
      } else {
        const next = text.indexOf('<', i + 1);
        out.push(['text', text.slice(i, next < 0 ? text.length : next)]);
      }
    } else {
      const hit = scan(text, TAG_INSIDE, i, '');
      const len = hit?.len ?? 1;
      const piece = text.slice(i, i + len);
      out.push([hit?.kind ?? 'text', piece]);
      if (hit?.kind === 'tag' && piece.endsWith('>')) inTag = false;
    }
    i += out.at(-1)![1].length;
  }
  return out;
}

/** Splits text into highlight tokens; joining the tokens always gives the input back. */
export function tokenize(text: string, lang: Lang): Token[] {
  if (lang === 'markup') return markup(text);
  if (lang === 'plain') return [['text', text]];
  const rules = lang === 'js' ? JS : lang === 'css' ? CSS : JSON_RULES;
  const out: Token[] = [];
  let prev = '';
  for (let i = 0; i < text.length;) {
    const hit = scan(text, rules, i, prev);
    const len = hit?.len ?? 1;
    const t = text.slice(i, i + len);
    const kind = hit?.kind ?? 'text';
    const last = out.at(-1);
    if (kind === 'text' && last?.[0] === 'text') last[1] += t;
    else out.push([kind, t]);
    if (kind !== 'com' && !/^\s+$/.test(t)) prev = t;
    i += len;
  }
  return out;
}

/** Tokens split at line breaks, for line-numbered rendering. */
export function tokenLines(tokens: Token[]): Token[][] {
  const lines: Token[][] = [[]];
  for (const [kind, t] of tokens) {
    const parts = t.split('\n');
    parts.forEach((p, i) => {
      if (i) lines.push([]);
      if (p) lines.at(-1)!.push([kind, p]);
    });
  }
  return lines;
}

// ------------------------------------------------------------------------------ formatting

/** Long lines and few line breaks: code that was minified or generated on one line. */
export function isMinified(text: string): boolean {
  const lines = text.split('\n', 50);
  const longest = Math.max(...lines.map((l) => l.length));
  return longest > 500 || text.length / Math.max(1, text.split('\n').length) > 200;
}

const CONTINUES = new Set([';', ',', ')', ']', '.', '?.', 'else', 'catch', 'finally', 'while']);

/** Line breaks and indentation for minified JS/CSS from the token stream; nothing is executed. */
export function formatCode(text: string, lang: 'js' | 'css'): string {
  const out: string[] = [];
  let depth = 0;
  let paren = 0;
  let line = '';
  let closed = false;
  const nl = () => {
    if (line.trim()) out.push('  '.repeat(depth) + line.trim());
    line = '';
  };
  for (const [kind, t] of tokenize(text, lang)) {
    if (kind === 'text' && !t.trim()) {
      line += ' ';
      continue;
    }
    if (closed) {
      // after "}" a statement ends unless the token continues it: "} else", "});", "}).then"
      closed = false;
      if (!CONTINUES.has(t)) nl();
      else if (kind === 'kw') line += ' ';
    }
    if (t === '{') {
      line = `${line.trimEnd()} {`;
      nl();
      depth++;
    } else if (t === '}') {
      nl();
      depth = Math.max(0, depth - 1);
      line = '}';
      closed = true;
    } else if (t === ';' && paren === 0) {
      line += ';';
      nl();
    } else {
      if (t === '(' || t === '[') paren++;
      else if ((t === ')' || t === ']') && paren > 0) paren--;
      line += t;
      if (kind === 'com' && t.startsWith('//')) nl();
    }
  }
  nl();
  return out.join('\n');
}

export function jsonSummary(text: string): { kind: 'object' | 'array'; count: number } | null {
  try {
    const v: unknown = JSON.parse(text);
    if (Array.isArray(v)) return { kind: 'array', count: v.length };
    return typeof v === 'object' && v !== null ? { kind: 'object', count: Object.keys(v).length } : null;
  } catch {
    return null; // not JSON: no summary
  }
}
