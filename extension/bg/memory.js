// Memory: answer history, highlights, a small knowledge base of pages you ran tasks on, and the
// savings meter. Everything stays in this browser (IndexedDB 'eg-memory', chrome.storage.local 'savings').
import { engine, ask } from './engine.js';

const HISTORY_CAP = 2000;
const SIMILAR = 0.6; // cosine for "same topic"; calibrated on MiniLM: related pages ~0.72, unrelated < 0.1
const RATE = { inPerM: 0.5, outPerM: 1.5 }; // ponytail: rough cloud price (USD per 1M tokens) for the estimate

const db = new Promise((resolve, reject) => {
  const r = indexedDB.open('eg-memory', 1);
  r.onupgradeneeded = () => {
    const d = r.result;
    d.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
    d.createObjectStore('highlights', { keyPath: 'id', autoIncrement: true }).createIndex('url', 'url');
    d.createObjectStore('kb', { keyPath: 'id', autoIncrement: true }).createIndex('url', 'url');
  };
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
const done = (r) => new Promise((resolve, reject) => ((r.onsuccess = () => resolve(r.result)), (r.onerror = () => reject(r.error))));
const store = async (name, mode = 'readonly') => (await db).transaction(name, mode).objectStore(name);
const all = async (name) => done((await store(name)).getAll());

async function embed(texts) {
  const r = await engine('embed', { texts });
  return r.vectors ?? r;
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) (dot += a[i] * b[i]), (na += a[i] * a[i]), (nb += b[i] * b[i]);
  return dot / (Math.sqrt(na * nb) || 1);
}

// Fills in embeddings that failed earlier (the embedding model may not have been ready).
async function withVectors(name) {
  const items = await all(name);
  const missing = items.filter((i) => !i.vec);
  if (missing.length) {
    try {
      const vecs = await embed(missing.map((i) => i.embedText));
      const s = await store(name, 'readwrite');
      missing.forEach((i, k) => ((i.vec = Array.from(vecs[k])), s.put(i)));
    } catch {} // still not ready: callers fall back to keywords
  }
  return items;
}

async function addHistory(entry) {
  const s = await store('history', 'readwrite');
  await done(s.add(entry));
  const n = await done(s.count());
  if (n <= HISTORY_CAP) return;
  let extra = n - HISTORY_CAP;
  const cur = s.openCursor(); // oldest first (autoIncrement keys)
  cur.onsuccess = () => cur.result && extra-- > 0 && (cur.result.delete(), cur.result.continue());
}

async function addKb(url, title, summary) {
  const embedText = `${title}\n${summary}`.slice(0, 1500);
  let vec = null;
  try {
    vec = Array.from((await embed([embedText]))[0]);
  } catch {}
  const s = await store('kb', 'readwrite');
  for (const old of await done(s.index('url').getAll(url))) s.delete(old.id);
  s.add({ url, title, summary, embedText, vec, time: Date.now() });
}

export async function onAnswer(req, r, sender) {
  // Only what a person asked for (saved tasks have a title, free questions a question). Feature-driven
  // calls (ghost text, gists, page translation) send quiet: true or no title, and would flood history and savings.
  if (req.quiet || (!req.task?.title && !req.question)) return;
  const url = req.page?.url || sender?.tab?.url || sender?.url || '';
  const title = req.page?.title || sender?.tab?.title || '';
  addHistory({ url, title, ask: req.task?.title || req.question, answer: r.text, time: Date.now() });

  const input = (req.page?.text || req.selection || '') + (req.question || '') + (r.userText || '');
  const { savings = { answers: 0, inTokens: 0, outTokens: 0, bytes: 0 } } = await chrome.storage.local.get('savings');
  savings.answers++;
  savings.inTokens += r.stats?.prefillTokens || 0;
  savings.outTokens += r.stats?.outputTokens || 0;
  savings.bytes += new TextEncoder().encode(input).length;
  chrome.storage.local.set({ savings });
  if (!req.history?.length && url.startsWith('http') && (req.page || (req.selection?.length || 0) > 500)) addKb(url, title, r.text.slice(0, 800));
}

function keywordScore(q, text) {
  const words = q.toLowerCase().match(/\w{4,}/g) || [];
  const t = text.toLowerCase();
  return words.filter((w) => t.includes(w)).length / (words.length || 1);
}

export const handlers = {
  async memHistory({ q = '', limit = 200 }) {
    const items = (await all('history')).reverse();
    const ql = q.toLowerCase();
    return items.filter((h) => !ql || `${h.title} ${h.ask} ${h.answer} ${h.url}`.toLowerCase().includes(ql)).slice(0, limit);
  },
  async memClearHistory() {
    await done((await store('history', 'readwrite')).clear());
  },
  async memHighlightSave({ text, url, title, wantNote }) {
    const item = { text, url, title, note: '', embedText: `${title}\n${text}`.slice(0, 1500), time: Date.now() };
    item.id = await done((await store('highlights', 'readwrite')).add(item));
    if (wantNote) {
      item.note = await ask('In one sentence, say why this passage might matter to the reader later. Reply with the sentence only.', text).catch(() => '');
      (await store('highlights', 'readwrite')).put(item);
    }
    return item;
  },
  async memHighlights({ url }) {
    if (!url) return all('highlights');
    return done((await store('highlights')).index('url').getAll(url));
  },
  async memHighlightDelete({ id }) {
    await done((await store('highlights', 'readwrite')).delete(id));
  },
  // "Have I read this before?": the closest past page on the same topic, or null.
  async memSimilar({ text, url }) {
    const items = (await withVectors('kb')).filter((i) => i.vec && i.url !== url);
    if (!items.length) return null;
    const q = (await embed([text]))[0];
    const best = items.map((i) => ({ url: i.url, title: i.title, score: cosine(q, i.vec) })).sort((a, b) => b.score - a.score)[0];
    return best.score > SIMILAR ? best : null;
  },
  // Ask your library: answer from saved pages and highlights, citing them.
  async memAsk({ question }) {
    const items = [...(await withVectors('kb')), ...(await withVectors('highlights'))];
    if (!items.length) return { answer: 'Your library is empty. Run a task on a page or save a highlight first.', sources: [] };
    let q = null;
    try {
      q = (await embed([question]))[0];
    } catch {}
    const scored = items
      .map((i) => ({ i, score: q && i.vec ? cosine(q, i.vec) : keywordScore(question, i.embedText) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    const sources = scored.map(({ i }, n) => ({ n: n + 1, title: i.title, url: i.url }));
    const notes = scored.map(({ i }, n) => `[${n + 1}] ${i.title}\n${i.summary || i.text}${i.note ? `\nNote: ${i.note}` : ''}`).join('\n\n');
    const answer = await ask(`Answer this question using only the saved notes below. Cite them like [1]. If they don't answer it, say so.\nQuestion: ${question}`, notes);
    return { answer, sources };
  },
  async memSavings() {
    const { savings = { answers: 0, inTokens: 0, outTokens: 0, bytes: 0 } } = await chrome.storage.local.get('savings');
    return { ...savings, usd: (savings.inTokens * RATE.inPerM + savings.outTokens * RATE.outPerM) / 1e6, rate: RATE };
  },
  // Voice: the engine owns the speech model; content scripts reach it through here.
  transcribe: (msg) => engine('transcribe', { audio: msg.audio, sampleRate: msg.sampleRate }),
};
