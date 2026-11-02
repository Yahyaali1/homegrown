// A gardener run, step by step: what the loop asks the worker to do next for a stored run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_REFUSED, approveRequest, next, recover, type Action, type Ctx } from '../../src/domain/garden/loop.ts';
import { BAD_REPLY, TOO_LONG } from '../../src/domain/garden/prompt.ts';
import { argsKey } from '../../src/domain/garden/policy.ts';
import { TOOLS } from '../../src/domain/garden/tools.ts';
import { newRun, type Gardener, type GardenRun, type Step, type Turn, type Work } from '../../src/domain/garden/records.ts';

const g: Gardener = { v: 1, id: 'g1', name: 'Pricer', instructions: 'Be brief.', sites: ['shop.com'], minutes: 10, createdAt: 0 };
const ctx: Ctx = { gardener: g, tools: TOOLS, now: 1000 };
const SMALL = { maxTokens: 4096, agent: { loop: false, maxSteps: 4 } };
const LARGE = { maxTokens: 32768, agent: { loop: true, maxSteps: 8 } };
const ask: Work = { kind: 'ask', request: 'compare tea prices' };
const run = (work: Work, over: Partial<GardenRun> = {}): GardenRun => ({ ...newRun({ id: 'r', gardenerId: 'g1', work, now: 0 }), model: 'm', ...LARGE, ...over });
const turn = (purpose: Turn['purpose'], reply: string): Turn => ({ purpose, reply, at: 1 });
const step = (i: number, tool: string, args: Record<string, unknown>, over: Partial<Step> = {}): Step => ({ i, tool, args, effect: 'read', state: 'done', digest: `${tool} ok`, at: 1, ...over });
const kind = (a: Action) => Object.keys(a)[0];
const big = 'price line\n'.repeat(20_000);

test('the same open request: the 4k loop:false profile refuses it, the 32k loop:true profile chooses with a larger budget', () => {
  const history = { steps: [step(0, 'read_page', { url: 'https://shop.com/' }, { output: big.slice(0, 4000) }), step(1, 'read_page', { url: 'https://shop.com/b' }, { output: big.slice(0, 4000) }), step(2, 'read_page', { url: 'https://shop.com/c' }, { output: big.slice(0, 4000) })], turns: [turn('choose', '{"tool":"read_page","args":{"url":"https://shop.com/"}}'), turn('choose', '{"tool":"read_page","args":{"url":"https://shop.com/b"}}'), turn('choose', '{"tool":"read_page","args":{"url":"https://shop.com/c"}}')] };
  assert.deepEqual(next(run(ask, { ...SMALL, ...history }), ctx), { fail: OPEN_REFUSED });
  const a = next(run(ask, { ...LARGE, ...history }), ctx);
  assert.ok('think' in a && a.think.purpose === 'choose');
  assert.match(a.think.prompt, /^You are Pricer, a gardener working in a web browser for one person\.\nTheir instructions: Be brief\.\nThe task: compare tea prices\n/);
  assert.equal(a.think.data.match(/^\[\d\] read_page:/gm)?.length, 3, 'all three outputs fit in 32k');
  assert.deepEqual(a.think.sampling, { temperature: 0 });
  // The same request at 4k (if it could loop): the oldest whole result is left out, nothing is cut mid-text.
  const four = next(run(ask, { ...history, maxTokens: 4096, agent: LARGE.agent }), ctx);
  assert.ok('think' in four);
  assert.ok(four.think.data.length <= (4096 - 512) * 3 - four.think.prompt.length);
  assert.deepEqual(four.think.data.match(/^\[\d\] read_page:/gm), ['[2] read_page:', '[1] read_page:']);
  assert.ok(four.think.data.endsWith(big.slice(0, 4000)), 'the last entry kept is whole');
  assert.ok(a.think.data.length > four.think.data.length);
  // Direct work runs on both; the small model just sees less of each page.
  const reads = (p: typeof SMALL) => next(run({ kind: 'read', urls: ['https://shop.com/'] }, { ...p, steps: [step(0, 'read_page', { url: 'https://shop.com/' }, { output: big })] }), ctx);
  const [small, large] = [reads(SMALL), reads(LARGE)];
  assert.ok('think' in small && 'think' in large);
  assert.ok(small.think.data.length <= (4096 - 512) * 3 - small.think.prompt.length);
  assert.ok(large.think.data.length > small.think.data.length * 5);
});

