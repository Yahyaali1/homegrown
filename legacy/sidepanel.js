// Side panel, the home for everything: Chat (with image attachments and Prompt Lab templates), Missions, Library
// (library.js), Tasks, Settings (settings.js plus Models), the stats bar, and running right-click actions.
import { MODELS, byName } from './models.js';
import { PROMPT_LAB, DEFAULT_TASKS, KINDS, getTasks } from './actions.js';
import { TASKS } from './bg/engine.js';

const $ = (s) => document.querySelector(s);
let state = { loaded: null, models: [] };
let turns = []; // chat history sent with every request
let attached = null; // selection waiting for a custom instruction
const progress = {}; // name -> last progress message
const streams = new Map(); // generate id -> token callback

// ---- engine ----

async function call(cmd, args = {}) {
  await chrome.runtime.sendMessage({ target: 'bg', cmd: 'ensure' });
  const r = await chrome.runtime.sendMessage({ target: 'engine', cmd, ...args });
  if (!r?.ok) throw new Error(r?.error || 'The engine did not respond');
  return r.result;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.source !== 'engine') return;
  if (msg.type === 'token') streams.get(msg.id)?.(msg.text);
  if (msg.type === 'loaded') setLoaded(msg.loaded);
  if (msg.type === 'progress') {
    progress[msg.name] = msg;
    if (msg.complete || msg.error) refresh();
    else renderModels();
  }
});

async function refresh() {
  state = await call('status');
  setLoaded(state.loaded);
  renderModels();
  renderTaskModels();
}

function setLoaded(loaded) {
  state.loaded = loaded;
  $('#model-line').textContent = loaded ? loaded.name : 'No model loaded';
  $('#model-line').title = loaded ? `${loaded.name}, loaded in ${(loaded.loadMs / 1000).toFixed(1)} s, running on this device` : 'Pick one in Settings';
  renderModels();
}

// Load the first downloaded model if none is loaded yet.
async function ensureModel() {
  if (state.loaded) return state.loaded;
  await refresh();
  const first = state.models.find((m) => m.downloaded);
  if (!first) throw new Error('No model downloaded yet. Open the Models tab and download one.');
  $('#model-line').textContent = `Loading ${first.name}…`;
  return call('load', { name: first.name });
}

async function generate(reqTurns, config, onToken) {
  const id = crypto.randomUUID();
  streams.set(id, onToken);
  try {
    const { taskModels = {} } = await chrome.storage.sync.get('taskModels');
    const r = await call('generate', { id, turns: reqTurns, config, model: taskModels.chat || '' });
    showStats(r.stats);
    return r;
  } finally {
    streams.delete(id);
  }
}

function showStats(s) {
  $('#stats').hidden = false;
  $('#s-ttft').textContent = `${(s.ttftMs / 1000).toFixed(2)} s`;
  $('#s-prefill').textContent = s.prefillTps.toFixed(0);
  $('#s-decode').textContent = s.decodeTps.toFixed(1);
  $('#s-latency').textContent = `${(s.latencyMs / 1000).toFixed(1)} s`;
  $('#s-tokens').textContent = `${s.prefillTokens} in · ${s.outputTokens} out`;
}

// ---- tabs ----

function showTab(name) {
  for (const b of document.querySelectorAll('.tabs [role=tab]')) b.setAttribute('aria-selected', b.dataset.tab === name);
  for (const s of document.querySelectorAll('main > [role=tabpanel]')) s.hidden = s.id !== name;
  try { localStorage.tab = name; } catch {}
}
for (const b of document.querySelectorAll('.tabs [role=tab]')) b.onclick = () => showTab(b.dataset.tab);
try { if (localStorage.tab && document.getElementById(localStorage.tab)) showTab(localStorage.tab); } catch {}

// ---- chat ----

// Model replies carry the flower: it grows in a loop while the model works, blooms when done, wilts on an error.
function addMessage(role, text) {
  const li = document.createElement('li');
  li.className = role;
  const body = Object.assign(document.createElement('div'), { className: 'text', textContent: text });
  if (role === 'model') li.append(hgFlower.el(22, 'thinking'));
  li.append(body);
  li.body = body;
  $('#messages').append(li);
  $('#empty').hidden = true;
  li.scrollIntoView({ block: 'end' });
  return li;
}
const settle = (li, state) => li.querySelector('.flower')?.setAttribute('class', `flower ${state}`);

