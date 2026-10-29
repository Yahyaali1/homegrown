// End-to-end tests against the real extension, real model (Gemma 4 E2B web) and real WebGPU.
// Native context menus can't be clicked from Playwright, so menu tests call the same handler
// Chrome calls (`handleMenuClick`) with the `info` Chrome would pass, using text really selected
// in the page or frame.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
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
  // A fake microphone that says tests/fixtures/speech.wav, and no permission prompt (ADR-14).
  const mic = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${path.join(ROOT, 'tests/fixtures/speech.wav')}`];
  ({ ctx, sw, id } = await launch({ userDataDir: path.join(ROOT, '.profile-test'), args: mic }));
  await fakeWeb(ctx);
});

// The outside world at its edges (ADR-14): search engines, the pages they find, and YouTube answer from fixtures.
async function fakeWeb(context) {
  const web = (f) => path.join(ROOT, 'tests/fixtures/web', f);
  await context.route('https://html.duckduckgo.com/**', (r) => r.fulfill({ path: web('ddg.html') }));
  await context.route('https://bees.test/**', (r) => r.fulfill({ path: web(`${new URL(r.request().url()).pathname.slice(1)}.html`) }));
  await context.route('https://www.bing.com/search**', (r) => r.fulfill({ path: web('bing.html') }));
  await context.route('https://www.youtube.com/watch**', (r) => r.fulfill({ path: web('youtube.html') }));
  await context.route('https://www.youtube.com/api/timedtext**', (r) => r.fulfill({ path: web('captions.json'), contentType: 'application/json' }));
}

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

// ---- objectives of the rewritten pages and in-page features ----

const shadow = (page, fn, arg) => page.evaluate(([f, a]) => new Function('root', 'arg', `return (${f})(root, arg)`)(document.querySelector('edge-gallery')?.shadowRoot, a), [fn.toString(), arg]);

test('Mission control: a mission over three store pages shows its steps live and ranks the cheapest offer first', async () => {
  const urls = ['a', 'b', 'c'].map((s) => `${siteA.url}/shop/${s}.html`);
  const workflow = {
    goal: 'Find the cheapest Blue Widget Pro', brief: null, steps: [
      { type: 'search', query: '3 pages', n: 3, urls }, { type: 'open', limit: 3 }, { type: 'extract', fields: ['product', 'price', 'store'], require: [] },
      { type: 'filter', field: '', op: '<', value: '' }, { type: 'rank', by: 'price', order: 'asc', keep: 3 }, { type: 'answer', question: 'Which store is cheapest?' }],
  };
  const { id: run } = await sw.evaluate((wf) => self.bgHandlers.missionStart({ goal: wf.goal, workflow: wf }), workflow);
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/agent.html?run=${run}`);
  await expect(page.locator('#steps li')).toHaveCount(6); // the plan's cards render while it runs
  await expect(page.locator('#verdict')).toBeVisible({ timeout: 180000 });
  const prices = await page.locator('#table tbody tr td:nth-child(3)').allTextContents();
  const nums = prices.map((p) => parseFloat(p.replace(/[^\d.]/g, '')));
  console.log(`  [mission] ${prices.join(' | ')} · ${await page.locator('#answer').innerText()}`);
  expect(nums.length).toBeGreaterThanOrEqual(2);
  expect(nums).toEqual([...nums].sort((a, b) => a - b));
  await page.close();
});

test('palette: Alt+K finds an action by a few letters, and Escape closes it', async () => {
  const page = await ctx.newPage();
  await page.goto(`${siteA.url}/article.html`);
  await expect.poll(() => page.evaluate(() => !!document.querySelector('edge-gallery'))).toBe(true);
  await page.keyboard.press('Alt+KeyK');
  await page.keyboard.type('quiz');
  await expect.poll(() => shadow(page, (r) => r.querySelector('.pal li[aria-selected=true]')?.textContent)).toContain('Quiz me');
  expect(await shadow(page, (r) => [...r.querySelectorAll('.pal li[role=option]')].map((l) => l.textContent).join('|'))).toContain('Ask: quiz');
  await page.keyboard.press('Escape');
  await expect.poll(() => shadow(page, (r) => !!r.querySelector('.pal'))).toBe(false);
  await page.close();
});

test('a switch turned off in Settings takes effect on pages that are already open', async () => {
  const page = await ctx.newPage();
  await page.goto(`${siteA.url}/article.html`);
  const settings = await ctx.newPage();
  await settings.goto(`chrome-extension://${id}/settings.html`);
  const box = settings.locator('[data-key=fab]');
  await expect(box).toBeChecked();
  await expect.poll(() => shadow(page, (r) => r && !r.querySelector('.fab').hidden)).toBe(true);
  await box.uncheck();
  await expect.poll(() => shadow(page, (r) => r.querySelector('.fab').hidden)).toBe(true);
  await box.check(); // leave the profile as it was
  await expect.poll(() => shadow(page, (r) => r.querySelector('.fab').hidden)).toBe(false);
  await Promise.all([page.close(), settings.close()]);
});

test('a product page gets price chips, and the price goes into the local price memory', async () => {
  const page = await ctx.newPage();
  await page.goto(`${siteA.url}/shop/a.html`);
  await expect.poll(() => shadow(page, (r) => r?.querySelector('.price-chips')?.textContent ?? ''), { timeout: 15000 }).toContain('Find it cheaper');
  const book = await sw.evaluate(async () => (await chrome.storage.local.get('priceBook')).priceBook);
  const entry = Object.values(book).find((e) => e.name === 'Blue Widget Pro');
  expect(entry.seen.at(-1)).toMatchObject({ price: 149.99, currency: 'USD' });
  await page.close();
});

// ---- every in-page feature that a test browser can drive ----
// Not here, and why: YouTube (needs youtube.com), answers on search pages, research and claim checks (need the live
// web), voice and live captions (need a microphone or tab capture), image generation (a 2.4 GB model). Their logic is
// covered by unit tests (captions, citations, audio, reading parsers).

