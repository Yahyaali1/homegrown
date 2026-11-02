// Companion Plaza end to end, no model: with `plaza` off a new tab is left alone; with it on, a new tab
// becomes Plaza with one still flower per gardener, and a click opens the side panel's chat for that gardener.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { bgOn, launch, ROOT } from './harness.mjs';

let ctx, panel, bg, id;

test.beforeAll(async () => {
  ({ ctx, id } = await launch({ userDataDir: path.join(ROOT, '.profile-test') }));
  panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  bg = bgOn(panel);
  await panel.evaluate(() => chrome.storage.sync.remove(['plaza', 'plazaHistory'])); // a killed run may leave it on
  for (const x of await bg('gardenerList')) await bg('gardenerDelete', { id: x.id });
  for (const s of await bg('skillList')) await bg('skillDelete', { id: s.id });
});

test.afterAll(async () => {
  await panel?.evaluate(() => chrome.storage.sync.remove(['plaza', 'plazaHistory'])).catch(() => {});
  await ctx?.close();
});

const newTab = () => panel.evaluate(() => chrome.tabs.create({ active: false }).then((t) => t.id));
const tabUrl = (tabId) => panel.evaluate((tabId) => chrome.tabs.get(tabId).then((t) => t.pendingUrl || t.url), tabId);

test('plaza: opt-in new tab, one still flower per gardener, a click opens its chat', async () => {
  await bg('hire', { presetId: 'rosa' });
  await bg('hire', { presetId: 'sally' });

  const plain = await newTab(); // off by default
  await panel.evaluate(() => chrome.storage.sync.set({ plaza: true }));
  const tab = await newTab();
  await expect.poll(() => tabUrl(tab)).toBe(`chrome-extension://${id}/plaza.html`);
  expect(await tabUrl(plain)).not.toContain('plaza.html'); // the worker has handled both tabs: the one opened while off stays Chrome's
  await expect.poll(() => ctx.pages().some((p) => p.url().includes('plaza.html'))).toBe(true);
  const plaza = ctx.pages().find((p) => p.url().includes('plaza.html'));
  const bed = plaza.locator('#bed > li');
  await expect(bed).toHaveCount(2);
  await expect(bed.filter({ hasText: 'Rosa' }).locator('svg.flower')).toHaveCount(1);
  await expect(bed.filter({ hasText: 'Sally' }).locator('svg.flower')).toHaveCount(1);
  // Still by default: no growth state on a resting flower.
  for (const c of await plaza.locator('#bed svg.flower').evaluateAll((xs) => xs.map((x) => x.getAttribute('class')))) expect(c.trim()).toBe('flower');

  await plaza.getByRole('button', { name: 'Ask Rosa' }).click();
  await expect(plaza.locator('#bed svg.flower.turn')).toHaveCount(1);
  await expect(panel.locator('#chat-input')).toHaveAttribute('placeholder', 'Ask Rosa…');
});
