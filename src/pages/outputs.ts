// Outputs (plan T9): one artifact by ?id (a table or chart, a brief, a deck, a one-pager, a brand kit) with its
// exports, or every artifact (Library → Outputs). Data lives in the worker's `hg-outputs` store.
import { $, busyButton, button, emptyPot } from './shell.ts';
import { h } from '../ui/dom.ts';
import { chart, kpis, toPng } from '../ui/chart.ts';
import { bg } from '../shared/protocol.ts';
import { markdownWithTables } from '../domain/markdown.ts';
import { toCsv } from '../domain/csv.ts';
import { pptx } from '../domain/pptx.ts';
import { deckFromTable, parseCell, type Artifact, type Brand, type Cell, type Slide } from '../domain/outputs.ts';

const KINDS: Record<Artifact['kind'], string> = { table: 'Table', chart: 'Chart', deck: 'Deck', onepager: 'One-pager', brief: 'Brief', brand: 'Brand kit' };
const out = $('#out');
const bar = $('#actions');
const say = (t: string) => ($('#status').textContent = t);
const attempt = (fn: () => Promise<unknown>) => async () => {
  say('');
  try {
    await fn();
  } catch (e) {
    say((e as Error).message);
  }
};
const act = (label: string, fn: () => Promise<unknown>) => busyButton(label, attempt(fn), 'secondary');
const download = (blob: Blob, name: string) => h('a', { href: URL.createObjectURL(blob), download: name }).click();
const fileName = (a: Artifact, ext: string) => `${a.title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60) || 'output'}.${ext}`;
const store = (a: Partial<Artifact>) => bg<Artifact>('artifactSave', { artifact: a });
type Of<K extends Artifact['kind']> = Extract<Artifact, { kind: K }>;
const go = (a: Artifact) => (location.href = `outputs.html?id=${encodeURIComponent(a.id)}`);

// ---- the list ----

async function list(): Promise<void> {
  const items = await bg<Artifact[]>('artifactList');
  const url = h('input', { type: 'url', placeholder: 'https://example.com', ariaLabel: 'Site for a brand kit' });
  const title = h('input', { placeholder: 'Title', ariaLabel: 'Brief title' });
  const md = h('textarea', { rows: 6, placeholder: '## A heading\n- a point', ariaLabel: 'Brief' });
  bar.replaceChildren(
    h('form', { className: 'row', onsubmit: (e: Event) => e.preventDefault() }, url, act('Brand kit from a site', async () => {
      say('Reading the site’s colours and fonts…');
      go(await bg<Artifact>('brandRead', { url: url.value.trim() }));
    })));
  out.replaceChildren(
    h('ul', { className: 'items' }, ...(items.length ? items.map((a) => h('li', {},
      h('span', { className: 't' }, h('a', { href: `outputs.html?id=${encodeURIComponent(a.id)}`, textContent: a.title || 'Untitled' }),
        h('span', { className: 'muted small', textContent: ` · ${KINDS[a.kind]} · ${new Date(a.at).toLocaleString()}` })),
      act('Delete', async () => (await bg('artifactDelete', { id: a.id }), list())))) : [emptyPot('No outputs yet. Research reports, mission tables and decks show up here.')])),
    h('details', { className: 'no-print' }, h('summary', { textContent: 'Write a brief' }), title, md,
      act('Save brief', async () => go(await store({ kind: 'brief', title: title.value.trim() || 'Brief', data: { md: md.value } })))));
}

// ---- tables and charts ----

const cmp = (a: Cell, b: Cell) => Number(a == null) - Number(b == null) || (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? '')));

