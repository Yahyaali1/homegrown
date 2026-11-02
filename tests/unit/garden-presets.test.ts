// Companions (plan T12): packs are data, Hire stores everything off, tools only narrow, and a workflow seed needs its
// measured `workflow:<preset>/<id>` to be turned on or to run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { direct, hireRecords, PRESETS, presetById, presetProblems, withProfile } from '../../src/domain/garden/presets.ts';
import { newRun, noPage, parseGardener, parseRoutine, type GardenRun, type Work } from '../../src/domain/garden/records.ts';
import { NEEDS, needsRefusal, parseSkill, skillRefusal, slashOf } from '../../src/domain/garden/skills.ts';
import { TOOLS, toolsFor } from '../../src/domain/garden/tools.ts';
import { parseEntity } from '../../src/domain/memory.ts';
import type { Ability } from '../../src/domain/model.ts';
import { actOf } from '../../src/domain/garden/policy.ts';
import { classify, sensitiveWord } from '../../src/domain/garden/classify.ts';
import { plazaLine, plazaThink } from '../../src/domain/plaza.ts';
import { parseSettings } from '../../src/domain/settings.ts';

let n = 0;
const hire = (id: string, o: { sites?: string[]; taken?: string[] } = {}) =>
  hireRecords(presetById(id)!, { sites: o.sites ?? [], taken: o.taken ?? [], tz: 'Europe/London', now: Date.UTC(2026, 9, 30), id: () => `id${n++}` })!;
const has = (...xs: Ability[]) => (a: Ability) => xs.includes(a);

test('every preset parses; Rosa ships 2 routines and 3 skills, Dana 2 and 2', () => {
  for (const p of PRESETS) assert.deepEqual(presetProblems(p), [], p.id);
  const rosa = hire('rosa'), dana = hire('dana');
  assert.deepEqual([rosa.routines.length, rosa.skills.length, dana.routines.length, dana.skills.length], [2, 3, 2, 2]);
  assert.deepEqual(rosa.routines.map((r) => r.name), ['Market map', 'Regulation watch']);
  assert.ok(!PRESETS.find((p) => p.id === 'dana')!.tools.includes('act_my_tab'), 'Dana acts only in her own tabs');
});

test('Hire stores every seed off: routines paused, skills off, templates unkept; needs copied on', () => {
  for (const p of PRESETS) {
    const made = hire(p.id);
    assert.equal(made.gardener.preset, p.id);
    assert.deepEqual(made.gardener.sites, [], 'sites start empty');
    assert.ok(made.routines.every((r) => r.paused && r.by === 'preset'));
    assert.ok(made.skills.every((s) => !s.on && s.by === 'preset' && s.gardenerId === made.gardener.id));
    assert.ok(made.entities.every((e) => !e.confirmed && parseEntity(e)));
    p.routines.forEach((x, k) => assert.deepEqual(made.routines[k]!.needs ?? [], x.needs));
    p.skills.forEach((x, k) => assert.deepEqual(made.skills[k]!.needs, x.needs));
    // Stored records read back the same.
    assert.deepEqual(parseGardener(made.gardener), made.gardener);
    for (const r of made.routines) assert.deepEqual(parseRoutine(r), r);
    for (const s of made.skills) assert.deepEqual(parseSkill(s), s);
  }
});

test('a preset never adds a site: only its suggestions the person checked', () => {
  assert.deepEqual(hire('rosa', { sites: ['eur-lex.europa.eu', 'evil.example.com'] }).gardener.sites, ['eur-lex.europa.eu']);
  assert.deepEqual(hire('dana', { sites: ['staging.example.com'] }).gardener.sites, []);
});

test('a taken skill name gets a number, so a second Rosa can be hired', () => {
  assert.deepEqual(hire('rosa', { taken: ['brief', 'brief-2', 'deck'] }).skills.map((s) => s.name), ['brief-3', 'directory', 'deck-2']);
});

test('every seed that is not a direct read names its workflow ability; direct reads need nothing', () => {
  for (const p of PRESETS) {
    for (const s of p.skills) assert.ok(s.needs.includes(`workflow:${p.id}/${s.id}`), `${p.id}/${s.id}`);
    for (const r of p.routines) {
      if (direct(r.work)) assert.deepEqual(r.needs, [], `${p.id}/${r.id}`);
      else assert.ok(r.needs.includes(`workflow:${p.id}/${r.id}`), `${p.id}/${r.id}`);
    }
  }
  const bad = { ...presetById('rosa')!, routines: [{ ...presetById('rosa')!.routines[0]!, needs: ['plan' as Ability] }] };
  assert.deepEqual(presetProblems(bad), ['routine market-map needs']);
});

