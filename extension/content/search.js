// Web features: an answer card on search result pages, deep research, claim checks and related reading.
// The heavy lifting (search, fetching, per-page notes) runs in bg/web.js; this file is the UI.
(() => {
  const EG = window.EG;
  if (!EG) return;

  const el = (tag, props = {}, ...kids) => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
  };

  // Markdown with [n] citations turned into links to the numbered sources.
  function cited(text, sources) {
    return EG.markdown(text).replace(/\[(\d+)\]/g, (m, n) => {
      const s = sources[n - 1];
      return s ? `<a href="${s.url.replace(/"/g, '%22')}" target="_blank" rel="noopener" title="${s.title.replace(/[<>"&]/g, '')}">[${n}]</a>` : m;
    });
  }
  function sourceList(sources) {
    const ol = document.createElement('ol');
    for (const s of sources) {
      const a = el('a', { href: s.url, target: '_blank', rel: 'noopener', textContent: s.title || s.url });
      ol.append(el('li', {}, a));
    }
    return ol;
  }

  // Runs a long bg job, showing its progress lines ({type:'web-progress', id}) in the card meta.
  async function withProgress(cmd, args, meta) {
    const id = crypto.randomUUID();
    const onMsg = (m) => m.type === 'web-progress' && m.id === id && (meta.textContent = m.text);
    chrome.runtime.onMessage.addListener(onMsg);
    try {
      return await EG.bg(cmd, { ...args, id });
    } finally {
      chrome.runtime.onMessage.removeListener(onMsg);
    }
  }

  function showReport(card, { report, verdict, why, sources }) {
    card.meta.textContent = `${sources.length} sources · read and summarized on this device`;
    card.body.innerHTML = cited(report || verdict || why, sources);
    card.body.append(el('p', { textContent: 'Sources', style: 'font-weight:600;margin-top:8px' }), sourceList(sources));
  }

  async function research(q, rect) {
    const card = EG.openCard(`Research: ${q}`, rect);
    card.body.textContent = 'Searching, reading the top pages and summarizing each one locally. This takes a minute or two.';
    try {
      showReport(card, await withProgress('research', { q }, card.meta));
    } catch (e) {
      card.body.textContent = e.message;
      card.meta.textContent = '';
    }
  }

  // Launcher: Research… asks for a question, then runs deep research.
  EG.actions.page.push({
    label: 'Research…',
    run: ({ rect }) => {
      const card = EG.openCard('Deep research', rect);
      const input = el('input', { placeholder: 'What do you want to research?', ariaLabel: 'Research question' });
      const form = el('form', { style: 'display:flex;gap:4px' }, input, el('button', { className: 'primary', textContent: 'Research' }));
      form.onsubmit = (e) => {
        e.preventDefault();
        if (input.value.trim()) research(input.value.trim(), rect);
      };
      card.body.append(el('p', { textContent: 'Searches the web, reads the top 6 pages and writes a cited report. Page text is processed on this device; the searches go to DuckDuckGo.' }), form);
      input.focus();
    },
  });

  EG.actions.page.push({
    label: 'Related reading',
    run: async ({ page, rect }) => {
      const card = EG.openCard('Related reading', rect);
      card.body.textContent = 'Finding related pages…';
      try {
        showReport(card, await EG.bg('related', { title: page.title, url: page.url }));
      } catch (e) {
        card.body.textContent = e.message;
      }
    },
  });

  EG.actions.text.push({
    label: 'Check claim',
    when: (sel) => sel?.text?.length >= 15,
    run: async ({ selection, rect }) => {
      const card = EG.openCard('Check this claim', rect);
      card.body.textContent = `“${selection.slice(0, 200)}”`;
      try {
        showReport(card, await withProgress('checkClaim', { claim: selection }, card.meta));
      } catch (e) {
        card.body.textContent = e.message;
        card.meta.textContent = '';
      }
    },
  });

  EG.web = { research, cited, sourceList, el };

  // ---- answer beside search results (snippets already on the page, no extra fetches) ----
  const engines = [
    { host: /(^|\.)google\.[a-z.]+$/, path: /^\/search/, results: '#rso [data-hveid]:has(h3), #rso .g' },
    { host: /(^|\.)bing\.com$/, path: /^\/search/, results: '#b_results > li.b_algo' },
    { host: /(^|\.)duckduckgo\.com$/, path: /^\/(html\/?)?$/, results: '[data-testid="result"], .result.results_links' },
  ];
  const se = engines.find((e) => e.host.test(location.hostname) && e.path.test(location.pathname));
  const q = new URLSearchParams(location.search).get('q');
  if (!se || !q || window !== window.top) return;

  let done = false;
  async function answer() {
    const blocks = [...new Set([...document.querySelectorAll(se.results)].map((b) => b.closest(se.results)))]
      .map((b) => b.innerText.replace(/\s+/g, ' ').trim())
      .filter((t) => t.length > 40)
      .slice(0, 6);
    if (!blocks.length) return;
    done = true;
    const card = EG.openCard(`Answer: ${q}`, EG.topRect());
    const out = el('div', { className: 'cursor' });
    card.body.append(out);
    const more = el('button', { textContent: 'Read top results', onclick: () => research(q, EG.topRect()) });
    try {
      let raw = '';
      const r = await EG.generate(
        {
          task: { kind: 'text', prompt: `Answer the search "${q}" in 2 to 4 sentences using only the numbered results below, citing them like [1]. If they don't answer it, say so.` },
          selection: blocks.map((b, i) => `[${i + 1}] ${b.slice(0, 500)}`).join('\n\n'),
        },
        (t) => (out.innerHTML = EG.markdown((raw += t))),
      );
      out.className = '';
      card.meta.textContent = `From the results on this page · ${r.stats.decodeTps} tok/s · on this device`;
    } catch (e) {
      out.className = 'err';
      out.textContent = e.message;
    }
    card.actions.append(more);
  }
  // Results render late on Google and DuckDuckGo; try a few times.
  EG.onSettings((s) => {
    if (!('toolbar' in s) || done || s.searchAnswers === false || !EG.enabled()) return;
    let tries = 0;
    const t = setInterval(() => (done || ++tries > 10 ? clearInterval(t) : answer()), 800);
  });

})();