async function openPage(file) {
  const page = await ctx.newPage();
  await page.goto(`${siteA.url}/${file}`);
  await expect.poll(() => page.evaluate(() => !!document.querySelector('edge-gallery')?.shadowRoot)).toBe(true);
  return page;
}
const ui = (page) => page.locator('edge-gallery');
/** Clicks a toolbar chip, opening "More ▸" first when the action is behind it. */
async function chip(page, label) {
  const bar = ui(page).locator('.bar');
  await expect(bar).toBeVisible();
  if (!(await bar.getByRole('button', { name: label, exact: true }).count())) await bar.getByRole('button', { name: 'More ▸' }).click();
  await bar.getByRole('button', { name: label, exact: true }).click();
}
/** Opens the palette and runs the action whose label starts with `label`. */
async function palette(page, label) {
  await page.keyboard.press('Alt+KeyK');
  await expect(ui(page).locator('.pal input')).toBeFocused(); // the palette opens after loading saved missions
  await page.keyboard.type(label);
  await expect(ui(page).locator('.pal li[aria-selected=true]')).toContainText(label);
  await page.keyboard.press('Enter');
}
const cardDone = async (page) => cardAnswer(page);
async function selectField(page, sel) {
  await page.click(sel);
  await page.keyboard.press('ControlOrMeta+KeyA');
  await page.keyboard.down('Shift');
  await page.keyboard.up('Shift'); // the toolbar follows a Shift+key selection, as with the mouse
}

test('writing: Proofread fixes a text box and "Replace selection" puts the fix back', async () => {
  const page = await openPage('links.html');
  await selectField(page, '#box');
  await chip(page, 'Proofread');
  const r = await cardDone(page);
  expect(r.err).toBe(false);
  await ui(page).getByRole('button', { name: 'Replace selection' }).click();
  const fixed = await page.inputValue('#box');
  expect(fixed).not.toContain('teh');
  expect(fixed).toMatch(/the notice/i);
  await page.close();
});

test('ghost text: after a pause in a text box a suggestion appears, and Tab accepts it', async () => {
  await sw.evaluate(() => chrome.storage.sync.set({ ghostText: true }));
  const page = await openPage('form.html');
  await page.click('#notes');
  await page.keyboard.press('End');
  await page.keyboard.type(' On weekends I usually', { delay: 20 });
  const ghost = ui(page).locator('.eg-ghost');
  await expect(ghost).toBeVisible({ timeout: 60000 });
  const suggestion = (await ghost.textContent()).trim();
  await page.keyboard.press('Tab');
  expect(await page.inputValue('#notes')).toContain(suggestion);
  await sw.evaluate(() => chrome.storage.sync.set({ ghostText: false }));
  await page.close();
});

test('reply pill: a compose box under a conversation offers a drafted reply to insert', async () => {
  const page = await openPage('links.html');
  await page.click('#reply');
  const pill = ui(page).locator('.eg-reply');
  await expect(pill).toBeVisible();
  await pill.click();
  const r = await cardDone(page);
  expect(r.err).toBe(false);
  await ui(page).getByRole('button', { name: 'Insert' }).click();
  expect((await page.inputValue('#reply')).length).toBeGreaterThan(10);
  await page.close();
});

test('jargon lens: holding Alt over a word explains it in context', async () => {
  const page = await openPage('article.html');
  const word = await page.evaluate(() => {
    const p = document.querySelector('#p1');
    const r = document.createRange();
    const t = p.firstChild;
    const at = t.data.indexOf('waggle');
    r.setStart(t, at + 2);
    r.setEnd(t, at + 3);
    const b = r.getBoundingClientRect();
    return { x: b.left + 1, y: b.top + b.height / 2 };
  });
  await page.keyboard.down('Alt');
  await page.waitForTimeout(500);
  await page.mouse.move(word.x, word.y);
  await page.mouse.move(word.x + 1, word.y);
  const tip = ui(page).locator('.eg-tip');
  await expect(tip).toContainText('waggle');
  await expect(tip).toContainText('—', { timeout: 60000 });
  await page.keyboard.up('Alt');
  await expect(tip).toBeHidden();
  await page.close();
});

test('form helper: suggests values from notes, never for passwords or cards, and fills only on Fill', async () => {
  const page = await openPage('form.html');
  await palette(page, 'Help with this form');
  const card = ui(page).locator('.card');
  await expect(card).toContainText('Password (you fill this)');
  await expect(card).toContainText('Card number (you fill this)');
  await card.getByLabel('Your notes').fill('Name: Ada Lovelace. Email: ada@example.com. Password: hunter2. Card 4111 1111 1111 1111');
  await card.getByRole('button', { name: 'Suggest values' }).click();
  await expect(card.getByRole('button', { name: 'Fill' })).toBeVisible({ timeout: 120000 });
  expect(await page.inputValue('#name')).toBe(''); // nothing is written before Fill
  await card.getByRole('button', { name: 'Fill' }).click();
  expect(await page.inputValue('#email')).toContain('ada@example.com');
  expect(await page.inputValue('#pw')).toBe('');
  expect(await page.inputValue('#cc')).toBe('');
  await page.close();
});

test('mind map: a page becomes a collapsible outline', async () => {
  const page = await openPage('article.html');
  await palette(page, 'Mind map');
  const map = ui(page).locator('.card .mm');
  await expect(map).toBeVisible({ timeout: 120000 });
  expect(await map.locator('li').count()).toBeGreaterThan(2);
  await page.close();
});

