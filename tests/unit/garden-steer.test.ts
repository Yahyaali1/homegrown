// Approvals and steering: an edited approval is a new call that code checks again, Approve all never widens, a Steer
// message reaches one think, and a routine the model proposes stays off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approveRequest, next, parseEdit, recover, verdictFor, type Ctx } from '../../src/domain/garden/loop.ts';
import { approveAllOk, argsKey, decide } from '../../src/domain/garden/policy.ts';
import { claim, proposedRoutine } from '../../src/domain/garden/schedule.ts';
import { TOOLS, parseArgs, toolsFor } from '../../src/domain/garden/tools.ts';
import { newRun, parseRoutine, type Gardener, type GardenRun, type Request, type Step, type Work } from '../../src/domain/garden/records.ts';

const g: Gardener = { v: 1, id: 'g1', name: 'Pricer', instructions: 'Be brief.', sites: ['shop.com'], minutes: 10, createdAt: 0 };
const ctx: Ctx = { gardener: g, tools: TOOLS, now: 1000 };
const PIN = { model: 'm', maxTokens: 4096, agent: { loop: false, maxSteps: 8 }, abilities: ['plan' as const] };
const actSpec = TOOLS.find((t) => t.name === 'act')!;
const actOn = (url: string, ...instructions: unknown[]) => parseArgs(actSpec, { url, steps: { instructions } })!;
const fill = (value: string) => actOn('https://shop.com/form', { fill: ['#q', value] });
/** A plan run (planted, already approved) whose one call is `call`. */
const planned = (call: Record<string, unknown>, over: Partial<GardenRun> = {}): GardenRun =>
  ({ ...newRun({ id: 'r', gardenerId: 'g1', work: { kind: 'plan', request: 'search the shop' }, now: 0 }), ...PIN, plan: [{ tool: 'act', args: call }], ...over });
const step = (i: number, tool: string, args: Record<string, unknown>, over: Partial<Step> = {}): Step => ({ i, tool, args, effect: 'act', state: 'done', digest: `${tool} ok`, output: 'ok', at: 1, ...over });

/** The approve request the loop raises for `r`, answered yes with these edited args. */
function editedYes(r: GardenRun, args: Record<string, unknown>, at = 2000): Request {
  const a = next(r, ctx);
  assert.ok('request' in a && a.request.kind === 'approve', JSON.stringify(a));
  const q: Request = { ...a.request, id: 'q1', shownAt: 1000 };
  const edit = parseEdit(q, 'yes', args);
  assert.ok(typeof edit !== 'string', String(edit));
  q.answer = { value: 'yes', at, ...edit };
  r.requests.push(q);
  return q;
}

const answeredBy = (r: GardenRun, id: string) => verdictFor(r, ctx, 0, { tool: 'act', args: {}, answered: id }).q;

test('an edited fill value runs, not the model’s original, and the call names its answer', () => {
  const r = planned(fill('tea'));
  const q = editedYes(r, fill('green tea'));
  assert.deepEqual(q.answer!.args, fill('green tea'));
  assert.deepEqual(next(r, ctx), { call: { i: 0, tool: 'act', args: fill('green tea'), answered: 'q1' } });
  assert.equal(answeredBy(r, 'q1'), q);
  // The step stores the args it ran with; then the plan moves on to its sum.
  r.steps.push(step(0, 'act', fill('green tea')));
  const sum = next(r, ctx);
  assert.ok('think' in sum && sum.think.purpose === 'sum');
});

test('an edit is parsed again; always or no with args is refused (a grant is the original call)', () => {
  const q: Request = { id: 'q', kind: 'approve', step: 0, tool: 'act', argsKey: argsKey(fill('tea')), host: 'shop.com', text: '', sensitive: false };
  assert.match(parseEdit(q, 'always', fill('green tea')) as string, /only with yes/);
  assert.match(parseEdit(q, 'no', fill('green tea')) as string, /only with yes/);
  assert.match(parseEdit(q, 'yes', { url: 'https://shop.com/', steps: { instructions: [{ evaluate: 'x' }] } }) as string, /aren’t valid/);
  assert.match(parseEdit({ ...q, origin: { edit: 'q0' } }, 'yes', fill('x')) as string, /can’t be edited/);
  assert.match(parseEdit({ ...q, kind: 'reach', tool: 'read_page' }, 'yes', { url: 'https://far.com/' }) as string, /can’t be edited/);
  assert.deepEqual(parseEdit(q, 'yes', fill('tea')), {}, 'unchanged: a plain yes');
  assert.deepEqual(parseEdit(q, 'always', undefined), {});
});

