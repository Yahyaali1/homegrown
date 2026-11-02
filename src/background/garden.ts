// Gardeners in the service worker: their records and runs (garden-store.ts), routines on alarms (garden-routines.ts),
// one queue that does each run (garden-queue.ts), the tabs runs work in (garden-tabs.ts), skills, hiring and the
// Plaza. This file answers the pages about gardeners, runs and requests, and starts it all.
import { engine } from './engine.ts';
import { closeLiveGroups } from './missions.ts';
import { addNote, deleteDocs, deleteNote, deleteNotes, listNotes } from './memory.ts';
import * as idb from '../shared/idb.ts';
import * as trust from './trust.ts';
import { isExtensionPage, pagesOnly } from './pagerequest.ts';
import { allRuns, broadcast, checkWork, db, end, followQueued, gardeners, getRun, KEEP_RUNS, mustGardener, parsed, ready, routines, saveRun, setStarted, skills, updateRun } from './garden-store.ts';
import { ctxFor, drain, gardensModel, WAKE } from './garden-queue.ts';
import { ALARM, deleteRoutine, fire, routineHandlers } from './garden-routines.ts';
import { initTabs, live, owned, release, tabHandlers } from './garden-tabs.ts';
import { deleteSkill, refusedWork, skillHandlers } from './garden-skills.ts';
import { hireHandlers } from './garden-hire.ts';
import { plazaHandlers } from './garden-plaza.ts';
import { can } from '../domain/model.ts';
import { answerPlan, answerRefused, followUpRun, parseEdit, recover, resumeAll, retryStep } from '../domain/garden/loop.ts';
import { addSeen, alwaysOk, approveAllOk, SENSITIVE_WAIT, type Grant } from '../domain/garden/policy.ts';
import { expired } from '../domain/garden/schedule.ts';
import { NEEDS, needsRefusal, skillWork, slashOf } from '../domain/garden/skills.ts';
import { trimmed } from '../domain/garden/report.ts';
import { helping, isEnded, isWorking, newRun, noPage, NO_PAGE, parseGardener, parseLook, parseRoutine, parseRun, randomLook, requestOf, routineWork, sitesOf, type Gardener, type GardenRun, type Request } from '../domain/garden/records.ts';
import { isObj } from '../domain/text.ts';

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
    return isObj(a) && Object.entries(a).every(([k, v]) => typeof v === 'string' && questions.some((x) => x.q === k));
  } catch {
    return false;
  }
}

const open = (r: GardenRun, q: Request | undefined, now: number): q is Request =>
  r.status === 'waiting' && !!q && !q.answer && !expired(r, now) && (q.expiresAt === undefined || q.expiresAt > now);

/** Stop on a parent stops its helpers; on a helper, only it. */
async function stopRun(id: string): Promise<void> {
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
    await updateRun(x, (r) => void (isWorking(r) && end(r, 'stopped')));
  };
  await stopOne(id);
  for (const r of await allRuns()) if (r.parentId === id && isWorking(r)) await stopOne(r.id);
  drain(); // a stopped helper may be the last its parent waited on
}

/** Stop: from an extension page, or from a tab in the run's own group (the lock bar). */
async function runStop({ id }: { id: string }, sender?: chrome.runtime.MessageSender): Promise<true> {
  if (!owned(id, sender?.tab) && !isExtensionPage(sender)) throw new Error('Only Homegrown’s own pages can do that.');
  await ready();
  await stopRun(id);
  return true;
}

