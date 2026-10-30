// Measured abilities (ADR-18): one suite per ability, one pass rule each. A pass is what the owner copies into the
// model's `abilities` in src/domain/model.ts by hand; this script never edits it.
// Run: EG_MODEL=Gemma-4-E2B-it ./scripts/gpu.sh node bench/abilities.mjs plan  → bench/results/ability-plan-<model>.json
//
// plan: the 8 garden-eval requests as plan-first runs. Each run is planted in the worker's store already pinned with
// `abilities: ['plan']` (no model has it yet, so gardenRun refuses plan work), and pin() leaves it alone. The bench
// approves each plan unedited. A case passes when its plan parses (only listed tools, valid args), the run ends done
// and the case's outcome check holds. Any request other than the plan, or a denied call, is a policy violation.
// Pass: ≥ 6/8 and 0 violations. Pages and search are faked at their edge by Playwright routes (ADR-14).
//
// deck, cite, evidence (T9): the product's own prompts and parsers from src/domain, called on the model directly
// (fixtures in output-fixtures.mjs). deck: 6 sources → decks; a case passes when the deck parses (one repair), has
// ≤ 15 slides and every title and bullet is grounded in the source; pass ≥ 5/6. cite: 4 sets of 3–5 files; the reader's
// map-reduce (`citeFiles`); a case passes when the answer holds the known words, no citation was dropped and every
// sentence of 4+ words cites a file and page; pass ≥ 3/4. evidence: 6 source sets with the report prompt and its two
// sections; a case passes when there is an Evidence and an Assumptions section, every Evidence bullet cites a listed
// source and no Assumptions line cites one (before `moveCited`); pass ≥ 5/6.
//
// skillEdit (T8): 6 skills, each with one corrected answer (evidence) and one case its method already passes. The
// product's `improveThink` and `proposalOf` write the edit; the edited method then answers both cases. A case passes
// when the edit parses, the corrected case's answer holds its expected words and the passing case's still does
// (`casePassed`, code). Pass: ≥ 4/6.
//
// notes (T10): 6 meeting transcripts ("You" and "Them" lines, as a recording saves them) with known decisions and
// owners. The product's NOTES_PROMPT and parseNotes. A case passes when the reply parses, every known decision is
// found (by its words, in a decision) and no action item names an owner the transcript doesn't (an owner parseNotes
// had to drop). Pass: ≥ 5/6.
//
// workflow <preset> (T12): `node bench/abilities.mjs workflow rosa`. Hires the pack, turns its skills on in the store
// (no model has their needs yet: this is what measures them) and runs each seed's cases from bench/workflows/<preset>.mjs as plan runs
// pinned with the seed's needs, approved unedited, routine seeds with their `routineId`. A seed passes when every case's
// plan parses, its run ends done, the answer holds each `expect` word (`casePassed`) and nothing else was asked or
// denied. Each passing seed writes `workflow:<preset>/<id>` into `passes`; the owner copies passes into model.ts.
import fs from 'node:fs';
import path from 'node:path';
import { launch, engine, ROOT } from '../tests/harness.mjs';
import { BING, CASES, PAGES, html } from './garden-fixtures.mjs';
import { CITES, DECKS, EVIDENCE } from './output-fixtures.mjs';
import { DECK_MAX, tableText, writeDeck } from '../src/domain/outputs.ts';
import { citeFiles } from '../src/domain/reading.ts';
import { reportPrompt } from '../src/domain/research.ts';
import { contextChars, defang, grounded, parseJsonObject } from '../src/domain/text.ts';
import { casePassed, improveThink, proposalOf } from '../src/domain/garden/skills.ts';
import { NOTES_PROMPT, parseNotes } from '../src/domain/meeting.ts';
import { presetById, SEED_RULE } from '../src/domain/garden/presets.ts';

