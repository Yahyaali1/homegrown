// Meetings: a recorded call's lines, merged by time as "You" (the mic) and "Them" (the tab), saved as a doc
// under Meetings/ with an `event` entity. Notes (summary, decisions, action items) come from a model measured
// for `notes` only; owners are kept only when the transcript names them.
import { clock } from './captions.ts';
import { MEM } from './memory.ts';

export type Who = 'You' | 'Them';
/** One recognised window: `at` and `end` in ms from the start of the recording. A file has no speaker. */
export interface Line { who?: Who; at: number; end: number; text: string }

export const MEETING_HOSTS = ['meet.google.com', 'zoom.us', 'teams.microsoft.com', 'teams.live.com'] as const;
/** A call page: one of the hosts, or a subdomain of zoom.us (us02web.zoom.us). */
export const isMeetingHost = (host: string): boolean => {
  const h = host.toLowerCase();
  return MEETING_HOSTS.includes(h as (typeof MEETING_HOSTS)[number]) || h.endsWith('.zoom.us');
};

export const WINDOW_MS = 20_000;
const JOIN_GAP_MS = 2_000;

/** Lines in time order; one speaker's lines that follow each other within a short gap become one. */
export function mergeLines(lines: Line[], gap = JOIN_GAP_MS): Line[] {
  const out: Line[] = [];
  for (const l of [...lines].sort((a, b) => a.at - b.at)) {
    const last = out.at(-1);
    if (last && last.who === l.who && l.at - last.end <= gap) (last.text = `${last.text} ${l.text}`), (last.end = Math.max(last.end, l.end));
    else out.push({ ...l });
  }
  return out;
}

export const transcriptOf = (lines: Line[]): string => lines.map((l) => `[${clock(l.at)}] ${l.who ? `${l.who}: ` : ''}${l.text}`).join('\n');

/** Text cut at line ends into pieces a doc can hold (≤ MEM.doc). */
export function pieces(text: string, max: number = MEM.doc): string[] {
  const out = [''];
  for (const line of text.split('\n')) {
    const l = line.slice(0, max - 1);
    if (out.at(-1)!.length + l.length + 1 > max) out.push('');
    out[out.length - 1] += `${out.at(-1) ? '\n' : ''}${l}`;
  }
  return out.filter(Boolean);
}

