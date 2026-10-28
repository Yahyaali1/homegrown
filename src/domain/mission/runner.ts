// Running a mission: one pass of the workflow (search → open → extract → filter → rank → answer), then the loop that
// checks the result against the brief and revises until it holds. All I/O goes through MissionPorts.
import { requiredTerms, mentions } from '../text.ts';
import { describe, enforceBrief } from './brief.ts';
import { extractRows } from './extract.ts';
import { throwIfStopped, Stopped, type MissionPorts } from './ports.ts';
import { applyFilter, mergeRows, rankRows, relevantResults } from './rows.ts';
import { columns, type LoopResult, type MissionResult, type RoundRecord, type Row, type SearchResult, type StepOf, type Verdict, type Workflow } from './types.ts';
import { parseJsonObject, hostOf, defang } from '../text.ts';
import type { PageModel } from '../../shared/pagemodel.ts';

export const MAX_ROUNDS = 4;
const GREEDY = { temperature: 0 } as const;
const PARALLEL_PAGES = 3;

/** State shared across a mission's rounds. */
export interface LoopState {
  round: number;
  /** URLs already read: later rounds read new pages only. */
  seen: Set<string>;
  /** Every row from earlier rounds, filled in by later ones. */
  carry: Row[];
}

const stepsOf = <T extends Workflow['steps'][number]['type']>(wf: Workflow, type: T) => wf.steps.find((s): s is StepOf<T> => s.type === type);

/** Search, keeping only results about the thing; when fewer than two are, ask the next engine too. */
async function search(ports: MissionPorts, step: StepOf<'search'>, wf: Workflow, state: LoopState | null): Promise<{ results: SearchResult[]; skipped: number }> {
  const urls = (step.urls ?? []).filter((u) => /^https?:/.test(u));
  if (urls.length) return { results: urls.map((url) => ({ title: url, url })).filter((r) => !state?.seen.has(r.url)), skipped: 0 };
  const seen = state?.seen ?? new Set<string>();
  let found = 0;
  let relevant: SearchResult[] = [];
  for (let e = 0; e < ports.engines && relevant.length < 2; e++) {
    throwIfStopped(ports.signal);
    const raw = await ports.search(step.query, step.n, e).catch(() => []);
    found += raw.length;
    for (const r of relevantResults(raw, wf.brief, seen)) if (!relevant.some((x) => x.url === r.url)) relevant.push(r);
  }
  return { results: relevant, skipped: Math.max(0, found - relevant.length) };
}

/** Opens up to `limit` results, a few at a time. Pages that can't be read or are empty are skipped. */
async function open(ports: MissionPorts, index: number, results: SearchResult[], limit: number, terms: string[], state: LoopState | null): Promise<PageModel[]> {
  const todo = results.slice(0, limit);
  const pages: PageModel[] = [];
  let next = 0;
  const worker = async () => {
    while (next < todo.length && !ports.signal.aborted) {
      const r = todo[next++]!;
      state?.seen.add(r.url);
      ports.progress({ kind: 'step', index, status: 'running', log: [`reading ${hostOf(r.url)}`] });
      const p = await ports.readPage(r.url, terms).catch(() => null);
      if (p && (p.text.length > 60 || p.structured.products.length || p.lists.length || p.tables.length)) pages.push(p);
      ports.progress({ kind: 'step', index, status: 'running', detail: `${pages.length}/${todo.length} pages read` });
    }
  };
  await Promise.all(Array.from({ length: PARALLEL_PAGES }, worker));
  return pages;
}

const rowText = (r: Row) => `${r._text ?? ''} ${columns(r).map(([, v]) => v).join(' ')}`;

/**
 * One pass of the workflow. With loop state, an empty result returns quietly (the loop decides what to try next)
 * and rows merge with earlier rounds; without it (benchmarks, schedules), no rows is an error.
 */
