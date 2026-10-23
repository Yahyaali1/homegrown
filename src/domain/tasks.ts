// Tasks as data: what they are, how stored or shared lists are checked, and how the list is reordered.
export type TaskKind = 'text' | 'page' | 'image';
export interface Task { id: string; kind: TaskKind; title: string; prompt: string }
export const KINDS: Record<TaskKind, string> = { text: 'Selected text', page: 'Whole page', image: 'Image' };

const isKind = (k: unknown): k is TaskKind => k === 'text' || k === 'page' || k === 'image';

/** Stored tasks, checked: an entry that isn't a usable task is skipped rather than breaking the menu. */
export function parseTasks(raw: unknown): Task[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((t): Task[] => {
    if (!t || typeof t !== 'object') return [];
    const { id, kind, title, prompt } = t as Record<string, unknown>;
    return typeof id === 'string' && isKind(kind) && typeof title === 'string' && typeof prompt === 'string' ? [{ id, kind, title, prompt }] : [];
  });
}

/** A shared task list (JSON) merged into `list` by id. Throws when it isn't a task list at all. */
export function importTasks(list: Task[], json: string, newId: () => string): { tasks: Task[]; count: number } {
  const incoming: unknown = JSON.parse(json);
  if (!Array.isArray(incoming) || incoming.some((t) => !t || typeof t !== 'object' || !t.title || !t.prompt || !isKind(t.kind))) throw new Error('Not a task list');
  const out = [...list];
  for (const t of incoming as Record<string, unknown>[]) {
    const clean: Task = { id: String(t.id || newId()), kind: t.kind as TaskKind, title: String(t.title), prompt: String(t.prompt) };
    const i = out.findIndex((x) => x.id === clean.id);
    if (i >= 0) out[i] = clean;
    else out.push(clean);
  }
  return { tasks: out, count: incoming.length };
}

/** Moves a task up (-1) or down (1) past the nearest task of the same kind: each kind is shown as its own list. */
export function moveTask(list: Task[], id: string, by: -1 | 1): Task[] {
  const out = [...list];
  const i = out.findIndex((x) => x.id === id);
  if (i < 0) return out;
  let j = i + by;
  while (j >= 0 && j < out.length && out[j]!.kind !== out[i]!.kind) j += by;
  if (j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}