const ABILITY = process.argv[2];
const SUITES = { plan, deck, cite, evidence, skillEdit, notes, workflow };
const PACK = ABILITY === 'workflow' ? presetById(process.argv[3]) : null;
if (!SUITES[ABILITY] || (ABILITY === 'workflow' && !PACK)) {
  console.log(`Usage: node bench/abilities.mjs <${Object.keys(SUITES).join('|')}> (workflow <preset>)`);
  process.exit(1);
}
const NAME = PACK ? `workflow-${PACK.id}` : ABILITY;
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
const put = (store, value) => panel.evaluate(async ([store, value]) => {
  const d = await new Promise((ok, no) => Object.assign(indexedDB.open('hg-garden'), { onsuccess: (e) => ok(e.target.result), onerror: no }));
  const t = d.transaction(store, 'readwrite');
  t.objectStore(store).put(value);
  await new Promise((ok, no) => Object.assign(t, { oncomplete: ok, onerror: no }));
  d.close();
}, [store, value]);

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
console.log(`model: ${m.name}, ${m.maxTokens} tokens, ability: ${NAME}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = await SUITES[ABILITY]();
const won = out.passes ?? (out.passed ? [ABILITY] : []);
console.log(`\n${out.pass}/${out.of} passed, ${out.violations} policy violation(s) → ${won.length ? `PASS: add ${won.map((a) => `'${a}'`).join(', ')}` : 'no pass'}`);
fs.mkdirSync(path.join(ROOT, 'bench/results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, `bench/results/ability-${NAME}-${MODEL}.json`), JSON.stringify({ ability: NAME, model: MODEL, maxTokens: m.maxTokens, ...out }, null, 2));
await restore();
await ctx.close();

// The test profile is reused: start from an empty garden.
async function emptyGarden() {
  for (const r of await bg('runList', { limit: 1000 })) {
    if (['queued', 'running', 'waiting'].includes(r.status)) await bg('runStop', { id: r.id });
    await bg('runDelete', { id: r.id });
  }
  for (const g of await bg('gardenerList')) await bg('gardenerDelete', { id: g.id });
  for (const x of await bg('skillList')) await bg('skillDelete', { id: x.id });
}

/** Plants a plan run pinned with `abilities`, approves its plan unedited, answers no to anything else (a violation). */
async function planRun(runId, gardenerId, work, abilities, extra = {}) {
  const t0 = Date.now();
  await put('runs', {
    v: 1, id: runId, gardenerId, work, status: 'queued', queuedAt: t0, usedMs: 0,
    model: m.name, maxTokens: m.maxTokens, agent: { loop: false, maxSteps: 8 }, abilities,
    turns: [], steps: [], requests: [], seen: [], tainted: false, ...extra,
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
  return { run, calls, violations, ms: Date.now() - t0 };
}

function trail(run) {
  return { answer: run.answer ?? null, why: run.why ?? null, trail: run.steps.map((s) => s.digest ?? `${s.tool} ${s.state}`), turns: run.turns.map((t) => `${t.purpose}: ${t.reply}`) };
}

async function plan() {
  await emptyGarden();
  const g = await bg('gardenerSave', { gardener: { name: 'Helper', instructions: 'Do what the person asks, briefly.', sites: ['shop.garden.test'], minutes: 10 } });
  const results = [];
  for (const c of CASES) {
    const { run, calls, violations, ms } = await planRun(`ability-plan-${c.id}-${Date.now()}`, g.id, { kind: 'plan', request: c.request }, ['plan']);
    const extra = [...new Set((calls ?? []).map((x) => x.tool).filter((t) => !c.tools.includes(t)))];
    const fails = [
      ...(calls ? [] : ['the plan did not parse']),
      ...(run.status === 'done' ? [] : [`${run.status}: ${run.why ?? ''}`]),
      ...(c.strict ? extra.map((t) => `unneeded ${t}`) : []),
      ...c.check(run),
    ];
    const ok = !fails.length && !violations.length;
    results.push({ id: c.id, ok, fails, violations, extra, plan: calls, steps: run.steps.length, ms, usedMs: run.usedMs, request: c.request, ...trail(run) });
    console.log(`${ok ? '✓' : '✗'} ${c.id}  ${calls ? `${calls.length} calls` : 'no plan'}, ${(ms / 1000).toFixed(0)} s${fails.length || violations.length ? `  — ${[...fails, ...violations].join('; ')}` : ''}`);
    console.log(`    ${(run.answer ?? run.why ?? '').replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  const pass = results.filter((r) => r.ok).length;
  const violations = results.reduce((n, r) => n + r.violations.length, 0);
  return { pass, of: results.length, violations, passed: pass >= 6 && violations === 0, rule: '≥ 6/8 plans parse, use only listed tools and complete the task unedited; 0 policy violations', cases: results };
}

// ---- T12 workflow: a pack's seeds, each on its own cases from presets.ts ----
async function workflow() {
  await emptyGarden();
  const g = await bg('hire', { presetId: PACK.id });
  const skills = (await bg('skillList')).filter((x) => x.gardenerId === g.id);
  for (const x of skills) await put('skills', { ...x, on: true });
  const routines = await bg('routineList', { gardenerId: g.id });
  const tests = (await import(`./workflows/${PACK.id}.mjs`)).default;
  const seeds = [
    ...PACK.skills.map((x) => ({ ...x, skill: skills.find((s) => s.name === x.id) })),
    ...PACK.routines.map((x) => ({ ...x, routine: routines.find((r) => r.name === x.name) })),
  ].map((x) => ({ ...x, tests: tests[x.id] })).filter((x) => x.tests?.length);
  const results = [];
  for (const seed of seeds) {
    const cases = [];
    for (const [k, c] of seed.tests.entries()) {
      const work = { kind: 'plan', request: c.request, ...(seed.skill && { skillId: seed.skill.id }) };
      const { run, calls, violations, ms } = await planRun(`ability-${NAME}-${seed.id}-${k}-${Date.now()}`, g.id, work, [...new Set(['plan', ...seed.needs])], seed.routine ? { routineId: seed.routine.id } : {});
      const fails = [
        ...(calls ? [] : ['the plan did not parse']),
        ...(run.status === 'done' ? [] : [`${run.status}: ${run.why ?? ''}`]),
        ...c.expect.filter((w) => !casePassed(run.answer, w)).map((w) => `answer lacks "${w}"`),
      ];
      const ok = !fails.length && !violations.length;
      cases.push({ ok, fails, violations, plan: calls, ms, request: c.request, ...trail(run) });
      console.log(`${ok ? '✓' : '✗'} ${seed.id}#${k + 1}  ${calls ? `${calls.length} calls` : 'no plan'}, ${(ms / 1000).toFixed(0)} s${fails.length || violations.length ? `  — ${[...fails, ...violations].join('; ')}` : ''}`);
      console.log(`    ${(run.answer ?? run.why ?? '').replace(/\s+/g, ' ').slice(0, 200)}`);
    }
    results.push({ id: seed.id, ability: `workflow:${PACK.id}/${seed.id}`, passed: cases.every((c) => c.ok), cases });
  }
  const pass = results.filter((r) => r.passed).length;
  const violations = results.reduce((n, r) => n + r.cases.reduce((k, c) => k + c.violations.length, 0), 0);
  return { pass, of: results.length, violations, passed: pass === results.length, passes: results.filter((r) => r.passed).map((r) => r.ability), rule: SEED_RULE, seeds: results };
}

// ---- T9 abilities: the product's prompts, asked of the model as a background request (as `askAs` does) ----

// Declarations, not consts: the suite runs (top-level await above) before this part of the module is evaluated.
var calls = 0;
async function ask(prompt, data = '') {
  calls++;
  return (await engine(sw, 'generate', { id: crypto.randomUUID(), turns: [{ role: 'user', text: prompt, selection: data }], config: {}, model: m.name, priority: 'background' })).text;
}
async function suite(cases, run, need, rule) {
  const results = [];
  for (const c of cases) {
    const t0 = Date.now();
    calls = 0;
    const r = await run(c).catch((e) => ({ fails: [`error: ${e.message}`] }));
    results.push({ id: c.id, ok: !r.fails.length, ms: Date.now() - t0, calls, ...r });
    console.log(`${r.fails.length ? '✗' : '✓'} ${c.id}  ${((Date.now() - t0) / 1000).toFixed(0)} s${r.fails.length ? `  — ${r.fails.join('; ')}` : ''}`);
  }
  const pass = results.filter((r) => r.ok).length;
  return { pass, of: results.length, violations: 0, passed: pass >= need, rule, cases: results };
}

async function deck() {
  return suite(DECKS, async (c) => {
    const source = c.table ? tableText(c.table) : c.source;
    const d = await writeDeck(ask, source, contextChars(m.maxTokens));
    if (!d) return { fails: ['did not parse after one repair'] };
    const invented = d.slides.flatMap((s) => [s.title, ...s.bullets]).filter((b) => !grounded(b, source));
    return { deck: d, fails: [...(d.slides.length > DECK_MAX ? [`${d.slides.length} slides`] : []), ...invented.map((b) => `not in the source: ${b}`)] };
  }, 5, '≥ 5/6 decks that parse, hold ≤ 15 slides, and state only facts in the source');
}

async function cite() {
  return suite(CITES, async (c) => {
    const r = await citeFiles(ask, c.question, c.files, contextChars(m.maxTokens) - 600);
    const missing = c.answer.filter((w) => !r.text.toLowerCase().includes(w.toLowerCase()));
    // Labels hold full stops ("a.pdf p.2"): mark them before cutting sentences.
    const marked = r.text.replace(/\[[^\]\n]+? p\.\d+\]/g, '⟦cite⟧');
    const uncited = (marked.match(/[^.!?\n]+[.!?]*/g) ?? []).map((x) => x.trim()).filter((x) => x.split(/\s+/).length >= 4 && !x.includes('⟦cite⟧'));
    return { answer: r.text, dropped: r.dropped, fails: [...missing.map((w) => `answer lacks "${w}"`), ...(r.dropped ? [`${r.dropped} citation(s) not held by their page`] : []), ...uncited.map((x) => `uncited: ${x}`)] };
  }, 3, '≥ 3/4 answers right, every claim cited to a file and page that holds it');
}

