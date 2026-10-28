// Collect from pages, end to end: rules pasted in Mission control are run in background tabs over a fixture site
// with pagination, nested fields, a table, late content and a formula cell. No model is needed.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { serve, launch, ROOT } from './harness.mjs';

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

