// What a gardener's tool calls do in Chrome (specs in domain/garden/tools.ts). Every tab is the run's: it carries the
// run's cookie rule (Run.prepare), so pages off the gardener's sites are read signed out.
import { askAs } from './engine.ts';
import { ENGINES, inTab, missionRun, readInTab, searchInTab, waitLoaded, type Run } from './missions.ts';
import { cookieRule, play, type Guard } from './pagerequest.ts';
import { logFor } from './devtools.ts';
import { recipesList, scrapeRecipe } from './scrape.ts';
import { tabPage } from './tabs.ts';
import { addNote, docAt, rememberEntity, writeDoc } from './memory.ts';
import { search as webSearch } from './web.ts';
import * as idb from './idb.ts';
import { diffText } from '../domain/compare.ts';
import { hostOf } from '../domain/text.ts';
import { columns } from '../domain/mission/types.ts';
import type { Ask } from '../domain/mission/ports.ts';
import { argsKey, onSites, type RecipeFacts } from '../domain/garden/policy.ts';
import { describe, type Instruction, type Scenario } from '../domain/scrape/scenario.ts';
import { isChallenge, type Check } from '../domain/garden/classify.ts';
import type { Recipe } from '../domain/scrape/recipe.ts';
import { mentionedTab, mentionsOf, pageLinks } from '../domain/garden/tools.ts';
import { proposedRoutine } from '../domain/garden/schedule.ts';
import { docRefused, type EntityType } from '../domain/memory.ts';
import { LIMITS, type Created, type Gardener, type GardenRun, type Seen, type When, type Work } from '../domain/garden/records.ts';

export const MODEL_CHANGED = 'The model changed during the run.';
const SNAPSHOT_CHARS = 20000; // as monitors.ts keeps

export interface ToolCtx {
  run: GardenRun; gardener: Gardener; tab: Run; i: number; db: IDBDatabase;
  /** The key the call was allowed under (policy's callKey). */
  key: string;
  /** The person's sensitive yes to this exact call (8 s or more after seeing it): its reason, and step if the page stopped it. */
  ok?: Check['ok'];
  /** Whether a URL other than the call's own may be read (a recipe's next pages): policy's reach and taint. */
  reach: (url: string) => boolean;
  /** The person's tab joins the run for this call (lock bar, Stop, Take over); the result gives it back. */
  borrow: (tabId: number) => Promise<() => Promise<void>>;
}
export interface ToolResult {
  output: string;
  n: number;
  unit: 'chars' | 'results' | 'rows';
  links?: string[];
  /** The tab's final URL (read_page). */
  url?: string;
  /** URLs that join `seen`, and where they came from. */
  seen?: { urls: string[]; from: Seen['from'] };
  taint?: boolean;
  /** Something the call made, shown as a card on the run. */
  created?: Created;
}

/** The run's pinned model on the background lane; a reply from any other model throws. */
export const gardenAsk = (run: GardenRun, signal: AbortSignal): Ask => async (instruction, data = '', sampling = {}) => {
  const r = await askAs(instruction, data, { task: 'gardens', model: run.model!, owner: 'garden', signal, sampling });
  if (r.model !== run.model) throw new Error(MODEL_CHANGED);
  return r.text;
};

/** "<gardener>: <text>"; a click opens the Garden tab, never a URL the model gave. */
export function gardenNotice(name: string, text: string): void {
  chrome.notifications.create(`garden:${crypto.randomUUID()}`, { type: 'basic', iconUrl: 'icon128.png', title: name, message: `${name}: ${text}`.slice(0, 300) });
}

interface Snapshot { text: string; prev?: string; runId: string }

/** The page asked for a check for humans: its tab is kept open for the person (`tabId`). */
export class NeedsHelp extends Error {
  tabId: number;
  constructor(tabId: number) {
    super('The site asks for a check for humans.');
    this.tabId = tabId;
  }
}

const NO_DEBUGGER = 'DevTools reads need the debugger permission: turn DevTools on again under the gardener to allow it.';