function setBusy(busy) {
  $('#chat-send').disabled = busy;
  $('#chat-stop').hidden = !busy;
}

// Sends `turn` after the current history and streams the answer into the chat.
async function chat(turn, label, config = {}) {
  showTab('chat');
  addMessage('user', label);
  const li = addMessage('model', '');
  setBusy(true);
  try {
    await ensureModel();
    const r = await generate([...turns, turn], config, (t) => {
      li.body.textContent += t;
      li.scrollIntoView({ block: 'end' });
    });
    settle(li, 'bloom');
    turns.push(turn, { role: 'model', text: r.text });
    if (r.stats.truncated) {
      const warn = document.createElement('span');
      warn.className = 'warn';
      warn.textContent = "The selection was longer than the model's context window, so only the first part was used.";
      li.append(warn);
    }
  } catch (e) {
    li.className = 'model error';
    li.body.textContent = e.message;
    settle(li, 'wilt');
  } finally {
    setBusy(false);
  }
}

function attach(text) {
  attached = text;
  $('#attached').hidden = !text;
  $('#attached-text').textContent = text || '';
}
$('#attached-clear').onclick = () => attach(null);

// A Prompt Lab template (chosen in the composer) wraps the typed text; an attached image or selection rides along.
$('#chat-form').onsubmit = async (e) => {
  e.preventDefault();
  const typed = $('#chat-input').value.trim();
  const tpl = lab.template();
  if (!typed && !imageData) return;
  $('#chat-input').value = '';
  // A plain short message may be a settings request ("use E4B for missions"): Gemma decides, you confirm.
  if (!tpl && !imageData && attached === null && typed.length < 240 && (await proposeSetting(typed))) return;
  const text = tpl ? tpl.build(typed, $('#lab-option').value) : typed || 'Describe this image.';
  const turn = { role: 'user', text, ...(attached !== null && { selection: attached }), ...(imageData && { image: imageData }) };
  const label = [tpl ? `${tpl.title}: ${typed}` : typed || 'Describe this image.', attached !== null ? `“${excerpt(attached)}”` : '', imageData ? '(image)' : ''].filter(Boolean).join('\n');
  attach(null);
  setImage(null);
  chat(turn, label, { temperature: +$('#lab-temp').value, topK: +$('#lab-topk').value });
};
$('#chat-input').onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) $('#chat-form').requestSubmit(), e.preventDefault();
};
$('#chat-stop').onclick = () => call('cancel');
$('#chat-clear').onclick = () => {
  turns = [];
  $('#messages').replaceChildren();
  $('#empty').hidden = false;
};

const excerpt = (t, n = 140) => (t.length > n ? `${t.slice(0, n)}…` : t);

// ---- right-click actions (queued by background.js in session storage) ----

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// host_permissions let us fetch cross-origin and even page-owned blob: images. Images behind a login
// or revoked blob: links still fail; say so plainly instead of sending a broken image to the model.
async function fetchImage(srcUrl) {
  try {
    const res = await fetch(srcUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) throw new Error(`not an image (${blob.type || 'unknown type'})`);
    return blobToDataUrl(blob);
  } catch (e) {
    throw new Error(`Can't read this image (${e.message}). Images that need a login and blob: links the page has already released can't be read.`);
  }
}

async function runAction(a) {
  turns = [];
  $('#messages').replaceChildren();
  $('#empty').hidden = true;
  if (a.kind === 'text') {
    if (!a.prompt) {
      // Custom prompt: keep the selection and ask the user what to do with it.
      showTab('chat');
      attach(a.selection);
      $('#chat-input').focus();
      return;
    }
    return chat({ role: 'user', text: a.prompt, selection: a.selection }, `${a.title}\n“${excerpt(a.selection)}”`);
  }
  showTab('chat');
  const li = addMessage('user', a.title);
  try {
    const image = await fetchImage(a.srcUrl);
    li.textContent += ` (${Math.round((image.length * 3) / 4 / 1024)} KB image)`;
    await ensureModel();
    if (!a.prompt) {
      setImage(image);
      $('#chat-input').focus();
      return;
    }
    await chat({ role: 'user', text: a.prompt, image }, a.title);
  } catch (e) {
    addMessage('error', e.message);
  }
}

