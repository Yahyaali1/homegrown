// Web reading for search, research, claim checks, related reading and link previews.
// Service workers have no DOMParser, so pages are turned into text with a tag-strip.
import { ask } from './engine.js';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] !== '#' ? ENT[e.toLowerCase()] ?? m : String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)));

// ponytail: regex tag-strip, not a real parser; nested <nav>/<aside> can leave a little chrome in the text.
export function htmlToText(html) {
  const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '').replace(/\s+/g, ' ').trim());
  let body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(head|title|script|style|noscript|svg|nav|footer|header|aside|form|iframe|template)\b[\s\S]*?<\/\1>/gi, ' ');
  const main = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(body);
  if (main && main[2].replace(/<[^>]+>/g, '').trim().length > 500) body = main[2];
  const text = decode(body.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\r ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}

async function fetchText({ url }) {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  if (!/html|text/.test(res.headers.get('content-type') || 'text/html')) throw new Error(`Not a web page: ${url}`);
  return { url: res.url, ...htmlToText(await res.text()) };
}

// DuckDuckGo's HTML endpoint: no key, no JS. Ads link through duckduckgo.com/y.js and are skipped.
export function parseDuckDuckGo(html, n = 8) {
  const out = [];
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=class="result__a"|$)/g;
  for (const m of html.matchAll(re)) {
    let url = decode(m[1]);
    const uddg = /[?&]uddg=([^&]+)/.exec(url);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (url.startsWith('//')) url = `https:${url}`;
    if (!/^https?:/.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue;
    const strip = (s) => decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    const snippet = strip(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(m[3])?.[1] || '');
    out.push({ title: strip(m[2]), url, snippet });
    if (out.length >= n) break;
  }
  return out;
}

// DuckDuckGo first; it answers 202 with a bot challenge when rate limited, so fall back to
// Wikipedia's keyless search API (narrower, but always available).
async function search({ q, n = 8 }) {
  const ddg = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { credentials: 'omit' }).catch(() => null);
  const results = ddg?.ok ? parseDuckDuckGo(await ddg.text(), n) : [];
  if (results.length) return results;
  // Wikipedia ANDs every word, so a whole sentence finds nothing: retry with its longer words.
  const keywords = q.split(/\W+/).filter((w) => w.length > 3).slice(0, 7).join(' ');
  let hits = [];
  for (const query of [q, keywords]) {
    const wiki = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${n}&srsearch=${encodeURIComponent(query)}`);
    hits = wiki.ok ? (await wiki.json()).query?.search || [] : [];
    if (hits.length) break;
  }
  if (!hits.length) throw new Error('Web search is unavailable right now (DuckDuckGo is rate limiting and Wikipedia found nothing).');
  return hits.map((h) => ({
    title: h.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, '_'))}`,
    snippet: decode(h.snippet.replace(/<[^>]+>/g, '')),
  }));
}

const numbered = (items) => items.map((s, i) => `[${i + 1}] ${s.title} (${s.url})\n${s.notes || s.snippet || ''}`).join('\n\n');

// Reads each page and keeps only what bears on the question. Pages that fail to load are skipped.
async function readAll(results, focus, say) {
  const notes = [];
  for (const [i, r] of results.entries()) {
    say?.(`Reading ${i + 1}/${results.length}: ${r.title}`);
    try {
      const page = await fetchText({ url: r.url });
      const n = await ask(`Note the facts on this page that bear on: "${focus}". Reply with 3 to 5 short bullets, or just "irrelevant".`, page.text.slice(0, 12000));
      if (!/^\W*irrelevant/i.test(n.trim())) notes.push({ ...r, notes: n.trim() });
    } catch {}
  }
  return notes;
}

// Progress goes back to the tab that asked, as {type:'web-progress', id, text}.
function progress(msg, sender) {
  return (text) =>
    sender?.tab && chrome.tabs.sendMessage(sender.tab.id, { type: 'web-progress', id: msg.id, text }, { frameId: sender.frameId ?? 0 }).catch(() => {});
}

async function research(msg, sender) {
  const say = progress(msg, sender);
  const n = msg.n || 6;
  say('Searching the web…');
  const results = await search({ q: msg.q, n });
  const notes = await readAll(results, msg.q, say);
  if (!notes.length) throw new Error('None of the top results could be read or were relevant.');
  say('Writing the report…');
  const report = await ask(
    `Answer the question "${msg.q}" using only the numbered sources below. Cite them inline like [1]. ` +
      'Start with a two-sentence answer, then the key points as bullets. Say where sources disagree.',
    numbered(notes),
  );
  return { report, sources: notes.map(({ title, url }) => ({ title, url })) };
}

async function checkClaim(msg, sender) {
  const say = progress(msg, sender);
  say('Searching for sources…');
  const results = (await search({ q: msg.claim.slice(0, 300), n: 5 })).slice(0, 3);
  const notes = await readAll(results, msg.claim, say);
  const sources = notes.length ? notes : results; // fall back to snippets if pages won't load
  say('Weighing the sources…');
  const verdict = await ask(
    `Claim: "${msg.claim}"\nDo the numbered sources below support it? Start with one word: Supported, Contradicted, Mixed or Unclear. ` +
      'Then explain in two or three sentences, citing sources like [1].',
    numbered(sources),
  );
  return { verdict, sources: sources.map(({ title, url }) => ({ title, url })) };
}

async function related(msg) {
  const host = (u) => new URL(u).hostname.replace(/^www\./, '');
  const results = (await search({ q: msg.title, n: 10 })).filter((r) => r.url !== msg.url && host(r.url) !== host(msg.url)).slice(0, 5);
  const why = await ask(
    `Someone is reading "${msg.title}". For each numbered result below, write one line "[n] why it's worth reading next" (max 15 words each).`,
    numbered(results),
  );
  return { why, sources: results.map(({ title, url }) => ({ title, url })) };
}

export const handlers = { fetchText, search, research, checkClaim, related };
