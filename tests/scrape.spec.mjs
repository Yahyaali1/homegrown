// Collect from pages, end to end: rules pasted in Mission control are run in background tabs over a fixture site
// with pagination, nested fields, a table, late content and a formula cell. No model is needed.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { serve, launch, ROOT, EXT } from './harness.mjs';
import { parseWorkflow } from '../src/domain/mission/workflow.ts';

let ctx, sw, id, site;
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  site = await serve(path.join(ROOT, 'tests/fixtures'));
  ({ ctx, sw, id } = await launch({ userDataDir: '' }));
});
test.afterAll(async () => {
  await ctx?.close();
  site?.server.close();
});

const RULES = {
  heading: 'h1',
  plants: { selector: '.card', type: 'list', output: { name: '.name', price: '.price', url: { selector: 'a.more', output: '@href' } } },
};
const run = (recipe) => sw.evaluate((r) => self.bgHandlers.scrapeRun({ recipe: r, runId: 'test' }), recipe);

test('scrape: rules follow next links across pages and stop at a page already read', async () => {
  const r = await run({ urls: [`${site.url}/scrape/page1.html`], extract_rules: RULES, pages: 5, wait_for: '.card' });
  expect(r.results.map((p) => new URL(p.url).pathname)).toEqual(['/scrape/page1.html', '/scrape/page2.html', '/scrape/page3.html']);
  expect(r.results.flatMap((p) => p.data.plants.map((x) => x.name))).toEqual(['Fern', 'Cactus', 'Orchid', 'Moss']); // Moss renders late: wait_for
  expect(r.results[0].data.plants[0].url).toBe(`${site.url}/scrape/fern.html`); // @href comes back absolute
  expect(r.results[1].data.plants[0].url).toBe(`${site.url}/scrape/orchid.html`);
  expect(r.notes).toEqual([]); // page 3's Next points back to page 1: no loop, nothing left over
});

test('scrape: the pages setting caps pagination and says more exist', async () => {
  const r = await run({ urls: [`${site.url}/scrape/page1.html`], extract_rules: RULES, pages: 2 });
  expect(r.reads).toBe(2);
  expect(r.notes[0]).toContain('stopped at 2 pages; more exist');
});

test('scrape: tables, unsafe links and a bad selector', async () => {
  const r = await run({
    urls: [`${site.url}/scrape/page1.html`],
    extract_rules: { care: { selector: '#care', output: 'table_json' }, bad_link: 'a.bad@href', broken: '##nope', xpath: '//h1' },
  });
  const d = r.results[0].data;
  expect(d.care).toEqual([{ Plant: 'Fern', Water: 'Weekly' }]);
  expect(d.bad_link).toBeNull(); // javascript: links are dropped
  expect(d.xpath).toBe('Plants');
  expect(d.broken).toBeNull();
  expect(d._errors.broken).toContain('Bad selector'); // one bad selector fails only its own field
});

test('scrape: nav links that merely start with "Next" are not pages; <base href> resolves links', async () => {
  const r = await run({ urls: [`${site.url}/scrape/nav.html`], extract_rules: { doc: 'a.doc@href', title: '//h1/text()', href: '//a[@class="doc"]/@href', first: { selector: '(//h1)[1]', selector_type: 'xpath' } }, pages: 5 });
  expect(r.reads).toBe(1);
  expect(r.results[0].next).toBeNull();
  expect(r.results[0].data).toMatchObject({ doc: `${site.url}/scrape/sub/intro.html`, title: 'Docs', href: 'intro.html', first: 'Docs' });
});

test('scrape: a pagination widget labelled "Go to next page" with an arrow is followed, not its "Last" »', async () => {
  const r = await run({ urls: [`${site.url}/scrape/aria.html`], extract_rules: { h: 'h1' }, pages: 2 });
  expect(r.results.map((p) => new URL(p.url).pathname)).toEqual(['/scrape/aria.html', '/scrape/page2.html']);
});

