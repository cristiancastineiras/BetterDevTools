import { describe, expect, it } from 'vitest';
import { decodeToon, encodeToon, encodeToonItem, TOON_HEADER, validateToon, type Json } from '../src/index.ts';
import { sampleEntries } from './fixtures.ts';

const roundTrip = (v: unknown) => decodeToon(encodeToon(v));

describe('TOON v1 encoding', () => {
  it('matches the documented example (docs/toon.md)', () => {
    const doc = {
      format: 'demo',
      count: 2,
      tags: ['a', 'b c', ''],
      users: [
        { id: 1, name: 'Ada', admin: true },
        { id: 2, name: 'Bob, Jr.', admin: false },
      ],
      items: [{ id: 'x', meta: { nested: null } }, 'plain', [1, 2]],
      empty: {},
      none: [],
    };
    expect(encodeToon(doc)).toBe(
      [
        TOON_HEADER,
        'format: demo',
        'count: 2',
        'tags[3]: a,b c,""',
        'users[2]{id,name,admin}:',
        '  1,Ada,true',
        '  2,"Bob, Jr.",false',
        'items[3]:',
        '  - id: x',
        '    meta:',
        '      nested: null',
        '  - plain',
        '  - [2]: 1,2',
        'empty:',
        'none[0]:',
        '',
      ].join('\n'),
    );
    expect(roundTrip(doc)).toEqual(doc);
  });

  it('round-trips primitives and strings that look like syntax', () => {
    const tricky = [
      'true',
      'null',
      '42',
      '-1',
      '1e3',
      ' padded ',
      'a: b',
      'ends:',
      '- dash',
      '[x]',
      '{y}',
      '#hash',
      'quote"',
      'back\\slash',
      'line\nbreak',
      'tab\t',
      'ünïcødé ✓',
      '\u2028',
      'https://x.test/a?b=1:2',
    ];
    for (const s of tricky) expect(roundTrip(s)).toBe(s);
    expect(roundTrip(tricky)).toEqual(tricky);
    expect(roundTrip({ v: tricky })).toEqual({ v: tricky });
    for (const v of [null, true, false, 0, -0.5, 1e21, 123456789.125, 'x']) expect(roundTrip(v)).toEqual(v);
  });

  it('round-trips awkward keys and nesting', () => {
    const doc = { 'a b': 1, '': 2, 'x:y': { '[k]': [{ '-': 1 }, {}] }, nested: [[[]], [{}], [[1, 'a']]], __proto__x: 3 };
    expect(roundTrip(doc)).toEqual(doc);
    expect(roundTrip([])).toEqual([]);
    expect(roundTrip([{ a: 1 }, { a: 2, b: 3 }])).toEqual([{ a: 1 }, { a: 2, b: 3 }]);
    expect(roundTrip({})).toEqual({});
  });

  it('round-trips HAR fixtures losslessly', () => {
    const entries = sampleEntries();
    expect(roundTrip({ entries })).toEqual(JSON.parse(JSON.stringify({ entries })));
  });

  it('round-trips random JSON values (seeded)', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const chars = 'ab ,:"\\-[]{}#\n1.e';
    const str = () => Array.from({ length: Math.floor(rnd() * 6) }, () => chars[Math.floor(rnd() * chars.length)]).join('');
    const gen = (d: number): Json => {
      const r = rnd();
      if (d > 3 || r < 0.4) return [null, true, false, Math.round(rnd() * 1000) / 10, str()][Math.floor(rnd() * 5)] ?? null;
      if (r < 0.7) return Array.from({ length: Math.floor(rnd() * 4) }, () => gen(d + 1));
      return Object.fromEntries(Array.from({ length: Math.floor(rnd() * 4) }, () => [str(), gen(d + 1)]));
    };
    for (let i = 0; i < 500; i++) {
      const v = gen(0);
      expect(roundTrip(v)).toEqual(v);
    }
  });

  it('defines non-JSON inputs explicitly', () => {
    expect(roundTrip({ at: new Date('2026-01-02T03:04:05.000Z'), skip: undefined, list: [undefined] })).toEqual({
      at: '2026-01-02T03:04:05.000Z',
      list: [null],
    });
    expect(() => encodeToon({ n: Number.NaN })).toThrow(/finite/);
    expect(() => encodeToon({ b: new Uint8Array(2) })).toThrow(/base64/);
    expect(() => encodeToon({ big: 1n })).toThrow(/unsupported/);
    expect(roundTrip(-0)).toBe(0);
  });

  it('streams list items that decode like a whole document', () => {
    const items = sampleEntries().slice(0, 3);
    const streamed = `${TOON_HEADER}\nentries[${items.length}]:\n${items.map((x) => encodeToonItem(x, 1)).join('')}`;
    expect(decodeToon(streamed)).toEqual(roundTrip({ entries: items }));
  });
});

describe('TOON v1 validation', () => {
  it('rejects missing or unknown versions', () => {
    expect(validateToon('a: 1\n')).toMatchObject({ ok: false });
    expect(validateToon('# bdt-toon/2\na: 1\n')).toMatchObject({ ok: false });
  });

  it.each([
    ['count mismatch', 'a[2]: 1\n'],
    ['row width', 'a[1]{x,y}:\n  1\n'],
    ['missing rows', 'a[2]{x}:\n  1\n'],
    ['odd indent', 'a:\n   b: 1\n'],
    ['unexpected indent', 'a: 1\n  b: 2\n'],
    ['duplicate key', 'a: 1\na: 2\n'],
    ['bad string', 'a: "unterminated\n'],
    ['bare string with comma', 'a: x,y\n'],
    ['blank line', 'a: 1\n\nb: 2\n'],
  ])('reports %s with a line number', (_name, body) => {
    const r = validateToon(`${TOON_HEADER}\n${body}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^TOON line \d+:/);
  });

  it('keeps __proto__ as data, never as a prototype', () => {
    const v = decodeToon(`${TOON_HEADER}\n"__proto__":\n  polluted: true\n`);
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(v ?? {})).toEqual(['__proto__']);
  });
});