const gardenHandlers = pagesOnly({
  gardenerList: async () => (await ready(), gardeners()),
  gardenerSave: async ({ gardener }: { gardener: Partial<Gardener> }) => {
    await ready();
    const { refused } = sitesOf(Array.isArray(gardener.sites) ? gardener.sites : []);
    if (refused.length) throw new Error(`These can’t be sites: ${refused.join(', ')}`);
    // Stored looks are read leniently; a new one must be valid (never the mark's 10 petals).
    if (gardener.look !== undefined && !parseLook(gardener.look)) throw new Error('A look has 5–9, 11 or 12 petals and leans 0.3–1.');
    // A new gardener (or one from before looks) gets a flower of its own at random. A hired gardener stays its
    // pack's (its tools only narrow); only Hire sets a pack.
    const old = gardener.id ? parseGardener(await idb.get(await db, 'gardeners', gardener.id)) : null;
    const g = parseGardener({ v: 1, minutes: 10, ...gardener, preset: old?.preset, look: gardener.look ?? randomLook(), id: gardener.id || crypto.randomUUID(), createdAt: gardener.createdAt ?? Date.now() });
    if (!g) throw new Error('A gardener needs a name (up to 40 characters), instructions up to 2000, at most 20 sites and 1–60 minutes.');
    await idb.put(await db, 'gardeners', g);
    return g;
  },
  gardenerDelete: async ({ id }: { id: string }) => {
    await ready();
    for (const r of (await routines()).filter((x) => x.gardenerId === id)) await deleteRoutine(r.id);
    // Its runs stop first, so none takes a note after its notes are gone.
    for (const r of (await allRuns()).filter((x) => x.gardenerId === id && isWorking(x))) await stopRun(r.id);
    await deleteNotes(id);
    await deleteDocs(id);
    for (const s of (await skills()).filter((x) => x.gardenerId === id)) await deleteSkill(s.id);
    await idb.del(await db, 'gardeners', id);
    return true;
  },
  // Run now ({ routineId }): the routine's work and snapshots; its nextDue stays. Ask a follow-up ({ followUp, work }):
  // ask or plan work for the earlier run's gardener, whose answer starts its data.
  gardenRun: async ({ gardenerId, work, routineId, followUp }: { gardenerId?: string; work?: unknown; routineId?: string; followUp?: string }) => {
    await ready();
    const d = await db;
    const routine = routineId ? parseRoutine(await idb.get(d, 'routines', routineId)) : null;
    if (routineId && !routine) throw new Error('That routine no longer exists.');
    if (routine && noPage(routine.work)) throw new Error(NO_PAGE);
    const earlier = followUp ? await getRun(String(followUp)) : null;
    if (followUp && !earlier) throw new Error('That run no longer exists.');
    if (earlier && isWorking(earlier)) throw new Error('It’s still working: queue the message instead.');
    const g = await mustGardener(earlier?.gardenerId ?? routine?.gardenerId ?? String(gardenerId ?? ''));
    const model = await gardensModel();
    if (needsRefusal(routine, (a) => can(model, a))) throw new Error(NEEDS);
    let w = checkWork(routine ? routineWork(routine) : work, g);
    const req = requestOf(w);
    if (earlier && !req) throw new Error('A follow-up is a request.');
    if (req) {
      // `/name rest`: the skill's own work kind, with its id.
      const hit = !routine && !earlier ? slashOf(req.request, await skills()) : null;
      if (typeof hit === 'string') throw new Error(hit);
      if (hit) w = skillWork(hit.skill, hit.rest, req.tabs);
      const why = await refusedWork(w, g.id, model);
      if (why) throw new Error(why);
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
  runList: async ({ gardenerId, limit = KEEP_RUNS }: { gardenerId?: string; limit?: number }) => {
    await ready();
    return (await allRuns()).filter((r) => !gardenerId || r.gardenerId === gardenerId).sort((a, b) => b.queuedAt - a.queuedAt).slice(0, limit).map(trimmed);
  },
  runGet: async ({ id }: { id: string }) => (await ready(), getRun(id)),
  runDelete: async ({ id }: { id: string }) => {
    await ready();
    await idb.tx(await db, 'runs', 'readwrite', async (t) => {
      const r = parseRun(await idb.req(t.objectStore('runs').get(id)));
      if (!r) throw new Error('That run no longer exists.');
      if (!isEnded(r)) throw new Error('Stop the run before deleting it.');
      // Its pages are merged into the parent only when all helpers end.
      if (r.parentId && helping(parseRun(await idb.req(t.objectStore('runs').get(r.parentId))) ?? r)) throw new Error('Its parent run still needs it.');
      t.objectStore('runs').delete(id);
    });
    return true;
  },
  /** Resume all: a parent's failed and stopped helpers run again, and the parent waits on them. */
  runResumeAll: async ({ id }: { id: string }) => {
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
  requestShown: async ({ runId, requestId }: { runId: string; requestId: string }) => {
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
  requestAnswer: async ({ runId, requestId, value, calls, args }: { runId: string; requestId: string; value: string; calls?: unknown; args?: unknown }) => {
    await ready();
    if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw new Error('The answer is empty or too long.');
    let grant: Grant | null = null;
    let help: number | undefined;
    // A plan's yes needs policy's view (gardener, grants, recipes), read before the transaction.
    const before = await getRun(runId);
    const ctx = before?.requests.find((x) => x.id === requestId)?.kind === 'plan' ? await ctxFor(before, await mustGardener(before.gardenerId)) : null;
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
        const why = ctx ? answerPlan(r, { ...ctx, now }, q, value as 'yes' | 'no', calls, now) : 'That gardener no longer exists.';
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
  requestAnswerAll: async ({ requests }: { requests: { runId: string; requestId: string }[] }) => {
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
  runMessage: async ({ id, text, steer }: { id: string; text: string; steer: boolean }) => {
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
      if (isEnded(r)) throw new Error('That run has ended.');
      if (r.inbox?.some((x) => x.id === m.id)) return;
      if (unused(r) >= 3) throw new Error(full);
      (r.inbox ??= []).push(m);
    });
    return m.id;
  },
  /** Opening a run in the Garden tab: it is no longer Unread. */
  runSeen: async ({ id }: { id: string }) => {
    await ready();
    await updateRun(String(id), (r) => void (r.seenAt = Date.now()));
    return true;
  },
  /** Retry step: `{ id, step }`, an ended run of direct work runs that failed step again, then what followed it. */
  runRetry: async ({ id, step }: { id: string; step: number }) => {
    await ready();
    await updateRun(String(id), (r) => {
      const why = retryStep(r, Number(step));
      if (why) throw new Error(why);
    });
    drain();
    return true;
  },
  // The notebook: private, so extension pages only. A note belongs to a gardener that exists, or to every gardener.
  noteList: async ({ gardenerId }: { gardenerId?: string } = {}) => listNotes(gardenerId),
  noteSave: async ({ note }: { note: { gardenerId?: string; text: string } }) => {
    await ready();
    if (note.gardenerId) await mustGardener(note.gardenerId);
    const { vec: _, ...n } = await addNote({ ...(note.gardenerId && { gardenerId: note.gardenerId }), text: String(note.text ?? ''), by: 'person' });
    return n;
  },
  noteDelete: async ({ id }: { id: string }) => (await deleteNote(String(id)), true),
  grantList: async ({ gardenerId }: { gardenerId?: string } = {}) => (await trust.grants()).filter((g) => !gardenerId || g.gardenerId === gardenerId),
  grantRevoke: async ({ gardenerId, tool, host, argsKey }: Omit<Grant, 'at'>) => (await trust.revoke({ gardenerId, tool, host, argsKey }), true),
});

export const handlers = { ...gardenHandlers, runStop, ...routineHandlers, ...tabHandlers, ...skillHandlers, ...hireHandlers, ...plazaHandlers };

/** Test hook (on self): the routine's claim, as if its alarm fired. */
export async function gardenFire(routineId: string): Promise<void> {
  await ready();
  await fire(routineId);
  drain();
}

// Worker start, once: runs the old worker left running go back to the queue, its engine requests are cancelled, its
// tabs and windows closed, then every routine's alarm is re-armed and due ones are claimed.
export function init(): void {
  setStarted((async () => {
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
  })().catch((e) => console.warn('garden start failed', e)));
  drain();
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === WAKE) drain();
    else if (a.name.startsWith(ALARM)) void gardenFire(a.name.slice(ALARM.length)).catch((e) => console.warn('garden alarm failed', e));
  });
  initTabs();
  chrome.notifications.onClicked.addListener((id) => {
    if (!id.startsWith('garden:')) return;
    void chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html#garden') });
    void chrome.notifications.clear(id);
  });
}
