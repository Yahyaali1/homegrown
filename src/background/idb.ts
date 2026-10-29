// A small IndexedDB helper for the worker's own databases (out of content scripts' reach, unlike chrome.storage).

/** Opens `name` at `version`; `upgrade` gets the old version, so each step runs once. */
export function open(name: string, version: number, upgrade: (db: IDBDatabase, oldVersion: number) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, version);
    r.onupgradeneeded = (e) => upgrade(r.result, e.oldVersion);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const req = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => ((r.onsuccess = () => resolve(r.result)), (r.onerror = () => reject(r.error))));

/**
 * One transaction: `body` may await requests on it (and nothing else, or it commits early). Resolves with the
 * body's result once committed; a throw aborts it.
 */
export function tx<T>(db: IDBDatabase, stores: string | string[], mode: IDBTransactionMode, body: (t: IDBTransaction) => Promise<T>): Promise<T> {
  const t = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = t.onabort = () => reject(t.error ?? new Error('Transaction aborted'));
  });
  return body(t).then(async (v) => (await done, v), (e) => {
    try { t.abort(); } catch {} // already finished
    throw e;
  });
}

export const get = <T>(db: IDBDatabase, store: string, key: IDBValidKey) => tx(db, store, 'readonly', (t) => req(t.objectStore(store).get(key) as IDBRequest<T | undefined>));
export const put = (db: IDBDatabase, store: string, value: unknown, key?: IDBValidKey) => tx(db, store, 'readwrite', (t) => req(t.objectStore(store).put(value, key)));
export const del = (db: IDBDatabase, store: string, key: IDBValidKey | IDBKeyRange) => tx(db, store, 'readwrite', (t) => req(t.objectStore(store).delete(key)));
/** Every value in a store, or those under `index` matching `query`. */
export const all = <T>(db: IDBDatabase, store: string, index?: string, query?: IDBValidKey | IDBKeyRange) =>
  tx(db, store, 'readonly', (t) => {
    const s = t.objectStore(store);
    return req((index ? s.index(index) : s).getAll(query) as IDBRequest<T[]>);
  });