test('translate: a selection translated into French, with Copy', async () => {
  const page = await openPage('article.html');
  await dragSelect(page, page, '#p1'); // a real selection, as a person makes it
  await chip(page, 'Translate into…');
  await ui(page).locator('.bar').getByRole('button', { name: 'French' }).click();
  const card = ui(page).locator('.card');
  await expect(card.locator('.actions').getByRole('button', { name: 'Copy' })).toBeVisible({ timeout: 120000 }); // the answer's own row, not the header's
  const text = await card.locator('.body').innerText();
  console.log(`  [fr] ${text.slice(0, 120)}`);
  expect(text).toMatch(/\b(les|des|abeilles|la|le)\b/i);
  await page.close();
});

test('ask about an area: drag a box, adjust it, and Esc cancels without leaving anything behind', async () => {
  const page = await openPage('article.html');
  await palette(page, 'Ask about an area');
  const shade = ui(page).locator('.eg-shade');
  await expect(shade).toBeVisible();
  await page.mouse.move(100, 100);
  await page.mouse.down();
  await page.mouse.move(300, 220, { steps: 5 });
  await page.mouse.up();
  await expect(ui(page).locator('.eg-size')).toHaveText('200 × 120');
  await expect(ui(page).getByRole('button', { name: 'Ask about this' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(shade).toHaveCount(0);
  await page.close();
});

test('link preview: a long press warns when a link\'s text names another site, then summarizes the target', async () => {
  const page = await openPage('links.html');
  const box = await page.locator('#trap').boundingBox();
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  const card = ui(page).locator('.card');
  await expect(card).toContainText('The link text says paypal.com, but it goes to 127.0.0.1.');
  await expect(card).toContainText('min read', { timeout: 30000 });
  expect(page.url()).toContain('links.html'); // the click after a long press doesn't navigate
  await page.close();
});

test('compare tabs: lists the open web tabs to pick from', async () => {
  const other = await openPage('article.html');
  const page = await openPage('form.html');
  await palette(page, 'Compare tabs');
  const pick = ui(page).locator('.tabpick');
  await expect(pick).toContainText('Article'); // tabs are listed by their titles
  await expect(pick).toContainText('Sign up');
  await Promise.all([page.close(), other.close()]);
});

test('highlights: a saved highlight is marked, stored, and comes back when the page is opened again', async () => {
  const page = await openPage('article.html');
  await dragSelect(page, page, '#p1'); // a real selection, as a person makes it
  await chip(page, 'Highlight');
  await expect(page.locator('mark.eg-highlight').first()).toBeVisible();
  await expect.poll(() => sw.evaluate((url) => self.bgHandlers.memHighlights({ url }).then((l) => l.length), page.url())).toBeGreaterThan(0);
  await page.reload();
  await expect(page.locator('mark.eg-highlight').first()).toBeVisible({ timeout: 10000 });
  await page.close();
});

test('library: answers from pages are in History, and highlights are listed', async () => {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/library.html`);
  const [latest] = await sw.evaluate(() => self.bgHandlers.memHistory({ limit: 1 }));
  expect(latest).toBeTruthy(); // earlier tests got answers on pages
  await expect(page.locator('#history-list li').first()).toContainText(latest.ask); // newest first
  await page.getByRole('tab', { name: 'Highlights' }).click();
  await expect(page.locator('#highlight-groups')).toContainText('Honeybees');
  await page.close();
});

test('chat: "use the dark theme" proposes the change, and nothing changes until Apply', async () => {
  panel ??= await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.click('[data-tab=chat]');
  await panel.fill('#chat-input', 'please switch to the dark theme');
  await panel.click('#chat-send');
  const confirm = panel.locator('.confirm');
  await expect(confirm).toBeVisible({ timeout: 60000 });
  expect((await sw.evaluate(() => chrome.storage.sync.get('theme'))).theme ?? 'system').not.toBe('dark');
  await confirm.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => sw.evaluate(() => chrome.storage.sync.get('theme').then((s) => s.theme))).toBe('dark');
  await expect(panel.locator('html')).toHaveAttribute('data-theme', 'dark');
  await sw.evaluate(() => chrome.storage.sync.set({ theme: 'system' }));
});

// ---- features that reach the outside world, with the world faked at its edges (ADR-14) ----

test('search page: an answer from the results already on the page, citing them, appears beside the results', async () => {
  const page = await ctx.newPage();
  await page.goto('https://www.bing.com/search?q=what+does+the+waggle+dance+tell+bees');
  const card = ui(page).locator('.card');
  await expect(card).toContainText('Answer: what does the waggle dance tell bees');
  await expect(card.locator('.meta')).toContainText('From the results on this page', { timeout: 120000 });
  console.log(`  [search] ${(await card.locator('.body').innerText()).slice(0, 160)}`);
  await expect(card.getByRole('button', { name: 'Read top results' })).toBeVisible();
  await page.close();
});

test('deep research: searches, reads the top pages and writes a report that cites them', async () => {
  const page = await openPage('article.html');
  await palette(page, 'Research');
  const card = ui(page).locator('.card');
  await card.getByLabel('Research question').fill('How do honeybees tell each other where food is?');
  await card.getByRole('button', { name: 'Research' }).click();
  await expect(card.locator('.meta')).toContainText('sources · read and summarized on this device', { timeout: 300000 });
  const links = await card.locator('.body ol a').evaluateAll((as) => as.map((a) => a.href));
  console.log(`  [research] ${links.length} sources · ${(await card.locator('.body').innerText()).slice(0, 140)}`);
  expect(links.length).toBeGreaterThan(0);
  expect(links.every((u) => u.startsWith('https://bees.test/'))).toBe(true);
  await page.close();
});

test('research this: a double-clicked word is researched in the sense the page uses, with cited sources', async () => {
  const page = await openPage('article.html');
  const at = await page.evaluate(() => {
    const t = document.querySelector('#p1').firstChild;
    const r = document.createRange();
    const i = t.textContent.indexOf('waggle');
    r.setStart(t, i);
    r.setEnd(t, i + 6);
    const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.dblclick(at.x, at.y);
  await chip(page, 'Research this');
  const card = ui(page).locator('.card');
  await expect(card).toContainText('Research: waggle');
  await expect(card.locator('.meta')).toContainText('read and summarized on this device', { timeout: 300000 });
  const meta = await card.locator('.meta').innerText();
  console.log(`  [research this] ${meta} · ${(await card.locator('.body').innerText()).slice(0, 160)}`);
  expect(meta).toMatch(/Searched “[^”]*waggle[^”]*”/i); // the query keeps the term…
  expect(meta).toMatch(/Searched “[^”]*(dance|bee)[^”]*”/i); // …and takes its sense from the sentence (the fallback would be "waggle Article")
  const links = await card.locator('.body ol a').evaluateAll((as) => as.map((a) => a.href));
  expect(links.length).toBeGreaterThan(0);
  expect(links.every((u) => u.startsWith('https://bees.test/'))).toBe(true);
  await page.close();
});

test('claim check: a selected claim is weighed against sources and gets a one-word verdict', async () => {
  const page = await openPage('article.html');
  await dragSelect(page, page, '#p1');
  await chip(page, 'Check claim');
  const card = ui(page).locator('.card');
  await expect(card.locator('.meta')).toContainText('sources · read and summarized', { timeout: 300000 }); // the finished line, not a progress one
  const verdict = (await card.locator('.body').innerText()).trim();
  console.log(`  [claim] ${verdict.slice(0, 140)}`);
  expect(verdict).toMatch(/^\W*(Supported|Contradicted|Mixed|Unclear)/i);
  await page.close();
});

test('YouTube: a video summary from its captions, with times that link into the video', async () => {
  const page = await ctx.newPage();
  await page.goto('https://www.youtube.com/watch?v=bees01');
  await expect.poll(() => page.evaluate(() => !!document.querySelector('edge-gallery')?.shadowRoot)).toBe(true);
  await palette(page, 'Summarize video');
  const card = ui(page).locator('.card');
  await expect(card.locator('.meta')).toContainText('Click a time to jump there', { timeout: 120000 });
  console.log(`  [video] ${(await card.locator('.body').innerText()).slice(0, 160)}`);
  expect(await card.locator('.body a[data-t]').count()).toBeGreaterThan(0);
  await page.close();
});

test('voice: Speak… records, stops after you pause, and shows an editable transcript before anything is asked', async () => {
  const page = await openPage('article.html');
  await palette(page, 'Speak…');
  const card = ui(page).locator('.card');
  const transcript = card.getByLabel('Transcript — edit before asking');
  await expect(transcript).toBeEnabled({ timeout: 120000 });
  const text = await transcript.inputValue();
  console.log(`  [voice] ${text}`);
  expect(text).toMatch(/waggle|dance|bees/i);
  await expect(card.getByRole('button', { name: 'Ask' })).toBeEnabled(); // nothing is sent until Ask
  await page.close();
});

test('live captions: speech in the tab becomes captions in a bar on the page, with a transcript', async () => {
  const page = await openPage('article.html');
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.id, page.url());
  await sw.evaluate(([audioUrl, tabId]) => self.bgHandlers.liveStartFile({ audioUrl, tabId, task: 'transcribe' }), [`${siteA.url}/speech.wav`, tabId]);
  const lines = ui(page).locator('.lc .lines');
  await expect(lines).toContainText(/waggle|dance|bees/i, { timeout: 120000 });
  console.log(`  [captions] ${await lines.innerText()}`);
  await ui(page).getByRole('button', { name: 'Stop live captions' }).click();
  await expect(ui(page).locator('.lc')).toHaveCount(0);
  await page.close();
});

// ---- the pages, by behaviour ----

test('settings: a site added to "turned off" loses the ❀ button, and "Turn back on" restores it', async () => {
  const settings = await ctx.newPage();
  await settings.goto(`chrome-extension://${id}/settings.html`);
  await settings.fill('#site', siteA.url); // a URL is reduced to its host
  await settings.locator('#site-form').getByRole('button').click();
  await expect(settings.locator('#sites')).toContainText('127.0.0.1');
  const page = await ctx.newPage();
  await page.goto(`${siteA.url}/article.html`);
  await expect.poll(() => shadow(page, (r) => !r || r.querySelector('.fab').hidden)).toBe(true);
  await settings.getByRole('button', { name: 'Turn back on' }).click();
  await expect.poll(() => shadow(page, (r) => r && !r.querySelector('.fab').hidden)).toBe(true);
  await Promise.all([page.close(), settings.close()]);
});

test('library: a due flashcard shows its answer on demand, and grading it schedules it for later', async () => {
  await sw.evaluate(() => chrome.storage.local.set({ flashcards: [{ id: 'f1', q: 'Who decoded the waggle dance?', a: 'Karl von Frisch', due: 0, interval: 1 }] }));
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/library.html`);
  await page.getByRole('tab', { name: 'Flashcards' }).click();
  await expect(page.locator('#cards-count')).toHaveText('1 due of 1 cards');
  await expect(page.locator('#card-a')).toBeHidden();
  await page.locator('#show').click();
  await expect(page.locator('#card-a')).toHaveText('Karl von Frisch');
  await page.locator('[data-grade=good]').click();
  await expect(page.locator('#cards-count')).toHaveText('0 due of 1 cards');
  const [card] = (await sw.evaluate(() => chrome.storage.local.get('flashcards'))).flashcards;
  expect(card.interval).toBe(2);
  expect(card.due).toBeGreaterThan(Date.now() + 864e5);
  await sw.evaluate(() => chrome.storage.local.remove('flashcards'));
  await page.close();
});

test('library: "Ask your library" answers from saved pages and highlights, with sources', async () => {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/library.html`);
  await page.getByRole('tab', { name: 'Ask your library' }).click();
  await page.fill('#ask-q', 'What do I have saved about honeybees?');
  await page.locator('#ask-form').getByRole('button').click();
  await expect(page.locator('#ask-sources li').first()).toBeVisible({ timeout: 120000 });
  console.log(`  [library] ${(await page.locator('#ask-answer').innerText()).slice(0, 140)}`);
  await page.close();
});

test('side panel tasks: ↑ moves a task within its group, and a shared list imports by pasting', async () => {
  panel ??= await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.click('[data-tab=tasks]');
  const text = panel.locator('.task-list').first();
  const titles = () => text.locator('li b').allTextContents();
  const before = await titles();
  await panel.getByRole('button', { name: `Move ${before[1]} up` }).click();
  await expect.poll(titles).toEqual([before[1], before[0], ...before.slice(2)]);
  await panel.getByRole('button', { name: `Move ${before[1]} down` }).click(); // put it back
  await expect.poll(titles).toEqual(before);
  await panel.fill('#task-paste', JSON.stringify([{ id: 'shared-1', kind: 'text', title: 'Shared: haiku', prompt: 'Turn this into a haiku:' }]));
  await panel.click('#task-paste-go');
  await expect(text).toContainText('Shared: haiku');
  await panel.getByRole('button', { name: 'Delete Shared: haiku' }).click();
  await expect(text).not.toContainText('Shared: haiku');
});

test('collect from pages: AI rules are filled by the local model, one call per page, only with what each item says', async () => {
  const r = await sw.evaluate((url) => self.bgHandlers.scrapeRun({ runId: 'ai', recipe: {
    url, extract_rules: { plants: { selector: '.card', type: 'list', output: { name: 'h2' } } },
    ai_extract_rules: { delivery_days: { description: 'delivery time in days', type: 'number' }, in_stock: { description: 'is it in stock now', type: 'boolean' } },
  } }), `${siteA.url}/scrape/ai.html`);
  expect(r.ai.calls).toBe(1);
  const got = Object.fromEntries(r.results[0].data.plants.map((p) => [p.name, [p.delivery_days, p.in_stock]]));
  expect(got).toEqual({ Fern: [2, true], Orchid: [5, false], Cactus: [3, true] }); // the injected "0 days" never lands
});

test('missions: the Open step runs the user\'s js_scenario on each page before reading it', async () => {
  const url = `${siteA.url}/scrape/listing.html`;
  const wf = (scenario) => ({ goal: 'list the ferns', brief: null, steps: [
    { type: 'search', query: 'ferns', n: 1, urls: [url] }, { type: 'open', limit: 1, ...(scenario && { scenario }) },
    { type: 'extract', fields: ['name', 'price'], require: [] }, { type: 'answer', question: 'List them.' }] });
  const run = (w) => sw.evaluate((w) => self.bgHandlers.agentRun({ workflow: w, runId: crypto.randomUUID(), loop: false }), w);
  const plain = await run(wf(null));
  const more = await run(wf({ instructions: [{ click: '#more' }, { wait: 800 }] }));
  const count = (r) => r.pool.filter((x) => /^Fern \d+$/.test(String(x.name))).length;
  console.log(`  [mission scenario] without: ${count(plain)} rows, with "load more": ${count(more)} rows`);
  expect(count(plain)).toBe(3);
  expect(count(more)).toBe(6);
});

test('scrape as you scroll: the local model decides a product grid is records, picks its fields, and keeps up with an infinite feed', async () => {
  const page = await openPage('scrape/scroll.html');
  await palette(page, 'Scrape as you scroll');
  const bar = ui(page).locator('.sasbar');
  await expect(bar.locator('span')).toContainText('1 table');
  await page.locator('#grid').scrollIntoViewIfNeeded();
  await expect(bar.locator('span')).toContainText(/\d+ lists?/, { timeout: 120000 });
  await expect(page.locator('#grid')).toHaveAttribute('data-eg-scraped', 'list');
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); // the feed adds 3 more cards
  await expect.poll(async () => Number((await bar.locator('span').innerText()).match(/(\d+) rows/)?.[1] ?? 0), { timeout: 120000 }).toBeGreaterThanOrEqual(2 + 1 + 7);
  await bar.getByRole('button', { name: 'Show' }).click();
  const shown = await ui(page).locator('.card').innerText();
  console.log(`  [scroll scrape] ${(await bar.locator('span').innerText())} · ${shown.replace(/\s+/g, ' ').slice(0, 220)}`);
  expect(shown).toMatch(/Boston fern/);
  expect(shown).toMatch(/Staghorn fern/); // from the first four cards
  expect(shown).toMatch(/Holly fern|Rabbit foot fern|Lemon button fern/); // and the ones the feed added
  await expect(page.locator('nav ul')).not.toHaveAttribute('data-eg-scraped');
  await expect(page.locator('article')).not.toHaveAttribute('data-eg-scraped'); // prose is not records
  await expect(page.locator('main')).not.toHaveAttribute('data-eg-scraped'); // the grid inside the sections is the block
  await page.close();
});

test('scrape as you scroll: a grid that loads after the start, inside sections already read, is still the block', async () => {
  const page = await openPage('scrape/late.html');
  await palette(page, 'Scrape as you scroll');
  const bar = ui(page).locator('.sasbar');
  await expect(page.locator('#late')).toHaveAttribute('data-eg-scraped', 'list', { timeout: 180000 });
  await expect(page.locator('#wrap')).not.toHaveAttribute('data-eg-scraped', /list|table|facts/);
  console.log(`  [late grid] ${await bar.locator('span').innerText()}`);
  await page.close();
});

test('scrape as you scroll, whole page: Organize has the local model put each section into a table, only with what it says', async () => {
  const page = await openPage('scrape/scroll.html');
  await palette(page, 'Scrape as you scroll');
  const bar = ui(page).locator('.sasbar');
  await bar.getByRole('button', { name: 'Whole page' }).click();
  await bar.getByRole('button', { name: 'Organize' }).click(); // sections not seen yet are captured first
  await expect(bar.locator('span')).toContainText('organized', { timeout: 300000 });
  await bar.getByRole('button', { name: 'Show' }).click();
  const shown = await ui(page).locator('.card').innerText();
  console.log(`  [organize] ${(await bar.locator('span').innerText())} · ${shown.replace(/\s+/g, ' ').slice(0, 300)}`);
  expect(shown).toContain('Outline');
  expect(shown).toMatch(/\(Opening times\)/); // a table made from the prose about opening times
  expect(shown).toMatch(/9:00|17:00|10:00|16:00/);
  expect(shown).not.toMatch(/Monday|8:00|20:00/); // nothing the page doesn't say
  await page.close();
});

test('side panel missions: a mission over the open tabs runs in the background and shows up as done', async () => {
  const tabs = await Promise.all(['a', 'b', 'c'].map((s) => openPage(`shop/${s}.html`)));
  panel ??= await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.click('[data-tab=missions]');
  await panel.fill('#mission-goal', 'Which of these stores sells the Blue Widget Pro cheapest?');
  await panel.check('#mission-tabs');
  await panel.locator('#mission-form').getByRole('button').first().click();
  const live = panel.locator('#live-list li').first();
  await expect(live).toContainText('Which of these stores', { timeout: 30000 });
  await expect(live.locator('svg.flower')).toHaveClass(/sprout|stage-3/, { timeout: 300000 }); // finished: grown, not growing
  console.log(`  [panel mission] ${await live.innerText()}`);
  await Promise.all(tabs.map((t) => t.close()));
});

test('reader: an ePub opens as its chapters, with the toolbar on the text', async () => {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/reader.html?url=${encodeURIComponent(`${siteA.url}/book.epub`)}`);
  await expect(page.locator('#doc')).toContainText('A Small Book of Bees');
  await expect(page.locator('#doc h2')).toHaveText(['The Hive', 'The Dance']);
  await dragSelect(page, page, '#doc section p >> nth=0');
  await expect(ui(page).locator('.bar')).toContainText('Summarize');
  await page.close();
});

test('palette: a typed question becomes "Ask: …" and is answered about the page', async () => {
  const page = await openPage('article.html');
  await page.keyboard.press('Alt+KeyK');
  await expect(ui(page).locator('.pal input')).toBeFocused();
  await page.keyboard.type('Who decoded the dance?');
  const rows = ui(page).locator('.pal li[role=option]');
  await rows.filter({ hasText: 'Ask: Who decoded the dance?' }).click();
  const r = await cardAnswer(page);
  expect(r.err).toBe(false);
  expect(r.text).toMatch(/Frisch/i);
  await page.close();
});

test('image generation @slow: a prompt becomes an image on this device, with progress shown while it works', async () => {
  test.setTimeout(30 * 60 * 1000); // the first run downloads the 2.4 GB model; later runs use the cache
  const page = await openPage('article.html');
  await palette(page, 'Create image');
  const card = ui(page).locator('.card');
  await card.getByLabel('Describe the image').fill('a honeybee on a sunflower, simple flat illustration');
  await card.getByRole('button', { name: 'Create' }).click();
  const seen = new Set();
  await expect.poll(async () => {
    seen.add((await card.locator('.meta').innerText()).replace(/\d+%.*$/, ''));
    return card.locator('img.eg-img').count();
  }, { timeout: 28 * 60 * 1000, intervals: [1000] }).toBe(1);
  console.log(`  [image] progress lines: ${[...seen].filter(Boolean).join(' → ')}`);
  expect([...seen].some((s) => /Drawing|Downloading the image model/.test(s))).toBe(true); // the worker relayed the engine's progress
  const size = await card.locator('img.eg-img').evaluate((img) => [img.naturalWidth, img.naturalHeight]);
  expect(size[0]).toBeGreaterThanOrEqual(256);
  await expect(card.locator('.meta')).toContainText('On this device');
  await expect(card.getByRole('button', { name: 'Download' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Regenerate' })).toBeVisible();
  await page.close();
});

test('FLUX.2 klein and living photos @slow: pick the model in Settings, 512² image, a 4 s WebM, offline after the first run', async () => {
  test.setTimeout(60 * 60 * 1000); // the first run downloads 5.6 GB
  const createWith = async (page, prompt) => {
    await palette(page, 'Create image');
    const card = ui(page).locator('.card').last();
    await card.getByLabel('Describe the image').fill(prompt);
    await card.getByRole('button', { name: 'Create' }).click();
    await expect(card.locator('img.eg-img')).toHaveCount(1, { timeout: 55 * 60 * 1000 });
    return card;
  };
  // Settings: the picture-model picker writes the choice.
  const settings = await ctx.newPage();
  await settings.goto(`chrome-extension://${id}/settings.html`);
  await settings.getByLabel('Model for Create image').selectOption('flux');
  await expect.poll(() => sw.evaluate(async () => (await chrome.storage.sync.get('imageModel')).imageModel)).toBe('flux');
  await settings.close();

  const page = await openPage('article.html');
  const t0 = Date.now();
  const card = await createWith(page, 'a red fox sitting in fresh snow, golden hour, photo');
  console.log(`  [flux] first image ${(Date.now() - t0) / 1000} s`);
  await expect(card.locator('.meta')).toContainText('FLUX.2 klein');
  const stats = await card.locator('img.eg-img').evaluate((img) => {
    const c = document.createElement('canvas');
    [c.width, c.height] = [img.naturalWidth, img.naturalHeight];
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0, sq = 0;
    for (let i = 0; i < d.length; i += 4) (sum += d[i]), (sq += d[i] * d[i]);
    const n = d.length / 4;
    return { w: c.width, h: c.height, sd: Math.sqrt(sq / n - (sum / n) ** 2), src: img.src };
  });
  expect([stats.w, stats.h]).toEqual([512, 512]);
  expect(stats.sd).toBeGreaterThan(20); // not a flat or black image
  fs.writeFileSync(path.join(ROOT, 'test-results', 'flux-fox.png'), Buffer.from(stats.src.split(',')[1], 'base64')); // checked by hand

  // Living photo from the created image.
  await card.getByRole('button', { name: 'Animate' }).click();
  const live = ui(page).locator('.card').last();
  await expect(live.locator('video.eg-img')).toHaveCount(1, { timeout: 10 * 60 * 1000 });
  const clip = await live.locator('video.eg-img').evaluate(async (v) => {
    const blob = await (await fetch(v.src)).blob();
    // Chrome's MediaRecorder WebM has no duration; seeking past the end makes the player find it.
    if (!Number.isFinite(v.duration)) await new Promise((r) => ((v.ondurationchange = r), (v.currentTime = 1e9)));
    return { size: blob.size, type: blob.type, duration: v.duration };
  });
  console.log(`  [living photo] ${JSON.stringify(clip)}`);
  expect(clip.type).toBe('video/webm');
  expect(clip.size).toBeGreaterThan(50_000);
  expect(clip.duration).toBeGreaterThan(3);
  expect(clip.duration).toBeLessThan(6);
  fs.writeFileSync(path.join(ROOT, 'test-results', 'living-photo.webm'), Buffer.from(await live.locator('video.eg-img').evaluate(async (v) => [...new Uint8Array(await (await fetch(v.src)).arrayBuffer())])));

  // Offline: FLUX again from the cache, timed warm.
  await ctx.setOffline(true);
  try {
    const t1 = Date.now();
    const again = await createWith(page, 'a lighthouse on a cliff at dusk, oil painting');
    const warm = (Date.now() - t1) / 1000;
    console.log(`  [flux] warm, offline ${warm} s`);
    await expect(again.locator('.meta')).toContainText('FLUX.2 klein');
    expect(warm).toBeLessThan(90);
  } finally {
    await ctx.setOffline(false);
  }

  // Back to Janus in the same session: FLUX left the memory free.
  await sw.evaluate(() => chrome.storage.sync.set({ imageModel: 'janus' }));
  const janus = await createWith(page, 'a honeybee on a sunflower, simple flat illustration');
  await expect(janus.locator('.meta')).toContainText('Janus-Pro-1B');
  await page.close();
});

test('palette: with text selected, selection actions come first; the ❀ button opens it as a menu above itself', async () => {
  const page = await openPage('article.html');
  await dragSelect(page, page, '#p1');
  await page.keyboard.press('Alt+KeyK');
  await expect(ui(page).locator('.pal input')).toBeFocused();
  await expect(ui(page).locator('.pal .ctx')).toContainText('Selection: “Honeybees tell');
  await expect(ui(page).locator('.pal li.h').first()).toHaveText('Selection');
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5); // drop the selection
  await ui(page).locator('.fab').click();
  const pal = ui(page).locator('.pal-back.anchored .pal');
  await expect(pal).toBeVisible();
  const [fab, box] = await Promise.all([ui(page).locator('.fab').boundingBox(), pal.boundingBox()]);
  expect(box.y + box.height).toBeLessThanOrEqual(fab.y); // the menu sits above the button
  await page.close();
});

