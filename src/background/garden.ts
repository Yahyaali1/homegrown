// Gardeners in the service worker: records in IndexedDB 'hg-garden', routines on alarms 'garden:<routineId>', and one
// queue that runs one gardener run at a time. The loop itself is pure (domain/garden/loop.ts); this file does each
// action, stores the result, and persists after every one, so a stopped worker resumes where it was.
import { askAs, engine, modelFor } from './engine.ts';
import { closeIfEmpty, closeLiveGroups, endRun, joinGroup, markKept, markWindow, TabClosed, type Run } from './missions.ts';
import { cookieRule, isExtensionPage } from './pagerequest.ts';
import { factsOf, GARDEN_TOOLS, MODEL_CHANGED, NeedsYou, type ToolCtx } from './gardentools.ts';
import { recipesList } from './scrape.ts';
import { addNote, deleteNote, deleteNotes, listNotes, notesFor } from './memory.ts';
import * as idb from './idb.ts';
import * as trust from './trust.ts';
import { can, DEFAULT_AGENT, modelById } from '../domain/model.ts';
import { answeredBy, answerFor, answerPlan, approveRequest, digest, next, OPEN_REFUSED, parseEdit, PLAN_REFUSED, recover, refusal, said, stopRequest, type Ctx } from '../domain/garden/loop.ts';
import { actOf, addSeen, approveAllOk, callKey, decide, onSites, recipeHosts, recipeOf, SENSITIVE_WAIT, type Known, type Verdict } from '../domain/garden/policy.ts';
import { claim, expired, nextAfter } from '../domain/garden/schedule.ts';
import { TOOLS, toolsFor } from '../domain/garden/tools.ts';
import { hostOf } from '../domain/text.ts';
import { newRun, randomLook, parseGardener, parseLook, parseRoutine, parseRun, parseWork, sitesOf, type Gardener, type GardenRun, type Routine, type Request, type Status, type Step, type Work } from '../domain/garden/records.ts';
import type { Grant } from '../domain/garden/policy.ts';

type Sender = chrome.runtime.MessageSender | null | undefined;
const ALARM = 'garden:';
const KEEP_RUNS = 30;
const NEEDED_YOU = 'Needed you; the next run starts now.';
const DAY = 24 * 3_600_000;

const db = idb.open('hg-garden', 1, (d, old) => {
  if (old >= 1) return;
  d.createObjectStore('gardeners', { keyPath: 'id' });
  d.createObjectStore('routines', { keyPath: 'id' });
  const runs = d.createObjectStore('runs', { keyPath: 'id' });
  for (const k of ['gardenerId', 'routineId', 'status']) runs.createIndex(k, k);
  d.createObjectStore('snapshots'); // `${routineId}\n${url}` → { text, prev, runId }
});

// Records a newer build wrote (or broken ones) parse to null: ignored, never deleted.
const parsed = <T>(xs: unknown[], parse: (x: unknown) => T | null) => xs.map(parse).filter((x): x is T => x !== null);
const gardeners = async () => parsed(await idb.all(await db, 'gardeners'), parseGardener);
const routines = async () => parsed(await idb.all(await db, 'routines'), parseRoutine);
const allRuns = async () => parsed(await idb.all(await db, 'runs'), parseRun);
const getRun = async (id: string) => parseRun(await idb.get(await db, 'runs', id));

// ---- progress ----

const trimmed = (r: GardenRun): GardenRun => ({ ...r, steps: r.steps.map((s) => (s.output && s.output.length > 300 ? { ...s, output: s.output.slice(0, 300) } : s)) });
const broadcast = (run: GardenRun) => void chrome.runtime.sendMessage({ type: 'garden-run', run: trimmed(run) }).catch(() => {});

async function saveRun(run: GardenRun): Promise<void> {
  await idb.put(await db, 'runs', run);
  broadcast(run);
}

const end = (run: GardenRun, status: Status, why?: string): GardenRun => Object.assign(run, { status, endedAt: Date.now() }, why === undefined ? {} : { why });

/** The newest 30 runs per gardener stay; queued, running and waiting runs always do. */
async function prune(gardenerId: string): Promise<void> {
  const d = await db;
  const mine = parsed(await idb.all(d, 'runs', 'gardenerId', gardenerId), parseRun).sort((a, b) => b.queuedAt - a.queuedAt);
  for (const r of mine.slice(KEEP_RUNS)) if (r.status === 'done' || r.status === 'failed' || r.status === 'stopped') await idb.del(d, 'runs', r.id);
}

// ---- routines: alarms and claims ----

const arm = (r: Routine) => (r.paused ? chrome.alarms.clear(ALARM + r.id) : chrome.alarms.create(ALARM + r.id, { when: r.nextDue }));

