// Confirmations for unattended runs (a scheduled mission's steps that act), kept in the worker's own IndexedDB:
// chrome.storage.local is writable by content scripts, which a hostile page's renderer could control; this
// extension-origin database is not.
const db = () => new Promise<IDBDatabase>((resolve, reject) => {
  const r = indexedDB.open('hg-trust', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('confirmed');
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then((d) => new Promise<T>((resolve, reject) => {
    const req = run(d.transaction('confirmed', mode).objectStore('confirmed'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

/** The steps (as JSON) the user confirmed for this mission's schedule, or undefined. */
export const confirmed = (id: string) => tx<string | undefined>('readonly', (s) => s.get(id) as IDBRequest<string | undefined>);
export const confirm = (id: string, steps: string) => tx('readwrite', (s) => s.put(steps, id)).then(() => {});
export const forget = (id: string) => tx('readwrite', (s) => s.delete(id)).then(() => {});
