// What a gardener's tool calls do in Chrome (specs in domain/garden/tools.ts). Every tab is the run's: it carries the
// run's cookie rule (Run.prepare), so pages off the gardener's sites are read signed out.
import { askAs } from './engine.ts';
import { ENGINES, inTab, missionRun, readInTab, searchInTab, waitLoaded, type Run } from './missions.ts';
import { cookieRule, play, type Guard } from './pagerequest.ts';
import { recipesList, scrapeRecipe } from './scrape.ts';
import { tabPage } from './tabs.ts';
import { addNote } from './memory.ts';
import { search as webSearch } from './web.ts';
import * as idb from './idb.ts';
import { diffText } from '../domain/compare.ts';
import { hostOf } from '../domain/text.ts';
import { columns } from '../domain/mission/types.ts';
import type { Ask } from '../domain/mission/ports.ts';
import { argsKey, onSites, type RecipeFacts } from '../domain/garden/policy.ts';
import { describe, type Instruction, type Scenario } from '../domain/scrape/scenario.ts';
import type { Check } from '../domain/garden/classify.ts';
import type { Recipe } from '../domain/scrape/recipe.ts';
import { mentionedTab, mentionsOf, pageLinks } from '../domain/garden/tools.ts';
import { LIMITS, type Gardener, type GardenRun, type Seen } from '../domain/garden/records.ts';

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

async function readPage({ url }: { url: string }, c: ToolCtx): Promise<ToolResult> {
  const page = await readInTab(url, c.tab, []);
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
    const old = snap?.runId === c.run.id ? snap.prev : snap?.text;
    output = old === undefined ? `First look:\n${md}` : diffText(old, md);
    await idb.put(c.db, 'snapshots', { text: md, ...(old !== undefined && { prev: old }), runId: c.run.id } satisfies Snapshot, key);
  } else if (c.run.work.kind === 'read') output = `First look:\n${md}`;
  return { output: output.slice(0, LIMITS.output), n: page.markdown.length, unit: 'chars', links, url: final, seen: { urls: links, from: 'link' }, taint };
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

const draft = async ({ title, text }: { title: string; text: string }): Promise<ToolResult> => ({ output: `${title}\n\n${text}`, n: text.length, unit: 'chars' });

async function notify({ text }: { text: string }, c: ToolCtx): Promise<ToolResult> {
  gardenNotice(c.gardener.name, text);
  return { output: text, n: text.length, unit: 'chars' };
}

/** A note for this gardener's later runs, kept with where it was taken: the page the run last worked on. */
async function note({ text }: { text: string }, c: ToolCtx): Promise<ToolResult> {
  // The tab's final URL of the last page the run loaded; none when it loaded none (a named tab's URL isn't stored).
  const url = c.run.steps.findLast((s) => s.state === 'done' && s.url)?.url ?? '';
  await addNote({ gardenerId: c.gardener.id, text, by: { runId: c.run.id, url } });
  return { output: 'Saved.', n: text.length, unit: 'chars' };
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
  const r = await inTab(url, c.tab, async (tabId) => {
    await waitLoaded(tabId, 20000);
    const played = await play(tabId, { ...steps, strict: true }, c.tab, guard);
    const [f] = await chrome.scripting.executeScript({ target: { tabId }, func: () => document.body?.innerText ?? '' }).catch(() => []);
    return { played, final: (await chrome.tabs.get(tabId).catch(() => null))?.url ?? url, text: String(f?.result ?? '').replace(/\s+/g, ' ').trim() };
  });
  const stop = stopped(guard, steps.instructions, r.played.report.filter((l) => l.ok).map((l) => l.step));
  if (stop) throw stop instanceof NeedsYou ? stop : new Error(`${stop.message} Now at ${r.final}.`);
  const lines = r.played.report.map((l) => `${l.ok ? '✓' : '✗'} ${l.step}${l.error ? `: ${l.error}` : ''}`).join('\n');
  if (r.played.failed) throw new Error(`${r.played.failed}. Now at ${r.final}.`);
  const taint = [url, r.final].some((u) => onSites(hostOf(u), c.gardener.sites));
  return { output: `Now at ${r.final}\n${lines}\n\n${r.text.slice(0, ACT_TEXT)}`.slice(0, LIMITS.output), n: r.text.length, unit: 'chars', url: r.final, taint };
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

// Args are already checked against their specs (parseArgs, or the routine's own work).
export const GARDEN_TOOLS: Record<string, (args: never, c: ToolCtx) => Promise<ToolResult>> = { read_page: readPage, search, mission, draft, note, notify, act, collect, read_my_tab: readMyTab };
