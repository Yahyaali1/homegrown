// Gardeners end to end @slow: the real worker, the real model, real tabs. The shop is faked at its edge (ADR-14):
// Playwright answers https://shop.garden.test with pages the test can change, and counts the form posts it receives.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { bgOn, emptyGarden, engine, launch, plant, put, ROOT } from './harness.mjs';

const HOST = 'shop.garden.test';
const SHOP = `https://${HOST}`;
let ctx, sw, id, port, panel, bg;
const pages = {};
const posts = []; // paths of form posts the shop received

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  ({ ctx, sw, id, port } = await launch({ userDataDir: path.join(ROOT, '.profile-test') }));
  await ctx.route(`${SHOP}/**`, (r) => {
    const { pathname } = new URL(r.request().url());
    if (r.request().method() === 'POST') posts.push(pathname);
    r.fulfill({ contentType: 'text/html; charset=utf-8', body: pages[pathname] ?? `<!doctype html><title>Thanks</title><h1>Done: ${pathname}</h1>` });
  });
  panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  bg = bgOn(panel);
  await emptyGarden(bg);
});

test.afterAll(async () => {
  await ctx?.close();
});

const runOf = (runId) => bg('runGet', { id: runId });
async function settled(runId, statuses = ['done', 'failed', 'stopped']) {
  let run;
  await expect.poll(async () => (run = await runOf(runId)).status, { timeout: 5 * 60_000 }).toMatch(new RegExp(`^(${statuses.join('|')})$`));
  console.log(`  [${run.status}] ${(run.answer ?? run.why ?? '').replace(/\s+/g, ' ').slice(0, 200)}`);
  return run;
}

const noGardenerTabs = async (name) => {
  expect(ctx.pages().filter((p) => p.url().includes(HOST))).toHaveLength(0);
  expect(await sw.evaluate((t) => chrome.tabGroups.query({ title: t }).then((g) => g.length), `❀ ${name}`)).toBe(0);
};

async function gardener(name) {
  return bg('gardenerSave', { gardener: { name, instructions: 'Say briefly what changed.', sites: [HOST], minutes: 10 } });
}

/**
 * A run whose model already chose `act` (open work needs a model measured with agent.loop, and none is yet): the
 * record the worker itself would have written after that choose turn, pinned to the real model. The queue then
 * takes it from there, through policy, the request, the answer and the act.
 */
async function plantAct(g, url, instructions) {
  const m = await engine(sw, 'resolve', {});
  const runId = `act-${Date.now()}`;
  const reply = JSON.stringify({ tool: 'act', args: { url, steps: { instructions } } });
  await plant(panel, sw, {
    v: 1, id: runId, gardenerId: g.id, work: { kind: 'ask', request: 'Do it on the shop.' }, status: 'queued', queuedAt: Date.now(), usedMs: 0,
    model: m.name, maxTokens: m.maxTokens, agent: { loop: true, maxSteps: 2 },
    turns: [{ purpose: 'choose', reply, at: Date.now() }], steps: [], requests: [], seen: [], tainted: false,
  });
  return runId;
}

const openGarden = async () => {
  await panel.reload();
  await panel.click('[data-tab=garden]');
};

test('gardeners @slow: a routine reads two pages, and its second run says what changed, in bloom, with no tabs left', async () => {
  pages['/ferns'] = '<!doctype html><title>Ferns</title><h1>Ferns</h1><p>Boston fern: £12.</p><p>Maidenhair fern: £9.</p>';
  pages['/moss'] = '<!doctype html><title>Moss</title><h1>Moss</h1><p>Cushion moss: £4.</p>';
  const g = await gardener('Pricer');
  const r = await bg('routineSave', { routine: { gardenerId: g.id, name: 'Prices', when: { kind: 'every', hours: 1 }, work: { kind: 'read', urls: [`${SHOP}/ferns`, `${SHOP}/moss`] } } });
  // As if its alarm fired: due now, then the claim.
  const fire = async () => {
    await put(panel, 'routines', { nextDue: Date.now() - 1000 }, r.id);
    await sw.evaluate((rid) => self.gardenFire(rid), r.id);
    return (await bg('routineList', { gardenerId: g.id }))[0].lastRunId ?? (await bg('runList', { gardenerId: g.id }))[0].id;
  };
  const first = await settled(await fire());
  expect(first.status).toBe('done');
  pages['/ferns'] = '<!doctype html><title>Ferns</title><h1>Ferns</h1><p>Boston fern: £19.</p><p>Maidenhair fern: £9.</p>';
  const secondId = await fire();
  expect(secondId).not.toBe(first.id);
  const second = await settled(secondId);
  expect(second.status).toBe('done');
  expect(second.steps.map((s) => s.state)).toEqual(['done', 'done']);
  expect(second.answer).toMatch(/19/);

  await openGarden();
  const row = panel.locator('#garden-runs li', { hasText: second.answer.trim() }); // the whole answer: two answers can open alike
  await expect(row).toHaveCount(1);
  await expect(row.locator('.flower')).toHaveClass(/sprout|bloom/);
  await noGardenerTabs('Pricer');
});

