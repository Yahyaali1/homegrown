// Gardener records (docs/plan/S-gardeners.md). Each is versioned; a parser returns null for an invalid record or a
// newer `v`, and callers ignore such records (never delete them), so an older build leaves newer data alone.
import type { Ability } from '../model.ts';

export interface Gardener {
  v: 1;
  id: string;
  name: string;
  instructions: string;
  /** Hosts whose pages are read signed in; each matches its subdomains. */
  sites: string[];
  /** Model and tool time per run. */
  minutes: number;
  createdAt: number;
  /** Its flower in the Garden tab (optional, so v stays 1). */
  look?: Look;
  /** Its reads and acts add the page's console errors and failed requests (needs the `debugger` permission). */
  devtools?: boolean;
}

/** A gardener's flower: never 10 petals (the Homegrown mark's), always leaning left, the leaf on the right. */
export interface Look { petals: 5 | 6 | 7 | 8 | 9 | 11 | 12; lean: number /* 0.3..1 */ }
export const PETALS = [5, 6, 7, 8, 9, 11, 12] as const;

export function parseLook(raw: unknown): Look | null {
  if (!isObj(raw) || !PETALS.includes(raw.petals as Look['petals'])) return null;
  const lean = raw.lean;
  return typeof lean === 'number' && lean >= 0.3 && lean <= 1 ? { petals: raw.petals as Look['petals'], lean } : null;
}

export const randomLook = (rand = Math.random): Look => ({ petals: PETALS[Math.floor(rand() * PETALS.length)]!, lean: Math.round((0.3 + rand() * 0.7) * 100) / 100 });

