// Web features: an answer above search results, deep research, claim checks and related reading. The heavy lifting
// (search, fetching, per-page notes) runs in the worker (background/web.ts); this is the UI.
import { ui, type Card, type Rect } from '../core.ts';
import { h } from '../../ui/dom.ts';
import { cited, type Source } from '../cite.ts';

const sourceList = (sources: Source[]) =>
  h('ol', {}, ...sources.map((s) => h('li', {}, h('a', { href: /^https?:/i.test(s.url) ? s.url : '#', target: '_blank', rel: 'noopener', textContent: s.title || s.url }))));

/** Runs a long worker job, showing its progress lines ({type:'web-progress', id}) in the card's meta line. */
async function withProgress<T>(cmd: string, args: Record<string, unknown>, meta: HTMLElement): Promise<T> {
  const id = crypto.randomUUID();
  const onMsg = (m: { type?: string; id?: string; text?: string }) => {
    if (m.type === 'web-progress' && m.id === id) meta.textContent = m.text ?? '';
  };
  chrome.runtime.onMessage.addListener(onMsg);
  try {
    return await ui.bg<T>(cmd, { ...args, id });
  } finally {
    chrome.runtime.onMessage.removeListener(onMsg);
  }
}

interface Report { report?: string; verdict?: string; why?: string; sources: Source[] }
function showReport(card: Card, { report, verdict, why, sources }: Report): void {
  card.meta.textContent = `${sources.length} sources · read and summarized on this device`;
  card.body.innerHTML = cited(report || verdict || why || '', sources); // escaped first (cite.ts)
  card.body.append(h('p', { textContent: 'Sources', style: 'font-weight:600;margin-top:8px' }), sourceList(sources));
}
const failed = (card: Card, e: unknown) => ((card.body.textContent = (e as Error).message), (card.meta.textContent = ''));

/** Deep research: search, read the top pages, write a cited report. */
export async function research(q: string, rect: Rect): Promise<void> {
  const card = ui.openCard(`Research: ${q}`, rect);
  card.body.textContent = 'Searching, reading the top pages and summarizing each one locally. This takes a minute or two.';
  try {
    showReport(card, await withProgress<Report>('research', { q }, card.meta));
  } catch (e) {
    failed(card, e);
  }
}

const ENGINES = [
  { host: /(^|\.)google\.[a-z.]+$/, path: /^\/search/, results: '#rso [data-hveid]:has(h3), #rso .g' },
  { host: /(^|\.)bing\.com$/, path: /^\/search/, results: '#b_results > li.b_algo' },
  { host: /(^|\.)duckduckgo\.com$/, path: /^\/(html\/?)?$/, results: '[data-testid="result"], .result.results_links' },
];

/** An answer beside search results, from the snippets already on the page (no extra fetches). */
function searchAnswers(): void {
  const se = ENGINES.find((e) => e.host.test(location.hostname) && e.path.test(location.pathname));
  const q = new URLSearchParams(location.search).get('q');
  if (!se || !q || window !== top) return;
  let done = false;
  async function answer(): Promise<void> {
    const blocks = [...new Set([...document.querySelectorAll<HTMLElement>(se!.results)].map((b) => b.closest<HTMLElement>(se!.results)!))]
      .map((b) => b.innerText.replace(/\s+/g, ' ').trim())
      .filter((t) => t.length > 40)
      .slice(0, 6);
    if (!blocks.length) return;
    done = true;
    const card = ui.openCard(`Answer: ${q}`, ui.topRect());
    const out = h('div', { className: 'cursor' });
    card.body.append(out);
    try {
      let raw = '';
      const r = await ui.generate({
        quiet: true, // runs on its own on every results page: background lane
        task: { kind: 'text', prompt: `Answer the search "${q}" in 2 to 4 sentences using only the numbered results below, citing them like [1]. If they don't answer it, say so.` },
        selection: blocks.map((b, i) => `[${i + 1}] ${b.slice(0, 500)}`).join('\n\n'),
      }, (t) => (out.innerHTML = ui.markdown((raw += t))));
      out.className = '';
      card.meta.textContent = `From the results on this page · ${r.stats.decodeTps} tok/s · on this device`;
    } catch (e) {
      out.className = 'err';
      out.textContent = (e as Error).message;
    }
    card.actions.append(h('button', { textContent: 'Read top results', onclick: () => void research(q!, ui.topRect()) }));
  }
  // Results render late on Google and DuckDuckGo: try a few times.
  ui.onSettings((s) => {
    if (done || !s.searchAnswers || !ui.enabled()) return;
    let tries = 0;
    const t = setInterval(() => (done || ++tries > 10 ? clearInterval(t) : void answer()), 800);
  });
}

export function install(): void {
  ui.actions.page.push({
    label: 'Research…',
    run: ({ rect }) => {
      const card = ui.openCard('Deep research', rect);
      const input = h('input', { placeholder: 'What do you want to research?', attrs: { 'aria-label': 'Research question' } });
      const form = h('form', { style: 'display:flex;gap:4px' }, input, h('button', { className: 'primary', textContent: 'Research' }));
      form.onsubmit = (e) => {
        e.preventDefault();
        if (input.value.trim()) void research(input.value.trim(), rect);
      };
      card.body.append(h('p', { textContent: 'Searches the web, reads the top 6 pages and writes a cited report. Page text is processed on this device; the searches go to DuckDuckGo.' }), form);
      input.focus();
    },
  });
  ui.actions.page.push({
    label: 'Related reading',
    run: async ({ page, rect }) => {
      const card = ui.openCard('Related reading', rect);
      card.body.textContent = 'Finding related pages…';
      try {
        showReport(card, await ui.bg<Report>('related', { title: page.title, url: page.url }));
      } catch (e) {
        failed(card, e);
      }
    },
  });
  ui.actions.text.push({
    label: 'Check claim',
    when: (sel) => (sel?.text.length ?? 0) >= 15,
    run: async ({ selection, rect }) => {
      const card = ui.openCard('Check this claim', rect);
      card.body.textContent = `“${selection.slice(0, 200)}”`;
      try {
        showReport(card, await withProgress<Report>('checkClaim', { claim: selection }, card.meta));
      } catch (e) {
        failed(card, e);
      }
    },
  });
  searchAnswers();
}
