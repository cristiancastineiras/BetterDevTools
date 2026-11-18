import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// WCAG 2.2 contrast of the design tokens in src/app.css, for both schemes.
const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
const tokens = new Map(
  [...css.matchAll(/--color-([\w-]+): light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\)/g)].map((m) => [m[1]!, [m[2]!, m[3]!] as const]),
);

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].toSorted((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

// [foreground, background, minimum ratio]
const PAIRS: [string, string, number][] = [
  ['fg', 'bg', 4.5],
  ['fg', 'bg-2', 4.5],
  ['fg', 'bg-3', 4.5],
  ['fg', 'sel', 4.5],
  ['fg-2', 'bg', 4.5],
  ['fg-2', 'bg-2', 4.5],
  ['accent', 'bg', 4.5],
  ['accent', 'bg-2', 4.5],
  ['on-accent', 'accent', 4.5],
  ['ok', 'bg', 4.5],
  ['warn', 'bg', 4.5],
  ['bad', 'bg', 4.5],
  ['bad', 'bg-2', 4.5],
  ['accent', 'sel', 3], // focus ring on a selected row (non-text, 3:1)
  ['line', 'bg', 1.5], // decorative separators only
  ['fg', 'mark', 4.5], // search matches
  ['fg', 'mark-current', 4.5],
  // method and status badges: text on their own background
  ...['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace', 'connect', 'other'].map((m): [string, string, number] => [
    `m-${m}`,
    `m-${m}-bg`,
    4.5,
  ]),
  ...['1xx', '2xx', '3xx', '4xx', '5xx', 'error', 'cancelled', 'unknown'].map((s): [string, string, number] => [
    `s-${s}`,
    `s-${s}-bg`,
    4.5,
  ]),
  // syntax colours on both code backgrounds
  ...['kw', 'str', 'num', 'com', 'prop', 'tag', 'attr'].flatMap((k): [string, string, number][] => [
    [`syn-${k}`, 'bg', 4.5],
    [`syn-${k}`, 'bg-2', 4.5],
  ]),
];

describe('design tokens', () => {
  it('are all defined as light-dark() pairs', () => {
    for (const [fg, bg] of PAIRS) {
      expect(tokens.has(fg), fg).toBe(true);
      expect(tokens.has(bg), bg).toBe(true);
    }
  });

  for (const [scheme, i] of [
    ['light', 0],
    ['dark', 1],
  ] as const) {
    it.each(PAIRS)(`${scheme}: %s on %s ≥ %s:1`, (fg, bg, min) => {
      const ratio = contrast(tokens.get(fg)![i], tokens.get(bg)![i]);
      expect(ratio).toBeGreaterThanOrEqual(min);
    });
  }
});