/** A gardener's flower: its stored look, or (none stored, or one this build can't read) the same one from its id each time. */
export function lookOf(g: { id: string; look?: Look | undefined }): Look {
  if (g.look) return g.look;
  let h = 7;
  for (const c of g.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return randomLook(() => (h = (Math.imul(h, 1103515245) + 12345) >>> 0) / 2 ** 32);
}

export type When =
  | { kind: 'every'; hours: number }
  | { kind: 'daily'; at: string }
  | { kind: 'weekly'; days: number[]; at: string }
  /** A weekday of a week of the month (`-1` the last), or a date (past the month's end: its last day). */
  | { kind: 'monthly'; on: { week: 1 | 2 | 3 | 4 | -1; day: number } | { date: number }; at: string }
  /** One time; then the routine pauses. `deadline` (minutes): its run fails after slot + deadline, a slot missed by more never runs. */
  | { kind: 'once'; date: string; at: string; deadline?: number }
  /** Checked every `every` minutes (code, no model): the work runs when lines were added, holding an `onlyIf` word if any. */
  | { kind: 'event'; url: string; every: number; onlyIf?: string[] };

/** What an event routine's check saw: its run's data starts with the diff. Signed in: the run starts tainted. */
export interface Trigger { url: string; diff: string /* ≤ 4000 */; signedIn: boolean }

export type Work =
  | { kind: 'read'; urls: string[] } // direct
  | { kind: 'mission'; goal: string } // direct
  | { kind: 'ask'; request: string; tabs?: Mention[] } // open: needs a model with `agent.loop`
  | { kind: 'plan'; request: string; tabs?: Mention[] }; // a plan the person approves, then direct work: needs `plan`

/** One call of a plan: a tool and its parsed args. */
export interface PlannedCall { tool: string; args: Record<string, unknown> }

/**
 * A tab the person named for `read_my_tab`: its URL when named. By hand it also keeps the tab's id, and the tab must
 * still be on that URL; a routine keeps the URL only and finds an open tab with exactly it on each run.
 */
export interface Mention { url: string; title: string; tabId?: number }

export interface Routine {
  v: 1;
  id: string;
  gardenerId: string;
  name: string;
  when: When;
  tz: string;
  work: Work;
  paused: boolean;
  nextDue: number;
  lastRunId?: string;
  /** Slots skipped while the last run still worked (last 5); handed to the next run, then cleared. */
  skipped?: number[];
  createdAt: number;
  /** Who wrote it; none is the person. A routine the model proposed is stored paused until the person turns it on. */
  by?: 'person' | 'model' | 'preset';
  /** A one-off whose slot passed its deadline: it never ran. */
  missed?: true;
}

export type Status = 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'stopped';

/** Where a reachable URL came from. Under taint only `person`, `approved` and links from the gardener's sites pass. */
export interface Seen {
  url: string;
  from: 'person' | 'approved' | 'search' | 'link';
  /** For `link`: the step whose page held it. */
  step?: number;
}

export interface GardenRun {
  v: 1;
  id: string;
  gardenerId: string;
  routineId?: string;
  work: Work;
  /** Pinned when the run first goes `running`. */
  model?: string;
  maxTokens?: number;
  agent?: { loop: boolean; maxSteps: number };
  /** The pinned model's measured abilities. */
  abilities?: Ability[];
  /** The plan the person approved: call j is step j. */
  plan?: PlannedCall[];
  status: Status;
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
  usedMs: number;
  turns: Turn[];
  steps: Step[];
  requests: Request[];
  seen: Seen[];
  tainted: boolean;
  answer?: string;
  /** The final check said the task wasn't met, or time ran out. */
  best?: boolean;
  why?: string;
  interrupted?: number;
  /** The routine's skipped slots, shown as the run's first line. */
  skipped?: number[];
  /** The person's messages to the run. A Steer message goes into the next think's instruction part, once (`usedAt`). */
  inbox?: Message[];
  /** Asked as a follow-up to this earlier run: its answer and step digests start the data. */
  followUp?: string;
  /** When the person last opened it: a run that ended after is Unread. */
  seenAt?: number;
  /** What the run made, each a card with Open. */
  created?: Created[];
  /** The step the person last retried, and how many tries it has had: its re-run keeps the count. */
  retry?: { i: number; tries: number };
  /** A helper run: the read of more than 5 pages it is a part of (decision 8). */
  parentId?: string;
  /** Queued, but not before this: a read waiting out its auto-retry, which holds no queue slot meanwhile. */
  retryAt?: number;
  /** The page change that started it (an event routine). */
  trigger?: Trigger;
  /** A one-off routine's slot plus its deadline: not done by then, it fails "Deadline passed". */
  deadline?: number;
  /** Downloads its tabs started (matched by referrer), each also a `file` card. */
  files?: RunFile[];
}

/** A download kept with a run: Chrome's download id, its file name and URL. */
export interface RunFile { id: number; name: string; url: string; at: number }

export interface Created { kind: 'draft' | 'note' | 'routine' | 'file' | 'doc' | 'artifact'; title: string; ref: string }

/** Where a run sits in the history: Needs you, Unread (ended after it was last opened), then by routine, then by hand. */
export function historyGroup(r: GardenRun): 'needs' | 'unread' | 'routine' | 'hand' {
  if (r.status === 'waiting' && !helping(r)) return 'needs';
  if (r.endedAt !== undefined && (r.seenAt ?? -1) < r.endedAt) return 'unread';
  return r.routineId ? 'routine' : 'hand';
}

/** A parent waiting on its helpers: working, not waiting for the person. */
export const helping = (r: GardenRun): boolean => r.status === 'waiting' && r.requests.some((q) => q.kind === 'helpers' && !q.answer);

/** A helper starts only while its parent still waits on helpers: a Stop may have landed since it was stored. */
export const mayStart = (run: GardenRun, parent: GardenRun | null | undefined): boolean => !run.parentId || (!!parent && helping(parent));

const over = (r: GardenRun) => r.status === 'done' || r.status === 'failed' || r.status === 'stopped';
/** Ids to delete: ended runs past the newest `keep` (helpers don't count, and go with their parent or when it is gone). */
export function pruneIds(runs: GardenRun[], keep: number): string[] {
  const top = runs.filter((r) => !r.parentId).sort((a, b) => b.queuedAt - a.queuedAt);
  const gone = new Set(top.slice(keep).filter(over).map((r) => r.id));
  const kept = new Set(top.map((r) => r.id).filter((id) => !gone.has(id)));
  return [...gone, ...runs.filter((r) => r.parentId && !kept.has(r.parentId) && over(r)).map((r) => r.id)];
}

export interface Message { id: string; text: string /* ≤ 1000 */; at: number; steer: boolean; usedAt?: number }

export interface Turn {
  purpose: 'choose' | 'repair' | 'check' | 'word' | 'plan' | 'sum';
  reply: string;
  at: number;
}

export interface Step {
  i: number;
  tool: string;
  args: Record<string, unknown>;
  effect: 'read' | 'act';
  state: 'started' | 'done' | 'failed';
  digest?: string;
  output?: string;
  links?: string[];
  /** The tab's final URL after a read: taint and link trust follow it, not the requested URL. */
  url?: string;
  error?: string;
  at: number;
  /** Tries after the first: an automatic retry of a read, or the person's Retry step. */
  tries?: number;
}

export interface Request {
  id: string;
  /**
   * `helpers`: a parent waits on its helper runs; only code answers it, when they all end. `help`: a page asked for a
   * check for humans in tab `tabId`; yes reads it again, no fails the step.
   */
  kind: 'reach' | 'question' | 'approve' | 'takeover' | 'did-it-happen' | 'plan' | 'helpers' | 'help';
  step?: number;
  /** The exact call an answer applies to: its tool and `argsKey(args)`. */
  tool?: string;
  argsKey?: string;
  /** An approve's host: an "always" answer grants the call there only. */
  host?: string;
  /** A sensitive approve: the reason shown, and (when the page stopped it) the step it covers, once. */
  why?: string;
  index?: number;
  text: string;
  sensitive: boolean;
  tabId?: number;
  shownAt?: number;
  expiresAt?: number;
  /**
   * approve: yes, no or always (a grant; never for a sensitive one); did-it-happen and reach: yes or no. `args`: a yes
   * to the call as the person edited it, which code checks as a new call.
   */
  answer?: { value: 'yes' | 'no' | 'always' | string; at: number; args?: Record<string, unknown> };
  /** plan: the calls the model proposed. */
  calls?: PlannedCall[];
  /** An approve made by a plan's yes: it counts only where policy asks and the call is not sensitive at call time. */
  fromPlan?: true;
  /** question: asked one at a time; the answer is one JSON object of answers, keyed by question. */
  questions?: { q: string; options?: string[] }[];
  /** An edited call asked again (it turned sensitive): the request whose edited yes it follows. It can't be edited again. */
  editedFrom?: string;
  noEdit?: true;
}

// `urls`: a recipe's, and each helper's share of a read; `readUrls`: a read, split into helpers above `urls`.
export const LIMITS = { sites: 20, urls: 5, readUrls: 25, tabs: 5, seen: 300, output: 4000, links: 50, skipped: 5 } as const;

// Shared-hosting suffixes: anyone can publish under them, so one entry would trust every tenant.
export const PUBLIC_SUFFIXES = [
  'github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com',
  'appspot.com', 'herokuapp.com', 'onrender.com', 'fly.dev', 'glitch.me', 'blogspot.com', 'wordpress.com',
  'azurewebsites.net', 'cloudfront.net', 'amazonaws.com', 'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'co.jp',
  'co.nz', 'co.in', 'com.br',
];
const SECOND_LEVEL = /^(co|com|net|org|ac|gov|edu|ne|or)\.[a-z]{2}$/; // co.za, com.mx… the list can't name them all

/** "https://WWW.Example.com:8080/x" → "example.com"; null for a single label, a shared suffix, or not a host. */
export function site(entry: string): string | null {
  const h = entry.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^(\*\.|www\.)/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)) return null;
  return PUBLIC_SUFFIXES.includes(h) || SECOND_LEVEL.test(h) ? null : h;
}

