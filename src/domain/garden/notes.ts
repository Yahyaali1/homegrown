// The gardeners' notebook (docs/plan/S-gardeners.md, V4), kept in eg-memory's `notes` store by background/memory.ts.
// A note is the person's (by: 'person') or one a gardener took in a run (by: { runId, url }). Notes are private and,
// for a model's, page-derived: they reach a model only in the data part of a think, labelled, and taint the run.
import { defang, hostOf } from '../text.ts';

export interface Note {
  v: 1;
  id: string;
  /** Absent: shared by every gardener. */
  gardenerId?: string;
  text: string;
  by: 'person' | { runId: string; url: string };
  at: number;
  /** Filled lazily, as kb and highlights are. */
  vec?: number[];
}

export const NOTE_CHARS = 500;

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

export function parseNote(raw: unknown): Note | null {
  if (!isObj(raw) || raw.v !== 1 || typeof raw.id !== 'string' || !raw.id || typeof raw.at !== 'number') return null;
  if (typeof raw.text !== 'string' || !raw.text.trim() || raw.text.length > NOTE_CHARS) return null;
  if (raw.gardenerId !== undefined && (typeof raw.gardenerId !== 'string' || !raw.gardenerId)) return null;
  const by = raw.by;
  if (by !== 'person' && !(isObj(by) && typeof by.runId === 'string' && typeof by.url === 'string')) return null;
  const n: Note = { v: 1, id: raw.id, text: raw.text, by: by === 'person' ? by : { runId: by.runId as string, url: by.url as string }, at: raw.at };
  if (typeof raw.gardenerId === 'string') n.gardenerId = raw.gardenerId;
  if (Array.isArray(raw.vec)) n.vec = raw.vec as number[];
  return n;
}

/** The notes a gardener reads: its own and the shared ones, never another gardener's. */
export const forGardener = <T extends Pick<Note, 'gardenerId'>>(notes: T[], gardenerId: string): T[] => notes.filter((n) => !n.gardenerId || n.gardenerId === gardenerId);

/** eg-memory's schema, one step per version: each runs once, so the stores already there keep their data. */
export const MEMORY_VERSION = 4;
export function upgradeMemory(d: Pick<IDBDatabase, 'createObjectStore'>, oldVersion: number): void {
  if (oldVersion < 1) {
    d.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
    d.createObjectStore('highlights', { keyPath: 'id', autoIncrement: true }).createIndex('url', 'url');
    d.createObjectStore('kb', { keyPath: 'id', autoIncrement: true }).createIndex('url', 'url');
  }
  if (oldVersion < 2) d.createObjectStore('snapshots', { keyPath: 'url' });
  if (oldVersion < 3) d.createObjectStore('notes', { keyPath: 'id' });
  if (oldVersion < 4) {
    d.createObjectStore('entities', { keyPath: 'id' });
    d.createObjectStore('docs', { keyPath: 'id' });
  }
}

const PERSON = 'Notes (written by you):';
const taken = (host: string) => `Notes the gardener took from ${host || 'no page'}:`;

/**
 * The notes as data, best first: whole notes only, as many as fit in `room` chars. The person's and the model's stay
 * apart under their labels; a model's note is page text, so it is defanged and says where it came from.
 */
export function notesBlock(notes: Note[], room: number): string {
  const groups = new Map<string, string[]>();
  let used = 0;
  for (const n of notes) {
    const label = n.by === 'person' ? PERSON : taken(hostOf(n.by.url));
    const line = `- ${(n.by === 'person' ? n.text : defang(n.text)).replace(/\s+/g, ' ').trim()}`;
    const cost = line.length + 1 + (groups.has(label) ? 0 : label.length + 2);
    if (used + cost > room) continue; // a shorter one further down may still fit
    used += cost;
    groups.set(label, [...(groups.get(label) ?? []), line]);
  }
  const order = [...groups.keys()].sort((a, b) => Number(b === PERSON) - Number(a === PERSON));
  return order.map((l) => [l, ...groups.get(l)!].join('\n')).join('\n\n');
}
