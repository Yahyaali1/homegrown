// Gardeners in the service worker: records in IndexedDB 'hg-garden', routines on alarms 'garden:<routineId>', and one
// queue that runs one gardener run at a time (or up to 3 helper runs of one read together). The loop itself is pure (domain/garden/loop.ts); this file does each
// action, stores the result, and persists after every one, so a stopped worker resumes where it was.
import { askAs, engine, modelFor } from './engine.ts';
import { closeIfEmpty, closeLiveGroups, endRun, joinGroup, markKept, markWindow, TabClosed, type Run } from './missions.ts';
import { cookieRule, isExtensionPage } from './pagerequest.ts';
import { factsOf, GARDEN_TOOLS, gardenNotice, MODEL_CHANGED, NeedsHelp, NeedsYou, type ToolCtx } from './gardentools.ts';
import { screencast } from './devtools.ts';
import { htmlText } from './monitors.ts';
import { recipesList } from './scrape.ts';
import { handlers as memoryHandlers, addNote, confirmedEntities, deleteDocs, deleteNote, deleteNotes, listNotes, notesFor, putEntity } from './memory.ts';
import { anchorsIn } from '../domain/memory.ts';
import * as idb from './idb.ts';
import * as trust from './trust.ts';
import { can, DEFAULT_AGENT, modelById } from '../domain/model.ts';
import { answeredBy, answerFor, answerPlan, answerRefused, approveRequest, AUTO_RETRY_MS, autoRetry, digest, earlierOf, followUpRun, helpersOf, mergeHelpers, next, OPEN_REFUSED, parseEdit, PLAN_REFUSED, queuedFollowUp, recover, refusal, resumeAll, retryStep, said, stopRequest, type Ctx } from '../domain/garden/loop.ts';
import { actOf, addSeen, alwaysOk, approveAllOk, callKey, failTaints, decide, onSites, taintsAfter, recipeHosts, recipeOf, SENSITIVE_WAIT, type Known, type Verdict } from '../domain/garden/policy.ts';
import { checkFetch, claim, DEADLINE, eventCheck, expired, nextAfter, nextBatch, overdue } from '../domain/garden/schedule.ts';
import { downloadRun, ownsTab, TOOLS, toolsFor } from '../domain/garden/tools.ts';
import { hostOf } from '../domain/text.ts';
import { accept, EDIT_OFF, evidenceOf, improveThink, NEEDS, needsRefusal, parseSkill, proposalOf, revise, SKILL, skillRefusal, skillWork, slashOf, unlinked, unmet, upgradeGarden, verdict, type Skill } from '../domain/garden/skills.ts';
import { parseChat, type Chat } from '../domain/chat.ts';
import { contextChars } from '../domain/text.ts';
import { helping, mayStart, newRun, noPage, NO_PAGE, pruneIds, routineWork, randomLook, parseGardener, parseLook, parseRoutine, parseRun, parseWork, sitesOf, type Gardener, type GardenRun, type Routine, type Request, type Status, type Step, type Trigger, type Work } from '../domain/garden/records.ts';
import type { Grant } from '../domain/garden/policy.ts';
import { trimmed } from '../domain/garden/report.ts';
import { factsOf as connectorFacts } from '../domain/mcp.ts';
import { hireRecords, presetById } from '../domain/garden/presets.ts';
import { plazaDay, plazaLine, plazaThink } from '../domain/plaza.ts';
import { parseSettings } from '../domain/settings.ts';

type Sender = chrome.runtime.MessageSender | null | undefined;
const ALARM = 'garden:';
const WAKE = `${ALARM}wake`;
const KEEP_RUNS = 30;
const NEEDED_YOU = 'Needed you for too long.';
const DAY = 24 * 3_600_000;

const db = idb.open('hg-garden', 2, upgradeGarden);

// Records a newer build wrote (or broken ones) parse to null: ignored, never deleted.
const parsed = <T>(xs: unknown[], parse: (x: unknown) => T | null) => xs.map(parse).filter((x): x is T => x !== null);
const gardeners = async () => parsed(await idb.all(await db, 'gardeners'), parseGardener);
const routines = async () => parsed(await idb.all(await db, 'routines'), parseRoutine);
const allRuns = async () => parsed(await idb.all(await db, 'runs'), parseRun);
const getRun = async (id: string) => parseRun(await idb.get(await db, 'runs', id));
const skills = async () => parsed(await idb.all(await db, 'skills'), parseSkill);
const getSkill = async (id: string) => parseSkill(await idb.get(await db, 'skills', id));
/** The model gardeners use now: the chosen one, else the one loaded. */
/** A hired gardener's pack tools (an unknown pack allows none); undefined for the person's own. */
const allowedFor = (g: Gardener): string[] | undefined => (g.preset ? presetById(g.preset)?.tools ?? [] : undefined);
const gardensModel = async () => (await modelFor('gardens')) || (await engine<{ loaded: { name: string } | null }>('status')).loaded?.name || '';

// ---- progress ----

const broadcast = (run: GardenRun) => void chrome.runtime.sendMessage({ type: 'garden-run', run: trimmed(run) }).catch(() => {});

async function saveRun(run: GardenRun): Promise<void> {
  await idb.put(await db, 'runs', run);
  broadcast(run);
}

const end = (run: GardenRun, status: Status, why?: string): GardenRun => Object.assign(run, { status, endedAt: Date.now() }, why === undefined ? {} : { why });

/** A run that ended (not stopped): its oldest queued message becomes a follow-up run, saved after it. */
const followQueued = (run: GardenRun): GardenRun[] => {
  const f = queuedFollowUp(run, crypto.randomUUID(), Date.now());
  return f ? [run, f] : [run];
};

/** The newest 30 runs per gardener stay, with their helpers; queued, running and waiting runs always do. */
async function prune(gardenerId: string): Promise<void> {
  const d = await db;
  for (const id of pruneIds(parsed(await idb.all(d, 'runs', 'gardenerId', gardenerId), parseRun), KEEP_RUNS)) await idb.del(d, 'runs', id);
}

// ---- routines: alarms and claims ----

const arm = (r: Routine) => (r.paused ? chrome.alarms.clear(ALARM + r.id) : chrome.alarms.create(ALARM + r.id, { when: r.nextDue }));

interface PageSnapshot { text: string }

/**
 * A due event routine's check, before the claim (a fetch can't happen inside its transaction): the page against its
 * snapshot. None while a run of it still works, so the change waits for the next check. A failed fetch writes nothing.
 * `save` writes the new snapshot: the caller does it unless a change it found made no run (it would be lost).
 */