/**
 * With the gardener's DevTools switch on, every tab the call opens has the debugger attached from before its page
 * loads; the digest of console errors and failed requests comes back with the result.
 */
async function watched<T>(c: ToolCtx, go: () => Promise<T>): Promise<{ r: T; log: string }> {
  if (!c.gardener.devtools) return { r: await go(), log: '' };
  if (!(await chrome.permissions.contains({ permissions: ['debugger'] }))) return { r: await go(), log: NO_DEBUGGER };
  const outer = c.tab.prepare;
  const logs: string[] = [];
  c.tab.prepare = async (t) => {
    const undo = outer ? await outer(t) : async () => {};
    const log = await logFor(t).catch(() => null);
    return async () => {
      if (log) logs.push(await log.stop());
      await undo();
    };
  };
  try {
    const r = await go();
    return { r, log: logs.filter(Boolean).join('\n') };
  } finally {
    if (outer) c.tab.prepare = outer;
    else delete c.tab.prepare;
  }
}

/** Page output with the DevTools digest kept whole at its end. */
const withLog = (output: string, log: string) => (log ? `${output.slice(0, LIMITS.output - log.length - 2)}\n\n${log}` : output.slice(0, LIMITS.output));

async function readPage({ url }: { url: string }, c: ToolCtx): Promise<ToolResult> {
  const { r: page, log } = await watched(c, () => readInTab(url, c.tab, [], undefined, (p) => isChallenge({ frames: p.frameUrls ?? [], title: p.title, text: p.text })));
  if (page?.held !== undefined) throw new NeedsHelp(page.held);
  if (!page) throw new Error('The page could not be read.');
  const final = page.tabUrl ?? url;
  // Signed in if the tab or any frame was on the sites; unknown counts as signed in (fail closed).
  const taint = !page.tabUrl || !page.frameUrls || [final, ...page.frameUrls].some((u) => onSites(hostOf(u), c.gardener.sites));
  const md = page.markdown.slice(0, SNAPSHOT_CHARS);
  const links = pageLinks(page.markdown);
  let output = md;
  // Direct reads say what changed since the routine's last read. A re-run after a stop finds its own snapshot, and
  // diffs against the one before.
  if (c.run.work.kind === 'read' && c.run.routineId) {
    const key = `${c.run.routineId}\n${url}`;
    const snap = await idb.get<Snapshot>(c.db, 'snapshots', key);
    // A parent re-reading a page its helper read this run: that snapshot is its own too.
    const old = snap?.runId === c.run.id || snap?.runId.startsWith(`${c.run.id}.h`) ? snap.prev : snap?.text;
    output = old === undefined ? `First look:\n${md}` : diffText(old, md);
    await idb.put(c.db, 'snapshots', { text: md, ...(old !== undefined && { prev: old }), runId: c.run.id } satisfies Snapshot, key);
  } else if (c.run.work.kind === 'read') output = `First look:\n${md}`;
  return { output: withLog(output, log), n: page.markdown.length, unit: 'chars', links, url: final, seen: { urls: links, from: 'link' }, taint };
}

async function search({ query }: { query: string }, c: ToolCtx): Promise<ToolResult> {
  let results: Awaited<ReturnType<typeof webSearch>> = [];
  for (const e of ENGINES) {
    results = await searchInTab(query, 8, c.tab, e).catch((err: unknown) => (c.tab.stop.signal.aborted ? Promise.reject(err) : []));
    if (results.length) break;
  }
  if (!results.length) results = await webSearch({ q: query, n: 8 });
  results = results.slice(0, 8);
  return { output: results.map((r) => `${r.title} — ${r.url}`).join('\n'), n: results.length, unit: 'results', seen: { urls: results.map((r) => r.url), from: 'search' } };
}

