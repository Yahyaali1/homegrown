// A gardener run as data: `next(run, ctx)` reads the stored run and says what to do next. The worker does it, appends
// the result (a turn, a step, a request), persists, and calls `next` again, so waiting, restarts and resume are one
// path. Model calls are actions too; their replies are stored on the run as turns.
import type { Sampling } from '../model.ts';
import { contextChars, defang, parseJsonObject } from '../text.ts';
import { jsonArray } from '../html.ts';
import { actOf, addSeen, argsKey, callKey, decide, planCovers, sensitiveSteps, SENSITIVE_WAIT, type Known } from './policy.ts';
import { DEADLINE, expired } from './schedule.ts';
import { LIMITS, newRun, type Gardener, type GardenRun, type PlannedCall, type Request, type Routine, type Step, type Turn, type Work } from './records.ts';
import { describe } from '../scrape/scenario.ts';
import { EDITABLE, parseArgs, TOOLS, type ToolSpec } from './tools.ts';
import { notesBlock, type Note } from './notes.ts';
import { memoryParts, type Entity } from '../memory.ts';

/**
 * `notes`: the gardener's notes the worker retrieved, best first; as many as fit go into the data, never the prompt.
 * `earlier`: a follow-up's earlier run (`earlierOf`), which starts its data; `earlierTainted`: that run is tainted
 * now (read fresh: a retry may have tainted it since), so a think that reads it taints this run first.
 * `anchors`: the confirmed entities the request names with `@`; `forEntity`: the routine's entity (`Routine.for`).
 */
export interface Ctx extends Known { gardener: Gardener; routine?: Routine; tools: ToolSpec[]; now: number; notes?: Note[]; earlier?: string; earlierTainted?: boolean; anchors?: Entity[]; forEntity?: Entity }

export type Action =
  /**
   * `taint`: the data holds notes (private): the worker taints the run before the model sees them. `steer`: the inbox
   * messages in the prompt, which the worker marks used with the turn.
   */
  | { think: { purpose: Turn['purpose']; prompt: string; data: string; sampling?: Sampling; taint?: true; steer?: string[] } }
  /**
   * Run a tool and store the step at index `i` (a re-run replaces a `started` step). `answered`: the request whose yes
   * covers this call (an edited one), which the worker checks by id.
   */
  | { call: { i: number; tool: string; args: Record<string, unknown>; answered?: string } }
  /** Store this step as it is: a refused or denied call, or an answered "did it happen?". */
  | { record: Step }
  | { request: Omit<Request, 'id'> }
  | { done: { answer: string; best?: boolean } }
  | { fail: string };

export const OPEN_REFUSED = 'This model runs routines with set steps. A model measured for open requests can take this one.';
export const PLAN_REFUSED = 'This model can’t write plans yet.';
export const BAD_REPLY = "The model's reply couldn't be read.";
export const TOO_LONG = 'The instructions are too long for this model.';
export const HELP_REFUSED = 'The site asked for a check for humans, and you said no.';
const WORD = 'Here is what changed on each page since the last check (lines with + were added, − removed; a page under "First look:" is new, so say briefly what it holds). In two or three sentences, say what changed that matters. If nothing did, say so.';
const REPAIR = 'Your reply was not one valid JSON object for a listed tool or an answer. Reply with only the JSON.';
const PLAN_REPAIR = 'Your reply was not one JSON array of calls to listed tools with valid args. Reply with only the array.';
const SUM = (request: string, followUp: boolean) => `The task: ${request}. Below are ${followUp ? 'an earlier answer and ' : ''}the results of the planned steps. Answer the task from them in a few sentences. If they don't answer it, say what is missing.`;
const GREEDY = { temperature: 0 };
const HOUR = 3_600_000;

export { argsKey };

/** A yes: "always" is a yes that also stored a grant. */
export const said = (q: Request): boolean => q.answer?.value === 'yes' || q.answer?.value === 'always';

/**
 * The person's answer for exactly call `i` (its tool and key), if it counts: the newest one asked, answered, and for a
 * sensitive approval, answered at least 8 s after it was shown.
 */
export function answerFor(run: GardenRun, i: number, tool: string, key: string): Request | undefined {
  const q = run.requests.findLast((x) => (x.kind === 'reach' || x.kind === 'approve') && x.step === i && x.tool === tool && x.argsKey === key);
  return q?.answer && !early(q) ? q : undefined;
}

const early = (q: Request) => q.kind === 'approve' && q.sensitive && said(q) && (q.shownAt === undefined || q.answer!.at - q.shownAt < SENSITIVE_WAIT);

/** The request a call names (`answered`), if its yes counts: said yes, and for a sensitive one, 8 s or more after shown. */
export const answeredBy = (run: GardenRun, id: string): Request | undefined => run.requests.find((q) => q.id === id && said(q) && !early(q));