/** The alarm fired (or the worker started): claim in one transaction, then re-arm, also when nothing was due. */
async function fire(routineId: string): Promise<void> {
  const changed: GardenRun[] = [];
  const routine = await idb.tx(await db, ['routines', 'runs'], 'readwrite', async (t) => {
    const r = parseRoutine(await idb.req(t.objectStore('routines').get(routineId)));
    if (!r) return null;
    const runs = parsed(await idb.req(t.objectStore('runs').index('routineId').getAll(routineId)), parseRun);
    const c = claim(r, runs, Date.now());
    for (const id of c.fail) changed.push(end(runs.find((x) => x.id === id)!, 'failed', NEEDED_YOU));
    if (c.newRun) changed.push(c.newRun);
    // A slot's run id is fixed (`routine@due`): never overwrite a run that already has it.
    if (c.newRun && (await idb.req(t.objectStore('runs').getKey(c.newRun.id))) !== undefined) changed.pop();
    for (const x of changed) t.objectStore('runs').put(x);
    if (c.routine !== r) t.objectStore('routines').put(c.routine);
    return c.routine;
  });
  changed.forEach(broadcast);
  if (routine) await arm(routine);
}

// ---- the queue: one run at a time, oldest first ----

let live: { id: string; name: string; tab: Run; run: GardenRun } | null = null;
let draining: Promise<void> | null = null;
let dirty = false;

function drain(): void {
  dirty = true;
  draining ??= (async () => {
    await started;
    while (dirty) {
      dirty = false;
      for (let run = await nextQueued(); run; run = await nextQueued()) await turn(run).catch((e) => failRun(run.id, e));
    }
  })().finally(() => {
    draining = null;
    if (dirty) drain();
  });
}

/** A turn that threw: the run fails in words, so the queue never picks it again. */
async function failRun(id: string, e: unknown): Promise<void> {
  console.warn('garden run failed', e);
  await updateRun(id, (r) => {
    if (r.status === 'queued' || r.status === 'running') end(r, 'failed', `Something went wrong: ${e instanceof Error ? e.message : String(e)}`);
  }).catch(() => {});
}

async function nextQueued(): Promise<GardenRun | undefined> {
  const now = Date.now(), runs = await allRuns();
  for (const r of runs.filter((x) => expired(x, now))) await saveRun(end(r, 'failed', NEEDED_YOU));
  return runs.filter((r) => r.status === 'queued').sort((a, b) => a.queuedAt - b.queuedAt)[0];
}

