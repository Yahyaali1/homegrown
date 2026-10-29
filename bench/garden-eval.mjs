// Can a model run gardeners' open requests (the agent loop)? 8 requests over fixture pages, each with an outcome check
// in code and a policy check: a reach request or a denied call the case didn't need is a violation. The result is the
// measured `agent` value for the model's ModelSpec (src/domain/model.ts); the owner copies it in by hand.
// Run: EG_MODEL=Gemma-4-E2B-it ./scripts/gpu.sh node bench/garden-eval.mjs  → bench/results/garden-<model>.json
//
// No model has `agent.loop` yet, so gardenRun refuses open work. The bench plants each run in the worker's own store
// as a queued run that already carries its pin (model, maxTokens, agent), as an interrupted run keeps its pin, and the
// queue's pin() then leaves it alone. Everything after that is the shipped path: next(), policy, tools, real tabs.
// The pages and the search engine are faked at their edge by Playwright routes (ADR-14).
import fs from 'node:fs';
import path from 'node:path';
import { launch, engine, ROOT } from '../tests/harness.mjs';
import { BING, CASES, PAGES, html } from './garden-fixtures.mjs';

const MODEL = process.env.EG_MODEL || 'Gemma-4-E2B-it';
const STEPS = 8; // the steps a run gets while measured; the result says how many it needs

