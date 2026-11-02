// The start the garden benches share: the extension on the test profile, the fixture sites faked at their edge
// (ADR-14), and the Gardeners model pinned to `model` until `done()` puts the profile's own choices back.
import path from 'node:path';
import { bgOn, engine, launch, ROOT } from '../tests/harness.mjs';
import { BING, PAGES, html } from './garden-fixtures.mjs';

export async function gardenBench(model) {
  const { ctx, sw, id } = await launch({ userDataDir: path.join(ROOT, '.profile-test') });
  await ctx.route('https://*.test/**', (r) => {
    const u = new URL(r.request().url());
    const body = PAGES[`${u.origin}${u.pathname}`];
    r.fulfill(body ? { contentType: 'text/html; charset=utf-8', body } : { status: 404, contentType: 'text/html', body: html('Not found', '') });
  });
  await ctx.route('https://www.bing.com/search**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: BING }));
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);

  // Only the Gardeners choice changes; the others are put back afterwards, even on a failure.
  const before = await panel.evaluate(async (m) => {
    const { taskModels } = await chrome.storage.sync.get('taskModels');
    await chrome.storage.sync.set({ taskModels: { ...taskModels, gardens: m } });
    return taskModels ?? null;
  }, model);
  const restore = () => panel.evaluate((t) => (t ? chrome.storage.sync.set({ taskModels: t }) : chrome.storage.sync.remove('taskModels')), before);
  process.on('uncaughtException', async (e) => (await restore().catch(() => {}), console.error(e), process.exit(1)));
  const done = async () => (await restore(), await ctx.close());

  const m = await engine(sw, 'resolve', { name: model });
  if (m.name !== model) {
    console.log(`${model} is not downloaded in this profile (resolve gave ${m.name}); nothing measured.`);
    await done();
    process.exit(2);
  }
  return { sw, panel, bg: bgOn(panel), m, done };
}