function showTable(a: Of<'table' | 'chart'>): void {
  const t = a.data;
  let view: 'table' | 'bar' | 'line' = a.kind === 'chart' ? 'bar' : 'table';
  let sort: { col: number; dir: 1 | -1 } | null = null;
  // Each change is stored at once, in order; Make deck waits for the last one, so it never reads a stale table.
  let saving: Promise<unknown> = Promise.resolve();
  const persist = () => (saving = saving.then(() => store({ ...a, kind: view === 'table' ? 'table' : 'chart' })).then(() => say('Saved ✓'), (e: Error) => say(e.message)));
  const segmented = h('div', { className: 'segmented', role: 'group', ariaLabel: 'View' });
  const render = () => {
    segmented.replaceChildren(...(['table', 'bar', 'line'] as const).map((v) => h('button', {
      type: 'button', textContent: { table: 'Table', bar: 'Bars', line: 'Line' }[v], attrs: { 'aria-pressed': String(view === v) },
      onclick: () => ((view = v), persist(), render()),
    })));
    if (view !== 'table') return out.replaceChildren(kpis(t), h('div', { className: 'chart' }, chart(t, view)));
    const head = h('tr', {}, ...t.columns.map((c, i) => h('th', {
      textContent: `${c.replace(/_/g, ' ')}${sort?.col === i ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}`,
      onclick: () => {
        sort = { col: i, dir: sort?.col === i ? (-sort.dir as 1 | -1) : 1 };
        const { col, dir } = sort;
        t.rows.sort((x, y) => cmp(x[col]!, y[col]!) * dir);
        persist();
        render();
      },
    })), h('th', {}));
    const body = t.rows.map((r, ri) => h('tr', {}, ...t.columns.map((c, ci) => h('td', {}, h('input', {
      value: String(r[ci] ?? ''), ariaLabel: `${c} in row ${ri + 1}`,
      onchange: (e) => ((r[ci] = parseCell((e.target as HTMLInputElement).value)), persist()),
    }))), h('td', { className: 'del' }, button('×', () => (t.rows.splice(ri, 1), persist(), render())))));
    out.replaceChildren(h('div', { className: 'table-wrap' }, h('table', {}, h('thead', {}, head), h('tbody', {}, ...body))),
      h('p', { className: 'no-print' }, button('+ Add row', () => (t.rows.push(t.columns.map(() => null)), persist(), render()), 'secondary')));
  };
  bar.replaceChildren(segmented,
    act('Export CSV', async () => download(new Blob([toCsv(t.columns, t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i]]))))], { type: 'text/csv' }), fileName(a, 'csv'))),
    act('PNG', async () => {
      const { png } = await toPng(chart(t, view === 'line' ? 'line' : 'bar'));
      download(new Blob([png], { type: 'image/png' }), fileName(a, 'png'));
    }),
    act('PPTX', async () => downloadPptx(a, deckFromTable(a.title, t).slides, null)),
    act('Make deck', async () => (await saving, go(await bg<Artifact>('deckMake', { id: a.id })))));
  render();
}

// ---- briefs, decks and one-pagers ----

async function brands(): Promise<Of<'brand'>[]> {
  return (await bg<Artifact[]>('artifactList')).filter((x): x is Of<'brand'> => x.kind === 'brand');
}

/** The brand kit as CSS variables on `el` (values were checked by `parseBrand`), and its logo. */
function branded(el: HTMLElement, b: Brand | null): HTMLElement {
  el.classList.toggle('branded', !!b);
  if (b) for (const [k, v] of Object.entries({ bg: b.bg, text: b.text, link: b.link, button: b.button, font: b.font, heading: b.headingFont })) el.style.setProperty(`--brand-${k}`, v);
  return el;
}
const logo = (b: Brand | null) => b?.logo && h('img', { className: 'logo', src: b.logo, alt: b.site });

/** A select of brand kits; the choice is saved on the artifact. */
async function brandPicker(a: Artifact & { data: { brandId?: string } }, onChange: () => void): Promise<{ el: HTMLSelectElement; current: () => Brand | null }> {
  const all = await brands();
  const el = h('select', { ariaLabel: 'Brand kit' }, h('option', { value: '', textContent: 'No brand kit' }),
    ...all.map((b) => h('option', { value: b.id, textContent: `Brand: ${b.title}`, selected: b.id === a.data.brandId })));
  el.onchange = () => {
    if (el.value) a.data.brandId = el.value;
    else delete a.data.brandId;
    void store(a).then(onChange, (e: Error) => say(e.message));
  };
  return { el, current: () => all.find((b) => b.id === el.value)?.data ?? null };
}