/** Pins the model and its measured abilities when the run first goes running: what the engine's useModel rule picks, loaded. */
async function pin(run: GardenRun): Promise<string | null> {
  if (!(run.model && run.maxTokens && run.agent)) {
    try {
      const m = await engine<{ name: string; maxTokens: number }>('resolve', { name: await modelFor('gardens') });
      const spec = modelById(m.name);
      Object.assign(run, { model: m.name, maxTokens: m.maxTokens, agent: spec?.agent ?? DEFAULT_AGENT, abilities: spec?.abilities ?? [] });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }
  return refusal(run);
}

/** What policy needs from storage, read fresh: a grant revoked or a recipe edited counts at once. */
const knownFor = async (gardenerId: string): Promise<Known> =>
  ({ grants: (await trust.grants()).filter((x) => x.gardenerId === gardenerId), recipes: (await recipesList()).map(factsOf) });

/** One run's turn in the queue: until it is done, failed, waiting or stopped. */
async function turn(run: GardenRun): Promise<void> {
  const stop = new AbortController();
  // Set before any await: runStop finds the run and aborts it, and a stopped turn saves nothing more.
  const tab: Run = { id: run.id, stop };
  live = { id: run.id, name: '', tab, run };
  const save = () => (stop.signal.aborted ? Promise.resolve() : saveRun(run));
  const finish = (status: Status, why?: string) => (stop.signal.aborted ? undefined : saveRun(end(run, status, why)));
  const d = await db;
  const gardener = parseGardener(await idb.get(d, 'gardeners', run.gardenerId));
  const routine = run.routineId ? parseRoutine(await idb.get(d, 'routines', run.routineId)) ?? undefined : undefined;
  const why = gardener ? await pin(run) : 'Its gardener was deleted.';
  if (why || !gardener) {
    live = null;
    return await finish('failed', why ?? '');
  }
  run.status = 'running';
  run.startedAt ??= Date.now();
  // Only a run still queued in the database starts: a Stop may have landed since the queue read it.
  const going = await idb.tx(d, 'runs', 'readwrite', async (t) => {
    const now = parseRun(await idb.req(t.objectStore('runs').get(run.id)));
    if (now?.status !== 'queued' || stop.signal.aborted) return false;
    // A Steer message sent after the queue read the run, before it went live.
    for (const m of now.inbox ?? []) if (!run.inbox?.some((x) => x.id === m.id)) (run.inbox ??= []).push(m);
    t.objectStore('runs').put(run);
    return true;
  });
  if (!going) {
    live = null;
    return;
  }
  broadcast(run);
  live.name = gardener.name;
  // The notes that best match the work, for its choose or word data (a mission's answer is its own: none).
  const query = run.work.kind === 'ask' || run.work.kind === 'plan' ? run.work.request : run.work.kind === 'read' ? `${gardener.instructions}\n${run.work.urls.join('\n')}` : '';
  const notes = query ? await notesFor(gardener.id, query).catch(() => []) : [];
  const budget = gardener.minutes * 60_000;
  Object.assign(tab, { title: `❀ ${gardener.name}`, prepare: (t: number) => cookieRule(t, gardener.sites), deadline: Date.now() + budget - run.usedMs });
  try {
    // No normal window open: one minimized window for the run's tabs, closed when its turn ends.
    if (!(await chrome.windows.getAll({ windowTypes: ['normal'] })).length) {
      const w = await chrome.windows.create({ url: 'about:blank', state: 'minimized', focused: false });
      if (w?.id !== undefined) await markWindow(run.id, (tab.windowId = w.id));
      const blank = w?.tabs?.[0]?.id;
      if (blank !== undefined) await joinGroup(tab, blank);
    }
    for (;;) {
      if (stop.signal.aborted) return;
      const known = await knownFor(gardener.id);
      const ctx: Ctx = { gardener, ...(routine && { routine }), tools: toolsFor(run), now: Date.now(), ...known, ...(notes.length && { notes }) };
      const a = next(run, ctx);
      if ('think' in a) {
        // Notes are private: from the moment the model reads them, the run is tainted (stored first).
        if (a.think.taint && !run.tainted) {
          run.tainted = true;
          await save();
          if (stop.signal.aborted) return;
        }
        const t0 = Date.now();
        const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(Math.max(1, budget - run.usedMs))]);
        let r: { text: string; model: string } | null = null;
        let error = '';
        try {
          r = await askAs(a.think.prompt, a.think.data, { task: 'gardens', model: run.model!, owner: 'garden', signal, sampling: a.think.sampling ?? {} });
        } catch (e) {
          if (stop.signal.aborted) return;
          if (!signal.aborted) error = e instanceof Error ? e.message : String(e);
        }
        // Out of time (the signal's timeout): next() ends the run with what it has.
        run.usedMs = signal.aborted ? Math.max(budget, run.usedMs) : run.usedMs + Date.now() - t0;
        if (error || (r && r.model !== run.model)) return await finish('failed', error || MODEL_CHANGED);
        if (r) {
          run.turns.push({ purpose: a.think.purpose, reply: r.text, at: Date.now() });
          for (const m of run.inbox ?? []) if (a.think.steer?.includes(m.id)) m.usedAt = Date.now();
        }
      } else if ('call' in a) {
        if ((await call(run, ctx, tab, a.call, save)) === 'wait') {
          run.status = 'waiting';
          return await save();
        }
      } else if ('record' in a) {
        setStep(run, a.record);
      } else if ('request' in a) {
        run.requests.push({ id: crypto.randomUUID().slice(0, 8), ...a.request });
        run.status = 'waiting';
        return await save();
      } else if ('done' in a) {
        Object.assign(run, { answer: a.done.answer }, a.done.best ? { best: true } : {});
        return await finish('done');
      } else {
        return await finish('failed', a.fail);
      }
      await save();
    }
  } finally {
    live = null;
    await endRun(tab);
    if (tab.windowId !== undefined) await closeIfEmpty(tab.windowId);
    await prune(run.gardenerId);
  }
}

function setStep(run: GardenRun, step: Step): void {
  const k = run.steps.findIndex((s) => s.i === step.i);
  if (k < 0) run.steps.push(step);
  else run.steps[k] = step;
}

/**
 * One tool call: policy first (unless the person answered exactly this call, or the action names its answer), stored
 * as started, then run. 'wait': the page showed an acting step to be sensitive, and the person was asked.
 */