test('scrape: with no model downloaded, AI rules are skipped with a note and the CSS rules still collect', async () => {
  const r = await run({ urls: [`${site.url}/scrape/ai.html`], extract_rules: { plants: { selector: '.card', type: 'list', output: { name: 'h2' } } }, ai_extract_rules: { delivery: 'delivery time' } });
  expect(r.results[0].data.plants.map((p) => p.name)).toEqual(['Fern', 'Orchid', 'Cactus']);
  expect(r.results[0].aiText).toBeUndefined(); // page text stays in the worker
  expect(r.notes.join(' ')).toContain('AI fields skipped: No model downloaded');
  // A bad item selector with AI rules still reads the page: only that field fails.
  const bad = await run({ urls: [`${site.url}/scrape/ai.html`], extract_rules: { title: 'h1', plants: { selector: '##bad', type: 'list', output: { name: 'h2' } } }, ai_extract_rules: { delivery: 'delivery time' } });
  expect(bad.results[0].error).toBeUndefined();
  expect(bad.results[0].data.title).toBe('Plants');
  expect(bad.results[0].data._errors.plants).toContain('Bad selector');
});

test('js_scenario: fill and click a search form, wait for and click "load more" until it is gone, then read', async () => {
  const r = await run({
    urls: [`${site.url}/scrape/shop.html`],
    extract_rules: { heading: 'h1', items: { selector: '.item', type: 'list' } },
    js_scenario: { instructions: [
      { fill: ['#q', 'fern'] }, { click: '#go' }, { wait_for: '.item' },
      { infinite_scroll: { max_count: 10, delay: 400, end_click: { selector: '#more' } } },
      { scroll_y: 200 }, { wait: 100 },
    ] },
  });
  const p = r.results[0];
  expect(p.error).toBeUndefined();
  expect(new URL(p.url).pathname).toBe('/scrape/results.html'); // the click navigated, and reading followed
  expect(p.data.heading).toBe('Results for fern');
  expect(p.data.items).toEqual(Array.from({ length: 9 }, (_, i) => `fern ${i + 1}`)); // three "load more" rounds
  expect(p.js_scenario_report.map((s) => s.ok)).toEqual([true, true, true, true, true, true]);
});

test('js_scenario: strict stops at a failed step with its report; non-strict carries on', async () => {
  const steps = [{ click: '#missing' }, { fill: ['#q', 'moss'] }];
  const strict = (await run({ urls: [`${site.url}/scrape/shop.html`], extract_rules: { h: 'h1' }, js_scenario: { instructions: steps } })).results[0];
  expect(strict.error).toContain('A step failed: click #missing: #missing not found');
  expect(strict.js_scenario_report).toHaveLength(1);
  const loose = (await run({ urls: [`${site.url}/scrape/shop.html`], extract_rules: { q: '#q@value' }, js_scenario: { strict: false, instructions: steps } })).results[0];
  expect(loose.error).toBeUndefined();
  expect(loose.js_scenario_report.map((s) => s.ok)).toEqual([false, true]);
});

test('js_scenario evaluate runs only when Chrome\'s "Allow user scripts" is on, and returns evaluate_results', async () => {
  const go = async () => (await run({ urls: [`${site.url}/scrape/shop.html`], extract_rules: { h: 'h1' }, js_scenario: { strict: false, instructions: [{ evaluate: 'window.secret + 1' }] } })).results[0];
  const off = await go();
  expect(off.js_scenario_report[0].error).toContain('Allow user scripts');
  const page = await ctx.newPage(); // the user turns it on in chrome://extensions
  await page.goto(`chrome://extensions/?id=${id}`);
  await page.locator('#allow-user-scripts').click();
  await page.close();
  const on = await go();
  expect(on.js_scenario_report[0]).toMatchObject({ ok: true, result: 43 }); // the page's own window.secret, in its world
  expect(on.evaluate_results).toEqual([43]);
});