async function checkPending() {
  const { pending } = await chrome.storage.session.get('pending');
  if (!pending) return;
  await chrome.storage.session.remove('pending');
  runAction(pending);
}
chrome.storage.session.onChanged.addListener((c) => c.pending?.newValue && checkPending());

// ---- image attachment (was the Ask Image tab) ----

let imageData = null;
function setImage(dataUrl) {
  imageData = dataUrl;
  $('#image-preview').src = dataUrl || '';
  $('#attached-image').hidden = !dataUrl;
  $('#image-file').value = '';
}
$('#image-file').onchange = async (e) => setImage(e.target.files[0] ? await blobToDataUrl(e.target.files[0]) : null);
$('#image-clear').onclick = () => setImage(null);

// ---- Prompt Lab templates (a picker in the composer) and sampling ----

const lab = {
  template: () => PROMPT_LAB.find((t) => t.id === $('#lab-template').value),
};
$('#lab-template').append(new Option('Chat', ''), ...PROMPT_LAB.map((t) => new Option(t.title, t.id)));
function renderLabOptions() {
  const t = lab.template();
  $('#lab-option').hidden = !t?.options;
  $('#lab-option').replaceChildren(...(t?.options || []).map((o) => new Option(o)));
  $('#lab-option').title = t?.option || '';
  $('#chat-input').placeholder = !t ? 'Message Gemma…' : t.id === 'code' ? 'e.g. print the numbers from 1 to 5' : `${t.title}: enter text…`;
}
$('#lab-template').onchange = renderLabOptions;
renderLabOptions();
for (const id of ['#lab-temp', '#lab-topk']) {
  const show = () => ($(`output[for=${id.slice(1)}]`).textContent = $(id).value);
  $(id).oninput = show;
  show();
}

// ---- Tasks (shown in the in-page toolbar and the right-click menu) ----

const saveTasks = (tasks) => chrome.storage.sync.set({ tasks });
$('#task-kind').append(...Object.entries(KINDS).map(([k, label]) => new Option(label, k)));

async function renderTasks() {
  const tasks = await getTasks();
  const move = async (id, by) => {
    const list = await getTasks();
    const i = list.findIndex((x) => x.id === id);
    // Swap with the nearest task of the same kind: the list mixes kinds, but each group shows only its own.
    let j = i + by;
    while (j >= 0 && j < list.length && list[j].kind !== list[i].kind) j += by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    saveTasks(list);
  };
  $('#task-groups').replaceChildren(
    ...Object.entries(KINDS).flatMap(([kind, label]) => {
      const list = document.createElement('ul');
      list.className = 'task-list';
      list.append(...tasks.filter((t) => t.kind === kind).map((t) => taskItem(t, move)));
      return [Object.assign(document.createElement('h3'), { textContent: label }), list];
    }),
  );
  // "This page" chips in Chat run a page task in the active tab's in-page card.
  $('#page-tasks').replaceChildren(
    ...tasks.filter((t) => t.kind === 'page').map((t) =>
      button(t.title, () => toPage({ type: 'menu', task: t }), 'chip'),
    ),
  );
  $('#sched-task').replaceChildren(...tasks.filter((t) => t.kind === 'page').map((t) => new Option(t.title, t.id)));
  renderVars(tasks);
}

// Messages for the active tab's in-page UI (content/core.js).
// The background re-injects the page scripts when a tab was opened before the extension loaded.
const toPage = (msg) => bg('toPage', { msg }).catch((e) => addMessage('error', e.message));
$('#page-actions').onclick = () => toPage({ type: 'launcher' });

// One task row: title and instruction, with up/down, edit and delete.
function taskItem(t, move) {
  const li = document.createElement('li');
  li.innerHTML = '<span class="t"><b></b><span class="p"></span></span>';
  li.querySelector('b').textContent = t.title;
  li.querySelector('.p').textContent = t.prompt;
  const edit = () => {
    const form = document.createElement('form');
    form.className = 'edit';
    form.innerHTML = '<input aria-label="Task name"><select aria-label="Runs on"></select><textarea rows="3" aria-label="Instruction"></textarea><div class="row"><button>Save</button></div>';
    const [name, kind, prompt] = [form.querySelector('input'), form.querySelector('select'), form.querySelector('textarea')];
    kind.append(...Object.entries(KINDS).map(([k, label]) => new Option(label, k)));
    [name.value, kind.value, prompt.value] = [t.title, t.kind, t.prompt];
    form.onsubmit = async (e) => {
      e.preventDefault();
      saveTasks((await getTasks()).map((x) => (x.id === t.id ? { ...x, title: name.value.trim() || x.title, kind: kind.value, prompt: prompt.value.trim() } : x)));
    };
    li.firstChild.replaceWith(form);
    name.focus();
  };
  const small = (label, aria, fn) => Object.assign(button(label, fn), { title: aria, ariaLabel: aria });
  li.append(
    small('↑', `Move ${t.title} up`, () => move(t.id, -1)),
    small('↓', `Move ${t.title} down`, () => move(t.id, 1)),
    small('✎', `Edit ${t.title}`, edit),
    small('×', `Delete ${t.title}`, async () => saveTasks((await getTasks()).filter((x) => x.id !== t.id))),
  );
  return li;
}

