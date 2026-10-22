// Command palette: Alt+K on any page, and the ❀ launcher (opened as a menu anchored above the button).
// One box that finds every task, feature action and saved mission; typed text can be asked about the page
// or start a mission. Empty, it lists everything in sections. With text selected, text actions come first.
(() => {
  const EG = window.EG;
  if (!EG || window !== top) return;

  EG.style(`
    .pal-back { position: fixed; inset: 0; background: light-dark(#00000033, #00000080); animation: hg-fade var(--d-overlay) ease-out both;
      display: flex; justify-content: center; align-items: flex-start; padding-top: 14vh; }
    .pal-back.anchored { background: none; animation: none; display: block; padding: 0; }
    .pal { width: min(560px, calc(100vw - 32px)); background: var(--panel); color: var(--fg); border-radius: var(--r-md); box-shadow: var(--shadow-float);
      animation: hg-pop var(--d-popover) var(--ease-out) both; overflow: hidden; display: flex; flex-direction: column; max-height: 70vh; }
    .anchored .pal { position: fixed; width: min(380px, calc(100vw - 32px)); max-height: min(560px, 75vh); transform-origin: 100% 100%; }
    .pal input { width: 100%; height: auto; border: 0; box-shadow: none; border-bottom: 1px solid var(--line); border-radius: 0; background: transparent;
      padding: 12px 14px; font-size: var(--t-base); min-width: 0; outline: none; }
    .pal input:focus { box-shadow: none; }
    .pal ul { list-style: none; margin: 0; padding: 4px; overflow: auto; flex: 1; scrollbar-width: thin; }
    .pal li { display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 10px; border-radius: var(--r-sm); cursor: pointer; }
    .pal li[aria-selected=true] { background: var(--chip-hover); }
    .pal li.h { height: auto; padding: 10px 10px 4px; font-size: var(--t-xs); font-weight: 500; color: var(--faint); cursor: default; }
    .pal li .k { margin-left: auto; font-size: var(--t-xs); color: var(--faint); white-space: nowrap; }
    .pal li .i { width: 16px; display: grid; place-items: center; color: var(--muted); filter: grayscale(1); } .pal li .i:has(.flower) { filter: none; color: var(--fg); --seed-ring: var(--panel); }
    .pal li span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pal li mark { background: none; color: var(--fg); font-weight: 600; text-decoration: underline; text-decoration-color: var(--line-strong); text-underline-offset: 2px; }
    .pal .ctx { padding: 6px 14px; font-size: var(--t-xs); color: var(--faint); border-top: 1px solid var(--line); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; order: 3; }
    .pal kbd { font: var(--t-xs) var(--mono); padding: 0 4px; border-radius: var(--r-xs); box-shadow: inset 0 0 0 1px var(--line-strong); color: var(--muted); }
  `);

  let open = null;

  async function items(sel) {
    const ctx = sel ? { ...sel } : null;
    const payload = sel ? { selection: sel.text } : { page: EG.pageInfo() };
    const list = [];
    const add = (icon, label, kind, run, group) => list.push({ icon, label, kind, run, group });
    const tasks = EG.settings.tasks || [];
    if (sel) {
      for (const t of tasks.filter((t) => t.kind === 'text')) add('flower', t.title, '', () => EG.run({ task: t, selection: sel.text }, t.title, sel.rect), 'Selection');
      for (const a of EG.actions.text.filter((a) => !a.when || a.when(ctx))) add('›', a.label, '', () => a.run({ selection: sel.text, ctx, rect: sel.rect }), 'Selection');
    }
    for (const t of tasks.filter((t) => t.kind === 'page')) add('flower', t.title, '', () => EG.run({ task: t, page: EG.pageInfo() }, t.title, EG.topRect()), 'This page');
    for (const a of EG.actions.page.filter((a) => !a.when || a.when())) add('›', a.label, '', () => a.run({ page: EG.pageInfo(), rect: EG.topRect() }), EG.groupOf(a.label) === 'More' && a.when ? 'This page' : EG.groupOf(a.label));
    try {
      for (const m of await EG.bg('missionsList')) add('◎', m.name, '', () => EG.bg('agentOpen', { goal: m.goal, run: true }), 'Saved missions');
    } catch {}
    return { list, payload };
  }

  // Subsequence match with a score that favours word starts; returns highlighted HTML or null.
  function match(label, q) {
    if (!q) return { score: 0, html: esc(label) };
    const L = label.toLowerCase();
    let i = 0;
    let score = 0;
    const hits = new Set();
    for (const ch of q.toLowerCase()) {
      const j = L.indexOf(ch, i);
      if (j < 0) return null;
      score += j === i ? 2 : 0;
      score += j === 0 || /\W/.test(L[j - 1]) ? 3 : 0;
      hits.add(j);
      i = j + 1;
    }
    return { score, html: [...label].map((c, k) => (hits.has(k) ? `<mark>${esc(c)}</mark>` : esc(c))).join('') };
  }
  const SECTIONS = ['Selection', 'This page', 'Read', 'Write', 'Translate', 'Images', 'Web', 'Tabs', 'Voice', 'More', 'Saved missions'];
  const order = (g) => (SECTIONS.indexOf(g) + 1 || 99);
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // opts.anchor: a DOMRect to open above (the ❀ button) as a menu, without dimming the page.
  async function show(opts = {}) {
    if (open) return close();
    const anchor = opts?.anchor;
    EG.mount();
    const sel = EG.currentSelection();
    const { list } = await items(sel);
    const back = Object.assign(document.createElement('div'), { className: anchor ? 'pal-back anchored' : 'pal-back' });
    back.innerHTML = '<div class="pal" role="dialog" aria-label="Homegrown command palette"><input aria-label="Search actions or type a question" placeholder="Ask about this page, or search actions…"><div class="ctx"></div><ul role="listbox"></ul></div>';
    const input = back.querySelector('input');
    const ul = back.querySelector('ul');
    back.querySelector('.ctx').innerHTML = `${esc(sel ? `Selection: “${sel.text.slice(0, 60)}${sel.text.length > 60 ? '…' : ''}”` : document.title)} · <kbd>↑↓</kbd> <kbd>↵</kbd> · <kbd>Alt K</kbd> anywhere`;
    if (anchor) Object.assign(back.querySelector('.pal').style, { right: `${Math.max(innerWidth - anchor.right, 8)}px`, bottom: `${innerHeight - anchor.top + 10}px` });
    let shown = [];
    let at = 0;
    const render = () => {
      const q = input.value.trim();
      // Empty: everything, in sections. Typing: the best 9 matches, then ask / mission rows.
      const found = q ? list.map((it) => ({ it, m: match(it.label, q) })).filter((x) => x.m).sort((a, b) => b.m.score - a.m.score).slice(0, 9)
        : list.map((it) => ({ it, m: { html: esc(it.label) } })).sort((a, b) => order(a.it.group) - order(b.it.group));
      const free = q
        ? [
            { icon: '↵', label: `Ask: ${q}`, kind: sel ? 'about the selection' : 'about this page', run: () => EG.run(sel ? { task: { kind: 'text' }, question: q, selection: sel.text } : { task: { kind: 'page' }, question: q, page: EG.pageInfo() }, q, sel?.rect || EG.topRect()) },
            { icon: '◎', label: `Mission: ${q}`, kind: 'search the web, compare, rank', run: () => EG.bg('agentOpen', { goal: q, run: true, context: `${document.title} (${location.href})` }) },
            { icon: '▤', label: `Across my open tabs: ${q}`, kind: 'read your tabs, compare, rank', run: () => EG.bg('agentOpen', { goal: q, run: true, tabs: true }) },
          ]
        : [];
      shown = [...found.map((x) => ({ ...x.it, html: x.m.html })), ...free.map((f) => ({ ...f, html: esc(f.label) }))];
      at = Math.min(at, Math.max(shown.length - 1, 0));
      ul.innerHTML = shown.map((it, i) => `${!q && it.group !== shown[i - 1]?.group ? `<li class="h" role="presentation">${esc(it.group || '')}</li>` : ''}<li role="option" aria-selected="${i === at}" data-i="${i}"><span class="i">${it.icon === 'flower' ? hgFlower(14) : esc(it.icon)}</span><span>${it.html}</span><span class="k">${esc(it.kind || '')}</span></li>`).join('');
      ul.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
    };
    const go = (i) => {
      const it = shown[i];
      close();
      it?.run();
    };
    input.oninput = () => ((at = 0), render());
    input.onkeydown = (e) => {
      if (e.key === 'ArrowDown') (at = Math.min(at + 1, shown.length - 1)), render(), e.preventDefault();
      else if (e.key === 'ArrowUp') (at = Math.max(at - 1, 0)), render(), e.preventDefault();
      else if (e.key === 'Enter') go(at), e.preventDefault();
      else if (e.key === 'Escape') close();
      e.stopPropagation();
    };
    ul.onclick = (e) => {
      const li = e.target.closest('li[data-i]');
      if (li) go(+li.dataset.i);
    };
    back.onmousedown = (e) => e.target === back && close();
    EG.root.append(back);
    open = back;
    render();
    input.focus();
  }
  const close = () => (open?.remove(), (open = null));

  addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyK' && EG.enabled()) (e.preventDefault(), e.stopImmediatePropagation(), show()); // the page shouldn't also see a 'k'
  }, true);
  EG.palette = show;
})();
