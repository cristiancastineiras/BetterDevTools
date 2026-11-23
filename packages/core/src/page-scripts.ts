/* oxlint-disable typescript/no-explicit-any, unicorn/consistent-function-scoping -- these functions run in the inspected page, against its own untyped globals, and are serialised with toString: each must stay self-contained, so their helpers live inside them */

import type { PageMetrics } from './perf.ts';

// Functions the panel ships into the inspected page. Each one takes the page's global as its first
// argument (the panel passes globalThis) so tests can hand it a fake. None may use anything defined
// outside its own body.

// ------------------------------------------------------------------------------ performance

/** Starts observing paint, layout shifts, interactions and long tasks; `scope.__betterDevToolsPerf.get()` reads them. */
export function perfCollector(scope: any): void {
  const KEY = '__betterDevToolsPerf';
  if (scope[KEY]) return;
  const state: any = {
    lcp: undefined,
    fcp: undefined,
    cls: 0,
    window: { value: 0, start: 0, last: 0 },
    interactions: new Map(),
    long: { count: 0, blocking: 0 },
  };
  const describe = (el: any): string =>
    el && el.tagName
      ? `${String(el.tagName).toLowerCase()}${el.id ? `#${el.id}` : ''}${el.classList && el.classList.length ? `.${[...el.classList].slice(0, 2).join('.')}` : ''}`
      : '';
  const observe = (type: string, handle: (entry: any) => void, extra: Record<string, unknown> = {}) => {
    try {
      new scope.PerformanceObserver((list: any) => list.getEntries().forEach(handle)).observe({ type, buffered: true, ...extra });
    } catch {
      /* a browser without this entry type simply reports no value for it */
    }
  };
  observe('largest-contentful-paint', (e) => (state.lcp = { value: e.startTime, element: describe(e.element), url: e.url || '' }));
  observe('paint', (e) => {
    if (e.name === 'first-contentful-paint') state.fcp = e.startTime;
  });
  observe('layout-shift', (e) => {
    if (e.hadRecentInput) return;
    const w = state.window;
    if (e.startTime - w.last > 1000 || e.startTime - w.start > 5000) state.window = { value: 0, start: e.startTime, last: e.startTime };
    state.window.value += e.value;
    state.window.last = e.startTime;
    state.cls = Math.max(state.cls, state.window.value);
  });
  observe(
    'event',
    (e) => {
      if (!e.interactionId) return;
      const known = state.interactions.get(e.interactionId);
      if (!known || e.duration > known.duration)
        state.interactions.set(e.interactionId, { duration: e.duration, target: describe(e.target) });
    },
    { durationThreshold: 16 },
  );
  observe('longtask', (e) => {
    state.long.count++;
    state.long.blocking += Math.max(0, e.duration - 50);
  });

  Object.defineProperty(scope, KEY, {
    value: {
      get() {
        const perf = scope.performance;
        const nav = perf.getEntriesByType('navigation')[0];
        const sorted = [...state.interactions.values()].toSorted((a: any, b: any) => b.duration - a.duration);
        const worst = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length / 50))];
        const resources: any[] = perf.getEntriesByType('resource');
        const bytes = new Map(resources.map((r) => [r.name, r.transferSize || r.encodedBodySize || 0]));
        const dpr = scope.devicePixelRatio || 1;
        return {
          lcp: state.lcp,
          fcp: state.fcp,
          cls: state.cls,
          inp: worst ? { value: worst.duration, target: worst.target } : undefined,
          ttfb: nav ? nav.responseStart : undefined,
          domContentLoaded: nav && nav.domContentLoadedEventEnd ? nav.domContentLoadedEventEnd : undefined,
          load: nav && nav.loadEventEnd ? nav.loadEventEnd : undefined,
          longTasks: { count: state.long.count, blocking: state.long.blocking },
          blocking: resources.filter((r) => r.renderBlockingStatus === 'blocking').map((r) => r.name),
          images: [...scope.document.images]
            .filter((img: any) => img.complete && img.currentSrc && img.naturalWidth)
            .slice(0, 200)
            .map((img: any) => ({
              src: img.currentSrc,
              natural: [img.naturalWidth, img.naturalHeight],
              rendered: [Math.round(img.clientWidth * dpr), Math.round(img.clientHeight * dpr)],
              bytes: bytes.get(img.currentSrc) || 0,
            })),
        } satisfies PageMetrics;
      },
    },
  });
}

/** The expression that reads the collector back, or null when the page has none (it navigated). */
export const PERF_READ_EXPRESSION = 'globalThis.__betterDevToolsPerf ? globalThis.__betterDevToolsPerf.get() : null';

// ----------------------------------------------------------------------------------- storage

export interface StorageOverview {
  origin: string;
  local: [string, string][];
  session: [string, string][];
  databases: {
    name: string;
    version: number;
    stores: { name: string; keyPath: string; autoIncrement: boolean; count: number }[];
    error?: string;
  }[];
  caches: { name: string; count: number }[];
  workers: { scope: string; script: string; state: string }[];
  usage: number;
  quota: number;
}

