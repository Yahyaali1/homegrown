// Helpers: a read of more than 5 pages splits into helper runs of 5, at most 3 at once; the parent words once over
// all of them. Taint flows up, Stop and Resume all act per helper, and only code answers the parent's wait.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerRefused, helpersOf, mergeHelpers, next, recover, resumeAll, retryStep, type Ctx } from '../../src/domain/garden/loop.ts';
import { approveAllOk } from '../../src/domain/garden/policy.ts';
import { claim, nextBatch } from '../../src/domain/garden/schedule.ts';
import { TOOLS } from '../../src/domain/garden/tools.ts';
import { historyGroup, mayStart, newRun, parseWork, pruneIds, type Gardener, type GardenRun, type Routine, type Step } from '../../src/domain/garden/records.ts';

const g: Gardener = { v: 1, id: 'g1', name: 'Pricer', instructions: 'Be brief.', sites: ['shop.com'], minutes: 10, createdAt: 0 };
const ctx: Ctx = { gardener: g, tools: TOOLS, now: 1000 };
const PIN = { model: 'm', maxTokens: 4096, agent: { loop: false, maxSteps: 8 }, abilities: [] };
const URLS = Array.from({ length: 12 }, (_, i) => `https://shop.com/p${i}`);
const parent = (over: Partial<GardenRun> = {}): GardenRun => ({ ...newRun({ id: 'P', gardenerId: 'g1', routineId: 'R', work: { kind: 'read', urls: URLS }, now: 0 }), ...PIN, ...over });
const done = (i: number, url: string): Step => ({ i, tool: 'read_page', args: { url }, effect: 'read', state: 'done', digest: `read_page ${url} → ok`, output: `page ${url}`, at: 5 });

/** The parent asks for helpers, waits, and gets them. */
function split(): { p: GardenRun; kids: GardenRun[] } {
  const p = parent({ status: 'running' });
  const a = next(p, ctx);
  assert.ok('request' in a && a.request.kind === 'helpers');
  p.requests.push({ id: 'h', ...a.request });
  p.status = 'waiting';
  return { p, kids: helpersOf(p, 10) };
}
/** Each helper reads its pages and ends done, as the worker would. */
function finish(k: GardenRun): void {
  k.status = 'running';
  for (let a = next(k, ctx); !('done' in a); a = next(k, ctx)) {
    assert.ok('call' in a, JSON.stringify(a));
    k.steps.push(done(a.call.i, String(a.call.args.url)));
  }
  Object.assign(k, { status: 'done', endedAt: 20 });
}

test('a read takes up to 25 pages; 12 make 3 helpers of 5, 5 and 2 with the parent’s pin, sites and taint', () => {
  assert.ok(parseWork({ kind: 'read', urls: Array.from({ length: 25 }, (_, i) => `https://shop.com/${i}`) }));
  assert.equal(parseWork({ kind: 'read', urls: Array.from({ length: 26 }, (_, i) => `https://shop.com/${i}`) }), null);
  const p = parent({ status: 'running', tainted: true });
  const a = next(p, ctx);
  assert.ok('request' in a && a.request.kind === 'helpers' && !a.request.sensitive);
  p.requests.push({ id: 'h', ...a.request });
  const kids = helpersOf(p, 10);
  assert.deepEqual(kids.map((k) => k.work.kind === 'read' && k.work.urls.length), [5, 5, 2]);
  assert.deepEqual(kids.flatMap((k) => (k.work.kind === 'read' ? k.work.urls : [])), URLS);
  for (const k of kids) {
    assert.equal(k.parentId, 'P');
    assert.equal(k.gardenerId, 'g1');
    assert.equal(k.routineId, 'R');
    assert.equal(k.tainted, true);
    assert.equal(k.model, 'm');
    assert.deepEqual(k.seen, p.seen);
    assert.equal(k.status, 'queued');
  }
  assert.deepEqual(helpersOf(p, 10).map((k) => k.id), kids.map((k) => k.id), 'the same ids each time: a restart can’t make more');
  // Five pages or fewer: no helpers, as before.
  const small = parent({ work: { kind: 'read', urls: URLS.slice(0, 5) } });
  assert.deepEqual(next(small, ctx), { call: { i: 0, tool: 'read_page', args: { url: URLS[0] } } });
});

