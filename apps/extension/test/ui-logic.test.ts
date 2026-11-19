import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COPY_FEEDBACK_MS, createCopier, type CopyState } from '../src/lib/copy.ts';
import { listboxKey, type ListOption } from '../src/lib/listbox.ts';
import {
  indexLines,
  lineOfOffset,
  lineText,
  matchesBetween,
  MAX_STORED_MATCHES,
  searchText,
  splitAtMatches,
  splitByQuery,
} from '../src/lib/search.ts';

const opts = (...labels: (string | [string, true])[]): ListOption[] =>
  labels.map((l) => (typeof l === 'string' ? { value: l, label: l } : { value: l[0], label: l[0], disabled: l[1] }));

describe('SelectMenu keyboard model', () => {
  const o = opts('Alpha', ['Beta', true], 'Bravo', 'Charlie', 'Cobalt');

  it('moves with arrows, skipping disabled options and stopping at the ends', () => {
    expect(listboxKey('ArrowDown', 0, o)?.index).toBe(2);
    expect(listboxKey('ArrowUp', 2, o)?.index).toBe(0);
    expect(listboxKey('ArrowUp', 0, o)?.index).toBe(0);
    expect(listboxKey('ArrowDown', 4, o)?.index).toBe(4);
    expect(listboxKey('ArrowDown', -1, o)?.index).toBe(0);
  });

  it('jumps with Home/End and ignores non-navigation keys', () => {
    expect(listboxKey('End', 0, o)?.index).toBe(4);
    expect(listboxKey('Home', 4, o)?.index).toBe(0);
    expect(listboxKey('Tab', 0, o)).toBeNull();
    expect(listboxKey(' ', 0, o)).toBeNull();
    expect(listboxKey('ArrowDown', 0, opts(['x', true]))).toBeNull();
  });

  it('typeahead: prefix matching and cycling with a repeated letter', () => {
    expect(listboxKey('c', 0, o)).toEqual({ index: 3, typed: 'c' });
    expect(listboxKey('c', 3, o, 'c')).toEqual({ index: 4, typed: 'cc' });
    expect(listboxKey('o', 3, o, 'c')).toEqual({ index: 4, typed: 'co' });
    expect(listboxKey('b', 0, o)?.index).toBe(2); // Beta is disabled
    expect(listboxKey('z', 3, o)?.index).toBe(3);
  });
});

describe('CopyButton state', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows copied, then idle after the feedback time', async () => {
    const states: CopyState[] = [];
    const c = createCopier(
      async () => true,
      (s) => states.push(s),
    );
    await c.copy('x');
    expect(states).toEqual(['copied']);
    vi.advanceTimersByTime(COPY_FEEDBACK_MS);
    expect(states).toEqual(['copied', 'idle']);
  });

  it('reports failures instead of success, including failing text builders', async () => {
    const states: CopyState[] = [];
    const c = createCopier(
      async () => false,
      (s) => states.push(s),
    );
    await c.copy('x');
    await c.copy(() => Promise.reject(new Error('no')));
    expect(states).toEqual(['failed', 'failed']);
  });

  it('drops results that are no longer relevant', async () => {
    const states: CopyState[] = [];
    let release: ((value: string) => void) | undefined;
    const c = createCopier(
      async () => true,
      (s) => states.push(s),
    );
    const pending = c.copy(() => new Promise<string>((r) => (release = r)));
    c.dispose();
    release?.('late');
    await pending;
    expect(states).toEqual([]);
  });
});

describe('find in body', () => {
  it('indexes lines without splitting the text', () => {
    const lines = indexLines('ab\n\ncdef');
    expect([...lines.starts]).toEqual([0, 3, 4]);
    expect(lines.longest).toBe(4);
    expect([0, 1, 2].map((line) => lineText(lines, line))).toEqual(['ab', '', 'cdef']);
    expect([0, 2, 3, 4, 7].map((offset) => lineOfOffset(lines, offset))).toEqual([0, 0, 1, 2, 2]);
  });

  it('finds every occurrence, ignoring case unless asked', () => {
    const text = 'Ada and ada\nnone\nADA';
    const search = searchText(text, 'ada', false);
    expect([...search.offsets]).toEqual([0, 8, 17]);
    expect(search.total).toBe(3);
    expect([...searchText(text, 'ada', true).offsets]).toEqual([8]);
    expect(searchText('aaaa', 'aa', true).total).toBe(2); // non-overlapping
    expect(searchText('x', '', false).total).toBe(0);
    // lower-casing "İ" adds a character: the RegExp path keeps offsets right
    expect([...searchText('İx ix', 'ix', false).offsets]).toEqual([3]);
  });

  it('counts every match but keeps at most the limit', () => {
    const search = searchText('a'.repeat(MAX_STORED_MATCHES + 50), 'a', true);
    expect(search.total).toBe(MAX_STORED_MATCHES + 50);
    expect(search.offsets).toHaveLength(MAX_STORED_MATCHES);
  });

  it('gives the matches of one line relative to its start', () => {
    const lines = indexLines('xx ab\nab ab');
    const search = searchText(lines.text, 'ab', true);
    expect(matchesBetween(search, lines.starts[1]!, lines.text.length)).toEqual([
      { start: 0, end: 2, index: 1 },
      { start: 3, end: 5, index: 2 },
    ]);
  });

  it('cuts tokens at match edges and keeps each token colour', () => {
    const ranges = matchesBetween(searchText('"name": "Ada"', 'e": "A', false), 0, 13);
    const pieces = splitAtMatches(
      [
        ['prop', '"name"'],
        ['punct', ':'],
        ['text', ' '],
        ['str', '"Ada"'],
      ],
      ranges,
    );
    expect(pieces.map((piece) => piece.text).join('')).toBe('"name": "Ada"');
    expect(pieces.filter((piece) => piece.match === 0).map((piece) => [piece.kind, piece.text])).toEqual([
      ['prop', 'e"'],
      ['punct', ':'],
      ['text', ' '],
      ['str', '"A'],
    ]);
  });

  it('splits short texts around the query', () => {
    expect(splitByQuery('Adams', 'ada', false)).toEqual([
      { text: 'Ada', hit: true },
      { text: 'ms', hit: false },
    ]);
    expect(splitByQuery('x', '', false)).toEqual([{ text: 'x', hit: false }]);
  });
});
