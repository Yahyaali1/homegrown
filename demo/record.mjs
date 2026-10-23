// Records the README demo: every feature, on the real extension and the real local models, one clip per chapter.
// demo/edit.mjs then cuts the clips together with title cards. Run (models must be downloaded in the test profile):
//   npm run build && ./scripts/gpu.sh node demo/record.mjs && node demo/edit.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launch, serve, ROOT } from '../tests/harness.mjs';

const OUT = path.join(ROOT, 'demo/out');
const RAW = path.join(OUT, 'raw');
const W = 1280, H = 800;
const only = process.argv[2]?.split(','); // re-record some chapters, keeping the others
if (!only) fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(RAW, { recursive: true });

// The demo site lives on made-up domains, so stores really are different sites to the price memory.
const SITE = path.join(ROOT, 'demo/site');
const HOSTS = { 'fieldnotes.test': 'article.html', 'notasdecampo.test': 'es.html', 'mail.test': 'mail.html', 'notice.test': 'notice.html',
  'alpha-audio.test': 'shop-a.html', 'bravo-electronics.test': 'shop-b.html', 'cove-sound.test': 'shop-c.html' };
const url = (host) => `https://${host}/`;

const mic = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${path.join(ROOT, 'tests/fixtures/speech.wav')}`];
const { ctx, sw, id } = await launch({
  userDataDir: path.join(ROOT, '.profile-test'), args: mic,
  contextOptions: { viewport: { width: W, height: H }, recordVideo: { dir: RAW, size: { width: W, height: H } } },
});
// Pages come from made-up domains (so the stores are different sites to the price memory), except what the engine in
// the offscreen document fetches itself, which Playwright doesn't route: those come from a real local server.
const assets = await serve(SITE);
const fixtures = await serve(path.join(ROOT, 'tests/fixtures'));
await ctx.route(/^https:\/\/[a-z-]+\.test\//, (r) => {
  const u = new URL(r.request().url());
  const file = u.pathname === '/' ? HOSTS[u.hostname] ?? 'article.html' : u.pathname.slice(1);
  const local = path.join(SITE, file);
  if (!fs.existsSync(local)) return r.fulfill({ status: 404, body: 'not found' });
  return r.fulfill({ path: local });
});
// The article is read by the engine too (its image, by the image reader), so it comes from the real local server.
const ARTICLE = `${assets.url}/article.html`;
await ctx.route('https://www.youtube.com/watch**', (r) => r.fulfill({ path: path.join(SITE, 'youtube.html') }));
await ctx.route('https://www.youtube.com/bee.png', (r) => r.fulfill({ path: path.join(SITE, 'bee.png') }));
await ctx.route('https://www.youtube.com/api/timedtext**', (r) => r.fulfill({ path: path.join(ROOT, 'tests/fixtures/web/captions.json'), contentType: 'application/json' }));

// A macOS-style cursor drawn into every page (recordings don't include the real one), with a press ring on clicks.
await ctx.addInitScript(() => {
  if (window !== top) return;
  const put = () => {
    if (document.getElementById('demo-cursor') || !document.documentElement) return;
    const c = document.createElement('div');
    c.id = 'demo-cursor';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M5 2 L5 21 L10 16.5 L13.6 24 L16.8 22.5 L13.3 15.2 L20 15.2 Z" fill="#000" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    c.style.cssText = 'position:fixed;left:-40px;top:-40px;z-index:2147483647;pointer-events:none;transition:transform .12s ease;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))';
    document.documentElement.append(c);
    addEventListener('mousemove', (e) => { c.style.left = `${e.clientX - 5}px`; c.style.top = `${e.clientY - 2}px`; }, true);
    addEventListener('mousedown', () => (c.style.transform = 'scale(.85)'), true);
    addEventListener('mouseup', () => (c.style.transform = ''), true);
  };
  put();
  addEventListener('DOMContentLoaded', put);
});

// Start from a clean, light, default state.
await sw.evaluate(() => chrome.storage.sync.set({ theme: 'light', ghostText: true, toolbar: true, fab: true, disabledSites: [], translateTo: '', speechRate: 1 }));
await sw.evaluate(() => chrome.storage.local.remove(['priceBook', 'flashcards']));
await sw.evaluate(async () => (await chrome.storage.sync.remove('tasks'), self.seedTasks())); // the default tasks only
// Warm the model, so the first answer isn't a cold load.
await sw.evaluate(async () => (await self.ensureEngine(), chrome.runtime.sendMessage({ target: 'engine', cmd: 'ensureLoaded' })));

const ext = (f) => `chrome-extension://${id}/${f}`;
const shot = (page) => page.locator('edge-gallery');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mouse = { x: W / 2, y: H / 2 };

