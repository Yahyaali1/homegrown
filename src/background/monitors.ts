// Page monitors (a notification summarising what changed) and scheduled tasks (a page task on a URL every hour or
// day). Both run on chrome.alarms; results surface as notifications.
// chrome.storage.local: monitors, schedules, scheduledResults (newest first, 50 kept).
import { ask } from './engine.ts';
import { diffText } from '../domain/compare.ts';
import { htmlText } from '../domain/text.ts';
import { getTasks } from '../shared/actions.ts';

type Interval = 'hourly' | 'daily';
const MINUTES: Record<Interval, number> = { hourly: 60, daily: 1440 };

interface Monitor { id: string; url: string; title: string; interval: Interval; hash: string; text: string; lastSummary: string; checkedAt: number; changedAt?: number }
interface Schedule { id: string; taskId: string; url: string; interval: Interval }
interface ScheduledResult { id: string; taskTitle: string; url: string; text: string; at: number }
interface Stored { monitors: Monitor[]; schedules: Schedule[]; scheduledResults: ScheduledResult[] }

const pageText = async (url: string): Promise<string> => htmlText(await (await fetch(url, { credentials: 'include', cache: 'no-store' })).text());

/**
 * A gardener's event check fetch: at most 30 s. An error status fails the check (a 503 or a login wall must not become
 * the snapshot), and so does any redirect of a signed-in fetch, so cookies never follow it off the page's host.
 */
export async function checkFetch(url: string, credentials: RequestCredentials, get: typeof fetch = fetch): Promise<string> {
  const res = await get(url, { credentials, cache: 'no-store', redirect: credentials === 'include' ? 'manual' : 'follow', signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(res.type === 'opaqueredirect' ? 'The page redirected.' : `The page answered ${res.status}.`);
  return htmlText(await res.text());
}

async function hash(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const get = async <K extends keyof Stored>(key: K): Promise<Stored[K]> => {
  const v = (await chrome.storage.local.get(key))[key];
  return (Array.isArray(v) ? v : []) as Stored[K];
};
const put = <K extends keyof Stored>(key: K, v: Stored[K]) => chrome.storage.local.set({ [key]: v });

async function notify(title: string, message: string, url: string): Promise<void> {
  const id = `eg-${crypto.randomUUID()}`;
  const { notifUrls } = await chrome.storage.session.get('notifUrls');
  await chrome.storage.session.set({ notifUrls: { ...(notifUrls as object | undefined), [id]: url } });
  chrome.notifications.create(id, { type: 'basic', iconUrl: 'icon128.png', title, message: message.slice(0, 300) });
}

async function check(id: string): Promise<Monitor | null> {
  const list = await get('monitors');
  const m = list.find((x) => x.id === id);
  if (!m) return null;
  const text = await pageText(m.url);
  const h = await hash(text);
  m.checkedAt = Date.now();
  if (h !== m.hash) {
    const changes = diffText(m.text, text);
    m.lastSummary = changes
      ? await ask('Lines starting with + were added to this web page and lines starting with - were removed. In one or two sentences, say what changed.', changes)
      : 'The page changed only in layout.';
    Object.assign(m, { changedAt: Date.now(), hash: h, text });
    void notify(`Changed: ${m.title}`, m.lastSummary, m.url);
  }
  await put('monitors', list);
  return m;
}

async function runSchedule(id: string): Promise<ScheduledResult | null> {
  const s = (await get('schedules')).find((x) => x.id === id);
  const task = s && (await getTasks()).find((t) => t.id === s.taskId);
  if (!s || !task) return null;
  const text = await ask(`${task.prompt}\n\nURL: ${s.url}`, await pageText(s.url));
  const result = { id: crypto.randomUUID().slice(0, 8), taskTitle: task.title, url: s.url, text, at: Date.now() };
  await put('scheduledResults', [result, ...(await get('scheduledResults'))].slice(0, 50));
  void notify(`${task.title}: ${new URL(s.url).hostname}`, text, s.url);
  return result;
}

export function init(): void {
  chrome.alarms.onAlarm.addListener(({ name }) => {
    const [kind, id = ''] = name.split(':');
    if (kind === 'mon') check(id).catch((e) => console.warn('monitor check failed', e));
    if (kind === 'sched') runSchedule(id).catch((e) => console.warn('scheduled task failed', e));
  });
  chrome.notifications.onClicked.addListener(async (id) => {
    if (!id.startsWith('eg-')) return; // other modules' notifications
    const { notifUrls } = await chrome.storage.session.get('notifUrls');
    const url = (notifUrls as Record<string, string> | undefined)?.[id];
    if (url) void chrome.tabs.create({ url });
    void chrome.notifications.clear(id);
  });
}

export const handlers = {
  watchPage: async ({ url, title, interval }: { url: string; title: string; interval: Interval }) => {
    const text = await pageText(url);
    const m: Monitor = { id: crypto.randomUUID().slice(0, 8), url, title, interval, hash: await hash(text), text, lastSummary: '', checkedAt: Date.now() };
    await put('monitors', [...(await get('monitors')).filter((x) => x.url !== url), m]);
    void chrome.alarms.create(`mon:${m.id}`, { periodInMinutes: MINUTES[interval] });
    return { id: m.id };
  },
  unwatch: async ({ id }: { id: string }) => {
    void chrome.alarms.clear(`mon:${id}`);
    await put('monitors', (await get('monitors')).filter((x) => x.id !== id));
  },
  /** Monitors without their stored page text (too big to send around). */
  listMonitors: async () => (await get('monitors')).map(({ text: _text, ...m }) => m),
  checkNow: async ({ id }: { id: string }) => {
    const m = await check(id);
    return m && { lastSummary: m.lastSummary, changedAt: m.changedAt };
  },
  schedule: async ({ taskId, url, interval }: Omit<Schedule, 'id'>) => {
    const s: Schedule = { id: crypto.randomUUID().slice(0, 8), taskId, url, interval };
    await put('schedules', [...(await get('schedules')), s]);
    void chrome.alarms.create(`sched:${s.id}`, { periodInMinutes: MINUTES[interval] });
    return s;
  },
  unschedule: async ({ id }: { id: string }) => {
    void chrome.alarms.clear(`sched:${id}`);
    await put('schedules', (await get('schedules')).filter((x) => x.id !== id));
  },
  runScheduleNow: ({ id }: { id: string }) => runSchedule(id),
};
