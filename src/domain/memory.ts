// Typed memory and Documents, kept in eg-memory's `entities` and `docs` stores by background/memory.ts.
// A model's entity is off (`confirmed: false`) until the person keeps it; only confirmed ones reach a prompt, and only
// in the data part, except a template the person wrote. Docs are private: reading one taints a run, as notes do.
import { defang, isObj, str } from './text.ts';

export const ENTITY_TYPES = ['person', 'project', 'event', 'research', 'preference'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export interface Entity {
  v: 1;
  id: string;
  type: EntityType;
  name: string;
  aliases: string[];
  fields: Record<string, string>;
  /** Markdown. */
  body: string;
  /** How work for this entity is done (a routine's `for`). */
  template?: string;
  gardenerId?: string;
  by: 'person' | 'model';
  confirmed: boolean;
  /** The person's own words, offered after they corrected a draft or a run. */
  correction?: true;
  at: number;
  vec?: number[];
}

export interface Doc { v: 1; id: string; gardenerId?: string; path: string; text: string; by: 'person' | 'model'; at: number }
/** An answer a person got on a page (eg-memory `history`). */
export interface HistoryEntry { id?: number; url: string; title: string; ask: string; answer: string; time: number }

export const MEM = { name: 80, aliases: 10, fields: 20, field: 500, body: 8000, template: 8000, path: 120, doc: 20_000, docs: 50, anchors: 3 } as const;

const BY = (x: unknown): x is 'person' | 'model' => x === 'person' || x === 'model';

export function parseEntity(raw: unknown): Entity | null {
  if (!isObj(raw) || raw.v !== 1 || !str(raw.id, 200) || !ENTITY_TYPES.includes(raw.type as EntityType) || !str(raw.name, MEM.name)) return null;
  if (!Array.isArray(raw.aliases) || raw.aliases.length > MEM.aliases || !raw.aliases.every((a) => str(a, MEM.name))) return null;
  if (!isObj(raw.fields) || Object.keys(raw.fields).length > MEM.fields || !Object.entries(raw.fields).every(([k, v]) => str(k, 40) && str(v, MEM.field, 0))) return null;
  if (!str(raw.body, MEM.body, 0) || (raw.template !== undefined && !str(raw.template, MEM.template, 0))) return null;
  if ((raw.gardenerId !== undefined && !str(raw.gardenerId, 200)) || !BY(raw.by) || typeof raw.confirmed !== 'boolean' || typeof raw.at !== 'number') return null;
  const e: Entity = { v: 1, id: raw.id, type: raw.type as EntityType, name: raw.name.trim(), aliases: (raw.aliases as string[]).map((a) => a.trim()),
    fields: raw.fields as Record<string, string>, body: raw.body, by: raw.by, confirmed: raw.confirmed, at: raw.at };
  if (raw.template) e.template = raw.template as string;
  if (raw.gardenerId) e.gardenerId = raw.gardenerId as string;
  if (raw.correction === true) e.correction = true;
  if (Array.isArray(raw.vec)) e.vec = raw.vec as number[];
  return e;
}

/** A doc path: '/'-separated names, no empty, '.' or '..' part, no leading slash. */
export const pathOk = (p: unknown): p is string => str(p, MEM.path) && p.split('/').every((s) => !!s.trim() && s !== '.' && s !== '..' && !/[\\\0-\x1f]/.test(s));

/** Library folders a gardener never writes into: meetings, and any gardener's Documents folder by its full path. */
export const docRefused = (path: string): string | null =>
  !pathOk(path) ? 'That isn’t a valid document path.' : /^(Meetings|Documents)(\/|$)/i.test(path) ? 'A gardener writes only its own documents.' : null;

export function parseDoc(raw: unknown): Doc | null {
  if (!isObj(raw) || raw.v !== 1 || !str(raw.id, 200) || !pathOk(raw.path) || !str(raw.text, MEM.doc, 0) || !BY(raw.by) || typeof raw.at !== 'number') return null;
  if (raw.gardenerId !== undefined && !str(raw.gardenerId, 200)) return null;
  return { v: 1, id: raw.id, path: raw.path, text: raw.text, by: raw.by, at: raw.at, ...(raw.gardenerId ? { gardenerId: raw.gardenerId as string } : {}) };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The confirmed entities `@Name` points at in `text`: by name or alias, exact and case-insensitive, at most 3, in the
 * order they appear. The longest name wins where two start at the same `@`. Unconfirmed entities are never anchors.
 */
export function anchorsIn(text: string, entities: Entity[]): Entity[] {
  const keys = entities.filter((e) => e.confirmed).flatMap((e) => [e.name, ...e.aliases].map((k) => ({ k, e }))).sort((a, b) => b.k.length - a.k.length);
  const found: { at: number; e: Entity }[] = [];
  for (const m of text.matchAll(/(?<![\p{L}\p{N}._%+-])@/gu)) { // not inside an email address
    const hit = keys.find(({ k }) => new RegExp(`^${escape(k)}(?![\\p{L}\\p{N}])`, 'iu').test(text.slice(m.index + 1)));
    if (hit && !found.some((f) => f.e.id === hit.e.id)) found.push({ at: m.index, e: hit.e });
  }
  return found.slice(0, MEM.anchors).map((f) => f.e);
}

/** One entity as data: "Reference: <name>", its fields and body. A model's words are defanged. */
export function reference(e: Entity): string {
  const t = (s: string) => (e.by === 'model' ? defang(s) : s);
  const fields = Object.entries(e.fields).map(([k, v]) => `${t(k)}: ${t(v)}`);
  return [`Reference: ${t(e.name)} (${e.type}${e.aliases.length ? `, also ${e.aliases.map(t).join(', ')}` : ''})`, ...fields, t(e.body).trim()].filter(Boolean).join('\n');
}

/**
 * The memory a think carries: anchored entities as data, and a routine entity's template, which is instruction only
 * when the person wrote it (else data, labelled). Unconfirmed entities give nothing.
 */
export function memoryParts(anchors: Entity[] = [], forEntity?: Entity): { instruction: string; data: string } {
  const shown = anchors.filter((e) => e.confirmed);
  const t = forEntity?.confirmed && forEntity.template?.trim() ? forEntity : undefined;
  // Only the template text: a kept gardener's file may still carry a name the model wrote.
  const instruction = t?.by === 'person' ? `How to do this:\n${t.template!.trim()}` : '';
  const data = [...shown.map(reference), ...(t && t.by !== 'person' ? [`A suggested way to do this for ${defang(t.name)} (written by a gardener):\n${defang(t.template)}`] : [])].join('\n\n');
  return { instruction, data };
}

/** The person's words, if they read as a standing correction ("no…", "don't…", "never…", "always…"). No model. */
export function correctionOf(text: string): string | null {
  const t = text.trim();
  return /^(no|don['’]?t|do not|never|always)\b/i.test(t) && t.length <= MEM.body ? t : null;
}

/** A gardener may not overwrite a document the person wrote. */
export const docWriteRefused = (old: Pick<Doc, 'by'> | undefined, by: Doc['by']): string | null =>
  old?.by === 'person' && by === 'model' ? 'That document is yours; write a new path.' : null;

/** The lines the person added when editing a draft: their own words only, not the model's. */
export const addedLines = (before: string, after: string): string => {
  const was = new Set(before.split('\n').map((l) => l.trim()));
  return after.split('\n').filter((l) => l.trim() && !was.has(l.trim())).join('\n').trim();
};

/** A correction kept as a preference, in the person's own words: what `entitySave` takes. */
export const correctionEntity = (text: string): Partial<Entity> =>
  ({ type: 'preference', name: text.replace(/\s+/g, ' ').slice(0, MEM.name).trim(), body: text, correction: true });