/** One chapter: a fresh page recorded to its own clip, with marks for where to start, speed up and end. */
async function chapter(name, run, { viewport } = {}) {
  if (only && !only.includes(name)) return;
  const page = await ctx.newPage();
  if (viewport) await page.setViewportSize(viewport);
  const t0 = Date.now();
  const marks = [];
  const at = () => (Date.now() - t0) / 1000;
  const c = {
    page,
    start: () => marks.push({ at: at(), kind: 'start' }),
    fast: (speed = 6) => marks.push({ at: at(), kind: 'speed', speed }),
    normal: () => marks.push({ at: at(), kind: 'speed', speed: 1 }),
    end: () => marks.push({ at: at(), kind: 'end' }),
    async move(x, y, steps = 28) {
      await page.mouse.move(x, y, { steps });
      mouse = { x, y };
    },
    async click(locator, { hold = 250 } = {}) {
      await locator.waitFor({ state: 'visible', timeout: 15000 }).catch(async (e) => {
        await page.screenshot({ path: path.join(OUT, `fail-${name}.png`) });
        throw e;
      });
      const b = await locator.boundingBox();
      await c.move(b.x + b.width / 2, b.y + b.height / 2);
      await sleep(hold);
      await page.mouse.down();
      await sleep(90);
      await page.mouse.up();
    },
    async select(locator) {
      const b = await locator.boundingBox();
      await c.move(b.x + 3, b.y + 8);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width - 6, b.y + b.height - 8, { steps: 40 });
      await page.mouse.up();
      mouse = { x: b.x + b.width - 6, y: b.y + b.height - 8 };
    },
    async type(text, delay = 55) {
      await page.keyboard.type(text, { delay });
    },
    async waitAnswer() {
      c.fast();
      await page.waitForFunction(() => {
        const r = document.querySelector('edge-gallery')?.shadowRoot;
        return /tok\/s|On this device/.test(r?.querySelector('.card .meta')?.textContent ?? '') || !!r?.querySelector('.card .err');
      }, null, { timeout: 180000 });
      c.normal();
      const err = await page.evaluate(() => document.querySelector('edge-gallery').shadowRoot.querySelector('.card .err')?.textContent);
      if (err) throw new Error(`${name}: the card shows an error: ${err}`);
    },
  };
  console.log(`● ${name}`);
  await run(c);
  await page.close();
  const file = path.join(RAW, `${name}.webm`);
  await page.video().saveAs(file);
  await page.video().delete();
  fs.writeFileSync(path.join(RAW, `${name}.json`), JSON.stringify({ marks, viewport: viewport ?? { width: W, height: H } }));
}

const ready = async (page) => {
  await page.waitForFunction(() => !!document.querySelector('edge-gallery')?.shadowRoot);
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
};
const palette = async (c, text) => {
  await c.page.keyboard.press('Alt+KeyK');
  await c.page.waitForFunction(() => document.querySelector('edge-gallery').shadowRoot.activeElement?.matches('.pal input'));
  await sleep(500);
  await c.type(text, 70);
  await sleep(600);
  await c.page.keyboard.press('Enter');
};

// ---------------- chapters ----------------

await chapter('ask', async (c) => {
  await c.page.goto(ARTICLE);
  await ready(c.page);
  await c.page.mouse.wheel(0, 560);
  await sleep(700);
  c.start();
  await c.select(c.page.locator('#p1'));
  await sleep(900);
  await c.click(shot(c.page).locator('.bar').getByRole('button', { name: 'Summarize', exact: true }));
  await c.waitAnswer();
  await sleep(2600);
  c.end();
});

