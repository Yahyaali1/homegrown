// Service worker: keeps the offscreen engine alive, runs requests from the in-page UI over a port, owns the
// right-click menu and shortcuts, and hands PDF and browser-page actions to the side panel. Built to background.js.
import { DEFAULT_TASKS, getTasks } from '../shared/actions.ts';
import type { PageRequest } from '../shared/protocol.ts';
import { MODELS } from '../domain/model.ts';
import { ensureEngine, engine, modelFor } from './engine.ts';
import { toTab, injectInto } from './pagesend.ts';
import * as missions from './missions.ts';
import * as reader from './reader.ts';
import * as web from './web.ts';
import * as capture from './capture.ts';
import * as tabs from './tabs.ts';
import * as monitors from './monitors.ts';
import * as memory from './memory.ts';
import * as livecaptions from './livecaptions.ts';
import * as scrape from './scrape.ts';
import * as garden from './garden.ts';
import * as outputs from './outputs.ts';
import * as mcp from './mcp.ts';
import { tabText } from './tabs.ts';
import { isExtensionPage } from './pagerequest.ts';
import { sameSite } from '../domain/links.ts';
import { parseSettings } from '../domain/settings.ts';

type Handler = (msg: never, sender?: chrome.runtime.MessageSender) => unknown;
/** A feature module: its handlers become bg commands; the hooks are optional. */
interface BackgroundModule {
  handlers?: Record<string, Handler>;
  init?(): void;
  /** Adds its own right-click items (the menu is rebuilt from scratch). */
  menus?(): void;
  /** Called after every answer to a page request. */
  onAnswer?(req: unknown, result: { text: string }, sender?: chrome.runtime.MessageSender): unknown;
}
const modules: BackgroundModule[] = [reader, web, capture, tabs, monitors, memory, livecaptions, missions, scrape, garden, outputs, mcp];
const handlers: Record<string, Handler> = Object.assign({}, ...modules.map((m) => m.handlers ?? {}));
// The side panel's page buttons: send to the active tab's in-page UI (re-injecting it if needed).
handlers.toPage = async ({ msg }: { msg: object }) => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined) throw new Error('No tab is open.');
  await toTab(tab.id, msg);
  return true;
};
// A link in an answer: the active tab follows it when it's on the same site (settings.linksInActiveTab), else a new
// tab opens beside it.
handlers.openLink = async ({ url }: { url: string }, sender?: chrome.runtime.MessageSender) => {
  if (!isExtensionPage(sender)) throw new Error('Only Homegrown’s own pages can do that.');
  const u = new URL(String(url));
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only web links open.');
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  const [tab] = win?.id === undefined ? [] : await chrome.tabs.query({ active: true, windowId: win.id });
  const host = tab?.url && /^https?:/.test(tab.url) ? new URL(tab.url).hostname : '';
  if (tab?.id !== undefined && host && sameSite(host, u.hostname) && parseSettings(await chrome.storage.sync.get('linksInActiveTab')).linksInActiveTab) {
    await chrome.tabs.update(tab.id, { url: u.href });
  } else await chrome.tabs.create({ url: u.href, ...(tab && { windowId: tab.windowId, index: tab.index + 1 }) });
  return true;
};

// ---- tasks ----

async function seedTasks(): Promise<void> {
  const { tasks, customPrompts } = await chrome.storage.sync.get(['tasks', 'customPrompts']);
  if (tasks) return;
  // Prompts saved by v0.1 become text tasks.
  const migrated = (Array.isArray(customPrompts) ? customPrompts : []).map((p: { id: string; title: string; prompt: string }) => ({ id: p.id, kind: 'text', title: p.title, prompt: p.prompt }));
  await chrome.storage.sync.set({ tasks: [...DEFAULT_TASKS, ...migrated] });
  await chrome.storage.sync.remove('customPrompts');
}

const PAGE_TEXT_IN_HISTORY = 6000; // ponytail: follow-ups keep only this much of a page or selection, so they fit the context

interface EngineTurn { role: 'user'; text: string; image?: string; selection?: string }

