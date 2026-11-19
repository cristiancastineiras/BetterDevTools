import { describe, expect, it } from 'vitest';
import {
  ExactNumber,
  expandAllIds,
  parseForTree,
  pathText,
  revealIds,
  rowPath,
  searchTree,
  valueJson,
  visibleRows,
  type JsonValue,
  type NodeRow,
} from '../src/lib/json-tree.ts';

const parse = (text: string): JsonValue => {
  const result = parseForTree(text);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
const labels = (rows: ReturnType<typeof visibleRows>) =>
  rows.map((row) => (row.kind === 'group' ? `[${row.from}-${row.to}]` : String(row.key ?? '$')));

describe('JSON tree', () => {
  it('keeps numbers a double would change, and reuses a parse that is already exact', () => {
    const value = parse('{"id":12345678901234567890,"n":1.50,"ok":1}') as Record<string, JsonValue>;
    expect(value.id).toEqual(new ExactNumber('12345678901234567890'));
    expect(value.n).toEqual(new ExactNumber('1.50'));
    expect(value.ok).toBe(1);
    const plain = { value: { a: 1 } };
    expect(parseForTree('{"a":1}', plain)).toEqual({ ok: true, value: plain.value });
    expect(valueJson(value, 0)).toBe('{"id":12345678901234567890,"n":1.50,"ok":1}');
  });

  it('shows only what is open, cutting big containers into nested groups of 100', () => {
    const root = parse(JSON.stringify({ list: Array.from({ length: 250 }, (_, i) => i), small: [1] }));
    const open = new Set(['$']);
    expect(labels(visibleRows(root, (id) => open.has(id)))).toEqual(['$', 'list', 'small']);
    open.add('$/list');
    expect(labels(visibleRows(root, (id) => open.has(id)))).toEqual(['$', 'list', '[0-99]', '[100-199]', '[200-249]', 'small']);
    open.add('$/list#200-249');
    const rows = visibleRows(root, (id) => open.has(id));
    expect(rows).toHaveLength(6 + 50);
    expect(rowPath(rows.find((row) => row.kind === 'node' && row.key === 210) as NodeRow)).toEqual(['list', 210]);

    // 25 000 entries: groups of 10 000, each of 100 groups of 100
    const big = parse(JSON.stringify(Array.from({ length: 25_000 }, () => 0)));
    expect(labels(visibleRows(big, (id) => id === '$'))).toEqual(['$', '[0-9999]', '[10000-19999]', '[20000-24999]']);
  });

  it('searches the whole document and opens the way to a match', () => {
    const root = parse(JSON.stringify({ users: Array.from({ length: 300 }, (_, i) => ({ name: `user ${i}` })), note: 'Hello' }));
    const search = searchTree(root, 'USER 25', false);
    // user 25 and user 250-259
    expect(search.total).toBe(11);
    expect(search.paths[0]).toEqual(['users', 25, 'name']);
    expect(revealIds(root, ['users', 250, 'name'])).toEqual(['$', '$/users', '$/users#200-299', '$/users/250']);
    expect(searchTree(root, 'hello', true).total).toBe(0);
    expect(searchTree(root, 'note', false).total).toBe(1); // keys count too

    // only matches: the containers on the way, opened, and nothing else
    const rows = visibleRows(root, () => false, search.filter);
    expect(labels(rows)).toEqual(['$', 'users', '25', 'name', ...Array.from({ length: 10 }, (_, i) => [`${250 + i}`, 'name']).flat()]);
  });

  it('expands everything up to a row budget', () => {
    const root = parse(JSON.stringify({ a: { b: [1, 2] }, c: [3] }));
    expect(expandAllIds(root, 1000)).toEqual({ ids: new Set(['$', '$/a', '$/a/b', '$/c']), complete: true });
    expect(expandAllIds(root, 2).complete).toBe(false);
  });

  it('writes paths as JavaScript accessors', () => {
    expect(pathText(['data', 3, 'first name', '$ok'])).toBe('$.data[3]["first name"].$ok');
  });
});
