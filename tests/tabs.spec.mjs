// Hands in your tabs end to end, no model: runs are planted pinned, with a plan the person approved and a model no
// engine has, so each stops at its first think. Sites are faked at their edge (ADR-14). The extension has `debugger`
// and `downloads` at install.
import { test, expect } from '@playwright/test';
import { bgOn, launch, plannedRun, plant as plantOn } from './harness.mjs';

const SHOP = 'https://shop.garden.test';
const MINE = 'https://mail.garden.test';
const FORM = '<!doctype html><title>Compose</title><form action="/sent"><input id="to" name="to"><button id="go">Next</button></form>';
const CAPTCHA = '<!doctype html><title>Prices</title><p>One moment.</p><iframe src="https://www.google.com/recaptcha/api2/anchor?k=test" width="300" height="80"></iframe>';
const NOISY = `<!doctype html><title>Item</title><p>Item 1</p><script>
  console.error('boom at https://shop.garden.test/app.js?token=secret');
  fetch('/api/item/1?key=secret', { method: 'PATCH', body: '{}' });
</script>`;
let ctx, sw, id, panel, bg, g;
const loads = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  ({ ctx, sw, id } = await launch({ permissions: ['debugger', 'downloads'] }));
  const html = (body) => ({ contentType: 'text/html; charset=utf-8', body });
  await ctx.route(`${MINE}/**`, (r) => {
    const u = new URL(r.request().url());
    if (r.request().resourceType() === 'document') loads.push(u.pathname + u.search);
    r.fulfill(html(u.pathname === '/compose' ? FORM : '<!doctype html><title>Sent</title><p>Sent.</p>'));
  });
  await ctx.route(`${SHOP}/**`, (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === '/report.csv') return r.fulfill({ contentType: 'text/csv', headers: { 'Content-Disposition': 'attachment; filename="report.csv"' }, body: 'a,b\n1,2\n' });
    if (u.pathname === '/files') return r.fulfill(html('<!doctype html><title>Files</title><a id="dl" href="/report.csv">Report</a>'));
    if (u.pathname.startsWith('/api/')) return r.fulfill({ status: 422, contentType: 'application/json', body: '{"error":"bad"}' });
    r.fulfill(html(u.pathname === '/captcha' ? CAPTCHA : u.pathname === '/item' ? NOISY : '<!doctype html><title>Shop</title><p>Tea</p>'));
  });
  await ctx.route('https://www.google.com/recaptcha/**', (r) => r.fulfill(html('<!doctype html><p>I’m not a robot</p>')));
  panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  bg = bgOn(panel);
  g = await bg('gardenerSave', { gardener: { name: 'Clerk', instructions: 'Help in my tabs.', sites: ['shop.garden.test'], minutes: 10, devtools: true } });
});

test.afterAll(async () => {
  await ctx?.close();
});

const plant = (run) => plantOn(panel, sw, run);
const planned = (id, plan, work = {}) => plannedRun({ id, gardenerId: g.id, work: { kind: 'plan', request: 'Do it.', ...work }, plan });
const waiting = (runId) => expect.poll(async () => (await bg('runGet', { id: runId })).status, { timeout: 60_000 }).toBe('waiting');
/** A sensitive yes is refused until 8 s after the card was shown: answered as soon as the worker takes it. */
const yesOnceAllowed = (runId, requestId) => expect.poll(() => bg('requestAnswer', { runId, requestId, value: 'yes' }).then(() => 'taken', (e) => e.message), { timeout: 15_000, intervals: [500] }).toBe('taken');

