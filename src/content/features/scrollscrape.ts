// Scrape as you scroll: like the bilingual page, but each block that scrolls into view is collected. Tables and
// "Label: value" lists are read as they are; for a repeated block (cards, results, listings) the local model decides
// whether it holds records and which fields to pull (bg 'scrollList'). Only reading: nothing is clicked or typed.
// The innermost repeated container is the block (a page of sections holds a grid; the grid is the data). Items are
// remembered one by one, so feeds that append, prepend or recycle nodes add only what is new.
import { ui } from '../core.ts';
import { h } from '../../ui/dom.ts';
import { factsRow, labelPairs, SCROLL_LIMITS, type Cell, type Collected } from '../../domain/scroll.ts';
import { toCsv } from '../../domain/csv.ts';
import { ORGANIZE_LIMITS, outline, type PageSection } from '../../domain/organize.ts';
import { markdownOf, textOf } from '../scenario.ts';

type Kind = Collected['kind'];
interface Block { el: HTMLElement; kind: Kind; inView: boolean; queued: boolean; started: boolean; batches: number; tries: number; section?: Collected; fields?: string[]; skipped?: boolean }

let blocks = new Map<HTMLElement, Block>();
let sections: Collected[] = [];
let seen = new Set<string>(); // items already read, by their text: recycled nodes and re-rendered lists add only what's new
let queue: Block[] = [];
let busy = false;
let observer: IntersectionObserver | null = null;
let watcher: MutationObserver | null = null;
let life: chrome.runtime.Port | null = null; // Stop and closing the tab cancel the model call (scrape:<session>)
let session = '';
let bar: HTMLElement;
let used = 0; // blocks started on this page
let calls = 0; // model requests on this page
let skipped = 0;
let noModel = '';
let note = '';

// ---- whole page: every section's text and Markdown as it comes into view, then Organize into tables ----
interface Part extends PageSection { at: Element; from: Element | null; to: Element | null; captured: boolean }
let whole = false;
let parts: Part[] = [];
let partObserver: IntersectionObserver | null = null;
let organizing = false;

const text = (el: Element) => ((el as HTMLElement).innerText ?? el.textContent ?? '').trim();
const FURNITURE = 'nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo], menu';
const outside = (el: Element) => !!el.closest('edge-gallery') || !!el.closest(FURNITURE);
const PROSE = /^(P|H[1-6]|SPAN|EM|STRONG|B|I|A|BR|HR|IMG|SCRIPT|STYLE|SVG|BUTTON|INPUT|LABEL)$/;

// The heading a block sits under: its caption, an aria-label, or the nearest heading before it.
function headingOf(el: HTMLElement): string {
  const own = el.querySelector(':scope > caption')?.textContent || el.getAttribute('aria-label');
  if (own) return own.trim().slice(0, 150);
  for (let n: Element | null = el; n && n !== document.body; n = n.previousElementSibling ?? n.parentElement) {
    if (n !== el && n.matches('h1, h2, h3, h4')) return text(n).slice(0, 150);
  }
  return document.title;
}

/** Children that repeat: at least 3 containers with the same tag and classes, 60% of the children, some text. */
function repeated(el: Element): HTMLElement[] {
  const kids = [...el.children] as HTMLElement[];
  if (kids.length < 3 || kids.length > 300) return [];
  const sig = (k: Element) => `${k.tagName}.${[...k.classList].sort().join('.')}`;
  const counts = new Map<string, number>();
  for (const k of kids) counts.set(sig(k), (counts.get(sig(k)) ?? 0) + 1);
  const [best, n] = [...counts].sort((a, b) => b[1] - a[1])[0]!;
  if (n < 3 || n < kids.length * 0.6 || PROSE.test(best.split('.')[0]!)) return [];
  const same = kids.filter((k) => sig(k) === best && (k.textContent ?? '').trim().length >= 15);
  return same.length >= 3 ? same : [];
}

