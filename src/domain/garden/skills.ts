// Skills (plan T8): a method the person wrote or accepted, with files, run by slash command, by a routine or as a batch
// test. A model never changes a method: it only proposes one, which stays off until the person accepts it. Files are data.
import type { Ability } from '../model.ts';
import { defang } from '../text.ts';
import { correctionOf } from '../memory.ts';
import type { Chat } from '../chat.ts';
import type { GardenRun, Mention, Routine, Work } from './records.ts';

export interface SkillFile { name: string; text: string }
/** A test case. `runId`: its last test run; `pass`: code's verdict on `expect`, or the person's mark without one. */
export interface SkillCase { input: string; expect?: string; runId?: string; pass?: boolean }

export interface Skill {
  v: 1;
  id: string;
  /** The slash command. */
  name: string;
  title: string;
  method: string;
  files: SkillFile[];
  gardenerId?: string;
  /** The work kind a run of it is (`ask` only with `agent.loop`). */
  work: 'plan' | 'ask';
  version: number;
  /** One entry per version made, newest last. */
  history: { version: number; method: string; at: number; why: string }[];
  cases: SkillCase[];
  /** A model's edit, off until the person accepts it. */
  proposed?: { method: string; why: string; at: number };
  by: 'person' | 'model' | 'preset';
  on: boolean;
  needs?: Ability[];
  createdAt: number;
}

export const SKILL = { title: 80, method: 6000, files: 5, file: 20_000, history: 10, cases: 20, input: 1000, expect: 200 } as const;
export const SKILL_NAME = /^[a-z0-9-]{2,30}$/;
export const NEEDS = 'Needs a model measured for this workflow.';
export const EDIT_OFF = 'This needs a model measured for skill edits.';

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown, max: number, min = 1): x is string => typeof x === 'string' && x.trim().length >= min && x.length <= max;
const time = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function parseCase(raw: unknown): SkillCase | null {
  if (!isObj(raw) || !str(raw.input, SKILL.input) || (raw.expect !== undefined && !str(raw.expect, SKILL.expect))) return null;
  return { input: raw.input, ...(raw.expect !== undefined && { expect: raw.expect as string }), ...(str(raw.runId, 200) && { runId: raw.runId }), ...(typeof raw.pass === 'boolean' && { pass: raw.pass }) };
}

export function parseSkill(raw: unknown): Skill | null {
  if (!isObj(raw) || raw.v !== 1 || !str(raw.id, 200) || typeof raw.name !== 'string' || !SKILL_NAME.test(raw.name) || !str(raw.title, SKILL.title)) return null;
  if (!str(raw.method, SKILL.method) || (raw.work !== 'plan' && raw.work !== 'ask') || !Number.isInteger(raw.version) || !time(raw.createdAt) || typeof raw.on !== 'boolean') return null;
  if (raw.by !== 'person' && raw.by !== 'model' && raw.by !== 'preset') return null;
  if (!Array.isArray(raw.files) || raw.files.length > SKILL.files || !raw.files.every((f) => isObj(f) && str(f.name, 120) && str(f.text, SKILL.file, 0))) return null;
  const cases = Array.isArray(raw.cases) && raw.cases.length <= SKILL.cases ? raw.cases.map(parseCase) : [null];
  if (!cases.every((c) => c)) return null;
  if (!Array.isArray(raw.history) || !raw.history.every((x) => isObj(x) && Number.isInteger(x.version) && typeof x.method === 'string' && time(x.at) && typeof x.why === 'string')) return null;
  if (raw.gardenerId !== undefined && !str(raw.gardenerId, 200)) return null;
  if (raw.needs !== undefined && !(Array.isArray(raw.needs) && raw.needs.every((a) => typeof a === 'string'))) return null;
  const p = raw.proposed;
  if (p !== undefined && !(isObj(p) && str(p.method, SKILL.method) && typeof p.why === 'string' && time(p.at))) return null;
  return {
    v: 1, id: raw.id, name: raw.name, title: raw.title.trim(), method: raw.method, files: (raw.files as SkillFile[]).map(({ name, text }) => ({ name, text })),
    work: raw.work, version: raw.version as number, history: (raw.history as Skill['history']).slice(-SKILL.history), cases: cases as SkillCase[],
    by: raw.by, on: raw.on, createdAt: raw.createdAt,
    ...(raw.gardenerId !== undefined && { gardenerId: raw.gardenerId as string }), ...(raw.needs !== undefined && { needs: raw.needs as Ability[] }),
    ...(p !== undefined && { proposed: p as Skill['proposed'] & object }),
  };
}

