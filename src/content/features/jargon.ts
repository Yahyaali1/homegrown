// Jargon lens: hold Alt (Option) and point at a word for a plain-language definition fitted to its paragraph.
import { ui } from '../core.ts';
import { h } from '../../ui/dom.ts';

function termAt(x: number, y: number): { term: string; node: Node } | null {
  const sel = getSelection();
  if (sel?.rangeCount && sel.toString().trim()) {
    const r = sel.getRangeAt(0).getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && sel.anchorNode) return { term: sel.toString().trim().slice(0, 80), node: sel.anchorNode };
  }
  const r = document.caretRangeFromPoint(x, y);
  const node = r?.startContainer;
  if (!r || node?.nodeType !== Node.TEXT_NODE) return null;
  const t = node.textContent ?? '';
  let a = r.startOffset;
  let b = r.startOffset;
  while (a > 0 && /[\p{L}\p{N}'-]/u.test(t[a - 1]!)) a--;
  while (b < t.length && /[\p{L}\p{N}'-]/u.test(t[b]!)) b++;
  const term = t.slice(a, b);
  return term.length > 2 ? { term, node } : null;
}

export function install(): void {
  if (location.protocol === 'chrome-extension:') return;
  // width: max-content: the UI's host has no width, so a tooltip without one would wrap after every word.
  ui.style('.eg-tip { position: absolute; width: max-content; max-width: 320px; padding: 6px 10px; border-radius: 8px; background: var(--bg); color: var(--fg); border: 1px solid var(--line); box-shadow: var(--shadow-menu); }');
  const word = h('b');
  const said = h('span');
  const tip = h('div', { className: 'eg-tip', hidden: true, attrs: { role: 'tooltip' } }, word, ' ', said);
  ui.root.append(tip);
  const cache = new Map<string, Promise<string>>(); // term + context → definition
  let altSince = 0;
  let last = '';

  addEventListener('keydown', (e) => e.key === 'Alt' && !altSince && (altSince = performance.now()), true);
  addEventListener('keyup', (e) => e.key === 'Alt' && ((altSince = 0), (last = ''), (tip.hidden = true)), true);
  addEventListener('blur', () => ((altSince = 0), (tip.hidden = true)));

  addEventListener('mousemove', (e) => {
    // The mouse event says whether Alt is down. The key events alone can't: an Alt released while typing in our own
    // boxes (the palette's Alt+K) never reaches the page, which would leave the lens armed.
    if (!e.altKey) return void ((altSince = 0), (last = ''), (tip.hidden = true));
    if (!altSince || performance.now() - altSince < 400 || !ui.enabled() || e.composedPath().includes(ui.root.host)) return;
    const hit = termAt(e.clientX, e.clientY);
    if (!hit || hit.term === last) return;
    const term = (last = hit.term);
    const context = (hit.node.parentElement?.closest<HTMLElement>('p, li, td, dd, blockquote, section, div')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 600);
    const key = `${term}\n${context}`;
    if (!cache.has(key)) {
      cache.set(key, ui.generate({ quiet: true, task: { kind: 'text', prompt: `In one or two plain sentences, explain what "${term}" means in this context. Reply with only the explanation:` }, selection: context })
        .then((r) => r.text.trim(), (err: Error) => err.message));
    }
    ui.mount();
    tip.style.top = `${e.clientY + scrollY + 16}px`;
    tip.style.left = `${Math.min(e.clientX, innerWidth - 340) + scrollX}px`;
    word.textContent = term;
    said.textContent = '…';
    tip.hidden = false;
    void cache.get(key)!.then((d) => last === term && (said.textContent = `— ${d}`));
  }, true);
}