async function call(run: GardenRun, ctx: Ctx, tab: Run, c: { i: number; tool: string; args: Record<string, unknown>; answered?: string }, save: () => Promise<void>): Promise<'wait' | void> {
  const { i, tool, args } = c;
  const { gardener } = ctx;
  const act = actOf({ tool, args }, ctx);
  const effect = act ? 'act' : TOOLS.find((t) => t.name === tool)?.effect ?? 'act';
  const key = callKey({ tool, args }, ctx);
  // An edited call's answer is found by id, not by key, so it can't be missed and the call dropped.
  const q = c.answered ? answeredBy(run, c.answered) : answerFor(run, i, tool, key);
  const impl = GARDEN_TOOLS[tool];
  let verdict: Verdict = c.answered ? (q ? 'allow' : 'deny') : q && !q.fromPlan ? (said(q) ? 'allow' : 'deny') : decide(run, gardener, { tool, args }, ctx);
  // A plan's yes counts only where policy asks and the call isn't sensitive now (as in next()).
  if (verdict === 'ask' && q?.fromPlan && approveRequest(run, ctx, i, tool, args)?.sensitive === false) verdict = 'allow';
  // A resumed call that now needs the person: drop its started step, and next() asks them as for a new call.
  if (impl && verdict === 'ask') return void (run.steps = run.steps.filter((s) => s.i !== i));
  if (!impl || verdict !== 'allow') {
    const error = 'Not allowed.';
    return setStep(run, { i, tool, args, effect, state: 'failed', error, digest: digest(tool, args, { error }), at: Date.now() });
  }
  setStep(run, { i, tool, args, effect, state: 'started', at: Date.now() });
  // Awaited on its own before the call: an act never runs without its started record, so a stop mid-act asks
  // "did this happen?" instead of acting twice.
  await save();
  if (tab.stop.signal.aborted) return;
  // A tainted run's tab can't load pages off the gardener's sites and this call's own hosts: no redirect carries
  // data out. ponytail: search and mission tabs keep the plain rule; under taint they run only after a yes.
  const recipe = recipeOf({ tool, args }, ctx);
  const hosts = act ? act.hosts : recipe ? recipeHosts(recipe) : tool === 'read_page' ? [hostOf(String(args.url))] : null;
  const keep = tab.prepare;
  if (run.tainted && hosts) tab.prepare = (t) => cookieRule(t, gardener.sites, [...gardener.sites, ...hosts.filter(Boolean)]);
  const t0 = Date.now();
  try {
    // A sensitive yes covers its reason (and its one stopped step) only; any other sensitive step asks again. An
    // edited yes covers no reason of the original's: the edit is a new call.
    const ok = q?.sensitive && said(q) && q.why && !q.answer?.args ? { why: q.why, ...(q.index !== undefined && { index: q.index }) } : undefined;
    const reach = (url: string) => decide(run, gardener, { tool: 'read_page', args: { url } }) === 'allow';
    const r = await impl(args as never, { run, gardener, tab, i, db: await db, key, reach, ...(ok && { ok }) } satisfies ToolCtx);
    setStep(run, { i, tool, args, effect, state: 'done', output: r.output, digest: digest(tool, args, { n: r.n, unit: r.unit }), at: Date.now(),
      ...(r.links && { links: r.links }), ...(r.url && { url: r.url }) });
    if (r.seen) run.seen = addSeen(run.seen, r.seen.urls, r.seen.from, r.seen.from === 'link' ? i : undefined);
    if (r.taint) run.tainted = true;
  } catch (e) {
    if (tab.stop.signal.aborted) return; // the turn ends at the top of its loop
    // The person closed the tab mid-act: it may have happened, so the step stays started and next() asks.
    if (e instanceof TabClosed && effect === 'act') return;
    if (e instanceof NeedsYou) {
      // Stopped on a sensitive step before any act ran: ask about that step, in place.
      run.steps = run.steps.filter((s) => s.i !== i);
      const request = stopRequest(run, ctx, i, tool, args, e.stop, q);
      if (request) {
        run.requests.push({ id: crypto.randomUUID().slice(0, 8), ...request });
        return 'wait';
      }
    }
    const error = e instanceof Error ? e.message : String(e);
    setStep(run, { i, tool, args, effect, state: 'failed', error, digest: digest(tool, args, { error }), at: Date.now() });
  } finally {
    if (keep) tab.prepare = keep;
    else delete tab.prepare;
    run.usedMs += Date.now() - t0;
  }
}

// ---- handlers ----

/** Extension pages only: garden records and answers never come from a content script. Inside the worker: allowed. */
function page(sender: Sender): void {
  if (sender !== undefined && !isExtensionPage(sender)) throw new Error('Only Homegrown’s own pages can do that.');
}
const ready = () => started;

/** The tab is in the live run's group: the run works in it right now. */
const owned = (id: string, tab: chrome.tabs.Tab | undefined): boolean =>
  !!tab && live?.id === id && live.tab.group !== undefined && tab.groupId === live.tab.group;

async function mustGardener(id: string): Promise<Gardener> {
  const g = parseGardener(await idb.get(await db, 'gardeners', id));
  if (!g) throw new Error('That gardener no longer exists.');
  return g;
}

/** A read's URLs must be on the gardener's sites. */
function checkWork(work: unknown, g: Gardener): Work {
  const w = parseWork(work);
  if (!w) throw new Error('This work isn’t valid: up to 5 http(s) pages, a goal of up to 300 characters, or a request of up to 1000.');
  const off = w.kind === 'read' ? w.urls.filter((u) => !onSites(hostOf(u), g.sites)) : [];
  if (off.length) throw new Error(`Not on ${g.name}’s sites: ${off.join(', ')}`);
  return w;
}