/** `/name rest` → the skill and the rest; null when the text isn't a slash command; a string says why it can't run. */
export function slashOf(text: string, skills: Skill[]): { skill: Skill; rest: string } | string | null {
  const m = /^\/([a-z0-9-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  const skill = skills.find((s) => s.name === m[1]);
  if (!skill) return `No skill is called /${m[1]}.`;
  if (!skill.on) return `The skill /${skill.name} is off.`;
  return { skill, rest: (m[2] ?? '').trim() };
}

/** The work a skill's run does: its own kind, the request (its title when none is given), and the skill. */
export const skillWork = (s: Skill, request: string, tabs?: Mention[]): Work =>
  ({ kind: s.work, request: (request || s.title).slice(0, 1000), skillId: s.id, ...(tabs?.length && { tabs }) });

/** The needs a model lacks. */
export const unmet = (s: Pick<Skill, 'needs'>, has: (a: Ability) => boolean): Ability[] => (s.needs ?? []).filter((a) => !has(a));

/** A skill or routine can't be turned on, or a run of it start, while the model lacks a need (plan T12). */
export const needsRefusal = (x: Pick<Skill, 'needs'> | null | undefined, has: (a: Ability) => boolean): string | null => (x && unmet(x, has).length ? NEEDS : null);

/** Why a run of `skill` can't start (checked at pin, against the run's pinned abilities); null when it can. */
export function skillRefusal(run: GardenRun, skill: Skill | null | undefined): string | null {
  const id = run.work.kind === 'ask' || run.work.kind === 'plan' ? run.work.skillId : undefined;
  if (!id) return null;
  if (!skill) return 'Its skill was deleted.';
  if (!skill.on) return `The skill /${skill.name} is off.`;
  if (skill.gardenerId && skill.gardenerId !== run.gardenerId) return `/${skill.name} belongs to another gardener.`;
  return unmet(skill, (a) => !!run.abilities?.includes(a)).length ? NEEDS : null;
}

/**
 * A skill in a prompt: the method is the instruction (the person wrote or accepted it), after the gardener's; files are
 * data. A model's method is data too. Words not the person's are defanged.
 */
export function skillParts(s: Skill): { instruction: string; data: string } {
  const t = (x: string) => (s.by === 'person' ? x : defang(x));
  const method = s.by === 'model' ? [`A suggested way to do this (written by a model):\n${defang(s.method)}`] : [];
  return {
    instruction: s.by === 'model' ? '' : `How to do this (/${s.name}):\n${s.method.trim()}`,
    data: [...method, ...s.files.map((f) => `Skill file ${f.name}:\n${t(f.text)}`)].join('\n\n'),
  };
}

/** A new version: the method changes, history keeps the last 10, and any proposal is gone. */
export function revise(s: Skill, method: string, why: string, at: number): void {
  s.version++;
  s.method = method;
  s.history = [...s.history, { version: s.version, method, at, why }].slice(-SKILL.history);
  delete s.proposed;
}

/** Accept: the proposal becomes the method. False when there is none. */
export function accept(s: Skill, at: number): boolean {
  if (!s.proposed) return false;
  revise(s, s.proposed.method, s.proposed.why, at);
  return true;
}

/** A case passes when the answer holds `expect`, case-insensitive (code, no model). */
export const casePassed = (answer: string | undefined, expect: string): boolean => !!answer && answer.toLowerCase().includes(expect.trim().toLowerCase());

/** Code's verdict on a case whose test run ended: a failed run fails; a done run passes on `expect`. Undefined: not yet, or the person marks it. */
export function verdict(c: SkillCase, run: GardenRun | null | undefined): boolean | undefined {
  if (!run || !['done', 'failed', 'stopped'].includes(run.status)) return undefined;
  if (run.status !== 'done') return false;
  return c.expect === undefined ? undefined : casePassed(run.answer, c.expect);
}

/** A skill with no passed case is "Not tested yet" (a nudge, not a block). */
export const tested = (s: Skill): boolean => s.cases.some((c) => c.pass === true);

export interface Evidence { kind: 'down' | 'correction' | 'case'; input: string; answer: string; note?: string }

/**
 * What went wrong with a skill: chat answers marked "Not helpful", a correction written right after one (T7's rule),
 * and failed test cases. Newest last, at most 10.
 */
export function evidenceOf(s: Skill, chats: Chat[], runs: GardenRun[]): Evidence[] {
  const out: Evidence[] = [];
  for (const c of chats) {
    c.turns.forEach((t, i) => {
      const a = c.turns[i + 1];
      if (t.role !== 'user' || t.skillId !== s.id || a?.role !== 'model' || a.error || a.partial) return;
      const input = t.label ?? t.text;
      if (a.feedback === 'down') out.push({ kind: 'down', input, answer: a.text });
      const next = c.turns[i + 2];
      const said = next?.role === 'user' ? correctionOf(next.label ?? next.text) : null;
      if (said) out.push({ kind: 'correction', input, answer: a.text, note: said });
    });
  }
  for (const k of s.cases) {
    const r = k.pass === false && k.runId ? runs.find((x) => x.id === k.runId) : undefined;
    if (r) out.push({ kind: 'case', input: k.input, answer: r.answer ?? r.why ?? '', ...(k.expect && { note: `Expected it to contain "${k.expect}".` }) });
  }
  return out.slice(-10);
}

/** The `improve` think: the method is the instruction, the evidence is data (the answers are model text). */
export function improveThink(s: Skill, ev: Evidence[], room: number): { prompt: string; data: string } {
  const prompt = `You improve a skill: a method an assistant follows for one kind of task.\nThe method now:\n${s.method.trim()}\n\nBelow are cases where it went wrong. Rewrite the method so these go right and what worked still does. Reply with only the new method, at most ${SKILL.method} characters.`;
  const data = ev.map((e, i) => [`Case ${i + 1} (${e.kind === 'down' ? 'marked not helpful' : e.kind === 'case' ? 'failed a test' : 'corrected'}):`,
    `Request: ${defang(e.input)}`, `Answer: ${defang(e.answer).slice(0, 1500)}`, ...(e.note ? [`The person: ${e.note}`] : [])].join('\n')).join('\n\n');
  return { prompt, data: data.slice(0, Math.max(0, room - prompt.length)) };
}

/** A model's reply as a proposed method: fences removed; null when empty or too long. */
export function proposalOf(reply: string): string | null {
  const m = reply.trim().replace(/^```[a-z]*\n?([\s\S]*?)\n?```$/i, '$1').trim();
  return m && m.length <= SKILL.method ? m : null;
}

/** Deleting a skill pauses the routines that link it (they keep the link, and a run of one says the skill is gone). */
export const unlinked = (routines: Routine[], skillId: string): Routine[] => routines.filter((r) => r.skillId === skillId && !r.paused).map((r) => ({ ...r, paused: true }));

/** `hg-garden`: v1 gardeners, routines, runs and snapshots; v2 adds `skills`. Each step runs once, so v1 data stays. */
export function upgradeGarden(d: Pick<IDBDatabase, 'createObjectStore'>, old: number): void {
  if (old < 1) {
    d.createObjectStore('gardeners', { keyPath: 'id' });
    d.createObjectStore('routines', { keyPath: 'id' });
    const runs = d.createObjectStore('runs', { keyPath: 'id' });
    for (const k of ['gardenerId', 'routineId', 'status']) runs.createIndex(k, k);
    d.createObjectStore('snapshots'); // `${routineId}\n${url}` → { text, prev, runId }
  }
  if (old < 2) d.createObjectStore('skills', { keyPath: 'id' });
}
