// Mission entry points on the page: "Mission…" in the launcher, "Find the best price" for a selected product name,
// and price chips on product pages (JSON-LD Product). Missions plan and run in the worker; Mission control shows them.
import { ui } from '../core.ts';
import { h } from '../../ui/dom.ts';

export interface PageProduct { name: string; price: number; currency: string; url: string; gtin: string; mpn: string; sku: string; brand: string }

/** The product a page publishes as JSON-LD, or null. */
export function productOf(doc: Document, url: string): PageProduct | null {
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const stack: unknown[] = [JSON.parse(s.textContent ?? '')];
      while (stack.length) {
        const o = stack.pop();
        if (!o || typeof o !== 'object') continue;
        if (Array.isArray(o)) {
          stack.push(...o);
          continue;
        }
        const r = o as Record<string, unknown>;
        if (([] as unknown[]).concat(r['@type'] ?? []).includes('Product') && r.name) {
          const offer = ([] as Record<string, unknown>[]).concat((r.offers as Record<string, unknown>) ?? [])[0];
          const brand = r.brand as { name?: string } | string | undefined;
          return {
            name: String(r.name), price: Number(offer?.price ?? offer?.lowPrice), currency: String(offer?.priceCurrency ?? ''), url,
            gtin: String(r.gtin13 ?? r.gtin12 ?? r.gtin14 ?? r.gtin8 ?? r.gtin ?? offer?.gtin13 ?? ''), mpn: String(r.mpn ?? ''), sku: String(r.sku ?? offer?.sku ?? ''),
            brand: String((typeof brand === 'object' ? brand?.name : brand) ?? ''),
          };
        }
        stack.push(r['@graph'], r.mainEntity, r.itemListElement);
      }
    } catch {}
  }
  return null;
}

const open = (goal: string, run: boolean) => ui.bg('agentOpen', { goal, run, context: `${document.title} (${location.href})` });

interface PriceNews { cheaper: { price: number; host: string; url: string } | null; lowest: { price: number; host: string; url: string } | null; lastHere: { price: number; at: number } | null }

function priceChips(p: PageProduct): void {
  const { name, price, currency } = p;
  ui.mount();
  ui.style('.price-chips .note{border-radius:999px;padding:7px 12px;font-size:12px;color:var(--muted);background:var(--panel);box-shadow:var(--shadow-menu);font-weight:400}button.note{color:var(--fg)}');
  ui.style('.price-chips{position:fixed;right:68px;bottom:24px;display:flex;gap:6px}.price-chips button{border-radius:999px;padding:7px 12px;border:1px solid var(--line);background:var(--bg);color:var(--accent);font-weight:600;box-shadow: var(--shadow-menu);cursor:pointer}.price-chips .x{color:var(--muted);font-weight:400;padding:7px 10px}');
  const bar = h('div', { className: 'price-chips' });
  const find = h('button', { textContent: '❀ Find it cheaper', title: `Search other stores for ${name}`, onclick: () => (void open(`Find the lowest price for ${name}`, true), bar.remove()) });
  // Watches this page daily; a notification when the price goes below today's.
  const watch = h('button', { textContent: '🔔 Alert me if it drops', hidden: !Number.isFinite(price) });
  watch.onclick = async () => {
    await ui.bg('missionSave', { mission: {
      id: `drop-${[...location.href].reduce((hash, c) => (hash * 31 + c.charCodeAt(0)) | 0, 0) >>> 0}`, // one per page
      name: `${name.slice(0, 40)} below ${price} ${currency}`.trim(),
      goal: `Watch the price of ${name}`,
      every: 'day',
      alert: { field: 'price', op: '<', value: String(price) },
      steps: [{ type: 'search', query: '1 page', n: 1, urls: [location.href] }, { type: 'open', limit: 1 }, { type: 'extract', fields: ['product', 'price'], require: [] }, { type: 'answer', question: 'What is the price now?' }],
    } });
    watch.textContent = '🔔 Watching daily ✓';
    watch.disabled = true;
  };
  const x = h('button', { className: 'x', textContent: '✕', title: 'Dismiss', onclick: () => bar.remove() });
  bar.append(find, watch, x);
  ui.root.append(bar);

  // Shopping sense: the price memory says what's worth knowing; the opt-in check looks for this exact item elsewhere.
  if (!Number.isFinite(price)) return;
  const note = (text: string, href?: string) =>
    bar.insertBefore(href ? h('button', { className: 'note', textContent: text, onclick: () => window.open(href, '_blank') }) : h('span', { className: 'note', textContent: text }), x);
  const money = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`;
  ui.bg<PriceNews>('priceSeen', { product: p }).then((r) => {
    if (r.cheaper) note(`${money(r.cheaper.price)} at ${r.cheaper.host}`, r.cheaper.url);
    else if (r.lowest) note(`Lowest you've seen: ${money(r.lowest.price)} at ${r.lowest.host}`, r.lowest.url);
    if (r.lastHere && r.lastHere.price !== price) note(`${r.lastHere.price > price ? '↓' : '↑'} ${money(Math.abs(r.lastHere.price - price))} since ${new Date(r.lastHere.at).toLocaleDateString()}`);
    // Only if you stay: a page you skim past costs nothing.
    if (ui.settings.shoppingSense && !r.cheaper) setTimeout(() => document.visibilityState === 'visible' && void ui.bg('shopCheck', { product: p }), 8000);
  }).catch(() => {});
}

export function install(): void {
  if (window !== top) return;
  ui.actions.page.unshift({
    label: 'Mission…',
    run: () => {
      const goal = prompt('What should I find out? (e.g. the cheapest place to buy this, or compare the top 5 options)');
      if (goal?.trim()) void open(goal.trim(), true);
    },
  });
  ui.actions.text.push({ label: 'Find the best price', run: ({ selection }) => open(`Find the lowest price for ${selection.slice(0, 120)}`, true) });
  setTimeout(() => {
    const p = productOf(document, location.href);
    if (p && ui.enabled() && ui.settings.priceChip) priceChips(p);
  }, 2500);
}