async function eventFor(r: Routine): Promise<{ trigger?: Trigger; save: () => Promise<unknown> } | undefined> {
  if (r.when.kind !== 'event' || r.paused || r.nextDue > Date.now()) return;
  const d = await db;
  const g = parseGardener(await idb.get(d, 'gardeners', r.gardenerId));
  const mine = parsed(await idb.all(d, 'runs', 'routineId', r.id), parseRun);
  if (!g || mine.some((x) => x.status === 'queued' || x.status === 'running' || helping(x))) return;
  // Its own key: a read of the same page keeps its snapshot of the page as read in a tab.
  const key = `${r.id}\nevent ${r.when.url}`;
  const c = await eventCheck(r.when, g.sites, (await idb.get<PageSnapshot>(d, 'snapshots', key))?.text, (u, cr) => checkFetch(u, cr).then(htmlText));
  return { ...(c.trigger && { trigger: c.trigger }), save: () => idb.put(d, 'snapshots', { text: c.text } satisfies PageSnapshot, key) };
}

/** The alarm fired (or the worker started): claim in one transaction, then re-arm, also when nothing was due. */
async function fire(routineId: string): Promise<void> {
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
    for (const id of c.fail) { const x = runs.find((y) => y.id === id)!; changed.push(...followQueued(end(x, 'failed', NEEDED_YOU))); }
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

// ---- the queue: one run at a time, oldest first; a read's helpers up to 3 at once ----

/**
 * Runs working now, by id: Stop, take over and the lock bar act on the entry of the run they name. `urls`: pages its
 * own tabs had open, which a download's referrer is matched against.
 */
const live = new Map<string, { name: string; tab: Run; run: GardenRun; borrowed: Set<number>; urls: Set<string> }>();
let draining: Promise<void> | null = null;
let dirty = false;

function drain(): void {
  dirty = true;
  draining ??= (async () => {
    await started;
    while (dirty) {
      dirty = false;
      for (let batch = await nextQueued(); batch.length; batch = await nextQueued()) await together(batch);
    }
  })().finally(() => {
    draining = null;
    if (dirty) drain();
  });
}

/** A turn that threw: the run fails in words, so the queue never picks it again. */
async function failRun(id: string, e: unknown): Promise<void> {
  console.warn('garden run failed', e);
  let f: GardenRun[] = [];
  await updateRun(id, (r) => {
    if (r.status === 'queued' || r.status === 'running') f = followQueued(end(r, 'failed', `Something went wrong: ${e instanceof Error ? e.message : String(e)}`)).slice(1);
  }).catch(() => {});
  for (const x of f) await saveRun(x);
}

/** One run, or one parent's helpers side by side in one window; their model calls still queue in the background lane. */
async function together(batch: GardenRun[]): Promise<void> {
  const parentId = batch[0]!.parentId;
  let win: number | undefined;
  if (parentId && !(await chrome.windows.getAll({ windowTypes: ['normal'] })).length) {
    win = (await chrome.windows.create({ url: 'about:blank', state: 'minimized', focused: false }))?.id;
    if (win !== undefined) await markWindow(parentId, win);
  }
  await Promise.all(batch.map((run) => turn(run, win).catch((e) => failRun(run.id, e))));
  if (win !== undefined) await closeIfEmpty(win);
}

let waking: ReturnType<typeof setTimeout> | undefined;
async function nextQueued(): Promise<GardenRun[]> {
  const now = Date.now();
  let runs = await allRuns();
  // A one-off's run past its deadline (a running one fails in next()), or a request that expired.
  for (const r of runs.filter((x) => expired(x, now) || (overdue(x, now) && !live.has(x.id)))) {
    for (const x of followQueued(end(r, 'failed', overdue(r, now) ? DEADLINE : NEEDED_YOU))) {
      await saveRun(x);
      if (x !== r) runs.push(x);
    }
  }
  // A parent whose helpers all ended: code answers its wait, and it is queued for its one think.
  let merged = false;
  for (const p of runs.filter(helping)) {
    const kids = runs.filter((r) => r.parentId === p.id);
    if (kids.every((k) => k.status === 'done' || k.status === 'failed' || k.status === 'stopped')) merged = !!(await updateRun(p.id, (r) => void mergeHelpers(r, kids, now)).catch(() => null)) || merged;
  }
  if (merged) runs = await allRuns();
  // A read waiting out its auto-retry, or a one-off's deadline: the queue wakes for it (a timer, and an alarm in case
  // the worker sleeps).
  const due = Math.min(...runs.filter((r) => r.status === 'queued' && r.retryAt! > now).map((r) => r.retryAt!),
    ...runs.filter((r) => r.deadline! > now && (r.status === 'queued' || r.status === 'waiting')).map((r) => r.deadline!));
  if (Number.isFinite(due)) {
    clearTimeout(waking);
    waking = setTimeout(drain, due - now);
    void chrome.alarms.create(WAKE, { when: due });
  }
  return nextBatch(runs, now);
}

/**
 * Pins the model and its measured abilities when the run first goes running: what the engine's useModel rule picks,
 * loaded. A routine's needs (plan T12) are checked before the work's own refusal, so a pack seed says what it lacks.
 */
async function pin(run: GardenRun, routine?: Routine): Promise<string | null> {
  if (!(run.model && run.maxTokens && run.agent)) {
    try {
      const m = await engine<{ name: string; maxTokens: number }>('resolve', { name: await modelFor('gardens') });
      const spec = modelById(m.name);
      Object.assign(run, { model: m.name, maxTokens: m.maxTokens, agent: spec?.agent ?? DEFAULT_AGENT, abilities: spec?.abilities ?? [] });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }
  return needsRefusal(routine, (a) => !!run.abilities?.includes(a)) ?? refusal(run);
}

/** What policy needs from storage, read fresh: a grant revoked or a recipe edited counts at once. */
const knownFor = async (gardenerId: string): Promise<Known> =>
  ({ grants: (await trust.grants()).filter((x) => x.gardenerId === gardenerId), recipes: (await recipesList()).map(factsOf), connectors: (await trust.connectors()).map(connectorFacts) });

/**
 * One run's turn in the queue: until it is done, failed, waiting or stopped (or queued again: a read waiting out its
 * auto-retry). `win`: the window its helpers share.
 */
async function turn(run: GardenRun, win?: number): Promise<void> {
  const stop = new AbortController();
  // Set before any await: runStop finds the run and aborts it, and a stopped turn saves nothing more.
  const tab: Run = { id: run.id, stop, ...(win !== undefined && { windowId: win }) };
  const me = { name: '', tab, run, borrowed: new Set<number>(), urls: new Set<string>() };
  live.set(run.id, me);
  let made: number | undefined; // a window this turn opened, closed when it ends
  const save = () => (stop.signal.aborted ? Promise.resolve() : saveRun(run));
  // An ended run's oldest queued message becomes a follow-up run.
  const finish = async (status: Status, why?: string) => {
    if (stop.signal.aborted) return;
    const all = followQueued(end(run, status, why));
    for (const x of all) await saveRun(x);
    if (all.length > 1) drain();
  };
  const d = await db;
  const gardener = parseGardener(await idb.get(d, 'gardeners', run.gardenerId));
  const routine = run.routineId ? parseRoutine(await idb.get(d, 'routines', run.routineId)) ?? undefined : undefined;
  const skillId = run.work.kind === 'ask' || run.work.kind === 'plan' ? run.work.skillId : undefined;
  const skill = skillId ? await getSkill(skillId) : null;
  const why = gardener ? (await pin(run, routine)) ?? skillRefusal(run, skill) : 'Its gardener was deleted.';
  if (why || !gardener) {
    live.delete(run.id);
    return await finish('failed', why ?? '');
  }
  run.status = 'running';
  run.startedAt ??= Date.now();
  delete run.retryAt;
  // Only a run still queued in the database starts: a Stop may have landed since the queue read it.
  const going = await idb.tx(d, 'runs', 'readwrite', async (t) => {
    const now = parseRun(await idb.req(t.objectStore('runs').get(run.id)));
    if (now?.status !== 'queued' || stop.signal.aborted) return false;
    // A helper whose parent no longer waits on it (stopped meanwhile) stops instead.
    if (!mayStart(now, run.parentId ? parseRun(await idb.req(t.objectStore('runs').get(run.parentId))) : null)) {
      t.objectStore('runs').put(end(now, 'stopped'));
      return false;
    }
    // A Steer message sent after the queue read the run, before it went live.
    for (const m of now.inbox ?? []) if (!run.inbox?.some((x) => x.id === m.id)) (run.inbox ??= []).push(m);
    t.objectStore('runs').put(run);
    return true;
  });
  if (!going) {
    live.delete(run.id);
    return;
  }
  broadcast(run);
  me.name = gardener.name;
  // The notes that best match the work, for its choose or word data (a mission's answer is its own; a helper makes no think).
  const query = run.work.kind === 'ask' || run.work.kind === 'plan' ? run.work.request : run.work.kind === 'read' && !run.parentId ? `${gardener.instructions}\n${run.work.urls.join('\n')}` : '';
  const notes = query ? await notesFor(gardener.id, query).catch(() => []) : [];
  // Memory the work names: `@` anchors in a request, and the routine's entity (confirmed ones only).
  const remembered = run.work.kind === 'ask' || run.work.kind === 'plan' || routine?.for ? await confirmedEntities().catch(() => []) : [];
  const anchors = run.work.kind === 'ask' || run.work.kind === 'plan' ? anchorsIn(run.work.request, remembered) : [];
  const forEntity = routine?.for ? remembered.find((e) => e.id === routine.for) : undefined;
  const before = run.followUp ? await getRun(run.followUp) : null;
  const earlier = before ? earlierOf(before) : '';
  const budget = gardener.minutes * 60_000;
  Object.assign(tab, { title: `❀ ${gardener.name}`, prepare: (t: number) => cookieRule(t, gardener.sites), deadline: Math.min(Date.now() + budget - run.usedMs, run.deadline ?? Infinity) });
  try {
    // No normal window open: one minimized window for the run's tabs, closed when its turn ends.
    if (win === undefined && !(await chrome.windows.getAll({ windowTypes: ['normal'] })).length) {
      const w = await chrome.windows.create({ url: 'about:blank', state: 'minimized', focused: false });
      if (w?.id !== undefined) await markWindow(run.id, (made = tab.windowId = w.id));
      const blank = w?.tabs?.[0]?.id;
      if (blank !== undefined) await joinGroup(tab, blank);
    }
    for (;;) {
      if (stop.signal.aborted) return;
      const known = await knownFor(gardener.id);
      const ctx: Ctx = { gardener, ...(routine && { routine }), tools: toolsFor(run, TOOLS, known.connectors, allowedFor(gardener)), now: Date.now(), ...known, ...(notes.length && { notes }), ...(earlier && { earlier, earlierTainted: !!before?.tainted }),
        ...(anchors.length && { anchors }), ...(forEntity && { forEntity }), ...(skill && { skill }) };
      const a = next(run, ctx);
      if ('think' in a) {
        // Notes are private: from the moment the model reads them, the run is tainted (stored first).
        if (a.think.taint && !run.tainted) {
          run.tainted = true;
          await save();
          if (stop.signal.aborted) return;
        }
        const t0 = Date.now();
        const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(Math.max(1, Math.min(budget - run.usedMs, (run.deadline ?? Infinity) - Date.now())))]);
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
        const c = await call(run, ctx, tab, a.call, save);
        if (c === 'wait' || c === 'later') {
          run.status = c === 'wait' ? 'waiting' : 'queued';
          return await save();
        }
      } else if ('record' in a) {
        setStep(run, a.record);
      } else if ('request' in a) {
        if (a.request.kind === 'helpers') return void (stop.signal.aborted || (await split(run, a.request)));
        const q: Request = { id: crypto.randomUUID().slice(0, 8), ...a.request };
        run.requests.push(q);
        // A skill test the person ticked "Approve plans" for: the plan's yes, which pre-approves nothing (no one read it).
        if (q.kind !== 'plan' || !run.approvePlans) {
          run.status = 'waiting';
          return await save();
        }
        const no = answerPlan(run, ctx, q, 'yes', undefined, Date.now(), true);
        if (no) return await finish('failed', no);
        run.status = 'running';
      } else if ('done' in a) {
        Object.assign(run, { answer: a.done.answer }, a.done.best ? { best: true } : {});
        return await finish('done');
      } else {
        return await finish('failed', a.fail);
      }
      await save();
    }
  } finally {
    live.delete(run.id);
    await endRun(tab);
    if (made !== undefined) await closeIfEmpty(made);
    await prune(run.gardenerId);
  }
}

