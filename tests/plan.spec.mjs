// Plan first end to end @slow: the real worker and model write a plan, the person edits it in the Garden tab and says
// yes, and the run works through exactly what is left. The shop is faked at its edge (ADR-14) and counts page loads.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { bgOn, emptyGarden, engine, launch, plannedRun, plant, ROOT } from './harness.mjs';

const SHOP = 'https://shop.garden.test';
const PAGES = {
  '/fern': '<!doctype html><title>Ferns</title><h1>Ferns</h1><p>Boston fern: £12.</p>',
  '/moss': '<!doctype html><title>Moss</title><h1>Moss</h1><p>Cushion moss: £4.</p>',
};
let ctx, sw, id, panel, bg;
const loads = [];

test.beforeAll(async () => {
  ({ ctx, sw, id } = await launch({ userDataDir: path.join(ROOT, '.profile-test') }));
  await ctx.route(`${SHOP}/**`, (r) => {
    const { pathname } = new URL(r.request().url());
    if (r.request().resourceType() === 'document') loads.push(pathname);
    r.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGES[pathname] ?? '<!doctype html><title>Not found</title>' });
  });
  panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  bg = bgOn(panel);
  await emptyGarden(bg);
});

test.afterAll(async () => {
  await ctx?.close();
});


test('plan first @slow: a plan card over two pages; one call deleted, yes, and only the kept page is read, in bloom', async () => {
  const g = await bg('gardenerSave', { gardener: { name: 'Planner', instructions: 'Answer briefly.', sites: ['shop.garden.test'], minutes: 10 } });
  // No model is measured for plans yet: the run is planted already pinned with the ability, as garden-eval does.
  const m = await engine(sw, 'resolve', {});
  const runId = `plan-${Date.now()}`;
  await plant(panel, sw, plannedRun({ id: runId, gardenerId: g.id, work: { kind: 'plan', request: `Read ${SHOP}/fern and ${SHOP}/moss and give the price on each page.` }, model: m.name, maxTokens: m.maxTokens }));

  let run;
  await expect.poll(async () => (run = await bg('runGet', { id: runId })).status, { timeout: 5 * 60_000 }).toMatch(/^(waiting|done|failed|stopped)$/);
  expect(run.status, run.why).toBe('waiting');
  const q = run.requests.find((x) => x.kind === 'plan' && !x.answer);
  console.log('  plan:', JSON.stringify(q.calls));
  const urls = q.calls.filter((c) => c.tool === 'read_page').map((c) => c.args.url);
  expect(urls).toEqual(expect.arrayContaining([`${SHOP}/fern`, `${SHOP}/moss`]));

  await panel.reload();
  await panel.click('[data-tab=garden]');
  const card = panel.locator('#garden-requests li.request', { hasText: 'plan for' });
  await expect(card).toHaveCount(1);
  for (const del of await card.getByRole('button', { name: /^Delete: read_page .*\/moss/ }).all()) await del.click();
  await card.getByRole('button', { name: 'Yes', exact: true }).click();

  await expect.poll(async () => (run = await bg('runGet', { id: runId })).status, { timeout: 5 * 60_000 }).toMatch(/^(done|failed|stopped)$/);
  console.log(`  [${run.status}] ${(run.answer ?? run.why ?? '').replace(/\s+/g, ' ').slice(0, 200)}`);
  expect(run.status).toBe('done');
  expect(run.plan.some((c) => JSON.stringify(c.args).includes('/moss'))).toBe(false);
  expect(run.steps.some((s) => s.tool === 'read_page' && s.args.url === `${SHOP}/fern` && s.state === 'done')).toBe(true);
  expect(run.turns.filter((t) => t.purpose === 'choose')).toHaveLength(0);
  expect(run.turns.filter((t) => t.purpose === 'sum')).toHaveLength(1);
  expect(loads).toContain('/fern');
  expect(loads).not.toContain('/moss');
  expect(run.answer).toMatch(/12/);

  const row = panel.locator('#garden-runs li', { hasText: run.answer.slice(0, 40) });
  await expect(row.locator('.flower')).toHaveClass(/sprout|bloom/);
});