test('page parameters: relevant text and markdown, page returns, status code, blocked resources, headers', async () => {
  const p = (await run({
    urls: [`${site.url}/scrape/shop.html`],
    extract_rules: { body: { selector: 'body', output: 'text_relevant' }, md: { selector: 'main', output: 'markdown_relevant' }, pic: '#pic@data-state' },
    return_page_text: true, return_page_markdown: true, return_page_source: true, block_resources: true,
  })).results[0];
  expect(p.data.body).toContain('Find a plant');
  expect(p.data.body).not.toMatch(/header|footer|secret/); // header, footer, nav and scripts are left out
  expect(p.data.md).toContain('# Find a plant');
  expect(p.status).toBe(200);
  expect(p.text).toContain('Find a plant');
  expect(p.markdown).toContain('# Find a plant');
  expect(p.source).toContain('<form action="results.html">');
  expect(p.data.pic).toBe('blocked'); // block_resources: the image never loaded
  const form = (await run({ urls: [`${site.url}/scrape/tall.html`], extract_rules: { body: { selector: 'body', output: 'text_relevant' } }, return_page_markdown: true })).results[0];
  expect(form.data.body).toContain('inside a form'); // pages wrapped in a <form> keep their text
  expect(form.markdown).toContain('A button label');
  for (const extra of [{}, { block_ads: true }]) { // with and without the blank-tab setup
    const dom = (await run({ urls: [`${site.url}/scrape/shop.html`], extract_rules: { h: 'h1' }, wait_browser: 'domcontentloaded', ...extra })).results[0];
    expect(dom.data.h).toBe('Find a plant');
  }
  const missing = (await run({ urls: [`${site.url}/scrape/nope.html`], extract_rules: { h: 'h1' } })).results[0];
  expect(missing.status).toBe(404); // transparent_status_code
  const echo = (await run({ urls: [`${site.url}/echo-headers`], extract_rules: { h: '#h' }, headers: { 'Accept-Language': 'de-CH', 'X-Recipe': 'plants' } })).results[0];
  expect(JSON.parse(echo.data.h)).toMatchObject({ 'accept-language': 'de-CH', 'x-recipe': 'plants' });
  const later = (await run({ urls: [`${site.url}/echo-headers`], extract_rules: { h: '#h' } })).results[0];
  expect(JSON.parse(later.data.h)['x-recipe']).toBeUndefined(); // the header rule ended with its tab
});

test('screenshots and devices without the debugger permission say how to allow it', async () => {
  const p = (await run({ urls: [`${site.url}/scrape/shop.html`], extract_rules: { h: 'h1' }, screenshot: true })).results[0];
  expect(p.error).toContain('debugger permission');
});

