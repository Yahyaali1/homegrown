// End-to-end tests against the real extension, real model (Gemma 4 E2B web) and real WebGPU.
// Native context menus can't be clicked from Playwright, so menu tests call the same handler
// Chrome calls (`handleMenuClick`) with the `info` Chrome would pass, using text really selected
// in the page or frame.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { serve, launch, engine, ROOT } from './harness.mjs';
import { modelById } from '../src/domain/model.ts';
const byName = (id) => { const s = modelById(id); return s && { name: s.id, modelFile: s.source.file }; };

const m = byName('Gemma-4-E2B-it');
let ctx, sw, id, models, siteA, siteB, panel;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  models = await serve(path.join(ROOT, 'models'), { cutAt: 300 << 20 });
  siteA = await serve(path.join(ROOT, 'tests/fixtures'));
  siteB = await serve(path.join(ROOT, 'tests/fixtures')); // different port = different origin
  ({ ctx, sw, id } = await launch({ userDataDir: path.join(ROOT, '.profile-test') }));
});

test.afterAll(async () => {
  await ctx?.close();
  for (const s of [models, siteA, siteB]) s?.server.close();
});

const status = async () => (await engine(sw, 'status')).models.find((x) => x.name === m.name);
// Clear the chat first so answer() can't pick up the previous reply.
async function menuClick(info) {
  await panel.evaluate(() => document.querySelector('#messages').replaceChildren());
  await sw.evaluate((i) => self.handleMenuClick(i, {}), info);
}

async function select(frame, selector) {
  return frame.evaluate((sel) => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector(sel));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    return getSelection().toString();
  }, selector);
}

// Waits until the panel finished the current request; returns the last message.
async function answer() {
  let last;
  await expect
    .poll(async () => {
      last = await panel.evaluate(() => {
        const li = [...document.querySelectorAll('#messages li')].at(-1);
        const done = document.querySelector('#chat-stop').hidden && li && li.className !== 'user' && li.textContent.length > 0;
        return done ? { cls: li.className, text: li.textContent, user: [...document.querySelectorAll('#messages li.user')].at(-1)?.textContent } : null;
      });
      return last;
    })
    .not.toBeNull();
  console.log(`  [${last.cls}] ${last.text.replace(/\s+/g, ' ').slice(0, 160)}`);
  return last;
}

test('WebGPU adapter is the integrated GPU', async () => {
  const info = await sw.evaluate(async () => {
    const a = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
    return { vendor: a.info.vendor, architecture: a.info.architecture, description: a.info.description };
  });
  console.log('adapter', info);
  expect(info.vendor).toBeTruthy();
});

test('model download resumes after a dropped connection', async () => {
  await engine(sw, 'remove', { name: m.name });
  const url = `${models.url}/${m.modelFile}`;
  await expect(engine(sw, 'download', { name: m.name, url })).rejects.toThrow(); // server cuts at 300 MB
  const partial = await status();
  expect(partial.downloaded).toBe(false);
  expect(partial.partial).toBeGreaterThan(0);

  await engine(sw, 'download', { name: m.name, url });
  expect(models.ranges.at(-1)).toBe(`bytes=${partial.partial}-`); // resumed, not restarted
  expect((await status()).downloaded).toBe(true);
});

test('chat streams an answer and shows stats', async () => {
  panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.click('[data-tab=chat]'); // the panel reopens on the last tab used
  await panel.fill('#chat-input', 'What is the capital of France? Answer in one word.');
  await panel.click('#chat-send');
  const a = await answer();
  expect(a.cls).toBe('model');
  expect(a.text).toMatch(/paris/i);
  await expect(panel.locator('#stats')).toBeVisible();
  expect(+(await panel.textContent('#s-decode'))).toBeGreaterThan(0);
  await expect(panel.locator('#model-line')).toContainText(m.name);
});

// Selects text with the real mouse so content.js sees a real mouseup, like a user would.
async function dragSelect(frame, page, selector) {
  const box = await frame.locator(selector).boundingBox();
  await page.mouse.move(box.x + 2, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 5, box.y + box.height - 8, { steps: 8 });
  await page.mouse.up();
}

// Waits for the in-page card to finish; returns its answer, meta line and error (if any).
async function cardAnswer(frame) {
  const card = frame.locator('edge-gallery .card');
  await expect.poll(async () => /tok\/s/.test(await card.locator('.meta').innerText()) || (await card.locator('.err').count()) > 0).toBe(true);
  const r = { text: await card.locator('.body').innerText(), meta: await card.locator('.meta').innerText(), err: (await card.locator('.err').count()) > 0 };
  console.log(`  [card${r.err ? ' error' : ''}] ${r.text.replace(/\s+/g, ' ').slice(0, 160)}`);
  return r;
}

test('in-page: select text, pick Summarize from the toolbar, answer streams into a card', async () => {
  const page = await ctx.newPage();
  await page.goto(`${siteA.url}/article.html`);
  await dragSelect(page, page, '#p1');
  await page.locator('edge-gallery .bar button', { hasText: 'Summarize' }).click();
  const a = await cardAnswer(page);
  expect(a.err).toBe(false);
  expect(a.text).toMatch(/bee|dance/i);
  expect(a.meta).toContain(m.name);
  // Follow-up keeps the conversation.
  await page.locator('edge-gallery .follow input').fill('In one word: what insect is this about?');
  await page.locator('edge-gallery .follow button').click();
  await expect(page.locator('edge-gallery .body .q')).toHaveCount(1);
  const b = await cardAnswer(page);
  expect(b.text.split('In one word').pop()).toMatch(/bee/i);
  await page.close();
});

