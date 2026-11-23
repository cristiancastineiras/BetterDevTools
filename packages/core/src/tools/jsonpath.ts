// JSONPath as RFC 9535 defines it: names, wildcards, indexes, slices, unions, descendants and
// filters with comparisons, logic, and the length/count/value/match/search functions. No eval.

export interface PathNode {
  /** Normalised path of the node, e.g. $['store']['book'][0]. */
  path: string;
  value: unknown;
}
export type JsonPathResult = { ok: true; nodes: PathNode[] } | { ok: false; error: string };

type Key = string | number;
interface Node {
  keys: Key[];
  value: unknown;
}
type Selector =
  | { kind: 'name'; name: string }
  | { kind: 'index'; index: number }
  | { kind: 'wild' }
  | { kind: 'slice'; start: number | undefined; end: number | undefined; step: number }
  | { kind: 'filter'; expr: Expr };
interface Segment {
  descend: boolean;
  selectors: Selector[];
}
interface Query {
  root: boolean;
  segments: Segment[];
}
type Operand = { kind: 'lit'; value: unknown } | { kind: 'query'; query: Query } | { kind: 'fn'; name: string; args: Operand[] };
type Expr =
  | { kind: 'or' | 'and'; left: Expr; right: Expr }
  | { kind: 'not'; expr: Expr }
  | { kind: 'cmp'; op: string; left: Operand; right: Operand }
  | { kind: 'test'; operand: Operand };

class JsonPathError extends Error {}

const MAX_NODES = 10_000;
const NAME_START = /[A-Za-z_\u0080-￿]/;
const NAME_CHAR = /[\w\u0080-￿]/;
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const FUNCTIONS = new Set(['length', 'count', 'value', 'match', 'search']);

class Parser {
  pos = 0;
  readonly src: string;
  constructor(src: string) {
    this.src = src;
  }

  fail(message: string): never {
    throw new JsonPathError(`${message} at position ${this.pos}`);
  }
  peek(): string {
    return this.src.charAt(this.pos);
  }
  ws(): void {
    while (/\s/.test(this.peek()) && this.pos < this.src.length) this.pos++;
  }
  eat(text: string): boolean {
    if (!this.src.startsWith(text, this.pos)) return false;
    this.pos += text.length;
    return true;
  }
  expect(text: string): void {
    if (!this.eat(text)) this.fail(`Expected "${text}"`);
  }

  parseRoot(): Query {
    const query = this.parseQuery();
    if (!query.root) this.fail('A path starts with $');
    if (this.pos < this.src.length) this.fail(`Unexpected "${this.peek()}"`);
    return query;
  }

  parseQuery(): Query {
    const root = this.peek() === '$';
    if (!root && this.peek() !== '@') this.fail('Expected $ or @');
    this.pos++;
    const segments: Segment[] = [];
    for (;;) {
      if (this.eat('..')) {
        if (this.peek() === '[') segments.push({ descend: true, selectors: this.parseBracket() });
        else if (this.eat('*')) segments.push({ descend: true, selectors: [{ kind: 'wild' }] });
        else segments.push({ descend: true, selectors: [{ kind: 'name', name: this.parseShorthand() }] });
      } else if (this.peek() === '.') {
        this.pos++;
        if (this.eat('*')) segments.push({ descend: false, selectors: [{ kind: 'wild' }] });
        else segments.push({ descend: false, selectors: [{ kind: 'name', name: this.parseShorthand() }] });
      } else if (this.peek() === '[') {
        segments.push({ descend: false, selectors: this.parseBracket() });
      } else break;
    }
    return { root, segments };
  }

  parseShorthand(): string {
    if (!NAME_START.test(this.peek()) || this.pos >= this.src.length) this.fail('Expected a member name');
    const start = this.pos;
    while (this.pos < this.src.length && NAME_CHAR.test(this.peek())) this.pos++;
    return this.src.slice(start, this.pos);
  }

  parseBracket(): Selector[] {
    this.expect('[');
    const selectors: Selector[] = [];
    do {
      this.ws();
      selectors.push(this.parseSelector());
      this.ws();
    } while (this.eat(','));
    this.expect(']');
    return selectors;
  }

  parseSelector(): Selector {
    const c = this.peek();
    if (c === '*') {
      this.pos++;
      return { kind: 'wild' };
    }
    if (c === "'" || c === '"') return { kind: 'name', name: this.parseString() };
    if (c === '?') {
      this.pos++;
      this.ws();
      return { kind: 'filter', expr: this.parseOr() };
    }
    const start = this.parseInt();
    this.ws();
    if (this.peek() !== ':') {
      if (start === undefined) this.fail('Expected a selector');
      return { kind: 'index', index: start };
    }
    this.pos++;
    this.ws();
    const end = this.parseInt();
    this.ws();
    let step: number | undefined = 1;
    if (this.eat(':')) {
      this.ws();
      step = this.parseInt();
      this.ws();
    }
    return { kind: 'slice', start, end, step: step ?? 1 };
  }