test('gardeners @slow: an act waits for your approval, then happens exactly once', async () => {
  pages['/profile'] = '<!doctype html><title>Profile</title><form action="/profile-saved" method="post"><input id="nick" name="nick"><button id="go">Save nickname</button></form>';
  const g = await gardener('Clerk');
  const runId = await plantAct(g, `${SHOP}/profile`, [{ fill: ['#nick', 'Ada'] }, { click: '#go' }]);
  const waiting = await settled(runId, ['waiting', 'done', 'failed', 'stopped']);
  expect(waiting.status).toBe('waiting');
  expect(waiting.requests.map((q) => [q.kind, q.sensitive])).toEqual([['approve', false]]);
  expect(posts.filter((p) => p === '/profile-saved')).toHaveLength(0);

  await openGarden();
  const req = panel.locator('#garden-requests li', { hasText: 'Clerk' });
  await req.getByRole('button', { name: 'Yes' }).click();
  await expect.poll(async () => (await runOf(runId)).steps[0]?.state, { timeout: 2 * 60_000 }).toBe('done');
  expect(posts.filter((p) => p === '/profile-saved')).toHaveLength(1);
  // Whatever the model does next, the approved act isn't done again.
  const end = await settled(runId, ['waiting', 'done', 'failed', 'stopped']);
  if (end.status === 'waiting') await bg('runStop', { id: runId });
  expect(posts.filter((p) => p === '/profile-saved')).toHaveLength(1);
  await noGardenerTabs('Clerk');
});

test('gardeners @slow: a sensitive approval (a Pay button) can\'t be given within 8 s of being shown', async () => {
  pages['/checkout'] = '<!doctype html><title>Checkout</title><form action="/paid" method="post"><button id="pay">Pay £5</button></form>';
  const g = await gardener('Buyer');
  const runId = await plantAct(g, `${SHOP}/checkout`, [{ click: '#pay' }]);
  let run = await settled(runId, ['waiting', 'done', 'failed', 'stopped']);
  expect(run.status).toBe('waiting');
  // Before the page is seen the click isn't known to be sensitive; yes lets the page be opened and checked. The panel
  // looks at a tab with no request tray meanwhile (Chat has one), so the next request isn't shown until Garden opens.
  await panel.click('[data-tab=library]');
  await bg('requestAnswer', { runId, requestId: run.requests[0].id, value: 'yes' });
  await expect.poll(async () => (run = await runOf(runId)).requests.length, { timeout: 2 * 60_000 }).toBe(2);
  expect(run.status).toBe('waiting');
  const q = run.requests[1];
  expect([q.kind, q.sensitive]).toEqual(['approve', true]);
  expect(posts).not.toContain('/paid');

  expect(q.shownAt).toBeUndefined();
  await panel.click('[data-tab=garden]');
  const yes = panel.locator('#garden-requests li', { hasText: 'Sensitive' }).getByRole('button', { name: 'Yes' });
  await expect(yes).toBeDisabled({ timeout: 1000 });
  await expect.poll(async () => (await runOf(runId)).requests[1].shownAt).toBeTruthy();
  await expect(bg('requestAnswer', { runId, requestId: q.id, value: 'yes' })).rejects.toThrow(/8 seconds/);
  expect(posts).not.toContain('/paid');
  // After the wait, Yes opens and the payment goes through once.
  await expect(yes).toBeEnabled({ timeout: 15_000 });
  await yes.click();
  await expect.poll(() => posts.filter((p) => p === '/paid').length, { timeout: 2 * 60_000 }).toBe(1);
  const end = await settled(runId, ['waiting', 'done', 'failed', 'stopped']);
  if (end.status === 'waiting') await bg('runStop', { id: runId });
  expect(posts.filter((p) => p === '/paid')).toHaveLength(1);
});

