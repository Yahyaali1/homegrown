// Memory: answer history, highlights, a small knowledge base of pages tasks ran on, page snapshots for "changed
// since your last visit", and the savings meter. Everything stays in this browser (IndexedDB 'eg-memory',
// chrome.storage.local 'savings').
import { engine, ask } from './engine.ts';
import { cosine, diffLines, keywordScore } from '../domain/compare.ts';

const HISTORY_CAP = 2000;
const SNAPSHOT_CAP = 300; // pages kept for "changed since your last visit"
const SNAPSHOT_CHARS = 50000;
const SIMILAR = 0.6; // cosine for "same topic"; calibrated on MiniLM: related pages ~0.72, unrelated < 0.1
const RATE = { inPerM: 0.5, outPerM: 1.5 }; // ponytail: rough cloud price (USD per 1M tokens) for the estimate

interface HistoryEntry { id?: number; url: string; title: string; ask: string; answer: string; time: number }
interface Embedded { id?: number; url: string; title: string; embedText: string; vec: number[] | null; time: number }
interface KbEntry extends Embedded { summary: string }
interface Highlight extends Embedded { text: string; note: string }
interface Snapshot { url: string; text: string; time: number }
interface Stores { history: HistoryEntry; highlights: Highlight; kb: KbEntry; snapshots: Snapshot }
type StoreName = keyof Stores;

