// Memory: answer history, highlights, a small knowledge base of pages tasks ran on, page snapshots for "changed
// since your last visit", the gardeners' notebook, typed memory and Documents (plan T7), and the savings meter. Everything stays in this browser (IndexedDB 'eg-memory',
// chrome.storage.local 'savings').
import { engine, ask } from './engine.ts';
import { cosine, diffLines, keywordScore } from '../domain/compare.ts';
import { forGardener, MEMORY_VERSION, NOTE_CHARS, parseNote, upgradeMemory, type Note } from '../domain/garden/notes.ts';
import { docWriteRefused, ENTITY_TYPES, MEM, parseDoc, parseEntity, pathOk, type Doc, type Entity } from '../domain/memory.ts';
import { isExtensionPage } from './pagerequest.ts';

const HISTORY_CAP = 2000;
const NOTES_CAP = 200; // per gardener; over it, its oldest model notes go (the person's never do)
const SNAPSHOT_CAP = 300; // pages kept for "changed since your last visit"
const SNAPSHOT_CHARS = 50000;
const SIMILAR = 0.6; // cosine for "same topic"; calibrated on MiniLM: related pages ~0.72, unrelated < 0.1
const RATE = { inPerM: 0.5, outPerM: 1.5 }; // ponytail: rough cloud price (USD per 1M tokens) for the estimate

interface HistoryEntry { id?: number; url: string; title: string; ask: string; answer: string; time: number }
interface Embedded { id?: number; url: string; title: string; embedText: string; vec: number[] | null; time: number }
interface KbEntry extends Embedded { summary: string }
interface Highlight extends Embedded { text: string; note: string }
interface Snapshot { url: string; text: string; time: number }
interface Stores { history: HistoryEntry; highlights: Highlight; kb: KbEntry; snapshots: Snapshot; notes: Note; entities: Entity; docs: Doc }
type StoreName = keyof Stores;

