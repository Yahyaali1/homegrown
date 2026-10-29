// Hands in your tabs (plan T5): acting in the person's own tab, help with checks for humans, DevTools reads, downloads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alwaysOk, approveAllOk, decide, failTaints, type Grant } from '../../src/domain/garden/policy.ts';
import { answerPlan, HELP_REFUSED, next, type Ctx } from '../../src/domain/garden/loop.ts';
import { isChallenge } from '../../src/domain/garden/classify.ts';
import { devtoolsDigest, downloadRun, mentionedTab, ownsTab, TOOLS, toolsFor } from '../../src/domain/garden/tools.ts';
import { argsKey } from '../../src/domain/garden/policy.ts';
import { newRun, parseGardener, type Gardener, type GardenRun, type Request } from '../../src/domain/garden/records.ts';

const g: Gardener = { v: 1, id: 'g1', name: 'Clerk', instructions: '', sites: ['shop.com'], minutes: 10, createdAt: 0 };
const TAB = 'https://mail.example/compose';
const tabs = [{ url: TAB, title: 'Compose', tabId: 7 }];
const run = (over: Partial<GardenRun> = {}): GardenRun => ({
  ...newRun({ id: 'r', gardenerId: 'g1', work: { kind: 'plan', request: 'fill my form', tabs }, now: 0 }),
  model: 'm', maxTokens: 4096, agent: { loop: false, maxSteps: 8 }, abilities: ['plan'], ...over,
});
const click = { tab: TAB, steps: { strict: true, instructions: [{ click: '#send' }] } };
const fill = { tab: TAB, steps: { strict: true, instructions: [{ fill: ['#to', 'a@b.c'] }] } };

test('act_my_tab raises an approve request even with a matching grant, and Always is not offered', () => {
  const grant: Grant = { gardenerId: 'g1', tool: 'act_my_tab', host: 'mail.example', argsKey: argsKey(click), at: 0 };
  const r = run({ plan: [{ tool: 'act_my_tab', args: click }], status: 'queued' });
  assert.equal(decide(r, g, { tool: 'act_my_tab', args: click }, { grants: [grant] }), 'ask');
  const a = next(r, { gardener: g, tools: toolsFor(r), now: 1, grants: [grant] });
  assert.ok('request' in a && a.request.kind === 'approve' && a.request.tool === 'act_my_tab' && !a.request.sensitive, JSON.stringify(a));
  const q: Request = { ...a.request, id: 'q' };
  assert.equal(alwaysOk(q), false);
  assert.equal(alwaysOk({ ...q, tool: 'act' }), true);
  // Only a tab the person named, and only where they named tabs.
  assert.equal(decide(r, g, { tool: 'act_my_tab', args: { ...click, tab: 'https://bank.example/' } }), 'deny');
  assert.ok(!toolsFor(run({ work: { kind: 'plan', request: 'x' } })).some((t) => t.name === 'act_my_tab'));
});

test('a click-only act_my_tab in an approved plan still raises its own request; the plan pre-approves only gardener-tab acts', () => {
  const act = { url: 'https://shop.com/cart', steps: { strict: true, instructions: [{ click: '#pay' }] } };
  const r = run({ turns: [{ purpose: 'plan', reply: JSON.stringify([{ tool: 'act_my_tab', args: click }, { tool: 'act', args: act }]), at: 1 }] });
  const ctx: Ctx = { gardener: g, tools: toolsFor(r), now: 2 };
  const p = next(r, ctx);
  assert.ok('request' in p && p.request.kind === 'plan', JSON.stringify(p));
  const q: Request = { ...p.request, id: 'p' };
  r.requests.push(q);
  r.status = 'waiting';
  assert.equal(answerPlan(r, ctx, q, 'yes', undefined, 3), null);
  assert.deepEqual(r.requests.filter((x) => x.fromPlan).map((x) => x.tool), ['act']);
  const a = next(r, ctx);
  assert.ok('request' in a && a.request.kind === 'approve' && a.request.tool === 'act_my_tab');
  // Even a forged fromPlan yes for it doesn't count.
  r.requests.push({ ...a.request, id: 'forged', shownAt: 3, answer: { value: 'yes', at: 3 }, fromPlan: true });
  const b = next(r, ctx);
  assert.ok('request' in b && b.request.kind === 'approve', JSON.stringify(b));
});

test('its first fill is sensitive in an untainted run; approveAllOk is false for it', () => {
  const r = run({ plan: [{ tool: 'act_my_tab', args: fill }], status: 'queued' });
  assert.equal(r.tainted, false);
  const a = next(r, { gardener: g, tools: toolsFor(r), now: 1 });
  assert.ok('request' in a && a.request.sensitive && /your own/.test(a.request.why ?? ''), JSON.stringify(a));
  const q: Request = { ...a.request, id: 'q' };
  assert.equal(approveAllOk(q, r), false);
  assert.equal(approveAllOk({ ...q, sensitive: false }, r), false);
});

test('the lock bar\'s Stop from the borrowed tab is accepted by owned(); a moved tab is refused', () => {
  const e = { group: 4, borrowed: new Set([7]) };
  assert.equal(ownsTab(e, { id: 7, groupId: -1 }), true);
  assert.equal(ownsTab(e, { id: 9, groupId: 4 }), true);
  assert.equal(ownsTab(e, { id: 8, groupId: -1 }), false);
  assert.equal(ownsTab({ borrowed: new Set() }, { id: 7, groupId: -1 }), false);
  assert.match(String(mentionedTab(tabs, TAB, [{ id: 7, url: 'https://mail.example/inbox' }])), /another page/);
});

