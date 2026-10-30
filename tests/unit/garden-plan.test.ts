// Plan first: a weak model proposes a list of calls, the person approves it, and code still checks every call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerFor, answerPlan, approveRequest, argsKey, BAD_REPLY, next, PLAN_REFUSED, refusal, type Ctx } from '../../src/domain/garden/loop.ts';
import { classify } from '../../src/domain/garden/classify.ts';
import { decide, type RecipeFacts } from '../../src/domain/garden/policy.ts';
import { claim } from '../../src/domain/garden/schedule.ts';
import { TOOLS, toolsFor } from '../../src/domain/garden/tools.ts';
import { newRun, personUrls, type Gardener, type GardenRun, type PlannedCall, type Request, type Step, type Turn, type Work } from '../../src/domain/garden/records.ts';
import { can, type Ability } from '../../src/domain/model.ts';
import { contextChars } from '../../src/domain/text.ts';

const g: Gardener = { v: 1, id: 'g1', name: 'Pricer', instructions: 'Be brief.', sites: ['shop.com'], minutes: 10, createdAt: 0 };
const ctx: Ctx = { gardener: g, tools: TOOLS, now: 1000 };
const plan: Work = { kind: 'plan', request: 'compare tea prices' };
// Two profiles that differ only in data: one measured for plans, one not.
const WITH = { maxTokens: 4096, agent: { loop: false, maxSteps: 8 }, abilities: ['plan'] as Ability[] };
const WITHOUT = { maxTokens: 4096, agent: { loop: false, maxSteps: 4 }, abilities: [] as Ability[] };
const run = (over: Partial<GardenRun> = {}, work: Work = plan): GardenRun => ({ ...newRun({ id: 'r', gardenerId: 'g1', work, now: 0 }), model: 'm', ...WITH, ...over });
const turn = (purpose: Turn['purpose'], reply: string): Turn => ({ purpose, reply, at: 1 });
const step = (i: number, tool: string, args: Record<string, unknown>, over: Partial<Step> = {}): Step => ({ i, tool, args, effect: 'read', state: 'done', digest: `${tool} ok`, output: `out ${i}`, at: 1, ...over });
const fill = { url: 'https://shop.com/form', steps: { strict: true, instructions: [{ fill: ['#q', 'tea'] }] } };
const pay = { url: 'https://shop.com/cart', steps: { strict: true, instructions: [{ click: '#pay' }] } };

/** The plan request the model's plan turn makes, then the person's yes with these calls. */
function approved(calls: PlannedCall[], over: Partial<GardenRun> = {}, c: Ctx = ctx): GardenRun {
  const r = run({ turns: [turn('plan', JSON.stringify(calls))], ...over });
  const a = next(r, c);
  assert.ok('request' in a && a.request.kind === 'plan', JSON.stringify(a));
  const q: Request = { ...a.request, id: 'p' };
  r.requests.push(q);
  r.status = 'waiting';
  assert.equal(answerPlan(r, c, q, 'yes', undefined, 2000), null);
  return r;
}

test('a run pinned without plan fails, one pinned with it plans; the same code, two profiles', () => {
  assert.equal(refusal(run(WITHOUT)), PLAN_REFUSED);
  assert.deepEqual(next(run(WITHOUT), ctx), { fail: PLAN_REFUSED });
  assert.equal(refusal(run()), null);
  const a = next(run(), ctx);
  assert.ok('think' in a && a.think.purpose === 'plan');
  assert.match(a.think.prompt, /^You are Pricer, .*\nTheir instructions: Be brief\.\nThe task: compare tea prices\nYou can use these tools:\n/s);
  assert.match(a.think.prompt, /Write a plan: a JSON array of at most 8 tool calls, \[\{"tool": …, "args": \{…\}\}\], in order\. Reply with only the array\.$/);
  assert.equal(refusal(run({ ...WITHOUT, agent: { loop: true, maxSteps: 8 } })), null, 'a loop model can plan too');
  assert.equal(can('Gemma-4-E2B-it', 'plan'), false, 'no entry: cannot');
  assert.equal(contextChars(4096), (4096 - 512) * 3);
});