test('pageRequest: any feature can read a page with ScrapingBee parameters; steps that act need an extension page', async () => {
  const url = `${site.url}/scrape/shop.html`;
  const params = { extract_rules: { h: 'h1' }, js_scenario: { instructions: [{ fill: ['#q', 'moss'] }] } };
  const fromWeb = await sw.evaluate(([url, params]) => self.bgHandlers.pageRequest({ url, params }, { url: 'chrome-extension://x/content.js', tab: { url: 'https://evil.example/' } }).then(() => 'ran', (e) => e.message), [url, params]);
  expect(fromWeb).toContain('only come from Homegrown');
  // Every command that takes steps refuses ones that act when a web page's content script sends them.
  const web = { url: 'chrome-extension://x/content.js', tab: { url: 'https://evil.example/' } };
  const evil = { instructions: [{ evaluate: 'alert(1)' }] };
  const wf = { goal: 'x', brief: null, steps: [{ type: 'search', query: 'x', n: 1, urls: [url] }, { type: 'open', limit: 1, scenario: evil }, { type: 'answer', question: 'x' }] };
  const refused = await sw.evaluate(async ([url, evil, wf, web]) => {
    const h = self.bgHandlers;
    const tries = {
      scrapeRun: () => h.scrapeRun({ runId: 'e', recipe: { url, extract_rules: { h: 'h1' }, js_scenario: evil } }, web),
      recipeSave: () => h.recipeSave({ recipe: { url, extract_rules: { h: 'h1' }, js_scenario: evil } }, web),
      agentRun: () => h.agentRun({ workflow: wf, runId: 'e', loop: false }, web),
      missionStart: () => h.missionStart({ goal: 'x', workflow: wf }, web),
      missionSave: () => h.missionSave({ mission: { ...wf, id: 'evil', name: 'x', every: 'hour' } }, web),
    };
    const out = {};
    for (const [k, f] of Object.entries(tries)) out[k] = await Promise.resolve().then(f).then(() => 'ran', (e) => e.message);
    out.saved = (await h.missionsList()).some((m) => m.id === 'evil');
    return out;
  }, [url, evil, wf, web]);
  for (const k of ['scrapeRun', 'recipeSave', 'agentRun', 'missionStart', 'missionSave']) expect(refused[k], k).toContain('only come from Homegrown');
  expect(refused.saved).toBe(false);
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/library.html`);
  const r = await page.evaluate(([url, params]) => chrome.runtime.sendMessage({ target: 'bg', cmd: 'pageRequest', url, params }), [url, params]);
  expect(r.ok).toBe(true);
  expect(r.result.data.h).toBe('Find a plant');
  expect(r.result.js_scenario_report[0].ok).toBe(true);
  const read = await sw.evaluate((url) => self.bgHandlers.pageRequest({ url, params: { return_page_markdown: true } }, { tab: { url: 'https://any.example/' } }), url);
  expect(read.markdown).toContain('# Find a plant'); // reading needs no extension page
  const asked = await sw.evaluate((url) => self.bgHandlers.pageRequest({ url, params: { ai_query: 'What is sold here?' } }, { tab: { url: 'https://any.example/' } }), url);
  expect(asked.aiPage).toBeUndefined(); // the text the model read stays in the worker
  expect(asked.aiText).toBeUndefined();
  expect((await sw.evaluate(() => self.bgHandlers.pageTools())).map((t) => t.name)).toContain('js_scenario');
  await page.close();
});

test('scheduled missions run steps that act only as confirmed, and the confirmation is out of content scripts\' reach', async () => {
  const url = `${site.url}/scrape/listing.html`;
  const scenario = { strict: true, instructions: [{ click: '#more' }] };
  // `n` left out on purpose: the confirmation is of the parsed workflow, defaults filled in, as Mission control sends it.
  const mission = { id: 'sched', name: 'Ferns', goal: 'ferns', brief: null, every: 'hour', steps: [{ type: 'search', query: 'x', urls: [url] }, { type: 'open', limit: 1, scenario }, { type: 'answer', question: 'x' }] };
  const confirmed = JSON.stringify(parseWorkflow(mission).steps);
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/library.html`);
  const saved = await page.evaluate((m) => chrome.runtime.sendMessage({ target: 'bg', cmd: 'missionSave', mission: m }), { ...mission, actsConfirmed: confirmed });
  expect(saved.ok).toBe(true);
  const stored = await sw.evaluate(async () => (await chrome.storage.local.get('missions')).missions.find((m) => m.id === 'sched'));
  expect(stored.actsConfirmed).toBeUndefined(); // not where a content script could write it
  const outcome = () => sw.evaluate(() => self.missionScheduled('sched').then(() => 'skipped', (e) => `ran: ${e.message}`));
  expect(await outcome()).toMatch(/^ran/); // confirmed: it runs (and stops at the answer, with no model here)
  // A hostile renderer rewrites the stored steps: the schedule no longer matches what was confirmed.
  await sw.evaluate(async () => {
    const { missions } = await chrome.storage.local.get('missions');
    for (const m of missions) if (m.id === 'sched') m.steps[1].scenario = { strict: true, instructions: [{ evaluate: 'alert(1)' }] };
    await chrome.storage.local.set({ missions });
  });
  expect(await outcome()).toBe('skipped');
  // The confirmed steps aimed at another page: also skipped.
  await page.evaluate((m) => chrome.runtime.sendMessage({ target: 'bg', cmd: 'missionSave', mission: m }), { ...mission, actsConfirmed: confirmed });
  expect(await outcome()).toMatch(/^ran/);
  await sw.evaluate(async () => {
    const { missions } = await chrome.storage.local.get('missions');
    for (const m of missions) if (m.id === 'sched') m.steps[0].urls = ['https://attacker.example/'];
    await chrome.storage.local.set({ missions });
  });
  expect(await outcome()).toBe('skipped');
  // The notification's link opens that mission ready to save; saving with the schedule confirms it again, same id.
  await page.goto(`chrome-extension://${id}/agent.html?mission=sched`);
  await expect(page.locator('#save')).toBeVisible();
  await expect(page.locator('#name')).toHaveValue('Ferns');
  let asked = '';
  page.once('dialog', (d) => ((asked = d.message()), d.accept()));
  await page.click('#save-btn');
  await expect(page.locator('#save-btn')).toHaveText('Saved ✓');
  expect(asked).toContain('Every hour, unattended, on attacker.example'); // where it runs is in the question
  const ids = await sw.evaluate(async () => (await chrome.storage.local.get('missions')).missions.map((m) => m.id).filter((x) => x === 'sched'));
  expect(ids).toEqual(['sched']); // updated, not copied
  await page.close();
});