  parseInt(): number | undefined {
    const match = /^-?(?:0|[1-9]\d*)/.exec(this.src.slice(this.pos));
    if (!match) return undefined;
    this.pos += match[0].length;
    return Number(match[0]);
  }

  parseString(): string {
    const quote = this.peek();
    this.pos++;
    let out = '';
    for (;;) {
      if (this.pos >= this.src.length) this.fail('Unterminated string');
      const c = this.peek();
      this.pos++;
      if (c === quote) return out;
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = this.peek();
      this.pos++;
      const simple: Record<string, string> = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', '/': '/', '\\': '\\', "'": "'", '"': '"' };
      if (e in simple) out += simple[e];
      else if (e === 'u' && /^[0-9a-fA-F]{4}/.test(this.src.slice(this.pos))) {
        out += String.fromCharCode(Number.parseInt(this.src.slice(this.pos, this.pos + 4), 16));
        this.pos += 4;
      } else this.fail('Invalid escape');
    }
  }

  parseOr(): Expr {
    let left = this.parseAnd();
    for (this.ws(); this.eat('||'); this.ws()) left = { kind: 'or', left, right: this.parseAnd() };
    return left;
  }

  parseAnd(): Expr {
    let left = this.parseUnary();
    for (this.ws(); this.eat('&&'); this.ws()) left = { kind: 'and', left, right: this.parseUnary() };
    return left;
  }

  parseUnary(): Expr {
    this.ws();
    if (this.peek() === '!') {
      this.pos++;
      return { kind: 'not', expr: this.parseUnary() };
    }
    if (this.peek() === '(') {
      this.pos++;
      const inner = this.parseOr();
      this.ws();
      this.expect(')');
      return inner;
    }
    const left = this.parseOperand();
    this.ws();
    const op = ['==', '!=', '<=', '>=', '<', '>'].find((candidate) => this.src.startsWith(candidate, this.pos));
    if (op) {
      this.pos += op.length;
      this.ws();
      return { kind: 'cmp', op, left, right: this.parseOperand() };
    }
    if (left.kind === 'lit') this.fail('A literal needs something to compare with');
    return { kind: 'test', operand: left };
  }

  parseOperand(): Operand {
    this.ws();
    const c = this.peek();
    if (c === '@' || c === '$') return { kind: 'query', query: this.parseQuery() };
    if (c === "'" || c === '"') return { kind: 'lit', value: this.parseString() };
    const number = NUMBER.exec(this.src.slice(this.pos));
    if (number) {
      this.pos += number[0].length;
      return { kind: 'lit', value: Number(number[0]) };
    }
    const word = /^[a-z][a-z0-9_]*/.exec(this.src.slice(this.pos))?.[0];
    if (!word) this.fail('Expected a value');
    this.pos += word.length;
    if (this.peek() !== '(') {
      if (word === 'true') return { kind: 'lit', value: true };
      if (word === 'false') return { kind: 'lit', value: false };
      if (word === 'null') return { kind: 'lit', value: null };
      this.fail(`Unknown word "${word}"`);
    }
    if (!FUNCTIONS.has(word)) this.fail(`Unknown function "${word}"`);
    this.pos++;
    const args: Operand[] = [];
    this.ws();
    if (!this.eat(')')) {
      do args.push(this.parseOperand());
      while ((this.ws(), this.eat(',')));
      this.ws();
      this.expect(')');
    }
    return { kind: 'fn', name: word, args };
  }
}

// ------------------------------------------------------------------------------- evaluation

const isArray = Array.isArray;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !isArray(v);

function childrenOf(node: Node): Node[] {
  const { value, keys } = node;
  if (isArray(value)) return value.map((item, i) => ({ keys: [...keys, i], value: item }));
  if (isObject(value)) return Object.entries(value).map(([k, item]) => ({ keys: [...keys, k], value: item }));
  return [];
}

function descendantsOf(node: Node, into: Node[]): void {
  into.push(node);
  for (const child of childrenOf(node)) descendantsOf(child, into);
}

function sliceIndexes(length: number, start: number | undefined, end: number | undefined, step: number): number[] {
  if (step === 0) return [];
  const norm = (i: number) => (i >= 0 ? i : length + i);
  const lo = Math.min(Math.max(norm(start ?? (step > 0 ? 0 : length - 1)), step > 0 ? 0 : -1), step > 0 ? length : length - 1);
  const hi = Math.min(Math.max(norm(end ?? (step > 0 ? length : -length - 1)), step > 0 ? 0 : -1), step > 0 ? length : length - 1);
  const out: number[] = [];
  if (step > 0) for (let i = lo; i < hi; i += step) out.push(i);
  else for (let i = lo; i > hi; i += step) out.push(i);
  return out;
}

