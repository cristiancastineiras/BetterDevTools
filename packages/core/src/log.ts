import { compileFilter, type Matcher } from './filter.ts';
import { summarize, type Body, type Captured, type HarEntry, type Source } from './har.ts';

export interface LogLimits {
  /** Ring buffer size: oldest entries are dropped beyond it. */
  capacity: number;
  /** Per-body cap in UTF-16 code units; longer bodies are kept truncated. */
  maxBodyChars: number;
  /** Budget for all bodies together; the oldest bodies are discarded first. */
  maxTotalBodyChars: number;
}

export const DEFAULT_LIMITS: LogLimits = { capacity: 10_000, maxBodyChars: 2 << 20, maxTotalBodyChars: 128 << 20 };

const DISCARDED: Body = {
  state: 'discarded',
  text: '',
  size: 0,
  reason: 'Dropped to stay within the memory budget (Settings → body memory)',
};

/**
 * Capture store, independent of any UI framework. `view` is replaced (never mutated) on every
 * change so a UI can compare it by reference; bodies stay in a plain Map, outside any reactivity.
 */
export class CaptureLog {
  entries: Captured[] = [];
  view: Captured[] = [];
  readonly bodies = new Map<number, Body>();
  #heavy = new Map<number, number>(); // ids whose body holds text, oldest first → its length
  #bodyChars = 0;
  #nextId = 1;
  #query = '';
  #match: Matcher = () => true;

  limits: LogLimits;

  constructor(limits: LogLimits = DEFAULT_LIMITS) {
    this.limits = limits;
  }

  add(items: Iterable<{ har: HarEntry; body: Body; source: Source }>): Captured[] {
    const added: Captured[] = [];
    for (const { har, body, source } of items) {
      const c = summarize(har, this.#nextId++, source);
      this.entries.push(c);
      this.#storeBody(c.id, body);
      added.push(c);
    }
    const matches = added.filter(this.#match);
    if (matches.length) this.view = this.view.concat(matches);
    this.#evict();
    return added;
  }

  body(id: number): Body {
    return this.bodies.get(id) ?? DISCARDED;
  }

  get query(): string {
    return this.#query;
  }

  /** Filters the view; with `searchBodies`, free-text terms also match the (text) response bodies. */
  setQuery(query: string, searchBodies = false): void {
    this.#query = query;
    const textBody = (id: number) => {
      const body = this.bodies.get(id);
      return body && !body.encoding ? body.text : '';
    };
    this.#match = compileFilter(query, textBody, { searchBodies });
    this.view = this.entries.filter(this.#match);
  }

  setLimits(limits: LogLimits): void {
    this.limits = limits;
    this.#evict();
  }

  /** Binary search: entries are ordered by id. */
  get(id: number): Captured | undefined {
    let lo = 0;
    let hi = this.entries.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const c = this.entries[mid]!;
      if (c.id === id) return c;
      if (c.id < id) lo = mid + 1;
      else hi = mid - 1;
    }
    return undefined;
  }

  clear(): void {
    this.entries = [];
    this.view = [];
    this.bodies.clear();
    this.#heavy.clear();
    this.#bodyChars = 0;
  }

  get bodyChars(): number {
    return this.#bodyChars;
  }

  #storeBody(id: number, body: Body): void {
    let b = body;
    const max = this.limits.maxBodyChars;
    if (b.text.length > max) {
      // base64 is cut on a 4-char boundary so the kept prefix still decodes
      const keep = b.encoding === 'base64' ? max - (max % 4) : max;
      b = { ...b, state: 'truncated', text: b.text.slice(0, keep), reason: `Kept the first ${keep} of ${b.text.length} characters` };
    }
    this.bodies.set(id, b);
    if (b.text.length) {
      this.#heavy.set(id, b.text.length);
      this.#bodyChars += b.text.length;
    }
  }

  #dropBody(id: number): void {
    this.bodies.delete(id);
    const n = this.#heavy.get(id);
    if (n !== undefined) {
      this.#heavy.delete(id);
      this.#bodyChars -= n;
    }
  }

  #evict(): void {
    const over = this.entries.length - this.limits.capacity;
    if (over > 0) {
      for (const c of this.entries.splice(0, over)) this.#dropBody(c.id);
      const minId = this.entries[0]?.id ?? Infinity;
      const keep = this.view.findIndex((c) => c.id >= minId);
      this.view = keep < 0 ? [] : this.view.slice(keep);
    }
    for (const [id, n] of this.#heavy) {
      if (this.#bodyChars <= this.limits.maxTotalBodyChars) break;
      this.#heavy.delete(id);
      this.#bodyChars -= n;
      this.bodies.delete(id); // body() then reports it as discarded
    }
  }
}
