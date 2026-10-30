// Library: history, highlights, "Ask your library", flashcard review, Memory and the savings meter. Data from the worker's
// memory and chrome.storage.local 'flashcards'. Also runs inside the side panel's Library tab.
import { $, busyButton, errLine, fail, tryIt } from './shell.ts';
import { ENTITY_TYPES, type Doc, type Entity, type EntityType } from '../domain/memory.ts';
import { h } from '../ui/dom.ts';
import { bg } from '../shared/protocol.ts';
import { savingsLine, type Savings } from './savings.ts';

// Scoped to .lib-tabs / .lib-panel: the side panel has tabs of its own.
for (const b of document.querySelectorAll<HTMLElement>('.lib-tabs [role=tab]')) {
  b.onclick = () => {
    for (const x of document.querySelectorAll('.lib-tabs [role=tab]')) x.setAttribute('aria-selected', String(x === b));
    for (const s of document.querySelectorAll<HTMLElement>('.lib-panel')) s.hidden = s.id !== b.dataset.tab;
  };
}
const when = (t: number) => new Date(t).toLocaleString();
const link = (url: string, text?: string) => h('a', { href: /^(https?|file):/.test(url) ? url : '#', textContent: text || url, target: '_blank' });

bg<Savings>('memSavings').then((s) => ($('#lib-savings').textContent = savingsLine(s, true)), () => {});

// ---- history ----
interface HistoryEntry { url: string; title: string; ask: string; answer: string; time: number }
let timer: ReturnType<typeof setTimeout> | undefined;
async function renderHistory(): Promise<void> {
  const items = await bg<HistoryEntry[]>('memHistory', { q: $<HTMLInputElement>('#history-q').value });
  $('#history-list').replaceChildren(...items.map((e) => h('li', {},
    h('div', {}, h('b', { textContent: e.ask }), ' · ', e.url ? link(e.url, e.title) : '', h('span', { className: 'muted', textContent: ` · ${when(e.time)}` })),
    h('details', {}, h('summary', { textContent: e.answer.slice(0, 160) + (e.answer.length > 160 ? '…' : '') }), h('div', { className: 'answer', textContent: e.answer })))));
  if (!items.length) $('#history-list').append(h('li', { className: 'muted', textContent: 'Nothing yet. Answers you get on pages show up here.' }));
}
$('#history-q').oninput = () => (clearTimeout(timer), (timer = setTimeout(() => void renderHistory(), 200)));
$('#history-clear').onclick = async () => {
  if (confirm('Delete all saved answers?')) (await bg('memClearHistory'), void renderHistory());
};
void renderHistory();

// ---- highlights ----
interface Highlight { id: number; url: string; title: string; text: string; note: string }
async function renderHighlights(): Promise<void> {
  const items = (await bg<Highlight[]>('memHighlights', {})).reverse();
  const byUrl = Map.groupBy(items, (x) => x.url);
  $('#highlight-groups').replaceChildren(...[...byUrl].map(([url, hs]) => h('div', {},
    h('h3', {}, link(url, hs[0]?.title)),
    h('ul', { className: 'items' }, ...hs.map((x) => h('li', {},
      h('blockquote', { textContent: x.text }),
      x.note && h('p', { className: 'muted', textContent: x.note }),
      h('button', { className: 'secondary', textContent: 'Delete', onclick: async () => (await bg('memHighlightDelete', { id: x.id }), void renderHighlights()) })))))));
  if (!items.length) $('#highlight-groups').append(h('p', { className: 'muted', textContent: 'Select text on a page and choose Highlight to save it here.' }));
}
void renderHighlights();

// ---- ask ----
$<HTMLFormElement>('#ask-form').onsubmit = async (e) => {
  e.preventDefault();
  const question = $<HTMLInputElement>('#ask-q').value.trim();
  if (!question) return;
  const answer = $('#ask-answer');
  answer.hidden = false;
  answer.textContent = 'Thinking on this device…';
  $('#ask-sources').replaceChildren();
  try {
    const r = await bg<{ answer: string; sources: { url: string; title: string }[] }>('memAsk', { question });
    answer.textContent = r.answer;
    $('#ask-sources').replaceChildren(...r.sources.map((s) => h('li', {}, link(s.url, s.title))));
  } catch (err) {
    answer.textContent = (err as Error).message;
  }
};

