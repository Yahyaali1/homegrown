// chrome.debugger for gardeners and recipes: one attach per tab, shared by whoever needs it (DevTools reads, the live
// view, a recipe's device emulation). `debugger` is an optional permission the person grants on a click; Chrome shows
// its "started debugging" bar while one is attached.
import { devtoolsDigest } from '../domain/garden/tools.ts';

type Target = chrome.debugger.Debuggee;
const attached = new Map<number, { n: number; ready: Promise<void> }>();
let listening = false;

/** The debugger on this tab (attached now, or joining an attach already made); the result lets go, the last one detaches. */
export async function attach(tabId: number): Promise<() => Promise<void>> {
  if (!listening) {
    listening = true;
    // The person closed the bar, or the tab went: the next user attaches again.
    chrome.debugger.onDetach.addListener((s) => void (s.tabId !== undefined && attached.delete(s.tabId)));
  }
  let a = attached.get(tabId);
  if (!a) {
    const ready = chrome.debugger.attach({ tabId }, '1.3');
    attached.set(tabId, (a = { n: 0, ready }));
    ready.catch(() => attached.get(tabId)?.ready === ready && attached.delete(tabId));
  }
  const mine = a;
  mine.n++;
  try {
    await mine.ready;
  } catch (e) {
    mine.n--;
    throw e;
  }
  let done = false;
  return async () => {
    if (done || --mine.n > 0) return void (done = true);
    done = true;
    if (attached.get(tabId) === mine) attached.delete(tabId);
    await chrome.debugger.detach({ tabId }).catch(() => {});
  };
}

const send = (tabId: number, method: string, params?: object) => chrome.debugger.sendCommand({ tabId } as Target, method, params);

type Remote = { value?: unknown; description?: string };

/**
 * Collects the tab's console errors (`Runtime`, `Log`) and its requests' statuses (`Network`, no bodies) until `stop`,
 * which detaches and gives the digest.
 */
export async function logFor(tabId: number): Promise<{ stop: () => Promise<string> }> {
  const detach = await attach(tabId);
  const errors: string[] = [];
  const reqs = new Map<string, { method: string; url: string; status: number }>();
  const on = (s: Target, method: string, p?: object) => {
    if (s.tabId !== tabId || !p) return;
    const x = p as Record<string, any>;
    if (method === 'Runtime.exceptionThrown') errors.push(String(x.exceptionDetails?.exception?.description ?? x.exceptionDetails?.text ?? 'An exception'));
    else if (method === 'Runtime.consoleAPICalled' && x.type === 'error') errors.push((x.args as Remote[] ?? []).map((a) => String(a.value ?? a.description ?? '')).join(' '));
    else if (method === 'Log.entryAdded' && x.entry?.level === 'error') errors.push(String(x.entry.text));
    else if (method === 'Network.requestWillBeSent') reqs.set(x.requestId, { method: x.request.method, url: x.request.url, status: 0 });
    else if (method === 'Network.responseReceived') {
      const r = reqs.get(x.requestId);
      if (r) r.status = x.response.status;
    }
  };
  chrome.debugger.onEvent.addListener(on);
  try {
    for (const m of ['Runtime.enable', 'Log.enable', 'Network.enable']) await send(tabId, m);
  } catch (e) {
    chrome.debugger.onEvent.removeListener(on);
    await detach();
    throw e;
  }
  return {
    stop: async () => {
      chrome.debugger.onEvent.removeListener(on);
      await detach();
      return devtoolsDigest(errors, [...reqs.values()]);
    },
  };
}

/** The tab as JPEG frames, 480 px wide, at most 2 a second (each frame is acknowledged 500 ms late), until the result is called. */
export async function screencast(tabId: number, frame: (dataUrl: string) => void): Promise<() => Promise<void>> {
  const detach = await attach(tabId);
  const on = (s: Target, method: string, p?: object) => {
    if (s.tabId !== tabId || method !== 'Page.screencastFrame' || !p) return;
    const x = p as { data: string; sessionId: number };
    frame(`data:image/jpeg;base64,${x.data}`);
    setTimeout(() => void send(tabId, 'Page.screencastFrameAck', { sessionId: x.sessionId }).catch(() => {}), 500);
  };
  chrome.debugger.onEvent.addListener(on);
  await send(tabId, 'Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 480 }).catch(async (e: unknown) => {
    chrome.debugger.onEvent.removeListener(on);
    await detach();
    throw e;
  });
  return async () => {
    chrome.debugger.onEvent.removeListener(on);
    await send(tabId, 'Page.stopScreencast').catch(() => {});
    await detach();
  };
}
