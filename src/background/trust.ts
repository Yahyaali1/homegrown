// What the person confirmed, kept in the worker's own IndexedDB 'hg-trust': chrome.storage.local is writable by
// content scripts, which a hostile page's renderer could control; this extension-origin database is not.
// - `confirmed`: a scheduled mission's acting steps (key: mission id, value: the steps as JSON).
// - `grants` (v2): a gardener's standing yes to one exact acting call, from an "always" answer.
// - `connectors` (v3): remote MCP servers the person connected, with their token (ADR-17). The token leaves this store
//   only as the bearer header to that server's URL.
// An `app_call` grant also keeps its `connector` id, so deleting a connector finds its grants without parsing them.
import * as idb from '../shared/idb.ts';
import type { Grant } from '../domain/garden/policy.ts';
import { parseConnector, type Connector } from '../domain/mcp.ts';

let opening: Promise<IDBDatabase> | null = null;
// A failed open isn't kept: the next call tries again.
const open = () => (opening ??= idb.open('hg-trust', 3, (d, old) => {
  if (old < 1) d.createObjectStore('confirmed');
  if (old < 2) d.createObjectStore('grants', { keyPath: ['gardenerId', 'tool', 'host', 'argsKey'] });
  if (old < 3) d.createObjectStore('connectors', { keyPath: 'id' });
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
export const grant = async (g: Grant) => void (await idb.put(await open(), 'grants', g.tool === 'app_call' ? { ...g, connector: connectorOf(g) } : g));
export const revoke = async (g: Omit<Grant, 'at'>) => void (await idb.del(await open(), 'grants', [g.gardenerId, g.tool, g.host, g.argsKey]));

/** Connectors as stored (with tokens): only mcp.ts and the app_call tool read these. A record this build can't read is left alone. */
export const connectors = async (): Promise<Connector[]> => (await idb.all<unknown>(await open(), 'connectors')).map(parseConnector).filter((c): c is Connector => !!c);
export const connectorPut = async (c: Connector) => void (await idb.put(await open(), 'connectors', c));
type AppGrant = Grant & { connector?: unknown };
/** The connector an `app_call` grant calls: kept on it, or (a grant from before it was kept) read from its args. */
function connectorOf(g: AppGrant): unknown {
  if (g.connector !== undefined) return g.connector;
  try {
    return (JSON.parse(g.argsKey) as { connector?: unknown }).connector;
  } catch {
    return undefined;
  }
}

/** Deletes a connector and every grant to call it. */
export async function connectorDelete(id: string): Promise<void> {
  await idb.del(await open(), 'connectors', id);
  for (const g of await grants()) if (g.tool === 'app_call' && connectorOf(g) === id) await revoke(g);
}
