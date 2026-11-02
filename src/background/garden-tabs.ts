// The tabs runs work in: the live runs, the lock bar, borrowing the person's tab (act_my_tab), Take over, the live
// view ("Watch") and downloads a run's tab started.
import { screencast } from './devtools.ts';
import { markKept, markWindow, type Run } from './missions.ts';
import { isExtensionPage, pagesOnly } from './pagerequest.ts';
import { DAY, ready, updateRun } from './garden-store.ts';
import { downloadRun, ownsTab } from '../domain/garden/tools.ts';
import type { GardenRun } from '../domain/garden/records.ts';

/**
 * Runs working now, by id: Stop, take over and the lock bar act on the entry of the run they name. `urls`: pages its
 * own tabs had open, which a download's referrer is matched against.
 */
export const live = new Map<string, { name: string; tab: Run; run: GardenRun; borrowed: Set<number>; urls: Set<string> }>();

/** The run works in this tab right now: it is in the run's group, or one the run borrowed. */
export const owned = (id: string, tab: chrome.tabs.Tab | undefined): boolean => {
  const e = live.get(id);
  return ownsTab(e && { group: e.tab.group, borrowed: e.borrowed }, tab);
};

/** No normal window open: a minimized one for `owner`'s tabs, which the caller closes when done. */
export async function spareWindow(owner: string): Promise<chrome.windows.Window | undefined> {
  if ((await chrome.windows.getAll({ windowTypes: ['normal'] })).length) return undefined;
  const w = await chrome.windows.create({ url: 'about:blank', state: 'minimized', focused: false });
  if (w?.id !== undefined) await markWindow(owner, w.id);
  return w;
}

/** act_my_tab: the person's tab is the run's for one call (lock bar, Stop, Take over); the result halts it and gives it back. */
export async function borrow(runId: string, tabId: number): Promise<() => Promise<void>> {
  const e = live.get(runId);
  if (!e) throw new DOMException('Stopped', 'AbortError');
  e.borrowed.add(tabId);
  const t = await chrome.tabs.get(tabId).catch(() => undefined);
  if (t) void lock(tabId, t);
  return async () => {
    e.borrowed.delete(tabId);
    await release(tabId);
  };
}

/** The tab a run works in now: a borrowed one (act_my_tab) first, else its newest group tab. */
async function workTab(id: string): Promise<chrome.tabs.Tab | undefined> {
  for (const t of live.get(id)?.borrowed ?? []) {
    const tab = await chrome.tabs.get(t).catch(() => undefined);
    if (tab) return tab;
  }
  return newestTab(id);
}

/** The run's newest web tab in its group, if it is working in one. */
async function newestTab(id: string): Promise<chrome.tabs.Tab | undefined> {
  const g = live.get(id)?.tab.group;
  if (g === undefined) return undefined;
  return (await chrome.tabs.query({ groupId: g }).catch(() => [])).filter((x) => /^https?:/.test(x.url ?? '')).sort((a, b) => b.id! - a.id!)[0];
}

/**
 * The lock bar, on each page a tool loads in a run's tab, from when it starts loading (a slow page is still worked
 * in). The page's script starts a moment later, so it is tried until the bar says it is up; a tab the run no longer
 * owns gets nothing.
 */
const locking = new Map<number, object>(); // one try-loop per tab: a newer load replaces it
async function lock(tabId: number, t: chrome.tabs.Tab): Promise<void> {
  const id = [...live.keys()].find((x) => owned(x, t));
  if (id === undefined || !/^https?:/.test(t.url ?? '')) return;
  const msg = { type: 'garden-lock', run: id, name: live.get(id)!.name };
  const me = {};
  locking.set(tabId, me);
  for (let k = 0; k < 30 && locking.get(tabId) === me; k++) {
    if ((await chrome.tabs.sendMessage(tabId, msg).catch(() => null)) === 'locked') break;
    await new Promise((r) => setTimeout(r, 300));
    if (!owned(id, await chrome.tabs.get(tabId).catch(() => undefined))) break;
  }
  if (locking.get(tabId) === me) locking.delete(tabId);
}

/**
 * The person has the tab now: every frame's step runner is halted (the flag lives in the content scripts' isolated
 * world, where `__hgStep` checks it before each click or fill), and the bar is told to go.
 */
export async function release(tabId: number): Promise<void> {
  locking.delete(tabId);
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => void (window.__hgHalt = true) }).catch(() => {});
  await chrome.tabs.sendMessage(tabId, { type: 'garden-unlock' }).catch(() => {});
}

/**
 * The live view ("Watch"): the run's newest tab as JPEG frames on the page's port, following it to newer tabs, until
 * the page closes the port or the run's turn ends. Frames go only to that extension page; nothing keeps them.
 */
function watch(port: chrome.runtime.Port, runId: string): void {
  if (!isExtensionPage(port.sender)) return port.disconnect();
  let on: { tabId: number; stop: Promise<(() => Promise<void>) | null> } | null = null;
  let gone = false;
  const drop = () => {
    const o = on;
    on = null;
    void o?.stop.then((s) => s?.());
  };
  const end = () => {
    gone = true;
    clearInterval(timer);
    drop();
  };
  const post = (m: object) => void (gone || port.postMessage(m));
  const tick = async () => {
    if (gone) return;
    if (!live.has(runId)) {
      post({ ended: true });
      end();
      return port.disconnect();
    }
    const t = await newestTab(runId);
    if (gone || t?.id === on?.tabId) return;
    drop();
    if (t?.id === undefined) return post({ frame: null });
    on = { tabId: t.id, stop: screencast(t.id, (frame) => post({ frame })).catch((e: unknown) => (post({ error: e instanceof Error ? e.message : String(e) }), null)) };
  };
  const timer = setInterval(() => void tick(), 1000);
  port.onDisconnect.addListener(end);
  void tick();
}

