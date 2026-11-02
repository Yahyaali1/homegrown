// What the Garden tab's sections share: the records last loaded, and small helpers.
import { h } from '../ui/dom.ts';
import { can, type Ability } from '../domain/model.ts';
import { lookOf, type Gardener, type GardenRun, type Look, type Routine } from '../domain/garden/records.ts';
import type { Skill } from '../domain/garden/skills.ts';
import type { Entity } from '../domain/memory.ts';

export type Listed = Routine & { next: number };
export type Row = HTMLLIElement & { stage?: string; look?: string };
/** Open requests ("Ask") need a gardens model whose measured `agent.loop` is true; "Plan first" needs `plan` (or the loop), as the worker checks. */
export type Can = { ask: boolean; plan: boolean; skillEdit: boolean; model: string };

export const S = {
  gardeners: [] as Gardener[],
  routines: [] as Listed[],
  skills: [] as Skill[],
  /** What the gardens model can take, for follow-ups. */
  abilities: { ask: false, plan: false, skillEdit: false, model: '' } as Can,
  /** Memory files by id: a proposed one's card shows Keep / Discard. */
  memory: new Map<string, Omit<Entity, 'vec'>>(),
  /** Rows added after the first load get the entrance. */
  loaded: false,
};
export const runs = new Map<string, GardenRun>();

let render = async (): Promise<void> => {};
/** Reloads and redraws the whole tab (garden.ts sets it). */
export const renderGarden = (): Promise<void> => render();
export const setRender = (f: () => Promise<void>) => void (render = f);

export const at = (ms: number) => new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);
export const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
export const select = (label: string, opts: [string, string][]) => h('select', { attrs: { 'aria-label': label } }, ...opts.map(([v, t]) => new Option(t, v)));

/**
 * A gardener's flower. One from before looks has none stored: it gets one from its id, so it is the same every time
 * and never the Homegrown mark's 10 petals.
 */
export const lookFor = (gardenerId: string): Look => lookOf(S.gardeners.find((x) => x.id === gardenerId) ?? { id: gardenerId });

/** A new row: the entrance once, unless it is part of the first load. */
export const fresh = (li: HTMLLIElement): Row => (S.loaded && li.classList.add('enter'), li);

/** A seed the gardens model wasn't measured for: no Turn on, no Run now (the worker refuses them too). */
export const lacks = (x: { needs?: Ability[] }) => !!x.needs?.some((a) => !can(S.abilities.model, a));

