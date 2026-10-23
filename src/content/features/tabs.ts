// Launcher actions for tabs and monitors: Compare tabs…, Tidy tabs, Watch this page.
import { ui, type Card, type Rect } from '../core.ts';
import { h } from '../../ui/dom.ts';
import { markdownWithTables } from '../../domain/markdown.ts';
import type { PageInfo } from '../../shared/protocol.ts';

const fail = (c: Card, e: unknown) => c.body.append(h('p', { className: 'err', textContent: (e as Error).message }));

async function compareTabs({ rect }: { rect: Rect }): Promise<void> {
  const c = ui.openCard('Compare tabs', rect);
  const tabs = await ui.bg<{ id: number; title?: string; url?: string; active: boolean }[]>('listTabs');
  const pick = h('div', { className: 'tabpick' },
    ...tabs.filter((t) => /^https?:/.test(t.url ?? '')).map((t) =>
      h('label', { title: t.url ?? '' }, h('input', { type: 'checkbox', checked: t.active, value: String(t.id) }), t.title || t.url || '')));
  const mode = h('select', {}, new Option('Compare in a table', 'compare'), new Option('Summarize each', 'summary'));
  const go = h('button', { className: 'primary', textContent: 'Run' });
  c.body.append(h('p', { textContent: 'Pick the tabs to read:' }), pick, h('div', { className: 'row' }, mode, go));
  go.onclick = async () => {
    const ids = [...pick.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => Number(i.value));
    if (!ids.length) return;
    c.body.replaceChildren(h('p', { className: 'cursor', textContent: `Reading ${ids.length} tab${ids.length > 1 ? 's' : ''}…` }));
    try {
      const text = await ui.bg<string>('compareTabs', { ids, mode: mode.value });
      c.body.innerHTML = markdownWithTables(text); // escaped first
      c.actions.replaceChildren(h('button', { textContent: 'Copy', onclick: () => void navigator.clipboard.writeText(text) }));
      c.meta.textContent = 'On this device';
    } catch (e) {
      c.body.replaceChildren();
      fail(c, e);
    }
  };
}

async function tidyTabs({ rect }: { rect: Rect }): Promise<void> {
  const c = ui.openCard('Tidy tabs', rect);
  c.body.append(h('p', { className: 'cursor', textContent: 'Grouping your tabs by topic…' }));
  try {
    const { groups, duplicates } = await ui.bg<{ groups: { name: string; note: string; count: number }[]; duplicates: { id: number; title: string }[] }>('tidyTabs');
    c.body.replaceChildren(
      h('p', { textContent: groups.length ? `Made ${groups.length} group${groups.length > 1 ? 's' : ''}:` : 'No tabs to group.' }),
      ...groups.map((g) => h('div', { className: 'group' }, h('b', { textContent: `${g.name} (${g.count})` }), h('span', { textContent: g.note }))),
    );
    if (duplicates.length) {
      c.body.append(h('p', { textContent: `${duplicates.length} duplicate tab${duplicates.length > 1 ? 's' : ''}: ${duplicates.map((d) => d.title).join(', ')}` }));
      const close = h('button', { textContent: 'Close duplicates', onclick: async () => {
        await ui.bg('closeTabs', { ids: duplicates.map((d) => d.id) });
        close.replaceWith(h('span', { textContent: 'Closed.' }));
      } });
      c.actions.append(close);
    }
    c.meta.textContent = 'Group notes are saved for later. On this device';
  } catch (e) {
    c.body.replaceChildren();
    fail(c, e);
  }
}

function watchPage({ rect, page }: { rect: Rect; page: PageInfo }): void {
  const c = ui.openCard('Watch this page', rect);
  const every = (interval: 'hourly' | 'daily') => async () => {
    c.body.replaceChildren(h('p', { className: 'cursor', textContent: 'Saving a snapshot of the page…' }));
    try {
      await ui.bg('watchPage', { url: location.href, title: page.title || location.hostname, interval });
      c.body.replaceChildren(h('p', { textContent: `Watching ${interval}. When it changes you'll get a notification with a one-line summary of what changed. Manage watched pages in Homegrown → Tasks.` }));
    } catch (e) {
      c.body.replaceChildren();
      fail(c, e);
    }
  };
  c.body.append(
    h('p', { textContent: 'Get a notification when this page changes, with a summary of what changed. Checks run on this device.' }),
    h('div', { className: 'row' }, h('button', { textContent: 'Check every hour', onclick: every('hourly') }), h('button', { textContent: 'Check every day', onclick: every('daily') })),
  );
}

export function install(): void {
  if (window !== top) return;
  ui.style(`
    .tabpick { display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow: auto; margin-bottom: 8px; }
    .tabpick label { display: flex; gap: 6px; align-items: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tabpick input { min-width: 0; flex: none; }
    .body table { border-collapse: collapse; width: 100%; margin: 0 0 6px; font-size: 12px; }
    .body th, .body td { border: 1px solid var(--line); padding: 3px 5px; text-align: left; vertical-align: top; }
    .body th { background: var(--chip); }
    .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin: 6px 0; }
    select { border: 1px solid var(--line); border-radius: 7px; padding: 3px 6px; background: var(--bg); color: var(--fg); }
    .group { margin: 0 0 8px; } .group b { display: block; }`);
  ui.actions.page.push(
    { label: 'Compare tabs…', run: compareTabs },
    { label: 'Tidy tabs', run: tidyTabs },
    { label: 'Watch this page', run: watchPage },
  );
}