/** Normalises the person's site lines; `refused` names the entries that can't be sites. */
export function sitesOf(lines: string[]): { sites: string[]; refused: string[] } {
  const sites: string[] = [], refused: string[] = [];
  for (const l of lines.filter((l) => l.trim())) {
    const s = site(l);
    if (!s) refused.push(l.trim());
    else if (!sites.includes(s)) sites.push(s);
  }
  return { sites, refused };
}

/** The URL with its fragment removed; null unless http(s). */
export function bare(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown, max: number, min = 1): x is string => typeof x === 'string' && x.trim().length >= min && x.length <= max;
const int = (x: unknown, min: number, max: number): x is number => Number.isInteger(x) && (x as number) >= min && (x as number) <= max;
const time = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const AT = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-03-02" → its UTC midnight; null unless a real date. */
export function dateOf(s: unknown): number | null {
  const m = typeof s === 'string' ? DATE.exec(s) : null;
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(t).toISOString().startsWith(s as string) ? t : null;
}

export function validTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function parseGardener(raw: unknown): Gardener | null {
  if (!isObj(raw) || raw.v !== 1 || !str(raw.id, 200) || !str(raw.name, 40) || !str(raw.instructions, 2000, 0)) return null;
  if (!Array.isArray(raw.sites) || raw.sites.length > LIMITS.sites || !raw.sites.every((s) => typeof s === 'string')) return null;
  const { sites, refused } = sitesOf(raw.sites as string[]);
  const minutes = raw.minutes ?? 10;
  if (refused.length || !int(minutes, 1, 60) || !time(raw.createdAt)) return null;
  // An unknown look (a newer build's, or broken) is dropped, never the gardener: the UI draws one from its id.
  const look = raw.look === undefined ? null : parseLook(raw.look);
  return { v: 1, id: raw.id, name: raw.name.trim(), instructions: raw.instructions, sites, minutes, createdAt: raw.createdAt, ...(look && { look }), ...(raw.devtools === true && { devtools: true }) };
}

