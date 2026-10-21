// Launcher actions for tabs and monitors: Compare tabs…, Tidy tabs, Watch this page.
(() => {
  const EG = window.EG;
  if (!EG || window !== top) return;
  const el = (tag, props = {}, ...kids) => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
  };
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  EG.style(`
    .tabpick { display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow: auto; margin-bottom: 8px; }
    .tabpick label { display: flex; gap: 6px; align-items: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tabpick input { min-width: 0; flex: none; }
    .body table { border-collapse: collapse; width: 100%; margin: 0 0 6px; font-size: 12px; }
    .body th, .body td { border: 1px solid var(--line); padding: 3px 5px; text-align: left; vertical-align: top; }
    .body th { background: var(--chip); }
    .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin: 6px 0; }
    select { border: 1px solid var(--line); border-radius: 7px; padding: 3px 6px; background: var(--bg); color: var(--fg); }
    .group { margin: 0 0 8px; } .group b { display: block; }`);

  // EG.markdown plus pipe tables, which it doesn't render.
  function render(text) {
    const out = [];
    let table = [];
    const flush = () => {
      if (!table.length) return;
      const rows = table.filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => esc(c.trim()).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')));
      out.push(`<table><tr>${rows[0].map((c) => `<th>${c}</th>`).join('')}</tr>${rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`);
      table = [];
    };
    let prose = [];
    for (const line of text.split('\n')) {
      if (line.trim().startsWith('|')) {
        if (prose.length) out.push(EG.markdown(prose.join('\n'))), (prose = []);
        table.push(line);
      } else {
        flush();
        prose.push(line);
      }
    }
    flush();
    if (prose.length) out.push(EG.markdown(prose.join('\n')));
    return out.join('');
  }

  const fail = (c, e) => c.body.append(el('p', { className: 'err', textContent: e.message }));

  async function compareTabs({ rect }) {
    const c = EG.openCard('Compare tabs', rect);
    const tabs = await EG.bg('listTabs');
    const pick = el('div', { className: 'tabpick' },
      ...tabs.filter((t) => /^https?:/.test(t.url)).map((t) => {
        const box = el('input', { type: 'checkbox', checked: t.active, value: t.id });
        return el('label', { title: t.url }, box, document.createTextNode(t.title || t.url));
      }));
    const mode = el('select', {}, new Option('Compare in a table', 'compare'), new Option('Summarize each', 'summary'));
    const go = el('button', { className: 'primary', textContent: 'Run' });
    c.body.append(el('p', { textContent: 'Pick the tabs to read:' }), pick, el('div', { className: 'row' }, mode, go));
    go.onclick = async () => {
      const ids = [...pick.querySelectorAll('input:checked')].map((i) => +i.value);
      if (ids.length < 1) return;
      c.body.replaceChildren(el('p', { className: 'cursor', textContent: `Reading ${ids.length} tab${ids.length > 1 ? 's' : ''}…` }));
      try {
        const text = await EG.bg('compareTabs', { ids, mode: mode.value });
        c.body.innerHTML = render(text);
        c.actions.replaceChildren(el('button', { textContent: 'Copy', onclick: () => navigator.clipboard.writeText(text) }));
        c.meta.textContent = 'On this device';
      } catch (e) {
        c.body.replaceChildren();
        fail(c, e);
      }
    };
  }

  async function tidyTabs({ rect }) {
    const c = EG.openCard('Tidy tabs', rect);
    c.body.append(el('p', { className: 'cursor', textContent: 'Grouping your tabs by topic…' }));
    try {
      const { groups, duplicates } = await EG.bg('tidyTabs');
      c.body.replaceChildren(
        groups.length ? el('p', { textContent: `Made ${groups.length} group${groups.length > 1 ? 's' : ''}:` }) : el('p', { textContent: 'No tabs to group.' }),
        ...groups.map((g) => el('div', { className: 'group' }, el('b', { textContent: `${g.name} (${g.count})` }), el('span', { textContent: g.note }))),
      );
      if (duplicates.length) {
        c.body.append(el('p', { textContent: `${duplicates.length} duplicate tab${duplicates.length > 1 ? 's' : ''}: ${duplicates.map((d) => d.title).join(', ')}` }));
        c.actions.append(el('button', { textContent: 'Close duplicates', onclick: async (e) => {
          await EG.bg('closeTabs', { ids: duplicates.map((d) => d.id) });
          e.target.replaceWith(el('span', { textContent: 'Closed.' }));
        } }));
      }
      c.meta.textContent = 'Group notes are saved for later. On this device';
    } catch (e) {
      c.body.replaceChildren();
      fail(c, e);
    }
  }

  function watchPage({ rect, page }) {
    const c = EG.openCard('Watch this page', rect);
    const pickInterval = (interval) => async () => {
      c.body.replaceChildren(el('p', { className: 'cursor', textContent: 'Saving a snapshot of the page…' }));
      try {
        await EG.bg('watchPage', { url: location.href, title: page.title || location.hostname, interval });
        c.body.replaceChildren(el('p', { textContent: `Watching ${interval}. When it changes you'll get a notification with a one-line summary of what changed. Manage watched pages in Edge Gallery → Tasks.` }));
      } catch (e) {
        c.body.replaceChildren();
        fail(c, e);
      }
    };
    c.body.append(
      el('p', { textContent: 'Get a notification when this page changes, with a summary of what changed. Checks run on this device.' }),
      el('div', { className: 'row' }, el('button', { textContent: 'Check every hour', onclick: pickInterval('hourly') }), el('button', { textContent: 'Check every day', onclick: pickInterval('daily') })),
    );
  }

  EG.actions.page.push(
    { label: 'Compare tabs…', run: compareTabs },
    { label: 'Tidy tabs', run: tidyTabs },
    { label: 'Watch this page', run: watchPage },
  );
})();
