// Jargon lens: hold Alt (Option) and point at a word: a plain-language definition fitted to its paragraph.
(() => {
  const EG = window.EG;
  if (!EG || location.protocol === 'chrome-extension:') return;

  EG.style('.eg-tip { position: absolute; max-width: 320px; padding: 6px 10px; border-radius: 8px; background: var(--bg); color: var(--fg); border: 1px solid var(--line); box-shadow: 0 4px 16px rgba(0,0,0,.18); }');
  const tip = Object.assign(document.createElement('div'), { className: 'eg-tip', hidden: true, role: 'tooltip' });
  EG.root.append(tip);
  const cache = new Map(); // term + context -> definition promise
  let altSince = 0;
  let last = '';

  addEventListener('keydown', (e) => e.key === 'Alt' && !altSince && (altSince = performance.now()), true);
  addEventListener('keyup', (e) => e.key === 'Alt' && ((altSince = 0), (last = ''), (tip.hidden = true)), true);
  addEventListener('blur', () => ((altSince = 0), (tip.hidden = true)));

  function termAt(x, y) {
    const sel = getSelection();
    if (sel.rangeCount && sel.toString().trim()) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { term: sel.toString().trim().slice(0, 80), node: sel.anchorNode };
    }
    const r = document.caretRangeFromPoint(x, y);
    const node = r?.startContainer;
    if (node?.nodeType !== 3) return null;
    const t = node.textContent;
    let a = r.startOffset;
    let b = r.startOffset;
    while (a > 0 && /[\p{L}\p{N}'-]/u.test(t[a - 1])) a--;
    while (b < t.length && /[\p{L}\p{N}'-]/u.test(t[b])) b++;
    const term = t.slice(a, b);
    return term.length > 2 ? { term, node } : null;
  }

  addEventListener('mousemove', (e) => {
    if (!altSince || performance.now() - altSince < 400 || !EG.enabled() || e.composedPath().includes(EG.root.host)) return;
    const hit = termAt(e.clientX, e.clientY);
    if (!hit || hit.term === last) return;
    last = hit.term;
    const context = (hit.node.parentElement?.closest('p, li, td, dd, blockquote, section, div')?.innerText || '').replace(/\s+/g, ' ').slice(0, 600);
    const key = `${hit.term}\n${context}`;
    if (!cache.has(key)) {
      cache.set(key, EG.generate({
        quiet: true,
        task: { kind: 'text', prompt: `In one or two plain sentences, explain what "${hit.term}" means in this context. Reply with only the explanation:` },
        selection: context,
      }).then((r) => r.text.trim(), (err) => err.message));
    }
    EG.mount();
    tip.style.top = `${e.clientY + scrollY + 16}px`;
    tip.style.left = `${Math.min(e.clientX, innerWidth - 340) + scrollX}px`;
    tip.innerHTML = `<b></b> <span>…</span>`;
    tip.querySelector('b').textContent = hit.term;
    tip.hidden = false;
    const term = hit.term;
    cache.get(key).then((d) => last === term && (tip.querySelector('span').textContent = `— ${d}`));
  }, true);
})();