// A mission is always signed out (keepHosts []), so it never taints the run.
async function mission({ goal }: { goal: string }, c: ToolCtx): Promise<ToolResult> {
  // The run's own Run (its group, Stop and cleanup), with the signed-out rule for this call.
  const keep = c.tab.prepare;
  c.tab.prepare = (t) => cookieRule(t, []);
  let r: Awaited<ReturnType<typeof missionRun>>;
  try {
    r = await missionRun(goal, c.tab, gardenAsk(c.run, c.tab.stop.signal));
  } finally {
    if (keep) c.tab.prepare = keep;
    else delete c.tab.prepare;
  }
  const rows = r.rows.slice(0, 5);
  const lines = rows.map((row, k) => `${k + 1}. ${columns(row).map(([, v]) => v).join(' · ')}${row._url ? ` — ${row._url}` : ''}`);
  return { output: [r.answer, ...lines].join('\n').slice(0, LIMITS.output), n: r.rows.length, unit: 'rows', seen: { urls: rows.flatMap((x) => (x._url ? [x._url] : [])), from: 'search' } };
}

const draft = async ({ title, text }: { title: string; text: string }, c: ToolCtx): Promise<ToolResult> =>
  ({ output: `${title}\n\n${text}`, n: text.length, unit: 'chars', created: { kind: 'draft', title, ref: String(c.i) } });

async function notify({ text }: { text: string }, c: ToolCtx): Promise<ToolResult> {
  gardenNotice(c.gardener.name, text);
  return { output: text, n: text.length, unit: 'chars' };
}

/** A note for this gardener's later runs, kept with where it was taken: the page the run last worked on. */
async function note({ text }: { text: string }, c: ToolCtx): Promise<ToolResult> {
  // The tab's final URL of the last page the run loaded; none when it loaded none (a named tab's URL isn't stored).
  const url = c.run.steps.findLast((s) => s.state === 'done' && s.url)?.url ?? '';
  const n = await addNote({ gardenerId: c.gardener.id, text, by: { runId: c.run.id, url } });
  return { output: 'Saved.', n: text.length, unit: 'chars', created: { kind: 'note', title: text.slice(0, 80), ref: n.id } };
}

/** The page stopped the call on a sensitive step before any act ran: ask the person about that step. */
export class NeedsYou extends Error {
  stop: { index: number; why: string };
  constructor(stop: { index: number; why: string }) {
    super(stop.why);
    this.stop = stop;
  }
}

/** A recipe as policy sees it: its key covers the whole recipe, so any edit needs a new yes. */
export const factsOf = (r: Recipe): RecipeFacts => ({ id: r.id, name: r.name, urls: r.urls, scenario: r.page.js_scenario ?? null, key: argsKey(r as unknown as Record<string, unknown>) });

const guardFor = (hosts: string[], c: ToolCtx): Guard => ({ hosts, tainted: c.run.tainted, ...(c.ok && { ok: { ...c.ok } }), ran: 0 });

/**
 * After play: off the call's hosts → the call fails; sensitive with no act run yet → ask in place (NeedsYou);
 * sensitive after some acts ran → the call fails, saying what ran, so nothing is ever done twice.
 */
function stopped(g: Guard, steps: Instruction[], done: string[]): Error | null {
  if (!g.stop) return null;
  const at = steps[g.stop.index];
  if (!g.stop.host && !g.ran) return new NeedsYou({ index: g.stop.index, why: g.stop.why });
  const ran = g.ran ? ` Already done: ${done.join('; ') || `${g.ran} step(s)`}.` : '';
  return new Error(`Stopped before ${at ? describe(at) : 'a step'}: ${g.stop.why}.${ran}`);
}

const ACT_TEXT = 1500;