test('a helper reads and ends without a think; the parent words once over all pages after all end', () => {
  const { p, kids } = split();
  for (const k of kids) finish(k);
  assert.ok(kids.every((k) => k.turns.length === 0), 'helpers never call the model');
  kids[2]!.status = 'running';
  assert.equal(mergeHelpers(p, kids, 30), false, 'not until every helper ended');
  kids[2]!.status = 'done';
  assert.equal(mergeHelpers(p, kids, 30), true);
  assert.equal(p.status, 'queued');
  assert.deepEqual(p.steps.map((s) => s.i), URLS.map((_, i) => i));
  p.status = 'running';
  const a = next(p, ctx);
  assert.ok('think' in a && a.think.purpose === 'word');
  for (const u of URLS) assert.match(a.think.data, new RegExp(`${u}\\n`));
  p.turns.push({ purpose: 'word', reply: 'All twelve.', at: 40 });
  assert.deepEqual(next(p, ctx), { done: { answer: 'All twelve.' } });
  assert.equal(mergeHelpers(p, kids, 50), false, 'answered once');
});

test('a helper’s taint reaches the parent before its word think; a stopped helper’s pages are named as missed', () => {
  const { p, kids } = split();
  for (const k of kids) finish(k);
  kids[1]!.tainted = true;
  // The third helper was stopped mid-read: its started step and unread page count as not read.
  Object.assign(kids[2]!, { status: 'stopped', steps: [done(0, URLS[10]!), { ...done(1, URLS[11]!), state: 'started' }] });
  assert.equal(mergeHelpers(p, kids, 30), true);
  assert.equal(p.tainted, true);
  assert.equal(p.steps[11]!.state, 'failed');
  p.status = 'running';
  p.turns.push({ purpose: 'word', reply: 'Eleven.', at: 40 });
  const a = next(p, ctx);
  assert.ok('done' in a && a.done.answer.includes(`Couldn't read: ${URLS[11]}`));
});

test('recover puts running helpers back in the queue; the parent stays waiting on them', () => {
  const { p, kids } = split();
  kids[0]!.status = 'running';
  const [rp, r0, r1] = recover([p, kids[0]!, kids[1]!], 99);
  assert.equal(rp!.status, 'waiting');
  assert.equal(r0!.status, 'queued');
  assert.equal(r1!.status, 'queued');
});

test('only code answers a helpers wait: a page’s answer is refused, Approve all skips it, it is not Needs you', () => {
  const { p } = split();
  const q = p.requests[0]!;
  assert.match(answerRefused(q)!, /helpers/);
  assert.equal(answerRefused({ ...q, kind: 'reach' }), null);
  assert.equal(approveAllOk(q, p), false);
  assert.notEqual(historyGroup(p), 'needs');
  assert.equal(historyGroup({ ...p, requests: [{ ...q, kind: 'reach' }] }), 'needs');
});

test('the queue runs up to 3 helpers of the oldest parent together, and nothing else beside them', () => {
  const { p, kids } = split();
  const fourth = { ...kids[2]!, id: 'P.h4' };
  const other = { ...newRun({ id: 'O', gardenerId: 'g1', work: { kind: 'read', urls: URLS.slice(0, 1) }, now: 5 }) };
  assert.deepEqual(nextBatch([other, p, ...kids, fourth], 50).map((r) => r.id), kids.map((k) => k.id), 'the parent was queued first');
  // Stop on one helper leaves its siblings to run, and the parent still waits for them.
  kids[0]!.status = 'stopped';
  assert.deepEqual(nextBatch([other, p, ...kids], 50).map((r) => r.id), [kids[1]!.id, kids[2]!.id]);
  assert.equal(mergeHelpers(p, kids, 50), false);
  // A run waiting out its 30 s auto-retry doesn't hold the queue: the next run goes first.
  const later = { ...kids[1]!, retryAt: 80 };
  assert.deepEqual(nextBatch([other, p, kids[0]!, later], 50).map((r) => r.id), ['O']);
  assert.deepEqual(nextBatch([p, kids[0]!, later], 80).map((r) => r.id), [later.id]);
});

test('a routine skips its slot while a parent waits on helpers, and never fails it', () => {
  const { p, kids } = split();
  const r: Routine = { v: 1, id: 'R', gardenerId: 'g1', name: 'Prices', when: { kind: 'every', hours: 1 }, tz: 'UTC', work: p.work, paused: false, nextDue: 100, createdAt: 0 };
  for (const k of kids) Object.assign(k, { status: 'done' });
  const c = claim(r, [p, ...kids], 200);
  assert.equal(c.newRun, undefined);
  assert.deepEqual(c.fail, []);
  assert.deepEqual(c.routine.skipped, [100]);
});

