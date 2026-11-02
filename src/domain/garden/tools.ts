// The tools a gardener's model may call: names, arguments and limits. Implementations live in background/gardentools.ts.
import type { Effect } from './policy.ts';
import { parseScenario, type Scenario } from '../scrape/scenario.ts';
import { ENTITY_TYPES, MEM } from '../memory.ts';
import { LIMITS, bare, parseWhen, parseWork, requestOf, type GardenRun, type Mention } from './records.ts';
import { argsText, unusable, type ConnectorFacts } from '../mcp.ts';
import { isObj } from '../text.ts';

type Arg =
  | { type: 'string'; max: number }
  | { type: 'number'; min: number; max: number }
  | { type: 'enum'; values: string[] }
  | { type: 'list'; max: number; item: { type: 'string'; max: number } }
  /** js_scenario steps (an object with `instructions`, its JSON, or the list itself); never `evaluate`. */
  | { type: 'scenario' }
  /** A record its parser takes (null: refused); the parsed record is kept. */
  | { type: 'record'; parse: (v: unknown) => unknown };

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
    case 'record': return a.parse(v) !== null;
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
  return Object.fromEntries(Object.entries(args).map(([k, v]) => {
    const a = spec.args[k]!;
    return [k, a.type === 'scenario' ? scenarioOf(v) : a.type === 'record' ? a.parse(v) : v];
  }));
}

export const TOOLS: ToolSpec[] = [
  { name: 'search', describe: 'search the web; gives up to 8 results as title — url', args: { query: { type: 'string', max: 200 } }, effect: 'read' },
  { name: 'read_page', describe: 'read a web page; gives its text and links', args: { url: { type: 'string', max: 2000 } }, effect: 'read' },
  { name: 'mission', describe: 'find and compare things across many pages, e.g. "cheapest 27-inch 4k monitor"', args: { goal: { type: 'string', max: 300 } }, effect: 'read' },
  { name: 'draft', describe: 'save a draft for the person to copy', args: { title: { type: 'string', max: 80 }, text: { type: 'string', max: 4000 } }, effect: 'read' },
  // Kept in Homegrown only; a later run that reads it is tainted, and sees it as data with its source.
  { name: 'note', describe: 'save a short note for your later runs', args: { text: { type: 'string', max: 500 } }, effect: 'read' },
  { name: 'notify', describe: 'send the person one short notification', args: { text: { type: 'string', max: 200 } }, effect: 'read' },
  { name: 'act', describe: 'open a page and click or type in it, after the person approves; steps: {"instructions": [{"click": "css"}, {"fill": ["css", "text"]}, {"wait_for": "css"}, {"wait": ms}]}', args: { url: { type: 'string', max: 2000 }, steps: { type: 'scenario' } }, effect: 'act' },
  // Read, unless the recipe's steps act: then policy treats the call as an act.
  { name: 'collect', describe: 'run one of the person\'s saved Collect recipes by its id; gives its rows', args: { recipe: { type: 'string', max: 200 } }, effect: 'read' },
  // Offered only when the person named tabs (toolsFor).
  { name: 'read_my_tab', describe: 'read one of the person\'s open tabs they named; tab: its URL exactly as listed', args: { tab: { type: 'string', max: 2000 } }, effect: 'read' },
  // Offered only when the person named tabs (toolsFor); every call is asked, never granted.
  { name: 'act_my_tab', describe: 'click or type in one of the person\'s open tabs they named, after they approve; tab: its URL exactly as listed; steps as for act', args: { tab: { type: 'string', max: 2000 }, steps: { type: 'scenario' } }, effect: 'act' },
  // Stored paused (by: 'model') until the person turns it on. Offered only with a loop or in a plan (toolsFor).
  { name: 'propose_routine', describe: 'propose a routine the person may turn on; when: {"kind": "daily", "at": "08:00"}, {"kind": "every", "hours": 6} or {"kind": "weekly", "days": [1], "at": "08:00"}; work: {"kind": "read", "urls": ["…"]}', args: { name: { type: 'string', max: 80 }, when: { type: 'record', parse: parseWhen }, work: { type: 'record', parse: parseWork } }, effect: 'read' },
  // Stored unconfirmed: never an anchor or in a prompt until the person keeps it. Offered like propose_routine.
  { name: 'remember', describe: 'propose a memory file the person may keep; type: person, project, event, research or preference', args: { type: { type: 'enum', values: [...ENTITY_TYPES] }, name: { type: 'string', max: MEM.name }, body: { type: 'string', max: MEM.body } }, effect: 'read' },
  // The gardener's own Documents, kept in Homegrown only.
  { name: 'doc_read', describe: 'read one of your documents by its path, e.g. plan.md', args: { path: { type: 'string', max: MEM.path } }, effect: 'read' },
  { name: 'doc_write', describe: 'write (or replace) one of your documents, e.g. a plan file for a long task', args: { path: { type: 'string', max: MEM.path }, text: { type: 'string', max: MEM.doc } }, effect: 'read' },
  // A connected app's tool; offered only when one is usable, with its lines in place of this describe (toolsFor).
  { name: 'app_call', describe: 'call a tool of an app the person connected, after they approve', args: { connector: { type: 'string', max: 200 }, tool: { type: 'string', max: 41 }, args: { type: 'record', parse: (v) => (isObj(v) ? v : null) } }, effect: 'act' },
];