/** Stops the extension's service worker (Target.closeTarget), as Chrome does when it idles, then wakes a new one. */
async function restartWorker() {
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let n = 0;
  const send = (method, params = {}) => new Promise((ok, no) => {
    const i = ++n;
    ws.addEventListener('message', function on(e) {
      const m = JSON.parse(e.data);
      if (m.id !== i) return;
      ws.removeEventListener('message', on);
      m.error ? no(new Error(m.error.message)) : ok(m.result);
    });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const { targetInfos } = await send('Target.getTargets');
  const t = targetInfos.find((x) => x.type === 'service_worker' && x.url === `chrome-extension://${id}/background.js`);
  await send('Target.closeTarget', { targetId: t.targetId });
  ws.close();
  // The worker keeps its target, so the same handle reaches the new one: wake it, and its globals are fresh.
  await expect.poll(async () => (await bg('runList', { limit: 1 }).catch(() => {}), await sw.evaluate(() => self.oldWorker ?? false).catch(() => true)), { timeout: 30_000 }).toBe(false);
}

test('gardeners @slow: take over pauses a read, a page-script click on the lock does nothing, the tab outlives a worker restart, hand back finishes', async () => {
  let hold = true; // the page's image hangs, so the read is still working in the tab
  await ctx.route(`${SHOP}/slow.png`, async (r) => {
    while (hold) await new Promise((ok) => setTimeout(ok, 200));
    await r.fulfill({ status: 404, body: '' }).catch(() => {});
  });
  pages['/notes'] = '<!doctype html><title>Notes</title><h1>Notes</h1><p>Rose: pruned on Monday.</p><img src="/slow.png">';
  const g = await gardener('Keeper');
  const r = await bg('routineSave', { routine: { gardenerId: g.id, name: 'Notes', when: { kind: 'every', hours: 1 }, work: { kind: 'read', urls: [`${SHOP}/notes`] } } });
  const { id: runId } = await bg('gardenRun', { routineId: r.id });
  let tab;
  await expect.poll(() => ((tab = ctx.pages().find((p) => p.url().startsWith(`${SHOP}/notes`))) ? 1 : 0), { timeout: 2 * 60_000 }).toBe(1);
  const lock = tab.locator('homegrown-lock');
  await expect(lock).toHaveCount(1, { timeout: 20_000 });

  // Page script can't reach the closed root's buttons, and clicks it makes aren't trusted: nothing happens.
  await tab.evaluate(() => {
    const host = document.querySelector('homegrown-lock');
    const b = host.getBoundingClientRect();
    for (const x of [b.right - 46, b.right - 132]) document.elementFromPoint(x, b.top + b.height / 2)?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: x, clientY: b.top + b.height / 2 }));
    host.click();
  });
  await new Promise((ok) => setTimeout(ok, 1500));
  expect((await runOf(runId)).status).toBe('running');
  await expect(lock).toHaveCount(1);
  // Nor can it hide the bar: removed or styled away, it comes back.
  await tab.evaluate(() => {
    document.head.append(Object.assign(document.createElement('style'), { textContent: 'homegrown-lock { display: none !important; opacity: 0 !important }' }));
    document.querySelector('homegrown-lock').remove();
  });
  await expect(lock).toBeVisible({ timeout: 3000 });

  // A real click on Take over (the second of two 80 px buttons, 6 px apart).
  await tab.bringToFront();
  const box = await lock.boundingBox();
  await tab.mouse.click(box.x + box.width - 6 - 80 - 6 - 40, box.y + box.height / 2);
  let run;
  await expect.poll(async () => (run = await runOf(runId)).status, { timeout: 30_000 }).toBe('waiting');
  const q = run.requests.find((x) => x.kind === 'takeover');
  expect(q?.tabId).toBeTruthy();
  expect(run.steps.map((s) => s.state)).toEqual(['started']);
  await expect(lock).toHaveCount(0);
  const info = () => sw.evaluate((t) => chrome.tabs.get(t).then((x) => ({ groupId: x.groupId, url: x.url }), () => null), q.tabId);
  expect(await info()).toMatchObject({ groupId: -1, url: `${SHOP}/notes` });

  await sw.evaluate(() => (self.oldWorker = true));
  await restartWorker();
  expect(await info()).toMatchObject({ groupId: -1, url: `${SHOP}/notes` });
  expect((await runOf(runId)).status).toBe('waiting');

  // Hand back: the read runs again, in a new tab of its own, and the run ends; the person's tab stays.
  hold = false;
  await openGarden();
  await panel.locator('#garden-requests li', { hasText: 'Keeper' }).getByRole('button', { name: 'Hand back to Keeper' }).click();
  const end = await settled(runId);
  expect(end.status).toBe('done');
  expect(end.steps.map((s) => s.state)).toEqual(['done']);
  expect(await info()).toMatchObject({ url: `${SHOP}/notes` });
  await sw.evaluate((t) => chrome.tabs.remove(t), q.tabId);
  await noGardenerTabs('Keeper');
});
