// js_scenario: ScrapingBee's browser steps before a page is read, in their JSON. Checked here once; the worker runs
// them one at a time in Homegrown's own background tab (background/pagerequest.ts).
import { isObj } from '../text.ts';

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null => (isObj(v) ? v : null);

export type SelectorType = 'auto' | 'css' | 'xpath';
export type Instruction =
  | { click: string }
  | { wait: number }
  | { wait_for: string }
  | { wait_for_and_click: string }
  | { scroll_x: number }
  | { scroll_y: number }
  | { fill: [string, string] }
  | { evaluate: string }
  | { infinite_scroll: { max_count: number; delay: number; end_click: { selector: string; selector_type: SelectorType } | null } };
export interface Scenario { strict: boolean; instructions: Instruction[] }

/** ScrapingBee's scenario limit is 40 s per page; the rest keep one step from eating it. */
export const SCENARIO_LIMITS = { instructions: 30, wait: 10000, budget: 40000, scrolls: 50, delay: 5000, selector: 300, fill: 2000, evaluate: 5000 } as const;

const selector = (v: unknown) => (typeof v === 'string' && v.trim() && v.length <= SCENARIO_LIMITS.selector ? v.trim() : null);
const ms = (v: unknown, max: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.min(Math.floor(Number(v)), max) : null);

function instruction(raw: unknown): Instruction | null {
  const o = obj(raw);
  const keys = o ? Object.keys(o) : [];
  if (!o || keys.length !== 1) return null;
  const [k] = keys as [string];
  const v = o[k];
  switch (k) {
    case 'click':
    case 'wait_for':
    case 'wait_for_and_click': {
      const s = selector(v);
      return s ? ({ [k]: s } as Instruction) : null;
    }
    case 'wait': {
      const n = ms(v, SCENARIO_LIMITS.wait);
      return n === null ? null : { wait: n };
    }
    case 'scroll_x':
    case 'scroll_y': {
      const n = Number(v);
      return Number.isFinite(n) ? ({ [k]: Math.max(-100000, Math.min(100000, Math.round(n))) } as Instruction) : null;
    }
    case 'fill': {
      if (!Array.isArray(v) || v.length !== 2) return null;
      const s = selector(v[0]);
      return s && typeof v[1] === 'string' && v[1].length <= SCENARIO_LIMITS.fill ? { fill: [s, v[1]] } : null;
    }
    case 'evaluate':
      return typeof v === 'string' && v.trim() && v.length <= SCENARIO_LIMITS.evaluate ? { evaluate: v } : null;
    case 'infinite_scroll': {
      const c = obj(v);
      if (!c) return null;
      const end = obj(c.end_click);
      const endSel = end ? selector(end.selector) : null;
      if (end && !endSel) return null;
      const st = end?.selector_type === 'css' || end?.selector_type === 'xpath' ? end.selector_type : 'auto';
      const max = ms(c.max_count ?? 0, SCENARIO_LIMITS.scrolls) ?? 0;
      return { infinite_scroll: { max_count: max || SCENARIO_LIMITS.scrolls, delay: ms(c.delay ?? 1000, SCENARIO_LIMITS.delay) ?? 1000, end_click: endSel ? { selector: endSel, selector_type: st } : null } };
    }
    default:
      return null;
  }
}

/** A scenario ({strict?, instructions} or its JSON string), or null if any instruction is unusable or unknown. */
export function parseScenario(raw: unknown): Scenario | null {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  const o = obj(v);
  if (!o || !Array.isArray(o.instructions) || !o.instructions.length || o.instructions.length > SCENARIO_LIMITS.instructions) return null;
  const instructions = o.instructions.map(instruction);
  if (instructions.some((i) => !i)) return null;
  return { strict: o.strict !== false, instructions: instructions as Instruction[] };
}

/** Steps that change the page or run code: only the user writes these, and they are confirmed before a first run. */
export const isAct = (i: Instruction): boolean =>
  'click' in i || 'wait_for_and_click' in i || 'fill' in i || 'evaluate' in i || ('infinite_scroll' in i && !!i.infinite_scroll.end_click);

/** One line per step, for the confirmation and the report. */
export function describe(i: Instruction): string {
  if ('click' in i) return `click ${i.click}`;
  if ('wait' in i) return `wait ${i.wait} ms`;
  if ('wait_for' in i) return `wait for ${i.wait_for}`;
  if ('wait_for_and_click' in i) return `wait for and click ${i.wait_for_and_click}`;
  if ('scroll_x' in i) return `scroll ${i.scroll_x} px across`;
  if ('scroll_y' in i) return `scroll ${i.scroll_y} px down`;
  if ('fill' in i) return `type "${i.fill[1].slice(0, 40)}" into ${i.fill[0]}`;
  if ('evaluate' in i) return `run JavaScript (${i.evaluate.length} characters)`;
  const s = i.infinite_scroll;
  return `scroll to the end up to ${s.max_count} times${s.end_click ? `, clicking ${s.end_click.selector} when it stops` : ''}`;
}

/** What one step did, like ScrapingBee's js_scenario_report. */
export interface StepReport { step: string; ok: boolean; ms: number; error?: string; result?: unknown }
