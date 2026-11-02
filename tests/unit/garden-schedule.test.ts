// Routines run when the person said, in their own time zone, through clock changes and missed alarms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claim, nextAfter } from '../../src/domain/garden/schedule.ts';
import { newRun, type GardenRun, type Routine, type When } from '../../src/domain/garden/records.ts';

const local = (tz: string, t: number) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
const at = (iso: string) => Date.parse(iso);
const series = (when: When, tz: string, from: number, n: number) => {
  const out: number[] = [];
  for (let t = from; out.length < n; ) out.push((t = nextAfter(when, tz, t, t)));
  return out;
};

test('weekly Monday 08:00 London is due at 08:00 local the weeks either side of both clock changes', () => {
  const when: When = { kind: 'weekly', days: [1], at: '08:00' };
  assert.deepEqual(series(when, 'Europe/London', at('2026-03-16T08:00Z'), 3).map((t) => local('Europe/London', t)), ['Mon 23 Mar, 08:00', 'Mon 30 Mar, 08:00', 'Mon 6 Apr, 08:00']);
  assert.deepEqual(series(when, 'Europe/London', at('2026-10-12T07:00Z'), 3).map((t) => local('Europe/London', t)), ['Mon 19 Oct, 08:00', 'Mon 26 Oct, 08:00', 'Mon 2 Nov, 08:00']);
});

test('daily 01:30 London runs once on the fall-back day, at its first 01:30', () => {
  const when: When = { kind: 'daily', at: '01:30' };
  const [sun, mon] = series(when, 'Europe/London', at('2026-10-24T00:30Z'), 2);
  assert.equal(sun, at('2026-10-25T00:30Z'), '01:30 BST, not the second 01:30 an hour later');
  assert.equal(mon, at('2026-10-26T01:30Z'));
  assert.equal(nextAfter(when, 'Europe/London', sun!, at('2026-10-25T01:15Z')), mon, 'between the two 01:30s, the next is tomorrow');
});

test('daily 01:30 London runs at 02:30 on the spring-forward day, when 01:30 doesn\'t exist', () => {
  const t = nextAfter({ kind: 'daily', at: '01:30' }, 'Europe/London', at('2026-03-28T01:30Z'), at('2026-03-28T01:30Z'));
  assert.equal(local('Europe/London', t), 'Sun 29 Mar, 02:30');
});

test('a zone whose clocks change at midnight (Havana) still gets a valid time that day', () => {
  const t = nextAfter({ kind: 'daily', at: '00:30' }, 'America/Havana', at('2026-03-07T05:30Z'), at('2026-03-07T05:30Z'));
  assert.equal(local('America/Havana', t), 'Sun 8 Mar, 01:30');
});

test('a slot pushed past midnight by a spring-forward gap doesn\'t lose the next day\'s slot (Nuuk)', () => {
  const tz = 'America/Nuuk';
  assert.deepEqual(series({ kind: 'daily', at: '23:30' }, tz, at('2026-03-28T01:30Z'), 3).map((t) => local(tz, t)), ['Sun 29 Mar, 00:30', 'Sun 29 Mar, 23:30', 'Mon 30 Mar, 23:30']);
  assert.deepEqual(series({ kind: 'weekly', days: [0, 6], at: '23:30' }, tz, at('2026-03-23T01:30Z'), 2).map((t) => local(tz, t)), ['Sun 29 Mar, 00:30', 'Sun 29 Mar, 23:30']);
});

test('every N hours keeps its rhythm after a gap', () => {
  assert.equal(nextAfter({ kind: 'every', hours: 6 }, 'UTC', 0, 13 * 3_600_000), 18 * 3_600_000);
  assert.equal(nextAfter({ kind: 'every', hours: 6 }, 'UTC', null, 1000), 1000 + 6 * 3_600_000, 'a new routine counts from now');
});

const routine = (over: Partial<Routine> = {}): Routine => ({ v: 1, id: 'r1', gardenerId: 'g1', name: 'Mondays', when: { kind: 'weekly', days: [1], at: '08:00' }, tz: 'Europe/London', work: { kind: 'mission', goal: 'cheap tea' }, paused: false, nextDue: at('2026-03-02T08:00Z'), createdAt: 0, ...over });
const run = (status: GardenRun['status'], over: Partial<GardenRun> = {}): GardenRun => ({ ...newRun({ id: status, gardenerId: 'g1', routineId: 'r1', work: { kind: 'mission', goal: 'cheap tea' }, now: 0 }), status, ...over });

test('a routine 3 weeks overdue is claimed once', () => {
  const now = at('2026-03-23T09:00Z');
  const first = claim(routine(), [], now);
  assert.ok(first.newRun);
  assert.equal(local('Europe/London', first.routine.nextDue), 'Mon 30 Mar, 08:00');
  assert.equal(first.routine.lastRunId, first.newRun.id);
  assert.equal(claim(first.routine, [first.newRun], now).newRun, undefined);
});

test('claim skips a slot while a run still works, and the next run says so', () => {
  const now = at('2026-03-02T08:00Z');
  const skipped = claim(routine(), [run('running')], now);
  assert.equal(skipped.newRun, undefined);
  assert.deepEqual(skipped.routine.skipped, [now]);
  const later = claim(skipped.routine, [run('done')], skipped.routine.nextDue);
  assert.deepEqual(later.newRun?.skipped, [now]);
  assert.equal(later.routine.skipped, undefined, 'cleared once handed over');
});

test('a due slot leaves a run still waiting for the person, and starts a new one beside it', () => {
  const c = claim(routine(), [run('waiting', { requests: [{ id: 'q', kind: 'reach', text: 'open?', sensitive: false }] })], at('2026-03-02T08:00Z'));
  assert.deepEqual(c.fail, []);
  assert.ok(c.newRun);
});

test('a paused routine claims nothing, but an expired request still fails its run', () => {
  const waiting = run('waiting', { requests: [{ id: 'q', kind: 'reach', text: 'open?', sensitive: false, expiresAt: 10 }] });
  const c = claim(routine({ paused: true }), [waiting], at('2026-03-02T08:00Z'));
  assert.equal(c.newRun, undefined);
  assert.equal(c.routine.nextDue, routine().nextDue);
  assert.deepEqual(c.fail, ['waiting']);
});