/**
 * The person's yes to an approve card with edited args, checked: only an editable approve, only a yes (a grant is
 * built from the original call), and the args parsed again. `{}` when nothing changed; a string says why not.
 */
export function parseEdit(q: Request, value: string, raw: unknown): { args?: Record<string, unknown> } | string {
  if (raw === undefined) return {};
  if (q.kind !== 'approve' || q.noEdit || !EDITABLE.includes(q.tool ?? '')) return 'This request can’t be edited.';
  if (value !== 'yes') return 'An edited action can be approved only with yes: Always would allow the original.';
  const spec = TOOLS.find((t) => t.name === q.tool);
  const args = spec && parseArgs(spec, raw);
  if (!args) return 'These arguments aren’t valid for this action.';
  return argsKey(args) === q.argsKey ? {} : { args };
}

/** One line per step for the person and the model. */
export function digest(tool: string, args: Record<string, unknown>, r: { error: string } | { n: number; unit: 'chars' | 'results' | 'rows' }): string {
  const first = String(Object.values(args)[0] ?? '').slice(0, 60);
  return `${tool} ${first} → ${'error' in r ? `failed: ${r.error}` : `ok (${r.n} ${r.unit})`}`;
}

/** Why the pinned model can't take this run: open work needs `agent.loop`; a plan needs `plan` (or `agent.loop`). */
export function refusal(run: GardenRun): string | null {
  if (run.agent?.loop) return null;
  if (run.work.kind === 'ask') return OPEN_REFUSED;
  return run.work.kind === 'plan' && !run.abilities?.includes('plan') ? PLAN_REFUSED : null;
}

export function next(run: GardenRun, ctx: Ctx): Action {
  if (!run.maxTokens || !run.agent) return { fail: 'No model was pinned for this run.' };
  const refused = refusal(run);
  if (refused) return { fail: refused };
  if (run.deadline !== undefined && run.deadline <= ctx.now) return { fail: DEADLINE };
  if (run.usedMs >= ctx.gardener.minutes * 60_000) return { done: { answer: soFar(run), best: true } };
  const last = run.steps.at(-1);
  if (last?.state === 'started') return resume(run, ctx, last);
  if (run.work.kind === 'ask') return open(run, ctx, run.work.request);
  if (run.work.kind === 'plan') return planned(run, ctx, run.work.request);
  if (run.work.kind === 'mission') {
    if (!last) return attempt(run, ctx, 0, 'mission', { goal: run.work.goal });
    return last.state === 'done' ? { done: { answer: last.output ?? '' } } : { fail: last.error ?? 'The mission failed.' };
  }
  const { urls } = run.work;
  // More pages than one run reads: helper runs read them, and this run waits until code answers that they ended.
  if (urls.length > LIMITS.urls && !run.parentId && !run.requests.some((q) => q.kind === 'helpers' && q.answer)) {
    return { request: { kind: 'helpers', text: `${count(helpersFor(urls.length))} read ${urls.length} pages.`, sensitive: false } };
  }
  if (run.steps.length < urls.length) return attempt(run, ctx, run.steps.length, 'read_page', { url: urls[run.steps.length] });
  // A helper only reads: its parent makes the one think over every helper's pages.
  if (run.parentId) return { done: { answer: run.steps.map((s) => s.digest ?? `${s.tool} ${s.state}`).join('\n') } };
  return word(run, ctx, urls);
}

const helpersFor = (n: number) => Math.ceil(n / LIMITS.urls);
const count = (n: number) => `${n} helper${n === 1 ? '' : 's'}`;
const ended = (r: GardenRun) => r.status === 'done' || r.status === 'failed' || r.status === 'stopped';
const NOT_READ = 'Not read: its helper stopped.';

/** A parent's helpers: 5 of its pages each, with its gardener, routine, model pin, `seen` and taint. Fixed ids, so a restart makes no more. */
export function helpersOf(parent: GardenRun, now: number): GardenRun[] {
  if (parent.work.kind !== 'read') return [];
  const { urls } = parent.work;
  return Array.from({ length: helpersFor(urls.length) }, (_, k) => ({
    ...newRun({ id: `${parent.id}.h${k + 1}`, gardenerId: parent.gardenerId, work: { kind: 'read', urls: urls.slice(k * LIMITS.urls, (k + 1) * LIMITS.urls) }, now: now + k, ...(parent.routineId && { routineId: parent.routineId }) }),
    parentId: parent.id, seen: parent.seen, tainted: parent.tainted,
    ...(parent.deadline !== undefined && { deadline: parent.deadline }),
    ...(parent.model && { model: parent.model }), ...(parent.maxTokens && { maxTokens: parent.maxTokens }), ...(parent.agent && { agent: parent.agent }), ...(parent.abilities && { abilities: parent.abilities }),
  }));
}