/** Everything the page keeps: Web Storage, IndexedDB structure, Cache Storage names and Service Workers. */
export async function storageOverview(scope: any): Promise<StorageOverview> {
  // constants live in here: the function is serialised into the page, where module scope does not exist
  const ENTRY_CHARS = 100_000;
  const MAX_ENTRIES = 2000;
  const IDB_TIMEOUT_MS = 4000;
  const area = (storage: any): [string, string][] => {
    const rows: [string, string][] = [];
    try {
      for (let i = 0; i < Math.min(storage.length, MAX_ENTRIES); i++) {
        const key = storage.key(i);
        rows.push([key, String(storage.getItem(key)).slice(0, ENTRY_CHARS)]);
      }
    } catch {
      /* storage blocked for this page (sandboxed frame, privacy settings) */
    }
    return rows;
  };
  const request = <T>(req: any): Promise<T> =>
    new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const withTimeout = <T>(promise: Promise<T>): Promise<T> =>
    Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), IDB_TIMEOUT_MS))]);

  const databases: StorageOverview['databases'] = [];
  try {
    for (const info of (await scope.indexedDB.databases?.()) ?? []) {
      try {
        const db: any = await withTimeout(
          new Promise((resolve, reject) => {
            const open = scope.indexedDB.open(info.name);
            open.onupgradeneeded = () => open.transaction.abort(); // never create or change a database
            open.onsuccess = () => resolve(open.result);
            open.onerror = () => reject(open.error);
            open.onblocked = () => reject(new Error('blocked'));
          }),
        );
        const names: string[] = [...db.objectStoreNames];
        const stores: StorageOverview['databases'][number]['stores'] = [];
        if (names.length) {
          const tx = db.transaction(names, 'readonly');
          for (const name of names) {
            const store = tx.objectStore(name);
            stores.push({
              name,
              keyPath: JSON.stringify(store.keyPath ?? null),
              autoIncrement: store.autoIncrement,
              count: await request<number>(store.count()),
            });
          }
        }
        databases.push({ name: info.name, version: db.version, stores });
        db.close();
      } catch (error) {
        databases.push({ name: info.name, version: info.version ?? 0, stores: [], error: String((error as any)?.message ?? error) });
      }
    }
  } catch {
    /* indexedDB.databases() is missing or refused */
  }

  const caches: StorageOverview['caches'] = [];
  try {
    for (const name of await scope.caches.keys()) caches.push({ name, count: (await (await scope.caches.open(name)).keys()).length });
  } catch {
    /* Cache Storage is not available in this context */
  }

  const workers: StorageOverview['workers'] = [];
  try {
    for (const registration of await scope.navigator.serviceWorker.getRegistrations()) {
      const worker = registration.active ?? registration.waiting ?? registration.installing;
      workers.push({ scope: registration.scope, script: worker ? worker.scriptURL : '', state: worker ? worker.state : 'none' });
    }
  } catch {
    /* no Service Worker support here */
  }

  let usage = 0;
  let quota = 0;
  try {
    const estimate = await scope.navigator.storage.estimate();
    [usage, quota] = [estimate.usage ?? 0, estimate.quota ?? 0];
  } catch {
    /* no estimate */
  }
  return {
    origin: scope.location.origin,
    local: area(scope.localStorage),
    session: area(scope.sessionStorage),
    databases,
    caches,
    workers,
    usage,
    quota,
  };
}

export interface IdbRecord {
  key: unknown;
  value: unknown;
}

