// Service worker: keeps the offscreen engine alive, runs tasks for the in-page UI (content.js) over a
// port, owns the right-click menu, and hands PDF/browser-page actions to the side panel.
import { DEFAULT_TASKS, getTasks } from './actions.js';
import { MODELS } from './models.js';
import { ensureEngine, engine } from './bg/engine.js';
// Feature modules: each exports `handlers` (EG.bg commands), and may export `init()` and
// `onAnswer(req, result, sender)` (called after every answer).
import * as reader from './bg/reader.js';
import * as web from './bg/web.js';
import * as capture from './bg/capture.js';
import * as tabs from './bg/tabs.js';
import * as monitors from './bg/monitors.js';
import * as memory from './bg/memory.js';
import * as livecaptions from './bg/livecaptions.js';
const modules = [reader, web, capture, tabs, monitors, memory, livecaptions];
const handlers = Object.assign({}, ...modules.map((m) => m.handlers || {}));

// ---- tasks ----

async function seedTasks() {
  const { tasks, customPrompts } = await chrome.storage.sync.get(['tasks', 'customPrompts']);
  if (tasks) return;
  // Prompts saved by v0.1 become text tasks.
  const migrated = (customPrompts || []).map((p) => ({ id: p.id, kind: 'text', title: p.title, prompt: p.prompt }));
  await chrome.storage.sync.set({ tasks: [...DEFAULT_TASKS, ...migrated] });
  await chrome.storage.sync.remove('customPrompts');
}

const PAGE_TEXT_IN_HISTORY = 6000; // ponytail: follow-ups keep only this much of a page/selection, so they fit the context

// Turns sent to the engine for one request from the page.
// req: { task?: {kind, prompt}, question?, selection?, page?: {title, url, text}, image?: {src, alt, caption, context}, history? }
function buildTurn(req) {
  const kind = req.task?.kind ?? (req.page ? 'page' : req.image ? 'image' : 'text');
  const ask = req.question || req.task.prompt;
  if (req.history?.length) return { role: 'user', text: req.question };
  if (kind === 'page') {
    return { role: 'user', text: `${ask}\n\nTitle: ${req.page.title}\nURL: ${req.page.url}`, selection: req.page.text };
  }
  if (kind === 'image') {
    // The engine sends the pixels to a model that can see them, or runs the image reader first.
    const i = req.image;
    return {
      role: 'user',
      image: i.src,
      text: `${ask}\n\nWhat the page says about the image (may be empty):\nAlt text: ${i.alt || 'none'}\nCaption: ${i.caption || 'none'}\nNearby text: ${i.context || 'none'}`,
    };
  }
  return { role: 'user', text: ask, selection: req.selection };
}

// Streams one request to a port opened by content.js. Messages out: token, done, error.
const streams = new Map(); // engine request id -> port
const downloads = new Set(); // ports waiting on a first-run model download
function onRunPort(port) {
  let id = null;
  port.onMessage.addListener(async (req) => {
    if (req.type === 'cancel') return engine('cancel').catch(() => {});
    if (req.type === 'download') {
      // First-run setup from the page: download the default model, relaying progress to the card.
      downloads.add(port);
      try {
        await engine('download', { name: MODELS[0].name });
        port.postMessage({ type: 'downloaded' });
      } catch (e) {
        port.postMessage({ type: 'error', message: e.message });
      } finally {
        downloads.delete(port);
      }
      return;
    }
    id = crypto.randomUUID();
    streams.set(id, port);
    try {
      const turn = buildTurn(req);
      const turns = [...(req.history || []), turn];
      const loaded = await engine('ensureLoaded');
      const r = await engine('generate', { id, turns, config: req.config || {} });
      const kept = turn.selection ? `${r.userText}\n\n${turn.selection.slice(0, PAGE_TEXT_IN_HISTORY)}` : r.userText;
      for (const m of modules) m.onAnswer?.(req, r, port.sender);
      port.postMessage({ type: 'done', text: r.text, stats: r.stats, model: loaded.name, history: [...(req.history || []), { role: 'user', text: kept }, { role: 'model', text: r.text }] });
    } catch (e) {
      const noModel = /No model downloaded/.test(e.message);
      port.postMessage({ type: 'error', message: e.message, ...(noModel && { code: 'no-model', model: MODELS[0] }) });
    } finally {
      streams.delete(id);
    }
  });
  port.onDisconnect.addListener(() => {
    if (id && streams.has(id)) engine('cancel').catch(() => {}); // card closed mid-answer
  });
}
chrome.runtime.onConnect.addListener((port) => port.name === 'run' && onRunPort(port));

