// Routines: alarms 'garden:<routineId>', each due slot claimed in one transaction (domain/garden/schedule.ts claim). An
// event routine's page check is fetched here, before the claim, and compared in code.
import { gardenNotice } from './gardentools.ts';
import * as idb from '../shared/idb.ts';
import { checkFetch } from './monitors.ts';
import { broadcast, checkWork, db, end, followQueued, gardeners, gardensModel, getSkill, mustGardener, NEEDED_YOU, page, parsed, ready, routines, type Sender } from './garden-store.ts';
import { can } from '../domain/model.ts';
import { onSites } from '../domain/garden/policy.ts';
import { busy, claim, eventTrigger, nextAfter } from '../domain/garden/schedule.ts';
import { NEEDS, needsRefusal } from '../domain/garden/skills.ts';
import { noPage, NO_PAGE, parseGardener, parseRoutine, parseRun, parseWork, requestOf, type GardenRun, type Routine, type Trigger, type Work } from '../domain/garden/records.ts';
import { hostOf } from '../domain/text.ts';

export const ALARM = 'garden:';

export const arm = (r: Routine) => (r.paused ? chrome.alarms.clear(ALARM + r.id) : chrome.alarms.create(ALARM + r.id, { when: r.nextDue }));

interface PageSnapshot { text: string }

/**
 * A due event routine's check, before the claim (a fetch can't happen inside its transaction): the page, fetched
 * signed in only on the gardener's sites, against its snapshot. None while a run of it still works, so the change
 * waits for the next check. A failed fetch writes nothing. `save` writes the new snapshot: the caller does it unless a
 * change it found made no run (it would be lost).
 */
async function eventFor(r: Routine): Promise<{ trigger?: Trigger; save: () => Promise<unknown> } | undefined> {
  if (r.when.kind !== 'event' || r.paused || r.nextDue > Date.now()) return;
  const d = await db;
  const g = parseGardener(await idb.get(d, 'gardeners', r.gardenerId));
  if (!g || parsed(await idb.all(d, 'runs', 'routineId', r.id), parseRun).some(busy)) return;
  // Its own key: a read of the same page keeps its snapshot of the page as read in a tab.
  const key = `${r.id}\nevent ${r.when.url}`;
  const signedIn = onSites(hostOf(r.when.url), g.sites);
  const text = await checkFetch(r.when.url, signedIn ? 'include' : 'omit');
  const trigger = eventTrigger(r.when, (await idb.get<PageSnapshot>(d, 'snapshots', key))?.text, text, signedIn);
  return { ...(trigger && { trigger }), save: () => idb.put(d, 'snapshots', { text } satisfies PageSnapshot, key) };
}

/** The alarm fired (or the worker started): claim in one transaction, then re-arm, also when nothing was due. */
export async function fire(routineId: string): Promise<void> {
  const before = parseRoutine(await idb.get(await db, 'routines', routineId));
  const check = before ? await eventFor(before).catch((e) => void console.warn('garden event check failed', e)) : undefined;
  const changed: GardenRun[] = [];
  let missed = false, made = false;
  const routine = await idb.tx(await db, ['routines', 'runs'], 'readwrite', async (t) => {
    const r = parseRoutine(await idb.req(t.objectStore('routines').get(routineId)));
    if (!r) return null;
    const runs = parsed(await idb.req(t.objectStore('runs').index('routineId').getAll(routineId)), parseRun);
    // The check counts only for the slot it was made for: another claim may have taken that one meanwhile.
    const c = claim(r, runs, Date.now(), r.nextDue === before?.nextDue ? check?.trigger : undefined);
    missed = !!c.missed;
    made = !!c.newRun;
    for (const id of c.fail) changed.push(...followQueued(end(runs.find((y) => y.id === id)!, 'failed', NEEDED_YOU)));
    if (c.newRun) changed.push(c.newRun);
    // A slot's run id is fixed (`routine@due`): never overwrite a run that already has it.
    if (c.newRun && (await idb.req(t.objectStore('runs').getKey(c.newRun.id))) !== undefined) changed.pop();
    for (const x of changed) t.objectStore('runs').put(x);
    if (c.routine !== r) t.objectStore('routines').put(c.routine);
    return c.routine;
  });
  changed.forEach(broadcast);
  if (check && (!check.trigger || made)) await check.save();
  if (routine) await arm(routine);
  if (routine && missed) gardenNotice((await gardeners()).find((g) => g.id === routine.gardenerId)?.name ?? 'Homegrown', `${routine.name} didn’t run: its deadline passed.`);
}