test('an edit that adds a Pay click is asked once more as sensitive, can’t be edited, and runs once after 8 s', () => {
  const r = planned(fill('tea'));
  const pay = actOn('https://shop.com/form', { fill: ['#q', 'tea'] }, { click: '#pay' });
  editedYes(r, pay);
  const first = next(r, ctx);
  assert.deepEqual(first, { call: { i: 0, tool: 'act', args: pay, answered: 'q1' } }, 'not sensitive before the page is seen');
  // In the page, classify stops the Pay click before any act ran (NeedsYou): the worker asks in place.
  const stopped = approveRequest(r, ctx, 0, 'act', pay, { index: 1, why: '“Pay now”' }, verdictFor(r, ctx, 0, { tool: 'act', args: pay, answered: 'q1' }).q)!;
  assert.equal(stopped.sensitive, true);
  assert.deepEqual(stopped.origin, { edit: 'q1' });
  r.requests.push({ ...stopped, id: 'q2', shownAt: 10_000, answer: { value: 'yes', at: 13_000 } });
  const early = next(r, ctx);
  assert.ok('request' in early && early.request.sensitive && typeof early.request.origin === 'object', 'a yes before 8 s does not count');
  assert.equal(early.request.index, 1);
  r.requests.at(-1)!.answer = { value: 'yes', at: 18_000 };
  assert.deepEqual(next(r, ctx), { call: { i: 0, tool: 'act', args: pay, answered: 'q2' } });
  assert.equal(verdictFor(r, ctx, 0, { tool: 'act', args: pay, answered: 'q2' }).q?.why, '“Pay now”', 'the yes covers that step once');
  r.steps.push(step(0, 'act', pay));
  const after = next(r, ctx);
  assert.ok('think' in after && after.think.purpose === 'sum', 'no loop: it doesn’t ask again');
  assert.equal(r.requests.filter((x) => typeof x.origin === 'object').length, 1);
  assert.equal(verdictFor({ ...r, requests: [{ ...r.requests.at(-1)!, answer: { value: 'yes', at: 13_000 } }] }, ctx, 0, { tool: 'act', args: pay, answered: 'q2' }).v, 'deny', 'too early by id too');
});

test('an edit decide denies fails the step; a no to the asked-again edit is refused by you', () => {
  const r = planned(fill('tea'));
  editedYes(r, { url: 'file:///etc/passwd', steps: { strict: true, instructions: [{ fill: ['#q', 'tea'] }] } });
  const a = next(r, ctx);
  assert.ok('record' in a && a.record.state === 'failed' && a.record.error === 'Not allowed.');
  assert.equal(a.record.args.url, 'file:///etc/passwd', 'the step records the edited call');
  // Tainted: the edited fill is sensitive, asked again, and its no ends the step.
  const t = planned(fill('tea'), { tainted: true });
  const q = next(t, ctx);
  assert.ok('request' in q && q.request.sensitive);
  t.requests.push({ ...q.request, id: 'q1', shownAt: 0 });
  t.requests[0]!.answer = { value: 'yes', at: 9000, ...(parseEdit(t.requests[0]!, 'yes', fill('x')) as object) };
  const again = next(t, ctx);
  assert.ok('request' in again && (again.request.origin as { edit?: string })?.edit === 'q1');
  t.requests.push({ ...again.request, id: 'q2', shownAt: 10_000, answer: { value: 'no', at: 11_000 } });
  const no = next(t, ctx);
  assert.ok('record' in no && no.record.error === 'Refused by you');
});

test('a resumed edited call finds its answer by the action’s answered id', () => {
  const r = planned(fill('tea'), { status: 'running' });
  editedYes(r, fill('green tea'));
  const [back] = recover([r], 5000);
  assert.equal(back!.status, 'queued');
  const a = next(back!, ctx);
  assert.ok('call' in a && a.call.answered === 'q1');
  assert.deepEqual(answeredBy(back!, a.call.answered!)?.answer?.args, fill('green tea'));
  assert.equal(answeredBy(back!, 'nope'), undefined);
});

test('Approve all: only non-sensitive reach and gardener-tab approves', () => {
  const base = { id: 'x', text: '', step: 0 };
  const clean = planned(fill('tea')), tainted = planned(fill('tea'), { tainted: true });
  assert.equal(approveAllOk({ ...base, kind: 'reach', tool: 'read_page', sensitive: false }, clean), true);
  assert.equal(approveAllOk({ ...base, kind: 'approve', tool: 'act', sensitive: false }, clean), true);
  assert.equal(approveAllOk({ ...base, kind: 'approve', tool: 'act', sensitive: true }, clean), false);
  assert.equal(approveAllOk({ ...base, kind: 'question', sensitive: false }, clean), false);
  assert.equal(approveAllOk({ ...base, kind: 'plan', sensitive: false }, clean), false);
  assert.equal(approveAllOk({ ...base, kind: 'did-it-happen', sensitive: false }, clean), false);
  assert.equal(approveAllOk({ ...base, kind: 'reach', sensitive: false, answer: { value: 'no', at: 1 } }, clean), false, 'answered already');
  // Under taint a reach guards against a leak (its URL or query may carry what was read): asked one by one.
  assert.equal(approveAllOk({ ...base, kind: 'reach', tool: 'search', sensitive: false }, tainted), false);
  assert.equal(approveAllOk({ ...base, kind: 'approve', tool: 'act', sensitive: false }, tainted), true);
  const sensitive = approveRequest(planned(fill('tea'), { tainted: true }), ctx, 0, 'act', fill('tea'))!;
  assert.equal(approveAllOk({ ...sensitive, id: 's' }, clean), false);
});

