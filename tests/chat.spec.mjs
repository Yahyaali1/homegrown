// Saved chats end to end. Only the interrupted-answer test uses the model (@slow); the rest plant chats in `hg-chat`
// or go through the worker's handlers, as Chrome would call them.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { launch, serve, ROOT } from './harness.mjs';

let ctx, sw, id, panel, site;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  site = await serve(path.join(ROOT, 'tests/fixtures'));
  ({ ctx, sw, id } = await launch({ userDataDir: path.join(ROOT, '.profile-test') }));
  panel = await ctx.newPage();
  await panel.bringToFront();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.click('[data-tab=chat]');
  await panel.evaluate(() => new Promise((ok) => Object.assign(indexedDB.deleteDatabase('hg-chat'), { onsuccess: ok, onerror: ok, onblocked: ok })));
  await panel.reload();
});

test.afterAll(async () => {
  await ctx?.close();
  site?.server.close();
});

async function plant(chat) {
  await panel.evaluate(async (c) => {
    const d = await new Promise((ok, no) => Object.assign(indexedDB.open('hg-chat', 1), {
      onupgradeneeded: (e) => e.target.result.createObjectStore('chats', { keyPath: 'id' }), onsuccess: (e) => ok(e.target.result), onerror: no }));
    const t = d.transaction('chats', 'readwrite');
    t.objectStore('chats').put(c);
    await new Promise((ok, no) => Object.assign(t, { oncomplete: ok, onerror: no }));
    d.close();
  }, chat);
}

test('search finds a word in a saved chat, opens it and marks it; links in answers preview', async () => {
  await plant({ v: 1, id: 'bees', title: 'About pollinators', mode: 'fast', model: 'Gemma-4-E2B-it', createdAt: 1, updatedAt: 2, turns: [
    { role: 'user', text: 'How do bees talk?', at: 1 },
    { role: 'model', text: 'They use the **waggle** dance. See https://bees.example/dance for more.', at: 2 }] });
  await plant({ v: 1, id: 'tea', title: 'Tea', mode: 'fast', model: 'Gemma-4-E2B-it', createdAt: 1, updatedAt: 3, turns: [{ role: 'user', text: 'Oolong?', at: 1 }] });
  await panel.reload();
  await panel.click('#chats summary');
  await panel.fill('#chat-search', 'WAGGLE');
  await expect(panel.locator('#chat-list li')).toHaveCount(1);
  await panel.locator('#chat-list li button', { hasText: 'About pollinators' }).click();
  await expect(panel.locator('#messages mark')).toHaveText(['waggle']);
  await expect(panel.locator('#messages b mark')).toHaveCount(1); // inside the escaped markdown, as text
  const link = panel.locator('#messages a[data-preview]');
  await expect(link).toHaveAttribute('href', 'https://bees.example/dance');
  await expect(link).toHaveAttribute('title', 'https://bees.example/dance');
  await link.dispatchEvent('mouseover'); // hover() waits on paint, which a background headless page may not do
  await expect(panel.locator('.linkcard')).toContainText('bees.example');
  await expect(panel.locator('.linkcard').getByRole('button', { name: 'Read the page' })).toBeVisible(); // nothing fetched on hover
  await panel.fill('#chat-search', '');
});

test('Open in chat on a link reads it and attaches it to the next message', async () => {
  await sw.evaluate((i) => self.handleMenuClick(i, {}), { menuItemId: 'chat:link', linkUrl: `${site.url}/article.html`, pageUrl: `${site.url}/links.html` });
  await expect(panel.locator('#attached')).toBeVisible();
  await expect(panel.locator('#attached-text')).toContainText(`${site.url}/article.html`);
  await panel.click('#attached-clear');
});

test('openLink follows a same-site link in the active tab and opens another site beside it', async () => {
  const page = await ctx.newPage();
  await page.goto(`${site.url}/links.html`);
  await page.bringToFront();
  const tabs = async () => (await sw.evaluate(() => chrome.tabs.query({}))).map((t) => t.url);
  const openLink = (url) => panel.evaluate((url) => chrome.runtime.sendMessage({ target: 'bg', cmd: 'openLink', url }), url);
  await expect(sw.evaluate(() => self.bgHandlers.openLink({ url: 'https://example.com/' }))).rejects.toThrow(/own pages/); // no extension-page sender
  await openLink(`${site.url}/article.html`);
  await expect.poll(() => page.url()).toBe(`${site.url}/article.html`);
  const before = (await tabs()).length;
  await openLink('https://example.com/');
  await expect.poll(async () => (await tabs()).length).toBe(before + 1);
  expect((await openLink('javascript:alert(1)')).error).toMatch(/Only web links/);
  for (const p of ctx.pages()) if (p !== panel) await p.close();
});

test('chat @slow: an answer cut off by a reload shows Interrupted and Retry, and Retry answers again', async () => {
  await panel.bringToFront();
  await panel.click('#chat-clear');
  const t0 = Date.now();
  await panel.fill('#chat-input', 'Write a story of about 300 words about a bee who learns to dance.');
  await panel.click('#chat-send');
  const streaming = panel.locator('#messages li.model .text').last();
  await expect.poll(async () => (await streaming.innerText()).length, { timeout: 120000 }).toBeGreaterThan(60);
  // The partial answer is saved every second.
  await expect.poll(() => panel.evaluate(async (t0) => {
    const d = await new Promise((ok, no) => Object.assign(indexedDB.open('hg-chat'), { onsuccess: (e) => ok(e.target.result), onerror: no }));
    const chats = await new Promise((ok) => (d.transaction('chats').objectStore('chats').getAll().onsuccess = (e) => ok(e.target.result)));
    d.close();
    return chats.some((c) => c.updatedAt >= t0 && c.turns.at(-1)?.partial && c.turns.at(-1).text);
  }, t0)).toBe(true);
  await panel.reload();
  await expect(panel.locator('#messages .turn-actions .warn')).toHaveText('Interrupted');
  await expect(panel.locator('#messages li.model .text').last()).not.toBeEmpty();
  await panel.getByRole('button', { name: 'Retry this answer' }).click();
  await expect(panel.locator('#chat-stop')).toBeHidden({ timeout: 180000 });
  await expect(panel.locator('#messages .warn')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Helpful', exact: true })).toBeVisible();
  await panel.reload(); // the finished chat survives
  await expect(panel.locator('#messages li.user')).toContainText('bee who learns to dance');
  await expect(panel.locator('#messages li.model')).toHaveCount(1);
});
