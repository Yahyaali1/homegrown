// Outputs in the worker: the `hg-outputs` store of artifacts, decks a model measured for `deck` writes, one cited
// answer across the reader's files for a model measured for `cite`, a brand kit read from a site, and a PNG of an
// output page. Without the ability, code builds the deck and the passages are the answer.
import { all, del, get, open, put } from '../shared/idb.ts';
import { askAs, measured } from './engine.ts';
import { waitLoaded } from './missions.ts';
import { pagesOnly, screenshot } from './pagerequest.ts';
import { contextChars } from '../domain/text.ts';
import { citeFiles, READER_FILES, type DocFile } from '../domain/reading.ts';
import { parsePageOptions } from '../domain/scrape/options.ts';
import { DECK_MAX, deckFromBrief, deckFromTable, fontStack, parseArtifact, tableText, writeDeck, type Artifact, type Brand } from '../domain/outputs.ts';

type Sender = chrome.runtime.MessageSender | undefined;
let dbp: Promise<IDBDatabase> | null = null;
const db = () => (dbp ??= open('hg-outputs', 1, (d, old) => {
  if (old < 1) d.createObjectStore('artifacts', { keyPath: 'id' });
}));

export function base64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Stores an artifact (a new one gets an id and a time). Throws on a bad record. */
export async function saveArtifact(raw: Partial<Artifact>): Promise<Artifact> {
  const a = parseArtifact({ v: 1, id: crypto.randomUUID(), at: Date.now(), ...raw });
  if (!a) throw new Error('That output is not valid.');
  await put(await db(), 'artifacts', a);
  return a;
}

const ask = (m: { name: string }, prompt: string, data: string) => askAs(prompt, data, { task: 'background', model: m.name, owner: 'outputs' }).then((r) => r.text);

/** A deck from a brief or a table: the model writes it with `deck` (bad JSON: one repair), else code builds it. */
async function deckMake({ id }: { id: string }): Promise<Artifact> {
  const a = parseArtifact(await get(await db(), 'artifacts', id));
  if (!a || !['brief', 'table', 'chart'].includes(a.kind)) throw new Error('A deck is made from a brief or a table.');
  const md = a.kind === 'brief' ? a.data.md : null;
  const table = a.kind === 'table' || a.kind === 'chart' ? a.data : null;
  const m = await measured('deck');
  const deck = m && (await writeDeck((p, d = '') => ask(m, p, d), md ?? tableText(table!), contextChars(m.maxTokens)));
  if (deck && table && deck.slides.length < DECK_MAX) deck.slides.push({ title: a.title, bullets: [], chart: table });
  const data = deck ?? (md !== null ? deckFromBrief(a.title, md) : deckFromTable(a.title, table!));
  return saveArtifact({ kind: 'deck', title: a.title, data, ...(a.runId && { runId: a.runId }), ...(a.chatId && { chatId: a.chatId }) });
}

/** One cited answer across the reader's files (`citeFiles`), or null without the `cite` ability: the page shows the passages. */
async function citeAnswer({ question, files }: { question: string; files: DocFile[] }): Promise<{ text: string; dropped: number; model: string } | null> {
  files = (Array.isArray(files) ? files : []).slice(0, READER_FILES).map((f) => ({ name: String(f.name).slice(0, 200), pages: (Array.isArray(f.pages) ? f.pages : []).map(String) }));
  const m = await measured('cite');
  return m && { ...(await citeFiles((p, d = '') => ask(m, p, d), String(question), files, contextChars(m.maxTokens) - 600)), model: m.name };
}

/** The whole Homegrown page that asks (an output) as a PNG data URL, with the existing full-page debugger screenshot. */
async function pageShot(_: unknown, sender: Sender): Promise<string> {
  const tabId = sender?.tab?.id;
  if (tabId === undefined) throw new Error('Only a page in a tab can be saved as a PNG.');
  if (!(await chrome.permissions.contains({ permissions: ['debugger'] }))) throw new Error('A PNG of the page needs the debugger permission.');
  await chrome.debugger.attach({ tabId }, '1.3');
  try {
    return (await screenshot(tabId, parsePageOptions({ screenshot_full_page: true })!))!;
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

// Runs in the named page: computed style values and image URLs only, never page text. Colours go through a canvas
// pixel, so any CSS colour comes back as rgb() (transparent as '').
function readBrand() {
  const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  const rgb = (v: string | undefined) => {
    if (!v) return '';
    c.clearRect(0, 0, 1, 1);
    c.fillStyle = v;
    c.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = c.getImageData(0, 0, 1, 1).data;
    return a ? `rgb(${r}, ${g}, ${b})` : '';
  };
  const style = (sel: string) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el) : null;
  };
  const body = getComputedStyle(document.body);
  const button = style('button, [role=button], input[type=submit], a.button, a.btn, .btn');
  const text = rgb(body.color) || 'rgb(17, 17, 17)';
  const link = rgb(style('a[href]')?.color) || text;
  const logo = document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content
    || document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href
    || document.querySelector<HTMLImageElement>('header img')?.src;
  return {
    bg: rgb(body.backgroundColor) || rgb(getComputedStyle(document.documentElement).backgroundColor) || 'rgb(255, 255, 255)',
    text, link,
    button: rgb(button?.backgroundColor) || link,
    buttonText: rgb(button?.color) || 'rgb(255, 255, 255)',
    font: body.fontFamily,
    headingFont: style('h1, h2')?.fontFamily ?? body.fontFamily,
    logo: logo ? new URL(logo, location.href).href : '',
  };
}

/** A brand kit from a page the person names: no model. The logo is kept as a data URL (≤ 300 KB), so a deck never fetches it. */
async function brandRead({ url }: { url: string }) {
  if (!/^https?:\/\//.test(url)) throw new Error('Give a web address (https://…).');
  const tab = await chrome.tabs.create({ url, active: false });
  let read: ReturnType<typeof readBrand> | undefined;
  try {
    await waitLoaded(tab.id!, 20000);
    read = (await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: readBrand }))[0]?.result;
  } finally {
    await chrome.tabs.remove(tab.id!).catch(() => {});
  }
  if (!read) throw new Error('That page could not be read.');
  let logo: string | undefined;
  const res = /^https?:/.test(read.logo) ? await fetch(read.logo, { credentials: 'omit' }).catch(() => null) : null;
  const type = res?.ok ? res.headers.get('content-type')?.split(';')[0] ?? '' : '';
  if (res && /^image\/(png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon)$/.test(type)) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length <= 300_000) logo = `data:${type};base64,${base64(bytes)}`;
  }
  const site = new URL(url).hostname.replace(/^www\./, '');
  const { logo: _, ...styles } = read;
  const brand: Brand = { ...styles, font: fontStack(read.font), headingFont: fontStack(read.headingFont), site, ...(logo && { logo }) };
  return saveArtifact({ kind: 'brand', title: site, data: brand });
}

// Artifacts hold what the person researched: only Homegrown's own pages read or change them.
export const handlers = pagesOnly({
  artifactSave: ({ artifact }: { artifact: Partial<Artifact> }) => saveArtifact(artifact),
  artifactGet: async ({ id }: { id: string }) => parseArtifact(await get(await db(), 'artifacts', id)),
  /** Newest first. */
  artifactList: async () => (await all(await db(), 'artifacts')).map(parseArtifact).filter((a) => a !== null).sort((x, y) => y.at - x.at),
  artifactDelete: async ({ id }: { id: string }) => (await del(await db(), 'artifacts', id), true),
  deckMake,
  citeAnswer,
  pageShot,
  brandRead,
});
