// Hands in your tabs end to end, no model (plan T5): runs are planted pinned, with a plan the person approved and a
// model no engine has, so each stops at its first think. Sites are faked at their edge (ADR-14). This copy of the
// extension has `debugger` and `downloads` at install: Chrome asks for an optional permission in a prompt a test can't click.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXT, launch } from './harness.mjs';

const SHOP = 'https://shop.garden.test';
const MINE = 'https://mail.garden.test';
const FORM = '<!doctype html><title>Compose</title><form action="/sent"><input id="to" name="to"><button id="go">Next</button></form>';
const CAPTCHA = '<!doctype html><title>Prices</title><p>One moment.</p><iframe src="https://www.google.com/recaptcha/api2/anchor?k=test" width="300" height="80"></iframe>';
const NOISY = `<!doctype html><title>Item</title><p>Item 1</p><script>
  console.error('boom at https://shop.garden.test/app.js?token=secret');
  fetch('/api/item/1?key=secret', { method: 'PATCH', body: '{}' });
</script>`;
let ctx, sw, id, panel, g;
const loads = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-tabs-'));
  fs.cpSync(EXT, copy, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(copy, 'manifest.json'), 'utf8'));
  manifest.permissions.push('debugger', 'downloads');
  fs.writeFileSync(path.join(copy, 'manifest.json'), JSON.stringify(manifest));
  ({ ctx, sw, id } = await launch({ ext: copy }));
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
  g = await bg('gardenerSave', { gardener: { name: 'Clerk', instructions: 'Help in my tabs.', sites: ['shop.garden.test'], minutes: 10, devtools: true } });
});

test.afterAll(async () => {
  await ctx?.close();
});

async function bg(cmd, args = {}) {
  const r = await panel.evaluate(([cmd, args]) => chrome.runtime.sendMessage({ target: 'bg', cmd, ...args }), [cmd, args]);
  if (!r?.ok) throw new Error(`${cmd}: ${r?.error}`);
  return r.result;
}

async function plant(run) {
  await panel.evaluate(async (run) => {
    const d = await new Promise((ok, no) => Object.assign(indexedDB.open('hg-garden'), { onsuccess: (e) => ok(e.target.result), onerror: no }));
    const t = d.transaction('runs', 'readwrite');
    t.objectStore('runs').put(run);
    await new Promise((ok, no) => Object.assign(t, { oncomplete: ok, onerror: no }));
    d.close();
  }, run);
  await sw.evaluate(() => self.gardenFire('none'));
}

const planned = (runId, plan, work = {}) => ({
  v: 1, id: runId, gardenerId: g.id, work: { kind: 'plan', request: 'Do it.', ...work }, status: 'queued', queuedAt: Date.now(), usedMs: 0,
  model: 'no-model-here', maxTokens: 4096, agent: { loop: false, maxSteps: 8 }, abilities: ['plan'], plan,
  turns: [], steps: [], requests: [], seen: [], tainted: false,
});
const waiting = (runId) => expect.poll(async () => (await bg('runGet', { id: runId })).status, { timeout: 60_000 }).toBe('waiting');

test('act_my_tab: an approved plan fills a form in the person\'s own tab, only after its own yes', async () => {
  const mine = await ctx.newPage();
  await mine.goto(`${MINE}/compose`);
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, `${MINE}/compose`);
  const steps = { strict: true, instructions: [{ fill: ['#to', 'ann@example.com'] }, { click: '#go' }] };
  await plant(planned('mine-1', [{ tool: 'act_my_tab', args: { tab: `${MINE}/compose`, steps } }], { tabs: [{ url: `${MINE}/compose`, title: 'Compose', tabId }] }));
  await waiting('mine-1');
  const [q] = (await bg('runGet', { id: 'mine-1' })).requests;
  // The plan's yes covered nothing in the person's tab; any fill there is sensitive, untainted or not.
  expect([q.kind, q.tool, q.sensitive, !!q.fromPlan]).toEqual(['approve', 'act_my_tab', true, false]);
  expect(loads).not.toContain('/sent?to=ann%40example.com');
  await expect(bg('requestAnswer', { runId: 'mine-1', requestId: q.id, value: 'always' })).rejects.toThrow(/yes or no/);
  await bg('requestShown', { runId: 'mine-1', requestId: q.id });
  await panel.waitForTimeout(8500);
  await bg('requestAnswer', { runId: 'mine-1', requestId: q.id, value: 'yes' });
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
