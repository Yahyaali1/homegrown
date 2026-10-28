// Missions in the service worker: the mission domain wired to Chrome. Background tabs search and read pages, the
// engine answers with the Missions model, and progress goes to extension pages as {type:'agent-progress', runId, …}.
// Several missions run at once; each can be attached to, and a nudge says when one ends unwatched.
// Built to bg/agent.js and keeps that module's handlers, messages and storage keys (ADR-11).
import { ask as engineAsk } from './engine.ts';
import { search as webSearch } from './web.ts';
import { toTab } from './pagesend.ts';
import { plan } from '../domain/mission/plan.ts';
import { runMission, runWorkflow, Stopped } from '../domain/mission/runner.ts';
import { parseWorkflow } from '../domain/mission/workflow.ts';
import { applyFilter } from '../domain/mission/rows.ts';
import { productKey } from '../domain/mission/brief.ts';
import { hostOf, num } from '../domain/text.ts';
import { columns, type Row, type SearchResult, type Workflow } from '../domain/mission/types.ts';
import type { Ask, MissionEvent, MissionPorts } from '../domain/mission/ports.ts';
import { mergeFrames, type PageModel } from '../shared/pagemodel.ts';

// Every model call in a mission uses the Missions model (Settings → Models → Use for).
const ask: Ask = (instruction, data = '', sampling = {}) => engineAsk(instruction, data, { task: 'missions', ...sampling });

// ---- the browser as a tool: background tabs in one collapsed group ----

/** Search engines in the order they're tried (ADR-10: a new engine is a new entry). Each runs in a real tab. */
interface SearchEngine {
  url(query: string): string;
  /** Engines that draw results with JavaScript need a moment after load. */
  settleMs: number;
  select: { item: string; title: string; link: string; snippet: string };
}
const ENGINES: readonly SearchEngine[] = [
  { url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=en`, settleMs: 0, select: { item: 'li.b_algo', title: 'h2', link: 'h2 a', snippet: '.b_caption p, p' } },
  { url: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}&kl=us-en`, settleMs: 2000, select: { item: 'article[data-testid=result]', title: 'h2', link: 'a[data-testid=result-title-a]', snippet: '[data-result=snippet]' } },
  { url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`, settleMs: 2000, select: { item: '#results .snippet[data-type=web]', title: '.title', link: 'a', snippet: '.snippet-description, .generic-snippet' } },
];

/** A running mission's handles: Stop, and the tab group its tabs live in. */
export interface Run { stop: AbortController; group?: number | undefined }
const runs = new Map<string, Run>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function waitLoaded(tabId: number, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t || t.status === 'complete') return;
    await sleep(300);
  }
}

/**
 * Opens url in a background tab inside the run's "❀ Mission" group, runs `use`, and always closes the tab. Stop, or
 * a page that hangs for `timeoutMs`, ends the wait at once: a busy or hostile page can't hold the run.
 */
export async function inTab<T>(url: string, run: Run, use: (tabId: number) => Promise<T>, timeoutMs = 90000): Promise<T> {
  run.stop.signal.throwIfAborted();
  const tab = await chrome.tabs.create({ url, active: false });
  const tabId = tab.id!;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  try {
    run.group = await chrome.tabs.group({ tabIds: tabId, ...(run.group !== undefined && { groupId: run.group }) }).catch(() => run.group);
    if (run.group !== undefined) chrome.tabGroups.update(run.group, { title: '❀ Mission', collapsed: true }).catch(() => {});
    const cut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${new URL(url).hostname} took too long to read.`)), timeoutMs);
      onAbort = () => reject(new DOMException('Stopped', 'AbortError'));
      run.stop.signal.addEventListener('abort', onAbort, { once: true });
      if (run.stop.signal.aborted) onAbort(); // Stop pressed while the tab was opening
    });
    return await Promise.race([use(tabId), cut]);
  } finally {
    clearTimeout(timer);
    run.stop.signal.removeEventListener('abort', onAbort);
    chrome.tabs.remove(tabId).catch(() => {});
  }
}