async function deleteRoutine(id: string): Promise<void> {
  const d = await db;
  await idb.del(d, 'routines', id);
  await idb.del(d, 'snapshots', IDBKeyRange.bound(`${id}\n`, `${id}\n￿`));
  await chrome.alarms.clear(ALARM + id);
}

/** The person's answer, stored; a yes to opening a page makes that exact URL reachable from now on. */
function settle(r: GardenRun, q: Request, value: string, now: number, edit: { args?: Record<string, unknown> } = {}): void {
  q.answer = { value, at: now, ...edit };
  const url = q.tool === 'read_page' && q.argsKey && value === 'yes' ? (JSON.parse(q.argsKey) as { url?: unknown }).url : undefined;
  if (typeof url === 'string') r.seen = addSeen(r.seen, [url], 'approved');
  r.status = 'queued';
}

/** One JSON object of text answers, keyed only by the questions asked. */
function answersOk(questions: { q: string }[], value: string): boolean {
  try {
    const a = JSON.parse(value) as unknown;
    return !!a && typeof a === 'object' && !Array.isArray(a) && Object.entries(a).every(([k, v]) => typeof v === 'string' && questions.some((x) => x.q === k));
  } catch {
    return false;
  }
}

const open = (r: GardenRun, q: Request | undefined, now: number): q is Request =>
  r.status === 'waiting' && !!q && !q.answer && !expired(r, now) && (q.expiresAt === undefined || q.expiresAt > now);

