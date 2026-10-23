// Memory in the page: saved highlights (shown again on revisit), "You read about this before" and "Changed since your
// last visit" chips, and "Turn off on this site". Storage lives in the worker (background/memory.ts).
import { ui } from '../core.ts';
import { h } from '../../ui/dom.ts';
import { parseSettings } from '../../domain/settings.ts';

const MARK_STYLE = 'background: rgba(255, 213, 0, 0.35); color: inherit; border-radius: 2px; padding: 0;';

/** Wraps every text node a range covers in a <mark>, so a highlight can span links and bold text. */
function markRange(range: Range): void {
  const rootNode = range.commonAncestorContainer;
  const nodes: Text[] = [];
  if (rootNode instanceof Text) nodes.push(rootNode);
  else {
    const w = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) if (range.intersectsNode(w.currentNode) && (w.currentNode as Text).data.trim()) nodes.push(w.currentNode as Text);
  }
  for (let node of nodes) {
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.data.length;
    if (end <= start) continue;
    if (end < node.data.length) node.splitText(end);
    if (start > 0) node = node.splitText(start);
    const mark = h('mark', { className: 'eg-highlight', style: MARK_STYLE });
    node.replaceWith(mark);
    mark.append(node);
  }
}

// window.find matches across elements the way the user selected. ponytail: Chrome-only and it moves the selection, so
// scroll and selection are restored.
declare global { interface Window { find(text: string, ...flags: boolean[]): boolean } }
function findAndMark(text: string): void {
  const [x, y] = [scrollX, scrollY];
  getSelection()?.removeAllRanges();
  const found = window.find(text, true, false, false, false, false, false);
  const sel = getSelection();
  if (found && sel?.rangeCount) markRange(sel.getRangeAt(0));
  sel?.removeAllRanges();
  scrollTo(x, y);
}

const chipStyle = (cls: string) => `.${cls} { position: fixed; right: 18px; display: flex; gap: 6px; align-items: center; max-width: 340px; padding: 6px 10px;
  border-radius: 10px; background: var(--bg); color: var(--fg); border: 1px solid var(--line); box-shadow: var(--shadow-menu); }
  .${cls} a, .${cls} .link { color: var(--accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: none; padding: 0; } .${cls} button { padding: 0 6px; }`;

/** "Changed since your last visit": the worker diffs against the snapshot from the last task here. No model call until clicked. */
async function checkChanged(): Promise<void> {
  if (!ui.enabled()) return;
  const { title, url, text } = ui.pageInfo();
  const diff = await ui.bg<{ added: string[]; removed: string[]; since: number } | null>('memChanged', { url, text }).catch(() => null);
  if (!diff) return;
  const keep = () => ui.bg('memSnapshot', { url, text }).catch(() => {});
  const chip = h('div', { className: 'changed', style: 'bottom: 112px', attrs: { role: 'status' } });
  const lines = (sign: string, list: string[]) => list.slice(0, 80).map((l) => `${sign} ${l}`).join('\n');
  chip.append(
    h('button', { className: 'link', textContent: '❀ Changed since your last visit', onclick: () => {
      chip.remove();
      const task = { id: 'last-visit', kind: 'page' as const, title: 'What changed', prompt: `Summarize what changed on this page since the reader's last visit (${new Date(diff.since).toLocaleDateString()}). Lines starting with + were added, - were removed. Be specific and brief.` };
      ui.run({ task, page: { title, url, text: `${lines('+', diff.added)}\n${lines('-', diff.removed)}` } }, 'What changed since your last visit', ui.topRect());
      void keep();
    } }),
    h('button', { textContent: '✕', attrs: { 'aria-label': 'Dismiss' }, onclick: () => (chip.remove(), void keep()) }),
  );
  ui.style(chipStyle('changed'));
  ui.mount();
  ui.root.append(chip);
}

/** "You read about this before": top frame, article-sized pages, once the page has settled. */
async function checkSeen(): Promise<void> {
  if (!ui.enabled()) return;
  const { text } = ui.pageInfo();
  if (text.length < 2000) return;
  const hit = await ui.bg<{ url: string; title: string } | null>('memSimilar', { text: text.slice(0, 1500), url: location.href }).catch(() => null);
  if (!hit) return;
  ui.style(chipStyle('seen'));
  ui.mount();
  const chip = h('div', { className: 'seen', style: 'bottom: 70px', attrs: { role: 'status' } }, '❀ You read about this on ',
    h('a', { href: /^https?:/.test(hit.url) ? hit.url : '#', textContent: hit.title || hit.url, target: '_blank', title: hit.url }));
  chip.append(h('button', { textContent: '✕', attrs: { 'aria-label': 'Dismiss' }, onclick: () => chip.remove() }));
  ui.root.append(chip);
}

export function install(): void {
  ui.actions.text.push({
    label: 'Highlight',
    when: (sel) => !!sel && !(sel.target && 'field' in sel.target),
    run: ({ selection, ctx }) => {
      if (ctx.range) markRange(ctx.range);
      getSelection()?.removeAllRanges();
      ui.bg('memHighlightSave', { text: selection, url: location.href, title: document.title, wantNote: true }).catch(() => {});
    },
  });
  ui.actions.page.push({
    label: 'Turn off on this site',
    run: async () => {
      const { disabledSites } = parseSettings(await chrome.storage.sync.get('disabledSites'));
      await chrome.storage.sync.set({ disabledSites: [...new Set([...disabledSites, location.hostname])] });
      ui.hideAll(); // the core re-reads settings and hides the toolbar and ❀ here
    },
  });
  if (!location.href.startsWith('http')) return;
  // Saved highlights come back on revisit.
  setTimeout(async () => {
    for (const hl of await ui.bg<{ text: string }[]>('memHighlights', { url: location.href }).catch(() => [])) findAndMark(hl.text);
  }, 1500);
  if (window !== top) return;
  setTimeout(() => requestIdleCallback(() => void checkSeen()), 3000);
  setTimeout(() => requestIdleCallback(() => void checkChanged()), 3000);
}
