// IndexedDB on the extension origin. Store layout is versioned by DB_VERSION (upgrade steps
// below); record contents carry their own schemaVersion and are validated on every read.
const DB_NAME = 'betterdevtools';
const DB_VERSION = 1;

export type StoreName = 'workspaces' | 'replays' | 'kv';

let opening: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 1) {
        db.createObjectStore('workspaces', { keyPath: 'id' });
        db.createObjectStore('replays', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('kv');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // another panel upgrading the schema: step aside and reopen on next use
      db.onversionchange = () => {
        db.close();
        opening = undefined;
      };
      resolve(db);
    };
    req.onerror = () => {
      opening = undefined; // a failed open is retried on next use instead of being cached
      reject(req.error ?? new Error('IndexedDB open failed'));
    };
  });
  return opening;
}

function run<T>(store: StoreName, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = op(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = tx.onabort = () => reject(tx.error ?? req.error ?? new Error('IndexedDB transaction failed'));
      }),
  );
}

export const db = {
  all: (store: StoreName) => run<unknown[]>(store, 'readonly', (s) => s.getAll()),
  get: (store: StoreName, key: IDBValidKey) => run<unknown>(store, 'readonly', (s) => s.get(key)),
  put: (store: StoreName, value: unknown, key?: IDBValidKey) => run(store, 'readwrite', (s) => s.put(value, key)),
  delete: (store: StoreName, key: IDBValidKey) => run(store, 'readwrite', (s) => s.delete(key)),
  /** Keeps only the newest `keep` records of an auto-increment store. */
  trim: (store: StoreName, keep: number) =>
    run(store, 'readwrite', (s) => {
      const req = s.getAllKeys();
      req.onsuccess = () => {
        const keys = req.result;
        const last = keys[keys.length - keep - 1];
        if (last !== undefined) s.delete(IDBKeyRange.upperBound(last));
      };
      return req;
    }),
};