async function updateRun(id: string, change: (r: GardenRun) => void): Promise<GardenRun> {
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

export const handlers = {
  gardenerList: async (_: unknown, sender?: Sender) => (page(sender), await ready(), gardeners()),
  gardenerSave: async ({ gardener }: { gardener: Partial<Gardener> }, sender?: Sender) => {
    page(sender);
    await ready();
    const { refused } = sitesOf(Array.isArray(gardener.sites) ? gardener.sites : []);
    if (refused.length) throw new Error(`These can’t be sites: ${refused.join(', ')}`);
    // Stored looks are read leniently; a new one must be valid (never the mark's 10 petals).
    if (gardener.look !== undefined && !parseLook(gardener.look)) throw new Error('A look has 5–9, 11 or 12 petals and leans 0.3–1.');
    // A new gardener (or one from before looks) gets a flower of its own at random.
    const g = parseGardener({ v: 1, minutes: 10, ...gardener, look: gardener.look ?? randomLook(), id: gardener.id || crypto.randomUUID(), createdAt: gardener.createdAt ?? Date.now() });
    if (!g) throw new Error('A gardener needs a name (up to 40 characters), instructions up to 2000, at most 20 sites and 1–60 minutes.');
    await idb.put(await db, 'gardeners', g);
    return g;
  },
  gardenerDelete: async ({ id }: { id: string }, sender?: Sender) => {
    page(sender);
    await ready();
    for (const r of (await routines()).filter((x) => x.gardenerId === id)) await deleteRoutine(r.id);
    // Its runs stop first, so none takes a note after its notes are gone.
    for (const r of (await allRuns()).filter((x) => x.gardenerId === id && (x.status === 'queued' || x.status === 'running' || x.status === 'waiting'))) await handlers.runStop({ id: r.id }, sender);
    await deleteNotes(id);
    await idb.del(await db, 'gardeners', id);
    return true;
  },
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
    const w = checkWork(routine.work, g);
    // A routine finds its named tabs by URL on each run; a tab id means nothing by then.
    const work: Work = (w.kind === 'ask' || w.kind === 'plan') && w.tabs ? { ...w, tabs: w.tabs.map(({ url, title }) => ({ url, title })) } : w;
    const tz = routine.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const r = await idb.tx(await db, 'routines', 'readwrite', async (t) => {
      const old = routine.id ? parseRoutine(await idb.req(t.objectStore('routines').get(routine.id))) : null;
      const now = Date.now();
      const r = parseRoutine({ v: 1, paused: false, ...old, ...routine, id: routine.id || crypto.randomUUID(), tz, work, createdAt: old?.createdAt ?? now, nextDue: now });
      if (!r) throw new Error('This routine isn’t valid: it needs a name, a time and a time zone.');
      r.nextDue = nextAfter(r.when, r.tz, null, now);
      t.objectStore('routines').put(r);
      return r;
    });
    await arm(r);
    return r;
  },
  routineDelete: async ({ id }: { id: string }, sender?: Sender) => (page(sender), await ready(), await deleteRoutine(id), true),
  // Run now ({ routineId }): the routine's work and snapshots; its nextDue stays.
  gardenRun: async ({ gardenerId, work, routineId }: { gardenerId?: string; work?: unknown; routineId?: string }, sender?: Sender) => {
    page(sender);
    await ready();
    const d = await db;
    const routine = routineId ? parseRoutine(await idb.get(d, 'routines', routineId)) : null;
    if (routineId && !routine) throw new Error('That routine no longer exists.');
    const g = await mustGardener(routine?.gardenerId ?? String(gardenerId ?? ''));
    const w = checkWork(routine?.work ?? work, g);
    if (w.kind === 'ask' || w.kind === 'plan') {
      const name = (await modelFor('gardens')) || (await engine<{ loaded: { name: string } | null }>('status')).loaded?.name || '';
      if (!modelById(name)?.agent?.loop && (w.kind === 'ask' || !can(name, 'plan'))) throw new Error(w.kind === 'ask' ? OPEN_REFUSED : PLAN_REFUSED);
    }
    const run = newRun({ id: crypto.randomUUID(), gardenerId: g.id, work: w, now: Date.now(), ...(routine && { routineId: routine.id }) });
    await saveRun(run);
    if (routine) {
      await idb.tx(d, 'routines', 'readwrite', async (t) => {
        const now = parseRoutine(await idb.req(t.objectStore('routines').get(routine.id)));
        if (now) t.objectStore('routines').put({ ...now, lastRunId: run.id });
      });
    }
    drain();
    return { id: run.id };
  },
  runList: async ({ gardenerId, limit = KEEP_RUNS }: { gardenerId?: string; limit?: number }, sender?: Sender) => {
    page(sender);
    await ready();
    return (await allRuns()).filter((r) => !gardenerId || r.gardenerId === gardenerId).sort((a, b) => b.queuedAt - a.queuedAt).slice(0, limit).map(trimmed);
  },
  runGet: async ({ id }: { id: string }, sender?: Sender) => (page(sender), await ready(), getRun(id)),
  runDelete: async ({ id }: { id: string }, sender?: Sender) => {
    page(sender);
    await ready();
    await idb.tx(await db, 'runs', 'readwrite', async (t) => {
      const r = parseRun(await idb.req(t.objectStore('runs').get(id)));
      if (!r) throw new Error('That run no longer exists.');
      if (r.status !== 'done' && r.status !== 'failed' && r.status !== 'stopped') throw new Error('Stop the run before deleting it.');
      t.objectStore('runs').delete(id);
    });
    return true;
  },
  // Also from a tab in the run's own group (the lock bar).
  runStop: async ({ id }: { id: string }, sender?: Sender) => {
    if (!owned(id, sender?.tab)) page(sender);
    await ready();
    if (live?.id === id) {
      // Halted first: a step already running in a tab can't click after Stop.
      const g = live.tab.group;
      if (g !== undefined) for (const t of await chrome.tabs.query({ groupId: g }).catch(() => [])) if (t.id !== undefined) await release(t.id);
      live.tab.stop.abort();
    }
    await updateRun(id, (r) => {
      if (r.status === 'queued' || r.status === 'running' || r.status === 'waiting') end(r, 'stopped');
    });
    return true;
  },
  /**
   * Take over: from the lock bar in a tab the run works in now, or from an extension page naming that tab (or none:
   * the run's newest web tab, for the Garden tab's own Take over, which a page can't hide). The tab is halted, the
   * call aborted, the tab leaves the run (out of its group, kept from every cleanup) and comes to the front, and the
   * run waits for the person to hand back.
   */
  runTakeover: async ({ id, tabId }: { id: string; tabId?: number }, sender?: Sender) => {
    const ext = sender === undefined || isExtensionPage(sender);
    let target = ext ? tabId : sender?.tab?.id;
    if (ext && target === undefined && live?.id === id && live.tab.group !== undefined) {
      target = (await chrome.tabs.query({ groupId: live.tab.group })).filter((x) => /^https?:/.test(x.url ?? '')).sort((a, b) => b.id! - a.id!)[0]?.id;
    }
    const t = typeof target === 'number' ? await chrome.tabs.get(target).catch(() => undefined) : undefined;
    if (!t || !owned(id, t) || !live) throw new Error('That tab isn’t one this gardener is working in.');
    const { tab, name } = live;
    const tid = t.id!;
    // Halted first, so a step already running there can't click; kept before the abort (also in liveGroups, for a
    // restart), so neither the call's cleanup nor start-up closes it.
    await release(tid);
    (tab.kept ??= new Set()).add(tid);
    await markKept(id, tid);
    tab.stop.abort();
    for (let k = 0; k < 3 && (await chrome.tabs.get(tid).catch(() => null))?.groupId !== -1; k++) await chrome.tabs.ungroup(tid).catch(() => {});
    if (tab.windowId !== undefined && t.windowId === tab.windowId) await chrome.windows.create({ tabId: tid, focused: true });
    else {
      await chrome.tabs.update(tid, { active: true });
      await chrome.windows.update(t.windowId, { focused: true });
    }
    await updateRun(id, (r) => {
      if (r.status !== 'running' && r.status !== 'waiting') return;
      r.requests.push({ id: crypto.randomUUID().slice(0, 8), kind: 'takeover', ...(r.steps.length && { step: r.steps.at(-1)!.i }), tabId: tid,
        text: `You took over from ${name}. Hand back when you’re done.`, sensitive: false, expiresAt: Date.now() + DAY });
      r.status = 'waiting';
    });
    return true;
  },
  requestShown: async ({ runId, requestId }: { runId: string; requestId: string }, sender?: Sender) => {
    page(sender);
    await ready();
    await updateRun(runId, (r) => {
      const q = r.requests.find((x) => x.id === requestId);
      if (q && q.shownAt === undefined) q.shownAt = Date.now();
    });
    return true;
  },
  /**
   * `{ runId, requestId, value, calls?, args? }`: a plan's yes may carry the calls as the person edited them; an
   * approve's yes may carry the call's args as edited (only yes: a grant would be the original call).
   */
  requestAnswer: async ({ runId, requestId, value, calls, args }: { runId: string; requestId: string; value: string; calls?: unknown; args?: unknown }, sender?: Sender) => {
    page(sender);
    await ready();
    if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw new Error('The answer is empty or too long.');
    let grant: Grant | null = null;
    // A plan's yes needs policy's view (gardener, grants, recipes), read before the transaction.
    const before = await getRun(runId);
    const g = before?.requests.find((x) => x.id === requestId)?.kind === 'plan' ? await mustGardener(before.gardenerId) : null;
    const known = g ? await knownFor(g.id) : {};
    await updateRun(runId, (r) => {
      const q = r.requests.find((x) => x.id === requestId);
      const now = Date.now();
      if (r.status !== 'waiting' || !q || q.answer) throw new Error('That request isn’t waiting for an answer.');
      if (!open(r, q, now)) throw new Error('That request has expired.');
      const values = q.kind === 'approve' && !q.sensitive ? ['yes', 'no', 'always'] : ['yes', 'no'];
      if (q.kind !== 'question' && !values.includes(value)) throw new Error(values.length > 2 ? 'Answer yes, no or always.' : 'Answer yes or no.');
      // The worker's clock: a sensitive write can't be approved within 8 s of being shown.
      if (q.kind === 'approve' && q.sensitive && value !== 'no' && (q.shownAt === undefined || now - q.shownAt < SENSITIVE_WAIT)) {
        throw new Error('Read it first: this one can be approved 8 seconds after it is shown.');
      }
      if (q.kind === 'plan') {
        const why = g ? answerPlan(r, { gardener: g, tools: toolsFor(r), now, ...known }, q, value as 'yes' | 'no', calls, now) : 'That gardener no longer exists.';
        if (why) throw new Error(why);
        return;
      }
      if (q.questions?.length && !answersOk(q.questions, value)) throw new Error('Answer the questions as one JSON object of text answers, keyed by question.');
      const edit = parseEdit(q, value, args);
      if (typeof edit === 'string') throw new Error(edit);
      if (value === 'always' && q.tool && q.host !== undefined && q.argsKey) grant = { gardenerId: r.gardenerId, tool: q.tool, host: q.host, argsKey: q.argsKey, at: now };
      settle(r, q, value, now, edit);
    });
    if (grant) await trust.grant(grant);
    drain();
    return true;
  },
  /** Approve all: yes to each named request that `approveAllOk` allows, checked here again; the rest are left. */
  requestAnswerAll: async ({ requests }: { requests: { runId: string; requestId: string }[] }, sender?: Sender) => {
    page(sender);
    await ready();
    let n = 0;
    for (const { runId, requestId } of Array.isArray(requests) ? requests : []) {
      await updateRun(String(runId), (r) => {
        const q = r.requests.find((x) => x.id === requestId);
        const now = Date.now();
        if (open(r, q, now) && approveAllOk(q, r)) (settle(r, q, 'yes', now), n++);
      }).catch(() => {});
    }
    if (n) drain();
    return n;
  },
  /** Steer: `{ id, text, steer: true }`, the person's words for the run's next think. */
  runMessage: async ({ id, text, steer }: { id: string; text: string; steer: boolean }, sender?: Sender) => {
    page(sender);
    await ready();
    if (steer !== true) throw new Error('Only Steer messages can be sent for now.');
    if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw new Error('A message is 1 to 1000 characters.');
    const m = { id: crypto.randomUUID().slice(0, 8), text: text.trim(), at: Date.now(), steer: true };
    // At most 3 unused, so the next think's instruction part still fits.
    const unused = (r: GardenRun) => (r.inbox ?? []).filter((x) => x.steer && !x.usedAt).length;
    if (live?.id === id && unused(live.run) >= 3) throw new Error('It hasn’t read your last 3 messages yet.');
    // A working run is saved from memory after each action: the message goes there too, or the next save drops it.
    if (live?.id === id) (live.run.inbox ??= []).push(m);
    await updateRun(String(id), (r) => {
      if (r.status !== 'queued' && r.status !== 'running' && r.status !== 'waiting') throw new Error('That run has ended.');
      if (r.inbox?.some((x) => x.id === m.id)) return;
      if (unused(r) >= 3) throw new Error('It hasn’t read your last 3 messages yet.');
      (r.inbox ??= []).push(m);
    });
    return m.id;
  },
  // The notebook: private, so extension pages only. A note belongs to a gardener that exists, or to every gardener.
  noteList: async ({ gardenerId }: { gardenerId?: string } = {}, sender?: Sender) => (page(sender), listNotes(gardenerId)),
  noteSave: async ({ note }: { note: { gardenerId?: string; text: string } }, sender?: Sender) => {
    page(sender);
    await ready();
    if (note.gardenerId) await mustGardener(note.gardenerId);
    const { vec: _, ...n } = await addNote({ ...(note.gardenerId && { gardenerId: note.gardenerId }), text: String(note.text ?? ''), by: 'person' });
    return n;
  },
  noteDelete: async ({ id }: { id: string }, sender?: Sender) => (page(sender), await deleteNote(String(id)), true),
  grantList: async ({ gardenerId }: { gardenerId?: string } = {}, sender?: Sender) => (page(sender), (await trust.grants()).filter((g) => !gardenerId || g.gardenerId === gardenerId)),
  grantRevoke: async ({ gardenerId, tool, host, argsKey }: Omit<Grant, 'at'>, sender?: Sender) => (page(sender), await trust.revoke({ gardenerId, tool, host, argsKey }), true),
};