test('in-page: toolbar works on a selection inside a cross-origin iframe', async () => {
  const page = await ctx.newPage();
  await page.goto(`${siteA.url}/iframe.html?inner=${encodeURIComponent(`${siteB.url}/article.html`)}`);
  await expect.poll(() => page.frames().find((f) => f.url().startsWith(siteB.url))).toBeTruthy();
  const frame = page.frames().find((f) => f.url().startsWith(siteB.url));
  await frame.waitForSelector('#p1');
  await dragSelect(frame, page, '#p1');
  await frame.locator('edge-gallery .bar button', { hasText: 'Explain' }).click();
  const a = await cardAnswer(frame);
  expect(a.err).toBe(false);
  expect(a.text).toMatch(/bee|dance|direction/i);
  await page.close();
});

test('text action: Translate a selection from a PDF', async () => {
  // Chrome's PDF viewer passes selectionText to context menus like any page; its text layer is
  // not reachable from Playwright, so we pass the PDF's sentence as the selection.
  const page = await ctx.newPage();
  await page.goto(`${siteA.url}/doc.pdf`).catch(() => {}); // PDF navigations report as downloads in headless
  const selectionText = "La photosynthese transforme la lumiere, l'eau et le dioxyde de carbone en glucose et en oxygene.";
  await menuClick({ menuItemId: 'task:translate', selectionText, pageUrl: `${siteA.url}/doc.pdf` });
  const a = await answer();
  expect(a.cls).toBe('model');
  expect(a.text).toMatch(/photosynthesis/i); // French in, English out (UI language)
  await page.close();
});

test('long selection is cut to fit the context window, with a warning', async () => {
  const sentence = 'Honeybees use the waggle dance to share the direction and distance of food. ';
  await menuClick({ menuItemId: 'task:summarize', selectionText: sentence.repeat(800) }); // ~60k chars
  const a = await answer();
  expect(a.cls).toBe('model');
  expect(a.text).toContain("longer than the model's context window");
});

test('a task saved in the Tasks tab shows up in the in-page toolbar', async () => {
  await sw.evaluate(() => chrome.storage.sync.remove('tasks'));
  await sw.evaluate(() => self.seedTasks());
  await panel.reload();
  await panel.click('[data-tab=tasks]');
  await panel.fill('#task-title', 'Haiku it');
  await panel.selectOption('#task-kind', 'text');
  await panel.fill('#task-prompt', 'Rewrite the following as a single short haiku:');
  await panel.click('#task-form button:not([type])');
  await expect(panel.locator('.task-list b', { hasText: 'Haiku it' })).toHaveCount(1);

  const page = await ctx.newPage();
  await page.goto(`${siteA.url}/article.html`);
  await dragSelect(page, page, '#p1');
  await page.locator('edge-gallery .bar button', { hasText: 'Haiku it' }).click();
  const a = await cardAnswer(page);
  expect(a.err).toBe(false);
  await page.close();
});

test('in-page image: the image button reads a cross-origin image with the local image reader', async () => {
  const page = await ctx.newPage();
  const srcUrl = `${siteB.url}/red-square.png`;
  await page.goto(`${siteA.url}/image.html?src=${encodeURIComponent(srcUrl)}`);
  await page.waitForFunction(() => document.getElementById('img').complete && window.blobUrl);
  await page.evaluate(() => Object.assign(document.getElementById('img').style, { width: '200px', height: '200px' }));
  await page.hover('#img');
  await page.locator('edge-gallery .imgbtn').click();
  await page.locator('edge-gallery .bar button', { hasText: 'Describe image' }).click();
  const a = await cardAnswer(page);
  expect(a.err).toBe(false);
  expect(a.meta).toContain('Florence-2'); // pixels were read on this device
  expect(a.text).toMatch(/red/i);

  // A blob: link the page has released fails with a clear message (the message a right-click sends).
  const blobUrl = await page.evaluate(() => window.blobUrl);
  await page.evaluate(() => URL.revokeObjectURL(window.blobUrl));
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url })).at(0)?.id, page.url());
  await sw.evaluate(async ([tabId, src]) => {
    const { tasks } = await chrome.storage.sync.get('tasks');
    await chrome.tabs.sendMessage(tabId, { type: 'menu', task: tasks.find((t) => t.id === 'describe'), srcUrl: src });
  }, [tabId, blobUrl]);
  const b = await cardAnswer(page);
  expect(b.err).toBe(true);
  expect(b.text).toContain("Can't read this image");
  await page.close();
});

test('works offline once the model is downloaded', async () => {
  await ctx.setOffline(true);
  try {
    expect(await panel.evaluate(() => fetch('https://huggingface.co').then(() => 'online', () => 'offline'))).toBe('offline');
    await panel.click('[data-tab=chat]');
    await panel.click('#chat-clear');
    await panel.fill('#chat-input', 'Name one primary color. One word.');
    await panel.click('#chat-send');
    const a = await answer();
    expect(a.cls).toBe('model');
    expect(a.text).toMatch(/red|blue|yellow/i);
  } finally {
    await ctx.setOffline(false);
  }
});