test('isChallenge: true for a reCAPTCHA iframe or a "verify you are human" page, false for a normal form', () => {
  assert.equal(isChallenge({ frames: ['https://shop.com/login', 'https://www.google.com/recaptcha/api2/anchor?k=x'], title: 'Log in', text: 'Email Password' }), true);
  assert.equal(isChallenge({ frames: ['https://newassets.hcaptcha.com/captcha/v1/x'], title: '', text: '' }), true);
  assert.equal(isChallenge({ frames: [], title: 'Just a moment...', text: '' }), true);
  assert.equal(isChallenge({ frames: [], title: 'Shop', text: 'Please verify you are human to continue.' }), true);
  assert.equal(isChallenge({ frames: ['https://shop.com/form'], title: 'Search the shop', text: 'Search Go' }), false);
  assert.equal(isChallenge({ frames: ['https://www.google.com/recaptcha/api2/anchor?k=x&size=invisible'], title: 'Log in', text: '' }), false);
  assert.equal(isChallenge({ frames: ['https://www.google.com/maps/embed'], title: 'Contact', text: '' }), false);
  // A widget on a full page (a login or contact form) isn't a wall; nor Turnstile, an invisible hCaptcha, or copy.
  const full = 'Contact us. '.repeat(80);
  assert.equal(isChallenge({ frames: ['https://www.google.com/recaptcha/api2/anchor?k=x'], title: 'Contact', text: full }), false);
  assert.equal(isChallenge({ frames: ['https://challenges.cloudflare.com/cdn-cgi/challenge-platform/turnstile'], title: 'Log in', text: '' }), false);
  assert.equal(isChallenge({ frames: ['https://newassets.hcaptcha.com/captcha/v1/x/static/hcaptcha.html#frame=checkbox&size=invisible'], title: 'Log in', text: '' }), false);
  assert.equal(isChallenge({ frames: [], title: 'Our new kettle', text: `Press and hold the button to boil. ${full}` }), false);
  assert.equal(isChallenge({ frames: [], title: 'Shop', text: `${full} Please verify you are human.` }), false);
});

test('a failed call taints when it may have shown signed-in data: the person\'s tab always, an act on the sites', () => {
  assert.equal(failTaints('act_my_tab', fill, 'not found', ['shop.com']), true);
  assert.equal(failTaints('act', { url: 'https://shop.com/a' }, 'x failed', ['shop.com']), true);
  assert.equal(failTaints('act', { url: 'https://far.com/a' }, 'x failed. Now at https://my.shop.com/account.', ['shop.com']), true);
  assert.equal(failTaints('act', { url: 'https://far.com/a' }, 'x failed. Now at https://far.com/b.', ['shop.com']), false);
  assert.equal(failTaints('read_page', { url: 'https://shop.com/a' }, 'timeout', ['shop.com']), false);
});

test('a help request answered no fails the step; yes reads it again', () => {
  const help = (value: string): Request => ({ id: 'h', kind: 'help', step: 0, tabId: 3, text: 'Help with this site', sensitive: false, answer: { value, at: 2 } });
  const read = (q: Request) => ({ ...newRun({ id: 'r', gardenerId: 'g1', work: { kind: 'read', urls: ['https://shop.com/a'] }, now: 0 }), model: 'm', maxTokens: 4096, agent: { loop: false, maxSteps: 8 }, requests: [q] });
  const ctx: Ctx = { gardener: g, tools: TOOLS, now: 3 };
  const no = next(read(help('no')), ctx);
  assert.ok('record' in no && no.record.state === 'failed' && no.record.error === HELP_REFUSED);
  assert.deepEqual(next(read(help('yes')), ctx), { call: { i: 0, tool: 'read_page', args: { url: 'https://shop.com/a' } } });
});

test('the devtools digest strips query strings and caps lines; bodies never appear', () => {
  const errors = Array.from({ length: 25 }, (_, k) => `TypeError ${k} at https://shop.com/app.js?token=secret#x`);
  const reqs = [...Array.from({ length: 40 }, (_, k) => ({ method: 'GET', url: `https://shop.com/api/${k}?key=secret`, status: 500 })), { method: 'GET', url: 'https://shop.com/ok', status: 200 }];
  const d = devtoolsDigest(errors, reqs);
  assert.ok(!d.includes('secret') && !d.includes('?'));
  assert.equal(d.split('\n').filter((l) => l.startsWith('- TypeError')).length, 20);
  assert.equal(d.split('\n').filter((l) => l.startsWith('- GET')).length, 30);
  assert.ok(!d.includes('/ok'));
  assert.match(devtoolsDigest([], [{ method: 'PATCH', url: 'https://shop.com/item/1?x=1', status: 422 }]), /^Failed requests:\n- PATCH https:\/\/shop\.com\/item\/1 422$/);
  assert.equal(devtoolsDigest([], []), '');
});

test('a download whose referrer is the person\'s tab is not claimed; one from a run tab is', () => {
  const runs = [{ runId: 'r1', urls: new Set(['https://shop.com/invoices']) }];
  assert.equal(downloadRun('https://shop.com/invoices', runs, ['https://mail.example/']), 'r1');
  assert.equal(downloadRun('https://shop.com/invoices#top', runs, []), 'r1');
  assert.equal(downloadRun('https://shop.com/invoices', runs, ['https://shop.com/invoices']), null);
  assert.equal(downloadRun('https://mail.example/', runs, ['https://mail.example/']), null);
  assert.equal(downloadRun('', runs, []), null);
  assert.equal(downloadRun('https://shop.com/invoices', [...runs, { runId: 'r2', urls: new Set(['https://shop.com/invoices']) }], []), null);
});

test('a gardener keeps its devtools switch', () => {
  assert.equal(parseGardener({ ...g, devtools: true })?.devtools, true);
  assert.equal(parseGardener({ ...g, devtools: 'yes' })?.devtools, undefined);
});