// ---- flashcards (spaced repetition) ----
interface Flashcard { id: string; q: string; a: string; url?: string; title?: string; due?: number | string; interval?: number }
const DAY = 864e5;
let cards: Flashcard[] = [];
let current: Flashcard | undefined;
const dueAt = (c: Flashcard) => (typeof c.due === 'string' ? Date.parse(c.due) : c.due ?? 0);
async function nextCard(): Promise<void> {
  const { flashcards } = await chrome.storage.local.get('flashcards');
  cards = Array.isArray(flashcards) ? flashcards : [];
  const due = cards.filter((c) => dueAt(c) <= Date.now());
  $('#cards-count').textContent = cards.length ? `${due.length} due of ${cards.length} cards` : 'No flashcards yet. Use Make flashcards on a page to make some.';
  current = due[0];
  $('#card').hidden = !current;
  if (!current) return;
  $('#card-q').textContent = current.q;
  $('#card-a').textContent = current.a;
  $('#card-a').hidden = true;
  $('#card-src').replaceChildren(...(current.url ? ['From ', link(current.url, current.title)] : []));
  $('#card-show').hidden = false;
  $('#card-grade').hidden = true;
}
$('#show').onclick = () => (($('#card-a').hidden = false), ($('#card-show').hidden = true), ($('#card-grade').hidden = false));
for (const b of document.querySelectorAll<HTMLElement>('[data-grade]')) {
  b.onclick = async () => {
    if (!current) return;
    const days = current.interval ?? 0;
    const interval = ({ again: 0, good: Math.max(1, days * 2), easy: Math.max(3, days * 3) } as Record<string, number>)[b.dataset.grade ?? ''] ?? 0;
    Object.assign(current, { interval, due: Date.now() + (interval ? interval * DAY : 10 * 60e3) }); // "again" means in 10 minutes
    await chrome.storage.local.set({ flashcards: cards });
    void nextCard();
  };
}
void nextCard();

// ---- memory: typed files in folders by type, then each gardener's Documents (plan T7) ----
const FOLDERS: Record<EntityType, string> = { person: 'People', project: 'Projects', event: 'Events', research: 'Research', preference: 'Preferences' };
const openIds = new Set<string>(); // folders and files left open survive a re-render
type Listed = Omit<Entity, 'vec'>;

const folder = (key: string, title: string, items: HTMLElement[]) => kept(h('details', { className: 'folder' }, h('summary', { textContent: `${title} (${items.length})` }), ...items), key);
function kept<T extends HTMLDetailsElement>(d: T, key: string): T {
  d.dataset.key = key;
  d.open = openIds.has(key);
  d.ontoggle = () => (d.open ? openIds.add(key) : openIds.delete(key));
  return d;
}
const fieldsText = (f: Record<string, string>) => Object.entries(f).map(([k, v]) => `${k}: ${v}`).join('\n');
const fieldsOf = (text: string) => Object.fromEntries(text.split('\n').map((l) => /^([^:]+):\s*(.*)$/.exec(l.trim())).filter((m) => !!m).map((m) => [m[1]!.trim(), m[2]!.trim()]));

function entityFile(e: Listed): HTMLElement {
  const err = errLine();
  const aliases = h('input', { value: e.aliases.join(', '), attrs: { 'aria-label': `Aliases of ${e.name}` } });
  const fields = h('textarea', { rows: 2, value: fieldsText(e.fields), placeholder: 'One per line, e.g. Role: designer', attrs: { 'aria-label': `Fields of ${e.name}` } });
  const template = h('textarea', { rows: 2, maxLength: 8000, value: e.template ?? '', placeholder: 'How work for this is done (optional)', attrs: { 'aria-label': `Template of ${e.name}` } });
  const body = h('textarea', { rows: 6, maxLength: 8000, value: e.body, placeholder: 'Markdown', attrs: { 'aria-label': `Body of ${e.name}` } });
  const save = busyButton('Save', tryIt(err, async () => {
    await bg('entitySave', { entity: { id: e.id, aliases: aliases.value, fields: fieldsOf(fields.value), template: template.value, body: body.value } });
    await renderMemory();
  }), 'primary');
  const del = busyButton(e.confirmed ? 'Delete' : 'Discard', tryIt(err, async () => (await bg('entityDelete', { id: e.id }), await renderMemory())), 'ghost');
  const keep = !e.confirmed && busyButton('Keep', tryIt(err, async () => (await bg('entityKeep', { id: e.id }), await renderMemory())), 'secondary');
  const by = e.confirmed ? (e.correction ? 'your correction' : e.by === 'person' ? '' : 'kept from a gardener') : 'proposed by a gardener, off until you keep it';
  return kept(h('details', { className: 'file' }, h('summary', {}, e.name, by && h('span', { className: 'muted small', textContent: ` · ${by}` })),
    h('div', { className: 'stack' }, aliases, fields, template, body, err, h('div', { className: 'row' }, keep, save, del))), e.id);
}