/** The parent waits on its helpers, stored with them in one transaction; a helper already stored is kept. */
async function split(run: GardenRun, request: Omit<Request, 'id'>): Promise<void> {
  if (!run.requests.some((q) => q.kind === 'helpers' && !q.answer)) run.requests.push({ id: crypto.randomUUID().slice(0, 8), ...request });
  run.status = 'waiting';
  const kids = helpersOf(run, Date.now());
  const going = await idb.tx(await db, 'runs', 'readwrite', async (t) => {
    const s = t.objectStore('runs');
    if (parseRun(await idb.req(s.get(run.id)))?.status !== 'running') return false; // stopped meanwhile
    s.put(run);
    for (const k of kids) if ((await idb.req(s.getKey(k.id))) === undefined) s.put(k);
    return true;
  });
  if (going) [run, ...kids].forEach(broadcast);
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
async function call(run: GardenRun, ctx: Ctx, tab: Run, c: { i: number; tool: string; args: Record<string, unknown>; answered?: string }, save: () => Promise<void>): Promise<'wait' | 'later' | void> {
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
  // A step the person retried keeps its count; a resumed one its own.
  let tries = run.steps.find((s) => s.i === i)?.tries ?? (run.retry?.i === i ? run.retry.tries : undefined);
  setStep(run, { i, tool, args, effect, state: 'started', at: Date.now(), ...(tries && { tries }) });
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
    const go = async () => impl(args as never, { run, gardener, tab, i, db: await db, key, reach, borrow: (t) => borrow(run.id, t), ...(ok && { ok }) } satisfies ToolCtx);
    let r: Awaited<ReturnType<typeof go>>;
    try {
      r = await go();
    } catch (e) {
      // A read or search that timed out or hit a network error: once more after 30 s. The step stays started and the
      // run is queued again with `retryAt`, so the wait holds no queue slot and a restart resumes it.
      if (tab.stop.signal.aborted || !autoRetry({ i, tool, args, effect, state: 'failed', error: e instanceof Error ? e.message : String(e), at: 0, ...(tries && { tries }) })) throw e;
      setStep(run, { i, tool, args, effect, state: 'started', at: Date.now(), tries: (tries ?? 0) + 1 });
      run.retryAt = Date.now() + AUTO_RETRY_MS;
      return 'later';
    }
    setStep(run, { i, tool, args, effect, state: 'done', output: r.output, digest: digest(tool, args, { n: r.n, unit: r.unit }), at: Date.now(),
      ...(r.links && { links: r.links }), ...(r.url && { url: r.url }), ...(tries && { tries }) });
    if (r.created) run.created = [...(run.created ?? []).filter((x) => x.kind !== r.created!.kind || x.ref !== r.created!.ref), r.created];
    if (r.seen) run.seen = addSeen(run.seen, r.seen.urls, r.seen.from, r.seen.from === 'link' ? i : undefined);
    if (taintsAfter(tool, r)) run.tainted = true;
  } catch (e) {
    if (tab.stop.signal.aborted) return; // the turn ends at the top of its loop
    if (failTaints(tool, args, e instanceof Error ? e.message : String(e), gardener.sites)) run.tainted = true;
    // The person closed the tab mid-act: it may have happened, so the step stays started and next() asks.
    if (e instanceof TabClosed && effect === 'act') return;
    if (e instanceof NeedsHelp) {
      // A check for humans: the tab stays open for the person, out of the group; their answer reads it again.
      run.steps = run.steps.filter((s) => s.i !== i);
      await markKept(run.id, e.tabId);
      await chrome.tabs.ungroup(e.tabId).catch(() => {});
      await release(e.tabId);
      run.requests.push({ id: crypto.randomUUID().slice(0, 8), kind: 'help', step: i, tool, tabId: e.tabId, sensitive: false, expiresAt: Date.now() + DAY,
        text: `Help with this site: ${hostOf(String(args.url ?? ''))} asks for a check for humans. Show me opens its tab; answer Done when you’re through.` });
      return 'wait';
    }
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
    setStep(run, { i, tool, args, effect, state: 'failed', error, digest: digest(tool, args, { error }), at: Date.now(), ...(tries && { tries }) });
  } finally {
    if (keep) tab.prepare = keep;
    else delete tab.prepare;
    run.usedMs += Date.now() - t0;
  }
}

