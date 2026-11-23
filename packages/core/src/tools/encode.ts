// Text encodings in both directions, the everyday part of CyberChef: pure functions, no network.

export const ENCODINGS = ['base64', 'base64url', 'url', 'url-form', 'html', 'hex', 'binary', 'unicode', 'rot13'] as const;
export type Encoding = (typeof ENCODINGS)[number];

const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder();

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  sect: '§',
  deg: '°',
  plusmn: '±',
  times: '×',
  divide: '÷',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  bull: '•',
  middot: '·',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
}; // shortcut: the usual named entities only; numeric ones always work

/** Base64 or base64url text (padding optional, whitespace ignored) as bytes. */
export function base64ToBytesLoose(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '').replaceAll('-', '+').replaceAll('_', '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) throw new Error('Not valid Base64');
  const binary = atob(clean.padEnd(Math.ceil(clean.length / 4) * 4, '='));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function bytesFrom(text: string, radix: 16 | 2): Uint8Array {
  const digits = radix === 16 ? text.replace(/0x|[\s,:]/gi, '') : text.replace(/[\s,]/g, '');
  const width = radix === 16 ? 2 : 8;
  if (!(radix === 16 ? /^[0-9a-f]*$/i : /^[01]*$/).test(digits) || digits.length % width)
    throw new Error(radix === 16 ? 'Not valid hex' : 'Not valid binary');
  const out = new Uint8Array(digits.length / width);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(digits.slice(i * width, (i + 1) * width), radix);
  return out;
}

const rot13 = (text: string) =>
  text.replace(/[a-z]/gi, (c) => String.fromCharCode((((c.charCodeAt(0) & 223) - 52) % 26) + (c.charCodeAt(0) & 32) + 65));

export function encodeText(kind: Encoding, text: string): string {
  switch (kind) {
    case 'base64':
      return bytesToBase64(utf8.encode(text));
    case 'base64url':
      return bytesToBase64(utf8.encode(text)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    case 'url':
      return encodeURIComponent(text);
    case 'url-form':
      return encodeURIComponent(text).replaceAll('%20', '+');
    case 'html':
      return text.replace(/[&<>"']|\P{ASCII}/gu, (c) =>
        c === '&'
          ? '&amp;'
          : c === '<'
            ? '&lt;'
            : c === '>'
              ? '&gt;'
              : c === '"'
                ? '&quot;'
                : c === "'"
                  ? '&#39;'
                  : `&#x${c.codePointAt(0)!.toString(16)};`,
      );
    case 'hex':
      return [...utf8.encode(text)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    case 'binary':
      return [...utf8.encode(text)].map((b) => b.toString(2).padStart(8, '0')).join(' ');
    case 'unicode':
      return text.replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    case 'rot13':
      return rot13(text);
  }
}

/** The text a decoder produced; invalid input throws an Error that says what was wrong. */
export function decodeText(kind: Encoding, text: string): string {
  switch (kind) {
    case 'base64':
    case 'base64url':
      return utf8Decoder.decode(base64ToBytesLoose(text));
    case 'url':
    case 'url-form':
      try {
        return decodeURIComponent(kind === 'url-form' ? text.replaceAll('+', ' ') : text);
      } catch {
        throw new Error('Not valid percent-encoding');
      }
    case 'html':
      return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (all, hex?: string, dec?: string, name?: string) => {
        if (name) return NAMED[name.toLowerCase()] ?? all;
        const code = hex ? Number.parseInt(hex, 16) : Number(dec);
        return code <= 0x10ffff ? String.fromCodePoint(code) : all;
      });
    case 'hex':
      return utf8Decoder.decode(bytesFrom(text, 16));
    case 'binary':
      return utf8Decoder.decode(bytesFrom(text, 2));
    case 'unicode':
      return text.replace(
        /\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})|\\([nrt\\'"])/gi,
        (_all, brace?: string, four?: string, two?: string, simple?: string) =>
          simple
            ? (({ n: '\n', r: '\r', t: '\t' } as Record<string, string>)[simple] ?? simple)
            : String.fromCodePoint(Number.parseInt(brace ?? four ?? two ?? '0', 16)),
      );
    case 'rot13':
      return rot13(text);
  }
}