function docFile(d: Doc): HTMLElement {
  const err = errLine();
  const text = h('textarea', { rows: 8, maxLength: 20000, value: d.text, attrs: { 'aria-label': `Text of ${d.path}` } });
  return kept(h('details', { className: 'file' }, h('summary', {}, d.path, d.by === 'model' && h('span', { className: 'muted small', textContent: ' · written by the gardener' })),
    h('div', { className: 'stack' }, text, err, h('div', { className: 'row' },
      busyButton('Save', tryIt(err, async () => (await bg('docSave', { doc: { ...d, text: text.value } }), await renderMemory())), 'primary'),
      busyButton('Delete', tryIt(err, async () => (await bg('docDelete', { id: d.id }), await renderMemory())), 'ghost')))), d.id);
}

async function renderMemory(): Promise<void> {
  const [list, docs, gardeners] = await Promise.all([bg<Listed[]>('entityList'), bg<Doc[]>('docList'), bg<{ id: string; name: string }[]>('gardenerList').catch(() => [])]);
  const byType = ENTITY_TYPES.map((t) => folder(t, FOLDERS[t], list.filter((e) => e.type === t).map(entityFile)));
  const groups = Map.groupBy(docs, (d) => d.gardenerId ?? '');
  const docFolders = [...groups].map(([id, ds]) => folder(`docs/${id}`, gardeners.find((g) => g.id === id)?.name ?? 'No gardener', ds.map(docFile)));
  const documents = folder('docs', 'Documents', docFolders);
  documents.firstElementChild!.textContent = `Documents (${docs.length})`;
  $('#memory-tree').replaceChildren(...byType, documents);
}

const newType = $<HTMLSelectElement>('#memory-type');
newType.replaceChildren(...ENTITY_TYPES.map((t) => new Option(FOLDERS[t], t)));
$<HTMLFormElement>('#memory-new').onsubmit = (e) => {
  e.preventDefault();
  const name = $<HTMLInputElement>('#memory-name');
  if (!name.value.trim()) return;
  void tryIt($('#memory-err'), async () => {
    const x = await bg<Listed>('entitySave', { entity: { type: newType.value, name: name.value.trim(), aliases: $<HTMLInputElement>('#memory-aliases').value } });
    openIds.add(x.type).add(x.id);
    name.value = $<HTMLInputElement>('#memory-aliases').value = '';
    await renderMemory();
  })();
};
void renderMemory().catch((e) => fail($('#memory-err'), e));

/** Shows a memory file or document (a run's created card): the Memory tab, its folders and the file open. */
export async function openMemory(id: string): Promise<void> {
  document.querySelector<HTMLElement>('.tabs [data-tab=library]')?.click(); // the side panel's own tab, when inside it
  document.querySelector<HTMLElement>('.lib-tabs [data-tab=memory]')?.click();
  const [list, docs] = await Promise.all([bg<Listed[]>('entityList'), bg<Doc[]>('docList')]);
  const e = list.find((x) => x.id === id), d = docs.find((x) => x.id === id);
  for (const k of e ? [e.type, id] : d ? ['docs', `docs/${d.gardenerId ?? ''}`, id] : []) openIds.add(k);
  await renderMemory();
  document.querySelector(`#memory-tree [data-key="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
}