const two = (n: number) => String(n).padStart(2, '0');
/** "2026-10-30 14:05 Weekly sync": the meeting's name (≤ 80), from its start and the tab's title. */
export function meetingName(start: Date, title: string): string {
  const t = title.replace(/[\\/\0-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Meeting';
  return `${start.getFullYear()}-${two(start.getMonth() + 1)}-${two(start.getDate())} ${two(start.getHours())}:${two(start.getMinutes())} ${t}`.slice(0, MEM.name).trim();
}
export const meetingPath = (name: string, part = 1) => `Meetings/${name}${part > 1 ? ` (part ${part})` : ''}.md`;
export const isMeetingPath = (path: string) => /^Meetings\//.test(path);
/** "Meetings/2026-10-30 14:05 Sync (part 2).md" → "2026-10-30 14:05 Sync". */
export const meetingOf = (path: string) => path.replace(/^Meetings\//, '').replace(/( \(part \d+\))?\.md$/, '');
const partOf = (path: string) => Number(/ \(part (\d+)\)\.md$/.exec(path)?.[1] ?? 1);
/** The person's transcript docs of the meeting `name`, in part order. */
export const docsOfMeeting = <D extends { path: string; gardenerId?: string }>(docs: D[], name: string): D[] =>
  docs.filter((d) => !d.gardenerId && isMeetingPath(d.path) && meetingOf(d.path) === name).sort((a, b) => partOf(a.path) - partOf(b.path));

/** The call being recorded (chrome.storage.session `meeting`); `lines` are those heard so far, kept should the recorder die. */
export interface Recording { tabId: number; host: string; title: string; started: number; mic: boolean; lines?: Line[]; failed?: number }

/** The transcript's parts of about 20 minutes each, for the notes' map step. */
export function timeParts(lines: Line[], span = 20 * 60_000): Line[][] {
  const out: Line[][] = [];
  for (const l of lines) (out[Math.floor(l.at / span)] ??= []).push(l);
  return out.filter(Boolean);
}

export interface Notes { summary: string; decisions: string[]; actions: { item: string; owner?: string }[] }

export const NOTES_PROMPT = 'The data is part of a meeting transcript. "You" is the person who recorded it; "Them" is everyone else on the call. '
  + 'Reply with only a JSON object: {"summary": "2 to 4 sentences", "decisions": ["each decision that was made"], '
  + '"actions": [{"item": "what is to be done", "owner": "who does it, exactly as the transcript names them, or \\"\\""}]}. '
  + 'Use only what the transcript says. An empty list is fine.';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const named = (who: string, transcript: string) => /^you$/i.test(who) || (!/^them$/i.test(who) && new RegExp(`(?<![\\p{L}\\p{N}])${escape(who)}(?![\\p{L}\\p{N}])`, 'iu').test(transcript));
const strs = (x: unknown) => (Array.isArray(x) ? x : []).filter((s): s is string => typeof s === 'string' && !!s.trim()).map((s) => s.trim().slice(0, 500));

/** A notes reply, or null. An owner the transcript doesn't name is dropped (the item stays, with no owner). */
export function parseNotes(o: Record<string, unknown> | null, transcript: string): Notes | null {
  if (!o || typeof o.summary !== 'string') return null;
  const actions = (Array.isArray(o.actions) ? o.actions : []).flatMap((a: unknown) => {
    const x = (a ?? {}) as { item?: unknown; owner?: unknown };
    if (typeof x.item !== 'string' || !x.item.trim()) return [];
    const owner = typeof x.owner === 'string' ? x.owner.trim() : '';
    return [{ item: x.item.trim().slice(0, 500), ...(owner && named(owner, transcript) && { owner: /^you$/i.test(owner) ? 'You' : owner.slice(0, 80) }) }];
  });
  return { summary: o.summary.trim().slice(0, 2000), decisions: strs(o.decisions), actions };
}

/** The reduce step, in code: the parts' summaries in order, every decision and action item once. */
export function mergeNotes(parts: Notes[]): Notes {
  const once = <T>(xs: T[], key: (x: T) => string) => xs.filter((x, i) => xs.findIndex((y) => key(y) === key(x)) === i);
  return {
    summary: parts.map((p) => p.summary).filter(Boolean).join(' '),
    decisions: once(parts.flatMap((p) => p.decisions), (d) => d.toLowerCase()),
    actions: once(parts.flatMap((p) => p.actions), (a) => a.item.toLowerCase()),
  };
}

/** The entity body: markdown, action items as a checklist. */
export const notesBody = (n: Notes): string => [
  '## Summary', n.summary || '—',
  '## Decisions', ...(n.decisions.length ? n.decisions.map((d) => `- ${d}`) : ['—']),
  '## Action items', ...(n.actions.length ? n.actions.map((a) => `- [ ] ${a.item}${a.owner ? ` — ${a.owner}` : ''}`) : ['—']),
].join('\n');

const ITEM = /^- \[( |x)\] (.*)$/;
export const itemsOf = (body: string) => body.split('\n').map((l) => ITEM.exec(l)).filter((m) => !!m).map((m) => ({ done: m[1] === 'x', text: m[2]! }));
/** The body without its checklist: the summary and decisions. */
export const notesOf = (body: string) => body.split('\n').filter((l) => !ITEM.test(l)).join('\n').trim();
/** The body with the n-th checklist item ticked or not. */
export function checkItem(body: string, n: number, done: boolean): string {
  let i = -1;
  return body.split('\n').map((l) => (ITEM.test(l) && ++i === n ? l.replace(ITEM, `- [${done ? 'x' : ' '}] $2`) : l)).join('\n');
}

export const NO_NOTES = 'Transcript only: this needs a model measured for meeting notes.';

/** Ask across meetings (Library and chat's `/meetings`): the question is the person's; the transcript parts are data. */
export const meetingsAsk = (question: string) =>
  `Answer the question using only the meeting transcript parts in the data. Cite them like [1], and name the meeting and time. If they don't answer it, say so.\nQuestion: ${question}`;
export const leftOut = (n: number) => (n ? `(Only the newest meetings were searched; ${n} older ${n === 1 ? 'one was' : 'ones were'} left out.)` : '');

/** The saved transcript: its lines, after a line saying how many windows the speech model failed on. */
export const meetingText = (lines: Line[], failed = 0): string =>
  [failed ? `(${failed} window${failed === 1 ? '' : 's'} of 20 s could not be transcribed.)` : '', transcriptOf(lines) || '(No speech was heard.)'].filter(Boolean).join('\n');

/** The recording stops when the call's tab goes to another host (or leaves the web). */
export const leftCall = (host: string, url: string | undefined): boolean => {
  if (url === undefined) return false;
  try {
    return new URL(url).hostname !== host;
  } catch {
    return true;
  }
};

/** The newest meetings' chunks first, at most `cap`; `left` counts meetings with no chunk kept. */
export function newestChunks<D extends { id: string; path: string; at: number }, C>(docs: D[], cap: number, chunk: (d: D) => C[]): { items: C[]; left: number } {
  const items: C[] = [];
  const kept = new Set<string>();
  for (const d of [...docs].sort((a, b) => b.at - a.at)) {
    const room = cap - items.length;
    if (room <= 0) break;
    items.push(...chunk(d).slice(0, room));
    kept.add(meetingOf(d.path));
  }
  const all = new Set(docs.map((d) => meetingOf(d.path)));
  return { items, left: [...all].filter((m) => !kept.has(m)).length };
}

/**
 * Runs jobs one at a time. With `max` jobs already in it, `add` refuses (false): a recorder that falls behind drops
 * windows instead of growing a backlog that Stop would wait on.
 */
export function serial(max: number): { add(job: () => Promise<void>): boolean; idle(): Promise<void> } {
  let tail = Promise.resolve();
  let size = 0;
  return {
    add(job) {
      if (size >= max) return false;
      size++;
      tail = tail.then(job).catch(() => {}).finally(() => void size--);
      return true;
    },
    idle: () => tail,
  };
}

/**
 * Transcribe a file: decoded whole by the recorder at 16 kHz, so its size and length are capped (2 hours of stereo is
 * about 900 MB of samples).
 */
export const FILE_MAX_BYTES = 100 << 20;
export const FILE_MAX_MS = 2 * 3600_000;
export const fileRefused = (bytes: number, ms?: number): string | null =>
  bytes > FILE_MAX_BYTES ? 'That file is over 100 MB. Cut it into shorter parts first.'
    : ms !== undefined && ms > FILE_MAX_MS ? 'That recording is over 2 hours. Cut it into shorter parts first.' : null;