await chapter('jargon', async (c) => {
  await c.page.goto(ARTICLE);
  await ready(c.page);
  await c.page.mouse.wheel(0, 520);
  await sleep(600);
  c.start();
  const word = await c.page.evaluate(() => {
    const t = document.querySelector('#p3').firstChild;
    const i = t.data.indexOf('optic flow');
    const r = document.createRange();
    r.setStart(t, i + 2);
    r.setEnd(t, i + 3);
    const b = r.getBoundingClientRect();
    return { x: b.left + 2, y: b.top + b.height / 2 };
  });
  await c.move(word.x - 120, word.y + 60);
  await c.page.keyboard.down('Alt');
  await sleep(500);
  await c.move(word.x, word.y, 20);
  c.fast();
  await c.page.waitForFunction(() => /—/.test(document.querySelector('edge-gallery').shadowRoot.querySelector('.eg-tip')?.textContent ?? ''), null, { timeout: 60000 });
  c.normal();
  await sleep(3200);
  await c.page.keyboard.up('Alt');
  c.end();
});

await chapter('write', async (c) => {
  await c.page.goto(url('mail.test'));
  await ready(c.page);
  c.start();
  // Proofread a note and put the fix back.
  await c.click(c.page.locator('#note'));
  await c.page.keyboard.press('Meta+KeyA');
  await c.page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))); // as after a mouse selection
  await sleep(700);
  const bar = shot(c.page).locator('.bar');
  await c.click(bar.getByRole('button', { name: 'More ▸' }));
  await sleep(400);
  await c.click(bar.getByRole('button', { name: 'Proofread', exact: true }));
  await c.waitAnswer();
  await sleep(1200);
  await c.click(shot(c.page).getByRole('button', { name: 'Replace selection' }));
  await sleep(1600);
  // A drafted reply from the conversation, in your voice.
  await c.click(c.page.locator('#reply'));
  await sleep(700);
  await c.click(shot(c.page).locator('.eg-reply'));
  await c.waitAnswer();
  await sleep(1400);
  await c.click(shot(c.page).getByRole('button', { name: 'Insert' }));
  await sleep(1400);
  // Ghost text: pause while typing, Tab accepts.
  await c.page.keyboard.press('Enter');
  await c.type('PS: I can bring the', 70);
  c.fast(4);
  await c.page.waitForFunction(() => !document.querySelector('edge-gallery').shadowRoot.querySelector('.eg-ghost')?.hidden, null, { timeout: 60000 });
  c.normal();
  await sleep(1300);
  await c.page.keyboard.press('Tab');
  await sleep(1800);
  c.end();
});

await chapter('translate', async (c) => {
  await c.page.goto(url('notasdecampo.test'));
  await ready(c.page);
  await sleep(1800); // the page's language is detected
  c.start();
  await palette(c, 'Translate page');
  c.fast();
  await c.page.waitForFunction(() => document.querySelectorAll('[data-eg-translation]').length >= 4, null, { timeout: 120000 }).catch(async (e) => {
    console.log(await c.page.evaluate(() => ({ n: document.querySelectorAll('[data-eg-translation]').length, bar: document.querySelector('edge-gallery').shadowRoot.querySelector('.trbar')?.innerText, card: document.querySelector('edge-gallery').shadowRoot.querySelector('.card')?.innerText.slice(0, 200) })));
    throw e;
  });
  c.normal();
  await sleep(1500);
  await c.click(shot(c.page).locator('.trbar [data-mode=translation]'));
  await sleep(1800);
  await c.click(shot(c.page).locator('.trbar [data-mode=both]'));
  await sleep(1400);
  c.end();
});

await chapter('links', async (c) => {
  await c.page.goto(url('notice.test'));
  await ready(c.page);
  c.start();
  const b = await c.page.locator('#trap').boundingBox();
  await c.move(b.x + b.width / 2, b.y + b.height / 2);
  await sleep(400);
  await c.page.mouse.down();
  await sleep(700);
  await c.page.mouse.up();
  c.fast();
  await c.page.waitForFunction(() => /tok\/s/.test(document.querySelector('edge-gallery').shadowRoot.querySelector('.card .meta')?.textContent ?? ''), null, { timeout: 120000 });
  c.normal();
  await sleep(3000);
  c.end();
});

await chapter('images', async (c) => {
  await c.page.goto(ARTICLE);
  await ready(c.page);
  await c.page.mouse.wheel(0, 300);
  await sleep(600);
  c.start();
  await c.page.locator('figure img').evaluate((i) => i.decode()); // a loading image has no height yet, so no button
  const img = await c.page.locator('figure img').boundingBox();
  await c.move(img.x + img.width * 0.6, img.y + img.height * 0.4);
  await sleep(900);
  await c.click(shot(c.page).locator('.imgbtn'));
  await sleep(700);
  await c.click(shot(c.page).locator('.bar').getByRole('button', { name: 'Describe image', exact: true }));
  await c.waitAnswer();
  await sleep(3000);
  c.end();
});

