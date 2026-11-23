import { toYaml } from '../discovery/export.ts';
import { prettyJson, prettyMarkup } from '../format.ts';

export type JsonOutcome = { ok: true; output: string } | { ok: false; error: string; line: number; column: number };

/** Offset of the first character that makes `text` invalid JSON, or -1 when it is valid. Engines no longer always say where. */
function firstJsonError(text: string): number {
  let i = 0;
  const fail = (at = i): never => {
    throw at;
  };
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text.charAt(i))) i++;
  };
  const literal = (word: string) => {
    if (!text.startsWith(word, i)) fail();
    i += word.length;
  };
  const string = () => {
    i++;
    for (;;) {
      if (i >= text.length) fail();
      const c = text.charAt(i);
      if (c === '"') return void i++;
      if (c < ' ') fail();
      if (c === '\\') {
        const e = text.charAt(i + 1);
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail(i + 1);
          i += 6;
        } else if ('"\\/bfnrt'.includes(e) && e) i += 2;
        else fail(i + 1);
      } else i++;
    }
  };
  const value = (): void => {
    ws();
    const c = text.charAt(i);
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      i++;
      ws();
      if (text.charAt(i) === close) return void i++;
      for (;;) {
        ws();
        if (c === '{') {
          if (text.charAt(i) !== '"') fail();
          string();
          ws();
          if (text.charAt(i) !== ':') fail();
          i++;
        }
        value();
        ws();
        if (text.charAt(i) === ',') i++;
        else if (text.charAt(i) === close) return void i++;
        else fail();
      }
    } else if (c === '"') string();
    else if (c === 't') literal('true');
    else if (c === 'f') literal('false');
    else if (c === 'n') literal('null');
    else {
      const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
      if (!number) fail();
      i += number![0].length;
    }
  };
  try {
    value();
    ws();
    return i < text.length ? i : -1;
  } catch (at) {
    return typeof at === 'number' ? at : 0;
  }
}

/** Where a JSON.parse failure happened: from the engine's message when it says, else by scanning the text. */
export function jsonError(text: string, error: unknown): { error: string; line: number; column: number } {
  const message = error instanceof Error ? error.message : String(error);
  const lineColumn = /line (\d+) column (\d+)/i.exec(message);
  if (lineColumn) return { error: message, line: Number(lineColumn[1]), column: Number(lineColumn[2]) };
  const position = /position (\d+)/i.exec(message);
  const at = position ? Number(position[1]) : Math.max(0, firstJsonError(text));
  const before = text.slice(0, at);
  return { error: message, line: before.split('\n').length, column: before.length - before.lastIndexOf('\n') };
}

function parse(text: string): { ok: true; value: unknown } | (JsonOutcome & { ok: false }) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, ...jsonError(text, error) };
  }
}

/** Indented JSON; digits are copied as written, so 12345678901234567890 and 1.50 survive. */
export function formatJson(text: string, indent: 2 | 4 | 'tab' = 2): JsonOutcome {
  const parsed = parse(text);
  if (!parsed.ok) return parsed;
  const two = prettyJson(text, parsed) ?? '';
  return {
    ok: true,
    output:
      indent === 2
        ? two
        : two.replace(/^( +)/gm, (spaces) =>
            (indent === 'tab' ? '\t' : ' ').repeat(indent === 'tab' ? spaces.length / 2 : spaces.length * 2),
          ),
  };
}

/** Removes every space and line break that is not inside a string. */
export function minifyJson(text: string): JsonOutcome {
  const parsed = parse(text);
  if (!parsed.ok) return parsed;
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (inString) {
      out += c;
      if (c === '\\') out += text.charAt(++i);
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (!/\s/.test(c)) out += c;
  }
  return { ok: true, output: out };
}

const sortKeys = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sortKeys)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .toSorted(([a], [b]) => a.localeCompare(b, 'en'))
            .map(([k, v]) => [k, sortKeys(v)]),
        )
      : value;

/** shortcut: sorting goes through JSON.parse, so numbers beyond 2^53 lose digits; the other tools keep them. */
export function sortJson(text: string): JsonOutcome {
  const parsed = parse(text);
  return parsed.ok ? { ok: true, output: JSON.stringify(sortKeys(parsed.value), null, 2) } : parsed;
}

export function jsonToYaml(text: string): JsonOutcome {
  const parsed = parse(text);
  return parsed.ok ? { ok: true, output: toYaml(parsed.value).trimEnd() } : parsed;
}

/** A text as a JSON string literal, and back. */
export const jsonEscape = (text: string): string => JSON.stringify(text);
export function jsonUnescape(text: string): JsonOutcome {
  const parsed = parse(/^\s*"/.test(text) ? text : `"${text}"`);
  if (!parsed.ok) return parsed;
  return typeof parsed.value === 'string' ? { ok: true, output: parsed.value } : { ok: false, error: 'Not a string', line: 1, column: 1 };
}

export type MarkupOutcome = { ok: true; output: string } | { ok: false; error: string };

/** XML and HTML, one tag per line (display formatting, like the response viewer). */
export const formatMarkup = (text: string): MarkupOutcome =>
  text.trim() ? { ok: true, output: prettyMarkup(text) } : { ok: false, error: 'Empty input' };

/** XML and HTML with the whitespace between tags removed. shortcut: text inside <pre> and <textarea> is collapsed too. */
export const minifyMarkup = (text: string): string =>
  text
    .replace(/>\s+</g, '><')
    .replace(/\s*\n\s*/g, ' ')
    .trim();

/** CSS without comments or the spaces around punctuation. shortcut: not a full minifier (no shorthand merging). */
export const minifyCss = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>~+])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
