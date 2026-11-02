// The Garden tab: gardeners, their routines, requests that need you, and runs. The worker (background/garden.ts) does
// the work and broadcasts { type: 'garden-run', run } on every change; this only shows it and sends your answers.
// Rows are kept by id and updated in place, so a flower that has grown stays still. Each section is its own file.
import { $, emptyPot, errLine, fail } from './shell.ts';
import { can, modelById } from '../domain/model.ts';
import { parseSettings } from '../domain/settings.ts';
import { isWorking, type Gardener, type GardenRun } from '../domain/garden/records.ts';
import type { Skill } from '../domain/garden/skills.ts';
import type { Entity } from '../domain/memory.ts';
import { bg, engineCall } from '../shared/protocol.ts';
import { runs, S, setRender, type Can, type Listed } from './garden-state.ts';
import { gardenerItem, renderHire } from './garden-gardeners.ts';
import { loadNotes } from './garden-notes.ts';
import { nextLines, refreshNext } from './garden-routines.ts';
import { renderSkills } from './garden-skills.ts';
import { renderConnectors } from './garden-connectors.ts';
import { renderRuns } from './garden-runs.ts';

const loadError = errLine(); // a failed load
$('#garden').prepend(loadError);

async function canDo(): Promise<Can> {
  const { taskModels } = parseSettings(await chrome.storage.sync.get('taskModels'));
  const name = taskModels.gardens || (await engineCall<{ loaded: { name: string } | null }>('status').catch(() => null))?.loaded?.name || '';
  const ask = !!modelById(name)?.agent?.loop;
  return { ask, plan: ask || can(name, 'plan'), skillEdit: can(name, 'skillEdit'), model: name };
}

export async function renderGarden(): Promise<void> {
  try {
    const [g, r, list, ask, mem, sk] = await Promise.all([bg<Gardener[]>('gardenerList'), bg<Listed[]>('routineList'), bg<GardenRun[]>('runList'), canDo(), bg<Omit<Entity, 'vec'>[]>('entityList').catch(() => []), bg<Skill[]>('skillList').catch(() => [])]);
    Object.assign(S, { gardeners: g, routines: r, abilities: ask, skills: sk, memory: new Map(mem.map((e) => [e.id, e])) });
    runs.clear();
    for (const run of list) runs.set(run.id, run);
    loadError.hidden = true;
    nextLines.clear();
    $('#gardener-list').replaceChildren(...(S.gardeners.length ? S.gardeners.map((x) => gardenerItem(x, ask)) : [emptyPot('Gardeners grow here.')]));
    renderRuns();
    renderSkills();
    renderHire();
    void renderConnectors();
    S.loaded = true;
  } catch (e) {
    fail(loadError, e);
  }
}
setRender(renderGarden);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'garden-run') return;
  const run = msg.run as GardenRun;
  const isNew = !runs.has(run.id);
  runs.set(run.id, run);
  renderRuns(run.id);
  if (run.routineId && (isNew || !isWorking(run))) void refreshNext();
  const last = run.steps.at(-1)?.state === 'done' ? run.steps.at(-1)!.tool : '';
  // A note it took shows in its notebook once the step is done.
  if (last === 'note') void loadNotes(run.gardenerId);
  // A memory file it proposed: its card needs the file's state.
  if (last === 'remember') void bg<Omit<Entity, 'vec'>[]>('entityList').then((l) => ((S.memory = new Map(l.map((e) => [e.id, e]))), renderRuns()), () => {});
  // A routine it proposed shows under it, off.
  if (last === 'propose_routine') void renderGarden();
});

void renderGarden();
