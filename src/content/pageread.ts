// The page reader: builds a PageModel from the live DOM. Bundled with Readability into dist/pageread.js and
// injected (all frames) into a page a mission reads; exposes self.__hgReadPage(options).
// Layers, cheapest and most reliable first: published structured data, main content as markdown, tables, repeated
// item blocks (product grids, result lists). The model reads only what these layers can't answer.
import { Readability } from '@mozilla/readability';
import type { PageList, PageModel, PageRecord, PageTable, ReadOptions } from '../shared/pagemodel.ts';
import { money, rating, toNumber } from './money.ts';
import { scrape } from './scrape.ts';

const clean = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();
const abs = (u: string | null | undefined): string => {
  try {
    return new URL(u ?? '', location.href).href;
  } catch {
    return '';
  }
};
function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- 1. structured data: JSON-LD, microdata, Open Graph ----

type Json = Record<string, unknown>;
const asObj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

function offerOf(o: Json): Pick<PageRecord, 'price' | 'currency' | 'availability'> {
  const first = asObj(asArr(o.offers)[0]);
  const inner = asObj(asArr(first.offers)[0]);
  const spec = asObj(first.priceSpecification);
  const price = first.price ?? first.lowPrice ?? inner.price ?? spec.price;
  return {
    price: price != null ? toNumber(price) : null,
    currency: String(first.priceCurrency ?? inner.priceCurrency ?? spec.priceCurrency ?? ''),
    availability: String(first.availability ?? '').split('/').pop() ?? '',
  };
}

function structured(): PageModel['structured'] {
  const products: PageRecord[] = [];
  const other: Record<string, string>[] = [];
  const flat = (o: Json) => Object.fromEntries(Object.entries(o).filter(([k, v]) => !k.startsWith('@') && (typeof v !== 'object' || v === null)).map(([k, v]) => [k, clean(v)]).slice(0, 15));
  const visit = (v: unknown, depth = 0): void => {
    if (!v || typeof v !== 'object' || depth > 6) return;
    if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1));
    const o = v as Json;
    const types = asArr(o['@type']).map(String);
    if (types.includes('Product') || types.includes('ProductGroup')) {
      const agg = asObj(o.aggregateRating);
      const image = asArr(o.image)[0];
      products.push({
        title: clean(o.name),
        ...offerOf(o),
        rating: agg.ratingValue != null ? toNumber(agg.ratingValue) : null,
        reviews: (agg.reviewCount ?? agg.ratingCount ?? null) as number | string | null,
        brand: clean(asObj(o.brand).name ?? o.brand),
        sku: clean(o.sku ?? o.mpn ?? o.gtin13 ?? ''),
        gtin: clean(o.gtin13 ?? o.gtin12 ?? o.gtin14 ?? o.gtin8 ?? o.gtin ?? ''),
        mpn: clean(o.mpn ?? ''),
        url: abs(String(o.url ?? location.href)),
        image: abs(String(asObj(image).url ?? image ?? '')),
        via: 'structured',
      });
    } else if (types.length) other.push({ type: types.join(','), ...flat(o) });
    for (const k of ['@graph', 'itemListElement', 'item', 'mainEntity', 'hasVariant', 'isRelatedTo']) visit(o[k], depth + 1);
  };
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      visit(JSON.parse(s.textContent ?? ''));
    } catch {
      // A broken JSON-LD block is the page's problem; the other layers still read it.
    }
  }
  // Microdata products (itemprop): common on older shops. Content attribute first, then visible text.
  for (const el of document.querySelectorAll('[itemscope][itemtype*="schema.org/Product"]')) {
    const prop = (n: string) => {
      const p = el.querySelector(`[itemprop="${n}"]`);
      return p ? clean(p.getAttribute('content') ?? p.textContent) : '';
    };
    const link = el.querySelector('[itemprop=url], a[itemprop=name], a[href]');
    const price = prop('price') || prop('lowPrice');
    const name = el.querySelector('[itemprop=name]')?.getAttribute('title') ?? prop('name');
    if (name) {
      products.push({ title: name, price: price ? toNumber(price) : null, currency: prop('priceCurrency') || money(price)?.currency || '', availability: prop('availability').split('/').pop() ?? '',
        rating: prop('ratingValue') ? toNumber(prop('ratingValue')) : null, url: abs(link?.getAttribute('href') ?? location.href), via: 'structured' });
    }
  }
  const meta: Record<string, string> = {};
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[property], meta[name]')) {
    const k = m.getAttribute('property') ?? m.getAttribute('name') ?? '';
    if (/^(og:|product:|twitter:|description$|author$|article:)/.test(k) && m.content) meta[k] = clean(m.content).slice(0, 300);
  }
  if (!products.length && meta['product:price:amount']) {
    products.push({ title: meta['og:title'] ?? document.title, price: toNumber(meta['product:price:amount']), currency: meta['product:price:currency'] ?? '', url: location.href, via: 'structured' });
  }
  return { products: products.slice(0, 40), other: other.slice(0, 20), meta };
}