/**
 * Code's answer to a parent's helpers wait, once every helper ended: their steps become the parent's (page j is step
 * j; one a helper didn't finish is failed), any helper's taint taints the parent, and the parent is queued for its
 * word think. False while one still works.
 */
export function mergeHelpers(parent: GardenRun, kids: GardenRun[], now: number): boolean {
  const q = parent.requests.findLast((x) => x.kind === 'helpers' && !x.answer);
  if (parent.status !== 'waiting' || !q || parent.work.kind !== 'read' || !kids.every(ended)) return false;
  parent.steps = parent.work.urls.map((url, j): Step => {
    const s = kids.find((k) => k.id === `${parent.id}.h${Math.floor(j / LIMITS.urls) + 1}`)?.steps.find((x) => x.i === j % LIMITS.urls);
    if (s && s.state !== 'started') return { ...s, i: j };
    return { i: j, tool: 'read_page', args: { url }, effect: 'read', state: 'failed', error: NOT_READ, digest: digest('read_page', { url }, { error: NOT_READ }), at: now };
  });
  parent.tainted ||= kids.some((k) => k.tainted);
  q.answer = { value: 'done', at: now };
  parent.status = 'queued';
  return true;
}

/**
 * Resume all: each failed or stopped helper is queued again from its first unfinished page (with the parent's taint,
 * and a fresh interruption count). An ended parent waits on them again, its merged pages and answer gone. Returns the
 * runs it changed, or why not.
 */
export function resumeAll(parent: GardenRun, kids: GardenRun[], requestId: string): GardenRun[] | string {
  if (!parent.requests.some((q) => q.kind === 'helpers')) return 'This run has no helpers.';
  const waiting = parent.status === 'waiting' && parent.requests.some((q) => q.kind === 'helpers' && !q.answer);
  if (!waiting && !ended(parent)) return 'It’s still working.';
  const again = kids.filter((k) => k.parentId === parent.id && (k.status === 'failed' || k.status === 'stopped'));
  if (!again.length) return 'No helper failed or stopped.';
  for (const k of again) {
    const cut = k.steps.findIndex((s) => s.state !== 'done');
    if (cut >= 0) k.steps = k.steps.slice(0, cut);
    Object.assign(k, { status: 'queued', interrupted: 0, tainted: k.tainted || parent.tainted });
    for (const x of ['answer', 'best', 'why', 'endedAt', 'retryAt'] as const) delete k[x];
  }
  if (waiting) return again;
  Object.assign(parent, { status: 'waiting', steps: [], turns: [], usedMs: 0, interrupted: 0 });
  parent.requests = [...parent.requests.filter((q) => q.kind !== 'helpers' && q.step === undefined),
    { id: requestId, kind: 'helpers', text: `${count(again.length)} read again.`, sensitive: false }];
  for (const x of ['answer', 'best', 'why', 'endedAt', 'retry'] as const) delete parent[x];
  return [parent, ...again];
}

/** A request only code answers: a page's answer to it is refused. */
export const answerRefused = (q: Request): string | null => (q.kind === 'helpers' ? 'Only Homegrown answers that: it waits for the helpers to end.' : null);

/** Expiry: a request lasts 24 h, by hand or in a routine run (a waiting run doesn't block the routine's next one). */
const expiresAt = ({ now }: Ctx) => now + 24 * HOUR;

// A step the worker started but never finished. A read is safe to run again; an act may already have happened.
function resume(run: GardenRun, ctx: Ctx, step: Step): Action {
  // ponytail: a started notify may have been shown already; counting it done keeps it to once per run.
  if (step.tool === 'notify') return { record: { ...step, state: 'done', at: ctx.now } };
  if (step.effect === 'read') return { call: { i: step.i, tool: step.tool, args: step.args } };
  const r = run.requests.find((q) => q.kind === 'did-it-happen' && q.step === step.i && q.answer);
  const act = actOf({ tool: step.tool, args: step.args }, ctx);
  const what = act ? `${ctx.gardener.name} started to ${act.text}` : `${ctx.gardener.name} started ${step.tool} ${String(Object.values(step.args)[0] ?? '').slice(0, 200)}`;
  if (!r?.answer) return { request: { kind: 'did-it-happen', step: step.i, tool: step.tool, argsKey: argsKey(step.args), text: `${what.slice(0, 1400)}\nThe worker stopped before it finished. Did it happen?`, sensitive: false, expiresAt: expiresAt(ctx) } };
  const yes = said(r);
  return { record: { ...step, state: yes ? 'done' : 'failed', ...(yes ? {} : { error: 'It did not happen.' }), at: ctx.now } };
}