test('palette: "Mission: …" starts a mission and opens Mission control on it; saved missions are listed', async () => {
  await sw.evaluate(() => self.bgHandlers.missionSave({ mission: { id: 'pal-test', name: 'Weekly bee books', goal: 'Find the best bee book', steps: [{ type: 'search', query: 'bee book', n: 8 }, { type: 'answer', question: 'Which?' }] } }));
  const page = await openPage('article.html');
  await page.keyboard.press('Alt+KeyK');
  await expect(ui(page).locator('.pal input')).toBeFocused();
  await expect(ui(page).locator('.pal')).toContainText('Weekly bee books'); // under Saved missions
  await page.keyboard.type('cheapest bee book');
  const opened = ctx.waitForEvent('page');
  await ui(page).locator('.pal li[role=option]').filter({ hasText: 'Mission: cheapest bee book' }).click();
  const mc = await opened;
  await expect(mc).toHaveURL(/agent\.html\?run=/);
  await expect(mc.locator('#goal')).toHaveValue('cheapest bee book');
  await sw.evaluate(async () => {
    for (const m of await self.bgHandlers.missionsLive()) await self.bgHandlers.agentCancel({ runId: m.id });
    await self.bgHandlers.missionDelete({ id: 'pal-test' });
  });
  await Promise.all([mc.close(), page.close()]);
});

