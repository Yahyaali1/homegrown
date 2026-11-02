// Skills: extension pages only; a model never writes a method, it only proposes one.
import { askAs, engine } from './engine.ts';
import * as idb from '../shared/idb.ts';
import { pagesOnly } from './pagerequest.ts';
import { allRuns, db, getSkill, mustGardener, ready, routines, saveRun, skills, updateSkill } from './garden-store.ts';
import { drain, gardensModel } from './garden-queue.ts';
import { arm } from './garden-routines.ts';
import { parseChat, type Chat } from '../domain/chat.ts';
import { can, DEFAULT_AGENT, modelById } from '../domain/model.ts';
import { refusal } from '../domain/garden/loop.ts';
import { newRun, requestOf, type Work } from '../domain/garden/records.ts';
import { accept, EDIT_OFF, evidenceOf, improveThink, NEEDS, parseSkill, proposalOf, revise, SKILL, skillRefusal, skillWork, unlinked, unmet, verdict, type Skill } from '../domain/garden/skills.ts';
import { contextChars } from '../domain/text.ts';

/** Why the gardens model `model` can't take this work, as a run of it would be refused when pinned: its kind or its skill. */
export async function refusedWork(w: Work, gardenerId: string, model: string): Promise<string | null> {
  const spec = modelById(model);
  const stub = { ...newRun({ id: '', gardenerId, work: w, now: 0 }), agent: spec?.agent ?? DEFAULT_AGENT, abilities: spec?.abilities ?? [] };
  const id = requestOf(w)?.skillId;
  return (id ? skillRefusal(stub, await getSkill(id)) : null) ?? refusal(stub);
}

/** The side panel's chats, for a skill's evidence. Opened per read and closed, so the worker never blocks a version change or delete. */
async function allChats(): Promise<Chat[]> {
  const d = await idb.openChats();
  try {
    return (await idb.all<unknown>(d, 'chats')).map(parseChat).filter((c): c is Chat => !!c);
  } finally {
    d.close();
  }
}

const mustSkill = async (id: string): Promise<Skill> => {
  const s = await getSkill(String(id));
  if (!s) throw new Error('That skill no longer exists.');
  return s;
};

/** Deleting a skill pauses the routines that link it. */
export async function deleteSkill(id: string): Promise<void> {
  for (const r of unlinked(await routines(), id)) {
    await idb.put(await db, 'routines', r);
    await arm(r);
  }
  await idb.del(await db, 'skills', id);
}

