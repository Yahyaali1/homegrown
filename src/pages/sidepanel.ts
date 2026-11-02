// The side panel, the home for everything: Chat (pages/chat.ts), Missions, Garden, Library, Tasks, Settings with
// Models, and the stats bar. Library and Settings are their own modules, also used as standalone pages.
import { $, busyButton, button, emptyPot, row } from './shell.ts';
import './settings.ts';
import './library.ts';
import { renderGarden } from './garden.ts';
import { showRequests } from './garden-runs.ts';
import { addMessage, checkPending, startChat } from './chat.ts';
import { h } from '../ui/dom.ts';
import { flower, MISSION_STAGE } from '../ui/flower.ts';
import { KEY_POINTS, previews } from '../ui/linkcard.ts';
import { MODELS, modelById, supports, TASKS, type TaskId } from '../domain/model.ts';
import { DEFAULT_TASKS, getTasks } from '../shared/actions.ts';
import { importTasks, KINDS, moveTask, type Task, type TaskKind } from '../domain/tasks.ts';
import { parseSettings } from '../domain/settings.ts';
import { bg, engineCall } from '../shared/protocol.ts';

interface ModelState { name: string; downloaded: boolean; partial: number; downloading: boolean }
interface Loaded { name: string; loadMs: number }

let state: { loaded: Loaded | null; models: ModelState[] } = { loaded: null, models: MODELS.map((m) => ({ name: m.id, downloaded: false, partial: 0, downloading: false })) };
const progress: Record<string, { done: number; total: number; complete?: boolean; error?: string }> = {};

const sync = async () => parseSettings(await chrome.storage.sync.get(null));
const when = (ms?: number) => (ms ? new Date(ms).toLocaleString() : 'never');

// ---- engine ----

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.source !== 'engine') return;
  if (msg.type === 'loaded') setLoaded(msg.loaded);
  if (msg.type === 'progress') {
    progress[msg.name] = msg;
    if (msg.complete || msg.error) void refresh();
    else renderModels();
  }
});

async function refresh(): Promise<void> {
  state = await engineCall('status');
  setLoaded(state.loaded);
  void renderTaskModels();
}

function setLoaded(loaded: Loaded | null): void {
  state.loaded = loaded;
  const line = $('#model-line');
  line.textContent = loaded ? loaded.name : 'No model loaded';
  line.title = loaded ? `${loaded.name}, loaded in ${(loaded.loadMs / 1000).toFixed(1)} s, running on this device` : 'Pick one in Settings';
  renderModels();
}

/** Loads the first downloaded model if none is loaded yet. */
async function ensureModel(): Promise<Loaded> {
  if (state.loaded) return state.loaded;
  await refresh();
  const first = state.models.find((m) => m.downloaded);
  if (!first) throw new Error('No model downloaded yet. Open Settings → Models and download one.');
  $('#model-line').textContent = `Loading ${first.name}…`;
  return engineCall<Loaded>('load', { name: first.name });
}

// ---- tabs (the panel reopens on the last one used) ----

function showTab(name: string): void {
  for (const b of document.querySelectorAll('.tabs [role=tab]')) b.setAttribute('aria-selected', String((b as HTMLElement).dataset.tab === name));
  for (const s of document.querySelectorAll<HTMLElement>('main > [role=tabpanel]')) s.hidden = s.id !== name;
  try { localStorage.tab = name; } catch {}
  if (name === 'garden') void renderGarden();
  if (name === 'chat') showRequests();
}
for (const b of document.querySelectorAll<HTMLElement>('.tabs [role=tab]')) b.onclick = () => showTab(b.dataset.tab ?? 'chat');
try { if (localStorage.tab && document.getElementById(localStorage.tab)) showTab(localStorage.tab); } catch {}
// sidepanel.html#garden (a gardener's notification) opens on that tab.
const fromHash = () => location.hash.length > 1 && document.querySelector(`main > [role=tabpanel]${location.hash}`) && showTab(location.hash.slice(1));
fromHash();
addEventListener('hashchange', fromHash);

// ---- Tasks (shown in the in-page toolbar and the right-click menu) ----

const saveTasks = (tasks: Task[]) => chrome.storage.sync.set({ tasks });
$('#task-kind').append(...Object.entries(KINDS).map(([k, label]) => new Option(label, k)));
const kindPicker = (value: TaskKind) => {
  const s = h('select', { attrs: { 'aria-label': 'Runs on' } }, ...Object.entries(KINDS).map(([k, label]) => new Option(label, k)));
  s.value = value;
  return s;
};