const db = new Promise<IDBDatabase>((resolve, reject) => {
  const r = indexedDB.open('eg-memory', MEMORY_VERSION);
  r.onupgradeneeded = (e) => upgradeMemory(r.result, e.oldVersion);
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

/**
 * Fills in embeddings that failed earlier (the embedding model may not have been ready). `parse` drops records this
 * build can't read: they are neither embedded nor written back.
 */
async function withVectors<N extends 'kb' | 'highlights' | 'notes'>(name: N, parse: (x: Stores[N]) => Stores[N] | null = (x) => x): Promise<Stores[N][]> {
  const items = (await all(name)).flatMap((i) => parse(i) ?? []);
  const missing = items.filter((i) => !i.vec);
  if (missing.length) {
    try {
      const vecs = await embed(missing.map((i) => ('embedText' in i ? i.embedText : i.text)));
      const s = await store(name, 'readwrite');
      missing.forEach((i, k) => ((i.vec = Array.from(vecs[k] ?? [])), s.put(i)));
    } catch {} // still not ready: callers fall back to keywords
  }
  return items;
}

/** Best match first: cosine to the question's embedding, or keywords when there is none. */
async function rank<T extends { vec?: number[] | null }>(query: string, items: T[], textOf: (i: T) => string): Promise<{ i: T; score: number }[]> {
  const q = await embed([query]).then((v) => v[0] ?? null, () => null);
  return items.map((i) => ({ i, score: q && i.vec ? cosine(q, i.vec) : keywordScore(query, textOf(i)) })).sort((a, b) => b.score - a.score);
}

// ---- the gardeners' notebook ----

const notes = async () => (await all('notes')).flatMap((n) => parseNote(n) ?? []); // a newer build's notes are left alone

/** A gardener's notes and the shared ones, best match first. The loop fits as many as its data budget holds. */
export async function notesFor(gardenerId: string, query: string): Promise<Note[]> {
  const mine = forGardener(await withVectors('notes', parseNote), gardenerId);
  return mine.length ? (await rank(query, mine, (n) => n.text)).map(({ i }) => i) : []; // no notes: no embedding call
}

export async function addNote(n: Pick<Note, 'gardenerId' | 'text' | 'by'>): Promise<Note> {
  const note = parseNote({ v: 1, id: crypto.randomUUID(), at: Date.now(), ...n, text: n.text.trim() });
  if (!note) throw new Error(`A note is 1–${NOTE_CHARS} characters.`);
  await done((await store('notes', 'readwrite')).add(note));
  if (note.gardenerId) {
    const mine = (await notes()).filter((x) => x.gardenerId === note.gardenerId);
    const extra = mine.filter((x) => x.by !== 'person').sort((a, b) => a.at - b.at).slice(0, Math.max(0, mine.length - NOTES_CAP));
    if (extra.length) await deleteIds(extra.map((x) => x.id));
  }
  return note;
}

async function deleteIds(ids: string[]): Promise<void> {
  const s = await store('notes', 'readwrite');
  await Promise.all(ids.map((id) => done(s.delete(id))));
}

/** Every note of a deleted gardener, a newer build's too (by the raw record's gardenerId). */
export async function deleteNotes(gardenerId: string): Promise<void> {
  await deleteIds((await all('notes')).filter((n) => (n as { gardenerId?: unknown }).gardenerId === gardenerId).map((n) => n.id));
}

export async function deleteNote(id: string): Promise<void> {
  await deleteIds([id]);
}

/** A gardener's notebook (its own and the shared notes), or every note; newest first, without vectors. */
export async function listNotes(gardenerId?: string): Promise<Omit<Note, 'vec'>[]> {
  const list = gardenerId ? forGardener(await notes(), gardenerId) : await notes();
  return list.sort((a, b) => b.at - a.at).map(({ vec: _, ...n }) => n);
}

// ---- typed memory and Documents ----

const entities = async () => (await all('entities')).flatMap((e) => parseEntity(e) ?? []);
const docs = async () => (await all('docs')).flatMap((d) => parseDoc(d) ?? []);
const bare = <T extends { vec?: unknown }>({ vec: _, ...x }: T) => x;
const put = async (name: 'entities' | 'docs', value: Entity | Doc) => void (await done((await store(name, 'readwrite')).put(value)));

/** The entities a prompt may hold: confirmed ones only. */
export const confirmedEntities = async (): Promise<Entity[]> => (await entities()).filter((e) => e.confirmed);

/** A memory file a gardener proposes: unconfirmed, by the model. Its id is the run's step, so a re-run stores it once. */
export async function rememberEntity(e: Pick<Entity, 'id' | 'type' | 'name' | 'body' | 'gardenerId'>): Promise<Entity> {
  const old = parseEntity(await done((await store('entities')).get(e.id)));
  if (old) return old;
  const x = parseEntity({ v: 1, aliases: [], fields: {}, ...e, by: 'model', confirmed: false, at: Date.now() });
  if (!x) throw new Error('That memory file isn’t valid.');
  await put('entities', x);
  return x;
}

/** A gardener's document at `path`, if any. */
export const docAt = async (gardenerId: string, path: string): Promise<Doc | undefined> => (await docs()).find((d) => d.gardenerId === gardenerId && d.path === path);

/** Writes (or replaces) a gardener's document; at most 50 per gardener. */
export async function writeDoc(gardenerId: string | undefined, path: string, text: string, by: Doc['by'], id?: string): Promise<Doc> {
  const all = await docs();
  const old = id ? all.find((d) => d.id === id) : all.find((d) => d.gardenerId === gardenerId && d.path === path);
  const refused = docWriteRefused(old, by);
  if (refused) throw new Error(refused);
  if (!old && all.filter((d) => d.gardenerId === gardenerId).length >= MEM.docs) throw new Error(`A gardener keeps at most ${MEM.docs} documents.`);
  if (all.some((d) => d.gardenerId === gardenerId && d.path === path && d.id !== old?.id)) throw new Error('Another document has that path.');
  const doc = parseDoc({ v: 1, id: old?.id ?? crypto.randomUUID(), path, text, by, at: Date.now(), ...((old?.gardenerId ?? gardenerId) && { gardenerId: old?.gardenerId ?? gardenerId }) });
  if (!doc) throw new Error(`A document has a path of up to ${MEM.path} characters and up to ${MEM.doc} characters of text.`);
  await put('docs', doc);
  return doc;
}

/** Every document of a deleted gardener. */
export async function deleteDocs(gardenerId: string): Promise<void> {
  const s = await store('docs', 'readwrite');
  for (const d of (await done(s.getAll())) as { id: string; gardenerId?: unknown }[]) if (d.gardenerId === gardenerId) s.delete(d.id);
}

const mine = (sender?: chrome.runtime.MessageSender) => {
  if (!isExtensionPage(sender)) throw new Error('Only Homegrown’s own pages can do that.');
};

const words = (x: unknown) => (Array.isArray(x) ? x : String(x ?? '').split(',')).map((a) => String(a).trim()).filter(Boolean);

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
  // Typed memory and Documents: private, so extension pages only. A person's save makes the file theirs and confirmed.
  async entityList(_: unknown, sender?: chrome.runtime.MessageSender) {
    mine(sender);
    return (await entities()).sort((a, b) => b.at - a.at).map(bare);
  },
  async entitySave({ entity }: { entity: Partial<Entity> }, sender?: chrome.runtime.MessageSender) {
    mine(sender);
    const old = entity.id ? parseEntity(await done((await store('entities')).get(entity.id))) : null;
    const e = parseEntity({ v: 1, fields: {}, body: '', ...old, ...entity, aliases: words(entity.aliases ?? old?.aliases), id: old?.id ?? crypto.randomUUID(),
      type: ENTITY_TYPES.includes(entity.type as Entity['type']) ? entity.type : old?.type ?? 'person', by: 'person', confirmed: true, at: Date.now() });
    if (!e) throw new Error(`A memory file needs a name of up to ${MEM.name} characters, and a body of up to ${MEM.body}.`);
    delete e.vec;
    await put('entities', e);
    return bare(e);
  },
  /** Keep a gardener's proposed file as it is: confirmed, still the model's words (so its template stays data). */
  async entityKeep({ id }: { id: string }, sender?: chrome.runtime.MessageSender) {
    mine(sender);
    const e = parseEntity(await done((await store('entities')).get(String(id))));
    if (!e) throw new Error('That memory file is gone.');
    await put('entities', { ...e, confirmed: true });
    return true;
  },
  async entityDelete({ id }: { id: string }, sender?: chrome.runtime.MessageSender) {
    mine(sender);
    await done((await store('entities', 'readwrite')).delete(String(id)));
    return true;
  },
  async docList({ gardenerId }: { gardenerId?: string } = {}, sender?: chrome.runtime.MessageSender) {
    mine(sender);
    return (await docs()).filter((d) => !gardenerId || d.gardenerId === gardenerId).sort((a, b) => a.path.localeCompare(b.path));
  },
  async docGet({ id }: { id: string }, sender?: chrome.runtime.MessageSender) {
    mine(sender);
    return parseDoc(await done((await store('docs')).get(String(id))));
  },
  async docSave({ doc }: { doc: Partial<Doc> }, sender?: chrome.runtime.MessageSender) {
    mine(sender);
    if (!pathOk(doc.path)) throw new Error('That isn’t a valid document path.');
    return writeDoc(doc.gardenerId, doc.path, String(doc.text ?? ''), 'person', doc.id);
  },
  async docDelete({ id }: { id: string }, sender?: chrome.runtime.MessageSender) {
    mine(sender);
    await done((await store('docs', 'readwrite')).delete(String(id)));
    return true;
  },
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
    const scored = (await rank(question, items, (i) => i.embedText)).slice(0, 5);
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
