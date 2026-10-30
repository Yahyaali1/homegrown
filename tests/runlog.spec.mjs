// Runs as chats end to end @slow: the real worker and model. A routine reads 3 pages; one fails once and is retried
// by itself after 30 s, one fails twice and is retried by hand from the run view. A follow-up (planted pin and plan,
// as no model is measured for plans) answers from the earlier answer. The shop is faked at its edge (ADR-14).
import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import { launch, engine, ROOT } from './harness.mjs';

const SHOP = 'https://shop.garden.test';
const PAGES = {
  '/fern': '<!doctype html><title>Ferns</title><h1>Ferns</h1><p>Boston fern: £12.</p>',
  '/moss': '<!doctype html><title>Moss</title><h1>Moss</h1><p>Cushion moss: £4.</p>',
  '/lichen': '<!doctype html><title>Lichen</title><h1>Lichen</h1><p>Map lichen: £7.</p>',
};
const FAILS = { '/moss': 1, '/lichen': 2 }; // document loads refused before a page is served
let ctx, sw, id, panel, g;
const loads = {};

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  ({ ctx, sw, id } = await launch({ userDataDir: path.join(ROOT, '.profile-test') }));
  await ctx.route(`${SHOP}/**`, (r) => {
    const { pathname } = new URL(r.request().url());
    if (r.request().resourceType() === 'document') loads[pathname] = (loads[pathname] ?? 0) + 1;
    if (r.request().resourceType() === 'document' && loads[pathname] <= (FAILS[pathname] ?? 0)) return r.abort('connectionrefused');
    r.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGES[pathname] ?? '<!doctype html><title>Not found</title>' });
  });
  panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  for (const r of await bg('runList', { limit: 1000 })) {
    if (['queued', 'running', 'waiting'].includes(r.status)) await bg('runStop', { id: r.id });
    await bg('runDelete', { id: r.id });
  }
  for (const x of await bg('gardenerList')) await bg('gardenerDelete', { id: x.id });
  g = await bg('gardenerSave', { gardener: { name: 'Pricer', instructions: 'Say briefly what each page sells and its price.', sites: ['shop.garden.test'], minutes: 10 } });
});

test.afterAll(async () => {
  await ctx?.close();
});

async function bg(cmd, args = {}) {
  const r = await panel.evaluate(([cmd, args]) => chrome.runtime.sendMessage({ target: 'bg', cmd, ...args }), [cmd, args]);
  if (!r?.ok) throw new Error(`${cmd}: ${r?.error}`);
  return r.result;
}

async function settled(runId) {
  let run;
  await expect.poll(async () => (run = await bg('runGet', { id: runId })).status, { timeout: 5 * 60_000 }).toMatch(/^(done|failed|stopped)$/);
  console.log(`  [${run.status}] ${(run.answer ?? run.why ?? '').replace(/\s+/g, ' ').slice(0, 200)}`);
  return run;
}

