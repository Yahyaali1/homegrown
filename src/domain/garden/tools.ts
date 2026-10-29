// The tools a gardener's model may call: names, arguments and limits. Implementations live in background/gardentools.ts.
import type { Effect } from './policy.ts';
import { parseScenario, type Scenario } from '../scrape/scenario.ts';
import { LIMITS, bare, type GardenRun, type Mention } from './records.ts';

export type Arg =
  | { type: 'string'; max: number }
  | { type: 'number'; min: number; max: number }
  | { type: 'enum'; values: string[] }
  | { type: 'list'; max: number; item: { type: 'string'; max: number } }
  /** js_scenario steps (an object with `instructions`, its JSON, or the list itself); never `evaluate`. */
  | { type: 'scenario' };

export interface ToolSpec {
  name: string;
  describe: string;
  args: Record<string, Arg & { optional?: true }>;
  effect: Effect;
}

const scenarioOf = (v: unknown): Scenario | null => {
  const s = parseScenario(Array.isArray(v) ? { instructions: v } : v);
  return s && !s.instructions.some((i) => 'evaluate' in i) ? s : null;
};

const okArg = (a: Arg, v: unknown): boolean => {
  switch (a.type) {
    case 'string': return typeof v === 'string' && v.trim() !== '' && v.length <= a.max;
    case 'number': return typeof v === 'number' && Number.isFinite(v) && v >= a.min && v <= a.max;
    case 'enum': return typeof v === 'string' && a.values.includes(v);
    case 'list': return Array.isArray(v) && v.length <= a.max && v.every((x) => okArg(a.item, x));
    case 'scenario': return !!scenarioOf(v);
  }
};

/** The model's args checked against the spec; an unknown key, a missing one or a bad value → null. Steps come back parsed. */
export function parseArgs(spec: ToolSpec, raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const args = raw as Record<string, unknown>;
  if (Object.keys(args).some((k) => !Object.hasOwn(spec.args, k))) return null;
  for (const [k, a] of Object.entries(spec.args)) {
    if (!Object.hasOwn(args, k) || args[k] === undefined ? !a.optional : !okArg(a, args[k])) return null;
  }
  return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, spec.args[k]!.type === 'scenario' ? scenarioOf(v) : v]));
}

export const TOOLS: ToolSpec[] = [
  { name: 'search', describe: 'search the web; gives up to 8 results as title — url', args: { query: { type: 'string', max: 200 } }, effect: 'read' },
  { name: 'read_page', describe: 'read a web page; gives its text and links', args: { url: { type: 'string', max: 2000 } }, effect: 'read' },
  { name: 'mission', describe: 'find and compare things across many pages, e.g. "cheapest 27-inch 4k monitor"', args: { goal: { type: 'string', max: 300 } }, effect: 'read' },
  { name: 'draft', describe: 'save a draft for the person to copy', args: { title: { type: 'string', max: 80 }, text: { type: 'string', max: 4000 } }, effect: 'read' },
  // Kept in Homegrown only (eg-memory); a later run that reads it is tainted, and sees it as data with its source.
  { name: 'note', describe: 'save a short note for your later runs', args: { text: { type: 'string', max: 500 } }, effect: 'read' },
  { name: 'notify', describe: 'send the person one short notification', args: { text: { type: 'string', max: 200 } }, effect: 'read' },
  { name: 'act', describe: 'open a page and click or type in it, after the person approves; steps: {"instructions": [{"click": "css"}, {"fill": ["css", "text"]}, {"wait_for": "css"}, {"wait": ms}]}', args: { url: { type: 'string', max: 2000 }, steps: { type: 'scenario' } }, effect: 'act' },
  // Read, unless the recipe's steps act: then policy treats the call as an act (actOf).
  { name: 'collect', describe: 'run one of the person\'s saved Collect recipes by its id; gives its rows', args: { recipe: { type: 'string', max: 200 } }, effect: 'read' },
  // Offered only when the person named tabs (toolsFor).
  { name: 'read_my_tab', describe: 'read one of the person\'s open tabs they named; tab: its URL exactly as listed', args: { tab: { type: 'string', max: 2000 } }, effect: 'read' },
];

/** The tabs the person named for this run. */
export const mentionsOf = (run: GardenRun): Mention[] => (run.work.kind === 'ask' || run.work.kind === 'plan' ? run.work.tabs ?? [] : []);

/** The tools offered to this run: `read_my_tab` only when the person named tabs. */
export const toolsFor = (run: GardenRun, tools: ToolSpec[] = TOOLS): ToolSpec[] => tools.filter((t) => t.name !== 'read_my_tab' || mentionsOf(run).length > 0);

/**
 * The open tab a mention points at now, or why there is none. Named by hand: that same tab, still on the URL it had.
 * In a routine: an open tab whose URL is exactly the one named.
 */
export function mentionedTab(mentions: Mention[], url: string, open: { id?: number | undefined; url?: string | undefined }[]): number | string {
  const m = mentions.find((x) => x.url === url);
  if (!m) return 'That isn’t a tab the person named.';
  if (m.tabId !== undefined) {
    const t = open.find((x) => x.id === m.tabId);
    if (!t) return 'The tab the person named was closed.';
    return t.url === m.url ? m.tabId : 'The tab the person named is on another page now.';
  }
  const t = open.find((x) => x.id !== undefined && x.url === m.url);
  return t ? t.id! : `No open tab is on ${m.url}.`;
}

/** The `[text](url)` targets of a page's markdown: absolute http(s), fragment removed, deduplicated, at most 50. */
export function pageLinks(markdown: string): string[] {
  const urls = [...markdown.matchAll(/\]\((https?:\/\/[^\s)]+)/g)].map((m) => bare(m[1]!)).filter((u): u is string => !!u);
  return [...new Set(urls)].slice(0, LIMITS.links);
}