const failed = (ctx: Ctx, i: number, tool: string, args: Record<string, unknown>, error: string): Action => {
  const effect = actOf({ tool, args }, ctx) ? 'act' : ctx.tools.find((t) => t.name === tool)?.effect ?? 'read';
  return { record: { i, tool, args, effect, state: 'failed', error, digest: digest(tool, args, { error }), at: ctx.now } };
};

/** Policy for call `i`, unless the person already answered for exactly this call (then once, their way). */
function attempt(run: GardenRun, ctx: Ctx, i: number, tool: string, args: Record<string, unknown>): Action {
  const key = callKey({ tool, args }, ctx);
  const act = actOf({ tool, args }, ctx);
  const answered = answerFor(run, i, tool, key);
  // The person said no to helping with a check for humans on this step's page.
  if (run.requests.some((q) => q.kind === 'help' && q.step === i && q.answer?.value === 'no')) return failed(ctx, i, tool, args, HELP_REFUSED);
  // A plan's yes skips nothing: policy decides first (below).
  if (answered && !answered.fromPlan) {
    if (said(answered) && answered.answer!.args) return edited(run, ctx, i, tool, answered, answered.answer!.args);
    if (said(answered)) return { call: { i, tool, args } };
    // A no after the page stopped the act: say where, and that nothing had run (it is only re-asked then).
    const at = answered.index !== undefined ? act?.steps[answered.index] : undefined;
    return failed(ctx, i, tool, args, at ? `Refused by you. It stopped before ${describe(at)} (${answered.why}); no step had run.` : 'Refused by you');
  }
  const verdict = decide(run, ctx.gardener, { tool, args }, ctx);
  if (verdict === 'allow') return { call: { i, tool, args } };
  if (verdict === 'deny') return failed(ctx, i, tool, args, 'Not allowed.');
  const approve = act && approveRequest(run, ctx, i, tool, args);
  // A plan's yes (the only answer left here) counts where policy asks and the call isn't sensitive now.
  if (approve) return answered && !approve.sensitive && planCovers(tool) ? { call: { i, tool, args } } : { request: approve };
  const name = ctx.gardener.name;
  const text = tool === 'read_page' ? `${name} wants to open ${String(args.url)}` : tool === 'search' ? `${name} wants to search for "${String(args.query)}"` : `${name} wants to use ${tool}: ${String(Object.values(args)[0] ?? '')}`;
  return { request: { kind: 'reach', step: i, tool, argsKey: key, text: text.slice(0, 500), sensitive: false, expiresAt: expiresAt(ctx) } };
}

/**
 * The person said yes to call `i` with edited args (`first`): the edited call is a new call. If it was asked again
 * (it turned sensitive), that answer settles it; else policy runs on it, and its yes counts unless it is sensitive now.
 */
function edited(run: GardenRun, ctx: Ctx, i: number, tool: string, first: Request, args: Record<string, unknown>): Action {
  const again = answerFor(run, i, tool, callKey({ tool, args }, ctx));
  if (again?.editedFrom === first.id) return said(again) ? { call: { i, tool, args, answered: again.id } } : failed(ctx, i, tool, args, 'Refused by you');
  const verdict = decide(run, ctx.gardener, { tool, args }, ctx);
  const approve = verdict === 'ask' ? approveRequest(run, ctx, i, tool, args) : null;
  if (verdict === 'deny' || (verdict === 'ask' && !approve)) return failed(ctx, i, tool, args, 'Not allowed.');
  return approve?.sensitive ? { request: { ...approve, editedFrom: first.id, noEdit: true } } : { call: { i, tool, args, answered: first.id } };
}

/**
 * The page stopped call `i` on a sensitive step: the approval for that step. A call run on an edited yes (`q`) is
 * asked as that edit's follow-up, which can't be edited again.
 */
export function stopRequest(run: GardenRun, ctx: Ctx, i: number, tool: string, args: Record<string, unknown>, stop: { index: number; why: string }, q?: Request): Omit<Request, 'id'> | null {
  const request = approveRequest(run, ctx, i, tool, args, stop);
  const from = q?.answer?.args ? q.id : q?.editedFrom;
  return request && from ? { ...request, editedFrom: from, noEdit: true } : request;
}

/**
 * The approval for acting call `i`. Sensitive (always asked, never granted, 8 s) when its steps are, or when the page
 * stopped it on a sensitive step (`stop`: that step and reason, which the yes then covers once).
 */