test('a routine reads 3 pages: one auto-retried, one retried by hand; Unread, Report @slow', async () => {
  const routine = await bg('routineSave', { routine: { gardenerId: g.id, name: 'Prices', when: { kind: 'every', hours: 24 }, work: { kind: 'read', urls: ['/fern', '/moss', '/lichen'].map((p) => SHOP + p) } } });
  const { id: runId } = await bg('gardenRun', { routineId: routine.id });
  let run = await settled(runId);
  console.log('  steps:', run.steps.map((s) => `${s.state}/${s.tries ?? 0} ${s.error ?? ''}`).join(' | '));
  expect(run.status).toBe('done');
  expect(run.steps.map((s) => [s.state, s.tries ?? 0])).toEqual([['done', 0], ['done', 1], ['failed', 1]]);
  expect(loads['/moss']).toBe(2);
  expect(loads['/lichen']).toBe(2);
  expect(run.answer).toMatch(/Couldn't read: .*lichen/);

  await panel.reload();
  await panel.click('[data-tab=garden]');
  const runs = panel.locator('#garden-runs');
  await expect(runs.locator('li.group-head').first()).toHaveText('Unread');
  const row = runs.locator('li', { hasText: 'Couldn\'t read' });
  await row.locator('summary', { hasText: /^Open/ }).click();
  await expect.poll(async () => (await bg('runGet', { id: runId })).seenAt).toBeTruthy();
  await expect(runs.locator('li.group-head').first()).toHaveText('Prices');

  // Report: a local file with no page text unless ticked.
  const [download] = await Promise.all([panel.waitForEvent('download'), row.getByRole('button', { name: 'Download a report of this run' }).click()]);
  expect(download.suggestedFilename()).toBe(`homegrown-report-${runId}.json`);
  const report = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  expect(report.steps).toHaveLength(3);
  expect(JSON.stringify(report)).not.toMatch(/Boston fern/);

  await row.getByRole('button', { name: 'Retry step 3' }).click();
  run = await settled(runId);
  expect(run.status).toBe('done');
  expect(run.steps.map((s) => [s.state, s.tries ?? 0])).toEqual([['done', 0], ['done', 1], ['done', 2]]);
  expect(run.turns.filter((t) => t.purpose === 'word')).toHaveLength(1);
  expect(run.answer).not.toMatch(/Couldn't read/);
  expect(run.answer).toMatch(/fern/i);
  expect(run.answer).toMatch(/moss/i);
  expect(run.answer).toMatch(/lichen/i);
});

test('Ask a follow-up: refused in words with no plan model; a planted follow-up answers from the earlier answer @slow', async () => {
  const m = await engine(sw, 'resolve', {});
  const base = { v: 1, gardenerId: g.id, usedMs: 0, turns: [], steps: [], requests: [], tainted: false, queuedAt: Date.now() };
  const earlier = { ...base, id: `earlier-${Date.now()}`, work: { kind: 'read', urls: [`${SHOP}/fern`] }, status: 'done', endedAt: Date.now(), seenAt: Date.now(),
    answer: 'The Boston fern costs £12.', seen: [] };
  const request = 'How much did the Boston fern cost? Give the price.';
  const follow = { ...base, id: `follow-${Date.now()}`, followUp: earlier.id, work: { kind: 'plan', request }, status: 'queued',
    model: m.name, maxTokens: m.maxTokens, agent: { loop: false, maxSteps: 8 }, abilities: ['plan'], plan: [{ tool: 'read_page', args: { url: `${SHOP}/moss` } }],
    requests: [{ id: 'p', kind: 'plan', calls: [{ tool: 'read_page', args: { url: `${SHOP}/moss` } }], text: 'plan', sensitive: false, answer: { value: 'yes', at: Date.now() } }],
    seen: [{ url: `${SHOP}/moss`, from: 'approved' }] };
  await panel.evaluate(async (runs) => {
    const d = await new Promise((ok, no) => Object.assign(indexedDB.open('hg-garden'), { onsuccess: (e) => ok(e.target.result), onerror: no }));
    const t = d.transaction('runs', 'readwrite');
    for (const run of runs) t.objectStore('runs').put(run);
    await new Promise((ok, no) => Object.assign(t, { oncomplete: ok, onerror: no }));
    d.close();
  }, [earlier]);

  // By hand: the earlier run's box asks the worker, which says in words that no model can plan yet.
  await panel.reload();
  await panel.click('[data-tab=garden]');
  const row = panel.locator('#garden-runs li', { hasText: 'The Boston fern costs £12.' });
  await row.getByLabel('Ask a follow-up').fill(request);
  await row.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(row.locator('.err', { hasText: /plans|open requests/ })).toBeVisible();

  await panel.evaluate(async (run) => {
    const d = await new Promise((ok, no) => Object.assign(indexedDB.open('hg-garden'), { onsuccess: (e) => ok(e.target.result), onerror: no }));
    const t = d.transaction('runs', 'readwrite');
    t.objectStore('runs').put(run);
    await new Promise((ok, no) => Object.assign(t, { oncomplete: ok, onerror: no }));
    d.close();
  }, follow);
  await sw.evaluate(() => self.gardenFire('none'));
  const run = await settled(follow.id);
  expect(run.status).toBe('done');
  expect(run.turns.map((t) => t.purpose)).toEqual(['sum']);
  expect(run.answer).toMatch(/12/);
  await expect(panel.locator('#garden-runs li', { hasText: run.answer.slice(0, 40) }).locator('.muted', { hasText: '(a follow-up)' })).toHaveCount(1);
});