// {name} placeholders in prompts get a default value here (settings.taskVars), used by the in-page toolbar.
async function renderVars(tasks) {
  const names = [...new Set(tasks.flatMap((t) => [...(t.prompt || '').matchAll(/\{(\w+)\}/g)].map((m) => m[1])))];
  const { taskVars = {} } = await chrome.storage.sync.get('taskVars');
  $('#task-vars').replaceChildren(
    ...(names.length ? [Object.assign(document.createElement('h3'), { textContent: 'Task variables' })] : []),
    ...names.map((n) => {
      const label = document.createElement('label');
      const input = Object.assign(document.createElement('input'), { value: taskVars[n] ?? '', placeholder: n === 'language' ? navigator.language : 'asked when used' });
      input.onchange = async () => chrome.storage.sync.set({ taskVars: { ...(await chrome.storage.sync.get('taskVars')).taskVars, [n]: input.value } });
      label.append(`{${n}}`, input);
      return label;
    }),
  );
}

// ---- sharing: tasks as JSON, merged by id on import ----
async function importTasks(json) {
  const incoming = JSON.parse(json);
  if (!Array.isArray(incoming) || incoming.some((t) => !t.title || !t.prompt || !KINDS[t.kind])) throw new Error('Not a task list');
  const list = await getTasks();
  for (const t of incoming) {
    const clean = { id: String(t.id || crypto.randomUUID().slice(0, 8)), kind: t.kind, title: String(t.title), prompt: String(t.prompt) };
    const i = list.findIndex((x) => x.id === clean.id);
    if (i >= 0) list[i] = clean;
    else list.push(clean);
  }
  await saveTasks(list);
  return incoming.length;
}
$('#task-export').onclick = async () => {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([JSON.stringify(await getTasks(), null, 2)], { type: 'application/json' })),
    download: 'edge-gallery-tasks.json',
  });
  a.click();
  URL.revokeObjectURL(a.href);
};
$('#task-import-btn').onclick = () => $('#task-import').click();
$('#task-import').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    alertLine(`Imported ${await importTasks(await file.text())} tasks.`);
  } catch (err) {
    alertLine(`Couldn't import: ${err.message}`);
  }
  e.target.value = '';
};
$('#task-copy').onclick = async () => {
  await navigator.clipboard.writeText(JSON.stringify(await getTasks()));
  alertLine('Copied. Paste it into another Homegrown to share.');
};
$('#task-paste-go').onclick = async () => {
  try {
    alertLine(`Imported ${await importTasks($('#task-paste').value)} tasks.`);
    $('#task-paste').value = '';
  } catch (err) {
    alertLine(`Couldn't import: ${err.message}`);
  }
};
const alertLine = (text) => ($('#task-paste').placeholder = text);

// ---- scheduled tasks and watched pages (bg/monitors.js) ----
const bg = async (cmd, args = {}) => {
  const r = await chrome.runtime.sendMessage({ target: 'bg', cmd, ...args });
  if (!r?.ok) throw new Error(r?.error || `${cmd} failed`);
  return r.result;
};
const when = (ms) => (ms ? new Date(ms).toLocaleString() : 'never');

$('#sched-form').onsubmit = async (e) => {
  e.preventDefault();
  await bg('schedule', { taskId: $('#sched-task').value, url: $('#sched-url').value, interval: $('#sched-interval').value });
  $('#sched-url').value = '';
};