test('a routine-claimed plan run is checked the same way', () => {
  const routine = { v: 1 as const, id: 'rt', gardenerId: 'g1', name: 'x', when: { kind: 'every' as const, hours: 1 }, tz: 'UTC', work: plan, paused: false, nextDue: 0, createdAt: 0 };
  const claimed = claim(routine, [], 10).newRun!;
  assert.equal(claimed.work.kind, 'plan');
  assert.deepEqual(next({ ...claimed, model: 'm', ...WITHOUT }, ctx), { fail: PLAN_REFUSED });
  assert.equal(Object.keys(next({ ...claimed, model: 'm', ...WITH }, ctx))[0], 'think');
});

test('a plan with an unknown tool gets one repair, then fails', () => {
  const bad = turn('plan', '[{"tool":"hack","args":{}}]');
  const r = next(run({ turns: [bad] }), ctx);
  assert.ok('think' in r && r.think.purpose === 'repair');
  assert.match(r.think.prompt, /Reply with only the array\.$/);
  assert.deepEqual(next(run({ turns: [bad, turn('repair', 'sorry')] }), ctx), { fail: BAD_REPLY });
  assert.ok('think' in next(run({ turns: [turn('plan', JSON.stringify(Array(9).fill({ tool: 'search', args: { query: 'x' } })))] }), ctx), 'more than maxSteps calls is a bad plan');
});

test('an approved plan runs its calls in order with no choose think, then one sum think', () => {
  const calls = [{ tool: 'read_page', args: { url: 'https://shop.com/a' } }, { tool: 'search', args: { query: 'green tea' } }];
  const r = approved(calls);
  assert.equal(r.status, 'queued');
  assert.deepEqual(r.plan, calls);
  assert.deepEqual(next(r, ctx), { call: { i: 0, tool: 'read_page', args: { url: 'https://shop.com/a' } } });
  r.steps.push(step(0, 'read_page', calls[0]!.args));
  assert.deepEqual(next(r, ctx), { call: { i: 1, tool: 'search', args: { query: 'green tea' } } });
  r.steps.push(step(1, 'search', calls[1]!.args));
  const sum = next(r, ctx);
  assert.ok('think' in sum && sum.think.purpose === 'sum');
  assert.equal(sum.think.prompt, "The task: compare tea prices. Below are the results of the planned steps. Answer the task from them in a few sentences. If they don't answer it, say what is missing.");
  assert.match(sum.think.data, /^\[0\] read_page ok\nout 0\n\n\[1\] search ok\nout 1$/);
  r.turns.push(turn('sum', 'Tea is £3.'));
  assert.deepEqual(next(r, ctx), { done: { answer: 'Tea is £3.' } });
  assert.ok(!r.turns.some((t) => t.purpose === 'choose'));
});

test('an edited arg changes the key: the original call is not approved', () => {
  const original = { tool: 'act', args: { url: 'https://shop.com/cart', steps: { instructions: [{ click: '#add' }] } } };
  const edited = { tool: 'act', args: { url: 'https://shop.com/cart', steps: { instructions: [{ click: '#add2' }] } } };
  const r = run({ turns: [turn('plan', JSON.stringify([original]))] });
  const a = next(r, ctx);
  assert.ok('request' in a);
  const q: Request = { ...a.request, id: 'p' };
  r.requests.push(q);
  assert.equal(answerPlan(r, ctx, q, 'yes', [edited], 2000), null);
  const parsedEdited = r.plan![0]!.args, parsedOriginal = q.calls![0]!.args;
  assert.notEqual(argsKey(parsedEdited), argsKey(parsedOriginal));
  assert.ok(answerFor(r, 0, 'act', argsKey(parsedEdited))?.fromPlan);
  assert.equal(answerFor(r, 0, 'act', argsKey(parsedOriginal)), undefined);
  assert.deepEqual(next(r, ctx), { call: { i: 0, tool: 'act', args: parsedEdited } });
  // An edit is parsed again: code steps or an unknown tool are refused.
  assert.match(answerPlan(run(), ctx, { ...a.request, id: 'p2' }, 'yes', [{ tool: 'act', args: { url: 'https://shop.com/', steps: { instructions: [{ evaluate: 'x' }] } } }], 1)!, /^A plan is/);
  assert.match(answerPlan(run(), ctx, { ...a.request, id: 'p2' }, 'yes', [{ tool: 'evaluate', args: {} }], 1)!, /^A plan is/);
});

