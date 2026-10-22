// Real keystrokes into every text box in the side panel, Mission control and the ❀ palette.
// Catches on<event> handlers that return false (which cancels the key) and re-renders that drop focus.
// Run: ./scripts/gpu.sh node tests/typing.mjs
import path from 'node:path';
import { serve, launch, ROOT } from './harness.mjs';
const site = await serve(path.join(ROOT, 'tests/fixtures'));
const { ctx, id } = await launch({ userDataDir: path.join(ROOT, '.profile-test') });
const bad = [];
// Real keystrokes into every visible text box on a page (a tab at a time for tabbed pages).
async function typeAll(p, label) {
  const SEL = 'input:not([type]), input[type=text], input[type=search], input[type=url], input[type=number], textarea';
  const count = (await p.$$(SEL)).length;
  let tried = 0;
  for (let k = 0; k < count; k++) {
    await p.waitForTimeout(50); // let a re-render triggered by the previous box settle, then look the box up fresh
    const b = (await p.$$(SEL))[k];
    if (!b) continue;
    if (!(await b.isVisible())) continue;
    tried++;
    const type = await b.getAttribute('type');
    const probe = type === 'number' ? '7' : 'ab c';
    await b.click({ timeout: 3000 }).catch(() => {});
    await b.evaluate((x) => (x.value = ''));
    await p.keyboard.type(probe);
    await p.waitForTimeout(50);
    const v = await ((await p.$$(SEL))[k] || b).inputValue(); // read back from the live element (a re-render may have replaced b)
    if (!v.includes(probe)) bad.push(`${label} ${await b.evaluate((x) => x.id || x.getAttribute('aria-label') || x.placeholder)}: typed "${probe}", got "${v}"`);
  }
  return tried;
}
const panel = await ctx.newPage();
await panel.goto(`chrome-extension://${id}/sidepanel.html`);
await panel.waitForTimeout(800);
let n = 0;
for (const tab of ['chat', 'missions', 'library', 'tasks', 'settings']) {
  await panel.click(`.tabs [data-tab=${tab}]`);
  await panel.waitForTimeout(250);
  if (tab === 'library') for (const sub of ['history', 'ask']) { await panel.click(`.lib-tabs [data-tab=${sub}]`); n += await typeAll(panel, `panel/${sub}`); }
  else n += await typeAll(panel, `panel/${tab}`);
}
const agent = await ctx.newPage();
await agent.goto(`chrome-extension://${id}/agent.html`);
await agent.click('#goal');
await agent.keyboard.type('Find the cheapest Blue Widget Pro');
console.log('Mission control goal:', JSON.stringify(await agent.inputValue('#goal')));
await agent.click('#plan');
await agent.waitForSelector('#steps input', { timeout: 120000 });
n += await typeAll(agent, 'agent');
const page = await ctx.newPage();
await page.goto(`${site.url}/pages/review.html`);
await page.waitForTimeout(600);
await page.evaluate(() => document.querySelector('edge-gallery').shadowRoot.querySelector('.fab').click());
await page.waitForTimeout(400);
const palInput = await page.evaluateHandle(() => document.querySelector('edge-gallery').shadowRoot.querySelector('.pal input'));
await palInput.asElement().click();
await page.keyboard.type('quiz');
console.log('palette after click + type:', JSON.stringify(await page.evaluate(() => document.querySelector('edge-gallery').shadowRoot.querySelector('.pal input').value)));
console.log(`typed into ${n} boxes ·`, bad.length ? `FAILURES:\n${bad.join('\n')}` : 'all accepted keystrokes');
process.exitCode = bad.length ? 1 : 0;
await ctx.close(); site.server.close();