test('act_my_tab: an approved plan fills a form in the person\'s own tab, only after its own yes', async () => {
  const mine = await ctx.newPage();
  await mine.goto(`${MINE}/compose`);
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, `${MINE}/compose`);
  const steps = { strict: true, instructions: [{ fill: ['#to', 'ann@example.com'] }, { click: '#go' }] };
  await plant(planned('mine-1', [{ tool: 'act_my_tab', args: { tab: `${MINE}/compose`, steps } }], { tabs: [{ url: `${MINE}/compose`, title: 'Compose', tabId }] }));
  await waiting('mine-1');
  const [q] = (await bg('runGet', { id: 'mine-1' })).requests;
  // The plan's yes covered nothing in the person's tab; any fill there is sensitive, untainted or not.
  expect([q.kind, q.tool, q.sensitive, q.origin === 'plan']).toEqual(['approve', 'act_my_tab', true, false]);
  expect(loads).not.toContain('/sent?to=ann%40example.com');
  await expect(bg('requestAnswer', { runId: 'mine-1', requestId: q.id, value: 'always' })).rejects.toThrow(/yes or no/);
  await bg('requestShown', { runId: 'mine-1', requestId: q.id });
  await yesOnceAllowed('mine-1', q.id);
  let run;
  await expect.poll(async () => (run = await bg('runGet', { id: 'mine-1' })).steps[0]?.state ?? 'started', { timeout: 60_000 }).not.toBe('started');
  expect(run.steps[0].error ?? '').toBe('');
  expect(run.steps[0].state).toBe('done');
  expect(loads).toContain('/sent?to=ann%40example.com');
  expect(run.tainted).toBe(true);
  expect(await sw.evaluate((t) => chrome.tabs.get(t).then((x) => !!x), tabId)).toBe(true); // the person's tab stays
  await mine.close();
});

test('a page with a reCAPTCHA iframe makes the run wait on help; Show me brings its tab forward', async () => {
  await plant(planned('help-1', [{ tool: 'read_page', args: { url: `${SHOP}/captcha` } }]));
  await waiting('help-1');
  const run = await bg('runGet', { id: 'help-1' });
  const q = run.requests.find((x) => x.kind === 'help');
  expect(q?.tabId).toEqual(expect.any(Number));
  expect(run.steps).toHaveLength(0);
  await panel.click('[data-tab=garden]');
  const card = panel.locator('#garden-requests li.request', { hasText: 'Help with this site' });
  await expect(card).toHaveCount(1);
  expect(await sw.evaluate((t) => chrome.tabs.get(t).then((x) => x.active), q.tabId)).toBe(false);
  await card.getByRole('button', { name: /^Show me/ }).click();
  await expect.poll(() => sw.evaluate((t) => chrome.tabs.get(t).then((x) => x.active), q.tabId)).toBe(true);
  await card.getByRole('button', { name: 'Skip' }).click();
  await expect.poll(async () => (await bg('runGet', { id: 'help-1' })).steps[0]?.error, { timeout: 30_000 }).toMatch(/check for humans/);
});

test('DevTools on: a console error and a 422 on PATCH show in the step output, without query strings', async () => {
  await plant(planned('dev-1', [{ tool: 'read_page', args: { url: `${SHOP}/item` } }]));
  let step;
  await expect.poll(async () => (step = (await bg('runGet', { id: 'dev-1' })).steps[0])?.state, { timeout: 60_000 }).toBe('done');
  const full = (await bg('runGet', { id: 'dev-1' })).steps[0].output;
  expect(full).toContain('Console errors:');
  expect(full).toMatch(/boom at https:\/\/shop\.garden\.test\/app\.js/);
  expect(full).toContain(`Failed requests:\n- PATCH ${SHOP}/api/item/1 422`);
  expect(full).not.toContain('secret');
});