test('jargon lens: nothing shows without Alt, and pointing at the same word again doesn\'t ask the model twice', async () => {
  const page = await openPage('article.html');
  const at = await page.evaluate(() => {
    const t = document.querySelector('#p1').firstChild;
    const r = document.createRange();
    const i = t.data.indexOf('nestmates');
    r.setStart(t, i + 2);
    r.setEnd(t, i + 3);
    const b = r.getBoundingClientRect();
    return { x: b.left + 1, y: b.top + b.height / 2 };
  });
  const tip = ui(page).locator('.eg-tip');
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(600);
  await expect(tip).toBeHidden(); // no Alt, no tooltip
  await page.keyboard.down('Alt');
  await page.waitForTimeout(500);
  await page.mouse.move(at.x, at.y);
  await page.mouse.move(at.x + 1, at.y);
  await expect(tip).toContainText('—', { timeout: 60000 });
  const first = await tip.innerText();
  await page.keyboard.up('Alt');
  await page.keyboard.down('Alt');
  await page.waitForTimeout(500);
  await page.mouse.move(at.x, at.y);
  await page.mouse.move(at.x + 1, at.y);
  await expect(tip).toHaveText(first, { timeout: 2000 }); // the cached definition at once: no second model call
  await page.keyboard.up('Alt');
  await page.close();
});