/** One task: title and instruction, with up/down, edit and delete. */
function taskItem(t: Task): HTMLLIElement {
  const text = h('span', { className: 't' }, h('b', { textContent: t.title }), h('span', { className: 'p', textContent: t.prompt }));
  const li = h('li', {}, text);
  const edit = () => {
    const name = h('input', { value: t.title, attrs: { 'aria-label': 'Task name' } });
    const kind = kindPicker(t.kind);
    const prompt = h('textarea', { rows: 3, value: t.prompt, attrs: { 'aria-label': 'Instruction' } });
    const form = h('form', { className: 'edit' }, name, kind, prompt, h('div', { className: 'row' }, h('button', { textContent: 'Save' })));
    form.onsubmit = async (e) => {
      e.preventDefault();
      await saveTasks((await getTasks()).map((x) => (x.id === t.id ? { ...x, title: name.value.trim() || x.title, kind: kind.value as TaskKind, prompt: prompt.value.trim() } : x)));
    };
    text.replaceWith(form);
    name.focus();
  };
  const small = (label: string, aria: string, fn: () => unknown) => h('button', { textContent: label, title: aria, attrs: { 'aria-label': aria }, onclick: () => void fn() });
  li.append(
    small('↑', `Move ${t.title} up`, async () => saveTasks(moveTask(await getTasks(), t.id, -1))),
    small('↓', `Move ${t.title} down`, async () => saveTasks(moveTask(await getTasks(), t.id, 1))),
    small('✎', `Edit ${t.title}`, edit),
    small('×', `Delete ${t.title}`, async () => saveTasks((await getTasks()).filter((x) => x.id !== t.id))),
  );
  return li;
}

// Messages for the active tab's in-page UI. The worker re-injects the page scripts into tabs opened before it loaded.
const toPage = (msg: object) => bg('toPage', { msg }).catch((e: Error) => addMessage('error', e.message));
$('#page-actions').onclick = () => void toPage({ type: 'launcher' });

async function renderTasks(): Promise<void> {
  const tasks = await getTasks();
  $('#task-groups').replaceChildren(...Object.entries(KINDS).flatMap(([kind, label]) => [
    h('h3', { textContent: label }),
    h('ul', { className: 'task-list' }, ...tasks.filter((t) => t.kind === kind).map(taskItem)),
  ]));
  // "This page" chips in Chat run a page task in the active tab's in-page card.
  $('#page-tasks').replaceChildren(...tasks.filter((t) => t.kind === 'page').map((t) => button(t.title, () => toPage({ type: 'menu', task: t }), 'chip')));
  $('#sched-task').replaceChildren(...tasks.filter((t) => t.kind === 'page').map((t) => new Option(t.title, t.id)));
  await renderVars(tasks);
}

// {name} placeholders in prompts get a default value here (settings.taskVars), used by the in-page toolbar.
async function renderVars(tasks: Task[]): Promise<void> {
  const names = [...new Set(tasks.flatMap((t) => [...t.prompt.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)))];
  const { taskVars } = await sync();
  $('#task-vars').replaceChildren(...(names.length ? [h('h3', { textContent: 'Task variables' })] : []), ...names.map((n) => {
    const box = h('input', { value: taskVars[n] ?? '', placeholder: n === 'language' ? navigator.language : 'asked when used' });
    box.onchange = async () => void chrome.storage.sync.set({ taskVars: { ...(await sync()).taskVars, [n]: box.value } });
    return h('label', {}, `{${n}}`, box);
  }));
}

// ---- sharing tasks as JSON, merged by id on import ----
const paste = $<HTMLTextAreaElement>('#task-paste');
const alertLine = (text: string) => (paste.placeholder = text);
async function importText(json: string): Promise<void> {
  try {
    const { tasks, count } = importTasks(await getTasks(), json, () => crypto.randomUUID().slice(0, 8));
    await saveTasks(tasks);
    alertLine(`Imported ${count} tasks.`);
  } catch (err) {
    alertLine(`Couldn't import: ${(err as Error).message}`);
  }
}
$('#task-export').onclick = async () => {
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(await getTasks(), null, 2)], { type: 'application/json' })), download: 'homegrown-tasks.json' });
  a.click();
  URL.revokeObjectURL(a.href);
};
$('#task-import-btn').onclick = () => $('#task-import').click();
$<HTMLInputElement>('#task-import').onchange = async (e) => {
  const box = e.target as HTMLInputElement;
  const file = box.files?.[0];
  if (file) await importText(await file.text());
  box.value = '';
};
$('#task-copy').onclick = async () => {
  await navigator.clipboard.writeText(JSON.stringify(await getTasks()));
  alertLine('Copied. Paste it into another Homegrown to share.');
};
$('#task-paste-go').onclick = async () => {
  await importText(paste.value);
  paste.value = '';
};