const db = new Promise<IDBDatabase>((resolve, reject) => {
  const r = indexedDB.open('eg-memory', 2);
  r.onupgradeneeded = (e) => {
    const d = r.result;
    if (e.oldVersion < 1) {
      d.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
      d.createObjectStore('highlights', { keyPath: 'id', autoIncrement: true }).createIndex('url', 'url');
      d.createObjectStore('kb', { keyPath: 'id', autoIncrement: true }).createIndex('url', 'url');
    }
    if (e.oldVersion < 2) d.createObjectStore('snapshots', { keyPath: 'url' });
  };
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
const done = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => ((r.onsuccess = () => resolve(r.result)), (r.onerror = () => reject(r.error))));
const store = async (name: StoreName, mode: IDBTransactionMode = 'readonly') => (await db).transaction(name, mode).objectStore(name);
const all = async <N extends StoreName>(name: N) => (await done((await store(name)).getAll())) as Stores[N][];

async function embed(texts: string[]): Promise<number[][]> {
  const r = await engine<{ vectors?: number[][] } | number[][]>('embed', { texts });
  return Array.isArray(r) ? r : r.vectors ?? [];
}

/** Fills in embeddings that failed earlier (the embedding model may not have been ready). */
async function withVectors<N extends 'kb' | 'highlights'>(name: N): Promise<Stores[N][]> {
  const items = await all(name);
  const missing = items.filter((i) => !i.vec);
  if (missing.length) {
    try {
      const vecs = await embed(missing.map((i) => i.embedText));
      const s = await store(name, 'readwrite');
      missing.forEach((i, k) => ((i.vec = Array.from(vecs[k] ?? [])), s.put(i)));
    } catch {} // still not ready: callers fall back to keywords
  }
  return items;
}

async function addHistory(entry: HistoryEntry): Promise<void> {
  const s = await store('history', 'readwrite');
  await done(s.add(entry));
  let extra = (await done(s.count())) - HISTORY_CAP;
  if (extra <= 0) return;
  const cur = s.openCursor(); // oldest first (autoIncrement keys)
  cur.onsuccess = () => {
    if (cur.result && extra-- > 0) (cur.result.delete(), cur.result.continue());
  };
}

async function addKb(url: string, title: string, summary: string): Promise<void> {
  const embedText = `${title}\n${summary}`.slice(0, 1500);
  const vec = await embed([embedText]).then((v) => Array.from(v[0] ?? []), () => null);
  const s = await store('kb', 'readwrite');
  for (const old of (await done(s.index('url').getAll(url))) as KbEntry[]) s.delete(old.id!);
  s.add({ url, title, summary, embedText, vec, time: Date.now() } satisfies KbEntry);
}

// ---- page snapshots: "changed since your last visit" ----
const pageKey = (url: string) => url.split('#')[0]!;

async function saveSnapshot(url: string, text: string | undefined): Promise<void> {
  if (!url.startsWith('http') || !text) return;
  const s = await store('snapshots', 'readwrite');
  s.put({ url: pageKey(url), text: text.slice(0, SNAPSHOT_CHARS), time: Date.now() } satisfies Snapshot);
  const items = (await done(s.getAll())) as Snapshot[];
  if (items.length > SNAPSHOT_CAP) items.sort((a, b) => a.time - b.time).slice(0, items.length - SNAPSHOT_CAP).forEach((i) => s.delete(i.url));
}

/** Snapshots the tab's main text (what the in-page UI reads as the page) when a task ran on a selection. */
async function snapshotTab(tabId: number | undefined, url: string): Promise<void> {
  if (tabId === undefined) return;
  const [res] = await chrome.scripting
    .executeScript({ target: { tabId }, func: () => ((document.querySelector('article, main, [role=main]') as HTMLElement | null) ?? document.body).innerText })
    .catch(() => []);
  await saveSnapshot(url, res?.result);
}

interface Savings { answers: number; inTokens: number; outTokens: number; bytes: number }
async function savings(): Promise<Savings> {
  const { savings: s } = await chrome.storage.local.get('savings');
  const v = (s && typeof s === 'object' ? s : {}) as Partial<Savings>;
  return { answers: v.answers ?? 0, inTokens: v.inTokens ?? 0, outTokens: v.outTokens ?? 0, bytes: v.bytes ?? 0 };
}

interface AnsweredRequest {
  quiet?: boolean;
  task?: { id?: string; title?: string };
  question?: string;
  page?: { url: string; title: string; text: string };
  selection?: string;
  history?: unknown[];
}

export async function onAnswer(raw: unknown, r: { text: string; userText?: string; stats?: { prefillTokens?: number; outputTokens?: number } }, sender?: chrome.runtime.MessageSender): Promise<void> {
  const req = raw as AnsweredRequest;
  // Only what a person asked for (saved tasks have a title, free questions a question). Feature-driven calls
  // (ghost text, gists, page translation) send quiet or no title, and would flood history and savings.
  if (req.quiet || (!req.task?.title && !req.question)) return;
  const url = req.page?.url || sender?.tab?.url || sender?.url || '';
  const title = req.page?.title || sender?.tab?.title || '';
  void addHistory({ url, title, ask: req.task?.title || req.question || '', answer: r.text, time: Date.now() });

  const input = (req.page?.text || req.selection || '') + (req.question || '') + (r.userText || '');
  const s = await savings();
  await chrome.storage.local.set({ savings: {
    answers: s.answers + 1, inTokens: s.inTokens + (r.stats?.prefillTokens ?? 0), outTokens: s.outTokens + (r.stats?.outputTokens ?? 0), bytes: s.bytes + new TextEncoder().encode(input).length,
  } });
  if (!req.history?.length && url.startsWith('http') && (req.page || (req.selection?.length ?? 0) > 500)) void addKb(url, title, r.text.slice(0, 800));
  // The "what changed" card carries a diff as its page text: content/memory.js updates the snapshot itself.
  if (!req.history?.length && req.task?.id !== 'last-visit') {
    if (req.page?.text) void saveSnapshot(url, req.page.text);
    else if (req.selection) void snapshotTab(sender?.tab?.id, url);
  }
}

export const handlers = {
  async memHistory({ q = '', limit = 200 }: { q?: string; limit?: number }) {
    const ql = q.toLowerCase();
    return (await all('history')).reverse().filter((h) => !ql || `${h.title} ${h.ask} ${h.answer} ${h.url}`.toLowerCase().includes(ql)).slice(0, limit);
  },
  async memClearHistory() {
    await done((await store('history', 'readwrite')).clear());
  },
  async memHighlightSave({ text, url, title, wantNote }: { text: string; url: string; title: string; wantNote?: boolean }, sender?: chrome.runtime.MessageSender) {
    const item: Highlight = { text, url, title, note: '', embedText: `${title}\n${text}`.slice(0, 1500), vec: null, time: Date.now() };
    item.id = (await done((await store('highlights', 'readwrite')).add(item))) as number;
    void snapshotTab(sender?.tab?.id, url);
    if (wantNote) {
      item.note = await ask('In one sentence, say why this passage might matter to the reader later. Reply with the sentence only.', text).catch(() => '');
      (await store('highlights', 'readwrite')).put(item);
    }
    return item;
  },
  async memHighlights({ url }: { url?: string }) {
    if (!url) return all('highlights');
    return done((await store('highlights')).index('url').getAll(url));
  },
  async memHighlightDelete({ id }: { id: number }) {
    await done((await store('highlights', 'readwrite')).delete(id));
  },
  /** "Have I read this before?": the closest past page on the same topic, or null. */
  async memSimilar({ text, url }: { text: string; url: string }) {
    const items = (await withVectors('kb')).filter((i) => i.vec && i.url !== url);
    if (!items.length) return null;
    const q = (await embed([text]))[0] ?? [];
    const best = items.map((i) => ({ url: i.url, title: i.title, score: cosine(q, i.vec!) })).sort((a, b) => b.score - a.score)[0];
    return best && best.score > SIMILAR ? best : null;
  },
  /** Ask your library: an answer from saved pages and highlights, citing them. */
  async memAsk({ question }: { question: string }) {
    const items: (KbEntry | Highlight)[] = [...(await withVectors('kb')), ...(await withVectors('highlights'))];
    if (!items.length) return { answer: 'Your library is empty. Run a task on a page or save a highlight first.', sources: [] };
    const q = await embed([question]).then((v) => v[0] ?? null, () => null);
    const scored = items
      .map((i) => ({ i, score: q && i.vec ? cosine(q, i.vec) : keywordScore(question, i.embedText) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    const sources = scored.map(({ i }, n) => ({ n: n + 1, title: i.title, url: i.url }));
    const notes = scored.map(({ i }, n) => `[${n + 1}] ${i.title}\n${'summary' in i ? i.summary : i.text}${'note' in i && i.note ? `\nNote: ${i.note}` : ''}`).join('\n\n');
    const answer = await ask(`Answer this question using only the saved notes below. Cite them like [1]. If they don't answer it, say so.\nQuestion: ${question}`, notes);
    return { answer, sources };
  },
  async memChanged({ url, text }: { url: string; text: string }) {
    const snap = (await done((await store('snapshots')).get(pageKey(url)))) as Snapshot | undefined;
    if (!snap) return null;
    const d = diffLines(snap.text, text);
    return d && { ...d, since: snap.time };
  },
  memSnapshot: ({ url, text }: { url: string; text: string }) => saveSnapshot(url, text),
  async memSavings() {
    const s = await savings();
    return { ...s, usd: (s.inTokens * RATE.inPerM + s.outTokens * RATE.outPerM) / 1e6, rate: RATE };
  },
  // Voice: the engine owns the speech model; content scripts reach it through here.
  transcribe: (msg: { audio: unknown; sampleRate: number; language?: string }) => engine('transcribe', { audio: msg.audio, sampleRate: msg.sampleRate, language: msg.language }),
};