// ---- Companion Plaza: one line a day per gardener, in the background lane ----

let plazaBusy = false;
async function writePlaza(day: string): Promise<void> {
  const model = await gardensModel();
  if (!model) return;
  // History titles join only with the setting on (decision 14).
  const history = parseSettings(await chrome.storage.sync.get('plazaHistory')).plazaHistory
    ? (await memoryHandlers.memHistory({ limit: 20 })).map((x) => x.title).filter(Boolean) : null;
  const runs = await allRuns();
  const lines: Record<string, string> = {};
  for (const g of await gardeners()) {
    const notes = (await listNotes(g.id)).filter((n) => n.gardenerId === g.id).map((n) => n.text);
    const answers = runs.filter((r) => r.gardenerId === g.id && r.status === 'done' && r.answer).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)).map((r) => r.answer!);
    if (!notes.length && !answers.length) continue; // nothing of its own to say
    const t = plazaThink(g.name, { notes, answers, history });
    const line = plazaLine((await askAs(t.prompt, t.data, { task: 'gardens', model, owner: 'plaza' }).catch(() => ({ text: '' }))).text);
    if (line) lines[g.id] = line;
  }
  await chrome.storage.local.set({ plazaLines: { day, history: !!history, lines } });
}

// ---- handlers ----

/** Extension pages only: garden records and answers never come from a content script. Inside the worker: allowed. */
function page(sender: Sender): void {
  if (sender !== undefined && !isExtensionPage(sender)) throw new Error('Only Homegrown’s own pages can do that.');
}
const ready = () => started;

/** The run works in this tab right now: it is in the run's group, or one the run borrowed. */
const owned = (id: string, tab: chrome.tabs.Tab | undefined): boolean => {
  const e = live.get(id);
  return ownsTab(e && { group: e.tab.group, borrowed: e.borrowed }, tab);
};

/** act_my_tab: the person's tab is the run's for one call (lock bar, Stop, Take over); the result halts it and gives it back. */
async function borrow(runId: string, tabId: number): Promise<() => Promise<void>> {
  const e = live.get(runId);
  if (!e) throw new DOMException('Stopped', 'AbortError');
  e.borrowed.add(tabId);
  const t = await chrome.tabs.get(tabId).catch(() => undefined);
  if (t) void lock(tabId, t);
  return async () => {
    e.borrowed.delete(tabId);
    await release(tabId);
  };
}

/** The tab a run works in now: a borrowed one (act_my_tab) first, else its newest group tab. */
async function workTab(id: string): Promise<chrome.tabs.Tab | undefined> {
  for (const t of live.get(id)?.borrowed ?? []) {
    const tab = await chrome.tabs.get(t).catch(() => undefined);
    if (tab) return tab;
  }
  return newestTab(id);
}

/** The run's newest web tab in its group, if it is working in one. */
async function newestTab(id: string): Promise<chrome.tabs.Tab | undefined> {
  const g = live.get(id)?.tab.group;
  if (g === undefined) return undefined;
  return (await chrome.tabs.query({ groupId: g }).catch(() => [])).filter((x) => /^https?:/.test(x.url ?? '')).sort((a, b) => b.id! - a.id!)[0];
}

async function mustGardener(id: string): Promise<Gardener> {
  const g = parseGardener(await idb.get(await db, 'gardeners', id));
  if (!g) throw new Error('That gardener no longer exists.');
  return g;
}

