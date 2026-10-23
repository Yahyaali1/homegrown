// Command palette: Alt+K on any page, and the ❀ launcher (as a menu above the button). One box that finds every task,
// feature action and saved mission; typed text can be asked about the page or start a mission. Empty, it lists
// everything in sections. With text selected, text actions come first.
import { ui, type Rect } from '../core.ts';
import { h } from '../../ui/dom.ts';
import { flower } from '../../ui/flower.ts';
import { fuzzy } from '../../domain/reading.ts';

interface Item { icon: string; label: string; kind: string; group: string; run(): unknown }
const SECTIONS = ['Selection', 'This page', 'Read', 'Write', 'Translate', 'Images', 'Web', 'Tabs', 'Voice', 'More', 'Saved missions'];
const order = (g: string) => SECTIONS.indexOf(g) + 1 || 99;

async function items(): Promise<{ list: Item[]; sel: ReturnType<typeof ui.currentSelection> }> {
  const sel = ui.currentSelection();
  const list: Item[] = [];
  const add = (icon: string, label: string, group: string, run: () => unknown) => list.push({ icon, label, kind: '', group, run });
  if (sel) {
    for (const t of ui.tasks.filter((t) => t.kind === 'text')) add('flower', t.title, 'Selection', () => ui.run({ task: t, selection: sel.text }, t.title, sel.rect));
    for (const a of ui.actions.text.filter((a) => !a.when || a.when(sel))) add('›', a.label, 'Selection', () => a.run({ selection: sel.text, ctx: sel, rect: sel.rect }));
  }
  for (const t of ui.tasks.filter((t) => t.kind === 'page')) add('flower', t.title, 'This page', () => ui.run({ task: t, page: ui.pageInfo() }, t.title, ui.topRect()));
  for (const a of ui.actions.page.filter((a) => !a.when || a.when())) {
    const g = ui.groupOf(a.label);
    add('›', a.label, g === 'More' && a.when ? 'This page' : g, () => a.run({ page: ui.pageInfo(), rect: ui.topRect() }));
  }
  try {
    for (const m of await ui.bg<{ name: string; goal: string }[]>('missionsList')) add('◎', m.name, 'Saved missions', () => ui.bg('agentOpen', { goal: m.goal, run: true }));
  } catch {}
  return { list, sel };
}

/** A label with the matched letters marked, as nodes (labels are page-independent but still never parsed as HTML). */
const marked = (label: string, hits: Set<number>) => [...label].map((c, k) => (hits.has(k) ? h('mark', { textContent: c }) : c));

let open: HTMLElement | null = null;
const close = () => (open?.remove(), (open = null));