test('a routine of reads opens each page in order, then words what changed', () => {
  const work: Work = { kind: 'read', urls: ['https://shop.com/a', 'https://shop.com/b'] };
  assert.deepEqual(next(run(work, SMALL), ctx), { call: { i: 0, tool: 'read_page', args: { url: 'https://shop.com/a' } } });
  const failed = step(1, 'read_page', { url: 'https://shop.com/b' }, { state: 'failed', error: 'timeout' });
  const afterReads = run(work, { ...SMALL, steps: [step(0, 'read_page', { url: 'https://shop.com/a' }, { output: '+ Tea £4' }), failed] });
  const w = next(afterReads, ctx);
  assert.ok('think' in w && w.think.purpose === 'word');
  assert.match(w.think.prompt, /^Here is what changed on each page since the last check/);
  assert.match(w.think.data, /https:\/\/shop\.com\/a\n\+ Tea £4/);
  assert.equal(w.think.sampling, undefined, 'wording uses the task defaults');
  const done = next({ ...afterReads, turns: [turn('word', 'Tea went up to £4.')] }, ctx);
  assert.deepEqual(done, { done: { answer: "Tea went up to £4.\n\nCouldn't read: https://shop.com/b" } });
});

test('a mission routine\'s answer is the mission\'s answer', () => {
  const work: Work = { kind: 'mission', goal: 'cheapest green tea' };
  assert.deepEqual(next(run(work, SMALL), ctx), { call: { i: 0, tool: 'mission', args: { goal: 'cheapest green tea' } } });
  assert.deepEqual(next(run(work, { ...SMALL, steps: [step(0, 'mission', { goal: 'x' }, { output: 'Sencha at £3.' })] }), ctx), { done: { answer: 'Sencha at £3.' } });
});

test('a bad reply gets one repair, then the run fails', () => {
  const r = next(run(ask, { turns: [turn('choose', 'I think I should search')] }), ctx);
  assert.ok('think' in r && r.think.purpose === 'repair');
  assert.match(r.think.prompt, /Reply with only the JSON\.$/);
  assert.equal(kind(next(run(ask, { turns: [turn('choose', '{"tool":"hack","args":{}}')] }), ctx)), 'think', 'an unknown tool is a bad reply too');
  assert.deepEqual(next(run(ask, { turns: [turn('choose', 'nope'), turn('repair', '{"tool":"search","args":{"q":"x"}}')] }), ctx), { fail: BAD_REPLY });
});

test('check with met:false continues once, telling the model what is still missing', () => {
  const answered = [turn('choose', '{"answer":"Tea is £3."}')];
  const c = next(run(ask, { turns: answered }), ctx);
  assert.ok('think' in c && c.think.purpose === 'check');
  assert.equal(c.think.prompt, 'Task: compare tea prices\nDoes the answer below complete the task? Reply with only {"met": true} or {"met": false, "missing": "…"}.');
  assert.equal(c.think.data, 'Answer: Tea is £3.', 'the model\'s answer is data, not instruction');
  const again = next(run(ask, { turns: [...answered, turn('check', '{"met": false, "missing": "the second shop"}')] }), ctx);
  assert.ok('think' in again && again.think.purpose === 'choose');
  assert.match(again.think.data, /^Still missing: the second shop\n/);
  const twice = [...answered, turn('check', '{"met": false, "missing": "x"}'), turn('choose', '{"answer":"Tea is £3 or £4."}'), turn('check', '{"met": false, "missing": "y"}')];
  assert.deepEqual(next(run(ask, { turns: twice }), ctx), { done: { answer: 'Tea is £3 or £4.', best: true } });
  assert.deepEqual(next(run(ask, { turns: [...answered, turn('check', 'sure')] }), ctx), { done: { answer: 'Tea is £3.' } }, 'only an explicit false continues');
});

test('steps used up: one last choose with no tools, then the check', () => {
  const turns = Array.from({ length: 8 }, (_, i) => turn('choose', `{"tool":"search","args":{"query":"tea ${i}"}}`));
  const steps = turns.map((_, i) => step(i, 'search', { query: `tea ${i}` }));
  const a = next(run(ask, { turns, steps }), ctx);
  assert.ok('think' in a && a.think.purpose === 'choose');
  assert.match(a.think.prompt, /Give your answer now\./);
  assert.doesNotMatch(a.think.prompt, /search\(query\)/);
});

test('an answered yes passes exactly that call, once; a no is recorded as refused', () => {
  const choose = turn('choose', '{"tool":"read_page","args":{"url":"https://evil.com/"}}');
  const asked = next(run(ask, { turns: [choose] }), ctx);
  assert.ok('request' in asked);
  const request = (value: string) => ({ ...asked.request, id: 'q1', answer: { value, at: 2 } });
  assert.equal(asked.request.argsKey, argsKey({ url: 'https://evil.com/' }));
  assert.deepEqual(next(run(ask, { turns: [choose], requests: [request('yes')] }), ctx), { call: { i: 0, tool: 'read_page', args: { url: 'https://evil.com/' } } });
  // The same call chosen again later is asked again: the yes was used.
  const later = run(ask, { turns: [choose, choose], requests: [request('yes')], steps: [step(0, 'read_page', { url: 'https://evil.com/' })] });
  assert.equal(kind(next(later, ctx)), 'request');
  const no = next(run(ask, { turns: [choose], requests: [request('no')] }), ctx);
  assert.ok('record' in no);
  assert.equal(no.record.state, 'failed');
  assert.equal(no.record.error, 'Refused by you');
});

