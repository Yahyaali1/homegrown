// Saved chats: the record kept in IndexedDB `hg-chat`, and the pure rules the side panel's chat uses.
import { contextChars } from './text.ts';
import { correctionOf } from './memory.ts';
import { appNamed, type App } from './apps.ts';
import { NEEDS, skillParts, slashOf, unmet, type Skill } from './garden/skills.ts';
import { mayBeSetting } from './settings.ts';
import type { Ability } from './model.ts';

export type Mode = 'plan' | 'smart' | 'fast';
export interface ChatTurn {
  role: 'user' | 'model';
  /** What the model gets (a user turn) or wrote (a model turn). */
  text: string;
  at: number;
  /** What the chat shows for a user turn, when it differs from `text` (a template, a selection). */
  label?: string;
  selection?: string;
  feedback?: 'up' | 'down';
  error?: string;
  /** Saved while it streamed; still set on load means it was cut off. */
  partial?: true;
  /** A user turn sent as `/name …`: the skill it ran, so feedback on the answer is that skill's evidence. */
  skillId?: string;
}
export interface Chat { v: 1; id: string; title: string; mode: Mode; model: string; turns: ChatTurn[]; forkedFrom?: string; createdAt: number; updatedAt: number }

/** One question of a question block (`ui/questions.ts` asks them). */
export interface Question { q: string; options?: string[]; placeholder?: string }

export const MODES: Mode[] = ['plan', 'smart', 'fast'];

/** Fast: the smallest downloaded model. Smart and Plan: the largest. '' when none is downloaded. */
export function modeModel(mode: Mode, downloaded: { id: string; sizeBytes: number }[]): string {
  const sorted = [...downloaded].sort((a, b) => a.sizeBytes - b.sizeBytes);
  return (mode === 'fast' ? sorted[0] : sorted.at(-1))?.id ?? '';
}

const chars = (c: Chat) => c.turns.reduce((n, t) => n + t.text.length + (t.selection?.length ?? 0), 0);
/** Past 70 % of the pinned model's character budget, early parts may fall out of its context. */
export const isLong = (c: Chat, maxTokens: number): boolean => chars(c) > 0.7 * contextChars(maxTokens);

/** A stored record, or null. Turns that aren't turns are dropped; `partial` is kept, so the chat shows "Interrupted". */
export function parseChat(raw: unknown): Chat | null {
  const c = raw as Partial<Chat> | null;
  if (!c || c.v !== 1 || typeof c.id !== 'string' || !Array.isArray(c.turns)) return null;
  const turns = c.turns.filter((t): t is ChatTurn => !!t && (t.role === 'user' || t.role === 'model') && typeof t.text === 'string');
  return { ...c, turns, title: String(c.title ?? ''), mode: MODES.includes(c.mode!) ? c.mode! : 'fast', model: String(c.model ?? '') } as Chat;
}

export const interrupted = (c: Chat): boolean => c.turns.at(-1)?.partial === true;

/** A new chat holding the turns up to and including `upto`. */
export function duplicate(c: Chat, upto: number, id: string, now: number): Chat {
  const turns = c.turns.slice(0, upto + 1).map(({ partial: _, ...t }) => t);
  return { ...c, id, title: `${c.title} (copy)`, turns, forkedFrom: c.id, createdAt: now, updatedAt: now };
}

/** Puts each turn in place of the stored turn with the same `at` and role, or adds it, keeping time order. */
export function upsertTurns(c: Chat, turns: ChatTurn[]): void {
  for (const t of turns) {
    const i = c.turns.findIndex((x) => x.at === t.at && x.role === t.role);
    if (i >= 0) c.turns[i] = t;
    else c.turns.splice(c.turns.filter((x) => x.at <= t.at).length, 0, t);
  }
}

/** Drops the turn at `at` (that role) and every later one: a retry. */
export function dropFrom(c: Chat, t: Pick<ChatTurn, 'at' | 'role'>): void {
  const i = c.turns.findIndex((x) => x.at === t.at && x.role === t.role);
  if (i >= 0) c.turns.splice(i);
}

/** Plan mode asks for a plan only on a chat's first message; "Go" and answers go as they are. */
export const planFirst = (c: Chat): boolean => c.mode === 'plan' && !c.turns.some((t) => t.role === 'user');

export const titleOf = (text: string): string => (text.length > 60 ? `${text.slice(0, 60).trimEnd()}…` : text) || 'New chat';

/** The engine's history: no errors and no cut-off turns. */
export const engineTurns = (c: Chat) => c.turns.filter((t) => !t.error && !t.partial)
  .map((t) => ({ role: t.role, text: t.text, ...(t.selection !== undefined && { selection: t.selection }) }));