/** A page of records of one object store, as JSON the panel can show (dates, maps and binary data become tagged objects). */
export async function idbRecords(
  scope: any,
  database: string,
  store: string,
  skip: number,
  limit: number,
): Promise<{ records: IdbRecord[]; total: number }> {
  const plain = (value: any, depth = 0): unknown => {
    if (value === undefined) return { $undefined: true };
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : { $number: String(value) };
    if (typeof value === 'bigint') return { $bigint: value.toString() };
    if (depth > 20) return { $truncated: true };
    if (value instanceof Date) return { $date: Number.isNaN(value.getTime()) ? null : value.toISOString() };
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      return { $bytes: bytes.length, preview: [...bytes.subarray(0, 32)].map((b) => b.toString(16).padStart(2, '0')).join('') };
    }
    if (typeof Blob !== 'undefined' && value instanceof Blob) return { $blob: value.size, type: value.type };
    if (value instanceof Map) return { $map: [...value].map(([k, v]) => [plain(k, depth + 1), plain(v, depth + 1)]) };
    if (value instanceof Set) return { $set: [...value].map((v) => plain(v, depth + 1)) };
    if (Array.isArray(value)) return value.map((v) => plain(v, depth + 1));
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v, depth + 1)]));
    return String(value);
  };
  const db: any = await new Promise((resolve, reject) => {
    const open = scope.indexedDB.open(database);
    open.onupgradeneeded = () => open.transaction.abort();
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    const objectStore = db.transaction(store, 'readonly').objectStore(store);
    const total: number = await new Promise((resolve, reject) => {
      const count = objectStore.count();
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => reject(count.error);
    });
    const records: IdbRecord[] = await new Promise((resolve, reject) => {
      const out: IdbRecord[] = [];
      let skipped = false;
      const cursor = objectStore.openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return resolve(out);
        if (skip > 0 && !skipped) {
          skipped = true;
          return c.advance(skip);
        }
        out.push({ key: plain(c.key), value: plain(c.value) });
        if (out.length >= limit) return resolve(out);
        c.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
    return { records, total };
  } finally {
    db.close();
  }
}

/** Writes to one object store. `key` and `value` are JSON; `{"$date": iso}` is turned back into a Date. */
export async function idbWrite(
  scope: any,
  database: string,
  store: string,
  op: 'put' | 'delete' | 'clear',
  key: unknown,
  value: unknown,
): Promise<void> {
  const revive = (v: any): any => {
    if (Array.isArray(v)) return v.map(revive);
    if (v && typeof v === 'object') {
      if (typeof v.$date === 'string') return new Date(v.$date);
      if (v.$undefined) return undefined;
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)]));
    }
    return v;
  };
  const db: any = await new Promise((resolve, reject) => {
    const open = scope.indexedDB.open(database);
    open.onupgradeneeded = () => open.transaction.abort();
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    const tx = db.transaction(store, 'readwrite');
    const objectStore = tx.objectStore(store);
    if (op === 'clear') objectStore.clear();
    else if (op === 'delete') objectStore.delete(revive(key));
    else if (objectStore.keyPath === null) objectStore.put(revive(value), revive(key));
    else objectStore.put(revive(value));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('aborted'));
    });
  } finally {
    db.close();
  }
}

/** localStorage or sessionStorage: set, remove one key, or clear. */
export function webStorageWrite(scope: any, area: 'local' | 'session', op: 'set' | 'remove' | 'clear', key: string, value: string): void {
  const storage = area === 'local' ? scope.localStorage : scope.sessionStorage;
  if (op === 'set') storage.setItem(key, value);
  else if (op === 'remove') storage.removeItem(key);
  else storage.clear();
}

export interface CacheEntry {
  url: string;
  method: string;
  status: number;
  type: string;
  contentType: string;
}

/** The requests stored in one Cache Storage cache, with what their responses say. */
export async function cacheEntries(scope: any, name: string): Promise<CacheEntry[]> {
  const cache = await scope.caches.open(name);
  const out: CacheEntry[] = [];
  for (const request of (await cache.keys()).slice(0, 500)) {
    const response = await cache.match(request);
    out.push({
      url: request.url,
      method: request.method,
      status: response ? response.status : 0,
      type: response ? response.type : '',
      contentType: response ? response.headers.get('content-type') || '' : '',
    });
  }
  return out;
}

/** Deletes one cache entry (`url` given), a whole cache (`url` empty), or reads a text preview of an entry. */
export async function cacheAction(scope: any, name: string, action: 'delete' | 'preview', url: string): Promise<string> {
  if (action === 'delete') {
    if (url) await (await scope.caches.open(name)).delete(url);
    else await scope.caches.delete(name);
    return '';
  }
  const response = await (await scope.caches.open(name)).match(url);
  if (!response) return '';
  const text = await response.clone().text();
  return text.slice(0, 64 * 1024);
}

/** Unregisters or updates the Service Worker registered for a scope. */
export async function workerAction(scope: any, workerScope: string, action: 'unregister' | 'update'): Promise<boolean> {
  const registration = await scope.navigator.serviceWorker.getRegistration(workerScope);
  if (!registration) return false;
  if (action === 'unregister') return registration.unregister();
  await registration.update();
  return true;
}

// ------------------------------------------------------------------------------- CSS and DOM

export interface SelectorMatch {
  tag: string;
  id: string;
  classes: string;
  text: string;
  index: number;
}

/** Elements of the page matching a CSS selector (first 100), or the browser's own error text for an invalid one. */
export function selectorMatches(scope: any, selector: string): { total: number; matches: SelectorMatch[] } | { error: string } {
  try {
    const found: any[] = [...scope.document.querySelectorAll(selector)];
    return {
      total: found.length,
      matches: found.slice(0, 100).map((el, index) => ({
        tag: String(el.tagName).toLowerCase(),
        id: el.id || '',
        classes: typeof el.className === 'string' ? el.className : '',
        text: String(el.textContent ?? '')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 80),
        index,
      })),
    };
  } catch (error) {
    return { error: String((error as any)?.message ?? error) };
  }
}

/** The value the page's own CSS engine computes for `property: value` (units like rem and vw resolve against this page). */
export function evaluateCss(scope: any, property: string, value: string): { supported: boolean; computed: string } {
  const el = scope.document.createElement('div');
  el.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
  const supported = scope.CSS.supports(property, value);
  if (!supported) return { supported, computed: '' };
  el.style.setProperty(property, value);
  scope.document.body.append(el);
  try {
    return { supported, computed: scope.getComputedStyle(el).getPropertyValue(property) };
  } finally {
    el.remove();
  }
}