function select(selector: Selector, node: Node, root: unknown): Node[] {
  const { value, keys } = node;
  switch (selector.kind) {
    case 'name':
      return isObject(value) && Object.hasOwn(value, selector.name)
        ? [{ keys: [...keys, selector.name], value: value[selector.name] }]
        : [];
    case 'index': {
      if (!isArray(value)) return [];
      const i = selector.index >= 0 ? selector.index : value.length + selector.index;
      return i >= 0 && i < value.length ? [{ keys: [...keys, i], value: value[i] }] : [];
    }
    case 'wild':
      return childrenOf(node);
    case 'slice':
      return isArray(value)
        ? sliceIndexes(value.length, selector.start, selector.end, selector.step).map((i) => ({ keys: [...keys, i], value: value[i] }))
        : [];
    case 'filter':
      return childrenOf(node).filter((child) => truthy(selector.expr, root, child));
  }
}

function runQuery(query: Query, root: unknown, current: Node): Node[] {
  let nodes: Node[] = [query.root ? { keys: [], value: root } : current];
  for (const segment of query.segments) {
    const next: Node[] = [];
    for (const node of nodes) {
      const scope: Node[] = [];
      if (segment.descend) descendantsOf(node, scope);
      else scope.push(node);
      for (const target of scope) for (const selector of segment.selectors) next.push(...select(selector, target, root));
      if (next.length > MAX_NODES) throw new JsonPathError(`More than ${MAX_NODES} nodes: narrow the path`);
    }
    nodes = next;
  }
  return nodes;
}

const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (isArray(a) !== isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return (
    ka.length === kb.length &&
    ka.every((k) => Object.hasOwn(b, k) && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
};

/** The value of an operand; `undefined` is "Nothing" (no node, or several where one was needed). */
function valueOf(operand: Operand, root: unknown, current: Node): unknown {
  if (operand.kind === 'lit') return operand.value;
  if (operand.kind === 'query') {
    const nodes = runQuery(operand.query, root, current);
    return nodes.length === 1 ? nodes[0]!.value : undefined;
  }
  const [first, second] = operand.args;
  switch (operand.name) {
    case 'length': {
      const v = first ? valueOf(first, root, current) : undefined;
      return typeof v === 'string' ? [...v].length : isArray(v) ? v.length : isObject(v) ? Object.keys(v).length : undefined;
    }
    case 'count':
      return first?.kind === 'query' ? runQuery(first.query, root, current).length : undefined;
    case 'value':
      return first ? valueOf(first, root, current) : undefined;
    default: {
      const text = first ? valueOf(first, root, current) : undefined;
      const pattern = second ? valueOf(second, root, current) : undefined;
      if (typeof text !== 'string' || typeof pattern !== 'string') return false;
      try {
        return new RegExp(operand.name === 'match' ? `^(?:${pattern})$` : pattern, 'u').test(text);
      } catch {
        return false;
      }
    }
  }
}

function truthy(expr: Expr, root: unknown, current: Node): boolean {
  switch (expr.kind) {
    case 'or':
      return truthy(expr.left, root, current) || truthy(expr.right, root, current);
    case 'and':
      return truthy(expr.left, root, current) && truthy(expr.right, root, current);
    case 'not':
      return !truthy(expr.expr, root, current);
    case 'test':
      return expr.operand.kind === 'query'
        ? runQuery(expr.operand.query, root, current).length > 0
        : valueOf(expr.operand, root, current) === true;
    case 'cmp': {
      const a = valueOf(expr.left, root, current);
      const b = valueOf(expr.right, root, current);
      const equal = a === undefined || b === undefined ? a === b : same(a, b);
      const ordered = (typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string');
      switch (expr.op) {
        case '==':
          return equal;
        case '!=':
          return !equal;
        case '<':
          return ordered && (a as number) < (b as number);
        case '>':
          return ordered && (a as number) > (b as number);
        case '<=':
          return equal || (ordered && (a as number) < (b as number));
        default:
          return equal || (ordered && (a as number) > (b as number));
      }
    }
  }
}

const normalised = (keys: Key[]): string =>
  `$${keys.map((k) => (typeof k === 'number' ? `[${k}]` : `['${k.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}']`)).join('')}`;

/** Runs a JSONPath query on a parsed document. */
export function queryJsonPath(document: unknown, path: string): JsonPathResult {
  try {
    const query = new Parser(path.trim()).parseRoot();
    const nodes = runQuery(query, document, { keys: [], value: document });
    return { ok: true, nodes: nodes.map((node) => ({ path: normalised(node.keys), value: node.value })) };
  } catch (error) {
    if (error instanceof JsonPathError) return { ok: false, error: error.message };
    throw error;
  }
}