$<HTMLFormElement>('#task-form').onsubmit = async (e) => {
  e.preventDefault();
  const task: Task = { id: crypto.randomUUID().slice(0, 8), kind: $<HTMLSelectElement>('#task-kind').value as TaskKind, title: $<HTMLInputElement>('#task-title').value.trim(), prompt: $<HTMLTextAreaElement>('#task-prompt').value.trim() };
  await saveTasks([...(await getTasks()), task]);
  $<HTMLFormElement>('#task-form').reset();
};
$('#task-reset').onclick = () => void saveTasks(DEFAULT_TASKS);
chrome.storage.sync.onChanged.addListener((c) => (c.tasks || c.taskVars) && void renderTasks());
void renderTasks();

// ---- scheduled tasks and watched pages (background/monitors.ts) ----

$<HTMLFormElement>('#sched-form').onsubmit = async (e) => {
  e.preventDefault();
  const url = $<HTMLInputElement>('#sched-url');
  await bg('schedule', { taskId: $<HTMLSelectElement>('#sched-task').value, url: url.value, interval: $<HTMLSelectElement>('#sched-interval').value });
  url.value = '';
};

interface Schedule { id: string; taskId: string; url: string; interval: string }
interface Monitor { id: string; title: string; url: string; interval: string; checkedAt?: number; changedAt?: number; lastSummary?: string }
async function renderSchedules(): Promise<void> {
  const got = await chrome.storage.local.get(['schedules', 'scheduledResults', 'monitors']);
  const list = <T>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);
  const schedules = list<Schedule>(got.schedules);
  const results = list<{ url: string; taskTitle: string; text: string; at: number }>(got.scheduledResults);
  const monitors = list<Monitor>(got.monitors);
  const tasks = await getTasks();
  $('#sched-list').replaceChildren(...(schedules.length ? schedules.map((s) => {
    const title = tasks.find((t) => t.id === s.taskId)?.title;
    const last = results.find((r) => r.url === s.url && r.taskTitle === title);
    return row(title ?? '(deleted task)', `${s.url} · ${s.interval}`, last ? `${when(last.at)}: ${last.text}` : '',
      busyButton('Run now', () => bg('runScheduleNow', { id: s.id })), button('×', () => bg('unschedule', { id: s.id })));
  }) : [emptyPot('Nothing scheduled yet.')]));
  $('#mon-list').replaceChildren(...(monitors.length ? monitors.map((m) =>
    row(m.title, `${m.url} · ${m.interval} · checked ${when(m.checkedAt)}`, m.lastSummary ? `Last change (${when(m.changedAt)}): ${m.lastSummary}` : 'No changes yet.',
      busyButton('Check now', () => bg('checkNow', { id: m.id })), button('×', () => bg('unwatch', { id: m.id }))))
    : [emptyPot('None yet. Use ❀ → Watch this page on any page.')]));
}
chrome.storage.local.onChanged.addListener((c) => (c.schedules || c.scheduledResults || c.monitors) && void renderSchedules());
void renderSchedules();

// ---- Missions: started here, run in the worker, shown in Mission control ----

$<HTMLFormElement>('#mission-form').onsubmit = (e) => {
  e.preventDefault();
  const goal = $<HTMLTextAreaElement>('#mission-goal');
  if (!goal.value.trim()) return goal.focus();
  // In the background, without a tab: it shows under Running and recent, and nudges you when it's done.
  void bg('agentOpen', { goal: goal.value.trim(), run: true, tabs: $<HTMLInputElement>('#mission-tabs').checked, open: false }).then(renderLive);
  goal.value = '';
};
$('#mission-goal').onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) ($<HTMLFormElement>('#mission-form').requestSubmit(), e.preventDefault());
};

interface LiveSummary { id: string; goal: string; status: string; achieved?: boolean; answer: string; best: string; error?: string; round?: number; phase?: string }
async function renderLive(): Promise<void> {
  const list = await bg<LiveSummary[]>('missionsLive').catch(() => []);
  $('#live-list').replaceChildren(...(list.length ? list.map((m) => {
    const sub = m.status === 'done' ? m.answer || m.best : m.status === 'failed' ? m.error ?? '' : m.status === 'stopped' ? 'Stopped.'
      : m.round ? `Round ${m.round} · ${m.phase === 'checking' ? 'checking the results' : 'reading pages'}` : 'Reading your goal…';
    return h('li', { className: 'live' }, flower(26, MISSION_STAGE[m.status] ?? (m.achieved ? 'sprout' : 'stage-3')),
      h('span', { className: 't' }, h('b', { textContent: m.goal }), h('span', { className: 'p', textContent: sub })),
      button('Open', () => bg('missionOpen', { id: m.id }), 'secondary'));
  }) : [emptyPot('Missions you start show up here while they run.')]));
}
chrome.storage.session.onChanged.addListener((c) => c.liveMissions && void renderLive());
void renderLive();