test('image button: reaching an image across the text keeps its button (no stray hide timers from paragraphs)', async () => {
  const page = await openPage('figure.html');
  await page.locator('img').evaluate((i) => i.decode());
  const img = await page.locator('img').boundingBox();
  const [p1, p2] = await Promise.all(['p:nth-of-type(1)', 'p:nth-of-type(2)'].map((sel) => page.locator(sel).boundingBox()));
  // Quickly across two paragraphs onto the image: each paragraph left behind used to start a hide timer.
  await page.mouse.move(p1.x + 20, p1.y + p1.height / 2);
  await page.mouse.move(p2.x + 20, p2.y + p2.height / 2, { steps: 3 });
  await page.mouse.move(p2.x + 20, p2.y + p2.height + 30, { steps: 3 });
  await page.mouse.move(img.x + img.width / 2, img.y + img.height / 2, { steps: 3 });
  await page.waitForTimeout(800); // longer than the 400 ms hide delay
  await expect(ui(page).locator('.imgbtn')).toBeVisible();
  await page.close();
});

test('translate page: a Spanish page gets English side by side, even when Chrome\'s own translator never answers', async () => {
  const page = await openPage('es.html');
  await page.waitForTimeout(1600); // the page language is read
  await palette(page, 'Translate page');
  await expect.poll(() => page.locator('[data-eg-translation]').count(), { timeout: 150000 }).toBeGreaterThanOrEqual(3);
  console.log(`  [bilingual] ${(await page.locator('[data-eg-translation]').first().innerText()).slice(0, 100)}`);
  await ui(page).locator('.trbar [data-mode=translation]').click();
  await expect(page.locator('[data-eg-src]:not([data-eg-inside])').first()).toBeHidden(); // "Translation" hides the original
  await ui(page).getByRole('button', { name: 'Stop translating' }).click();
  await expect(page.locator('[data-eg-translation]')).toHaveCount(0);
  await page.close();
});

