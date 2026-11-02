// Companion Plaza: one line a day per gardener, written in the background lane.
import { askAs } from './engine.ts';
import { handlers as memoryHandlers, listNotes } from './memory.ts';
import { allRuns, gardeners } from './garden-store.ts';
import { gardensModel } from './garden-queue.ts';
import { pagesOnly } from './pagerequest.ts';
import { plazaDay, plazaLine, plazaThink } from '../domain/plaza.ts';
import { parseSettings } from '../domain/settings.ts';

let busy = false;
async function writePlaza(day: string): Promise<void> {
  const model = await gardensModel();
  if (!model) return;
  // History titles join only with the setting on.
  const history = parseSettings(await chrome.storage.sync.get('plazaHistory')).plazaHistory
    ? (await memoryHandlers.memHistory({ limit: 20 })).map((x) => x.title).filter(Boolean) : null;
  const runs = await allRuns();
  const lines: Record<string, string> = {};
  for (const g of await gardeners()) {
    const notes = (await listNotes(g.id)).filter((n) => n.gardenerId === g.id).map((n) => n.text);
    const answers = runs.filter((r) => r.gardenerId === g.id && r.status === 'done' && r.answer).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)).map((r) => r.answer!);
    if (!notes.length && !answers.length) continue; // nothing of its own to say
    const t = plazaThink(g.name, { notes, answers, history });
    const line = plazaLine((await askAs(t.prompt, t.data, { task: 'gardens', model, owner: 'plaza' }).catch(() => ({ text: '' }))).text);
    if (line) lines[g.id] = line;
  }
  await chrome.storage.local.set({ plazaLines: { day, history: !!history, lines } });
}

export const plazaHandlers = pagesOnly({
  /** Today's Plaza lines by gardener id; a stale day starts writing them (they arrive through storage). */
  async plazaLines() {
    const day = plazaDay(new Date());
    const kept = (await chrome.storage.local.get('plazaLines')).plazaLines as { day?: string; history?: boolean; lines?: Record<string, string> } | undefined;
    // Lines written with history are dropped once plazaHistory is off (and rewritten when it changes either way).
    const history = parseSettings(await chrome.storage.sync.get('plazaHistory')).plazaHistory;
    if (kept?.day === day && !!kept.history === history) return kept.lines ?? {};
    if (!busy) {
      busy = true;
      void writePlaza(day).catch(() => {}).finally(() => (busy = false));
    }
    return {};
  },
});
