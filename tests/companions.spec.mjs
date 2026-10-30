// Companions end to end (plan T12), no model: hire Rosa in Garden, answer 2 interview questions and skip the rest; her
// answers join her instructions; her 2 routines are paused and her 3 skills off; Regulation watch (a direct read) ships
// with no page, turns on once the person sets one, and Market map says it needs a measured model (the worker refuses it
// too, even with its needs dropped; an unpaused one planted in the store fails its run at pin).
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { launch, ROOT } from './harness.mjs';

const NEEDS = 'Needs a model measured for this workflow.';
let ctx, sw, panel;

test.beforeAll(async () => {
  let id;
  ({ ctx, sw, id } = await launch({ userDataDir: path.join(ROOT, '.profile-test') }));
  // Turning on the watch checks its page at once: faked at its edge (ADR-14).
  await ctx.route('https://eur-lex.europa.eu/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>EUR-Lex</title><p>Official Journal</p>' }));
  panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  for (const r of await bg('runList', { limit: 1000 })) {
    if (['queued', 'running', 'waiting'].includes(r.status)) await bg('runStop', { id: r.id });
    await bg('runDelete', { id: r.id });
  }
  for (const x of await bg('gardenerList')) await bg('gardenerDelete', { id: x.id });
  for (const s of await bg('skillList')) await bg('skillDelete', { id: s.id });
});

test.afterAll(async () => {
  await ctx?.close();
});

const putRoutine = (value) => panel.evaluate(async (value) => {
  const d = await new Promise((ok, no) => Object.assign(indexedDB.open('hg-garden'), { onsuccess: (e) => ok(e.target.result), onerror: no }));
  const t = d.transaction('routines', 'readwrite');
  t.objectStore('routines').put(value);
  await new Promise((ok, no) => Object.assign(t, { oncomplete: ok, onerror: no }));
  d.close();
}, value);

async function bg(cmd, args = {}) {
  const r = await panel.evaluate(([cmd, args]) => chrome.runtime.sendMessage({ target: 'bg', cmd, ...args }), [cmd, args]);
  if (!r?.ok) throw new Error(`${cmd}: ${r?.error}`);
  return r.result;
}

test('hire Rosa: interview, paused routines, off skills; reg-watch turns on, market-map needs a measured model', async () => {
  await panel.click('.tabs [data-tab=garden]');
  await panel.locator('#hire > summary').click();
  await expect(panel.getByText('Her reads of console errors and failed requests are off: turn on DevTools in her Edit form.')).toBeVisible();
  await panel.getByLabel('Rosa may read eur-lex.europa.eu signed in').check();
  await panel.getByRole('button', { name: 'Hire Rosa' }).click();

  const row = panel.locator('#gardener-list > li.gardener', { hasText: 'Rosa' });
  await row.getByLabel('What do you research most?').fill('EU battery rules');
  await row.getByRole('button', { name: 'Next' }).click();
  await row.getByLabel('Who reads your research?').fill('My product team');
  await row.getByRole('button', { name: 'Next' }).click();
  await row.getByRole('button', { name: 'Skip' }).click();
  await row.getByRole('button', { name: 'Skip' }).click();
  await expect(row.locator('.questions')).toHaveCount(0);

  const [rosa, ...more] = await bg('gardenerList');
  expect(more).toEqual([]);
  // A retry of the same Hire returns the same gardener.
  expect((await bg('hire', { presetId: 'rosa', hireId: rosa.id })).id).toBe(rosa.id);
  expect((await bg('gardenerList')).length).toBe(1);
  expect(rosa).toMatchObject({ name: 'Rosa', preset: 'rosa', sites: ['eur-lex.europa.eu'] });
  expect(rosa.profile).toEqual([{ q: 'What do you research most?', a: 'EU battery rules' }, { q: 'Who reads your research?', a: 'My product team' }]);
  expect(rosa.instructions).toContain('EU battery rules');
  expect(rosa.instructions).toContain('My product team');

  const routines = await bg('routineList', { gardenerId: rosa.id });
  expect(routines.map((r) => [r.name, r.paused, r.by]).sort()).toEqual([['Market map', true, 'preset'], ['Regulation watch', true, 'preset']]);
  const skills = (await bg('skillList')).filter((s) => s.gardenerId === rosa.id);
  expect(skills.map((s) => [s.name, s.on, s.by]).sort()).toEqual([['brief', false, 'preset'], ['deck', false, 'preset'], ['directory', false, 'preset']]);

  const map = row.locator('li', { hasText: 'Market map' });
  await expect(map.locator('.result')).toHaveText(NEEDS);
  await expect(map.getByRole('button', { name: 'Turn on Market map' })).toHaveCount(0);
  await expect(map.getByRole('button', { name: 'Run Market map now' })).toHaveCount(0);
  const m = routines.find((r) => r.name === 'Market map');
  await expect(bg('routineSave', { routine: { ...m, paused: false } })).rejects.toThrow(NEEDS);
  await expect(bg('routineSave', { routine: { ...m, paused: false, needs: [] } })).rejects.toThrow(NEEDS);
  await expect(bg('gardenRun', { routineId: m.id })).rejects.toThrow(NEEDS);
  await expect(bg('skillSave', { skill: { ...skills[0], on: true } })).rejects.toThrow(NEEDS);

  const watch = row.locator('li', { hasText: 'Regulation watch' });
  await expect(watch.locator('.result')).toHaveText('Set the page it watches first.');
  await expect(watch.getByRole('button', { name: 'Turn on Regulation watch' })).toHaveCount(0);
  const w = routines.find((r) => r.name === 'Regulation watch');
  await expect(bg('routineSave', { routine: { ...w, paused: false } })).rejects.toThrow('Set the page it watches first.');
  await watch.getByLabel('Pages for Regulation watch').fill('https://eur-lex.europa.eu/oj/direct-access.html');
  await watch.getByRole('button', { name: 'Save pages' }).click();
  await row.getByRole('button', { name: 'Turn on Regulation watch' }).click();
  await expect.poll(async () => (await bg('routineList', { gardenerId: rosa.id })).find((r) => r.name === 'Regulation watch').paused).toBe(false);
  await expect(row.locator('li', { hasText: 'Regulation watch' }).getByRole('button', { name: 'Pause Regulation watch' })).toBeVisible();
  expect((await bg('routineList', { gardenerId: rosa.id })).find((r) => r.name === 'Regulation watch')).toMatchObject({ when: { kind: 'event', url: 'https://eur-lex.europa.eu/oj/direct-access.html' }, work: { kind: 'read', urls: ['https://eur-lex.europa.eu/oj/direct-access.html'] } });

  // On in the store anyway (as an older build or a model change could leave it): its run fails at pin.
  await putRoutine({ ...m, paused: false, nextDue: Date.now() - 1000 });
  await sw.evaluate((id) => self.gardenFire(id), m.id);
  let run;
  await expect.poll(async () => (run = (await bg('runList')).find((r) => r.routineId === m.id))?.status, { timeout: 30_000 }).toBe('failed');
  expect(run.why).toBe(NEEDS);

  // The interview isn't asked again.
  await panel.reload();
  await panel.click('.tabs [data-tab=garden]');
  await expect(panel.locator('#gardener-list > li.gardener', { hasText: 'Rosa' }).getByText('Rosa', { exact: true })).toBeVisible();
  await expect(panel.locator('#gardener-list .questions')).toHaveCount(0);
  await bg('gardenerDelete', { id: rosa.id });
});
