// Opens PDFs (and other documents) in the extension's reader, where the toolbar and page tasks work.
// Chrome's PDF viewer blocks extension UI, so this menu is the way in.
const open = (url) => chrome.tabs.create({ url: chrome.runtime.getURL(`reader.html?url=${encodeURIComponent(url)}`) });

export const handlers = {
  openReader: async ({ url }) => (await open(url), true),
};

const ITEMS = [
  { id: 'reader:link', title: 'Open PDF in Edge Gallery reader', contexts: ['link'], targetUrlPatterns: ['*://*/*.pdf', '*://*/*.pdf?*', '*://*/*.pdf#*'] },
  { id: 'reader:page', title: 'Open in Edge Gallery reader', contexts: ['page'], documentUrlPatterns: ['*://*/*.pdf', '*://*/*.pdf?*', '*://*/*.pdf#*'] },
];
const addItems = () => ITEMS.forEach((i) => chrome.contextMenus.create(i, () => chrome.runtime.lastError)); // duplicates are fine to ignore

// background.js calls this after each menu rebuild.
export const menus = addItems;

export function init() {
  chrome.contextMenus.onClicked.addListener((info) => {
    if (String(info.menuItemId).startsWith('reader:')) open(info.linkUrl || info.pageUrl);
  });
}