test('toolsFor with a preset never returns a tool the gardener lacks, nor one outside the pack', () => {
  const run = { ...newRun({ id: 'r', gardenerId: 'g', work: { kind: 'plan', request: 'go', tabs: [{ url: 'https://a.com/', title: 'A' }] }, now: 0 }), agent: { loop: true, maxSteps: 8 } } as GardenRun;
  const conn = [{ id: 'c1', name: 'Linear', tools: [{ name: 'create_issue', describe: 'file a bug', scope: 'ask' as const, schema: {} }], guidelines: '' }];
  for (const p of PRESETS) {
    const all = toolsFor(run, TOOLS, conn as never).map((t) => t.name);
    const narrowed = toolsFor(run, TOOLS, conn as never, p.tools).map((t) => t.name);
    assert.ok(narrowed.every((t) => all.includes(t) && p.tools.includes(t)), p.id);
  }
  // Without named tabs, the pack's read_my_tab still isn't offered: narrowing never adds.
  const plain = newRun({ id: 'r', gardenerId: 'g', work: { kind: 'plan', request: 'go' }, now: 0 });
  assert.ok(!toolsFor(plain, TOOLS, [], presetById('rosa')!.tools).some((t) => t.name === 'read_my_tab'));
  assert.ok(!toolsFor(plain, TOOLS, [], presetById('rosa')!.tools).some((t) => t.name === 'act'));
  assert.deepEqual(toolsFor(plain, TOOLS, [], []), [], 'an unknown pack allows nothing');
});

test('turning on a seed is refused while the model lacks a need; a model with every need can turn it on', () => {
  const rosa = hire('rosa');
  const map = rosa.routines.find((r) => r.name === 'Market map')!;
  const watch = rosa.routines.find((r) => r.name === 'Regulation watch')!;
  assert.equal(needsRefusal(map, has()), NEEDS);
  assert.equal(needsRefusal(map, has('plan')), NEEDS);
  assert.equal(needsRefusal(map, has('workflow:rosa/market-map', 'plan')), null);
  assert.equal(needsRefusal(watch, has()), null, 'a direct read can be turned on with any model');
  assert.equal(needsRefusal({}, has()), null, 'the person\'s own routine needs nothing');
  assert.equal(needsRefusal(null, has()), null);
});

test('a run of an on routine whose pinned abilities lack a need fails at pin', () => {
  const map = { ...hire('rosa').routines[0]!, paused: false };
  const pinned = (abilities: Ability[]): GardenRun => ({ ...newRun({ id: 'r', gardenerId: map.gardenerId, routineId: map.id, work: map.work, now: 0 }), abilities });
  assert.equal(needsRefusal(map, (a) => !!pinned(['plan']).abilities!.includes(a)), NEEDS);
  assert.equal(needsRefusal(map, (a) => !!pinned(['plan', 'workflow:rosa/market-map']).abilities!.includes(a)), null);
});

test('/brief is refused while the skill is off or its needs are unmet', () => {
  const brief = hire('rosa').skills.find((s) => s.name === 'brief')!;
  assert.equal(slashOf('/brief go', [brief]), 'The skill /brief is off.');
  const on = { ...brief, on: true };
  const hit = slashOf('/brief go', [on]);
  assert.ok(hit && typeof hit === 'object');
  const work: Work = { kind: 'plan', request: 'go', skillId: on.id };
  const run = (abilities: Ability[]): GardenRun => ({ ...newRun({ id: 'r', gardenerId: on.gardenerId!, work, now: 0 }), abilities });
  assert.equal(skillRefusal(run(['plan']), on), NEEDS);
  assert.equal(skillRefusal(run(['plan', 'evidence', 'workflow:rosa/brief']), on), null);
  assert.equal(skillRefusal(run(['plan', 'evidence', 'workflow:rosa/brief']), brief), 'The skill /brief is off.');
});

test('interview answers join the instructions (the person\'s words); skipped ones are left out', () => {
  const g = hire('rosa').gardener;
  const profile = [{ q: 'What do you research most?', a: 'EU battery rules' }, { q: 'Who reads your research?', a: '' }];
  const ins = withProfile(g.instructions, profile);
  assert.ok(ins.startsWith(g.instructions) && ins.includes('- What do you research most? EU battery rules') && !ins.includes('Who reads'));
  assert.equal(withProfile(g.instructions, []), g.instructions);
  assert.ok(withProfile('x', [{ q: 'q?', a: 'y'.repeat(300) }, ...Array(7).fill({ q: 'q?', a: 'z'.repeat(300) })]).length <= 2000);
  assert.deepEqual(parseGardener({ ...g, profile })?.profile, profile);
  assert.equal(parseGardener({ ...g, profile: [{ q: 'q', a: 5 }] }), null);
});

test('Regulation watch ships with no page: it parses only paused, and with a page it is a plain event read', () => {
  const watch = hire('rosa').routines.find((r) => r.name === 'Regulation watch')!;
  assert.ok(noPage(watch.work) && watch.when.kind === 'event' && watch.when.url === '');
  assert.equal(parseRoutine({ ...watch, paused: false }), null, 'never on without a page');
  const url = 'https://eur-lex.europa.eu/oj/';
  const set = parseRoutine({ ...watch, paused: false, when: { ...watch.when, url }, work: { kind: 'read', urls: [url] } });
  assert.ok(set && !noPage(set.work) && set.when.kind === 'event' && set.when.url === url);
  assert.equal(parseRoutine({ ...watch, work: { kind: 'read', urls: [url] } }), null, 'a page without the event url is refused');
});

// ---- T13: seven more packs and Companion Plaza ----

