// Memory and Documents end to end, no model (plan T7). A memory file is made and edited in Library → Memory; a run
// planted with an answered plan whose one call is doc_write ends with the file under Documents/<gardener> and a
// `doc` card. The run then stops at its sum think (no engine has its model); everything checked happens before.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { launch, ROOT } from './harness.mjs';

let ctx, sw, id, panel, g;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  ({ ctx, sw, id } = await launch({ userDataDir: path.join(ROOT, '.profile-test') }));
  panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  for (const r of await bg('runList', { limit: 1000 })) {
    if (['queued', 'running', 'waiting'].includes(r.status)) await bg('runStop', { id: r.id });
    await bg('runDelete', { id: r.id });
  }
  for (const x of await bg('gardenerList')) await bg('gardenerDelete', { id: x.id });
  for (const e of await bg('entityList')) await bg('entityDelete', { id: e.id });
  for (const d of await bg('docList')) await bg('docDelete', { id: d.id });
  g = await bg('gardenerSave', { gardener: { name: 'Scribe', instructions: 'Keep a plan file.', sites: ['shop.garden.test'], minutes: 10 } });
});

test.afterAll(async () => {
  await ctx?.close();
});

async function bg(cmd, args = {}) {
  const r = await panel.evaluate(([cmd, args]) => chrome.runtime.sendMessage({ target: 'bg', cmd, ...args }), [cmd, args]);
  if (!r?.ok) throw new Error(`${cmd}: ${r?.error}`);
  return r.result;
}

async function memoryTab() {
  await panel.click('.tabs [data-tab=library]');
  await panel.click('.lib-tabs [data-tab=memory]');
}

test('a person file "Maja" (alias "M.") is made in Library → Memory, edited in place, and kept across a reload', async () => {
  await memoryTab();
  await panel.selectOption('#memory-type', 'person');
  await panel.fill('#memory-name', 'Maja');
  await panel.fill('#memory-aliases', 'M.');
  await panel.getByRole('button', { name: 'New file' }).click();

  const tree = panel.locator('#memory-tree');
  await expect(tree.locator('summary', { hasText: 'People (1)' })).toBeVisible();
  await expect(tree.getByLabel('Aliases of Maja')).toHaveValue('M.');
  await tree.getByLabel('Body of Maja').fill('Prefers short emails. Works on the spring launch.');
  await tree.locator('details.file', { hasText: 'Maja' }).getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await bg('entityList'))[0]?.body).toBe('Prefers short emails. Works on the spring launch.');

  await panel.reload();
  await memoryTab();
  await panel.locator('#memory-tree summary', { hasText: 'People (1)' }).click();
  await panel.locator('#memory-tree summary', { hasText: 'Maja' }).click();
  await expect(panel.getByLabel('Body of Maja')).toHaveValue('Prefers short emails. Works on the spring launch.');
  const [maja] = await bg('entityList');
  expect([maja.name, maja.aliases, maja.by, maja.confirmed]).toEqual(['Maja', ['M.'], 'person', true]);
});

test('a planned doc_write ends with plan.md under Documents/Scribe and a doc card that opens it', async () => {
  const text = '1. Read the shop.\n2. Compare tea prices.';
  const run = {
    v: 1, id: 'doc-1', gardenerId: g.id, work: { kind: 'plan', request: 'Keep a plan for the tea hunt.' }, status: 'queued', queuedAt: Date.now(), usedMs: 0,
    model: 'no-model-here', maxTokens: 4096, agent: { loop: false, maxSteps: 8 }, abilities: ['plan'], plan: [{ tool: 'doc_write', args: { path: 'plan.md', text } }],
    turns: [], steps: [], requests: [], seen: [], tainted: false,
  };
  await panel.evaluate(async (run) => {
    const d = await new Promise((ok, no) => Object.assign(indexedDB.open('hg-garden'), { onsuccess: (e) => ok(e.target.result), onerror: no }));
    const t = d.transaction('runs', 'readwrite');
    t.objectStore('runs').put(run);
    await new Promise((ok, no) => Object.assign(t, { oncomplete: ok, onerror: no }));
    d.close();
  }, run);
  await sw.evaluate(() => self.gardenFire('none'));

  let r;
  await expect.poll(async () => (r = await bg('runGet', { id: 'doc-1' })).steps[0]?.state, { timeout: 60_000 }).toBe('done');
  const [doc] = await bg('docList', { gardenerId: g.id });
  expect([doc.path, doc.text, doc.by]).toEqual(['plan.md', text, 'model']);
  expect(r.created).toEqual([{ kind: 'doc', title: 'plan.md', ref: doc.id }]);
  expect(r.tainted).toBe(false); // writing reads nothing private

  await panel.reload();
  await panel.click('.tabs [data-tab=garden]');
  const row = panel.locator('#garden-runs li', { has: panel.locator('summary', { hasText: 'Open · 1 step' }) }).first();
  await row.locator('summary', { hasText: 'Open · 1 step' }).click();
  const card = row.locator('.created', { hasText: 'Document: plan.md' });
  await card.getByRole('button', { name: 'Open plan.md' }).click();
  await expect(panel.locator('#library')).toBeVisible();
  const tree = panel.locator('#memory-tree');
  await expect(tree.locator('summary', { hasText: 'Documents (1)' })).toBeVisible();
  await expect(tree.locator('summary', { hasText: 'Scribe (1)' })).toBeVisible();
  await expect(tree.getByLabel('Text of plan.md')).toHaveValue(text);
});