async function renderSchedules() {
  const { schedules = [], scheduledResults = [], monitors = [] } = await chrome.storage.local.get(['schedules', 'scheduledResults', 'monitors']);
  const tasks = await getTasks();
  $('#sched-list').replaceChildren(
    ...schedules.map((s) => {
      const li = document.createElement('li');
      const last = scheduledResults.find((r) => r.url === s.url && r.taskTitle === tasks.find((t) => t.id === s.taskId)?.title);
      li.innerHTML = '<span class="t"><b></b><span class="p"></span><span class="result"></span></span>';
      li.querySelector('b').textContent = tasks.find((t) => t.id === s.taskId)?.title ?? '(deleted task)';
      li.querySelector('.p').textContent = `${s.url} · ${s.interval}`;
      li.querySelector('.result').textContent = last ? `${when(last.at)}: ${last.text}` : '';
      li.append(button('Run now', (e) => ((e.target.disabled = true), bg('runScheduleNow', { id: s.id }).finally(() => (e.target.disabled = false)))), button('×', () => bg('unschedule', { id: s.id })));
      return li;
    }),
  );
  if (!schedules.length) $('#sched-list').replaceChildren(emptyPot('Nothing scheduled yet.'));
  if (!monitors.length) return $('#mon-list').replaceChildren(emptyPot('None yet. Use ❀ → Watch this page on any page.'));
  $('#mon-list').replaceChildren(
    ...monitors.map((m) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="t"><b></b><span class="p"></span><span class="result"></span></span>';
      li.querySelector('b').textContent = m.title;
      li.querySelector('.p').textContent = `${m.url} · ${m.interval} · checked ${when(m.checkedAt)}`;
      li.querySelector('.result').textContent = m.lastSummary ? `Last change (${when(m.changedAt)}): ${m.lastSummary}` : 'No changes yet.';
      li.append(button('Check now', (e) => ((e.target.disabled = true), bg('checkNow', { id: m.id }).finally(() => (e.target.disabled = false)))), button('×', () => bg('unwatch', { id: m.id })));
      return li;
    }),
  );
}
chrome.storage.local.onChanged.addListener((c) => (c.schedules || c.scheduledResults || c.monitors) && renderSchedules());
renderSchedules();

$('#task-form').onsubmit = async (e) => {
  e.preventDefault();
  const task = { id: crypto.randomUUID().slice(0, 8), kind: $('#task-kind').value, title: $('#task-title').value.trim(), prompt: $('#task-prompt').value.trim() };
  await saveTasks([...(await getTasks()), task]);
  $('#task-form').reset();
};
$('#task-reset').onclick = () => saveTasks(DEFAULT_TASKS);
chrome.storage.sync.onChanged.addListener((c) => (c.tasks || c.taskVars) && renderTasks());
renderTasks();

// ---- Missions (bg/agent.js); they run in Mission control ----

$('#mission-form').onsubmit = (e) => {
  e.preventDefault();
  const goal = $('#mission-goal').value.trim();
  if (!goal) return $('#mission-goal').focus();
  // In the background, no tab: it shows up under Running and recent, and nudges you when it's done.
  bg('agentOpen', { goal, run: true, tabs: $('#mission-tabs').checked, open: false }).then(renderLive);
  $('#mission-goal').value = '';
};

// Each mission's plant: growing while it works, in bloom when the goal is met, part-grown for a best effort,
// wilted when it failed.
const PLANT = { planning: 'thinking', running: 'thinking', failed: 'wilt', stopped: 'stage-1' };
async function renderLive() {
  const list = await bg('missionsLive').catch(() => []);
  $('#live-list').replaceChildren(...(list.length ? list.map((m) => {
    const li = Object.assign(document.createElement('li'), { className: 'live' });
    li.append(hgFlower.el(26, PLANT[m.status] || (m.achieved ? 'sprout' : 'stage-3')));
    const t = Object.assign(document.createElement('span'), { className: 't' });
    t.innerHTML = '<b></b><span class="p"></span>';
    t.querySelector('b').textContent = m.goal;
    t.querySelector('.p').textContent = m.status === 'done' ? m.answer || m.best : m.status === 'failed' ? m.error : m.status === 'stopped' ? 'Stopped.' : m.round ? `Round ${m.round} · ${m.phase === 'checking' ? 'checking the results' : 'reading pages'}` : 'Reading your goal…';
    li.append(t, button('Open', () => bg('missionOpen', { id: m.id }), 'secondary'));
    return li;
  }) : [emptyPot('Missions you start show up here while they run.')]));
}
chrome.storage.session.onChanged.addListener((c) => c.liveMissions && renderLive());
renderLive();
$('#mission-goal').onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) $('#mission-form').requestSubmit(), e.preventDefault();
};

