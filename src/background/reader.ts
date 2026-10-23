// Opens PDFs (and other documents) in the extension's reader, where the toolbar and page tasks work. Chrome's PDF
// viewer blocks extension UI, so this menu is the way in.
const readerUrl = (url: string) => chrome.runtime.getURL(`reader.html?url=${encodeURIComponent(url)}`);
const PDF = ['*://*/*.pdf', '*://*/*.pdf?*', '*://*/*.pdf#*'];

export const handlers = {
  /** replace: open the reader in the asking tab (a PDF tab), so the document stays where the user was. */
  openReader: async ({ url, replace }: { url: string; replace?: boolean }, sender?: chrome.runtime.MessageSender) => {
    if (replace && sender?.tab?.id !== undefined) await chrome.tabs.update(sender.tab.id, { url: readerUrl(url) });
    else await chrome.tabs.create({ url: readerUrl(url) });
    return true;
  },
};

/** Called after each menu rebuild. Duplicate ids are fine to ignore. */
export function menus(): void {
  chrome.contextMenus.create({ id: 'reader:link', title: 'Open PDF in Homegrown reader', contexts: ['link'], targetUrlPatterns: PDF }, () => chrome.runtime.lastError);
  chrome.contextMenus.create({ id: 'reader:page', title: 'Open in Homegrown reader', contexts: ['page'], documentUrlPatterns: PDF }, () => chrome.runtime.lastError);
}

export function init(): void {
  chrome.contextMenus.onClicked.addListener((info) => {
    const url = info.linkUrl || info.pageUrl;
    if (String(info.menuItemId).startsWith('reader:') && url) void chrome.tabs.create({ url: readerUrl(url) });
  });
}