function buildTurn(req: PageRequest): EngineTurn {
  const kind = req.task?.kind ?? (req.page ? 'page' : req.image ? 'image' : 'text');
  const ask = req.question || req.task?.prompt || '';
  if (req.history?.length) return { role: 'user', text: req.question ?? '' };
  if (kind === 'page' && req.page) return { role: 'user', text: `${ask}\n\nTitle: ${req.page.title}\nURL: ${req.page.url}`, selection: req.page.text };
  if (kind === 'image' && req.image) {
    // The engine sends the pixels to a model that can see them, or runs the image reader first.
    const i = req.image;
    return { role: 'user', image: i.src, text: `${ask}\n\nWhat the page says about the image (may be empty):\nAlt text: ${i.alt || 'none'}\nCaption: ${i.caption || 'none'}\nNearby text: ${i.context || 'none'}` };
  }
  return { role: 'user', text: ask, ...(req.selection !== undefined && { selection: req.selection }) };
}

// Streams one request to a port opened by content.js. Messages out: token, status, done, error.
const streams = new Map<string, chrome.runtime.Port>(); // engine request id → port
const downloads = new Set<chrome.runtime.Port>(); // ports waiting on a first-run model download
const firstModel = MODELS[0]!;

function onRunPort(port: chrome.runtime.Port): void {
  let id: string | null = null;
  port.onMessage.addListener(async (req: PageRequest & { type?: string }) => {
    if (req.type === 'cancel') return engine('cancel').catch(() => {});
    if (req.type === 'download') {
      // First-run setup from the page: download the default model, relaying progress to the card.
      downloads.add(port);
      try {
        await engine('download', { name: firstModel.id });
        port.postMessage({ type: 'downloaded' });
      } catch (e) {
        port.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
      } finally {
        downloads.delete(port);
      }
      return;
    }
    id = crypto.randomUUID();
    streams.set(id, port);
    try {
      const turn = buildTurn(req);
      const loaded = await engine<{ name: string }>('ensureLoaded');
      const r = await engine<{ text: string; stats: object; userText: string }>('generate', {
        id, turns: [...(req.history ?? []), turn], config: req.config ?? {}, model: await modelFor(req.quiet ? 'background' : 'page'), priority: req.quiet ? 'background' : 'user',
      });
      const kept = turn.selection ? `${r.userText}\n\n${turn.selection.slice(0, PAGE_TEXT_IN_HISTORY)}` : r.userText;
      for (const m of modules) m.onAnswer?.(req, r, port.sender);
      port.postMessage({ type: 'done', text: r.text, stats: r.stats, model: loaded.name, history: [...(req.history ?? []), { role: 'user', text: kept }, { role: 'model', text: r.text }] });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const noModel = /No model downloaded/.test(message);
      // The card offers the download: it reads name and size in the shape pages have always used.
      port.postMessage({ type: 'error', message, ...(noModel && { code: 'no-model', model: { name: firstModel.id, sizeInBytes: firstModel.source.sizeBytes } }) });
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
async function rebuildMenus(): Promise<void> {
  const tasks = await getTasks();
  await chrome.contextMenus.removeAll();
  const roots = { text: ['selection'], page: ['page'], image: ['image'] } as const;
  for (const kind of ['text', 'page', 'image'] as const) {
    const contexts: [`${chrome.contextMenus.ContextType}`] = [roots[kind][0]];
    chrome.contextMenus.create({ id: `root-${kind}`, title: 'Homegrown', contexts });
    for (const t of tasks.filter((x) => x.kind === kind)) chrome.contextMenus.create({ id: `task:${t.id}`, parentId: `root-${kind}`, title: t.title, contexts });
    chrome.contextMenus.create({ id: `ask:${kind}`, parentId: `root-${kind}`, title: 'Ask…', contexts });
  }
  chrome.contextMenus.create({ id: 'chat:page', title: 'Open in chat', contexts: ['page'] });
  chrome.contextMenus.create({ id: 'chat:link', title: 'Open in chat', contexts: ['link'] });
  for (const m of modules) m.menus?.(); // modules' own items (removeAll above dropped them)
}

// Pages where content.js runs get the in-page card; the PDF viewer and browser pages fall back to the side panel.
// Decided synchronously, because sidePanel.open needs the click's user gesture.
const READER = chrome.runtime.getURL('reader.html');
const inPage = (info: chrome.contextMenus.OnClickData) =>
  (info.pageUrl || '').startsWith(READER) || (/^https?:|^file:/.test(info.frameUrl || info.pageUrl || '') && !/\.pdf($|[?#])/i.test(info.pageUrl || ''));

// After an install or reload, existing tabs get the page scripts too (the ❀ button appears without a page reload).
chrome.runtime.onInstalled.addListener(async () => {
  for (const tab of await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'], discarded: false })) injectInto(tab).catch(() => {});
});

const CHAT_TEXT = 15000;
/** Open in chat: the page (read like `read_my_tab`, no debugger) or the link (fetched signed out) becomes the attachment. */
async function chatAttach(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) {
  const url = info.menuItemId === 'chat:link' ? info.linkUrl ?? '' : info.pageUrl ?? tab?.url ?? '';
  if (!/^https?:/.test(url)) throw new Error('Only web pages open in chat.');
  const read = info.menuItemId === 'chat:page' && tab?.id !== undefined
    ? { title: tab.title ?? '', text: await tabText(tab.id, CHAT_TEXT).catch(() => '') } : { title: '', text: '' };
  const page = read.text ? read : await web.handlers.fetchText({ url });
  return { kind: 'text', title: 'Open in chat', selection: `${page.title}\n${url}\n\n${page.text.slice(0, CHAT_TEXT)}` };
}

async function handleMenuClick(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<void> {
  const [type, id] = String(info.menuItemId).split(':');
  if (type === 'chat') {
    const pending = await chatAttach(info, tab).catch((e: Error) => ({ kind: 'text', title: 'Open in chat', error: e.message }));
    return void (await chrome.storage.session.set({ pending: { ...pending, at: Date.now() } }));
  }
  const task = type === 'task' ? (await getTasks()).find((t) => t.id === id) ?? null : null;
  if (inPage(info) && tab?.id !== undefined) {
    await toTab(tab.id, { type: 'menu', task, ask: type === 'ask' ? id : null, srcUrl: info.srcUrl }, { frameId: info.frameId ?? 0 });
    return;
  }
  // Side panel fallback (selected text in PDFs, and pages content scripts can't reach).
  const pending = task?.kind === 'text'
    ? { kind: 'text', title: task.title, prompt: task.prompt, selection: info.selectionText }
    : { kind: 'text', title: 'Ask…', selection: info.selectionText ?? '' };
  await chrome.storage.session.set({ pending: { ...pending, at: Date.now() } });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!/^(task|ask|chat):/.test(String(info.menuItemId))) return; // other modules' items (reader:…) handle themselves
  if ((!inPage(info) || String(info.menuItemId).startsWith('chat:')) && tab?.windowId !== undefined) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  handleMenuClick(info, tab).catch((e) => console.warn('menu action failed', e));
});

// Keyboard shortcuts: open the on-page launcher, or run the first page task.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (tab?.id === undefined) return;
  if (command === 'launcher') return void toTab(tab.id, { type: 'launcher' }).catch(() => {});
  if (command !== 'page-task') return;
  const task = (await getTasks()).find((t) => t.kind === 'page');
  if (task) toTab(tab.id, { type: 'menu', task }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.source === 'engine' && (msg.type === 'token' || msg.type === 'status')) streams.get(msg.id)?.postMessage({ type: msg.type, text: msg.text });
  if (msg.source === 'engine' && msg.type === 'progress') for (const p of downloads) p.postMessage(msg);
  if (msg.target === 'bg' && msg.cmd === 'ensure') {
    ensureEngine().then(() => reply({ ok: true, result: true }), (e: unknown) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true;
  }
  const handler = msg.target === 'bg' ? handlers[msg.cmd] : undefined;
  if (handler) {
    Promise.resolve()
      .then(() => handler(msg as never, sender))
      .then((result) => reply({ ok: true, result }), (e: unknown) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true;
  }
  return undefined;
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onStartup.addListener(ensureEngine);
chrome.runtime.onInstalled.addListener(ensureEngine);
// Seeding is idempotent, so it runs on every worker start: onInstalled isn't guaranteed to fire (an unpacked reload
// into an existing profile).
void seedTasks().then(buildMenus);
for (const m of modules) m.init?.();
chrome.storage.sync.onChanged.addListener((c) => c.tasks && buildMenus());

// For tests that drive the worker directly (Playwright can't click native context menus).
Object.assign(self, { ensureEngine, handleMenuClick, seedTasks, bgHandlers: handlers, missionScheduled: missions.scheduled, gardenFire: garden.gardenFire });