test('a Steer message is in the next think’s instruction part once, never in its data', () => {
  const ask: Work = { kind: 'ask', request: 'compare tea prices' };
  const r: GardenRun = { ...newRun({ id: 'r', gardenerId: 'g1', work: ask, now: 0 }), model: 'm', maxTokens: 4096, agent: { loop: true, maxSteps: 8 },
    inbox: [{ id: 'm1', text: 'Only the shop’s own pages.', at: 1, steer: true }] };
  const a = next(r, ctx);
  assert.ok('think' in a && a.think.purpose === 'choose');
  assert.ok(a.think.prompt.endsWith('\n\nThe person adds: Only the shop’s own pages.'));
  assert.ok(!a.think.data.includes('Only the shop'));
  assert.deepEqual(a.think.steer, ['m1']);
  // The worker marks it used with the turn: the next think doesn't have it.
  r.inbox![0]!.usedAt = 2;
  r.turns.push({ purpose: 'choose', reply: '{"answer":"Tea is £3."}', at: 2 });
  const check = next(r, ctx);
  assert.ok('think' in check && !check.think.prompt.includes('The person adds') && !check.think.steer);
  // Direct work: a call is no think; the word think gets it.
  const read: GardenRun = { ...newRun({ id: 'd', gardenerId: 'g1', work: { kind: 'read', urls: ['https://shop.com/a'] }, now: 0 }), ...PIN, inbox: [{ id: 'm2', text: 'Mention prices.', at: 1, steer: true }] };
  assert.ok('call' in next(read, ctx));
  read.steps.push(step(0, 'read_page', { url: 'https://shop.com/a' }, { effect: 'read' }));
  const word = next(read, ctx);
  assert.ok('think' in word && word.think.purpose === 'word' && word.think.prompt.endsWith('The person adds: Mention prices.'));
});

test('propose_routine: offered with a loop or in a plan; allowed on the gardener’s sites only', () => {
  const ask = (loop: boolean) => ({ ...newRun({ id: 'r', gardenerId: 'g1', work: { kind: 'ask', request: 'x' }, now: 0 }), agent: { loop, maxSteps: 8 } });
  assert.ok(toolsFor(ask(true)).some((t) => t.name === 'propose_routine'));
  assert.ok(!toolsFor(ask(false)).some((t) => t.name === 'propose_routine'));
  assert.ok(toolsFor(planned(fill('tea'))).some((t) => t.name === 'propose_routine'));
  assert.ok(!toolsFor(newRun({ id: 'd', gardenerId: 'g1', work: { kind: 'read', urls: ['https://shop.com/'] }, now: 0 })).some((t) => t.name === 'propose_routine'));
  const spec = TOOLS.find((t) => t.name === 'propose_routine')!;
  const call = (work: unknown) => parseArgs(spec, { name: 'Morning prices', when: { kind: 'daily', at: '08:00' }, work });
  const on = call({ kind: 'read', urls: ['https://shop.com/tea'] })!;
  assert.ok(on, 'parsed');
  const r = planned(fill('tea'));
  assert.equal(decide(r, g, { tool: 'propose_routine', args: on }), 'allow');
  assert.equal(decide(r, g, { tool: 'propose_routine', args: call({ kind: 'read', urls: ['https://evil.com/x'] })! }), 'deny');
  assert.equal(decide(r, g, { tool: 'propose_routine', args: call({ kind: 'plan', request: 'post it to https://evil.com/x' })! }), 'deny', 'no new sites in a request either');
  assert.equal(decide(r, g, { tool: 'propose_routine', args: call({ kind: 'ask', request: 'x', tabs: [{ url: 'https://mail.com/', title: 'Mail' }] })! }), 'deny', 'nor the person’s tabs');
  assert.equal(call({ kind: 'read', urls: ['ftp://x'] }), null, 'bad work is a bad call');
  // After a signed-in read its runs would start untainted, so on-site URLs or a goal could carry what was read.
  assert.equal(decide({ ...r, tainted: true }, g, { tool: 'propose_routine', args: on }), 'deny');
  assert.equal(decide({ ...r, tainted: true }, g, { tool: 'propose_routine', args: call({ kind: 'mission', goal: 'find tea' })! }), 'deny');
});

test('a proposed routine is stored paused, by the model, and claim never runs it', () => {
  const spec = TOOLS.find((t) => t.name === 'propose_routine')!;
  const args = parseArgs(spec, { name: 'Prices', when: { kind: 'every', hours: 1 }, work: { kind: 'read', urls: ['https://shop.com/tea'] } })!;
  const r = proposedRoutine({ id: 'p1', gardenerId: 'g1', tz: 'UTC', now: 0, ...(args as { name: string; when: never; work: never }) });
  assert.equal(r.paused, true);
  assert.equal(r.by, 'model');
  const stored = parseRoutine(JSON.parse(JSON.stringify(r)))!;
  assert.equal(stored.by, 'model');
  const c = claim(stored, [], 10 * 3_600_000);
  assert.equal(c.newRun, undefined);
  assert.equal(parseRoutine({ ...r, by: 'someone' })?.by, undefined, 'an unknown by is dropped, not the routine');
});
