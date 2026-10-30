// Saved chats (plan T6): the record kept in IndexedDB `hg-chat`, and the pure rules the side panel's chat uses.
import { contextChars } from './text.ts';

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
}
export interface Chat { v: 1; id: string; title: string; mode: Mode; model: string; turns: ChatTurn[]; forkedFrom?: string; createdAt: number; updatedAt: number }

/** The shape `ui/questions.ts` asks. */
export interface Question { q: string; options?: string[] }

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
