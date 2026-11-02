// Chat's side of the worker: links in answers, and "Open in chat" on a page or a link, queued for the side panel.
import { pagesOnly } from './pagerequest.ts';
import { tabText } from './tabs.ts';
import * as web from './web.ts';
import { sameSite } from '../domain/links.ts';
import { parseSettings } from '../domain/settings.ts';

const CHAT_TEXT = 15000;

/** A link in an answer: the active tab follows it when it's on the same site (settings.linksInActiveTab), else a new tab opens beside it. */
async function openLink({ url }: { url: string }) {
  const u = new URL(String(url));
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only web links open.');
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  const [tab] = win?.id === undefined ? [] : await chrome.tabs.query({ active: true, windowId: win.id });
  const host = tab?.url && /^https?:/.test(tab.url) ? new URL(tab.url).hostname : '';
  if (tab?.id !== undefined && host && sameSite(host, u.hostname) && parseSettings(await chrome.storage.sync.get('linksInActiveTab')).linksInActiveTab) {
    await chrome.tabs.update(tab.id, { url: u.href });
  } else await chrome.tabs.create({ url: u.href, ...(tab && { windowId: tab.windowId, index: tab.index + 1 }) });
  return true;
}

export const handlers = pagesOnly({ openLink });

/** Open in chat: the page (read like `read_my_tab`, no debugger) or the link (fetched signed out) becomes the attachment. */
async function attachment(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) {
  const url = info.menuItemId === 'chat:link' ? info.linkUrl ?? '' : info.pageUrl ?? tab?.url ?? '';
  if (!/^https?:/.test(url)) throw new Error('Only web pages open in chat.');
  const read = info.menuItemId === 'chat:page' && tab?.id !== undefined
    ? { title: tab.title ?? '', text: await tabText(tab.id, CHAT_TEXT).catch(() => '') } : { title: '', text: '' };
  const page = read.text ? read : await web.handlers.fetchText({ url });
  return { kind: 'text', title: 'Open in chat', selection: `${page.title}\n${url}\n\n${page.text.slice(0, CHAT_TEXT)}` };
}

export function menus(): void {
  chrome.contextMenus.create({ id: 'chat:page', title: 'Open in chat', contexts: ['page'] }, () => chrome.runtime.lastError);
  chrome.contextMenus.create({ id: 'chat:link', title: 'Open in chat', contexts: ['link'] }, () => chrome.runtime.lastError);
}

export async function onMenu(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<void> {
  if (!String(info.menuItemId).startsWith('chat:')) return;
  if (tab?.windowId !== undefined) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {}); // before any await: it needs the click
  const pending = await attachment(info, tab).catch((e: Error) => ({ kind: 'text', title: 'Open in chat', error: e.message }));
  await chrome.storage.session.set({ pending: { ...pending, at: Date.now() } });
}