test('Collect: more ScrapingBee parameters, and steps that act are confirmed first', async () => {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/agent.html`);
  await page.getByRole('tab', { name: 'Collect from pages' }).click();
  await page.fill('#c-urls', `${site.url}/scrape/shop.html`);
  await page.fill('#c-rules', '{"heading": "h1", "items": {"selector": ".item", "type": "list"}}');
  await page.fill('#c-more', '{"js_scenario": {"instructions": [{"hover": "#x"}]}}');
  await page.click('#c-run');
  await expect(page.locator('#c-status')).toContainText('js_scenario');
  await page.fill('#c-more', '{"js_scenario": {"instructions": [{"fill": ["#q", "fern"]}, {"click": "#go"}, {"wait_for": ".item"}]}, "return_page_text": true}');
  let asked = '';
  page.once('dialog', (d) => ((asked = d.message()), d.dismiss()));
  await page.click('#c-run');
  await expect(page.locator('#c-status')).toHaveText('Not run.');
  expect(asked).toContain('type "fern" into #q');
  expect(asked).toContain('click #go');
  expect(asked).not.toContain('wait for'); // only the steps that act are listed
  page.once('dialog', (d) => d.accept());
  await page.click('#c-run');
  await expect(page.locator('#c-status')).toContainText('Steps: 3 of 3 ran', { timeout: 60000 });
  await expect(page.locator('#table tbody tr')).toHaveCount(1);
  await expect(page.locator('#table')).toContainText('Results for fern');
  await page.fill('#c-name', 'Fern search');
  await page.click('#c-save');
  await page.reload();
  await page.locator('#saved li', { hasText: 'Fern search' }).getByRole('button', { name: 'Open' }).click();
  expect(JSON.parse(await page.inputValue('#c-more'))).toMatchObject({ return_page_text: true, js_scenario: { strict: true, instructions: [{ fill: ['#q', 'fern'] }, { click: '#go' }, { wait_for: '.item' }] } });
  await page.close();
});

test('scrape: Stop ends a run between pages', async () => {
  const r = await sw.evaluate(async (url) => {
    const going = self.bgHandlers.scrapeRun({ recipe: { urls: [url], extract_rules: { h: 'h1' }, pages: 5 }, runId: 'stop-me' });
    await new Promise((ok) => setTimeout(ok, 1200)); // page 1 read, the pause before page 2
    self.bgHandlers.scrapeStop({ runId: 'stop-me' });
    return going;
  }, `${site.url}/scrape/page1.html`);
  expect(r.stopped).toBe(true);
  expect(r.reads).toBeLessThan(3);
});

test('scrape: Mission control collects into the table, exports safe CSV, and saves the recipe', async () => {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/agent.html`);
  await page.getByRole('tab', { name: 'Collect from pages' }).click();
  await page.fill('#c-rules', '{not json');
  await page.click('#c-run');
  await expect(page.locator('#c-status')).toContainText('Add at least one page address');
  await page.fill('#c-urls', `${site.url}/scrape/page1.html`);
  await page.click('#c-run');
  await expect(page.locator('#c-status')).toContainText('ScrapingBee extract_rules');
  await page.fill('#c-rules', JSON.stringify(RULES));
  await page.fill('#c-ai', '{"when": {"description": "date", "type": "date"}}');
  await page.click('#c-run');
  await expect(page.locator('#c-status')).toContainText('ai_extract_rules form');
  await page.fill('#c-ai', '');
  await page.fill('#c-rules', JSON.stringify(RULES));
  await page.fill('#c-pages', '2');
  await page.click('#c-run');
  await expect(page.locator('#c-status')).toContainText('3 rows from 2 pages', { timeout: 60000 });
  await expect(page.locator('#table tbody tr')).toHaveCount(3);
  await expect(page.locator('#table thead')).toContainText('name');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#csv')]);
  const csv = await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString());
  expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"")"`); // the formula cell can't run in a spreadsheet
  expect(csv.split('\n')[1]).toContain(`"${site.url}/scrape/fern.html","${site.url}/scrape/page1.html"`); // a scraped "url" keeps its value beside source_url
  // Switching modes keeps each mode's own results.
  await page.getByRole('tab', { name: 'Find an answer' }).click();
  await expect(page.locator('#results')).toBeHidden();
  await page.getByRole('tab', { name: 'Collect from pages' }).click();
  await expect(page.locator('#table tbody tr')).toHaveCount(3);
  await expect(page.locator('#table tr.best')).toHaveCount(0);
  await page.fill('#c-ai', '{"when": "when it ships"}');
  await page.fill('#c-ai-selector', 'main');
  await page.fill('#c-name', 'Plants');
  await page.click('#c-save');
  await expect(page.locator('#saved')).toContainText('Plants');
  await expect(page.locator('#saved')).toContainText('recipe · 1 URL · 2 pages each');
  await page.reload();
  await page.locator('#saved li', { hasText: 'Plants' }).getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('#c-urls')).toHaveValue(`${site.url}/scrape/page1.html`);
  await expect(page.locator('#c-pages')).toHaveValue('2');
  expect(JSON.parse(await page.inputValue('#c-ai'))).toEqual({ when: 'when it ships' }); // AI rules come back too
  await expect(page.locator('#c-ai-selector')).toHaveValue('main');
});