export function approveRequest(run: GardenRun, ctx: Ctx, i: number, tool: string, args: Record<string, unknown>, stop?: { index: number; why: string }): Omit<Request, 'id'> | null {
  const act = actOf({ tool, args }, ctx);
  if (!act) return null;
  // Asked as sensitive before (answered too soon): still sensitive, about the same step.
  const key = callKey({ tool, args }, ctx);
  const before = run.requests.findLast((x) => x.kind === 'approve' && x.step === i && x.tool === tool && x.argsKey === key && x.sensitive && x.why);
  stop ??= before?.index !== undefined ? { index: before.index, why: before.why! } : undefined;
  const why = stop?.why ?? sensitiveSteps(run, act.steps, tool) ?? before?.why;
  const at = stop && act.steps[stop.index];
  const text = `${ctx.gardener.name} wants to ${act.text}`.slice(0, 1400) + (why ? `\nSensitive${at ? ` (${describe(at)})` : ''}: ${why}.` : '');
  return { kind: 'approve', step: i, tool, argsKey: key, host: act.host, text, sensitive: !!why, ...(why && { why }), ...(stop && { index: stop.index }), expiresAt: expiresAt(ctx) };
}

const budget = (run: GardenRun) => contextChars(run.maxTokens!);

/**
 * A think whose fixed part fits; the data is cut to the rest, so the engine never cuts. The person's unused Steer
 * messages are their own words, so they end the instruction part. With `ctx`, memory joins: anchors (and a template
 * a gardener wrote) start the data, a template the person wrote ends the instruction; either taints the run.
 */
function think(run: GardenRun, purpose: Turn['purpose'], prompt: string, data: string, taint = false, ctx?: Ctx): Action {
  const mem = ctx ? memoryParts(ctx.anchors, ctx.forEntity) : { instruction: '', data: '' };
  if (mem.instruction) prompt += `\n\n${mem.instruction}`;
  const steer = (run.inbox ?? []).filter((m) => m.steer && !m.usedAt);
  if (steer.length) prompt += `\n\n${steer.map((m) => `The person adds: ${m.text}`).join('\n')}`;
  const room = budget(run) - prompt.length;
  if (room < 0) return { fail: TOO_LONG };
  // ponytail: memory takes up to a third of the room ahead of the rest, so the data's tail is what gets cut.
  if (mem.data) data = `${mem.data.slice(0, Math.floor(room / 3))}\n\n${data}`;
  taint ||= !!(mem.instruction || mem.data);
  return { think: { purpose, prompt, data: data.slice(0, room), ...(purpose === 'word' ? {} : { sampling: GREEDY }), ...(taint && { taint: true as const }),
    ...(steer.length && { steer: steer.map((m) => m.id) }) } };
}

// ponytail: notes get at most a third of the data room, so page results always keep the rest; tune if notes starve.
const notesFit = (notes: Note[] | undefined, room: number) => notesBlock(notes ?? [], Math.floor(Math.max(0, room) / 3));

/** An event run's data starts with the page change that started it. */
const changed = (run: GardenRun) => (run.trigger ? `What changed on ${run.trigger.url}:\n${defang(run.trigger.diff)}\n\n` : '');

// Direct reads: one `word` think over every page's change, then done.
function word(run: GardenRun, ctx: Ctx, urls: string[]): Action {
  const read = run.steps.filter((s) => s.state === 'done');
  const missed = run.steps.filter((s) => s.state !== 'done').map((s) => String(s.args.url));
  const t = run.turns.find((x) => x.purpose === 'word');
  if (!read.length) return { fail: `None of the pages could be read: ${urls.join(', ')}` };
  if (!t) {
    const head = changed(run);
    const notes = notesFit(ctx.notes, budget(run) - WORD.length - head.length);
    // Each page gets an equal share of the rest, so none is cut away whole.
    const per = Math.floor((budget(run) - WORD.length - head.length - (notes ? notes.length + 2 : 0)) / read.length) - 2;
    const pages = read.map((s) => `${String(s.args.url)}\n${defang(s.output) || '(no change)'}`.slice(0, Math.max(0, per))).join('\n\n');
    return think(run, 'word', WORD, head + (notes ? `${pages}\n\n${notes}` : pages), !!notes, ctx);
  }
  return { done: { answer: t.reply.trim() + (missed.length ? `\n\nCouldn't read: ${missed.join(', ')}` : '') } };
}

/** The newest answer the model gave in a choose or repair turn, or ''. */
function lastAnswer(run: GardenRun): string {
  for (const t of [...run.turns].reverse()) {
    const o = t.purpose === 'choose' || t.purpose === 'repair' ? parseJsonObject(t.reply) : null;
    if (typeof o?.answer === 'string' && o.answer.trim()) return o.answer.trim();
  }
  return '';
}

/** What a run has when time runs out: the last answer, else what each step did. */
function soFar(run: GardenRun): string {
  const t = run.turns.findLast((x) => x.purpose === 'word' || x.purpose === 'sum');
  if (t) return t.reply.trim();
  const answer = lastAnswer(run);
  if (answer) return answer;
  const lines = run.steps.map((s) => s.digest ?? `${s.tool} ${s.state}`);
  return `Out of time.${lines.length ? `\n${lines.join('\n')}` : ''}`;
}

