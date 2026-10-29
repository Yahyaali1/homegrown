// Collect from pages: runs a recipe (domain/scrape) page by page through pageRequest and keeps saved recipes.
// Progress goes to extension pages as {type:'scrape-progress', runId, …}. Steps that click, fill or run code come
// only from the user's recipe, and Mission control confirms them before a first run.
import type { Run } from './missions.ts';
import { pageRequest, refuseActs } from './pagerequest.ts';
import { ask as engineAsk } from './engine.ts';
import { itemRule, LIMITS, parseRecipe, type PageResult, type Recipe } from '../domain/scrape/recipe.ts';
import { aiAnswer, aiFill } from '../domain/scrape/ai.ts';
import { TOOLS } from '../domain/scrape/tools.ts';
import type { Ask } from '../domain/mission/ports.ts';


const runs = new Map<string, Run>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (runId: string, e: Record<string, unknown>) => void chrome.runtime.sendMessage({ type: 'scrape-progress', runId, ...e }).catch(() => {});

/** AI fields for one page: into each item of the item rule, or onto the page's own data. Stop cancels the model call. */
async function fillAi(recipe: Recipe, r: PageResult, out: ScrapeResult, run: Run, runId: string): Promise<void> {
  const blocks = r.aiText ?? [];
  const query = recipe.page.ai_query;
  if (!blocks.length && !(query && r.aiPage)) return;
  say(runId, { asking: r.url });
  const note = (t: string) => void (out.notes.includes(t) || out.notes.push(t));
  try {
    // The Missions model (Settings → Models → Use for), in the background lane like missions.
    const ask: Ask = (instruction, data = '', sampling = {}) => engineAsk(instruction, data, { task: 'missions', ...sampling, signal: run.stop.signal });
    if (query && r.aiPage) {
      r.data.ai_query = await aiAnswer(ask, query, r.aiPage); // the model's own words, labelled by its key
      out.ai.calls++;
    }
    if (!blocks.length || !recipe.ai) return;
    const got = await aiFill(ask, recipe.ai!, blocks, run.stop.signal);
    out.ai.calls += got.calls;
    out.ai.filled += got.filled;
    out.ai.dropped += got.dropped;
    if (got.unread) note('Some model answers could not be read, so their AI fields are empty');
    const each = itemRule(recipe.rules);
    if (!each) return void Object.assign(r.data, got.values[0]);
    const items = Array.isArray(r.data[each]) ? (r.data[each] as Record<string, unknown>[]) : [];
    got.values.forEach((v, i) => items[i] && Object.assign(items[i], v));
    if (items.length > got.values.length) note(`AI fields cover the first ${got.values.length} items of a page`);
  } catch (e) {
    if (run.stop.signal.aborted) return; // Stop: the page keeps its CSS fields
    note(`AI fields skipped: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export interface ScrapeResult { results: PageResult[]; reads: number; stopped: boolean; notes: string[]; ai: { calls: number; filled: number; dropped: number } }

/** Reads each URL, following next-page links up to recipe.pages, at most LIMITS.reads pages in all. */
async function scrapeRun({ recipe: raw, runId }: { recipe: unknown; runId: string }, sender?: chrome.runtime.MessageSender): Promise<ScrapeResult> {
  const recipe = parseRecipe(raw);
  if (!recipe) throw new Error('This recipe can’t run: it needs at least one http(s) URL and valid rules.');
  refuseActs(sender, recipe.page.js_scenario);
  const run: Run = { stop: new AbortController() };
  runs.set(runId, run);
  const out: ScrapeResult = { results: [], reads: 0, stopped: false, notes: [], ai: { calls: 0, filled: 0, dropped: 0 } };
  const seen = new Set<string>();
  try {
    urls: for (const start of recipe.urls) {
      let url: string | null = start;
      for (let page = 1; url; page++) {
        if (run.stop.signal.aborted) return { ...out, stopped: true };
        if (seen.has(url)) break; // a next link that loops back
        if (page > recipe.pages) {
          out.notes.push(`${start}: stopped at ${recipe.pages} pages; more exist`);
          break;
        }
        if (out.reads >= LIMITS.reads) {
          out.notes.push(`stopped at ${LIMITS.reads} pages in all`);
          break urls;
        }
        if (page > 1) await sleep(1000); // one site, one page at a time, gently
        if (run.stop.signal.aborted) return { ...out, stopped: true };
        seen.add(url);
        out.reads++;
        say(runId, { reading: url, reads: out.reads });
        const r: PageResult = await pageRequest(url, recipe, run).catch((e: unknown) => ({ url: url!, data: {}, error: e instanceof Error ? e.message : String(e) }));
        if (run.stop.signal.aborted) return { ...out, stopped: true }; // the page read was cut short by Stop
        if ((recipe.ai || recipe.page.ai_query) && !r.error) await fillAi(recipe, r, out, run, runId);
        delete r.aiText;
        delete r.aiPage;
        seen.add(r.url);
        out.results.push(r);
        say(runId, { result: r });
        if (run.stop.signal.aborted) return { ...out, stopped: true }; // stopped while the model read it: page kept
        url = r.error ? null : r.next ?? null;
      }
    }
    return out;
  } finally {
    runs.delete(runId);
  }
}

// ---- saved recipes: chrome.storage.local 'recipes', each { v: 1, … }, checked on every read ----

async function recipesList(): Promise<Recipe[]> {
  const { recipes } = await chrome.storage.local.get('recipes');
  return (Array.isArray(recipes) ? recipes : []).map(parseRecipe).filter((r): r is Recipe => !!r);
}

async function recipeSave({ recipe: raw }: { recipe: unknown }, sender?: chrome.runtime.MessageSender): Promise<Recipe> {
  const recipe = parseRecipe(raw);
  if (!recipe) throw new Error('This recipe can’t be saved: it needs at least one http(s) URL and valid rules.');
  refuseActs(sender, recipe.page.js_scenario);
  const rest = (await recipesList()).filter((r) => r.id !== recipe.id);
  if (rest.length >= LIMITS.recipes) throw new Error(`You can keep up to ${LIMITS.recipes} recipes. Delete one first.`);
  await chrome.storage.local.set({ recipes: [...rest, recipe] });
  return recipe;
}

async function recipeDelete({ id }: { id: string }): Promise<boolean> {
  await chrome.storage.local.set({ recipes: (await recipesList()).filter((r) => r.id !== id) });
  return true;
}

/** The page that started a run holds a 'scrape:<runId>' port: when it closes, reloads or navigates, the run stops. */
export function init(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name.startsWith('scrape:')) port.onDisconnect.addListener(() => runs.get(port.name.slice(7))?.stop.abort());
  });
}

/**
 * One page request with ScrapingBee's parameter names, for any feature: { url, params } → the page's JSON. Steps that
 * act (riskOf) are refused unless an extension page asked: a content script on a web page can only read.
 */
async function pageRequestHandler({ url, params = {}, runId = crypto.randomUUID() }: { url: string; params?: Record<string, unknown>; runId?: string }, sender?: chrome.runtime.MessageSender): Promise<PageResult> {
  const recipe = parseRecipe({ ...params, url, extract_rules: params.extract_rules ?? { title: 'title' } });
  if (!recipe) throw new Error('These parameters can’t run: check the URL, extract_rules and js_scenario.');
  refuseActs(sender, recipe.page.js_scenario);
  const run: Run = { stop: new AbortController() };
  runs.set(runId, run);
  try {
    const r = await pageRequest(recipe.urls[0]!, recipe, run);
    // The same AI step as Collect; the page text the model read stays in the worker.
    const out: ScrapeResult = { results: [], reads: 1, stopped: false, notes: [], ai: { calls: 0, filled: 0, dropped: 0 } };
    if ((recipe.ai || recipe.page.ai_query) && !r.error) await fillAi(recipe, r, out, run, runId);
    delete r.aiText;
    delete r.aiPage;
    if (out.notes.length) r.notes = out.notes; // why AI fields are empty, say
    return r;
  } finally {
    runs.delete(runId);
  }
}

export const handlers = {
  pageRequest: pageRequestHandler,
  pageTools: () => TOOLS,
  scrapeRun,
  scrapeStop: ({ runId }: { runId: string }) => (runs.get(runId)?.stop.abort(), true),
  recipesList,
  recipeSave,
  recipeDelete,
};