async function renderMissions() {
  const list = await bg('missionsList').catch(() => []);
  $('#mission-list').replaceChildren(...(list.length ? list.map((m) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="t"><b></b><span class="p"></span></span>';
    li.querySelector('b').textContent = m.name;
    li.querySelector('.p').textContent = [m.every ? `every ${m.every}` : 'manual', m.lastRun ? `last run ${when(m.lastRun)}` : '', m.lastBest ? `best: ${m.lastBest}` : ''].filter(Boolean).join(' · ');
    li.append(button('Run', () => bg('agentOpen', { goal: m.goal, run: true }), 'secondary'), button('×', async () => (await bg('missionDelete', { id: m.id }), renderMissions()), 'ghost'));
    return li;
  }) : [emptyPot('Saved missions grow here. Save one from Mission control.')]));
}
chrome.storage.local.onChanged.addListener((c) => c.missions && renderMissions());
renderMissions();

// An empty list shows an empty pot (docs/design-philosophy.md).
function emptyPot(text) {
  const li = Object.assign(document.createElement('li'), { className: 'empty-row' });
  li.append(hgFlower.el(26, 'stage-0'), Object.assign(document.createElement('span'), { className: 'muted', textContent: text }));
  return li;
}

// ---- which model does what (settings.taskModels), and changing settings by asking in Chat ----

const downloadedModels = () => state.models.filter((s) => s.downloaded).map((s) => s.name);
async function renderTaskModels() {
  const { taskModels = {} } = await chrome.storage.sync.get('taskModels');
  $('#task-models').replaceChildren(...Object.entries(TASKS).map(([task, label]) => {
    const sel = document.createElement('select');
    sel.ariaLabel = `Model for ${label}`;
    sel.append(new Option('Automatic (the loaded model)', ''), ...downloadedModels().map((n) => new Option(n, n)));
    sel.value = taskModels[task] || '';
    sel.onchange = async () => chrome.storage.sync.set({ taskModels: { ...(await chrome.storage.sync.get('taskModels')).taskModels, [task]: sel.value } });
    const row = Object.assign(document.createElement('label'), { className: 'row' });
    // Measured (bench/brief-eval.mjs): E4B reads 9/9 unseen goals, E2B 5/9. A hint, not a switch.
    const hint = task === 'missions' && downloadedModels().includes('Gemma-4-E4B-it') && taskModels.missions !== 'Gemma-4-E4B-it' ? ' · Gemma-4-E4B-it reads goals better' : '';
    row.append(Object.assign(document.createElement('span'), { className: 'grow', textContent: label + hint }), sel);
    return row;
  }));
}
chrome.storage.sync.onChanged.addListener((c) => c.taskModels && renderTaskModels());

// Everything Chat can change: id → { label, values (null = free text), current(), set(value) }.
async function settingsCatalogue() {
  const sync = await chrome.storage.sync.get(null);
  const cat = {
    theme: { label: 'Theme', values: ['system', 'light', 'dark'], current: sync.theme || 'system', set: (v) => chrome.storage.sync.set({ theme: v }) },
    translateTo: { label: 'Translate into', values: null, current: sync.translateTo || '', set: (v) => chrome.storage.sync.set({ translateTo: v }) },
  };
  for (const [task, label] of Object.entries(TASKS)) {
    cat[`model.${task}`] = { label: `Model for ${label.toLowerCase()}`, values: ['automatic', ...downloadedModels()], current: sync.taskModels?.[task] || 'automatic',
      set: (v) => chrome.storage.sync.set({ taskModels: { ...sync.taskModels, [task]: v === 'automatic' ? '' : v } }) };
  }
  for (const box of document.querySelectorAll('#settings [data-key]')) {
    const key = box.dataset.key;
    cat[key] = { label: box.closest('label').textContent.trim().split(':')[0], values: ['on', 'off'], current: (sync[key] ?? box.dataset.default === 'true') ? 'on' : 'off',
      set: (v) => chrome.storage.sync.set({ [key]: v === 'on' }) };
  }
  return cat;
}

