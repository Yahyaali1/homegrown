// Page monitors (notify with a summary of what changed) and scheduled tasks (run a page task on a URL
// every hour/day). Both run on chrome.alarms; results surface as notifications.
// Storage (chrome.storage.local): monitors [{id,url,title,interval,hash,text,lastSummary,checkedAt}],
// schedules [{id,taskId,url,interval}], scheduledResults [{id,taskTitle,url,text,at}] (newest first, 50 kept).
import { ask } from './engine.js';

const MINUTES = { hourly: 60, daily: 1440 };
const KEEP_TEXT = 20000; // chars of page text kept per monitor for the next diff

// Fetched page as readable lines. ponytail: regex tag strip, no DOM in the worker; good enough to diff text.
async function pageText(url) {
  const html = await (await fetch(url, { credentials: 'include', cache: 'no-store' })).text();
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
    .slice(0, KEEP_TEXT);
}

async function hash(s) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ponytail: set diff of lines (order ignored), fine for "what changed" summaries
function diff(before, after) {
  const was = new Set(before.split('\n'));
  const now = new Set(after.split('\n'));
  return [...[...now].filter((l) => !was.has(l)).map((l) => `+ ${l}`), ...[...was].filter((l) => !now.has(l)).map((l) => `- ${l}`)].join('\n');
}

const get = async (key) => (await chrome.storage.local.get({ [key]: [] }))[key];
const put = (key, v) => chrome.storage.local.set({ [key]: v });

async function notify(title, message, url) {
  const id = `eg-${crypto.randomUUID()}`;
  const { notifUrls = {} } = await chrome.storage.session.get('notifUrls');
  await chrome.storage.session.set({ notifUrls: { ...notifUrls, [id]: url } });
  chrome.notifications.create(id, { type: 'basic', iconUrl: 'icon128.png', title, message: message.slice(0, 300) });
}

async function check(id) {
  const list = await get('monitors');
  const m = list.find((x) => x.id === id);
  if (!m) return null;
  const text = await pageText(m.url);
  const h = await hash(text);
  m.checkedAt = Date.now();
  if (h !== m.hash) {
    const changes = diff(m.text, text);
    m.lastSummary = changes
      ? await ask('Lines starting with + were added to this web page and lines starting with - were removed. In one or two sentences, say what changed.', changes)
      : 'The page changed only in layout.';
    m.changedAt = Date.now();
    Object.assign(m, { hash: h, text });
    notify(`Changed: ${m.title}`, m.lastSummary, m.url);
  }
  await put('monitors', list);
  return m;
}

async function runSchedule(id) {
  const s = (await get('schedules')).find((x) => x.id === id);
  if (!s) return null;
  const { tasks = [] } = await chrome.storage.sync.get('tasks');
  const task = tasks.find((t) => t.id === s.taskId);
  if (!task) return null;
  const text = await ask(`${task.prompt}\n\nURL: ${s.url}`, await pageText(s.url));
  const result = { id: crypto.randomUUID().slice(0, 8), taskTitle: task.title, url: s.url, text, at: Date.now() };
  await put('scheduledResults', [result, ...(await get('scheduledResults'))].slice(0, 50));
  notify(`${task.title}: ${new URL(s.url).hostname}`, text, s.url);
  return result;
}

// Listeners at top level so the worker wakes for them.
chrome.alarms.onAlarm.addListener(({ name }) => {
  const [kind, id] = name.split(':');
  if (kind === 'mon') check(id).catch((e) => console.warn('monitor check failed', e));
  if (kind === 'sched') runSchedule(id).catch((e) => console.warn('scheduled task failed', e));
});
chrome.notifications.onClicked.addListener(async (id) => {
  const { notifUrls = {} } = await chrome.storage.session.get('notifUrls');
  if (notifUrls[id]) chrome.tabs.create({ url: notifUrls[id] });
  chrome.notifications.clear(id);
});

export const handlers = {
  watchPage: async ({ url, title, interval }) => {
    const text = await pageText(url);
    const m = { id: crypto.randomUUID().slice(0, 8), url, title, interval, hash: await hash(text), text, lastSummary: '', checkedAt: Date.now() };
    await put('monitors', [...(await get('monitors')).filter((x) => x.url !== url), m]);
    chrome.alarms.create(`mon:${m.id}`, { periodInMinutes: MINUTES[interval] });
    return { id: m.id };
  },
  unwatch: async ({ id }) => {
    chrome.alarms.clear(`mon:${id}`);
    await put('monitors', (await get('monitors')).filter((x) => x.id !== id));
  },
  // Monitors without their stored page text (too big to send around).
  listMonitors: async () => (await get('monitors')).map(({ text, ...m }) => m),
  checkNow: async ({ id }) => {
    const m = await check(id);
    return m && { lastSummary: m.lastSummary, changedAt: m.changedAt };
  },

  schedule: async ({ taskId, url, interval }) => {
    const s = { id: crypto.randomUUID().slice(0, 8), taskId, url, interval };
    await put('schedules', [...(await get('schedules')), s]);
    chrome.alarms.create(`sched:${s.id}`, { periodInMinutes: MINUTES[interval] });
    return s;
  },
  unschedule: async ({ id }) => {
    chrome.alarms.clear(`sched:${id}`);
    await put('schedules', (await get('schedules')).filter((x) => x.id !== id));
  },
  runScheduleNow: ({ id }) => runSchedule(id),
};
