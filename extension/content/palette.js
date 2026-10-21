// Command palette: Alt+K on any page (or "Search everything" in the launcher). One box that finds every
// task, feature action and saved mission; typed text can be asked about the page or start a mission.
// Selection-aware: with text selected, the text actions come first and run on the selection.
(() => {
  const EG = window.EG;
  if (!EG || window !== top) return;

  EG.style(`
    .pal-back { position: fixed; inset: 0; background: rgba(0,0,0,.25); display: flex; justify-content: center; align-items: flex-start; padding-top: 14vh; }
    .pal { width: min(620px, calc(100vw - 32px)); background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 18px 60px rgba(0,0,0,.35); overflow: hidden; }
    .pal input { width: 100%; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; padding: 14px 16px; font-size: 16px; min-width: 0; outline: none; }
    .pal ul { list-style: none; margin: 0; padding: 6px; max-height: 50vh; overflow: auto; }
    .pal li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
    .pal li[aria-selected=true] { background: var(--chip); }
    .pal li .k { margin-left: auto; font-size: 11px; color: var(--muted); }
    .pal li .i { width: 18px; text-align: center; }
    .pal li mark { background: none; color: var(--accent); font-weight: 600; }
    .pal .ctx { padding: 6px 16px; font-size: 11.5px; color: var(--muted); border-bottom: 1px solid var(--line); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `);

  let open = null;

  async function items(sel) {
    const ctx = sel ? { ...sel } : null;
    const payload = sel ? { selection: sel.text } : { page: EG.pageInfo() };
    const list = [];
    const add = (icon, label, kind, run) => list.push({ icon, label, kind, run });
    const tasks = EG.settings.tasks || [];
    if (sel) {
      for (const t of tasks.filter((t) => t.kind === 'text')) add('✦', t.title, 'on selection', () => EG.run({ task: t, selection: sel.text }, t.title, sel.rect));
      for (const a of EG.actions.text.filter((a) => !a.when || a.when(ctx))) add('›', a.label, 'on selection', () => a.run({ selection: sel.text, ctx, rect: sel.rect }));
    }
    for (const t of tasks.filter((t) => t.kind === 'page')) add('✦', t.title, 'page', () => EG.run({ task: t, page: EG.pageInfo() }, t.title, EG.topRect()));
    for (const a of EG.actions.page.filter((a) => !a.when || a.when())) add('›', a.label, 'page', () => a.run({ page: EG.pageInfo(), rect: EG.topRect() }));
    try {
      for (const m of await EG.bg('missionsList')) add('🧭', m.name, 'saved mission', () => EG.bg('agentOpen', { goal: m.goal, run: true }));
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
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  async function show() {
    if (open) return close();
    EG.mount();
    const sel = EG.currentSelection();
    const { list } = await items(sel);
    const back = Object.assign(document.createElement('div'), { className: 'pal-back' });
    back.innerHTML = '<div class="pal" role="dialog" aria-label="Edge Gallery command palette"><input aria-label="Search actions or type a question" placeholder="Search actions, or type a question or a goal…"><div class="ctx"></div><ul role="listbox"></ul></div>';
    const input = back.querySelector('input');
    const ul = back.querySelector('ul');
    back.querySelector('.ctx').textContent = sel ? `Selection: “${sel.text.slice(0, 90)}${sel.text.length > 90 ? '…' : ''}”` : `Page: ${document.title}`;
    let shown = [];
    let at = 0;
    const render = () => {
      const q = input.value.trim();
      const found = list.map((it) => ({ it, m: match(it.label, q) })).filter((x) => x.m).sort((a, b) => b.m.score - a.m.score).slice(0, 9);
      const free = q
        ? [
            { icon: '?', label: `Ask: ${q}`, kind: sel ? 'about the selection' : 'about this page', run: () => EG.run(sel ? { task: { kind: 'text' }, question: q, selection: sel.text } : { task: { kind: 'page' }, question: q, page: EG.pageInfo() }, q, sel?.rect || EG.topRect()) },
            { icon: '🧭', label: `Mission: ${q}`, kind: 'search the web, compare, rank', run: () => EG.bg('agentOpen', { goal: q, run: true, context: `${document.title} (${location.href})` }) },
            { icon: '🗂', label: `Across my open tabs: ${q}`, kind: 'read your tabs, compare, rank', run: () => EG.bg('agentOpen', { goal: q, run: true, tabs: true }) },
          ]
        : [];
      shown = [...found.map((x) => ({ ...x.it, html: x.m.html })), ...free.map((f) => ({ ...f, html: esc(f.label) }))];
      at = Math.min(at, Math.max(shown.length - 1, 0));
      ul.innerHTML = shown.map((it, i) => `<li role="option" aria-selected="${i === at}" data-i="${i}"><span class="i">${esc(it.icon)}</span><span>${it.html}</span><span class="k">${esc(it.kind)}</span></li>`).join('');
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
      const li = e.target.closest('li');
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
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyK' && EG.enabled()) (e.preventDefault(), show());
  }, true);
  EG.actions.page.unshift({ label: 'Search everything (Alt+K)', when: () => true, run: show });
  EG.palette = show;
})();