await chapter('learn', async (c) => {
  await c.page.goto(ARTICLE);
  await ready(c.page);
  c.start();
  await palette(c, 'Mind map');
  c.fast();
  await c.page.waitForFunction(() => !!document.querySelector('edge-gallery').shadowRoot.querySelector('.card .mm li'), null, { timeout: 120000 });
  c.normal();
  await sleep(2600);
  await palette(c, 'Quiz me');
  c.fast();
  await c.page.waitForFunction(() => document.querySelector('edge-gallery').shadowRoot.querySelectorAll('.quiz button').length > 3, null, { timeout: 120000 });
  c.normal();
  await sleep(1000);
  const answer = shot(c.page).locator('.quiz button').nth(1);
  await c.click(answer);
  await sleep(2200);
  c.end();
});

await chapter('palette', async (c) => {
  await c.page.goto(ARTICLE);
  await ready(c.page);
  c.start();
  await c.page.keyboard.press('Alt+KeyK');
  await sleep(1400);
  const list = shot(c.page).locator('.pal ul');
  for (let i = 0; i < 6; i++) (await list.evaluate((ul) => ul.scrollBy({ top: 110, behavior: 'smooth' })), await sleep(420));
  await c.type('who decoded the dance', 60);
  await sleep(900);
  await c.click(shot(c.page).locator('.pal li[role=option]').filter({ hasText: 'Ask: who decoded the dance' }));
  await c.waitAnswer();
  await sleep(2600);
  c.end();
});

await chapter('mission', async (c) => {
  // Tabs the worker opens aren't routed, so the stores come from the local server here (names from each page's metadata).
  const urls = ['shop-a.html', 'shop-b.html', 'shop-c.html'].map((f) => `${assets.url}/${f}`).join('\n');
  await c.page.goto(`${ext('agent.html')}?${new URLSearchParams({ urls })}`);
  await sleep(800);
  c.start();
  await c.click(c.page.locator('#goal'));
  await c.type('Where can I buy the Aurora Wireless Headphones for the least?', 40);
  await sleep(400);
  await c.click(c.page.locator('#plan'));
  c.fast();
  await c.page.locator('#workflow').waitFor({ state: 'visible', timeout: 120000 });
  c.normal();
  await sleep(2200);
  await c.click(c.page.locator('#run'));
  c.fast(5);
  await c.page.locator('#verdict').waitFor({ state: 'visible', timeout: 240000 });
  c.normal();
  await c.page.locator('#results').scrollIntoViewIfNeeded();
  await sleep(3500);
  c.end();
});

await chapter('prices', async (c) => {
  // The price memory: seen at Bravo for $219, then at Alpha for $249.
  const first = await ctx.newPage();
  await first.goto(url('bravo-electronics.test'));
  await first.waitForFunction(() => !!document.querySelector('edge-gallery')?.shadowRoot?.querySelector('.price-chips'), null, { timeout: 20000 });
  await first.close();
  await c.page.goto(url('alpha-audio.test'));
  await ready(c.page);
  c.start();
  await c.page.waitForFunction(() => /Lowest you've seen/.test(document.querySelector('edge-gallery').shadowRoot.querySelector('.price-chips')?.textContent ?? ''), null, { timeout: 20000 });
  await sleep(600);
  const chips = shot(c.page).locator('.price-chips');
  const b = await chips.boundingBox();
  await c.move(b.x + 60, b.y + b.height / 2);
  await sleep(3600);
  c.end();
});

await chapter('voice', async (c) => {
  await c.page.goto(ARTICLE);
  await ready(c.page);
  c.start();
  await palette(c, 'Speak');
  await sleep(1200); // the listening card, at normal speed
  c.fast(5); // the rest of the recording and the transcription
  await c.page.waitForFunction(() => !document.querySelector('edge-gallery').shadowRoot.querySelector('.rec textarea')?.disabled && !!document.querySelector('edge-gallery').shadowRoot.querySelector('.rec textarea')?.value, null, { timeout: 120000 });
  c.normal();
  await sleep(1500);
  await c.click(shot(c.page).locator('.card .actions').getByRole('button', { name: 'Ask this question about the page' }));
  await c.waitAnswer();
  await sleep(2600);
  c.end();
});

await chapter('captions', async (c) => {
  await c.page.goto(ARTICLE);
  await ready(c.page);
  c.start();
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, c.page.url());
  await sw.evaluate(([audioUrl, tabId]) => self.bgHandlers.liveStartFile({ audioUrl, tabId, task: 'transcribe' }), [`${fixtures.url}/speech.wav`, tabId]);
  c.fast(3);
  await c.page.waitForFunction(() => !!document.querySelector('edge-gallery').shadowRoot.querySelector('.lc .lines p'), null, { timeout: 120000 });
  c.normal();
  await sleep(3500);
  await sw.evaluate(() => self.bgHandlers.liveStop());
  c.end();
});