// ---- 2. main content as markdown ----

// Rendered text without footnote markers like [2] or [note 2].
const cell = (c: Element): string => clean(((c as HTMLElement).innerText ?? c.textContent ?? '').replace(/\[(?:\d+|[a-z]|note \d+|citation needed)\]/gi, '')).slice(0, 200).replace(/\|/g, '/');
const tableRows = (t: Element): string[][] => [...t.querySelectorAll('tr')].slice(0, 200).map((tr) => [...tr.children].map(cell));

function toMarkdown(root: Node): string {
  const walk = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return clean(n.textContent) ? (n.textContent ?? '').replace(/\s+/g, ' ') : '';
    if (n.nodeType !== Node.ELEMENT_NODE) return '';
    const el = n as Element;
    const tag = el.tagName.toLowerCase();
    if (/^(script|style|noscript|svg|button|form|nav|footer)$/.test(tag)) return '';
    const inner = () => [...el.childNodes].map(walk).join('');
    if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${clean(inner())}\n\n`;
    if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article') return `\n\n${inner()}\n\n`;
    if (tag === 'br') return '\n';
    if (tag === 'li') return `\n- ${clean(inner())}`;
    if (tag === 'ul' || tag === 'ol') return `\n${inner()}\n`;
    if (tag === 'a') {
      const t = clean(inner());
      const h = el.getAttribute('href');
      return t && h && !h.startsWith('#') && !h.startsWith('javascript:') ? `[${t}](${abs(h)})` : t;
    }
    if (tag === 'img') return (el as HTMLImageElement).alt ? `![${clean((el as HTMLImageElement).alt)}]` : '';
    if (tag === 'table') return `\n\n${tableRows(el).map((r) => `| ${r.join(' | ')} |`).join('\n')}\n\n`;
    if (tag === 'pre') return `\n\n\`\`\`\n${el.textContent}\n\`\`\`\n\n`;
    if (tag === 'strong' || tag === 'b') return `**${inner()}**`;
    return inner();
  };
  return walk(root).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function mainContent(): { markdown: string; via: PageModel['mainVia'] } {
  try {
    const art = new Readability(document.cloneNode(true) as Document, { charThreshold: 300 }).parse();
    if (art?.content && clean(art.textContent).length > 400) {
      return { markdown: toMarkdown(new DOMParser().parseFromString(art.content, 'text/html').body), via: 'readability' };
    }
  } catch {
    // Readability gives up on some app-like pages; the fallback below reads them.
  }
  // Not an article (shop, app, listing): the main region instead.
  return { markdown: toMarkdown(document.querySelector('main, [role=main], article') ?? document.body), via: 'main' };
}

// ---- 3. tables ----

// Header rows (all <th>) at the top, merged per column with colspans expanded: "Population | City proper".
function headerOf(t: Element): { headers: string[]; skip: number } | null {
  const top: Element[] = [];
  for (const tr of t.querySelectorAll('tr')) {
    if (!tr.children.length || [...tr.children].some((c) => c.tagName !== 'TH')) break;
    top.push(tr);
    if (top.length === 3) break;
  }
  if (!top.length) return null;
  const cols: (string | undefined)[][] = [];
  top.forEach((tr, ri) => {
    let i = 0;
    for (const c of tr.children) {
      while (cols[i]?.[ri] !== undefined) i++; // filled by a rowspan above
      const span = Number(c.getAttribute('colspan')) || 1;
      for (let k = 0; k < span; k++) {
        for (let r = ri; r < ri + (Number(c.getAttribute('rowspan')) || 1) && r < top.length; r++) (cols[i + k] ??= [])[r] = cell(c);
      }
      i += span;
    }
  });
  return { headers: cols.map((parts) => [...new Set((parts ?? []).filter((x): x is string => !!x))].join(' | ')), skip: top.length };
}

function tables(): PageTable[] {
  return [...document.querySelectorAll('table, [role=table], [role=grid]')].filter(visible).slice(0, 15).map((t) => {
    const isTable = t.tagName === 'TABLE';
    const rows = isTable ? tableRows(t) : [...t.querySelectorAll('[role=row]')].slice(0, 200).map((r) => [...r.querySelectorAll('[role=cell],[role=gridcell],[role=columnheader]')].map(cell));
    const merged = isTable ? headerOf(t) : null;
    const head = merged ? merged.headers : t.querySelector('thead tr, tr:first-child th') ? rows[0] ?? null : null;
    // Label | value rows (infoboxes, spec sheets) are facts about the page's subject.
    const two = rows.filter((r): r is [string, string] => r.length === 2 && !!r[0] && !!r[1]);
    const pairs = two.length >= 3 && two.length >= rows.length * 0.4 ? Object.fromEntries(two.map(([k, v]) => [k.toLowerCase(), v])) : null;
    return {
      caption: clean(t.querySelector('caption')?.textContent),
      headers: head,
      rows: head ? rows.slice(merged ? merged.skip : 1) : rows,
      pairs,
      infobox: !!t.closest('.infobox, [class*=infobox i], [class*=spec i], [class*=detail i]'),
    };
  }).filter((t) => t.rows.length);
}

