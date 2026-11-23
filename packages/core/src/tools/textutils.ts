export const NUMBER_BASES = [2, 8, 10, 16] as const;

/** One integer in the four common bases; BigInt, so it is exact at any size. Null when the text is not a number in that base. */
export function convertBase(text: string, base: 2 | 8 | 10 | 16): Record<'2' | '8' | '10' | '16', string> | null {
  const clean = text.trim().replace(/[_\s]/g, '').toLowerCase();
  const negative = clean.startsWith('-');
  const body = clean.replace(/^[-+]/, '').replace(/^0[xbo]/, '');
  const digits = { 2: /^[01]+$/, 8: /^[0-7]+$/, 10: /^\d+$/, 16: /^[0-9a-f]+$/ }[base];
  if (!digits.test(body)) return null;
  const prefix = { 2: '0b', 8: '0o', 10: '', 16: '0x' }[base];
  const value = BigInt(prefix + body) * (negative ? -1n : 1n);
  return { 2: value.toString(2), 8: value.toString(8), 10: value.toString(10), 16: value.toString(16) };
}

const words = (text: string): string[] =>
  text
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

const capital = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

/** The same words in the naming styles code uses. */
export function convertCase(text: string): { name: string; value: string }[] {
  const w = words(text);
  const lower = w.map((x) => x.toLowerCase());
  return [
    { name: 'camelCase', value: lower.map((x, i) => (i ? capital(x) : x)).join('') },
    { name: 'PascalCase', value: lower.map(capital).join('') },
    { name: 'snake_case', value: lower.join('_') },
    { name: 'kebab-case', value: lower.join('-') },
    { name: 'CONSTANT_CASE', value: lower.join('_').toUpperCase() },
    { name: 'dot.case', value: lower.join('.') },
    { name: 'path/case', value: lower.join('/') },
    { name: 'Title Case', value: lower.map(capital).join(' ') },
    { name: 'Sentence case', value: capital(lower.join(' ')) },
    { name: 'lower case', value: lower.join(' ') },
    { name: 'UPPER CASE', value: lower.join(' ').toUpperCase() },
  ];
}

export interface TextStats {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  lines: number;
  bytes: number;
}

export function textStats(text: string): TextStats {
  return {
    characters: [...text].length,
    charactersNoSpaces: [...text.replace(/\s/g, '')].length,
    words: text.trim() ? text.trim().split(/\s+/).length : 0,
    lines: text ? text.split(/\r\n|\r|\n/).length : 0,
    bytes: new TextEncoder().encode(text).length,
  };
}