// As background/web.ts `numbered` writes the research sources.
function numbered(items) {
  return items.map((s, i) => `[${i + 1}] ${defang(s.title)} (${s.url})\n${defang(s.notes)}`).join('\n\n');
}
async function evidence() {
  return suite(EVIDENCE, async (c) => {
    const reply = await ask(reportPrompt(c.q, true), numbered(c.sources));
    const lines = reply.split('\n');
    const section = (name) => {
      const at = lines.findIndex((l) => new RegExp(`^#{1,4}\\s*\\**${name}`, 'i').test(l.trim()));
      if (at < 0) return null;
      const end = lines.findIndex((l, i) => i > at && /^#{1,4}\s/.test(l.trim()));
      return lines.slice(at + 1, end < 0 ? lines.length : end).filter((l) => /^\s*([-*+]|\d+[.)])\s/.test(l));
    };
    const [ev, as] = [section('evidence'), section('assumptions')];
    const cites = (l) => [...l.matchAll(/\[(\d+)\]/g)].map((x) => +x[1]);
    return { reply, fails: [
      ...(ev?.length ? [] : ['no Evidence bullets']),
      ...(as ? [] : ['no Assumptions section']),
      ...(ev ?? []).filter((l) => !cites(l).length || cites(l).some((n) => n < 1 || n > c.sources.length)).map((l) => `evidence without a listed source: ${l.trim()}`),
      ...(as ?? []).filter((l) => cites(l).length).map((l) => `cited under Assumptions: ${l.trim()}`),
    ] };
  }, 5, '≥ 5/6 where every evidence line has a source and no sourced claim sits under assumptions');
}

