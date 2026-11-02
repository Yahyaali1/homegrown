// The queue: one gardener run at a time, oldest first, or up to 3 helper runs of one read together. The loop itself is
// pure (domain/garden/loop.ts); this file does each action, stores the result, and persists after every one, so a
// stopped worker resumes where it was.
import { askAs, engine, modelFor } from './engine.ts';
import { closeIfEmpty, endRun, joinGroup, markKept, TabClosed, type Run } from './missions.ts';
import { cookieRule } from './pagerequest.ts';
import { factsOf, GARDEN_TOOLS, MODEL_CHANGED, NeedsHelp, NeedsYou, type ToolCtx } from './gardentools.ts';
import { recipesList } from './scrape.ts';
import * as trust from './trust.ts';
import { confirmedEntities, notesFor } from './memory.ts';
import * as idb from '../shared/idb.ts';
import { allRuns, broadcast, DAY, db, end, followQueued, getRun, getSkill, NEEDED_YOU, prune, ready, saveRun, updateRun } from './garden-store.ts';
import { borrow, live, release, spareWindow } from './garden-tabs.ts';
import { anchorsIn } from '../domain/memory.ts';
import { DEFAULT_AGENT, modelById } from '../domain/model.ts';
import { AUTO_RETRY_MS, autoApprovePlan, autoRetry, approveRequest, digest, earlierOf, effectOf, failedStep, helpersOf, mergeHelpers, next, refusal, verdictFor, type Action, type Ctx } from '../domain/garden/loop.ts';
import { actOf, addSeen, callKey, decide, recipeHosts, recipeOf, taintsAfter, type Effect, type Known } from '../domain/garden/policy.ts';
import { presetById } from '../domain/garden/presets.ts';
import { TOOLS, toolsFor } from '../domain/garden/tools.ts';
import { factsOf as connectorFacts } from '../domain/mcp.ts';
import { DEADLINE, expired, nextBatch, overdue } from '../domain/garden/schedule.ts';
import { needsRefusal, skillRefusal } from '../domain/garden/skills.ts';
import { helping, isEnded, mayStart, parseGardener, parseRoutine, parseRun, requestOf, type Gardener, type GardenRun, type Request, type Routine, type Status, type Step } from '../domain/garden/records.ts';
import { hostOf } from '../domain/text.ts';

type CallAction = Extract<Action, { call: unknown }>['call'];

/** The alarm that only wakes the queue (a read's auto-retry, a one-off's deadline); never a routine's. */
export const WAKE = 'garden:wake';

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

let draining: Promise<void> | null = null;
let dirty = false;