test('Mission control: New lets go of a running mission (Run comes back, a reload does not re-attach)', async () => {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/agent.html`);
  // The state a running mission leaves: Stop shown, Run hidden, ?run= in the address.
  await page.evaluate(() => {
    history.replaceState(null, '', '?run=still-going');
    document.querySelector('#run').hidden = true;
    document.querySelector('#stop').hidden = false;
  });
  await page.click('#new');
  await expect(page.locator('#run')).not.toHaveAttribute('hidden', '');
  await expect(page.locator('#stop')).toBeHidden();
  expect(new URL(page.url()).search).toBe('');
  // The old run's messages no longer land here.
  await sw.evaluate(() => chrome.runtime.sendMessage({ type: 'agent-progress', runId: 'still-going', log: ['old line'] }).catch(() => {}));
  await page.waitForTimeout(300);
  await expect(page.locator('#log li')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#answer')).toHaveText(''); // nothing to re-attach to
});

test('screenshots, full page and of one element, and a mobile device (with the debugger permission granted)', async () => {
  // The permission is optional and Chrome asks for it in a native prompt a test can't click: this copy of the build
  // has it granted at install instead. Same code.
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-dbg-'));
  fs.cpSync(EXT, copy, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(copy, 'manifest.json'), 'utf8'));
  manifest.permissions.push('debugger');
  fs.writeFileSync(path.join(copy, 'manifest.json'), JSON.stringify(manifest));
  const b = await launch({ userDataDir: '', ext: copy });
  try {
    const go = (extra) => b.sw.evaluate((r) => self.bgHandlers.scrapeRun({ runId: 'shot', recipe: r }), { urls: [`${site.url}/scrape/shop.html`], extract_rules: { h: 'h1' }, ...extra });
    const png = (u) => Buffer.from(u.split(',')[1], 'base64');
    const size = (u) => ({ w: png(u).readUInt32BE(16), h: png(u).readUInt32BE(20) });
    const tall = await b.sw.evaluate((r) => self.bgHandlers.scrapeRun({ runId: 'tall', recipe: r }), { urls: [`${site.url}/scrape/tall.html`], extract_rules: { h: 'h1' }, screenshot_full_page: true, window_width: 800, window_height: 600 });
    const full = tall.results[0];
    expect(full.error).toBeUndefined();
    expect(size(full.screenshot).w).toBe(800);
    expect(size(full.screenshot).h).toBeGreaterThan(2400); // the whole page, not the 600 px window
    const el = (await go({ screenshot_selector: 'form' })).results[0];
    expect(size(el.screenshot).h).toBeLessThan(100); // just the form
    const mobile = (await b.sw.evaluate((r) => self.bgHandlers.scrapeRun({ runId: 'm', recipe: r }), { urls: [`${site.url}/echo-headers`], extract_rules: { h: '#h' }, device: 'mobile', screenshot: true })).results[0];
    expect(mobile.error).toBeUndefined();
    expect(JSON.parse(mobile.data.h)['user-agent']).toContain('iPhone'); // device: mobile
    expect(size(mobile.screenshot).w).toBe(390 * 3); // a phone-width viewport at 3x
  } finally {
    await b.ctx.close();
  }
});