function searchInTab(query: string, n: number, run: Run, engine: SearchEngine): Promise<SearchResult[]> {
  return inTab(engine.url(query), run, async (tabId) => {
    await waitLoaded(tabId, 15000);
    if (engine.settleMs) await sleep(engine.settleMs);
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [engine.select],
      func: (s: SearchEngine['select']) => [...document.querySelectorAll(s.item)]
        .map((n) => ({ title: (n.querySelector(s.title) as HTMLElement | null)?.innerText ?? '', url: (n.querySelector(s.link) as HTMLAnchorElement | null)?.href ?? '', snippet: (n.querySelector(s.snippet) as HTMLElement | null)?.innerText ?? '' }))
        .filter((r) => r.title && /^https?:/.test(r.url)),
    });
    return (frame?.result ?? []).slice(0, n);
  });
}

// Every frame is read, cross-origin iframes included (embedded shops, widgets). A background tab is ours to change:
// lib/pageread.js may flatten shadow DOM and click controls named after the goal's terms.
function readInTab(url: string, run: Run, terms: string[]): Promise<PageModel | null> {
  return inTab(url, run, async (tabId) => {
    await waitLoaded(tabId, 20000);
    await sleep(1200); // late-rendered prices
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['lib/pageread.js'] });
    const frames = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      args: [terms],
      func: (t: string[]) => window.__hgReadPage?.({ shadow: true, terms: t, scroll: window === top }) ?? null,
    });
    const models = frames.sort((a, b) => a.frameId - b.frameId).map((f) => f.result).filter((p): p is PageModel => !!p);
    return mergeFrames(models, url);
  });
}

function portsFor(runId: string, run: Run): MissionPorts {
  return {
    ask,
    // The tab engines first; the service worker's own fetch last (engines often challenge it, but it needs no tab).
    engines: ENGINES.length + 1,
    search: (q, n, e) => (ENGINES[e] ? searchInTab(q, n, run, ENGINES[e]) : webSearch({ q, n })),
    readPage: (url, terms) => readInTab(url, run, terms),
    progress: (event) => say(runId, event),
    signal: run.stop.signal,
  };
}

/** Runs `go` with a fresh Run, then closes whatever tabs are left in its group. */
async function withRun<T>(runId: string, go: (ports: MissionPorts) => Promise<T>): Promise<T> {
  const run: Run = { stop: new AbortController() };
  runs.set(runId, run);
  try {
    return await go(portsFor(runId, run));
  } finally {
    runs.delete(runId);
    if (run.group !== undefined) chrome.tabs.query({ groupId: run.group }).then((ts) => { if (ts.length) return chrome.tabs.remove(ts.map((t) => t.id!)); }).catch(() => {});
  }
}

// ---- live missions: several at once, each attachable, kept across a service-worker restart as summaries ----

type Status = 'planning' | 'running' | 'done' | 'failed' | 'stopped';
export interface LiveMission {
  id: string;
  goal: string;
  status: Status;
  startedAt: number;
  endedAt?: number;
  workflow: Workflow | null;
  steps: { status: string; detail: string }[];
  log: string[];
  rounds: { round: number; phase?: string; note?: string; why?: string; achieved?: boolean }[];
  rows: Row[];
  answer: string;
  achieved?: boolean;
  error?: string;
  round?: number;
  phase?: string;
}
const live = new Map<string, LiveMission>();
const unseen = new Set<string>(); // finished while nobody was watching: the toolbar badge count

const summary = (m: LiveMission) => ({
  id: m.id, goal: m.goal, status: m.status, round: m.round, phase: m.phase, achieved: m.achieved, error: m.error,
  best: m.rows[0] ? columns(m.rows[0]).map(([, v]) => v).slice(0, 2).join(' · ') : '',
  answer: m.answer.replace(/\s*\[\d+\]/g, '').slice(0, 200), startedAt: m.startedAt, endedAt: m.endedAt,
});
let persistTimer: ReturnType<typeof setTimeout> | undefined;
function persist(): void {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => chrome.storage.session.set({ liveMissions: [...live.values()].map(summary) }).catch(() => {}), 300);
}
const badge = () => chrome.action.setBadgeText({ text: unseen.size ? String(unseen.size) : '' }).catch(() => {});

