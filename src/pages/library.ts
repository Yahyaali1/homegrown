// Library: history, highlights, "Ask your library", flashcard review, Memory and the savings meter. Data from the worker's
// memory and chrome.storage.local 'flashcards'. Also runs inside the side panel's Library tab.
import { $, busyButton, errLine, fail, tryIt } from './shell.ts';
import { ENTITY_TYPES, type Doc, type Entity, type EntityType, type HistoryEntry } from '../domain/memory.ts';
import { h } from '../ui/dom.ts';
import { bg, engineCall } from '../shared/protocol.ts';
import { savingsLine, type Savings } from './savings.ts';
import { docsOfMeeting, fileRefused, isMeetingPath, itemsOf, meetingOf, notesOf, type Recording } from '../domain/meeting.ts';

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
/** A question form: `#<id>-q` asked through `cmd`, the answer in `#<id>-answer` and its sources in `#<id>-sources`. */
function askForm<S>(id: string, cmd: string, args: object, source: (s: S) => Node | string): void {
  $<HTMLFormElement>(`#${id}-form`).onsubmit = async (e) => {
    e.preventDefault();
    const question = $<HTMLInputElement>(`#${id}-q`).value.trim();
    if (!question) return;
    const answer = $(`#${id}-answer`);
    answer.hidden = false;
    answer.textContent = 'Thinking on this device…';
    $(`#${id}-sources`).replaceChildren();
    try {
      const r = await bg<{ answer: string; sources: S[] }>(cmd, { question, ...args });
      answer.textContent = r.answer;
      $(`#${id}-sources`).replaceChildren(...r.sources.map((s) => h('li', {}, source(s))));
    } catch (err) {
      answer.textContent = (err as Error).message;
    }
  };
}
askForm('ask', 'memAsk', {}, (s: { url: string; title: string }) => link(s.url, s.title));
askForm('meet', 'meetAsk', { answer: true }, (s: { title: string; at: string }) => `${s.title}${s.at ? ` at ${s.at}` : ''}`);

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

// ---- memory: typed files in folders by type, then each gardener's Documents; meetings have their own tab ----
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
  const by = e.confirmed ? (e.correction ? 'your correction' : e.by === 'person' ? '' : 'kept from a gardener') : e.by === 'person' ? 'from a companion pack, off until you keep it' : 'proposed by a gardener, off until you keep it';
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

const isMeeting = (d: Doc) => !d.gardenerId && isMeetingPath(d.path);

async function renderMemory(): Promise<void> {
  const [list, docs, gardeners] = await Promise.all([bg<Listed[]>('entityList'), bg<Doc[]>('docList'), bg<{ id: string; name: string }[]>('gardenerList').catch(() => [])]);
  const byType = ENTITY_TYPES.map((t) => folder(t, FOLDERS[t], list.filter((e) => e.type === t && !e.fields.meeting).map(entityFile)));
  const others = docs.filter((d) => !isMeeting(d));
  const groups = Map.groupBy(others, (d) => d.gardenerId ?? '');
  const docFolders = [...groups].map(([id, ds]) => folder(`docs/${id}`, gardeners.find((g) => g.id === id)?.name ?? 'No gardener', ds.map(docFile)));
  const documents = folder('docs', 'Documents', docFolders);
  documents.firstElementChild!.textContent = `Documents (${others.length})`;
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

/** Shows a memory file or document (a run's created card): its tab (Memory, or Meetings), its folders and the file open. */
export async function openMemory(id: string): Promise<void> {
  document.querySelector<HTMLElement>('.tabs [data-tab=library]')?.click(); // the side panel's own tab, when inside it
  const [list, docs] = await Promise.all([bg<Listed[]>('entityList'), bg<Doc[]>('docList')]);
  const d = docs.find((x) => x.id === id);
  const e = list.find((x) => x.id === id || (d && isMeeting(d) && x.fields.meeting && x.name === meetingOf(d.path)));
  const meeting = !!e?.fields.meeting;
  document.querySelector<HTMLElement>(`.lib-tabs [data-tab=${meeting ? 'meetings' : 'memory'}]`)?.click();
  for (const k of e ? [e.type, e.id] : d ? ['docs', `docs/${d.gardenerId ?? ''}`, id] : []) openIds.add(k);
  await (meeting ? renderMeetings() : renderMemory());
  document.querySelector(`[data-key="${CSS.escape(e?.id ?? id)}"]`)?.scrollIntoView({ block: 'nearest' });
}

// ---- meetings: record the call's tab with the mic, transcribe a file, ask across them, and the list ----
const meetErr = $('#meet-err');

async function showRecording(): Promise<void> {
  const r = ((await chrome.storage.session.get('meeting')).meeting as Recording | undefined) ?? null;
  $('#meet-record').textContent = r ? '■ Stop and save' : '● Record this tab';
  $('#meet-state').textContent = r
    ? `Recording “${r.title}” since ${new Date(r.started).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${r.mic ? ', with your microphone' : ', its sound only'}.`
    : 'Record works on the call’s tab: Record here, Alt+Shift+M, or right-click the page → Record this meeting.';
  const mic = await navigator.permissions.query({ name: 'microphone' as PermissionName }).catch(() => null);
  $('#meet-mic').hidden = !mic || mic.state === 'granted';
}
chrome.storage.session.onChanged.addListener((c) => c.meeting && (void showRecording(), !c.meeting.newValue && void renderMeetings()));
chrome.runtime.onMessage.addListener((m: { source?: string; type?: string; text?: string }) => {
  if (m?.type === 'meeting-notes') void showRecording().then(renderMeetings).catch((e) => fail(meetErr, e));
  if (m?.source === 'engine' && m.type === 'meeting-progress') $('#meet-state').textContent = m.text ?? '';
});
void showRecording();

// Chrome shares a tab's sound only after a click on the extension: the stream id is asked for here, in the click.
$('#meet-record').onclick = tryIt(meetErr, async () => {
  if ((await chrome.storage.session.get('meeting')).meeting) return void (await bg('meetStop'), await renderMeetings());
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined || !/^https?:/.test(tab.url ?? '')) throw new Error('Open the call’s tab first, then Record.');
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }).catch(() => '');
  await bg('meetStart', { tabId: tab.id, streamId });
});
// The mic is granted once to Homegrown's pages; the recorder (offscreen) then uses it.
$('#meet-mic').onclick = tryIt(meetErr, async () => {
  (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop());
  await showRecording();
});

