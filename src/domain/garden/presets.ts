// Companion packs (plan T12, decision 12): data only. Hire makes a gardener from one, with its skills and routines
// switched off and its template files unkept. A preset can narrow tools, never widen them, and never adds a site.
// Every seed except direct reads needs `workflow:<preset>/<id>`, which only that preset's bench suite can earn.
import type { Ability } from '../model.ts';
import type { Entity, EntityType } from '../memory.ts';
import { noPage, parseGardener, parseRoutine, PETALS, type Gardener, type Look, type Routine, type When, type Work } from './records.ts';
import { nextAfter } from './schedule.ts';
import { parseSkill, SKILL_NAME, type Skill } from './skills.ts';
import { TOOLS } from './tools.ts';

export interface SkillSeed { id: string; title: string; method: string; needs: Ability[] }
/** A read with no URLs (an event with url ''): the person sets the page before it can be turned on. */
export interface RoutineSeed { id: string; name: string; when: When; work: Work; needs: Ability[] }
export interface EntitySeed { type: EntityType; name: string; template: string }

export interface Preset {
  id: string;
  name: string;
  role: string;
  look: Look;
  instructions: string;
  interview: { q: string; placeholder?: string }[];
  /** Suggestions shown unchecked at Hire. */
  sites: string[];
  skills: SkillSeed[];
  routines: RoutineSeed[];
  /** The tools its gardener may use: narrows only. */
  tools: string[];
  templates: EntitySeed[];
  /** A line on its Hire card. */
  note?: string;
}

/** The bench rule for each workflow seed (cases in bench/workflows/<preset>.mjs): every case's plan is approved unedited, the run ends done and holds every expected word, with no policy violation. */
export const SEED_RULE = 'every case: plan parses, run done, answer holds each expected word; 0 policy violations';

export const PRESETS: Preset[] = [
  {
    id: 'rosa',
    name: 'Rosa',
    role: 'Research',
    look: { petals: 7, lean: 0.55 },
    instructions: 'You are Rosa, a careful researcher. Give a source for every claim. Keep what the sources show apart from what you assume. Say plainly when a source is missing or unclear.',
    interview: [
      { q: 'What do you research most?', placeholder: 'e.g. EU battery rules, coffee grinders' },
      { q: 'Who reads your research?', placeholder: 'e.g. my team, a client, just me' },
      { q: 'Which sources do you trust most?', placeholder: 'e.g. official journals, trade press' },
      { q: 'How long should a brief be?', placeholder: 'e.g. one page' },
    ],
    sites: ['eur-lex.europa.eu', 'scholar.google.com'],
    note: 'Regulation watch needs the page it watches: set it on the routine before turning it on.',
    skills: [
      {
        id: 'brief', title: 'Decision brief', needs: ['workflow:rosa/brief', 'plan', 'evidence'],
        method: 'Read each source the request names. Write a short brief with two sections. "Evidence": each line is one fact with the page it came from. "Assumptions": what you believe but no source shows. End with one line: the option you recommend and why.',
      },
      {
        id: 'directory', title: 'Directory to a table', needs: ['workflow:rosa/directory', 'plan'],
        method: 'Read the directory page the request names (or run the Collect recipe it names). Answer with a table: one row per entry, its fields as columns, and the page it came from in the last column. Leave a cell empty when the page does not give it.',
      },
      {
        id: 'deck', title: 'Deck from research', needs: ['workflow:rosa/deck', 'plan'],
        method: 'Read each source the request names. Write the research as slides: a title line for each slide, then two to four short bullets under it, each from a source. The last slide lists the sources.',
      },
    ],
    routines: [
      {
        id: 'market-map', name: 'Market map', needs: ['workflow:rosa/market-map', 'plan'],
        when: { kind: 'monthly', on: { week: 1, day: 1 }, at: '09:00' },
        work: { kind: 'plan', request: 'Update my market map: search for the players in the market I research, read their pages, and group them by category with one line and a source each.' },
      },
      {
        // Direct read over an event: code checks the page, no measured ability needed. The person sets the page.
        id: 'reg-watch', name: 'Regulation watch', needs: [],
        when: { kind: 'event', url: '', every: 1440 },
        work: { kind: 'read', urls: [] },
      },
    ],
    tools: ['search', 'read_page', 'mission', 'collect', 'draft', 'note', 'notify', 'read_my_tab', 'propose_routine', 'remember', 'doc_read', 'doc_write'],
    templates: [
      { type: 'research', name: 'Decision brief', template: 'Two sections: Evidence (one fact per line, with its source) and Assumptions. End with one recommendation.' },
    ],
  },
  {
    id: 'dana',
    name: 'Dana',
    role: 'Engineering and QA',
    look: { petals: 11, lean: 0.8 },
    instructions: 'You are Dana, a QA engineer. Report what you saw: the page, the step, the console error or failed request. Suggest a fix, never make one. File a bug only after the person approves it.',
    interview: [
      { q: 'What is your staging site?', placeholder: 'e.g. staging.example.com' },
      { q: 'Which flows matter most?', placeholder: 'e.g. sign up, checkout' },
      { q: 'Where do bugs get filed?', placeholder: 'e.g. Linear, GitHub issues' },
      { q: 'What should every bug report hold?', placeholder: 'e.g. steps, expected, actual' },
    ],
    sites: [],
    note: 'Her reads of console errors and failed requests are off: turn on DevTools in her Edit form.',
    skills: [
      {
        id: 'root-cause', title: 'Root cause from console and network', needs: ['workflow:dana/root-cause', 'plan'],
        method: 'Read the page the request names, with its console errors and failed requests. Name the most likely cause in one line, quote the error or request that shows it, and suggest a fix. Do not change anything.',
      },
      {
        id: 'docs-plan', title: 'Docs to a plan with gotchas', needs: ['workflow:dana/docs-plan', 'plan'],
        method: 'Read the docs the request names. Write a numbered implementation plan, then a "Gotchas" list: limits, deprecated calls and anything the docs warn about, each with its page.',
      },
    ],
    routines: [
      {
        id: 'smoke', name: 'Staging smoke test', needs: ['workflow:dana/smoke', 'plan'],
        when: { kind: 'weekly', days: [1, 2, 3, 4, 5], at: '06:00' },
        work: { kind: 'plan', request: 'Smoke-test the key flows on my staging site: open each one, do its steps, and report any step that failed with its console errors and failed requests.' },
      },
      {
        id: 'repro', name: 'Reproduce new bugs', needs: ['workflow:dana/repro', 'plan'],
        when: { kind: 'daily', at: '09:00' },
        work: { kind: 'plan', request: 'Read the new bug reports, try each one\'s steps on staging, and for each one that reproduces, file a bug in the connected tracker with steps, expected and actual.' },
      },
    ],
    // `act` only in its own tabs; never `act_my_tab`. Filing is an `app_call`, asked each time (ADR-17).
    tools: ['search', 'read_page', 'act', 'draft', 'note', 'notify', 'read_my_tab', 'app_call', 'propose_routine', 'remember', 'doc_read', 'doc_write'],
    templates: [
      { type: 'project', name: 'Bug report', template: 'Title, steps to reproduce, expected, actual, console errors, failed requests, page URL.' },
    ],
  },
];

