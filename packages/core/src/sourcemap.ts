// Source Map v3 support (https://tc39.es/ecma426/): reference discovery, parsing, VLQ mappings and
// original-position lookup. Best effort: maps can be partial or stale, and nothing here fetches.
import type { Header } from './har.ts';

export type SourceMapRef =
  | { kind: 'none' }
  | { kind: 'inline'; json: string }
  | { kind: 'external'; url: string }
  | { kind: 'invalid'; error: string };

/** Absolute segment: [generatedColumn, sourceIndex?, originalLine?, originalColumn?, nameIndex?]. */
export type Segment = number[];

export interface SourceMap {
  file?: string | undefined;
  /** Source URLs, resolved against the map URL (and sourceRoot) when the map came from a URL. */
  sources: string[];
  sourcesContent: (string | null)[];
  names: string[];
  lines: Segment[][];
}

const COMMENT = /(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL=([^\s'"*]+)\s*(?:\*\/)?\s*$/;

/** Finds the map a script or stylesheet declares (header first, then its last comment). */
export function findSourceMapRef(code: string, headers: Header[], baseUrl: string): SourceMapRef {
  const header = headers.find((h) => /^(x-)?sourcemap$/i.test(h.name))?.value.trim();
  const tail = code.slice(-4096).trimEnd();
  const ref = header ?? COMMENT.exec(tail.slice(tail.lastIndexOf('\n') + 1))?.[1];
  if (!ref) return { kind: 'none' };
  if (ref.startsWith('data:')) {
    const comma = ref.indexOf(',');
    const meta = ref.slice(5, comma);
    const data = ref.slice(comma + 1);
    try {
      const json = meta.endsWith(';base64')
        ? new TextDecoder().decode(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)))
        : decodeURIComponent(data);
      return { kind: 'inline', json };
    } catch {
      return { kind: 'invalid', error: 'The inline source map data URL cannot be decoded' };
    }
  }
  const url = URL.parse(ref, baseUrl);
  return url ? { kind: 'external', url: url.href } : { kind: 'invalid', error: `Cannot resolve source map URL "${ref}"` };
}

const B64 = new Map([...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map((c, i) => [c, i]));

/** Decodes the VLQ `mappings` string into absolute segments per generated line. Throws on bad input. */
export function decodeMappings(mappings: string): Segment[][] {
  const lines: Segment[][] = [];
  const state = [0, 0, 0, 0, 0];
  for (const line of mappings.split(';')) {
    state[0] = 0;
    const segs: Segment[] = [];
    for (const seg of line.split(',')) {
      if (!seg) continue;
      const fields: number[] = [];
      let value = 0;
      let shift = 0;
      for (const ch of seg) {
        const digit = B64.get(ch);
        if (digit === undefined) throw new Error(`Invalid mapping character "${ch}"`);
        value += (digit & 31) << shift;
        if (digit & 32) shift += 5;
        else {
          fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = 0;
          shift = 0;
        }
      }
      if (shift) throw new Error('Truncated mapping segment');
      if (![1, 4, 5].includes(fields.length)) throw new Error(`A segment has ${fields.length} fields`);
      segs.push(fields.map((d, i) => (state[i] = (state[i] ?? 0) + d)));
    }
    lines.push(segs);
  }
  return lines;
}

const strings = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : '')) : []);

/** Parses a v3 map; `mapUrl` (null for inline maps) resolves relative source paths. */
export function parseSourceMap(json: string, mapUrl: string | null): { ok: true; map: SourceMap } | { ok: false; error: string } {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    return { ok: false, error: 'The source map is not valid JSON' };
  }
  if (typeof doc !== 'object' || doc === null) return { ok: false, error: 'The source map is not an object' };
  if ('sections' in doc) return { ok: false, error: 'Indexed source maps (sections) are not supported' };
  if (!('version' in doc) || doc.version !== 3) return { ok: false, error: 'Only source map version 3 is supported' };
  const raw = Object.fromEntries(Object.entries(doc));
  if (typeof raw.mappings !== 'string' || !Array.isArray(raw.sources))
    return { ok: false, error: 'The source map has no sources or mappings' };
  let lines: Segment[][];
  try {
    lines = decodeMappings(raw.mappings);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Invalid mappings' };
  }
  const root = typeof raw.sourceRoot === 'string' && raw.sourceRoot ? raw.sourceRoot.replace(/\/?$/, '/') : '';
  const sources = strings(raw.sources).map((s) => {
    const joined = root && !/^[a-z][\w+.-]*:/i.test(s) ? root + s.replace(/^\//, '') : s;
    return mapUrl ? (URL.parse(joined, mapUrl)?.href ?? joined) : joined;
  });
  const content = Array.isArray(raw.sourcesContent) ? raw.sourcesContent : [];
  return {
    ok: true,
    map: {
      file: typeof raw.file === 'string' ? raw.file : undefined,
      sources,
      sourcesContent: sources.map((_, i) => (typeof content[i] === 'string' ? content[i] : null)),
      names: strings(raw.names),
      lines,
    },
  };
}

/** Original position for a 0-based generated line/column, or null when nothing maps there. */
export function originalPosition(
  map: SourceMap,
  line: number,
  column: number,
): { source: number; line: number; column: number; name: string | undefined } | null {
  const segs = map.lines[line];
  if (!segs?.length) return null;
  let lo = 0;
  let hi = segs.length - 1;
  let hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid]![0]! <= column) {
      hit = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const seg = segs[hit];
  if (!seg || seg.length < 4) return null;
  const [, source = 0, oline = 0, ocol = 0, name] = seg;
  return { source, line: oline, column: ocol, name: name === undefined ? undefined : map.names[name] };
}
