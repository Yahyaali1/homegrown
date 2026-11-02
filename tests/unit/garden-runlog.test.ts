// Runs as chats: retry one step, auto-retry a read once, queued messages become follow-ups, Unread, and a local
// report that leaves page text out unless asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoRetry, earlierOf, next, queuedFollowUp, retryStep, type Ctx } from '../../src/domain/garden/loop.ts';
import { reportOf } from '../../src/domain/garden/report.ts';
import { TOOLS } from '../../src/domain/garden/tools.ts';
import { historyGroup, newRun, type Gardener, type GardenRun, type Step } from '../../src/domain/garden/records.ts';

const g: Gardener = { v: 1, id: 'g1', name: 'Pricer', instructions: 'Be brief.', sites: ['shop.com'], minutes: 10, createdAt: 0 };
const ctx: Ctx = { gardener: g, tools: TOOLS, now: 100_000 };
const PIN = { model: 'm', maxTokens: 4096, agent: { loop: false, maxSteps: 8 }, abilities: ['plan' as const] };
const URLS = ['https://shop.com/a', 'https://shop.com/b', 'https://shop.com/c', 'https://shop.com/d'];
const read = (i: number, over: Partial<Step> = {}): Step =>
  ({ i, tool: 'read_page', args: { url: URLS[i] }, effect: 'read', state: 'done', digest: `read_page ${URLS[i]} → ok`, output: `SECRET page ${i}`, at: 10 + i, ...over });
const reads = (over: Partial<GardenRun> = {}): GardenRun => ({
  ...newRun({ id: 'r', gardenerId: 'g1', work: { kind: 'read', urls: URLS }, now: 0 }), ...PIN,
  steps: [read(0), read(1), { ...read(2), state: 'failed', error: 'shop.com took too long to read.', output: '' }, read(3)],
  turns: [{ purpose: 'word', reply: 'Page a changed.', at: 20 }], status: 'done', answer: 'Page a changed.', endedAt: 21, ...over,
});

test('runRetry on step 2 of 4 removes steps 2–4 and the word turn; next() re-issues step 2', () => {
  const r = reads();
  assert.equal(retryStep(r, 2), null);
  assert.deepEqual(r.steps.map((s) => s.i), [0, 1]);
  assert.deepEqual(r.turns, []);
  assert.equal(r.status, 'queued');
  assert.equal(r.answer, undefined);
  assert.deepEqual(r.retry, { i: 2, tries: 1 });
  assert.deepEqual(next(r, ctx), { call: { i: 2, tool: 'read_page', args: { url: URLS[2] } } });
});

test('retry is refused for open work, for a live run, and for an act without a “No”', () => {
  const ask: GardenRun = { ...newRun({ id: 'o', gardenerId: 'g1', work: { kind: 'ask', request: 'x' }, now: 0 }), ...PIN, status: 'failed', steps: [read(0, { state: 'failed' })] };
  assert.match(retryStep(ask, 0)!, /follow-up/);
  assert.match(retryStep(reads({ status: 'running' }), 2)!, /still working/);
  assert.match(retryStep(reads(), 1)!, /didn’t fail/);
  const act: Step = { i: 0, tool: 'act', args: { url: 'https://shop.com/f' }, effect: 'act', state: 'failed', error: 'Not allowed.', at: 5 };
  const p: GardenRun = { ...newRun({ id: 'p', gardenerId: 'g1', work: { kind: 'plan', request: 'x' }, now: 0 }), ...PIN, status: 'done', plan: [{ tool: 'act', args: act.args }], steps: [act] };
  assert.match(retryStep(p, 0)!, /did it happen/);
  // After the person said it did not happen, it can be retried; their old answers for it go, so it is asked again.
  p.requests.push({ id: 'd', kind: 'did-it-happen', step: 0, tool: 'act', text: '', sensitive: false, answer: { value: 'no', at: 4 } });
  assert.equal(retryStep(p, 0), null);
  assert.deepEqual(p.requests, []);
});

test('a timeout or network read is auto-retried once; a second failure stays failed; an act never is', () => {
  const failed = (tool: string, error: string, tries?: number): Step => ({ i: 0, tool, args: {}, effect: tool === 'act' ? 'act' : 'read', state: 'failed', error, at: 1, ...(tries && { tries }) });
  assert.equal(autoRetry(failed('read_page', 'shop.com took too long to read.')), true);
  assert.equal(autoRetry(failed('search', 'net::ERR_CONNECTION_REFUSED')), true);
  assert.equal(autoRetry(failed('read_page', 'Frame with ID 0 is showing error page')), true);
  assert.equal(autoRetry(failed('read_page', 'shop.com took too long to read.', 1)), false, 'once only');
  assert.equal(autoRetry(failed('read_page', 'Not allowed.')), false);
  assert.equal(autoRetry(failed('act', 'shop.com took too long to read.')), false);
  assert.equal(autoRetry(failed('mission', 'net::ERR_FAILED')), false);
});

