// Code decides what a gardener may do, never the model. Reach (which URLs a run may open), taint (after a signed-in
// read, nothing new leaves the gardener's sites without the person's yes), and acts: asked every time unless the
// person granted exactly that call, and sensitive ones always asked.
import { hostOf } from '../text.ts';
import { describe, parseScenario, type Instruction, type Scenario } from '../scrape/scenario.ts';
import { riskOf } from '../scrape/tools.ts';
import { docRefused, MEM } from '../memory.ts';
import { checkArgs, unusable, type AppTool, type ConnectorFacts } from '../mcp.ts';
import { sensitiveWord } from './classify.ts';
import { mentionsOf, ruleOf } from './tools.ts';
import { LIMITS, bare, parseWork, personUrls, requestOf, type Gardener, type GardenRun, type Request, type Seen, type Step } from './records.ts';

export type Effect = Step['effect'];
export type Verdict = 'allow' | 'ask' | 'deny';
export interface Call { tool: string; args: Record<string, unknown>; url?: string }

/** A standing yes to one exact acting call: stored only from an "always" answer, never for a sensitive call. */
export interface Grant { gardenerId: string; tool: string; host: string; argsKey: string; at: number }
/** A saved Collect recipe as policy sees it; `key` is `argsKey` of the whole recipe, so an edit needs a new yes. */
export interface RecipeFacts { id: string; name: string; urls: string[]; scenario: Scenario | null; key: string }
/** What the worker loaded for policy: the person's grants, saved recipes and connected apps (never their tokens). */
export interface Known { grants?: Grant[]; recipes?: RecipeFacts[]; connectors?: ConnectorFacts[] }

/** A sensitive approval counts only when answered at least this long after it was shown. */
export const SENSITIVE_WAIT = 8000;

const stable = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])])) : v;
/** Stable JSON of a call's args: an answer or a grant applies to exactly this call. */
export const argsKey = (args: Record<string, unknown>): string => JSON.stringify(stable(args));

/**
 * An acting call: where it acts, its steps, what it says, and the key an answer binds to. null for a read. `why`: it is
 * sensitive from the call alone (an app call whose tool or args hold a word such as pay, refund, delete or send).
 */
export interface Act { host: string; hosts: string[]; steps: Instruction[]; key: string; text: string; why?: string }

/** An app call policy can take: a connected app's tool that isn't Off, with args that fit its schema. null otherwise. */
export function appOf(call: Call, known: Known = {}): { c: ConnectorFacts; t: AppTool } | null {
  if (call.tool !== 'app_call') return null;
  const c = known.connectors?.find((x) => x.id === call.args.connector);
  const t = c?.tools.find((x) => x.name === call.args.tool);
  if (!c || !t || t.scope === 'off' || unusable(t.name, t.schema) || checkArgs(t.schema, call.args.args)) return null;
  return { c, t };
}

export function actOf(call: Call, known: Known = {}): Act | null {
  // Data leaves the device to an app the person connected: where is the server's host.
  if (call.tool === 'app_call') {
    const a = appOf(call, known);
    if (!a) return null;
    const host = hostOf(a.c.url), args = JSON.stringify(call.args.args);
    const word = sensitiveWord(`${a.t.name} ${args}`);
    return { host, hosts: [host], steps: [], key: argsKey(call.args), text: `send this to ${a.c.name} (${host}), tool ${a.t.name}:\n${args.slice(0, 1000)}`, ...(word && { why: `an app call that says “${word}”` }) };
  }
  // In the person's own tab (a mention): where it acts is the URL the person named.
  if (call.tool === 'act_my_tab') {
    const url = bare(String(call.args.tab ?? '')), s = parseScenario(call.args.steps);
    if (!url || !s) return null;
    const host = hostOf(url);
    return { host, hosts: [host], steps: s.instructions, key: argsKey(call.args), text: `act in your own tab ${url}:\n${s.instructions.map(describe).join('\n')}` };
  }
  if (call.tool === 'act') {
    const url = bare(String(call.args.url ?? '')), s = parseScenario(call.args.steps);
    if (!url || !s) return null;
    const host = hostOf(url);
    return { host, hosts: [host], steps: s.instructions, key: argsKey(call.args), text: `act on ${url}:\n${s.instructions.map(describe).join('\n')}` };
  }
  const r = recipeOf(call, known);
  if (!r || riskOf(r.scenario) !== 'act') return null;
  const hosts = recipeHosts(r);
  const steps = r.scenario!.instructions;
  // The name and URLs come from chrome.storage, which a page's content script could write: quoted, capped, labelled.
  const name = r.name.replace(/\s+/g, ' ').slice(0, 40);
  const urls = r.urls.slice(0, 3).join(', ') + (r.urls.length > 3 ? ` and ${r.urls.length - 3} more` : '');
  return { host: hosts.join(','), hosts, steps, key: r.key, text: `run a saved Collect recipe (name as saved: “${name}”) on ${urls}:\n${steps.map(describe).join('\n')}` };
}

