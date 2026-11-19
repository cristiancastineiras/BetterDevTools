// The JSON tree as a flat list of visible rows, for a virtualized view: only what is open is
// walked, big arrays and objects are cut into nested groups of at most 100 (100, 10 000,
// 1 000 000…), and search covers the whole document, not just the rows on screen.
// Pure functions, unit-tested in test/json-tree.test.ts.

/** A number whose JSON text does not survive a round trip through a double (big ids, 1.50). */
export class ExactNumber {
  readonly source: string;
  constructor(source: string) {
    this.source = source;
  }
}

export type JsonValue = null | boolean | number | string | ExactNumber | JsonValue[] | { [key: string]: JsonValue };
export type JsonKey = string | number;
type Container = JsonValue[] | { [key: string]: JsonValue };

export const isContainer = (value: JsonValue): value is Container =>
  typeof value === 'object' && value !== null && !(value instanceof ExactNumber);

/**
 * Parses for the tree. `plain` is a JSON.parse result the caller already has: when writing it
 * back gives the same text, no number lost digits and it is used as it is. Otherwise the text is
 * parsed again keeping the source of every number a double would change.
 */
export function parseForTree(text: string, plain?: { value: unknown }): { ok: true; value: JsonValue } | { ok: false; error: string } {
  try {
    if (plain && (JSON.stringify(plain.value) === text || JSON.stringify(plain.value, null, 2) === text)) {
      return { ok: true, value: plain.value as JsonValue };
    }
    const value = JSON.parse(text, (_key, parsed: unknown, context?: { source?: string }) =>
      typeof parsed === 'number' && context?.source !== undefined && context.source !== String(parsed) ? new ExactNumber(context.source) : parsed,
    ) as JsonValue;
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** JSON text of a leaf value, as it appears in the response. */
export function leafText(value: JsonValue): string {
  if (value instanceof ExactNumber) return value.source;
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

// ------------------------------------------------------------------------------- structure

const keyCache = new WeakMap<object, string[]>();
function keysOf(container: Container): string[] | null {
  if (Array.isArray(container)) return null;
  let keys = keyCache.get(container);
  if (!keys) keyCache.set(container, (keys = Object.keys(container)));
  return keys;
}

export const entryCount = (container: Container): number => (Array.isArray(container) ? container.length : keysOf(container)!.length);

function entryAt(container: Container, position: number): [JsonKey, JsonValue] {
  if (Array.isArray(container)) return [position, container[position]!];
  const key = keysOf(container)![position]!;
  return [key, container[key]!];
}

export const ROOT_ID = '$';
const escapeKey = (key: JsonKey) => String(key).replaceAll('~', '~0').replaceAll('/', '~1');
export const childId = (parentId: string, key: JsonKey): string => `${parentId}/${escapeKey(key)}`;
const bucketId = (containerId: string, from: number, to: number) => `${containerId}#${from}-${to}`;

export const GROUP_SIZE = 100;

/** Size of the groups a range of `length` entries is cut into: 100, 10 000, … so at most 100 groups. */
function groupSize(length: number): number {
  let size = GROUP_SIZE;
  while (length > size * GROUP_SIZE) size *= GROUP_SIZE;
  return size;
}

// ------------------------------------------------------------------------------ visible rows

export interface NodeRow {
  kind: 'node';
  id: string;
  depth: number;
  key: JsonKey | null;
  value: JsonValue;
  /** The container row this entry belongs to (null for the root), for its path. */
  parent: NodeRow | null;
}

export interface GroupRow {
  kind: 'group';
  id: string;
  depth: number;
  from: number;
  to: number;
}

export type TreeRow = NodeRow | GroupRow;

/** Only rows on the way to search matches, for "only matches". */
export interface TreeFilter {
  /** Ids of every container holding a match. */
  ancestors: Set<string>;
  /** Ids of the matched nodes. */
  matches: Set<string>;
  /** For each container id, the keys of its entries that lead to matches, in order. */
  children: Map<string, JsonKey[]>;
}

/** The rows on screen: every node and group whose parents are open. */
export function visibleRows(root: JsonValue, isOpen: (id: string) => boolean, filter?: TreeFilter | null): TreeRow[] {
  const rows: TreeRow[] = [];

  function node(key: JsonKey | null, value: JsonValue, id: string, depth: number, parent: NodeRow | null, insideMatch: boolean) {
    const row: NodeRow = { kind: 'node', id, depth, key, value, parent };
    rows.push(row);
    if (!isContainer(value)) return;
    const inside = insideMatch || Boolean(filter?.matches.has(id));
    if (filter && !inside) {
      // only the entries that lead to matches, opened for the user
      if (!filter.ancestors.has(id)) return;
      for (const childKey of filter.children.get(id) ?? []) {
        node(childKey, (value as Record<string, JsonValue>)[childKey]!, childId(id, childKey), depth + 1, row, false);
      }
      return;
    }
    if (isOpen(id)) range(value, id, 0, entryCount(value) - 1, depth + 1, row, inside);
  }

  function range(container: Container, id: string, from: number, to: number, depth: number, parent: NodeRow, insideMatch: boolean) {
    const length = to - from + 1;
    if (length <= GROUP_SIZE) {
      for (let position = from; position <= to; position++) {
        const [key, value] = entryAt(container, position);
        node(key, value, childId(id, key), depth, parent, insideMatch);
      }
      return;
    }
    const size = groupSize(length);
    for (let start = from; start <= to; start += size) {
      const end = Math.min(start + size - 1, to);
      const group: GroupRow = { kind: 'group', id: bucketId(id, start, end), depth, from: start, to: end };
      rows.push(group);
      if (isOpen(group.id)) range(container, id, start, end, depth + 1, parent, insideMatch);
    }
  }

  node(null, root, ROOT_ID, 0, null, false);
  return rows;
}

/**
 * Ids to open for "expand all", in document order, until about `budget` rows would show.
 * `complete` is false when the document is bigger than that.
 */
export function expandAllIds(root: JsonValue, budget: number): { ids: Set<string>; complete: boolean } {
  const ids = new Set<string>();
  let rows = 1;
  let complete = true;

  function open(value: JsonValue, id: string): void {
    if (!isContainer(value) || !complete) return;
    ids.add(id);
    range(value, id, 0, entryCount(value) - 1);
  }
  function range(container: Container, id: string, from: number, to: number): void {
    const length = to - from + 1;
    if (length <= GROUP_SIZE) {
      for (let position = from; position <= to && complete; position++) {
        if (++rows > budget) complete = false;
        const [key, value] = entryAt(container, position);
        open(value, childId(id, key));
      }
      return;
    }
    const size = groupSize(length);
    for (let start = from; start <= to && complete; start += size) {
      const end = Math.min(start + size - 1, to);
      if (++rows > budget) complete = false;
      ids.add(bucketId(id, start, end));
      range(container, id, start, end);
    }
  }
  open(root, ROOT_ID);
  return { ids, complete };
}

/** Ids to open so the node at `path` shows: its containers and the groups around it. */
export function revealIds(root: JsonValue, path: readonly JsonKey[]): string[] {
  const ids: string[] = [];
  let value = root;
  let id = ROOT_ID;
  for (const key of path) {
    if (!isContainer(value)) break;
    ids.push(id);
    const keys = keysOf(value);
    const position = keys ? keys.indexOf(String(key)) : Number(key);
    // the groups around this entry, from the outermost in
    let from = 0;
    let to = entryCount(value) - 1;
    while (to - from + 1 > GROUP_SIZE) {
      const size = groupSize(to - from + 1);
      const start = from + Math.floor((position - from) / size) * size;
      const end = Math.min(start + size - 1, to);
      ids.push(bucketId(id, start, end));
      from = start;
      to = end;
    }
    value = (value as Record<string, JsonValue>)[key as string]!;
    id = childId(id, key);
  }
  return ids;
}

// ------------------------------------------------------------------------------------- search

/** Matches past this many are counted but not kept (nor shown by "only matches"). */
export const MAX_TREE_MATCHES = 100_000;

export interface TreeSearch {
  /** Every node whose key or value contains the text, kept or not. */
  total: number;
  /** Ids and paths of the matches kept, in document order. */
  ids: string[];
  paths: JsonKey[][];
  filter: TreeFilter;
}

export const NO_TREE_MATCHES: TreeSearch = {
  total: 0,
  ids: [],
  paths: [],
  filter: { ancestors: new Set(), matches: new Set(), children: new Map() },
};

/**
 * Searches every key and value of the document (array indexes are not searched). Built for
 * millions of nodes: ids are made only for matches, numbers are turned into text only when the
 * query could match one, and each distinct key is tested once.
 */
export function searchTree(root: JsonValue, query: string, caseSensitive: boolean): TreeSearch {
  if (!query) return NO_TREE_MATCHES;
  const needle = caseSensitive ? query : query.toLowerCase();
  const contains = (text: string) => (caseSensitive ? text : text.toLowerCase()).includes(needle);
  // which kinds of leaf can match at all
  const numbersCan = /^[\d.eE+-]+$/.test(query);
  const literalsCan = ['true', 'false', 'null'].some((word) => contains(word));
  const keyHits = new Map<string, boolean>();
  const keyHit = (key: string) => {
    let hit = keyHits.get(key);
    if (hit === undefined) keyHits.set(key, (hit = contains(key)));
    return hit;
  };
  const leafHit = (value: JsonValue): boolean => {
    if (typeof value === 'string') return contains(value);
    if (typeof value === 'number') return numbersCan && String(value).includes(needle);
    if (value instanceof ExactNumber) return numbersCan && value.source.includes(needle);
    return literalsCan && contains(String(value));
  };

  const result: TreeSearch = { total: 0, ids: [], paths: [], filter: { ancestors: new Set(), matches: new Set(), children: new Map() } };
  const keys: JsonKey[] = [];

  function record() {
    result.total++;
    if (result.ids.length >= MAX_TREE_MATCHES) return;
    const { ancestors, matches, children } = result.filter;
    let id = ROOT_ID;
    for (const key of keys) {
      if (!ancestors.has(id)) {
        ancestors.add(id);
        children.set(id, []);
      }
      const list = children.get(id)!;
      if (list.at(-1) !== key) list.push(key);
      id = childId(id, key);
    }
    result.ids.push(id);
    result.paths.push([...keys]);
    matches.add(id);
  }

  function visit(value: JsonValue, hitByKey: boolean) {
    if (!isContainer(value)) {
      if (hitByKey || leafHit(value)) record();
      return;
    }
    if (hitByKey) record();
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        keys.push(index);
        visit(value[index]!, false);
        keys.pop();
      }
    } else {
      for (const childKey of keysOf(value)!) {
        keys.push(childKey);
        visit(value[childKey]!, keyHit(childKey));
        keys.pop();
      }
    }
  }

  visit(root, false);
  return result;
}

// --------------------------------------------------------------------------------------- paths

/** Keys from the root to a row. */
export function rowPath(row: NodeRow): JsonKey[] {
  const path: JsonKey[] = [];
  for (let current: NodeRow | null = row; current && current.key !== null; current = current.parent) path.unshift(current.key);
  return path;
}

/** A path as a JavaScript accessor: $.data[3].name, $["a b"]. */
export function pathText(path: readonly JsonKey[]): string {
  return (
    '$' +
    path
      .map((key) =>
        typeof key === 'number' ? `[${key}]` : /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`,
      )
      .join('')
  );
}

/** A value as JSON text, numbers kept exact. */
export function valueJson(value: JsonValue, indent = 2): string {
  const marker = '\u0000exact:';
  const text = JSON.stringify(value, (_key, item: unknown) => (item instanceof ExactNumber ? marker + item.source : item), indent);
  return text.replace(/"\\u0000exact:([^"]*)"/g, '$1');
}