// Gemma reads the message against the list of settings; code only checks the answer names a real setting and an
// allowed value. A match becomes a card you confirm: nothing changes until you press Apply.
async function proposeSetting(text) {
  const cat = await settingsCatalogue();
  const list = Object.entries(cat).map(([id, s]) => `- ${id}: ${s.label} (${s.values ? s.values.join(', ') : 'any language'}; now ${s.current})`).join('\n');
  let pick = null;
  try {
    const r = await call('generate', { id: crypto.randomUUID(), turns: [{ role: 'user', text: `You route messages for the Homegrown browser extension. If the message asks to change one of these settings, reply {"setting": "<id>", "value": "<one allowed value>"}. If it is anything else (a question, a request, chat), reply {"setting": null}. JSON only.\nSettings:\n${list}\nModels: E2B is Gemma-4-E2B-it (smaller, faster), E4B is Gemma-4-E4B-it (bigger, reads goals better).\nMessage: "${text}"` }], config: { temperature: 0 } });
    pick = JSON.parse(/\{[\s\S]*\}/.exec(r.text)?.[0] || 'null');
  } catch {}
  const s = pick?.setting && cat[pick.setting];
  if (!s) return false;
  const value = s.values ? s.values.find((v) => v.toLowerCase() === String(pick.value).toLowerCase()) : String(pick.value || '').trim();
  if (!value) return false;
  addMessage('user', text);
  const li = addMessage('model', '');
  settle(li, 'stage-3');
  li.body.replaceChildren(`Change ${s.label.toLowerCase()} from ${s.current || 'not set'} to ${value}?`, Object.assign(document.createElement('div'), { className: 'confirm' }));
  const done = (msg, state) => ((li.body.textContent = msg), settle(li, state));
  li.body.lastChild.append(
    button('Apply', async () => (await s.set(value), done(`Done: ${s.label.toLowerCase()} is now ${value}.`, 'bloom')), 'primary'),
    button('Not now', () => done('Left as it was.', 'stage-3'), 'ghost'));
  return true;
}

// ---- Models ----

const gb = (n) => `${(n / 1e9).toFixed(2)} GB`;
function button(label, onclick, cls = '') {
  const b = document.createElement('button');
  b.textContent = label;
  b.className = cls;
  b.onclick = onclick;
  return b;
}
const run = (p) => p.catch((e) => console.error(e)).finally(refresh);

function renderModels() {
  $('#model-list').replaceChildren(
    ...state.models.map((s) => {
      const m = byName(s.name);
      const p = progress[s.name];
      const li = document.createElement('li');
      li.innerHTML = `<span class="name"></span><span class="muted"></span>`;
      li.querySelector('.name').textContent = m.name;
      li.querySelector('.muted').textContent = `${gb(m.sizeInBytes)} · ${m.llmSupportImage ? 'text + image' : 'text'} · ${m.modelId}`;
      const done = p && !p.complete ? p.done : s.partial;
      if (!s.downloaded && (s.downloading || done)) {
        const bar = document.createElement('progress');
        bar.max = m.sizeInBytes;
        bar.value = done;
        bar.setAttribute('aria-label', `${m.name} download`);
        li.append(bar, Object.assign(document.createElement('span'), { className: 'muted', textContent: `${gb(done)} of ${gb(m.sizeInBytes)}` }));
      }
      if (p?.error && p.error !== 'Paused') li.append(Object.assign(document.createElement('span'), { className: 'err', textContent: p.error }));
      const actions = document.createElement('div');
      actions.className = 'actions';
      if (s.downloaded) {
        const isLoaded = state.loaded?.name === s.name;
        actions.append(button(isLoaded ? 'Loaded' : 'Load', () => run(call('load', { name: s.name }))));
        if (isLoaded) actions.lastChild.disabled = true;
        actions.append(button('Delete', () => run(call('remove', { name: s.name })), 'secondary'));
      } else if (s.downloading) {
        actions.append(button('Pause', () => call('pause', { name: s.name }), 'secondary'));
      } else {
        actions.append(button(done ? 'Resume' : 'Download', () => {
          delete progress[s.name];
          run(call('download', { name: s.name }));
          setTimeout(refresh, 300);
        }));
        if (done) actions.append(button('Delete', () => run(call('remove', { name: s.name })), 'secondary'));
      }
      li.append(actions);
      return li;
    }),
  );
}

// ---- start ----

state.models = MODELS.map((m) => ({ name: m.name }));
refresh().then(checkPending, (e) => ($('#model-line').textContent = e.message));