test('a planned off-site read is allowed, also after taint: its URL is approved', () => {
  const r = approved([{ tool: 'read_page', args: { url: 'https://far.com/x' } }], { tainted: true });
  assert.ok(r.seen.some((s) => s.url === 'https://far.com/x' && s.from === 'approved'));
  assert.equal(decide(r, g, { tool: 'read_page', args: { url: 'https://far.com/x' } }), 'allow');
  assert.deepEqual(next(r, ctx), { call: { i: 0, tool: 'read_page', args: { url: 'https://far.com/x' } } });
});

test('a planned search after taint still raises reach', () => {
  const r = approved([{ tool: 'read_page', args: { url: 'https://shop.com/a' } }, { tool: 'search', args: { query: 'tea' } }]);
  r.steps.push(step(0, 'read_page', { url: 'https://shop.com/a' }));
  r.tainted = true;
  const a = next(r, ctx);
  assert.ok('request' in a && a.request.kind === 'reach' && a.request.tool === 'search');
});

test('a planned fill approved before taint is asked again as sensitive (8 s) after a signed-in read', () => {
  const calls = [{ tool: 'read_page', args: { url: 'https://shop.com/account' } }, { tool: 'act', args: fill }];
  const r = approved(calls);
  assert.ok(answerFor(r, 1, 'act', argsKey(fill))?.fromPlan, 'pre-approved while untainted');
  r.steps.push(step(0, 'read_page', calls[0]!.args));
  r.tainted = true;
  const a = next(r, ctx);
  assert.ok('request' in a && a.request.kind === 'approve' && a.request.sensitive);
  assert.match(a.request.why!, /types into a page after reading your signed-in pages/);
  // Answered within 8 s of being shown: not counted, asked again.
  r.requests.push({ ...a.request, id: 'q2', shownAt: 10_000, answer: { value: 'yes', at: 12_000 } });
  const again = next(r, ctx);
  assert.ok('request' in again && again.request.sensitive);
});

test('a planned act on a Pay button still waits 8 s', () => {
  const r = approved([{ tool: 'act', args: pay }]);
  assert.deepEqual(next(r, ctx), { call: { i: 0, tool: 'act', args: pay } }, 'not sensitive before the page is seen');
  // In the page, classify stops the click on the live element; the worker asks in place (NeedsYou).
  const why = classify({ action: 'click', found: true, pageUrl: 'https://shop.com/cart', tag: 'button', text: 'Pay now' });
  assert.equal(why, '“Pay now”');
  const stopped = approveRequest(r, ctx, 0, 'act', pay, { index: 0, why: why! })!;
  assert.equal(stopped.sensitive, true);
  r.requests.push({ ...stopped, id: 's', shownAt: 10_000, answer: { value: 'yes', at: 13_000 } });
  const early = next(r, ctx);
  assert.ok('request' in early && early.request.sensitive, 'a yes before 8 s does not count, and the plan yes no longer does');
});