export const presetById = (id: string | undefined): Preset | undefined => PRESETS.find((p) => p.id === id);

/** A direct read (or an event over one) needs no measured ability. */
export const direct = (w: Work): boolean => w.kind === 'read';

/** What is wrong with a preset; none when it is fine. Every seed that isn't direct work names its `workflow:` ability. */
export function presetProblems(p: Preset): string[] {
  const out: string[] = [];
  const tool = new Set(TOOLS.map((t) => t.name));
  if (!PETALS.includes(p.look.petals) || p.look.lean < 0.3 || p.look.lean > 1) out.push('look');
  if (p.interview.length > 8) out.push('interview');
  if (p.tools.some((t) => !tool.has(t))) out.push('tools');
  for (const s of p.skills) {
    if (!SKILL_NAME.test(s.id) || s.method.length > 6000) out.push(`skill ${s.id}`);
    if (!s.needs.includes(`workflow:${p.id}/${s.id}`)) out.push(`skill ${s.id} needs`);
  }
  for (const r of p.routines) {
    if (!parseRoutine({ v: 1, id: r.id, gardenerId: 'g', name: r.name, when: r.when, tz: 'UTC', work: r.work, paused: true, nextDue: 0, createdAt: 0 })) out.push(`routine ${r.id}`);
    if (direct(r.work) ? r.needs.length > 0 : !r.needs.includes(`workflow:${p.id}/${r.id}`)) out.push(`routine ${r.id} needs`);
  }
  return out;
}

/** The interview answers after the instructions (the person's words, so the instruction part), within 2000 chars. */
export function withProfile(instructions: string, profile: { q: string; a: string }[]): string {
  const said = profile.filter((x) => x.a.trim());
  if (!said.length) return instructions;
  return `${instructions.trim()}\n\nAbout the person:\n${said.map((x) => `- ${x.q} ${x.a.trim()}`).join('\n')}`.slice(0, 2000);
}

/**
 * What Hire stores: the gardener (sites only from the pack's suggestions), skills off, routines paused, template files
 * unkept, each seed's needs copied on. Skill names already taken get a number. Null when a record doesn't parse.
 */
export function hireRecords(p: Preset, o: { sites: string[]; taken: string[]; tz: string; now: number; id: () => string }):
  { gardener: Gardener; skills: Skill[]; routines: Routine[]; entities: Entity[] } | null {
  const { now, tz } = o;
  const gardener = parseGardener({ v: 1, id: o.id(), name: p.name, instructions: p.instructions, sites: p.sites.filter((x) => o.sites.includes(x)), minutes: 10, createdAt: now, look: p.look, preset: p.id });
  if (!gardener) return null;
  const taken = new Set(o.taken);
  const skills = p.skills.map((x) => {
    const name = [x.id, ...[2, 3, 4, 5, 6, 7, 8, 9].map((k) => `${x.id}-${k}`)].find((n) => !taken.has(n)) ?? `${x.id}-${now % 1000}`;
    taken.add(name);
    return parseSkill({ v: 1, id: o.id(), name, title: x.title, method: x.method, files: [], gardenerId: gardener.id, work: 'plan', version: 1,
      history: [{ version: 1, method: x.method, at: now, why: `From the ${p.name} pack` }], cases: [], by: 'preset', on: false, needs: x.needs, createdAt: now });
  });
  const routines = p.routines.map((x) => parseRoutine({ v: 1, id: o.id(), gardenerId: gardener.id, name: x.name, when: x.when, tz, work: x.work, paused: true, by: 'preset', needs: x.needs,
    nextDue: x.when.kind === 'event' || noPage(x.work) ? now : nextAfter(x.when, tz, null, now), createdAt: now }));
  // The pack's words are trusted like the person's once kept; unkept, a template joins no prompt.
  const entities: Entity[] = p.templates.map((t) => ({ v: 1, id: o.id(), type: t.type, name: t.name, aliases: [], fields: {}, body: '', template: t.template, gardenerId: gardener.id, by: 'person', confirmed: false, at: now }));
  if (skills.some((x) => !x) || routines.some((x) => !x)) return null;
  return { gardener, skills: skills as Skill[], routines: routines as Routine[], entities };
}
