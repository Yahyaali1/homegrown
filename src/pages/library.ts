// Library: history, highlights, "Ask your library", flashcard review and the savings meter. Data from the worker's
// memory and chrome.storage.local 'flashcards'. Also runs inside the side panel's Library tab.
import { $ } from './shell.ts';
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
