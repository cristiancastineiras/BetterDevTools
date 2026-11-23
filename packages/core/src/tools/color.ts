export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const channel = (text: string): number => (text.endsWith('%') ? (Number.parseFloat(text) / 100) * 255 : Number.parseFloat(text));
const unit = (text: string): number => (text.endsWith('%') ? Number.parseFloat(text) / 100 : Number.parseFloat(text));

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function hue(text: string): number {
  const value = Number.parseFloat(text);
  const degrees = text.endsWith('turn')
    ? value * 360
    : text.endsWith('rad')
      ? (value * 180) / Math.PI
      : text.endsWith('grad')
        ? value * 0.9
        : value;
  return ((degrees % 360) + 360) % 360;
}

/** hex, rgb(), hsl() and hwb() in the comma and space syntaxes; null for anything else (names go through the browser). */
export function parseColor(text: string): Rgba | null {
  const t = text.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(t)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    const n = (i: number) => Number.parseInt(full.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^(rgba?|hsla?|hwb)\(\s*([^)]*)\)$/.exec(t);
  if (!fn) return null;
  const [body = '', alphaText] = (fn[2] ?? '').split('/').map((s) => s.trim());
  const args = body.split(/[\s,]+/).filter(Boolean);
  const [x, y, z, commaAlpha] = args;
  if (!x || !y || !z) return null;
  const alpha = alphaText ?? commaAlpha;
  const a = alpha === undefined ? 1 : clamp(unit(alpha), 0, 1);
  let rgb: [number, number, number];
  if (fn[1]!.startsWith('rgb')) rgb = [channel(x), channel(y), channel(z)];
  else if (fn[1]!.startsWith('hsl')) rgb = hslToRgb(hue(x), clamp(unit(y), 0, 1), clamp(unit(z), 0, 1));
  else {
    let [w, bl] = [clamp(unit(y), 0, 1), clamp(unit(z), 0, 1)];
    if (w + bl > 1) [w, bl] = [w / (w + bl), bl / (w + bl)];
    rgb = hslToRgb(hue(x), 1, 0.5).map((c) => c * (1 - w - bl) + w * 255) as [number, number, number];
  }
  if (rgb.some(Number.isNaN) || Number.isNaN(a)) return null;
  return { r: clamp(Math.round(rgb[0]), 0, 255), g: clamp(Math.round(rgb[1]), 0, 255), b: clamp(Math.round(rgb[2]), 0, 255), a };
}

const byte = (v: number) => Math.round(v).toString(16).padStart(2, '0');
const round = (v: number, digits = 2) => Number(v.toFixed(digits));

export function toHexColor(c: Rgba): string {
  return `#${byte(c.r)}${byte(c.g)}${byte(c.b)}${c.a < 1 ? byte(c.a * 255) : ''}`;
}

function rgbToHsl({ r, g, b }: Rgba): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === rr ? ((gg - bb) / d) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}

const linear = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);

function rgbToOklch(c: Rgba): [number, number, number] {
  const [r, g, b] = [linear(c.r), linear(c.g), linear(c.b)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [lightness * 100, Math.hypot(a, bb), ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360];
}

/** The same colour written in the CSS formats people ask for. */
export function colorFormats(c: Rgba): { name: string; value: string }[] {
  const alpha = c.a < 1 ? ` / ${round(c.a, 3)}` : '';
  const [h, s, l] = rgbToHsl(c);
  const white = Math.min(c.r, c.g, c.b) / 255;
  const black = 1 - Math.max(c.r, c.g, c.b) / 255;
  const [ol, oc, oh] = rgbToOklch(c);
  return [
    { name: 'HEX', value: toHexColor(c) },
    { name: 'RGB', value: `rgb(${c.r} ${c.g} ${c.b}${alpha})` },
    { name: 'HSL', value: `hsl(${round(h, 1)} ${round(s, 1)}% ${round(l, 1)}%${alpha})` },
    { name: 'HWB', value: `hwb(${round(h, 1)} ${round(white * 100, 1)}% ${round(black * 100, 1)}%${alpha})` },
    { name: 'OKLCH', value: `oklch(${round(ol, 1)}% ${round(oc, 3)} ${round(oh, 1)}${alpha})` },
  ];
}

const luminance = (c: Rgba) => 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);

/** WCAG 2.x contrast ratio of text on a background; a translucent foreground is blended over the background first. */
export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const over: Rgba = {
    r: foreground.r * foreground.a + background.r * (1 - foreground.a),
    g: foreground.g * foreground.a + background.g * (1 - foreground.a),
    b: foreground.b * foreground.a + background.b * (1 - foreground.a),
    a: 1,
  };
  const [hi, lo] = [luminance(over), luminance(background)].toSorted((a, b) => b - a);
  return (hi! + 0.05) / (lo! + 0.05);
}

export interface WcagResult {
  ratio: number;
  aaNormal: boolean;
  aaLarge: boolean;
  aaaNormal: boolean;
  aaaLarge: boolean;
  /** 3:1 for icons, borders and other UI components (WCAG 1.4.11). */
  ui: boolean;
}

export function wcag(ratio: number): WcagResult {
  return { ratio, aaNormal: ratio >= 4.5, aaLarge: ratio >= 3, aaaNormal: ratio >= 7, aaaLarge: ratio >= 4.5, ui: ratio >= 3 };
}