test('a queued message is in no think, and starts a follow-up when the run ends', () => {
  const r: GardenRun = { ...newRun({ id: 'q', gardenerId: 'g1', work: { kind: 'read', urls: URLS.slice(0, 1) }, now: 0 }), ...PIN,
    steps: [read(0)], tainted: true, inbox: [{ id: 'm1', text: 'Which is cheapest?', at: 1, steer: false }, { id: 'm2', text: 'And the dearest?', at: 2, steer: false }] };
  const a = next(r, ctx);
  assert.ok('think' in a && a.think.purpose === 'word');
  assert.ok(!a.think.prompt.includes('cheapest') && !a.think.data.includes('cheapest') && !a.think.steer);
  const f = queuedFollowUp(r, 'f1', 50)!;
  assert.equal(r.inbox![0]!.usedAt, 50);
  assert.deepEqual(f.work, { kind: 'plan', request: 'Which is cheapest?' });
  assert.equal(f.followUp, 'q');
  assert.equal(f.tainted, true, 'what the earlier run read stays private');
  assert.equal(queuedFollowUp(r, 'f2', 60)!.work.kind, 'plan');
  assert.equal(queuedFollowUp(r, 'f3', 70), null, 'each message once');
  assert.equal(queuedFollowUp({ ...r, agent: { loop: true, maxSteps: 8 }, inbox: [{ id: 'm', text: 'x', at: 1, steer: false }] }, 'f4', 1)!.work.kind, 'ask');
});

test('a follow-up’s data starts with the earlier answer and step digests, never its instructions', () => {
  const earlier = earlierOf(reads());
  assert.match(earlier, /^Earlier answer: Page a changed\./);
  assert.match(earlier, /read_page https:\/\/shop\.com\/b → ok/);
  assert.ok(!earlier.includes('SECRET'));
  const f: GardenRun = { ...newRun({ id: 'f', gardenerId: 'g1', work: { kind: 'plan', request: 'Why?' }, now: 0 }), ...PIN, followUp: 'r',
    plan: [{ tool: 'read_page', args: { url: URLS[0] } }], steps: [read(0)] };
  const sum = next(f, { ...ctx, earlier });
  assert.ok('think' in sum && sum.think.purpose === 'sum');
  assert.ok(sum.think.data.startsWith(earlier));
  assert.ok(!sum.think.prompt.includes('Page a changed'));
  const { plan: _, ...unplanned } = f;
  const plan = next({ ...unplanned, steps: [] }, { ...ctx, earlier });
  assert.ok('think' in plan && plan.think.purpose === 'plan' && plan.think.data.startsWith(earlier));
});

test('history groups: Needs you, Unread until runSeen, then by routine, then by hand', () => {
  const base = newRun({ id: 'h', gardenerId: 'g1', work: { kind: 'read', urls: URLS.slice(0, 1) }, now: 0 });
  assert.equal(historyGroup({ ...base, status: 'waiting' }), 'needs');
  assert.equal(historyGroup({ ...base, status: 'done', endedAt: 10 }), 'unread');
  assert.equal(historyGroup({ ...base, status: 'failed', endedAt: 10, seenAt: 5 }), 'unread', 'ended after it was seen');
  assert.equal(historyGroup({ ...base, status: 'done', endedAt: 10, seenAt: 11 }), 'hand');
  assert.equal(historyGroup({ ...base, routineId: 'rt', status: 'done', endedAt: 10, seenAt: 11 }), 'routine');
  assert.equal(historyGroup({ ...base, routineId: 'rt', status: 'running' }), 'routine');
});

test('reportOf has no page text unless asked', () => {
  const r = reads({ status: 'failed', why: 'None of the pages could be read.' });
  const plain = JSON.stringify(reportOf(r, false, '0.6.0'));
  assert.ok(!plain.includes('SECRET') && !plain.includes('Page a changed'));
  const o = reportOf(r, false, '0.6.0');
  assert.equal(o.version, '0.6.0');
  assert.equal(o.model, 'm');
  assert.equal(o.status, 'failed');
  assert.equal(o.why, 'None of the pages could be read.');
  assert.equal(o.steps.length, 4);
  const full = JSON.stringify(reportOf(r, true, '0.6.0'));
  assert.ok(full.includes('SECRET page 0') && full.includes('Page a changed'));
});

test('a follow-up whose earlier run is tainted now taints itself before a think reads it (a retry can taint it later)', () => {
  const earlier = earlierOf(reads());
  const f: GardenRun = { ...newRun({ id: 'f', gardenerId: 'g1', work: { kind: 'plan', request: 'Why?' }, now: 0 }), ...PIN, followUp: 'r',
    plan: [{ tool: 'read_page', args: { url: URLS[0] } }], steps: [read(0)] };
  const clean = next(f, { ...ctx, earlier, earlierTainted: false });
  assert.ok('think' in clean && !clean.think.taint);
  const sum = next(f, { ...ctx, earlier, earlierTainted: true });
  assert.ok('think' in sum && sum.think.purpose === 'sum' && sum.think.taint);
  const { plan: _, ...unplanned } = f;
  const plan = next({ ...unplanned, steps: [] }, { ...ctx, earlier, earlierTainted: true });
  assert.ok('think' in plan && plan.think.purpose === 'plan' && plan.think.taint);
});

test('a report without page text leaves out digests that quote the model (note, draft)', () => {
  const r = reads({ steps: [read(0), { i: 1, tool: 'note', args: { text: 'PRIVATE note from a page' }, effect: 'read', state: 'done', digest: 'note PRIVATE note from a page → ok', at: 11 },
    { i: 2, tool: 'draft', args: { title: 'PRIVATE draft', text: 'x' }, effect: 'act', state: 'done', digest: 'draft PRIVATE draft → ok', at: 12 }] });
  const plain = reportOf(r, false);
  assert.equal(plain.steps[0]!.digest, read(0).digest);
  assert.ok(!JSON.stringify(plain).includes('PRIVATE'), JSON.stringify(plain));
  assert.ok(JSON.stringify(reportOf(r, true)).includes('PRIVATE draft'));
});