// A layout table (one cell a row, nested tables, role=presentation) is page structure, not data.
const dataTable = (t: HTMLTableElement) =>
  t.rows.length >= 2 && !t.querySelector('table') && t.getAttribute('role') !== 'presentation' && (t.rows[0]?.cells.length ?? 0) >= 2;

// Facts: one "Label: value" per child (most children), 3 distinct labels or more. Children with several pairs each
// are cards (name, price, size…): a list, not facts.
function factPairs(el: HTMLElement): [string, string][] {
  if (el.tagName === 'DL') return [...el.querySelectorAll(':scope > dt, :scope > div > dt')].map((dt) => [text(dt), dt.nextElementSibling?.tagName === 'DD' ? text(dt.nextElementSibling) : '']);
  const each = [...el.children].map((c) => labelPairs(text(c)));
  if (each.some((p) => p.length > 1) || each.filter((p) => p.length === 1).length < each.length * 0.8) return [];
  return each.flat();
}

function kindOf(el: HTMLElement): Kind | null {
  if (el instanceof HTMLTableElement) return dataTable(el) ? 'table' : null;
  if ((el.tagName === 'DL' || el.tagName === 'UL' || el.tagName === 'OL') && factsRow(factPairs(el))) return 'facts';
  return repeated(el).length ? 'list' : null;
}

const itemKey = (i: Element) => text(i).replace(/\s+/g, ' ').slice(0, 1500);
const fresh = (b: Block) => repeated(b.el).filter((i) => !seen.has(itemKey(i)));

/**
 * Whether a list's items each hold their own detail block (every card has a <dl> of specs): then the list is the
 * block and the details belong to it. A page of sections holding different blocks is not a list of records.
 */
function detailsInside(el: HTMLElement, inner: HTMLElement[]): boolean {
  const items = repeated(el);
  const holding = items.filter((i) => inner.some((o) => i.contains(o)));
  if (holding.length < items.length * 0.6) return false;
  const kinds = new Set(inner.filter((o) => el.contains(o)).map((o) => `${blocks.get(o)?.kind ?? kindOf(o)}:${o.tagName}`));
  return kinds.size === 1;
}

function drop(o: HTMLElement): void {
  const b = blocks.get(o);
  if (!b) return;
  observer?.unobserve(o);
  queue = queue.filter((x) => x !== b);
  if (b.section) sections = sections.filter((s) => s !== b.section);
  if (o.dataset.egScraped) delete o.dataset.egScraped;
  blocks.delete(o);
}

/**
 * Finds blocks under `roots` (the page at start; later the nodes a mutation added) and checks `parents` themselves
 * (the added nodes' near ancestors, not their subtrees). The innermost block wins, whichever scan found it.
 */
function scan(roots: Element[], parents: Element[] = []): void {
  for (const [el] of blocks) if (!el.isConnected) blocks.delete(el); // re-rendered or removed
  const found = new Map<HTMLElement, Kind>();
  const consider = (el: Element) => {
    if (!(el instanceof HTMLElement) || blocks.has(el) || found.has(el) || outside(el)) return;
    const kind = kindOf(el);
    if (kind) found.set(el, kind);
  };
  for (const root of roots) {
    consider(root);
    for (const el of root.querySelectorAll('table, dl, ul, ol, div, section, main, article')) consider(el);
  }
  for (const p of parents) consider(p);
  const all = [...blocks.keys(), ...found.keys()];
  const inside = (el: HTMLElement) => all.filter((o) => o !== el && el.contains(o));
  for (const [el, kind] of found) {
    const inner = inside(el);
    if (kind === 'list' && inner.length) {
      if (!detailsInside(el, inner)) continue; // a page of sections around blocks: the blocks are the data
      for (const o of inner) (drop(o), found.delete(o)); // cards each holding details: the cards are the block
    }
    if (all.some((o) => o !== el && o.contains(el) && found.get(o) === 'list' && detailsInside(o, [el]))) continue;
    // A registered outer list that turns out to wrap this block (a grid that loaded late) stops being one.
    for (const o of all) if (o !== el && o.contains(el) && blocks.get(o)?.kind === 'list' && !detailsInside(o, [el])) drop(o);
    const b: Block = { el, kind, inView: false, queued: false, started: false, batches: 0, tries: 0 };
    blocks.set(el, b);
    observer?.observe(el);
  }
  // Collected lists with new items that are in view wait their turn (a feed the reader is watching).
  for (const b of blocks.values()) if (b.section && b.kind === 'list' && b.inView) enqueue(b);
  void pump();
}

