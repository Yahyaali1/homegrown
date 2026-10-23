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