await chapter('youtube', async (c) => {
  await c.page.goto('https://www.youtube.com/watch?v=bees01');
  await ready(c.page);
  c.start();
  await palette(c, 'Summarize video');
  await c.waitAnswer();
  await sleep(2800);
  c.end();
});

await chapter('imagine', async (c) => {
  await c.page.goto(ARTICLE);
  await ready(c.page);
  c.start();
  await palette(c, 'Create image');
  await sleep(600);
  await c.type('a honeybee on a sunflower, soft morning light', 45);
  await sleep(400);
  await c.click(shot(c.page).getByRole('button', { name: 'Create', exact: true }));
  c.fast(24);
  await c.page.waitForFunction(() => !!document.querySelector('edge-gallery').shadowRoot.querySelector('img.eg-img'), null, { timeout: 240000 }).catch(async (e) => {
    await c.page.screenshot({ path: path.join(OUT, 'fail-imagine.png') });
    throw e;
  });
  c.normal();
  await sleep(3200);
  c.end();
});

await chapter('library', async (c) => {
  // A highlight to find in the library.
  const art = await ctx.newPage();
  await art.goto(ARTICLE);
  await ready(art);
  await sw.evaluate((url) => self.bgHandlers.memHighlightSave({ text: 'Karl von Frisch decoded the dance in the 1940s', url, title: 'The secret language of bees · Field Notes', wantNote: true }), ARTICLE);
  await art.close();
  await c.page.goto(ext('library.html'));
  await sleep(900);
  c.start();
  await sleep(1400);
  await c.click(c.page.getByRole('tab', { name: 'Highlights' }));
  await sleep(1800);
  await c.click(c.page.getByRole('tab', { name: 'Ask your library' }));
  await c.click(c.page.locator('#ask-q'));
  await c.type('Who figured out the bee dance?', 50);
  await c.page.keyboard.press('Enter');
  c.fast();
  await c.page.locator('#ask-sources li').first().waitFor({ timeout: 120000 });
  c.normal();
  await sleep(3000);
  c.end();
});

// The side panel, recorded narrow; the edit sets it beside the article like Chrome does.
await chapter('panel', async (c) => {
  await c.page.goto(ext('sidepanel.html'));
  await c.page.click('[data-tab=settings]');
  await sleep(900);
  c.start();
  await sleep(1600);
  await c.click(c.page.locator('[data-tab=chat]'));
  await c.click(c.page.locator('#chat-input'));
  await c.type('Switch to the dark theme please', 50);
  await c.page.keyboard.press('Enter');
  c.fast();
  await c.page.locator('.confirm').waitFor({ timeout: 60000 });
  c.normal();
  await sleep(1300);
  await c.click(c.page.locator('.confirm').getByRole('button', { name: 'Apply' }));
  await sleep(2600);
  c.end();
  await sw.evaluate(() => chrome.storage.sync.set({ theme: 'light' }));
}, { viewport: { width: 400, height: H } });

// The page shown behind the side panel.
const bg = await ctx.newPage();
await bg.goto(ARTICLE);
await bg.waitForTimeout(800);
await bg.screenshot({ path: path.join(OUT, 'panel-backdrop.png') });
await bg.close();

await sw.evaluate(() => chrome.storage.sync.set({ ghostText: false, theme: 'system' }));
await ctx.close();
console.log('recorded', fs.readdirSync(RAW).filter((f) => f.endsWith('.json')).length, 'chapters');
process.exit(0); // the local servers would keep Node alive
