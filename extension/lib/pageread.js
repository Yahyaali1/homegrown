// Page model for missions. Injected into a page (after vendor/readability.js) with chrome.scripting;
// exposes self.__hgReadPage(options) → { url, title, site, structured, markdown, tables, lists, text }.
// Layers, cheapest and most reliable first: published structured data, main content (Readability) as
// markdown, tables, and repeated item blocks (product grids, result lists). The model reads only what
// these layers can't answer.
(() => {
  if (self.__hgReadPage) return;

  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const abs = (u) => {
    try {
      return new URL(u, location.href).href;
    } catch {
      return '';
    }
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0;
  };

  // "$1,299.99", "1.299,99 €", "EUR 49" → { price: 1299.99, currency: 'USD' }
  const SYMBOL = { $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', '₩': 'KRW', zł: 'PLN', kr: 'SEK', 'A$': 'AUD', 'C$': 'CAD', 'CA$': 'CAD', 'US$': 'USD' };
  const MONEY = /(US\$|CA\$|A\$|C\$|[$€£¥₹₩]|\b(?:USD|EUR|GBP|JPY|INR|CAD|AUD|CHF|SEK|PLN|PKR|AED)\b)\s?(\d+(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?)|(\d+(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?)\s?(€|zł|kr|\b(?:USD|EUR|GBP|INR|CHF|SEK|PLN|PKR|AED)\b)/;
  const toNumber = (s) => {
    s = (/-?\d[\d.,\s]*/.exec(String(s)) || [''])[0].replace(/\s/g, ''); // "$295.99" → "295.99\"
    if (/,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  };
  function money(text) {
    const m = MONEY.exec(text || '');
    if (!m) return null;
    const cur = (m[1] || m[4] || '').trim();
    return { price: toNumber(m[2] || m[3]), currency: SYMBOL[cur] || cur.toUpperCase() };
  }
  const rating = (text) => {
    const m = /(\d(?:[.,]\d)?)\s*(?:out of|\/)\s*5|(\d[.,]\d)\s*(?:stars?|★)/i.exec(text || '');
    return m ? toNumber(m[1] || m[2]) : null;
  };

  // ---- 1. structured data: JSON-LD, microdata, Open Graph ----
  function structured() {
    const products = [];
    const other = [];
    const flat = (o) => Object.fromEntries(Object.entries(o).filter(([k, v]) => !k.startsWith('@') && (typeof v !== 'object' || v === null)).map(([k, v]) => [k, clean(v)]).slice(0, 15));
    const offerOf = (o) => {
      const offers = [].concat(o.offers || []);
      const first = offers[0] || {};
      const inner = [].concat(first.offers || [])[0] || {};
      const price = first.price ?? first.lowPrice ?? inner.price ?? first.priceSpecification?.price;
      return { price: price != null ? toNumber(price) : null, currency: first.priceCurrency || inner.priceCurrency || first.priceSpecification?.priceCurrency || '', availability: String(first.availability || '').split('/').pop() };
    };
    const visit = (o, depth = 0) => {
      if (!o || typeof o !== 'object' || depth > 6) return;
      if (Array.isArray(o)) return o.forEach((x) => visit(x, depth + 1));
      const types = [].concat(o['@type'] || []).map(String);
      if (types.includes('Product') || types.includes('ProductGroup')) {
        products.push({
          title: clean(o.name),
          ...offerOf(o),
          rating: o.aggregateRating?.ratingValue != null ? toNumber(o.aggregateRating.ratingValue) : null,
          reviews: o.aggregateRating?.reviewCount ?? o.aggregateRating?.ratingCount ?? null,
          brand: clean(o.brand?.name || o.brand),
          sku: clean(o.sku || o.mpn || o.gtin13 || ''),
          gtin: clean(o.gtin13 || o.gtin12 || o.gtin14 || o.gtin8 || o.gtin || ''),
          mpn: clean(o.mpn || ''),
          url: abs(o.url || location.href),
          image: abs([].concat(o.image || [])[0]?.url || [].concat(o.image || [])[0] || ''),
          via: 'structured',
        });
      } else if (types.length) other.push({ type: types.join(','), ...flat(o) });
      for (const k of ['@graph', 'itemListElement', 'item', 'mainEntity', 'hasVariant', 'isRelatedTo']) visit(o[k], depth + 1);
    };
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        visit(JSON.parse(s.textContent));
      } catch {}
    }
    // Microdata products (itemprop) — common on older shops.
    for (const el of document.querySelectorAll('[itemscope][itemtype*="schema.org/Product"]')) {
      // content attribute first, then visible text (a name link's href is its URL, not its name).
      const prop = (n) => {
        const p = el.querySelector(`[itemprop="${n}"]`);
        return p ? clean(p.getAttribute('content') || p.textContent) : '';
      };
      const link = el.querySelector('[itemprop=url], a[itemprop=name], a[href]');
      const price = prop('price') || prop('lowPrice');
      const name = el.querySelector('[itemprop=name]')?.getAttribute('title') || prop('name');
      if (name) products.push({ title: name, price: price ? toNumber(price) : null, currency: prop('priceCurrency') || money(price)?.currency || '', availability: prop('availability').split('/').pop(), rating: prop('ratingValue') ? toNumber(prop('ratingValue')) : null, url: abs(link?.getAttribute('href') || location.href), via: 'structured' });
    }
    const meta = {};
    for (const m of document.querySelectorAll('meta[property], meta[name]')) {
      const k = m.getAttribute('property') || m.getAttribute('name');
      if (/^(og:|product:|twitter:|description$|author$|article:)/.test(k) && m.content) meta[k] = clean(m.content).slice(0, 300);
    }
    if (!products.length && meta['product:price:amount']) products.push({ title: meta['og:title'] || document.title, price: toNumber(meta['product:price:amount']), currency: meta['product:price:currency'] || '', url: location.href, via: 'structured' });
    return { products: products.slice(0, 40), other: other.slice(0, 20), meta };
  }

  // ---- 2. main content as markdown ----
  function toMarkdown(root) {
    const out = [];
    const walk = (n, ctx) => {
      if (n.nodeType === 3) return clean(n.textContent) ? n.textContent.replace(/\s+/g, ' ') : '';
      if (n.nodeType !== 1) return '';
      const tag = n.tagName.toLowerCase();
      if (/^(script|style|noscript|svg|button|form|nav|footer)$/.test(tag)) return '';
      const inner = () => [...n.childNodes].map((c) => walk(c, ctx)).join('');
      if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(+tag[1])} ${clean(inner())}\n\n`;
      if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article') return `\n\n${inner()}\n\n`;
      if (tag === 'br') return '\n';
      if (tag === 'li') return `\n- ${clean(inner())}`;
      if (tag === 'ul' || tag === 'ol') return `\n${inner()}\n`;
      if (tag === 'a') {
        const t = clean(inner());
        const h = n.getAttribute('href');
        return t && h && !h.startsWith('#') && !h.startsWith('javascript:') ? `[${t}](${abs(h)})` : t;
      }
      if (tag === 'img') return n.alt ? `![${clean(n.alt)}]` : '';
      if (tag === 'table') return `\n\n${tableRows(n).map((r) => `| ${r.join(' | ')} |`).join('\n')}\n\n`;
      if (tag === 'pre') return `\n\n\`\`\`\n${n.textContent}\n\`\`\`\n\n`;
      if (tag === 'strong' || tag === 'b') return `**${inner()}**`;
      return inner();
    };
    out.push(walk(root, {}));
    return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function mainContent() {
    let html = null;
    try {
      if (typeof Readability === 'function') {
        const art = new Readability(document.cloneNode(true), { charThreshold: 300 }).parse();
        if (art?.content && clean(art.textContent).length > 400) html = art.content;
      }
    } catch {}
    if (html) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return { markdown: toMarkdown(doc.body), via: 'readability' };
    }
    // Not an article (shop, app, listing): the largest visible text block instead.
    const main = document.querySelector('main, [role=main], article') || document.body;
    return { markdown: toMarkdown(main), via: 'main' };
  }

  // ---- 3. tables ----
  // Rendered text (innerText skips <style> inside cells) without footnote markers like [2] or [note 2].
  const cell = (c) => clean((c.innerText ?? c.textContent).replace(/\[(?:\d+|[a-z]|note \d+|citation needed)\]/gi, '')).slice(0, 200).replace(/\|/g, '/');
  function tableRows(t) {
    return [...t.querySelectorAll('tr')].slice(0, 200).map((tr) => [...tr.children].map(cell));
  }
  // Header rows (all <th>) at the top, merged per column with colspans expanded: "Population | City proper".
  function headerOf(t) {
    const rows = [...t.querySelectorAll('tr')];
    const top = [];
    for (const tr of rows) {
      if (!tr.children.length || [...tr.children].some((c) => c.tagName !== 'TH')) break;
      top.push(tr);
      if (top.length === 3) break;
    }
    if (!top.length) return null;
    const cols = [];
    top.forEach((tr, ri) => {
      let i = 0;
      for (const c of tr.children) {
        while (cols[i]?.[ri] !== undefined) i++; // filled by a rowspan above
        for (let k = 0; k < (+c.getAttribute('colspan') || 1); k++) {
          for (let r = ri; r < ri + (+c.getAttribute('rowspan') || 1) && r < top.length; r++) ((cols[i + k] ??= [])[r] = cell(c));
        }
        i += +c.getAttribute('colspan') || 1;
      }
    });
    return { headers: cols.map((parts) => [...new Set((parts || []).filter(Boolean))].join(' | ')), skip: top.length };
  }
  function tables() {
    return [...document.querySelectorAll('table, [role=table], [role=grid]')].filter(visible).slice(0, 15).map((t) => {
      const rows = t.tagName === 'TABLE' ? tableRows(t) : [...t.querySelectorAll('[role=row]')].slice(0, 200).map((r) => [...r.querySelectorAll('[role=cell],[role=gridcell],[role=columnheader]')].map(cell));
      const merged = t.tagName === 'TABLE' ? headerOf(t) : null;
      const head = merged ? merged.headers : t.querySelector('thead tr, tr:first-child th') ? rows[0] : null;
      // Label | value rows (Wikipedia infoboxes, spec sheets) are facts about the page's subject.
      const two = rows.filter((r) => r.length === 2 && r[0] && r[1]);
      const pairs = two.length >= 3 && two.length >= rows.length * 0.4 ? Object.fromEntries(two.map(([k, v]) => [k.toLowerCase(), v])) : null;
      const infobox = !!t.closest?.('.infobox, [class*=infobox i], [class*=spec i], [class*=detail i]');
      return { caption: clean(t.querySelector('caption')?.textContent), headers: head, rows: head ? rows.slice(merged ? merged.skip : 1) : rows, pairs, infobox };
    }).filter((t) => t.rows.length);
  }

  // Labelled parts of a block, by class name / itemprop / data-label: <span class="country-area">,
  // <small class="author">, <td data-label="Price"> → { 'country-area': '…', area: '…', author: '…' }.
  function parts(m) {
    const out = {};
    for (const el of m.querySelectorAll('[class], [itemprop], [data-label]')) {
      const v = clean(el.getAttribute('content') || el.textContent);
      if (!v || v.length > 200) continue;
      const keys = [...el.classList, el.getAttribute('itemprop'), el.getAttribute('data-label')].filter(Boolean).map((k) => k.toLowerCase());
      for (const k of keys) {
        out[k] ??= v;
        for (const w of k.split(/[-_ ]+/)) if (w.length > 2) out[w] ??= v;
      }
      if (Object.keys(out).length > 40) break;
    }
    return out;
  }

  // ---- 4. repeated items (product grids, result lists) ----
  // Classes with digits (item-1, css-1x2y3z) differ per card, so they don't count towards "same kind of block".
  const signature = (el) => `${el.tagName}.${[...el.classList].filter((c) => !/\d/.test(c)).sort().slice(0, 3).join('.')}`;
  function lists() {
    const groups = [];
    for (const parent of document.querySelectorAll('body *')) {
      if (parent.children.length < 3 || !visible(parent)) continue;
      const bySig = new Map();
      for (const c of parent.children) {
        const k = signature(c);
        if (!bySig.has(k)) bySig.set(k, []);
        bySig.get(k).push(c);
      }
      for (const members of bySig.values()) {
        // A block needs a link or some inner structure (a country card has labelled spans but no link).
        const items = members.filter((m) => visible(m) && (m.querySelector('a[href]') || m.querySelectorAll('*').length >= 2) && clean(m.textContent).length > 15 && clean(m.textContent).length < 3000);
        if (items.length < 3) continue;
        // Rows of a table with header cells are read by tables(), where the headers name the columns.
        if (items[0].tagName === 'TR' && items[0].closest('table')?.querySelector('th')) continue;
        const priced = items.filter((m) => money(m.textContent)).length;
        const imaged = items.filter((m) => m.querySelector('img')).length;
        groups.push({ parent, items, score: items.length * (1 + (2 * priced) / items.length + imaged / items.length) });
      }
    }
    // Grids split into rows (Bootstrap .row > .col ×3) show up as many small groups of the same card under
    // same-shaped parents: merge them into one list, in page order.
    const merged = new Map();
    for (const g of groups) {
      const key = `${signature(g.items[0])}|${signature(g.parent)}|${g.parent.parentElement ? signature(g.parent.parentElement) : ''}`;
      const m = merged.get(key);
      if (m && m.parent.parentElement === g.parent.parentElement) (m.items.push(...g.items), (m.score += g.score));
      else if (!m) merged.set(key, { ...g, items: [...g.items] });
    }
    groups.splice(0, groups.length, ...merged.values());
    groups.sort((a, b) => b.score - a.score);
    const chosen = [];
    for (const g of groups) {
      if (chosen.some((c) => c.parent.contains(g.parent) || g.parent.contains(c.parent))) continue;
      chosen.push(g);
      if (chosen.length === 3) break;
    }
    return chosen.map((g) => ({
      size: g.items.length,
      items: g.items.slice(0, 300).map((m, idx, all) => {
        // Records split over rows (Hacker News: title row, then a points row): the siblings between this
        // block and the next one belong to it.
        const extra = [];
        for (let n = m.nextElementSibling; n && n !== all[idx + 1] && extra.length < 3; n = n.nextElementSibling) if (!g.items.includes(n)) extra.push(n);
        const whole = [m, ...extra];
        const links = [...m.querySelectorAll('a[href]')].filter((a) => clean(a.textContent).length > 3);
        const heading = m.querySelector('h1,h2,h3,h4,h5,[class*=title i],[class*=name i]');
        const priceEl = m.querySelector('[itemprop=price],[class*=price i],[data-price]');
        const p = money(priceEl?.getAttribute('content') ? `${priceEl.getAttribute('content')} ${m.querySelector('[itemprop=priceCurrency]')?.getAttribute('content') || ''}` : priceEl?.textContent) || money(m.textContent);
        // Sites cut long names on screen ("Starving Hearts (Triangular ..."); the link's title attribute keeps the full one.
        const longestLink = links.sort((a, b) => b.textContent.length - a.textContent.length)[0];
        // A "title" cell holding only a rank ("1.") isn't the title; the longest link text is.
        const headText = clean(heading?.textContent);
        let title = clean((headText.replace(/[\d.#\s]/g, '').length >= 3 ? headText : '') || longestLink?.textContent || m.textContent);
        const full = m.querySelector('a[title]')?.getAttribute('title');
        if (full && (/(\.\.\.|…)$/.test(title) || full.startsWith(title.replace(/(\.\.\.|…)$/, '').trim()))) title = clean(full);
        return {
          title: title.slice(0, 200),
          url: abs((heading?.closest('a') || heading?.querySelector('a') || longestLink || m.querySelector('a[href]'))?.getAttribute('href') || ''),
          price: p?.price ?? null,
          currency: p?.currency || '',
          rating: rating(m.querySelector('[aria-label*=star i],[aria-label*="out of" i]')?.getAttribute('aria-label') || m.textContent),
          image: abs(m.querySelector('img')?.currentSrc || m.querySelector('img')?.src || ''),
          text: clean(whole.map((x) => x.textContent).join(' ')).slice(0, 500),
          parts: Object.assign({}, ...whole.map(parts).reverse()),
          via: 'list',
        };
      }),
    }));
  }

  // ---- 5. prep: lazy content ----
  async function autoscroll(steps = 8) {
    let last = 0;
    for (let i = 0; i < steps; i++) {
      scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 350));
      if (document.body.scrollHeight === last) break;
      last = document.body.scrollHeight;
    }
    scrollTo(0, 0);
  }

  // Web components keep their text in shadow roots, out of reach of querySelector and innerText. In a
  // background mission tab (closed right after) we can swap each open shadow host for a plain copy.
  function flattenShadow() {
    for (let pass = 0; pass < 4; pass++) {
      const hosts = [...document.querySelectorAll('*')].filter((e) => e.shadowRoot);
      if (!hosts.length) return;
      for (const h of hosts) {
        const div = document.createElement('div');
        div.className = `hg-shadow ${h.localName}`;
        div.innerHTML = h.shadowRoot.innerHTML + h.innerHTML;
        h.replaceWith(div);
      }
    }
  }

  // Content behind an in-page control ("2015" year tabs, "Show more"): click controls whose text is one of
  // the goal's terms, or that expand content — never links to other pages, submits or anything in a form.
  async function reveal(terms) {
    const safe = (el) => !el.closest('form') && (el.tagName !== 'A' || /^(#|javascript:)/.test(el.getAttribute('href') || '#')) && !(el.tagName === 'BUTTON' && el.type === 'submit');
    const controls = [...document.querySelectorAll('a, button, [role=tab], [role=button], summary')].filter((el) => visible(el) && safe(el));
    const wanted = controls.filter((el) => {
      const t = clean(el.textContent).toLowerCase();
      return (terms.length && terms.includes(t)) || /^(show|load|see|view) (more|all)\b|^expand\b|^more\b/.test(t);
    }).slice(0, 3);
    for (const el of wanted) {
      const before = document.body.innerText.length;
      el.click();
      for (let i = 0; i < 20 && document.body.innerText.length === before; i++) await new Promise((r) => setTimeout(r, 150));
      await new Promise((r) => setTimeout(r, 400));
    }
    return wanted.length;
  }

  self.__hgReadPage = async ({ scroll = true, shadow = false, terms = [] } = {}) => {
    if (shadow) flattenShadow();
    const revealed = terms.length ? await reveal(terms.map((t) => String(t).toLowerCase())) : 0;
    if (shadow && revealed) flattenShadow();
    if (scroll) await autoscroll();
    const main = mainContent();
    return {
      url: location.href,
      title: document.title,
      site: document.querySelector('meta[property="og:site_name"]')?.content || location.hostname.replace(/^www\./, ''),
      heading: clean(document.querySelector('h1')?.textContent),
      structured: structured(),
      markdown: main.markdown.slice(0, 60000),
      mainVia: main.via,
      tables: tables(),
      lists: lists(),
      text: clean(document.body.innerText).slice(0, 150000), // for grounding model answers
    };
  };
  self.__hgMoney = money;
})();
