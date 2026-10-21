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
  const MONEY = /(US\$|CA\$|A\$|C\$|[$€£¥₹₩]|\b(?:USD|EUR|GBP|JPY|INR|CAD|AUD|CHF|SEK|PLN|PKR|AED)\b)\s?(\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)|(\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s?(€|zł|kr|\b(?:USD|EUR|GBP|INR|CHF|SEK|PLN|PKR|AED)\b)/;
  const toNumber = (s) => {
    s = String(s).replace(/\s/g, '');
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
      const prop = (n) => {
        const p = el.querySelector(`[itemprop="${n}"]`);
        return p ? clean(p.getAttribute('content') || p.getAttribute('href') || p.textContent) : '';
      };
      const price = prop('price') || prop('lowPrice');
      if (prop('name')) products.push({ title: prop('name'), price: price ? toNumber(price) : null, currency: prop('priceCurrency'), availability: prop('availability').split('/').pop(), rating: prop('ratingValue') ? toNumber(prop('ratingValue')) : null, url: abs(prop('url') || location.href), via: 'structured' });
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
  function tableRows(t) {
    return [...t.querySelectorAll('tr')].slice(0, 60).map((tr) => [...tr.children].map((c) => clean(c.textContent).slice(0, 200).replace(/\|/g, '/')));
  }
  function tables() {
    return [...document.querySelectorAll('table, [role=table], [role=grid]')].filter(visible).slice(0, 15).map((t) => {
      const rows = t.tagName === 'TABLE' ? tableRows(t) : [...t.querySelectorAll('[role=row]')].slice(0, 60).map((r) => [...r.querySelectorAll('[role=cell],[role=gridcell],[role=columnheader]')].map((c) => clean(c.textContent).slice(0, 200)));
      const head = t.querySelector('thead tr, tr:first-child th') ? rows[0] : null;
      return { caption: clean(t.querySelector('caption')?.textContent), headers: head, rows: head ? rows.slice(1) : rows };
    }).filter((t) => t.rows.length);
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
        const items = members.filter((m) => visible(m) && m.querySelector('a[href]') && clean(m.textContent).length > 15 && clean(m.textContent).length < 3000);
        if (items.length < 3) continue;
        const priced = items.filter((m) => money(m.textContent)).length;
        const imaged = items.filter((m) => m.querySelector('img')).length;
        groups.push({ parent, items, score: items.length * (1 + (2 * priced) / items.length + imaged / items.length) });
      }
    }
    groups.sort((a, b) => b.score - a.score);
    const chosen = [];
    for (const g of groups) {
      if (chosen.some((c) => c.parent.contains(g.parent) || g.parent.contains(c.parent))) continue;
      chosen.push(g);
      if (chosen.length === 3) break;
    }
    return chosen.map((g) => ({
      size: g.items.length,
      items: g.items.slice(0, 60).map((m) => {
        const links = [...m.querySelectorAll('a[href]')].filter((a) => clean(a.textContent).length > 3);
        const heading = m.querySelector('h1,h2,h3,h4,h5,[class*=title i],[class*=name i]');
        const priceEl = m.querySelector('[itemprop=price],[class*=price i],[data-price]');
        const p = money(priceEl?.getAttribute('content') ? `${priceEl.getAttribute('content')} ${m.querySelector('[itemprop=priceCurrency]')?.getAttribute('content') || ''}` : priceEl?.textContent) || money(m.textContent);
        return {
          title: clean(heading?.textContent || links.sort((a, b) => b.textContent.length - a.textContent.length)[0]?.textContent || m.textContent).slice(0, 200),
          url: abs((heading?.closest('a') || heading?.querySelector('a') || links[0] || m.querySelector('a[href]'))?.getAttribute('href') || ''),
          price: p?.price ?? null,
          currency: p?.currency || '',
          rating: rating(m.querySelector('[aria-label*=star i],[aria-label*="out of" i]')?.getAttribute('aria-label') || m.textContent),
          image: abs(m.querySelector('img')?.currentSrc || m.querySelector('img')?.src || ''),
          text: clean(m.textContent).slice(0, 400),
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

  self.__hgReadPage = async ({ scroll = true } = {}) => {
    if (scroll) await autoscroll();
    const main = mainContent();
    return {
      url: location.href,
      title: document.title,
      site: document.querySelector('meta[property="og:site_name"]')?.content || location.hostname.replace(/^www\./, ''),
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