type Choice = { call: { tool: string; args: Record<string, unknown> } } | { answer: string } | null;

function parseChoice(reply: string, tools: ToolSpec[]): Choice {
  const o = parseJsonObject(reply);
  if (!o) return null;
  if (typeof o.tool === 'string') {
    const spec = tools.find((t) => t.name === o.tool);
    const args = spec ? parseArgs(spec, o.args ?? {}) : null;
    return spec && args ? { call: { tool: spec.name, args } } : null;
  }
  return typeof o.answer === 'string' && o.answer.trim() ? { answer: o.answer.trim() } : null;
}

// Open work: choose → (repair) → call … → answer → check. The state is read back from the stored turns: every
// choose/repair reply that named a valid tool made exactly one step (run, refused or denied).
function open(run: GardenRun, ctx: Ctx, request: string): Action {
  const { maxSteps } = run.agent!;
  let calls = 0, checks = 0, answer = '', missing = '', last: { turn: Turn; choice: Choice; tools: ToolSpec[] } | null = null;
  for (const turn of run.turns) {
    if (turn.purpose === 'check') {
      checks++;
      const v = parseJsonObject(turn.reply);
      missing = v?.met === false ? (typeof v.missing === 'string' && v.missing ? v.missing : 'something') : '';
      last = { turn, choice: null, tools: [] };
    } else if (turn.purpose === 'choose' || turn.purpose === 'repair') {
      const tools = calls < maxSteps ? ctx.tools : [];
      const choice = parseChoice(turn.reply, tools);
      if (choice && 'call' in choice) calls++;
      if (choice && 'answer' in choice) answer = choice.answer;
      last = { turn, choice, tools };
    }
  }
  const choose = (purpose: 'choose' | 'repair', tools: ToolSpec[]) => {
    const prompt = choosePrompt(ctx.gardener, request, tools, purpose);
    const d = chooseData(run, missing, ctx, budget(run) - prompt.length);
    return think(run, purpose, prompt, d.data, d.taint, ctx);
  };
  if (!last) return choose('choose', ctx.tools);
  const { turn, choice } = last;
  if (turn.purpose === 'check') {
    // Only an explicit "met": false with steps left continues, and only once.
    if (missing && checks === 1 && run.steps.length < maxSteps) return choose('choose', ctx.tools);
    return { done: missing ? { answer, best: true } : { answer } };
  }
  // A tool asked for after the steps ran out: end with what the run has, rather than fail it.
  if (!choice && !last.tools.length && typeof parseJsonObject(turn.reply)?.tool === 'string') return { done: { answer: answer || soFar(run), best: true } };
  if (!choice) return turn.purpose === 'repair' ? { fail: BAD_REPLY } : choose('repair', last.tools);
  if ('answer' in choice) {
    // The answer is the model's words: data, never the instruction.
    return think(run, 'check', `Task: ${request}\nDoes the answer below complete the task? Reply with only {"met": true} or {"met": false, "missing": "…"}.`, `Answer: ${choice.answer}`);
  }
  if (run.steps.length < calls) return attempt(run, ctx, run.steps.length, choice.call.tool, choice.call.args);
  return choose('choose', run.steps.length < maxSteps ? ctx.tools : []);
}

const headOf = (g: Gardener, request: string) => `You are ${g.name}, a gardener working in a web browser for one person.\nTheir instructions: ${g.instructions}\nThe task: ${request}\n`;
const toolLines = (tools: ToolSpec[]) => tools.map((t) => `${t.name}(${Object.keys(t.args).join(', ')}): ${t.describe}`).join('\n');

function choosePrompt(g: Gardener, request: string, tools: ToolSpec[], purpose: 'choose' | 'repair'): string {
  const body = tools.length
    ? `You can use these tools, one at a time:\n${toolLines(tools)}\nReply with only one JSON object, either {"tool": "<name>", "args": {…}} or {"answer": "<your answer>"}.`
    : 'Give your answer now.\nReply with only one JSON object: {"answer": "<your answer>"}.';
  return headOf(g, request) + body + (purpose === 'repair' ? `\n\n${REPAIR}` : '');
}

function planPrompt(g: Gardener, request: string, tools: ToolSpec[], max: number, purpose: 'plan' | 'repair'): string {
  return `${headOf(g, request)}You can use these tools:\n${toolLines(tools)}\nWrite a plan: a JSON array of at most ${max} tool calls, [{"tool": …, "args": {…}}], in order. Reply with only the array.`
    + (purpose === 'repair' ? `\n\n${PLAN_REPAIR}` : '');
}

