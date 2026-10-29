// The Homegrown mark: a daisy leaning left out of a pot, leaf on the right (docs/design-philosophy.md). Petals, stem,
// leaf and pot are currentColor; the seed is --pollen. Each petal carries --i so CSS can stagger it.
// A gardener's look (another petal count, its own lean) sets --petals, so the stagger and the turn follow 360/petals.
// States (ui/tokens.css): sprout grows it once, thinking loops the growth, bloom opens it, stage-0…3 hold it
// part-grown, wilt droops it (errors).
import { fromHtml } from './dom.ts';
import type { GardenRun, Look } from '../domain/garden/records.ts';

export type FlowerState = '' | 'sprout' | 'thinking' | 'bloom' | 'wilt' | 'stage-0' | 'stage-1' | 'stage-2' | 'stage-3';

const n2 = (x: number) => +x.toFixed(2);
const ring = (petals: number, cx: number, cy: number, d: number, rx: number, ry: number) =>
  Array.from({ length: petals }, (_, i) =>
    // The rotation sits on a <g> so CSS can scale and fade each petal without undoing it.
    `<g transform="rotate(${n2((i * 360) / petals)} ${cx} ${cy})"><ellipse class="petal" style="--i:${i}" cx="${cx}" cy="${cy - d}" rx="${rx}" ry="${ry}"/></g>`).join('');
// The leaf's outline from its base on the stem, as drawn on the mark.
const LEAF = [[3.4, -3], [6.9, -3], [9.4, -1.5], [6.9, 1.5], [2.9, 2]] as const;

/**
 * The potted daisy. With no look it is the Homegrown mark: 10 petals, the head 3 left of the pot's centre (lean .5).
 * A look leans the head 6 × lean to the left and grows the leaf (on the right, opposite) with it; fewer petals are
 * wider (rx 16/petals), so every flower has about the same weight.
 */
function plant({ petals, lean }: Look): string {
  const hx = n2(24 - 6 * lean), c2 = n2(24 - 2 * lean);
  // The leaf sits on the stem 30% of the way up (the cubic at t = .3), just inside it as on the mark.
  const bx = n2(0.343 * 24 + 0.441 * 24 + 0.189 * c2 + 0.027 * hx - 0.13), by = 26, k = 0.8 + 0.4 * lean;
  const [a, b, c, d, e] = LEAF.map(([x, y]) => `${n2(bx + x * k)} ${n2(by + y * k)}`);
  return `<g class="plant"><path class="stem" d="M24 31C24 25.5 ${c2} 20.5 ${hx} 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>` +
    `<path class="leaf" d="M${bx} ${by}C${a} ${b} ${c}C${d} ${e} ${bx} ${by}Z"/>` +
    `<g class="petals" style="transform-origin:${hx}px 11.5px">${ring(petals, hx, 11.5, 6.4, n2(16 / petals), 4.2)}</g><circle class="seed" cx="${hx}" cy="11.5" r="3.2"/></g>` +
    '<g class="pot"><rect x="13.5" y="31" width="21" height="4" rx="1.5"/><path d="M15.5 35.6H32.5L30.6 43.2C30.5 43.7 30 44 29.5 44H18.5C18 44 17.5 43.7 17.4 43.2Z"/></g>';
}
const PLANT =
  '<g class="plant"><path class="stem" d="M24 31C24 25.5 23 20.5 21 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' +
  '<path class="leaf" d="M23.6 26C27 23 30.5 23 33 24.5C30.5 27.5 26.5 28 23.6 26Z"/>' +
  `<g class="petals" style="transform-origin:21px 11.5px">${ring(10, 21, 11.5, 6.4, 1.6, 4.2)}</g><circle class="seed" cx="21" cy="11.5" r="3.2"/></g>` +
  '<g class="pot"><rect x="13.5" y="31" width="21" height="4" rx="1.5"/><path d="M15.5 35.6H32.5L30.6 43.2C30.5 43.7 30 44 29.5 44H18.5C18 44 17.5 43.7 17.4 43.2Z"/></g>';

/** The mark as markup (static: size is a number, state one of a fixed set), or a gardener's flower with its look. */
export const flowerHtml = (size = 20, state: FlowerState = '', look?: Look) =>
  `<svg class="flower ${state}" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true" fill="currentColor"${look ? ` style="--petals:${look.petals}"` : ''}>${look ? plant(look) : PLANT}</svg>`;

export const flower = (size = 20, state: FlowerState = '', look?: Look) => fromHtml<SVGSVGElement>(flowerHtml(size, state, look));

// Each mission's plant: growing while it works, in bloom when the goal is met, part-grown for a best effort, wilted
// when it failed.
export const MISSION_STAGE: Record<string, FlowerState> = { planning: 'thinking', running: 'thinking', failed: 'wilt', stopped: 'stage-1' };

/** A gardener run's plant (docs/plan/S-gardeners.md, Stages): held part-grown by steps done while it waits or stopped. */
export function runStage(run: Pick<GardenRun, 'status' | 'steps' | 'best'>): FlowerState {
  const held = `stage-${Math.min(3, 1 + run.steps.filter((s) => s.state === 'done').length)}` as FlowerState;
  switch (run.status) {
    case 'queued': return 'stage-0';
    case 'running': return 'thinking';
    case 'done': return run.best ? 'stage-3' : 'sprout';
    case 'failed': return 'wilt';
    default: return held;
  }
}

/** Extension pages: <i class="hg-mark" data-size="28"></i> becomes the mark, sprouting in once. */
export function markPage(): void {
  for (const i of document.querySelectorAll<HTMLElement>('i.hg-mark')) i.replaceWith(flower(Number(i.dataset.size) || 18, 'sprout'));
}
