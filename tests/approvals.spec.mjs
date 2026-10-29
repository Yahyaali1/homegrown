// Approvals end to end, no model: runs are planted already pinned (plan T1 "Planned runs") with a plan the person
// approved and a model no engine has, so each stops at its first think. Everything checked happens before that.
// The shop is faked at its edge (ADR-14) and records each page it serves, with its query.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { launch, ROOT } from './harness.mjs';

const SHOP = 'https://shop.garden.test';
const FAR = 'https://far.garden.test';
const FORM = '<!doctype html><title>Search the shop</title><form action="/found"><input id="q" name="q"><button id="go">Search</button></form>';
let ctx, sw, id, panel, g;
const loads = []; // path and query of each page served

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  ({ ctx, sw, id } = await launch({ userDataDir: path.join(ROOT, '.profile-test') }));
  for (const site of [SHOP, FAR]) {
    await ctx.route(`${site}/**`, (r) => {
      const u = new URL(r.request().url());
      if (r.request().resourceType() === 'document') loads.push(u.pathname + u.search);
      r.fulfill({ contentType: 'text/html; charset=utf-8', body: u.pathname === '/form' ? FORM : `<!doctype html><title>Page</title><p>${u.pathname}</p>` });
    });
  }
  panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  for (const r of await bg('runList', { limit: 1000 })) {
    if (['queued', 'running', 'waiting'].includes(r.status)) await bg('runStop', { id: r.id });
    await bg('runDelete', { id: r.id });
  }
  for (const x of await bg('gardenerList')) await bg('gardenerDelete', { id: x.id });
  g = await bg('gardenerSave', { gardener: { name: 'Clerk', instructions: 'Search the shop.', sites: ['shop.garden.test'], minutes: 10 } });
});

test.afterAll(async () => {
  await ctx?.close();
});

async function bg(cmd, args = {}) {
  const r = await panel.evaluate(([cmd, args]) => chrome.runtime.sendMessage({ target: 'bg', cmd, ...args }), [cmd, args]);
  if (!r?.ok) throw new Error(`${cmd}: ${r?.error}`);
  return r.result;
}

/** Puts queued, pinned plan runs straight into the worker's store, then wakes the queue. */
async function plant(...runs) {
  await panel.evaluate(async (runs) => {
    const d = await new Promise((ok, no) => Object.assign(indexedDB.open('hg-garden', 1), { onsuccess: (e) => ok(e.target.result), onerror: no }));
    const t = d.transaction('runs', 'readwrite');
    for (const run of runs) t.objectStore('runs').put(run);
    await new Promise((ok, no) => Object.assign(t, { oncomplete: ok, onerror: no }));
    d.close();
  }, runs);
  await sw.evaluate(() => self.gardenFire('none'));
}

const planned = (runId, plan, over = {}) => ({
  v: 1, id: runId, gardenerId: g.id, work: { kind: 'plan', request: 'Search the shop for tea.' }, status: 'queued', queuedAt: Date.now(), usedMs: 0,
  model: 'no-model-here', maxTokens: 4096, agent: { loop: false, maxSteps: 8 }, abilities: ['plan'], plan,
  turns: [], steps: [], requests: [], seen: [], tainted: false, ...over,
});
const search = (value) => ({ tool: 'act', args: { url: `${SHOP}/form`, steps: { strict: true, instructions: [{ fill: ['#q', value] }, { click: '#go' }] } } });
const waiting = (runId) => expect.poll(async () => (await bg('runGet', { id: runId })).status, { timeout: 60_000 }).toBe('waiting');

test('the approve card: the person edits the fill value, says yes, and the form receives the edited value', async () => {
  await plant(planned('edit-1', [search('tea')]));
  await waiting('edit-1');
  const asked = (await bg('runGet', { id: 'edit-1' })).requests;
  expect(asked.map((q) => [q.kind, q.sensitive, !!q.fromPlan])).toEqual([['approve', false, false]]);

  await panel.reload();
  await panel.click('[data-tab=garden]');
  const card = panel.locator('#garden-requests li.request', { hasText: 'act on' });
  await expect(card).toHaveCount(1);
  const steps = card.getByLabel('Edit steps');
  await steps.fill((await steps.inputValue()).replace('"tea"', '"green tea"'));
  await expect(card.getByRole('button', { name: /^Always/ })).toBeHidden();
  await card.getByRole('button', { name: 'Yes', exact: true }).click();

  let run;
  await expect.poll(async () => (run = await bg('runGet', { id: 'edit-1' })).steps[0]?.state, { timeout: 60_000 }).toBe('done');
  expect(loads).toContain('/found?q=green+tea');
  expect(loads).not.toContain('/found?q=tea');
  expect(run.steps[0].args.steps.instructions[0].fill).toEqual(['#q', 'green tea']);
  expect(run.requests[0].answer.args.steps.instructions[0].fill[1]).toBe('green tea');
});

test('Approve all clears two reach requests and leaves a sensitive one; Garden and Chat show the same tray', async () => {
  const read = (url) => [{ tool: 'read_page', args: { url } }];
  // Tainted (a signed-in read before): typing is sensitive, so its approve is always asked on its own.
  await plant(planned('reach-1', read(`${FAR}/a`)), planned('reach-2', read(`${FAR}/b`)), planned('sens-1', [search('tea')], { tainted: true }));
  for (const r of ['reach-1', 'reach-2', 'sens-1']) await waiting(r);

  await panel.reload();
  await panel.click('[data-tab=chat]');
  await expect(panel.locator('#chat-requests li.request')).toHaveCount(3);
  await panel.click('[data-tab=garden]');
  const tray = panel.locator('#garden-requests');
  await expect(tray.locator('li.request')).toHaveCount(3);
  await tray.getByRole('button', { name: /^Approve all/ }).click();

  await expect.poll(async () => (await bg('runGet', { id: 'reach-2' })).requests[0].answer?.value, { timeout: 30_000 }).toBe('yes');
  expect((await bg('runGet', { id: 'reach-1' })).requests[0].answer?.value).toBe('yes');
  const sensitive = await bg('runGet', { id: 'sens-1' });
  expect(sensitive.status).toBe('waiting');
  expect(sensitive.requests.map((q) => [q.kind, q.sensitive, q.answer])).toEqual([['approve', true, undefined]]);
  await expect(tray.locator('li.request')).toHaveCount(1);
  await expect(panel.locator('#chat-requests li.request')).toHaveCount(1);
});