async function show(opts: { anchor?: Rect | null } = {}): Promise<void> {
  if (open) return void close();
  const anchor = opts.anchor;
  ui.mount();
  const { list, sel } = await items();
  const input = h('input', { placeholder: 'Ask about this page, or search actions…', attrs: { 'aria-label': 'Search actions or type a question' } });
  const ul = h('ul', { attrs: { role: 'listbox' } });
  const kbd = (t: string) => h('kbd', { textContent: t });
  const ctx = h('div', { className: 'ctx' }, sel ? `Selection: “${sel.text.slice(0, 60)}${sel.text.length > 60 ? '…' : ''}”` : document.title, ' · ', kbd('↑↓'), ' ', kbd('↵'), ' · ', kbd('Alt K'), ' anywhere');
  const pal = h('div', { className: 'pal', attrs: { role: 'dialog', 'aria-label': 'Homegrown command palette' } }, input, ctx, ul);
  const back = h('div', { className: anchor ? 'pal-back anchored' : 'pal-back' }, pal);
  if (anchor) Object.assign(pal.style, { right: `${Math.max(innerWidth - anchor.right, 8)}px`, bottom: `${innerHeight - anchor.top + 10}px` });
  let shown: (Item & { hits: Set<number> })[] = [];
  let at = 0;
  const render = () => {
    const q = input.value.trim();
    // Empty: everything, in sections. Typing: the best 9 matches, then ask, mission and open-tabs rows.
    const found = q
      ? list.map((it) => ({ ...it, m: fuzzy(it.label, q) })).filter((x) => x.m).sort((a, b) => b.m!.score - a.m!.score).slice(0, 9).map((x) => ({ ...x, hits: x.m!.hits }))
      : [...list].sort((a, b) => order(a.group) - order(b.group)).map((it) => ({ ...it, hits: new Set<number>() }));
    const free: Item[] = q ? [
      { icon: '↵', label: `Ask: ${q}`, kind: sel ? 'about the selection' : 'about this page', group: '',
        run: () => ui.run(sel ? { task: { kind: 'text' }, question: q, selection: sel.text } : { task: { kind: 'page' }, question: q, page: ui.pageInfo() }, q, sel?.rect ?? ui.topRect()) },
      { icon: '◎', label: `Mission: ${q}`, kind: 'search the web, compare, rank', group: '', run: () => ui.bg('agentOpen', { goal: q, run: true, context: `${document.title} (${location.href})` }) },
      { icon: '▤', label: `Across my open tabs: ${q}`, kind: 'read your tabs, compare, rank', group: '', run: () => ui.bg('agentOpen', { goal: q, run: true, tabs: true }) },
    ] : [];
    shown = [...found, ...free.map((f) => ({ ...f, hits: new Set<number>() }))];
    at = Math.min(at, Math.max(shown.length - 1, 0));
    ul.replaceChildren(...shown.flatMap((it, i) => [
      ...(!q && it.group !== shown[i - 1]?.group ? [h('li', { className: 'h', textContent: it.group, attrs: { role: 'presentation' } })] : []),
      h('li', { dataset: { i: String(i) }, attrs: { role: 'option', 'aria-selected': String(i === at) } },
        h('span', { className: 'i' }, it.icon === 'flower' ? flower(18) : it.icon), h('span', {}, ...marked(it.label, it.hits)), h('span', { className: 'k', textContent: it.kind })),
    ]));
    ul.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
  };
  const go = (i: number) => {
    const it = shown[i];
    close();
    void it?.run();
  };
  input.oninput = () => ((at = 0), render());
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown') ((at = Math.min(at + 1, shown.length - 1)), render(), e.preventDefault());
    else if (e.key === 'ArrowUp') ((at = Math.max(at - 1, 0)), render(), e.preventDefault());
    else if (e.key === 'Enter') (go(at), e.preventDefault());
    else if (e.key === 'Escape') close();
    e.stopPropagation();
  };
  ul.onclick = (e) => {
    const li = (e.target as Element).closest<HTMLElement>('li[data-i]');
    if (li) go(Number(li.dataset.i));
  };
  back.onmousedown = (e) => e.target === back && close();
  ui.root.append(back);
  open = back;
  render();
  input.focus();
}

export function install(): void {
  if (window !== top) return;
  ui.style(`
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
    .pal li .i { width: 18px; display: grid; place-items: center; color: var(--muted); filter: grayscale(1); } .pal li .i:has(.flower) { filter: none; color: var(--fg); --seed-ring: var(--panel); }
    .pal li span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pal li mark { background: none; color: var(--fg); font-weight: 600; text-decoration: underline; text-decoration-color: var(--line-strong); text-underline-offset: 2px; }
    .pal .ctx { padding: 6px 14px; font-size: var(--t-xs); color: var(--faint); border-top: 1px solid var(--line); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; order: 3; }
    .pal kbd { font: var(--t-xs) var(--mono); padding: 0 4px; border-radius: var(--r-xs); box-shadow: inset 0 0 0 1px var(--line-strong); color: var(--muted); }
  `);
  addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyK' && ui.enabled()) (e.preventDefault(), e.stopImmediatePropagation(), void show()); // the page shouldn't also see a 'k'
  }, true);
  ui.palette = (opts) => void show(opts);
}