/** The event as extension pages receive it: {type: 'agent-progress', runId, …}. */
function wire(e: MissionEvent): Record<string, unknown> {
  switch (e.kind) {
    case 'planned': return { workflow: e.workflow };
    case 'step': { const { kind, index, ...rest } = e; return { step: index, ...rest }; }
    case 'round': { const { kind, ...rest } = e; return rest; }
  }
}

function track(m: LiveMission, e: MissionEvent): void {
  if (e.kind === 'planned') return;
  if (e.kind === 'step' && e.log) m.log = [...m.log, ...e.log].slice(-150);
  if (e.rows) m.rows = e.rows;
  if (e.answer) m.answer = e.answer;
  if (e.kind === 'step') m.steps[e.index] = { status: e.status, detail: e.detail ?? m.steps[e.index]?.detail ?? '' };
  else {
    m.round = e.round;
    m.phase = e.phase;
    const r = (m.rounds[e.round - 1] ??= { round: e.round });
    r.phase = e.phase;
    if (e.note) r.note = e.note;
    if (e.phase === 'verdict') Object.assign(r, { why: e.why, achieved: e.achieved });
  }
  persist();
}

function say(runId: string, e: MissionEvent): void {
  const m = live.get(runId);
  if (m) track(m, e);
  chrome.runtime.sendMessage({ type: 'agent-progress', runId, ...wire(e) }).catch(() => {});
}

function missionStart({ goal, workflow = null, context = '', urls = [], onDone = nudge }:
  { goal: string; workflow?: Workflow | null; context?: string; urls?: string[]; onDone?: (m: LiveMission) => unknown }): { id: string } {
  const id = crypto.randomUUID().slice(0, 8);
  const m: LiveMission = { id, goal, status: 'planning', startedAt: Date.now(), workflow, steps: [], log: [], rounds: [], rows: [], answer: '' };
  live.set(id, m);
  persist();
  void (async () => {
    try {
      const wf = m.workflow ?? (await plan(ask, goal, context));
      // Started from "my open tabs": read those pages instead of searching.
      if (!m.workflow && urls.length) {
        wf.steps = wf.steps.map((s) => (s.type === 'search' ? { ...s, urls, query: `${urls.length} open tabs` } : s.type === 'open' ? { ...s, limit: urls.length } : s));
      }
      m.workflow = wf;
      m.status = 'running';
      say(id, { kind: 'planned', workflow: wf });
      const r = await withRun(id, (ports) => runMission(ports, wf));
      Object.assign(m, { status: 'done', rows: r.rows, answer: r.answer, achieved: r.achieved });
    } catch (e) {
      Object.assign(m, { status: e instanceof Stopped ? 'stopped' : 'failed', error: e instanceof Error ? e.message : String(e) });
    }
    m.endedAt = Date.now();
    persist();
    chrome.runtime.sendMessage({ type: 'agent-done', runId: id, mission: m }).catch(() => {});
    onDone(m);
  })();
  return { id };
}

const MISSION_PAGE = () => chrome.runtime.getURL('agent.html');
const openMission = (id: string) => {
  unseen.delete(id);
  badge();
  return chrome.tabs.create({ url: `${MISSION_PAGE()}?run=${id}` });
};

// A small nudge when a mission ends and its Mission control isn't the tab you're looking at: on the page you're on,
// else a system notification (another app, or a browser page). Plus the badge count.
async function nudge(m: LiveMission): Promise<void> {
  if (m.status === 'stopped') return;
  const win = await chrome.windows.getLastFocused().catch(() => null);
  const [tab] = win?.id !== undefined ? await chrome.tabs.query({ active: true, windowId: win.id }) : [];
  if (win?.focused && tab?.url?.startsWith(MISSION_PAGE()) && tab.url.includes(`run=${m.id}`)) return; // watching it
  unseen.add(m.id);
  badge();
  const done = m.status === 'done';
  const title = done ? (m.achieved ? 'Mission done' : 'Mission done, best effort') : 'Mission failed';
  const text = (done ? summary(m).answer || 'Results are ready.' : m.error) ?? '';
  const msg = { type: 'nudge', id: m.id, title, goal: m.goal, text, state: done ? (m.achieved ? 'sprout' : 'stage-3') : 'wilt' };
  const onPage = win?.focused && tab?.id !== undefined && /^https?:/.test(tab.url ?? '') && (await toTab(tab.id, msg).then(() => true, () => false));
  if (!onPage) chrome.notifications.create(`live:${m.id}`, { type: 'basic', iconUrl: 'icon128.png', title: `${title}: ${m.goal.slice(0, 60)}`, message: text, priority: 1 });
}