test('all 9 companions; the seven T13 packs parse and each ship at least 3 routines, all off', () => {
  assert.deepEqual(PRESETS.map((p) => p.id).sort(), ['cora', 'dana', 'ellis', 'martin', 'olivia', 'rosa', 'sally', 'sofia', 'theo']);
  for (const id of ['martin', 'olivia', 'cora', 'sally', 'theo', 'ellis', 'sofia']) {
    const p = presetById(id)!;
    assert.deepEqual(presetProblems(p), [], id);
    assert.ok(p.routines.length >= 3, `${id} has ${p.routines.length} routines`);
    const made = hire(id);
    assert.ok(made.routines.every((r) => r.paused) && made.skills.every((s) => !s.on), id);
    assert.equal(new Set(p.routines.map((r) => r.name)).size, p.routines.length, `${id} routine names are unique`);
    assert.equal(new Set([...p.skills, ...p.routines].map((x) => x.id)).size, p.skills.length + p.routines.length, `${id} seed ids are unique`);
  }
});

test('no pack offers act_my_tab or propose_routine; write-heavy packs write only through asked app calls', () => {
  for (const p of PRESETS) {
    assert.ok(!p.tools.includes('act_my_tab') && !p.tools.includes('propose_routine'), p.id);
  }
  for (const id of ['olivia', 'sally', 'theo', 'sofia', 'ellis']) assert.ok(presetById(id)!.tools.includes('app_call'), id);
  // Code decides: an app call that refunds or sends is sensitive from the call alone (asked with the 8 s rule).
  const known = { connectors: [{ id: 'c', name: 'Stripe', url: 'https://mcp.stripe.test/', tools: [{ name: 'create_refund', describe: 'refund', scope: 'ask' as const, schema: {} }, { name: 'send_reply', describe: 'reply', scope: 'ask' as const, schema: {} }], guidelines: '' }] };
  assert.ok(actOf({ tool: 'app_call', args: { connector: 'c', tool: 'create_refund', args: {} } }, known as never)?.why);
  assert.ok(actOf({ tool: 'app_call', args: { connector: 'c', tool: 'send_reply', args: {} } }, known as never)?.why);
  for (const w of ['reply_to_conversation', 'chat_postMessage', 'add_replies', 'posted', 'Pay', 'pay_invoice', 'Pay now', 'create_payment', 'make_payment', 'get_payment {"then":"refund"}']) assert.ok(sensitiveWord(w), w);
  for (const w of ['postal code', 'postcode', 'Messages', 'read_conversation', 'get_payment', 'list_payments', 'searchPayouts']) assert.equal(sensitiveWord(w), null, w);
  // A page's button is classified by the same words, as a prefix: "Complete payment" is sensitive.
  for (const text of ['Complete payment', 'Payment', 'Pay now']) assert.ok(classify({ action: 'click', found: true, pageUrl: 'https://shop.com/', text }), text);
});

test('a seed that watches a page the person chooses ships with no page and stays paused', () => {
  const watch = hire('martin').routines.find((r) => r.name === 'Competitor watch')!;
  assert.ok(noPage(watch.work) && watch.paused && !(watch.needs ?? []).length);
  assert.equal(parseRoutine({ ...watch, paused: false }), null);
});

test('Ellis reuses Sally, Theo and Olivia seeds, re-gated on her own workflow abilities', () => {
  const ellis = presetById('ellis')!;
  for (const [from, id] of [['sally', 'leads'], ['theo', 'sourcing'], ['olivia', 'inbox-sort']] as const) {
    const mine = ellis.routines.find((r) => r.id === id)!, theirs = presetById(from)!.routines.find((r) => r.id === id)!;
    assert.deepEqual(mine.work, theirs.work);
    assert.ok(mine.needs.includes(`workflow:ellis/${id}`) && !mine.needs.includes(`workflow:${from}/${id}`));
  }
  const leads = hire('ellis').routines.find((r) => r.name === 'Lookalike leads')!;
  assert.equal(needsRefusal(leads, has('workflow:sally/leads', 'plan')), NEEDS, "Sally's measurement doesn't turn on Ellis's copy");
});

test('the Plaza prompt holds history titles only when plazaHistory is on; data only', () => {
  const o = { notes: ['Checked EU battery rules'], answers: ['Two rules changed in October.'] };
  const off = plazaThink('Rosa', { ...o, history: null });
  const on = plazaThink('Rosa', { ...o, history: ['My bank statement'] });
  assert.ok(!off.data.includes('visited') && !off.data.includes('bank'));
  assert.ok(on.data.includes('My bank statement'));
  assert.ok(off.data.includes('EU battery rules') && off.data.includes('October'));
  assert.ok(!off.prompt.includes('EU battery') && !on.prompt.includes('bank'), 'notes and history stay in the data part');
  assert.equal(plazaLine('"Two rules changed."\nmore'), 'Two rules changed.');
  assert.equal(plazaLine('\n\n'), '');
});

test('Plaza settings are off by default', () => {
  const s = parseSettings({});
  assert.equal(s.plaza, false);
  assert.equal(s.plazaHistory, false);
});