export async function runWorkflow(ports: MissionPorts, wf: Workflow, state: LoopState | null = null): Promise<MissionResult> {
  const { goal, brief } = wf;
  let results: SearchResult[] = [];
  let pages: PageModel[] = [];
  let rows: Row[] = [];
  let pool: Row[] = [];
  let answer = '';
  const say = (index: number, e: Omit<Extract<Parameters<MissionPorts['progress']>[0], { kind: 'step' }>, 'kind' | 'index'>) => ports.progress({ kind: 'step', index, ...e });
  for (const [i, step] of wf.steps.entries()) {
    throwIfStopped(ports.signal);
    say(i, { status: 'running' });
    switch (step.type) {
      case 'search': {
        const r = await search(ports, step, wf, state);
        results = r.results;
        say(i, { status: 'done', detail: `${results.length} results${r.skipped ? ` · ${r.skipped} off-topic skipped` : ''}`, log: results.map((x) => `found ${x.title}`) });
        break;
      }
      case 'open': {
        // Terms an in-page control may be named after: must-haves plus numbers in the goal ("2015" year tabs).
        const require = stepsOf(wf, 'extract')?.require ?? [];
        const terms = [...new Set([...requiredTerms(goal), ...(goal.match(/\b\d{2,4}\b/g) ?? []), ...require])];
        pages = await open(ports, i, results, step.limit, terms, state);
        say(i, { status: 'done', detail: `${pages.length} pages read` });
        break;
      }
      case 'extract': {
        rows = [];
        const single = !wf.steps.some((s) => s.type === 'rank');
        for (const p of pages) {
          throwIfStopped(ports.signal);
          rows.push(...(await extractRows(ports.ask, p, step.fields, goal, single)));
          say(i, { status: 'running', detail: `${rows.length} rows`, rows });
        }
        const found = rows.length;
        const need = step.require.filter(Boolean);
        const matching = need.length ? rows.filter((r) => need.every((t) => mentions(rowText(r), t))) : rows;
        // No row mentions them (a year that labels the whole section): keep all, except on later rounds, whose
        // wider searches bring in unrelated pages.
        if (matching.length || (state?.round ?? 1) > 1) rows = matching;
        const lacked = found - rows.length;
        const enforced = enforceBrief(rows, brief);
        rows = enforced.rows.map(({ _text, ...r }) => r);
        if (state) rows = mergeRows(state.carry, rows, step.fields);
        const a = enforced.setAside;
        const why = [lacked && `${lacked} lacked ${need.join(', ')}`, a.subject && `${a.subject} weren't a ${brief?.subject}`, a.avoid && `${a.avoid} excluded`,
          a.accessory && `${a.accessory} accessories`, a.article && `${a.article} articles, not products`].filter(Boolean);
        say(i, { status: 'done', detail: `${rows.length} rows from ${pages.length} pages${why.length ? ` · set aside: ${why.join(', ')}` : ''}`, rows });
        break;
      }
      case 'filter': {
        const before = rows.length;
        rows = applyFilter(rows, step);
        say(i, { status: 'done', detail: step.field && step.value !== '' ? `${rows.length} of ${before} kept` : 'off', rows });
        break;
      }
      case 'rank': {
        pool = rows;
        const ranked = rankRows(rows, step);
        rows = ranked.rows;
        say(i, { status: 'done', detail: `top ${rows.length} by ${step.by}${ranked.otherCurrency ? ` · ${ranked.otherCurrency} in other currencies set aside` : ''}`, rows });
        break;
      }
      case 'answer': {
        if (!pool.length) pool = rows;
        if (!rows.length) {
          if (state) return { rows, pool, answer: '' };
          throw new Error('No usable results: the pages could not be read or had none of the fields.');
        }
        // Prices go in with their currency attached, so the answer can't turn kronor into dollars.
        // Row values come from pages: injection sentences are removed before the model reads them.
        const cell = (k: string, v: unknown, r: Row) => (/price|cost/.test(k) && typeof v === 'number' && r._currency ? `${v} ${r._currency}` : v == null ? v : defang(v));
        const table = rows.map((r, n) => `[${n + 1}] ${columns(r).map(([k, v]) => `${k}: ${cell(k, v, r)}`).join('; ')} (source: ${defang(r._source)}, ${r._url})`).join('\n');
        answer = await ports.ask(`Goal: ${goal}\n${step.question}${brief ? ` The user wants ${describe(brief)}.` : ''}\nUse only the numbered rows below and cite them like [1]. Quote prices with the currency shown in the row. If no row fully meets what the user wants, say which part is missing. Two to four sentences.`, table);
        say(i, { status: 'done', detail: 'written', answer });
        break;
      }
      default: {
        const never: never = step;
        throw new Error(`Unknown step ${JSON.stringify(never)}`);
      }
    }
  }
  return { rows, pool: pool.length ? pool : rows, answer };
}

/** Deterministic checks first (enough rows with the deciding field); when they pass, the model judges against the goal. */
export async function check(ports: MissionPorts, wf: Workflow, r: MissionResult, seen: ReadonlySet<string>): Promise<Verdict> {
  const fields = stepsOf(wf, 'extract')?.fields ?? [];
  const rank = stepsOf(wf, 'rank');
  const deciding = rank ? [rank.by] : fields;
  const want = rank ? Math.min(3, rank.keep) : 1;
  const usable = r.rows.filter((x) => deciding.every((f) => x[f] != null));
  // Unread detail pages of rows with holes: following them is the cheapest way to fill gaps.
  const incomplete = r.pool.filter((x) => fields.some((f) => x[f] == null) && /^https?:/.test(x._url ?? '') && !seen.has(x._url!));
  if (!r.rows.length) return { achieved: false, why: 'no usable rows yet', next: 'search', incomplete };
  if (usable.length < want && r.pool.length > usable.length) {
    return { achieved: false, why: `only ${usable.length} of ${r.pool.length} results have ${deciding.join(', ')}`, next: incomplete.length ? 'follow' : 'search', incomplete };
  }
  const table = r.rows.slice(0, 6).map((x, i) => `[${i + 1}] ${fields.map((f) => `${f}: ${x[f] == null ? x[f] : defang(x[f])}`).join('; ')}`).join('\n');
  const v = parseJsonObject(await ports.ask(
    `Goal: ${wf.goal}\n${wf.brief ? `What the user wants: ${describe(wf.brief)}\n` : ''}Answer so far: ${r.answer}\n` +
      'Do these results contain what the goal asks for? Say achieved: true when the answer is supported by the rows, even if more sources ' +
      'could exist or the wording could be better. Say false only when a value the goal needs is missing, or the answer is wrong or off-topic. Reply with JSON only: ' +
      '{"achieved": true or false, "missing": "<what is missing or wrong, short>", "better_query": "<a better web search query, or empty>"}',
    table, GREEDY,
  ));
  // Only an explicit "false" counts against: an unreadable verdict mustn't make the loop spin.
  if (v?.achieved !== false) return { achieved: true, why: `${usable.length} result${usable.length === 1 ? '' : 's'} answer the goal` };
  const better = typeof v.better_query === 'string' && v.better_query.trim() ? { query: v.better_query.trim() } : {};
  return { achieved: false, why: typeof v.missing === 'string' && v.missing ? v.missing : 'the answer does not meet the goal yet', next: incomplete.length ? 'follow' : 'search', ...better, incomplete };
}