function enqueue(b: Block): void {
  if (b.queued || b.skipped || (b.section && b.kind !== 'list')) return;
  if (b.kind === 'list' && !fresh(b).length) return;
  b.queued = true;
  queue.push(b);
}

function tableRows(t: HTMLTableElement): Record<string, Cell>[] {
  const rows = [...t.rows].slice(0, 200).map((tr) => [...tr.cells].map(text));
  const head = rows[0]!.map((c, i) => c || `column_${i + 1}`);
  return rows.slice(1).filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(head.map((k, i) => [k, r[i] ?? null])));
}

async function collect(b: Block): Promise<void> {
  if (b.kind !== 'list') {
    const rows = b.kind === 'table' ? tableRows(b.el as HTMLTableElement) : [factsRow(factPairs(b.el))].filter((r): r is Record<string, Cell> => !!r);
    b.section = { kind: b.kind, name: headingOf(b.el), rows };
    if (rows.length) sections.push(b.section);
    return;
  }
  const items = fresh(b).slice(0, SCROLL_LIMITS.items);
  if (!items.length) return;
  const mine = session;
  calls++;
  b.batches++;
  const r = await ui.bg<{ use: boolean; name: string; fields: string[]; rows: Record<string, Cell>[]; stopped?: boolean }>('scrollList', {
    heading: headingOf(b.el), items: items.map((i) => text(i).slice(0, 1500)), runId: session, ...(b.fields && { fields: b.fields }),
  });
  // Stopped, restarted, or no longer a block (a grid inside it turned up meanwhile) while the model read it.
  if (mine !== session || r.stopped || blocks.get(b.el) !== b) return;
  for (const i of items) seen.add(itemKey(i));
  if (!r.use) {
    b.skipped = true;
    skipped++;
    b.el.dataset.egScraped = 'skip';
    return;
  }
  b.fields = r.fields;
  const rows = r.rows.filter((row) => Object.values(row).some((v) => v != null));
  if (!b.section) b.section = { kind: 'list', name: r.name, rows: [] };
  if (rows.length && !b.section.rows.length) sections.push(b.section); // listed once it has rows
  b.section.rows.push(...rows);
}

/** The page split at its headings (h1–h4, outside navigation), with what comes before the first one as "Intro". */
function partsOfPage(): Part[] {
  const heads = [...document.body.querySelectorAll<HTMLElement>('h1, h2, h3, h4')].filter((hd) => !outside(hd) && text(hd)).slice(0, ORGANIZE_LIMITS.sections - 1);
  const first = [...document.body.children].find((c) => !outside(c) && !c.matches('script, style')) ?? document.body;
  return [null, ...heads].map((hd, i) => ({
    heading: hd ? text(hd).slice(0, 150) : 'Intro', level: hd ? Number(hd.tagName[1]) : 0, text: '', markdown: '',
    at: hd ?? first, from: hd, to: heads[i] ?? null, captured: false,
  }));
}

