// The gardens' records in IndexedDB 'hg-garden'. A record a newer build wrote (or a broken one) parses to null: ignored,
// never deleted. Every run saved is broadcast to the extension pages.
import { engine, modelFor } from './engine.ts';
import { factsOf } from './gardentools.ts';
import * as idb from '../shared/idb.ts';
import { isExtensionPage } from './pagerequest.ts';
import { recipesList } from './scrape.ts';
import * as trust from './trust.ts';
import { queuedFollowUp, type Ctx } from '../domain/garden/loop.ts';
import { onSites, type Known } from '../domain/garden/policy.ts';
import { presetById } from '../domain/garden/presets.ts';
import { parseGardener, parseRoutine, parseRun, parseWork, pruneIds, type Gardener, type GardenRun, type Status, type Work } from '../domain/garden/records.ts';
import { trimmed } from '../domain/garden/report.ts';
import { parseSkill, upgradeGarden, type Skill } from '../domain/garden/skills.ts';
import { TOOLS, toolsFor } from '../domain/garden/tools.ts';
import { factsOf as connectorFacts } from '../domain/mcp.ts';
import { hostOf } from '../domain/text.ts';

export type Sender = chrome.runtime.MessageSender | null | undefined;
export const DAY = 24 * 3_600_000;
export const KEEP_RUNS = 30;
export const NEEDED_YOU = 'Needed you for too long.';

export const db = idb.open('hg-garden', 2, upgradeGarden);

export const parsed = <T>(xs: unknown[], parse: (x: unknown) => T | null) => xs.map(parse).filter((x): x is T => x !== null);
export const gardeners = async () => parsed(await idb.all(await db, 'gardeners'), parseGardener);
export const routines = async () => parsed(await idb.all(await db, 'routines'), parseRoutine);
export const allRuns = async () => parsed(await idb.all(await db, 'runs'), parseRun);
export const getRun = async (id: string) => parseRun(await idb.get(await db, 'runs', id));
export const skills = async () => parsed(await idb.all(await db, 'skills'), parseSkill);
export const getSkill = async (id: string) => parseSkill(await idb.get(await db, 'skills', id));

/** Worker start: set once by init; handlers wait for it. */
export let started: Promise<void> = Promise.resolve();
export const setStarted = (p: Promise<void>) => void (started = p);
export const ready = () => started;

/** Extension pages only: garden records and answers never come from a content script. Inside the worker: allowed. */
export function page(sender: Sender): void {
  if (sender !== undefined && !isExtensionPage(sender)) throw new Error('Only Homegrown’s own pages can do that.');
}

export async function mustGardener(id: string): Promise<Gardener> {
  const g = parseGardener(await idb.get(await db, 'gardeners', id));
  if (!g) throw new Error('That gardener no longer exists.');
  return g;
}

/** A read's URLs must be on the gardener's sites. */
export function checkWork(work: unknown, g: Gardener): Work {
  const w = parseWork(work);
  if (!w) throw new Error('This work isn’t valid: up to 25 http(s) pages, a goal of up to 300 characters, or a request of up to 1000.');
  const off = w.kind === 'read' ? w.urls.filter((u) => !onSites(hostOf(u), g.sites)) : [];
  if (off.length) throw new Error(`Not on ${g.name}’s sites: ${off.join(', ')}`);
  return w;
}

/** A hired gardener's pack tools (an unknown pack allows none); undefined for the person's own. */
const allowedFor = (g: Gardener): string[] | undefined => (g.preset ? presetById(g.preset)?.tools ?? [] : undefined);
/** The model gardeners use now: the chosen one, else the one loaded. */
export const gardensModel = async () => (await modelFor('gardens')) || (await engine<{ loaded: { name: string } | null }>('status')).loaded?.name || '';

/** What policy needs from storage, read fresh: a grant revoked or a recipe edited counts at once. */
const knownFor = async (gardenerId: string): Promise<Known> =>
  ({ grants: (await trust.grants()).filter((x) => x.gardenerId === gardenerId), recipes: (await recipesList()).map(factsOf), connectors: (await trust.connectors()).map(connectorFacts) });

/** The loop's view of `run` now: its gardener, the tools offered to it, and what policy knows. */
export async function ctxFor(run: GardenRun, gardener: Gardener, extra: Partial<Ctx> = {}): Promise<Ctx> {
  const known = await knownFor(gardener.id);
  return { gardener, ...extra, tools: toolsFor(run, TOOLS, known.connectors, allowedFor(gardener)), now: Date.now(), ...known };
}

export const broadcast = (run: GardenRun) => void chrome.runtime.sendMessage({ type: 'garden-run', run: trimmed(run) }).catch(() => {});

export async function saveRun(run: GardenRun): Promise<void> {
  await idb.put(await db, 'runs', run);
  broadcast(run);
}

/** A run's read-modify-write in one transaction. */
export async function updateRun(id: string, change: (r: GardenRun) => void): Promise<GardenRun> {
  const run = await idb.tx(await db, 'runs', 'readwrite', async (t) => {
    const r = parseRun(await idb.req(t.objectStore('runs').get(id)));
    if (!r) throw new Error('That run no longer exists.');
    change(r);
    t.objectStore('runs').put(r);
    return r;
  });
  broadcast(run);
  return run;
}

/** A skill's read-modify-write in one transaction. */
export async function updateSkill(id: string, change: (s: Skill) => void): Promise<Skill> {
  return idb.tx(await db, 'skills', 'readwrite', async (t) => {
    const s = parseSkill(await idb.req(t.objectStore('skills').get(String(id))));
    if (!s) throw new Error('That skill no longer exists.');
    change(s);
    t.objectStore('skills').put(s);
    return s;
  });
}

export const end = (run: GardenRun, status: Status, why?: string): GardenRun => Object.assign(run, { status, endedAt: Date.now() }, why === undefined ? {} : { why });

/** A run that ended (not stopped): its oldest queued message becomes a follow-up run, saved after it. */
export const followQueued = (run: GardenRun): GardenRun[] => {
  const f = queuedFollowUp(run, crypto.randomUUID(), Date.now());
  return f ? [run, f] : [run];
};

/** The newest 30 runs per gardener stay, with their helpers; queued, running and waiting runs always do. */
export async function prune(gardenerId: string): Promise<void> {
  const d = await db;
  for (const id of pruneIds(parsed(await idb.all(d, 'runs', 'gardenerId', gardenerId), parseRun), KEEP_RUNS)) await idb.del(d, 'runs', id);
}
