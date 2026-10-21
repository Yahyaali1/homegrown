// Memory in the page: save highlights (shown again on revisit), "You read about this before" and
// "Changed since your last visit" chips, and "Turn off on this site". Storage lives in bg/memory.js.
(() => {
  const EG = window.EG;
  if (!EG) return;

  const MARK_STYLE = 'background: rgba(255, 213, 0, 0.35); color: inherit; border-radius: 2px; padding: 0;';

  // Wraps every text node a range covers in a <mark>, so highlights can span links and bold text.
  function markRange(range) {
    const rootNode = range.commonAncestorContainer;
    const nodes = [];
    if (rootNode.nodeType === 3) nodes.push(rootNode);
    else {
      const w = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) if (range.intersectsNode(w.currentNode) && w.currentNode.data.trim()) nodes.push(w.currentNode);
    }
    for (let node of nodes) {
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.data.length;
      if (end <= start) continue;
      if (end < node.data.length) node.splitText(end);
      if (start > 0) node = node.splitText(start);
      const mark = Object.assign(document.createElement('mark'), { className: 'eg-highlight' });
      mark.style.cssText = MARK_STYLE;
      node.replaceWith(mark);
      mark.append(node);
    }
  }

  // Re-finds a saved highlight. window.find matches across elements the way the user selected it.
  // ponytail: window.find is Chrome-only and moves the selection; we restore scroll and clear it.
  function findAndMark(text) {
    const [x, y] = [scrollX, scrollY];
    getSelection().removeAllRanges();
    const found = window.find(text, true, false, false, false, false, false);
    if (found && getSelection().rangeCount) markRange(getSelection().getRangeAt(0));
    getSelection().removeAllRanges();
    scrollTo(x, y);
  }

  EG.actions.text.push({
    label: 'Highlight',
    when: (sel) => sel && !sel.field,
    run: ({ selection, ctx }) => {
      if (ctx?.range) markRange(ctx.range);
      getSelection().removeAllRanges();
      EG.bg('memHighlightSave', { text: selection, url: location.href, title: document.title, wantNote: true }).catch(() => {});
    },
  });

  EG.actions.page.push({
    label: 'Turn off on this site',
    run: async () => {
      const { disabledSites = [] } = await chrome.storage.sync.get('disabledSites');
      await chrome.storage.sync.set({ disabledSites: [...new Set([...disabledSites, location.hostname])] });
      EG.hideAll(); // core re-reads settings and hides the toolbar and ✦ here
    },
  });

  if (!location.href.startsWith('http')) return;

  // Saved highlights come back on revisit.
  setTimeout(async () => {
    const items = await EG.bg('memHighlights', { url: location.href }).catch(() => []);
    for (const h of items) findAndMark(h.text);
  }, 1500);

  // "You read about this before": top frame, article-sized pages, once the page has settled.
  if (window !== window.top) return;
  setTimeout(() => requestIdleCallback(checkSeen), 3000);
  setTimeout(() => requestIdleCallback(checkChanged), 3000);

  // "Changed since your last visit": bg diffs against the snapshot taken when you last ran a task here.
  // No model call until the chip is clicked.
  async function checkChanged() {
    if (!EG.enabled()) return;
    const { title, url, text } = EG.pageInfo();
    const diff = await EG.bg('memChanged', { url, text }).catch(() => null);
    if (!diff) return;
    const keep = () => EG.bg('memSnapshot', { url, text }).catch(() => {});
    const chip = Object.assign(document.createElement('div'), { className: 'changed', role: 'status' });
    const open = Object.assign(document.createElement('button'), { className: 'link', textContent: '✦ Changed since your last visit' });
    open.onclick = () => {
      chip.remove();
      const lines = (sign, list) => list.slice(0, 80).map((l) => `${sign} ${l}`).join('\n');
      const task = { id: 'last-visit', kind: 'page', title: 'What changed', prompt: `Summarize what changed on this page since the reader's last visit (${new Date(diff.since).toLocaleDateString()}). Lines starting with + were added, - were removed. Be specific and brief.` };
      EG.run({ task, page: { title, url, text: `${lines('+', diff.added)}\n${lines('-', diff.removed)}` } }, 'What changed since your last visit', EG.topRect());
      keep();
    };
    chip.append(open, Object.assign(document.createElement('button'), { textContent: '✕', ariaLabel: 'Dismiss', onclick: () => (chip.remove(), keep()) }));
    EG.style(`.changed { position: fixed; right: 18px; bottom: 112px; display: flex; gap: 6px; align-items: center; padding: 6px 10px;
      border-radius: 10px; background: var(--bg); color: var(--fg); border: 1px solid var(--line); box-shadow: 0 4px 16px rgba(0,0,0,.18); }
      .changed .link { background: none; color: var(--accent); padding: 0; } .changed button { padding: 0 6px; }`);
    EG.mount();
    EG.root.append(chip);
  }
  async function checkSeen() {
    if (!EG.enabled()) return;
    const { text } = EG.pageInfo();
    if (text.length < 2000) return;
    const hit = await EG.bg('memSimilar', { text: text.slice(0, 1500), url: location.href }).catch(() => null);
    if (!hit) return;
    EG.style(`.seen { position: fixed; right: 18px; bottom: 70px; display: flex; gap: 6px; align-items: center; max-width: 340px;
      padding: 6px 10px; border-radius: 10px; background: var(--bg); color: var(--fg); border: 1px solid var(--line);
      box-shadow: 0 4px 16px rgba(0,0,0,.18); }
      .seen a { color: var(--accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .seen button { padding: 0 6px; }`);
    EG.mount();
    const chip = Object.assign(document.createElement('div'), { className: 'seen', role: 'status' });
    chip.append(
      document.createTextNode('✦ You read about this on '),
      Object.assign(document.createElement('a'), { href: hit.url, textContent: hit.title || hit.url, target: '_blank', title: hit.url }),
      Object.assign(document.createElement('button'), { textContent: '✕', ariaLabel: 'Dismiss', onclick: () => chip.remove() }),
    );
    EG.root.append(chip);
  }
})();