export function drain(): void {
  dirty = true;
  draining ??= (async () => {
    await ready();
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
  const win = parentId ? (await spareWindow(parentId))?.id : undefined;
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
    if (kids.every(isEnded)) merged = !!(await updateRun(p.id, (r) => void mergeHelpers(r, kids, now)).catch(() => null)) || merged;
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
 * loaded. A routine's needs are checked before the work's own refusal, so a pack seed says what it lacks.
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

/** What a run's thinks read beyond the run itself: its routine, skill, notes, memory and earlier run. */
async function extrasFor(run: GardenRun, gardener: Gardener, routine: Routine | undefined, skill: Ctx['skill'] | null): Promise<Partial<Ctx>> {
  const request = requestOf(run.work);
  // The notes that best match the work, for its choose or word data (a mission's answer is its own; a helper makes no think).
  const query = request ? request.request : run.work.kind === 'read' && !run.parentId ? `${gardener.instructions}\n${run.work.urls.join('\n')}` : '';
  const notes = query ? await notesFor(gardener.id, query).catch(() => []) : [];
  // Memory the work names: `@` anchors in a request, and the routine's entity (confirmed ones only).
  const remembered = request || routine?.for ? await confirmedEntities().catch(() => []) : [];
  const anchors = request ? anchorsIn(request.request, remembered) : [];
  const forEntity = routine?.for ? remembered.find((e) => e.id === routine.for) : undefined;
  const before = run.followUp ? await getRun(run.followUp) : null;
  return { ...(routine && { routine }), ...(skill && { skill }), ...(notes.length && { notes }), ...(before && { earlier: earlierOf(before), earlierTainted: before.tainted }),
    ...(anchors.length && { anchors }), ...(forEntity && { forEntity }) };
}

/** Only a run still queued in the database starts (a Stop may have landed since the queue read it); stored running. */
async function goLive(run: GardenRun, signal: AbortSignal): Promise<boolean> {
  run.status = 'running';
  run.startedAt ??= Date.now();
  delete run.retryAt;
  return idb.tx(await db, 'runs', 'readwrite', async (t) => {
    const now = parseRun(await idb.req(t.objectStore('runs').get(run.id)));
    if (now?.status !== 'queued' || signal.aborted) return false;
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
}

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
  const finish = async (status: Status, why?: string) => {
    if (stop.signal.aborted) return;
    const all = followQueued(end(run, status, why));
    for (const x of all) await saveRun(x);
    if (all.length > 1) drain();
  };
  const d = await db;
  const gardener = parseGardener(await idb.get(d, 'gardeners', run.gardenerId));
  const routine = run.routineId ? parseRoutine(await idb.get(d, 'routines', run.routineId)) ?? undefined : undefined;
  const skillId = requestOf(run.work)?.skillId;
  const skill = skillId ? await getSkill(skillId) : null;
  const why = gardener ? (await pin(run, routine)) ?? skillRefusal(run, skill) : 'Its gardener was deleted.';
  if (why || !gardener || !(await goLive(run, stop.signal))) {
    live.delete(run.id);
    return why || !gardener ? await finish('failed', why ?? '') : undefined;
  }
  broadcast(run);
  me.name = gardener.name;
  const extra = await extrasFor(run, gardener, routine, skill);
  const budget = gardener.minutes * 60_000;
  Object.assign(tab, { title: `❀ ${gardener.name}`, prepare: (t: number) => cookieRule(t, gardener.sites), deadline: Math.min(Date.now() + budget - run.usedMs, run.deadline ?? Infinity) });
  try {
    if (win === undefined) {
      const w = await spareWindow(run.id);
      if (w?.id !== undefined) made = tab.windowId = w.id;
      const blank = w?.tabs?.[0]?.id;
      if (blank !== undefined) await joinGroup(tab, blank);
    }
    for (;;) {
      if (stop.signal.aborted) return;
      const ctx = await ctxFor(run, gardener, extra);
      const r = await step(run, ctx, next(run, ctx), tab, budget, save);
      if (r === 'split') return;
      if (typeof r === 'object') return await finish(r.end, r.why);
      if (r) {
        run.status = r;
        return await save();
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

/** Does action `a`. Nothing: the turn goes on. A status: the run waits or is queued again. `end`: the run ends. */
async function step(run: GardenRun, ctx: Ctx, a: Action, tab: Run, budget: number, save: () => Promise<void>): Promise<'waiting' | 'queued' | 'split' | { end: Status; why?: string } | void> {
  if ('think' in a) {
    const failed = await think(run, a.think, tab.stop.signal, budget, save);
    return failed ? { end: 'failed', why: failed } : undefined;
  }
  if ('call' in a) {
    const c = await call(run, ctx, tab, a.call, save);
    return c === 'wait' ? 'waiting' : c === 'later' ? 'queued' : undefined;
  }
  if ('record' in a) return setStep(run, a.record);
  if ('done' in a) {
    Object.assign(run, { answer: a.done.answer }, a.done.best ? { best: true } : {});
    return { end: 'done' };
  }
  if ('fail' in a) return { end: 'failed', why: a.fail };
  if (a.request.kind === 'helpers') {
    if (!tab.stop.signal.aborted) await split(run, a.request);
    return 'split';
  }
  const q: Request = { id: crypto.randomUUID().slice(0, 8), ...a.request };
  run.requests.push(q);
  // A skill test the person ticked "Approve plans" for: the plan's yes, which pre-approves nothing (no one read it).
  if (q.kind !== 'plan' || !run.approvePlans) return 'waiting';
  const no = autoApprovePlan(run, ctx, q, Date.now());
  if (no) return { end: 'failed', why: no };
  run.status = 'running';
}

/** A think on the run's pinned model, its reply stored as a turn; why the run fails, if it does. Out of time: next() ends it. */
async function think(run: GardenRun, t: Extract<Action, { think: unknown }>['think'], stop: AbortSignal, budget: number, save: () => Promise<void>): Promise<string | undefined> {
  // Notes are private: from the moment the model reads them, the run is tainted (stored first).
  if (t.taint && !run.tainted) {
    run.tainted = true;
    await save();
    if (stop.aborted) return;
  }
  const t0 = Date.now();
  const signal = AbortSignal.any([stop, AbortSignal.timeout(Math.max(1, Math.min(budget - run.usedMs, (run.deadline ?? Infinity) - Date.now())))]);
  let r: { text: string; model: string } | null = null;
  let error = '';
  try {
    r = await askAs(t.prompt, t.data, { task: 'gardens', model: run.model!, owner: 'garden', signal, sampling: t.sampling ?? {} });
  } catch (e) {
    if (stop.aborted) return;
    if (!signal.aborted) error = e instanceof Error ? e.message : String(e);
  }
  run.usedMs = signal.aborted ? Math.max(budget, run.usedMs) : run.usedMs + Date.now() - t0;
  if (error || (r && r.model !== run.model)) return error || MODEL_CHANGED;
  if (r) {
    run.turns.push({ purpose: t.purpose, reply: r.text, at: Date.now() });
    for (const m of run.inbox ?? []) if (t.steer?.includes(m.id)) m.usedAt = Date.now();
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
 * One tool call: its verdict checked again now, stored as started, then run. 'wait': the person was asked (the page
 * showed an acting step to be sensitive, or asked for a check for humans); 'later': a read waits out its auto-retry.
 */
async function call(run: GardenRun, ctx: Ctx, tab: Run, c: CallAction, save: () => Promise<void>): Promise<'wait' | 'later' | void> {
  const { i, tool, args } = c;
  const { gardener } = ctx;
  const effect = effectOf(c, ctx);
  const impl = GARDEN_TOOLS[tool];
  const { v, q } = verdictFor(run, ctx, i, c);
  // A resumed call that now needs the person: drop its started step, and next() asks them as for a new call.
  if (impl && v === 'ask') return void (run.steps = run.steps.filter((s) => s.i !== i));
  if (!impl || v !== 'allow') return setStep(run, failedStep(i, c, effect, 'Not allowed.', Date.now()));
  // A step the person retried keeps its count; a resumed one its own.
  const tries = run.steps.find((s) => s.i === i)?.tries ?? (run.retry?.i === i ? run.retry.tries : undefined);
  setStep(run, { i, tool, args, effect, state: 'started', at: Date.now(), ...(tries && { tries }) });
  // Awaited on its own before the call: an act never runs without its started record, so a stop mid-act asks
  // "did this happen?" instead of acting twice.
  await save();
  if (tab.stop.signal.aborted) return;
  // A tainted run's tab can't load pages off the gardener's sites and this call's own hosts: no redirect carries
  // data out. ponytail: search and mission tabs keep the plain rule; under taint they run only after a yes.
  const act = actOf(c, ctx);
  const recipe = recipeOf(c, ctx);
  const hosts = act ? act.hosts : recipe ? recipeHosts(recipe) : tool === 'read_page' ? [hostOf(String(args.url))] : null;
  const keep = tab.prepare;
  if (run.tainted && hosts) tab.prepare = (t) => cookieRule(t, gardener.sites, [...gardener.sites, ...hosts.filter(Boolean)]);
  const t0 = Date.now();
  try {
    // A sensitive yes covers its reason (and its one stopped step) only; any other sensitive step asks again. An
    // edited yes covers no reason of the original's: the edit is a new call.
    const ok = q?.sensitive && q.why && !q.answer?.args ? { why: q.why, ...(q.index !== undefined && { index: q.index }) } : undefined;
    const reach = (url: string) => decide(run, gardener, { tool: 'read_page', args: { url } }) === 'allow';
    const go = async () => impl(args as never, { run, gardener, tab, i, db: await db, key: callKey(c, ctx), reach, borrow: (t) => borrow(run.id, t), ...(ok && { ok }) } satisfies ToolCtx);
    let r: Awaited<ReturnType<typeof go>>;
    try {
      r = await go();
    } catch (e) {
      // A read or search that timed out or hit a network error: once more after 30 s. The step stays started and the
      // run is queued again with `retryAt`, so the wait holds no queue slot and a restart resumes it.
      if (tab.stop.signal.aborted || !autoRetry(failedStep(i, c, effect, e instanceof Error ? e.message : String(e), 0, tries))) throw e;
      setStep(run, { i, tool, args, effect, state: 'started', at: Date.now(), tries: (tries ?? 0) + 1 });
      run.retryAt = Date.now() + AUTO_RETRY_MS;
      return 'later';
    }
    setStep(run, { i, tool, args, effect, state: 'done', output: r.output, digest: digest(tool, args, { n: r.n, unit: r.unit }), at: Date.now(),
      ...(r.links && { links: r.links }), ...(r.url && { url: r.url }), ...(tries && { tries }) });
    if (r.created) run.created = [...(run.created ?? []).filter((x) => x.kind !== r.created!.kind || x.ref !== r.created!.ref), r.created];
    if (r.seen) run.seen = addSeen(run.seen, r.seen.urls, r.seen.from, r.seen.from === 'link' ? i : undefined);
    if (taintsAfter(tool, r, args, gardener.sites)) run.tainted = true;
  } catch (e) {
    if (tab.stop.signal.aborted) return; // the turn ends at the top of its loop
    return await onCallError(run, ctx, c, e, effect, q, tries);
  } finally {
    if (keep) tab.prepare = keep;
    else delete tab.prepare;
    run.usedMs += Date.now() - t0;
  }
}

/** A call that threw: the run tainted if the error left the sites; 'wait' when the person is asked; else its step as it ended. */
async function onCallError(run: GardenRun, ctx: Ctx, c: CallAction, e: unknown, effect: Effect, q: Request | undefined, tries: number | undefined): Promise<'wait' | void> {
  const { i, tool, args } = c;
  if (taintsAfter(tool, { url: (e as { url?: string }).url }, args, ctx.gardener.sites)) run.tainted = true;
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
    const request = approveRequest(run, ctx, i, tool, args, e.stop, q);
    if (request) {
      run.requests.push({ id: crypto.randomUUID().slice(0, 8), ...request });
      return 'wait';
    }
  }
  setStep(run, failedStep(i, c, effect, e instanceof Error ? e.message : String(e), Date.now(), tries));
}