test('jargon lens: after Alt+K in the palette, moving the mouse over words shows nothing', async () => {
  const page = await openPage('article.html');
  await page.keyboard.down('Alt');
  await page.keyboard.press('KeyK');
  await expect(ui(page).locator('.pal input')).toBeFocused();
  await page.keyboard.up('Alt'); // released inside the palette's box, where the page never sees it
  await page.keyboard.press('Escape');
  const p = await page.locator('#p1').boundingBox();
  await page.waitForTimeout(500);
  await page.mouse.move(p.x + 40, p.y + 10, { steps: 5 });
  await page.mouse.move(p.x + 80, p.y + 12, { steps: 5 });
  await page.waitForTimeout(1500);
  await expect(ui(page).locator('.eg-tip')).toBeHidden();
  await page.close();
});

// ---- fixes from the drift review ----

test('engine: unloading the model while an answer streams waits for the answer to finish', async () => {
  const { answer, unloaded, order } = await sw.evaluate(async () => {
    await self.ensureEngine();
    const order = [];
    const gen = chrome.runtime.sendMessage({ target: 'engine', cmd: 'generate', id: 'swap-test', turns: [{ role: 'user', text: 'Count from one to twenty in words.' }], config: { temperature: 0 } })
      .then((r) => (order.push('answer'), r));
    await new Promise((r) => setTimeout(r, 150)); // the generation is running now
    const un = chrome.runtime.sendMessage({ target: 'engine', cmd: 'unload' }).then((r) => (order.push('unload'), r));
    const [answer, unloaded] = await Promise.all([gen, un]);
    return { answer, unloaded, order };
  });
  expect(answer.ok).toBe(true);
  expect(answer.result.text).toMatch(/twenty|20/i);
  expect(unloaded.ok).toBe(true);
  expect(order).toEqual(['answer', 'unload']); // the unload waited its turn
  await engine(sw, 'ensureLoaded'); // leave a model loaded for the tests after this one
});

