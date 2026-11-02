// The model's side of a run: each think's prompt and data, cut to fit the pinned model, and how its replies are read
// back into the next action (open work, a plan, the word over a read's changes).
import { contextChars, defang, hostOf, parseJsonObject } from '../text.ts';
import { jsonArray } from '../html.ts';
import { onSites } from './policy.ts';
import { personUrls, type Gardener, type GardenRun, type PlannedCall, type Turn } from './records.ts';
import { mentionsOf, parseArgs, type ToolSpec } from './tools.ts';
import { notesBlock, type Note } from './notes.ts';
import { memoryParts } from '../memory.ts';
import { skillParts } from './skills.ts';
import { attempt, expiresAt, type Action, type Ctx } from './loop.ts';

export const BAD_REPLY = "The model's reply couldn't be read.";
export const TOO_LONG = 'The instructions are too long for this model.';
const WORD = 'Here is what changed on each page since the last check (lines with + were added, − removed; a page under "First look:" is new, so say briefly what it holds). In two or three sentences, say what changed that matters. If nothing did, say so.';
const REPAIR = 'Your reply was not one valid JSON object for a listed tool or an answer. Reply with only the JSON.';
const PLAN_REPAIR = 'Your reply was not one JSON array of calls to listed tools with valid args. Reply with only the array.';
const SUM = (request: string, followUp: boolean) => `The task: ${request}. Below are ${followUp ? 'an earlier answer and ' : ''}the results of the planned steps. Answer the task from them in a few sentences. If they don't answer it, say what is missing.`;
const GREEDY = { temperature: 0 };

const budget = (run: GardenRun) => contextChars(run.maxTokens!);

/**
 * A think whose fixed part fits; the data is cut to the rest, so the engine never cuts. The person's unused Steer
 * messages are their own words, so they end the instruction part. With `ctx`, memory joins: anchors (and a template
 * a gardener wrote) start the data, a template the person wrote ends the instruction; either taints the run. A skill's
 * method follows the gardener's instructions; its files are data.
 */
function think(run: GardenRun, purpose: Turn['purpose'], prompt: string, data: string, taint = false, ctx?: Ctx): Action {
  const mem = ctx ? memoryParts(ctx.anchors, ctx.forEntity) : { instruction: '', data: '' };
  const skill = ctx?.skill ? skillParts(ctx.skill) : { instruction: '', data: '' };
  if (skill.instruction) prompt += `\n\n${skill.instruction}`;
  if (mem.instruction) prompt += `\n\n${mem.instruction}`;
  const steer = (run.inbox ?? []).filter((m) => m.steer && !m.usedAt);
  if (steer.length) prompt += `\n\n${steer.map((m) => `The person adds: ${m.text}`).join('\n')}`;
  const room = budget(run) - prompt.length;
  if (room < 0) return { fail: TOO_LONG };
  // ponytail: memory takes up to a third of the room ahead of the rest, so the data's tail is what gets cut.
  const memData = mem.data.slice(0, Math.floor(room / 3));
  // ponytail: skill files get a third of what memory left, ahead of the rest; a long file is cut at its tail.
  const files = skill.data.slice(0, Math.floor((room - memData.length) / 3));
  data = [memData, files, data].filter(Boolean).join('\n\n');
  taint ||= !!(mem.instruction || mem.data);
  return { think: { purpose, prompt, data: data.slice(0, room), ...(purpose === 'word' ? {} : { sampling: GREEDY }), ...(taint && { taint: true as const }),
    ...(steer.length && { steer: steer.map((m) => m.id) }) } };
}

// ponytail: notes get at most a third of the data room, so page results always keep the rest; tune if notes starve.
const notesFit = (notes: Note[] | undefined, room: number) => notesBlock(notes ?? [], Math.floor(Math.max(0, room) / 3));

/** An event run's data starts with the page change that started it. */
const changed = (run: GardenRun) => (run.trigger ? `What changed on ${run.trigger.url}:\n${defang(run.trigger.diff)}\n\n` : '');

// Direct reads: one `word` think over every page's change, then done.
export function word(run: GardenRun, ctx: Ctx, urls: string[]): Action {
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
export function soFar(run: GardenRun): string {
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
export function open(run: GardenRun, ctx: Ctx, request: string): Action {
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
    const prompt = choosePrompt(ctx.gardener, request, tools, purpose, run);
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

/** The person's site notes for the hosts this run works on: its URLs, named tabs and steps so far. */
export function siteNotesFor(run: GardenRun, g: Gardener): string {
  if (!g.siteNotes) return '';
  const urls = [...personUrls(run.work), ...mentionsOf(run).map((m) => m.url),
    ...run.steps.flatMap((s) => [s.url, typeof s.args.url === 'string' ? s.args.url : undefined])];
  const hosts = new Set(urls.map((u) => hostOf(u)).filter(Boolean));
  return Object.entries(g.siteNotes).filter(([h]) => [...hosts].some((x) => onSites(x, [h]))).map(([h, n]) => `Notes for ${h}: ${n}\n`).join('');
}

const headOf = (g: Gardener, request: string, run: GardenRun) => `You are ${g.name}, a gardener working in a web browser for one person.\nTheir instructions: ${g.instructions}\n${siteNotesFor(run, g)}The task: ${request}\n`;
const toolLines = (tools: ToolSpec[]) => tools.map((t) => `${t.name}(${Object.keys(t.args).join(', ')}): ${t.describe}`).join('\n');

function choosePrompt(g: Gardener, request: string, tools: ToolSpec[], purpose: 'choose' | 'repair', run: GardenRun): string {
  const body = tools.length
    ? `You can use these tools, one at a time:\n${toolLines(tools)}\nReply with only one JSON object, either {"tool": "<name>", "args": {…}} or {"answer": "<your answer>"}.`
    : 'Give your answer now.\nReply with only one JSON object: {"answer": "<your answer>"}.';
  return headOf(g, request, run) + body + (purpose === 'repair' ? `\n\n${REPAIR}` : '');
}

function planPrompt(g: Gardener, request: string, tools: ToolSpec[], max: number, purpose: 'plan' | 'repair', run: GardenRun): string {
  return `${headOf(g, request, run)}You can use these tools:\n${toolLines(tools)}\nWrite a plan: a JSON array of at most ${max} tool calls, [{"tool": …, "args": {…}}], in order. Reply with only the array.`
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
export function planned(run: GardenRun, ctx: Ctx, request: string): Action {
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
    const prompt = planPrompt(ctx.gardener, request, ctx.tools, max, purpose, run);
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
 * A follow-up's earlier run, if any, then steps so far, the notes that fit (whole, after the head is measured), then the newest outputs first; whole older
 * outputs are left out when they don't fit. `taint`: notes went in.
 */
function chooseData(run: GardenRun, missing: string, ctx: Ctx, room: number): { data: string; taint: boolean } {
  // The named tabs' titles are page text: here, in the data, never in the instructions.
  const tabs = mentionsOf(run);
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