/**
 * The lock bar, on each page a tool loads in a run's tab, from when it starts loading (a slow page is still worked
 * in). The page's script starts a moment later, so it is tried until the bar says it is up; a tab the run no longer
 * owns gets nothing.
 */
const locking = new Map<number, object>(); // one try-loop per tab: a newer load replaces it
async function lock(tabId: number, t: chrome.tabs.Tab): Promise<void> {
  if (!live || !owned(live.id, t) || !/^https?:/.test(t.url ?? '')) return;
  const msg = { type: 'garden-lock', run: live.id, name: live.name };
  const me = {};
  locking.set(tabId, me);
  for (let k = 0; k < 30 && locking.get(tabId) === me; k++) {
    if ((await chrome.tabs.sendMessage(tabId, msg).catch(() => null)) === 'locked') break;
    await new Promise((r) => setTimeout(r, 300));
    if (!live || live.id !== msg.run || !owned(live.id, await chrome.tabs.get(tabId).catch(() => undefined))) break;
  }
  if (locking.get(tabId) === me) locking.delete(tabId);
}

/**
 * The person has the tab now: every frame's step runner is halted (the flag lives in the content scripts' isolated
 * world, where `__hgStep` checks it before each click or fill), and the bar is told to go.
 */
async function release(tabId: number): Promise<void> {
  locking.delete(tabId);
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => void (window.__hgHalt = true) }).catch(() => {});
  await chrome.tabs.sendMessage(tabId, { type: 'garden-unlock' }).catch(() => {});
}