// ---- right-click menu ----

// Rebuilds are chained: removeAll + create racing with itself would hit duplicate ids.
let menus = Promise.resolve();
const buildMenus = () => (menus = menus.then(rebuildMenus, rebuildMenus));
async function rebuildMenus() {
  const tasks = await getTasks();
  await chrome.contextMenus.removeAll();
  const roots = { text: ['selection'], page: ['page'], image: ['image'] };
  for (const [kind, contexts] of Object.entries(roots)) {
    chrome.contextMenus.create({ id: `root-${kind}`, title: 'Edge Gallery', contexts });
    for (const t of tasks.filter((x) => x.kind === kind)) {
      chrome.contextMenus.create({ id: `task:${t.id}`, parentId: `root-${kind}`, title: t.title, contexts });
    }
    chrome.contextMenus.create({ id: `ask:${kind}`, parentId: `root-${kind}`, title: 'Ask…', contexts });
  }
  for (const m of modules) m.menus?.(); // modules' own items (removeAll above dropped them)
}

// Pages where content.js runs get the in-page card; the PDF viewer and browser pages fall back
// to the side panel. Decided synchronously because sidePanel.open needs the click's user gesture.
const READER = chrome.runtime.getURL('reader.html');
const inPage = (info) =>
  (info.pageUrl || '').startsWith(READER) || (/^https?:|^file:/.test(info.frameUrl || info.pageUrl) && !/\.pdf($|[?#])/i.test(info.pageUrl));

// The reader is an extension page: tabs.sendMessage doesn't reach it, so it gets a runtime message
// addressed to its tab (content/core.js checks toTab).
async function toTab(tabId, msg, opts) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url?.startsWith(READER)) return chrome.runtime.sendMessage({ ...msg, toTab: tabId });
  return chrome.tabs.sendMessage(tabId, msg, opts);
}

async function handleMenuClick(info, tab) {
  const [type, id] = info.menuItemId.split(':');
  const task = type === 'task' ? (await getTasks()).find((t) => t.id === id) : null;
  if (inPage(info)) {
    const msg = { type: 'menu', task, ask: type === 'ask' ? id : null, srcUrl: info.srcUrl };
    await toTab(tab.id, msg, { frameId: info.frameId ?? 0 });
    return;
  }
  // Side panel fallback (selected text in PDFs and pages content scripts can't reach).
  const pending = task?.kind === 'text'
    ? { kind: 'text', title: task.title, prompt: task.prompt, selection: info.selectionText }
    : { kind: 'text', title: 'Ask…', selection: info.selectionText ?? '' };
  await chrome.storage.session.set({ pending: { ...pending, at: Date.now() } });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!/^(task|ask):/.test(info.menuItemId)) return; // other modules' items (e.g. reader:) handle themselves
  if (!inPage(info)) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  handleMenuClick(info, tab).catch((e) => console.warn('menu action failed', e));
});

// Keyboard shortcuts: open the on-page launcher, or run the first page task.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'launcher') return toTab(tab.id, { type: 'launcher' }).catch(() => {});
  if (command !== 'page-task') return;
  const task = (await getTasks()).find((t) => t.kind === 'page');
  if (task) toTab(tab.id, { type: 'menu', task }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.source === 'engine' && (msg.type === 'token' || msg.type === 'status')) streams.get(msg.id)?.postMessage({ type: msg.type, text: msg.text });
  if (msg.source === 'engine' && msg.type === 'progress') for (const p of downloads) p.postMessage(msg);
  if (msg.target === 'bg' && msg.cmd === 'ensure') {
    ensureEngine().then(() => reply(true));
    return true;
  }
  if (msg.target === 'bg' && handlers[msg.cmd]) {
    Promise.resolve()
      .then(() => handlers[msg.cmd](msg, _sender))
      .then((result) => reply({ ok: true, result }), (e) => reply({ ok: false, error: e.message }));
    return true;
  }
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
chrome.runtime.onStartup.addListener(ensureEngine);
chrome.runtime.onInstalled.addListener(ensureEngine);
// Seeding is idempotent, so run it on every worker start: onInstalled isn't guaranteed to fire
// (e.g. an unpacked reload into an existing profile).
seedTasks().then(buildMenus);
for (const m of modules) m.init?.();
chrome.storage.sync.onChanged.addListener((c) => c.tasks && buildMenus());

// For tests that drive the worker directly (Playwright can't click native context menus).
Object.assign(self, { ensureEngine, handleMenuClick, seedTasks });