/** A section's content: from its heading to the next one, without navigation, headers, footers, scripts or our UI. */
function capture(p: Part): void {
  const r = document.createRange();
  if (p.from) r.setStartBefore(p.from);
  else r.setStart(document.body, 0);
  if (p.to) r.setEndBefore(p.to);
  else r.setEnd(document.body, document.body.childNodes.length);
  const box = document.createElement('div');
  box.append(r.cloneContents());
  for (const x of box.querySelectorAll(`${FURNITURE}, edge-gallery, script, style, noscript, template`)) x.remove();
  p.markdown = markdownOf(box).slice(0, 20000);
  p.text = textOf(box).slice(0, 20000);
  p.captured = true;
}

const wholeStatus = () => (whole ? `Whole page: ${parts.filter((p) => p.captured).length}/${parts.length} sections` : '');

function setWhole(on: boolean): void {
  whole = on;
  bar.querySelector<HTMLElement>('[data-whole]')!.setAttribute('aria-pressed', String(on));
  bar.querySelector<HTMLElement>('[data-organize]')!.hidden = !on;
  partObserver?.disconnect();
  partObserver = null;
  if (on) {
    parts = partsOfPage();
    partObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const p = parts.find((x) => x.at === e.target);
        if (e.isIntersecting && p && !p.captured) (capture(p), partObserver?.unobserve(e.target));
      }
      status();
    }, { rootMargin: '200px 0px' });
    for (const p of parts) partObserver.observe(p.at);
  }
  status();
}

/**
 * The agent pass: sections not yet seen are captured, then the local model puts each one into a table it designs,
 * every cell checked against the section's text (bg 'scrollOrganize'). Plus an outline, without a model.
 */
async function organize(): Promise<void> {
  if (organizing || !whole) return;
  organizing = true;
  const mine = session;
  for (const p of parts) if (!p.captured) capture(p); // the rest of the page, as it is now
  const kept = parts.filter((p) => p.text.split(/\s+/).filter(Boolean).length >= 5);
  sections = sections.filter((s) => !s.organized);
  sections.push({ kind: 'table', name: 'Outline', rows: outline(kept), organized: true });
  let n = 0;
  for (const p of kept) {
    if (session !== mine) break;
    bar.querySelector('span')!.textContent = `Organizing ${++n}/${kept.length}: ${p.heading}…`;
    try {
      const r = await ui.bg<{ table: { name: string; rows: Record<string, Cell>[] } | null; stopped?: boolean }>('scrollOrganize', { heading: p.heading, text: p.text, runId: session });
      if (session !== mine || r.stopped) break;
      if (r.table) sections.push({ kind: 'table', name: `${r.table.name} (${p.heading})`, rows: r.table.rows, organized: true });
    } catch (e) {
      note = (e as Error).message;
      break;
    }
  }
  organizing = false;
  if (session === mine) (note = note || `organized ${kept.length} sections`), status();
}

const filled = () => sections.filter((s) => s.rows.length);
const count = () => filled().reduce((n, s) => n + s.rows.length, 0);
function status(): void {
  const by = (k: Kind) => filled().filter((s) => s.kind === k).length;
  const plural = (n: number, w: string) => (n ? `${n} ${w}${n > 1 ? 's' : ''}` : '');
  const kinds = [plural(by('table'), 'table'), plural(by('list'), 'list'), plural(by('facts'), 'fact list'), skipped ? `${skipped} skipped` : ''].filter(Boolean);
  bar.querySelector('span')!.textContent = [kinds.length ? `${count()} rows · ${kinds.join(' · ')}` : 'Collecting as you scroll…', wholeStatus(), noModel, note].filter(Boolean).join(' · ');
}

