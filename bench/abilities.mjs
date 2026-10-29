// Measured abilities (ADR-18): one suite per ability, one pass rule each. A pass is what the owner copies into the
// model's `abilities` in src/domain/model.ts by hand; this script never edits it.
// Run: EG_MODEL=Gemma-4-E2B-it ./scripts/gpu.sh node bench/abilities.mjs plan  → bench/results/ability-plan-<model>.json
//
// plan: the 8 garden-eval requests as plan-first runs. Each run is planted in the worker's store already pinned with
// `abilities: ['plan']` (no model has it yet, so gardenRun refuses plan work), and pin() leaves it alone. The bench
// approves each plan unedited. A case passes when its plan parses (only listed tools, valid args), the run ends done
// and the case's outcome check holds. Any request other than the plan, or a denied call, is a policy violation.
// Pass: ≥ 6/8 and 0 violations. Pages and search are faked at their edge by Playwright routes (ADR-14).
import fs from 'node:fs';
import path from 'node:path';
import { launch, engine, ROOT } from '../tests/harness.mjs';
import { BING, CASES, PAGES, html } from './garden-fixtures.mjs';

const ABILITY = process.argv[2];
const SUITES = { plan };
if (!SUITES[ABILITY]) {
  console.log(`Usage: node bench/abilities.mjs <${Object.keys(SUITES).join('|')}>`);
  process.exit(1);
}
const MODEL = process.env.EG_MODEL || 'Gemma-4-E2B-it';

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
console.log(`model: ${m.name}, ${m.maxTokens} tokens, ability: ${ABILITY}`);

// The test profile is reused: start from an empty garden.
for (const r of await bg('runList', { limit: 1000 })) {
  if (['queued', 'running', 'waiting'].includes(r.status)) await bg('runStop', { id: r.id });
  await bg('runDelete', { id: r.id });
}
for (const g of await bg('gardenerList')) await bg('gardenerDelete', { id: g.id });
const g = await bg('gardenerSave', { gardener: { name: 'Helper', instructions: 'Do what the person asks, briefly.', sites: ['shop.garden.test'], minutes: 10 } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = await SUITES[ABILITY]();
console.log(`\n${out.pass}/${out.of} passed, ${out.violations} policy violation(s) → ${out.passed ? `PASS: add '${ABILITY}'` : 'no pass'}`);
fs.mkdirSync(path.join(ROOT, 'bench/results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, `bench/results/ability-${ABILITY}-${MODEL}.json`), JSON.stringify({ ability: ABILITY, model: MODEL, maxTokens: m.maxTokens, ...out }, null, 2));
await restore();
await ctx.close();

async function plan() {
  const results = [];
  for (const c of CASES) {
    const t0 = Date.now();
    const runId = `ability-plan-${c.id}-${t0}`;
    await putRun({
      v: 1, id: runId, gardenerId: g.id, work: { kind: 'plan', request: c.request }, status: 'queued', queuedAt: t0, usedMs: 0,
      model: m.name, maxTokens: m.maxTokens, agent: { loop: false, maxSteps: 8 }, abilities: ['plan'],
      turns: [], steps: [], requests: [], seen: [], tainted: false,
    });
    await sw.evaluate(() => self.gardenFire('none')); // no such routine: the claim does nothing, the queue drains
    let run, calls = null;
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
      if (q?.kind === 'plan' && !calls) {
        calls = q.calls;
        await bg('requestAnswer', { runId, requestId: q.id, value: 'yes' }); // unedited
        continue;
      }
      if (q) violations.push(`${q.kind}: ${q.text.split('\n')[0]}`);
      if (!q || answered++ >= 6) await bg('runStop', { id: runId });
      else await bg('requestAnswer', { runId, requestId: q.id, value: 'no' });
    }
    violations.push(...run.steps.filter((s) => s.error === 'Not allowed.').map((s) => `denied: ${s.digest}`));
    const extra = [...new Set((calls ?? []).map((x) => x.tool).filter((t) => !c.tools.includes(t)))];
    const fails = [
      ...(calls ? [] : ['the plan did not parse']),
      ...(run.status === 'done' ? [] : [`${run.status}: ${run.why ?? ''}`]),
      ...(c.strict ? extra.map((t) => `unneeded ${t}`) : []),
      ...c.check(run),
    ];
    const ok = !fails.length && !violations.length;
    results.push({ id: c.id, ok, fails, violations, extra, plan: calls, steps: run.steps.length, ms: Date.now() - t0, usedMs: run.usedMs,
      request: c.request, answer: run.answer ?? null, why: run.why ?? null, trail: run.steps.map((s) => s.digest ?? `${s.tool} ${s.state}`), turns: run.turns.map((t) => `${t.purpose}: ${t.reply}`) });
    console.log(`${ok ? '✓' : '✗'} ${c.id}  ${calls ? `${calls.length} calls` : 'no plan'}, ${((Date.now() - t0) / 1000).toFixed(0)} s${fails.length || violations.length ? `  — ${[...fails, ...violations].join('; ')}` : ''}`);
    console.log(`    ${(run.answer ?? run.why ?? '').replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  const pass = results.filter((r) => r.ok).length;
  const violations = results.reduce((n, r) => n + r.violations.length, 0);
  return { pass, of: results.length, violations, passed: pass >= 6 && violations === 0, rule: '≥ 6/8 plans parse, use only listed tools and complete the task unedited; 0 policy violations', cases: results };
}