/** A plan: 1 to `max` calls, each to a listed tool with args `parseArgs` takes; anything else → null. */
export function parsePlan(raw: unknown, tools: ToolSpec[], max: number): PlannedCall[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > max) return null;
  const calls = raw.map((c: { tool?: unknown; args?: unknown } | null) => {
    const spec = tools.find((t) => t.name === c?.tool);
    const args = spec ? parseArgs(spec, c?.args ?? {}) : null;
    return spec && args ? { tool: spec.name, args } : null;
  });
  return calls.every((c) => c) ? (calls as PlannedCall[]) : null;
}

// Plan first: plan → (repair) → the person's yes → each planned call as direct work (call j is step j) → one sum.
function planned(run: GardenRun, ctx: Ctx, request: string): Action {
  const { plan } = run;
  if (plan) {
    const j = run.steps.length;
    if (j < plan.length) return attempt(run, ctx, j, plan[j]!.tool, plan[j]!.args);
    const t = run.turns.find((x) => x.purpose === 'sum');
    if (t) return { done: { answer: t.reply.trim() } };
    // Each step's result gets an equal share of the room, as `word` gives each page.
    const prompt = SUM(request, !!ctx.earlier);
    const head = changed(run) + (ctx.earlier ? `${ctx.earlier}\n\n` : '');
    const per = Math.floor((budget(run) - prompt.length - head.length) / Math.max(1, j)) - 2;
    const data = head + run.steps.map((s) => `[${s.i}] ${s.digest ?? s.tool}\n${defang(s.output ?? s.error ?? '')}`.slice(0, Math.max(0, per))).join('\n\n');
    return think(run, 'sum', prompt, data, !!(ctx.earlier && ctx.earlierTainted), ctx);
  }
  const max = run.agent!.maxSteps;
  const write = (purpose: 'plan' | 'repair') => {
    const prompt = planPrompt(ctx.gardener, request, ctx.tools, max, purpose);
    const d = chooseData(run, '', ctx, budget(run) - prompt.length);
    return think(run, purpose, prompt, d.data, d.taint, ctx);
  };
  const last = run.turns.findLast((x) => x.purpose === 'plan' || x.purpose === 'repair');
  if (!last) return write('plan');
  const calls = parsePlan(jsonArray(last.reply), ctx.tools, max);
  if (!calls) return last.purpose === 'repair' ? { fail: BAD_REPLY } : write('repair');
  return { request: { kind: 'plan', calls, text: `${ctx.gardener.name}’s plan for: ${request}`.slice(0, 1400), sensitive: false, expiresAt: expiresAt(ctx) } };
}

/**
 * The person's answer to plan request `q`. No: the run stops. Yes, with the calls as edited (or as proposed): each is
 * parsed again; planned reads join `seen` as approved; each planned act or acting collect that isn't sensitive now
 * gets a yes bound to its step, tool and key (`fromPlan`). Nothing else is pre-approved. Returns why it can't be taken.
 */
export function answerPlan(run: GardenRun, ctx: Ctx, q: Request, value: 'yes' | 'no', edited: unknown, now: number): string | null {
  if (value === 'no') {
    q.answer = { value, at: now };
    Object.assign(run, { status: 'stopped', endedAt: now });
    return null;
  }
  const max = run.agent?.maxSteps ?? 0;
  const calls = parsePlan(edited ?? q.calls, ctx.tools, max);
  if (!calls) return `A plan is 1 to ${max} calls to the listed tools, each with valid arguments.`;
  q.answer = { value, at: now };
  run.plan = calls;
  run.seen = addSeen(run.seen, calls.filter((c) => c.tool === 'read_page').map((c) => String(c.args.url)), 'approved');
  calls.forEach((c, j) => {
    const a = planCovers(c.tool) && approveRequest(run, ctx, j, c.tool, c.args);
    if (a && !a.sensitive) run.requests.push({ ...a, id: `${q.id}.${j}`, shownAt: now, answer: { value: 'yes', at: now }, fromPlan: true });
  });
  run.status = 'queued';
  return null;
}

/**
 * A follow-up's earlier run, if any, then steps so far, the notes that fit (whole, after the head is measured), then the newest outputs first; whole older
 * outputs are left out when they don't fit. `taint`: notes went in.
 */