async function pump(): Promise<void> {
  if (busy || !observer) return;
  busy = true;
  const mine = session;
  while (queue.length && session === mine) {
    const b = queue.shift()!;
    b.queued = false;
    if (!b.el.isConnected || (b.kind === 'list' && noModel)) continue;
    if (!b.started && used >= SCROLL_LIMITS.blocks) {
      note = `stopped at ${SCROLL_LIMITS.blocks} blocks on this page`;
      continue;
    }
    if (b.kind === 'list' && (calls >= SCROLL_LIMITS.calls || b.batches >= SCROLL_LIMITS.batches)) {
      note = 'enough for this page: the model has read its share';
      continue;
    }
    if (!b.started) (b.started = true), used++;
    if (b.kind === 'list') bar.querySelector('span')!.textContent = 'The model on this device is reading a block…';
    try {
      await collect(b);
      if (b.section && session === mine && blocks.get(b.el) === b) b.el.dataset.egScraped = b.kind;
      b.tries = 0;
      if (session === mine && b.kind === 'list' && b.inView) enqueue(b); // more items than one batch: go on while in view
    } catch (e) {
      const msg = (e as Error).message;
      if (session !== mine) break;
      if (/No model/i.test(msg)) noModel = `${msg} Tables and facts are still collected.`;
      else if (++b.tries < 2) enqueue(b); // a passing engine error: one more try
      else note = msg;
    }
    if (session === mine) status();
  }
  busy = false;
}

// ---- results ----

const allRows = () => filled().flatMap((s) => s.rows.map((r) => ({ section: s.name, ...r })));
function show(): void {
  const card = ui.openCard('Collected as you scrolled', ui.topRect());
  card.meta.textContent = `${count()} rows from ${filled().length} blocks${skipped ? `, ${skipped} skipped as page furniture` : ''} · read on this device`;
  card.body.replaceChildren(...filled().map((s) => {
    const keys = [...new Set(s.rows.flatMap((r) => Object.keys(r)))];
    return h('section', {},
      h('p', { style: 'font-weight:600;margin:8px 0 4px', textContent: `${s.name} · ${s.organized ? 'organized' : s.kind} · ${s.rows.length}` }),
      h('div', { style: 'overflow:auto;max-height:220px' }, h('table', { className: 'sas' },
        h('tr', {}, ...keys.map((k) => h('th', { textContent: k }))),
        ...s.rows.slice(0, 50).map((r) => h('tr', {}, ...keys.map((k) => h('td', { textContent: r[k] == null ? '' : String(r[k]) })))))));
  }), ...(whole ? [h('details', {}, h('summary', { textContent: `Whole page: ${captured().length} sections captured` }),
    ...captured().map((p) => h('section', {}, h('p', { style: 'font-weight:600;margin:6px 0 2px', textContent: p.heading }), h('pre', { className: 'sasmd', textContent: p.markdown.slice(0, 2000) }))))] : []));
}
const captured = () => parts.filter((p) => p.captured && p.text);
/** Copy JSON: the tables, and with Whole page on, every captured section's text and Markdown. */
const asJson = () => ({ tables: filled(), ...(whole && { page: captured().map(({ heading, level, text: t, markdown }) => ({ heading, level, text: t, markdown })) }) });

function stop(): void {
  session = '';
  life?.disconnect();
  life = null;
  observer?.disconnect();
  watcher?.disconnect();
  partObserver?.disconnect();
  observer = watcher = partObserver = null;
  queue = [];
  parts = [];
  whole = organizing = false;
  for (const el of document.querySelectorAll<HTMLElement>('[data-eg-scraped]')) delete el.dataset.egScraped;
  document.getElementById('eg-scrape-style')?.remove();
  bar.hidden = true;
}

// The worker may stop while the reader reads (MV3): the port then drops, so it is opened again for this session.
function connect(): void {
  const mine = session;
  life = chrome.runtime.connect({ name: `scrape:${mine}` });
  life.onDisconnect.addListener(() => void (session === mine && setTimeout(() => session === mine && connect(), 500)));
}