test('a refused page in a routine of reads doesn\'t stop the others', () => {
  const work: Work = { kind: 'read', urls: ['https://shop.com/a', 'https://shop.com/b'] };
  const r = run(work, { tainted: true, seen: [{ url: 'https://shop.com/b', from: 'person' }], requests: [{ id: 'q', kind: 'reach', step: 0, tool: 'read_page', argsKey: argsKey({ url: 'https://shop.com/a' }), text: '', sensitive: false, answer: { value: 'no', at: 1 } }] });
  const refused = next(r, ctx);
  assert.ok('record' in refused);
  assert.deepEqual(next({ ...r, steps: [refused.record] }, ctx), { call: { i: 1, tool: 'read_page', args: { url: 'https://shop.com/b' } } });
});

test('recover re-runs a started read and turns a started act into "did it happen?"', () => {
  const interrupted = recover([run(ask, { status: 'running', steps: [step(0, 'read_page', { url: 'https://shop.com/' }, { state: 'started' })] })], 5);
  assert.equal(interrupted[0]!.status, 'queued');
  assert.equal(interrupted[0]!.interrupted, 1);
  assert.deepEqual(next(interrupted[0]!, ctx), { call: { i: 0, tool: 'read_page', args: { url: 'https://shop.com/' } } });
  const [acting] = recover([run(ask, { status: 'running', steps: [step(0, 'act', { url: 'https://shop.com/' }, { state: 'started', effect: 'act' })] })], 5);
  const act = next(acting!, ctx);
  assert.ok('request' in act);
  assert.equal(act.request.kind, 'did-it-happen');
  const [notifying] = recover([run(ask, { status: 'running', steps: [step(0, 'notify', { text: 'hi' }, { state: 'started' })] })], 5);
  const n = next(notifying!, ctx);
  assert.ok('record' in n && n.record.state === 'done', 'a notification is never shown twice');
});

test('a request expires a day after it is made, in a routine run too', () => {
  const choose = { turns: [turn('choose', '{"tool":"read_page","args":{"url":"https://evil.com/"}}')] };
  const routine = { v: 1 as const, id: 'r1', gardenerId: 'g1', name: 'x', when: { kind: 'every' as const, hours: 1 }, tz: 'UTC', work: ask, paused: false, nextDue: 5000, createdAt: 0 };
  const exp = (over: Partial<typeof routine>) => { const a = next(run(ask, choose), { ...ctx, routine: { ...routine, ...over } }); return 'request' in a ? a.request.expiresAt : null; };
  assert.equal(exp({}), 1000 + 24 * 3_600_000);
  assert.equal(exp({ paused: true }), 1000 + 24 * 3_600_000);
});

test('a tool asked for after the steps ran out ends the run with its best answer, not a failure', () => {
  const turns = Array.from({ length: 8 }, (_, i) => turn('choose', `{"tool":"search","args":{"query":"tea ${i}"}}`));
  const steps = turns.map((_, i) => step(i, 'search', { query: `tea ${i}` }));
  const more = next(run(ask, { turns: [...turns, turn('choose', '{"tool":"search","args":{"query":"more"}}')], steps }), ctx);
  assert.ok('done' in more && more.done.best === true);
});

test('a routine of many long pages words every one of them', () => {
  const urls = ['https://shop.com/a', 'https://shop.com/b', 'https://shop.com/c'];
  const w = next(run({ kind: 'read', urls }, { ...SMALL, steps: urls.map((url, i) => step(i, 'read_page', { url }, { output: big })) }), ctx);
  assert.ok('think' in w);
  for (const u of urls) assert.ok(w.think.data.includes(u), u);
});

test('recover is idempotent, and a fourth interruption fails the run', () => {
  const runs = [run(ask, { status: 'running' }), run(ask, { status: 'running', interrupted: 3 }), run(ask, { status: 'waiting', requests: [{ id: 'q', kind: 'reach', text: '', sensitive: false, expiresAt: 3 }] }), run(ask, { status: 'done' })];
  const once = recover(runs, 5);
  assert.deepEqual(once.map((r) => r.status), ['queued', 'failed', 'failed', 'done']);
  assert.deepEqual(recover(once, 5), once);
});