/** A read's URLs must be on the gardener's sites. */
function checkWork(work: unknown, g: Gardener): Work {
  const w = parseWork(work);
  if (!w) throw new Error('This work isn’t valid: up to 25 http(s) pages, a goal of up to 300 characters, or a request of up to 1000.');
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

/** Early words for what pin() refuses: a skill that is gone, off, another gardener's, or needs what the model lacks. */
async function skillReady(w: Work, gardenerId: string, model: string): Promise<void> {
  if ((w.kind !== 'ask' && w.kind !== 'plan') || !w.skillId) return;
  const s = await getSkill(w.skillId);
  const why = skillRefusal({ ...newRun({ id: '', gardenerId, work: w, now: 0 }), abilities: modelById(model)?.abilities ?? [] }, s);
  if (why) throw new Error(why);
}

/** A skill's read-modify-write in one transaction. */
async function updateSkill(id: string, change: (s: Skill) => void): Promise<Skill> {
  return idb.tx(await db, 'skills', 'readwrite', async (t) => {
    const s = parseSkill(await idb.req(t.objectStore('skills').get(String(id))));
    if (!s) throw new Error('That skill no longer exists.');
    change(s);
    t.objectStore('skills').put(s);
    return s;
  });
}

/** The side panel's chats, for a skill's evidence. Opened per read and closed, so the worker never blocks a version change or delete. */
async function allChats(): Promise<Chat[]> {
  const d = await idb.open('hg-chat', undefined, (x, old) => void (old < 1 && x.createObjectStore('chats', { keyPath: 'id' })));
  try {
    return (await idb.all<unknown>(d, 'chats')).map(parseChat).filter((c): c is Chat => !!c);
  } finally {
    d.close();
  }
}

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
  /** Today's Plaza lines by gardener id; a stale day starts writing them (they arrive through storage). */
  async plazaLines(_: unknown, sender?: Sender) {
    page(sender);
    const day = plazaDay(new Date());
    const kept = (await chrome.storage.local.get('plazaLines')).plazaLines as { day?: string; history?: boolean; lines?: Record<string, string> } | undefined;
    // Lines written with history are dropped once plazaHistory is off (and rewritten when it changes either way).
    const history = parseSettings(await chrome.storage.sync.get('plazaHistory')).plazaHistory;
    if (kept?.day === day && !!kept.history === history) return kept.lines ?? {};
    if (!plazaBusy) {
      plazaBusy = true;
      void writePlaza(day).catch(() => {}).finally(() => (plazaBusy = false));
    }
    return {};
  },
  gardenerSave: async ({ gardener }: { gardener: Partial<Gardener> }, sender?: Sender) => {
    page(sender);
    await ready();
    const { refused } = sitesOf(Array.isArray(gardener.sites) ? gardener.sites : []);
    if (refused.length) throw new Error(`These can’t be sites: ${refused.join(', ')}`);
    // Stored looks are read leniently; a new one must be valid (never the mark's 10 petals).
    if (gardener.look !== undefined && !parseLook(gardener.look)) throw new Error('A look has 5–9, 11 or 12 petals and leans 0.3–1.');
    // A new gardener (or one from before looks) gets a flower of its own at random.
    // A hired gardener stays its pack's (its tools only narrow); only Hire sets a pack.
    const old = gardener.id ? parseGardener(await idb.get(await db, 'gardeners', gardener.id)) : null;
    const g = parseGardener({ v: 1, minutes: 10, ...gardener, preset: old?.preset, look: gardener.look ?? randomLook(), id: gardener.id || crypto.randomUUID(), createdAt: gardener.createdAt ?? Date.now() });
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
    await deleteDocs(id);
    for (const s of (await skills()).filter((x) => x.gardenerId === id)) await handlers.skillDelete({ id: s.id }, sender);
    await idb.del(await db, 'gardeners', id);
    return true;
  },
  /**
   * Hire a companion (plan T12): its gardener, its skills (off), its routines (paused) and its template files (unkept),
   * each seed's needs copied on. Sites only from the pack's suggestions the person checked.
   */
  /**
   * Hire a companion (plan T12): `hireRecords` stored, its files first and its gardener last, so a gardener means the
   * hire is whole. `hireId` (the card's) names the records: a retry rewrites them and never makes a second gardener.
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
    const work: Work = (w.kind === 'ask' || w.kind === 'plan') && w.tabs ? { ...w, tabs: w.tabs.map(({ url, title }) => ({ url, title })) } : w;
    if (routine.skillId) {
      const s = await getSkill(String(routine.skillId));
      if (!s) throw new Error('That skill no longer exists.');
      if (s.gardenerId && s.gardenerId !== g.id) throw new Error(`/${s.name} belongs to another gardener.`);
      if (w.kind !== 'ask' && w.kind !== 'plan') throw new Error('A routine with a skill asks or plans.');
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
  // Run now ({ routineId }): the routine's work and snapshots; its nextDue stays. Ask a follow-up ({ followUp, work }):
  // ask or plan work for the earlier run's gardener, whose answer starts its data.
  gardenRun: async ({ gardenerId, work, routineId, followUp }: { gardenerId?: string; work?: unknown; routineId?: string; followUp?: string }, sender?: Sender) => {
    page(sender);
    await ready();
    const d = await db;
    const routine = routineId ? parseRoutine(await idb.get(d, 'routines', routineId)) : null;
    if (routineId && !routine) throw new Error('That routine no longer exists.');
    if (routine && noPage(routine.work)) throw new Error(NO_PAGE);
    const earlier = followUp ? await getRun(String(followUp)) : null;
    if (followUp && !earlier) throw new Error('That run no longer exists.');
    if (earlier && ['queued', 'running', 'waiting'].includes(earlier.status)) throw new Error('It’s still working: queue the message instead.');
    const g = await mustGardener(earlier?.gardenerId ?? routine?.gardenerId ?? String(gardenerId ?? ''));
    const name = await gardensModel();
    if (needsRefusal(routine, (a) => can(name, a))) throw new Error(NEEDS);
    let w = checkWork(routine ? routineWork(routine) : work, g);
    if (earlier && w.kind !== 'ask' && w.kind !== 'plan') throw new Error('A follow-up is a request.');
    if (w.kind === 'ask' || w.kind === 'plan') {
      // `/name rest`: the skill's own work kind, with its id.
      const hit = !routine && !earlier ? slashOf(w.request, await skills()) : null;
      if (typeof hit === 'string') throw new Error(hit);
      if (hit) w = skillWork(hit.skill, hit.rest, w.tabs);
      await skillReady(w, g.id, name);
      if (!modelById(name)?.agent?.loop && (w.kind === 'ask' || !can(name, 'plan'))) throw new Error(w.kind === 'ask' ? OPEN_REFUSED : PLAN_REFUSED);
    }
    const run = earlier ? followUpRun(earlier, w, crypto.randomUUID(), Date.now())
      : newRun({ id: crypto.randomUUID(), gardenerId: g.id, work: w, now: Date.now(), ...(routine && { routineId: routine.id }) });
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
      // Its pages are merged into the parent only when all helpers end.
      if (r.parentId && helping(parseRun(await idb.req(t.objectStore('runs').get(r.parentId))) ?? r)) throw new Error('Its parent run still needs it.');
      t.objectStore('runs').delete(id);
    });
    return true;
  },
  // Also from a tab in the run's own group (the lock bar). Stop on a parent stops its helpers; on a helper, only it.
  runStop: async ({ id }: { id: string }, sender?: Sender) => {
    if (!owned(id, sender?.tab)) page(sender);
    await ready();
    const working = (r: GardenRun) => r.status === 'queued' || r.status === 'running' || r.status === 'waiting';
    // The parent is stopped first, so a split that commits after it refuses, and the helpers listed next are all there are.
    const stopOne = async (x: string) => {
      const e = live.get(x);
      if (e) {
        // Halted first: a step already running in a tab can't click after Stop.
        const g = e.tab.group;
        if (g !== undefined) for (const t of await chrome.tabs.query({ groupId: g }).catch(() => [])) if (t.id !== undefined) await release(t.id);
        for (const t of e.borrowed) await release(t);
        e.tab.stop.abort();
      }
      await updateRun(x, (r) => void (working(r) && end(r, 'stopped')));
    };
    await stopOne(id);
    for (const r of await allRuns()) if (r.parentId === id && working(r)) await stopOne(r.id);
    drain(); // a stopped helper may be the last its parent waited on
    return true;
  },
  /** Resume all: a parent's failed and stopped helpers run again, and the parent waits on them. */
  runResumeAll: async ({ id }: { id: string }, sender?: Sender) => {
    page(sender);
    await ready();
    const changed = await idb.tx(await db, 'runs', 'readwrite', async (t) => {
      const s = t.objectStore('runs');
      const p = parseRun(await idb.req(s.get(String(id))));
      if (!p) throw new Error('That run no longer exists.');
      const kids = parsed(await idb.req(s.index('gardenerId').getAll(p.gardenerId)), parseRun).filter((r) => r.parentId === p.id);
      const out = resumeAll(p, kids, crypto.randomUUID().slice(0, 8));
      if (typeof out === 'string') throw new Error(out);
      for (const r of out) s.put(r);
      return out;
    });
    changed.forEach(broadcast);
    drain();
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
    const e = live.get(id);
    if (ext && target === undefined) target = (await workTab(id))?.id;
    const t = typeof target === 'number' ? await chrome.tabs.get(target).catch(() => undefined) : undefined;
    if (!t || !e || !owned(id, t)) throw new Error('That tab isn’t one this gardener is working in.');
    const { tab, name } = e;
    const tid = t.id!;
    // Halted first, so a step already running there can't click; kept before the abort (also in liveGroups, for a
    // restart), so neither the call's cleanup nor start-up closes it.
    await release(tid);
    (tab.kept ??= new Set()).add(tid);
    await markKept(id, tid);
    tab.stop.abort();
    // Out of the run's group; a borrowed tab stays in the person's own.
    for (let k = 0; k < 3 && e.tab.group !== undefined && (await chrome.tabs.get(tid).catch(() => null))?.groupId === e.tab.group; k++) await chrome.tabs.ungroup(tid).catch(() => {});
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
    let help: number | undefined;
    // A plan's yes needs policy's view (gardener, grants, recipes), read before the transaction.
    const before = await getRun(runId);
    const g = before?.requests.find((x) => x.id === requestId)?.kind === 'plan' ? await mustGardener(before.gardenerId) : null;
    const known = g ? await knownFor(g.id) : {};
    await updateRun(runId, (r) => {
      const q = r.requests.find((x) => x.id === requestId);
      const now = Date.now();
      if (r.status !== 'waiting' || !q || q.answer) throw new Error('That request isn’t waiting for an answer.');
      const refused = answerRefused(q);
      if (refused) throw new Error(refused);
      if (!open(r, q, now)) throw new Error('That request has expired.');
      const values = alwaysOk(q) ? ['yes', 'no', 'always'] : ['yes', 'no'];
      if (q.kind !== 'question' && !values.includes(value)) throw new Error(values.length > 2 ? 'Answer yes, no or always.' : 'Answer yes or no.');
      // The worker's clock: a sensitive write can't be approved within 8 s of being shown.
      if (q.kind === 'approve' && q.sensitive && value !== 'no' && (q.shownAt === undefined || now - q.shownAt < SENSITIVE_WAIT)) {
        throw new Error('Read it first: this one can be approved 8 seconds after it is shown.');
      }
      if (q.kind === 'plan') {
        const why = g ? answerPlan(r, { gardener: g, tools: toolsFor(r, TOOLS, known.connectors, allowedFor(g)), now, ...known }, q, value as 'yes' | 'no', calls, now) : 'That gardener no longer exists.';
        if (why) throw new Error(why);
        return;
      }
      if (q.questions?.length && !answersOk(q.questions, value)) throw new Error('Answer the questions as one JSON object of text answers, keyed by question.');
      const edit = parseEdit(q, value, args);
      if (typeof edit === 'string') throw new Error(edit);
      if (value === 'always' && q.tool && q.host !== undefined && q.argsKey) grant = { gardenerId: r.gardenerId, tool: q.tool, host: q.host, argsKey: q.argsKey, at: now };
      if (q.kind === 'help') help = q.tabId;
      settle(r, q, value, now, edit);
    });
    if (grant) await trust.grant(grant);
    // A help request's tab was held for the person; any answer lets it go (a yes reads the page in a new tab).
    if (help !== undefined) await chrome.tabs.remove(help).catch(() => {});
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
  /**
   * `{ id, text, steer }`. Steer (true): the person's words for the run's next think. Queued (false): asked as a
   * follow-up when the run ends, oldest first; in no think before that.
   */
  runMessage: async ({ id, text, steer }: { id: string; text: string; steer: boolean }, sender?: Sender) => {
    page(sender);
    await ready();
    if (typeof steer !== 'boolean') throw new Error('A message is Steer or queued.');
    if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw new Error('A message is 1 to 1000 characters.');
    const m = { id: crypto.randomUUID().slice(0, 8), text: text.trim(), at: Date.now(), steer };
    // At most 3 unused of each kind, so the next think's instruction part still fits.
    const unused = (r: GardenRun) => (r.inbox ?? []).filter((x) => x.steer === steer && !x.usedAt).length;
    const full = steer ? 'It hasn’t read your last 3 messages yet.' : 'Three messages are already queued.';
    const now = live.get(id)?.run;
    if (now && unused(now) >= 3) throw new Error(full);
    // A working run is saved from memory after each action: the message goes there too, or the next save drops it.
    if (now) (now.inbox ??= []).push(m);
    await updateRun(String(id), (r) => {
      if (r.status !== 'queued' && r.status !== 'running' && r.status !== 'waiting') throw new Error('That run has ended.');
      if (r.inbox?.some((x) => x.id === m.id)) return;
      if (unused(r) >= 3) throw new Error(full);
      (r.inbox ??= []).push(m);
    });
    return m.id;
  },
  /** Opening a run in the Garden tab: it is no longer Unread. */
  runSeen: async ({ id }: { id: string }, sender?: Sender) => {
    page(sender);
    await ready();
    await updateRun(String(id), (r) => void (r.seenAt = Date.now()));
    return true;
  },
  /** Retry step: `{ id, step }`, an ended run of direct work runs that failed step again, then what followed it. */
  runRetry: async ({ id, step }: { id: string; step: number }, sender?: Sender) => {
    page(sender);
    await ready();
    await updateRun(String(id), (r) => {
      const why = retryStep(r, Number(step));
      if (why) throw new Error(why);
    });
    drain();
    return true;
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
  /** The tab a run works in now (its newest web tab), for "Show the tab". */
  runTab: async ({ id }: { id: string }, sender?: Sender) => {
    page(sender);
    await ready();
    const t = await workTab(String(id));
    return t ? { tabId: t.id, windowId: t.windowId } : null;
  },
  noteDelete: async ({ id }: { id: string }, sender?: Sender) => (page(sender), await deleteNote(String(id)), true),
  grantList: async ({ gardenerId }: { gardenerId?: string } = {}, sender?: Sender) => (page(sender), (await trust.grants()).filter((g) => !gardenerId || g.gardenerId === gardenerId)),
  grantRevoke: async ({ gardenerId, tool, host, argsKey }: Omit<Grant, 'at'>, sender?: Sender) => (page(sender), await trust.revoke({ gardenerId, tool, host, argsKey }), true),
  // ---- skills (plan T8): extension pages only; a model never writes a method, it only proposes ----
  /** Every skill; a test case whose run ended gets code's verdict here. */
  skillList: async (_: unknown, sender?: Sender) => {
    page(sender);
    await ready();
    const runs = new Map((await allRuns()).map((r) => [r.id, r]));
    const out: Skill[] = [];
    for (const s of await skills()) {
      const settle = s.cases.some((c) => c.runId && c.pass === undefined && verdict(c, runs.get(c.runId)) !== undefined);
      out.push(settle ? await updateSkill(s.id, (x) => x.cases.forEach((c) => {
        const v = c.runId && c.pass === undefined ? verdict(c, runs.get(c.runId)) : undefined;
        if (v !== undefined) c.pass = v;
      })) : s);
    }
    return out;
  },
  /**
   * The person's skill: new ones are theirs and on. A changed method is a new version. Who wrote it, its needs, history
   * and proposal stay the worker's; a case keeps its result while its input and expect are unchanged.
   */
  skillSave: async ({ skill }: { skill: Partial<Skill> }, sender?: Sender) => {
    page(sender);
    await ready();
    if (skill.gardenerId) await mustGardener(String(skill.gardenerId));
    const all = await skills();
    const old = skill.id ? all.find((x) => x.id === skill.id) : undefined;
    if (skill.id && !old) throw new Error('That skill no longer exists.');
    if (all.some((x) => x.name === skill.name && x.id !== skill.id)) throw new Error(`There is already a /${skill.name}.`);
    const now = Date.now();
    const cases = (Array.isArray(skill.cases) ? skill.cases : []).map(({ input, expect }) => {
      const was = old?.cases.find((c) => c.input === input && c.expect === expect);
      return { ...was, input, ...(expect?.trim() && { expect: expect.trim() }) };
    });
    const method = String(skill.method ?? '');
    const s = parseSkill({
      v: 1, version: 1, history: [{ version: 1, method, at: now, why: 'Written by you' }], by: 'person', createdAt: now, ...old,
      id: old?.id ?? crypto.randomUUID(), name: skill.name, title: skill.title, method: old?.method ?? method, files: skill.files ?? old?.files ?? [], work: skill.work ?? old?.work ?? 'plan',
      cases, on: skill.on ?? old?.on ?? true, ...(skill.gardenerId ? { gardenerId: skill.gardenerId } : { gardenerId: undefined }),
    });
    if (!s) throw new Error(`A skill needs a name (2–30 of a–z, 0–9, -), a title, a method up to ${SKILL.method} characters, at most ${SKILL.files} files of ${SKILL.file} and ${SKILL.cases} cases.`);
    if (old && method !== old.method) {
      if (!method.trim() || method.length > SKILL.method) throw new Error(`A method is 1 to ${SKILL.method} characters.`);
      revise(s, method, 'Edited by you', now);
      if (s.by === 'model') s.by = 'person'; // the person's words now
    }
    const model = s.on && s.needs?.length ? await gardensModel() : '';
    if (s.on && unmet(s, (a) => can(model, a)).length) throw new Error(NEEDS);
    await idb.put(await db, 'skills', s);
    return s;
  },
  /** Deleting a skill pauses the routines that link it. */
  skillDelete: async ({ id }: { id: string }, sender?: Sender) => {
    page(sender);
    await ready();
    for (const r of unlinked(await routines(), String(id))) {
      await idb.put(await db, 'routines', r);
      await arm(r);
    }
    await idb.del(await db, 'skills', String(id));
    return true;
  },
  skillEvidence: async ({ id }: { id: string }, sender?: Sender) => {
    page(sender);
    await ready();
    const s = await getSkill(String(id));
    if (!s) throw new Error('That skill no longer exists.');
    return evidenceOf(s, await allChats().catch(() => []), await allRuns());
  },
  /** Suggest an edit: one `improve` think, only with a model measured for skill edits. The reply is a proposal, off until accepted. */
  skillPropose: async ({ id }: { id: string }, sender?: Sender) => {
    page(sender);
    await ready();
    const s = await getSkill(String(id));
    if (!s) throw new Error('That skill no longer exists.');
    const model = await gardensModel();
    if (!can(model, 'skillEdit')) throw new Error(EDIT_OFF);
    const ev = evidenceOf(s, await allChats().catch(() => []), await allRuns());
    if (!ev.length) throw new Error('Nothing went wrong with this skill yet: there is no evidence to learn from.');
    const m = await engine<{ name: string; maxTokens: number }>('resolve', { name: model });
    const t = improveThink(s, ev, contextChars(m.maxTokens));
    const method = proposalOf((await askAs(t.prompt, t.data, { task: 'gardens', model: m.name, owner: 'garden', sampling: { temperature: 0 } })).text);
    if (!method) throw new Error('The model’s edit couldn’t be used.');
    return updateSkill(s.id, (x) => void (x.proposed = { method, why: `From ${ev.length} case${ev.length === 1 ? '' : 's'} that went wrong`, at: Date.now() }));
  },
  /** `{ id, accept }`: yes moves the proposal into the method (a new version); no drops it. */
  skillAccept: async ({ id, accept: yes }: { id: string; accept: boolean }, sender?: Sender) => {
    page(sender);
    await ready();
    return updateSkill(String(id), (s) => {
      if (!s.proposed) throw new Error('There is no proposed edit.');
      if (yes) accept(s, Date.now());
      else delete s.proposed;
    });
  },
  /**
   * Test on cases: one hand run per case, queued in order (the queue runs one at a time). `approvePlans`: each plan
   * gets a yes, which covers only non-sensitive calls. Refused for a skill that is off or whose needs the model lacks.
   */
  skillTest: async ({ id, gardenerId, approvePlans }: { id: string; gardenerId?: string; approvePlans?: boolean }, sender?: Sender) => {
    page(sender);
    await ready();
    const s = await getSkill(String(id));
    if (!s) throw new Error('That skill no longer exists.');
    if (!s.cases.length) throw new Error('Add a case to test first.');
    const g = await mustGardener(s.gardenerId ?? String(gardenerId ?? ''));
    const name = await gardensModel();
    await skillReady(skillWork(s, ''), g.id, name);
    if (!modelById(name)?.agent?.loop && (s.work === 'ask' || !can(name, 'plan'))) throw new Error(s.work === 'ask' ? OPEN_REFUSED : PLAN_REFUSED);
    const now = Date.now();
    const made = s.cases.map((c, k) => ({ ...newRun({ id: crypto.randomUUID(), gardenerId: g.id, work: skillWork(s, c.input), now: now + k }), ...(approvePlans && { approvePlans: true as const }) }));
    for (const r of made) await saveRun(r);
    await updateSkill(s.id, (x) => x.cases.forEach((c, k) => {
      delete c.pass;
      if (made[k]) c.runId = made[k]!.id;
    }));
    drain();
    return made.map((r) => r.id);
  },
  /** The person's pass or fail on a tested case without `expect`. */
  skillMark: async ({ id, k, pass }: { id: string; k: number; pass: boolean }, sender?: Sender) => {
    page(sender);
    await ready();
    return updateSkill(String(id), (s) => {
      const c = s.cases[Number(k)];
      if (!c?.runId) throw new Error('That case hasn’t run yet.');
      c.pass = !!pass;
    });
  },
};

/**
 * The lock bar, on each page a tool loads in a run's tab, from when it starts loading (a slow page is still worked
 * in). The page's script starts a moment later, so it is tried until the bar says it is up; a tab the run no longer
 * owns gets nothing.
 */
const locking = new Map<number, object>(); // one try-loop per tab: a newer load replaces it
async function lock(tabId: number, t: chrome.tabs.Tab): Promise<void> {
  const id = [...live.keys()].find((x) => owned(x, t));
  if (id === undefined || !/^https?:/.test(t.url ?? '')) return;
  const msg = { type: 'garden-lock', run: id, name: live.get(id)!.name };
  const me = {};
  locking.set(tabId, me);
  for (let k = 0; k < 30 && locking.get(tabId) === me; k++) {
    if ((await chrome.tabs.sendMessage(tabId, msg).catch(() => null)) === 'locked') break;
    await new Promise((r) => setTimeout(r, 300));
    if (!owned(id, await chrome.tabs.get(tabId).catch(() => undefined))) break;
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

/**
 * The live view ("Watch"): the run's newest tab as JPEG frames on the page's port, following it to newer tabs, until
 * the page closes the port or the run's turn ends. Frames go only to that extension page; nothing keeps them.
 */
function watch(port: chrome.runtime.Port, runId: string): void {
  if (!isExtensionPage(port.sender)) return port.disconnect();
  let on: { tabId: number; stop: Promise<(() => Promise<void>) | null> } | null = null;
  let gone = false;
  const drop = () => {
    const o = on;
    on = null;
    void o?.stop.then((s) => s?.());
  };
  const end = () => {
    gone = true;
    clearInterval(timer);
    drop();
  };
  const post = (m: object) => void (gone || port.postMessage(m));
  const tick = async () => {
    if (gone) return;
    if (!live.has(runId)) {
      post({ ended: true });
      end();
      return port.disconnect();
    }
    const t = await newestTab(runId);
    if (gone || t?.id === on?.tabId) return;
    drop();
    if (t?.id === undefined) return post({ frame: null });
    on = { tabId: t.id, stop: screencast(t.id, (frame) => post({ frame })).catch((e: unknown) => (post({ error: e instanceof Error ? e.message : String(e) }), null)) };
  };
  const timer = setInterval(() => void tick(), 1000);
  port.onDisconnect.addListener(end);
  void tick();
}

/** A download a run's tab started (its referrer is a page one had open, and no tab of the person's): kept with the run. */
async function keepDownload(d: chrome.downloads.DownloadItem): Promise<void> {
  const groups = new Set([...live.values()].flatMap((e) => (e.tab.group === undefined ? [] : [e.tab.group])));
  const person = (await chrome.tabs.query({})).filter((t) => !groups.has(t.groupId)).map((t) => t.url ?? '');
  const runId = downloadRun(d.referrer, [...live].map(([id, e]) => ({ runId: id, urls: e.urls })), person);
  if (!runId) return;
  const url = d.finalUrl || d.url;
  let name = d.filename.split(/[\\/]/).pop() ?? '';
  try {
    name ||= decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  } catch {}
  name = (name || 'download').slice(0, 200);
  const add = (r: GardenRun) => {
    if (r.files?.some((f) => f.id === d.id)) return;
    r.files = [...(r.files ?? []), { id: d.id, name, url: url.slice(0, 2000), at: Date.now() }];
    r.created = [...(r.created ?? []), { kind: 'file', title: name, ref: String(d.id) }];
  };
  // A working run is saved from memory after each action: the file goes there too.
  const e = live.get(runId);
  if (e) add(e.run);
  await updateRun(runId, add);
}
const onDownload = (d: chrome.downloads.DownloadItem) => void keepDownload(d).catch((e) => console.warn('garden download failed', e));
/** `downloads` is optional: listened to once the person allows it ("Keep downloads with runs"). */
const listenDownloads = () => {
  if (chrome.downloads && !chrome.downloads.onCreated.hasListener(onDownload)) chrome.downloads.onCreated.addListener(onDownload);
};

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
    for (const [k, r] of back.entries()) if (r !== runs[k]) for (const x of r.status === 'failed' ? followQueued(r) : [r]) await idb.put(await db, 'runs', x);
    await closeLiveGroups();
    // Time routines are claimed before the queue starts; event checks fetch pages, so they don't hold it up.
    for (const r of await routines()) {
      if (r.when.kind === 'event') void fire(r.id).then(drain, (e) => console.warn('garden claim failed', e));
      else await fire(r.id).catch((e) => console.warn('garden claim failed', e));
    }
  })().catch((e) => console.warn('garden start failed', e));
  drain();
  // `garden:wake` only wakes the queue; every other `garden:<id>` is a routine's.
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === WAKE) drain();
    else if (a.name.startsWith(ALARM)) void gardenFire(a.name.slice(ALARM.length)).catch((e) => console.warn('garden alarm failed', e));
  });
  chrome.tabs.onUpdated.addListener((tabId, info, t) => {
    if (info.status === 'loading') void lock(tabId, t);
    // The pages a run's own tabs open, for matching downloads (a borrowed tab is the person's).
    if (info.url) for (const e of live.values()) if (e.tab.group !== undefined && t.groupId === e.tab.group) e.urls.add(info.url);
  });
  chrome.runtime.onConnect.addListener((port) => void (port.name.startsWith('garden-watch:') && watch(port, port.name.slice('garden-watch:'.length))));
  listenDownloads();
  chrome.permissions.onAdded.addListener(listenDownloads);
  chrome.notifications.onClicked.addListener((id) => {
    if (!id.startsWith('garden:')) return;
    void chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html#garden') });
    void chrome.notifications.clear(id);
  });
}
