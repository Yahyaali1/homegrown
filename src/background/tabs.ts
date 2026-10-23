// Tabs: read, compare and summarize open tabs; tidy them into named groups with a "where was I" note.
import { ask } from './engine.ts';
import { jsonArray } from '../domain/html.ts';

const BUDGET = 9000; // ponytail: chars of page text shared across all tabs, so the prompt fits a 4k-token context
type Sender = chrome.runtime.MessageSender | undefined;

async function tabText(tabId: number, cap: number): Promise<string> {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [cap],
    func: (n: number) => ((document.querySelector('article, main, [role=main]') as HTMLElement | null) ?? document.body).innerText.replace(/\n{3,}/g, '\n\n').trim().slice(0, n),
  });
  return r?.result ?? '';
}

const windowOf = (sender: Sender) => sender?.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;

export const handlers = {
  listTabs: async (_m: unknown, sender: Sender) =>
    (await chrome.tabs.query({ windowId: windowOf(sender) })).map((t) => ({ id: t.id, title: t.title, url: t.url, active: t.active })),

  /** mode 'compare': one markdown table; 'summary': bullets per tab. */
  compareTabs: async ({ ids, mode }: { ids: number[]; mode: 'compare' | 'summary' }) => {
    const tabs = await Promise.all(ids.map((id) => chrome.tabs.get(id)));
    const per = Math.floor(BUDGET / ids.length);
    const texts = await Promise.all(ids.map((id) => tabText(id, per).catch(() => '(could not read this tab)')));
    const pages = tabs.map((t, i) => `## Page ${i + 1}: ${t.title}\nURL: ${t.url}\n${texts[i]}`).join('\n\n');
    return ask(mode === 'compare'
      ? 'Compare these web pages. Reply with one markdown table: a row per page (use its title), and columns for the attributes that matter most when choosing between them. After the table, one sentence on which suits what.'
      : 'Summarize each of these web pages in 2 or 3 bullet points, under a bold line with its title.', pages);
  },

  /** Groups the window's loose tabs by topic; returns the groups and duplicate tabs. */
  tidyTabs: async (_m: unknown, sender: Sender) => {
    const windowId = windowOf(sender);
    const all = await chrome.tabs.query({ windowId });
    const loose = all.filter((t) => t.groupId === -1 && !t.pinned);
    const list = loose.map((t, i) => `${i + 1}. ${t.title} (${t.url ? new URL(t.url).hostname : ''})`).join('\n');
    const reply = await ask('Group these browser tabs by topic. Reply with only a JSON array like [{"name":"Short group name","tabs":[1,4],"note":"One line: what I was doing in these tabs"}]. Use every tab number at most once; leave out tabs that fit no group.', list);
    const groups: { name: string; note: string; count: number }[] = [];
    for (const raw of jsonArray(reply)) {
      const g = (raw ?? {}) as { name?: unknown; tabs?: unknown; note?: unknown };
      const tabIds = (Array.isArray(g.tabs) ? g.tabs : []).map((n) => loose.at(Number(n) - 1)?.id).filter((id): id is number => id !== undefined);
      if (tabIds.length < 2 || typeof g.name !== 'string' || !g.name) continue;
      const groupId = await chrome.tabs.group({ tabIds: tabIds as [number, ...number[]], createProperties: { windowId } });
      await chrome.tabGroups.update(groupId, { title: g.name, collapsed: false });
      groups.push({ name: g.name, note: typeof g.note === 'string' ? g.note : '', count: tabIds.length });
    }
    const { tabNotes } = await chrome.storage.local.get('tabNotes');
    const notes = (tabNotes && typeof tabNotes === 'object' ? tabNotes : {}) as Record<string, { note: string; at: number }>;
    for (const g of groups) notes[g.name] = { note: g.note, at: Date.now() };
    await chrome.storage.local.set({ tabNotes: notes });
    const seen = new Set<string>();
    const duplicates = all.filter((t) => {
      const key = (t.url ?? '').split('#')[0]!;
      return seen.has(key) || !seen.add(key);
    });
    return { groups, duplicates: duplicates.map((t) => ({ id: t.id, title: t.title })) };
  },

  closeTabs: ({ ids }: { ids: number[] }) => chrome.tabs.remove(ids),
};
