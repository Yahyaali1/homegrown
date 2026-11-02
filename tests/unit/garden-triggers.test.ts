// Triggers (plan T4): monthly rules, a one-off with a deadline, page events checked by code, and a waiting run that
// doesn't hold up the next slot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claim, MISSED, eventTrigger, nextAfter, nextRuns, overdue } from '../../src/domain/garden/schedule.ts';
import { next, retryStep, type Ctx } from '../../src/domain/garden/loop.ts';
import { TOOLS } from '../../src/domain/garden/tools.ts';
import { newRun, parseWhen, type Gardener, type GardenRun, type Routine, type When } from '../../src/domain/garden/records.ts';

const at = (iso: string) => Date.parse(iso);
const iso = (t: number) => new Date(t).toISOString().slice(0, 16);
const LONDON = 'Europe/London';
const routine = (when: When, over: Partial<Routine> = {}): Routine => ({ v: 1, id: 'r1', gardenerId: 'g1', name: 'x', when, tz: LONDON, work: { kind: 'read', urls: ['https://shop.com/p'] }, paused: false, nextDue: at('2026-03-02T09:00Z'), createdAt: 0, ...over });
const run = (status: GardenRun['status'], over: Partial<GardenRun> = {}): GardenRun => ({ ...newRun({ id: status, gardenerId: 'g1', routineId: 'r1', work: { kind: 'read', urls: ['https://shop.com/p'] }, now: 0 }), status, ...over });

test('first Monday 09:00 London stays at 09:00 local across both clock changes', () => {
  const when: When = { kind: 'monthly', on: { week: 1, day: 1 }, at: '09:00' };
  assert.deepEqual(nextRuns(when, LONDON, at('2026-02-15T00:00Z'), 3).map(iso), ['2026-03-02T09:00', '2026-04-06T08:00', '2026-05-04T08:00']);
  assert.deepEqual(nextRuns(when, LONDON, at('2026-09-15T00:00Z'), 2).map(iso), ['2026-10-05T08:00', '2026-11-02T09:00']);
});

test('last Friday of February in a leap year, and date 31 in April is 30 April', () => {
  assert.equal(iso(nextAfter({ kind: 'monthly', on: { week: -1, day: 5 }, at: '12:00' }, 'UTC', null, at('2028-02-01T00:00Z'))), '2028-02-25T12:00');
  const d31 = nextRuns({ kind: 'monthly', on: { date: 31 }, at: '10:00' }, 'UTC', at('2026-04-01T00:00Z'), 3).map(iso);
  assert.deepEqual(d31, ['2026-04-30T10:00', '2026-05-31T10:00', '2026-06-30T10:00']);
});

test('the preview lists 5 times; a one-off lists its one time, or none once past', () => {
  assert.equal(nextRuns({ kind: 'daily', at: '08:00' }, LONDON, at('2026-03-01T00:00Z')).length, 5);
  const once: When = { kind: 'once', date: '2026-03-02', at: '09:00' };
  assert.deepEqual(nextRuns(once, LONDON, at('2026-03-01T00:00Z')).map(iso), ['2026-03-02T09:00']);
  assert.deepEqual(nextRuns(once, LONDON, at('2026-03-03T00:00Z')), []);
  assert.deepEqual(nextRuns({ kind: 'event', url: 'https://a.com/', every: 15 }, 'UTC', 0, 2), [15 * 60_000, 30 * 60_000]);
});

