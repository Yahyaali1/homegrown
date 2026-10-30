// Meetings end to end (plan T10). Chrome's fake microphone says tests/fixtures/speech.wav ("You"), and an audio file
// played in the recorder stands in for the call's tab ("Them"), as liveStartFile does for captions (ADR-14). Whisper
// (the speech model, not a language model) is real, so the recording and file tests are @slow. The offer bar on a
// call page needs no model. No model is measured for `notes`, so a meeting is its transcript only.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { launch, serve, ROOT } from './harness.mjs';

let ctx, sw, id, panel, site;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  site = await serve(path.join(ROOT, 'tests/fixtures'));
  const mic = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${path.join(ROOT, 'tests/fixtures/speech.wav')}`];
  ({ ctx, sw, id } = await launch({ userDataDir: path.join(ROOT, '.profile-test'), args: mic }));
  // A call page, faked at its edge.
  await ctx.route('https://meet.google.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Weekly sync</title><h1>Call</h1>' }));
  panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  if (await bg('meetState')) await bg('meetStop').catch(() => {});
  for (const e of await bg('entityList')) if (e.fields.meeting) await bg('meetDelete', { id: e.id });
});

test.afterAll(async () => {
  await ctx?.close();
  site?.server.close();
});

async function bg(cmd, args = {}) {
  const r = await panel.evaluate(([cmd, args]) => chrome.runtime.sendMessage({ target: 'bg', cmd, ...args }), [cmd, args]);
  if (!r?.ok) throw new Error(`${cmd}: ${r?.error}`);
  return r.result;
}

async function meetingsTab() {
  await panel.bringToFront();
  await panel.click('.tabs [data-tab=library]');
  await panel.click('.lib-tabs [data-tab=meetings]');
}

test('a call page shows the record offer, which only points at the ways to start; nothing records by itself', async () => {
  const call = await ctx.newPage();
  await call.goto('https://meet.google.com/abc-defg-hij');
  const bar = call.locator('edge-gallery .meetoffer');
  await expect(bar).toContainText('Record this call? Press Alt+Shift+M, or right-click the page → Record this meeting.');
  expect(await bg('meetState')).toBe(null);
  await call.close();
});

test('a recorded call becomes a Meetings doc with "You:" and "Them:" lines, listed in Library → Meetings @slow', async () => {
  test.setTimeout(300_000);
  const page = await ctx.newPage();
  await page.goto(`${site.url}/article.html`);
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.id, page.url());

  // Spike: does a click in an extension page (the side panel) get a tab's stream id? Logged, not asserted.
  await panel.evaluate((tabId) => {
    const b = Object.assign(document.createElement('button'), { id: 'spike', textContent: 'spike' });
    b.onclick = () => chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }).then((s) => (window.spike = `a stream id (${s.length} chars)`), (e) => (window.spike = `refused: ${e.message}`));
    document.body.prepend(b);
  }, tabId);
  await panel.click('#spike');
  await expect.poll(() => panel.evaluate(() => window.spike ?? '')).not.toBe('');
  console.log(`  [spike] side panel click → getMediaStreamId: ${await panel.evaluate(() => window.spike)}`);
  await panel.evaluate(() => document.querySelector('#spike').remove());

  const rec = await sw.evaluate(([audioUrl, tabId]) => self.meetStartFile({ audioUrl, tabId }), [`${site.url}/speech.wav`, tabId]);
  expect(rec.mic).toBe(true);
  await meetingsTab();
  await expect(panel.locator('#meet-record')).toHaveText('■ Stop and save');
  await panel.waitForTimeout(9000); // the tab's clip (5.6 s) plays out; the fake mic keeps talking
  await panel.locator('#meet-record').click();
  await expect(panel.locator('#meet-record')).toHaveText('● Record this tab');
  await expect.poll(async () => (await bg('entityList')).some((e) => e.fields.meeting === 'call'), { timeout: 150_000 }).toBe(true);
  const meeting = (await bg('entityList')).find((e) => e.fields.meeting === 'call');
  expect(meeting?.name).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d /);
  expect([meeting.type, meeting.confirmed, meeting.body]).toEqual(['event', true, 'Transcript only: this needs a model measured for meeting notes.']);
  const doc = (await bg('docList')).find((d) => d.path === `Meetings/${meeting.name}.md`);
  console.log(`  [meeting] ${doc?.text}`);
  expect(doc.text).toMatch(/\] You: .*(waggle|dance|bees)/i);
  expect(doc.text).toMatch(/\] Them: .*(waggle|dance|bees)/i);

  const item = panel.locator('#meet-list details.file', { hasText: meeting.name });
  await expect(item).toBeVisible();
  await item.locator('summary').first().click();
  await item.locator('summary', { hasText: 'Transcript' }).click();
  await expect(item.locator('.answer.small')).toContainText('Them:');

  const p = await bg('meetPassages', { question: 'What do bees do?' });
  expect(p.sources[0]?.title).toBe(meeting.name);
  expect(p.data).toContain(`[1] ${meeting.name}`);
  await page.close();
});

test('while recording, a reloaded call page shows the recording line (× folds it to a dot), the badge says REC, and closing the tab stops and saves @slow', async () => {
  test.setTimeout(180_000);
  const call = await ctx.newPage();
  await call.goto('https://meet.google.com/abc-defg-hij');
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://meet.google.com/*' }))[0]?.id);
  const before = (await bg('entityList')).filter((e) => e.fields.meeting === 'call').length;
  await sw.evaluate(([audioUrl, tabId]) => self.meetStartFile({ audioUrl, tabId }), [`${site.url}/speech.wav`, tabId]);
  expect(await sw.evaluate(() => chrome.action.getBadgeText({}))).toBe('REC');

  await call.reload();
  const bar = call.locator('edge-gallery .meetoffer');
  await expect(bar).toContainText('● Recording this call');
  await bar.getByRole('button', { name: 'Fold' }).click();
  await expect(bar.getByRole('button', { name: 'Recording: show' })).toHaveText('●');

  await call.close();
  await expect.poll(() => bg('meetState'), { timeout: 30_000 }).toBe(null);
  expect(await sw.evaluate(() => chrome.action.getBadgeText({}))).toBe('');
  await expect.poll(async () => (await bg('entityList')).filter((e) => e.fields.meeting === 'call').length, { timeout: 120_000 }).toBe(before + 1);
});

test('"Transcribe a file" turns a fixture MP3 into a meeting with text and no speaker labels @slow', async () => {
  test.setTimeout(180_000);
  await meetingsTab();
  await panel.setInputFiles('#meet-file', path.join(ROOT, 'tests/fixtures/speech.mp3'));
  await expect.poll(async () => (await bg('entityList')).find((e) => e.fields.meeting === 'file')?.name ?? '', { timeout: 150_000 }).toMatch(/ speech$/);
  const m = (await bg('entityList')).find((e) => e.fields.meeting === 'file');
  const doc = (await bg('docList')).find((d) => d.path === `Meetings/${m.name}.md`);
  console.log(`  [file] ${doc.text}`);
  expect(doc.text).toMatch(/waggle|dance|bees/i);
  expect(doc.text).not.toMatch(/You:|Them:/);
  await expect(panel.locator('#meet-list details.file', { hasText: m.name })).toBeVisible();
});
