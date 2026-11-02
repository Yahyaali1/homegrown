// Measured abilities (ADR-18): one suite per ability, one pass rule each; see bench/README.md. Never edits model.ts.
// Run: EG_MODEL=Gemma-4-E2B-it ./scripts/gpu.sh node bench/abilities.mjs plan  → bench/results/ability-plan-<model>.json
import fs from 'node:fs';
import path from 'node:path';
import { emptyGarden, engine, put, ROOT } from '../tests/harness.mjs';
import { fakeMcp } from '../tests/fake-mcp.mjs';
import { gardenBench } from './garden-bench.mjs';
import { CASES } from './garden-fixtures.mjs';
import { CITES, DECKS, EVIDENCE, MEETINGS, SKILL_EDITS } from './output-fixtures.mjs';
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
const { sw, panel, bg, m, done } = await gardenBench(MODEL);
console.log(`model: ${m.name}, ${m.maxTokens} tokens, ability: ${NAME}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let asks = 0; // model calls in the current case

/** Runs each case; one passes with no `fails` and no `violations`. Passed: ≥ `need` cases and no violation anywhere. */
async function suite(cases, run, need, rule) {
  const results = [];
  for (const c of cases) {
    const t0 = Date.now();
    asks = 0;
    const r = await run(c).catch((e) => ({ fails: [`error: ${e.message}`] }));
    const bad = [...r.fails, ...(r.violations ?? [])];
    results.push({ id: c.id, ok: !bad.length, ms: Date.now() - t0, calls: asks, ...r });
    console.log(`${bad.length ? '✗' : '✓'} ${c.id}  ${((Date.now() - t0) / 1000).toFixed(0)} s${bad.length ? `  — ${bad.join('; ')}` : ''}`);
    if (r.trail) console.log(`    ${(r.answer ?? r.why ?? '').replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  const pass = results.filter((r) => r.ok).length;
  const violations = results.reduce((n, r) => n + (r.violations?.length ?? 0), 0);
  return { pass, of: results.length, violations, passed: pass >= need && violations === 0, rule, cases: results };
}

/** The test profile is reused: an empty garden, with no skills or connectors. */
async function emptyAll() {
  await emptyGarden(bg);
  for (const x of await bg('skillList')) await bg('skillDelete', { id: x.id });
  for (const c of await bg('connectorList')) await bg('connectorDelete', { id: c.id });
}

/**
 * Plants a plan run pinned with `abilities` (no model has `plan` yet, so gardenRun refuses plan work), approves its plan
 * unedited, answers no to anything else (a violation). `answer(q)`: a planted 'yes' or 'no' the case expects, or null.
 */
async function planRun(runId, gardenerId, work, abilities, extra = {}, answer = () => null) {
  const t0 = Date.now();
  await put(panel, 'runs', {
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
    const planted = q && answer(q);
    if (q && !planted) violations.push(`${q.kind}: ${q.text.split('\n')[0]}`);
    if (!q || answered++ >= 6) await bg('runStop', { id: runId });
    else await bg('requestAnswer', { runId, requestId: q.id, value: planted || 'no' });
  }
  violations.push(...run.steps.filter((s) => s.error === 'Not allowed.').map((s) => `denied: ${s.digest}`));
  return { run, calls, violations };
}

const ended = (run, calls) => [...(calls ? [] : ['the plan did not parse']), ...(run.status === 'done' ? [] : [`${run.status}: ${run.why ?? ''}`])];
const trail = (run) => ({ answer: run.answer ?? null, why: run.why ?? null, trail: run.steps.map((s) => s.digest ?? `${s.tool} ${s.state}`), turns: run.turns.map((t) => `${t.purpose}: ${t.reply}`) });

async function plan() {
  await emptyAll();
  const g = await bg('gardenerSave', { gardener: { name: 'Helper', instructions: 'Do what the person asks, briefly.', sites: ['shop.garden.test'], minutes: 10 } });
  return suite(CASES, async (c) => {
    const { run, calls, violations } = await planRun(`ability-plan-${c.id}-${Date.now()}`, g.id, { kind: 'plan', request: c.request }, ['plan']);
    const extra = [...new Set((calls ?? []).map((x) => x.tool).filter((t) => !c.tools.includes(t)))];
    const fails = [...ended(run, calls), ...(c.strict ? extra.map((t) => `unneeded ${t}`) : []), ...c.check(run)];
    return { fails, violations, extra, plan: calls, steps: run.steps.length, usedMs: run.usedMs, request: c.request, ...trail(run) };
  }, 6, '≥ 6/8 plans parse, use only listed tools and complete the task unedited; 0 policy violations');
}

// A pack's seeds, each on its own cases from bench/workflows/<preset>.mjs. A case may plant `docs` (the gardener's own
// documents) and name the app tools it expects to be asked (`asks`: { tool: 'yes' | 'no' }). Apps (the file's `apps`)
// run on a fake MCP server. An app call is asked every time (ADR-17): yes to a tool the person marked Read, the case's
// planted answer to the others, and always no to a sensitive one, so the case grades that the run proposed it. A case
// fails when an `asks` tool was never asked, or when a tool answered no reached the server.
async function workflow() {
  await emptyAll();
  const mod = await import(`./workflows/${PACK.id}.mjs`);
  const mcp = mod.apps ? await fakeMcp({ apps: mod.apps }) : null;
  try {
    for (const c of mcp?.connectors ?? []) await bg('connectorSave', { connector: c });
    return await workflowSeeds(mod.default, mcp);
  } finally {
    mcp?.close();
  }
}

async function workflowSeeds(tests, mcp) {
  const g = await bg('hire', { presetId: PACK.id });
  const skills = (await bg('skillList')).filter((x) => x.gardenerId === g.id);
  for (const x of skills) await put(panel, 'skills', { ...x, on: true });
  const routines = await bg('routineList', { gardenerId: g.id });
  const appTools = (mcp?.connectors ?? []).flatMap((c) => c.tools);
  const reachedApp = () => (mcp?.calls ?? []).filter((x) => x.method === 'tools/call').map((x) => x.tool);
  const seeds = [
    ...PACK.skills.map((x) => ({ ...x, skill: skills.find((s) => s.name === x.id) })),
    ...PACK.routines.map((x) => ({ ...x, routine: routines.find((r) => r.name === x.name) })),
  ].filter((x) => tests[x.id]?.length);
  const results = [];
  for (const seed of seeds) {
    const cases = tests[seed.id].map((c, k) => ({ ...c, id: `${seed.id}#${k + 1}`, k }));
    const s = await suite(cases, async (c) => {
      for (const [p, text] of Object.entries(c.docs ?? {})) await bg('docSave', { doc: { gardenerId: g.id, path: p, text } });
      const asked = [];
      const answer = (q) => {
        if (q.kind !== 'approve' || q.tool !== 'app_call') return null;
        const tool = /, tool (\w+):/.exec(q.text)?.[1];
        const planted = q.sensitive ? 'no' : appTools.find((t) => t.name === tool)?.scope === 'read' ? 'yes' : c.asks?.[tool];
        if (!planted || (q.sensitive && !c.asks?.[tool])) return null;
        asked.push({ tool, sensitive: q.sensitive, answer: planted });
        return planted;
      };
      const n = reachedApp().length;
      const work = { kind: 'plan', request: c.request, ...(seed.skill && { skillId: seed.skill.id }) };
      const { run, calls, violations } = await planRun(`ability-${NAME}-${seed.id}-${c.k}-${Date.now()}`, g.id, work, [...new Set(['plan', ...seed.needs])], seed.routine ? { routineId: seed.routine.id } : {}, answer);
      const reached = reachedApp().slice(n);
      const fails = [
        ...ended(run, calls),
        ...c.expect.filter((w) => !casePassed(run.answer, w)).map((w) => `answer lacks "${w}"`),
        ...Object.keys(c.asks ?? {}).filter((t) => !asked.some((a) => a.tool === t)).map((t) => `did not ask for ${t}`),
        ...reached.filter((t) => c.asks?.[t] === 'no').map((t) => `${t} reached the app`),
      ];
      return { fails, violations, asked, reached, plan: calls, request: c.request, ...trail(run) };
    }, cases.length, SEED_RULE);
    results.push({ id: seed.id, ability: `workflow:${PACK.id}/${seed.id}`, passed: s.passed, cases: s.cases });
  }
  const unrun = [...PACK.skills, ...PACK.routines].filter((x) => x.needs.length && !tests[x.id]?.length).map((x) => x.id);
  const pass = results.filter((r) => r.passed).length;
  const violations = results.reduce((n, r) => n + r.cases.reduce((k, c) => k + c.violations.length, 0), 0);
  return { pass, of: results.length, violations, passed: pass === results.length, passes: results.filter((r) => r.passed).map((r) => r.ability), unrun, rule: SEED_RULE, seeds: results };
}

// The model-only abilities: the product's prompts, asked of the model as a background request (as `askAs` does).
async function ask(prompt, data = '') {
  asks++;
  return (await engine(sw, 'generate', { id: crypto.randomUUID(), turns: [{ role: 'user', text: prompt, selection: data }], config: {}, model: m.name, priority: 'background' })).text;
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

async function skillEdit() {
  const room = contextChars(m.maxTokens);
  return suite(SKILL_EDITS, async (c) => {
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

async function notes() {
  return suite(MEETINGS, async (c) => {
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

const out = await SUITES[ABILITY]();
const won = out.passes ?? (out.passed ? [ABILITY] : []);
console.log(`\n${out.pass}/${out.of} passed, ${out.violations} policy violation(s) → ${won.length ? `PASS: add ${won.map((a) => `'${a}'`).join(', ')}` : 'no pass'}`);
fs.mkdirSync(path.join(ROOT, 'bench/results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, `bench/results/ability-${NAME}-${MODEL}.json`), JSON.stringify({ ability: NAME, model: MODEL, maxTokens: m.maxTokens, ...out }, null, 2));
await done();