export const recipeOf = (call: Call, known: Known): RecipeFacts | undefined => (call.tool === 'collect' ? known.recipes?.find((x) => x.id === call.args.recipe) : undefined);
export const recipeHosts = (r: RecipeFacts): string[] => [...new Set(r.urls.map(hostOf))].sort();

/** The key an answer to this call binds to: a recipe's always covers the whole recipe, so an edit needs a new yes. */
export const callKey = (call: Call, known: Known = {}): string => recipeOf(call, known)?.key ?? actOf(call, known)?.key ?? argsKey(call.args);

const runsCode = (steps: Instruction[] | undefined): boolean => !!steps?.some((i) => 'evaluate' in i);

/**
 * Why these steps are sensitive before any page is seen, or null: code, typing after a signed-in read, or typing in
 * the person's own tab (signed in everywhere; taint comes only after the call).
 */
export function sensitiveSteps(run: GardenRun, steps: Instruction[], tool?: string): string | null {
  if (runsCode(steps)) return 'it runs code';
  if (tool === 'act_my_tab' && steps.some((i) => 'fill' in i)) return 'it types into your own signed-in tab';
  if (run.tainted && steps.some((i) => 'fill' in i)) return 'it types into a page after reading your signed-in pages';
  return null;
}

const granted = (run: GardenRun, g: Gardener, tool: string, a: Act, known: Known): boolean =>
  !sensitiveSteps(run, a.steps) && !a.why && !!known.grants?.some((x) => x.gardenerId === g.id && x.tool === tool && x.host === a.host && x.argsKey === a.key);

/**
 * Who may answer a request or change garden records: an extension page (`base` is the extension's own URL), never a
 * content script in a web page, nor an extension frame inside one.
 */
export const fromExtensionPage = (sender: { url?: string | undefined; tab?: { url?: string | undefined } | undefined } | null | undefined, base: string): boolean =>
  !!base && !!sender?.url?.startsWith(base) && !sender.tab?.url?.startsWith('http');

/** Is this host one of the gardener's sites, or under one? */
export const onSites = (host: string, sites: string[]): boolean => !!host && sites.some((s) => host === s || host.endsWith(`.${s}`));

// Under taint, a URL passes only if the person gave it or it was linked from a page on the gardener's own sites.
const trusted = (run: GardenRun, g: Gardener, s: Seen): boolean =>
  s.from === 'person' || s.from === 'approved' || (s.from === 'link' && onSites(hostOf(run.steps.find((x) => x.i === s.step)?.url), g.sites));

