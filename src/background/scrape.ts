// Collect from pages: runs a recipe (domain/scrape) in background tabs and keeps saved recipes. Progress goes to
// extension pages as {type:'scrape-progress', runId, …}. Read-only: rules are applied, nothing is clicked.
import { inTab, waitLoaded, type Run } from './missions.ts';
import { LIMITS, parseRecipe, type PageResult, type Recipe } from '../domain/scrape/recipe.ts';

const runs = new Map<string, Run>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (runId: string, e: Record<string, unknown>) => void chrome.runtime.sendMessage({ type: 'scrape-progress', runId, ...e }).catch(() => {});

function readOne(url: string, recipe: Recipe, run: Run): Promise<PageResult> {
  return inTab(url, run, async (tabId) => {
    await waitLoaded(tabId, 20000);
    await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/pageread.js'] });
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [{ rules: recipe.rules, waitFor: recipe.waitFor, wait: recipe.wait }],
      func: (o: Parameters<NonNullable<Window['__hgScrape']>>[0]) => window.__hgScrape?.(o) ?? null,
    });
    if (!frame?.result) throw new Error('The page could not be read.');
    return frame.result;
  });
}

export interface ScrapeResult { results: PageResult[]; reads: number; stopped: boolean; notes: string[] }

/** Reads each URL, following next-page links up to recipe.pages, at most LIMITS.reads pages in all. */
async function scrapeRun({ recipe: raw, runId }: { recipe: unknown; runId: string }): Promise<ScrapeResult> {
  const recipe = parseRecipe(raw);
  if (!recipe) throw new Error('This recipe can’t run: it needs at least one http(s) URL and valid rules.');
  const run: Run = { stop: new AbortController() };
  runs.set(runId, run);
  const out: ScrapeResult = { results: [], reads: 0, stopped: false, notes: [] };
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
        const r: PageResult = await readOne(url, recipe, run).catch((e: unknown) => ({ url: url!, data: {}, error: e instanceof Error ? e.message : String(e) }));
        if (run.stop.signal.aborted) return { ...out, stopped: true }; // the page read was cut short by Stop
        seen.add(r.url);
        out.results.push(r);
        say(runId, { result: r });
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

async function recipeSave({ recipe: raw }: { recipe: unknown }): Promise<Recipe> {
  const recipe = parseRecipe(raw);
  if (!recipe) throw new Error('This recipe can’t be saved: it needs at least one http(s) URL and valid rules.');
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

export const handlers = {
  scrapeRun,
  scrapeStop: ({ runId }: { runId: string }) => (runs.get(runId)?.stop.abort(), true),
  recipesList,
  recipeSave,
  recipeDelete,
};