test('out of time ends the run with what it has; instructions too long for the model fail it', () => {
  const late = next(run(ask, { usedMs: 10 * 60_000, steps: [step(0, 'search', { query: 'tea' })] }), ctx);
  assert.deepEqual(late, { done: { answer: 'Out of time.\nsearch ok', best: true } });
  const answered = next(run(ask, { usedMs: 10 * 60_000, turns: [turn('choose', '{"answer":"Tea is £3."}')] }), ctx);
  assert.deepEqual(answered, { done: { answer: 'Tea is £3.', best: true } }, 'an answer already given is kept');
  const wordy = { ...ctx, gardener: { ...g, instructions: 'x'.repeat(20_000) } };
  assert.deepEqual(next(run(ask, { maxTokens: 4096 }), wordy), { fail: TOO_LONG });
});

// ---- V2: approvals ----

const actChoose = turn('choose', '{"tool":"act","args":{"url":"https://shop.com/cart","steps":{"instructions":[{"click":"#add"}]}}}');
const actArgs = { url: 'https://shop.com/cart', steps: { strict: true, instructions: [{ click: '#add' }] } };

test('an answered approve lets exactly that call through once; always counts as yes', () => {
  const asked = next(run(ask, { turns: [actChoose] }), ctx);
  assert.ok('request' in asked && asked.request.kind === 'approve' && !asked.request.sensitive);
  const answered = (value: string) => [{ ...asked.request, id: 'q1', shownAt: 1, answer: { value, at: 2 } }];
  assert.deepEqual(next(run(ask, { turns: [actChoose], requests: answered('yes') }), ctx), { call: { i: 0, tool: 'act', args: actArgs } });
  assert.deepEqual(next(run(ask, { turns: [actChoose], requests: answered('always') }), ctx), { call: { i: 0, tool: 'act', args: actArgs } });
  const later = run(ask, { turns: [actChoose, actChoose], requests: answered('yes'), steps: [step(0, 'act', actArgs, { effect: 'act' })] });
  assert.equal(kind(next(later, ctx)), 'request', 'the same act chosen again is asked again');
});

test('a sensitive approval counts only when answered 8 s or more after it was shown', () => {
  const sensitive = { kind: 'approve' as const, step: 0, tool: 'act', argsKey: argsKey(actArgs), host: 'shop.com', text: '', sensitive: true, why: 'a password field', index: 0, id: 'q1', shownAt: 10_000 };
  const early = next(run(ask, { turns: [actChoose], requests: [{ ...sensitive, answer: { value: 'yes', at: 13_000 } }] }), ctx);
  assert.ok('request' in early, 'too early: asked again');
  assert.equal(early.request.sensitive, true, 'and still sensitive');
  assert.deepEqual([early.request.why, early.request.index], ['a password field', 0], 'about the same step');
  const unseen = next(run(ask, { turns: [actChoose], requests: [{ ...sensitive, shownAt: undefined as never, answer: { value: 'yes', at: 13_000 } }] }), ctx);
  assert.equal(kind(unseen), 'request', 'never shown: not counted');
  assert.deepEqual(next(run(ask, { turns: [actChoose], requests: [{ ...sensitive, answer: { value: 'yes', at: 18_000 } }] }), ctx), { call: { i: 0, tool: 'act', args: actArgs } });
});

test('a started act asks "did this happen?", and the answer records the step', () => {
  const started = run(ask, { turns: [actChoose], steps: [step(0, 'act', actArgs, { state: 'started', effect: 'act' })] });
  const q = next(started, ctx);
  assert.ok('request' in q && q.request.kind === 'did-it-happen');
  assert.equal(q.request.text, 'Pricer started to act on https://shop.com/cart:\nclick #add\nThe worker stopped before it finished. Did it happen?');
  const answered = (value: string) => next({ ...started, requests: [{ ...q.request, id: 'd', answer: { value, at: 5 } }] }, ctx);
  const yes = answered('yes'), no = answered('no');
  assert.ok('record' in yes && yes.record.state === 'done');
  assert.ok('record' in no && no.record.state === 'failed' && no.record.error === 'It did not happen.');
});

test('a no after the page stopped an act on a sensitive step says where, and that no step had run', () => {
  const stopped = approveRequest(run(ask), ctx, 0, 'act', actArgs, { index: 0, why: '“Delete account”' })!;
  assert.equal(stopped.sensitive, true);
  assert.equal(stopped.index, 0);
  assert.match(stopped.text, /Sensitive \(click #add\): “Delete account”\.$/);
  const no = next(run(ask, { turns: [actChoose], requests: [{ ...stopped, id: 'q', shownAt: 0, answer: { value: 'no', at: 9000 } }] }), ctx);
  assert.ok('record' in no);
  assert.equal(no.record.error, 'Refused by you. It stopped before click #add (“Delete account”); no step had run.');
});