// A file goes to the recorder as a blob URL, decoded and transcribed there; the worker saves it and the list redraws.
$<HTMLInputElement>('#meet-file').onchange = (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  void tryIt(meetErr, async () => {
    const big = fileRefused(file.size);
    if (big) throw new Error(big);
    const url = URL.createObjectURL(file);
    try {
      await engineCall('meetFile', { url, title: file.name.replace(/\.[^.]+$/, '') });
    } finally {
      URL.revokeObjectURL(url);
      input.value = '';
    }
  })();
};

function meetingEl(e: Listed, docs: Doc[]): HTMLElement {
  const err = errLine();
  const name = h('input', { value: e.name, maxLength: 80, attrs: { 'aria-label': `Name of ${e.name}` } });
  const items = itemsOf(e.body);
  const list = h('ul', { className: 'items checklist' }, ...items.map((it, n) => h('li', {}, h('label', { className: 'check' },
    h('input', { type: 'checkbox', checked: it.done, onchange: (ev) => void tryIt(err, () => bg('meetCheck', { id: e.id, n, done: (ev.target as HTMLInputElement).checked }))() }), ` ${it.text}`))));
  const transcript = docs.map((d) => d.text).join('\n');
  const off = !e.confirmed && h('span', { className: 'muted small', textContent: ' · notes by the model, off until you keep them' });
  return kept(h('details', { className: 'file' }, h('summary', {}, e.name, h('span', { className: 'muted small', textContent: ` · ${e.fields.length ?? ''}${e.fields.meeting === 'file' ? ' · file' : ''}` }), off || ''),
    h('div', { className: 'stack' },
      h('div', { className: 'answer', textContent: notesOf(e.body) }), items.length ? list : '',
      h('details', {}, h('summary', { textContent: 'Transcript' }), h('div', { className: 'answer small', textContent: transcript || '(empty)' })),
      h('div', { className: 'row' }, name, busyButton('Rename', tryIt(err, async () => (await bg('meetRename', { id: e.id, name: name.value }), await renderMeetings())), 'secondary')),
      err,
      h('div', { className: 'row' },
        !e.confirmed && busyButton('Keep', tryIt(err, async () => (await bg('entityKeep', { id: e.id }), await renderMeetings())), 'secondary'),
        busyButton('Delete', tryIt(err, async () => (await bg('meetDelete', { id: e.id }), await renderMeetings())), 'ghost')))), e.id);
}

async function renderMeetings(): Promise<void> {
  const [list, docs] = await Promise.all([bg<Listed[]>('entityList'), bg<Doc[]>('docList')]);
  const meetings = list.filter((e) => e.type === 'event' && e.fields.meeting).sort((a, b) => (b.fields.started ?? '').localeCompare(a.fields.started ?? ''));
  $('#meet-list').replaceChildren(...meetings.map((e) => meetingEl(e, docsOfMeeting(docs, e.name))));
  if (!meetings.length) $('#meet-list').append(h('p', { className: 'muted', textContent: 'No meetings yet.' }));
}
document.querySelector<HTMLElement>('.lib-tabs [data-tab=meetings]')?.addEventListener('click', () => void renderMeetings().catch((e) => fail(meetErr, e)));
void renderMeetings().catch((e) => fail(meetErr, e));