// ---- shopping sense: a local price memory, and a same-product check across stores ----

/** A product page the content script read. */
interface SeenProduct { name: string; price: number; currency: string; url: string; gtin?: string; mpn?: string; sku?: string }
interface PricePoint { price: number; currency: string; host: string; url: string; at: number }
interface BookEntry { name: string; seen: PricePoint[]; checkedAt?: number; cheaper?: (Omit<PricePoint, 'host' | 'url'> & { host: string; url: string }) | null }
type PriceBook = Record<string, BookEntry>;

// The same product, wherever it's sold: GTIN / MPN / SKU, else the model number. Name-only products get a key too
// (for the memory), but never count as "the same item" elsewhere.
const keyOf = (p: SeenProduct) =>
  productKey({ product: p.name, ...(p.gtin && { _gtin: p.gtin }), ...(p.mpn && { _mpn: p.mpn }), ...(p.sku && { _sku: p.sku }) }) ||
  `name:${p.name.toLowerCase().replace(/\W+/g, ' ').trim().slice(0, 80)}`;
const DAY = 864e5;

async function book(): Promise<PriceBook> {
  const { priceBook } = await chrome.storage.local.get({ priceBook: {} });
  return priceBook && typeof priceBook === 'object' ? (priceBook as PriceBook) : {};
}
async function saveBook(b: PriceBook): Promise<void> {
  const last = (k: string) => b[k]?.seen.at(-1)?.at ?? 0;
  for (const k of Object.keys(b).sort((x, y) => last(y) - last(x)).slice(300)) delete b[k]; // ponytail: newest 300 products, plenty for a price memory
  await chrome.storage.local.set({ priceBook: b });
}

/** A product page was viewed: remember the price, and say what's worth knowing about it. */
async function priceSeen({ product }: { product: SeenProduct }) {
  const b = await book();
  const key = keyOf(product);
  const e = (b[key] ??= { name: product.name, seen: [] });
  const before = e.seen.filter((x) => x.currency === product.currency && Number.isFinite(x.price));
  const here = hostOf(product.url);
  if (Number.isFinite(product.price)) e.seen = [...e.seen, { price: product.price, currency: product.currency, host: here, url: product.url, at: Date.now() }].slice(-30);
  await saveBook(b);
  return {
    key,
    lowest: before.filter((x) => x.price < product.price && x.host !== here).sort((x, y) => x.price - y.price)[0] ?? null,
    lastHere: [...before].reverse().find((x) => x.host === here && x.at < Date.now() - 36e5) ?? null, // an earlier visit, not this one
    cheaper: e.cheaper && e.cheaper.at > Date.now() - DAY ? e.cheaper : null,
    checkedAt: e.checkedAt ?? 0,
  };
}

/**
 * Opt-in (settings.shoppingSense): a quiet mission looks for this exact item elsewhere, once a day per product. Only a
 * confirmed same product, at least 3% cheaper, earns a nudge. `urls` replaces the web search (tests only).
 */