/** Opens the page, plays the approved steps (each checked on its live element), and says where it ended up. */
async function act({ url, steps }: { url: string; steps: Scenario }, c: ToolCtx): Promise<ToolResult> {
  const guard = guardFor([hostOf(url)], c);
  const { r, log } = await watched(c, () => inTab(url, c.tab, async (tabId) => {
    await waitLoaded(tabId, 20000);
    const played = await play(tabId, { ...steps, strict: true }, c.tab, guard);
    return { played, ...(await where(tabId, url)) };
  }));
  const stop = stopped(guard, steps.instructions, r.played.report.filter((l) => l.ok).map((l) => l.step));
  if (stop) throw stop instanceof NeedsYou ? stop : new Error(`${stop.message} Now at ${r.final}.`);
  if (r.played.failed) throw new Error(`${r.played.failed}. Now at ${r.final}.${log ? `\n${log}` : ''}`);
  const taint = [url, r.final].some((u) => onSites(hostOf(u), c.gardener.sites));
  return { output: withLog(`Now at ${r.final}\n${report(r.played.report)}\n\n${r.text.slice(0, ACT_TEXT)}`, log), n: r.text.length, unit: 'chars', url: r.final, taint };
}

const report = (lines: { ok: boolean; step: string; error?: string }[]) => lines.map((l) => `${l.ok ? '✓' : '✗'} ${l.step}${l.error ? `: ${l.error}` : ''}`).join('\n');

/** Where the tab ended up, and its text in short. */
async function where(tabId: number, url: string): Promise<{ final: string; text: string }> {
  const [f] = await chrome.scripting.executeScript({ target: { tabId }, func: () => document.body?.innerText ?? '' }).catch(() => []);
  return { final: (await chrome.tabs.get(tabId).catch(() => null))?.url ?? url, text: String(f?.result ?? '').replace(/\s+/g, ' ').trim() };
}

/**
 * Plays approved steps in a tab the person named, in place (decision 6). The tab is the run's for the call: the lock
 * bar shows there, and Stop and Take over from it work; it is never closed. The run is tainted after.
 */
async function actMyTab({ tab, steps }: { tab: string; steps: Scenario }, c: ToolCtx): Promise<ToolResult> {
  const id = mentionedTab(mentionsOf(c.run), tab, await chrome.tabs.query({}));
  if (typeof id === 'string') throw new Error(id);
  const guard = guardFor([hostOf(tab)], c);
  const give = await c.borrow(id);
  let r: Awaited<ReturnType<typeof where>> & { played: Awaited<ReturnType<typeof play>> };
  try {
    // An earlier hand-back halted this page's step runner; this call was approved anew.
    await chrome.scripting.executeScript({ target: { tabId: id, allFrames: true }, func: () => void (window.__hgHalt = false) }).catch(() => {});
    const played = await play(id, { ...steps, strict: true }, c.tab, guard);
    r = { played, ...(await where(id, tab)) };
  } finally {
    await give();
  }
  const stop = stopped(guard, steps.instructions, r.played.report.filter((l) => l.ok).map((l) => l.step));
  if (stop) throw stop instanceof NeedsYou ? stop : new Error(`${stop.message} Now at ${r.final}.`);
  if (r.played.failed) throw new Error(`${r.played.failed}. Now at ${r.final}.`);
  return { output: `Now at ${r.final}\n${report(r.played.report)}\n\n${r.text.slice(0, ACT_TEXT)}`.slice(0, LIMITS.output), n: r.text.length, unit: 'chars', taint: true };
}

/** A saved Collect recipe in the run's tabs, with its pinned model; acting steps are guarded like `act`. */
async function collect({ recipe: id }: { recipe: string }, c: ToolCtx): Promise<ToolResult> {
  const recipe = (await recipesList()).find((r) => r.id === id);
  if (!recipe) throw new Error('No saved recipe has that id.');
  // The answer (or grant) covered the recipe as it was then; code steps are the person's alone.
  if (factsOf(recipe).key !== c.key) throw new Error('The recipe changed since it was allowed.');
  if (recipe.page.js_scenario?.instructions.some((i) => 'evaluate' in i)) throw new Error('A gardener can’t run a recipe with code steps.');
  const guard = guardFor([...new Set(recipe.urls.map(hostOf))], c);
  const out = await scrapeRecipe(recipe, c.tab, `garden:${c.run.id}`, { ask: gardenAsk(c.run, c.tab.stop.signal), guard, reach: c.reach });
  const done = out.results.filter((r) => !r.error).map((r) => r.url);
  const stop = stopped(guard, recipe.page.js_scenario?.instructions ?? [], done.length ? [`the steps on ${done.join(', ')}`] : []);
  if (stop) throw stop;
  const lines = out.results.map((r) => `${r.url}: ${r.error ? `failed: ${r.error}` : JSON.stringify(r.data)}`);
  const taint = out.results.some((r) => onSites(hostOf(r.url), c.gardener.sites)) || recipe.urls.some((u) => onSites(hostOf(u), c.gardener.sites));
  return { output: [...lines, ...out.notes].join('\n').slice(0, LIMITS.output), n: done.length, unit: 'rows', taint };
}

