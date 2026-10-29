// What the person confirmed, kept in the worker's own IndexedDB 'hg-trust': chrome.storage.local is writable by
// content scripts, which a hostile page's renderer could control; this extension-origin database is not.
// - `confirmed`: a scheduled mission's acting steps (key: mission id, value: the steps as JSON).
// - `grants` (v2): a gardener's standing yes to one exact acting call, from an "always" answer.
import * as idb from './idb.ts';
import type { Grant } from '../domain/garden/policy.ts';

let opening: Promise<IDBDatabase> | null = null;
// A failed open isn't kept: the next call tries again.
const open = () => (opening ??= idb.open('hg-trust', 2, (d, old) => {
  if (old < 1) d.createObjectStore('confirmed');
  if (old < 2) d.createObjectStore('grants', { keyPath: ['gardenerId', 'tool', 'host', 'argsKey'] });
}).catch((e: unknown) => {
  opening = null;
  throw e;
}));

/** The steps (as JSON) the user confirmed for this mission's schedule, or undefined. */
export const confirmed = async (id: string) => idb.get<string>(await open(), 'confirmed', id);
export const confirm = async (id: string, steps: string) => void (await idb.put(await open(), 'confirmed', steps, id));
export const forget = async (id: string) => void (await idb.del(await open(), 'confirmed', id));

export const grants = async (): Promise<Grant[]> => idb.all<Grant>(await open(), 'grants');
/** Only garden.ts calls these: `grant` for an "always" answer to a request that wasn't sensitive. */
export const grant = async (g: Grant) => void (await idb.put(await open(), 'grants', g));
export const revoke = async (g: Omit<Grant, 'at'>) => void (await idb.del(await open(), 'grants', [g.gardenerId, g.tool, g.host, g.argsKey]));
