// Skills end to end. No model: a skill made in Garden → Skills with 2 cases is "Not tested yet"; "Test on
// cases" is refused while no model plans; an off skill is refused by /name in chat; deleting a skill pauses the routine
// that follows it. @slow, real model: no model has `plan` yet, so the test runs and a routine's run are planted pinned
// with it and their plan already approved (as plan.spec does); one case passes by `expect`, one fails, and the routine's
// run follows the method.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { bgOn, emptyGarden, engine, launch, plannedRun, put, ROOT } from './harness.mjs';

const SHOP = 'https://shop.garden.test';
const PAGES = { '/fern': '<!doctype html><title>Ferns</title><h1>Ferns</h1><p>Boston fern: £12.</p>' };
let ctx, sw, id, panel, bg, g;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  ({ ctx, sw, id } = await launch({ userDataDir: path.join(ROOT, '.profile-test') }));
  await ctx.route(`${SHOP}/**`, (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGES[new URL(r.request().url()).pathname] ?? '<!doctype html><title>Not found</title>' }));
  panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  bg = bgOn(panel);
  await emptyGarden(bg);
  for (const s of await bg('skillList')) await bg('skillDelete', { id: s.id });
  g = await bg('gardenerSave', { gardener: { name: 'Pricer', instructions: 'Answer briefly.', sites: ['shop.garden.test'], minutes: 10 } });
});

test.afterAll(async () => {
  await ctx?.close();
});


test('a skill with 2 cases is made in Garden → Skills; Test is refused without a plan model; off, /name is refused; delete pauses its routine', async () => {
  await panel.click('.tabs [data-tab=garden]');
  await panel.locator('#skills > summary').click();
  const box = panel.locator('#garden-skills');
  await box.locator('summary', { hasText: 'Add a skill' }).click();
  await box.getByLabel('Skill command').last().fill('price');
  await box.getByLabel('Skill title').last().fill('Plant price');
  await box.getByLabel('Method').last().fill('Give the price in pounds, then stop.');
  await box.getByLabel('Test cases').last().fill('How much is the Boston fern? => 12\nIs moss sold?');
  await box.getByRole('button', { name: 'Add skill' }).click();

  const row = box.locator('li.skill', { hasText: '/price' });
  await expect(row.locator('.result').first()).toHaveText('Not tested yet');
  const [s] = await bg('skillList');
  expect(s).toMatchObject({ name: 'price', work: 'plan', on: true, by: 'person', version: 1, cases: [{ input: 'How much is the Boston fern?', expect: '12' }, { input: 'Is moss sold?' }] });

  await row.getByRole('button', { name: 'Test /price on its cases' }).click();
  await expect(row.locator('.t > .err')).toHaveText('This model can’t write plans yet.');
  await row.locator('summary', { hasText: 'Improve' }).click();
  await expect(row.getByText('This needs a model measured for skill edits.')).toBeVisible();

  // A routine follows it; deleting the skill pauses the routine.
  const rt = await bg('routineSave', { routine: { gardenerId: g.id, name: 'Weekly price', when: { kind: 'daily', at: '08:00' }, work: { kind: 'plan', request: 'Boston fern' }, skillId: s.id } });
  await expect(bg('routineSave', { routine: { gardenerId: g.id, name: 'Bad', when: { kind: 'daily', at: '08:00' }, work: { kind: 'read', urls: [`${SHOP}/fern`] }, skillId: s.id } })).rejects.toThrow(/asks or plans/);

  await row.getByRole('button', { name: 'Turn off /price' }).click();
  await expect(box.locator('li.skill', { hasText: '/price' }).locator('.result').first()).toHaveText('Off');
  await panel.click('.tabs [data-tab=chat]');
  await panel.fill('#chat-input', '/pr');
  await expect(panel.locator('#slash')).toBeHidden(); // an off skill isn't offered
  await panel.fill('#chat-input', '/price Boston fern');
  await panel.press('#chat-input', 'Enter');
  await expect(panel.locator('#messages li.error').last()).toHaveText('The skill /price is off.');

  await bg('skillDelete', { id: s.id });
  const after = (await bg('routineList')).find((r) => r.id === rt.id);
  expect(after).toMatchObject({ paused: true, skillId: s.id });
  await bg('routineDelete', { id: rt.id });
});

test('test on cases @slow: one case passes by expect, one fails; a routine\'s run follows the method', async () => {
  const s = await bg('skillSave', { skill: { name: 'price', title: 'Plant price', method: 'Give the price from the page. End your answer with the word PAPAYA.', cases: [{ input: 'How much is the Boston fern?', expect: '12' }, { input: 'How much is the Boston fern in dollars?', expect: 'zebra' }] } });
  const m = await engine(sw, 'resolve', {});
  const t0 = Date.now();
  // As skillTest makes them, but pinned with `plan` and its plan approved: one read of the fern page, then the sum think.
  const planted = (id, request, extra = {}) => plannedRun({ id, gardenerId: g.id, work: { kind: 'plan', request, skillId: s.id }, queuedAt: t0,
    model: m.name, maxTokens: m.maxTokens, plan: [{ tool: 'read_page', args: { url: `${SHOP}/fern` } }], ...extra });
  const ids = [`skilltest-1-${t0}`, `skilltest-2-${t0}`];
  for (const [k, c] of s.cases.entries()) await put(panel, 'runs', { ...planted(ids[k], c.input), queuedAt: t0 + k });
  await put(panel, 'skills', { ...s, cases: s.cases.map((c, k) => ({ ...c, runId: ids[k] })) });
  const rt = await bg('routineSave', { routine: { gardenerId: g.id, name: 'Fern price', when: { kind: 'daily', at: '08:00' }, work: { kind: 'plan', request: 'How much is the Boston fern?' }, skillId: s.id, paused: true } });
  const routineRun = `${rt.id}@${t0}`;
  await put(panel, 'runs', { ...planted(routineRun, 'How much is the Boston fern?', { routineId: rt.id }), queuedAt: t0 + 2 });
  await sw.evaluate(() => self.gardenFire('none'));

  let skill;
  await expect.poll(async () => (skill = (await bg('skillList')).find((x) => x.id === s.id)).cases.map((c) => c.pass), { timeout: 8 * 60_000 }).toEqual([true, false]);
  for (const id of ids) {
    const r = await bg('runGet', { id });
    console.log(`  [${r.status}] ${(r.answer ?? r.why ?? '').replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  let run;
  await expect.poll(async () => (run = await bg('runGet', { id: routineRun })).status, { timeout: 5 * 60_000 }).toMatch(/^(done|failed|stopped)$/);
  console.log(`  routine: [${run.status}] ${(run.answer ?? run.why ?? '').replace(/\s+/g, ' ').slice(0, 200)}`);
  expect(run.status).toBe('done');
  expect(run.work.skillId).toBe(s.id);
  expect(run.turns.map((t) => t.purpose)).toEqual(['sum']);
  expect(run.answer).toMatch(/papaya/i); // the method was in its think's instruction part

  await panel.reload();
  await panel.click('.tabs [data-tab=garden]');
  await panel.locator('#skills > summary').click();
  await expect(panel.locator('#garden-skills li.skill', { hasText: '/price' }).locator('.result').first()).toHaveText('1 of 2 cases passed');
  await bg('routineDelete', { id: rt.id });
});