interface SavedMission { id: string; name: string; goal: string; every?: string; lastRun?: number; lastBest?: string }
async function renderMissions(): Promise<void> {
  const list = await bg<SavedMission[]>('missionsList').catch(() => []);
  $('#mission-list').replaceChildren(...(list.length ? list.map((m) =>
    row(m.name, [m.every ? `every ${m.every}` : 'manual', m.lastRun ? `last run ${when(m.lastRun)}` : '', m.lastBest ? `best: ${m.lastBest}` : ''].filter(Boolean).join(' · '), '',
      button('Run', () => bg('agentOpen', { goal: m.goal, run: true }), 'secondary'),
      button('×', async () => (await bg('missionDelete', { id: m.id }), void renderMissions()), 'ghost')))
    : [emptyPot('Saved missions grow here. Save one from Mission control.')]));
}
chrome.storage.local.onChanged.addListener((c) => c.missions && void renderMissions());
void renderMissions();

// ---- which model does what (settings.taskModels) ----

const downloadedModels = () => state.models.filter((s) => s.downloaded).map((s) => s.name);
async function renderTaskModels(): Promise<void> {
  const { taskModels } = await sync();
  $('#task-models').replaceChildren(...(Object.entries(TASKS) as [TaskId, string][]).map(([task, label]) => {
    const sel = h('select', { attrs: { 'aria-label': `Model for ${label}` } }, new Option('Automatic (the loaded model)', ''), ...downloadedModels().map((n) => new Option(n, n)));
    sel.value = taskModels[task] ?? '';
    sel.onchange = async () => void chrome.storage.sync.set({ taskModels: { ...(await sync()).taskModels, [task]: sel.value } });
    return h('label', { className: 'row' }, h('span', { className: 'grow', textContent: label }), sel);
  }));
}
chrome.storage.sync.onChanged.addListener((c) => c.taskModels && void renderTaskModels());

// ---- Models ----

const gb = (n: number) => `${(n / 1e9).toFixed(2)} GB`;
const act = (p: Promise<unknown>) => p.catch((e) => console.error(e)).finally(() => void refresh());

function renderModels(): void {
  $('#model-list').replaceChildren(...state.models.flatMap((s) => {
    const m = modelById(s.name);
    if (!m) return [];
    const size = m.source.sizeBytes ?? 0;
    const p = progress[s.name];
    const done = p && !p.complete ? p.done : s.partial;
    const li = h('li', {}, h('span', { className: 'name', textContent: m.id }),
      h('span', { className: 'muted', textContent: `${gb(size)} · ${supports(m, 'image') ? 'text + image' : 'text'} · ${m.note}` }));
    if (!s.downloaded && (s.downloading || done)) {
      li.append(h('progress', { max: size, value: done, attrs: { 'aria-label': `${m.id} download` } }), h('span', { className: 'muted', textContent: `${gb(done)} of ${gb(size)}` }));
    }
    if (p?.error && p.error !== 'Paused') li.append(h('span', { className: 'err', textContent: p.error }));
    const actions = h('div', { className: 'actions' });
    if (s.downloaded) {
      const isLoaded = state.loaded?.name === s.name;
      const load = button(isLoaded ? 'Loaded' : 'Load', () => act(engineCall('load', { name: s.name })));
      load.disabled = isLoaded;
      actions.append(load, button('Delete', () => act(engineCall('remove', { name: s.name })), 'secondary'));
    } else if (s.downloading) {
      actions.append(button('Pause', () => engineCall('pause', { name: s.name }), 'secondary'));
    } else {
      actions.append(button(done ? 'Resume' : 'Download', () => {
        delete progress[s.name];
        void act(engineCall('download', { name: s.name }).catch((e: Error) => {
          progress[s.name] = { done: 0, total: 0, error: e.message }; // shown on the row; the console alone hid it
          throw e;
        }));
        setTimeout(() => void refresh(), 300);
      }));
      if (done) actions.append(button('Delete', () => act(engineCall('remove', { name: s.name })), 'secondary'));
    }
    li.append(actions);
    return [li];
  }));
}

// ---- start ----

// Links in chat answers and Garden results open by the link rules, with a hover card (ui/linkcard.ts).
previews($('main'), async (text) => (await engineCall<{ text: string }>('generate', { id: crypto.randomUUID(), turns: [{ role: 'user', text: KEY_POINTS, selection: text }] })).text);
renderModels();
void startChat({ ensureModel, downloaded: downloadedModels, showTab }).catch((e) => console.error(e));
refresh().then(checkPending, (e: Error) => ($('#model-line').textContent = e.message));