// ---- T8 skillEdit: the product's improve prompt; each edited method is tried on the corrected and a passing case ----
// A function, hoisted: the suite runs (top-level await above) before this part of the module is evaluated.
function skillEdits() {
  return [
  { id: 'tldr', method: 'Summarize the text in one sentence.', fail: { input: 'Text: The council voted to close the old bridge for repairs from May to July.', answer: 'The bridge will be closed for repairs.', note: 'always start the summary with "TL;DR:"', expect: 'tl;dr' }, pass: { input: 'Text: Bees pollinate most fruit crops in the valley.', expect: 'bees' } },
  { id: 'currency', method: 'Give the price of the item asked about, as a number.', fail: { input: 'Menu: tea £3, cake £4. What does cake cost?', answer: '4', note: 'always write the currency code GBP after the number', expect: 'gbp' }, pass: { input: 'Menu: tea £3, cake £4. What does tea cost?', expect: '3' } },
  { id: 'done', method: 'List the items in the text, one per line.', fail: { input: 'Text: buy milk, eggs and bread.', answer: 'milk\neggs\nbread', note: 'always end the list with a line that says DONE', expect: 'done' }, pass: { input: 'Text: pack socks and a hat.', expect: 'socks' } },
  { id: 'salut', method: 'Translate the text to French.', fail: { input: 'Text: hello friend', answer: 'bonjour ami', note: 'never use "bonjour"; greet with "salut"', expect: 'salut' }, pass: { input: 'Text: thank you', expect: 'merci' } },
  { id: 'iso', method: 'Answer the question about the date.', fail: { input: 'What is the date of Christmas Day 2026?', answer: 'December 25, 2026', note: 'always write dates as YYYY-MM-DD', expect: '2026-12-25' }, pass: { input: 'What year comes after 2026?', expect: '2027' } },
  { id: 'because', method: 'Answer the question with yes or no.', fail: { input: 'Is ice colder than steam?', answer: 'Yes.', note: 'always give the reason, starting with the word "because"', expect: 'because' }, pass: { input: 'Is fire cold?', expect: 'no' } },
];
}

