// Gardener records: what the person writes is normalised, and stored data from a newer build is left alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRun, parseGardener, parseRoutine, parseRun, site, sitesOf } from '../../src/domain/garden/records.ts';

const gardener = { v: 1, id: 'g1', name: 'Pricer', instructions: 'Watch prices.', sites: ['shop.example.com'], createdAt: 1 };
const routine = { v: 1, id: 'r1', gardenerId: 'g1', name: 'Mondays', when: { kind: 'weekly', days: [1], at: '08:00' }, tz: 'Europe/London', work: { kind: 'read', urls: ['https://shop.example.com/p#top'] }, paused: false, nextDue: 5, createdAt: 1 };

test('a site entry is a bare host; shared hosting and single labels are refused', () => {
  assert.equal(site('https://WWW.Example.com:8080/pricing?x=1'), 'example.com');
  assert.equal(site('github.io'), null, 'anyone can publish under github.io');
  assert.equal(site('me.github.io'), 'me.github.io', 'one tenant is fine');
  assert.equal(site('co.za'), null);
  assert.equal(site('localhost'), null);
  assert.deepEqual(sitesOf(['example.com', 'www.example.com', 'vercel.app', '']), { sites: ['example.com'], refused: ['vercel.app'] });
});

test('a gardener gets 10 minutes unless it says otherwise, and a refused site makes the record invalid', () => {
  assert.equal(parseGardener(gardener)?.minutes, 10);
  assert.equal(parseGardener({ ...gardener, minutes: 61 }), null);
  assert.equal(parseGardener({ ...gardener, sites: ['github.io'] }), null);
  assert.equal(parseGardener({ ...gardener, name: 'x'.repeat(41) }), null);
});

test('records with a newer v are ignored', () => {
  assert.equal(parseGardener({ ...gardener, v: 2 }), null);
  assert.equal(parseRoutine({ ...routine, v: 2 }), null);
  assert.equal(parseRun({ ...newRun({ id: 'x', gardenerId: 'g1', work: { kind: 'mission', goal: 'g' }, now: 1 }), v: 2 }), null);
});

test('a routine needs a real time zone and a real time; read URLs lose their fragment', () => {
  assert.deepEqual(parseRoutine(routine)?.work, { kind: 'read', urls: ['https://shop.example.com/p'] });
  assert.equal(parseRoutine({ ...routine, tz: 'Mars/Olympus' }), null);
  assert.equal(parseRoutine({ ...routine, when: { kind: 'daily', at: '24:00' } }), null);
  assert.equal(parseRoutine({ ...routine, when: { kind: 'weekly', days: [], at: '08:00' } }), null);
  assert.equal(parseRoutine({ ...routine, work: { kind: 'read', urls: ['javascript:alert(1)'] } }), null);
});

test('a new run can reach the person\'s own URLs and survives a round trip through storage', () => {
  const run = newRun({ id: 'x', gardenerId: 'g1', routineId: 'r1', work: { kind: 'read', urls: ['https://a.com/'] }, now: 1 });
  assert.deepEqual(run.seen, [{ url: 'https://a.com/', from: 'person' }]);
  assert.deepEqual(parseRun(JSON.parse(JSON.stringify(run))), run);
});

test('a stored request from before `origin` keeps its meaning: a plan yes, or an edit asked again', () => {
  const run = newRun({ id: 'x', gardenerId: 'g1', work: { kind: 'mission', goal: 'g' }, now: 1 });
  const q = { kind: 'approve', text: '', sensitive: false };
  const old = { ...run, requests: [{ ...q, id: 'a', fromPlan: true }, { ...q, id: 'b', editedFrom: 'a', noEdit: true }, { ...q, id: 'c' }] };
  assert.deepEqual(parseRun(old)?.requests.map((r) => [r.id, r.origin, 'fromPlan' in r || 'editedFrom' in r || 'noEdit' in r]),
    [['a', 'plan', false], ['b', { edit: 'a' }, false], ['c', undefined, false]]);
});