export function parseWhen(raw: unknown): When | null {
  if (!isObj(raw)) return null;
  if (raw.kind === 'every') return int(raw.hours, 1, 24) ? { kind: 'every', hours: raw.hours } : null;
  if (raw.kind === 'event') {
    const url = typeof raw.url === 'string' ? bare(raw.url) : null;
    if (!url || !int(raw.every, 15, 1440)) return null;
    if (raw.onlyIf === undefined) return { kind: 'event', url, every: raw.every };
    const words = Array.isArray(raw.onlyIf) && raw.onlyIf.every((w) => str(w, 40)) ? (raw.onlyIf as string[]).map((w) => w.trim()) : null;
    return words?.length && words.length <= 10 ? { kind: 'event', url, every: raw.every, onlyIf: [...new Set(words)] } : null;
  }
  if (typeof raw.at !== 'string' || !AT.test(raw.at)) return null;
  if (raw.kind === 'daily') return { kind: 'daily', at: raw.at };
  if (raw.kind === 'once') {
    if (dateOf(raw.date) === null || (raw.deadline !== undefined && !int(raw.deadline, 5, 10080))) return null;
    return { kind: 'once', date: raw.date as string, at: raw.at, ...(raw.deadline !== undefined && { deadline: raw.deadline as number }) };
  }
  if (raw.kind === 'monthly') {
    const on = raw.on;
    if (isObj(on) && int(on.date, 1, 31)) return { kind: 'monthly', on: { date: on.date }, at: raw.at };
    if (!isObj(on) || ![1, 2, 3, 4, -1].includes(on.week as number) || !int(on.day, 0, 6)) return null;
    return { kind: 'monthly', on: { week: on.week as 1 | 2 | 3 | 4 | -1, day: on.day }, at: raw.at };
  }
  if (raw.kind !== 'weekly' || !Array.isArray(raw.days) || !raw.days.length || !raw.days.every((d) => int(d, 0, 6))) return null;
  return { kind: 'weekly', days: [...new Set(raw.days as number[])].sort(), at: raw.at };
}

export function parseWork(raw: unknown): Work | null {
  if (!isObj(raw)) return null;
  if (raw.kind === 'mission') return str(raw.goal, 300) ? { kind: 'mission', goal: raw.goal } : null;
  if (raw.kind === 'ask' || raw.kind === 'plan') {
    const kind = raw.kind;
    if (!str(raw.request, 1000)) return null;
    if (raw.tabs === undefined) return { kind, request: raw.request };
    const tabs = Array.isArray(raw.tabs) && raw.tabs.length <= LIMITS.tabs ? raw.tabs.map(parseMention) : [null];
    return tabs.every((t) => t) ? { kind, request: raw.request, tabs: tabs as Mention[] } : null;
  }
  if (raw.kind !== 'read' || !Array.isArray(raw.urls) || !int(raw.urls.length, 1, LIMITS.readUrls)) return null;
  const urls = raw.urls.map((u) => (typeof u === 'string' ? bare(u) : null));
  return urls.every((u) => u) ? { kind: 'read', urls: urls as string[] } : null;
}

function parseMention(raw: unknown): Mention | null {
  if (!isObj(raw) || !str(raw.url, 2000) || !bare(raw.url) || typeof raw.title !== 'string') return null;
  const m: Mention = { url: raw.url, title: raw.title.slice(0, 200) };
  if (raw.tabId !== undefined) {
    if (!int(raw.tabId, 0, 2 ** 31)) return null;
    m.tabId = raw.tabId;
  }
  return m;
}

