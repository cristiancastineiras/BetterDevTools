// BDT-TOON v1: compact, line-oriented, lossless encoding of JSON values. Spec: docs/toon.md.

export const TOON_VERSION = 1;
export const TOON_HEADER = '# bdt-toon/1';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

export class ToonError extends Error {
  readonly line: number;

  constructor(message: string, line: number, options?: ErrorOptions) {
    super(`TOON line ${line}: ${message}`, options);
    this.line = line;
  }
}

const NUM = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const BARE_KEY = /^[A-Za-z_][\w.-]*$/;
const isObj = (v: Json | undefined): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPrim = (v: Json): v is Prim => v === null || typeof v !== 'object';
const pad = (d: number) => '  '.repeat(d);

function bareOk(s: string): boolean {
  return (
    s !== '' &&
    s === s.trim() &&
    s.isWellFormed() &&
    // oxlint-disable-next-line no-control-regex -- control characters are exactly what must be quoted
    !/["\\,\x00-\x1f\u2028\u2029]|: |:$/.test(s) &&
    !/^[-[{#]/.test(s) &&
    s !== 'null' &&
    s !== 'true' &&
    s !== 'false' &&
    !NUM.test(s)
  );
}

/** Normalizes to JSON values: toJSON() is honoured (Dates become ISO strings), undefined object fields are dropped. */
function norm(v: unknown, path: string): Json {
  let x: unknown = v;
  if (typeof v === 'object' && v !== null && 'toJSON' in v && typeof v.toJSON === 'function') x = v.toJSON();
  if (x === null || typeof x === 'boolean' || typeof x === 'string') return x;
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) throw new TypeError(`TOON: ${path} is not a finite number`);
    return x;
  }
  if (Array.isArray(x)) return x.map((item, i) => (item === undefined ? null : norm(item, `${path}[${i}]`)));
  if (ArrayBuffer.isView(x) || x instanceof ArrayBuffer) {
    throw new TypeError(`TOON: ${path} is binary; store it as a base64 string with an "encoding" field`);
  }
  if (typeof x === 'object') {
    const out: Obj = {};
    for (const [k, item] of Object.entries(x)) {
      if (item !== undefined)
        Object.defineProperty(out, k, { value: norm(item, `${path}.${k}`), enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  throw new TypeError(`TOON: ${path} has unsupported type ${typeof x}`);
}

function prim(v: Prim): string {
  if (typeof v === 'string') return bareOk(v) ? v : JSON.stringify(v);
  return String(v);
}

const key = (k: string) => (BARE_KEY.test(k) ? k : JSON.stringify(k));

type Prim = null | boolean | number | string;

/** Rows for the tabular form: every item an object with the same keys, in the same order, all primitive. */
function tabular(arr: Json[]): { cols: string[]; rows: Prim[][] } | null {
  const first = arr[0];
  if (!isObj(first)) return null;
  const cols = Object.keys(first);
  if (!cols.length) return null;
  const rows: Prim[][] = [];
  for (const item of arr) {
    if (!isObj(item)) return null;
    const ks = Object.keys(item);
    if (ks.length !== cols.length) return null;
    const row: Prim[] = [];
    for (const [i, k] of ks.entries()) {
      const cell = item[k]!;
      if (k !== cols[i] || !isPrim(cell)) return null;
      row.push(cell);
    }
    rows.push(row);
  }
  return { cols, rows };
}

function field(out: string[], d: number, k: string, v: Json): void {
  if (Array.isArray(v)) array(out, d, k, v);
  else if (isObj(v)) {
    out.push(`${pad(d)}${k}:`);
    object(out, d + 1, v);
  } else out.push(`${pad(d)}${k}: ${prim(v)}`);
}

function object(out: string[], d: number, o: Obj): void {
  for (const [k, v] of Object.entries(o)) field(out, d, key(k), v);
}

function array(out: string[], d: number, k: string, a: Json[]): void {
  const head = `${pad(d)}${k}[${a.length}]`;
  if (!a.length) {
    out.push(`${head}:`);
    return;
  }
  if (a.every(isPrim)) {
    out.push(`${head}: ${a.map(prim).join(',')}`);
    return;
  }
  const t = tabular(a);
  if (t) {
    out.push(`${head}{${t.cols.map(key).join(',')}}:`);
    for (const row of t.rows) out.push(pad(d + 1) + row.map(prim).join(','));
    return;
  }
  out.push(`${head}:`);
  for (const item of a) listItem(out, d + 1, item);
}

/** A list item is a "- " line; an object item's first field shares that line, the rest sit one level deeper. */
function listItem(out: string[], d: number, v: Json): void {
  if (isPrim(v)) {
    out.push(`${pad(d)}- ${prim(v)}`);
    return;
  }
  const start = out.length;
  if (Array.isArray(v)) {
    array(out, d, '', v);
    out[start] = `${pad(d)}- ${out[start]!.slice(pad(d).length)}`;
  } else if (!Object.keys(v).length) out.push(`${pad(d)}-`);
  else {
    object(out, d + 1, v);
    out[start] = `${pad(d)}- ${out[start]!.slice(pad(d + 1).length)}`;
  }
}

export function encodeToon(value: unknown): string {
  const v = norm(value, '$');
  const out = [TOON_HEADER];
  if (Array.isArray(v)) array(out, 0, '', v);
  else if (isObj(v)) object(out, 0, v);
  else out.push(prim(v));
  return out.join('\n') + '\n';
}

/** Encodes one list item at `depth`, for streaming a `key[N]:` list piece by piece. */
export function encodeToonItem(value: unknown, depth: number): string {
  const out: string[] = [];
  listItem(out, depth, norm(value, '$'));
  return out.join('\n') + '\n';
}

/** Header line of a tabular array, for streaming `key[N]{cols}:` rows piece by piece. */
export function encodeToonTableHead(name: string, count: number, cols: string[], depth: number): string {
  return `${pad(depth)}${key(name)}[${count}]{${cols.map(key).join(',')}}:\n`;
}

/** One tabular row; every value must be a primitive. */
export function encodeToonRow(values: unknown[], depth: number): string {
  const cells = values.map((v, i) => {
    const x = norm(v ?? null, `$[${i}]`);
    if (!isPrim(x)) throw new TypeError(`TOON: row cell ${i} is not a primitive`);
    return prim(x);
  });
  return `${pad(depth + 1)}${cells.join(',')}\n`;
}

// ---------------------------------------------------------------------------------- decoder

interface Line {
  d: number;
  t: string;
  n: number;
}

interface Head {
  key: string;
  count: number | null;
  cols: string[] | null;
  rest: string | null;
}

function splitRow(s: string, n: number): string[] {
  const out: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '\\') i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  if (quoted) throw new ToonError('unterminated string', n);
  out.push(s.slice(start));
  return out;
}

function parsePrim(tok: string, n: number): Json {
  if (tok === 'null') return null;
  if (tok === 'true') return true;
  if (tok === 'false') return false;
  if (NUM.test(tok)) return Number(tok);
  if (tok.startsWith('"')) {
    try {
      const s: unknown = JSON.parse(tok);
      if (typeof s === 'string') return s;
    } catch (cause) {
      throw new ToonError(`invalid string ${tok.slice(0, 40)}`, n, { cause });
    }
  }
  if (!bareOk(tok)) throw new ToonError(`invalid value "${tok.slice(0, 40)}"`, n);
  return tok;
}

function parseKey(tok: string, n: number): string {
  return tok.startsWith('"') ? String(parsePrim(tok, n)) : tok;
}

/** Parses `key[N]{cols}: rest`; returns null when the text is not a field (or `[N]` array head). */
function parseHead(t: string, n: number, keyless = false): Head | null {
  let k = '';
  let tail = t;
  if (!keyless) {
    if (t.startsWith('"')) {
      let j = 1;
      while (j < t.length && t[j] !== '"') j += t[j] === '\\' ? 2 : 1;
      if (j >= t.length) return null;
      k = t.slice(0, j + 1);
      tail = t.slice(j + 1);
    } else {
      const m = /^[A-Za-z_][\w.-]*/.exec(t);
      if (!m) return null;
      k = m[0];
      tail = t.slice(k.length);
    }
  }
  const m = /^(?:\[(\d+)\](?:\{(.*)\})?)?:(?: (.*))?$/s.exec(tail);
  if (!m || (keyless && m[1] === undefined)) return null;
  if (m[3] === '') throw new ToonError('empty value after ": "', n);
  if (m[2] !== undefined && m[3] !== undefined) throw new ToonError('tabular header cannot have inline values', n);
  return {
    key: keyless ? '' : parseKey(k, n),
    count: m[1] === undefined ? null : Number(m[1]),
    cols: m[2] === undefined ? null : splitRow(m[2], n).map((c) => parseKey(c, n)),
    rest: m[3] ?? null,
  };
}

function setField(o: Obj, k: string, v: Json, n: number): void {
  if (Object.hasOwn(o, k)) throw new ToonError(`duplicate key "${k}"`, n);
  // defineProperty: a "__proto__" key stays a plain own property (no prototype pollution)
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}

class Parser {
  i = 0;
  readonly lines: Line[];

  constructor(lines: Line[]) {
    this.lines = lines;
  }

  at(d: number): Line | undefined {
    const l = this.lines[this.i];
    return l && l.d === d ? l : undefined;
  }

  root(): Json {
    const l = this.lines[this.i];
    if (!l) return {};
    if (l.d !== 0) throw new ToonError('unexpected indentation', l.n);
    const arr = l.t.startsWith('[') ? parseHead(l.t, l.n, true) : null;
    if (arr) {
      this.i++;
      return this.array(arr, 0, l.n);
    }
    if (!parseHead(l.t, l.n)) {
      this.i++;
      return parsePrim(l.t, l.n);
    }
    return this.object(0);
  }

  object(d: number): Obj {
    const o: Obj = {};
    for (let l = this.at(d); l; l = this.at(d)) {
      const h = parseHead(l.t, l.n);
      if (!h) throw new ToonError(`expected "key: value", got "${l.t.slice(0, 40)}"`, l.n);
      this.i++;
      let v: Json;
      if (h.count !== null) v = this.array(h, d, l.n);
      else if (h.rest !== null) v = parsePrim(h.rest, l.n);
      else v = this.at(d + 1) ? this.object(d + 1) : {};
      setField(o, h.key, v, l.n);
    }
    const next = this.lines[this.i];
    if (next && next.d > d) throw new ToonError('unexpected indentation', next.n);
    return o;
  }

  array(h: Head, d: number, n: number): Json[] {
    const count = h.count ?? 0;
    if (h.rest !== null) {
      const vals = splitRow(h.rest, n).map((t) => parsePrim(t, n));
      if (vals.length !== count) throw new ToonError(`expected ${count} values, found ${vals.length}`, n);
      return vals;
    }
    const out: Json[] = [];
    for (let k = 0; k < count; k++) {
      const l = this.at(d + 1);
      if (!l) throw new ToonError(`expected ${count} items, found ${k}`, n);
      if (h.cols) {
        this.i++;
        const vals = splitRow(l.t, l.n);
        if (vals.length !== h.cols.length) throw new ToonError(`expected ${h.cols.length} columns, found ${vals.length}`, l.n);
        const row: Obj = {};
        h.cols.forEach((c, j) => setField(row, c, parsePrim(vals[j]!, l.n), l.n));
        out.push(row);
      } else out.push(this.item(l, d + 1));
    }
    return out;
  }

  item(l: Line, d: number): Json {
    if (l.t === '-') {
      this.i++;
      return {};
    }
    if (!l.t.startsWith('- ')) throw new ToonError('expected a "- " list item', l.n);
    const rest = l.t.slice(2);
    const arr = rest.startsWith('[') ? parseHead(rest, l.n, true) : null;
    if (arr) {
      this.i++;
      return this.array(arr, d, l.n);
    }
    if (parseHead(rest, l.n)) {
      // the first field shares the hyphen line: parse it as if it were on its own line one level deeper
      this.lines[this.i] = { d: d + 1, t: rest, n: l.n };
      return this.object(d + 1);
    }
    this.i++;
    return parsePrim(rest, l.n);
  }
}

export function decodeToon(text: string): Json {
  const raw = text.split('\n');
  if (raw.at(-1) === '') raw.pop();
  if (raw[0] !== TOON_HEADER) throw new ToonError(`expected header "${TOON_HEADER}"`, 1);
  const lines = raw.slice(1).map((s, i): Line => {
    const sp = /^ */.exec(s)![0].length;
    if (sp % 2 || sp === s.length || /^\s/.test(s.slice(sp)))
      throw new ToonError('indentation must be pairs of spaces, with no blank lines', i + 2);
    return { d: sp / 2, t: s.slice(sp), n: i + 2 };
  });
  const p = new Parser(lines);
  const value = p.root();
  const extra = lines[p.i];
  if (extra) throw new ToonError(`unexpected line "${extra.t.slice(0, 40)}"`, extra.n);
  return value;
}

export function validateToon(text: string): { ok: true; value: Json } | { ok: false; error: string } {
  try {
    return { ok: true, value: decodeToon(text) };
  } catch (e) {
    if (e instanceof ToonError) return { ok: false, error: e.message };
    throw e;
  }
}