test('a download a run tab starts is kept with the run, as a file card', async () => {
  await plant(planned('dl-1', [{ tool: 'act', args: { url: `${SHOP}/files`, steps: { strict: true, instructions: [{ click: '#dl' }] } } }]));
  await waiting('dl-1');
  const [q] = (await bg('runGet', { id: 'dl-1' })).requests;
  await bg('requestAnswer', { runId: 'dl-1', requestId: q.id, value: 'yes' });
  let run;
  await expect.poll(async () => (run = await bg('runGet', { id: 'dl-1' })).files?.length ?? 0, { timeout: 60_000 }).toBe(1);
  expect(run.files[0]).toMatchObject({ name: 'report.csv', url: `${SHOP}/report.csv` });
  expect(run.created).toEqual([{ kind: 'file', title: 'report.csv', ref: String(run.files[0].id) }]);
});

test('act_my_tab: the card is editable; the edited fill is asked once more (sensitive, 8 s) and runs as edited', async () => {
  const mine = await ctx.newPage();
  await mine.goto(`${MINE}/compose`);
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, `${MINE}/compose`);
  const steps = { strict: true, instructions: [{ click: '#go' }] };
  await plant(planned('mine-2', [{ tool: 'act_my_tab', args: { tab: `${MINE}/compose`, steps } }], { tabs: [{ url: `${MINE}/compose`, title: 'Compose', tabId }] }));
  await waiting('mine-2');
  await panel.click('[data-tab=garden]');
  const card = panel.locator('#garden-requests li.request', { hasText: 'act in your own tab' });
  await expect(card).toHaveCount(1);
  await expect(card.getByRole('button', { name: /^Always/ })).toBeHidden();
  await card.getByLabel('Edit steps').fill(JSON.stringify({ strict: true, instructions: [{ fill: ['#to', 'bob@example.com'] }, { click: '#go' }] }));
  await card.getByRole('button', { name: 'Yes', exact: true }).click();
  // The edit is a new call: its fill in the person's tab is sensitive, so it is asked again and can't be edited.
  let q;
  await expect.poll(async () => (q = (await bg('runGet', { id: 'mine-2' })).requests.find((x) => typeof x.origin === 'object'))?.sensitive ?? false, { timeout: 30_000 }).toBe(true);
  expect(loads).not.toContain('/sent?to=bob%40example.com');
  await bg('requestShown', { runId: 'mine-2', requestId: q.id });
  await yesOnceAllowed('mine-2', q.id);
  await expect.poll(async () => (await bg('runGet', { id: 'mine-2' })).steps[0]?.state ?? 'started', { timeout: 60_000 }).toBe('done');
  expect(loads).toContain('/sent?to=bob%40example.com');
  await mine.close();
});

test('act_my_tab: the person closes their tab mid-call, and the run asks "did this happen?" instead of failing', async () => {
  const mine = await ctx.newPage();
  await mine.goto(`${MINE}/compose`);
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, `${MINE}/compose`);
  const steps = { strict: true, instructions: [{ click: '#to' }, { wait: 3000 }, { click: '#go' }] };
  await plant(planned('mine-3', [{ tool: 'act_my_tab', args: { tab: `${MINE}/compose`, steps } }], { tabs: [{ url: `${MINE}/compose`, title: 'Compose', tabId }] }));
  await waiting('mine-3');
  const [q] = (await bg('runGet', { id: 'mine-3' })).requests;
  await bg('requestAnswer', { runId: 'mine-3', requestId: q.id, value: 'yes' });
  await expect.poll(async () => (await bg('runGet', { id: 'mine-3' })).steps[0]?.state, { timeout: 30_000 }).toBe('started');
  await mine.close();
  let run;
  await expect.poll(async () => (run = await bg('runGet', { id: 'mine-3' })).requests.find((x) => x.kind === 'did-it-happen')?.tool, { timeout: 30_000 }).toBe('act_my_tab');
  expect(run.steps[0].state).toBe('started');
  const ask = run.requests.find((x) => x.kind === 'did-it-happen');
  await bg('requestAnswer', { runId: 'mine-3', requestId: ask.id, value: 'no' });
  await expect.poll(async () => (await bg('runGet', { id: 'mine-3' })).steps[0]?.error, { timeout: 30_000 }).toBe('It did not happen.');
});