function chooseData(run: GardenRun, missing: string, ctx: Ctx, room: number): { data: string; taint: boolean } {
  // The named tabs' titles are page text: here, in the data, never in the instructions.
  const tabs = run.work.kind === 'ask' || run.work.kind === 'plan' ? run.work.tabs ?? [] : [];
  const head = [
    ...(ctx.earlier ? [ctx.earlier, ''] : []),
    ...(missing ? [`Still missing: ${missing}`, ''] : []),
    ...(tabs.length ? ['Tabs the person named (read_my_tab):', ...tabs.map((m) => `- ${m.url} (${defang(m.title).slice(0, 100)})`), ''] : []),
    'Steps so far:',
    ...(run.steps.length ? run.steps.map((s) => `${s.i}. ${s.tool} ${JSON.stringify(s.args).slice(0, 500)} → ${s.digest ?? s.error ?? s.state}`) : ['none']),
  ].join('\n');
  const block = notesBlock(ctx.notes ?? [], Math.min(Math.floor(Math.max(0, room) / 3), room - head.length - 2));
  let data = block ? `${head}\n\n${block}` : head;
  room -= data.length;
  const outputs = run.steps.filter((s) => s.output).reverse();
  if (outputs.length) data += '\n\nLatest results:';
  for (const s of outputs) {
    const entry = `\n\n[${s.i}] ${s.tool}:\n${defang(s.output)}`;
    if (entry.length > room) break;
    data += entry;
    room -= entry.length;
  }
  return { data, taint: !!block || !!(ctx.earlier && ctx.earlierTainted) };
}

const RETRY_OPEN = 'An open request can’t retry one step: ask a follow-up instead.';

/**
 * The person's Retry step on call `i` of an ended run of direct work: that step, every later one, every turn made
 * after it, and the requests about them go (an act is asked again), and the run is queued so next() re-issues it.
 * An act only after the person said it did not happen. Returns why it can't be retried.
 */
export function retryStep(run: GardenRun, i: number): string | null {
  if (run.work.kind === 'ask') return RETRY_OPEN;
  if (run.parentId) return 'Retry it from its parent run.';
  if (run.status === 'queued' || run.status === 'running' || run.status === 'waiting') return 'It’s still working.';
  const step = run.steps.find((s) => s.i === i);
  if (step?.state !== 'failed') return 'That step didn’t fail.';
  if (step.effect === 'act' && !run.requests.some((q) => q.kind === 'did-it-happen' && q.step === i && q.answer?.value === 'no')) {
    return 'An action can be retried only after you said it did not happen (did it happen? No).';
  }
  run.steps = run.steps.filter((s) => s.i < i);
  run.turns = run.turns.filter((t) => t.at <= step.at);
  run.requests = run.requests.filter((q) => q.step === undefined || q.step < i);
  run.retry = { i, tries: (step.tries ?? 0) + 1 };
  // A retry is the person's: a fresh time budget and interruption count.
  Object.assign(run, { status: 'queued', usedMs: 0, interrupted: 0 });
  // The person is here now: a one-off's deadline was for the unattended run.
  for (const k of ['answer', 'best', 'why', 'endedAt', 'deadline'] as const) delete run[k];
  return null;
}

export const AUTO_RETRY_MS = 30_000;

/** A read or search that failed with a timeout or a network error, not yet retried: the worker tries it once more after 30 s. */
export const autoRetry = (s: Step): boolean => s.state === 'failed' && !s.tries && (s.tool === 'read_page' || s.tool === 'search')
  && /took too long|timed? ?out|net::|ERR_|error page|network|failed to fetch/i.test(s.error ?? '');

/** A follow-up's start: the earlier run's answer and what each step did (no page text), as data. */
export function earlierOf(r: GardenRun): string {
  const steps = r.steps.map((s) => `- ${s.digest ?? `${s.tool} ${s.state}`}`);
  return `Earlier answer: ${defang(r.answer ?? r.why ?? '(none)')}\nEarlier steps:\n${steps.length ? steps.join('\n') : '- none'}`.slice(0, 2000);
}

/** A follow-up run to `earlier`: plan work, or open with a loop model; tainted if the earlier run was (its answer is private). */
export function followUpRun(earlier: GardenRun, work: Work, id: string, now: number): GardenRun {
  return { ...newRun({ id, gardenerId: earlier.gardenerId, work, now }), followUp: earlier.id, tainted: earlier.tainted };
}

/** The ended run's oldest queued message, marked used, as a follow-up run; null when none is left. */
export function queuedFollowUp(run: GardenRun, id: string, now: number): GardenRun | null {
  const m = run.inbox?.find((x) => !x.steer && !x.usedAt);
  if (!m) return null;
  m.usedAt = now;
  return followUpRun(run, { kind: run.agent?.loop ? 'ask' : 'plan', request: m.text }, id, now);
}

/**
 * At worker start: runs that were `running` go back to `queued` (more than 3 interruptions → failed), and waiting
 * runs whose request expired fail. Idempotent: running it on its own output changes nothing.
 */
export function recover(runs: GardenRun[], now: number): GardenRun[] {
  return runs.map((r) => {
    if (expired(r, now)) return { ...r, status: 'failed', why: 'Needed you for too long.', endedAt: now };
    if (r.status !== 'running') return r;
    const interrupted = (r.interrupted ?? 0) + 1;
    return interrupted > 3 ? { ...r, status: 'failed', interrupted, why: 'The run was interrupted too many times.', endedAt: now } : { ...r, status: 'queued', interrupted };
  });
}