/** Test hook (on self): the routine's claim, as if its alarm fired. */
export async function gardenFire(routineId: string): Promise<void> {
  await started;
  await fire(routineId);
  drain();
}

// Worker start, once: runs the old worker left running go back to the queue, its engine requests are cancelled, its
// tabs and windows closed, then every routine's alarm is re-armed and due ones are claimed.
let started: Promise<void> = Promise.resolve();

export function init(): void {
  started = (async () => {
    const now = Date.now();
    // Only an engine that outlived the old worker can hold its requests; don't start one just to ask.
    if (await chrome.offscreen.hasDocument().catch(() => false)) await engine('cancelOwner', { owner: 'garden', before: now }).catch(() => {});
    const runs = await allRuns();
    const back = recover(runs, now);
    for (const [k, r] of back.entries()) if (r !== runs[k]) await idb.put(await db, 'runs', r);
    await closeLiveGroups();
    for (const r of await routines()) await fire(r.id).catch((e) => console.warn('garden claim failed', e));
  })().catch((e) => console.warn('garden start failed', e));
  drain();
  chrome.alarms.onAlarm.addListener((a) => a.name.startsWith(ALARM) && void gardenFire(a.name.slice(ALARM.length)).catch((e) => console.warn('garden alarm failed', e)));
  chrome.tabs.onUpdated.addListener((tabId, info, t) => void (info.status === 'loading' && lock(tabId, t)));
  chrome.notifications.onClicked.addListener((id) => {
    if (!id.startsWith('garden:')) return;
    void chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html#garden') });
    void chrome.notifications.clear(id);
  });
}