/** Case-insensitive search over titles and turns, newest first. */
export function searchChats(chats: Chat[], q: string): Chat[] {
  const s = q.trim().toLowerCase();
  const hit = (c: Chat) => !s || c.title.toLowerCase().includes(s) || c.turns.some((t) => (t.label ?? t.text).toLowerCase().includes(s));
  return chats.filter(hit).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** `text` split around each case-insensitive match of `q`: the UI makes text nodes and `<mark>`s from it. */
export function highlightParts(text: string, q: string): { text: string; mark: boolean }[] {
  const s = q.trim().toLowerCase();
  if (!s) return [{ text, mark: false }];
  const out: { text: string; mark: boolean }[] = [];
  const low = text.toLowerCase();
  let i = 0;
  for (let j = low.indexOf(s); j !== -1; j = low.indexOf(s, i)) {
    if (j > i) out.push({ text: text.slice(i, j), mark: false });
    out.push({ text: text.slice(j, j + s.length), mark: true });
    i = j + s.length;
  }
  if (i < text.length) out.push({ text: text.slice(i), mark: false });
  return out;
}

/** A fenced ```questions block of `[{ q, options? }]`; bad JSON (or none) gives null and the reply shows as text. */
export function questionBlock(text: string): { questions: Question[]; rest: string } | null {
  const m = /```questions\s*\n([\s\S]*?)```/.exec(text);
  if (!m) return null;
  try {
    const list = JSON.parse(m[1]!) as unknown;
    if (!Array.isArray(list) || !list.length) return null;
    const questions = list.map((x) => ({ q: String(x?.q ?? '').slice(0, 300), ...(Array.isArray(x?.options) && { options: x.options.slice(0, 6).map((o: unknown) => String(o).slice(0, 80)) }) }));
    return questions.every((x) => x.q) ? { questions, rest: text.replace(m[0], '').trim() } : null;
  } catch {
    return null;
  }
}

/** A leading `<think>…</think>` part, if the runtime passed the model's reasoning through. */
export function splitThinking(text: string): { thinking: string; text: string } {
  const m = /^\s*<think>([\s\S]*?)(?:<\/think>|$)/.exec(text);
  return m ? { thinking: m[1]!.trim(), text: text.slice(m[0].length).trimStart() } : { thinking: '', text };
}

/** A local report of a chat with an error: no message text, only its shape and the error words. */
export const chatReport = (c: Chat, version = '') => ({
  version, id: c.id, mode: c.mode, model: c.model, createdAt: c.createdAt,
  turns: c.turns.map((t) => ({ role: t.role, at: t.at, chars: t.text.length, ...(t.error && { error: t.error }), ...(t.partial && { partial: true }) })),
});

/** A message that corrects an earlier answer ("no", "don't", "never", "always"): offered as "Remember this?". */
export const chatCorrection = (c: Chat, text: string): string | null => (c.turns.some((t) => t.role === 'model' && !t.error) ? correctionOf(text) : null);

export const excerpt = (t: string, n = 140) => (t.length > n ? `${t.slice(0, n)}…` : t);

type Hit = { skill: Skill; rest: string };
export type Route =
  | { kind: 'connect'; app: App }
  | { kind: 'error'; why: string }
  | { kind: 'meetings'; question: string }
  /** A short plain message that may ask to change a setting: the model decides, the person confirms. */
  | { kind: 'setting' }
  | { kind: 'send'; skill?: Hit };

/**
 * Where a typed message goes. "connect <app>" opens the Connect form (no model); `/name rest` runs a skill that is on
 * and whose needs the chat's model meets; `/meetings question` (no skill of that name) asks across meetings.
 */
export function route(typed: string, c: { template: boolean; image: boolean; attached: boolean; skills: Skill[]; can: (a: Ability) => boolean }): Route {
  const plain = !c.template && !c.image;
  const app = plain ? appNamed(/^connect\s+(.{1,60})$/i.exec(typed)?.[1] ?? '') : null;
  if (app) return { kind: 'connect', app };
  const hit = !c.template && typed.startsWith('/') ? slashOf(typed, c.skills) : null;
  if (typeof hit === 'string') {
    const question = /^\/meetings\s+([\s\S]+)$/.exec(typed)?.[1];
    return question ? { kind: 'meetings', question } : { kind: 'error', why: hit };
  }
  if (hit) return unmet(hit.skill, c.can).length ? { kind: 'error', why: NEEDS } : { kind: 'send', skill: hit };
  return plain && !c.attached && typed.length < 240 && mayBeSetting(typed) ? { kind: 'setting' } : { kind: 'send' };
}

const PLAN_FIRST = 'First write a short plan for this request as numbered steps, then stop and wait for me to say Go. Do not do the steps yet.';

/**
 * The person's turn: what the model gets, what the chat shows, and the data part (an attached selection, `@` memory
 * files, a skill's files). A Prompt Lab template wraps the typed text.
 */
export function userTurn(typed: string, o: { at: number; template?: { title: string; build(t: string, option: string): string }; option?: string;
  attached: string | null; image: boolean; refs?: string; skill?: Hit }): ChatTurn {
  const skill = o.skill && { ...skillParts(o.skill.skill), rest: o.skill.rest || o.skill.skill.title };
  const asked = typed || 'Describe this image.';
  const text = skill ? [skill.instruction, skill.rest].filter(Boolean).join('\n\n') : o.template ? o.template.build(typed, o.option ?? '') : asked;
  const label = [o.template ? `${o.template.title}: ${typed}` : asked, o.attached !== null ? `“${excerpt(o.attached)}”` : '', o.image ? '(image)' : ''].filter(Boolean).join('\n');
  const data = [o.attached ?? '', o.refs ?? '', skill?.data ?? ''].filter(Boolean).join('\n\n');
  return { role: 'user', text, label, at: o.at, ...((o.attached !== null || data) && { selection: data }), ...(o.skill && { skillId: o.skill.skill.id }) };
}

/** A chat's first message: plan mode's ask for a plan, then a companion's instructions, lead the text. */
export function withLead(c: Chat, turn: ChatTurn, persona: string | null): ChatTurn {
  const lead = [planFirst(c) ? PLAN_FIRST : null, persona].filter(Boolean);
  return lead.length ? { ...turn, label: turn.label ?? turn.text, text: [...lead, turn.text].join('\n\n') } : turn;
}