export const skillHandlers = pagesOnly({
  /** Every skill; a test case whose run ended gets code's verdict here. */
  skillList: async () => {
    await ready();
    const runs = new Map((await allRuns()).map((r) => [r.id, r]));
    const out: Skill[] = [];
    for (const s of await skills()) {
      const settle = s.cases.some((c) => c.runId && c.pass === undefined && verdict(c, runs.get(c.runId)) !== undefined);
      out.push(settle ? await updateSkill(s.id, (x) => x.cases.forEach((c) => {
        const v = c.runId && c.pass === undefined ? verdict(c, runs.get(c.runId)) : undefined;
        if (v !== undefined) c.pass = v;
      })) : s);
    }
    return out;
  },
  /**
   * The person's skill: new ones are theirs and on. A changed method is a new version. Who wrote it, its needs, history
   * and proposal stay the worker's; a case keeps its result while its input and expect are unchanged.
   */
  skillSave: async ({ skill }: { skill: Partial<Skill> }) => {
    await ready();
    if (skill.gardenerId) await mustGardener(String(skill.gardenerId));
    const all = await skills();
    const old = skill.id ? all.find((x) => x.id === skill.id) : undefined;
    if (skill.id && !old) throw new Error('That skill no longer exists.');
    if (all.some((x) => x.name === skill.name && x.id !== skill.id)) throw new Error(`There is already a /${skill.name}.`);
    const now = Date.now();
    const cases = (Array.isArray(skill.cases) ? skill.cases : []).map(({ input, expect }) => {
      const was = old?.cases.find((c) => c.input === input && c.expect === expect);
      return { ...was, input, ...(expect?.trim() && { expect: expect.trim() }) };
    });
    const method = String(skill.method ?? '');
    const s = parseSkill({
      v: 1, version: 1, history: [{ version: 1, method, at: now, why: 'Written by you' }], by: 'person', createdAt: now, ...old,
      id: old?.id ?? crypto.randomUUID(), name: skill.name, title: skill.title, method: old?.method ?? method, files: skill.files ?? old?.files ?? [], work: skill.work ?? old?.work ?? 'plan',
      cases, on: skill.on ?? old?.on ?? true, ...(skill.gardenerId ? { gardenerId: skill.gardenerId } : { gardenerId: undefined }),
    });
    if (!s) throw new Error(`A skill needs a name (2–30 of a–z, 0–9, -), a title, a method up to ${SKILL.method} characters, at most ${SKILL.files} files of ${SKILL.file} and ${SKILL.cases} cases.`);
    if (old && method !== old.method) {
      if (!method.trim() || method.length > SKILL.method) throw new Error(`A method is 1 to ${SKILL.method} characters.`);
      revise(s, method, 'Edited by you', now);
      if (s.by === 'model') s.by = 'person'; // the person's words now
    }
    const model = s.on && s.needs?.length ? await gardensModel() : '';
    if (s.on && unmet(s, (a) => can(model, a)).length) throw new Error(NEEDS);
    await idb.put(await db, 'skills', s);
    return s;
  },
  skillDelete: async ({ id }: { id: string }) => (await ready(), await deleteSkill(String(id)), true),
  skillEvidence: async ({ id }: { id: string }) => {
    await ready();
    return evidenceOf(await mustSkill(id), await allChats().catch(() => []), await allRuns());
  },
  /** Suggest an edit: one `improve` think, only with a model measured for skill edits. The reply is a proposal, off until accepted. */
  skillPropose: async ({ id }: { id: string }) => {
    await ready();
    const s = await mustSkill(id);
    const model = await gardensModel();
    if (!can(model, 'skillEdit')) throw new Error(EDIT_OFF);
    const ev = evidenceOf(s, await allChats().catch(() => []), await allRuns());
    if (!ev.length) throw new Error('Nothing went wrong with this skill yet: there is no evidence to learn from.');
    const m = await engine<{ name: string; maxTokens: number }>('resolve', { name: model });
    const t = improveThink(s, ev, contextChars(m.maxTokens));
    const method = proposalOf((await askAs(t.prompt, t.data, { task: 'gardens', model: m.name, owner: 'garden', sampling: { temperature: 0 } })).text);
    if (!method) throw new Error('The model’s edit couldn’t be used.');
    return updateSkill(s.id, (x) => void (x.proposed = { method, why: `From ${ev.length} case${ev.length === 1 ? '' : 's'} that went wrong`, at: Date.now() }));
  },
  /** `{ id, accept }`: yes moves the proposal into the method (a new version); no drops it. */
  skillAccept: async ({ id, accept: yes }: { id: string; accept: boolean }) => {
    await ready();
    return updateSkill(String(id), (s) => {
      if (!s.proposed) throw new Error('There is no proposed edit.');
      if (yes) accept(s, Date.now());
      else delete s.proposed;
    });
  },
  /**
   * Test on cases: one hand run per case, queued in order (the queue runs one at a time). `approvePlans`: each plan
   * gets a yes, which covers only non-sensitive calls. Refused for a skill that is off or whose needs the model lacks.
   */
  skillTest: async ({ id, gardenerId, approvePlans }: { id: string; gardenerId?: string; approvePlans?: boolean }) => {
    await ready();
    const s = await mustSkill(id);
    if (!s.cases.length) throw new Error('Add a case to test first.');
    const g = await mustGardener(s.gardenerId ?? String(gardenerId ?? ''));
    const why = await refusedWork(skillWork(s, ''), g.id, await gardensModel());
    if (why) throw new Error(why);
    const now = Date.now();
    const made = s.cases.map((c, k) => ({ ...newRun({ id: crypto.randomUUID(), gardenerId: g.id, work: skillWork(s, c.input), now: now + k }), ...(approvePlans && { approvePlans: true as const }) }));
    for (const r of made) await saveRun(r);
    await updateSkill(s.id, (x) => x.cases.forEach((c, k) => {
      delete c.pass;
      if (made[k]) c.runId = made[k]!.id;
    }));
    drain();
    return made.map((r) => r.id);
  },
  /** The person's pass or fail on a tested case without `expect`. */
  skillMark: async ({ id, k, pass }: { id: string; k: number; pass: boolean }) => {
    await ready();
    return updateSkill(String(id), (s) => {
      const c = s.cases[Number(k)];
      if (!c?.runId) throw new Error('That case hasn’t run yet.');
      c.pass = !!pass;
    });
  },
});
