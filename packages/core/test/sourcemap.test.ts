import { describe, expect, it } from 'vitest';
import { decodeMappings, findSourceMapRef, originalPosition, parseSourceMap } from '../src/index.ts';

// Test-side VLQ encoder, written from the Source Map v3 spec, to build fixtures with known positions.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const vlq = (n: number) => {
  let v = n < 0 ? (-n << 1) | 1 : n << 1;
  let out = '';
  do {
    let digit = v & 31;
    v >>>= 5;
    if (v) digit |= 32;
    out += B64[digit];
  } while (v);
  return out;
};
/** Absolute segments per generated line → mappings string (fields made relative as the spec requires). */
function encode(lines: number[][][]): string {
  const prev = [0, 0, 0, 0, 0];
  return lines
    .map((segs) => {
      prev[0] = 0;
      return segs
        .map((seg) =>
          seg
            .map((v, i) => {
              const d = v - prev[i]!;
              prev[i] = v;
              return vlq(d);
            })
            .join(''),
        )
        .join(',');
    })
    .join(';');
}

const mapJson = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 3,
    file: 'app.min.js',
    sources: ['src/a.ts', 'src/b.ts'],
    sourcesContent: ['const a: number = 1;\nexport { a };', null],
    names: ['a', 'b'],
    // line 0: col 0 → a.ts 0:0 "a"; col 6 → a.ts 0:6; col 20 → b.ts 3:4 "b". line 1: col 2 → a.ts 1:9
    mappings: encode([
      [
        [0, 0, 0, 0, 0],
        [6, 0, 0, 6],
        [20, 1, 3, 4, 1],
      ],
      [[2, 0, 1, 9]],
    ]),
    ...extra,
  });

describe('source map references', () => {
  const js = 'var a=1;\n//# sourceMappingURL=app.min.js.map';

  it('finds comment, CSS-style and header references, resolving relative URLs', () => {
    expect(findSourceMapRef(js, [], 'https://cdn.test/js/app.min.js')).toEqual({
      kind: 'external',
      url: 'https://cdn.test/js/app.min.js.map',
    });
    expect(findSourceMapRef('a{}\n/*# sourceMappingURL=../maps/s.css.map */', [], 'https://h/css/s.css')).toEqual({
      kind: 'external',
      url: 'https://h/maps/s.css.map',
    });
    expect(findSourceMapRef('x', [{ name: 'SourceMap', value: '/m.map' }], 'https://h/a/x.js')).toEqual({
      kind: 'external',
      url: 'https://h/m.map',
    });
    expect(findSourceMapRef('x', [{ name: 'X-SourceMap', value: 'x.map' }], 'https://h/a/x.js')).toEqual({
      kind: 'external',
      url: 'https://h/a/x.map',
    });
    expect(findSourceMapRef('var a=1;', [], 'https://h/x.js')).toEqual({ kind: 'none' });
  });

  it('decodes inline base64 and URL-encoded data URLs', () => {
    const b64 = `x\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(mapJson()).toString('base64')}`;
    const ref = findSourceMapRef(b64, [], 'https://h/x.js');
    expect(ref.kind).toBe('inline');
    expect(ref.kind === 'inline' && JSON.parse(ref.json).version).toBe(3);
    const enc = `x\n//# sourceMappingURL=data:application/json,${encodeURIComponent('{"version":3}')}`;
    expect(findSourceMapRef(enc, [], 'https://h/x.js')).toEqual({ kind: 'inline', json: '{"version":3}' });
    expect(findSourceMapRef('x\n//# sourceMappingURL=data:application/json;base64,@@@', [], 'https://h/x.js')).toMatchObject({
      kind: 'invalid',
    });
  });
});

describe('source map parsing and lookup', () => {
  it('decodes mappings and finds original positions', () => {
    const r = parseSourceMap(mapJson(), 'https://cdn.test/js/app.min.js.map');
    if (!r.ok) throw new Error(r.error);
    expect(r.map.sources).toEqual(['https://cdn.test/js/src/a.ts', 'https://cdn.test/js/src/b.ts']);
    expect(r.map.sourcesContent).toEqual(['const a: number = 1;\nexport { a };', null]);
    expect(originalPosition(r.map, 0, 0)).toEqual({ source: 0, line: 0, column: 0, name: 'a' });
    expect(originalPosition(r.map, 0, 10)).toEqual({ source: 0, line: 0, column: 6, name: undefined });
    expect(originalPosition(r.map, 0, 25)).toEqual({ source: 1, line: 3, column: 4, name: 'b' });
    expect(originalPosition(r.map, 1, 0)).toBeNull(); // before the first segment on that line
    expect(originalPosition(r.map, 1, 9)).toEqual({ source: 0, line: 1, column: 9, name: undefined });
    expect(originalPosition(r.map, 7, 0)).toBeNull();
  });

  it('applies sourceRoot and tolerates a missing sourcesContent', () => {
    const r = parseSourceMap(mapJson({ sourceRoot: '/root/', sourcesContent: undefined }), 'https://h/a/app.js.map');
    expect(r.ok && r.map.sources).toEqual(['https://h/root/src/a.ts', 'https://h/root/src/b.ts']);
    expect(r.ok && r.map.sourcesContent).toEqual([null, null]);
    const inline = parseSourceMap(mapJson({ sources: ['webpack://app/./a.ts', 'b.ts'] }), null);
    expect(inline.ok && inline.map.sources).toEqual(['webpack://app/./a.ts', 'b.ts']);
  });

  it('rejects invalid maps with a reason', () => {
    expect(parseSourceMap('{nope', null)).toMatchObject({ ok: false });
    expect(parseSourceMap('{"version":2,"sources":[],"mappings":""}', null)).toMatchObject({
      ok: false,
      error: expect.stringContaining('version'),
    });
    expect(parseSourceMap('{"version":3,"sections":[]}', null)).toMatchObject({ ok: false, error: expect.stringContaining('Indexed') });
    expect(parseSourceMap('{"version":3,"sources":["a"],"mappings":"!!"}', null)).toMatchObject({ ok: false });
  });

  it('decodes negative and multi-digit VLQ values', () => {
    const lines = decodeMappings(encode([[[100, 0, 1000, 5]], [[3, 0, 2, 0]]]));
    expect(lines).toEqual([[[100, 0, 1000, 5]], [[3, 0, 2, 0]]]);
  });
});