async function shopCheck({ product, urls }: { product: SeenProduct; urls?: string[] }, sender?: chrome.runtime.MessageSender) {
  const key = keyOf(product);
  if (key.startsWith('name:')) return { skipped: 'no product id or model number to match on' };
  const b = await book();
  const e = (b[key] ??= { name: product.name, seen: [] });
  if ((e.checkedAt ?? 0) > Date.now() - DAY) return { skipped: 'checked today' };
  e.checkedAt = Date.now();
  await saveBook(b);
  const workflow: Workflow = {
    goal: `Find ${product.name} cheaper`, planner: 'shopping sense',
    // The product's own name words decide what's on topic (a search for "MARKUS chair" that returns people named Marcus).
    brief: { subject: product.name, subjectWords: [...new Set(product.name.toLowerCase().match(/[a-z0-9][a-z0-9-]{3,}/g) ?? [])].slice(0, 8),
      must: [], avoid: [], prefer: [], budget: null, rank: { by: 'price', order: 'asc' }, want: { kind: 'list', n: 10 }, shopping: true },
    steps: [
      { type: 'search', query: `${product.name} price`, n: 8, ...(urls && { urls }) }, { type: 'open', limit: urls?.length || 6 },
      { type: 'extract', fields: ['product', 'price', 'store'], require: [] }, { type: 'filter', field: '', op: '<', value: '' },
      { type: 'rank', by: 'price', order: 'asc', keep: 10 }, { type: 'answer', question: 'Which store sells this exact product cheapest?' },
    ],
  };
  return missionStart({ goal: workflow.goal, workflow, onDone: (m) => shopDone(m, product, key, sender?.tab?.id) });
}