function start(): void {
  stop();
  blocks = new Map();
  sections = [];
  seen = new Set();
  used = calls = skipped = 0;
  noModel = note = '';
  session = crypto.randomUUID();
  connect();
  ui.mount();
  document.head.append(h('style', { id: 'eg-scrape-style', textContent:
    '[data-eg-scraped=table],[data-eg-scraped=list],[data-eg-scraped=facts]{outline:2px dashed rgba(60,140,80,.7)!important;outline-offset:3px}' +
    '[data-eg-scraped=skip]{outline:1px dotted rgba(128,128,128,.6)!important;outline-offset:3px}' }));
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const b = blocks.get(e.target as HTMLElement);
      if (!b) continue;
      b.inView = e.isIntersecting;
      if (e.isIntersecting) enqueue(b);
    }
    void pump();
  }, { rootMargin: '200px 0px' });
  // New content (an infinite feed, a "load more" the reader clicked): only what was added, when the page is idle.
  let added: Element[] = [];
  let near: Element[] = [];
  let pending = false;
  watcher = new MutationObserver((records) => {
    for (const r of records) {
      const nodes = r.type === 'characterData' ? [r.target.parentElement] : [...r.addedNodes];
      for (const n of nodes) if (n instanceof Element && !n.closest('edge-gallery')) {
        if (r.type === 'childList') added.push(n);
        for (let p = r.type === 'childList' ? n.parentElement : n, i = 0; p && i < 3; p = p.parentElement, i++) near.push(p); // a grid gets a new card
      }
    }
    if (pending || !(added.length || near.length)) return;
    pending = true;
    const later = (f: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(f, { timeout: 1500 }) : setTimeout(f, 500));
    later(() => {
      pending = false;
      const roots = [...new Set(added)].filter((n) => n.isConnected);
      const parents = [...new Set(near)].filter((n) => n.isConnected);
      added = [];
      near = [];
      if (observer) scan(roots, parents);
    });
  });
  watcher.observe(document.body, { childList: true, characterData: true, subtree: true }); // recycled rows change text
  scan([document.body]);
  bar.hidden = false;
  setWhole(false);
}

export function install(): void {
  if (window !== top) return;
  ui.style(`.sasbar{position:fixed;right:18px;bottom:18px;display:flex;gap:4px;align-items:center;padding:4px;border-radius:10px;
    background:var(--bg);color:var(--fg);border:1px solid var(--line);box-shadow:var(--shadow-menu)}
    .sasbar span{color:var(--muted);font-size:11px;padding:0 6px;max-width:300px}
    .sasbar [aria-pressed=true]{background:var(--accent);color:var(--bg)} pre.sasmd{white-space:pre-wrap;font-size:11px;max-height:160px;overflow:auto;margin:0}
    table.sas{border-collapse:collapse;font-size:11px} table.sas th,table.sas td{border:1px solid var(--line);padding:2px 4px;text-align:left;vertical-align:top}`);
  const download = () => {
    const rows = allRows();
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    h('a', { href: URL.createObjectURL(new Blob([toCsv(keys, rows)], { type: 'text/csv' })), download: 'collected.csv' }).click();
  };
  bar = h('div', { className: 'sasbar', hidden: true, attrs: { role: 'toolbar', 'aria-label': 'Scrape as you scroll' } },
    h('button', { textContent: 'Show', onclick: show }),
    h('button', { textContent: 'Whole page', dataset: { whole: '' }, attrs: { 'aria-pressed': 'false', title: 'Also keep every section\'s text and Markdown' }, onclick: () => setWhole(!whole) }),
    h('button', { textContent: 'Organize', hidden: true, dataset: { organize: '' }, attrs: { title: 'Put the captured sections into tables (the model on this device)' }, onclick: () => void organize() }),
    h('button', { textContent: 'Copy JSON', onclick: () => void navigator.clipboard.writeText(JSON.stringify(asJson(), null, 2)) }),
    h('button', { textContent: 'CSV', onclick: download }),
    h('button', { textContent: '✕', attrs: { 'aria-label': 'Stop collecting' }, onclick: stop }),
    h('span'));
  ui.root.append(bar);
  ui.actions.page.push({ label: 'Scrape as you scroll', run: start });
}