test('Resume all re-queues only failed and stopped helpers, with the parent’s taint; an ended parent waits again', () => {
  const { p, kids } = split();
  for (const k of kids) finish(k);
  Object.assign(kids[0]!, { status: 'failed', why: 'Something went wrong', steps: [done(0, URLS[0]!), { ...done(1, URLS[1]!), state: 'failed', error: 'x' }, done(2, URLS[2]!)] });
  Object.assign(kids[1]!, { status: 'stopped', interrupted: 2 });
  mergeHelpers(p, kids, 30);
  Object.assign(p, { status: 'done', answer: 'Some.', endedAt: 40, tainted: true, turns: [{ purpose: 'word', reply: 'Some.', at: 40 }] });
  const out = resumeAll(p, kids, 'h2');
  assert.ok(Array.isArray(out));
  assert.deepEqual(out.map((r) => r.id).sort(), ['P', kids[0]!.id, kids[1]!.id].sort());
  for (const k of [kids[0]!, kids[1]!]) {
    assert.equal(k.status, 'queued');
    assert.equal(k.interrupted, 0);
    assert.equal(k.tainted, true, 'a resumed helper keeps the parent’s taint');
    assert.equal(k.why, undefined);
  }
  assert.deepEqual(kids[0]!.steps.map((s) => s.i), [0], 'from its first failed step on, read again');
  assert.equal(kids[2]!.status, 'done', 'a helper that finished is left alone');
  assert.equal(p.status, 'waiting');
  assert.deepEqual([p.steps, p.turns, p.answer], [[], [], undefined]);
  assert.deepEqual(p.requests.filter((q) => q.kind === 'helpers' && !q.answer).map((q) => q.id), ['h2']);
  assert.match(resumeAll(p, kids, 'h3') as string, /No helper/);
  assert.match(resumeAll(parent({ status: 'done' }), [], 'h3') as string, /no helpers/);
});

test('a helper can’t retry one step by itself: its parent can', () => {
  const { kids } = split();
  finish(kids[0]!);
  kids[0]!.steps[1] = { ...kids[0]!.steps[1]!, state: 'failed', error: 'x' };
  assert.match(retryStep(kids[0]!, 1)!, /parent/);
});

test('a helper starts only while its parent waits on helpers: after Stop on the parent, it doesn’t', () => {
  const { p, kids } = split();
  assert.equal(mayStart(kids[0]!, p), true);
  assert.equal(mayStart(kids[0]!, { ...p, status: 'stopped' }), false);
  assert.equal(mayStart(kids[0]!, null), false, 'parent deleted');
  assert.equal(mayStart(parent(), null), true, 'not a helper');
});

test('a routine’s new slot doesn’t fail a helper waiting on the person; only its expiry does', () => {
  const { p, kids } = split();
  kids[0]!.status = 'waiting';
  kids[0]!.requests.push({ id: 't', kind: 'takeover', text: '', sensitive: false, expiresAt: 1000 });
  const r: Routine = { v: 1, id: 'R', gardenerId: 'g1', name: 'Prices', when: { kind: 'every', hours: 1 }, tz: 'UTC', work: p.work, paused: false, nextDue: 100, createdAt: 0 };
  assert.deepEqual(claim(r, [p, ...kids], 200).fail, []);
  assert.deepEqual(claim(r, [p, ...kids], 2000).fail, [kids[0]!.id]);
});

test('prune keeps the newest runs by parent: helpers don’t count, and go with their parent or when it is gone', () => {
  const ended = (id: string, at: number, parentId?: string): GardenRun => ({ ...parent(), id, queuedAt: at, status: 'done', ...(parentId && { parentId }) });
  const runs = [ended('A', 3), ended('A.h1', 3, 'A'), ended('A.h2', 3, 'A'), ended('B', 2), ended('C', 1), ended('C.h1', 1, 'C'), ended('X.h1', 0, 'X')];
  assert.deepEqual(pruneIds(runs, 2).sort(), ['C', 'C.h1', 'X.h1']);
  assert.deepEqual(pruneIds(runs, 30), ['X.h1']);
});

test('Resume all and Retry step reset a run alike: no end, no retry wait, a fresh budget, no deadline', () => {
  const { p, kids } = split();
  for (const k of kids) finish(k);
  Object.assign(kids[0]!, { status: 'failed', why: 'x', endedAt: 9, retryAt: 99, usedMs: 5000, deadline: 50 });
  kids[0]!.steps[1] = { ...kids[0]!.steps[1]!, state: 'failed', error: 'x' };
  assert.ok(Array.isArray(resumeAll(p, kids, 'h2')));
  const k = kids[0]!;
  assert.deepEqual([k.status, k.why, k.endedAt, k.retryAt, k.usedMs, k.deadline], ['queued', undefined, undefined, undefined, 0, undefined]);
});