/** A download a run's tab started (its referrer is a page one had open, and no tab of the person's): kept with the run. */
async function keepDownload(d: chrome.downloads.DownloadItem): Promise<void> {
  const groups = new Set([...live.values()].flatMap((e) => (e.tab.group === undefined ? [] : [e.tab.group])));
  const person = (await chrome.tabs.query({})).filter((t) => !groups.has(t.groupId)).map((t) => t.url ?? '');
  const runId = downloadRun(d.referrer, [...live].map(([id, e]) => ({ runId: id, urls: e.urls })), person);
  if (!runId) return;
  const url = d.finalUrl || d.url;
  let name = d.filename.split(/[\\/]/).pop() ?? '';
  try {
    name ||= decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  } catch {}
  name = (name || 'download').slice(0, 200);
  const add = (r: GardenRun) => {
    if (r.files?.some((f) => f.id === d.id)) return;
    r.files = [...(r.files ?? []), { id: d.id, name, url: url.slice(0, 2000), at: Date.now() }];
    r.created = [...(r.created ?? []), { kind: 'file', title: name, ref: String(d.id) }];
  };
  // A working run is saved from memory after each action: the file goes there too.
  const e = live.get(runId);
  if (e) add(e.run);
  await updateRun(runId, add);
}
const onDownload = (d: chrome.downloads.DownloadItem) => void keepDownload(d).catch((e) => console.warn('garden download failed', e));
/** `downloads` is optional: listened to once the person allows it ("Keep downloads with runs"). */
const listenDownloads = () => {
  if (chrome.downloads && !chrome.downloads.onCreated.hasListener(onDownload)) chrome.downloads.onCreated.addListener(onDownload);
};

export function initTabs(): void {
  chrome.tabs.onUpdated.addListener((tabId, info, t) => {
    if (info.status === 'loading') void lock(tabId, t);
    // The pages a run's own tabs open, for matching downloads (a borrowed tab is the person's).
    if (info.url) for (const e of live.values()) if (e.tab.group !== undefined && t.groupId === e.tab.group) e.urls.add(info.url);
  });
  chrome.runtime.onConnect.addListener((port) => void (port.name.startsWith('garden-watch:') && watch(port, port.name.slice('garden-watch:'.length))));
  listenDownloads();
  chrome.permissions.onAdded.addListener(listenDownloads);
}

export const tabHandlers = {
  /**
   * Take over: from the lock bar in a tab the run works in now, or from an extension page naming that tab (or none:
   * the run's newest web tab, for the Garden tab's own Take over, which a page can't hide). The tab is halted, the
   * call aborted, the tab leaves the run (out of its group, kept from every cleanup) and comes to the front, and the
   * run waits for the person to hand back.
   */
  runTakeover: async ({ id, tabId }: { id: string; tabId?: number }, sender?: chrome.runtime.MessageSender) => {
    const ext = isExtensionPage(sender);
    let target = ext ? tabId : sender?.tab?.id;
    const e = live.get(id);
    if (ext && target === undefined) target = (await workTab(id))?.id;
    const t = typeof target === 'number' ? await chrome.tabs.get(target).catch(() => undefined) : undefined;
    if (!t || !e || !owned(id, t)) throw new Error('That tab isn’t one this gardener is working in.');
    const { tab, name } = e;
    const tid = t.id!;
    // Halted first, so a step already running there can't click; kept before the abort (also in liveGroups, for a
    // restart), so neither the call's cleanup nor start-up closes it.
    await release(tid);
    (tab.kept ??= new Set()).add(tid);
    await markKept(id, tid);
    tab.stop.abort();
    // Out of the run's group; a borrowed tab stays in the person's own.
    for (let k = 0; k < 3 && e.tab.group !== undefined && (await chrome.tabs.get(tid).catch(() => null))?.groupId === e.tab.group; k++) await chrome.tabs.ungroup(tid).catch(() => {});
    if (tab.windowId !== undefined && t.windowId === tab.windowId) await chrome.windows.create({ tabId: tid, focused: true });
    else {
      await chrome.tabs.update(tid, { active: true });
      await chrome.windows.update(t.windowId, { focused: true });
    }
    await updateRun(id, (r) => {
      if (r.status !== 'running' && r.status !== 'waiting') return;
      r.requests.push({ id: crypto.randomUUID().slice(0, 8), kind: 'takeover', ...(r.steps.length && { step: r.steps.at(-1)!.i }), tabId: tid,
        text: `You took over from ${name}. Hand back when you’re done.`, sensitive: false, expiresAt: Date.now() + DAY });
      r.status = 'waiting';
    });
    return true;
  },
  ...pagesOnly({
    /** The tab a run works in now (its newest web tab), for "Show the tab". */
    runTab: async ({ id }: { id: string }) => {
      await ready();
      const t = await workTab(String(id));
      return t ? { tabId: t.id, windowId: t.windowId } : null;
    },
  }),
};
