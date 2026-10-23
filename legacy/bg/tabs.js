// Tabs: read, compare and summarize open tabs; tidy them into named groups with a "where was I" note.
import { ask } from './engine.js';

const BUDGET = 9000; // ponytail: chars of page text shared across all tabs, so the prompt fits the 4k-token context

async function tabText(tabId, cap) {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (n) => (document.querySelector('article, main, [role=main]') || document.body).innerText.replace(/\n{3,}/g, '\n\n').trim().slice(0, n),
    args: [cap],
  });
  return r?.result || '';
}

// First JSON array in a model reply (it may wrap it in prose or a code fence).
const jsonArray = (s) => JSON.parse(/\[[\s\S]*\]/.exec(s)?.[0] ?? '[]');

export const handlers = {
  listTabs: async (_m, sender) =>
    (await chrome.tabs.query({ windowId: sender.tab.windowId })).map((t) => ({ id: t.id, title: t.title, url: t.url, active: t.active })),

  // mode: 'compare' → one markdown table; 'summary' → bullets per tab.
  compareTabs: async ({ ids, mode }) => {
    const tabs = await Promise.all(ids.map((id) => chrome.tabs.get(id)));
    const per = Math.floor(BUDGET / ids.length);
    const texts = await Promise.all(ids.map((id) => tabText(id, per).catch(() => '(could not read this tab)')));
    const pages = tabs.map((t, i) => `## Page ${i + 1}: ${t.title}\nURL: ${t.url}\n${texts[i]}`).join('\n\n');
    const prompt =
      mode === 'compare'
        ? 'Compare these web pages. Reply with one markdown table: a row per page (use its title), and columns for the attributes that matter most when choosing between them. After the table, one sentence on which suits what.'
        : 'Summarize each of these web pages in 2 or 3 bullet points, under a bold line with its title.';
    return ask(prompt, pages);
  },

  // Groups the window's loose tabs by topic and returns the groups and duplicate tabs.
  tidyTabs: async (_m, sender) => {
    const windowId = sender.tab.windowId;
    const all = await chrome.tabs.query({ windowId });
    const loose = all.filter((t) => t.groupId === -1 && !t.pinned);
    const list = loose.map((t, i) => `${i + 1}. ${t.title} (${new URL(t.url).hostname})`).join('\n');
    const reply = await ask(
      'Group these browser tabs by topic. Reply with only a JSON array like ' +
        '[{"name":"Short group name","tabs":[1,4],"note":"One line: what I was doing in these tabs"}]. ' +
        'Use every tab number at most once; leave out tabs that fit no group.',
      list,
    );
    const groups = [];
    for (const g of jsonArray(reply)) {
      const tabIds = (g.tabs || []).map((n) => loose.at(n - 1)?.id).filter(Boolean);
      if (tabIds.length < 2 || !g.name) continue;
      const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
      await chrome.tabGroups.update(groupId, { title: g.name, collapsed: false });
      groups.push({ name: g.name, note: g.note || '', count: tabIds.length });
    }
    const { tabNotes = {} } = await chrome.storage.local.get('tabNotes');
    for (const g of groups) tabNotes[g.name] = { note: g.note, at: Date.now() };
    await chrome.storage.local.set({ tabNotes });

    const seen = new Set();
    const duplicates = all.filter((t) => {
      const key = t.url.split('#')[0];
      return seen.has(key) || !seen.add(key);
    });
    return { groups, duplicates: duplicates.map((t) => ({ id: t.id, title: t.title })) };
  },

  closeTabs: ({ ids }) => chrome.tabs.remove(ids),
};