/** The next round's workflow from the verdict, or null when there's nothing new to try. */
export function revise(wf: Workflow, verdict: Extract<Verdict, { achieved: false }>): Workflow | null {
  const steps = wf.steps.map((s) => ({ ...s }));
  const search = steps.find((s): s is StepOf<'search'> => s.type === 'search');
  const open = steps.find((s): s is StepOf<'open'> => s.type === 'open');
  if (!search || !open) return null;
  const base = wf.baseQuery ?? search.query;
  const tried = [...(wf.tried ?? [search.query])];
  if (verdict.next === 'follow') {
    // Detail pages of incomplete items: product pages usually publish what the listing left out.
    const urls = [...new Set(verdict.incomplete.map((x) => x._url!).filter(Boolean))].slice(0, 5);
    Object.assign(search, { urls, query: `${urls.length} result pages` });
    open.limit = urls.length;
    return { ...wf, baseQuery: base, tried, steps, note: `Following ${urls.length} result links to fill the gaps` };
  }
  if (wf.fixedUrls) return null; // the user's own pages (open tabs): no web search to widen into
  delete search.urls;
  // The brief's own words make the most reliable query; then the checker's suggestion; then wider phrasings.
  const b = wf.brief;
  const fromBrief = b?.subject ? [...b.must, b.subject, b.shopping || b.rank?.by === 'price' ? 'price' : ''].filter(Boolean).join(' ') : '';
  const query = [fromBrief, verdict.query, `${base} buy price`, wf.goal, `${base} review comparison`].find((q): q is string => !!q && !tried.includes(q));
  if (!query) return null;
  search.query = query;
  search.n = Math.min(search.n + 4, 16);
  open.limit = Math.max(open.limit, 6);
  return { ...wf, baseQuery: base, tried: [...tried, query], steps, note: `Searching again: "${query}"` };
}

/** Act → check → revise, up to MAX_ROUNDS, until the goal is met or there's nothing new to try. */
export async function runMission(ports: MissionPorts, workflow: Workflow): Promise<LoopResult> {
  const state: LoopState = { round: 0, seen: new Set(), carry: [] };
  let wf: Workflow = { ...workflow, fixedUrls: !!stepsOf(workflow, 'search')?.urls?.length };
  let result: MissionResult = { rows: [], pool: [], answer: '' };
  const rounds: RoundRecord[] = [];
  const fields = () => stepsOf(wf, 'extract')?.fields ?? [];
  const complete = (rows: Row[]) => rows.filter((x) => fields().every((f) => x[f] != null)).length;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    throwIfStopped(ports.signal);
    state.round = round;
    const note = wf.note ?? 'First pass';
    ports.progress({ kind: 'round', round, phase: 'start', steps: wf.steps, note });
    const before = { pool: state.carry.length, complete: complete(state.carry), seen: state.seen.size };
    result = await runWorkflow(ports, wf, state);
    state.carry = result.pool;
    throwIfStopped(ports.signal);
    ports.progress({ kind: 'round', round, phase: 'checking' });
    const verdict = await check(ports, wf, result, state.seen);
    const record: RoundRecord = { round, note, why: verdict.why, achieved: verdict.achieved };
    rounds.push(record);
    ports.progress({ kind: 'round', round, phase: 'verdict', achieved: verdict.achieved, why: verdict.why, rows: result.rows, answer: result.answer });
    if (verdict.achieved || round === MAX_ROUNDS) break;
    const progressed = result.pool.length > before.pool || complete(result.pool) > before.complete;
    // Stalled with rows: stop. With none, another query might still find something.
    if (round > 1 && !progressed && state.seen.size === before.seen && result.pool.length) {
      record.why += ' · stopped: the last round found nothing new';
      break;
    }
    const next = revise(wf, verdict);
    if (!next) {
      record.why += wf.fixedUrls ? ' · stopped: only your own pages to read' : ' · stopped: no other searches to try';
      break;
    }
    wf = next;
  }
  return { ...result, rounds, achieved: rounds.at(-1)?.achieved ?? false };
}

export { Stopped };