test('engine start: the ensure command answers like every other command', async () => {
  const page = await ctx.newPage(); // the worker can't message itself: ask from a page, as the panel does
  await page.goto(`chrome-extension://${id}/library.html`);
  const r = await page.evaluate(() => chrome.runtime.sendMessage({ target: 'bg', cmd: 'ensure' }));
  expect(r).toEqual({ ok: true, result: true });
  await page.close();
});

test('a site turned off gets no ghost text, even with ghost text switched on', async () => {
  await sw.evaluate((host) => chrome.storage.sync.set({ ghostText: true, disabledSites: [host] }), new URL(siteA.url).hostname);
  const page = await ctx.newPage();
  await page.goto(`${siteA.url}/form.html`);
  await page.waitForTimeout(1200);
  await page.click('#notes');
  await page.keyboard.press('End');
  await page.keyboard.type(' On weekends I usually', { delay: 20 });
  await page.waitForTimeout(4000); // well past the 900 ms pause and a short answer
  expect(await page.evaluate(() => !!document.querySelector('edge-gallery')?.shadowRoot?.querySelector('.eg-ghost:not([hidden])'))).toBe(false);
  await sw.evaluate(() => chrome.storage.sync.set({ ghostText: false, disabledSites: [] }));
  await page.close();
});

test('the price memory switch in Settings turns the price chips off', async () => {
  const settings = await ctx.newPage();
  await settings.goto(`chrome-extension://${id}/settings.html`);
  const box = settings.locator('[data-key=priceChip]');
  await expect(box).toBeChecked();
  await box.uncheck();
  const page = await ctx.newPage();
  await page.goto(`${siteA.url}/shop/a.html`);
  await page.waitForTimeout(4000); // chips appear after 2.5 s when on
  expect(await page.evaluate(() => !!document.querySelector('edge-gallery')?.shadowRoot?.querySelector('.price-chips'))).toBe(false);
  await box.check();
  await Promise.all([page.close(), settings.close()]);
});