/** A tab the person named: read in place (never acted in), and the run is tainted, as after a signed-in read. */
async function readMyTab({ tab }: { tab: string }, c: ToolCtx): Promise<ToolResult> {
  const id = mentionedTab(mentionsOf(c.run), tab, await chrome.tabs.query({}));
  if (typeof id === 'string') throw new Error(id);
  const { text, url } = await tabPage(id, LIMITS.output).catch(() => {
    throw new Error('The tab could not be read.');
  });
  // It may have moved between the check and the read: only the page the person named counts.
  if (url !== tab) throw new Error('The tab the person named is on another page now.');
  return { output: text, n: text.length, unit: 'chars', taint: true };
}

/** A routine the model proposes: stored paused, by the model, so it runs only after the person turns it on. */
async function proposeRoutine({ name, when, work }: { name: string; when: When; work: Work }, c: ToolCtx): Promise<ToolResult> {
  // Its id comes from the run and step, so a call run again after a restart doesn't store it twice or undo a turn-on.
  const id = `${c.run.id}.${c.i}`;
  const old = await idb.get<{ name: string }>(c.db, 'routines', id);
  if (old) return { output: `Proposed “${old.name}”. It stays off until the person turns it on.`, n: 1, unit: 'results', created: { kind: 'routine', title: old.name, ref: id } };
  const r = proposedRoutine({ id, gardenerId: c.gardener.id, name, when, work, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, now: Date.now() });
  await idb.put(c.db, 'routines', r);
  return { output: `Proposed “${r.name}”. It stays off until the person turns it on.`, n: 1, unit: 'results', created: { kind: 'routine', title: r.name, ref: id } };
}

/** A memory file the model proposes: stored unconfirmed, shown with Keep / Discard. */
async function remember({ type, name, body }: { type: EntityType; name: string; body: string }, c: ToolCtx): Promise<ToolResult> {
  const e = await rememberEntity({ id: `${c.run.id}.${c.i}`, type, name, body, gardenerId: c.gardener.id });
  return { output: `Proposed “${e.name}”. It stays out of your work until the person keeps it.`, n: 1, unit: 'results', created: { kind: 'memory', title: e.name, ref: e.id } };
}

/** One of this gardener's documents; the worker taints the run after it (taintsAfter). */
async function docRead({ path }: { path: string }, c: ToolCtx): Promise<ToolResult> {
  const d = await docAt(c.gardener.id, path);
  if (!d) throw new Error(`No document at ${path}.`);
  return { output: d.text.slice(0, LIMITS.output), n: d.text.length, unit: 'chars' };
}

async function docWrite({ path, text }: { path: string; text: string }, c: ToolCtx): Promise<ToolResult> {
  const why = docRefused(path);
  if (why) throw new Error(why);
  const d = await writeDoc(c.gardener.id, path, text, 'model');
  return { output: `Saved ${path}.`, n: text.length, unit: 'chars', created: { kind: 'doc', title: path, ref: d.id } };
}

// Args are already checked against their specs (parseArgs, or the routine's own work).
export const GARDEN_TOOLS: Record<string, (args: never, c: ToolCtx) => Promise<ToolResult>> = { read_page: readPage, search, mission, draft, note, notify, act, collect, read_my_tab: readMyTab, act_my_tab: actMyTab, propose_routine: proposeRoutine, remember, doc_read: docRead, doc_write: docWrite };
