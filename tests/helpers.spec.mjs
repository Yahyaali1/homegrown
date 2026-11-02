// Helpers end to end @slow: the real worker and model. A routine reads 12 pages: 3 helper runs read 5, 5 and 2 of
// them with at most 3 run tabs open at once, the parent words once over all 12, and no tab is left. The shop is faked
// at its edge (ADR-14).
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { bgOn, emptyGarden, launch, ROOT } from './harness.mjs';

const SHOP = 'https://shop.garden.test';
const PLANTS = ['fern', 'moss', 'lichen', 'ivy', 'sage', 'mint', 'thyme', 'basil', 'dill', 'rue', 'tansy', 'yarrow'];
let ctx, sw, id, panel, bg, g;

test.beforeAll(async () => {
  ({ ctx, sw, id } = await launch({ userDataDir: path.join(ROOT, '.profile-test') }));
  await ctx.route(`${SHOP}/**`, async (r) => {
    const name = new URL(r.request().url()).pathname.slice(1);
    if (r.request().resourceType() === 'document') await new Promise((ok) => setTimeout(ok, 400)); // slow enough to overlap
    r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><title>${name}</title><h1>${name}</h1><p>One ${name} plant: £${PLANTS.indexOf(name) + 2}.</p>` });
  });
  panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  bg = bgOn(panel);
  await emptyGarden(bg);
  g = await bg('gardenerSave', { gardener: { name: 'Pricer', instructions: 'List every plant you read about by name.', sites: ['shop.garden.test'], minutes: 10 } });
});

test.afterAll(async () => {
  await ctx?.close();
});


test('a routine reads 12 pages with 3 helpers, at most 3 run tabs at once, and leaves no tab @slow', async () => {
  // Run tabs are the grouped ones; counted every 50 ms in the worker.
  await sw.evaluate(() => {
    self.__maxRunTabs = 0;
    self.__countTabs = setInterval(async () => {
      const n = (await chrome.tabs.query({})).filter((t) => t.groupId !== -1).length;
      self.__maxRunTabs = Math.max(self.__maxRunTabs, n);
    }, 50);
  });
  const routine = await bg('routineSave', { routine: { gardenerId: g.id, name: 'Herbs', when: { kind: 'every', hours: 24 }, work: { kind: 'read', urls: PLANTS.map((p) => `${SHOP}/${p}`) } } });
  const { id: runId } = await bg('gardenRun', { routineId: routine.id });
  let run;
  await expect.poll(async () => (run = await bg('runGet', { id: runId })).status, { timeout: 5 * 60_000 }).toMatch(/^(done|failed|stopped)$/);
  const max = await sw.evaluate(() => (clearInterval(self.__countTabs), self.__maxRunTabs));
  console.log(`  [${run.status}] max run tabs ${max}: ${(run.answer ?? run.why ?? '').replace(/\s+/g, ' ').slice(0, 300)}`);
  expect(run.status).toBe('done');
  const kids = (await bg('runList', { limit: 1000 })).filter((r) => r.parentId === runId).sort((a, b) => (a.id < b.id ? -1 : 1));
  expect(kids.map((k) => [k.status, k.work.urls.length])).toEqual([['done', 5], ['done', 5], ['done', 2]]);
  expect(kids.every((k) => k.turns.length === 0)).toBe(true);
  expect(run.steps.map((s) => s.state)).toEqual(PLANTS.map(() => 'done'));
  expect(run.turns.map((t) => t.purpose)).toEqual(['word']);
  expect(max).toBeLessThanOrEqual(3);
  expect(max).toBeGreaterThanOrEqual(2); // they did run side by side
  for (const p of PLANTS) expect(run.answer.toLowerCase()).toContain(p);
  expect((await sw.evaluate(() => chrome.tabs.query({}))).filter((t) => t.groupId !== -1 || (t.url ?? '').startsWith('https://shop.'))).toEqual([]);
});
