// Web reading for search, research, claim checks, related reading and link previews, from the service worker.
import { ask } from './engine.ts';
import { htmlToText, parseBing, parseDuckDuckGo, decode } from '../domain/html.ts';
import { hostOf } from '../domain/text.ts';
import type { SearchResult } from '../domain/mission/types.ts';

type Sender = chrome.runtime.MessageSender | undefined;

async function fetchText({ url }: { url: string }) {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  if (!/html|text/.test(res.headers.get('content-type') || 'text/html')) throw new Error(`Not a web page: ${url}`);
  return { url: res.url, ...htmlToText(await res.text()) };
}

// DuckDuckGo first; it answers 202 with a bot challenge when rate limited, so then Bing's HTML results, then
// Wikipedia's keyless search API (narrower, but always available).
export async function search({ q, n = 8 }: { q: string; n?: number }): Promise<SearchResult[]> {
  const ddg = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { credentials: 'omit' }).catch(() => null);
  let results = ddg?.ok ? parseDuckDuckGo(await ddg.text(), n) : [];
  if (results.length) return results;
  const bing = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=en`, { credentials: 'omit' }).catch(() => null);
  // Bing sometimes answers bot-like clients with unrelated results: keep only ones that share a query word.
  const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  results = (bing?.ok ? parseBing(await bing.text(), n) : []).filter((r) => words.some((w) => `${r.title} ${r.snippet}`.toLowerCase().includes(w)));
  if (results.length >= 2) return results;
  // Wikipedia ANDs every word, so a whole sentence finds nothing: retry with its longer words.
  const keywords = q.split(/\W+/).filter((w) => w.length > 3).slice(0, 7).join(' ');
  let hits: { title: string; snippet: string }[] = [];
  for (const query of [q, keywords]) {
    const wiki = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${n}&srsearch=${encodeURIComponent(query)}`);
    hits = wiki.ok ? ((await wiki.json()) as { query?: { search?: typeof hits } }).query?.search ?? [] : [];
    if (hits.length) break;
  }
  if (!hits.length) throw new Error('Web search is unavailable right now (DuckDuckGo and Bing returned no results and Wikipedia found nothing).');
  return hits.map((h) => ({ title: h.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, '_'))}`, snippet: decode(h.snippet.replace(/<[^>]+>/g, '')) }));
}

// Turns YouTube captions on or off through the player's own API (page world), so the player requests them and
// content/youtube-main.js can note the URL. Returns whether they were on before.
async function ytCaptions({ on }: { on: boolean }, sender: Sender): Promise<boolean> {
  if (sender?.tab?.id === undefined) return false;
  const [r] = await chrome.scripting.executeScript({
    target: { tabId: sender.tab.id },
    world: 'MAIN',
    args: [on],
    func: (on: boolean) => {
      const p = document.getElementById('movie_player') as (HTMLElement & { isSubtitlesOn?(): boolean; toggleSubtitlesOn?(): void; toggleSubtitlesOff?(): void }) | null;
      const was = !!p?.isSubtitlesOn?.();
      if (on && !was) p?.toggleSubtitlesOn?.();
      if (!on && was) p?.toggleSubtitlesOff?.();
      return was;
    },
  });
  return r?.result ?? false;
}

/** The page-world caption recorder for YouTube, registered at runtime (no manifest entry needed). */
export async function init(): Promise<void> {
  const id = 'eg-youtube-main';
  if ((await chrome.scripting.getRegisteredContentScripts({ ids: [id] })).length) return;
  await chrome.scripting.registerContentScripts([{ id, matches: ['*://*.youtube.com/*'], js: ['content/youtube-main.js'], world: 'MAIN', runAt: 'document_start', allFrames: false }]);
}

type Source = SearchResult & { notes?: string };
const numbered = (items: Source[]) => items.map((s, i) => `[${i + 1}] ${s.title} (${s.url})\n${s.notes || s.snippet || ''}`).join('\n\n');
const cite = (items: Source[]) => items.map(({ title, url }) => ({ title, url }));

/** Reads each page and keeps only what bears on the question. Pages that fail to load are skipped. */
async function readAll(results: SearchResult[], focus: string, say: (text: string) => void): Promise<Source[]> {
  const notes: Source[] = [];
  for (const [i, r] of results.entries()) {
    say(`Reading ${i + 1}/${results.length}: ${r.title}`);
    try {
      const page = await fetchText({ url: r.url });
      const n = await ask(`Note the facts on this page that bear on: "${focus}". Reply with 3 to 5 short bullets, or just "irrelevant".`, page.text.slice(0, 12000));
      if (!/^\W*irrelevant/i.test(n.trim())) notes.push({ ...r, notes: n.trim() });
    } catch {}
  }
  return notes;
}

/** Progress goes back to the tab that asked, as {type:'web-progress', id, text}. */
const progress = (id: string, sender: Sender) => (text: string) => {
  if (sender?.tab?.id !== undefined) chrome.tabs.sendMessage(sender.tab.id, { type: 'web-progress', id, text }, { frameId: sender.frameId ?? 0 }).catch(() => {});
};

async function research(msg: { id: string; q: string; n?: number }, sender: Sender) {
  const say = progress(msg.id, sender);
  say('Searching the web…');
  const notes = await readAll(await search({ q: msg.q, n: msg.n || 6 }), msg.q, say);
  if (!notes.length) throw new Error('None of the top results could be read or were relevant.');
  say('Writing the report…');
  const report = await ask(`Answer the question "${msg.q}" using only the numbered sources below. Cite them inline like [1]. Start with a two-sentence answer, then the key points as bullets. Say where sources disagree.`, numbered(notes));
  return { report, sources: cite(notes) };
}

async function checkClaim(msg: { id: string; claim: string }, sender: Sender) {
  const say = progress(msg.id, sender);
  say('Searching for sources…');
  const results = (await search({ q: msg.claim.slice(0, 300), n: 5 })).slice(0, 3);
  const notes = await readAll(results, msg.claim, say);
  const sources = notes.length ? notes : results; // snippets, when the pages won't load
  say('Weighing the sources…');
  const verdict = await ask(`Claim: "${msg.claim}"\nDo the numbered sources below support it? Start with one word: Supported, Contradicted, Mixed or Unclear. Then explain in two or three sentences, citing sources like [1].`, numbered(sources));
  return { verdict, sources: cite(sources) };
}

async function related(msg: { title: string; url: string }) {
  const results = (await search({ q: msg.title, n: 10 })).filter((r) => r.url !== msg.url && hostOf(r.url) !== hostOf(msg.url)).slice(0, 5);
  const why = await ask(`Someone is reading "${msg.title}". For each numbered result below, write one line "[n] why it's worth reading next" (max 15 words each).`, numbered(results));
  return { why, sources: cite(results) };
}

export const handlers = { fetchText, search, research, checkClaim, related, ytCaptions };