export async function deleteRoutine(id: string): Promise<void> {
  const d = await db;
  await idb.del(d, 'routines', id);
  await idb.del(d, 'snapshots', IDBKeyRange.bound(`${id}\n`, `${id}\n￿`));
  await chrome.alarms.clear(ALARM + id);
}

export const routineHandlers = {
  routineList: async ({ gardenerId }: { gardenerId?: string }, sender?: Sender) => {
    page(sender);
    await ready();
    return (await routines()).filter((r) => !gardenerId || r.gardenerId === gardenerId).map((r) => ({ ...r, next: r.nextDue }));
  },
  // Saving (and unpausing) counts the next time from now: no catch-up.
  routineSave: async ({ routine }: { routine: Partial<Routine> }, sender?: Sender) => {
    page(sender);
    await ready();
    const g = await mustGardener(String(routine.gardenerId ?? ''));
    // A pack's routine with no page yet may stay paused; it turns on only once the person sets one.
    const unset = parseWork(routine.work) === null && routine.paused === true && routine.work?.kind === 'read' && Array.isArray(routine.work.urls) && !routine.work.urls.length;
    if (!unset && routine.paused === false && routine.work?.kind === 'read' && Array.isArray(routine.work.urls) && !routine.work.urls.length) throw new Error(NO_PAGE);
    const w: Work = unset ? { kind: 'read', urls: [] } : checkWork(routine.work, g);
    // A routine finds its named tabs by URL on each run; a tab id means nothing by then.
    const req = requestOf(w);
    const work: Work = req?.tabs ? { ...req, tabs: req.tabs.map(({ url, title }) => ({ url, title })) } : w;
    if (routine.skillId) {
      const s = await getSkill(String(routine.skillId));
      if (!s) throw new Error('That skill no longer exists.');
      if (s.gardenerId && s.gardenerId !== g.id) throw new Error(`/${s.name} belongs to another gardener.`);
      if (!req) throw new Error('A routine with a skill asks or plans.');
    }
    const tz = routine.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const model = (await routines()).find((x) => x.id === routine.id)?.needs?.length ? await gardensModel() : '';
    const r = await idb.tx(await db, 'routines', 'readwrite', async (t) => {
      const old = routine.id ? parseRoutine(await idb.req(t.objectStore('routines').get(routine.id))) : null;
      const now = Date.now();
      // Its needs are the worker's (only Hire sets them).
      const r = parseRoutine({ v: 1, paused: false, ...old, ...routine, needs: old?.needs, id: routine.id || crypto.randomUUID(), tz, work, createdAt: old?.createdAt ?? now, nextDue: now });
      if (!r) throw new Error('This routine isn’t valid: it needs a name, a time and a time zone.');
      if (!r.paused && needsRefusal(r, (a) => can(model, a))) throw new Error(NEEDS);
      // An event routine's first check is now: it only sets the snapshot later checks compare with.
      r.nextDue = r.when.kind === 'event' || noPage(r.work) ? now : nextAfter(r.when, r.tz, null, now);
      if (r.when.kind === 'once' && !r.paused && r.nextDue <= now) throw new Error('That time has passed.');
      t.objectStore('routines').put(r);
      return r;
    });
    await arm(r);
    return r;
  },
  routineDelete: async ({ id }: { id: string }, sender?: Sender) => (page(sender), await ready(), await deleteRoutine(id), true),
};