test('parseWhen takes the new kinds and refuses bad ones', () => {
  assert.ok(parseWhen({ kind: 'monthly', on: { week: -1, day: 5 }, at: '09:00' }));
  assert.equal(parseWhen({ kind: 'monthly', on: { week: 5, day: 5 }, at: '09:00' }), null);
  assert.equal(parseWhen({ kind: 'monthly', on: { date: 32 }, at: '09:00' }), null);
  assert.equal(parseWhen({ kind: 'once', date: '2026-02-30', at: '09:00' }), null);
  assert.equal(parseWhen({ kind: 'once', date: '2026-03-02', at: '09:00', deadline: 4 }), null);
  assert.equal(parseWhen({ kind: 'event', url: 'https://a.com/', every: 10 }), null);
  assert.equal(parseWhen({ kind: 'event', url: 'https://a.com/', every: 15, onlyIf: Array(11).fill('w').map((w, i) => w + i) }), null);
  assert.deepEqual(parseWhen({ kind: 'event', url: 'https://a.com/#x', every: 15, onlyIf: [' price '] }), { kind: 'event', url: 'https://a.com/', every: 15, onlyIf: ['price'] });
});

test('a one-off with a 60-minute deadline missed by 2 h fails without running, leaves a Missed record, and pauses', () => {
  const r = routine({ kind: 'once', date: '2026-03-02', at: '09:00', deadline: 60 });
  const c = claim(r, [], r.nextDue + 2 * 3_600_000);
  // It leaves a record that never ran: failed "Missed", so history and Report show it.
  assert.deepEqual([c.newRun?.status, c.newRun?.why, c.newRun?.steps.length, c.newRun?.endedAt], ['failed', MISSED, 0, r.nextDue + 2 * 3_600_000]);
  assert.equal(c.routine.lastRunId, c.newRun?.id);
  assert.equal(c.missed, true);
  assert.equal(c.routine.paused, true);
  assert.equal(c.routine.missed, true, 'shown as Missed, not Done');
  const onTime = claim(r, [], r.nextDue + 60_000);
  assert.equal(onTime.newRun?.deadline, r.nextDue + 3_600_000);
  assert.equal(onTime.routine.paused, true, 'after it fires, Done');
  assert.equal(onTime.routine.nextDue, r.nextDue);
});

test('a one-off run past its deadline fails "Deadline passed"; a retry by the person drops it', () => {
  const g: Gardener = { v: 1, id: 'g1', name: 'P', instructions: '', sites: [], minutes: 10, createdAt: 0 };
  const ctx: Ctx = { gardener: g, tools: TOOLS, now: 5000 };
  const r = run('running', { deadline: 5000, model: 'm', maxTokens: 4096, agent: { loop: false, maxSteps: 4 } });
  assert.deepEqual(next(r, ctx), { fail: 'Deadline passed.' });
  assert.ok(overdue(run('waiting', { deadline: 5000 }), 5000));
  assert.ok(!overdue(run('done', { deadline: 5000 }), 5000));
  const ended = run('failed', { deadline: 5000, steps: [{ i: 0, tool: 'read_page', args: { url: 'https://shop.com/p' }, effect: 'read', state: 'failed', at: 1 }] });
  assert.equal(retryStep(ended, 0), null);
  assert.equal(ended.deadline, undefined);
});

test('a waiting run stays waiting when the next slot queues a run', () => {
  const r = routine({ kind: 'daily', at: '09:00' });
  const waiting = run('waiting', { requests: [{ id: 'q', kind: 'reach', text: '', sensitive: false, expiresAt: r.nextDue + 3_600_000 }] });
  const c = claim(r, [waiting], r.nextDue);
  assert.deepEqual(c.fail, []);
  assert.ok(c.newRun);
  assert.deepEqual(claim(r, [waiting], r.nextDue + 2 * 3_600_000).fail, ['waiting'], 'only its expiry fails it');
});

test('a request in a routine run expires 24 h after it is made', () => {
  const g: Gardener = { v: 1, id: 'g1', name: 'P', instructions: '', sites: ['shop.com'], minutes: 10, createdAt: 0 };
  const r = { ...newRun({ id: 'x', gardenerId: 'g1', routineId: 'r1', work: { kind: 'ask', request: 'go' }, now: 0 }), model: 'm', maxTokens: 32768, agent: { loop: true, maxSteps: 8 },
    turns: [{ purpose: 'choose' as const, reply: '{"tool":"read_page","args":{"url":"https://evil.com/"}}', at: 1 }] };
  const a = next(r, { gardener: g, tools: TOOLS, now: 1000, routine: routine({ kind: 'every', hours: 1 }, { nextDue: 5000 }) });
  assert.ok('request' in a && a.request.expiresAt === 1000 + 24 * 3_600_000);
});