// ---- 4. repeated items (product grids, result lists) ----

// Labelled parts of a block by class / itemprop / data-label: <span class="country-area"> → { 'country-area': …, area: … }.
function parts(m: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const el of m.querySelectorAll('[class], [itemprop], [data-label]')) {
    const v = clean(el.getAttribute('content') ?? el.textContent);
    if (!v || v.length > 200) continue;
    const keys = [...el.classList, el.getAttribute('itemprop'), el.getAttribute('data-label')].filter((k): k is string => !!k).map((k) => k.toLowerCase());
    for (const k of keys) {
      out[k] ??= v;
      for (const w of k.split(/[-_ ]+/)) if (w.length > 2) out[w] ??= v;
    }
    if (Object.keys(out).length > 40) break;
  }
  return out;
}

// Classes with digits (item-1, css-1x2y3z) differ per card, so they don't count towards "the same kind of block".
const signature = (el: Element): string => `${el.tagName}.${[...el.classList].filter((c) => !/\d/.test(c)).sort().slice(0, 3).join('.')}`;

interface Group { parent: Element; items: Element[]; score: number }

function lists(): PageList[] {
  const groups: Group[] = [];
  for (const parent of document.querySelectorAll('body *')) {
    if (parent.children.length < 3 || !visible(parent)) continue;
    const bySig = new Map<string, Element[]>();
    for (const c of parent.children) bySig.set(signature(c), [...(bySig.get(signature(c)) ?? []), c]);
    for (const members of bySig.values()) {
      // A block needs a link or some inner structure (a country card has labelled spans but no link).
      const items = members.filter((m) => visible(m) && (m.querySelector('a[href]') || m.querySelectorAll('*').length >= 2) && clean(m.textContent).length > 15 && clean(m.textContent).length < 3000);
      const first = items[0];
      if (!first || items.length < 3) continue;
      // Rows of a table with header cells are read by tables(), where the headers name the columns.
      if (first.tagName === 'TR' && first.closest('table')?.querySelector('th')) continue;
      const priced = items.filter((m) => money(m.textContent)).length;
      const imaged = items.filter((m) => m.querySelector('img')).length;
      groups.push({ parent, items, score: items.length * (1 + (2 * priced) / items.length + imaged / items.length) });
    }
  }
  // Grids split into rows (.row > .col ×3) show up as many small groups under same-shaped parents: merge them.
  const merged = new Map<string, Group>();
  for (const g of groups) {
    const first = g.items[0]!;
    const key = `${signature(first)}|${signature(g.parent)}|${g.parent.parentElement ? signature(g.parent.parentElement) : ''}`;
    const m = merged.get(key);
    if (m && m.parent.parentElement === g.parent.parentElement) (m.items.push(...g.items), (m.score += g.score));
    else if (!m) merged.set(key, { ...g, items: [...g.items] });
  }
  const ranked = [...merged.values()].sort((a, b) => b.score - a.score);
  const chosen: Group[] = [];
  for (const g of ranked) {
    if (chosen.some((c) => c.parent.contains(g.parent) || g.parent.contains(c.parent))) continue;
    chosen.push(g);
    if (chosen.length === 3) break;
  }
  return chosen.map((g) => ({ size: g.items.length, items: g.items.slice(0, 300).map((m, idx, all) => record(m, all[idx + 1], g.items)) }));
}