async function skillEdit() {
  const room = contextChars(m.maxTokens);
  return suite(skillEdits(), async (c) => {
    const skill = { method: c.method };
    const t = improveThink(skill, [{ kind: 'correction', input: c.fail.input, answer: c.fail.answer, note: c.fail.note }], room);
    const method = proposalOf(await ask(t.prompt, t.data));
    if (!method) return { fails: ['the edit did not parse'] };
    const run = (input) => ask(`How to do this:\n${method}`, input);
    const [fixed, kept] = [await run(c.fail.input), await run(c.pass.input)];
    return { method, fixed, kept, fails: [
      ...(casePassed(fixed, c.fail.expect) ? [] : [`corrected case lacks "${c.fail.expect}"`]),
      ...(casePassed(kept, c.pass.expect) ? [] : [`passing case lost "${c.pass.expect}"`]),
    ] };
  }, 4, '≥ 4/6 edits that fix the failing case and keep the passing ones');
}

// ---- T10 notes: each transcript's decisions by their key words; any owner the transcript doesn't name is invented ----
function meetings() {
  return [
    { id: 'launch', t: '[0:00] You: Morning. We need to settle the launch date.\n[0:20] Them: Marketing says the page is ready. Priya can finish the press kit by Monday.\n[0:41] You: Then we launch on March 3. Priya, you own the press kit.\n[1:02] Them: Agreed. Leo will book the venue.', decisions: [['march', '3']], owners: ['Priya', 'Leo'] },
    { id: 'budget', t: '[0:00] Them: The cloud bill doubled last month.\n[0:20] You: Let us cap spending at 5,000 a month from now on.\n[0:40] Them: Fine by me. Omar will set the alert.\n[1:00] You: I will tell finance.', decisions: [['5,000', '5000', 'cap']], owners: ['Omar', 'You'] },
    { id: 'hire', t: '[0:00] You: We saw three designers this week.\n[0:20] Them: Ana was the strongest by far.\n[0:40] You: Then we offer Ana the role. Kim, please send the offer today.\n[1:00] Them: Will do.', decisions: [['ana']], owners: ['Kim'] },
    { id: 'vendor', t: '[0:00] Them: Two quotes came back for the printers.\n[0:20] You: Inkly is cheaper and ships faster.\n[0:40] Them: Then we go with Inkly and drop the old vendor.\n[1:00] You: Sam, cancel the old contract this week.', decisions: [['inkly']], owners: ['Sam'] },
    { id: 'standup', t: '[0:00] You: Quick standup. The login bug is fixed.\n[0:20] Them: The release can go out Thursday then.\n[0:40] You: Yes, we ship on Thursday. Dev will write the release notes.\n[1:00] Them: And we move the retro to Friday.', decisions: [['thursday'], ['friday', 'retro']], owners: ['Dev'] },
    { id: 'office', t: '[0:00] Them: The lease ends in June.\n[0:20] You: We stay remote for now and do not renew the lease.\n[0:40] Them: Then we need a monthly meetup. Rosa can organise it.\n[1:00] You: Good. Rosa owns the meetup.', decisions: [['lease', 'renew', 'remote']], owners: ['Rosa'] },
  ];
}

async function notes() {
  return suite(meetings(), async (c) => {
    const raw = parseJsonObject(await ask(NOTES_PROMPT, c.t));
    const n = parseNotes(raw, c.t);
    if (!n) return { fails: ['did not parse'] };
    const decisions = n.decisions.join('\n').toLowerCase();
    const missed = c.decisions.filter((words) => !words.some((w) => decisions.includes(w.toLowerCase())));
    const asked = (Array.isArray(raw.actions) ? raw.actions : []).map((a) => (typeof a?.owner === 'string' ? a.owner.trim() : '')).filter(Boolean);
    const kept = n.actions.filter((a) => a.owner).length;
    const invented = asked.filter((o) => !/^them$/i.test(o)).length - kept;
    return { notes: n, fails: [...missed.map((w) => `missed the decision about ${w[0]}`), ...(invented > 0 ? [`${invented} invented owner(s): ${asked.join(', ')}`] : [])] };
  }, 5, '≥ 5/6 with every decision found and no invented owner');
}
