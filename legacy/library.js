// Library: history, highlights, "Ask your library", flashcards review, savings meter. Data from bg/memory.js
// and chrome.storage.local 'flashcards' (made by the Learn mode quiz).
const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

async function bg(cmd, args = {}) {
  const r = await chrome.runtime.sendMessage({ target: 'bg', cmd, ...args });
  if (!r?.ok) throw new Error(r?.error || `${cmd} failed`);
  return r.result;
}

// Scoped to .lib-tabs / .lib-panel: this file also runs inside the side panel, which has tabs of its own.
for (const b of document.querySelectorAll('.lib-tabs [role=tab]')) {
  b.onclick = () => {
    for (const x of document.querySelectorAll('.lib-tabs [role=tab]')) x.setAttribute('aria-selected', x === b);
    for (const s of document.querySelectorAll('.lib-panel')) s.hidden = s.id !== b.dataset.tab;
  };
}
const when = (t) => new Date(t).toLocaleString();
const link = (url, text) => el('a', { href: url, textContent: text || url, target: '_blank' });

// ---- savings ----
bg('memSavings').then((s) => {
  $('#lib-savings').textContent = `${s.answers} answers on this device · ${(s.inTokens + s.outTokens).toLocaleString()} tokens · about $${s.usd.toFixed(2)} of cloud API cost avoided (estimate at $${s.rate.inPerM}/$${s.rate.outPerM} per million input/output tokens) · ${(s.bytes / 1e6).toFixed(2)} MB of text kept off servers`;
});

// ---- history ----
let timer = 0;
async function renderHistory() {
  const items = await bg('memHistory', { q: $('#history-q').value });
  $('#history-list').replaceChildren(
    ...items.map((h) =>
      el('li', {},
        el('div', {}, el('b', { textContent: h.ask }), ' · ', h.url ? link(h.url, h.title) : '', el('span', { className: 'muted', textContent: ` · ${when(h.time)}` })),
        el('details', {}, el('summary', { textContent: h.answer.slice(0, 160) + (h.answer.length > 160 ? '…' : '') }), el('div', { className: 'answer', textContent: h.answer })),
      )),
  );
  if (!items.length) $('#history-list').append(el('li', { className: 'muted', textContent: 'Nothing yet. Answers you get on pages show up here.' }));
}
$('#history-q').oninput = () => (clearTimeout(timer), (timer = setTimeout(renderHistory, 200)));
$('#history-clear').onclick = async () => confirm('Delete all saved answers?') && (await bg('memClearHistory'), renderHistory());
renderHistory();

// ---- highlights ----
async function renderHighlights() {
  const items = await bg('memHighlights', {});
  const byUrl = Map.groupBy(items.reverse(), (h) => h.url);
  $('#highlight-groups').replaceChildren(
    ...[...byUrl].map(([url, hs]) =>
      el('div', {},
        el('h3', {}, link(url, hs[0].title)),
        el('ul', { className: 'items' }, ...hs.map((h) =>
          el('li', {},
            el('blockquote', { textContent: h.text }),
            h.note ? el('p', { className: 'muted', textContent: h.note }) : '',
            el('button', { className: 'secondary', textContent: 'Delete', onclick: async () => (await bg('memHighlightDelete', { id: h.id }), renderHighlights()) }),
          ))),
      )),
  );
  if (!items.length) $('#highlight-groups').append(el('p', { className: 'muted', textContent: 'Select text on a page and choose Highlight to save it here.' }));
}
renderHighlights();

// ---- ask ----
$('#ask-form').onsubmit = async (e) => {
  e.preventDefault();
  const question = $('#ask-q').value.trim();
  if (!question) return;
  $('#ask-answer').hidden = false;
  $('#ask-answer').textContent = 'Thinking on this device…';
  $('#ask-sources').replaceChildren();
  try {
    const r = await bg('memAsk', { question });
    $('#ask-answer').textContent = r.answer;
    $('#ask-sources').replaceChildren(...r.sources.map((s) => el('li', {}, link(s.url, s.title))));
  } catch (err) {
    $('#ask-answer').textContent = err.message;
  }
};

// ---- flashcards (spaced repetition) ----
const DAY = 864e5;
let cards = [];
let current = null;
async function nextCard() {
  cards = (await chrome.storage.local.get({ flashcards: [] })).flashcards;
  const due = cards.filter((c) => (c.due || 0) <= Date.now());
  $('#cards-count').textContent = cards.length ? `${due.length} due of ${cards.length} cards` : 'No flashcards yet. Use Learn mode on a page to make some.';
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
for (const b of document.querySelectorAll('[data-grade]')) {
  b.onclick = async () => {
    const days = current.interval || 0;
    const interval = { again: 0, good: Math.max(1, days * 2), easy: Math.max(3, days * 3) }[b.dataset.grade];
    Object.assign(current, { interval, due: Date.now() + (interval ? interval * DAY : 10 * 60e3) }); // "again" = in 10 minutes
    await chrome.storage.local.set({ flashcards: cards });
    nextCard();
  };
}
nextCard();