async function downloadPptx(a: Artifact, slides: Slide[], b: Brand | null): Promise<void> {
  const pictures = await Promise.all(slides.map((s) => (s.chart ? toPng(chart(s.chart, 'bar')) : undefined)));
  download(new Blob([pptx({ slides }, pictures, b ? { bg: b.bg, text: b.text, font: b.font } : {})], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }), fileName(a, 'pptx'));
}

/** The whole page as PNG, with the existing full-page debugger screenshot; the permission is asked on this click. */
async function pagePng(a: Artifact): Promise<void> {
  if (!(await chrome.permissions.request({ permissions: ['debugger'] }))) throw new Error('A PNG of the page needs the debugger permission.');
  document.body.classList.add('shot');
  try {
    download(await (await fetch(await bg<string>('pageShot'))).blob(), fileName(a, 'png'));
  } finally {
    document.body.classList.remove('shot');
  }
}

function showBrief(a: Of<'brief'>): void {
  bar.replaceChildren(
    act('Make deck', async () => go(await bg<Artifact>('deckMake', { id: a.id }))),
    act('One-pager', async () => go(await store({ kind: 'onepager', title: a.title, data: { md: a.data.md } }))),
    act('PDF', async () => print()));
  out.replaceChildren(h('article', { className: 'brief', innerHTML: markdownWithTables(a.data.md) })); // escaped first
}

async function showOnepager(a: Of<'onepager'>): Promise<void> {
  const page = h('article', { className: 'brief' });
  const pick = await brandPicker(a, () => render());
  const render = () => {
    const b = pick.current();
    page.replaceChildren(...[logo(b)].filter((x): x is HTMLImageElement => !!x), h('div', { innerHTML: markdownWithTables(a.data.md) }));
    branded(page, b);
  };
  bar.replaceChildren(pick.el, act('PDF', async () => print()), act('PNG', () => pagePng(a)));
  out.replaceChildren(page);
  render();
}

async function showDeck(a: Of<'deck'>): Promise<void> {
  const pick = await brandPicker(a, () => render());
  const render = () => {
    const b = pick.current();
    out.replaceChildren(h('div', { className: 'slides' }, ...a.data.slides.map((s, i) => branded(h('section', { className: `slide${i === 0 ? ' first' : ''}` },
      h('h2', { textContent: s.title }),
      s.bullets.length > 0 && h('ul', {}, ...s.bullets.map((x) => h('li', { textContent: x }))),
      s.chart && h('div', { className: 'chart' }, chart(s.chart, 'bar')),
      logo(b)), b))));
  };
  bar.replaceChildren(pick.el, act('PDF', async () => print()), act('PPTX', () => downloadPptx(a, a.data.slides, pick.current())), act('PNG', () => pagePng(a)));
  render();
}

function showBrand(a: Of<'brand'>): void {
  const b = a.data;
  const swatch = (name: string, c: string) => h('span', { className: 'swatch' }, h('i', { style: { background: c } }), h('span', { textContent: name }), h('span', { className: 'muted', textContent: c }));
  bar.replaceChildren();
  out.replaceChildren(branded(h('article', { className: 'brief' },
    ...[logo(b)].filter((x): x is HTMLImageElement => !!x),
    h('h2', { textContent: b.site }),
    h('div', { className: 'swatches' }, swatch('Background', b.bg), swatch('Text', b.text), swatch('Link', b.link), swatch('Button', b.button), swatch('Button text', b.buttonText)),
    h('p', { textContent: `Text font: ${b.font}` }), h('p', { textContent: `Heading font: ${b.headingFont}` })), b));
}

async function show(id: string): Promise<void> {
  const a = await bg<Artifact | null>('artifactGet', { id });
  if (!a) return void out.replaceChildren(h('p', { className: 'muted', textContent: 'This output is gone.' }));
  document.title = `${a.title} · Outputs`;
  $('#title').textContent = `${KINDS[a.kind]}: ${a.title}`;
  if (a.kind === 'table' || a.kind === 'chart') showTable(a);
  else if (a.kind === 'brief') showBrief(a);
  else if (a.kind === 'onepager') await showOnepager(a);
  else if (a.kind === 'deck') await showDeck(a);
  else showBrand(a);
}

const id = new URLSearchParams(location.search).get('id');
void (id ? show(id) : list()).catch((e: Error) => say(e.message));