function record(m: Element, nextItem: Element | undefined, items: Element[]): PageRecord {
  // Records split over rows (a title row, then a points row): the siblings up to the next block belong to it.
  const extra: Element[] = [];
  for (let n = m.nextElementSibling; n && n !== nextItem && extra.length < 3; n = n.nextElementSibling) if (!items.includes(n)) extra.push(n);
  const whole = [m, ...extra];
  const links = [...m.querySelectorAll('a[href]')].filter((a) => clean(a.textContent).length > 3);
  const heading = m.querySelector('h1,h2,h3,h4,h5,[class*=title i],[class*=name i]');
  const priceEl = m.querySelector('[itemprop=price],[class*=price i],[data-price]');
  const p = money(priceEl?.getAttribute('content') ? `${priceEl.getAttribute('content')} ${m.querySelector('[itemprop=priceCurrency]')?.getAttribute('content') ?? ''}` : priceEl?.textContent) ?? money(m.textContent);
  // Sites cut long names on screen ("Starving Hearts (Triangular ..."); a link's title attribute keeps the full one.
  const longestLink = [...links].sort((a, b) => (b.textContent ?? '').length - (a.textContent ?? '').length)[0];
  // A "title" cell holding only a rank ("1.") isn't the title; the longest link text is.
  const headText = clean(heading?.textContent);
  let title = clean((headText.replace(/[\d.#\s]/g, '').length >= 3 ? headText : '') || longestLink?.textContent || m.textContent);
  const full = m.querySelector('a[title]')?.getAttribute('title');
  if (full && (/(\.\.\.|…)$/.test(title) || full.startsWith(title.replace(/(\.\.\.|…)$/, '').trim()))) title = clean(full);
  const img = m.querySelector('img');
  return {
    title: title.slice(0, 200),
    url: abs((heading?.closest('a') ?? heading?.querySelector('a') ?? longestLink ?? m.querySelector('a[href]'))?.getAttribute('href') ?? ''),
    price: p?.price ?? null,
    currency: p?.currency ?? '',
    rating: rating(m.querySelector('[aria-label*=star i],[aria-label*="out of" i]')?.getAttribute('aria-label') ?? m.textContent),
    image: abs(img?.currentSrc || img?.src || ''),
    text: clean(whole.map((x) => x.textContent).join(' ')).slice(0, 500),
    parts: Object.assign({}, ...whole.map(parts).reverse()) as Record<string, string>,
    via: 'list',
  };
}

// ---- 5. preparing the page: lazy content, shadow DOM, controls ----

async function autoscroll(steps = 8): Promise<void> {
  let last = 0;
  for (let i = 0; i < steps; i++) {
    scrollTo(0, document.body.scrollHeight);
    await sleep(350);
    if (document.body.scrollHeight === last) break;
    last = document.body.scrollHeight;
  }
  scrollTo(0, 0);
}

// Web components keep text in shadow roots, out of reach of querySelector. In a throwaway mission tab each open
// shadow host can be swapped for a plain copy.
function flattenShadow(): void {
  for (let pass = 0; pass < 4; pass++) {
    const hosts = [...document.querySelectorAll('*')].filter((e) => e.shadowRoot);
    if (!hosts.length) return;
    for (const h of hosts) {
      const div = document.createElement('div');
      div.className = `hg-shadow ${h.localName}`;
      div.innerHTML = (h.shadowRoot?.innerHTML ?? '') + h.innerHTML;
      h.replaceWith(div);
    }
  }
}

// Content behind an in-page control ("2015" year tabs, "Show more"): click controls whose text is one of the goal's
// terms, or that expand content. Never links to other pages, submits, or anything inside a form.
async function reveal(terms: string[]): Promise<number> {
  const safe = (el: Element) => !el.closest('form') && (el.tagName !== 'A' || /^(#|javascript:)/.test(el.getAttribute('href') ?? '#')) && !(el.tagName === 'BUTTON' && (el as HTMLButtonElement).type === 'submit');
  const wanted = [...document.querySelectorAll<HTMLElement>('a, button, [role=tab], [role=button], summary')]
    .filter((el) => visible(el) && safe(el))
    .filter((el) => {
      const t = clean(el.textContent).toLowerCase();
      return (terms.length && terms.includes(t)) || /^(show|load|see|view) (more|all)\b|^expand\b|^more\b/.test(t);
    })
    .slice(0, 3);
  for (const el of wanted) {
    const before = document.body.innerText.length;
    el.click();
    for (let i = 0; i < 20 && document.body.innerText.length === before; i++) await sleep(150);
    await sleep(400);
  }
  return wanted.length;
}

export async function readPage({ scroll = true, shadow = false, terms = [] }: ReadOptions = {}): Promise<PageModel> {
  if (shadow) flattenShadow();
  const revealed = terms.length ? await reveal(terms.map((t) => t.toLowerCase())) : 0;
  if (shadow && revealed) flattenShadow();
  if (scroll) await autoscroll();
  const main = mainContent();
  return {
    url: location.href,
    title: document.title,
    site: document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content || location.hostname.replace(/^www\./, ''),
    heading: clean(document.querySelector('h1')?.textContent),
    structured: structured(),
    markdown: main.markdown.slice(0, 60000),
    mainVia: main.via,
    tables: tables(),
    lists: lists(),
    text: clean(document.body.innerText).slice(0, 150000),
  };
}

// Injected entry: one reader per frame, callable by chrome.scripting.executeScript({ func }).
declare global {
  interface Window { __hgReadPage?: typeof readPage; __hgScrape?: typeof scrape }
}
window.__hgReadPage ??= readPage;
window.__hgScrape ??= scrape;
