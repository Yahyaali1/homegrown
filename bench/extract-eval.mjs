// Extraction benchmark on real pages: each case runs as a mission (read → extract → rank) and is scored
// against an answer computed independently from the page HTML here in Node, or a known fact.
// Pages are scraping sandboxes (toscrape, scrapethissite, webscraper.io) and Wikipedia.
// Usage: ./scripts/gpu.sh node bench/extract-eval.mjs
import path from 'node:path';
import fs from 'node:fs';
import { launch, serve, ROOT } from '../tests/harness.mjs';

const html = async (u) => (await fetch(u)).text();
const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const minBy = (xs, f) => xs.reduce((a, b) => (f(b) < f(a) ? b : a));
const maxBy = (xs, f) => xs.reduce((a, b) => (f(b) > f(a) ? b : a));

// Usage: … extract-eval.mjs [tuned|heldout|all]. "tuned" is the set the reader was fixed against;
// "heldout" was written afterwards and is scored before any change made for it.
const SET = process.argv[2] || 'tuned';
const site = await serve(path.join(ROOT, 'tests/fixtures'));

const TUNED = [
  {
    name: 'books.toscrape: cheapest book on the page (product grid)',
    url: 'https://books.toscrape.com/',
    goal: 'Find the cheapest book on this page',
    fields: ['title', 'price'], rank: ['price', 'asc'],
    truth: async (u) => {
      const h = await html(u);
      const books = [...h.matchAll(/<h3><a href="[^"]+" title="([^"]+)">[\s\S]*?price_color">£([\d.]+)</g)].map((m) => ({ name: m[1], value: +m[2] }));
      return minBy(books, (b) => b.value);
    },
  },
  {
    name: 'books.toscrape: price of one book (product page)',
    url: 'https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html',
    goal: 'What is the price of A Light in the Attic?',
    fields: ['title', 'price'], rank: null,
    truth: async () => ({ name: 'A Light in the Attic', value: 51.77 }),
  },
  {
    name: 'webscraper.io: cheapest laptop (product grid)',
    url: 'https://webscraper.io/test-sites/e-commerce/allinone/computers/laptops',
    goal: 'Find the cheapest laptop on this page',
    fields: ['product', 'price'], rank: ['price', 'asc'],
    truth: async (u) => {
      const h = await html(u);
      const items = [...h.matchAll(/itemprop="price">\$([\d.,]+)<[\s\S]*?class="title" title="([^"]+)"/g)].map((m) => ({ name: m[2], value: +m[1].replace(/,/g, '') }));
      return minBy(items, (x) => x.value);
    },
  },
  {
    name: 'scrapethissite: hockey team with most wins in 1990 (table)',
    url: 'https://www.scrapethissite.com/pages/forms/?q=&year=1990',
    goal: 'Which hockey team had the most wins?',
    fields: ['team', 'wins'], rank: ['wins', 'desc'],
    truth: async (u) => {
      const h = await html(u);
      const rows = [...h.matchAll(/<td class="name">([\s\S]*?)<\/td>[\s\S]*?<td class="wins">\s*(\d+)/g)].map((m) => ({ name: strip(m[1]), value: +m[2] }));
      return maxBy(rows, (r) => r.value);
    },
  },
  {
    name: 'scrapethissite: largest country by area (250-item list)',
    url: 'https://www.scrapethissite.com/pages/simple/',
    goal: 'Which country has the largest area?',
    fields: ['country', 'area'], rank: ['area', 'desc'],
    truth: async (u) => {
      const h = await html(u);
      const cs = [...h.matchAll(/country-name">[\s\S]*?<\/i>([\s\S]*?)<\/h3>[\s\S]*?country-area">([\d.E+]+)</g)].map((m) => ({ name: strip(m[1]), value: +m[2] }));
      return maxBy(cs, (c) => c.value);
    },
  },
  {
    name: 'Wikipedia: tallest building and its height (table)',
    url: 'https://en.wikipedia.org/wiki/List_of_tallest_buildings',
    goal: 'Which is the tallest building in the world and how tall is it in metres?',
    fields: ['building', 'height_m'], rank: ['height_m', 'desc'],
    truth: async () => ({ name: 'Burj Khalifa', value: 828 }),
  },
  {
    name: 'Wikipedia: height of the Eiffel Tower (infobox)',
    url: 'https://en.wikipedia.org/wiki/Eiffel_Tower',
    goal: 'How tall is the Eiffel Tower in metres?',
    fields: ['structure', 'height_m'], rank: null,
    // Wikipedia gives both: 300 m architectural, 330 m to the tip. Either is a correct reading of "how tall".
    truth: async () => ({ name: 'Eiffel Tower', value: [300, 330] }),
  },
  {
    name: 'Hacker News: story with the most points (title and points in separate rows)',
    url: 'https://news.ycombinator.com/',
    goal: 'Which story on the front page has the most points?',
    fields: ['story', 'points'], rank: ['points', 'desc'],
    truth: async (u) => {
      const h = await html(u);
      const titles = Object.fromEntries([...h.matchAll(/<tr class="athing[^"]*" id="(\d+)">[\s\S]*?<span class="titleline"><a [^>]*>([\s\S]*?)<\/a>/g)].map((m) => [m[1], strip(m[2])]));
      const scores = [...h.matchAll(/id="score_(\d+)">(\d+) points/g)].map((m) => ({ name: titles[m[1]], value: +m[2] }));
      return maxBy(scores.filter((x) => x.name), (x) => x.value);
    },
  },
  {
    name: 'Wikipedia: population of Iceland (infobox, footnoted number)',
    url: 'https://en.wikipedia.org/wiki/Iceland',
    goal: 'What is the population of Iceland?',
    fields: ['country', 'population'], rank: null,
    truth: async () => ({ name: 'Iceland', range: [370000, 420000] }),
  },
  {
    name: 'quotes.toscrape: who said the first quote on the page (repeated blocks)',
    url: 'https://quotes.toscrape.com/',
    goal: 'List the quotes on this page with their authors',
    fields: ['quote', 'author'], rank: null,
    truth: async (u) => {
      const h = await html(u);
      return { name: strip(/<small class="author"[^>]*>([^<]+)</.exec(h)[1]), field: 'author' };
    },
  },
];

const HELDOUT = [
  {
    name: 'books.toscrape: most expensive travel book (category page)',
    url: 'https://books.toscrape.com/catalogue/category/books/travel_2/index.html',
    goal: 'Find the most expensive travel book', fields: ['title', 'price'], rank: ['price', 'desc'],
    truth: async (u) => maxBy([...(await html(u)).matchAll(/<h3><a href="[^"]+" title="([^"]+)">[\s\S]*?price_color">£([\d.]+)</g)].map((m) => ({ name: m[1], value: +m[2] })), (b) => b.value),
  },
  {
    name: 'webscraper.io: cheapest touch phone (microdata grid)',
    url: 'https://webscraper.io/test-sites/e-commerce/allinone/phones/touch',
    goal: 'Find the cheapest phone', fields: ['phone', 'price'], rank: ['price', 'asc'],
    truth: async (u) => minBy([...(await html(u)).matchAll(/itemprop="price">\$([\d.,]+)<[\s\S]*?class="title" title="([^"]+)"/g)].map((m) => ({ name: m[2], value: +m[1].replace(/,/g, '') })), (x) => x.value),
  },
  {
    name: 'Wikipedia: elevation of Mount Everest (infobox)',
    url: 'https://en.wikipedia.org/wiki/Mount_Everest',
    goal: 'What is the elevation of Mount Everest in metres?', fields: ['mountain', 'elevation_m'], rank: null,
    truth: async () => ({ name: 'Mount Everest', value: 8849 }),
  },
  {
    name: 'quotes.toscrape: author of the first "love" quote (tag page)',
    url: 'https://quotes.toscrape.com/tag/love/',
    goal: 'List the quotes on this page with their authors', fields: ['quote', 'author'], rank: null,
    truth: async (u) => ({ name: strip(/<small class="author"[^>]*>([^<]+)</.exec(await html(u))[1]) }),
  },
  {
    name: 'scrapethissite: Boston Bruins best season by wins (filtered table)',
    url: 'https://www.scrapethissite.com/pages/forms/?q=boston',
    goal: 'In which year did the Boston Bruins win the most games?', fields: ['year', 'wins'], rank: ['wins', 'desc'],
    truth: async (u) => {
      const rows = [...(await html(u)).matchAll(/<td class="year">\s*(\d+)[\s\S]*?<td class="wins">\s*(\d+)/g)].map((m) => ({ name: m[1], value: +m[2] }));
      return maxBy(rows, (r) => r.value);
    },
  },
  {
    name: 'Wikipedia: year Python first appeared (infobox date)',
    url: 'https://en.wikipedia.org/wiki/Python_(programming_language)',
    goal: 'When did Python first appear?', fields: ['language', 'first_appeared'], rank: null,
    truth: async () => ({ name: 'Python', text: '1991' }),
  },
  {
    name: 'Wikipedia: most populous city (large table)',
    url: 'https://en.wikipedia.org/wiki/List_of_largest_cities',
    goal: 'Which city has the largest population?', fields: ['city', 'population'], rank: ['population', 'desc'],
    truth: async () => ({ name: ['Jakarta', 'Tokyo', 'Dhaka'] }), // sources in the article differ on the order
  },
  {
    name: 'scrapethissite: 2015 film with the most Oscars (loads after a click)',
    url: 'https://www.scrapethissite.com/pages/ajax-javascript/',
    goal: 'Which 2015 film won the most awards?', fields: ['film', 'awards'], rank: ['awards', 'desc'],
    truth: async () => {
      const films = await (await fetch('https://www.scrapethissite.com/pages/ajax-javascript/?ajax=true&year=2015')).json();
      const f = maxBy(films, (x) => x.awards);
      return { name: f.title.trim(), value: f.awards };
    },
  },
  {
    name: 'Local: cheapest headphones in shadow-DOM product cards',
    url: `${site.url}/pages/shadow.html`,
    goal: 'Find the cheapest headphones', fields: ['product', 'price'], rank: ['price', 'asc'],
    truth: async () => ({ name: 'CalmWave Lite', value: 149 }),
  },
];
const CASES = SET === 'heldout' ? HELDOUT : SET === 'all' ? [...TUNED, ...HELDOUT] : TUNED;

const { ctx, id } = await launch({ userDataDir: path.join(ROOT, '.profile-test') });
const page = await ctx.newPage();
await page.goto(`chrome-extension://${id}/agent.html`);
const results = [];
for (const c of CASES) {
  const truth = await c.truth(c.url);
  const t = Date.now();
  const steps = [{ type: 'search', urls: [c.url] }, { type: 'open', limit: 1 }, { type: 'extract', fields: c.fields }, ...(c.rank ? [{ type: 'rank', by: c.rank[0], order: c.rank[1], keep: 5 }] : []), { type: 'answer', question: c.goal }];
  const r = await page.evaluate((wf) => chrome.runtime.sendMessage({ target: 'bg', cmd: 'agentRun', runId: Math.random().toString(), workflow: wf }), { goal: c.goal, steps });
  const secs = ((Date.now() - t) / 1000).toFixed(0);
  const top = r.ok ? r.result.rows[0] : null;
  const vals = top ? Object.entries(top).filter(([k]) => !k.startsWith('_')).map(([, v]) => v) : [];
  const norm = (x) => String(x).toLowerCase().replace(/(\.\.\.|…)$/, '').replace(/\s+/g, ' ').trim();
  const names = [].concat(truth.name);
  const nameOk = top && names.some((n) => vals.some((v) => norm(v) === norm(n) || (norm(v).length > 3 && (norm(v).includes(norm(n)) || norm(n).includes(norm(v))))));
  const textOk = !truth.text || vals.some((v) => String(v).includes(truth.text));
  const close = (v, t) => Math.abs(v - t) <= Math.abs(t) * 0.01;
  const valueOk = truth.range ? vals.some((v) => typeof v === 'number' && v >= truth.range[0] && v <= truth.range[1]) : truth.value == null || vals.some((v) => typeof v === 'number' && [].concat(truth.value).some((t) => close(v, t)));
  const pass = !!(nameOk && valueOk && textOk);
  results.push({ case: c.name, pass, secs, via: top?._via, rows: r.ok ? r.result.rows.length : 0, expected: truth, got: top && Object.fromEntries(Object.entries(top).filter(([k]) => !k.startsWith('_'))), error: r.ok ? undefined : r.error });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${c.name} (${secs} s, via ${top?._via || '—'}, ${results.at(-1).rows} rows)`);
  if (!pass) console.log('     expected', JSON.stringify(truth), '\n     got     ', JSON.stringify(results.at(-1).got || r.error));
}
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} correct`);
fs.writeFileSync(path.join(ROOT, `bench/extract-eval-${SET}.json`), JSON.stringify({ date: new Date().toISOString(), set: SET, passed, total: results.length, results }, null, 1));
site.server.close();
await ctx.close();