export function parseRoutine(raw: unknown): Routine | null {
  if (!isObj(raw) || raw.v !== 1 || !str(raw.id, 200) || !str(raw.gardenerId, 200) || !str(raw.name, 80)) return null;
  const when = parseWhen(raw.when), work = parseWork(raw.work);
  if (!when || !work || !validTz(raw.tz) || typeof raw.paused !== 'boolean' || !time(raw.nextDue) || !time(raw.createdAt)) return null;
  const r: Routine = { v: 1, id: raw.id, gardenerId: raw.gardenerId, name: raw.name.trim(), when, tz: raw.tz, work, paused: raw.paused, nextDue: raw.nextDue, createdAt: raw.createdAt };
  if (typeof raw.lastRunId === 'string') r.lastRunId = raw.lastRunId;
  if (Array.isArray(raw.skipped)) r.skipped = raw.skipped.filter(time).slice(-LIMITS.skipped);
  if (raw.by === 'person' || raw.by === 'model' || raw.by === 'preset') r.by = raw.by;
  if (raw.missed === true) r.missed = true;
  return r;
}

const STATUSES: Status[] = ['queued', 'running', 'waiting', 'done', 'failed', 'stopped'];
const ORIGINS: Seen['from'][] = ['person', 'approved', 'search', 'link'];

// ponytail: turns, steps and requests are checked for shape only (objects with their key fields); runs are only ever
// written by this code, so deeper checks wait for a v2 record.
export function parseRun(raw: unknown): GardenRun | null {
  if (!isObj(raw) || raw.v !== 1 || !str(raw.id, 200) || !str(raw.gardenerId, 200) || !parseWork(raw.work)) return null;
  if (!STATUSES.includes(raw.status as Status) || !time(raw.queuedAt) || !time(raw.usedMs) || typeof raw.tainted !== 'boolean') return null;
  if (raw.maxTokens !== undefined && !int(raw.maxTokens, 1, 1e8)) return null;
  if (raw.agent !== undefined && !(isObj(raw.agent) && typeof raw.agent.loop === 'boolean' && int(raw.agent.maxSteps, 1, 100))) return null;
  if (raw.abilities !== undefined && !(Array.isArray(raw.abilities) && raw.abilities.every((a) => typeof a === 'string'))) return null;
  if (raw.plan !== undefined && !(Array.isArray(raw.plan) && raw.plan.every((c) => isObj(c) && typeof c.tool === 'string' && isObj(c.args)))) return null;
  const list = (x: unknown, ok: (o: Record<string, unknown>) => boolean) => Array.isArray(x) && x.every((o) => isObj(o) && ok(o));
  if (!list(raw.turns, (t) => typeof t.reply === 'string' && typeof t.purpose === 'string')) return null;
  if (!list(raw.steps, (s) => int(s.i, 0, 1e4) && typeof s.tool === 'string' && isObj(s.args) && typeof s.state === 'string')) return null;
  if (!list(raw.requests, (r) => typeof r.id === 'string' && typeof r.kind === 'string' && typeof r.text === 'string')) return null;
  if (!list(raw.seen, (s) => typeof s.url === 'string' && ORIGINS.includes(s.from as Seen['from']))) return null;
  return { ...(raw as unknown as GardenRun), work: parseWork(raw.work)! };
}

/** The URLs the person gave: a read's pages, or absolute http(s) URLs written in a request (fragment removed, ≤ 20). */
export function personUrls(w: Work): string[] {
  if (w.kind === 'read') return w.urls;
  if (w.kind !== 'ask' && w.kind !== 'plan') return [];
  const urls = [...w.request.matchAll(/https?:\/\/[^\s<>"'()\[\]]+/g)].map((m) => bare(m[0].replace(/[.,;:!?]+$/, ''))).filter((u): u is string => !!u);
  return [...new Set(urls)].slice(0, 20);
}

/** A new queued run. The person's own URLs are reachable from the start. */
export function newRun(o: { id: string; gardenerId: string; routineId?: string; work: Work; now: number; skipped?: number[]; trigger?: Trigger; deadline?: number }): GardenRun {
  const run: GardenRun = {
    v: 1, id: o.id, gardenerId: o.gardenerId, work: o.work, status: 'queued', queuedAt: o.now, usedMs: 0,
    turns: [], steps: [], requests: [], tainted: false,
    seen: personUrls(o.work).map((url) => ({ url, from: 'person' })),
  };
  if (o.routineId) run.routineId = o.routineId;
  if (o.skipped?.length) run.skipped = o.skipped;
  if (o.trigger) Object.assign(run, { trigger: o.trigger, tainted: o.trigger.signedIn });
  if (o.deadline !== undefined) run.deadline = o.deadline;
  return run;
}