async function shopDone(m: LiveMission, product: SeenProduct, key: string, tabId: number | undefined): Promise<void> {
  const here = hostOf(product.url);
  const deal = m.rows
    .filter((r) => productKey(r) === key && hostOf(r._url) !== here && (!r._currency || !product.currency || r._currency === product.currency))
    .map((r) => ({ price: num(r.price) ?? 0, host: hostOf(r._url), url: r._url ?? '' }))
    .filter((r) => r.price > 0 && r.price <= product.price * 0.97)
    .sort((x, y) => x.price - y.price)[0];
  const b = await book();
  if (b[key]) (b[key].cheaper = deal ? { ...deal, currency: product.currency, at: Date.now() } : null), await saveBook(b);
  if (!deal || tabId === undefined) return; // nothing better: stay quiet
  const money = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}${product.currency ? ` ${product.currency}` : ''}`;
  toTab(tabId, { type: 'nudge', id: m.id, href: deal.url, state: 'sprout', title: `Same item, ${money(product.price - deal.price)} less`,
    goal: product.name, text: `${deal.host}: ${money(deal.price)} (here: ${money(product.price)})` }).catch(() => {});
}

// ---- saved missions and schedules (chrome.storage.local 'missions') ----

interface SavedMission extends Workflow { id: string; name: string; every?: 'hour' | 'day'; alert?: { field: string; op: '<' | '>' | 'contains' | '='; value: string }; lastBest?: string; lastRun?: number }
const getMissions = async (): Promise<SavedMission[]> => {
  const { missions } = await chrome.storage.local.get({ missions: [] });
  return Array.isArray(missions) ? (missions as SavedMission[]) : [];
};
const setMissions = (missions: SavedMission[]) => chrome.storage.local.set({ missions });

async function scheduled(id: string): Promise<void> {
  const m = (await getMissions()).find((x) => x.id === id);
  const wf = parseWorkflow(m);
  if (!m || !wf) return;
  const { rows } = await withRun(crypto.randomUUID(), (ports) => runWorkflow(ports, wf));
  const best = rows[0];
  if (!best) return;
  const label = columns(best).map(([, v]) => v).join(' · ');
  const hit = m.alert?.field ? applyFilter([best], m.alert).length > 0 : label !== m.lastBest;
  const updated = { ...m, lastBest: label, lastRun: Date.now() };
  await setMissions((await getMissions()).map((x) => (x.id === id ? updated : x)));
  if (hit) chrome.notifications.create(`mission:${id}:${best._url}`, { type: 'basic', iconUrl: 'icon128.png', title: `Mission: ${m.name}`, message: `Best now: ${label}` });
}

const valid = (raw: unknown): Workflow => {
  const wf = parseWorkflow(raw);
  if (!wf) throw new Error('This mission can’t run: it needs a goal and a search step.');
  return wf;
};

export const handlers = {
  agentPlan: ({ goal, context = '' }: { goal: string; context?: string }) => plan(ask, goal, context),
  // loop: false runs the workflow once (benchmarks, schedules); missions from the page loop by default.
  agentRun: ({ workflow, runId, loop = true }: { workflow: unknown; runId: string; loop?: boolean }) =>
    withRun(runId, (ports) => (loop ? runMission(ports, valid(workflow)) : runWorkflow(ports, valid(workflow)))),
  agentCancel: ({ runId }: { runId: string }) => (runs.get(runId)?.stop.abort(), true),
  // tabs: true → the mission reads the current window's open web tabs instead of searching.
  // run: start it in the background and open Mission control on it; otherwise open Mission control to plan it.
  agentOpen: async ({ goal = '', run = false, context = '', tabs = false, open = true }: { goal?: string; run?: boolean; context?: string; tabs?: boolean; open?: boolean },
    sender?: chrome.runtime.MessageSender | null) => {
    const urls = tabs ? (await chrome.tabs.query({ windowId: sender?.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT })).map((t) => t.url ?? '').filter((u) => /^https?:/.test(u)) : [];
    if (run) {
      const { id } = missionStart({ goal, context, urls });
      if (open) await openMission(id);
      return { id };
    }
    await chrome.tabs.create({ url: `${MISSION_PAGE()}?${new URLSearchParams({ goal, context, urls: urls.join('\n') })}` });
    return true;
  },
  missionStart: ({ goal, workflow }: { goal: string; workflow: unknown }) => missionStart({ goal, workflow: valid(workflow) }),
  // Attaching marks it seen. Full state for Mission control; summaries for lists.
  missionState: ({ id }: { id: string }) => (unseen.delete(id), badge(), live.get(id) ?? null),
  missionsLive: () => [...live.values()].map(summary).reverse(),
  missionOpen: ({ id }: { id: string }) => openMission(id).then(() => true),
  priceSeen,
  shopCheck,
  missionForget: ({ id }: { id: string }) => (live.delete(id), unseen.delete(id), badge(), persist(), true),
  missionsList: getMissions,
  missionSave: async ({ mission }: { mission: SavedMission }) => {
    await setMissions([...(await getMissions()).filter((m) => m.id !== mission.id), mission]);
    await chrome.alarms.clear(`mission:${mission.id}`);
    if (mission.every) chrome.alarms.create(`mission:${mission.id}`, { periodInMinutes: mission.every === 'hour' ? 60 : 1440 });
    return true;
  },
  missionDelete: async ({ id }: { id: string }) => {
    await setMissions((await getMissions()).filter((m) => m.id !== id));
    await chrome.alarms.clear(`mission:${id}`);
    return true;
  },
};

export function init(): void {
  chrome.alarms.onAlarm.addListener((a) => a.name.startsWith('mission:') && scheduled(a.name.slice(8)).catch((e) => console.warn('mission failed', e)));
  chrome.notifications.onClicked.addListener((id) => {
    if (id.startsWith('mission:')) chrome.tabs.create({ url: id.split(':').slice(2).join(':') });
    if (id.startsWith('live:')) openMission(id.slice(5));
  });
  // A restarted worker owns no run yet, so tabs left in "❀ Mission" groups are orphans of the old one: close them.
  chrome.tabGroups.query({ title: '❀ Mission' }).then(async (groups) => {
    const tabs = (await Promise.all(groups.map((g) => chrome.tabs.query({ groupId: g.id })))).flat().flatMap((t) => (t.id === undefined ? [] : [t.id]));
    if (tabs.length) await chrome.tabs.remove(tabs);
  }).catch(() => {});
  // A restarted service worker can't resume a run: list what was running as interrupted.
  chrome.storage.session.get('liveMissions').then(({ liveMissions }) => {
    for (const s of (Array.isArray(liveMissions) ? liveMissions : []) as ReturnType<typeof summary>[]) {
      if (live.has(s.id)) continue;
      const interrupted = s.status === 'planning' || s.status === 'running';
      live.set(s.id, { ...s, workflow: null, steps: [], log: [], rounds: [], rows: [], answer: s.answer,
        ...(interrupted && { status: 'failed' as const, error: 'Interrupted: the browser stopped the background worker.' }) } as LiveMission);
    }
  });
  // Address bar: type "eg", a space, then the goal.
  chrome.omnibox.setDefaultSuggestion({ description: 'Run a mission on this device: %s' });
  chrome.omnibox.onInputEntered.addListener((goal) => void handlers.agentOpen({ goal, run: true }, null));
}