test('a fromPlan answer whose call policy now denies fails the step', () => {
  const recipe: RecipeFacts = { id: 'rc', name: 'Buy', urls: ['https://shop.com/'], scenario: { strict: true, instructions: [{ click: '#buy' }] }, key: 'k1' };
  const withRecipe = { ...ctx, recipes: [recipe] };
  const r = approved([{ tool: 'collect', args: { recipe: 'rc' } }], {}, withRecipe);
  assert.ok(answerFor(r, 0, 'collect', 'k1')?.fromPlan);
  // The recipe now holds code steps: policy denies it, whatever the plan said.
  const changed = { ...ctx, recipes: [{ ...recipe, scenario: { strict: true, instructions: [{ evaluate: 'x' }] } }] };
  const a = next(r, changed);
  assert.ok('record' in a && a.record.state === 'failed' && a.record.error === 'Not allowed.');
});

test('no fromPlan answer is made for act_my_tab or app_call', () => {
  // Both are acts policy knows (actOf), not sensitive here: only answerPlan's act/collect filter (planCovers) keeps them out.
  const tab = { url: 'https://mail.com/inbox', title: 'Inbox', tabId: 3 };
  const mine = { tab: tab.url, steps: pay.steps };
  const app = { id: 'crm', name: 'CRM', url: 'https://mcp.crm.com/mcp', hosts: [], guidelines: '', createdAt: 0, v: 1 as const,
    tools: [{ name: 'find_contact', describe: 'Find a contact', schema: { type: 'object', properties: { q: { type: 'string' } } }, scope: 'read' as const }] };
  const call = { connector: 'crm', tool: 'find_contact', args: { q: 'Ann' } };
  const c: Ctx = { ...ctx, connectors: [app] };
  const r = run({}, { kind: 'plan', request: 'compare tea prices', tabs: [tab] });
  assert.equal(approveRequest(r, c, 0, 'act_my_tab', mine)?.sensitive, false);
  assert.equal(approveRequest(r, c, 1, 'app_call', call)?.sensitive, false);
  const p = approved([{ tool: 'act_my_tab', args: mine }, { tool: 'app_call', args: call }, { tool: 'act', args: pay }], { work: r.work }, c);
  assert.deepEqual(p.requests.filter((q) => q.fromPlan).map((q) => q.tool), ['act']);
  // T8's automatic plan yes (a skill test) pre-approves nothing at all.
  const auto = run({ turns: [turn('plan', JSON.stringify([{ tool: 'app_call', args: call }]))], work: r.work });
  const a = next(auto, c);
  assert.ok('request' in a);
  const q: Request = { ...a.request, id: 'p' };
  auto.requests.push(q);
  assert.equal(answerPlan(auto, c, q, 'yes', undefined, 2000, true), null);
  assert.equal(auto.requests.filter((x) => x.fromPlan).length, 0);
  assert.ok('request' in next(auto, c), 'its call is asked');
});

test('a plan work\'s named tab is readable with read_my_tab, and its URLs are the person\'s', () => {
  const tab = { url: 'https://mail.com/inbox', title: 'Inbox', tabId: 3 };
  const r = run({}, { kind: 'plan', request: 'summarise https://news.com/a', tabs: [tab] });
  assert.ok(toolsFor(r).some((t) => t.name === 'read_my_tab'));
  assert.equal(decide(r, g, { tool: 'read_my_tab', args: { tab: tab.url } }), 'allow');
  assert.deepEqual(personUrls(r.work), ['https://news.com/a']);
  const a = next(r, ctx);
  assert.ok('think' in a && a.think.data.includes(tab.url));
});

test('No ends the run stopped', () => {
  const r = run({ turns: [turn('plan', '[{"tool":"search","args":{"query":"tea"}}]')], status: 'waiting' });
  const a = next(r, ctx);
  assert.ok('request' in a);
  const q: Request = { ...a.request, id: 'p' };
  r.requests.push(q);
  assert.equal(answerPlan(r, ctx, q, 'no', undefined, 5), null);
  assert.equal(r.status, 'stopped');
  assert.equal(r.plan, undefined);
});