const EVENT: When = { kind: 'event', url: 'https://shop.com/p', every: 15 };

test('a due event routine with no trigger moves nextDue on and makes no run; with one, a run carrying the diff', () => {
  const r = routine(EVENT, { nextDue: 1000 });
  const none = claim(r, [], 1000);
  assert.equal(none.newRun, undefined);
  assert.equal(none.routine.nextDue, 1000 + 15 * 60_000);
  assert.equal(none.routine.skipped, undefined);
  const trigger = { url: 'https://shop.com/p', diff: '+ Price: £9', signedIn: false };
  const c = claim(r, [], 1000, trigger);
  assert.deepEqual(c.newRun?.trigger, trigger);
  assert.equal(c.newRun?.tainted, false);
});

test('an event with onlyIf ["price"] fires only when an added line holds "price"', () => {
  const when: When = { ...EVENT, onlyIf: ['price'] };
  assert.equal(eventTrigger(when, 'a\nb', 'a\nb\nNew stock', false), null);
  assert.equal(eventTrigger(when, 'a\nPrice: £9', 'a', false), null, 'a removed line is not a change that fires');
  assert.match(eventTrigger(when, 'a', 'a\nPRICE: £7', false)!.diff, /\+ PRICE: £7/);
  assert.equal(eventTrigger(EVENT, undefined, 'a', false), null, 'the first look only sets the snapshot');
});

test('a signed-in event check\'s run starts tainted', () => {
  assert.equal(eventTrigger({ ...EVENT, url: 'https://far.com/' }, 'a', 'a\nnew', false)?.signedIn, false);
  const on = eventTrigger(EVENT, 'a', 'a\nnew', true)!;
  assert.equal(claim(routine(EVENT, { nextDue: 0 }), [], 0, on).newRun?.tainted, true);
});

test('the word think\'s data starts with what changed on the event page', () => {
  const g: Gardener = { v: 1, id: 'g1', name: 'P', instructions: '', sites: [], minutes: 10, createdAt: 0 };
  const r = run('running', { model: 'm', maxTokens: 4096, agent: { loop: false, maxSteps: 4 }, trigger: { url: 'https://shop.com/p', diff: '+ Price: £9', signedIn: false },
    steps: [{ i: 0, tool: 'read_page', args: { url: 'https://shop.com/p' }, effect: 'read', state: 'done', output: 'First look:\nx', at: 1 }] });
  const a = next(r, { gardener: g, tools: TOOLS, now: 1 });
  assert.ok('think' in a && a.think.data.startsWith('What changed on https://shop.com/p:\n+ Price: £9\n\n'));
});

test('the event fetch: an error status or a signed-in redirect fails the check, so no snapshot is written', async () => {
  Object.assign(globalThis, { chrome: { i18n: { getUILanguage: () => 'en' } } }); // monitors.ts reads the UI language at load
  const { checkFetch } = await import('../../src/background/monitors.ts');
  const inits: RequestInit[] = [];
  const answer = (res: Partial<Response>) => (async (_: unknown, init?: RequestInit) => (inits.push(init!), { ok: true, status: 200, type: 'basic', text: async () => 'page', ...res })) as unknown as typeof fetch;
  await assert.rejects(checkFetch('https://a.com/', 'omit', answer({ ok: false, status: 503 })), /503/);
  await assert.rejects(checkFetch('https://shop.com/', 'include', answer({ ok: false, status: 0, type: 'opaqueredirect' })), /redirected/);
  assert.equal(await checkFetch('https://a.com/', 'omit', answer({})), 'page');
  assert.deepEqual(inits.map((i) => [i.credentials, i.redirect, i.signal instanceof AbortSignal]), [['omit', 'follow', true], ['include', 'manual', true], ['omit', 'follow', true]]);
});
