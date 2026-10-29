// Triggers end to end, no model: an event routine's check is code, so the test fires it through gardenFire and reads
// the run it made (stopped before any think). The watched page is faked at its edge (ADR-14) and off the gardener's
// sites, so it is read signed out.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { launch, ROOT } from './harness.mjs';

const SHOP = 'https://shop.garden.test';
const NEWS = 'https://news.garden.test';
let ctx, sw, id, panel, g;
let news = '<!doctype html><title>News</title><p>Spring sale soon.</p>';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  ({ ctx, sw, id } = await launch({ userDataDir: path.join(ROOT, '.profile-test') }));
  await ctx.route(`${NEWS}/**`, (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: news }));
  await ctx.route(`${SHOP}/**`, (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>Shop</title><p>Tea</p>' }));
  panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  for (const r of await bg('runList', { limit: 1000 })) {
    if (['queued', 'running', 'waiting'].includes(r.status)) await bg('runStop', { id: r.id });
    await bg('runDelete', { id: r.id });
  }
  for (const x of await bg('gardenerList')) await bg('gardenerDelete', { id: x.id });
  g = await bg('gardenerSave', { gardener: { name: 'Watcher', instructions: 'Say what changed.', sites: ['shop.garden.test'], minutes: 10 } });
});

test.afterAll(async () => {
  await ctx?.close();
});

async function bg(cmd, args = {}) {
  const r = await panel.evaluate(([cmd, args]) => chrome.runtime.sendMessage({ target: 'bg', cmd, ...args }), [cmd, args]);
  if (!r?.ok) throw new Error(`${cmd}: ${r?.error}`);
  return r.result;
}

const idbPut = (store, change, key) => panel.evaluate(async ([store, change, key]) => {
  const d = await new Promise((ok, no) => Object.assign(indexedDB.open('hg-garden', 1), { onsuccess: (e) => ok(e.target.result), onerror: no }));
  const t = d.transaction(store, 'readwrite');
  const os = t.objectStore(store);
  const old = await new Promise((ok) => (os.get(key).onsuccess = (e) => ok(e.target.result)));
  os.put({ ...old, ...change });
  await new Promise((ok, no) => Object.assign(t, { oncomplete: ok, onerror: no }));
  d.close();
}, [store, change, key]);

test('an event routine fires through gardenFire after the page changes, and not before', async () => {
  const r = await bg('routineSave', { routine: { gardenerId: g.id, name: 'Sale watch', when: { kind: 'event', url: `${NEWS}/`, every: 15, onlyIf: ['price'] }, work: { kind: 'read', urls: [`${SHOP}/tea`] } } });
  const fire = async () => {
    await idbPut('routines', { nextDue: Date.now() - 1000 }, r.id);
    await sw.evaluate((rid) => self.gardenFire(rid), r.id);
    return bg('runList', { gardenerId: g.id });
  };
  expect(await fire()).toHaveLength(0); // the first look only sets the snapshot
  expect((await bg('routineList', { gardenerId: g.id }))[0].nextDue).toBeGreaterThan(Date.now());
  expect(await fire()).toHaveLength(0); // unchanged
  news = '<!doctype html><title>News</title><p>Spring sale soon.</p><p>Opening hours: 9 to 5.</p>';
  expect(await fire()).toHaveLength(0); // changed, but no new line says "price"
  news += '<p>New price: £7 a tin.</p>';
  const [run] = await fire();
  expect(run.routineId).toBe(r.id);
  await bg('runStop', { id: run.id }).catch(() => {}); // no model here: what the check stored is what counts
  const stored = await bg('runGet', { id: run.id });
  expect(stored.trigger).toMatchObject({ url: `${NEWS}/`, signedIn: false });
  expect(stored.trigger.diff).toContain('+ New price: £7 a tin.');
  expect(stored.tainted).toBe(false);
});

test('the routine form previews the next 5 dates', async () => {
  await panel.reload();
  await panel.click('[data-tab=garden]');
  const add = panel.locator('details', { has: panel.locator('summary', { hasText: 'Add a routine' }) }).first();
  await add.getByText('Add a routine', { exact: true }).click();
  await add.getByLabel('When').selectOption('monthly');
  await add.getByLabel('Which week').selectOption('-1');
  await expect(add.getByLabel('Next runs').locator('li')).toHaveCount(5);
  await add.getByLabel('When').selectOption('event');
  await add.getByLabel('Page to watch').fill(`${NEWS}/`);
  await expect(add.getByLabel('Next runs').locator('li')).toHaveCount(5);
});
