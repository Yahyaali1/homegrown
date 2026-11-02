// Hire a companion: its gardener, its skills (off), its routines (paused) and its template files (unkept).
import * as idb from '../shared/idb.ts';
import { putEntity } from './memory.ts';
import { db, page, ready, skills, type Sender } from './garden-store.ts';
import { hireRecords, presetById } from '../domain/garden/presets.ts';
import { parseGardener } from '../domain/garden/records.ts';

export const hireHandlers = {
  /**
   * `hireRecords` stored, its files first and its gardener last, so a gardener means the hire is whole. Sites only
   * from the pack's suggestions the person checked. `hireId` (the card's) names the records: a retry rewrites them
   * and never makes a second gardener.
   */
  hire: async ({ presetId, sites = [], hireId }: { presetId: string; sites?: string[]; hireId?: string }, sender?: Sender) => {
    page(sender);
    await ready();
    const p = presetById(String(presetId));
    if (!p) throw new Error('No companion is called that.');
    const hid = typeof hireId === 'string' && /^[\w-]{8,64}$/.test(hireId) ? hireId : crypto.randomUUID();
    const d = await db;
    const done = parseGardener(await idb.get(d, 'gardeners', hid));
    if (done) return done;
    let k = 0;
    const made = hireRecords(p, { sites: Array.isArray(sites) ? sites : [], taken: (await skills()).filter((x) => x.gardenerId !== hid).map((x) => x.name),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone, now: Date.now(), id: () => (k++ ? `${hid}.${k}` : hid) });
    if (!made) throw new Error('That companion couldn’t be hired.');
    for (const x of made.entities) await putEntity(x);
    for (const x of made.skills) await idb.put(d, 'skills', x);
    for (const x of made.routines) await idb.put(d, 'routines', x);
    await idb.put(d, 'gardeners', made.gardener);
    return made.gardener;
  },
};