/**
 * What policy treats differently per tool; a tool not listed has none of it. `blanket`: a plan's yes or Approve all
 * may cover its approve (an act in the gardener's own tabs). `noAlways`: never granted. `editable`: its approve card
 * shows the args as fields to edit before Yes. `taints`: its result always taints the run (`always`), or when it or
 * its final page is on the gardener's sites (`sites`); also when it threw, as it may have shown the data.
 */
interface Rule { blanket?: true; noAlways?: true; editable?: true; taints?: 'always' | 'sites' }
const POLICY: Record<string, Rule> = {
  act: { blanket: true, editable: true, taints: 'sites' },
  collect: { blanket: true },
  act_my_tab: { noAlways: true, editable: true, taints: 'always' },
  read_my_tab: { taints: 'always' },
  app_call: { editable: true, taints: 'always' },
  doc_read: { taints: 'always' },
};
export const ruleOf = (tool: string | undefined): Rule => (tool && Object.hasOwn(POLICY, tool) ? POLICY[tool]! : {});

/** The tabs the person named for this run. */
export const mentionsOf = (run: GardenRun): Mention[] => requestOf(run.work)?.tabs ?? [];

/**
 * The tools offered to this run: the person's tabs only when they named some, `propose_routine` and `remember` only
 * with a loop or in a plan, `app_call` only with a usable app tool, described by `appLines`. `allowed`: a hired
 * gardener's pack list, which only narrows.
 */
export const toolsFor = (run: GardenRun, tools: ToolSpec[] = TOOLS, connectors: ConnectorFacts[] = [], allowed?: string[]): ToolSpec[] => tools.flatMap((t) => {
  if (allowed && !allowed.includes(t.name)) return [];
  if ((t.name === 'read_my_tab' || t.name === 'act_my_tab') && !mentionsOf(run).length) return [];
  if ((t.name === 'propose_routine' || t.name === 'remember') && !run.agent?.loop && run.work.kind !== 'plan') return [];
  if (t.name !== 'app_call') return [t];
  const lines = appLines(connectors);
  return lines ? [{ ...t, describe: `${t.describe}; args: that tool's arguments. Apps:\n${lines}` }] : [];
});

/**
 * Each usable app tool as one line, then the app's guidelines: only what the person wrote or confirmed, and names and
 * types that passed the name check. A tool set to Off never appears. '' when none is usable.
 */
function appLines(connectors: ConnectorFacts[]): string {
  return connectors.flatMap((c) => {
    // A tool the person hasn't described yet isn't offered: its only text would be the server's.
    const tools = c.tools.filter((t) => t.scope !== 'off' && t.describe.trim() && !unusable(t.name, t.schema));
    if (!tools.length) return [];
    const head = `- connector "${c.id.replace(/["\\\n]/g, '')}" (${c.name.replace(/\s+/g, ' ')}):`;
    const guide = c.guidelines.trim() ? [`  Guidelines for ${c.name.replace(/\s+/g, ' ')}: ${c.guidelines.trim()}`] : [];
    return [head, ...tools.map((t) => `  tool "${t.name}" ${argsText(t.schema)}: ${t.describe}`), ...guide];
  }).join('\n');
}

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

/** A run works in this tab now: it is in the run's group, or one the run borrowed (act_my_tab). */
export const ownsTab = (e: { group?: number | undefined; borrowed: Set<number> } | undefined, tab: { id?: number | undefined; groupId?: number } | undefined): boolean =>
  !!tab && !!e && ((e.group !== undefined && tab.groupId === e.group) || (tab.id !== undefined && e.borrowed.has(tab.id)));

const noQuery = (u: string): string => u.replace(/[?#].*$/, '');

/**
 * DevTools output for a step, as page data: ≤ 20 console errors and ≤ 30 failed requests (status ≥ 400), with no
 * query strings and no bodies. Empty when there is nothing to say.
 */
export function devtoolsDigest(errors: string[], requests: { method: string; url: string; status: number }[]): string {
  const lines: string[] = [];
  const errs = errors.slice(0, 20).map((e) => `- ${e.replace(/(https?:\/\/[^\s?#]+)[?#]\S*/g, '$1').replace(/\s+/g, ' ').trim().slice(0, 200)}`);
  if (errs.length) lines.push('Console errors:', ...errs);
  const failed = requests.filter((r) => r.status >= 400).slice(0, 30).map((r) => `- ${r.method} ${noQuery(r.url).slice(0, 200)} ${r.status}`);
  if (failed.length) lines.push('Failed requests:', ...failed);
  return lines.join('\n');
}

/**
 * The run a download belongs to: the one whose tab had its referrer open. Never one the person's own tabs also have
 * open (their download, or can't tell), and never by guess.
 */
export function downloadRun(referrer: string | undefined, runUrls: { runId: string; urls: Set<string> }[], personUrls: string[]): string | null {
  const r = referrer ? bare(referrer) : null;
  if (!r || personUrls.some((u) => bare(u) === r)) return null;
  const runs = runUrls.filter((x) => [...x.urls].some((u) => bare(u) === r));
  return runs.length === 1 ? runs[0]!.runId : null;
}