export function decide(run: GardenRun, gardener: Gardener, call: Call, known: Known = {}): Verdict {
  const act = actOf(call, known);
  // The model never runs code (parseArgs refuses it too); a recipe's code steps are the person's alone, and a recipe
  // sits where a page's content script could plant one.
  if (runsCode(call.tool === 'collect' ? recipeOf(call, known)?.scenario?.instructions : act?.steps)) return 'deny';
  switch (call.tool) {
    case 'read_page': {
      const url = bare(String(call.url ?? call.args.url ?? ''));
      if (!url) return 'deny';
      const seen = run.seen.find((s) => s.url === url);
      if (run.tainted) return seen && trusted(run, gardener, seen) ? 'allow' : 'ask';
      return seen || onSites(hostOf(url), gardener.sites) ? 'allow' : 'ask';
    }
    case 'search':
    case 'mission':
      return run.tainted ? 'ask' : 'allow';
    case 'draft':
    case 'note':
    // Stores an unconfirmed entry only: it reaches no prompt until the person keeps it.
    case 'remember':
    // The run's own gardener's documents (the worker scopes them).
    case 'doc_read':
      return 'allow';
    case 'act':
      return !act ? 'deny' : granted(run, gardener, call.tool, act, known) ? 'allow' : 'ask';
    case 'collect': {
      const r = recipeOf(call, known);
      if (!r) return 'deny';
      // Reach applies to each of the recipe's URLs, as if read.
      const reach = r.urls.map((url) => decide(run, gardener, { tool: 'read_page', args: { url } }));
      if (reach.includes('deny')) return 'deny';
      if (reach.includes('ask')) return 'ask';
      return !act || granted(run, gardener, call.tool, act, known) ? 'allow' : 'ask';
    }
    // Acting in a tab the person named: asked every time, never granted, never pre-approved by a plan.
    case 'act_my_tab':
      return act && decide(run, gardener, { tool: 'read_my_tab', args: { tab: call.args.tab } }) === 'allow' ? 'ask' : 'deny';
    // Carries data off the device: asked every time, unless the person marked the tool Read and granted this exact
    // call, and never under taint, since its args could carry what was read.
    case 'app_call': {
      const a = appOf(call, known);
      if (!a || !act) return 'deny';
      return a.t.scope === 'read' && !run.tainted && granted(run, gardener, call.tool, act, known) ? 'allow' : 'ask';
    }
    case 'read_my_tab':
      return mentionsOf(run).some((m) => m.url === call.args.tab) ? 'allow' : 'deny';
    case 'notify':
      return run.steps.some((s) => s.tool === 'notify' && s.state === 'done') ? 'deny' : 'allow';
    // Stored off until the person turns it on, so only where it may reach matters: the gardener's sites, no new site
    // written in a request, and none of the person's tabs. Never after a signed-in read: its runs start untainted, so
    // its URLs or goal could carry what was read.
    case 'propose_routine': {
      if (run.tainted) return 'deny';
      const w = parseWork(call.args.work);
      if (!w || requestOf(w)?.tabs?.length) return 'deny';
      return personUrls(w).every((u) => onSites(hostOf(u), gardener.sites)) ? 'allow' : 'deny';
    }
    case 'doc_write':
      return typeof call.args.text === 'string' && call.args.text.length <= MEM.doc && !docRefused(String(call.args.path ?? '')) ? 'allow' : 'deny';
    default:
      return 'deny';
  }
}

/**
 * Approve all may answer this request of `run`: a non-sensitive reach in an untainted run (under taint a reach is
 * asked because its URL or query could carry what was read), or a non-sensitive act a blanket yes covers. Never a
 * sensitive request, a question, a plan or anything else. The worker checks it again.
 */
export const approveAllOk = (q: Request, run: GardenRun): boolean =>
  !q.answer && !q.sensitive && ((q.kind === 'reach' && !run.tainted) || (q.kind === 'approve' && !!ruleOf(q.tool).blanket));

/**
 * Whether a call taints the run, after it ran or threw (a throw may still have shown signed-in data): its result says
 * so, or its tool's rule does (`url`: where it ended).
 */
export function taintsAfter(tool: string, r: { taint?: boolean | undefined; url?: string | undefined }, args: Record<string, unknown> = {}, sites: string[] = []): boolean {
  const { taints } = ruleOf(tool);
  return !!r.taint || taints === 'always' || (taints === 'sites' && [String(args.url ?? ''), r.url ?? ''].some((u) => onSites(hostOf(u), sites)));
}

/** "Always" may answer this request: a non-sensitive approve whose tool may be granted (an app tool only when marked Read). */
export const alwaysOk = (q: Request): boolean => q.kind === 'approve' && !q.sensitive && !ruleOf(q.tool).noAlways && !q.appWrite;

/** `seen` plus new URLs (deduplicated, fragments removed), capped at 300. */
export function addSeen(seen: Seen[], urls: string[], from: Seen['from'], step?: number): Seen[] {
  const out = [...seen];
  for (const u of urls) {
    const url = bare(u);
    if (url && out.length < LIMITS.seen && !out.some((s) => s.url === url)) out.push(step === undefined ? { url, from } : { url, from, step });
  }
  return out;
}
