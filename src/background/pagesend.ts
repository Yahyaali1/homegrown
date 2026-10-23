// Messages to a tab's in-page UI (content/core.js), healing tabs that have none. One path for the side panel,
// keyboard shortcuts, right-click actions and mission nudges. Built to bg/pagesend.js.
const READER = () => chrome.runtime.getURL('reader.html');

export const CANT_RUN = "This page can't run Homegrown: browser pages, the PDF viewer and the Chrome Web Store block extensions.";

/** The manifest's content scripts, in order, into one tab. */
export async function injectInto(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined || !/^(https?|file):/.test(tab.url ?? '')) throw new Error(CANT_RUN);
  try {
    for (const cs of chrome.runtime.getManifest().content_scripts ?? []) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: !!cs.all_frames }, files: cs.js ?? [] });
    }
  } catch {
    throw new Error(CANT_RUN); // the PDF viewer, or a page the browser protects
  }
}

export async function toTab(tabId: number, msg: object, opts: chrome.tabs.MessageSendOptions = {}): Promise<unknown> {
  const tab = await chrome.tabs.get(tabId);
  // The reader is an extension page: tabs.sendMessage doesn't reach it, so it gets a runtime message for its tab.
  if (tab.url?.startsWith(READER())) return chrome.runtime.sendMessage({ ...msg, toTab: tabId });
  try {
    return await chrome.tabs.sendMessage(tabId, msg, opts);
  } catch {
    // Nobody answered: usually a tab opened before the extension was (re)loaded. Give it the page scripts, retry once.
    await injectInto(tab);
    return chrome.tabs.sendMessage(tabId, msg, opts);
  }
}