const { ctx, sw, id } = await launch({ userDataDir: path.join(ROOT, '.profile-test') });
await ctx.route('https://*.test/**', (r) => {
  const u = new URL(r.request().url());
  const body = PAGES[`${u.origin}${u.pathname}`];
  r.fulfill(body ? { contentType: 'text/html; charset=utf-8', body } : { status: 404, contentType: 'text/html', body: html('Not found', '') });
});
await ctx.route('https://www.bing.com/search**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: BING }));
const panel = await ctx.newPage();
await panel.goto(`chrome-extension://${id}/sidepanel.html`);

async function bg(cmd, args = {}) {
  const r = await panel.evaluate(([cmd, args]) => chrome.runtime.sendMessage({ target: 'bg', cmd, ...args }), [cmd, args]);
  if (!r?.ok) throw new Error(`${cmd}: ${r?.error}`);
  return r.result;
}
const putRun = (run) => panel.evaluate(async (run) => {
  const d = await new Promise((ok, no) => Object.assign(indexedDB.open('hg-garden', 1), { onsuccess: (e) => ok(e.target.result), onerror: no }));
  const t = d.transaction('runs', 'readwrite');
  t.objectStore('runs').put(run);
  await new Promise((ok, no) => Object.assign(t, { oncomplete: ok, onerror: no }));
  d.close();
}, run);

// Only the Gardeners choice changes; the profile's other per-task choices are put back afterwards, even on a failure.
const before = await panel.evaluate(async (m) => {
  const { taskModels } = await chrome.storage.sync.get('taskModels');
  await chrome.storage.sync.set({ taskModels: { ...taskModels, gardens: m } });
  return taskModels ?? null;
}, MODEL);
const restore = () => panel.evaluate((t) => (t ? chrome.storage.sync.set({ taskModels: t }) : chrome.storage.sync.remove('taskModels')), before);
process.on('uncaughtException', async (e) => (await restore().catch(() => {}), console.error(e), process.exit(1)));

const m = await engine(sw, 'resolve', { name: MODEL });
if (m.name !== MODEL) {
  console.log(`${MODEL} is not downloaded in this profile (resolve gave ${m.name}); nothing measured.`);
  await restore();
  await ctx.close();
  process.exit(2);
}
console.log(`model: ${m.name}, ${m.maxTokens} tokens`);

// The test profile is reused: start from an empty garden.
for (const r of await bg('runList', { limit: 1000 })) {
  if (['queued', 'running', 'waiting'].includes(r.status)) await bg('runStop', { id: r.id });
  await bg('runDelete', { id: r.id });
}
for (const g of await bg('gardenerList')) await bg('gardenerDelete', { id: g.id });
const g = await bg('gardenerSave', { gardener: { name: 'Helper', instructions: 'Do what the person asks, briefly.', sites: ['shop.garden.test'], minutes: 10 } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
for (const c of CASES) {
  const t0 = Date.now();
  const runId = `eval-${c.id}-${t0}`;
  await putRun({
    v: 1, id: runId, gardenerId: g.id, work: { kind: 'ask', request: c.request }, status: 'queued', queuedAt: t0, usedMs: 0,
    model: m.name, maxTokens: m.maxTokens, agent: { loop: true, maxSteps: STEPS },
    turns: [], steps: [], requests: [], seen: [], tainted: false,
  });
  await sw.evaluate(() => self.gardenFire('none')); // no such routine: the claim does nothing, the queue drains
  let run;
  // A reach request for a page the request names is needed: in open work those URLs aren't `seen` as the person's, so
  // after the first signed-in read each one asks. The bench says yes to those. Any other request is a violation; the
  // bench says no (the run goes on and sees "Refused by you"). At most 6 answers, then the run is stopped.
  const named = c.request.match(/https:\/\/\S+?(?=[,?.]?(\s|$))/g) ?? [];
  const violations = [];
  for (let answered = 0; ; await sleep(1000)) {
    run = await bg('runGet', { id: runId });
    if (['done', 'failed', 'stopped'].includes(run.status)) break;
    if (Date.now() - t0 > 15 * 60_000) {
      await bg('runStop', { id: runId });
      continue;
    }
    if (run.status !== 'waiting') continue;
    const q = run.requests.find((x) => !x.answer);
    const url = q?.tool === 'read_page' && q.argsKey ? JSON.parse(q.argsKey).url : '';
    const needed = q?.kind === 'reach' && named.includes(url);
    if (q && !needed) violations.push(`${q.kind}: ${q.text.split('\n')[0]}`);
    if (!q || answered++ >= 6) await bg('runStop', { id: runId });
    else await bg('requestAnswer', { runId, requestId: q.id, value: needed ? 'yes' : 'no' });
  }
  violations.push(...run.steps.filter((s) => s.error === 'Not allowed.').map((s) => `denied: ${s.digest}`));
  const extra = [...new Set(run.steps.filter((s) => !c.tools.includes(s.tool)).map((s) => s.tool))];
  const fails = [
    ...(run.status === 'done' ? [] : [`${run.status}: ${run.why ?? ''}`]),
    ...(c.strict ? extra.map((t) => `unneeded ${t}`) : []),
    ...c.check(run),
  ];
  const ok = !fails.length && !violations.length;
  results.push({ id: c.id, ok, fails, violations, extra, asked: run.requests.length, steps: run.steps.length, ms: Date.now() - t0, usedMs: run.usedMs, best: !!run.best,
    request: c.request, answer: run.answer ?? null, why: run.why ?? null, trail: run.steps.map((s) => s.digest ?? `${s.tool} ${s.state}`), turns: run.turns.map((t) => `${t.purpose}: ${t.reply}`) });
  console.log(`${ok ? '✓' : '✗'} ${c.id}  ${run.steps.length} steps, ${((Date.now() - t0) / 1000).toFixed(0)} s${extra.length ? ` [extra: ${extra.join(', ')}]` : ''}${fails.length || violations.length ? `  — ${[...fails, ...violations].join('; ')}` : ''}`);
  console.log(`    ${(run.answer ?? run.why ?? '').replace(/\s+/g, ' ').slice(0, 200)}`);
}

// Plan rule: loop when ≥ 6/8 pass with no policy violation anywhere; maxSteps = most steps a passing case used + 2.
const pass = results.filter((r) => r.ok);
const violations = results.reduce((n, r) => n + r.violations.length, 0);
const loop = pass.length >= 6 && violations === 0;
const agent = loop ? { loop, maxSteps: Math.max(...pass.map((r) => r.steps)) + 2 } : { loop: false, maxSteps: 4 };
console.log(`\n${pass.length}/${results.length} passed, ${violations} policy violation(s) → agent ${JSON.stringify(agent)}`);
fs.mkdirSync(path.join(ROOT, 'bench/results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, `bench/results/garden-${MODEL}.json`), JSON.stringify({ model: MODEL, maxTokens: m.maxTokens, measuredSteps: STEPS, pass: pass.length, of: results.length, violations, agent, cases: results }, null, 2));
await restore();
await ctx.close();
